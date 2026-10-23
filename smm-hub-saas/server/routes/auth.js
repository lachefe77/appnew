const express = require('express');
const crypto = require('node:crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const {
  db,
  hashPassword,
  verifyPassword,
  generateRefCode,
  tx,
} = require('../db');
const {
  signToken,
  requireAuth,
  revokeToken,
  verifyToken,
  extractToken,
} = require('../auth');
const logger = require('../logger');
const { sendMail } = require('../mail');
const { verifyCaptcha } = require('../middleware/captcha');
const metrics = require('../metrics');
const config = require('../config');
const factorSecret = require('../factor-secret');

const router = express.Router();
router.get('/public-config', (req, res) =>
  res.json({
    production: config.env === 'production',
    captcha: {
      provider: config.captcha.provider,
      site_key:
        config.captcha.provider === 'turnstile'
          ? config.captcha.turnstileSiteKey
          : config.captcha.provider === 'hcaptcha'
            ? config.captcha.hcaptchaSiteKey
            : '',
    },
  })
);

router.post('/register', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      ref,
      captcha_token,
      consent_terms,
      consent_marketing,
    } = req.body;
    if (
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      name.length > 150 ||
      typeof email !== 'string' ||
      email.length > 254 ||
      typeof password !== 'string' ||
      (ref != null && typeof ref !== 'string') ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      return res.status(400).json({ error: 'Nome, e-mail e senha inválidos.' });

    if (config.captcha.provider !== 'none') {
      const ok = await verifyCaptcha(captcha_token, req.ip);
      if (!ok) return res.status(400).json({ error: 'CAPTCHA inválido.' });
    }
    if (consent_terms !== true)
      return res
        .status(400)
        .json({ error: 'Aceite dos Termos de Uso é obrigatório.' });

    if (!name || !email || !password)
      return res
        .status(400)
        .json({ error: 'Nome, e-mail e senha são obrigatórios.' });
    if (password.length < 12 || password.length > 128)
      return res.status(400).json({ error: 'Senha mínima: 12 caracteres.' });

    if (typeof email !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Credenciais inválidas.' });
    const cleanEmail = email.trim().toLowerCase();
    const existing = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(cleanEmail);
    if (existing)
      return res.status(400).json({ error: 'E-mail já cadastrado.' });

    let referredBy = null;
    if (ref) {
      const referrer = db
        .prepare('SELECT id FROM users WHERE ref_code = ?')
        .get(ref.trim().toUpperCase());
      if (referrer) referredBy = referrer.id;
    }

    const { hash, salt } = hashPassword(password);
    const uuid = crypto.randomUUID();
    const apiKey = 'smm_' + crypto.randomBytes(16).toString('hex');
    const refCode = generateRefCode();

    const { user, token } = tx(() => {
      const r = db
        .prepare(
          `
      INSERT INTO users (uuid, name, email, password_hash, salt, balance_cents, role, api_key, ref_code, referred_by, tier)
      VALUES (?, ?, ?, ?, ?, 0, 'user', ?, ?, ?, 'Standard')
    `
        )
        .run(
          uuid,
          name.trim(),
          cleanEmail,
          hash,
          salt,
          apiKey,
          refCode,
          referredBy
        );

      const user = db
        .prepare(
          `
      SELECT id, uuid, name, email, balance_cents, total_deposited_cents, tier, role, api_key, ref_code, status, created_at
      FROM users WHERE id = ?
    `
        )
        .get(r.lastInsertRowid);

      db.prepare(
        `INSERT INTO lgpd_consent (user_id, consented_terms, consented_marketing, ip)
      VALUES (?, 1, ?, ?)`
      ).run(user.id, consent_marketing ? 1 : 0, req.ip);

      const token = signToken(user, { device: req.get('user-agent') });
      return { user, token };
    });
    sendMail(user.email, 'welcome', { name: user.name }).catch(() => {});

    return res
      .status(201)
      .json({ message: 'Conta criada com sucesso!', token:require('../browser-session').write(req,res,token), user });
  } catch (err) {
    logger.error({ err: err.message }, 'Register error');
    return res.status(500).json({ error: 'Erro ao criar conta.' });
  }
});

