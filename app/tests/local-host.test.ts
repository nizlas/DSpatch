import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { claimDataFolder, heldClaim } from '../src/main/host-data.ts';
import { HostConnection, type HostLoss } from '../src/main/host-connection.ts';
import { ensureLocalHost, runningLocalHost, windowsHostStart, type LocalHostOptions } from '../src/main/local-host.ts';
import { RemoteLink, probeHost, type RemoteEndpoint } from '../src/main/remote-link.ts';
import type { ChatSessionInfo, RunStateReport } from '../src/shared/bridge.ts';
import { remoteBuild } from '../src/shared/remote-build.ts';

const execute = promisify(execFile);
const appPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.resolve(appPath, '..', 'tmp');
const noSender = { senderId: null };

function fixture(): { readonly root: string; readonly options: LocalHostOptions } {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'local-host-'));
  return {
    root,
    options: {
      dataDir: path.join(root, 'data'), appPath, bundledRoot: null, packaged: false,
      olderDataDir: path.join(root, 'older'), startTimeoutMs: 15_000,
      env: {
        ...process.env,
        HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'share'),
        DSPATCH_CHAT_RUN: '', DSPATCH_TRIAL_HOST_RUN: 'presentation', DSPATCH_PRESENTATION_DELTA_MS: '50',
      },
    },
  };
}

