const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, tx, creditBalanceAtomic } = require('../db');
const { requireAdmin, requireCEO } = require('../auth');
const config = require('../config');
const ops = require('../ops-desk');

const router = express.Router();
router.use(requireAdmin);

const switchRules = {
  duplicate_guard: [0, 1, true],
  maintenance_mode: [0, 1, true],
  training_deposits: [0, 1, true],
  new_account_hours: [0, 8760, true],
  new_account_spend_cap_cents: [0, 100000000, true],
  provider_balance_floor: [0, 100000000, false],
  api_key_grace_hours: [1, 72, true],
};
const ceoSwitches = new Set([
  'maintenance_mode',
  'training_deposits',
  'new_account_spend_cap_cents',
  'api_key_grace_hours',
]);
const draftMethods = ['boleto', 'credit_card', 'pix', 'bitcoin', 'usdt'];
const checklistItems = [
  'dns',
  'tls',
  'firewall',
  'offsite_copy',
  'provider_reviewed',
  'clock_ntp',
];

function fail(res, error) {
  const status = error.status || 500;
  res
    .status(status)
    .json({ error: status < 500 ? error.message : 'Não foi possível concluir.' });
}

function audit(req, action, target, details) {
  db.prepare(
    'INSERT INTO system_audit_logs(admin_id, action, target, ip, details) VALUES(?,?,?,?,?)'
  ).run(req.user.id, action, target, req.ip, JSON.stringify(details || {}));
}

function integer(value, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    return null;
  return number;
}

function csv(res, filename, rows) {
  const keys = rows.length ? Object.keys(rows[0]) : ['vazio'];
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const body = [keys.join(',')]
    .concat(rows.map((row) => keys.map((key) => cell(row[key])).join(',')))
    .join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send('\uFEFF' + body);
}

function configured(value) {
  return { configured: !!value, charging: false };
}

router.get('/ops/readiness', (req, res) => {
  ops.applySchema();
  const drafts = Object.fromEntries(
    db
      .prepare('SELECT method, provider, secret_cipher FROM gateway_drafts')
      .all()
      .map((row) => [
        row.method,
        {
          provider: row.provider,
          secret_stored: !!row.secret_cipher,
          charging: false,
        },
      ])
  );
  const providers = db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN is_mock=0 THEN 1 ELSE 0 END) AS real FROM providers"
    )
    .get();
  res.json({
    charging_enabled: false,
    storefront_unchanged: true,
    encryption_key: /^[0-9a-f]{64}$/i.test(
      process.env.SETTINGS_ENCRYPTION_KEY || ''
    ),
    public_url: config.publicUrl.startsWith('https://'),
    smtp: !!(config.smtp.enabled && config.smtp.host),
    captcha: config.captcha?.provider || 'off',
    pix_provider: config.pix.provider,
    crypto_provider: config.crypto.provider,
    drafts,
    providers,
    switches: Object.fromEntries(
      Object.keys(switchRules).map((key) => [key, ops.ops(key, key === 'api_key_grace_hours' ? '24' : '0')])
    ),
    note: 'Rascunhos de boleto, cartão, Pix e cripto não são lidos pelos gateways. A vitrine permanece como está.',
  });
});

router.get('/ops/switches', (req, res) => {
  ops.applySchema();
  res.json({
    switches: Object.fromEntries(
      Object.keys(switchRules).map((key) => [key, ops.ops(key)])
    ),
  });
});

router.put('/ops/switches', (req, res) => {
  const updates = req.body || {};
  const next = {};
  for (const [key, value] of Object.entries(updates)) {
    const rule = switchRules[key];
    const number = Number(value);
    if (!rule || !Number.isFinite(number) || number < rule[0] || number > rule[1])
      return res.status(400).json({ error: 'Configuração inválida: ' + key });
    if (rule[2] && !Number.isInteger(number))
      return res.status(400).json({ error: 'Configuração inválida: ' + key });
    if (ceoSwitches.has(key) && req.user.role !== 'ceo')
      return res.status(403).json({ error: 'Essa chave fica com o CEO.' });
    next[key] = String(number);
  }
  if (!Object.keys(next).length)
    return res.status(400).json({ error: 'Nada para salvar.' });
  ops.applySchema();
  for (const [key, value] of Object.entries(next)) ops.setOps(key, value);
  audit(req, 'ops_switches', 'ops', next);
  res.json({ message: 'Preparação atualizada.', switches: next });
});

router.post('/ops/freeze', requireCEO, (req, res) => {
  const value = Number(req.body?.freeze_mode);
  if (value !== 0 && value !== 1)
    return res.status(400).json({ error: 'Use 0 ou 1.' });
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run('freeze_mode', String(value));
  audit(req, 'freeze_mode', 'settings', { freeze_mode: value });
  res.json({
    message: value ? 'Compras novas travadas.' : 'Compras novas liberadas.',
  });
});

