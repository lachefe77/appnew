const { escapeHtml } = require('../html');
const express = require('express');
const { db, hashPassword, verifyPassword } = require('../db');
const { requireAuth, requireAdmin, signToken } = require('../auth');

const router = express.Router();
const { signSupplier, requireSupplier } = require('../supplier-auth');

/* 19. INVOICES NF */
router.post('/invoices-nf', requireAuth, (req, res) => {
  const { period_start, period_end, cnpj, razao_social } = req.body;
  const sum = db
    .prepare(
      `SELECT COALESCE(SUM(charge_cents),0) as total FROM orders
    WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?`
    )
    .get(req.user.id, period_start, period_end);
  const r = db
    .prepare(
      `INSERT INTO invoices_nf (user_id, cnpj, razao_social, amount_cents, period_start, period_end)
    VALUES (?,?,?,?,?,?)`
    )
    .run(
      req.user.id,
      cnpj || null,
      razao_social || null,
      sum.total,
      period_start,
      period_end
    );
  res.status(201).json({
    id: r.lastInsertRowid,
    amount_cents: sum.total,
    message:
      'NF solicitada. Integração NFe.io emitirá o documento quando configurada.',
  });
});

router.get('/invoices-nf', requireAuth, (req, res) => {
  res.json({
    invoices: db
      .prepare('SELECT * FROM invoices_nf WHERE user_id = ? ORDER BY id DESC')
      .all(req.user.id),
  });
});

