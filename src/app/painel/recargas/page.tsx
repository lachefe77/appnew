import { DepositDialog } from "@/components/deposit-dialog";
import { formatBRL, paymentLabel } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { isSandboxPayment } from "@/server/config";
import { prisma } from "@/server/db";

export default async function DepositsPage() {
  const user = await requireUser(["RESELLER", "ADMIN"]);
  const charges = user.wallet
    ? await prisma.pixCharge.findMany({
        where: { walletId: user.wallet.id, purpose: "WALLET_DEPOSIT" },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Recargas</h1>
        <DepositDialog sandbox={isSandboxPayment()} />
      </div>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
        {charges.map((charge) => (
          <li key={charge.id} className="flex justify-between gap-3 px-4 py-3 text-sm">
            <span>{formatBRL(Number(charge.amountCents))} · {paymentLabel(charge.status)}</span>
            <span className="text-muted">{charge.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
          </li>
        ))}
      </ul>
      {charges.length === 0 ? <p className="text-sm text-muted">Nenhuma recarga ainda.</p> : null}
    </div>
  );
}
