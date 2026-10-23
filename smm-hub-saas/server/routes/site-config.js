const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.get('/brand',(req,res)=>res.json({name:(process.env.SITE_NAME||'SMM Hub').slice(0,80)}));
router.get('/stats', (req, res) =>
  res.json(require('../public-stats').stats())
);

function blank(value) {
  const text = String(value || '').trim();
  return text && !/^https?:\/\/(instagram\.com\/smmhub|t\.me\/smmhub)\/?$/i.test(text)
    ? text
    : null;
}

router.get('/offer', (req, res) => {
  const stats = require('../public-stats').stats();
  const content = Object.fromEntries(
    db.prepare('SELECT key, value FROM site_content').all().map((row) => [row.key, row.value])
  );
  const cnpj = String(content['company.cnpj'] || '').trim();
  const min = Number(
    db.prepare("SELECT value FROM settings WHERE key='min_deposit_brl'").get()?.value
  );
  res.json({
    services: stats.active_services,
    platforms: stats.active_platforms,
    users: stats.total_users,
    delivered: stats.total_delivered,
    real_providers: stats.real_providers,
    min_deposit_brl: Number.isFinite(min) ? min : 5,
    payments: db
      .prepare(
        'SELECT id, method, label, description, icon, min_amount_cents, max_amount_cents FROM payment_methods_config WHERE is_enabled = 1 ORDER BY display_order ASC'
      )
      .all()
      .filter((method) => require('../payment-policy').available(method.method)),
    company: {
      name: content['company.name'] || 'SMM Hub',
      cnpj: cnpj && cnpj !== '00.000.000/0001-00' ? cnpj : null,
      email: blank(content['company.email']),
    },
    social: {
      instagram: blank(content['social.instagram']),
      telegram: blank(content['social.telegram']),
      whatsapp: blank(content['company.whatsapp']),
    },
    instagram_connect:
      !!process.env.INSTAGRAM_CLIENT_ID &&
      !!process.env.INSTAGRAM_CLIENT_SECRET &&
      String(process.env.APP_PUBLIC_URL || '').startsWith('https://'),
  });
});

/* Conteúdo editável do site (hero, textos, redes, legais) */
router.get('/content', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_content').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  obj['stats.active_clients'] = String(
    require('../public-stats').stats().total_users
  );
  obj['stats.uptime'] = 'Não medido';
  res.json({ content: obj });
});

router.put('/content', requireAdmin, (req, res) => {
  const entries=Object.entries(req.body);
  if(!entries.length||entries.length>100||entries.some(([k,v])=>!/^[a-z][a-z0-9_.-]{0,99}$/i.test(k)||typeof v!=='string'||v.length>4000))return res.status(400).json({error:'Conteúdo inválido: até 100 campos de texto, com no máximo 4000 caracteres cada.'});
  const upsert =
    db.prepare(`INSERT INTO site_content (key, value, updated_by) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by`);
  for (const [k, v] of Object.entries(req.body))
    upsert.run(k, String(v), req.user.id);
  res.json({ message: 'Conteúdo atualizado.' });
});

/* Métodos de pagamento (editáveis) */
router.get('/payment-methods', (req, res) => {
  res.json({
    methods: db
      .prepare(
        'SELECT * FROM payment_methods_config WHERE is_enabled = 1 ORDER BY display_order ASC'
      )
      .all()
      .filter((m) => require('../payment-policy').available(m.method)),
  });
});
router.get('/admin/payment-methods', requireAdmin, (req, res) => {
  res.json({
    methods: db
      .prepare(
        'SELECT * FROM payment_methods_config ORDER BY display_order ASC'
      )
      .all(),
  });
});
router.put('/admin/payment-methods/:id', requireAdmin, (req, res) => {
  const {
    is_enabled,
    display_order,
    label,
    description,
    min_amount_cents,
    max_amount_cents,
  } = req.body;
  if (
    ![true, false, 0, 1].includes(is_enabled) ||
    !Number.isSafeInteger(display_order) ||
    display_order < 0 ||
    display_order > 1000 ||
    typeof label !== 'string' ||
    !label.trim() ||
    label.length > 100 ||
    typeof description !== 'string' ||
    description.length > 1000 ||
    !Number.isSafeInteger(min_amount_cents) ||
    !Number.isSafeInteger(max_amount_cents) ||
    min_amount_cents < 1 ||
    max_amount_cents < min_amount_cents ||
    max_amount_cents > 100000000
  )
    return res
      .status(400)
      .json({ error: 'Configuração de pagamento inválida.' });
  db.prepare(
    `UPDATE payment_methods_config SET is_enabled=?, display_order=?, label=?, description=?, min_amount_cents=?, max_amount_cents=?
    WHERE id = ?`
  ).run(
    is_enabled ? 1 : 0,
    display_order || 0,
    label,
    description,
    min_amount_cents,
    max_amount_cents,
    req.params.id
  );
  res.json({ ok: true });
});

/* Plataformas visíveis */
router.get('/platforms', (req, res) => {
  res.json({
    platforms: db
      .prepare(
        'SELECT * FROM platforms_config WHERE is_visible = 1 ORDER BY display_order ASC'
      )
      .all(),
  });
});
router.get('/admin/platforms', requireAdmin, (req, res) => {
  res.json({
    platforms: db
      .prepare('SELECT * FROM platforms_config ORDER BY display_order ASC')
      .all(),
  });
});
router.put('/admin/platforms/:id', requireAdmin, (req, res) => {
  const { name, icon, color, display_order, is_visible, description } =
    req.body;
  if(typeof name!=='string'||name.trim().length<2||name.length>100||typeof icon!=='string'||!/^[a-z0-9 -]{1,100}$/i.test(icon)||typeof color!=='string'||!/^#[a-f0-9]{6}$/i.test(color)||!Number.isSafeInteger(display_order)||display_order<0||display_order>1000||![true,false,0,1].includes(is_visible)||typeof description!=='string'||description.length>1000)return res.status(400).json({error:'Configuração de plataforma inválida.'});
  db.prepare(
    `UPDATE platforms_config SET name=?, icon=?, color=?, display_order=?, is_visible=?, description=? WHERE id = ?`
  ).run(
    name,
    icon,
    color,
    display_order || 0,
    is_visible ? 1 : 0,
    description || null,
    req.params.id
  );
  res.json({ ok: true });
});

module.exports = router;
