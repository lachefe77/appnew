/**
 * Injeta teclas no OS para o core RetroArch/FBNeo (Fase 4b/4c).
 * Windows: PowerShell long-running (stdin UTF-8) + one-shot fallback p/ fichas.
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

/** One-shot fiável (não depende do pipe stdin do processo longo). */
async function oneShotVk(vk, hwnd, { holdMs = 140, ext = false } = {}) {
  const h = Number(hwnd) || 0;
  const extFlag = ext ? 1 : 0;
  const cmd = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaShot {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  public const uint KEYUP = 0x0002; public const uint EXT = 0x0001;
}
"@
$vk = [byte]${vk}
$h = [IntPtr]${h}
$hold = ${holdMs}
$ext = ${extFlag}
if ($h -ne [IntPtr]::Zero) {
  [ArenaShot]::AllowSetForegroundWindow(-1) | Out-Null
  [ArenaShot]::ShowWindow($h, 5) | Out-Null
  [ArenaShot]::BringWindowToTop($h) | Out-Null
  [ArenaShot]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 30
}
$scan = [byte]([ArenaShot]::MapVirtualKey([uint32]$vk, 0) -band 0xFF)
$fl = 0; if ($ext -eq 1) { $fl = $fl -bor [ArenaShot]::EXT }
[ArenaShot]::keybd_event($vk, $scan, $fl, [UIntPtr]::Zero)
Start-Sleep -Milliseconds $hold
[ArenaShot]::keybd_event($vk, $scan, ($fl -bor [ArenaShot]::KEYUP), [UIntPtr]::Zero)
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
    backend: "win-keybd",
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
      // Fichas / START: one-shot (fiável). Resto: bridge stdin.
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

/** Insere fichas: 2 por jogador (P1=Y, P2=H) via one-shot fiável. */
export async function injectCabinetCredits(
  input,
  { pulses = 2, gapMs = 200, holdMs = 160 } = {},
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
