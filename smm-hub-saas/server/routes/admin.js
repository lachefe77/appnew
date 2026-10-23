const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { db, calculateTier, creditBalanceAtomic, recalcTier } = require('../db');
const { requireAdmin, requireCEO } = require('../auth');
const {
  refundOrder,
  dispatchOrder,
  fetchCurrentUSDBRL,
} = require('../smm-engine');
const { signToken } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

/* ========= DASHBOARD ========= */
router.get('/metrics', (req, res) => {
  const usersStats = db
    .prepare(
      `SELECT COUNT(*) as total_users, COALESCE(SUM(balance_cents), 0) as total_liabilities_cents FROM users`
    )
    .get();
  const ordersStats = db
    .prepare(
      `
    SELECT COUNT(*) as total_orders,
           COALESCE(SUM(charge_cents), 0) as total_revenue_cents,
           COALESCE(SUM(cost_cents), 0) as total_cost_cents,
           COALESCE(SUM(profit_cents), 0) as total_profit_cents,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
           SUM(CASE WHEN status IN ('in_progress','processing') THEN 1 ELSE 0 END) as active_orders,
           SUM(CASE WHEN status IN ('failed','canceled') THEN 1 ELSE 0 END) as failed_orders
    FROM orders
  `
    )
    .get();
  const depositsStats = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) as total_deposited_cents, COUNT(*) as total_deposits_count FROM pix_invoices WHERE status='paid'`
    )
    .get();
  const affStats = db
    .prepare(
      `SELECT COALESCE(SUM(commission_cents),0) as total_commissions_cents, COUNT(*) as total_commissions_count FROM referral_commissions`
    )
    .get();
  const providers = db
    .prepare(
      'SELECT id, name, balance_upstream, currency, is_mock, status, last_ping_ms, last_checked_at FROM providers'
    )
    .all();
  const usdSet = db
    .prepare("SELECT value FROM settings WHERE key = 'current_usd_brl'")
    .get();
  const finance = require('../financial-report').summarize();
  ordersStats.total_revenue_cents = finance.net_revenue_cents;
  ordersStats.total_profit_cents = finance.estimated_profit_cents;
  depositsStats.total_deposited_cents = finance.deposits_cents;
  depositsStats.total_deposits_count = finance.deposits_count;

  res.json({
    users: {
      total: usersStats.total_users,
      total_balance_cents: usersStats.total_liabilities_cents,
      total_balance_formatted: `R$ ${(usersStats.total_liabilities_cents / 100).toFixed(2).replace('.', ',')}`,
    },
    orders: {
      total: ordersStats.total_orders,
      active: ordersStats.active_orders || 0,
      completed: ordersStats.completed_orders || 0,
      failed: ordersStats.failed_orders || 0,
      total_revenue_formatted: `R$ ${(ordersStats.total_revenue_cents / 100).toFixed(2).replace('.', ',')}`,
      total_profit_formatted: `R$ ${(ordersStats.total_profit_cents / 100).toFixed(2).replace('.', ',')}`,
      margin_pct:
        ordersStats.total_revenue_cents > 0
          ? Math.round(
              (ordersStats.total_profit_cents /
                ordersStats.total_revenue_cents) *
                100
            )
          : 0,
    },
    deposits: {
      total_deposited_formatted: `R$ ${(depositsStats.total_deposited_cents / 100).toFixed(2).replace('.', ',')}`,
      count: depositsStats.total_deposits_count,
    },
    affiliates: {
      total_commissions_formatted: `R$ ${(affStats.total_commissions_cents / 100).toFixed(2).replace('.', ',')}`,
      count: affStats.total_commissions_count,
    },
    exchange_rate_usd: usdSet ? usdSet.value : '5.60',
    providers,
    financial_basis: finance,
  });
});

/* ========= LUCRO POR PLATAFORMA / PROVEDOR ========= */
router.get('/metrics/by-platform', (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT s.platform,
           COUNT(o.id) as orders,
           COALESCE(SUM(o.charge_cents),0) as revenue_cents,
           COALESCE(SUM(o.profit_cents),0) as profit_cents
    FROM orders o JOIN services s ON o.service_id = s.id
    GROUP BY s.platform ORDER BY revenue_cents DESC
  `
    )
    .all();
  res.json({ by_platform: rows });
});

