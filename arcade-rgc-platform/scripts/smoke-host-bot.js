/**
 * Smoke do Host Bot nativo (sem Chrome) — Fase 1: input + samples.
 * Uso na VPS / PC (PowerShell):
 *   $env:HOSTED_ENGINE="native"
 *   npm run smoke:host-bot -- 4
 */
import { NativeHostSession } from "../server/native-host-session.js";

const n = Math.max(1, Math.min(20, Number(process.argv[2]) || 2));
const startedAt = Date.now();
const sessions = [];

console.log(
  JSON.stringify({
    phase: "start",
    engine: "native-stub",
    hostPhase: 1,
    sessions: n,
    hint: "Fase 1 = spawn + input map + samples. Vídeo = Fase 2.",
  }),
);

try {
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

  const mem = process.memoryUsage();
  console.log(
    JSON.stringify(
      {
        phase: "ok",
        hostPhase: 1,
        sessions: sessions.length,
        elapsedMs: Date.now() - startedAt,
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapMb: Math.round(mem.heapUsed / 1024 / 1024),
        detail: sessions.map((s) => ({
          i: s.i,
          peers: s.peerCount,
          samples: s.sampleCount,
          lastFrame: s.lastSample?.frame ?? null,
          manifest: s.manifest,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify({ phase: "failed", error: error.message }));
  process.exitCode = 1;
} finally {
  await Promise.all(
    sessions.map(({ session }) => session.stop().catch(() => {})),
  );
}
