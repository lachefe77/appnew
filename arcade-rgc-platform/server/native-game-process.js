/**
 * Spawna o core real (RetroArch/FBNeo) ao lado do worker JSONL (Fase 4b).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * @param {{ command: string, args?: string[], workdir?: string, env?: Record<string,string> }} launch
 * @param {{ onExit?: (code: number|null) => void, onLog?: (line: string) => void }} [hooks]
 */
export function startNativeGameProcess(launch, hooks = {}) {
  if (!launch?.command) return { ok: false, skipped: true, reason: "sem-bin" };
  const cwd = launch.workdir || process.cwd();
  try {
    fs.mkdirSync(cwd, { recursive: true });
  } catch {
    /* ignore */
  }

  const child = spawn(launch.command, launch.args || [], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(launch.env || {}) },
    windowsHide: false, // precisa janela visível para gdigrab no Windows
    detached: false,
  });

  let stderr = "";
  child.stderr?.on("data", (buf) => {
    const t = String(buf);
    stderr += t;
    if (stderr.length > 8000) stderr = stderr.slice(-4000);
    hooks.onLog?.(t.trim());
  });
  child.stdout?.on("data", (buf) => {
    const t = String(buf).trim();
    if (t) hooks.onLog?.(t);
  });
  child.on("exit", (code) => hooks.onExit?.(code));

  return {
    ok: true,
    child,
    pid: child.pid,
    get stderr() {
      return stderr;
    },
    stop() {
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }, 3000).unref?.();
      }
    },
  };
}

/** Lê HOST_BOT_LAUNCH_* do env do worker (passados pelo NativeHostSession). */
export function launchFromWorkerEnv(env = process.env) {
  const mode = String(env.HOST_BOT_LAUNCH_MODE || "").toLowerCase();
  const command = String(env.HOST_BOT_LAUNCH_BIN || "").trim();
  if (!command || mode === "stub") return null;
  let args = [];
  try {
    args = JSON.parse(env.HOST_BOT_LAUNCH_ARGS || "[]");
    if (!Array.isArray(args)) args = [];
  } catch {
    args = String(env.HOST_BOT_ARGS || "")
      .split(/\s+/)
      .filter(Boolean);
  }
  const workdir = env.HOST_BOT_WORKDIR
    ? path.resolve(process.cwd(), env.HOST_BOT_WORKDIR)
    : process.cwd();
  return { mode, command, args, workdir };
}
