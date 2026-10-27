import { notFound } from "next/navigation";
import { PostButton } from "@/components/post-button";
import { AdjustForm } from "@/components/adjust-form";
import { Card } from "@/components/ui";
import { formatBRL, ledgerLabel } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";

export default async function ResellerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser(["ADMIN", "OPERATOR"]);
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      wallet: { include: { ledger: { orderBy: { createdAt: "desc" }, take: 20 } } },
      orders: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!user || user.role !== "RESELLER") notFound();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">{user.name}</h1>
        <p className="text-sm text-muted">{user.email} · {user.planStatus} · saldo {formatBRL(Number(user.wallet?.balanceCents ?? 0))}</p>
      </div>
      {actor.role === "ADMIN" ? (
        <div className="flex flex-wrap gap-2">
          <PostButton url="/api/admin/users" body={{ action: "suspend", userId: user.id }} label="Bloquear" confirm="Bloquear este revendedor?" />
          <PostButton url="/api/admin/users" body={{ action: "activate", userId: user.id }} label="Reativar" />
        </div>
      ) : null}
      {actor.role === "ADMIN" ? <AdjustForm userId={user.id} /> : null}
      <Card>
        <h2 className="text-xl font-semibold">Extrato</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {user.wallet?.ledger.map((entry) => (
            <li key={entry.id} className="flex justify-between py-2">
              <span>{ledgerLabel(entry.type)} · {entry.description}</span>
              <span>{formatBRL(Number(entry.amountCents))}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Pedidos recentes</h2>
        <ul className="mt-3 text-sm">
          {user.orders.map((order) => (
            <li key={order.id}>{order.publicCode} · {formatBRL(order.totalWholesaleCents)} de atacado</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