router.get('/metrics/by-provider', (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT p.id, p.name,
           COUNT(o.id) as orders,
           COALESCE(SUM(o.charge_cents),0) as revenue_cents,
           COALESCE(SUM(o.profit_cents),0) as profit_cents,
           SUM(CASE WHEN o.status='failed' THEN 1 ELSE 0 END) as failed_count
    FROM providers p LEFT JOIN orders o ON o.provider_id = p.id
    GROUP BY p.id ORDER BY revenue_cents DESC
  `
    )
    .all();
  res.json({ by_provider: rows });
});

/* ========= EXCHANGE RATE ========= */
router.post('/update-exchange-rate', async (req, res) => {
  const { rate, provider_id } = req.body;
  let newRate = parseFloat(rate);
  if (!Number.isFinite(newRate) || newRate <= 0)
    newRate = await fetchCurrentUSDBRL();
  else {
    db.prepare(
      "UPDATE settings SET value = ? WHERE key = 'current_usd_brl'"
    ).run(String(newRate.toFixed(2)));
    if (provider_id)
      db.prepare('UPDATE providers SET exchange_rate = ? WHERE id = ?').run(
        newRate,
        provider_id
      );
    else db.prepare('UPDATE providers SET exchange_rate = ?').run(newRate);
  }
  res.json({
    message: `Taxa atualizada para R$ ${newRate.toFixed(2)}`,
    rate: newRate,
  });
});

/* ========= SYNC SERVICES ========= */
router.post('/services/sync-upstream', async (req, res) => {
  try {
    const { provider_id, markup_pct } = req.body;
    const prov = db
      .prepare('SELECT * FROM providers WHERE id = ?')
      .get(provider_id);
    if (!prov)
      return res.status(404).json({ error: 'Provedor não encontrado.' });

    const markup = markup_pct==null?200:Number(markup_pct);
    if(!Number.isFinite(markup)||markup<0||markup>10000)return res.status(400).json({error:'Margem deve estar entre 0 e 10000%.'});
    let upstream = [];

    if (prov.is_mock) {
      upstream = [
        {
          service: '901',
          name: '[Mundial] TikTok Curtidas HQ',
          type: 'default',
          category: 'TikTok - Curtidas Globais',
          rate: '0.35',
          min: 100,
          max: 50000,
        },
        {
          service: '902',
          name: '[Global] YouTube Inscritos 100% Reais',
          type: 'default',
          category: 'YouTube - Inscritos',
          rate: '3.20',
          min: 50,
          max: 10000,
        },
        {
          service: '903',
          name: '[BR] X/Twitter Seguidores Verificados',
          type: 'default',
          category: 'X - Seguidores',
          rate: '1.80',
          min: 100,
          max: 20000,
        },
        {
          service: '904',
          name: '[Fast] Telegram Membros Premium',
          type: 'default',
          category: 'Telegram - Membros',
          rate: '0.90',
          min: 100,
          max: 30000,
        },
      ];
    } else {
      const params = new URLSearchParams();
      params.append('key', prov.api_key);
      params.append('action', 'services');
      const r = await require('../provider-client').providerFetch(
        prov.api_url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: AbortSignal.timeout(15000),
        }
      );
      upstream = await r.json();
    }
    if (!Array.isArray(upstream)||upstream.length>10000||upstream.some(item=>!item||!['number','string'].includes(typeof item.service)||String(item.service).length>100||typeof item.name!=='string'||item.name.length<2||item.name.length>300||typeof item.category!=='string'||item.category.length>300||!Number.isFinite(Number(item.rate))||Number(item.rate)<=0||!Number.isSafeInteger(Number(item.min))||Number(item.min)<1||!Number.isSafeInteger(Number(item.max))||Number(item.max)<Number(item.min)||Number(item.max)>1000000000))
      return res.status(400).json({ error: 'Resposta inválida do provedor.' });

    let imported = 0;
    const rate=Number(prov.exchange_rate);
    if(!Number.isFinite(rate)||rate<=0)throw Error('Cotação do fornecedor inválida.');
    require('../db').tx(()=>{
    for (const item of upstream) {
      let cat = db
        .prepare('SELECT id FROM categories WHERE name = ?')
        .get(item.category);
      if (!cat) {
        const r = db
          .prepare(
            'INSERT INTO categories (name, icon, platform, sort_order) VALUES (?,?,?,?)'
          )
          .run(item.category, 'layer-group', 'general', 10);
        cat = { id: r.lastInsertRowid };
      }
      const costUSD = Number(item.rate);
      const costCents = Math.round(costUSD * rate * 100);
      const priceCents = Math.max(50,Math.round(costCents * (1 + markup / 100)));
      const cashback=Number(db.prepare("SELECT value FROM settings WHERE key='cashback_pct'").get()?.value??3);
      if(!Number.isSafeInteger(costCents)||!Number.isSafeInteger(priceCents)||priceCents>1000000000||costCents+Math.round(priceCents*cashback/100)>priceCents)throw Error('A margem configurada não cobre os custos e benefícios.');

      const existing = db
        .prepare(
          'SELECT id FROM services WHERE provider_id = ? AND provider_service_id = ?'
        )
        .get(prov.id, String(item.service));
      if (existing) {
        db.prepare(
          `UPDATE services SET name=?, cost_per_k_cents=?, price_per_k_cents=?, min_quantity=?, max_quantity=? WHERE id=?`
        ).run(
          item.name,
          costCents,
          priceCents,
          parseInt(item.min, 10) || 10,
          parseInt(item.max, 10) || 10000,
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO services (category_id, name, platform, type, provider_id, provider_service_id, cost_per_k_cents, price_per_k_cents, min_quantity, max_quantity, refill_available, cancel_available)
          VALUES (?,?,'general',?,?,?,?,?,?,?,1,0)`
        ).run(
          cat.id,
          item.name,
          String(item.type||'default').toLowerCase().replace(/\s+/g,'_'),
          prov.id,
          String(item.service),
          costCents,
          priceCents,
          parseInt(item.min, 10) || 10,
          parseInt(item.max, 10) || 10000
        );
        imported++;
      }
    }
    });
    res.json({
      message: `Sincronização OK. ${upstream.length} processados / ${imported} novos.`,
      total_processed: upstream.length,
      new_imported: imported,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========= USERS ========= */
router.get('/users', (req, res) => {
  const { search } = req.query;
  let q = `SELECT id, uuid, name, email, balance_cents, total_deposited_cents, role, tier, ref_code, status, created_at,
           (SELECT COUNT(*) FROM orders WHERE user_id = users.id) as orders_count FROM users`;
  const params = [];
  if (search) {
    q += ' WHERE name LIKE ? OR email LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  q += ' ORDER BY id DESC LIMIT 500';
  res.json({ users: db.prepare(q).all(...params) });
});

router.post('/users/:id/adjust-balance', requireCEO, (req, res) => {
  const delta = Math.round(Number(req.body.amount_brl) * 100),
    reason = req.body.reason;
  if (
    !Number.isSafeInteger(delta) ||
    delta === 0 ||
    Math.abs(delta) > 100000000 ||
    typeof reason !== 'string' ||
    reason.trim().length < 5
  )
    return res.status(400).json({
      error:
        'Valor inteiro e motivo de pelo menos cinco caracteres são obrigatórios.',
    });
  try {
    const result = require('../db').tx(() => {
      const balance =
        delta > 0
          ? require('../db').creditBalanceAtomic(Number(req.params.id), delta)
          : require('../db').debitBalanceAtomic(Number(req.params.id), -delta);
      if (balance === null) throw new Error('Saldo ou conta inválida.');
      db.prepare(
        "INSERT INTO transactions(user_id,type,amount_cents,balance_after_cents,description) VALUES(?,'admin_adjustment',?,?,?)"
      ).run(req.params.id, delta, balance, reason.trim());
      db.prepare(
        "INSERT INTO system_audit_logs(admin_id,action,target,ip,details) VALUES(?,'adjust_balance',?,?,?)"
      ).run(
        req.user.id,
        'user:' + req.params.id,
        req.ip,
        JSON.stringify({ delta, reason })
      );
      return balance;
    });
    res.json({ message: 'Saldo ajustado.', new_balance_cents: result });
  } catch {
    res.status(400).json({ error: 'Não foi possível ajustar o saldo.' });
  }
});

router.post('/users/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status))
    return res.status(400).json({ error: 'Status inválido.' });
  const target = db
    .prepare('SELECT role FROM users WHERE id = ?')
    .get(req.params.id);
  if (!target)
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (
    target.role === 'ceo' ||
    (target.role === 'admin' && req.user.role !== 'ceo')
  )
    return res.status(403).json({
      error: 'Use o gerenciamento de equipe com a permissão adequada.',
    });
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(
    status,
    req.params.id
  );
  db.prepare(
    `INSERT INTO system_audit_logs (admin_id, action, target, ip, details)
    VALUES (?, 'user_status', ?, ?, ?)`
  ).run(req.user.id, `user:${req.params.id}`, req.ip, status);
  res.json({ message: 'Status alterado.' });
});

router.post('/users/:id/impersonate', (req, res) => {
  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (!['user', 'vip'].includes(user.role) || user.status !== 'active')
    return res.status(403).json({
      error: 'Somente consulta delegada de clientes ativos é permitida.',
    });
  const actor = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (
    typeof req.body.password !== 'string' ||
    !require('../db').verifyPassword(
      req.body.password,
      actor.password_hash,
      actor.salt
    )
  )
    return res.status(401).json({ error: 'Confirme sua senha atual.' });
  const token = signToken(user, { actor });
  db.prepare(
    `INSERT INTO system_audit_logs (admin_id, action, target, ip, details)
    VALUES (?, 'impersonate', ?, ?, ?)`
  ).run(
    req.user.id,
    `user:${user.id}`,
    req.ip,
    `admin ${req.user.email} entrou como ${user.email}`
  );
  res.json({ message: 'Token de impersonação gerado.', token });
});

/* ========= PROVIDERS ========= */
router.get('/providers', (req, res) => {
  res.json({
    providers: db
      .prepare(
        'SELECT id,name,api_url,currency,exchange_rate,balance_upstream,is_mock,status,last_ping_ms,last_checked_at FROM providers ORDER BY id ASC'
      )
      .all(),
  });
});

router.post('/providers', async (req, res) => {
  const { name, api_url, api_key, currency, exchange_rate, is_mock } = req.body;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 150 ||
    typeof api_url !== 'string' ||
    api_url.length > 2048 ||
    typeof api_key !== 'string' ||
    !api_key.trim() ||
    api_key.length > 2048 ||
    is_mock
  )
    return res.status(400).json({
      error:
        'Nome, URL HTTPS pública e chave são obrigatórios; use provedores reais.',
    });
  let stored;
  try {
    await require('../webhook-http').resolveWebhook(api_url);
    stored = require('../provider-client').sealKey(api_key.trim());
  } catch {
    return res.status(400).json({
      error:
        'Destino inválido ou chave de criptografia do servidor não configurada.',
    });
  }
  if (currency && !['USD', 'BRL', 'EUR'].includes(currency))
    return res.status(400).json({ error: 'Moeda inválida.' });
  if (
    exchange_rate != null &&
    (!Number.isFinite(Number(exchange_rate)) ||
      Number(exchange_rate) <= 0 ||
      Number(exchange_rate) > 1000)
  )
    return res.status(400).json({ error: 'Câmbio inválido.' });
  const r = db
    .prepare(
      `INSERT INTO providers (name, api_url, api_key, currency, exchange_rate, is_mock, balance_upstream)
    VALUES (?,?,?,?,?,?,0)`
    )
    .run(
      name.trim(),
      api_url.trim(),
      stored,
      currency || 'USD',
      parseFloat(exchange_rate) || 5.6,
      is_mock ? 1 : 0
    );
  res
    .status(201)
    .json({ message: 'Provedor cadastrado!', provider_id: r.lastInsertRowid });
});

router.post('/providers/:id/test-balance', async (req, res) => {
  try {
    const prov = db
      .prepare('SELECT * FROM providers WHERE id = ?')
      .get(req.params.id);
    if (!prov)
      return res.status(404).json({ error: 'Provedor não encontrado.' });
    if (prov.is_mock) {
      require('../ops-desk').logProviderBalance(
        prov.id,
        prov.balance_upstream,
        prov.currency,
        1,
        'mock'
      );
      return res.json({
        message: 'Modo mock. Conexão OK.',
        balance: prov.balance_upstream,
        currency: prov.currency,
      });
    }

    const params = new URLSearchParams();
    params.append('key', prov.api_key);
    params.append('action', 'balance');
    const t0 = Date.now();
    const r = await require('../provider-client').providerFetch(prov.api_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });
    const latency = Date.now() - t0;
    const data = await r.json();
    if (data.error)
      return res.status(400).json({ error: data.error, latency_ms: latency });

    const balance = parseFloat(data.balance) || 0;
    const currency = data.currency || prov.currency || 'USD';
    db.prepare(
      'UPDATE providers SET balance_upstream=?, currency=?, last_ping_ms=?, last_checked_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(balance, currency, latency, prov.id);
    require('../ops-desk').logProviderBalance(prov.id, balance, currency, 1, null);
    res.json({
      message: 'Conexão OK.',
      balance,
      currency,
      latency_ms: latency,
    });
  } catch (err) {
    res.status(500).json({ error: `Falha de conexão: ${err.message}` });
  }
});

router.post('/providers/:id/update-key', async (req, res) => {
  const { api_key, api_url } = req.body;
  if (
    typeof api_key !== 'string' ||
    !api_key.trim() ||
    api_key.length > 2048 ||
    (api_url != null && typeof api_url !== 'string')
  )
    return res.status(400).json({ error: 'Chave ou URL inválida.' });
  const prov = db
    .prepare('SELECT id, name,api_url FROM providers WHERE id = ?')
    .get(req.params.id);
  if (!prov) return res.status(404).json({ error: 'Provedor não encontrado.' });
  let stored;
  try {
    await require('../webhook-http').resolveWebhook(
      api_url?.trim() || prov.api_url
    );
    stored = require('../provider-client').sealKey(api_key.trim());
  } catch {
    return res.status(400).json({
      error:
        'Destino inválido ou chave de criptografia do servidor não configurada.',
    });
  }
  if (api_url && api_url.trim()) {
    db.prepare(
      'UPDATE providers SET api_key=?, api_url=?, is_mock=0 WHERE id=?'
    ).run(stored, api_url.trim(), req.params.id);
  } else {
    db.prepare('UPDATE providers SET api_key=?, is_mock=0 WHERE id=?').run(
      stored,
      req.params.id
    );
  }
  res.json({ message: `Chave do provedor "${prov.name}" atualizada.` });
});

router.delete('/providers/:id', (req, res) => {
  const prov = db
    .prepare('SELECT id FROM providers WHERE id = ?')
    .get(req.params.id);
  if (!prov) return res.status(404).json({ error: 'Provedor não encontrado.' });
  const n = db
    .prepare('SELECT COUNT(*) as c FROM services WHERE provider_id = ?')
    .get(req.params.id).c;
  if (n > 0) {
    db.prepare("UPDATE providers SET status = 'inactive' WHERE id = ?").run(
      req.params.id
    );
    return res.json({
      message: `Provedor desativado (${n} serviços vinculados).`,
    });
  }
  db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id);
  res.json({ message: 'Provedor removido.' });
});

