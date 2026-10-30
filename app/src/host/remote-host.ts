import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DISPOSE_TIMEOUT_MS } from '../main/dispose-timeout';
import { remoteBuild } from '../shared/remote-build';
import { REMOTE_DEFAULT_PORT } from '../shared/remote-protocol';
import { emitTo, serveHost, type HostMethods } from './host-server';
import { shutdownProjectHost, startProjectHost } from './project-host';
import { RemoteServer } from './remote-server';

/*
 * DSpatch's project host as a program of its own (DSP-111), started by a person on the machine
 * that has the repositories and the agents:
 *
 *     node dist/host/remote-host.js [--port <n>] [--data <folder>] [--print-token]
 *
 * It needs Node and the app's `npm ci`, and no window system. It listens on 127.0.0.1 only: a
 * client on another machine reaches it through an SSH tunnel (`docs/REMOTE_TRIAL.md`). It does
 * not end when a client goes away, unlike the local host; it ends when it is told to (Ctrl+C or
 * SIGTERM), closing its adapters first.
 */

function log(message: string): void {
  process.stdout.write(`[dspatch] [host] ${message}\n`);
}

function defaultDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), 'dspatch-host');
  }
  return path.join(process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share'), 'dspatch-host');
}

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

/** The host's token: made once, readable by this user only, never logged. */
function tokenIn(dataDir: string): { readonly token: string; readonly file: string } {
  const file = path.join(dataDir, 'remote-token');
  try {
    const token = fs.readFileSync(file, 'utf8').trim();
    if (token !== '') {
      return { token, file };
    }
  } catch {
    // None yet.
  }
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return { token, file };
}

async function main(): Promise<void> {
  const dataDir = path.resolve(argument('--data') ?? process.env['DSPATCH_HOST_DATA'] ?? defaultDataDir());
  const { token, file } = tokenIn(dataDir);
  if (process.argv.includes('--print-token')) {
    process.stdout.write(`${token}\n`);
    return;
  }
  const appPath = path.resolve(__dirname, '..', '..');
  const build = remoteBuild(appPath);
  const server = new RemoteServer({ token, build, closeWithinMs: DISPOSE_TIMEOUT_MS, log });
  const methods: Record<string, (...args: never[]) => unknown> = {
    ...startProjectHost({
      config: { userDataDir: dataDir, appVersion: build.appVersion, appPath, clientPid: process.pid },
      emit: (to, channel, payload) => {
        emitTo(server.port, log, to, channel, payload);
      },
    }),
  };
  // A remote client leaving does not end the host, so it never asks for this.
  methods['host.shutdown'] = () => ({ completed: true, detail: 'left the host running', conversationFiles: null });
  serveHost(server.port, methods as HostMethods, log);

  const wanted = Number(argument('--port') ?? process.env['DSPATCH_HOST_PORT'] ?? REMOTE_DEFAULT_PORT);
  let port: number;
  try {
    port = await server.listen(wanted);
  } catch (error) {
    process.stderr.write(
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `Port ${String(wanted)} on this machine is in use, perhaps by a DSpatch host already running. Stop it, or start this one with --port.\n`
        : `The host could not listen on port ${String(wanted)}: ${String(error)}\n`,
    );
    process.exit(2);
  }
  log(`serving pid=${String(process.pid)} on 127.0.0.1:${String(port)}, data in ${dataDir}, ${build.appVersion} at ${build.commit}`);
  log(`the client's token is in ${file}`);

  let closing = false;
  const stop = (signal: string): void => {
    if (closing) {
      return;
    }
    closing = true;
    log(`${signal}: closing the adapters`);
    server.close();
    setTimeout(() => {
      log('the adapters did not close in time; ending anyway');
      process.exit(0);
    }, DISPOSE_TIMEOUT_MS + 1_000).unref();
    void shutdownProjectHost(false).then((outcome) => {
      log(`${outcome.detail}; ending`);
      process.exit(0);
    });
  };
  process.on('SIGINT', () => {
    stop('SIGINT');
  });
  process.on('SIGTERM', () => {
    stop('SIGTERM');
  });
  // A host started in an SSH session must outlive that session: the design's whole point.
  process.on('SIGHUP', () => {
    log('SIGHUP: the terminal went away; going on');
  });
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', () => undefined);
  }
}

void main();
