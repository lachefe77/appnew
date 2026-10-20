import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Kof2002Observer,
  readKofSample,
  kofProfile,
} from "../server/kof2002-observer.js";
import { verifyHostedAssets } from "../server/hosted-assets.js";

// Synthetic RAM tests validate the state machine; real-game validation is a
// separate integration run with natural controller inputs and screenshots.
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
test("observador recusa estado de core truncado ou diferente", () => {
  assert.throws(() => readKofSample(new Uint8Array(200)), /Layout/);
  const bad = state(10);
  bad[0] = 0;
  assert.throws(() => readKofSample(bad), /Layout/);
});
test("observador distingue bytes de CPU e offsets raw do detector", () => {
  assert.deepEqual(
    readKofSample(state(100, { health: [88, 70], wins: [0, 1], timer: 0x45 })),
    { frame: 100, health: [88, 70], wins: [0, 1], timer: 0x45 },
  );
});
test("resultado antes da prontidão oficial e sem dois Starts é ignorado", () => {
  const observer = new Kof2002Observer();
  observer.observe(state(10, { wins: [1, 0] }));
  observer.arm();
  observer.startPressed(1);
  assert.equal(observer.observe(state(50)).event, undefined);
  assert.equal(observer.started, false);
});
test("KO isolado e troca de personagem não liquidam confronto", () => {
  const observer = armed();
  for (let i = 1; i <= 6; i++)
    assert.equal(
      observer.observe(
        state(100 + i * 60, { health: [102, i % 2 ? 0 : 102], wins: [0, 0] }),
      ).result,
      undefined,
    );
  assert.equal(observer.finished, false);
});
test("vitória de P1 exige contador de confronto estável e avanço de quadros", () => {
  const observer = armed();
  assert.equal(
    observer.observe(state(200, { wins: [1, 0] })).result,
    undefined,
  );
  assert.equal(
    observer.observe(state(200, { wins: [1, 0] })).result,
    undefined,
  );
  assert.equal(
    observer.observe(state(220, { wins: [1, 0] })).result,
    undefined,
  );
  assert.equal(
    observer.observe(state(260, { wins: [1, 0] })).result.winnerSlot,
    1,
  );
  assert.equal(
    observer.observe(state(300, { wins: [1, 0] })).result,
    undefined,
  );
});
test("vitória de P2 é reconhecida sem depender de declaração do navegador", () => {
  const observer = armed();
  observer.observe(state(200, { wins: [0, 1] }));
  observer.observe(state(240, { wins: [0, 1] }));
  assert.equal(
    observer.observe(state(280, { wins: [0, 1] })).result.winnerSlot,
    2,
  );
});
test("empate incoerente, salto de contador e retrocesso bloqueiam resultado", () => {
  for (const wins of [
    [1, 1],
    [2, 0],
    [0, 2],
  ])
    assert.throws(
      () => armed().observe(state(200, { wins })),
      /inconsistentes/,
    );
  assert.throws(() => armed().observe(state(20)), /retrocedeu/);
});
test("manifesto inválido não habilita servidor de jogo", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "arena-hosted-test-"),
  );
  fs.writeFileSync(
    path.join(directory, "manifest.json"),
    JSON.stringify({ version: 999, game: "other" }),
  );
  assert.throws(() => verifyHostedAssets(directory), /Manifesto/);
  fs.unlinkSync(path.join(directory, "manifest.json"));
  fs.rmdirSync(directory);
});