router.post('/login', (req, res) => {
  try {
    const { email, password, totp_code } = req.body;
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      email.length > 254 ||
      password.length > 128
    )
      return res.status(400).json({ error: 'Credenciais inválidas.' });
    metrics.inc('login_total');
    if (!email || !password)
      return res
        .status(400)
        .json({ error: 'E-mail e senha são obrigatórios.' });

    const cleanEmail = email.trim().toLowerCase();
    const user = db
      .prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL')
      .get(cleanEmail);
    if (!user) {
      metrics.inc('login_failed_total');
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }
    if (user.status !== 'active')
      return res.status(403).json({ error: 'Conta suspensa ou desativada.' });

    const isValid = verifyPassword(password, user.password_hash, user.salt);
    if (!isValid) {
      metrics.inc('login_failed_total');
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    if (user.two_factor_enabled) {
      if (!totp_code)
        return res
          .status(401)
          .json({ error: 'Código 2FA obrigatório.', needs_2fa: true });
      const ok =
        factorSecret.consumeRecovery(user.id, String(totp_code)) ||
        factorSecret.consumeTotp(
          user.id,
          user.two_factor_secret,
          String(totp_code)
        );
      if (!ok) return res.status(401).json({ error: 'Código 2FA inválido.' });
    }

    const token = signToken(user, {
      device: req.get('user-agent'),
      factorVerified: !!user.two_factor_enabled,
    });
    delete user.password_hash;
    delete user.salt;
    delete user.two_factor_secret;

    return res.json({ message: 'Login realizado!', token:require('../browser-session').write(req,res,token), user });
  } catch (err) {
    logger.error({ err: err.message }, 'Login error');
    return res.status(500).json({ error: 'Erro ao realizar login.' });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  if (req.tokenPayload && req.tokenPayload.jti) {
    revokeToken(req.tokenPayload.jti, req.user.id, req.tokenPayload.exp);
  }
  res.clearCookie('smm_session',{path:'/api'});
  res.json({ message: 'Sessão encerrada.' });
});
router.post('/browser-session',requireAuth,(req,res)=>{
 const token=require('../auth').extractToken(req);
 res.json({token:require('../browser-session').write(req,res,token)});
});

router.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare(
      `
    SELECT id, uuid, name, email, balance_cents, total_deposited_cents, cashback_cents,
           tier, role, api_key, ref_code, status, two_factor_enabled, email_verified, created_at
    FROM users WHERE id = ?
  `
    )
    .get(req.user.id);

  const refStats = db
    .prepare(
      `
    SELECT COUNT(*) as total_referred, COALESCE(SUM(commission_cents), 0) as total_commissions_cents
    FROM referral_commissions WHERE referrer_id = ?
  `
    )
    .get(req.user.id);

  res.json({
    user,
    affiliate: {
      ref_code: user.ref_code,
      total_referred: refStats.total_referred,
      total_commissions_formatted: `R$ ${(refStats.total_commissions_cents / 100).toFixed(2).replace('.', ',')}`,
    },
  });
});

router.post('/regenerate-api-key', requireAuth, (req, res) => {
  const newKey = 'smm_' + crypto.randomBytes(16).toString('hex');
  db.prepare(
    'UPDATE users SET api_key = ?, api_key_rotated_at=CURRENT_TIMESTAMP WHERE id = ?'
  ).run(newKey, req.user.id);
  res.json({ message: 'Chave de API regenerada.', api_key: newKey });
});

/* ========= 2FA TOTP real ========= */

router.post('/2fa/setup', requireAuth, async (req, res) => {
  const current = db
    .prepare(
      'SELECT two_factor_enabled,password_hash,salt FROM users WHERE id = ?'
    )
    .get(req.user.id);
  if (
    typeof req.body.current_password !== 'string' ||
    !verifyPassword(
      req.body.current_password,
      current.password_hash,
      current.salt
    )
  )
    return res.status(401).json({ error: 'Confirme sua senha atual.' });
  if (current.two_factor_enabled)
    return res.status(409).json({
      error: 'Desative o fator atual com seu código antes de configurar outro.',
    });
  const secret = speakeasy.generateSecret({
    name: `SMM Hub (${req.user.email})`,
    length: 20,
  });
  let stored;
  try {
    stored = factorSecret.seal(secret.base32);
  } catch {
    return res.status(503).json({
      error:
        'Configure a chave de criptografia do servidor antes de ativar 2FA.',
    });
  }
  db.prepare(
    'UPDATE users SET two_factor_secret = ?, two_factor_enabled = 0 WHERE id = ?'
  ).run(stored, req.user.id);
  db.prepare('DELETE FROM factor_steps WHERE user_id=?').run(req.user.id);
  const qr = await QRCode.toDataURL(secret.otpauth_url);
  res.json({
    secret: secret.base32,
    qr_data_url: qr,
    otpauth_url: secret.otpauth_url,
  });
});

router.post('/2fa/enable', requireAuth, (req, res) => {
  const { code } = req.body;
  const u = db
    .prepare(
      'SELECT two_factor_secret,two_factor_enabled FROM users WHERE id = ?'
    )
    .get(req.user.id);
  if (!u || !u.two_factor_secret)
    return res.status(400).json({ error: 'Execute /2fa/setup primeiro.' });
  if (u.two_factor_enabled)
    return res.status(409).json({ error: '2FA já está ativado.' });

  const ok = factorSecret.consumeTotp(
    req.user.id,
    u.two_factor_secret,
    String(code)
  );
  if (!ok) return res.status(400).json({ error: 'Código inválido.' });

  db.prepare('UPDATE users SET two_factor_enabled = 1 WHERE id = ?').run(
    req.user.id
  );
  const recovery_codes = factorSecret.issueRecovery(req.user.id);
  res.json({
    message:
      '2FA ativado. Guarde os códigos de recuperação: cada um só pode ser usado uma vez.',
    recovery_codes,
  });
});

