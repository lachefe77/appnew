const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

function slugify(title) {
  const base = String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  let slug = base || 'post';
  let n = 2;
  while (db.prepare('SELECT id FROM blog_posts WHERE slug=?').get(slug)) {
    slug = `${base || 'post'}-${n++}`;
  }
  return slug;
}

router.post('/categories', (req, res) => {
  const { name, platform, icon, sort_order } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 80)
    return res.status(400).json({ error: 'Nome de categoria inválido.' });
  if (typeof platform !== 'string' || !/^[a-z0-9_-]{2,32}$/i.test(platform))
    return res.status(400).json({ error: 'Plataforma inválida.' });
  const iconValue =
    typeof icon === 'string' && icon.trim() ? icon.trim() : 'fa-solid fa-tag';
  if (iconValue.length > 80)
    return res.status(400).json({ error: 'Ícone inválido.' });
  const order = sort_order == null || sort_order === '' ? 0 : Number(sort_order);
  if (!Number.isSafeInteger(order) || order < 0 || order > 1000)
    return res.status(400).json({ error: 'Ordem inválida.' });
  const id = Number(
    db
      .prepare(
        'INSERT INTO categories(name, icon, platform, sort_order) VALUES(?,?,?,?)'
      )
      .run(name.trim(), iconValue, platform.trim().toLowerCase(), order)
      .lastInsertRowid
  );
  res.status(201).json({ id, message: 'Categoria criada.' });
});

router.post('/services', (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const platform =
    typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';
  const type = body.type || 'default';
  const providerServiceId =
    typeof body.provider_service_id === 'string'
      ? body.provider_service_id.trim()
      : '';
  const categoryId = Number(body.category_id);
  const providerId = Number(body.provider_id);
  const cost = Number(body.cost_per_k_cents);
  const price = Number(body.price_per_k_cents);
  const min = Number(body.min_quantity);
  const max = Number(body.max_quantity);
  const status = body.status || 'active';
  const refill = body.refill_available ? 1 : 0;
  const description = typeof body.description === 'string' ? body.description : '';
  const avg =
    typeof body.avg_time === 'string' && body.avg_time.trim()
      ? body.avg_time.trim().slice(0, 80)
      : 'Conforme o fornecedor';
  if (name.length < 2 || name.length > 300)
    return res.status(400).json({ error: 'Nome inválido.' });
  if (!/^[a-z0-9_-]{2,32}$/.test(platform))
    return res.status(400).json({ error: 'Plataforma inválida.' });
  if (!['default', 'custom_comments', 'package'].includes(type))
    return res.status(400).json({ error: 'Tipo inválido.' });
  if (!providerServiceId || providerServiceId.length > 100)
    return res
      .status(400)
      .json({ error: 'Informe o identificador do serviço no fornecedor.' });
  if (!db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId))
    return res.status(400).json({ error: 'Categoria não encontrada.' });
  if (
    !db
      .prepare("SELECT id FROM providers WHERE id=? AND status='active'")
      .get(providerId)
  )
    return res.status(400).json({ error: 'Provedor ativo não encontrado.' });
  const cashback = Number(
    db.prepare("SELECT value FROM settings WHERE key='cashback_pct'").get()
      ?.value ?? 3
  );
  if (
    ![cost, price, min, max].every(Number.isSafeInteger) ||
    cost < 0 ||
    price <= 0 ||
    price < cost ||
    min < 1 ||
    max < min ||
    max > 1000000000 ||
    cost + Math.round((price * cashback) / 100) > price
  )
    return res.status(400).json({
      error: 'Preço, custo ou limites inválidos. O preço precisa cobrir o custo e o cashback.',
    });
  if (!['active', 'inactive'].includes(status))
    return res.status(400).json({ error: 'Status inválido.' });
  if (description.length > 6000)
    return res.status(400).json({ error: 'Descrição longa demais.' });
  const id = Number(
    db
      .prepare(
        `INSERT INTO services (category_id, name, platform, type, provider_id, provider_service_id, cost_per_k_cents, price_per_k_cents, min_quantity, max_quantity, refill_available, dripfeed_available, avg_time, description, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        categoryId,
        name,
        platform,
        type,
        providerId,
        providerServiceId,
        cost,
        price,
        min,
        max,
        refill,
        type === 'custom_comments' ? 0 : body.dripfeed_available ? 1 : 0,
        avg,
        description,
        status
      ).lastInsertRowid
  );
  res.status(201).json({ id, message: 'Serviço criado.' });
});

router.get('/blog', (req, res) => {
  res.json({
    posts: db
      .prepare(
        'SELECT id, slug, title, meta_description, category, author, read_time_minutes, created_at FROM blog_posts ORDER BY id DESC'
      )
      .all(),
  });
});

router.post('/blog', (req, res) => {
  const { title, meta_description, content, category, author } = req.body || {};
  if (typeof title !== 'string' || title.trim().length < 4 || title.length > 180)
    return res.status(400).json({ error: 'Título inválido.' });
  if (typeof content !== 'string' || content.trim().length < 20 || content.length > 20000)
    return res.status(400).json({ error: 'O texto precisa ter entre 20 e 20000 caracteres.' });
  const meta =
    typeof meta_description === 'string' && meta_description.trim()
      ? meta_description.trim().slice(0, 300)
      : content.trim().slice(0, 160);
  const id = Number(
    db
      .prepare(
        `INSERT INTO blog_posts (slug, title, meta_description, content, author, category, read_time_minutes)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        slugify(title),
        title.trim(),
        meta,
        content.trim(),
        typeof author === 'string' && author.trim() ? author.trim().slice(0, 80) : 'Equipe',
        typeof category === 'string' && category.trim()
          ? category.trim().slice(0, 80)
          : 'Geral',
        Math.max(1, Math.round(content.trim().split(/\s+/).length / 200))
      ).lastInsertRowid
  );
  res.status(201).json({ id, message: 'Post publicado.' });
});

