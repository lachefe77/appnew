import { AdminActions } from "@/components/admin-actions";
import { Card, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { getCommerce } from "@/server/commerce";
import { prisma } from "@/server/db";
import { getMasterBalance, getPause, getSetting } from "@/server/settings";

function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
}

export default async function AdminPage() {
  await requireUser(["MASTER", "ADMIN", "SUPPORT", "OPERATOR"]);
  const start = new Date(`${dayKey(new Date())}T00:00:00-03:00`);
  const weekStart = new Date(start.getTime() - 13 * 24 * 60 * 60 * 1000);
  const [cj, bling, pause, lastRun, commerce, today, week, failed, alerts, snapshots, supplied] = await Promise.all([
    getMasterBalance("CJ_BRAZIL"),
    getMasterBalance("BLING_HUB"),
    getPause(),
    getSetting<{ at?: string }>("watchdog_last_run", {}),
    getCommerce(),
    prisma.order.findMany({ where: { paymentStatus: "PAID", createdAt: { gte: start } } }),
    prisma.order.findMany({
      where: { paymentStatus: "PAID", createdAt: { gte: weekStart } },
      select: { createdAt: true, channel: true, totalSaleCents: true, totalWholesaleCents: true, totalCostCents: true },
    }),
    prisma.order.count({ where: { fulfillmentStatus: "FAILED", paymentStatus: { not: "REFUNDED" } } }),
    prisma.adminAlert.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.balanceSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.order.aggregate({
      where: { fulfillmentStatus: { in: ["DISPATCHED_TO_SUPPLIER", "SHIPPED", "DELIVERED"] } },
      _sum: { totalCostCents: true },
    }),
  ]);

  const b2c = today.filter((order) => order.channel === "B2C");
  const b2b = today.filter((order) => order.channel === "B2B");
  const pix = b2c.reduce((sum, order) => sum + order.totalSaleCents, 0);
  const wholesale = b2b.reduce((sum, order) => sum + order.totalWholesaleCents, 0);
  const margin = b2c.reduce((sum, order) => sum + order.totalSaleCents - order.totalCostCents, 0) + b2b.reduce((sum, order) => sum + order.totalWholesaleCents - order.totalCostCents, 0);
  const ticket = b2c.length ? Math.round(pix / b2c.length) : 0;
  const days = Array.from({ length: 14 }, (_, index) => dayKey(new Date(weekStart.getTime() + index * 24 * 60 * 60 * 1000)));
  const byDay = days.map((key) => {
    const rows = week.filter((order) => dayKey(order.createdAt) === key);
    const cents = rows.reduce((sum, order) => sum + (order.channel === "B2B" ? order.totalWholesaleCents : order.totalSaleCents), 0);
    return { key, count: rows.length, cents };
  });
  const max = Math.max(1, ...byDay.map((day) => day.cents));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Administração</p>
        <h1 className="text-4xl font-semibold">Operação do dia</h1>
      </div>
      {pause.paused ? (
        <Card className="border-copper bg-pineSoft">
          <p className="font-medium">Fila de despacho pausada</p>
          <p className="text-sm text-muted">{pause.reason}</p>
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="PIX da vitrine hoje" value={formatMoney(pix, "BRL")} hint={`${b2c.length} pedidos`} />
        <Stat label="Atacado debitado hoje" value={formatMoney(wholesale, "BRL")} hint={`${b2b.length} pedidos`} />
        <Stat label="Margem estimada" value={formatMoney(margin, "BRL")} hint="Venda menos custo, ou atacado menos custo" />
        <Stat label="Ticket médio B2C" value={formatMoney(ticket, "BRL")} />
      </div>
      <Card>
        <h2 className="text-xl font-semibold">Vendas pagas nos últimos 14 dias</h2>
        <p className="mt-1 text-xs text-muted">Eixo horizontal: dia em São Paulo. Eixo vertical: reais pagos. Vitrine entra pelo preço de venda. Revenda entra pelo atacado.</p>
        <div className="mt-4 flex h-40 items-end gap-1">
          {byDay.map((day) => (
            <div key={day.key} className="flex h-full flex-1 flex-col justify-end" title={`${day.key}: ${formatMoney(day.cents, "BRL")} · ${day.count} pedidos`}>
              <span className="block rounded-t bg-pine" style={{ height: `${Math.max(4, (day.cents / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>{byDay[0]?.key.slice(5)}</span>
          <span>{formatMoney(byDay.reduce((sum, day) => sum + day.cents, 0), "BRL")} no período</span>
          <span>{byDay.at(-1)?.key.slice(5)}</span>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Saldo CJ" value={formatMoney(cj.cents, cj.currency)} hint={`Alerta abaixo de ${formatMoney(cj.currency === "USD" ? commerce.cjLowBalanceCents : commerce.lowBalanceCents, cj.currency)}`} />
        <Stat label="Saldo galpão" value={formatMoney(bling.cents, bling.currency)} hint={`Alerta abaixo de ${formatMoney(commerce.lowBalanceCents, "BRL")}`} />
        <Stat label="Pago ao fornecedor" value={formatMoney(supplied._sum.totalCostCents ?? 0, "BRL")} hint="Custo dos pedidos já despachados" />
        <Stat label="Falhas" value={String(failed)} hint={lastRun.at ? `Watchdog ${new Date(lastRun.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "Watchdog ainda não rodou"} />
      </div>
      <AdminActions paused={pause.paused} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold">Alertas</h2>
          <ul className="mt-3 space-y-3">
            {alerts.map((alert) => (
              <li key={alert.id} className="rounded-xl bg-paper px-3 py-3 text-sm">
                <p className="font-medium">{alert.title}</p>
                <p className="text-muted">{alert.body}</p>
                <p className="mt-1 text-xs text-muted">{alert.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
              </li>
            ))}
            {alerts.length === 0 ? <li className="text-sm text-muted">Nenhum alerta.</li> : null}
          </ul>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold">Leituras do saldo do galpão</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {snapshots.map((row) => (
              <li key={row.id} className="flex justify-between gap-3">
                <span>{row.source}</span>
                <span>{formatMoney(row.balanceCents, row.currency === "USD" ? "USD" : "BRL")} · {row.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
              </li>
            ))}
            {snapshots.length === 0 ? <li className="text-muted">O watchdog grava uma leitura a cada passagem.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
