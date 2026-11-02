/*
 * What a client runs on a machine over SSH to find, install and start a host (DSP-153). Text only,
 * so it can be read and tested without a connection. Each piece prints `key=value` lines. Nothing
 * here holds a secret: the token is read back by `credentials`, on the SSH channel, into memory.
 *
 * Installed files live under `<data home>/dspatch/host/versions/<host id>/`, one folder per build,
 * and are never written in place: a version is unpacked beside the others and renamed when it is
 * whole. Conversations, reviews and the token are in the application's own folder, the one DSpatch
 * uses when it is opened on that machine, so the machine's work is the same however it is reached
 * (DSP-161), and an update or a removal of versions leaves them alone. `older` is where a host kept
 * its data until then: only ever looked at for a host still running there, and adopted by the host.
 */

export type RemoteOs = 'posix' | 'windows';

/** A remote step: the command line, and the script on stdin when there is no other use for it. */
export interface RemoteStep {
  readonly command: string;
  readonly stdin?: string;
}

function posix(script: string): RemoteStep {
  return { command: 'sh -s', stdin: `${POSIX_PATHS}${script}` };
}

/** One argument for `sh`. */
export function shQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** Run a script given to PowerShell in the command itself: no quoting survives cmd.exe otherwise. */
function windows(script: string): RemoteStep {
  const text = `$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';${WINDOWS_PATHS}${script}`;
  // PowerShell wants UTF-16LE; every character in these scripts fits one unit.
  const encoded = btoa([...text].map((character) => `${character}\0`).join(''));
  return { command: `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}` };
}

const POSIX_PATHS = `
base="\${XDG_DATA_HOME:-$HOME/.local/share}"
root="$base/dspatch/host"
data="\${XDG_CONFIG_HOME:-$HOME/.config}/DSpatch"
older="$base/dspatch-host"
`;

const WINDOWS_PATHS = `
$root = Join-Path $env:LOCALAPPDATA 'DSpatch\\host'
$data = Join-Path $env:APPDATA 'DSpatch'
$older = Join-Path $env:LOCALAPPDATA 'dspatch-host'
`;

/** What machine this is. The one step that has to work before the shell is known. */
export const IDENTIFY: RemoteStep = { command: 'uname -sm' };
export const IDENTIFY_WINDOWS: RemoteStep = windows(`Write-Output "Windows $env:PROCESSOR_ARCHITECTURE"`);

export function probe(os: RemoteOs): RemoteStep {
  if (os === 'windows') {
    return windows(`
if (Test-Path "$root\\versions") { Get-ChildItem "$root\\versions" -Directory | ForEach-Object { $manifest = "$($_.FullName)\\dspatch-host\\manifest.json"; if (Test-Path $manifest) { Write-Output "version=$($_.Name)"; Write-Output ("installed=" + ((Get-Content $manifest -Raw) -replace '\\s+',' ')) } } }
foreach ($folder in @($data, $older)) {
  $record = "$folder\\host-running.json"
  if (Test-Path $record) { $r = Get-Content $record -Raw | ConvertFrom-Json; if (Get-Process -Id $r.pid -ErrorAction SilentlyContinue) { Write-Output ("running=" + ((Get-Content $record -Raw) -replace '\\s+',' ')); break } }
}
$claim = "$data\\host-claim.json"
if (Test-Path $claim) { $c = Get-Content $claim -Raw | ConvertFrom-Json; if ($c.kind -eq 'desktop' -and (Get-Process -Id $c.pid -ErrorAction SilentlyContinue)) { Write-Output 'desktop=open' } }
$other = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*remote-host.js*' } | ForEach-Object { $_.ProcessId }) -join ' '
Write-Output "hostpids=$other"
`);
  }
  return posix(`
if [ -d "$root/versions" ]; then
  for found in "$root"/versions/*/; do
    if [ -f "$found/dspatch-host/manifest.json" ]; then
      echo "version=$(basename "$found")"
      echo "installed=$(tr -d '\\n' < "$found/dspatch-host/manifest.json")"
    fi
  done
fi
for folder in "$data" "$older"; do
  record="$folder/host-running.json"
  if [ -f "$record" ]; then
    pid=$(sed -n 's/.*"pid": *\\([0-9]*\\).*/\\1/p' "$record")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "running=$(tr -d '\\n' < "$record")"; break; fi
  fi
done
claim="$data/host-claim.json"
if [ -f "$claim" ] && grep -q '"desktop"' "$claim"; then
  pid=$(sed -n 's/.*"pid": *\\([0-9]*\\).*/\\1/p' "$claim")
  if [ -n "$pid" ] && tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -qi dspatch; then echo desktop=open; fi
fi
echo "hostpids=$(pgrep -u "$(id -u)" -f 'dist/host/remote-host.js' 2>/dev/null | tr '\\n' ' ')"
for tool in tar sha256sum; do command -v "$tool" >/dev/null 2>&1 || echo "missing=$tool"; done
`);
}

