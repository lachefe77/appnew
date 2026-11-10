import Link from "next/link"
import { logoutAction } from "@/app/actions/auth"
import { Wordmark } from "@/components/wordmark"
import { formatDate } from "@/lib/format"

const links = [
  { href: "/", label: "Início" },
  { href: "/planos", label: "Planos" },
  { href: "/casas", label: "Casas" },
  { href: "/painel", label: "Painel" },
]

export function SiteHeader({
  brand,
  pathname,
  session,
  planEndsAt = null,
}: {
  brand: string
  pathname: string
  session: { email: string; role: "cliente" | "admin" | "moderador" } | null
  planEndsAt?: Date | null
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-pitch/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" aria-label={brand}>
          <Wordmark name={brand} />
        </Link>
        <nav className="flex items-center gap-1 text-sm" aria-label="Principal">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-2 py-1 ${active ? "text-signal" : "text-mist hover:text-ink"}`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {session ? (
            <>
              <span className="hidden text-right text-sm sm:block">
                <span className="block max-w-[16rem] truncate text-ink">{session.email}</span>
                <span className="block text-xs text-mist">
                  {planEndsAt ? `Plano expira em ${formatDate(planEndsAt)}` : "Sem plano ativo"}
                </span>
              </span>
              {session.role === "admin" || session.role === "moderador" ? (
                <Link className="btn-ghost" href="/admin">
                  Admin
                </Link>
              ) : null}
              <form action={logoutAction}>
                <button className="btn-primary" type="submit">
                  Sair
                </button>
              </form>
            </>
          ) : (
            <>
              <Link className="btn-ghost" href="/entrar">
                Entrar
              </Link>
              <Link className="btn-primary" href="/cadastro">
                Criar conta
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
