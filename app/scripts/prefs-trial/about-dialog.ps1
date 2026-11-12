# DSP-200: find the About DSpatch dialog of one process through UI Automation, report what it says,
# and press one of its buttons by name. No mouse or keyboard input: the dialog need not be in front.
#
# Electron shows the box as a Windows task dialog, whose push buttons UI Automation sees as panes
# of class CCPushButton with no Invoke pattern. A button is pressed with the task dialog's own
# TDM_CLICK_BUTTON message, by the id Electron gives a custom button: 100 plus its index
# (kIDStart in Electron's shell/browser/ui/message_box_win.cc). Whether the press took effect is
# for the caller to see, through what the button does.
param(
  [Parameter(Mandatory = $true)][int]$processId,
  [string]$press = '',
  [int]$timeoutMs = 15000
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Namespace Dsp200 -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr SendMessage(System.IntPtr hWnd, int msg, System.IntPtr wParam, System.IntPtr lParam);'
$A = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$byName = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'About DSpatch')
$byProcess = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $processId)
$end = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
$dialog = $null
while ($null -eq $dialog -and [DateTime]::UtcNow -lt $end) {
  foreach ($top in $A::RootElement.FindAll($scope::Children, $byProcess)) {
    if ($top.Current.Name -eq 'About DSpatch') { $dialog = $top; break }
    $inner = $top.FindFirst($scope::Descendants, $byName)
    if ($null -ne $inner) { $dialog = $inner; break }
  }
  if ($null -eq $dialog) { Start-Sleep -Milliseconds 250 }
}
if ($null -eq $dialog) { Write-Output '{"found":false}'; exit 0 }
$all = @($dialog.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
$texts = @($all | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $_.Current.Name -ne '' } | ForEach-Object { $_.Current.Name })
$buttons = @($all | Where-Object { $_.Current.ClassName -eq 'CCPushButton' -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button } | ForEach-Object { $_.Current.Name })
$title = $dialog.Current.Name
$pressed = $false
if ($press -ne '') {
  $index = [array]::IndexOf($buttons, $press)
  $handle = $dialog.Current.NativeWindowHandle
  if ($index -ge 0 -and $handle -ne 0) {
    $TDM_CLICK_BUTTON = 0x0400 + 102
    [void][Dsp200.Native]::SendMessage([IntPtr]$handle, $TDM_CLICK_BUTTON, [IntPtr](100 + $index), [IntPtr]::Zero)
    $pressed = $true
  }
}
[pscustomobject]@{ found = $true; title = $title; texts = $texts; buttons = $buttons; pressed = $pressed } | ConvertTo-Json -Compress