/** Receive the package on stdin, under a name no version folder uses. */
export function receive(os: RemoteOs, file: string): RemoteStep {
  if (os === 'windows') {
    return windows(`
New-Item -ItemType Directory -Force "$root\\incoming" | Out-Null
$in = [Console]::OpenStandardInput(); $out = [IO.File]::Create("$root\\incoming\\${file}.part"); $in.CopyTo($out); $out.Close()
`);
  }
  return {
    command: `sh -c ${shQuote(`${POSIX_PATHS}mkdir -p "$root/incoming" && exec cat > "$root/incoming/${file}.part"`)}`,
  };
}

/**
 * Check what arrived, unpack it beside the versions and rename it into place. Whatever stops this
 * leaves the versions as they were, and the next attempt clears the leftovers first.
 */
export function install(os: RemoteOs, file: string, sha256: string, hostId: string): RemoteStep {
  if (os === 'windows') {
    return windows(`
$part = "$root\\incoming\\${file}.part"
if ((Get-FileHash $part -Algorithm SHA256).Hash.ToLower() -ne '${sha256}') { Remove-Item $part; Write-Output 'failed=checksum'; exit 0 }
New-Item -ItemType Directory -Force "$root\\versions" | Out-Null
Get-ChildItem "$root\\versions" -Directory -Filter '.tmp-*' | Remove-Item -Recurse -Force
$tmp = "$root\\versions\\.tmp-${hostId}"
New-Item -ItemType Directory -Force $tmp | Out-Null
tar -xzf $part -C $tmp
if ($LASTEXITCODE -ne 0) { Remove-Item -Recurse -Force $tmp; Write-Output 'failed=unpack'; exit 0 }
& "$tmp\\dspatch-host\\node\\node.exe" --version | Out-Null
if ($LASTEXITCODE -ne 0) { Remove-Item -Recurse -Force $tmp; Write-Output 'failed=runtime'; exit 0 }
Rename-Item $tmp '${hostId}'
Remove-Item $part
Write-Output 'installed=yes'
`);
  }
  return posix(`
part="$root/incoming/${file}.part"
actual=$(sha256sum "$part" | cut -d' ' -f1)
if [ "$actual" != "${sha256}" ]; then rm -f "$part"; echo failed=checksum; exit 0; fi
mkdir -p "$root/versions"
rm -rf "$root"/versions/.tmp-*
tmp="$root/versions/.tmp-${hostId}"
mkdir -p "$tmp"
if ! tar -xzf "$part" -C "$tmp"; then rm -rf "$tmp"; echo failed=unpack; exit 0; fi
if ! "$tmp/dspatch-host/node/bin/node" --version >/dev/null 2>&1; then rm -rf "$tmp"; echo failed=runtime; exit 0; fi
mv "$tmp" "$root/versions/${hostId}"
rm -f "$part"
echo installed=yes
`);
}

/** Start the version and wait for it to say where it listens. It outlives this connection. */
export function start(os: RemoteOs, hostId: string): RemoteStep {
  if (os === 'windows') {
    return windows(`
New-Item -ItemType Directory -Force $data | Out-Null
$exe = "$root\\versions\\${hostId}\\dspatch-host\\dspatch-host.cmd"
if (Test-Path "$data\\host-running.json") { $r = Get-Content "$data\\host-running.json" -Raw | ConvertFrom-Json; if (-not (Get-Process -Id $r.pid -ErrorAction SilentlyContinue)) { Remove-Item "$data\\host-running.json" } }
$before = (Get-Date).ToUniversalTime()
$line = "cmd /c \`"\`"$exe\`" --port 0 --data \`"$data\`" --older-data \`"$older\`" >> \`"$data\\host.log\`" 2>&1\`""
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line } | Out-Null
for ($i = 0; $i -lt 360; $i++) { if ((Test-Path "$data\\host-running.json") -and (Get-Item "$data\\host-running.json").LastWriteTimeUtc -ge $before) { Write-Output 'started=yes'; exit 0 }; Start-Sleep -Milliseconds 500 }
Write-Output 'failed=start'
`);
  }
  return posix(`
mkdir -p "$data"
if [ -f "$data/host-running.json" ]; then
  pid=$(sed -n 's/.*"pid": *\\([0-9]*\\).*/\\1/p' "$data/host-running.json")
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then rm -f "$data/host-running.json"; fi
fi
launcher="$root/versions/${hostId}/dspatch-host/dspatch-host"
runner=nohup
command -v setsid >/dev/null 2>&1 && runner="nohup setsid"
$runner "$launcher" --port 0 --data "$data" --older-data "$older" >>"$data/host.log" 2>&1 </dev/null &
child=$!
i=0
while [ $i -lt 360 ]; do
  [ -f "$data/host-running.json" ] && { echo started=yes; exit 0; }
  kill -0 "$child" 2>/dev/null || [ $i -lt 2 ] || break
  sleep 0.5
  i=$((i + 1))
done
echo failed=start
tail -n 5 "$data/host.log" | sed 's/^/log=/'
`);
}

