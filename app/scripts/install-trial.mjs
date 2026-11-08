// @ts-nocheck: a trial script over the Windows shell and the installer.
/**
 * The Windows install trial (DSP-182): the built installer tried as a person uses it, with the
 * trial's own data folder and its own install folder, so that nothing of the person's own
 * installation, data, logins or running host is touched.
 *
 *   node scripts/install-trial.mjs --setup <DSpatch Setup A.exe> [--upgrade <DSpatch Setup B.exe>] [--out <evidence>] [--no-windows]
 *
 * With --no-windows nothing opens a window or sends input: the installer runs silently (/S), the
 * client is not started, and the steps that need the desktop are recorded as not run. For the
 * machine's own user that means a game or other work in the foreground is left alone.
 *
 * What it does, in order, each step checked and recorded in results.json:
 * 1. Refuses to run where DSpatch is installed or running for this user, snapshots %APPDATA%\DSpatch
 *    so the end can show it unchanged, and records the security products registered on the
 *    machine: what they do to an unsigned installer or uninstaller is part of what it observes.
 * 2. Starts a copy of the installer that carries the mark of the web, as a download does, and
 *    records which windows Windows shows (a security warning, or the wizard), with a screenshot of
 *    the screen and one of each such window; then closes them without installing.
 * 3. Installs through the wizard with UI Automation (scripts/install-trial/wizard.ps1): the
 *    folder page first and a folder of the trial's own, the Shortcuts page with its desktop
 *    checkbox unchecked, the finish page's offer to start declined.
 * 4. Checks the installation: files, the win32 Copilot runtime and host package, the version
 *    resource, the Start menu entry, no desktop shortcut, the uninstall entry and the installer's
 *    own registry key.
 * 5. Starts the installed DSpatch with the trial's data folder and the simulated provider, waits
 *    for its standalone host, writes synthetic data, and leaves client and host running.
 * 6. With --upgrade: installs the newer setup silently over the first while client and host run,
 *    checks that the installer closed the client it found running from that folder and left the
 *    host and the data untouched, starts the new client, reads what it says of the older host,
 *    presses Restart host, and checks the new host comes up with the data kept.
 * 7. Uninstalls silently while the host runs and waits for the removal: program, shortcuts and
 *    registry keys gone, data and host left; then ends the trial's host itself. When the
 *    uninstaller is gone, a security product's doing seen on one machine, that is recorded and
 *    the installation is removed by hand as INSTALL.md tells a person to.
 * Simulated answers verify the installation and the data flow, never a real provider.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const option = (name, fallback = '') => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const setup = path.resolve(option('setup'));
const upgrade = option('upgrade') === '' ? null : path.resolve(option('upgrade'));
const noWindows = process.argv.includes('--no-windows');
const evidence = path.resolve(option('out', path.join(appDir, 'release', 'trial-install', `${String(process.pid)}-${String(Date.now())}`)));
fs.mkdirSync(evidence, { recursive: true });

const results = [];
let stage = 'preflight';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(what, ok, detail = '') {
  results.push({ stage, what, ok: Boolean(ok), detail: String(detail).slice(0, 2000) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 400)}`}`);
  if (!ok) throw new Error(what);
}
function note(what, detail = '') {
  results.push({ stage, what, ok: true, detail: String(detail).slice(0, 2000) });
  console.log(`NOTE ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 400)}`}`);
}
/** A finding recorded without ending the trial, so that what follows is still observed. */
function record(what, ok, detail = '') {
  results.push({ stage, what, ok: Boolean(ok), detail: String(detail).slice(0, 2000) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 400)}`}`);
}
async function poll(what, read, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`timeout (${stage}): ${what}`);
}
/** PowerShell, for what the Windows shell knows: the registry, shortcuts, version resources, windows, processes. */
function ps(script, allowFailure = false) {
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 120_000 });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`powershell: ${result.stderr || result.stdout}`);
  }
  return `${result.stdout ?? ''}`.trim();
}
/** One value or object, as the script's last statement yields it. */
const psJson = (script) => JSON.parse(ps(`${script} | ConvertTo-Json -Compress -Depth 4`) || 'null');
/** A list, however many objects the script yields: piped into ConvertTo-Json, one object loses its brackets and none gives nothing. */
const psList = (script, allowFailure = false) => JSON.parse(ps(`ConvertTo-Json -Compress -Depth 4 -InputObject @($(${script}))`, allowFailure) || '[]');
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** DSpatch's own files of a data folder, hashed: what an upgrade and an uninstall must leave as they were. */
function dataHashes(folder) {
  const own = ['conversations', 'reviews', 'provider-support', 'window-zoom.json', 'window-layout.json', 'ssh-recent.json', 'claude-consent.json'];
  const hashes = {};
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const key = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(full, key);
      else hashes[key] = sha256(full);
    }
  };
  for (const name of own) {
    const full = path.join(folder, name);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) walk(full, name);
    else hashes[name] = sha256(full);
  }
  return hashes;
}
const sameHashes = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const differing = [...keys].filter((key) => a[key] !== b[key]);
  return { same: differing.length === 0, differing, count: Object.keys(a).length };
};

