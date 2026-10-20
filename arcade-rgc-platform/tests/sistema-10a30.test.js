/**
 * Cobertura das melhorias 10–30 (estabilidade, escala, CI).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  createReadyCheck,
  ackReady,
  tickCountdown,
} from "../server/ready-check.js";
import {
  computeCommandToImageMs,
  latencyRollingStats,
} from "../server/command-latency.js";
import { createPaymentProvider } from "../server/payment-provider.js";
import { sendAlert, alertOnHealthFailure } from "../server/alerts.js";
import {
  generateTotpSecret,
  totpAt,
  verifyTotp,
  assertAdminMfa,
  clearMfaReplayForTests,
} from "../server/admin-mfa.js";
import { WarmPool } from "../server/warm-pool.js";
import {
  createFreerollRegistration,
  registerFreerollPlayer,
  reportFreerollWinner,
  FREEROLL_SIZE,
  createFreerollBracket,
} from "../server/freeroll.js";
import { ReplayEngine } from "../server/replays.js";
import { runOffboxBackup } from "../scripts/offbox-backup.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("10: ready-check ACK → countdown → DONE", () => {
  const st = createReadyCheck({ matchId: "m1", countdownSec: 2 });
  assert.equal(ackReady(st, "a").type, "READY_CHECK_UPDATE");
  const start = ackReady(st, "b");
  assert.equal(start.type, "READY_CHECK_COUNTDOWN");
  assert.equal(start.remaining, 2);
  assert.equal(tickCountdown(st).remaining, 1);
  assert.equal(tickCountdown(st).type, "READY_CHECK_DONE");
});

test("10: countdown 0 libera na hora dos 2 ACKs", () => {
  const st = createReadyCheck({ matchId: "m2", countdownSec: 0 });
  ackReady(st, "a");
  assert.equal(ackReady(st, "b").type, "READY_CHECK_DONE");
});

test("15: comando→imagem e estatísticas", () => {
  const s = computeCommandToImageMs({
    clientSentAt: 100,
    acceptedAt: 120,
    frameDecodedAt: 145,
  });
  assert.equal(s.commandToImageMs, 45);
  assert.equal(s.serverAckLagMs, 20);
  const stats = latencyRollingStats([s, { commandToImageMs: 50 }, { commandToImageMs: 40 }]);
  assert.equal(stats.count, 3);
  assert.ok(stats.p50 != null);
});

test("16/walletView: código de plataforma expõe 3 buckets", () => {
  const src = fs.readFileSync(path.join(root, "server/platform.js"), "utf8");
  assert.match(src, /availableCents/);
  assert.match(src, /reservedCents/);
  assert.match(src, /disputeCents/);
  assert.match(src, /availableReais/);
  assert.match(src, /reservedReais/);
  assert.match(src, /disputeReais/);
});

test("17: replay persistente em disco", () => {
  const dir = fs.mkdtempSync(path.join(root, "work/replay-"));
  const eng = new ReplayEngine({ dir });
  eng.startRecording("match_r1", "u1", "u2", 500);
  eng.recordInput("match_r1", { slot: 1, button: 0, value: 1, seq: 1 });
  eng.finishRecording("match_r1", "u1");
  const eng2 = new ReplayEngine({ dir });
  const loaded = eng2.getReplay("match_r1");
  assert.ok(loaded);
  assert.equal(loaded.winnerId, "u1");
  assert.ok(loaded.frames.length >= 1);
  assert.ok(eng2.listRecentReplays().some((r) => r.matchId === "match_r1"));
});

test("18: alerta webhook mock; no-op sem URL", async () => {
  const none = await sendAlert({ text: "x" }, { url: "" });
  assert.equal(none.skipped, true);
  const calls = [];
  const ok = await sendAlert(
    { text: "down" },
    {
      url: "https://hooks.example/test",
      fetchImpl: async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, status: 200 };
      },
    },
  );
  assert.equal(ok.sent, true);
  assert.match(calls[0].body.text, /down/);
  const healthy = await alertOnHealthFailure({ ok: true, reconciliation: true });
  assert.equal(healthy.skipped, true);
});

test("19: off-box backup copia para remoto local (cp)", async () => {
  const base = fs.mkdtempSync(path.join(root, "work/offbox-"));
  const src = path.join(base, "arena.db");
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(src);
  db.exec(
    `CREATE TABLE wallets(user_id TEXT,balance INTEGER,locked INTEGER);
     CREATE TABLE finance_entries(event_id TEXT,account TEXT,delta INTEGER);
     CREATE TABLE reservations(user_id TEXT,amount INTEGER,status TEXT);
     INSERT INTO wallets VALUES('u1',100,0);
     INSERT INTO finance_entries VALUES('o','user:u1:available',100),('o','user:u1:locked',0),('o','external:opening',-100);`,
  );
  db.close();
  const remote = path.join(base, "remote");
  fs.mkdirSync(remote);
  const result = await runOffboxBackup({
    source: src,
    localDir: path.join(base, "local"),
    remoteDir: remote,
  });
  assert.equal(result.remote.skipped, false);
  assert.ok(fs.existsSync(result.remote.destFile));
});

test("20: tutorial prefs na API (fonte)", () => {
  const src = fs.readFileSync(path.join(root, "server/platform.js"), "utf8");
  assert.match(src, /\/api\/me\/tutorial/);
  assert.match(src, /UserPrefs\.setTutorial/);
});

test("21: find-match ordena por região + RTT (db)", async () => {
  const dir = fs.mkdtempSync(path.join(root, "work/mm-"));
  process.env.DB_PATH = path.join(dir, "arena.db");
  process.env.DOTENV_CONFIG_PATH = path.join(dir, "absent.env");
  const { MatchmakingQueue, Users } = await import(
    "../server/db.js?" + Date.now() + Math.random()
  );
  for (const [id, name] of [
    ["ua", "A"],
    ["ub", "B"],
    ["uc", "C"],
  ]) {
    Users.create({
      id,
      username: name + Date.now() + Math.random().toString(16).slice(2, 6),
      email: id + Date.now() + "@t.local",
      password: "x",
      role: "USER",
    });
  }
  MatchmakingQueue.join("ua", 1200, "APOSTADO", 500, "room1", 1, {
    region: "Sudeste",
    rttMs: 40,
  });
  MatchmakingQueue.join("ub", 1210, "APOSTADO", 500, "room1", 1, {
    region: "Nordeste",
    rttMs: 30,
  });
  MatchmakingQueue.join("uc", 1190, "APOSTADO", 500, "room1", 1, {
    region: "Sudeste",
    rttMs: 50,
  });
  const found = MatchmakingQueue.findMatch(
    "ua",
    1200,
    "APOSTADO",
    500,
    "room1",
    1,
    { region: "Sudeste" },
  );
  assert.equal(found.user_id, "uc");
});

test("22: worker envia stream WebRTC; cliente ativa áudio", () => {
  const src = fs.readFileSync(path.join(root, "server/hosted-worker.js"), "utf8");
  assert.match(src, /addTrack/);
  assert.match(src, /getTracks\(\)/);
  const loader = fs.readFileSync(path.join(root, "public/fbneo-loader.js"), "utf8");
  assert.match(loader, /ATIVAR SOM/);
  assert.match(loader, /video\.muted = false/);
});

test("23: multi-sessão documentada + cap configurável", () => {
  const src = fs.readFileSync(path.join(root, "server/platform.js"), "utf8");
  assert.match(src, /HOSTED_MAX_SESSIONS/);
  assert.match(src, /\/api\/ops\/hosted-cap/);
  assert.match(src, /process-worker-per-session/);
});

test("24: warm pool acquire/release/drain", async () => {
  let n = 0;
  const pool = new WarmPool({
    size: 2,
    factory: async () => {
      n++;
      return {
        id: n,
        async warmReady() {},
        async bind() {},
        async reset() {},
        async stop() {},
      };
    },
  });
  await pool.start();
  assert.equal(pool.stats().idle, 2);
  const a = await pool.acquire();
  assert.equal(pool.stats().busy, 1);
  await pool.release(a);
  assert.equal(pool.stats().idle, 2);
  await pool.drain();
  assert.equal(pool.stats().idle, 0);
});

test("25: espectador read-only no fonte", () => {
  const src = fs.readFileSync(path.join(root, "server/platform.js"), "utf8");
  assert.match(src, /SPECTATE_JOIN/);
  assert.match(src, /SPECTATE_STARTED/);
  assert.match(src, /readOnly: true/);
});

test("26: PaymentProvider mock vs PIX off", async () => {
  const off = createPaymentProvider({ simulation: false });
  await assert.rejects(
    () => off.createDeposit({ userId: "u", amountCents: 100 }),
    (e) => e.status === 409,
  );
  const mock = createPaymentProvider({ simulation: true });
  const d = await mock.createDeposit({ userId: "u", amountCents: 100 });
  assert.equal(d.mock, true);
  assert.equal(d.status, "MOCK_APPROVED");
});

test("27: freeroll 8 jogadores fecha bracket", () => {
  const reg = createFreerollRegistration({ id: "fr1" });
  const ids = Array.from({ length: FREEROLL_SIZE }, (_, i) => "p" + i);
  for (const id of ids) registerFreerollPlayer(reg, id);
  assert.equal(reg.status, "RUNNING");
  assert.equal(reg.rounds[0].length, 4);
  // R1
  for (let i = 0; i < 4; i++)
    reportFreerollWinner(reg, 0, i, ids[i * 2]);
  assert.equal(reg.rounds[1][0].status, "PENDING");
  reportFreerollWinner(reg, 1, 0, ids[0]);
  reportFreerollWinner(reg, 1, 1, ids[4]);
  reportFreerollWinner(reg, 2, 0, ids[0]);
  assert.equal(reg.status, "DONE");
  assert.equal(reg.championId, "p0");
  assert.throws(() => createFreerollBracket(ids.slice(0, 7)), /8/);
});

test("28: MFA TOTP + replay", () => {
  clearMfaReplayForTests();
  const secret = generateTotpSecret();
  const code = totpAt(secret);
  assert.equal(verifyTotp(secret, code), true);
  assertAdminMfa({ userId: "admin", code, secret, enforce: true });
  assert.throws(
    () => assertAdminMfa({ userId: "admin", code, secret, enforce: true }),
    /já utilizado|MFA/,
  );
  assert.throws(
    () =>
      assertAdminMfa({
        userId: "admin",
        code: "000000",
        secret,
        enforce: true,
      }),
    /inválido/,
  );
});

test("13/29: control profiles + match history (child)", async () => {
  const child = spawn(
    process.execPath,
    [path.join(root, "tests/sistema-10a30-child.js")],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, err || out);
  assert.match(out, /ok-controls/);
  assert.match(out, /ok-history/);
  assert.match(out, /ok-wallet/);
  assert.match(out, /ok-tutorial/);
});

test("11/12: placar e rematch no fonte", () => {
  const src = fs.readFileSync(path.join(root, "server/platform.js"), "utf8");
  assert.match(src, /SCOREBOARD_UPDATE/);
  assert.match(src, /REMATCH_AVAILABLE/);
  assert.match(src, /REMATCH_OFFER/);
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /REMATCH_OFFER/);
  assert.match(html, /challengeId/);
  assert.match(html, /walletReservedVal/);
  assert.match(html, /readyCheckOverlay/);
});

test("14: anti stuck visibilitychange no loader", () => {
  const src = fs.readFileSync(path.join(root, "public/fbneo-loader.js"), "utf8");
  assert.match(src, /visibilitychange/);
  assert.match(src, /pagehide/);
  assert.match(src, /releaseAll/);
});

test("30: E2E partida 100% (child fixture)", async () => {
  const child = spawn(
    process.execPath,
    [path.join(root, "tests/partida-100-child.js")],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "development",
        ENABLE_SIMULATED_FUNDS: "1",
        READY_CHECK_COUNTDOWN_SEC: "0",
        DB_PATH: path.join(root, "data", "test-partida100-" + process.pid + ".db"),
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
  assert.match(out, /ok-partida-100/);
});