/* 20. RECURRING CONTRACTS */
router.post('/contracts', requireAuth, (req, res) => {
  const { name, amount_cents, interval_days, allocation } = req.body;
  if (!name || !amount_cents || !allocation)
    return res.status(400).json({ error: 'Faltam campos.' });
  if (
    !Number.isSafeInteger(amount_cents) ||
    amount_cents <= 0 ||
    !Array.isArray(allocation) ||
    allocation.length < 1 ||
    allocation.length > 20 ||
    !Number.isInteger(Number(interval_days || 30)) ||
    Number(interval_days || 30) < 1 ||
    Number(interval_days || 30) > 365
  )
    return res.status(400).json({ error: 'Contrato inválido.' });
  try {
    const total = allocation.reduce(
      (n, x) =>
        n + require('../order-domain').quoteOrder(req.user.id, x).charge_cents,
      0
    );
    if (total > amount_cents)
      return res
        .status(400)
        .json({ error: 'Itens excedem o teto do contrato.' });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const next = new Date(
    Date.now() + (parseInt(interval_days, 10) || 30) * 86400000
  ).toISOString();
  const r = db
    .prepare(
      `INSERT INTO recurring_contracts (user_id, name, amount_cents, interval_days, next_run, allocation_json)
    VALUES (?,?,?,?,?,?)`
    )
    .run(
      req.user.id,
      name,
      amount_cents,
      parseInt(interval_days, 10) || 30,
      next,
      JSON.stringify(allocation)
    );
  res.status(201).json({ id: r.lastInsertRowid, next_run: next });
});

router.get('/contracts', requireAuth, (req, res) => {
  res.json({
    contracts: db
      .prepare('SELECT * FROM recurring_contracts WHERE user_id = ?')
      .all(req.user.id),
  });
});

/* 21. HIERARQUIA MULTINÍVEL */
router.post('/organizations', requireAuth, (req, res) => {
  const { name, cnpj, billing_email, parent_org_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
  if (
    parent_org_id &&
    !db
      .prepare(
        "SELECT org_id FROM organization_members WHERE org_id=? AND user_id=? AND role='owner'"
      )
      .get(parent_org_id, req.user.id)
  )
    return res.status(403).json({ error: 'Organização pai não autorizada.' });
  const r = db
    .prepare(
      `INSERT INTO organizations (name, owner_user_id, parent_org_id, cnpj, billing_email)
    VALUES (?,?,?,?,?)`
    )
    .run(
      name,
      req.user.id,
      parent_org_id || null,
      cnpj || null,
      billing_email || null
    );
  db.prepare(
    'INSERT INTO organization_members (org_id, user_id, role) VALUES (?,?,?)'
  ).run(r.lastInsertRowid, req.user.id, 'owner');
  res.status(201).json({ id: r.lastInsertRowid });
});

router.get('/organizations', requireAuth, (req, res) => {
  const orgs = db
    .prepare(
      `SELECT o.*, m.role FROM organizations o
    JOIN organization_members m ON m.org_id = o.id WHERE m.user_id = ?`
    )
    .all(req.user.id);
  res.json({ organizations: orgs });
});

/* 22. ORDER APPROVALS */
router.post('/approvals', requireAuth, (req, res) => {
  const { order_payload, amount_cents } = req.body;
  const r = db
    .prepare(
      `INSERT INTO order_approvals (order_payload_json, requester_user_id, amount_cents)
    VALUES (?,?,?)`
    )
    .run(JSON.stringify(order_payload), req.user.id, amount_cents);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.get('/approvals/pending', requireAuth, (req, res) => {
  const staff = ['admin', 'ceo'].includes(req.user.role);
  const rows = staff
    ? db
        .prepare(
          "SELECT * FROM order_approvals WHERE status = 'pending' ORDER BY id DESC LIMIT 100"
        )
        .all()
    : db
        .prepare(
          "SELECT * FROM order_approvals WHERE status = 'pending' AND requester_user_id = ? ORDER BY id DESC LIMIT 100"
        )
        .all(req.user.id);
  res.json({ approvals: rows });
});

router.post('/approvals/:id/decide', requireAdmin, (req, res) => {
  const { decision, reason } = req.body;
  if (!['approved', 'denied'].includes(decision))
    return res.status(400).json({ error: 'Decisão inválida.' });
  const row = db
    .prepare(
      'SELECT requester_user_id, status FROM order_approvals WHERE id = ?'
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Aprovação não encontrada.' });
  if (row.requester_user_id === req.user.id)
    return res
      .status(403)
      .json({ error: 'Não é permitido aprovar sua própria solicitação.' });
  const result = db
    .prepare(
      `UPDATE order_approvals SET status=?, approver_user_id=?, decided_at=CURRENT_TIMESTAMP, reason=? WHERE id = ? AND status='pending'`
    )
    .run(decision, req.user.id, reason || null, req.params.id);
  if (!result.changes)
    return res.status(409).json({ error: 'Solicitação já decidida.' });
  res.json({ ok: true });
});

/* 23. SLA */
router.get('/sla', requireAuth, (req, res) => {
  res.json({
    sla: db
      .prepare(
        'SELECT * FROM sla_contracts WHERE user_id = ? AND is_active = 1'
      )
      .all(req.user.id),
  });
});

router.post('/sla', requireAdmin, (req, res) => {
  const {
    user_id,
    name,
    max_start_minutes,
    max_delivery_hours,
    refund_pct_on_breach,
  } = req.body;
  const r = db
    .prepare(
      `INSERT INTO sla_contracts (user_id, name, max_start_minutes, max_delivery_hours, refund_pct_on_breach)
    VALUES (?,?,?,?,?)`
    )
    .run(
      user_id,
      name,
      max_start_minutes || 60,
      max_delivery_hours || 24,
      refund_pct_on_breach || 100
    );
  res.status(201).json({ id: r.lastInsertRowid });
});

/* 24. FATURA CONSOLIDADA PDF (HTML printable) */
router.get('/invoice-consolidated', requireAuth, (req, res) => {
  const { from, to } = req.query;
  const orders = db
    .prepare(
      `SELECT o.*, s.name as service_name FROM orders o JOIN services s ON o.service_id = s.id
    WHERE o.user_id = ? AND DATE(o.created_at) BETWEEN ? AND ? ORDER BY o.id ASC`
    )
    .all(req.user.id, from, to);
  const total = orders.reduce((s, o) => s + o.charge_cents, 0);
  const u = db
    .prepare('SELECT name, email FROM users WHERE id = ?')
    .get(req.user.id);

  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fatura Consolidada</title>
    <style>body{font-family:system-ui;padding:40px;max-width:800px;margin:auto}table{width:100%;border-collapse:collapse;margin-top:20px}
    th,td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left}.total{font-size:20px;font-weight:bold;text-align:right;margin-top:20px}</style>
    </head><body onload="window.print()">
    <h1>⚡ Fatura Consolidada — SMM Hub</h1>
    <p>Cliente: <strong>${escapeHtml(u.name)}</strong> (${escapeHtml(u.email)})</p>
    <p>Período: ${escapeHtml(from)} a ${escapeHtml(to)}</p>
    <table><thead><tr><th>#</th><th>Serviço</th><th>Qtd</th><th>Valor</th></tr></thead><tbody>
    ${orders.map((o) => `<tr><td>${o.id}</td><td>${escapeHtml(o.service_name)}</td><td>${o.quantity}</td><td>R$ ${(o.charge_cents / 100).toFixed(2)}</td></tr>`).join('')}
    </tbody></table>
    <div class="total">TOTAL: R$ ${(total / 100).toFixed(2).replace('.', ',')}</div>
    </body></html>`);
});

/* 25. SUPPLIER PORTAL (login + métricas do próprio provider) */
router.post('/supplier/login', (req, res) => {
  const { user, password } = req.body;
  const row = db
    .prepare(
      `SELECT sp.*, p.name as provider_name FROM supplier_portal sp
    JOIN providers p ON sp.provider_id = p.id WHERE sp.portal_user = ? AND sp.enabled = 1`
    )
    .get(user);
  if (
    !row ||
    !verifyPassword(password || '', row.portal_password_hash, row.portal_salt)
  ) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }
  const token = signSupplier(row);
  res.json({
    token,
    provider_id: row.provider_id,
    provider_name: row.provider_name,
  });
});

router.post('/supplier/credentials', requireAdmin, (req, res) => {
  const { provider_id, portal_user, portal_password } = req.body;
  const h = hashPassword(portal_password);
  db.prepare(
    `INSERT INTO supplier_portal (provider_id, portal_user, portal_password_hash, portal_salt, enabled)
    VALUES (?,?,?,?,1) ON CONFLICT(provider_id) DO UPDATE SET
    portal_user=excluded.portal_user, portal_password_hash=excluded.portal_password_hash,
    portal_salt=excluded.portal_salt, enabled=1`
  ).run(provider_id, portal_user, h.hash, h.salt);
  res.json({ ok: true });
});

router.get('/supplier/metrics', requireSupplier, (req, res) => {
  const providerId = req.supplier.provider_id;
  const stats = db
    .prepare(
      `SELECT COUNT(*) as orders, COALESCE(SUM(charge_cents),0) as revenue,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
    FROM orders WHERE provider_id = ?`
    )
    .get(providerId);
  res.json({ provider_id: providerId, ...stats });
});

module.exports = router;
