/**
 * What Connect runs on another machine and how it reads the answers (DSP-153). The whole flow
 * against a real sshd is `scripts/trial-package/run.mjs`; this is what a later edit of the
 * scripts or sentences could break without any machine at hand.
 */

import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { releaseUrl, findHostPackage, readHostManifest, type HostManifest } from '../src/main/host-packages.ts';
import { installedHostToStart, SshConnection, sshProblem, validTarget } from '../src/main/ssh-connection.ts';
import { processIdentity } from '../src/main/host-data.ts';
import { credentials, handover, install, packagePlatform, probe, readLines, receive, start, stop } from '../src/shared/host-bootstrap.ts';

/**
 * The steps a Linux or macOS host runs, run here by a real `sh` with its `tar`, `sleep` and `/proc`.
 * A Windows computer has none of them as a host would: its own steps are PowerShell, and are run
 * where they are tested. Git's `sh` on Windows is not that host and would only test itself.
 */
const POSIX_STEPS_HERE = process.platform === 'win32' ? 'the POSIX host steps need a POSIX host' : false;

describe('a machine to connect to', () => {
  it('cannot be read as an option of ssh', () => {
    for (const bad of ['-oProxyCommand=x', '-F', 'a b', 'a;b', '']) {
      assert.equal(validTarget(bad), false, bad);
    }
    for (const good of ['niclasdn@pc54065-2316', 'alias', 'user@host.example.com', 'me@[::1]']) {
      assert.equal(validTarget(good), true, good);
    }
  });

  it('is built for two platforms and says so of any other', () => {
    assert.deepEqual(packagePlatform('Linux x86_64\n'), { os: 'posix', platform: 'linux', arch: 'x64' });
    assert.deepEqual(packagePlatform('Windows AMD64'), { os: 'windows', platform: 'win32', arch: 'x64' });
    assert.equal(packagePlatform('Linux aarch64'), null);
    assert.equal(packagePlatform('Darwin arm64'), null);
  });
});

describe('an installed host to start', () => {
  const build = { appVersion: '1.0', commit: 'client', protocol: 1, contract: 'same' };
  const installation = (commit: string, extra: Record<string, unknown> = {}) => ({
    ...build, commit, hostId: `1.0-${commit}`, ...extra,
  });
  const factsFor = (...installed: ReturnType<typeof installation>[]) => new Map([
    ['version', installed.map((host) => host.hostId)],
    ['installed', installed.map((host) => JSON.stringify(host))],
  ]);

  it('prefers the exact build to another compatible installation', () => {
    assert.equal(installedHostToStart(build, factsFor(installation('other'), installation('client'))), '1.0-client');
  });

  it('selects a compatible installed build without needing a client package manifest', () => {
    assert.equal(installedHostToStart(build, factsFor(installation('other'))), '1.0-other');
  });

  it('rejects different protocols, contracts, unsafe paths and missing installation folders', () => {
    for (const extra of [{ protocol: 2 }, { contract: 'different' }, { hostId: '../other' }, { hostId: '1.0-wrong' }]) {
      assert.equal(installedHostToStart(build, factsFor(installation('other', extra))), null);
    }
    const facts = factsFor(installation('other'));
    facts.set('version', []);
    assert.equal(installedHostToStart(build, facts), null);
    facts.set('installed', ['not-json', 'null']);
    assert.equal(installedHostToStart(build, facts), null);
  });

  it('does not fall back to the stopped build when replacement was explicitly requested', () => {
    assert.equal(installedHostToStart(build, factsFor(installation('other')), false), null);
    assert.equal(installedHostToStart(build, factsFor(installation('client')), false), '1.0-client');
  });

  it('selects deterministically and prefers the same application version', () => {
    const otherVersion = installation('older', { appVersion: '0.9', hostId: '0.9-older' });
    assert.equal(installedHostToStart(build, factsFor(otherVersion, installation('z'), installation('a'))), '1.0-a');
    assert.equal(installedHostToStart(build, factsFor(installation('a'), installation('z'), otherVersion)), '1.0-a');
    assert.equal(installedHostToStart(build, factsFor(otherVersion)), '0.9-older');
  });

  it('starts the compatible installation without requesting a package or installation tools', async () => {
    const facts = factsFor(installation('other'));
    facts.set('missing', ['tar', 'sha256sum']);
    const statuses: string[] = [];
    const connection = new SshConnection({
      target: 'user@host.example.com', build, log: () => undefined,
      status: (text) => statuses.push(text), ask: async () => { throw new Error('No question expected'); },
      packageFor: async () => { throw new Error('No package expected'); },
      askpassScript: '', nodeRunner: process.execPath,
    });
    const internal = connection as unknown as {
      identify(): Promise<{ os: string; platform: string; arch: string }>;
      must(step: { stdin?: string }): Promise<ReadonlyMap<string, readonly string[]>>;
      ensureHost(interactive: boolean): Promise<{ running: { commit: string }; token: string }>;
    };
    const steps: string[] = [];
    internal.identify = async () => ({ os: 'posix', platform: 'linux', arch: 'x64' });
    internal.must = async (step) => {
      steps.push(step.stdin ?? '');
      if (step.stdin === probe('posix').stdin) {
        return facts;
      }
      if (step.stdin === start('posix', '1.0-other').stdin) {
        return new Map([['started', ['yes']]]);
      }
      assert.equal(step.stdin, credentials('posix').stdin);
      return new Map([
        ['running', [JSON.stringify({ ...installation('other'), pid: 123, port: 4321 })]],
        ['token', ['test-only-token']],
      ]);
    };
    try {
      const answer = await internal.ensureHost(true);
      assert.equal(answer.running.commit, 'other');
      assert.equal(answer.token, 'test-only-token');
      assert.equal(steps.length, 3);
      assert.ok(statuses.includes('Starting compatible host 1.0-other...'));

      facts.set('installed', [JSON.stringify(installation('other', { protocol: 2 }))]);
      await assert.rejects(internal.ensureHost(true), /missing tar and sha256sum/);
      facts.delete('missing');
      await assert.rejects(internal.ensureHost(true), /No package expected/);
      assert.equal(steps.length, 5);
    } finally {
      connection.close();
    }
  });
});

