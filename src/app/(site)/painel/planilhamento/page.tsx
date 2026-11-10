import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { formatDate, formatMoney } from "@/lib/format"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function SheetPage() {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/planilhamento")
  const rows = await prisma.stakeLaunch.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-5xl uppercase">Planilhamento automático</h1>
      <p className="mt-2 text-sm text-mist">Cada stake lançado em Operações entra aqui uma vez. Não há linha duplicada.</p>
      <div className="sheet mt-6">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Sinal</th>
              <th>Stake</th>
              <th>Lucro previsto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.createdAt)}</td>
                <td>{row.note}</td>
                <td>{formatMoney(row.amountCents)}</td>
                <td>{formatMoney(row.profitCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="mt-4 text-sm text-mist">Nenhum stake lançado ainda.</p> : null}
    </section>
  )
}
