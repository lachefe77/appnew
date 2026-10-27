import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import { formatBRL } from "@/lib/format";
import { OrderAdminButtons } from "@/components/admin-actions";

export type OrderRow = {
  publicCode: string;
  channel: string;
  customerName: string;
  totalSaleCents: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  trackingCode: string | null;
  createdAt: string;
  title: string;
};

export function OrderTable({ orders, admin = false }: { orders: OrderRow[]; admin?: boolean }) {
  if (orders.length === 0) return <p className="text-sm text-muted">Nenhum pedido ainda.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.14em] text-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Pedido</th>
            <th className="py-2 pr-3 font-medium">Cliente</th>
            <th className="py-2 pr-3 font-medium">Valor</th>
            <th className="py-2 pr-3 font-medium">Pagamento</th>
            <th className="py-2 pr-3 font-medium">Despacho</th>
            {admin ? <th className="py-2 font-medium">Ações</th> : null}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.publicCode} className="border-t border-line align-top">
              <td className="py-3 pr-3">
                <Link href={admin ? `/admin/pedidos/${order.publicCode}` : `/pedido/${order.publicCode}`} className="font-medium hover:text-copper">{order.publicCode}</Link>
                <p className="text-xs text-muted">{order.channel} · {order.title}</p>
              </td>
              <td className="py-3 pr-3">{order.customerName}</td>
              <td className="py-3 pr-3 tabular-nums">{formatBRL(order.totalSaleCents)}</td>
              <td className="py-3 pr-3"><StatusBadge kind="pay" value={order.paymentStatus} /></td>
              <td className="py-3 pr-3">
                <StatusBadge kind="ship" value={order.fulfillmentStatus} />
                {order.trackingCode ? <p className="mt-1 text-xs text-muted">{order.trackingCode}</p> : null}
              </td>
              {admin ? (
                <td className="py-3">
                  <OrderAdminButtons
                    publicCode={order.publicCode}
                    canTrack={order.paymentStatus === "PAID" && order.fulfillmentStatus !== "WAITING_PAYMENT"}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
