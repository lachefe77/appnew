const crypto = require('node:crypto');
const { db, tx, calculateTier, debitBalanceAtomic } = require('./db');
const { isBlocked } = require('./middleware/link-blacklist');
function error(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function quoteOrder(userId, input) {
  const user = db
    .prepare(
      "SELECT * FROM users WHERE id=? AND status='active' AND deleted_at IS NULL"
    )
    .get(userId);
  if (!user) throw error('Conta indisponível.', 401);
  if (
    db.prepare("SELECT value FROM settings WHERE key='freeze_mode'").get()
      ?.value === '1'
  )
    throw error('Compras pausadas temporariamente.', 503);
  const quantity = Number(input.quantity),
    serviceId = Number(input.service_id);
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isSafeInteger(serviceId) ||
    serviceId <= 0
  )
    throw error('Serviço ou quantidade inválido.');
  const service = db
    .prepare("SELECT * FROM services WHERE id=? AND status='active'")
    .get(serviceId);
  if (!service) throw error('Serviço indisponível.', 404);
  const provider=db.prepare("SELECT * FROM providers WHERE id=? AND status='active'").get(service.provider_id);
  if(!provider)throw error('Fornecedor temporariamente indisponível.',503);
  if (
    require('./config').env === 'production' &&
    db
      .prepare('SELECT is_mock FROM providers WHERE id=?')
      .get(service.provider_id)?.is_mock
  )
    throw error('Serviço ainda não conectado a um provedor real.', 503);
  if (quantity < service.min_quantity || quantity > service.max_quantity)
    throw error('Quantidade fora dos limites do serviço.');
  const drip = require('./drip-domain').plan(input, service, quantity);
  if (typeof input.link !== 'string' || input.link.length > 2048)
    throw error('Link inválido.');
  let url;
  try {
    url = new URL(input.link);
  } catch {
    throw error('Informe uma URL HTTP ou HTTPS válida.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    isBlocked(input.link)
  )
    throw error('Link não permitido.');
  if (
    input.comments != null &&
    (typeof input.comments !== 'string' || input.comments.length > 10000)
  )
    throw error('Comentários inválidos.');
  const comments=service.type==='custom_comments'?String(input.comments||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean):[];
  if(service.type==='custom_comments'&&comments.length!==quantity)throw error('A quantidade deve ser igual ao número de comentários, um por linha.');
  const now = new Date();
  const rule = db
    .prepare(
      `SELECT multiplier FROM dynamic_pricing_rules WHERE is_active=1 AND (service_id=? OR service_id IS NULL) AND (platform=? OR platform IS NULL) AND (day_of_week=? OR day_of_week IS NULL) AND (hour_from IS NULL OR hour_from<=?) AND (hour_to IS NULL OR hour_to>?) ORDER BY (service_id IS NOT NULL) DESC,(platform IS NOT NULL) DESC,id DESC LIMIT 1`
    )
    .get(
      service.id,
      service.platform,
      now.getUTCDay(),
      now.getUTCHours(),
      now.getUTCHours()
    );
  const multiplier = rule?.multiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier <= 0)
    throw error('Configuração de preço inválida.', 503);
  const raw = Math.round(
    ((service.price_per_k_cents * quantity) / 1000) *
      multiplier *
      (1 - calculateTier(user.total_deposited_cents).discount_pct / 100)
  );
  const cost = Math.round((service.cost_per_k_cents * quantity) / 1000);
  let coupon = null,
    discount = 0;
  if (input.coupon_code) {
    ({ coupon, discount } = require('./coupon-domain').validateCoupon(
      userId,
      input.coupon_code,
      raw
    ));
  }
  const charge =
    Math.max(50, raw - Math.max(0, discount)) +
    (input.add_bump === true ? 690 : 0);
  if (![charge, cost].every(Number.isSafeInteger) || cost < 0 || charge <= 0)
    throw error('Preço inválido.', 503);
  const ambassador = coupon
    ? db
        .prepare(
          "SELECT * FROM ambassador_coupons WHERE code=? AND status='active'"
        )
        .get(coupon.code)
    : null;
  if (ambassador?.user_id === userId)
    throw error('Cupom próprio não pode ser utilizado.');
  const commission = ambassador
    ? Math.round((charge * ambassador.commission_pct) / 100)
    : 0;
  const cashbackPct = Number(
    db.prepare("SELECT value FROM settings WHERE key='cashback_pct'").get()
      ?.value ?? 3
  );
  if (!Number.isFinite(cashbackPct) || cashbackPct < 0 || cashbackPct > 20)
    throw error('Configuração de cashback inválida.', 503);
  if (
    cost +
      commission +
      Math.round((charge * Math.max(0, Math.min(20, cashbackPct))) / 100) >
    charge
  )
    throw error('Serviço temporariamente sem preço comercial válido.', 409);
  require('./ops-desk').assertCommerceGuards(
    user,
    service,
    { ...input, link: url.href },
    charge
  );
  return {
    user,
    service,
    quantity,
    link: url.href,
    charge_cents: charge,
    cost_cents: cost,
    discount_cents: Math.max(0, discount),
    coupon,
    ambassador,
    commission,
    drip,
    comments:comments.length?comments.join('\n'):null,
  };
}
function insertOrder(userId, input,pricing) {
  const q = quoteOrder(userId, input);
  if(pricing){
    const charge=pricing.charge_cents,pct=Number(db.prepare("SELECT value FROM settings WHERE key='cashback_pct'").get()?.value??3);
    if(q.coupon||q.ambassador||!Number.isSafeInteger(charge)||charge<50||q.cost_cents+Math.round(charge*pct/100)>charge)throw error('Preço do combo não cobre o custo e os benefícios.',409);
    q.charge_cents=charge;
  }
  const balance = debitBalanceAtomic(userId, q.charge_cents);
  if (balance === null) throw error('Saldo insuficiente.');
  const uuid = crypto.randomUUID();
  const inserted = db
    .prepare(
      `INSERT INTO orders(uuid,user_id,service_id,provider_id,link,quantity,charge_cents,cost_cents,profit_cents,status,comments_payload,remains) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)`
    )
    .run(
      uuid,
      userId,
      q.service.id,
      q.service.provider_id,
      q.link,
      q.quantity,
      q.charge_cents,
      q.cost_cents,
      q.charge_cents - q.cost_cents,
      q.comments,
      q.quantity
    );
  const id = Number(inserted.lastInsertRowid);
  require('./drip-domain').initialize(id,q.drip);
  db.prepare(
    "INSERT INTO transactions(user_id,type,amount_cents,balance_after_cents,reference_id,description) VALUES(?,'order_debit',?,?,?,?)"
  ).run(
    userId,
    -q.charge_cents,
    balance,
    uuid,
    'Pedido #' + id + ' - ' + q.service.name
  );
  if (q.coupon) {
    const used = db
      .prepare(
        'UPDATE coupons SET uses_count=uses_count+1 WHERE id=? AND (max_uses=0 OR uses_count<max_uses)'
      )
      .run(q.coupon.id);
    if (!used.changes) throw error('Cupom esgotado.', 409);
    db.prepare(
      'INSERT INTO coupon_uses(coupon_id,user_id,order_id,discount_cents) VALUES(?,?,?,?)'
    ).run(q.coupon.id, userId, id, q.discount_cents);
  }
  db.prepare(
    "INSERT INTO order_events(order_id,event_type,payload_json) VALUES(?,'status.pending',?)"
  ).run(id, JSON.stringify({ charge_cents: q.charge_cents }));
  if (q.ambassador) {
    db.prepare(
      'UPDATE ambassador_coupons SET uses_count=uses_count+1 WHERE id=?'
    ).run(q.ambassador.id);
    if (q.commission > 0)
      db.prepare(
        'INSERT INTO ambassador_order_commissions(order_id,ambassador_id,amount_cents,settles_at) VALUES(?,?,?,?)'
      ).run(
        id,
        q.ambassador.id,
        q.commission,
        new Date(Date.now() + 30 * 86400000).toISOString()
      );
  }
  require('./metrics').inc('orders_created_total');
  return { ...q, id, uuid, new_balance_cents: balance };
}
function placeOrder(userId, input) {
  return tx(() => insertOrder(userId, input));
}
function placeBatch(userId, inputs) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100)
    throw error('Lote inválido.');
  return tx(() => inputs.map((input) => insertOrder(userId, input)));
}
module.exports = { quoteOrder, placeOrder, placeBatch, insertOrder };