router.put('/blog/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM blog_posts WHERE id=?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado.' });
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : post.title;
  const content =
    typeof req.body.content === 'string' ? req.body.content.trim() : post.content;
  const meta =
    typeof req.body.meta_description === 'string'
      ? req.body.meta_description.trim().slice(0, 300)
      : post.meta_description;
  const category =
    typeof req.body.category === 'string' && req.body.category.trim()
      ? req.body.category.trim().slice(0, 80)
      : post.category;
  if (title.length < 4 || content.length < 20)
    return res.status(400).json({ error: 'Título ou texto inválido.' });
  db.prepare(
    'UPDATE blog_posts SET title=?, meta_description=?, content=?, category=? WHERE id=?'
  ).run(title, meta, content, category, post.id);
  res.json({ message: 'Post atualizado.' });
});

router.delete('/blog/:id', (req, res) => {
  const removed = db.prepare('DELETE FROM blog_posts WHERE id=?').run(req.params.id);
  if (!removed.changes) return res.status(404).json({ error: 'Post não encontrado.' });
  res.json({ message: 'Post removido.' });
});

router.post('/challenges', (req, res) => {
  const { title, description, target_type, target_value, prize_pool_cents, month } =
    req.body || {};
  if (typeof title !== 'string' || title.trim().length < 3 || title.length > 120)
    return res.status(400).json({ error: 'Título do desafio inválido.' });
  if (!['spend_cents', 'orders_count'].includes(target_type))
    return res.status(400).json({ error: 'Tipo de meta inválido.' });
  const target = Number(target_value);
  const prize = Number(prize_pool_cents);
  if (
    !Number.isSafeInteger(target) ||
    target < 1 ||
    !Number.isSafeInteger(prize) ||
    prize < 1 ||
    prize > 100000000 ||
    !/^\d{4}-\d{2}$/.test(String(month || ''))
  )
    return res.status(400).json({ error: 'Meta, prêmio ou mês inválido.' });
  const id = Number(
    db
      .prepare(
        `INSERT INTO challenges (title, description, target_type, target_value, prize_pool_cents, month, status)
         VALUES (?,?,?,?,?,?,'open')`
      )
      .run(
        title.trim(),
        typeof description === 'string' ? description.slice(0, 1000) : null,
        target_type,
        target,
        prize,
        month
      ).lastInsertRowid
  );
  res.status(201).json({ id, message: 'Desafio criado.' });
});

router.post('/challenges/:id/close', (req, res) => {
  const changed = db
    .prepare("UPDATE challenges SET status='closed' WHERE id=? AND status='open'")
    .run(req.params.id);
  if (!changed.changes)
    return res.status(404).json({ error: 'Desafio aberto não encontrado.' });
  res.json({ message: 'Desafio encerrado.' });
});

router.get('/scheduled', (req, res) => {
  res.json({
    rows: db
      .prepare(
        `SELECT o.id, o.link, o.quantity, o.run_at, o.status, u.email AS user_email, s.name AS service_name
         FROM scheduled_orders o JOIN users u ON u.id=o.user_id JOIN services s ON s.id=o.service_id
         ORDER BY o.id DESC LIMIT 100`
      )
      .all(),
  });
});

router.post('/scheduled/:id/cancel', (req, res) => {
  const changed = db
    .prepare(
      "UPDATE scheduled_orders SET status='canceled' WHERE id=? AND status='pending'"
    )
    .run(req.params.id);
  if (!changed.changes)
    return res.status(404).json({ error: 'Agendamento pendente não encontrado.' });
  res.json({ message: 'Agendamento cancelado.' });
});

router.post('/lgpd/requests/:id/status', (req, res) => {
  const columns = db.prepare('PRAGMA table_info(lgpd_requests)').all();
  if (!columns.some((column) => column.name === 'note'))
    db.exec('ALTER TABLE lgpd_requests ADD COLUMN note TEXT');
  const status = req.body?.status;
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : '';
  if (!['completed', 'rejected', 'pending'].includes(status))
    return res.status(400).json({ error: 'Status LGPD inválido.' });
  const changed = db
    .prepare(
      `UPDATE lgpd_requests SET status=?, note=?, completed_at=CASE WHEN ?='pending' THEN NULL ELSE CURRENT_TIMESTAMP END WHERE id=?`
    )
    .run(status, note, status, req.params.id);
  if (!changed.changes)
    return res.status(404).json({ error: 'Pedido LGPD não encontrado.' });
  res.json({ message: 'Pedido LGPD atualizado.' });
});

router.get('/affiliates/summary', (req, res) => {
  const totals = db
    .prepare(
      'SELECT COUNT(*) AS entries, COALESCE(SUM(commission_cents),0) AS commission_cents FROM referral_commissions'
    )
    .get();
  const settings = Object.fromEntries(
    db
      .prepare(
        "SELECT key, value FROM settings WHERE key IN ('affiliate_l1_pct','affiliate_l2_pct','affiliate_l3_pct','affiliate_l4_pct')"
      )
      .all()
      .map((row) => [row.key, row.value])
  );
  res.json({ ...totals, rates: settings });
});

module.exports = router;