router.put('/ops/gateway-drafts/:method', requireCEO, (req, res) => {
  const method = req.params.method;
  if (!draftMethods.includes(method))
    return res.status(400).json({ error: 'Método ainda não preparado.' });
  const provider = String(req.body?.provider || '').trim().slice(0, 80);
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const secret = req.body?.secret;
  if (secret != null && (typeof secret !== 'string' || secret.length > 4096))
    return res.status(400).json({ error: 'Segredo inválido.' });
  let cipher = null;
  if (secret) {
    try {
      cipher = require('../runtime-config').encrypt(secret);
    } catch {
      return res.status(503).json({
        error:
          'Defina SETTINGS_ENCRYPTION_KEY no servidor antes de guardar a chave.',
      });
    }
  }
  ops.applySchema();
  db.prepare(
    `INSERT INTO gateway_drafts(method, provider, note, secret_cipher, updated_at)
     VALUES(?,?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(method) DO UPDATE SET provider=excluded.provider, note=excluded.note,
       secret_cipher=COALESCE(excluded.secret_cipher, gateway_drafts.secret_cipher),
       updated_at=CURRENT_TIMESTAMP`
  ).run(method, provider, note, cipher);
  audit(req, 'gateway_draft', method, { provider, secret_stored: !!cipher });
  res.json({
    message:
      'Rascunho guardado. A cobrança real continua desligada e a vitrine não muda.',
    charging: false,
  });
});

router.get('/ops/gateway-drafts', requireCEO, (req, res) => {
  ops.applySchema();
  res.json({
    drafts: db
      .prepare(
        'SELECT method, provider, note, secret_cipher IS NOT NULL AS secret_stored, updated_at FROM gateway_drafts'
      )
      .all(),
    charging: false,
  });
});

