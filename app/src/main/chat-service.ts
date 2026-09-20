import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Cursor } from '@cursor/sdk';

import { CursorSdkAdapter } from '../adapter/cursor-sdk-adapter';
import type {
  AgentEvent,
  AgentEventListener,
  CapabilityReport,
  ModelInfo,
  RunReference,
  SessionConfig,
  SessionHandle,
  Unsubscribe,
  UsageQuery,
  UsageReading,
} from '../adapter/types';
import type {
  AbandonOutcome,
  AttemptInfo,
  AttemptReconciliation,
  BaselineInfo,
  CancelObservations,
  CancelOutcome,
  ChatSessionInfo,
  ConnectionStatus,
  ModelChoice,
  ConversationListing,
  ConversationSaveStatus,
  DirtyFileInfo,
  GitBaselineInfo,
  RestoredConversation,
  RestoredHistory,
  RestoredDiff,
  RestoredTestResult,
  RunStateReport,
  SessionContextInfo,
  SessionContinuity,
  SessionOrigin,
  StartSessionRequest,
  StoredBaseline,
  StoredBaselineFile,
  StoredConversation,
  StoredMessage,
  StoredSession,
  TestFreshness,
  TestOutcome,
  TestRunRequest,
  TurnUsage,
  UiAgentEvent,
  WorkspaceChange,
  WorkspaceReport,
} from '../shared/bridge';
import { saysSessionAlreadyHasARun } from '../shared/session-run-block';
import { AttemptLedger } from './attempt-ledger';
import {
  CONVERSATION_FORMAT_VERSION,
  newConversationId,
  type ConversationReadResult,
  type ConversationStore,
} from './conversation-store';
import { diffSnapshots, generateExperimentRepo } from './experiment-repo';
import {
  cleanUpSampleProjects,
  createSampleProjectFolder,
  listSampleProjects,
  sampleProjectsRoot,
  type SampleCleanupResult,
  type SampleProjectListing,
} from './sample-projects';
import { readGitWorkingCopyState } from './git-state';
import {
  describeContainingRefusal,
  describeRefusal,
  describeUndecidableContainment,
  findOwnRepository,
  ownRepositoryInside,
} from './own-repository';
import { samePath } from './project-store';
import {
  checkRunRequest,
  describeShell,
  evaluateFreshness,
  evaluateTestVerdict,
  presentTestStatus,
  suggestBuildCommand,
} from './test-command';
import { buildUnifiedDiff, type DiffSide } from './text-diff';
import {
  DEFAULT_RETENTION_LIMITS,
  DEFAULT_SNAPSHOT_LIMITS,
  snapshotWorkspace,
  type WorkspaceSnapshot,
} from './workspace-baseline';

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

/**
 * How long DSpatch waits for something that **confirms** a cancellation.
 *
 * This is a different question from `CANCEL_WATCH_MS` above and needs a different
 * number. The watch asks whether the provider kept working, and its length is set
 * by the longest continued work ever measured here. This asks only whether a
 * terminal event arrives at all, and the two cancellations report 003 observed
 * reported `cancelled` in 44 ms and 52 ms. Ten seconds is roughly two hundred
 * times that, so a run still without a terminal event by then is not slow — it is
 * a run whose ending DSpatch cannot establish, and after this the attempt is
 * moved to `outcome-unknown` and blocks a repeat until someone has seen it.
 *
 * Nothing is claimed to have stopped when this expires. The workspace watch keeps
 * going, and its verdict is still the only evidence about the provider.
 */
const CANCEL_CONFIRM_MS = 10_000;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * How much of DSpatch's own record may be put in front of a message.
 *
 * Small on purpose. This is a recap of what was said, not a substitute for the
 * project: the agent reads files itself, so resending code would pay for tokens to
 * tell the model something it can look up, and would risk telling it about code
 * that has since changed. `MAX_RESEND_MESSAGES` bounds how far back it goes, and
 * the per-message limits keep one long answer from filling the whole budget.
 */
const RESEND_LIMITS = {
  maxMessages: 6,
  maxPromptChars: 400,
  maxAnswerChars: 700,
  maxTotalChars: 8_000,
} as const;

const FIRST_SESSION_CONTINUITY: SessionContinuity = {
  kind: 'first-session',
  attemptedDspatchSessionId: null,
  resumedProviderSessionId: null,
  resumeError: null,
  contextToResend: null,
  contextNote:
    'Nothing was resent, because there is nothing saved to resend: this ' +
    'conversation has no earlier messages.',
  savedMessageCount: 0,
  statement:
    'A new provider session over this project. There was no earlier conversation ' +
    'to continue, so nothing has been resumed and nothing has been resent.',
};

/** Cut text to a limit and say so, rather than ending mid-word in silence. */
function clip(text: string, limit: number, what: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return (
    `${trimmed.slice(0, limit)}\n[DSpatch cut this ${what} at ${String(limit)} of ` +
    `${String(trimmed.length)} characters.]`
  );
}

/**
 * DSpatch's own record of a conversation, as text for a model that was told nothing.
 *
 * Written when the earlier provider session could not be resumed. Every claim in it
 * is something DSpatch observed and wrote down; it deliberately does **not** include
 * file contents or the diff text, for two reasons. The agent can read the files, so
 * resending them buys nothing; and the saved diff describes code that may have moved
 * on since, so putting it in front of the model as if it were current is the exact
 * mistake AC#6 forbids the window to make.
 *
 * What it leaves out is stated inside the text itself, because the model is as
 * entitled to know the limits of what it has been given as the user is.
 */
export function buildResendContext(input: {
  readonly workspacePath: string;
  readonly messages: readonly StoredMessage[];
  readonly reviewedDiff: WorkspaceReport | null;
  readonly test: TestOutcome | null;
  readonly reason: string;
  readonly limits?: typeof RESEND_LIMITS;
}): string | null {
  const limits = input.limits ?? RESEND_LIMITS;
  const ordered = [...input.messages].sort((left, right) => left.ordinal - right.ordinal);
  if (ordered.length === 0) {
    return null;
  }
  const shown = ordered.slice(-limits.maxMessages);
  const omitted = ordered.length - shown.length;

  const lines: string[] = [
    '=== DSpatch: a record of the earlier conversation ===',
    '',
    'You are being given this because the provider session this conversation was ' +
      `last worked in could not be continued (${input.reason}), so you have no ` +
      'memory of it. Everything below is DSpatch\'s own record of what happened, ' +
      'resent so that the person you are talking to is not talking to a model that ' +
      'has been told nothing.',
    '',
    'What this record is not: it is not the earlier session. Tool calls, files the ' +
      'earlier agent read, and anything it worked out without saying are not in it. ' +
      'No file content is included — read the project yourself for what is there ' +
      'now, because the code may have changed since these turns.',
    '',
    `Project: ${input.workspacePath}`,
    `Earlier messages: ${String(ordered.length)}${
      omitted === 0
        ? ', all of them below'
        : `, of which the oldest ${String(omitted)} ${
            omitted === 1 ? 'is' : 'are'
          } left out here and only the most recent ${String(shown.length)} follow`
    }.`,
  ];

  for (const message of shown) {
    lines.push(
      '',
      `--- message ${String(message.ordinal + 1)} of ${String(ordered.length)} (${
        message.terminalStatus === null
          ? 'no ending was ever reported for this turn'
          : `ended as ${message.terminalStatus}`
      }) ---`,
      'The person asked:',
      message.prompt.trim() === ''
        ? '[no prompt was recorded for this turn]'
        : clip(message.prompt, limits.maxPromptChars, 'message'),
      'You answered:',
      message.answer.trim() === ''
        ? '[nothing was received for this turn before DSpatch stopped listening]'
        : clip(message.answer, limits.maxAnswerChars, 'answer'),
    );
  }

  const diff = input.reviewedDiff;
  if (diff !== null) {
    const names = [...diff.changed, ...diff.added, ...diff.removed].map(
      (file) => file.relPath,
    );
    lines.push(
      '',
      '--- what was reviewed ---',
      `A diff was reviewed between ${diff.baselineSnapshotId} and ` +
        `${diff.observedSnapshotId}, covering ${String(names.length)} file${
          names.length === 1 ? '' : 's'
        }${names.length === 0 ? '' : `: ${names.join(', ')}`}. The diff text itself ` +
        'is not resent: it describes the code as it was at that moment, and the ' +
        'files on disk are the only account of what is there now.',
    );
  }

  const test = input.test;
  if (test !== null) {
    lines.push(
      '',
      '--- what was run ---',
      `\`${test.command}\` in ${test.cwd} — ${test.verdictHeadline} (exit ` +
        `${test.exitCode === null ? 'none' : String(test.exitCode)}, signal ` +
        `${test.signal ?? 'none'}), against ${test.snapshotId ?? 'an unhashed working copy'}` +
        `, at ${test.finishedAtUtc}. Its output is not resent. Whether that result ` +
        'still describes the code on disk is a question about the code now, not ' +
        'about this record.',
    );
  }

  lines.push(
    '',
    '=== end of the record. The message below is the new one, from the person. ===',
  );

  const text = lines.join('\n');
  return text.length <= limits.maxTotalChars
    ? text
    : `${text.slice(0, limits.maxTotalChars)}\n[DSpatch cut this record at ${String(
        limits.maxTotalChars,
      )} of ${String(text.length)} characters. What is missing is the end of it, ` +
        'including the marker that separates it from the new message.]';
}

/** What the recap covers and what it leaves out, for the window rather than the model. */
function resendNote(recap: string | null, savedMessageCount: number): string {
  if (recap === null) {
    return (
      'There is nothing saved to resend: this conversation has no earlier messages, ' +
      'so the model is starting from your next message alone.'
    );
  }
  return (
    `DSpatch will put ${String(recap.length)} characters in front of your next ` +
    `message: the most recent of this conversation's ${String(savedMessageCount)} ` +
    'saved messages, the file list and snapshot identities of the diff that was ' +
    'reviewed, and the command that was run with its verdict. It does **not** ' +
    'include any file content, the diff text, or the command output — the agent ' +
    'reads the project itself, and resending code that may have changed since would ' +
    'be putting an old copy in front of the model as if it were current. The exact ' +
    'text is below; it is sent once, with the next message only.'
  );
}

