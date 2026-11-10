import { recoverAction } from "@/app/actions/auth"

export const dynamic = "force-dynamic"

export default async function RecoverPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const query = await searchParams
  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Recuperar senha</h1>
      <p className="mt-2 text-sm text-mist">
        Se o e-mail existir, o link fica no correio da administração até o envio externo ser configurado.
      </p>
      {query.ok ? <p className="mt-4 text-sm text-[#0c7a45]">Se a conta existir, o link foi gerado.</p> : null}
      <form action={recoverAction} className="mt-6 space-y-4 border border-line bg-card p-6">
        <label className="block">
          <span className="label">E-mail</span>
          <input className="field" name="email" type="email" required />
        </label>
        <button className="btn-primary" type="submit">
          Gerar link
        </button>
      </form>
    </section>
  )
}
