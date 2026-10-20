/**
 * Checklist Fase 4 / 4b — o que falta para testar no VPS 4GB.
 * Uso: node scripts/check-host-bot-ready.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHostedEngine } from "../server/host-bot-factory.js";
import { resolveHostedMaxSessions } from "../server/hosted-queue.js";
import { buildNativeHostLaunch } from "../server/native-host-launcher.js";
import { buildFfmpegFrameCapture } from "../server/native-framebuffer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = resolveHostedEngine();
const cap = resolveHostedMaxSessions();
const launch = buildNativeHostLaunch();
const ffmpeg = (() => {
  try {
    return buildFfmpegFrameCapture();
  } catch (e) {
    return { error: e.message };
  }
})();

const romDir =
  process.env.HOST_BOT_WORKDIR ||
  process.env.HOSTED_GAME_DIR ||
  path.join(root, "data/hosted/kof2002");
const romZip = process.env.HOST_BOT_ROM || path.join(romDir, "kof2002.zip");
const biosZip = path.join(romDir, "neogeo.zip");

const checks = [
  {
    id: "engine",
    ok: engine === "native",
    detail: `HOSTED_ENGINE=${engine} (queremos native)`,
  },
  {
    id: "cap",
    ok: cap >= 4 && cap <= 8,
    detail: `HOSTED_MAX_SESSIONS efetivo=${cap} (meta 4–8 no VPS 4GB; bench sugeriu 6)`,
  },
  {
    id: "wrtc",
    ok: true,
    detail: "Depende de @roamhq/wrtc instalado (npm ci)",
  },
  {
    id: "bin",
    ok: launch.mode !== "stub",
    detail:
      launch.mode === "stub"
        ? "HOST_BOT_BIN vazio → stub lab (OK para fila; falta para jogo real)"
        : `launch mode=${launch.mode} bin=${launch.command}`,
  },
  {
    id: "rom",
    ok: fs.existsSync(romZip),
    detail: fs.existsSync(romZip)
      ? `ROM ok: ${romZip}`
      : `ROM em falta: ${romZip} (npm run setup:hosted)`,
  },
  {
    id: "bios",
    ok: fs.existsSync(biosZip),
    detail: fs.existsSync(biosZip)
      ? `BIOS ok: ${biosZip}`
      : `BIOS em falta: ${biosZip}`,
  },
  {
    id: "ffmpeg",
    ok: !!(ffmpeg && ffmpeg.command && !ffmpeg.error),
    detail: ffmpeg?.error
      ? `ffmpeg: ${ffmpeg.error}`
      : ffmpeg?.command
        ? `ffmpeg captura: ${ffmpeg.args?.slice(0, 6).join(" ")}…`
        : "HOST_BOT_FFMPEG_* não configurado (vídeo sintético/inject)",
  },
  {
    id: "input",
    ok: process.platform === "win32" || process.env.HOST_BOT_INPUT === "off",
    detail:
      process.platform === "win32"
        ? "Windows: input via PowerShell keybd_event"
        : "Input real só no Windows (neste VPS)",
  },
];

const readyQueue = checks.filter((c) => ["engine", "cap"].includes(c.id)).every((c) => c.ok);
const readyGame = checks.every((c) => c.ok);

console.log(
  JSON.stringify(
    {
      phase: readyGame ? "ready-game" : readyQueue ? "ready-queue" : "blocked",
      hostPhase: "4/4b",
      engine,
      hostedMaxSessions: cap,
      launchMode: launch.mode,
      platform: process.platform,
      checks,
      next: readyGame
        ? "npm run smoke:host-bot -- 1 webrtc  (com HOST_BOT_BIN + gdigrab)"
        : readyQueue
          ? "Fila OK para testar. Para jogo real: HOST_BOT_BIN + ROM + ffmpeg gdigrab."
          : "Corrigir checks com ok:false no .env",
    },
    null,
    2,
  ),
);
process.exit(readyQueue ? 0 : 1);
