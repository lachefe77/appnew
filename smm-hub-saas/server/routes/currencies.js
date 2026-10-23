const express = require('express');
const { db } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ currencies: db.prepare('SELECT * FROM currencies').all() });
});

router.get('/convert', (req, res) => {
  const { amount_brl_cents, to } = req.query;
  const c = db.prepare('SELECT * FROM currencies WHERE code = ?').get((to || 'USD').toUpperCase());
  if (!c) return res.status(404).json({ error: 'Moeda não suportada.' });
  const brl = parseInt(amount_brl_cents, 10) / 100;
  const converted = brl * c.rate_from_brl;
  res.json({
    source: 'BRL', target: c.code, rate: c.rate_from_brl,
    amount: Number(converted.toFixed(2)),
    formatted: `${c.symbol} ${converted.toFixed(2)}`
  });
});

module.exports = router;
