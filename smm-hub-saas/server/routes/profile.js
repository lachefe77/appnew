const express = require('express');
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const u = db
    .prepare(
      `
    SELECT id, uuid, name, email, whatsapp, balance_cents, total_deposited_cents, cashback_cents,
           tier, role, api_key, ref_code, status, two_factor_enabled, email_verified, created_at
    FROM users WHERE id = ?
  `
    )
    .get(req.user.id);

  const stats = {
    orders_total: db
      .prepare('SELECT COUNT(*) as c FROM orders WHERE user_id = ?')
      .get(req.user.id).c,
    orders_completed: db
      .prepare(
        "SELECT COUNT(*) as c FROM orders WHERE user_id = ? AND status = 'completed'"
      )
      .get(req.user.id).c,
    deposits_total: db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) as s FROM pix_invoices WHERE user_id = ? AND status = 'paid'"
      )
      .get(req.user.id).s,
    referrals: db
      .prepare(
        'SELECT COUNT(*) as c FROM referral_commissions WHERE referrer_id = ?'
      )
      .get(req.user.id).c,
  };

  res.json({ user: u, stats });
});

router.put('/', (req, res) => {
  const { name, whatsapp } = req.body;
  if (
    name !== undefined &&
    (typeof name !== 'string' || name.trim().length < 2 || name.length > 150)
  )
    return res
      .status(400)
      .json({ error: 'Nome deve ter entre 2 e 150 caracteres.' });
  if (
    whatsapp !== undefined &&
    (typeof whatsapp !== 'string' || whatsapp.length > 32)
  )
    return res.status(400).json({ error: 'WhatsApp inválido.' });
  db.prepare(
    'UPDATE users SET name = COALESCE(?, name), whatsapp = COALESCE(?, whatsapp) WHERE id = ?'
  ).run(name?.trim() || null, whatsapp?.trim() || null, req.user.id);
  res.json({ message: 'Perfil atualizado.' });
});

/* Sessions ativas (JWT ainda válidos) */
router.get('/sessions', (req, res) => {
  const revoked = db
    .prepare(
      'SELECT jti, revoked_at, expires_at FROM token_blacklist WHERE user_id = ? ORDER BY revoked_at DESC LIMIT 20'
    )
    .all(req.user.id);
  const sessions = db
    .prepare(
      'SELECT jti,device,created_at,last_seen_at,expires_at FROM sessions WHERE user_id=? AND revoked_at IS NULL AND datetime(expires_at)>CURRENT_TIMESTAMP ORDER BY last_seen_at DESC LIMIT 50'
    )
    .all(req.user.id);
  res.json({
    sessions,
    revoked_tokens: revoked,
    current_jti: req.tokenPayload?.jti,
  });
});
router.post('/sessions/:jti/revoke', (req, res) => {
  const row = db
    .prepare('SELECT jti FROM sessions WHERE jti=? AND user_id=?')
    .get(req.params.jti, req.user.id);
  if (!row) return res.status(404).json({ error: 'Sessão não encontrada.' });
  db.prepare(
    'UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE jti=? AND user_id=?'
  ).run(row.jti, req.user.id);
  res.json({
    message: 'Sessão encerrada.',
    current_session: row.jti === req.tokenPayload.jti,
  });
});

/* Força logout de todas as sessões */
router.post('/sessions/revoke-all', (req, res) => {
  // Para revogar todas, geramos novo api_key (invalida acesso API) e podemos opcionalmente blacklistar jti atual
  const newKey = 'smm_' + crypto.randomBytes(16).toString('hex');
  db.prepare(
    'UPDATE users SET api_key = ?, session_version = session_version + 1 WHERE id = ?'
  ).run(newKey, req.user.id);
  db.prepare(
    'UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL'
  ).run(req.user.id);

  if (req.tokenPayload?.jti) {
    const exp = new Date(req.tokenPayload.exp * 1000).toISOString();
    db.prepare(
      'INSERT OR IGNORE INTO token_blacklist (jti, user_id, expires_at) VALUES (?, ?, ?)'
    ).run(req.tokenPayload.jti, req.user.id, exp);
  }
  res.json({
    message: 'Todas as sessões foram encerradas. Faça login novamente.',
    new_api_key: newKey,
  });
});

/* Última atividade */
router.get('/activity', (req, res) => {
  const logs = db
    .prepare(
      `
    SELECT type, amount_cents, description, created_at
    FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 20
  `
    )
    .all(req.user.id);
  res.json({ activity: logs });
});

module.exports = router;
