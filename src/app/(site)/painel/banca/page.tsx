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
  const bank = await prisma.bankroll.findFirst({
    where: { userId: session.sub },
    include: { entries: { orderBy: { createdAt: "desc" }, take: 30 } },
  })

  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-5xl uppercase">Gestão de banca</h1>
      <p className="mt-2 font-display text-4xl text-signal">{formatMoney(bank?.balanceCents ?? 0, bank?.currency ?? "BRL")}</p>
      {query.erro ? <p className="mt-3 text-sm text-[#8d2b2b]">{query.erro}</p> : null}
      {query.ok ? <p className="mt-3 text-sm text-[#0c7a45]">Movimento registrado.</p> : null}
      <form action={bankForm} className="mt-6 flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Valor (R$)</span>
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
  const kind = String(formData.get("kind") ?? "") === "ajuste" ? "ajuste" : "entrada"
  if (cents == null) {
    redirect("/painel/banca?erro=Informe%20o%20valor.")
    return
  }
  const result = await bankrollAction({
    kind,
    amountCents: kind === "ajuste" ? -Math.abs(cents) : cents,
    note: kind === "entrada" ? "Entrada" : "Ajuste",
  })
  if (!result.ok) redirect(`/painel/banca?erro=${encodeURIComponent(result.error)}`)
  redirect("/painel/banca?ok=1")
}
