import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = fs.mkdtempSync(path.join(root, "work/hardening-"));
process.env.DB_PATH = path.join(dir, "arena.db");
process.env.DOTENV_CONFIG_PATH = path.join(dir, "absent.env");

const dbMod = await import("../server/db.js");
const { finance } = await import("../server/finance.js");
const { makeRules, saveRules, openReview } = await import(
  "../server/match-integrity.js"
);
const db = dbMod.default;
const { Users } = dbMod;

Users.create({
  id: "usr_a",
  username: "Alpha",
  email: "a@test.local",
  password: "x",
  role: "USER",
});
Users.create({
  id: "usr_b",
  username: "Beta",
  email: "b@test.local",
  password: "x",
  role: "USER",
});
finance.credit("usr_a", 2000, "TEST_CREDIT", "wa", "t");
finance.credit("usr_b", 2000, "TEST_CREDIT", "wb", "t");

const matchId = "match_review_lock";
const rules = makeRules({ hosted: true, reviewMs: 60000 });
finance.createMatch({
  id: matchId,
  roomId: "room1",
  playerAId: "usr_a",
  playerBId: "usr_b",
  mode: "APOSTADO",
  stakeCents: 500,
  prizeCents: 900,
  rakeCents: 100,
});
saveRules(matchId, rules);
db.prepare("UPDATE match_state SET phase='RUNNING' WHERE match_id=?").run(
  matchId,
);

const m = { id: matchId, phase: "RUNNING", rules };
openReview(m, "SYSTEM", "interrupção de teste");

assert.equal(
  db.prepare("SELECT status FROM matches WHERE id=?").get(matchId).status,
  "DISPUTE",
);
assert.throws(() => finance.settleMatch(matchId, "usr_a"), /revisão|bloqueada/i);
assert.equal(
  finance.settleMatch(matchId, "usr_a", { fromReview: true }),
  true,
);
assert.equal(
  db.prepare("SELECT status FROM matches WHERE id=?").get(matchId).status,
  "RESOLVED",
);
console.log("ok");
