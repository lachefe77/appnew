const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/dashboard', (req, res) => {
  const uid = req.user.id;
  const summary = db
    .prepare(
      `SELECT COUNT(*) as orders, COALESCE(SUM(charge_cents),0) as spent, COALESCE(SUM(profit_cents),0) as our_margin
    FROM orders WHERE user_id = ?`
    )
    .get(uid);
  const last30 = db
    .prepare(
      `SELECT DATE(created_at) as day, SUM(charge_cents) as total, COUNT(*) as n
    FROM orders WHERE user_id = ? AND created_at >= datetime('now','-30 days')
    GROUP BY day ORDER BY day ASC`
    )
    .all(uid);
  const byPlatform = db
    .prepare(
      `SELECT s.platform, COUNT(o.id) as orders, SUM(o.charge_cents) as spent
    FROM orders o JOIN services s ON o.service_id = s.id
    WHERE o.user_id = ? GROUP BY s.platform ORDER BY spent DESC`
    )
    .all(uid);
  const topServices = db
    .prepare(
      `SELECT s.name, COUNT(o.id) as n, SUM(o.charge_cents) as total
    FROM orders o JOIN services s ON o.service_id = s.id
    WHERE o.user_id = ? GROUP BY s.id ORDER BY total DESC LIMIT 5`
    )
    .all(uid);

  delete summary.our_margin;
  res.json({
    summary,
    last30,
    by_platform: byPlatform,
    top_services: topServices,
  });
});

module.exports = router;
