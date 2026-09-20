/**
 * Contract between the renderer and the main process.
 *
 * This file contains **types only**. That is a requirement: sandboxed preload
 * may import only Electron modules as values. A type import disappears during
 * compilation and is therefore safe.
 *
 * The adapter itself stays in the main process. Everything the chat surface can
 * do is listed here, and it is reached only over IPC.
 */

import type {
  AgentEventType,
  CapabilityReport,
  TerminalRunStatus,
  UsageReading,
} from '../adapter/types';
import type { StepActivity } from './loop-activity';
import type { LoopControlOutcome, LoopControlReport, LoopMode } from './loop-control';
import type { ResolvedRole, RoleReference } from './loop-graph';
import type { ParsedRunRecord, RecordedRunEnding } from './loop-record';
import type { RunJournalEntry, RunResult } from './loop-run';
import type { LiveRunAnnouncement, LoopRunEvent } from './loop-run-view';

/** Versions shown by the renderer. Obtained in the main process, never the renderer. */
export interface RuntimeVersions {
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
  readonly v8: string;
}

/** The source of renderer content. Displayed by the UI without inference. */
export type RendererSource = 'dev-server' | 'built-files';

/**
 * Which sources the running build was made from.
 *
 * `null` when `dist/build-identity.json` is missing or unreadable, which is
 * unknown rather than "unchanged" — a packaged application is opaque, and the
 * artifact that existed before this field did turned out to predate DSP-4 with
 * nothing on it to say so.
 */
export interface BuildIdentity {
  /** SHA-256 over the source list. The short form is what a person compares. */
  readonly digest: string;
  readonly fileCount: number;
  readonly generatedAtUtc: string;
  /** `null` when the build had no git available. Never inferred. */
  readonly gitRevision: string | null;
  /** How many files differed from that revision when the artifact was built. */
  readonly gitDirtyFileCount: number | null;
  /** Why it could not be read, when it could not. */
  readonly error: string | null;
}

/** What the main process knows about the app and adapter at startup. */
export interface EnvironmentInfo {
  readonly appName: string;
  readonly appVersion: string;
  readonly platform: string;
  readonly rendererSource: RendererSource;
  /** Whether this is a packaged artifact or a run from `dist/`. */
  readonly packaged: boolean;
  readonly versions: RuntimeVersions;
  readonly build: BuildIdentity | null;
  readonly adapter: {
    readonly id: string;
    readonly capabilities: CapabilityReport;
  };
}

/** Renderer acknowledgement of mounting and painting. Evidence for the smoke test. */
export interface RendererReady {
  readonly headingText: string;
  readonly capabilityCount: number;
  readonly renderedAt: string;
}

/**
 * What the top application menu can ask the window to do (DSP-60).
 *
 * Deliberately a small closed set. The menu is where session details, identifiers
 * and diagnostics now live, and a menu that could ask the window for anything
 * would be a second way of driving the application rather than a way of reaching
 * what the conversation no longer shows.
 */
export type MenuCommand =
  | 'show-session-details'
  | 'hide-session-details'
  | 'change-project'
  /**
   * Show what DSpatch has left behind in its own sample location (DSP-61).
   *
   * It shows; it does not remove. Removal is a button beside the list, because
   * Niclas's decision was that clearing out old sample projects is a separate act
   * a person performs, not something that happens on the way past.
   */
  | 'show-sample-projects';

/** One model the account may request, as the provider named it. */
export interface ModelChoice {
  readonly id: string;
  readonly displayName: string;
}

/**
 * Connection status for the provider account.
 *
 * `account` is `string | null` and `null` means **unknown**, not "no account".
 * The same rule as cost: a missing value is never presented as an answer.
 */
export type ConnectionStatus =
  | { readonly kind: 'checking' }
  | {
      readonly kind: 'connected';
      readonly provider: 'cursor';
      /** The account the provider reports. `null` when the provider did not say. */
      readonly account: string | null;
      readonly backendUrl: string;
      /** Where the credential came from. Never the credential itself. */
      readonly credentialSource: string;
      readonly credentialStorePath: string;
      readonly credentialExpiresAtUtc: string | null;
      /** Models the account can request. `null` means the list was not read. */
      readonly modelsAvailable: number | null;
      /**
       * The models by name, for the chooser beside the composer.
       *
       * Empty means the list was not read, which is a different statement from
       * "this account has no models" and is shown as such: the window then names
       * the model in use and offers no choice, rather than offering an empty one.
       */
      readonly models: readonly ModelChoice[];
      readonly modelRequested: string;
      readonly checkedAtUtc: string;
    }
  | {
      readonly kind: 'not-connected';
      readonly reason: string;
      readonly credentialStorePath: string;
      readonly checkedAtUtc: string;
    }
  | { readonly kind: 'error'; readonly message: string; readonly checkedAtUtc: string };

/** The result of the folder picker. Cancelling is a normal outcome, not an error. */
export type ProjectPickOutcome =
  | { readonly kind: 'chosen'; readonly path: string }
  | { readonly kind: 'cancelled' };

/** How a project came to be offered in the window. */
export type ProjectEntryOrigin = 'recent' | 'startup-environment';

export interface ProjectListEntry {
  readonly path: string;
  /** `null` for a project that has not been opened through DSpatch yet. */
  readonly lastOpenedAtUtc: string | null;
  readonly openCount: number | null;
  readonly origin: ProjectEntryOrigin;
  /** Checked when the list was read. A remembered folder can have been moved. */
  readonly exists: boolean;
  /** `null` when it was not determined. */
  readonly isGitRepository: boolean | null;
}

/** The remembered projects, and the state of the file they are kept in. */
export interface ProjectListing {
  readonly formatVersion: number;
  readonly storePath: string;
  readonly entries: readonly ProjectListEntry[];
  /** Non-null means the list is incomplete or absent, and says why. */
  readonly error: string | null;
  /** The file is from a newer DSpatch and will be read but not rewritten. */
  readonly readOnly: boolean;
}

/**
 * What forgetting remembered projects did, with the list as it now stands.
 *
 * `removed` is what actually left the file, not what was asked for: a read-only
 * file and a failed write both remove nothing, and the window has to be able to
 * say so rather than show an entry as gone until the next restart.
 */
export interface ForgetProjectsResult {
  readonly removed: readonly string[];
  /** Asked for but not in the list. A normal outcome, not a failure. */
  readonly notFound: readonly string[];
  readonly projects: ProjectListing;
  /**
   * What this did and did not touch, for the window to show.
   *
   * Removal is a change to one list in DSpatch's own settings file. It is stated
   * rather than left to be assumed, because "remove" is a word that reasonably
   * makes someone worry about their folder.
   */
  readonly note: string;
}

/**
 * One sample project DSpatch generated, as offered for removal (DSP-61).
 *
 * `marked` is whether it carries `.dspatch-experiment`. An unmarked one is a
 * folder DSpatch generated before that marker existed — which is exactly the
 * leftover that broke *Use a generated sample project* — and it is shown rather
 * than hidden, because a person deciding what to delete should see what DSpatch
 * knows about it.
 */
export interface SampleProjectSummary {
  readonly path: string;
  readonly name: string;
  readonly marked: boolean;
  readonly fileCount: number;
  readonly lastChangedUtc: string | null;
  /** Why it could not be read. Unreadable is not the same as absent. */
  readonly error: string | null;
}

export interface SampleProjectsView {
  /** DSpatch's own sample location. Nothing outside it is ever offered. */
  readonly root: string;
  readonly folders: readonly SampleProjectSummary[];
  /** The sample project the open session is using. Never offered for removal. */
  readonly inUse: string | null;
  readonly error: string | null;
  /** What removing these would and would not touch. */
  readonly note: string;
}

export interface SampleCleanupOutcome {
  readonly removed: readonly string[];
  /** Folders still there, each with the reason. A locked one lands here. */
  readonly held: readonly { readonly path: string; readonly reason: string }[];
  readonly note: string;
  readonly remaining: SampleProjectsView;
}

/**
 * One saved conversation, as offered for continuation.
 *
 * Summary only. Reading a whole conversation means reading every file's baseline
 * bytes, and the chooser has to be able to list twenty of them without doing that.
 */
