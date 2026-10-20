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
import {
  Kof2002Observer,
  normalizeSample,
} from "../server/kof2002-observer.js";
import {
  mapArenaInput,
  arenaAction,
  retroArchKeyboardLines,
  isKnownArenaButton,
} from "../server/native-input-map.js";
import {
  buildNativeHostLaunch,
  resolveHostBotBin,
  defaultRetroArchLabConfig,
} from "../server/native-host-launcher.js";
import {
  createFrameSource,
  paintSyntheticI420,
  i420ByteLength,
  NATIVE_FRAME,
  rgb24ToI420,
  normalizeExternalFrame,
} from "../server/native-frame-source.js";
import { createNativeMediaBridge } from "../server/native-webrtc.js";
import { buildFfmpegFrameCapture } from "../server/native-framebuffer.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("input map: Arena → ação e tecla P1/P2", () => {
  assert.equal(arenaAction(3), "start");
  assert.equal(arenaAction(0), "punch1");
  assert.ok(isKnownArenaButton(4));
  assert.equal(isKnownArenaButton(99), false);
  const p1 = mapArenaInput(1, 0, 1);
  assert.equal(p1.action, "punch1");
  assert.equal(p1.key, "KeyZ");
  assert.equal(p1.retroBind, "b");
  const p2 = mapArenaInput(2, 4, 1);
  assert.equal(p2.action, "up");
  assert.equal(p2.key, "Numpad8");
  assert.ok(retroArchKeyboardLines(1).some((l) => l.includes("input_player1_")));
  assert.ok(defaultRetroArchLabConfig().includes("input_player2_start"));
});

test("launcher: sem HOST_BOT_BIN = stub", () => {
  const prev = process.env.HOST_BOT_BIN;
  delete process.env.HOST_BOT_BIN;
  try {
    assert.equal(resolveHostBotBin({}), null);
    const launch = buildNativeHostLaunch({});
    assert.equal(launch.mode, "stub");
    assert.ok(launch.args[0].endsWith("native-host-worker.js"));
  } finally {
    if (prev != null) process.env.HOST_BOT_BIN = prev;
    else delete process.env.HOST_BOT_BIN;
  }
});

test("launcher: RetroArch monta -L fbneo + rom", () => {
  const launch = buildNativeHostLaunch({
    HOST_BOT_BIN: "C:\\games\\retroarch.exe",
    HOST_BOT_KIND: "retroarch",
    HOST_BOT_WORKDIR: "data/hosted/kof2002",
  });
  assert.equal(launch.mode, "retroarch");
  assert.equal(launch.command, "C:\\games\\retroarch.exe");
  assert.ok(launch.args.includes("-L"));
  assert.ok(launch.args.includes("fbneo_libretro"));
});

test("normalizeSample + observeSample liquidam sem RASTATE", () => {
  assert.throws(() => normalizeSample(null), /inválido/);
  const observer = new Kof2002Observer();
  observer.arm();
  observer.startPressed(1);
  observer.startPressed(2);
  assert.equal(
    observer.observeSample({
      frame: 100,
      health: [0x67, 0x67],
      timer: 0x60,
      wins: [0, 0],
    }).event,
    "COMBAT_OBSERVED",
  );
  observer.observeSample({
    frame: 200,
    health: [10, 0],
    timer: 0x40,
    wins: [1, 0],
  });
  observer.observeSample({
    frame: 240,
    health: [10, 0],
    timer: 0x40,
    wins: [1, 0],
  });
  const out = observer.observeSample({
    frame: 280,
    health: [10, 0],
    timer: 0x40,
    wins: [1, 0],
  });
  assert.equal(out.result?.winnerSlot, 1);
  assert.equal(out.result?.source, "private-server-memory");
});

test("NativeHostSession stub sobe, peers e para sem Chrome", async () => {
  const prevPeers = process.env.HOST_BOT_AUTO_PEERS;
  const prevMedia = process.env.HOST_BOT_MEDIA;
  process.env.HOST_BOT_AUTO_PEERS = "1";
  process.env.HOST_BOT_MEDIA = "lab";
  const peers = [];
  const progress = [];
  const session = new NativeHostSession({
    matchId: "test_native_1",
    onPeer: (slot, state) => peers.push({ slot, state }),
    onProgress: (stage) => progress.push(stage),
    onFailure: (m) => assert.fail(m),
  });
  try {
    const started = await session.start();
    assert.equal(started.manifest.engine, "native-stub");
    assert.equal(started.manifest.phase, 2);
    assert.ok(progress.includes("boot"));
    assert.ok(progress.includes("media"));
    assert.deepEqual(
      peers.filter((p) => p.state === "connected").map((p) => p.slot).sort(),
      [1, 2],
    );
    await session.input(1, 0, 1);
    await session.input(1, 0, 0);
    await session.resume();
    await session.pause();
  } finally {
    await session.stop().catch(() => {});
    if (prevPeers == null) delete process.env.HOST_BOT_AUTO_PEERS;
    else process.env.HOST_BOT_AUTO_PEERS = prevPeers;
    if (prevMedia == null) delete process.env.HOST_BOT_MEDIA;
    else process.env.HOST_BOT_MEDIA = prevMedia;
  }
});

