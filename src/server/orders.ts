import { Prisma } from "@prisma/client";
import { config } from "./config";
import { prisma } from "./db";
import { AppError } from "./errors";
import { sha256, publicCode } from "./crypto";
import { issuePix } from "./payments";
import { wake } from "./queue";
import { applyWalletEntry } from "./wallet";
import type { B2COrderInput } from "./validators";
import { notifyAdmin } from "./notifications";

const orderInclude = { items: true, charge: true } satisfies Prisma.OrderInclude;

export async function createStoreOrder(input: B2COrderInput) {
  if (input.clientRequestId) {
    const existing = await prisma.order.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (existing) return existing;
  }
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product || !product.isActive) throw new AppError("Produto indisponível", "PRODUCT_UNAVAILABLE", 404);

  const totalSale = product.suggestedRetailCents * input.quantity;
  const pix = await issuePix({
    amountCents: totalSale,
    description: `Pedido ${product.title}`,
    externalReference: input.clientRequestId ?? publicCode(),
    customer: {
      name: input.customer.name,
      cpfCnpj: input.customer.cpf,
      email: input.customer.email,
      phone: input.customer.phone,
    },
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const reserved = await tx.product.updateMany({
        where: { id: product.id, isActive: true, stockQuantity: { gte: input.quantity } },
        data: { stockQuantity: { decrement: input.quantity } },
      });
      if (reserved.count !== 1) throw new AppError("Sem estoque suficiente", "OUT_OF_STOCK", 409);
      const order = await tx.order.create({
        data: {
          publicCode: publicCode(),
          clientRequestId: input.clientRequestId,
          channel: "B2C",
          customerName: input.customer.name,
          customerCpf: input.customer.cpf,
          customerPhone: input.customer.phone,
          customerEmail: emptyToNull(input.customer.email),
          shippingAddressJson: input.address,
          totalCostCents: product.supplierCostCents * input.quantity,
          totalWholesaleCents: product.platformWholesaleCents * input.quantity,
          totalSaleCents: totalSale,
          paymentStatus: "PENDING",
          fulfillmentStatus: "WAITING_PAYMENT",
          supplierSource: product.supplierSource,
          pixCopyPaste: pix.pixCopyPaste,
          pixQrCodeBase64: pix.qrCodeBase64,
          items: {
            create: {
              productId: product.id,
              title: product.title,
              quantity: input.quantity,
              unitCostCents: product.supplierCostCents,
              unitWholesaleCents: product.platformWholesaleCents,
              unitSaleCents: product.suggestedRetailCents,
            },
          },
        },
      });
      const charge = await tx.pixCharge.create({
        data: {
          purpose: "ORDER_PAYMENT",
          orderId: order.id,
          provider: pix.provider,
          externalId: pix.externalId,
          amountCents: BigInt(totalSale),
          pixCopyPaste: pix.pixCopyPaste,
          expiresAt: pix.expiresAt,
        },
      });
      const outbox = await tx.outboxJob.create({
        data: {
          queue: "abandoned-pix-queue",
          jobKey: `recover:${charge.id}`,
          payloadJson: { chargeId: charge.id },
          runAt: new Date(Date.now() + config.abandonedPixDelayMs),
        },
      });
      return { order, outboxId: outbox.id };
    });
    await wake("abandoned-pix-queue", created.outboxId, config.abandonedPixDelayMs);
    return created.order;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.clientRequestId) {
      const existing = await prisma.order.findUnique({ where: { clientRequestId: input.clientRequestId } });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function createResellerOrder(userId: string, input: B2COrderInput) {
  if (input.clientRequestId) {
    const existing = await prisma.order.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (existing) return existing;
  }
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product || !product.isActive) throw new AppError("Produto indisponível", "PRODUCT_UNAVAILABLE", 404);
  const imported = await prisma.catalogImport.findUnique({
    where: { userId_productId: { userId, productId: product.id } },
  });
  if (!imported) throw new AppError("Importe o produto para a sua vitrine antes de vender", "NOT_IMPORTED", 409);

  const quantity = input.quantity;
  const wholesale = product.platformWholesaleCents * quantity;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const reserved = await tx.product.updateMany({
        where: { id: product.id, isActive: true, stockQuantity: { gte: quantity } },
        data: { stockQuantity: { decrement: quantity } },
      });
      if (reserved.count !== 1) throw new AppError("Sem estoque suficiente", "OUT_OF_STOCK", 409);
      const order = await tx.order.create({
        data: {
          publicCode: publicCode(),
          clientRequestId: input.clientRequestId,
          tenantId: userId,
          channel: "B2B",
          customerName: input.customer.name,
          customerCpf: input.customer.cpf,
          customerPhone: input.customer.phone,
          customerEmail: emptyToNull(input.customer.email),
          shippingAddressJson: input.address,
          totalCostCents: product.supplierCostCents * quantity,
          totalWholesaleCents: wholesale,
          totalSaleCents: imported.retailPriceCents * quantity,
          paymentStatus: "PAID",
          fulfillmentStatus: "QUEUED",
          supplierSource: product.supplierSource,
          items: {
            create: {
              productId: product.id,
              title: product.title,
              quantity,
              unitCostCents: product.supplierCostCents,
              unitWholesaleCents: product.platformWholesaleCents,
              unitSaleCents: imported.retailPriceCents,
            },
          },
        },
      });
      await applyWalletEntry(tx, {
        userId,
        orderId: order.id,
        amountCents: BigInt(-wholesale),
        type: "ORDER_DEBIT",
        idempotencyKey: sha256(`${userId}:${order.id}:ORDER_DEBIT`),
        description: `Atacado do pedido ${order.publicCode}`,
      });
      const outbox = await tx.outboxJob.create({
        data: {
          queue: "fulfillment-queue",
          jobKey: `fulfill:${order.id}`,
          payloadJson: { orderId: order.id },
          runAt: new Date(),
        },
      });
      return { order, outboxId: outbox.id };
    });
    await wake("fulfillment-queue", created.outboxId, 0);
    return created.order;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && input.clientRequestId) {
      const existing = await prisma.order.findUnique({ where: { clientRequestId: input.clientRequestId } });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function refundOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new AppError("Pedido não encontrado", "NOT_FOUND", 404);
  if (order.paymentStatus === "REFUNDED") return order;
  if (order.paymentStatus !== "PAID") throw new AppError("Só um pedido pago pode ser estornado", "NOT_PAID");
  if (order.fulfillmentStatus === "SHIPPED" || order.fulfillmentStatus === "DELIVERED") {
    throw new AppError("O pedido já foi enviado. Resolva a logística antes de estornar.", "ALREADY_SHIPPED");
  }
  await prisma.$transaction(async (tx) => {
    if (order.channel === "B2B" && order.tenantId) {
      await applyWalletEntry(tx, {
        userId: order.tenantId,
        orderId: order.id,
        amountCents: BigInt(order.totalWholesaleCents),
        type: "REFUND",
        idempotencyKey: sha256(`${order.id}:REFUND`),
        description: `Estorno do pedido ${order.publicCode}`,
      });
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "REFUNDED",
        fulfillmentStatus: "FAILED",
        failureReason: "Estornado pelo administrador",
      },
    });
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQuantity: { increment: item.quantity } },
      });
    }
  });
  if (order.channel === "B2C") {
    await notifyAdmin(
      "Estorno de pedido B2C",
      `O pedido ${order.publicCode} foi marcado como estornado. Devolva o PIX no gateway — o sandbox não movimenta banco.`,
      "info",
    );
  }
  return prisma.order.findUnique({ where: { id: order.id }, include: orderInclude });
}

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