/** Ask a running host to close and wait for it: in order on POSIX; Windows ends the process. */
export function stop(os: RemoteOs, pid: number): RemoteStep {
  if (os === 'windows') {
    return windows(`
Stop-Process -Id ${String(pid)} -ErrorAction SilentlyContinue
for ($i = 0; $i -lt 40; $i++) { if (-not (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue)) { Write-Output 'stopped=yes'; exit 0 }; Start-Sleep -Milliseconds 500 }
Write-Output 'failed=stop'
`);
  }
  return posix(`
kill -TERM ${String(pid)} 2>/dev/null
i=0
while [ $i -lt 40 ]; do
  case "$(ps -o stat= -p ${String(pid)} 2>/dev/null)" in ''|Z*) echo stopped=yes; exit 0 ;; esac
  sleep 0.5
  i=$((i + 1))
done
echo failed=stop
`);
}

/**
 * Ask the application open on the machine to hand over, and wait for its answer. It answers
 * `released` once its host has closed, or `busy` with what is running, which it leaves alone.
 */
export function handover(os: RemoteOs, nonce: string): RemoteStep {
  if (os === 'windows') {
    return windows(`
$answer = "$data\\handover-answer.json"
Remove-Item $answer -ErrorAction SilentlyContinue
Set-Content "$data\\handover-request.json" '{"nonce":"${nonce}"}'
for ($i = 0; $i -lt 50; $i++) { if (Test-Path $answer) { Write-Output ("answer=" + ((Get-Content $answer -Raw) -replace '\\s+',' ')); Remove-Item $answer; exit 0 }; Start-Sleep -Milliseconds 500 }
Remove-Item "$data\\handover-request.json" -ErrorAction SilentlyContinue
Write-Output 'answer='
`);
  }
  return posix(`
answer="$data/handover-answer.json"
rm -f "$answer"
printf '{"nonce":"${nonce}"}\\n' > "$data/handover-request.json"
i=0
while [ $i -lt 50 ]; do
  if [ -f "$answer" ]; then echo "answer=$(tr -d '\\n' < "$answer")"; rm -f "$answer"; exit 0; fi
  sleep 0.5
  i=$((i + 1))
done
rm -f "$data/handover-request.json"
echo answer=
`);
}

/** Where the host listens and its token, for this connection's memory only. */
export function credentials(os: RemoteOs): RemoteStep {
  if (os === 'windows') {
    return windows(`
$folder = if (Test-Path "$data\\host-running.json") { $data } else { $older }
Write-Output ("running=" + ((Get-Content "$folder\\host-running.json" -Raw) -replace '\\s+',' '))
Write-Output ("token=" + (Get-Content "$folder\\remote-token" -Raw).Trim())
`);
  }
  return posix(`
folder="$data"
[ -f "$folder/host-running.json" ] || folder="$older"
echo "running=$(tr -d '\\n' < "$folder/host-running.json")"
echo "token=$(cat "$folder/remote-token")"
`);
}

/** `key=value` lines to a map; a key seen twice keeps each value. */
export function readLines(text: string): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) {
      const key = line.slice(0, at);
      found.set(key, [...(found.get(key) ?? []), line.slice(at + 1)]);
    }
  }
  return found;
}

/** What the host writes when it listens, and removes when it ends. */
export interface HostRunning {
  readonly pid: number;
  readonly port: number;
  readonly appVersion: string;
  readonly commit: string;
  readonly protocol: number;
  readonly contract: string;
}

/** The package platform a machine needs, or `null` for one that is not built. */
export function packagePlatform(identify: string): { readonly os: RemoteOs; readonly platform: string; readonly arch: string } | null {
  const [system, machine] = identify.trim().split(/\s+/);
  if (system === 'Linux' && machine === 'x86_64') {
    return { os: 'posix', platform: 'linux', arch: 'x64' };
  }
  if (system === 'Windows' && machine === 'AMD64') {
    return { os: 'windows', platform: 'win32', arch: 'x64' };
  }
  return null;
}
