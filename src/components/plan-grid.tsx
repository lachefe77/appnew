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
    <div className="grid gap-3 md:grid-cols-3">
      {plans.map((plan, index) => (
        <article
          key={plan.id}
          className={`flex flex-col border p-5 ${index === 1 ? "border-signal bg-felt" : "border-line bg-card"}`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">
            {index === 1 ? "Mais usado" : "Plano"}
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">{plan.name}</h3>
          <p className="mt-2 flex-1 text-sm leading-6 text-mist">{plan.description}</p>
          <p className="mt-6 text-3xl font-semibold tracking-tight text-signal">{formatMoney(plan.priceCents, plan.currency)}</p>
          <p className="text-sm text-mist">{plan.durationDays} dias de grade</p>
          <p className="mt-4 text-sm text-mist">{note}</p>
          <Link href="/cadastro" className={index === 1 ? "btn-primary mt-4" : "btn-ghost mt-4"}>
            Criar conta
          </Link>
        </article>
      ))}
    </div>
  )
}
