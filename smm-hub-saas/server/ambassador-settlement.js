const { db, tx, creditBalanceAtomic } = require('./db');
function settle({ orderId }) {
  return tx(() => {
    const row = db
      .prepare(
        "SELECT c.*,a.user_id,o.uuid,o.status AS order_status FROM ambassador_order_commissions c JOIN ambassador_coupons a ON c.ambassador_id=a.id JOIN orders o ON c.order_id=o.id WHERE c.order_id=? AND c.status='pending'"
      )
      .get(orderId);
    if (!row) return;
    if (new Date(row.settles_at) > new Date())
      throw new Error('Liquidação ainda não está vencida.');
    const refunded = db
      .prepare(
        "SELECT 1 FROM transactions WHERE reference_id=? AND type='order_refund'"
      )
      .get(row.uuid);
    if (row.order_status !== 'completed' || refunded) {
      db.prepare(
        "UPDATE ambassador_order_commissions SET status='canceled' WHERE order_id=?"
      ).run(orderId);
      return;
    }
    const user = db
      .prepare("SELECT id FROM users WHERE id=? AND status='active'")
      .get(row.user_id);
    if (!user) {
      db.prepare(
        "UPDATE ambassador_order_commissions SET status='held' WHERE order_id=?"
      ).run(orderId);
      return;
    }
    const balance = creditBalanceAtomic(row.user_id, row.amount_cents);
    if (balance === null) throw new Error('Crédito de comissão recusado.');
    db.prepare(
      "INSERT INTO transactions(user_id,type,amount_cents,balance_after_cents,reference_id,description) VALUES(?,'affiliate_commission_campaign',?,?,?,'Comissão liquidada após janela de garantia')"
    ).run(row.user_id, row.amount_cents, balance, row.uuid);
    db.prepare(
      "UPDATE ambassador_order_commissions SET status='paid',paid_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='pending'"
    ).run(orderId);
    db.prepare(
      'UPDATE ambassador_coupons SET total_commissions_cents=total_commissions_cents+? WHERE id=?'
    ).run(row.amount_cents, row.ambassador_id);
  });
}
module.exports = { settle };
