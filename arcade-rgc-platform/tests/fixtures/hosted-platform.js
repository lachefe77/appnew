// Process-only fixture. No HTTP/WebSocket endpoint can emit a worker verdict.
// These events test lifecycle/accounting, not recognition of a real KOF match.
import "dotenv/config";
import { startPlatform } from "../../server/platform.js";
const sessions = new Map();
const app = startPlatform({
  hostedFactory: (options) => {
    const session = {
      iceServers: options.iceServers || [],
      async start() {
        sessions.set(options.matchId, options);
        options.onPeer(1, "connected");
        options.onPeer(2, "connected");
        return { manifest: { fixture: true } };
      },
      async stop() {
        sessions.delete(options.matchId);
      },
      async input() {},
      async signal() {},
      async pause() {},
      async resume() {},
      resetObserver() {},
      async captureEvidence(matchId) {
        return {
          kind: "screenshot",
          path: `/tmp/fixture-evidence-${matchId}.png`,
          relativePath: `data/evidence/${matchId}/fixture.png`,
          at: Date.now(),
          sample: { frame: 1, health: [50, 40], wins: [0, 0], timer: 0 },
        };
      },
    };
    return session;
  },
});
process.on("message", (message) => {
  if (message?.type === "FIXTURE_RESULT" || message?.type === "SERIES_GAME_RESULT") {
    const session = sessions.get(message.matchId);
    if (!session) return;
    const proof = {
      winnerSlot: message.winnerSlot,
      source: "test-fixture-not-real-kof",
      frame: message.frame || 12345,
    };
    if (message.type === "SERIES_GAME_RESULT") {
      session.onObservation?.({
        event: "SERIES_GAME_RESULT",
        sample: proof,
      });
      return;
    }
    session.onResult(proof);
  }
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => app.close());
