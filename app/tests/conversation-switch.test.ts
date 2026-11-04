/**
 * Switching between conversations within one app run (DSP-4 rework WS-1, #7-#12).
 *
 * Offline probe V1 (23 Oct 2026) drove the real `ChatService` and `ConversationStore`
 * through open A, send, open B, read B's diff, open A again, and watched the save at
 * the second open rewrite A's file with one message instead of three, one attempt
 * instead of four and no test run, while B's reviewed diff and B's failing test moved
 * into A. These tests are that probe turned into assertions, extended for the
 * defects read in code beside it: attempt identities colliding across conversations,
 * a recap built without this run's turns, a repeat block that ignored which working
 * copy an attempt belongs to, and a command result filed under whichever conversation
 * was current when it finished.
 *
 * Everything here uses a **fake adapter**: no provider is called, and nothing here is
 * evidence about what a provider does. Every project and every conversation store is
 * a scratch directory under the system temp folder, removed however the test ends.
 * "A new app run" is a second `ChatService` over the same store, which is what a
 * restart is to these files. Heavy because the seeded conversations run real
 * commands, and one test kills a running one.
 *
 *     node scripts/run-tests.mjs chat        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

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
import {
  ConversationStore,
  type ConversationWriteResult,
} from '../src/main/conversation-store.ts';
import type { ChatSessionInfo, StoredConversation } from '../src/shared/bridge.ts';
import { tempRoot } from './support/fixtures.ts';

const scratch = tempRoot('conversation-switch');

let counter = 0;

function makeDir(name: string): string {
  counter += 1;
  const dir = path.join(scratch, `${String(counter)}-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProject(name: string, file: string, text: string): string {
  const dir = makeDir(name);
  fs.writeFileSync(path.join(dir, file), text, 'utf8');
  return dir;
}

/**
 * A provider that answers only when told to. Modelled on the one in
 * `chat-service.test.ts`, reduced to what switching needs: sends that start a run,
 * and a resume that succeeds unless a test says otherwise. Since DSP-121 a refused
 * resume opens nothing and refuses every send until the user chooses, so the tests
 * about switching, ledgers and saves — none of which is about the resume — reopen
 * into a resumed session; the one test about the recap path (#10) sets
 * `resumeBehaviour = 'not-found'` and makes the choice itself.
 */
class FakeAdapter implements ChatAdapter {
  readonly id = 'fake-adapter';

  readonly sent: string[] = [];

  /** The refusal is the wrapped shape the real adapter throws, with `providerCode`. */
  resumeBehaviour: 'ok' | 'not-found' = 'ok';

  resume?: (dspatchSessionId: string, config: SessionConfig) => Promise<SessionHandle>;

  private listener: AgentEventListener | null = null;

  private sessionId = '';

  private runCounter = 0;

  private lastRunId: string | null = null;

  constructor() {
    this.resume = (dspatchSessionId, config) => {
      if (this.resumeBehaviour === 'not-found') {
        return Promise.reject(
          Object.assign(
            new Error(
              `Cursor adapter operation "resume" failed: AgentNotFoundError: Agent ` +
                `${dspatchSessionId} not found`,
            ),
            { name: 'CursorAdapterError', providerCode: 'agent_not_found' },
          ),
        );
      }
      this.sessionId = dspatchSessionId;
      return Promise.resolve({
        dspatchSessionId,
        provider: 'cursor',
        providerSessionId: 'agent-resumed',
        createdAt: new Date().toISOString(),
        workspacePath: config.workspacePath,
        resumeEvidence: 'provider-answered',
      } as unknown as SessionHandle);
    };
  }

  capabilities(): CapabilityReport {
    return {
      start: 'supported',
      streaming: 'supported',
      cancel: 'supported',
      resume: 'unknown',
      modelSelection: 'supported',
      approvals: 'unsupported',
      usageReporting: 'unknown',
    };
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve([{ id: 'claude-haiku-4-5', displayName: 'fake', provider: 'cursor' }]);
  }

  startSession(config: SessionConfig): Promise<SessionHandle> {
    this.sessionId = 'dsp-session-fake';
    return Promise.resolve({
      dspatchSessionId: this.sessionId,
      provider: 'cursor',
      providerSessionId: 'agent-fake',
      createdAt: new Date().toISOString(),
      workspacePath: config.workspacePath,
    } as unknown as SessionHandle);
  }

