import Link from "next/link";
import { LookupForm } from "@/components/lookup-form";
import { formatBRL, fulfillmentLabel, paymentLabel } from "@/lib/format";
import { prisma } from "@/server/db";

export default async function MyOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; cpf?: string; criados?: string }>;
}) {
  const query = await searchParams;
  const created = query.criados?.split(",").filter(Boolean) ?? [];
  const email = query.email?.trim().toLowerCase();
  const cpf = query.cpf?.replace(/\D/g, "");
  const orders = email && cpf && cpf.length === 11
    ? await prisma.order.findMany({
        where: { customerEmail: email, customerCpf: cpf, channel: "B2C" },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Meus pedidos</h1>
      <p className="max-w-xl text-sm text-muted">Informe o mesmo e-mail e CPF usados no checkout. Os dois precisam bater.</p>
      <LookupForm email={email ?? ""} cpf={query.cpf ?? ""} />
      {created.length > 0 ? (
        <div className="rounded-2xl border border-line bg-card p-4 text-sm">
          <p className="font-medium">Pedidos gerados agora</p>
          <ul className="mt-2 space-y-1">
            {created.map((code) => (
              <li key={code}><Link className="text-pine" href={`/pedido/${code}`}>{code}</Link></li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="space-y-3">
        {orders.map((order) => (
          <li key={order.id} className="rounded-2xl border border-line bg-card p-4">
            <Link href={`/pedido/${order.publicCode}`} className="font-medium">{order.publicCode}</Link>
            <p className="text-sm text-muted">{formatBRL(order.totalSaleCents)} · {paymentLabel(order.paymentStatus)} · {fulfillmentLabel(order.fulfillmentStatus)}</p>
          </li>
        ))}
      </ul>
      {email && cpf && orders.length === 0 ? <p className="text-sm text-muted">Nenhum pedido com esse e-mail e CPF.</p> : null}
    </div>
  );
}
