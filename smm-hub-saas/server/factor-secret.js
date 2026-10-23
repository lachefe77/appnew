function seal(value) {
  return 'v1:' + require('./runtime-config').encrypt(value);
}
function open(value) {
  return value?.startsWith('v1:')
    ? require('./runtime-config').decrypt(value.slice(3))
    : value;
}
function consumeRecovery(userId, code) {
  if (typeof code !== 'string' || !/^[a-f0-9]{20}$/i.test(code)) return false;
  const hash = require('node:crypto')
    .createHash('sha256')
    .update(code.toLowerCase())
    .digest('hex');
  return (
    require('./db')
      .db.prepare(
        'UPDATE factor_recovery SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND code_hash=? AND used_at IS NULL'
      )
      .run(userId, hash).changes === 1
  );
}
function issueRecovery(userId) {
  const { db, tx } = require('./db'),
    crypto = require('node:crypto');
  return tx(() => {
    db.prepare('DELETE FROM factor_recovery WHERE user_id=?').run(userId);
    const codes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(10).toString('hex')
    );
    for (const code of codes)
      db.prepare(
        'INSERT INTO factor_recovery(user_id,code_hash) VALUES(?,?)'
      ).run(userId, crypto.createHash('sha256').update(code).digest('hex'));
    return codes;
  });
}
function consumeTotp(userId, secret, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const verified = require('speakeasy').totp.verifyDelta({
    secret: open(secret),
    encoding: 'base32',
    token: code,
    window: 1,
  });
  if (!verified) return false;
  const step = Math.floor(Date.now() / 30000) + verified.delta;
  return (
    require('./db')
      .db.prepare(
        'INSERT INTO factor_steps(user_id,last_step) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_step=excluded.last_step WHERE factor_steps.last_step<excluded.last_step'
      )
      .run(userId, step).changes === 1
  );
}
module.exports = { seal, open, consumeRecovery, issueRecovery, consumeTotp };
