/**
 * Host Bot worker — JSONL stdin/stdout.
 * Modos:
 *   stub (padrão)     — samples sintéticos; sem FBNeo; lab Fase 1
 *   lua-bridge        — HOST_BOT_BIN real; reencaminha ARENA_SAMPLE do Lua
 *
 * Protocolo:
 *  → { "cmd":"start"|"input"|"signal"|"pause"|"resume"|"stop"|"resetObserver"|"injectResult"|"injectSample", ... }
 *  ← { "event":"hello"|"progress"|"peer"|"ready"|"sample"|"observation"|"result"|"metrics"|"failure"|"stopped", ... }
 */
import { createInterface } from "node:readline";
import { mapArenaInput } from "../server/native-input-map.js";

const mode = String(process.env.HOST_BOT_MODE || "stub").toLowerCase();

const state = {
  started: false,
  paused: true,
  peers: new Set(),
  frame: 0,
  inputs: 0,
  matchId: null,
  starts: new Set(),
  health: [0x67, 0x67],
  timer: 0x60,
  wins: [0, 0],
  scriptedWin: null,
  lastMapped: null,
};

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function emitSample(extra = {}) {
  state.frame++;
  const sample = {
    frame: state.frame,
    health: [...state.health],
    timer: state.timer,
    wins: [...state.wins],
    ...extra,
  };
  emit({ event: "sample", sample });
  return sample;
}

function armPeers() {
  emit({ event: "peer", slot: 1, state: "connected" });
  emit({ event: "peer", slot: 2, state: "connected" });
  state.peers.add(1);
  state.peers.add(2);
}

/** Lab: após combate “armado”, pode forçar vitória via injectResult. */
function maybeScriptedProgress() {
  if (state.scriptedWin == null || state.paused) return;
  // Avança wins do vencedor após alguns samples de combate.
  if (state.frame > 30 && state.wins[0] === 0 && state.wins[1] === 0) {
    if (state.scriptedWin === 1) state.wins = [1, 0];
    else if (state.scriptedWin === 2) state.wins = [0, 1];
  }
}

async function handle(msg) {
  switch (msg.cmd) {
    case "start": {
      state.matchId = msg.matchId || null;
      state.started = true;
      state.paused = true;
      state.frame = 0;
      state.inputs = 0;
      state.starts.clear();
      state.health = [0x67, 0x67];
      state.timer = 0x60;
      state.wins = [0, 0];
      state.scriptedWin = null;
      emit({ event: "progress", stage: "assets" });
      emit({ event: "progress", stage: "runtime" });
      emit({ event: "progress", stage: "boot" });
      emit({ event: "progress", stage: "credits" });
      armPeers();
      emit({
        event: "ready",
        manifest: {
          engine: mode === "stub" ? "native-stub" : "native-lua",
          fixture: mode === "stub",
          phase: 1,
          matchId: state.matchId,
          mode,
        },
      });
      // Sample inicial (pré-combate)
      emitSample();
      return;
    }
    case "input": {
      if (!state.started) return;
      state.inputs++;
      const mapped = mapArenaInput(msg.slot, msg.button, msg.value);
      state.lastMapped = mapped;
      if (mapped.button === 3 && mapped.value === 1) {
        state.starts.add(mapped.slot);
      }
      // Stub: a cada input (quando rodando) emite sample de estado.
      if (!state.paused) {
        maybeScriptedProgress();
        emitSample();
      }
      if (state.inputs % 120 === 0) {
        emit({
          event: "metrics",
          metrics: {
            frame: state.frame,
            engine: mode === "stub" ? "native-stub" : "native-lua",
            inputs: state.inputs,
            lastInput: mapped,
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
      return;
    case "pause":
      state.paused = true;
      return;
    case "resume":
      state.paused = false;
      emitSample();
      return;
    case "resetObserver":
      state.frame = 0;
      state.starts.clear();
      state.health = [0x67, 0x67];
      state.timer = 0x60;
      state.wins = [0, 0];
      state.scriptedWin = null;
      return;
    case "injectSample": {
      if (msg.sample && typeof msg.sample === "object") {
        if (msg.sample.health) state.health = [...msg.sample.health];
        if (msg.sample.wins) state.wins = [...msg.sample.wins];
        if (msg.sample.timer != null) state.timer = msg.sample.timer;
        if (msg.sample.frame != null) state.frame = Math.max(0, msg.sample.frame - 1);
        emitSample();
      }
      return;
    }
    case "injectResult": {
      if (!msg.winnerSlot) return;
      state.scriptedWin = Number(msg.winnerSlot);
      // Também emite result direto (lab) — NativeHostSession pode liquidar sem observer.
      emit({
        event: "result",
        result: {
          winnerSlot: state.scriptedWin,
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
  // Linhas do Lua reporter (se o binário compartilhar stdout)
  if (line.startsWith("ARENA_SAMPLE ")) {
    try {
      const sample = JSON.parse(line.slice("ARENA_SAMPLE ".length));
      emit({ event: "sample", sample });
    } catch (error) {
      emit({ event: "failure", message: "Lua sample inválido: " + error.message });
    }
    return;
  }
  try {
    await handle(JSON.parse(line));
  } catch (error) {
    emit({ event: "failure", message: error.message || String(error) });
  }
});

emit({
  event: "hello",
  engine: mode === "stub" ? "native-stub" : "native-lua",
  mode,
  phase: 1,
  pid: process.pid,
});
