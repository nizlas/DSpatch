# The top-level window under a point of the screen (physical pixels), as Windows would deliver
# a click there: its handle in decimal, so a screenshot of that spot can be tied to the window
# it shows. Used by the dock trial (DSP-172).
param([int]$x, [int]$y)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowAt {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[WindowAt]::SetProcessDPIAware() | Out-Null
$p = New-Object WindowAt+POINT
$p.X = $x
$p.Y = $y
$h = [WindowAt]::WindowFromPoint($p)
$root = [WindowAt]::GetAncestor($h, 2)
if ($root -eq [IntPtr]::Zero) { $root = $h }
"$($root.ToInt64())"
