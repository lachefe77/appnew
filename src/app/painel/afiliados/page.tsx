import { formatBRL } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { getBrand } from "@/server/brand";
import { prisma } from "@/server/db";

export default async function ResellerAffiliatesPage() {
  const user = await requireUser(["RESELLER", "ADMIN", "MASTER"]);
  const brand = await getBrand();
  const [fresh, referrals, commissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id } }),
    prisma.user.findMany({ where: { referredById: user.id }, orderBy: { createdAt: "desc" } }),
    user.wallet
      ? prisma.walletLedger.findMany({
          where: { walletId: user.wallet.id, type: "AFFILIATE_COMMISSION" },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
  ]);
  const code = fresh?.affiliateCode;
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Afiliados</h1>
      <p className="text-sm text-muted">Quem abrir conta de revenda pelo seu link fica indicado. Cada pedido pago dele credita {(brand.affiliateBps / 100).toFixed(2)}% do atacado na sua carteira.</p>
      {code ? <p className="rounded-2xl border border-line bg-card p-4 text-sm">Seu link: /revenda?ref={code}</p> : <p className="text-sm text-muted">Esta conta ainda não tem código de afiliado.</p>}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
        {referrals.map((item) => (
          <li key={item.id} className="px-4 py-3">{item.name} · {item.email}</li>
        ))}
        {referrals.length === 0 ? <li className="px-4 py-3 text-muted">Ninguém indicado ainda.</li> : null}
      </ul>
      <h2 className="text-xl font-semibold">Comissões</h2>
      <ul className="space-y-2 text-sm">
        {commissions.map((row) => (
          <li key={row.id}>{formatBRL(Number(row.amountCents))} · {row.description}</li>
        ))}
      </ul>
    </div>
  );
}
