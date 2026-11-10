import Link from "next/link"
import { PlanGrid } from "@/components/plan-grid"
import { prisma } from "@/lib/db"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const settings = await getSettings()
  const plans = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  })
  const notices = settings.flag("site.noticesVisible")
    ? await prisma.notice.findMany({
        where: { published: true, audience: { in: ["todos", "clientes"] } },
        orderBy: { publishedAt: "desc" },
        take: 4,
      })
    : []
  const sports = settings
    .get("home.sports")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  const steps = [1, 2, 3].map((step) => ({
    title: settings.get(`home.step${step}Title`),
    body: settings.get(`home.step${step}Body`),
  }))

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-full bg-[radial-gradient(circle_at_top_right,rgba(30,211,122,0.16),transparent_42%)] md:w-1/2" />
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[1.15fr_0.85fr] md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-signal">{settings.get("home.kicker")}</p>
            <h1 className="mt-3 max-w-xl font-display text-6xl uppercase leading-[0.9] md:text-7xl">
              {settings.get("home.title")}
            </h1>
            <p className="mt-5 max-w-xl text-base text-mist">{settings.get("home.lead")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/cadastro" className="btn-primary">
                Criar conta
              </Link>
              <Link href="/painel" className="btn-ghost">
                Abrir painel
              </Link>
            </div>
          </div>
          <aside className="rounded-2xl border border-line bg-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Painel de sinais</p>
            <p className="mt-3 font-display text-4xl uppercase text-signal">Fechado sem plano</p>
            <p className="mt-3 text-sm text-mist">{settings.get("panel.lockedBody")}</p>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <dt className="text-mist">Conta</dt>
                <dd>Entra</dd>
              </div>
              <div className="flex items-center justify-between border-b border-line pb-3">
                <dt className="text-mist">Sem plano</dt>
                <dd>Grade fechada</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-mist">Plano ativo</dt>
                <dd>Grade liberada</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Esportes em preparação</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {sports.map((sport) => (
            <li key={sport} className="rounded-full border border-line px-3 py-1 text-sm text-ink">
              {sport}
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <article key={step.title} className="rounded-2xl border border-line bg-felt p-5">
              <p className="font-display text-3xl text-signal">0{index + 1}</p>
              <h2 className="mt-2 font-display text-3xl uppercase">{step.title}</h2>
              <p className="mt-2 text-sm text-mist">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="font-display text-5xl uppercase">{settings.get("plans.title")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-mist">{settings.get("plans.lead")}</p>
        <div className="mt-6">
          <PlanGrid plans={plans} note={settings.get("plans.closedNote")} />
        </div>
      </section>

      {notices.length ? (
        <section className="mx-auto max-w-6xl px-4 pb-8">
          <h2 className="font-display text-4xl uppercase">Avisos</h2>
          <div className="mt-4 grid gap-3">
            {notices.map((notice) => (
              <article key={notice.id} className="rounded-2xl border border-line bg-card p-5">
                <h3 className="font-semibold">{notice.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-mist">{notice.body}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