export interface ConversationListEntry {
  readonly conversationId: string;
  readonly filePath: string;
  readonly projectPath: string;
  /** Checked when the list was read. A saved project can have been moved. */
  readonly projectExists: boolean;
  readonly createdAtUtc: string;
  readonly savedAtUtc: string;
  readonly messageCount: number;
  /**
   * Attempts that had not reached a settled state when DSpatch closed.
   *
   * More than zero means the conversation cannot simply be continued: those
   * outcomes have to be named first. The count is shown before the conversation is
   * opened so that is not a surprise.
   */
  readonly unresolvedAttemptCount: number;
  /**
   * How many of those have no acknowledgement on record.
   *
   * The two counts differ, and the difference is what the row can honestly promise.
   * Since DSP-6's first item an acknowledgement holds for the attempt rather than for
   * one message, so an unresolved attempt that was already confirmed gates nothing:
   * the conversation opens and the composer works. Verifier 004 measured the row
   * claiming otherwise.
   */
  readonly unacknowledgedAttemptCount: number;
  readonly hasReviewedDiff: boolean;
  readonly hasTestResult: boolean;
  readonly formatVersion: number;
  /** Non-null means this entry is incomplete or unusable, and says why. */
  readonly error: string | null;
  /**
   * What to do about `error`, in one concrete instruction.
   *
   * Separate from the error text because AC#5 asks for an explanation **and** a
   * recovery action, and a message that only describes the damage leaves the
   * reader with nowhere to go. `null` when there is nothing to recover from.
   */
  readonly recovery: string | null;
  /** Written by a newer DSpatch: read, never rewritten. */
  readonly readOnly: boolean;
}

/**
 * A save that was interrupted before it could replace the file it was writing.
 *
 * `ConversationStore.write` writes a temporary file and renames it, so a process
 * that dies mid-write leaves the temporary behind and the previous complete file
 * untouched. The leftover is reported rather than swept up: it is the evidence
 * that a save was lost, and deleting it quietly would be DSpatch tidying away the
 * only trace of the thing that went wrong.
 */
export interface PartialWriteInfo {
  readonly fileName: string;
  readonly filePath: string;
  readonly bytes: number | null;
  readonly modifiedAtUtc: string | null;
}

/** The saved conversations, and the state of the directory they are kept in. */
export interface ConversationListing {
  readonly directory: string;
  readonly formatVersion: number;
  readonly entries: readonly ConversationListEntry[];
  readonly error: string | null;
  /** Non-null when the directory itself needs attention, saying what to do. */
  readonly recovery: string | null;
  /** Temporary files from saves that never completed. Never deleted here. */
  readonly partialWrites: readonly PartialWriteInfo[];
}

/**
 * What exporting one conversation did.
 *
 * The export is a **byte-for-byte copy of the stored file**, which is why it can
 * also be offered for a file DSpatch cannot read: getting an unreadable record out
 * to somewhere safe is exactly what someone needs when the record is unreadable.
 * `readBack` is DSpatch re-reading what it just wrote, so "you can read this back"
 * is a measurement rather than a claim — and when the source was corrupt, the
 * honest answer is that the copy is corrupt in the same way.
 */
export type ConversationExportResult =
  | { readonly kind: 'cancelled'; readonly note: string }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'written';
      readonly sourcePath: string;
      readonly filePath: string;
      readonly bytes: number;
      readonly sha256: string;
      /** `true` when the copy's bytes hash the same as the source's. */
      readonly identicalToSource: boolean;
      readonly readBack: {
        readonly parsed: boolean;
        readonly conversationId: string | null;
        readonly formatVersion: number | null;
        readonly messageCount: number | null;
        readonly error: string | null;
      };
      readonly note: string;
    };

/**
 * What to open a session over.
 *
 * Explicit rather than implied: a session over the user's own project and a
 * session over a generated sample are different acts and the window says which
 * one it is doing.
 *
 * The third kind is the way out of the one refusal report 008 measured a
 * restarted user hitting: the provider session this conversation was resumed into
 * still holds an unfinished run from before the restart, so it refuses every
 * message. It reopens **the project already open**, over the same conversation,
 * and deliberately does not attempt a resume — that is the whole point, since the
 * resume is what lands in the session holding the run. It carries no path: taking
 * one would make it a way of opening something else, and the main process already
 * knows what is open.
 */
export type StartSessionRequest =
  | { readonly kind: 'folder'; readonly path: string }
  | { readonly kind: 'sample' }
  | { readonly kind: 'new-provider-session' };

export type SessionOrigin = 'chosen-folder' | 'generated-sample';

/** How a path differs from git `HEAD`. */
export type DirtyKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unmerged'
  | 'type-changed'
  | 'other';

export interface DirtyFileInfo {
  readonly relPath: string;
  /** git's own two-character code, unchanged. */
  readonly statusCode: string;
  readonly kind: DirtyKind;
  readonly previousRelPath: string | null;
  readonly staged: boolean;
}

/**
 * The working copy's git state when the session opened.
 *
 * Recorded **before** the agent exists, because AC#6 requires an existing manual
 * change to stay distinguishable from the run's changes and that is impossible
 * to establish afterwards. `isGitRepository: false` is a valid answer and does
 * not mean the folder was clean — it means the question could not be asked.
 */
export interface GitBaselineInfo {
  readonly isGitRepository: boolean;
  readonly topLevel: string | null;
  /** `null` for a repository with no commit yet, or when it could not be read. */
  readonly headRevision: string | null;
  readonly branch: string | null;
  readonly dirtyFiles: readonly DirtyFileInfo[];
  readonly error: string | null;
  readonly gitVersion: string | null;
  readonly observedAtUtc: string;
}

export interface SkippedFileInfo {
  readonly relPath: string;
  readonly reason: string;
}

/** The content baseline: hashed bytes, and the identity of that set of bytes. */
export interface BaselineInfo {
  readonly snapshotId: string;
  readonly takenAtUtc: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly fileSource: 'git-ls-files' | 'directory-walk';
  readonly fileSourceNote: string;
  /** A limit was reached, so the baseline covers only part of the project. */
  readonly truncated: boolean;
  readonly skipped: readonly SkippedFileInfo[];
  readonly durationMs: number;
}

/**
 * What DSpatch put in front of the model when the session opened.
 *
 * AC#3 requires the available project context to be clear and is explicit that
 * choosing a folder must not imply that every file was read. So these fields
 * describe what was **sent**, not what exists on disk.
 */
export interface SessionContextInfo {
  /** The working directory handed to the agent runtime. */
  readonly workingDirectorySent: string;
  readonly modelSent: string;
  readonly toolPolicySent: string;
  /** Always 0 in this build: DSpatch uploads no file content. */
  readonly fileContentsSentByDspatch: number;
  readonly statement: string;
}

/**
 * How this session relates to the one the conversation was last worked in.
 *
 * AC#2's whole point. A window that shows an old transcript beside a fresh
 * provider session, without saying which of the two the model has actually been
 * given, is making a claim it has not established. So this field carries the
 * answer, and it is the answer DSpatch observed rather than the one it hoped for.
 *
 * - `first-session` — nothing to continue. The conversation had no earlier
 *   provider session.
 * - `provider-session-resumed` — Cursor still had the agent and it was resumed,
 *   so the model has the earlier turns from **its own** store. DSpatch resent
 *   nothing, because nothing needed resending.
 * - `new-provider-session` — resumption was attempted and refused, or there was
 *   nothing to resume into. The model has been told nothing, and `contextToResend`
 *   is exactly what DSpatch will put in front of the next message to change that.
 */
export type SessionContinuityKind =
  | 'first-session'
  | 'provider-session-resumed'
  | 'new-provider-session';

export interface SessionContinuity {
  readonly kind: SessionContinuityKind;
  /** The session DSpatch tried to continue. `null` when there was none. */
  readonly attemptedDspatchSessionId: string | null;
  /** Cursor's own agent ID for it, when resumption succeeded. */
  readonly resumedProviderSessionId: string | null;
  /** Why resumption was not used, in the provider's own words. */
  readonly resumeError: string | null;
  /**
   * The exact text DSpatch will put before the next message, or `null`.
   *
   * The literal string, not a description of it. "Which saved context was
   * actually resent" cannot be answered by a summary of the answer.
   */
  readonly contextToResend: string | null;
  /** What the recap covers and, more importantly, what it leaves out. */
  readonly contextNote: string;
  readonly savedMessageCount: number;
  readonly statement: string;
}

/** One session over one working copy. */
export interface ChatSessionInfo {
  /**
   * The saved conversation this session writes into.
   *
   * A session is one connection to a provider; a conversation is the work that
   * outlives it. Opening the same project again after a restart continues the same
   * conversation ID, which is what makes the transcript, the reviewed diff and the
   * execution result on screen belong together rather than merely look similar.
   */
  readonly conversationId: string;
  readonly dspatchSessionId: string;
  readonly providerSessionId: string;
  readonly modelRequested: string;
  readonly workspacePath: string;
  readonly createdAt: string;
  readonly toolPolicy: string;
  readonly origin: SessionOrigin;
  /** How the working copy came to exist, stated rather than implied. */
  readonly workspaceOrigin: string;
  readonly git: GitBaselineInfo;
  readonly baseline: BaselineInfo;
  readonly context: SessionContextInfo;
  /** Whether this session continues the conversation's earlier one, or replaces it. */
  readonly continuity: SessionContinuity;
  /**
   * What the build/test field is filled in with when the project opens.
   *
   * A suggestion derived from the project, not a setting: the window's fields
   * are the only place the command and working directory live, and both are
   * editable. `''` means DSpatch could not work one out and is not guessing.
   */
  readonly suggestedTestCommand: string;
  readonly suggestedTestCwd: string;
  /** Where the suggestion came from, including when there is none. */
  readonly testCommandNote: string;
  /** Absent when no Node executable was found; the UI must then say so. */
  readonly testRunnerPath: string | null;
  readonly testRunnerSource: string | null;
  /** The conversation's earlier messages, read from disk as this session opened. */
  readonly restoredHistory: RestoredHistory;
}

