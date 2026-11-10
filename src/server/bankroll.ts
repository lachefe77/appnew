import { prisma } from "@/lib/db"
import { recordAudit } from "@/server/audit"

export async function ensureBankroll(userId: string, currency = "BRL") {
  return prisma.bankroll.upsert({
    where: { userId_currency: { userId, currency } },
    update: {},
    create: { userId, currency, balanceCents: 0 },
  })
}

export async function changeBankroll(
  userId: string,
  amountCents: number,
  kind: "entrada" | "ajuste" | "stake",
  note: string,
  currency = "BRL",
) {
  if (!Number.isInteger(amountCents) || amountCents === 0) {
    return { ok: false as const, error: "Informe um valor diferente de zero." }
  }
  if (kind === "entrada" && amountCents < 0) {
    return { ok: false as const, error: "A entrada precisa ser positiva." }
  }
  const safeCurrency = ["BRL", "USD", "EUR"].includes(currency) ? currency : "BRL"
  const bankroll = await ensureBankroll(userId, safeCurrency)
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
  if (kind !== "stake") {
    await recordAudit({
      actorId: userId,
      action: kind === "entrada" ? "banca.entrada" : "banca.ajuste",
      entityType: "banca",
      entityId: bankroll.id,
      summary: `${kind} de ${amountCents} ${safeCurrency}. ${note}`,
    })
  }
  return { ok: true as const, balanceCents: updated.balanceCents, currency: safeCurrency }
}

export async function launchStake(input: {
  userId: string
  signalKey: string
  amountCents: number
  profitCents: number
  note: string
  leftoverCents?: number
  legs?: Array<{ currency: string; stakeHouseCents: number }>
}) {
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
  const charges = new Map<string, number>()
  for (const leg of input.legs ?? []) {
    const currency = leg.currency === "USD" || leg.currency === "EUR" ? leg.currency : "BRL"
    charges.set(currency, (charges.get(currency) ?? 0) + leg.stakeHouseCents)
  }
  if (!charges.size) charges.set("BRL", input.amountCents)
  const wallets: Array<{ wallet: { id: string }; amount: number; currency: string }> = []
  for (const [currency, amount] of charges) {
    const wallet = await ensureBankroll(input.userId, currency)
    if (wallet.balanceCents < amount) {
      return { ok: false as const, error: `A banca em ${currency} não cobre esse stake.` }
    }
    wallets.push({ wallet, amount, currency })
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
          leftoverCents: input.leftoverCents ?? 0,
        },
      })
      let balance = 0
      for (const item of wallets) {
        const next = await tx.bankroll.update({
          where: { id: item.wallet.id },
          data: {
            balanceCents: { decrement: item.amount },
            entries: { create: { amountCents: -item.amount, kind: "stake", note: `${input.note} · ${item.currency}` } },
          },
        })
        if (item.currency === "BRL" || balance === 0) balance = next.balanceCents
      }
      return balance
    })
    await recordAudit({
      actorId: input.userId,
      action: "stake.lancar",
      entityType: "stake",
      entityId: input.signalKey,
      summary: input.note,
      after: { amountCents: input.amountCents, profitCents: input.profitCents },
    })
    return { ok: true as const, duplicate: false, balanceCents: updated }
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