async function until(ready: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + 12_000;
  while (!(await ready())) {
    assert.ok(Date.now() < end, 'the lifecycle observation completed within its bound');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function clean(root: string, dataDir: string): Promise<void> {
  const claim = heldClaim(dataDir);
  if (claim?.kind === 'standalone') {
    process.kill(claim.pid, 'SIGTERM');
    await until(() => heldClaim(dataDir) === null);
  }
  // On Windows the cmd that ran the host lets go of its log a moment after the host ends.
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function connect(endpoint: RemoteEndpoint): Promise<HostConnection> {
  const connection = new HostConnection({
    spawn: () => new RemoteLink({ endpoint, build: remoteBuild(appPath), log: () => undefined }),
    startTimeoutMs: 5_000, onEvent: () => undefined, onLost: () => undefined, log: () => undefined,
  });
  const started = await connection.start();
  assert.equal(started.ok, true, JSON.stringify(started));
  return connection;
}

async function disconnect(connection: HostConnection | null): Promise<void> {
  await connection?.shutdown('host.shutdown', [noSender, { observeConversationFiles: false }], 1_000);
}

for (const loose of [false, true]) {
test(`a detached local host preserves ${loose ? 'workspace-less' : 'workspace'} work across launcher exit and reconnect`, { timeout: 40_000 }, async () => {
  const { root, options } = fixture();
  let first: HostConnection | null = null;
  let second: HostConnection | null = null;
  try {
    const boot = `import { ensureLocalHost } from ${JSON.stringify(pathToFileURL(path.join(appPath, 'src/main/local-host.ts')).href)}; process.stdout.write(JSON.stringify(await ensureLocalHost(JSON.parse(process.argv[1]))));`;
    const launched = await execute(process.execPath, ['--import', pathToFileURL(path.join(appPath, 'scripts/ts-resolve.mjs')).href, '--input-type=module', '--eval', boot, JSON.stringify(options)], { timeout: 20_000, env: options.env });
    const endpoint = JSON.parse(launched.stdout) as RemoteEndpoint;
    const running = runningLocalHost(options.dataDir);
    assert.ok(running !== null);
    assert.equal(endpoint.host, '127.0.0.1');
    assert.notEqual(running.pid, process.pid);
    assert.equal(heldClaim(options.dataDir)?.kind, 'standalone');
    // POSIX modes; on Windows the folder's own permissions are what keep the token to its user.
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(options.dataDir, 'remote-token')).mode & 0o777, 0o600);
    }
    assert.match((await probeHost({ endpoint: { ...endpoint, token: 'wrong-token' }, build: remoteBuild(appPath), log: () => undefined }, 2_000)) ?? '', /token/);
    const incompatible = { ...remoteBuild(appPath), contract: 'incompatible' };
    assert.notEqual(await probeHost({ endpoint, build: incompatible, log: () => undefined }, 2_000), null);
    assert.equal(runningLocalHost(options.dataDir)?.pid, running.pid, 'a refusal does not stop the owner');
    first = await connect(endpoint);
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(workspace);
    const request = loose ? { kind: 'loose', provider: 'cursor' } : { kind: 'folder', path: workspace, provider: 'cursor' };
    const session = await first.call<ChatSessionInfo>('chat.startSession', noSender, request);
    const prompt = 'standalone-continuity-sentinel';
    await first.call('chat.sendPrompt', noSender, prompt, []);
    assert.notEqual(await first.call('host.busy', noSender), null, 'the simulated turn is in flight');
    await disconnect(first);
    first = null;
    assert.equal(runningLocalHost(options.dataDir)?.pid, running.pid);
    assert.deepEqual(await ensureLocalHost(options), endpoint, 'an ordinary second start discovers the owner');
    second = await connect(endpoint);
    const attached = await second.call<ChatSessionInfo>('chat.startSession', noSender, request);
    assert.equal(attached.conversationId, session.conversationId);
    assert.equal(attached.dspatchSessionId, session.dspatchSessionId);
    assert.equal(attached.running?.prompt, prompt, 'the new client attaches to the running turn');
    await until(async () => await second?.call('host.busy', noSender) === null);
    const state = await second.call<RunStateReport>('chat.runState', noSender);
    assert.equal(state.attempts.length, 1, 'reconnecting starts no second attempt');
    assert.equal(state.unresolved.length, 0, 'work completes without its first client');
    const located = await second.call<{ filePath: string }>('conversations.locate', noSender, session.conversationId);
    assert.ok(fs.readFileSync(located.filePath, 'utf8').includes(prompt), 'the host persisted the conversation');
    assert.equal(second.pid(), running.pid);
    await disconnect(second);
    second = null;
    assert.equal(runningLocalHost(options.dataDir)?.pid, running.pid);
    await assert.rejects(execute(process.execPath, [path.join(appPath, 'dist/host/remote-host.js'), '--data', options.dataDir, '--port', '0'], { env: options.env, timeout: 10_000 }), (error: unknown) => {
      assert.equal((error as { code: number }).code, 3);
      return true;
    });
    assert.deepEqual(await ensureLocalHost(options), endpoint, 'the losing starter leaves the token and owner intact');
  } finally {
    await disconnect(first);
    await disconnect(second);
    await clean(root, options.dataDir);
  }
});
}

