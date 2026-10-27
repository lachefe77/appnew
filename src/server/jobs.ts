import { prisma } from "./db";
import { SupplierError } from "./errors";
import { fulfillOrder } from "./fulfillment";
import { recoveryText, sendWhatsAppAudio, sendWhatsAppText } from "./notifications";
import { expireCharge } from "./charges";
import { pauseBullQueue, resumeBullQueue } from "./queue";
import { getPause, setPause } from "./settings";
import { notifyAdmin } from "./notifications";

type Payload = { orderId?: string; chargeId?: string };

export async function runOutboxById(id: string) {
  const peek = await prisma.outboxJob.findUnique({ where: { id } });
  if (!peek || peek.status !== "PENDING") return;
  if (peek.runAt.getTime() > Date.now() + 250) return;
  if (peek.queue === "fulfillment-queue" && (await getPause()).paused) return;

  const claimed = await claim(id);
  if (!claimed) return;
  try {
    await execute(claimed.queue, claimed.payloadJson as Payload);
    await prisma.outboxJob.update({ where: { id }, data: { status: "DONE", lastError: null } });
  } catch (error) {
    const outcome = await failOrRetry(id, error);
    if (outcome === "retry") throw error;
  }
}

async function claim(id: string) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; queue: string; payloadJson: unknown; status: string; attempts: number }>>`
      SELECT id, queue, "payloadJson", status::text AS status, attempts
      FROM "OutboxJob"
      WHERE id = ${id}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row || row.status !== "PENDING" || row.attempts >= 5) return null;
    await tx.outboxJob.update({
      where: { id },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
    return row;
  });
}

async function execute(queue: string, payload: Payload) {
  if (queue === "fulfillment-queue") {
    if (!payload.orderId) return;
    await fulfillOrder(payload.orderId);
    return;
  }
  if (queue === "abandoned-pix-queue") {
    if (!payload.chargeId) return;
    await recoverCharge(payload.chargeId);
  }
}

async function recoverCharge(chargeId: string) {
  const charge = await prisma.pixCharge.findUnique({
    where: { id: chargeId },
    include: { order: true, wallet: { include: { user: true } } },
  });
  if (!charge || charge.status !== "PENDING") return;
  if (charge.expiresAt.getTime() <= Date.now()) {
    await expireCharge(charge.id);
    return;
  }
  const name = charge.order?.customerName ?? charge.wallet?.user.name ?? "cliente";
  const phone = charge.order?.customerPhone ?? charge.wallet?.user.phone;
  const code = charge.order?.publicCode ?? "recarga da carteira";
  const text = recoveryText({
    name,
    code,
    amountCents: Number(charge.amountCents),
    pix: charge.pixCopyPaste,
  });
  await sendWhatsAppText(phone, text, charge.orderId);
  if (phone) await sendWhatsAppAudio(phone, charge.orderId);
}

async function failOrRetry(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Falha no job";
  const code = error instanceof SupplierError ? error.code : "";
  if (code === "INSUFFICIENT_MASTER_BALANCE") {
    await prisma.outboxJob.update({ where: { id }, data: { status: "FAILED", lastError: message } });
    const job = await prisma.outboxJob.findUnique({ where: { id } });
    const orderId = (job?.payloadJson as Payload | null)?.orderId;
    if (orderId) {
      await prisma.order.updateMany({
        where: { id: orderId, fulfillmentStatus: { in: ["QUEUED", "WAITING_PAYMENT"] } },
        data: { fulfillmentStatus: "FAILED", failureReason: message },
      });
    }
    await pauseFulfillment(message);
    return "paused" as const;
  }
  const job = await prisma.outboxJob.findUnique({ where: { id } });
  if (!job) return "failed" as const;
  if (job.attempts >= 5) {
    await prisma.outboxJob.update({ where: { id }, data: { status: "FAILED", lastError: message } });
    const orderId = (job.payloadJson as Payload).orderId;
    if (orderId) {
      await prisma.order.updateMany({
        where: { id: orderId, paymentStatus: "PAID", fulfillmentStatus: "QUEUED" },
        data: { fulfillmentStatus: "FAILED", failureReason: message },
      });
    }
    return "failed" as const;
  }
  const delay = Math.min(60_000, 5_000 * 2 ** job.attempts);
  await prisma.outboxJob.update({
    where: { id },
    data: { status: "PENDING", lastError: message, runAt: new Date(Date.now() + delay) },
  });
  return "retry" as const;
}

export async function pauseFulfillment(reason: string) {
  const current = await getPause();
  await setPause({ paused: true, reason });
  if (!current.paused) {
    await pauseBullQueue();
    await notifyAdmin("Fila de despacho pausada", reason);
  }
}

export async function resumeFulfillment() {
  await setPause({ paused: false, reason: null });
  await resumeBullQueue();
}

export async function sweepDueJobs() {
  await prisma.outboxJob.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 120_000) } },
    data: { status: "PENDING", lastError: "Retomado depois de travar em processamento" },
  });
  const paused = (await getPause()).paused;
  const due = await prisma.outboxJob.findMany({
    where: {
      status: "PENDING",
      runAt: { lte: new Date() },
      ...(paused ? { queue: { not: "fulfillment-queue" } } : {}),
    },
    orderBy: { runAt: "asc" },
    take: 20,
  });
  for (const job of due) {
    try {
      await runOutboxById(job.id);
    } catch (error) {
      console.error("[nh] job", job.id, error instanceof Error ? error.message : error);
    }
  }
}

export async function requeueOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return null;
  if (order.paymentStatus !== "PAID") return order;
  if (order.fulfillmentStatus === "SHIPPED" || order.fulfillmentStatus === "DELIVERED") return order;
  await prisma.order.update({
    where: { id: order.id },
    data: { fulfillmentStatus: "QUEUED", failureReason: null },
  });
  const outbox = await prisma.outboxJob.create({
    data: {
      queue: "fulfillment-queue",
      jobKey: `fulfill:${order.id}:${Date.now()}`,
      payloadJson: { orderId: order.id },
      runAt: new Date(),
    },
  });
  const { wake } = await import("./queue");
  await wake("fulfillment-queue", outbox.id, 0);
  return prisma.order.findUnique({ where: { id: order.id } });
}
