import { Prisma, type SupplierSource } from "@prisma/client";
import { getBrand } from "./brand";
import { getCommerce } from "./commerce";
import { prisma } from "./db";
import { AppError } from "./errors";
import { sha256, publicCode } from "./crypto";
import { issueCollection } from "./payments";
import { quoteLine } from "./pricing";
import { wake } from "./queue";
import { applyWalletEntry } from "./wallet";
import type { AddressInput, CustomerInput } from "./validators";
import { notifyAdmin } from "./notifications";

const orderInclude = { items: true, charge: true } satisfies Prisma.OrderInclude;

type LineRequest = { productId: string; quantity: number };

type CheckoutInput = {
  clientRequestId?: string;
  customer: CustomerInput;
  address: AddressInput;
  items?: LineRequest[];
  productId?: string;
  quantity?: number;
  payMethod?: "PIX" | "BOLETO" | "USDT";
};

export async function createStoreOrder(input: CheckoutInput) {
  return createCheckout(null, input);
}

export async function createResellerOrder(userId: string, input: CheckoutInput) {
  return createCheckout(userId, input);
}

async function createCheckout(userId: string | null, input: CheckoutInput) {
  const existing = await findExisting(input.clientRequestId);
  if (existing.length > 0) return existing;

  const requests = normalizeLines(input);
  const products = await prisma.product.findMany({ where: { id: { in: requests.map((line) => line.productId) } } });
  const byId = new Map(products.map((product) => [product.id, product]));
  const imports = userId
    ? await prisma.catalogImport.findMany({
        where: { userId, productId: { in: requests.map((line) => line.productId) } },
      })
    : [];
  const importByProduct = new Map(imports.map((row) => [row.productId, row]));

  const prepared = requests.map((line) => {
    const product = byId.get(line.productId);
    if (!product || !product.isActive) throw new AppError("Produto indisponível", "PRODUCT_UNAVAILABLE", 404);
    if (userId && !importByProduct.has(product.id)) {
      throw new AppError("Importe o produto para a sua vitrine antes de vender", "NOT_IMPORTED", 409);
    }
    const saleUnit = userId ? importByProduct.get(product.id)?.retailPriceCents : undefined;
    return { product, quantity: line.quantity, quote: quoteLine(product, line.quantity, saleUnit) };
  });

  const groups = new Map<SupplierSource, typeof prepared>();
  for (const line of prepared) {
    const bucket = groups.get(line.product.supplierSource) ?? [];
    bucket.push(line);
    groups.set(line.product.supplierSource, bucket);
  }

  const commerce = await getCommerce();
  const brand = await getBrand();
  const payMethod = userId ? "PIX" : input.payMethod ?? "PIX";
  const orders = [];
  for (const [source, lines] of groups) {
    const totalSale = lines.reduce((sum, line) => sum + line.quote.sale, 0);
    const requestId = groups.size === 1 ? input.clientRequestId : input.clientRequestId ? `${input.clientRequestId}:${source}` : undefined;
    const pix = userId
      ? null
      : await issueCollection({
          method: payMethod,
          usdtAddress: brand.usdtAddress,
          amountCents: totalSale,
          description: `Pedido ${lines.map((line) => line.product.title).join(", ")}`.slice(0, 140),
          externalReference: requestId ?? publicCode(),
          customer: {
            name: input.customer.name,
            cpfCnpj: input.customer.cpf,
            email: input.customer.email,
            phone: input.customer.phone,
          },
        });

    const created = await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const reserved = await tx.product.updateMany({
          where: { id: line.product.id, isActive: true, stockQuantity: { gte: line.quantity } },
          data: { stockQuantity: { decrement: line.quantity } },
        });
        if (reserved.count !== 1) throw new AppError("Sem estoque suficiente", "OUT_OF_STOCK", 409);
      }
      const order = await tx.order.create({
        data: {
          publicCode: publicCode(),
          clientRequestId: requestId,
          tenantId: userId,
          channel: userId ? "B2B" : "B2C",
          customerName: input.customer.name,
          customerCpf: input.customer.cpf,
          customerPhone: input.customer.phone,
          customerEmail: emptyToNull(input.customer.email),
          shippingAddressJson: input.address,
          totalCostCents: lines.reduce((sum, line) => sum + line.quote.cost, 0),
          totalWholesaleCents: lines.reduce((sum, line) => sum + line.quote.wholesale, 0),
          totalSaleCents: totalSale,
          paymentStatus: userId ? "PAID" : "PENDING",
          fulfillmentStatus: userId ? "QUEUED" : "WAITING_PAYMENT",
          supplierSource: source,
          payMethod: pix?.method ?? "PIX",
          pixCopyPaste: pix?.pixCopyPaste,
          pixQrCodeBase64: pix?.qrCodeBase64,
          boletoLine: pix?.boletoLine,
          items: {
            create: lines.map((line) => ({
              productId: line.product.id,
              title: line.product.title,
              quantity: line.quantity,
              unitCostCents: line.product.supplierCostCents,
              unitWholesaleCents: line.product.platformWholesaleCents,
              unitSaleCents: line.quote.unitSale,
            })),
          },
        },
      });
      if (userId) {
        await applyWalletEntry(tx, {
          userId,
          orderId: order.id,
          amountCents: BigInt(-order.totalWholesaleCents),
          type: "ORDER_DEBIT",
          idempotencyKey: sha256(`${userId}:${order.id}:ORDER_DEBIT`),
          description: `Atacado do pedido ${order.publicCode}`,
        });
        await creditAffiliate(tx, { buyerId: userId, orderId: order.id, wholesaleCents: order.totalWholesaleCents });
        await tx.resellerCustomer.upsert({
          where: { userId_cpf: { userId, cpf: input.customer.cpf } },
          create: {
            userId,
            name: input.customer.name,
            cpf: input.customer.cpf,
            phone: input.customer.phone,
            email: emptyToNull(input.customer.email),
            addressJson: input.address,
          },
          update: {
            name: input.customer.name,
            phone: input.customer.phone,
            email: emptyToNull(input.customer.email),
            addressJson: input.address,
          },
        });
        const outbox = await tx.outboxJob.create({
          data: {
            queue: "fulfillment-queue",
            jobKey: `fulfill:${order.id}`,
            payloadJson: { orderId: order.id },
            runAt: new Date(),
          },
        });
        return { order, outboxId: outbox.id, delay: 0, queue: "fulfillment-queue" as const };
      }
      const charge = await tx.pixCharge.create({
        data: {
          purpose: "ORDER_PAYMENT",
          orderId: order.id,
          provider: pix!.provider,
          externalId: pix!.externalId,
          amountCents: BigInt(totalSale),
          payMethod: pix!.method,
          pixCopyPaste: pix!.pixCopyPaste,
          boletoLine: pix!.boletoLine,
          expiresAt: pix!.expiresAt,
        },
      });
      const outbox = await tx.outboxJob.create({
        data: {
          queue: "abandoned-pix-queue",
          jobKey: `recover:${charge.id}`,
          payloadJson: { chargeId: charge.id },
          runAt: new Date(Date.now() + commerce.abandonedPixDelayMs),
        },
      });
      return { order, outboxId: outbox.id, delay: commerce.abandonedPixDelayMs, queue: "abandoned-pix-queue" as const };
    });
    await wake(created.queue, created.outboxId, created.delay);
    orders.push(created.order);
  }
  return orders;
}

