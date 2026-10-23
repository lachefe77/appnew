const express = require('express');
const { db } = require('../db');

const router = express.Router();

/**
 * Public Order Tracker (No auth required)
 */
router.get('/:query', (req, res) => {
  try {
    const q = req.params.query.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)
    )
      return res.status(404).json({ error: 'Código de rastreio inválido.' });

    const order = db
      .prepare(
        `
      SELECT o.id, o.uuid, o.link, o.quantity, o.start_count, o.remains, o.status, o.created_at, o.updated_at,
             s.name as service_name, s.platform
      FROM orders o
      JOIN services s ON o.service_id = s.id
      WHERE o.uuid = ?
      ORDER BY o.id DESC
      LIMIT 1
    `
      )
      .get(q);

    if (!order) {
      return res
        .status(404)
        .json({ error: 'Nenhum pedido encontrado com este código ou link.' });
    }

    const delivered = Math.max(0, order.quantity - (order.remains || 0));
    const percent = Math.min(
      100,
      Math.round((delivered / order.quantity) * 100)
    );

    res.json({
      order: {
        id: order.id,
        uuid: order.uuid,
        service_name: order.service_name,
        platform: order.platform,
        link_masked:
          order.link.length > 25
            ? order.link.substring(0, 15) +
              '***' +
              order.link.substring(order.link.length - 8)
            : order.link,
        quantity: order.quantity,
        start_count: order.start_count,
        delivered,
        remains: order.remains,
        percent,
        status: order.status,
        created_at: order.created_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao rastrear pedido: ' + err.message });
  }
});

module.exports = router;
