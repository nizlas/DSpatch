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
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  assessAuthentication,
  ClaudeAgentSdkAdapter,
  FIXTURE_PERMISSIONS,
  providerEnvironment,
  providerSessionIdFor,
} from '../src/adapter/claude-agent-sdk-adapter.ts';
import type { AgentEvent } from '../src/adapter/types.ts';
import {
  EXIT_REFUSED,
  parseScenarioArgs,
  readSourceRevision,
  scenarioCancelReply,
  scenarioTwoTurn,
} from '../src/main/experiment-work.ts';
import { tempRoot } from './support/fixtures.ts';

// --- A substitute query() ------------------------------------------------------

interface Call {
  readonly prompt: string;
  readonly options: Record<string, any>;
}

type Script = (call: Call, index: number) => AsyncGenerator<unknown, void>;

function fakeSdk(script: Script) {
  const calls: Call[] = [];
  const queryFn = (params: { prompt: string; options: Record<string, any> }) => {
    const call = { prompt: params.prompt, options: params.options };
    calls.push(call);
    const generator = script(call, calls.length - 1);
    return Object.assign(generator, { close: () => undefined });
  };
  return { queryFn: queryFn as any, calls };
}

const sessionOf = (call: Call): string => call.options.sessionId ?? call.options.resume;

