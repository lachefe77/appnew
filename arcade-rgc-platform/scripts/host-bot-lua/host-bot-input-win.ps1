# Host Bot Fase 4b — injeta teclas via keybd_event (JSONL stdin).
# Linha: {"vk":90,"down":1,"hwnd":12345,"focus":1}
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaKey {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@

function Focus-Hwnd([int64]$hwnd) {
  if ($hwnd -le 0) { return }
  $h = [IntPtr]$hwnd
  if ([ArenaKey]::IsIconic($h)) { [ArenaKey]::ShowWindow($h, 9) | Out-Null }
  [ArenaKey]::ShowWindow($h, 5) | Out-Null
  [ArenaKey]::BringWindowToTop($h) | Out-Null
  [ArenaKey]::SetForegroundWindow($h) | Out-Null
}

$defaultHwnd = 0L
if ($env:ARENA_HWND) { [int64]::TryParse($env:ARENA_HWND, [ref]$defaultHwnd) | Out-Null }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    $msg = $line | ConvertFrom-Json
    $vk = [byte]$msg.vk
    $hwnd = $defaultHwnd
    if ($null -ne $msg.hwnd) { $hwnd = [int64]$msg.hwnd }
    if ($msg.focus -eq 1 -and $hwnd -gt 0) { Focus-Hwnd $hwnd }
    if ($msg.down -eq 1) {
      [ArenaKey]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    } else {
      [ArenaKey]::keybd_event($vk, 0, [ArenaKey]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    }
  } catch {
    # ignora linha inválida
  }
}
