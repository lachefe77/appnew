import { redirect } from "next/navigation"
import { bankrollAction } from "@/app/actions/board"
import { prisma } from "@/lib/db"
import { formatDate, formatMoney } from "@/lib/format"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function BankPage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/banca")
  const query = await searchParams
  const { ensureBankroll } = await import("@/server/bankroll")
  await Promise.all(["BRL", "USD", "EUR"].map((currency) => ensureBankroll(session.sub, currency)))
  const banks = await prisma.bankroll.findMany({
    where: { userId: session.sub },
    include: { entries: { orderBy: { createdAt: "desc" }, take: 20 } },
    orderBy: { currency: "asc" },
  })
  const bank = banks.find((item) => item.currency === "BRL") ?? banks[0]

  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Gestão de banca</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {banks.map((item) => (
          <article key={item.id} className="border border-line bg-card p-4">
            <p className="text-xs uppercase text-mist">{item.currency}</p>
            <p className="font-display text-3xl">{formatMoney(item.balanceCents, item.currency)}</p>
          </article>
        ))}
      </div>
      {query.erro ? <p className="mt-3 text-sm text-[#8d2b2b]">{query.erro}</p> : null}
      {query.ok ? <p className="mt-3 text-sm text-[#0c7a45]">Movimento registrado.</p> : null}
      <form action={bankForm} className="mt-6 flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Moeda</span>
          <select className="field" name="currency" defaultValue="BRL">
            <option value="BRL">BRL</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <label>
          <span className="label">Valor</span>
          <input className="field w-36" name="amount" required placeholder="100,00" />
        </label>
        <button className="btn-primary" name="kind" value="entrada" type="submit">
          Entrada
        </button>
        <button className="btn-ghost" name="kind" value="ajuste" type="submit">
          Tirar ajuste
        </button>
      </form>
      <div className="sheet mt-6">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Tipo</th>
              <th>Valor</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {(bank?.entries ?? []).map((entry) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.createdAt)}</td>
                <td>{entry.kind}</td>
                <td>{formatMoney(entry.amountCents, bank?.currency ?? "BRL")}</td>
                <td>{entry.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

async function bankForm(formData: FormData) {
  "use server"
  const { redirect } = await import("next/navigation")
  const { centsFromInput } = await import("@/server/parse")
  const cents = centsFromInput(String(formData.get("amount") ?? ""))
  const currency = String(formData.get("currency") ?? "BRL")
  const kind = String(formData.get("kind") ?? "") === "ajuste" ? "ajuste" : "entrada"
  if (cents == null) {
    redirect("/painel/banca?erro=Informe%20o%20valor.")
    return
  }
  const result = await bankrollAction({
    kind,
    amountCents: kind === "ajuste" ? -Math.abs(cents) : cents,
    note: kind === "entrada" ? "Entrada" : "Ajuste",
    currency,
  })
  if (!result.ok) redirect(`/painel/banca?erro=${encodeURIComponent(result.error)}`)
  redirect("/painel/banca?ok=1")
}
