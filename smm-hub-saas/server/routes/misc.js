const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

/* 12. PUSH SUBSCRIPTIONS (FCM-ready) */
router.post('/push/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys)
    return res.status(400).json({ error: 'endpoint e keys obrigatórios.' });
  try {
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys_json) VALUES (?,?,?)`
    ).run(req.user.id, endpoint, JSON.stringify(keys));
  } catch (e) {}
  res.json({ ok: true });
});

/* 47. VACATION MODE */
router.post('/vacation', requireAuth, (req, res) => {
  const { starts_at, ends_at, reason } = req.body;
  if (!starts_at || !ends_at)
    return res.status(400).json({ error: 'Datas obrigatórias.' });
  db.prepare(
    `INSERT INTO vacation_mode (user_id, starts_at, ends_at, reason) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET starts_at=excluded.starts_at, ends_at=excluded.ends_at, reason=excluded.reason`
  ).run(req.user.id, starts_at, ends_at, reason || null);
  res.json({ ok: true });
});

router.delete('/vacation', requireAuth, (req, res) => {
  db.prepare('DELETE FROM vacation_mode WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

/* Status page pública (40) */
router.get('/status-page', (req, res) => {
  const providers = db
    .prepare(
      `SELECT id, name, status, last_ping_ms, last_checked_at FROM providers`
    )
    .all();
  const platforms = db
    .prepare(
      `SELECT s.platform, COUNT(*) as n,
    SUM(CASE WHEN o.status='failed' THEN 1 ELSE 0 END) as failed
    FROM orders o JOIN services s ON o.service_id = s.id
    WHERE o.created_at > datetime('now','-24 hours')
    GROUP BY s.platform`
    )
    .all();
  const health = db
    .prepare(
      `SELECT COUNT(*) as c FROM orders WHERE status IN ('pending','processing','in_progress')`
    )
    .get().c;
  res.json({
    overall:
      providers.length > 0 &&
      providers.every(
        (p) =>
          p.status === 'active' && p.last_ping_ms > 0 && p.last_ping_ms < 2000
      )
        ? 'operational'
        : 'degraded',
    active_orders: health,
    providers: providers.map((p) => ({
      ...p,
      status:
        p.last_ping_ms && p.last_ping_ms < 2000 ? 'operational' : 'degraded',
    })),
    platforms_last24h: platforms,
    checked_at: new Date().toISOString(),
  });
});

module.exports = router;
