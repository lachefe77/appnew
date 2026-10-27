import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductPhoto } from "@/components/product-photo";
import { formatBRL } from "@/lib/format";
import { prisma } from "@/server/db";

export default async function PublicStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await prisma.user.findUnique({
    where: { storeSlug: slug },
    include: { imports: { include: { product: true } } },
  });
  if (!user || user.planStatus === "SUSPENDED") notFound();
  const products = user.imports.filter((item) => item.product.isActive);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">Vitrine de {user.name}</p>
        <h1 className="text-4xl font-semibold">Peça pelo WhatsApp ou monte o pedido com o revendedor.</h1>
        {user.phone ? <a className="mt-3 inline-block text-pine" href={`https://wa.me/55${user.phone.replace(/\D/g, "")}`}>Falar no WhatsApp</a> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((item) => (
          <article key={item.id} className="overflow-hidden rounded-2xl border border-line bg-card">
            <ProductPhoto src={item.product.images[0]} title={item.product.title} />
            <div className="space-y-2 p-4">
              <h2 className="text-lg font-semibold">{item.product.title}</h2>
              <p className="text-2xl font-semibold">{formatBRL(item.retailPriceCents)}</p>
              <Link href={`/produto/${item.product.slug}`} className="text-sm text-pine">Ver na loja da casa</Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
