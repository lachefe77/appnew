/**
 * Injeta teclas no OS para o core RetroArch/FBNeo (Fase 4b/4c).
 * Windows: PowerShell + PostMessage no HWND (não rouba foco do browser).
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

const EXTENDED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "NumpadEnter",
  "Numpad8",
  "Numpad2",
  "Numpad4",
  "Numpad6",
]);

export function vkForKey(key) {
  return VK[key] || null;
}

/**
 * @param {{ hwnd?: number|null, env?: NodeJS.ProcessEnv }} [opts]
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
      send({
        vk,
        down: mapped.value === 1 ? 1 : 0,
        key: mapped.key,
        hwnd: hwnd || undefined,
        ext: EXTENDED_KEYS.has(mapped.key) ? 1 : 0,
      });
    },
    async pulse(slot, button, holdMs = 80) {
      this.apply(slot, button, 1);
      await new Promise((r) => setTimeout(r, holdMs));
      this.apply(slot, button, 0);
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

/** Insere fichas no gabinete FBNeo (hosted bloqueia button 2 no cliente). */
export async function injectCabinetCredits(input, { pulses = 3, gapMs = 120 } = {}) {
  if (!input?.pulse && !input?.apply) return;
  for (let i = 0; i < pulses; i++) {
    if (input.pulse) {
      await input.pulse(1, 2, 70);
      await new Promise((r) => setTimeout(r, gapMs));
      await input.pulse(2, 2, 70);
    } else {
      input.apply(1, 2, 1);
      await new Promise((r) => setTimeout(r, 70));
      input.apply(1, 2, 0);
      await new Promise((r) => setTimeout(r, gapMs));
      input.apply(2, 2, 1);
      await new Promise((r) => setTimeout(r, 70));
      input.apply(2, 2, 0);
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
