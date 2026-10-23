const { db } = require('../db');
const exact = new Set([
  '/api/wallet/pix/create',
  '/api/wallet/crypto/create',
  '/api/lootbox/open',
  '/api/gamification/spin',
  '/api/engagement/streak/checkin',
]);
module.exports = (req, res, next) => {
  const path = req.originalUrl.split('?')[0];
  const affectsMoney =
    req.method === 'POST' &&
    (exact.has(path) ||
      /^\/api\/missions\/\d+\/claim$/.test(path) ||
      path.startsWith('/api/fast-checkout/'));
  if (
    affectsMoney &&
    db.prepare("SELECT value FROM settings WHERE key='freeze_mode'").get()
      ?.value === '1'
  )
    return res.status(503).json({
      error:
        'Novas cobranças, compras e bônus estão pausados durante o congelamento. Pagamentos já realizados continuam sujeitos à conciliação.',
    });
  next();
};
