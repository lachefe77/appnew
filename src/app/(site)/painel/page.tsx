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

export default async function PanelPage() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel")
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { bankrolls: true, plans: { include: { plan: true }, orderBy: { createdAt: "desc" } } },
  })
  if (!user) redirect("/api/sessao/encerrar")

  const settings = await getSettings()
  const gate = await loadPanelGate(user.id)
  const notices = settings.flag("site.noticesVisible")
    ? await prisma.notice.findMany({
        where: { published: true, audience: { in: ["todos", "painel"] } },
        orderBy: { publishedAt: "desc" },
        take: 3,
      })
    : []

  if (!gate.open) {
    const reason = panelReasonLabel[gate.reason]
    return (
      <section className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-16">
        <div className="rounded-2xl border border-line bg-card px-6 py-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">{reason}</p>
          <h1 className="mt-3 font-display text-6xl uppercase">{settings.get("panel.lockedTitle")}</h1>
          <p className="mt-4 text-mist">{settings.get("panel.lockedBody")}</p>
          <p className="mt-6 text-sm text-mist">
            Conta de {user.name}. {reason}.
          </p>
          <Link href="/planos" className="btn-primary mt-6">
            Ver planos
          </Link>
        </div>
        {notices.length ? <NoticeList notices={notices} /> : null}
      </section>
    )
  }

  const bankroll = user.bankrolls[0]
  const houses = await prisma.house.findMany({
    where: { active: true, operable: true },
    orderBy: { sortOrder: "asc" },
  })
  const autoMarketIds = houses.filter((house) => house.slug === "pinnacle" || house.slug === "bcgame").map((house) => house.id)
  const loaded = await loadSignals({
    userId: user.id,
    phase: "prelive",
    simulate: false,
    refresh: true,
    options: {
      includedHouseIds: houses.map((house) => house.id),
      autoMarketHouseIds: autoMarketIds,
      sort: "clone",
    },
  })
  const entries = bankroll
    ? await prisma.bankrollEntry.findMany({
        where: { bankrollId: bankroll.id },
        orderBy: { createdAt: "desc" },
        take: 6,
      })
    : []
  const launches = await prisma.stakeLaunch.findMany({ where: { userId: user.id }, select: { signalKey: true } })
  const quickReais = settings
    .get("stake.quick")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
  const stakePercent = Number(settings.get("stake.percent").replace(",", ".")) || 10
  const minProfit = Number(settings.get("signal.minProfit").replace(",", ".")) || 0
  const pollSeconds = Number(settings.get("signal.pollSeconds").replace(",", ".")) || 3

  return (
    <>
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
        balanceCents={bankroll?.balanceCents ?? 0}
        currency={bankroll?.currency ?? "BRL"}
        initialStakeCents={loaded.totalStakeCents}
        pollSeconds={pollSeconds}
        quickReais={quickReais.length ? quickReais : [50, 100, 200, 500]}
        stakePercent={stakePercent}
        minProfit={minProfit}
        autoMarketIds={autoMarketIds}
        launched={launches.map((item) => item.signalKey)}
        entries={entries.map((entry) => ({
          id: entry.id,
          amountCents: entry.amountCents,
          kind: entry.kind,
          note: entry.note,
          createdAt: entry.createdAt.toISOString(),
        }))}
      />
      {notices.length ? (
        <div className="mx-auto max-w-6xl px-4 pb-8">
          <NoticeList notices={notices} />
        </div>
      ) : null}
    </>
  )
}

function NoticeList({ notices }: { notices: { id: string; title: string; body: string }[] }) {
  return (
    <div className="mt-8 space-y-3">
      {notices.map((notice) => (
        <article key={notice.id} className="rounded-2xl border border-line bg-card p-4 text-left">
          <h2 className="font-semibold">{notice.title}</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-mist">{notice.body}</p>
        </article>
      ))}
    </div>
  )
}
