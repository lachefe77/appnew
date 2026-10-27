import Link from "next/link";
import { DepositDialog } from "@/components/deposit-dialog";
import { Stat } from "@/components/ui";
import { formatBRL } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { isSandboxPayment } from "@/server/config";
import { prisma } from "@/server/db";

function startOfSaoPauloDay() {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${key}T00:00:00-03:00`);
}

export default async function PanelHome() {
  const user = await requireUser(["RESELLER", "ADMIN"]);
  const start = startOfSaoPauloDay();
  const [orders, imports, pending] = await Promise.all([
    prisma.order.findMany({ where: { tenantId: user.id, paymentStatus: "PAID", createdAt: { gte: start } }, include: { items: true } }),
    prisma.catalogImport.findMany({ where: { userId: user.id }, include: { product: true } }),
    prisma.order.count({ where: { tenantId: user.id, paymentStatus: "PENDING" } }),
  ]);
  const balance = Number(user.wallet?.balanceCents ?? 0);
  const sales = orders.reduce((sum, order) => sum + order.totalSaleCents, 0);
  const profit = orders.reduce((sum, order) => sum + order.totalSaleCents - order.totalWholesaleCents, 0);
  const cheapest = imports
    .filter((item) => item.product.isActive)
    .sort((a, b) => a.product.platformWholesaleCents - b.product.platformWholesaleCents)[0];
  const shortfall = cheapest && balance < cheapest.product.platformWholesaleCents;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Painel do revendedor</p>
          <h1 className="text-4xl font-semibold">{user.name}</h1>
        </div>
        <DepositDialog sandbox={isSandboxPayment()} />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Saldo" value={formatBRL(balance)} />
        <Stat label="Vendas de hoje" value={formatBRL(sales)} hint="Preço que você cobra" />
        <Stat label="Lucro estimado" value={formatBRL(profit)} hint="Seu preço menos o atacado" />
        <Stat label="PIX pendente" value={String(pending)} hint="Pedidos da sua conta ainda abertos" />
      </div>
      {shortfall && cheapest ? (
        <p className="rounded-2xl border border-line bg-card p-4 text-sm">
          O saldo não cobre o item mais barato da sua vitrine ({cheapest.product.title}, {formatBRL(cheapest.product.platformWholesaleCents)}).
          <Link href="/painel/carteira" className="ml-2 text-pine">Recarregar</Link>
        </p>
      ) : null}
      {user.storeSlug ? <p className="text-sm">Link da vitrine: <Link className="text-pine" href={`/loja/${user.storeSlug}`}>/loja/{user.storeSlug}</Link></p> : null}
    </div>
  );
}
