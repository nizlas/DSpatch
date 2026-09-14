import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Cursor } from '@cursor/sdk';

import { CursorSdkAdapter } from '../adapter/cursor-sdk-adapter';
import type { AgentEvent, CapabilityReport, UsageReading } from '../adapter/types';
import type {
  CancelObservations,
  CancelOutcome,
  ChatSessionInfo,
  ConnectionStatus,
  TestOutcome,
  TurnUsage,
  UiAgentEvent,
  WorkspaceChange,
  WorkspaceReport,
} from '../shared/bridge';
import {
  diffSnapshots,
  generateExperimentRepo,
  snapshotTree,
  type TreeSnapshot,
} from './experiment-repo';

/**
 * Everything the chat window can do, on the main-process side of the bridge.
 *
 * **The adapter lives here and only here.** The renderer never imports it; it
 * calls the methods below over IPC. That is not a style preference: the SDK
 * needs Node built-ins and a native platform package, the window runs sandboxed
 * with no Node access at all, and `tsconfig.renderer.json` excludes the adapter
 * so a renderer-side import fails the typecheck instead of the packaged build.
 *
 * The service also keeps the evidence the UI displays: content hashes of the
 * working copy, the exit code of a test DSpatch itself started, and what was
 * observed after a cancellation. An agent's account of what it did is never used
 * as the source of any of it.
 */

const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * How long DSpatch keeps looking for provider work after a cancellation.
 *
 * 90 s, not 20 s, because of the one measurement we have of how long remote work
 * can outlive the client's view of it: substep 6's sever scenario saw a turn keep
 * producing tool calls for **69.5 s** after its TLS sockets were destroyed, with
 * no error reaching the adapter. A watch shorter than the known counter-example
 * cannot make "no continued work observed" mean anything.
 */
const CANCEL_WATCH_MS = 90_000;

function nowIso(): string {
  return new Date().toISOString();
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * A real Node executable for running the working copy's test.
 *
 * Electron's own `process.execPath` is `DSpatch.exe`; running it as a Node CLI
 * needs `ELECTRON_RUN_AS_NODE`, and its bundled Node is older than the one on
 * PATH. The test repository relies on Node's native type stripping, so the
 * version matters. Prefer the interpreter the developer actually has, record
 * which one was chosen, and return `null` rather than guessing — the UI then
 * says the runner is missing instead of showing a test result that never ran.
 */
export interface NodeRunner {
  readonly path: string;
  readonly source: string;
}

export function resolveNodeRunner(): NodeRunner | null {
  const explicit = process.env['DSPATCH_NODE_PATH'];
  if (explicit !== undefined && explicit.trim() !== '') {
    const resolved = path.resolve(explicit.trim());
    if (fs.existsSync(resolved)) {
      return { path: resolved, source: 'DSPATCH_NODE_PATH' };
    }
  }
  const pathValue = process.env['PATH'] ?? process.env['Path'] ?? '';
  const names = process.platform === 'win32' ? ['node.exe'] : ['node'];
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir.trim() === '') {
      continue;
    }
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { path: candidate, source: 'PATH' };
        }
      } catch {
        // An unreadable PATH entry is not an error worth surfacing.
      }
    }
  }
  return null;
}

const TEST_ARGS = ['--test', 'test/duration.test.ts'] as const;

interface TurnRecord {
  readonly dspatchRunId: string;
  prompt: string;
  readonly startedAtUtc: string;
  deltaCount: number;
  deltaText: string;
  finalMessage: string | null;
  toolEvents: number;
  terminalStatus: string | null;
  errorMessage: string | null;
  finishedAtUtc: string | null;
  readonly usageEvents: Array<{ atUtc: string; readings: readonly UsageReading[] }>;
  /** Kept verbatim in the main process; never sent to the renderer. */
  readonly rawEventTypes: Record<string, number>;
}

interface CancelState {
  attempted: boolean;
  watching: boolean;
  cancelledAtUtc: string | null;
  requestedAtPerf: number;
  toolEventsBeforeCancel: number;
  toolEventsAfterCancel: number;
  eventsAfterTerminalEvent: number;
  usageEventsAfterCancel: number;
  workspaceFileCountAtCancel: number | null;
  workspaceFileCountAfterWatch: number | null;
  watchedSeconds: number;
}