/**
 * What a project's earlier conversation looked like on disk when it was reopened.
 *
 * Opening a project has continued the same `conversationId` since DSP-4, and the
 * main process has read that file and carried its messages since then too — but
 * nothing ever handed them to the window, so reopening a project drew an empty
 * thread over a conversation that was intact on disk. The messages went back into
 * the file on the next save and were never lost; they simply had nowhere to appear.
 * Niclas met that on 19 September 2026 as *an old loop run with an old mandate and
 * none of my recent messages*: the loop half of the column restores itself from the
 * run records, and the ordinary half had no equivalent.
 *
 * **This is history and not memory, and the difference is the reason `note` exists.**
 * The text coming back on screen says nothing about what the provider's own session
 * retains; that is `ChatSessionInfo.continuity`'s subject, it is decided by a resume
 * that either worked or did not, and showing the transcript must not quietly imply
 * the agent has it. Every field here was read from a file.
 */
export interface RestoredHistory {
  readonly conversationId: string;
  /** In `ordinal` order, exactly as the file holds them. Empty for a new conversation. */
  readonly messages: readonly StoredMessage[];
  /** Where they were read from. `null` when this build is not saving conversations. */
  readonly filePath: string | null;
  readonly savedAtUtc: string | null;
  /** Why the history is absent or incomplete, in words. `null` when nothing went wrong. */
  readonly error: string | null;
}

/**
 * Whether the conversation on screen reached the disk.
 *
 * The service has recorded its last save failure since DSP-4 and nothing ever asked
 * for it, so a conversation that could not be written was reported to the log file
 * and to nobody else. The window would then keep working normally and the next
 * restart would open an older version of the work with no explanation — which is
 * the same complaint as a lost message, arriving by a different route.
 *
 * `error` is the store's own sentence about the failure, not a reworded summary of
 * it. `null` means the last save succeeded, which is not a promise about the next.
 */
export interface ConversationSaveStatus {
  readonly conversationId: string | null;
  readonly filePath: string | null;
  readonly error: string | null;
}

/** A file difference established by hashing bytes, not by an agent's account. */
export interface WorkspaceChange {
  readonly relPath: string;
  /** `null` when the file did not exist before. */
  readonly beforeSha256: string | null;
  /** `null` when the file no longer exists. */
  readonly afterSha256: string | null;
  readonly beforeBytes: number | null;
  readonly afterBytes: number | null;
  /**
   * The file already differed from git `HEAD` when the session opened.
   *
   * The baseline is the session's starting bytes, so a difference against it is a
   * change made since the session opened. This flag carries the other half of
   * AC#6: the file also carried the user's own uncommitted work, so whatever is
   * in it now is not attributable to the agent alone.
   */
  readonly preexistingDirty: boolean;

  /**
   * The conventional unified text diff between the two snapshots named on the
   * report, computed from the bytes. `null` when one could not be produced.
   */
  readonly unifiedDiff: string | null;
  /**
   * Why there is no diff text, or why the text there is incomplete.
   *
   * Never both `null` and a missing diff: AC#7 requires every change that cannot
   * be shown as text to carry its own specific reason, so a file is listed with
   * its limitation rather than quietly left out.
   */
  readonly diffLimitation: string | null;
  /** `null` when no diff was produced — unknown rather than zero. */
  readonly addedLines: number | null;
  readonly removedLines: number | null;
  readonly diffTruncated: boolean;
}

/** On-disk state of the working copy compared with the session's baseline. */
export interface WorkspaceReport {
  readonly workspacePath: string;
  readonly baselineSnapshotId: string;
  readonly baselineTakenAtUtc: string;
  readonly observedSnapshotId: string;
  readonly observedAtUtc: string;
  readonly changed: readonly WorkspaceChange[];
  readonly added: readonly WorkspaceChange[];
  readonly removed: readonly WorkspaceChange[];
  readonly unchangedCount: number;
  /** Files that were already modified relative to git `HEAD` at session start. */
  readonly dirtyAtSessionStart: readonly DirtyFileInfo[];
  /** Either snapshot hit a limit, so the comparison is partial. */
  readonly truncated: boolean;
  readonly skipped: readonly SkippedFileInfo[];
  /**
   * What this comparison does and does not cover, in words.
   *
   * The main omission is git-ignored files: the baseline lists a repository's
   * content with `git ls-files`, so a change to an ignored file is outside it.
   * AC#7 requires limitations to be visible, and a diff that is silently not
   * exhaustive is the one that misleads.
   */
  readonly coverageNote: string;
  /** Differing files with no diff text. Each one says why in `diffLimitation`. */
  readonly filesWithoutDiff: number;
  readonly diffDurationMs: number;
}

/** What the user asked DSpatch to run. Both fields come from the window. */
export interface TestRunRequest {
  readonly command: string;
  readonly cwd: string;
  /**
   * The ambiguous earlier attempts this request has been shown and accepts.
   *
   * DSpatch refuses to repeat an action whose previous outcome is unknown unless
   * the request names those attempts. Naming them is something only a person
   * looking at the state can do, which is what keeps a retry from becoming an
   * automatic second run of a command that may still be going.
   *
   * A **list**, because a restart can produce several unknowns at once and report
   * 006 found that naming one of them let the action through while the rest stayed
   * unnamed. Every unresolved attempt of the kind has to be named.
   */
  readonly acknowledgedAttemptIds?: readonly string[];
}

/**
 * What kind of work an attempt is.
 *
 * Two, because they fail differently and stop differently: a turn belongs to the
 * provider's runtime and DSpatch can only ask it to stop, while a command is a
 * process DSpatch started and can kill.
 */
export type AttemptKind = 'agent-turn' | 'command';

/**
 * The execution state of one attempt, as DSpatch can actually establish it.
 *
 * AC#1 requires waiting, cancellation requested, confirmed stopped and unknown
 * outcome to be separate states rather than implied by wording, so they are
 * separate values here and the window renders them from this field alone.
 *
 * - `waiting` — asked for; nothing has confirmed that it started.
 * - `running` — confirmed started: a `run.started` event, or a process with a pid.
 * - `cancel-requested` — a stop was asked for and no end has been confirmed.
 * - `stopped-confirmed` — an end was observed, not assumed.
 * - `outcome-unknown` — the honest state. No end was confirmed within the window
 *   DSpatch waits, or the request was abandoned before anything confirmed a
 *   start. It is never collapsed into `stopped-confirmed`.
 * - `completed` / `failed` — it ended on its own, successfully or with an error
 *   DSpatch observed.
 */
export type AttemptState =
  | 'waiting'
  | 'running'
  | 'cancel-requested'
  | 'stopped-confirmed'
  | 'outcome-unknown'
  | 'completed'
  | 'failed';

/**
 * What may still be going.
 *
 * `null` means unknown and is a common, correct answer here: DSP-1 measured a
 * turn that kept producing tool calls for 69.5 s after its connection was
 * severed, so "DSpatch is no longer being told anything" cannot be reported as
 * "nothing is running".
 */
export interface StillRunning {
  /** Work in the provider's agent runtime. */
  readonly provider: boolean | null;
  /** A process DSpatch itself started. */
  readonly dspatchProcess: boolean | null;
  readonly note: string;
}

/**
 * The one action the window offers for an attempt in this state.
 *
 * `kind` is what the window wires to a button; `label` and `detail` are what it
 * shows. `none` means there is nothing to do, which is different from an action
 * that exists but is disabled.
 */
export type NextActionKind =
  | 'none'
  | 'keep-waiting'
  | 'stop-waiting'
  | 'retry'
  | 'reconnect'
  | 'acknowledge-then-repeat'
  | 'open-project-again';

export interface NextAction {
  readonly kind: NextActionKind;
  readonly label: string;
  readonly detail: string;
}

/**
 * An attempt as it is written to disk.
 *
 * {@link AttemptInfo} minus everything derived. `stillRunning` and `nextAction` are
 * computed from the state, and saving them would let a stale copy contradict the
 * rule that produces them — a file that says "the run is going" after the process
 * that was watching it has exited is worse than no file.
 */
export interface StoredAttempt {
  readonly attemptId: string;
  readonly kind: AttemptKind;
  readonly label: string;
  readonly state: AttemptState;
  readonly stateReason: string;
  readonly requestedAtUtc: string;
  readonly endedAtUtc: string | null;
  readonly providerRunId: string | null;
  readonly localPid: number | null;
  readonly cancelRequestedAtUtc: string | null;
  readonly acknowledgedAtUtc: string | null;
  readonly history: readonly AttemptStep[];
}