const init = (call: Call) => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionOf(call),
  apiKeySource: 'none',
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
  const { queryFn, calls } = fakeSdk(async function* (call) {
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
    assert.equal(options['includePartialMessages'], true);
    assert.equal(options['canUseTool'], undefined);
    assert.equal(options['allowDangerouslySkipPermissions'], undefined);
    assert.ok(options['abortController'] instanceof AbortController);
    assert.equal('ANTHROPIC_API_KEY' in (options['env'] ?? {}), false);

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
  const { queryFn, calls } = fakeSdk(async function* (call, index) {
    yield init(call);
    if (index === 0) {
      await gate;
    }
    yield result(call);
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
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

test('abort through cancel() ends the turn as cancelled', async () => {
  const { queryFn, calls } = fakeSdk(async function* (call) {
    yield init(call);
    yield delta(call, 'Starting a long answer');
    await untilAborted(call.options['abortController'].signal);
    throw abortError();
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('cancel')));
    const seen = collect(adapter, handle.dspatchSessionId);
    const finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'Write a lot');
    while (!seen.events.some((event) => event.type === 'assistant.delta')) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await adapter.cancel(handle.dspatchSessionId);
    assert.equal(calls[0]?.options['abortController'].signal.aborted, true);
    await finished;
    const last = seen.events.at(-1);
    assert.equal(last?.type === 'run.finished' ? last.status : null, 'cancelled');
    assert.equal(adapter.hasActiveRun(handle.dspatchSessionId), false);
  } finally {
    await adapter.dispose();
  }
});

test('an error result after abort is still reported as cancelled; without abort it is an error', async () => {
  const { queryFn } = fakeSdk(async function* (call, index) {
    yield init(call);
    if (index === 0) {
      await untilAborted(call.options['abortController'].signal);
    }
    yield result(call, { subtype: 'error_during_execution', is_error: true, errors: ['interrupted'] });
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
  try {
    const handle = await adapter.startSession(startConfig(workspace('cancel-result')));
    const seen = collect(adapter, handle.dspatchSessionId);
    let finished = seen.nextFinish();
    await adapter.send(handle.dspatchSessionId, 'one');
    await adapter.cancel(handle.dspatchSessionId);
    await finished;
    let last = seen.events.at(-1);
    assert.equal(last?.type === 'run.finished' ? last.status : null, 'cancelled');

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
  const { queryFn, calls } = fakeSdk(async function* () {});
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
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
  const { queryFn } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call, { usage: { input_tokens: 5 } });
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
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
  const { queryFn, calls } = fakeSdk(async function* (call) {
    yield init(call);
    await untilAborted(call.options['abortController'].signal);
    throw abortError();
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
  const handle = await adapter.startSession(startConfig(workspace('dispose')));
  await adapter.send(handle.dspatchSessionId, 'run until stopped');
  await adapter.dispose();
  assert.equal(calls[0]?.options['abortController'].signal.aborted, true);
  await adapter.dispose();
  await assert.rejects(adapter.startSession(startConfig(workspace('after'))), /disposed/);
});

const lastFinished = (events: AgentEvent[]) => {
  const last = events.at(-1);
  return last?.type === 'run.finished' ? last.status : null;
};
const finalTexts = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === 'assistant.message' ? [event.text] : []));

test('a cancelled run keeps the interrupted block\'s streamed text after a completed block', async () => {
  const partial = 'Partial explanation that should survive.';
  const { queryFn } = fakeSdk(async function* (call) {
    yield init(call);
    yield delta(call, 'Intro. ');
    yield assistant(call, [{ type: 'text', text: 'Intro. ' }]);
    yield delta(call, partial);
    await untilAborted(call.options['abortController'].signal);
    // The stream ends before the second block completes.
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
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
  const { queryFn } = fakeSdk(async function* (call, index) {
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
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
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
  const { queryFn, calls } = fakeSdk(async function* () {});
  const withKey = new ClaudeAgentSdkAdapter({ queryFn, env: { ...CLEAN_ENV, ANTHROPIC_API_KEY: 'k' } });
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
  const { queryFn, calls } = fakeSdk(async function* () {});
  const adapter = new ClaudeAgentSdkAdapter({
    queryFn,
    env: { ...CLEAN_ENV, claude_code_oauth_token: 't' },
    caseInsensitiveEnv: true,
  });
  await assert.rejects(adapter.startSession(startConfig(workspace('case'))), /does not reuse Claude Code/);
  await adapter.dispose();
  assert.equal(calls.length, 0);
});

test('a turn cancelled before query() is called never calls it and ends as cancelled', async () => {
  const { queryFn, calls } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call);
  });
  const adapter = new ClaudeAgentSdkAdapter({ queryFn, env: CLEAN_ENV });
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
    await adapter.send(handle.dspatchSessionId, 'never sent');
    await finished;
    assert.equal(calls.length, 0);
    const last = seen.events.at(-1);
    assert.equal(last?.type === 'run.finished' ? last.status : null, 'cancelled');
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
  const { queryFn, calls } = fakeSdk(async function* () {});
  const dir = workspace('cr-refused');
  const logPath = path.join(tempRoot('cr-refused-log'), 'record.json');
  const secret = 'sk-ant-should-never-appear';
  const code = await scenarioCancelReply(dir, logPath, {
    provider: 'claude',
    env: scenarioEnv({ ANTHROPIC_API_KEY: secret }),
    claudeQueryFn: queryFn,
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
  const { queryFn, calls } = fakeSdk(async function* () {});
  const logPath = path.join(tempRoot('tt-refused-log'), 'record.json');
  const code = await scenarioTwoTurn(workspace('tt-refused'), logPath, {
    provider: 'claude',
    env: scenarioEnv(),
    claudeQueryFn: queryFn,
  });
  assert.equal(code, EXIT_REFUSED);
  assert.equal(calls.length, 0);
  assert.match(readRecord(logPath).authentication.refusal, /No authorized authentication path/);
});

test('cancel-reply cancels after text began and records what came after', async () => {
  const { queryFn } = fakeSdk(async function* (call) {
    yield init(call);
    // A tool call first: the scenario must not cancel on it.
    yield assistant(call, [{ type: 'tool_use', id: 't-1', name: 'Read', input: {} }]);
    yield toolResult(call, 't-1');
    yield delta(call, 'File one does');
    await untilAborted(call.options['abortController'].signal);
    // A macrotask later, so "after cancel() resolved" is an ordering, not a race.
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Work that arrives after cancel() resolved, then the terminal result, then a straggler.
    yield assistant(call, [{ type: 'tool_use', id: 't-2', name: 'Glob', input: {} }]);
    yield result(call, { subtype: 'error_during_execution', is_error: true, errors: ['aborted'] });
    yield delta(call, ' late text');
  });
  const dir = workspace('cr-run');
  const logPath = path.join(tempRoot('cr-run-log'), 'record.json');
  const code = await scenarioCancelReply(dir, logPath, {
    provider: 'claude',
    authorization: { kind: 'api-key', approval: 'test-only reference' },
    env: scenarioEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-value' }),
    claudeQueryFn: queryFn,
    afterTerminalWatchMs: 20,
  });
  const record = readRecord(logPath);
  assert.equal(code, 0, JSON.stringify(record.failure ?? record.verdict));
  assert.equal(JSON.stringify(record).includes('sk-ant-test-value'), false);
  assert.deepEqual(record.verdict, {
    cancelledAfterTextBegan: true,
    terminalStatusCancelled: true,
    noContentChange: true,
    toolCallStartedAfterCancelResolved: true,
  });
  const turn = record.turns[0];
  assert.ok(turn.firstActivityMs <= turn.firstTextMs, 'the tool call came before the text');
  assert.deepEqual(
    record.cancellation.toolCallsStartedAfterCancelResolved.map((call: { name: string }) => call.name),
    ['Glob'],
  );
  assert.deepEqual(
    record.cancellation.eventsAfterTerminal.map((event: { type: string }) => event.type),
    ['assistant.delta'],
  );
  assert.equal(typeof record.cancellation.terminalEventMsAfterCancelCall, 'number');
  assert.equal(record.claude.init.permissionMode, 'dontAsk');
  assert.equal(record.claude.toolsMatchConfigured, true);
  assert.equal(record.claude.agentOrTaskToolPresent, false);
  assert.equal(record.claude.managedPolicy, 'not shown in the init message');
  assert.deepEqual(record.claude.providerState.observedTranscriptFiles, []);
  assert.equal(record.claude.providerState.configDirSource, 'CLAUDE_CONFIG_DIR');
});

test('two-turn asks for the nonce back in a second send on the same session', async () => {
  const remembered = new Map<string, string>();
  const { queryFn, calls } = fakeSdk(async function* (call) {
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
  });
  const record = readRecord(logPath);
  assert.equal(code, 0, JSON.stringify(record.failure ?? record.continuity));
  assert.equal(record.continuity.secondAnswerContainsNonce, true);
  assert.equal(record.continuity.sameProviderSessionBothTurns, true);
  assert.match(record.crossProcessResume, /not tested/);
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
  const { queryFn } = fakeSdk(async function* (call) {
    yield init(call);
    yield result(call);
  });
  assert.equal(
    await scenarioTwoTurn(workspace('rev-refused'), refusedLog, {
      provider: 'claude',
      env: scenarioEnv(),
      claudeQueryFn: queryFn,
      sourceRevision: () => revision,
    }),
    EXIT_REFUSED,
  );
  assert.deepEqual(readRecord(refusedLog).dspatchSource, revision);
  assert.equal(readRecord(refusedLog).authentication.preflight.decision, 'refused');

  // The substitute's init reports 'none', so the expected key source is not matched:
  // the comparison is recorded, not assumed.
  const ranLog = path.join(tempRoot('rev-ran-log'), 'record.json');
  await scenarioTwoTurn(workspace('rev-ran'), ranLog, {
    provider: 'claude',
    authorization: { kind: 'api-key', approval: 'test-only reference' },
    env: scenarioEnv({ ANTHROPIC_API_KEY: 'sk-ant-synthetic' }),
    claudeQueryFn: queryFn,
    sourceRevision: () => revision,
  });
  const ran = readRecord(ranLog);
  assert.deepEqual(ran.dspatchSource, revision);
  assert.equal(ran.claude.apiKeySource.preflightDecision, 'direct-anthropic-api-key');
  assert.equal(ran.claude.apiKeySource.expected, 'ANTHROPIC_API_KEY');
  assert.deepEqual(ran.claude.apiKeySource.observedPerInit, ['none', 'none']);
  assert.equal(ran.claude.apiKeySource.matchesExpected, false);
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
