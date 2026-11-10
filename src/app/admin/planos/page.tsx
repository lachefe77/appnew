import { updatePlanAction } from "@/app/actions/admin"
import { AdminHeading } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatMoney } from "@/lib/format"

export const dynamic = "force-dynamic"

function reais(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",")
}

export default async function PlansAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>
}) {
  const query = await searchParams
  const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" } })
  return (
    <>
      <AdminHeading title="Planos e preços" lede="Nome, preço, duração e se o plano pode ser concedido." />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      <div className="grid gap-4">
        {plans.map((plan) => (
          <form key={plan.id} action={updatePlanAction} className="panel grid gap-3 md:grid-cols-2">
            <input type="hidden" name="planId" value={plan.id} />
            <p className="text-sm text-black/50 md:col-span-2">
              {plan.slug} · hoje {formatMoney(plan.priceCents, plan.currency)}
            </p>
            <label>
              <span className="label-light">Nome</span>
              <input className="field-light" name="name" defaultValue={plan.name} required />
            </label>
            <label>
              <span className="label-light">Preço (R$)</span>
              <input className="field-light" name="price" defaultValue={reais(plan.priceCents)} required />
            </label>
            <label className="md:col-span-2">
              <span className="label-light">Descrição</span>
              <input className="field-light" name="description" defaultValue={plan.description} required />
            </label>
            <label>
              <span className="label-light">Duração (dias)</span>
              <input className="field-light" name="days" defaultValue={plan.durationDays} required />
            </label>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" name="active" value="true" defaultChecked={plan.active} />
              Ativo para concessão e vitrine
            </label>
            <div>
              <button className="btn-admin" type="submit">
                Salvar plano
              </button>
            </div>
          </form>
        ))}
      </div>
    </>
  )
}
