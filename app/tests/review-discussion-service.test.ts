/**
 * The review discussion service against a real git repository and a scripted adapter.
 *
 * SIMULATED: every adapter here is a fake or the presentation adapter. Nothing talks to
 * a provider, and none of it is evidence about what Cursor does. It is evidence about
 * what DSpatch does: which question an answer lands on, what is frozen before a send,
 * when Stop says "unknown" rather than "stopped", that no adapter is touched on load,
 * and that the review's adapter and the chat's never share anything.
 *
 * Heavy because it runs git.
 *
 *     node --test tests/review-discussion-service.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
import { CursorSdkAdapter } from '../src/adapter/cursor-sdk-adapter.ts';
import type { ChatAdapter } from '../src/main/chat-service.ts';
import { PresentationResumeBehaviour } from '../src/main/presentation-adapter.ts';
import { providerAdapters } from '../src/main/provider-adapters.ts';
import {
  ReviewDiscussions,
  discussionRecordPath,
  discussionWorkingFolder,
} from '../src/main/review-discussion-service.ts';
import { ReviewService } from '../src/main/review-service.ts';
import { explanationsRecordPath } from '../src/main/step-explanation-channel.ts';
import { WALK_TEXT, historyOf, shownItem, type StepExplanation, type StepExplanationOutcome } from '../src/shared/step-explanations.ts';
import { REVIEW_DISCUSSION_CODE_INSTRUCTION, REVIEW_DISCUSSION_INSTRUCTION, type DiscussionIdentity, type DiscussionMessage, type ReviewDiscussionEvent } from '../src/shared/review-discussion.ts';
import { WORKING_TREE_ONLY, makeReviewFixture, type ReviewFixture } from './support/review-fixture.ts';

/** A provider that does exactly what the test says, and records what it was asked. */
class ScriptedAdapter implements ChatAdapter {
  readonly id: string;

  readonly started: SessionConfig[] = [];

  readonly sent: string[] = [];

  cancelCalls = 0;

  disposed = false;

  /** `hold`: `send` emits `run.started` and then waits for {@link releaseSend}. */
  sendMode: 'ok' | 'hold' | 'reject' = 'ok';

  /** `silent`: `cancel()` resolves and no end ever follows. */
  cancelMode: 'confirm' | 'silent' = 'confirm';

  activeRun: string | null = null;

  private listener: AgentEventListener | null = null;

  private sessionId = '';

  private runCounter = 0;

  private release: (() => void) | null = null;

  constructor(id = 'scripted-review') {
    this.id = id;
  }

  capabilities(): CapabilityReport {
    return { start: 'supported', streaming: 'supported', cancel: 'supported', resume: 'unsupported', modelSelection: 'unknown', approvals: 'unsupported', usageReporting: 'unknown' };
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve([]);
  }

  startSession(config: SessionConfig): Promise<SessionHandle> {
    this.started.push(config);
    this.sessionId = `${this.id}-session-${String(this.started.length)}`;
    return Promise.resolve({ dspatchSessionId: this.sessionId, provider: 'cursor', providerSessionId: 'p', createdAt: new Date().toISOString() });
  }

  hasActiveRun(): boolean {
    return this.activeRun !== null;
  }

