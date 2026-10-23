const express = require('express');
const crypto = require('node:crypto');
const { resolveWebhook } = require('../webhook-http');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

/**
 * List client webhooks
 */
router.get('/', (req, res) => {
  try {
    const hooks = db
      .prepare(
        `
      SELECT id, url, events, is_active, created_at
      FROM client_webhooks
      WHERE user_id = ?
      ORDER BY id DESC
    `
      )
      .all(req.user.id);

    res.json({ webhooks: hooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Register new webhook
 */
router.post('/', async (req, res) => {
  try {
    const { url, events } = req.body;
    if (typeof url !== 'string' || url.length > 2048) {
      return res.status(400).json({
        error: 'URL do webhook deve ser um endereço HTTP/HTTPS válido.',
      });
    }
    await resolveWebhook(url);

    const secret = 'whsec_' + crypto.randomBytes(16).toString('hex');
    const evs = events || 'order.completed,order.canceled,order.partial';

    const result = db
      .prepare(
        `
      INSERT INTO client_webhooks (user_id, url, secret, events, is_active)
      VALUES (?, ?, ?, ?, 1)
    `
      )
      .run(req.user.id, url.trim(), require('../factor-secret').seal(secret), evs);

    res.status(201).json({
      message: 'Webhook registrado com sucesso!',
      webhook: {
        id: result.lastInsertRowid,
        url,
        secret,
        events: evs,
      },
    });
  } catch (err) {
    res
      .status(400)
      .json({ error: 'Destino de webhook inválido ou indisponível.' });
  }
});

/**
 * Delete webhook
 */
router.delete('/:id', (req, res) => {
  try {
    const result = db
      .prepare('DELETE FROM client_webhooks WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Webhook não encontrado.' });
    }
    res.json({ message: 'Webhook removido com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
