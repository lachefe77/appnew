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
  gameTitle: null,
  pendingCredits: false,
  readySent: false,
  creditsTopup: false,
  gameWatch: null,
  closing: false,
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

function gameAlive() {
  return !!(state.game?.ok && state.game.child && state.game.child.exitCode == null);
}

function stopCapture(reason) {
  try {
    state.ffmpegFb?.stop();
  } catch {
    /* ignore */
  }
  state.ffmpegFb = null;
  if (state.gameWatch) {
    clearInterval(state.gameWatch);
    state.gameWatch = null;
  }
  if (reason) {
    emit({ event: "progress", stage: "capture-stop", detail: { reason } });
  }
}

function armGameWatchdog() {
  if (state.gameWatch) clearInterval(state.gameWatch);
  state.gameWatch = setInterval(() => {
    if (!state.started || state.closing) return;
    if (!state.game?.ok) return;
    if (state.game.child?.exitCode == null) return;
    stopCapture("game-pid-dead");
    if (!state.closing) {
      emit({
        event: "failure",
        message:
          "RetroArch fechou (watchdog). Sem janela do jogo não há vídeo — sessão encerrada.",
      });
    }
  }, 200);
  state.gameWatch.unref?.();
}

async function tryFfmpeg(frameSource, label) {
  const fb = startFfmpegFramebuffer(frameSource, { ...process.env });
  if (!fb.ok) {
    emit({
      event: "progress",
      stage: "framebuffer-skip",
      detail: { error: fb.error || fb.reason || "skip", label },
    });
    return { fb, got: false };
  }
  emit({
    event: "progress",
    stage: "framebuffer",
    detail: { via: "ffmpeg", label, input: fb.capture?.args?.slice(0, 14) },
  });
  const got = await waitForExternalFrames(frameSource, 2500);
  if (!got) {
    emit({
      event: "progress",
      stage: "framebuffer-empty",
      detail: {
        label,
        stderr: (fb.stderr || "").slice(-500),
      },
    });
    try {
      fb.stop?.();
    } catch {
      /* ignore */
    }
  }
  return { fb, got };
}

