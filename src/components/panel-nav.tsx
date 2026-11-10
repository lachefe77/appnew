"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const items = [
  { href: "/painel", label: "Dashboard" },
  { href: "/painel/operacoes", label: "Operações" },
  { href: "/painel/banca", label: "Gestão de banca" },
  { href: "/painel/planilhamento", label: "Planilhamento" },
  { href: "/painel/stakes", label: "Stakes" },
  { href: "/painel/calculadora", label: "Calculadora" },
  { href: "/painel/suporte", label: "Suporte" },
  { href: "/painel/afiliados", label: "Afiliados" },
  { href: "/painel/planos", label: "Planos" },
]

export function PanelNav() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-3" aria-label="Painel">
      {items.map((item) => {
        const active = item.href === "/painel" ? pathname === "/painel" : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap border-l-2 px-3 py-2 text-sm ${
              active ? "border-signal bg-felt text-ink" : "border-transparent text-mist hover:text-ink"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
