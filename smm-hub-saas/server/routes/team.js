const express = require('express');
const crypto = require('node:crypto');
const { db, hashPassword } = require('../db');
const { requireCEO } = require('../auth');
const { VALID_ROLES } = require('../middleware/roles');
const { sendMail } = require('../mail');
const logger = require('../logger');

const router = express.Router();
router.use(requireCEO);

/* Lista a equipe (ceo/admin/support/vip) */
router.get('/', (req, res) => {
  const team = db
    .prepare(
      `
    SELECT id, uuid, name, email, role, status, created_at,
           (SELECT MAX(created_at) FROM audit_logs WHERE user_id = users.id) as last_action
    FROM users WHERE role IN ('ceo', 'admin', 'support', 'vip') AND deleted_at IS NULL
    ORDER BY CASE role WHEN 'ceo' THEN 1 WHEN 'admin' THEN 2 WHEN 'support' THEN 3 WHEN 'vip' THEN 4 ELSE 5 END, id ASC
  `
    )
    .all();
  res.json({ team });
});

/* Criar membro direto (sem passar pelo /register comum) */
router.post('/', (req, res) => {
  const { name, email, password, role, send_welcome } = req.body;
  if (
    typeof name !== 'string' ||
    name.trim().length < 2 ||
    name.length > 150 ||
    typeof email !== 'string' ||
    email.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    typeof password !== 'string'
  )
    return res
      .status(400)
      .json({ error: 'Nome, e-mail e senha são obrigatórios e válidos.' });
  if (password.length < 12 || password.length > 128)
    return res
      .status(400)
      .json({ error: 'Senha deve ter entre 12 e 128 caracteres.' });
  if (!VALID_ROLES.includes(role))
    return res
      .status(400)
      .json({ error: `Cargo inválido. Use: ${VALID_ROLES.join(', ')}.` });
  if (role === 'ceo')
    return res.status(400).json({
      error:
        'CEOs devem ser promovidos manualmente via API de role-change para evitar duplicação acidental.',
    });

  const cleanEmail = email.trim().toLowerCase();
  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(cleanEmail);
  if (existing) return res.status(400).json({ error: 'E-mail já cadastrado.' });

  const { hash, salt } = hashPassword(password);
  const uuid = crypto.randomUUID();
  const apiKey = 'smm_' + crypto.randomBytes(16).toString('hex');
  const refCode = 'REF' + crypto.randomBytes(4).toString('hex').toUpperCase();

  const r = db
    .prepare(
      `
    INSERT INTO users (uuid, name, email, password_hash, salt, balance_cents, role, api_key, ref_code, tier)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'VIP')
  `
    )
    .run(uuid, name.trim(), cleanEmail, hash, salt, role, apiKey, refCode);

  db.prepare(
    `INSERT INTO system_audit_logs (admin_id, action, target, ip, details)
    VALUES (?, 'team_create', ?, ?, ?)`
  ).run(
    req.user.id,
    `user:${r.lastInsertRowid}`,
    req.ip,
    `CEO criou ${role} ${cleanEmail}`
  );

  if (send_welcome) {
    sendMail(cleanEmail, 'welcome', { name: name.trim() }).catch(() => {});
  }
  logger.info(
    { by: req.user.id, email: cleanEmail, role },
    'Membro de equipe criado'
  );
  res.status(201).json({
    message: `${role.toUpperCase()} criado!`,
    id: r.lastInsertRowid,
    email: cleanEmail,
  });
});

/* Suspender/reativar membro (CEO não pode suspender a si mesmo) */
router.post('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status))
    return res.status(400).json({ error: 'Status inválido.' });
  if (Number(req.params.id) === req.user.id)
    return res
      .status(400)
      .json({ error: 'Você não pode suspender a si mesmo.' });

  const target = db
    .prepare('SELECT role FROM users WHERE id = ?')
    .get(req.params.id);
  if (!target)
    return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (target.role === 'ceo') {
    const activeCEOs = db
      .prepare(
        "SELECT COUNT(*) as c FROM users WHERE role = 'ceo' AND status = 'active'"
      )
      .get().c;
    if (activeCEOs <= 1 && status === 'suspended') {
      return res
        .status(400)
        .json({ error: 'Não é possível suspender o último CEO ativo.' });
    }
  }

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(
    status,
    req.params.id
  );
  db.prepare(
    `INSERT INTO system_audit_logs (admin_id, action, target, ip, details)
    VALUES (?, 'team_status', ?, ?, ?)`
  ).run(req.user.id, `user:${req.params.id}`, req.ip, status);
  res.json({ message: 'Status atualizado.' });
});

/* Resetar senha de membro */
router.post('/:id/reset-password', (req, res) => {
  const { new_password } = req.body;
  if (
    typeof new_password !== 'string' ||
    new_password.length < 12 ||
    new_password.length > 128
  )
    return res.status(400).json({ error: 'Senha mínima: 12 caracteres.' });
  const { hash, salt } = hashPassword(new_password);
  if (
    !db
      .prepare('SELECT id FROM users WHERE id=? AND deleted_at IS NULL')
      .get(req.params.id)
  )
    return res.status(404).json({ error: 'Membro não encontrado.' });
  require('../db').tx(() => {
    db.prepare(
      'UPDATE users SET password_hash = ?, salt = ?,api_key=?,session_version=session_version+1 WHERE id = ?'
    ).run(
      hash,
      salt,
      'smm_' + crypto.randomBytes(16).toString('hex'),
      req.params.id
    );
    db.prepare(
      'UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?'
    ).run(req.params.id);
    db.prepare(
      `INSERT INTO system_audit_logs (admin_id, action, target, ip, details)
    VALUES (?, 'team_password_reset', ?, ?, 'CEO resetou senha')`
    ).run(req.user.id, `user:${req.params.id}`, req.ip);
  });
  res.json({ message: 'Senha redefinida.' });
});

module.exports = router;