function emptyCancelState(): CancelState {
  return {
    attempted: false,
    watching: false,
    cancelledAtUtc: null,
    requestedAtPerf: 0,
    toolEventsBeforeCancel: 0,
    toolEventsAfterCancel: 0,
    eventsAfterTerminalEvent: 0,
    usageEventsAfterCancel: 0,
    workspaceFileCountAtCancel: null,
    workspaceFileCountAfterWatch: null,
    watchedSeconds: 0,
  };
}

export interface ChatServiceOptions {
  /** The DSpatch repository. The working copy must never be inside it. */
  readonly repoRoot: string;
  /** Sends one event to the live renderer. */
  readonly send: (event: UiAgentEvent) => void;
  readonly log: (message: string) => void;
}

export class ChatService {
  private readonly options: ChatServiceOptions;

  private adapter: CursorSdkAdapter | null = null;

  private session: ChatSessionInfo | null = null;

  private baseline: TreeSnapshot | null = null;

  private unsubscribe: (() => void) | null = null;

  private currentTurn: TurnRecord | null = null;

  private readonly turns: TurnRecord[] = [];

  private cancelState: CancelState = emptyCancelState();

  private readonly testRuns: TestOutcome[] = [];

  /**
   * The test runner, while one is going.
   *
   * Tracked rather than fired and forgotten because its working directory is the
   * working copy. Windows refuses to delete a directory a live process sits in,
   * so an orphan here does not merely waste cycles: it blocks the next session
   * from starting at all.
   */
  private activeTest: ChildProcess | null = null;

  private terminalSeenForTurn = false;

  private pendingPrompt = '';

  private runner: NodeRunner | null;

  constructor(options: ChatServiceOptions) {
    this.options = options;
    this.runner = resolveNodeRunner();
  }

  /** The working copy the agent is pointed at. Outside the DSpatch repository. */
  workspacePath(): string {
    const explicit = process.env['DSPATCH_CHAT_WORKSPACE'];
    if (explicit !== undefined && explicit.trim() !== '') {
      return path.resolve(explicit.trim());
    }
    return path.join(os.tmpdir(), 'dspatch-chat', 'duration-repo');
  }

  modelRequested(): string {
    return process.env['DSPATCH_CHAT_MODEL'] ?? DEFAULT_MODEL;
  }

  /** The adapter identity the window displays: provider plus transport. */
  adapterId(): string {
    return this.ensureAdapter().id;
  }

  capabilities(): CapabilityReport {
    return this.ensureAdapter().capabilities();
  }

  /**
   * Connection status.
   *
   * `Cursor.auth.status()` is documented never to return the key, and this reads
   * nothing else: the credential store is never opened, hashed or copied, and no
   * `apiKey` is passed anywhere. The model list is read as well, because a stored
   * login that the backend rejects is not a connection.
   */
  async getConnection(): Promise<ConnectionStatus> {
    const checkedAtUtc = nowIso();
    const credentialStorePath = path.join(
      os.homedir(),
      '.cursor',
      'sdk',
      'auth.json',
    );
    try {
      const status = await Cursor.auth.status();
      if (status.status !== 'logged-in') {
        return {
          kind: 'not-connected',
          reason:
            `Cursor reports "${status.status}". DSpatch does not log in for you: ` +
            'run `cursor-agent login` (or Cursor\'s own sign-in) once, and the SDK ' +
            'stores the credential outside this repository.',
          credentialStorePath,
          checkedAtUtc,
        };
      }
      let modelsAvailable: number | null = null;
      try {
        const adapter = this.ensureAdapter();
        modelsAvailable = (await adapter.listModels()).length;
      } catch (error) {
        this.options.log(`model list unavailable: ${describeError(error)}`);
      }
      return {
        kind: 'connected',
        provider: 'cursor',
        account: status.email ?? null,
        backendUrl: status.backendUrl,
        credentialSource:
          "the SDK's own credential store; DSpatch passes no apiKey and sets no " +
          'environment variable',
        credentialStorePath,
        credentialExpiresAtUtc:
          status.apiKeyExpiresAtMs === undefined
            ? null
            : new Date(status.apiKeyExpiresAtMs).toISOString(),
        modelsAvailable,
        modelRequested: this.modelRequested(),
        checkedAtUtc,
      };
    } catch (error) {
      return { kind: 'error', message: describeError(error), checkedAtUtc };
    }
  }

