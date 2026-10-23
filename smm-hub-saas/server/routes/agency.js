const { escapeHtml, safeHttpUrl } = require('../html');
const express = require('express');
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword } = require('../db');
const { requireAuth, signToken } = require('../auth');

const router = express.Router();

/* Login específico de sub-conta — gera token do PARENT com flag sub_account */
router.post('/sub-login', (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Credenciais obrigatórias.' });

  const sub = db
    .prepare('SELECT * FROM sub_accounts WHERE email = ? AND status = ?')
    .get(email.trim().toLowerCase(), 'active');
  if (!sub) return res.status(401).json({ error: 'Credenciais inválidas.' });
  if (!verifyPassword(password, sub.password_hash, sub.salt))
    return res.status(401).json({ error: 'Credenciais inválidas.' });

  const parent = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(sub.parent_user_id);
  if (!parent || parent.status !== 'active')
    return res.status(403).json({ error: 'Conta mãe suspensa.' });

  const token = signToken({ ...parent, sub_account_id: sub.id });
  res.json({
    message: 'Login de membro realizado.',
    token,
    user: {
      id: parent.id,
      name: sub.name,
      email: sub.email,
      role: 'user',
      sub_account: {
        id: sub.id,
        name: sub.name,
        email: sub.email,
        can_order: !!sub.can_order,
        can_view_balance: !!sub.can_view_balance,
        can_view_history: !!sub.can_view_history,
      },
    },
  });
});

router.use(requireAuth);

router.get('/sub-accounts', (req, res) => {
  const subs = db
    .prepare(
      `SELECT id, name, email, can_order, can_view_balance, can_view_history, status, created_at
    FROM sub_accounts WHERE parent_user_id = ? ORDER BY id DESC`
    )
    .all(req.user.id);
  res.json({ sub_accounts: subs });
});

router.post('/sub-accounts', (req, res) => {
  try {
    const {
      name,
      email,
      password,
      can_order,
      can_view_balance,
      can_view_history,
    } = req.body;
    if (!name || !email || !password)
      return res
        .status(400)
        .json({ error: 'Nome, e-mail e senha obrigatórios.' });
    if (password.length < 12)
      return res.status(400).json({ error: 'Senha mínima: 12 caracteres.' });

    const exists = db
      .prepare('SELECT id FROM sub_accounts WHERE email = ?')
      .get(email.trim().toLowerCase());
    if (exists)
      return res
        .status(400)
        .json({ error: 'E-mail já cadastrado para sub-conta.' });

    const p = hashPassword(password);
    const r = db
      .prepare(
        `INSERT INTO sub_accounts (parent_user_id, name, email, password_hash, salt,
      can_order, can_view_balance, can_view_history, status) VALUES (?,?,?,?,?,?,?,?,'active')`
      )
      .run(
        req.user.id,
        name.trim(),
        email.trim().toLowerCase(),
        p.hash,
        p.salt,
        can_order !== false ? 1 : 0,
        can_view_balance ? 1 : 0,
        can_view_history !== false ? 1 : 0
      );
    res.status(201).json({
      message: 'Membro adicionado!',
      sub_account_id: r.lastInsertRowid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sub-accounts/:id', (req, res) => {
  const r = db
    .prepare('DELETE FROM sub_accounts WHERE id = ? AND parent_user_id = ?')
    .run(req.params.id, req.user.id);
  if (r.changes === 0)
    return res.status(404).json({ error: 'Subconta não encontrada.' });
  res.json({ message: 'Subconta removida.' });
});

router.get('/white-label-report/:order_id', (req, res) => {
  const agencyName = req.query.agency_name || 'Agência Digital & Performance';
  const clientBrand = req.query.client_brand || 'Campanha de Crescimento';

  const order = db
    .prepare(
      `SELECT o.*, s.name as service_name, s.platform
    FROM orders o JOIN services s ON o.service_id = s.id
    WHERE o.id = ? AND o.user_id = ?`
    )
    .get(req.params.order_id, req.user.id);
  if (!order) return res.status(404).send('Ordem não encontrada.');

  const delivered = Math.max(0, order.quantity - (order.remains || 0));
  const percent =
    order.quantity > 0
      ? Math.min(100, Math.round((delivered / order.quantity) * 100))
      : 0;

  res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório — ${escapeHtml(agencyName)}</title>
    <style>body{font-family:system-ui;padding:40px;max-width:800px;margin:auto}.header{display:flex;justify-content:space-between;border-bottom:2px solid #0284c7;padding-bottom:20px}
    .metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}
    .card{background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:16px;text-align:center}
    .val{font-size:26px;font-weight:800;color:#0284c7}</style></head><body>
    <div class="header"><div><div style="font-size:22px;font-weight:800">${escapeHtml(agencyName)}</div><div>Relatório de Desempenho</div></div>
    <div style="background:#e0f2fe;color:#0369a1;padding:6px 14px;border-radius:9999px">AUDITORIA</div></div>
    <h3>Resumo da Campanha</h3>
    <p><strong>Cliente:</strong> ${escapeHtml(clientBrand)}</p>
    <p><strong>Serviço:</strong> ${escapeHtml(order.service_name)}</p>
    <p><strong>Link:</strong> <a href="${escapeHtml(safeHttpUrl(order.link))}" rel="noopener noreferrer">${escapeHtml(order.link)}</a></p>
    <p><strong>Data:</strong> ${order.created_at}</p>
    <div class="metric-grid">
      <div class="card"><div class="val">${(order.start_count || 0).toLocaleString('pt-BR')}</div><div>Contagem Inicial</div></div>
      <div class="card"><div class="val">+${delivered.toLocaleString('pt-BR')}</div><div>Métricas Entregues</div></div>
      <div class="card"><div class="val">${percent}%</div><div>Taxa de Conclusão</div></div>
    </div>
    <button onclick="window.print()" style="padding:10px 20px;background:#0284c7;color:#fff;border:none;border-radius:6px">Salvar PDF</button>
    </body></html>`);
});

module.exports = router;
