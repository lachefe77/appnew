const { placeOrder, placeBatch, quoteOrder } = require('../order-domain');
const { escapeHtml } = require('../html');
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { dispatchOrder, requestRefill } = require('../smm-engine');

const router = express.Router();
router.use(requireAuth);
router.post('/quote', (req, res) => {
  try {
    const quote = quoteOrder(req.user.id, req.body);
    res.set('Cache-Control', 'no-store').json({charge_cents: quote.charge_cents, discount_cents: quote.discount_cents});
  } catch (err) {
    res.status(err.status || 500).json({error: err.status ? err.message : 'Não foi possível calcular o preço.'});
  }
});

// 1. SINGLE ORDER
router.post('/', async (req, res) => {
  try {
    const result = placeOrder(req.user.id, req.body);
    dispatchOrder(result.id).catch(() => {});
    res.status(201).json({
      message: 'Ordem criada com sucesso!',
      order: {
        id: result.id,
        uuid: result.uuid,
        service_name: result.service.name,
        link: result.link,
        quantity: result.quantity,
        charge_formatted:
          'R$ ' + (result.charge_cents / 100).toFixed(2).replace('.', ','),
        discount_cents: result.discount_cents,
        status: 'pending',
      },
      new_balance_cents: result.new_balance_cents,
      new_balance_formatted:
        'R$ ' + (result.new_balance_cents / 100).toFixed(2).replace('.', ','),
    });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: err.status ? err.message : 'Erro ao criar pedido.' });
  }
});

// 2. MASS ORDERS
router.post('/mass', async (req, res) => {
  try {
    if (typeof req.body.raw_text !== 'string')
      return res.status(400).json({ error: 'Texto de pedidos obrigatório.' });
    const inputs = req.body.raw_text
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((line) => {
        const [service_id, quantity, link] = line
          .split('|')
          .map((x) => x.trim());
        return { service_id, quantity, link };
      });
    const results = placeBatch(req.user.id, inputs);
    for (const r of results) dispatchOrder(r.id).catch(() => {});
    const total = results.reduce((n, r) => n + r.charge_cents, 0);
    res.status(201).json({
      message: results.length + ' ordens criadas.',
      created_count: results.length,
      created_order_ids: results.map((r) => r.id),
      total_charged_cents: total,
      total_charged_formatted: 'R$ ' + (total / 100).toFixed(2),
      new_balance_cents: results.at(-1).new_balance_cents,
    });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ error: err.status ? err.message : 'Erro ao criar lote.' });
  }
});

