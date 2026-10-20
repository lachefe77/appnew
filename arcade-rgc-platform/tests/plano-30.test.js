/**
 * Cobertura do plano fliperama 30.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreInputBurst,
  computeAmlRisk,
  Social,
  TournamentEscrow,
  matchReceipt,
  forfeitRulesCopy,
} from "../server/plano-30.js";
import { TournamentEngine } from "../server/tournaments.js";
import { createPaymentProvider } from "../server/payment-provider.js";
import {
  createFreerollRegistration,
  registerFreerollPlayer,
  freerollPendingSlots,
  freerollCheckIn,
  FREEROLL_SIZE,
} from "../server/freeroll.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("9: macro burst score flag", () => {
  const t0 = 1000;
  const samples = Array.from({ length: 12 }, (_, i) => ({
    t: t0 + i * 20,
    button: 0,
  }));
  const s = scoreInputBurst(samples);
  assert.ok(s.score > 0.5);
  assert.equal(s.flag, true);
});

test("10: AML risk levels", () => {
  const r = computeAmlRisk("usr_nonexistent_" + Date.now());
  assert.ok(["BAIXO", "MÉDIO", "CRÍTICO"].includes(r.level));
});

test("15: PaymentProvider asaas off por padrão", async () => {
  const p = createPaymentProvider({ simulation: true });
  const d = await p.createDeposit({ userId: "u", amountCents: 100 });
  assert.equal(d.mock, true);
  const off = createPaymentProvider({ simulation: false });
  await assert.rejects(() => off.createDeposit({ userId: "u", amountCents: 100 }));
});

test("19: tournament escrow buy-in", () => {
  const id = "tour_esc_" + Date.now();
  TournamentEscrow.ensure(id);
  TournamentEscrow.addBuyIn(id, 1000);
  TournamentEscrow.addBuyIn(id, 1000);
  assert.equal(TournamentEscrow.get(id).pool_cents, 2000);
});

test("21: bracket reportWinner avança", () => {
  const eng = new TournamentEngine();
  const id = "tour_br_" + Date.now();
  eng.createTournament({
    id,
    title: "T",
    gameCode: "kof2002",
    maxPlayers: 2,
    buyInCents: 0,
    startTime: "12:00",
  });
  eng.registerPlayer(id, "a", "A");
  eng.registerPlayer(id, "b", "B");
  assert.equal(eng.get(id).status, "RUNNING");
  eng.reportWinner(id, 0, 0, "a");
  assert.equal(eng.get(id).championId, "a");
});

test("22: freeroll check-in slots", () => {
  const reg = createFreerollRegistration({ id: "fr30" });
  const ids = Array.from({ length: FREEROLL_SIZE }, (_, i) => "p" + i);
  for (const id of ids) registerFreerollPlayer(reg, id);
  const pending = freerollPendingSlots(reg);
  assert.ok(pending.length >= 1);
  freerollCheckIn(reg, pending[0].roundIndex, pending[0].matchIndex, pending[0].a);
  assert.equal(reg.rounds[0][0].checkIn.a, true);
});

test("20/6: receipt + forfeit copy", () => {
  const r = matchReceipt({
    matchId: "m",
    mode: "APOSTADO",
    stakeCents: 500,
    prizeCents: 900,
    rakeCents: 100,
    winnerId: "u1",
    seriesScore: { a: 2, b: 1 },
    seriesBestOf: 3,
  });
  assert.equal(r.stakeReais, "5.00");
  assert.ok(forfeitRulesCopy().rules.length >= 3);
});

test("26: friends request/accept", () => {
  const a = "usr_fa_" + Date.now();
  const b = "usr_fb_" + Date.now();
  Social.requestFriend(a, b);
  Social.acceptFriend(b, a);
  assert.ok(Social.listFriends(a).some((f) => f.friend_id === b));
});

test("assets plano 30", () => {
  for (const f of [
    "public/plano-30-ui.js",
    "public/amigos.html",
    "server/plano-30.js",
  ]) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
  const src = fs.readFileSync(path.join(root, "server/platform.js"), "utf8");
  assert.match(src, /MEDIA_ICE_RESTART/);
  assert.match(src, /INPUT_ANOMALY/);
  assert.match(src, /\/api\/overlay\/live/);
  assert.match(src, /ASAAS_ENABLED/);
});
