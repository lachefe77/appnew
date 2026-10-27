import Link from "next/link";
import { ProductArt } from "@/components/product-art";
import { Badge } from "@/components/ui";
import { categoryLabel, formatBRL, sourceLabel } from "@/lib/format";
import { isSandboxPayment } from "@/server/config";
import { prisma } from "@/server/db";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ categoria?: string }> }) {
  const { categoria } = await searchParams;
  const products = await prisma.product.findMany({
    where: { isActive: true, ...(categoria ? { category: categoria } : {}) },
    orderBy: { title: "asc" },
  });
  const demo = isSandboxPayment()
    ? await prisma.order.findFirst({ where: { publicCode: "NH-DEMO001", paymentStatus: "PENDING" } })
    : null;

  return (
    <div className="space-y-10">
      <section className="grid items-end gap-8 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-5">
          <p className="text-xs uppercase tracking-[0.2em] text-copper">Galpão nacional · despacho depois do pagamento</p>
          <h1 className="max-w-xl font-display text-5xl leading-[1.05] sm:text-6xl">Preço de atacado, compra de uma unidade.</h1>
          <p className="max-w-xl text-lg text-ink/80">
            Ferramentas, bem-estar e pet com estoque no Brasil. O consumidor paga no PIX. O revendedor usa saldo da carteira e o pedido segue para o fornecedor sem planilha.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="#catalogo" className="rounded-full bg-copper px-5 py-3 text-sm text-white">Ver catálogo</Link>
            <Link href="/revenda" className="rounded-full border border-line bg-card px-5 py-3 text-sm">Quero revender</Link>
          </div>
        </div>
        <aside className="rounded-3xl border border-line bg-ink p-5 text-paper shadow-card">
          <p className="text-xs uppercase tracking-[0.16em] text-gold">Como o dinheiro anda</p>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed">
            <li>1. PIX cai na plataforma, ou o saldo do revendedor cobre o atacado.</li>
            <li>2. O saldo só muda dentro de uma transação com trava na carteira.</li>
            <li>3. A fila paga o fornecedor com o saldo mestre e guarda o rastreio.</li>
          </ol>
          {demo ? (
            <Link href={`/pedido/${demo.publicCode}`} className="mt-5 inline-block text-sm text-gold underline-offset-4 hover:underline">
              Abrir o PIX de demonstração {demo.publicCode}
            </Link>
          ) : null}
        </aside>
      </section>

      <div id="catalogo" className="flex flex-wrap gap-2">
        {[
          ["", "Tudo"],
          ["ferramentas", "Ferramentas"],
          ["bem-estar", "Bem-estar"],
          ["pet", "Pet"],
        ].map(([value, label]) => (
          <Link
            key={label}
            href={value ? `/?categoria=${value}` : "/"}
            className={`rounded-full px-3 py-1.5 text-sm ${categoria === value || (!categoria && value === "") ? "bg-ink text-paper" : "bg-card border border-line"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <Link key={product.id} href={`/produto/${product.slug}`} className="overflow-hidden rounded-3xl border border-line bg-card shadow-card transition hover:-translate-y-0.5">
            <ProductArt category={product.category} title={product.title} />
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge>{categoryLabel(product.category)}</Badge>
                <span className="text-xs text-muted">{sourceLabel(product.supplierSource)}</span>
              </div>
              <h2 className="font-display text-2xl leading-tight">{product.title}</h2>
              <p className="line-clamp-2 text-sm text-muted">{product.description}</p>
              <p className="font-display text-2xl">{formatBRL(product.suggestedRetailCents)}</p>
            </div>
          </Link>
        ))}
      </section>
      {products.length === 0 ? <p className="text-muted">Nenhum produto ativo nessa categoria.</p> : null}
    </div>
  );
}
