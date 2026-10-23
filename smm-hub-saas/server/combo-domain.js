const crypto = require('node:crypto');
const { db, tx } = require('./db');
const { quoteOrder, insertOrder } = require('./order-domain');
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
function definition(input) {
  if (
    !input ||
    typeof input.name !== 'string' ||
    input.name.trim().length < 2 ||
    input.name.length > 120 ||
    typeof (input.description ?? '') !== 'string' ||
    (input.description || '').length > 2000 ||
    !Number.isSafeInteger(input.price_cents) ||
    input.price_cents < 50 ||
    input.price_cents > 100000000
  )
    fail('Nome, descrição ou preço do combo inválido.');
  const items = itemsFor({ items_json: JSON.stringify(input.items) }),
    pct = Number(
      db.prepare("SELECT value FROM settings WHERE key='cashback_pct'").get()
        ?.value ?? 3,
    );
  if (!Number.isFinite(pct) || pct < 0 || pct > 20)
    fail('Configuração de cashback inválida.', 409);
  const minimum = items.reduce((sum, item) => {
    const cost = db
      .prepare('SELECT cost_per_k_cents FROM services WHERE id=?')
      .get(item.service_id).cost_per_k_cents;
    return (
      sum +
      Math.max(
        50,
        Math.ceil(Math.round((cost * item.quantity) / 1000) / (1 - pct / 100)),
      )
    );
  }, 0);
  if (input.price_cents < minimum)
    fail('O preço do combo não cobre os serviços e os benefícios.');
  return {
    name: input.name.trim(),
    description: (input.description || '').trim(),
    items: items.map((item) => ({
      service_id: item.service_id,
      quantity: item.quantity,
    })),
    price_cents: input.price_cents,
    regular_cents: items.reduce((sum, item) => sum + item.regular_cents, 0),
  };
}
function itemsFor(combo) {
  let items;
  try {
    items = JSON.parse(combo.items_json);
  } catch {
    fail('Itens do combo inválidos.', 409);
  }
  if (!Array.isArray(items) || !items.length || items.length > 20)
    fail('Combo deve conter entre 1 e 20 itens.', 409);
  return items.map((item) => {
    if (
      !item ||
      !Number.isSafeInteger(Number(item.service_id)) ||
      !Number.isSafeInteger(Number(item.quantity))
    )
      fail('Item do combo inválido.', 409);
    const service = db
      .prepare(
        "SELECT id,name,platform,type,min_quantity,max_quantity,price_per_k_cents,cost_per_k_cents FROM services WHERE id=? AND status='active'",
      )
      .get(Number(item.service_id));
    const quantity = Number(item.quantity);
    if(service?.type==='custom_comments')fail('Serviços com comentários personalizados devem ser comprados individualmente.',409);
    if (
      !service ||
      quantity < service.min_quantity ||
      quantity > service.max_quantity
    )
      fail('Serviço ou quantidade do combo indisponível.', 409);
    return {
      service_id: service.id,
      quantity,
      service_name: service.name,
      platform: service.platform,
      regular_cents: Math.max(
        50,
        Math.round((service.price_per_k_cents * quantity) / 1000),
      ),
    };
  });
}
function list() {
  return db
    .prepare(
      'SELECT id,name,description,items_json,price_cents FROM combos WHERE is_active=1 ORDER BY id DESC LIMIT 100',
    )
    .all()
    .flatMap((combo) => {
      try {
        const items = itemsFor(combo);
        if (
          !Number.isSafeInteger(combo.price_cents) ||
          combo.price_cents < 50 * items.length
        )
          return [];
        return [
          {
            id: combo.id,
            name: combo.name,
            description: combo.description,
            price_cents: combo.price_cents,
            regular_cents: items.reduce(
              (sum, item) => sum + item.regular_cents,
              0,
            ),
            items: items.map(({ regular_cents, ...item }) => item),
          },
        ];
      } catch {
        return [];
      }
    });
}
function purchase(userId, comboId, input) {
  if (
    !input ||
    typeof input.request_id !== 'string' ||
    !/^[a-zA-Z0-9_-]{16,100}$/.test(input.request_id) ||
    !Array.isArray(input.links) ||
    input.links.length > 20 ||
    input.links.some((link) => typeof link !== 'string' || link.length > 2048)
  )
    fail('Identificador da compra e links são obrigatórios.');
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ comboId: Number(comboId), links: input.links }))
    .digest('hex');
  return tx(() => {
    const previous = db
      .prepare('SELECT * FROM combo_purchases WHERE user_id=? AND request_id=?')
      .get(userId, input.request_id);
    if (previous) {
      if (previous.payload_hash !== hash)
        fail('Identificador já utilizado em outra compra.', 409);
      return {
        order_ids: JSON.parse(previous.order_ids_json),
        charged_cents: previous.charge_cents,
        new_balance_cents: db
          .prepare('SELECT balance_cents FROM users WHERE id=?')
          .get(userId).balance_cents,
        repeated: true,
      };
    }
    const combo = db
      .prepare('SELECT * FROM combos WHERE id=? AND is_active=1')
      .get(comboId);
    if (!combo) fail('Combo não está disponível.', 404);
    const items = itemsFor(combo);
    if (input.links.length !== items.length)
      fail('Informe um link para cada item do combo.');
    const quotes = items.map((item, index) =>
      quoteOrder(userId, {
        service_id: item.service_id,
        quantity: item.quantity,
        link: input.links[index],
      }),
    );
    const pct = Number(
      db.prepare("SELECT value FROM settings WHERE key='cashback_pct'").get()
        ?.value ?? 3,
    );
    const minimums = quotes.map((quote) =>
      Math.max(50, Math.ceil(quote.cost_cents / (1 - pct / 100))),
    );
    const minimum = minimums.reduce((sum, value) => sum + value, 0);
    if (
      !Number.isSafeInteger(combo.price_cents) ||
      combo.price_cents > 100000000 ||
      combo.price_cents < minimum
    )
      fail(
        'Promoção temporariamente indisponível: preço precisa ser atualizado.',
        409,
      );
    const weight = quotes.reduce((sum, quote) => sum + quote.charge_cents, 0),
      surplus = combo.price_cents - minimum;
    const shares = quotes.map(
      (quote, index) =>
        minimums[index] + Math.floor((surplus * quote.charge_cents) / weight),
    );
    let remainder =
      combo.price_cents - shares.reduce((sum, value) => sum + value, 0);
    for (let index = 0; remainder > 0; index++, remainder--)
      shares[index % shares.length]++;
    const orders = items.map((item, index) =>
      insertOrder(
        userId,
        {
          service_id: item.service_id,
          quantity: item.quantity,
          link: input.links[index],
        },
        { charge_cents: shares[index] },
      ),
    );
    db.prepare(
      'INSERT INTO combo_purchases(id,user_id,combo_id,request_id,payload_hash,order_ids_json,charge_cents) VALUES(?,?,?,?,?,?,?)',
    ).run(
      crypto.randomUUID(),
      userId,
      combo.id,
      input.request_id,
      hash,
      JSON.stringify(orders.map((order) => order.id)),
      combo.price_cents,
    );
    return {
      order_ids: orders.map((order) => order.id),
      charged_cents: combo.price_cents,
      new_balance_cents: orders.at(-1).new_balance_cents,
      repeated: false,
    };
  });
}
module.exports = { itemsFor, list, purchase, definition };
