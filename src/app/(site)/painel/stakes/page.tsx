import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { formatMoney } from "@/lib/format"
import { getSession } from "@/lib/session"
import { centsFromInput } from "@/server/parse"

export const dynamic = "force-dynamic"

export default async function StakesPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel/stakes")
  const query = await searchParams
  const presets = await prisma.stakePreset.findMany({ where: { userId: session.sub }, orderBy: { amountCents: "asc" } })
  return (
    <section className="mx-auto max-w-xl px-4 py-8">
      <h1 className="font-display text-5xl uppercase">Stakes pré-definidas</h1>
      <p className="mt-2 text-sm text-mist">Valores prontos da sua conta. Em Operações, os atalhos do admin continuam disponíveis.</p>
      {query.erro ? <p className="mt-3 text-sm text-[#8d2b2b]">{query.erro}</p> : null}
      <ul className="mt-6 space-y-2">
        {presets.map((preset) => (
          <li key={preset.id} className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
            <span className="font-semibold">{preset.label || "Stake"} · {formatMoney(preset.amountCents)}</span>
            <form action={removePreset}>
              <input type="hidden" name="id" value={preset.id} />
              <button className="btn-ghost" type="submit">
                Remover
              </button>
            </form>
          </li>
        ))}
      </ul>
      {!presets.length ? <p className="mt-4 text-sm text-mist">Nenhum valor salvo.</p> : null}
      <form action={addPreset} className="mt-6 flex items-end gap-2">
        <label className="flex-1">
          <span className="label">Nome</span>
          <input className="field" name="label" placeholder="Jogo médio" />
        </label>
        <label className="flex-1">
          <span className="label">Novo valor (R$)</span>
          <input className="field" name="amount" required placeholder="150,00" />
        </label>
        <button className="btn-primary" type="submit">
          Salvar
        </button>
      </form>
    </section>
  )
}

async function addPreset(formData: FormData) {
  "use server"
  const session = await getSession()
  if (!session) redirect("/entrar")
  const cents = centsFromInput(String(formData.get("amount") ?? ""))
  if (cents == null || cents <= 0) redirect("/painel/stakes?erro=Informe%20um%20valor.")
  await prisma.stakePreset.create({
    data: { userId: session.sub, amountCents: cents, label: String(formData.get("label") ?? "").trim().slice(0, 40) },
  })
  redirect("/painel/stakes")
}

async function removePreset(formData: FormData) {
  "use server"
  const session = await getSession()
  if (!session) redirect("/entrar")
  await prisma.stakePreset.deleteMany({ where: { id: String(formData.get("id") ?? ""), userId: session.sub } })
  redirect("/painel/stakes")
}
