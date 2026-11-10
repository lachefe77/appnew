import Link from "next/link"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { formatMoney } from "@/lib/format"
import { getSession } from "@/lib/session"
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
  const active = user.plans.find((item) => item.status === "ativo")

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Operação</p>
          <h1 className="font-display text-6xl uppercase">Sinais</h1>
          <p className="mt-1 text-sm text-mist">
            {user.name}
            {active ? ` · ${active.plan.name}` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-mist">Banca</p>
          <p className="font-display text-4xl">{formatMoney(bankroll?.balanceCents ?? 0, bankroll?.currency ?? "BRL")}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <input className="field max-w-xs" placeholder="Buscar evento" disabled />
        <button className="btn-ghost" type="button" disabled>
          Todas as casas
        </button>
        <button className="btn-ghost" type="button" disabled>
          Nenhuma
        </button>
      </div>
      <p className="mt-2 text-xs text-mist">{settings.get("panel.filtersNote")}</p>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-felt text-xs uppercase tracking-wide text-mist">
            <tr>
              <th className="px-3 py-3 font-semibold">Esporte</th>
              <th className="px-3 py-3 font-semibold">Evento</th>
              <th className="px-3 py-3 font-semibold">Mercado</th>
              <th className="px-3 py-3 font-semibold">Casa 1</th>
              <th className="px-3 py-3 font-semibold">Casa 2</th>
              <th className="px-3 py-3 font-semibold">Lucro</th>
            </tr>
          </thead>
        </table>
        <div className="px-4 py-14 text-center">
          <h2 className="font-display text-4xl uppercase">{settings.get("panel.emptyTitle")}</h2>
          <p className="mt-2 text-sm text-mist">{settings.get("panel.emptyBody")}</p>
        </div>
      </div>
      {notices.length ? <NoticeList notices={notices} /> : null}
    </section>
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
