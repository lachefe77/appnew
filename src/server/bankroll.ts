import { prisma } from "@/lib/db"

export async function ensureBankroll(userId: string, currency = "BRL") {
  return prisma.bankroll.upsert({
    where: { userId_currency: { userId, currency } },
    update: {},
    create: { userId, currency, balanceCents: 0 },
  })
}

export async function changeBankroll(userId: string, amountCents: number, kind: "entrada" | "ajuste" | "stake", note: string) {
  if (!Number.isInteger(amountCents) || amountCents === 0) {
    return { ok: false as const, error: "Informe um valor diferente de zero." }
  }
  if (kind === "entrada" && amountCents < 0) {
    return { ok: false as const, error: "A entrada precisa ser positiva." }
  }
  const bankroll = await ensureBankroll(userId)
  if (bankroll.balanceCents + amountCents < 0) {
    return { ok: false as const, error: "A banca não cobre esse valor." }
  }
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.bankroll.update({
      where: { id: bankroll.id },
      data: { balanceCents: { increment: amountCents } },
    })
    await tx.bankrollEntry.create({
      data: { bankrollId: bankroll.id, amountCents, kind, note },
    })
    return next
  })
  return { ok: true as const, balanceCents: updated.balanceCents }
}

export async function launchStake(input: { userId: string; signalKey: string; amountCents: number; profitCents: number; note: string }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false as const, error: "O stake precisa ser positivo." }
  }
  const existing = await prisma.stakeLaunch.findUnique({
    where: { userId_signalKey: { userId: input.userId, signalKey: input.signalKey } },
  })
  if (existing) {
    const bankroll = await ensureBankroll(input.userId)
    return { ok: true as const, duplicate: true, balanceCents: bankroll.balanceCents }
  }
  const bankroll = await ensureBankroll(input.userId)
  if (bankroll.balanceCents < input.amountCents) {
    return { ok: false as const, error: "A banca não cobre esse stake." }
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.stakeLaunch.create({
        data: {
          userId: input.userId,
          signalKey: input.signalKey,
          amountCents: input.amountCents,
          profitCents: input.profitCents,
          note: input.note,
        },
      })
      return tx.bankroll.update({
        where: { id: bankroll.id },
        data: {
          balanceCents: { decrement: input.amountCents },
          entries: {
            create: {
              amountCents: -input.amountCents,
              kind: "stake",
              note: input.note,
            },
          },
        },
      })
    })
    return { ok: true as const, duplicate: false, balanceCents: updated.balanceCents }
  } catch {
    const again = await prisma.stakeLaunch.findUnique({
      where: { userId_signalKey: { userId: input.userId, signalKey: input.signalKey } },
    })
    if (again) {
      const current = await ensureBankroll(input.userId)
      return { ok: true as const, duplicate: true, balanceCents: current.balanceCents }
    }
    return { ok: false as const, error: "Não foi possível lançar o stake." }
  }
}
