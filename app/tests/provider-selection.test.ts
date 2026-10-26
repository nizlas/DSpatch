/**
 * Choosing the agent in the main chat (DSP-117): Cursor by default, Claude only in
 * a launch that enabled it, never a resume across providers, and a switch that is a
 * new session with the recap disclosed.
 *
 * SIMULATED: Cursor is a fake adapter here, and Claude is the real
 * `ClaudeAgentSdkAdapter` with its SDK substituted (`queryFn`, `spawnProcess` and
 * `localLookup`, review B1), so no process starts, no Claude profile is read and
 * nothing reaches either provider. The offline guard in `run-tests.mjs` refuses the
 * real Claude SDK and every non-local connection on top of that.
 *
 *     node scripts/run-tests.mjs chat        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  CHAT_PERMISSIONS,
  ClaudeAgentSdkAdapter,
  DISPOSE_BOUND_MS,
} from '../src/adapter/claude-agent-sdk-adapter.ts';
import { CursorSdkAdapter } from '../src/adapter/cursor-sdk-adapter.ts';
import type {
  AgentEvent,
  AgentEventListener,
  CapabilityReport,
  ModelInfo,
  RunReference,
  SessionConfig,
  SessionHandle,
  Unsubscribe,
  UsageReading,
} from '../src/adapter/types.ts';
import { ChatService, CLAUDE_CHAT_MODEL, type ChatAdapter } from '../src/main/chat-service.ts';
import { ConversationStore } from '../src/main/conversation-store.ts';
import { DISPOSE_MARGIN_MS, DISPOSE_TIMEOUT_MS } from '../src/main/dispose-timeout.ts';
import { reviewAdapterFactory } from '../src/main/review-discussion-service.ts';
import type { StoredSessionProvider } from '../src/shared/bridge.ts';
import { claudeSubstitute, type ClaudeSubstitute } from './support/claude-chat-substitute.ts';
import { tempRoot } from './support/fixtures.ts';

const CLEAN_ENV = Object.freeze({ PATH: process.env['PATH'] ?? '' });

/** A Cursor stand-in: records what it was asked, answers a send with one finished turn. */
class FakeCursor implements ChatAdapter {
  readonly id = 'fake-cursor';
  readonly configs: SessionConfig[] = [];
  readonly resumes: string[] = [];
  readonly sent: string[] = [];
  listModelsCalls = 0;
  disposed = false;
  private listener: AgentEventListener | null = null;
  private sessionId = 'dsp-session-cursor';
  private runs = 0;

  capabilities(): CapabilityReport {
    return {
      streaming: 'supported',
      cancel: 'supported',
      resume: 'supported',
      modelSelection: 'supported',
      approvals: 'unsupported',
      usageReporting: 'unknown',
    };
  }

  listModels(): Promise<readonly ModelInfo[]> {
    this.listModelsCalls += 1;
    return Promise.resolve([{ id: 'claude-haiku-4-5', displayName: 'fake', provider: 'cursor' }]);
  }

  startSession(config: SessionConfig): Promise<SessionHandle> {
    this.configs.push(config);
    return Promise.resolve({
      dspatchSessionId: this.sessionId,
      provider: 'cursor',
      providerSessionId: 'agent-fake',
      createdAt: new Date().toISOString(),
    });
  }

  resume(sessionId: string, config: SessionConfig): Promise<SessionHandle> {
    this.resumes.push(sessionId);
    this.configs.push(config);
    this.sessionId = sessionId;
    return Promise.resolve({
      dspatchSessionId: sessionId,
      provider: 'cursor',
      providerSessionId: 'agent-resumed',
      createdAt: new Date().toISOString(),
    });
  }

