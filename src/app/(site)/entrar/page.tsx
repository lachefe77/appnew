import Link from "next/link"
import { loginAction } from "@/app/actions/auth"
import { Flash } from "@/components/flash"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; next?: string }>
}) {
  const query = await searchParams
  const settings = await getSettings()
  const next = query.next?.startsWith("/") ? query.next : ""

  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">{settings.get("brand.name")}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Entrar</h1>
      <p className="mt-2 text-sm text-mist">{settings.get("auth.loginLead")}</p>
      {!settings.flag("site.online") ? (
        <p className="mt-4 text-sm text-mist">A casa está fechada para o público. A administração entra por aqui.</p>
      ) : null}
      <div className="mt-6">
        <Flash erro={query.erro} />
      </div>
      <form action={loginAction} className="space-y-4 rounded-2xl border border-line bg-card p-6">
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="label">E-mail</span>
          <input className="field" name="email" type="email" autoComplete="email" required />
        </label>
        <label className="block">
          <span className="label">Senha</span>
          <input className="field" name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn-primary w-full" type="submit">
          Entrar
        </button>
      </form>
      <p className="mt-4 text-sm text-mist">
        <Link href="/recuperar" className="font-semibold text-signal">Esqueci a senha</Link>
        {" · "}
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="font-semibold text-signal">
          Cadastre-se
        </Link>
      </p>
    </section>
  )
}
