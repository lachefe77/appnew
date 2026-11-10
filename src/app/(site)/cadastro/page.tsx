import Link from "next/link"
import { registerAction } from "@/app/actions/auth"
import { Flash } from "@/components/flash"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; indicacao?: string }>
}) {
  const query = await searchParams
  const settings = await getSettings()
  const open = settings.flag("site.registrationOpen")

  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">{settings.get("brand.name")}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Criar conta</h1>
      <p className="mt-2 text-sm text-mist">{open ? settings.get("auth.registerLead") : settings.get("auth.registerClosed")}</p>
      <div className="mt-6">
        <Flash erro={query.erro} />
      </div>
      {open ? (
        <form action={registerAction} className="space-y-4 rounded-2xl border border-line bg-card p-6">
          <label className="block">
            <span className="label">Nome</span>
            <input className="field" name="name" autoComplete="name" required minLength={2} />
          </label>
          <label className="block">
            <span className="label">E-mail</span>
            <input className="field" name="email" type="email" autoComplete="email" required />
          </label>
          <label className="block">
            <span className="label">Senha</span>
            <input className="field" name="password" type="password" autoComplete="new-password" required minLength={8} />
          </label>
          <label className="block">
            <span className="label">Confirmar senha</span>
            <input className="field" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
          </label>
          <label className="block">
            <span className="label">Código de indicação</span>
            <input className="field" name="referral" autoComplete="off" defaultValue={query.indicacao ?? ""} />
          </label>
          <button className="btn-primary w-full" type="submit">
            Cadastrar
          </button>
        </form>
      ) : null}
      <p className="mt-4 text-sm text-mist">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-semibold text-signal">
          Entrar
        </Link>
      </p>
    </section>
  )
}
