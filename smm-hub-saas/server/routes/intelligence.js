const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

/* 1. DYNAMIC PRICING */
router.get('/pricing/rules', requireAdmin, (req, res) => {
  res.json({
    rules: db
      .prepare('SELECT * FROM dynamic_pricing_rules ORDER BY id DESC')
      .all(),
  });
});
router.post('/pricing/rules', requireAdmin, (req, res) => {
  const { service_id, platform, day_of_week, hour_from, hour_to, multiplier } =
    req.body;
  const r = db
    .prepare(
      `INSERT INTO dynamic_pricing_rules (service_id, platform, day_of_week, hour_from, hour_to, multiplier)
    VALUES (?,?,?,?,?,?)`
    )
    .run(
      service_id || null,
      platform || null,
      day_of_week ?? null,
      hour_from ?? null,
      hour_to ?? null,
      parseFloat(multiplier) || 1.0
    );
  res.status(201).json({ id: r.lastInsertRowid });
});
router.delete('/pricing/rules/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM dynamic_pricing_rules WHERE id = ?').run(
    req.params.id
  );
  res.json({ ok: true });
});

function getCurrentMultiplier(service) {
  const now = new Date();
  const dow = now.getDay(),
    hour = now.getHours();
  const rule = db
    .prepare(
      `
    SELECT multiplier FROM dynamic_pricing_rules
    WHERE is_active = 1
      AND (service_id = ? OR service_id IS NULL)
      AND (platform = ? OR platform IS NULL)
      AND (day_of_week = ? OR day_of_week IS NULL)
      AND (hour_from IS NULL OR ? >= hour_from)
      AND (hour_to IS NULL OR ? < hour_to)
    ORDER BY (service_id IS NOT NULL) DESC, (platform IS NOT NULL) DESC LIMIT 1
  `
    )
    .get(service.id, service.platform, dow, hour, hour);
  return rule ? rule.multiplier : 1.0;
}

/* 2. AI RECOMMENDER */
router.get('/recommend', requireAuth, (req, res) => {
  const myServices = db
    .prepare('SELECT DISTINCT service_id FROM orders WHERE user_id = ?')
    .all(req.user.id)
    .map((r) => r.service_id);
  const inList = myServices.length ? myServices.join(',') : '0';

  const similar = db
    .prepare(
      `SELECT user_id FROM orders WHERE service_id IN (${inList}) AND user_id != ?
    GROUP BY user_id ORDER BY COUNT(DISTINCT service_id) DESC LIMIT 20`
    )
    .all(req.user.id)
    .map((r) => r.user_id);

  if (!similar.length) {
    const popular = db
      .prepare(
        `SELECT s.id, s.name, s.platform, s.price_per_k_cents, COUNT(o.id) as n
      FROM orders o JOIN services s ON o.service_id = s.id WHERE s.status='active'
      GROUP BY s.id ORDER BY n DESC LIMIT 5`
      )
      .all();
    return res.json({ recommendations: popular, method: 'popularity' });
  }

  const recs = db
    .prepare(
      `SELECT s.id, s.name, s.platform, s.price_per_k_cents, COUNT(o.id) as score
    FROM orders o JOIN services s ON o.service_id = s.id
    WHERE o.user_id IN (${similar.join(',')}) AND s.id NOT IN (${inList})
    AND s.status='active' GROUP BY s.id ORDER BY score DESC LIMIT 5`
    )
    .all();
  res.json({ recommendations: recs, method: 'collaborative' });
});

/* 3. LINK SCORING */
function scoreLink(link) {
  const factors = [];
  let score = 50;
  try {
    const u = new URL(link.startsWith('http') ? link : 'https://' + link);
    const host = u.hostname.toLowerCase();
    const trusted = [
      'instagram.com',
      'tiktok.com',
      'youtube.com',
      'twitter.com',
      't.me',
      'spotify.com',
      'facebook.com',
      'linkedin.com',
    ];
    if (trusted.some((t) => host === t || host.endsWith('.' + t))) {
      score += 30;
      factors.push('host_trusted');
    }
    if (u.search.length > 50) {
      score -= 15;
      factors.push('tracking_params_excess');
    }
    if (/\/p\/|\/reel\/|\/video\/|\/@/.test(u.pathname)) {
      score += 10;
      factors.push('post_pattern');
    }
    if (u.pathname.length < 3) {
      score -= 10;
      factors.push('path_too_short');
    }
  } catch {
    score -= 30;
    factors.push('invalid_url');
  }
  return { score: Math.max(0, Math.min(100, score)), factors };
}

router.post('/score-link', requireAuth, (req, res) => {
  const { link } = req.body;
  if (!link) return res.status(400).json({ error: 'link obrigatório' });
  const hash = crypto
    .createHash('sha256')
    .update(link)
    .digest('hex')
    .substring(0, 32);
  const cached = db
    .prepare('SELECT * FROM link_scores WHERE link_hash = ?')
    .get(hash);
  if (cached)
    return res.json({
      score: cached.score,
      factors: JSON.parse(cached.factors_json || '[]'),
      cached: true,
    });
  const result = scoreLink(link);
  db.prepare(
    `INSERT INTO link_scores (link_hash, link, score, factors_json) VALUES (?,?,?,?)`
  ).run(hash, link, result.score, JSON.stringify(result.factors));
  res.json({ ...result, cached: false });
});

