/**
 * Choosing the agent in the main chat (DSP-117, DSP-136): no agent assumed - the one
 * chosen explicitly, Claude only in a launch that enabled it, no adapter built until
 * a session needs one, never a resume across providers, and a switch that is a new
 * session with the recap disclosed.
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
import { ChatService, type ChatAdapter } from '../src/main/chat-service.ts';
import { ConversationStore } from '../src/main/conversation-store.ts';
import { DISPOSE_MARGIN_MS, DISPOSE_TIMEOUT_MS } from '../src/main/dispose-timeout.ts';
import { providerAdapters } from '../src/main/provider-adapters.ts';
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
  /** Every explicit agent choice recorded. */
  readonly writes: StoredSessionProvider[];
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
    /** DSP-136: the agent chosen in this installation; `null` is a fresh one. Default Cursor. */
    readonly chosen?: StoredSessionProvider | null;
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
  const writes: StoredSessionProvider[] = [];
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
    // DSP-136: the agent chosen in this installation; Cursor unless a test says otherwise.
    agentChoiceStore: {
      read: () => (options.chosen === undefined ? 'cursor' : options.chosen),
      write: (provider) => {
        writes.push(provider);
      },
    },
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
  return { service, workspace, store, asked, writes, cursors, claudes, sdk };
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

test('with Cursor chosen a new conversation is Cursor, and Claude cannot be chosen in a launch that did not enable it', async () => {
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
  // DSP-146: Claude Code's own shell tools, recorded through DSpatch's hooks; no MCP server.
  assert.match(switched.context.toolPolicySent, /Write, Bash, PowerShell;/);
  assert.match(switched.context.toolPolicySent, /no MCP servers/);
  // DSP-149: with no model chosen, Claude is asked for its own default, not one DSpatch picks.
  assert.equal(switched.modelRequested, '');
  assert.match(switched.agent.connectionText, /authorization reference recorded for this launch \(login not checked by DSpatch\)/);

  await h.service.sendPrompt('hello Claude');
  await settled(h.service);
  assert.equal(h.sdk.calls.length, 1);
  const options = h.sdk.calls[0]?.options ?? {};
  assert.equal(h.sdk.calls[0]?.prompt, 'hello Claude', 'the removed recap was not sent');
  assert.equal(options['model'], undefined, 'no model chosen: none is named, so the provider default applies');
  assert.deepEqual(options['tools'], [...CHAT_PERMISSIONS.tools]);
  assert.deepEqual(options['allowedTools'], [...CHAT_PERMISSIONS.allowedTools]);
  assert.ok((options['tools'] as string[]).includes('Bash'), "DSP-146: Claude Code's own shell");
  assert.equal(options['mcpServers'], undefined);

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
  // DSP-136: no silent fallback and no adapter at all - not Cursor, not Claude.
  assert.equal(session.continuity.resumeFailure?.kind, 'agent-choice');
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.deepEqual(h.asked, [], 'no adapter was built');
  assert.equal(h.cursors.length, 0);
  assert.equal(h.claudes.length, 0);
  assert.match(session.continuity.statement, /it is a Claude session, and Claude cannot be used in this launch/);
  // Cursor is chosen and usable: a new Cursor session is offered; Claude cannot be resumed.
  assert.deepEqual(session.continuity.choices, ['new-session']);
  assert.equal(session.provider, 'cursor');
  await h.service.dispose();
});