/**
 * One saved attempt that was unresolved when DSpatch closed, and what it is now.
 *
 * `stateAtClose` and `stateNow` are kept apart on purpose. A restart cannot resolve
 * anything, so the only permitted movement is towards `outcome-unknown`: a saved
 * `running` becomes an explicit unknown rather than being read as either an ending
 * or as still going.
 */
export interface AttemptReconciliation {
  readonly attemptId: string;
  readonly kind: AttemptKind;
  readonly label: string;
  readonly stateAtClose: AttemptState;
  readonly stateNow: AttemptState;
  /** Whether the next action of this kind is refused until this is named. */
  readonly blocksRepeat: boolean;
  readonly note: string;
}

/** One recorded state change. Nothing is overwritten without leaving a trace. */
export interface AttemptStep {
  readonly atUtc: string;
  readonly state: AttemptState;
  readonly note: string;
  /**
   * `false` for a transition the ledger refused to apply, such as a late
   * "finished" for an attempt already confirmed stopped. It is still recorded:
   * a discarded claim about an outcome is itself evidence.
   */
  readonly applied: boolean;
}

/** One attempt at one action, with its own ID. */
export interface AttemptInfo {
  readonly attemptId: string;
  readonly kind: AttemptKind;
  /** What was attempted, in the user's terms: their message, or the command. */
  readonly label: string;
  readonly state: AttemptState;
  /** Why it is in this state, in words, including what was not observed. */
  readonly stateReason: string;
  readonly requestedAtUtc: string;
  readonly endedAtUtc: string | null;
  /** The provider's run, once one exists. `null` while nothing has started. */
  readonly providerRunId: string | null;
  readonly localPid: number | null;
  readonly cancelRequestedAtUtc: string | null;
  /** When the user accepted the unknown outcome so a repeat could proceed. */
  readonly acknowledgedAtUtc: string | null;
  readonly stillRunning: StillRunning;
  readonly nextAction: NextAction;
  readonly history: readonly AttemptStep[];
}

/**
 * Every attempt this session has made, and what has to happen before repeating.
 *
 * The window polls this rather than deriving execution state from the event
 * stream: an attempt that never produced an event is exactly the case AC#1 and
 * AC#2 are about.
 */
export interface RunStateReport {
  readonly attempts: readonly AttemptInfo[];
  /** Attempts that have not reached a settled state. */
  readonly unresolved: readonly AttemptInfo[];
  /**
   * Every attempt ID a repeat of that kind must name. Empty means none.
   *
   * All of them, not the first: after a restart several attempts can be unknown at
   * once, and a gate that is satisfied by naming one of them lets the message
   * through with the others still unnamed — visible and counted, but not seen.
   */
  readonly needsAcknowledgement: {
    readonly agentTurn: readonly string[];
    readonly command: readonly string[];
  };
  readonly observedAtUtc: string;
}

/** What abandoning a send did, since it can mean two different things. */
export interface AbandonOutcome {
  /** `true` when a run existed and was asked to stop instead. */
  readonly cancelledRun: boolean;
  readonly attemptId: string | null;
  readonly state: AttemptState | null;
  readonly note: string;
}

/**
 * What a finished command means for the code it ran against.
 *
 * AC#6 requires that an interrupted or incomplete run cannot appear passed, so
 * "passed" is not derived from the exit code anywhere in the window: it comes
 * from `evaluateTestVerdict` in the main process, which has no path from a killed
 * process, a signal or an absent exit code to `passed`.
 */
export type TestVerdict = 'passed' | 'failed' | 'interrupted' | 'unknown';

/**
 * The verdict as it applies to the code on disk **now**.
 *
 * A pass against code that has since changed is not a pass for the current code,
 * so it gets its own value rather than being shown as `passed` with a caveat
 * beside it.
 */
export type PresentedTestStatus =
  | 'no-result'
  | 'passed'
  | 'passed-for-older-code'
  | 'failed'
  | 'interrupted'
  | 'unknown';

/** A test run that DSpatch started, so the exit code is DSpatch's observation. */
export interface TestOutcome {
  /** Exactly the text that was executed, as the user left it in the field. */
  readonly command: string;
  /** The shell that interpreted it, named rather than implied. */
  readonly shell: string;
  readonly cwd: string;
  readonly pid: number | null;
  /** `null` with a signal means the process was killed rather than exiting. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  /**
   * DSpatch stopped it. Separate from the exit code because a killed run must
   * never be read as a result: its output is whatever had been produced so far.
   */
  readonly killedByDspatch: boolean;
  readonly stdout: string;
  readonly stderr: string;
  /** Output exceeded what DSpatch keeps, so what is shown is the first part. */
  readonly outputTruncated: boolean;
  readonly durationMs: number;
  readonly startedAtUtc: string;
  readonly finishedAtUtc: string;

  /**
   * The code this ran against.
   *
   * Hashed immediately before the process started, so the result is bound to
   * content rather than to a moment in time. `afterRunSnapshotId` is hashed
   * immediately after it finished: when the two differ, the command itself wrote
   * into the working copy.
   */
  readonly snapshotId: string | null;
  readonly afterRunSnapshotId: string | null;
  readonly baselineSnapshotId: string;
  readonly gitHeadRevision: string | null;

  /**
   * Whether this run says anything about the code, decided in the main process.
   *
   * The window displays this field and never computes a pass of its own, which is
   * what makes AC#6 structural rather than a matter of the renderer remembering
   * to check `killedByDspatch` in every place it shows a result.
   */
  readonly verdict: TestVerdict;
  readonly verdictHeadline: string;
  /** The attempt this run belongs to, so an unknown outcome can be reconciled. */
  readonly attemptId: string;
}

/**
 * Whether the displayed result still describes the code on disk.
 *
 * AC#8 is explicit that an earlier result must not automatically apply after
 * another code change. This is how that is decided: by re-hashing the working
 * copy and comparing snapshot identities, not by elapsed time.
 */
export interface TestFreshness {
  readonly kind: 'no-result' | 'unknown' | 'current' | 'stale';
  readonly testedSnapshotId: string | null;
  readonly afterRunSnapshotId: string | null;
  readonly currentSnapshotId: string | null;
  /** The command wrote into its own working copy. `null` when undetermined. */
  readonly commandChangedWorkspace: boolean | null;
  readonly headline: string;
  readonly checkedAtUtc: string;
  /** How long the check took, so the caller can space out repeated checks. */
  readonly durationMs: number;
  /**
   * The result's meaning for the code on disk now: the verdict and the freshness
   * combined in the main process, so the window has no way to render a pass the
   * evidence does not support.
   */
  readonly presentedStatus: PresentedTestStatus;
  readonly presentedHeadline: string;
}

// --- Saved conversations (DSP-4) ---------------------------------------------
//
// Everything below is the shape of what survives the window closing. Three rules
// run through all of it.
//
// **A saved result is evidence, never an instruction.** No field here is ever
// written back into a working copy. The baseline bytes exist so the diff that was
// reviewed can be produced again for reading; they are not a patch, and DSpatch has
// no code path that applies them.
//
// **A missing value stays unknown.** Content that was too large to keep carries the
// reason it was left out, so a file whose diff cannot be shown after a restart says
// why rather than appearing unchanged.
//
// **Secrets are excluded by construction.** There is no field for the credential,
// the account address or the backend URL, so no filter has to remember to remove
// them. `ConnectionStatus` is not part of a conversation and never reaches one.

/** One turn of a saved conversation, in the order it was sent. */
export interface StoredMessage {
  /**
   * Position in the conversation, written down rather than left to array order.
   *
   * AC#1 is specifically about message order surviving. An index that exists only
   * as a JSON array position is one careless `sort` or merge away from being wrong
   * with nothing to detect it.
   */
  readonly ordinal: number;
  readonly dspatchRunId: string;
  readonly prompt: string;
  /** The answer as it was assembled from the stream, or the final message. */
  readonly answer: string;
  readonly deltaCount: number;
  readonly toolEvents: number;
  /** The provider's own terminal word, or `null` when none ever arrived. */
  readonly terminalStatus: string | null;
  readonly errorMessage: string | null;
  /** `null` means no usage record arrived — unknown, never 0. */
  readonly totalTokens: number | null;
  readonly startedAtUtc: string;
  readonly finishedAtUtc: string | null;
  /**
   * The recap DSpatch put in front of this prompt, verbatim, or `null`.
   *
   * Non-null only on the first message of a session that could **not** resume the
   * conversation's earlier provider session. It is kept because AC#2 asks which
   * saved context was actually resent, and a record that says "some context was
   * resent" does not answer that. Added after the first files were written, so an
   * older file simply has no such field and reads back as `null` — which is the
   * truth about those messages.
   */
  readonly resentContext: string | null;
}

