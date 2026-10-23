const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { replayState, getEvents } = require('../event-store');

const router = express.Router();

router.get('/order/:id', requireAuth, (req, res) => {
  const o = db.prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!o && req.user.role !== 'admin') return res.status(404).json({ error: 'Ordem não encontrada.' });
  res.json({ state: replayState(req.params.id), events: getEvents(req.params.id) });
});

module.exports = router;