router.post('/2fa/disable', requireAuth, (req, res) => {
  const { code } = req.body;
  const u = db
    .prepare('SELECT two_factor_secret FROM users WHERE id = ?')
    .get(req.user.id);
  if (!u || !u.two_factor_secret)
    return res.status(400).json({ error: '2FA não configurado.' });

  const ok =
    factorSecret.consumeRecovery(req.user.id, String(code)) ||
    factorSecret.consumeTotp(req.user.id, u.two_factor_secret, String(code));
  if (!ok) return res.status(400).json({ error: 'Código inválido.' });

  db.prepare(
    'UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?'
  ).run(req.user.id);
  res.json({ message: '2FA desativado.' });
});

/* ========= Password reset (token em DB; e-mail stub quando SMTP não configurado) ========= */

router.post('/password-reset/request', async (req, res) => {
  const { email } = req.body;
  if (typeof email !== 'string' || email.length > 254)
    return res.status(400).json({ error: 'E-mail obrigatório.' });

  const user = db
    .prepare(
      'SELECT id, name, email FROM users WHERE email = ? AND deleted_at IS NULL'
    )
    .get(email.trim().toLowerCase());
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)'
    ).run(
      crypto.createHash('sha256').update(token).digest('hex'),
      user.id,
      expires
    );
    const baseUrl = config.publicUrl;
    sendMail(user.email, 'password_reset', {
      name: user.name,
      token,
      baseUrl,
    }).catch(() => {});
    return res.json({
      message: 'Se o e-mail existir, instruções foram enviadas.',
      dev_token: undefined,
    });
  }
  res.json({ message: 'Se o e-mail existir, instruções foram enviadas.' });
});

router.post('/password-reset/confirm', (req, res) => {
  const { token, new_password } = req.body;
  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{48}$/.test(token) ||
    !new_password
  )
    return res.status(400).json({ error: 'Token e nova senha obrigatórios.' });
  if (
    typeof new_password !== 'string' ||
    new_password.length < 12 ||
    new_password.length > 128
  )
    return res.status(400).json({ error: 'Senha mínima: 12 caracteres.' });

  const row = db
    .prepare('SELECT * FROM password_resets WHERE token = ?')
    .get(crypto.createHash('sha256').update(token).digest('hex'));
  if (!row) return res.status(400).json({ error: 'Token inválido.' });
  if (row.used_at)
    return res.status(400).json({ error: 'Token já utilizado.' });
  if (new Date(row.expires_at) < new Date())
    return res.status(400).json({ error: 'Token expirado.' });

  const { hash, salt } = hashPassword(new_password);
  try {
    tx(() => {
      const consumed = db
        .prepare(
          'UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE token=? AND used_at IS NULL'
        )
        .run(row.token);
      if (!consumed.changes)
        throw Object.assign(new Error('Token já utilizado.'), { status: 400 });
      db.prepare(
        'UPDATE users SET password_hash = ?, salt = ?,api_key=?,api_key_rotated_at=CURRENT_TIMESTAMP WHERE id = ?'
      ).run(
        hash,
        salt,
        'smm_' + crypto.randomBytes(16).toString('hex'),
        row.user_id
      );
      db.prepare(
        'UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?'
      ).run(row.user_id);
      db.prepare(
        'UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE user_id = ?'
      ).run(row.user_id);
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.status ? err.message : 'Não foi possível redefinir a senha.',
    });
  }
  res.json({ message: 'Senha alterada com sucesso.' });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Senhas obrigatórias.' });
  if (
    typeof current_password !== 'string' ||
    typeof new_password !== 'string' ||
    new_password.length < 12 ||
    new_password.length > 128
  )
    return res.status(400).json({ error: 'Senha mínima: 12 caracteres.' });

  const u = db
    .prepare('SELECT password_hash, salt FROM users WHERE id = ?')
    .get(req.user.id);
  if (!verifyPassword(current_password, u.password_hash, u.salt)) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }
  const { hash, salt } = hashPassword(new_password);
  db.prepare(
    'UPDATE users SET password_hash = ?, salt = ?,api_key=?,api_key_rotated_at=CURRENT_TIMESTAMP WHERE id = ?'
  ).run(
    hash,
    salt,
    'smm_' + crypto.randomBytes(16).toString('hex'),
    req.user.id
  );
  db.prepare(
    'UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?'
  ).run(req.user.id);
  res.json({
    message: 'Senha alterada. Entre novamente.',
    reauth_required: true,
  });
});

module.exports = router;
