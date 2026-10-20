/**
 * Smoke do Host Bot nativo (sem Chrome) — Fase 2: samples + WebRTC lab.
 * Uso (PowerShell):
 *   $env:HOSTED_ENGINE="native"
 *   npm run smoke:host-bot -- 2
 *
 * Args: [sessions=2] [mode=auto|webrtc|peers]
 *   peers  — só RSS com AUTO_PEERS (sem negociação)
 *   webrtc — 1 sessão com loopback @roamhq/wrtc (offer/answer)
 *   auto   — webrtc se wrtc disponível, senão peers
 */
import { NativeHostSession } from "../server/native-host-session.js";
import { loadWrtc } from "../server/native-webrtc.js";

const n = Math.max(1, Math.min(20, Number(process.argv[2]) || 2));
const modeArg = String(process.argv[3] || "auto").toLowerCase();
const startedAt = Date.now();
const sessions = [];

const wrtc = await loadWrtc();
const mode =
  modeArg === "auto" ? (wrtc ? "webrtc" : "peers") : modeArg;

console.log(
  JSON.stringify({
    phase: "start",
    engine: "native-stub",
    hostPhase: 2,
    sessions: n,
    mode,
    wrtc: !!wrtc,
    hint: "Fase 2 = encode 320p30 + sinalização WebRTC. FBNeo framebuffer = depois.",
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

  return { pc, onSignal, get remoteTrack() { return remoteTrack; } };
}

try {
  if (mode === "peers") {
    process.env.HOST_BOT_AUTO_PEERS = "1";
    process.env.HOST_BOT_MEDIA = process.env.HOST_BOT_MEDIA || "lab";
  }

  if (mode === "webrtc") {
    if (!wrtc) throw new Error("@roamhq/wrtc indisponível para smoke webrtc");
    delete process.env.HOST_BOT_AUTO_PEERS;
    const signals = [];
    const peerStates = [];
    const session = new NativeHostSession({
      matchId: "smoke_webrtc_0",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      onPeer: (slot, state) => peerStates.push({ slot, state }),
      onSignal: (slot, signal) => signals.push({ slot, signal }),
      onFailure: (message) => {
        throw new Error(`webrtc: ${message}`);
      },
    });
    const started = await session.start();
    const v1 = await attachViewer(session, 1, wrtc);
    const v2 = await attachViewer(session, 2, wrtc);
    // fan-out onSignal para ambos viewers
    session.onSignal = (slot, signal) => {
      signals.push({ slot, signal });
      v1.onSignal(slot, signal);
      v2.onSignal(slot, signal);
    };

    await session.signal(1, { kind: "viewer-ready" });
    await session.signal(2, { kind: "viewer-ready" });

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const connected = peerStates.filter((p) => p.state === "connected");
      const slots = new Set(connected.map((p) => p.slot));
      if (slots.has(1) && slots.has(2) && v1.remoteTrack && v2.remoteTrack) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    await session.resume();
    await new Promise((r) => setTimeout(r, 400));
    for (let k = 0; k < 5; k++) {
      await session.input(1, 0, 1);
      await session.input(1, 0, 0);
    }

    const connectedSlots = [
      ...new Set(
        peerStates.filter((p) => p.state === "connected").map((p) => p.slot),
      ),
    ].sort();
    const offers = signals.filter((s) => s.signal?.kind === "offer").length;
    sessions.push({
      session,
      i: 0,
      peerCount: connectedSlots.length,
      sampleCount: session.lastSample?.frame || 0,
      lastSample: session.lastSample,
      manifest: session.manifest,
      webrtc: {
        connectedSlots,
        offers,
        tracks: { 1: v1.remoteTrack, 2: v2.remoteTrack },
        pc1: v1.pc.connectionState,
        pc2: v2.pc.connectionState,
      },
    });

    if (connectedSlots.length < 2)
      throw new Error("WebRTC: peers não conectaram a tempo");
    if (!v1.remoteTrack || !v2.remoteTrack)
      throw new Error("WebRTC: track de vídeo não chegou nos viewers");
    void started;
    // Não chamar pc.close() — wrtc pode segfault no teardown do smoke.
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
          manifest: s.manifest,
        })),
      },
      null,
      2,
    ),
  );
  // @roamhq/wrtc pode segfault em close/GC — encerra após o relatório.
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
