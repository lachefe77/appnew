/**
 * Diagnóstico: o RetroArch fica aberto ≥15s com o mesmo cmdline do host?
 *   node scripts/smoke-retroarch-alive.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { buildNativeHostLaunch } from "../server/native-host-launcher.js";
import { startNativeGameProcess } from "../server/native-game-process.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const holdMs = Number(process.env.HOST_BOT_ALIVE_MS) || 15000;
const launch = buildNativeHostLaunch();

if (launch.mode === "stub") {
  console.error(
    JSON.stringify({
      phase: "failed",
      error: "HOST_BOT_BIN vazio — configura .env primeiro",
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
    holdMs,
  }),
);

const game = startNativeGameProcess(launch, {
  onLog: (line) => console.error("[RA]", line.slice(0, 240)),
  onExit: (code) =>
    console.error(JSON.stringify({ phase: "exit-early", code })),
});

if (!game.ok) {
  console.error(JSON.stringify({ phase: "failed", error: "spawn falhou" }));
  process.exit(1);
}

const t0 = Date.now();
const timer = setInterval(() => {
  const alive = game.child?.exitCode == null;
  console.log(
    JSON.stringify({
      phase: "tick",
      ms: Date.now() - t0,
      alive,
      pid: game.pid,
      exitCode: game.child?.exitCode ?? null,
    }),
  );
  if (!alive) {
    clearInterval(timer);
    console.error(
      JSON.stringify({
        phase: "failed",
        error: "RetroArch fechou antes de " + holdMs + "ms",
        stderr: (game.stderr || "").slice(-1000),
      }),
    );
    process.exit(1);
  }
}, 2000);

setTimeout(() => {
  clearInterval(timer);
  const alive = game.child?.exitCode == null;
  console.log(
    JSON.stringify({
      phase: alive ? "ok" : "failed",
      heldMs: holdMs,
      alive,
      stderrTail: (game.stderr || "").slice(-500),
    }),
  );
  try {
    game.stop();
  } catch {
    /* ignore */
  }
  process.exit(alive ? 0 : 1);
}, holdMs);
