const { db } = require('./db');

const labels = {
  pending: 'Pedido recebido e aguardando despacho.',
  dispatching: 'Pedido sendo enviado ao fornecedor.',
  processing: 'Pedido aceito pelo fornecedor.',
  in_progress: 'Pedido em andamento.',
  awaiting_confirmation: 'Pedido em confirmação com o fornecedor.',
  completed: 'Pedido concluído.',
  failed: 'Pedido falhou e o valor foi estornado.',
  canceled: 'Pedido cancelado.',
  partial: 'Pedido entregue parcialmente.',
};

let ready = false;

function applySchema() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_order_notices_user ON order_notices(user_id, id DESC);
    CREATE TABLE IF NOT EXISTS agency_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      spend_cap_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agency_order_clients (
      order_id INTEGER PRIMARY KEY,
      client_id INTEGER NOT NULL
    );
  `);
  const orders = db.prepare('PRAGMA table_info(orders)').all();
  if (orders.length && !orders.some((column) => column.name === 'placed_by_sub'))
    db.exec('ALTER TABLE orders ADD COLUMN placed_by_sub INTEGER');
  const subs = db.prepare('PRAGMA table_info(sub_accounts)').all();
  if (subs.length && !subs.some((column) => column.name === 'spend_cap_cents'))
    db.exec(
      'ALTER TABLE sub_accounts ADD COLUMN spend_cap_cents INTEGER NOT NULL DEFAULT 0'
    );
  ready = true;
}

function unstable(recent, failed) {
  return recent >= 3 && failed * 5 >= recent * 2;
}

function record(userId, orderId, status, detail) {
  try {
    applySchema();
    if (!labels[status]) return;
    const last = db
      .prepare(
        'SELECT status FROM order_notices WHERE order_id=? ORDER BY id DESC LIMIT 1'
      )
      .get(orderId);
    if (last && last.status === status) return;
    const extra =
      detail && (status === 'failed' || status === 'partial')
        ? ' ' + String(detail).replace(/\s+/g, ' ').slice(0, 180)
        : '';
    db.prepare(
      'INSERT INTO order_notices(user_id, order_id, status, message) VALUES(?,?,?,?)'
    ).run(userId, orderId, status, labels[status] + extra);
    if (status === 'completed' || status === 'failed') email(userId, orderId, status);
  } catch (err) {
    require('./logger').warn(
      { err: err.message, orderId, status },
      'aviso de pedido'
    );
  }
}

function touch(orderId, detail) {
  applySchema();
  const row = db
    .prepare('SELECT user_id, status FROM orders WHERE id=?')
    .get(orderId);
  if (row) record(row.user_id, orderId, row.status, detail);
}

function email(userId, orderId, status) {
  const pref = db
    .prepare('SELECT notifications_email FROM user_preferences WHERE user_id=?')
    .get(userId);
  if (pref && Number(pref.notifications_email) === 0) return;
  const row = db
    .prepare(
      `SELECT u.email, u.name, o.id, o.quantity, o.link, s.name AS service_name
       FROM orders o JOIN users u ON u.id=o.user_id JOIN services s ON s.id=o.service_id
       WHERE o.id=?`
    )
    .get(orderId);
  if (!row) return;
  const mail = require('./mail');
  const payload = {
    name: row.name,
    orderId: row.id,
    serviceName: row.service_name,
    quantity: row.quantity,
    link: row.link,
  };
  mail
    .sendMail(row.email, status === 'completed' ? 'order_completed' : 'order_failed', payload)
    .catch(() => {});
}

function metaFrom(req) {
  const meta = {};
  const sub = req.tokenPayload && Number(req.tokenPayload.sub_account_id);
  if (Number.isSafeInteger(sub) && sub > 0) meta.placed_by_sub = sub;
  if (req.body && req.body.client_id != null && req.body.client_id !== '') {
    const client = Number(req.body.client_id);
    if (!Number.isSafeInteger(client) || client <= 0) {
      const error = new Error('Cliente da agência inválido.');
      error.status = 400;
      throw error;
    }
    meta.client_id = client;
  }
  return meta;
}

function spent(sql, id) {
  return db.prepare(sql).get(id).n;
}

function assertCharge(userId, chargeCents, meta) {
  applySchema();
  if (!meta) return;
  if (!Number.isSafeInteger(chargeCents) || chargeCents < 0) {
    const error = new Error('Valor do pedido inválido.');
    error.status = 400;
    throw error;
  }
  if (meta.placed_by_sub) {
    const sub = db
      .prepare('SELECT parent_user_id, spend_cap_cents FROM sub_accounts WHERE id=?')
      .get(meta.placed_by_sub);
    if (!sub || sub.parent_user_id !== userId) {
      const error = new Error('Subconta inválida.');
      error.status = 403;
      throw error;
    }
    if (sub.spend_cap_cents > 0) {
      const used = spent(
        `SELECT COALESCE(SUM(charge_cents),0) AS n FROM orders
         WHERE placed_by_sub=? AND status!='canceled'
           AND datetime(created_at)>=datetime('now','start of month')`,
        meta.placed_by_sub
      );
      if (used + chargeCents > sub.spend_cap_cents) {
        const error = new Error('A subconta atingiu o teto do mês.');
        error.status = 429;
        throw error;
      }
    }
  }
  if (meta.client_id) {
    const client = db
      .prepare('SELECT user_id, spend_cap_cents FROM agency_clients WHERE id=?')
      .get(meta.client_id);
    if (!client || client.user_id !== userId) {
      const error = new Error('Cliente da agência inválido.');
      error.status = 403;
      throw error;
    }
    if (client.spend_cap_cents > 0) {
      const used = spent(
        `SELECT COALESCE(SUM(o.charge_cents),0) AS n
         FROM orders o JOIN agency_order_clients a ON a.order_id=o.id
         WHERE a.client_id=? AND o.status!='canceled'
           AND datetime(o.created_at)>=datetime('now','start of month')`,
        meta.client_id
      );
      if (used + chargeCents > client.spend_cap_cents) {
        const error = new Error('O cliente atingiu o teto do mês.');
        error.status = 429;
        throw error;
      }
    }
  }
}

function attach(orderId, meta) {
  if (!meta || (!meta.placed_by_sub && !meta.client_id)) return;
  try {
    applySchema();
    if (meta.placed_by_sub)
      db.prepare('UPDATE orders SET placed_by_sub=? WHERE id=?').run(
        meta.placed_by_sub,
        orderId
      );
    if (meta.client_id)
      db.prepare(
        'INSERT OR IGNORE INTO agency_order_clients(order_id, client_id) VALUES(?,?)'
      ).run(orderId, meta.client_id);
  } catch (err) {
    require('./logger').warn({ err: err.message, orderId }, 'vínculo do pedido');
  }
}

function cancelOrder(userId, orderId) {
  applySchema();
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    const error = new Error('Pedido inválido.');
    error.status = 400;
    throw error;
  }
  const order = db
    .prepare(
      `SELECT o.id, o.status, o.remote_order_id, s.cancel_available
       FROM orders o JOIN services s ON s.id=o.service_id
       WHERE o.id=? AND o.user_id=?`
    )
    .get(orderId, userId);
  if (!order) {
    const error = new Error('Ordem não encontrada.');
    error.status = 404;
    throw error;
  }
  if (!order.cancel_available) {
    const error = new Error('Este serviço não aceita cancelamento.');
    error.status = 409;
    throw error;
  }
  const updated = db
    .prepare(
      `UPDATE orders SET status='canceled', updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND user_id=? AND status='pending' AND remote_order_id IS NULL`
    )
    .run(order.id, userId);
  if (!updated.changes) {
    const error = new Error('O pedido já está em andamento no fornecedor.');
    error.status = 409;
    throw error;
  }
  require('./smm-engine').refundOrder(order.id, false);
  record(userId, order.id, 'canceled');
  return { id: order.id, status: 'canceled' };
}

module.exports = {
  applySchema,
  record,
  touch,
  metaFrom,
  assertCharge,
  attach,
  cancelOrder,
  unstable,
  labels,
};
