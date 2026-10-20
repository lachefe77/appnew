/**
 * Windows: HWND / rect da janela do RetroArch + foco.
 * gdigrab em hwnd de janela GL/D3D vem preto; preferir desktop+crop (DWM)
 * ou video_driver sdl2/gdi no RetroArch.
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
 * @returns {Promise<{ hwnd: number, title: string, pid: number }|null>}
 */
export async function findWindowByPid(pid) {
  if (process.platform !== "win32" || !pid) return null;
  const cmd = `
$target = [int]$env:ARENA_PID
$p = Get-Process -Id $target -ErrorAction SilentlyContinue
if (-not $p) { '{}'; exit 0 }
$h = [int64]$p.MainWindowHandle
if ($h -eq 0) {
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

/**
 * Rect do cliente (área do jogo) em coordenadas de ecrã.
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
 */
export async function getWindowClientRect(hwnd) {
  if (process.platform !== "win32" || !hwnd) return null;
  const cmd = `
$h = [IntPtr][int64]$env:ARENA_HWND
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
}
"@
$r = New-Object ArenaRect+RECT
if (-not [ArenaRect]::GetClientRect($h, [ref]$r)) { '{}'; exit 0 }
$pt = New-Object ArenaRect+POINT
$pt.X = 0; $pt.Y = 0
[ArenaRect]::ClientToScreen($h, [ref]$pt) | Out-Null
$w = [Math]::Max(1, $r.R - $r.L)
$ht = [Math]::Max(1, $r.B - $r.T)
# gdigrab exige tamanho par
if ($w % 2 -ne 0) { $w-- }
if ($ht % 2 -ne 0) { $ht-- }
@{ x = [int]$pt.X; y = [int]$pt.Y; width = [int]$w; height = [int]$ht } | ConvertTo-Json -Compress
`;
  try {
    const raw = await runPs(cmd, { ARENA_HWND: String(hwnd) });
    const data = JSON.parse(raw || "{}");
    const x = Number(data.x),
      y = Number(data.y),
      width = Number(data.width),
      height = Number(data.height);
    if (![x, y, width, height].every((n) => Number.isFinite(n)) || width < 16 || height < 16)
      return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
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
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@
$HWND_TOPMOST = [IntPtr](-1)
$SWP = 0x0001 -bor 0x0002 -bor 0x0040
if ([ArenaFocus]::IsIconic($h)) { [ArenaFocus]::ShowWindow($h, 9) | Out-Null }
[ArenaFocus]::ShowWindow($h, 5) | Out-Null
[ArenaFocus]::BringWindowToTop($h) | Out-Null
# TOPMOST: crop desktop não filma o browser por cima do RetroArch
[ArenaFocus]::SetWindowPos($h, $HWND_TOPMOST, 0, 0, 0, 0, $SWP) | Out-Null
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

export function hwndGrabInput(hwnd) {
  const n = Number(hwnd);
  if (!Number.isFinite(n) || n <= 0) return null;
  return "hwnd=" + n;
}
