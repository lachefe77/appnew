import Link from "next/link"
import { AdminHeading } from "@/components/admin-ui"
import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { getSettings } from "@/server/settings"

export const dynamic = "force-dynamic"

export default async function AdminHomePage() {
  const settings = await getSettings()
  const now = new Date()
  const [clients, activeGrants, orders, notices, audits] = await Promise.all([
    prisma.user.count({ where: { role: "cliente" } }),
    prisma.userPlan.count({ where: { status: "ativo", endsAt: { gte: now } } }),
    prisma.order.count(),
    prisma.notice.count({ where: { published: true } }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actor: true },
    }),
  ])
  const cards = [
    { label: "Clientes", value: clients, href: "/admin/usuarios" },
    { label: "Planos ativos", value: activeGrants, href: "/admin/usuarios" },
    { label: "Pedidos", value: orders, href: "/admin/vendas" },
    { label: "Avisos no ar", value: notices, href: "/admin/avisos" },
  ]
  return (
    <>
      <AdminHeading
        title="Geral"
        lede={`${settings.get("brand.name")} está ${settings.flag("site.online") ? "no ar" : "em manutenção"}. O painel de sinais está ${settings.flag("site.signalsVisible") ? "visível" : "desligado"}.`}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} href={card.href} className="panel block hover:border-[#085c34]">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/50">{card.label}</p>
            <p className="mt-2 font-display text-5xl">{card.value}</p>
          </Link>
        ))}
      </div>
      <h2 className="mb-3 mt-8 font-display text-3xl uppercase">Últimas ações</h2>
      {audits.length ? (
        <div className="sheet">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Resumo</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                  <td>{entry.actor?.email ?? "—"}</td>
                  <td>{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-black/60">Nenhuma ação registrada.</p>
      )}
    </>
  )
}