  subscribe(_sessionId: string, listener: AgentEventListener): Unsubscribe {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  hasActiveRun(): boolean {
    return false;
  }

  send(_sessionId: string, prompt: string): Promise<RunReference> {
    this.sent.push(prompt);
    this.runCounter += 1;
    const dspatchRunId = `dsp-run-fake-${String(this.runCounter)}`;
    this.lastRunId = dspatchRunId;
    this.emit({ type: 'run.started', dspatchRunId });
    return Promise.resolve({ dspatchRunId } as RunReference);
  }

  /** `false`: a cancel the provider never confirms, so the confirmation timer decides. */
  cancelEmitsFinish = true;

  cancel(): Promise<void> {
    if (this.cancelEmitsFinish) {
      this.emit({ type: 'run.finished', status: 'cancelled' });
    }
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
    return 'claude-haiku-4-5';
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }

  emit(
    partial: { readonly type: AgentEvent['type']; readonly dspatchRunId?: string } &
      Record<string, unknown>,
  ): void {
    this.listener?.({
      dspatchSessionId: this.sessionId,
      dspatchRunId: partial.dspatchRunId ?? this.lastRunId ?? 'dsp-run-fake-0',
      at: new Date().toISOString(),
      rawProviderEvent: null,
      ...partial,
    } as unknown as AgentEvent);
  }

  /** The provider answers the last message and reports its end. */
  answer(text: string): void {
    this.emit({ type: 'assistant.message', text });
    this.emit({ type: 'run.finished', status: 'finished' });
  }
}

interface Harness {
  readonly service: ChatService;
  readonly adapter: FakeAdapter;
  readonly logs: string[];
  /** Opens a folder and records it the way `main.ts` does after `START_SESSION`. */
  open(project: string): Promise<ChatSessionInfo>;
}

/**
 * A service over the store, with a map standing in for the project store's
 * "which conversation belongs to this folder" pointers (main.ts `recordOpened`).
 */
function serviceOver(
  name: string,
  store: ConversationStore,
  pointers: Map<string, string>,
  cancelConfirmMs = 40,
): Harness {
  const adapter = new FakeAdapter();
  const logs: string[] = [];
  const service = new ChatService({
    // DSP-136: Cursor chosen explicitly, as the person would in Open a project.
    agentChoiceStore: { read: () => 'cursor', write: () => undefined },
    repoRoot: makeDir(`${name}-repo-root`),
    send: () => {
      // No renderer here.
    },
    log: (message) => {
      logs.push(message);
    },
    createAdapter: () => adapter,
    conversations: () => store,
    conversationForProject: (project) => {
      for (const [folder, conversationId] of pointers) {
        if (path.resolve(folder).toLowerCase() === path.resolve(project).toLowerCase()) {
          return conversationId;
        }
      }
      return null;
    },
    timings: { cancelConfirmMs, cancelWatchMs: 60 },
  });
  return {
    service,
    adapter,
    logs,
    open: async (project) => {
      const session = await service.startChatSession({ kind: 'folder', path: project });
      pointers.set(session.workspacePath, session.conversationId);
      return session;
    },
  };
}

function storeFor(name: string): ConversationStore {
  return new ConversationStore(path.join(makeDir(`${name}-userdata`), 'conversations'));
}

function nodeCommand(script: string): string {
  return `"${process.execPath}" -e "${script}"`;
}

/**
 * A conversation saved by an earlier app run: two answered messages and one real
 * command, run in a service of its own that is then disposed.
 */
async function seed(
  store: ConversationStore,
  project: string,
  label: string,
  exitCode: number,
  options: { readonly leaveUnknown?: boolean; readonly extraAnswered?: boolean } = {},
): Promise<string> {
  const earlier = serviceOver(`${label}-seed`, store, new Map());
  try {
    const session = await earlier.open(project);
    await earlier.service.sendPrompt(`${label}-earlier-1`);
    earlier.adapter.answer(`${label}-answer-1`);
    await earlier.service.sendPrompt(`${label}-earlier-2`);
    earlier.adapter.answer(`${label}-answer-2`);
    await earlier.service.runWorkspaceTest({
      command: nodeCommand(`process.exit(${String(exitCode)})`),
      cwd: '',
    });
    if (options.extraAnswered === true) {
      await earlier.service.sendPrompt(`${label}-earlier-3`);
      earlier.adapter.answer(`${label}-answer-3`);
    }
    if (options.leaveUnknown === true) {
      // Never answered: closing the session records it as an unknown outcome.
      await earlier.service.sendPrompt(`${label}-never-answered`);
    }
    return session.conversationId;
  } finally {
    await earlier.service.dispose();
  }
}

function saved(store: ConversationStore, conversationId: string): StoredConversation {
  const read = store.read(conversationId);
  assert.ok(read.conversation, `conversation ${conversationId} reads back: ${String(read.error)}`);
  return read.conversation;
}

const prompts = (conversation: StoredConversation): string[] =>
  conversation.messages.map((message) => message.prompt);
const attemptIds = (conversation: StoredConversation): string[] =>
  conversation.attempts.map((attempt) => attempt.attemptId);
const attemptLabels = (conversation: StoredConversation): string[] =>
  conversation.attempts.map((attempt) => `${attempt.attemptId}:${attempt.label}`);
const testRunIds = (conversation: StoredConversation): string[] =>
  conversation.testRuns.map((run) => run.attemptId);

// --- #7: A -> B -> A keeps A whole, and none of B --------------------------------

test('WS-1 #7: reopening A after B keeps all of A, nothing of B, in this run and the next', async () => {
  const store = storeFor('ac7');
  const projectA = makeProject('ac7-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('ac7-project-b', 'b.txt', 'project B\n');
  const idA = await seed(store, projectA, 'A', 0);
  const idB = await seed(store, projectB, 'B', 3);
  const seededA = saved(store, idA);
  assert.equal(seededA.messages.length, 2);
  assert.equal(seededA.testRuns.length, 1);
  assert.equal(seededA.testRuns[0]?.verdict, 'passed');
  const aTestSnapshot = seededA.testRuns[0]?.snapshotId ?? null;
  assert.notEqual(aTestSnapshot, null);

  const pointers = new Map([
    [projectA, idA],
    [projectB, idB],
  ]);
  const live = serviceOver('ac7-live', store, pointers);
  try {
    const first = await live.open(projectA);
    assert.equal(first.conversationId, idA);
    assert.equal(first.restoredHistory.messages.length, 2);
    const freshnessAtOpen = live.service.getTestFreshness();
    assert.equal(freshnessAtOpen.testedSnapshotId, aTestSnapshot);

    await live.service.sendPrompt('A-now-3');
    live.adapter.answer('A-answer-3');

    const b = await live.open(projectB);
    assert.equal(b.conversationId, idB);
    fs.writeFileSync(path.join(projectB, 'b-only-change.txt'), 'only in B\n', 'utf8');
    const diffB = live.service.getWorkspaceChanges();
    assert.deepEqual(
      diffB.added.map((file) => file.relPath),
      ['b-only-change.txt'],
    );

    const again = await live.open(projectA);
    assert.equal(again.conversationId, idA);
    assert.deepEqual(
      again.restoredHistory.messages.map((message) => message.prompt),
      ['A-earlier-1', 'A-earlier-2', 'A-now-3'],
      'the window is given all three of A\'s messages',
    );

    const fileA = saved(store, idA);
    assert.deepEqual(prompts(fileA), ['A-earlier-1', 'A-earlier-2', 'A-now-3']);
    assert.equal(fileA.attempts.length, 4, 'three saved attempts and this run\'s one');
    assert.deepEqual(testRunIds(fileA), testRunIds(seededA), 'A\'s test run is still there');
    assert.equal(fileA.lastTestAttemptId, seededA.lastTestAttemptId);
    assert.equal(fileA.reviewedDiff, null, 'A never reviewed a diff; B\'s is not A\'s');
    assert.equal(fileA.baseline?.root, projectA, 'A\'s baseline is A\'s own project');
    const textA = JSON.stringify(fileA);
    assert.doesNotMatch(textA, /b-only-change|B-earlier|B-answer/, 'nothing of B in A\'s file');

    const freshness = live.service.getTestFreshness();
    assert.equal(freshness.testedSnapshotId, aTestSnapshot, 'A\'s test status is about A\'s code');
    assert.equal(freshness.presentedStatus, freshnessAtOpen.presentedStatus);

    const fileB = saved(store, idB);
    assert.deepEqual(prompts(fileB), ['B-earlier-1', 'B-earlier-2']);
    assert.equal(fileB.testRuns.length, 1);
    assert.deepEqual(
      fileB.reviewedDiff?.added.map((file) => file.relPath),
      ['b-only-change.txt'],
    );
  } finally {
    await live.service.dispose();
  }

  // A new app run reads the same files.
  const next = serviceOver('ac7-next', store, pointers);
  try {
    const reopened = await next.open(projectA);
    assert.deepEqual(
      reopened.restoredHistory.messages.map((message) => message.prompt),
      ['A-earlier-1', 'A-earlier-2', 'A-now-3'],
    );
    assert.equal(next.service.getTestFreshness().testedSnapshotId, aTestSnapshot);
    const fileA = saved(store, idA);
    assert.equal(fileA.messages.length, 3);
    assert.equal(fileA.attempts.length, 4);
    assert.equal(fileA.testRuns.length, 1);
    assert.equal(fileA.reviewedDiff, null);
  } finally {
    await next.service.dispose();
  }
});

// --- #8: a command result stays with the conversation that started it -----------

test('WS-1 #8: a command still running when the session changes is filed under its own conversation', async () => {
  const store = storeFor('ac8');
  const projectA = makeProject('ac8-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('ac8-project-b', 'b.txt', 'project B\n');
  const pointers = new Map<string, string>();
  const live = serviceOver('ac8-live', store, pointers);
  try {
    const a = await live.open(projectA);
    const pending = live.service.runWorkspaceTest({
      command: nodeCommand('setTimeout(function () {}, 20000)'),
      cwd: '',
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const running = live.service.getRunState().attempts.find((attempt) => attempt.kind === 'command');
    assert.equal(running?.state, 'running');

    // Opening B closes A's session, which stops A's command; its result arrives late.
    const b = await live.open(projectB);
    const outcome = await pending;
    assert.equal(outcome.attemptId, running?.attemptId);

    const fileA = saved(store, a.conversationId);
    const fileB = saved(store, b.conversationId);
    assert.deepEqual(fileB.testRuns, [], 'B started no command, so B\'s file has no result');
    assert.equal(fileB.lastTestAttemptId, null);
    assert.equal(live.service.getTestFreshness().kind, 'no-result', 'B shows no result of A\'s');
    assert.deepEqual(testRunIds(fileA), [outcome.attemptId], 'the result is A\'s');
    assert.equal(fileA.lastTestAttemptId, outcome.attemptId);
    assert.deepEqual(attemptIds(fileB), []);
    // Stopped by DSpatch closing A's session, so it is no verdict about A's code.
    assert.equal(outcome.killedByDspatch, true, 'DSpatch stopped it by closing the session');
    assert.equal(outcome.verdict, 'interrupted');
    const attemptInA = fileA.attempts.find((attempt) => attempt.attemptId === outcome.attemptId);
    assert.equal(attemptInA?.state, 'stopped-confirmed', 'A\'s file records how it ended');
  } finally {
    await live.service.dispose();
  }
});

// --- #9: attempt identity across conversations -----------------------------------

test('WS-1 #9: attempts with the same IDs in two conversations stay apart, once each, with no restart wording', async () => {
  const store = storeFor('ac9');
  const projectA = makeProject('ac9-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('ac9-project-b', 'b.txt', 'project B\n');
  const idA = await seed(store, projectA, 'A', 0, { leaveUnknown: true });
  const seededA = saved(store, idA);
  assert.deepEqual(attemptIds(seededA), [
    'dsp-attempt-0001',
    'dsp-attempt-0002',
    'dsp-attempt-0003',
    'dsp-attempt-0004',
  ]);
  const unknownId = 'dsp-attempt-0004';
  assert.equal(seededA.attempts[3]?.state, 'outcome-unknown');
  // B's file holds the same numbers for other work. This build numbers past every file
  // it can see, so such a pair comes from an older build or another store: B is seeded
  // in a store of its own and its file copied in.
  const elsewhere = storeFor('ac9-elsewhere');
  const idB = await seed(elsewhere, projectB, 'B', 0);
  fs.copyFileSync(elsewhere.filePathFor(idB), store.filePathFor(idB));
  const seededB = saved(store, idB);
  assert.deepEqual(attemptIds(seededB), attemptIds(seededA).slice(0, 3));

  const pointers = new Map([
    [projectA, idA],
    [projectB, idB],
  ]);
  const live = serviceOver('ac9-live', store, pointers);
  const restartWording = (conversation: StoredConversation): number =>
    conversation.attempts
      .find((attempt) => attempt.attemptId === unknownId)
      ?.history.filter((step) => step.note.startsWith('Carried across a restart')).length ?? -1;
  try {
    // B's new attempt takes a number neither saved file uses (review 004 S1).
    const b = await live.open(projectB);
    assert.equal(b.conversationId, idB);
    await live.service.sendPrompt('B-live-1');
    live.adapter.answer('B-answer-1');
    const bLabels = [...attemptLabels(seededB), 'dsp-attempt-0005:B-live-1'];
    assert.deepEqual(attemptLabels(saved(store, idB)), bLabels);

    // A's file holds the same numbers as B's for different pieces of work.
    await live.open(projectA);
    const fileA = saved(store, idA);
    assert.deepEqual(attemptLabels(fileA), attemptLabels(seededA), 'A keeps its own attempts');
    assert.deepEqual(attemptLabels(saved(store, idB)), bLabels, 'B\'s attempts stay in B');
    assert.equal(
      live.logs.some((line) => line.includes('could not be read')),
      false,
      'no "could not be read back" note',
    );
    assert.equal(restartWording(fileA), 1, 'one real restart, said once');
    const shown = live.service.getRunState().attempts.map((attempt) => attempt.attemptId);
    assert.deepEqual(shown, attemptIds(seededA), 'the window shows A\'s attempts, each once');

    // A -> B -> A adds no restart wording and duplicates nothing.
    await live.open(projectB);
    await live.open(projectA);
    const after = saved(store, idA);
    assert.deepEqual(attemptLabels(after), attemptLabels(seededA));
    assert.equal(restartWording(after), 1, 'a switch is not a restart');
    assert.equal(new Set(attemptIds(after)).size, after.attempts.length);
    assert.deepEqual(
      live.service.getRunState().attempts.map((attempt) => attempt.attemptId),
      attemptIds(seededA),
    );
    assert.deepEqual(attemptLabels(saved(store, idB)), bLabels);
  } finally {
    await live.service.dispose();
  }
});

// --- #10: the recap is built from the conversation the window shows --------------

test('WS-1 #10: the recap and the saved-message count include this run\'s turns', async () => {
  const store = storeFor('ac10');
  const projectA = makeProject('ac10-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('ac10-project-b', 'b.txt', 'project B\n');
  const projectC = makeProject('ac10-project-c', 'c.txt', 'project C\n');
  const idA = await seed(store, projectA, 'A', 0);
  const pointers = new Map([[projectA, idA]]);
  const live = serviceOver('ac10-live', store, pointers);
  try {
    await live.open(projectA);
    await live.service.sendPrompt('A-now-3');
    live.adapter.answer('A-answer-3');
    await live.open(projectB);

    // The provider refuses the resume. Since DSP-121 that opens nothing and offers
    // no recap by itself: the recorded session stays as it was, and the recap is
    // built only when the user chooses a new provider session.
    live.adapter.resumeBehaviour = 'not-found';
    const sessionBefore = store.read(idA).conversation?.session ?? null;
    const again = await live.open(projectA);
    assert.equal(again.continuity.kind, 'resume-refused');
    assert.equal(again.continuity.contextToResend, null);
    assert.equal(again.continuity.savedMessageCount, 3);
    assert.equal(again.continuity.savedMessageCount, again.restoredHistory.messages.length);
    assert.deepEqual(store.read(idA).conversation?.session ?? null, sessionBefore);

    // The user's choice: the recap is built from the same merged conversation the
    // window shows — the file's messages and this run's turn.
    const fresh = await live.service.startChatSession({ kind: 'new-provider-session' });
    assert.equal(fresh.continuity.kind, 'new-provider-session');
    assert.match(fresh.continuity.contextToResend ?? '', /A-now-3/);
    assert.match(fresh.continuity.contextToResend ?? '', /A-earlier-1/);
    assert.equal(fresh.continuity.savedMessageCount, 3);
    live.adapter.resumeBehaviour = 'ok';

    // A conversation begun in this run has no file messages at its first open.
    await live.open(projectC);
    await live.service.sendPrompt('C-now-1');
    live.adapter.answer('C-answer-1');
    const newSession = await live.service.startChatSession({ kind: 'new-provider-session' });
    assert.match(newSession.continuity.contextToResend ?? '', /C-now-1/);
    assert.equal(newSession.continuity.savedMessageCount, 1);
  } finally {
    await live.service.dispose();
  }
});

// --- #11: the repeat block belongs to a working copy ------------------------------

test('WS-1 #11: an unresolved attempt blocks its own working copy, nested ones too, and nothing else', async () => {
  const store = storeFor('ac11');
  const projectA = makeProject('ac11-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('ac11-project-b', 'b.txt', 'project B\n');
  const nested = path.join(projectA, 'sub');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'c.txt'), 'nested\n', 'utf8');
  // The same folder spelled in another case on Windows, where it is the same folder.
  const nestedSpelling = process.platform === 'win32' ? nested.toUpperCase() : nested;
  const pointers = new Map<string, string>();

  const live = serviceOver('ac11-live', store, pointers);
  let unresolvedId = '';
  try {
    await live.open(projectA);
    const sent = await live.service.sendPrompt('a-never-answered');
    assert.ok(sent.dspatchRunId);
    unresolvedId = live.service.getRunState().unresolved[0]?.attemptId ?? '';
    assert.notEqual(unresolvedId, '');

    // Leaving A records the turn as unknown. B is another working copy.
    await live.open(projectB);
    assert.deepEqual(live.service.getRunState().needsAcknowledgement.agentTurn, []);
    await live.service.sendPrompt('b-1');
    live.adapter.answer('b-answer-1');
    // Naming A's attempt from B acknowledges nothing of A's.
    await live.service.sendPrompt('b-2', [unresolvedId]);
    live.adapter.answer('b-answer-2');

    await live.open(projectA);
    await assert.rejects(() => live.service.sendPrompt('a-2'), /unresolved/);
    assert.deepEqual(
      live.service.getRunState().needsAcknowledgement.agentTurn.map((ref) => ref.attemptId),
      [unresolvedId],
    );

    // A folder inside A's working copy is the same working copy.
    await live.open(nestedSpelling);
    await assert.rejects(() => live.service.sendPrompt('c-1'), /unresolved/);
    assert.deepEqual(
      live.service.getRunState().needsAcknowledgement.agentTurn.map((ref) => ref.attemptId),
      [unresolvedId],
    );
  } finally {
    await live.service.dispose();
  }

  // A new app run that opens the nested folder first, before A.
  const next = serviceOver('ac11-next', store, pointers);
  try {
    await next.open(nestedSpelling);
    await assert.rejects(() => next.service.sendPrompt('c-2'), /unresolved/);
    await next.open(projectB);
    await next.service.sendPrompt('b-3');
    next.adapter.answer('b-answer-3');

    // Acknowledged where it belongs, it stops blocking there and in the nested copy.
    await next.open(projectA);
    await next.service.sendPrompt('a-3', [unresolvedId]);
    next.adapter.answer('a-answer-3');
    await next.open(nested);
    await next.service.sendPrompt('c-3');
    next.adapter.answer('c-answer-3');
  } finally {
    await next.service.dispose();
  }
  const idA = pointers.get(projectA) ?? '';
  const inA = saved(store, idA).attempts.find((attempt) => attempt.attemptId === unresolvedId);
  assert.equal(inA?.state, 'outcome-unknown', 'acknowledged, still unresolved');
  assert.notEqual(inA?.acknowledgedAtUtc, null);
});

// --- #9, in the panel: one attempt ID is one attempt (review 004, S1) -------------

/**
 * The run state for a working copy shows attempts from more than one conversation:
 * its own, and the unresolved ones of conversations over the same folder, a folder
 * inside it or one that contains it. An ID must name one of them. Before the store
 * listing seeded the window's counter, a new attempt took the next number after the
 * conversations already held, so a file read later in the run could hold the same
 * number for different work and the panel showed two rows with one ID.
 */
function assertIdsUnique(service: ChatService, where: string): string[] {
  const ids = service.getRunState().attempts.map((attempt) => attempt.attemptId);
  assert.deepEqual(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    [],
    `${where}: an attempt ID appears twice in the run state (${ids.join(', ')})`,
  );
  return ids;
}

test('WS-1 #9 (S1): nested folder first, then its parent whose file holds higher IDs: no ID twice', async () => {
  const store = storeFor('s1-nested-first');
  const parent = makeProject('s1-nested-first-parent', 'p.txt', 'parent\n');
  const nested = path.join(parent, 'sub');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 's.txt'), 'nested\n', 'utf8');
  const idParent = await seed(store, parent, 'P', 0);
  const seededParent = saved(store, idParent);
  assert.equal(seededParent.attempts.length, 3);
  assert.equal(seededParent.attempts.every((attempt) => attempt.state === 'completed'), true);

  const pointers = new Map([[parent, idParent]]);
  const live = serviceOver('s1-nested-first-live', store, pointers);
  try {
    const sub = await live.open(nested);
    await live.service.sendPrompt('sub-never-answered');
    // Opening the parent closes the nested session: its turn becomes unknown and,
    // being in the parent's working copy, is shown there.
    await live.open(parent);
    const ids = assertIdsUnique(live.service, 'parent after nested');
    assert.equal(ids.length, 4, 'the parent\'s three attempts and the nested unresolved one');
    assert.deepEqual(attemptLabels(saved(store, idParent)), attemptLabels(seededParent));
    const subFile = saved(store, sub.conversationId);
    assert.deepEqual(prompts(subFile), ['sub-never-answered']);
    assert.equal(subFile.attempts.length, 1);
    assert.equal(
      attemptIds(seededParent).includes(subFile.attempts[0]?.attemptId ?? ''),
      false,
      'the new attempt took a number no saved file holds',
    );
  } finally {
    await live.service.dispose();
  }
});

test('WS-1 #9 (S1): parent first, then a nested folder whose file holds the same low IDs: no ID twice', async () => {
  const store = storeFor('s1-parent-first');
  const parent = makeProject('s1-parent-first-parent', 'p.txt', 'parent\n');
  const nested = path.join(parent, 'sub');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 's.txt'), 'nested\n', 'utf8');
  const idNested = await seed(store, nested, 'N', 0);
  const seededNested = saved(store, idNested);

  const pointers = new Map([[nested, idNested]]);
  const live = serviceOver('s1-parent-first-live', store, pointers);
  try {
    const top = await live.open(parent);
    await live.service.sendPrompt('parent-never-answered');
    await live.open(nested);
    const ids = assertIdsUnique(live.service, 'nested after parent');
    assert.equal(ids.length, 4, 'the nested conversation\'s three and the parent\'s unresolved one');
    assert.deepEqual(attemptLabels(saved(store, idNested)), attemptLabels(seededNested));
    const topFile = saved(store, top.conversationId);
    assert.deepEqual(prompts(topFile), ['parent-never-answered']);
    assert.equal(
      attemptIds(seededNested).includes(topFile.attempts[0]?.attemptId ?? ''),
      false,
    );
  } finally {
    await live.service.dispose();
  }
});

// --- The once-per-run listing waits for a listing that worked (review 007 N3) -------

test('WS-1 (N3): a store that cannot be listed at the first open is listed again at the next', async () => {
  // P's conversation, saved elsewhere, with attempts 0001-0004 and 0004 unresolved.
  const parent = makeProject('n3-parent', 'p.txt', 'parent\n');
  const nested = path.join(parent, 'sub');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 's.txt'), 'nested\n', 'utf8');
  const elsewhere = storeFor('n3-elsewhere');
  const idParent = await seed(elsewhere, parent, 'P', 0, { leaveUnknown: true });
  assert.equal(saved(elsewhere, idParent).attempts.length, 4);

  // The window's conversations directory is not a directory at the first open.
  const directory = path.join(makeDir('n3-userdata'), 'conversations');
  fs.writeFileSync(directory, 'not a directory\n', 'utf8');
  const store = new ConversationStore(directory);
  assert.notEqual(store.list().error, null, 'the first listing fails');

  const pointers = new Map<string, string>();
  const live = serviceOver('n3-live', store, pointers);
  try {
    const unrelated = makeProject('n3-unrelated', 'u.txt', 'unrelated\n');
    await live.open(unrelated);

    // Readable from now on, holding P's file.
    fs.rmSync(directory);
    fs.mkdirSync(directory);
    fs.copyFileSync(elsewhere.filePathFor(idParent), store.filePathFor(idParent));

    await live.open(nested);
    assert.deepEqual(
      live.service.getRunState().needsAcknowledgement.agentTurn.map((ref) => ref.attemptId),
      ['dsp-attempt-0004'],
      'P\'s unresolved attempt is held and blocks its nested folder',
    );
    await assert.rejects(() => live.service.sendPrompt('nested-1'), /unresolved/);

    // The counter was seeded by the listing that worked.
    const other = makeProject('n3-other', 'o.txt', 'other\n');
    await live.open(other);
    await live.service.sendPrompt('other-1');
    live.adapter.answer('other-answer-1');
    assert.deepEqual(
      live.service.getRunState().attempts.map((attempt) => attempt.attemptId),
      ['dsp-attempt-0005'],
    );
  } finally {
    await live.service.dispose();
  }
});

