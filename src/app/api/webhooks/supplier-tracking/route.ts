import { NextResponse } from "next/server";
import { jsonError } from "@/server/api";
import { handleTrackingWebhook } from "@/server/webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  try {
    const result = await handleTrackingWebhook(raw, request.headers.get("x-webhook-signature"));
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
