import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = fs.mkdtempSync(path.join(root, "work/sistema-10a30-"));
process.env.DB_PATH = path.join(dir, "arena.db");
process.env.DOTENV_CONFIG_PATH = path.join(dir, "absent.env");

const dbMod = await import("../server/db.js");
const { finance } = await import("../server/finance.js");
const {
  Users,
  ControlProfiles,
  UserPrefs,
  MatchHistory,
  Wallets,
} = dbMod;

Users.create({
  id: "usr_c1",
  username: "CtrlOne",
  email: "c1@test.local",
  password: "x",
  role: "USER",
});
Users.create({
  id: "usr_c2",
  username: "CtrlTwo",
  email: "c2@test.local",
  password: "x",
  role: "USER",
});

const controls = {
  keyboard: {
    ArrowUp: 4,
    ArrowDown: 5,
    ArrowLeft: 6,
    ArrowRight: 7,
    KeyZ: 0,
    KeyX: 8,
    KeyA: 1,
    KeyS: 9,
    Enter: 3,
    Digit5: 2,
  },
  device: "auto",
  pads: {},
};
ControlProfiles.save("usr_c1", controls);
const loaded = ControlProfiles.get("usr_c1");
assert.equal(loaded.controls.device, "auto");
assert.equal(loaded.controls.keyboard.KeyZ, 0);
console.log("ok-controls");

UserPrefs.setTutorial("usr_c1", { done: false, step: 1 });
UserPrefs.setTutorial("usr_c1", { done: true, step: 3 });
const pref = UserPrefs.get("usr_c1");
assert.equal(pref.tutorial_done, 1);
assert.equal(pref.tutorial_step, 3);
console.log("ok-tutorial");

finance.credit("usr_c1", 5000, "TEST_CREDIT", "t1", "t");
finance.credit("usr_c2", 5000, "TEST_CREDIT", "t2", "t");
finance.createMatch({
  id: "match_hist_1",
  roomId: "room1",
  playerAId: "usr_c1",
  playerBId: "usr_c2",
  mode: "APOSTADO",
  stakeCents: 200,
  prizeCents: 360,
  rakeCents: 40,
});
finance.settleMatch("match_hist_1", "usr_c1");
const hist = MatchHistory.forUser("usr_c1");
assert.ok(hist.length >= 1);
assert.equal(hist[0].player_a_username, "CtrlOne");
assert.equal(hist[0].won, 1);
console.log("ok-history");

const w = Wallets.get("usr_c1");
assert.ok(w.balance >= 0);
// Simula disputa locked: cria match DISPUTE
finance.credit("usr_c1", 1000, "TEST_CREDIT", "t3", "t");
finance.credit("usr_c2", 1000, "TEST_CREDIT", "t4", "t");
finance.createMatch({
  id: "match_disp_1",
  roomId: "room1",
  playerAId: "usr_c1",
  playerBId: "usr_c2",
  mode: "APOSTADO",
  stakeCents: 100,
  prizeCents: 180,
  rakeCents: 20,
});
dbMod.default
  .prepare("UPDATE matches SET status='DISPUTE', dispute=1 WHERE id=?")
  .run("match_disp_1");
const locked = Wallets.get("usr_c1").locked;
assert.ok(locked >= 100);
console.log("ok-wallet");
