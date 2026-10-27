import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { hmacSha256 } from "@/server/crypto";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { jsonError } from "@/server/api";
import { handlePaymentWebhook } from "@/server/webhooks";
import { z } from "zod";

const schema = z.object({ externalId: z.string().min(3) });

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production" || config.paymentProvider !== "sandbox") {
      throw new AppError("A simulação de PIX só existe no sandbox local", "SANDBOX_ONLY", 404);
    }
    const input = schema.parse(await request.json());
    const charge = await prisma.pixCharge.findUnique({ where: { externalId: input.externalId } });
    if (!charge) throw new AppError("Cobrança não encontrada", "CHARGE_NOT_FOUND", 404);
    const raw = JSON.stringify({
      provider: "sandbox",
      eventId: `sandbox-paid:${charge.externalId}`,
      externalId: charge.externalId,
      amountCents: Number(charge.amountCents),
    });
    const result = await handlePaymentWebhook(raw, {
      signature: hmacSha256(raw, config.webhookSecret),
      asaasToken: null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
