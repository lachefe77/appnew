import { LiveRefresh } from "@/components/live-refresh";
import { OrderTable, type OrderRow } from "@/components/order-table";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function AdminOrdersPage() {
  await requireUser(["ADMIN"]);
  const orders = await prisma.order.findMany({
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const rows: OrderRow[] = orders.map((order) => ({
    publicCode: order.publicCode,
    channel: order.channel,
    customerName: order.customerName,
    totalSaleCents: order.totalSaleCents,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    trackingCode: order.trackingCode,
    createdAt: order.createdAt.toISOString(),
    title: order.items.map((item) => item.title).join(", "),
  }));

  return (
    <div className="space-y-4">
      <LiveRefresh />
      <h1 className="font-display text-4xl">Pedidos em tempo real</h1>
      <p className="text-sm text-muted">A tabela atualiza a cada poucos segundos. Rastreio e estorno ficam nesta tela.</p>
      <Card>
        <OrderTable orders={rows} admin />
      </Card>
    </div>
  );
}
