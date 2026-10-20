import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateHostedCapacity,
  capacityForKnownVps,
} from "../server/host-bot-capacity.js";
import {
  resolveHostedEngine,
  createHostedFactory,
} from "../server/host-bot-factory.js";
import { NativeHostSession } from "../server/native-host-session.js";
import { HostedSession } from "../server/hosted-session.js";

test("capacidade: VPS teste 4GB/2c native recomenda faixa baixa", () => {
  const c = capacityForKnownVps("test4g2c", "native");
  assert.ok(c.recommended >= 4 && c.recommended <= 10, String(c.recommended));
  const chrome = capacityForKnownVps("test4g2c", "chrome");
  assert.ok(chrome.recommended < c.recommended);
});

test("capacidade: VPS alvo 10GB/5c native cabe meta ~20", () => {
  const c = capacityForKnownVps("prod10g5c", "native");
  assert.ok(c.recommended >= 12, String(c.recommended));
  assert.ok(c.recommended <= 30, String(c.recommended));
});

test("estimateHostedCapacity respeita ram e cpu", () => {
  const lowRam = estimateHostedCapacity({
    ramMb: 2048,
    vcpu: 8,
    engine: "native",
  });
  const lowCpu = estimateHostedCapacity({
    ramMb: 32768,
    vcpu: 1,
    engine: "native",
  });
  assert.ok(lowRam.recommended <= lowRam.maxByRam);
  assert.ok(lowCpu.recommended <= lowCpu.maxByCpu);
});

test("factory resolve chrome vs native", () => {
  assert.equal(resolveHostedEngine("chrome"), "chrome");
  assert.equal(resolveHostedEngine("native"), "native");
  assert.equal(resolveHostedEngine("hostbot"), "native");
  const chromeFactory = createHostedFactory("chrome");
  const nativeFactory = createHostedFactory("native");
  assert.ok(chromeFactory({}) instanceof HostedSession);
  assert.ok(nativeFactory({}) instanceof NativeHostSession);
});

test("NativeHostSession stub sobe, peers e para sem Chrome", async () => {
  const peers = [];
  const progress = [];
  const session = new NativeHostSession({
    matchId: "test_native_1",
    onPeer: (slot, state) => peers.push({ slot, state }),
    onProgress: (stage) => progress.push(stage),
    onFailure: (m) => assert.fail(m),
  });
  const started = await session.start();
  assert.equal(started.manifest.engine, "native-stub");
  assert.ok(progress.includes("boot"));
  assert.deepEqual(
    peers.filter((p) => p.state === "connected").map((p) => p.slot).sort(),
    [1, 2],
  );
  await session.input(1, 0, 1);
  await session.input(1, 0, 0);
  await session.resume();
  await session.pause();
  await session.stop();
});
