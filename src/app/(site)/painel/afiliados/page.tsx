import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { formatDate, formatMoney } from "@/lib/format"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function AffiliatePanelPage() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/afiliados")
  const headerList = await headers()
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost"
  const proto = headerList.get("x-forwarded-proto") ?? "http"
  const affiliate = await prisma.affiliate.findUnique({
    where: { userId: session.sub },
    include: { commissions: { orderBy: { createdAt: "desc" }, take: 30 } },
  })
  if (!affiliate) {
    return (
      <section className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Afiliados</h1>
        <p className="mt-3 text-sm leading-6 text-mist">
          Sua conta ainda não está no programa. A administração cria o código e liga o seu e-mail. Quando isso acontecer,
          o código, o link, os indicados e a comissão aparecem aqui.
        </p>
      </section>
    )
  }
  const indicated = await prisma.user.findMany({
    where: { referredByCode: affiliate.code },
    orderBy: { createdAt: "desc" },
    take: 50,
  })
  const total = affiliate.commissions.reduce((sum, item) => sum + item.amountCents, 0)
  const link = `${proto}://${host}/cadastro?indicacao=${encodeURIComponent(affiliate.code)}`

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-signal">Programa</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{affiliate.name}</h1>
      <p className="mt-2 text-sm text-mist">
        {affiliate.active ? "Ativo" : "Inativo"} · comissão de {affiliate.commissionPercent}%
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <article className="border border-line bg-card p-4">
          <p className="text-xs text-mist">Código</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{affiliate.code}</p>
        </article>
        <article className="border border-line bg-card p-4">
          <p className="text-xs text-mist">Indicados</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{indicated.length}</p>
        </article>
        <article className="border border-line bg-card p-4">
          <p className="text-xs text-mist">Comissão registrada</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-signal">{formatMoney(total)}</p>
        </article>
      </div>
      <label className="mt-6 block max-w-xl">
        <span className="label">Link de indicação</span>
        <input className="field" readOnly value={link} />
      </label>
      <h2 className="mt-8 text-lg font-semibold">Contas indicadas</h2>
      <div className="sheet mt-3">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Desde</th>
            </tr>
          </thead>
          <tbody>
            {indicated.map((person) => (
              <tr key={person.id}>
                <td>{person.name}</td>
                <td>{person.email}</td>
                <td>{formatDate(person.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!indicated.length ? <p className="mt-3 text-sm text-mist">Nenhuma conta usou o seu código ainda.</p> : null}
      <h2 className="mt-8 text-lg font-semibold">Comissões</h2>
      <div className="sheet mt-3">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Valor</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {affiliate.commissions.map((item) => (
              <tr key={item.id}>
                <td>{formatDate(item.createdAt)}</td>
                <td>{formatMoney(item.amountCents)}</td>
                <td>{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!affiliate.commissions.length ? <p className="mt-3 text-sm text-mist">Nenhuma comissão lançada.</p> : null}
    </section>
  )
}
