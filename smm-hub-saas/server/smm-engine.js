const crypto = require('node:crypto');
const { db, creditBalanceAtomic, recalcTier, tx } = require('./db');
const config = require('./config');
const logger = require('./logger');
const { postWebhook } = require('./webhook-http');
function runInterval(name, fn, ms) {
  return require('./worker-lease').startLeased(name, fn, ms);
}

async function fetchCurrentUSDBRL() {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL', {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    if (data && data.USDBRL && data.USDBRL.bid) {
      const rate = parseFloat(data.USDBRL.bid);
      db.prepare(
        "UPDATE settings SET value = ? WHERE key = 'current_usd_brl'"
      ).run(String(rate.toFixed(2)));
      return rate;
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Falha ao buscar cotação USD-BRL');
  }
  const setting = db
    .prepare("SELECT value FROM settings WHERE key = 'current_usd_brl'")
    .get();
  return setting ? parseFloat(setting.value) : 5.6;
}

async function handleOrderCompleted(orderId) {
  try {
    return tx(() => {
      const order = db
        .prepare(
          `
      SELECT o.*, u.name as user_name, s.name as service_name, s.platform
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN services s ON o.service_id = s.id
      WHERE o.id = ?
    `
        )
        .get(orderId);
      if (!order || order.status !== 'completed') return;
      const claimed = db
        .prepare(
          "INSERT OR IGNORE INTO order_effects(order_id,effect) VALUES(?,'completed')"
        )
        .run(order.id);
      if (!claimed.changes) return;
      const commission = db
        .prepare(
          "SELECT order_id FROM ambassador_order_commissions WHERE order_id=? AND status='pending'"
        )
        .get(order.id);
      if (commission) {
        const settles = new Date(Date.now() + 30 * 86400000).toISOString();
        db.prepare(
          'UPDATE ambassador_order_commissions SET settles_at=? WHERE order_id=?'
        ).run(settles, order.id);
        require('./job-queue').enqueue(
          'settle-ambassador',
          { orderId: order.id },
          { id: 'ambassador:' + order.id, delay: 30 * 86400000 }
        );
      }
      require('./metrics').inc('orders_completed_total');

      const cashbackPctSetting = db
        .prepare("SELECT value FROM settings WHERE key='cashback_pct'")
        .get();
      const cashbackPct = Math.max(
        0,
        Math.min(
          20,
          cashbackPctSetting
            ? Number(cashbackPctSetting.value)
            : config.affiliate.cashbackPct
        )
      );
      const refunds = db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents),0) AS n FROM transactions WHERE type='order_refund' AND reference_id=?"
        )
        .get(order.uuid).n;
      const cashbackCents = Math.round(
        Math.max(0, order.charge_cents - refunds) * (cashbackPct / 100)
      );

      if (cashbackCents > 0) {
        {
          const newBal = creditBalanceAtomic(order.user_id, cashbackCents);
          db.prepare(
            'UPDATE users SET cashback_cents = COALESCE(cashback_cents,0) + ? WHERE id = ?'
          ).run(cashbackCents, order.user_id);
          db.prepare(
            `
          INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, reference_id, description)
          VALUES (?, 'cashback', ?, ?, ?, ?)
        `
          ).run(
            order.user_id,
            cashbackCents,
            newBal,
            order.uuid,
            `Cashback ${cashbackPct}% do pedido #${order.id} (+R$ ${(cashbackCents / 100).toFixed(2).replace('.', ',')})`
          );
        }
      }

      // Enfileira webhooks (dispatch tratado por worker)
      const webhooks = db
        .prepare(
          `SELECT id FROM client_webhooks WHERE user_id = ? AND is_active = 1`
        )
        .all(order.user_id);
      for (const wh of webhooks) {
        enqueueWebhookDelivery(wh.id, 'order.completed', {
          event: 'order.completed',
          order: {
            id: order.id,
            uuid: order.uuid,
            link: order.link,
            quantity: order.quantity,
            status: 'completed',
            completed_at: new Date().toISOString(),
          },
        });
      }

      // Social proof real
      const allowSyn = db
        .prepare("SELECT value FROM settings WHERE key='allow_synthetic_proof'")
        .get();
      if (!allowSyn || allowSyn.value === '1' || allowSyn.value === '0') {
        const firstName = order.user_name
          ? order.user_name.split(' ')[0]
          : 'Cliente';
        db.prepare(
          `
        INSERT INTO social_proof_events (user_name, city, service_name, platform, quantity, time_ago, is_synthetic)
        VALUES (?, 'Brasil', ?, ?, ?, 'agora mesmo', 0)
      `
        ).run(
          `${firstName} ***`,
          order.service_name,
          order.platform,
          order.quantity
        );
      }
    });
  } catch (err) {
    logger.error(
      { err: err.message, orderId },
      'Handler de order completed falhou'
    );
  }
}

