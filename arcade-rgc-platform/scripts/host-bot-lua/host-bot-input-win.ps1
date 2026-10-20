# Host Bot — teclas no RetroArch.
# keybd_event (DirectInput vê) + PostMessage; foco throttle (máx 1/250ms).
# NUNCA F1–F12. Ficha = Y. Não devolver foco ao browser (evita thrash).
# JSONL: {"vk":89,"down":1,"hwnd":123,"ext":0}
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
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@

$defaultHwnd = 0L
if ($env:ARENA_HWND) { [int64]::TryParse($env:ARENA_HWND, [ref]$defaultHwnd) | Out-Null }
$doFocus = $true
if ($env:ARENA_INPUT_FOCUS -eq "0") { $doFocus = $false }
$script:lastFocusMs = 0L
$script:topMostDone = $false

function Ensure-Game([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return }
  if (-not $script:topMostDone) {
    # TOP uma vez — captura crop continua no jogo; sem AttachThreadInput
    $HWND_TOP = [IntPtr]::Zero
    [ArenaKey]::SetWindowPos($h, $HWND_TOP, 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
    $script:topMostDone = $true
  }
  if (-not $doFocus) { return }
  if ([ArenaKey]::GetForegroundWindow() -eq $h) { return }
  $now = [Environment]::TickCount64
  if (($now - $script:lastFocusMs) -lt 250) { return }
  if ([ArenaKey]::IsIconic($h)) { [ArenaKey]::ShowWindow($h, 9) | Out-Null }
  [ArenaKey]::AllowSetForegroundWindow(-1) | Out-Null
  [ArenaKey]::ShowWindow($h, 5) | Out-Null
  [ArenaKey]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 15
  $script:lastFocusMs = [Environment]::TickCount64
}

function Send-Vk([uint32]$vk, [bool]$down, [bool]$isExt, [IntPtr]$h) {
  # Bloqueia F1–F12 (0x70–0x7B) — conflito com Chrome
  if ($vk -ge 0x70 -and $vk -le 0x7B) { return }
  $scan = [byte]([ArenaKey]::MapVirtualKey($vk, 0) -band 0xFF)
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
  if ($down) { Ensure-Game $h }
  $flags = 0
  if ($isExt) { $flags = $flags -bor [ArenaKey]::KEYEVENTF_EXTENDEDKEY }
  if (-not $down) { $flags = $flags -bor [ArenaKey]::KEYEVENTF_KEYUP }
  [ArenaKey]::keybd_event([byte]$vk, $scan, $flags, [UIntPtr]::Zero)
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
    if ($hwnd -le 0) { continue }
    $h = [IntPtr]$hwnd

    if ($null -ne $msg.batch) {
      Ensure-Game $h
      foreach ($item in $msg.batch) {
        $vk = [uint32]$item.vk
        if ($vk -ge 0x70 -and $vk -le 0x7B) { continue }
        $hold = 200
        if ($null -ne $item.holdMs) { $hold = [int]$item.holdMs }
        $ext = ($item.ext -eq 1)
        Send-Vk $vk $true $ext $h
        Start-Sleep -Milliseconds $hold
        Send-Vk $vk $false $ext $h
        Start-Sleep -Milliseconds 120
      }
      continue
    }

    $vk = [uint32]$msg.vk
    Send-Vk $vk ($msg.down -eq 1) ($msg.ext -eq 1) $h
  } catch { }
}