// --- The Windows shell ---------------------------------------------------------------------------

const uninstallEntries = () =>
  psList(`Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like 'DSpatch*' } | Select-Object PSChildName, DisplayName, DisplayVersion, InstallLocation, UninstallString, QuietUninstallString, Publisher`);
/** electron-builder's own key beside the uninstall entry, named like it: where the installer records the folder and the shortcut. */
const installKey = (name) => (name === '' ? [] : psList(`Get-ItemProperty 'HKCU:\\Software\\${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object InstallLocation, KeepShortcuts, ShortcutName`));
const startMenuLink = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'DSpatch.lnk');
const desktopLink = () => psJson(`[Environment]::GetFolderPath('Desktop')`) ? path.join(psJson(`[Environment]::GetFolderPath('Desktop')`), 'DSpatch.lnk') : '';
const versionOf = (file) => psJson(`(Get-Item -LiteralPath '${file.replace(/'/g, "''")}').VersionInfo | Select-Object ProductVersion, FileVersion, ProductName, CompanyName, FileDescription`);
const processAlive = (pid) => psList(`Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path`).length > 0;
const processPath = (pid) => (psList(`Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue | Select-Object Path`)[0] ?? {}).Path ?? '';
const runningClients = () => psList(`Get-Process DSpatch -ErrorAction SilentlyContinue | Select-Object Id, Path`);
const screenshot = (name) => {
  const file = path.join(evidence, `${name}.png`);
  ps(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing; Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Dpi2 { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@; [Dpi2]::SetProcessDPIAware() | Out-Null; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); $bmp.Save('${file.replace(/'/g, "''")}'); $g.Dispose(); $bmp.Dispose()`);
  return file;
};
/** Every visible top-level window with a title, as "pid|title". */
const visibleWindows = () =>
  psList(`Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Wins {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string> List() { var r = new List<string>(); EnumWindows((h, l) => { if (!IsWindowVisible(h)) return true; var sb = new StringBuilder(512); GetWindowText(h, sb, 512); if (sb.Length == 0) return true; uint pid; GetWindowThreadProcessId(h, out pid); r.Add(pid + "|" + sb.ToString()); return true; }, IntPtr.Zero); return r; }
}
"@; [Wins]::List()`);
const titleOf = (entry) => entry.split('|').slice(1).join('|');
/** One window by its title, as Windows draws it even under another window (PrintWindow): the screen capture shows what covers it. */
const windowShot = (title, name) => {
  const file = path.join(evidence, `${name}.png`);
  ps(`Add-Type -AssemblyName System.Drawing; Add-Type @"
using System; using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct WRect { public int L; public int T; public int R; public int B; }
public static class WShot { [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out WRect r); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@; [WShot]::SetProcessDPIAware() | Out-Null; $h = [WShot]::FindWindow($null, '${title.replace(/'/g, "''")}'); if ($h -eq [IntPtr]::Zero) { throw 'no window with that title' }; $r = New-Object WRect; [WShot]::GetWindowRect($h, [ref]$r) | Out-Null; $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T); $g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc(); [WShot]::PrintWindow($h, $hdc, 2) | Out-Null; $g.ReleaseHdc($hdc); $bmp.Save('${file.replace(/'/g, "''")}'); $g.Dispose(); $bmp.Dispose()`, true);
  return file;
};
/** Closes one window by its title as its Close button does (WM_CLOSE): a dialog answers it with its cancel. */
const closeWindow = (title) =>
  ps(`Add-Type @"
using System; using System.Runtime.InteropServices;
public static class WClose { [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title); [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l); }
"@; $h = [WClose]::FindWindow($null, '${title.replace(/'/g, "''")}'); if ($h -ne [IntPtr]::Zero) { [WClose]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }`, true);
const warningTitle = /Open File - Security Warning|protected your PC|SmartScreen/i;