function enqueueWebhookDelivery(webhookId, event, payload) {
  db.prepare(
    `
    INSERT INTO webhook_deliveries (webhook_id, event, payload, attempt, next_retry_at)
    VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
  `
  ).run(webhookId, event, JSON.stringify(payload));
}

async function dispatchOrder(orderId) {
  const order = db
    .prepare(
      `
    SELECT o.*, s.provider_service_id, s.backup_provider_id, s.backup_service_id, s.type as service_type,
           p.id as prov_id, p.name as prov_name, p.api_url, p.api_key, p.is_mock, p.balance_upstream, p.exchange_rate
    FROM orders o
    JOIN services s ON o.service_id = s.id
    JOIN providers p ON o.provider_id = p.id
    WHERE o.id = ?
  `
    )
    .get(orderId);

  if (!order) throw new Error(`Ordem #${orderId} não encontrada.`);
  if(!db.prepare("SELECT id FROM users WHERE id=? AND status='active' AND deleted_at IS NULL").get(order.user_id))return{success:false,status:order.status};

  const freezeSetting = db
    .prepare("SELECT value FROM settings WHERE key = 'freeze_mode'")
    .get();
  if (freezeSetting && freezeSetting.value === '1') {
    throw new Error(
      '🚨 Sistema em Modo de Emergência. Novos despachos foram pausados.'
    );
  }
  if (!require('./drip-domain').ready(order)) return {success:false,status:order.status};
  const claimed = db
    .prepare(
      "UPDATE orders SET status='dispatching',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND remote_order_id IS NULL"
    )
    .run(order.id);
  if (!claimed.changes)
    return {
      success: false,
      status: order.status,
      error: 'Pedido já reivindicado ou processado.',
    };

  const batchQty = order.is_dripfeed ? require('./drip-domain').current(order.id).quantity : order.quantity;

  if (order.is_mock) {
    const mockRemoteId = 'MOCK_' + Math.floor(100000 + Math.random() * 900000);
    const startCount = Math.floor(150 + Math.random() * 2500);
    const costUSD = (order.cost_cents * batchQty / order.quantity) / 100 / (order.exchange_rate || 5.6);
    const newProvBalance = Math.max(0, (order.balance_upstream || 0) - costUSD);

    db.prepare('UPDATE providers SET balance_upstream = ? WHERE id = ?').run(
      Number(newProvBalance.toFixed(2)),
      order.prov_id
    );
    db.prepare(
      `
      UPDATE orders
      SET remote_order_id = ?, start_count = ?, remains = ?,
          status = 'in_progress', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(mockRemoteId, startCount, order.is_dripfeed ? order.remains : batchQty, order.id);
    require('./drip-domain').accepted(order.id,mockRemoteId,order.prov_id);
    return {
      success: true,
      remote_order_id: mockRemoteId,
      status: 'in_progress',
    };
  }

  try {
    const params = new URLSearchParams();
    params.append('key', order.api_key);
    params.append('action', 'add');
    params.append(
      'service',
      order.failover_count > 0 && order.backup_service_id
        ? order.backup_service_id
        : order.provider_service_id
    );
    params.append('link', order.link);
    params.append('quantity', String(batchQty));
    if (order.comments_payload)
      params.append('comments', order.comments_payload);

    const t0 = Date.now();
    const response = await require('./provider-client').providerFetch(
      order.api_url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SMMHub-Platform/2.0',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(15000),
      }
    );
    const latency = Date.now() - t0;
    db.prepare(
      'UPDATE providers SET last_ping_ms = ?, last_checked_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(latency, order.prov_id);

    const data = await response.json();

    if (data.error) {
      logger.warn(
        { orderId: order.id, provider: order.prov_id, error: data.error },
        'Provedor primário rejeitou ordem'
      );
      if (order.backup_provider_id && order.failover_count === 0) {
        return await failoverToBackup(
          order.id,
          order.backup_provider_id,
          order.backup_service_id
        );
      }
      if(require('./drip-domain').reject(order.id)) return {success:false,error:data.error};
      db.prepare(
        `UPDATE orders SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(order.id);
      refundOrder(order.id);
      return { success: false, error: data.error };
    }

    if (data.order) {
      db.prepare(
        `
        UPDATE orders SET remote_order_id = ?, remains = ?, status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `
      ).run(String(data.order), order.is_dripfeed ? order.remains : batchQty, order.id);
      require('./drip-domain').accepted(order.id,String(data.order),order.prov_id);
      return {
        success: true,
        remote_order_id: String(data.order),
        status: 'processing',
      };
    }

    throw new Error(
      'Resposta inesperada da matriz upstream: ' + JSON.stringify(data)
    );
  } catch (err) {
    logger.error(
      { orderId: order.id, provider: order.prov_id, err: err.message },
      'Falha de rede no provedor'
    );
    db.prepare(
      `UPDATE orders SET status = 'awaiting_confirmation', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(order.id);
    return { success: false, error: err.message };
  }
}

async function failoverToBackup(orderId, backupProvId, backupServiceId) {
  const backupProv = db
    .prepare('SELECT * FROM providers WHERE id = ?')
    .get(backupProvId);
  if (!backupProv||backupProv.status!=='active'||backupServiceId==null||!String(backupServiceId).trim()){
    if(!require('./drip-domain').reject(orderId)){
      db.prepare("UPDATE orders SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(orderId);
      refundOrder(orderId);
    }
    return { success: false, error: 'Provedor ou serviço de backup indisponível.' };
  }

  db.prepare(
    `
    UPDATE orders SET provider_id = ?, failover_count = failover_count + 1, status='pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `
  ).run(backupProv.id, orderId);
  return await dispatchOrder(orderId);
}

async function requestRefill(orderId,batchRun) {
  const order = db
    .prepare(
      `
    SELECT o.*, p.is_mock, p.api_url, p.api_key, s.refill_available
    FROM orders o
    JOIN providers p ON o.provider_id = p.id
    JOIN services s ON o.service_id = s.id
    WHERE o.id = ?
  `
    )
    .get(orderId);

  if (!order || !order.refill_available)
    throw new Error('Reposição não disponível para esta ordem.');
  if(order.is_dripfeed){
    if(!Number.isSafeInteger(Number(batchRun))||Number(batchRun)<1)throw new Error('Informe o número do lote que precisa de reposição.');
    const batch=db.prepare("SELECT b.remote_id AS remote_order_id,b.completed_at AS updated_at,b.provider_id,p.api_url,p.api_key,p.is_mock FROM drip_batches b JOIN providers p ON p.id=b.provider_id WHERE b.order_id=? AND b.run=? AND b.status='completed'").get(order.id,Number(batchRun));
    if(!batch)throw new Error('Lote concluído não encontrado.');Object.assign(order,batch);
  }
  if (order.status !== 'completed' && order.status !== 'partial') {
    throw new Error(
      'Apenas ordens concluídas ou parciais podem solicitar reposição.'
    );
  }
  const completedAt = Date.parse(
    order.updated_at.includes('T')
      ? order.updated_at
      : order.updated_at.replace(' ', 'T') + 'Z'
  );
  if (!Number.isFinite(completedAt) || Date.now() - completedAt > 30 * 86400000)
    throw new Error('Janela de reposição encerrada.');
  const refill = tx(() => {
    const recent = db
      .prepare(
        "SELECT id FROM order_refills WHERE order_id=? AND batch_run IS ? AND (status IN ('requested','processing','awaiting_confirmation') OR datetime(created_at)>datetime('now','-1 day'))"
      )
      .get(order.id,order.is_dripfeed?Number(batchRun):null);
    if (recent)
      throw new Error(
        'Já existe reposição ativa ou solicitada nas últimas 24 horas.'
      );
    return Number(
      db.prepare('INSERT INTO order_refills(order_id,batch_run,provider_id) VALUES(?,?,?)').run(order.id,order.is_dripfeed?Number(batchRun):null,order.provider_id)
        .lastInsertRowid
    );
  });

  if (order.is_mock) {
    db.prepare(
      "UPDATE order_refills SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).run(refill);
    return {
      success: true,
      refill_id: refill,
      message: 'Reposição simulada em ambiente de demonstração.',
    };
  }

  const params = new URLSearchParams();
  params.append('key', order.api_key);
  params.append('action', 'refill');
  params.append('order', order.remote_order_id);

  try {
    const res = await require('./provider-client').providerFetch(
      order.api_url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      }
    );
    const data = await res.json();
    db.prepare(
      'UPDATE order_refills SET status=?,remote_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(
      data.error
        ? 'failed'
        : data.refill
          ? 'processing'
          : 'awaiting_confirmation',
      data.refill ? String(data.refill) : null,
      refill
    );
    return { success: !data.error, refill_id: refill, data };
  } catch (err) {
    db.prepare(
      "UPDATE order_refills SET status='awaiting_confirmation',updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).run(refill);
    throw new Error(
      'Resultado da reposição requer confirmação; não reenvie antes da conciliação.'
    );
  }
}

function refundOrder(orderId, isPartial = false, remainsQuantity = 0) {
  return tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return;

    let refundCents = order.charge_cents;
    if (isPartial) {
      if (
        !Number.isSafeInteger(remainsQuantity) ||
        remainsQuantity < 0 ||
        remainsQuantity > order.quantity
      )
        throw new Error('Quantidade restante inválida para estorno.');
      refundCents = Math.round(
        (order.charge_cents * remainsQuantity) / order.quantity
      );
    }
    const already = db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) AS amount FROM transactions WHERE type='order_refund' AND reference_id=?"
      )
      .get(order.uuid).amount;
    refundCents = Math.max(
      0,
      Math.min(order.charge_cents, refundCents) - already
    );
    if (refundCents <= 0) return;

    let newBalance = creditBalanceAtomic(order.user_id, refundCents);
    const cashbackRow = db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) AS n,MIN(id) AS first_id FROM transactions WHERE type='cashback' AND reference_id=?"
      )
      .get(order.uuid);
    const cashback = cashbackRow.n;
    const refundedBeforeCashback = cashbackRow.first_id
      ? db
          .prepare(
            "SELECT COALESCE(SUM(amount_cents),0) AS n FROM transactions WHERE type='order_refund' AND reference_id=? AND id<?"
          )
          .get(order.uuid, cashbackRow.first_id).n
      : 0;
    const cashbackBase = Math.max(
      1,
      order.charge_cents - refundedBeforeCashback
    );
    const reversed = -db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents),0) AS n FROM transactions WHERE type='cashback_reversal' AND reference_id=?"
      )
      .get(order.uuid).n;
    const reversal = Math.max(
      0,
      Math.round(
        (cashback *
          Math.max(0, already + refundCents - refundedBeforeCashback)) /
          cashbackBase
      ) - reversed
    );
    const creditedBalance = newBalance;
    if (reversal > 0) {
      const { debitBalanceAtomic } = require('./db');
      newBalance = debitBalanceAtomic(order.user_id, reversal);
      if (newBalance === null)
        throw new Error('Não foi possível conciliar cashback no estorno.');
    }

    db.prepare(
      `
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, reference_id, description)
      VALUES (?, 'order_refund', ?, ?, ?, ?)
    `
    ).run(
      order.user_id,
      refundCents,
      creditedBalance,
      order.uuid,
      `Reembolso ${isPartial ? 'parcial' : 'integral'} da ordem #${order.id} (R$ ${(refundCents / 100).toFixed(2)})`
    );
    if (reversal > 0)
      db.prepare(
        "INSERT INTO transactions(user_id,type,amount_cents,balance_after_cents,reference_id,description) VALUES(?,'cashback_reversal',?,?,?,'Reversão proporcional de cashback')"
      ).run(order.user_id, -reversal, newBalance, order.uuid);
  });
}

