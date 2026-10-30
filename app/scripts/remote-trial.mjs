/**
 * A remote session on one machine, for real (DSP-111): the host as a process of its own with its
 * own data, the client as another with its own, and a forwarder between them that stands where
 * the SSH tunnel stands, so the connection can really be cut. Real windows and real input;
 * a SIMULATED provider behind the real jobs and adapters' paths; a local Git fixture.
 *
 *     node scripts/remote-trial.mjs <kit folder> [--phases remote,remote-again] [--fixture flow] [--delta 150]
 *
 * The forwarder answers on a control port: `/cut`, `/mend`, `/restart-host` and
 * `/restart-host-other-version`, so a scripted window can break things at the moment it needs.
 * It is development tooling: nothing in the product reads it.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

const app = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const kit = path.resolve(args[0] ?? '');
/** @param {string} name @param {string} fallback */
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : (args[at + 1] ?? fallback);
};
const phases = option('phases', 'remote').split(',');
const fixture = option('fixture', 'flow');
const delta = option('delta', '150');

fs.rmSync(kit, { recursive: true, force: true });
fs.mkdirSync(kit, { recursive: true });
const seeded = spawnSync(process.execPath, ['--import', './scripts/ts-resolve.mjs', 'scripts/seed-pair-kit.mjs', kit, '--agent', 'claude', '--model', 'opus', '--fixture', fixture], { cwd: app, encoding: 'utf8' });
if (seeded.status !== 0) {
  throw new Error(`the kit was not seeded: ${seeded.stderr}`);
}
const info = JSON.parse(fs.readFileSync(path.join(kit, 'kit.json'), 'utf8'));
const repository = /** @type {string} */ (fixture === 'routing' ? info.routing : info.shop);
const hostData = path.join(kit, 'userData');
const clientData = path.join(kit, 'clientData');
fs.mkdirSync(clientData, { recursive: true });

/** The environment of a scripted run, without what this shell happened to have. */
/** @param {string} phase @param {string} dir */
function scriptedEnv(phase, dir) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(DSPATCH_|CLAUDE|ANTHROPIC)/i.test(name)) {
      env[name] = value;
    }
  }
  return {
    ...env,
    DSPATCH_CHAT_RUN: 'review-flow',
    DSPATCH_FLOW_PHASE: phase,
    DSPATCH_PRESENTATION_DELTA_MS: delta,
    DSPATCH_PRESENTATION_TOOL_MS: '1100',
    DSPATCH_PRESENTATION_MODELS: 'claude',
    DSPATCH_PRESENTATION_LIST_MS: '300',
    DSPATCH_CLAUDE_AUTHORIZATION: 'SIMULATED trial reference - no credential',
    DSPATCH_CHAT_LOG: path.join(dir, 'record.json'),
    DSPATCH_CHAT_SHOT: path.join(dir, 'shot.png'),
  };
}

/** @type {import('node:child_process').ChildProcess | null} */
let hostChild = null;
let hostPort = 0;
const hostLog = fs.createWriteStream(path.join(kit, 'host.log'), { flags: 'a' });

