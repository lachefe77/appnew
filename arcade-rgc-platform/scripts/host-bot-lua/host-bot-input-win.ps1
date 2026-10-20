# Host Bot — teclas SÓ no HWND do RetroArch (PostMessage/SendMessage).
# NUNCA keybd_event: isso manda F1/F2/etc. para o browser em foco (abre Help/abas).
# Linha JSONL: {"vk":90,"down":1,"hwnd":12345,"ext":0}
# Batch: {"batch":[{"vk":112,"holdMs":200}],"hwnd":123}
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaKey {
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint WM_SYSKEYDOWN = 0x0104;
  public const uint WM_SYSKEYUP = 0x0105;
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
}
"@

$defaultHwnd = 0L
if ($env:ARENA_HWND) { [int64]::TryParse($env:ARENA_HWND, [ref]$defaultHwnd) | Out-Null }

function Send-ToHwnd([uint32]$vk, [bool]$down, [bool]$isExt, [IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return }
  $scan = [ArenaKey]::MapVirtualKey($vk, 0)
  $lp = [int64](1 -bor ([int64]$scan -shl 16))
  if ($isExt) { $lp = $lp -bor (1 -shl 24) }
  # F10 etc. usam SYSKEY*; restantes KEY*
  $isSys = ($vk -eq 0x12) -or ($vk -eq 0x79) # Alt / F10
  if ($down) {
    $msg = if ($isSys) { [ArenaKey]::WM_SYSKEYDOWN } else { [ArenaKey]::WM_KEYDOWN }
    [ArenaKey]::PostMessage($h, $msg, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
    [ArenaKey]::SendMessage($h, $msg, [IntPtr]$vk, [IntPtr]$lp) | Out-Null
  } else {
    $lpUp = $lp -bor (1 -shl 30) -bor (1 -shl 31)
    $msg = if ($isSys) { [ArenaKey]::WM_SYSKEYUP } else { [ArenaKey]::WM_KEYUP }
    [ArenaKey]::PostMessage($h, $msg, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
    [ArenaKey]::SendMessage($h, $msg, [IntPtr]$vk, [IntPtr]$lpUp) | Out-Null
  }
}

function Pulse-Hwnd([uint32]$vk, [int]$holdMs, [bool]$isExt, [IntPtr]$h) {
  Send-ToHwnd $vk $true $isExt $h
  Start-Sleep -Milliseconds ([Math]::Max(40, $holdMs))
  Send-ToHwnd $vk $false $isExt $h
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
      foreach ($item in $msg.batch) {
        $vk = [uint32]$item.vk
        $hold = 200
        if ($null -ne $item.holdMs) { $hold = [int]$item.holdMs }
        $ext = ($item.ext -eq 1)
        Pulse-Hwnd $vk $hold $ext $h
        Start-Sleep -Milliseconds 150
      }
      continue
    }

    $vk = [uint32]$msg.vk
    $isExt = ($msg.ext -eq 1)
    $down = ($msg.down -eq 1)
    Send-ToHwnd $vk $down $isExt $h
  } catch {
    # ignora
  }
}
