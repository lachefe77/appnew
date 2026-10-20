import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("makeRules documenta série e rage-quit", async () => {
  const { makeRules, seriesWinsNeeded, SERIES_BEST_OF } = await import(
    "../server/match-integrity.js"
  );
  assert.deepEqual([...SERIES_BEST_OF], [1, 3, 5]);
  assert.equal(seriesWinsNeeded(1), 1);
  assert.equal(seriesWinsNeeded(3), 2);
  assert.equal(seriesWinsNeeded(5), 3);
  const rules = makeRules({
    hosted: true,
    seriesBestOf: 3,
    rageQuit: "loss",
  });
  assert.equal(rules.seriesBestOf, 3);
  assert.equal(rules.seriesWinsNeeded, 2);
  assert.equal(rules.rageQuit, "loss");
  assert.match(rules.disconnectAfterRunning, /opponent-series-win/);
  assert.throws(() => makeRules({ seriesBestOf: 2 }), /série/i);
  assert.throws(() => makeRules({ rageQuit: "ban" }), /rage-quit/i);
});

test("InviteCodes gera KOF-XXXX e redeem consome uso", async () => {
  const dbPath = path.join(
    root,
    "data",
    "test-invites-" + process.pid + ".db",
  );
  try {
    fs.rmSync(dbPath, { force: true });
    process.env.DB_PATH = dbPath;
    // Isola módulo db com banco próprio.
    const { InviteCodes, Users } = await import(
      "../server/db.js?" + Date.now()
    );
    Users.create({
      id: "usr_invite_test",
      username: "InviteTester",
      email: "invite-" + Date.now() + "@test.local",
      password: "x:y",
      role: "USER",
    });
    const invite = InviteCodes.allocate({
      roomId: "room_kof_test",
      createdBy: "usr_invite_test",
      kind: "ROOM",
      maxUses: 2,
      ttlMs: 60000,
    });
    assert.match(invite.code, /^KOF-[A-Z2-9]{4}$/);
    const once = InviteCodes.redeem(invite.code);
    assert.equal(once.uses, 1);
    InviteCodes.redeem(invite.code.toLowerCase());
    assert.throws(() => InviteCodes.redeem(invite.code), /esgotado/i);
  } finally {
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {}
  }
});

test("série Bo3 só liquida após 2 games (fixture)", async () => {
  const child = spawn(
    process.execPath,
    [path.join(root, "tests/match-series-child.js")],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ENABLE_SIMULATED_FUNDS: "1",
        DB_PATH: path.join(root, "data", "test-series-" + process.pid + ".db"),
        PORT: "0",
        HOST: "127.0.0.1",
        MATCH_LOADING_MS: "60000",
        RECONNECT_GRACE_MS: "500",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, err || out);
  assert.match(out, /ok/);
});
