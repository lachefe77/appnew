import crypto from "node:crypto";
import db, { Wallets, Transactions, calculateElo } from "./db.js";

export function cents(value, { zero = false, max = 100000000 } = {}) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > max)
    throw new Error("Informe um valor inteiro válido em centavos.");
  return value;
}
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS finance_events(id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS finance_entries(id INTEGER PRIMARY KEY, event_id TEXT NOT NULL REFERENCES finance_events(id), account TEXT NOT NULL, delta INTEGER NOT NULL CHECK(typeof(delta)='integer'));
  CREATE TABLE IF NOT EXISTS reservations(ref TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0), status TEXT NOT NULL DEFAULT 'LOCKED', PRIMARY KEY(ref,user_id));
  CREATE TABLE IF NOT EXISTS coupon_redemptions(code TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(code,user_id));
  CREATE TABLE IF NOT EXISTS coupons(code TEXT PRIMARY KEY, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), max_uses INTEGER NOT NULL CHECK(max_uses>0), active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS platform_rooms(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS match_state(match_id TEXT PRIMARY KEY REFERENCES matches(id), mode TEXT NOT NULL, phase TEXT NOT NULL, finish_reason TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now')));
  CREATE TRIGGER IF NOT EXISTS wallets_valid_insert BEFORE INSERT ON wallets
    WHEN typeof(NEW.balance)!='integer' OR typeof(NEW.locked)!='integer' OR NEW.balance<0 OR NEW.locked<0
    BEGIN SELECT RAISE(ABORT,'Saldo ou reserva inválidos'); END;
  CREATE TRIGGER IF NOT EXISTS wallets_valid_update BEFORE UPDATE ON wallets
    WHEN typeof(NEW.balance)!='integer' OR typeof(NEW.locked)!='integer' OR NEW.balance<0 OR NEW.locked<0
    BEGIN SELECT RAISE(ABORT,'Saldo ou reserva inválidos'); END;
`);
function event(id, kind, ref, entries) {
  if (entries.reduce((n, e) => n + e[1], 0) !== 0)
    throw new Error("Lançamento não balanceado.");
  db.prepare("INSERT INTO finance_events(id,kind,ref) VALUES(?,?,?)").run(
    id,
    kind,
    ref,
  );
  const insert = db.prepare(
    "INSERT INTO finance_entries(event_id,account,delta) VALUES(?,?,?)",
  );
  for (const [account, delta] of entries)
    if (delta) insert.run(id, account, delta);
}
const available = (id) => `user:${id}:available`,
  locked = (id) => `user:${id}:locked`;
function wallet(id) {
  const w = Wallets.get(id);
  if (!w) throw new Error("Conta não encontrada.");
  return w;
}
function txRecord(id, type, amount, ref, description = type) {
  Transactions.record(id, type, amount, wallet(id).balance, description, ref);
}

// Preserve existing balances as an explicit opening position; never reset customer funds.
db.transaction(() => {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version=1").get())
    return;
  const rows = db.prepare("SELECT * FROM wallets").all();
  for (const w of rows) {
    if (
      !Number.isSafeInteger(w.balance) ||
      !Number.isSafeInteger(w.locked) ||
      w.balance < 0 ||
      w.locked < 0
    )
      throw new Error(
        "Carteira legada inválida: conciliação manual necessária antes da migração.",
      );
    event("opening:" + w.user_id, "OPENING_BALANCE", w.user_id, [
      [available(w.user_id), w.balance],
      [locked(w.user_id), w.locked],
      ["external:opening", -w.balance - w.locked],
    ]);
  }
  // Adopt only reserves whose recorded amount is covered by the legacy locked balance.
  const assigned = new Map();
  const adopt = (ref, id, kind, amount) => {
    if (amount === 0) return;
    cents(amount);
    const sum = (assigned.get(id) || 0) + amount;
    if (sum > wallet(id).locked)
      throw new Error(
        "Reservas legadas inconsistentes; restaure e concilie antes de iniciar.",
      );
    assigned.set(id, sum);
    db.prepare(
      "INSERT INTO reservations(ref,user_id,kind,amount) VALUES(?,?,?,?)",
    ).run(ref, id, kind, amount);
  };
  for (const m of db
    .prepare("SELECT * FROM matches WHERE status='IN_PROGRESS'")
    .all()) {
    adopt(m.id, m.player_a_id, "MATCH", m.stake_cents);
    adopt(m.id, m.player_b_id, "MATCH", m.stake_cents);
    db.prepare(
      "INSERT OR IGNORE INTO match_state(match_id,mode,phase) VALUES(?,'APOSTADO','LOADING')",
    ).run(m.id);
  }
  for (const w of db
    .prepare("SELECT * FROM pending_withdrawals WHERE status='PENDENTE'")
    .all())
    adopt(w.id, w.user_id, "WITHDRAWAL", w.amount_cents);
  db.prepare("INSERT INTO schema_migrations(version) VALUES(1)").run();
}).immediate();

function reserve(ref, id, amount, kind) {
  cents(amount);
  wallet(id);
  const r = db
    .prepare(
      "UPDATE wallets SET balance=balance-?,locked=locked+? WHERE user_id=? AND balance>=?",
    )
    .run(amount, amount, id, amount);
  if (r.changes !== 1) throw new Error("Saldo insuficiente.");
  db.prepare(
    "INSERT INTO reservations(ref,user_id,kind,amount) VALUES(?,?,?,?)",
  ).run(ref, id, kind, amount);
  event(`reserve:${ref}:${id}`, kind + "_LOCK", ref, [
    [available(id), -amount],
    [locked(id), amount],
  ]);
  txRecord(
    id,
    kind === "MATCH" ? "ESCROW_LOCK" : "WITHDRAWAL_REQUESTED",
    -amount,
    ref,
  );
}
function consume(ref, id) {
  const r = db
    .prepare(
      "SELECT * FROM reservations WHERE ref=? AND user_id=? AND status='LOCKED'",
    )
    .get(ref, id);
  if (!r) throw new Error("Reserva não disponível.");
  db.prepare("UPDATE wallets SET locked=locked-? WHERE user_id=?").run(
    r.amount,
    id,
  );
  db.prepare(
    "UPDATE reservations SET status='CONSUMED' WHERE ref=? AND user_id=? AND status='LOCKED'",
  ).run(ref, id);
  return r.amount;
}
function release(ref, id) {
  const amount = consume(ref, id);
  db.prepare("UPDATE wallets SET balance=balance+? WHERE user_id=?").run(
    amount,
    id,
  );
  db.prepare(
    "UPDATE reservations SET status='RELEASED' WHERE ref=? AND user_id=?",
  ).run(ref, id);
  event(`release:${ref}:${id}`, "RESERVE_RELEASE", ref, [
    [locked(id), -amount],
    [available(id), amount],
  ]);
  txRecord(id, "RESERVE_RELEASE", amount, ref, "Reserva devolvida");
}

export const finance = {
  credit: db.transaction(
    (id, amount, type, ref = crypto.randomUUID(), desc = type) => {
      cents(amount);
      wallet(id);
      const eventId = `credit:${type}:${ref}:${id}`;
      if (db.prepare("SELECT 1 FROM finance_events WHERE id=?").get(eventId))
        return wallet(id);
      db.prepare(
        "UPDATE wallets SET balance=balance+?,total_deposit=total_deposit+? WHERE user_id=?",
      ).run(amount, type === "PIX_DEPOSIT" ? amount : 0, id);
      event(eventId, type, ref, [
        [available(id), amount],
        ["external:" + type, -amount],
      ]);
      txRecord(id, type, amount, ref, desc);
      return wallet(id);
    },
  ),
  adjust: db.transaction((id, amount, ref, desc) => {
    cents(amount);
    if (wallet(id).balance < amount) throw new Error("Saldo insuficiente.");
    db.prepare("UPDATE wallets SET balance=balance-? WHERE user_id=?").run(
      amount,
      id,
    );
    event("adjust:" + ref, "ADMIN_DEBIT", ref, [
      [available(id), -amount],
      ["external:ADMIN_DEBIT", amount],
    ]);
    txRecord(id, "ADMIN_DEBIT", -amount, ref, desc);
  }),
  createMatch: db.transaction((m) => {
    cents(m.stakeCents, { zero: m.mode === "AMISTOSO" });
    if (m.playerAId === m.playerBId)
      throw new Error("A partida exige duas contas diferentes.");
    const phase = m.phase === "QUEUED" ? "QUEUED" : "LOADING";
    db.prepare(
      `INSERT INTO matches(id,room_id,player_a_id,player_b_id,stake_cents,prize_cents,rake_cents) VALUES(?,?,?,?,?,?,?)`,
    ).run(
      m.id,
      m.roomId,
      m.playerAId,
      m.playerBId,
      m.stakeCents,
      m.prizeCents,
      m.rakeCents,
    );
    db.prepare(
      "INSERT INTO match_state(match_id,mode,phase) VALUES(?,?,?)",
    ).run(m.id, m.mode, phase);
    if (m.stakeCents) {
      reserve(m.id, m.playerAId, m.stakeCents, "MATCH");
      reserve(m.id, m.playerBId, m.stakeCents, "MATCH");
    }
  }),
  cancelMatch: db.transaction(
    (matchId, reason = "Cancelamento", dispute = false) => {
      const m = db.prepare("SELECT * FROM matches WHERE id=?").get(matchId);
      if (!m || !["IN_PROGRESS", "DISPUTE"].includes(m.status)) return false;
      for (const r of db
        .prepare("SELECT * FROM reservations WHERE ref=? AND status='LOCKED'")
        .all(matchId))
        release(matchId, r.user_id);
      db.prepare(
        "UPDATE matches SET status=?,dispute=?,ended_at=datetime('now') WHERE id=?",
      ).run(dispute ? "DISPUTE" : "CANCELLED", dispute ? 1 : 0, matchId);
      db.prepare(
        "UPDATE match_state SET phase='ENDED',finish_reason=?,updated_at=datetime('now') WHERE match_id=?",
      ).run(reason, matchId);
      return true;
    },
  ),
  settleMatch: db.transaction((matchId, winnerId, { fromReview = false } = {}) => {
    const m = db.prepare("SELECT * FROM matches WHERE id=?").get(matchId);
    if (!m) throw new Error("Partida não encontrada.");
    if (![m.player_a_id, m.player_b_id].includes(winnerId))
      throw new Error("Vencedor inválido.");
    if (m.status === "RESOLVED") {
      if (m.winner_id !== winnerId)
        throw new Error("Partida já resolvida com outro vencedor.");
      return false;
    }
    const state = db
      .prepare("SELECT phase FROM match_state WHERE match_id=?")
      .get(matchId);
    if (fromReview) {
      if (m.status !== "DISPUTE" || state?.phase !== "REVIEW")
        throw new Error("Liquidação de revisão inválida.");
    } else if (m.status === "DISPUTE" || state?.phase === "REVIEW") {
      throw new Error("Partida em revisão; liquidação automática bloqueada.");
    } else if (m.status !== "IN_PROGRESS") {
      throw new Error("Partida não está em andamento.");
    }
    const loserId = winnerId === m.player_a_id ? m.player_b_id : m.player_a_id;
    if (m.stake_cents) {
      const a = consume(matchId, m.player_a_id),
        b = consume(matchId, m.player_b_id);
      if (a + b !== m.prize_cents + m.rake_cents)
        throw new Error("Pote inconsistente.");
      db.prepare("UPDATE wallets SET balance=balance+? WHERE user_id=?").run(
        m.prize_cents,
        winnerId,
      );
      event("settle:" + matchId, "MATCH_SETTLEMENT", matchId, [
        [locked(m.player_a_id), -a],
        [locked(m.player_b_id), -b],
        [available(winnerId), m.prize_cents],
        ["platform:revenue", m.rake_cents],
      ]);
      txRecord(
        winnerId,
        "MATCH_WIN",
        m.prize_cents,
        matchId,
        "Prêmio da partida",
      );
      txRecord(loserId, "MATCH_LOSS", 0, matchId, "Reserva destinada ao pote");
    }
    const win = db.prepare("SELECT elo FROM users WHERE id=?").get(winnerId),
      lose = db.prepare("SELECT elo FROM users WHERE id=?").get(loserId);
    const elo = calculateElo(win.elo, lose.elo);
    db.prepare("UPDATE users SET elo=?,wins=wins+1 WHERE id=?").run(
      elo.newWinnerElo,
      winnerId,
    );
    db.prepare("UPDATE users SET elo=?,losses=losses+1 WHERE id=?").run(
      elo.newLoserElo,
      loserId,
    );
    db.prepare(
      "UPDATE matches SET winner_id=?,status='RESOLVED',ended_at=datetime('now') WHERE id=?",
    ).run(winnerId, matchId);
    db.prepare(
      "UPDATE match_state SET phase='ENDED',updated_at=datetime('now') WHERE match_id=?",
    ).run(matchId);
    return true;
  }),
  requestWithdrawal: db.transaction((id, amount, key) => {
    cents(amount);
    if (typeof key !== "string" || !key.trim() || key.length > 150)
      throw new Error("Chave PIX inválida.");
    const ref = "WDR-" + crypto.randomUUID();
    reserve(ref, id, amount, "WITHDRAWAL");
    db.prepare(
      "INSERT INTO pending_withdrawals(id,user_id,amount_cents,pix_key) VALUES(?,?,?,?)",
    ).run(ref, id, amount, key.trim());
    return ref;
  }),
  resolveWithdrawal: db.transaction((ref, approve) => {
    const row = db
      .prepare("SELECT * FROM pending_withdrawals WHERE id=?")
      .get(ref);
    if (!row) throw new Error("Saque não encontrado.");
    const status = approve ? "APROVADO" : "REJEITADO";
    if (row.status === status) return { row, repeated: true };
    if (row.status !== "PENDENTE")
      throw new Error("Saque já processado com outra decisão.");
    if (approve) {
      const amount = consume(ref, row.user_id);
      db.prepare(
        "UPDATE wallets SET total_withdraw=total_withdraw+? WHERE user_id=?",
      ).run(amount, row.user_id);
      event("withdraw:" + ref, "WITHDRAWAL_PAID", ref, [
        [locked(row.user_id), -amount],
        ["external:withdrawals", amount],
      ]);
      txRecord(
        row.user_id,
        "PIX_WITHDRAWAL_LIQUIDATED",
        0,
        ref,
        "Reserva liquidada",
      );
    } else release(ref, row.user_id);
    db.prepare(
      "UPDATE pending_withdrawals SET status=?,resolved_at=datetime('now') WHERE id=? AND status='PENDENTE'",
    ).run(status, ref);
    return { row, repeated: false };
  }),
  redeem: db.transaction((id, code) => {
    const c = db
      .prepare("SELECT * FROM coupons WHERE code=? AND active=1")
      .get(code);
    if (!c) throw new Error("Cupom inválido.");
    if (
      db
        .prepare("SELECT 1 FROM coupon_redemptions WHERE code=? AND user_id=?")
        .get(code, id)
    )
      throw new Error("Cupom já utilizado por esta conta.");
    const used = db
      .prepare("SELECT COUNT(*) n FROM coupon_redemptions WHERE code=?")
      .get(code).n;
    if (used >= c.max_uses) throw new Error("Cupom esgotado.");
    db.prepare("INSERT INTO coupon_redemptions(code,user_id) VALUES(?,?)").run(
      code,
      id,
    );
    return finance.credit(
      id,
      c.amount_cents,
      "COUPON_REDEEM",
      code,
      "Cupom " + code,
    );
  }),
  treasury() {
    return db
      .prepare(
        "SELECT COALESCE(SUM(delta),0) n FROM finance_entries WHERE account='platform:revenue'",
      )
      .get().n;
  },
  reconcile() {
    const mismatches = [];
    for (const w of db.prepare("SELECT * FROM wallets").all()) {
      const sum = (account) =>
        db
          .prepare(
            "SELECT COALESCE(SUM(delta),0) n FROM finance_entries WHERE account=?",
          )
          .get(account).n;
      const reserved = db
        .prepare(
          "SELECT COALESCE(SUM(amount),0) n FROM reservations WHERE user_id=? AND status='LOCKED'",
        )
        .get(w.user_id).n;
      if (
        sum(available(w.user_id)) !== w.balance ||
        sum(locked(w.user_id)) !== w.locked ||
        reserved !== w.locked
      )
        mismatches.push(w.user_id);
    }
    return { ok: mismatches.length === 0, mismatches };
  },
};

export function recoverMatches() {
  // Preserva DISPUTE/REVIEW. Cancela IN_PROGRESS em LOADING/RUNNING/QUEUED
  // (sessão hospedada não sobrevive ao restart do processo).
  const rows = db
    .prepare(
      `SELECT id FROM matches
       WHERE status='IN_PROGRESS'
         AND id NOT IN (SELECT match_id FROM match_state WHERE phase='REVIEW')
         AND id NOT IN (SELECT match_id FROM match_reviews WHERE status='OPEN')`,
    )
    .all();
  for (const m of rows)
    finance.cancelMatch(m.id, "Recuperação após reinicialização");
  return rows.length;
}