/* ========= SERVICES ========= */
router.get('/services', (req, res) => {
  const services = db
    .prepare(
      `
    SELECT s.*, c.name as category_name, p.name as provider_name, bp.name as backup_provider_name
    FROM services s JOIN categories c ON s.category_id = c.id
    LEFT JOIN providers p ON s.provider_id = p.id
    LEFT JOIN providers bp ON s.backup_provider_id = bp.id
    ORDER BY s.id ASC
  `
    )
    .all();
  res.json({ services });
});

router.put('/services/:id', (req, res) => {
  const {
    name,
    cost_per_k_cents,
    price_per_k_cents,
    min_quantity,
    max_quantity,
    refill_available,
    backup_provider_id,
    backup_service_id,
    status,
    description,
  } = req.body;
  const values = [
    cost_per_k_cents,
    price_per_k_cents,
    min_quantity,
    max_quantity,
  ].map(Number);
  const cashback=Number(db.prepare("SELECT value FROM settings WHERE key='cashback_pct'").get()?.value??3);
  if (
    typeof name !== 'string' ||
    name.trim().length < 2 ||
    name.length>300 ||
    (description!=null&&(typeof description!=='string'||description.length>6000)) ||
    ![true,false,0,1].includes(refill_available) ||
    !values.every(Number.isSafeInteger) ||
    values[0] < 0 ||
    values[1] <= 0 ||
    values[1] < values[0] ||
    values[1]>1000000000 || values[0]+Math.round(values[1]*cashback/100)>values[1] ||
    values[2] < 1 ||
    values[3] < values[2] ||
    values[3]>1000000000 ||
    !['active', 'inactive'].includes(status)
  )
    return res
      .status(400)
      .json({ error: 'Nome, preço, custo, limites ou status inválido.' });
  if(!db.prepare('SELECT id FROM services WHERE id=?').get(req.params.id))return res.status(404).json({error:'Serviço não encontrado.'});
  if(backup_provider_id!=null&&backup_provider_id!==''){
    if(!Number.isSafeInteger(Number(backup_provider_id))||!db.prepare("SELECT id FROM providers WHERE id=? AND status='active'").get(Number(backup_provider_id))||typeof backup_service_id!=='string'||!backup_service_id.trim()||backup_service_id.length>100)return res.status(400).json({error:'Fornecedor e identificador de serviço de backup inválidos.'});
  }
  db.prepare(
    `UPDATE services SET name=?, cost_per_k_cents=?, price_per_k_cents=?, min_quantity=?, max_quantity=?,
    refill_available=?, backup_provider_id=?, backup_service_id=?, status=?, description=? WHERE id=?`
  ).run(
    name,
    parseInt(cost_per_k_cents, 10),
    parseInt(price_per_k_cents, 10),
    parseInt(min_quantity, 10),
    parseInt(max_quantity, 10),
    refill_available ? 1 : 0,
    backup_provider_id || null,
    backup_service_id || null,
    status,
    description||'',
    req.params.id
  );
  res.json({ message: 'Serviço atualizado.' });
});

