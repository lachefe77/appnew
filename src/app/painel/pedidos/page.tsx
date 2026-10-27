import { LiveRefresh } from "@/components/live-refresh";
import { OrderTable, type OrderRow } from "@/components/order-table";
import { ResellerOrderForm } from "@/components/reseller-order-form";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function ResellerOrdersPage() {
  const user = await requireUser(["RESELLER", "ADMIN"]);
  const [imports, orders] = await Promise.all([
    prisma.catalogImport.findMany({
      where: { userId: user.id, product: { isActive: true } },
      include: { product: true },
    }),
    prisma.order.findMany({
      where: { tenantId: user.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
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
    <div className="space-y-5">
      <LiveRefresh />
      <h1 className="font-display text-4xl">Pedidos</h1>
      <Card>
        <h2 className="mb-4 font-display text-2xl">Novo pedido do cliente</h2>
        <ResellerOrderForm
          products={imports.map((item) => ({
            id: item.product.id,
            title: item.product.title,
            wholesaleCents: item.product.platformWholesaleCents,
            stockQuantity: item.product.stockQuantity,
          }))}
        />
      </Card>
      <Card>
        <OrderTable orders={rows} />
      </Card>
    </div>
  );
}
