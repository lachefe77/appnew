const crypto = require('node:crypto');
const { db } = require('../db');
const logger = require('../logger');

/**
 * Rotaciona API keys a cada 90 dias.
 * Avisa usuário via admin_notes (e-mail enviado por quem subscreva ao evento).
 */
function rotateOldKeys() {
  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const stale = db
    .prepare(
      `SELECT id, email, api_key FROM users WHERE datetime(COALESCE(api_key_rotated_at,created_at)) < datetime(?) AND deleted_at IS NULL`
    )
    .all(cutoff);

  let count = 0;
  for (const u of stale) {
    const newKey = 'smm_' + crypto.randomBytes(16).toString('hex');
    db.prepare(
      'UPDATE users SET api_key = ?, api_key_rotated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(newKey, u.id);
    db.prepare(
      `INSERT INTO admin_notes (target_user_id, admin_id, note) VALUES (?, ?, ?)`
    ).run(
      u.id,
      u.id,
      `API key rotacionada automaticamente em ${new Date().toISOString().split('T')[0]} (ciclo 90d).`
    );
    count++;
  }
  if (count > 0) logger.info({ count }, 'API keys rotacionadas');
  return { rotated: count };
}

function startRotationWorker() {
  // Checa a cada 24h
  setInterval(
    () => {
      try {
        rotateOldKeys();
      } catch (e) {
        logger.error({ err: e.message }, 'Rotação falhou');
      }
    },
    24 * 60 * 60 * 1000
  );
}

module.exports = { rotateOldKeys, startRotationWorker };
