import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/server/api";
import { config } from "@/server/config";
import { hmacSha256 } from "@/server/crypto";
import { AppError } from "@/server/errors";
import { handleTrackingWebhook } from "@/server/webhooks";

const schema = z.object({
  publicCode: z.string().min(3),
  trackingCode: z.string().min(4).max(40).optional(),
  delivered: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production" || config.supplierMode !== "sandbox") {
      throw new AppError("A simulação de rastreio só existe no sandbox local", "SANDBOX_ONLY", 404);
    }
    const input = schema.parse(await request.json());
    const trackingCode = input.trackingCode ?? `BR${input.publicCode.replace(/\W/g, "").slice(-8)}BR`;
    const raw = JSON.stringify({
      provider: "sandbox-tracking",
      eventId: `track:${input.publicCode}:${input.delivered ? "delivered" : "shipped"}`,
      publicCode: input.publicCode,
      trackingCode,
      delivered: Boolean(input.delivered),
    });
    const result = await handleTrackingWebhook(raw, hmacSha256(raw, config.webhookSecret));
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
