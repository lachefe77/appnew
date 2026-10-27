import Link from "next/link";
import { currentUser } from "@/server/auth";
import { LogoutButton } from "@/components/logout-button";

export async function Header() {
  const user = await currentUser();
  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-pine font-display text-sm text-paper">NH</span>
          <span>
            <span className="block font-display text-lg leading-none">Novos Horizontes</span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted">Atacado unitário</span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm">
          <Link href="/" className="hover:text-copper">Vitrine</Link>
          <Link href="/revenda" className="hover:text-copper">Revenda</Link>
          {user?.role === "ADMIN" ? <Link href="/admin" className="hover:text-copper">Operação</Link> : null}
          {user && user.role !== "CUSTOMER" ? <Link href="/painel" className="hover:text-copper">Painel</Link> : null}
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