  /**
   * Open a session over a freshly generated working copy.
   *
   * The working copy is generated rather than assumed, so the window's workflow
   * is repeatable and the "before" state is known by content. The generator
   * refuses to write inside the DSpatch repository and refuses to wipe a
   * directory that is not its own.
   */
  async startChatSession(): Promise<ChatSessionInfo> {
    await this.closeSession();
    const workspacePath = this.workspacePath();
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
    const generated = generateExperimentRepo(workspacePath, this.options.repoRoot);
    this.baseline = snapshotTree(workspacePath);
    this.runner = resolveNodeRunner();

    const adapter = this.ensureAdapter();
    const handle = await adapter.startSession({
      provider: 'cursor',
      modelRequested: this.modelRequested(),
      workspacePath,
    });

    this.unsubscribe = adapter.subscribe(handle.dspatchSessionId, (event) => {
      this.onAgentEvent(event);
    });

    const session: ChatSessionInfo = {
      dspatchSessionId: handle.dspatchSessionId,
      providerSessionId: handle.providerSessionId,
      modelRequested: this.modelRequested(),
      workspacePath,
      createdAt: handle.createdAt,
      toolPolicy: 'provider-default',
      workspaceOrigin:
        `generated by DSpatch (${String(generated.files.length)} files, git commit ` +
        `${generated.gitCommit ?? 'none'}) outside the DSpatch repository`,
      testCommand:
        this.runner === null ? null : `node ${TEST_ARGS.join(' ')}`,
      testRunnerPath: this.runner?.path ?? null,
      testRunnerSource: this.runner?.source ?? null,
    };
    this.session = session;
    this.options.log(
      `chat session ${session.dspatchSessionId} -> ${session.providerSessionId} ` +
        `workspace=${workspacePath}`,
    );
    return session;
  }

  async sendPrompt(prompt: string): Promise<{ readonly dspatchRunId: string }> {
    const { adapter, session } = this.requireSession();
    if (prompt.trim() === '') {
      throw new Error('An empty prompt is not sent.');
    }
    this.cancelState = emptyCancelState();
    this.terminalSeenForTurn = false;
    // `run.started` is emitted while `send` is still pending, so the turn record
    // is created by the event handler. The prompt is left here for it to pick up.
    this.pendingPrompt = prompt;
    return adapter.send(session.dspatchSessionId, prompt);
  }

  async cancelRun(): Promise<CancelOutcome> {
    const { adapter, session } = this.requireSession();
    const requestedAtUtc = nowIso();
    const startedAt = performance.now();
    this.cancelState = {
      ...this.cancelState,
      attempted: true,
      requestedAtPerf: startedAt,
      toolEventsBeforeCancel: this.currentTurn?.toolEvents ?? 0,
      workspaceFileCountAtCancel: this.countWorkspaceFiles(),
    };
    // Local work stops here regardless of what the provider does with the
    // request. The runner's own output is not part of the cancel measurement:
    // it writes under `artifacts/`, which snapshots exclude.
    this.stopWorkspaceTest();
    let error: string | null = null;
    try {
      await adapter.cancel(session.dspatchSessionId);
    } catch (caught) {
      error = describeError(caught);
    }
    const elapsedMs = round(performance.now() - startedAt);
    this.cancelState = {
      ...this.cancelState,
      cancelledAtUtc: nowIso(),
      watching: error === null,
    };
    this.options.log(
      `cancel requested: resolved in ${String(elapsedMs)} ms, error=${error ?? 'none'}`,
    );
    if (error === null) {
      void this.watchAfterCancel();
    }
    return {
      requestedAtUtc,
      elapsedMs,
      error,
      watchSeconds: CANCEL_WATCH_MS / 1000,
    };
  }

  getCancelObservations(): CancelObservations {
    const state = this.cancelState;
    const changed =
      state.workspaceFileCountAtCancel === null ||
      state.workspaceFileCountAfterWatch === null
        ? null
        : state.workspaceFileCountAfterWatch !== state.workspaceFileCountAtCancel;
    const keptWorking =
      state.toolEventsAfterCancel > 0 ||
      state.usageEventsAfterCancel > 0 ||
      changed === true;
    const verdict: CancelObservations['verdict'] = !state.attempted
      ? 'unresolved'
      : keptWorking
        ? 'provider-kept-working'
        : state.watching
          ? 'unresolved'
          : 'no-continued-work-observed';
    return {
      attempted: state.attempted,
      watching: state.watching,
      cancelledAtUtc: state.cancelledAtUtc,
      toolEventsBeforeCancel: state.toolEventsBeforeCancel,
      toolEventsAfterCancel: state.toolEventsAfterCancel,
      eventsAfterTerminalEvent: state.eventsAfterTerminalEvent,
      usageEventsAfterCancel: state.usageEventsAfterCancel,
      workspaceFileCountAtCancel: state.workspaceFileCountAtCancel,
      workspaceFileCountAfterWatch: state.workspaceFileCountAfterWatch,
      workspaceChangedAfterCancel: changed,
      watchedSeconds: state.watchedSeconds,
      verdict,
      note:
        'A cancelled client looks the same whether the provider stopped or DSpatch ' +
        'merely stopped listening. Only continued tool events, later file changes or ' +
        'a later usage record can tell them apart, so "no continued work observed" ' +
        'is not the same as "the provider stopped".',
    };
  }