// 3. LIST USER ORDERS
router.get('/', (req, res) => {
  const { status, search, limit = 50, offset = 0 } = req.query;
  if(!Number.isSafeInteger(Number(limit))||Number(limit)<1||Number(limit)>100||!Number.isSafeInteger(Number(offset))||Number(offset)<0||Number(offset)>100000||(search!=null&&(typeof search!=='string'||search.length>200))||(req.query.cursor!=null&&!/^[1-9]\d{0,14}$/.test(req.query.cursor)))return res.status(400).json({error:'Paginação ou busca inválida.'});
  let query = `
    SELECT o.id, o.uuid, o.link, o.quantity, o.charge_cents, o.start_count, o.remains,
           o.status, o.is_dripfeed, o.dripfeed_runs, o.dripfeed_completed_runs, o.created_at, o.updated_at,
           s.name as service_name, s.platform, s.refill_available, s.cancel_available
    FROM orders o
    JOIN services s ON o.service_id = s.id
    WHERE o.user_id = ?
  `;
  const params = [req.user.id];
  if(req.query.cursor){query+=' AND o.id < ?';params.push(Number(req.query.cursor));}
  if (status && status !== 'all') {
    query += ' AND o.status = ?';
    params.push(status);
  }
  if (search) {
    query += ' AND (o.link LIKE ? OR CAST(o.id AS TEXT) LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY o.id DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit, 10), parseInt(offset, 10));
  const rows=db.prepare(query).all(...params);
  res.json({ orders: rows,next_cursor:rows.length===Number(limit)?String(rows.at(-1).id):null });
});

// 4. ORDER DETAIL (timeline)
router.get('/:id', (req, res) => {
  const order = db
    .prepare(
      `
    SELECT o.*, s.name as service_name, s.platform, s.refill_available, s.cancel_available
    FROM orders o JOIN services s ON o.service_id = s.id
    WHERE o.id = ? AND o.user_id = ?
  `
    )
    .get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
  order.refills = db
    .prepare(
      'SELECT id,status,batch_run,created_at,updated_at FROM order_refills WHERE order_id=? ORDER BY id DESC LIMIT 50'
    )
    .all(order.id);
  if(order.is_dripfeed)order.batches=db.prepare('SELECT run,quantity,remains,status,due_at,completed_at FROM drip_batches WHERE order_id=? ORDER BY run').all(order.id);

  const { delivered, percent, remains } =
    require('../order-progress').progress(order);
  order.remains = remains;
  delete order.cost_cents;
  delete order.profit_cents;
  delete order.provider_id;
  delete order.remote_order_id;
  res.json({ order: { ...order, delivered, percent } });
});

// 5. REFILL
router.post('/:id/refill', async (req, res) => {
  try {
    const order = db
      .prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
    const refillRes = await requestRefill(order.id,req.body?.batch_run);
    return res.json({
      message: 'Solicitação de reposição enviada.',
      details: refillRes,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// 6. REORDER (comprar de novo com um clique)
router.post('/:id/reorder', async (req, res) => {
  try {
    const prev = db
      .prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!prev)
      return res.status(404).json({ error: 'Ordem base não encontrada.' });

    const service = db
      .prepare("SELECT * FROM services WHERE id = ? AND status = 'active'")
      .get(prev.service_id);
    if (!service)
      return res
        .status(400)
        .json({ error: 'Serviço não está mais disponível.' });

    req.body = {
      service_id: prev.service_id,
      link: prev.link,
      quantity: prev.quantity,
    };
    return router.handle(
      Object.assign(req, { method: 'POST', url: '/' }),
      res,
      () => {}
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. RECEIPT HTML (comprovante)
router.get('/:id/receipt', (req, res) => {
  const order = db
    .prepare(
      `
    SELECT o.*, u.name as user_name, u.email as user_email, s.name as service_name, s.platform
    FROM orders o JOIN users u ON o.user_id = u.id JOIN services s ON o.service_id = s.id
    WHERE o.id = ? AND o.user_id = ?
  `
    )
    .get(req.params.id, req.user.id);
  if (!order) return res.status(404).send('Comprovante não encontrado.');

  const chargeBRL = (order.charge_cents / 100).toFixed(2).replace('.', ',');
  const dateStr = new Date(order.created_at).toLocaleString('pt-BR');
  res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Comprovante #${order.id}</title>
    <style>body{font-family:system-ui;padding:40px;max-width:650px;margin:auto;border:1px solid #e5e7eb;border-radius:12px}
    .logo{font-size:22px;font-weight:900}.item{display:flex;justify-content:space-between;margin:12px 0;font-size:14px}
    .total{font-size:18px;font-weight:bold;border-top:2px solid #eee;padding-top:15px;margin-top:20px}</style></head>
    <body onload="window.print()">
    <div class="logo">⚡ SMM HUB BRASIL</div><div>Comprovante Ordem #${order.id}</div><hr>
    <div class="item"><span>Data:</span><span>${dateStr}</span></div>
    <div class="item"><span>Cliente:</span><span>${escapeHtml(order.user_name)} (${escapeHtml(order.user_email)})</span></div>
    <div class="item"><span>Plataforma:</span><span>${escapeHtml(order.platform)}</span></div>
    <div class="item"><span>Serviço:</span><span>${escapeHtml(order.service_name)}</span></div>
    <div class="item"><span>Link:</span><span style="font-family:monospace">${escapeHtml(order.link)}</span></div>
    <div class="item"><span>Quantidade:</span><span>${order.quantity.toLocaleString('pt-BR')}</span></div>
    <div class="item"><span>Status:</span><span>${order.status.toUpperCase()}</span></div>
    <div class="item total"><span>TOTAL:</span><span>R$ ${chargeBRL}</span></div>
    <div style="font-size:11px;color:#6b7280;margin-top:40px;text-align:center">
    Auth: ${order.uuid.substring(0, 16)}</div></body></html>`);
});

module.exports = router;