/**
 * One file of the session baseline as it was saved.
 *
 * The hash is always there, because it is what establishes that a file changed. The
 * bytes are there when they fit in the persistence budget, because only they can
 * show *how*. When they do not fit, `omissionReason` says so and the restored diff
 * for that file reports the same reason instead of a patch.
 */
export interface StoredBaselineFile {
  readonly relPath: string;
  readonly sha256: string;
  readonly bytes: number;
  /** Base64 of the baseline content, or `null` with a reason beside it. */
  readonly contentBase64: string | null;
  readonly omissionReason: string | null;
}

export interface StoredBaseline {
  readonly info: BaselineInfo;
  readonly root: string;
  readonly files: readonly StoredBaselineFile[];
  readonly retainedFileCount: number;
  readonly retainedBytes: number;
  /** What this baseline can and cannot reproduce, in words. */
  readonly note: string;
}

/** The project a conversation is about, as it was when the conversation was saved. */
export interface StoredProject {
  readonly path: string;
  readonly git: GitBaselineInfo;
}

/** The provider session a conversation was last worked in. Identity, not a handle. */
export interface StoredSession {
  readonly dspatchSessionId: string;
  readonly providerSessionId: string;
  readonly modelRequested: string;
  readonly createdAt: string;
  readonly toolPolicy: string;
  readonly origin: SessionOrigin;
  readonly workspaceOrigin: string;
  readonly suggestedTestCommand: string;
  readonly suggestedTestCwd: string;
  readonly testCommandNote: string;
}

/** One conversation, as one file. */
export interface StoredConversation {
  readonly formatVersion: number;
  readonly conversationId: string;
  readonly createdAtUtc: string;
  readonly savedAtUtc: string;
  readonly appVersion: string;
  readonly project: StoredProject;
  readonly session: StoredSession;
  readonly messages: readonly StoredMessage[];
  readonly attempts: readonly StoredAttempt[];
  readonly testRuns: readonly TestOutcome[];
  /** The attempt of the result the window was showing, so it can be found again. */
  readonly lastTestAttemptId: string | null;
  readonly baseline: StoredBaseline | null;
  /**
   * The diff that was actually reviewed, kept verbatim.
   *
   * AC#6 asks for the *previously reviewed* diff to be readable after a restart,
   * which is a stronger claim than "a diff can be produced again": this is the
   * text that was on screen, with the two snapshot identities it named.
   */
  readonly reviewedDiff: WorkspaceReport | null;
}

/** The project of a restored conversation, plus whether it is still there. */
export interface RestoredProject {
  readonly path: string;
  readonly exists: boolean;
  /** git state as recorded when the conversation was saved, not as it is now. */
  readonly gitAtSave: GitBaselineInfo;
}

/**
 * What restoring deliberately did not do.
 *
 * Three zeroes that are measurements rather than defaults: AC#3 requires that
 * nothing is automatically repeated on restart, and a window that merely omits to
 * mention restarting anything is indistinguishable from one that quietly did.
 */
export interface RestoreRepeatCount {
  readonly providerRuns: number;
  readonly commands: number;
  readonly workspaceWrites: number;
  readonly note: string;
}

export interface RestoredReconciliation {
  /** Saved attempts that were unresolved, each with what it is now. */
  readonly attempts: readonly AttemptReconciliation[];
  readonly needsAcknowledgement: {
    readonly agentTurn: readonly string[];
    readonly command: readonly string[];
  };
  readonly note: string;
  readonly repeated: RestoreRepeatCount;
}

/**
 * A saved execution result, and what it means for the code on disk **now**.
 *
 * `freshness` is produced by the same rule the live panel uses, against a fresh
 * hash of the working copy taken during the restore. A result saved against code
 * that has since changed therefore comes back as `passed for older code`, not as a
 * pass — the restart is not a way around AC#6.
 */
export interface RestoredTestResult {
  readonly outcome: TestOutcome;
  readonly freshness: TestFreshness;
  readonly note: string;
}

/** The diff that was reviewed before the restart, and whether it still fits the disk. */
export interface RestoredDiff {
  readonly report: WorkspaceReport;
  /** The working copy's identity during the restore. `null` if it could not be read. */
  readonly currentSnapshotId: string | null;
  /**
   * Whether the disk still matches the snapshot this diff was taken against.
   * `false` means the diff is a historical record; `null` means unreadable.
   */
  readonly stillDescribesDisk: boolean | null;
  readonly note: string;
}

/**
 * A saved conversation, read back.
 *
 * There is no session handle in here, and that absence is the design: restoring
 * brings back history, not activity. Continuing means opening the project again,
 * at which point the reconciliation above has to be dealt with first.
 */
export interface RestoredConversation {
  readonly conversationId: string;
  readonly filePath: string;
  readonly formatVersion: number;
  readonly createdAtUtc: string;
  readonly savedAtUtc: string;
  readonly project: RestoredProject;
  readonly session: StoredSession;
  readonly messages: readonly StoredMessage[];
  readonly attempts: readonly AttemptInfo[];
  readonly reconciliation: RestoredReconciliation;
  readonly testResult: RestoredTestResult | null;
  readonly reviewedDiff: RestoredDiff | null;
  /** What was restored and what was not, for the window to show as it is. */
  readonly statement: string;
  readonly readOnly: boolean;
  /** Non-null when part of the file could not be used, saying which part. */
  readonly error: string | null;
}

/** What `cancelRun` could measure immediately. */
export interface CancelOutcome {
  readonly requestedAtUtc: string;
  /** Time for the provider call to resolve. Milliseconds, one decimal. */
  readonly elapsedMs: number;
  readonly error: string | null;
  /**
   * Whether the terminal state was decided locally or by the provider is not
   * knowable from this call. `watchSeconds` says how long DSpatch will keep
   * looking for continued provider-side work afterwards.
   */
  readonly watchSeconds: number;
}

/**
 * Evidence about whether the provider kept working after cancellation.
 *
 * This is the one open question from substep 6: `cancel()` reported `cancelled`
 * far too quickly to contain a round trip, so the terminal state is decided
 * locally. Continued tool events, later file changes or a later usage record
 * would settle it. `verdict` stays `unresolved` unless something is observed.
 */
export interface CancelObservations {
  readonly attempted: boolean;
  readonly watching: boolean;
  readonly cancelledAtUtc: string | null;
  readonly toolEventsBeforeCancel: number;
  readonly toolEventsAfterCancel: number;
  readonly eventsAfterTerminalEvent: number;
  readonly usageEventsAfterCancel: number;
  readonly workspaceFileCountAtCancel: number | null;
  readonly workspaceFileCountAfterWatch: number | null;
  readonly workspaceChangedAfterCancel: boolean | null;
  readonly watchedSeconds: number;
  readonly verdict:
    | 'unresolved'
    | 'provider-kept-working'
    | 'no-continued-work-observed';
  readonly note: string;
}

/**
 * An agent event as the renderer sees it.
 *
 * `rawProviderEvent` is deliberately dropped on the way across: the renderer
 * cannot use it, and it is not reliably structured-cloneable. The main process
 * keeps the unchanged event.
 */
export interface UiAgentEvent {
  readonly type: AgentEventType;
  readonly dspatchSessionId: string;
  readonly dspatchRunId: string;
  readonly at: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly toolStatus?: 'ok' | 'error';
  readonly approvalSummary?: string;
  readonly readings?: readonly UsageReading[];
  readonly status?: TerminalRunStatus;
  readonly errorMessage?: string;
  /**
   * On `run.started`: the recap DSpatch put in front of this prompt, verbatim.
   *
   * Absent when there was none, which is the normal case. It crosses the bridge
   * with the run that carried it so the window can answer "what was this session
   * told" about that message rather than in general.
   */
  readonly resentContext?: string;
}

/** Token totals seen for one turn. Every field may be `null` — unknown, not 0. */
export interface TurnUsage {
  readonly totalTokens: number | null;
  readonly source: string;
}

/**
 * Instruction to drive the window through the whole workflow without a human.
 *
 * The point is evidence: the packaged artifact runs its own real UI controls and
 * records what reached the DOM, so "the window can do this" is checkable rather
 * than narrated. `null` means normal interactive operation.
 */
