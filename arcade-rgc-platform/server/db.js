/**
 * ARENA ARCADE — Camada de Persistência SQLite
 * Substitui os Maps in-memory. Sobrevive a restarts do servidor.
 */
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import "dotenv/config";
import { normalizeRole } from "./roles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "..", "data", "arena.db");

// Garante que o diretório existe
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/** Adiciona coluna se ainda não existir (migração idempotente). */
function ensureColumn(table, column, typeSql) {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password      TEXT NOT NULL,
    full_name     TEXT DEFAULT '',
    cpf           TEXT DEFAULT '',
    birth_date    TEXT DEFAULT '',
    phone         TEXT DEFAULT '',
    address       TEXT DEFAULT '{}',
    ip            TEXT DEFAULT '',
    mac_fp        TEXT DEFAULT '',
    location      TEXT DEFAULT '',
    role          TEXT DEFAULT 'USER',
    kyc_status    TEXT DEFAULT 'PENDENTE',
    kyc_photo     TEXT DEFAULT '',
    vip_level     TEXT DEFAULT 'BRONZE',
    elo           INTEGER DEFAULT 1200,
    wins          INTEGER DEFAULT 0,
    losses        INTEGER DEFAULT 0,
    is_frozen     INTEGER DEFAULT 0,
    is_banned     INTEGER DEFAULT 0,
    aml_risk      TEXT DEFAULT 'BAIXO (0.1%)',
    fraud_score   INTEGER DEFAULT 750,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallets (
    user_id       TEXT PRIMARY KEY REFERENCES users(id),
    balance       INTEGER DEFAULT 0,
    locked        INTEGER DEFAULT 0,
    total_deposit INTEGER DEFAULT 0,
    total_withdraw INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES users(id),
    type          TEXT NOT NULL,
    amount_cents  INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    description   TEXT DEFAULT '',
    ref_id        TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id            TEXT PRIMARY KEY,
    room_id       TEXT NOT NULL,
    player_a_id   TEXT NOT NULL,
    player_b_id   TEXT NOT NULL,
    stake_cents   INTEGER DEFAULT 0,
    prize_cents   INTEGER DEFAULT 0,
    rake_cents    INTEGER DEFAULT 0,
    winner_id     TEXT DEFAULT NULL,
    status        TEXT DEFAULT 'IN_PROGRESS',
    p1_char       TEXT DEFAULT 'Iori',
    p2_char       TEXT DEFAULT 'Kyo',
    stage         TEXT DEFAULT 'Korea',
    dispute       INTEGER DEFAULT 0,
    started_at    TEXT DEFAULT (datetime('now')),
    ended_at      TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token         TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    email         TEXT NOT NULL,
    role          TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now')),
    expires_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_withdrawals (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    amount_cents  INTEGER NOT NULL,
    pix_key       TEXT NOT NULL,
    status        TEXT DEFAULT 'PENDENTE',
    requested_at  TEXT DEFAULT (datetime('now')),
    resolved_at   TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id    TEXT NOT NULL,
    actor_role  TEXT NOT NULL,
    action      TEXT NOT NULL,
    target_id   TEXT DEFAULT '',
    detail      TEXT DEFAULT '{}',
    ip          TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matchmaking_queue (
    user_id     TEXT PRIMARY KEY REFERENCES users(id),
    elo         INTEGER NOT NULL,
    mode        TEXT DEFAULT 'APOSTADO',
    stake_cents INTEGER DEFAULT 500,
    room_id     TEXT DEFAULT '',
    series_best_of INTEGER NOT NULL DEFAULT 1,
    joined_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS room_invites (
    code         TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL,
    created_by   TEXT NOT NULL REFERENCES users(id),
    kind         TEXT NOT NULL DEFAULT 'ROOM',
    payload      TEXT NOT NULL DEFAULT '{}',
    expires_at   INTEGER NOT NULL,
    uses         INTEGER NOT NULL DEFAULT 0,
    max_uses     INTEGER NOT NULL DEFAULT 20,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_trail (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at_ms        INTEGER NOT NULL,
    actor_id     TEXT NOT NULL,
    actor_role   TEXT NOT NULL,
    action       TEXT NOT NULL,
    target_type  TEXT DEFAULT '',
    target_id    TEXT DEFAULT '',
    room_id      TEXT DEFAULT '',
    match_id     TEXT DEFAULT '',
    ip           TEXT DEFAULT '',
    meta_json    TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS seasons (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    starts_at      TEXT NOT NULL,
    ends_at        TEXT DEFAULT NULL,
    active         INTEGER NOT NULL DEFAULT 0,
    elo_reset_done INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_stats (
    user_id         TEXT PRIMARY KEY REFERENCES users(id),
    ranked_played   INTEGER NOT NULL DEFAULT 0,
    credit_played   INTEGER NOT NULL DEFAULT 0,
    wins            INTEGER NOT NULL DEFAULT 0,
    losses          INTEGER NOT NULL DEFAULT 0,
    abandonments    INTEGER NOT NULL DEFAULT 0,
    avg_match_ms    INTEGER NOT NULL DEFAULT 0,
    style_tag       TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS user_limits (
    user_id          TEXT PRIMARY KEY REFERENCES users(id),
    daily_loss_cents INTEGER NOT NULL DEFAULT 0,
    daily_loss_day   TEXT DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_tx_user   ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_tx_type   ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_match_a   ON matches(player_a_id);
  CREATE INDEX IF NOT EXISTS idx_match_b   ON matches(player_b_id);
  CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_act ON audit_log(actor_id);
  CREATE INDEX IF NOT EXISTS idx_audit_ts  ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_trail_act ON audit_trail(actor_id);
  CREATE INDEX IF NOT EXISTS idx_trail_ts  ON audit_trail(at_ms);
  CREATE INDEX IF NOT EXISTS idx_trail_action ON audit_trail(action);
  CREATE INDEX IF NOT EXISTS idx_seasons_active ON seasons(active);
`);

// Colunas extras em wallets (perda diária) — convivem com user_limits.
ensureColumn("wallets", "daily_loss_cents", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("wallets", "daily_loss_day", "TEXT DEFAULT ''");
ensureColumn("matchmaking_queue", "series_best_of", "INTEGER NOT NULL DEFAULT 1");

// ─── Users ────────────────────────────────────────────────────────────────────
export const Users = {
  get(email) {
    return db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase());
  },
  getById(id) {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  },
  create(u) {
    const role = normalizeRole(u.role || "USER");
    if (!role || role === "GUEST")
      throw new Error("Papel de usuário inválido.");
    db.prepare(
      `
      INSERT INTO users
        (id,username,email,password,full_name,cpf,birth_date,phone,address,ip,mac_fp,location,role,elo)
      VALUES
        (@id,@username,@email,@password,@full_name,@cpf,@birth_date,@phone,@address,@ip,@mac_fp,@location,@role,@elo)
    `,
    ).run({
      id: u.id,
      username: u.username,
      email: u.email.toLowerCase(),
      password: u.password,
      full_name: u.fullName || "",
      cpf: u.cpf || "",
      birth_date: u.birthDate || "",
      phone: u.phone || "",
      address: JSON.stringify(u.address || {}),
      ip: u.ip || "",
      mac_fp: u.macFingerprint || "",
      location: u.location || "",
      role,
      elo: u.elo || 1200,
    });
    Wallets.ensure(u.id);
    UserStats.ensure(u.id);
    UserLimits.ensure(u.id);
  },
  setRole(id, role) {
    const normalized = normalizeRole(role);
    if (!normalized || normalized === "GUEST")
      throw new Error("Papel inválido.");
    db.prepare("UPDATE users SET role=? WHERE id=?").run(normalized, id);
  },
  updateElo(id, newElo, win) {
    db.prepare(
      "UPDATE users SET elo=?, wins=wins+?, losses=losses+? WHERE id=?",
    ).run(newElo, win ? 1 : 0, win ? 0 : 1, id);
  },
  updateKyc(email, status, photo) {
    db.prepare("UPDATE users SET kyc_status=?, kyc_photo=? WHERE email=?").run(
      status,
      photo || null,
      email.toLowerCase(),
    );
  },
  ban(id, banned) {
    db.prepare("UPDATE users SET is_banned=? WHERE id=?").run(
      banned ? 1 : 0,
      id,
    );
  },
  freeze(id, frozen) {
    db.prepare("UPDATE users SET is_frozen=? WHERE id=?").run(
      frozen ? 1 : 0,
      id,
    );
  },
  all() {
    return db
      .prepare("SELECT * FROM users")
      .all()
      .map((u) => ({
        ...u,
        address: (() => {
          try {
            return JSON.parse(u.address);
          } catch {
            return {};
          }
        })(),
      }));
  },
  pendingKyc() {
    return db
      .prepare("SELECT * FROM users WHERE kyc_status='PENDENTE'")
      .all()
      .map((u) => ({
        ...u,
        address: (() => {
          try {
            return JSON.parse(u.address);
          } catch {
            return {};
          }
        })(),
      }));
  },
};

// ─── Wallets ──────────────────────────────────────────────────────────────────
export const Wallets = {
  ensure(userId) {
    if (!userId) return;
    const userExists = db
      .prepare("SELECT 1 FROM users WHERE id = ?")
      .get(userId);
    if (!userExists) return;
    db.prepare(
      "INSERT OR IGNORE INTO wallets (user_id,balance,locked) VALUES (?,0,0)",
    ).run(userId);
    UserLimits.ensure(userId);
  },
  get(userId) {
    this.ensure(userId);
    return db.prepare("SELECT * FROM wallets WHERE user_id = ?").get(userId);
  },
  /** Acumula perda diária (centavos) e reinicia o contador ao mudar o dia UTC. */
  addDailyLoss(userId, lossCents) {
    if (!Number.isSafeInteger(lossCents) || lossCents < 0) return this.get(userId);
    const day = new Date().toISOString().slice(0, 10);
    this.ensure(userId);
    const w = this.get(userId);
    if (!w) return null;
    if (w.daily_loss_day !== day) {
      db.prepare(
        "UPDATE wallets SET daily_loss_cents=?, daily_loss_day=? WHERE user_id=?",
      ).run(lossCents, day, userId);
    } else {
      db.prepare(
        "UPDATE wallets SET daily_loss_cents=daily_loss_cents+? WHERE user_id=?",
      ).run(lossCents, userId);
    }
    UserLimits.addDailyLoss(userId, lossCents);
    return this.get(userId);
  },
  getDailyLoss(userId) {
    const w = this.get(userId);
    if (!w) return { daily_loss_cents: 0, daily_loss_day: "" };
    const day = new Date().toISOString().slice(0, 10);
    if (w.daily_loss_day !== day)
      return { daily_loss_cents: 0, daily_loss_day: day };
    return {
      daily_loss_cents: w.daily_loss_cents || 0,
      daily_loss_day: w.daily_loss_day || day,
    };
  },
  credit(userId, amountCents, type, desc, refId) {
    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > 100000000
    )
      throw new Error("Valor inválido em centavos.");
    const tx = db.transaction(() => {
      this.ensure(userId);
      db.prepare(
        "UPDATE wallets SET balance=balance+?, total_deposit=total_deposit+? WHERE user_id=?",
      ).run(amountCents, type === "PIX_DEPOSIT" ? amountCents : 0, userId);
      const w = this.get(userId);
      if (!w) return;
      Transactions.record(userId, type, amountCents, w.balance, desc, refId);
    });
    tx();
    return this.get(userId);
  },
  debit(userId, amountCents, type, desc, refId) {
    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > 100000000
    )
      throw new Error("Valor inválido em centavos.");
    const w = this.get(userId);
    if (!w || w.balance < amountCents) throw new Error("Saldo insuficiente.");
    const tx = db.transaction(() => {
      db.prepare(
        "UPDATE wallets SET balance=balance-?, locked=locked+? WHERE user_id=?",
      ).run(amountCents, amountCents, userId);
      const wAfter = this.get(userId);
      Transactions.record(
        userId,
        type,
        -amountCents,
        wAfter.balance,
        desc,
        refId,
      );
    });
    tx();
    return this.get(userId);
  },
  unlock(userId, amountCents) {
    throw new Error("Use o serviço financeiro com uma reserva identificada.");
  },
  creditPrize(userId, amountCents, matchId) {
    throw new Error("Use a liquidação transacional da partida.");
  },
  allBalanceSummary() {
    return db
      .prepare(
        `
      SELECT
        SUM(balance) as totalFlow,
        SUM(locked) as totalEscrow,
        SUM(total_deposit) as totalDeposits,
        SUM(total_withdraw) as totalWithdrawals
      FROM wallets
    `,
      )
      .get();
  },
};

// ─── Transactions ─────────────────────────────────────────────────────────────
export const Transactions = {
  record(userId, type, amountCents, balanceAfter, desc = "", refId = "") {
    db.prepare(
      `
      INSERT INTO transactions (user_id,type,amount_cents,balance_after,description,ref_id)
      VALUES (?,?,?,?,?,?)
    `,
    ).run(userId, type, amountCents, balanceAfter, desc, refId);
  },
  forUser(userId, limit = 50) {
    return db
      .prepare(
        `
      SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ?
    `,
      )
      .all(userId, limit);
  },
};

// ─── Matches ──────────────────────────────────────────────────────────────────
export const Matches = {
  create(m) {
    db.prepare(
      `
      INSERT INTO matches (id,room_id,player_a_id,player_b_id,stake_cents,prize_cents,rake_cents,p1_char,p2_char,stage)
      VALUES (@id,@roomId,@playerAId,@playerBId,@stakeCents,@prizeCents,@rakeCents,@p1Char,@p2Char,@stage)
    `,
    ).run({
      id: m.id,
      roomId: m.roomId,
      playerAId: m.playerAId,
      playerBId: m.playerBId,
      stakeCents: m.stakeCents,
      prizeCents: m.prizeCents,
      rakeCents: m.rakeCents,
      p1Char: m.p1Char || "Iori",
      p2Char: m.p2Char || "Kyo",
      stage: m.stage || "Korea",
    });
  },
  resolve(id, winnerId) {
    db.prepare(
      "UPDATE matches SET winner_id=?, status='RESOLVED', ended_at=datetime('now') WHERE id=?",
    ).run(winnerId, id);
  },
  cancel(id) {
    db.prepare(
      "UPDATE matches SET status='CANCELLED', ended_at=datetime('now') WHERE id=?",
    ).run(id);
  },
  dispute(id) {
    db.prepare(
      "UPDATE matches SET dispute=1, status='DISPUTE', ended_at=datetime('now') WHERE id=?",
    ).run(id);
  },
  recent(limit = 20) {
    return db
      .prepare(
        `
      SELECT m.*, ua.username as p1_name, ub.username as p2_name
      FROM matches m
      LEFT JOIN users ua ON ua.id = m.player_a_id
      LEFT JOIN users ub ON ub.id = m.player_b_id
      ORDER BY m.started_at DESC LIMIT ?
    `,
      )
      .all(limit);
  },
};

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const Sessions = {
  create(token, userId, email, role) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    db.prepare(
      `
      INSERT OR REPLACE INTO sessions (token,user_id,email,role,expires_at) VALUES (?,?,?,?,?)
    `,
    ).run(token, userId, email, role, expiresAt);
  },
  validate(token) {
    if (!token) return null;
    const s = db
      .prepare(
        `SELECT s.*,u.role AS role FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token=? AND julianday(s.expires_at)>julianday('now') AND u.is_banned=0`,
      )
      .get(token);
    return s || null;
  },
  destroy(token) {
    db.prepare("DELETE FROM sessions WHERE token=?").run(token);
  },
  destroyUser(userId) {
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
  },
};

// ─── Pending Withdrawals ──────────────────────────────────────────────────────
export const PendingWithdrawals = {
  create(id, userId, amountCents, pixKey) {
    db.prepare(
      `
      INSERT INTO pending_withdrawals (id,user_id,amount_cents,pix_key) VALUES (?,?,?,?)
    `,
    ).run(id, userId, amountCents, pixKey);
  },
  get(id) {
    return db.prepare("SELECT * FROM pending_withdrawals WHERE id=?").get(id);
  },
  resolve(id, status) {
    db.prepare(
      "UPDATE pending_withdrawals SET status=?, resolved_at=datetime('now') WHERE id=?",
    ).run(status, id);
  },
  pending() {
    return db
      .prepare(
        "SELECT pw.*, u.username, u.cpf FROM pending_withdrawals pw LEFT JOIN users u ON u.id=pw.user_id WHERE pw.status='PENDENTE'",
      )
      .all();
  },
};

// ─── Audit Log / Trail ───────────────────────────────────────────────────────
function insertAuditTrail(fields) {
  const atMs =
    Number.isFinite(fields.atMs) && fields.atMs > 0
      ? Math.trunc(fields.atMs)
      : Date.now();
  const meta =
    fields.meta != null
      ? fields.meta
      : fields.detail != null
        ? fields.detail
        : {};
  const metaJson =
    typeof meta === "string" ? meta : JSON.stringify(meta ?? {});
  db.prepare(
    `
    INSERT INTO audit_trail
      (at_ms,actor_id,actor_role,action,target_type,target_id,room_id,match_id,ip,meta_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `,
  ).run(
    atMs,
    String(fields.actorId ?? ""),
    String(fields.actorRole ?? "GUEST"),
    String(fields.action ?? ""),
    String(fields.targetType ?? ""),
    String(fields.targetId ?? ""),
    String(fields.roomId ?? ""),
    String(fields.matchId ?? ""),
    String(fields.ip ?? ""),
    metaJson,
  );
  // Espelho legado em audit_log para consumidores de recent().
  db.prepare(
    `
    INSERT INTO audit_log (actor_id,actor_role,action,target_id,detail,ip)
    VALUES (?,?,?,?,?,?)
  `,
  ).run(
    String(fields.actorId ?? ""),
    String(fields.actorRole ?? "GUEST"),
    String(fields.action ?? ""),
    String(fields.targetId ?? ""),
    metaJson,
    String(fields.ip ?? ""),
  );
}

export const AuditLog = {
  /**
   * Compatível com a assinatura legada:
   *   record(actorId, actorRole, action, targetId?, detail?, ip?)
   * e com o formato expandido:
   *   record({ actorId, actorRole, action, targetType, targetId, roomId, matchId, ip, meta })
   */
  record(actorOrFields, actorRole, action, targetId = "", detail = {}, ip = "") {
    if (
      actorOrFields != null &&
      typeof actorOrFields === "object" &&
      !Array.isArray(actorOrFields)
    ) {
      insertAuditTrail(actorOrFields);
      return;
    }
    insertAuditTrail({
      actorId: actorOrFields,
      actorRole,
      action,
      targetId,
      meta: detail,
      ip,
    });
  },
  query({ limit = 50, action, actorId, since } = {}) {
    const clauses = [];
    const params = [];
    if (action) {
      clauses.push("action = ?");
      params.push(action);
    }
    if (actorId) {
      clauses.push("actor_id = ?");
      params.push(actorId);
    }
    if (since != null) {
      const sinceMs =
        typeof since === "number"
          ? since
          : Date.parse(since) || Number(since) || 0;
      clauses.push("at_ms >= ?");
      params.push(sinceMs);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    params.push(safeLimit);
    return db
      .prepare(
        `
      SELECT t.*, u.username AS actor_username
      FROM audit_trail t
      LEFT JOIN users u ON u.id = t.actor_id
      ${where}
      ORDER BY t.at_ms DESC
      LIMIT ?
    `,
      )
      .all(...params);
  },
  recent(limit = 50) {
    return db
      .prepare(
        `
      SELECT al.*, u.username as actor_username
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.actor_id
      ORDER BY al.created_at DESC LIMIT ?
    `,
      )
      .all(limit);
  },
};

// ─── User limits (perda diária) ───────────────────────────────────────────────
export const UserLimits = {
  ensure(userId) {
    if (!userId) return;
    const userExists = db
      .prepare("SELECT 1 FROM users WHERE id = ?")
      .get(userId);
    if (!userExists) return;
    db.prepare(
      "INSERT OR IGNORE INTO user_limits (user_id,daily_loss_cents,daily_loss_day) VALUES (?,0,'')",
    ).run(userId);
  },
  get(userId) {
    this.ensure(userId);
    const row = db
      .prepare("SELECT * FROM user_limits WHERE user_id = ?")
      .get(userId);
    const day = new Date().toISOString().slice(0, 10);
    if (!row || row.daily_loss_day !== day)
      return { user_id: userId, daily_loss_cents: 0, daily_loss_day: day };
    return row;
  },
  addDailyLoss(userId, lossCents) {
    if (!Number.isSafeInteger(lossCents) || lossCents < 0) return this.get(userId);
    const day = new Date().toISOString().slice(0, 10);
    this.ensure(userId);
    const row = db
      .prepare("SELECT * FROM user_limits WHERE user_id = ?")
      .get(userId);
    if (!row || row.daily_loss_day !== day) {
      db.prepare(
        "UPDATE user_limits SET daily_loss_cents=?, daily_loss_day=? WHERE user_id=?",
      ).run(lossCents, day, userId);
    } else {
      db.prepare(
        "UPDATE user_limits SET daily_loss_cents=daily_loss_cents+? WHERE user_id=?",
      ).run(lossCents, userId);
    }
    return this.get(userId);
  },
};

// ─── User stats (playstyle tags) ──────────────────────────────────────────────
export const UserStats = {
  ensure(userId) {
    if (!userId) return;
    const userExists = db
      .prepare("SELECT 1 FROM users WHERE id = ?")
      .get(userId);
    if (!userExists) return;
    db.prepare(
      `INSERT OR IGNORE INTO user_stats
        (user_id,ranked_played,credit_played,wins,losses,abandonments,avg_match_ms,style_tag)
       VALUES (?,0,0,0,0,0,0,'')`,
    ).run(userId);
  },
  get(userId) {
    this.ensure(userId);
    return db.prepare("SELECT * FROM user_stats WHERE user_id = ?").get(userId);
  },
  recordMatch(userId, { ranked = false, credit = false, win, abandon = false, matchMs = 0 } = {}) {
    this.ensure(userId);
    const row = this.get(userId);
    const played = (row.ranked_played || 0) + (row.credit_played || 0);
    const nextAvg =
      matchMs > 0
        ? Math.round(
            ((row.avg_match_ms || 0) * played + matchMs) / (played + 1),
          )
        : row.avg_match_ms || 0;
    db.prepare(
      `
      UPDATE user_stats SET
        ranked_played = ranked_played + ?,
        credit_played = credit_played + ?,
        wins = wins + ?,
        losses = losses + ?,
        abandonments = abandonments + ?,
        avg_match_ms = ?
      WHERE user_id = ?
    `,
    ).run(
      ranked ? 1 : 0,
      credit ? 1 : 0,
      win === true ? 1 : 0,
      win === false ? 1 : 0,
      abandon ? 1 : 0,
      nextAvg,
      userId,
    );
    this.refreshStyleTag(userId);
    return this.get(userId);
  },
  setStyleTag(userId, tag) {
    this.ensure(userId);
    db.prepare("UPDATE user_stats SET style_tag=? WHERE user_id=?").run(
      String(tag || "").slice(0, 64),
      userId,
    );
  },
  refreshStyleTag(userId) {
    const s = this.get(userId);
    if (!s) return;
    const total = (s.wins || 0) + (s.losses || 0);
    let tag = "NOVICE";
    if (total >= 5) {
      const wr = (s.wins || 0) / total;
      if ((s.abandonments || 0) / Math.max(total, 1) > 0.25) tag = "UNRELIABLE";
      else if (wr >= 0.65) tag = "AGGRESSIVE";
      else if (wr <= 0.35) tag = "CAUTIOUS";
      else tag = "BALANCED";
    }
    this.setStyleTag(userId, tag);
  },
};

// ─── Seasons (persistência; API de alto nível em seasons.js) ─────────────────
export const SeasonsStore = {
  get(id) {
    return db.prepare("SELECT * FROM seasons WHERE id = ?").get(id);
  },
  getActive() {
    return db
      .prepare("SELECT * FROM seasons WHERE active=1 ORDER BY starts_at DESC LIMIT 1")
      .get();
  },
  list(limit = 20) {
    return db
      .prepare("SELECT * FROM seasons ORDER BY starts_at DESC LIMIT ?")
      .all(limit);
  },
  upsert({ id, name, startsAt, endsAt = null, active = 0, eloResetDone = 0 }) {
    db.prepare(
      `
      INSERT INTO seasons (id,name,starts_at,ends_at,active,elo_reset_done)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        starts_at=excluded.starts_at,
        ends_at=excluded.ends_at,
        active=excluded.active,
        elo_reset_done=excluded.elo_reset_done
    `,
    ).run(
      id,
      name,
      startsAt,
      endsAt,
      active ? 1 : 0,
      eloResetDone ? 1 : 0,
    );
    return this.get(id);
  },
  deactivateAll() {
    db.prepare("UPDATE seasons SET active=0 WHERE active=1").run();
  },
  setActive(id, active = true) {
    db.prepare("UPDATE seasons SET active=? WHERE id=?").run(active ? 1 : 0, id);
  },
  markEloResetDone(id) {
    db.prepare("UPDATE seasons SET elo_reset_done=1 WHERE id=?").run(id);
  },
  resetAllElo(defaultElo = 1200) {
    db.prepare("UPDATE users SET elo=?, wins=0, losses=0").run(defaultElo);
  },
};

// ─── Matchmaking Queue ────────────────────────────────────────────────────────
/** Faixa de stake: mesmo valor exato (±0). Elo ±200. Mesma sala ou qualquer sala KOF. */
export const MatchmakingQueue = {
  join(userId, elo, mode, stakeCents, roomId, seriesBestOf = 1) {
    db.prepare(
      `
      INSERT OR REPLACE INTO matchmaking_queue
        (user_id,elo,mode,stake_cents,room_id,series_best_of)
      VALUES (?,?,?,?,?,?)
    `,
    ).run(userId, elo, mode, stakeCents, roomId || "", seriesBestOf);
  },
  leave(userId) {
    db.prepare("DELETE FROM matchmaking_queue WHERE user_id=?").run(userId);
  },
  get(userId) {
    return db
      .prepare("SELECT * FROM matchmaking_queue WHERE user_id=?")
      .get(userId);
  },
  /**
   * Compatível: mesmo mode, mesmo stake, elo ±200, mesmo series_best_of,
   * e (mesma room_id OU ambas em salas KOF — room_id vazio = qualquer KOF).
   */
  findMatch(userId, elo, mode, stakeCents, roomId = "", seriesBestOf = 1) {
    return db
      .prepare(
        `
      SELECT * FROM matchmaking_queue
      WHERE user_id != ?
        AND mode = ?
        AND stake_cents = ?
        AND series_best_of = ?
        AND ABS(elo - ?) <= 200
        AND (
          room_id = ?
          OR room_id = ''
          OR ? = ''
        )
      ORDER BY joined_at ASC LIMIT 1
    `,
      )
      .get(
        userId,
        mode,
        stakeCents,
        seriesBestOf,
        elo,
        roomId || "",
        roomId || "",
      );
  },
  cleanup() {
    db.prepare(
      "DELETE FROM matchmaking_queue WHERE joined_at < datetime('now', '-5 minutes')",
    ).run();
  },
};

// ─── Room / challenge invite codes (KOF-7X2Q) ─────────────────────────────────
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomInviteSuffix(len = 4) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

export const InviteCodes = {
  /** Gera código curto único no formato KOF-XXXX. */
  allocate({
    roomId,
    createdBy,
    kind = "ROOM",
    payload = {},
    ttlMs = 3600000,
    maxUses = 20,
  }) {
    if (!roomId || !createdBy) throw new Error("Convite exige sala e autor.");
    if (!["ROOM", "CHALLENGE"].includes(kind))
      throw new Error("Tipo de convite inválido.");
    let code = "";
    for (let attempt = 0; attempt < 12; attempt++) {
      code = "KOF-" + randomInviteSuffix(4);
      const exists = db.prepare("SELECT 1 FROM room_invites WHERE code=?").get(code);
      if (!exists) break;
      code = "";
    }
    if (!code) throw new Error("Não foi possível gerar código de convite.");
    const expiresAt = Date.now() + Math.max(60000, ttlMs);
    db.prepare(
      `
      INSERT INTO room_invites
        (code,room_id,created_by,kind,payload,expires_at,uses,max_uses)
      VALUES (?,?,?,?,?,?,0,?)
    `,
    ).run(
      code,
      roomId,
      createdBy,
      kind,
      JSON.stringify(payload || {}),
      expiresAt,
      Math.min(100, Math.max(1, maxUses)),
    );
    return this.get(code);
  },
  get(code) {
    if (!code) return null;
    const row = db
      .prepare("SELECT * FROM room_invites WHERE code=?")
      .get(String(code).trim().toUpperCase());
    if (!row) return null;
    let payload = {};
    try {
      payload = JSON.parse(row.payload || "{}");
    } catch {
      payload = {};
    }
    return { ...row, payload, expired: row.expires_at < Date.now() };
  },
  /** Consome um uso se válido; retorna o convite ou lança. */
  redeem(code) {
    const invite = this.get(code);
    if (!invite) throw new Error("Código de convite não encontrado.");
    if (invite.expired) throw new Error("Código de convite expirado.");
    if (invite.uses >= invite.max_uses)
      throw new Error("Código de convite esgotado.");
    db.prepare("UPDATE room_invites SET uses=uses+1 WHERE code=?").run(invite.code);
    return this.get(invite.code);
  },
  cleanup() {
    db.prepare("DELETE FROM room_invites WHERE expires_at < ?").run(Date.now());
  },
};

// ─── Daily stats for admin charts ────────────────────────────────────────────
export const Stats = {
  daily(days = 7) {
    return db
      .prepare(
        `
      SELECT
        date(started_at) as day,
        COUNT(*) as matches,
        SUM(stake_cents * 2) as volume_cents,
        SUM(rake_cents) as rake_cents
      FROM matches
      WHERE status = 'RESOLVED'
        AND started_at >= date('now', ? || ' days')
      GROUP BY date(started_at)
      ORDER BY day ASC
    `,
      )
      .all(`-${days}`);
  },
  newUsers(days = 7) {
    return db
      .prepare(
        `
      SELECT date(created_at) as day, COUNT(*) as count
      FROM users
      WHERE created_at >= date('now', ? || ' days')
      GROUP BY date(created_at)
      ORDER BY day ASC
    `,
      )
      .all(`-${days}`);
  },
};

// ─── Sessions cleanup ─────────────────────────────────────────────────────────
export function cleanupExpiredSessions() {
  const { changes } = db
    .prepare(
      "DELETE FROM sessions WHERE julianday(expires_at) <= julianday('now')",
    )
    .run();
  return changes;
}

// ─── ELO ─────────────────────────────────────────────────────────────────────
export function calculateElo(winnerElo, loserElo) {
  const K = 32;
  const expectedWin = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoss = 1 - expectedWin;
  return {
    newWinnerElo: Math.round(winnerElo + K * (1 - expectedWin)),
    newLoserElo: Math.round(loserElo + K * (0 - expectedLoss)),
  };
}

export default db;