describe("what ssh says, in a person's words", () => {
  it('tells a changed host key from everything else, and never suggests accepting it', () => {
    const said = sshProblem('m', '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.');
    assert.match(said, /has changed/);
    assert.match(said, /nothing was sent/);
  });

  it('names each failure', () => {
    assert.match(sshProblem('m', 'user@m: Permission denied (publickey,password).'), /refused the sign-in/);
    assert.match(sshProblem('m', 'ssh: Could not resolve hostname m: Name or service not known'), /could be found/);
    assert.match(sshProblem('m', 'ssh: connect to host m port 22: Connection refused'), /no SSH server/);
    assert.match(sshProblem('m', 'ssh: connect to host m port 22: Connection timed out'), /could not be reached/);
  });
});

describe('the steps on the machine, run by a real sh', { skip: POSIX_STEPS_HERE }, () => {
  const run = (home: string, step: { readonly command: string; readonly stdin?: string }, input?: Buffer): string => {
    assert.ok(step.stdin !== undefined || step.command.startsWith('sh -c '));
    const args = step.stdin !== undefined ? ['-s'] : ['-c', step.command.slice('sh -c '.length).replace(/^'|'$/g, '').replaceAll(`'\\''`, `'`)];
    return execFileSync('sh', args, { input: step.stdin ?? input, env: { PATH: process.env['PATH'], HOME: home }, encoding: 'utf8' });
  };

  /** A package whose launcher only records that it ran and says where it listens. */
  function packageIn(dir: string): { readonly file: string; readonly bytes: Buffer; readonly sha256: string } {
    const top = path.join(dir, 'dspatch-host');
    fs.mkdirSync(path.join(top, 'node', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(top, 'node', 'bin', 'node'), '#!/bin/sh\necho v1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(top, 'manifest.json'), '{}\n');
    fs.writeFileSync(
      path.join(top, 'dspatch-host'),
      // With the identity a real host records: the boot and this process's start, kept across exec.
      '#!/bin/sh\necho secret-token > "$4/remote-token"\nboot=$(cat /proc/sys/kernel/random/boot_id)\nstarted=$(sed \'s/^.*) //\' /proc/$$/stat | cut -d\' \' -f20)\nprintf \'{"pid": %s, "identity": "%s:%s", "port": 4321}\\n\' $$ "$boot" "$started" > "$4/host-running.json"\nexec sleep 30\n',
      { mode: 0o755 },
    );
    const file = path.join(dir, 'p.tar.gz');
    execFileSync('tar', ['czf', file, '-C', dir, 'dspatch-host']);
    const bytes = fs.readFileSync(file);
    return { file: 'p.tar.gz', bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  it('reports the installed compatibility metadata without starting a host', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-probe-installed-'));
    const metadata = { hostId: '1.0-other', appVersion: '1.0', commit: 'other', protocol: 1, contract: 'same' };
    const top = path.join(home, '.local', 'share', 'dspatch', 'host', 'versions', metadata.hostId, 'dspatch-host');
    try {
      fs.mkdirSync(top, { recursive: true });
      fs.writeFileSync(path.join(top, 'manifest.json'), JSON.stringify(metadata, null, 2));
      const facts = readLines(run(home, probe('posix')));
      assert.deepEqual(facts.get('version'), [metadata.hostId]);
      assert.deepEqual(JSON.parse(facts.get('installed')?.[0] ?? '{}'), metadata);
      assert.equal(installedHostToStart({ ...metadata, commit: 'client' }, facts), metadata.hostId);
      assert.equal(facts.get('running'), undefined);
      assert.equal(fs.existsSync(path.join(home, '.config', 'DSpatch', 'host-claim.json')), false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('installs into a version folder, starts it and reads it back', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-steps-'));
    const made = packageIn(fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-package-')));
    assert.equal(readLines(run(home, probe('posix'))).get('version'), undefined);
    run(home, receive('posix', made.file), made.bytes);
    assert.equal(readLines(run(home, install('posix', made.file, made.sha256, '1.0-abc'))).get('installed')?.[0], 'yes');
    assert.deepEqual(readLines(run(home, probe('posix'))).get('version'), ['1.0-abc']);
    assert.equal(readLines(run(home, start('posix', '1.0-abc'))).get('started')?.[0], 'yes');
    const held = readLines(run(home, credentials('posix')));
    assert.equal(held.get('token')?.[0], 'secret-token');
    const pid = (JSON.parse(held.get('running')?.[0] ?? '{}') as { pid: number }).pid;
    assert.ok(readLines(run(home, probe('posix'))).get('running') !== undefined);
    process.kill(pid);
  });

  it('takes a prerelease from its own tag, never from latest', () => {
    assert.equal(releaseUrl('0.1.1-rc.1', 'host.tar.gz'), 'https://github.com/nizlas/DSpatch/releases/download/v0.1.1-rc.1/host.tar.gz');
  });

  it('refuses a package that does not match, and leaves the versions alone', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-steps-'));
    const made = packageIn(fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-package-')));
    run(home, receive('posix', made.file), made.bytes);
    assert.equal(readLines(run(home, install('posix', made.file, '0'.repeat(64), '1.0-abc'))).get('failed')?.[0], 'checksum');
    assert.equal(readLines(run(home, probe('posix'))).get('version'), undefined);
  });

  it('clears what an interrupted attempt left, and never touches a whole version', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-steps-'));
    const versions = path.join(home, '.local', 'share', 'dspatch', 'host', 'versions');
    fs.mkdirSync(path.join(versions, '.tmp-old', 'dspatch-host'), { recursive: true });
    fs.mkdirSync(path.join(versions, '0.9-old', 'dspatch-host'), { recursive: true });
    fs.writeFileSync(path.join(versions, '0.9-old', 'dspatch-host', 'manifest.json'), '{}');
    const made = packageIn(fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-package-')));
    run(home, receive('posix', made.file), made.bytes);
    run(home, install('posix', made.file, made.sha256, '1.0-abc'));
    assert.deepEqual(fs.readdirSync(versions).sort(), ['0.9-old', '1.0-abc']);
  });
});

describe('one work context on the machine (DSP-161)', { skip: POSIX_STEPS_HERE }, () => {
  const run = (home: string, step: { readonly stdin?: string }): ReadonlyMap<string, readonly string[]> =>
    readLines(execFileSync('sh', ['-s'], { input: step.stdin, env: { PATH: process.env['PATH'], HOME: home }, encoding: 'utf8' }));
  const live = spawn('sleep', ['30'], { stdio: 'ignore' });
  after(() => live.kill());

  it('looks for a host in the application folder, then where an older one kept its data', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const older = path.join(home, '.local', 'share', 'dspatch-host');
    fs.mkdirSync(older, { recursive: true });
    fs.writeFileSync(path.join(older, 'host-running.json'), JSON.stringify({ pid: live.pid, identity: processIdentity(live.pid ?? 0), port: 7, commit: 'old' }, null, 2));
    fs.writeFileSync(path.join(older, 'remote-token'), 'older-token\n');
    assert.match(run(home, probe('posix')).get('running')?.[0] ?? '', /"port": 7/);
    assert.equal(run(home, credentials('posix')).get('token')?.[0], 'older-token');
    const shared = path.join(home, '.config', 'DSpatch');
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, 'host-running.json'), JSON.stringify({ pid: live.pid, identity: processIdentity(live.pid ?? 0), port: 8, commit: 'new' }, null, 2));
    fs.writeFileSync(path.join(shared, 'remote-token'), 'shared-token\n');
    assert.match(run(home, probe('posix')).get('running')?.[0] ?? '', /"port": 8/);
    assert.equal(run(home, credentials('posix')).get('token')?.[0], 'shared-token');
  });

  it('sees an application open there only while its claim is alive, and it is DSpatch', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const shared = path.join(home, '.config', 'DSpatch');
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, 'host-claim.json'), JSON.stringify({ pid: live.pid, kind: 'desktop' }, null, 2));
    // A live process that is not DSpatch: a reused id after a restart.
    assert.equal(run(home, probe('posix')).get('desktop'), undefined);
  });

  it('takes no other process at a recorded id for the host, and Replace leaves it alone (DSP-164)', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const shared = path.join(home, '.config', 'DSpatch');
    fs.mkdirSync(shared, { recursive: true });
    // The id is alive, but it is not the process that wrote the record: an earlier boot's host.
    fs.writeFileSync(path.join(shared, 'host-running.json'), JSON.stringify({ pid: live.pid, identity: 'an-earlier-boot:1', port: 9, commit: 'old' }, null, 2));
    assert.equal(run(home, probe('posix')).get('running'), undefined);
    // An older host's record names no identity: only a process running a host matches it.
    fs.writeFileSync(path.join(shared, 'host-running.json'), JSON.stringify({ pid: live.pid, port: 9, commit: 'old' }, null, 2));
    assert.equal(run(home, probe('posix')).get('running'), undefined);
    for (const identity of ['an-earlier-boot:1', undefined]) {
      assert.deepEqual(run(home, stop('posix', { pid: live.pid ?? 0, ...(identity === undefined ? {} : { identity }) })).get('failed'), ['unverified']);
      assert.equal(live.exitCode, null, 'the process at that id was signalled');
    }
  });

  it('asks for a handover and reads the answer the application writes', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const shared = path.join(home, '.config', 'DSpatch');
    fs.mkdirSync(shared, { recursive: true });
    const answering = spawn('sh', ['-c', `until [ -f "${shared}/handover-request.json" ]; do sleep 0.1; done; echo '{"nonce":"n","answer":"busy","detail":"A turn."}' > "${shared}/handover-answer.json"`]);
    const heard = readLines(execFileSync('sh', ['-s'], { input: handover('posix', 'n').stdin, env: { PATH: process.env['PATH'], HOME: home }, encoding: 'utf8' }));
    answering.kill();
    assert.equal(JSON.parse(heard.get('answer')?.[0] ?? '').answer, 'busy');
    assert.equal(fs.existsSync(path.join(shared, 'handover-answer.json')), false);
  });

  it('hands the older folder to the host it starts', () => {
    assert.match(start('posix', '1-a').stdin ?? '', /--older-data "\$older"/);
  });
});

