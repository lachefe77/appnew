import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { saveBrand } from "@/server/brand";

const schema = z.object({
  name: z.string().trim().min(3).max(60),
  mark: z.string().trim().min(1).max(4),
  tagline: z.string().trim().min(3).max(80),
  heroTitle: z.string().trim().min(8).max(140),
  heroBody: z.string().trim().min(8).max(400),
  dispatchLabel: z.string().trim().min(3).max(80),
  warehouseLabel: z.string().trim().min(3).max(80),
  supplierLabel: z.string().trim().min(3).max(80),
  shippingLabel: z.string().trim().min(3).max(80),
  supportEmail: z.string().trim().email(),
  usdtAddress: z.string().trim().max(120),
  usdtNetwork: z.string().trim().min(2).max(20),
  usdtBrlCents: z.number().int().min(100).max(100_000_00),
  affiliateBps: z.number().int().min(0).max(2000),
});

export async function POST(request: Request) {
  try {
    await requireApiUser(["MASTER", "ADMIN"]);
    const input = schema.parse(await readJson(request));
    const brand = await saveBrand(input);
    return NextResponse.json({ ok: true, brand });
  } catch (error) {
    return jsonError(error);
  }
}