/* 4. AGENDAMENTO */
router.post('/schedule-order', requireAuth, (req, res) => {
  const { service_id, link, quantity, run_at } = req.body;
  if (!service_id || !link || !quantity || !run_at)
    return res.status(400).json({ error: 'Faltam campos.' });
  try {
    require('../order-domain').quoteOrder(req.user.id, {
      service_id,
      link,
      quantity,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const runDate = new Date(run_at);
  if (isNaN(runDate) || runDate < Date.now())
    return res.status(400).json({ error: 'Data inválida.' });
  const r = db
    .prepare(
      `INSERT INTO scheduled_orders (user_id, service_id, link, quantity, run_at) VALUES (?,?,?,?,?)`
    )
    .run(req.user.id, service_id, link, quantity, runDate.toISOString());
  res
    .status(201)
    .json({ id: r.lastInsertRowid, run_at: runDate.toISOString() });
});
router.get('/scheduled', requireAuth, (req, res) => {
  res.json({
    scheduled: db
      .prepare(
        'SELECT * FROM scheduled_orders WHERE user_id = ? ORDER BY run_at ASC'
      )
      .all(req.user.id),
  });
});
router.delete('/scheduled/:id', requireAuth, (req, res) => {
  const r = db
    .prepare(
      `DELETE FROM scheduled_orders WHERE id = ? AND user_id = ? AND status = 'pending'`
    )
    .run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Não encontrado.' });
  res.json({ ok: true });
});

/* 7. AUTOPILOT */
router.post('/autopilot', requireAuth, (req, res) => {
  const { budget_monthly_cents, allocation } = req.body;
  if (
    !Number.isSafeInteger(budget_monthly_cents) ||
    budget_monthly_cents <= 0 ||
    !require('../automation-domain').validateAllocation(allocation)
  )
    return res.status(400).json({
      error: 'Informe orçamento inteiro positivo e alocação total de 100%.',
    });
  const r = db
    .prepare(
      `INSERT INTO autopilot_configs (user_id, budget_monthly_cents, allocation_json) VALUES (?,?,?)`
    )
    .run(req.user.id, budget_monthly_cents, JSON.stringify(allocation));
  res.status(201).json({ id: r.lastInsertRowid });
});
router.get('/autopilot', requireAuth, (req, res) => {
  res.json({
    configs: db
      .prepare('SELECT * FROM autopilot_configs WHERE user_id = ?')
      .all(req.user.id),
  });
});
router.post('/autopilot/:id/toggle', requireAuth, (req, res) => {
  const row = db
    .prepare('SELECT * FROM autopilot_configs WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Não encontrado.' });
  db.prepare('UPDATE autopilot_configs SET is_active = ? WHERE id = ?').run(
    row.is_active ? 0 : 1,
    row.id
  );
  res.json({ is_active: !row.is_active });
});

/* 8. ROI */
router.get('/roi-estimate', requireAuth, (req, res) => {
  const { service_id, budget_cents } = req.query;
  const s = db.prepare('SELECT * FROM services WHERE id = ?').get(service_id);
  if (!s) return res.status(404).json({ error: 'Serviço inexistente.' });
  const budget = parseInt(budget_cents, 10) || 10000;
  const unitsPerK = (budget / s.price_per_k_cents) * 1000;
  const avg = db
    .prepare(
      `SELECT AVG((julianday(updated_at) - julianday(created_at))) as d
    FROM orders WHERE service_id = ? AND status = 'completed' LIMIT 100`
    )
    .get(service_id);
  res.json({
    service: s.name,
    estimated_units: Math.round(unitsPerK),
    estimated_delivery_days: Math.max(1, Math.round(avg?.d || 2)),
    budget_formatted: `R$ ${(budget / 100).toFixed(2).replace('.', ',')}`,
    confidence: s.refill_available ? 'alta' : 'media',
  });
});

/* 10. CHATBOT */
router.post('/chatbot', requireAuth, (req, res) => {
  const { message } = req.body;
  const faqs = {
    pedido:
      'Pra fazer um pedido: Vitrine → escolha o serviço → cole o link → confirme. Pix cai em segundos.',
    saldo:
      'Seu saldo está no topo da tela. Pra recarregar, use Pix em "Carteira".',
    reposicao:
      'Clique no pedido concluído e aperte "Pedir Reposição". Vale 30 dias.',
    reembolso:
      'Pedidos parciais são reembolsados automaticamente. Cancelados pelo admin estornam integral.',
    cupom: 'BEMVINDO10 dá 10% off na primeira compra acima de R$10.',
    cartao:
      'Consulte os métodos habilitados na carteira. Cartão ainda não integrado.',
    bitcoin:
      'BTC e USDT ficam disponíveis após a configuração e homologação do gateway.',
    boleto: 'Boleto ainda não integrado. Consulte os métodos habilitados.',
  };
  const low = (message || '').toLowerCase();
  for (const [k, v] of Object.entries(faqs))
    if (low.includes(k)) return res.json({ answer: v, source: 'faq' });
  res.json({
    answer:
      'Não achei na base. Abra um ticket em /tickets que o time responde rápido.',
    source: 'fallback',
  });
});

/* 9. ANOMALIES */
router.get('/anomalies', requireAdmin, (req, res) => {
  const bad = db
    .prepare(
      `SELECT s.id, s.name, s.platform, COUNT(o.id) as total,
    SUM(CASE WHEN o.status='failed' THEN 1 ELSE 0 END) as failed
    FROM services s JOIN orders o ON o.service_id = s.id
    WHERE o.created_at > datetime('now','-24 hours')
    GROUP BY s.id HAVING failed * 100.0 / total > 15 AND total >= 5
    ORDER BY failed DESC`
    )
    .all();
  res.json({ anomalies: bad });
});

module.exports = { router, getCurrentMultiplier, scoreLink };