test('an older desktop owner is refused without ending it or launching a second writer', async () => {
  const { root, options } = fixture();
  const claim = claimDataFolder(options.dataDir, 'desktop');
  assert.ok('release' in claim);
  try {
    await assert.rejects(ensureLocalHost(options), /DSpatch is open.*Close it/);
    assert.equal(heldClaim(options.dataDir)?.pid, process.pid);
    assert.equal(fs.existsSync(path.join(options.dataDir, 'host-running.json')), false);
  } finally {
    claim.release();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('starters at once get one host between them, and none of them reports a failure (DSP-164)', { timeout: 60_000 }, async () => {
  const { root, options } = fixture();
  try {
    const boot = `import { ensureLocalHost } from ${JSON.stringify(pathToFileURL(path.join(appPath, 'src/main/local-host.ts')).href)}; process.stdout.write(JSON.stringify(await ensureLocalHost(JSON.parse(process.argv[1]))));`;
    const started = await Promise.all(
      Array.from({ length: 5 }, () =>
        execute(process.execPath, ['--import', pathToFileURL(path.join(appPath, 'scripts/ts-resolve.mjs')).href, '--input-type=module', '--eval', boot, JSON.stringify(options)], { timeout: 40_000, env: options.env }),
      ),
    );
    const endpoints = started.map((one) => JSON.parse(one.stdout) as RemoteEndpoint);
    assert.equal(new Set(endpoints.map((endpoint) => endpoint.port)).size, 1, 'every starter has the one host');
    const owner = heldClaim(options.dataDir);
    assert.equal(owner?.kind, 'standalone');
    assert.equal(runningLocalHost(options.dataDir)?.pid, owner?.pid);
  } finally {
    await clean(root, options.dataDir);
  }
});

/**
 * DSP-165.1. A client started with a DevTools port, which starts a child and ends. Started by Node,
 * the child inherits the client's listening socket and the port stays taken until the child ends;
 * started as `windowsHostStart` starts the host, the port is free while the child lives on.
 */
test("on Windows the host starts holding none of the client's DevTools port", { timeout: 60_000, skip: process.platform === 'win32' ? false : 'a Windows start' }, async () => {
  const electron = path.join(appPath, 'node_modules', 'electron', 'dist', 'electron.exe');
  const client = path.join(appPath, 'tests', 'support', 'devtools-client.cjs');
  const listening = async (port: number): Promise<boolean> =>
    (await execute('netstat', ['-ano', '-p', 'TCP'])).stdout.split(/\r?\n/).some((line) => line.includes(`127.0.0.1:${String(port)} `) && line.includes('LISTENING'));
  const results: Record<string, { held: boolean; childAlive: boolean }> = {};
  for (const [mode, port] of [['spawn', 9471], ['shell', 9472]] as const) {
    // The shell start in a folder whose name cmd and PowerShell would act on (DSP-165.1).
    const out = fs.mkdtempSync(path.join(scratch, mode === 'shell' ? 'devtools 100% a&b ^!(x) åäö-' : `devtools-${mode}-`));
    let childPid = 0;
    try {
      await execute(electron, [client, `--remote-debugging-port=${String(port)}`, `--user-data-dir=${path.join(out, 'profile')}`, mode, out], { timeout: 30_000 });
      await until(() => fs.existsSync(path.join(out, 'child.json')));
      childPid = (JSON.parse(fs.readFileSync(path.join(out, 'child.json'), 'utf8')) as { pid: number }).pid;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      let childAlive = true;
      try {
        process.kill(childPid, 0);
      } catch {
        childAlive = false;
      }
      results[mode] = { held: await listening(port), childAlive };
    } finally {
      try {
        process.kill(childPid);
      } catch {
        // Already gone.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      fs.rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
  // The control: Node's start passes the socket on, which is what the fix is for.
  assert.deepEqual(results['spawn'], { held: true, childAlive: true });
  assert.deepEqual(results['shell'], { held: false, childAlive: true });
});

/**
 * DSP-165.1. Paths and arguments reach the host as data through the whole start: PowerShell,
 * Start-Process, cmd and the program's own reading of its command line. Folder names with the
 * characters cmd and PowerShell would otherwise act on, and an argument ending in a backslash.
 */
test('on Windows the host is started with its paths and arguments exactly as given', { timeout: 60_000, skip: process.platform === 'win32' ? false : 'a Windows start' }, async () => {
  const names = ['with space', '100%', '%PATH%', 'a&b', 'x^y', 'bang!', "it's", '(p)', '[b]', 'semi;comma,eq=', 'åäö'];
  const root = fs.mkdtempSync(path.join(scratch, 'special-'));
  try {
    const where = path.join(root, names.join(' '));
    fs.mkdirSync(where, { recursive: true });
    const entry = path.join(where, 'child.js');
    fs.writeFileSync(
      entry,
      "require('fs').writeFileSync(require('path').join(__dirname, 'child.json'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })); console.log('logged from the child');\n",
    );
    const args = [entry, '--data', path.join(where, 'data'), '--older-data', `${where}\\`, '--port', '0', ...names];
    const logFile = path.join(where, 'host.log');
    const start = windowsHostStart(process.execPath, args, logFile, where);
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(start.script, 'utf16le').toString('base64')], {
      env: { ...process.env, ...start.env },
      timeout: 30_000,
    });
    await until(() => fs.existsSync(path.join(where, 'child.json')) && fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('logged'));
    const seen = JSON.parse(fs.readFileSync(path.join(where, 'child.json'), 'utf8')) as { argv: string[]; cwd: string };
    assert.deepEqual(seen.argv, args.slice(1));
    assert.equal(path.resolve(seen.cwd), path.resolve(where));
    assert.match(fs.readFileSync(logFile, 'utf8'), /logged from the child/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('a value no Windows path can hold is refused, not started another way', () => {
  assert.throws(() => windowsHostStart('C:\\node.exe', ['a"b'], 'C:\\log', 'C:\\'), /cannot hold a double quote/);
});

/**
 * DSP-165.1. A host program that waits before it starts the real one, or that fails, in an
 * application folder of its own: what a start does with a slow host, a failing one, and one slower
 * than the start's bound, alone and several at once.
 */
function stubbedApp(root: string, body: string): LocalHostOptions {
  const stub = path.join(root, 'stub-app');
  fs.mkdirSync(path.join(stub, 'dist', 'host'), { recursive: true });
  fs.copyFileSync(path.join(appPath, 'package.json'), path.join(stub, 'package.json'));
  fs.writeFileSync(path.join(stub, 'dist', 'host', 'remote-host.js'), body);
  return { ...fixture().options, dataDir: path.join(root, 'data'), olderDataDir: path.join(root, 'older'), appPath: stub };
}
const realHost = path.join(appPath, 'dist', 'host', 'remote-host.js');
const delayed = (ms: number): string => `setTimeout(() => require(${JSON.stringify(realHost)}), ${String(ms)});\n`;

test('starters at once with a slow host all get that host, and none reports a failure (DSP-165.1)', { timeout: 60_000 }, async () => {
  const root = fs.mkdtempSync(path.join(scratch, 'slow-together-'));
  const options = { ...stubbedApp(root, delayed(3_000)), startTimeoutMs: 20_000 };
  try {
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => ensureLocalHost(options)));
    assert.deepEqual(outcomes.map((one) => one.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'], JSON.stringify(outcomes));
    const ports = new Set(outcomes.map((one) => (one as PromiseFulfilledResult<RemoteEndpoint>).value.port));
    assert.equal(ports.size, 1);
    assert.equal(heldClaim(options.dataDir)?.kind, 'standalone');
  } finally {
    await clean(root, options.dataDir);
  }
});

test('a start slower than its bound is stopped, and no host takes the folder after it was reported (DSP-165.1)', { timeout: 60_000 }, async () => {
  const root = fs.mkdtempSync(path.join(scratch, 'slow-bound-'));
  const options = { ...stubbedApp(root, delayed(8_000)), startTimeoutMs: 2_000 };
  try {
    const outcomes = await Promise.allSettled([ensureLocalHost(options), ensureLocalHost(options)]);
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'rejected');
      assert.match(String((outcome as PromiseRejectedResult).reason), /did not become ready within 2 s, so that start was stopped/);
    }
    // Past the moment the stopped hosts would have started.
    await new Promise((resolve) => setTimeout(resolve, 9_000));
    assert.equal(heldClaim(options.dataDir), null);
    assert.equal(runningLocalHost(options.dataDir), null);
  } finally {
    await clean(root, options.dataDir);
  }
});

test('a host that fails at its start is reported, with where to read what it said (DSP-165.1)', { timeout: 60_000 }, async () => {
  const root = fs.mkdtempSync(path.join(scratch, 'failing-'));
  const options = { ...stubbedApp(root, "console.error('a start that fails'); process.exit(1);\n"), startTimeoutMs: 20_000 };
  try {
    const started = Date.now();
    const failure = await ensureLocalHost(options).then(() => null, (error: unknown) => String(error));
    assert.ok(failure !== null);
    assert.ok(Date.now() - started < 10_000, 'a failed start is reported well within its bound');
    const named = /See (.+?\.log)/.exec(failure)?.[1] ?? '';
    assert.match(fs.readFileSync(named, 'utf8'), /a start that fails/, failure);
    assert.equal(heldClaim(options.dataDir), null);
  } finally {
    await clean(root, options.dataDir);
  }
});

for (const restart of [false, true]) {
test(`a live desktop detects a dead local host ${restart ? 'and rediscovers its changed port' : 'without starting a replacement'}`, { timeout: 35_000 }, async () => {
  const { root, options } = fixture();
  const occupied = net.createServer((socket) => socket.destroy());
  let link: RemoteLink | null = null;
  let connection: HostConnection | null = null;
  let loss: HostLoss | null = null;
  let promptId: number | null = null;
  let promptPosts = 0;
  let disconnected = false;
  try {
    const endpoint = await ensureLocalHost(options);
    const original = runningLocalHost(options.dataDir);
    assert.ok(original !== null);
    link = new RemoteLink({
      endpoint, build: remoteBuild(appPath), log: () => undefined,
      retryMaxMs: 100, rediscoveryTimeoutMs: 5_000,
      rediscoverEndpoint: () => runningLocalHost(options.dataDir)?.endpoint ?? null,
    });
    const receive = link.onMessage.bind(link);
    link.onMessage = (listener) => receive((message) => {
      const answer = message as { t?: string; id?: number };
      if (answer.t !== 'result' || answer.id !== promptId) {
        listener(message);
      }
    });
    const post = link.post.bind(link);
    link.post = (message) => {
      if (message.t === 'call' && message.method === 'chat.sendPrompt') {
        promptId = message.id;
        promptPosts += 1;
      }
      post(message);
    };
    connection = new HostConnection({
      spawn: () => { assert.ok(link !== null); return link; },
      startTimeoutMs: 5_000, onEvent: () => undefined, log: () => undefined,
      onLost: (value) => { loss = value; },
      onLink: (event) => { if (event.kind === 'disconnected') { disconnected = true; } },
    });
    assert.equal((await connection.start()).ok, true);
    const request = { kind: 'loose', provider: 'cursor' };
    const session = await connection.call<ChatSessionInfo>('chat.startSession', noSender, request);
    const unanswered = connection.answer('chat.sendPrompt', noSender, 'restart-no-replay-sentinel', []);
    await until(async () => await connection?.call('host.busy', noSender) !== null);
    process.kill(original.pid, 'SIGKILL');
    await until(() => heldClaim(options.dataDir) === null && disconnected);
    assert.equal(runningLocalHost(options.dataDir), null, 'stale readiness is not a live host');
    assert.deepEqual(await connection.answer('chat.sendPrompt', noSender, 'must-not-send', []), {
      kind: 'host-error', code: 'host-unavailable',
      message: 'The connection to the host is lost, so "chat.sendPrompt" was not sent.',
    });
    if (restart) {
      await new Promise<void>((resolve, reject) => {
        occupied.once('error', reject);
        occupied.listen(endpoint.port, '127.0.0.1', resolve);
      });
      const replacement = await ensureLocalHost(options);
      assert.notEqual(replacement.port, endpoint.port);
      assert.notEqual(runningLocalHost(options.dataDir)?.pid, original.pid);
    }
    await until(() => loss !== null);
    assert.deepEqual((loss as unknown as HostLoss).unanswered, ['chat.sendPrompt']);
    assert.equal(connection.state(), 'lost');
    assert.match(JSON.stringify(await unanswered), /host-lost.*unknown.*nothing was sent again/);
    assert.equal(promptPosts, 1, 'neither rediscovery nor failure replays the unanswered command');
    if (restart) {
      const replacement = runningLocalHost(options.dataDir);
      assert.ok(replacement !== null);
      link = new RemoteLink({
        endpoint: replacement.endpoint, build: remoteBuild(appPath), log: () => undefined,
        rediscoverEndpoint: () => runningLocalHost(options.dataDir)?.endpoint ?? null,
      });
      assert.equal((await connection.start()).ok, true, 'the same desktop connection can explicitly attach again');
      await connection.call('chat.resumeConversation', noSender, session.conversationId);
      const state = await connection.call<RunStateReport>('chat.runState', noSender);
      assert.equal(state.attempts.length, 1);
      assert.equal(state.unresolved.length, 1, 'the interrupted turn remains unknown');
      assert.equal(await connection.call('host.busy', noSender), null, 'reading saved work starts no turn');
    } else {
      assert.equal(heldClaim(options.dataDir), null, 'rediscovery never starts a host');
    }
  } finally {
    link?.kill();
    await disconnect(connection);
    if (occupied.listening) {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
    await clean(root, options.dataDir);
  }
});
}

// The archive is built here in the Linux layout (`node/bin/node`, links into this checkout), and
// only Linux packages carry a bundled host; a Windows package would need its own fixture.
test('a bundled host archive is verified and installed before its standalone runtime starts', { timeout: 40_000, skip: process.platform === 'win32' ? 'the bundled host is published for Linux only' : false }, async () => {
  const { root, options } = fixture();
  const bundledRoot = path.join(root, 'bundled');
  const top = path.join(root, 'stage', 'dspatch-host');
  let connection: HostConnection | null = null;
  try {
    fs.mkdirSync(path.join(top, 'app'), { recursive: true });
    fs.mkdirSync(path.join(top, 'node', 'bin'), { recursive: true });
    fs.cpSync(path.join(appPath, 'dist'), path.join(top, 'app', 'dist'), { recursive: true });
    fs.copyFileSync(path.join(appPath, 'package.json'), path.join(top, 'app', 'package.json'));
    fs.symlinkSync(path.join(appPath, 'node_modules'), path.join(top, 'app', 'node_modules'), 'dir');
    fs.symlinkSync(process.execPath, path.join(top, 'node', 'bin', 'node'));
    fs.writeFileSync(path.join(top, 'manifest.json'), JSON.stringify({ hostId: 'test-host' }));
    fs.mkdirSync(path.join(bundledRoot, 'host-packages'), { recursive: true });
    const file = 'host.tar.gz';
    const archive = path.join(bundledRoot, 'host-packages', file);
    await execute('tar', ['-czf', archive, '-C', path.join(root, 'stage'), 'dspatch-host'], { timeout: 10_000 });
    const sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    const manifestFile = path.join(bundledRoot, 'host-manifest.json');
    const manifest = { hostId: 'test-host', appVersion: 'test', commit: 'test', packages: [{ platform: process.platform, arch: process.arch, file, sha256, size: fs.statSync(archive).size }] };
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, packages: [{ ...manifest.packages[0], sha256: '0'.repeat(64) }] }));
    await assert.rejects(ensureLocalHost({ ...options, packaged: true, bundledRoot }), /does not match/);
    assert.equal(heldClaim(options.dataDir), null);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const installedOptions = { ...options, appPath: path.join(root, 'resources', 'app.asar'), packaged: true, bundledRoot };
    const endpoint = await ensureLocalHost(installedOptions);
    connection = await connect(endpoint);
    assert.equal(await connection.call('host.busy', noSender), null);
    assert.equal(fs.readdirSync(path.join(options.dataDir, 'host-installations')).filter((name) => !name.startsWith('.')).length, 1);
    assert.deepEqual(await ensureLocalHost(installedOptions), endpoint);
  } finally {
    await disconnect(connection);
    await clean(root, options.dataDir);
  }
});

test('a packaged installation missing its host never falls back to a desktop-owned utility process', async () => {
  const { root, options } = fixture();
  try {
    await assert.rejects(ensureLocalHost({ ...options, packaged: true }), /missing its bundled standalone host/);
    assert.equal(heldClaim(options.dataDir), null);
  } finally {
    await clean(root, options.dataDir);
  }
});