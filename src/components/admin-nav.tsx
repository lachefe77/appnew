"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Wordmark } from "@/components/wordmark"

const items = [
  { href: "/admin", label: "Geral" },
  { href: "/admin/vendas", label: "Vendas e pedidos" },
  { href: "/admin/usuarios", label: "Usuários" },
  { href: "/admin/planos", label: "Planos e preços" },
  { href: "/admin/casas", label: "Casas" },
  { href: "/admin/pagamentos", label: "Pagamentos" },
  { href: "/admin/afiliados", label: "Afiliados e cupons" },
  { href: "/admin/suporte", label: "Suporte" },
  { href: "/admin/avisos", label: "Avisos" },
  { href: "/admin/auditoria", label: "Auditoria" },
  { href: "/admin/status", label: "Status do site" },
  { href: "/admin/configuracao", label: "Configuração" },
]

export function AdminNav({ brand }: { brand: string }) {
  const pathname = usePathname()
  return (
    <aside className="bg-rail text-white md:sticky md:top-0 md:flex md:h-screen md:flex-col md:overflow-y-auto">
      <div className="border-b border-white/10 px-4 py-4">
        <Link href="/admin" aria-label={brand}>
          <Wordmark name={brand} tone="light" />
        </Link>
        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-white/50">Administração</p>
      </div>
      <nav className="flex flex-col gap-1 p-3" aria-label="Administração">
        {items.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${
                active ? "bg-white/10 text-signal" : "text-white/75 hover:bg-white/5 hover:text-white"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
