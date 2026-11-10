import Link from "next/link"
import { redirect } from "next/navigation"
import { logoutAction } from "@/app/actions/auth"
import { PanelNav } from "@/components/panel-nav"
import { Wordmark } from "@/components/wordmark"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { getSession } from "@/lib/session"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect("/entrar?next=/painel")
  const [settings, grant, user] = await Promise.all([
    getSettings(),
    prisma.userPlan.findFirst({
      where: { userId: session.sub, status: "ativo", endsAt: { gte: new Date() } },
      include: { plan: true },
      orderBy: { endsAt: "desc" },
    }),
    prisma.user.findUnique({ where: { id: session.sub } }),
  ])
  const warnDays = Number(settings.get("plan.warnDays").replace(",", ".")) || 3
  const warnMs = warnDays * 24 * 60 * 60 * 1000

  return (
    <div className="min-h-screen bg-pitch text-ink md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-felt md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="border-b border-line px-4 py-4">
          <Link href="/painel" aria-label={settings.get("brand.name")}>
            <Wordmark name={settings.get("brand.name")} />
          </Link>
        </div>
        <PanelNav />
      </aside>
      <div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-line bg-pitch px-4 py-3">
          <p className="mr-auto text-sm">
            <span className="font-semibold">{session.email}</span>
            <span className="mt-0.5 block text-xs text-mist">
              {grant ? `${grant.plan.name} · Plano expira em ${formatDate(grant.endsAt)}` : "Sem plano ativo"}
            </span>
          </p>
          {session.role === "admin" ? (
            <Link href="/admin" className="btn-ghost">
              Admin
            </Link>
          ) : null}
          <form action={logoutAction}>
            <button className="btn-primary" type="submit">
              Sair
            </button>
          </form>
        </div>
        {grant && grant.endsAt.getTime() - Date.now() < warnMs ? (
          <p className="border-b border-line bg-[#2a2418] px-4 py-2 text-sm text-signal">
            Seu plano {grant.plan.name} expira em {formatDate(grant.endsAt)}.
          </p>
        ) : null}
        {user && !user.emailVerifiedAt ? (
          <p className="border-b border-line bg-felt px-4 py-2 text-sm text-mist">
            Confirme o e-mail. O link fica no correio da administração enquanto o envio externo não está configurado.
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}
