# Host Bot Fase 4b — injeta teclas via keybd_event (JSONL stdin).
# Linha: {"vk":90,"down":1}  /  {"vk":90,"down":0}
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArenaKey {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try {
    $msg = $line | ConvertFrom-Json
    $vk = [byte]$msg.vk
    if ($msg.down -eq 1) {
      [ArenaKey]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    } else {
      [ArenaKey]::keybd_event($vk, 0, [ArenaKey]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    }
  } catch {
    # ignora linha inválida
  }
}
