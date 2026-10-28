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
  AgentCommandEnding,
  AgentCommandRecord,
  AgentEventType,
  CapabilityReport,
  ProviderId,
  RunEnd,
  TerminalRunStatus,
  UsageReading,
} from '../adapter/types';
import type { StepActivity } from './loop-activity';
import type { LoopControlOutcome, LoopControlReport, LoopMode } from './loop-control';
import type { DefinitionRowDisplay } from './loop-definition';
import type { ResolvedRole, RoleReference } from './loop-graph';
import type { ParsedRunRecord, RecordedRunEnding } from './loop-record';
import type { RunJournalEntry, RunResult } from './loop-run';
import type { LiveRunAnnouncement, LoopRunEvent } from './loop-run-view';
import type { LoopRunAgentInfo, LoopRunAgentQuery } from './loop-run-agent-text';
import type { UnsavedDrawingAnswer, UnsavedDrawingOccasion } from './unsaved-drawing';
import type { DirectoryPage, FileView, WorkspaceView } from './workspace-folders';

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
  /**
   * The adapter of the session open at startup, or `null` - always `null` since
   * DSP-136: no adapter is built at startup. The window's "How this is wired"
   * follows the open session (`ChatSessionInfo.adapter`) instead.
   */
  readonly adapter: AdapterInfo | null;
  /**
   * DSP-117: whether Claude can be chosen in this launch, for the agent choice in
   * the *Open a project* panel, before any session exists.
   */
  readonly agentChoice: AgentChoiceInfo;
  /**
   * DSP-136: the agent the person last chose explicitly, kept under `userData`, or
   * `null` when none has been chosen (a fresh installation). Never a default.
   */
  readonly chosenAgent: StoredSessionProvider | null;
}

