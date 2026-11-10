import { resetPasswordAction } from "@/app/actions/auth"

export const dynamic = "force-dynamic"

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ erro?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-5xl uppercase">Nova senha</h1>
      {query.erro ? <p className="mt-4 text-sm text-[#8d2b2b]">{query.erro}</p> : null}
      <form action={resetPasswordAction} className="mt-6 space-y-4 rounded-2xl border border-line bg-white p-6">
        <input type="hidden" name="token" value={token} />
        <label className="block">
          <span className="label">Nova senha</span>
          <input className="field" name="password" type="password" minLength={8} required />
        </label>
        <button className="btn-primary" type="submit">
          Salvar senha
        </button>
      </form>
    </section>
  )
}