/**
 * The Windows host's steps, run here by Windows PowerShell over a folder of the test's own (DSP-164):
 * a record or claim counts only while its process holds the pipe it named, and Stop signals nothing
 * it cannot confirm.
 */
describe('the Windows steps, run by PowerShell', { skip: process.platform === 'win32' ? false : 'the Windows host steps need Windows PowerShell' }, () => {
  const run = (home: string, step: { readonly command: string }): ReadonlyMap<string, readonly string[]> => {
    const encoded = step.command.split(' ').at(-1) ?? '';
    return readLines(
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        env: { ...process.env, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local') },
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
  };
  const moduleUrl = new URL('../src/main/host-data.ts', import.meta.url).href;
  const resolver = new URL('../scripts/ts-resolve.mjs', import.meta.url).href;
  /** A process that holds a pipe identity, as a host does, and says what it is. */
  const holder = async (): Promise<{ readonly child: ReturnType<typeof spawn>; readonly identity: string }> => {
    const child = spawn(process.execPath, ['--import', resolver, '--input-type=module', '-e', `
      import { ownIdentity } from ${JSON.stringify(moduleUrl)};
      process.send(ownIdentity());
      setInterval(() => undefined, 1000);
    `], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const identity = await new Promise<string>((resolve) => child.once('message', (message) => resolve(String(message))));
    return { child, identity };
  };
  const ended = (child: ReturnType<typeof spawn>): Promise<void> =>
    child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', () => resolve()));
  const record = (home: string, file: string, value: object): void => {
    const shared = path.join(home, 'Roaming', 'DSpatch');
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, file), JSON.stringify(value, null, 2));
  };

  it('a record whose id is now another process is no host, and Stop leaves that process alone', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' });
    try {
      const pid = bystander.pid ?? 0;
      for (const identity of [`pipe:dspatch-host-${'e'.repeat(32)}`, undefined]) {
        record(home, 'host-running.json', { pid, ...(identity === undefined ? {} : { identity }), port: 9, commit: 'old' });
        assert.equal(run(home, probe('windows')).get('running'), undefined, String(identity));
        assert.deepEqual(run(home, stop('windows', { pid, ...(identity === undefined ? {} : { identity }) })).get('failed'), ['unverified']);
        assert.equal(bystander.exitCode, null, 'the process at that id was stopped');
      }
    } finally {
      bystander.kill();
      await ended(bystander);
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('a host that holds its identity is found, and Replace stops it', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const { child, identity } = await holder();
    try {
      assert.match(identity, /^pipe:dspatch-host-[0-9a-f]{32}$/);
      record(home, 'host-running.json', { pid: child.pid, identity, port: 10, commit: 'old' });
      assert.match(run(home, probe('windows')).get('running')?.[0] ?? '', /"port": 10/);
      assert.deepEqual(run(home, stop('windows', { pid: child.pid ?? 0, identity })).get('stopped'), ['yes']);
      await ended(child);
      assert.equal(run(home, probe('windows')).get('running'), undefined);
    } finally {
      child.kill();
      await ended(child);
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  /**
   * DSP-165.1. The start a client sends, with an installed version whose launcher runs a stand-in:
   * one that waits, then starts the real host, or one that fails. cmd's `>>` cannot open a file
   * another start's cmd holds, so before the host logged itself, every start but one ended before
   * its host ran; and a failed start was reported after three minutes with nothing said.
   */
  const installed = (home: string, body: string): string => {
    const top = path.join(home, 'Local', 'DSpatch', 'host', 'versions', 'test-1', 'dspatch-host');
    fs.mkdirSync(top, { recursive: true });
    fs.writeFileSync(path.join(top, 'manifest.json'), '{"hostId":"test-1"}');
    fs.writeFileSync(path.join(top, 'stub.js'), body);
    fs.writeFileSync(path.join(top, 'dspatch-host.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0stub.js" %*\r\n`);
    return top;
  };
  const runAsync = async (home: string, step: { readonly command: string }): Promise<ReadonlyMap<string, readonly string[]>> => {
    const encoded = step.command.split(' ').at(-1) ?? '';
    const out = await promisify(execFile)('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      env: { ...process.env, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local') },
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
    });
    return readLines(out.stdout);
  };
  const realHost = fileURLToPath(new URL('../dist/host/remote-host.js', import.meta.url));

  it('starts at once reach one host, and each start reached its host program and logged', { timeout: 120_000 }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const top = installed(
      home,
      `require('fs').appendFileSync(require('path').join(__dirname, 'args.txt'), JSON.stringify(process.argv.slice(2)) + '\\n'); setTimeout(() => require(${JSON.stringify(realHost)}), 3000);\n`,
    );
    let pid = 0;
    try {
      const answers = await Promise.all([1, 2, 3].map(() => runAsync(home, start('windows', 'test-1'))));
      assert.deepEqual(answers.map((one) => one.get('started')), [['yes'], ['yes'], ['yes']]);
      const running = JSON.parse(run(home, probe('windows')).get('running')?.[0] ?? '{}') as { pid: number; identity: string };
      pid = running.pid;
      const shared = path.join(home, 'Roaming', 'DSpatch');
      const reached = fs.readFileSync(path.join(top, 'args.txt'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as string[]);
      assert.equal(reached.length, 3, 'a start ended before its host ran');
      assert.deepEqual(reached[0], ['--port', '0', '--data', shared, '--older-data', path.join(home, 'Local', 'dspatch-host'), '--log', path.join(shared, 'host.log')]);
      const log = fs.readFileSync(path.join(shared, 'host.log'), 'utf8');
      assert.equal(log.match(/already runs over this data folder/g)?.length, 2);
      assert.equal(log.match(/serving pid=/g)?.length, 1);
      assert.deepEqual(run(home, stop('windows', running)).get('stopped'), ['yes']);
    } finally {
      try {
        process.kill(pid);
      } catch {
        // Stopped.
      }
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  it('a host that fails at its start is reported within seconds, with what it said', { timeout: 60_000 }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    installed(home, "console.error('a remote start that fails'); process.exit(1);\n");
    try {
      const started = Date.now();
      const answer = await runAsync(home, start('windows', 'test-1'));
      assert.deepEqual(answer.get('failed'), ['start']);
      assert.ok(Date.now() - started < 20_000, `reported after ${String(Date.now() - started)} ms`);
      assert.ok((answer.get('log') ?? []).some((line) => line.includes('a remote start that fails')), JSON.stringify(answer.get('log')));
    } finally {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  it('sees an application open there only while the process that claimed it holds its identity', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const { child, identity } = await holder();
    try {
      record(home, 'host-claim.json', { pid: child.pid, kind: 'desktop', identity });
      assert.deepEqual(run(home, probe('windows')).get('desktop'), ['open']);
      record(home, 'host-claim.json', { pid: child.pid, kind: 'desktop', identity: `pipe:dspatch-host-${'f'.repeat(32)}` });
      assert.equal(run(home, probe('windows')).get('desktop'), undefined);
    } finally {
      child.kill();
      await ended(child);
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('where a host package comes from', () => {
  const manifestFor = (file: string, sha256: string): HostManifest => ({
    hostId: '1-a',
    appVersion: '1',
    commit: 'a',
    packages: [{ platform: 'linux', arch: 'x64', file, sha256, size: 1 }],
  });

  it('takes a local file only if it matches the build, and says so when none does', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'packages-'));
    fs.writeFileSync(path.join(folder, 'p.tar.gz'), 'real');
    const sha256 = createHash('sha256').update('real').digest('hex');
    const common = { platform: 'linux', arch: 'x64', folders: [folder], cacheDir: folder, status: () => undefined, fetchFile: () => Promise.reject(new Error('offline')) };
    const found = await findHostPackage({ ...common, manifest: manifestFor('p.tar.gz', sha256) });
    assert.equal(typeof found === 'string' ? found : found.path, path.join(folder, 'p.tar.gz'));
    assert.match(String(await findHostPackage({ ...common, manifest: manifestFor('p.tar.gz', '0') })), /could not be downloaded/);
    assert.match(String(await findHostPackage({ ...common, manifest: null })), /built without host packages/);
    assert.match(String(await findHostPackage({ ...common, arch: 'arm64', manifest: manifestFor('p.tar.gz', sha256) })), /no host package/);
  });

  it('checks what it fetched before keeping it', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'packages-'));
    const sha256 = createHash('sha256').update('real').digest('hex');
    const common = { platform: 'linux', arch: 'x64', folders: [], cacheDir: folder, status: () => undefined, manifest: manifestFor('p.tar.gz', sha256) };
    assert.match(String(await findHostPackage({ ...common, fetchFile: () => Promise.resolve(Buffer.from('tampered')) })), /does not match/);
    const said: string[] = [];
    const failed = await findHostPackage({ ...common, log: (line) => said.push(line), fetchFile: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) });
    assert.equal(failed, 'The host package could not be downloaded from GitHub. Check the network connection and connect again.');
    assert.match(said.join(' '), /ENOTFOUND/);
    assert.deepEqual(fs.readdirSync(folder), []);
    const fetched = await findHostPackage({ ...common, fetchFile: () => Promise.resolve(Buffer.from('real')) });
    assert.notEqual(typeof fetched, 'string');
  });

  it('reads no manifest as none', () => {
    assert.equal(readHostManifest('/no/such/file'), null);
  });
});
