const jwt = require('jsonwebtoken'),
  crypto = require('node:crypto');
const config = require('./config');
const { db } = require('./db');
const version = (row) =>
  crypto.createHash('sha256').update(row.portal_password_hash).digest('hex');
function signSupplier(row) {
  return jwt.sign(
    {
      provider_id: row.provider_id,
      credential_version: version(row),
      jti: crypto.randomUUID(),
    },
    config.jwt.secret,
    { audience: 'supplier', expiresIn: '1h', issuer: 'smm-hub' }
  );
}
function requireSupplier(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const payload = jwt.verify(token, config.jwt.secret, {
      audience: 'supplier',
      issuer: 'smm-hub',
      algorithms: ['HS256'],
    });
    const row = db
      .prepare(
        'SELECT * FROM supplier_portal WHERE provider_id=? AND enabled=1'
      )
      .get(payload.provider_id);
    if (!row || version(row) !== payload.credential_version)
      throw new Error('invalid');
    req.supplier = row;
    next();
  } catch {
    res.status(401).json({ error: 'Sessão de fornecedor inválida.' });
  }
}
module.exports = { signSupplier, requireSupplier };
