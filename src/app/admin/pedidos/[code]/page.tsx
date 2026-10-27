import Link from "next/link";
import { notFound } from "next/navigation";
import { PostButton } from "@/components/post-button";
import { Card, StatusBadge } from "@/components/ui";
import { formatBRL, trackingMessage } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function AdminOrderPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser(["ADMIN", "OPERATOR"]);
  const { code } = await params;
  const order = await prisma.order.findUnique({ where: { publicCode: code }, include: { items: true, charge: true, tenant: true } });
  if (!order) notFound();
  const address = order.shippingAddressJson as { street?: string; number?: string; city?: string; state?: string; cep?: string };
  const owner = user.role === "ADMIN";

  return (
    <div className="space-y-5">
      <Link href="/admin/pedidos" className="text-sm text-pine">Voltar à fila</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">{order.publicCode}</h1>
        <div className="flex gap-2">
          <StatusBadge kind="pay" value={order.paymentStatus} />
          <StatusBadge kind="ship" value={order.fulfillmentStatus} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Dinheiro</p>
          <p className="mt-2">Venda {formatBRL(order.totalSaleCents)}</p>
          <p>Atacado {formatBRL(order.totalWholesaleCents)}</p>
          <p>Custo {formatBRL(order.totalCostCents)}</p>
          <p className="text-sm text-muted">Margem da casa {formatBRL((order.channel === "B2B" ? order.totalWholesaleCents : order.totalSaleCents) - order.totalCostCents)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Cliente</p>
          <p className="mt-2">{order.customerName}</p>
          <p className="text-sm text-muted">{order.customerCpf} · {order.customerPhone}</p>
          <p className="text-sm text-muted">{address.street}, {address.number} · {address.city}/{address.state} · {address.cep}</p>
          {order.tenant ? <p className="mt-2 text-sm">Revendedor {order.tenant.name}</p> : <p className="mt-2 text-sm">Vitrine da casa</p>}
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Fornecedor</p>
          <p className="mt-2">{order.supplierSource}</p>
          <p className="text-sm text-muted">Pedido {order.supplierOrderId ?? "ainda sem id"}</p>
          <p className="text-sm text-muted">Rastreio {order.trackingCode ?? "sem código"}</p>
          {order.failureReason ? <p className="text-sm text-copper">{order.failureReason}</p> : null}
        </Card>
      </div>
      <Card>
        <ul className="divide-y divide-line text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between py-2">
              <span>{item.quantity}× {item.title}</span>
              <span>{formatBRL(item.unitSaleCents * item.quantity)}</span>
            </li>
          ))}
        </ul>
      </Card>
      {order.trackingCode ? (
        <Card>
          <p className="text-sm font-medium">Mensagem para o cliente</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{trackingMessage(order)}</p>
        </Card>
      ) : null}
      {owner ? (
        <div className="flex flex-wrap gap-2">
          <PostButton url="/api/admin/orders/requeue" body={{ publicCode: order.publicCode }} label="Reprocessar despacho" />
          <PostButton url="/api/admin/orders/refund" body={{ publicCode: order.publicCode }} label="Estornar" confirm="Estornar este pedido?" />
        </div>
      ) : <p className="text-sm text-muted">Operador vê o pedido. Estorno e reprocesso ficam com o dono.</p>}
    </div>
  );
}
