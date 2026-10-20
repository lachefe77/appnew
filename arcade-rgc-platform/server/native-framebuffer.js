/**
 * Ingest de framebuffer para Host Bot (pós Fase 2).
 * Fontes:
 *   - injectFrame / ARENA_FRAME (JSONL base64) — lab e testes
 *   - ffmpeg stdout raw yuv420p 320x240 — captura janela RetroArch/FBNeo
 */
import { spawn } from "node:child_process";
import {
  NATIVE_FRAME,
  i420ByteLength,
  normalizeExternalFrame,
} from "./native-frame-source.js";

/**
 * Monta cmdline ffmpeg → raw I420 320×240 em stdout.
 * Windows lab: gdigrab da janela RetroArch.
 * Linux: x11grab (DISPLAY).
 *
 * Env:
 *   HOST_BOT_FFMPEG=ffmpeg
 *   HOST_BOT_FFMPEG_INPUT_KIND=gdigrab|x11grab|rawfile|lavfi
 *   HOST_BOT_FFMPEG_INPUT=title=RetroArch | :0.0 | path.mp4 | testsrc
 */
export function buildFfmpegFrameCapture(env = process.env) {
  const bin = String(env.HOST_BOT_FFMPEG || "ffmpeg").trim();
  const kind = String(env.HOST_BOT_FFMPEG_INPUT_KIND || "").toLowerCase();
  const input = String(env.HOST_BOT_FFMPEG_INPUT || "").trim();
  const fps = Number(env.HOST_BOT_FRAME_FPS) || NATIVE_FRAME.fps;
  const w = NATIVE_FRAME.width;
  const h = NATIVE_FRAME.height;

  if (!kind && !input) return null;

  const outArgs = [
    "-an",
    "-vf",
    // force size exacto + yuv420p evita riscas (chroma desalinhada / SAR estranho)
    `scale=${w}:${h}:flags=neighbor:force_original_aspect_ratio=disable,format=yuv420p,setsar=1`,
    "-r",
    String(fps),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "yuv420p",
    "pipe:1",
  ];

  let args;
  if (kind === "gdigrab" || (!kind && process.platform === "win32")) {
    // desktop SEM offset/size = ecrã inteiro (bug clássico). Exigir crop ou title=/hwnd=.
    const i = input || "title=RetroArch";
    const ox = Number(env.HOST_BOT_FFMPEG_OFFSET_X);
    const oy = Number(env.HOST_BOT_FFMPEG_OFFSET_Y);
    const size = String(env.HOST_BOT_FFMPEG_SIZE || "").trim();
    const desktopCrop =
      i === "desktop" &&
      Number.isFinite(ox) &&
      Number.isFinite(oy) &&
      /^\d+x\d+$/.test(size);
    if (i === "desktop" && !desktopCrop) {
      throw Error(
        "gdigrab desktop sem crop (OFFSET_X/Y + SIZE) — recusado para não transmitir o PC inteiro. Defina a janela do RetroArch ou use title=RetroArch.",
      );
    }
    const grabArgs = [
      "-y",
      "-f",
      "gdigrab",
      "-framerate",
      String(fps),
      "-draw_mouse",
      "0",
    ];
    if (desktopCrop) {
      grabArgs.push("-offset_x", String(Math.max(0, Math.floor(ox))));
      grabArgs.push("-offset_y", String(Math.max(0, Math.floor(oy))));
      grabArgs.push("-video_size", size);
    }
    grabArgs.push("-i", i, ...outArgs);
    args = grabArgs;
  } else if (kind === "x11grab") {
    const i = input || ":0.0";
    args = [
      "-y",
      "-f",
      "x11grab",
      "-framerate",
      String(fps),
      "-video_size",
      env.HOST_BOT_FFMPEG_SIZE || "640x480",
      "-i",
      i,
      ...outArgs,
    ];
  } else if (kind === "rawfile" || kind === "file") {
    if (!input) throw Error("HOST_BOT_FFMPEG_INPUT obrigatório para rawfile.");
    args = ["-y", "-i", input, ...outArgs];
  } else if (kind === "lavfi" || kind === "testsrc") {
    // Lab sem janela: gera padrão — valida o pipe ffmpeg→worker.
    const i = input || `testsrc=size=${w}x${h}:rate=${fps}`;
    args = ["-y", "-f", "lavfi", "-i", i, ...outArgs];
  } else {
    throw Error("HOST_BOT_FFMPEG_INPUT_KIND inválido: " + kind);
  }

  return { command: bin, args, width: w, height: h, fps };
}

/**
 * Lê stdout raw I420 e chama onI420(Buffer) a cada frame.
 * @returns {{ stop: () => void, child: import('child_process').ChildProcess }}
 */
export function attachRawI420Pump(readable, { width, height, onI420, onError }) {
  const frameSize = i420ByteLength(width, height);
  let buf = Buffer.alloc(0);
  let frames = 0;
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= frameSize) {
      const frame = buf.subarray(0, frameSize);
      buf = buf.subarray(frameSize);
      frames++;
      try {
        onI420(Buffer.from(frame));
      } catch (error) {
        onError?.(error);
      }
    }
  };
  readable.on("data", onData);
  readable.on("error", (error) => onError?.(error));
  return {
    get frames() {
      return frames;
    },
    stop() {
      readable.off("data", onData);
    },
  };
}

/**
 * Spawna ffmpeg (se configurado) e bombeia I420 para frameSource.pushExternal.
 */
export function startFfmpegFramebuffer(frameSource, env = process.env) {
  let capture;
  try {
    capture = buildFfmpegFrameCapture(env);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (!capture) return { ok: false, skipped: true };

  const child = spawn(capture.command, capture.args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ...env },
  });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += String(d);
    if (stderr.length > 4000) stderr = stderr.slice(-2000);
  });

  const pump = attachRawI420Pump(child.stdout, {
    width: capture.width,
    height: capture.height,
    onI420: (data) => {
      frameSource.pushExternal({
        width: capture.width,
        height: capture.height,
        format: "i420",
        data,
      });
    },
    onError: () => {},
  });

  return {
    ok: true,
    child,
    pump,
    capture,
    stop() {
      pump.stop();
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
    get stderr() {
      return stderr;
    },
  };
}

/** Parse linha ARENA_FRAME {...} → objeto para pushExternal. */
export function parseArenaFrameLine(line) {
  const prefix = "ARENA_FRAME ";
  if (!line.startsWith(prefix)) return null;
  const json = JSON.parse(line.slice(prefix.length));
  return normalizeExternalFrame(json);
}
