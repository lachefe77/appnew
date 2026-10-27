import Link from "next/link";
import { currentUser } from "@/server/auth";
import { getBrand } from "@/server/brand";
import { isStaff } from "@/server/roles";
import { LogoutButton } from "@/components/logout-button";

export async function Header() {
  const [user, brand] = await Promise.all([currentUser(), getBrand()]);
  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-pine text-sm font-semibold text-paper">{brand.mark}</span>
          <span>
            <span className="block text-lg font-semibold leading-none">{brand.name}</span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted">{brand.tagline}</span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm">
          <Link href="/" className="hover:text-copper">Vitrine</Link>
          <Link href="/revenda" className="hover:text-copper">Revenda</Link>
          <Link href="/carrinho" className="hover:text-copper">Carrinho</Link>
          <Link href="/suporte" className="hover:text-copper">Suporte</Link>
          {user && isStaff(user.role) ? <Link href="/admin" className="hover:text-copper">Admin</Link> : null}
          {user && (user.role === "RESELLER" || user.role === "ADMIN" || user.role === "MASTER") ? <Link href="/painel" className="hover:text-copper">Painel</Link> : null}
          {user && user.role === "CUSTOMER" ? <Link href="/conta" className="hover:text-copper">Conta</Link> : null}
          {user ? (
            <>
              <span className="hidden text-muted sm:inline">{user.name.split(" ")[0]}</span>
              <LogoutButton />
            </>
          ) : (
            <Link href="/entrar" className="rounded-full bg-ink px-3 py-1.5 text-paper">Entrar</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
