const express = require('express');
const { db } = require('../db');
const { requireAuth, extractToken, verifyToken } = require('../auth');

const router = express.Router();

/**
 * SSE: progresso de uma ordem ao vivo.
 * Consumir por fetch com Authorization: Bearer e leitura de response.body.
 */
router.get('/order/:id', requireAuth, (req, res) => {
  const order = db
    .prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!order) return res.status(404).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let lastSnapshot = null;
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'connected' });

  const timer = setInterval(() => {
    if (!verifyToken(extractToken(req))) {
      clearInterval(timer);
      send({ type: 'session_expired' });
      return res.end();
    }
    const row = db
      .prepare(
        `SELECT id, status, start_count, remains, quantity, updated_at FROM orders WHERE id = ?`
      )
      .get(req.params.id);
    if (!row) {
      clearInterval(timer);
      send({ type: 'gone' });
      return res.end();
    }
    const { delivered, percent } = require('../order-progress').progress(row);
    const snapshot = `${row.status}|${delivered}|${percent}`;
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      send({
        type: 'progress',
        status: row.status,
        delivered,
        percent,
        remains: row.remains,
        updated_at: row.updated_at,
      });
    }
    if (['completed', 'canceled', 'failed'].includes(row.status)) {
      clearInterval(timer);
      send({ type: 'done', final_status: row.status });
      res.end();
    }
  }, 3000);

  req.on('close', () => clearInterval(timer));
});

module.exports = router;
