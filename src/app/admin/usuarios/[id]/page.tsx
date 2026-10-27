import Link from "next/link";
import { notFound } from "next/navigation";
import { AdjustForm } from "@/components/adjust-form";
import { UserControl } from "@/components/simple-forms";
import { formatBRL } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { roleLabel } from "@/server/roles";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      wallet: true,
      orders: { orderBy: { createdAt: "desc" }, take: 12, include: { items: true } },
      referrals: { select: { id: true, name: true, email: true } },
    },
  });
  if (!user) notFound();
  const desk = actor.role === "MASTER" || actor.role === "ADMIN";
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted">{roleLabel(user.role)}</p>
        <h1 className="text-3xl font-semibold">{user.name}</h1>
        <p className="text-sm text-muted">{user.email} · {user.phone ?? "sem telefone"} · saldo {formatBRL(Number(user.wallet?.balanceCents ?? 0))}</p>
      </div>
      {desk ? <UserControl userId={user.id} role={user.role} note={user.note ?? ""} /> : <p className="text-sm text-muted">{user.note}</p>}
      {desk && user.wallet ? <AdjustForm userId={user.id} /> : null}
      {user.referrals.length > 0 ? (
        <p className="text-sm">Indicados: {user.referrals.map((item) => item.name).join(", ")}</p>
      ) : null}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-card text-sm">
        {user.orders.map((order) => (
          <li key={order.id} className="flex justify-between gap-3 px-4 py-3">
            <Link className="text-pine" href={`/admin/pedidos/${order.publicCode}`}>{order.publicCode}</Link>
            <span>{formatBRL(order.totalSaleCents)} · {order.paymentStatus}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