router.post('/services/bulk-markup', (req, res) => {
  const { markup_pct, provider_id, platform } = req.body;
  const pct = parseFloat(markup_pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct>10000)
    return res.status(400).json({ error: 'Margem inválida.' });
  try {
    require('../ops-desk').snapshotMarkup(provider_id, platform);
  } catch {}

  let q = `UPDATE services SET price_per_k_cents = CAST(cost_per_k_cents * (1.0 + (? / 100.0)) AS INTEGER) WHERE status='active'`;
  const params = [pct];
  if (provider_id) {
    q += ' AND provider_id = ?';
    params.push(provider_id);
  }
  if (platform) {
    q += ' AND platform = ?';
    params.push(platform);
  }
  const r = db.prepare(q).run(...params);
  res.json({
    message: `Preços recalculados com margem ${pct}%. ${r.changes} serviços afetados.`,
  });
});

/* ========= ORDERS ========= */
router.get('/orders', (req, res) => {
  const { status, limit = 100 } = req.query;
  let q = `SELECT o.id, o.uuid, o.remote_order_id, o.link, o.quantity, o.charge_cents, o.cost_cents, o.profit_cents,
    o.start_count, o.remains, o.status, o.failover_count, o.is_dripfeed, o.created_at,
    u.name as user_name, u.email as user_email, s.name as service_name, s.platform, p.name as provider_name
    FROM orders o JOIN users u ON o.user_id = u.id JOIN services s ON o.service_id = s.id
    LEFT JOIN providers p ON o.provider_id = p.id`;
  const params = [];
  if (status) {
    q += ' WHERE o.status = ?';
    params.push(status);
  }
  q += ' ORDER BY o.id DESC LIMIT ?';
  params.push(parseInt(limit, 10));
  res.json({ orders: db.prepare(q).all(...params) });
});

