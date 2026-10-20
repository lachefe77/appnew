/**
 * Fase 3 — bench de capacidade do Host Bot (sem Chrome).
 *
 * PowerShell (VPS 4GB — prova ≥10 min):
 *   cd "C:\Users\Pc Gamer\Documents\appnew\arcade-rgc-platform"
 *   $env:HOSTED_ENGINE="native"
 *   npm run bench:host-bot -- --sessions 6 --duration 600 --mode peers
 *
 * Lab rápido (PC):
 *   npm run bench:host-bot -- --sessions 4 --duration 30 --mode peers
 *
 * Flags:
 *   --sessions N     partidas X1 em paralelo (default 4)
 *   --duration SEC   manter carga (default 30; VPS use 600)
 *   --mode peers|webrtc
 *   --ramMb 4096 --vcpu 2
 *   --sampleMs 2000
 */
import { NativeHostSession } from "../server/native-host-session.js";
import { loadWrtc } from "../server/native-webrtc.js";
import {
  calibrateFromMeasurement,
  writeCapacityReport,
  capacityForKnownVps,
} from "../server/host-bot-capacity.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] != null) return process.argv[i + 1];
  return fallback;
}

const sessionsN = Math.max(1, Math.min(30, Number(arg("--sessions", 4)) || 4));
const durationSec = Math.max(
  5,
  Math.min(7200, Number(arg("--duration", 30)) || 30),
);
const mode = String(arg("--mode", "peers")).toLowerCase();
const ramMb = Number(arg("--ramMb", 4096)) || 4096;
const vcpu = Number(arg("--vcpu", 2)) || 2;
const sampleMs = Math.max(500, Number(arg("--sampleMs", 2000)) || 2000);

const sessions = [];
const samples = [];
let failures = 0;
const startedAt = Date.now();

function rssMb() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function sample(label) {
  const row = {
    at: Date.now(),
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    rssMb: rssMb(),
    sessions: sessions.length,
    label,
  };
  samples.push(row);
  return row;
}

async function attachViewer(session, slot, wrtc) {
  const pc = new wrtc.RTCPeerConnection({ iceServers: [] });
  let remoteTrack = false;
  pc.ontrack = () => {
    remoteTrack = true;
  };
  pc.onicecandidate = (e) => {
    if (e.candidate)
      session
        .signal(slot, { kind: "ice", candidate: e.candidate.toJSON() })
        .catch(() => {});
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
      } else if (
        signal.kind === "ice" &&
        signal.candidate &&
        pc.remoteDescription
      ) {
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

async function startPeersSession(i) {
  const session = new NativeHostSession({
    matchId: `bench_${i}`,
    iceServers: [],
    onFailure: (message) => {
      failures++;
      console.error(JSON.stringify({ phase: "session-fail", i, message }));
    },
  });
  await session.start();
  await session.input(1, 3, 1);
  await session.input(2, 3, 1);
  await session.resume();
  for (let k = 0; k < 4; k++) {
    await session.input(1, 0, 1);
    await session.input(1, 0, 0);
  }
  return { session, i };
}

async function startWebrtcSession(i, wrtc) {
  const peerStates = [];
  const session = new NativeHostSession({
    matchId: `bench_rtc_${i}`,
    iceServers: [],
    onPeer: (slot, state) => peerStates.push({ slot, state }),
    onFailure: (message) => {
      failures++;
      console.error(JSON.stringify({ phase: "session-fail", i, message }));
    },
  });
  await session.start();
  const v1 = await attachViewer(session, 1, wrtc);
  const v2 = await attachViewer(session, 2, wrtc);
  session.onSignal = (slot, signal) => {
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
    await new Promise((r) => setTimeout(r, 40));
  }
  await session.resume();
  return { session, i, v1, v2 };
}

console.log(
  JSON.stringify({
    phase: "start",
    hostPhase: 3,
    sessions: sessionsN,
    durationSec,
    mode,
    ramMb,
    vcpu,
    estimate: capacityForKnownVps("test4g2c", "native"),
    hint:
      durationSec < 600
        ? "Lab curto. Na VPS 4GB use --duration 600 para critério Fase 3."
        : "Prova longa (≥10 min) — critério Fase 3.",
  }),
);

try {
  const baselineRssMb = rssMb();
  sample("baseline");

  let wrtc = null;
  if (mode === "webrtc") {
    wrtc = await loadWrtc();
    if (!wrtc)
      throw new Error(
        "@roamhq/wrtc indisponível para mode=webrtc; use --mode peers",
      );
    delete process.env.HOST_BOT_AUTO_PEERS;
  } else {
    process.env.HOST_BOT_AUTO_PEERS = "1";
    process.env.HOST_BOT_MEDIA = process.env.HOST_BOT_MEDIA || "lab";
  }

  for (let i = 0; i < sessionsN; i++) {
    const row =
      mode === "webrtc"
        ? await startWebrtcSession(i, wrtc)
        : await startPeersSession(i);
    sessions.push(row);
    sample(`up-${i + 1}`);
    console.log(
      JSON.stringify({
        phase: "ramp",
        up: i + 1,
        of: sessionsN,
        rssMb: rssMb(),
      }),
    );
  }

  const holdUntil = Date.now() + durationSec * 1000;
  let lastLogBucket = -1;
  while (Date.now() < holdUntil) {
    for (const { session } of sessions) {
      await session.input(1, 0, 1).catch(() => {});
      await session.input(1, 0, 0).catch(() => {});
      await session.input(2, 8, 1).catch(() => {});
      await session.input(2, 8, 0).catch(() => {});
    }
    sample("hold");
    const left = Math.max(0, Math.round((holdUntil - Date.now()) / 1000));
    const bucket = Math.floor(left / 10);
    if (bucket !== lastLogBucket || durationSec <= 60) {
      lastLogBucket = bucket;
      console.log(
        JSON.stringify({
          phase: "hold",
          leftSec: left,
          rssMb: rssMb(),
          sessions: sessions.length,
          failures,
        }),
      );
    }
    await new Promise((r) => setTimeout(r, sampleMs));
  }

  sample("end");

  const calibration = calibrateFromMeasurement({
    samples,
    sessions: sessionsN,
    ramMb,
    vcpu,
    baselineRssMb,
    mode,
    durationSec,
    failures,
  });

  const report = {
    at: new Date().toISOString(),
    hostPhase: 3,
    phase: failures === 0 ? "ok" : "degraded",
    sessions: sessionsN,
    durationSec,
    mode,
    failures,
    samples,
    calibration,
    estimateStatic: capacityForKnownVps(
      ramMb >= 8000 ? "prod10g5c" : "test4g2c",
      "native",
    ),
  };

  const written = writeCapacityReport(report);
  console.log(
    JSON.stringify(
      {
        phase: report.phase,
        hostPhase: 3,
        elapsedMs: Date.now() - startedAt,
        rssMb: rssMb(),
        failures,
        calibration,
        report: written.latest,
        next:
          durationSec < 600
            ? "Repetir na VPS com --duration 600 antes de fixar HOSTED_MAX_SESSIONS."
            : `Definir ${calibration.suggestedEnv} e monitorizar /api/ops/hosted-cap`,
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
  process.exit(failures > 0 ? 2 : 0);
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
