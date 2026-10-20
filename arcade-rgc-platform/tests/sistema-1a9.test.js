/**
 * Cobertura das melhorias 1–9 (partida 100% funcional).
 * Sem browser real/KOF físico: observador sintético + finance/TURN/unidade.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  Kof2002Observer,
  kofProfile,
} from "../server/kof2002-observer.js";
import { mintIceServers } from "../server/turn-credentials.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function state(
  frame,
  { health = [102, 102], wins = [0, 0], timer = 0x60 } = {},
) {
  const bytes = new Uint8Array(kofProfile.stateBytes);
  bytes.set(new TextEncoder().encode("RASTATE\x01MEM "));
  new DataView(bytes.buffer).setUint32(16, frame, true);
  health.forEach(
    (h, i) => (bytes[kofProfile.ramOffset + (kofProfile.health[i] ^ 1)] = h),
  );
  wins.forEach(
    (w, i) => (bytes[kofProfile.ramOffset + kofProfile.wins[i]] = w),
  );
  bytes[kofProfile.ramOffset + kofProfile.timer] = timer;
  return bytes;
}

function armed() {
  const observer = new Kof2002Observer();
  observer.arm();
  observer.startPressed(1);
  observer.startPressed(2);
  observer.observe(state(100));
  return observer;
}

test("1/série: resetForNextGame permite segundo resultado na série", () => {
  const observer = armed();
  observer.observe(state(200, { wins: [1, 0] }));
  observer.observe(state(240, { wins: [1, 0] }));
  assert.equal(
    observer.observe(state(280, { wins: [1, 0] })).result.winnerSlot,
    1,
  );
  assert.equal(observer.finished, true);
  observer.resetForNextGame();
  assert.equal(observer.finished, false);
  assert.equal(observer.started, false);
  observer.arm();
  observer.startPressed(1);
  observer.startPressed(2);
  // baseline de wins do próximo game: personagens recomeçam em 0×0 no core;
  // no sintético armamos combate e depois P2 vence.
  assert.equal(observer.observe(state(400)).event, "COMBAT_OBSERVED");
  observer.observe(state(500, { wins: [0, 1] }));
  observer.observe(state(540, { wins: [0, 1] }));
  assert.equal(
    observer.observe(state(580, { wins: [0, 1] })).result.winnerSlot,
    2,
  );
});

test("2: time-over com health decide vencedor após estabilidade", () => {
  const observer = armed();
  // timer 0, P1 com mais vida — precisa ~90 frames + 3 amostras estáveis
  let frame = 200;
  let last;
  for (let i = 0; i < 40; i++) {
    frame += 10;
    last = observer.observe(
      state(frame, { health: [80, 20], wins: [0, 0], timer: 0 }),
    );
    if (last.result) break;
  }
  assert.equal(last.result?.winnerSlot, 1);
  assert.equal(last.result?.detection, "time-over-health");
});

test("2: time-over empatado abre needsReview", () => {
  const observer = armed();
  let last;
  for (let i = 0; i < 20; i++) {
    last = observer.observe(
      state(200 + i * 10, { health: [40, 40], wins: [0, 0], timer: 0 }),
    );
    if (last.needsReview) break;
  }
  assert.equal(last.event, "TIME_OVER_DRAW");
  assert.equal(last.needsReview, true);
});

test("2: wins [1,1] retorna INCOHERENT_WINS com needsReview", () => {
  const out = armed().observe(state(200, { wins: [1, 1] }));
  assert.equal(out.event, "INCOHERENT_WINS");
  assert.equal(out.needsReview, true);
});

test("2: double KO de round emite evento sem liquidar", () => {
  const out = armed().observe(
    state(200, { health: [0, 0], wins: [0, 0], timer: 0x45 }),
  );
  assert.equal(out.event, "DOUBLE_KO_ROUND");
  assert.equal(out.result, undefined);
});

test("3: mintIceServers sem TURN cai no STUN padrão", () => {
  const prevUrls = process.env.TURN_URLS;
  const prevSecret = process.env.TURN_SECRET;
  const prevIce = process.env.HOSTED_ICE_SERVERS;
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
  process.env.HOSTED_ICE_SERVERS = "[]";
  const minted = mintIceServers(1_700_000_000_000);
  assert.equal(minted.ephemeral, false);
  assert.ok(minted.iceServers.length >= 1);
  assert.match(String(minted.iceServers[0].urls), /stun:/);
  process.env.TURN_URLS = prevUrls;
  process.env.TURN_SECRET = prevSecret;
  process.env.HOSTED_ICE_SERVERS = prevIce;
});

test("3: mintIceServers com TURN_SECRET emite credencial HMAC efêmera", () => {
  const prevUrls = process.env.TURN_URLS;
  const prevSecret = process.env.TURN_SECRET;
  const prevTtl = process.env.TURN_TTL_SEC;
  process.env.TURN_URLS = "turn:turn.example.com:3478";
  process.env.TURN_SECRET = "lab-secret-not-for-prod";
  process.env.TURN_TTL_SEC = "600";
  const now = 1_700_000_000_000;
  const minted = mintIceServers(now);
  assert.equal(minted.ephemeral, true);
  assert.equal(minted.ttlSec, 600);
  const turn = minted.iceServers.find((s) =>
    String(s.urls).includes("turn:"),
  );
  assert.ok(turn);
  assert.match(turn.username, /^\d+:arena$/);
  assert.equal(typeof turn.credential, "string");
  assert.ok(turn.credential.length > 10);
  process.env.TURN_URLS = prevUrls;
  process.env.TURN_SECRET = prevSecret;
  process.env.TURN_TTL_SEC = prevTtl;
});

test("7+8: limite diário e recoverMatches (child isolado)", async () => {
  const child = spawn(
    process.execPath,
    [path.join(root, "tests/sistema-1a9-child.js")],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, err || out);
  assert.match(out, /ok-daily/);
  assert.match(out, /ok-recover/);
  assert.match(out, /ok-evidence/);
});

test("4: hosted-worker expõe adaptEncodings no fonte", () => {
  const src = fs.readFileSync(
    path.join(root, "server/hosted-worker.js"),
    "utf8",
  );
  assert.match(src, /adaptEncodings/);
  assert.match(src, /setParameters/);
  assert.match(src, /targetBitrate/);
});

test("9: plataforma trata QUEUED como cancelável e publica ETA", () => {
  const src = fs.readFileSync(path.join(root, "server/platform.js"), "utf8");
  assert.match(src, /placeInQueue/);
  assert.match(src, /etaSeconds/);
  assert.match(src, /m\.phase === "QUEUED"/);
  assert.match(src, /Fila cancelada/);
  assert.match(src, /HOSTED_AVG_MATCH_SEC/);
});
