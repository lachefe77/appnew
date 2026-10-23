const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');
const yaml = require('yaml');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const logger = require('./logger');
const { initDB, close: closeDB, db } = require('./db');
const { applyExtendedSchema } = require('./extended-schema');
const {
  startOrderProgressWorker,
  startWebhookDeliveryWorker,
} = require('./smm-engine');
const { startSnapshotWorker } = require('./jobs/financial-snapshot');
const { startSubscriptionWorker } = require('./jobs/subscription-worker');
const { startRotationWorker } = require('./jobs/api-key-rotation');
const {
  startScheduledWorker,
  startAutopilotWorker,
  startContractsWorker,
} = require('./jobs/all-workers');
const { startWatchdog } = require('./telegram-alerts');
const { applyV3Schema } = require('./extended-schema-v3');
const metrics = require('./metrics');
const { initI18n } = require('./i18n');
const maintenance = require('./middleware/maintenance');
const rateLimitUser = require('./middleware/rate-limit-user');

const authRoutes = require('./routes/auth');
const servicesRoutes = require('./routes/services');
const ordersRoutes = require('./routes/orders');
const walletRoutes = require('./routes/wallet');
const ticketsRoutes = require('./routes/tickets');
const adminRoutes = require('./routes/admin');
const adminExtrasRoutes = require('./routes/admin-extras');
const apiV2Routes = require('./routes/api-v2');
const gamificationRoutes = require('./routes/gamification');
const subscriptionsRoutes = require('./routes/subscriptions');
const childPanelsRoutes = require('./routes/child-panels');
const couponsRoutes = require('./routes/coupons');
const cryptoRoutes = require('./routes/crypto');
const announcementsRoutes = require('./routes/announcements');
const reviewsRoutes = require('./routes/reviews');
const fastCheckoutRoutes = require('./routes/fast-checkout');
const socialProofRoutes = require('./routes/social-proof');
const linkValidatorRoutes = require('./routes/link-validator');
const agencyRoutes = require('./routes/agency');
const webhooksRoutes = require('./routes/webhooks');
const missionsRoutes = require('./routes/missions');
const blogRoutes = require('./routes/blog');
const publicTrackRoutes = require('./routes/public-track');
const lootboxRoutes = require('./routes/lootbox');
const leaderboardRoutes = require('./routes/leaderboard');
const securityRoutes = require('./routes/security');
const sseRoutes = require('./routes/sse');
const ambassadorRoutes = require('./routes/ambassador');
const lgpdRoutes = require('./routes/lgpd');
const preferencesRoutes = require('./routes/preferences');
const currenciesRoutes = require('./routes/currencies');
const clientAnalyticsRoutes = require('./routes/client-analytics');
const fingerprintRoutes = require('./routes/fingerprint');
const { router: intelligenceRoutes } = require('./routes/intelligence');
const b2bRoutes = require('./routes/b2b');
const engagementRoutes = require('./routes/engagement');
const siteConfigRoutes = require('./routes/site-config');
const miscRoutes = require('./routes/misc');
const graphqlRoutes = require('./routes/graphql');
const eventsRoutes = require('./routes/events');
const teamRoutes = require('./routes/team');
const profileRoutes = require('./routes/profile');

