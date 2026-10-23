const express = require('express');
const { db, tx } = require('../db');
const { requireAuth } = require('../auth');
const logger = require('../logger');

const router = express.Router();
router.use(requireAuth);

router.get('/export', (req, res) => {
  const uid = req.user.id;
  const user = db
    .prepare(
      'SELECT id, uuid, name, email, balance_cents, total_deposited_cents, tier, ref_code, created_at FROM users WHERE id = ?'
    )
    .get(uid);
  const orders = db
    .prepare(
      'SELECT id, uuid, link, quantity, charge_cents, status, created_at FROM orders WHERE user_id = ? ORDER BY id DESC'
    )
    .all(uid);
  const transactions = db
    .prepare(
      'SELECT id, type, amount_cents, balance_after_cents, description, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC'
    )
    .all(uid);
  const pix = db
    .prepare(
      'SELECT txid, provider, amount_cents, status, created_at, paid_at FROM pix_invoices WHERE user_id = ? ORDER BY id DESC'
    )
    .all(uid);
  const tickets = db
    .prepare(
      'SELECT id, subject, status, created_at FROM tickets WHERE user_id = ?'
    )
    .all(uid);

  const additional = {};
  for (const table of [
    'crypto_invoices',
    'fast_checkouts',
    'subscriptions',
    'child_panels',
    'user_preferences',
    'device_fingerprints',
    'lgpd_consent',
    'recurring_contracts',
    'autopilot_configs',
    'scheduled_orders',
  ]) {
    if (table === 'fast_checkouts') {
      additional[table] = db
        .prepare(
          'SELECT session_id,service_id,link,quantity,amount_cents,buyer_name,buyer_email,buyer_whatsapp,status,created_at FROM fast_checkouts WHERE buyer_email=?'
        )
        .all(user.email);
    } else {
      additional[table] = db
        .prepare('SELECT * FROM ' + table + ' WHERE user_id=?')
        .all(uid);
    }
  }
  additional.messages = db
    .prepare(
      'SELECT m.id,m.message,m.created_at FROM ticket_messages m JOIN tickets t ON m.ticket_id=t.id WHERE t.user_id=?'
    )
    .all(uid);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="smmhub-dados-${uid}-${Date.now()}.json"`
  );
  res.send(
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        user,
        orders,
        transactions,
        pix_invoices: pix,
        tickets,
        additional,
      },
      null,
      2
    )
  );

  db.prepare(
    `INSERT INTO lgpd_requests (user_id, type, status, completed_at) VALUES (?, 'export', 'completed', CURRENT_TIMESTAMP)`
  ).run(uid);
});

router.post('/delete-account', (req, res) => {
  const { confirm, password } = req.body;
  if (confirm !== 'DELETAR MINHA CONTA')
    return res.status(400).json({
      error: 'Digite exatamente "DELETAR MINHA CONTA" para confirmar.',
    });

  const u = db
    .prepare('SELECT password_hash, salt, email FROM users WHERE id = ?')
    .get(req.user.id);
  const { verifyPassword } = require('../db');
  if (
    typeof password !== 'string' ||
    password.length > 128 ||
    !verifyPassword(password, u.password_hash, u.salt)
  ) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  tx(() => {
    if (
      req.user.role === 'ceo' &&
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM users WHERE role='ceo' AND status='active' AND deleted_at IS NULL"
        )
        .get().n <= 1
    )
      throw Object.assign(
        new Error(
          'Transfira a administração para outro CEO ativo antes de remover esta conta.'
        ),
        { status: 409 }
      );
    // Perfil e dados operacionais, preservando registros financeiros identificados internamente
    const anonEmail = `deleted_${req.user.id}@anonymized.local`;
    db.prepare(
      `UPDATE users SET deleted_at = CURRENT_TIMESTAMP, email = ?, name = 'Usuário Removido', status = 'deleted', whatsapp = NULL WHERE id = ?`
    ).run(anonEmail, req.user.id);
    db.prepare(
      `INSERT INTO lgpd_requests (user_id, type, status, completed_at) VALUES (?, 'delete', 'completed', CURRENT_TIMESTAMP)`
    ).run(req.user.id);
    db.prepare(
      'UPDATE users SET session_version=session_version+1,api_key=? WHERE id=?'
    ).run(require('node:crypto').randomBytes(32).toString('hex'), req.user.id);
    const erased = require('../db').hashPassword(
      require('node:crypto').randomBytes(48).toString('hex')
    );
    db.prepare(
      'UPDATE users SET password_hash=?,salt=?,two_factor_enabled=0,two_factor_secret=NULL WHERE id=?'
    ).run(erased.hash, erased.salt, req.user.id);
    db.prepare(
      "UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP,device='Removido' WHERE user_id=?"
    ).run(req.user.id);
    db.prepare(
      "UPDATE orders SET link='https://removed.invalid',comments_payload=NULL WHERE user_id=? AND status IN ('completed','partial','canceled','failed')"
    ).run(req.user.id);
    db.prepare(
      "UPDATE fast_checkouts SET buyer_name='Usuário Removido',buyer_email=?,buyer_whatsapp='',link='https://removed.invalid' WHERE buyer_email=?"
    ).run(anonEmail, u.email);
    db.prepare(
      "UPDATE subscriptions SET status='paused',username='removed' WHERE user_id=?"
    ).run(req.user.id);
    db.prepare("UPDATE child_panels SET status='canceled' WHERE user_id=?").run(
      req.user.id
    );
    for (const table of ['recurring_contracts', 'autopilot_configs'])
      db.prepare('UPDATE ' + table + ' SET is_active=0 WHERE user_id=?').run(
        req.user.id
      );
    db.prepare(
      "UPDATE scheduled_orders SET status='canceled' WHERE user_id=? AND status='pending'"
    ).run(req.user.id);
    db.prepare(
      'DELETE FROM ticket_attachments WHERE message_id IN (SELECT m.id FROM ticket_messages m JOIN tickets t ON t.id=m.ticket_id WHERE t.user_id=?)'
    ).run(req.user.id);
    db.prepare(
      "UPDATE ticket_messages SET message='Conteúdo removido' WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id=?)"
    ).run(req.user.id);
    db.prepare(
      "UPDATE tickets SET subject='Chamado removido',status='closed' WHERE user_id=?"
    ).run(req.user.id);
    for (const table of [
      'device_fingerprints',
      'user_preferences',
      'push_subscriptions',
      'identity_tokens',
      'password_resets',
      'factor_recovery',
      'factor_steps',
    ])
      db.prepare('DELETE FROM ' + table + ' WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM sub_accounts WHERE parent_user_id=?').run(
      req.user.id
    );
    db.prepare(
      "DELETE FROM job_queue WHERE subject_user_id=? AND name='mail' AND status!='running'"
    ).run(req.user.id);
    db.prepare(
      'DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM client_webhooks WHERE user_id=?)'
    ).run(req.user.id);
    db.prepare('DELETE FROM client_webhooks WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM social_connections WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM oauth_states WHERE user_id=?').run(req.user.id);
  });
  logger.warn({ userId: req.user.id }, 'Usuário solicitou exclusão (LGPD)');
  res.json({
    message:
      'Perfil removido e automações pausadas. Registros financeiros e de auditoria seguem a política de retenção da operação.',
  });
});

router.post('/consent', (req, res) => {
  const { terms, marketing } = req.body;
  db.prepare(
    `INSERT INTO lgpd_consent (user_id, consented_terms, consented_marketing, ip)
    VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
    consented_terms=excluded.consented_terms, consented_marketing=excluded.consented_marketing,
    ip=excluded.ip, consented_at=CURRENT_TIMESTAMP`
  ).run(req.user.id, terms ? 1 : 0, marketing ? 1 : 0, req.ip);
  res.json({ message: 'Consentimento registrado.' });
});

router.get('/consent', (req, res) => {
  const row = db
    .prepare('SELECT * FROM lgpd_consent WHERE user_id = ?')
    .get(req.user.id);
  res.json({ consent: row || null });
});

module.exports = router;
