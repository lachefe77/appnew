import { ImportButton } from "@/components/import-button";
import { Badge, Card } from "@/components/ui";
import { formatBRL, sourceLabel } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function CatalogPage() {
  const user = await requireUser(["RESELLER", "ADMIN"]);
  const [products, imports] = await Promise.all([
    prisma.product.findMany({ orderBy: [{ isActive: "desc" }, { title: "asc" }] }),
    prisma.catalogImport.findMany({ where: { userId: user.id } }),
  ]);
  const imported = new Set(imports.map((item) => item.productId));

  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Catálogo</h1>
      <p className="max-w-2xl text-sm text-muted">
        O atacado já inclui a margem da plataforma. O varejo sugerido é o preço de vitrine. Item com estoque abaixo de 5 fica pausado.
      </p>
      <div className="grid gap-3">
        {products.map((product) => (
          <Card key={product.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="mb-1 flex flex-wrap gap-2">
                <Badge tone={product.isActive ? "pine" : "alert"}>{product.isActive ? "Ativo" : "Pausado"}</Badge>
                <Badge>{sourceLabel(product.supplierSource)}</Badge>
              </div>
              <h2 className="font-display text-2xl">{product.title}</h2>
              <p className="text-sm text-muted">
                Custo {formatBRL(product.supplierCostCents)} · atacado {formatBRL(product.platformWholesaleCents)} · varejo {formatBRL(product.suggestedRetailCents)} · estoque {product.stockQuantity}
              </p>
            </div>
            <ImportButton productId={product.id} imported={imported.has(product.id)} />
          </Card>
        ))}
      </div>
    </div>
  );
}
