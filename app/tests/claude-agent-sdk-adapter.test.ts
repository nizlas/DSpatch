/**
 * The Claude Agent SDK adapter and the DSP-109 scenarios, with a substituted
 * `query()`.
 *
 * Nothing here loads the SDK, starts its bundled executable, opens a network
 * connection or holds a credential. The substitute yields messages in the shapes
 * the installed SDK's type definitions give (`sdk.d.ts`, 0.3.306), so what is
 * checked is this adapter's mapping and its refusals — not Claude's behaviour,
 * which only a live run can show.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/claude-agent-sdk-adapter.test.ts
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import {
  assessAuthentication,
  CANCEL_ABORT_WAIT_MS,
  CANCEL_DENY_REASON,
  CANCEL_INTERRUPT_WAIT_MS,
  CANCEL_KILL_WAIT_MS,
  CANCEL_STOP_REASON,
  ClaudeAgentSdkAdapter,
  STDERR_TAIL_BYTES,
  STDERR_TAIL_LABEL,
  FIXTURE_PERMISSIONS,
  providerEnvironment,
  providerSessionIdFor,
} from '../src/adapter/claude-agent-sdk-adapter.ts';
import type { AgentEvent } from '../src/adapter/types.ts';
import {
  CANCEL_REPLY_PROMPT,
  EXIT_AUTHENTICATION_UNVERIFIED,
  EXIT_REFUSED,
  FOLLOW_UP_PROMPT,
  parseScenarioArgs,
  readSourceRevision,
  runScenarioCommand,
  scenarioCancelReply,
  scenarioCancelThenFollowUp,
  scenarioTwoTurn,
} from '../src/main/experiment-work.ts';
import { tempRoot } from './support/fixtures.ts';

// --- A substitute query() ------------------------------------------------------

interface Call {
  /** The text of the prompt's one message, set once the substitute has read the iterable. */
  prompt: string;
  /** Every message the prompt iterable yielded (streaming input). */
  readonly promptMessages: unknown[];
  readonly options: Record<string, any>;
  /** How many times the handle's interrupt() was called. */
  interrupts: number;
  /** Resolves at the first interrupt() call. */
  readonly interrupted: Promise<void>;
  /** Resolves when the handle's close() is called (as `dispose` does). */
  readonly closed: Promise<void>;
  /** The fake process spawned through the adapter's option inside query(), if any. */
  child: any;
  /** Set by a script to keep the process running after the script ends. */
  holdProcess: boolean;
}

type Script = (call: Call, index: number) => AsyncGenerator<unknown, void>;

/**
 * What a substitute's `accountInfo()` does for the query with this index: answer
 * with the object, reject with the error, or (`undefined`) not exist at all.
 */
type AccountScript = (index: number) => Record<string, unknown> | Error | undefined;

/** What the substitute's interrupt() does: resolve with the value, reject with an Error, or be missing. */
type InterruptScript = (index: number) => unknown;
const NO_INTERRUPT = Symbol('no interrupt()');

/** How the substitute treats the process. */
interface FakeProcess {
  /** Spawn through `options.spawnClaudeCodeProcess` inside query(). Default true. */
  readonly spawn?: boolean;
  /** The fake process exits when it is killed. */
  readonly exitOnKill?: boolean;
  /** The spawn fails as for a missing executable (no pid, ENOENT). */
  readonly failSpawn?: boolean;
  /** Extra environment variables the substitute passes when spawning, per query. */
  readonly spawnEnv?: (index: number) => Record<string, string>;
}

/**
 * A substitute `query()`. Like SDK 0.3.306 (sdk.mjs: the transport spawns in the
 * Query's construction unless `deferSpawn`), it spawns synchronously inside
 * query() through the adapter's documented `spawnClaudeCodeProcess`, which in
 * these tests reaches the returned `spawnProcess` — a fake; nothing is started.
 * The fake process exits (code 0) when the script ends, unless the script set
 * `call.holdProcess`. Pass `spawnProcess` to every adapter built on this.
 */
function fakeSdk(
  script: Script,
  account?: AccountScript,
  interrupt?: InterruptScript,
  fake: FakeProcess = {},
) {
  const calls: Call[] = [];
  const spawner = fakeSpawner({
    ...(fake.exitOnKill === true ? { exitOnKill: true } : {}),
    ...(fake.failSpawn === true ? { failSpawn: true } : {}),
  });
  const queryFn = (params: { prompt: AsyncIterable<unknown>; options: Record<string, any> }) => {
    let markInterrupted: () => void = () => undefined;
    let markClosed: () => void = () => undefined;
    const call: Call = {
      prompt: '',
      promptMessages: [],
      options: params.options,
      interrupts: 0,
      interrupted: new Promise<void>((resolve) => {
        markInterrupted = resolve;
      }),
      closed: new Promise<void>((resolve) => {
        markClosed = resolve;
      }),
      child: null,
      holdProcess: false,
    };
    calls.push(call);
    const index = calls.length - 1;
    if (fake.spawn !== false && typeof params.options['spawnClaudeCodeProcess'] === 'function') {
      call.child = spawnVia(call, fake.spawnEnv?.(index) ?? {});
    }
    // Like the SDK, read the streaming-input prompt before the turn's messages.
    const generator = (async function* () {
      try {
        for await (const message of params.prompt) {
          call.promptMessages.push(message);
        }
        const content = (call.promptMessages[0] as { message?: { content?: unknown } } | undefined)
          ?.message?.content;
        call.prompt = typeof content === 'string' ? content : '';
        yield* script(call, index);
      } finally {
        const child = call.child;
        if (
          child !== null &&
          child.pid !== undefined &&
          !call.holdProcess &&
          child.exitCode === null &&
          child.signalCode === null
        ) {
          child.exit(0);
        }
      }
    })();
    const info = account?.(index);
    const behaviour = interrupt === undefined ? { still_queued: [] } : interrupt(index);
    return Object.assign(
      generator,
      { close: () => markClosed() },
      info === undefined
        ? {}
        : { accountInfo: () => (info instanceof Error ? Promise.reject(info) : Promise.resolve(info)) },
      behaviour === NO_INTERRUPT
        ? {}
        : {
            interrupt: () => {
              call.interrupts += 1;
              markInterrupted();
              return behaviour instanceof Error ? Promise.reject(behaviour) : Promise.resolve(behaviour);
            },
          },
    );
  };
  return { queryFn: queryFn as any, calls, spawnProcess: spawner.spawnProcess, spawned: spawner.spawned };
}

// --- A substitute process and clock ------------------------------------------------

/** A stand-in for Node's ChildProcess: nothing is started. */
function fakeChild(options: { exitOnKill?: boolean; failSpawn?: boolean } = {}) {
  const child = new EventEmitter() as any;
  child.pid = options.failSpawn === true ? undefined : 4242;
  if (options.failSpawn === true) {
    // What Node does for a missing executable: no pid, then an `error` event.
    setImmediate(() =>
      child.emit('error', Object.assign(new Error('spawn C:/synthetic/claude-test.exe ENOENT'), { code: 'ENOENT' })),
    );
  }
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kills = [] as string[];
  child.exit = (code: number | null, signal: string | null = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
  };
  child.kill = (signal: string) => {
    child.kills.push(signal);
    child.killed = true;
    if (options.exitOnKill === true) {
      setImmediate(() => child.exit(null, signal));
    }
    return true;
  };
  return child;
}

/** A substitute for Node's spawn that records what it was given and returns fake children. */
function fakeSpawner(options: { exitOnKill?: boolean; failSpawn?: boolean } = {}) {
  const spawned: Array<{ command: string; args: string[]; options: Record<string, any>; child: any }> = [];
  const spawnProcess = (command: string, args: string[], spawnOptions: Record<string, any>) => {
    const child = fakeChild(options);
    spawned.push({ command, args, options: spawnOptions, child });
    return child;
  };
  return { spawnProcess: spawnProcess as any, spawned };
}

/** What the SDK does at query time: start the process through the documented option. */
function spawnVia(call: Call, extraEnv: Record<string, string> = {}) {
  return call.options['spawnClaudeCodeProcess']({
    command: 'C:/synthetic/claude-test.exe',
    args: ['--output-format', 'stream-json', '--input-format', 'stream-json'],
    cwd: call.options['cwd'],
    env: { ...call.options['env'], CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', ...extraEnv },
    signal: new AbortController().signal,
  });
}

/** Timers that fire only when a test advances them. */
class ManualTimers {
  private now = 0;
  private next = 1;
  private readonly due = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, ms: number): unknown => {
    const id = this.next++;
    this.due.set(id, { at: this.now + ms, callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.due.delete(handle as number);
  };

  get pending(): number {
    return this.due.size;
  }

  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.due.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (next === undefined) {
        break;
      }
      this.due.delete(next[0]);
      this.now = next[1].at;
      next[1].callback();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

/** Let promises and stream callbacks run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 2_000; turn += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const terminals = (events: AgentEvent[]) => events.filter((event) => event.type === 'run.finished');
const lastFinished = (events: AgentEvent[]) => {
  const last = events.at(-1);
  return last?.type === 'run.finished' ? last.status : null;
};
const finalTexts = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'assistant.message' ? [event.text] : []));

/** Each turn's own init messages' apiKeySource, without the generated run IDs. */
function perTurnSources(verification: { observedPerTurn: Array<{ turn: string; apiKeySources: unknown[] }> }) {
  return verification.observedPerTurn.map(({ turn, apiKeySources }) => ({ turn, apiKeySources }));
}

const sessionOf = (call: Call): string => call.options.sessionId ?? call.options.resume;

/** `apiKeySource: null` leaves the field out of the init message; `extra` overrides any field. */
const init = (call: Call, apiKeySource: string | null = 'none', extra: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionOf(call),
  ...(apiKeySource === null ? {} : { apiKeySource }),
  claude_code_version: '2.9.0-test',
  cwd: call.options.cwd,
  tools: ['Read', 'Glob', 'Grep', 'Edit'],
  model: 'claude-haiku-4-5',
  permissionMode: 'dontAsk',
  mcp_servers: [],
  slash_commands: [],
  output_style: 'default',
  skills: [],
  plugins: [],
  uuid: 'u-init',
  ...extra,
});

const delta = (call: Call, text: string, kind = 'text_delta') => ({
  type: 'stream_event',
  parent_tool_use_id: null,
  session_id: sessionOf(call),
  uuid: 'u-delta',
  event: {
    type: 'content_block_delta',
    index: 0,
    delta: kind === 'text_delta' ? { type: 'text_delta', text } : { type: kind, thinking: text },
  },
});

const assistant = (call: Call, content: unknown[]) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  session_id: sessionOf(call),
  uuid: 'u-assistant',
  message: { role: 'assistant', content },
});

const toolResult = (call: Call, id: string, isError = false) => ({
  type: 'user',
  parent_tool_use_id: null,
  session_id: sessionOf(call),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
});

const result = (call: Call, overrides: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 10,
  duration_api_ms: 8,
  num_turns: 1,
  result: 'done',
  stop_reason: 'end_turn',
  total_cost_usd: 0.0012,
  usage: {
    input_tokens: 11,
    output_tokens: 7,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 3,
  },
  modelUsage: {},
  permission_denials: [],
  uuid: 'u-result',
  session_id: sessionOf(call),
  ...overrides,
});

function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }
  });
}

function abortError(): Error {
  return Object.assign(new Error('Claude Code process aborted by user'), { name: 'AbortError' });
}

function collect(adapter: ClaudeAgentSdkAdapter, sessionId: string) {
  const events: AgentEvent[] = [];
  let resolveFinished: (() => void) | null = null;
  let finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  adapter.subscribe(sessionId, (event) => {
    events.push(event);
    if (event.type === 'run.finished') {
      resolveFinished?.();
      finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });
    }
  });
  return {
    events,
    nextFinish: () => finished,
  };
}

/** No credential variables at all; an API key appears only where a test puts it. */
const CLEAN_ENV = Object.freeze({ PATH: process.env['PATH'] ?? '' });

