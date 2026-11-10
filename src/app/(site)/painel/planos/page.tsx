import { redirect } from "next/navigation"
import { PlanGrid } from "@/components/plan-grid"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { getSession } from "@/lib/session"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function PanelPlansPage() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/planos")
  const [settings, plans, grant] = await Promise.all([
    getSettings(),
    prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.userPlan.findFirst({
      where: { userId: session.sub, status: "ativo", endsAt: { gte: new Date() } },
      include: { plan: true },
      orderBy: { endsAt: "desc" },
    }),
  ])
  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-5xl uppercase">Planos</h1>
      <p className="mt-2 max-w-2xl text-sm text-mist">
        {grant
          ? `Seu plano ${grant.plan.name} expira em ${formatDate(grant.endsAt)}.`
          : "Você ainda não tem plano ativo. A grade fica fechada até a administração conceder um."}
      </p>
      <p className="mt-2 max-w-2xl text-sm text-mist">O pagamento por Pix e cripto não abre nesta versão. A compra continua fechada.</p>
      <div className="mt-6">
        <PlanGrid plans={plans} note="Pagamento na próxima etapa." />
      </div>
      <p className="mt-6 text-sm text-mist">{settings.get("plans.lead")}</p>
    </section>
  )
}
