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
  await requireUser(["ADMIN", "OPERATOR"]);
  const start = new Date(`${dayKey(new Date())}T00:00:00-03:00`);
  const weekStart = new Date(start.getTime() - 6 * 24 * 60 * 60 * 1000);
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
  const days = Array.from({ length: 7 }, (_, index) => dayKey(new Date(weekStart.getTime() + index * 24 * 60 * 60 * 1000)));
  const byDay = days.map((key) => ({
    key,
    count: week.filter((order) => dayKey(order.createdAt) === key).length,
  }));
  const max = Math.max(1, ...byDay.map((day) => day.count));

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
        <h2 className="text-xl font-semibold">Pedidos pagos nos últimos 7 dias</h2>
        <ul className="mt-4 space-y-2">
          {byDay.map((day) => (
            <li key={day.key} className="grid grid-cols-[88px_1fr_24px] items-center gap-3 text-sm">
              <span className="text-muted">{day.key.slice(5)}</span>
              <span className="h-2 rounded-full bg-pineSoft">
                <span className="block h-2 rounded-full bg-pine" style={{ width: `${(day.count / max) * 100}%` }} />
              </span>
              <span>{day.count}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Horário de São Paulo. Cada barra é a quantidade de pedidos pagos criados no dia.</p>
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
          <h2 className="text-xl font-semibold">Leituras da conta mestre</h2>
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
