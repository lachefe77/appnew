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
import {
  createInputInjector,
  injectCabinetCredits,
} from "../server/native-input-inject.js";
import {
  waitForWindowByPid,
  focusWindow,
  getWindowClientRect,
  hwndGrabInput,
} from "../server/native-win-window.js";

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
  gameHwnd: null,
  pendingCredits: false,
  readySent: false,
  creditsTopup: false,
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

async function waitForExternalFrames(frameSource, ms = 2000) {
  const start = Date.now();
  const before = frameSource.externalCount || 0;
  while (Date.now() - start < ms) {
    if ((frameSource.externalCount || 0) > before) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return (frameSource.externalCount || 0) > before;
}

async function startFramebufferWithFallback(frameSource) {
  const tryStart = (label) => {
    const fb = startFfmpegFramebuffer(frameSource, { ...process.env });
    if (fb.ok) {
      emit({
        event: "progress",
        stage: "framebuffer",
        detail: {
          via: "ffmpeg",
          label,
          input: fb.capture?.args?.slice(0, 10),
        },
      });
    } else {
      emit({
        event: "progress",
        stage: "framebuffer-skip",
        detail: { error: fb.error || fb.reason || "skip", label },
      });
    }
    return fb;
  };

  let fb = tryStart(process.env.HOST_BOT_FFMPEG_INPUT || "default");
  if (!fb.ok) return fb;

  const got = await waitForExternalFrames(frameSource, 2500);
  if (got) return fb;

  // Re-tenta desktop+crop com foco na janela (não usa hwnd= — crasha o core).
  const hwnd = state.gameHwnd;
  if (hwnd && process.platform === "win32") {
    try {
      fb.stop?.();
    } catch {
      /* ignore */
    }
    await focusWindow(hwnd);
    await new Promise((r) => setTimeout(r, 300));
    const rect = await getWindowClientRect(hwnd);
    if (rect) {
      process.env.HOST_BOT_FFMPEG_INPUT_KIND = "gdigrab";
      process.env.HOST_BOT_FFMPEG_INPUT = "desktop";
      process.env.HOST_BOT_FFMPEG_OFFSET_X = String(rect.x);
      process.env.HOST_BOT_FFMPEG_OFFSET_Y = String(rect.y);
      process.env.HOST_BOT_FFMPEG_SIZE = `${rect.width}x${rect.height}`;
      emit({
        event: "progress",
        stage: "framebuffer-fallback",
        detail: { to: "desktop-crop", ...rect },
      });
      fb = tryStart("desktop-crop");
      if (fb.ok) await waitForExternalFrames(frameSource, 2500);
    }
  }
  if (!got && !(frameSource.externalCount > 0)) {
    emit({
      event: "progress",
      stage: "framebuffer-empty",
      detail: {
        stderr: (fb.stderr || "").slice(-400),
        hint: "Deixa a janela RetroArch VISÍVEL (sem browsers por cima).",
      },
    });
  }
  return fb;
}

async function ensureMedia(iceServers) {
  if (state.media) return state.media;
  // auto + TTL alto: se gdigrab falhar, não fica preto para sempre (external-only).
  if (!process.env.HOST_BOT_FRAME_MODE) process.env.HOST_BOT_FRAME_MODE = "auto";
  if (!process.env.HOST_BOT_EXTERNAL_TTL_MS)
    process.env.HOST_BOT_EXTERNAL_TTL_MS = "2500";

  state.media = await createNativeMediaBridge({
    iceServers: iceServers || [],
    frameMode: process.env.HOST_BOT_FRAME_MODE,
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

  if (!state.ffmpegFb && state.media.frameSource) {
    const fb = await startFramebufferWithFallback(state.media.frameSource);
    if (fb.ok) state.ffmpegFb = fb;
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
      state.gameHwnd = null;
      state.pendingCredits = false;
      state.readySent = false;
      state.creditsTopup = false;
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
            const err = (state.game?.stderr || "").trim().slice(-800);
            emit({
              event: "progress",
              stage: "game-exit",
              detail: { code, stderr: err.slice(0, 400) },
            });
            // Para ffmpeg já — senão continua a transmitir o desktop!
            try {
              state.ffmpegFb?.stop();
            } catch {
              /* ignore */
            }
            state.ffmpegFb = null;
            if (!state.started || state.closing) return;
            // Exit 0 também é falha: era isso que deixava stream da área de trabalho.
            emit({
              event: "failure",
              message:
                "Core do jogo fechou (código " +
                (code == null ? "?" : code) +
                "). Sem emulador não há vídeo do KOF." +
                (err ? " stderr=" + err : ""),
            });
          },
        });
        if (state.game.ok) {
          // Espera a janela; captura SEMPRE desktop+crop (hwnd= costuma crashar o GL).
          const waitMs = Number(process.env.HOST_BOT_GAME_BOOT_MS) || 10000;
          const win = await waitForWindowByPid(state.game.pid, {
            timeoutMs: waitMs,
          });
          if (state.game.child?.exitCode != null && state.game.child.exitCode !== 0) {
            const err = (state.game.stderr || "").trim().slice(-800);
            emit({
              event: "failure",
              message:
                "Core do jogo encerrou no boot (código " +
                state.game.child.exitCode +
                ")." +
                (err ? " stderr=" + err : ""),
            });
            return;
          }
          const grabMode = String(
            process.env.HOST_BOT_FFMPEG_GRAB || "desktop",
          ).toLowerCase();
          process.env.HOST_BOT_FFMPEG_INPUT_KIND =
            process.env.HOST_BOT_FFMPEG_INPUT_KIND || "gdigrab";
          let grabDetail = { mode: grabMode };
          if (win?.hwnd) {
            state.gameHwnd = win.hwnd;
            await focusWindow(win.hwnd);
            if (grabMode === "hwnd") {
              const grab = hwndGrabInput(win.hwnd);
              if (grab) process.env.HOST_BOT_FFMPEG_INPUT = grab;
              grabDetail.grab = grab;
              grabDetail.warn = "hwnd pode fechar o RetroArch em GL/D3D";
            } else {
              const rect = await getWindowClientRect(win.hwnd);
              if (rect) {
                process.env.HOST_BOT_FFMPEG_INPUT = "desktop";
                process.env.HOST_BOT_FFMPEG_OFFSET_X = String(rect.x);
                process.env.HOST_BOT_FFMPEG_OFFSET_Y = String(rect.y);
                process.env.HOST_BOT_FFMPEG_SIZE = `${rect.width}x${rect.height}`;
                grabDetail = { ...grabDetail, ...rect };
              } else {
                process.env.HOST_BOT_FFMPEG_INPUT = "title=RetroArch";
                grabDetail.fallback = "title=RetroArch";
              }
            }
            emit({
              event: "progress",
              stage: "game-window",
              detail: { hwnd: win.hwnd, title: win.title, ...grabDetail },
            });
          } else {
            process.env.HOST_BOT_FFMPEG_INPUT =
              process.env.HOST_BOT_FFMPEG_INPUT || "title=RetroArch";
            emit({
              event: "progress",
              stage: "game-window-miss",
              detail: {
                pid: state.game.pid,
                fallback: process.env.HOST_BOT_FFMPEG_INPUT,
              },
            });
          }
          state.input = createInputInjector({
            hwnd: state.gameHwnd || null,
          });
          // NÃO injectar créditos no boot — teclas cedo podem fechar o RetroArch.
          // Fichas só quando os dois dão START (ver case input).
          state.pendingCredits = false;
        } else {
          emit({
            event: "progress",
            stage: "game-skip",
            detail: state.game.reason || "skip",
          });
        }
      }

      emit({ event: "progress", stage: "media" });
      // Só inicia captura se o core ainda estiver vivo.
      if (state.game?.ok && state.game.child?.exitCode != null) {
        emit({
          event: "failure",
          message: "RetroArch fechou antes da captura de vídeo.",
        });
        return;
      }
      await ensureMedia(state.iceServers);
      if (state.game?.ok && state.game.child?.exitCode != null) {
        emit({
          event: "failure",
          message:
            "RetroArch fechou ao iniciar o ffmpeg. Usa HOST_BOT_FFMPEG_GRAB=desktop e janela visível.",
        });
        return;
      }
      emit({ event: "progress", stage: "credits" });
      // Fase 1 smoke / platform sem viewers: AUTO_PEERS marca mídia pronta.
      // Fase 2 real: peers vêm do WebRTC (viewer-ready → connected).
      if (autoPeers) armPeers();
      state.readySent = true;
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
            ? {
                pid: state.game.pid,
                backend: state.input?.backend,
                alive: state.game.child?.exitCode == null,
              }
            : null,
          framebuffer: state.ffmpegFb?.ok
            ? "ffmpeg"
            : "inject-or-synthetic",
          video: { width: 320, height: 240, fps: 30 },
          grab: process.env.HOST_BOT_FFMPEG_INPUT || null,
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
        // Reforça fichas quando ambos dão START (sai do INSERT COIN / attract).
        if (state.starts.size >= 2 && state.input && !state.creditsTopup) {
          state.creditsTopup = true;
          injectCabinetCredits(state.input, { pulses: 2 }).catch(() => {});
        }
      }
      // Fase 4c: PostMessage no HWND do RetroArch (browser mantém o foco).
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