async function findExisting(clientRequestId?: string) {
  if (!clientRequestId) return [];
  return prisma.order.findMany({
    where: {
      OR: [{ clientRequestId }, { clientRequestId: { startsWith: `${clientRequestId}:` } }],
    },
    orderBy: { createdAt: "asc" },
  });
}

function normalizeLines(input: CheckoutInput): LineRequest[] {
  const source = input.items && input.items.length > 0 ? input.items : input.productId ? [{ productId: input.productId, quantity: input.quantity ?? 1 }] : [];
  if (source.length === 0) throw new AppError("Escolha ao menos um produto", "EMPTY_CART", 400);
  const merged = new Map<string, number>();
  for (const line of source) {
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.quantity);
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
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
      await reverseAffiliate(tx, order.id, order.publicCode);
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
      `O pedido ${order.publicCode} foi marcado como estornado. Devolva o PIX no gateway. O sandbox não movimenta banco.`,
      "info",
    );
  }
  return prisma.order.findUnique({ where: { id: order.id }, include: orderInclude });
}

async function creditAffiliate(tx: Prisma.TransactionClient, input: { buyerId: string; orderId: string; wholesaleCents: number }) {
  const buyer = await tx.user.findUnique({ where: { id: input.buyerId }, select: { referredById: true } });
  if (!buyer?.referredById) return;
  const referrer = await tx.user.findUnique({ where: { id: buyer.referredById }, include: { wallet: true } });
  if (!referrer?.wallet || referrer.planStatus === "SUSPENDED") return;
  const brand = await getBrand();
  const cents = Math.floor((input.wholesaleCents * brand.affiliateBps) / 10000);
  if (cents <= 0) return;
  await applyWalletEntry(tx, {
    userId: referrer.id,
    orderId: input.orderId,
    amountCents: BigInt(cents),
    type: "AFFILIATE_COMMISSION",
    idempotencyKey: sha256(`affiliate:${input.orderId}`),
    description: "Comissão de afiliado",
  });
}

async function reverseAffiliate(tx: Prisma.TransactionClient, orderId: string, publicCode: string) {
  const commission = await tx.walletLedger.findUnique({
    where: { idempotencyKey: sha256(`affiliate:${orderId}`) },
    include: { wallet: true },
  });
  if (!commission || commission.amountCents <= 0n) return;
  await applyWalletEntry(tx, {
    userId: commission.wallet.userId,
    orderId,
    amountCents: -commission.amountCents,
    type: "AFFILIATE_COMMISSION",
    idempotencyKey: sha256(`affiliate-reversal:${orderId}`),
    description: `Estorno da comissão do pedido ${publicCode}`,
  });
}

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
