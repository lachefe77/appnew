const router = require('express').Router(),
  crypto = require('node:crypto');
const { db, tx } = require('../db');
const { requireAuth } = require('../auth');
const { sendMail } = require('../mail');
const config = require('../config');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
router.post('/request', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (user.email_verified)
    return res.json({ message: 'E-mail já confirmado.' });
  const recent = db
    .prepare(
      "SELECT 1 FROM identity_tokens WHERE user_id=? AND kind='email' AND datetime(created_at)>datetime('now','-5 minutes')"
    )
    .get(user.id);
  if (recent)
    return res
      .status(429)
      .json({ error: 'Aguarde cinco minutos para reenviar.' });
  if (!config.smtp.enabled || !config.publicUrl)
    return res
      .status(503)
      .json({ error: 'Confirmação por e-mail ainda não configurada.' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    "INSERT INTO identity_tokens(token_hash,user_id,kind,expires_at) VALUES(?,?,'email',?)"
  ).run(hash(token), user.id, new Date(Date.now() + 3600000).toISOString());
  try {
    await sendMail(user.email, 'verify_email', {
      name: user.name,
      token,
      baseUrl: config.publicUrl,
    });
    res.json({ message: 'Confirmação enfileirada para envio.' });
  } catch {
    res.status(503).json({ error: 'Serviço de e-mail indisponível.' });
  }
});
router.post('/confirm', (req, res) => {
  if (
    typeof req.body.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(req.body.token)
  )
    return res.status(400).json({ error: 'Token inválido.' });
  try {
    tx(() => {
      const row = db
        .prepare(
          "SELECT * FROM identity_tokens WHERE token_hash=? AND kind='email' AND used_at IS NULL AND datetime(expires_at)>CURRENT_TIMESTAMP"
        )
        .get(hash(req.body.token));
      if (!row) throw new Error('invalid');
      const updated = db
        .prepare(
          "UPDATE users SET email_verified=1 WHERE id=? AND status='active' AND deleted_at IS NULL"
        )
        .run(row.user_id);
      if (!updated.changes) throw new Error('inactive');
      db.prepare(
        'UPDATE identity_tokens SET used_at=CURRENT_TIMESTAMP WHERE token_hash=?'
      ).run(row.token_hash);
    });
    res.json({ message: 'E-mail confirmado.' });
  } catch {
    res.status(400).json({ error: 'Token inválido ou expirado.' });
  }
});
module.exports = router;