  /**
   * Run the working copy's test as a child of the main process.
   *
   * DSpatch starts it, so the exit code and the output belong to DSpatch rather
   * than to a model's description of a tool call.
   */
  async runWorkspaceTest(): Promise<TestOutcome> {
    const session = this.session;
    if (session === null) {
      throw new Error('No session is open, so there is no working copy to test.');
    }
    const runner = this.runner;
    if (runner === null) {
      throw new Error(
        'No Node executable was found for running the test. Set DSPATCH_NODE_PATH ' +
          'to a node executable, or put node on PATH. DSpatch will not report a ' +
          'test result it did not run.',
      );
    }
    const startedAtUtc = nowIso();
    const startedAt = performance.now();
    const child = spawn(runner.path, [...TEST_ARGS], {
      cwd: session.workspacePath,
      windowsHide: true,
    });
    this.activeTest = child;
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const outcome = await new Promise<TestOutcome>((resolve) => {
      child.on('close', (code, signal) => {
        resolve({
          command: `${runner.path} ${TEST_ARGS.join(' ')}`,
          cwd: session.workspacePath,
          pid: child.pid ?? null,
          exitCode: code,
          signal: signal === null ? null : String(signal),
          stdout,
          stderr,
          durationMs: round(performance.now() - startedAt),
          startedAtUtc,
          finishedAtUtc: nowIso(),
        });
      });
    });
    this.activeTest = null;
    this.testRuns.push(outcome);
    this.options.log(
      `test run exit=${String(outcome.exitCode)} signal=${outcome.signal ?? 'none'} ` +
        `in ${String(outcome.durationMs)} ms`,
    );
    return outcome;
  }

  getWorkspaceChanges(): WorkspaceReport {
    const session = this.session;
    const baseline = this.baseline;
    if (session === null || baseline === null) {
      throw new Error('No session is open, so there is no baseline to compare with.');
    }
    const after = snapshotTree(session.workspacePath);
    const diff = diffSnapshots(baseline, after);
    const changed: WorkspaceChange[] = diff.changed.map((file) => ({
      relPath: file.relPath,
      beforeSha256: file.beforeSha256,
      afterSha256: file.afterSha256,
      beforeBytes: file.beforeBytes,
      afterBytes: file.afterBytes,
    }));
    return {
      workspacePath: session.workspacePath,
      baselineTakenAtUtc: baseline.takenAtUtc,
      observedAtUtc: after.takenAtUtc,
      changed,
      added: diff.added.map((file) => ({
        relPath: file.relPath,
        beforeSha256: null,
        afterSha256: file.sha256,
        beforeBytes: null,
        afterBytes: file.bytes,
      })),
      removed: diff.removed.map((file) => ({
        relPath: file.relPath,
        beforeSha256: file.sha256,
        afterSha256: null,
        beforeBytes: file.bytes,
        afterBytes: null,
      })),
      unchangedCount: diff.unchangedCount,
    };
  }

  /**
   * Token totals for a turn.
   *
   * Every field may be `null`, which means unknown. A cancelled turn produced no
   * usage message at all in substep 6, so `null` here is the honest answer and
   * `0` would be a false one. Monetary cost is not offered: `agent.getUsage()`
   * is refused for this account with HTTP 403 `feature_unavailable`.
   */
  async getTurnUsage(dspatchRunId: string): Promise<TurnUsage> {
    const adapter = this.adapter;
    if (adapter === null) {
      return { totalTokens: null, source: 'no adapter instance' };
    }
    const readings = await adapter.readUsage({ of: 'run', dspatchRunId });
    const total = readings.find(
      (reading) => reading.source === 'SDKUsageMessage.usage.totalTokens',
    );
    if (total === undefined) {
      return {
        totalTokens: null,
        source: 'no SDKUsageMessage arrived for this turn — unknown, not zero',
      };
    }
    return { totalTokens: total.value, source: total.source };
  }

