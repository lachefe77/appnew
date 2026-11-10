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
    <header className="sticky top-0 z-20 border-b border-black bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
        <Link href="/" aria-label={brand}>
          <Wordmark name={brand} />
        </Link>
        <nav className="flex items-center gap-4 text-sm" aria-label="Principal">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? "text-black" : "text-black/55 hover:text-black"}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {session ? (
            <>
              <span className="hidden text-right text-sm sm:block">
                <span className="block max-w-[16rem] truncate">{session.email}</span>
                <span className="block text-xs text-black/55">
                  {planEndsAt ? `Plano expira em ${formatDate(planEndsAt)}` : "Sem plano ativo"}
                </span>
              </span>
              {session.role === "admin" || session.role === "moderador" ? (
                <Link className="border border-black px-3 py-2 text-sm" href="/admin">
                  Admin
                </Link>
              ) : null}
              <form action={logoutAction}>
                <button className="bg-black px-4 py-2 text-sm text-white" type="submit">
                  Sair
                </button>
              </form>
            </>
          ) : (
            <>
              <Link className="px-2 py-2 text-sm" href="/entrar">
                Entrar
              </Link>
              <Link className="bg-black px-4 py-2 text-sm text-white" href="/cadastro">
                Criar conta
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
