import { prisma } from "./db";

export async function listStoreProducts(input: { category?: string; q?: string; sort?: string }) {
  const sort = input.sort === "preco" ? { suggestedRetailCents: "asc" as const } : input.sort === "preco-desc" ? { suggestedRetailCents: "desc" as const } : { title: "asc" as const };
  return prisma.product.findMany({
    where: {
      isActive: true,
      ...(input.category ? { category: input.category } : {}),
      ...(input.q ? { title: { contains: input.q, mode: "insensitive" } } : {}),
    },
    orderBy: sort,
  });
}

export function lowStockLabel(stock: number, badgeAt: number) {
  if (stock <= 0) return "Sem estoque";
  if (stock <= badgeAt) return `Últimas ${stock} unidades`;
  return null;
}
