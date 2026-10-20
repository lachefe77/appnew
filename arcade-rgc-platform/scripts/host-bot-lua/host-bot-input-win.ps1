# Host Bot — injeta teclas no HWND do RetroArch via PostMessage (sem roubar foco do browser).
# Linha JSONL: {"vk":90,"down":1,"hwnd":12345,"ext":0}
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaKey {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
}
"@

$defaultHwnd = 0L
if ($env:ARENA_HWND) { [int64]::TryParse($env:ARENA_HWND, [ref]$defaultHwnd) | Out-Null }

# VK que precisam flag extended (numpad / arrows em alguns layouts)
$extended = @(0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28,0x2d,0x2e,0x5b,0x5c)

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    $msg = $line | ConvertFrom-Json
    $vk = [uint32]$msg.vk
    $hwnd = $defaultHwnd
    if ($null -ne $msg.hwnd) { $hwnd = [int64]$msg.hwnd }
    $scan = [ArenaKey]::MapVirtualKey($vk, 0)
    $isExt = ($extended -contains [int]$vk) -or ($msg.ext -eq 1)
    $lp = [int64](1 -bor ([int64]$scan -shl 16))
    if ($isExt) { $lp = $lp -bor (1 -shl 24) }

    if ($hwnd -gt 0) {
      $h = [IntPtr]$hwnd
      if ($msg.down -eq 1) {
        [ArenaKey]::PostMessage($h, [ArenaKey]::WM_KEYDOWN, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
      } else {
        $lpUp = $lp -bor (1 -shl 30) -bor (1 -shl 31)
        [ArenaKey]::PostMessage($h, [ArenaKey]::WM_KEYUP, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
      }
    } else {
      # Fallback global (só se não houver HWND)
      $flags = 0
      if ($isExt) { $flags = $flags -bor [ArenaKey]::KEYEVENTF_EXTENDEDKEY }
      if ($msg.down -eq 1) {
        [ArenaKey]::keybd_event([byte]$vk, [byte]$scan, $flags, [UIntPtr]::Zero)
      } else {
        [ArenaKey]::keybd_event([byte]$vk, [byte]$scan, ($flags -bor [ArenaKey]::KEYEVENTF_KEYUP), [UIntPtr]::Zero)
      }
    }
  } catch {
    # ignora linha inválida
  }
}
