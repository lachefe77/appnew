import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/server/api";
import { requireApiUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { slugify } from "@/server/suppliers";
import { productCreateSchema, productEditSchema } from "@/server/validators";

export async function POST(request: Request) {
  try {
    await requireApiUser(["MASTER", "ADMIN"]);
    const body = await readJson(request);
    if (typeof body === "object" && body && "action" in body && body.action === "create") {
      const input = productCreateSchema.parse(body);
      const base = slugify(input.title) || slugify(input.supplierSku) || "produto";
      const slug = await uniqueSlug(base);
      const product = await prisma.product.create({
        data: {
          title: input.title,
          description: input.description,
          category: input.category,
          supplierSource: input.supplierSource,
          supplierSku: input.supplierSku,
          supplierCostCents: input.supplierCostCents,
          platformWholesaleCents: input.platformWholesaleCents,
          suggestedRetailCents: input.suggestedRetailCents,
          stockQuantity: input.stockQuantity,
          shipDays: input.shipDays,
          slug,
          images: [],
          isActive: input.stockQuantity > 0,
          curated: true,
          weightGrams: 500,
        },
      });
      return NextResponse.json({ ok: true, id: product.id });
    }
    const input = productEditSchema.parse(body);
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

async function uniqueSlug(base: string) {
  const taken = await prisma.product.findUnique({ where: { slug: base } });
  if (!taken) return base;
  return `${base}-${Date.now().toString().slice(-4)}`;
}
