import { AdminActions } from "@/components/admin-actions";
import { Card, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { config } from "@/server/config";
import { prisma } from "@/server/db";
import { getMasterBalance, getPause, getSetting } from "@/server/settings";

export default async function AdminPage() {
  await requireUser(["ADMIN"]);
  const [cj, bling, pause, lastRun, paid, failed, alerts] = await Promise.all([
    getMasterBalance("CJ_BRAZIL"),
    getMasterBalance("BLING_HUB"),
    getPause(),
    getSetting<{ at?: string }>("watchdog_last_run", {}),
    prisma.order.count({ where: { paymentStatus: "PAID" } }),
    prisma.order.count({ where: { fulfillmentStatus: "FAILED", paymentStatus: { not: "REFUNDED" } } }),
    prisma.adminAlert.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Administração</p>
        <h1 className="font-display text-4xl">Liquidez e fila</h1>
      </div>
      {pause.paused ? (
        <Card className="border-copper bg-[#fff1ea]">
          <p className="font-medium">Fila de despacho pausada</p>
          <p className="text-sm text-muted">{pause.reason}</p>
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Saldo CJ" value={formatMoney(cj.cents, cj.currency)} hint={`Alerta abaixo de ${formatMoney(cj.currency === "USD" ? config.cjLowBalanceCents : config.lowBalanceCents, cj.currency)}`} />
        <Stat label="Saldo galpão" value={formatMoney(bling.cents, bling.currency)} hint={`Alerta abaixo de ${formatMoney(config.lowBalanceCents, "BRL")}`} />
        <Stat label="Pedidos pagos" value={String(paid)} />
        <Stat label="Falhas" value={String(failed)} hint={lastRun.at ? `Watchdog ${new Date(lastRun.at).toLocaleString("pt-BR")}` : "Watchdog ainda não rodou"} />
      </div>
      <AdminActions paused={pause.paused} />
      <Card>
        <h2 className="font-display text-2xl">Alertas</h2>
        <ul className="mt-3 space-y-3">
          {alerts.map((alert) => (
            <li key={alert.id} className="rounded-2xl bg-paper px-3 py-3 text-sm">
              <p className="font-medium">{alert.title}</p>
              <p className="text-muted">{alert.body}</p>
            </li>
          ))}
          {alerts.length === 0 ? <li className="text-sm text-muted">Nenhum alerta. O watchdog grava aqui e, se houver token, manda no Telegram.</li> : null}
        </ul>
      </Card>
    </div>
  );
}
