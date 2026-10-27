import { Prisma, SupplierSource } from "@prisma/client";
import { isSandboxSupplier } from "./config";
import { getCommerce } from "./commerce";
import { prisma } from "./db";
import { AppError } from "./errors";
import { FIXTURES, type FixtureProduct } from "./fixtures";
import { adapterFor, slugify } from "./suppliers";

export function pricesFromCost(supplierCostCents: number, spread: number, retailMultiplier: number) {
  return {
    platformWholesaleCents: Math.round(supplierCostCents * spread),
    suggestedRetailCents: Math.round(supplierCostCents * retailMultiplier),
  };
}

export function isListed(stockQuantity: number, lowStockThreshold: number) {
  return stockQuantity >= lowStockThreshold;
}

export async function upsertSupplierProduct(input: {
  supplierSource: SupplierSource;
  supplierSku: string;
  title: string;
  slug: string;
  description: string;
  images?: string[];
  category: string;
  supplierCostCents: number;
  stockQuantity: number;
  weightGrams?: number;
  shipDays?: number;
}) {
  const commerce = await getCommerce();
  const prices = pricesFromCost(input.supplierCostCents, commerce.spread, commerce.retailMultiplier);
  const existing = await prisma.product.findUnique({
    where: { supplierSource_supplierSku: { supplierSource: input.supplierSource, supplierSku: input.supplierSku } },
  });
  const listed = isListed(input.stockQuantity, commerce.lowStockThreshold);
  if (existing?.curated) {
    return prisma.product.update({
      where: { id: existing.id },
      data: {
        supplierCostCents: input.supplierCostCents,
        stockQuantity: input.stockQuantity,
        isActive: listed ? existing.isActive : false,
        weightGrams: input.weightGrams ?? existing.weightGrams,
      },
    });
  }
  const images = input.images && input.images.length > 0 ? input.images : existing?.images ?? [];
  const data = {
    supplierSource: input.supplierSource,
    supplierSku: input.supplierSku,
    title: input.title,
    slug: existing?.slug ?? input.slug,
    description: input.description,
    images,
    category: input.category,
    supplierCostCents: input.supplierCostCents,
    platformWholesaleCents: prices.platformWholesaleCents,
    suggestedRetailCents: prices.suggestedRetailCents,
    stockQuantity: input.stockQuantity,
    isActive: listed,
    shipDays: input.shipDays ?? existing?.shipDays ?? commerce.shipDays,
    weightGrams: input.weightGrams ?? 500,
  };
  return prisma.product.upsert({
    where: { supplierSource_supplierSku: { supplierSource: input.supplierSource, supplierSku: input.supplierSku } },
    create: data,
    update: data,
  });
}

export async function ensureFixtures() {
  let created = 0;
  for (const item of FIXTURES) {
    const existing = await prisma.product.findUnique({
      where: { supplierSource_supplierSku: { supplierSource: item.supplierSource, supplierSku: item.supplierSku } },
    });
    if (existing) continue;
    await upsertSupplierProduct(item);
    created += 1;
  }
  return created;
}

export async function syncFixtureCatalog() {
  let updated = 0;
  for (const item of FIXTURES) {
    await upsertSupplierProduct(fixtureToInput(item));
    updated += 1;
  }
  return { updated, source: "sandbox" as const };
}

function fixtureToInput(item: FixtureProduct) {
  return item;
}

export async function syncCatalogs() {
  if (isSandboxSupplier()) {
    const result = await syncFixtureCatalog();
    return result;
  }
  let updated = 0;
  for (const source of [SupplierSource.CJ_BRAZIL, SupplierSource.BLING_HUB]) {
    const items = await adapterFor(source).syncCatalog();
    for (const item of items) {
      const existing = await prisma.product.findUnique({
        where: { supplierSource_supplierSku: { supplierSource: item.supplierSource, supplierSku: item.supplierSku } },
      });
      const base = existing?.slug ?? `${source === "CJ_BRAZIL" ? "cj" : "bl"}-${slugify(item.title) || slugify(item.supplierSku)}`;
      await upsertSupplierProduct({
        ...item,
        slug: base || item.supplierSku.toLowerCase(),
        description: item.description || item.title,
      });
      updated += 1;
    }
  }
  return { updated, source: "live" as const };
}

export async function importProduct(userId: string, productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || !product.isActive) {
    throw new AppError("Produto indisponível", "PRODUCT_UNAVAILABLE", 404);
  }
  return prisma.catalogImport.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId, retailPriceCents: product.suggestedRetailCents },
    update: {},
  });
}

export async function removeImport(userId: string, productId: string) {
  await prisma.catalogImport.deleteMany({ where: { userId, productId } });
}

export const productSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  category: true,
  supplierSource: true,
  supplierSku: true,
  supplierCostCents: true,
  platformWholesaleCents: true,
  suggestedRetailCents: true,
  stockQuantity: true,
  isActive: true,
  images: true,
  shipDays: true,
  bundleQty: true,
  bundlePriceCents: true,
  curated: true,
} satisfies Prisma.ProductSelect;
