import type { Order, OrderItem } from "@prisma/client";
import { prisma } from "./db";
import { adapterFor } from "./suppliers";
import type { AddressInput } from "./validators";

type OrderWithItems = Order & { items: OrderItem[] };

export async function fulfillOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return;
  if (order.paymentStatus !== "PAID") return;
  if (order.fulfillmentStatus === "DISPATCHED_TO_SUPPLIER") return;
  if (order.fulfillmentStatus === "SHIPPED" || order.fulfillmentStatus === "DELIVERED") return;

  const adapter = adapterFor(order.supplierSource);
  const supplierOrderId = order.supplierOrderId ?? (await createSupplierOrder(adapter, order));
  await adapter.payOrder(supplierOrderId, order.totalCostCents);
  await prisma.order.update({
    where: { id: order.id },
    data: { supplierOrderId, fulfillmentStatus: "DISPATCHED_TO_SUPPLIER", failureReason: null },
  });
}

async function createSupplierOrder(adapter: ReturnType<typeof adapterFor>, order: OrderWithItems) {
  const created = await adapter.createOrder({
    publicCode: order.publicCode,
    customerName: order.customerName,
    customerCpf: order.customerCpf,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    address: order.shippingAddressJson as AddressInput,
    costCents: order.totalCostCents,
    items: await skuForItems(order),
  });
  await prisma.order.update({
    where: { id: order.id },
    data: { supplierOrderId: created.supplierOrderId, fulfillmentStatus: "QUEUED" },
  });
  return created.supplierOrderId;
}

export async function skuForItems(order: OrderWithItems) {
  const products = await prisma.product.findMany({
    where: { id: { in: order.items.map((item) => item.productId) } },
  });
  const byId = new Map(products.map((product) => [product.id, product.supplierSku]));
  return order.items.map((item) => ({
    sku: byId.get(item.productId) ?? item.productId,
    title: item.title,
    quantity: item.quantity,
    unitCostCents: item.unitCostCents,
  }));
}
