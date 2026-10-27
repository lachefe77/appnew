import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { sha256 } from "@/server/crypto";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { wake } from "@/server/queue";
import { applyWalletEntry } from "@/server/wallet";

const schema = z.object({ externalId: z.string().min(3) });

export async function POST(request: Request) {
  try {
    const actor = await requireApiUser(["MASTER", "ADMIN"]);
    const input = schema.parse(await readJson(request));
    const result = await prisma.$transaction(async (tx) => {
      const eventId = `staff-paid:${input.externalId}`;
      const event = await tx.webhookEvent.upsert({
        where: { provider_externalId: { provider: "staff", externalId: eventId } },
        create: { provider: "staff", externalId: eventId, payloadJson: { externalId: input.externalId, actorId: actor.id } as Prisma.InputJsonValue },
        update: {},
      });
      const locked = await tx.$queryRaw<Array<{ processedAt: Date | null }>>`
        SELECT "processedAt" FROM "WebhookEvent" WHERE id = ${event.id} FOR UPDATE
      `;
      if (locked[0]?.processedAt) return { applied: false, outboxId: null as string | null };

      const charges = await tx.$queryRaw<Array<{ id: string; status: string; orderId: string | null; walletId: string | null; amountCents: string }>>`
        SELECT id, status::text AS status, "orderId", "walletId", "amountCents"::text AS "amountCents"
        FROM "PixCharge" WHERE "externalId" = ${input.externalId} FOR UPDATE
      `;
      const charge = charges[0];
      if (!charge) throw new AppError("Cobrança não encontrada", "CHARGE_NOT_FOUND", 404);
      if (charge.status === "PAID") {
        await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
        return { applied: false, outboxId: null as string | null };
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
          idempotencyKey: sha256(`staff:${input.externalId}`),
          description: "Recarga confirmada pela equipe",
        });
      }
      await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { applied: true, outboxId };
    });
    if (result.outboxId) await wake("fulfillment-queue", result.outboxId, 0);
    return NextResponse.json({ ok: true, applied: result.applied });
  } catch (error) {
    return jsonError(error);
  }
}
