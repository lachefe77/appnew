import Link from "next/link"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { formatDate, formatMoney } from "@/lib/format"
import { getSession } from "@/lib/session"
import { expectedProfit, realizedProfit, startOfDay, startOfMonth, startOfWeek } from "@/server/sheet"

export const dynamic = "force-dynamic"

export default async function SheetPage() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/planilhamento")
  const rows = await prisma.stakeLaunch.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  const now = new Date()
  const periods = [
    ["Hoje", startOfDay(now)],
    ["Semana", startOfWeek(now)],
    ["Mês", startOfMonth(now)],
  ] as const
  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Planilhamento automático</h1>
      <p className="mt-2 text-sm text-mist">Cada stake lançado em Operações entra aqui uma vez. O resultado você marca depois do jogo.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {periods.map(([label, since]) => (
          <article key={label} className="border border-line bg-card p-4">
            <p className="text-xs uppercase text-mist">{label}</p>
            <p className="font-semibold">Realizado {formatMoney(realizedProfit(rows, since))}</p>
            <p className="text-sm text-mist">Previsto {formatMoney(expectedProfit(rows, since))}</p>
          </article>
        ))}
      </div>
      <p className="mt-4">
        <Link className="btn-ghost" href="/api/planilha">
          Exportar CSV
        </Link>
      </p>
      <div className="sheet mt-6">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Sinal</th>
              <th>Stake</th>
              <th>Lucro previsto</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.createdAt)}</td>
                <td>{row.note}</td>
                <td>{formatMoney(row.amountCents)}</td>
                <td>{formatMoney(row.profitCents)}</td>
                <td>
                  <form action={settleStake} className="flex gap-1">
                    <input type="hidden" name="id" value={row.id} />
                    <select className="field" name="result" defaultValue={row.result}>
                      <option value="pendente">Pendente</option>
                      <option value="ganhou">Ganhou</option>
                      <option value="perdeu">Perdeu</option>
                      <option value="anulou">Anulou</option>
                    </select>
                    <button className="btn-ghost" type="submit">
                      Salvar
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="mt-4 text-sm text-mist">Nenhum stake lançado ainda.</p> : null}
    </section>
  )
}

async function settleStake(formData: FormData) {
  "use server"
  const session = await getSession()
  if (!session) redirect("/entrar")
  const result = String(formData.get("result") ?? "")
  if (!["pendente", "ganhou", "perdeu", "anulou"].includes(result)) redirect("/painel/planilhamento")
  await prisma.stakeLaunch.updateMany({
    where: { id: String(formData.get("id") ?? ""), userId: session.sub },
    data: { result, settledAt: result === "pendente" ? null : new Date() },
  })
  redirect("/painel/planilhamento")
}
