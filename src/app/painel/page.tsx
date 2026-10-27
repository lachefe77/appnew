import { DepositDialog } from "@/components/deposit-dialog";
import { Card, Stat } from "@/components/ui";
import { formatBRL } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { isSandboxPayment } from "@/server/config";
import { prisma } from "@/server/db";

export default async function PanelHome() {
  const user = await requireUser(["RESELLER", "ADMIN"]);
  const [orders, imports] = await Promise.all([
    prisma.order.count({ where: { tenantId: user.id } }),
    prisma.catalogImport.count({ where: { userId: user.id } }),
  ]);
  const balance = Number(user.wallet?.balanceCents ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Painel do revendedor</p>
          <h1 className="font-display text-4xl">{user.name}</h1>
        </div>
        <DepositDialog sandbox={isSandboxPayment()} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Saldo" value={formatBRL(balance)} hint="Sempre em centavos no banco" />
        <Stat label="Produtos importados" value={String(imports)} />
        <Stat label="Pedidos lançados" value={String(orders)} />
      </div>
      <Card>
        <h2 className="font-display text-2xl">Próximo passo</h2>
        <p className="mt-2 text-sm text-muted">
          Importe um item, lance um pedido de cliente e acompanhe o débito no extrato. Se o saldo não cobrir o atacado, a venda não entra.
        </p>
      </Card>
    </div>
  );
}
