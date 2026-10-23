const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/categories', (req, res) => {
  res.json({
    categories: db
      .prepare('SELECT * FROM categories ORDER BY sort_order ASC')
      .all(),
  });
});

/** Network status real — agrega por platform usando dados dos providers e ordens. */
router.get('/network-status', (req, res) => {
  const platforms = db
    .prepare(
      `
    SELECT platform, COUNT(*) as service_count,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
    FROM services GROUP BY platform
  `
    )
    .all();

  const providerHealth = db
    .prepare(
      `
    SELECT COUNT(*) AS real_count, AVG(last_ping_ms) as avg_ping, SUM(CASE WHEN last_ping_ms IS NULL OR last_ping_ms > 10000 THEN 1 ELSE 0 END) as degraded
    FROM providers WHERE status = 'active' AND is_mock = 0
  `
    )
    .get();

  const metadata = {
    instagram: {
      name: 'Instagram',
      icon: 'fa-brands fa-instagram',
      badge: 'Alta Velocidade',
    },
    tiktok: {
      name: 'TikTok',
      icon: 'fa-brands fa-tiktok',
      badge: 'FYP Otimizado',
    },
    youtube: {
      name: 'YouTube',
      icon: 'fa-brands fa-youtube',
      badge: 'Vídeos e canais',
    },
    telegram: {
      name: 'Telegram',
      icon: 'fa-brands fa-telegram',
      badge: 'Entrega Contínua',
    },
    spotify: { name: 'Spotify', icon: 'fa-brands fa-spotify', badge: 'Música' },
    deezer: { name: 'Deezer', icon: 'fa-solid fa-music', badge: 'Streams HQ' },
    soundcloud: {
      name: 'SoundCloud',
      icon: 'fa-brands fa-soundcloud',
      badge: 'DJs & Produtores',
    },
    linkedin: {
      name: 'LinkedIn',
      icon: 'fa-brands fa-linkedin',
      badge: 'B2B Orgânico',
    },
    reddit: {
      name: 'Reddit',
      icon: 'fa-brands fa-reddit-alien',
      badge: 'Comunidade',
    },
    discord: { name: 'Discord', icon: 'fa-brands fa-discord', badge: 'Gamers' },
    twitch: { name: 'Twitch', icon: 'fa-brands fa-twitch', badge: 'Afiliado' },
    kick: { name: 'Kick', icon: 'fa-solid fa-video', badge: 'Live Streams' },
    twitter: {
      name: 'X / Twitter',
      icon: 'fa-brands fa-x-twitter',
      badge: 'Trending',
    },
    threads: { name: 'Threads', icon: 'fa-solid fa-at', badge: 'Crescimento' },
    facebook: {
      name: 'Facebook',
      icon: 'fa-brands fa-facebook',
      badge: 'Empresarial',
    },
    pinterest: {
      name: 'Pinterest',
      icon: 'fa-brands fa-pinterest',
      badge: 'Conversão',
    },
    kwai: { name: 'Kwai', icon: 'fa-solid fa-play', badge: 'Viral BR' },
    trafego: {
      name: 'Tráfego Web',
      icon: 'fa-solid fa-globe',
      badge: 'SEO Booster',
    },
  };

  const networks = platforms.map((p) => {
    const meta = metadata[p.platform] || {
      name: p.platform,
      icon: 'fa-solid fa-globe',
      badge: '',
    };
    const operational =
      p.active_count > 0 &&
      providerHealth.real_count > 0 &&
      (providerHealth.degraded || 0) === 0;
    return {
      platform: p.platform,
      name: meta.name,
      icon: meta.icon,
      status: operational
        ? 'operational'
        : p.active_count > 0
          ? 'degraded'
          : 'offline',
      service_count: p.service_count,
      badge: meta.badge,
    };
  });

  res.json({
    networks,
    upstream_latency_ms: Math.round(providerHealth.avg_ping || 0),
  });
});

