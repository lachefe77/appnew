/**
 * Injeta teclas no OS para o core RetroArch/FBNeo (Fase 4b).
 * Windows: PowerShell + keybd_event (sem addon nativo).
 * Outros: no-op (lab).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapArenaInput } from "./native-input-map.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Virtual-key codes (US) para as teclas do native-input-map. */
export const VK = Object.freeze({
  ArrowUp: 0x26,
  ArrowDown: 0x28,
  ArrowLeft: 0x25,
  ArrowRight: 0x27,
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  KeyZ: 0x5a,
  KeyX: 0x58,
  KeyA: 0x41,
  KeyS: 0x53,
  KeyU: 0x55,
  KeyI: 0x49,
  KeyJ: 0x4a,
  KeyK: 0x4b,
  Digit5: 0x35,
  Digit6: 0x36,
  Numpad8: 0x68,
  Numpad2: 0x62,
  Numpad4: 0x64,
  Numpad6: 0x66,
});

export function vkForKey(key) {
  return VK[key] || null;
}

/**
 * @param {{ hwnd?: number|null, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ apply: (slot, button, value) => void, stop: () => void, backend: string }}
 */
export function createInputInjector(opts = {}) {
  const env = opts.env || process.env;
  const enabled =
    String(env.HOST_BOT_INPUT || "auto").toLowerCase() !== "off" &&
    String(env.HOST_BOT_INPUT || "auto").toLowerCase() !== "0";

  if (!enabled) {
    return { apply() {}, stop() {}, backend: "off" };
  }

  if (process.platform === "win32") {
    return createWindowsInjector(opts.hwnd || null);
  }

  // Linux lab: regista só (sem X11 fake); encode/lab não precisa.
  return {
    backend: "noop",
    apply(slot, button, value) {
      mapArenaInput(slot, button, value);
    },
    stop() {},
  };
}

function createWindowsInjector(hwnd) {
  const script = path.join(root, "scripts/host-bot-lua/host-bot-input-win.ps1");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...(hwnd ? { ARENA_HWND: String(hwnd) } : {}),
      },
    },
  );
  let dead = false;
  let lastFocusAt = 0;
  child.on("exit", () => {
    dead = true;
  });
  child.stderr?.on("data", () => {});

  function send(msg) {
    if (dead || !child.stdin?.writable) return;
    try {
      child.stdin.write(JSON.stringify(msg) + "\n");
    } catch {
      /* ignore */
    }
  }

  return {
    backend: "win-keybd",
    apply(slot, button, value) {
      const mapped = mapArenaInput(slot, button, value);
      const vk = vkForKey(mapped.key);
      if (vk == null) return;
      // Re-foca a janela do core de tempos a tempos (browser rouba o foco).
      const now = Date.now();
      const needFocus = hwnd && now - lastFocusAt > 700;
      if (needFocus) lastFocusAt = now;
      send({
        vk,
        down: mapped.value === 1 ? 1 : 0,
        key: mapped.key,
        hwnd: hwnd || undefined,
        focus: needFocus ? 1 : 0,
      });
    },
    stop() {
      try {
        child.stdin?.end();
      } catch {
        /* ignore */
      }
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    },
  };
}
