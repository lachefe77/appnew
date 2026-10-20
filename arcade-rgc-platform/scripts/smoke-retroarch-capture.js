/**
 * Diagnóstico Windows: RetroArch fica vivo + ffmpeg desktop-crop entrega frames.
 *   npm run smoke:retroarch-capture
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { buildNativeHostLaunch } from "../server/native-host-launcher.js";
import { startNativeGameProcess } from "../server/native-game-process.js";
import {
  waitForWindowByPid,
  focusWindow,
  getWindowClientRect,
} from "../server/native-win-window.js";
import { startFfmpegFramebuffer } from "../server/native-framebuffer.js";
import { createFrameSource } from "../server/native-frame-source.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const holdMs = Number(process.env.HOST_BOT_CAPTURE_HOLD_MS) || 12000;
const launch = buildNativeHostLaunch();

if (launch.mode === "stub") {
  console.error(
    JSON.stringify({
      phase: "failed",
      error: "HOST_BOT_BIN vazio — npm run env:host-bot",
    }),
  );
  process.exit(1);
}

if (process.platform !== "win32") {
  console.error(
    JSON.stringify({
      phase: "failed",
      error: "Este smoke só corre no Windows (gdigrab).",
    }),
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    phase: "start",
    command: launch.command,
    args: launch.args,
    workdir: launch.workdir,
  }),
);

const game = startNativeGameProcess(launch, {
  onLog: (line) => console.error("[RA]", String(line).slice(0, 220)),
  onExit: (code) =>
    console.error(JSON.stringify({ phase: "exit-early", code })),
});

if (!game.ok) {
  console.error(JSON.stringify({ phase: "failed", error: "spawn falhou" }));
  process.exit(1);
}

const win = await waitForWindowByPid(game.pid, { timeoutMs: 15000 });
if (!win?.hwnd) {
  console.error(
    JSON.stringify({
      phase: "failed",
      error: "sem-janela",
      stderr: (game.stderr || "").slice(-600),
    }),
  );
  game.stop();
  process.exit(1);
}

await focusWindow(win.hwnd);
await new Promise((r) => setTimeout(r, 3000));

if (game.child?.exitCode != null) {
  console.error(
    JSON.stringify({
      phase: "failed",
      error: "fechou-apos-janela",
      code: game.child.exitCode,
      stderr: (game.stderr || "").slice(-800),
    }),
  );
  process.exit(1);
}

const rect = await getWindowClientRect(win.hwnd);
if (!rect) {
  console.error(JSON.stringify({ phase: "failed", error: "sem-rect" }));
  game.stop();
  process.exit(1);
}

process.env.HOST_BOT_FFMPEG_INPUT_KIND = "gdigrab";
process.env.HOST_BOT_FFMPEG_INPUT = "desktop";
process.env.HOST_BOT_FFMPEG_OFFSET_X = String(rect.x);
process.env.HOST_BOT_FFMPEG_OFFSET_Y = String(rect.y);
process.env.HOST_BOT_FFMPEG_SIZE = `${rect.width}x${rect.height}`;

const frames = createFrameSource({ mode: "external", onFrame: () => {} });
frames.resume?.();
const fb = startFfmpegFramebuffer(frames, process.env);
console.log(
  JSON.stringify({
    phase: "capture",
    rect,
    ok: fb.ok,
    error: fb.error || null,
  }),
);

const t0 = Date.now();
while (Date.now() - t0 < holdMs) {
  await new Promise((r) => setTimeout(r, 1000));
  const alive = game.child?.exitCode == null;
  console.log(
    JSON.stringify({
      phase: "tick",
      ms: Date.now() - t0,
      alive,
      externalCount: frames.externalCount,
      exitCode: game.child?.exitCode ?? null,
    }),
  );
  if (!alive) {
    console.error(
      JSON.stringify({
        phase: "failed",
        error: "retroarch-fechou-durante-captura",
        stderr: (game.stderr || "").slice(-800),
        ffmpegStderr: (fb.stderr || "").slice(-400),
      }),
    );
    try {
      fb.stop?.();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
}

const ok = frames.externalCount > 30 && game.child?.exitCode == null;
console.log(
  JSON.stringify({
    phase: ok ? "ok" : "failed",
    externalCount: frames.externalCount,
    alive: game.child?.exitCode == null,
    ffmpegStderr: (fb.stderr || "").slice(-300),
    cfg: fs.existsSync(path.join(launch.workdir, "arena-host-runtime.cfg"))
      ? "arena-host-runtime.cfg"
      : null,
  }),
);

try {
  fb.stop?.();
} catch {
  /* ignore */
}
try {
  game.stop();
} catch {
  /* ignore */
}
process.exit(ok ? 0 : 1);
