const { placeOrder } = require('../order-domain');
const express = require('express');
const crypto = require('node:crypto');
const { db, debitBalanceAtomic, tx } = require('../db');
const { dispatchOrder, requestRefill } = require('../smm-engine');

const router = express.Router();

// SMM API v2 accepts application/x-www-form-urlencoded or application/json
router.get('/', (req, res) =>
  res
    .status(405)
    .set('Allow', 'POST')
    .json({ error: 'Use POST e envie a chave no corpo ou em X-API-Key.' })
);
router.post('/', async (req, res, next) => {
  try {
    const params = req.body;
    const key = params.key || req.get('X-API-Key'),
      action = params.action;
    if (
      typeof key !== 'string' ||
      key.length > 256 ||
      typeof action !== 'string' ||
      action.length > 32
    )
      return res.status(400).json({ error: 'Chave ou ação inválida.' });

    if (!key) {
      return res
        .status(401)
        .json({ error: 'Chave de API não informada (key is missing)' });
    }

    let user;
    try {
      user = require('../ops-desk').userByApiKey(key);
    } catch {
      user = db
        .prepare('SELECT id, balance_cents, status FROM users WHERE api_key = ?')
        .get(key);
    }
    if (!user || user.status !== 'active') {
      return res
        .status(401)
        .json({ error: 'Chave de API inválida ou conta inativa' });
    }

    // ACTION: BALANCE
    if (action === 'balance') {
      return res.json({
        balance: (user.balance_cents / 100).toFixed(2),
        currency: 'BRL',
      });
    }

    // ACTION: SERVICES
    if (action === 'services') {
      const services = db
        .prepare(
          `
      SELECT s.id as service, s.name, s.type, c.name as category,
             (CAST(s.price_per_k_cents AS REAL) / 100.0) as rate,
             s.min_quantity as min, s.max_quantity as max,
             CASE WHEN s.refill_available = 1 THEN 1 ELSE 0 END as refill,
             CASE WHEN s.cancel_available = 1 THEN 1 ELSE 0 END as cancel
      FROM services s
      JOIN categories c ON s.category_id = c.id
      WHERE s.status = 'active'
      ORDER BY c.sort_order ASC, s.id ASC
    `
        )
        .all();

      return res.json(services);
    }

    // ACTION: ADD
    if (action === 'add') {
      try {
        const result = placeOrder(user.id, {
          service_id: params.service,
          link: params.link,
          quantity: params.quantity,
          comments: params.comments,
        });
        dispatchOrder(result.id).catch(() => {});
        return res.json({ order: result.id });
      } catch (err) {
        if (err.status)
          return res.status(err.status).json({ error: err.message });
        throw err;
      }
    }

    // ACTION: STATUS (single or multiple)
    if (action === 'status') {
      const { order, orders } = params;

      if (orders) {
        if (
          typeof orders !== 'string' ||
          orders.length > 1200 ||
          orders.split(',').length > 100 ||
          !/^\d+(,\s*\d+)*$/.test(orders)
        )
          return res.status(400).json({ error: 'Use até 100 IDs inteiros.' });
        const orderIds = String(orders)
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter(Boolean);
        const results = {};
        for (const oId of orderIds) {
          const row = db
            .prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
            .get(oId, user.id);
          if (!row) {
            results[oId] = { error: 'Incorrect order ID' };
          } else {
            results[oId] = {
              charge: (row.charge_cents / 100).toFixed(2),
              start_count: String(row.start_count || 0),
              status:
                row.status === 'in_progress'
                  ? 'In progress'
                  : row.status.charAt(0).toUpperCase() + row.status.slice(1),
              remains: String(row.remains || 0),
              currency: 'BRL',
            };
          }
        }
        return res.json(results);
      }

      if (order) {
        const row = db
          .prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
          .get(order, user.id);
        if (!row) {
          return res.status(400).json({ error: 'Incorrect order ID' });
        }

        return res.json({
          charge: (row.charge_cents / 100).toFixed(2),
          start_count: String(row.start_count || 0),
          status:
            row.status === 'in_progress'
              ? 'In progress'
              : row.status.charAt(0).toUpperCase() + row.status.slice(1),
          remains: String(row.remains || 0),
          currency: 'BRL',
        });
      }

      return res
        .status(400)
        .json({ error: 'Parâmetro order ou orders não fornecido.' });
    }

    // ACTION: REFILL
    if (action === 'refill') {
      const { order } = params;
      if (!order)
        return res.status(400).json({ error: 'ID da ordem não fornecido.' });

      try {
        const row = db
          .prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?')
          .get(order, user.id);
        if (!row)
          return res.status(400).json({ error: 'Ordem não encontrada.' });
        await requestRefill(row.id,params.run);
        return res.json({ refill: '1' });
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }

    return res
      .status(400)
      .json({ error: 'Ação desconhecida (Unknown action)' });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
