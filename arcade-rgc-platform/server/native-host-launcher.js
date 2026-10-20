/**
 * Monta comando do Host Bot real (RetroArch/FBNeo) ou stub de lab.
 * Fase 1: spawn + args; vídeo/WebRTC = Fase 2.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retroArchKeyboardLines } from "./native-input-map.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveHostBotBin(env = process.env) {
  const bin = String(env.HOST_BOT_BIN || "").trim();
  return bin || null;
}

export function luaReporterPath() {
  return path.join(root, "scripts/host-bot-lua/kof2002-reporter.lua");
}

/**
 * @returns {{ mode: "stub"|"retroarch"|"custom", command: string, args: string[], workdir: string, env: Record<string,string> }}
 */
export function buildNativeHostLaunch(env = process.env) {
  const workdir = env.HOST_BOT_WORKDIR
    ? path.resolve(root, env.HOST_BOT_WORKDIR)
    : path.join(root, "data/hosted/kof2002");
  const bin = resolveHostBotBin(env);

  if (!bin) {
    return {
      mode: "stub",
      command: process.execPath,
      args: [path.join(root, "scripts/native-host-worker.js")],
      workdir: root,
      env: {
        HOST_BOT_MODE: "stub",
        HOST_BOT_LUA: luaReporterPath(),
      },
    };
  }

  const extra = String(env.HOST_BOT_ARGS || "")
    .split(/\s+/)
    .filter(Boolean);
  const baseName = path.basename(bin).toLowerCase();
  const isRetro =
    baseName.includes("retroarch") ||
    String(env.HOST_BOT_KIND || "").toLowerCase() === "retroarch";

  if (isRetro) {
    const rom =
      env.HOST_BOT_ROM ||
      path.join(workdir, "kof2002.zip");
    const args = [
      "-L",
      env.HOST_BOT_CORE || "fbneo_libretro",
      rom,
      "--appendconfig",
      env.HOST_BOT_APPENDCONFIG || path.join(root, "scripts/host-bot-lua/retroarch-lab.cfg"),
      ...extra,
    ];
    return {
      mode: "retroarch",
      command: bin,
      args,
      workdir,
      env: {
        HOST_BOT_MODE: "lua-bridge",
        HOST_BOT_LUA: luaReporterPath(),
      },
    };
  }

  return {
    mode: "custom",
    command: bin,
    args: extra,
    workdir,
    env: {
      HOST_BOT_MODE: "lua-bridge",
      HOST_BOT_LUA: luaReporterPath(),
    },
  };
}

/** Conteúdo mínimo de appendconfig para lab (teclado P1+P2). */
export function defaultRetroArchLabConfig() {
  return [
    "# Gerado para lab Host Bot — teclado P1/P2 (native-input-map)",
    "video_fullscreen = \"false\"",
    "video_windowed_fullscreen = \"false\"",
    "audio_enable = \"false\"",
    "fps_show = \"false\"",
    "input_autodetect_enable = \"false\"",
    ...retroArchKeyboardLines(1),
    ...retroArchKeyboardLines(2),
    "",
  ].join("\n");
}