// --- #12: no save removes what the window did not remove -------------------------

interface Kept {
  readonly messages: Set<string>;
  readonly attempts: Set<string>;
  readonly testRuns: Set<string>;
}

function keptIn(conversation: StoredConversation): Kept {
  return {
    messages: new Set(
      conversation.messages.map((message) => `${message.dspatchRunId}|${message.startedAtUtc}`),
    ),
    attempts: new Set(attemptLabels(conversation)),
    testRuns: new Set(conversation.testRuns.map((run) => `${String(run.attemptId)}|${run.startedAtUtc}`)),
  };
}

test('WS-1 #12: no open, switch, read-back or close removes a message, attempt or test run', async () => {
  const store = storeFor('ac12');
  const projectA = makeProject('ac12-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('ac12-project-b', 'b.txt', 'project B\n');
  const idA = await seed(store, projectA, 'A', 0);
  const idB = await seed(store, projectB, 'B', 3);
  const pointers = new Map([
    [projectA, idA],
    [projectB, idB],
  ]);
  const ids: Record<string, string> = { A: idA, B: idB };
  const projects: Record<string, string> = { A: projectA, B: projectB };
  let last: Record<string, Kept> = {
    A: keptIn(saved(store, idA)),
    B: keptIn(saved(store, idB)),
  };

  const check = (step: string): void => {
    for (const name of ['A', 'B']) {
      const now = saved(store, ids[name] ?? '');
      const kept = keptIn(now);
      const before = last[name];
      assert.ok(before);
      for (const field of ['messages', 'attempts', 'testRuns'] as const) {
        const lost = [...before[field]].filter((key) => !kept[field].has(key));
        assert.deepEqual(lost, [], `after "${step}", ${name}'s file lost ${field}: ${lost.join(', ')}`);
      }
      assert.equal(now.baseline?.root, projects[name], `after "${step}", ${name}'s baseline is its own`);
      last = { ...last, [name]: kept };
    }
  };

  const live = serviceOver('ac12-live', store, pointers);
  try {
    await live.open(projectA);
    check('open A');
    await live.service.sendPrompt('A-now-1');
    live.adapter.answer('A-answer-now-1');
    check('send in A');
    await live.service.runWorkspaceTest({ command: nodeCommand('process.exit(0)'), cwd: '' });
    check('command in A');
    live.service.getWorkspaceChanges();
    check('diff in A');
    await live.open(projectB);
    check('open B');
    await live.service.sendPrompt('B-now-1');
    live.adapter.answer('B-answer-now-1');
    check('send in B');
    await live.open(projectA);
    check('open A again (the V1 path)');
    await live.open(projectB);
    check('open B again');
    await live.service.resumeConversation(idA);
    check('read A back from the list');
    await live.open(projectA);
    check('continue A');
    await live.service.startChatSession({ kind: 'new-provider-session' });
    check('new provider session in A');
    await live.service.resumeConversation(idB);
    check('read B back from the list');
  } finally {
    await live.service.dispose();
  }
  check('close');

  const next = serviceOver('ac12-next', store, pointers);
  try {
    await next.open(projectB);
    check('new run: open B');
    await next.open(projectA);
    check('new run: open A');
  } finally {
    await next.service.dispose();
  }
  check('new run: close');

  const fileA = saved(store, idA);
  assert.deepEqual(prompts(fileA), ['A-earlier-1', 'A-earlier-2', 'A-now-1']);
  assert.equal(fileA.testRuns.length, 2);
  const fileB = saved(store, idB);
  assert.deepEqual(prompts(fileB), ['B-earlier-1', 'B-earlier-2', 'B-now-1']);
  assert.equal(fileB.testRuns.length, 1);
});

// --- WS-1 follow-up: a hidden conversation's saves (verifier 001, scenario A) -------

/**
 * A real store whose writes of named conversations fail on demand, the way a full
 * disk, a read-only file or a lock would. Only `write` is replaced; reading, listing
 * and the file format are the store's own.
 */
class FailingStore extends ConversationStore {
  readonly failFor = new Set<string>();

  /** A narrower rule: fail only those writes of `failFor` for which this is true. */
  failIf: ((conversation: StoredConversation) => boolean) | null = null;

  override write(conversation: StoredConversation): ConversationWriteResult {
    if (
      this.failFor.has(conversation.conversationId) &&
      (this.failIf === null || this.failIf(conversation))
    ) {
      return {
        filePath: this.filePathFor(conversation.conversationId),
        error: 'Injected write failure (test).',
        bytesWritten: null,
      };
    }
    return super.write(conversation);
  }
}

function failingStoreFor(name: string): FailingStore {
  return new FailingStore(path.join(makeDir(`${name}-userdata`), 'conversations'));
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A command whose shell exits with `code` at once while a grandchild keeps its output
 * open for `holdMs`. DSpatch waits for the output to close, so the result arrives
 * later and was never killed: a switch in between finds the shell already gone.
 */
function exitsWhileOutputStaysOpen(code: number, holdMs: number): string {
  const leaf = path.join(makeDir('leaf'), 'leaf.js');
  fs.writeFileSync(leaf, `setTimeout(function () {}, ${String(holdMs)});\n`, 'utf8');
  // The shell's own exit code is the result. On Windows the started process holds no pipe of
  // the shell's; on POSIX it would inherit them, and a command whose output is still open at
  // a switch is one the switch ends, which is not what this is about: so there the leaf is
  // detached from the group and from the pipes, and the result is complete when the shell ends.
  return process.platform === 'win32'
    ? `start /b "" "${process.execPath}" "${leaf}" & exit /b ${String(code)}`
    : `setsid "${process.execPath}" "${leaf}" >/dev/null 2>&1 </dev/null & exit ${String(code)}`;
}

test('WS-1 follow-up (A1): a hidden conversation\'s result whose save failed is told, kept and written at close', async () => {
  const store = failingStoreFor('a1');
  const projectA = makeProject('a1-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('a1-project-b', 'b.txt', 'project B\n');
  const idA = await seed(store, projectA, 'A', 0);
  const idB = await seed(store, projectB, 'B', 0);
  const seededRuns = saved(store, idA).testRuns.length;
  const pointers = new Map([
    [projectA, idA],
    [projectB, idB],
  ]);
  const live = serviceOver('a1-live', store, pointers);
  let disposed = false;
  let resultId = '';
  try {
    await live.open(projectA);
    const pending = live.service.runWorkspaceTest({
      command: nodeCommand('setTimeout(function () {}, 20000)'),
      cwd: '',
    });
    await sleep(300);
    // Only the save that carries the result fails; the switch's own save of A works.
    store.failFor.add(idA);
    store.failIf = (conversation) => conversation.testRuns.length > seededRuns;
    await live.open(projectB);
    const outcome = await pending;
    resultId = outcome.attemptId ?? '';
    assert.equal(outcome.verdict, 'interrupted');
    assert.equal(saved(store, idA).testRuns.length, seededRuns, 'the result is not on disk yet');

    // The window is told, naming A, although B is the conversation on screen.
    const status = live.service.conversationSaveStatus();
    assert.equal(status.conversationId, idB);
    assert.equal(status.error, null, 'B itself was saved');
    assert.deepEqual(
      status.otherConversations.map((other) => other.conversationId),
      [idA],
    );
    assert.match(live.service.saveError() ?? '', new RegExp(idA));

    // A later successful save of B does not clear A's failure.
    await live.service.sendPrompt('B-now-1');
    live.adapter.answer('B-answer-now-1');
    assert.deepEqual(
      live.service.conversationSaveStatus().otherConversations.map((other) => other.conversationId),
      [idA],
    );

    // The store works again before the window closes, and closing writes A.
    store.failFor.clear();
    await live.service.dispose();
    disposed = true;
    assert.deepEqual(live.service.conversationSaveStatus().otherConversations, []);
  } finally {
    if (!disposed) {
      await live.service.dispose();
    }
  }
  const fileA = saved(store, idA);
  assert.deepEqual(testRunIds(fileA).slice(seededRuns), [resultId]);
  assert.equal(fileA.testRuns.at(-1)?.verdict, 'interrupted');
  assert.equal(
    fileA.attempts.find((attempt) => attempt.attemptId === resultId)?.state,
    'stopped-confirmed',
  );

  const next = serviceOver('a1-next', store, pointers);
  try {
    await next.open(projectA);
    const attempt = next.service
      .getRunState()
      .attempts.find((entry) => entry.attemptId === resultId);
    assert.equal(attempt?.state, 'stopped-confirmed', 'read back as it ended, not as unknown');
    assert.deepEqual(next.service.getRunState().needsAcknowledgement.command, []);
  } finally {
    await next.service.dispose();
  }
});

for (const storeAtClose of ['working again', 'still failing'] as const) {
  test(`WS-1 follow-up (A2): a hidden conversation's late real result, its save failing, the store ${storeAtClose} at close`, async () => {
    const slug = storeAtClose === 'working again' ? 'a2-healthy' : 'a2-broken';
    const store = failingStoreFor(slug);
    const projectA = makeProject(`${slug}-project-a`, 'a.txt', 'project A\n');
    const projectB = makeProject(`${slug}-project-b`, 'b.txt', 'project B\n');
    const idA = await seed(store, projectA, 'A', 0);
    const idB = await seed(store, projectB, 'B', 0);
    const seededRuns = saved(store, idA).testRuns.length;
    const pointers = new Map([
      [projectA, idA],
      [projectB, idB],
    ]);
    const live = serviceOver(`${slug}-live`, store, pointers);
    let disposed = false;
    let resultId = '';
    try {
      await live.open(projectA);
      fs.writeFileSync(path.join(projectA, 'a.txt'), 'project A, changed and now failing\n');
      const pending = live.service.runWorkspaceTest({
        command: exitsWhileOutputStaysOpen(1, 2500),
        cwd: '',
      });
      await sleep(700);
      store.failFor.add(idA);
      await live.open(projectB);
      const outcome = await pending;
      resultId = outcome.attemptId ?? '';
      // Not killed by the switch: the shell had already ended, so this is a real result.
      assert.equal(outcome.killedByDspatch, false);
      assert.equal(outcome.verdict, 'failed');
      assert.equal(saved(store, idA).testRuns.length, seededRuns, 'the result is not on disk yet');
      assert.deepEqual(
        live.service.conversationSaveStatus().otherConversations.map((other) => other.conversationId),
        [idA],
        'the window is told which conversation is not on disk',
      );
      if (storeAtClose === 'working again') {
        store.failFor.clear();
      }
      await live.service.dispose();
      disposed = true;
    } finally {
      if (!disposed) {
        await live.service.dispose();
      }
    }

    const fileA = saved(store, idA);
    const next = serviceOver(`${slug}-next`, store, pointers);
    try {
      await next.open(projectA);
      const attempt = next.service
        .getRunState()
        .attempts.find((entry) => entry.attemptId === resultId);
      if (storeAtClose === 'working again') {
        assert.deepEqual(testRunIds(fileA).slice(seededRuns), [resultId]);
        assert.equal(fileA.testRuns.at(-1)?.verdict, 'failed');
        assert.equal(attempt?.state, 'completed', 'the end DSpatch saw is what comes back');
        assert.deepEqual(next.service.getRunState().needsAcknowledgement.command, []);
      } else {
        // Nothing reached the disk, so the restart cannot know the ending, and says
        // only what it knows: no claim that the command was still going at close.
        assert.equal(fileA.testRuns.length, seededRuns);
        assert.equal(attempt?.state, 'outcome-unknown');
        assert.doesNotMatch(attempt?.stateReason ?? '', /DSpatch was closed while this was still going/);
        assert.match(attempt?.stateReason ?? '', /could not be saved/);
        assert.deepEqual(
          next.service.getRunState().needsAcknowledgement.command.map((ref) => ref.attemptId),
          [resultId],
        );
        assert.notEqual(next.service.getTestFreshness().kind, 'current', 'no pass for this code');
      }
    } finally {
      await next.service.dispose();
    }
  });
}

test('WS-1 follow-up (A3): a cancellation timer that settles a hidden conversation\'s turn saves it', async () => {
  const store = storeFor('a3');
  const projectA = makeProject('a3-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('a3-project-b', 'b.txt', 'project B\n');
  const live = serviceOver('a3-live', store, new Map(), 1000);
  try {
    const idA = (await live.open(projectA)).conversationId;
    live.adapter.cancelEmitsFinish = false;
    await live.service.sendPrompt('A-long-turn');
    await live.service.cancelRun();
    await live.open(projectB);
    assert.equal(
      saved(store, idA).attempts[0]?.state,
      'cancel-requested',
      'the switch saved A before the timer fired',
    );
    await sleep(1600);
    const turn = saved(store, idA).attempts[0];
    assert.equal(turn?.state, 'outcome-unknown');
    assert.match(turn?.stateReason ?? '', /No terminal event arrived/);
  } finally {
    await live.service.dispose();
  }
});

// --- WS-1 follow-up: acknowledgements name one attempt in one conversation (scenario B)

/** A conversation saved by another store, so its IDs start at 0001 again, copied in. */
async function seedElsewhere(
  store: ConversationStore,
  project: string,
  label: string,
  options: { readonly leaveUnknown?: boolean; readonly extraAnswered?: boolean } = {},
): Promise<string> {
  const elsewhere = storeFor(`${label}-elsewhere`);
  const conversationId = await seed(elsewhere, project, label, 0, options);
  fs.mkdirSync(path.dirname(store.filePathFor(conversationId)), { recursive: true });
  fs.copyFileSync(elsewhere.filePathFor(conversationId), store.filePathFor(conversationId));
  return conversationId;
}

function acknowledgedIn(
  store: ConversationStore,
  conversationId: string,
  attemptId: string,
): string | null {
  return (
    saved(store, conversationId).attempts.find((attempt) => attempt.attemptId === attemptId)
      ?.acknowledgedAtUtc ?? null
  );
}

const SHARED_ID = 'dsp-attempt-0004';

for (const layout of ['same folder', 'nested folder'] as const) {
  test(`WS-1 follow-up (B2, ${layout}): one ID in two conversations is two attempts to acknowledge`, async () => {
    const slug = layout === 'same folder' ? 'b2-same' : 'b2-nested';
    const store = storeFor(slug);
    const parent = makeProject(`${slug}-parent`, 'p.txt', 'parent\n');
    const nested = path.join(parent, 'sub');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 's.txt'), 'nested\n', 'utf8');
    const idX = await seedElsewhere(store, parent, 'X', { leaveUnknown: true });
    const idY = await seedElsewhere(store, layout === 'same folder' ? parent : nested, 'Y', {
      leaveUnknown: true,
    });
    assert.equal(saved(store, idX).attempts.at(-1)?.attemptId, SHARED_ID);
    assert.equal(saved(store, idY).attempts.at(-1)?.attemptId, SHARED_ID);
    // Same folder: X is current and Y held. Nested: Y on the nested folder is current
    // and X, over the folder containing it, is held.
    const pointers = new Map(
      layout === 'same folder'
        ? [[parent, idX]]
        : [
            [parent, idX],
            [nested, idY],
          ],
    );
    const openAt = layout === 'same folder' ? parent : nested;

    const live = serviceOver(`${slug}-live`, store, pointers);
    try {
      await live.open(openAt);
      const need = live.service.getRunState().needsAcknowledgement.agentTurn;
      assert.deepEqual(
        need.map((ref) => `${String(ref.conversationId)}:${ref.attemptId}`).sort(),
        [`${idX}:${SHARED_ID}`, `${idY}:${SHARED_ID}`].sort(),
      );
      // The refusal tells the two apart rather than naming one ID twice.
      await assert.rejects(
        () => live.service.sendPrompt('m-1'),
        (error: Error) => {
          assert.doesNotMatch(error.message, /dsp-attempt-0004, dsp-attempt-0004/);
          assert.match(error.message, new RegExp(idX));
          assert.match(error.message, new RegExp(idY));
          return true;
        },
      );
      // An ID alone names neither of two attempts; naming one leaves the other blocking.
      await assert.rejects(() => live.service.sendPrompt('m-2', [SHARED_ID]), /unresolved/);
      await assert.rejects(
        () =>
          live.service.sendPrompt(
            'm-3',
            need.filter((ref) => ref.conversationId === idX),
          ),
        (error: Error) => {
          assert.match(error.message, new RegExp(idY));
          return true;
        },
      );
      assert.equal(acknowledgedIn(store, idX, SHARED_ID), null);
      assert.equal(acknowledgedIn(store, idY, SHARED_ID), null);
    } finally {
      await live.service.dispose();
    }

    const next = serviceOver(`${slug}-next`, store, pointers);
    try {
      await next.open(openAt);
      const need = next.service.getRunState().needsAcknowledgement.agentTurn;
      assert.equal(need.length, 2, 'both still block after a restart');
      await assert.rejects(() => next.service.sendPrompt('n-1'), /unresolved/);
      // Naming both, as the window does, acknowledges each in its own file.
      await next.service.sendPrompt('n-2', need);
      next.adapter.answer('n-answer-2');
      assert.notEqual(acknowledgedIn(store, idX, SHARED_ID), null);
      assert.notEqual(acknowledgedIn(store, idY, SHARED_ID), null);
    } finally {
      await next.service.dispose();
    }
  });
}

test('WS-1 follow-up (B3): naming the unresolved one of two attempts sharing an ID leaves the settled one alone', async () => {
  const store = storeFor('b3');
  const project = makeProject('b3-project', 'p.txt', 'project\n');
  const idX = await seedElsewhere(store, project, 'X', { leaveUnknown: true });
  const idY = await seedElsewhere(store, project, 'Y', { extraAnswered: true });
  assert.equal(
    saved(store, idY).attempts.find((attempt) => attempt.attemptId === SHARED_ID)?.state,
    'completed',
  );
  const live = serviceOver('b3-live', store, new Map([[project, idY]]));
  try {
    await live.open(project);
    const need = live.service.getRunState().needsAcknowledgement.agentTurn;
    assert.deepEqual(
      need.map((ref) => `${String(ref.conversationId)}:${ref.attemptId}`),
      [`${idX}:${SHARED_ID}`],
    );
    await live.service.sendPrompt('y-1', need);
    live.adapter.answer('y-answer-1');
    assert.notEqual(acknowledgedIn(store, idX, SHARED_ID), null);
    assert.equal(acknowledgedIn(store, idY, SHARED_ID), null);
  } finally {
    await live.service.dispose();
  }
});

test('WS-1 follow-up (B4): acknowledging a message does not lift another conversation\'s command block with the same ID', async () => {
  const store = storeFor('b4');
  const project = makeProject('b4-project', 'p.txt', 'project\n');
  const idX = await seedElsewhere(store, project, 'X', { leaveUnknown: true });
  const idY = await seedElsewhere(store, project, 'Y', { leaveUnknown: true });
  // Y's 0004 stands for an older build's command left running at close.
  const fileY = store.filePathFor(idY);
  const raw = JSON.parse(fs.readFileSync(fileY, 'utf8')) as {
    attempts: Record<string, unknown>[];
    messages: { prompt: string }[];
  };
  const commandAttempt = raw.attempts.find((attempt) => attempt['attemptId'] === SHARED_ID);
  assert.ok(commandAttempt);
  Object.assign(commandAttempt, {
    kind: 'command',
    label: 'npm test (left running at close by an older build)',
    state: 'running',
    providerRunId: null,
    localPid: 4242,
  });
  raw.messages = raw.messages.filter((message) => message.prompt !== 'Y-never-answered');
  fs.writeFileSync(fileY, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  assert.equal(store.read(idY).conversation?.attempts.at(-1)?.kind, 'command');

  const run = (service: ChatService) =>
    service.runWorkspaceTest({ command: nodeCommand('process.exit(0)'), cwd: '' });
  const live = serviceOver('b4-live', store, new Map([[project, idX]]));
  try {
    await live.open(project);
    await assert.rejects(() => run(live.service), /unresolved/);
    const message = live.service.getRunState().needsAcknowledgement.agentTurn;
    await live.service.sendPrompt('x-1', message);
    live.adapter.answer('x-answer-1');
    assert.notEqual(acknowledgedIn(store, idX, SHARED_ID), null);
    assert.equal(acknowledgedIn(store, idY, SHARED_ID), null, 'the command was not acknowledged');
    await assert.rejects(() => run(live.service), /unresolved/);
    assert.deepEqual(
      live.service
        .getRunState()
        .needsAcknowledgement.command.map((ref) => `${String(ref.conversationId)}:${ref.attemptId}`),
      [`${idY}:${SHARED_ID}`],
    );
  } finally {
    await live.service.dispose();
  }
});

// --- Review 005 S1 and S4 -----------------------------------------------------------

test('WS-1 follow-up (S1): an off-screen save failure reaches the save status with no other call', async () => {
  // The window polls this status on a slow interval and has no other way to learn of
  // it, so it must change by itself when the main process alone did something.
  const store = failingStoreFor('s1-status');
  const projectA = makeProject('s1-status-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('s1-status-project-b', 'b.txt', 'project B\n');
  const live = serviceOver('s1-status-live', store, new Map(), 1000);
  try {
    const idA = (await live.open(projectA)).conversationId;
    live.adapter.cancelEmitsFinish = false;
    await live.service.sendPrompt('A-long-turn');
    await live.service.cancelRun();
    await live.open(projectB);
    store.failFor.add(idA);
    assert.deepEqual(live.service.conversationSaveStatus().otherConversations, []);
    // From here only the confirmation timer in the service acts.
    await sleep(1600);
    const status = live.service.conversationSaveStatus();
    assert.equal(status.error, null);
    assert.deepEqual(
      status.otherConversations.map((other) => `${other.conversationId}:${String(other.readOnly)}`),
      [`${idA}:false`],
    );
  } finally {
    store.failFor.clear();
    await live.service.dispose();
  }
});

test('WS-1 review N1: a file that cannot be read is refused and retried; a newer-format file is read-only', async () => {
  const store = storeFor('n1');
  const projectA = makeProject('n1-project-a', 'a.txt', 'project A\n');
  const projectB = makeProject('n1-project-b', 'b.txt', 'project B\n');
  const idA = await seed(store, projectA, 'A', 0);
  const idB = await seed(store, projectB, 'B', 0);
  const pointers = new Map([
    [projectA, idA],
    [projectB, idB],
  ]);
  const fileA = store.filePathFor(idA);

  // --- A read I/O failure: the save is refused, not called read-only, and retried.
  const live = serviceOver('n1-live', store, pointers);
  try {
    await live.open(projectA);
    await live.service.sendPrompt('A-now-1');
    live.adapter.answer('A-answer-now-1');
    assert.equal(live.service.conversationSaveStatus().error, null);
    const bytesA = fs.readFileSync(fileA);
    // A directory in the file's place: the bytes cannot be read, the shape a lock or a
    // permission problem has, and the same on every machine.
    fs.rmSync(fileA);
    fs.mkdirSync(fileA);
    await live.service.sendPrompt('A-now-2');
    live.adapter.answer('A-answer-now-2');

    const current = live.service.conversationSaveStatus();
    assert.equal(current.conversationId, idA);
    assert.match(String(current.error), /could not be read before saving/);
    assert.match(String(current.error), /did not overwrite it/);
    assert.equal(current.readOnly, false, 'the current line may promise a retry');

    await live.open(projectB);
    const hidden = live.service.conversationSaveStatus();
    assert.equal(hidden.error, null, 'B itself was saved');
    assert.deepEqual(
      hidden.otherConversations.map((other) => `${other.conversationId}:${String(other.readOnly)}`),
      [`${idA}:false`],
      'the off-screen line may promise a retry',
    );
    assert.match(hidden.otherConversations[0]?.error ?? '', /could not be read before saving/);
    assert.ok(fs.statSync(fileA).isDirectory(), 'nothing was written over the unreadable file');

    // The file is readable again; the close retry writes A with both new turns.
    fs.rmdirSync(fileA);
    fs.writeFileSync(fileA, bytesA);
  } finally {
    await live.service.dispose();
  }
  assert.deepEqual(live.service.conversationSaveStatus().otherConversations, []);
  assert.deepEqual(prompts(saved(store, idA)), ['A-earlier-1', 'A-earlier-2', 'A-now-1', 'A-now-2']);

  // --- A newer format: refused, read-only on screen and off, never rewritten.
  const fileB = store.filePathFor(idB);
  const future = `${JSON.stringify({ formatVersion: 99, conversationId: idB }, null, 2)}\n`;
  fs.writeFileSync(fileB, future, 'utf8');
  const next = serviceOver('n1-next', store, pointers);
  try {
    await next.open(projectB);
    const current = next.service.conversationSaveStatus();
    assert.equal(current.conversationId, idB);
    assert.match(String(current.error), /must not overwrite/);
    assert.equal(current.readOnly, true, 'the current line must not promise a retry');

    await next.open(projectA);
    assert.deepEqual(
      next.service
        .conversationSaveStatus()
        .otherConversations.map((other) => `${other.conversationId}:${String(other.readOnly)}`),
      [`${idB}:true`],
      'the off-screen line must not promise a retry',
    );
  } finally {
    await next.service.dispose();
  }
  assert.equal(fs.readFileSync(fileB, 'utf8'), future, 'byte for byte');
});

test('WS-1 #11 (close): a conversation held only as a blocker from disk is not rewritten at close', async () => {
  const store = storeFor('s4');
  const parent = makeProject('s4-parent', 'p.txt', 'parent\n');
  const nested = path.join(parent, 'sub');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 's.txt'), 'nested\n', 'utf8');
  const idParent = await seed(store, parent, 'P', 0, { leaveUnknown: true });
  const before = fs.readFileSync(store.filePathFor(idParent));

  const live = serviceOver('s4-live', store, new Map());
  try {
    await live.open(nested);
    assert.deepEqual(
      live.service
        .getRunState()
        .needsAcknowledgement.agentTurn.map((ref) => String(ref.conversationId)),
      [idParent],
      'the parent conversation is held, as a blocker only',
    );
    await assert.rejects(() => live.service.sendPrompt('nested-1'), /unresolved/);
  } finally {
    await live.service.dispose();
  }
  assert.deepEqual(fs.readFileSync(store.filePathFor(idParent)), before, 'byte for byte');
});