  subscribe(_sessionId: string, listener: AgentEventListener): Unsubscribe {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  send(_sessionId: string, prompt: string): Promise<RunReference> {
    this.sent.push(prompt);
    this.runs += 1;
    const dspatchRunId = `dsp-run-cursor-${String(this.runs)}`;
    const emit = (partial: Record<string, unknown>): void => {
      this.listener?.({
        dspatchSessionId: this.sessionId,
        dspatchRunId,
        at: new Date().toISOString(),
        rawProviderEvent: null,
        ...partial,
      } as unknown as AgentEvent);
    };
    emit({ type: 'run.started' });
    setImmediate(() => {
      emit({ type: 'assistant.message', text: 'a Cursor answer' });
      emit({ type: 'run.finished', status: 'finished' });
    });
    return Promise.resolve({ dspatchRunId });
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  readUsage(): Promise<readonly UsageReading[]> {
    return Promise.resolve([]);
  }

  providerMessageTypes(): Record<string, number> {
    return {};
  }

  streamPumpFinished(): boolean | null {
    return null;
  }

  modelReported(): string | null {
    return null;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }
}

interface Harness {
  readonly service: ChatService;
  readonly workspace: string;
  readonly store: ConversationStore;
  /** Every provider the factory was asked for, in order. */
  readonly asked: StoredSessionProvider[];
  readonly cursors: FakeCursor[];
  readonly claudes: ClaudeAgentSdkAdapter[];
  readonly sdk: ClaudeSubstitute;
}

function harness(
  name: string,
  options: {
    readonly claudeEnabled: boolean;
    /** DSP-133: Claude support as read at launch. Defaults to installed. */
    readonly claudeInstalled?: boolean;
    readonly workspace?: string;
    readonly store?: ConversationStore;
    readonly conversationId?: string;
    readonly claudeEnv?: Record<string, string | undefined>;
  },
): Harness {
  const root = tempRoot(`provider-${name}`);
  const workspace = options.workspace ?? path.join(root, 'project');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'a project\n', 'utf8');
  const store = options.store ?? new ConversationStore(path.join(root, 'userdata', 'conversations'));
  const asked: StoredSessionProvider[] = [];
  const cursors: FakeCursor[] = [];
  const claudes: ClaudeAgentSdkAdapter[] = [];
  const sdk = claudeSubstitute();
  const conversationId = options.conversationId;
  const service = new ChatService({
    repoRoot: path.join(root, 'repo-root'),
    sampleProjectsRoot: path.join(root, 'samples'),
    send: () => undefined,
    log: () => undefined,
    conversations: () => store,
    ...(conversationId === undefined ? {} : { conversationForProject: () => conversationId }),
    readAuthStatus: () => Promise.resolve({ status: 'logged-in', backendUrl: 'https://example.invalid' }),
    claudeAuthorizationReference: options.claudeEnabled ? 'test-only reference' : null,
    claudeSupport:
      options.claudeInstalled === false
        ? { installed: false, reason: 'test: no claude-support folder' }
        : { installed: true, reason: null },
    createAdapter: (provider) => {
      asked.push(provider);
      if (provider === 'claude') {
        const claude = new ClaudeAgentSdkAdapter({
          queryFn: sdk.queryFn,
          spawnProcess: sdk.spawnProcess,
          localLookup: sdk.localLookup,
          env: options.claudeEnv ?? CLEAN_ENV,
          permissions: CHAT_PERMISSIONS,
        });
        claudes.push(claude);
        return claude;
      }
      const cursor = new FakeCursor();
      cursors.push(cursor);
      return cursor;
    },
    timings: { cancelConfirmMs: 40, cancelWatchMs: 60 },
  });
  return { service, workspace, store, asked, cursors, claudes, sdk };
}

async function settled(service: ChatService): Promise<void> {
  for (let turn = 0; turn < 2_000; turn += 1) {
    const attempts = service.getRunState().attempts;
    if (attempts.length > 0 && attempts.every((attempt) => attempt.state === 'completed')) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('the turn did not complete');
}

/** A conversation with one finished Cursor turn on disk, and its ID. */
async function cursorConversation(name: string): Promise<{ workspace: string; store: ConversationStore; conversationId: string }> {
  const first = harness(`${name}-first`, { claudeEnabled: false });
  const opened = await first.service.startChatSession({ kind: 'folder', path: first.workspace });
  await first.service.sendPrompt('what does this project do');
  await settled(first.service);
  await first.service.dispose();
  return { workspace: first.workspace, store: first.store, conversationId: opened.conversationId };
}

test('a new conversation is Cursor by default, and Claude cannot be chosen in a launch that did not enable it', async () => {
  const h = harness('default', { claudeEnabled: false });
  const session = await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  assert.deepEqual(h.asked, ['cursor']);
  assert.equal(session.provider, 'cursor');
  assert.equal(h.cursors[0]?.configs[0]?.provider, 'cursor');
  assert.equal(session.context.toolPolicySent, 'provider-default');
  assert.equal(session.agent.claudeEnabled, false);
  assert.match(session.agent.claudeNote, /Claude is not enabled for this launch/);

  // Refused before anything is closed: the Cursor session stays open.
  await assert.rejects(
    h.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' }),
    /Claude is not enabled for this launch.*Nothing was closed and nothing was sent/,
  );
  assert.equal(h.service.openSession()?.dspatchSessionId, session.dspatchSessionId);
  assert.ok(!h.asked.includes('claude'), 'no Claude adapter was built');
  assert.equal(h.claudes.length, 0);
  await h.service.dispose();
});

test('switching to Claude is a new session with the recap disclosed and removable, and one turn runs through the Claude adapter', async () => {
  const { workspace, store, conversationId } = await cursorConversation('switch');
  const h = harness('switch', { claudeEnabled: true, workspace, store, conversationId });
  await h.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(h.cursors[0]?.resumes.length, 1, 'the Cursor conversation reopens with Cursor');

  const switched = await h.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' });
  assert.equal(switched.provider, 'claude');
  assert.equal(switched.continuity.kind, 'new-provider-session');
  assert.ok(h.cursors[0]?.disposed, 'the Cursor adapter was disposed, not reused (B2)');
  assert.equal(h.claudes.length, 1);
  // Disclosed before anything is sent, and nothing is sent yet.
  assert.ok((switched.continuity.contextToResend ?? '').length > 0);
  assert.equal(h.sdk.calls.length, 0);
  assert.deepEqual(h.sdk.lookups, [], 'a new session looks nothing up');
  // Removable.
  const removed = h.service.discardPendingRecap();
  assert.equal(removed.contextToResend, null);

  // The policy actually given, and the model by name.
  assert.match(switched.context.toolPolicySent, /tools Read, Glob, Grep, Edit, Write/);
  assert.doesNotMatch(switched.context.toolPolicySent, /Bash/);
  assert.equal(switched.modelRequested, CLAUDE_CHAT_MODEL);
  assert.match(switched.agent.connectionText, /authorization reference recorded for this launch \(login not checked by DSpatch\)/);

  await h.service.sendPrompt('hello Claude');
  await settled(h.service);
  assert.equal(h.sdk.calls.length, 1);
  const options = h.sdk.calls[0]?.options ?? {};
  assert.equal(h.sdk.calls[0]?.prompt, 'hello Claude', 'the removed recap was not sent');
  assert.equal(options['model'], CLAUDE_CHAT_MODEL);
  assert.deepEqual(options['tools'], [...CHAT_PERMISSIONS.tools]);
  assert.deepEqual(options['allowedTools'], [...CHAT_PERMISSIONS.allowedTools]);
  assert.ok(!(options['tools'] as string[]).includes('Bash'));

  const saved = store.read(switched.conversationId).conversation;
  assert.equal(saved?.session.provider, 'claude');
  assert.equal(saved?.session.toolPolicy, h.claudes[0]?.policyDigest());
  await h.service.dispose();
});

test('a Claude-recorded conversation in a launch without Claude is not resumed through Cursor; nothing is asked or sent', async () => {
  const { workspace, store, conversationId } = await cursorConversation('claude-without');
  // Make it a Claude-recorded conversation.
  const enabled = harness('claude-without-enabled', { claudeEnabled: true, workspace, store, conversationId });
  await enabled.service.startChatSession({ kind: 'folder', path: workspace });
  await enabled.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' });
  await enabled.service.dispose();
  assert.equal(store.read(conversationId).conversation?.session.provider, 'claude');

  const h = harness('claude-without', { claudeEnabled: false, workspace, store, conversationId });
  const session = await h.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(session.continuity.resumeFailure?.kind, 'provider-differs');
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.deepEqual(h.cursors[0]?.resumes, []);
  assert.deepEqual(h.cursors[0]?.sent, []);
  assert.deepEqual(h.cursors[0]?.configs, []);
  assert.equal(h.claudes.length, 0);
  assert.match(session.continuity.statement, /it is a Claude session, and Cursor is selected/);
  assert.deepEqual(session.continuity.choices, ['new-session']);
  await h.service.dispose();
});

test("an existing conversation opens with its recorded agent whatever the panel's choice, and is never resumed through Claude", async () => {
  const { workspace, store, conversationId } = await cursorConversation('cursor-with-claude');
  const h = harness('cursor-with-claude', { claudeEnabled: true, workspace, store, conversationId });
  // The *Open a project* panel had Claude chosen: that choice is for a new conversation.
  const session = await h.service.startChatSession({ kind: 'folder', path: workspace, provider: 'claude' });
  assert.equal(session.provider, 'cursor');
  assert.equal(session.continuity.kind, 'provider-session-resumed');
  assert.deepEqual(h.asked, ['cursor']);
  assert.equal(h.cursors[0]?.resumes.length, 1);
  assert.equal(h.claudes.length, 0, 'no Claude adapter was built');
  assert.deepEqual(h.sdk.lookups, []);
  assert.equal(h.sdk.calls.length, 0);
  await h.service.dispose();
});

test('opening a new project or the sample with Claude chosen builds no Cursor adapter and makes no Cursor call (R1)', async () => {
  for (const kind of ['folder', 'sample'] as const) {
    const h = harness(`open-claude-${kind}`, { claudeEnabled: true });
    const session = await h.service.startChatSession(
      kind === 'folder'
        ? { kind: 'folder', path: h.workspace, provider: 'claude' }
        : { kind: 'sample', provider: 'claude' },
    );
    assert.equal(session.provider, 'claude', kind);
    assert.equal(session.continuity.providerSessionOpen, true, kind);
    assert.deepEqual(h.asked, ['claude'], `${kind}: the factory was never asked for Cursor`);
    assert.equal(h.cursors.length, 0, `${kind}: no Cursor adapter, so no Cursor startSession`);
    assert.equal(h.sdk.calls.length, 0, `${kind}: nothing sent before Send`);
    await h.service.dispose();
  }

  // Not enabled for this launch: refused before anything is built.
  const off = harness('open-claude-off', { claudeEnabled: false });
  await assert.rejects(
    off.service.startChatSession({ kind: 'folder', path: off.workspace, provider: 'claude' }),
    /Claude is not enabled for this launch/,
  );
  assert.deepEqual(off.asked, []);
  await off.service.dispose();
});

test('a Claude session is resumed only under the tool policy it was recorded with (B3)', async () => {
  const { workspace, store, conversationId } = await cursorConversation('policy');
  const first = harness('policy-claude', { claudeEnabled: true, workspace, store, conversationId });
  await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' });
  await first.service.dispose();

  // Same policy: the resume reaches the (substituted) lookup.
  const same = harness('policy-same', { claudeEnabled: true, workspace, store, conversationId });
  await same.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(same.sdk.lookups.length, 1);
  await same.service.dispose();

  // A different recorded policy: refused before any lookup.
  const file = store.filePathFor(conversationId);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { session: { toolPolicy: string } };
  raw.session.toolPolicy = 'claude-agent-sdk:not-this-policy';
  fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
  const other = harness('policy-other', { claudeEnabled: true, workspace, store, conversationId });
  const refused = await other.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(refused.continuity.resumeFailure?.providerCode, 'config_mismatch');
  assert.deepEqual(other.sdk.lookups, []);
  assert.equal(other.sdk.calls.length, 0);
  await other.service.dispose();
});

test("the connection check never builds a Claude adapter and never leaves Cursor's for a Claude session (B2)", async () => {
  const h = harness('connection', { claudeEnabled: true });
  await h.service.getConnection();
  assert.deepEqual(h.asked, ['cursor']);
  const cached = h.cursors[0];
  await h.service.startChatSession({ kind: 'folder', path: h.workspace, provider: 'claude' });
  assert.ok(cached?.disposed, 'the cached Cursor adapter was replaced, not reused');
  assert.equal(h.service.openSession()?.provider, 'claude');

  // While a Claude session is open, the model list comes from a separate Cursor
  // adapter, which is disposed again; the Claude adapter is left alone.
  const connection = await h.service.getConnection();
  assert.equal(connection.kind, 'connected');
  const borrowed = h.cursors[1];
  assert.equal(borrowed?.listModelsCalls, 1);
  assert.ok(borrowed?.disposed);
  assert.deepEqual(h.asked, ['cursor', 'claude', 'cursor']);
  await h.service.dispose();
});

test("after DSpatch's credential rule refuses Claude, a new session is Claude again and Cursor is an explicit switch", async () => {
  const { workspace, store, conversationId } = await cursorConversation('refused');
  const first = harness('refused-claude', { claudeEnabled: true, workspace, store, conversationId });
  await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' });
  await first.service.dispose();

  // A launch whose environment carries Claude Code's own sign-in: the rule refuses.
  const env = { ...CLEAN_ENV, CLAUDE_CODE_OAUTH_TOKEN: 'synthetic' };
  const h = harness('refused', { claudeEnabled: true, workspace, store, conversationId, claudeEnv: env });
  const refused = await h.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(refused.continuity.resumeFailure?.providerCode, 'authentication_refused');
  assert.deepEqual(refused.continuity.choices, ['new-session', 'switch-to-cursor']);
  assert.deepEqual(h.sdk.lookups, []);

  // Switch to Cursor: explicit, a new session, the recap disclosed.
  const switched = await h.service.startChatSession({ kind: 'new-provider-session', provider: 'cursor' });
  assert.equal(switched.provider, 'cursor');
  assert.equal(switched.continuity.kind, 'new-provider-session');
  assert.ok((switched.continuity.contextToResend ?? '').length > 0);
  await h.service.dispose();

  // Start new session without naming a provider stays Claude, and is refused again.
  const again = harness('refused-again', { claudeEnabled: true, workspace, store, conversationId, claudeEnv: env });
  // The conversation is Cursor now; make it Claude-recorded again for this case.
  const file = store.filePathFor(conversationId);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { session: { provider: string; toolPolicy: string } };
  raw.session.provider = 'claude';
  raw.session.toolPolicy = h.claudes[0]?.policyDigest() ?? '';
  fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
  await again.service.startChatSession({ kind: 'folder', path: workspace });
  const stillRefused = await again.service.startChatSession({ kind: 'new-provider-session' });
  assert.deepEqual(again.asked, ['claude', 'claude'], 'never silently Cursor');
  // The conversation stays on screen with its choices rather than an empty window.
  assert.equal(stillRefused.continuity.providerSessionOpen, false);
  assert.equal(stillRefused.continuity.resumeFailure?.providerCode, 'authentication_refused');
  assert.deepEqual(stillRefused.continuity.choices, ['new-session', 'switch-to-cursor']);
  assert.equal(again.service.openSession()?.conversationId, conversationId);
  await again.service.dispose();
});

test('a new Claude session refused by the credential rule after leaving Cursor keeps the conversation on screen, and Cursor is one choice away', async () => {
  const { workspace, store, conversationId } = await cursorConversation('refused-switch');
  const env = { ...CLEAN_ENV, CLAUDE_CODE_OAUTH_TOKEN: 'synthetic' };
  const h = harness('refused-switch', { claudeEnabled: true, workspace, store, conversationId, claudeEnv: env });
  const opened = await h.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(opened.provider, 'cursor');
  const before = store.read(conversationId).conversation?.session;

  // Before DSP-117's fix this threw after the Cursor session had been closed,
  // leaving the window with no session at all.
  const refused = await h.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' });
  assert.equal(refused.conversationId, conversationId);
  assert.equal(refused.provider, 'claude');
  assert.equal(refused.continuity.providerSessionOpen, false);
  assert.equal(refused.continuity.resumeFailure?.providerCode, 'authentication_refused');
  assert.deepEqual(refused.continuity.choices, ['new-session', 'switch-to-cursor']);
  assert.match(refused.continuity.statement, /asked for a new Claude session and the adapter refused it/);
  assert.match(refused.continuity.statement, /Nothing was sent/);
  assert.match(refused.context.statement, /refused before starting any process or model turn/);
  assert.ok(refused.continuity.savedMessageCount > 0, 'the history is still there');
  assert.equal(h.sdk.calls.length, 0);
  // The recorded Cursor session is kept as it was.
  assert.deepEqual(store.read(conversationId).conversation?.session, before);
  // Sending is refused until a choice is made, as in every no-session state.
  await assert.rejects(h.service.sendPrompt('carry on'), /No provider session is open/);

  const cursor = await h.service.startChatSession({ kind: 'new-provider-session', provider: 'cursor' });
  assert.equal(cursor.provider, 'cursor');
  assert.equal(cursor.continuity.kind, 'new-provider-session');
  assert.ok((cursor.continuity.contextToResend ?? '').length > 0);
  await h.service.dispose();
});

test('the review discussion stays Cursor text-only whatever the chat has selected', async () => {
  const h = harness('review', { claudeEnabled: true });
  await h.service.startChatSession({ kind: 'folder', path: h.workspace, provider: 'claude' });
  assert.equal(h.service.openSession()?.provider, 'claude');
  const review = reviewAdapterFactory({ presentation: false }).create();
  try {
    assert.ok(review instanceof CursorSdkAdapter);
    assert.equal((review as unknown as { toolPolicy: string }).toolPolicy, 'text-only');
    assert.ok(!h.claudes.includes(review as unknown as ClaudeAgentSdkAdapter));
  } finally {
    await review.dispose();
    await h.service.dispose();
  }
});

test('without Claude support installed, Claude is not choosable, says how to install it, and is refused before any adapter is built (DSP-133)', async () => {
  const h = harness('not-installed', { claudeEnabled: true, claudeInstalled: false });
  const session = await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  assert.equal(session.provider, 'cursor');
  assert.equal(session.agent.claudeEnabled, false, 'authorized but not installed is not available');
  assert.equal(session.agent.claudeInstalled, false);
  assert.match(session.agent.claudeNotInstalledText ?? '', /npm run claude:install.*in `app\/`.*restart DSpatch/);
  assert.match(session.agent.claudeNote, /Claude support is not installed/);
  assert.match(h.service.agentChoice('claude').connectionText, /Claude support not installed/);

  await assert.rejects(
    h.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' }),
    /Claude support is not installed.*Nothing was closed and nothing was sent/,
  );
  assert.equal(h.service.openSession()?.dspatchSessionId, session.dspatchSessionId);
  assert.deepEqual(h.asked, ['cursor'], 'the factory was never asked for Claude');
  assert.equal(h.claudes.length, 0);
  await h.service.dispose();

  // Neither part: both are named.
  const neither = harness('not-installed-not-enabled', { claudeEnabled: false, claudeInstalled: false });
  await assert.rejects(
    neither.service.startChatSession({ kind: 'folder', path: neither.workspace, provider: 'claude' }),
    /not installed, and Claude is not enabled for this launch/,
  );
  assert.deepEqual(neither.asked, []);
  await neither.service.dispose();

  // Installed and authorized: available, no install line.
  const both = harness('installed-enabled', { claudeEnabled: true });
  assert.equal(both.service.agentChoice('claude').claudeEnabled, true);
  assert.equal(both.service.agentChoice('claude').claudeNotInstalledText, null);
  await both.service.dispose();
});

test('the real Claude SDK cannot be loaded by a test (the offline guard), so every Claude test runs on substitutes', async () => {
  // The guard is this test process's own `--import`; marking the refusal as expected
  // keeps it from failing the file at exit, and proves the guard is active.
  const guard = (await import('../scripts/test-offline-guard.mjs')) as { expectRefusal(specifier: string): void };
  guard.expectRefusal('@anthropic-ai/claude-agent-sdk');
  await assert.rejects(import('@anthropic-ai/claude-agent-sdk'), /offline-guard/);
});

test("shutdown waits for the Claude adapter's own dispose bound plus a stated margin", () => {
  assert.equal(DISPOSE_TIMEOUT_MS, DISPOSE_BOUND_MS + DISPOSE_MARGIN_MS);
  assert.ok(DISPOSE_MARGIN_MS > 0);
});

test('the guard refuses a port given as a string, and still treats a pipe name as local', async () => {
  const guard = (await import('../scripts/test-offline-guard.mjs')) as { expectRefusal(target: string): void };
  guard.expectRefusal('example.invalid:443');
  const refused = await new Promise<NodeJS.ErrnoException>((resolve) => {
    const socket = new net.Socket();
    socket.once('error', resolve);
    (socket.connect as unknown as (port: string, host: string) => void)('443', 'example.invalid');
  });
  assert.equal(refused.code, 'EOFFLINEGUARD');

  // A pipe or socket name that does not exist: let through to Node, which fails it locally.
  const pipe =
    process.platform === 'win32'
      ? '\\\\.\\pipe\\dspatch-offline-guard-missing'
      : path.join(os.tmpdir(), 'dspatch-offline-guard-missing.sock');
  const local = await new Promise<NodeJS.ErrnoException>((resolve) => {
    const socket = new net.Socket();
    socket.once('error', resolve);
    socket.connect(pipe);
  });
  assert.notEqual(local.code, 'EOFFLINEGUARD');
});