  /** Everything the main process observed, for the run record. */
  evidence(): Record<string, unknown> {
    return {
      session: this.session,
      baseline: this.baseline === null ? null : {
        root: this.baseline.root,
        takenAtUtc: this.baseline.takenAtUtc,
        files: this.baseline.files,
      },
      turns: this.turns.map((turn) => ({
        dspatchRunId: turn.dspatchRunId,
        prompt: turn.prompt,
        startedAtUtc: turn.startedAtUtc,
        finishedAtUtc: turn.finishedAtUtc,
        deltaCount: turn.deltaCount,
        deltaChars: turn.deltaText.length,
        finalMessageChars: turn.finalMessage?.length ?? null,
        toolEvents: turn.toolEvents,
        terminalStatus: turn.terminalStatus,
        errorMessage: turn.errorMessage,
        eventTypeCounts: turn.rawEventTypes,
        usageEvents: turn.usageEvents,
      })),
      testRuns: this.testRuns,
      cancelObservations: this.getCancelObservations(),
      nodeRunner: this.runner,
      workspaceChangesAtEnd: this.session === null ? null : this.getWorkspaceChanges(),
      providerMessageTypes:
        this.adapter === null || this.session === null
          ? null
          : this.adapter.providerMessageTypes(this.session.dspatchSessionId),
      streamPumpFinished:
        this.adapter === null || this.session === null
          ? null
          : this.adapter.streamPumpFinished(this.session.dspatchSessionId),
      modelReported:
        this.adapter === null || this.session === null
          ? null
          : this.adapter.modelReported(this.session.dspatchSessionId),
      capabilities: this.adapter?.capabilities() ?? null,
    };
  }

