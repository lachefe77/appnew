import Link from "next/link";
import { PriceField } from "@/components/price-field";
import { ProductPhoto } from "@/components/product-photo";
import { formatBRL } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function ResellerStorePage() {
  const user = await requireUser(["RESELLER", "ADMIN"]);
  const imports = await prisma.catalogImport.findMany({
    where: { userId: user.id },
    include: { product: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Minha vitrine</h1>
      <p className="text-sm text-muted">
        O preço abaixo é o que você cobra do cliente. O atacado continua saindo da carteira.
        {user.storeSlug ? <> O link público é <Link className="text-pine" href={`/loja/${user.storeSlug}`}>/loja/{user.storeSlug}</Link>.</> : null}
      </p>
      <div className="space-y-3">
        {imports.map((item) => (
          <article key={item.id} className="grid items-center gap-4 rounded-2xl border border-line bg-card p-3 sm:grid-cols-[96px_1fr_auto]">
            <ProductPhoto src={item.product.images[0]} title={item.product.title} />
            <div>
              <p className="font-medium">{item.product.title}</p>
              <p className="text-sm text-muted">Atacado {formatBRL(item.product.platformWholesaleCents)} · sugerido {formatBRL(item.product.suggestedRetailCents)}</p>
              {item.retailPriceCents < item.product.platformWholesaleCents ? <p className="text-sm text-copper">Seu preço está abaixo do atacado.</p> : null}
            </div>
            <PriceField productId={item.productId} cents={item.retailPriceCents} />
          </article>
        ))}
        {imports.length === 0 ? <p className="text-sm text-muted">Importe produtos no catálogo.</p> : null}
      </div>
    </div>
  );
}
