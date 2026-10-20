import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateRake, rakeCentsForPot } from "../server/escrow.js";
import {
  ipMatches,
  authLockKey,
  assertAuthNotLocked,
  recordAuthFailure,
  clearAuthFailures,
} from "../server/security.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("rake da sala prevalece sobre tabela VIP", () => {
  assert.equal(rakeCentsForPot(500, { roomRakePercent: 10 }), 100);
  assert.equal(rakeCentsForPot(500, { roomRakePercent: 0 }), 0);
  const vipRake = rakeCentsForPot(500, { vipLevel: "BRONZE" });
  assert.equal(vipRake, Math.round(1000 * calculateRake(500, "BRONZE")));
  assert.ok(vipRake > 0);
});

test("allowlist de IP admin aceita CIDR e IPv4 mapeado", () => {
  assert.equal(ipMatches("192.168.1.40", "192.168.1.0/24"), true);
  assert.equal(ipMatches("10.0.0.2", "192.168.1.0/24"), false);
  assert.equal(ipMatches("::ffff:127.0.0.1", "127.0.0.1"), true);
});

test("lockout de autenticação após falhas repetidas", () => {
  const key = authLockKey("127.0.0.1", "lockout-" + Date.now() + "@test.local");
  clearAuthFailures(key);
  for (let i = 0; i < 7; i++) recordAuthFailure(key);
  assert.doesNotThrow(() => assertAuthNotLocked(key));
  recordAuthFailure(key);
  assert.throws(() => assertAuthNotLocked(key), /Muitas tentativas/);
  clearAuthFailures(key);
  assert.doesNotThrow(() => assertAuthNotLocked(key));
});

test("escrow.js não exporta carteira em memória", async () => {
  const mod = await import("../server/escrow.js");
  assert.equal(typeof mod.calculateRake, "function");
  assert.equal(typeof mod.rakeCentsForPot, "function");
  assert.equal(mod.EscrowManager, undefined);
  assert.equal(mod.getWallet, undefined);
});

test("finance bloqueia settle automático em REVIEW/DISPUTE", async () => {
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [path.join(root, "tests/hardening-finance-child.js")],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, err || out);
  assert.match(out, /ok/);
});
