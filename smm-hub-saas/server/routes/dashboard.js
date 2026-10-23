const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../auth');
router.use(requireAuth);
router.get('/', (req, res) => {
  const global = db
    .prepare(
      "SELECT COUNT(*) AS total_orders,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_orders,SUM(CASE WHEN DATE(created_at)=DATE('now') THEN 1 ELSE 0 END) AS orders_today FROM orders",
    )
    .get();
  const account = db
    .prepare(
      "SELECT COUNT(*) AS total_orders,COALESCE(SUM(CASE WHEN status IN ('pending','dispatching','processing','in_progress','awaiting_confirmation') THEN 1 ELSE 0 END),0) AS active_orders,COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) AS completed_orders FROM orders WHERE user_id=?",
    )
    .get(req.user.id);
  const services = db
    .prepare("SELECT COUNT(*) AS n FROM services WHERE status='active'")
    .get().n;
  const activity = db
    .prepare(
      "SELECT s.name AS service_name,s.platform,o.quantity,o.created_at FROM orders o JOIN services s ON s.id=o.service_id WHERE o.status NOT IN ('failed','canceled') ORDER BY o.id DESC LIMIT 8",
    )
    .all();
  const recent = db
    .prepare(
      'SELECT o.id,s.name AS service_name,o.status,o.quantity,o.charge_cents,o.created_at FROM orders o JOIN services s ON s.id=o.service_id WHERE o.user_id=? ORDER BY o.id DESC LIMIT 5',
    )
    .all(req.user.id);
  const attention = [];
  for (const row of db
    .prepare(
      `SELECT o.id, o.status, s.name AS service_name FROM orders o JOIN services s ON s.id=o.service_id
       WHERE o.user_id=? AND o.status IN ('failed','partial','awaiting_confirmation')
       ORDER BY o.id DESC LIMIT 6`
    )
    .all(req.user.id))
    attention.push({
      title:
        'Pedido #' +
        row.id +
        (row.status === 'failed'
          ? ' falhou'
          : row.status === 'partial'
            ? ' ficou parcial'
            : ' aguarda confirmação') +
        ' · ' +
        row.service_name,
      view: 'orders',
    });
  for (const row of db
    .prepare(
      `SELECT o.id, s.name AS service_name FROM orders o JOIN services s ON s.id=o.service_id
       WHERE o.user_id=? AND o.is_dripfeed=1 AND o.status IN ('pending','processing','in_progress')
         AND datetime(o.updated_at) < datetime('now','-1 hour')
       ORDER BY o.id DESC LIMIT 4`
    )
    .all(req.user.id))
    attention.push({
      title: 'Entrega parcelada #' + row.id + ' parada · ' + row.service_name,
      view: 'orders',
    });
  for (const row of db
    .prepare(
      `SELECT id, subject FROM tickets WHERE user_id=? AND status='answered' ORDER BY updated_at DESC LIMIT 4`
    )
    .all(req.user.id))
    attention.push({
      title: 'Chamado #' + row.id + ' respondido · ' + row.subject,
      view: 'tickets',
    });
  res
    .set('Cache-Control', 'no-store')
    .json({
      global: {
        ...global,
        completed_orders: global.completed_orders || 0,
        orders_today: global.orders_today || 0,
        active_services: services,
      },
      account,
      recent_orders: recent,
      attention,
      activity,
      updated_at: new Date().toISOString(),
    });
});
module.exports = router;