/** A prompt shortened to a label. The attempt list has to stay readable. */
function promptLabel(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? '';
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
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

/**
 * How much of a command's output DSpatch keeps, per stream.
 *
 * A build can produce megabytes, and all of it would cross the bridge and sit in
 * the renderer. Cutting it off is fine; cutting it off without saying so is not,
 * so the outcome carries `outputTruncated`.
 */
const MAX_OUTPUT_CHARS = 200_000;

function toDirtyFileInfo(
  files: readonly {
    readonly relPath: string;
    readonly statusCode: string;
    readonly kind: DirtyFileInfo['kind'];
    readonly previousRelPath: string | null;
    readonly staged: boolean;
  }[],
): readonly DirtyFileInfo[] {
  return files.map((file) => ({
    relPath: file.relPath,
    statusCode: file.statusCode,
    kind: file.kind,
    previousRelPath: file.previousRelPath,
    staged: file.staged,
  }));
}

function toBaselineInfo(taken: WorkspaceSnapshot): BaselineInfo {
  return {
    snapshotId: taken.snapshotId,
    takenAtUtc: taken.snapshot.takenAtUtc,
    fileCount: taken.fileCount,
    totalBytes: taken.totalBytes,
    fileSource: taken.fileSource,
    fileSourceNote: taken.fileSourceNote,
    truncated: taken.truncated,
    skipped: taken.skipped,
    durationMs: taken.durationMs,
  };
}

interface TurnRecord {
  /**
   * The conversation this turn belongs to.
   *
   * Recorded per turn because `turns` accumulates for the whole process — the run
   * record in `evidence()` wants all of it — while a saved conversation must contain
   * only its own. Without this, opening a second project would write the first
   * project's prompts into the second one's file.
   */
  readonly conversationId: string | null;
  readonly dspatchRunId: string;
  prompt: string;
  /**
   * DSpatch's recap of the conversation, put in front of this prompt, or `null`.
   *
   * Kept apart from `prompt` everywhere: the recap is DSpatch talking to the model,
   * and folding it into the user's text would make the transcript claim they wrote
   * it. The two are joined only in the string handed to the provider.
   */
  readonly resentContext: string | null;
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

/**
 * What this service needs from an adapter.
 *
 * The structural subset of {@link CursorSdkAdapter} that `chat-service.ts`
 * actually calls, so a test can substitute one. It is not a second adapter
 * interface: `AgentAdapter` remains the agreed contract, and `CursorSdkAdapter`
 * satisfies this by having those methods rather than by declaring it.
 *
 * The reason for the seam is the failure paths. A cancellation that never reports
 * an end, a send that never starts and a connection that dies mid-turn are
 * exactly the states report 003 could not produce on demand against the live
 * provider — both of its cancels resolved in ~50 ms — so the invariants that
 * depend on them can only be shown to hold if they can be constructed. A test
 * using this seam is a **simulation** and is labelled as one; it is not evidence
 * about Cursor's behaviour, only about DSpatch's.
 */
export interface ChatAdapter {
  readonly id: string;
  capabilities(): CapabilityReport;
  listModels(): Promise<readonly ModelInfo[]>;
  startSession(config: SessionConfig): Promise<SessionHandle>;
  /**
   * Continue an earlier session by its DSpatch ID.
   *
   * Optional here, unlike on {@link AgentAdapter}, so a test can supply an adapter
   * that has no resumption at all — which is a real state and the branch AC#2's
   * fallback exists for. `CursorSdkAdapter` has it.
   */
  resume?(sessionId: string, config: SessionConfig): Promise<SessionHandle>;
  /**
   * Whether the adapter itself is holding a run for this session.
   *
   * The one thing that tells the two "already has active run" refusals apart
   * without reading prose, and report 008 measured why that matters. When this is
   * `true` the refusal came from DSpatch's own guard: *this window* started the
   * run, its end will arrive as an event, and "Execution state" will show it. When
   * it is `false` the refusal came from Cursor about a run DSpatch is not watching
   * — the run a restarted session inherited — and no event will ever arrive for
   * it, so telling the user to wait for one would be a lie.
   *
   * Optional so a test adapter can leave it out; absent is read as `false`, which
   * is the state of an adapter that does not track runs at all.
   */
  hasActiveRun?(sessionId: string): boolean;
  subscribe(sessionId: string, listener: AgentEventListener): Unsubscribe;
  send(sessionId: string, prompt: string): Promise<RunReference>;
  cancel(sessionId: string): Promise<void>;
  readUsage(scope: UsageQuery): Promise<readonly UsageReading[]>;
  providerMessageTypes(sessionId: string): Record<string, number>;
  streamPumpFinished(sessionId: string): boolean | null;
  modelReported(sessionId: string): string | null;
  dispose(): Promise<void>;
}

/**
 * What `getConnection` needs to know about the stored login.
 *
 * A structural mirror of the SDK's `SdkAuthStatus`, for one reason: report 005
 * recorded that `getConnection`'s failure branch had no test at all, because it
 * called the static `Cursor.auth.status()` directly and nothing could stand in for
 * it. That branch is the only thing between a stored-but-unusable login and a window
 * that says "connected", and `npm test` would have stayed green if it had been
 * deleted. It is now injected the way the adapter already is.
 *
 * Deliberately not `import type { SdkAuthStatus }`: this states the fields DSpatch
 * actually reads, so a future SDK that adds a third variant fails the typecheck at
 * the one line that adapts it rather than somewhere inside a branch.
 */
export type AuthStatusReading =
  | { readonly status: 'logged-out' }
  | {
      readonly status: 'logged-in';
      readonly backendUrl: string;
      readonly email?: string | undefined;
      readonly apiKeyExpiresAtMs?: number | undefined;
    };

export interface ChatServiceOptions {
  /**
   * The boundary the generated sample project and the DSP-1 probe stay outside of.
   *
   * **Not read by any refusal.** `DSPATCH_PROBE_REPO_ROOT` can name this value, so
   * a refusal that read it would let an environment variable decide which folders
   * DSpatch declines to open — which is what Verifier 004 measured happening, on a
   * folder that was not DSpatch and could not be told so. Which folders are refused
   * is decided by content, in `validateProjectFolder`, from this repository's own
   * markers and from `ownRepoRoot` below.
   */
  readonly repoRoot: string;
  /**
   * DSpatch's own working copy, as the process that owns the application path
   * resolved it by content, or `null` when that resolution found nothing.
   *
   * Deliberately **not** `repoRoot`, for the reason above: that value can be named
   * by `DSPATCH_PROBE_REPO_ROOT` and falls back to the parent of the application
   * path, and DSP-16 established that no environment variable may widen or weaken
   * containment; pointing the variable somewhere would otherwise start refusing
   * every folder above it. This one comes from `ownRepositoryRoot()`, which finds
   * the repository or admits it cannot.
   *
   * The refusal reads it for one question the content walk cannot answer: whether
   * the chosen folder *contains* DSpatch. Omitted or `null` means unknown, and
   * unknown refuses nothing — a stated limit for a packaged copy moved out of the
   * tree it was built in.
   */
  readonly ownRepoRoot?: string | null;
  /** Sends one event to the live renderer. */
  readonly send: (event: UiAgentEvent) => void;
  readonly log: (message: string) => void;
  /**
   * Where the adapter comes from. Defaults to the real Cursor adapter.
   *
   * Present so the failure paths can be constructed in a test. Production passes
   * nothing and gets {@link CursorSdkAdapter}.
   */
  readonly createAdapter?: () => ChatAdapter;
  /**
   * How the stored login is read. Defaults to `Cursor.auth.status()`.
   *
   * Never returns the credential, by the SDK's own documentation and by this type:
   * there is no field here that could carry one.
   */
  readonly readAuthStatus?: () => Promise<AuthStatusReading>;
  /**
   * Where conversations are saved, or `null` for a service that keeps none.
   *
   * A function rather than a value because the store lives under Electron's
   * `userData`, which the main process resolves at startup, while this service is
   * constructed before that. `null` is a supported state and not a failure: the
   * window still works, and says that this session will not survive a restart.
   */
  readonly conversations?: () => ConversationStore | null;
  /**
   * Which saved conversation a project belongs to, if any.
   *
   * The pointer lives in the project store, written when a project is opened, so
   * there is one answer to "what conversation is this project's" rather than a guess
   * made by matching paths across saved files. `null` is the normal answer for a
   * project that has not been opened since conversations existed.
   */
  readonly conversationForProject?: (projectPath: string) => string | null;
  /**
   * Where generated sample projects live. Defaults to `%TEMP%/dspatch-chat`.
   *
   * Present so a test can own the location it plants leftovers in rather than
   * writing into the real one. Production passes nothing.
   */
  readonly sampleProjectsRoot?: string;
  /**
   * Overrides for the two waiting periods, so a test does not spend 100 seconds
   * establishing a rule about them. Production passes nothing.
   */
  readonly timings?: {
    readonly cancelConfirmMs?: number;
    readonly cancelWatchMs?: number;
  };
}

export class ChatService {
  private readonly options: ChatServiceOptions;

  private adapter: ChatAdapter | null = null;

  private session: ChatSessionInfo | null = null;

  private baseline: WorkspaceSnapshot | null = null;

  /**
   * Paths that already differed from git `HEAD` when the session opened.
   *
   * Kept as a set because every later file report is checked against it: a file
   * the user had already edited must never be shown as purely the agent's work.
   */
  private dirtyAtStart = new Set<string>();

  private dirtyFilesAtStart: readonly DirtyFileInfo[] = [];

  /** Events for a session that is no longer open. Counted, never applied. */
  private foreignEventsDropped = 0;

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

  /** Set when DSpatch itself killed the command, so it is never read as a result. */
  private testKillRequested = false;

  /** The result the window is showing, and the snapshots it is bound to. */
  private lastTest: TestOutcome | null = null;

  private terminalSeenForTurn = false;

  private pendingPrompt = '';

  private runner: NodeRunner | null;

  /**
   * Every attempt this process has made, in an explicit state.
   *
   * Deliberately **not** cleared when a session closes. A run whose end was never
   * confirmed does not stop being unresolved because DSpatch opened a different
   * project, and the next send has to reckon with it rather than start beside it.
   * What closing does is record that DSpatch stopped listening, which is a change
   * in knowledge and not an ending.
   */
  private readonly ledger = new AttemptLedger();

  /** The attempt a `send` in flight belongs to. `run.started` needs it. */
  private pendingAttemptId: string | null = null;

  private readonly attemptByRunId = new Map<string, string>();

  /** Sends the window stopped waiting for. Their runs are stopped if they start. */
  private readonly abandonedAttempts = new Set<string>();

  private activeCommandAttemptId: string | null = null;

  private readonly cancelConfirmMs: number;

  private readonly cancelWatchMs: number;

  private readonly readAuthStatus: () => Promise<AuthStatusReading>;

  // --- Saved conversations (DSP-4) -------------------------------------------

  /** The conversation the current work belongs to. `null` before a project opens. */
  private conversationId: string | null = null;

  private conversationCreatedAtUtc: string | null = null;

  /**
   * Which conversation each attempt belongs to.
   *
   * The ledger is deliberately not cleared when a session closes, so within one
   * process it holds attempts from every project that has been opened. Saving all of
   * them into whichever conversation happens to be current would put one project's
   * prompts into another project's file.
   */
  private readonly attemptConversation = new Map<string, string>();

  /** Messages read back from disk, per conversation, ahead of this session's turns. */
  private readonly carriedMessages = new Map<string, readonly StoredMessage[]>();

  /**
   * The history the opening session adopted, as the window is told about it.
   *
   * Built by {@link adoptConversationFor} and read once by
   * {@link startChatSession}. It exists because "which messages did this project
   * already have" was known here and nowhere else: the window drew an empty thread
   * and the file kept its contents, so a reopened project looked wiped while being
   * intact. Reset on every open, so a session over a fresh conversation reports an
   * empty history rather than the previous project's.
   */
  private openedHistory: RestoredHistory | null = null;

  /** Command results per conversation, this session's and any carried in. */
  private readonly conversationTestRuns = new Map<string, TestOutcome[]>();

  /** The baseline as it will be written. Built once per session: it cannot change. */
  private storedBaseline: StoredBaseline | null = null;

  private carriedBaseline: StoredBaseline | null = null;

  /** The last diff the window produced, kept verbatim as the reviewed record. */
  private reviewedDiff: WorkspaceReport | null = null;

  /** The project the current conversation is about, so reopening it can continue. */
  private conversationProjectPath: string | null = null;

  /** A result read back from disk, adopted when its own project is opened again. */
  private carriedTest: TestOutcome | null = null;

  /** The conversation currently held from disk. One at a time, by design. */
  private restoredConversationId: string | null = null;

  /** Conversations this window has actually worked in, as opposed to read. */
  private readonly liveConversations = new Set<string>();

  /** The most recent save failure, so the window can say the work is not safe. */
  private lastSaveError: string | null = null;

  /** The last body written, so an unchanged conversation is not rewritten. */
  private lastSavedBody: string | null = null;

  /**
   * The recap DSpatch still owes the provider, or `null`.
   *
   * Set when a session opens over a conversation whose earlier provider session
   * could **not** be resumed, and cleared the moment a send is accepted. That is
   * the whole of AC#2's fallback: the model has been told nothing, so the first
   * message carries DSpatch's own record of what came before. A session that did
   * resume owes nothing, because the provider already holds the turns.
   */
  private pendingResendContext: string | null = null;

  /** The recap attached to the send in flight, for the turn record to pick up. */
  private pendingResentContext: string | null = null;

  /** How this session relates to the conversation's earlier one. */
  private continuity: SessionContinuity = FIRST_SESSION_CONTINUITY;

  /** The model chosen in the window, or `null` for the environment's choice. */
  private modelChosen: string | null = null;

  constructor(options: ChatServiceOptions) {
    this.options = options;
    this.runner = resolveNodeRunner();
    this.cancelConfirmMs = options.timings?.cancelConfirmMs ?? CANCEL_CONFIRM_MS;
    this.cancelWatchMs = options.timings?.cancelWatchMs ?? CANCEL_WATCH_MS;
    this.readAuthStatus =
      options.readAuthStatus ?? (() => Cursor.auth.status() as Promise<AuthStatusReading>);
  }

  /** DSpatch's own sample location. Nothing outside it is ever cleaned up. */
  sampleProjectsRootPath(): string {
    return this.options.sampleProjectsRoot ?? sampleProjectsRoot();
  }

  /**
   * A folder for a new generated sample project (DSP-61).
   *
   * **A fresh folder each time.** This used to be one fixed path,
   * `%TEMP%/dspatch-chat/duration-repo`, reused by every session — and the copy of
   * it left on Niclas's machine from 14–16 September predates the
   * `.dspatch-experiment` marker, so the generator rightly refused to wipe it and
   * *Use a generated sample project* failed permanently with nothing offered. The
   * refusal was correct; sharing one directory between every session was not.
   *
   * `DSPATCH_CHAT_WORKSPACE` still wins, unchanged, so DSP-1's recorded procedure
   * still means what it said — and a path named that way is treated as named by a
   * person: it gets no fresh folder and no cleanup, and the generator's refusal
   * applies to it exactly as before.
   *
   * The project the user opens is a different thing entirely and never comes from
   * here.
   */
  allocateSampleWorkspacePath(): string {
    const explicit = process.env['DSPATCH_CHAT_WORKSPACE'];
    if (explicit !== undefined && explicit.trim() !== '') {
      return path.resolve(explicit.trim());
    }
    return createSampleProjectFolder(this.sampleProjectsRootPath());
  }

  /**
   * The old sample projects, for the window to offer removing.
   *
   * The one the open session is using is left out, because it is not old content.
   */
  listSampleProjects(): SampleProjectListing {
    return listSampleProjects(
      this.sampleProjectsRootPath(),
      this.session?.origin === 'generated-sample' ? this.session.workspacePath : null,
    );
  }

  /** Remove old sample projects, because a person asked for it and nothing else. */
  cleanUpSampleProjects(paths: readonly string[]): SampleCleanupResult {
    return cleanUpSampleProjects(this.sampleProjectsRootPath(), {
      paths,
      inUse:
        this.session?.origin === 'generated-sample' ? this.session.workspacePath : null,
    });
  }

  modelRequested(): string {
    return this.modelChosen ?? process.env['DSPATCH_CHAT_MODEL'] ?? DEFAULT_MODEL;
  }

  /**
   * Choose the model for ordinary messages (DSP-60 #3).
   *
   * It is read on each send, so the choice applies to the next message rather
   * than to the session: a turn already in flight keeps the model it was started
   * with, because there is nothing DSpatch could do to change that and saying
   * otherwise would be a claim about the provider it cannot make. A loop run is
   * untouched — it carries its own model, from `DSPATCH_LIVE_MODEL`.
   *
   * An empty or blank id clears the choice and returns to the environment's.
   */
  setRequestedModel(modelId: string): string {
    this.modelChosen = modelId.trim() === '' ? null : modelId.trim();
    return this.modelRequested();
  }

  /** The node executable found for running commands, or `null` if there is none. */
  nodeRunnerPath(): string | null {
    return this.runner?.path ?? null;
  }

  /** The session the window has open, or null. Identity only — not a handle. */
  openSession(): ChatSessionInfo | null {
    return this.session;
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
      const status = await this.readAuthStatus();
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
      let models: readonly ModelChoice[] = [];
      let modelListFailure: string | null = null;
      try {
        const adapter = this.ensureAdapter();
        const listed = await adapter.listModels();
        modelsAvailable = listed.length;
        // Kept by name as well as counted, for the chooser beside the composer.
        // A count answers "is the login usable"; a name is what a person picks.
        models = listed.map((model) => ({
          id: model.id,
          displayName: model.displayName === '' ? model.id : model.displayName,
        }));
      } catch (error) {
        modelListFailure = describeError(error);
        this.options.log(`model list unavailable: ${modelListFailure}`);
      }
      if (modelListFailure !== null) {
        // Measured, not imagined: driving the real window with the SDK's data
        // directory redirected produced `logged-in` from `auth.status()` and a
        // failing model list, and the window said "connected". Sending would then
        // have failed with no warning. A stored login that cannot be used is not a
        // connection, which is what this function's own comment already said.
        return {
          kind: 'error',
          message:
            `A stored login was found for ${status.email ?? 'this account'}, but ` +
            `the provider could not be used with it: ${modelListFailure} The login ` +
            'itself is intact — nothing about it has been changed — so this is ' +
            'usually the network or the provider rather than your account. Nothing ' +
            'is sent while this is true, and nothing is retried on its own beyond ' +
            'the two checks the window makes.',
          checkedAtUtc,
        };
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
        models,
        modelRequested: this.modelRequested(),
        checkedAtUtc,
      };
    } catch (error) {
      return { kind: 'error', message: describeError(error), checkedAtUtc };
    }
  }

  /**
   * Open a session over a working copy.
   *
   * Two kinds, and the window states which one it did. A chosen folder is the
   * user's own project: it is validated, its git state is recorded **before** the
   * agent is created, and nothing in it is generated or deleted. The sample is
   * DSP-1's generated project, kept so that DSpatch is usable with nothing
   * selected and so that the recorded experiment remains repeatable; the
   * generator refuses to write inside the DSpatch repository and refuses to wipe
   * a directory that is not its own.
   *
   * The order matters. The git reading and the content baseline both happen
   * before `startSession`, because a baseline taken after the agent exists cannot
   * distinguish the user's uncommitted work from the agent's.
   */
  async startChatSession(request: StartSessionRequest): Promise<ChatSessionInfo> {
    // Captured before the close, because closing clears it. A deliberate new
    // provider session is over whatever is open now; asking the caller to name a
    // path again would make it a way of opening something else.
    const openBeforeClose = this.session;
    await this.closeSession();

    let workspacePath: string;
    let workspaceOrigin: string;
    let origin: SessionOrigin;

    if (request.kind === 'new-provider-session') {
      if (openBeforeClose === null) {
        throw new Error(
          'No project is open, so there is nothing to continue in a new provider ' +
            'session. Open a project first.',
        );
      }
      // Nothing is generated, chosen or validated again: the same working copy,
      // described the way it was described when it was opened.
      workspacePath = openBeforeClose.workspacePath;
      workspaceOrigin = openBeforeClose.workspaceOrigin;
      origin = openBeforeClose.origin;
    } else if (request.kind === 'sample') {
      origin = 'generated-sample';
      workspacePath = this.allocateSampleWorkspacePath();
      fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
      const generated = generateExperimentRepo(workspacePath, this.options.repoRoot);
      workspaceOrigin =
        `generated by DSpatch (${String(generated.files.length)} files, git commit ` +
        `${generated.gitCommit ?? 'none'}) in a folder of its own outside the ` +
        'DSpatch repository. Earlier sample projects are left alone; removing them ' +
        'is a separate action in the Project menu.';
    } else {
      origin = 'chosen-folder';
      workspacePath = this.validateProjectFolder(request.path);
      workspaceOrigin =
        'chosen by you. DSpatch did not create, move or delete anything in it.';
    }

    const git = readGitWorkingCopyState(workspacePath);
    const gitInfo: GitBaselineInfo = {
      isGitRepository: git.isGitRepository,
      topLevel: git.topLevel,
      headRevision: git.headRevision,
      branch: git.branch,
      dirtyFiles: toDirtyFileInfo(git.dirtyFiles),
      error: git.error,
      gitVersion: git.gitVersion,
      observedAtUtc: git.observedAtUtc,
    };
    this.dirtyFilesAtStart = gitInfo.dirtyFiles;
    this.dirtyAtStart = new Set(
      gitInfo.dirtyFiles.flatMap((file) =>
        file.previousRelPath === null
          ? [file.relPath]
          : [file.relPath, file.previousRelPath],
      ),
    );

    // With retention: the baseline keeps the bytes, not only their hashes,
    // because the diff in AC#7 has to be against the content the session started
    // from and that content stops existing the moment the agent writes over it.
    const baseline = snapshotWorkspace(
      workspacePath,
      DEFAULT_SNAPSHOT_LIMITS,
      DEFAULT_RETENTION_LIMITS,
    );
    this.baseline = baseline;
    const conversationId = this.adoptConversationFor(workspacePath, baseline);
    this.runner = resolveNodeRunner();
    const suggestion = suggestBuildCommand(workspacePath, this.runner?.path ?? null);

    const adapter = this.ensureAdapter();
    const config: SessionConfig = {
      provider: 'cursor',
      modelRequested: this.modelRequested(),
      workspacePath,
    };
    const continued = await this.openProviderSession(
      adapter,
      config,
      conversationId,
      workspacePath,
      request.kind === 'new-provider-session',
    );
    const handle = continued.handle;
    this.continuity = continued.continuity;
    this.pendingResendContext = continued.continuity.contextToResend;

    this.unsubscribe = adapter.subscribe(handle.dspatchSessionId, (event) => {
      this.onAgentEvent(event);
    });

    const context: SessionContextInfo = {
      workingDirectorySent: workspacePath,
      modelSent: this.modelRequested(),
      toolPolicySent: 'provider-default',
      fileContentsSentByDspatch: 0,
      statement:
        'DSpatch sent the agent this working directory path, the model name and ' +
        'your prompt text. It read no file and uploaded no file content. Opening a ' +
        'project does not put it in front of the model: the agent reads files ' +
        'itself, as tool calls, and every tool call it makes is listed in the ' +
        'conversation. DSpatch sees the tool name but not which file it touched, ' +
        'so the files on disk are the evidence for what changed.',
    };

    const session: ChatSessionInfo = {
      conversationId,
      dspatchSessionId: handle.dspatchSessionId,
      providerSessionId: handle.providerSessionId,
      modelRequested: this.modelRequested(),
      workspacePath,
      createdAt: handle.createdAt,
      toolPolicy: 'provider-default',
      origin,
      workspaceOrigin,
      git: gitInfo,
      baseline: toBaselineInfo(baseline),
      context,
      continuity: continued.continuity,
      suggestedTestCommand: suggestion.command,
      suggestedTestCwd: suggestion.cwd,
      testCommandNote: suggestion.note,
      testRunnerPath: this.runner?.path ?? null,
      testRunnerSource: this.runner?.source ?? null,
      // What this project already had, so reopening it continues a conversation the
      // person can see rather than one only the file knows about.
      restoredHistory: this.openedHistory ?? {
        conversationId,
        messages: [],
        filePath: null,
        savedAtUtc: null,
        error: null,
      },
    };
    this.session = session;
    // Before the first prompt, so a window that is closed straight after opening a
    // project still leaves a conversation to come back to.
    this.saveConversation();
    this.options.log(
      `chat session ${session.dspatchSessionId} -> ${session.providerSessionId} ` +
        `workspace=${workspacePath} baseline=${baseline.snapshotId} ` +
        `files=${String(baseline.fileCount)} dirtyAtStart=${String(
          gitInfo.dirtyFiles.length,
        )} head=${gitInfo.headRevision ?? 'unknown'} ` +
        `continuity=${continued.continuity.kind} resend=${String(
          continued.continuity.contextToResend?.length ?? 0,
        )} chars`,
    );
    return session;
  }

  /**
   * Open the provider session, continuing the earlier one where that is possible.
   *
   * **Measured, not assumed.** A three-process probe established that Cursor's
   * `Agent.resume` does carry a session across process boundaries: an agent was
   * told a passphrase in one process and repeated it in another, and the same call
   * against an ID nothing had created was refused in 11 ms with
   * `AgentNotFoundError [agent_not_found]`. So a resume that succeeds is evidence
   * and not a silently fresh agent.
   *
   * The store behind it is Cursor's, under `~/.cursor/projects/<workspace>/`, keyed
   * by the working copy's path — a different store from DSpatch's conversation
   * file, on a different key, with a different lifetime. The two can therefore
   * disagree, which is why the fallback exists and why both branches say which one
   * happened rather than letting the window imply either.
   */
  private async openProviderSession(
    adapter: ChatAdapter,
    config: SessionConfig,
    conversationId: string,
    workspacePath: string,
    /**
     * Do not attempt a resume, because the user asked for a new provider session.
     *
     * The only caller that sets this is the way out of a session that holds an
     * unfinished run: resuming is precisely what lands back in it. This takes the
     * same branch as a refused resume — new agent, same conversation, recap
     * disclosed before it is sent — so the honest path is the existing one rather
     * than a second one written for this case.
     */
    newProviderSessionRequested = false,
  ): Promise<{
    readonly handle: SessionHandle;
    readonly continuity: SessionContinuity;
  }> {
    const saved = this.savedSessionFor(conversationId);
    const savedMessageCount = (this.carriedMessages.get(conversationId) ?? []).length;
    const previousId = saved?.dspatchSessionId ?? null;

    if (newProviderSessionRequested) {
      const handle = await adapter.startSession(config);
      const reason =
        previousId === null
          ? 'you asked for a new provider session'
          : `you asked for a new provider session rather than continuing ${previousId}`;
      const recap = buildResendContext({
        workspacePath,
        messages: this.carriedMessages.get(conversationId) ?? [],
        reviewedDiff: this.reviewedDiff,
        test: this.carriedTest,
        reason,
      });
      this.options.log(
        `new provider session requested; not resuming ${previousId ?? 'anything'}`,
      );
      return {
        handle,
        continuity: {
          kind: 'new-provider-session',
          attemptedDspatchSessionId: previousId,
          resumedProviderSessionId: null,
          resumeError: null,
          contextToResend: recap,
          contextNote: resendNote(recap, savedMessageCount),
          savedMessageCount,
          statement:
            'This is a new provider session, opened because you asked for one. ' +
            'DSpatch did not try to resume ' +
            `${previousId ?? 'the earlier session'}: whatever that session was ` +
            'doing, it is left alone rather than joined or repeated, and it may ' +
            'still be running on the provider\'s side. The model here has no memory ' +
            'of the conversation above. What it will be given is below, word for ' +
            'word, in front of your next message.',
        },
      };
    }

    if (previousId !== null && adapter.resume !== undefined) {
      try {
        const handle = await adapter.resume(previousId, config);
        return {
          handle,
          continuity: {
            kind: 'provider-session-resumed',
            attemptedDspatchSessionId: previousId,
            resumedProviderSessionId: handle.providerSessionId,
            resumeError: null,
            contextToResend: null,
            contextNote:
              'DSpatch resent nothing, because nothing needed resending: the ' +
              'provider still holds this session and the earlier turns are in its ' +
              'own store. That store is Cursor\'s, under your user profile and keyed ' +
              'by this project\'s path — a different place from the conversation file ' +
              'DSpatch writes. The two can drift apart: deleting one does not delete ' +
              'the other, and a conversation moved to another machine will come back ' +
              'as history with no provider session behind it.',
            savedMessageCount,
            statement:
              `The provider session ${previousId} was resumed, so this is the same ` +
              'agent you were talking to before, with the earlier turns in its own ' +
              'memory. That was checked by asking the provider for it, not assumed: ' +
              'resuming an agent the provider does not have is refused rather than ' +
              'silently starting a new one.',
          },
        };
      } catch (error) {
        const reason = describeError(error);
        this.options.log(`resume of ${previousId} refused: ${reason}`);
        const handle = await adapter.startSession(config);
        const recap = buildResendContext({
          workspacePath,
          messages: this.carriedMessages.get(conversationId) ?? [],
          reviewedDiff: this.reviewedDiff,
          test: this.carriedTest,
          reason,
        });
        return {
          handle,
          continuity: {
            kind: 'new-provider-session',
            attemptedDspatchSessionId: previousId,
            resumedProviderSessionId: null,
            resumeError: reason,
            contextToResend: recap,
            contextNote: resendNote(recap, savedMessageCount),
            savedMessageCount,
            statement:
              `This is a new provider session. DSpatch asked the provider to resume ` +
              `${previousId} and was refused: ${reason} The model therefore has no ` +
              'memory of the conversation above. What it will be given is below, ' +
              'word for word, in front of your next message.',
          },
        };
      }
    }

    const handle = await adapter.startSession(config);
    if (savedMessageCount === 0) {
      return {
        handle,
        continuity: {
          ...FIRST_SESSION_CONTINUITY,
          attemptedDspatchSessionId: previousId,
        },
      };
    }
    // A saved conversation with messages but no session to resume into: a file
    // carried from another machine, or one whose provider store has been cleared.
    const noSession =
      previousId === null
        ? 'this conversation has no earlier provider session recorded'
        : `this build cannot resume a session on the ${adapter.id} adapter`;
    const recap = buildResendContext({
      workspacePath,
      messages: this.carriedMessages.get(conversationId) ?? [],
      reviewedDiff: this.reviewedDiff,
      test: this.carriedTest,
      reason: noSession,
    });
    return {
      handle,
      continuity: {
        kind: 'new-provider-session',
        attemptedDspatchSessionId: previousId,
        resumedProviderSessionId: null,
        resumeError: noSession,
        contextToResend: recap,
        contextNote: resendNote(recap, savedMessageCount),
        savedMessageCount,
        statement:
          `This is a new provider session, because ${noSession}. The model has no ` +
          'memory of the conversation above. What it will be given is below, word ' +
          'for word, in front of your next message.',
      },
    };
  }

  /** How this session relates to the conversation's earlier one. */
  sessionContinuity(): SessionContinuity {
    return this.continuity;
  }

  /**
   * Check a chosen folder before anything is opened over it.
   *
   * Every message here names the path and what to do, because this is the first
   * thing a new user can get wrong and a bare `ENOENT` would not help them.
   */
  private validateProjectFolder(candidate: string): string {
    if (candidate.trim() === '') {
      throw new Error('No folder was chosen, so there is nothing to open.');
    }
    const resolved = path.resolve(candidate.trim());
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new Error(
        `There is no folder at ${resolved}. If it was moved or deleted, choose it ` +
          'again from its new location.',
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(`${resolved} is a file, not a folder. Choose the project folder.`);
    }
    try {
      fs.accessSync(resolved, fs.constants.R_OK);
    } catch {
      throw new Error(`${resolved} cannot be read with this account's permissions.`);
    }

    if (process.env['DSPATCH_ALLOW_OWN_REPO'] === '1') {
      return resolved;
    }
    // Two tests, both by content, and **nothing here reads a value that can be
    // configured**. `this.options.repoRoot` is deliberately absent: it is the
    // sample generator's and the DSP-1 probe's boundary, `DSPATCH_PROBE_REPO_ROOT`
    // can name it, and until 15 September 2026 a third refusal tested the chosen
    // folder against it. Verifier 004 measured what that cost — with the variable
    // pointed at an ordinary directory, an unrelated project inside it was refused
    // in a message saying it was inside DSpatch's own working copy, which it was
    // not, and which no user could act on. An environment variable must not decide
    // which folders this refuses, in either direction, and the walk below is what
    // decides it. Removing that test loses nothing the walk covers: a directory the
    // variable names is refused anyway when it really is DSpatch, by content, with
    // a message that can name the manifest it read.
    //
    // The first walks **up** from the chosen folder and asks each ancestor whether
    // it is DSpatch's own working copy. That is what makes `<repo>\app` refuse, and
    // it answers `undecidable` rather than "not DSpatch" when the manifest that
    // would say cannot be read — see `own-repository.ts` for both holes this closes
    // and the trade in the undecidable case.
    //
    // The second looks the other way, which is the direction the walk is blind to:
    // whether the chosen folder *contains* DSpatch. Choosing the parent directory
    // of a DSpatch clone reaches its source just as surely as choosing the clone,
    // and the walk from that parent goes upwards and never sees it. Its own root
    // comes from `ownRepositoryRoot()`, by content, for the same reason.
    const found = findOwnRepository(resolved);
    if (found.kind !== 'unrelated') {
      throw new Error(describeRefusal(resolved, found));
    }
    // The containing question is answered by identity rather than by spelling, so
    // it has a third outcome: a directory the filesystem will not identify leaves it
    // open, and an open question refuses here as it does for a manifest that cannot
    // be read. Verifier 007 opened the directory above DSpatch three ways — a UNC
    // path, an 8.3 short name and a junction — and the first two are what this
    // closes; the junction case is a stated limit, in `own-repository.ts`'s header
    // and in the README, because finding it needs a search downwards.
    const contains = ownRepositoryInside(resolved, this.options.ownRepoRoot ?? null);
    if (contains.kind === 'contains') {
      throw new Error(describeContainingRefusal(resolved, contains));
    }
    if (contains.kind === 'undecidable') {
      throw new Error(describeUndecidableContainment(resolved, contains));
    }
    return resolved;
  }

  /**
   * Send a prompt, unless an earlier attempt is unresolved.
   *
   * The gate is the first thing that happens, before the provider is touched. That
   * ordering is the point: when an earlier turn's outcome is unknown, DSpatch does
   * not start a second model job and then explain itself — it does not start one
   * at all until the caller names the attempt it has seen. Nothing automatic can
   * supply that name, so no retry, reconnection or repeated click can duplicate
   * work that may still be going.
   *
   * `acknowledgedAttemptIds` is how the window proceeds anyway, which the user must
   * be able to do: the earlier trap in this project was a window that could no
   * longer send anything. Every unresolved attempt has to be named, and each one
   * stays recorded as unresolved afterwards.
   */
  async sendPrompt(
    prompt: string,
    acknowledgedAttemptIds: readonly string[] = [],
  ): Promise<{ readonly dspatchRunId: string }> {
    const { adapter, session } = this.requireSession();
    if (prompt.trim() === '') {
      throw new Error('An empty prompt is not sent.');
    }
    const decision = this.ledger.mayRepeat('agent-turn', acknowledgedAttemptIds);
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    for (const attemptId of acknowledgedAttemptIds) {
      this.ledger.acknowledge(
        attemptId,
        `A new message was sent with this attempt left unresolved. ${decision.reason}`,
      );
    }
    // A cancellation watch that is still running belongs to the run that was
    // cancelled, and its verdict is the only thing that can distinguish "the
    // provider stopped" from "DSpatch stopped listening". Clearing it because a
    // follow-up was sent would destroy that answer while it was being measured.
    if (!this.cancelState.watching) {
      this.cancelState = emptyCancelState();
    }
    this.terminalSeenForTurn = false;
    // `run.started` is emitted while `send` is still pending, so the turn record
    // is created by the event handler. The prompt is left here for it to pick up.
    this.pendingPrompt = prompt;
    // What actually goes to the provider. When the earlier provider session could
    // not be resumed, the model has been told nothing, so DSpatch's own record of
    // the conversation goes in front of the first message. The user's text is kept
    // separate everywhere it is displayed or saved: the recap is DSpatch talking,
    // not something the user wrote.
    const resent = this.pendingResendContext;
    this.pendingResentContext = resent;
    const sentText = resent === null ? prompt : `${resent}\n\n${prompt}`;
    const attempt = this.ledger.open('agent-turn', promptLabel(prompt));
    this.pendingAttemptId = attempt.attemptId;
    this.claimAttempt(attempt.attemptId);
    // Before the send, not after it. An attempt that never reached the disk cannot be
    // reconciled as an unknown outcome after a restart, and a send that is interrupted
    // between here and the provider's answer is exactly the case AC#3 is about.
    this.saveConversation();
    this.options.log(
      `${attempt.attemptId}: sending a message` +
        (resent === null
          ? ''
          : ` with ${String(resent.length)} characters of resent conversation record`),
    );
    try {
      const reference = await adapter.send(session.dspatchSessionId, sentText);
      // Only once the provider has taken it. A send that was refused resent
      // nothing, so the next attempt must carry the recap again.
      this.pendingResendContext = null;
      this.attemptByRunId.set(reference.dspatchRunId, attempt.attemptId);
      if (this.abandonedAttempts.has(attempt.attemptId)) {
        // The window stopped waiting while this was pending, and then a run turned
        // out to exist after all. It is asked to stop immediately: an abandoned
        // send must not leave a turn nobody is watching.
        await this.stopAbandonedRun(attempt.attemptId, reference.dspatchRunId);
      }
      return reference;
    } catch (error) {
      const message = describeError(error);
      this.ledger.markFailed(
        attempt.attemptId,
        `The provider refused the message: ${message}`,
      );
      if (saysSessionAlreadyHasARun(message)) {
        throw new Error(
          `${message} ${this.explainSessionHoldsARun(session.dspatchSessionId, adapter)}`,
        );
      }
      throw error;
    } finally {
      if (this.pendingAttemptId === attempt.attemptId) {
        this.pendingAttemptId = null;
      }
      // The event handler picks this up when `run.started` is emitted, which the
      // adapter does inside `send` before it awaits the provider. Clearing it here
      // keeps a send that threw before any run existed from attaching its recap to
      // somebody else's turn.
      this.pendingResentContext = null;
    }
  }

  /**
   * What to say when a session refuses a message because it already holds a run.
   *
   * Two situations wear the same sentence from two different layers, and report 008
   * measured that the guidance written here fitted only one of them — the rarer
   * one. Which it is comes from the adapter's own state rather than from the words:
   * either DSpatch is holding the run and will see it end, or the provider is
   * holding one DSpatch never subscribed to and will never see end.
   *
   * The second is the restarted user's case, and it is the one where the old advice
   * was actively wrong twice over: waiting watches a panel that will never report
   * anything, and re-opening the project resumes the same session and is refused
   * again. So it names the only thing that is a way on.
   *
   * Verifier 004 read the first text on screen beside the renderer's note saying
   * that waiting is not known to help, and the window contradicted itself in one
   * place. The two claims are about two different runs, and the difference is
   * exactly whether DSpatch is subscribed — so each says which case it is about
   * rather than one of them being softened. What is gone is "that end often arrives
   * within a few seconds": nobody measured it, and the two things that were
   * measured are both about the other branch.
   *
   * There is a race here, and it is the harmless direction. If a run of ours ends
   * between the refusal and this reading, the second text is used for a case that
   * was really the first: the user is offered a new session when simply sending
   * again would have worked. The block also clears itself once nothing is
   * unresolved (`failureHasResolved`), so the cost of being wrong this way is a
   * message that stops being needed, not a message that misleads.
   */
  private explainSessionHoldsARun(sessionId: string, adapter: ChatAdapter): string {
    if (adapter.hasActiveRun?.(sessionId) === true) {
      return (
        'The previous run was asked to stop but has not reported an end, so this ' +
        'session still holds it. This is a run DSpatch started and is subscribed ' +
        'to, so it does see the end when it arrives: "Execution state" below ' +
        'reports it, the block above stops applying, and sending works again then. ' +
        'How long that takes has not been measured, so nothing here promises a ' +
        'short wait — and the measurements shown beside this message are about the ' +
        'other situation, a run DSpatch never subscribed to, which this is not. If ' +
        'the end never arrives, continue in a new provider session: this ' +
        'conversation stays on screen, the files on disk are unaffected, and ' +
        'DSpatch shows you what it would put in front of your next message before ' +
        'sending anything.'
      );
    }
    return (
      'That run is not one this window started. It belongs to the provider session ' +
      'this conversation was resumed into, which was left holding an unfinished run ' +
      '— DSpatch being closed while an answer was still arriving is the usual way ' +
      'that happens. DSpatch never subscribed to that run, so it cannot tell you ' +
      'whether or when it ends, and "Execution state" below will not show it. ' +
      'Waiting is therefore not the way out of this, and neither is opening the ' +
      'project again: that resumes the same session and is refused in the same ' +
      'words. Continue in a new provider session instead. This conversation, the ' +
      'diff you reviewed and every file on disk stay exactly as they are, the run ' +
      'that is in the way is left alone rather than repeated, and DSpatch shows you ' +
      'the record it will put in front of your next message before it sends it.'
    );
  }

  /**
   * Stop waiting for a send that has not produced a run.
   *
   * Cancel needs a run, and report 003 measured 11–12 s before the first text
   * arrived, so there is a real interval in which the window's only button does
   * nothing. This is that interval's way out.
   *
   * It does not claim anything stopped. If a run already exists, the provider is
   * asked to cancel it — the ordinary path. If none does, the attempt becomes
   * `outcome-unknown`, and it is remembered so that a run appearing afterwards is
   * cancelled rather than left going unobserved.
   */
  async abandonSend(): Promise<AbandonOutcome> {
    // `pendingAttemptId` is the precise question, and it is not the same as the
    // attempt's state. The adapter announces `run.started` immediately, before it
    // has a cancellable run object of its own — so between Send and the provider's
    // reply the window can show a run that `cancel()` cannot touch, which is the
    // gap report 003 described. While the send is pending, DSpatch therefore does
    // not attempt a cancellation that would certainly fail: it records the
    // abandonment and cancels the run the moment one is actually available.
    const pendingAttemptId = this.pendingAttemptId;
    const waiting =
      pendingAttemptId === null
        ? [...this.ledger.unresolved('agent-turn')]
            .reverse()
            .find(
              (attempt) => attempt.state === 'waiting' || attempt.state === 'running',
            )
        : (this.ledger.get(pendingAttemptId) ?? undefined);
    if (waiting === undefined) {
      return {
        cancelledRun: false,
        attemptId: null,
        state: null,
        note:
          'Nothing was waiting to start, so there was nothing to stop waiting ' +
          'for. Anything already running is shown with its own state.',
      };
    }
    if (pendingAttemptId === null && waiting.providerRunId !== null) {
      const outcome = await this.cancelRun();
      return {
        cancelledRun: true,
        attemptId: waiting.attemptId,
        state: this.ledger.get(waiting.attemptId)?.state ?? null,
        note:
          `A run did exist for ${waiting.attemptId}, so it was asked to cancel ` +
          `instead (the request resolved in ${String(outcome.elapsedMs)} ms). ` +
          'Whether the provider stopped is a separate question, shown below.',
      };
    }
    this.abandonedAttempts.add(waiting.attemptId);
    this.ledger.markOutcomeUnknown(
      waiting.attemptId,
      'You stopped waiting for this message before the provider had replied to it. ' +
        'DSpatch cannot tell how far it got, so this outcome is unknown rather ' +
        'than cancelled. As soon as a run for it can be cancelled, DSpatch asks ' +
        'the provider to cancel it, and what happens then is recorded here.',
    );
    this.options.log(`${waiting.attemptId}: send abandoned before any run started`);
    return {
      cancelledRun: false,
      attemptId: waiting.attemptId,
      state: 'outcome-unknown',
      note:
        'DSpatch stopped waiting for it. Your message text is still in the box, ' +
        'and nothing has been claimed about whether the provider received it.',
    };
  }

  private async stopAbandonedRun(attemptId: string, runId: string): Promise<void> {
    const session = this.session;
    const adapter = this.adapter;
    this.abandonedAttempts.delete(attemptId);
    if (session === null || adapter === null) {
      return;
    }
    this.ledger.markCancelRequested(
      attemptId,
      `A run (${runId}) started after you stopped waiting, so DSpatch asked the ` +
        'provider to cancel it. That request has not been confirmed yet.',
    );
    try {
      await adapter.cancel(session.dspatchSessionId);
      this.armCancelConfirmation(attemptId);
    } catch (error) {
      this.ledger.markOutcomeUnknown(
        attemptId,
        `A run (${runId}) started after you stopped waiting, and the request to ` +
          `cancel it failed: ${describeError(error)}`,
      );
    }
  }

  async cancelRun(): Promise<CancelOutcome> {
    const { adapter, session } = this.requireSession();
    const requestedAtUtc = nowIso();
    const startedAt = performance.now();
    const attempt = [...this.ledger.unresolved('agent-turn')]
      .reverse()
      .find(
        (entry) => entry.state === 'running' || entry.state === 'waiting',
      );
    if (attempt !== undefined) {
      this.ledger.markCancelRequested(
        attempt.attemptId,
        `Cancellation requested at ${requestedAtUtc}. The request returning is not ` +
          'an ending: substep 6 measured cancel() resolving in single-digit ' +
          'milliseconds, far too fast to contain a round trip, so the terminal ' +
          'state is decided locally. DSpatch is waiting for something that ' +
          'confirms an end.',
      );
    }
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
    if (attempt !== undefined) {
      if (error === null) {
        this.armCancelConfirmation(attempt.attemptId);
      } else {
        // A cancellation that could not even be requested leaves the run in
        // whatever state it was in. That is unknown, not stopped.
        this.ledger.markOutcomeUnknown(
          attempt.attemptId,
          `The cancellation request itself failed: ${error} Whether the run is ` +
            'still going is unknown.',
        );
      }
    }
    if (error === null) {
      void this.watchAfterCancel();
    }
    return {
      requestedAtUtc,
      elapsedMs,
      error,
      watchSeconds: this.cancelWatchMs / 1000,
    };
  }

  /**
   * Give a requested cancellation a bounded time to be confirmed.
   *
   * When it expires with nothing confirmed, the attempt moves to
   * `outcome-unknown`. That is what closes the hole report 003 left open: the
   * one-run invariant after a cancel that never ends no longer depends on the
   * provider being prompt, because DSpatch stops assuming an ending and refuses to
   * start a second turn until the state has been seen.
   *
   * `unref` so a pending confirmation never holds the process open.
   */
  private armCancelConfirmation(attemptId: string): void {
    const timer = setTimeout(() => {
      const current = this.ledger.get(attemptId);
      if (current === null || current.state !== 'cancel-requested') {
        return;
      }
      const seconds = Math.round(this.cancelConfirmMs / 1000);
      this.ledger.markOutcomeUnknown(
        attemptId,
        `No terminal event arrived within ${String(seconds)} s of the ` +
          'cancellation, and the two cancellations that have been measured here ' +
          'reported an end in about 50 ms. So this run\'s ending cannot be ' +
          'established. It is not being treated as stopped, and DSpatch will not ' +
          'start another message by itself while it stands.',
      );
      this.options.log(
        `${attemptId}: no terminal event within ${String(seconds)} s of cancellation; ` +
          'outcome recorded as unknown',
      );
    }, this.cancelConfirmMs);
    timer.unref?.();
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
   * Run the command from the window as a child of the main process.
   *
   * DSpatch starts it, so the exit code and the output belong to DSpatch rather
   * than to a model's description of a tool call. The command text comes from
   * the window and is interpreted by the platform shell, which is what makes
   * `npm test`, `cargo test` and `make` work without DSpatch knowing anything
   * about them. The shell is named in the outcome rather than left implied.
   *
   * Both snapshots matter. The one before the process starts is the code the
   * result describes; the one after it finishes is what the result is compared
   * against later, because a command that writes into its own working copy would
   * otherwise mark itself stale the instant it finished.
   */
  async runWorkspaceTest(request: TestRunRequest): Promise<TestOutcome> {
    const session = this.session;
    if (session === null) {
      throw new Error('No session is open, so there is no working copy to run in.');
    }
    if (this.activeTest !== null) {
      throw new Error(
        'A command is already running in this working copy. Stop it first: two at ' +
          'once would interleave their output and their file writes.',
      );
    }
    // The same rule as for a message, for the same reason. A command whose outcome
    // is unknown may still hold the working directory — on Windows that also
    // prevents the folder from being replaced — so running it again is not a
    // neutral act and is not done on DSpatch's own initiative.
    const acknowledged = request.acknowledgedAttemptIds ?? [];
    const decision = this.ledger.mayRepeat('command', acknowledged);
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    for (const attemptId of acknowledged) {
      this.ledger.acknowledge(
        attemptId,
        `The command was run again with this attempt left unresolved. ${decision.reason}`,
      );
    }
    const command = request.command.trim();
    const cwd = path.resolve(
      request.cwd.trim() === '' ? session.workspacePath : request.cwd.trim(),
    );
    const check = checkRunRequest(command, cwd);
    if (!check.ok) {
      throw new Error(check.message ?? 'The command could not be run.');
    }

    const shell = describeShell();
    const beforeSnapshotId = this.safeSnapshotId();
    const startedAtUtc = nowIso();
    const startedAt = performance.now();
    this.testKillRequested = false;

    const attempt = this.ledger.open('command', command);
    this.activeCommandAttemptId = attempt.attemptId;
    this.claimAttempt(attempt.attemptId);
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    this.activeTest = child;
    this.ledger.markRunning(
      attempt.attemptId,
      { localPid: child.pid ?? null },
      `Started as pid ${String(child.pid ?? -1)} in ${cwd}, against ` +
        `${beforeSnapshotId ?? 'an unhashed working copy'}.`,
    );
    this.options.log(
      `${attempt.attemptId}: running \`${command}\` in ${cwd} ` +
        `(pid ${String(child.pid ?? -1)}) against ` +
        `${beforeSnapshotId ?? 'an unhashed working copy'}`,
    );
    // While it runs, so that killing the window mid-command leaves a `running`
    // attempt on disk to reconcile rather than no trace of the command at all.
    this.saveConversation();

    let stdout = '';
    let stderr = '';
    let outputTruncated = false;
    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= MAX_OUTPUT_CHARS) {
        outputTruncated = true;
        return current;
      }
      const next = current + chunk.toString('utf8');
      if (next.length > MAX_OUTPUT_CHARS) {
        outputTruncated = true;
        return next.slice(0, MAX_OUTPUT_CHARS);
      }
      return next;
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const ended = await new Promise<{
      code: number | null;
      signal: string | null;
      error: string | null;
    }>((resolve) => {
      let settled = false;
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        resolve({ code: null, signal: null, error: describeError(error) });
      });
      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        resolve({ code, signal: signal === null ? null : String(signal), error: null });
      });
    });

    const durationMs = round(performance.now() - startedAt);
    this.activeTest = null;
    this.activeCommandAttemptId = null;
    if (ended.error !== null) {
      this.testKillRequested = false;
      this.ledger.markFailed(
        attempt.attemptId,
        `The command could not be started: ${ended.error}`,
      );
      throw new Error(
        `The command could not be started: ${ended.error}. DSpatch reports no exit ` +
          'code for a process that never ran.',
      );
    }

    const killedByDspatch = this.testKillRequested;
    const verdict = evaluateTestVerdict({
      killedByDspatch,
      exitCode: ended.code,
      signal: ended.signal,
    });
    const outcome: TestOutcome = {
      command,
      shell,
      cwd,
      pid: child.pid ?? null,
      exitCode: ended.code,
      signal: ended.signal,
      killedByDspatch,
      stdout,
      stderr,
      outputTruncated,
      durationMs,
      startedAtUtc,
      finishedAtUtc: nowIso(),
      snapshotId: beforeSnapshotId,
      afterRunSnapshotId: this.safeSnapshotId(),
      baselineSnapshotId: session.baseline.snapshotId,
      gitHeadRevision: session.git.headRevision,
      verdict: verdict.verdict,
      verdictHeadline: verdict.headline,
      attemptId: attempt.attemptId,
    };
    this.testKillRequested = false;
    this.lastTest = outcome;
    this.testRuns.push(outcome);
    this.recordConversationTest(outcome);
    // The attempt's state follows the verdict, not the exit code. A run DSpatch
    // killed is recorded as stopped rather than completed, and one that ended
    // without an exit code is recorded as unknown, so the attempt list cannot
    // disagree with the result panel about whether anything was established.
    const ending =
      `Exit code ${ended.code === null ? 'none' : String(ended.code)}, signal ` +
      `${ended.signal ?? 'none'}, after ${String(durationMs)} ms. ${verdict.headline}`;
    if (verdict.verdict === 'interrupted') {
      this.ledger.markStopped(attempt.attemptId, ending);
    } else if (verdict.verdict === 'unknown') {
      this.ledger.markOutcomeUnknown(attempt.attemptId, ending);
    } else {
      this.ledger.markCompleted(attempt.attemptId, ending);
    }
    this.options.log(
      `${attempt.attemptId}: command exit=${String(outcome.exitCode)} ` +
        `signal=${outcome.signal ?? 'none'} killed=${String(outcome.killedByDspatch)} ` +
        `verdict=${outcome.verdict} in ${String(outcome.durationMs)} ms ` +
        `snapshot=${outcome.snapshotId ?? 'unknown'} -> ${
          outcome.afterRunSnapshotId ?? 'unknown'
        }`,
    );
    this.saveConversation();
    return outcome;
  }

  /**
   * Note which conversation an attempt belongs to.
   *
   * The ledger outlives a session on purpose — an unresolved attempt has to stay
   * visible after the session that made it is gone — so within one process it holds
   * attempts from every project opened. This is what keeps one project's prompts out
   * of another project's file.
   */
  private claimAttempt(attemptId: string): void {
    if (this.conversationId !== null) {
      this.attemptConversation.set(attemptId, this.conversationId);
      this.liveConversations.add(this.conversationId);
    }
  }

  /** Keep a finished command with the conversation it was run in, then save it. */
  private recordConversationTest(outcome: TestOutcome): void {
    const conversationId = this.conversationId;
    if (conversationId === null) {
      return;
    }
    const runs = this.conversationTestRuns.get(conversationId) ?? [];
    runs.push(outcome);
    this.conversationTestRuns.set(conversationId, runs);
  }

  /** Stop a running command from the window, with its whole process tree. */
  stopRunningCommand(): { readonly stopped: boolean; readonly note: string } {
    if (this.activeTest === null) {
      return {
        stopped: false,
        note: 'No command was running, so nothing was stopped.',
      };
    }
    this.testKillRequested = true;
    this.stopWorkspaceTest();
    return {
      stopped: true,
      note:
        'DSpatch killed the command and its child processes. Whatever it had ' +
        'already written to disk is still there, and its output below is only what ' +
        'had arrived — it is not a result.',
    };
  }

  /**
   * Whether the last recorded result still describes the code on disk.
   *
   * This re-hashes the working copy, so it is not free; `durationMs` is returned
   * so the caller can decide how often to ask.
   */
  getTestFreshness(): TestFreshness {
    const startedAt = performance.now();
    const last = this.lastTest;
    const checkedAtUtc = nowIso();
    const currentSnapshotId = last === null ? null : this.safeSnapshotId();
    const verdict = evaluateFreshness({
      hasResult: last !== null,
      testedSnapshotId: last?.snapshotId ?? null,
      afterRunSnapshotId: last?.afterRunSnapshotId ?? null,
      currentSnapshotId,
    });
    // Two questions answered in one place: did the command establish anything, and
    // does that still apply. The window renders the answer and computes neither,
    // so there is no code path in the renderer that can arrive at "passed".
    const presented = presentTestStatus(last?.verdict ?? null, verdict.kind);
    return {
      kind: verdict.kind,
      testedSnapshotId: last?.snapshotId ?? null,
      afterRunSnapshotId: last?.afterRunSnapshotId ?? null,
      currentSnapshotId,
      commandChangedWorkspace: verdict.commandChangedWorkspace,
      headline: verdict.headline,
      checkedAtUtc,
      durationMs: round(performance.now() - startedAt),
      presentedStatus: presented.status,
      presentedHeadline: presented.headline,
    };
  }

  // --- Saved conversations (DSP-4) -------------------------------------------

  /** The saved conversations, as summaries. `null` when nothing is being saved. */
  listConversations(): ConversationListing | null {
    return this.options.conversations?.()?.list() ?? null;
  }

  /** The conversation the current work belongs to, if any. */
  currentConversationId(): string | null {
    return this.conversationId;
  }

  /** The last save failure, so the window can say the work is not on disk. */
  saveError(): string | null {
    return this.lastSaveError;
  }

  /**
   * Whether the conversation on screen reached the disk. **Reading only.**
   *
   * The failure has been recorded here since DSP-4 and had no way out of the main
   * process, so a conversation that could not be written was reported to the log and
   * to nobody — and the next restart then opened an older version of the work with
   * nothing said about why. This is the way out; it saves nothing and retries
   * nothing.
   */
  conversationSaveStatus(): ConversationSaveStatus {
    const conversationId = this.conversationId;
    const store = this.options.conversations?.() ?? null;
    return {
      conversationId,
      filePath:
        conversationId === null || store === null
          ? null
          : store.filePathFor(conversationId),
      error: this.lastSaveError,
    };
  }

  /**
   * Read a saved conversation back.
   *
   * The whole of DSP-4's "restore history, never activity" lives in what this method
   * does **not** do. It opens no provider session, spawns no process, applies no
   * patch and writes nothing into the working copy — the only disk access is reading
   * the conversation file and hashing the project to find out whether the saved
   * results still describe it. There is no session handle in the result, so nothing
   * downstream can mistake restored history for a live connection.
   *
   * The unresolved attempts go through the same ledger as everything else, which is
   * what makes the reconciliation real: after this, `sendPrompt` and
   * `runWorkspaceTest` refuse until the caller names the attempt, exactly as they do
   * after a cancellation that never reported an end.
   */
  async resumeConversation(conversationId: string): Promise<RestoredConversation> {
    const store = this.options.conversations?.() ?? null;
    if (store === null) {
      throw new Error(
        'This build is not saving conversations, so there is nothing to restore. ' +
          'Nothing has been lost that was ever written down.',
      );
    }
    // Closing first saves whatever is open, so restoring one conversation cannot
    // discard another. It also makes the restored state the only thing on screen.
    await this.closeSession();

    const result = store.read(conversationId);
    const conversation = result.conversation;
    if (conversation === null) {
      throw new Error(
        result.error ??
          `There is no saved conversation called ${conversationId}. Nothing was ` +
            'changed and the file, if there is one, has been left as it is.',
      );
    }

    const adopted = this.adoptSaved(conversation);
    const reconciliations = adopted.reconciliations;
    const projectExists = directoryExists(conversation.project.path);
    // One hash of the project, shared by the result and the diff below, so both
    // statements are about the same observed content rather than two readings.
    const currentSnapshotId = projectExists
      ? safeSnapshotIdOf(conversation.project.path)
      : null;

    this.carriedTest = pickLastTest(conversation);
    const testResult = this.describeRestoredTest(this.carriedTest, currentSnapshotId);
    const restoredDiff = describeRestoredDiff(conversation.reviewedDiff, currentSnapshotId);
    const runState = this.ledger.report();

    this.options.log(
      `resumed conversation ${conversationId}: messages=${String(
        conversation.messages.length,
      )} attempts=${String(conversation.attempts.length)} reconciled=${String(
        reconciliations.length,
      )} project=${conversation.project.path} snapshot=${currentSnapshotId ?? 'unreadable'}`,
    );

    return {
      conversationId,
      filePath: result.filePath,
      formatVersion: conversation.formatVersion,
      createdAtUtc: conversation.createdAtUtc,
      savedAtUtc: conversation.savedAtUtc,
      project: {
        path: conversation.project.path,
        exists: projectExists,
        gitAtSave: conversation.project.git,
      },
      session: conversation.session,
      messages: conversation.messages,
      attempts: this.ledger
        .all()
        .filter(
          (attempt) => this.attemptConversation.get(attempt.attemptId) === conversationId,
        ),
      reconciliation: {
        attempts: reconciliations,
        needsAcknowledgement: runState.needsAcknowledgement,
        note: describeReconciliation(reconciliations),
        repeated: {
          providerRuns: 0,
          commands: 0,
          workspaceWrites: 0,
          note:
            'Restoring read a file and hashed your project. It started no model run, ' +
            'ran no command and wrote nothing into the working copy. The saved diff ' +
            'is a record of what was reviewed, not a patch — DSpatch has no code ' +
            'path that applies one.',
        },
      },
      testResult,
      reviewedDiff: restoredDiff,
      statement: restoreStatement(conversation, projectExists, restoredDiff, testResult),
      readOnly: result.readOnly,
      error: joinErrors(result.error, adopted.note),
    };
  }

  /**
   * Take a saved conversation as the current one, reconciling its open attempts.
   *
   * Only one conversation is held from disk at a time. Reading a second one back
   * releases the first's attempts from the ledger — they are a view of a file that
   * still holds them, and per-window attempt numbering means two conversations would
   * otherwise collide on `dsp-attempt-0001`. This process's own attempts are never
   * touched by that.
   */
  private adoptSaved(conversation: StoredConversation): {
    readonly reconciliations: readonly AttemptReconciliation[];
    /** What could not be adopted, in words, or `null` when everything was. */
    readonly note: string | null;
  } {
    const conversationId = conversation.conversationId;
    const previous = this.restoredConversationId;
    if (previous !== null && previous !== conversationId) {
      const dropped = this.ledger.dropRestored();
      this.carriedMessages.delete(previous);
      this.conversationTestRuns.delete(previous);
      this.restoredConversationId = null;
      this.options.log(
        `released ${String(dropped)} attempts read back from ${previous}; they remain ` +
          'in that conversation\'s file',
      );
    }

    const outcome = this.ledger.restore(conversation.attempts);
    for (const attempt of conversation.attempts) {
      this.attemptConversation.set(attempt.attemptId, conversationId);
    }
    this.restoredConversationId = conversationId;

    this.conversationId = conversationId;
    this.conversationProjectPath = conversation.project.path;
    this.conversationCreatedAtUtc = conversation.createdAtUtc;
    this.carriedMessages.set(conversationId, conversation.messages);
    this.conversationTestRuns.set(conversationId, [...conversation.testRuns]);
    this.carriedBaseline = conversation.baseline;
    this.storedBaseline = null;
    this.reviewedDiff = conversation.reviewedDiff;
    this.carriedTest = pickLastTest(conversation);
    // The body on disk was written by an earlier process, so this one has nothing to
    // compare against and must not assume its first save is redundant.
    this.lastSavedBody = null;

    return {
      reconciliations: outcome.reconciliations,
      note:
        outcome.skippedAttemptIds.length === 0
          ? null
          : `${String(outcome.skippedAttemptIds.length)} attempt${
              outcome.skippedAttemptIds.length === 1 ? '' : 's'
            } in this file (${outcome.skippedAttemptIds.join(', ')}) could not be read ` +
            'back, because this window already has attempts with those IDs from work ' +
            'in another project — attempts are numbered per window, so two ' +
            'conversations can use the same numbers. Their saved states are in the ' +
            'file and are unchanged. DSpatch will not merge two different pieces of ' +
            'work under one ID: to reconcile these, read this conversation back in a ' +
            'freshly started DSpatch.',
    };
  }

  /**
   * Decide which conversation the opening session's work belongs to.
   *
   * A project that has been worked on before continues its own conversation, so
   * opening the project directly cannot lose the history or quietly skip an
   * unresolved attempt that pressing *Continue* would have shown. A conversation
   * this window already holds — because work was done in it, or because it was read
   * back a moment ago — is taken as it is in memory: the file is a copy of that, and
   * reading it again would raise the same unknown outcomes a second time.
   */
  private adoptConversationFor(workspacePath: string, baseline: WorkspaceSnapshot): string {
    const store = this.options.conversations?.() ?? null;
    const known =
      this.conversationId !== null &&
      this.conversationProjectPath !== null &&
      samePath(this.conversationProjectPath, workspacePath)
        ? this.conversationId
        : (this.options.conversationForProject?.(workspacePath) ?? null);
    const inMemory =
      known !== null &&
      (this.liveConversations.has(known) || this.restoredConversationId === known);
    // The whole read is kept, not just the conversation in it: a file that exists and
    // could not be parsed is the one case where the window must say so rather than
    // draw the empty thread that a genuinely new conversation gets.
    const read =
      known === null || inMemory || store === null ? null : store.read(known);
    const saved = read?.conversation ?? null;

    if (saved !== null && samePath(saved.project.path, workspacePath)) {
      const adopted = this.adoptSaved(saved);
      if (adopted.note !== null) {
        this.options.log(`[conversation] ${adopted.note}`);
      }
    } else if (inMemory && known !== null) {
      this.conversationId = known;
      this.conversationProjectPath = workspacePath;
    } else {
      this.conversationId = known ?? newConversationId();
      this.conversationProjectPath = workspacePath;
      this.conversationCreatedAtUtc = nowIso();
      this.carriedBaseline = null;
      this.carriedTest = null;
      this.reviewedDiff = null;
      this.lastSavedBody = null;
    }
    // A result read back from disk becomes this session's last result, so the
    // freshness rule applies it to the code that is on disk now. That is the point:
    // the restart must not be a way for an old pass to look like a current one.
    if (this.carriedTest !== null) {
      this.lastTest = this.carriedTest;
    }
    // Once per session, from the snapshot the session was actually started against.
    // Rebuilding it later would silently redefine what "since the session started"
    // means, which is the one thing a baseline may not do.
    this.storedBaseline =
      store === null ? null : this.buildStoredBaseline(baseline, store);
    const conversationId = this.conversationId ?? newConversationId();
    this.openedHistory = this.historyFor(conversationId, store, read);
    return conversationId;
  }

  /**
   * The conversation's earlier messages, for the window to draw.
   *
   * Assembled by the same rule the save uses, so what comes back on screen is what
   * the file holds: the messages read from disk, plus anything this window has
   * already done in the same conversation, one entry per run. A window that opens
   * the same project twice must not show its own turns a second time, which is the
   * identical overlap {@link mergeConversationMessages} exists for.
   *
   * Nothing here resumes anything. The provider session is decided by
   * {@link continueProviderSession} and reported in `continuity`; this is the text,
   * and the window says which is which.
   */
  private historyFor(
    conversationId: string,
    store: ConversationStore | null,
    read: ConversationReadResult | null,
  ): RestoredHistory {
    const messages = mergeConversationMessages(
      this.carriedMessages.get(conversationId) ?? [],
      this.turns
        .filter((turn) => turn.conversationId === conversationId)
        .map((turn) => toStoredMessage(turn)),
    );
    return {
      conversationId,
      messages,
      filePath: store?.filePathFor(conversationId) ?? null,
      savedAtUtc: read?.conversation?.savedAtUtc ?? null,
      // A file that could not be read is the one case where an empty thread is not
      // the same as an empty conversation, so it is said rather than drawn as none.
      error: read?.error ?? null,
    };
  }

  /**
   * Save the current conversation.
   *
   * Called after everything that changes what happened: a project opening, a run
   * starting or ending, a command starting or ending, a diff being produced, and a
   * session closing. A run *starting* matters as much as one ending — an attempt that
   * was never written down as `running` cannot be reconciled as unknown after a
   * restart, and that reconciliation is the point of AC#3.
   *
   * Failures are recorded and swallowed. The work on screen is real whether or not it
   * reached the disk, and the window says so through {@link saveError}.
   */
  private saveConversation(): void {
    const store = this.options.conversations?.() ?? null;
    const conversationId = this.conversationId;
    if (store === null || conversationId === null) {
      return;
    }
    const record = this.buildConversation(conversationId);
    if (record === null) {
      return;
    }
    // A save is attempted on many events and most of them change nothing that is
    // written down. Comparing bodies keeps the disk quiet without maintaining a
    // second idea of what has changed. `savedAtUtc` is excluded from the comparison
    // for exactly that reason: it changes on every call by construction.
    const body = JSON.stringify({ ...record, savedAtUtc: '' });
    if (body === this.lastSavedBody) {
      return;
    }
    const written = store.write(record);
    this.lastSaveError = written.error;
    if (written.error === null) {
      this.lastSavedBody = body;
      this.options.log(
        `saved conversation ${conversationId}: ${String(record.messages.length)} ` +
          `messages, ${String(record.attempts.length)} attempts, ${String(
            record.testRuns.length,
          )} command runs, ${String(written.bytesWritten ?? 0)} bytes -> ${written.filePath}`,
      );
    } else {
      this.options.log(`[conversation] ${written.error}`);
    }
  }

  private buildConversation(conversationId: string): StoredConversation | null {
    const session = this.session;
    const messages: StoredMessage[] = mergeConversationMessages(
      this.carriedMessages.get(conversationId) ?? [],
      this.turns
        .filter((turn) => turn.conversationId === conversationId)
        .map((turn) => toStoredMessage(turn)),
    );

    const storedSession: StoredSession | null =
      session === null
        ? this.savedSessionFor(conversationId)
        : {
            dspatchSessionId: session.dspatchSessionId,
            providerSessionId: session.providerSessionId,
            modelRequested: session.modelRequested,
            createdAt: session.createdAt,
            toolPolicy: session.toolPolicy,
            origin: session.origin,
            workspaceOrigin: session.workspaceOrigin,
            suggestedTestCommand: session.suggestedTestCommand,
            suggestedTestCwd: session.suggestedTestCwd,
            testCommandNote: session.testCommandNote,
          };
    const project = this.savedProjectFor(conversationId);
    if (storedSession === null || project === null) {
      // Nothing worth saving yet. A conversation with no project is not a
      // conversation, and writing a blank one would put a row in the chooser that
      // opens to nothing.
      return null;
    }

    return {
      formatVersion: CONVERSATION_FORMAT_VERSION,
      conversationId,
      createdAtUtc: this.conversationCreatedAtUtc ?? nowIso(),
      savedAtUtc: nowIso(),
      // Filled in by the store, which is the only place that knows the build.
      appVersion: 'unknown',
      project,
      session: storedSession,
      messages,
      attempts: this.ledger
        .persistable()
        .filter(
          (attempt) => this.attemptConversation.get(attempt.attemptId) === conversationId,
        ),
      testRuns: this.conversationTestRuns.get(conversationId) ?? [],
      lastTestAttemptId: (this.lastTest ?? this.carriedTest)?.attemptId ?? null,
      baseline: this.storedBaseline ?? this.carriedBaseline,
      reviewedDiff: this.reviewedDiff,
    };
  }

  /** The project record for a conversation: the live session's, or the saved one. */
  private savedProjectFor(conversationId: string): StoredConversation['project'] | null {
    const session = this.session;
    if (session !== null) {
      return { path: session.workspacePath, git: session.git };
    }
    return this.options.conversations?.()?.read(conversationId).conversation?.project ?? null;
  }

  private savedSessionFor(conversationId: string): StoredSession | null {
    return this.options.conversations?.()?.read(conversationId).conversation?.session ?? null;
  }

  /**
   * Turn the session baseline into what is written down.
   *
   * Bytes are kept within a budget and everything left out carries its reason. That
   * is not politeness: a restored diff that silently omits a file reads as "this file
   * did not change", which is the one wrong answer a review surface must not give.
   */
  private buildStoredBaseline(
    taken: WorkspaceSnapshot,
    store: ConversationStore,
  ): StoredBaseline {
    const budget = store.persistenceBudget();
    const files: StoredBaselineFile[] = [];
    let retainedBytes = 0;
    let retainedFileCount = 0;
    for (const file of taken.snapshot.files) {
      const bytes = taken.contents?.get(file.relPath);
      if (bytes === undefined) {
        files.push({
          relPath: file.relPath,
          sha256: file.sha256,
          bytes: file.bytes,
          contentBase64: null,
          omissionReason:
            taken.contentOmissions.get(file.relPath) ??
            'its content at the session baseline was not kept in memory, so there ' +
              'was nothing to save',
        });
        continue;
      }
      if (bytes.byteLength > budget.maxFileBytes) {
        files.push({
          relPath: file.relPath,
          sha256: file.sha256,
          bytes: file.bytes,
          contentBase64: null,
          omissionReason:
            `${String(bytes.byteLength)} bytes is above the ${String(
              Math.round(budget.maxFileBytes / 1024),
            )} kB per-file limit for saved content, so a diff of this file cannot be ` +
            'produced after a restart. Its hash still establishes whether it changed.',
        });
        continue;
      }
      if (retainedBytes + bytes.byteLength > budget.maxTotalBytes) {
        files.push({
          relPath: file.relPath,
          sha256: file.sha256,
          bytes: file.bytes,
          contentBase64: null,
          omissionReason:
            `this conversation's ${String(
              Math.round(budget.maxTotalBytes / (1024 * 1024)),
            )} MB budget for saved baseline content was already used, so a diff of ` +
            'this file cannot be produced after a restart.',
        });
        continue;
      }
      files.push({
        relPath: file.relPath,
        sha256: file.sha256,
        bytes: file.bytes,
        contentBase64: bytes.toString('base64'),
        omissionReason: null,
      });
      retainedBytes += bytes.byteLength;
      retainedFileCount += 1;
    }
    const withoutContent = files.length - retainedFileCount;
    return {
      info: toBaselineInfo(taken),
      root: taken.snapshot.root,
      files,
      retainedFileCount,
      retainedBytes,
      note:
        `The content of ${String(retainedFileCount)} of ${String(files.length)} ` +
        'baseline files was saved, so a diff against the session baseline can be ' +
        'produced again after a restart for those files.' +
        (withoutContent === 0
          ? ''
          : ` ${String(withoutContent)} file${
              withoutContent === 1 ? '' : 's'
            } were saved as hashes only, each with its own reason. A change to one of ` +
            'them can be listed but not shown as text.') +
        ' None of this is ever written back into the working copy: it is a record of ' +
        'what the code was, not an instruction to make it that again.',
    };
  }

  /** A saved result, and what the live rules say about it now. */
  private describeRestoredTest(
    outcome: TestOutcome | null,
    currentSnapshotId: string | null,
  ): RestoredTestResult | null {
    if (outcome === null) {
      return null;
    }
    // The same two functions the live panel uses. AC#6 forbids an old result from
    // appearing to verify new code, and the way to make that hold across a restart is
    // to ask the existing rule rather than to write a second one that happens to
    // agree with it today.
    const verdict = evaluateFreshness({
      hasResult: true,
      testedSnapshotId: outcome.snapshotId,
      afterRunSnapshotId: outcome.afterRunSnapshotId,
      currentSnapshotId,
    });
    const presented = presentTestStatus(outcome.verdict, verdict.kind);
    const freshness: TestFreshness = {
      kind: verdict.kind,
      testedSnapshotId: outcome.snapshotId,
      afterRunSnapshotId: outcome.afterRunSnapshotId,
      currentSnapshotId,
      commandChangedWorkspace: verdict.commandChangedWorkspace,
      headline: verdict.headline,
      checkedAtUtc: nowIso(),
      durationMs: 0,
      presentedStatus: presented.status,
      presentedHeadline: presented.headline,
    };
    return {
      outcome,
      freshness,
      note:
        `This result was produced before DSpatch closed, at ${outcome.finishedAtUtc}. ` +
        'It has not been run again and will not be: nothing is repeated on a restart. ' +
        (verdict.kind === 'current'
          ? 'The working copy is still the code it ran against, so it still applies.'
          : verdict.kind === 'stale'
            ? 'The working copy has changed since, so it describes older code and says ' +
              'nothing about what is on disk now.'
            : 'Whether it still applies could not be established, which is not the ' +
              'same as it still applying.'),
    };
  }

  /** Every attempt and its explicit state. In memory only: nothing is hashed. */
  getRunState(): RunStateReport {
    return this.ledger.report();
  }

  /** The attempts, for the run record. */
  attempts(): readonly AttemptInfo[] {
    return this.ledger.all();
  }

  /** The snapshot identity of the working copy now, or `null` if unreadable. */
  private safeSnapshotId(): string | null {
    const session = this.session;
    if (session === null) {
      return null;
    }
    try {
      return snapshotWorkspace(session.workspacePath).snapshotId;
    } catch {
      return null;
    }
  }

  /**
   * What differs from the session baseline, and the text of every difference.
   *
   * One snapshot, one comparison, one set of diffs. The diff text is produced in
   * the same call as the hashes so that the patch a reviewer reads belongs to
   * the observed snapshot named beside it, rather than to a second reading of
   * the disk taken at some other moment.
   */
  getWorkspaceChanges(): WorkspaceReport {
    const session = this.session;
    const baseline = this.baseline;
    if (session === null || baseline === null) {
      throw new Error('No session is open, so there is no baseline to compare with.');
    }
    const diffStartedAt = performance.now();
    const after = snapshotWorkspace(session.workspacePath);
    const diff = diffSnapshots(baseline.snapshot, after.snapshot);
    const wasDirty = (relPath: string): boolean => this.dirtyAtStart.has(relPath);

    const beforeLabel = `${baseline.snapshotId} (session baseline, ${baseline.snapshot.takenAtUtc})`;
    const afterLabel = `${after.snapshotId} (on disk, ${after.snapshot.takenAtUtc})`;

    const describe = (
      relPath: string,
      beforeSha256: string | null,
      afterSha256: string | null,
      beforeBytes: number | null,
      afterBytes: number | null,
    ): WorkspaceChange => {
      const text = buildUnifiedDiff({
        relPath,
        before: this.baselineSide(relPath, beforeSha256),
        after: this.onDiskSide(session.workspacePath, relPath, afterSha256, after.snapshotId),
        beforeLabel,
        afterLabel,
      });
      return {
        relPath,
        beforeSha256,
        afterSha256,
        beforeBytes,
        afterBytes,
        preexistingDirty: wasDirty(relPath),
        unifiedDiff: text.unifiedDiff,
        diffLimitation: text.limitation,
        addedLines: text.addedLines,
        removedLines: text.removedLines,
        diffTruncated: text.truncated,
      };
    };

    const changed = diff.changed.map((file) =>
      describe(
        file.relPath,
        file.beforeSha256,
        file.afterSha256,
        file.beforeBytes,
        file.afterBytes,
      ),
    );
    const added = diff.added.map((file) =>
      describe(file.relPath, null, file.sha256, null, file.bytes),
    );
    const removed = diff.removed.map((file) =>
      describe(file.relPath, file.sha256, null, file.bytes, null),
    );
    const all = [...changed, ...added, ...removed];

    const report: WorkspaceReport = {
      workspacePath: session.workspacePath,
      baselineSnapshotId: baseline.snapshotId,
      baselineTakenAtUtc: baseline.snapshot.takenAtUtc,
      observedSnapshotId: after.snapshotId,
      observedAtUtc: after.snapshot.takenAtUtc,
      changed,
      added,
      removed,
      unchangedCount: diff.unchangedCount,
      dirtyAtSessionStart: this.dirtyFilesAtStart,
      truncated: baseline.truncated || after.truncated,
      skipped: [...baseline.skipped, ...after.skipped],
      coverageNote: this.coverageNote(baseline),
      filesWithoutDiff: all.filter((file) => file.unifiedDiff === null).length,
      diffDurationMs: round(performance.now() - diffStartedAt),
    };
    // Kept verbatim, as the diff that was put in front of a reviewer. Saving the
    // inputs and recomputing later would produce a diff of whatever the files became,
    // presented as the one that was read.
    this.reviewedDiff = report;
    this.saveConversation();
    return report;
  }

  /**
   * What this comparison covers, said out loud.
   *
   * The baseline lists a git repository's files with `git ls-files`, which is the
   * project's own definition of its content and excludes build output without
   * DSpatch guessing directory names. The price is that an ignored file is
   * invisible here, and a review surface that does not say so invites the reader
   * to treat the list as exhaustive.
   */
  private coverageNote(baseline: WorkspaceSnapshot): string {
    const omissions = baseline.contentOmissions.size;
    const retention =
      omissions === 0
        ? ''
        : ` ${String(omissions)} file${omissions === 1 ? '' : 's'} had their ` +
          'baseline content left out of memory, so a change to one of them can be ' +
          'listed by hash but not shown as text.';
    if (baseline.fileSource === 'git-ls-files') {
      return (
        'Covers the files git lists for this project: tracked files, plus untracked ' +
        'files that are not ignored. A change to a git-ignored file — build output, ' +
        'a local .env, anything matched by .gitignore — is outside the baseline and ' +
        'will not appear here at all, neither as changed nor as unchanged.' +
        retention
      );
    }
    return (
      'git could not list this folder, so the baseline was taken by walking the ' +
      'directory and excluding only .git and node_modules. Build output is ' +
      'therefore included, and a large generated tree will appear as changes.' +
      retention
    );
  }

  /** The baseline side of one file's diff: its bytes, or why they are missing. */
  private baselineSide(relPath: string, beforeSha256: string | null): DiffSide {
    if (beforeSha256 === null) {
      return { kind: 'absent' };
    }
    const baseline = this.baseline;
    if (baseline === null || baseline.contents === null) {
      return {
        kind: 'unavailable',
        reason:
          'the session baseline kept only hashes for this project, so the earlier ' +
          'content is no longer available anywhere',
      };
    }
    const bytes = baseline.contents.get(relPath);
    if (bytes === undefined) {
      return {
        kind: 'unavailable',
        reason:
          baseline.contentOmissions.get(relPath) ??
          'its content at the session baseline was not kept',
      };
    }
    return { kind: 'bytes', bytes };
  }

  /**
   * The current side of one file's diff.
   *
   * Re-read and re-hashed rather than trusted: the snapshot was taken a moment
   * earlier, and if the file has moved on since then the diff would silently be
   * between two states the report does not name. A mismatch is reported as the
   * limitation it is.
   */
  private onDiskSide(
    workspacePath: string,
    relPath: string,
    afterSha256: string | null,
    observedSnapshotId: string,
  ): DiffSide {
    if (afterSha256 === null) {
      return { kind: 'absent' };
    }
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(path.join(workspacePath, relPath));
    } catch (error) {
      return {
        kind: 'unavailable',
        reason: `it could not be read back just now: ${describeError(error)}`,
      };
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== afterSha256) {
      return {
        kind: 'unavailable',
        reason:
          'it changed again while this comparison was being produced, so its bytes ' +
          `no longer match ${observedSnapshotId}. Check the files again for a diff ` +
          'that matches a single snapshot',
      };
    }
    return { kind: 'bytes', bytes };
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
        root: this.baseline.snapshot.root,
        snapshotId: this.baseline.snapshotId,
        takenAtUtc: this.baseline.snapshot.takenAtUtc,
        fileSource: this.baseline.fileSource,
        truncated: this.baseline.truncated,
        skipped: this.baseline.skipped,
        retainedBytes: this.baseline.retainedBytes,
        contentOmissions: [...this.baseline.contentOmissions].map(([relPath, reason]) => ({
          relPath,
          reason,
        })),
        files: this.baseline.snapshot.files,
      },
      dirtyAtSessionStart: this.dirtyFilesAtStart,
      foreignEventsDropped: this.foreignEventsDropped,
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
      lastTestFreshness: this.session === null ? null : this.getTestFreshness(),
      cancelObservations: this.getCancelObservations(),
      attempts: this.ledger.all(),
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

    const attemptId = this.activeCommandAttemptId;
    if (attemptId !== null) {
      this.ledger.markCancelRequested(
        attemptId,
        `DSpatch asked the process tree under pid ${String(child.pid)} to die. Until ` +
          'the process closes, whether it is gone is not established — and a ' +
          'surviving child keeps holding the working directory.',
      );
      // A kill that is never confirmed must not sit as "cancellation requested"
      // forever: an unkillable process is exactly the case worth showing.
      const timer = setTimeout(() => {
        if (this.ledger.get(attemptId)?.state === 'cancel-requested') {
          this.ledger.markOutcomeUnknown(
            attemptId,
            'The process was asked to die and never reported closing, so whether ' +
              'it is gone is unknown. It may still be holding the working ' +
              'directory open.',
          );
        }
      }, this.cancelConfirmMs);
      timer.unref?.();
    }

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
    // Closing a session is DSpatch stopping listening, which is a change in what
    // it knows rather than an ending. An unresolved turn is carried over as
    // unknown so the next session's first message has to reckon with it instead of
    // starting beside work that may still be going in a different agent.
    for (const attempt of this.ledger.unresolved('agent-turn')) {
      if (attempt.state === 'waiting' || attempt.state === 'running') {
        this.ledger.markOutcomeUnknown(
          attempt.attemptId,
          'The session this belonged to was closed before the run reported an end, ' +
            'so DSpatch is no longer receiving its events. Whether it is still ' +
            'going is unknown.',
        );
      }
    }
    // Last, with the session still set, because the session is where the project
    // path and its git state come from. This is the save that makes the reconciliation
    // above survive: the attempts just marked unknown are now on disk as unknown.
    this.saveConversation();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = null;
    this.baseline = null;
    this.dirtyAtStart = new Set<string>();
    this.dirtyFilesAtStart = [];
    this.currentTurn = null;
    // The result belonged to the previous working copy and its snapshots. Kept
    // across a session change it would be a green tick beside unrelated code.
    this.lastTest = null;
    this.testKillRequested = false;
    // A recap is owed to one session. Carrying it into the next one would put the
    // record in front of a model that may well already have it.
    this.pendingResendContext = null;
    this.pendingResentContext = null;
    this.continuity = FIRST_SESSION_CONTINUITY;
    // A new session on the same adapter instance would collide on the derived
    // provider agent ID, so the adapter is replaced with the session.
    const adapter = this.adapter;
    this.adapter = null;
    if (adapter !== null) {
      await adapter.dispose();
    }
  }

  private ensureAdapter(): ChatAdapter {
    if (this.adapter === null) {
      this.adapter =
        this.options.createAdapter?.() ??
        new CursorSdkAdapter({ toolPolicy: 'provider-default' });
    }
    return this.adapter;
  }

  private requireSession(): {
    adapter: ChatAdapter;
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
      return snapshotWorkspace(session.workspacePath).fileCount;
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
    while (performance.now() - startedAt < this.cancelWatchMs) {
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
    // First guard, before any bookkeeping: an event from a session that is no
    // longer open must not cross the bridge. The renderer drops such events too,
    // but a replaced session may point at a different directory entirely, so
    // forwarding one would offer the window a chance to attribute work to the
    // wrong project. DSP-1 measured a provider that kept working for 69.5 s after
    // DSpatch stopped listening; this is that case, one session later.
    const openSessionId = this.session?.dspatchSessionId ?? null;
    if (openSessionId !== null && event.dspatchSessionId !== openSessionId) {
      this.foreignEventsDropped += 1;
      this.options.log(
        `dropped a ${event.type} event from session ${event.dspatchSessionId}: ` +
          `the open session is ${openSessionId}`,
      );
      return;
    }

    if (event.type === 'run.started') {
      // The first thing that carries a run ID, and the only thing that confirms
      // the attempt actually started something.
      const attemptId = this.pendingAttemptId;
      if (attemptId !== null) {
        this.attemptByRunId.set(event.dspatchRunId, attemptId);
        this.ledger.markRunning(
          attemptId,
          { providerRunId: event.dspatchRunId },
          `The provider started run ${event.dspatchRunId} at ${event.at}.`,
        );
      }
      const turn: TurnRecord = {
        conversationId: this.conversationId,
        dspatchRunId: event.dspatchRunId,
        prompt: this.pendingPrompt,
        resentContext: this.pendingResentContext,
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

    // A terminal event settles the attempt it belongs to, by run ID rather than by
    // whichever turn is on screen: a superseded run's ending is still that run's
    // ending, and recording it against the current attempt would be a lie about
    // both.
    if (event.type === 'run.finished') {
      const attemptId = this.attemptByRunId.get(event.dspatchRunId);
      if (attemptId !== undefined) {
        const detail =
          `Run ${event.dspatchRunId} reported status "${event.status}" at ${event.at}` +
          `${event.error === undefined ? '' : `: ${event.error.message}`}.`;
        if (event.status === 'cancelled') {
          this.ledger.markStopped(
            attemptId,
            `${detail} This is a confirmed end: the provider reported it, rather ` +
              'than DSpatch inferring it from silence.',
          );
        } else if (event.status === 'finished') {
          this.ledger.markCompleted(attemptId, detail);
        } else {
          this.ledger.markFailed(attemptId, detail);
        }
      }
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

    // Both ends of a run, and nothing in between. Saving on every delta would rewrite
    // the file hundreds of times per turn for text that is complete a second later.
    // The start matters as much as the ending: it is what puts `running` and the
    // provider's run ID on disk, so a window that is killed mid-turn leaves a record
    // saying what was going rather than one saying a message was about to be sent.
    if (event.type === 'run.started' || event.type === 'run.finished') {
      this.saveConversation();
    }

    const ui = toUiEvent(event);
    // The recap travels with the run that carried it, so the window can say what
    // this particular message was sent with rather than what the session was set
    // up to send at some earlier moment.
    this.options.send(
      event.type === 'run.started' && this.pendingResentContext !== null
        ? { ...ui, resentContext: this.pendingResentContext }
        : ui,
    );
  }
}

function directoryExists(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The identity of a directory's content, or `null` if it could not be read.
 *
 * A free function rather than the service's own `safeSnapshotId`, because restoring
 * happens with no session open and therefore no `workspacePath` on the service. It is
 * the same `snapshotWorkspace` either way, so the ID a restored result is compared
 * against is the same kind of value the result was bound to when it ran.
 */
function safeSnapshotIdOf(root: string): string | null {
  try {
    return snapshotWorkspace(root).snapshotId;
  } catch {
    return null;
  }
}

/**
 * The conversation's messages: what was read from disk, then what this window did.
 *
 * **One entry per run, which is not what appending gave.** `carried` is the file's
 * own messages and `live` is this window's turns for the same conversation, and the
 * two overlap whenever a conversation is read back after being worked in — reading
 * it back is what puts this window's already-saved turns into `carried`, while
 * `this.turns` still holds them. Concatenating then wrote each of them twice, and
 * the next save made the duplicate permanent.
 *
 * It is not hypothetical. Niclas's own MiniDAWLab conversation holds 23 messages
 * for 22 turns: *Hej*, sent on 17 September 2026, is there twice under one
 * `dspatchRunId`, from resuming a conversation this window had already worked in.
 *
 * **A turn is identified by its run and the moment it started, not by its run alone.**
 * The run id comes from the adapter, and an adapter is not obliged to make it unique:
 * the simulated one in the tests issues the same id for every turn of a session, and
 * keying on it alone silently merged two different messages into one. Dropping a real
 * message to avoid a duplicate is the worse of the two faults by a distance, so the
 * key carries `startedAtUtc` as well — the same turn read back from disk has the same
 * one, and two turns never start at the same instant in the same session.
 *
 * Where a turn is in both, the live version wins: this process watched it happen and
 * it is at least as complete as the copy that was written down. It keeps its position
 * from the file, so the order of the conversation stays the order it happened in.
 * **A live turn is never dropped**, whatever the adapter does with its ids.
 * `ordinal` is renumbered over the result, since that is the field the reader sorts by
 * and a gap in it would be a gap in the conversation.
 *
 * A duplicate already on disk is healed by the next ordinary save rather than by a
 * repair pass: nothing here deletes a file, rewrites one it did not build, or drops a
 * message that appears once.
 */
export function mergeConversationMessages(
  carried: readonly StoredMessage[],
  live: readonly StoredMessage[],
): StoredMessage[] {
  const keyOf = (message: StoredMessage): string =>
    `${message.dspatchRunId}\u0000${message.startedAtUtc}`;
  const unusedLive = new Map<string, StoredMessage[]>();
  for (const message of live) {
    const bucket = unusedLive.get(keyOf(message));
    if (bucket === undefined) {
      unusedLive.set(keyOf(message), [message]);
    } else {
      bucket.push(message);
    }
  }

  const merged: StoredMessage[] = [];
  const seen = new Set<string>();
  for (const message of carried) {
    const key = keyOf(message);
    if (seen.has(key)) {
      // The same turn twice in the file: what a resume of an already-worked-in
      // conversation used to write. Kept once, and nothing is rewritten to achieve it.
      continue;
    }
    seen.add(key);
    merged.push(unusedLive.get(key)?.shift() ?? message);
  }
  for (const message of live) {
    // Whatever is left is this session's own work that the file does not hold yet.
    // Matched by identity rather than by key, so a second live turn sharing a key
    // with the first still reaches the file.
    if (unusedLive.get(keyOf(message))?.includes(message) === true) {
      merged.push(message);
    }
  }
  return merged.map((message, index) => ({ ...message, ordinal: index }));
}

/** One turn, in the shape that is written down. Nothing derived, nothing dropped. */
function toStoredMessage(turn: TurnRecord): StoredMessage {
  const total = turn.usageEvents
    .flatMap((event) => event.readings)
    .find((reading) => reading.source === 'SDKUsageMessage.usage.totalTokens');
  return {
    // Rewritten by the caller once the whole list is in order; a per-turn ordinal
    // here would be wrong for a conversation that carries messages from disk.
    ordinal: 0,
    dspatchRunId: turn.dspatchRunId,
    prompt: turn.prompt,
    resentContext: turn.resentContext,
    // The final message when there is one, because it is the provider's own complete
    // text; the assembled deltas otherwise, because a turn that was interrupted has
    // only those and they are still what was received.
    answer: turn.finalMessage ?? turn.deltaText,
    deltaCount: turn.deltaCount,
    toolEvents: turn.toolEvents,
    terminalStatus: turn.terminalStatus,
    errorMessage: turn.errorMessage,
    totalTokens: total?.value ?? null,
    startedAtUtc: turn.startedAtUtc,
    finishedAtUtc: turn.finishedAtUtc,
  };
}

/**
 * The result the window was showing when the conversation was saved.
 *
 * By attempt ID rather than by position, because `testRuns` is in the order the
 * commands ran and the one on screen is the one that was named. Falling back to the
 * last run is better than showing none, and it is the same run in every case where
 * the ID was recorded properly.
 */
function pickLastTest(conversation: StoredConversation): TestOutcome | null {
  const byId =
    conversation.lastTestAttemptId === null
      ? undefined
      : conversation.testRuns.find(
          (run) => run.attemptId === conversation.lastTestAttemptId,
        );
  return byId ?? conversation.testRuns[conversation.testRuns.length - 1] ?? null;
}

/**
 * Whether the diff that was reviewed still describes the code on disk.
 *
 * The comparison is against `observedSnapshotId` — the state the diff was taken
 * against — so an unchanged working copy reads as still current and any change at all
 * makes the diff a historical record. It is never rewritten to match the new content:
 * a diff whose text has been adjusted to fit code it was not taken from is worse than
 * one that is plainly out of date.
 */
function describeRestoredDiff(
  report: WorkspaceReport | null,
  currentSnapshotId: string | null,
): RestoredDiff | null {
  if (report === null) {
    return null;
  }
  const stillDescribesDisk =
    currentSnapshotId === null ? null : currentSnapshotId === report.observedSnapshotId;
  return {
    report,
    currentSnapshotId,
    stillDescribesDisk,
    note:
      `This is the diff that was on screen before DSpatch closed, between ` +
      `${report.baselineSnapshotId} and ${report.observedSnapshotId}, unchanged. ` +
      (stillDescribesDisk === true
        ? 'The working copy is still that second state, so it also describes the code ' +
          'on disk now.'
        : stillDescribesDisk === false
          ? `The working copy is now ${currentSnapshotId ?? 'unknown'}, so this is a ` +
            'record of what was reviewed rather than a description of the code on ' +
            'disk. Nothing has been written back to make it fit: check the files again ' +
            'for a diff of what is there now.'
          : 'The working copy could not be hashed, so whether it still describes the ' +
            'code on disk is unknown rather than yes.'),
  };
}

/**
 * What the restored panel says about the attempts that had no ending.
 *
 * Three cases, because there are three, and one sentence covering all of them was
 * false in two. Until Verifier 004 drove this, the note always said "DSpatch will
 * not send another message or run the command again until you confirm you have seen
 * them". DSP-6's first item made one acknowledgement hold for the attempt, so for an
 * attempt already on record as seen there is nothing to confirm and the composer
 * works at once — the Verifier opened such a conversation and measured exactly that.
 * A requirement stated as fact that no longer applies is the same defect as a
 * behaviour stated as fact that nobody has seen, which is what DSP-6 item 4 was for.
 *
 * `blocksRepeat` is the ledger's own answer to "does the next action of this kind
 * wait for this one", so the note is built from that rather than from a second rule
 * that could drift away from it.
 */
function describeReconciliation(
  reconciliations: readonly AttemptReconciliation[],
): string {
  if (reconciliations.length === 0) {
    return (
      'Every attempt in this conversation had reached a state DSpatch could ' +
      'establish before it closed, so there is nothing to reconcile and the ' +
      'conversation can be continued as it stands.'
    );
  }
  const total = reconciliations.length;
  const awaiting = reconciliations.filter((item) => item.blocksRepeat).length;
  const seen = total - awaiting;
  const opening =
    `${String(total)} attempt${total === 1 ? '' : 's'} had not reported an ending ` +
    'when DSpatch closed. Closing a window is not an ending, so ' +
    `${total === 1 ? 'it is' : 'each one is'} recorded as an unknown outcome rather ` +
    'than as stopped. ';

  if (awaiting === 0) {
    return (
      `${opening}You confirmed ${
        total === 1 ? 'it' : 'all of them'
      } before, and DSpatch asks once per attempt rather than once per message, so ` +
      `nothing here has to be confirmed again: the composer works normally and ${
        total === 1 ? 'the attempt stays' : 'they stay'
      } on the record as unresolved rather than marked done. Nothing has been repeated.`
    );
  }
  if (seen === 0) {
    return (
      `${opening}DSpatch will not send another message or run the command again ` +
      `until you confirm you have seen ${total === 1 ? 'it' : 'them'} — and ` +
      `confirming leaves ${
        total === 1 ? 'it' : 'them'
      } on the record as unresolved rather than marking ${
        total === 1 ? 'it' : 'them'
      } done. You are asked once per attempt, not once per message.`
    );
  }
  return (
    `${opening}${String(awaiting)} of them ${
      awaiting === 1 ? 'has' : 'have'
    } not been confirmed, and DSpatch will not send another message or run the ` +
    `command again until you confirm ${awaiting === 1 ? 'that one' : 'those'}. The ` +
    `other ${String(seen)} you confirmed before and will not be asked about again. ` +
    'Confirming leaves an attempt on the record as unresolved rather than marking ' +
    'it done.'
  );
}

/** Two problems are two sentences, not one that hides the other. */
function joinErrors(first: string | null, second: string | null): string | null {
  const parts = [first, second].filter(
    (part): part is string => part !== null && part.trim() !== '',
  );
  return parts.length === 0 ? null : parts.join(' ');
}

/** What restoring did, in the window's own words, including what it did not do. */
function restoreStatement(
  conversation: StoredConversation,
  projectExists: boolean,
  diff: RestoredDiff | null,
  test: RestoredTestResult | null,
): string {
  const parts: string[] = [
    `Read back from a saved file: ${String(conversation.messages.length)} message${
      conversation.messages.length === 1 ? '' : 's'
    } in the order they were sent, ${String(conversation.attempts.length)} attempt${
      conversation.attempts.length === 1 ? '' : 's'
    } with their states, ${String(conversation.testRuns.length)} command run${
      conversation.testRuns.length === 1 ? '' : 's'
    }${diff === null ? '' : ' and the diff that was reviewed'}.`,
    'No provider session was opened, no message was resent, no command was run and ' +
      'nothing was written into your project.',
  ];
  if (!projectExists) {
    parts.push(
      `The project this is about is no longer at ${conversation.project.path}. The ` +
        'conversation can still be read; whether the saved results describe anything ' +
        'that exists now is unknown.',
    );
  }
  if (test !== null && test.freshness.presentedStatus === 'passed-for-older-code') {
    parts.push(
      'The saved command result passed against code that has since changed, so it is ' +
        'shown as passing for older code rather than as a pass.',
    );
  }
  if (diff !== null && diff.stillDescribesDisk === false) {
    parts.push(
      'The working copy has moved on since the diff was reviewed, so that diff is ' +
        'labelled as a record rather than as the current state.',
    );
  }
  parts.push(
    'Continuing means opening the project again. DSpatch first asks Cursor to ' +
      `resume the provider session this conversation was last worked in (${
        conversation.session.dspatchSessionId
      }). If Cursor still has it, the model has the earlier turns from its own ` +
      'store and nothing is resent. If it refuses — the store is under your user ' +
      'profile, keyed by this project\'s path, and is not the file this was read ' +
      'from — a new session is opened and DSpatch puts its own record of this ' +
      'conversation in front of your next message. The window says which of the ' +
      'two happened and shows the resent text word for word. Nothing is sent to ' +
      'any model by reading this conversation back.',
  );
  return parts.join(' ');
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
