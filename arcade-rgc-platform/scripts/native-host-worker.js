/**
 * Host Bot worker — JSONL stdin/stdout.
 * Modos:
 *   stub (padrão)     — samples sintéticos + WebRTC Fase 2
 *   lua-bridge        — HOST_BOT_BIN real; reencaminha ARENA_SAMPLE do Lua
 *
 * Media (HOST_BOT_MEDIA):
 *   auto | wrtc — @roamhq/wrtc + frames 320p30
 *   lab         — FSM sinalização sem RTP (CI sem nativo)
 *
 * Protocolo:
 *  → { "cmd":"start"|"input"|"signal"|... }
 *  ← { "event":"hello"|"progress"|"peer"|"ready"|"sample"|"signal"|"metrics"|... }
 */
import { createInterface } from "node:readline";
import { mapArenaInput } from "../server/native-input-map.js";
import { createNativeMediaBridge } from "../server/native-webrtc.js";
import {
  parseArenaFrameLine,
  startFfmpegFramebuffer,
} from "../server/native-framebuffer.js";
import {
  launchFromWorkerEnv,
  startNativeGameProcess,
} from "../server/native-game-process.js";
import { createInputInjector } from "../server/native-input-inject.js";

const mode = String(process.env.HOST_BOT_MODE || "stub").toLowerCase();
const autoPeers =
  String(process.env.HOST_BOT_AUTO_PEERS || "").toLowerCase() === "1" ||
  String(process.env.HOST_BOT_AUTO_PEERS || "").toLowerCase() === "true";

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
  iceServers: [],
  media: null,
  mediaBackend: null,
  ffmpegFb: null,
  game: null,
  input: null,
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

function maybeScriptedProgress() {
  if (state.scriptedWin == null || state.paused) return;
  if (state.frame > 30 && state.wins[0] === 0 && state.wins[1] === 0) {
    if (state.scriptedWin === 1) state.wins = [1, 0];
    else if (state.scriptedWin === 2) state.wins = [0, 1];
  }
}

