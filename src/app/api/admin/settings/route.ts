import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { saveCommerce } from "@/server/commerce";
import { commerceSchema } from "@/server/validators";

export async function POST(request: Request) {
  try {
    await requireApiUser(["MASTER", "ADMIN"]);
    const input = commerceSchema.parse(await readJson(request));
    const saved = await saveCommerce(input);
    return NextResponse.json({ ok: true, settings: saved });
  } catch (error) {
    return jsonError(error);
  }
}
