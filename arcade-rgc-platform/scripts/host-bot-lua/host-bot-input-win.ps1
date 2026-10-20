# Host Bot — teclas no RetroArch via PostMessage/SendMessage no HWND.
# NÃO usa SetForegroundWindow (roubar foco com gdigrab ativo mata o RetroArch).
# Linha JSONL: {"vk":90,"down":1,"hwnd":12345,"ext":0}
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaKey {
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint WM_CHAR = 0x0102;
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
}
"@

$defaultHwnd = 0L
if ($env:ARENA_HWND) { [int64]::TryParse($env:ARENA_HWND, [ref]$defaultHwnd) | Out-Null }

$utf8 = New-Object System.Text.UTF8Encoding $false
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
while ($true) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    $msg = $line | ConvertFrom-Json
    $vk = [uint32]$msg.vk
    $hwnd = $defaultHwnd
    if ($null -ne $msg.hwnd) { $hwnd = [int64]$msg.hwnd }
    if ($hwnd -le 0) { continue }
    $h = [IntPtr]$hwnd
    $scan = [ArenaKey]::MapVirtualKey($vk, 0)
    $isExt = ($msg.ext -eq 1)
    $down = ($msg.down -eq 1)
    $lp = [int64](1 -bor ([int64]$scan -shl 16))
    if ($isExt) { $lp = $lp -bor (1 -shl 24) }
    if ($down) {
      [ArenaKey]::PostMessage($h, [ArenaKey]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
      [ArenaKey]::SendMessage($h, [ArenaKey]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
    } else {
      $lpUp = $lp -bor (1 -shl 30) -bor (1 -shl 31)
      [ArenaKey]::PostMessage($h, [ArenaKey]::WM_KEYUP, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
      [ArenaKey]::SendMessage($h, [ArenaKey]::WM_KEYUP, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
    }
  } catch {
    # ignora
  }
}
