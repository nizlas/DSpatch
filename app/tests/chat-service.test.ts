/**
 * The session-start guard in `chat-service.ts`, and a negative control for it.
 *
 * Report 003 recorded that nothing in this suite imported `chat-service.ts` at
 * all. DSpatch's own repository opens like any other project since Niclas's decision
 * of 31 October 2026, so what is guarded here is the rest of session start.
 *
 * These tests drive the real `ChatService.startChatSession`, not a copy of its
 * rules. Every case here stops in validation, before an adapter is created, so
 * nothing in this file starts a provider session, spends a turn or writes into
 * the folders it inspects.
 *
 * The negative control is the second half of the guard. Refusing by path
 * boundary alone would pass a folder that carries DSpatch's own content but
 * lives elsewhere — a packaged artifact's copy, or a clone — so the control
 * reconstructs the boundary-only rule and shows it accepting exactly that
 * folder.
 *
 *     node --test tests/chat-service.test.ts        (from app/)
 */

import { savedTurnStatusLabel, turnStatusLabel } from '../src/renderer/turn-routing.ts';
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
import { ChatService, toUiEvent, type ChatAdapter } from '../src/main/chat-service.ts';
import { ConversationStore, storedSessionProvider } from '../src/main/conversation-store.ts';
import {
  holdDirectory,
  restoreEnvironment,
  setEnvironment,
  tempRoot,
} from './support/fixtures.ts';

const scratch = tempRoot('chat-service');

let counter = 0;

