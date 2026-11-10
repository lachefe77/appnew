import { PlanGrid } from "@/components/plan-grid"
import { prisma } from "@/lib/db"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function PlansPage() {
  const settings = await getSettings()
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })
  return (
    <section className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="font-display text-6xl uppercase">{settings.get("plans.title")}</h1>
      <p className="mt-3 max-w-2xl text-mist">{settings.get("plans.lead")}</p>
      <div className="mt-8">
        <PlanGrid plans={plans} note={settings.get("plans.closedNote")} />
      </div>
    </section>
  )
}
