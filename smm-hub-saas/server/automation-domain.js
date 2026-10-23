const { db, tx } = require('./db');
const { quoteOrder, insertOrder } = require('./order-domain');
const { dispatchOrder } = require('./smm-engine');
const logger = require('./logger');
function isUserOnVacation(id) {
  return !!db
    .prepare(
      "SELECT user_id FROM vacation_mode WHERE user_id=? AND datetime('now') BETWEEN datetime(starts_at) AND datetime(ends_at)"
    )
    .get(id);
}
function eligible(id) {
  return (
    !isUserOnVacation(id) &&
    !!db
      .prepare(
        "SELECT id FROM users WHERE id=? AND status='active' AND deleted_at IS NULL"
      )
      .get(id)
  );
}
function claim(kind, id, period) {
  return (
    db
      .prepare(
        'INSERT OR IGNORE INTO automation_runs(kind,config_id,period) VALUES(?,?,?)'
      )
      .run(kind, id, period).changes > 0
  );
}
function link(kind, id, period, order) {
  db.prepare(
    'INSERT INTO automation_orders(kind,config_id,period,order_id) VALUES(?,?,?,?)'
  ).run(kind, id, period, order.id);
  return order;
}
function dispatch(orders) {
  for (const order of orders)
    dispatchOrder(order.id).catch((e) =>
      logger.error(
        { orderId: order.id, err: e.message },
        'Despacho automático pendente'
      )
    );
}
function scheduledTick() {
  const jobs = db
    .prepare(
      "SELECT * FROM scheduled_orders WHERE status='pending' AND datetime(run_at)<=CURRENT_TIMESTAMP ORDER BY run_at LIMIT 20"
    )
    .all();
  for (const job of jobs) {
    if (!eligible(job.user_id)) continue;
    try {
      const orders = tx(() => {
        if (!claim('schedule', job.id, job.run_at)) return [];
        const order = insertOrder(job.user_id, {
          service_id: job.service_id,
          quantity: job.quantity,
          link: job.link,
        });
        db.prepare(
          "UPDATE scheduled_orders SET status='executed',order_id=? WHERE id=? AND status='pending'"
        ).run(order.id, job.id);
        return [link('schedule', job.id, job.run_at, order)];
      });
      dispatch(orders);
    } catch (e) {
      db.prepare(
        "UPDATE scheduled_orders SET status='failed' WHERE id=? AND status='pending'"
      ).run(job.id);
      logger.warn(
        { job: job.id, error: e.message },
        'Agendamento não executado'
      );
    }
  }
}
function validateAllocation(allocation) {
  return (
    Array.isArray(allocation) &&
    allocation.length > 0 &&
    allocation.length <= 20 &&
    allocation.every(
      (x) =>
        x &&
        Number.isSafeInteger(Number(x.service_id)) &&
        typeof x.link === 'string' &&
        Number.isFinite(Number(x.pct)) &&
        Number(x.pct) > 0 &&
        Number(x.pct) <= 100
    ) &&
    Math.abs(allocation.reduce((n, x) => n + Number(x.pct), 0) - 100) < 0.00001
  );
}
function autopilotTick() {
  const now = new Date(),
    month = now.toISOString().slice(0, 7),
    week = Math.floor((now.getUTCDate() - 1) / 7),
    period = month + ':' + week;
  for (const c of db
    .prepare('SELECT * FROM autopilot_configs WHERE is_active=1 LIMIT 100')
    .all()) {
    if (!eligible(c.user_id)) continue;
    try {
      const orders = tx(() => {
        if (!claim('autopilot', c.id, period)) return [];
        const alloc = JSON.parse(c.allocation_json);
        if (!validateAllocation(alloc)) throw new Error('Alocação inválida.');
        const spent = db
          .prepare(
            "SELECT COALESCE(SUM(o.charge_cents),0) AS n FROM automation_orders a JOIN orders o ON o.id=a.order_id WHERE a.kind='autopilot' AND a.config_id=? AND substr(a.period,1,7)=?"
          )
          .get(c.id, month).n;
        const weeks = Math.ceil(
            new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate() /
              7
          ),
          budget = Math.min(
            c.budget_monthly_cents - spent,
            Math.floor(c.budget_monthly_cents / weeks)
          );
        if (budget <= 0) return [];
        const result = [];
        let remaining = budget;
        for (const item of alloc) {
          const svc = db
            .prepare("SELECT * FROM services WHERE id=? AND status='active'")
            .get(item.service_id);
          if (!svc || svc.price_per_k_cents <= 0) continue;
          const share = Math.min(
            remaining,
            Math.floor((budget * item.pct) / 100)
          );
          const qty = Math.min(
            svc.max_quantity,
            Math.floor((share * 1000) / svc.price_per_k_cents)
          );
          if (qty < svc.min_quantity) continue;
          const input = { service_id: svc.id, quantity: qty, link: item.link };
          const quote = quoteOrder(c.user_id, input);
          if (quote.charge_cents > share) continue;
          const order = insertOrder(c.user_id, input);
          result.push(link('autopilot', c.id, period, order));
          remaining -= order.charge_cents;
        }
        db.prepare(
          'UPDATE autopilot_configs SET last_run_at=CURRENT_TIMESTAMP WHERE id=?'
        ).run(c.id);
        return result;
      });
      dispatch(orders);
    } catch (e) {
      logger.warn(
        { config: c.id, error: e.message },
        'Autopilot não executado'
      );
    }
  }
}
function contractsTick() {
  for (const c of db
    .prepare(
      'SELECT * FROM recurring_contracts WHERE is_active=1 AND datetime(next_run)<=CURRENT_TIMESTAMP LIMIT 50'
    )
    .all()) {
    if (!eligible(c.user_id)) continue;
    try {
      const orders = tx(() => {
        if (!claim('contract', c.id, c.next_run)) return [];
        const alloc = JSON.parse(c.allocation_json);
        if (
          !Array.isArray(alloc) ||
          alloc.length < 1 ||
          alloc.length > 20 ||
          !Number.isSafeInteger(c.amount_cents) ||
          c.amount_cents <= 0 ||
          c.interval_days < 1 ||
          c.interval_days > 365
        )
          throw new Error('Contrato inválido.');
        const quotes = alloc.map((x) => quoteOrder(c.user_id, x));
        if (quotes.reduce((n, q) => n + q.charge_cents, 0) > c.amount_cents)
          throw new Error('Preço atual excede o teto contratado.');
        const result = alloc.map((x) =>
          link('contract', c.id, c.next_run, insertOrder(c.user_id, x))
        );
        const next = new Date(
          new Date(c.next_run).getTime() + c.interval_days * 86400000
        ).toISOString();
        db.prepare('UPDATE recurring_contracts SET next_run=? WHERE id=?').run(
          next,
          c.id
        );
        return result;
      });
      dispatch(orders);
    } catch (e) {
      logger.warn(
        { contract: c.id, error: e.message },
        'Contrato não executado'
      );
    }
  }
}
module.exports = {
  scheduledTick,
  autopilotTick,
  contractsTick,
  isUserOnVacation,
  validateAllocation,
};