function makeDir(name: string): string {
  counter += 1;
  const dir = path.join(scratch, `${String(counter)}-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A folder shaped like the DSpatch repository.
 *
 * `packageName` is the one thing that differs between the decoy and the control,
 * because it is the marker the guard reads.
 */
function makeDspatchLookalike(name: string, packageName: string): string {
  const dir = makeDir(name);
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'app', 'package.json'),
    `${JSON.stringify({ name: packageName, version: '0.1.0' }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(dir, 'docs', 'VISION.md'), '# Vision\n', 'utf8');
  return dir;
}

interface Harness {
  readonly service: ChatService;
  readonly logs: readonly string[];
  readonly events: readonly unknown[];
}

function harness(repoRoot: string): Harness {
  const logs: string[] = [];
  const events: unknown[] = [];
  const service = new ChatService({
    // DSP-136: Cursor chosen explicitly, as the person would in Open a project.
    agentChoiceStore: { read: () => 'cursor', write: () => undefined },
    repoRoot,
    send: (event) => {
      events.push(event);
    },
    log: (message) => {
      logs.push(message);
    },
    // Substituted: without it a folder that opens would reach the real Cursor SDK.
    createAdapter: () => new FakeAdapter(),
  });
  return { service, logs, events };
}

async function refusal(
  service: ChatService,
  folder: string,
): Promise<string> {
  try {
    await service.startChatSession({ kind: 'folder', path: folder });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail(`opening ${folder} was expected to be refused, and was not`);
}

// --- DSpatch's own repository is a project like any other -------------------

test('DSpatch\'s own repository opens like any other project', async () => {
  const own = makeDspatchLookalike('own-opens', 'dspatch');
  const inner = path.join(own, 'app');
  const above = path.dirname(own);
  for (const folder of [own, inner, above]) {
    const { service } = harness(makeDir(`own-opens-${path.basename(folder)}`));
    const session = await service.startChatSession({ kind: 'folder', path: folder });
    assert.equal(session.workspacePath, path.resolve(folder));
  }
});

test('a DSpatch copy with an unparsable manifest opens too', async () => {
  const own = makeDspatchLookalike('own-broken', 'dspatch');
  fs.writeFileSync(path.join(own, 'app', 'package.json'), '{ not json');
  const { service } = harness(makeDir('own-broken-root'));
  const session = await service.startChatSession({ kind: 'folder', path: own });
  assert.equal(session.workspacePath, path.resolve(own));
});

// --- The rest of the session-start validation -------------------------------

test('an empty path, a missing folder and a file each say what to do', async () => {
  const { service } = harness(makeDir('validation'));

  assert.match(await refusal(service, '   '), /No folder was chosen/);

  const missing = path.join(scratch, 'not-there-at-all');
  const missingMessage = await refusal(service, missing);
  assert.match(missingMessage, /There is no folder at/);
  assert.ok(missingMessage.includes(path.resolve(missing)));

  const file = path.join(makeDir('validation-file'), 'notes.md');
  fs.writeFileSync(file, 'not a folder\n', 'utf8');
  assert.match(await refusal(service, file), /is a file, not a folder/);
});

test('no session means no prompt, no cancel, no command and no diff', async () => {
  const { service } = harness(makeDir('no-session'));

  await assert.rejects(
    () => service.sendPrompt('hello'),
    /No session is open/,
  );
  await assert.rejects(() => service.cancelRun(), /No session is open/);
  await assert.rejects(
    () => service.runWorkspaceTest({ command: 'echo hi', cwd: scratch }),
    /No session is open, so there is no working copy to run in/,
  );
  assert.throws(() => service.getWorkspaceChanges(), /No session is open/);
});

// --- DSP-61: the leftover sample folder, through the service the window calls -
//
// The exact case from the card: `%TEMP%/dspatch-chat/duration-repo` holds a sample
// project generated on 14–16 September, before the `.dspatch-experiment` marker
// existed, and it is locked. Every new session with the default path used to fail
// there permanently. No provider call is spent on any of this — the folder handling
// is the whole question, and a model turn would prove nothing about it.

/** The leftover as it is: a full sample project with no marker file. */
function plantLeftover(sampleRoot: string): string {
  const leftover = path.join(sampleRoot, 'duration-repo');
  fs.mkdirSync(path.join(leftover, 'src'), { recursive: true });
  fs.writeFileSync(path.join(leftover, 'package.json'), '{ "name": "old" }\n', 'utf8');
  fs.writeFileSync(path.join(leftover, 'src', 'duration.ts'), 'export {};\n', 'utf8');
  assert.equal(
    fs.existsSync(path.join(leftover, '.dspatch-experiment')),
    false,
    'the leftover must be unmarked, or this is not the case DSP-61 is about',
  );
  return leftover;
}

function sampleService(name: string, sampleProjectsRoot: string): ChatService {
  return new ChatService({
    // DSP-136: Cursor chosen explicitly, as the person would in Open a project.
    agentChoiceStore: { read: () => 'cursor', write: () => undefined },
    repoRoot: makeDir(`${name}-repo-root`),
    sampleProjectsRoot,
    send: () => {
      // No renderer in this test.
    },
    log: () => {
      // Quiet.
    },
    createAdapter: () => new FakeAdapter(),
  });
}

test('DSP-61: a new sample session succeeds with an old locked unmarked folder present', async () => {
  const sampleRoot = makeDir('sample-leftover-root');
  const leftover = plantLeftover(sampleRoot);
  // Registered with the fixtures, so a failed assertion below cannot leave the
  // holder alive. It used to, and a live child keeps this whole process alive.
  const release = await holdDirectory(leftover);
  const service = sampleService('sample-leftover', sampleRoot);

  // What used to fail here, permanently, with nothing offered.
  const session = await service.startChatSession({ kind: 'sample' });

  assert.equal(session.origin, 'generated-sample');
  assert.notEqual(
    session.workspacePath.toLowerCase(),
    leftover.toLowerCase(),
    'the new sample project is not the leftover',
  );
  assert.equal(
    path.dirname(session.workspacePath).toLowerCase(),
    sampleRoot.toLowerCase(),
    "and it is inside DSpatch's own sample location",
  );
  // Really generated: the marker and the files the experiment needs are there.
  assert.equal(fs.existsSync(path.join(session.workspacePath, '.dspatch-experiment')), true);
  assert.equal(fs.existsSync(path.join(session.workspacePath, 'src', 'duration.ts')), true);
  assert.match(session.workspaceOrigin, /folder of its own/);

  // The leftover is untouched. Not cleared, not marked, not moved — cleaning up is
  // a separate action, which is the decision this implements.
  assert.equal(fs.existsSync(leftover), true);
  assert.deepEqual(fs.readdirSync(leftover).sort(), ['package.json', 'src']);
  assert.equal(fs.existsSync(path.join(leftover, '.dspatch-experiment')), false);

  // A second session gets its own folder as well, with the first still there.
  const second = await service.startChatSession({ kind: 'sample' });
  assert.notEqual(second.workspacePath, session.workspacePath);
  assert.equal(fs.existsSync(session.workspacePath), true);
  await service.dispose();
  await release();
});

test('DSP-61: the leftover is offered for removal, and removing it leaves the open one alone', async () => {
  const sampleRoot = makeDir('sample-cleanup-root');
  const leftover = plantLeftover(sampleRoot);
  const service = sampleService('sample-cleanup', sampleRoot);
  const session = await service.startChatSession({ kind: 'sample' });

  const offered = service.listSampleProjects();
  assert.deepEqual(
    offered.folders.map((folder) => folder.path),
    [leftover],
    'the folder this session is working in is not offered; the leftover is',
  );
  assert.equal(offered.folders[0]?.marked, false, 'and it is shown as having no marker');
  assert.equal(offered.inUse, session.workspacePath);

  const outcome = service.cleanUpSampleProjects(offered.folders.map((folder) => folder.path));
  assert.deepEqual(outcome.removed, [leftover]);
  assert.equal(fs.existsSync(leftover), false);
  assert.equal(fs.existsSync(session.workspacePath), true, 'the session still has its project');
  await service.dispose();
});

test('DSP-61: the refusal is unchanged for a folder DSpatch did not generate', async () => {
  // The property that must not be weakened. A path named by DSPATCH_CHAT_WORKSPACE
  // is a path a person named: it gets no fresh folder, and a non-empty directory
  // without the marker is refused in the same words as before.
  const sampleRoot = makeDir('sample-refusal-root');
  const someonesWork = makeDir('not-ours');
  fs.writeFileSync(path.join(someonesWork, 'thesis.txt'), 'years of work\n', 'utf8');
  const service = sampleService('sample-refusal', sampleRoot);

  // Restored by the fixtures however this ends. DSP-65 is about this variable
  // overriding an explicit option; a test that leaks it would spread that fault
  // to every test that runs after it.
  setEnvironment({ DSPATCH_CHAT_WORKSPACE: someonesWork });
  try {
    await assert.rejects(
      () => service.startChatSession({ kind: 'sample' }),
      (error: Error) => {
        assert.match(error.message, /Refusing to delete/);
        assert.match(error.message, /has no \.dspatch-experiment file/);
        assert.match(error.message, /may be someone's work/);
        return true;
      },
    );
  } finally {
    restoreEnvironment();
  }
  // Nothing was written into it, and nothing was removed from it.
  assert.deepEqual(fs.readdirSync(someonesWork), ['thesis.txt']);
  assert.equal(fs.readFileSync(path.join(someonesWork, 'thesis.txt'), 'utf8'), 'years of work\n');
  // And no sample folder was quietly created elsewhere instead.
  assert.deepEqual(fs.readdirSync(sampleRoot), []);
  await service.dispose();
});

// --- Simulated failure paths ------------------------------------------------
//
// Everything below uses a **fake adapter**. Nothing here talks to Cursor, and
// none of it is evidence about what Cursor does. It is evidence about what
// DSpatch does when a provider behaves in a way that could not be produced on
// demand against the live one: report 003's two cancellations both reported an
// end in about 50 ms, so the case where none ever arrives — the one that leaves
// the one-run invariant unknown — has to be constructed.

/**
 * A provider that does exactly what the test tells it to.
 *
 * `cancelBehaviour` is the interesting knob. `silent` means `cancel()` resolves
 * and no terminal event ever follows, which is the shape of the unknown case.
 */
class FakeAdapter implements ChatAdapter {
  /** Settable: a test models the Claude adapter by giving it that adapter's `id` (DSP-122). */
  id = 'fake-adapter';

  readonly sent: string[] = [];

  cancelCalls = 0;

  sendBehaviour:
    | 'ok'
    | 'reject-active-run'
    | 'reject-provider-active-run'
    | 'reject-network'
    | 'never-start'
    | 'slow-start' = 'ok';

  /**
   * What `hasActiveRun` answers, which is how the service tells the two refusals
   * apart without reading their prose.
   *
   * `true` models DSpatch's own guard: this adapter holds the run and will emit its
   * end. `false` models Cursor refusing a resumed session that holds a run from
   * before a restart — nothing here is watching it and no event will arrive.
   */
  activeRunHeld = false;

  /**
   * Whether a run object exists that `cancel()` could act on.
   *
   * The real Cursor adapter announces `run.started` and only then awaits the
   * provider, so between those two moments it has an ID but nothing cancellable;
   * `cancel()` throws there. `slow-start` reproduces that interval, and this flag
   * is what makes calling `cancel()` in it fail here too.
   */
  private cancellableRun = false;

  private releaseSend: (() => void) | null = null;

  cancelBehaviour: 'confirm' | 'silent' | 'throw' = 'confirm';

  /**
   * The adapter's declared cancellation bound (DSP-116), or absent as for the
   * Cursor adapter. A test sets it to model an adapter such as Claude's whose own
   * stop sequence takes longer than the default confirmation window.
   */
  cancelEndBoundMs?: number;

  /** Set to model the Claude adapter, which runs each turn in a local process (DSP-117). */
  runsLocalProcess?: boolean;

  /**
   * What `resume` does. The first two were measured against Cursor by a probe: an
   * agent the provider still holds is returned in a brand new process, and one it
   * does not hold is refused with `AgentNotFoundError [agent_not_found]` rather than
   * silently replaced by a fresh agent. The real adapter wraps that refusal in a
   * `CursorAdapterError` carrying `providerCode`, which is the field the service
   * classifies on, so the fake throws the wrapped shape. `'error'` is a failure
   * with no provider code at all — a network or runtime error — which the service
   * must report as a failure that may be temporary, not as the provider's answer.
   *
   * An adapter without the capability at all is modelled by deleting `resume`,
   * because that is what the service actually tests for. `'unaligned'` is the
   * Claude adapter's `local_record_missing_unaligned` (DSP-122): no record found,
   * but the check read a different profile than the provider process is given.
   * `'config-mismatch'` is that adapter's `config_mismatch`: a refusal where trying
   * again with the same inputs gives the same answer.
   */
  resumeBehaviour:
    | 'ok'
    | 'not-found'
    | 'error'
    | 'unaligned'
    | 'config-mismatch'
    | 'auth-refused' = 'not-found';

  /**
   * What a successful `resume` reports it checked. `'provider-answered'` by default,
   * because this fake models Cursor's measured behaviour; a test models another
   * adapter by setting it.
   */
  resumeEvidence: 'provider-answered' | 'local-record' | 'none' | undefined =
    'provider-answered';

  readonly resumeAttempts: string[] = [];

  resume?: (dspatchSessionId: string, config: SessionConfig) => Promise<SessionHandle>;

  constructor() {
    // Assigned rather than declared as a method, because `resume` being optional
    // on the interface is itself load-bearing: the service checks for it.
    this.resume = async (dspatchSessionId, config) => {
      this.resumeAttempts.push(dspatchSessionId);
      if (this.resumeBehaviour === 'not-found') {
        throw Object.assign(
          new Error(
            `Cursor adapter operation "resume" failed: AgentNotFoundError: Agent ` +
              `${dspatchSessionId} not found`,
          ),
          { name: 'CursorAdapterError', providerCode: 'agent_not_found' },
        );
      }
      if (this.resumeBehaviour === 'error') {
        throw Object.assign(
          new Error('Cursor adapter operation "resume" failed: TypeError: fetch failed'),
          { name: 'CursorAdapterError' },
        );
      }
      if (this.resumeBehaviour === 'unaligned') {
        throw Object.assign(
          new Error(
            "DSpatch's local check found no readable session record for " +
              `00000000-0000-4000-8000-000000000001 under ${config.workspacePath} (the ` +
              'default Claude profile). The provider was not asked. The check looked in a ' +
              'different profile than the one the provider process uses (this process: ' +
              'CLAUDE_CONFIG_DIR unset; the provider process: "C:\\synthetic\\profile"), so ' +
              'it says nothing about whether a record exists there.',
          ),
          { name: 'ClaudeAdapterError', providerCode: 'local_record_missing_unaligned' },
        );
      }
      if (this.resumeBehaviour === 'config-mismatch') {
        throw Object.assign(
          new Error(
            `DSpatch's record of session "${dspatchSessionId}" expects tool policy ` +
              'sha256:synthetic, and this adapter\'s policy is sha256:other (toolPolicy). A ' +
              'session is not resumed under a different tool policy. No local record was ' +
              'read and the provider was not asked.',
          ),
          { name: 'ClaudeAdapterError', providerCode: 'config_mismatch' },
        );
      }
      if (this.resumeBehaviour === 'auth-refused') {
        // The Claude adapter's own refusal (DSP-117), before any lookup or process.
        throw Object.assign(
          new Error(
            "DSpatch does not reuse Claude Code's own sign-in: CLAUDE_CODE_OAUTH_TOKEN " +
              'is set in the environment DSpatch was started from (synthetic).',
          ),
          { name: 'ClaudeAdapterError', providerCode: 'authentication_refused' },
        );
      }
      this.sessionId = dspatchSessionId;
      return {
        dspatchSessionId,
        provider: config.provider === 'claude' ? 'claude' : 'cursor',
        providerSessionId: 'agent-resumed',
        createdAt: new Date().toISOString(),
        workspacePath: config.workspacePath,
        ...(this.resumeEvidence === undefined ? {} : { resumeEvidence: this.resumeEvidence }),
      } as unknown as SessionHandle;
    };
  }

  private listener: AgentEventListener | null = null;

  private sessionId = '';

  private runCounter = 0;

  private lastRunId: string | null = null;

  capabilities(): CapabilityReport {
    return {
      start: 'supported',
      streaming: 'supported',
      cancel: 'supported',
      // As the Cursor adapter declares; the service must not word anything from it.
      resume: 'supported',
      modelSelection: 'supported',
      approvals: 'unsupported',
      usageReporting: 'unknown',
    };
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve([
      { id: 'claude-haiku-4-5', displayName: 'fake', provider: 'cursor' },
    ]);
  }

  /** How many new sessions were opened; the refusal states must leave this at 0. */
  startSessionCalls = 0;

  startSession(config: SessionConfig): Promise<SessionHandle> {
    this.startSessionCalls += 1;
    this.sessionId = 'dsp-session-fake';
    return Promise.resolve({
      dspatchSessionId: this.sessionId,
      // The provider it was asked for (DSP-117), as the real adapters do.
      provider: config.provider === 'claude' ? 'claude' : 'cursor',
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

  hasActiveRun(_sessionId: string): boolean {
    return this.activeRunHeld;
  }

  async send(sessionId: string, prompt: string): Promise<RunReference> {
    this.sent.push(prompt);
    if (this.sendBehaviour === 'reject-active-run') {
      throw new Error(
        `Session "${sessionId}" already has an active run (dsp-run-old). At most ` +
          'one run per session.',
      );
    }
    if (this.sendBehaviour === 'reject-provider-active-run') {
      // Cursor's own sentence, verbatim from report 008's measurement — including
      // the missing `an`, which is the whole reason this behaviour exists.
      throw new Error(
        'Cursor adapter operation "send" failed: UnknownAgentError: Agent ' +
          'agent-b8287ca0-1c4d-4f8e-8a1b-3c9d2e5f7a41 already has active run',
      );
    }
    if (this.sendBehaviour === 'reject-network') {
      throw new Error('Cursor adapter operation "send" failed: TypeError: fetch failed');
    }
    this.runCounter += 1;
    const dspatchRunId = `dsp-run-fake-${String(this.runCounter)}`;
    this.lastRunId = dspatchRunId;
    if (this.sendBehaviour === 'never-start') {
      // A send that resolves without the provider ever announcing a run. The
      // window is then waiting on something that has no ID at all.
      await Promise.resolve();
      return { dspatchRunId };
    }
    this.emit({ type: 'run.started', dspatchRunId });
    if (this.sendBehaviour === 'slow-start') {
      await new Promise<void>((resolve) => {
        this.releaseSend = resolve;
      });
    }
    this.cancellableRun = true;
    return { dspatchRunId };
  }

  /** Let a `slow-start` send finish, the way the provider's first reply would. */
  finishSlowSend(): void {
    this.releaseSend?.();
    this.releaseSend = null;
  }

  cancel(_sessionId: string): Promise<void> {
    this.cancelCalls += 1;
    if (!this.cancellableRun) {
      return Promise.reject(
        new Error('Cursor adapter: session has no cancellable run in progress'),
      );
    }
    if (this.cancelBehaviour === 'throw') {
      return Promise.reject(new Error('Cursor reports this run as not cancellable'));
    }
    if (this.cancelBehaviour === 'confirm') {
      this.emit({ type: 'run.finished', status: 'cancelled' });
    }
    // 'silent': resolves, and nothing ever confirms an end.
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

  /** Emit an event the way the real adapter does, on the live listener. */
  emit(
    partial: { readonly type: AgentEvent['type']; readonly dspatchRunId?: string } &
      Record<string, unknown>,
  ): void {
    const event = {
      dspatchSessionId: this.sessionId,
      dspatchRunId: partial.dspatchRunId ?? this.lastRunId ?? 'dsp-run-fake-0',
      at: new Date().toISOString(),
      rawProviderEvent: null,
      ...partial,
    } as unknown as AgentEvent;
    this.listener?.(event);
  }
}

interface FakeHarness {
  readonly service: ChatService;
  readonly adapter: FakeAdapter;
  readonly workspace: string;
  readonly logs: readonly string[];
}

/** A service over a throwaway git-less folder, with the fake provider behind it. */
async function openFakeSession(
  name: string,
  cancelConfirmMs = 40,
  cancelConfirmGraceMs?: number,
): Promise<FakeHarness> {
  const workspace = makeDir(name);
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'a throwaway project\n', 'utf8');
  const adapter = new FakeAdapter();
  const logs: string[] = [];
  const service = new ChatService({
    // DSP-136: Cursor chosen explicitly, as the person would in Open a project.
    agentChoiceStore: { read: () => 'cursor', write: () => undefined },
    repoRoot: makeDir(`${name}-repo-root`),
    send: () => {
      // The renderer is not part of this test.
    },
    log: (message) => {
      logs.push(message);
    },
    createAdapter: () => adapter,
    // Short so the confirmation window can be observed rather than waited out.
    timings: {
      cancelConfirmMs,
      cancelWatchMs: 60,
      ...(cancelConfirmGraceMs === undefined ? {} : { cancelConfirmGraceMs }),
    },
  });
  await service.startChatSession({ kind: 'folder', path: workspace });
  return { service, adapter, workspace, logs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test('SIMULATED: a cancel that is confirmed ends the attempt, and a repeat is free', async () => {
  const { service, adapter } = await openFakeSession('cancel-confirmed');
  await service.sendPrompt('do something long');
  const [attempt] = service.getRunState().attempts;
  assert.equal(attempt?.state, 'running');

  await service.cancelRun();
  assert.equal(service.getRunState().attempts[0]?.state, 'stopped-confirmed');
  assert.deepEqual(service.getRunState().needsAcknowledgement.agentTurn, []);

  // A confirmed end needs no reconciliation, so the next message just goes.
  await service.sendPrompt('the follow-up');
  assert.deepEqual(adapter.sent, ['do something long', 'the follow-up']);
  await service.dispose();
});

test('SIMULATED: a cancel that never confirms an end blocks a second run', async () => {
  // This is the case report 003 left unknown: both of its cancels reported an end
  // in ~50 ms, so the invariant could not be exercised. Here the provider simply
  // never says anything again.
  const { service, adapter } = await openFakeSession('cancel-silent');
  adapter.cancelBehaviour = 'silent';
  await service.sendPrompt('a job that will not end');

  await service.cancelRun();
  const requested = service.getRunState().attempts[0];
  assert.equal(requested?.state, 'cancel-requested');
  // A cancellation that has been asked for is already ambiguous, so a repeat is
  // gated from this moment rather than only once the window expires. The offered
  // action differs: here, waiting for a confirmed end is still worth doing.
  assert.deepEqual(
    service.getRunState().needsAcknowledgement.agentTurn.map((ref) => ref.attemptId),
    [requested?.attemptId],
  );
  assert.equal(requested?.nextAction.kind, 'keep-waiting');

  // The confirmation window expires with nothing confirmed.
  await sleep(120);
  const unknown = service.getRunState().attempts[0];
  assert.equal(unknown?.state, 'outcome-unknown');
  assert.match(unknown?.stateReason ?? '', /No terminal event arrived within/);
  assert.equal(unknown?.stillRunning.provider, null, 'unknown, not stopped');

  // The invariant: DSpatch does not start a second model job. And it does not
  // merely warn afterwards — the provider is never asked.
  const sentBefore = adapter.sent.length;
  await assert.rejects(
    () => service.sendPrompt('the follow-up'),
    /will not repeat this by itself/,
  );
  assert.equal(adapter.sent.length, sentBefore, 'nothing reached the provider');

  // Naming the attempt is what lets the user through, and the earlier attempt
  // stays unresolved rather than being recorded as stopped.
  await service.sendPrompt('the follow-up', [unknown?.attemptId ?? '']);
  assert.equal(adapter.sent.length, sentBefore + 1);
  const after = service.getRunState();
  assert.equal(after.attempts[0]?.state, 'outcome-unknown');
  assert.notEqual(after.attempts[0]?.acknowledgedAtUtc, null);
  assert.equal(after.attempts[1]?.state, 'running');
  await service.dispose();
});

test('SIMULATED: a cancellation that could not be requested is unknown, not stopped', async () => {
  const { service, adapter } = await openFakeSession('cancel-throws');
  adapter.cancelBehaviour = 'throw';
  await service.sendPrompt('a job');

  const outcome = await service.cancelRun();
  assert.notEqual(outcome.error, null);
  const attempt = service.getRunState().attempts[0];
  assert.equal(attempt?.state, 'outcome-unknown');
  assert.match(attempt?.stateReason ?? '', /cancellation request itself failed/);
  await service.dispose();
});

test('SIMULATED: a send that never starts a run can be abandoned', async () => {
  // The gap report 003 found by reading the code: Cancel needs a run, and for
  // 11–12 s in the measured runs there was none.
  const { service, adapter } = await openFakeSession('abandon-send');
  adapter.sendBehaviour = 'never-start';
  await service.sendPrompt('a message that starts nothing');

  const waiting = service.getRunState().attempts[0];
  assert.equal(waiting?.state, 'waiting');
  assert.equal(waiting?.providerRunId, null);

  const abandoned = await service.abandonSend();
  assert.equal(abandoned.cancelledRun, false);
  assert.equal(abandoned.state, 'outcome-unknown');
  const attempt = service.getRunState().attempts[0];
  assert.equal(attempt?.state, 'outcome-unknown');
  assert.match(attempt?.stateReason ?? '', /stopped waiting/);
  // Abandoning is not cancelling: nothing claims the provider stopped.
  assert.equal(attempt?.stillRunning.provider, null);
  assert.equal(adapter.cancelCalls, 0);

  // And it blocks a repeat until named, exactly like an unconfirmed cancel.
  await assert.rejects(
    () => service.sendPrompt('another'),
    /will not repeat this by itself/,
  );
  await service.dispose();
});

test('SIMULATED: a send still in flight is abandoned without a doomed cancel', async () => {
  // The gap as it actually occurs against Cursor: the run is announced at once,
  // so the window shows a run and offers Cancel, but the adapter has nothing to
  // cancel until the provider replies — 11–12 s later in report 003's runs.
  // Calling cancel() there fails. DSpatch must not call it, and must still let
  // the person out of the wait.
  const { service, adapter } = await openFakeSession('abandon-in-flight');
  adapter.sendBehaviour = 'slow-start';
  const sending = service.sendPrompt('a message whose reply is slow');
  await sleep(20);

  const running = service.getRunState().attempts[0];
  assert.equal(running?.state, 'running', 'the run was announced');
  assert.notEqual(running?.providerRunId, null);

  const abandoned = await service.abandonSend();
  assert.equal(abandoned.cancelledRun, false, 'no cancellation was claimed');
  assert.equal(adapter.cancelCalls, 0, 'the doomed cancel was not attempted');
  assert.equal(service.getRunState().attempts[0]?.state, 'outcome-unknown');
  assert.match(
    service.getRunState().attempts[0]?.stateReason ?? '',
    /As soon as a run for it can be cancelled/,
  );

  // The provider replies late. Now a cancellation is possible, so DSpatch asks
  // for one, and the record improves from unknown to a confirmed stop.
  adapter.finishSlowSend();
  await sending;
  await sleep(40);
  assert.equal(adapter.cancelCalls, 1, 'cancelled once it could be');
  assert.equal(service.getRunState().attempts[0]?.state, 'stopped-confirmed');
  assert.deepEqual(service.getRunState().needsAcknowledgement.agentTurn, []);
  await service.dispose();
});

test('SIMULATED: abandoning a send that did start a run cancels that run', async () => {
  const { service, adapter } = await openFakeSession('abandon-running');
  await service.sendPrompt('a message that does start');

  const abandoned = await service.abandonSend();
  assert.equal(abandoned.cancelledRun, true);
  assert.equal(adapter.cancelCalls, 1);
  assert.equal(service.getRunState().attempts[0]?.state, 'stopped-confirmed');
  await service.dispose();
});

test('SIMULATED: abandoning when nothing is waiting says so and does nothing', async () => {
  const { service, adapter } = await openFakeSession('abandon-nothing');
  const outcome = await service.abandonSend();
  assert.equal(outcome.attemptId, null);
  assert.match(outcome.note, /nothing to stop waiting/);
  assert.equal(adapter.cancelCalls, 0);
  await service.dispose();
});

test('SIMULATED: a refused send is recorded as failed and stays retryable', async () => {
  const { service, adapter } = await openFakeSession('send-refused');
  adapter.sendBehaviour = 'reject-network';
  await assert.rejects(() => service.sendPrompt('hello'), /fetch failed/);

  const attempt = service.getRunState().attempts[0];
  assert.equal(attempt?.state, 'failed');
  assert.equal(attempt?.nextAction.kind, 'retry');
  // An observed failure cannot be duplicating anything, so a retry is unblocked.
  assert.deepEqual(service.getRunState().needsAcknowledgement.agentTurn, []);

  adapter.sendBehaviour = 'ok';
  await service.sendPrompt('hello');
  assert.equal(service.getRunState().attempts[1]?.state, 'running');
  await service.dispose();
});

test('SIMULATED: the active-run refusal explains itself instead of leaking an invariant', async () => {
  const { service, adapter } = await openFakeSession('active-run');
  adapter.sendBehaviour = 'reject-active-run';
  // DSpatch's own guard: this window holds the run, so waiting for the end it will
  // actually see is the first thing to say.
  adapter.activeRunHeld = true;
  await assert.rejects(() => service.sendPrompt('hello'), (error: Error) => {
    assert.match(error.message, /already has an active run/);
    // What makes this branch different from the one below, and the only reason it
    // may say the block stops applying: DSpatch is subscribed to this run.
    assert.match(error.message, /subscribed to/);
    assert.match(error.message, /"Execution state" below reports it/);
    assert.match(error.message, /continue in a new provider session/);
    // The figure that was never measured. Verifier 004 read this text on screen
    // beside a note saying waiting is not known to help, so an unmeasured "often
    // arrives within a few seconds" was both unsupported and contradicted.
    assert.doesNotMatch(error.message, /few seconds/);
    assert.doesNotMatch(error.message, /often arrives/);
    assert.match(error.message, /has not been measured/);
    // And it says which of the two situations the measurements beside it are about.
    assert.match(error.message, /never subscribed to, which this is not/);
    return true;
  });
  await service.dispose();
});

test("SIMULATED: Cursor's own active-run refusal is explained, and not as something to wait for", async () => {
  // Report 008's defect 1, as a test that fails against the old code twice over:
  // the string it matched had an `an` in it, and the guidance it produced was
  // written for a run this window can see.
  const { service, adapter } = await openFakeSession('provider-active-run');
  adapter.sendBehaviour = 'reject-provider-active-run';
  adapter.activeRunHeld = false;

  await assert.rejects(() => service.sendPrompt('hello'), (error: Error) => {
    // The provider's own sentence is kept, ahead of DSpatch's explanation.
    assert.match(error.message, /UnknownAgentError: Agent agent-b8287ca0/);
    assert.match(error.message, /already has active run/);
    // What is true: the run belongs to a session this window inherited.
    assert.match(error.message, /not one this window started/);
    assert.match(error.message, /cannot tell you whether or when it ends/);
    // What is not offered, because neither is a way out.
    assert.match(error.message, /Waiting is therefore not the way out/);
    assert.match(error.message, /neither is opening the project again/);
    assert.match(error.message, /Continue in a new provider session instead/);
    assert.doesNotMatch(error.message, /Execution state" below shows when it does/);
    return true;
  });

  const attempt = service.getRunState().attempts[0];
  assert.equal(attempt?.state, 'failed', 'a refusal the provider stated is not unknown');
  await service.dispose();
});

test('SIMULATED: a late terminal event cannot rewrite a settled attempt', async () => {
  const { service, adapter } = await openFakeSession('late-event');
  await service.sendPrompt('a job');
  await service.cancelRun();
  const settled = service.getRunState().attempts[0];
  assert.equal(settled?.state, 'stopped-confirmed');

  // The provider changes its mind 69.5 seconds later, in DSP-1's terms.
  adapter.emit({ type: 'run.finished', status: 'finished' });

  const after = service.getRunState().attempts[0];
  assert.equal(after?.state, 'stopped-confirmed', 'the confirmed stop stands');
  const discarded = after?.history.filter((step) => !step.applied) ?? [];
  assert.equal(discarded.length, 1, 'and the discarded claim is on the record');
  await service.dispose();
});

// --- DSP-116: the adapter's declared cancellation bound and its reported end ---

test("SIMULATED: with a declared bound, the confirmation waits for the adapter's course plus the grace, then says so truthfully", async () => {
  // Default window 40 ms; the adapter declares 400 ms; grace 50 ms: the window is 450 ms.
  const { service, adapter } = await openFakeSession('declared-bound', 40, 50);
  adapter.cancelEndBoundMs = 400;
  adapter.cancelBehaviour = 'silent';
  await service.sendPrompt('a job whose stop takes the adapter a while');
  await service.cancelRun();

  await sleep(200);
  const waiting = service.getRunState().attempts[0];
  assert.equal(waiting?.state, 'cancel-requested', 'not unknown while the adapter is still within its bound');
  // Still gated: a cancellation in progress is ambiguous, so no turn can start early.
  assert.deepEqual(
    service.getRunState().needsAcknowledgement.agentTurn.map((ref) => ref.attemptId),
    [waiting?.attemptId],
  );

  await sleep(500);
  const unknown = service.getRunState().attempts[0];
  assert.equal(unknown?.state, 'outcome-unknown');
  assert.match(unknown?.stateReason ?? '', /No terminal event arrived within 0\.5 s/);
  assert.match(unknown?.stateReason ?? '', /declares that it ends a cancelled run within 0\.4 s/);
  assert.doesNotMatch(unknown?.stateReason ?? '', /about 50 ms/);

  // A late terminal still settles it, as without a bound: outcome-unknown is not settled.
  adapter.emit({ type: 'run.finished', status: 'cancelled', end: 'forced' });
  assert.equal(service.getRunState().attempts[0]?.state, 'stopped-confirmed');
  await service.dispose();
});

test('SIMULATED: a declared bound shorter than the default window does not shorten it', async () => {
  const { service, adapter } = await openFakeSession('declared-short', 300, 0);
  adapter.cancelEndBoundMs = 10;
  adapter.cancelBehaviour = 'silent';
  await service.sendPrompt('a job');
  await service.cancelRun();
  await sleep(120);
  assert.equal(service.getRunState().attempts[0]?.state, 'cancel-requested');
  await sleep(350);
  assert.equal(service.getRunState().attempts[0]?.state, 'outcome-unknown');
  await service.dispose();
});

test('SIMULATED: a cancelled run.finished with end unconfirmed is outcome-unknown, not a confirmed stop', async () => {
  const { service, adapter } = await openFakeSession('end-unconfirmed', 5_000);
  adapter.cancelBehaviour = 'silent';
  await service.sendPrompt('a job whose process does not exit');
  await service.cancelRun();
  adapter.emit({ type: 'run.finished', status: 'cancelled', end: 'unconfirmed' });

  const attempt = service.getRunState().attempts[0];
  assert.equal(attempt?.state, 'outcome-unknown');
  assert.match(attempt?.stateReason ?? '', /reported the end as unconfirmed/);
  assert.match(attempt?.stateReason ?? '', /provider kept working on requests already sent is unknown/);
  assert.equal(attempt?.stillRunning.provider, null, 'unknown, not stopped');
  // It blocks a repeat until named, like any unknown outcome.
  await assert.rejects(() => service.sendPrompt('the follow-up'), /will not repeat this by itself/);
  await service.dispose();
});

test('SIMULATED: a cancelled run.finished with end stopped or forced is a confirmed local end, with provider work unknown', async () => {
  for (const end of ['stopped', 'forced'] as const) {
    const { service, adapter } = await openFakeSession(`end-${end}`, 5_000);
    adapter.cancelBehaviour = 'silent';
    await service.sendPrompt('a job');
    await service.cancelRun();
    adapter.emit({ type: 'run.finished', status: 'cancelled', end });

    const attempt = service.getRunState().attempts[0];
    assert.equal(attempt?.state, 'stopped-confirmed', end);
    assert.match(attempt?.stateReason ?? '', new RegExp(`confirmed local end \\(${end}\\)`));
    assert.match(attempt?.stateReason ?? '', /Whether the provider kept working on requests already sent is unknown/);
    if (end === 'forced') {
      assert.match(attempt?.stateReason ?? '', /had to escalate/);
    } else {
      assert.doesNotMatch(attempt?.stateReason ?? '', /had to escalate/);
    }
    assert.deepEqual(service.getRunState().needsAcknowledgement.agentTurn, []);
    await service.dispose();
  }
});

test('SIMULATED: a turn of an adapter with a local process says so, and its confirmed end leaves only the provider unknown (DSP-117)', async () => {
  for (const end of ['stopped', 'forced'] as const) {
    const { service, adapter } = await openFakeSession(`local-process-${end}`, 5_000);
    adapter.runsLocalProcess = true;
    adapter.cancelBehaviour = 'silent';
    await service.sendPrompt('a job');
    const running = service.getRunState().attempts[0];
    assert.equal(running?.state, 'running');
    assert.equal(running?.adapterProcess, true);
    assert.equal(running?.stillRunning.dspatchProcess, true, 'the adapter started a local process');

    await service.cancelRun();
    adapter.emit({ type: 'run.finished', status: 'cancelled', end });
    const attempt = service.getRunState().attempts[0];
    assert.equal(attempt?.state, 'stopped-confirmed');
    assert.equal(attempt?.runEnd, end);
    assert.equal(attempt?.stillRunning.provider, null, 'provider work unknown, not false');
    assert.equal(attempt?.stillRunning.dspatchProcess, false);
    assert.match(attempt?.stillRunning.note ?? '', /saw its process exit/);
    await service.dispose();
  }
});

test('SIMULATED: a Cursor turn records no end and no local process, exactly as before (DSP-117)', async () => {
  const { service, adapter } = await openFakeSession('cursor-unchanged', 5_000);
  adapter.cancelBehaviour = 'silent';
  await service.sendPrompt('a job');
  assert.equal(service.getRunState().attempts[0]?.stillRunning.dspatchProcess, false);
  await service.cancelRun();
  adapter.emit({ type: 'run.finished', status: 'cancelled' });
  const attempt = service.getRunState().attempts[0];
  assert.equal(attempt?.state, 'stopped-confirmed');
  assert.equal(attempt?.runEnd, undefined);
  assert.equal(attempt?.adapterProcess, undefined);
  assert.equal(attempt?.stillRunning.provider, false);
  assert.equal(attempt?.stillRunning.dspatchProcess, false);
  await service.dispose();
});

test('SIMULATED: closing a session records what became unknown', async () => {
  const { service, adapter } = await openFakeSession('session-close');
  adapter.cancelBehaviour = 'silent';
  await service.sendPrompt('a job that will not end');

  // A new provider session is how a person escapes a stuck session, and closing the
  // old one must not quietly turn an unfinished run into a finished one.
  await service.startChatSession({ kind: 'new-provider-session' });

  const attempt = service.getRunState().attempts[0];
  assert.equal(attempt?.state, 'outcome-unknown');
  assert.match(attempt?.stateReason ?? '', /no longer receiving its events/);

  // Opening another project closes the session as well. Since DSP-4's WS-1 rework the
  // attempt stays in its own conversation and blocks only its own working copy, so a
  // project elsewhere starts clear; conversation-switch.test.ts covers coming back.
  const other = makeDir('session-close-second');
  fs.writeFileSync(path.join(other, 'x.txt'), 'x\n', 'utf8');
  await service.startChatSession({ kind: 'folder', path: other });
  assert.deepEqual(service.getRunState().unresolved, []);
  await service.dispose();
});

// --- The command path, with real processes -----------------------------------

test('a real interrupted command is stopped, never passed', async () => {
  const { service } = await openFakeSession('interrupted-command');
  const node = process.execPath;

  // `cwd: ''` means the working copy the session was opened over.
  const pending = service.runWorkspaceTest({
    command: `"${node}" -e "setInterval(()=>{},1000)"`,
    cwd: '',
  });
  // Give the process time to exist before killing it.
  await sleep(400);
  const stopped = service.stopRunningCommand();
  assert.equal(stopped.stopped, true);

  const outcome = await pending;
  assert.equal(outcome.killedByDspatch, true);
  assert.equal(outcome.verdict, 'interrupted');
  const freshness = service.getTestFreshness();
  assert.equal(freshness.presentedStatus, 'interrupted');
  assert.notEqual(freshness.presentedStatus, 'passed');

  const attempt = service
    .getRunState()
    .attempts.find((entry) => entry.attemptId === outcome.attemptId);
  assert.equal(attempt?.state, 'stopped-confirmed');
  assert.equal(attempt?.stillRunning.dspatchProcess, false);
  await service.dispose();
});

test('a real passing command passes, and a second one is not blocked', async () => {
  const { service } = await openFakeSession('passing-command');
  const node = process.execPath;
  const outcome = await service.runWorkspaceTest({
    command: `"${node}" -e "process.exit(0)"`,
    cwd: '',
  });
  assert.equal(outcome.verdict, 'passed');
  assert.equal(service.getTestFreshness().presentedStatus, 'passed');
  assert.deepEqual(service.getRunState().needsAcknowledgement.command, []);

  const failing = await service.runWorkspaceTest({
    command: `"${node}" -e "process.exit(3)"`,
    cwd: '',
  });
  assert.equal(failing.verdict, 'failed');
  assert.equal(failing.exitCode, 3);
  assert.equal(service.getTestFreshness().presentedStatus, 'failed');
  await service.dispose();
});

// --- The connection reading (report 005, item 7) -----------------------------
//
// The auth reader is injected, so the branch that produced a false `connected` in a
// live run can be exercised here. Before this, `getConnection` called the static
// `Cursor.auth.status()` directly and `npm test` would have stayed green if the whole
// function had been deleted.

function connectionHarness(
  name: string,
  auth: () => Promise<{
    status: string;
    email?: string;
    backendUrl?: string;
    apiKeyExpiresAtMs?: number;
  }>,
  listModels: 'ok' | 'fail',
): ChatService {
  const adapter = new FakeAdapter();
  if (listModels === 'fail') {
    adapter.listModels = () =>
      Promise.reject(new Error('Cursor adapter operation "listModels" failed: fetch failed'));
  }
  return new ChatService({
    // DSP-136: Cursor chosen explicitly, as the person would in Open a project.
    agentChoiceStore: { read: () => 'cursor', write: () => undefined },
    repoRoot: makeDir(`${name}-repo-root`),
    send: () => {
      // No renderer in this test.
    },
    log: () => {
      // Quiet.
    },
    createAdapter: () => adapter,
    readAuthStatus: auth,
  });
}

test('SIMULATED: a stored login that cannot be used is not reported as connected', async () => {
  // The defect this closes was measured in report 005: with the SDK data directory
  // redirected, `auth.status()` still reported a login and the window said
  // "connected". The correction is that a login which cannot reach the provider is an
  // error, and the reason is quoted rather than summarised.
  const service = connectionHarness(
    'connection-unusable',
    () =>
      Promise.resolve({
        status: 'logged-in',
        email: 'someone@example.test',
        backendUrl: 'https://api.example.test',
      }),
    'fail',
  );
  const status = await service.getConnection();
  assert.equal(status.kind, 'error');
  assert.notEqual(status.kind, 'connected');
  if (status.kind === 'error') {
    assert.match(status.message, /fetch failed/);
    assert.match(status.message, /The login\s+itself is intact/);
    assert.match(status.message, /Nothing\s+is sent while this is true/);
  }
  await service.dispose();
});

test('SIMULATED: a logged-out account says what to do and never claims a connection', async () => {
  const service = connectionHarness(
    'connection-logged-out',
    () => Promise.resolve({ status: 'logged-out' }),
    'ok',
  );
  const status = await service.getConnection();
  assert.equal(status.kind, 'not-connected');
  if (status.kind === 'not-connected') {
    assert.match(status.reason, /cursor-agent login/);
    assert.match(status.reason, /DSpatch does not log in for you/);
    // The credential store is named so the user knows what DSpatch is not touching.
    assert.match(status.credentialStorePath, /auth\.json$/);
  }
  await service.dispose();
});

test('SIMULATED: an auth reader that throws produces an error, not a connection', async () => {
  const service = connectionHarness(
    'connection-throws',
    () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:443')),
    'ok',
  );
  const status = await service.getConnection();
  assert.equal(status.kind, 'error');
  if (status.kind === 'error') {
    assert.match(status.message, /ECONNREFUSED/);
  }
  await service.dispose();
});

test('SIMULATED: a usable login is reported as connected, with the model count', async () => {
  // The positive control. Without it, the three tests above would be satisfied by a
  // `getConnection` that reported an error unconditionally.
  const service = connectionHarness(
    'connection-ok',
    () =>
      Promise.resolve({
        status: 'logged-in',
        email: 'someone@example.test',
        backendUrl: 'https://api.example.test',
      }),
    'ok',
  );
  const status = await service.getConnection();
  assert.equal(status.kind, 'connected');
  if (status.kind === 'connected') {
    assert.equal(status.modelsAvailable, 1);
    assert.equal(status.account, 'someone@example.test');
  }
  await service.dispose();
});

// --- Saved conversations across a restart (DSP-4 S1 and S2) ------------------
//
// Every test below uses two `ChatService` instances over one `ConversationStore`
// directory. The second one is what a restart is: a new process with nothing in
// memory and the same files on disk. Where a real restart is needed as evidence — a
// window closed and reopened — that is a live trial, not this file; what these check
// is that the state which reaches disk is sufficient and that reading it back cannot
// restart anything.

interface RestartHarness {
  readonly service: ChatService;
  readonly adapter: FakeAdapter;
  readonly workspace: string;
  readonly store: ConversationStore;
  readonly logs: readonly string[];
}

function serviceOver(
  name: string,
  workspace: string,
  store: ConversationStore,
  conversationForProject?: (projectPath: string) => string | null,
  /** DSP-136: the agent chosen in this installation. */
  chosen: 'cursor' | 'claude' = 'cursor',
): RestartHarness {
  const adapter = new FakeAdapter();
  const logs: string[] = [];
  const service = new ChatService({
    // DSP-136: the agent chosen explicitly, as the person would in Open a project.
    agentChoiceStore: { read: () => chosen, write: () => undefined },
    repoRoot: makeDir(`${name}-repo-root`),
    send: () => {
      // No renderer in this test.
    },
    log: (message) => {
      logs.push(message);
    },
    createAdapter: () => adapter,
    // A launch with Claude enabled (DSP-117), so a conversation recorded as Claude
    // opens as Claude; this one fake stands in for both providers' adapters.
    claudeAuthorizationReference: 'test-only reference',
    claudeSupport: { installed: true, reason: null },
    conversations: () => store,
    ...(conversationForProject === undefined ? {} : { conversationForProject }),
    timings: { cancelConfirmMs: 40, cancelWatchMs: 60 },
  });
  return { service, adapter, workspace, store, logs };
}

function storeFor(name: string): ConversationStore {
  return new ConversationStore(path.join(makeDir(`${name}-userdata`), 'conversations'));
}

test('SIMULATED: Copilot can be chosen when its runtime is installed, and is refused by name when not', async () => {
  const over = (copilotInstalled: boolean): ChatService =>
    new ChatService({
      agentChoiceStore: { read: () => null, write: () => undefined },
      repoRoot: makeDir(`copilot-available-${String(copilotInstalled)}`),
      send: () => undefined,
      log: () => undefined,
      createAdapter: () => {
        throw new Error('nothing is built by choosing');
      },
      copilotInstalled,
    });
  const installed = over(true);
  assert.equal(installed.chooseAgent('copilot'), 'copilot');
  await installed.dispose();
  const missing = over(false);
  assert.throws(() => missing.chooseAgent('copilot'), /Copilot's runtime is missing/);
  await missing.dispose();
});

test('SIMULATED: a conversation survives a restart with its messages in order', async () => {
  const workspace = makeDir('persist-order');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'first\n', 'utf8');
  const store = storeFor('persist-order');

  const first = serviceOver('persist-order-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('what is in this project');
  first.adapter.emit({ type: 'assistant.delta', text: 'a readme' });
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.sendPrompt('and what does it say');
  first.adapter.emit({ type: 'assistant.message', text: 'it says first' });
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.dispose();

  // A new service, nothing in memory: this is the restart.
  const second = serviceOver('persist-order-2', workspace, store);
  const listing = second.service.listConversations();
  assert.equal(listing?.entries.length, 1);
  assert.equal(listing?.entries[0]?.conversationId, session.conversationId);
  assert.equal(listing?.entries[0]?.messageCount, 2);

  const restored = await second.service.resumeConversation(session.conversationId);
  assert.deepEqual(
    restored.messages.map((message) => message.prompt),
    ['what is in this project', 'and what does it say'],
  );
  assert.deepEqual(
    restored.messages.map((message) => message.ordinal),
    [0, 1],
  );
  assert.equal(restored.messages[0]?.answer, 'a readme');
  assert.equal(restored.messages[1]?.answer, 'it says first');
  assert.equal(restored.project.path, workspace);
  assert.equal(restored.project.exists, true);
  await second.service.dispose();
});

test('SIMULATED: restoring starts nothing — no run, no command, no write', async () => {
  const workspace = makeDir('persist-nothing-repeated');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'untouched\n', 'utf8');
  const store = storeFor('persist-nothing-repeated');

  const first = serviceOver('persist-nothing-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('change the readme');
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.dispose();

  const second = serviceOver('persist-nothing-2', workspace, store);
  const restored = await second.service.resumeConversation(session.conversationId);

  assert.equal(second.adapter.sent.length, 0, 'no prompt was sent by restoring');
  assert.deepEqual(restored.reconciliation.repeated, {
    providerRuns: 0,
    commands: 0,
    workspaceWrites: 0,
    note: restored.reconciliation.repeated.note,
  });
  assert.match(restored.reconciliation.repeated.note, /not a patch/);
  assert.match(restored.statement, /no message was resent, no command was run/);
  // The working copy is untouched, and the file listing has nothing added to it.
  assert.equal(fs.readFileSync(path.join(workspace, 'readme.txt'), 'utf8'), 'untouched\n');
  assert.deepEqual(fs.readdirSync(workspace), ['readme.txt']);
  await second.service.dispose();
});

test('SIMULATED: a run left going when the window closed comes back unknown and blocks', async () => {
  // DSP-4 AC#3, end to end through the service. The first process is killed in the
  // sense that matters: it never gets to record an ending for the run.
  const workspace = makeDir('persist-unknown');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('persist-unknown');

  const first = serviceOver('persist-unknown-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('a job that will not report an end');
  assert.equal(first.service.getRunState().attempts[0]?.state, 'running');
  // No dispose, no close: nothing tidies up. What is on disk is what a killed
  // process leaves behind, which is why the save happens before the send.
  const saved = store.read(session.conversationId).conversation;
  assert.equal(saved?.attempts[0]?.state, 'running');

  const second = serviceOver('persist-unknown-2', workspace, store);
  const restored = await second.service.resumeConversation(session.conversationId);
  assert.equal(restored.reconciliation.attempts.length, 1);
  assert.equal(restored.reconciliation.attempts[0]?.stateAtClose, 'running');
  assert.equal(restored.reconciliation.attempts[0]?.stateNow, 'outcome-unknown');
  assert.deepEqual(
    restored.reconciliation.needsAcknowledgement.agentTurn.map((ref) => ref.attemptId),
    [restored.reconciliation.attempts[0]?.attemptId],
  );

  // The gate: continuing the conversation is refused until the attempt is named,
  // and the refusal happens before the provider is touched. The provider still holds
  // the session here: the gate under test is the ledger's, not DSP-121's.
  second.adapter.resumeBehaviour = 'ok';
  await second.service.startChatSession({ kind: 'folder', path: workspace });
  await assert.rejects(
    () => second.service.sendPrompt('carry on then'),
    /will not repeat this by itself/,
  );
  assert.equal(second.adapter.sent.length, 0, 'nothing reached the provider');

  await second.service.sendPrompt('carry on then', [
    restored.reconciliation.attempts[0]?.attemptId ?? '',
  ]);
  assert.equal(second.adapter.sent.length, 1);
  // Naming it did not settle it: the record still says nobody established an end.
  const named = second.service
    .getRunState()
    .attempts.find(
      (attempt) => attempt.attemptId === restored.reconciliation.attempts[0]?.attemptId,
    );
  assert.equal(named?.state, 'outcome-unknown');
  await second.service.dispose();
});

test('SIMULATED: a restored attempt already confirmed is not asked about again', async () => {
  // DSP-6 AC#2, the wording half. Verifier 004 drove this in a real window: it
  // acknowledged an unknown outcome, restarted, opened the conversation, and the
  // restored panel still said "DSpatch will not send another message or run the
  // command again until you confirm you have seen them". There was nothing to
  // confirm and the composer worked at once, so the sentence was false.
  const workspace = makeDir('persist-acknowledged');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('persist-acknowledged');

  // Three services, because that is the sequence the Verifier drove: a window that
  // dies mid-run, a window that meets the gate and acknowledges once, and a third
  // window that opens the same conversation afterwards.
  const first = serviceOver('persist-ack-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('a job that will not report an end');
  const attemptId = first.service.getRunState().attempts[0]?.attemptId ?? '';
  // No dispose: nothing records an ending, which is what a killed process leaves.

  const second = serviceOver('persist-ack-2', workspace, store);
  await second.service.resumeConversation(session.conversationId);
  // The provider still holds the session; the acknowledgement is what is under test.
  second.adapter.resumeBehaviour = 'ok';
  await second.service.startChatSession({ kind: 'folder', path: workspace });
  // The acknowledgement, made the only way anything can make it: a send that names
  // the attempt. That is what the window's own button does.
  await second.service.sendPrompt('carry on then', [attemptId]);
  second.adapter.emit({ type: 'run.finished', status: 'finished' });
  await second.service.dispose();
  const savedSecond = store.read(session.conversationId).conversation;
  assert.notEqual(
    savedSecond?.attempts.find((attempt) => attempt.attemptId === attemptId)
      ?.acknowledgedAtUtc,
    null,
    'the acknowledgement reached the file, which is what the restore reads',
  );

  const third = serviceOver('persist-ack-3', workspace, store);
  const restored = await third.service.resumeConversation(session.conversationId);
  const carried = restored.reconciliation.attempts.find(
    (attempt) => attempt.attemptId === attemptId,
  );
  assert.notEqual(carried, undefined, 'it is still reported as unresolved');
  assert.equal(carried?.stateNow, 'outcome-unknown');
  // Nothing is waiting on it, and both the row and the note say so.
  assert.equal(carried?.blocksRepeat, false);
  assert.deepEqual(restored.reconciliation.needsAcknowledgement.agentTurn, []);
  assert.doesNotMatch(restored.reconciliation.note, /until you confirm you have seen/i);
  assert.match(restored.reconciliation.note, /You confirmed/);
  assert.match(restored.reconciliation.note, /once per attempt rather than once per message/);
  assert.match(restored.reconciliation.note, /unresolved rather than marked done/);

  // And the behaviour the note now describes, measured rather than asserted about:
  // the next message sends with nothing named. The provider still holds the session.
  third.adapter.resumeBehaviour = 'ok';
  await third.service.startChatSession({ kind: 'folder', path: workspace });
  await third.service.sendPrompt('and again');
  assert.equal(third.adapter.sent.length, 1);
  await third.service.dispose();
});

test('SIMULATED: a restored attempt nobody has confirmed still says the message waits', async () => {
  // The negative control for the test above, and the half that must not weaken: the
  // first gate after an unknown outcome is what stops a duplicate.
  const workspace = makeDir('persist-unconfirmed-note');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('persist-unconfirmed-note');

  const first = serviceOver('persist-unconfirmed-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('a job that will not report an end');

  const second = serviceOver('persist-unconfirmed-2', workspace, store);
  const restored = await second.service.resumeConversation(session.conversationId);
  assert.equal(restored.reconciliation.attempts[0]?.blocksRepeat, true);
  assert.match(restored.reconciliation.note, /until you confirm you have seen it/i);
  assert.match(restored.reconciliation.note, /once per attempt, not once per message/);
  await second.service.dispose();
});

test('SIMULATED: nothing unresolved means nothing to reconcile', async () => {
  // The control for the test above. Without it, a restore that always reported an
  // unknown outcome would satisfy the gate test and make the app unusable.
  const workspace = makeDir('persist-clean');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('persist-clean');

  const first = serviceOver('persist-clean-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('a job that finishes');
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.dispose();

  const second = serviceOver('persist-clean-2', workspace, store);
  const restored = await second.service.resumeConversation(session.conversationId);
  assert.deepEqual(restored.reconciliation.attempts, []);
  assert.deepEqual(restored.reconciliation.needsAcknowledgement.agentTurn, []);
  assert.match(restored.reconciliation.note, /nothing to reconcile/);

  // The provider still holds the session; this test is about the ledger, not the resume.
  second.adapter.resumeBehaviour = 'ok';
  await second.service.startChatSession({ kind: 'folder', path: workspace });
  await second.service.sendPrompt('carry on');
  assert.equal(second.adapter.sent.length, 1);
  await second.service.dispose();
});

// --- What a continued conversation actually tells the model (DSP-4 AC#2) ----
//
// The question this answers is the one nobody had answered: a visible old chat is
// not evidence the model received it. A live three-process probe established the
// provider side — `Agent.resume` does carry a Cursor session across process
// boundaries, and refuses an agent it does not hold — so both branches below are
// real possibilities rather than defensive programming, and the window has to be
// able to tell them apart.

/** Restart into a saved conversation and open the project again. */
async function restartInto(
  name: string,
): Promise<{
  readonly workspace: string;
  readonly conversationId: string;
  readonly second: ReturnType<typeof serviceOver>;
}> {
  const workspace = makeDir(name);
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor(name);

  const first = serviceOver(`${name}-1`, workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('what does this project do');
  first.adapter.emit({ type: 'assistant.message', text: 'It dispatches things.' });
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.dispose();

  const second = serviceOver(`${name}-2`, workspace, store);
  await second.service.resumeConversation(session.conversationId);
  return { workspace, conversationId: session.conversationId, second };
}

test('SIMULATED: a resumed provider session says so and resends nothing', async () => {
  const { workspace, second } = await restartInto('continuity-resumed');
  second.adapter.resumeBehaviour = 'ok';

  const session = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(session.continuity.kind, 'provider-session-resumed');
  assert.deepEqual(second.adapter.resumeAttempts, ['dsp-session-fake']);
  assert.equal(session.continuity.resumedProviderSessionId, 'agent-resumed');
  assert.equal(session.continuity.resumeError, null);
  // The point of the branch: nothing is put in front of the message, because the
  // model has the earlier turns from the provider's own store.
  assert.equal(session.continuity.contextToResend, null);
  assert.match(session.continuity.statement, /was resumed/);
  // The fake reports `resumeEvidence: 'provider-answered'`, as the Cursor adapter
  // does, and only then may the statement claim the provider was asked.
  assert.equal(session.continuity.providerSessionOpen, true);
  assert.match(session.continuity.statement, /checked by asking the provider/);
  assert.deepEqual(session.continuity.choices, []);

  await second.service.sendPrompt('and what did I just ask you');
  assert.deepEqual(second.adapter.sent, ['and what did I just ask you']);
  await second.service.dispose();
});

test('SIMULATED: the resumed wording comes from what the adapter checked, not from its capability flag', async () => {
  // The fake declares `capabilities().resume = 'supported'` throughout; what changes
  // between the two cases is only what `resume()` reports it did.
  const local = await restartInto('continuity-evidence-local');
  local.second.adapter.resumeBehaviour = 'ok';
  local.second.adapter.resumeEvidence = 'local-record';
  const fromRecord = await local.second.service.startChatSession({
    kind: 'folder',
    path: local.workspace,
  });
  assert.equal(fromRecord.continuity.kind, 'provider-session-resumed');
  assert.match(fromRecord.continuity.statement, /found a local record of session dsp-session-fake/);
  assert.match(fromRecord.continuity.statement, /not something DSpatch checks/);
  assert.doesNotMatch(fromRecord.continuity.statement, /asking the provider/);
  await local.second.service.dispose();

  const silent = await restartInto('continuity-evidence-none');
  silent.second.adapter.resumeBehaviour = 'ok';
  silent.second.adapter.resumeEvidence = undefined;
  const unsaid = await silent.second.service.startChatSession({
    kind: 'folder',
    path: silent.workspace,
  });
  assert.equal(unsaid.continuity.kind, 'provider-session-resumed');
  assert.match(unsaid.continuity.statement, /the adapter does not say what it checked/);
  assert.doesNotMatch(unsaid.continuity.statement, /asking the provider/);
  assert.doesNotMatch(unsaid.continuity.statement, /local record/);
  await silent.second.service.dispose();
});

// --- DSP-121: a refused or failed resume is the user's choice, not a fallback -----
//
// Until DSP-121 a refused resume opened a new provider session at once, queued the
// recap and let the next save overwrite the recorded session ID, so a temporary
// cause lost the pointer for good. Now DSpatch opens nothing, sends nothing, keeps
// the record exactly as it was and offers the choices that can work: trying again
// and a new session, or only a new session where a retry would give the same answer
// (DSP-121 flow, Niclas 24 October 2026). Reading the history is not a choice any
// more; it is always on screen. These tests use the fake adapter only; no provider
// is called.

const RETRY_AND_NEW = ['try-again', 'new-session'] as const;
const NEW_ONLY = ['new-session'] as const;

test('SIMULATED: a refused resume opens nothing, sends nothing and keeps the session on record', async () => {
  const { workspace, conversationId, second } = await restartInto('continuity-refused');
  second.adapter.resumeBehaviour = 'not-found';
  const before = second.store.read(conversationId).conversation?.session ?? null;
  assert.notEqual(before, null, 'the first run recorded a provider session');
  const attemptsBefore = second.service.getRunState().attempts.length;

  const session = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(session.continuity.kind, 'resume-refused');
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.deepEqual(second.adapter.resumeAttempts, ['dsp-session-fake']);
  assert.equal(second.adapter.startSessionCalls, 0, 'no new provider session');
  assert.equal(session.continuity.contextToResend, null, 'no recap queued by itself');
  assert.deepEqual(session.continuity.resumeFailure, {
    kind: 'provider-missing',
    detail:
      'CursorAdapterError: Cursor adapter operation "resume" failed: ' +
      'AgentNotFoundError: Agent dsp-session-fake not found',
    providerCode: 'agent_not_found',
  });
  assert.deepEqual(session.continuity.choices, RETRY_AND_NEW);
  assert.match(session.continuity.statement, /You can try again, .*; or start a new provider session/);
  assert.doesNotMatch(session.continuity.statement, /keep reading/i);
  // With saved messages, the recap and the readable history are both real.
  assert.match(
    session.continuity.statement,
    /with a recap you can remove before sending\. The saved conversation stays readable either way\./,
  );
  assert.match(session.continuity.contextNote, /1 saved message is on screen as history only/);
  assert.match(session.continuity.contextNote, /shows its recap before anything is sent/);
  assert.match(
    session.continuity.statement,
    /DSpatch asked the provider to resume dsp-session-fake and the provider answered that it does not have that session \(agent_not_found\)\./,
  );
  assert.match(session.continuity.statement, /No new session was opened and nothing was sent/);
  assert.match(session.continuity.statement, /The session ID stays on record/);
  assert.equal(session.continuity.savedMessageCount, 1);
  // The one call made was the resume, and it carried the config (review 004 B1):
  // the context statement must say so rather than claim nothing was sent.
  assert.match(session.context.statement, /gave the provider's SDK/);

  // The session info describes the recorded session, and the file still holds it
  // unchanged — every field, `createdAt` included — after the open's own save.
  assert.equal(session.dspatchSessionId, before?.dspatchSessionId);
  assert.equal(session.providerSessionId, before?.providerSessionId);
  assert.equal(session.createdAt, before?.createdAt);
  assert.deepEqual(second.store.read(conversationId).conversation?.session, before);

  // The guard: nothing that would reach the adapter goes through, and no attempt
  // is opened, so nothing new reaches the file either.
  await assert.rejects(
    () => second.service.sendPrompt('carry on'),
    /No provider session is open for this conversation: the provider answered that it does not have session dsp-session-fake\. Choose: try again, or start a new provider session\.$/,
  );
  await assert.rejects(
    () => second.service.cancelRun(),
    /No provider session is open for this conversation/,
  );
  assert.deepEqual(second.adapter.sent, []);
  assert.equal(second.service.getRunState().attempts.length, attemptsBefore);

  // The report path reads the adapter only through a session it holds; here it holds none.
  const evidence = second.service.evidence();
  assert.equal(evidence['providerMessageTypes'], null);
  assert.equal(evidence['streamPumpFinished'], null);
  assert.equal(evidence['modelReported'], null);

  await second.service.dispose();
  assert.deepEqual(
    second.store.read(conversationId).conversation?.session,
    before,
    'closing saves, and the save keeps the recorded session as it was',
  );
});

test('SIMULATED: a reopened chat that never sent anything opens as a first session, with no resume and no error (DSP-165)', async () => {
  // A project opened and closed before anything was sent: the session block is saved with no
  // messages. A provider may keep nothing of such a session (Copilot stores one from its first
  // message), so there is nothing to resume, and this is the ordinary state of a chat left
  // empty rather than a failure. Earlier (DSP-121 review B1) this attempted the resume and,
  // when it was refused, showed the no-session choices; Niclas asked on 3 November 2026 for
  // the empty chat to open normally.
  const workspace = makeDir('continuity-empty');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('continuity-empty');
  const first = serviceOver('continuity-empty-1', workspace, store);
  const opened = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.dispose();
  assert.notEqual(store.read(opened.conversationId).conversation?.session ?? null, null);

  const second = serviceOver('continuity-empty-2', workspace, store);
  await second.service.resumeConversation(opened.conversationId);
  // Whatever the provider would say of it, it is not asked.
  second.adapter.resumeBehaviour = 'not-found';
  const session = await second.service.startChatSession({ kind: 'folder', path: workspace });
  assert.deepEqual(second.adapter.resumeAttempts, []);
  assert.equal(session.continuity.kind, 'first-session');
  assert.equal(session.continuity.providerSessionOpen, true);
  assert.equal(session.continuity.resumeFailure, null);
  assert.deepEqual(session.continuity.choices, []);
  assert.equal(session.continuity.contextToResend, null);
  assert.equal(session.conversationId, opened.conversationId);
  assert.deepEqual(second.adapter.sent, []);
  await second.service.dispose();
});

test('SIMULATED: a resume that fails with an error is a failure that may be temporary, not the provider\'s answer', async () => {
  const { workspace, conversationId, second } = await restartInto('continuity-failed');
  second.adapter.resumeBehaviour = 'error';
  const before = second.store.read(conversationId).conversation?.session ?? null;

  const session = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(session.continuity.kind, 'resume-failed');
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.equal(session.continuity.resumeFailure?.kind, 'error');
  assert.equal(session.continuity.resumeFailure?.providerCode, null);
  assert.match(String(session.continuity.resumeFailure?.detail), /fetch failed/);
  assert.deepEqual(session.continuity.choices, RETRY_AND_NEW);
  assert.match(
    session.continuity.statement,
    /DSpatch tried to resume dsp-session-fake and the attempt failed: .*fetch failed/,
  );
  assert.match(session.continuity.statement, /This may be temporary/);
  assert.doesNotMatch(
    session.continuity.statement,
    /does not have that session/,
    'an error without a provider code is not presented as the provider\'s answer',
  );
  assert.equal(second.adapter.startSessionCalls, 0);
  assert.deepEqual(second.adapter.sent, []);
  assert.deepEqual(second.store.read(conversationId).conversation?.session, before);
  await assert.rejects(
    () => second.service.sendPrompt('carry on'),
    /No provider session is open for this conversation: resuming dsp-session-fake failed \(/,
  );
  await second.service.dispose();
});

test('SIMULATED: trying again resumes the same conversation and sends nothing', async () => {
  const { workspace, conversationId, second } = await restartInto('continuity-retry');
  second.adapter.resumeBehaviour = 'error';
  const refused = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(refused.continuity.kind, 'resume-failed');

  // The cause has passed; the user tries again. No path is named: it is the
  // project already open, and the resume is attempted again with the same ID.
  second.adapter.resumeBehaviour = 'ok';
  const retried = await second.service.startChatSession({ kind: 'retry-resume' });
  assert.equal(retried.continuity.kind, 'provider-session-resumed');
  assert.equal(retried.continuity.providerSessionOpen, true);
  assert.equal(retried.conversationId, conversationId, 'the same conversation');
  assert.equal(retried.workspacePath, refused.workspacePath);
  assert.deepEqual(second.adapter.resumeAttempts, ['dsp-session-fake', 'dsp-session-fake']);
  assert.equal(second.adapter.startSessionCalls, 0);
  assert.deepEqual(second.adapter.sent, [], 'trying again sends nothing');
  assert.equal(retried.continuity.contextToResend, null);

  await second.service.sendPrompt('and now');
  assert.deepEqual(second.adapter.sent, ['and now']);
  await second.service.dispose();
});

test('SIMULATED: trying again when nothing is open is refused', async () => {
  const workspace = makeDir('no-session-retry');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const { service, adapter } = serviceOver(
    'no-session-retry',
    workspace,
    storeFor('no-session-retry'),
  );
  await assert.rejects(
    () => service.startChatSession({ kind: 'retry-resume' }),
    /No project is open, so there is no recorded provider session to try to resume again/,
  );
  assert.deepEqual(adapter.resumeAttempts, []);
  assert.deepEqual(adapter.sent, []);
  await service.dispose();
});

test('SIMULATED: after a refusal, a new provider session shows its recap, and the recap can be removed', async () => {
  const { workspace, conversationId, second } = await restartInto('continuity-discard');
  second.adapter.resumeBehaviour = 'not-found';
  const refused = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(refused.continuity.kind, 'resume-refused');

  const fresh = await second.service.startChatSession({ kind: 'new-provider-session' });
  assert.equal(fresh.continuity.kind, 'new-provider-session');
  assert.equal(fresh.conversationId, conversationId);
  assert.equal(second.adapter.startSessionCalls, 1);
  const recap = String(fresh.continuity.contextToResend);
  assert.match(recap, /what does this project do/);
  assert.match(fresh.continuity.statement, /unless you remove it first/);
  assert.deepEqual(second.adapter.sent, [], 'choosing a new session sends nothing');

  // The recorded session was replaced only now, by the user's choice.
  const stored = second.store.read(conversationId).conversation?.session;
  assert.equal(stored?.providerSessionId, 'agent-fake');

  const after = second.service.discardPendingRecap();
  assert.equal(after.contextToResend, null);
  assert.match(after.contextNote, /The recap was removed at your request/);
  assert.equal(second.service.sessionContinuity().contextToResend, null);
  assert.deepEqual(second.service.discardPendingRecap(), after, 'removing twice changes nothing');

  await second.service.sendPrompt('only my words');
  assert.deepEqual(second.adapter.sent, ['only my words'], 'the message goes without the recap');
  second.adapter.emit({ type: 'run.finished', status: 'finished' });

  // A refused send does not bring the removed recap back.
  second.adapter.sendBehaviour = 'reject-network';
  await assert.rejects(() => second.service.sendPrompt('again'), /fetch failed/);
  second.adapter.sendBehaviour = 'ok';
  await second.service.sendPrompt('again');
  assert.equal(second.adapter.sent[2], 'again');
  await second.service.dispose();
});

test('SIMULATED: an earlier message with no confirmed end is listed, and nothing is resent', async () => {
  const workspace = makeDir('continuity-unresolved');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('continuity-unresolved');

  const first = serviceOver('continuity-unresolved-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('a job left going');
  // No end ever arrives; the window closes, which records the attempt as unknown.
  await first.service.dispose();

  const second = serviceOver('continuity-unresolved-2', workspace, store);
  await second.service.resumeConversation(session.conversationId);
  second.adapter.resumeBehaviour = 'not-found';
  const reopened = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(reopened.continuity.kind, 'resume-refused');
  // A Cursor session is resumed first and gated at the send (DSP-4's order); the
  // unconfirmed-end rule of DSP-122 applies to sessions recorded as Claude only.
  assert.deepEqual(second.adapter.resumeAttempts, ['dsp-session-fake']);
  assert.equal(storedSessionProvider(second.store.read(session.conversationId).conversation?.session), 'cursor');
  const listed = reopened.continuity.earlierSendsMayHaveReached;
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.label, 'a job left going');
  assert.equal(listed[0]?.state, 'outcome-unknown');
  assert.equal(listed[0]?.acknowledged, false);
  assert.match(
    reopened.continuity.statement,
    /1 earlier message of this conversation may have reached the provider and has no confirmed end: "a job left going" \(dsp-attempt-\d+, outcome-unknown\)/,
  );
  assert.match(reopened.continuity.statement, /Nothing is resent/);
  assert.deepEqual(second.adapter.sent, []);

  // A new session, if chosen, shows DSpatch's record as a recap and still sends
  // nothing; the unresolved attempt gates the next message until it is named.
  const fresh = await second.service.startChatSession({ kind: 'new-provider-session' });
  assert.deepEqual(second.adapter.sent, []);
  assert.equal(fresh.continuity.earlierSendsMayHaveReached.length, 1);
  assert.match(String(fresh.continuity.contextToResend), /a job left going/);
  await assert.rejects(() => second.service.sendPrompt('carry on'), /unresolved/);
  assert.deepEqual(second.adapter.sent, []);
  await second.service.dispose();
});

/** Change a saved conversation's file on disk, as an earlier build or another machine might have left it. */
function rewriteSavedFile(
  store: ConversationStore,
  conversationId: string,
  mutate: (raw: Record<string, any>) => void,
): void {
  const { filePath } = store.read(conversationId);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(raw);
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
}

/**
 * Like {@link restartInto}, with the file rewritten between the two runs — before
 * the second service reads it — and, with `leaveRunning`, the first run's turn
 * left without an end, so the close records it as `outcome-unknown`.
 */
async function restartIntoRewritten(
  name: string,
  mutate: (raw: Record<string, any>) => void,
  leaveRunning = false,
): Promise<{
  readonly workspace: string;
  readonly conversationId: string;
  readonly second: ReturnType<typeof serviceOver>;
}> {
  const workspace = makeDir(name);
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor(name);

  const first = serviceOver(`${name}-1`, workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('what does this project do');
  if (!leaveRunning) {
    first.adapter.emit({ type: 'assistant.message', text: 'It dispatches things.' });
    first.adapter.emit({ type: 'run.finished', status: 'finished' });
  }
  await first.service.dispose();
  // DSP-136: the second launch has the recorded agent chosen, as a person reopening
  // that conversation would; the Q-A cases with another agent chosen are their own tests.
  let recorded: 'cursor' | 'claude' = 'cursor';
  rewriteSavedFile(store, session.conversationId, (raw) => {
    mutate(raw);
    if (raw['session']?.provider === 'claude') {
      recorded = 'claude';
    }
  });

  const second = serviceOver(`${name}-2`, workspace, store, undefined, recorded);
  await second.service.resumeConversation(session.conversationId);
  return { workspace, conversationId: session.conversationId, second };
}

test('SIMULATED: a version 1 file without a provider field resumes as before, and becomes version 2 only once a provider session is open over it', async () => {
  // This build writes format 2 with the provider named, for Cursor too (DSP-122).
  // A file DSP-121 left behind is format 1 with no provider: made here by hand.
  const { workspace, conversationId, second } = await restartIntoRewritten('continuity-v1', (raw) => {
    assert.equal(raw.formatVersion, 2);
    assert.equal(raw.session.provider, 'cursor');
    raw.formatVersion = 1;
    delete raw.session.provider;
  });
  const before = second.store.read(conversationId).conversation;
  assert.equal(before?.formatVersion, 1);
  assert.equal('provider' in (before?.session ?? {}), false);
  assert.equal(storedSessionProvider(before?.session), 'cursor');

  // Refused: no provider session is open, and the file is not rewritten as
  // version 2 — the session is carried through as it was, provider-less, and the
  // version stays the content's.
  second.adapter.resumeBehaviour = 'not-found';
  const refused = await second.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(refused.continuity.kind, 'resume-refused');
  const afterRefusal = second.store.read(conversationId).conversation;
  assert.equal(afterRefusal?.formatVersion, 1);
  assert.deepEqual(afterRefusal?.session, before?.session);

  // Resumed: the open's save writes version 2 with the provider named explicitly.
  second.adapter.resumeBehaviour = 'ok';
  const session = await second.service.startChatSession({ kind: 'retry-resume' });
  assert.equal(session.continuity.kind, 'provider-session-resumed');
  assert.deepEqual(second.adapter.resumeAttempts, ['dsp-session-fake', 'dsp-session-fake']);
  assert.equal(second.adapter.startSessionCalls, 0);
  const afterResume = second.store.read(conversationId).conversation;
  assert.equal(afterResume?.formatVersion, 2);
  assert.equal(afterResume?.session.provider, 'cursor');
  assert.equal(afterResume?.session.toolPolicy, 'provider-default');
  assert.equal(afterResume?.session.dspatchSessionId, before?.session.dspatchSessionId);
  // `createdAt` is the resumed handle's, as before DSP-122: a resumed session is
  // written from the open handle, and only an unopened one is carried untouched.
  await second.service.dispose();
});

test('SIMULATED: a session recorded as Claude whose last turn has no confirmed end is not resumed until the attempt is acknowledged (DSP-122 AC#4)', async () => {
  const { workspace, conversationId, second } = await restartIntoRewritten(
    'continuity-unconfirmed-claude',
    (raw) => {
      raw.session.provider = 'claude';
    },
    true,
  );
  second.adapter.resumeBehaviour = 'ok';
  const before = second.store.read(conversationId).conversation?.session;
  assert.equal(before?.provider, 'claude');

  const refused = await second.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(refused.continuity.kind, 'resume-refused');
  assert.equal(refused.continuity.providerSessionOpen, false);
  assert.deepEqual(second.adapter.resumeAttempts, [], 'the adapter was not asked');
  assert.equal(second.adapter.startSessionCalls, 0);
  assert.equal(refused.continuity.resumeFailure?.kind, 'unconfirmed-end');
  assert.equal(refused.continuity.resumeFailure?.providerCode, null);
  // Blocked in this build: the refusal is lifted only by a retry that names the
  // attempt, which the window cannot send until DSP-117, so Try again is not offered.
  assert.ok(!refused.continuity.choices.includes('try-again'));
  assert.deepEqual(refused.continuity.choices, NEW_ONLY);
  assert.equal(refused.continuity.contextToResend, null);
  const listed = refused.continuity.earlierSendsMayHaveReached;
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.state, 'outcome-unknown');
  assert.equal(listed[0]?.acknowledged, false);
  assert.match(
    refused.continuity.statement,
    /^DSpatch did not try to resume dsp-session-fake\. The session is recorded as a Claude provider session, and the last message of this conversation, "what does this project do" \(dsp-attempt-\d+, outcome-unknown\), has no confirmed end in DSpatch's record\. Resuming it would continue a transcript that may still be being written by a provider process DSpatch could not confirm had exited\. The provider was not asked, no new session was opened and nothing was sent\. The session ID stays on record\. Trying again with that attempt acknowledged attempts the resume \(this window cannot send that acknowledgement yet\); the attempt itself stays recorded as unresolved\./,
  );
  assert.match(refused.continuity.statement, /Nothing is resent/);
  assert.match(refused.continuity.statement, /You can start a new provider session/);
  assert.doesNotMatch(refused.continuity.statement, /You can try again/);
  // The context statement must agree: no adapter call was made (Verifier 003 F1).
  assert.match(refused.context.statement, /made no call to the adapter or the provider/);
  assert.doesNotMatch(refused.context.statement, /gave the provider's SDK/);
  await assert.rejects(
    () => second.service.sendPrompt('carry on'),
    /No provider session is open for this conversation: resuming dsp-session-fake was not attempted, because the last message of this conversation.*\. Start a new provider session to continue\.$/,
  );
  assert.deepEqual(second.adapter.sent, []);
  assert.deepEqual(
    second.store.read(conversationId).conversation?.session,
    before,
    'the recorded session is kept as it was',
  );

  // Try again naming the attempt: it is acknowledged in the working copy first,
  // then the resume is attempted. The attempt stays listed, now flagged.
  const attemptId = listed[0]?.attemptId ?? '';
  const resumed = await second.service.startChatSession({
    kind: 'retry-resume',
    acknowledgedAttemptIds: [attemptId],
  });
  assert.equal(resumed.continuity.kind, 'provider-session-resumed');
  assert.deepEqual(second.adapter.resumeAttempts, ['dsp-session-fake']);
  assert.equal(resumed.continuity.earlierSendsMayHaveReached.length, 1);
  assert.equal(resumed.continuity.earlierSendsMayHaveReached[0]?.acknowledged, true);
  assert.equal(resumed.continuity.earlierSendsMayHaveReached[0]?.state, 'outcome-unknown');
  assert.match(second.logs.join('\n'), /recorded in the working copy before the resume/);
  await second.service.dispose();
});

test('SIMULATED: trying again without naming the attempt keeps a Claude-recorded session unresumed', async () => {
  const { workspace, second } = await restartIntoRewritten(
    'continuity-unconfirmed-claude-again',
    (raw) => {
      raw.session.provider = 'claude';
    },
    true,
  );
  second.adapter.resumeBehaviour = 'ok';
  const refused = await second.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(refused.continuity.resumeFailure?.kind, 'unconfirmed-end');
  const again = await second.service.startChatSession({ kind: 'retry-resume' });
  assert.equal(again.continuity.resumeFailure?.kind, 'unconfirmed-end');
  assert.deepEqual(second.adapter.resumeAttempts, []);
  await second.service.dispose();
});

test("SIMULATED: a local record missing under an unaligned profile is reported as unknown, not as the provider's answer", async () => {
  const { workspace, second } = await restartInto('continuity-unaligned');
  second.adapter.resumeBehaviour = 'unaligned';
  const session = await second.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(session.continuity.kind, 'resume-refused');
  assert.equal(session.continuity.resumeFailure?.kind, 'unknown');
  assert.equal(session.continuity.resumeFailure?.providerCode, 'local_record_missing_unaligned');
  assert.equal(second.adapter.startSessionCalls, 0);
  assert.match(session.continuity.statement, /^DSpatch tried to resume dsp-session-fake and the resume was refused: /);
  assert.match(
    session.continuity.statement,
    /The provider was not asked, and the adapter's local check looked in a different profile than the one the provider process uses, so finding no record there says nothing about whether the provider still has the session\./,
  );
  assert.doesNotMatch(session.continuity.statement, /provider answered/);
  assert.deepEqual(session.continuity.choices, RETRY_AND_NEW);
  // The context statement for a Cursor-recorded session says the SDK got the model
  // name (true of `Agent.resume`); a file recorded as Claude gets the Claude wording.
  assert.match(session.context.statement, /gave the provider's SDK/);
  await second.service.dispose();

  // The same refusal over a session recorded as Claude: the adapter's lookup passes the
  // UUID and the folder only, so the statement must not claim a model name was sent.
  const claude = await restartIntoRewritten('continuity-unaligned-claude', (raw) => {
    raw.session.provider = 'claude';
  });
  claude.second.adapter.resumeBehaviour = 'unaligned';
  // The Claude wording is chosen from the adapter that was called, not the file alone.
  claude.second.adapter.id = 'claude-agent-sdk';
  const claudeSession = await claude.second.service.startChatSession({ kind: 'folder', path: claude.workspace });
  assert.equal(claudeSession.continuity.resumeFailure?.kind, 'unknown');
  assert.match(claudeSession.context.statement, /received no model name/);
  assert.match(claudeSession.context.statement, /started no provider process and ran no model turn/);
  assert.doesNotMatch(claudeSession.context.statement, /gave the provider's SDK/);
  await claude.second.service.dispose();
});

test('SIMULATED: a file recorded as Claude with Cursor chosen opens with no session and both named choices; Resume with Claude resumes it (DSP-136 Q-A)', async () => {
  // Until DSP-117 this case resumed the Claude-recorded session through Cursor's
  // `Agent.resume`; DSP-117 let the recorded provider override the panel's choice.
  // DSP-136 (Q-A): neither - the person chooses, and nothing is built until then.
  const { workspace, second } = await restartIntoRewritten('continuity-claude-file-cursor-adapter', (raw) => {
    raw.session.provider = 'claude';
  });
  second.adapter.resumeBehaviour = 'ok';
  const session = await second.service.startChatSession({ kind: 'folder', path: workspace, provider: 'cursor' });
  assert.equal(session.provider, 'cursor');
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.deepEqual(session.continuity.choices, ['new-session', 'resume-recorded']);
  assert.equal(session.continuity.recordedProvider, 'claude');
  assert.equal(session.adapter, null);
  assert.deepEqual(second.adapter.resumeAttempts, [], 'nothing was asked');
  assert.deepEqual(second.adapter.sent, []);
  assert.match(session.continuity.statement, /it is a Claude session, and Cursor is the chosen agent/);
  assert.match(session.continuity.statement, /No agent was built/);

  // Resume with Claude: the recorded provider, explicitly.
  const resumed = await second.service.startChatSession({ kind: 'retry-resume' });
  assert.equal(resumed.provider, 'claude');
  assert.equal(resumed.continuity.providerSessionOpen, true);
  assert.deepEqual(second.adapter.resumeAttempts, ['dsp-session-fake']);
  assert.deepEqual(second.adapter.sent, []);
  await second.service.dispose();
});

test('SIMULATED: what the model was told is kept with the turn that carried it', async () => {
  // A restart a week later has to be able to answer the same question, so the
  // recap is saved on the message rather than held only in the live session.
  const workspace = makeDir('continuity-saved');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('continuity-saved');

  const first = serviceOver('continuity-saved-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('the first question');
  first.adapter.emit({ type: 'assistant.message', text: 'the first answer' });
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.dispose();

  const second = serviceOver('continuity-saved-2', workspace, store);
  await second.service.resumeConversation(session.conversationId);
  second.adapter.resumeBehaviour = 'not-found';
  const refused = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(refused.continuity.kind, 'resume-refused');
  // The recap exists only once the user chooses a new provider session.
  const reopened = await second.service.startChatSession({ kind: 'new-provider-session' });
  assert.notEqual(reopened.continuity.contextToResend, null);
  await second.service.sendPrompt('the second question');
  second.adapter.emit({ type: 'run.finished', status: 'finished' });
  await second.service.dispose();

  const saved = store.read(session.conversationId).conversation;
  const messages = saved?.messages ?? [];
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.resentContext, null, 'the first turn had nothing to resend');
  assert.equal(messages[1]?.resentContext, reopened.continuity.contextToResend);
});

test('SIMULATED: an adapter that cannot resume at all says that, not that it failed', async () => {
  const { workspace, second } = await restartInto('continuity-no-capability');
  // An adapter without the capability. The distinction matters: "this build cannot
  // resume" and "the provider does not have your session" are different facts and
  // only one of them is about the user's session.
  delete (second.adapter as { resume?: unknown }).resume;

  const session = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  // Treated like a refusal (DSP-121): no automatic new session, the choice is the user's.
  assert.equal(session.continuity.kind, 'resume-unavailable');
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.deepEqual(second.adapter.resumeAttempts, [], 'nothing was asked of the provider');
  assert.equal(second.adapter.startSessionCalls, 0);
  assert.equal(session.continuity.resumeFailure?.kind, 'error');
  assert.match(String(session.continuity.resumeError), /cannot resume a session/);
  assert.match(session.continuity.statement, /This build cannot resume a session on the .* adapter\. The provider was not asked\./);
  assert.match(session.continuity.statement, /Trying again in this build gives the same answer\./);
  // No call was made at all here, so "nothing was sent" is the true statement.
  assert.match(session.context.statement, /has sent the agent nothing/);
  assert.match(session.context.statement, /The provider was not asked\./);
  // Unsupported: a retry in this build gives the same answer, so it is not offered.
  assert.ok(!session.continuity.choices.includes('try-again'));
  assert.deepEqual(session.continuity.choices, NEW_ONLY);
  assert.doesNotMatch(session.continuity.statement, /You can try again/);
  assert.equal(session.continuity.contextToResend, null);
  await assert.rejects(
    () => second.service.sendPrompt('carry on'),
    /No provider session is open for this conversation: this build cannot resume a session.*\. Start a new provider session to continue\.$/,
  );
  await second.service.dispose();
});

test("SIMULATED: Claude's authentication_refused does not offer Try again: it is DSpatch's own rule, and a retry gives the same answer (DSP-117)", async () => {
  const { workspace, second } = await restartIntoRewritten('continuity-auth-refused', (raw) => {
    raw.session.provider = 'claude';
  });
  second.adapter.resumeBehaviour = 'auth-refused';
  const session = await second.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.equal(session.continuity.resumeFailure?.providerCode, 'authentication_refused');
  // Start new session stays Claude; switching to Cursor is its own, explicit choice.
  assert.deepEqual(session.continuity.choices, ['new-session', 'switch-to-cursor']);
  assert.equal(session.provider, 'claude');
  assert.match(session.continuity.statement, /switch this conversation to Cursor/);
  assert.doesNotMatch(session.continuity.statement, /You can try again/);
  assert.deepEqual(second.adapter.sent, []);
  await second.service.dispose();
});

test('SIMULATED: a config_mismatch refusal does not offer Try again, because the same inputs give the same answer', async () => {
  const { workspace, conversationId, second } = await restartInto('continuity-config-mismatch');
  second.adapter.resumeBehaviour = 'config-mismatch';
  const before = second.store.read(conversationId).conversation?.session ?? null;
  const session = await second.service.startChatSession({ kind: 'folder', path: workspace });
  assert.equal(session.continuity.kind, 'resume-refused');
  assert.equal(session.continuity.providerSessionOpen, false);
  assert.equal(session.continuity.resumeFailure?.kind, 'error');
  assert.equal(session.continuity.resumeFailure?.providerCode, 'config_mismatch');
  assert.ok(!session.continuity.choices.includes('try-again'));
  assert.deepEqual(session.continuity.choices, NEW_ONLY);
  assert.match(session.continuity.statement, /Trying again with the same inputs gives the same answer\./);
  assert.match(session.continuity.statement, /You can start a new provider session/);
  assert.doesNotMatch(session.continuity.statement, /You can try again/);
  assert.equal(second.adapter.startSessionCalls, 0);
  assert.deepEqual(second.adapter.sent, []);
  assert.deepEqual(second.store.read(conversationId).conversation?.session, before);
  await assert.rejects(
    () => second.service.sendPrompt('carry on'),
    /No provider session is open for this conversation: resuming dsp-session-fake was refused \(.*\)\. Start a new provider session to continue\.$/,
  );
  // `retry-resume` is still accepted - DSP-117 needs it - it is only not offered.
  const again = await second.service.startChatSession({ kind: 'retry-resume' });
  assert.equal(again.continuity.resumeFailure?.providerCode, 'config_mismatch');
  assert.deepEqual(again.continuity.choices, NEW_ONLY);
  await second.service.dispose();
});

test('SIMULATED: a session holding an inherited run is escaped by a new provider session', async () => {
  // The whole of report 008's defect 1, end to end: restart into a conversation,
  // resume the provider session, and have the provider refuse every message
  // because that session still holds a run from before the restart. Re-opening the
  // project would resume the same session and be refused again, so the way out has
  // to be a session that is genuinely new — and it must carry the conversation.
  const { workspace, second } = await restartInto('continuity-holds-a-run');
  second.adapter.resumeBehaviour = 'ok';
  const resumed = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(resumed.continuity.kind, 'provider-session-resumed');

  second.adapter.sendBehaviour = 'reject-provider-active-run';
  await assert.rejects(
    () => second.service.sendPrompt('carry on'),
    /Continue in a new provider session instead/,
  );
  const resumeAttemptsBefore = second.adapter.resumeAttempts.length;

  // The way out. No path is named: it is the project already open.
  second.adapter.sendBehaviour = 'ok';
  const fresh = await second.service.startChatSession({ kind: 'new-provider-session' });

  assert.equal(fresh.workspacePath, resumed.workspacePath);
  assert.equal(fresh.conversationId, resumed.conversationId, 'the same conversation');
  assert.equal(fresh.continuity.kind, 'new-provider-session');
  assert.equal(
    second.adapter.resumeAttempts.length,
    resumeAttemptsBefore,
    'no resume was attempted, because resuming is what lands in the stuck session',
  );
  // Not a failure dressed up as one: nothing was refused here.
  assert.equal(fresh.continuity.resumeError, null);
  assert.match(fresh.continuity.statement, /because you asked for one/);
  assert.match(fresh.continuity.statement, /left alone rather than joined or repeated/);

  const recap = String(fresh.continuity.contextToResend);
  assert.match(recap, /what does this project do/);
  assert.match(recap, /you asked for a new provider session/);

  const sentBefore = second.adapter.sent.length;
  await second.service.sendPrompt('carry on');
  const sent = String(second.adapter.sent[sentBefore]);
  assert.equal(sent.includes(recap), true, 'the exact text shown is the text sent');
  assert.equal(sent.endsWith('carry on'), true);

  // The recap is owed once, not attached to every later message (DSP-4; review 004 S1).
  second.adapter.emit({ type: 'run.finished', status: 'finished' });
  await second.service.sendPrompt('and again');
  assert.equal(second.adapter.sent[sentBefore + 1], 'and again');
  await second.service.dispose();
});

test('SIMULATED: a new provider session cannot be asked for when nothing is open', async () => {
  // The control for the branch above: with no session open there is nothing to
  // continue, and the request must be refused rather than opening something.
  const workspace = makeDir('no-session-fresh');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const { service, adapter } = serviceOver(
    'no-session-fresh',
    workspace,
    storeFor('no-session-fresh'),
  );
  await assert.rejects(
    () => service.startChatSession({ kind: 'new-provider-session' }),
    /No project is open/,
  );
  assert.deepEqual(adapter.sent, []);
  await service.dispose();
});

test('SIMULATED: a first conversation claims no continuity it does not have', async () => {
  // The control. Without it, a window that always said "this is a new session and
  // here is your recap" would pass every test above and be wrong every first time.
  const { service, adapter } = await openFakeSession('continuity-first');
  assert.equal(service.sessionContinuity().kind, 'first-session');
  assert.equal(service.sessionContinuity().contextToResend, null);
  assert.equal(service.sessionContinuity().savedMessageCount, 0);
  await service.sendPrompt('hello');
  assert.deepEqual(adapter.sent, ['hello']);
  await service.dispose();
});

test('SIMULATED: a saved pass does not verify code that has changed since', async () => {
  // DSP-2's freshness rule has to survive the restart, because a restart is the
  // easiest way for an old green tick to end up beside new code.
  const workspace = makeDir('persist-freshness');
  const file = path.join(workspace, 'readme.txt');
  fs.writeFileSync(file, 'as tested\n', 'utf8');
  const store = storeFor('persist-freshness');

  const first = serviceOver('persist-freshness-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  const outcome = await first.service.runWorkspaceTest({
    command: `"${process.execPath}" -e "process.exit(0)"`,
    cwd: '',
  });
  assert.equal(outcome.verdict, 'passed');
  assert.equal(first.service.getTestFreshness().presentedStatus, 'passed');
  await first.service.dispose();

  // Restored with the code unchanged: still a pass, and still bound to the snapshot.
  const second = serviceOver('persist-freshness-2', workspace, store);
  const current = await second.service.resumeConversation(session.conversationId);
  assert.equal(current.testResult?.outcome.exitCode, 0);
  assert.equal(current.testResult?.freshness.presentedStatus, 'passed');
  assert.equal(current.testResult?.freshness.kind, 'current');
  assert.equal(
    current.testResult?.freshness.currentSnapshotId,
    current.testResult?.outcome.snapshotId,
  );
  await second.service.dispose();

  // Now the code moves on, as it does between sessions.
  fs.writeFileSync(file, 'edited after the test ran\n', 'utf8');
  const third = serviceOver('persist-freshness-3', workspace, store);
  const stale = await third.service.resumeConversation(session.conversationId);
  assert.equal(stale.testResult?.outcome.verdict, 'passed', 'the run itself is unchanged');
  assert.equal(
    stale.testResult?.freshness.presentedStatus,
    'passed-for-older-code',
    'and it is not presented as a pass',
  );
  assert.notEqual(stale.testResult?.freshness.presentedStatus, 'passed');
  assert.equal(stale.testResult?.freshness.kind, 'stale');
  assert.notEqual(
    stale.testResult?.freshness.currentSnapshotId,
    stale.testResult?.outcome.snapshotId,
  );
  assert.match(String(stale.testResult?.note), /has not been run again/);
  await third.service.dispose();
});

test('SIMULATED: the diff that was reviewed comes back verbatim and is never applied', async () => {
  const workspace = makeDir('persist-diff');
  const file = path.join(workspace, 'code.txt');
  fs.writeFileSync(file, 'before\n', 'utf8');
  const store = storeFor('persist-diff');

  const first = serviceOver('persist-diff-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  // The agent's change, in the only way that counts: bytes on disk.
  fs.writeFileSync(file, 'after\n', 'utf8');
  const report = first.service.getWorkspaceChanges();
  assert.equal(report.changed.length, 1);
  assert.match(String(report.changed[0]?.unifiedDiff), /-before/);
  assert.match(String(report.changed[0]?.unifiedDiff), /\+after/);
  await first.service.dispose();

  const second = serviceOver('persist-diff-2', workspace, store);
  const restored = await second.service.resumeConversation(session.conversationId);
  const saved = restored.reviewedDiff;
  assert.ok(saved !== null);
  // Verbatim: the same text, between the same two snapshot identities.
  assert.equal(saved.report.baselineSnapshotId, report.baselineSnapshotId);
  assert.equal(saved.report.observedSnapshotId, report.observedSnapshotId);
  assert.equal(saved.report.changed[0]?.unifiedDiff, report.changed[0]?.unifiedDiff);
  assert.equal(saved.stillDescribesDisk, true);
  // And the file is exactly as the user left it: a saved diff is evidence, not a
  // patch, so restoring cannot have rewritten anything.
  assert.equal(fs.readFileSync(file, 'utf8'), 'after\n');

  await second.service.dispose();

  // The working copy moves on. The saved diff is then labelled a record rather than
  // being adjusted to fit code it was not taken from.
  fs.writeFileSync(file, 'after, and then some\n', 'utf8');
  const third = serviceOver('persist-diff-3', workspace, store);
  const later = await third.service.resumeConversation(session.conversationId);
  assert.equal(later.reviewedDiff?.stillDescribesDisk, false);
  assert.equal(
    later.reviewedDiff?.report.changed[0]?.unifiedDiff,
    report.changed[0]?.unifiedDiff,
    'the diff text is unchanged, not recomputed',
  );
  assert.match(String(later.reviewedDiff?.note), /record of what was reviewed/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'after, and then some\n');
  await third.service.dispose();
});

test('SIMULATED: opening a project again continues its conversation rather than starting a new one', async () => {
  const workspace = makeDir('persist-continue');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('persist-continue');
  // The pointer the project store keeps, in the same direction main.ts wires it.
  let pointer: string | null = null;

  const first = serviceOver('persist-continue-1', workspace, store, () => pointer);
  const opened = await first.service.startChatSession({ kind: 'folder', path: workspace });
  pointer = opened.conversationId;
  await first.service.sendPrompt('the first message');
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.dispose();

  const second = serviceOver('persist-continue-2', workspace, store, () => pointer);
  // The provider still holds the session; this test is about the conversation file.
  second.adapter.resumeBehaviour = 'ok';
  const reopened = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(reopened.conversationId, opened.conversationId, 'the same conversation');
  await second.service.sendPrompt('the second message');
  second.adapter.emit({ type: 'run.finished', status: 'finished' });
  await second.service.dispose();

  // One file, both messages, in order — and the earlier message was not lost by the
  // second session saving over it.
  const listing = store.list();
  assert.equal(listing.entries.length, 1);
  const saved = store.read(opened.conversationId).conversation;
  assert.deepEqual(
    saved?.messages.map((message) => message.prompt),
    ['the first message', 'the second message'],
  );
  assert.deepEqual(
    saved?.messages.map((message) => message.ordinal),
    [0, 1],
  );
});

/**
 * The whole of Niclas's complaint, end to end and without a provider call.
 *
 * He reopened the same project folder and got an old loop run with an old mandate
 * while his recent messages were missing. Nothing was lost: opening a project has
 * continued the same conversation since DSP-4 and the main process read the file, but
 * the messages were never handed to the window, so the thread was drawn empty over a
 * conversation that was intact on disk — while the loop half of the column restored
 * itself from the run records, which is the "old run and nothing of mine" he saw.
 *
 * So this asserts the part that was missing: what a reopened session tells the window
 * about the history it adopted. Ordering and completeness are asserted over the whole
 * thing, because "in order, with no gaps and no duplicates" is the requirement.
 */
test('SIMULATED: reopening a project hands the window the conversation so far', async () => {
  const workspace = makeDir('persist-history');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('persist-history');
  let pointer: string | null = null;

  const first = serviceOver('persist-history-1', workspace, store, () => pointer);
  const opened = await first.service.startChatSession({ kind: 'folder', path: workspace });
  pointer = opened.conversationId;
  // A new conversation has no history, and says so as an empty list rather than as an
  // error: nothing went wrong, there is simply nothing yet.
  assert.deepEqual(opened.restoredHistory.messages, []);
  assert.equal(opened.restoredHistory.error, null);
  assert.equal(opened.restoredHistory.conversationId, opened.conversationId);

  await first.service.sendPrompt('what is this project');
  first.adapter.emit({ type: 'assistant.message', text: 'a spike' });
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.sendPrompt('and what builds it');
  first.adapter.emit({ type: 'assistant.message', text: 'cmake' });
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.dispose();

  // The window is closed and a new one opens the same folder, which is the case that
  // used to show nothing.
  const second = serviceOver('persist-history-2', workspace, store, () => pointer);
  // The provider still holds the session; this test is about the history handed over.
  second.adapter.resumeBehaviour = 'ok';
  const reopened = await second.service.startChatSession({
    kind: 'folder',
    path: workspace,
  });
  assert.equal(reopened.conversationId, opened.conversationId);
  assert.deepEqual(
    reopened.restoredHistory.messages.map((message) => message.prompt),
    ['what is this project', 'and what builds it'],
    'both messages come back, in the order they were sent',
  );
  assert.deepEqual(
    reopened.restoredHistory.messages.map((message) => message.ordinal),
    [0, 1],
    'no gap in the field the reader sorts by',
  );
  assert.deepEqual(
    reopened.restoredHistory.messages.map((message) => message.answer),
    ['a spike', 'cmake'],
    'the replies come back with them, not just the prompts',
  );
  assert.equal(reopened.restoredHistory.savedAtUtc !== null, true);

  // And a third message in the reopened session neither loses the two nor repeats them.
  await second.service.sendPrompt('a third message');
  second.adapter.emit({ type: 'run.finished', status: 'finished' });
  await second.service.dispose();
  const saved = store.read(opened.conversationId).conversation;
  assert.deepEqual(
    saved?.messages.map((message) => message.prompt),
    ['what is this project', 'and what builds it', 'a third message'],
  );
});

/**
 * Reading a conversation back and then working in it used to write its turns twice.
 *
 * Not hypothetical: Niclas's MiniDAWLab conversation holds 23 messages for 22 turns,
 * with *Hej* of 17 September 2026 recorded twice under one run id. Reading it back puts
 * this window's already-saved turns into the carried list while `turns` still holds
 * them, and the next save appended both copies.
 */
test('SIMULATED: resuming a conversation this window worked in does not duplicate its turns', async () => {
  const workspace = makeDir('persist-resume-dup');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('persist-resume-dup');
  const harness = serviceOver('persist-resume-dup-1', workspace, store);

  const opened = await harness.service.startChatSession({ kind: 'folder', path: workspace });
  await harness.service.sendPrompt('Hej');
  harness.adapter.emit({ type: 'assistant.message', text: 'Hej!' });
  harness.adapter.emit({ type: 'run.finished', status: 'finished' });

  // The same conversation, read back from its own file, as choosing it in the list does.
  await harness.service.resumeConversation(opened.conversationId);
  // A save is what made the duplicate permanent, so close and read the file.
  await harness.service.dispose();

  const saved = store.read(opened.conversationId).conversation;
  assert.deepEqual(
    saved?.messages.map((message) => message.prompt),
    ['Hej'],
    'one message for one turn, after the conversation was read back into itself',
  );
});

test('SIMULATED: two projects keep two conversations, and neither takes the other work', async () => {
  const store = storeFor('persist-two');
  const one = makeDir('persist-two-a');
  const two = makeDir('persist-two-b');
  fs.writeFileSync(path.join(one, 'a.txt'), 'a\n', 'utf8');
  fs.writeFileSync(path.join(two, 'b.txt'), 'b\n', 'utf8');

  const harness = serviceOver('persist-two-1', one, store);
  const firstSession = await harness.service.startChatSession({ kind: 'folder', path: one });
  await harness.service.sendPrompt('about project a');
  harness.adapter.emit({ type: 'run.finished', status: 'finished' });

  const secondSession = await harness.service.startChatSession({
    kind: 'folder',
    path: two,
  });
  await harness.service.sendPrompt('about project b');
  harness.adapter.emit({ type: 'run.finished', status: 'finished' });
  await harness.service.dispose();

  assert.notEqual(firstSession.conversationId, secondSession.conversationId);
  const a = store.read(firstSession.conversationId).conversation;
  const b = store.read(secondSession.conversationId).conversation;
  assert.deepEqual(
    a?.messages.map((message) => message.prompt),
    ['about project a'],
  );
  assert.deepEqual(
    b?.messages.map((message) => message.prompt),
    ['about project b'],
  );
  assert.equal(a?.project.path, one);
  assert.equal(b?.project.path, two);
});

test('SIMULATED: a conversation whose project has been deleted still reads', async () => {
  const workspace = makeDir('persist-gone');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('persist-gone');

  const first = serviceOver('persist-gone-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('a message about a folder that will not exist');
  first.adapter.emit({ type: 'run.finished', status: 'finished' });
  await first.service.dispose();
  fs.rmSync(workspace, { recursive: true, force: true });

  const second = serviceOver('persist-gone-2', workspace, store);
  const restored = await second.service.resumeConversation(session.conversationId);
  assert.equal(restored.project.exists, false);
  assert.equal(restored.messages.length, 1);
  assert.match(restored.statement, /no longer at/);
  await second.service.dispose();
});

test('SIMULATED: a conversation that is not there is refused without changing anything', async () => {
  const store = storeFor('persist-absent');
  const workspace = makeDir('persist-absent-project');
  const harness = serviceOver('persist-absent-1', workspace, store);
  await assert.rejects(
    () => harness.service.resumeConversation('dsp-conv-does-not-exist'),
    /There is no saved conversation called/,
  );
  assert.deepEqual(store.list().entries, []);
  await harness.service.dispose();
});

test('a run.finished crosses the bridge with the end its adapter reported, and without one when none was (DSP-117)', () => {
  const base = { dspatchSessionId: 'dsp-session-1', dspatchRunId: 'dsp-run-1', at: '2026-10-26T00:00:00.000Z' };
  for (const end of ['stopped', 'forced', 'unconfirmed'] as const) {
    assert.equal(toUiEvent({ ...base, type: 'run.finished', status: 'cancelled', end }).end, end);
  }
  const cursor = toUiEvent({ ...base, type: 'run.finished', status: 'cancelled' });
  assert.ok(!('end' in cursor));
});

test('SIMULATED: a stopped turn is saved with how it ended, and reads as it did live (DSP-165)', async () => {
  const workspace = makeDir('stopped-saved');
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor('stopped-saved');
  const first = serviceOver('stopped-saved-1', workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  await first.service.sendPrompt('a long job');
  first.adapter.emit({ type: 'run.finished', status: 'cancelled', end: 'stopped' });
  await first.service.dispose();
  const message = store.read(session.conversationId).conversation?.messages[0];
  assert.ok(message !== undefined);
  assert.equal(message.terminalEnd, 'stopped');
  assert.equal(savedTurnStatusLabel(message), turnStatusLabel({ status: 'cancelled', end: 'stopped' }));
});

/**
 * DSP-209 S6: after a loop run was handed over, DSpatch sends one turn into the chat, so the
 * agent continues the task without the person typing it again. Through the ordinary send path,
 * at most once per run id, and saved as DSpatch's handover rather than as the person's words.
 */
test('SIMULATED: a handover is sent once, saved apart from the person, and never sent again', async () => {
  const name = 'handover-once';
  const workspace = makeDir(name);
  fs.writeFileSync(path.join(workspace, 'readme.txt'), 'x\n', 'utf8');
  const store = storeFor(name);
  const first = serviceOver(`${name}-1`, workspace, store);
  const session = await first.service.startChatSession({ kind: 'folder', path: workspace });
  const handover = {
    runId: 'chat-loop-7',
    fromStep: 'Do what was asked',
    text: '=== DSpatch: handover from loop run chat-loop-7 ===\n| implement that',
  };
  assert.deepEqual(await first.service.sendHandover(handover), { sent: true, reason: null });
  assert.deepEqual(first.adapter.sent, [handover.text], 'the provider is sent exactly the handover text');
  first.adapter.emit({ type: 'assistant.message', text: 'Continuing: here is the plan.' });
  first.adapter.emit({ type: 'run.finished', status: 'finished' });

  const again = await first.service.sendHandover(handover);
  assert.equal(again.sent, false);
  assert.match(again.reason ?? '', /already handed over/);
  assert.equal(first.adapter.sent.length, 1, 'a second ending signal sends nothing');

  const saved = store.read(session.conversationId).conversation?.messages ?? [];
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.prompt, '', 'the person typed nothing');
  assert.deepEqual(saved[0]?.handover, handover);
  await first.service.dispose();

  // A restart reads the saved handover and sends nothing.
  const second = serviceOver(`${name}-2`, workspace, store);
  await second.service.resumeConversation(session.conversationId);
  assert.match(second.service.handoverRefusal('chat-loop-7') ?? '', /already handed over/);
  assert.equal((await second.service.sendHandover(handover)).sent, false);
  assert.deepEqual(second.adapter.sent, []);
  await second.service.dispose();
});

test('SIMULATED: a handover does not interrupt a chat turn that is still running', async () => {
  const { service, adapter, logs } = await openFakeSession('handover-busy');
  await service.sendPrompt('a turn that is still going');
  const refused = await service.sendHandover({ runId: 'chat-loop-8', fromStep: 'Work', text: 'handover' });
  assert.equal(refused.sent, false);
  assert.match(refused.reason ?? '', /still running/);
  assert.deepEqual(adapter.sent, ['a turn that is still going']);
  void logs;
  await service.dispose();
});

test('SIMULATED: the recap labels a handover as DSpatch\'s, and reads every other message as before', async () => {
  const { buildResendContext } = await import('../src/main/chat-service.ts');
  const base = {
    ordinal: 0,
    dspatchRunId: 'r0',
    prompt: 'what does this do',
    answer: 'It dispatches.',
    deltaCount: 1,
    toolEvents: 0,
    terminalStatus: 'finished',
    errorMessage: null,
    totalTokens: null,
    startedAtUtc: '2026-11-14T03:00:00.000Z',
    finishedAtUtc: '2026-11-14T03:00:01.000Z',
    resentContext: null,
  };
  const input = { workspacePath: 'C:/p', reviewedDiff: null, test: null, reason: 'a test' };
  const plain = buildResendContext({ ...input, messages: [base] }) ?? '';
  assert.match(plain, /The person asked:\nwhat does this do/);
  const withHandover =
    buildResendContext({
      ...input,
      messages: [
        base,
        { ...base, ordinal: 1, dspatchRunId: 'r1', prompt: '', handover: { runId: 'chat-loop-9', fromStep: 'Work', text: 'DSPATCH-HANDOVER-TEXT' } },
      ],
    }) ?? '';
  assert.match(withHandover, /DSpatch sent this, not the person: a handover from loop run chat-loop-9/);
  assert.match(withHandover, /DSPATCH-HANDOVER-TEXT/);
  assert.equal(withHandover.split('The person asked:').length - 1, 1, 'only the person\'s own message is labelled theirs');
});
