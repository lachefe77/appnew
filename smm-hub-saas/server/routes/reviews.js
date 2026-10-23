const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.post('/', requireAuth, (req, res) => {
  const { order_id, rating, comment } = req.body;
  if (!order_id || !rating)
    return res
      .status(400)
      .json({ error: 'Ordem e nota (1-5) são obrigatórias.' });

  const order = db
    .prepare(
      "SELECT id FROM orders WHERE id = ? AND user_id = ? AND status IN ('completed','partial')"
    )
    .get(order_id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });

  const numRating = Number(rating);
  if (
    !Number.isInteger(numRating) ||
    numRating < 1 ||
    numRating > 5 ||
    (comment != null && (typeof comment !== 'string' || comment.length > 2000))
  )
    return res.status(400).json({ error: 'Nota ou comentário inválido.' });
  if (
    db
      .prepare('SELECT id FROM order_reviews WHERE order_id=? AND user_id=?')
      .get(order.id, req.user.id)
  )
    return res.status(409).json({ error: 'Pedido já avaliado.' });

  db.prepare(
    `
    INSERT INTO order_reviews (order_id, user_id, rating, comment)
    VALUES (?, ?, ?, ?)
  `
  ).run(order.id, req.user.id, numRating, comment || null);

  res.status(201).json({
    message: 'Avaliação enviada com sucesso! Obrigado pelo feedback.',
  });
});

module.exports = router;
