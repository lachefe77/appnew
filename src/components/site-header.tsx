import Link from "next/link"
import { logoutAction } from "@/app/actions/auth"
import { Wordmark } from "@/components/wordmark"

const links = [
  { href: "/", label: "Início" },
  { href: "/planos", label: "Planos" },
  { href: "/painel", label: "Painel" },
]

export function SiteHeader({
  brand,
  pathname,
  session,
}: {
  brand: string
  pathname: string
  session: { email: string; role: "cliente" | "admin" } | null
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-pitch/95 backdrop-blur">
      <div className="h-1 bg-signal" />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Link href="/" aria-label={brand}>
          <Wordmark name={brand} />
        </Link>
        <nav className="flex items-center gap-1 text-sm font-semibold" aria-label="Principal">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-2 ${active ? "bg-white/10 text-ink" : "text-mist hover:bg-white/5 hover:text-ink"}`}
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
              <span className="hidden max-w-[14rem] truncate text-sm text-mist sm:inline-block">{session.email}</span>
              {session.role === "admin" ? (
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
                Cadastrar
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
