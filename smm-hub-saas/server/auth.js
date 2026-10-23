const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { db } = require('./db');
const config = require('./config');

function signToken(user, options = {}) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      role: user.sub_account_id ? 'user' : user.role,
      jti,
      factor_verified: options.factorVerified === true,
      sub_account_id: user.sub_account_id || undefined,
      delegated_by: options.actor?.id,
      actor_session_version: options.actor?.session_version,
      actor_credential_version: options.actor
        ? crypto
            .createHash('sha256')
            .update(options.actor.password_hash)
            .digest('hex')
        : undefined,
      session_version:
        user.session_version ??
        db
          .prepare('SELECT session_version FROM users WHERE id = ?')
          .get(user.id)?.session_version ??
        0,
      credential_version: crypto
        .createHash('sha256')
        .update(
          user.password_hash ||
            db
              .prepare('SELECT password_hash FROM users WHERE id = ?')
              .get(user.id).password_hash
        )
        .digest('hex'),
    },
    config.jwt.secret,
    {
      expiresIn: options.actor ? '15m' : config.jwt.expires,
      audience: 'panel',
      issuer: 'smm-hub',
    }
  );
  db.prepare(
    'INSERT INTO sessions(jti,user_id,device,expires_at) VALUES(?,?,?,?)'
  ).run(
    jti,
    user.id,
    String(options.device || 'Sessão do painel').slice(0, 200),
    new Date(jwt.decode(token).exp * 1000).toISOString()
  );
  return token;
}

