/**
 * Monta comando do Host Bot real (RetroArch/FBNeo) ou stub de lab.
 * Framebuffer: ver buildFfmpegFrameCapture em native-framebuffer.js.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retroArchKeyboardLines } from "./native-input-map.js";
import { buildFfmpegFrameCapture } from "./native-framebuffer.js";

export { buildFfmpegFrameCapture };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveHostBotBin(env = process.env) {
  const bin = String(env.HOST_BOT_BIN || "").trim();
  return bin || null;
}

export function luaReporterPath() {
  return path.join(root, "scripts/host-bot-lua/kof2002-reporter.lua");
}

/**
 * Resolve o core FBNeo para path absoluto (Windows: cores\fbneo_libretro.dll).
 * Com cwd = pasta da ROM, o nome curto "fbneo_libretro" costuma falhar.
 */
export function resolveRetroArchCore(bin, env = process.env) {
  const raw = String(env.HOST_BOT_CORE || "fbneo_libretro").trim();
  if (!raw) return "fbneo_libretro";
  if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw;
  if (fs.existsSync(raw)) return path.resolve(raw);

  const dir = path.dirname(bin);
  const base = raw.replace(/\.(dll|so|dylib)$/i, "");
  const candidates = [
    path.join(dir, "cores", base + ".dll"),
    path.join(dir, "cores", base + ".so"),
    path.join(dir, "cores", base + "_libretro.dll"),
    path.join(dir, "cores", base + "_libretro.so"),
    path.join(dir, "cores", "fbneo_libretro.dll"),
    path.join(dir, "cores", "fbneo_libretro.so"),
    path.join(dir, base + ".dll"),
    path.join(dir, base + ".so"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Último recurso: deixa o RetroArch resolver (pode falhar se cwd ≠ install).
  return raw;
}

/**
 * @returns {{ mode: "stub"|"retroarch"|"custom", command: string, args: string[], workdir: string, env: Record<string,string>, core?: string }}
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
    const rom = path.resolve(
      env.HOST_BOT_ROM || path.join(workdir, "kof2002.zip"),
    );
    const core = resolveRetroArchCore(bin, env);
    // Sempre regenera cfg no workdir (gdi + anti-quit). Override: HOST_BOT_APPENDCONFIG.
    const append = env.HOST_BOT_APPENDCONFIG
      ? path.resolve(env.HOST_BOT_APPENDCONFIG)
      : writeRuntimeAppendConfig(workdir, env);
    const verbose =
      String(env.HOST_BOT_VERBOSE || "1").trim() === "1" ||
      String(env.HOST_BOT_VERBOSE || "").toLowerCase() === "true";
    const args = [
      "-L",
      core,
      rom,
      "--appendconfig",
      append,
      ...(verbose ? ["-v"] : []),
      ...extra,
    ];
    return {
      mode: "retroarch",
      command: bin,
      args,
      workdir,
      core,
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
export function defaultRetroArchLabConfig(env = process.env) {
  // gdi: estável com desktop-crop; override HOST_BOT_VIDEO_DRIVER= (vazio) para default.
  const driverRaw = env.HOST_BOT_VIDEO_DRIVER;
  const driver =
    driverRaw === undefined || driverRaw === null
      ? "gdi"
      : String(driverRaw).trim();
  return [
    "# Gerado para lab Host Bot — teclado P1/P2 (native-input-map)",
    driver ? `video_driver = "${driver}"` : "# video_driver: default do RetroArch",
    'video_fullscreen = "false"',
    'video_windowed_fullscreen = "false"',
    'video_threaded = "false"',
    // Som local na janela RetroArch (WebRTC ainda é só vídeo no lab).
    'audio_enable = "true"',
    'audio_mute_enable = "false"',
    'audio_sync = "false"',
    'fps_show = "false"',
    'config_save_on_exit = "false"',
    'quit_on_close_content = "false"',
    'pause_nonactive = "false"',
    'input_exit_emulator = "nul"',
    'input_close_content = "nul"',
    'input_menu_toggle = "nul"',
    'input_toggle_fullscreen = "nul"',
    'input_autodetect_enable = "false"',
    'input_max_users = "2"',
    'input_auto_game_focus = "off"',
    // Sem forçar input_driver (raw/dinput variam por build). PostMessage no HWND.
    ...retroArchKeyboardLines(1),
    ...retroArchKeyboardLines(2),
    "",
  ].join("\n");
}

/**
 * Grava appendconfig no workdir (paths estáveis no Windows).
 * Preferido a apontar para scripts/ no repo (evita cfg antigo em cache).
 */
export function writeRuntimeAppendConfig(workdir, env = process.env) {
  const dir = workdir || path.join(root, "data/hosted/kof2002");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  const dest = path.join(dir, "arena-host-runtime.cfg");
  fs.writeFileSync(dest, defaultRetroArchLabConfig(env), "utf8");
  return dest;
}
