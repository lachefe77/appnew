import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { handlePaymentWebhook } from "@/server/webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const result = await handlePaymentWebhook(raw, {
      signature: request.headers.get("x-webhook-signature"),
      asaasToken: request.headers.get("asaas-access-token"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
