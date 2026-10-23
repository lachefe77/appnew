const config = require('../config');

function opsMaintenance() {
  try {
    return require('../ops-desk').maintenanceEnabled();
  } catch {
    return false;
  }
}

function staffBypass(req) {
  if (
    req.path.startsWith('/api/admin') ||
    req.path.startsWith('/api/auth') ||
    req.path.startsWith('/health')
  )
    return true;
  if (['/admin.html', '/login.html', '/profile.html'].includes(req.path))
    return true;
  return /\.(js|css|svg|png|ico|woff2)$/.test(req.path);
}

module.exports = function maintenance(req, res, next) {
  const fromDesk = !config.maintenance.enabled && opsMaintenance();
  if (!config.maintenance.enabled && !fromDesk) return next();
  if (fromDesk && staffBypass(req)) return next();
  const ip = req.ip.replace('::ffff:', '');
  if (
    config.maintenance.whitelist.includes(ip) ||
    config.maintenance.whitelist.includes(req.ip)
  )
    return next();
  if (
    [
      '/health',
      '/health/live',
      '/health/ready',
      '/api/wallet/pix/webhook',
      '/api/wallet/crypto/webhook',
    ].includes(req.path)
  )
    return next();
  if (req.path.startsWith('/api/'))
    return res.status(503).set('Retry-After', '300').json({
      error: 'Sistema em manutenção. Tente novamente em alguns minutos.',
    });

  res.status(503).type('html')
    .send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>Manutenção — SMM Hub</title><style>
    body{font-family:system-ui;background:#0b0f17;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{text-align:center;padding:40px;max-width:500px}.logo{font-size:40px;margin-bottom:20px}
    h1{font-size:28px;margin:0 0 12px}p{color:#94a3b8}</style></head>
    <body><div class="box"><div class="logo">⚡</div>
    <h1>Manutenção em andamento</h1>
    <p>Estamos atualizando os servidores. Volte em alguns minutos.</p></div></body></html>`);
};