/** @param {NodeJS.ProcessEnv} env @param {Record<string, string>} [extra] @returns {Promise<void>} */
function startHost(env, extra = {}) {
  return new Promise((resolve, reject) => {
    hostChild = spawn(process.execPath, ['dist/host/remote-host.js', '--port', '0', '--data', hostData], { cwd: app, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    const seen = (/** @type {Buffer} */ chunk) => {
      const text = chunk.toString('utf8');
      hostLog.write(text);
      const match = /on 127\.0\.0\.1:(\d+)/.exec(text);
      if (match !== null) {
        hostPort = Number(match[1]);
        resolve();
      }
    };
    hostChild.stdout?.on('data', seen);
    hostChild.stderr?.on('data', seen);
    hostChild.once('exit', (code) => {
      hostLog.write(`[trial] host exited ${String(code)}\n`);
    });
    setTimeout(() => {
      reject(new Error('the host did not start'));
    }, 30_000).unref();
  });
}

/** @param {NodeJS.Signals} [signal] @returns {Promise<void>} */
function stopHost(signal = 'SIGKILL') {
  return new Promise((resolve) => {
    if (hostChild === null || hostChild.exitCode !== null) {
      resolve();
      return;
    }
    hostChild.once('exit', () => {
      resolve();
    });
    hostChild.kill(signal);
  });
}

// The forwarder: the place of the SSH tunnel.
const sockets = new Set();
let up = true;
const forwarder = net.createServer((inbound) => {
  if (!up) {
    inbound.destroy();
    return;
  }
  const outbound = net.connect({ host: '127.0.0.1', port: hostPort });
  for (const socket of [inbound, outbound]) {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => {
      inbound.destroy();
      outbound.destroy();
      sockets.delete(socket);
    });
  }
  inbound.pipe(outbound);
  outbound.pipe(inbound);
});
await new Promise((resolve) => {
  forwarder.listen(0, '127.0.0.1', () => {
    resolve(null);
  });
});

/** @type {NodeJS.ProcessEnv} */
let phaseEnv = {};
const control = http.createServer((request, response) => {
  void (async () => {
    hostLog.write(`[trial] control ${request.url}\n`);
    if (request.url === '/cut') {
      up = false;
      for (const socket of sockets) {
        socket.destroy();
      }
    } else if (request.url === '/mend') {
      up = true;
    } else if (request.url === '/restart-host') {
      await stopHost();
      await startHost(phaseEnv);
    } else if (request.url === '/restart-host-other-version') {
      await stopHost();
      await startHost(phaseEnv, { DSPATCH_REMOTE_PROTOCOL_FOR_TEST: '999' });
    }
    response.end('ok');
  })();
});
await new Promise((resolve) => {
  control.listen(0, '127.0.0.1', () => {
    resolve(null);
  });
});

/** @param {net.Server | http.Server} server */
const portOf = (server) => /** @type {net.AddressInfo} */ (server.address()).port;
const forwardPort = portOf(forwarder);
const tokenFile = path.join(hostData, 'remote-token');
const electron = path.join(app, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const before = spawnSync('git', ['-C', repository, 'status', '--porcelain=v2', '--untracked-files=all'], { encoding: 'utf8' }).stdout;

for (const phase of phases) {
  const dir = path.join(kit, `run-${phase}`);
  fs.mkdirSync(dir, { recursive: true });
  const env = scriptedEnv(phase, dir);
  phaseEnv = env;
  if (phase === 'remote-version') {
    await stopHost();
    await startHost(env, { DSPATCH_REMOTE_PROTOCOL_FOR_TEST: '999' });
  } else if (/** @type {import('node:child_process').ChildProcess | null} */ (hostChild)?.exitCode !== null) {
    await startHost(env);
  }
  const out = fs.openSync(path.join(dir, 'out.log'), 'w');
  const client = spawn(electron, ['.', `--user-data-dir=${clientData}`], {
    cwd: app,
    env: {
      ...env,
      DSPATCH_CHAT_EXPECT_USERDATA: clientData,
      DSPATCH_REMOTE: `127.0.0.1:${String(forwardPort)}`,
      DSPATCH_REMOTE_TOKEN_FILE: tokenFile,
      DSPATCH_TRIAL_CONTROL: `http://127.0.0.1:${String(portOf(control))}`,
      DSPATCH_CLIENT_FORBIDDEN_ROOT: repository,
    },
    stdio: ['ignore', out, out],
  });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.kill();
      resolve('deadline');
    }, Number(option('deadline', '480000')));
    client.once('exit', (exit) => {
      clearTimeout(timer);
      resolve(exit);
    });
  });
  const log = fs.readFileSync(path.join(dir, 'out.log'), 'utf8');
  process.stdout.write(`phase ${phase}: exit ${String(code)} ${/scripted run finished[^\r\n]*/.exec(log)?.[0] ?? ''}\n`);
  const touched = log.split(/\r?\n/).filter((line) => line.includes('the client touched the project'));
  process.stdout.write(`phase ${phase}: client touches of the project: ${String(touched.length)}${touched.length > 0 ? `\n${touched.slice(0, 5).join('\n')}` : ''}\n`);
}

await stopHost('SIGTERM');
const after = spawnSync('git', ['-C', repository, 'status', '--porcelain=v2', '--untracked-files=all'], { encoding: 'utf8' }).stdout;
process.stdout.write(`repository unchanged: ${String(before === after)}\n`);
process.exit(0);
