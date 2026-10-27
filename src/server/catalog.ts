import { Prisma, SupplierSource } from "@prisma/client";
import { config, isSandboxSupplier } from "./config";
import { prisma } from "./db";
import { AppError } from "./errors";
import { FIXTURES, type FixtureProduct } from "./fixtures";
import { adapterFor, slugify } from "./suppliers";

export function pricesFromCost(supplierCostCents: number) {
  return {
    platformWholesaleCents: Math.round(supplierCostCents * config.spread),
    suggestedRetailCents: Math.round(supplierCostCents * config.retailMultiplier),
  };
}

export function isListed(stockQuantity: number) {
  return stockQuantity >= config.lowStockThreshold;
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
}) {
  const prices = pricesFromCost(input.supplierCostCents);
  const data = {
    supplierSource: input.supplierSource,
    supplierSku: input.supplierSku,
    title: input.title,
    slug: input.slug,
    description: input.description,
    images: input.images ?? [],
    category: input.category,
    supplierCostCents: input.supplierCostCents,
    platformWholesaleCents: prices.platformWholesaleCents,
    suggestedRetailCents: prices.suggestedRetailCents,
    stockQuantity: input.stockQuantity,
    isActive: isListed(input.stockQuantity),
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
} satisfies Prisma.ProductSelect;