router.post('/orders/:id/force-refund', (req, res) => {
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
  if (order.status === 'canceled')
    return res.status(400).json({ error: 'Ordem já cancelada.' });
  refundOrder(order.id, false);
  db.prepare(
    `UPDATE orders SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(order.id);
  res.json({ message: 'Ordem cancelada e estornada.' });
});

router.post('/orders/:id/retry', async (req, res) => {
  try {
    const order = db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
    const refunded = db
      .prepare(
        "SELECT 1 FROM transactions WHERE type='order_refund' AND reference_id=?"
      )
      .get(order.uuid);
    if (refunded || order.remote_order_id || order.status !== 'failed')
      return res.status(409).json({
        error:
          'Somente falha sem entrega aceita e sem estorno permite nova tentativa.',
      });
    db.prepare(
      `UPDATE orders SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(order.id);
    const result = await dispatchOrder(order.id);
    require('../ops-desk').logRetry(order.id, req.user.id, 'redispatched', '');
    res.json({ message: 'Ordem redespachada.', result });
  } catch (err) {
    try {
      require('../ops-desk').logRetry(req.params.id, req.user.id, 'failed', err.message);
    } catch {}
    res.status(400).json({ error: err.message });
  }
});

/* ========= AFFILIATES ========= */
router.get('/affiliates', (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT rc.id, rc.level, rc.deposit_amount_cents, rc.commission_cents, rc.created_at,
           ref.name as referrer_name, ref.email as referrer_email,
           buyer.name as buyer_name, buyer.email as buyer_email
    FROM referral_commissions rc
    JOIN users ref ON rc.referrer_id = ref.id JOIN users buyer ON rc.referred_id = buyer.id
    ORDER BY rc.id DESC LIMIT 100
  `
    )
    .all();
  res.json({ affiliates: rows });
});

/* ========= TICKETS (ADMIN) ========= */
router.get('/tickets', (req, res) => {
  const { status } = req.query;
  let q = `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
    u.name as user_name, u.email as user_email,
    (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as msg_count
    FROM tickets t JOIN users u ON t.user_id = u.id`;
  const params = [];
  if (status) {
    q += ' WHERE t.status = ?';
    params.push(status);
  }
  q += ' ORDER BY t.updated_at DESC LIMIT 200';
  res.json({ tickets: db.prepare(q).all(...params) });
});

router.get('/tickets/:id', (req, res) => {
  const ticket = db
    .prepare(
      `SELECT t.*, u.name as user_name, u.email as user_email
    FROM tickets t JOIN users u ON t.user_id = u.id WHERE t.id = ?`
    )
    .get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
  const messages = db
    .prepare(
      `SELECT m.*, u.name as sender_name FROM ticket_messages m
    JOIN users u ON m.user_id = u.id WHERE m.ticket_id = ? ORDER BY m.id ASC`
    )
    .all(ticket.id);
  res.json({ ticket, messages });
});

router.post('/tickets/:id/reply', (req, res) => {
  const { message, close, attachments } = req.body;
  if (typeof message !== 'string' || !message.trim() || message.length > 10000)
    return res.status(400).json({ error: 'Mensagem vazia.' });
  const ticket = db
    .prepare(
      'SELECT t.id, t.subject, u.name as user_name, u.email as user_email FROM tickets t JOIN users u ON t.user_id = u.id WHERE t.id = ?'
    )
    .get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });

  try {
    require('../db').tx(() => {
      const ins = db
        .prepare(
          `INSERT INTO ticket_messages (ticket_id, user_id, is_staff, message) VALUES (?,?,1,?)`
        )
        .run(ticket.id, req.user.id, message.trim());

      require('../ticket-attachments').attachToMessage(
        ins.lastInsertRowid,
        attachments
      );

      db.prepare(
        `UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(close ? 'closed' : 'answered', ticket.id);
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Não foi possível responder.',
    });
  }

  // E-mail de notificação
  const { sendMail } = require('../mail');
  sendMail(ticket.user_email, 'ticket_reply', {
    name: ticket.user_name,
    ticketId: ticket.id,
  }).catch(() => {}); // template genérico; aceitar template novo depois
  res.json({ message: 'Resposta enviada.' });
});

