import Link from "next/link";
import { requireUser } from "@/server/auth";
import { formatBRL } from "@/lib/format";
import { prisma } from "@/server/db";

export default async function ResellersPage() {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const users = await prisma.user.findMany({
    where: { role: "RESELLER" },
    include: { wallet: true, orders: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });
  const deposits = await prisma.pixCharge.findMany({
    where: { purpose: "WALLET_DEPOSIT", status: "PAID", walletId: { in: users.map((user) => user.wallet?.id).filter(Boolean) as string[] } },
    orderBy: { paidAt: "desc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Revendedores</h1>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="py-2">Nome</th>
              <th className="py-2">Plano</th>
              <th className="py-2">Saldo</th>
              <th className="py-2">Último depósito</th>
              <th className="py-2">Último pedido</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const deposit = deposits.find((charge) => charge.walletId === user.wallet?.id);
              return (
                <tr key={user.id} className="border-t border-line">
                  <td className="py-3">
                    <Link href={`/admin/revendedores/${user.id}`} className="font-medium">{user.name}</Link>
                    <p className="text-xs text-muted">{user.email}</p>
                  </td>
                  <td className="py-3">{user.planStatus}</td>
                  <td className="py-3">{formatBRL(Number(user.wallet?.balanceCents ?? 0))}</td>
                  <td className="py-3">{deposit ? formatBRL(Number(deposit.amountCents)) : "nenhum"}</td>
                  <td className="py-3">{user.orders[0]?.publicCode ?? "nenhum"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
