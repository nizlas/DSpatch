/**
 * The Claude adapter's dispose with a **real local substitute process** (DSP-116).
 *
 * Split from `claude-agent-sdk-adapter.test.ts` because these tests really spawn
 * processes, which makes this file `heavy` in `scripts/run-tests.mjs`. The process
 * is `tests/support/claude-substitute-process.mjs`, started with `process.execPath`:
 * never Claude, never the SDK, no network and no credential.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/claude-agent-sdk-adapter-process.test.ts
 */

import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ClaudeAgentSdkAdapter,
  DISPOSE_BOUND_MS,
  DISPOSE_EXIT_WAIT_MS,
} from '../src/adapter/claude-agent-sdk-adapter.ts';
import type { AgentEvent } from '../src/adapter/types.ts';
import { tempRoot } from './support/fixtures.ts';
import { advanceUntilSettled, ManualTimers } from './support/manual-timers.ts';

/** `promise`, or a failure naming `what` after `ms` of real time. */
async function withinRealTime<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

function workspace(name: string): string {
  const dir = tempRoot(`claude-${name}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  return dir;
}

function startConfig(dir: string) {
  return { provider: 'claude' as const, modelRequested: 'claude-haiku-4-5', workspacePath: dir };
}

/** Every event of the session, in order. */
function collect(adapter: ClaudeAgentSdkAdapter, sessionId: string) {
  const events: AgentEvent[] = [];
  adapter.subscribe(sessionId, (event) => {
    events.push(event);
  });
  return { events };
}

/** A `system`/`init` message in the SDK's shape, for the turn with these options. */
function init(options: Record<string, any>) {
  return {
    type: 'system',
    subtype: 'init',
    session_id: options['sessionId'] ?? options['resume'],
    apiKeySource: 'none',
    claude_code_version: '2.9.0-test',
    cwd: options['cwd'],
    tools: ['Read', 'Glob', 'Grep', 'Edit'],
    model: 'claude-haiku-4-5',
    permissionMode: 'dontAsk',
    mcp_servers: [],
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: 'u-init',
  };
}

// --- DSP-116 with a real local substitute process (never Claude) --------------------

const SUBSTITUTE_SCRIPT = fileURLToPath(new URL('./support/claude-substitute-process.mjs', import.meta.url));

/** The environment for a substitute process: the path and, on Windows, the system root. */
const SUBSTITUTE_ENV = Object.freeze({
  PATH: process.env['PATH'] ?? '',
  ...(process.env['SystemRoot'] === undefined ? {} : { SystemRoot: process.env['SystemRoot'] }),
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A substitute `query()` that starts the substitute script through the adapter's
 * `spawnClaudeCodeProcess` with Node's real spawn, and, like the SDK's abort
 * path, closes the process's stdin when the run is aborted. Its stream stays
 * open until `close()`.
 */
function realProcessSdk(mode: 'ignore-everything' | 'exit-on-stdin-end') {
  const state: { child: ChildProcess | null; ready: Promise<void> | null } = { child: null, ready: null };
  const queryFn = (params: { prompt: AsyncIterable<unknown>; options: Record<string, any> }) => {
    const options = params.options;
    const child: ChildProcess = options['spawnClaudeCodeProcess']({
      command: process.execPath,
      args: [SUBSTITUTE_SCRIPT, mode],
      cwd: options['cwd'],
      env: options['env'],
      signal: new AbortController().signal,
    });
    state.child = child;
    child.stdin?.on('error', () => undefined);
    state.ready = new Promise<void>((resolve) => {
      child.stdout?.once('data', () => resolve());
    });
    options['abortController'].signal.addEventListener('abort', () => child.stdin?.end(), { once: true });
    let markClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      markClosed = resolve;
    });
    const generator = (async function* () {
      for await (const _message of params.prompt) {
        // Read the one-message prompt, as the SDK does.
      }
      yield init(options);
      await closed;
    })();
    return Object.assign(generator, { close: () => markClosed(), interrupt: () => Promise.resolve(undefined) });
  };
  return { queryFn: queryFn as any, state };
}

test('REAL PROCESS: dispose kills a substitute process that ignores stdin EOF and the abort, observes its exit, and the pid is gone', async () => {
  const { queryFn, state } = realProcessSdk('ignore-everything');
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: SUBSTITUTE_ENV, timers });
  let pid: number | undefined;
  try {
    const handle = await adapter.startSession(startConfig(workspace('real-ignore')));
    const seen = collect(adapter, handle.dspatchSessionId);
    await adapter.send(handle.dspatchSessionId, 'Write');
    await withinRealTime(state.ready ?? Promise.reject(new Error('not spawned')), 10_000, 'the substitute to start');
    pid = state.child?.pid;
    assert.equal(typeof pid, 'number');
    const before = seen.events.length;

    const disposing = adapter.dispose();
    // The abort closed stdin and the close ended the stream; the process keeps running.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(processAlive(pid as number), true, 'still running after the abort');
    assert.equal(timers.pending, 1);
    await timers.advance(DISPOSE_EXIT_WAIT_MS);
    await withinRealTime(disposing, 10_000, 'the exit after the kill');

    const [disposal] = adapter.disposals();
    assert.equal(disposal?.pid, pid);
    assert.equal(disposal?.outcome, 'killed-and-exited');
    assert.equal(disposal?.killedBy, 'dispose');
    assert.equal(disposal?.disposeKillSignalSent, true);
    assert.notEqual(disposal?.exitedAtUtc, null);
    assert.equal(processAlive(pid as number), false, 'the pid is gone');
    assert.equal(timers.pending, 0);
    assert.equal(seen.events.length, before, 'nothing emitted after dispose');
  } finally {
    if (pid !== undefined && processAlive(pid)) {
      process.kill(pid);
    }
    await withinRealTime(advanceUntilSettled(timers, adapter.dispose(), DISPOSE_BOUND_MS), 10_000, 'cleanup');
  }
});

test('REAL PROCESS: a substitute process that exits when the abort closes its stdin is not killed, and its exit is recorded', async () => {
  const { queryFn, state } = realProcessSdk('exit-on-stdin-end');
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: SUBSTITUTE_ENV, timers });
  let pid: number | undefined;
  try {
    const handle = await adapter.startSession(startConfig(workspace('real-exit')));
    await adapter.send(handle.dspatchSessionId, 'Write');
    await withinRealTime(state.ready ?? Promise.reject(new Error('not spawned')), 10_000, 'the substitute to start');
    pid = state.child?.pid;
    // No clock is advanced: the exit alone ends the wait.
    await withinRealTime(adapter.dispose(), 10_000, 'the exit after the abort');
    const [disposal] = adapter.disposals();
    assert.equal(disposal?.pid, pid);
    assert.equal(disposal?.outcome, 'exited');
    assert.equal(disposal?.killedBy, null);
    assert.equal(disposal?.exitCode, 0);
    assert.equal(processAlive(pid as number), false);
    assert.equal(timers.pending, 0);
  } finally {
    if (pid !== undefined && processAlive(pid)) {
      process.kill(pid);
    }
    await withinRealTime(advanceUntilSettled(timers, adapter.dispose(), DISPOSE_BOUND_MS), 10_000, 'cleanup');
  }
});