test('a Cursor-recorded conversation with Claude chosen builds nothing until Resume with Cursor is picked (DSP-136 Q-A)', async () => {
  const { workspace, store, conversationId } = await cursorConversation('cursor-with-claude');
  const h = harness('cursor-with-claude', { claudeEnabled: true, workspace, store, conversationId });
  const session = await h.service.startChatSession({ kind: 'folder', path: workspace, provider: 'claude' });
  assert.equal(session.provider, 'claude');
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.equal(session.continuity.resumeFailure?.kind, 'provider-differs');
  assert.deepEqual(session.continuity.choices, ['new-session', 'resume-recorded']);
  assert.equal(session.continuity.recordedProvider, 'cursor');
  assert.equal(session.adapter, null);
  assert.ok(session.restoredHistory.messages.length > 0, 'the history is readable');
  assert.deepEqual(h.asked, [], 'nothing was built');
  assert.deepEqual(h.sdk.lookups, []);
  assert.equal(h.sdk.calls.length, 0);

  // *Resume with Cursor*: the recorded provider, explicitly.
  const resumed = await h.service.startChatSession({ kind: 'retry-resume' });
  assert.equal(resumed.provider, 'cursor');
  assert.equal(resumed.continuity.kind, 'provider-session-resumed');
  assert.deepEqual(h.asked, ['cursor']);
  assert.equal(h.cursors[0]?.resumes.length, 1);
  assert.equal(h.claudes.length, 0, 'no Claude adapter was built');
  assert.equal(resumed.adapter?.id, 'fake-cursor');
  await h.service.dispose();

  // Or *Start new Claude session*, from the same state: Claude only, with the recap.
  const again = harness('cursor-with-claude-new', { claudeEnabled: true, workspace, store, conversationId });
  await again.service.startChatSession({ kind: 'folder', path: workspace, provider: 'claude' });
  assert.deepEqual(again.asked, []);
  const started = await again.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' });
  assert.equal(started.provider, 'claude');
  assert.equal(started.continuity.kind, 'new-provider-session');
  assert.ok((started.continuity.contextToResend ?? '').length > 0, 'the recap is disclosed');
  assert.deepEqual(again.asked, ['claude'], 'never Cursor');
  await again.service.dispose();
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
  const same = harness('policy-same', { claudeEnabled: true, workspace, store, conversationId, chosen: 'claude' });
  await same.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(same.sdk.lookups.length, 1);
  await same.service.dispose();

  // A different recorded policy: refused before any lookup.
  const file = store.filePathFor(conversationId);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { session: { toolPolicy: string } };
  raw.session.toolPolicy = 'claude-agent-sdk:not-this-policy';
  fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
  const other = harness('policy-other', { claudeEnabled: true, workspace, store, conversationId, chosen: 'claude' });
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
  const h = harness('refused', { claudeEnabled: true, workspace, store, conversationId, claudeEnv: env, chosen: 'claude' });
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
  const again = harness('refused-again', { claudeEnabled: true, workspace, store, conversationId, claudeEnv: env, chosen: 'claude' });
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

test('the review discussion gets its own adapter from the shared factory, text-only, whatever the chat has selected (DSP-132)', async () => {
  const h = harness('review', { claudeEnabled: true });
  await h.service.startChatSession({ kind: 'folder', path: h.workspace, provider: 'claude' });
  assert.equal(h.service.openSession()?.provider, 'claude');
  const review = providerAdapters({ presentation: false, claudeAuthorizationReference: null, claudeInstalled: false }).createAdapter({
    provider: 'cursor',
    purpose: 'review',
  });
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

/** A factory spy for DSP-136: fails the test the moment a Cursor adapter is built. */
function noCursorHarness(name: string, options: Parameters<typeof harness>[1]): Harness {
  const h = harness(name, options);
  const original = (h.service as unknown as { options: { createAdapter?: (p: StoredSessionProvider) => ChatAdapter } }).options;
  const inner = original.createAdapter;
  (original as { createAdapter?: (p: StoredSessionProvider) => ChatAdapter }).createAdapter = (provider) => {
    if (provider === 'cursor') {
      throw new Error(`DSP-136: a Cursor adapter was built in ${name}`);
    }
    if (inner === undefined) {
      throw new Error('no factory');
    }
    return inner(provider);
  };
  return h;
}

test('reading identity, capabilities and the agent choice builds no adapter (DSP-136)', () => {
  const h = noCursorHarness('identity', { claudeEnabled: true, chosen: null });
  assert.equal(h.service.adapterId(), null);
  assert.equal(h.service.capabilities(), null);
  assert.equal(h.service.adapterInfo(), null);
  const choice = h.service.agentChoice(h.service.chosenAgent());
  assert.equal(choice.connectionText, 'No agent chosen');
  assert.equal(h.service.chosenAgent(), null);
  assert.deepEqual(h.asked, []);
});

test('a fresh installation has no agent chosen: opening a project creates no adapter and asks for one (B1)', async () => {
  const h = noCursorHarness('fresh', { claudeEnabled: true, chosen: null });
  for (const request of [
    { kind: 'folder', path: h.workspace },
    { kind: 'sample' },
  ] as const) {
    const session = await h.service.startChatSession(request);
    assert.equal(session.provider, null, request.kind);
    assert.equal(session.adapter, null, request.kind);
    assert.equal(session.continuity.providerSessionOpen, false, request.kind);
    assert.equal(session.continuity.agentNeeded, true, request.kind);
    assert.equal(session.continuity.resumeFailure?.kind, 'agent-choice', request.kind);
    assert.deepEqual(session.continuity.choices, [], request.kind);
    assert.match(session.continuity.statement, /No agent is chosen/, request.kind);
    assert.equal(h.service.adapterId(), null, request.kind);
  }
  await assert.rejects(h.service.sendPrompt('hello'), /No provider session is open/);
  assert.deepEqual(h.asked, [], 'no adapter was built');

  // Choosing is recorded, builds nothing, and the next open uses it.
  assert.equal(h.service.chooseAgent('claude'), 'claude');
  assert.deepEqual(h.writes, ['claude']);
  assert.deepEqual(h.asked, []);
  // From the no-session state, choosing an agent for the conversation opens it.
  const opened = await h.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' });
  assert.equal(opened.provider, 'claude');
  assert.equal(opened.adapter?.id, 'claude-agent-sdk');
  assert.deepEqual(h.asked, ['claude']);
  await h.service.dispose();
});

test('an agent that cannot be chosen is refused and not recorded (DSP-136)', async () => {
  const h = noCursorHarness('choose-refused', { claudeEnabled: false, chosen: null });
  assert.throws(() => h.service.chooseAgent('claude'), /Claude is not enabled for this launch/);
  assert.deepEqual(h.writes, []);
  assert.equal(h.service.chosenAgent(), null);
  await h.service.dispose();
});

test('a Claude-recorded project with Claude unavailable builds no Cursor adapter, even with nothing chosen (DSP-136)', async () => {
  const { workspace, store, conversationId } = await cursorConversation('claude-unavailable-none');
  const enabled = harness('claude-unavailable-enable', { claudeEnabled: true, workspace, store, conversationId });
  await enabled.service.startChatSession({ kind: 'folder', path: workspace });
  await enabled.service.startChatSession({ kind: 'new-provider-session', provider: 'claude' });
  await enabled.service.dispose();

  const h = noCursorHarness('claude-unavailable', {
    claudeEnabled: true,
    claudeInstalled: false,
    workspace,
    store,
    conversationId,
    chosen: null,
  });
  const session = await h.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.deepEqual(session.continuity.choices, [], 'nothing usable is offered');
  assert.equal(session.continuity.agentNeeded, true);
  assert.match(session.continuity.statement, /Claude support is not installed/);
  assert.deepEqual(h.asked, []);
  // Its history is still readable.
  assert.ok(session.restoredHistory.messages.length > 0);
  await h.service.dispose();
});

test('the restore path carries the provider: a request naming none uses the installation choice, one naming null uses none (DSP-136)', async () => {
  const chosenCursor = harness('restore-carries', { claudeEnabled: true, chosen: 'cursor' });
  const opened = await chosenCursor.service.startChatSession({ kind: 'folder', path: chosenCursor.workspace });
  assert.equal(opened.provider, 'cursor');
  await chosenCursor.service.dispose();

  const named = harness('restore-null', { claudeEnabled: true, chosen: 'cursor' });
  const none = await named.service.startChatSession({ kind: 'folder', path: named.workspace, provider: null });
  assert.equal(none.provider, null);
  assert.deepEqual(named.asked, []);
  await named.service.dispose();
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

test('a stored choice that cannot be used in this launch is named with its reason, not shown as no choice (R-1 R1)', async () => {
  const h = noCursorHarness('unusable-choice', { claudeEnabled: false, chosen: 'claude' });
  const session = await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.equal(session.continuity.agentNeeded, true);
  assert.equal(session.continuity.unusableChoice?.provider, 'claude');
  assert.match(session.continuity.unusableChoice?.reason ?? '', /^Claude is not enabled for this launch/);
  assert.match(
    session.continuity.statement,
    /^Claude was chosen, but it cannot be used in this launch: Claude is not enabled for this launch\. Start DSpatch with DSPATCH_CLAUDE_AUTHORIZATION set to enable it\. DSpatch opened no session/,
  );
  assert.doesNotMatch(session.continuity.statement, /No agent is chosen/);
  assert.match(session.continuity.statement, /Choose another agent to start a session\.$/);
  assert.deepEqual(h.asked, [], 'nothing was built');
  await h.service.dispose();
});
