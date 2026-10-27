import { NextResponse } from "next/server";
import { z } from "zod";
import { SupplierSource } from "@prisma/client";
import { jsonError } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { setMasterBalance } from "@/server/settings";

const schema = z.object({
  source: z.enum(["CJ_BRAZIL", "BLING_HUB"]),
  balanceCents: z.number().int().min(0),
});

export async function POST(request: Request) {
  try {
    await requireApiUser(["ADMIN"]);
    const input = schema.parse(await request.json());
    const currency = input.source === "CJ_BRAZIL" && process.env.SUPPLIER_MODE === "live" ? "USD" : "BRL";
    await setMasterBalance(input.source as SupplierSource, { cents: input.balanceCents, currency });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