test("frame source 320p I420 + evidência PPM", () => {
  assert.equal(NATIVE_FRAME.width, 320);
  assert.equal(NATIVE_FRAME.height, 240);
  const buf = Buffer.alloc(i420ByteLength());
  paintSyntheticI420(buf, 7);
  assert.ok(buf[0] >= 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-frame-"));
  const file = path.join(dir, "t.ppm");
  const src = createFrameSource({ onFrame: () => {} });
  src.writePpmEvidence(file, 3);
  const raw = fs.readFileSync(file);
  assert.ok(raw.toString("ascii", 0, 2) === "P6");
  src.stop();
});

test("Fase 2 lab: viewer-ready → offer → answer → peer connected", async () => {
  const events = [];
  const bridge = await createNativeMediaBridge({
    media: "lab",
    emit: (ev) => events.push(ev),
  });
  assert.equal(bridge.backend, "lab");
  await bridge.signal(1, { kind: "viewer-ready" });
  assert.ok(events.some((e) => e.event === "signal" && e.signal?.kind === "offer"));
  await bridge.signal(1, {
    kind: "answer",
    sdp: { type: "answer", sdp: "v=0" },
  });
  assert.ok(
    events.some((e) => e.event === "peer" && e.slot === 1 && e.state === "connected"),
  );
  const m = await bridge.metrics();
  assert.equal(m.encoding.width, 320);
  bridge.stop();
});

test("Fase 2 wrtc: loopback offer/answer entrega track (child)", async () => {
  const child = spawn(
    process.execPath,
    [path.join(root, "tests/host-bot-webrtc-child.js")],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, err || out);
  const line = out.trim().split("\n").pop();
  const result = JSON.parse(line);
  assert.equal(result.ok, true);
  if (!result.skipped) {
    assert.equal(result.gotTrack, true);
    assert.equal(result.peerConnected, true);
  }
});

test("Fase 1: samples sintéticos → observeSample → vitória P1", async () => {
  const prevMedia = process.env.HOST_BOT_MEDIA;
  process.env.HOST_BOT_MEDIA = "lab";
  const observations = [];
  const results = [];
  const samples = [];
  const session = new NativeHostSession({
    matchId: "test_phase1_sample",
    onSample: (s) => samples.push(s),
    onObservation: (o) => observations.push(o.event),
    onResult: (r) => results.push(r),
    onFailure: (m) => assert.fail(m),
  });
  try {
    await session.start();
    await session.input(1, 3, 1); // start P1
    await session.input(2, 3, 1); // start P2
    await session.resume();

    await session.injectSample({
      frame: 50,
      health: [0x67, 0x67],
      timer: 0x60,
      wins: [0, 0],
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(observations.includes("COMBAT_OBSERVED"), String(observations));

    await session.injectSample({
      frame: 100,
      health: [20, 0],
      timer: 0x45,
      wins: [1, 0],
    });
    await session.injectSample({
      frame: 140,
      health: [20, 0],
      timer: 0x45,
      wins: [1, 0],
    });
    await session.injectSample({
      frame: 180,
      health: [20, 0],
      timer: 0x45,
      wins: [1, 0],
    });
    await new Promise((r) => setTimeout(r, 120));

    assert.ok(samples.length >= 2, "samples recebidos");
    assert.equal(results[0]?.winnerSlot, 1);
    assert.equal(session.lastMappedInput?.action, "start");
  } finally {
    await session.stop().catch(() => {});
    if (prevMedia == null) delete process.env.HOST_BOT_MEDIA;
    else process.env.HOST_BOT_MEDIA = prevMedia;
  }
});

test("framebuffer: RGB24→I420 + pushExternal prioriza external", () => {
  const rgb = Buffer.alloc(16 * 16 * 3, 200);
  const i420 = rgb24ToI420(rgb, 16, 16, 32, 32);
  assert.equal(i420.length, i420ByteLength(32, 32));
  const norm = normalizeExternalFrame({
    width: 16,
    height: 16,
    format: "rgb24",
    data: rgb.toString("base64"),
  });
  assert.equal(norm.width, 320);
  assert.equal(norm.height, 240);

  let lastSource = null;
  const src = createFrameSource({
    mode: "auto",
    fps: 30,
    onFrame: (f) => {
      lastSource = f.source;
    },
  });
  src.start();
  src.resume();
  src.pushExternal({
    width: 320,
    height: 240,
    format: "i420",
    data: Buffer.alloc(i420ByteLength(), 90),
  });
  assert.equal(src.externalCount, 1);
  assert.equal(lastSource, "external");
  src.stop();
});

test("framebuffer: ffmpeg lavfi cmdline + injectFrame no worker", async () => {
  const cap = buildFfmpegFrameCapture({
    HOST_BOT_FFMPEG: "ffmpeg",
    HOST_BOT_FFMPEG_INPUT_KIND: "lavfi",
    HOST_BOT_FFMPEG_INPUT: "testsrc=size=320x240:rate=30",
  });
  assert.ok(cap);
  assert.ok(cap.args.includes("lavfi"));
  assert.ok(cap.args.includes("yuv420p"));

  const prevMedia = process.env.HOST_BOT_MEDIA;
  process.env.HOST_BOT_MEDIA = "lab";
  process.env.HOST_BOT_AUTO_PEERS = "1";
  const frames = [];
  const session = new NativeHostSession({
    matchId: "test_inject_frame",
    onFrame: (ev) => frames.push(ev),
    onFailure: (m) => assert.fail(m),
  });
  try {
    await session.start();
    const buf = Buffer.alloc(i420ByteLength(), 40);
    paintSyntheticI420(buf, 9);
    await session.injectFrame({
      width: 320,
      height: 240,
      format: "i420",
      data: buf.toString("base64"),
    });
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (session.lastExternalCount || 0) < 1) {
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.ok(session.lastExternalCount >= 1, String(session.lastExternalCount));
    assert.ok(frames.length >= 1);
  } finally {
    await session.stop().catch(() => {});
    if (prevMedia == null) delete process.env.HOST_BOT_MEDIA;
    else process.env.HOST_BOT_MEDIA = prevMedia;
    delete process.env.HOST_BOT_AUTO_PEERS;
  }
});
