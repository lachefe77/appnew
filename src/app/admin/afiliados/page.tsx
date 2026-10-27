import { formatBRL } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { getBrand } from "@/server/brand";
import { prisma } from "@/server/db";

export default async function AffiliatesAdminPage() {
  await requireUser(["MASTER", "ADMIN"]);
  const brand = await getBrand();
  const resellers = await prisma.user.findMany({
    where: { role: "RESELLER" },
    include: { referrals: true, wallet: true },
    orderBy: { name: "asc" },
  });
  const commissions = await prisma.walletLedger.findMany({
    where: { type: "AFFILIATE_COMMISSION", amountCents: { gt: 0 } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { wallet: { include: { user: true } } },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Afiliados</h1>
      <p className="text-sm text-muted">Comissão atual: {(brand.affiliateBps / 100).toFixed(2)}% do atacado, creditada na carteira de quem indicou o revendedor.</p>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
        {resellers.map((user) => (
          <li key={user.id} className="flex justify-between gap-3 px-4 py-3">
            <span>{user.name}<span className="block text-xs text-muted">{user.affiliateCode ?? "sem código"}</span></span>
            <span>{user.referrals.length} indicados</span>
          </li>
        ))}
      </ul>
      <h2 className="text-xl font-semibold">Últimas comissões</h2>
      <ul className="space-y-2 text-sm">
        {commissions.map((row) => (
          <li key={row.id}>{row.wallet.user.name} · {formatBRL(Number(row.amountCents))} · {row.description}</li>
        ))}
        {commissions.length === 0 ? <li className="text-muted">Nenhuma comissão ainda.</li> : null}
      </ul>
    </div>
  );
}