/* ========= COUPONS CRUD ========= */
router.get('/coupons', (req, res) => {
  res.json({
    coupons: db.prepare('SELECT * FROM coupons ORDER BY id DESC').all(),
  });
});

router.post('/coupons', (req, res) => {
  const {
    code,
    discount_pct,
    fixed_cents,
    min_order_cents,
    max_uses,
    expires_at,
  } = req.body;
  if (!code) return res.status(400).json({ error: 'Código obrigatório.' });
  try {
    const r = db
      .prepare(
        `INSERT INTO coupons (code, discount_pct, fixed_cents, min_order_cents, max_uses, expires_at)
      VALUES (?,?,?,?,?,?)`
      )
      .run(
        code.trim().toUpperCase(),
        parseInt(discount_pct, 10) || 0,
        parseInt(fixed_cents, 10) || 0,
        parseInt(min_order_cents, 10) || 0,
        parseInt(max_uses, 10) || 1000,
        expires_at || null
      );
    res
      .status(201)
      .json({ message: 'Cupom criado!', coupon_id: r.lastInsertRowid });
  } catch (err) {
    res.status(400).json({
      error: err.message.includes('UNIQUE') ? 'Código já existe.' : err.message,
    });
  }
});

router.put('/coupons/:id', (req, res) => {
  const {
    discount_pct,
    fixed_cents,
    min_order_cents,
    max_uses,
    status,
    expires_at,
  } = req.body;
  db.prepare(
    `UPDATE coupons SET discount_pct=?, fixed_cents=?, min_order_cents=?, max_uses=?, status=?, expires_at=? WHERE id=?`
  ).run(
    parseInt(discount_pct, 10) || 0,
    parseInt(fixed_cents, 10) || 0,
    parseInt(min_order_cents, 10) || 0,
    parseInt(max_uses, 10) || 1000,
    status || 'active',
    expires_at || null,
    req.params.id
  );
  res.json({ message: 'Cupom atualizado.' });
});