function workspace(name: string): string {
  const dir = tempRoot(`claude-${name}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n', 'utf8');
  return dir;
}

function startConfig(dir: string, extra: Record<string, unknown> = {}) {
  return { provider: 'claude' as const, modelRequested: 'claude-haiku-4-5', workspacePath: dir, ...extra };
}

// --- The adapter ---------------------------------------------------------------

test('maps the SDK stream to DSpatch events and passes the fixture configuration', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    yield delta(call, 'thinking…', 'thinking_delta');
    yield delta(call, 'Hello ');
    yield delta(call, 'world');
    yield assistant(call, [
      { type: 'text', text: 'Hello world' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'src/a.ts' } },
    ]);
    yield toolResult(call, 'tool-1');
    yield result(call);
  });
  const dir = workspace('mapping');
  const adapter = new ClaudeAgentSdkAdapter({
    queryFn,
    spawnProcess,
    env: { ...CLEAN_ENV, ANTHROPIC_API_KEY: undefined },
  });
  try {
    const handle = await adapter.startSession(startConfig(dir));
    assert.equal(handle.provider, 'claude');
    assert.equal(handle.providerSessionId, providerSessionIdFor(handle.dspatchSessionId));
    assert.match(handle.providerSessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const seen = collect(adapter, handle.dspatchSessionId);
    const finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'Explain src/a.ts');
    await finished;

    assert.deepEqual(
      seen.events.map((event) => event.type),
      [
        'run.started',
        'reasoning.delta',
        'assistant.delta',
        'assistant.delta',
        'tool.started',
        'tool.finished',
        'usage',
        'assistant.message',
        'run.finished',
      ],
    );
    const message = seen.events.find((event) => event.type === 'assistant.message');
    assert.equal(message?.type === 'assistant.message' ? message.text : null, 'Hello world');
    const toolFinished = seen.events.find((event) => event.type === 'tool.finished');
    assert.deepEqual(
      toolFinished?.type === 'tool.finished'
        ? [toolFinished.toolCallId, toolFinished.name, toolFinished.status]
        : null,
      ['tool-1', 'Read', 'ok'],
    );
    const last = seen.events.at(-1);
    assert.equal(last?.type === 'run.finished' ? last.status : null, 'finished');

    const options = calls[0]?.options ?? {};
    assert.equal(options['sessionId'], handle.providerSessionId);
    assert.equal(options['resume'], undefined);
    assert.equal(options['cwd'], dir);
    assert.deepEqual(options['tools'], ['Read', 'Glob', 'Grep', 'Edit']);
    assert.deepEqual(options['allowedTools'], ['Read(/**)', 'Edit(/src/**)']);
    assert.equal(options['permissionMode'], 'dontAsk');
    assert.deepEqual(options['settingSources'], []);
    assert.equal(options['strictMcpConfig'], true);
    assert.equal(options['title'], handle.dspatchSessionId);
    assert.equal(options['includePartialMessages'], true);
    assert.equal(options['canUseTool'], undefined);
    assert.equal(options['allowDangerouslySkipPermissions'], undefined);
    assert.ok(options['abortController'] instanceof AbortController);
    assert.equal('ANTHROPIC_API_KEY' in (options['env'] ?? {}), false);
    // DSP-115 (S4): streaming input, one message, then the iterable ends.
    assert.deepEqual(calls[0]?.promptMessages, [
      { type: 'user', message: { role: 'user', content: 'Explain src/a.ts' }, parent_tool_use_id: null },
    ]);
    // One PreToolUse hook without a matcher, and the process wrapper.
    assert.deepEqual(Object.keys(options['hooks'] ?? {}), ['PreToolUse']);
    assert.equal(options['hooks'].PreToolUse.length, 1);
    assert.equal(options['hooks'].PreToolUse[0].matcher, undefined);
    assert.equal(options['hooks'].PreToolUse[0].hooks.length, 1);
    assert.equal(typeof options['spawnClaudeCodeProcess'], 'function');

    assert.equal(adapter.modelReported(handle.dspatchSessionId), 'claude-haiku-4-5');
    assert.deepEqual(adapter.providerSessionIdsObserved(handle.dspatchSessionId), [
      handle.providerSessionId,
    ]);
    assert.deepEqual(adapter.capabilities(), {
      start: 'supported',
      streaming: 'supported',
      cancel: 'supported',
      resume: 'unsupported',
      modelSelection: 'supported',
      approvals: 'unsupported',
      usageReporting: 'unknown',
    });
  } finally {
    await adapter.dispose();
  }
});

test('one run per session; the next turn resumes the same provider session', async () => {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call, index) {
    yield init(call);
    if (index === 0) {
      await gate;
    }
    yield result(call);
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('one-run')));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'first');
    await assert.rejects(adapter.send(handle.dspatchSessionId, 'second, too early'), /already has an active run/);
    release?.();
    await finished;

    finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'second');
    await finished;

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.options['sessionId'], handle.providerSessionId);
    assert.equal(calls[1]?.options['resume'], handle.providerSessionId);
    assert.equal(calls[1]?.options['sessionId'], undefined);
  } finally {
    await adapter.dispose();
  }
});

// --- Cancellation (DSP-115) ------------------------------------------------------
//
// These show the adapter's logic and configuration against a substituted query()
// and process: the order of events, the waits and escalation, the hook's answers
// and the records. They cannot show what Claude Code does with an interrupt, a hook
// deny or `continue: false`, how long it takes, or whether the provider stops
// working — only a live run can.

test('cancel() emits run.cancel_requested and resolves at once; a result after it is recorded but the end waits for the stream and the process exit', async () => {
  let releaseStream: () => void = () => undefined;
  const streamGate = new Promise<void>((resolve) => {
    releaseStream = resolve;
  });
  let child: any = null;
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    child = call.child;
    // The stream may end before the process exits: the test exits it itself.
    call.holdProcess = true;
    yield init(call);
    yield delta(call, 'Starting a long answer');
    await call.interrupted;
    yield result(call, { subtype: 'error_during_execution', is_error: true, errors: ['interrupted'] });
    await streamGate;
  });
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('cancel')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Write a lot');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the first delta');

    const cancelling = adapter.cancel(handle.dspatchSessionId);
    // Emitted before cancel() resolves, and interrupt() called once, without waiting for it.
    assert.equal(seen.events.at(-1)?.type, 'run.cancel_requested');
    assert.equal(calls[0]?.interrupts, 1);
    await cancelling;

    // S1: the result arrives and is recorded with its usage, but the run has not ended.
    await until(() => seen.events.some((event) => event.type === 'usage'), 'the result');
    await settle();
    assert.equal(terminals(seen.events).length, 0);
    assert.equal(adapter.hasActiveRun(handle.dspatchSessionId), true);
    assert.equal((await adapter.readUsage({ of: 'run', dspatchRunId })).length, 4);

    // The stream ends: still no terminal, because the process has not been seen to exit.
    releaseStream();
    await settle();
    assert.equal(terminals(seen.events).length, 0);

    child.exit(0);
    await settle();
    const ends = terminals(seen.events);
    assert.equal(ends.length, 1);
    const last = ends[0];
    assert.equal(last?.type === 'run.finished' ? last.status : null, 'cancelled');
    assert.equal(last?.type === 'run.finished' ? last.end : null, 'stopped');
    assert.equal(seen.events.at(-1)?.type, 'run.finished');
    assert.equal(calls[0]?.options['abortController'].signal.aborted, false, 'never aborted');
    assert.equal(calls[0]?.interrupts, 1);
    assert.equal(timers.pending, 0);

    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.equal(record?.interrupt.status, 'resolved');
    assert.deepEqual(record?.interrupt.receipt, { still_queued: [] });
    assert.equal(record?.resultAfterRequest?.subtype, 'error_during_execution');
    assert.equal(record?.endEvidence?.kind, 'process-exit');
    assert.equal(record?.endEvidence?.process?.exitCode, 0);
    assert.equal(record?.abortRequestedAtUtc, null);
    assert.equal(record?.killRequestedAtUtc, null);
    assert.equal(record?.providerWorkAfterEnd, 'unknown');
    assert.ok((record?.cancelRequestedAtUtc ?? '') <= (record?.endAtUtc ?? ''));
    assert.equal(adapter.hasActiveRun(handle.dspatchSessionId), false);
  } finally {
    await adapter.dispose();
  }
});

test('cancel after the result arrived is refused: the run already ended, exactly once', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call);
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('cancel-late')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'quick');
    await finished;
    await assert.rejects(adapter.cancel(handle.dspatchSessionId), /no run in progress to cancel/);
    await settle();
    assert.equal(terminals(seen.events).length, 1);
    assert.equal(lastFinished(seen.events), 'finished');
    assert.equal(seen.events.some((event) => event.type === 'run.cancel_requested'), false);
    assert.equal(calls[0]?.interrupts, 0);
  } finally {
    await adapter.dispose();
  }
});

test('cancel just before the stream ends, with no result: stopped, and the usage is unknown rather than zero', async () => {
  let child: any = null;
  const { queryFn, spawnProcess } = fakeSdk(async function* (call) {
    child = call.child;
    yield init(call);
    yield delta(call, 'Almost done');
    await call.interrupted;
    child.exit(0);
  });
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('cancel-end')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const finished = seen.nextFinish();
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Write');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the delta');
    await adapter.cancel(handle.dspatchSessionId);
    await finished;
    await settle();
    assert.equal(terminals(seen.events).length, 1);
    const last = terminals(seen.events)[0];
    assert.equal(last?.type === 'run.finished' ? last.end : null, 'stopped');
    assert.deepEqual(finalTexts(seen.events), ['Almost done']);
    assert.deepEqual(await adapter.readUsage({ of: 'run', dspatchRunId }), []);
    assert.equal(adapter.cancellation(handle.dspatchSessionId, dspatchRunId)?.resultAfterRequest, null);
    assert.equal(timers.pending, 0);
  } finally {
    await adapter.dispose();
  }
});

test('the PreToolUse hook passes before the request, denies with continue:false after it, and passes again in the next run', async () => {
  const answers: unknown[] = [];
  const hookOf = (call: Call) => call.options['hooks'].PreToolUse[0].hooks[0];
  const ask = (call: Call, tool: string, id: string) =>
    hookOf(call)(
      {
        hook_event_name: 'PreToolUse',
        tool_name: tool,
        tool_input: {},
        tool_use_id: id,
        session_id: sessionOf(call),
        transcript_path: '',
        cwd: call.options['cwd'],
      },
      id,
      { signal: new AbortController().signal },
    );
  const { queryFn, spawnProcess } = fakeSdk(async function* (call, index) {
    yield init(call);
    if (index === 0) {
      answers.push(await ask(call, 'Read', 't-1'));
      yield assistant(call, [{ type: 'tool_use', id: 't-1', name: 'Read', input: {} }]);
      await call.interrupted;
      // The tool that was already running finishes; the next one is denied.
      yield toolResult(call, 't-1');
      yield assistant(call, [{ type: 'tool_use', id: 't-2', name: 'Glob', input: {} }]);
      answers.push(await ask(call, 'Glob', 't-2'));
      yield toolResult(call, 't-2', true);
      return;
    }
    answers.push(await ask(call, 'Grep', 't-3'));
    yield result(call);
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('hook')));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Look around');
    await until(() => seen.events.some((event) => event.type === 'tool.started'), 'the first tool');
    await adapter.cancel(handle.dspatchSessionId);
    await finished;

    finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'Again');
    await finished;

    assert.deepEqual(answers, [
      {},
      {
        continue: false,
        stopReason: CANCEL_STOP_REASON,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: CANCEL_DENY_REASON,
        },
      },
      {},
    ]);
    assert.deepEqual(
      adapter.hookFirings(handle.dspatchSessionId).map((firing) => [firing.toolName, firing.toolUseId, firing.decision]),
      [
        ['Read', 't-1', 'pass'],
        ['Glob', 't-2', 'deny'],
        ['Grep', 't-3', 'pass'],
      ],
    );
    // S2/S3: tool work after the request, by the same rule as the DSP-109 baseline.
    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.deepEqual(record?.hook, {
      matcher: null,
      permissionDecisionReason: CANCEL_DENY_REASON,
      stopReason: CANCEL_STOP_REASON,
    });
    assert.deepEqual(record?.toolUseBlocksAfterRequest.map((entry) => entry.toolUseId), ['t-2']);
    assert.deepEqual(
      record?.toolResultsAfterRequest.map((entry) => [entry.toolUseId, entry.status, entry.deniedByHook]),
      [
        ['t-1', 'ok', false],
        ['t-2', 'error', true],
      ],
    );
    // t-1 started before the request and ran; t-2 was denied.
    assert.equal(record?.toolResultsNotDeniedAfterRequest, 1);
    assert.equal(record?.toolResultsOkAfterRequest, 1);
    // Stopped on the stream end plus the observed exit of the substitute's process.
    assert.equal(record?.endEvidence?.kind, 'process-exit');
    assert.equal(record?.endEvidence?.process?.exitCode, 0);
    assert.equal(record?.end, 'stopped');
  } finally {
    await adapter.dispose();
  }
});

test('no end after interrupt(): abort at the bound, never before; a repeated cancel does nothing; the end after the abort is forced', async () => {
  let child: any = null;
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    child = call.child;
    yield init(call);
    yield delta(call, 'Ignoring the interrupt');
    await untilAborted(call.options['abortController'].signal);
    child.exit(null, 'SIGTERM');
  });
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('escalate')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Write');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the delta');
    await adapter.cancel(handle.dspatchSessionId);
    const signal: AbortSignal = calls[0]?.options['abortController'].signal;

    await timers.advance(CANCEL_INTERRUPT_WAIT_MS - 1);
    assert.equal(signal.aborted, false, 'no abort before the bound');
    await adapter.cancel(handle.dspatchSessionId);
    assert.equal(seen.events.filter((event) => event.type === 'run.cancel_requested').length, 1);
    assert.equal(calls[0]?.interrupts, 1);

    await timers.advance(1);
    assert.equal(signal.aborted, true);
    await settle();
    const ends = terminals(seen.events);
    assert.equal(ends.length, 1);
    assert.equal(ends[0]?.type === 'run.finished' ? ends[0].end : null, 'forced');
    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.notEqual(record?.abortRequestedAtUtc, null);
    assert.equal(record?.killRequestedAtUtc, null);
    assert.equal(record?.endEvidence?.process?.signal, 'SIGTERM');
    assert.equal(timers.pending, 0);
  } finally {
    await adapter.dispose();
  }
});

test('no exit after the abort: the process is killed, and if it still does not exit the end is unconfirmed and new turns are refused until it does', async () => {
  let releaseStream: () => void = () => undefined;
  const streamGate = new Promise<void>((resolve) => {
    releaseStream = resolve;
  });
  const children: any[] = [];
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call, index) {
    children.push(call.child);
    yield init(call);
    if (index === 0) {
      call.holdProcess = true;
      yield delta(call, 'Stuck');
      await streamGate;
      return;
    }
    yield result(call);
  });
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('unconfirmed')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Write');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the delta');
    await adapter.cancel(handle.dspatchSessionId);

    await timers.advance(CANCEL_INTERRUPT_WAIT_MS);
    assert.equal(calls[0]?.options['abortController'].signal.aborted, true);
    await timers.advance(CANCEL_ABORT_WAIT_MS);
    assert.deepEqual(children[0].kills, ['SIGKILL']);
    assert.equal(terminals(seen.events).length, 0);
    await timers.advance(CANCEL_KILL_WAIT_MS);

    const ends = terminals(seen.events);
    assert.equal(ends.length, 1);
    assert.equal(ends[0]?.type === 'run.finished' ? ends[0].status : null, 'cancelled');
    assert.equal(ends[0]?.type === 'run.finished' ? ends[0].end : null, 'unconfirmed');
    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.equal(record?.killSignalSent, true);
    assert.deepEqual(
      [record?.endEvidence?.kind, record?.endEvidence?.streamEnded, record?.endEvidence?.process?.exitedAtUtc],
      ['none', false, null],
    );
    await assert.rejects(adapter.send(handle.dspatchSessionId, 'next'), /was not seen to stop/);

    // A late stream end and exit: nothing more is emitted for the ended run, and the session is usable again.
    const before = seen.events.length;
    releaseStream();
    children[0].exit(null, 'SIGKILL');
    await settle();
    assert.equal(seen.events.length, before, 'nothing after the terminal event');
    const finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'next');
    await finished;
    assert.equal(lastFinished(seen.events), 'finished');
    assert.equal(calls.length, 2);
    assert.equal(timers.pending, 0);
  } finally {
    await adapter.dispose();
  }
});

test('a kill that makes the process exit ends the run as forced', async () => {
  let child: any = null;
  const { queryFn, spawnProcess } = fakeSdk(async function* (call) {
    child = call.child;
    yield init(call);
    yield delta(call, 'Stuck');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }, undefined, undefined, { exitOnKill: true });
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('killed')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Write');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the delta');
    await adapter.cancel(handle.dspatchSessionId);
    await timers.advance(CANCEL_INTERRUPT_WAIT_MS + CANCEL_ABORT_WAIT_MS);
    await settle();
    const ends = terminals(seen.events);
    assert.equal(ends.length, 1);
    assert.equal(ends[0]?.type === 'run.finished' ? ends[0].end : null, 'forced');
    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.notEqual(record?.killRequestedAtUtc, null);
    assert.equal(record?.endEvidence?.process?.signal, 'SIGKILL');
    assert.equal(timers.pending, 0);
  } finally {
    await adapter.dispose();
  }
});

test('an interrupt() rejection is recorded and escalates to the abort at once', async () => {
  let child: any = null;
  const { queryFn, calls, spawnProcess } = fakeSdk(
    async function* (call) {
      child = call.child;
      yield init(call);
      yield delta(call, 'Text');
      await untilAborted(call.options['abortController'].signal);
      child.exit(0);
    },
    undefined,
    () => new Error('control channel closed'),
  );
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('interrupt-rejected')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Write');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the delta');
    await adapter.cancel(handle.dspatchSessionId);
    await settle();
    // No clock advanced: the rejection itself escalated.
    assert.equal(calls[0]?.options['abortController'].signal.aborted, true);
    const ends = terminals(seen.events);
    assert.equal(ends.length, 1);
    assert.equal(ends[0]?.type === 'run.finished' ? ends[0].end : null, 'forced');
    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.equal(record?.interrupt.status, 'rejected');
    assert.match(record?.interrupt.error ?? '', /control channel closed/);
    assert.equal(timers.pending, 0);
  } finally {
    await adapter.dispose();
  }
});

test('dispose during each wait of the stop sequence clears its timers and emits nothing more', async () => {
  for (const [stage, elapsed] of [
    ['after the interrupt', 0],
    ['after the abort', CANCEL_INTERRUPT_WAIT_MS],
    ['after the kill', CANCEL_INTERRUPT_WAIT_MS + CANCEL_ABORT_WAIT_MS],
  ] as const) {
    const { queryFn, spawnProcess } = fakeSdk(async function* (call) {
      yield init(call);
      yield delta(call, 'Stuck');
      await call.closed;
    });
    const timers = new ManualTimers();
    const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
    const handle = await adapter.startSession(startConfig(workspace('dispose-stop')));
    const seen = collect(adapter, handle.dspatchSessionId);
    await adapter.send(handle.dspatchSessionId, 'Write');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the delta');
    await adapter.cancel(handle.dspatchSessionId);
    await timers.advance(elapsed);
    assert.equal(timers.pending, 1, `one wait is pending ${stage}`);
    const before = seen.events.length;
    await adapter.dispose();
    assert.equal(timers.pending, 0, `the timer is cleared ${stage}`);
    await timers.advance(CANCEL_INTERRUPT_WAIT_MS + CANCEL_ABORT_WAIT_MS + CANCEL_KILL_WAIT_MS);
    assert.equal(seen.events.length, before, `nothing emitted ${stage}`);
    assert.equal(terminals(seen.events).length, 0);
  }
});

test('a query handle whose process was never observed has no confirmed end: unconfirmed, and new turns are refused', async () => {
  const { queryFn, calls, spawnProcess, spawned } = fakeSdk(
    async function* (call) {
      yield init(call);
      yield delta(call, 'Text');
      await call.interrupted;
      // The stream ends, but no process was ever observed.
    },
    undefined,
    undefined,
    { spawn: false },
  );
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('no-process')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Write');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the delta');
    await adapter.cancel(handle.dspatchSessionId);
    await settle();
    assert.equal(terminals(seen.events).length, 0, 'a stream end alone is not a confirmed end');
    await timers.advance(CANCEL_INTERRUPT_WAIT_MS);
    assert.equal(calls[0]?.options['abortController'].signal.aborted, true);
    await timers.advance(CANCEL_ABORT_WAIT_MS + CANCEL_KILL_WAIT_MS);
    const ends = terminals(seen.events);
    assert.equal(ends.length, 1);
    assert.equal(ends[0]?.type === 'run.finished' ? ends[0].end : null, 'unconfirmed');
    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.deepEqual(record?.endEvidence, { kind: 'none', streamEnded: true, process: null });
    assert.equal(record?.killRequestedAtUtc, null, 'nothing to kill');
    assert.equal(spawned.length, 0);
    await assert.rejects(adapter.send(handle.dspatchSessionId, 'next'), /was not seen to stop/);
    assert.equal(timers.pending, 0);
  } finally {
    await adapter.dispose();
  }
});

test('a spawn that fails (missing executable) ends a cancelled run with spawn-failed evidence', async () => {
  const { queryFn, spawnProcess } = fakeSdk(
    async function* (call) {
      yield init(call);
      await call.interrupted;
      throw new Error('ProcessTransport is not ready for writing');
    },
    undefined,
    undefined,
    { failSpawn: true },
  );
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('spawn-failed')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'Write');
    await settle();
    await adapter.cancel(handle.dspatchSessionId);
    await settle();
    const ends = terminals(seen.events);
    assert.equal(ends.length, 1);
    assert.equal(ends[0]?.type === 'run.finished' ? ends[0].end : null, 'stopped');
    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.equal(record?.endEvidence?.kind, 'spawn-failed');
    assert.equal(record?.endEvidence?.process?.pid, null);
    assert.match(record?.endEvidence?.process?.spawnError ?? '', /ENOENT/);
    assert.match(record?.streamError ?? '', /not ready/);
    assert.equal(timers.pending, 0);
  } finally {
    await adapter.dispose();
  }
});

test('the CLI stderr tail is kept (last 4096 bytes, labelled raw), recorded with the process and added to a stream error', async () => {
  const early = 'E'.repeat(5_000);
  const last = 'Error: synthetic CLI failure at the end of stderr';
  const { queryFn, spawnProcess } = fakeSdk(async function* (call, index) {
    yield init(call);
    call.child.stderr.write(early);
    call.child.stderr.write(last);
    await new Promise((resolve) => setImmediate(resolve));
    if (index === 0) {
      throw new Error('Claude Code process exited with code 1');
    }
    yield delta(call, 'Text');
    await call.interrupted;
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('stderr')));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'one');
    await finished;
    const failed = terminals(seen.events)[0];
    const message = failed?.type === 'run.finished' ? (failed.error?.message ?? '') : '';
    assert.match(message, /exited with code 1/);
    assert.match(message, /raw Claude Code CLI stderr output/);
    assert.ok(message.endsWith(last), 'the tail ends with the last bytes written');
    assert.equal(message.includes(early), false, 'earlier output beyond the bound is dropped');

    finished = seen.nextFinish();
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'two');
    await until(() => seen.events.some((event) => event.type === 'assistant.delta'), 'the delta');
    await adapter.cancel(handle.dspatchSessionId);
    await finished;
    const tail = adapter.cancellation(handle.dspatchSessionId, dspatchRunId)?.endEvidence?.process?.stderrTail;
    assert.equal(tail?.label, STDERR_TAIL_LABEL);
    assert.equal(tail?.bytes, STDERR_TAIL_BYTES);
    assert.equal(tail?.truncated, true);
    assert.ok(tail?.text.endsWith(last));
  } finally {
    await adapter.dispose();
  }
});

test('a cancel while the turn waits for the previous one is reported after run.started, and not at all if the turn never starts', async () => {
  // The first turn's stream stays open after its result until released.
  const releases: Array<() => void> = [];
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call);
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  const timers = new ManualTimers();
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV, timers });
  try {
    const handle = await adapter.startSession(startConfig(workspace('cancel-waiting')));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'first');
    await finished;

    // 1. The turn starts after the wait: run.started, then the request, then the end.
    const second = adapter.send(handle.dspatchSessionId, 'second');
    await settle();
    await adapter.cancel(handle.dspatchSessionId);
    assert.equal(seen.events.some((event) => event.type === 'run.cancel_requested'), false);
    finished = seen.nextFinish();
    releases.shift()?.();
    const { dspatchRunId } = await second;
    await finished;
    assert.deepEqual(
      seen.events.filter((event) => event.dspatchRunId === dspatchRunId).map((event) => event.type),
      ['run.started', 'run.cancel_requested', 'run.finished'],
    );
    assert.equal(lastFinished(seen.events), 'cancelled');
    assert.equal(calls.length, 1, 'the cancelled turn never called query()');

    // 2. The turn never starts (the previous one is still open after the bound): no event at all.
    finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'third');
    await finished;
    const before = seen.events.length;
    const fourth = adapter.send(handle.dspatchSessionId, 'fourth');
    fourth.catch(() => undefined);
    await settle();
    await adapter.cancel(handle.dspatchSessionId);
    await timers.advance(15_000);
    await assert.rejects(fourth, /still delivering messages/);
    assert.deepEqual(seen.events.slice(before), [], 'no orphan run.cancel_requested');
    assert.equal(adapter.hasActiveRun(handle.dspatchSessionId), false);
  } finally {
    for (const release of releases) {
      release();
    }
    await adapter.dispose();
  }
});

test('the process wrapper starts what the SDK asks for, unchanged, and refuses an environment the guard would have stripped', async () => {
  const { queryFn, calls, spawnProcess, spawned } = fakeSdk(
    async function* (call) {
      yield init(call);
      yield result(call);
    },
    undefined,
    undefined,
    // The second query's SDK would hand the wrapper an environment the guard had stripped.
    { spawnEnv: (index) => (index === 1 ? { CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-token' } : {}) },
  );
  const adapter = new ClaudeAgentSdkAdapter({
    queryFn,
    env: { ...CLEAN_ENV, ANTHROPIC_API_KEY: 'sk-ant-synthetic-wrapper' },
    authorization: { kind: 'api-key', approval: 'test-only reference' },
    spawnProcess,
  });
  try {
    const dir = workspace('wrapper');
    const handle = await adapter.startSession(startConfig(dir));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'one');
    await finished;
    // Like the SDK's query(), the substitute throws when the spawn is refused.
    const refused = await adapter.send(handle.dspatchSessionId, 'two').then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    assert.equal(spawned.length, 1, 'the second, refused environment never reached spawn');
    assert.equal(calls[0]?.child.pid, 4242);
    const [first] = spawned;
    assert.equal(first?.command, 'C:/synthetic/claude-test.exe');
    assert.deepEqual(first?.args, ['--output-format', 'stream-json', '--input-format', 'stream-json']);
    assert.equal(first?.options['cwd'], dir);
    // The approved key passes through; nothing is added beyond what the SDK gave.
    assert.deepEqual(first?.options['env'], {
      ...CLEAN_ENV,
      ANTHROPIC_API_KEY: 'sk-ant-synthetic-wrapper',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
    });
    assert.ok(first?.options['signal'] instanceof AbortSignal);
    assert.deepEqual(first?.options['stdio'], ['pipe', 'pipe', 'pipe']);
    assert.equal(first?.options['windowsHide'], true);
    assert.match(String(refused), /CLAUDE_CODE_OAUTH_TOKEN/);
    assert.equal(String(refused).includes('synthetic-token'), false);
    assert.equal(lastFinished(seen.events), 'error');
  } finally {
    await adapter.dispose();
  }
});

test('an error result after a cancel is recorded but does not end the run; without a cancel it is an error', async () => {
  const { queryFn, spawnProcess } = fakeSdk(async function* (call, index) {
    yield init(call);
    if (index === 0) {
      await call.interrupted;
    }
    yield result(call, { subtype: 'error_during_execution', is_error: true, errors: ['interrupted'] });
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('cancel-result')));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'one');
    await adapter.cancel(handle.dspatchSessionId);
    await finished;
    let last = seen.events.at(-1);
    assert.equal(last?.type === 'run.finished' ? last.status : null, 'cancelled');
    assert.equal(last?.type === 'run.finished' ? last.end : null, 'stopped');
    assert.equal(last?.type === 'run.finished' ? last.error : null, undefined);
    assert.equal(adapter.cancellation(handle.dspatchSessionId, dspatchRunId)?.endEvidence?.kind, 'process-exit');

    finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'two');
    await finished;
    last = seen.events.at(-1);
    assert.equal(last?.type === 'run.finished' ? last.status : null, 'error');
    assert.equal(last?.type === 'run.finished' ? last.error?.providerCode : null, 'error_during_execution');
    assert.match(last?.type === 'run.finished' ? (last.error?.message ?? '') : '', /interrupted/);
  } finally {
    await adapter.dispose();
  }
});

test('more than one working folder is refused with a clear error', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* () {});
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const first = workspace('root-a');
    const second = workspace('root-b');
    await assert.rejects(
      adapter.startSession(startConfig(first, { workspacePaths: [first, second] })),
      /names 2 working folders, and the Claude adapter supports exactly one/,
    );
    // The primary repeated as the only entry is still one root.
    await adapter.startSession(startConfig(first, { workspacePaths: [first] }));
    await assert.rejects(
      adapter.startSession({ ...startConfig(first), provider: 'cursor' as const }),
      /serves the "claude" provider/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await adapter.dispose();
  }
});

test('a missing usage value is null, never 0', async () => {
  const { queryFn, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call, { usage: { input_tokens: 5 } });
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('usage')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const finished = seen.nextFinish();
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'count');
    await finished;
    const readings = await adapter.readUsage({ of: 'run', dspatchRunId });
    const bySource = Object.fromEntries(readings.map((reading) => [reading.source, reading.value]));
    assert.equal(bySource['SDKResultMessage.usage.input_tokens'], 5);
    assert.equal(bySource['SDKResultMessage.usage.output_tokens'], null);
    assert.equal(bySource['SDKResultMessage.usage.cache_read_input_tokens'], null);
    assert.ok(readings.every((reading) => reading.unit === 'tokens' && reading.provider === 'claude'));
    // The SDK's cost estimate is not turned into a reading at all.
    assert.ok(readings.every((reading) => !reading.source.includes('cost')));
    assert.deepEqual(await adapter.readUsage({ of: 'run', dspatchRunId: 'dsp-run-unknown' }), []);
  } finally {
    await adapter.dispose();
  }
});

test('dispose aborts a running turn, is idempotent and does not throw', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    await untilAborted(call.options['abortController'].signal);
    throw abortError();
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  const handle = await adapter.startSession(startConfig(workspace('dispose')));
  await adapter.send(handle.dspatchSessionId, 'run until stopped');
  await adapter.dispose();
  assert.equal(calls[0]?.options['abortController'].signal.aborted, true);
  await adapter.dispose();
  await assert.rejects(adapter.startSession(startConfig(workspace('after'))), /disposed/);
});

test('a cancelled run keeps the interrupted block\'s streamed text after a completed block', async () => {
  const partial = 'Partial explanation that should survive.';
  const { queryFn, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    yield delta(call, 'Intro. ');
    yield assistant(call, [{ type: 'text', text: 'Intro. ' }]);
    yield delta(call, partial);
    await call.interrupted;
    // The stream ends before the second block completes.
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('partial')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'Explain');
    while (!seen.events.some((event) => event.type === 'assistant.delta' && event.text === partial)) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await adapter.cancel(handle.dspatchSessionId);
    await finished;
    assert.deepEqual(finalTexts(seen.events), [`Intro. ${partial}`]);
    assert.equal(lastFinished(seen.events), 'cancelled');
  } finally {
    await adapter.dispose();
  }
});

test('a failed run keeps the interrupted block\'s text; a finished run is the completed blocks only', async () => {
  const { queryFn, spawnProcess } = fakeSdk(async function* (call, index) {
    yield init(call);
    yield delta(call, 'A. ');
    yield assistant(call, [{ type: 'text', text: 'A. ' }]);
    yield delta(call, 'B.');
    if (index === 0) {
      throw new Error('connection lost');
    }
    yield assistant(call, [{ type: 'text', text: 'B.' }]);
    yield result(call);
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('partial-error')));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'one');
    await finished;
    assert.deepEqual(finalTexts(seen.events), ['A. B.']);
    assert.equal(lastFinished(seen.events), 'error');

    seen.events.length = 0;
    finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'two');
    await finished;
    // No duplication: the deltas are covered by the completed blocks.
    assert.deepEqual(finalTexts(seen.events), ['A. B.']);
    assert.equal(lastFinished(seen.events), 'finished');
  } finally {
    await adapter.dispose();
  }
});

test('dispose stops a previous turn whose stream is still open while the next turn waits', async () => {
  const closed: boolean[] = [];
  const signals: AbortSignal[] = [];
  const queryFn = ((params: { prompt: string; options: Record<string, any> }) => {
    const index = signals.length;
    const call = { prompt: params.prompt, options: params.options };
    const signal: AbortSignal = params.options['abortController'].signal;
    signals.push(signal);
    closed.push(false);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    const generator = (async function* () {
      yield init(call);
      yield result(call);
      // The result is in, but the iterator stays open until closed or aborted.
      await held;
    })();
    return Object.assign(generator, {
      close: () => {
        closed[index] = true;
        release();
      },
    });
  }) as any;
  // This substitute never spawns (no cancel here), so no spawner is needed.
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
  const handle = await adapter.startSession(startConfig(workspace('dispose-waiting')));
  const seen = collect(adapter, handle.dspatchSessionId);
  const finished = seen.nextFinish();
  await adapter.send(handle.dspatchSessionId, 'first');
  await finished;
  assert.equal(adapter.streamPumpFinished(handle.dspatchSessionId), false);

  const second = adapter.send(handle.dspatchSessionId, 'second');
  second.catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  await adapter.dispose();

  await assert.rejects(second, /disposed while the turn waited/);
  assert.equal(signals.length, 1, 'the waiting turn never called query()');
  assert.equal(signals[0]?.aborted, true);
  assert.equal(closed[0], true);
  await adapter.dispose();
});

// --- Authentication ------------------------------------------------------------

test('the authentication guard names variables, never values, and refuses by default', () => {
  const secret = 'sk-ant-test-not-a-real-key';
  const refused = assessAuthentication({ ...CLEAN_ENV, ANTHROPIC_API_KEY: secret }, null, true);
  assert.deepEqual(refused.credentialVariablesFound, ['ANTHROPIC_API_KEY']);
  assert.match(refused.refusal ?? '', /ANTHROPIC_API_KEY is set/);
  assert.equal(JSON.stringify(refused).includes(secret), false);

  for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    const found = assessAuthentication({ ...CLEAN_ENV, [name]: '1' }, null, false);
    assert.deepEqual(found.credentialVariablesFound, [name]);
    assert.notEqual(found.refusal, null, name);
  }

  // A subscription authorization does not let an API credential through.
  const subscription = assessAuthentication(
    { ...CLEAN_ENV, ANTHROPIC_API_KEY: secret },
    { kind: 'subscription', authorization: 'reference' },
    true,
  );
  assert.notEqual(subscription.refusal, null);

  // Only an explicit API-key approval does, and it is recorded.
  const approved = assessAuthentication(
    { ...CLEAN_ENV, ANTHROPIC_API_KEY: secret },
    { kind: 'api-key', approval: 'Niclas, chat 2026-10-21' },
    true,
  );
  assert.equal(approved.refusal, null);
  assert.deepEqual(approved.authorization, { kind: 'api-key', approval: 'Niclas, chat 2026-10-21' });

  // A blank approval is no approval.
  assert.notEqual(
    assessAuthentication({ ...CLEAN_ENV, ANTHROPIC_API_KEY: secret }, { kind: 'api-key', approval: '  ' }, true).refusal,
    null,
  );
  // A Claude Code token is never reused, whatever is recorded.
  assert.match(
    assessAuthentication({ ...CLEAN_ENV, CLAUDE_CODE_OAUTH_TOKEN: 'x' }, { kind: 'subscription', authorization: 'r' }, true)
      .refusal ?? '',
    /does not reuse Claude Code authentication tokens/,
  );
  // With nothing in the environment and nothing recorded, a live run still refuses.
  assert.match(assessAuthentication(CLEAN_ENV, null, true).refusal ?? '', /No authorized authentication path/);
  assert.equal(assessAuthentication(CLEAN_ENV, null, false).refusal, null);

  // What the subprocess would get: unapproved credentials removed, nothing added.
  const stripped = providerEnvironment({ ...CLEAN_ENV, ANTHROPIC_API_KEY: secret, CLAUDE_CODE_OAUTH_TOKEN: 't' }, null);
  assert.deepEqual(stripped, { ...CLEAN_ENV });
  const kept = providerEnvironment({ ...CLEAN_ENV, ANTHROPIC_API_KEY: secret }, { kind: 'api-key', approval: 'r' });
  assert.equal(kept['ANTHROPIC_API_KEY'], secret);
});

test('the adapter refuses to start a session the guard refuses, and never calls query()', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* () {});
  const withKey = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: { ...CLEAN_ENV, ANTHROPIC_API_KEY: 'k' } });
  await assert.rejects(withKey.startSession(startConfig(workspace('guard-key'))), /No API-key approval is recorded/);
  await withKey.dispose();

  // The real SDK is used when no substitute is given, so a recorded authorization
  // is required — and the refusal comes before anything would load it.
  const real = new ClaudeAgentSdkAdapter({ env: CLEAN_ENV });
  await assert.rejects(real.startSession(startConfig(workspace('guard-real'))), /No authorized authentication path/);
  await real.dispose();
  assert.equal(calls.length, 0);

  // Only 'dontAsk': the three never-used modes, and the two that would prompt.
  for (const mode of ['bypassPermissions', 'acceptEdits', 'auto', 'default', 'plan']) {
    assert.throws(
      () => new ClaudeAgentSdkAdapter({ queryFn, permissions: { ...FIXTURE_PERMISSIONS, permissionMode: mode as any } }),
      /is not used by DSpatch's Claude adapter. Only 'dontAsk'/,
      mode,
    );
  }
});

// --- The configuration DSpatch sends and records (DSP-109, 22 Oct 2026) ----------
//
// These check what the substituted query() receives and what the record keeps.
// They are not evidence of tool isolation or of the background title request
// disappearing: only a live run shows whether strictMcpConfig kept the claude.ai
// connectors out or whether Options.title removed the claude-haiku-5-5 call.

test('every query() carries strictMcpConfig, the session title and the fixture policy; a policy without strictMcpConfig is refused', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call);
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('config-sent')));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'first');
    await finished;
    finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'second');
    await finished;
    assert.equal(calls.length, 2);
    // The first query starts the session, the second resumes it; both carry the same configuration.
    for (const call of calls) {
      assert.equal(call.options['strictMcpConfig'], true);
      assert.equal(call.options['title'], handle.dspatchSessionId);
      assert.deepEqual(call.options['settingSources'], []);
      assert.deepEqual(call.options['tools'], ['Read', 'Glob', 'Grep', 'Edit']);
      assert.deepEqual(call.options['allowedTools'], ['Read(/**)', 'Edit(/src/**)']);
      assert.equal(call.options['permissionMode'], 'dontAsk');
      assert.equal(call.options['mcpServers'], undefined, 'DSpatch passes no MCP server of its own');
    }
    assert.equal(adapter.sessionTitle(handle.dspatchSessionId), handle.dspatchSessionId);
    assert.equal(adapter.permissionPolicy().strictMcpConfig, true);
    assert.equal(FIXTURE_PERMISSIONS.strictMcpConfig, true);
  } finally {
    await adapter.dispose();
  }
  // Refused in the same way as the forbidden permission modes: nothing is sent.
  assert.throws(
    () => new ClaudeAgentSdkAdapter({ queryFn, permissions: { ...FIXTURE_PERMISSIONS, strictMcpConfig: false as any } }),
    /without strictMcpConfig true/,
  );
  assert.equal(calls.length, 2);
});

test('a run record keeps the init mcp_servers (name and status only), the session title and usage of models DSpatch did not request', async () => {
  const remembered = new Map<string, string>();
  const { queryFn, spawnProcess } = fakeSdk(async function* (call, index) {
    const session = sessionOf(call);
    // Turn one: a synthetic connector as a live init without strictMcpConfig might list it;
    // turn two: none, as a live init under strictMcpConfig should.
    yield init(call, 'ANTHROPIC_API_KEY', {
      mcp_servers:
        index === 0
          ? [{ name: 'synthetic-connector', status: 'connected', source: 'synthetic-scope', config: { url: 'https://synthetic.invalid/mcp' } }]
          : [],
    });
    const planted = /token exactly: ([A-Z0-9]+)/.exec(call.prompt)?.[1];
    if (planted !== undefined) {
      remembered.set(session, planted);
    }
    const answer = planted !== undefined ? 'NOTED' : (remembered.get(session) ?? '?');
    yield delta(call, answer);
    yield assistant(call, [{ type: 'text', text: answer }]);
    yield result(call, {
      result: answer,
      modelUsage:
        index === 0
          ? {
              'claude-haiku-4-5': { inputTokens: 10, outputTokens: 72, cacheReadInputTokens: 0, cacheCreationInputTokens: 5994, costUSD: 0.012 },
              'synthetic-background-model': { inputTokens: 1203, outputTokens: 15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.0001 },
            }
          : { 'claude-haiku-4-5': { inputTokens: 20, outputTokens: 135, cacheReadInputTokens: 5994, cacheCreationInputTokens: 6131, costUSD: 0.013 } },
    });
  });
  const logPath = path.join(tempRoot('record-shape-log'), 'record.json');
  const code = await scenarioTwoTurn(workspace('record-shape'), logPath, {
    provider: 'claude',
    authorization: { kind: 'api-key', approval: 'test-only reference' },
    env: scenarioEnv({ ANTHROPIC_API_KEY: 'sk-ant-synthetic-shape' }),
    claudeQueryFn: queryFn,
    claudeSpawnProcess: spawnProcess,
  });
  const text = fs.readFileSync(logPath, 'utf8');
  const record = JSON.parse(text);
  assert.equal(code, 0, JSON.stringify(record.failure ?? record.authenticationVerification));
  assert.equal(text.includes('sk-ant-synthetic-shape'), false);

  // Name and status only: the synthetic source and URL never reach the record.
  assert.deepEqual(record.claude.init.mcp_servers, [{ name: 'synthetic-connector', status: 'connected' }]);
  assert.equal(record.claude.mcpServersObservedInInit, 1);
  assert.equal(text.includes('synthetic.invalid'), false);
  assert.equal(text.includes('synthetic-scope'), false);
  assert.deepEqual(
    record.claude.initObservations.map((entry: { mcp_servers: unknown }) => entry.mcp_servers),
    [[{ name: 'synthetic-connector', status: 'connected' }], []],
  );
  assert.equal(record.claude.toolsMatchConfigured, true);

  assert.equal(record.claude.sessionTitle, record.session.dspatchSessionId);
  assert.match(record.claude.sessionTitleNote, /observed live/);
  assert.equal(record.session.permissions.strictMcpConfig, true);
  assert.equal(record.claude.permissions.strictMcpConfig, true);

  // Only the model DSpatch did not request is listed, with its token counts.
  assert.deepEqual(record.claude.results[0].unrequestedModelUsage, {
    'synthetic-background-model': { inputTokens: 1203, outputTokens: 15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, canonicalModel: null },
  });
  assert.deepEqual(record.claude.results[1].unrequestedModelUsage, {});
  assert.match(record.claude.results[0].unrequestedModelUsageNote, /not requested by DSpatch/);
  assert.match(record.claude.results[0].unrequestedModelUsageNote, /cause not established offline/);
  assert.match(record.claude.results[0].totalCostNote, /estimate/);
});

// B1: every documented family, refused and stripped, by name only. The values
// are distinctive so a leak into a record or an assessment would be visible.
const FAMILIES = {
  providerSwitch: ['CLAUDE_CODE_USE_MANTLE', 'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_SOMETHING_LATER'],
  cloudKey: ['AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_AWS_API_KEY', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID'],
  claudeCodeToken: ['CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_SCOPES'],
} as const;
const matchExact = { caseInsensitive: false };

test('provider switches and cloud keys are refused and stripped, with or without an API-key approval', () => {
  const approval = { kind: 'api-key' as const, approval: 'r' };
  for (const name of [...FAMILIES.providerSwitch, ...FAMILIES.cloudKey]) {
    const value = `secret-value-of-${name}`;
    const env = { ...CLEAN_ENV, [name]: value };
    const refused = assessAuthentication(env, { kind: 'subscription', authorization: 'r' }, true, matchExact);
    assert.deepEqual(refused.credentialVariablesFound, [name], name);
    assert.match(refused.refusal ?? '', /No API-key approval is recorded/, name);
    assert.equal(JSON.stringify(refused).includes(value), false, name);
    assert.equal(name in providerEnvironment(env, null, matchExact), false, `${name} stripped`);

    // An API-key approval means the direct key alone; this one is a competitor.
    const withKey = { ...env, ANTHROPIC_API_KEY: 'sk-ant-synthetic' };
    const competing = assessAuthentication(withKey, approval, true, matchExact);
    assert.match(competing.refusal ?? '', new RegExp(`${name} is set.*covers only the direct Anthropic API-key path`), name);
    assert.equal(competing.preflight.decision, 'refused', name);
    assert.equal(JSON.stringify(competing).includes(value), false, name);
    const passed = providerEnvironment(withKey, approval, matchExact);
    assert.equal(name in passed, false, `${name} stripped when approved`);
    assert.equal(passed['ANTHROPIC_API_KEY'], 'sk-ant-synthetic');
  }
  // The one CLAUDE_CODE_USE_ variable that only controls a tool is left alone.
  const tool = { ...CLEAN_ENV, CLAUDE_CODE_USE_POWERSHELL_TOOL: '0' };
  assert.deepEqual(assessAuthentication(tool, null, false, matchExact).credentialVariablesFound, []);
  assert.equal(providerEnvironment(tool, null, matchExact)['CLAUDE_CODE_USE_POWERSHELL_TOOL'], '0');
});

test('custom headers, client credentials and base-URL overrides are refused and stripped without approval', () => {
  const names = [
    'ANTHROPIC_CUSTOM_HEADERS',
    'CLAUDE_CODE_CLIENT_KEY',
    'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
    'CLAUDE_CODE_CLIENT_CERT',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_BEDROCK_MANTLE_BASE_URL',
    'ANTHROPIC_SOMETHING_LATER_BASE_URL',
  ];
  for (const name of names) {
    const value = `secret-value-of-${name}`;
    const env = { ...CLEAN_ENV, [name]: value };
    const refused = assessAuthentication(env, null, false, matchExact);
    assert.deepEqual(refused.credentialVariablesFound, [name], name);
    assert.match(refused.refusal ?? '', /No API-key approval is recorded/, name);
    assert.equal(JSON.stringify(refused).includes(value), false, name);
    assert.equal(name in providerEnvironment(env, null, matchExact), false, `${name} stripped`);
  }
  // The same case rule as everything else.
  assert.equal('anthropic_base_url' in providerEnvironment({ anthropic_base_url: 'x' }, null, { caseInsensitive: true }), false);
  // Left alone on purpose: inert without a provider switch or credential.
  const inert = {
    ...CLEAN_ENV,
    ANTHROPIC_AWS_WORKSPACE_ID: 'w',
    ANTHROPIC_VERTEX_PROJECT_ID: 'p',
    ANTHROPIC_FOUNDRY_RESOURCE: 'r',
    CLAUDE_CODE_API_KEY_HELPER_TTL_MS: '1000',
  };
  assert.deepEqual(assessAuthentication(inert, null, false, matchExact).credentialVariablesFound, []);
  assert.deepEqual(providerEnvironment(inert, null, matchExact), inert);
});

test('Claude Code OAuth variables are refused and stripped even with an API-key approval', () => {
  const approval = { kind: 'api-key' as const, approval: 'r' };
  for (const name of FAMILIES.claudeCodeToken) {
    const value = `secret-value-of-${name}`;
    const env = { ...CLEAN_ENV, [name]: value };
    const assessed = assessAuthentication(env, approval, true, matchExact);
    assert.deepEqual(assessed.credentialVariablesFound, [name]);
    assert.match(assessed.refusal ?? '', /does not reuse Claude Code authentication tokens/);
    assert.equal(JSON.stringify(assessed).includes(value), false);
    assert.equal(name in providerEnvironment(env, approval, matchExact), false);
  }
});

test('an API-key approval means the direct ANTHROPIC_API_KEY path alone', () => {
  const approval = { kind: 'api-key' as const, approval: 'test-only reference' };
  const key = 'sk-ant-synthetic-direct';
  const refusalOf = (env: Record<string, string | undefined>, matching = matchExact) =>
    assessAuthentication(env, approval, true, matching);

  // No key at all, or an empty one: the approval covers nothing that is there.
  assert.match(refusalOf({ ...CLEAN_ENV }).refusal ?? '', /ANTHROPIC_API_KEY is not set/);
  assert.match(refusalOf({ ...CLEAN_ENV, ANTHROPIC_API_KEY: '  ' }).refusal ?? '', /ANTHROPIC_API_KEY is empty/);

  // A key with a competitor: refused by name, values never in the assessment.
  for (const competitor of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']) {
    const env = { ...CLEAN_ENV, ANTHROPIC_API_KEY: key, [competitor]: 'synthetic-competitor' };
    const assessed = refusalOf(env);
    assert.match(assessed.refusal ?? '', new RegExp(`^${competitor} is set`), competitor);
    assert.equal(assessed.preflight.decision, 'refused');
    assert.equal(assessed.preflight.expectedApiKeySource, null);
    const text = JSON.stringify(assessed);
    assert.equal(text.includes(key) || text.includes('synthetic-competitor'), false, competitor);
    // Defence in depth: even if it started, only the key would reach the subprocess.
    assert.deepEqual(providerEnvironment(env, approval, matchExact), { ...CLEAN_ENV, ANTHROPIC_API_KEY: key });
  }

  // The permitted configuration: the key alone, unrelated variables kept.
  const permitted = { ...CLEAN_ENV, ANTHROPIC_API_KEY: key, CLAUDE_CONFIG_DIR: 'x' };
  const ok = refusalOf(permitted);
  assert.equal(ok.refusal, null);
  assert.equal(ok.preflight.decision, 'direct-anthropic-api-key');
  assert.equal(ok.preflight.expectedApiKeySource, 'ANTHROPIC_API_KEY');
  assert.match(ok.preflight.expectedApiKeySourceBasis ?? '', /expected from documentation.*not yet observed/);
  assert.ok(ok.preflight.notVisibleToThisCheck.some((entry) => /managed/.test(entry)));
  assert.equal(JSON.stringify(ok).includes(key), false);
  assert.deepEqual(providerEnvironment(permitted, approval, matchExact), permitted);

  // Lower case, where the rule is case-insensitive: the same decisions.
  const folding = { caseInsensitive: true };
  assert.equal(refusalOf({ ...CLEAN_ENV, anthropic_api_key: key }, folding).refusal, null);
  assert.match(
    refusalOf({ ...CLEAN_ENV, anthropic_api_key: key, anthropic_auth_token: 't' }, folding).refusal ?? '',
    /^anthropic_auth_token is set/,
  );
  assert.deepEqual(
    providerEnvironment({ ...CLEAN_ENV, anthropic_api_key: key, claude_code_use_vertex: '1' }, approval, folding),
    { ...CLEAN_ENV, anthropic_api_key: key },
  );
  assert.match(
    refusalOf({ ...CLEAN_ENV, ANTHROPIC_API_KEY: key, anthropic_api_key: key }, folding).refusal ?? '',
    /name the same variable/,
  );
  // Where case matters, a lower-case key is not the key.
  assert.match(refusalOf({ ...CLEAN_ENV, anthropic_api_key: key }).refusal ?? '', /ANTHROPIC_API_KEY is not set/);

  // Without guarded variables and without an API-key approval: no expectation.
  const none = assessAuthentication(CLEAN_ENV, null, false, matchExact);
  assert.equal(none.preflight.decision, 'no-api-credential');
  assert.equal(none.preflight.expectedApiKeySource, null);
});

test('on a case-insensitive environment, names match and are stripped whatever their case', () => {
  const env = { ...CLEAN_ENV, anthropic_api_key: 'k', Claude_Code_OAuth_Refresh_Token: 't', claude_code_use_vertex: '1' };
  const folded = assessAuthentication(env, null, false, { caseInsensitive: true });
  assert.deepEqual([...folded.credentialVariablesFound].sort(), ['Claude_Code_OAuth_Refresh_Token', 'anthropic_api_key', 'claude_code_use_vertex'].sort());
  assert.notEqual(folded.refusal, null);
  assert.deepEqual(providerEnvironment(env, null, { caseInsensitive: true }), { ...CLEAN_ENV });

  // Where case matters, those are different variables and Claude Code would not read them.
  const exact = assessAuthentication(env, null, false, matchExact);
  assert.deepEqual(exact.credentialVariablesFound, []);
  assert.equal(providerEnvironment(env, null, matchExact)['anthropic_api_key'], 'k');
});

test('the adapter applies the case rule it is given before any query()', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* () {});
  const adapter = new ClaudeAgentSdkAdapter({
    queryFn,
    spawnProcess,
    env: { ...CLEAN_ENV, claude_code_oauth_token: 't' },
    caseInsensitiveEnv: true,
  });
  await assert.rejects(adapter.startSession(startConfig(workspace('case'))), /does not reuse Claude Code/);
  await adapter.dispose();
  assert.equal(calls.length, 0);
});

test('a turn cancelled before query() is called never calls it and ends as cancelled', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call);
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, spawnProcess, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('early-cancel')));
    const seen = collect(adapter, handle.dspatchSessionId);
    // Cancel the moment the run is announced, before the adapter reaches query().
    adapter.subscribe(handle.dspatchSessionId, (event) => {
      if (event.type === 'run.started') {
        void adapter.cancel(handle.dspatchSessionId);
      }
    });
    const finished = seen.nextFinish();
    const { dspatchRunId } = await adapter.send(handle.dspatchSessionId, 'never sent');
    await finished;
    assert.equal(calls.length, 0);
    const last = seen.events.at(-1);
    assert.equal(last?.type === 'run.finished' ? last.status : null, 'cancelled');
    assert.equal(last?.type === 'run.finished' ? last.end : null, 'stopped');
    assert.equal(seen.events.filter((event) => event.type === 'run.cancel_requested').length, 1);
    const record = adapter.cancellation(handle.dspatchSessionId, dspatchRunId);
    assert.equal(record?.endEvidence?.kind, 'not-started');
    assert.equal(record?.interrupt.status, 'not-called');
    assert.equal(adapter.hasActiveRun(handle.dspatchSessionId), false);
  } finally {
    await adapter.dispose();
  }
});

// --- The scenarios -------------------------------------------------------------

function scenarioEnv(extra: Record<string, string> = {}) {
  // CLAUDE_CONFIG_DIR keeps the state-location check inside this test's scratch.
  return { ...CLEAN_ENV, CLAUDE_CONFIG_DIR: tempRoot('claude-config'), ...extra };
}

function readRecord(file: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('cancel-reply refuses with an API credential and no approval, recording names only', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* () {});
  const dir = workspace('cr-refused');
  const logPath = path.join(tempRoot('cr-refused-log'), 'record.json');
  const secret = 'sk-ant-should-never-appear';
  const code = await scenarioCancelReply(dir, logPath, {
    provider: 'claude',
    env: scenarioEnv({ ANTHROPIC_API_KEY: secret }),
    claudeQueryFn: queryFn,
    claudeSpawnProcess: spawnProcess,
  });
  assert.equal(code, EXIT_REFUSED);
  assert.equal(calls.length, 0);
  const text = fs.readFileSync(logPath, 'utf8');
  assert.equal(text.includes(secret), false);
  const record = JSON.parse(text);
  assert.equal(record.refused, true);
  assert.deepEqual(record.authentication.credentialVariablesFound, ['ANTHROPIC_API_KEY']);
  assert.equal(record.session, undefined);
});

test('two-turn refuses with nothing recorded, even with a clean environment', async () => {
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* () {});
  const logPath = path.join(tempRoot('tt-refused-log'), 'record.json');
  const code = await scenarioTwoTurn(workspace('tt-refused'), logPath, {
    provider: 'claude',
    env: scenarioEnv(),
    claudeQueryFn: queryFn,
    claudeSpawnProcess: spawnProcess,
  });
  assert.equal(code, EXIT_REFUSED);
  assert.equal(calls.length, 0);
  assert.match(readRecord(logPath).authentication.refusal, /No authorized authentication path/);
});

test('cancel-reply cancels after text began and records what came after', async () => {
  const hookOf = (call: Call) => call.options['hooks'].PreToolUse[0].hooks[0];
  const ask = (call: Call, tool: string, id: string) =>
    hookOf(call)(
      { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {}, tool_use_id: id, session_id: sessionOf(call), transcript_path: '', cwd: call.options['cwd'] },
      id,
      { signal: new AbortController().signal },
    );
  const { queryFn, spawnProcess } = fakeSdk(async function* (call) {
    const child = call.child;
    yield init(call, 'ANTHROPIC_API_KEY');
    // A tool call first: the scenario must not cancel on it.
    await ask(call, 'Read', 't-1');
    yield assistant(call, [{ type: 'tool_use', id: 't-1', name: 'Read', input: {} }]);
    yield toolResult(call, 't-1');
    yield delta(call, 'File one does');
    await call.interrupted;
    // A macrotask later, so "after cancel() resolved" is an ordering, not a race.
    await new Promise((resolve) => setTimeout(resolve, 5));
    // The in-flight response still asks for a tool; the hook denies it. Then the
    // result, a straggler, and the process exit.
    yield assistant(call, [{ type: 'tool_use', id: 't-2', name: 'Glob', input: {} }]);
    await ask(call, 'Glob', 't-2');
    yield toolResult(call, 't-2', true);
    yield result(call, { subtype: 'error_during_execution', is_error: true, errors: ['aborted'] });
    yield delta(call, ' late text');
    child.exit(0);
  });
  const dir = workspace('cr-run');
  const logPath = path.join(tempRoot('cr-run-log'), 'record.json');
  const code = await scenarioCancelReply(dir, logPath, {
    provider: 'claude',
    authorization: { kind: 'api-key', approval: 'test-only reference' },
    env: scenarioEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-value' }),
    claudeQueryFn: queryFn,
    claudeSpawnProcess: spawnProcess,
    afterTerminalWatchMs: 20,
  });
  const record = readRecord(logPath);
  assert.equal(code, 0, JSON.stringify(record.failure ?? record.verdict));
  assert.equal(JSON.stringify(record).includes('sk-ant-test-value'), false);
  // DSP-115: the plain cancel-reply record is unchanged by the follow-up path.
  assert.equal(record.scenario, 'DSP-109 cancel-reply — cancel after streamed assistant text began');
  assert.equal(record.prompt, CANCEL_REPLY_PROMPT);
  for (const key of ['marker', 'followUpPrompt', 'followUp', 'crossProcessResume']) {
    assert.equal(key in record, false, key);
  }
  assert.deepEqual(record.verdict, {
    cancelledAfterTextBegan: true,
    terminalStatusCancelled: true,
    noContentChange: true,
    toolCallStartedAfterCancelResolved: true,
    end: 'stopped',
    endUnconfirmed: false,
  });
  const turn = record.turns[0];
  assert.ok(turn.firstActivityMs <= turn.firstTextMs, 'the tool call came before the text');
  assert.deepEqual(
    record.cancellation.toolCallsStartedAfterCancelResolved.map((call: { name: string }) => call.name),
    ['Glob'],
  );
  // The terminal waits for the stream and the process: nothing arrives after it.
  assert.deepEqual(record.cancellation.eventsAfterTerminal, []);
  assert.equal(typeof record.cancellation.terminalEventMsAfterCancelCall, 'number');
  assert.equal(typeof record.cancellation.terminalEventMsAfterCancelRequested, 'number');
  // S2/S3: the request's absolute time, what acted, and tool work after the request.
  assert.match(record.cancellation.cancelRequestedAtUtc, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(record.cancellation.end, 'stopped');
  assert.equal(record.cancellation.endEvidence.kind, 'process-exit');
  assert.equal(record.cancellation.toolUseBlocksAfterRequest, 1);
  assert.equal(record.cancellation.toolUseBlocksAfterRequestExecuted, 0);
  assert.equal(record.cancellation.toolResultsNotDeniedAfterRequest, 0);
  assert.equal(record.cancellation.toolResultsOkAfterRequest, 0);
  assert.equal(record.cancellation.providerWorkAfterEnd, 'unknown');
  assert.equal(record.cancellation.adapter.interrupt.status, 'resolved');
  assert.equal(record.cancellation.adapter.resultAfterRequest.subtype, 'error_during_execution');
  assert.match(record.cancellation.adapter.providerWorkAfterEndNote, /may still be processed and billed/);
  assert.deepEqual(
    record.claude.hookFirings.map((firing: { toolName: string; decision: string }) => [firing.toolName, firing.decision]),
    [
      ['Read', 'pass'],
      ['Glob', 'deny'],
    ],
  );
  // S5: the text DSpatch adds to the conversation is in the record.
  assert.deepEqual(record.claude.cancelHook, {
    event: 'PreToolUse',
    matcher: null,
    permissionDecisionReason: CANCEL_DENY_REASON,
    stopReason: CANCEL_STOP_REASON,
  });
  // The denied call is told apart from the one that ran.
  assert.deepEqual(
    turn.toolCalls
      .filter((call: { phase: string }) => call.phase === 'finished')
      .map((call: { toolCallId: string; status: string }) => [call.toolCallId, call.status]),
    [
      ['t-1', 'ok'],
      ['t-2', 'error'],
    ],
  );
  assert.equal(record.claude.init.permissionMode, 'dontAsk');
  assert.equal(record.claude.toolsMatchConfigured, true);
  assert.equal(record.claude.agentOrTaskToolPresent, false);
  assert.equal(record.claude.managedPolicy, 'not shown in the init message');
  assert.deepEqual(record.claude.providerState.observedTranscriptFiles, []);
  assert.equal(record.claude.providerState.configDirSource, 'CLAUDE_CONFIG_DIR');
  assert.equal(record.authenticationVerification.status, 'verified');
  assert.deepEqual(perTurnSources(record.authenticationVerification), [
    { turn: 'cancelled-reply', apiKeySources: ['ANTHROPIC_API_KEY'] },
  ]);
});

test('two-turn asks for the nonce back in a second send on the same session', async () => {
  const remembered = new Map<string, string>();
  const { queryFn, calls, spawnProcess } = fakeSdk(async function* (call) {
    const session = sessionOf(call);
    yield init(call);
    const planted = /token exactly: ([A-Z0-9]+)/.exec(call.prompt)?.[1];
    if (planted !== undefined) {
      remembered.set(session, planted);
    }
    const answer = planted !== undefined ? 'NOTED' : (remembered.get(session) ?? 'I do not know');
    yield delta(call, answer);
    yield assistant(call, [{ type: 'text', text: answer }]);
    yield result(call, { result: answer });
  });
  const logPath = path.join(tempRoot('tt-run-log'), 'record.json');
  const code = await scenarioTwoTurn(workspace('tt-run'), logPath, {
    provider: 'claude',
    authorization: { kind: 'subscription', authorization: 'test-only reference' },
    env: scenarioEnv(),
    claudeQueryFn: queryFn,
    claudeSpawnProcess: spawnProcess,
  });
  const record = readRecord(logPath);
  // The scenario itself succeeded. The substitute offers no accountInfo(), so this
  // subscription-authorized run is unconfirmed and its 0 becomes 5.
  assert.equal(code, EXIT_AUTHENTICATION_UNVERIFIED, JSON.stringify(record.failure ?? record.continuity));
  assert.equal(record.continuity.secondAnswerContainsNonce, true);
  assert.equal(record.continuity.sameProviderSessionBothTurns, true);
  assert.match(record.crossProcessResume, /not tested/);
  assert.equal(record.authenticationVerification.status, 'unconfirmed');
  assert.equal(record.authenticationVerification.subscriptionEvidence, 'insufficient');
  assert.equal(record.authenticationVerification.preflightDecision, 'no-api-credential');
  assert.match(record.authenticationVerification.reason, /offers no accountInfo\(\)/);
  assert.equal(record.authenticationVerification.scenarioExitCode, 0);
  assert.equal(calls[0]?.options['sessionId'], record.session.providerSessionId);
  assert.equal(calls[1]?.options['resume'], record.session.providerSessionId);
});

test('the DSpatch source revision is clean, dirty or unavailable with a reason', () => {
  const sha = 'c00a972aa63f46048447595ee203f780532a2694';
  const runner = (status: string) => (args: readonly string[]) =>
    args[0] === 'rev-parse' ? `${sha}\n` : status;

  const clean = readSourceRevision(runner(''), '/src');
  assert.deepEqual(
    { available: clean.available, commit: clean.available ? clean.commit : null, tree: clean.available ? clean.tree : null },
    { available: true, commit: sha, tree: 'clean' },
  );
  const dirty = readSourceRevision(runner(' M app/src/x.ts\nM  docs/y.md\n'), '/src');
  assert.equal(dirty.available && dirty.tree, 'dirty');
  assert.deepEqual(dirty.available ? dirty.trackedChanges : null, ['app/src/x.ts', 'docs/y.md']);
  assert.match(dirty.available ? dirty.dirtyMeans : '', /untracked files are not counted/);

  const failing = (error: unknown) => () => {
    throw error;
  };
  const noGit = readSourceRevision(failing(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })), '/src');
  assert.deepEqual(noGit, { available: false, reason: 'git is not available on this system', sourceDir: '/src' });
  const notRepo = readSourceRevision(
    failing(Object.assign(new Error('Command failed'), { status: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' })),
    '/src',
  );
  assert.equal(notRepo.available ? null : notRepo.reason, 'the DSpatch source folder is not a Git repository');
  const other = readSourceRevision(failing(Object.assign(new Error('Command failed'), { stderr: 'fatal: bad object HEAD\n' })), '/src');
  assert.equal(other.available ? null : other.reason, 'git failed: fatal: bad object HEAD');
  assert.equal(readSourceRevision(() => 'not-a-sha', '/src').available, false);
});

test('refused and completed Claude records carry the source revision and the apiKeySource comparison', async () => {
  const revision = { available: false as const, reason: 'test substitute', sourceDir: '/src' };
  const refusedLog = path.join(tempRoot('rev-refused-log'), 'record.json');
  const { queryFn, spawnProcess } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call);
  });
  assert.equal(
    await scenarioTwoTurn(workspace('rev-refused'), refusedLog, {
      provider: 'claude',
      env: scenarioEnv(),
      claudeQueryFn: queryFn,
      claudeSpawnProcess: spawnProcess,
      sourceRevision: () => revision,
    }),
    EXIT_REFUSED,
  );
  assert.deepEqual(readRecord(refusedLog).dspatchSource, revision);
  assert.equal(readRecord(refusedLog).authentication.preflight.decision, 'refused');

  // The substitute's init reports 'none', so the expected key source is not matched:
  // the comparison is recorded, not assumed.
  const ranLog = path.join(tempRoot('rev-ran-log'), 'record.json');
  const ranCode = await scenarioTwoTurn(workspace('rev-ran'), ranLog, {
    provider: 'claude',
    authorization: { kind: 'api-key', approval: 'test-only reference' },
    env: scenarioEnv({ ANTHROPIC_API_KEY: 'sk-ant-synthetic' }),
    claudeQueryFn: queryFn,
    claudeSpawnProcess: spawnProcess,
    sourceRevision: () => revision,
  });
  const ran = readRecord(ranLog);
  assert.deepEqual(ran.dspatchSource, revision);
  assert.equal(ran.claude.apiKeySource.preflightDecision, 'direct-anthropic-api-key');
  assert.equal(ran.claude.apiKeySource.expected, 'ANTHROPIC_API_KEY');
  assert.deepEqual(ran.claude.apiKeySource.observedPerInit, ['none', 'none']);
  assert.equal(ran.claude.apiKeySource.matchesExpected, false);
  // This substitute never answers with the nonce, so the scenario's own failure (2)
  // stands; the mismatch is recorded beside it.
  assert.equal(ranCode, 2);
  assert.equal(ran.authenticationVerification.status, 'mismatch');
  assert.equal(JSON.stringify(ran).includes('sk-ant-synthetic'), false);
});

test('scenario flags: provider and recorded authorization', () => {
  assert.deepEqual(parseScenarioArgs(['repo', 'log.json']), {
    positional: ['repo', 'log.json'],
    options: { provider: 'cursor', authorization: null },
  });
  assert.deepEqual(
    parseScenarioArgs(['repo', '--provider=claude', 'log.json', '--api-key-approval=Niclas 2026-10-21']).options,
    { provider: 'claude', authorization: { kind: 'api-key', approval: 'Niclas 2026-10-21' } },
  );
  assert.throws(() => parseScenarioArgs(['--provider=claude-code']), /must be cursor or claude/);
  assert.throws(() => parseScenarioArgs(['--bypass']), /Unknown flag/);
  // An approval meant for Claude must not be swallowed by a Cursor run.
  assert.throws(() => parseScenarioArgs(['repo', 'log', '--api-key-approval=r']), /apply only to --provider=claude/);
  assert.throws(
    () => parseScenarioArgs(['--provider=cursor', '--subscription-authorization=r']),
    /apply only to --provider=claude/,
  );
});

// --- S1: authentication observations decide a direct API-key run's verdict ---------

/**
 * A two-turn run with an API-key approval whose init messages report the given
 * sources, one per turn (`null` leaves the field out, `'no-init'` sends no
 * init message). `answerNonce: false` makes turn two forget the token.
 */
async function twoTurnWithSources(
  name: string,
  sources: readonly (string | null | readonly (string | null)[])[],
  answerNonce = true,
  subscription?: { readonly account?: AccountScript },
) {
  const remembered = new Map<string, string>();
  const { queryFn, spawnProcess } = fakeSdk(async function* (call, index) {
    const session = sessionOf(call);
    const source = sources[index] ?? null;
    // A list sends one init message per entry, possibly none.
    const sent = Array.isArray(source) ? source : source === 'no-init' ? [] : [source as string | null];
    for (const one of sent) {
      yield init(call, one);
    }
    const planted = /token exactly: ([A-Z0-9]+)/.exec(call.prompt)?.[1];
    if (planted !== undefined) {
      remembered.set(session, planted);
    }
    const answer =
      planted !== undefined ? 'NOTED' : answerNonce ? (remembered.get(session) ?? '?') : 'I do not know';
    yield delta(call, answer);
    yield assistant(call, [{ type: 'text', text: answer }]);
    yield result(call, { result: answer });
  }, subscription?.account);
  const logPath = path.join(tempRoot(`s1-${name}-log`), 'record.json');
  const code = await scenarioTwoTurn(workspace(`s1-${name}`), logPath, {
    provider: 'claude',
    authorization:
      subscription === undefined
        ? { kind: 'api-key', approval: 'test-only reference' }
        : { kind: 'subscription', authorization: 'test-only reference' },
    env: subscription === undefined ? scenarioEnv({ ANTHROPIC_API_KEY: 'sk-ant-synthetic-s1' }) : scenarioEnv(),
    claudeQueryFn: queryFn,
    claudeSpawnProcess: spawnProcess,
  });
  const text = fs.readFileSync(logPath, 'utf8');
  assert.equal(text.includes('sk-ant-synthetic-s1'), false);
  const record = JSON.parse(text);
  return { code, record, verification: record.authenticationVerification };
}

test('a direct API-key run succeeds only when every turn reports the expected apiKeySource', async () => {
  const matched = await twoTurnWithSources('match', ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY']);
  assert.equal(matched.code, 0, JSON.stringify(matched.verification));
  assert.equal(matched.verification.status, 'verified');
  assert.equal(matched.verification.expected, 'ANTHROPIC_API_KEY');
  assert.deepEqual(perTurnSources(matched.verification), [
    { turn: 'turn-1', apiKeySources: ['ANTHROPIC_API_KEY'] },
    { turn: 'turn-2', apiKeySources: ['ANTHROPIC_API_KEY'] },
  ]);
  // Each turn is judged by its own run, and the two turns are different runs.
  const runIds = matched.verification.observedPerTurn.map((entry: { dspatchRunId: string }) => entry.dspatchRunId);
  assert.deepEqual(runIds, matched.record.turns.map((turn: { runId: string }) => turn.runId));
  assert.notEqual(runIds[0], runIds[1]);
  assert.equal(matched.record.continuity.sameProviderSessionBothTurns, true);
  assert.match(matched.verification.note, /after observation/);
  assert.match(matched.verification.note, /does not establish authentication before the first provider request/);
  assert.equal(matched.record.exitCode, 0);

  const mismatched = await twoTurnWithSources('mismatch', ['none', 'none']);
  assert.equal(mismatched.code, EXIT_AUTHENTICATION_UNVERIFIED);
  assert.equal(mismatched.verification.status, 'mismatch');
  assert.equal(mismatched.verification.scenarioExitCode, 0);
  assert.equal(mismatched.record.exitCode, EXIT_AUTHENTICATION_UNVERIFIED);

  const missing = await twoTurnWithSources('missing', [null, null]);
  assert.equal(missing.code, EXIT_AUTHENTICATION_UNVERIFIED);
  assert.equal(missing.verification.status, 'unconfirmed');
  assert.deepEqual(
    missing.verification.observedPerInit.map((entry: { apiKeySource: unknown }) => entry.apiKeySource),
    [null, null],
  );
  assert.match(missing.verification.reason, /turn-1, turn-2/);
});

test('one matching turn does not hide a missing or different observation in the other', async () => {
  const secondMissing = await twoTurnWithSources('mixed-missing', ['ANTHROPIC_API_KEY', null]);
  assert.equal(secondMissing.code, EXIT_AUTHENTICATION_UNVERIFIED);
  assert.equal(secondMissing.verification.status, 'unconfirmed');
  assert.deepEqual(perTurnSources(secondMissing.verification), [
    { turn: 'turn-1', apiKeySources: ['ANTHROPIC_API_KEY'] },
    { turn: 'turn-2', apiKeySources: [null] },
  ]);

  const secondDifferent = await twoTurnWithSources('mixed-different', ['ANTHROPIC_API_KEY', 'none']);
  assert.equal(secondDifferent.code, EXIT_AUTHENTICATION_UNVERIFIED);
  assert.equal(secondDifferent.verification.status, 'mismatch');

  // No init message at all in turn two: the one observation cannot cover both turns.
  // The scenario already fails (2) on its own provider-session check, and keeps that code.
  const secondNoInit = await twoTurnWithSources('mixed-no-init', ['ANTHROPIC_API_KEY', 'no-init']);
  assert.equal(secondNoInit.code, 2);
  assert.equal(secondNoInit.record.continuity.sameProviderSessionBothTurns, false);
  assert.equal(secondNoInit.verification.status, 'unconfirmed');
  assert.deepEqual(perTurnSources(secondNoInit.verification), [
    { turn: 'turn-1', apiKeySources: ['ANTHROPIC_API_KEY'] },
    { turn: 'turn-2', apiKeySources: [] },
  ]);
  assert.equal(secondNoInit.verification.initMessagesObserved, 1);
  assert.equal(secondNoInit.verification.turnsSent, 2);
});

test('a scenario failure keeps its own code whatever the authentication shows', async () => {
  const forgot = await twoTurnWithSources('no-nonce', ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'], false);
  assert.equal(forgot.code, 2);
  assert.equal(forgot.verification.status, 'verified');
  assert.equal(forgot.record.continuity.secondAnswerContainsNonce, false);

  const forgotAndMismatched = await twoTurnWithSources('no-nonce-mismatch', ['none', 'none'], false);
  assert.equal(forgotAndMismatched.code, 2);
  assert.equal(forgotAndMismatched.verification.status, 'mismatch');
  assert.equal(forgotAndMismatched.verification.exitCode, 2);
});

test('cancel-reply with an API-key approval is not a success when apiKeySource differs or is not observed', async () => {
  for (const [source, status] of [
    ['none', 'mismatch'],
    ['no-init', 'unconfirmed'],
  ] as const) {
    const { queryFn, spawnProcess } = fakeSdk(async function* (call) {
      if (source !== 'no-init') {
        yield init(call, source);
      }
      yield delta(call, 'File one does');
      await call.interrupted;
      yield result(call, { subtype: 'error_during_execution', is_error: true, errors: ['aborted'] });
    });
    const logPath = path.join(tempRoot(`s1-cr-${source}-log`), 'record.json');
    const code = await scenarioCancelReply(workspace(`s1-cr-${source}`), logPath, {
      provider: 'claude',
      authorization: { kind: 'api-key', approval: 'test-only reference' },
      env: scenarioEnv({ ANTHROPIC_API_KEY: 'sk-ant-synthetic-s1' }),
      claudeQueryFn: queryFn,
      claudeSpawnProcess: spawnProcess,
      afterTerminalWatchMs: 20,
    });
    const record = readRecord(logPath);
    assert.equal(record.verdict.terminalStatusCancelled, true, 'the scenario itself succeeded');
    assert.equal(code, EXIT_AUTHENTICATION_UNVERIFIED, source);
    assert.equal(record.authenticationVerification.status, status);
    assert.equal(record.authenticationVerification.scenarioExitCode, 0);
  }
});

// --- Observations bound to runs, and the subscription observation check ------------

test('two init messages in one run and none in the other neither verify nor show continuity', async () => {
  // The case an independent review reproduced: equal totals, wrong owners.
  const twice = await twoTurnWithSources('twice-then-none', [['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'], []]);
  assert.notEqual(twice.code, 0);
  assert.notEqual(twice.verification.status, 'verified');
  assert.equal(twice.verification.status, 'unconfirmed');
  assert.match(twice.verification.reason, /turn-1 has 2, turn-2 has 0/);
  assert.equal(twice.record.continuity.sameProviderSessionBothTurns, false);
  assert.match(twice.record.continuity.sameProviderSessionReason, /turn-1 has 2, turn-2 has 0/);
  // The raw observations stay, per run and in arrival order: both from turn one's run.
  const turnOneRun = twice.record.turns[0].runId;
  assert.deepEqual(
    twice.verification.observedPerInit.map((entry: { dspatchRunId: string }) => entry.dspatchRunId),
    [turnOneRun, turnOneRun],
  );
  assert.deepEqual(
    twice.record.claude.initObservations.map((entry: { arrival: number; dspatchRunId: string }) => [entry.arrival, entry.dspatchRunId]),
    [[0, turnOneRun], [1, turnOneRun]],
  );
  // The scenario's own continuity check fails first, so its code stands.
  assert.equal(twice.code, 2);
});

const SYNTHETIC_EMAIL = 'person@example.invalid';
const SYNTHETIC_ORGANIZATION = 'Synthetic Organization AB';

/**
 * An account answer meeting the accepted rule (Niclas, 22 Oct 2026), shaped as the
 * 22 Oct 2026 probe reported it — `tokenSource` and `apiKeySource` absent — with
 * the two fields DSpatch must never copy. Synthetic apart from the three values the
 * rule names, which are the SDK's documented names and the observed plan name.
 */
const acceptedAccount = (overrides: Record<string, unknown> = {}) => ({
  email: SYNTHETIC_EMAIL,
  organization: SYNTHETIC_ORGANIZATION,
  subscriptionType: 'Claude Max',
  apiProvider: 'firstParty',
  ...overrides,
});

function assertNoAccountIdentity(record: Record<string, any>): void {
  const text = JSON.stringify(record);
  assert.equal(text.includes(SYNTHETIC_EMAIL), false, 'email recorded');
  assert.equal(text.includes(SYNTHETIC_ORGANIZATION), false, 'organization recorded');
}

test('a subscription-authorized run is verified when every turn meets the accepted rule; a missing tokenSource is recorded, not blocking', async () => {
  const absent = await twoTurnWithSources('sub-accepted', ['none', 'none'], true, {
    account: () => acceptedAccount(),
  });
  assert.equal(absent.code, 0, JSON.stringify(absent.verification));
  assert.equal(absent.record.exitCode, 0);
  assert.equal(absent.verification.status, 'verified');
  assert.equal(absent.verification.subscriptionEvidence, 'rule-met');
  assert.equal(absent.verification.scenarioExitCode, 0);
  assert.equal(absent.verification.exitCode, 0);
  assert.deepEqual(absent.verification.acceptedRule, {
    initApiKeySource: 'none',
    accountApiProvider: 'firstParty',
    accountSubscriptionType: 'Claude Max',
  });
  assert.match(absent.verification.ruleBasis, /Niclas, 22 Oct 2026/);
  assert.match(absent.verification.ruleBasis, /judged per turn/);
  assert.match(absent.verification.ruleBasis, /not a billing proof/);
  assert.match(absent.verification.note, /not a billing proof/);
  assert.match(absent.record.authorizationScope, /personal, single-user use/);
  assert.match(absent.record.authorizationScope, /Not a basis for distributing DSpatch/);
  assert.match(absent.verification.authorizationScope, /personal, single-user use/);
  // Judged per turn: each turn met the rule by its own run; neither got a tokenSource.
  assert.deepEqual(
    absent.verification.observedPerTurn.map((entry: { turn: string; meetsAcceptedRule: boolean; tokenSourceObserved: boolean | null }) => [entry.turn, entry.meetsAcceptedRule, entry.tokenSourceObserved]),
    [['turn-1', true, false], ['turn-2', true, false]],
  );
  assert.deepEqual(absent.verification.observedPerTurn[0].account.fields, {
    apiProvider: 'firstParty',
    subscriptionType: 'Claude Max',
    tokenSource: null,
    apiKeySource: null,
  });
  assert.deepEqual(absent.verification.observedValues, {
    apiProvider: ['firstParty'],
    subscriptionType: ['Claude Max'],
    tokenSource: [null],
    accountApiKeySource: [null],
    initApiKeySource: ['none'],
    tokenSourceObserved: false,
  });
  assert.match(absent.verification.tokenSourceNote, /optional/);
  assert.match(absent.verification.tokenSourceNote, /does not block/);
  assert.match(absent.verification.reason, /tokenSource was not sent \(recorded, not blocking\)/);
  assert.deepEqual(absent.verification.findings, { conflicts: [], mismatches: [], gaps: [] });
  assert.equal(absent.record.continuity.sameProviderSessionBothTurns, true);
  assertNoAccountIdentity(absent.record);

  // The same rule with the optional fields present: verified as well, and recorded.
  const present = await twoTurnWithSources('sub-accepted-token', ['none', 'none'], true, {
    account: () => acceptedAccount({ tokenSource: 'synthetic-token-source', apiKeySource: 'none' }),
  });
  assert.equal(present.code, 0, JSON.stringify(present.verification));
  assert.equal(present.verification.status, 'verified');
  assert.equal(present.verification.tokenSourceNote, null);
  assert.deepEqual(present.verification.observedValues, {
    apiProvider: ['firstParty'],
    subscriptionType: ['Claude Max'],
    tokenSource: ['synthetic-token-source'],
    accountApiKeySource: ['none'],
    initApiKeySource: ['none'],
    tokenSourceObserved: true,
  });
  assert.deepEqual(
    present.verification.observedPerTurn.map((entry: { tokenSourceObserved: boolean | null }) => entry.tokenSourceObserved),
    [true, true],
  );
  assertNoAccountIdentity(present.record);
});

test('a subscriptionType outside the accepted rule is a mismatch, and a conflict wins over it', async () => {
  const pro = await twoTurnWithSources('sub-pro', ['none', 'none'], true, {
    account: () => acceptedAccount({ subscriptionType: 'Claude Pro' }),
  });
  assert.equal(pro.verification.status, 'mismatch');
  assert.equal(pro.verification.subscriptionEvidence, 'mismatch');
  assert.match(pro.verification.reason, /subscriptionType 'Claude Pro' is not 'Claude Max'/);
  assert.match(pro.verification.reason, /not evidence of an API path, but not the accepted plan/);
  assert.equal(pro.verification.scenarioExitCode, 0);
  assert.equal(pro.code, EXIT_AUTHENTICATION_UNVERIFIED);
  assert.equal(pro.record.exitCode, EXIT_AUTHENTICATION_UNVERIFIED);
  assert.equal(pro.verification.findings.mismatches.length, 2);
  assertNoAccountIdentity(pro.record);

  // One turn outside the rule is enough; the other turn's own result is still recorded.
  const secondPro = await twoTurnWithSources('sub-pro-second', ['none', 'none'], true, {
    account: (index) => acceptedAccount(index === 1 ? { subscriptionType: 'Claude Pro' } : {}),
  });
  assert.equal(secondPro.verification.status, 'mismatch');
  assert.deepEqual(
    secondPro.verification.observedPerTurn.map((entry: { meetsAcceptedRule: boolean }) => entry.meetsAcceptedRule),
    [true, false],
  );
  assert.equal(secondPro.code, EXIT_AUTHENTICATION_UNVERIFIED);

  // A conflicting observation takes precedence over a mismatch.
  const both = await twoTurnWithSources('sub-pro-bedrock', ['none', 'none'], true, {
    account: () => acceptedAccount({ subscriptionType: 'Claude Pro', apiProvider: 'bedrock' }),
  });
  assert.equal(both.verification.status, 'conflicting');
  assert.equal(both.verification.subscriptionEvidence, 'conflicting');
  assert.match(both.verification.reason, /accountInfo apiProvider 'bedrock'/);
  assert.equal(both.verification.findings.mismatches.length, 2);
  assert.equal(both.code, EXIT_AUTHENTICATION_UNVERIFIED);
});

test('a subscription-authorized run fails on an observed API-key source or a non-firstParty provider', async () => {
  const cases = [
    { name: 'sub-init-key', sources: ['none', 'ANTHROPIC_API_KEY'], account: () => acceptedAccount(), match: /init message apiKeySource 'ANTHROPIC_API_KEY'/ },
    { name: 'sub-account-key', sources: ['none', 'none'], account: () => acceptedAccount({ apiKeySource: '/login managed key' }), match: /accountInfo apiKeySource '\/login managed key'/ },
    { name: 'sub-provider', sources: ['none', 'none'], account: (index: number) => acceptedAccount(index === 1 ? { apiProvider: 'bedrock' } : {}), match: /accountInfo apiProvider 'bedrock'/ },
  ];
  for (const { name, sources, account, match } of cases) {
    const run = await twoTurnWithSources(name, sources, true, { account });
    assert.equal(run.verification.status, 'conflicting', name);
    assert.equal(run.verification.subscriptionEvidence, 'conflicting', name);
    assert.match(run.verification.reason, match, name);
    assert.equal(run.verification.scenarioExitCode, 0, name);
    assert.equal(run.code, EXIT_AUTHENTICATION_UNVERIFIED, name);
    assert.match(run.verification.ruleBasis, /22 Oct 2026/, name);
    assertNoAccountIdentity(run.record);
  }
});

test('missing or incomplete account information leaves a subscription-authorized run unconfirmed', async () => {
  const cases = [
    { name: 'sub-no-method', account: () => undefined, match: /offers no accountInfo\(\)/, perTurn: [false, false] },
    { name: 'sub-unavailable-second', account: (index: number) => (index === 1 ? new Error('synthetic failure') : acceptedAccount()), match: /turn-2: account information unavailable \(accountInfo\(\) failed: Error\)/, perTurn: [true, false] },
    { name: 'sub-no-plan', account: () => acceptedAccount({ subscriptionType: undefined }), match: /accountInfo has no subscriptionType/, perTurn: [false, false] },
    { name: 'sub-no-provider-second', account: (index: number) => acceptedAccount(index === 1 ? { apiProvider: undefined } : {}), match: /turn-2: accountInfo has no apiProvider/, perTurn: [true, false] },
  ];
  for (const { name, account, match, perTurn } of cases) {
    const run = await twoTurnWithSources(name, ['none', 'none'], true, { account });
    assert.equal(run.verification.status, 'unconfirmed', name);
    assert.equal(run.verification.subscriptionEvidence, 'insufficient', name);
    assert.match(run.verification.reason, match, name);
    assert.equal(run.verification.scenarioExitCode, 0, name);
    assert.equal(run.code, EXIT_AUTHENTICATION_UNVERIFIED, name);
    // One accepted turn never stands in for the other.
    assert.deepEqual(
      run.verification.observedPerTurn.map((entry: { meetsAcceptedRule: boolean }) => entry.meetsAcceptedRule),
      perTurn,
      name,
    );
    assertNoAccountIdentity(run.record);
  }
  // An init message without apiKeySource is a gap too, even with an accepted account.
  const noField = await twoTurnWithSources('sub-init-no-field', ['none', null], true, { account: () => acceptedAccount() });
  assert.equal(noField.verification.status, 'unconfirmed');
  assert.equal(noField.verification.subscriptionEvidence, 'insufficient');
  assert.match(noField.verification.reason, /turn-2: no apiKeySource in the init message/);
  assert.equal(noField.code, EXIT_AUTHENTICATION_UNVERIFIED);

  // Turn one accepted, turn two without an init message of its own: unconfirmed, no
  // continuity, and the scenario's own 2 stands.
  const noInit = await twoTurnWithSources('sub-no-init-second', ['none', 'no-init'], true, { account: () => acceptedAccount() });
  assert.equal(noInit.verification.status, 'unconfirmed');
  assert.match(noInit.verification.reason, /turn-2: 0 init messages, not exactly one/);
  assert.deepEqual(
    noInit.verification.observedPerTurn.map((entry: { meetsAcceptedRule: boolean }) => entry.meetsAcceptedRule),
    [true, false],
  );
  assert.equal(noInit.record.continuity.sameProviderSessionBothTurns, false);
  assert.equal(noInit.code, 2);

  // Two init messages in turn one and none in turn two: equal totals, wrong owners, never verified.
  const twice = await twoTurnWithSources('sub-twice-then-none', [['none', 'none'], []], true, { account: () => acceptedAccount() });
  assert.equal(twice.verification.status, 'unconfirmed');
  assert.match(twice.verification.reason, /turn-1: 2 init messages, not exactly one; turn-2: 0 init messages, not exactly one/);
  assert.equal(twice.record.continuity.sameProviderSessionBothTurns, false);
  assert.equal(twice.code, 2);
});

test('a subscription-authorized scenario failure keeps its own code, verified or not', async () => {
  // The nonce is not returned: the scenario's 2 stands although the rule was met.
  const forgot = await twoTurnWithSources('sub-no-nonce', ['none', 'none'], false, { account: () => acceptedAccount() });
  assert.equal(forgot.code, 2);
  assert.equal(forgot.verification.status, 'verified');
  assert.equal(forgot.verification.scenarioExitCode, 2);
  assert.equal(forgot.verification.exitCode, 2);
  assert.equal(forgot.record.continuity.secondAnswerContainsNonce, false);
  const forgotConflicting = await twoTurnWithSources('sub-no-nonce-conflict', ['ANTHROPIC_API_KEY', 'none'], false, {
    account: () => acceptedAccount(),
  });
  assert.equal(forgotConflicting.code, 2);
  assert.equal(forgotConflicting.verification.status, 'conflicting');
  assert.equal(forgotConflicting.verification.exitCode, 2);
});

// --- DSP-115: a follow-up turn after a confirmed cancel ----------------------------

/** A provider session ID the follow-up's init message reports instead of the resumed one. */
const OTHER_PROVIDER_SESSION = '00000000-0000-4000-8000-0000000000ff';

/**
 * The first query streams text until it is interrupted, then its stream and its
 * process end (`stopped`); the second answers with the marker its session was
 * given in the first prompt, unless told otherwise. Every query reports an
 * account that meets the accepted subscription rule.
 */
function followUpSdk(behaviour: { readonly recall?: boolean; readonly reportSession?: string } = {}) {
  const remembered = new Map<string, string>();
  return fakeSdk(async function* (call, index) {
    const session = sessionOf(call);
    if (index === 0) {
      yield init(call);
      const marker = /reference code for this request is ([A-Z0-9]+)/.exec(call.prompt)?.[1];
      if (marker !== undefined) {
        remembered.set(session, marker);
      }
      yield delta(call, 'File one does');
      await call.interrupted;
      // The stream ends; the substitute's process exits with it (code 0).
      return;
    }
    yield init(call, 'none', behaviour.reportSession === undefined ? {} : { session_id: behaviour.reportSession });
    const answer = behaviour.recall === false ? 'I do not know' : (remembered.get(session) ?? 'I do not know');
    yield delta(call, answer);
    yield assistant(call, [{ type: 'text', text: answer }]);
    yield result(call, { result: answer });
  }, () => acceptedAccount());
}

const SUBSCRIPTION = { kind: 'subscription' as const, authorization: 'test-only reference' };

async function cancelThenFollowUp(name: string, behaviour: { readonly recall?: boolean; readonly reportSession?: string } = {}) {
  const sdk = followUpSdk(behaviour);
  const logPath = path.join(tempRoot(`fu-${name}-log`), 'record.json');
  const code = await scenarioCancelThenFollowUp(workspace(`fu-${name}`), logPath, {
    provider: 'claude',
    authorization: SUBSCRIPTION,
    env: scenarioEnv(),
    claudeQueryFn: sdk.queryFn,
    claudeSpawnProcess: sdk.spawnProcess,
    afterTerminalWatchMs: 20,
  });
  return { code, record: readRecord(logPath), calls: sdk.calls };
}

test('cancel-then-follow-up: after a stopped cancel with a process exit, one follow-up resumes the same session and recalls the marker', async () => {
  const { code, record, calls } = await cancelThenFollowUp('stopped');
  assert.equal(code, 0, JSON.stringify(record.failure ?? record.verdict));
  assert.equal(record.exitCode, 0);
  const marker: string = record.marker;
  assert.match(marker, /^[A-Z0-9]{10}$/);

  // The cancel-reply part: unchanged criteria, ended stopped by the process exit.
  assert.deepEqual(record.verdict, {
    cancelledAfterTextBegan: true,
    terminalStatusCancelled: true,
    noContentChange: true,
    toolCallStartedAfterCancelResolved: false,
    end: 'stopped',
    endUnconfirmed: false,
    followUpStarted: true,
    followUpFinished: true,
    followUpSameProviderSession: true,
    followUpRecalledMarker: true,
  });
  assert.equal(record.cancellation.endEvidence.kind, 'process-exit');
  assert.equal(calls[0]?.interrupts, 1);

  // Exactly one follow-up query, resuming the session the first turn started.
  assert.equal(calls.length, 2);
  const providerSessionId: string = record.session.providerSessionId;
  assert.equal(calls[0]?.options['sessionId'], providerSessionId);
  assert.equal(calls[1]?.options['resume'], providerSessionId);
  assert.equal(calls[1]?.options['sessionId'], undefined);
  assert.ok(calls[0]?.prompt.includes(marker), 'the first prompt carries the marker');
  assert.ok(calls[0]?.prompt.includes(CANCEL_REPLY_PROMPT), 'and the cancel-reply instruction');
  assert.equal(calls[1]?.prompt, FOLLOW_UP_PROMPT);
  assert.equal(calls[1]?.prompt.includes(marker), false, 'the follow-up does not repeat the marker');

  // Same adapter instance and DSpatch session: both runs are in this session's record.
  const [first, second] = record.turns;
  assert.deepEqual(record.turns.map((turn: { label: string }) => turn.label), ['cancelled-reply', 'follow-up']);
  assert.deepEqual(
    record.claude.initObservations.map((entry: { dspatchRunId: string }) => entry.dspatchRunId),
    [first.runId, second.runId],
  );

  const followUp = record.followUp;
  assert.equal(followUp.started, true);
  assert.equal(followUp.dspatchRunId, second.runId);
  assert.equal(followUp.terminalStatus, 'finished');
  assert.equal(followUp.prompt, FOLLOW_UP_PROMPT);
  assert.equal(followUp.promptContainsMarker, false);
  assert.equal(followUp.initMessages, 1);
  assert.equal(followUp.session_id, providerSessionId);
  assert.equal(followUp.apiKeySource, 'none');
  assert.equal(followUp.firstTurnProviderSessionId, providerSessionId);
  assert.equal(followUp.sameProviderSessionAsFirstTurn, true);
  assert.equal(followUp.answer, marker);
  assert.equal(followUp.answerContainsMarker, true);
  assert.equal(followUp.toolCallsStarted, 0);
  assert.deepEqual(followUp.toolCalls, []);
  assert.equal(followUp.results.length, 1);
  assert.equal(followUp.results[0].subtype, 'success');
  assert.equal(followUp.results[0].usage.output_tokens, 7);
  assert.match(followUp.results[0].totalCostNote, /not a charge/);
  assert.equal(followUp.usageEvents.length, 1);

  // The authentication rule, judged for both turns by their own runs.
  assert.equal(record.authenticationVerification.status, 'verified');
  assert.deepEqual(
    record.authenticationVerification.observedPerTurn.map((entry: { turn: string; meetsAcceptedRule: boolean }) => [entry.turn, entry.meetsAcceptedRule]),
    [['cancelled-reply', true], ['follow-up', true]],
  );
  assertNoAccountIdentity(record);
});

test('cancel-then-follow-up: an answer without the marker, or another provider session, is not a success', async () => {
  const forgot = await cancelThenFollowUp('forgot', { recall: false });
  assert.equal(forgot.code, 2);
  assert.equal(forgot.record.exitCode, 2);
  assert.equal(forgot.calls.length, 2);
  assert.equal(forgot.record.followUp.terminalStatus, 'finished');
  assert.equal(forgot.record.followUp.sameProviderSessionAsFirstTurn, true);
  assert.equal(forgot.record.followUp.answerContainsMarker, false);
  assert.equal(forgot.record.verdict.followUpRecalledMarker, false);
  // The scenario's own 2 stands although authentication was verified.
  assert.equal(forgot.record.authenticationVerification.status, 'verified');
  assert.equal(forgot.record.authenticationVerification.scenarioExitCode, 2);

  const elsewhere = await cancelThenFollowUp('other-session', { reportSession: OTHER_PROVIDER_SESSION });
  assert.equal(elsewhere.code, 2);
  assert.equal(elsewhere.record.exitCode, 2);
  const followUp = elsewhere.record.followUp;
  assert.equal(followUp.terminalStatus, 'finished');
  assert.equal(followUp.answerContainsMarker, true);
  assert.equal(followUp.session_id, OTHER_PROVIDER_SESSION);
  assert.equal(followUp.firstTurnProviderSessionId, elsewhere.record.session.providerSessionId);
  assert.equal(followUp.sameProviderSessionAsFirstTurn, false);
  assert.match(followUp.sameProviderSessionReason, /reported session_id/);
  assert.equal(elsewhere.record.verdict.followUpSameProviderSession, false);
});

test('cancel-then-follow-up: a forced or unconfirmed end starts no follow-up and is recorded as a non-zero outcome', async () => {
  // Forced: interrupt() rejects, the abort ends the stream and the process exits.
  const forced = fakeSdk(
    async function* (call) {
      yield init(call);
      yield delta(call, 'File one does');
      await untilAborted(call.options['abortController'].signal);
    },
    () => acceptedAccount(),
    () => new Error('control channel closed'),
  );
  const forcedLog = path.join(tempRoot('fu-forced-log'), 'record.json');
  const forcedCode = await scenarioCancelThenFollowUp(workspace('fu-forced'), forcedLog, {
    provider: 'claude',
    authorization: SUBSCRIPTION,
    env: scenarioEnv(),
    claudeQueryFn: forced.queryFn,
    claudeSpawnProcess: forced.spawnProcess,
    afterTerminalWatchMs: 20,
  });
  const forcedRecord = readRecord(forcedLog);
  assert.equal(forcedCode, 2);
  assert.equal(forcedRecord.exitCode, 2);
  assert.equal(forced.calls.length, 1, 'no follow-up query()');
  assert.equal(forcedRecord.cancellation.end, 'forced');
  assert.equal(forcedRecord.followUp.started, false);
  assert.match(forcedRecord.followUp.reason, /'forced'/);
  assert.equal(forcedRecord.verdict.followUpStarted, false);
  assert.equal(forcedRecord.turns.length, 1);

  // Unconfirmed: the process never exits, through the interrupt, abort and kill bounds.
  const timers = new ManualTimers();
  const held = fakeSdk(async function* (call) {
    call.holdProcess = true;
    yield init(call);
    yield delta(call, 'File one does');
    // The stream stays open until dispose closes the query.
    await call.closed;
  }, () => acceptedAccount());
  const heldLog = path.join(tempRoot('fu-unconfirmed-log'), 'record.json');
  const running = scenarioCancelThenFollowUp(workspace('fu-unconfirmed'), heldLog, {
    provider: 'claude',
    authorization: SUBSCRIPTION,
    env: scenarioEnv(),
    claudeQueryFn: held.queryFn,
    claudeSpawnProcess: held.spawnProcess,
    claudeTimers: timers,
    afterTerminalWatchMs: 20,
  });
  await until(() => held.calls[0]?.interrupts === 1, 'the interrupt');
  await timers.advance(CANCEL_INTERRUPT_WAIT_MS);
  await timers.advance(CANCEL_ABORT_WAIT_MS);
  await timers.advance(CANCEL_KILL_WAIT_MS);
  const heldCode = await running;
  const heldRecord = readRecord(heldLog);
  assert.equal(heldCode, 2);
  assert.equal(held.calls.length, 1, 'no follow-up query()');
  assert.deepEqual(held.calls[0]?.child.kills, ['SIGKILL']);
  assert.equal(heldRecord.cancellation.end, 'unconfirmed');
  assert.equal(heldRecord.followUp.started, false);
  assert.match(heldRecord.followUp.reason, /'unconfirmed'/);
  assert.equal(heldRecord.turns.length, 1);
});

test('the cancel-then-follow-up command line reaches the new path and runs the cancel and then the follow-up', async () => {
  const sdk = followUpSdk();
  const dir = workspace('fu-command');
  const logPath = path.join(tempRoot('fu-command-log'), 'record.json');
  const argv = [
    'cancel-then-follow-up',
    dir,
    logPath,
    '--provider=claude',
    '--subscription-authorization=test-only reference',
  ];
  assert.deepEqual(parseScenarioArgs(argv), {
    positional: ['cancel-then-follow-up', dir, logPath],
    options: { provider: 'claude', authorization: SUBSCRIPTION },
  });
  const code = await runScenarioCommand(argv, {
    env: scenarioEnv(),
    claudeQueryFn: sdk.queryFn,
    claudeSpawnProcess: sdk.spawnProcess,
    afterTerminalWatchMs: 20,
  });
  const record = readRecord(logPath);
  assert.equal(code, 0, JSON.stringify(record.failure ?? record.verdict));
  assert.match(record.scenario, /cancel-then-follow-up/);
  assert.equal(record.authentication.authorization.kind, 'subscription');
  assert.equal(sdk.calls.length, 2);
  assert.equal(sdk.calls[0]?.interrupts, 1, 'the first turn was cancelled');
  assert.equal(record.cancellation.end, 'stopped');
  assert.equal(sdk.calls[1]?.options['resume'], record.session.providerSessionId);
  assert.equal(record.followUp.answerContainsMarker, true);

  // The provider flag is accepted for the new subcommand; the old one is untouched.
  await assert.rejects(
    runScenarioCommand(['net-shell', dir, logPath, '--provider=claude', '--subscription-authorization=r']),
    /applies only to code-change, cancel-reply, two-turn, cancel-then-follow-up/,
  );
});
