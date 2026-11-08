# Drives the DSpatch Setup wizard as a person does, through Windows UI Automation (DSP-182), and
# records what each page offers: the folder page first (no install-mode page), a folder of the
# person's choice, the Shortcuts page with its desktop checkbox unchecked, the finish page with its
# offer to start DSpatch, which the trial declines so that DSpatch is only ever started with the
# trial's own data folder. Screenshots are of the wizard window as Windows draws it.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File wizard.ps1 -Setup <setup.exe> -InstallDir <folder> -Evidence <folder>
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$Evidence
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[Dpi]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null

$results = New-Object System.Collections.Generic.List[object]
function Note([string]$what, [bool]$ok, [string]$detail = '') {
  $results.Add([pscustomobject]@{ what = $what; ok = $ok; detail = $detail })
  Write-Output ("{0} {1}{2}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $what, $(if ($detail -eq '') { '' } else { " :: $detail" }))
  if (-not $ok) { throw "wizard: $what" }
}
function Shot($element, [string]$name) {
  $r = $element.Current.BoundingRectangle
  $bmp = New-Object System.Drawing.Bitmap ([int]$r.Width), ([int]$r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $Evidence "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$A = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
function Cond($type, $name) {
  $c = New-Object System.Windows.Automation.PropertyCondition ($A::ControlTypeProperty, $type)
  if ($null -eq $name) { return $c }
  return New-Object System.Windows.Automation.AndCondition ($c, (New-Object System.Windows.Automation.PropertyCondition ($A::NameProperty, $name)))
}
function Child($parent, $type, $name) { return $parent.FindFirst($Scope::Descendants, (Cond $type $name)) }
function Children($parent, $type) { return @($parent.FindAll($Scope::Descendants, (Cond $type $null))) }
function WaitFor([scriptblock]$read, [int]$seconds, [string]$what) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    try { $value = & $read } catch { $value = $null }
    if ($null -ne $value) { return $value }
    Start-Sleep -Milliseconds 250
  }
  throw "wizard: timeout waiting for $what"
}
function SetupWindow($pid) {
  $all = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll($Scope::Children, (New-Object System.Windows.Automation.PropertyCondition ($A::ProcessIdProperty, [int]$pid))))
  foreach ($w in $all) { if ($w.Current.Name -like 'DSpatch Setup*') { return $w } }
  return $null
}
function Press($window, [string[]]$names) {
  foreach ($n in $names) {
    $b = Child $window ([System.Windows.Automation.ControlType]::Button) $n
    if ($null -ne $b) { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return $n }
  }
  throw "wizard: no button named $($names -join ' / ')"
}
function Texts($window) { return @(Children $window ([System.Windows.Automation.ControlType]::Text) | ForEach-Object { $_.Current.Name }) }

$proc = Start-Process -FilePath $Setup -PassThru
$win = WaitFor { SetupWindow $proc.Id } 60 'the setup window'
Note 'the setup window opened' $true $win.Current.Name

# Page 1: the folder page, and no install-mode page before it.
$edit = WaitFor { Child $win ([System.Windows.Automation.ControlType]::Edit) $null } 30 'the folder field'
$radios = Children $win ([System.Windows.Automation.ControlType]::RadioButton)
Note 'no install-mode page: the first page is the folder page' ($radios.Count -eq 0 -and $null -ne $edit) ("texts: " + ((Texts $win) -join ' | ').Substring(0, [Math]::Min(300, ((Texts $win) -join ' | ').Length)))
$value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$default = $value.Current.Value
Note 'the default folder is the user''s own Programs folder' ($default -like "$env:LOCALAPPDATA\Programs\DSpatch") $default
Shot $win '10-folder-page'
$value.SetValue($InstallDir)
Start-Sleep -Milliseconds 300
Note 'the folder can be changed' ($value.Current.Value -eq $InstallDir) $value.Current.Value
Shot $win '11-folder-chosen'
$pressed = Press $win @('Next >', '&Next >', 'Next')

# Page 2: Shortcuts, the desktop checkbox unchecked.
$box = WaitFor { Child $win ([System.Windows.Automation.ControlType]::CheckBox) 'Create a desktop shortcut' } 30 'the Shortcuts page'
$state = $box.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState
Note 'the Shortcuts page offers a desktop shortcut, unchecked by default' ($state -eq [System.Windows.Automation.ToggleState]::Off) "state: $state; texts: $((Texts $win) -join ' | ')"
Shot $win '12-shortcuts-page'
$pressed = Press $win @('Install', '&Install')

# Installing, then the finish page.
$run = WaitFor { Child $win ([System.Windows.Automation.ControlType]::CheckBox) 'Run DSpatch' } 240 'the finish page'
$runState = $run.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState
Note 'the finish page offers to start DSpatch' $true "offered, state: $runState"
Shot $win '13-finish-page'
if ($runState -eq [System.Windows.Automation.ToggleState]::On) {
  $run.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()
  Start-Sleep -Milliseconds 300
}
$after = $run.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState
Note 'the start offer can be declined (declined here: the trial starts DSpatch with its own data folder)' ($after -eq [System.Windows.Automation.ToggleState]::Off) "state: $after"
Shot $win '14-finish-declined'
$pressed = Press $win @('Finish', '&Finish')
$proc.WaitForExit(60000) | Out-Null
Note 'the installer ended' ($proc.HasExited -and $proc.ExitCode -eq 0) "exit code $($proc.ExitCode)"
$results | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Evidence 'wizard.json')
