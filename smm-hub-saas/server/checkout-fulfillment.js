const crypto = require('node:crypto');
const { db, debitBalanceAtomic } = require('./db');
function fulfillCheckout(invoice) {
  const checkout = db
    .prepare("SELECT * FROM fast_checkouts WHERE txid=? AND status='pending'")
    .get(invoice.txid);
  if (!checkout) return null;
  const service = db
    .prepare("SELECT * FROM services WHERE id=? AND status='active'")
    .get(checkout.service_id);
  const user = db
    .prepare("SELECT * FROM users WHERE id=? AND status='active'")
    .get(invoice.user_id);
  if (!service || !user)
    throw new Error('Checkout requer revisão: serviço ou conta indisponível.');
  if (checkout.amount_cents !== invoice.amount_cents)
    throw new Error('Valor do checkout diverge da fatura.');
  const balance = debitBalanceAtomic(user.id, checkout.amount_cents);
  if (balance === null) throw new Error('Reserva financeira indisponível.');
  const uuid = crypto.randomUUID(),
    cost = Math.round((service.cost_per_k_cents * checkout.quantity) / 1000);
  const inserted = db
    .prepare(
      "INSERT INTO orders(uuid,user_id,service_id,provider_id,link,quantity,charge_cents,cost_cents,profit_cents,status) VALUES(?,?,?,?,?,?,?,?,?,'pending')"
    )
    .run(
      uuid,
      user.id,
      service.id,
      service.provider_id,
      checkout.link,
      checkout.quantity,
      checkout.amount_cents,
      cost,
      checkout.amount_cents - cost
    );
  const id = Number(inserted.lastInsertRowid);
  db.prepare(
    "INSERT INTO transactions(user_id,type,amount_cents,balance_after_cents,reference_id,description) VALUES(?,'order_debit',?,?,?,?)"
  ).run(
    user.id,
    -checkout.amount_cents,
    balance,
    uuid,
    'Checkout #' + checkout.id
  );
  db.prepare(
    "UPDATE fast_checkouts SET status='paid',order_id=?,paid_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'"
  ).run(id, checkout.id);
  db.prepare(
    "INSERT INTO order_events(order_id,event_type,payload_json) VALUES(?,'status.pending',?)"
  ).run(id, JSON.stringify({ source: 'checkout' }));
  return id;
}
module.exports = { fulfillCheckout };
