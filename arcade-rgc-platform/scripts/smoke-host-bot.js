/**
 * Smoke Host Bot nativo (sem Chrome).
 * Uso (PowerShell), na pasta arcade-rgc-platform:
 *   $env:HOSTED_ENGINE="native"
 *   npm run smoke:host-bot -- 1 webrtc
 *   npm run smoke:host-bot -- 1 framebuffer
 *   npm run smoke:host-bot -- 4 peers
 *
 * Args: [sessions=2] [mode=auto|webrtc|peers|framebuffer]
 * Com .env (HOST_BOT_BIN + ffmpeg gdigrab) spawna RetroArch — Fase 4b.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { NativeHostSession } from "../server/native-host-session.js";
import { loadWrtc } from "../server/native-webrtc.js";
import { buildNativeHostLaunch } from "../server/native-host-launcher.js";
import {
  NATIVE_FRAME,
  paintSyntheticI420,
  i420ByteLength,
} from "../server/native-frame-source.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const n = Math.max(1, Math.min(20, Number(process.argv[2]) || 2));
const modeArg = String(process.argv[3] || "auto").toLowerCase();
const startedAt = Date.now();
const sessions = [];
const launchPreview = buildNativeHostLaunch();

const wrtc = await loadWrtc();
const mode =
  modeArg === "auto"
    ? wrtc
      ? "webrtc"
      : "peers"
    : modeArg;

// Core real precisa de mais tempo (janela + gdigrab).
if (launchPreview.mode !== "stub" && !process.env.HOST_BOT_GAME_BOOT_MS) {
  process.env.HOST_BOT_GAME_BOOT_MS = "5000";
}

console.log(
  JSON.stringify({
    phase: "start",
    engine:
      launchPreview.mode === "stub" ? "native-stub" : "native-" + launchPreview.mode,
    hostPhase: launchPreview.mode === "stub" ? 2 : "4b",
    sessions: n,
    mode,
    wrtc: !!wrtc,
    launchMode: launchPreview.mode,
    hostBotBin:
      launchPreview.mode === "stub" ? null : launchPreview.command,
    binExists:
      launchPreview.mode === "stub"
        ? false
        : fs.existsSync(launchPreview.command),
    hint:
      launchPreview.mode === "stub"
        ? "Stub lab. Para Fase 4b: HOST_BOT_BIN + ROM no .env e reexecuta."
        : "RetroArch/gdigrab — a janela do core pode abrir uns segundos.",
  }),
);

async function attachViewer(session, slot, wrtcMod) {
  const { RTCPeerConnection } = wrtcMod;
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  let remoteTrack = false;
  pc.ontrack = () => {
    remoteTrack = true;
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      session
        .signal(slot, { kind: "ice", candidate: e.candidate.toJSON() })
        .catch(() => {});
    }
  };

  const onSignal = (s, signal) => {
    if (s !== slot) return;
    const chain = (pc._arenaChain || Promise.resolve()).then(async () => {
      if (signal.kind === "offer") {
        await pc.setRemoteDescription(signal.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        await session.signal(slot, {
          kind: "answer",
          sdp: pc.localDescription.toJSON(),
        });
      } else if (signal.kind === "ice" && signal.candidate) {
        if (pc.remoteDescription)
          await pc.addIceCandidate(signal.candidate).catch(() => {});
      }
    });
    pc._arenaChain = chain.catch(() => {});
  };

  return {
    pc,
    onSignal,
    get remoteTrack() {
      return remoteTrack;
    },
  };
}

async function runWebRtcSession({ matchId, injectFrames = 0 }) {
  if (!wrtc) throw new Error("@roamhq/wrtc indisponível");
  delete process.env.HOST_BOT_AUTO_PEERS;
  const signals = [];
  const peerStates = [];
  let frameEvents = 0;
  const session = new NativeHostSession({
    matchId,
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    onPeer: (slot, state) => peerStates.push({ slot, state }),
    onSignal: (slot, signal) => signals.push({ slot, signal }),
    onFrame: () => {
      frameEvents++;
    },
    onFailure: (message) => {
      throw new Error(`${matchId}: ${message}`);
    },
  });
  const started = await session.start();
  const v1 = await attachViewer(session, 1, wrtc);
  const v2 = await attachViewer(session, 2, wrtc);
  session.onSignal = (slot, signal) => {
    signals.push({ slot, signal });
    v1.onSignal(slot, signal);
    v2.onSignal(slot, signal);
  };

  await session.signal(1, { kind: "viewer-ready" });
  await session.signal(2, { kind: "viewer-ready" });

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const slots = new Set(
      peerStates.filter((p) => p.state === "connected").map((p) => p.slot),
    );
    if (slots.has(1) && slots.has(2) && v1.remoteTrack && v2.remoteTrack) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  await session.resume();
  await new Promise((r) => setTimeout(r, 200));

  for (let k = 0; k < injectFrames; k++) {
    const buf = Buffer.alloc(i420ByteLength());
    paintSyntheticI420(buf, 1000 + k, {
      width: NATIVE_FRAME.width,
      height: NATIVE_FRAME.height,
    });
    // Marca “external”: canto branco forte
    buf.fill(255, 0, 16);
    await session.injectFrame({
      width: NATIVE_FRAME.width,
      height: NATIVE_FRAME.height,
      format: "i420",
      data: buf.toString("base64"),
    });
    await new Promise((r) => setTimeout(r, 20));
  }

  for (let k = 0; k < 5; k++) {
    await session.input(1, 0, 1);
    await session.input(1, 0, 0);
  }

  if (injectFrames > 0) {
    const waitFb = Date.now() + 5000;
    while (
      Date.now() < waitFb &&
      (session.lastExternalCount || 0) < injectFrames
    ) {
      await new Promise((r) => setTimeout(r, 30));
    }
    if ((session.lastExternalCount || 0) < injectFrames)
      throw new Error(
        `Framebuffer: externalCount=${session.lastExternalCount} < ${injectFrames}`,
      );
  }

  const connectedSlots = [
    ...new Set(
      peerStates.filter((p) => p.state === "connected").map((p) => p.slot),
    ),
  ].sort();
  if (connectedSlots.length < 2)
    throw new Error("WebRTC: peers não conectaram a tempo");
  if (!v1.remoteTrack || !v2.remoteTrack)
    throw new Error("WebRTC: track de vídeo não chegou nos viewers");

  return {
    session,
    i: 0,
    peerCount: connectedSlots.length,
    sampleCount: session.lastSample?.frame || 0,
    lastSample: session.lastSample,
    manifest: started.manifest,
    webrtc: {
      connectedSlots,
      offers: signals.filter((s) => s.signal?.kind === "offer").length,
      tracks: { 1: v1.remoteTrack, 2: v2.remoteTrack },
      pc1: v1.pc.connectionState,
      pc2: v2.pc.connectionState,
    },
    framebuffer: {
      injected: injectFrames,
      externalCount: session.lastExternalCount || 0,
      frameEvents,
    },
  };
}

try {
  if (mode === "peers") {
    process.env.HOST_BOT_AUTO_PEERS = "1";
    process.env.HOST_BOT_MEDIA = process.env.HOST_BOT_MEDIA || "lab";
  }

  if (mode === "webrtc" || mode === "framebuffer") {
    const row = await runWebRtcSession({
      matchId: mode === "framebuffer" ? "smoke_fb_0" : "smoke_webrtc_0",
      injectFrames: mode === "framebuffer" ? 30 : 0,
    });
    sessions.push(row);
  } else {
    for (let i = 0; i < n; i++) {
      let peerCount = 0;
      let sampleCount = 0;
      const session = new NativeHostSession({
        matchId: `smoke_${i}`,
        onPeer: (_slot, state) => {
          if (state === "connected") peerCount++;
        },
        onSample: () => {
          sampleCount++;
        },
        onFailure: (message) => {
          throw new Error(`session ${i}: ${message}`);
        },
      });
      await session.start();
      await session.input(1, 3, 1);
      await session.input(2, 3, 1);
      await session.resume();
      for (let k = 0; k < 10; k++) {
        await session.input(1, 0, 1);
        await session.input(1, 0, 0);
        await session.input(2, 8, 1);
        await session.input(2, 8, 0);
      }
      await session.injectSample({
        frame: 40 + i,
        health: [0x67, 0x67],
        timer: 0x60,
        wins: [0, 0],
      });
      await new Promise((r) => setTimeout(r, 50));
      sessions.push({
        session,
        i,
        peerCount,
        sampleCount,
        lastSample: session.lastSample,
        manifest: session.manifest,
      });
    }
  }

  const mem = process.memoryUsage();
  console.log(
    JSON.stringify(
      {
        phase: "ok",
        hostPhase: 2,
        mode,
        sessions: sessions.length,
        elapsedMs: Date.now() - startedAt,
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapMb: Math.round(mem.heapUsed / 1024 / 1024),
        detail: sessions.map((s) => ({
          i: s.i,
          peers: s.peerCount,
          samples: s.sampleCount,
          lastFrame: s.lastSample?.frame ?? null,
          webrtc: s.webrtc || null,
          framebuffer: s.framebuffer || null,
          manifest: s.manifest,
        })),
      },
      null,
      2,
    ),
  );
  for (const { session } of sessions) {
    try {
      session.child?.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({ phase: "failed", error: error.message }));
  for (const { session } of sessions) {
    try {
      session.child?.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  process.exit(1);
}
