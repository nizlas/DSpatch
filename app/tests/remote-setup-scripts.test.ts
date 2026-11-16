/**
 * The Windows host script of DSP-214 cannot run here, so what a later edit could break is held
 * statically: every change to the computer stays in the script's Changes region, which runs only
 * after the plan, -DryRun's stop and "Proceed?"; sshd_config is only read; keys are written as
 * UTF-8 without a BOM; Administrators and SYSTEM are named by SID; no personal value and no
 * default for -AllowFrom. And both scripts are bundled, staged and saved under the same names.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { REMOTE_SETUP_SCRIPTS, SAVE_REMOTE_SETUP_CHANNEL } from '../src/shared/remote-setup';

const APP = path.join(import.meta.dirname, '..');
const SCRIPT = fs.readFileSync(path.join(APP, 'remote-setup', 'dspatch-prepare-windows-host.ps1'), 'utf8');

/** The script without comments and with every string literal emptied, keeping its lines. */
function codeOnly(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (source.startsWith('<#', i)) {
      const end = source.indexOf('#>', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (c === '#') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (c === "'" || c === '"') {
      i++;
      while (i < source.length) {
        if (c === '"' && source[i] === '`') {
          i += 2;
        } else if (source[i] === c && source[i + 1] === c) {
          i += 2;
        } else if (source[i] === c) {
          i++;
          break;
        } else {
          i++;
        }
      }
      out += `${c}${c}`;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const REGION_START = SCRIPT.indexOf('#region Changes');
const REGION_END = SCRIPT.indexOf('#endregion Changes');
const inside = codeOnly(SCRIPT.slice(REGION_START, REGION_END));
const outside = codeOnly(SCRIPT.slice(0, REGION_START) + SCRIPT.slice(REGION_END));
const MUTATING =
  /\b(?:Add-WindowsCapability|New-NetFirewallRule|Set-NetFirewallRule|Disable-NetFirewallRule|Enable-NetFirewallRule|Remove-NetFirewallRule|Set-Acl|AppendAllText|WriteAllText|CreateDirectory|New-Item|Start-Service|Set-Service|Restart-Service|Stop-Service|icacls|Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|Remove-Item|Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|Set-NetConnectionProfile|Restart-Computer|Set-ExecutionPolicy)\b/i;

test('the script is plain ASCII, so Windows PowerShell 5.1 reads it as written', () => {
  assert.doesNotMatch(SCRIPT, /[^\x00-\x7f]/);
  assert.ok(REGION_START > 0 && REGION_END > REGION_START, 'the Changes region is there');
});

test('every change is in the Changes region, called only after the plan, -DryRun and Proceed', () => {
  const found = MUTATING.exec(outside);
  assert.equal(found, null, `a change outside the Changes region: ${found?.[0] ?? ''}`);
  assert.doesNotMatch(outside, /Invoke-Change/i, 'the change functions are called only by Invoke-AllChanges');
  const calls = [...outside.matchAll(/Invoke-AllChanges/g)];
  assert.equal(calls.length, 1, 'Invoke-AllChanges is called once');
  const call = SCRIPT.lastIndexOf('Invoke-AllChanges (');
  const dryRunStop = SCRIPT.lastIndexOf('if ($DryRun) {');
  assert.ok(dryRunStop > REGION_END && /^if \(\$DryRun\) \{[^}]*exit \$ExitOk/.test(SCRIPT.slice(dryRunStop)), '-DryRun exits after the plan');
  const plan = SCRIPT.indexOf("Write-Heading 'Plan: what this script will change");
  const proceed = SCRIPT.indexOf("Read-Host 'Proceed? [y/N]'");
  assert.ok(plan > REGION_END && plan < dryRunStop && dryRunStop < proceed && proceed < call, 'plan, then -DryRun, then Proceed, then the changes');
  assert.doesNotMatch(SCRIPT, /Restart-Computer|Set-NetConnectionProfile/, 'never restarts, never changes the network profile');
});

test('sshd_config is only read, and keys are written as UTF-8 without a BOM', () => {
  const code = codeOnly(SCRIPT);
  for (const line of code.split('\n').filter((text) => /SshdConfigPath/.test(text))) {
    assert.doesNotMatch(line, MUTATING, `sshd_config only read: ${line.trim()}`);
  }
  assert.match(SCRIPT, /\[IO\.File\]::ReadAllLines\(\$Path\)/, 'Read-SshdConfig reads it');
  assert.doesNotMatch(code, /\b(?:Out-File|Set-Content|Add-Content)\b/);
  assert.match(inside, /\$utf8 = New-Object Text\.UTF8Encoding \$false/);
  for (const write of inside.matchAll(/\[IO\.File\]::(?:AppendAllText|WriteAllText)\(([^)]*)\)/g)) {
    assert.match(write[1] ?? '', /, \$utf8$/, `written with UTF-8 without a BOM: ${write[0]}`);
  }
  assert.doesNotMatch(code.replaceAll('2>&1', ''), />/, 'no redirection into a file');
});

test('Administrators and SYSTEM by SID, no IsInRole, and no defaults or personal values', () => {
  assert.match(SCRIPT, /\$AdministratorsSid = 'S-1-5-32-544'/);
  assert.match(SCRIPT, /\$SystemSid = 'S-1-5-18'/);
  assert.doesNotMatch(SCRIPT, /IsInRole/);
  const parameters = SCRIPT.slice(SCRIPT.indexOf('param('), SCRIPT.indexOf(')\n\nSet-StrictMode'));
  assert.match(parameters, /\[string\]\$AllowFrom,/);
  assert.doesNotMatch(parameters, /=/, 'no parameter has a default');
  assert.doesNotMatch(SCRIPT.replaceAll('~~~~0.0.1.0', ''), /\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'no IPv4 address');
  assert.doesNotMatch(SCRIPT, /AAAA[A-Za-z0-9+/]{20}|niclas|nizlas/i, 'no key and no personal name');
  for (const code of ['$ExitOk = 0', '$ExitRefused = 1', '$ExitRestart = 2', '$ExitPolicy = 3']) {
    assert.ok(SCRIPT.includes(code), code);
  }
});

test('both scripts are bundled, staged with SHA256SUMS and saved from Help under one set of names', async () => {
  const stage = (await import('../scripts/stage-release.mjs')) as {
    REMOTE_SETUP_FILES: string[];
    releaseFiles(version: string, manifest: { packages: { file: string }[] }, linuxOnly: boolean): [string, string][];
  };
  const names = fs.readdirSync(path.join(APP, 'remote-setup')).sort();
  assert.deepEqual([...stage.REMOTE_SETUP_FILES].sort(), names);
  assert.deepEqual(Object.values(REMOTE_SETUP_SCRIPTS).sort(), names);
  for (const linuxOnly of [false, true]) {
    const files = stage.releaseFiles('9.9.9', { packages: [{ file: 'dspatch-host-x.tar.gz' }] }, linuxOnly);
    for (const name of names) {
      assert.ok(files.some(([from, to]) => from === path.join('..', 'remote-setup', name) && to === name), `${name} is staged`);
    }
  }
  assert.match(fs.readFileSync(path.join(APP, 'scripts', 'prepare-bundled.mjs'), 'utf8'), /path\.join\(appDir, 'remote-setup'\), path\.join\(bundled, 'remote-setup'\)/);
  // The Linux helper names its release's download by the version written beside it (DSP-215).
  assert.match(fs.readFileSync(path.join(APP, 'scripts', 'prepare-bundled.mjs'), 'utf8'), /path\.join\(bundled, 'remote-setup', 'VERSION'\), `\$\{pkg\.version\}\\n`/);
  assert.ok(fs.readFileSync(path.join(APP, 'src', 'preload', 'preload.ts'), 'utf8').includes(`ipcRenderer.invoke('${SAVE_REMOTE_SETUP_CHANNEL}', which)`), 'the preload uses the same channel');
});