router.post('/ops/smtp-test', requireCEO, async (req, res) => {
  const mail = require('../mail');
  try {
    const result = await mail.sendMailNow(req.user.email, 'welcome', {
      name: req.user.name,
    });
    if (result.skipped)
      return res.status(503).json({
        error: 'SMTP desligado. Configure o servidor e tente de novo.',
      });
    audit(req, 'smtp_test', 'mail', {});
    res.json({ message: 'E-mail de teste enviado para ' + req.user.email + '.' });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/ops/webhooks', (req, res) => {
  ops.applySchema();
  res.json({
    webhooks: db
      .prepare(
        'SELECT id, source, external_id, status, created_at FROM webhook_inbox ORDER BY id DESC LIMIT 100'
      )
      .all(),
  });
});

router.post('/ops/webhooks/:id/retry', (req, res) => {
  ops.applySchema();
  const id = integer(req.params.id, 1, 1e15);
  if (!id) return res.status(400).json({ error: 'Evento inválido.' });
  const changed = db
    .prepare(
      "UPDATE webhook_inbox SET status='retry_queued' WHERE id=? AND status!='retry_queued'"
    )
    .run(id).changes;
  if (!changed) return res.status(404).json({ error: 'Evento não encontrado.' });
  audit(req, 'webhook_retry_queued', String(id), {});
  res.json({
    message:
      'Evento marcado para revisão. Nenhum gateway é chamado por esta fila.',
  });
});

router.get('/ops/pix', (req, res) => {
  res.json({
    invoices: db
      .prepare(
        `SELECT i.id, i.txid, i.provider, i.amount_cents, i.status, i.created_at, i.paid_at, u.email
         FROM pix_invoices i JOIN users u ON u.id=i.user_id ORDER BY i.id DESC LIMIT 100`
      )
      .all(),
  });
});

router.get('/ops/crypto', (req, res) => {
  res.json({
    invoices: db
      .prepare(
        `SELECT i.id, i.txid, i.currency, i.amount_brl_cents, i.status, i.created_at, i.paid_at, u.email
         FROM crypto_invoices i JOIN users u ON u.id=i.user_id ORDER BY i.id DESC LIMIT 100`
      )
      .all(),
  });
});

router.post('/ops/training-deposit', requireCEO, (req, res) => {
  if (ops.ops('training_deposits') !== '1')
    return res.status(409).json({
      error: 'Depósito de ensaio está desligado. Ligue a chave antes.',
    });
  const userId = integer(req.body?.user_id, 1, 1e15);
  const amount = integer(req.body?.amount_cents, 100, 10000);
  if (!userId || !amount)
    return res.status(400).json({ error: 'Conta ou valor inválido.' });
  const account = db
    .prepare("SELECT id, email, status FROM users WHERE id=? AND deleted_at IS NULL")
    .get(userId);
  if (!account || !account.email.endsWith('@treino.invalid'))
    return res.status(400).json({
      error: 'Só uma conta @treino.invalid recebe depósito de ensaio.',
    });
  if (account.status !== 'active')
    return res.status(409).json({ error: 'Conta indisponível.' });
  try {
    const balance = tx(() => {
      const credited = creditBalanceAtomic(account.id, amount);
      if (credited === null)
        throw Object.assign(new Error('Não foi possível creditar.'), {
          status: 409,
        });
      db.prepare(
        "INSERT INTO transactions(user_id, type, amount_cents, balance_after_cents, description) VALUES(?,'training_deposit',?,?,?)"
      ).run(
        account.id,
        amount,
        credited,
        'Depósito de ensaio, sem liquidação bancária.'
      );
      return credited;
    });
    audit(req, 'training_deposit', String(account.id), { amount });
    res.json({ message: 'Ensaio creditado.', balance_cents: balance });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/orders/lookup', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2 || q.length > 200)
    return res.status(400).json({ error: 'Busca inválida.' });
  const literal = q.replace(/[\\%_]/g, '');
  const like = '%' + literal + '%';
  const orders = db
    .prepare(
      `SELECT o.id, o.uuid, o.remote_order_id, o.link, o.quantity, o.charge_cents, o.status, o.created_at,
              u.email AS user_email, s.name AS service_name
       FROM orders o JOIN users u ON u.id=o.user_id JOIN services s ON s.id=o.service_id
       WHERE o.link LIKE ? OR u.email LIKE ? OR IFNULL(o.remote_order_id,'') LIKE ? OR CAST(o.id AS TEXT)=?
       ORDER BY o.id DESC LIMIT 100`
    )
    .all(like, like, like, literal);
  res.json({ orders });
});

router.get('/orders/export.csv', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.id, o.uuid, o.remote_order_id, o.status, o.quantity, o.charge_cents, o.cost_cents, o.profit_cents, o.created_at, u.email
       FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 5000`
    )
    .all();
  csv(res, 'pedidos.csv', rows);
});

router.get('/orders/:id/desk', (req, res) => {
  ops.applySchema();
  const id = integer(req.params.id, 1, 1e15);
  const order = id && db.prepare('SELECT id FROM orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: 'Ordem não encontrada.' });
  res.json({
    notes: db
      .prepare(
        `SELECT n.id, n.note, n.created_at, u.email AS author
         FROM order_staff_notes n LEFT JOIN users u ON u.id=n.admin_id
         WHERE n.order_id=? ORDER BY n.id DESC LIMIT 50`
      )
      .all(id),
    retries: db
      .prepare(
        'SELECT id, outcome, detail, created_at FROM order_retry_log WHERE order_id=? ORDER BY id DESC LIMIT 50'
      )
      .all(id),
    batches: db
      .prepare(
        'SELECT run, quantity, remains, status, due_at, remote_id, completed_at FROM drip_batches WHERE order_id=? ORDER BY run'
      )
      .all(id),
    refills: db
      .prepare(
        'SELECT id, status, remote_id, batch_run, created_at, updated_at FROM order_refills WHERE order_id=? ORDER BY id DESC'
      )
      .all(id),
  });
});

router.post('/orders/:id/notes', (req, res) => {
  ops.applySchema();
  const id = integer(req.params.id, 1, 1e15);
  const note = String(req.body?.note || '').trim();
  if (!id || !db.prepare('SELECT id FROM orders WHERE id=?').get(id))
    return res.status(404).json({ error: 'Ordem não encontrada.' });
  if (note.length < 2 || note.length > 1000)
    return res.status(400).json({ error: 'Nota inválida.' });
  db.prepare(
    'INSERT INTO order_staff_notes(order_id, admin_id, note) VALUES(?,?,?)'
  ).run(id, req.user.id, note);
  res.status(201).json({ message: 'Nota interna registrada.' });
});

router.post('/orders/:id/partial-refund', requireCEO, (req, res) => {
  const id = integer(req.params.id, 1, 1e15);
  const amount = integer(req.body?.amount_cents, 1, 100000000);
  if (!id || !amount)
    return res.status(400).json({ error: 'Informe o valor em centavos.' });
  try {
    const result = tx(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      if (!order)
        throw Object.assign(new Error('Ordem não encontrada.'), { status: 404 });
      const already = db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents),0) AS n FROM transactions WHERE type='order_refund' AND reference_id=?"
        )
        .get(order.uuid).n;
      if (already + amount > order.charge_cents)
        throw Object.assign(
          new Error('Estorno passa do valor cobrado neste pedido.'),
          { status: 409 }
        );
      const balance = creditBalanceAtomic(order.user_id, amount);
      if (balance === null)
        throw Object.assign(new Error('Não foi possível creditar.'), {
          status: 409,
        });
      db.prepare(
        "INSERT INTO transactions(user_id, type, amount_cents, balance_after_cents, reference_id, description) VALUES(?,'order_refund',?,?,?,?)"
      ).run(
        order.user_id,
        amount,
        balance,
        order.uuid,
        'Estorno parcial do pedido #' + order.id
      );
      return {
        balance_cents: balance,
        remaining_cents: order.charge_cents - already - amount,
      };
    });
    audit(req, 'partial_refund', String(id), { amount });
    res.json({ message: 'Estorno parcial creditado.', ...result });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/refills', (req, res) => {
  res.json({
    refills: db
      .prepare(
        `SELECT r.id, r.order_id, r.status, r.remote_id, r.batch_run, r.created_at, o.link
         FROM order_refills r JOIN orders o ON o.id=r.order_id
         ORDER BY r.id DESC LIMIT 100`
      )
      .all(),
  });
});

router.get('/services/below-cost', (req, res) => {
  const services = db
    .prepare(
      `SELECT id, name, platform, cost_per_k_cents, price_per_k_cents
       FROM services WHERE status='active' AND price_per_k_cents < cost_per_k_cents
       ORDER BY id LIMIT 200`
    )
    .all();
  try {
    if (services.length)
      db.prepare(
        `INSERT INTO operation_alerts(key, severity, message) VALUES('below-cost','warning',?)
         ON CONFLICT(key) DO UPDATE SET message=excluded.message, updated_at=CURRENT_TIMESTAMP, resolved_at=NULL`
      ).run(services.length + ' serviços com preço abaixo do custo.');
    else
      db.prepare(
        "UPDATE operation_alerts SET resolved_at=CURRENT_TIMESTAMP WHERE key='below-cost' AND resolved_at IS NULL"
      ).run();
  } catch {}
  res.json({ services });
});

router.post('/services/markup-undo', (req, res) => {
  ops.applySchema();
  const snap = db
    .prepare(
      'SELECT * FROM markup_snapshots WHERE restored_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get();
  if (!snap)
    return res.status(404).json({ error: 'Não há margem anterior para desfazer.' });
  let rows;
  try {
    rows = JSON.parse(snap.snapshot_json);
  } catch {
    return res.status(409).json({ error: 'Retrato de preços ilegível.' });
  }
  if (!Array.isArray(rows))
    return res.status(409).json({ error: 'Retrato de preços ilegível.' });
  const update = db.prepare(
    'UPDATE services SET price_per_k_cents=? WHERE id=?'
  );
  tx(() => {
    for (const row of rows) {
      const id = integer(row.id, 1, 1e15);
      const price = integer(row.price_per_k_cents, 0, 1e12);
      if (id && price != null) update.run(price, id);
    }
    db.prepare(
      'UPDATE markup_snapshots SET restored_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(snap.id);
  });
  audit(req, 'markup_undo', String(snap.id), { rows: rows.length });
  res.json({ message: 'Preços anteriores restaurados.', services: rows.length });
});

router.post('/services/reassign', (req, res) => {
  const providerId = integer(req.body?.provider_id, 1, 1e15);
  const platform = String(req.body?.platform || '').trim();
  if (!providerId || !platform || platform.length > 40)
    return res.status(400).json({ error: 'Plataforma ou fornecedor inválido.' });
  const provider = db
    .prepare("SELECT id FROM providers WHERE id=? AND status='active'")
    .get(providerId);
  if (!provider)
    return res.status(404).json({ error: 'Fornecedor indisponível.' });
  const result = db
    .prepare(
      "UPDATE services SET provider_id=? WHERE platform=? AND status='active'"
    )
    .run(providerId, platform);
  audit(req, 'reassign_provider', platform, {
    provider_id: providerId,
    services: result.changes,
  });
  res.json({ message: result.changes + ' serviços apontados ao fornecedor.' });
});

router.get('/providers/:id/sync-preview', async (req, res) => {
  const provider = db
    .prepare('SELECT * FROM providers WHERE id=?')
    .get(req.params.id);
  if (!provider)
    return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  if (provider.is_mock)
    return res.status(409).json({
      error: 'A prévia compara um fornecedor real. O mock não entra nessa conta.',
    });
  let key = provider.api_key;
  if (typeof key === 'string' && key.startsWith('v1:')) {
    try {
      key = require('../factor-secret').open(key);
    } catch {
      return res
        .status(409)
        .json({ error: 'Não foi possível ler a chave do fornecedor.' });
    }
  }
  try {
    const params = new URLSearchParams();
    params.set('key', key);
    params.set('action', 'services');
    const response = await require('../provider-client').providerFetch(
      provider.api_url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      }
    );
    const data = await response.json();
    const remote = Array.isArray(data) ? data : data.services || [];
    const local = db
      .prepare(
        'SELECT provider_service_id, name, cost_per_k_cents FROM services WHERE provider_id=?'
      )
      .all(provider.id);
    const remoteIds = new Set(
      remote.map((item) => String(item.service || item.id || ''))
    );
    const localIds = new Set(
      local.map((item) => String(item.provider_service_id || ''))
    );
    res.json({
      remote: remote.length,
      local: local.length,
      missing_locally: [...remoteIds].filter((id) => id && !localIds.has(id)).length,
      missing_upstream: [...localIds].filter((id) => id && !remoteIds.has(id)).length,
      applied: false,
    });
  } catch {
    res.status(502).json({ error: 'O fornecedor não respondeu à prévia.' });
  }
});

router.get('/providers/health', (req, res) => {
  ops.applySchema();
  const floor = Number(ops.ops('provider_balance_floor'));
  const providers = db
    .prepare(
      `SELECT p.id, p.name, p.status, p.is_mock, p.balance_upstream, p.currency, p.last_checked_at, p.last_ping_ms,
              (SELECT balance FROM provider_balance_log l WHERE l.provider_id=p.id ORDER BY l.id DESC LIMIT 1) AS last_balance
       FROM providers p ORDER BY p.id`
    )
    .all();
  res.json({
    floor,
    providers: providers.map((provider) => ({
      ...provider,
      below_floor:
        floor > 0 &&
        Number.isFinite(Number(provider.balance_upstream)) &&
        Number(provider.balance_upstream) < floor,
    })),
  });
});

router.get('/providers/:id/balance-log', (req, res) => {
  ops.applySchema();
  res.json({
    log: db
      .prepare(
        'SELECT id, balance, currency, ok, detail, created_at FROM provider_balance_log WHERE provider_id=? ORDER BY id DESC LIMIT 50'
      )
      .all(req.params.id),
  });
});

router.post('/platforms/:id/pause', (req, res) => {
  ops.applySchema();
  const paused = req.body?.paused === true || req.body?.paused === 1 ? 1 : 0;
  const result = db
    .prepare('UPDATE platforms_config SET is_paused=? WHERE id=?')
    .run(paused, req.params.id);
  if (!result.changes)
    return res.status(404).json({ error: 'Plataforma não encontrada.' });
  audit(req, paused ? 'platform_pause' : 'platform_resume', String(req.params.id), {});
  res.json({
    message: paused
      ? 'Plataforma pausada para compras novas. A vitrine não foi alterada.'
      : 'Plataforma liberada para compras novas.',
  });
});

router.get('/users/:id/ledger.csv', (req, res) => {
  const user = db
    .prepare('SELECT id, email FROM users WHERE id=?')
    .get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Conta não encontrada.' });
  const rows = db
    .prepare(
      'SELECT id, type, amount_cents, balance_after_cents, description, created_at FROM transactions WHERE user_id=? ORDER BY id'
    )
    .all(user.id);
  csv(res, 'extrato-' + user.id + '.csv', rows);
});

router.post('/users/:id/rotate-api-key', requireCEO, (req, res) => {
  ops.applySchema();
  const account = db
    .prepare('SELECT id, api_key, status FROM users WHERE id=? AND deleted_at IS NULL')
    .get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });
  const hours = integer(ops.ops('api_key_grace_hours', '24'), 1, 72) || 24;
  const next = crypto.randomBytes(24).toString('hex');
  tx(() => {
    if (account.api_key)
      db.prepare(
        "INSERT INTO api_key_grace(user_id, api_key, until) VALUES(?,?,datetime('now', ?)) ON CONFLICT(user_id) DO UPDATE SET api_key=excluded.api_key, until=excluded.until"
      ).run(account.id, account.api_key, '+' + hours + ' hours');
    db.prepare(
      'UPDATE users SET api_key=?, api_key_rotated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(next, account.id);
  });
  audit(req, 'api_key_grace', String(account.id), { hours });
  res.json({
    message: 'Nova chave emitida. A anterior vale por ' + hours + ' horas.',
    api_key: next,
    grace_hours: hours,
  });
});

router.post('/tickets/:id/assignee', (req, res) => {
  ops.applySchema();
  const assignee = integer(req.body?.assignee_id, 1, 1e15);
  const ticket = integer(req.params.id, 1, 1e15);
  if (!ticket) return res.status(400).json({ error: 'Chamado inválido.' });
  if (assignee) {
    const staff = db
      .prepare(
        "SELECT id FROM users WHERE id=? AND status='active' AND role IN ('support','admin','ceo')"
      )
      .get(assignee);
    if (!staff)
      return res.status(400).json({ error: 'Escolha alguém da equipe.' });
  }
  const result = db
    .prepare('UPDATE tickets SET assignee_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(assignee || null, ticket);
  if (!result.changes)
    return res.status(404).json({ error: 'Chamado não encontrado.' });
  res.json({ message: assignee ? 'Chamado atribuído.' : 'Atribuição removida.' });
});

router.get('/canned-replies', (req, res) => {
  ops.applySchema();
  res.json({
    replies: db
      .prepare('SELECT id, title, body, created_at FROM canned_replies ORDER BY id DESC LIMIT 100')
      .all(),
  });
});

router.post('/canned-replies', (req, res) => {
  ops.applySchema();
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (title.length < 2 || title.length > 80 || body.length < 2 || body.length > 2000)
    return res.status(400).json({ error: 'Título ou texto inválido.' });
  const id = db
    .prepare('INSERT INTO canned_replies(title, body, created_by) VALUES(?,?,?)')
    .run(title, body, req.user.id).lastInsertRowid;
  res.status(201).json({ id, message: 'Resposta pronta salva.' });
});

router.delete('/canned-replies/:id', (req, res) => {
  ops.applySchema();
  db.prepare('DELETE FROM canned_replies WHERE id=?').run(req.params.id);
  res.json({ message: 'Resposta pronta removida.' });
});

router.get('/audit/search', (req, res) => {
  const adminId = req.query.admin_id ? integer(req.query.admin_id, 1, 1e15) : null;
  const action = String(req.query.action || '').trim();
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if ((req.query.admin_id && !adminId) || (action && action.length > 80))
    return res.status(400).json({ error: 'Filtro inválido.' });
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)))
    return res.status(400).json({ error: 'Data inválida.' });
  let query =
    'SELECT l.id, l.admin_id, l.action, l.target, l.created_at, u.name AS admin_name FROM system_audit_logs l LEFT JOIN users u ON u.id=l.admin_id WHERE 1=1';
  const params = [];
  if (adminId) {
    query += ' AND l.admin_id=?';
    params.push(adminId);
  }
  if (action) {
    query += ' AND l.action=?';
    params.push(action);
  }
  if (from) {
    query += ' AND date(l.created_at)>=?';
    params.push(from);
  }
  if (to) {
    query += ' AND date(l.created_at)<=?';
    params.push(to);
  }
  query += ' ORDER BY l.id DESC LIMIT 200';
  res.json({ logs: db.prepare(query).all(...params) });
});

router.get('/finance/day', (req, res) => {
  const day = String(req.query.date || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    return res.status(400).json({ error: 'Data inválida.' });
  const orders = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(charge_cents),0) AS revenue_cents,
              COALESCE(SUM(cost_cents),0) AS cost_cents, COALESCE(SUM(profit_cents),0) AS profit_cents
       FROM orders WHERE date(created_at)=?`
    )
    .get(day);
  const movements = db
    .prepare(
      `SELECT type, COUNT(*) AS entries, COALESCE(SUM(amount_cents),0) AS amount_cents
       FROM transactions WHERE date(created_at)=? GROUP BY type ORDER BY type`
    )
    .all(day);
  res.json({ date: day, orders, movements });
});

