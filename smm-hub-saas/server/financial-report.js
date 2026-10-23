const { db } = require('./db');
function summarize(day = null) {
  const filter = day ? ' WHERE DATE(created_at)=?' : '';
  const args = day ? [day] : [];
  const totals = db
    .prepare(
      `SELECT
 COALESCE(SUM(CASE WHEN type IN ('order_debit','scheduled_order','autopilot','subscription_auto','recurring') THEN -amount_cents ELSE 0 END),0) AS gross,
 COALESCE(SUM(CASE WHEN type='order_refund' THEN amount_cents ELSE 0 END),0) AS refunds,
 COALESCE(SUM(CASE WHEN type IN ('cashback','cashback_reversal','streak_bonus','daily_spin_bonus','mission_reward','giveaway_prize') OR type LIKE 'affiliate_commission_%' THEN amount_cents ELSE 0 END),0) AS incentives,
 COALESCE(SUM(CASE WHEN type IN ('deposit_pix','deposit_crypto') THEN amount_cents ELSE 0 END),0) AS deposits,
 SUM(CASE WHEN type IN ('deposit_pix','deposit_crypto') THEN 1 ELSE 0 END) AS deposit_count
 FROM transactions${filter}`
    )
    .get(...args);
  const costFilter = day ? ' AND DATE(updated_at)=?' : '';
  const cost = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN status='partial' THEN ROUND(cost_cents * MAX(0,quantity-remains)*1.0/quantity) ELSE cost_cents END),0) AS n FROM orders WHERE status IN ('completed','partial')${costFilter}`
    )
    .get(...args).n;
  const net = totals.gross - totals.refunds;
  return {
    gross_revenue_cents: totals.gross,
    refunds_cents: totals.refunds,
    net_revenue_cents: net,
    incentives_cents: totals.incentives,
    estimated_fulfillment_cost_cents: cost,
    estimated_profit_cents: net - cost - totals.incentives,
    deposits_cents: totals.deposits,
    deposits_count: totals.deposit_count || 0,
    cost_basis:
      'Estimativa do custo registrado nos pedidos; taxas e liquidação upstream exigem conciliação.',
  };
}
module.exports = { summarize };
