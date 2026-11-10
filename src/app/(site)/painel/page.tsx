import Link from "next/link"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { formatDate, formatMoney } from "@/lib/format"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel")
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: {
      bankrolls: true,
      plans: { where: { status: "ativo" }, include: { plan: true }, orderBy: { endsAt: "desc" }, take: 1 },
    },
  })
  if (!user) redirect("/api/sessao/encerrar")
  const [launches, messages] = await Promise.all([
    prisma.stakeLaunch.count({ where: { userId: user.id } }),
    prisma.supportMessage.count({ where: { userId: user.id } }),
  ])
  const plan = user.plans[0]
  const bank = user.bankrolls[0]
  const cards = [
    ["Operações", "Grade de sinais, pré-live e ao vivo.", "/painel/operacoes"],
    ["Gestão de banca", "Saldo, entrada, ajuste e histórico.", "/painel/banca"],
    ["Planilhamento", "Stakes já lançados, em tabela.", "/painel/planilhamento"],
    ["Calculadora", "Confira stake e lucro de duas odds.", "/painel/calculadora"],
    ["Suporte", "Conversa com a moderação.", "/painel/suporte"],
    ["Planos", "O que cada plano libera. Pagamento depois.", "/painel/planos"],
  ]

  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-signal">Dashboard</p>
      <h1 className="mt-1 font-display text-5xl uppercase">{user.name}</h1>
      <p className="mt-2 text-sm text-mist">
        {plan ? `${plan.plan.name} expira em ${formatDate(plan.endsAt)}` : "Sem plano ativo. A grade de sinais fica fechada."}
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-line bg-white p-4">
          <p className="text-xs uppercase text-mist">Banca</p>
          <p className="font-display text-4xl">{formatMoney(bank?.balanceCents ?? 0, bank?.currency ?? "BRL")}</p>
        </article>
        <article className="rounded-2xl border border-line bg-white p-4">
          <p className="text-xs uppercase text-mist">Stakes lançados</p>
          <p className="font-display text-4xl">{launches}</p>
        </article>
        <article className="rounded-2xl border border-line bg-white p-4">
          <p className="text-xs uppercase text-mist">Mensagens no suporte</p>
          <p className="font-display text-4xl">{messages}</p>
        </article>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {cards.map(([title, body, href]) => (
          <Link key={href} href={href} className="rounded-2xl border border-line bg-white p-4 hover:border-[#0e8f4e]">
            <h2 className="font-display text-2xl uppercase">{title}</h2>
            <p className="mt-1 text-sm text-mist">{body}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