export type ScriptedScenario =
  | 'full-workflow'
  | 'interactive-chat'
  | 'review-and-test'
  /**
   * INTERACTION_MODEL §10 trials 4, 10 and 11, driven through the window.
   *
   * A loop run, two messages sent into it while it is working, and a second run
   * interrupted. It exists because the three scenarios above predate the
   * conversation behaviour entirely: none of them starts a loop run, so none of
   * them can see a handover in the thread, a message that joins a run rather than
   * starting a second one, or a stop that has been asked for and not yet observed.
   */
  | 'conversation-during-work'
  /**
   * INTERACTION_MODEL §10 trial 8, driven through the window with no provider call.
   *
   * A real project folder rather than a generated sample, because the whole subject is
   * the project being *the same one* next time: every other scenario opens a fresh
   * temp directory, so none of them could ever have caught a reopened project drawing
   * an empty thread. Messages, then the same folder opened again, then a check that
   * the conversation came back in order.
   *
   * Run the same scenario twice over one user-data directory and the second process is
   * the restart case, which is the one Niclas met.
   */
  | 'conversation-comes-back'
  /**
   * How the window reads: scrolling, Markdown, and where the chrome sits.
   *
   * It spends no provider call. The conversation is streamed by a local adapter
   * (`presentation-adapter.ts`), which is what makes a dozen turns affordable —
   * and a dozen turns is what it takes to have a conversation long enough to
   * scroll back in. What it shows is what the window does with text; it shows
   * nothing about the provider, and says so in its own report.
   */
  | 'presentation'
  /**
   * DSP-64: how an error reads, and that the refusal behind it still happens.
   *
   * Asks for a sample project with `DSPATCH_CHAT_WORKSPACE` pointing at a directory
   * DSpatch did not generate, so the generator refuses — which is both the error the
   * card is about and the guard DSP-61 must not have weakened. It makes no provider
   * call: the refusal comes before an adapter exists.
   */
  | 'errors-read-well';

export interface ScriptedRunPlan {
  readonly enabled: true;
  /**
   * `full-workflow` is DSP-1's whole sequence over the generated sample project.
   * `interactive-chat` is the smaller one: open a project that already exists,
   * one streaming turn and one follow-up. It exists so that the interactive
   * surface can be evidenced without paying for four turns.
   * `review-and-test` is the diff and build/test sequence: a failing command, a
   * change request, the diff of what actually changed, a passing command, and a
   * later change that must make the passing result read as stale.
   * `conversation-during-work` is the conversation one: a loop run over a generated
   * throwaway project, two messages sent into it while it works, and a second run
   * interrupted — §10's trials 4, 10 and 11.
   */
  readonly scenario: ScriptedScenario;
  readonly turnTimeoutMs: number;
  /**
   * The node executable the main process found, for a scenario that needs to
   * type a runnable command into the window's own command field. `null` when
   * none was found, which the scenario reports rather than working around.
   */
  readonly nodePath: string | null;
  readonly note: string;
}

/** Where the renderer's own observations end up. */
export interface ScriptedRunReport {
  readonly passed: boolean;
  readonly exitCode: number;
  readonly steps: readonly unknown[];
  readonly failures: readonly string[];
  readonly observations: Readonly<Record<string, unknown>>;
}

/** The only main-process interface accessible to the renderer, via `contextBridge`. */
export interface DspatchBridge {
  getEnvironment(): Promise<EnvironmentInfo>;
  reportReady(ready: RendererReady): void;

  /** Connection status for the provider account. Never returns a credential. */
  getConnection(): Promise<ConnectionStatus>;

  /**
   * Choose the model DSpatch requests for ordinary messages in this conversation.
   *
   * Returns the model actually in force, which is what the window then states. It
   * takes effect on the next message: a provider turn already in flight is not
   * retargeted, and a loop run uses the model the loop was started with.
   */
  setRequestedModel(modelId: string): Promise<string>;

  /**
   * Whatever the top application menu asked the window to show.
   *
   * The menu lives in the main process — it is a real Electron menu bar, not a
   * drawing of one — so the items it offers arrive here rather than being clicked
   * in the document.
   */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;

  /**
   * Open the folder picker.
   *
   * The dialog is opened by the main process. A sandboxed renderer has no file
   * system access at all, and the path must be validated where the session is
   * actually created rather than where it was typed.
   */
  pickProjectFolder(): Promise<ProjectPickOutcome>;
  /** The remembered projects, plus any project named at startup. */
  listProjects(): Promise<ProjectListing>;
  /**
   * Drop remembered projects from the list, and nothing else.
   *
   * No folder is deleted and no saved conversation is removed: this edits one list
   * in DSpatch's settings file. DSP-5 found the list full of throwaway `%TEMP%`
   * repositories left by overnight verification, several already gone from disk,
   * with no way to remove any of them.
   */
  forgetProjects(projectPaths: readonly string[]): Promise<ForgetProjectsResult>;
  /**
   * What DSpatch has left behind in its own sample location. Reads only.
   *
   * A new session no longer reuses any of these — it generates into a folder of its
   * own — so this list exists for a person who wants the disk space back.
   */
  listSampleProjects(): Promise<SampleProjectsView>;
  /**
   * Delete the named sample projects, because the person asked.
   *
   * Only folders directly inside DSpatch's sample location can be removed: a path
   * anywhere else is refused here, in the main process, rather than trusted because
   * the renderer sent it. The folder an open session is using is refused too, and a
   * folder a live process is holding comes back as held with the reason.
   */
  cleanUpSampleProjects(paths: readonly string[]): Promise<SampleCleanupOutcome>;
  /** The saved conversations that could be continued. Summaries only. */
  listConversations(): Promise<ConversationListing>;
  /**
   * Read a saved conversation back.
   *
   * Restores history and nothing else: no provider session is opened, no command is
   * run and nothing is written into the working copy. An attempt that was unresolved
   * when DSpatch closed comes back as an explicit unknown that has to be named
   * before the conversation can be continued.
   */
  resumeConversation(conversationId: string): Promise<RestoredConversation>;
  /**
   * Write a copy of one conversation's file wherever the user chooses.
   *
   * A byte-for-byte copy, so it is offered even for a file DSpatch cannot read.
   * Set `DSPATCH_EXPORT_DIR` to skip the save dialog, which is what an automated
   * run does; interactively the dialog is the only thing that picks a path.
   */
  /**
   * Whether the conversation on screen is on disk. **Reading only.**
   *
   * Nothing here saves, retries a save or changes a file: it reports the last
   * attempt's outcome so the window can say the work is not safe while it still is
   * on screen and can still be copied out.
   */
  conversationSaveStatus(): Promise<ConversationSaveStatus>;
  exportConversation(conversationId: string): Promise<ConversationExportResult>;
  /** Show one conversation's file in the platform's file manager. */
  revealConversationFile(
    conversationId: string,
  ): Promise<{ readonly revealed: boolean; readonly note: string }>;
  /** Open a session over the requested working copy. Replaces any open session. */
  startChatSession(request: StartSessionRequest): Promise<ChatSessionInfo>;
  /**
   * Send a prompt.
   *
   * `acknowledgedAttemptIds` names every earlier attempt of this kind whose
   * outcome is unknown and which the user has been shown. Without all of them,
   * DSpatch refuses to start a second turn, rather than letting a retry become a
   * duplicate model job.
   */
  sendPrompt(
    text: string,
    acknowledgedAttemptIds?: readonly string[],
  ): Promise<{ readonly dspatchRunId: string }>;
  cancelRun(): Promise<CancelOutcome>;
  /**
   * Stop waiting for a send that has not produced a run yet.
   *
   * Cancel needs a run to cancel, and there is a real gap before one exists —
   * report 003 measured 11–12 s between Send and the first text. This is the way
   * out of that gap. If a run turns out to exist, it is asked to stop instead.
   */
  abandonSend(): Promise<AbandonOutcome>;
  getCancelObservations(): Promise<CancelObservations>;
  /** Every attempt and its explicit execution state. Cheap: nothing is hashed. */
  getRunState(): Promise<RunStateReport>;
  /** Run the command from the window as a child of the main process. */
  runWorkspaceTest(request: TestRunRequest): Promise<TestOutcome>;
  /** Stop a command that is still running, with its whole process tree. */
  stopWorkspaceTest(): Promise<{ readonly stopped: boolean; readonly note: string }>;
  /** Re-hash the working copy and say whether the last result still applies. */
  getTestFreshness(): Promise<TestFreshness>;
  getWorkspaceChanges(): Promise<WorkspaceReport>;
  /** Token totals for a turn. Fields may be `null`: unknown, never 0. */
  getTurnUsage(dspatchRunId: string): Promise<TurnUsage>;
  onAgentEvent(listener: (event: UiAgentEvent) => void): () => void;