/* ========= Worker loop (progresso + webhook retry) ========= */

function startOrderProgressWorker() {
  runInterval(
    'order-progress',
    async () => {
      try {
        const activeOrders = db
          .prepare(
            `
        SELECT o.*, p.is_mock, p.api_url, p.api_key
        FROM orders o
        JOIN providers p ON o.provider_id = p.id
        WHERE (o.status IN ('pending', 'processing', 'in_progress') OR (o.status='awaiting_confirmation' AND o.remote_order_id IS NOT NULL))
        ORDER BY o.updated_at ASC, o.id ASC
        LIMIT 30
      `
          )
          .all();

        for (const ord of activeOrders) {
          db.prepare(
            'UPDATE orders SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?'
          ).run(ord.id, ord.status);
          if (ord.status === 'pending') {
            await dispatchOrder(ord.id).catch((e) =>
              logger.error(
                { orderId: ord.id, err: e.message },
                'dispatch falhou'
              )
            );
            continue;
          }

          if (ord.is_mock) {
            if (ord.status === 'in_progress') {
              const currentRemains = ord.is_dripfeed ? require('./drip-domain').current(ord.id)?.remains : ord.remains;
              if(currentRemains==null)continue;
              const step = Math.max(
                1,
                Math.floor(ord.quantity * (0.2 + Math.random() * 0.3))
              );
              const newRemains = Math.max(0, currentRemains - step);

              const result=require('./order-reconciliation').applyProviderStatus(ord.id,ord.remote_order_id,{status:newRemains===0?'completed':'in progress',remains:newRemains});
              if(result.status==='completed')await handleOrderCompleted(ord.id);
            }
            continue;
          }

          if (!ord.remote_order_id) continue;

          try {
            const params = new URLSearchParams();
            params.append('key', ord.api_key);
            params.append('action', 'status');
            params.append('order', ord.remote_order_id);

            const res = await require('./provider-client').providerFetch(
              ord.api_url,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params.toString(),
                signal: AbortSignal.timeout(10000),
              }
            );

            const data = await res.json();
            if (data && data.status) {
              const applied =
                require('./order-reconciliation').applyProviderStatus(
                  ord.id,
                  ord.remote_order_id,
                  data
                );
              if (applied.applied && applied.status === 'completed')
                await handleOrderCompleted(ord.id);
            }
          } catch (err) {
            logger.warn(
              { orderId: ord.id, err: err.message },
              'Status polling falhou'
            );
          }
        }
      } catch (globalErr) {
        logger.error({ err: globalErr.message }, 'Worker loop global error');
      }
    },
    6000
  );
}

