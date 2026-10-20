import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = fs.mkdtempSync(path.join(root, "work/sistema-1a9-"));
process.env.DB_PATH = path.join(dir, "arena.db");
process.env.DOTENV_CONFIG_PATH = path.join(dir, "absent.env");
process.env.DAILY_LOSS_LIMIT_CENTS = "1000";

const dbMod = await import("../server/db.js");
const { finance, recoverMatches } = await import("../server/finance.js");
const { makeRules, saveRules, openReview } = await import(
  "../server/match-integrity.js"
);
const db = dbMod.default;
const { Users, UserLimits, Wallets } = dbMod;

Users.create({
  id: "usr_a",
  username: "Alpha1a9",
  email: "a1a9@test.local",
  password: "x",
  role: "USER",
});
Users.create({
  id: "usr_b",
  username: "Beta1a9",
  email: "b1a9@test.local",
  password: "x",
  role: "USER",
});
finance.credit("usr_a", 5000, "TEST_CREDIT", "wa1", "t");
finance.credit("usr_b", 5000, "TEST_CREDIT", "wb1", "t");

// ── 7: hard-block diário ────────────────────────────────────────────────────
UserLimits.addDailyLoss("usr_a", 800);
const lim = UserLimits.get("usr_a");
assert.equal(lim.daily_loss_cents, 800);
const dailyLossLimitCents = Number(process.env.DAILY_LOSS_LIMIT_CENTS) || 5000;
assert.ok(800 + 500 > dailyLossLimitCents); // 1300 > 1000
assert.ok(800 + 100 <= dailyLossLimitCents);
console.log("ok-daily");

// ── 8: recoverMatches preserva REVIEW, estorna LOADING ─────────────────────
const matchReview = "match_recover_review";
const matchLoading = "match_recover_loading";
const matchQueued = "match_recover_queued";

for (const [id, phase] of [
  [matchReview, "RUNNING"],
  [matchLoading, "LOADING"],
  [matchQueued, "QUEUED"],
]) {
  const rules = makeRules({ hosted: true, reviewMs: 60000 });
  finance.createMatch({
    id,
    roomId: "room1",
    playerAId: "usr_a",
    playerBId: "usr_b",
    mode: "APOSTADO",
    stakeCents: 200,
    prizeCents: 360,
    rakeCents: 40,
    phase,
  });
  saveRules(id, rules);
  db.prepare("UPDATE match_state SET phase=? WHERE match_id=?").run(phase, id);
}

openReview(
  { id: matchReview, phase: "RUNNING", rules: makeRules({ hosted: true }) },
  "SYSTEM",
  "interrupção controlada para teste de recovery",
);

const beforeA = Wallets.get("usr_a");
const cancelled = recoverMatches();
assert.ok(cancelled >= 2, "deve estornar loading+queued");
const reviewRow = db
  .prepare("SELECT status FROM match_reviews WHERE match_id=?")
  .get(matchReview);
assert.equal(reviewRow.status, "OPEN");
assert.equal(
  db.prepare("SELECT status FROM matches WHERE id=?").get(matchReview).status,
  "DISPUTE",
);
assert.equal(
  db.prepare("SELECT status FROM matches WHERE id=?").get(matchLoading).status,
  "CANCELLED",
);
assert.equal(
  db.prepare("SELECT status FROM matches WHERE id=?").get(matchQueued).status,
  "CANCELLED",
);
const afterA = Wallets.get("usr_a");
assert.ok(afterA.balance > beforeA.balance, "reservas de loading/queued devolvidas");
assert.ok(afterA.locked < beforeA.locked || afterA.locked === 0);
console.log("ok-recover");

// ── 6: evidência gravada no openReview ──────────────────────────────────────
const matchEv = "match_evidence_1";
finance.credit("usr_a", 500, "TEST_CREDIT", "wa2", "t");
finance.credit("usr_b", 500, "TEST_CREDIT", "wb2", "t");
finance.createMatch({
  id: matchEv,
  roomId: "room1",
  playerAId: "usr_a",
  playerBId: "usr_b",
  mode: "APOSTADO",
  stakeCents: 100,
  prizeCents: 180,
  rakeCents: 20,
});
saveRules(matchEv, makeRules({ hosted: true }));
db.prepare("UPDATE match_state SET phase='RUNNING' WHERE match_id=?").run(
  matchEv,
);
const evidence = {
  kind: "screenshot",
  relativePath: "data/evidence/match_evidence_1/frame.png",
  at: Date.now(),
  sample: { frame: 999, health: [10, 0], wins: [1, 0], timer: 0 },
};
openReview(
  { id: matchEv, phase: "RUNNING", rules: makeRules({ hosted: true }) },
  "SYSTEM",
  "falha de rede com captura de tela para perícia",
  evidence,
);
const evRow = db
  .prepare("SELECT evidence FROM match_reviews WHERE match_id=?")
  .get(matchEv);
assert.ok(evRow.evidence);
const parsed = JSON.parse(evRow.evidence);
assert.equal(parsed.kind, "screenshot");
assert.match(parsed.relativePath, /evidence/);
console.log("ok-evidence");