/** An adapter's identity and capabilities: provider plus transport. */
export interface AdapterInfo {
  readonly id: string;
  readonly capabilities: CapabilityReport;
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
  /** DSP-149: Open Project… — the folder chooser, then that folder's workspace. */
  | 'open-project'
  /** DSP-149: the conversation history, every saved conversation with its secondary actions. */
  | 'show-history'
  /**
   * DSP-149: a generated sample project, for development and test flows only. The menu
   * item exists only in an unpackaged build; the start page no longer offers it.
   */
  | 'new-sample-project'
  /**
   * Show what DSpatch has left behind in its own sample location (DSP-61).
   *
   * It shows; it does not remove. Removal is a button beside the list, because
   * Niclas's decision was that clearing out old sample projects is a separate act
   * a person performs, not something that happens on the way past.
   */
  | 'show-sample-projects'
  /**
   * Open a standalone `.graph.json` for editing (DSP-85 #6).
   *
   * The odd one out, and named here for one reason: it is handled entirely in the main
   * process — dialog, editor window, delivery — so no window listens for it. It is in this
   * set because {@link DspatchBridge.pressMenuItem} presses items by command, which is how
   * a window trial reaches a real menu item at all.
   */
  | 'open-graph-file'
  /**
   * Show the run journal in the graph editor (DSP-86 #9).
   *
   * The journal used to be a pane under the canvas, open whenever there was anything to
   * put in it. It is diagnostics — a raw list of entries a person reads when something
   * needs explaining — and it was taking a third of the height of the one view this card
   * is about. Here it is reachable when wanted and absent the rest of the time, which is
   * what the card asks for in those words.
   */
  | 'show-run-journal';

/** One model the account may request, as the provider named it. */
export interface ModelChoice {
  readonly id: string;
  readonly displayName: string;
  /** What the provider says about the model, when it says anything (DSP-149). */
  readonly description?: string;
  /** The provider's own id an alias resolves to, when it says (DSP-149). */
  readonly resolvedId?: string;
}

/**
 * The models one provider offers this account, from the provider SDK's own discovery
 * (DSP-149), and the one chosen. `chosen` `''` means no choice: the provider's own
 * default model is used, not a model DSpatch picked.
 */
export interface ModelListing {
  readonly provider: StoredSessionProvider;
  readonly models: readonly ModelChoice[];
  readonly chosen: string;
  /** Why the list could not be read, in a sentence; `null` when it was. */
  readonly error: string | null;
  /** Where the list came from, for Session details. */
  readonly source: string;
}

/**
 * Connection status for the provider account.
 *
 * `account` is `string | null` and `null` means **unknown**, not "no account".
 * The same rule as cost: a missing value is never presented as an answer.
 */
export type ConnectionStatus =
  /**
   * DSP-136: Cursor's connection was not checked, because Cursor is not the chosen
   * agent (or nobody asked). Not a problem and not a verdict about the login.
   */
  | { readonly kind: 'not-checked' }
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

/**
 * One workspace in Recent projects (DSP-149).
 *
 * `id` is `null` only for the project named at startup by `DSPATCH_PROJECT_PATH`,
 * which is offered before it has a workspace; opening it creates or reopens one.
 */
export interface RecentWorkspaceEntry {
  readonly id: string | null;
  readonly name: string;
  /** The first is the primary: the agent's working directory. */
  readonly folders: readonly string[];
  /** `null` for the startup project, which has not been opened through DSpatch yet. */
  readonly lastOpenedAtUtc: string | null;
  /** Checked when the list was read. A remembered folder can have been moved. */
  readonly primaryExists: boolean;
}

/** Every workspace in Recent, most recently opened first, and the state of its file. */
export interface RecentWorkspaces {
  readonly entries: readonly RecentWorkspaceEntry[];
  /** Non-null means the list is incomplete or absent, or a change was not saved, and says why. */
  readonly error: string | null;
  /** The file is from a newer DSpatch and will be read but not rewritten. */
  readonly readOnly: boolean;
  /**
   * The conversation begun before any workspace was chosen, when it has messages; the
   * window reopens it at startup so it is there as it was left. `null` otherwise.
   */
  readonly looseConversationId: string | null;
}

/** Which workspace to open: one from Recent, or the workspace of a chosen first folder. */
export type WorkspaceOpenRequest = (
  | { readonly workspaceId: string; readonly provider?: StoredSessionProvider | null }
  | { readonly folder: string; readonly provider?: StoredSessionProvider | null }
) & {
  /** Start a new chat in the workspace rather than continue its last one. */
  readonly newChat?: boolean;
};

/**
 * What opening a workspace did. `refused` changes nothing: the conversation on screen
 * and the workspace that was open are as they were.
 */
export type WorkspaceOpenOutcome =
  | { readonly kind: 'opened'; readonly session: ChatSessionInfo; readonly workspace: WorkspaceView }
  | { readonly kind: 'refused'; readonly problem: string };

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
  /**
   * Read and never rewritten by this build: a newer format, or bytes it cannot
   * parse. `error` says which was found; `newerFormat` says whether it is the first.
   */
  readonly readOnly: boolean;
  /**
   * The one read-only cause that is a newer DSpatch rather than damage, so the row
   * may say so (WS-1 review S1). `formatVersion` then carries the version found.
   */
  readonly newerFormat: boolean;
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
 *
 * The fourth kind is the "try again" choice of DSP-121: the project already open is
 * reopened and the resume of its recorded provider session is attempted again, the
 * same way opening the folder would. Like every reopen it closes the current session
 * first, which stops a build or test command that is still running. Carries no path
 * for the same reason as the third kind. `acknowledgedAttemptIds` names the attempts
 * the user has seen for the unconfirmed-end refusal of DSP-122: for a session recorded
 * as a Claude provider session they are acknowledged in the working copy before the
 * resume is attempted, which is what lifts that refusal; for a Cursor session nothing
 * reads them (DSP-4's order, resume then the send gate, is unchanged).
 */
export type StartSessionRequest =
  /**
   * `provider` (DSP-117, DSP-136) is the agent chosen in the *Open a project* panel,
   * or `null` when none is chosen. A recorded session is resumed only when its
   * provider is the chosen one and available; otherwise the conversation opens with
   * no session and the named choices, and nothing is built or sent. Absent means
   * the agent last chosen in this installation, which may be none.
   */
  | {
      readonly kind: 'folder';
      readonly path: string;
      readonly provider?: StoredSessionProvider | null;
      /**
       * DSP-149: every folder of the workspace, the primary (`path`) first. Absent
       * means the one folder.
       */
      readonly folders?: readonly string[];
      /**
       * DSP-149: which conversation continues, decided by the host from the workspace:
       * its last chat, or `null` for a new one. Absent means the conversation last
       * worked in over this folder, as before.
       */
      readonly conversationId?: string | null;
    }
  /**
   * DSP-149: a conversation with no workspace, in an empty folder DSpatch owns and
   * never presents as the person's project. `conversationId` `null` starts a new one.
   */
  | {
      readonly kind: 'loose';
      readonly provider?: StoredSessionProvider | null;
      readonly conversationId?: string | null;
    }
  /**
   * DSP-149: the conversation on screen moves into a workspace and continues there in a
   * new provider session, with DSpatch's recap of it disclosed before the next message.
   */
  | {
      readonly kind: 'carry';
      readonly path: string;
      readonly folders: readonly string[];
      readonly conversationId: string;
      readonly workspaceName: string;
    }
  | { readonly kind: 'sample'; readonly provider?: StoredSessionProvider | null }
  /**
   * `provider` switches the conversation's agent: a new provider session with that
   * provider, never a resume, with the recap disclosed and removable before the next
   * Send. Absent means the provider already selected for this conversation.
   */
  | { readonly kind: 'new-provider-session'; readonly provider?: StoredSessionProvider }
  /**
   * Resume the recorded session again, with the provider it was recorded with. Also
   * what *Resume with <recorded>* sends (DSP-136): an explicit choice of that provider
   * for this conversation.
   */
  | { readonly kind: 'retry-resume'; readonly acknowledgedAttemptIds?: readonly string[] };

/** `no-workspace` (DSP-149): a conversation begun before any workspace was chosen. */
export type SessionOrigin = 'chosen-folder' | 'generated-sample' | 'no-workspace';

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
  /** DSP-149: the workspace's other folders, given to the agent beside the working directory. */
  readonly otherFoldersSent?: readonly string[];
  /**
   * DSP-149: DSpatch's own tools offered to the agent, each with the description the
   * model is given word for word. Absent or empty when none were offered.
   */
  readonly dspatchToolsSent?: readonly { readonly name: string; readonly description: string }[];
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
 * - `new-provider-session` — the user asked for a new session, or there was no
 *   earlier session to resume into. The model has been told nothing, and
 *   `contextToResend` is exactly what DSpatch will put in front of the next
 *   message to change that — unless the user removes it first.
 *
 * The three kinds below have **no provider session open** (DSP-121). Until DSP-121
 * a refused or failed resume fell through to `new-provider-session` on its own,
 * and the next save overwrote the recorded session ID with the new one, so a
 * temporary cause lost the pointer for good. Now DSpatch stops and asks:
 *
 * - `resume-refused` — the provider, or the adapter's own check, answered that
 *   the recorded session cannot be resumed; `resumeFailure` says which check it was.
 * - `resume-failed` — the attempt failed with an error that may be temporary.
 * - `resume-unavailable` — this adapter cannot resume at all. The provider was
 *   not asked.
 *
 * In all three the recorded session stays on record unchanged, nothing was opened
 * and nothing was sent, and `choices` lists what the user can do next.
 */
export type SessionContinuityKind =
  | 'first-session'
  | 'provider-session-resumed'
  | 'new-provider-session'
  | 'resume-refused'
  | 'resume-failed'
  | 'resume-unavailable';

/**
 * What a refused or failed resume established, by the evidence and no further.
 *
 * - `provider-missing` — the provider itself answered that it does not have the
 *   session. Final, as far as that answer goes.
 * - `local-record-missing` — the adapter's local check found no readable record;
 *   the provider was not asked (DSP-122's Claude resume).
 * - `error` — the attempt failed with an error, quoted in `detail`.
 * - `unknown` — the evidence does not say which of the above it was.
 * - `unconfirmed-end` — not resumed because the conversation's last agent turn has
 *   no confirmed end in DSpatch's record (DSP-122). Produced only for a session
 *   recorded as a Claude provider session, before the adapter is asked anything;
 *   lifted by trying again with the attempt acknowledged.
 */
export type ResumeFailureKind =
  | 'provider-missing'
  | 'local-record-missing'
  | 'error'
  | 'unknown'
  | 'unconfirmed-end'
  /**
   * DSP-117: the recorded session belongs to another provider than the one selected
   * for this conversation. Never resumed across providers: no adapter call is made
   * and nothing is sent.
   */
  | 'provider-differs'
  /**
   * DSP-136: no session was opened because no agent is chosen, or because the
   * recorded provider cannot be used in this launch. No adapter was built.
   */
  | 'agent-choice';

export interface ResumeFailure {
  readonly kind: ResumeFailureKind;
  /** The error or answer, verbatim. */
  readonly detail: string;
  /** The provider's own code, unchanged, when the thrown error carried one. */
  readonly providerCode: string | null;
}

/**
 * What the user can do when no provider session is open (DSP-121).
 *
 * `new-session` in every such state; `try-again` only where trying again can work
 * in this build, so a retry that would only give the same answer is not offered
 * (see `ChatService`'s `noSessionChoices`). Reading the history is not a choice: it
 * is on screen in every state and needs no call to the main process.
 */
export type ContinuityChoice =
  | 'try-again'
  | 'new-session'
  /**
   * DSP-117: after Claude was refused by DSpatch's own credential rule, an explicit
   * new **Cursor** session, with the recap disclosed. Never taken silently.
   */
  | 'switch-to-cursor'
  /**
   * DSP-136: resume the recorded session with the provider it was recorded with,
   * offered when that provider is available but is not the chosen one (or none is
   * chosen). Sends `retry-resume`.
   */
  | 'resume-recorded';

/**
 * An earlier message of this conversation that may have reached the provider and
 * has no confirmed end: an unresolved agent-turn attempt in the conversation's
 * ledger. Acknowledged ones stay listed, flagged. The ledger records no session
 * ID, so this is "of this conversation", not "of the recorded session".
 */
export interface EarlierSendMayHaveReached {
  readonly attemptId: string;
  readonly label: string;
  readonly state: AttemptState;
  readonly acknowledged: boolean;
}

export interface SessionContinuity {
  readonly kind: SessionContinuityKind;
  /**
   * DSP-149 (Niclas's decision, 27 Oct 2026): `automatic` when the conversation moved
   * into a workspace and its context goes to the new provider session in the background,
   * with no panel, confirmation or extra message. The recap is still sent and recorded,
   * and shown under Session details. `contextCut` is set only if the conversation was
   * longer than DSpatch can carry; the window then says so in one line.
   */
  readonly contextTransfer?: 'automatic';
  readonly contextCut?: boolean;
  /**
   * Whether a provider session is open behind this `ChatSessionInfo`. Stated, so the
   * window never infers it from the kind. `false` in the three DSP-121 kinds: the
   * session fields then describe the **recorded** session, which is on record but
   * not open, and sending or cancelling is refused until the user chooses.
   */
  readonly providerSessionOpen: boolean;
  /** The session DSpatch tried to continue. `null` when there was none. */
  readonly attemptedDspatchSessionId: string | null;
  /** Cursor's own agent ID for it, when resumption succeeded. */
  readonly resumedProviderSessionId: string | null;
  /** Why resumption was not used, in the provider's own words. */
  readonly resumeError: string | null;
  /** What the refused or failed resume established; `null` when it did not fail. */
  readonly resumeFailure: ResumeFailure | null;
  /** Earlier messages with no confirmed end; nothing in it is resent. */
  readonly earlierSendsMayHaveReached: readonly EarlierSendMayHaveReached[];
  /** Empty while a provider session is open; never offers a retry that cannot work. */
  readonly choices: readonly ContinuityChoice[];
  /**
   * DSP-136: the provider of the recorded session, when the no-session state is
   * about a recorded session; for *Resume with <recorded>*. Absent otherwise.
   */
  readonly recordedProvider?: StoredSessionProvider;
  /**
   * DSP-136: `true` when no session is open because no agent is chosen. The window
   * then asks the person to choose one; nothing was built or sent.
   */
  readonly agentNeeded?: boolean;
  /**
   * R1: the agent that was chosen but cannot be used in this launch, and why. Present
   * only with `agentNeeded`, so the window names it rather than saying none is chosen.
   */
  readonly unusableChoice?: { readonly provider: StoredSessionProvider; readonly reason: string };
  /**
   * The exact text DSpatch will put before the next message, or `null`.
   *
   * The literal string, not a description of it. "Which saved context was
   * actually resent" cannot be answered by a summary of the answer. `null` once
   * the user has removed the recap; a removed recap is not reinstated.
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
  /**
   * DSP-117: the agent selected for this conversation. For an open session, the
   * provider holding it; while none is open, the provider a new session would use,
   * or `null` when no agent is chosen (DSP-136).
   */
  readonly provider: StoredSessionProvider | null;
  /**
   * DSP-136: the adapter built for this session - holding the open provider session,
   * or asked to resume one - or `null` when none was built (no agent chosen, or
   * another agent chosen than the recorded one). What "How this is wired" shows.
   */
  readonly adapter: AdapterInfo | null;
  /** What the window needs to offer the agent choice. */
  readonly agent: AgentChoiceInfo;
}

/** DSP-117: whether Claude can be chosen in this launch, and how that is shown. */
export interface AgentChoiceInfo {
  /**
   * `true` only when this launch was started with a recorded authorization reference
   * **and** Claude support is installed (DSP-133).
   */
  readonly claudeEnabled: boolean;
  /** DSP-133: whether Claude support (`app/claude-support/`) was installed at launch. */
  readonly claudeInstalled: boolean;
  /**
   * DSP-133: the visible line under the agent choice when Claude support is not
   * installed (how to install it), or `null` when it is. Never a tooltip only.
   */
  readonly claudeNotInstalledText: string | null;
  /** Why Claude cannot be chosen, or what enabled it. Short; for the control's tooltip. */
  readonly claudeNote: string;
  /** The connection line for the selected agent, for Session details. */
  readonly connectionText: string;
  /** The tool policy the selected agent is given, as DSpatch sends it. */
  readonly toolPolicyText: string;
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
  /**
   * The conversation on screen is refused because its file must never be
   * overwritten by this build (a newer or unparsable format). No save, retried or
   * not, can succeed into it, so the window must not say that one will be tried.
   * `false` for every other failure, including a file that could not be read just
   * now: those are retried.
   */
  readonly readOnly: boolean;
  /**
   * Other conversations held in this window whose latest save failed (WS-1 follow-up).
   *
   * A conversation that is not on screen still changes: a command it started ends
   * late, a cancellation timer settles its turn, or its attempt is acknowledged from
   * an overlapping folder. Verifier 001 measured such a save failing with nothing said
   * to anyone, and the next conversation's successful save erasing the only record of
   * it. Each failure is kept for its own conversation until that conversation is saved
   * successfully. Empty when there is none.
   */
  readonly otherConversations: readonly {
    readonly conversationId: string;
    readonly filePath: string | null;
    readonly error: string;
    /**
     * The file is one DSpatch must never overwrite (a newer or unparsable format),
     * so no later save into it can succeed. Not set for a file that merely could
     * not be read at the moment of the save (a lock, a permission, a drive): that
     * save is refused too, and retried like any other failed one (WS-1 review N1).
     */
    readonly readOnly: boolean;
  }[];
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
  /**
   * DSP-149: the same comparison for every other folder of the workspace, each against
   * its own baseline, taken when the session opened or when the folder was added.
   */
  readonly otherFolders?: readonly FolderChangeReport[];
}

/** One non-primary folder's changes since its own baseline (DSP-149). */
export interface FolderChangeReport {
  readonly folderPath: string;
  readonly baselineSnapshotId: string;
  readonly baselineTakenAtUtc: string;
  readonly observedSnapshotId: string;
  readonly changed: readonly WorkspaceChange[];
  readonly added: readonly WorkspaceChange[];
  readonly removed: readonly WorkspaceChange[];
  readonly unchangedCount: number;
  readonly truncated: boolean;
  readonly coverageNote: string;
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
   *
   * Each entry names one attempt in one conversation ({@link AttemptRef}), which is
   * what the run state lists. See {@link AttemptAcknowledgement} for a bare ID.
   */
  readonly acknowledgedAttemptIds?: readonly AttemptAcknowledgement[];
}

/**
 * One attempt, in the conversation that holds it (WS-1 follow-up).
 *
 * An attempt ID alone is not an identity across conversations: files saved by
 * earlier builds can hold the same ID for different work, and verifier 001 measured
 * one acknowledgement of `dsp-attempt-0004` acknowledging two attempts in two files
 * and lifting both blocks. `conversationId` is `null` only for an attempt made with
 * no conversation open, which does not happen in practice.
 */
export interface AttemptRef {
  readonly conversationId: string | null;
  readonly attemptId: string;
}

/**
 * What a caller may pass to acknowledge an attempt.
 *
 * An {@link AttemptRef} names exactly one attempt. A bare ID is still accepted, for
 * callers that have no conversation to name, but it counts only where it names exactly
 * one unresolved attempt of the kind being gated in the working copy; an ID that names
 * two names neither, and the refusal says which conversations hold it.
 */
export type AttemptAcknowledgement = AttemptRef | string;

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
  /**
   * DSP-117: how the adapter said a cancelled run ended (`stopped` or `forced`),
   * when it said so. Absent for every attempt before DSP-117 and for every Cursor
   * turn, which reports no `end`; absent means not reported. Optional so files
   * written before it read back unchanged, without a format bump.
   */
  readonly runEnd?: RunEnd;
  /**
   * DSP-117: `true` when the adapter that ran this turn runs the provider as a
   * local process DSpatch started (the Claude adapter). Absent means not (Cursor).
   */
  readonly adapterProcess?: true;
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
  /**
   * The conversation that holds it. With `attemptId`, this is the attempt's identity
   * in the window: the run state can show attempts of several conversations sharing a
   * working copy, and two of them can carry the same ID (see {@link AttemptRef}).
   */
  readonly conversationId: string | null;
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
  /** See {@link StoredAttempt.runEnd}. */
  readonly runEnd?: RunEnd;
  /** See {@link StoredAttempt.adapterProcess}. */
  readonly adapterProcess?: true;
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
   * Every attempt a repeat of that kind must name. Empty means none.
   *
   * All of them, not the first: after a restart several attempts can be unknown at
   * once, and a gate that is satisfied by naming one of them lets the message
   * through with the others still unnamed — visible and counted, but not seen.
   *
   * Each with its conversation, and this is what the window sends back: one ID can
   * stand for two attempts here (see {@link AttemptRef}).
   */
  readonly needsAcknowledgement: {
    readonly agentTurn: readonly AttemptRef[];
    readonly command: readonly AttemptRef[];
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
  /**
   * DSP-145, DSP-146: the commands the agent ran in this turn, as DSpatch recorded them
   * (`requestedBy` says whether DSpatch started them). Absent in files written before
   * DSP-145 and in turns that ran none.
   */
  readonly commands?: readonly AgentCommandRecord[];
  /**
   * DSP-147: the steering messages sent into this turn while it worked, and what became
   * of each. Absent in files written before DSP-147 and in turns that had none.
   */
  readonly steering?: readonly StoredSteering[];
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

/** The providers a stored session can belong to. `copilot` has no session store yet. */
export type StoredSessionProvider = Extract<ProviderId, 'cursor' | 'claude'>;

/** The provider session a conversation was last worked in. Identity, not a handle. */
export interface StoredSession {
  readonly dspatchSessionId: string;
  readonly providerSessionId: string;
  readonly modelRequested: string;
  readonly createdAt: string;
  /**
   * The provider's own tool policy identifier for the session: `provider-default`
   * for Cursor; for a Claude session the adapter's policy digest, which a later
   * resume is checked against (DSP-122).
   */
  readonly toolPolicy: string;
  /**
   * Which provider holds the session (DSP-122, conversation format version 2).
   * Absent only in a version 1 file, which recorded Cursor sessions only; readers
   * take an absent value as `'cursor'`. From version 2 on it is written for every
   * session, Cursor's included, so "absent" means nothing but "version 1 file".
   */
  readonly provider?: StoredSessionProvider;
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
    readonly agentTurn: readonly AttemptRef[];
    readonly command: readonly AttemptRef[];
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
  /** As on the listing row: read-only because a newer DSpatch wrote it, not damage. */
  readonly newerFormat: boolean;
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
  /**
   * DSP-149: on `run.finished`, the model the provider reported for this session (for
   * Claude, the `init` message's `model`). Absent when it reported none: then only the
   * requested model is known, and nothing claims it was used.
   */
  readonly modelReported?: string;
  readonly dspatchSessionId: string;
  readonly dspatchRunId: string;
  readonly at: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly toolStatus?: 'ok' | 'error';
  readonly approvalSummary?: string;
  readonly readings?: readonly UsageReading[];
  readonly status?: TerminalRunStatus;
  /**
   * On `run.finished`: how the adapter says a cancelled run ended locally
   * (DSP-116, DSP-117). `unconfirmed` is not a stop: the adapter gave up waiting
   * without evidence. Absent means not reported, which is every Cursor run.
   */
  readonly end?: RunEnd;
  readonly errorMessage?: string;
  /**
   * On `run.started`: the recap DSpatch put in front of this prompt, verbatim.
   *
   * Absent when there was none, which is the normal case. It crosses the bridge
   * with the run that carried it so the window can answer "what was this session
   * told" about that message rather than in general.
   */
  readonly resentContext?: string;
  /**
   * DSP-145: on `command.started` and `command.finished`, the command DSpatch's tool ran
   * for the agent, as the transcript's short action line needs it. The whole record stays
   * in the main process and is listed in Session details ({@link AgentCommandsReport}).
   */
  readonly command?: UiCommandLine;
}

/** DSP-145: one command the agent ran, as a transcript line shows it. */
export interface UiCommandLine {
  readonly commandId: string;
  readonly line: string;
  /** `null` while it runs. */
  readonly ending: AgentCommandEnding | null;
  readonly exitCode: number | null;
  readonly durationMs: number | null;
  /**
   * DSP-146: for `stopped`, whether the stop is confirmed (DSpatch itself stopped the
   * process). `false` for a provider-reported command whose end nobody reported. Absent
   * means confirmed, as for records from before DSP-146.
   */
  readonly stopConfirmed?: boolean;
}

/**
 * DSP-145, DSP-146: one command the agent ran, with whether its
 * result still describes the code on disk - the chat's own freshness rule
 * (`evaluateFreshness`) against the snapshot taken after the command ended.
 */
export interface AgentCommandView {
  readonly record: AgentCommandRecord;
  /** The run (message) it belongs to. */
  readonly dspatchRunId: string;
  readonly standing: 'current' | 'stale' | 'unknown';
  readonly standingHeadline: string;
}

/** DSP-145: the commands the agent ran in the open conversation, oldest first. */
export interface AgentCommandsReport {
  readonly commands: readonly AgentCommandView[];
  /** The working copy's identity when this was checked, or `null` when unreadable. */
  readonly currentSnapshotId: string | null;
  readonly checkedAtUtc: string;
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
  /**
   * DSP-149: the start page, a conversation with no workspace, a workspace of several
   * folders made through the chat's own tools, a folder added, and (`flowPhase` again)
   * the restart, Recent, a carried chat, the history view and Remove from recent. No
   * provider call: the presentation adapter answers and makes the tool calls.
   */
  | 'workspace-flow'
  /** DSP-149: the real model list through the host and the dropdown; no message is sent. */
  | 'model-list'
  /** DSP-149: the model choice after an ordinary start with Claude saved; observes only. */
  | 'model-start'
  /** DSP-149: the model choice through the real app and SDK, in phases; no message is sent. */
  | 'model-flow'
  /** DSP-147: steering a chat turn and a loop step, the start prompt, and the lock with Run. */
  | 'steering'
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
  | 'errors-read-well'
  /**
   * DSP-70: the graph on screen before Send is the definition that was chosen.
   *
   * Opens a throwaway project that declares a loop of its own, ticks `Use loop`, and
   * reads which graph reaches the screen for each definition in the list. It makes no
   * provider call, because which graph is on screen is decided on this machine.
   */
  | 'chosen-loop-runs'
  /**
   * DSP-79: the window's own loop run files a result and hands it to a second agent.
   *
   * Opens a project, ticks `Use loop`, sends one mandate, and then reads the **run
   * record the main process wrote to disk** for a filed result, two provider sessions
   * and the first step's words inside the second step's prompt. It makes no provider
   * call: the run walks through `PresentationAdapter`, whose replies are canned, so
   * the evidence is about DSpatch's wiring and says nothing about any model.
   *
   * It exists because declaring `consumes` on the chat loop made a run given nowhere
   * to keep results a refusal, and the window's own result store was guarded by no
   * test at all.
   */
  | 'chat-loop-files-a-result'
  /**
   * DSP-84: opened, chosen and run are one loop, from the editor to the walk.
   *
   * Drives the whole path a person walks and Niclas found broken. It opens a project,
   * goes to the editor, opens a definition from outside every open folder, presses
   * `Use this loop`, returns to the chat and reads whether the chooser now lists and
   * names that same definition — then does it again with a second definition, and
   * finally sends one mandate and reads the graph the run actually announces.
   *
   * It makes no provider call. The one mandate walks through `PresentationAdapter`,
   * because *which* loop ran is decided entirely on this machine and a model would add
   * cost and variance to a question it cannot answer.
   */
  | 'loop-open-choose-run'
  /**
   * DSP-71 and DSP-73: folders that exist, a tree beside the chat, and no steering.
   *
   * Two folders open together, one of them holding a directory with more entries
   * than the cap; a root expanded once and read for what it did *not* pull in; a
   * text file opened and a binary one refused; a file selected while a loop is
   * chosen, to show that reading moved nothing. Then the workspace is saved, and the
   * **second run of the same scenario over one user-data directory** is the restart:
   * the folders and the definition come back before anything is opened.
   *
   * It makes no provider call. Every question here is decided on this machine.
   * Native file dialogs are not driven — they cannot be, from a renderer — so Open
   * Folder…, Add Folder to Workspace…, Open Workspace… and Save Workspace As… are
   * exercised through the same main-process functions the menu items call, with a
   * path supplied instead of a chooser. What the dialogs themselves do is untested.
   */
  | 'folders-and-a-tree'
  /**
   * DSP-72: a run given two separate folders and a definition from a third place.
   *
   * A project is opened, a saved workspace adds a second folder and names a
   * `.loop.json` filed outside both, the definition is chosen and its own graph is read
   * off the bytes on screen, and the sentence the window shows about the folders is
   * judged for overstating what a folder list is. Then DSpatch's own working copy is
   * added as a further root and Send is pressed, which must be refused by name.
   *
   * It makes no provider call — the refusal happens before an adapter exists, and the
   * accepted path is deliberately not sent. So it evidences what a run would be *given*
   * and says nothing about what an agent does with two roots.
   */
  | 'several-working-roots'
  /**
   * DSP-86: one graph view, before, during and after a run.
   *
   * The editor is put into a distinctive view — a zoom nobody lands on by accident, a
   * scrolled canvas, a selected node — and a chat-loop run is started and walked to its
   * end without leaving that surface. The same reading is taken before the run starts,
   * while it is walking, while it is held waiting for the person, and after it has
   * ended, and the claim under test is that the first and the last are the same view.
   *
   * It makes no provider call: the steps walk through `PresentationAdapter`, whose
   * replies are canned. So it evidences what the graph view does around a run and says
   * nothing about what an agent produced.
   */
  | 'one-graph-view'
  /**
   * DSP-87: what the conversation says while a reply is arriving, and what it no
   * longer says at all.
   *
   * A chat-loop run is started from the composer and the window is read repeatedly
   * *during* the stream — the status beside the composer, the step's own line, the
   * reply as it grows — because the fault this scenario exists for was a sentence
   * that was only wrong while text was coming in. A reading taken after the run
   * would have found the window telling the truth.
   *
   * It also searches the whole document for the four passages the card deletes, which
   * is the difference between wording that is unreachable and wording that is gone.
   *
   * No provider call: the steps stream through `PresentationAdapter`, slowed by
   * `DSPATCH_PRESENTATION_DELTA_MS` so that the middle of a stream is an interval
   * rather than an instant. So it evidences what the window says about activity it is
   * receiving and nothing about what an agent produced.
   */
  | 'chat-says-less'
  /**
   * DSP-90: a run the script stops itself, read while it stops and after it has.
   *
   * Separate from `chat-says-less` rather than added to it. That scenario's subject is
   * a run that is *working*, and its readings are taken over a deliberately slowed
   * stream; a cancellation partway through it would end the interval it exists to
   * sample. Two claims about two states, in two runs of a few seconds each.
   */
  | 'stop-i-asked-for'
  /**
   * DSP-88: an unsaved drawing survives a loop being switched under it.
   *
   * With edits on the canvas, the editor's dropdown, **Open loop…** and
   * **File → Open Graph File…** are each used, and each of the three answers — Save,
   * Discard changes, Cancel — is given once. Every round reads both halves of the
   * outcome: what the chooser and the canvas show, and what is on disk. A trial that
   * established only that a dialog appeared would miss the failure that matters.
   *
   * It works against throwaway copies of a loop under the temporary directory, because
   * *Save* writes a file and the loops in the working copy are not the harness's to
   * write. No provider call: nothing here starts a run at all.
   */
  | 'unsaved-edits-survive-a-switch'
  /**
   * DSP-80 and DSP-36: what the graph says a run is doing, and where it ended.
   *
   * One walk, read at each state it passes through — standing by, working, held for the
   * person, working again, ended, standing by again, and a second run starting — with the
   * browser's own running animations, each node's two bounding boxes and the ending marks
   * measured at every one of them. Then two dry runs over throwaway copies of one loop
   * whose only difference is a terminal's `ending` attribute, its label left saying
   * *Assignment met* in both. That pair is the reading that matters: it is what
   * distinguishes a tick decided by the recorded outcome and the graph from a tick decided
   * by a drawing's wording.
   *
   * No provider call. Every state comes from the run's own journal and the loop control,
   * and the glint deliberately depends on neither a reply nor a delta — so the stream is
   * slowed instead, to make *no new text has arrived* an interval a sample can fall
   * inside rather than an instant nobody can catch.
   */
  | 'liveness-and-an-ending'
  /**
   * DSP-80, second pass: how the glint and the pulse are drawn, rather than when.
   *
   * Niclas approved the movement and refused the light: the glint read as separate bright
   * dashes and the pulse was barely noticeable. This scenario is the reading of the
   * redistribution, and it runs **no loop at all** — that too is his instruction, on the
   * grounds that a change to the distribution of light cannot break a state rule, so
   * walking one would cost minutes and prove nothing about it.
   *
   * Instead one node is put into the working state and one into the ready state through
   * `showLivenessForLook`, which sends the same two announcements real callers send
   * through the same `receiveRunEvent`. The glint is then held still with its leading edge
   * at a chosen point on the outline — once in the middle of a straight side and once
   * across a corner — and the frames are captured for a reader that can sample pixels. The
   * pulse's two extremes and the clearance between its ring and the node's words are
   * measured here, where no pixels are needed.
   *
   * No provider call, no run, no project. Seconds rather than minutes.
   */
  | 'how-the-liveness-looks'
  /**
   * DSP-4 WS-1: switching between saved conversations in one window, and a restart.
   *
   * Over a **seeded** user-data directory (`scripts/seed-switch-kit.mjs`): four
   * projects with saved conversations, two of them carrying one unresolved command
   * attempt under the same ID. Phase `first` opens them in turn, reads them back and
   * acknowledges the shared attempt through the command gate; phase `again` is a
   * second process over the same directory and checks what came back. No provider
   * call: the presentation adapter opens sessions and nothing is sent.
   */
  | 'workspace-switch'
  /**
   * DSP-121: the refused and failed resume states, through the real choice panel.
   *
   * Over the same seeded kit, opening project A, whose stored session the
   * presentation adapter is told to refuse (`DSPATCH_CHAT_RESUME`): the panel, the
   * drawer, the "on record, not open" fact, a send refused with the text kept, Keep
   * reading, Try again, a new provider session with its recap removed and one
   * message sent alone. **Every refusal and failure is simulated by the presentation
   * adapter**: no provider is asked anything, and the run shows the window's
   * behaviour only. Hold mode leaves the window open after the open for a person.
   */
  | 'resume-choice'
  /**
   * DSP-126: review opened from the chat as a separate window, driven through both
   * windows with no provider call. The chat window's script opens projects, keeps a
   * draft and presses *Open review*; the main process reads and drives the review
   * windows (`reviewWindowCheck`) and records what it saw beside what the chat showed.
   */
  | 'review-window'
  /**
   * DSP-126: `npm run review -- <definition>` without a chat. No chat window exists, so
   * the main process alone drives and reads the one review window and writes the record.
   */
  | 'review-direct'
  /**
   * DSP-127: the discussion in the review window, with the presentation adapter only.
   * Questions on a point, an answer that stays on its question while the window moves,
   * Stop with and without a run, a SIMULATED send failure for the review adapter alone,
   * the main chat sending and cancelling beside a review answer, drafts across a close
   * and in two windows, and nothing sent on open, load or navigation.
   */
  | 'review-discussion'
  /**
   * DSP-126/127 hand-over (`scripts/start-review.cmd`): the chat opens P1 and the window
   * is left at rest for a person, with *Open review* going to the seeded last review.
   * Nothing is sent; every answer the person asks for is SIMULATED.
   */
  | 'review-hold';

/** What the `review-window` scenario asks the main process to read or do. Scripted runs only. */
export type ReviewWindowCheckRequest =
  | { readonly action: 'read' }
  | { readonly action: 'choose'; readonly webContentsId: number }
  | {
      readonly action: 'go-to-step';
      readonly webContentsId: number;
      readonly stepId: string;
      /** Close the window straight after, inside the view's 250 ms save delay. */
      readonly closeAfter: boolean;
    }
  | { readonly action: 'close'; readonly webContentsId: number }
  | { readonly action: 'capture'; readonly webContentsId: number; readonly label: string; readonly width: number | null }
  | { readonly action: 'refuse-chat-sender' }
  /**
   * DSP-127: the discussion panel in a review window, read or operated through its own
   * controls (`window.__dspatchDiscussionCheck`).
   */
  | {
      readonly action: 'discussion';
      readonly webContentsId: number;
      readonly op: 'read' | 'type' | 'enter' | 'stop' | 'send-anyway' | 'go-to' | 'tab';
      readonly text?: string;
      readonly times?: number;
      readonly index?: number;
      readonly tab?: 'step' | 'discussion';
    };

/** The main process's answer: what it did, and what it read, kept apart from the DOM. */
export interface ReviewWindowCheckAnswer {
  readonly ok: boolean;
  readonly detail: unknown;
}

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
  /**
   * The saved workspace `several-working-roots` opens (DSP-72).
   *
   * A path rather than a folder list, because opening a workspace file is the one route
   * by which a definition filed outside every open folder reaches the chooser without a
   * native dialog. `undefined` for every other scenario.
   */
  readonly rootsWorkspaceFile?: string;
  /** The `purpose` marker that definition's graph carries, read off the bytes on screen. */
  readonly rootsGraphMarker?: string;
  /** DSpatch's own working copy, which the same scenario adds in order to be refused. */
  readonly ownRepositoryPath?: string;
  /**
   * The declaration files `loop-open-choose-run` opens in the editor and chooses there.
   *
   * Paths rather than a discovery, because the point of the scenario is a definition
   * reached by hand: at least one of these is filed outside every folder the window has
   * open, which is the case that could be drawn and not chosen. `undefined` for every
   * other scenario.
   */
  readonly choosableDefinitions?: readonly string[];
  /**
   * The graph files behind those declarations, for DSP-88's scenario.
   *
   * Given rather than derived, because the reading that matters is what is *on disk* after
   * each of the three answers, and a trial that worked the path out from the declaration
   * would be checking its own arithmetic as much as the product. One path per entry in
   * `choosableDefinitions`, in the same order. `undefined` for every other scenario.
   */
  readonly unsavedGraphPaths?: readonly string[];
  /**
   * A declaration that reads but cannot run, for the refusal half of DSP-84 #5.
   *
   * Broken deliberately by the harness script and filed outside every open folder, so
   * it is reachable by hand and never discovered. `undefined` for every other scenario.
   */
  readonly brokenDefinition?: string;
  /**
   * The one graph `how-the-liveness-looks` opens on the canvas.
   *
   * Given rather than discovered, because that scenario opens no project at all — which is
   * most of the reason it costs seconds — so there is no folder tree for it to find a graph
   * in. `undefined` for every other scenario.
   */
  readonly lookGraphPath?: string;
  /**
   * Which half of `workspace-switch` this process is: `first` works the seeded
   * conversations, `again` is the restart over the same user data. `undefined` for
   * every other scenario.
   */
  readonly switchPhase?: 'first' | 'again';
  /**
   * The seeded projects, in the order A, B, X, X-sub, spelled as the seed recorded
   * them. Given rather than discovered so the trial names what it opens.
   * `resume-choice` reads only the first entry, A.
   */
  readonly switchProjects?: readonly string[];
  /**
   * How the presentation adapter answers resumes in `resume-choice`, from
   * `DSPATCH_CHAT_RESUME`. `undefined` for every other scenario, and `ok` means the
   * variable named no refusal, which that scenario reports rather than runs.
   */
  readonly resumeMode?: 'ok' | 'refused' | 'failed' | 'refused-once';
  /**
   * `DSPATCH_CHAT_HOLD=1`: `resume-choice` performs only the open, reports, and the
   * main process leaves the window open for a person instead of exiting.
   */
  readonly resumeHold?: boolean;
  /** DSP-149 `workspace-flow`: which process this is, and the folder its projects are in. */
  readonly flowPhase?: 'first' | 'again' | 'retry' | 'switch';
  readonly flowRoot?: string;
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

  /**
   * Cursor's connection status. Never returns a credential. Asked only when Cursor
   * is the chosen agent or the person asks for the check (DSP-136).
   */
  getConnection(): Promise<ConnectionStatus>;

  /**
   * DSP-136: record the agent the person chose explicitly in *Open a project*, so a
   * later start offers it again. Refused for a provider that cannot be chosen.
   * Builds no adapter and asks no provider. Returns the choice now recorded.
   */
  chooseAgent(provider: StoredSessionProvider): Promise<StoredSessionProvider | null>;

  /**
   * Choose the model DSpatch requests for ordinary messages in this conversation.
   *
   * Returns the model actually in force, which is what the window then states. It
   * takes effect on the next message: a provider turn already in flight is not
   * retargeted, and a loop run uses the model the loop was started with.
   */
  setRequestedModel(modelId: string): Promise<string>;
  /**
   * DSP-149: the models this agent offers the account, from its SDK's own discovery, and
   * the one chosen. Read once per launch; a failure is in `error`, never a short list.
   */
  listModels(provider: StoredSessionProvider): Promise<ModelListing>;

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
  /** Recent projects: every workspace not removed from the list, plus any project named at startup. */
  listRecentWorkspaces(): Promise<RecentWorkspaces>;
  /**
   * Remove workspaces from Recent, and nothing else (DSP-149).
   *
   * No folder is touched and no conversation is removed: the workspace keeps its name,
   * folders and chats, and opening its first folder again brings it back.
   */
  removeFromRecent(workspaceIds: readonly string[]): Promise<RecentWorkspaces>;
  /**
   * Open a workspace (DSP-149): one from Recent, or the workspace of a chosen first
   * folder, created with the folder's name when there is none. A conversation begun
   * without a workspace moves into it and continues there; otherwise the workspace's
   * own last chat continues. Sends nothing and starts no work.
   */
  openWorkspace(request: WorkspaceOpenRequest): Promise<WorkspaceOpenOutcome>;
  /**
   * The session the window shows was replaced from outside the window: the chat's own
   * workspace tools opened a workspace (DSP-149). Carries what `openWorkspace` returns.
   */
  onSessionReplaced(listener: (opened: WorkspaceOpenOutcome) => void): () => void;
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
   * Remove the recap DSpatch would put in front of the next message (DSP-121).
   *
   * Sends nothing and writes nothing; the returned continuity has `contextToResend`
   * `null` and is what the window shows from then on. Final for this session: a
   * refused send does not bring the recap back.
   */
  discardPendingRecap(): Promise<SessionContinuity>;
  /**
   * Put text on the system clipboard (DSP-121: *Copy diagnostic info*).
   *
   * Only on a click, and nothing leaves the machine. In an unattended scripted run
   * the main process records the text in the run record instead, so an automated
   * test never overwrites the clipboard of the person at the computer.
   */
  copyText(text: string): Promise<void>;
  /**
   * Send a prompt.
   *
   * `acknowledgedAttemptIds` names every earlier attempt of this kind whose
   * outcome is unknown and which the user has been shown. Without all of them,
   * DSpatch refuses to start a second turn, rather than letting a retry become a
   * duplicate model job. Each is named with its conversation ({@link AttemptRef}),
   * as `RunStateReport.needsAcknowledgement` lists them.
   */
  sendPrompt(
    text: string,
    acknowledgedAttemptIds?: readonly AttemptAcknowledgement[],
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
  /** DSP-145: the commands the agent ran in this conversation, each with its standing. */
  getAgentCommands(): Promise<AgentCommandsReport>;
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
  setWindowWidth(width: number, height?: number): Promise<number>;
  /**
   * Ask the window to behave as a person with *reduce motion* set. Scripted runs only.
   *
   * DSP-80 requires that reduced motion get a **still marking rather than nothing**, and
   * that is a claim about what the real stylesheet does under a real media query. A
   * renderer cannot set `prefers-reduced-motion`; it is the operating system's answer, and
   * the only honest way to reach it is to have Chromium report the other answer — which is
   * a main-process capability. The alternative was a trial that read the CSS text and
   * agreed with it, which would establish that a rule was written and nothing about
   * whether it applies.
   *
   * Answers `false` when the emulation could not be put in place, so a trial can say *not
   * established* rather than quietly reading the ordinary window and calling it reduced
   * motion. Registered with the other two — under `DSPATCH_CHAT_RUN` and nowhere else.
   */
  emulateReducedMotion(reduce: boolean): Promise<boolean>;

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
   * Show a role's own file, in the file manager, selected.
   *
   * DSP-83 #1. The panel renders the role's text, and a rendered copy is not the file:
   * the file is where an author fixes a role, and "named and openable" is the criterion.
   * `root` is the resource root the paths in the graph are measured from — the
   * definition's, not DSpatch's — and the main process refuses anything that resolves
   * outside it, because a graph is a file that may be shared and a role path is not a
   * way to point this window at an arbitrary part of the machine.
   */
  revealRoleSource(request: {
    readonly root: string;
    readonly path: string;
  }): Promise<{ readonly revealed: boolean; readonly note: string }>;
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
   * Open review for the project this chat is working in, in a window of its own (DSP-126).
   *
   * The main process hands review the open session's folder and nothing else; review
   * opens the last review opened for that repository, or its chooser. Asking again
   * focuses the window that already has it. Opening starts no work and changes nothing
   * in this window.
   */
  openReview(): Promise<LoopEditorWindowOutcome>;
  /**
   * Open the bundled example review (DSP-129) from DSpatch's own clone, in a review
   * window of its own. Needs no project and makes no provider call; it does not become
   * the last review *Open review* reopens. Outside a clone it opens nothing and the
   * outcome's note says why.
   */
  openExampleReview(): Promise<LoopEditorWindowOutcome>;
  /**
   * Read or drive the review windows for the `review-window` scenario. Registered only
   * during a scripted run; an ordinary launch has no such channel.
   */
  reviewWindowCheck(request: ReviewWindowCheckRequest): Promise<ReviewWindowCheckAnswer>;
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
   * Which agent the graph editor's Run would use now, as one line, or why no run would
   * start (DSP-138). **A read**: it starts, records and constructs nothing. `target` is
   * the drawing's label, named in the line when it differs from the agent; `entry` is the
   * drawing's entry step, so the line applies the Run's model rule to the same drawing.
   */
  readLoopRunAgent(query: LoopRunAgentQuery): Promise<LoopRunAgentInfo>;
  /**
   * Walk the chosen loop definition on the project already open in chat.
   *
   * The composer's text is the entry mandate. Switching Use loop off cancels
   * without resetting files. Editor Run is a different binding.
   */
  startChatLoopRun(request: ChatLoopRunRequest): Promise<ChatLoopRunOutcome>;
  /**
   * Which loops this window can offer, from the open project and DSpatch's own folder.
   *
   * **A read.** It lists one directory per folder and starts nothing.
   */
  listLoopDefinitions(): Promise<LoopDefinitionListing>;
  /**
   * Select a definition for the next mandate (DSP-84, DSP-85).
   *
   * **It starts nothing.** It records the workspace's one selection, which the chat
   * follows rather than holding a second of; a definition that cannot run is refused
   * with the run's own reason and the existing selection is left alone.
   *
   * `null` asks for a file chooser first and is DSP-85's **Open loop…**: a declaration
   * from outside every open folder joins the same list on the same terms as a discovered
   * one, and it is judged before it is recorded, so *opening* a loop from file and
   * *choosing* one from the dropdown are one act with one outcome rather than two paths
   * that can disagree.
   */
  chooseLoopDefinition(definitionPath: string | null): Promise<LoopDefinitionChooseOutcome>;
  /**
   * Take the graph file the File menu asked to have edited, if there is one.
   *
   * DSP-85 #6. The loop editor's own controls are about loops now, so a standalone
   * `.graph.json` is reached from the File menu — which is in the main process, may be
   * pressed from either window, and may have to open an editor window that does not
   * exist yet. So the path waits here and the editor takes it: on mount, and again
   * whenever {@link DSpatchBridge.onGraphToEdit} fires for an editor already open.
   *
   * **Taking clears it**, which is what makes a double delivery open the file once.
   */
  takeGraphToEdit(): Promise<string | null>;
  /** That the File menu has a graph waiting to be edited. The path comes from taking. */
  onGraphToEdit(listener: () => void): () => void;
  /**
   * Tell the main process that the editor is holding unsaved edits to a graph file.
   *
   * DSP-86. A chat-loop run reads its graph from disk, and the edited drawing lives in
   * the editor's window and nowhere else — so without this the main process has no way
   * to know that starting would walk an older version than the one a person is looking
   * at. Registering it is what lets {@link DspatchBridge.startChatLoopRun} stop and ask
   * *save these edits and run them, or cancel* instead of quietly running the file.
   *
   * **Two readers since DSP-88.** {@link DspatchBridge.chooseLoopDefinition} and
   * **File → Open Graph File…** are about to draw something else over this drawing, so
   * they ask the same question with one more answer — Save, Discard changes, Cancel —
   * before anything switches. The registration is what both of them read, which is what
   * keeps one drawing from being described two ways.
   *
   * **It writes nothing.** The text is held in memory until one of them asks about it,
   * and `null` — sent when the drawing is saved, closed or replaced — forgets it again.
   * The editor's own Save is unchanged and still the ordinary way to write the file.
   */
  noteUnsavedDrawing(drawing: UnsavedDrawing | null): Promise<void>;
  /**
   * That a graph file the editor has open was written by something other than Save.
   *
   * Two senders, both of them the question above answered with *save*: the one at the
   * start of a run, and the one before the canvas is drawn with something else. The
   * editor is comparing its drawing against what it last wrote, so a file written behind
   * it would otherwise stay marked unsaved for ever — and a window claiming unsaved
   * changes it does not have is the same kind of untruth as one hiding changes it does.
   */
  onGraphSavedElsewhere(listener: (saved: GraphSavedElsewhere) => void): () => void;
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
  prepareChatLoop(chosen: boolean, definitionKey: string | null): Promise<ChatLoopPrepareOutcome>;
  /**
   * Add a message to the run already walking, rather than starting a second one.
   *
   * The composer routes here whenever a loop run is in flight — see
   * `composerSendRoute`. It is the reason the box can be used during a run
   * without the hazard DSP-53 #2 and DSP-32 #4 both name: there is no path from a
   * press of Send during a run to a second walk in the same working copy.
   */
  addLoopInstruction(request: AddLoopInstructionRequest): Promise<AddLoopInstructionOutcome>;
  /**
   * DSP-147: send a message into the ordinary agent turn that is working, as steering of
   * that turn through its runtime's own support. Never starts a turn.
   */
  steerTurn(request: SteerTurnRequest): Promise<SteerTurnOutcome>;
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

  /* --- A workspace of open folders, and a tree beside the chat (DSP-71, DSP-73) --- */

  /** The folders open now, and the loop this workspace chose. A read. */
  workspaceFolders(): Promise<WorkspaceView>;
  /** Every change to the open folders, however it was made — menu or window. */
  onWorkspaceFolders(listener: (view: WorkspaceView) => void): () => void;
  /**
   * Add a folder beside the ones already open.
   *
   * With no path a native folder chooser opens; with one the folder is added
   * directly, which is how a scripted trial reaches this at all — a native dialog
   * cannot be driven from the renderer.
   *
   * **What it changes, since DSP-72.** The folder joins what is shown, what is searched
   * for loop definitions, **and the working folders a loop run is given** — it is passed
   * to the provider as one of the session's workspace folders, its own rules and skills
   * load with it, and what changes inside it is measured per root. An ordinary chat
   * message is unaffected: that path gives the agent the working directory alone.
   *
   * The working directory itself does not move. It is the project the chat session
   * opened, and adding a folder here does not make a different folder primary — which
   * matters beyond presentation, because the provider scopes its local agent store by
   * `cwd` and a conversation is resumed against it.
   *
   * Until DSP-72 this contract said the call changed "nothing about a run" and named
   * DSP-72 as where that would be decided. It has been, and this is the answer.
   */
  addFolderToWorkspace(folderPath?: string): Promise<WorkspaceView>;
  /**
   * Remove a folder from the workspace.
   *
   * **The link and nothing else.** No file is deleted, no folder is touched, no
   * conversation is removed. The run's working copy cannot be removed this way at
   * all: it is the open project, and closing a project is a different act.
   */
  removeFolderFromWorkspace(folderPath: string): Promise<WorkspaceView>;
  /** Open a saved workspace: its folders, and the loop definition it chose. */
  openWorkspaceFile(filePath?: string): Promise<WorkspaceView>;
  /** Save the open folders and the chosen definition to a file. Writes nothing else. */
  saveWorkspaceFile(filePath?: string): Promise<WorkspaceView>;
  /**
   * The children of one directory.
   *
   * **One `readdir`, capped, never recursive.** Expanding a folder in the tree asks
   * this and nothing more; there is no call here that costs what the subtree costs,
   * which is why a folder with `node_modules` in it is survivable rather than fast.
   */
  readWorkspaceDirectory(dirPath: string): Promise<DirectoryPage>;
  /**
   * One file, for reading.
   *
   * A reading view: binary is refused and an oversized file is truncated, both with
   * the reason on screen. **Selecting a file changes nothing about a run** — not its
   * working copy, not its roots, not its session. A tree is a way of looking.
   */
  readWorkspaceFile(filePath: string): Promise<FileView>;
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

/**
 * One loop a person can choose, as the window draws it.
 *
 * `key` is the declaration file's path, and it is what travels back with a preview and
 * with a mandate. **The window never names a graph.** It names the definition it was
 * offered, and the main process resolves that to a graph, a version and a resource
 * root — which is the whole of DSP-70: what runs is what was chosen, rather than a
 * constant that happened to agree with the list most of the time.
 *
 * `display` is `describeDefinitionRow`'s own fields, passed through rather than
 * reworded, so the name, origin and per-row error a person reads are the ones the
 * discovery code built and its tests hold.
 */
export interface LoopDefinitionChoice {
  readonly key: string;
  readonly definitionId: string | null;
  /** False for a declaration that did not load. It is still listed, with its error. */
  readonly usable: boolean;
  /** What a window offers before the person has chosen. Exactly one row, or none. */
  readonly preselected: boolean;
  readonly display: DefinitionRowDisplay;
}

/**
 * The loops found beside the folders DSpatch is looking at.
 *
 * `problems` are directories that exist and could not be listed — worth saying,
 * because a folder whose loops are unreadable otherwise looks like a folder with none.
 */
export interface LoopDefinitionListing {
  readonly choices: readonly LoopDefinitionChoice[];
  readonly problems: readonly string[];
}

/**
 * What came of selecting a definition, from the dropdown or from a file.
 *
 * DSP-84 made the editor able to select a definition it had open. DSP-85 made that the
 * *only* way a loop is selected: the editor's dropdown and its **Open loop…** both
 * arrive here, and the chat has no chooser of its own any more. One channel, because the
 * two gestures are one act — a loop is chosen and drawn together, and a definition
 * reached from file joins the same list on the same terms as a discovered one.
 *
 * **Selecting is not starting.** Nothing is run, no session is opened and no provider
 * is called. The workspace records the key, which is the one selection the chat then
 * follows, so there is one answer to "which loop" rather than two.
 *
 * **A definition that cannot run is refused here, by name, and changes nothing.**
 * `refused` carries the run's own reason at the length a chooser can hold —
 * `judgeChosenLoop`'s `brief`, from the same three questions the preview and Send ask —
 * and the previously selected loop stays selected. A silent fall back to a different loop
 * is the defect, not the remedy.
 */
export type LoopDefinitionChooseOutcome =
  | {
      readonly kind: 'chosen';
      readonly key: string;
      readonly name: string;
      /** The graph a run will read, so the window can say what a save would affect. */
      readonly graphPath: string;
      /** Passed back so the window draws what it just selected without asking again. */
      readonly listing: LoopDefinitionListing;
      /**
       * What became of an unsaved drawing this choice was about to draw over (DSP-88).
       *
       * `null` when there was none. Otherwise the answer the person gave, reported by the
       * process that acted on it rather than inferred in the window from its own `dirty`
       * flag — the window's sentence about the drawing has to be an account of what
       * happened to it, and only one of the two knows.
       */
      readonly unsavedDrawing: Exclude<UnsavedDrawingAnswer, 'cancel'> | null;
    }
  | { readonly kind: 'refused'; readonly key: string; readonly note: string }
  /**
   * Nothing was chosen, drawn or recorded.
   *
   * Two ways to reach it, and `note` is what tells them apart. A dismissed file chooser
   * has nothing to say — the person closed a dialog they opened. A **cancel at the
   * unsaved-drawing question** (DSP-88) does: something was deliberately not done, and
   * the window has to say that the drawing is still here and the selection has not moved.
   */
  | { readonly kind: 'cancelled'; readonly note: string | null };

/**
 * Which graph to open.
 *
 * Two of these name a graph file and three name a loop. The difference is the whole of
 * DSP-82: a definition is read through the same procedure a run reads it with, so its
 * graph resolves its roles at the definition's resource root rather than at DSpatch's
 * own working copy. Opening a `.graph.json` directly remains available and is no longer
 * the only way in.
 *
 * `development-loop` is neither. It opens the **documentation drawing** of the Cursor
 * process we develop DSpatch with, which is not runnable and is not anybody's chosen
 * loop. DSP-85 took its button away with the rest of the editor's open buttons: a
 * drawing that can be neither chosen nor run has no place beside a chooser of loops, and
 * the File menu opens it like any other graph file. It stays as a request kind because it
 * is the one standalone graph reachable without a dialog, which is what lets a scripted
 * check open one at all.
 */
export type LoopGraphOpenRequest =
  | { readonly kind: 'development-loop' }
  /** A dialog taking either kind. Since DSP-85 the File menu's, not the editor's. */
  | { readonly kind: 'pick' }
  | { readonly kind: 'path'; readonly path: string }
  /** A `.loop.json`, opened as the loop it declares. */
  | { readonly kind: 'definition'; readonly path: string }
  /** Whatever loop this workspace has chosen, with no dialog. */
  | { readonly kind: 'chosen-loop' };

/**
 * The declaration a graph was reached through, when it was reached through one.
 *
 * Absent means the graph was opened directly, which is a different thing and reads as
 * one — not as a loop whose name is missing.
 */
export interface OpenedLoopDefinition {
  readonly id: string;
  readonly name: string;
  /** The declaration file. Deliberately not what a save writes to. */
  readonly path: string;
}

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
      /**
       * Role paths are relative to this, not to the graph file.
       *
       * The definition's resource root when there is a definition, so a loop declared
       * outside DSpatch reaches its own roles.
       */
      readonly projectRoot: string;
      readonly roles: readonly ResolvedRoleEntry[];
      /** Present when a `.loop.json` was the way in. */
      readonly definition?: OpenedLoopDefinition;
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

/**
 * A graph the editor has edited and not written yet (DSP-86).
 *
 * `text` is the same serialisation Save would write, so answering *save and run* writes
 * exactly the bytes the person is looking at rather than a second rendering of them.
 */
export interface UnsavedDrawing {
  /** The graph file, which is what a run reads and what Save writes. */
  readonly path: string;
  readonly text: string;
  /** For the question the person is asked. A path alone does not say which loop. */
  readonly graphName: string;
}

/**
 * A graph file written by the question DSpatch asks before it loses a drawing.
 *
 * Two senders since DSP-88, which is why the occasion travels with it: the save-or-cancel
 * at the start of a run, and the save-or-discard before the canvas is drawn with
 * something else. The editor has to say which one wrote its file, because *the run is
 * walking these changes* is true of exactly one of them.
 */
export interface GraphSavedElsewhere {
  readonly path: string;
  readonly text: string;
  readonly occasion: UnsavedDrawingOccasion;
}

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
  /**
   * The declaration the person chose, by file path.
   *
   * `null` means they have not chosen and the main process offers the same default the
   * listing marked `preselected` — one rule in one place, so the row a window shows as
   * chosen and the row a send actually walks cannot be two different rows.
   */
  readonly definitionKey?: string | null;
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
  /**
   * What this step was sent, whole, exactly as the record keeps it.
   *
   * DSP-94, from DSP-92's F5. The prompt was already written to
   * `RecordedAgentReply.prompt` on the same call that produced this event and no
   * user-facing surface read it, so *what was this step actually told* was a question
   * answerable only by opening a JSONL file under `%APPDATA%`. It travels here from the
   * same `LiveAgentReply.prompt` the record line is written from, so the conversation
   * and the file cannot show two different messages for one call.
   *
   * Optional, because a caller that does not know it must not claim an empty message:
   * absent is *not recorded* and never *nothing was sent*.
   */
  readonly prompt?: string;
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

/**
 * A message reaching a step, or failing to before the run ended.
 *
 * DSP-147: the same events carry steering of an ordinary chat turn, with the turn's run
 * id as `runId` and an empty `nodeId` and `nodeLabel`.
 */
export type LoopInstructionEventPayload =
  | {
      readonly kind: 'delivered';
      readonly runId: string;
      readonly instructionIds: readonly string[];
      readonly nodeId: string;
      readonly nodeLabel: string;
      readonly occurrence: number;
      readonly atUtc: string;
      /** DSP-147: taken into the running work through its runtime's steering. */
      readonly during?: boolean;
    }
  | {
      readonly kind: 'run-ended';
      readonly runId: string;
      /** Ids that never reached a step. Empty when everything was delivered. */
      readonly undelivered: readonly string[];
    }
  /** DSP-147: the runtime took these for the running work; not yet evidence they were taken in. */
  | { readonly kind: 'accepted'; readonly runId: string; readonly instructionIds: readonly string[] }
  /** DSP-147: the runtime had these and the work ended without saying it took them in. Never resent. */
  | { readonly kind: 'unconfirmed'; readonly runId: string; readonly instructionIds: readonly string[] }
  /** DSP-147: the running work could not take these; they wait for this handover. */
  | {
      readonly kind: 'waiting';
      readonly runId: string;
      readonly instructionIds: readonly string[];
      readonly waitingFor: 'next-step' | 'end-of-turn';
    }
  /** DSP-147: these were not given to the agent, and nothing will give them now. */
  | { readonly kind: 'not-delivered'; readonly runId: string; readonly instructionIds: readonly string[] };

/** DSP-147: a steering message for the ordinary chat turn that is working. */
export interface SteerTurnRequest {
  readonly text: string;
}

/**
 * DSP-147: what became of it, decided in the project host. `received` says only that
 * DSpatch holds it; what the runtime does with it follows on
 * {@link DspatchBridge.onLoopInstruction}. `no-running-turn`: the turn had already
 * ended, nothing was sent, and the text is the person's to send as an ordinary message.
 */
export type SteerTurnOutcome =
  | {
      readonly kind: 'received';
      readonly instructionId: string;
      /** The run of the turn it was sent into. */
      readonly runId: string;
      readonly receivedAtUtc: string;
    }
  | { readonly kind: 'no-running-turn' }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * DSP-147: a steering message as a conversation keeps it, on the turn it was sent into.
 * `state` is the last thing established about it; `received` and `accepted` in a file
 * read back after a restart mean nothing further was learned before DSpatch stopped.
 */
export interface StoredSteering {
  readonly id: string;
  readonly text: string;
  readonly receivedAtUtc: string;
  readonly state:
    | 'received'
    | 'accepted'
    | 'delivered'
    | 'waiting-end-of-turn'
    | 'sent-as-next-message'
    | 'unconfirmed'
    | 'not-delivered';
  readonly settledAtUtc: string | null;
  /** The runtime's identifier for it, where it has one (Claude: the uuid). */
  readonly providerMessageId: string | null;
  /** The adapter's technical account, for Session details. */
  readonly detail: string | null;
}

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
  | 'dspatch:list-models'
  | 'dspatch:choose-agent'
  | 'dspatch:menu-command'
  | 'dspatch:pick-project'
  | 'dspatch:list-recent-workspaces'
  | 'dspatch:remove-from-recent'
  | 'dspatch:open-workspace'
  | 'dspatch:session-replaced'
  | 'dspatch:list-sample-projects'
  | 'dspatch:clean-sample-projects'
  | 'dspatch:list-conversations'
  | 'dspatch:conversation-save-status'
  | 'dspatch:resume-conversation'
  | 'dspatch:export-conversation'
  | 'dspatch:reveal-conversation'
  | 'dspatch:start-session'
  | 'dspatch:discard-pending-recap'
  | 'dspatch:copy-text'
  | 'dspatch:send-prompt'
  | 'dspatch:cancel-run'
  | 'dspatch:abandon-send'
  | 'dspatch:cancel-observations'
  | 'dspatch:run-state'
  | 'dspatch:run-test'
  | 'dspatch:stop-test'
  | 'dspatch:test-freshness'
  | 'dspatch:agent-commands'
  | 'dspatch:workspace-changes'
  | 'dspatch:turn-usage'
  | 'dspatch:agent-event'
  | 'dspatch:get-scripted-run'
  | 'dspatch:scripted-run-report'
  | 'dspatch:press-menu-item'
  | 'dspatch:capture-window'
  | 'dspatch:set-window-width'
  | 'dspatch:emulate-reduced-motion'
  | 'dspatch:open-loop-graph'
  | 'dspatch:save-loop-graph'
  | 'dspatch:resolve-loop-roles'
  | 'dspatch:reveal-role-source'
  | 'dspatch:open-loop-editor'
  | 'dspatch:open-review'
  | 'dspatch:open-example-review'
  | 'dspatch:check-review-windows'
  | 'dspatch:start-editor-loop-run'
  | 'dspatch:cancel-editor-loop-run'
  | 'dspatch:loop-run-event'
  | 'dspatch:current-loop-run'
  | 'dspatch:read-loop-run-agent'
  | 'dspatch:start-chat-loop-run'
  | 'dspatch:cancel-chat-loop-run'
  | 'dspatch:chat-loop-journal'
  | 'dspatch:chat-loop-reply'
  | 'dspatch:chat-loop-activity'
  | 'dspatch:prepare-chat-loop'
  | 'dspatch:list-loop-definitions'
  | 'dspatch:choose-loop-definition'
  | 'dspatch:take-graph-to-edit'
  | 'dspatch:graph-to-edit'
  | 'dspatch:note-unsaved-drawing'
  | 'dspatch:graph-saved-elsewhere'
  | 'dspatch:add-loop-instruction'
  | 'dspatch:loop-instruction-event'
  | 'dspatch:steer-turn'
  | 'dspatch:list-run-records'
  | 'dspatch:loop-control'
  | 'dspatch:read-loop-control'
  | 'dspatch:request-loop-pause'
  | 'dspatch:continue-loop'
  | 'dspatch:set-loop-mode'
  | 'dspatch:workspace-folders'
  | 'dspatch:workspace-folders-changed'
  | 'dspatch:add-workspace-folder'
  | 'dspatch:remove-workspace-folder'
  | 'dspatch:open-workspace-file'
  | 'dspatch:save-workspace-file'
  | 'dspatch:read-workspace-directory'
  | 'dspatch:read-workspace-file';
