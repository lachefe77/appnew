const { db } = require('../db');
const logger = require('../logger');

function captureSnapshot() {
  const today = new Date().toISOString().split('T')[0];

  const orders = db
    .prepare(
      `
    SELECT COALESCE(SUM(charge_cents),0) as rev, COALESCE(SUM(cost_cents),0) as cost,
           COALESCE(SUM(profit_cents),0) as profit, COUNT(*) as n
    FROM orders WHERE DATE(created_at) = ?`
    )
    .get(today);
  const deposits = db
    .prepare(
      `
    SELECT COALESCE(SUM(amount_cents),0) as sum, COUNT(*) as n
    FROM pix_invoices WHERE status='paid' AND DATE(paid_at) = ?`
    )
    .get(today);
  const usersTotal = db
    .prepare('SELECT COUNT(*) as c FROM users WHERE deleted_at IS NULL')
    .get().c;
  const finance = require('../financial-report').summarize(today);
  orders.rev = finance.net_revenue_cents;
  orders.cost = finance.estimated_fulfillment_cost_cents;
  orders.profit = finance.estimated_profit_cents;
  deposits.sum = finance.deposits_cents;
  deposits.n = finance.deposits_count;

  db.prepare(
    `INSERT INTO financial_snapshots
    (snapshot_date, revenue_cents, cost_cents, profit_cents, orders_count, deposits_count, deposits_cents, users_total)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      revenue_cents=excluded.revenue_cents, cost_cents=excluded.cost_cents,
      profit_cents=excluded.profit_cents, orders_count=excluded.orders_count,
      deposits_count=excluded.deposits_count, deposits_cents=excluded.deposits_cents,
      users_total=excluded.users_total`
  ).run(
    today,
    orders.rev,
    orders.cost,
    orders.profit,
    orders.n,
    deposits.n,
    deposits.sum,
    usersTotal
  );

  logger.info(
    { date: today, orders: orders.n, revenue: orders.rev },
    'Snapshot financeiro salvo'
  );
  return {
    date: today,
    ...orders,
    deposits_count: deposits.n,
    deposits_cents: deposits.sum,
  };
}

function startSnapshotWorker() {
  // Executa agora e depois a cada 1h
  try {
    captureSnapshot();
  } catch (e) {
    logger.error({ err: e.message }, 'Snapshot inicial falhou');
  }
  setInterval(
    () => {
      try {
        captureSnapshot();
      } catch (e) {
        logger.error({ err: e.message }, 'Snapshot falhou');
      }
    },
    60 * 60 * 1000
  );
}

if (require.main === module) captureSnapshot();
module.exports = { captureSnapshot, startSnapshotWorker };
