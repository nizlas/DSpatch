# Start the mission's stable engine (DSP-208) with the environment a Windows login gives,
# and nothing inherited from whatever started this script.
#
# Why: started from a Claude Code session, DSpatch inherited that session's variables
# (CLAUDE_CODE_OAUTH_SCOPES, ANTHROPIC_BASE_URL, CLAUDE_CODE_*, USE_STAGING_OAUTH,
# GIT_ASKPASS, CHROME_CRASHPAD_PIPE_NAME, ...). DSpatch's Claude adapter rightly refuses
# Claude Code OAuth variables and endpoint overrides, so Claude could not be opened.
# The environment here is built from the machine's and the user's own variables and the
# login session's volatile ones, plus the few defaults Windows itself sets for every
# process. No variable is changed anywhere else, and no value is printed.
#
# Usage, from any PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File docs\missions\adaptive-execution\start-engine.ps1
# Optional: -Engine <path to the engine checkout's app folder>.

param(
  [string]$Engine = 'C:\Users\nicla\development\DSpatch-engine\app',
  # Print the names (never the values) DSpatch would be started with, and start nothing.
  [switch]$ListNames
)

$ErrorActionPreference = 'Stop'

$electron = Join-Path $Engine 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "No Electron at $electron. Build the engine checkout first." }
if (-not (Test-Path (Join-Path $Engine 'dist\main\main.js'))) { throw "No build in $Engine\dist. Run npm run build there first." }

$envBlock = [ordered]@{}
foreach ($scope in 'Machine', 'User') {
  $vars = [Environment]::GetEnvironmentVariables($scope)
  foreach ($name in $vars.Keys) {
    $value = [Environment]::ExpandEnvironmentVariables([string]$vars[$name])
    if ($name -ieq 'Path' -and $envBlock.Contains('Path')) {
      $envBlock['Path'] = $envBlock['Path'].TrimEnd(';') + ';' + $value
    } else {
      $envBlock[$name] = $value
    }
  }
}
$volatile = Get-Item 'HKCU:\Volatile Environment'
foreach ($name in $volatile.Property) { $envBlock[$name] = [string]$volatile.GetValue($name) }

# What Windows sets for every process and the registry does not hold.
$defaults = 'SystemRoot', 'windir', 'SystemDrive', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
  'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'ProgramData', 'ALLUSERSPROFILE',
  'PUBLIC', 'COMPUTERNAME', 'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'USERDOMAIN_ROAMINGPROFILE',
  'LOGONSERVER', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'SESSIONNAME'
foreach ($name in $defaults) {
  $value = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ($null -ne $value -and -not $envBlock.Contains($name)) { $envBlock[$name] = $value }
}

# Refuse to start if a guarded name still came from the user's or machine's own settings:
# that is a decision for the person, not something to strip silently.
$guarded = @($envBlock.Keys | Where-Object { $_ -match '^(CLAUDE_CODE_OAUTH_|ANTHROPIC_|CLAUDE_CODE_USE_|AWS_BEARER_TOKEN_BEDROCK|CLAUDE_CODE_CLIENT_)' })
if ($guarded.Count -gt 0) { throw "Set in Windows' own environment, so not removed here: $($guarded -join ', ')" }

if ($ListNames) { ($envBlock.Keys | Sort-Object) -join ', '; return }

# Electron's console output goes to a file, through cmd, so that the window does not depend on
# the console or pipe of whatever started this script: a closed pipe would make a later write fail.
$console = Join-Path $env:LOCALAPPDATA 'DSpatch-engine-console.log'
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
$info.Arguments = "/d /c `"`"$electron`" . >> `"$console`" 2>&1`""
$info.WorkingDirectory = $Engine
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.EnvironmentVariables.Clear()
foreach ($name in $envBlock.Keys) { $info.EnvironmentVariables[$name] = $envBlock[$name] }
$process = [System.Diagnostics.Process]::Start($info)
"Started DSpatch from $Engine (pid $($process.Id), console log $console) with $($envBlock.Count) variables from the Windows login environment."
