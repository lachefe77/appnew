# Host Bot — teclas no RetroArch.
# keybd_event + foco SUAVE (sem AttachThreadInput — isso + gdigrab fechava o RA).
# Linha JSONL: {"vk":90,"down":1,"hwnd":12345,"ext":0}
# Batch: {"batch":[{"vk":89,"holdMs":160},{"vk":72,"holdMs":160}],"hwnd":123}
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaKey {
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
}
"@

$defaultHwnd = 0L
if ($env:ARENA_HWND) { [int64]::TryParse($env:ARENA_HWND, [ref]$defaultHwnd) | Out-Null }
$doFocus = $true
if ($env:ARENA_INPUT_FOCUS -eq "0") { $doFocus = $false }
$script:lastFocusMs = 0L

function Ensure-Focus([IntPtr]$h) {
  if (-not $doFocus -or $h -eq [IntPtr]::Zero) { return }
  $now = [Environment]::TickCount64
  # No máximo 1 foco / 400ms — evita thrash que mata o RA
  if (
    ($now - $script:lastFocusMs) -lt 400 -and
    [ArenaKey]::GetForegroundWindow() -eq $h
  ) { return }
  if ([ArenaKey]::IsIconic($h)) { [ArenaKey]::ShowWindow($h, 9) | Out-Null }
  [ArenaKey]::AllowSetForegroundWindow(-1) | Out-Null
  [ArenaKey]::ShowWindow($h, 5) | Out-Null
  [ArenaKey]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 25
  $script:lastFocusMs = [Environment]::TickCount64
}

function Send-Vk([uint32]$vk, [bool]$down, [bool]$isExt, [IntPtr]$h) {
  $scan = [byte]([ArenaKey]::MapVirtualKey($vk, 0) -band 0xFF)
  # PostMessage (GDI) + keybd_event (DirectInput quando focado)
  if ($h -ne [IntPtr]::Zero) {
    $lp = [int64](1 -bor ([int64]$scan -shl 16))
    if ($isExt) { $lp = $lp -bor (1 -shl 24) }
    if ($down) {
      [ArenaKey]::PostMessage($h, [ArenaKey]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
    } else {
      $lpUp = $lp -bor (1 -shl 30) -bor (1 -shl 31)
      [ArenaKey]::PostMessage($h, [ArenaKey]::WM_KEYUP, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
    }
  }
  if ($down) { Ensure-Focus $h }
  $flags = 0
  if ($isExt) { $flags = $flags -bor [ArenaKey]::KEYEVENTF_EXTENDEDKEY }
  if (-not $down) { $flags = $flags -bor [ArenaKey]::KEYEVENTF_KEYUP }
  [ArenaKey]::keybd_event([byte]$vk, $scan, $flags, [UIntPtr]::Zero)
}

function Pulse-Vk([uint32]$vk, [int]$holdMs, [bool]$isExt, [IntPtr]$h) {
  Send-Vk $vk $true $isExt $h
  Start-Sleep -Milliseconds ([Math]::Max(40, $holdMs))
  Send-Vk $vk $false $isExt $h
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
while ($true) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    $msg = $line | ConvertFrom-Json
    $hwnd = $defaultHwnd
    if ($null -ne $msg.hwnd) { $hwnd = [int64]$msg.hwnd }
    $h = [IntPtr]::Zero
    if ($hwnd -gt 0) { $h = [IntPtr]$hwnd }

    if ($null -ne $msg.batch) {
      Ensure-Focus $h
      foreach ($item in $msg.batch) {
        $vk = [uint32]$item.vk
        $hold = 160
        if ($null -ne $item.holdMs) { $hold = [int]$item.holdMs }
        $ext = ($item.ext -eq 1)
        Pulse-Vk $vk $hold $ext $h
        Start-Sleep -Milliseconds 120
      }
      continue
    }

    $vk = [uint32]$msg.vk
    $isExt = ($msg.ext -eq 1)
    $down = ($msg.down -eq 1)
    Send-Vk $vk $down $isExt $h
  } catch {
    # ignora
  }
}
