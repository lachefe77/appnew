/**
 * Injeta teclas no OS para o core RetroArch/FBNeo (Fase 4b/4c).
 * Windows: PowerShell PostMessage/SendMessage no HWND.
 * Nunca SetForegroundWindow enquanto o gdigrab corre — isso fechava o RetroArch.
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapArenaInput } from "./native-input-map.js";

const execFileAsync = promisify(execFile);
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
  KeyY: 0x59,
  KeyH: 0x48,
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

/** One-shot só PostMessage/SendMessage — sem foco (não mata o RA + gdigrab). */
async function oneShotVk(vk, hwnd, { holdMs = 140, ext = false } = {}) {
  const h = Number(hwnd) || 0;
  if (h <= 0) return;
  const extFlag = ext ? 1 : 0;
  const cmd = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaShot {
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
}
"@
$vk = [uint32]${vk}
$h = [IntPtr]${h}
$hold = ${holdMs}
$ext = ${extFlag}
$scan = [ArenaShot]::MapVirtualKey($vk, 0)
$lp = [int64](1 -bor ([int64]$scan -shl 16))
if ($ext -eq 1) { $lp = $lp -bor (1 -shl 24) }
[ArenaShot]::PostMessage($h, [ArenaShot]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
[ArenaShot]::SendMessage($h, [ArenaShot]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
Start-Sleep -Milliseconds $hold
$lpUp = $lp -bor (1 -shl 30) -bor (1 -shl 31)
[ArenaShot]::PostMessage($h, [ArenaShot]::WM_KEYUP, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
[ArenaShot]::SendMessage($h, [ArenaShot]::WM_KEYUP, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
`;
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    { windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024 },
  );
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
        ARENA_INPUT_FOCUS: "0",
      },
    },
  );
  let dead = false;
  child.on("exit", () => {
    dead = true;
  });
  child.stderr?.on("data", () => {});
  try {
    child.stdin?.setDefaultEncoding?.("utf8");
  } catch {
    /* ignore */
  }

  function send(msg) {
    if (dead || !child.stdin?.writable) return;
    try {
      child.stdin.write(JSON.stringify(msg) + "\n");
    } catch {
      /* ignore */
    }
  }

  return {
    backend: "win-postmsg",
    hwnd: hwnd || null,
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
      const mapped = mapArenaInput(slot, button, 1);
      const vk = vkForKey(mapped.key);
      if (vk == null) return;
      if (button === 2 || button === 3) {
        await oneShotVk(vk, hwnd, {
          holdMs,
          ext: EXTENDED_KEYS.has(mapped.key),
        });
        return;
      }
      this.apply(slot, button, 1);
      await new Promise((r) => setTimeout(r, holdMs));
      this.apply(slot, button, 0);
    },
    async pulseVk(vk, holdMs = 140) {
      await oneShotVk(vk, hwnd, { holdMs });
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

/** Insere fichas: 2 por jogador (P1=Y, P2=H) sem roubar foco. */
export async function injectCabinetCredits(
  input,
  { pulses = 2, gapMs = 220, holdMs = 160 } = {},
) {
  if (!input) return;
  for (let i = 0; i < pulses; i++) {
    if (input.pulse) {
      await input.pulse(1, 2, holdMs);
      await new Promise((r) => setTimeout(r, gapMs));
      await input.pulse(2, 2, holdMs);
    } else if (input.pulseVk) {
      await input.pulseVk(VK.KeyY, holdMs);
      await new Promise((r) => setTimeout(r, gapMs));
      await input.pulseVk(VK.KeyH, holdMs);
    } else {
      input.apply(1, 2, 1);
      await new Promise((r) => setTimeout(r, holdMs));
      input.apply(1, 2, 0);
      await new Promise((r) => setTimeout(r, gapMs));
      input.apply(2, 2, 1);
      await new Promise((r) => setTimeout(r, holdMs));
      input.apply(2, 2, 0);
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
