# Drives the DSpatch Setup wizard as a person does, through Windows UI Automation (DSP-182), and
# records what each page offers: the folder page first (no install-mode page), a folder of the
# person's choice, the Shortcuts page with its desktop checkbox unchecked, the finish page with its
# offer to start DSpatch, which the trial declines so that DSpatch is only ever started with the
# trial's own data folder. Screenshots are of the wizard window as Windows draws it.
#
# UI Automation reads the pages and presses the buttons. With -Keyboard, a press that Invoke does
# not deliver within 4 s is repeated with Enter on the focused button, the wizard brought to the
# front; without it nothing is typed, so a desktop in use is left alone, and such a press is a
# finding. A file the installer cannot write (seen with Bitdefender: the uninstaller) brings up
# NSIS's Abort/Retry/Ignore dialog; it is recorded as a finding and answered with Ignore, as the
# installer offers. The finish page's offer is never left checked when Finish is pressed. Every
# step is written to wizard.json, also when the run ends early.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File wizard.ps1 -Setup <setup.exe> -InstallDir <folder> -Evidence <folder> [-Keyboard]
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$Evidence,
  [switch]$Keyboard
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[Dpi]::SetProcessDPIAware() | Out-Null
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null

$results = New-Object System.Collections.Generic.List[object]
function Say([string]$line) { [Console]::Out.WriteLine($line) }
function Note([string]$what, [bool]$ok, [string]$detail = '') {
  $results.Add([pscustomobject]@{ what = $what; ok = $ok; detail = $detail })
  Say ("{0} {1}{2}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $what, $(if ($detail -eq '') { '' } else { " :: $detail" }))
  if (-not $ok) { throw "wizard: $what" }
}
# A finding: recorded as not ok, and the run goes on.
function Finding([string]$what, [string]$detail = '') {
  $results.Add([pscustomobject]@{ what = $what; ok = $false; detail = $detail })
  Say ("FAIL {0}{1}" -f $what, $(if ($detail -eq '') { '' } else { " :: $detail" }))
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
$Off = [System.Windows.Automation.ToggleState]::Off
$ButtonType = [System.Windows.Automation.ControlType]::Button
$CheckBoxType = [System.Windows.Automation.ControlType]::CheckBox
function Cond($type, $name) {
  $c = New-Object System.Windows.Automation.PropertyCondition ($A::ControlTypeProperty, $type)
  if ($null -eq $name) { return $c }
  return New-Object System.Windows.Automation.AndCondition ($c, (New-Object System.Windows.Automation.PropertyCondition ($A::NameProperty, $name)))
}
function Child($parent, $type, $name) { return $parent.FindFirst($Scope::Descendants, (Cond $type $name)) }
function Children($parent, $type) { return @($parent.FindAll($Scope::Descendants, (Cond $type $null))) }
function ChildLike($parent, $type, [string]$pattern) { foreach ($e in (Children $parent $type)) { if ($e.Current.Name -like $pattern) { return $e } }; return $null }
function Texts($window) { return @(Children $window ([System.Windows.Automation.ControlType]::Text) | ForEach-Object { $_.Current.Name }) }
function WaitFor([scriptblock]$read, [int]$seconds, [string]$what) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    try { $value = & $read } catch { $value = $null }
    if ($null -ne $value) { return $value }
    Start-Sleep -Milliseconds 250
  }
  throw "wizard: timeout waiting for $what"
}
# The parameter is not named $pid: that is PowerShell's own process id, and a parameter of that name reads as it.
function SetupWindow($setupPid) {
  $all = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll($Scope::Children, (New-Object System.Windows.Automation.PropertyCondition ($A::ProcessIdProperty, [int]$setupPid))))
  foreach ($w in $all) { if ($w.Current.Name -like 'DSpatch Setup*') { return $w } }
  return $null
}
$shell = New-Object -ComObject WScript.Shell
function Front() { [void]$shell.AppActivate([int]$proc.Id); Start-Sleep -Milliseconds 300 }
function Invoke-Button($b) { try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return $true } catch { return $false } }
# NSIS asks Abort/Retry/Ignore when it cannot write a file. Answered with Ignore, as the installer offers, and recorded.
function AnswerFileDialog($window) {
  $ignore = Child $window $ButtonType 'Ignore'
  if ($null -eq $ignore) { return $false }
  $text = ((Texts $window) | Where-Object { $_ -match 'Error|error|Abort' }) -join ' '
  Shot $window ('15-file-dialog-' + $script:fileDialogs)
  $script:fileDialogs += 1
  Finding 'the installer could not write a file and asked Abort / Retry / Ignore; answered with Ignore' ($text -replace '\s+', ' ')
  [void](Invoke-Button $ignore)
  Start-Sleep -Milliseconds 500
  return $true
}
$script:fileDialogs = 1
# Presses a button and waits for what the next page shows, answering a file dialog on the way.
function PressAndWait($window, [string[]]$names, [scriptblock]$arrived, [int]$seconds, [string]$what) {
  $b = $null
  foreach ($n in $names) { $b = Child $window $ButtonType $n; if ($null -ne $b) { break } }
  if ($null -eq $b) { throw "wizard: no button named $($names -join ' / ')" }
  $label = $b.Current.Name
  [void](Invoke-Button $b)
  $end = (Get-Date).AddSeconds(4)
  $moved = $false
  while ((Get-Date) -lt $end) {
    try { $value = & $arrived } catch { $value = $null }
    if ($null -ne $value) { return $value }
    if (AnswerFileDialog $window) { $moved = $true; break }
    if ((Child $window $ButtonType $label) -eq $null) { $moved = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $moved) {
    if ($Keyboard) {
      Note "'$label' did not answer UI Automation's Invoke within 4 s; pressed with the keyboard instead, the wizard in front" $true
      Front
      try { $b.SetFocus() } catch { }
      Start-Sleep -Milliseconds 200
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    } else {
      Finding "'$label' did not answer UI Automation's Invoke within 4 s; nothing typed (no -Keyboard)"
    }
  }
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    try { $value = & $arrived } catch { $value = $null }
    if ($null -ne $value) { return $value }
    [void](AnswerFileDialog $window)
    Start-Sleep -Milliseconds 400
  }
  throw "wizard: timeout waiting for $what"
}
function ToggleState($box) { return $box.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState }
function UncheckBox($box, [string]$label) {
  if ((ToggleState $box) -eq $Off) { return }
  try { $box.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() } catch { }
  Start-Sleep -Milliseconds 400
  if ((ToggleState $box) -ne $Off -and $Keyboard) {
    Note "'$label' did not answer UI Automation's Toggle; unchecked with the keyboard instead, the wizard in front" $true
    Front
    try { $box.SetFocus() } catch { }
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait(' ')
    Start-Sleep -Milliseconds 400
  }
}

