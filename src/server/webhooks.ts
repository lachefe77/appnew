import { Prisma } from "@prisma/client";
import { config } from "./config";
import { hmacSha256, safeEqual, sha256 } from "./crypto";
import { prisma } from "./db";
import { AppError } from "./errors";
import { wake } from "./queue";
import { applyWalletEntry } from "./wallet";
import { sendWhatsAppText } from "./notifications";
import { expireCharge } from "./charges";

type Notice = {
  provider: string;
  eventId: string;
  paymentExternalId: string;
  event: "PAID" | "EXPIRED" | "IGNORED";
  amountCents: number | null;
};

export async function handlePaymentWebhook(raw: string, headers: { signature: string | null; asaasToken: string | null }) {
  const notice = parsePaymentNotice(raw, headers);
  const payload = JSON.parse(raw) as Prisma.InputJsonValue;

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.webhookEvent.upsert({
      where: { provider_externalId: { provider: notice.provider, externalId: notice.eventId } },
      create: { provider: notice.provider, externalId: notice.eventId, payloadJson: payload },
      update: {},
    });
    const locked = await tx.$queryRaw<Array<{ id: string; processedAt: Date | null }>>`
      SELECT id, "processedAt" FROM "WebhookEvent" WHERE id = ${event.id} FOR UPDATE
    `;
    if (locked[0]?.processedAt) return { duplicate: true, applied: false, outboxId: null as string | null };

    if (notice.event === "IGNORED" || !notice.paymentExternalId) {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { duplicate: false, applied: false, outboxId: null as string | null };
    }

    const charges = await tx.$queryRaw<Array<{ id: string; status: string; orderId: string | null; walletId: string | null; amountCents: string; purpose: string }>>`
      SELECT id, status::text AS status, "orderId", "walletId", "amountCents"::text AS "amountCents", purpose::text AS purpose
      FROM "PixCharge"
      WHERE "externalId" = ${notice.paymentExternalId}
      FOR UPDATE
    `;
    const charge = charges[0];
    if (!charge) throw new AppError("Cobrança não encontrada", "CHARGE_NOT_FOUND", 404);
    if (notice.amountCents != null && notice.amountCents !== Number(charge.amountCents)) {
      throw new AppError("Valor do webhook não confere com a cobrança", "AMOUNT_MISMATCH", 422);
    }

    if (notice.event === "EXPIRED") {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { duplicate: false, applied: false, outboxId: null, expireChargeId: charge.status === "PENDING" ? charge.id : null };
    }

    if (charge.status === "PAID") {
      await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { duplicate: true, applied: false, outboxId: null as string | null };
    }

    await tx.pixCharge.update({ where: { id: charge.id }, data: { status: "PAID", paidAt: new Date() } });
    let outboxId: string | null = null;
    if (charge.orderId) {
      await tx.order.update({
        where: { id: charge.orderId },
        data: { paymentStatus: "PAID", fulfillmentStatus: "QUEUED" },
      });
      const outbox = await tx.outboxJob.create({
        data: {
          queue: "fulfillment-queue",
          jobKey: `fulfill:${charge.orderId}`,
          payloadJson: { orderId: charge.orderId },
          runAt: new Date(),
        },
      });
      outboxId = outbox.id;
    } else if (charge.walletId) {
      const wallet = await tx.wallet.findUnique({ where: { id: charge.walletId } });
      if (!wallet) throw new AppError("Carteira não encontrada", "NO_WALLET", 404);
      await applyWalletEntry(tx, {
        userId: wallet.userId,
        amountCents: BigInt(charge.amountCents),
        type: "PIX_DEPOSIT",
        idempotencyKey: sha256(`pix:${notice.paymentExternalId}`),
        description: "Recarga confirmada via PIX",
      });
    }
    await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { duplicate: false, applied: true, outboxId };
  });

  if ("expireChargeId" in result && result.expireChargeId) {
    await expireCharge(result.expireChargeId);
  }
  if (result.outboxId) await wake("fulfillment-queue", result.outboxId, 0);
  return { ok: true, duplicate: result.duplicate, applied: result.applied };
}

