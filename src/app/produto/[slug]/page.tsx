import { notFound } from "next/navigation";
import { CheckoutForm } from "@/components/checkout-form";
import { ProductArt } from "@/components/product-art";
import { Badge, Card } from "@/components/ui";
import { categoryLabel, formatBRL, sourceLabel } from "@/lib/format";
import { currentUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await prisma.product.findUnique({ where: { slug } });
  if (!product || !product.isActive) notFound();
  const user = await currentUser();
  const reseller = user && user.role !== "CUSTOMER";

  return (
    <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="overflow-hidden rounded-3xl border border-line bg-card shadow-card">
        <ProductArt category={product.category} title={product.title} />
        <div className="space-y-3 p-5">
          <Badge>{sourceLabel(product.supplierSource)}</Badge>
          <h1 className="font-display text-4xl leading-tight">{product.title}</h1>
          <p className="text-ink/80">{product.description}</p>
          <p className="text-sm text-muted">{categoryLabel(product.category)} · {product.stockQuantity} em estoque</p>
          <p className="font-display text-4xl">{formatBRL(product.suggestedRetailCents)}</p>
          {reseller ? <p className="text-sm text-pine">Atacado da sua carteira: {formatBRL(product.platformWholesaleCents)}</p> : null}
        </div>
      </div>
      <Card>
        <h2 className="font-display text-3xl">Pagar com PIX</h2>
        <p className="mb-5 mt-2 text-sm text-muted">O pedido reserva o estoque e fica aguardando a confirmação. O despacho só começa depois do pagamento.</p>
        <CheckoutForm productId={product.id} />
      </Card>
    </div>
  );
}
