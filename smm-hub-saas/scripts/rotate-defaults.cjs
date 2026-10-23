const {
  db,
  hashPassword,
  verifyPassword,
  tx,
  migrateExistingSchema,
} = require('../server/db');
const crypto = require('node:crypto');
if (
  !db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    )
    .get()
)
  throw new Error('Informe o banco existente em DB_PATH.');
migrateExistingSchema();
const email = process.env.LEGACY_OWNER_EMAIL,
  password = process.env.NEW_OWNER_PASSWORD;
if (!email || !password || password.length < 12 || password.length > 128)
  throw new Error(
    'Defina LEGACY_OWNER_EMAIL e NEW_OWNER_PASSWORD (12+ caracteres) no ambiente do processo.'
  );
const owner = db
  .prepare("SELECT * FROM users WHERE email=? AND role='ceo'")
  .get(email);
if (!owner) throw new Error('CEO informado não encontrado.');
const h = hashPassword(password);
tx(() => {
  db.prepare(
    'UPDATE users SET password_hash=?,salt=?,api_key=?,session_version=session_version+1 WHERE id=?'
  ).run(
    h.hash,
    h.salt,
    'smm_' + crypto.randomBytes(16).toString('hex'),
    owner.id
  );
  db.prepare(
    'UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?'
  ).run(owner.id);
  const staff = db
    .prepare(
      "SELECT * FROM users WHERE role IN ('ceo','admin','support') AND id!=? AND status='active'"
    )
    .all(owner.id);
  for (const member of staff)
    if (
      ['admin123', 'demo123'].some((value) =>
        verifyPassword(value, member.password_hash, member.salt)
      )
    )
      db.prepare(
        "UPDATE users SET status='suspended',api_key=?,session_version=session_version+1 WHERE id=?"
      ).run(crypto.randomBytes(32).toString('hex'), member.id);
  const demo = db
    .prepare('SELECT * FROM users WHERE email=?')
    .get(process.env.DEMO_EMAIL || 'demo@smmhub.com');
  if (demo && verifyPassword('demo123', demo.password_hash, demo.salt))
    db.prepare(
      "UPDATE users SET status='suspended',api_key=?,session_version=session_version+1 WHERE id=?"
    ).run(crypto.randomBytes(32).toString('hex'), demo.id);
});
db.close();
console.log(
  'Credencial do CEO atualizada; sessões revogadas e demonstração padrão suspensa, quando existente.'
);
