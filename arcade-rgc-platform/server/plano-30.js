/**
 * Plano fliperama 30 — integridade, social, push, AML, friends, seasons calendar.
 */
import crypto from "node:crypto";
import db from "./db.js";
import { sendAlert } from "./alerts.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS device_fingerprints (
    user_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (user_id, fingerprint)
  );
  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );
  CREATE TABLE IF NOT EXISTS user_blocks (
    user_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, blocked_id)
  );
  CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    body TEXT NOT NULL,
    at INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT,
    auth TEXT,
    PRIMARY KEY (user_id, endpoint)
  );
  CREATE TABLE IF NOT EXISTS kyc_docs (
    user_id TEXT PRIMARY KEY,
    doc_type TEXT NOT NULL,
    doc_number TEXT,
    expires_at TEXT,
    photo_ref TEXT,
    status TEXT NOT NULL DEFAULT 'PENDENTE',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS season_calendar (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    rewards_json TEXT DEFAULT '[]',
    ceremony_note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS tournament_escrow (
    tournament_id TEXT PRIMARY KEY,
    pool_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN'
  );
  CREATE TABLE IF NOT EXISTS clan_treasury_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT NOT NULL,
    delta_cents INTEGER NOT NULL,
    reason TEXT,
    at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS input_anomaly_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    match_id TEXT,
    score REAL NOT NULL,
    detail TEXT,
    at INTEGER NOT NULL
  );
`);

/** 9 — detector simples de macro/burst */
export function scoreInputBurst(samples) {
  // samples: [{t, button}] últimos N
  if (!Array.isArray(samples) || samples.length < 8) {
    return { score: 0, flag: false, reason: null };
  }
  const gaps = [];
  for (let i = 1; i < samples.length; i++) {
    gaps.push(Math.max(0, samples[i].t - samples[i - 1].t));
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance =
    gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / Math.max(1, gaps.length);
  const std = Math.sqrt(variance);
  // Burst: muitos inputs em <80ms com baixa variância (macro)
  const burst = gaps.filter((g) => g < 80).length;
  const score =
    (burst / gaps.length) * 0.6 + (mean < 40 ? 0.3 : 0) + (std < 8 ? 0.2 : 0);
  const flag = score >= 0.75;
  return {
    score: Math.round(score * 100) / 100,
    flag,
    reason: flag ? "INPUT_BURST_MACRO_SUSPECT" : null,
  };
}

export function logAnomaly(userId, matchId, score, detail) {
  db.prepare(
    "INSERT INTO input_anomaly_log(user_id,match_id,score,detail,at) VALUES(?,?,?,?,?)",
  ).run(userId, matchId || null, score, detail || "", Date.now());
}

/** 10 — AML risk score heurístico */
export function computeAmlRisk(userId) {
  const w = db
    .prepare("SELECT balance, locked, total_deposit FROM wallets WHERE user_id=?")
    .get(userId) || { balance: 0, locked: 0, total_deposit: 0 };
  const txCount =
    db.prepare("SELECT COUNT(*) c FROM transactions WHERE user_id=?").get(userId)
      ?.c || 0;
  const fps =
    db
      .prepare("SELECT COUNT(*) c FROM device_fingerprints WHERE user_id=?")
      .get(userId)?.c || 0;
  const linked = countLinkedAccounts(userId);
  let score = 0;
  if (w.total_deposit > 500_000) score += 2;
  if (txCount > 80 && w.balance < 1000) score += 2;
  if (fps >= 4) score += 2;
  if (linked >= 2) score += 3;
  if (score >= 6) return { level: "CRÍTICO", score };
  if (score >= 3) return { level: "MÉDIO", score };
  return { level: "BAIXO", score };
}

/** 13 — anti multi-conta */
export function registerFingerprint(userId, fingerprint) {
  const fp = String(fingerprint || "").slice(0, 128);
  if (!fp || fp.length < 8) return { linked: [] };
  db.prepare(
    `INSERT INTO device_fingerprints(user_id,fingerprint,last_seen) VALUES(?,?,?)
     ON CONFLICT(user_id,fingerprint) DO UPDATE SET last_seen=?`,
  ).run(userId, fp, Date.now(), Date.now());
  return { linked: listLinkedAccounts(userId) };
}

export function countLinkedAccounts(userId) {
  return listLinkedAccounts(userId).length;
}

export function listLinkedAccounts(userId) {
  const fps = db
    .prepare("SELECT fingerprint FROM device_fingerprints WHERE user_id=?")
    .all(userId)
    .map((r) => r.fingerprint);
  if (!fps.length) return [];
  const linked = new Set();
  for (const fp of fps) {
    for (const row of db
      .prepare(
        "SELECT user_id FROM device_fingerprints WHERE fingerprint=? AND user_id!=?",
      )
      .all(fp, userId)) {
      linked.add(row.user_id);
    }
  }
  return [...linked];
}

/** 26 — friends / DM / blocks */
export const Social = {
  requestFriend(userId, friendId) {
    if (userId === friendId) throw new Error("Não pode adicionar a si mesmo.");
    if (this.isBlocked(userId, friendId) || this.isBlocked(friendId, userId))
      throw new Error("Bloqueado.");
    db.prepare(
      `INSERT INTO friends(user_id,friend_id,status,created_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id,friend_id) DO UPDATE SET status='PENDING'`,
    ).run(userId, friendId, "PENDING", Date.now());
  },
  acceptFriend(userId, fromId) {
    db.prepare(
      "UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=?",
    ).run(fromId, userId);
    db.prepare(
      `INSERT INTO friends(user_id,friend_id,status,created_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id,friend_id) DO UPDATE SET status='ACCEPTED'`,
    ).run(userId, fromId, "ACCEPTED", Date.now());
  },
  listFriends(userId) {
    return db
      .prepare(
        "SELECT friend_id, status, created_at FROM friends WHERE user_id=? ORDER BY created_at DESC",
      )
      .all(userId);
  },
  block(userId, blockedId) {
    db.prepare(
      `INSERT INTO user_blocks(user_id,blocked_id,created_at) VALUES(?,?,?)
       ON CONFLICT DO NOTHING`,
    ).run(userId, blockedId, Date.now());
    db.prepare("DELETE FROM friends WHERE user_id=? AND friend_id=?").run(
      userId,
      blockedId,
    );
  },
  isBlocked(a, b) {
    return !!db
      .prepare("SELECT 1 FROM user_blocks WHERE user_id=? AND blocked_id=?")
      .get(a, b);
  },
  sendDm(fromId, toId, body) {
    if (this.isBlocked(toId, fromId) || this.isBlocked(fromId, toId))
      throw new Error("Bloqueado.");
    db.prepare(
      "INSERT INTO dm_messages(from_id,to_id,body,at) VALUES(?,?,?,?)",
    ).run(fromId, toId, String(body).slice(0, 500), Date.now());
  },
  dmHistory(userId, peerId, limit = 50) {
    return db
      .prepare(
        `SELECT * FROM dm_messages
         WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)
         ORDER BY id DESC LIMIT ?`,
      )
      .all(userId, peerId, peerId, userId, limit)
      .reverse();
  },
};

/** 17 — KYC docs */
export const KycDocs = {
  submit(userId, { docType, docNumber, expiresAt, photoRef }) {
    const type = String(docType || "RG").slice(0, 32);
    db.prepare(
      `INSERT INTO kyc_docs(user_id,doc_type,doc_number,expires_at,photo_ref,status,updated_at)
       VALUES(?,?,?,?,?,'PENDENTE',?)
       ON CONFLICT(user_id) DO UPDATE SET
         doc_type=excluded.doc_type, doc_number=excluded.doc_number,
         expires_at=excluded.expires_at, photo_ref=excluded.photo_ref,
         status='PENDENTE', updated_at=excluded.updated_at`,
    ).run(
      userId,
      type,
      String(docNumber || "").slice(0, 40),
      expiresAt || null,
      photoRef || null,
      Date.now(),
    );
    return this.get(userId);
  },
  get(userId) {
    return db.prepare("SELECT * FROM kyc_docs WHERE user_id=?").get(userId);
  },
  setStatus(userId, status) {
    db.prepare(
      "UPDATE kyc_docs SET status=?, updated_at=? WHERE user_id=?",
    ).run(status, Date.now(), userId);
  },
  assertWithdrawOk(userId, kycStatus) {
    const doc = this.get(userId);
    if (kycStatus !== "APROVADO")
      throw new Error("KYC obrigatório para saque.");
    if (doc?.expires_at && new Date(doc.expires_at) < new Date())
      throw new Error("Documento KYC expirado. Envie novamente.");
  },
};

/** 18 — clan treasury */
export const ClanTreasury = {
  balance(tag) {
    const row = db
      .prepare(
        "SELECT COALESCE(SUM(delta_cents),0) b FROM clan_treasury_ledger WHERE tag=?",
      )
      .get(tag);
    return row?.b || 0;
  },
  credit(tag, cents, reason) {
    db.prepare(
      "INSERT INTO clan_treasury_ledger(tag,delta_cents,reason,at) VALUES(?,?,?,?)",
    ).run(tag, cents, reason || "", Date.now());
    return this.balance(tag);
  },
};

/** 19 — tournament escrow */
export const TournamentEscrow = {
  ensure(tournamentId) {
    db.prepare(
      `INSERT OR IGNORE INTO tournament_escrow(tournament_id,pool_cents,status) VALUES(?,0,'OPEN')`,
    ).run(tournamentId);
  },
  addBuyIn(tournamentId, cents) {
    this.ensure(tournamentId);
    db.prepare(
      "UPDATE tournament_escrow SET pool_cents=pool_cents+? WHERE tournament_id=? AND status='OPEN'",
    ).run(cents, tournamentId);
    return this.get(tournamentId);
  },
  get(tournamentId) {
    return db
      .prepare("SELECT * FROM tournament_escrow WHERE tournament_id=?")
      .get(tournamentId);
  },
  closeAndPayout(tournamentId) {
    db.prepare(
      "UPDATE tournament_escrow SET status='PAYOUT' WHERE tournament_id=?",
    ).run(tournamentId);
    return this.get(tournamentId);
  },
  refundAll(tournamentId) {
    db.prepare(
      "UPDATE tournament_escrow SET status='REFUNDED', pool_cents=0 WHERE tournament_id=?",
    ).run(tournamentId);
  },
};

/** 27 — season calendar */
export const SeasonCalendar = {
  upsert(row) {
    db.prepare(
      `INSERT INTO season_calendar(id,name,starts_at,ends_at,rewards_json,ceremony_note)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, starts_at=excluded.starts_at, ends_at=excluded.ends_at,
         rewards_json=excluded.rewards_json, ceremony_note=excluded.ceremony_note`,
    ).run(
      row.id,
      row.name,
      row.starts_at,
      row.ends_at || null,
      JSON.stringify(row.rewards || []),
      row.ceremony_note || "",
    );
  },
  list() {
    return db
      .prepare("SELECT * FROM season_calendar ORDER BY starts_at DESC")
      .all()
      .map((r) => ({
        ...r,
        rewards: JSON.parse(r.rewards_json || "[]"),
      }));
  },
};

/** 29 — push subscriptions (VAPID-ready; send is best-effort stub) */
export const PushStore = {
  save(userId, sub) {
    db.prepare(
      `INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES(?,?,?,?)
       ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`,
    ).run(
      userId,
      sub.endpoint,
      sub.keys?.p256dh || sub.p256dh || "",
      sub.keys?.auth || sub.auth || "",
    );
  },
  list(userId) {
    return db
      .prepare("SELECT * FROM push_subscriptions WHERE user_id=?")
      .all(userId);
  },
  vapidPublic() {
    return process.env.VAPID_PUBLIC_KEY || "";
  },
  async notify(userId, payload) {
    const subs = this.list(userId);
    if (!subs.length) return { sent: 0, skipped: true };
    // Sem web-push lib: registra intenção; cliente pode poll.
    return {
      sent: 0,
      queued: subs.length,
      payload,
      note: "Configure VAPID_* e lib web-push em produção.",
    };
  },
};

/** 16 — e-mail via Resend (opcional) */
export async function sendEmailResend({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY || "";
  if (!key) {
    return { sent: false, skipped: true, reason: "RESEND_API_KEY unset" };
  }
  const from = process.env.RESEND_FROM || "Arena Arcade <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    return { sent: res.ok, status: res.status, skipped: false };
  } catch (e) {
    return { sent: false, skipped: false, error: e.message };
  }
}

/** 28 — alerta se TURN não configurado em prod-like */
export async function alertTurnMisconfig() {
  const urls = process.env.TURN_URLS || "";
  const secret = process.env.TURN_SECRET || "";
  const enforce = process.env.TURN_ALERT_IF_MISSING === "1";
  if (!enforce) return { skipped: true };
  if (urls && secret) return { skipped: true, ok: true };
  return sendAlert({
    text: "[Arena] TURN_URLS/TURN_SECRET ausentes — NAT traversal degradado.",
    severity: "warning",
    kind: "turn_missing",
  });
}

export function matchReceipt({
  matchId,
  mode,
  stakeCents,
  prizeCents,
  rakeCents,
  winnerId,
  seriesScore,
  seriesBestOf,
  availableBefore,
  availableAfter,
}) {
  return {
    matchId,
    mode,
    stakeCents,
    stakeReais: ((stakeCents || 0) / 100).toFixed(2),
    prizeCents,
    prizeReais: ((prizeCents || 0) / 100).toFixed(2),
    rakeCents,
    rakeReais: ((rakeCents || 0) / 100).toFixed(2),
    winnerId,
    seriesScore,
    seriesBestOf,
    buckets: {
      availableBeforeCents: availableBefore ?? null,
      availableAfterCents: availableAfter ?? null,
    },
    trustNote:
      "Autoridade do servidor no hosted ≠ detecção de macro. Anomalias são sinal, não prova.",
    at: new Date().toISOString(),
  };
}

export function forfeitRulesCopy() {
  return {
    title: "Desconexão e forfeit",
    rules: [
      "Durante LOADING/QUEUED: cancelar devolve reservas.",
      "Após RUNNING: desconexão abre janela de reconexão; se expirar, forfeit ou review conforme regras da partida.",
      "Rage-quit / disputa abusiva: limite de 3 revisões por 24h.",
      "Série Bo3/Bo5: só a série completa liquida o stake.",
    ],
  };
}

export function newId(prefix = "id") {
  return prefix + "_" + crypto.randomUUID().slice(0, 8);
}