// --- The client ------------------------------------------------------------------------------------

const simulated = {
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_PRESENTATION_LIST_MS: '50',
  DSPATCH_PRESENTATION_TOOL_MS: '400',
  DSPATCH_PRESENTATION_DELTA_MS: '120',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};

/** A DevTools connection to the installed client's main window, for reading what it shows and pressing its controls. */
class Page {
  constructor(port) {
    this.port = port;
    this.pending = new Map();
    this.sequence = 0;
  }
  async attach() {
    await poll('the client page', async () => {
      try {
        const list = await (await fetch(`http://127.0.0.1:${String(this.port)}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
        const target = list.find((entry) => entry.type === 'page' && !entry.url.includes('window='));
        if (!target) return false;
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = () => reject(new Error('DevTools open failed'));
        });
        socket.onmessage = (event) => {
          const answer = JSON.parse(event.data);
          const waiting = this.pending.get(answer.id);
          this.pending.delete(answer.id);
          if (answer.error) waiting?.reject(new Error(JSON.stringify(answer.error)));
          else waiting?.resolve(answer.result);
        };
        this.ws = socket;
        return true;
      } catch {
        return false;
      }
    }, 60_000);
  }
  ev(expression) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('DevTools timeout'));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value.result?.value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  }
  close() {
    this.ws?.close();
  }
}

const client = { child: null, page: null, log: '' };
async function startClient(exe, profile, label) {
  const cdp = await freePort();
  client.log = path.join(evidence, `client-${label}.log`);
  const output = fs.openSync(client.log, 'a');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSPATCH_')));
  // Started as the Start menu does, from its own folder; only the data folder and the debugging port are the trial's.
  const child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${String(cdp)}`], {
    cwd: path.dirname(exe),
    env: { ...env, ...simulated, DSPATCH_EXPECT_USERDATA: profile },
    stdio: ['ignore', output, output],
    detached: false,
  });
  fs.closeSync(output);
  client.child = child;
  client.page = new Page(cdp);
  await client.page.attach();
  await poll('the bridge', () => client.page.ev('Boolean(window.dspatch)'));
  return child;
}
async function endClient() {
  client.page?.close();
  const child = client.child;
  if (child !== null && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    // The client alone: the standalone host is its own process and goes on, as closing the window leaves it.
    spawnSync('taskkill', ['/PID', String(child.pid), '/F'], { encoding: 'utf8' });
    await Promise.race([exited, delay(10_000)]);
  }
  client.child = null;
  client.page = null;
}
/** The client's process is gone and the trial forgets it, when something other than the trial ended it. */
function forgetClient() {
  client.page?.close();
  client.child = null;
  client.page = null;
}
const hostRunning = (profile) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(profile, 'host-running.json'), 'utf8'));
  } catch {
    return null;
  }
};
const clientLog = () => (fs.existsSync(client.log) ? fs.readFileSync(client.log, 'utf8') : '');

// --- The trial -------------------------------------------------------------------------------------

