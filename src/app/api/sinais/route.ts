import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"
import { dispatchAlerts } from "@/server/alerts"
import { loadSignals } from "@/server/feed"
import { loadPanelGate } from "@/server/panel-access"

type Body = {
  phase?: string
  houseIds?: string[]
  fixedSides?: Record<string, string>
  manualOdds?: Record<string, number>
  autoMarketHouseIds?: string[]
  pinnedHouseId?: string | null
  market?: string
  minProfit?: number
  totalStakeCents?: number | null
  sort?: "alfa" | "clone" | "lucro" | "horario" | "esporte"
  sport?: string
  competition?: string
}

const SORTS = ["alfa", "clone", "lucro", "horario", "esporte"] as const

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Entre de novo." }, { status: 401 })
  const gate = await loadPanelGate(session.sub)
  if (!gate.open) return NextResponse.json({ error: "O painel está fechado." }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Body
  const phase = body.phase === "live" ? "live" : "prelive"
  const sort = SORTS.includes(body.sort as (typeof SORTS)[number]) ? body.sort! : "clone"
  const loaded = await loadSignals({
    userId: session.sub,
    phase,
    refresh: false,
    options: {
      includedHouseIds: Array.isArray(body.houseIds) ? body.houseIds : undefined,
      fixedSides: body.fixedSides ?? {},
      manualOdds: body.manualOdds ?? {},
      autoMarketHouseIds: Array.isArray(body.autoMarketHouseIds) ? body.autoMarketHouseIds : [],
      pinnedHouseId: body.pinnedHouseId || null,
      market: body.market || "todos",
      sport: body.sport || "todos",
      competition: body.competition || "todos",
      minProfit: typeof body.minProfit === "number" ? body.minProfit : undefined,
      totalStakeCents: body.totalStakeCents ?? null,
      sort,
    },
  })
  const alerted = await dispatchAlerts(loaded.signals, session.sub)
  const bankroll = await prisma.bankroll.findFirst({ where: { userId: session.sub }, orderBy: { createdAt: "asc" } })
  return NextResponse.json({
    signals: loaded.signals,
    realRows: loaded.realRows,
    totalStakeCents: loaded.totalStakeCents,
    balanceCents: bankroll?.balanceCents ?? 0,
    alerted,
  })
}