router.get('/finance/profit', (req, res) => {
  res.json({
    note: 'O custo é o valor registrado no pedido, não uma fatura consultada agora no fornecedor.',
    rows: db
      .prepare(
        `SELECT COALESCE(p.name,'Sem fornecedor') AS provider, COUNT(*) AS orders,
                COALESCE(SUM(o.charge_cents),0) AS revenue_cents,
                COALESCE(SUM(o.cost_cents),0) AS cost_cents,
                COALESCE(SUM(o.profit_cents),0) AS profit_cents
         FROM orders o LEFT JOIN providers p ON p.id=o.provider_id
         WHERE o.status='completed' GROUP BY o.provider_id ORDER BY profit_cents DESC`
      )
      .all(),
  });
});

router.get('/giveaways/:id/entries', (req, res) => {
  const giveaway = db
    .prepare('SELECT id, title, status FROM giveaways WHERE id=?')
    .get(req.params.id);
  if (!giveaway)
    return res.status(404).json({ error: 'Sorteio não encontrado.' });
  res.json({
    giveaway,
    entries: db
      .prepare(
        `SELECT e.created_at, u.email, u.name FROM giveaway_entries e
         JOIN users u ON u.id=e.user_id WHERE e.giveaway_id=? ORDER BY e.id DESC LIMIT 500`
      )
      .all(giveaway.id),
  });
});