const installDir = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'Programs', 'DSpatch-trial');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-install-trial-data-'));
const realData = path.join(process.env.APPDATA ?? '', 'DSpatch');
const realSnapshot = () => (fs.existsSync(realData) ? fs.readdirSync(realData).map((name) => `${name}:${String(fs.statSync(path.join(realData, name)).mtimeMs)}`).sort().join('\n') : 'absent');
/** What a person does when the uninstaller is gone: the program folder, the Start menu entry and the two registry keys, nothing else. */
function removeByHand(keyName) {
  fs.rmSync(installDir, { recursive: true, force: true });
  if (fs.existsSync(startMenuLink)) fs.rmSync(startMenuLink, { force: true });
  if (keyName !== '') ps(`Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${keyName}', 'HKCU:\\Software\\${keyName}' -Recurse -Force -ErrorAction SilentlyContinue`, true);
}

async function main() {
  stage = 'preflight';
  check('this is Windows', process.platform === 'win32', process.platform);
  check('the installer to try exists', fs.existsSync(setup), setup);
  if (upgrade !== null) check('the newer installer exists', fs.existsSync(upgrade), upgrade);
  const before = uninstallEntries();
  check('DSpatch is not installed for this user (the trial refuses to touch a real installation)', before.length === 0, JSON.stringify(before));
  check('the trial install folder does not exist yet', !fs.existsSync(installDir), installDir);
  check('no Start menu entry named DSpatch exists yet', !fs.existsSync(startMenuLink), startMenuLink);
  const clients = runningClients();
  // The installer and the uninstaller close the DSpatch.exe processes they find running from the folder they work in,
  // found by path through PowerShell; without PowerShell they fall back to every DSpatch.exe of the user.
  check('no DSpatch client is running (the installer closes the clients it finds; a running one of the person\'s own is not risked)', clients.length === 0, JSON.stringify(clients));
  const realBefore = realSnapshot();
  const realHost = fs.existsSync(path.join(realData, 'host-running.json')) ? sha256(path.join(realData, 'host-running.json')) : 'none';
  note('the setup file', `${setup} ${String(fs.statSync(setup).size)} bytes sha256 ${sha256(setup)}`);
  note('the setup file version resource', JSON.stringify(versionOf(setup)));
  note(`the person's own data folder, left alone throughout`, `${realData}: ${realBefore.split('\n').length} entries`);
  let security = [];
  try {
    security = psList(`Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop | Select-Object displayName, productState`, true);
  } catch {
    security = [];
  }
  note('security products registered on this machine (a server has no such registry); what they do to the unsigned files shows in the results, not in logs the trial can read', security.length > 0 ? JSON.stringify(security) : 'none readable');

  stage = 'what Windows shows for an unsigned installer downloaded from the web';
  if (noWindows) {
    note('not run (--no-windows): starting a downloaded copy opens a Windows dialog', 'observed by hand on this machine instead; see the task');
  } else {
    const marked = path.join(evidence, path.basename(setup));
    fs.copyFileSync(setup, marked);
    // The mark of the web, as a browser leaves it on a download (an alternate data stream): what SmartScreen looks at.
    fs.writeFileSync(`${marked}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://github.com/nizlas/DSpatch/releases\r\nHostUrl=https://github.com/nizlas/DSpatch/releases\r\n');
    check('the downloaded copy carries the mark of the web', fs.existsSync(`${marked}:Zone.Identifier`), marked);
    // Started as a double-click in Explorer starts it, from a PowerShell of its own: when Windows puts a dialog before
    // the program ("Open File - Security Warning", or SmartScreen), that start blocks until the dialog is answered.
    const launcher = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process -FilePath '${marked.replace(/'/g, "''")}'`], { stdio: 'ignore' });
    await delay(6000);
    const windows = visibleWindows();
    const warnings = windows.filter((entry) => warningTitle.test(titleOf(entry)));
    const wizards = windows.filter((entry) => /DSpatch Setup/i.test(titleOf(entry)));
    screenshot('01-downloaded-installer-started');
    for (const [index, entry] of warnings.entries()) windowShot(titleOf(entry), `02-warning-${String(index + 1)}`);
    for (const [index, entry] of wizards.entries()) windowShot(titleOf(entry), `03-wizard-${String(index + 1)}`);
    note('windows on screen 6 s after starting the downloaded copy', windows.filter((entry) => /Security Warning|protected|SmartScreen|Setup/i.test(titleOf(entry))).join(' || ') || 'none with those words');
    if (warnings.length > 0) {
      note('observed: Windows put a warning before the installer, answered here with its close (Cancel)', warnings.map(titleOf).join(' || '));
    } else if (wizards.length > 0) {
      note('observed: the wizard opened straight away; no warning window on this machine', wizards.map(titleOf).join(' || '));
    } else {
      note('observed: neither a warning window nor the wizard was found by title within 6 s', windows.map(titleOf).join(' || '));
    }
    // Nothing is installed from the downloaded copy: the warning is closed as its Cancel closes it, and a wizard that opened is ended.
    for (const entry of warnings) closeWindow(titleOf(entry));
    ps(`Get-Process | Where-Object { $_.ProcessName -like 'DSpatch Setup*' } | Stop-Process -Force -ErrorAction SilentlyContinue`, true);
    await delay(1500);
    launcher.kill();
    fs.rmSync(marked, { force: true });
    check('the downloaded copy installed nothing', !fs.existsSync(installDir) && uninstallEntries().length === 0);
    check('the warning and the wizard are gone', visibleWindows().filter((entry) => warningTitle.test(titleOf(entry)) || /DSpatch Setup/i.test(titleOf(entry))).length === 0);
  }

  if (noWindows) {
    stage = 'a silent install (/S) into the trial folder';
    const installed = spawnSync(setup, ['/S', `/D=${installDir}`], { encoding: 'utf8', timeout: 400_000 });
    check('the setup installed silently into the chosen folder without administrator rights', installed.status === 0 && fs.existsSync(path.join(installDir, 'DSpatch.exe')), `exit ${String(installed.status)}`);
  } else {
    stage = 'the wizard';
    const wizardResult = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scriptDir, 'install-trial', 'wizard.ps1'), '-Setup', setup, '-InstallDir', installDir, '-Evidence', evidence], { encoding: 'utf8', timeout: 400_000 });
    console.log(wizardResult.stdout.trim());
    const wizardSteps = fs.existsSync(path.join(evidence, 'wizard.json')) ? JSON.parse(fs.readFileSync(path.join(evidence, 'wizard.json'), 'utf8')) : [];
    for (const step of Array.isArray(wizardSteps) ? wizardSteps : [wizardSteps]) results.push({ stage, ...step });
    check('the wizard installed into the chosen folder without administrator rights', wizardResult.status === 0 && fs.existsSync(path.join(installDir, 'DSpatch.exe')), wizardResult.status === 0 ? installDir : wizardResult.stderr.slice(0, 600));
  }

  stage = 'the installation';
  const exe = path.join(installDir, 'DSpatch.exe');
  const resources = path.join(installDir, 'resources');
  const hostPackages = fs.readdirSync(path.join(resources, 'bundled', 'host-packages'));
  check('the win32 host package is bundled', hostPackages.some((name) => /win32-x64\.tar\.gz$/.test(name)), hostPackages.join(', '));
  const copilot = fs.readdirSync(path.join(resources, 'app', 'node_modules', '@github'));
  check('the Copilot runtime is the win32 one, and no Linux one came along', copilot.includes('copilot-sdk-win32-x64') && !copilot.some((name) => /linux/.test(name)), copilot.join(', '));
  const version = versionOf(exe);
  const expected = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  note('the executable version resource', JSON.stringify(version));
  check('the executable carries DSpatch\'s version and name', String(version?.ProductVersion ?? '').startsWith(expected) && version?.ProductName === 'DSpatch', JSON.stringify(version));
  check('a Start menu entry was created', fs.existsSync(startMenuLink), startMenuLink);
  const desktop = desktopLink();
  check('no desktop shortcut, as the page was left unchecked', desktop !== '' && !fs.existsSync(desktop), desktop);
  const entry = uninstallEntries();
  // electron-builder writes no InstallLocation; the folder is in the uninstall command, with /currentuser for a per-user install.
  check('an uninstall entry under Apps and features names the version and the folder, per user', entry.length === 1 && entry[0].DisplayVersion === expected && String(entry[0].UninstallString ?? '').toLowerCase().includes(installDir.toLowerCase()) && /\/currentuser/.test(String(entry[0].UninstallString ?? '')), JSON.stringify(entry));
  const installKeyName = String(entry[0]?.PSChildName ?? '');
  check('the installer\'s own key records the folder and the shortcut name', installKey(installKeyName).length === 1 && String(installKey(installKeyName)[0].InstallLocation ?? '').toLowerCase() === installDir.toLowerCase(), JSON.stringify({ key: installKeyName, values: installKey(installKeyName) }));
  // Observed on a machine with Bitdefender: the unsigned uninstaller was quarantined as soon as the installer wrote it,
  // so the installation had no uninstaller and Apps and features could not remove it. Recorded; the trial goes on.
  record('the uninstaller is in the folder', fs.existsSync(path.join(installDir, 'Uninstall DSpatch.exe')), fs.existsSync(path.join(installDir, 'Uninstall DSpatch.exe')) ? 'present' : 'missing right after the install: removed by a security product (see the security products note)');
  if (!noWindows) screenshot('20-installed');

  stage = 'first start with the trial\'s own data folder';
  const running = { pid: 0 };
  let dataBefore = {};
  if (noWindows) {
    note('not run (--no-windows): starting the installed client opens its window', 'the first start, the host and the Restart host flow wait for a free desktop');
    fs.mkdirSync(path.join(profile, 'conversations', 'trial-synthetic'), { recursive: true });
    fs.mkdirSync(path.join(profile, 'reviews', 'trial-synthetic'), { recursive: true });
    fs.writeFileSync(path.join(profile, 'conversations', 'trial-synthetic', 'marker.txt'), `synthetic conversation marker ${String(Date.now())}\n`);
    fs.writeFileSync(path.join(profile, 'reviews', 'trial-synthetic', 'marker.json'), JSON.stringify({ synthetic: true, at: new Date().toISOString(), random: Math.random() }));
    dataBefore = dataHashes(profile);
  } else {
    await startClient(exe, profile, 'first');
    Object.assign(running, await poll('the standalone host', () => hostRunning(profile), 120_000));
    check('the installed client started its standalone host from the trial data folder', Number.isInteger(running.pid) && running.appVersion === expected, JSON.stringify(running));
    const hostPath = processPath(running.pid);
    check('the host is node.exe from the bundled package, unpacked under the data folder', /node\.exe$/i.test(hostPath) && hostPath.toLowerCase().startsWith(path.join(profile, 'host-installations').toLowerCase()), hostPath);
    await poll('the window', () => client.page.ev(`document.querySelector('[data-ev="host-link"]')?.dataset.phase === 'connected'`), 60_000);
    const hostLine = await client.page.ev(`document.querySelector('[data-ev="host-link-words"]')?.textContent ?? ''`);
    check('the window says it is on this computer', /On this computer/.test(hostLine), hostLine);
    await delay(1500);
    screenshot('30-first-start');
    // Synthetic data, beside what the app wrote itself: what an upgrade and an uninstall must keep.
    fs.mkdirSync(path.join(profile, 'conversations', 'trial-synthetic'), { recursive: true });
    fs.mkdirSync(path.join(profile, 'reviews', 'trial-synthetic'), { recursive: true });
    fs.writeFileSync(path.join(profile, 'conversations', 'trial-synthetic', 'marker.txt'), `synthetic conversation marker ${String(Date.now())}\n`);
    fs.writeFileSync(path.join(profile, 'reviews', 'trial-synthetic', 'marker.json'), JSON.stringify({ synthetic: true, at: new Date().toISOString(), random: Math.random() }));
    dataBefore = dataHashes(profile);
    note('data in the trial folder before the upgrade', `${String(Object.keys(dataBefore).length)} files hashed (synthetic markers and what the app wrote)`);
    if (upgrade === null) {
      await endClient();
      await delay(1500);
      check('ending the client left the host running, as closing the window does', processAlive(running.pid), String(running.pid));
    } else {
      note('the client is left running into the upgrade, as a person who forgot to close it leaves it', `pid ${String(client.child?.pid)}`);
    }
  }

  if (upgrade !== null) {
    stage = 'upgrade over the installation while its host runs';
    const upgraded = spawnSync(upgrade, ['/S', `/D=${installDir}`], { encoding: 'utf8', timeout: 400_000 });
    check('the newer setup installed silently over the older one', upgraded.status === 0 && fs.existsSync(exe), `exit ${String(upgraded.status)}`);
    const newVersion = versionOf(exe);
    const newExpected = versionOf(upgrade)?.ProductVersion ?? '';
    // The setup file's resource says "0.1.10", the installed executable's "0.1.10.0": three parts are compared.
    const threeParts = (value) => String(value ?? '').split('.').slice(0, 3).join('.');
    check('the program is the newer version', threeParts(newVersion?.ProductVersion) === threeParts(newExpected) && threeParts(newExpected) !== threeParts(version?.ProductVersion), JSON.stringify({ from: version?.ProductVersion, to: newVersion?.ProductVersion, setup: newExpected }));
    record('the newer build\'s uninstaller is in the folder after the upgrade', fs.existsSync(path.join(installDir, 'Uninstall DSpatch.exe')), fs.existsSync(path.join(installDir, 'Uninstall DSpatch.exe')) ? 'present' : 'missing: removed by a security product (see the security products note)');
    const entryAfter = uninstallEntries();
    check('the uninstall entry names the newer version, once', entryAfter.length === 1 && String(entryAfter[0].DisplayVersion) === newExpected.split('.').slice(0, 3).join('.') && String(entryAfter[0].UninstallString ?? '').toLowerCase().includes(installDir.toLowerCase()), JSON.stringify(entryAfter));
    if (!noWindows) {
      const clientPid = client.child?.pid ?? 0;
      // In silent mode the installer's "DSpatch is running. Click OK to close it." is answered OK by default.
      check('the installer closed the client it found running from the folder it replaced', clientPid > 0 && !processAlive(clientPid), `pid ${String(clientPid)}`);
      forgetClient();
      check('the older host went on running through the upgrade', processAlive(running.pid), String(running.pid));
    }
    const dataAfterUpgrade = dataHashes(profile);
    const kept = sameHashes(dataBefore, dataAfterUpgrade);
    check('the data folder is byte for byte as before the upgrade', kept.same, JSON.stringify(kept));
    check('the Start menu entry is still there, and still no desktop shortcut', fs.existsSync(startMenuLink) && !fs.existsSync(desktop));
    if (noWindows) {
      note('not run (--no-windows): the new client, the older host it finds and Restart host', 'waits for a free desktop');
    } else {
      await startClient(exe, profile, 'after-upgrade');
      await poll('the window', () => client.page.ev(`document.querySelector('[data-ev="host-link"]')?.dataset.phase === 'connected'`), 60_000);
      const build = await client.page.ev(`JSON.stringify({ build: document.querySelector('[data-ev="host-link"]')?.dataset.build, words: document.querySelector('[data-ev="host-link-words"]')?.textContent, button: document.querySelector('[data-ev="host-link-leave"]')?.textContent })`);
      const said = JSON.parse(build ?? '{}');
      check('the new client found the older host and offers Restart host', said.build === 'update' && /Restart host/.test(said.button ?? ''), build);
      check('the log names the update that waits for a restart', /an update waits for a restart/.test(clientLog()), (clientLog().match(/host link: [^\n]*/g) ?? []).slice(-1).join(''));
      screenshot('40-older-host-found');
      const oldPid = running.pid;
      await client.page.ev(`document.querySelector('[data-ev="host-link-leave"]')?.click(); true`);
      const restarted = await poll('the new host', () => {
        const now = hostRunning(profile);
        return now !== null && now.pid !== oldPid && now.appVersion === newExpected.split('.').slice(0, 3).join('.') ? now : false;
      }, 120_000);
      check('Restart host ended the older host and started this build\'s', restarted.pid !== oldPid && !processAlive(oldPid), JSON.stringify(restarted));
      await poll('the window connected again', () => client.page.ev(`document.querySelector('[data-ev="host-link"]')?.dataset.phase === 'connected' && document.querySelector('[data-ev="host-link"]')?.dataset.build === 'same'`), 90_000);
      const keptAfterRestart = sameHashes(dataBefore, dataHashes(profile));
      check('the data is as before, after the restart too', keptAfterRestart.same, JSON.stringify(keptAfterRestart));
      screenshot('41-after-restart');
      await endClient();
      await delay(1500);
      check('the new host runs on after the client ended', processAlive(restarted.pid), String(restarted.pid));
      running.pid = restarted.pid;
    }
  }

  stage = 'uninstall while the host runs';
  const uninstaller = path.join(installDir, 'Uninstall DSpatch.exe');
  if (fs.existsSync(uninstaller)) {
    // An NSIS uninstaller copies itself to the temp folder and goes on from there, so its first process ends at
    // once: the removal is waited for, not assumed. A security product that stops the copy leaves everything in place.
    const removed = spawnSync(uninstaller, ['/S'], { encoding: 'utf8', timeout: 300_000 });
    check('the uninstaller started silently', removed.status === 0, `exit ${String(removed.status)}`);
    try {
      await poll('the removal to finish (program gone, entry gone, no uninstaller process left)', async () => !fs.existsSync(exe) && uninstallEntries().length === 0 && psList(`Get-Process Un_A* -ErrorAction SilentlyContinue | Select-Object Id`).length === 0, 180_000);
      record('the uninstaller removed the installation', true);
    } catch (error) {
      record('the uninstaller removed the installation', false, `${String(error.message)}; uninstaller still present: ${String(fs.existsSync(uninstaller))}; removed by hand instead`);
      removeByHand(installKeyName);
    }
  } else {
    record('the uninstaller is still in the folder', false, 'missing: a security product removed the unsigned file, so Apps and features cannot uninstall this installation; removed by hand instead, as INSTALL.md tells a person to');
    removeByHand(installKeyName);
  }
  check('the program folder is gone', !fs.existsSync(exe) && (!fs.existsSync(installDir) || fs.readdirSync(installDir).length === 0), fs.existsSync(installDir) ? fs.readdirSync(installDir).join(', ') : 'removed');
  check('the Start menu entry is gone', !fs.existsSync(startMenuLink));
  check('the uninstall entry is gone', uninstallEntries().length === 0, JSON.stringify(uninstallEntries()));
  check('the installer\'s own key is gone', installKey(installKeyName).length === 0, installKeyName);
  const keptAfterUninstall = sameHashes(dataBefore, dataHashes(profile));
  check('the data folder is left as it was: conversations, reviews and settings stay', keptAfterUninstall.same, JSON.stringify(keptAfterUninstall));
  if (!noWindows) {
    check('the running host was not stopped by the uninstaller', processAlive(running.pid), String(running.pid));
    screenshot('50-uninstalled');
  }

  stage = 'cleanup';
  if (!noWindows) {
    spawnSync('taskkill', ['/PID', String(running.pid), '/T', '/F'], { encoding: 'utf8' });
    await delay(1000);
    check('the trial ended its own host', !processAlive(running.pid));
  }
  check(`the person's own data folder is as it was`, realSnapshot() === realBefore && (fs.existsSync(path.join(realData, 'host-running.json')) ? sha256(path.join(realData, 'host-running.json')) : 'none') === realHost);
  if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
  note('the trial data folder is kept for inspection', profile);
}

try {
  await main();
} catch (error) {
  results.push({ stage, what: 'the trial reached its end', ok: false, detail: error.stack ?? String(error) });
  console.error(`FAIL ${stage}: ${error.stack ?? error}`);
  try {
    screenshot('failure');
  } catch {
    // The screen may not be readable.
  }
  await endClient().catch(() => undefined);
  process.exitCode = 1;
} finally {
  const findings = results.filter((entry) => !entry.ok).length;
  if (findings > 0) process.exitCode = 1;
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, setup, upgrade, installDir, profile, finishedAt: new Date().toISOString(), findings, results }, null, 2));
  console.log(`${String(findings)} finding(s) recorded`);
  console.log(`evidence: ${evidence}`);
}