async function startFramebufferWithFallback(frameSource) {
  delete process.env.HOST_BOT_FFMPEG_OFFSET_X;
  delete process.env.HOST_BOT_FFMPEG_OFFSET_Y;
  delete process.env.HOST_BOT_FFMPEG_SIZE;
  process.env.HOST_BOT_FFMPEG_INPUT_KIND = "gdigrab";

  // NUNCA title=/hwnd= — BitBlt no GL/D3D mata o RetroArch neste PC.
  // Só desktop+crop DWM da HWND, com retries enquanto o PID viver.
  const attempts = Number(process.env.HOST_BOT_CAPTURE_RETRIES) || 3;
  for (let i = 0; i < attempts; i++) {
    if (!gameAlive() || !state.gameHwnd) {
      return {
        ok: false,
        error: "retroarch-morto-antes-captura",
        stderr: (state.game?.stderr || "").slice(-600),
      };
    }
    await focusWindow(state.gameHwnd);
    await new Promise((r) => setTimeout(r, 500));
    // Re-resolve HWND (splash → janela real)
    try {
      const again = await waitForWindowByPid(state.game.pid, {
        timeoutMs: 1500,
        intervalMs: 200,
      });
      if (again?.hwnd) {
        state.gameHwnd = again.hwnd;
        state.gameTitle = again.title || state.gameTitle;
      }
    } catch {
      /* ignore */
    }
    const rect = await getWindowClientRect(state.gameHwnd);
    if (!rect || rect.width < 64 || rect.height < 64 || rect.width >= 3840) {
      emit({
        event: "progress",
        stage: "framebuffer-skip",
        detail: { error: "rect-invalid", attempt: i + 1, rect: rect || null },
      });
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    process.env.HOST_BOT_FFMPEG_INPUT = "desktop";
    process.env.HOST_BOT_FFMPEG_OFFSET_X = String(rect.x);
    process.env.HOST_BOT_FFMPEG_OFFSET_Y = String(rect.y);
    process.env.HOST_BOT_FFMPEG_SIZE = `${rect.width}x${rect.height}`;
    emit({
      event: "progress",
      stage: "framebuffer-try",
      detail: { to: "desktop-crop", attempt: i + 1, ...rect },
    });
    const { fb, got } = await tryFfmpeg(frameSource, "desktop-crop-" + (i + 1));
    if (!gameAlive()) {
      return {
        ok: false,
        error: "retroarch-fechou-durante-ffmpeg",
        stderr: (state.game?.stderr || "").slice(-800),
      };
    }
    if (got) return fb;
    await new Promise((r) => setTimeout(r, 600));
  }

  return {
    ok: false,
    error: "sem-frames-desktop-crop",
    stderr: (state.game?.stderr || "").slice(-600),
  };
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
    state.ffmpegFb = await startFramebufferWithFallback(state.media.frameSource);
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
      state.closing = false;
      if (state.gameWatch) {
        clearInterval(state.gameWatch);
        state.gameWatch = null;
      }
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
            stopCapture("game-exit-" + code);
            if (!state.started || state.closing) return;
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
          // Espera a janela; captura preferida = desktop+crop DWM (title= BitBlt falha no GL).
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
          delete process.env.HOST_BOT_FFMPEG_OFFSET_X;
          delete process.env.HOST_BOT_FFMPEG_OFFSET_Y;
          delete process.env.HOST_BOT_FFMPEG_SIZE;
          process.env.HOST_BOT_FFMPEG_INPUT_KIND = "gdigrab";
          // Nunca title=/hwnd= (BitBlt crash). Crop prepara-se em ensureMedia.
          process.env.HOST_BOT_FFMPEG_GRAB = "desktop-crop";
          if (!win?.hwnd) {
            emit({
              event: "failure",
              message:
                "Janela do RetroArch não apareceu. pid=" +
                state.game.pid +
                " stderr=" +
                (state.game.stderr || "").slice(-400),
            });
            return;
          }
          state.gameHwnd = win.hwnd;
          state.gameTitle = win.title || "RetroArch";
          await focusWindow(win.hwnd);
          // Estabiliza: se fechar nos próximos 3.5s, falha antes do ffmpeg.
          await new Promise((r) => setTimeout(r, 3500));
          if (!gameAlive()) {
            emit({
              event: "failure",
              message:
                "RetroArch fechou logo após abrir a janela. stderr=" +
                (state.game.stderr || "").slice(-500),
            });
            return;
          }
          // Re-lê HWND após boot (GDI/splash).
          const win2 = await waitForWindowByPid(state.game.pid, {
            timeoutMs: 2000,
            intervalMs: 250,
          });
          if (win2?.hwnd) {
            state.gameHwnd = win2.hwnd;
            state.gameTitle = win2.title || state.gameTitle;
            await focusWindow(state.gameHwnd);
          }
          process.env.HOST_BOT_FFMPEG_INPUT = "desktop";
          emit({
            event: "progress",
            stage: "game-window",
            detail: {
              hwnd: state.gameHwnd,
              title: state.gameTitle,
              grab: "desktop-crop",
              alive: true,
            },
          });
          state.input = createInputInjector({
            hwnd: state.gameHwnd || null,
          });
          state.pendingCredits = false;
          armGameWatchdog();
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
      if (state.game?.ok && !gameAlive()) {
        emit({
          event: "failure",
          message: "RetroArch fechou ao iniciar o ffmpeg.",
        });
        return;
      }
      // Partida real: NÃO seguir com barras synthetic (falso “vídeo”).
      const ext = state.media?.frameSource?.externalCount || 0;
      if (state.game?.ok && ext < 1) {
        const why = state.ffmpegFb?.error || "sem-frames";
        emit({
          event: "failure",
          message:
            "Sem frames do RetroArch (" +
            why +
            "). alive=" +
            gameAlive() +
            " title=" +
            (state.gameTitle || "") +
            " stderr=" +
            (state.game?.stderr || "").slice(-400),
        });
        return;
      }
      emit({ event: "progress", stage: "credits" });
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
                alive: gameAlive(),
                title: state.gameTitle || null,
              }
            : null,
          framebuffer: ext > 0 ? "ffmpeg" : "inject-or-synthetic",
          externalCount: ext,
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
      state.closing = true;
      state.started = false;
      stopCapture("stop");
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