export function parsePaymentNotice(raw: string, headers: { signature: string | null; asaasToken: string | null }): Notice {
  const body = JSON.parse(raw) as Record<string, unknown>;
  if (body.provider === "sandbox") {
    if (!config.webhookSecret || !safeEqual(headers.signature, hmacSha256(raw, config.webhookSecret))) {
      throw new AppError("Assinatura do webhook inválida", "BAD_SIGNATURE", 401);
    }
    return {
      provider: "sandbox",
      eventId: String(body.eventId ?? ""),
      paymentExternalId: String(body.externalId ?? ""),
      event: "PAID",
      amountCents: numberOrNull(body.amountCents),
    };
  }

  const eventName = typeof body.event === "string" ? body.event : "";
  if (eventName.startsWith("PAYMENT_")) {
    if (!config.asaasWebhookToken || !safeEqual(headers.asaasToken, config.asaasWebhookToken)) {
      throw new AppError("Token do webhook Asaas inválido", "BAD_SIGNATURE", 401);
    }
    const payment = (body.payment ?? {}) as Record<string, unknown>;
    const paid = eventName === "PAYMENT_RECEIVED" || eventName === "PAYMENT_CONFIRMED";
    const expired = eventName === "PAYMENT_OVERDUE" || eventName === "PAYMENT_DELETED";
    const value = typeof payment.value === "number" ? Math.round(payment.value * 100) : null;
    return {
      provider: "asaas",
      eventId: String(body.id ?? `${eventName}:${payment.id ?? ""}`),
      paymentExternalId: String(payment.id ?? ""),
      event: paid ? "PAID" : expired ? "EXPIRED" : "IGNORED",
      amountCents: value,
    };
  }

  if (eventName.startsWith("OPENPIX:") || body.charge) {
    if (config.openPixWebhookSecret && !safeEqual(headers.signature, hmacSha256(raw, config.openPixWebhookSecret))) {
      throw new AppError("Assinatura da OpenPix inválida", "BAD_SIGNATURE", 401);
    }
    if (!config.openPixWebhookSecret) throw new AppError("OPENPIX_WEBHOOK_SECRET ausente", "BAD_SIGNATURE", 401);
    const charge = (body.charge ?? {}) as Record<string, unknown>;
    const correlationID = String(charge.correlationID ?? "");
    const completed = eventName === "OPENPIX:CHARGE_COMPLETED" || charge.status === "COMPLETED";
    const expired = eventName === "OPENPIX:CHARGE_EXPIRED";
    return {
      provider: "openpix",
      eventId: `${eventName || "CHARGE"}:${correlationID}`,
      paymentExternalId: correlationID,
      event: completed ? "PAID" : expired ? "EXPIRED" : "IGNORED",
      amountCents: numberOrNull(charge.value),
    };
  }

  throw new AppError("Evento de pagamento não reconhecido", "UNKNOWN_EVENT", 400);
}

export async function handleTrackingWebhook(raw: string, signature: string | null) {
  if (!config.webhookSecret || !safeEqual(signature, hmacSha256(raw, config.webhookSecret))) {
    throw new AppError("Assinatura do webhook inválida", "BAD_SIGNATURE", 401);
  }
  const body = JSON.parse(raw) as {
    provider?: string;
    eventId?: string;
    supplierOrderId?: string;
    publicCode?: string;
    trackingCode?: string;
    delivered?: boolean;
  };
  if (!body.eventId || !body.trackingCode) throw new AppError("Rastreio incompleto", "BAD_TRACKING");
  const provider = body.provider ?? "supplier";

  const order = await prisma.$transaction(async (tx) => {
    const event = await tx.webhookEvent.upsert({
      where: { provider_externalId: { provider, externalId: body.eventId! } },
      create: { provider, externalId: body.eventId!, payloadJson: body },
      update: {},
    });
    const locked = await tx.$queryRaw<Array<{ processedAt: Date | null }>>`
      SELECT "processedAt" FROM "WebhookEvent" WHERE id = ${event.id} FOR UPDATE
    `;
    if (locked[0]?.processedAt) return null;
    const found = body.supplierOrderId
      ? await tx.order.findFirst({ where: { supplierOrderId: body.supplierOrderId } })
      : await tx.order.findUnique({ where: { publicCode: body.publicCode ?? "" } });
    if (!found) throw new AppError("Pedido do rastreio não encontrado", "ORDER_NOT_FOUND", 404);
    const updated = await tx.order.update({
      where: { id: found.id },
      data: {
        trackingCode: body.trackingCode,
        fulfillmentStatus: body.delivered ? "DELIVERED" : "SHIPPED",
      },
    });
    await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return updated;
  });

  if (!order) return { ok: true, duplicate: true };
  await sendWhatsAppText(
    order.customerPhone,
    `Olá, ${order.customerName}. Seu pedido ${order.publicCode} foi atualizado para ${body.delivered ? "entregue" : "enviado"}. Rastreio: ${body.trackingCode}.`,
    order.id,
  );
  return { ok: true, duplicate: false, publicCode: order.publicCode };
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}
