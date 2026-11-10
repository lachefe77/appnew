import Link from "next/link"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings()
  const session = await getSession()
  const pathname = (await headers()).get("x-pathname") ?? "/"

  if (session) {
    const user = await prisma.user.findUnique({ where: { id: session.sub } })
    if (!user || user.bannedAt) redirect("/api/sessao/encerrar")
  }

  const brand = settings.get("brand.name")
  const online = settings.flag("site.online")
  const closed = !online && pathname !== "/entrar"
  const panel = pathname.startsWith("/painel")
  const grant = session
    ? await prisma.userPlan.findFirst({
        where: { userId: session.sub, status: "ativo", endsAt: { gte: new Date() } },
        orderBy: { endsAt: "desc" },
      })
    : null

  return (
    <div className="product flex min-h-screen flex-col bg-pitch text-ink">
      {panel ? null : (
        <SiteHeader
          brand={brand}
          pathname={pathname}
          session={session ? { email: session.email, role: session.role } : null}
          planEndsAt={grant?.endsAt ?? null}
        />
      )}
      <main className="flex-1">
        {closed ? (
          <section className="mx-auto max-w-xl px-4 py-20 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Manutenção</p>
            <h1 className="mt-3 font-display text-6xl uppercase">{settings.get("site.maintenanceTitle")}</h1>
            <p className="mt-4 text-mist">{settings.get("site.maintenanceBody")}</p>
            <Link href="/entrar" className="btn-primary mt-6">
              Entrar
            </Link>
          </section>
        ) : (
          children
        )}
      </main>
      {panel ? null : <SiteFooter text={settings.get("site.footer")} />}
    </div>
  )
}