  getScriptedRun(): Promise<ScriptedRunPlan | null>;
  reportScriptedRun(report: ScriptedRunReport): void;
  /**
   * Press a real item in the application menu. Scripted runs only.
   *
   * The menu bar is native, so a script in the document cannot see it, let alone
   * click it — and the session details and the way to another project are now
   * behind it. `false` means the main process has no such item, which is itself
   * the finding: the route a person is told to use is not there. The handler is
   * registered only when `DSPATCH_CHAT_RUN` is set, so an ordinary launch has no
   * second way of driving the application.
   */
  pressMenuItem(command: MenuCommand): Promise<boolean>;
  /**
   * Photograph the window now, under this name. Scripted runs only.
   *
   * What a layout looks like is not a number, and no gate in this file can stand
   * in for a person seeing it. `false` means no picture was asked for — the run
   * was started without `DSPATCH_CHAT_SHOT` — or that one could not be written,
   * which never changes what the run concludes about the window.
   */
  captureWindow(label: string): Promise<boolean>;
  /**
   * Make the window this many pixels wide. Scripted runs only.
   *
   * "The chat does not follow the window's width" is a claim about a window being
   * resized, and only the main process can resize one. Answers the content width the
   * renderer ended up with, so the trial measures the window it actually got rather
   * than the width it asked for. Registered with the two above — under
   * `DSPATCH_CHAT_RUN` and nowhere else.
   */
  setWindowWidth(width: number): Promise<number>;

  /**
   * Read a loop graph file for the editor.
   *
   * The renderer is sandboxed and validation needs a filesystem to reach a role
   * description, so the main process reads the file and resolves whatever roles the
   * file references. It does not validate: `loop-graph-load.ts` is renderer-safe and
   * the editor revalidates on every edit, which no round trip could keep up with.
   */
  openLoopGraph(request: LoopGraphOpenRequest): Promise<LoopGraphOpenOutcome>;
  /** Write a loop graph file. The editor has already serialised it. */
  saveLoopGraph(request: LoopGraphSaveRequest): Promise<LoopGraphSaveOutcome>;
  /**
   * Resolve role references the author has just changed.
   *
   * A binding edited in the inspector has to be answerable without saving, because
   * "resolves to nothing" is the difference between a broken reference and an agent
   * with no instructions.
   */
  resolveLoopRoles(references: readonly RoleReference[]): Promise<readonly ResolvedRoleEntry[]>;
  /**
   * Live-run the graph text the editor serialised from the canvas.
   *
   * Dry-run stays in the window: `loop-run.ts` has no Node imports. Live needs
   * the adapter and an isolated workspace, so it crosses here. The payload is
   * the drawing, not a path — a stale file must not be what runs.
   */
  startEditorLoopRun(request: EditorLoopRunRequest): Promise<EditorLoopRunOutcome>;
  /** Stop a live editor run. Does not reset the graph or the workspace. */
  cancelEditorLoopRun(): Promise<EditorLoopCancelOutcome>;
  /**
   * Open the loop editor in its own window, beside the chat.
   *
   * DSP-28 #1. The editor used to replace the chat in one window, and Niclas met the
   * consequence directly: he opened the editor, came back, and his project was gone.
   * Keeping the chat mounted and hidden repaired that and remains a workaround — an
   * editor and a conversation are two things a person wants side by side.
   *
   * **This starts nothing.** Opening, closing and reopening the view never starts,
   * cancels or duplicates work; a run in progress carries on either way. Asking twice
   * focuses the window that is already open rather than making a second one.
   */
  openLoopEditor(): Promise<LoopEditorWindowOutcome>;
  /**
   * Every addressed thing that happens to a loop run, in any window.
   *
   * **Addressed to a run, not sent to a sender.** The journal used to go to whichever
   * window invoked the run, which is indistinguishable from correct until there are
   * two windows: a chat-loop run then has nothing to send to the editor window
   * watching the graph. Each event carries the run id and the graph version, and the
   * window drops what is not about the run it is showing — see `eventBelongsTo` in
   * `shared/loop-run-view.ts`.
   */
  onLoopRunEvent(listener: (event: LoopRunEvent) => void): () => void;
  /**
   * Which run is walking now, for a window that opened halfway through.
   *
   * **A read.** It starts nothing and repeats nothing; asking twice is the same as
   * asking once. Returns `null` when no run is in progress.
   */
  currentLoopRun(): Promise<LiveRunAnnouncement | null>;
  /**
   * Walk dspatch-chat-loop on the project already open in chat.
   *
   * The composer's text is the entry mandate. Switching Use loop off cancels
   * without resetting files. Editor Run is a different binding.
   */
  startChatLoopRun(request: ChatLoopRunRequest): Promise<ChatLoopRunOutcome>;
  cancelChatLoopRun(): Promise<ChatLoopCancelOutcome>;
  onChatLoopJournal(listener: (entry: RunJournalEntry) => void): () => void;
  /**
   * What an agent node said during a chat-loop run.
   *
   * Separate from the journal, which is the run's history: this is the agent's own
   * words, and it is what the conversation shows as the answer to the mandate.
   */
  onChatLoopReply(listener: (reply: ChatLoopReply) => void): () => void;
  /**
   * What the provider reports while a loop step is working, as it happens.
   *
   * Separate from the reply, which arrives once the turn is over. This is the channel
   * that makes a step legible while it runs — streamed reply text, tool calls
   * starting and finishing, and a provider that says it is waiting on a person.
   * `waitForTurn` handled three event types and none of them was one of these, which
   * is why a loop run used to be an opaque call with a report at the end of it.
   *
   * Carries no private reasoning: `reasoning.delta` is deliberately not forwarded.
   */
  onChatLoopActivity(listener: (activity: StepActivity) => void): () => void;
  /**
   * Choose the chat loop, or unchoose it, without starting anything.
   *
   * `Use loop` picks a graph. Until now that was invisible until the first send, so
   * the graph only ever appeared once work had already begun. This announces the
   * chosen drawing to any graph view that is open, with its entry step marked *ready*
   * — a different claim from *running*, and one no journal entry contradicts because
   * there are none.
   *
   * **A read and an announcement, nothing else.** It starts no run, opens no window
   * and writes no file, and it will not displace a run that is walking.
   */
  prepareChatLoop(chosen: boolean): Promise<ChatLoopPrepareOutcome>;
  /**
   * Add a message to the run already walking, rather than starting a second one.
   *
   * The composer routes here whenever a loop run is in flight — see
   * `composerSendRoute`. It is the reason the box can be used during a run
   * without the hazard DSP-53 #2 and DSP-32 #4 both name: there is no path from a
   * press of Send during a run to a second walk in the same working copy.
   */
  addLoopInstruction(request: AddLoopInstructionRequest): Promise<AddLoopInstructionOutcome>;
  /** Which step took a message, or that the run ended before any did. */
  onLoopInstruction(listener: (event: LoopInstructionEventPayload) => void): () => void;
  /**
   * The loop runs kept for one conversation, read back from disk.
   *
   * **Reading only.** Nothing here resumes, repeats or re-runs anything: no agent
   * call, no command, no file change. An incomplete run reads back as incomplete
   * and stays that way. Resuming a run is a later delivery and is deliberately not
   * reachable from this call.
   */
  listRunRecords(conversationId: string): Promise<readonly StoredRunRecordEntry[]>;
  /**
   * Ask the run to pause: let the step that is running finish, then stop before
   * starting another.
   *
   * **A request, and the outcome never claims more than it achieved.** While a
   * provider call or a command is in flight the run has not paused, and both the note
   * here and `controlPhase` in `shared/loop-control.ts` say *pause requested* until the
   * step actually ends. Cancel is the separate action for abandoning work in progress.
   */
  requestLoopPause(): Promise<LoopControlOutcome>;
  /** Clear a pause and let exactly one held work step start. Repeats nothing. */
  continueLoop(): Promise<LoopControlOutcome>;
  /**
   * Choose who decides the next step, during a run or before one.
   *
   * Changes that and nothing else: the mandate, the graph version, the history, the
   * results and the budgets already spent all survive it, no new run is created, and no
   * step that has already run is run again.
   */
  setLoopMode(mode: LoopMode): Promise<LoopControlOutcome>;
  /** What the control is now, for a window that has just opened. A read. */
  loopControl(): Promise<LoopControlReport>;
  /** Every change to who decides the next step, in every window. */
  onLoopControl(listener: (report: LoopControlReport) => void): () => void;
}

/**
 * What came of choosing or unchoosing the chat loop.
 *
 * `not-shown` is a real answer rather than a failure: a graph that could not be read
 * or does not validate means the graph view has nothing honest to draw, and the
 * `note` says which. Nothing about sending a mandate depends on it — `Use loop`
 * stays ticked and `startChatLoopRun` refuses for itself with its own reason, so a
 * preview that cannot be drawn never becomes a reason work cannot start.
 */
export type ChatLoopPrepareOutcome =
  | { readonly kind: 'shown'; readonly run: LiveRunAnnouncement }
  | { readonly kind: 'stood-down' }
  | { readonly kind: 'not-shown'; readonly note: string };

/** Which graph to open: the one Niclas asks for by name, or one he picks. */
export type LoopGraphOpenRequest =
  | { readonly kind: 'development-loop' }
  | { readonly kind: 'pick' }
  | { readonly kind: 'path'; readonly path: string };

/**
 * A role reference and what it resolved to, `null` meaning it resolves to nothing.
 *
 * `key` is how the renderer indexes them, because a reference is three fields and a
 * resolver is a function of all three.
 */
