import Link from "next/link";
import { notFound } from "next/navigation";
import { CartActions } from "@/components/cart-button";
import { ProductPhoto } from "@/components/product-photo";
import { categoryLabel, formatBRL, sourceLabel } from "@/lib/format";
import { getCommerce } from "@/server/commerce";
import { bundleLabel } from "@/server/pricing";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { lowStockLabel } from "@/server/storefront";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await prisma.product.findUnique({ where: { slug } });
  if (!product || !product.isActive) notFound();
  const [user, commerce, related] = await Promise.all([
    currentUser(),
    getCommerce(),
    prisma.product.findMany({
      where: { isActive: true, category: product.category, id: { not: product.id } },
      take: 3,
      orderBy: { title: "asc" },
    }),
  ]);
  const reseller = user && user.role !== "CUSTOMER" && user.role !== "OPERATOR";
  const bundle = bundleLabel(product);
  const badge = lowStockLabel(product.stockQuantity, commerce.lowStockBadge);

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          <ProductPhoto src={product.images[0]} title={product.title} badge={badge} />
          {product.images.length > 1 ? (
            <div className="grid grid-cols-4 gap-2">
              {product.images.slice(0, 4).map((image) => (
                <img key={image} src={image} alt="" className="aspect-square rounded-xl border border-line object-cover" />
              ))}
            </div>
          ) : null}
        </div>
        <div className="space-y-4">
          <p className="text-sm text-muted">{categoryLabel(product.category)} · {sourceLabel(product.supplierSource)}</p>
          <h1 className="text-4xl font-semibold leading-tight">{product.title}</h1>
          <p className="text-4xl font-semibold">{formatBRL(product.suggestedRetailCents)}</p>
          {bundle ? <p className="text-pine">Leve {bundle.qty} por {formatBRL(bundle.priceCents)}</p> : null}
          <p className="text-sm text-muted">{product.stockQuantity} em estoque · envio em até {product.shipDays} dias úteis após o PIX</p>
          <p className="text-ink/80">{product.description}</p>
          {reseller ? <p className="text-sm text-pine">Atacado da sua carteira: {formatBRL(product.platformWholesaleCents)}</p> : null}
          <CartActions
            line={{
              productId: product.id,
              title: product.title,
              slug: product.slug,
              quantity: 1,
              unitCents: product.suggestedRetailCents,
              image: product.images[0],
              shipDays: product.shipDays,
            }}
          />
          <p className="text-sm text-muted">O despacho só começa depois que o PIX confirma. O estoque fica reservado nesse intervalo.</p>
        </div>
      </div>
      {related.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Da mesma categoria</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {related.map((item) => (
              <Link key={item.id} href={`/produto/${item.slug}`} className="rounded-2xl border border-line bg-card p-3">
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-muted">{formatBRL(item.suggestedRetailCents)}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
