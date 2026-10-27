import { prisma } from "./db";

export async function expireCharge(chargeId: string) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string; orderId: string | null }>>`
      SELECT id, status::text AS status, "orderId"
      FROM "PixCharge"
      WHERE id = ${chargeId}
      FOR UPDATE
    `;
    const charge = rows[0];
    if (!charge || charge.status !== "PENDING") return;
    await tx.pixCharge.update({ where: { id: chargeId }, data: { status: "EXPIRED" } });
    if (!charge.orderId) return;
    const order = await tx.order.findUnique({ where: { id: charge.orderId }, include: { items: true } });
    if (!order || order.paymentStatus !== "PENDING") return;
    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: "EXPIRED", fulfillmentStatus: "FAILED", failureReason: "PIX expirado" },
    });
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }
  });
}

export async function expireDueCharges() {
  const due = await prisma.pixCharge.findMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    select: { id: true },
    take: 50,
  });
  for (const charge of due) await expireCharge(charge.id);
}
