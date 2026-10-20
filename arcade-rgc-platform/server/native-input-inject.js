/**
 * Injeta teclas no RetroArch/FBNeo (Fase 4c).
 * - Jogabilidade: PostMessage no HWND (não vaza para o Chrome)
 * - Fichas auto (1× P1 + 1× P2): um foco breve + keybd_event Y/H (sem F1–F12)
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapArenaInput } from "./native-input-map.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    return {
      apply() {},
      stop() {},
      backend: "off",
      batchCredits: async () => {},
    };
  }

  if (process.platform === "win32") {
    return createWindowsInjector(opts.hwnd || null, env);
  }

  return {
    backend: "noop",
    apply(slot, button, value) {
      mapArenaInput(slot, button, value);
    },
    async batchCredits() {},
    stop() {},
  };
}

/**
 * Exactamente 1 ficha P1 (Y) + 1 ficha P2 (H) no RetroArch.
 * Foco breve só neste momento — sem F1/F12.
 */
export async function seedDuelCredits(hwnd, { holdMs = 200, gapMs = 250 } = {}) {
  const h = Number(hwnd) || 0;
  if (h <= 0 || process.platform !== "win32") return { ok: false, reason: "no-hwnd" };
  const cmd = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaCoin {
  public const uint KEYUP = 0x0002;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
function Pulse-Y([IntPtr]$h, [byte]$vk, [int]$hold) {
  $scan = [byte]([ArenaCoin]::MapVirtualKey([uint32]$vk, 0) -band 0xFF)
  $lp = [int64](1 -bor ([int64]$scan -shl 16))
  [ArenaCoin]::PostMessage($h, [ArenaCoin]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
  [ArenaCoin]::keybd_event($vk, $scan, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds $hold
  $lpUp = $lp -bor (1 -shl 30) -bor (1 -shl 31)
  [ArenaCoin]::PostMessage($h, [ArenaCoin]::WM_KEYUP, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
  [ArenaCoin]::keybd_event($vk, $scan, [ArenaCoin]::KEYUP, [UIntPtr]::Zero)
}
$h = [IntPtr]${h}
[ArenaCoin]::AllowSetForegroundWindow(-1) | Out-Null
[ArenaCoin]::ShowWindow($h, 5) | Out-Null
[ArenaCoin]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 50
Pulse-Y $h 0x59 ${holdMs}   # Y = P1 coin
Start-Sleep -Milliseconds ${gapMs}
Pulse-Y $h 0x48 ${holdMs}   # H = P2 coin
`;
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 },
  );
  return { ok: true, keys: ["Y", "H"], each: 1 };
}

function createWindowsInjector(hwnd, env = process.env) {
  const script = path.join(root, "scripts/host-bot-lua/host-bot-input-win.ps1");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
      env: {
        ...env,
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
    backend: "win-hwnd+coin-y",
    hwnd: hwnd || null,
    apply(slot, button, value) {
      if (!hwnd) return;
      const mapped = mapArenaInput(slot, button, value);
      const vk = vkForKey(mapped.key);
      if (vk == null) return;
      send({
        vk,
        down: mapped.value === 1 ? 1 : 0,
        key: mapped.key,
        hwnd,
        ext: EXTENDED_KEYS.has(mapped.key) ? 1 : 0,
      });
    },
    async pulse(slot, button, holdMs = 80) {
      this.apply(slot, button, 1);
      await new Promise((r) => setTimeout(r, holdMs));
      this.apply(slot, button, 0);
    },
    /** 1 ficha P1 (Y) + 1 ficha P2 (H) — chamado ao aceitar o duelo. */
    async batchCredits() {
      return seedDuelCredits(hwnd, { holdMs: 220, gapMs: 280 });
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

/** Compat: 1+1 fichas (ignora pulses>1 — duelo = uma por lado). */
export async function injectCabinetCredits(input) {
  if (!input) return;
  if (typeof input.batchCredits === "function") {
    await input.batchCredits();
    return;
  }
  if (input.pulse) {
    await input.pulse(1, 2, 220);
    await new Promise((r) => setTimeout(r, 280));
    await input.pulse(2, 2, 220);
  }
}