router.delete('/coupons/:id', (req, res) => {
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  res.json({ message: 'Cupom removido.' });
});

/* ========= ANNOUNCEMENTS CRUD ========= */
router.get('/announcements', (req, res) => {
  res.json({
    announcements: db
      .prepare('SELECT * FROM announcements ORDER BY id DESC')
      .all(),
  });
});

router.post('/announcements', (req, res) => {
  const { title, message, badge, is_active } = req.body;
  if (!title || !message)
    return res.status(400).json({ error: 'Título e mensagem obrigatórios.' });
  const r = db
    .prepare(
      `INSERT INTO announcements (title, message, badge, is_active) VALUES (?,?,?,?)`
    )
    .run(title.trim(), message.trim(), badge || 'NOVIDADE', is_active ? 1 : 0);
  res.status(201).json({ message: 'Anúncio criado.', id: r.lastInsertRowid });
});

router.put('/announcements/:id', (req, res) => {
  const { title, message, badge, is_active } = req.body;
  db.prepare(
    `UPDATE announcements SET title=?, message=?, badge=?, is_active=? WHERE id=?`
  ).run(title, message, badge, is_active ? 1 : 0, req.params.id);
  res.json({ message: 'Anúncio atualizado.' });
});

router.delete('/announcements/:id', (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ message: 'Anúncio removido.' });
});