router.get('/challenges/:id/progress', (req, res) => {
  const challenge = db
    .prepare('SELECT * FROM challenges WHERE id=?')
    .get(req.params.id);
  if (!challenge)
    return res.status(404).json({ error: 'Desafio não encontrado.' });
  const progress =
    challenge.target_type === 'orders_count'
      ? db
          .prepare(
            `SELECT u.email, COUNT(*) AS progress FROM orders o JOIN users u ON u.id=o.user_id
             WHERE substr(o.created_at,1,7)=? GROUP BY u.id ORDER BY progress DESC LIMIT 20`
          )
          .all(challenge.month)
      : db
          .prepare(
            `SELECT u.email, COALESCE(SUM(o.charge_cents),0) AS progress FROM orders o JOIN users u ON u.id=o.user_id
             WHERE substr(o.created_at,1,7)=? GROUP BY u.id ORDER BY progress DESC LIMIT 20`
          )
          .all(challenge.month);
  res.json({ challenge, progress });
});

router.get('/coupons/usage', (req, res) => {
  res.json({
    coupons: db
      .prepare(
        `SELECT c.id, c.code, COUNT(cu.id) AS uses, COALESCE(SUM(cu.discount_cents),0) AS discount_cents
         FROM coupons c LEFT JOIN coupon_uses cu ON cu.coupon_id=c.id
         GROUP BY c.id ORDER BY uses DESC LIMIT 100`
      )
      .all(),
  });
});

