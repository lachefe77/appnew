/**
 * Windows: localiza HWND da janela do RetroArch (por PID) e traz para frente.
 * Usado por gdigrab (hwnd=…) e input (foco antes de keybd_event).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runPs(command, envExtra = {}) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      env: { ...process.env, ...envExtra },
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 256 * 1024,
    },
  );
  return String(stdout || "").trim();
}

/**
 * @param {number} pid
 * @returns {Promise<{ hwnd: number, title: string }|null>}
 */
export async function findWindowByPid(pid) {
  if (process.platform !== "win32" || !pid) return null;
  const cmd = `
$target = [int]$env:ARENA_PID
$p = Get-Process -Id $target -ErrorAction SilentlyContinue
if (-not $p) { '{}'; exit 0 }
$h = [int64]$p.MainWindowHandle
if ($h -eq 0) {
  # Algumas builds expõem a janela noutro processo filho — varre por título.
  $hit = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'RetroArch|FinalBurn|FBNeo'
  } | Select-Object -First 1
  if ($hit) {
    @{ hwnd = [int64]$hit.MainWindowHandle; title = [string]$hit.MainWindowTitle; pid = $hit.Id } | ConvertTo-Json -Compress
    exit 0
  }
  '{}'; exit 0
}
@{ hwnd = $h; title = [string]$p.MainWindowTitle; pid = $target } | ConvertTo-Json -Compress
`;
  try {
    const raw = await runPs(cmd, { ARENA_PID: String(pid) });
    const data = JSON.parse(raw || "{}");
    const hwnd = Number(data.hwnd);
    if (!Number.isFinite(hwnd) || hwnd <= 0) return null;
    return { hwnd, title: String(data.title || ""), pid: Number(data.pid) || pid };
  } catch {
    return null;
  }
}

/** Espera a janela do processo (RetroArch) aparecer. */
export async function waitForWindowByPid(
  pid,
  { timeoutMs = 20000, intervalMs = 400 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const win = await findWindowByPid(pid);
    if (win) return win;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

export async function focusWindow(hwnd) {
  if (process.platform !== "win32" || !hwnd) return false;
  const cmd = `
$h = [IntPtr][int64]$env:ARENA_HWND
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
"@
if ([ArenaFocus]::IsIconic($h)) { [ArenaFocus]::ShowWindow($h, 9) | Out-Null }
[ArenaFocus]::ShowWindow($h, 5) | Out-Null
[ArenaFocus]::BringWindowToTop($h) | Out-Null
[ArenaFocus]::SetForegroundWindow($h) | Out-Null
"ok"
`;
  try {
    await runPs(cmd, { ARENA_HWND: String(hwnd) });
    return true;
  } catch {
    return false;
  }
}

/** Formato aceite pelo ffmpeg gdigrab. */
export function hwndGrabInput(hwnd) {
  const n = Number(hwnd);
  if (!Number.isFinite(n) || n <= 0) return null;
  return "hwnd=" + n;
}
