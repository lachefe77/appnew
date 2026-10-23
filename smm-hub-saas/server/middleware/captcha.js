const config = require('../config');

async function verifyCaptcha(token, ip) {
  if (config.captcha.provider === 'none') return true;
  if (!token || typeof token !== 'string') return false;

  try {
    if (
      config.captcha.provider === 'hcaptcha' &&
      config.captcha.hcaptchaSecret
    ) {
      const body = new URLSearchParams({
        secret: config.captcha.hcaptchaSecret,
        response: token,
        remoteip: ip || '',
      });
      const r = await fetch('https://hcaptcha.com/siteverify', {
        method: 'POST',
        body: body.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(5000),
      });
      const data = await r.json();
      return !!data.success;
    }
    if (
      config.captcha.provider === 'turnstile' &&
      config.captcha.turnstileSecret
    ) {
      const body = new URLSearchParams({
        secret: config.captcha.turnstileSecret,
        response: token,
        remoteip: ip || '',
      });
      const r = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          body: body.toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(5000),
        }
      );
      const data = await r.json();
      return !!data.success;
    }
  } catch {}
  return false;
}

function requireCaptcha() {
  return async (req, res, next) => {
    if (config.captcha.provider === 'none') return next();
    const token = req.body?.captcha_token || req.headers['x-captcha-token'];
    const ok = await verifyCaptcha(token, req.ip);
    if (!ok)
      return res.status(400).json({ error: 'Verificação de CAPTCHA falhou.' });
    next();
  };
}

module.exports = { verifyCaptcha, requireCaptcha };