/* ========= Webhook delivery worker (retry exponencial, HMAC) ========= */

function startWebhookDeliveryWorker() {
  runInterval(
    'webhook-delivery',
    async () => {
      try {
        const batch = db
          .prepare(
            `
        SELECT wd.*, w.url, w.secret, w.is_active
        FROM webhook_deliveries wd
        JOIN client_webhooks w ON wd.webhook_id = w.id
        WHERE wd.delivered_at IS NULL
          AND wd.attempt < 8
          AND (wd.next_retry_at IS NULL OR datetime(wd.next_retry_at) <= CURRENT_TIMESTAMP)
          AND w.is_active = 1
        LIMIT 25
      `
          )
          .all();

        for (const d of batch) {
          const nextAttempt = d.attempt + 1;
          const backoffMs = Math.min(60000, 2 ** d.attempt * 1000);
          try {
            const bodyStr = d.payload;
            const sig = crypto
              .createHmac('sha256', require('./factor-secret').open(d.secret))
              .update(bodyStr)
              .digest('hex');
            const res = await postWebhook(d.url, bodyStr, {
              'Content-Type': 'application/json',
              'X-SMMHub-Signature': `sha256=${sig}`,
              'X-SMMHub-Event': d.event,
              'X-SMMHub-Delivery-Id': String(d.id),
            });

            if (res.ok) {
              db.prepare(
                `UPDATE webhook_deliveries SET delivered_at = CURRENT_TIMESTAMP, attempt = ?, response_status = ? WHERE id = ?`
              ).run(nextAttempt, res.status, d.id);
            } else {
              const nextRetry = new Date(Date.now() + backoffMs).toISOString();
              db.prepare(
                `UPDATE webhook_deliveries SET attempt = ?, response_status = ?, next_retry_at = ? WHERE id = ?`
              ).run(nextAttempt, res.status, nextRetry, d.id);
            }
          } catch (err) {
            const nextRetry = new Date(Date.now() + backoffMs).toISOString();
            db.prepare(
              `UPDATE webhook_deliveries SET attempt = ?, next_retry_at = ? WHERE id = ?`
            ).run(nextAttempt, nextRetry, d.id);
          }
        }
      } catch (err) {
        logger.error({ err: err.message }, 'Webhook worker falhou');
      }
    },
    10000
  );
}

module.exports = {
  dispatchOrder,
  requestRefill,
  refundOrder,
  startOrderProgressWorker,
  startWebhookDeliveryWorker,
  fetchCurrentUSDBRL,
  enqueueWebhookDelivery,
  handleOrderCompleted,
};
