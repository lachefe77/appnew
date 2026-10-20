# Host Bot — teclas no RetroArch (keybd_event + foco breve).
# IMPORTANTE: ler stdin com OpenStandardInput (Console.In falha com pipe do Node).
# Linha JSONL: {"vk":90,"down":1,"hwnd":12345,"ext":0}
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
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
}
"@

$defaultHwnd = 0L
if ($env:ARENA_HWND) { [int64]::TryParse($env:ARENA_HWND, [ref]$defaultHwnd) | Out-Null }
$doFocus = $true
if ($env:ARENA_INPUT_FOCUS -eq "0") { $doFocus = $false }

function Focus-Game([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
  $prev = [ArenaKey]::GetForegroundWindow()
  if ($prev -eq $h) { return $prev }
  if ([ArenaKey]::IsIconic($h)) { [ArenaKey]::ShowWindow($h, 9) | Out-Null }
  [ArenaKey]::ShowWindow($h, 5) | Out-Null
  $pid = [uint32]0
  $tidTarget = [ArenaKey]::GetWindowThreadProcessId($h, [ref]$pid)
  $tidFore = [ArenaKey]::GetWindowThreadProcessId($prev, [ref]$pid)
  $tidSelf = [ArenaKey]::GetCurrentThreadId()
  if ($tidFore -ne 0 -and $tidFore -ne $tidSelf) {
    [ArenaKey]::AttachThreadInput($tidSelf, $tidFore, $true) | Out-Null
  }
  if ($tidTarget -ne 0 -and $tidTarget -ne $tidSelf) {
    [ArenaKey]::AttachThreadInput($tidSelf, $tidTarget, $true) | Out-Null
  }
  [ArenaKey]::AllowSetForegroundWindow(-1) | Out-Null
  [ArenaKey]::BringWindowToTop($h) | Out-Null
  [ArenaKey]::SetForegroundWindow($h) | Out-Null
  return $prev
}

function Restore-Focus([IntPtr]$prev, [IntPtr]$game) {
  if ($prev -eq [IntPtr]::Zero -or $prev -eq $game) { return }
  [ArenaKey]::SetForegroundWindow($prev) | Out-Null
  $pid = [uint32]0
  $tidTarget = [ArenaKey]::GetWindowThreadProcessId($game, [ref]$pid)
  $tidFore = [ArenaKey]::GetWindowThreadProcessId($prev, [ref]$pid)
  $tidSelf = [ArenaKey]::GetCurrentThreadId()
  if ($tidTarget -ne 0 -and $tidTarget -ne $tidSelf) {
    [ArenaKey]::AttachThreadInput($tidSelf, $tidTarget, $false) | Out-Null
  }
  if ($tidFore -ne 0 -and $tidFore -ne $tidSelf) {
    [ArenaKey]::AttachThreadInput($tidSelf, $tidFore, $false) | Out-Null
  }
}

function Invoke-Key($vk, $down, $isExt, $hwnd) {
  $scan = [byte]([ArenaKey]::MapVirtualKey([uint32]$vk, 0) -band 0xFF)
  $h = [IntPtr]::Zero
  if ($hwnd -gt 0) { $h = [IntPtr]$hwnd }

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

  $prev = [IntPtr]::Zero
  if ($doFocus -and $h -ne [IntPtr]::Zero) {
    $prev = Focus-Game $h
    Start-Sleep -Milliseconds 12
  }

  $flags = 0
  if ($isExt) { $flags = $flags -bor [ArenaKey]::KEYEVENTF_EXTENDEDKEY }
  if (-not $down) { $flags = $flags -bor [ArenaKey]::KEYEVENTF_KEYUP }
  [ArenaKey]::keybd_event([byte]$vk, $scan, $flags, [UIntPtr]::Zero)

  if ($doFocus -and $h -ne [IntPtr]::Zero -and -not $down) {
    Restore-Focus $prev $h
  }
}

# Pipe do Node: OpenStandardInput (NÃO [Console]::In)
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
    $isExt = ($msg.ext -eq 1)
    $down = ($msg.down -eq 1)
    Invoke-Key $vk $down $isExt $hwnd
  } catch {
    # ignora linha inválida
  }
}
