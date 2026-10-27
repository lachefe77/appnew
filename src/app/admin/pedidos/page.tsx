import Link from "next/link";
import { OrderTable } from "@/components/order-table";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import type { FulfillmentStatus, PaymentStatus } from "@prisma/client";

const payments = ["PENDING", "PAID", "EXPIRED", "REFUNDED"] as const;
const fulfillments = ["WAITING_PAYMENT", "QUEUED", "DISPATCHED_TO_SUPPLIER", "SHIPPED", "DELIVERED", "FAILED"] as const;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagamento?: string; despacho?: string }>;
}) {
  await requireUser(["ADMIN", "OPERATOR"]);
  const { q, pagamento, despacho } = await searchParams;
  const digits = (q ?? "").replace(/\D/g, "");
  const orders = await prisma.order.findMany({
    where: {
      ...(payments.includes(pagamento as PaymentStatus) ? { paymentStatus: pagamento as PaymentStatus } : {}),
      ...(fulfillments.includes(despacho as FulfillmentStatus) ? { fulfillmentStatus: despacho as FulfillmentStatus } : {}),
      ...(q
        ? {
            OR: [
              { publicCode: { contains: q, mode: "insensitive" } },
              { customerName: { contains: q, mode: "insensitive" } },
              ...(digits ? [{ customerCpf: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    include: { items: true },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Pedidos</h1>
      <form className="grid gap-2 sm:grid-cols-4" action="/admin/pedidos">
        <input className="field" name="q" defaultValue={q ?? ""} placeholder="Código, nome ou CPF" />
        <select className="field" name="pagamento" defaultValue={pagamento ?? ""}>
          <option value="">Pagamento</option>
          {payments.map((status) => <option key={status}>{status}</option>)}
        </select>
        <select className="field" name="despacho" defaultValue={despacho ?? ""}>
          <option value="">Despacho</option>
          {fulfillments.map((status) => <option key={status}>{status}</option>)}
        </select>
        <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Filtrar</button>
      </form>
      <OrderTable
        admin
        orders={orders.map((order) => ({
          publicCode: order.publicCode,
          channel: order.channel,
          customerName: order.customerName,
          totalSaleCents: order.totalSaleCents,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          trackingCode: order.trackingCode,
          createdAt: order.createdAt.toISOString(),
          title: order.items.map((item) => `${item.quantity}× ${item.title}`).join(", "),
        }))}
      />
      <p className="text-sm text-muted">{orders.length} pedidos. Abra o código para custo, fornecedor e estorno.</p>
      <Link href="/admin/pedidos" className="text-sm text-pine">Limpar filtros</Link>
    </div>
  );
}