$proc = $null
try {
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
  $box = PressAndWait $win @('Next >', '&Next >', 'Next') { Child $win $CheckBoxType 'Create a desktop shortcut' } 30 'the Shortcuts page'

  # Page 2: Shortcuts, the desktop checkbox unchecked.
  $state = ToggleState $box
  Note 'the Shortcuts page offers a desktop shortcut, unchecked by default' ($state -eq $Off) "state: $state; texts: $((Texts $win) -join ' | ')"
  Shot $win '12-shortcuts-page'
  $run = PressAndWait $win @('Install', '&Install') { ChildLike $win $CheckBoxType 'Run*' } 420 'the finish page'

  # Installing, then the finish page.
  $runState = ToggleState $run
  Note 'the finish page offers to start DSpatch' $true "'$($run.Current.Name)', state: $runState"
  Shot $win '13-finish-page'
  UncheckBox $run $run.Current.Name
  $after = ToggleState $run
  Shot $win '14-finish-declined'
  if ($after -ne $Off) {
    # Never Finish with the offer checked: that would start DSpatch with the person's own data folder.
    Stop-Process -Id $proc.Id -Force
    Note 'the start offer can be declined (declined here: the trial starts DSpatch with its own data folder)' $false "state stayed $after; the wizard was ended without Finish"
  }
  Note 'the start offer can be declined (declined here: the trial starts DSpatch with its own data folder)' $true "state: $after"
  PressAndWait $win @('Finish', '&Finish') { if ($proc.HasExited) { $true } else { $null } } 60 'the installer to end' | Out-Null
  Note 'the installer ended' ($proc.HasExited -and $proc.ExitCode -eq 0) "exit code $($proc.ExitCode)"
} finally {
  if ($null -ne $proc -and -not $proc.HasExited) {
    # A wizard left standing would wait for a click, or start DSpatch with the person's own data folder: ended here.
    try { Stop-Process -Id $proc.Id -Force } catch { }
    $results.Add([pscustomobject]@{ what = 'the setup process was ended by the driver, the run having stopped before Finish'; ok = $false; detail = "pid $($proc.Id)" })
  }
  $results | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Evidence 'wizard.json')
}
