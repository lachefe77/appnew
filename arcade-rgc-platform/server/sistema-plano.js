/**
 * Plano fliperama (itens 1–29, exceto 30): helpers de produto/sistema.
 * Persistência leve em SQLite para clãs, disputas, reset de senha, beta, chat.
 */
import crypto from "node:crypto";
import db from "./db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS clans (
    tag TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    leader_id TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS clan_members (
    tag TEXT NOT NULL REFERENCES clans(tag),
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'MEMBER',
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (tag, user_id)
  );
  CREATE TABLE IF NOT EXISTS clan_invites (
    tag TEXT NOT NULL,
    user_id TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tag, user_id)
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS match_dispute_counts (
    user_id TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS beta_allowlist (
    email TEXT PRIMARY KEY,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS room_chat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    body TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_mutes (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    until_ms INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS character_picks (
    match_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    character TEXT NOT NULL,
    PRIMARY KEY (match_id, user_id)
  );
`);

function seedClansIfEmpty() {
  const n = db.prepare("SELECT COUNT(*) c FROM clans").get().c;
  if (n > 0) return;
  const rows = [
    ["ORO", "Orochi Bloodline", "Líder dos Golpes Proibidos"],
    ["NEO", "NeoGeo Masters BR", "Veteranos dos Fliperamas"],
    ["KOF", "KOF Syndicate", "Competitivo BR"],
  ];
  const ins = db.prepare(
    "INSERT INTO clans(tag,name,description,leader_id,points) VALUES(?,?,?,?,?)",
  );
  for (const [tag, name, desc] of rows) {
    ins.run(tag, name, desc, "system", 1000);
  }
}
seedClansIfEmpty();
try {
  db.exec(
    "ALTER TABLE clan_members ADD COLUMN role TEXT NOT NULL DEFAULT 'MEMBER'",
  );
} catch {
  /* already exists */
}

export const PlanoClans = {
  list() {
    return db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM clan_members m WHERE m.tag=c.tag) AS members
         FROM clans c ORDER BY c.points DESC`,
      )
      .all();
  },
  create(tag, name, description, leaderId) {
    const t = String(tag || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
    if (t.length < 2) throw new Error("Tag inválida (2–4 letras/números).");
    if (db.prepare("SELECT 1 FROM clans WHERE tag=?").get(t))
      throw new Error("Tag já em uso.");
    if (db.prepare("SELECT 1 FROM clan_members WHERE user_id=?").get(leaderId))
      throw new Error("Já estás num clã.");
    db.prepare(
      "INSERT INTO clans(tag,name,description,leader_id) VALUES(?,?,?,?)",
    ).run(t, String(name || t).slice(0, 48), String(description || "").slice(0, 160), leaderId);
    db.prepare(
      "INSERT INTO clan_members(tag,user_id,role) VALUES(?,?,?)",
    ).run(t, leaderId, "LEADER");
    return this.get(t);
  },
  join(tag, userId) {
    const t = String(tag || "").toUpperCase();
    if (!db.prepare("SELECT 1 FROM clans WHERE tag=?").get(t))
      throw new Error("Clã inexistente.");
    if (db.prepare("SELECT 1 FROM clan_members WHERE user_id=?").get(userId))
      throw new Error("Já estás num clã.");
    const invite = db
      .prepare("SELECT 1 FROM clan_invites WHERE tag=? AND user_id=?")
      .get(t, userId);
    // convite opcional: se houver invites pendentes para o clã, exige um
    const inviteOnly = db
      .prepare("SELECT COUNT(*) c FROM clan_invites WHERE tag=?")
      .get(t).c;
    if (inviteOnly > 0 && !invite)
      throw new Error("Entrada só por convite neste clã.");
    db.prepare(
      "INSERT INTO clan_members(tag,user_id,role) VALUES(?,?,?)",
    ).run(t, userId, "MEMBER");
    db.prepare("DELETE FROM clan_invites WHERE tag=? AND user_id=?").run(t, userId);
    return this.get(t);
  },
  leave(userId) {
    db.prepare("DELETE FROM clan_members WHERE user_id=?").run(userId);
  },
  memberRole(tag, userId) {
    return db
      .prepare("SELECT role FROM clan_members WHERE tag=? AND user_id=?")
      .get(String(tag).toUpperCase(), userId)?.role;
  },
  invite(tag, userId, byUserId) {
    const t = String(tag).toUpperCase();
    const role = this.memberRole(t, byUserId);
    if (!["LEADER", "OFFICER"].includes(role))
      throw new Error("Só líder/oficial convida.");
    db.prepare(
      `INSERT INTO clan_invites(tag,user_id,invited_by,created_at) VALUES(?,?,?,?)
       ON CONFLICT(tag,user_id) DO UPDATE SET invited_by=excluded.invited_by`,
    ).run(t, userId, byUserId, Date.now());
  },
  kick(tag, targetId, byUserId) {
    const t = String(tag).toUpperCase();
    const role = this.memberRole(t, byUserId);
    if (!["LEADER", "OFFICER"].includes(role))
      throw new Error("Sem permissão.");
    if (this.memberRole(t, targetId) === "LEADER")
      throw new Error("Não pode expulsar o líder.");
    db.prepare("DELETE FROM clan_members WHERE tag=? AND user_id=?").run(
      t,
      targetId,
    );
  },
  transferLeader(tag, newLeaderId, byUserId) {
    const t = String(tag).toUpperCase();
    if (this.memberRole(t, byUserId) !== "LEADER")
      throw new Error("Só o líder transfere.");
    if (!this.memberRole(t, newLeaderId))
      throw new Error("Novo líder precisa ser membro.");
    db.prepare(
      "UPDATE clan_members SET role='MEMBER' WHERE tag=? AND role='LEADER'",
    ).run(t);
    db.prepare(
      "UPDATE clan_members SET role='LEADER' WHERE tag=? AND user_id=?",
    ).run(t, newLeaderId);
    db.prepare("UPDATE clans SET leader_id=? WHERE tag=?").run(newLeaderId, t);
  },
  setRole(tag, userId, role, byUserId) {
    const t = String(tag).toUpperCase();
    if (this.memberRole(t, byUserId) !== "LEADER")
      throw new Error("Só o líder define cargos.");
    if (!["OFFICER", "MEMBER"].includes(role))
      throw new Error("Cargo inválido.");
    db.prepare(
      "UPDATE clan_members SET role=? WHERE tag=? AND user_id=?",
    ).run(role, t, userId);
  },
  members(tag) {
    return db
      .prepare(
        "SELECT user_id, role, joined_at FROM clan_members WHERE tag=? ORDER BY role",
      )
      .all(String(tag).toUpperCase());
  },
  get(tag) {
    return db.prepare("SELECT * FROM clans WHERE tag=?").get(String(tag).toUpperCase());
  },
  ofUser(userId) {
    return db
      .prepare(
        `SELECT c.*, m.role AS my_role FROM clans c JOIN clan_members m ON m.tag=c.tag WHERE m.user_id=?`,
      )
      .get(userId);
  },
  recordMatch(winnerId, loserId, stakeCents = 0) {
    const w = this.ofUser(winnerId);
    const l = this.ofUser(loserId);
    if (w) {
      db.prepare(
        "UPDATE clans SET wins=wins+1, points=points+? WHERE tag=?",
      ).run(Math.floor(25 + stakeCents / 100), w.tag);
    }
    if (l) {
      db.prepare(
        "UPDATE clans SET losses=losses+1, points=MAX(0,points-10) WHERE tag=?",
      ).run(l.tag);
    }
    return { winnerTag: w?.tag, loserTag: l?.tag };
  },
};

export const PlanoPasswordReset = {
  create(userId) {
    const token = crypto.randomBytes(24).toString("hex");
    const expires = Date.now() + 60 * 60 * 1000;
    db.prepare(
      "INSERT INTO password_resets(token,user_id,expires_at) VALUES(?,?,?)",
    ).run(token, userId, expires);
    return { token, expiresAt: expires };
  },
  consume(token, newPasswordHash) {
    const row = db
      .prepare("SELECT * FROM password_resets WHERE token=? AND used=0")
      .get(token);
    if (!row || row.expires_at < Date.now())
      throw new Error("Token inválido ou expirado.");
    db.prepare("UPDATE password_resets SET used=1 WHERE token=?").run(token);
    db.prepare("UPDATE users SET password=? WHERE id=?").run(
      newPasswordHash,
      row.user_id,
    );
    return row.user_id;
  },
};

const DISPUTE_MAX = 3;
const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const PlanoDisputes = {
  assertCanDispute(userId) {
    const now = Date.now();
    let row = db
      .prepare("SELECT * FROM match_dispute_counts WHERE user_id=?")
      .get(userId);
    if (!row || now - row.window_start > DISPUTE_WINDOW_MS) {
      db.prepare(
        "INSERT INTO match_dispute_counts(user_id,count,window_start) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET count=0, window_start=?",
      ).run(userId, 0, now, now);
      row = { count: 0, window_start: now };
    }
    if (row.count >= DISPUTE_MAX)
      throw new Error(
        "Limite de disputas (3/24h). Aguarde antes de abrir nova revisão.",
      );
    db.prepare(
      "UPDATE match_dispute_counts SET count=count+1 WHERE user_id=?",
    ).run(userId);
  },
};

export const PlanoBeta = {
  isOpen() {
    return String(process.env.BETA_CLOSED || "").toLowerCase() !== "1";
  },
  allow(email) {
    const e = String(email || "").toLowerCase();
    db.prepare(
      "INSERT OR IGNORE INTO beta_allowlist(email,note) VALUES(?,?)",
    ).run(e, "manual");
  },
  isAllowed(email) {
    if (this.isOpen()) return true;
    return !!db
      .prepare("SELECT 1 FROM beta_allowlist WHERE email=?")
      .get(String(email || "").toLowerCase());
  },
  list() {
    return db.prepare("SELECT * FROM beta_allowlist ORDER BY created_at DESC").all();
  },
};

export const PlanoChat = {
  append(roomId, userId, username, body) {
    db.prepare(
      "INSERT INTO room_chat_log(room_id,user_id,username,body,at) VALUES(?,?,?,?,?)",
    ).run(roomId, userId, username, body.slice(0, 280), Date.now());
    // trim
    db.prepare(
      `DELETE FROM room_chat_log WHERE id NOT IN (
        SELECT id FROM room_chat_log WHERE room_id=? ORDER BY id DESC LIMIT 200
      ) AND room_id=?`,
    ).run(roomId, roomId);
  },
  history(roomId, limit = 50) {
    return db
      .prepare(
        "SELECT username, body, at FROM room_chat_log WHERE room_id=? ORDER BY id DESC LIMIT ?",
      )
      .all(roomId, limit)
      .reverse();
  },
  mute(roomId, userId, minutes = 10) {
    const until = Date.now() + minutes * 60 * 1000;
    db.prepare(
      "INSERT INTO chat_mutes(room_id,user_id,until_ms) VALUES(?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET until_ms=?",
    ).run(roomId, userId, until, until);
  },
  isMuted(roomId, userId) {
    const row = db
      .prepare("SELECT until_ms FROM chat_mutes WHERE room_id=? AND user_id=?")
      .get(roomId, userId);
    return !!(row && row.until_ms > Date.now());
  },
};

export const PlanoCharacters = {
  set(matchId, userId, character) {
    db.prepare(
      "INSERT INTO character_picks(match_id,user_id,character) VALUES(?,?,?) ON CONFLICT(match_id,user_id) DO UPDATE SET character=?",
    ).run(matchId, userId, String(character).slice(0, 32), String(character).slice(0, 32));
  },
  list(matchId) {
    return db
      .prepare("SELECT user_id, character FROM character_picks WHERE match_id=?")
      .all(matchId);
  },
};