async function ensureMedia(iceServers) {
  if (state.media) return state.media;
  state.media = await createNativeMediaBridge({
    iceServers: iceServers || [],
    emit: (ev) => {
      if (ev.event === "peer") {
        if (ev.state === "connected") state.peers.add(ev.slot);
        else state.peers.delete(ev.slot);
      }
      emit(ev);
    },
    getFrameNum: () => state.frame,
  });
  state.mediaBackend = state.media.backend;

  // Framebuffer real/lab via ffmpeg (gdigrab / lavfi testsrc / ficheiro).
  if (!state.ffmpegFb && state.media.frameSource) {
    const fb = startFfmpegFramebuffer(state.media.frameSource);
    if (fb.ok) {
      state.ffmpegFb = fb;
      emit({
        event: "progress",
        stage: "framebuffer",
        detail: { via: "ffmpeg", input: fb.capture?.args?.slice(0, 8) },
      });
    } else if (fb.error) {
      emit({
        event: "progress",
        stage: "framebuffer-skip",
        detail: { error: fb.error },
      });
    }
  }
  return state.media;
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
      state.iceServers = msg.iceServers || [];
      state.peers.clear();
      emit({ event: "progress", stage: "assets" });
      emit({ event: "progress", stage: "runtime" });
      emit({ event: "progress", stage: "boot" });

      // Fase 4b: spawna RetroArch/FBNeo se HOST_BOT_LAUNCH_BIN estiver setado.
      const gameLaunch = launchFromWorkerEnv();
      if (gameLaunch) {
        emit({ event: "progress", stage: "game" });
        state.game = startNativeGameProcess(gameLaunch, {
          onLog: (line) => {
            if (line) emit({ event: "progress", stage: "game-log", detail: line.slice(0, 200) });
          },
          onExit: (code) => {
            if (state.started && code !== 0 && code != null) {
              emit({
                event: "failure",
                message: "Core do jogo encerrou (código " + code + ").",
              });
            }
          },
        });
        if (state.game.ok) {
          state.input = createInputInjector();
          // Dá tempo à janela abrir antes do gdigrab.
          const waitMs = Number(process.env.HOST_BOT_GAME_BOOT_MS) || 2500;
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          emit({
            event: "progress",
            stage: "game-skip",
            detail: state.game.reason || "skip",
          });
        }
      }

      emit({ event: "progress", stage: "media" });
      await ensureMedia(state.iceServers);
      emit({ event: "progress", stage: "credits" });
      // Fase 1 smoke / platform sem viewers: AUTO_PEERS marca mídia pronta.
      // Fase 2 real: peers vêm do WebRTC (viewer-ready → connected).
      if (autoPeers) armPeers();
      emit({
        event: "ready",
        manifest: {
          engine: mode === "stub" ? "native-stub" : "native-lua",
          fixture: mode === "stub",
          phase: state.game?.ok ? 4 : 2,
          matchId: state.matchId,
          mode,
          media: state.mediaBackend,
          game: state.game?.ok
            ? { pid: state.game.pid, backend: state.input?.backend }
            : null,
          framebuffer: state.ffmpegFb?.ok
            ? "ffmpeg"
            : "inject-or-synthetic",
          video: { width: 320, height: 240, fps: 30 },
        },
      });
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
      // Fase 4b: teclado real no core (Windows keybd_event).
      try {
        state.input?.apply(msg.slot, msg.button, msg.value);
      } catch {
        /* ignore inject errors */
      }
      if (!state.paused) {
        maybeScriptedProgress();
        emitSample();
      }
      if (state.inputs % 120 === 0) {
        const mediaMetrics = state.media
          ? await state.media.metrics()
          : null;
        emit({
          event: "metrics",
          metrics: {
            frame: state.frame,
            engine: mode === "stub" ? "native-stub" : "native-lua",
            inputs: state.inputs,
            lastInput: mapped,
            media: mediaMetrics,
            peers: mediaMetrics?.peers
              ? Object.fromEntries(
                  mediaMetrics.peers.map((p) => [
                    p.slot,
                    {
                      slot: p.slot,
                      rttSeconds: p.rttSeconds,
                      packetsLost: p.packetsLost,
                      state: p.state,
                    },
                  ]),
                )
              : {
                  1: { slot: 1, rttSeconds: 0.02, packetsLost: 0 },
                  2: { slot: 2, rttSeconds: 0.02, packetsLost: 0 },
                },
            at: Date.now(),
          },
        });
      }
      return;
    }
    case "signal": {
      const media = await ensureMedia(state.iceServers);
      await media.signal(msg.slot, msg.signal);
      return;
    }
    case "pause":
      state.paused = true;
      state.media?.pause();
      return;
    case "resume":
      state.paused = false;
      state.media?.resume();
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
        if (msg.sample.frame != null)
          state.frame = Math.max(0, msg.sample.frame - 1);
        emitSample();
      }
      return;
    }
    case "injectResult": {
      if (!msg.winnerSlot) return;
      state.scriptedWin = Number(msg.winnerSlot);
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
    case "injectFrame": {
      const media = await ensureMedia(state.iceServers);
      if (!msg.frame) throw Error("frame obrigatório.");
      const pushed = media.pushExternal(msg.frame);
      emit({
        event: "frame",
        externalCount: media.frameSource?.externalCount,
        frame: pushed?.frame,
        at: Date.now(),
      });
      return;
    }
    case "captureEvidence": {
      const media = await ensureMedia(state.iceServers);
      const filePath = String(msg.path || "");
      if (!filePath) throw Error("path de evidência obrigatório.");
      media.frameSource?.writePpmEvidence(filePath, state.frame);
      emit({
        event: "evidence",
        path: filePath,
        frame: state.frame,
        externalCount: media.frameSource?.externalCount || 0,
        at: Date.now(),
      });
      return;
    }
    case "stop":
      state.started = false;
      try {
        state.input?.stop();
      } catch {
        /* ignore */
      }
      state.input = null;
      try {
        state.game?.stop();
      } catch {
        /* ignore */
      }
      state.game = null;
      try {
        state.ffmpegFb?.stop();
      } catch {
        /* ignore */
      }
      state.ffmpegFb = null;
      try {
        state.media?.stop();
      } catch {
        /* ignore */
      }
      state.media = null;
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
  if (line.startsWith("ARENA_SAMPLE ")) {
    try {
      const sample = JSON.parse(line.slice("ARENA_SAMPLE ".length));
      emit({ event: "sample", sample });
    } catch (error) {
      emit({
        event: "failure",
        message: "Lua sample inválido: " + error.message,
      });
    }
    return;
  }
  if (line.startsWith("ARENA_FRAME ")) {
    try {
      const media = await ensureMedia(state.iceServers);
      const norm = parseArenaFrameLine(line);
      media.pushExternal({
        width: norm.width,
        height: norm.height,
        format: "i420",
        data: norm.data,
      });
      emit({
        event: "frame",
        externalCount: media.frameSource?.externalCount,
        at: Date.now(),
      });
    } catch (error) {
      emit({
        event: "failure",
        message: "Frame inválido: " + error.message,
      });
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
  phase: 2,
  pid: process.pid,
});