/* ========= SETTINGS ========= */
router.get('/settings', (req, res) => {
  const rows = db
    .prepare(
      "SELECT key, value FROM settings WHERE key NOT LIKE 'integration:%'"
    )
    .all()
    .filter((row) =>
      Object.hasOwn(require('../settings-policy').limits, row.key)
    );
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json({ settings: obj });
});

router.put('/settings', requireCEO, (req, res) => {
  let updates;
  try {
    updates = require('../settings-policy').validateSettings(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  if (Object.keys(updates).some((k) => k.startsWith('integration:')))
    return res
      .status(403)
      .json({ error: 'Use a configuração de integrações do CEO.' });
  require('../db').tx(() => {
    for (const [k, v] of Object.entries(updates)) upsert.run(k, v);
    db.prepare(
      "INSERT INTO system_audit_logs(admin_id,action,target,ip,details) VALUES(?,'settings_update','system',?,?)"
    ).run(req.user.id, req.ip, JSON.stringify(updates));
  });
  res.json({ message: 'Settings atualizados.' });
});

/* ========= BACKUP SEGURO VIA VACUUM INTO ========= */
router.get('/backup-db', requireCEO, (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `smmhub-backup-${Date.now()}.sqlite`);
  try {
    db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
    res.download(
      tmpPath,
      `smmhub-backup-${new Date().toISOString().split('T')[0]}.sqlite`,
      (err) => {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
    );
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    res.status(500).json({ error: 'Falha no backup: ' + err.message });
  }
});

/* ========= AUDIT ========= */
router.get('/audit-logs', (req, res) => {
  const logs = db
    .prepare(
      `SELECT l.*, u.name as admin_name FROM system_audit_logs l
    LEFT JOIN users u ON l.admin_id = u.id ORDER BY l.id DESC LIMIT 200`
    )
    .all();
  res.json({ logs });
});

module.exports = router;
