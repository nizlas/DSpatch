/**
 * A host process for tests: Node's `child_process.fork` in place of Electron's
 * `utilityProcess.fork`, with the same `HostProcess` shape the client's connection
 * takes (DSP-111). Both carry structured-clone values over the local process channel;
 * neither opens anything on a network.
 */

import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { HostProcess } from '../../src/main/host-connection.ts';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The loader that lets Node run the TypeScript sources the way the tests do. */
export const TS_RESOLVE = path.join(appRoot, 'scripts', 'ts-resolve.mjs');

export interface ForkedHost extends HostProcess {
  readonly child: ChildProcess;
  /** Resolves with the exit code once the process has exited. */
  readonly exited: Promise<number | null>;
}

export function forkHost(entry: string, env: Readonly<Record<string, string>>, typescript: boolean): ForkedHost {
  const child = fork(entry, [], {
    // A `file:` URL: on Windows `--import` does not take a bare absolute path.
    execArgv: typescript ? ['--import', pathToFileURL(TS_RESOLVE).href] : [],
    env: { ...process.env, ...env },
    serialization: 'advanced',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4_000);
  });
  // Drained so a chatty host cannot block on a full pipe; kept for a failing test's message.
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout = `${stdout}${chunk.toString('utf8')}`.slice(-20_000);
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
  return {
    child,
    exited,
    post: (message) => {
      child.send(message);
    },
    onMessage: (listener) => {
      child.on('message', listener);
    },
    onExit: (listener) => {
      void exited.then(listener);
    },
    kill: () => {
      child.kill();
    },
    pid: () => child.pid,
    stderrTail: () => stderr,
    toString: () => `stdout:\n${stdout}\nstderr:\n${stderr}`,
  };
}
