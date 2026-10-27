import { DepositDialog } from "@/components/deposit-dialog";
import { Card } from "@/components/ui";
import { formatBRL, ledgerLabel } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { isSandboxPayment } from "@/server/config";
import { prisma } from "@/server/db";

export default async function WalletPage() {
  const user = await requireUser(["RESELLER", "ADMIN"]);
  const entries = user.wallet
    ? await prisma.walletLedger.findMany({
        where: { walletId: user.wallet.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { order: { select: { publicCode: true } } },
      })
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl">Extrato</h1>
        <DepositDialog sandbox={isSandboxPayment()} />
      </div>
      <Card>
        <p className="text-sm text-muted">Saldo atual {formatBRL(Number(user.wallet?.balanceCents ?? 0))}</p>
        <ul className="mt-4 divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium">{ledgerLabel(entry.type)}</p>
                <p className="text-xs text-muted">{entry.description} {entry.order ? `· ${entry.order.publicCode}` : ""}</p>
              </div>
              <span className={`tabular-nums ${entry.amountCents < 0n ? "text-copper" : "text-pine"}`}>
                {formatBRL(Number(entry.amountCents))}
              </span>
            </li>
          ))}
        </ul>
        {entries.length === 0 ? <p className="text-sm text-muted">A carteira ainda não movimentou.</p> : null}
      </Card>
    </div>
  );
}
