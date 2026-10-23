const { verifyToken, extractToken } = require('../auth');

module.exports = function rateLimitUser({ windowMs = 60_000, max = 60 } = {}) {
  const buckets = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }, 300000).unref();
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token) return next();
    const payload = verifyToken(token);
    if (!payload) return next();

    const now = Date.now();
    let b = buckets.get(payload.id);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(payload.id, b);
    }
    b.count++;
    if (b.count > max) {
      return res
        .status(429)
        .json({ error: `Limite de ${max} req/min por usuário atingido.` });
    }
    res.setHeader('X-User-RateLimit-Remaining', Math.max(0, max - b.count));
    next();
  };
};