export interface ResolvedRoleEntry {
  readonly key: string;
  readonly role: ResolvedRole | null;
}

export type LoopGraphOpenOutcome =
  | {
      readonly kind: 'read';
      /** Absolute, and what a later save writes to. */
      readonly path: string;
      /** Relative to the project root, for the window's title. */
      readonly displayPath: string;
      readonly text: string;
      /** Preserved on save, so moving a node does not rewrite every line. */
      readonly newline: '\n' | '\r\n';
      /** Role paths are relative to this, not to the graph file. */
      readonly projectRoot: string;
      readonly roles: readonly ResolvedRoleEntry[];
    }
  | { readonly kind: 'cancelled' }
  | {
      /** No file, and why. A missing graph is not an error the editor invented. */
      readonly kind: 'unavailable';
      readonly note: string;
    };

export interface LoopGraphSaveRequest {
  readonly path: string;
  readonly text: string;
}

export type LoopGraphSaveOutcome =
  | { readonly kind: 'written'; readonly path: string; readonly bytes: number; readonly atUtc: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly note: string };

/** The canvas, serialised, which is what a live run from the editor walks. */
export interface EditorLoopRunRequest {
  readonly runId: string;
  readonly text: string;
}

export type EditorLoopRunOutcome =
  | { readonly kind: 'refused'; readonly reason: string }
  | {
      readonly kind: 'finished';
      readonly result: RunResult;
      readonly journalText: string;
      readonly workspaceNote: string;
    }
  | {
      readonly kind: 'cancelled';
      readonly result: RunResult;
      readonly journalText: string;
      readonly workspaceNote: string;
    }
  | { readonly kind: 'failed'; readonly note: string };

export interface EditorLoopCancelOutcome {
  readonly cancelled: boolean;
  readonly note: string;
}

/**
 * What happened when the editor window was asked for.
 *
 * `focused` rather than a second window is the deliberate answer to "what if the user
 * opens it twice": two editors of one file are two drawings with no way to reconcile
 * them, and the second Save would silently overwrite the first author's work. One
 * window, brought to the front. Said out loud in the outcome so the chat can tell the
 * user which of the two happened rather than appearing to do nothing.
 */
export interface LoopEditorWindowOutcome {
  readonly kind: 'opened' | 'focused' | 'failed';
  readonly note: string;
}

/** Mandate from the composer; workspace is the open chat project. */
export interface ChatLoopRunRequest {
  readonly runId: string;
  readonly mandate: string;
}

/**
 * What was written to the run record, handed back with the run.
 *
 * The window shows **this** rather than working the outcome out again from the
 * result. DSP-26 #1 is the rule that one run may not have two state models, and
 * the cheapest way to break it is to let the chat derive what the record already
 * says: that is exactly how a green "completed" badge came to sit over a run that
 * had stopped at the *Failed or abandoned* terminal, with the badge reading the
 * walk's status and the sentence beside it reading the terminal.
 *
 * Optional because a record is not guaranteed. A refusal before the run starts
 * writes nothing, and a disk that will not take the file must not take the run
 * down with it — `recordNote` says so when that happens.
 */
export interface ChatLoopRecordInfo {
  readonly ending: RecordedRunEnding;
  /** Where it was kept, so a person can open it. `null` when nothing was written. */
  readonly recordPath: string | null;
  /** What could not be written, or `null`. Never silent about a lost record. */
  readonly recordNote: string | null;
}

export type ChatLoopRunOutcome =
  | { readonly kind: 'refused'; readonly reason: string }
  | {
      readonly kind: 'finished';
      readonly result: RunResult;
      readonly journalText: string;
      readonly workspaceNote: string;
      readonly recorded?: ChatLoopRecordInfo;
    }
  | {
      readonly kind: 'cancelled';
      readonly result: RunResult;
      readonly journalText: string;
      readonly workspaceNote: string;
      readonly recorded?: ChatLoopRecordInfo;
    }
  | { readonly kind: 'failed'; readonly note: string };

/** One kept run, as the window reads it back after a restart. */
export interface StoredRunRecordEntry {
  readonly runId: string;
  readonly filePath: string;
  readonly record: ParsedRunRecord | null;
  readonly error: string | null;
  readonly recovery: string | null;
}

export interface ChatLoopCancelOutcome {
  readonly cancelled: boolean;
  readonly note: string;
}

/**
 * One agent node's reply during a chat-loop run.
 *
 * `runId` is the id the window generated for the send, so the reply lands on the
 * entry that echoed the mandate rather than on whatever is newest. The text is the
 * agent's own, whole: it is never truncated or summarised on the way across.
 */
export interface ChatLoopReply {
  readonly runId: string;
  readonly nodeId: string;
  /** The node's label from the graph that was walked. */
  readonly nodeLabel: string;
  readonly occurrence: number;
  readonly text: string;
  /** The provider run's terminal status, or `null` if it never reported one. */
  readonly terminalStatus: string | null;
}

/** A message typed into a run that is already walking. */
export interface AddLoopInstructionRequest {
  /** The run it was typed into. A message is scoped to the work it concerns. */
  readonly runId: string;
  readonly text: string;
}

/**
 * What became of that message, decided in the main process.
 *
 * `received` says only that DSpatch is holding it — never that an agent has it.
 * That distinction is §4.4's, and having the receipt itself unable to express
 * "delivered" is how it is kept: the delivery is announced later, by the step
 * that actually took it, on {@link DspatchBridge.onLoopInstruction}.
 */
export type AddLoopInstructionOutcome =
  | {
      readonly kind: 'received';
      readonly instructionId: string;
      readonly receivedAtUtc: string;
      /** How many of yours are now waiting for this run, this one included. */
      readonly waiting: number;
    }
  | {
      readonly kind: 'refused';
      /** Why it was not taken, in words that say where the text now is. */
      readonly reason: string;
    };

/** A message reaching a step, or failing to before the run ended. */
export type LoopInstructionEventPayload =
  | {
      readonly kind: 'delivered';
      readonly runId: string;
      readonly instructionIds: readonly string[];
      readonly nodeId: string;
      readonly nodeLabel: string;
      readonly occurrence: number;
      readonly atUtc: string;
    }
  | {
      readonly kind: 'run-ended';
      readonly runId: string;
      /** Ids that never reached a step. Empty when everything was delivered. */
      readonly undelivered: readonly string[];
    };

/**
 * Channel names. Preload must write these as literals: a shared constant would
 * be a value, which cannot be imported into sandboxed preload. The type catches
 * misspellings during type checking instead.
 */
export type BridgeChannel =
  | 'dspatch:get-environment'
  | 'dspatch:renderer-ready'
  | 'dspatch:get-connection'
  | 'dspatch:set-model'
  | 'dspatch:menu-command'
  | 'dspatch:pick-project'
  | 'dspatch:list-projects'
  | 'dspatch:forget-projects'
  | 'dspatch:list-sample-projects'
  | 'dspatch:clean-sample-projects'
  | 'dspatch:list-conversations'
  | 'dspatch:conversation-save-status'
  | 'dspatch:resume-conversation'
  | 'dspatch:export-conversation'
  | 'dspatch:reveal-conversation'
  | 'dspatch:start-session'
  | 'dspatch:send-prompt'
  | 'dspatch:cancel-run'
  | 'dspatch:abandon-send'
  | 'dspatch:cancel-observations'
  | 'dspatch:run-state'
  | 'dspatch:run-test'
  | 'dspatch:stop-test'
  | 'dspatch:test-freshness'
  | 'dspatch:workspace-changes'
  | 'dspatch:turn-usage'
  | 'dspatch:agent-event'
  | 'dspatch:get-scripted-run'
  | 'dspatch:scripted-run-report'
  | 'dspatch:press-menu-item'
  | 'dspatch:capture-window'
  | 'dspatch:set-window-width'
  | 'dspatch:open-loop-graph'
  | 'dspatch:save-loop-graph'
  | 'dspatch:resolve-loop-roles'
  | 'dspatch:open-loop-editor'
  | 'dspatch:start-editor-loop-run'
  | 'dspatch:cancel-editor-loop-run'
  | 'dspatch:loop-run-event'
  | 'dspatch:current-loop-run'
  | 'dspatch:start-chat-loop-run'
  | 'dspatch:cancel-chat-loop-run'
  | 'dspatch:chat-loop-journal'
  | 'dspatch:chat-loop-reply'
  | 'dspatch:chat-loop-activity'
  | 'dspatch:prepare-chat-loop'
  | 'dspatch:add-loop-instruction'
  | 'dspatch:loop-instruction-event'
  | 'dspatch:list-run-records'
  | 'dspatch:loop-control'
  | 'dspatch:read-loop-control'
  | 'dspatch:request-loop-pause'
  | 'dspatch:continue-loop'
  | 'dspatch:set-loop-mode';
