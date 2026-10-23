const { db, debitBalanceAtomic, tx } = require('../db');
const { dispatchOrder } = require('../smm-engine');
const config = require('../config');
const logger = require('../logger');
const crypto = require('node:crypto');

/**
 * Worker de assinaturas de auto-engajamento.
 * Para integração real: configure INSTAGRAM_GRAPH_TOKEN ou RAPIDAPI_KEY.
 * Sem credenciais, worker fica dormente (não cria pedidos fake).
 */

async function fetchLatestPostForInstagram(username,userId) {
  const connection=require('../social-connections').connection(userId,username);
  if (!connection) return null;
  // Instagram Graph API: /{ig-user-id}/media (necessita Business Account autorizado)
  // Stub: a integração real exige user_id autorizado + token válido
  try {
    const headers = {
      Authorization: 'Bearer ' + connection.token,
    };
    const identity = await fetch(
      'https://graph.instagram.com/me?fields=user_id,username',
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!identity.ok) return null;
    const profile = await identity.json();
    if (String(profile.username).toLowerCase() !== username.toLowerCase())
      return null;
    const url =
      'https://graph.instagram.com/me/media?fields=id,permalink,timestamp';
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    const first = data.data?.[0];
    return first
      ? { postId: first.id, link: first.permalink, timestamp: first.timestamp }
      : null;
  } catch (err) {
    logger.warn(
      { err: err.message, username },
      'Falha ao buscar últimas publicações IG'
    );
    return null;
  }
}

async function fetchLatestPostForTikTok(username) {
  if (!config.social.rapidapiKey) return null;
  try {
    const url = `https://tiktok-api23.p.rapidapi.com/api/user/posts?unique_id=${encodeURIComponent(username)}&count=1`;
    const r = await fetch(url, {
      headers: {
        'x-rapidapi-key': config.social.rapidapiKey,
        'x-rapidapi-host': 'tiktok-api23.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const first = data.data?.itemList?.[0];
    return first
      ? {
          postId: first.id,
          link: `https://www.tiktok.com/@${username}/video/${first.id}`,
          timestamp: first.createTime,
        }
      : null;
  } catch (err) {
    logger.warn(
      { err: err.message, username },
      'Falha ao buscar últimos vídeos TikTok'
    );
    return null;
  }
}

async function tick() {
  if (!db.prepare('SELECT user_id FROM social_connections LIMIT 1').get() && !config.social.rapidapiKey) return;

  const subs = db
    .prepare(
      `
    SELECT sub.*, s.platform, s.provider_id, s.price_per_k_cents, s.cost_per_k_cents, s.min_quantity AS service_min_quantity, s.max_quantity AS service_max_quantity
    FROM subscriptions sub JOIN services s ON sub.service_id = s.id
    WHERE sub.status = 'active' AND s.status='active' AND sub.posts_delivered < sub.posts_limit ORDER BY sub.updated_at ASC
    LIMIT 50
  `
    )
    .all();

  for (const sub of subs) {
    try {
      if (require('../automation-domain').isUserOnVacation(sub.user_id))
        continue;
      db.prepare(
        'UPDATE subscriptions SET updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).run(sub.id);
      let latest = null;
      if (sub.platform === 'instagram')
        latest = await fetchLatestPostForInstagram(sub.username,sub.user_id);
      else if (sub.platform === 'tiktok')
        latest = await fetchLatestPostForTikTok(sub.username);
      if (!latest || !latest.postId) continue;
      if (sub.last_checked_post_id === latest.postId) continue;

      const posted =
        typeof latest.timestamp === 'number'
          ? latest.timestamp * 1000
          : Date.parse(latest.timestamp);
      if (
        !Number.isFinite(posted) ||
        posted < Date.parse(sub.created_at.includes('T')?sub.created_at:sub.created_at.replace(' ','T')+'Z') ||
        Date.now() < posted + sub.delay_minutes * 60000
      )
        continue;
      // Publicação elegível
      const qty = Math.max(
        sub.min_quantity,
        Math.min(
          sub.max_quantity,
          Math.floor((sub.min_quantity + sub.max_quantity) / 2)
        )
      );
      const result = tx(() => {
        const current = db
          .prepare("SELECT * FROM subscriptions WHERE id=? AND status='active'")
          .get(sub.id);
        if (
          !current ||
          current.last_checked_post_id === String(latest.postId) ||
          current.posts_delivered >= current.posts_limit
        )
          return {};
        const claimed = db
          .prepare(
            "INSERT OR IGNORE INTO automation_runs(kind,config_id,period) VALUES('subscription',?,?)"
          )
          .run(sub.id, String(latest.postId));
        if (!claimed.changes) return {};
        const order = require('../order-domain').insertOrder(sub.user_id, {
          service_id: sub.service_id,
          quantity: qty,
          link: latest.link,
        });
        db.prepare(
          'UPDATE subscriptions SET last_checked_post_id=?,posts_delivered=posts_delivered+1,updated_at=CURRENT_TIMESTAMP WHERE id=?'
        ).run(String(latest.postId), sub.id);
        return { oId: order.id };
      });

      if (result.oId) {
        require('../order-notices').touch(result.oId);
        dispatchOrder(result.oId).catch(() => {});
      }
    } catch (err) {
      try {
        require('../ops-desk').logSubscription(sub.id, err.message);
      } catch {}
      logger.error(
        { subId: sub.id, err: err.message },
        'Subscription tick falhou'
      );
    }
  }
}

function startSubscriptionWorker() {
  // A cada 10 minutos
  return require('../worker-lease').startLeased(
    'social-subscriptions',
    tick,
    10 * 60 * 1000
  );
}

module.exports = { startSubscriptionWorker, tick };