function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      audience: 'panel',
      issuer: 'smm-hub',
    });
    const account = db
      .prepare(
        'SELECT status, password_hash, session_version FROM users WHERE id = ?'
      )
      .get(payload.id);
    if (!account || account.status !== 'active') return null;
    if (payload.session_version !== account.session_version) return null;
    const version = crypto
      .createHash('sha256')
      .update(account.password_hash)
      .digest('hex');
    if (payload.credential_version !== version) return null;
    if (payload.delegated_by) {
      const actor = db
        .prepare('SELECT * FROM users WHERE id=?')
        .get(payload.delegated_by);
      if (
        !actor ||
        actor.status !== 'active' ||
        !['admin', 'ceo'].includes(actor.role) ||
        actor.session_version !== payload.actor_session_version ||
        crypto
          .createHash('sha256')
          .update(actor.password_hash)
          .digest('hex') !== payload.actor_credential_version
      )
        return null;
    }
    if (payload.sub_account_id) {
      const sub = db
        .prepare(
          "SELECT id FROM sub_accounts WHERE id=? AND parent_user_id=? AND status='active'"
        )
        .get(payload.sub_account_id, payload.id);
      if (!sub) return null;
    }
    if (payload.jti) {
      const session = db
        .prepare('SELECT revoked_at FROM sessions WHERE jti=?')
        .get(payload.jti);
      if (!session || session.revoked_at) return null;
      const revoked = db
        .prepare('SELECT jti FROM token_blacklist WHERE jti = ?')
        .get(payload.jti);
      if (revoked) return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

function revokeToken(jti, userId, expSeconds) {
  const expiresAt = new Date(expSeconds * 1000).toISOString();
  db.prepare(
    'INSERT OR IGNORE INTO token_blacklist (jti, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(jti, userId, expiresAt);
  db.prepare(
    'UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE jti=? AND user_id=?'
  ).run(jti, userId);
}

function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if(authHeader==='Bearer '+require('./browser-session').marker)return require('./browser-session').read(req);
  if (authHeader && authHeader.startsWith('Bearer '))
    return authHeader.substring(7);
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);

  // Suporte alternativo: X-API-Key
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!token && apiKey) {
    return res.status(403).json({
      error: 'Use a API comercial /api/v2 para autenticação por chave.',
    });
  }

  if (!token) {
    return res
      .status(401)
      .json({ error: 'Token de autenticação não fornecido.' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res
      .status(401)
      .json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
  }

  const user = db
    .prepare(
      'SELECT id, uuid, name, email, balance_cents, role, api_key, status FROM users WHERE id = ?'
    )
    .get(payload.id);
  if (!user || user.status !== 'active') {
    return res
      .status(401)
      .json({ error: 'Usuário desativado ou não encontrado.' });
  }

  req.user = user;
  db.prepare(
    "UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE jti=? AND last_seen_at<datetime('now','-5 minutes')"
  ).run(payload.jti);
  if (payload.delegated_by) {
    const path = req.originalUrl.split('?')[0];
    const allowed =
      (req.method === 'GET' &&
        [
          '/api/orders',
          '/api/services',
          '/api/auth/me',
          '/api/profile/activity',
        ].some((prefix) => path === prefix || path.startsWith(prefix + '/'))) ||
      (req.method === 'POST' && path === '/api/auth/logout');
    if (!allowed || !['user', 'vip'].includes(user.role))
      return res.status(403).json({
        error: 'Sessão delegada permite apenas consulta operacional.',
      });
    const json = res.json.bind(res);
    res.json = (body) => {
      function clean(value) {
        if (Array.isArray(value)) return value.map(clean);
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value)
              .filter(([k]) => k !== 'api_key')
              .map(([k, v]) => [k, clean(v)])
          );
        return value;
      }
      return json(clean(body));
    };
  }
  if (payload.sub_account_id) {
    const sub = db
      .prepare('SELECT * FROM sub_accounts WHERE id=?')
      .get(payload.sub_account_id);
    const route = req.originalUrl.split('?')[0];
    const readingOrders =
      req.method === 'GET' && route.startsWith('/api/orders');
    const writingOrders =
      req.method === 'POST' && route.startsWith('/api/orders');
    const allowed =
      route === '/api/auth/me' ||
      route === '/api/auth/logout' ||
      route.startsWith('/api/services') ||
      (readingOrders && sub.can_view_history) ||
      (writingOrders && sub.can_order);
    if (!allowed)
      return res
        .status(403)
        .json({ error: 'Permissão da subconta insuficiente.' });
    req.user = { ...user, role: 'user', api_key: undefined };
    const json = res.json.bind(res);
    res.json = (body) => {
      function redact(value) {
        if (Array.isArray(value)) return value.map(redact);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key]) =>
                key !== 'api_key' &&
                (sub.can_view_balance ||
                  ![
                    'balance_cents',
                    'new_balance_cents',
                    'new_balance_formatted',
                    'total_deposited_cents',
                    'cashback_cents',
                  ].includes(key))
            )
            .map(([key, v]) => [key, key === 'role' ? 'user' : redact(v)])
        );
      }
      return json(redact(body));
    };
  }
  req.tokenPayload = payload;
  req.authMethod = 'jwt';
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'ceo') {
      return res.status(403).json({
        error: 'Acesso negado. Recurso exclusivo para administradores.',
      });
    }
    if (
      config.env === 'production' &&
      (!req.tokenPayload.factor_verified ||
        !db
          .prepare('SELECT two_factor_enabled FROM users WHERE id=?')
          .get(req.user.id).two_factor_enabled)
    )
      return res.status(403).json({
        error:
          'Configure 2FA no perfil e entre novamente com o código para acessar a administração.',
      });
    next();
  });
}

function requireCEO(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'ceo') {
      return res.status(403).json({ error: 'Acesso restrito ao CEO.' });
    }
    if (
      config.env === 'production' &&
      (!req.tokenPayload.factor_verified ||
        !db
          .prepare('SELECT two_factor_enabled FROM users WHERE id=?')
          .get(req.user.id).two_factor_enabled)
    )
      return res
        .status(403)
        .json({ error: 'Ações de CEO exigem login com segundo fator.' });
    next();
  });
}

function requireStaff(req, res, next) {
  requireAuth(req, res, () => {
    if (!['support', 'admin', 'ceo'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso restrito à equipe.' });
    }
    if (
      config.env === 'production' &&
      (!req.tokenPayload.factor_verified ||
        !db
          .prepare('SELECT two_factor_enabled FROM users WHERE id=?')
          .get(req.user.id).two_factor_enabled)
    )
      return res.status(403).json({
        error: 'Atendimento exige login com segundo fator em produção.',
      });
    next();
  });
}

module.exports = {
  signToken,
  verifyToken,
  revokeToken,
  requireAuth,
  requireAdmin,
  requireCEO,
  requireStaff,
  extractToken,
};
