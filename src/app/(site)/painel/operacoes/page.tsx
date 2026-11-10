import Link from "next/link"
import { redirect } from "next/navigation"
import { SignalBoard } from "@/components/signal-board"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"
import { loadSignals } from "@/server/feed"
import { panelReasonLabel } from "@/server/labels"
import { loadPanelGate } from "@/server/panel-access"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function OperationsPage() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/operacoes")
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { bankrolls: true, stakePresets: { orderBy: { amountCents: "asc" } } },
  })
  if (!user) redirect("/api/sessao/encerrar")
  const settings = await getSettings()
  const gate = await loadPanelGate(user.id)
  if (!gate.open) {
    return (
      <section className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-signal">{panelReasonLabel[gate.reason]}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{settings.get("panel.lockedTitle")}</h1>
        <p className="mt-3 text-sm text-mist">{settings.get("panel.lockedBody")}</p>
        <Link href="/painel/planos" className="btn-primary mt-6">
          Ver planos
        </Link>
      </section>
    )
  }

  const houses = await prisma.house.findMany({ where: { active: true, operable: true }, orderBy: { sortOrder: "asc" } })
  const started = Date.now()
  const loaded = await loadSignals({
    userId: user.id,
    phase: "prelive",
    simulate: false,
    refresh: false,
    options: { sort: "clone", includedHouseIds: houses.map((house) => house.id) },
  })
  await prisma.pageTiming.create({ data: { route: "/painel/operacoes", durationMs: Date.now() - started } })
  const bankroll = user.bankrolls.find((item) => item.currency === "BRL") ?? user.bankrolls[0]
  const realNames = houses.filter((house) => house.feed === "ao_vivo").map((house) => house.name)
  const fallback = settings
    .get("stake.quick")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
  const quickReais = user.stakePresets.length ? user.stakePresets.map((preset) => preset.amountCents / 100) : fallback
  const quickLabels = user.stakePresets.length
    ? user.stakePresets.map((preset) => preset.label || `R$ ${preset.amountCents / 100}`)
    : undefined
  let savedFilters = null
  try {
    savedFilters = user.boardPrefs ? JSON.parse(user.boardPrefs) : null
  } catch {
    savedFilters = null
  }

  return (
    <SignalBoard
      houses={houses.map((house) => ({
        id: house.id,
        slug: house.slug,
        name: house.name,
        logoUrl: house.logoUrl,
        currency: house.currency,
        cloneLabel: house.cloneLabel,
        fixedSide: house.fixedSide,
        feed: house.feed,
      }))}
      initialSignals={loaded.signals}
      initialRealRows={loaded.realRows}
      sourceLine={
        realNames.length
          ? `Fonte real: ${realNames.join(", ")}. As outras casas seguem em odd de teste.`
          : "As casas seguem em odd de teste até a fonte responder."
      }
      balanceCents={bankroll?.balanceCents ?? 0}
      currency={bankroll?.currency ?? "BRL"}
      initialStakeCents={loaded.totalStakeCents}
      pollSeconds={Number(settings.get("signal.pollSeconds").replace(",", ".")) || 3}
      quickReais={quickReais.length ? quickReais : [50, 100, 200, 500]}
      quickLabels={quickLabels}
      savedFilters={savedFilters}
      stakePercent={Number(settings.get("stake.percent").replace(",", ".")) || 10}
      minProfit={Number(settings.get("signal.minProfit").replace(",", ".")) || 0}
      autoMarketIds={houses.filter((house) => house.slug === "pinnacle" || house.slug === "bcgame").map((house) => house.id)}
      launched={(await prisma.stakeLaunch.findMany({ where: { userId: user.id }, select: { signalKey: true } })).map((item) => item.signalKey)}
      entries={[]}
    />
  )
}
