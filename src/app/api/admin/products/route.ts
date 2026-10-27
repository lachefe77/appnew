import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { productEditSchema } from "@/server/validators";

export async function POST(request: Request) {
  try {
    await requireApiUser(["MASTER", "ADMIN"]);
    const input = productEditSchema.parse(await readJson(request));
    const product = await prisma.product.update({
      where: { id: input.id },
      data: {
        title: input.title,
        description: input.description,
        platformWholesaleCents: input.platformWholesaleCents,
        suggestedRetailCents: input.suggestedRetailCents,
        isActive: input.isActive,
        shipDays: input.shipDays,
        bundleQty: input.bundleQty,
        bundlePriceCents: input.bundlePriceCents,
        curated: true,
      },
    });
    return NextResponse.json({ ok: true, id: product.id });
  } catch (error) {
    return jsonError(error);
  }
}
