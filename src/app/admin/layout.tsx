import Link from "next/link"
import { logoutAction } from "@/app/actions/auth"
import { AdminNav } from "@/components/admin-nav"
import { requireAdmin } from "@/lib/session"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  const settings = await getSettings()
  return (
    <div className="backoffice min-h-screen bg-[#e7ece9] text-rail md:grid md:grid-cols-[240px_1fr]">
      <AdminNav brand={settings.get("brand.name")} />
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 md:px-8">
          <p className="text-sm text-black/70">{admin.email}</p>
          <div className="flex gap-2">
            <Link href="/" className="btn-admin-ghost">
              Ver o site
            </Link>
            <form action={logoutAction}>
              <button className="btn-admin-ghost" type="submit">
                Sair
              </button>
            </form>
          </div>
        </div>
        <div className="px-4 py-6 md:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      </div>
    </div>
  )
}
