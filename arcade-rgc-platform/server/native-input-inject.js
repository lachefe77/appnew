/**
 * Injeta teclas no RetroArch/FBNeo (Fase 4c).
 * Windows: PowerShell keybd_event + foco suave (throttle) + PostMessage.
 * Batch de fichas num único comando (menos thrash → RA não fecha).
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
  F1: 0x70,
  F2: 0x71,
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
    return { apply() {}, stop() {}, backend: "off", batchCredits: async () => {} };
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

/** Batch one-shot: 1 foco + várias teclas (fichas). */
async function oneShotBatch(hwnd, pulses, holdMs) {
  const h = Number(hwnd) || 0;
  if (h <= 0) return;
  const items = [];
  for (let i = 0; i < pulses; i++) {
    items.push({ vk: VK.F1, holdMs }); // P1 Select/Coin
    items.push({ vk: VK.F2, holdMs }); // P2 Select/Coin
  }
  const cmd = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaShot {
  public const uint KEYUP = 0x0002;
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
}
"@
$h = [IntPtr]${h}
[ArenaShot]::AllowSetForegroundWindow(-1) | Out-Null
[ArenaShot]::ShowWindow($h, 5) | Out-Null
[ArenaShot]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 40
$batch = ConvertFrom-Json '${JSON.stringify(items)}'
foreach ($item in $batch) {
  $vk = [byte]$item.vk
  $hold = [int]$item.holdMs
  $scan = [byte]([ArenaShot]::MapVirtualKey([uint32]$vk, 0) -band 0xFF)
  $lp = [int64](1 -bor ([int64]$scan -shl 16))
  [ArenaShot]::PostMessage($h, [ArenaShot]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
  [ArenaShot]::keybd_event($vk, $scan, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds $hold
  $lpUp = $lp -bor (1 -shl 30) -bor (1 -shl 31)
  [ArenaShot]::PostMessage($h, [ArenaShot]::WM_KEYUP, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
  [ArenaShot]::keybd_event($vk, $scan, [ArenaShot]::KEYUP, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 140
}
`;
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    { windowsHide: true, timeout: 20000, maxBuffer: 64 * 1024 },
  );
}

function createWindowsInjector(hwnd, env = process.env) {
  const script = path.join(root, "scripts/host-bot-lua/host-bot-input-win.ps1");
  const focus =
    String(env.ARENA_INPUT_FOCUS || "1").toLowerCase() === "0" ? "0" : "1";
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
      env: {
        ...env,
        ...(hwnd ? { ARENA_HWND: String(hwnd) } : {}),
        ARENA_INPUT_FOCUS: focus,
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
    backend: "win-keybd-soft",
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
      this.apply(slot, button, 1);
      await new Promise((r) => setTimeout(r, holdMs));
      this.apply(slot, button, 0);
    },
    async batchCredits(pulses = 2, holdMs = 200) {
      // Prefer bridge batch (mesmo processo PS) — F1/F2 = Select/Coin Neo Geo
      if (!dead && child.stdin?.writable) {
        const batch = [];
        for (let i = 0; i < pulses; i++) {
          batch.push({ vk: VK.F1, holdMs, ext: 0 });
          batch.push({ vk: VK.F2, holdMs, ext: 0 });
        }
        send({ batch, hwnd: hwnd || undefined });
        await new Promise((r) => setTimeout(r, pulses * 2 * (holdMs + 180)));
        return;
      }
      await oneShotBatch(hwnd, pulses, holdMs);
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

/** Insere fichas: 2× P1(F1) + 2× P2(F2) num batch estável. */
export async function injectCabinetCredits(
  input,
  { pulses = 2, gapMs = 220, holdMs = 200 } = {},
) {
  if (!input) return;
  if (typeof input.batchCredits === "function") {
    await input.batchCredits(pulses, holdMs);
    return;
  }
  for (let i = 0; i < pulses; i++) {
    if (input.pulse) {
      await input.pulse(1, 2, holdMs);
      await new Promise((r) => setTimeout(r, gapMs));
      await input.pulse(2, 2, holdMs);
    } else {
      input.apply?.(1, 2, 1);
      await new Promise((r) => setTimeout(r, holdMs));
      input.apply?.(1, 2, 0);
      await new Promise((r) => setTimeout(r, gapMs));
      input.apply?.(2, 2, 1);
      await new Promise((r) => setTimeout(r, holdMs));
      input.apply?.(2, 2, 0);
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
