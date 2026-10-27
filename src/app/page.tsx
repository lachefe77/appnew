import Link from "next/link";
import { ProductPhoto } from "@/components/product-photo";
import { categoryLabel, formatBRL, sourceLabel } from "@/lib/format";
import { getCommerce } from "@/server/commerce";
import { bundleLabel } from "@/server/pricing";
import { listStoreProducts, lowStockLabel } from "@/server/storefront";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; q?: string; ordem?: string }>;
}) {
  const { categoria, q, ordem } = await searchParams;
  const [products, commerce] = await Promise.all([
    listStoreProducts({ category: categoria, q, sort: ordem }),
    getCommerce(),
  ]);

  return (
    <div className="space-y-8">
      <section className="grid items-end gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="space-y-4">
          <p className="text-sm font-medium text-pine">Estoque no Brasil · envio depois do PIX</p>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Atacado de uma unidade, com foto e preço na frente.</h1>
          <p className="max-w-xl text-lg text-ink/80">Ferramentas, bem-estar e pet. O pagamento é PIX. O despacho começa quando o pagamento confirma.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="#catalogo" className="rounded-full bg-ink px-5 py-3 text-sm text-white">Ver catálogo</Link>
            <Link href="/revenda" className="rounded-full border border-line bg-card px-5 py-3 text-sm">Quero revender</Link>
          </div>
        </div>
        <aside className="rounded-2xl border border-line bg-card p-5 text-sm">
          <p className="font-medium">Como comprar</p>
          <ol className="mt-3 space-y-2 text-muted">
            <li>1. Escolha o produto e gere o PIX.</li>
            <li>2. O estoque fica reservado até o pagamento ou o vencimento.</li>
            <li>3. O rastreio volta nesta página do pedido.</li>
          </ol>
          <Link href="/prazo" className="mt-4 inline-block text-pine">Prazo, troca e origem do envio</Link>
        </aside>
      </section>

      <form id="catalogo" className="grid gap-3 rounded-2xl border border-line bg-card p-4 sm:grid-cols-[1fr_180px_auto]" action="/">
        <input className="field" name="q" defaultValue={q ?? ""} placeholder="Buscar produto" />
        <select className="field" name="ordem" defaultValue={ordem ?? "nome"}>
          <option value="nome">Nome</option>
          <option value="preco">Menor preço</option>
          <option value="preco-desc">Maior preço</option>
        </select>
        {categoria ? <input type="hidden" name="categoria" value={categoria} /> : null}
        <button className="rounded-full bg-ink px-4 py-2 text-sm text-white">Buscar</button>
      </form>

      <div className="flex flex-wrap gap-2">
        {[
          ["", "Tudo"],
          ["ferramentas", "Ferramentas"],
          ["bem-estar", "Bem-estar"],
          ["pet", "Pet"],
        ].map(([value, label]) => (
          <Link
            key={label}
            href={value ? `/c/${value}` : "/"}
            className={`rounded-full px-3 py-1.5 text-sm ${categoria === value || (!categoria && value === "") ? "bg-ink text-white" : "border border-line bg-card"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => {
          const bundle = bundleLabel(product);
          const badge = lowStockLabel(product.stockQuantity, commerce.lowStockBadge);
          return (
            <Link key={product.id} href={`/produto/${product.slug}`} className="overflow-hidden rounded-2xl border border-line bg-card">
              <ProductPhoto src={product.images[0]} title={product.title} badge={badge} />
              <div className="space-y-2 p-4">
                <p className="text-xs text-muted">{categoryLabel(product.category)} · {sourceLabel(product.supplierSource)}</p>
                <h2 className="text-lg font-semibold leading-tight">{product.title}</h2>
                <p className="text-2xl font-semibold">{formatBRL(product.suggestedRetailCents)}</p>
                <p className="text-sm text-muted">Envio em até {product.shipDays} dias úteis após o PIX</p>
                {bundle ? <p className="text-sm text-pine">Leve {bundle.qty} por {formatBRL(bundle.priceCents)}</p> : null}
              </div>
            </Link>
          );
        })}
      </section>
      {products.length === 0 ? <p className="text-muted">Nenhum produto ativo nessa busca.</p> : null}
    </div>
  );
}
