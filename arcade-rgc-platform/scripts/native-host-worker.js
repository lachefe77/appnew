/**
 * Host Bot worker (lab/stub) — processo filho leve via JSONL stdin/stdout.
 * Substitui o papel do Chrome: futuro binário FBNeo/libretro fala o mesmo protocolo.
 *
 * Protocolo (uma linha JSON por mensagem):
 *  → { "cmd":"start"|"input"|"signal"|"pause"|"resume"|"stop"|"resetObserver", ... }
 *  ← { "event":"progress"|"peer"|"ready"|"observation"|"result"|"metrics"|"failure"|"stopped", ... }
 */
import { createInterface } from "node:readline";

const state = {
  started: false,
  paused: true,
  peers: new Set(),
  frame: 0,
  inputs: 0,
  matchId: null,
};

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function armPeers() {
  // Lab: marca mídia “conectada” sem Chrome/WebRTC real.
  // Fase 2 plugará encode/WebRTC real mantendo estes eventos.
  emit({ event: "peer", slot: 1, state: "connected" });
  emit({ event: "peer", slot: 2, state: "connected" });
  state.peers.add(1);
  state.peers.add(2);
}

async function handle(msg) {
  switch (msg.cmd) {
    case "start": {
      state.matchId = msg.matchId || null;
      state.started = true;
      state.paused = true;
      state.frame = 0;
      state.inputs = 0;
      emit({ event: "progress", stage: "assets" });
      emit({ event: "progress", stage: "runtime" });
      emit({ event: "progress", stage: "boot" });
      emit({ event: "progress", stage: "credits" });
      armPeers();
      emit({
        event: "ready",
        manifest: { engine: "native-stub", fixture: true, matchId: state.matchId },
      });
      return;
    }
    case "input": {
      if (!state.started) return;
      state.inputs++;
      state.frame++;
      // Stub não emula KOF; não inventa vitória automática.
      if (state.inputs % 120 === 0) {
        emit({
          event: "metrics",
          metrics: {
            frame: state.frame,
            engine: "native-stub",
            inputs: state.inputs,
            peers: {
              1: { slot: 1, rttSeconds: 0.02, packetsLost: 0 },
              2: { slot: 2, rttSeconds: 0.02, packetsLost: 0 },
            },
            at: Date.now(),
          },
        });
      }
      return;
    }
    case "signal":
      // Fase 2: encaminhar ICE/SDP ao encoder. Stub ignora payload.
      return;
    case "pause":
      state.paused = true;
      return;
    case "resume":
      state.paused = false;
      return;
    case "resetObserver":
      state.frame = 0;
      return;
    case "injectResult": {
      // Só lab/testes: platform/fixture pode pedir resultado sintético.
      if (!msg.winnerSlot) return;
      emit({
        event: "result",
        result: {
          winnerSlot: msg.winnerSlot,
          source: "native-stub",
          frame: state.frame,
        },
      });
      return;
    }
    case "stop":
      state.started = false;
      emit({ event: "stopped" });
      process.exit(0);
      return;
    default:
      emit({ event: "failure", message: "Comando desconhecido: " + msg.cmd });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    await handle(JSON.parse(line));
  } catch (error) {
    emit({ event: "failure", message: error.message || String(error) });
  }
});

emit({ event: "hello", engine: "native-stub", pid: process.pid });
