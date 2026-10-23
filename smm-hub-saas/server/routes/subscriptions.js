const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.post('/', (req, res) => {
  const {
    service_id,
    username,
    posts_limit,
    min_quantity,
    max_quantity,
    delay_minutes,
  } = req.body;

  if (
    !Number.isSafeInteger(Number(service_id)) ||
    typeof username !== 'string' ||
    !posts_limit ||
    !min_quantity ||
    !max_quantity
  ) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
  }

  const cleanUser = username.replace('@', '').trim();
  const service = db
    .prepare("SELECT * FROM services WHERE id = ? AND status = 'active'")
    .get(service_id);
  if (!service)
    return res.status(404).json({ error: 'Serviço não encontrado.' });
  const numbers = [
    posts_limit,
    min_quantity,
    max_quantity,
    delay_minutes ?? 0,
  ].map(Number);
  if (
    !numbers.every(Number.isSafeInteger) ||
    numbers[0] < 1 ||
    numbers[0] > 500 ||
    numbers[1] < service.min_quantity ||
    numbers[2] > service.max_quantity ||
    numbers[1] > numbers[2] ||
    numbers[3] < 0 ||
    numbers[3] > 1440 ||
    !/^[a-zA-Z0-9_.]{1,64}$/.test(cleanUser)
  )
    return res
      .status(400)
      .json({ error: 'Perfil, limites ou atraso inválidos.' });

  const result = db
    .prepare(
      `
    INSERT INTO subscriptions (
      user_id, service_id, username, posts_limit, min_quantity, max_quantity, delay_minutes, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `
    )
    .run(
      req.user.id,
      service.id,
      cleanUser,
      parseInt(posts_limit, 10),
      parseInt(min_quantity, 10),
      parseInt(max_quantity, 10),
      parseInt(delay_minutes, 10) || 0
    );

  res.status(201).json({
    message: `Assinatura de Auto-Engajamento para @${cleanUser} ativada com sucesso!`,
    subscription_id: result.lastInsertRowid,
  });
});

router.get('/', (req, res) => {
  const subscriptions = db
    .prepare(
      `
    SELECT sub.*, s.name as service_name, s.platform,
      (SELECT message FROM subscription_run_log WHERE subscription_id=sub.id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM subscription_run_log WHERE subscription_id=sub.id ORDER BY id DESC LIMIT 1) AS last_run_at
    FROM subscriptions sub
    JOIN services s ON sub.service_id = s.id
    WHERE sub.user_id = ?
    ORDER BY sub.id DESC
  `
    )
    .all(req.user.id);

  res.json({ subscriptions });
});

router.post('/:id/toggle', (req, res) => {
  const sub = db
    .prepare(
      'SELECT id, status FROM subscriptions WHERE id = ? AND user_id = ?'
    )
    .get(req.params.id, req.user.id);

  if (!sub)
    return res.status(404).json({ error: 'Assinatura não encontrada.' });

  const nextStatus = sub.status === 'active' ? 'paused' : 'active';
  db.prepare(
    'UPDATE subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(nextStatus, sub.id);

  res.json({
    message: `Status alterado para ${nextStatus}.`,
    status: nextStatus,
  });
});

module.exports = router;