router.get('/affiliates/month.csv', (req, res) => {
  const month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month))
    return res.status(400).json({ error: 'Informe o mês AAAA-MM.' });
  const rows = db
    .prepare(
      `SELECT rc.id, rc.level, rc.commission_cents, rc.deposit_amount_cents, rc.created_at,
              ref.email AS referrer_email, buyer.email AS buyer_email
       FROM referral_commissions rc
       JOIN users ref ON ref.id=rc.referrer_id JOIN users buyer ON buyer.id=rc.referred_id
       WHERE substr(rc.created_at,1,7)=? ORDER BY rc.id`
    )
    .all(month);
  csv(res, 'comissoes-' + month + '.csv', rows);
});

router.get('/roles', (req, res) => {
  res.json({
    roles: [
      { role: 'user', access: 'Compra, carteira, chamados próprios e API da própria conta.' },
      { role: 'vip', access: 'O mesmo que o cliente, com o desconto do nível de depósito.' },
      { role: 'support', access: 'Atende no painel do cliente. As rotas /api/admin exigem admin ou CEO.' },
      { role: 'admin', access: 'Catálogo, pedidos, chamados, cupons e esta mesa. Não grava chaves de gateway nem settings globais.' },
      { role: 'ceo', access: 'Settings, integrações, backup, estorno, papéis e depósito de ensaio.' },
    ],
  });
});

