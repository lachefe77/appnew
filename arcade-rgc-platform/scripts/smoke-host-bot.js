/**
 * Smoke do Host Bot nativo (sem Chrome).
 * Uso na VPS de teste (PowerShell):
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
    sessions: n,
    hint: "Primeiro teste = stub leve. FBNeo real + vídeo = próxima fase.",
  }),
);

try {
  for (let i = 0; i < n; i++) {
    let peerCount = 0;
    const session = new NativeHostSession({
      matchId: `smoke_${i}`,
      onPeer: (_slot, state) => {
        if (state === "connected") peerCount++;
      },
      onFailure: (message) => {
        throw new Error(`session ${i}: ${message}`);
      },
    });
    await session.start();
    await session.resume();
    for (let k = 0; k < 10; k++) {
      await session.input(1, 0, 1);
      await session.input(1, 0, 0);
      await session.input(2, 8, 1);
      await session.input(2, 8, 0);
    }
    sessions.push({ session, i, peerCount, manifest: session.manifest });
  }

  const mem = process.memoryUsage();
  console.log(
    JSON.stringify(
      {
        phase: "ok",
        sessions: sessions.length,
        elapsedMs: Date.now() - startedAt,
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapMb: Math.round(mem.heapUsed / 1024 / 1024),
        detail: sessions.map((s) => ({
          i: s.i,
          peers: s.peerCount,
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