  /**
   * Stop the test runner if one is still going.
   *
   * The whole tree, not just the process we spawned: `node --test` runs each
   * test file in a child of its own, and a surviving grandchild holds the
   * working directory just as effectively as its parent would.
   *
   * Failures are logged and swallowed. This runs on the way out of a turn, and
   * a session that has already ended should not fail because the corpse of its
   * test runner could not be collected — the next `startSession` reports the
   * directory it cannot delete, which is the point at which it matters.
   */
  private stopWorkspaceTest(): void {
    const child = this.activeTest;
    this.activeTest = null;
    if (child === null || child.exitCode !== null || child.pid === undefined) return;

    this.options.log(`stopping test runner pid=${String(child.pid)}`);
    try {
      if (process.platform === 'win32') {
        const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          encoding: 'utf8',
        });
        if (killed.status !== 0) {
          this.options.log(`taskkill exit=${String(killed.status)} ${killed.stderr?.trim() ?? ''}`);
        }
      } else {
        child.kill('SIGKILL');
      }
    } catch (err) {
      this.options.log(`could not stop the test runner: ${String(err)}`);
    }
  }

  async dispose(): Promise<void> {
    await this.closeSession();
    const adapter = this.adapter;
    this.adapter = null;
    if (adapter !== null) {
      await adapter.dispose();
    }
  }

  private async closeSession(): Promise<void> {
    this.stopWorkspaceTest();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = null;
    this.baseline = null;
    this.currentTurn = null;
    // A new session on the same adapter instance would collide on the derived
    // provider agent ID, so the adapter is replaced with the session.
    const adapter = this.adapter;
    this.adapter = null;
    if (adapter !== null) {
      await adapter.dispose();
    }
  }

  private ensureAdapter(): CursorSdkAdapter {
    if (this.adapter === null) {
      this.adapter = new CursorSdkAdapter({ toolPolicy: 'provider-default' });
    }
    return this.adapter;
  }

  private requireSession(): {
    adapter: CursorSdkAdapter;
    session: ChatSessionInfo;
  } {
    const adapter = this.adapter;
    const session = this.session;
    if (adapter === null || session === null) {
      throw new Error('No session is open. Start one first.');
    }
    return { adapter, session };
  }

  private countWorkspaceFiles(): number | null {
    const session = this.session;
    if (session === null) {
      return null;
    }
    try {
      return snapshotTree(session.workspacePath).files.length;
    } catch {
      return null;
    }
  }

  /**
   * Keep looking after a cancellation.
   *
   * The events are counted by the subscriber; this only samples the working copy,
   * because a provider that kept going keeps writing files, and files are visible
   * from outside the connection.
   */
  private async watchAfterCancel(): Promise<void> {
    const startedAt = performance.now();
    while (performance.now() - startedAt < CANCEL_WATCH_MS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1_000);
      });
      this.cancelState = {
        ...this.cancelState,
        workspaceFileCountAfterWatch: this.countWorkspaceFiles(),
        watchedSeconds: Math.round((performance.now() - startedAt) / 1000),
      };
    }
    this.cancelState = { ...this.cancelState, watching: false };
    this.options.log(
      'cancellation watch finished: ' +
        `toolEventsAfter=${String(this.cancelState.toolEventsAfterCancel)} ` +
        `usageAfter=${String(this.cancelState.usageEventsAfterCancel)} ` +
        `filesAtCancel=${String(this.cancelState.workspaceFileCountAtCancel)} ` +
        `filesAfter=${String(this.cancelState.workspaceFileCountAfterWatch)}`,
    );
  }

  private onAgentEvent(event: AgentEvent): void {
    if (event.type === 'run.started') {
      const turn: TurnRecord = {
        dspatchRunId: event.dspatchRunId,
        prompt: this.pendingPrompt,
        startedAtUtc: event.at,
        deltaCount: 0,
        deltaText: '',
        finalMessage: null,
        toolEvents: 0,
        terminalStatus: null,
        errorMessage: null,
        finishedAtUtc: null,
        usageEvents: [],
        rawEventTypes: {},
      };
      this.turns.push(turn);
      this.currentTurn = turn;
      this.terminalSeenForTurn = false;
    }

    const turn = this.currentTurn;
    if (turn !== null && turn.dspatchRunId === event.dspatchRunId) {
      turn.rawEventTypes[event.type] = (turn.rawEventTypes[event.type] ?? 0) + 1;
      if (this.terminalSeenForTurn) {
        this.cancelState = {
          ...this.cancelState,
          eventsAfterTerminalEvent: this.cancelState.eventsAfterTerminalEvent + 1,
        };
      }
      switch (event.type) {
        case 'assistant.delta': {
          turn.deltaCount += 1;
          turn.deltaText += event.text;
          break;
        }
        case 'assistant.message': {
          turn.finalMessage = event.text;
          break;
        }
        case 'tool.started':
        case 'tool.finished': {
          turn.toolEvents += 1;
          if (this.cancelState.attempted) {
            this.cancelState = {
              ...this.cancelState,
              toolEventsAfterCancel: this.cancelState.toolEventsAfterCancel + 1,
            };
          }
          break;
        }
        case 'usage': {
          turn.usageEvents.push({ atUtc: event.at, readings: event.readings });
          if (this.cancelState.attempted) {
            this.cancelState = {
              ...this.cancelState,
              usageEventsAfterCancel: this.cancelState.usageEventsAfterCancel + 1,
            };
          }
          break;
        }
        case 'run.finished': {
          turn.terminalStatus = event.status;
          turn.finishedAtUtc = event.at;
          turn.errorMessage = event.error?.message ?? null;
          this.terminalSeenForTurn = true;
          break;
        }
        default:
          break;
      }
    }

    this.options.send(toUiEvent(event));
  }
}

/**
 * Strip the event down to what crosses the bridge.
 *
 * `rawProviderEvent` is not forwarded. It is not reliably structured-cloneable,
 * the renderer cannot do anything with it, and the main process keeps it.
 */
function toUiEvent(event: AgentEvent): UiAgentEvent {
  const base = {
    type: event.type,
    dspatchSessionId: event.dspatchSessionId,
    dspatchRunId: event.dspatchRunId,
    at: event.at,
  };
  switch (event.type) {
    case 'assistant.delta':
    case 'assistant.message':
    case 'reasoning.delta':
      return { ...base, text: event.text };
    case 'tool.started':
      return { ...base, toolName: event.name };
    case 'tool.finished':
      return { ...base, toolName: event.name, toolStatus: event.status };
    case 'approval.requested':
      return { ...base, approvalSummary: event.request.summary };
    case 'usage':
      return { ...base, readings: event.readings };
    case 'run.finished':
      return {
        ...base,
        status: event.status,
        ...(event.error === undefined ? {} : { errorMessage: event.error.message }),
      };
    default:
      return base;
  }
}
