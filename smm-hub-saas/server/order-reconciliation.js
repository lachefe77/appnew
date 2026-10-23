const { db, tx } = require('./db');
function applyProviderStatus(orderId, remoteId, data) {
  return tx(() => {
    const order = db
      .prepare(
        "SELECT * FROM orders WHERE id=? AND remote_order_id=? AND status IN ('processing','in_progress','awaiting_confirmation')"
      )
      .get(orderId, String(remoteId));
    if (!order) return { applied: false };
    if(order.is_dripfeed)return require('./drip-domain').progress(order,remoteId,data);
    const remote =
      typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
    const statuses = {
      completed: 'completed',
      partial: 'partial',
      canceled: 'canceled',
      cancelled: 'canceled',
      refunded: 'canceled',
      'in progress': 'in_progress',
      processing: 'in_progress',
      pending: 'processing',
    };
    const status = Object.hasOwn(statuses, remote) ? statuses[remote] : null;
    if (!status) return { applied: false };
    let remains =
      status === 'completed'
        ? 0
        : status === 'canceled'
          ? order.quantity
          : Number(data.remains);
    if (remote === 'pending' && data.remains == null) remains = order.quantity;
    if (
      !Number.isSafeInteger(remains) ||
      remains < 0 ||
      remains > order.quantity
    )
      throw new Error('Quantidade restante inválida na resposta do provedor.');
    const rawStart = Number(data.start_count),
      start =
        Number.isSafeInteger(rawStart) && rawStart >= 0
          ? rawStart
          : order.start_count;
    db.prepare(
      'UPDATE orders SET status=?,start_count=?,remains=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(status, start, remains, order.id);
    if (status === 'partial' || status === 'canceled')
      require('./job-queue').enqueue(
        'refund-order',
        { orderId: order.id, partial: status === 'partial', remains },
        {
          id:
            'refund:' +
            order.id +
            ':' +
            (status === 'partial' ? remains : 'full'),
        }
      );
    return { applied: true, status };
  });
}
async function tick() {
  db.prepare("UPDATE drip_batches SET status='submitted',remote_id=(SELECT remote_order_id FROM orders WHERE id=order_id),provider_id=(SELECT provider_id FROM orders WHERE id=order_id) WHERE status='pending' AND run=(SELECT MIN(b.run) FROM drip_batches b WHERE b.order_id=drip_batches.order_id AND b.status='pending') AND EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND o.is_dripfeed=1 AND o.remote_order_id IS NOT NULL AND o.status IN ('processing','in_progress','awaiting_confirmation'))").run();
  db.prepare(
    "UPDATE orders SET status='awaiting_confirmation',updated_at=CURRENT_TIMESTAMP WHERE status='dispatching' AND datetime(updated_at)<datetime('now','-2 minutes')"
  ).run();
  const refunds = db
    .prepare(
      `WITH due AS (SELECT o.id,o.status,o.remains,CASE WHEN o.status='partial' THEN ROUND(o.charge_cents*o.remains*1.0/o.quantity) ELSE o.charge_cents END AS expected,COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.type='order_refund' AND t.reference_id=o.uuid),0) AS refunded FROM orders o WHERE o.status IN ('failed','canceled','partial') AND typeof(o.remains)='integer' AND o.remains BETWEEN 0 AND o.quantity) SELECT id,status,remains FROM due WHERE expected>refunded LIMIT 50`
    )
    .all();
  for (const order of refunds)
    try {
      require('./smm-engine').refundOrder(
        order.id,
        order.status === 'partial',
        order.remains
      );
    } catch (error) {
      require('./logger').error(
        { orderId: order.id, error: error.message },
        'Conciliação do estorno falhou'
      );
    }
  const completions = db
    .prepare(
      "SELECT id FROM orders o WHERE status='completed' AND NOT EXISTS(SELECT 1 FROM order_effects e WHERE e.order_id=o.id AND e.effect='completed') ORDER BY id LIMIT 50"
    )
    .all();
  for (const order of completions)
    await require('./smm-engine').handleOrderCompleted(order.id);
}
function start() {
  return require('./worker-lease').startLeased(
    'order-reconciliation',
    tick,
    30000
  );
}
module.exports = { applyProviderStatus, tick, start };