router.post('/blocked-links/test', (req, res) => {
  const sample = String(req.body?.sample || '');
  const pattern = String(req.body?.pattern || '');
  if (!sample || sample.length > 2048 || pattern.length > 200)
    return res.status(400).json({ error: 'Amostra ou padrão inválido.' });
  const live = require('../middleware/link-blacklist').isBlocked(sample);
  let regex = null;
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    try {
      const body = pattern.slice(1, pattern.lastIndexOf('/'));
      regex = new RegExp(body, 'i').test(sample);
    } catch {
      return res.status(400).json({ error: 'Expressão inválida.' });
    }
  }
  res.json({
    live_match: !!live,
    live_reason: live?.reason || null,
    regex_match: regex,
    note: 'O pedido real bloqueia por trecho contido no link. A expressão deste teste não é gravada.',
  });
});

router.put('/scheduled/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM scheduled_orders WHERE id=?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (row.status !== 'pending' || row.order_id)
    return res.status(409).json({ error: 'Só um agendamento pendente pode ser editado.' });
  const link = String(req.body?.link || row.link);
  const runAt = String(req.body?.run_at || row.run_at);
  let url;
  try {
    url = new URL(link);
  } catch {
    return res.status(400).json({ error: 'Link inválido.' });
  }
  const when = Date.parse(runAt);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    !Number.isFinite(when) ||
    when < Date.now() - 86400000 ||
    when > Date.now() + 366 * 86400000
  )
    return res.status(400).json({ error: 'Data ou link fora do intervalo.' });
  db.prepare('UPDATE scheduled_orders SET link=?, run_at=? WHERE id=? AND status=\'pending\'')
    .run(url.href, new Date(when).toISOString(), row.id);
  res.json({ message: 'Agendamento atualizado.' });
});

router.get('/mass-errors.csv', (req, res) => {
  ops.applySchema();
  csv(
    res,
    'erros-lote.csv',
    db
      .prepare(
        'SELECT id, user_id, message, excerpt, created_at FROM mass_order_errors ORDER BY id DESC LIMIT 1000'
      )
      .all()
  );
});

router.get('/subscriptions/log', (req, res) => {
  ops.applySchema();
  res.json({
    runs: db
      .prepare(
        `SELECT a.config_id AS subscription_id, a.period, a.created_at, o.order_id
         FROM automation_runs a
         LEFT JOIN automation_orders o ON o.kind=a.kind AND o.config_id=a.config_id AND o.period=a.period
         WHERE a.kind='subscription' ORDER BY a.created_at DESC LIMIT 100`
      )
      .all(),
    failures: db
      .prepare(
        'SELECT id, subscription_id, message, created_at FROM subscription_run_log ORDER BY id DESC LIMIT 100'
      )
      .all(),
  });
});

router.get('/staff/sessions', (req, res) => {
  res.json({
    sessions: db
      .prepare(
        `SELECT s.jti, s.device, s.created_at, s.last_seen_at, s.expires_at, u.id AS user_id, u.name, u.email, u.role
         FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.revoked_at IS NULL AND datetime(s.expires_at)>datetime('now')
           AND u.role IN ('support','admin','ceo')
         ORDER BY s.last_seen_at DESC LIMIT 100`
      )
      .all(),
  });
});

