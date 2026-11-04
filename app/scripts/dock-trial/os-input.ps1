# Input through Windows' own queue (SendInput), as a mouse and a keyboard deliver it: a click at
# a point of the screen, a wheel notch there with Control held, text typed as Unicode, or a key
# with Control. Coordinates are physical pixels. Used by the dock trial (DSP-172).
param(
  [string]$mode,
  [int]$x = 0,
  [int]$y = 0,
  [int]$delta = 120,
  [int]$count = 1,
  [switch]$control,
  [string]$text = '',
  [string]$key = ''
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OsInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static INPUT Mouse(uint flags, uint data) { INPUT i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i; }
  public static INPUT Key(ushort vk, uint flags) { INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.dwFlags = flags; return i; }
  public static INPUT Unicode(ushort scan, uint flags) { INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = 0; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags | 0x0004; return i; }
  public static uint Send(INPUT i) { return SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
}
"@
[OsInput]::SetProcessDPIAware() | Out-Null
$sent = 0
switch ($mode) {
  'click' {
    [OsInput]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 120
    $sent += [OsInput]::Send([OsInput]::Mouse(0x0002, 0))
    Start-Sleep -Milliseconds 60
    $sent += [OsInput]::Send([OsInput]::Mouse(0x0004, 0))
  }
  'wheel' {
    [OsInput]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 120
    $data = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$delta), 0)
    if ($control) { [OsInput]::Send([OsInput]::Key(0x11, 0)) | Out-Null; Start-Sleep -Milliseconds 60 }
    for ($i = 0; $i -lt $count; $i++) { $sent += [OsInput]::Send([OsInput]::Mouse(0x0800, $data)); Start-Sleep -Milliseconds 70 }
    if ($control) { Start-Sleep -Milliseconds 60; [OsInput]::Send([OsInput]::Key(0x11, 0x0002)) | Out-Null }
  }
  'type' {
    foreach ($ch in $text.ToCharArray()) {
      $code = [int][char]$ch
      $sent += [OsInput]::Send([OsInput]::Unicode($code, 0))
      $sent += [OsInput]::Send([OsInput]::Unicode($code, 0x0002))
      Start-Sleep -Milliseconds 25
    }
  }
  'key' {
    $names = @{ 'minus' = 0xBD; 'equal' = 0xBB; 'plus' = 0xBB; '0' = 0x30; 'Return' = 0x0D; 'Escape' = 0x1B; 'Tab' = 0x09; 'End' = 0x23 }
    $parts = $key.Split('+')
    $withControl = $parts -contains 'ctrl'
    $name = $parts[$parts.Length - 1]
    $vk = $names[$name]
    if ($null -eq $vk) { throw "unknown key $name" }
    if ($withControl) { [OsInput]::Send([OsInput]::Key(0x11, 0)) | Out-Null; Start-Sleep -Milliseconds 40 }
    $sent += [OsInput]::Send([OsInput]::Key([uint16]$vk, 0))
    Start-Sleep -Milliseconds 40
    $sent += [OsInput]::Send([OsInput]::Key([uint16]$vk, 0x0002))
    if ($withControl) { Start-Sleep -Milliseconds 40; [OsInput]::Send([OsInput]::Key(0x11, 0x0002)) | Out-Null }
  }
  default { throw "unknown mode $mode" }
}
Start-Sleep -Milliseconds 120
"mode=$mode sent=$sent"
