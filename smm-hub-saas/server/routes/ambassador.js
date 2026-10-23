const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use((req, res, next) =>
  req.path.startsWith('/public/') ? next() : requireAuth(req, res, next)
);

router.get('/', (req, res) => {
  const coupons = db
    .prepare(
      'SELECT * FROM ambassador_coupons WHERE user_id = ? ORDER BY id DESC'
    )
    .all(req.user.id);
  const totalCommissionCents = coupons.reduce(
    (s, c) => s + (c.total_commissions_cents || 0),
    0
  );
  const totalUses = coupons.reduce((s, c) => s + (c.uses_count || 0), 0);
  res.json({
    coupons,
    total_uses: totalUses,
    total_commissions_cents: totalCommissionCents,
    total_commissions_formatted: `R$ ${(totalCommissionCents / 100).toFixed(2).replace('.', ',')}`,
  });
});

router.post('/', (req, res) => {
  const { code, discount_pct, commission_pct } = req.body;
  if(typeof code!=='string'||code.length>100)return res.status(400).json({error:'Código inválido.'});
  const clean = (code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 20);
  if (clean.length < 4)
    return res
      .status(400)
      .json({ error: 'Código deve ter pelo menos 4 caracteres.' });

  try {
    if(db.prepare('SELECT id FROM coupons WHERE code=?').get(clean))return res.status(409).json({error:'Código já reservado.'});
    const r = db
      .prepare(
        `INSERT INTO ambassador_coupons (user_id, code, discount_pct, commission_pct,status) VALUES (?,?,0,0,'pending')`
      )
      .run(req.user.id, clean);
    res.status(201).json({
      message: 'Cupom enviado para aprovação comercial.',
      id: r.lastInsertRowid,
      code: clean,
    });
  } catch (err) {
    res.status(400).json({
      error: err.message.includes('UNIQUE')
        ? 'Código já existe. Escolha outro.'
        : err.message,
    });
  }
});

router.get('/public/validate/:code', (req, res) => {
  const c = db
    .prepare(
      `SELECT c.code, c.discount_pct, u.name as ambassador_name
    FROM ambassador_coupons c JOIN users u ON c.user_id = u.id
    WHERE c.code = ? AND c.status = 'active'`
    )
    .get(req.params.code.trim().toUpperCase());
  if (!c) return res.status(404).json({ error: 'Cupom embaixador inválido.' });
  res.json({ valid: true, ...c });
});

router.get('/public/leaderboard', (req, res) => {
  const month = new Date();
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const monthIso = month.toISOString();

  const top = db
    .prepare(
      `
    SELECT u.name,
           SUM(c.uses_count) as uses,
           SUM(c.total_commissions_cents) as commissions
    FROM ambassador_coupons c JOIN users u ON c.user_id = u.id
    WHERE c.created_at >= ?
    GROUP BY u.id ORDER BY commissions DESC LIMIT 10
  `
    )
    .all(monthIso);

  res.json({
    month: new Date().toLocaleString('pt-BR', {
      month: 'long',
      year: 'numeric',
    }),
    top: top.map((t, i) => ({
      rank: i + 1,
      masked_name: t.name.split(' ')[0] + ' ***',
      uses: t.uses || 0,
      commissions_formatted: `R$ ${((t.commissions || 0) / 100).toFixed(2).replace('.', ',')}`,
    })),
  });
});

module.exports = router;
