# task-board memo popup: send an OS-level key gesture to toggle the external app
# Aqua Voice. Aqua Voice is toggle-based (double-tap Left Alt starts dictation,
# double-tap again stops it), so both "voice" (start) and "stop" send the same
# gesture: a double-tap of Left Alt (VK 0xA4, scan 0x38).
# Browser JS cannot send OS keys, so the local Node server spawns this script.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("voice", "stop")]
  [string]$Action
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TbKey {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$KEYDOWN = 0x0
$KEYUP = 0x2

# Passing the hardware scan code (not just the virtual key) helps low-level
# keyboard hooks such as Aqua Voice's recognise the synthetic key press.
function Tap([byte]$vk, [byte]$scan) {
  [TbKey]::keybd_event($vk, $scan, $KEYDOWN, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [TbKey]::keybd_event($vk, $scan, $KEYUP, [UIntPtr]::Zero)
}

# Both start and stop toggle Aqua Voice with the same double-tap of Left Alt.
$LMENU = 0xA4
$SCAN = 0x38
Tap $LMENU $SCAN
Start-Sleep -Milliseconds 120
Tap $LMENU $SCAN