router.get('/export-csv', (req, res) => {
  const services = db
    .prepare(
      `
    SELECT s.id, c.name as category, s.name, s.platform,
           (CAST(s.price_per_k_cents AS REAL) / 100.0) as rate_brl,
           s.min_quantity, s.max_quantity, s.refill_available, s.avg_time
    FROM services s JOIN categories c ON s.category_id = c.id
    WHERE s.status = 'active' ORDER BY c.sort_order ASC, s.id ASC
  `
    )
    .all();
  let csv =
    '﻿ID;Categoria;Serviço;Plataforma;Preço por 1.000 (R$);Mínimo;Máximo;Garantia;Tempo Médio\n';
  services.forEach((s) => {
    csv += `${s.id};"${s.category}";"${s.name}";"${s.platform}";${s.rate_brl.toFixed(2).replace('.', ',')};${s.min_quantity};${s.max_quantity};"${s.refill_available ? 'Sim' : 'Não'}";"${s.avg_time || ''}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="smmhub_catalogo_servicos.csv"'
  );
  res.send(csv);
});

router.get('/', (req, res) => {
  const { category_id, platform, search } = req.query;
  let q = `
    SELECT s.id, s.category_id, s.name, s.platform, s.type,
           s.price_per_k_cents, s.min_quantity, s.max_quantity,
           s.refill_available, s.cancel_available, s.dripfeed_available, s.avg_time, s.description,
           c.name as category_name, c.icon as category_icon,
           COALESCE((SELECT AVG(rating) FROM order_reviews r JOIN orders o ON r.order_id = o.id WHERE o.service_id = s.id), 5.0) as avg_rating,
           (SELECT COUNT(*) FROM order_reviews r JOIN orders o ON r.order_id = o.id WHERE o.service_id = s.id) as review_count
    FROM services s JOIN categories c ON s.category_id = c.id
    WHERE s.status = 'active'`;
  const params = [];
  if (category_id) {
    q += ' AND s.category_id = ?';
    params.push(category_id);
  } else if (platform) {
    q += ' AND s.platform = ?';
    params.push(platform);
  }
  if (search) {
    q += ' AND s.name LIKE ?';
    params.push(`%${search}%`);
  }
  q += ' ORDER BY c.sort_order ASC, s.id ASC';
  const { unstable } = require('../order-notices');
  const services = db.prepare(q.replace(
    's.refill_available, s.cancel_available, s.dripfeed_available, s.avg_time, s.description,',
    `s.refill_available, s.cancel_available, s.dripfeed_available, s.avg_time, s.description,
           (SELECT COUNT(*) FROM orders o WHERE o.service_id=s.id AND datetime(o.created_at)>=datetime('now','-7 days')) AS recent_orders,
           (SELECT COUNT(*) FROM orders o WHERE o.service_id=s.id AND o.status='failed' AND datetime(o.created_at)>=datetime('now','-7 days')) AS failed_recent,`
  )).all(...params).map((row) => ({
    ...row,
    unstable: unstable(row.recent_orders, row.failed_recent) ? 1 : 0,
  }));
  res.json({ services });
});

router.get('/favorites', requireAuth, (req, res) => {
  const favs = db
    .prepare(
      `SELECT s.id,s.name,s.platform,s.price_per_k_cents,s.min_quantity,s.max_quantity FROM service_favorites f
    JOIN services s ON f.service_id = s.id WHERE f.user_id = ? ORDER BY s.name ASC`
    )
    .all(req.user.id);
  res.json({ favorites: favs });
});

router.post('/:id/favorite', requireAuth, (req, res) => {
  const sId = req.params.id;
  const existing = db
    .prepare(
      'SELECT * FROM service_favorites WHERE user_id = ? AND service_id = ?'
    )
    .get(req.user.id, sId);
  if (existing) {
    db.prepare(
      'DELETE FROM service_favorites WHERE user_id = ? AND service_id = ?'
    ).run(req.user.id, sId);
    return res.json({ favorited: false, message: 'Removido dos favoritos.' });
  }
  db.prepare(
    'INSERT INTO service_favorites (user_id, service_id) VALUES (?, ?)'
  ).run(req.user.id, sId);
  res.json({ favorited: true, message: 'Favoritado!' });
});

module.exports = router;
