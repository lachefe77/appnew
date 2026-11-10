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
  const [settings, grant] = await Promise.all([
    getSettings(),
    prisma.userPlan.findFirst({
      where: { userId: session.sub, status: "ativo", endsAt: { gte: new Date() } },
      include: { plan: true },
      orderBy: { endsAt: "desc" },
    }),
  ])

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-white md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="border-b border-line px-4 py-4">
          <Link href="/painel" aria-label={settings.get("brand.name")}>
            <Wordmark name={settings.get("brand.name")} />
          </Link>
        </div>
        <PanelNav />
      </aside>
      <div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-line bg-white px-4 py-3">
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
        {children}
      </div>
    </div>
  )
}
