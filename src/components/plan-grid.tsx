import Link from "next/link"
import { formatMoney } from "@/lib/format"

export type PublicPlan = {
  id: string
  name: string
  description: string
  priceCents: number
  currency: string
  durationDays: number
}

export function PlanGrid({ plans, note }: { plans: PublicPlan[]; note: string }) {
  if (!plans.length) {
    return <p className="text-sm text-mist">Nenhum plano ativo no momento.</p>
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((plan) => (
        <article key={plan.id} className="flex flex-col rounded-2xl border border-line bg-card p-6">
          <h3 className="font-display text-3xl uppercase tracking-wide">{plan.name}</h3>
          <p className="mt-2 flex-1 text-sm text-mist">{plan.description}</p>
          <p className="mt-6 font-display text-5xl text-signal">{formatMoney(plan.priceCents, plan.currency)}</p>
          <p className="text-sm text-mist">{plan.durationDays} dias</p>
          <p className="mt-4 text-sm text-mist">{note}</p>
          <Link href="/cadastro" className="btn-ghost mt-4">
            Criar conta
          </Link>
        </article>
      ))}
    </div>
  )
}
