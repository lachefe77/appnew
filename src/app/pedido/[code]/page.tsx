import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";
import { PixPanel } from "@/components/pix-panel";
import { Card, StatusBadge } from "@/components/ui";
import { CopyBox } from "@/components/copy-box";
import { TxHashForm } from "@/components/simple-forms";
import { formatBRL, trackingMessage } from "@/lib/format";
import { getBrand } from "@/server/brand";
import { isSandboxPayment } from "@/server/config";
import { prisma } from "@/server/db";

const steps = [
  ["Pagamento", ["PAID", "REFUNDED"]],
  ["Fila", ["QUEUED", "DISPATCHED_TO_SUPPLIER", "SHIPPED", "DELIVERED"]],
  ["Fornecedor", ["DISPATCHED_TO_SUPPLIER", "SHIPPED", "DELIVERED"]],
  ["Envio", ["SHIPPED", "DELIVERED"]],
  ["Entrega", ["DELIVERED"]],
] as const;

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const order = await prisma.order.findUnique({
    where: { publicCode: code },
    include: { items: true, charge: true },
  });
  if (!order) notFound();
  const brand = await getBrand();
  const usdt = brand.usdtBrlCents > 0 ? (order.totalSaleCents / brand.usdtBrlCents).toFixed(2) : null;
  const address = order.shippingAddressJson as { street?: string; number?: string; city?: string; state?: string };

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">{order.channel === "B2B" ? "Pedido de revenda" : "Pedido da vitrine"}</p>
          <h1 className="font-display text-4xl">{order.publicCode}</h1>
        </div>
        <div className="flex gap-2">
          <StatusBadge kind="pay" value={order.paymentStatus} />
          <StatusBadge kind="ship" value={order.fulfillmentStatus} />
        </div>
      </div>
      <Card>
        <ol className="grid gap-3 sm:grid-cols-5">
          {steps.map(([label, done]) => {
            const reached = (done as readonly string[]).includes(order.fulfillmentStatus) || (label === "Pagamento" && order.paymentStatus === "PAID");
            return (
              <li key={label} className={`rounded-2xl px-3 py-3 text-sm ${reached ? "bg-pineSoft text-pine" : "bg-paper text-muted"}`}>
                {label}
              </li>
            );
          })}
        </ol>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <h2 className="font-display text-2xl">Itens</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>{item.quantity}× {item.title}</span>
                <span className="tabular-nums">{formatBRL(item.unitSaleCents * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            {order.customerName} · {address.street}, {address.number} · {address.city}/{address.state}
          </p>
          {order.trackingCode ? <div className="mt-3"><CopyBox text={trackingMessage(order)} /></div> : null}
          {order.failureReason ? <p className="mt-3 text-sm text-red-700">{order.failureReason}</p> : null}
          {order.supplierOrderId ? <p className="mt-2 text-xs text-muted">Fornecedor: {order.supplierOrderId}</p> : null}
        </Card>
        <Card>
          {order.paymentStatus === "PENDING" && order.payMethod === "USDT" ? (
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold">Pagar em USDT</h2>
              <p className="text-sm text-muted">Rede {brand.usdtNetwork}. Estimativa pela cotação do admin: {usdt} USDT para {formatBRL(order.totalSaleCents)}. A equipe confere o hash antes de despachar.</p>
              <p className="break-all text-sm">{order.pixCopyPaste}</p>
              {order.cryptoTxHash ? <p className="text-sm">Hash informado: {order.cryptoTxHash}</p> : <TxHashForm publicCode={order.publicCode} />}
            </div>
          ) : order.paymentStatus === "PENDING" && order.payMethod === "BOLETO" && order.boletoLine && order.charge ? (
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold">Boleto</h2>
              <CopyBox text={order.boletoLine} label="Copiar linha digitável" />
              {isSandboxPayment() ? (
                <PixPanel amountCents={order.totalSaleCents} copyPaste={order.boletoLine} qrCodeBase64={order.pixQrCodeBase64 ?? ""} externalId={order.charge.externalId} sandbox status={order.paymentStatus} />
              ) : null}
            </div>
          ) : order.paymentStatus === "PENDING" && order.pixCopyPaste && order.pixQrCodeBase64 && order.charge ? (
            <PixPanel
              amountCents={order.totalSaleCents}
              copyPaste={order.pixCopyPaste}
              qrCodeBase64={order.pixQrCodeBase64}
              externalId={order.charge.externalId}
              sandbox={isSandboxPayment()}
              status={order.paymentStatus}
            />
          ) : (
            <div>
              <h2 className="font-display text-2xl">{order.paymentStatus === "PAID" ? "Pagamento confirmado" : "Sem PIX pendente"}</h2>
              <p className="mt-2 text-sm text-muted">
                {order.channel === "B2B"
                  ? "Este pedido foi pago com o saldo da carteira do revendedor."
                  : "A tela atualiza sozinha enquanto o despacho anda."}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