router.post('/staff/sessions/:jti/revoke', requireCEO, (req, res) => {
  const result = db
    .prepare(
      `UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP
       WHERE jti=? AND revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE role IN ('support','admin','ceo'))`
    )
    .run(req.params.jti);
  if (!result.changes)
    return res.status(404).json({ error: 'Sessão não encontrada.' });
  audit(req, 'staff_session_revoke', 'session', {});
  res.json({ message: 'Sessão da equipe encerrada.' });
});

router.post('/staff/:id/recovery-codes', requireCEO, (req, res) => {
  const account = db
    .prepare(
      "SELECT id, role, two_factor_enabled FROM users WHERE id=? AND role IN ('support','admin','ceo')"
    )
    .get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Membro não encontrado.' });
  if (!account.two_factor_enabled)
    return res.status(409).json({ error: 'O 2FA dessa conta ainda não está ativo.' });
  const codes = require('../factor-secret').issueRecovery(account.id);
  audit(req, 'recovery_codes_issued', String(account.id), { count: codes.length });
  res.json({
    message: 'Códigos novos gerados. Os anteriores deixaram de valer. Guarde esta lista agora.',
    recovery_codes: codes,
  });
});

router.get('/children/timeline', (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, domain, panel_name, status, created_at, ownership_verified_at, provisioned_at FROM child_panels ORDER BY id DESC LIMIT 100'
    )
    .all();
  res.json({
    children: rows.map((row) => ({
      ...row,
      steps: [
        { name: 'Pedido', done: true, at: row.created_at },
        { name: 'DNS verificado', done: !!row.ownership_verified_at, at: row.ownership_verified_at },
        { name: 'Instalação confirmada', done: !!row.provisioned_at, at: row.provisioned_at },
        { name: 'Ativo', done: row.status === 'active', at: row.status === 'active' ? row.provisioned_at : null },
      ],
    })),
  });
});

router.get('/backup-targets', requireCEO, (req, res) => {
  ops.applySchema();
  res.json({
    targets: db
      .prepare('SELECT id, label, location, last_export_at, created_at FROM backup_targets ORDER BY id DESC')
      .all(),
    note: 'O arquivo baixa neste navegador. O painel não envia a cópia ao destino.',
  });
});

router.post('/backup-targets', requireCEO, (req, res) => {
  ops.applySchema();
  const label = String(req.body?.label || '').trim();
  const location = String(req.body?.location || '').trim();
  if (label.length < 2 || label.length > 80 || location.length < 2 || location.length > 300)
    return res.status(400).json({ error: 'Rótulo ou destino inválido.' });
  const id = db
    .prepare('INSERT INTO backup_targets(label, location) VALUES(?,?)')
    .run(label, location).lastInsertRowid;
  res.status(201).json({ id, message: 'Destino anotado.' });
});

router.get('/backup-targets/:id/export', requireCEO, (req, res) => {
  ops.applySchema();
  const target = db
    .prepare('SELECT id, label FROM backup_targets WHERE id=?')
    .get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Destino não encontrado.' });
  const tmpPath = path.join(os.tmpdir(), 'smmhub-offsite-' + Date.now() + '.sqlite');
  try {
    db.exec("VACUUM INTO '" + tmpPath.replace(/'/g, "''") + "'");
    db.prepare(
      'UPDATE backup_targets SET last_export_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(target.id);
    res.download(tmpPath, 'smmhub-' + target.label.replace(/[^\w.-]+/g, '-') + '.sqlite', () => {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    });
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    res.status(500).json({ error: 'Falha ao gerar a cópia.' });
  }
});

router.get('/checklist', (req, res) => {
  ops.applySchema();
  let manual = {};
  try {
    manual = JSON.parse(ops.ops('checklist_vps', '{}'));
  } catch {
    manual = {};
  }
  res.json({
    auto: {
      encryption_key: /^[0-9a-f]{64}$/i.test(process.env.SETTINGS_ENCRYPTION_KEY || ''),
      smtp: !!(config.smtp.enabled && config.smtp.host),
      public_url: config.publicUrl.startsWith('https://'),
    },
    manual: Object.fromEntries(
      checklistItems.map((item) => [item, manual[item] === true])
    ),
  });
});

router.post('/checklist', requireCEO, (req, res) => {
  const item = String(req.body?.item || '');
  if (!checklistItems.includes(item))
    return res.status(400).json({ error: 'Item desconhecido.' });
  let manual = {};
  try {
    manual = JSON.parse(ops.ops('checklist_vps', '{}'));
  } catch {
    manual = {};
  }
  manual[item] = req.body?.done === true;
  ops.setOps('checklist_vps', JSON.stringify(manual));
  res.json({ message: 'Checklist atualizado.' });
});

module.exports = router;