async function bootstrap() {
  initDB();
  applyExtendedSchema();
  applyV3Schema();
  require('./mail').registerMailWorker();
  require('./job-queue').registerHandler('dispatch', ({ orderId }) =>
    require('./smm-engine').dispatchOrder(orderId)
  );
  require('./job-queue').registerHandler(
    'settle-ambassador',
    require('./ambassador-settlement').settle
  );
  require('./job-queue').start();
  require('./job-queue').registerHandler(
    'refund-order',
    ({ orderId, partial, remains }) =>
      require('./smm-engine').refundOrder(orderId, partial, remains)
  );
  require('./order-reconciliation').start();
  require('./operations-center').start();
  startOrderProgressWorker();
  require('./jobs/refill-worker').start();
  startWebhookDeliveryWorker();
  startSnapshotWorker();
  startSubscriptionWorker();
  startRotationWorker();
  startScheduledWorker();
  startAutopilotWorker();
  startContractsWorker();
  startWatchdog(db);

  const i18nMw = await initI18n();

  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY || false);


  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrcAttr:["'unsafe-inline'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            ...(config.captcha.provider === 'turnstile'
              ? ['https://challenges.cloudflare.com']
              : config.captcha.provider === 'hcaptcha'
                ? ['https://js.hcaptcha.com', 'https://*.hcaptcha.com']
                : []),
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: [
            "'self'",
            ...(config.captcha.provider === 'turnstile'
              ? ['https://challenges.cloudflare.com']
              : config.captcha.provider === 'hcaptcha'
                ? ['https://hcaptcha.com', 'https://*.hcaptcha.com']
                : []),
          ],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          frameSrc:
            config.captcha.provider === 'turnstile'
              ? ['https://challenges.cloudflare.com']
              : config.captcha.provider === 'hcaptcha'
                ? ['https://hcaptcha.com', 'https://*.hcaptcha.com']
                : ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.env === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(['/painel.html','/operations.html'],helmet.contentSecurityPolicy({useDefaults:true,directives:{
    defaultSrc:["'self'"],scriptSrc:["'self'"],scriptSrcAttr:["'none'"],
    styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],fontSrc:["'self'",'https://fonts.gstatic.com','data:'],
    imgSrc:["'self'",'data:','blob:','https:'],connectSrc:["'self'"],objectSrc:["'none'"],baseUri:["'none'"],frameAncestors:["'none'"],formAction:["'self'"],upgradeInsecureRequests:config.env==='production'?[]:null
  }}));
  app.use(
    cors(
      config.cors.origins.includes('*')
        ? { origin: true }
        : { origin: config.cors.origins, credentials: true }
    )
  );
  app.use(maintenance);
  app.use(i18nMw);

  app.use((req, res, next) => {
    req.requestId = require('node:crypto').randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    metrics.inc('http_requests_total');
    const t0 = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - t0;
      metrics.observeHttp(ms, res.statusCode);
      if (req.path.startsWith('/api'))
        logger.debug(
          {
            requestId: req.requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms,
          },
          'req'
        );
    });
    next();
  });

  app.use(
    '/api/wallet/pix/webhook',
    express.raw({ type: '*/*', limit: '1mb' })
  );
  app.use(
    '/api/wallet/crypto/webhook',
    express.raw({ type: '*/*', limit: '1mb' })
  );
  app.use('/api/tickets', express.json({ limit: '9mb' }));
  app.use('/api/support', express.json({ limit: '9mb' }));
  app.use('/api/admin/tickets', express.json({ limit: '9mb' }));
  app.use(express.json({ limit: '128kb' }));
  app.use(express.urlencoded({ extended: true, limit: '128kb' }));
  app.use('/api', require('./middleware/input-limits'));
  app.use('/api', require('./middleware/freeze'));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
  const strictLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/password-reset', authLimiter);
  app.use('/api/agency/sub-login', authLimiter);
  app.use('/api/b2b/supplier/login', authLimiter);
  app.use('/api/v2', strictLimiter);
  app.use('/api', apiLimiter);
  app.use('/api/orders', rateLimitUser({ windowMs: 60_000, max: 60 }));
  app.use(
    '/api/wallet/pix/create',
    rateLimitUser({ windowMs: 60_000, max: 10 })
  );

  // Rotas
  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard',require('./routes/dashboard'));
  app.use('/api/social',require('./routes/social'));
  app.get('/.well-known/smmhub-panel',(req,res)=>{
    const nonce=req.get('X-Provision-Challenge');
    if(!process.env.CHILD_PROVISION_ID||!process.env.CHILD_ACTIVATION_SECRET||typeof nonce!=='string'||!/^[a-f0-9]{48}$/.test(nonce))return res.sendStatus(404);
    res.set('Cache-Control','no-store').json({id:process.env.CHILD_PROVISION_ID,signature:require('node:crypto').createHmac('sha256',process.env.CHILD_ACTIVATION_SECRET).update(nonce).digest('hex')});
  });
  app.use('/api/combos',rateLimitUser({windowMs:60000,max:20}),require('./routes/combos'));
  app.use(
    '/api/auth/email-verification',
    require('./routes/email-verification')
  );
  app.use('/api/services', servicesRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/wallet/crypto', cryptoRoutes);
  app.use('/api/tickets', ticketsRoutes);
  app.use('/api/support', require('./routes/support'));
  app.use('/api/admin', adminRoutes);
  app.use('/api/admin', require('./routes/admin-catalog'));
  app.use('/api/admin', adminExtrasRoutes);
  app.use('/api/admin/integrations', require('./routes/integrations'));
  app.use('/api/admin', require('./routes/admin-operations'));
  app.use('/api/admin',require('./routes/admin-combos'));
  app.use('/api/admin/center',require('./routes/operations-center'));
  app.use('/api/v2', apiV2Routes);
  app.use('/api/gamification', gamificationRoutes);
  app.use('/api/subscriptions', subscriptionsRoutes);
  app.use('/api/child-panels', childPanelsRoutes);
  app.use('/api/coupons', couponsRoutes);
  app.use('/api/announcements', announcementsRoutes);
  app.use('/api/reviews', reviewsRoutes);
  app.use('/api/fast-checkout', fastCheckoutRoutes);
  app.use('/api/social-proof', socialProofRoutes);
  app.use('/api/link', linkValidatorRoutes);
  app.use('/api/agency', agencyRoutes);
  app.use('/api/webhooks', webhooksRoutes);
  app.use('/api/missions', missionsRoutes);
  app.use('/api/blog', blogRoutes);
  app.use('/api/track', publicTrackRoutes);
  app.use('/api/lootbox', lootboxRoutes);
  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/security', securityRoutes);
  app.use('/api/sse', sseRoutes);
  app.use('/api/ambassador', ambassadorRoutes);
  app.use('/api/lgpd', lgpdRoutes);
  app.use('/api/preferences', preferencesRoutes);
  app.use('/api/currencies', currenciesRoutes);
  app.use('/api/analytics', clientAnalyticsRoutes);
  app.use('/api/fingerprint', fingerprintRoutes);
  app.use('/api/intelligence', intelligenceRoutes);
  app.use('/api/b2b', b2bRoutes);
  app.use('/api/engagement', engagementRoutes);
  app.use('/api/site', siteConfigRoutes);
  app.use('/api/misc', miscRoutes);
  app.use('/api/graphql', graphqlRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/team', teamRoutes);
  app.use('/api/profile', profileRoutes);

  // OpenAPI docs
  try {
    const spec = yaml.parse(
      fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf-8')
    );
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));
  } catch (err) {
    logger.warn({ err: err.message }, 'OpenAPI docs não carregadas');
  }

  // Prometheus metrics
  if (config.metrics.enabled) {
    app.get('/metrics', (req, res) => {
      const token = req.headers['x-metrics-token'];
      if (token !== config.metrics.token)
        return res.status(401).type('text').send('# unauthorized');
      res.type('text/plain; version=0.0.4').send(metrics.render());
    });
  }

  app.get('/sitemap.xml', (req, res) => {
    const origin = (config.publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const posts = db
      .prepare('SELECT slug FROM blog_posts ORDER BY id DESC LIMIT 200')
      .all();
    const urls = ['/', '/blog.html', '/terms.html', '/privacy.html', '/register.html', '/login.html']
      .concat(posts.map((post) => '/post.html?slug=' + encodeURIComponent(post.slug)))
      .map((loc) => `<url><loc>${origin}${loc}</loc></url>`)
      .join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });
  app.get('/robots.txt', (req, res) => {
    const origin = (config.publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  });

  app.get('/health', (req, res) => {
    let dbOk = true;
    try {
      db.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      service: 'SMM-Hub Enterprise Suite',
      version: '2.1.0',
      db: dbOk,
      pix_provider: config.pix.provider,
      crypto_provider: config.crypto.provider,
      queue: config.queue.driver,
      env: config.env,
      timestamp: new Date().toISOString(),
    });
  });
  app.get('/health/live', (req, res) => res.json({ status: 'alive' }));
  app.get('/health/ready', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      const failed = db
        .prepare("SELECT COUNT(*) AS n FROM job_queue WHERE status='failed'")
        .get().n;
      const stale = db
        .prepare(
          "SELECT COUNT(*) AS n FROM job_queue WHERE status='pending' AND datetime(next_run)<datetime('now','-10 minutes')"
        )
        .get().n;
      res.status(stale ? 503 : 200).json({
        status: stale ? 'degraded' : 'ready',
        database: true,
        queue: { overdue: stale, failed },
      });
    } catch {
      res.status(503).json({ status: 'not_ready', database: false });
    }
  });

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (path.extname(req.path))
      return res.status(404).send('Arquivo não encontrado.');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (
      Number.isInteger(err.status) &&
      ((err.status >= 400 && err.status < 500) || err.status === 503)
    )
      return res.status(err.status).json({ error: err.message });
    logger.error(
      { err: err.message, stack: err.stack, path: req.path },
      'Unhandled error'
    );
    res.status(500).json({ error: 'Erro interno do servidor.' });
  });

  const server = app.listen(
    config.port,
    process.env.HOST || (config.env === 'production' ? '0.0.0.0' : '127.0.0.1'),
    () => {
      logger.info(
        { port: config.port, pix: config.pix.provider, env: config.env },
        '🚀 SMM HUB ENTERPRISE v2.1 pronto'
      );
      console.log(`\n======================================================`);
      console.log(`🚀 SMM HUB ENTERPRISE v2.1 — ${config.env.toUpperCase()}`);
      console.log(`======================================================`);
      console.log(`📡 Local:         http://localhost:${config.port}`);
      console.log(`📚 Docs API:      http://localhost:${config.port}/api/docs`);
      console.log(`❤️  Health:        http://localhost:${config.port}/health`);
      console.log(
        `📊 Metrics:       http://localhost:${config.port}/metrics (use X-Metrics-Token)`
      );
      console.log(
        `📝 Blog:          http://localhost:${config.port}/blog.html`
      );
      console.log(
        `📈 Admin Dash:    http://localhost:${config.port}/admin-dashboard.html`
      );
      console.log(`------------------------------------------------------`);
      console.log(`======================================================\n`);
    }
  );

  function shutdown(signal) {
    logger.info({ signal }, 'Encerrando servidor...');
    server.close(() => {
      closeDB();
      logger.info('Servidor encerrado.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) =>
    logger.fatal({ err: err.message, stack: err.stack }, 'uncaughtException')
  );
  process.on('unhandledRejection', (err) =>
    logger.error({ err: String(err) }, 'unhandledRejection')
  );
}

bootstrap().catch((err) => {
  console.error('Falha no bootstrap:', err);
  process.exit(1);
});
