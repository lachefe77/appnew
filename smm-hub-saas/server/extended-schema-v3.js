const { db } = require('./db');

function applyV3Schema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dynamic_pricing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER REFERENCES services(id),
      platform TEXT,
      day_of_week INTEGER,
      hour_from INTEGER,
      hour_to INTEGER,
      multiplier REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scheduled_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      service_id INTEGER NOT NULL REFERENCES services(id),
      link TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      run_at DATETIME NOT NULL,
      status TEXT DEFAULT 'pending',
      order_id INTEGER REFERENCES orders(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS autopilot_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      budget_monthly_cents INTEGER NOT NULL,
      allocation_json TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_run_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_streaks (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      current_streak INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      last_login_date TEXT,
      total_logins INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      prize_cents INTEGER NOT NULL,
      min_deposit_cents INTEGER DEFAULT 0,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NOT NULL,
      winner_user_id INTEGER REFERENCES users(id),
      drawn_at DATETIME,
      status TEXT DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS giveaway_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      giveaway_id INTEGER NOT NULL REFERENCES giveaways(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      entries INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(giveaway_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      target_type TEXT NOT NULL,
      target_value INTEGER NOT NULL,
      prize_pool_cents INTEGER NOT NULL,
      month TEXT NOT NULL,
      status TEXT DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS order_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      service_id INTEGER NOT NULL REFERENCES services(id),
      quantity INTEGER NOT NULL,
      is_public INTEGER DEFAULT 0,
      uses_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS combos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      items_json TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      regular_cents INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS utm_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      visitor_id TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      converted INTEGER DEFAULT 0,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      converted_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      parent_org_id INTEGER REFERENCES organizations(id),
      cnpj TEXT,
      billing_email TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      role TEXT DEFAULT 'member',
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invoices_nf (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      org_id INTEGER REFERENCES organizations(id),
      cnpj TEXT,
      razao_social TEXT,
      amount_cents INTEGER NOT NULL,
      period_start TEXT,
      period_end TEXT,
      pdf_url TEXT,
      nfse_number TEXT,
      status TEXT DEFAULT 'pending',
      issued_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recurring_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      interval_days INTEGER DEFAULT 30,
      next_run DATETIME NOT NULL,
      allocation_json TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_payload_json TEXT NOT NULL,
      requester_user_id INTEGER NOT NULL REFERENCES users(id),
      approver_user_id INTEGER REFERENCES users(id),
      amount_cents INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS sla_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      max_start_minutes INTEGER DEFAULT 60,
      max_delivery_hours INTEGER DEFAULT 24,
      refund_pct_on_breach INTEGER DEFAULT 100,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS supplier_portal (
      provider_id INTEGER PRIMARY KEY REFERENCES providers(id),
      portal_user TEXT UNIQUE,
      portal_password_hash TEXT,
      portal_salt TEXT,
      enabled INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS press_kit_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT UNIQUE,
      total_delivered BIGINT DEFAULT 0,
      total_users INTEGER DEFAULT 0,
      total_countries INTEGER DEFAULT 15,
      satisfaction_pct REAL DEFAULT 98.5,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      event_type TEXT NOT NULL,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS link_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_hash TEXT UNIQUE,
      link TEXT NOT NULL,
      score INTEGER DEFAULT 50,
      factors_json TEXT,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payment_methods_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT UNIQUE NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      icon TEXT,
      label TEXT,
      description TEXT,
      min_amount_cents INTEGER DEFAULT 500,
      max_amount_cents INTEGER DEFAULT 1000000
    );

    CREATE TABLE IF NOT EXISTS platforms_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      display_order INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      endpoint TEXT NOT NULL,
      keys_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, endpoint)
    );

    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES ticket_messages(id),
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      size_bytes INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vacation_mode (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NOT NULL,
      reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sched_runat ON scheduled_orders(run_at, status);
    CREATE INDEX IF NOT EXISTS idx_streak_user ON daily_streaks(user_id);
    CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, id);
    CREATE INDEX IF NOT EXISTS idx_scores_hash ON link_scores(link_hash);
  `);

  seedV3Defaults();
}

function seedV3Defaults() {
  const upsertPM = db.prepare(`INSERT OR IGNORE INTO payment_methods_config (method, display_order, icon, label, description, min_amount_cents, max_amount_cents) VALUES (?,?,?,?,?,?,?)`);
  upsertPM.run('pix', 1, 'fa-solid fa-bolt', 'Pix Instantâneo', 'Cai em segundos. Sem taxa.', 500, 1000000);
  upsertPM.run('bitcoin', 2, 'fa-brands fa-bitcoin', 'Bitcoin', 'Pagamento anônimo em cripto.', 2500, 10000000);
  upsertPM.run('usdt', 3, 'fa-solid fa-coins', 'USDT (TRC20/BEP20)', 'Stablecoin — valor fixo em dólar.', 2500, 10000000);
  upsertPM.run('boleto', 4, 'fa-solid fa-barcode', 'Boleto Bancário', 'Compensação em 1 a 3 dias úteis.', 1500, 1000000);
  upsertPM.run('credit_card', 5, 'fa-solid fa-credit-card', 'Cartão de Crédito', 'Visa, Master, Elo, Amex. Até 12x.', 500, 500000);

  const upsertPlat = db.prepare(`INSERT OR IGNORE INTO platforms_config (slug, name, icon, color, display_order, description) VALUES (?,?,?,?,?,?)`);
  const plats = [
    ['instagram', 'Instagram', 'fa-brands fa-instagram', '#E1306C', 1, 'Seguidores, curtidas, Reels, Stories, Lives e muito mais.'],
    ['tiktok', 'TikTok', 'fa-brands fa-tiktok', '#010101', 2, 'FYP viral, visualizações relâmpago, seguidores brasileiros.'],
    ['youtube', 'YouTube', 'fa-brands fa-youtube', '#FF0000', 3, 'Inscritos reais, 4.000 horas de retenção, likes e comentários.'],
    ['telegram', 'Telegram', 'fa-brands fa-telegram', '#0088cc', 4, 'Membros para canais e grupos, reações, visualizações de post.'],
    ['spotify', 'Spotify', 'fa-brands fa-spotify', '#1DB954', 5, 'Streams brasileiros válidos para royalties, seguidores, saves.'],
    ['twitter', 'X / Twitter', 'fa-brands fa-x-twitter', '#000', 6, 'Seguidores, retweets, likes e impressões em trending topics.'],
    ['facebook', 'Facebook', 'fa-brands fa-facebook', '#1877F2', 7, 'Páginas, curtidas, compartilhamentos e seguidores em perfis.'],
    ['linkedin', 'LinkedIn', 'fa-brands fa-linkedin', '#0A66C2', 8, 'Conexões, seguidores em perfis executivos, endossos.'],
    ['twitch', 'Twitch', 'fa-brands fa-twitch', '#9146FF', 9, 'Live viewers, followers, chatters ativos para afiliado/parceiro.'],
    ['kwai', 'Kwai', 'fa-solid fa-play', '#FF4040', 10, 'Visualizações rápidas, seguidores e curtidas na rede chinesa.'],
    ['discord', 'Discord', 'fa-brands fa-discord', '#5865F2', 11, 'Membros online e offline para servidores de gaming e crypto.'],
    ['threads', 'Threads', 'fa-solid fa-at', '#000', 12, 'Seguidores e curtidas na rede da Meta com alcance orgânico.'],
    ['pinterest', 'Pinterest', 'fa-brands fa-pinterest', '#BD081C', 13, 'Pins, repins e seguidores para e-commerce e conversão.'],
    ['reddit', 'Reddit', 'fa-brands fa-reddit-alien', '#FF4500', 14, 'Upvotes, karma e tráfego para subreddits top.'],
    ['soundcloud', 'SoundCloud', 'fa-brands fa-soundcloud', '#FF8800', 15, 'Plays monetizáveis para DJs e produtores independentes.'],
    ['kick', 'Kick', 'fa-solid fa-video', '#53FC18', 16, 'Visualizações ao vivo e seguidores para streamers.']
  ];
  for (const p of plats) upsertPlat.run(...p);

  const upsertSC = db.prepare(`INSERT OR IGNORE INTO site_content (key, value) VALUES (?, ?)`);
  const defaults = {
    'hero.headline': 'Métricas sociais sem enrolação.',
    'hero.subhead': 'A plataforma brasileira de performance em redes sociais usada por 40 mil criadores. Pix cai, pedido entra, resultado aparece. Fim.',
    'hero.cta_primary': 'Começar agora',
    'hero.cta_secondary': 'Ver todos os serviços',
    'company.name': 'SMM Hub Brasil',
    'company.email': 'contato@smmhub.com.br',
    'company.whatsapp': '55 11 99999-0000',
    'company.cnpj': '00.000.000/0001-00',
    'social.instagram': 'https://instagram.com/smmhub',
    'social.telegram': 'https://t.me/smmhub',
    'legal.terms_url': '/terms.html',
    'legal.privacy_url': '/privacy.html',
    'stats.delivered_total': '2.8 bilhões',
    'stats.active_clients': '41.300',
    'stats.uptime': '99,97%',
    'stats.avg_start_seconds': '48'
  };
  for (const [k, v] of Object.entries(defaults)) upsertSC.run(k, v);

  const pks = db.prepare('SELECT COUNT(*) as c FROM press_kit_stats').get().c;
  if (pks === 0) {
    db.prepare(`INSERT INTO press_kit_stats (snapshot_date, total_delivered, total_users, total_countries, satisfaction_pct) VALUES (?,?,?,?,?)`)
      .run(new Date().toISOString().split('T')[0], 2800000000, 41300, 18, 98.5);
  }
}

module.exports = { applyV3Schema };