  subscribe(_sessionId: string, listener: AgentEventListener): Unsubscribe {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(event: Partial<AgentEvent> & { type: AgentEvent['type'] }, sessionId = this.sessionId): void {
    this.listener?.({ dspatchSessionId: sessionId, dspatchRunId: this.activeRun ?? `${this.id}-run-${String(this.runCounter)}`, at: new Date().toISOString(), rawProviderEvent: null, ...event } as AgentEvent);
  }

  delta(text: string): void {
    this.emit({ type: 'assistant.delta', text } as Partial<AgentEvent> & { type: 'assistant.delta' });
  }

  finish(status: 'finished' | 'cancelled' | 'error' = 'finished'): void {
    this.emit({ type: 'run.finished', status } as Partial<AgentEvent> & { type: 'run.finished' });
    this.activeRun = null;
  }

  releaseSend(): void {
    this.release?.();
  }

  async send(_sessionId: string, prompt: string): Promise<RunReference> {
    this.sent.push(prompt);
    if (this.sendMode === 'reject') {
      throw new Error('Cursor adapter operation "send" failed: TypeError: fetch failed');
    }
    this.runCounter += 1;
    const dspatchRunId = `${this.id}-run-${String(this.runCounter)}`;
    this.activeRun = dspatchRunId;
    // Inside `send`, before the provider answers: the real adapters' contract.
    this.emit({ type: 'run.started' });
    if (this.sendMode === 'hold') {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    return { dspatchRunId };
  }

  cancel(): Promise<void> {
    this.cancelCalls += 1;
    if (this.cancelMode === 'confirm' && this.activeRun !== null) {
      this.finish('cancelled');
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
    return null;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }
}

async function until(condition: () => boolean, what: string, ms = 2_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > ms) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface Setup {
  readonly fixture: ReviewFixture;
  readonly review: ReviewService;
  readonly identity: DiscussionIdentity;
  readonly adapters: ScriptedAdapter[];
  /** The send mode adapters are created with. */
  sendMode: ScriptedAdapter['sendMode'];
  discussions(timings?: { cancelConfirmMs?: number }, earlier?: () => readonly DiscussionMessage[]): ReviewDiscussions;
}

async function setup(): Promise<Setup> {
  const fixture = makeReviewFixture();
  const review = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
  const opened = await review.openDefinition(fixture.definitionPath);
  assert.equal(opened.kind, 'opened');
  const identity = await review.identify(fixture.definitionPath);
  assert.ok('identity' in identity);
  const adapters: ScriptedAdapter[] = [];
  const result: Setup = {
    fixture,
    review,
    identity: identity.identity,
    adapters,
    sendMode: 'ok',
    discussions: (timings, earlier) =>
      new ReviewDiscussions({
        recordsDir: fixture.records,
        log: () => undefined,
        createAdapter: () => {
          const adapter = new ScriptedAdapter();
          adapter.sendMode = result.sendMode;
          adapters.push(adapter);
          return adapter;
        },
        ...(timings === undefined ? {} : { timings }),
        ...(earlier === undefined ? {} : { earlier }),
      }),
  };
  return result;
}

const POINT = { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 0 } as const;
const AWAY = { kind: 'away', location: { path: 'src/untouched.ts', side: 'target', start: 1, end: 1 } } as const;

function recorder(): { events: ReviewDiscussionEvent[]; send: (event: ReviewDiscussionEvent) => void } {
  const events: ReviewDiscussionEvent[] = [];
  return { events, send: (event) => events.push(event) };
}

function storedMessages(s: Setup): DiscussionMessage[] {
  return (JSON.parse(fs.readFileSync(discussionRecordPath(s.fixture.records, s.identity.key), 'utf8')) as { messages: DiscussionMessage[] }).messages;
}

test('an answer that arrives after the window has moved stays on its question, and nothing is sent on load or reopen', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const window = recorder();
    const service = discussions.attach(1, s.identity, window.send, 'cursor');

    const loaded = await service.load({ subject: POINT, selection: null }, s.review);
    assert.equal(loaded.kind, 'loaded');
    assert.match(loaded.kind === 'loaded' ? (loaded.subjectLine ?? '') : '', /^Walk 1 › b changes › /);
    assert.equal(s.adapters.length, 0, 'loading creates no adapter');

    const sent = await service.send({ question: 'Why 20?', subject: POINT, selection: null }, s.review);
    assert.equal(sent.kind, 'sent');
    const adapter = s.adapters[0];
    assert.ok(adapter !== undefined);
    // The code at the reviewed commit, not the working tree; the instruction first.
    assert.ok(adapter.sent[0]?.includes('2 | export const b = 20;'));
    assert.ok(!adapter.sent[0]?.includes(WORKING_TREE_ONLY));
    // The question was frozen and written before the provider answered.
    const question = storedMessages(s).find((message) => message.role === 'question');
    assert.equal(question?.sentPrompt, adapter.sent[0]);
    assert.equal(question?.envelope?.subject.kind, 'point');

    // The window moves on; the answer still belongs where it was asked.
    await service.load({ subject: AWAY, selection: null }, s.review);
    adapter.delta('Because ');
    adapter.delta('the target says so.');
    adapter.finish();
    const answer = storedMessages(s).find((message) => message.role === 'answer');
    assert.equal(answer?.questionId, question?.id);
    assert.equal(answer?.subject, question?.subject);
    assert.equal(answer?.text, 'Because the target says so.');
    assert.equal(answer?.status, 'done');
    assert.ok(window.events.some((event) => event.kind === 'delta' && event.text === 'Because '));

    // Reopened by a new process: the thread is back, and no adapter exists until a question is asked.
    discussions.detach(1);
    const reopened = s.discussions();
    const again = reopened.attach(2, s.identity, () => undefined, 'cursor');
    const back = await again.load(null, s.review);
    assert.equal(back.kind === 'loaded' ? back.messages.length : 0, 2);
    assert.equal(s.adapters.length, 1, 'reopening and loading created no adapter');
    // The first question in the new session carries a bounded recap, shown in its prompt.
    assert.equal((await again.send({ question: 'And d?', subject: POINT, selection: null }, s.review)).kind, 'sent');
    assert.match(s.adapters[1]?.sent[0] ?? '', /## Earlier in this discussion\nQ \(Walk 1 › b changes › [^)]*\): Why 20\?\nA: Because the target says so\./);
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('one answer at a time: a second question while one runs is refused, and quick repeats send once', async () => {
  const s = await setup();
  try {
    const service = s.discussions().attach(1, s.identity, () => undefined, 'cursor');
    const [first, second] = await Promise.all([
      service.send({ question: 'One', subject: POINT, selection: null }, s.review),
      service.send({ question: 'Two', subject: POINT, selection: null }, s.review),
    ]);
    assert.equal(first.kind, 'sent');
    assert.equal(second.kind, 'refused');
    assert.equal(s.adapters[0]?.sent.length, 1);
    const third = await service.send({ question: 'Three', subject: POINT, selection: null }, s.review);
    assert.match(third.kind === 'refused' ? third.error : '', /still on its way/);
    assert.equal(s.adapters[0]?.sent.length, 1);
    assert.equal((await service.send({ question: '  ', subject: POINT, selection: null }, s.review)).kind, 'refused');
    // An unknown subject is refused before anything is recorded or sent.
    s.adapters[0]?.finish();
    const unknown = await service.send({ question: 'Q', subject: { kind: 'point', walkId: 'W9', stepId: 'x', placeIndex: 0 }, selection: null }, s.review);
    assert.deepEqual(unknown, { kind: 'refused', error: 'This review has no walk "W9".' });
    assert.equal(storedMessages(s).filter((message) => message.role === 'question').length, 1);
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('Stop before the provider has answered the send: the outcome is unknown, and the run is cancelled when it appears', async () => {
  const s = await setup();
  try {
    const service = s.discussions({ cancelConfirmMs: 2_000 }).attach(1, s.identity, () => undefined, 'cursor');
    s.sendMode = 'hold';
    const held = service.send({ question: 'Held', subject: POINT, selection: null }, s.review);
    await until(() => s.adapters[0]?.sent.length === 1, 'the held send');
    const adapter = s.adapters[0];
    assert.ok(adapter !== undefined);

    const stopped = await service.cancel();
    assert.equal(stopped.kind, 'abandoned');
    assert.equal(adapter.cancelCalls, 0, 'nothing cancellable exists yet, so cancel() is not called');
    const attempt = service.status().unresolved[0];
    assert.equal(attempt?.state, 'outcome-unknown');
    assert.equal(service.status().turn, null);

    adapter.releaseSend();
    assert.equal((await held).kind, 'sent');
    assert.equal(adapter.cancelCalls, 1, 'the run that appeared was asked to stop');
    // The fake confirms the cancel, so the attempt ends as a confirmed stop.
    await until(() => service.status().unresolved.length === 0, 'the confirmed end');
    const answers = storedMessages(s).filter((message) => message.role === 'answer');
    assert.equal(answers[answers.length - 1]?.status, 'cancelled');
    // The run ended and was seen: the question was sent, and how it ended is on the answer.
    assert.equal(storedMessages(s).find((message) => message.role === 'question')?.status, 'sent');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('a cancel with no end inside the confirmation window becomes unknown, not cancelled, and the next question needs an acknowledgement', async () => {
  const s = await setup();
  try {
    const service = s.discussions({ cancelConfirmMs: 40 }).attach(1, s.identity, () => undefined, 'cursor');
    assert.equal((await service.send({ question: 'Q', subject: POINT, selection: null }, s.review)).kind, 'sent');
    const adapter = s.adapters[0];
    assert.ok(adapter !== undefined);
    adapter.cancelMode = 'silent';
    adapter.delta('partial');
    assert.equal((await service.cancel()).kind, 'cancel-requested');
    assert.equal(service.status().unresolved[0]?.state, 'cancel-requested');
    assert.equal(service.status().turn?.stopping, true);
    await until(() => service.status().unresolved[0]?.state === 'outcome-unknown', 'the confirmation window to expire');
    const answer = storedMessages(s).find((message) => message.role === 'answer');
    assert.equal(answer?.status, 'unknown');
    assert.equal(answer?.text, 'partial');

    const refused = await service.send({ question: 'Next', subject: POINT, selection: null }, s.review);
    assert.equal(refused.kind, 'refused');
    const ids = refused.kind === 'refused' ? (refused.acknowledgeable ?? []) : [];
    assert.equal(ids.length, 1);
    assert.equal(adapter.sent.length, 1);
    service.acknowledge(ids);
    adapter.activeRun = null;
    assert.equal((await service.send({ question: 'Next', subject: POINT, selection: null }, s.review)).kind, 'sent');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('the review\'s cancel and errors never touch a chat adapter held beside it, and the reverse', async () => {
  const s = await setup();
  try {
    const chat = new ScriptedAdapter('chat');
    const chatEvents: AgentEvent[] = [];
    const chatSession = await chat.startSession({ provider: 'cursor', modelRequested: 'm', workspacePath: s.fixture.repo });
    chat.subscribe(chatSession.dspatchSessionId, (event) => chatEvents.push(event));
    void chat.send(chatSession.dspatchSessionId, 'a chat message');
    const chatEventsBefore = chatEvents.length;

    const service = s.discussions({ cancelConfirmMs: 2_000 }).attach(1, s.identity, () => undefined, 'cursor');
    assert.equal((await service.send({ question: 'Q', subject: POINT, selection: null }, s.review)).kind, 'sent');
    const review = s.adapters[0];
    assert.ok(review !== undefined && review !== chat);
    review.delta('review text');
    await service.cancel();
    review.sendMode = 'reject';
    const failed = await service.send({ question: 'Fails', subject: POINT, selection: null }, s.review);
    assert.equal(failed.kind, 'failed');
    assert.match(failed.kind === 'failed' ? failed.error : '', /fetch failed/);
    assert.equal(storedMessages(s).find((message) => message.status === 'failed')?.text, 'Fails', 'the question text is kept');
    assert.equal(chat.cancelCalls, 0);
    assert.equal(chatEvents.length, chatEventsBefore);
    assert.equal(chat.activeRun !== null, true, 'the chat run is still going');

    // The reverse: the chat cancels and errors, the review's record is unchanged.
    const before = JSON.stringify(storedMessages(s));
    await chat.cancel();
    chat.emit({ type: 'run.finished', status: 'error' } as Partial<AgentEvent> & { type: 'run.finished' });
    assert.equal(review.cancelCalls, 1);
    assert.equal(JSON.stringify(storedMessages(s)), before);
    // An event naming another session is dropped by the review's own guard.
    review.emit({ type: 'assistant.delta', text: 'foreign' } as Partial<AgentEvent> & { type: 'assistant.delta' }, chatSession.dspatchSessionId);
    assert.equal(service.foreignEventsDropped, 1);
    assert.equal(JSON.stringify(storedMessages(s)), before);
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('a quit while an answer arrives leaves it unknown, and after a restart the next question needs an acknowledgement', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const service = discussions.attach(1, s.identity, () => undefined, 'cursor');
    assert.equal((await service.send({ question: 'Q', subject: POINT, selection: null }, s.review)).kind, 'sent');
    s.adapters[0]?.delta('half');
    await discussions.dispose();
    assert.equal(s.adapters[0]?.disposed, true);
    assert.equal(storedMessages(s).find((message) => message.role === 'answer')?.status, 'unknown');
    assert.equal((await service.send({ question: 'After quit', subject: POINT, selection: null }, s.review)).kind, 'refused');

    const restarted = s.discussions().attach(1, s.identity, () => undefined, 'cursor');
    const loaded = await restarted.load(null, s.review);
    assert.equal(loaded.kind, 'loaded');
    if (loaded.kind !== 'loaded') {
      return;
    }
    assert.equal(loaded.status.needsAcknowledgement.length, 1);
    assert.match(loaded.note ?? '', /no known outcome/);
    const refused = await restarted.send({ question: 'Next', subject: POINT, selection: null }, s.review);
    assert.equal(refused.kind, 'refused');
    assert.equal(s.adapters.length, 1, 'a refused question starts no session');
    restarted.acknowledge(loaded.status.needsAcknowledgement);
    assert.equal((await restarted.send({ question: 'Next', subject: POINT, selection: null }, s.review)).kind, 'sent');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('a window closed mid-answer lets it finish and saves it; a reopened window is rebound and shown the running turn', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const first = recorder();
    const service = discussions.attach(1, s.identity, first.send, 'cursor');
    assert.equal((await service.send({ question: 'Q', subject: POINT, selection: null }, s.review)).kind, 'sent');
    const adapter = s.adapters[0];
    assert.ok(adapter !== undefined);
    adapter.delta('one ');
    discussions.detach(1);
    assert.equal(adapter.disposed, false, 'a running turn keeps its adapter');

    const second = recorder();
    discussions.attach(2, s.identity, second.send, 'cursor');
    const loaded = await service.load(null, s.review);
    assert.ok(loaded.kind === 'loaded' && loaded.status.turn !== null);
    assert.equal(loaded.kind === 'loaded' ? loaded.messages.find((message) => message.role === 'answer')?.text : '', 'one ');
    const firstCount = first.events.length;
    adapter.delta('two');
    adapter.finish();
    assert.equal(first.events.length, firstCount, 'the closed window hears nothing more');
    assert.ok(second.events.some((event) => event.kind === 'delta' && event.text === 'two'));
    assert.equal(storedMessages(s).find((message) => message.role === 'answer')?.text, 'one two');

    // Closed with nothing running: the adapter goes.
    assert.equal(adapter.disposed, false);
    discussions.detach(2);
    await until(() => adapter.disposed, 'the adapter to be closed');
    assert.equal(service.holdsAdapter(), false);
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('the session runs in an empty DSpatch-owned folder, and production adapters are text-only', async () => {
  const s = await setup();
  try {
    const service = s.discussions().attach(1, s.identity, () => undefined, 'cursor');
    await service.send({ question: 'Q', subject: POINT, selection: null }, s.review);
    const config = s.adapters[0]?.started[0];
    const folder = discussionWorkingFolder(s.fixture.records, s.identity.key);
    assert.equal(config?.workspacePath, folder);
    assert.equal(config?.workspacePaths, undefined);
    assert.notEqual(config?.workspacePath, s.fixture.repo);
    assert.deepEqual(fs.readdirSync(folder), []);

    // The shared factory (DSP-132): Cursor for review is text-only; building one
    // contacts nothing (the offline guard would fail the file).
    const production = providerAdapters({ presentation: false, claudeAuthorizationReference: null, claudeInstalled: false });
    const adapter = production.createAdapter({ provider: 'cursor', purpose: 'review' });
    assert.ok(adapter instanceof CursorSdkAdapter);
    assert.equal((adapter as unknown as { toolPolicy: string }).toolPolicy, 'text-only');
    assert.equal(production.reviewPresentationBehaviour, null);
    await adapter.dispose();
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('in presentation mode the review adapters keep a record of their own, apart from the chat\'s', async () => {
  const s = await setup();
  try {
    const chatBehaviour = new PresentationResumeBehaviour('ok');
    const factory = providerAdapters({
      presentation: true,
      reviewPresentation: { deltaMs: 1 },
      claudeAuthorizationReference: null,
      claudeInstalled: false,
    });
    assert.ok(factory.reviewPresentationBehaviour !== null && factory.reviewPresentationBehaviour !== chatBehaviour);
    const discussions = new ReviewDiscussions({ recordsDir: s.fixture.records, log: () => undefined, createAdapter: factory.createAdapter });
    const service = discussions.attach(1, s.identity, () => undefined, 'cursor');
    assert.equal((await service.send({ question: 'Q', subject: POINT, selection: null }, s.review)).kind, 'sent');
    await until(() => storedMessages(s).some((message) => message.role === 'answer' && message.status === 'done'), 'the presentation answer');
    assert.equal(factory.reviewPresentationBehaviour?.record().sent.length, 1);
    assert.equal(chatBehaviour.record().sent.length, 0);
    await discussions.dispose();
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('a quit while a send reads its envelope creates no adapter and sends nothing', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const service = discussions.attach(1, s.identity, () => undefined, 'cursor');
    let release: (() => void) | null = null;
    const slowEnvelopes = {
      envelopeFor: async (request: unknown) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return s.review.envelopeFor(request);
      },
    };
    const sending = service.send({ question: 'Q', subject: POINT, selection: null }, slowEnvelopes);
    await until(() => release !== null, 'the send to wait for its envelope');
    await discussions.dispose();
    (release as unknown as () => void)();
    assert.deepEqual(await sending, { kind: 'refused', error: 'DSpatch is closing; the question was not sent.' });
    assert.equal(s.adapters.length, 0, 'no adapter was created after the quit');
    assert.equal(service.holdsAdapter(), false);
    assert.equal(fs.existsSync(discussionRecordPath(s.fixture.records, s.identity.key)), false, 'nothing was recorded');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

// Niclas's decision of 30 October 2026: a question in the discussion may read the two
// revisions with the analysis access. SIMULATED: a scripted adapter and a scripted folder.
test('with code access a question runs in the held revisions under the analysis policy, and its references are checked before they are shown', async () => {
  const s = await setup();
  try {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-held-'));
    const events: string[] = [];
    const analysis: ScriptedAdapter[] = [];
    const policy = { mode: 'analysis-test' };
    const discussions = new ReviewDiscussions({
      recordsDir: s.fixture.records,
      log: () => undefined,
      createAdapter: () => {
        throw new Error('the tool-free adapter was asked for although the agent can read the code');
      },
      codeAccess: {
        offered: (provider) => provider === 'claude',
        createAdapter: () => {
          const adapter = new ScriptedAdapter('scripted-analysis');
          (adapter as unknown as { permissionPolicy: () => unknown }).permissionPolicy = () => policy;
          const dispose = adapter.dispose.bind(adapter);
          adapter.dispose = () => {
            events.push('adapter closed');
            return dispose();
          };
          analysis.push(adapter);
          return adapter;
        },
        policy,
        policyLine: () => 'Read, Glob and Grep in the revisions',
        hold: (identity, holder) => {
          events.push(`held ${identity.base.slice(0, 7)}→${identity.target.slice(0, 7)} for ${holder.startsWith('discussion-') ? 'the discussion' : holder}`);
          return Promise.resolve({
            folder,
            section: '## The code, and how to read it\nTEST FOLDER SECTION',
            check: (raw: unknown) => {
              const block = raw as { answer: string; references?: { path: string; side: 'base' | 'target'; start: number; end: number; label: string }[] };
              const references = (block.references ?? []).filter((entry) => entry.path === 'src/real.ts');
              return Promise.resolve({
                answer: block.answer,
                references: references.map((entry) => ({ label: entry.label, range: { kind: 'lines' as const, side: entry.side, path: entry.path, start: entry.start, end: entry.end } })),
                insufficient: false,
                adjustments: (block.references ?? []).length > references.length ? ['A reference was left out: src/made-up.ts is not in that revision.'] : [],
              });
            },
            release: () => events.push('released'),
          });
        },
      },
    });
    const window = recorder();
    const service = discussions.attach(1, s.identity, window.send, 'claude');
    const sent = await service.send({ question: 'What is `Workspace`?', subject: POINT, selection: null }, s.review);
    assert.equal(sent.kind, 'sent');
    const adapter = analysis[0];
    assert.ok(adapter !== undefined, 'an analysis adapter was built');
    assert.equal(adapter.started[0]?.workspacePath, folder, 'the session runs in the held revisions');
    const prompt = adapter.sent[0] ?? '';
    assert.match(prompt, /^DSPATCH-REVIEW-TASK: review-question/);
    assert.match(prompt, /find and read its real definition/);
    assert.match(prompt, /TEST FOLDER SECTION/);
    assert.match(prompt, /```dspatch-references/);

    // What the agent is doing, from the provider's events only, told calmly (30 October 2026).
    const activities = (): string[] => window.events.flatMap((event) => (event.kind === 'activity' ? [event.activity] : []));
    assert.deepEqual(activities(), ['Waiting for the agent…'], 'waiting is said at once');
    adapter.emit({ type: 'tool.started', toolCallId: 't0', name: 'Read', subject: path.join(folder, 'target', 'src', 'real.ts') } as Partial<AgentEvent> & { type: 'tool.started' });
    adapter.emit({ type: 'tool.finished', toolCallId: 't0', name: 'Read', status: 'ok' } as Partial<AgentEvent> & { type: 'tool.finished' });
    adapter.emit({ type: 'tool.started', toolCallId: 't1', name: 'Grep', subject: path.join(folder, 'target') } as Partial<AgentEvent> & { type: 'tool.started' });
    adapter.emit({ type: 'tool.finished', toolCallId: 't1', name: 'Grep', status: 'ok' } as Partial<AgentEvent> & { type: 'tool.finished' });
    // Two calls within the interval: only the latest is told, not a log of both.
    await until(() => activities().length === 2, 'the next activity');
    assert.deepEqual(activities(), ['Waiting for the agent…', 'Searching the code…']);
    assert.equal(service.status().turn?.activity, 'Searching the code…', 'a window arriving now is told too');
    adapter.emit({ type: 'tool.started', toolCallId: 't2', name: 'Read', subject: path.join(folder, 'target', 'src', 'real.ts') } as Partial<AgentEvent> & { type: 'tool.started' });
    await until(() => activities().length === 3, 'the read');
    assert.equal(activities()[2], 'Reading real.ts…');
    adapter.emit({ type: 'tool.finished', toolCallId: 't2', name: 'Read', status: 'ok' } as Partial<AgentEvent> & { type: 'tool.finished' });
    adapter.delta('`Workspace` is the state kept per project.\n\n```dspatch-references\n');
    await until(() => activities().length === 4, 'writing');
    assert.equal(activities()[3], 'Writing the answer…');
    adapter.delta(JSON.stringify({ references: [{ label: 'Its definition', path: 'src/real.ts', side: 'target', start: 3, end: 5 }, { label: 'Made up', path: 'src/made-up.ts', side: 'target', start: 1, end: 1 }], insufficient: false }));
    adapter.delta('\n```');
    adapter.finish();
    await until(() => storedMessages(s).some((message) => message.role === 'answer' && message.references !== undefined), 'the checked answer');
    const answer = storedMessages(s).find((message) => message.role === 'answer');
    assert.equal(answer?.text, '`Workspace` is the state kept per project.', 'the block is not part of the text shown');
    assert.equal(service.status().turn, null, 'the activity ends with the turn');
    assert.equal(activities().length, 4, 'nothing is said after the end');
    assert.deepEqual(answer?.references?.map((entry) => entry.range.path), ['src/real.ts'], 'only a checked reference is kept');
    assert.equal(answer?.adjustments?.length, 1, 'what was left out is said');
    assert.deepEqual(answer?.reads, ['Read target/src/real.ts', 'Grep target', 'Read target/src/real.ts']);
    const question = storedMessages(s).find((message) => message.role === 'question');
    assert.equal(question?.codeAccess, true);
    assert.equal(question?.toolPolicy, 'Read, Glob and Grep in the revisions');
    // The instruction sent first is the one for reading the revisions, and it is what the question records.
    assert.ok(prompt.includes(REVIEW_DISCUSSION_CODE_INSTRUCTION));
    assert.ok(!prompt.includes(REVIEW_DISCUSSION_INSTRUCTION), 'the tool-free instruction is not sent with code access');
    assert.equal(question?.instruction, REVIEW_DISCUSSION_CODE_INSTRUCTION);

    // Closing the window closes the session: the adapter first, then the revisions.
    discussions.detach(1);
    await until(() => events.includes('released'), 'the revisions to be released');
    assert.deepEqual(events.slice(-2), ['adapter closed', 'released']);
    assert.equal(events.filter((entry) => entry.startsWith('held')).length, 1);
    fs.rmSync(folder, { recursive: true, force: true });
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('an analysis adapter without the analysis policy is refused, nothing is sent, and the revisions are released', async () => {
  const s = await setup();
  try {
    const released: string[] = [];
    const discussions = new ReviewDiscussions({
      recordsDir: s.fixture.records,
      log: () => undefined,
      createAdapter: () => new ScriptedAdapter(),
      codeAccess: {
        offered: () => true,
        createAdapter: () => {
          const adapter = new ScriptedAdapter('wrong-policy');
          (adapter as unknown as { permissionPolicy: () => unknown }).permissionPolicy = () => ({ mode: 'chat' });
          return adapter;
        },
        policy: { mode: 'analysis-test' },
        policyLine: () => 'analysis',
        hold: () => Promise.resolve({ folder: s.fixture.records, section: '', check: () => Promise.resolve({ error: 'unused' }), release: () => released.push('released') }),
      },
    });
    const service = discussions.attach(1, s.identity, recorder().send, 'claude');
    const sent = await service.send({ question: 'What is it?', subject: POINT, selection: null }, s.review);
    assert.equal(sent.kind, 'refused');
    assert.match(sent.kind === 'refused' ? sent.error : '', /read-only analysis policy/);
    assert.deepEqual(released, ['released']);
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('Explain more simply asks about that answer with its own question\'s context, keeps it, and refuses one that is not finished', async () => {
  const s = await setup();
  try {
    const service = s.discussions().attach(1, s.identity, () => undefined, 'cursor');
    assert.equal((await service.send({ question: 'Why 20?', subject: POINT, selection: null }, s.review)).kind, 'sent');
    const adapter = s.adapters[0];
    assert.ok(adapter !== undefined);
    const pending = storedMessages(s).find((message) => message.role === 'question');
    adapter.delta('Because the target says so.');
    adapter.finish();
    const answer = storedMessages(s).find((message) => message.role === 'answer');
    assert.equal(answer?.status, 'done');

    // The window has moved elsewhere; the simpler explanation still goes with the first context.
    const simpler = await service.send({ question: 'Explain more simply the answer to: “Why 20?”', subject: AWAY, selection: null, simplify: { answerId: answer?.id ?? '' } }, s.review);
    assert.equal(simpler.kind, 'sent');
    const prompt = adapter.sent[1] ?? '';
    assert.match(prompt, /## The answer to explain more simply\nThe person asked: Why 20\?\n/);
    assert.match(prompt, /### Shown 1: The answer to explain more simply\nBecause the target says so\./);
    // DSP-176: the rules of Explain more simply, first attempt, with what was shown.
    assert.match(prompt, /## Explaining more simply \(attempt 1\)\n- Explain the same thing more simply/);
    assert.ok(!prompt.includes('They did not make it clear enough'), 'a first press does not ask for another way in');
    assert.match(prompt, /## Subject\nWalk 1 › b changes › /);
    assert.ok(!prompt.includes('src/untouched.ts'), 'what the window shows now is not the context');
    const asked = storedMessages(s).filter((message) => message.role === 'question').at(-1);
    assert.equal(asked?.simplifies, answer?.id);
    assert.equal(asked?.envelope?.subject.kind, 'point');
    assert.equal(asked?.deepen, undefined);
    adapter.finish();
    // The original is kept as it was.
    assert.equal(storedMessages(s).find((message) => message.id === answer?.id)?.text, 'Because the target says so.');

    // An id that is not an answer (here: the question): refused, nothing recorded or sent.
    const refused = await service.send({ question: 'Simpler', subject: POINT, selection: null, simplify: { answerId: pending?.id ?? '' } }, s.review);
    assert.equal(refused.kind, 'refused');
    assert.equal(adapter.sent.length, 2);
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

// Niclas's decision of 30 October 2026: one discussion per revision pair, its windows sharing
// what the next question is about and its draft. SIMULATED: a scripted adapter.
test('the windows of one review share what the next question is about and the draft; a send lets the quote go', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const walk = recorder();
    const diff = recorder();
    const one = discussions.attach(1, s.identity, walk.send, 'cursor');
    const two = discussions.attach(2, s.identity, diff.send, 'cursor');
    assert.equal(one, two, 'both windows reach the same discussion');
    const quote = { kind: 'code' as const, text: 'export', segments: [{ side: 'target' as const, path: 'src/untouched.ts', start: 1, end: 1, from: 0, to: 6 }] };
    two.setQuote(quote, 2);
    assert.deepEqual(walk.events.flatMap((event) => (event.kind === 'quote' ? [event.quote] : [])), [quote]);
    assert.equal(diff.events.filter((event) => event.kind === 'quote').length, 0, 'the window that chose it is not told again');
    const loaded = await one.load(null, s.review);
    assert.ok(loaded.kind === 'loaded');
    assert.deepEqual(loaded.quote, quote, 'a window opened later shows it too');
    one.saveDraft('Why is this exported?', 1);
    assert.deepEqual(diff.events.flatMap((event) => (event.kind === 'draft' ? [event.text] : [])), ['Why is this exported?']);
    assert.equal(walk.events.filter((event) => event.kind === 'draft').length, 0);
    // Something that is not a selection lets it go, everywhere else.
    two.setQuote({ kind: 'nonsense' }, 2);
    assert.equal(walk.events.filter((event) => event.kind === 'quote').at(-1)?.kind === 'quote' && (walk.events.filter((event) => event.kind === 'quote').at(-1) as { quote: unknown }).quote, null);
    two.setQuote(quote, 2);
    const sent = await one.send({ question: 'What is this?', subject: AWAY, selection: null, quote }, s.review);
    assert.equal(sent.kind, 'sent', JSON.stringify(sent));
    assert.equal((diff.events.filter((event) => event.kind === 'quote').at(-1) as { quote: unknown } | undefined)?.quote, null, 'the quote went with the question');
    assert.equal((await one.load(null, s.review) as { quote?: unknown }).quote, null);
    s.adapters[0]?.finish();
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

// Niclas's trial, 30 October 2026: a new review's discussion lost its agent when history came with it.
test('history brought into a discussion does not take its agent away: the last one used, else the default', async () => {
  const s = await setup();
  try {
    const before = { id: 'q', role: 'question' as const, text: 'Earlier', at: '', subject: '' };
    const withAgent = s.discussions(undefined, () => [{ ...before, provider: 'claude' as const }]);
    assert.equal(withAgent.attach(1, s.identity, () => undefined, 'cursor').status().agent.provider, 'claude');
    const without = s.discussions(undefined, () => [before]);
    assert.equal(without.attach(1, s.identity, () => undefined, 'cursor').status().agent.provider, 'cursor');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

// DSP-184: a step's explanations are in a channel and a store of their own, apart from the
// discussion. SIMULATED: a scripted adapter; neutral examples.
test('step explanations: no discussion entry and no discussion turn; their own session, store, history and guards', async () => {
  const s = await setup();
  try {
    const events: ReviewDiscussionEvent[] = [];
    const service = s.discussions().attach(1, s.identity, (event) => events.push(event), 'cursor');
    const slot = { walkId: 'W1', stepId: 'W1.1', basis: 'h1', profile: 'essens' } as const;
    const outline = { walkTitle: 'Greeting a visitor', steps: [{ title: 'Read the name', places: ['src/a.ts 1–3 (To)'] }, { title: 'Build the greeting', places: ['src/b.ts 4–9 (To)'] }], current: 0 };
    const explain = (input: Record<string, unknown>) => service.send({ channel: 'explanation', ...slot, parent: null, trigger: 'person', language: 'en', outline, ...input }, s.review) as unknown as Promise<StepExplanationOutcome>;
    const stored = (): StepExplanation[] => (JSON.parse(fs.readFileSync(explanationsRecordPath(s.fixture.records, s.identity.key), 'utf8')) as { entries: StepExplanation[] }).entries;

    // Asked on its own (arrival at the step): sent in the explanations' session.
    const first = await explain({ action: 'present', trigger: 'auto' });
    assert.equal(first.kind, 'sent');
    const explainer = s.adapters[0];
    assert.ok(explainer !== undefined);
    const prompt = explainer.sent[0] ?? '';
    assert.match(prompt, /## How to present \(Essentials\)/);
    assert.match(prompt, /Instruction version: 10/);
    // DSP-194: a profile's explanation gets the form of the answer only; the review question's content rules are not in it.
    assert.doesNotMatch(prompt, /Give the cause and effect behind the answer|Name what you could not read or find|An uncertainty or risk that changes the answer is said in this part/);
    assert.match(prompt, /Write the first part, which stands on its own./);
    assert.match(prompt, /## Where this step is in the walk\nWalk: Greeting a visitor\n1\. Read the name \(code: src\/a\.ts 1–3 \(To\)\)  <- this step\n2\. Build the greeting/);
    assert.match(prompt, /rather than file names, paths or line numbers/);
    assert.ok(!fs.existsSync(discussionRecordPath(s.fixture.records, s.identity.key)), 'the discussion file is not even written');

    // The discussion is not blocked by it, and runs in a session of its own.
    assert.equal((await service.send({ question: 'What does it return?', subject: POINT, selection: null }, s.review)).kind, 'sent');
    const discussion = s.adapters[1];
    assert.ok(discussion !== undefined && discussion !== explainer, 'two sessions, two adapters');
    // A second explanation while one is being written is refused, never queued or repeated.
    const busy = await explain({ action: 'present', profile: 'pedagog' });
    assert.equal(busy.kind, 'refused');
    // A duplicate for the same slot is refused.
    assert.equal((await explain({ action: 'present' })).kind, 'refused');

    explainer.delta('SIMULATED Essentials: it returns the greeting.');
    explainer.finish();
    discussion.finish();
    let entries = stored();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.status, 'done');
    assert.equal(entries[0]?.trigger, 'auto');
    assert.equal(entries[0]?.instructionVersion, 10);
    assert.equal(entries[0]?.prompt, prompt, 'the exact prompt is kept with the explanation');
    assert.ok(events.some((event) => event.kind === 'explanation' && event.entry.prompt === undefined), 'windows get no prompt');
    // The discussion holds only the person's question.
    assert.deepEqual(storedMessages(s).filter((message) => message.role === 'question').map((message) => message.text), ['What does it return?']);

    // Tell me more, Explain more simply and Regenerate build on what was shown, in this profile.
    const base = entries[0]?.id ?? '';
    assert.equal((await explain({ action: 'more', parent: base })).kind, 'sent');
    assert.match(explainer.sent[1] ?? '', /## Going deeper \(Essentials\)[\s\S]*### The Essentials explanation of the step\nSIMULATED Essentials: it returns the greeting\./);
    explainer.delta('SIMULATED deeper.');
    explainer.finish();
    const more = stored().at(-1)?.id ?? '';
    assert.equal((await explain({ action: 'simpler', parent: more })).kind, 'sent');
    assert.match(explainer.sent[2] ?? '', /## Explaining more simply \(attempt 2, Essentials\)[\s\S]*### Shown 1: The Essentials explanation[\s\S]*### Shown 2: Tell me more/);
    explainer.delta('SIMULATED simpler.');
    explainer.finish();
    assert.equal((await explain({ action: 'regenerate', parent: base })).kind, 'sent');
    assert.match(explainer.sent[3] ?? '', /## Regenerating[\s\S]*Do not copy its sentences/);
    explainer.delta('SIMULATED regenerated.');
    explainer.finish();
    entries = stored();
    const history = historyOf(entries, slot);
    assert.deepEqual(history.items.length, 5, 'the walk text, then four explanations, oldest first');
    assert.equal(shownItem(history, undefined), entries.at(-1)?.id, 'the latest is shown');
    assert.equal(shownItem(history, WALK_TEXT), WALK_TEXT, 'the walk text can be gone back to');
    // Switching profile back needs no call: what is there is read from the store.
    const sends = explainer.sent.length;
    assert.equal(historyOf(entries, { ...slot, profile: 'pedagog' }).hasDone, false);
    assert.equal(historyOf(entries, slot).hasDone, true);
    assert.equal(explainer.sent.length, sends);
    // A parent from another profile or step is refused.
    assert.equal((await explain({ action: 'more', parent: base, profile: 'pedagog' })).kind, 'refused');

    // A failure: stored as failed; an automatic request waits for the person's Try again.
    assert.equal((await explain({ action: 'present', profile: 'pedagog', basis: 'h2', trigger: 'auto' })).kind, 'sent');
    explainer.finish('error');
    const failed = stored().at(-1);
    assert.equal(failed?.status, 'failed');
    const again = await explain({ action: 'present', profile: 'pedagog', basis: 'h2', trigger: 'auto' });
    assert.equal(again.kind, 'refused');
    assert.match(again.kind === 'refused' ? again.error : '', /Try again/);
    assert.equal((await explain({ action: 'present', profile: 'pedagog', basis: 'h2', trigger: 'person' })).kind, 'sent', 'Try again is the person\'s');

    // A late answer lands on its own entry: the step version and profile it was asked for, wherever the window is.
    explainer.delta('SIMULATED late answer for the other version, in Teacher.');
    explainer.finish();
    const late = stored().at(-1);
    assert.equal(late?.basis, 'h2');
    assert.equal(late?.profile, 'pedagog');
    assert.equal(late?.text, 'SIMULATED late answer for the other version, in Teacher.');
    assert.equal(historyOf(stored(), slot).items.length, 5, 'nothing landed on W1.1');

    // Nothing of it is in the discussion, or in a new discussion session's recap.
    assert.equal(storedMessages(s).filter((message) => message.role === 'question').length, 1);
    assert.equal(discussion.sent.length, 1);
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('step explanations: DSpatch closing on one leaves it unknown, never repeated on its own', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const service = discussions.attach(1, s.identity, () => undefined, 'cursor');
    const slot = { walkId: 'W1', stepId: 'W1.1', basis: 'h1', profile: 'standard' } as const;
    assert.equal((await service.send({ channel: 'explanation', ...slot, action: 'present', parent: null, trigger: 'auto', language: 'en' }, s.review)).kind, 'sent');
    await discussions.dispose();
    const reopened = s.discussions().attach(2, s.identity, () => undefined, 'cursor');
    const view = await reopened.load(null, s.review);
    const entry = view.kind === 'loaded' ? view.explanations?.entries[0] : undefined;
    assert.equal(entry?.status, 'unknown');
    const outcome = (await reopened.send({ channel: 'explanation', ...slot, action: 'present', parent: null, trigger: 'auto', language: 'en' }, s.review)) as unknown as StepExplanationOutcome;
    assert.equal(outcome.kind, 'refused');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('a discussion question carries the explanation shown in Step as hidden context, with no profile; old profile entries stay stored and out of the recap', async () => {
  const s = await setup();
  try {
    // An older record: an automatic profile explanation asked through the discussion, then a person's question.
    const older: DiscussionMessage[] = [
      { id: 'q-old-present', role: 'question', text: 'Explain this step in the Teacher profile.', at: '1', subject: 's', status: 'sent', deepen: { action: 'present', profile: 'pedagog', basis: 'h1' } },
      { id: 'a-old-present', role: 'answer', text: 'SIMULATED Teacher text.', at: '2', subject: 's', status: 'done', questionId: 'q-old-present' },
      { id: 'q-old-more', role: 'question', text: 'Tell me more about this step.', at: '3', subject: 's', status: 'sent', deepen: { action: 'more', basis: 'h1' } },
      { id: 'a-old-more', role: 'answer', text: 'SIMULATED more.', at: '4', subject: 's', status: 'done', questionId: 'q-old-more' },
    ];
    const service = s.discussions(undefined, () => older).attach(1, s.identity, () => undefined, 'cursor');
    await service.send({ question: 'Why is the default kept?', subject: POINT, selection: null, presentation: { profile: 'pedagog' }, reading: { text: 'SIMULATED Essentials: it returns the greeting.' } }, s.review);
    const prompt = s.adapters[0]?.sent[0] ?? '';
    assert.match(prompt, /## The explanation of this step the person is reading\n[\s\S]*SIMULATED Essentials: it returns the greeting\./);
    assert.ok(!/## How to present|reader's profile|Teacher|Pedagog/.test(prompt.replace(/Earlier in this discussion[\s\S]*?\n## /, '')), 'no profile section');
    assert.match(prompt, /## Earlier in this discussion[\s\S]*Tell me more about this step\./, 'a person-initiated deepening stays in the recap');
    assert.ok(!prompt.includes('SIMULATED Teacher text.'), 'the automatic profile entry is left out of the recap');
    const stored = storedMessages(s);
    assert.ok(stored.some((message) => message.id === 'q-old-present') && stored.some((message) => message.id === 'a-old-present'), 'nothing stored is deleted');
    assert.equal(stored.at(-1)?.readingContext ?? stored.at(-2)?.readingContext, true);
    // A profile explanation is not a discussion question any more.
    s.adapters[0]?.finish();
    const refused = await service.send({ question: 'Explain this step in the Essentials profile.', subject: POINT, selection: null, deepen: { action: 'present', profile: 'essens', basis: 'h1' } }, s.review);
    assert.equal(refused.kind, 'refused');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('Explain more simply on an answer, twice, builds on the chain it simplifies', async () => {
  const s = await setup();
  try {
    const service = s.discussions().attach(1, s.identity, () => undefined, 'cursor');
    const adapter = s.adapters;
    await service.send({ question: 'Why 20?', subject: POINT, selection: null }, s.review);
    adapter[0]?.delta('Because the target says so.');
    adapter[0]?.finish();
    const first = storedMessages(s).find((message) => message.role === 'answer');
    await service.send({ question: 'Simpler', subject: POINT, selection: null, simplify: { answerId: first?.id ?? '' } }, s.review);
    adapter[0]?.delta('The target decides.');
    adapter[0]?.finish();
    const second = storedMessages(s).filter((message) => message.role === 'answer').at(-1);
    await service.send({ question: 'Simpler still', subject: POINT, selection: null, simplify: { answerId: second?.id ?? '' } }, s.review);
    const prompt = adapter[0]?.sent[2] ?? '';
    assert.match(prompt, /## Explaining more simply \(attempt 2\)/);
    assert.match(prompt, /### Shown 1: The answer to “Why 20\?”\nBecause the target says so\./);
    assert.match(prompt, /### Shown 2: The answer to explain more simply\nThe target decides\./);
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('forgetting a deleted review closes its discussion and its step explanations (DSP-186, DSP-184)', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const service = discussions.attach(1, s.identity, () => undefined, 'cursor');
    const slot = { walkId: 'W1', stepId: 'W1.1', basis: 'h1', profile: 'standard' } as const;
    assert.equal((await service.send({ channel: 'explanation', ...slot, action: 'present', parent: null, trigger: 'person', language: 'en' }, s.review)).kind, 'sent');
    await discussions.forget(s.identity.key);
    assert.ok(s.adapters.every((adapter) => adapter.disposed), 'every adapter of the review is closed');
    assert.notEqual(discussions.serviceFor(s.identity), service, 'a later window gets a new service');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

// DSP-186 review: once a deleted review's discussion is let go, nothing it still had on its way writes its files again.
test('an answer whose send returns after its review was deleted does not recreate the discussion file', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const service = discussions.attach(1, s.identity, () => undefined, 'cursor');
    s.sendMode = 'hold';
    const held = service.send({ question: 'Held', subject: POINT, selection: null }, s.review);
    await until(() => s.adapters[0]?.sent.length === 1, 'the held send');
    const file = discussionRecordPath(s.fixture.records, s.identity.key);
    assert.ok(fs.existsSync(file), 'the question was written before the send');
    await discussions.forget(s.identity.key);
    fs.rmSync(file, { force: true });
    s.adapters[0]?.releaseSend();
    await held;
    s.adapters[0]?.delta('late');
    s.adapters[0]?.finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fs.existsSync(file), false, 'nothing was written after the review was deleted');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});

test('a step explanation whose references are still being checked when its review is deleted does not recreate the explanations file', async () => {
  const s = await setup();
  try {
    let resolveCheck: (value: { error: string }) => void = () => undefined;
    let checking = false;
    const analysis: ScriptedAdapter[] = [];
    const policy = { mode: 'analysis-test' };
    const discussions = new ReviewDiscussions({
      recordsDir: s.fixture.records,
      log: () => undefined,
      createAdapter: () => new ScriptedAdapter(),
      codeAccess: {
        offered: () => true,
        createAdapter: () => {
          const adapter = new ScriptedAdapter('late-explanation');
          (adapter as unknown as { permissionPolicy: () => unknown }).permissionPolicy = () => policy;
          analysis.push(adapter);
          return adapter;
        },
        policy,
        policyLine: () => 'analysis',
        hold: () =>
          Promise.resolve({
            folder: s.fixture.records,
            section: '',
            check: () => {
              checking = true;
              return new Promise<{ error: string }>((resolve) => {
                resolveCheck = resolve;
              });
            },
            release: () => undefined,
          }),
      },
    });
    const service = discussions.attach(1, s.identity, () => undefined, 'claude');
    const slot = { walkId: 'W1', stepId: 'W1.1', basis: 'h1', profile: 'standard' } as const;
    assert.equal((await service.send({ channel: 'explanation', ...slot, action: 'present', parent: null, trigger: 'person', language: 'en' }, s.review)).kind, 'sent');
    const adapter = analysis[0];
    assert.ok(adapter !== undefined);
    adapter.delta('The step explained.');
    adapter.finish();
    await until(() => checking, 'the reference check to start');
    await discussions.forget(s.identity.key);
    const file = explanationsRecordPath(s.fixture.records, s.identity.key);
    fs.rmSync(file, { force: true });
    resolveCheck({ error: 'late' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fs.existsSync(file), false, 'nothing was written after the review was deleted');
  } finally {
    fs.rmSync(s.fixture.root, { recursive: true, force: true });
  }
});
