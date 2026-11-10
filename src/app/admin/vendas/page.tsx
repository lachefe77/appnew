import Link from "next/link"
import { createOrderAction, updateOrderAction } from "@/app/actions/admin"
import { AdminHeading, EmptyNote } from "@/components/admin-ui"
import { Flash } from "@/components/flash"
import { prisma } from "@/lib/db"
import { formatDate, formatMoney } from "@/lib/format"
import { ORDER_STATUSES, orderStatusLabel } from "@/server/labels"

export const dynamic = "force-dynamic"

function reais(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",")
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string; pedido?: string }>
}) {
  const query = await searchParams
  const [orders, users, plans] = await Promise.all([
    prisma.order.findMany({
      include: { user: true, plan: true, coupon: true, affiliate: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.user.findMany({ orderBy: { email: "asc" }, take: 200 }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" } }),
  ])
  const editing = orders.find((order) => order.id === query.pedido)

  return (
    <>
      <AdminHeading
        title="Vendas e pedidos"
        lede="Registre e edite pedidos. Marcar como pago não libera o plano. A liberação continua em Usuários."
      />
      <Flash erro={query.erro} ok={query.ok} tone="light" />
      <form action={createOrderAction} className="panel grid gap-3 md:grid-cols-2">
        <label>
          <span className="label-light">Cliente</span>
          <select className="field-light" name="userId" required>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label-light">Plano</span>
          <select className="field-light" name="planId" required>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label-light">Status</span>
          <select className="field-light" name="status" defaultValue="pendente">
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabel[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label-light">Valor (R$)</span>
          <input className="field-light" name="amount" inputMode="decimal" required placeholder="149,00" />
        </label>
        <label>
          <span className="label-light">Cupom</span>
          <input className="field-light" name="coupon" />
        </label>
        <label>
          <span className="label-light">Afiliado</span>
          <input className="field-light" name="affiliate" />
        </label>
        <label className="md:col-span-2">
          <span className="label-light">Notas</span>
          <input className="field-light" name="notes" />
        </label>
        <div>
          <button className="btn-admin" type="submit">
            Registrar pedido
          </button>
        </div>
      </form>

      {editing ? (
        <form action={updateOrderAction} className="panel mt-4 grid gap-3 md:grid-cols-3">
          <input type="hidden" name="orderId" value={editing.id} />
          <p className="text-sm text-black/70 md:col-span-3">
            Editando pedido de {editing.user.email}.{" "}
            <Link className="link-admin" href="/admin/vendas">
              Fechar
            </Link>
          </p>
          <label>
            <span className="label-light">Status</span>
            <select className="field-light" name="status" defaultValue={editing.status}>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {orderStatusLabel[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label-light">Valor (R$)</span>
            <input className="field-light" name="amount" defaultValue={reais(editing.amountCents)} required />
          </label>
          <label>
            <span className="label-light">Notas</span>
            <input className="field-light" name="notes" defaultValue={editing.notes} />
          </label>
          <div>
            <button className="btn-admin" type="submit">
              Salvar pedido
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-4">
        {orders.length ? (
          <div className="sheet">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Cliente</th>
                  <th>Plano</th>
                  <th>Status</th>
                  <th>Valor</th>
                  <th>Vínculos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="whitespace-nowrap">{formatDate(order.createdAt)}</td>
                    <td>{order.user.email}</td>
                    <td>{order.plan?.name ?? "—"}</td>
                    <td>{orderStatusLabel[order.status]}</td>
                    <td>{formatMoney(order.amountCents, order.currency)}</td>
                    <td className="text-black/60">
                      {[order.coupon?.code, order.affiliate?.code].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td>
                      <Link className="link-admin" href={`/admin/vendas?pedido=${order.id}`}>
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyNote>Nenhum pedido registrado.</EmptyNote>
        )}
      </div>
    </>
  )
}
