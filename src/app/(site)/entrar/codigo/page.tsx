import { totpAction } from "@/app/actions/auth"

export const dynamic = "force-dynamic"

export default async function TotpPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const query = await searchParams
  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Código</h1>
      <p className="mt-2 text-sm text-mist">A conta de administração pediu o segundo fator.</p>
      {query.erro ? <p className="mt-4 text-sm text-[#8d2b2b]">{query.erro}</p> : null}
      <form action={totpAction} className="mt-6 space-y-4 border border-line bg-card p-6">
        <label className="block">
          <span className="label">Código de 6 dígitos</span>
          <input className="field" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </label>
        <button className="btn-primary" type="submit">
          Entrar
        </button>
      </form>
    </section>
  )
}
