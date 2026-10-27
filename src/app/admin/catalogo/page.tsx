import { ProductCreate } from "@/components/product-create";
import { ProductEditor } from "@/components/product-editor";
import { ProductPhoto } from "@/components/product-photo";
import { formatBRL } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function AdminCatalogPage() {
  await requireUser(["MASTER", "ADMIN"]);
  const products = await prisma.product.findMany({ orderBy: { title: "asc" } });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">Catálogo</h1>
        <p className="max-w-2xl text-sm text-muted">Cadastre aqui o que ainda não veio da API. Salvar marca o produto como curado: o sync seguinte atualiza custo e estoque e preserva título, preço e foto.</p>
      </div>
      <ProductCreate />
      {products.map((product) => (
        <div key={product.id} className="grid gap-4 lg:grid-cols-[180px_1fr]">
          <div>
            <ProductPhoto src={product.images[0]} title={product.title} />
            <p className="mt-2 text-xs text-muted">{product.supplierSku} · custo {formatBRL(product.supplierCostCents)} · {product.curated ? "curado" : "segue a fórmula"}</p>
          </div>
          <ProductEditor
            product={{
              id: product.id,
              title: product.title,
              description: product.description,
              platformWholesaleCents: product.platformWholesaleCents,
              suggestedRetailCents: product.suggestedRetailCents,
              isActive: product.isActive,
              shipDays: product.shipDays,
              bundleQty: product.bundleQty,
              bundlePriceCents: product.bundlePriceCents,
            }}
          />
        </div>
      ))}
    </div>
  );
}
