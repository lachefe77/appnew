/**
 * ARENA ARCADE — Camada de Persistência SQLite
 * Substitui os Maps in-memory. Sobrevive a restarts do servidor.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "..", "data", "arena.db");

// Garante que o diretório existe
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
    joined_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tx_user   ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_tx_type   ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_match_a   ON matches(player_a_id);
  CREATE INDEX IF NOT EXISTS idx_match_b   ON matches(player_b_id);
  CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_act ON audit_log(actor_id);
  CREATE INDEX IF NOT EXISTS idx_audit_ts  ON audit_log(created_at);
`);

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
      role: u.role || "USER",
      elo: u.elo || 1200,
    });
    Wallets.ensure(u.id);
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
  },
  get(userId) {
    this.ensure(userId);
    return db.prepare("SELECT * FROM wallets WHERE user_id = ?").get(userId);
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

// ─── Audit Log ───────────────────────────────────────────────────────────────
export const AuditLog = {
  record(actorId, actorRole, action, targetId = "", detail = {}, ip = "") {
    db.prepare(
      `
      INSERT INTO audit_log (actor_id,actor_role,action,target_id,detail,ip)
      VALUES (?,?,?,?,?,?)
    `,
    ).run(actorId, actorRole, action, targetId, JSON.stringify(detail), ip);
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

// ─── Matchmaking Queue ────────────────────────────────────────────────────────
export const MatchmakingQueue = {
  join(userId, elo, mode, stakeCents, roomId) {
    db.prepare(
      `
      INSERT OR REPLACE INTO matchmaking_queue (user_id,elo,mode,stake_cents,room_id)
      VALUES (?,?,?,?,?)
    `,
    ).run(userId, elo, mode, stakeCents, roomId);
  },
  leave(userId) {
    db.prepare("DELETE FROM matchmaking_queue WHERE user_id=?").run(userId);
  },
  findMatch(userId, elo, mode, stakeCents) {
    return db
      .prepare(
        `
      SELECT * FROM matchmaking_queue
      WHERE user_id != ?
        AND mode = ?
        AND stake_cents = ?
        AND ABS(elo - ?) <= 200
      ORDER BY joined_at ASC LIMIT 1
    `,
      )
      .get(userId, mode, stakeCents, elo);
  },
  cleanup() {
    db.prepare(
      "DELETE FROM matchmaking_queue WHERE joined_at < datetime('now', '-5 minutes')",
    ).run();
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
