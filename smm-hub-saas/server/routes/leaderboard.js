const express = require('express');
const { db } = require('../db');

const router = express.Router();

/**
 * Monthly Leaderboard (Top 10 buyers)
 */
router.get('/', (req, res) => {
  try {
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const topBuyers = db.prepare(`
      SELECT u.id, u.name, u.tier,
             COALESCE(SUM(o.charge_cents), 0) as total_spent_cents,
             COUNT(o.id) as total_orders
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.created_at >= ? AND o.status != 'canceled'
      GROUP BY u.id
      ORDER BY total_spent_cents DESC
      LIMIT 10
    `).all(firstDayOfMonth);

    const prizes = [
      { rank: 1, prize: 'R$ 250,00 em Saldo', badge: '👑 CAMPEÃO MENSAL' },
      { rank: 2, prize: 'R$ 100,00 em Saldo', badge: '🥈 VICE-CAMPEÃO' },
      { rank: 3, prize: 'R$ 50,00 em Saldo', badge: '🥉 3º LUGAR' }
    ];

    const ranked = topBuyers.map((b, idx) => {
      const parts = b.name.split(' ');
      const masked = parts[0] + (parts.length > 1 ? ` ${parts[1][0]}.***` : ' ***');
      return {
        rank: idx + 1,
        user_masked: masked,
        tier: b.tier,
        total_spent_formatted: `R$ ${(b.total_spent_cents / 100).toFixed(2).replace('.', ',')}`,
        total_orders: b.total_orders,
        prize: prizes[idx] ? prizes[idx].prize : 'Badge VIP Exclusivo',
        badge: prizes[idx] ? prizes[idx].badge : null
      };
    });

    res.json({
      month_name: new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' }),
      leaderboard: ranked
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
