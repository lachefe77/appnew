"use server"

import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"
import { changeBankroll, launchStake } from "@/server/bankroll"
import { findSignalByKey } from "@/server/feed"
import { loadPanelGate } from "@/server/panel-access"

type BoardFilter = {
  phase: "prelive" | "live"
  houseIds: string[]
  fixedSides: Record<string, string>
  manualOdds: Record<string, number>
  autoMarketHouseIds: string[]
  pinnedHouseId: string | null
  minProfit: number
  totalStakeCents: number | null
  sort: "alfa" | "clone"
  key: string
}

async function sessionUser() {
  const session = await getSession()
  if (!session) return { ok: false as const, error: "Entre de novo." }
  return { ok: true as const, userId: session.sub }
}

async function openUser() {
  const access = await sessionUser()
  if (!access.ok) return access
  const gate = await loadPanelGate(access.userId)
  if (!gate.open) return { ok: false as const, error: "O painel está fechado." }
  return access
}

export async function launchStakeAction(input: BoardFilter) {
  const access = await openUser()
  if (!access.ok) return access
  const found = await findSignalByKey(access.userId, input.phase, input.key, {
    includedHouseIds: input.houseIds,
    fixedSides: input.fixedSides,
    manualOdds: input.manualOdds,
    autoMarketHouseIds: input.autoMarketHouseIds,
    pinnedHouseId: input.pinnedHouseId,
    minProfit: input.minProfit,
    totalStakeCents: input.totalStakeCents,
    sort: input.sort,
  })
  if (!found.signal) return { ok: false as const, error: "Esse sinal já saiu da grade." }
  return launchStake({
    userId: access.userId,
    signalKey: found.signal.key,
    amountCents: found.signal.totalStakeCents,
    profitCents: found.signal.profitCents,
    note: `${found.signal.eventName} · ${found.signal.leg1.houseName} x ${found.signal.leg2.houseName}`,
  })
}

export async function bankrollAction(input: { kind: "entrada" | "ajuste"; amountCents: number; note: string }) {
  const access = await sessionUser()
  if (!access.ok) return access
  return changeBankroll(access.userId, input.amountCents, input.kind, input.note.trim() || (input.kind === "entrada" ? "Entrada" : "Ajuste"))
}

export async function supportAction(input: { kind: "sugestao" | "bug"; body: string }) {
  const access = await sessionUser()
  if (!access.ok) return access
  const body = input.body.trim()
  if (body.length < 5) return { ok: false as const, error: "Escreva a mensagem." }
  if (input.kind !== "sugestao" && input.kind !== "bug") return { ok: false as const, error: "Tipo inválido." }
  await prisma.supportTicket.create({
    data: { userId: access.userId, kind: input.kind, body: body.slice(0, 1000) },
  })
  return { ok: true as const }
}
