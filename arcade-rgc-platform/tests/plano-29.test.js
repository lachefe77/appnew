/**
 * Cobertura mínima do plano fliperama (itens 1–29, exceto 30).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wsRateLimit } from "../server/ratelimit.js";
import { TournamentEngine } from "../server/tournaments.js";
import { PlanoClans, PlanoDisputes, PlanoBeta } from "../server/sistema-plano.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("1: PLAYER_INPUT não esgota bucket com 200 msgs/s", () => {
  const ws = {};
  for (let i = 0; i < 200; i++) assert.equal(wsRateLimit(ws, "PLAYER_INPUT"), true);
  assert.equal(wsRateLimit(ws, "PLAYER_INPUT"), true);
});

test("11: torneio aceita inscrição até maxPlayers", () => {
  const eng = new TournamentEngine();
  const id = "tour_test_" + Date.now();
  eng.createTournament({
    id,
    title: "Teste",
    gameCode: "kof2002",
    maxPlayers: 2,
    buyInCents: 0,
    startTime: "12:00",
  });
  eng.registerPlayer(id, "u1", "A");
  eng.registerPlayer(id, "u2", "B");
  assert.equal(eng.get(id).status, "LOCKED");
  assert.ok(eng.get(id).bracket.length >= 1);
});

test("13: clãs SQLite create/join", () => {
  const tag = "T" + String(Date.now()).slice(-3);
  const c = PlanoClans.create(tag, "Test Clan", "desc", "usr_leader_" + tag);
  assert.equal(c.tag, tag);
  PlanoClans.join(tag, "usr_member_" + tag);
  assert.ok(PlanoClans.ofUser("usr_member_" + tag));
});

test("9: anti-rage dispute limita a 3/24h", () => {
  const uid = "usr_dispute_" + Date.now();
  PlanoDisputes.assertCanDispute(uid);
  PlanoDisputes.assertCanDispute(uid);
  PlanoDisputes.assertCanDispute(uid);
  assert.throws(() => PlanoDisputes.assertCanDispute(uid), /Limite/);
});

test("27–28: páginas legais e PWA existem", () => {
  for (const f of [
    "public/termos.html",
    "public/privacidade.html",
    "public/recuperar-senha.html",
    "public/ranking.html",
    "public/clas.html",
    "public/freeroll.html",
    "public/replay.html",
    "public/plano-ui.js",
    "public/icons/icon-192.png",
    "public/manifest.json",
    "public/sw.js",
  ]) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test("28: beta allowlist API no fonte", () => {
  const src = fs.readFileSync(path.join(root, "server/platform.js"), "utf8");
  assert.match(src, /\/api\/auth\/forgot/);
  assert.match(src, /\/api\/auth\/reset/);
  assert.match(src, /SELECT_CHARACTER/);
  assert.match(src, /PlanoChat/);
  assert.match(src, /BACKUP_INTERVAL_MS/);
  assert.match(src, /otpauth/);
  assert.equal(PlanoBeta.isOpen(), true);
});
