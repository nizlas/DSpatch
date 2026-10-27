import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Cursor } from '@cursor/sdk';

import {
  describePermissionPolicy,
  type ClaudePermissionPolicy,
} from '../adapter/claude-agent-sdk-adapter';
import {
  CLAUDE_NOT_INSTALLED_TEXT,
  claudeUnavailableReason,
} from '../adapter/claude-support';
import { CursorSdkAdapter } from '../adapter/cursor-sdk-adapter';
import type {
  AgentCommandRecord,
  AppTool,
  AgentEvent,
  AgentEventListener,
  CapabilityReport,
  ModelInfo,
  ResumeEvidence,
  RunReference,
  SessionConfig,
  SessionHandle,
  Unsubscribe,
  UsageQuery,
  UsageReading,
} from '../adapter/types';
import type {
  AbandonOutcome,
  AdapterInfo,
  AgentChoiceInfo,
  AgentCommandsReport,
  AgentCommandView,
  AttemptAcknowledgement,
  AttemptInfo,
  AttemptKind,
  AttemptReconciliation,
  BaselineInfo,
  CancelObservations,
  CancelOutcome,
  ChatSessionInfo,
  ConnectionStatus,
  ContinuityChoice,
  ModelChoice,
  ModelListing,
  ConversationListing,
  ConversationSaveStatus,
  DirtyFileInfo,
  EarlierSendMayHaveReached,
  GitBaselineInfo,
  RestoredConversation,
  RestoredHistory,
  RestoredDiff,
  RestoredTestResult,
  ResumeFailure,
  RunStateReport,
  SessionContextInfo,
  SessionContinuity,
  SessionContinuityKind,
  SessionOrigin,
  StartSessionRequest,
  StoredBaseline,
  StoredBaselineFile,
  StoredConversation,
  StoredMessage,
  StoredSession,
  StoredSessionProvider,
  TestFreshness,
  TestOutcome,
  TestRunRequest,
  TurnUsage,
  UiAgentEvent,
  FolderChangeReport,
  WorkspaceChange,
  WorkspaceReport,
} from '../shared/bridge';
import { saysSessionAlreadyHasARun } from '../shared/session-run-block';
import {
  CLAUDE_CHAT_MODEL,
  providerAvailability,
  providerDisplayName,
  type ProviderAvailability,
} from './provider-availability';
import { AttemptLedger, attemptOrdinal, type AttemptSequence } from './attempt-ledger';
import {
  CONVERSATION_FORMAT_VERSION,
  newConversationId,
  storedSessionProvider,
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
  stopPosixProcessGroup,
  treeSpawnOptions,
  type KillFunction,
  type StoppableChild,
} from './process-tree';
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
import { WORKSPACE_COMMAND_SLOTS, type WorkspaceCommandSlots } from './workspace-command';
import { boundedOutput, DEFAULT_OUTPUT_BUDGET } from '../shared/loop-record';

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
 * The model a Claude chat session asks for (DSP-117). Defined beside the provider
 * availability since DSP-138, so a loop run names the same model without importing
 * this service; re-exported here for the callers that already read it from here.
 */
export { CLAUDE_CHAT_MODEL };

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

/**
 * Extra time after an adapter's declared cancellation bound
 * (`ChatAdapter.cancelEndBoundMs`) for its terminal event to reach this service.
 *
 * The adapter guarantees its end by its own timers; this covers only delivery,
 * which is in-process and synchronous for the adapters here, so one second is
 * generous. With a declared bound the confirmation window is the larger of
 * {@link CANCEL_CONFIRM_MS} (or its test override) and bound plus this grace;
 * without one it stays {@link CANCEL_CONFIRM_MS}. Either way it is bounded.
 */
const CANCEL_CONFIRM_GRACE_MS = 1_000;

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
const RESEND_LIMITS: {
  readonly maxMessages: number;
  readonly maxPromptChars: number;
  readonly maxAnswerChars: number;
  readonly maxTotalChars: number;
} = {
  maxMessages: 6,
  maxPromptChars: 400,
  maxAnswerChars: 700,
  maxTotalChars: 8_000,
};

/**
 * DSP-149: a conversation moving into a workspace carries all of itself. Every message,
 * in full, up to a bound far beyond an ordinary conversation; if even that cuts, the
 * continuity says so and the window shows it, rather than the cut being silent.
 */
const CARRY_LIMITS: typeof RESEND_LIMITS = {
  maxMessages: Number.MAX_SAFE_INTEGER,
  maxPromptChars: Number.MAX_SAFE_INTEGER,
  maxAnswerChars: Number.MAX_SAFE_INTEGER,
  maxTotalChars: 400_000,
};

const FIRST_SESSION_CONTINUITY: SessionContinuity = {
  kind: 'first-session',
  providerSessionOpen: true,
  attemptedDspatchSessionId: null,
  resumedProviderSessionId: null,
  resumeError: null,
  resumeFailure: null,
  earlierSendsMayHaveReached: [],
  choices: [],
  contextToResend: null,
  contextNote:
    'Nothing was resent, because there is nothing saved to resend: this ' +
    'conversation has no earlier messages.',
  savedMessageCount: 0,
  statement:
    'A new provider session over this project. There was no earlier conversation ' +
    'to continue, so nothing has been resumed and nothing has been resent.',
};

/**
 * What the user can do while no provider session is open (DSP-121), per state.
 *
 * Starting a new session in every such state. Trying again only where a retry can
 * work in this build (Niclas, 24 October 2026: do not offer Try again where that
 * path is blocked or unsupported). It is not offered when:
 *
 * - the adapter cannot resume at all (`resume-unavailable`): a retry gives the same
 *   answer;
 * - the refusal is `unconfirmed-end`: it is lifted only by trying again with the
 *   attempt acknowledged, and this window cannot send that acknowledgement yet
 *   (DSP-117);
 * - the adapter refused on `config_mismatch`: the same inputs give the same answer;
 * - the Claude adapter refused on `authentication_refused` (DSP-117): that is
 *   DSpatch's own credential rule applied to the environment DSpatch was started
 *   from, which a retry in the same process cannot change.
 *
 * `retry-resume` itself stays accepted by `startChatSession` - DSP-117 needs it with
 * `acknowledgedAttemptIds` - it is only not offered. Reading the history is not a
 * choice: the saved conversation is on screen whatever the user picks.
 */
function noSessionChoices(
  kind: Extract<SessionContinuityKind, 'resume-refused' | 'resume-failed' | 'resume-unavailable'>,
  failure: ResumeFailure | null,
): readonly ContinuityChoice[] {
  const retryCannotWork =
    kind === 'resume-unavailable' ||
    failure?.kind === 'unconfirmed-end' ||
    failure?.kind === 'provider-differs' ||
    failure?.providerCode === 'config_mismatch' ||
    failure?.providerCode === 'authentication_refused';
  const base: readonly ContinuityChoice[] = retryCannotWork
    ? ['new-session']
    : ['try-again', 'new-session'];
  // DSP-117: after Claude was refused by DSpatch's own rule, *Start new session*
  // stays a Claude session, and switching to Cursor is a choice of its own.
  return failure?.providerCode === 'authentication_refused'
    ? [...base, 'switch-to-cursor']
    : base;
}

/**
 * What `openProviderSession` hands back. `handle` is `null` exactly when no provider
 * session is open; `recorded` is then the stored session the attempt was about, which
 * the session info describes and the next save leaves untouched.
 */
type OpenedProviderSession =
  | {
      readonly handle: SessionHandle;
      readonly recorded: StoredSession | null;
      readonly continuity: SessionContinuity;
    }
  | {
      readonly handle: null;
      readonly recorded: StoredSession;
      readonly continuity: SessionContinuity;
      /**
       * DSP-117: no resume was attempted; the adapter refused to start the new
       * session that was asked for, before starting anything.
       */
      readonly newSessionRefused?: true;
    };

/** The provider's own code on a thrown error, read from the field only — never from prose. */
function providerCodeOf(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'providerCode' in error) {
    const { providerCode } = error as { providerCode?: unknown };
    return typeof providerCode === 'string' ? providerCode : null;
  }
  return null;
}

/**
 * What a refused or failed resume established, keyed on `providerCode` alone.
 *
 * The DSP-121 table: `agent_not_found` is the provider answering that it does not
 * have the session (measured by DSP-4's probe); the `local_*` and `config_mismatch`
 * codes are the Claude adapter's own checks of DSP-122, which this build never sees
 * but maps the same way so the table lives in one place; anything else is an error
 * quoted verbatim, which may be temporary. The `unconfirmed-end` kind is not produced
 * here: that rule reads the ledger, not an error, and arrives with DSP-122.
 */
function classifyResumeFailure(error: unknown): {
  readonly kind: Extract<SessionContinuityKind, 'resume-refused' | 'resume-failed'>;
  readonly failure: ResumeFailure;
  /** What the statement adds after the quoted failure. */
  readonly note: string;
} {
  const detail = describeError(error);
  const providerCode = providerCodeOf(error);
  switch (providerCode) {
    case 'agent_not_found':
      return {
        kind: 'resume-refused',
        failure: { kind: 'provider-missing', detail, providerCode },
        note: 'The provider answered this itself. Trying again asks it again with the same ID.',
      };
    case 'local_record_missing':
      return {
        kind: 'resume-refused',
        failure: { kind: 'local-record-missing', detail, providerCode },
        note:
          'The provider was not asked: the adapter\'s own local check found no ' +
          'readable record of the session.',
      };
    case 'local_record_missing_unaligned':
      // DSP-122: the adapter's local check read a different profile than the one
      // the provider process is given, so "no record there" is not "no record".
      return {
        kind: 'resume-refused',
        failure: { kind: 'unknown', detail, providerCode },
        note:
          'The provider was not asked, and the adapter\'s local check looked in a ' +
          'different profile than the one the provider process uses, so finding no ' +
          'record there says nothing about whether the provider still has the session.',
      };
    case 'config_mismatch':
      return {
        kind: 'resume-refused',
        failure: { kind: 'error', detail, providerCode },
        // DSP-145: the Claude adapter's own refusal (the quoted detail) says the tool
        // policy changed and that a new session is the way on.
        note: 'Trying again with the same inputs gives the same answer.',
      };
    case 'local_lookup_failed':
      return {
        kind: 'resume-failed',
        failure: { kind: 'error', detail, providerCode },
        note: 'This may be temporary.',
      };
    case 'authentication_refused':
      return {
        kind: 'resume-failed',
        failure: { kind: 'error', detail, providerCode },
        // The rule is quoted in the detail; nothing is added to it.
        note: '',
      };
    default:
      return {
        kind: 'resume-failed',
        failure: { kind: 'error', detail, providerCode },
        note: 'This may be temporary.',
      };
  }
}

/**
 * The sentence for earlier messages with no confirmed end (DSP-121 AC#4), or `''`.
 * The ledger carries no session ID, hence "of this conversation".
 */
function earlierSendsSentence(sends: readonly EarlierSendMayHaveReached[]): string {
  if (sends.length === 0) {
    return '';
  }
  const count = sends.length;
  const listed = sends
    .map(
      (send) =>
        `"${send.label}" (${send.attemptId}, ${send.state}` +
        `${send.acknowledged ? ', acknowledged' : ''})`,
    )
    .join('; ');
  return (
    ` ${String(count)} earlier message${count === 1 ? '' : 's'} of this conversation ` +
    `may have reached the provider and ${count === 1 ? 'has' : 'have'} no confirmed ` +
    `end: ${listed}. Nothing is resent. If you continue in a new provider session, ` +
    'the recap DSpatch offers is its own record of the conversation, not a resend.'
  );
}

/**
 * What each offered choice does, said once, naming only the choices offered: a
 * statement that described a retry the window does not offer would send the reader
 * looking for a button that is not there.
 */
function choicesSentence(
  choices: readonly ContinuityChoice[],
  savedMessageCount: number,
): string {
  // With no saved messages there is nothing to recap and nothing to read back, so
  // neither is promised (DSP-121 review B1): the new session begins from the next
  // message alone.
  const newSession =
    savedMessageCount > 0
      ? 'start a new provider session, with a recap you can remove before sending'
      : 'start a new provider session, which begins from your next message alone ' +
        '(this conversation has no saved messages, so there is no recap)';
  const readable =
    savedMessageCount > 0 ? ' The saved conversation stays readable either way.' : '';
  const switchToCursor = choices.includes('switch-to-cursor')
    ? ' Or switch this conversation to Cursor, which opens a new Cursor session the ' +
      'same way.'
    : '';
  return choices.includes('try-again')
    ? ' You can try again, which closes this view\'s session first (a build or test ' +
        'command still running is stopped) and asks to resume the same ID once more; ' +
        `or ${newSession}.${switchToCursor}${readable}`
    : ` You can ${newSession}; it closes this view's session first (a build or test ` +
        `command still running is stopped).${switchToCursor}${readable}`;
}

/** The guard's closing sentence, naming only the choices offered. */
function choicesInstruction(choices: readonly ContinuityChoice[], agentNeeded = false): string {
  if (choices.includes('try-again')) {
    return 'Choose: try again, or start a new provider session.';
  }
  if (choices.includes('new-session')) {
    return choices.includes('resume-recorded')
      ? 'Choose: start a new provider session, or resume with the recorded agent.'
      : 'Start a new provider session to continue.';
  }
  if (agentNeeded) {
    return choices.includes('resume-recorded')
      ? 'Choose an agent, or resume with the recorded agent.'
      : 'Choose an agent to continue.';
  }
  return choices.includes('resume-recorded')
    ? 'Resume with the recorded agent to continue.'
    : 'Start a new provider session to continue.';
}

/** The `contextNote` while no provider session is open: nothing is or will be resent. */
function noSessionOpenNote(savedMessageCount: number): string {
  if (savedMessageCount === 0) {
    // Nothing to show as history and nothing to recap (DSP-121 review B1).
    return (
      'Nothing was resent and nothing will be: no provider session is open. This ' +
      'conversation has no saved messages, so a new provider session, if you choose ' +
      'one, has no recap to show and begins from your next message alone.'
    );
  }
  return (
    'Nothing was resent and nothing will be: no provider session is open. The ' +
    `conversation's ${String(savedMessageCount)} saved message${
      savedMessageCount === 1 ? ' is' : 's are'
    } on screen as history only. A new provider session, if you choose one, shows ` +
    'its recap before anything is sent.'
  );
}

/**
 * The resumed statement, worded from what the adapter reports it checked and from
 * nothing else — in particular not from `capabilities().resume`, which says what an
 * adapter claims in general rather than what this call did.
 */
function resumedWording(
  previousId: string,
  adapterId: string,
  evidence: ResumeEvidence | undefined,
): { readonly statement: string; readonly contextNote: string } {
  if (evidence === 'provider-answered') {
    return {
      statement:
        `The provider session ${previousId} was resumed, so this is the same ` +
        'agent you were talking to before, with the earlier turns in its own ' +
        'memory. That was checked by asking the provider for it, not assumed: ' +
        'resuming an agent the provider does not have is refused rather than ' +
        'silently starting a new one.',
      contextNote:
        'DSpatch resent nothing, because nothing needed resending: the ' +
        'provider still holds this session and the earlier turns are in its ' +
        'own store. That store is Cursor\'s, under your user profile and keyed ' +
        'by this project\'s path — a different place from the conversation file ' +
        'DSpatch writes. The two can drift apart: deleting one does not delete ' +
        'the other, and a conversation moved to another machine will come back ' +
        'as history with no provider session behind it.',
    };
  }
  if (evidence === 'local-record') {
    return {
      statement:
        `DSpatch found a local record of session ${previousId} and registered it. ` +
        'The first turn will show whether the provider reports the same session; ' +
        'whether it recalled the earlier turns is not something DSpatch checks.',
      contextNote:
        'DSpatch resent nothing: the session was registered from a local record, and ' +
        'the earlier turns, if the provider still has them, are in its own store rather ' +
        'than in the conversation file DSpatch writes. The two can drift apart.',
    };
  }
  return {
    statement:
      `Session ${previousId} was resumed by the ${adapterId} adapter; the adapter ` +
      'does not say what it checked.',
    contextNote:
      'DSpatch resent nothing: the session was registered as resumed, and whether the ' +
      'provider has the earlier turns is not something this adapter reports. The ' +
      'conversation file DSpatch writes is a separate record.',
  };
}

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

/** Milliseconds as seconds for a sentence: whole seconds as integers, otherwise one decimal. */
function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : String(Math.round(seconds * 10) / 10);
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
  /**
   * DSP-145, DSP-146: the commands the agent ran in this turn, from the adapter's
   * `command.finished`, with the snapshots DSpatch took when it saw the start and the end.
   */
  readonly commands: AgentCommandRecord[];
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
   * The adapter's own digest of the tool policy it applies (DSP-122). Recorded as
   * the session's `toolPolicy` so a later resume can be checked against it. Absent
   * on an adapter without one (Cursor), whose sessions record `provider-default`.
   */
  policyDigest?(): string;
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
  /**
   * The longest time from `cancel()` resolving to the run's terminal `run.finished`
   * that the adapter guarantees by its own timers, as on `AgentAdapter`. Absent
   * means not declared, which is the Cursor and presentation adapters' state; the
   * confirmation window then stays at its default. See {@link CANCEL_CONFIRM_GRACE_MS}.
   */
  readonly cancelEndBoundMs?: number;
  /**
   * `true` when the adapter runs the provider as a local process DSpatch started
   * (the Claude adapter, DSP-117). The attempt ledger then says that process is
   * running while a turn runs, and reads a confirmed local end (`stopped`,
   * `forced`) as that process gone and the provider's work unknown. Absent means
   * not (Cursor, presentation and test adapters), and their attempts are unchanged.
   */
  readonly runsLocalProcess?: boolean;
  /**
   * The permission policy the adapter gives every turn, where it has one (the
   * Claude adapter). Shown as the session's `toolPolicySent` (DSP-117). Absent for
   * Cursor, whose sessions use the provider's default and say so.
   */
  permissionPolicy?(): ClaudePermissionPolicy;
  subscribe(sessionId: string, listener: AgentEventListener): Unsubscribe;
  send(sessionId: string, prompt: string): Promise<RunReference>;
  /** DSP-149: see {@link AgentAdapter.setWorkspaceRoots}. */
  setWorkspaceRoots?(sessionId: string, roots: readonly string[]): void;
  /** DSP-149: see {@link AgentAdapter.setSessionModel}. */
  setSessionModel?(sessionId: string, modelId: string): void;
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

/**
 * DSP-136: where the agent chosen explicitly in *Open a project* is kept. `read`
 * returns `null` for an installation where nobody has chosen one.
 */
export interface AgentChoiceStore {
  read(): StoredSessionProvider | null;
  write(provider: StoredSessionProvider): void;
}

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
  readonly createAdapter?: (provider: StoredSessionProvider) => ChatAdapter;
  /**
   * DSP-117: the authorization reference this launch was started with
   * (`DSPATCH_CLAUDE_AUTHORIZATION`), or `null`/absent when Claude is not enabled.
   * Only whether it exists and its text are read here; the adapter is built by
   * `createAdapter`. Without it Claude cannot be chosen.
   */
  readonly claudeAuthorizationReference?: string | null;
  /**
   * DSP-133: whether Claude support (`app/claude-support/`) is installed, read once
   * at launch by the main process. Absent means not installed: Claude is chosen only
   * with both this and the authorization reference. Nothing here installs anything.
   */
  readonly claudeSupport?: { readonly installed: boolean; readonly reason: string | null };
  /**
   * DSP-136: where the agent the person chose explicitly is kept (main.ts: a small
   * file under `userData`). Absent, or reading `null`, means no agent is chosen:
   * a project then opens with no session and asks for one. There is no default.
   */
  readonly agentChoiceStore?: AgentChoiceStore;
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
   * DSP-149: the empty folder DSpatch owns for a conversation with no workspace yet.
   * Never a person's project, never DSpatch's repository, never the process's working
   * directory. Required to open such a conversation.
   */
  readonly looseFolder?: () => string;
  /**
   * DSP-149: DSpatch's own functions offered to the chat's agent as tools (the workspace
   * functions the menus use). Called once per opened session. Loop steps and the review
   * discussion never get them.
   */
  readonly appTools?: () => readonly AppTool[];
  /**
   * DSP-149: the model chosen for each provider, kept across restarts. `null` is no
   * choice: the provider's own default (Claude), or the configured default (Cursor).
   */
  readonly modelChoice?: {
    read(provider: StoredSessionProvider): string | null;
    write(provider: StoredSessionProvider, modelId: string | null): void;
  };
  /** DSP-149: called whenever a turn has ended, so the host can act on what it asked for. */
  readonly onTurnSettled?: () => void;
  /**
   * DSP-149, scripted trials only: the first model lookup fails with a SIMULATED error,
   * so a trial can show the retry and that a saved choice survives it. Never set in an
   * ordinary launch.
   */
  readonly failFirstModelList?: boolean;
  /**
   * Where generated sample projects live. Defaults to `%TEMP%/dspatch-chat`.
   *
   * Present so a test can own the location it plants leftovers in rather than
   * writing into the real one. Production passes nothing.
   */
  readonly sampleProjectsRoot?: string;
  /**
   * DSP-145, DSP-146: which working copies have a command running - one the Run button
   * started, or a shell command the agent's runtime reported starting - so the Run button
   * does not start a second one beside it. Defaults to the process-wide slots; a test
   * passes its own.
   */
  readonly commandSlots?: WorkspaceCommandSlots;
  /**
   * Overrides for the two waiting periods, so a test does not spend 100 seconds
   * establishing a rule about them. Production passes nothing.
   */
  readonly timings?: {
    /** Replaces {@link CANCEL_CONFIRM_MS}: the window without a declared bound, and its floor with one. */
    readonly cancelConfirmMs?: number;
    readonly cancelWatchMs?: number;
    /** Replaces {@link CANCEL_CONFIRM_GRACE_MS}. */
    readonly cancelConfirmGraceMs?: number;
  };
}

/**
 * Everything this window holds for one conversation, for the whole app run.
 *
 * DSP-4 rework WS-1. Until then the records read back from a file lived in single
 * fields on the service — one set of carried messages, one carried test, one reviewed
 * diff, one window-wide attempt ledger — and opening a second conversation released
 * the first one's records while keeping its diff and test in place. Reopening the
 * first then saved it from what was left: offline probe V1 watched A's file go from
 * three messages to one, from four attempts to one and from one test run to none,
 * with B's reviewed diff and failing test written into A.
 *
 * So each conversation keeps its own record here from the moment it is opened or read
 * back until the window closes, and nothing about one conversation is a field the
 * next one can inherit. Holding is not reading again: a conversation already held is
 * never re-read from its file in the same run, which is what keeps a switch from
 * raising its unknown outcomes a second time or saying "carried across a restart"
 * when no restart happened.
 */
interface HeldConversation {
  readonly conversationId: string;
  /** The working copy the conversation is about. */
  projectPath: string;
  readonly createdAtUtc: string;
  /** This conversation's attempts, and no other's. */
  readonly ledger: AttemptLedger;
  /** The messages its file held when it was first read in this run. */
  readonly carriedMessages: readonly StoredMessage[];
  /** Every command result, the file's and this run's, in the order they ran. */
  readonly testRuns: TestOutcome[];
  /** The result shown for this conversation last, by its own commands only. */
  lastTest: TestOutcome | null;
  reviewedDiff: WorkspaceReport | null;
  /**
   * The baseline its file held, until a session over it builds its own; then released,
   * because the save writes the new one and nothing reads this again (review 004 S4).
   */
  carriedBaseline: StoredBaseline | null;
  /** The baseline of the latest session over it, built from that session's snapshot. */
  storedBaseline: StoredBaseline | null;
  /** The project and session last written, so it can be saved when not on screen. */
  project: StoredConversation['project'] | null;
  session: StoredSession | null;
  /**
   * A SHA-256 of the last body written, so an unchanged conversation is not rewritten.
   * A digest rather than the body: the body carries the baseline's content, and keeping
   * it would hold a third copy of every project's files for as long as the window runs.
   */
  lastSavedDigest: string | null;
}

/** A command while it runs, and who it belongs to. */
interface ActiveCommand {
  readonly child: ChildProcess;
  readonly attemptId: string;
  /** The ledger of the conversation that started it, whatever is open later. */
  readonly ledger: AttemptLedger;
  /** Set when DSpatch itself killed it, so its exit is never read as a result. */
  killedByDspatch: boolean;
}

/**
 * The acknowledgements from the window that can name an attempt, and nothing else.
 *
 * They arrive over IPC, so their shape is not guaranteed by the type. An entry that is
 * neither an attempt ID nor `{conversationId, attemptId}` names no attempt and is
 * dropped here, which can only leave a gate closed, never open one.
 */
function wellFormedAcknowledgements(
  acknowledgements: readonly unknown[],
): AttemptAcknowledgement[] {
  if (!Array.isArray(acknowledgements)) {
    return [];
  }
  return acknowledgements.filter(
    (entry): entry is AttemptAcknowledgement =>
      typeof entry === 'string' ||
      (typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { attemptId?: unknown }).attemptId === 'string' &&
        ((entry as { conversationId?: unknown }).conversationId === null ||
          typeof (entry as { conversationId?: unknown }).conversationId === 'string')),
  );
}

/**
 * How the chat's build or test command is spawned: through the shell, and on
 * POSIX as the leader of its own process group so that a stop reaches what the
 * shell started (`process-tree.ts`). Process group on POSIX; not measured on
 * Linux. On Windows the options are exactly what they were before.
 */
export function chatCommandSpawnOptions(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): { cwd: string; shell: true; windowsHide: true; detached?: true } {
  return { cwd, shell: true, windowsHide: true, ...treeSpawnOptions(platform) };
}

/** What {@link stopChatCommandTree} needs from the world, injected so it can be tested. */
export interface ChatCommandStopDeps {
  readonly platform: NodeJS.Platform;
  /** The chat waits for `taskkill` and logs a failure, so this is synchronous. */
  readonly spawnSync: (
    command: string,
    args: string[],
    options: { windowsHide: boolean; encoding: 'utf8' },
  ) => { status: number | null; stderr?: string | null };
  /** Defaults to `process.kill`. */
  readonly kill?: KillFunction;
  readonly log: (message: string) => void;
}

/**
 * Stop the chat's command and what it started.
 *
 * Windows: the same synchronous `taskkill /PID <pid> /T /F` as always, with its
 * exit status and stderr logged when it fails. Elsewhere: SIGKILL to the
 * command's process group, falling back to the shell alone if the group cannot
 * be signalled. Process group on POSIX; not measured on Linux. A DSpatch crash or
 * Ctrl+C in the dev terminal does not reach the detached group, and a descendant
 * that calls `setsid` escapes it.
 *
 * Throws what the platform call throws; the caller treats the stop as best effort.
 */
export function stopChatCommandTree(
  child: StoppableChild & { readonly pid: number },
  deps: ChatCommandStopDeps,
): void {
  if (deps.platform === 'win32') {
    const killed = deps.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (killed.status !== 0) {
      deps.log(`taskkill exit=${String(killed.status)} ${killed.stderr?.trim() ?? ''}`);
    }
  } else {
    const stopped = stopPosixProcessGroup(child, deps.kill);
    if (stopped.kind === 'child-only') {
      deps.log(
        `process group ${String(stopped.pid)} could not be signalled ` +
          `(${stopped.groupError}); killed the shell alone`,
      );
    }
  }
}

/**
 * Whether two working copies are the same folder or one is inside the other.
 *
 * The repeat block's unit (WS-1 #11, plan section 7): one writing run per working
 * copy, so an unresolved run in a folder blocks the same kind of work over that
 * folder, over any folder inside it and over any folder it is inside. Case-insensitive
 * on Windows, where a different spelling is the same folder. This assumes a run
 * writes only inside its own working copy, which nothing enforces; it is a safety
 * rule, not containment.
 */
export function workingCopiesOverlap(
  left: string,
  right: string,
  /** The platform whose path rules apply. Production passes nothing. */
  platform: NodeJS.Platform = process.platform,
): boolean {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const normalise = (candidate: string): string => {
    const resolved = paths.resolve(candidate);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const a = normalise(left);
  const b = normalise(right);
  const inside = (inner: string, outer: string): boolean =>
    inner.startsWith(outer.endsWith(paths.sep) ? outer : `${outer}${paths.sep}`);
  return a === b || inside(a, b) || inside(b, a);
}

export class ChatService {
  private readonly options: ChatServiceOptions;

  private adapter: ChatAdapter | null = null;

  /** The provider `adapter` was created for (DSP-117, review B2). */
  private adapterProvider: StoredSessionProvider | null = null;

  /**
   * The agent selected for the conversation on screen (DSP-117): the open session's
   * provider, or, while none is open, the one a new session would use, or `null`
   * when no agent is chosen (DSP-136). A new provider session without a named
   * provider uses this one.
   */
  private selectedProvider: StoredSessionProvider | null = null;

  /**
   * DSP-136: the agent the person last chose explicitly, from the store, or `null`.
   * Opening a project without naming a provider uses it; it is never Cursor by
   * default.
   */
  private chosenProvider: StoredSessionProvider | null | undefined = undefined;

  /**
   * Which provider the open session's handle belongs to, written to the
   * conversation file as `session.provider` (DSP-122). Set with `this.session`.
   */
  private sessionProvider: StoredSessionProvider = 'cursor';

  private session: ChatSessionInfo | null = null;

  private baseline: WorkspaceSnapshot | null = null;

  /**
   * DSP-149: every folder of the open session's workspace, the primary first. The
   * primary is `this.session.workspacePath` and has {@link baseline}; each other folder
   * has its own baseline in {@link otherBaselines}, taken when the session opened or when
   * the folder was added.
   */
  private workspaceFolders: readonly string[] = [];

  private readonly otherBaselines = new Map<string, WorkspaceSnapshot>();

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
  private activeCommand: ActiveCommand | null = null;

  /**
   * DSP-146: shell commands the agent's runtime reported starting and not yet ending, by
   * command id: the working copy's snapshot when the start was seen, and the Run slot held
   * for it so the Run button does not start a second command beside it.
   */
  private readonly agentCommandStarts = new Map<
    string,
    { readonly beforeSnapshotId: string | null; readonly workspacePath: string | null; release(): void }
  >();

  /** The result the window is showing, and the snapshots it is bound to. */
  private lastTest: TestOutcome | null = null;

  private terminalSeenForTurn = false;

  private pendingPrompt = '';

  private runner: NodeRunner | null;

  /**
   * The attempt numbers this window has handed out or read back.
   *
   * Every attempt lives in its conversation's ledger ({@link HeldConversation}), and
   * a ledger is deliberately **not** cleared when a session closes: a run whose end
   * was never confirmed does not stop being unresolved because DSpatch opened a
   * different project. Sharing this counter between the ledgers means a new attempt
   * never takes a number another held conversation already uses.
   */
  private readonly attemptSequence: AttemptSequence = { last: 0 };

  /** What the run state reads before any conversation is open: empty. */
  private readonly noConversationLedger = new AttemptLedger(undefined, this.attemptSequence);

  /** The attempt a `send` in flight belongs to. `run.started` needs it. */
  private pendingAttemptId: string | null = null;

  /** By run ID, with the ledger of the conversation the run belongs to. */
  private readonly attemptByRunId = new Map<
    string,
    { readonly ledger: AttemptLedger; readonly attemptId: string }
  >();

  /** Sends the window stopped waiting for. Their runs are stopped if they start. */
  private readonly abandonedAttempts = new Set<string>();

  private readonly cancelConfirmMs: number;

  private readonly cancelConfirmGraceMs: number;

  private readonly cancelWatchMs: number;

  private readonly readAuthStatus: () => Promise<AuthStatusReading>;

  // --- Saved conversations (DSP-4) -------------------------------------------

  /** The conversation the current work belongs to. `null` before a project opens. */
  private conversationId: string | null = null;

  /**
   * Every conversation this window has opened or read back, by ID, kept until the
   * window closes. See {@link HeldConversation}.
   */
  private readonly held = new Map<string, HeldConversation>();

  /** Saved conversations with unresolved attempts, as listed at the first open. */
  private unresolvedOnDisk: readonly {
    readonly conversationId: string;
    readonly projectPath: string;
  }[] | null = null;

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

  /**
   * The latest save failure of each conversation, until that conversation is saved.
   *
   * Per conversation rather than one "last error" (WS-1 follow-up): a conversation
   * that is not on screen is still saved when something of its own changes, and with
   * one shared field its failure was never shown and the next conversation's
   * successful save erased it (verifier 001, A1/A2).
   */
  private readonly saveErrors = new Map<
    string,
    { readonly error: string; readonly readOnly: boolean }
  >();

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
    this.cancelConfirmGraceMs = options.timings?.cancelConfirmGraceMs ?? CANCEL_CONFIRM_GRACE_MS;
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

  /** The model a session would ask for; `''` while no agent is chosen. */
  modelRequested(): string {
    return this.selectedProvider === null ? '' : this.modelFor(this.selectedProvider);
  }

  /**
   * The model a session with this provider asks for (DSP-149): the person's choice for
   * that provider. With no choice, Claude is asked for no model, so the provider's own
   * default applies; DSpatch no longer picks one for it.
   */
  modelFor(provider: StoredSessionProvider): string {
    const chosen = this.options.modelChoice?.read(provider) ?? null;
    if (provider === 'claude') {
      return chosen ?? process.env['DSPATCH_CLAUDE_MODEL'] ?? '';
    }
    return chosen ?? this.cursorModelRequested();
  }

  private cursorModelRequested(): string {
    return this.modelChosen ?? process.env['DSPATCH_CHAT_MODEL'] ?? DEFAULT_MODEL;
  }

  /** DSP-149: the model ids a provider listed in this launch, or `null` if none was read. */
  knownModelIds(provider: StoredSessionProvider): readonly string[] | null {
    const listed = this.modelLists.get(provider);
    return listed === undefined ? null : listed.flatMap((model) => (model.resolvedId === undefined ? [model.id] : [model.id, model.resolvedId]));
  }

  /** The models each provider listed in this launch, by its SDK's own discovery. */
  private readonly modelLists = new Map<StoredSessionProvider, readonly ModelInfo[]>();

  /**
   * DSP-149: the models this provider offers the account, from its adapter's own
   * discovery (Claude: the SDK's `supportedModels()`, no model turn; Cursor:
   * `Cursor.models.list()`). The open session's adapter when it is that provider's;
   * otherwise one built for the reading and disposed again. Read once per launch.
   */
  async listModels(provider: StoredSessionProvider): Promise<ModelListing> {
    // One lookup at a time per agent: two controls asking at once share it rather than
    // starting Claude Code twice.
    const running = this.modelListsInFlight.get(provider);
    if (running !== undefined) {
      return running;
    }
    const lookup = this.readModelList(provider).finally(() => {
      this.modelListsInFlight.delete(provider);
    });
    this.modelListsInFlight.set(provider, lookup);
    return lookup;
  }

  private readonly modelListsInFlight = new Map<StoredSessionProvider, Promise<ModelListing>>();

  private modelListFailedOnce = false;

  private async readModelList(provider: StoredSessionProvider): Promise<ModelListing> {
    const chosen = this.modelFor(provider);
    const source =
      provider === 'claude'
        ? "the Claude Agent SDK's supportedModels(), read without a model turn"
        : "Cursor's SDK, Cursor.models.list()";
    const cached = this.modelLists.get(provider);
    const toListing = (models: readonly ModelInfo[]): ModelListing => ({
      provider,
      chosen,
      error: null,
      source,
      models: models.map((model) => ({
        id: model.id,
        displayName: model.displayName === '' ? model.id : model.displayName,
        ...(model.description === undefined ? {} : { description: model.description }),
        ...(model.resolvedId === undefined ? {} : { resolvedId: model.resolvedId }),
      })),
    });
    if (cached !== undefined) {
      return toListing(cached);
    }
    const startedAt = Date.now();
    this.options.log(`model list for ${provider}: reading`);
    try {
      if (this.options.failFirstModelList === true && !this.modelListFailedOnce) {
        this.modelListFailedOnce = true;
        throw new Error('SIMULATED for a scripted trial (DSPATCH_FAIL_MODEL_LIST_ONCE): the model list could not be read.');
      }
      this.requireProviderAvailable(provider);
      const own = this.adapter !== null && this.adapterProvider === provider ? this.adapter : null;
      const adapter = own ?? this.createAdapterFor(provider);
      try {
        const listed = await adapter.listModels();
        this.options.log(`model list for ${provider}: ${String(listed.length)} models in ${String(Date.now() - startedAt)} ms`);
        this.modelLists.set(provider, listed);
        const listing = toListing(listed);
        // Said plainly when the list is a stand-in: presentation mode answers for both agents.
        return adapter.id === 'presentation-local'
          ? { ...listing, source: "SIMULATED: the presentation adapter's fixed list" }
          : listing;
      } finally {
        if (own === null) {
          await adapter.dispose();
        }
      }
    } catch (error) {
      this.options.log(`model list for ${provider}: failed after ${String(Date.now() - startedAt)} ms: ${describeError(error)}`);
      return { provider, chosen, models: [], error: describeError(error), source };
    }
  }

  /**
   * Whether Claude can be chosen, and the words the window shows for the agent.
   *
   * Nothing here reads a credential or checks a login: the reference is the text the
   * launch was started with, and DSpatch's own credential rule is applied by the
   * adapter when a session starts.
   */
  agentChoice(provider: StoredSessionProvider | null = this.selectedProvider): AgentChoiceInfo {
    const reference = this.claudeReference();
    const claudeInstalled = this.claudeInstalled();
    const unavailable = this.claudeUnavailable();
    const claudeEnabled = unavailable === null;
    const claudeNote =
      unavailable ?? `Enabled for this launch by DSPATCH_CLAUDE_AUTHORIZATION ("${reference}").`;
    const connectionText =
      provider === 'claude'
        ? claudeEnabled
          ? 'Claude Agent SDK · authorization reference recorded for this launch ' +
            '(login not checked by DSpatch)'
          : !claudeInstalled
            ? 'Claude Agent SDK · Claude support not installed'
            : 'Claude Agent SDK · not enabled for this launch'
        : provider === 'cursor'
          ? 'Cursor SDK · login checked only when a Cursor session is used'
          : 'No agent chosen';
    const policy =
      this.adapter !== null && provider !== null && this.adapterProvider === provider
        ? this.adapter.permissionPolicy?.()
        : undefined;
    return {
      claudeEnabled,
      claudeInstalled,
      claudeNotInstalledText: claudeInstalled ? null : CLAUDE_NOT_INSTALLED_TEXT,
      claudeNote,
      connectionText,
      toolPolicyText:
        policy !== undefined
          ? describePermissionPolicy(policy)
          : provider === 'claude'
            ? 'the Claude chat policy (shown once a session is open)'
            : provider === 'cursor'
              ? 'provider-default'
              : 'none (no agent chosen)',
    };
  }

  private claudeReference(): string | null {
    const reference = this.options.claudeAuthorizationReference?.trim() ?? '';
    return reference === '' ? null : reference;
  }

  /** DSP-136: whether this provider can be chosen in this launch (one rule, provider-availability). */
  private available(provider: StoredSessionProvider): boolean {
    return this.availabilityOf(provider).choosable;
  }

  private availabilityOf(provider: StoredSessionProvider): ProviderAvailability {
    return providerAvailability(provider, {
      claudeAuthorized: this.claudeReference() !== null,
      claudeInstalled: this.claudeInstalled(),
    });
  }

  /** DSP-136: the agent last chosen explicitly, or `null`. */
  chosenAgent(): StoredSessionProvider | null {
    // Read on first use, not at construction: the store lives under `userData`,
    // which main.ts settles after this service is constructed.
    if (this.chosenProvider === undefined) {
      try {
        this.chosenProvider = this.options.agentChoiceStore?.read() ?? null;
      } catch (error) {
        this.options.log(`the agent choice could not be read: ${describeError(error)}`);
        this.chosenProvider = null;
      }
    }
    return this.chosenProvider;
  }

  /**
   * DSP-136: record an explicit choice of agent from *Open a project*. Refused, with
   * the reason, for a provider that cannot be chosen. Builds no adapter and asks no
   * provider anything; it only changes what the next opened project uses.
   */
  chooseAgent(provider: StoredSessionProvider): StoredSessionProvider | null {
    const availability = this.availabilityOf(provider);
    if (!availability.choosable) {
      throw new Error(availability.reason ?? `${providerDisplayName(provider)} cannot be chosen.`);
    }
    this.chosenProvider = provider;
    try {
      this.options.agentChoiceStore?.write(provider);
    } catch (error) {
      this.options.log(`the agent choice could not be saved: ${describeError(error)}`);
    }
    return provider;
  }

  /** DSP-133: Claude support as read at launch; absent counts as not installed. */
  private claudeInstalled(): boolean {
    return this.options.claudeSupport?.installed === true;
  }

  /** Why Claude cannot be chosen (each missing part named), or `null` when it can. */
  private claudeUnavailable(): string | null {
    return claudeUnavailableReason({
      authorized: this.claudeReference() !== null,
      installed: this.claudeInstalled(),
    });
  }

  /**
   * Refuse Claude before anything is closed or built, when this launch has not
   * enabled it or Claude support is not installed (DSP-133: authorization AND
   * installed).
   */
  private requireProviderAvailable(provider: StoredSessionProvider): void {
    const unavailable = this.availabilityOf(provider).reason;
    if (unavailable !== null) {
      throw new Error(
        `${unavailable} A Claude session cannot be opened. Nothing was closed and nothing was sent.`,
      );
    }
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
  /**
   * The person chose a model for the selected agent (DSP-149). Kept for that provider
   * across restarts, and given to the open session from its next turn; a turn already
   * running keeps the model it started with. The conversation and its session stay.
   */
  setRequestedModel(modelId: string): string {
    const provider = this.selectedProvider ?? this.chosenAgent();
    if (provider === null) {
      this.modelChosen = modelId.trim() === '' ? null : modelId.trim();
      return this.modelRequested();
    }
    return this.setModelFor(provider, modelId);
  }

  /**
   * DSP-149: the person chose a model for this agent, wherever they chose it (the chat,
   * the start page or the review discussion). Kept per agent and given to the chat's
   * open session from its next turn when that session is this agent's.
   */
  setModelFor(provider: StoredSessionProvider, modelId: string): string {
    const chosen = modelId.trim() === '' ? null : modelId.trim();
    if (provider === 'cursor') {
      this.modelChosen = chosen;
    }
    this.options.modelChoice?.write(provider, chosen);
    const session = this.session;
    const effective = this.modelFor(provider);
    if (session !== null && this.adapter !== null && this.adapterProvider === provider) {
      this.adapter.setSessionModel?.(session.dspatchSessionId, effective);
      this.session = { ...session, modelRequested: effective };
    }
    this.options.log(`model for ${provider}: ${effective === '' ? "the provider's default" : effective}`);
    return effective;
  }

  /** The node executable found for running commands, or `null` if there is none. */
  nodeRunnerPath(): string | null {
    return this.runner?.path ?? null;
  }

  /** The session the window has open, or null. Identity only — not a handle. */
  openSession(): ChatSessionInfo | null {
    return this.session;
  }

  /**
   * The adapter holding the open provider session: provider plus transport, or
   * `null` while none is open. Never builds one (DSP-136): nothing at startup or
   * in a reading of identity creates an adapter.
   */
  adapterInfo(): AdapterInfo | null {
    if (this.adapter === null || this.session === null || !this.continuity.providerSessionOpen) {
      return null;
    }
    return { id: this.adapter.id, capabilities: this.adapter.capabilities() };
  }

  /** The open session's adapter ID, or `null`. Builds nothing. */
  adapterId(): string | null {
    return this.adapterInfo()?.id ?? null;
  }

  /** The open session's adapter capabilities, or `null`. Builds nothing. */
  capabilities(): CapabilityReport | null {
    return this.adapterInfo()?.capabilities ?? null;
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
    // DSP-136: asked only when Cursor is the agent in play or the person asks; logged
    // so that a run record shows every reading of Cursor's login.
    this.options.log("checking Cursor's connection");
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
        // Always Cursor's list (review B2): never a Claude adapter, which has no
        // list. The open Cursor session's adapter when there is one; otherwise a
        // Cursor adapter built for this reading alone and disposed again, so the
        // check never leaves an adapter behind (DSP-136). Only ever asked when
        // Cursor is the chosen agent or the person asks for the check.
        const own =
          this.adapter !== null && this.adapterProvider === 'cursor' ? this.adapter : null;
        const adapter = own ?? this.createAdapterFor('cursor');
        let listed: readonly ModelInfo[];
        try {
          listed = await adapter.listModels();
        } finally {
          if (own === null) {
            await adapter.dispose();
          }
        }
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
        modelRequested: this.cursorModelRequested(),
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
    // DSP-149: a new provider session over the same workspace keeps all its folders.
    const foldersBeforeClose = this.workspaceFolders;
    // DSP-117: an explicitly named provider, or for a new provider session the one
    // already selected. Refused before anything is closed when it cannot be used.
    const selectedBeforeClose = this.selectedProvider;
    // DSP-136: `null` is "no agent chosen", `undefined` "not named here".
    const namedProvider: StoredSessionProvider | null | undefined =
      request.kind === 'retry-resume' || request.kind === 'carry'
        ? undefined
        : request.kind === 'new-provider-session'
          ? (request.provider ?? selectedBeforeClose)
          : request.provider;
    if (
      request.kind === 'new-provider-session' &&
      openBeforeClose !== null &&
      (namedProvider ?? null) === null
    ) {
      throw new Error(
        'No agent is chosen, so no new session can be opened. Choose an agent first. ' +
          'Nothing was closed and nothing was sent.',
      );
    }
    if (namedProvider !== undefined && namedProvider !== null) {
      this.requireProviderAvailable(namedProvider);
    }
    if (request.kind === 'retry-resume' && openBeforeClose !== null) {
      // *Resume with <recorded>* and *Try again* resume with the recorded provider,
      // which must be usable in this launch; refused before anything is closed.
      const recordedBeforeClose = this.savedSessionFor(openBeforeClose.conversationId);
      if (recordedBeforeClose !== null) {
        this.requireProviderAvailable(storedSessionProvider(recordedBeforeClose));
      }
    }
    await this.closeSession();

    let workspacePath: string;
    let workspaceOrigin: string;
    let origin: SessionOrigin;

    if (request.kind === 'new-provider-session' || request.kind === 'retry-resume') {
      if (openBeforeClose === null) {
        throw new Error(
          request.kind === 'retry-resume'
            ? 'No project is open, so there is no recorded provider session to try ' +
                'to resume again. Open a project first.'
            : 'No project is open, so there is nothing to continue in a new provider ' +
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
    } else if (request.kind === 'loose') {
      // DSP-149: no workspace. An empty folder DSpatch owns, so the agent's working
      // directory is never a person's project, DSpatch's repository or wherever the
      // process happened to start.
      const loose = this.options.looseFolder?.() ?? null;
      if (loose === null) {
        throw new Error('A conversation without a workspace cannot be opened in this launch.');
      }
      fs.mkdirSync(loose, { recursive: true });
      origin = 'no-workspace';
      workspacePath = path.resolve(loose);
      workspaceOrigin =
        'an empty folder DSpatch keeps for conversations that have no workspace yet. ' +
        'No project of yours is open, and the agent has no file or command tools here.';
    } else {
      origin = 'chosen-folder';
      workspacePath = this.validateProjectFolder(request.path);
      workspaceOrigin =
        'chosen by you. DSpatch did not create, move or delete anything in it.';
    }
    // DSP-149: every folder of the workspace, the primary first; each is checked as the
    // primary is, so DSpatch's own working copy is refused whichever position it has.
    const requestedFolders =
      request.kind === 'folder' || request.kind === 'carry'
        ? (request.folders ?? [])
        : request.kind === 'new-provider-session' || request.kind === 'retry-resume'
          ? foldersBeforeClose.slice(1)
          : [];
    const workspaceFolders: string[] = [workspacePath];
    for (const folder of requestedFolders) {
      const checked = this.validateProjectFolder(folder);
      if (!workspaceFolders.some((kept) => samePath(kept, checked))) {
        workspaceFolders.push(checked);
      }
    }
    this.workspaceFolders = workspaceFolders;

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
    const conversationId = this.adoptConversationFor(
      workspacePath,
      baseline,
      request.kind === 'folder' || request.kind === 'loose' || request.kind === 'carry'
        ? request.conversationId
        : undefined,
    );
    this.takeOtherBaselines();
    this.runner = resolveNodeRunner();
    const suggestion = suggestBuildCommand(workspacePath, this.runner?.path ?? null);

    // DSP-117 and DSP-136: which provider this session uses, and whether one is
    // opened at all. Cursor is never assumed and nothing falls back silently.
    // - A new provider session uses the provider it names (a switch), or the one
    //   already selected.
    // - Trying again, or *Resume with <recorded>*, uses the recorded provider.
    // - Opening a project or the sample uses the chosen agent: the one named by the
    //   request (the panel's), else the one last chosen in this installation, which
    //   may be none. A recorded session is resumed only when its provider is that
    //   chosen one and is available. Otherwise - nothing chosen, another agent
    //   chosen, or the recorded provider unusable in this launch - the conversation
    //   opens with no session and the named choices, and no adapter is built.
    const savedForSelection = this.savedSessionFor(conversationId);
    const recordedProviderForSelection =
      savedForSelection === null ? null : storedSessionProvider(savedForSelection);
    const chosen: StoredSessionProvider | null =
      request.kind === 'new-provider-session'
        ? (namedProvider ?? null)
        : request.kind === 'carry'
          ? (selectedBeforeClose ?? this.chosenAgent())
          : request.kind === 'retry-resume'
          ? (recordedProviderForSelection ?? selectedBeforeClose)
          : namedProvider === undefined
            ? this.chosenAgent()
            : namedProvider;
    const chosenUsable = chosen !== null && this.available(chosen);
    const opensSession =
      request.kind === 'new-provider-session' || request.kind === 'carry'
        ? chosenUsable
        : recordedProviderForSelection === null
          ? chosenUsable
          : chosenUsable && chosen === recordedProviderForSelection;
    if (!opensSession) {
      return this.openWithoutSession({
        request,
        conversationId,
        workspacePath,
        workspaceOrigin,
        origin,
        gitInfo,
        baseline,
        suggestion,
        recorded: savedForSelection,
        chosen: chosenUsable ? chosen : null,
        // R1: the stored choice itself, so an unusable one is named, not hidden.
        storedChoice: chosen,
      });
    }
    if (chosen === null) {
      throw new Error('unreachable: a session is opened only with a chosen agent');
    }
    const selected: StoredSessionProvider = chosen;
    this.selectedProvider = selected;
    const adapter = await this.adapterFor(selected);
    const config: SessionConfig = {
      provider: selected,
      modelRequested: this.modelFor(selected),
      workspacePath,
      ...this.sessionScope(origin),
      // Review B3: a Claude-recorded session is resumed only under the tool policy
      // it was recorded with; the adapter refuses a mismatch before any lookup.
      ...(request.kind !== 'new-provider-session' &&
      request.kind !== 'carry' &&
      selected === 'claude' &&
      recordedProviderForSelection === 'claude' &&
      savedForSelection !== null
        ? { expectedToolPolicy: savedForSelection.toolPolicy }
        : {}),
    };
    if (request.kind === 'retry-resume') {
      // The same path as opening the folder: the resume is simply attempted again.
      // For a session recorded as a Claude provider session, the acknowledgements
      // are recorded in the working copy first (DSP-122): the unconfirmed-end rule
      // in `openProviderSession` reads the ledger, and an attempt the user has
      // named no longer blocks the resume. The attempt itself stays unresolved. For
      // a Cursor session nothing reads them, so DSP-4's gate is left as it was.
      const acknowledged = wellFormedAcknowledgements(request.acknowledgedAttemptIds ?? []);
      const recordedProvider = storedSessionProvider(this.savedSessionFor(conversationId));
      if (acknowledged.length > 0 && recordedProvider === 'claude') {
        this.acknowledgeInWorkingCopy(
          this.currentLedger(),
          this.conversationsSharingWorkingCopy(),
          'agent-turn',
          acknowledged,
          'Named when trying again to resume the recorded Claude provider session. ' +
            'The attempt stays unresolved; the resume is attempted with it acknowledged.',
        );
      }
      this.options.log(
        `trying again to resume the recorded provider session of ${conversationId}` +
          (acknowledged.length === 0
            ? ''
            : ` (acknowledged attempts given: ${acknowledged
                .map((entry) => (typeof entry === 'string' ? entry : entry.attemptId))
                .join(', ')}; ${
                recordedProvider === 'claude'
                  ? 'recorded in the working copy before the resume'
                  : 'not read for a Cursor session'
              })`),
      );
    }
    const continued = await this.openProviderSession(
      adapter,
      config,
      conversationId,
      workspacePath,
      request.kind === 'new-provider-session' || request.kind === 'carry',
      request.kind === 'carry' ? request.workspaceName : null,
    );
    this.continuity = continued.continuity;
    this.pendingResendContext = continued.continuity.contextToResend;

    // The identity this session info describes: the open provider session, or — when
    // none is open (DSP-121) — the recorded one, on record and unchanged, so the
    // window shows which session the choice is about. No subscription then: the
    // adapter instance holds no session and there is nothing to listen to.
    const providerSessionOpen = continued.handle !== null;
    let identity: {
      readonly dspatchSessionId: string;
      readonly providerSessionId: string;
      readonly createdAt: string;
      readonly toolPolicy: string;
      readonly provider: StoredSessionProvider;
    };
    if (continued.handle === null) {
      identity = {
        dspatchSessionId: continued.recorded.dspatchSessionId,
        providerSessionId: continued.recorded.providerSessionId,
        createdAt: continued.recorded.createdAt,
        toolPolicy: continued.recorded.toolPolicy,
        provider: storedSessionProvider(continued.recorded),
      };
    } else {
      const handle = continued.handle;
      identity = {
        dspatchSessionId: handle.dspatchSessionId,
        providerSessionId: handle.providerSessionId,
        createdAt: handle.createdAt,
        // What the file records as the session's tool policy (DSP-122): the
        // adapter's own digest where it has one (Claude), `provider-default` where
        // it has none (Cursor).
        toolPolicy: adapter.policyDigest?.() ?? 'provider-default',
        provider: handle.provider === 'claude' ? 'claude' : 'cursor',
      };
      this.unsubscribe = adapter.subscribe(handle.dspatchSessionId, (event) => {
        this.onAgentEvent(event);
      });
    }

    const context: SessionContextInfo = {
      workingDirectorySent: workspacePath,
      modelSent: this.modelRequested(),
      // DSP-117: the policy actually given, where the adapter has one (Claude);
      // Cursor's sessions use the provider's default and say so.
      toolPolicySent: this.policyTextWithAppTools(this.agentChoice(selected).toolPolicyText, origin),
      ...this.contextExtras(origin),
      fileContentsSentByDspatch: 0,
      statement: providerSessionOpen
        ? 'DSpatch sent the agent this working directory path, the model name and ' +
          'your prompt text. It read no file and uploaded no file content. Opening a ' +
          'project does not put it in front of the model: the agent reads files ' +
          'itself, as tool calls, and every tool call it makes is listed in the ' +
          'conversation. DSpatch sees the tool name but not which file it touched, ' +
          'so the files on disk are the evidence for what changed.'
        : continued.continuity.kind === 'resume-unavailable'
          ? // No call was made: the adapter has no `resume`, so nothing was handed on.
            'No provider session is open for this conversation, so DSpatch has sent ' +
            'the agent nothing: not this working directory path, not the model name, ' +
            'no prompt text and no file content. The provider was not asked. Opening ' +
            'the history started no agent and no model turn. The values here are what ' +
            'DSpatch would send if you chose to try again or to start a new provider ' +
            'session.'
          : continued.handle === null && continued.newSessionRefused === true
            ? // DSP-117: the adapter refused the new session before starting anything.
              'No provider session is open for this conversation. DSpatch asked the ' +
              'adapter to start a new session, and it refused before starting any ' +
              'process or model turn; no prompt text and no file content went anywhere. ' +
              'The values here are what DSpatch would send if you chose to start a new ' +
              'provider session.'
          : continued.continuity.resumeFailure?.kind === 'unconfirmed-end'
            ? // DSP-122 AC#4: the rule refused before any adapter call was made.
              'No provider session is open for this conversation. DSpatch made no call ' +
              'to the adapter or the provider: the resume was not attempted because the ' +
              'last message has no confirmed end. Nothing was sent anywhere. The values ' +
              'here are what DSpatch would send if you chose to try again or to start a ' +
              'new provider session.'
            : continued.continuity.resumeFailure?.kind === 'provider-differs'
              ? // DSP-117 back-stop: refused before any adapter call was made.
                'No provider session is open for this conversation. DSpatch made no call ' +
                'to the adapter or the provider: the recorded session belongs to another ' +
                'provider than the one selected, and a session is never resumed across ' +
                'providers. Nothing was sent anywhere. The values here are what DSpatch ' +
                'would send if you chose to start a new provider session.'
            : adapter.id === 'claude-agent-sdk' &&
                storedSessionProvider(continued.recorded) === 'claude'
              ? // Keyed on the adapter that was called (its `id`, `ClaudeAgentSdkAdapter`)
                // and on the recorded provider, not on the file alone (review 006 B1).
                // Since DSP-117 a Claude-recorded file is only ever met by the Claude
                // adapter: the back-stop in `openProviderSession` refuses it before any
                // call when another provider is selected, so it is never resumed through
                // Cursor's `Agent.resume`. The Claude adapter's `resume()` starts no process: its lookup
                // passes the derived UUID and the folder to the SDK's `getSessionInfo`,
                // and its policy refusal passes nothing. `config.modelRequested` is read
                // only at a send (`optionsFor`), so no model name reached the SDK.
                'No provider session is open for this conversation. The one call DSpatch ' +
                'made was the adapter\'s resume attempt, which started no provider process ' +
                'and ran no model turn; the adapter\'s refusal states exactly what it ' +
                'checked (see the technical detail). The provider\'s SDK received no model ' +
                'name and no prompt text, and no file content went anywhere. The values ' +
                'here are what DSpatch would send if you chose to try again or to start a ' +
                'new provider session.'
              : // The resume attempt is one call, and it carries the session config: the
                // Cursor adapter passes `config.modelRequested` and `config.workspacePath`
                // to `Agent.resume` with the ID (review 004 B1). Saying nothing was sent
                // would be false for that call.
                'No provider session is open for this conversation. The one call DSpatch ' +
                'made was the resume attempt, which gave the provider\'s SDK the recorded ' +
                'session ID, the model name and this working directory path; it started ' +
                'no agent and ran no model turn, and no prompt text and no file content ' +
                'went anywhere. Opening the history started nothing. The values here are ' +
                'what DSpatch would send if you chose to try again or to start a new ' +
                'provider session.',
    };

    const session: ChatSessionInfo = {
      conversationId,
      dspatchSessionId: identity.dspatchSessionId,
      providerSessionId: identity.providerSessionId,
      modelRequested: this.modelRequested(),
      workspacePath,
      createdAt: identity.createdAt,
      toolPolicy: identity.toolPolicy,
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
      provider: selected,
      // DSP-136: the adapter built for this session - holding it, or asked to resume it.
      adapter: { id: adapter.id, capabilities: adapter.capabilities() },
      agent: this.agentChoice(selected),
    };
    this.session = session;
    this.sessionProvider = identity.provider;
    // Before the first prompt, so a window that is closed straight after opening a
    // project still leaves a conversation to come back to.
    this.saveConversation();
    this.options.log(
      `chat session ${session.dspatchSessionId} -> ${session.providerSessionId}` +
        `${providerSessionOpen ? '' : ' (recorded; no provider session open)'} ` +
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
   * DSP-136: open the conversation with no provider session and no adapter.
   *
   * Reached when no agent is chosen, when another agent is chosen than the one the
   * session was recorded with, or when the recorded provider cannot be used in this
   * launch. The history is on screen, the choices are named - *Start new <chosen>
   * session* when an agent is chosen and usable, *Resume with <recorded>* when the
   * recorded provider is usable - and nothing is built, asked or sent until one is
   * picked. There is no fallback to another provider.
   */
  private openWithoutSession(input: {
    readonly request: StartSessionRequest;
    readonly conversationId: string;
    readonly workspacePath: string;
    readonly workspaceOrigin: string;
    readonly origin: SessionOrigin;
    readonly gitInfo: GitBaselineInfo;
    readonly baseline: WorkspaceSnapshot;
    readonly suggestion: ReturnType<typeof suggestBuildCommand>;
    readonly recorded: StoredSession | null;
    /** The chosen agent, only when it is usable in this launch. */
    readonly chosen: StoredSessionProvider | null;
    /** The chosen agent whether or not it is usable (R1): named when it cannot be used. */
    readonly storedChoice: StoredSessionProvider | null;
  }): ChatSessionInfo {
    const { conversationId, workspacePath, recorded, chosen } = input;
    // R1: a choice that cannot be used in this launch (Claude without its authorization
    // or support, say) is said as such - never as "no agent is chosen".
    const unusableChoice =
      chosen === null && input.storedChoice !== null
        ? {
            provider: input.storedChoice,
            // Without its closing full stop, so it reads inside a sentence.
            reason: (this.availabilityOf(input.storedChoice).reason ?? 'it is unavailable').replace(/[.\s]+$/, ''),
          }
        : null;
    const noChoiceWords =
      unusableChoice === null
        ? 'no agent is chosen'
        : `${providerDisplayName(unusableChoice.provider)} was chosen, but it cannot be used in this launch: ${unusableChoice.reason}`;
    const savedMessageCount = this.mergedMessages(conversationId).length;
    const earlierSends = this.earlierSendsMayHaveReached(conversationId);
    const recordedProvider = recorded === null ? null : storedSessionProvider(recorded);
    const recordedAvailability =
      recordedProvider === null ? null : this.availabilityOf(recordedProvider);
    const choices: ContinuityChoice[] = [];
    if (chosen !== null) {
      choices.push('new-session');
    }
    if (recordedProvider !== null && recordedAvailability?.choosable === true) {
      choices.push('resume-recorded');
    }
    const agentNeeded = chosen === null;

    const sentences: string[] = [];
    let detail: string;
    if (recorded !== null && recordedProvider !== null) {
      const recordedName = providerDisplayName(recordedProvider);
      const why =
        recordedAvailability?.choosable !== true
          ? `${recordedName} cannot be used in this launch: ${recordedAvailability?.reason ?? 'unavailable'}`
          : chosen === null
            ? noChoiceWords
            : `${providerDisplayName(chosen)} is the chosen agent`;
      detail =
        `the recorded session ${recorded.dspatchSessionId} is a ${recordedName} session, ` +
        `and ${why}`;
      sentences.push(
        `DSpatch did not resume ${recorded.dspatchSessionId}: it is a ${recordedName} ` +
          `session, and ${why}. No agent was built, neither provider was asked, no new ` +
          'session was opened and nothing was sent. The session ID stays on record.',
      );
    } else {
      detail = noChoiceWords;
      sentences.push(
        unusableChoice === null
          ? 'No agent is chosen, so DSpatch opened no session: no agent was built, no ' +
              'provider was asked and nothing was sent.'
          : `${noChoiceWords}. DSpatch opened no session: no agent was built, ` +
              'no provider was asked and nothing was sent.',
      );
    }
    if (choices.includes('new-session') && chosen !== null) {
      sentences.push(
        `You can start a new ${providerDisplayName(chosen)} session` +
          (savedMessageCount > 0
            ? ', with a recap of this conversation that is shown first and can be removed.'
            : ', which begins from your next message alone.'),
      );
    }
    if (choices.includes('resume-recorded') && recordedProvider !== null) {
      sentences.push(
        `You can resume with ${providerDisplayName(recordedProvider)}, which asks to ` +
          'resume the recorded session.',
      );
    }
    if (agentNeeded) {
      sentences.push(
        unusableChoice === null
          ? 'Choose an agent to start a session.'
          : 'Choose another agent to start a session.',
      );
    }
    this.options.log(
      `no session opened for ${conversationId} (${detail}); no adapter built, nothing sent; ` +
        `choices=${choices.join(',') || 'choose an agent'}`,
    );

    const failure: ResumeFailure = {
      kind: recordedProvider !== null && chosen !== null && recordedAvailability?.choosable === true
        ? 'provider-differs'
        : 'agent-choice',
      detail,
      providerCode: null,
    };
    const previousId = recorded?.dspatchSessionId ?? null;
    const continuity: SessionContinuity = {
      kind: recorded === null ? 'resume-unavailable' : 'resume-refused',
      providerSessionOpen: false,
      attemptedDspatchSessionId: previousId,
      resumedProviderSessionId: null,
      resumeError: detail,
      resumeFailure: failure,
      earlierSendsMayHaveReached: earlierSends,
      choices,
      ...(recordedProvider === null ? {} : { recordedProvider }),
      ...(agentNeeded ? { agentNeeded: true } : {}),
      ...(unusableChoice === null ? {} : { unusableChoice }),
      contextToResend: null,
      contextNote: noSessionOpenNote(savedMessageCount),
      savedMessageCount,
      statement: sentences.join(' ') + earlierSendsSentence(earlierSends),
    };
    this.selectedProvider = chosen;
    this.continuity = continuity;
    this.pendingResendContext = null;

    const session: ChatSessionInfo = {
      conversationId,
      dspatchSessionId: recorded?.dspatchSessionId ?? '',
      providerSessionId: recorded?.providerSessionId ?? '',
      modelRequested: this.modelRequested(),
      workspacePath,
      createdAt: recorded?.createdAt ?? nowIso(),
      toolPolicy: recorded?.toolPolicy ?? 'none',
      origin: input.origin,
      workspaceOrigin: input.workspaceOrigin,
      git: input.gitInfo,
      baseline: toBaselineInfo(input.baseline),
      context: {
        workingDirectorySent: workspacePath,
        modelSent: this.modelRequested(),
        toolPolicySent: this.agentChoice(chosen).toolPolicyText,
        ...this.contextExtras(input.origin),
        fileContentsSentByDspatch: 0,
        statement:
          'No provider session is open for this conversation, and no agent was built: ' +
          'DSpatch has sent nothing - not this working directory path, not a model ' +
          'name, no prompt text and no file content - and asked no provider anything. ' +
          'The values here are what DSpatch would send once you choose how to continue.',
      },
      continuity,
      suggestedTestCommand: input.suggestion.command,
      suggestedTestCwd: input.suggestion.cwd,
      testCommandNote: input.suggestion.note,
      testRunnerPath: this.runner?.path ?? null,
      testRunnerSource: this.runner?.source ?? null,
      restoredHistory: this.openedHistory ?? {
        conversationId,
        messages: [],
        filePath: null,
        savedAtUtc: null,
        error: null,
      },
      provider: chosen,
      adapter: null,
      agent: this.agentChoice(chosen),
    };
    this.session = session;
    this.sessionProvider = recordedProvider ?? chosen ?? 'cursor';
    // The recorded session, if any, stays on disk exactly as it was (saveConversation
    // keeps it while no provider session is open).
    this.saveConversation();
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
   * disagree, and every branch says which one happened rather than letting the
   * window imply either.
   *
   * **No automatic fallback (DSP-121, Niclas's decision of 24 October 2026).** When
   * the resume is refused, fails, or cannot be attempted, no new session is opened,
   * nothing is sent and the recorded session ID is left on record unchanged. The
   * result then has `handle: null` and a continuity whose `choices` the window
   * offers; the one call to the adapter in that branch is the `resume` itself.
   */
  private async openProviderSession(
    adapter: ChatAdapter,
    config: SessionConfig,
    conversationId: string,
    workspacePath: string,
    /**
     * Do not attempt a resume, because the user asked for a new provider session.
     *
     * Set by the way out of a session that holds an unfinished run — resuming is
     * precisely what lands back in it — and by the "new session" choice after a
     * refused or failed resume. New agent, same conversation, recap disclosed before
     * it is sent and removable until then.
     */
    newProviderSessionRequested = false,
    /**
     * DSP-149: the workspace this conversation has just moved into, which is why the
     * new provider session was opened. `null` for every other new session.
     */
    movedIntoWorkspace: string | null = null,
  ): Promise<OpenedProviderSession> {
    const saved = this.savedSessionFor(conversationId);
    // The same merged conversation the window is given (WS-1 #10): the file's
    // messages and this run's turns, so a conversation worked in earlier in this run
    // is not recapped as if those turns had never happened.
    const savedMessageCount = this.mergedMessages(conversationId).length;
    const previousId = saved?.dspatchSessionId ?? null;
    const earlierSends = this.earlierSendsMayHaveReached(conversationId);

    if (newProviderSessionRequested) {
      let handle: SessionHandle;
      try {
        handle = await adapter.startSession(config);
      } catch (error) {
        // DSP-117: the old session is already closed by now, so a refusal here must
        // not leave the window without its conversation. With a recorded session to
        // stand on, the conversation stays on screen in the no-session state with
        // its choices (for Claude's credential rule: *Start new session* and
        // *Switch to Cursor*). Without one there is nothing to show, and the error
        // is thrown as before.
        if (saved === null || previousId === null) {
          throw error;
        }
        const classified = classifyResumeFailure(error);
        const { detail } = classified.failure;
        const provider: StoredSessionProvider = config.provider === 'claude' ? 'claude' : 'cursor';
        this.options.log(
          `new ${providerName(provider)} session refused (code ` +
            `${classified.failure.providerCode ?? 'none'}): ${detail}; nothing sent, ` +
            `${previousId} stays on record`,
        );
        const choices = noSessionChoices(classified.kind, classified.failure);
        return {
          handle: null,
          recorded: saved,
          newSessionRefused: true,
          continuity: {
            kind: classified.kind,
            providerSessionOpen: false,
            attemptedDspatchSessionId: previousId,
            resumedProviderSessionId: null,
            resumeError: detail,
            resumeFailure: classified.failure,
            earlierSendsMayHaveReached: earlierSends,
            choices,
            contextToResend: null,
            contextNote: noSessionOpenNote(savedMessageCount),
            savedMessageCount,
            statement:
              `DSpatch asked for a new ${providerName(provider)} session and the adapter ` +
              `refused it: ${detail}` +
              (classified.note === '' ? '' : ` ${classified.note}`) +
              ` Nothing was sent. The earlier session ${previousId} stays on record and ` +
              'was not resumed.' +
              earlierSendsSentence(earlierSends) +
              choicesSentence(choices, savedMessageCount),
          },
        };
      }
      const reason =
        movedIntoWorkspace !== null
          ? `this conversation moved into the workspace "${movedIntoWorkspace}", and a provider session belongs to the folder it was started in`
          : previousId === null
            ? 'you asked for a new provider session'
            : `you asked for a new provider session rather than continuing ${previousId}`;
      const recap = this.recapFor(
        conversationId,
        workspacePath,
        reason,
        movedIntoWorkspace === null ? RESEND_LIMITS : CARRY_LIMITS,
      );
      this.options.log(
        `new provider session requested; not resuming ${previousId ?? 'anything'}`,
      );
      return {
        handle,
        recorded: saved,
        continuity: {
          kind: 'new-provider-session',
          ...(movedIntoWorkspace === null
            ? {}
            : {
                contextTransfer: 'automatic' as const,
                ...(recap !== null && recap.length >= CARRY_LIMITS.maxTotalChars ? { contextCut: true } : {}),
              }),
          providerSessionOpen: true,
          attemptedDspatchSessionId: previousId,
          resumedProviderSessionId: null,
          resumeError: null,
          resumeFailure: null,
          earlierSendsMayHaveReached: earlierSends,
          choices: [],
          contextToResend: recap,
          contextNote: resendNote(recap, savedMessageCount),
          savedMessageCount,
          statement:
            movedIntoWorkspace !== null
              ? `This conversation moved into the workspace "${movedIntoWorkspace}". It ` +
                'continues here in a new provider session, because the earlier one was ' +
                'started in another folder and a provider session is resumed only where ' +
                'it began. The model here has no memory of the conversation above. What ' +
                'it will be given is below, word for word, in front of your next message ' +
                '— unless you remove it first. Nothing has been sent.'
              :
            'This is a new provider session, opened because you asked for one. ' +
            'DSpatch did not try to resume ' +
            `${previousId ?? 'the earlier session'}: whatever that session was ` +
            'doing, it is left alone rather than joined or repeated, and it may ' +
            'still be running on the provider\'s side. The model here has no memory ' +
            'of the conversation above. What it will be given is below, word for ' +
            'word, in front of your next message — unless you remove it first.',
        },
      };
    }

    if (saved !== null && previousId !== null) {
      // DSP-117 back-stop: never resume a session through another provider. Before
      // any adapter call, so nothing is asked of either provider and nothing is sent.
      const recordedProvider = storedSessionProvider(saved);
      const selectedProvider: StoredSessionProvider =
        config.provider === 'claude' ? 'claude' : 'cursor';
      if (recordedProvider !== selectedProvider) {
        const detail =
          `the recorded session ${previousId} is a ${providerName(recordedProvider)} ` +
          `session, and ${providerName(selectedProvider)} is selected for this conversation`;
        this.options.log(
          `resume of ${previousId} not attempted (provider-differs): ${detail}; no ` +
            'adapter call, no new session, nothing sent',
        );
        const failure: ResumeFailure = { kind: 'provider-differs', detail, providerCode: null };
        const choices = noSessionChoices('resume-refused', failure);
        return {
          handle: null,
          recorded: saved,
          continuity: {
            kind: 'resume-refused',
            providerSessionOpen: false,
            attemptedDspatchSessionId: previousId,
            resumedProviderSessionId: null,
            resumeError: detail,
            resumeFailure: failure,
            earlierSendsMayHaveReached: earlierSends,
            choices,
            contextToResend: null,
            contextNote: noSessionOpenNote(savedMessageCount),
            savedMessageCount,
            statement:
              `DSpatch did not try to resume ${previousId}: it is a ` +
              `${providerName(recordedProvider)} session, and ` +
              `${providerName(selectedProvider)} is selected. A session is never ` +
              'resumed through another provider. Neither provider was asked, no new ' +
              'session was opened and nothing was sent. The session ID stays on record.' +
              earlierSendsSentence(earlierSends) +
              choicesSentence(choices, savedMessageCount),
          },
        };
      }
      if (adapter.resume === undefined) {
        // Treated like a refusal (DSP-121 default (a)): no automatic new session.
        // Unreachable in the product today, where the Cursor adapter has `resume`.
        const detail = `this build cannot resume a session on the ${adapter.id} adapter`;
        this.options.log(`resume of ${previousId} not attempted: ${detail}`);
        const failure: ResumeFailure = { kind: 'error', detail, providerCode: null };
        const choices = noSessionChoices('resume-unavailable', failure);
        return {
          handle: null,
          recorded: saved,
          continuity: {
            kind: 'resume-unavailable',
            providerSessionOpen: false,
            attemptedDspatchSessionId: previousId,
            resumedProviderSessionId: null,
            resumeError: detail,
            resumeFailure: failure,
            earlierSendsMayHaveReached: earlierSends,
            choices,
            contextToResend: null,
            contextNote: noSessionOpenNote(savedMessageCount),
            savedMessageCount,
            statement:
              `This build cannot resume a session on the ${adapter.id} adapter. The ` +
              'provider was not asked. No new session was opened and nothing was ' +
              `sent. The session ID ${previousId} stays on record. Trying again in ` +
              'this build gives the same answer.' +
              earlierSendsSentence(earlierSends) +
              choicesSentence(choices, savedMessageCount),
          },
        };
      }
      // DSP-122 AC#4: a session recorded as a Claude provider session is not resumed
      // while this conversation's last agent turn has no confirmed end in DSpatch's
      // record and nobody has acknowledged it. The record is the conversation's
      // ledger — what `closeSession` and an unconfirmed cancel leave there — and
      // nothing else: the adapter's in-memory disposal records are not consulted.
      // The refusal comes before any adapter call; "try again" with the attempt
      // acknowledged lifts it. Cursor sessions keep DSP-4's order (resume first,
      // then the send gate), so the two paths meet the same block in different places.
      const unconfirmed = earlierSends.filter((send) => !send.acknowledged);
      if (storedSessionProvider(saved) === 'claude' && unconfirmed.length > 0) {
        const last = unconfirmed[unconfirmed.length - 1];
        const detail =
          `the last message of this conversation, "${last?.label ?? ''}" ` +
          `(${last?.attemptId ?? ''}, ${last?.state ?? ''}), has no confirmed end in ` +
          "DSpatch's record";
        this.options.log(
          `resume of ${previousId} not attempted (unconfirmed-end): ${detail}; the ` +
            'provider was not asked, no new session opened, nothing sent',
        );
        const failure: ResumeFailure = { kind: 'unconfirmed-end', detail, providerCode: null };
        const choices = noSessionChoices('resume-refused', failure);
        return {
          handle: null,
          recorded: saved,
          continuity: {
            kind: 'resume-refused',
            providerSessionOpen: false,
            attemptedDspatchSessionId: previousId,
            resumedProviderSessionId: null,
            resumeError: detail,
            resumeFailure: failure,
            earlierSendsMayHaveReached: earlierSends,
            choices,
            contextToResend: null,
            contextNote: noSessionOpenNote(savedMessageCount),
            savedMessageCount,
            statement:
              `DSpatch did not try to resume ${previousId}. The session is recorded as ` +
              `a Claude provider session, and ${detail}. Resuming it would continue a ` +
              'transcript that may still be being written by a provider process DSpatch ' +
              'could not confirm had exited. The provider was not asked, no new session ' +
              'was opened and nothing was sent. The session ID stays on record. Trying ' +
              'again with that attempt acknowledged attempts the resume (this window ' +
              'cannot send that acknowledgement yet); the attempt itself stays recorded ' +
              'as unresolved.' +
              earlierSendsSentence(earlierSends) +
              choicesSentence(choices, savedMessageCount),
          },
        };
      }
      try {
        const handle = await adapter.resume(previousId, config);
        const wording = resumedWording(previousId, adapter.id, handle.resumeEvidence);
        return {
          handle,
          recorded: saved,
          continuity: {
            kind: 'provider-session-resumed',
            providerSessionOpen: true,
            attemptedDspatchSessionId: previousId,
            resumedProviderSessionId: handle.providerSessionId,
            resumeError: null,
            resumeFailure: null,
            earlierSendsMayHaveReached: earlierSends,
            choices: [],
            contextToResend: null,
            contextNote: wording.contextNote,
            savedMessageCount,
            statement: wording.statement,
          },
        };
      } catch (error) {
        const classified = classifyResumeFailure(error);
        const { detail } = classified.failure;
        this.options.log(
          `resume of ${previousId} ${
            classified.kind === 'resume-refused' ? 'refused' : 'failed'
          } (${classified.failure.kind}, code ${classified.failure.providerCode ?? 'none'}): ` +
            `${detail}; no new session opened, nothing sent, session ID kept on record`,
        );
        const opening =
          classified.failure.kind === 'provider-missing'
            ? `DSpatch asked the provider to resume ${previousId} and the provider ` +
              'answered that it does not have that session ' +
              `(${classified.failure.providerCode ?? 'no code'}).`
            : classified.kind === 'resume-refused'
              ? `DSpatch tried to resume ${previousId} and the resume was refused: ` +
                `${detail}`
              : `DSpatch tried to resume ${previousId} and the attempt failed: ${detail}`;
        const choices = noSessionChoices(classified.kind, classified.failure);
        return {
          handle: null,
          recorded: saved,
          continuity: {
            kind: classified.kind,
            providerSessionOpen: false,
            attemptedDspatchSessionId: previousId,
            resumedProviderSessionId: null,
            resumeError: detail,
            resumeFailure: classified.failure,
            earlierSendsMayHaveReached: earlierSends,
            choices,
            contextToResend: null,
            contextNote: noSessionOpenNote(savedMessageCount),
            savedMessageCount,
            statement:
              `${opening}${classified.note === '' ? '' : ` ${classified.note}`} No new ` +
              'session was opened and nothing was sent. The session ID stays on record.' +
              earlierSendsSentence(earlierSends) +
              choicesSentence(choices, savedMessageCount),
          },
        };
      }
    }

    // No session is recorded, so there is nothing to resume into and nothing a
    // choice could keep: a new session is opened (DSP-121 default (b)).
    const handle = await adapter.startSession(config);
    if (savedMessageCount === 0) {
      return {
        handle,
        recorded: saved,
        continuity: {
          ...FIRST_SESSION_CONTINUITY,
          attemptedDspatchSessionId: previousId,
          earlierSendsMayHaveReached: earlierSends,
        },
      };
    }
    // A saved conversation with messages but no session to resume into: a file
    // carried from another machine, or one written before sessions were recorded.
    const noSession = 'this conversation has no earlier provider session recorded';
    const recap = this.recapFor(conversationId, workspacePath, noSession);
    return {
      handle,
      recorded: saved,
      continuity: {
        kind: 'new-provider-session',
        providerSessionOpen: true,
        attemptedDspatchSessionId: previousId,
        resumedProviderSessionId: null,
        resumeError: noSession,
        resumeFailure: null,
        earlierSendsMayHaveReached: earlierSends,
        choices: [],
        contextToResend: recap,
        contextNote: resendNote(recap, savedMessageCount),
        savedMessageCount,
        statement:
          `This is a new provider session, because ${noSession}. The model has no ` +
          'memory of the conversation above. What it will be given is below, word ' +
          'for word, in front of your next message — unless you remove it first.',
      },
    };
  }

  /**
   * This conversation's agent-turn attempts with no confirmed end, acknowledged ones
   * included and flagged (DSP-121 AC#4). Read from the conversation's own ledger —
   * the record DSpatch keeps — and from nothing else; the adapter's in-memory
   * disposal records are not consulted.
   */
  private earlierSendsMayHaveReached(
    conversationId: string,
  ): readonly EarlierSendMayHaveReached[] {
    const held = this.held.get(conversationId) ?? null;
    if (held === null) {
      return [];
    }
    return held.ledger.unresolved('agent-turn').map((attempt) => ({
      attemptId: attempt.attemptId,
      label: attempt.label,
      state: attempt.state,
      acknowledged: attempt.acknowledgedAtUtc !== null,
    }));
  }

  /** DSpatch's record of a conversation for a model that was told nothing. */
  private recapFor(
    conversationId: string,
    workspacePath: string,
    reason: string,
    limits: typeof RESEND_LIMITS = RESEND_LIMITS,
  ): string | null {
    const held = this.held.get(conversationId) ?? null;
    return buildResendContext({
      workspacePath,
      messages: this.mergedMessages(conversationId),
      reviewedDiff: held?.reviewedDiff ?? null,
      test: held?.lastTest ?? null,
      reason,
      limits,
    });
  }

  /** How this session relates to the conversation's earlier one. */
  sessionContinuity(): SessionContinuity {
    return this.continuity;
  }

  /**
   * Remove the recap DSpatch would put in front of the next message (DSP-121 AC#2).
   *
   * One mechanism for every new provider session, the deliberate one included: the
   * recap is DSpatch talking, and the user may decide the model should hear only
   * them. Final for this session — a send that is then refused does not bring the
   * recap back, because nothing has changed about what the user chose. The record
   * itself is untouched: the conversation file and the history on screen keep every
   * message; only what goes to the provider changes. Nothing is sent by this call.
   */
  discardPendingRecap(): SessionContinuity {
    const session = this.session;
    if (session === null) {
      throw new Error('No session is open. Start one first.');
    }
    if (this.pendingResendContext === null && this.continuity.contextToResend === null) {
      return this.continuity;
    }
    this.pendingResendContext = null;
    this.continuity = {
      ...this.continuity,
      contextToResend: null,
      contextNote:
        'The recap was removed at your request, so only your message will be sent. ' +
        'The model has not been given the conversation above; DSpatch\'s record of it ' +
        'stays in the conversation file and on screen.',
    };
    this.session = { ...session, continuity: this.continuity };
    this.options.log('pending recap removed by the user; the next message goes without it');
    return this.continuity;
  }

  /** The one-line reason `requireSession` gives while no provider session is open. */
  private noProviderSessionHeadline(): string {
    const continuity = this.continuity;
    const id = continuity.attemptedDspatchSessionId ?? 'the recorded session';
    const detail = continuity.resumeFailure?.detail ?? 'no detail';
    if (continuity.resumeFailure?.kind === 'agent-choice' || continuity.resumeFailure?.kind === 'provider-differs') {
      // DSP-136: nothing was attempted; the detail says why.
      return `no session was opened, because ${detail}`;
    }
    switch (continuity.kind) {
      case 'resume-refused':
        return continuity.resumeFailure?.kind === 'provider-missing'
          ? `the provider answered that it does not have session ${id}`
          : continuity.resumeFailure?.kind === 'unconfirmed-end'
            ? `resuming ${id} was not attempted, because ${detail}`
            : `resuming ${id} was refused (${detail})`;
      case 'resume-failed':
        return `resuming ${id} failed (${detail})`;
      case 'resume-unavailable':
        return detail;
      default:
        return `no provider session was opened (${continuity.kind})`;
    }
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
    acknowledgedAttemptIds: readonly AttemptAcknowledgement[] = [],
  ): Promise<{ readonly dspatchRunId: string }> {
    const { adapter, session } = this.requireSession();
    if (prompt.trim() === '') {
      throw new Error('An empty prompt is not sent.');
    }
    // DSP-149: a model the provider does not list for this account is refused here,
    // never replaced by another one.
    const provider = this.adapterProvider;
    const listed = provider === null ? undefined : this.modelLists.get(provider);
    const requested = provider === null ? '' : this.modelFor(provider);
    if (
      listed !== undefined &&
      requested !== '' &&
      !listed.some((model) => model.id === requested || model.resolvedId === requested)
    ) {
      throw new Error(
        `The model "${requested}" is not one ${providerName(provider ?? 'cursor')} offers this account. ` +
          'Choose another model; nothing was sent.',
      );
    }
    const acknowledged = wellFormedAcknowledgements(acknowledgedAttemptIds);
    // The block belongs to the working copy (WS-1 #11): this conversation's attempts
    // and those of every held conversation over the same or a nested folder.
    const ledger = this.currentLedger();
    const sharing = this.conversationsSharingWorkingCopy();
    const decision = AttemptLedger.mayRepeatAcross(
      [ledger, ...sharing.map((held) => held.ledger)],
      'agent-turn',
      acknowledged,
    );
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    this.acknowledgeInWorkingCopy(
      ledger,
      sharing,
      'agent-turn',
      acknowledged,
      `A new message was sent with this attempt left unresolved. ${decision.reason}`,
    );
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
    const attempt = ledger.open('agent-turn', promptLabel(prompt), {
      adapterProcess: adapter.runsLocalProcess === true,
    });
    this.pendingAttemptId = attempt.attemptId;
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
      this.attemptByRunId.set(reference.dspatchRunId, {
        ledger,
        attemptId: attempt.attemptId,
      });
      if (this.abandonedAttempts.has(attempt.attemptId)) {
        // The window stopped waiting while this was pending, and then a run turned
        // out to exist after all. It is asked to stop immediately: an abandoned
        // send must not leave a turn nobody is watching.
        await this.stopAbandonedRun(attempt.attemptId, reference.dspatchRunId, ledger);
      }
      return reference;
    } catch (error) {
      const message = describeError(error);
      ledger.markFailed(
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
    const ledger = this.currentLedger();
    const waiting =
      pendingAttemptId === null
        ? [...ledger.unresolved('agent-turn')]
            .reverse()
            .find(
              (attempt) => attempt.state === 'waiting' || attempt.state === 'running',
            )
        : (ledger.get(pendingAttemptId) ?? undefined);
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
        state: ledger.get(waiting.attemptId)?.state ?? null,
        note:
          `A run did exist for ${waiting.attemptId}, so it was asked to cancel ` +
          `instead (the request resolved in ${String(outcome.elapsedMs)} ms). ` +
          'Whether the provider stopped is a separate question, shown below.',
      };
    }
    this.abandonedAttempts.add(waiting.attemptId);
    ledger.markOutcomeUnknown(
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

  private async stopAbandonedRun(
    attemptId: string,
    runId: string,
    ledger: AttemptLedger,
  ): Promise<void> {
    const session = this.session;
    const adapter = this.adapter;
    this.abandonedAttempts.delete(attemptId);
    if (session === null || adapter === null) {
      return;
    }
    ledger.markCancelRequested(
      attemptId,
      `A run (${runId}) started after you stopped waiting, so DSpatch asked the ` +
        'provider to cancel it. That request has not been confirmed yet.',
    );
    try {
      await adapter.cancel(session.dspatchSessionId);
      this.armCancelConfirmation(attemptId, adapter, ledger);
    } catch (error) {
      ledger.markOutcomeUnknown(
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
    const ledger = this.currentLedger();
    const attempt = [...ledger.unresolved('agent-turn')]
      .reverse()
      .find(
        (entry) => entry.state === 'running' || entry.state === 'waiting',
      );
    if (attempt !== undefined) {
      ledger.markCancelRequested(
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
    this.stopWorkspaceTest(false);
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
        this.armCancelConfirmation(attempt.attemptId, adapter, ledger);
      } else {
        // A cancellation that could not even be requested leaves the run in
        // whatever state it was in. That is unknown, not stopped.
        ledger.markOutcomeUnknown(
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
   * How long: {@link cancelConfirmWindow}. Not shorter than the adapter's own
   * declared course, so DSpatch never gives up on an end the adapter is still
   * bound to deliver (DSP-116). A late terminal event still settles the attempt:
   * `outcome-unknown` is not settled.
   *
   * `unref` so a pending confirmation never holds the process open.
   */
  private armCancelConfirmation(
    attemptId: string,
    adapter: ChatAdapter,
    ledger: AttemptLedger,
  ): void {
    const window = this.cancelConfirmWindow(adapter);
    const timer = setTimeout(() => {
      const current = ledger.get(attemptId);
      if (current === null || current.state !== 'cancel-requested') {
        return;
      }
      const seconds = formatSeconds(window.ms);
      ledger.markOutcomeUnknown(
        attemptId,
        window.declaredBoundMs === null
          ? `No terminal event arrived within ${seconds} s of the ` +
              'cancellation, and the two cancellations that have been measured here ' +
              'reported an end in about 50 ms. So this run\'s ending cannot be ' +
              'established. It is not being treated as stopped, and DSpatch will not ' +
              'start another message by itself while it stands.'
          : `No terminal event arrived within ${seconds} s of the cancellation, ` +
              `although the adapter "${adapter.id}" declares that it ends a cancelled ` +
              `run within ${formatSeconds(window.declaredBoundMs)} s by its own timers ` +
              `(DSpatch waited ${formatSeconds(this.cancelConfirmGraceMs)} s more for ` +
              'the event to arrive). So this run\'s ending cannot be established. It ' +
              'is not being treated as stopped, and DSpatch will not start another ' +
              'message by itself while it stands.',
      );
      this.options.log(
        `${attemptId}: no terminal event within ${seconds} s of cancellation` +
          (window.declaredBoundMs === null
            ? ''
            : ` (adapter bound ${String(window.declaredBoundMs)} ms + grace ` +
              `${String(this.cancelConfirmGraceMs)} ms)`) +
          '; outcome recorded as unknown',
      );
      // The conversation may no longer be on screen, and nothing else would save it
      // until it is opened again or the window closes (WS-1 follow-up, A3).
      this.saveLedgerOwner(ledger);
    }, window.ms);
    timer.unref?.();
  }

  /**
   * How long a cancellation is given to be confirmed: the configured window
   * ({@link CANCEL_CONFIRM_MS} or its test override) when the adapter declares no
   * bound, otherwise the larger of that and the declared bound plus
   * {@link CANCEL_CONFIRM_GRACE_MS}. A declared value that is not a finite,
   * non-negative number counts as not declared.
   */
  private cancelConfirmWindow(adapter: ChatAdapter): {
    readonly ms: number;
    readonly declaredBoundMs: number | null;
  } {
    const declared = adapter.cancelEndBoundMs;
    if (declared === undefined || !Number.isFinite(declared) || declared < 0) {
      return { ms: this.cancelConfirmMs, declaredBoundMs: null };
    }
    return {
      ms: Math.max(this.cancelConfirmMs, declared + this.cancelConfirmGraceMs),
      declaredBoundMs: declared,
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
    if (this.activeCommand !== null) {
      throw new Error(
        'A command is already running in this working copy. Stop it first: two at ' +
          'once would interleave their output and their file writes.',
      );
    }
    const slots = this.options.commandSlots ?? WORKSPACE_COMMAND_SLOTS;
    const agentHolds = slots.holderOf(session.workspacePath);
    if (agentHolds !== null) {
      throw new Error(describeRunRefused(agentHolds));
    }
    // The same rule as for a message, for the same reason. A command whose outcome
    // is unknown may still hold the working directory — on Windows that also
    // prevents the folder from being replaced — so running it again is not a
    // neutral act and is not done on DSpatch's own initiative.
    const acknowledged = wellFormedAcknowledgements(request.acknowledgedAttemptIds ?? []);
    const ledger = this.currentLedger();
    const sharing = this.conversationsSharingWorkingCopy();
    const decision = AttemptLedger.mayRepeatAcross(
      [ledger, ...sharing.map((held) => held.ledger)],
      'command',
      acknowledged,
    );
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    this.acknowledgeInWorkingCopy(
      ledger,
      sharing,
      'command',
      acknowledged,
      `The command was run again with this attempt left unresolved. ${decision.reason}`,
    );
    const command = request.command.trim();
    const cwd = path.resolve(
      request.cwd.trim() === '' ? session.workspacePath : request.cwd.trim(),
    );
    const check = checkRunRequest(command, cwd);
    if (!check.ok) {
      throw new Error(check.message ?? 'The command could not be run.');
    }

    const slot = slots.claim(session.workspacePath, { by: 'person', line: command });
    if (!slot.ok) {
      throw new Error(describeRunRefused(slot.holder));
    }
    // R2: whatever happens from here on, the working copy's command slot is given back,
    // or the Run button would be refused until DSpatch restarted.
    try {
      const shell = describeShell();
      const beforeSnapshotId = this.safeSnapshotId();
      const startedAtUtc = nowIso();
      const startedAt = performance.now();
      // The conversation that started it owns its result (WS-1 #8), even when the
      // session has changed by the time it ends: closing a session stops a command,
      // and its end arrives after the next conversation is already open.
      const ownerId = this.conversationId;

      const attempt = ledger.open('command', command);
      // A process group of its own on POSIX, so that Stop reaches what the shell
      // started; unchanged on Windows. Not measured on Linux.
      const child = spawn(command, chatCommandSpawnOptions(cwd));
      const run: ActiveCommand = {
        child,
        attemptId: attempt.attemptId,
        ledger,
        killedByDspatch: false,
      };
      this.activeCommand = run;
      ledger.markRunning(
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
      if (this.activeCommand === run) {
        this.activeCommand = null;
      }
      if (ended.error !== null) {
        ledger.markFailed(
          attempt.attemptId,
          `The command could not be started: ${ended.error}`,
        );
        throw new Error(
          `The command could not be started: ${ended.error}. DSpatch reports no exit ` +
            'code for a process that never ran.',
        );
      }

      const killedByDspatch = run.killedByDspatch;
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
        // The working copy it ran in, which is not the open one if the session changed.
        afterRunSnapshotId: safeSnapshotIdOf(session.workspacePath),
        baselineSnapshotId: session.baseline.snapshotId,
        gitHeadRevision: session.git.headRevision,
        verdict: verdict.verdict,
        verdictHeadline: verdict.headline,
        attemptId: attempt.attemptId,
      };
      const owner = ownerId === null ? null : (this.held.get(ownerId) ?? null);
      if (owner !== null) {
        owner.testRuns.push(outcome);
        owner.lastTest = outcome;
      }
      // Shown only if its own conversation is still the one open.
      if (this.session !== null && this.conversationId === ownerId) {
        this.lastTest = outcome;
      }
      this.testRuns.push(outcome);
      // The attempt's state follows the verdict, not the exit code. A run DSpatch
      // killed is recorded as stopped rather than completed, and one that ended
      // without an exit code is recorded as unknown, so the attempt list cannot
      // disagree with the result panel about whether anything was established.
      const ending =
        `Exit code ${ended.code === null ? 'none' : String(ended.code)}, signal ` +
        `${ended.signal ?? 'none'}, after ${String(durationMs)} ms. ${verdict.headline}`;
      if (verdict.verdict === 'interrupted') {
        ledger.markStopped(attempt.attemptId, ending);
      } else if (verdict.verdict === 'unknown') {
        ledger.markOutcomeUnknown(attempt.attemptId, ending);
      } else {
        ledger.markCompleted(attempt.attemptId, ending);
      }
      this.options.log(
        `${attempt.attemptId}: command exit=${String(outcome.exitCode)} ` +
          `signal=${outcome.signal ?? 'none'} killed=${String(outcome.killedByDspatch)} ` +
          `verdict=${outcome.verdict} in ${String(outcome.durationMs)} ms ` +
          `snapshot=${outcome.snapshotId ?? 'unknown'} -> ${
            outcome.afterRunSnapshotId ?? 'unknown'
          }`,
      );
      this.saveConversation(ownerId);
      return outcome;
    } finally {
      slot.release();
    }
  }

  /** Stop a running command from the window, with its whole process tree. */
  stopRunningCommand(): { readonly stopped: boolean; readonly note: string } {
    if (this.activeCommand === null) {
      return {
        stopped: false,
        note: 'No command was running, so nothing was stopped.',
      };
    }
    this.stopWorkspaceTest(true);
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

  /**
   * DSP-145, DSP-146: every command the agent ran in the open conversation (with its own
   * shell tool, or earlier through DSpatch's former command tool), oldest first, each with whether its result still describes the code
   * on disk - the same freshness rule as the Run button's result, against the snapshot
   * taken after the command ended. Re-hashes the working copy once.
   */
  getAgentCommands(): AgentCommandsReport {
    const checkedAtUtc = nowIso();
    const messages =
      this.conversationId === null
        ? this.turns
            .filter((turn) => turn.conversationId === null)
            .map((turn) => toStoredMessage(turn))
        : this.mergedMessages(this.conversationId);
    const records = messages.flatMap((message) =>
      (message.commands ?? []).map((record) => ({ record, dspatchRunId: message.dspatchRunId })),
    );
    const currentSnapshotId = records.length === 0 ? null : this.safeSnapshotId();
    const commands: AgentCommandView[] = records.map(({ record, dspatchRunId }) => {
      const verdict = evaluateFreshness({
        hasResult: true,
        testedSnapshotId: record.testedSnapshotId,
        afterRunSnapshotId: record.afterRunSnapshotId,
        currentSnapshotId,
      });
      const standing = verdict.kind === 'current' || verdict.kind === 'stale' ? verdict.kind : 'unknown';
      return { record, dspatchRunId, standing, standingHeadline: verdict.headline };
    });
    return { commands, currentSnapshotId, checkedAtUtc };
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

  /**
   * A save failure the window should state: the current conversation's, or else that
   * of another held conversation, named. `null` when every held conversation's latest
   * save succeeded.
   */
  saveError(): string | null {
    const current = this.conversationId === null ? null : this.saveErrors.get(this.conversationId);
    if (current !== undefined && current !== null) {
      return current.error;
    }
    const [other] = this.otherSaveErrors();
    return other === undefined
      ? null
      : `Conversation ${other.conversationId}: ${other.error}`;
  }

  private otherSaveErrors(): {
    readonly conversationId: string;
    readonly filePath: string | null;
    readonly error: string;
    readonly readOnly: boolean;
  }[] {
    const store = this.options.conversations?.() ?? null;
    return [...this.saveErrors]
      .filter(([conversationId]) => conversationId !== this.conversationId)
      .map(([conversationId, failure]) => ({
        conversationId,
        filePath: store === null ? null : store.filePathFor(conversationId),
        error: failure.error,
        readOnly: failure.readOnly,
      }));
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
      error: conversationId === null ? null : (this.saveErrors.get(conversationId)?.error ?? null),
      readOnly:
        conversationId !== null && (this.saveErrors.get(conversationId)?.readOnly ?? false),
      otherConversations: this.otherSaveErrors(),
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

    // A conversation this window already holds is taken from memory, which the file
    // is a copy of: reading it again would raise its unknown outcomes a second time
    // and, before WS-1, collided with its own attempt IDs and said they "could not be
    // read back".
    const inMemory = this.held.get(conversationId) ?? null;
    let held: HeldConversation;
    let reconciliations: readonly AttemptReconciliation[];
    let reconciliationNote: string;
    let adoptNote: string | null = null;
    if (inMemory !== null) {
      held = inMemory;
      reconciliations = heldReconciliations(held.ledger);
      reconciliationNote = describeHeldReconciliation(reconciliations);
    } else {
      const adopted = this.adoptSaved(conversation);
      held = adopted.held;
      reconciliations = adopted.reconciliations;
      reconciliationNote = describeReconciliation(reconciliations);
      adoptNote = adopted.note;
    }
    this.conversationId = conversationId;
    const projectPath = held.projectPath;
    const projectExists = directoryExists(projectPath);
    // One hash of the project, shared by the result and the diff below, so both
    // statements are about the same observed content rather than two readings.
    const currentSnapshotId = projectExists ? safeSnapshotIdOf(projectPath) : null;

    const testResult = this.describeRestoredTest(held.lastTest, currentSnapshotId);
    const restoredDiff = describeRestoredDiff(held.reviewedDiff, currentSnapshotId);
    const runState = this.getRunState();
    const messages = this.mergedMessages(conversationId);
    const record = this.buildConversation(conversationId) ?? conversation;

    this.options.log(
      `resumed conversation ${conversationId}${inMemory === null ? '' : ' (held in this window)'}: ` +
        `messages=${String(messages.length)} attempts=${String(
          held.ledger.all().length,
        )} reconciled=${String(reconciliations.length)} project=${projectPath} snapshot=${
          currentSnapshotId ?? 'unreadable'
        }`,
    );

    return {
      conversationId,
      filePath: result.filePath,
      formatVersion: conversation.formatVersion,
      createdAtUtc: held.createdAtUtc,
      savedAtUtc: conversation.savedAtUtc,
      project: {
        path: projectPath,
        exists: projectExists,
        gitAtSave: record.project.git,
      },
      session: record.session,
      messages,
      attempts: held.ledger.all(),
      reconciliation: {
        attempts: reconciliations,
        needsAcknowledgement: runState.needsAcknowledgement,
        note: reconciliationNote,
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
      statement: restoreStatement(
        record,
        projectExists,
        restoredDiff,
        testResult,
        inMemory === null ? 'file' : 'window',
      ),
      readOnly: result.readOnly,
      newerFormat: result.newerFormatVersion !== null,
      error: joinErrors(result.error, adoptNote),
    };
  }

  /**
   * Hold a saved conversation in this window, reconciling its open attempts.
   *
   * Into a ledger of its own (WS-1). Until then every conversation shared one
   * window-wide ledger, so a conversation read back after another had been worked in
   * could not adopt attempts whose numbers were already taken, and saving it then
   * filed the other conversation's attempts under those numbers. A ledger per
   * conversation holds exactly what the file holds; the shared counter keeps new
   * numbers new. It does not make the conversation current; the caller does that.
   */
  private adoptSaved(conversation: StoredConversation): {
    readonly held: HeldConversation;
    readonly reconciliations: readonly AttemptReconciliation[];
    /** What could not be adopted, in words, or `null` when everything was. */
    readonly note: string | null;
  } {
    const ledger = new AttemptLedger(undefined, this.attemptSequence, conversation.conversationId);
    const outcome = ledger.restore(conversation.attempts);
    const held: HeldConversation = {
      conversationId: conversation.conversationId,
      projectPath: conversation.project.path,
      createdAtUtc: conversation.createdAtUtc,
      ledger,
      carriedMessages: conversation.messages,
      testRuns: [...conversation.testRuns],
      lastTest: pickLastTest(conversation),
      reviewedDiff: conversation.reviewedDiff,
      carriedBaseline: conversation.baseline,
      storedBaseline: null,
      project: conversation.project,
      session: conversation.session,
      // The body on disk was written by an earlier process, so this one has nothing
      // to compare against and must not assume its first save is redundant.
      lastSavedDigest: null,
    };
    this.held.set(held.conversationId, held);
    return {
      held,
      reconciliations: outcome.reconciliations,
      note:
        outcome.skippedAttemptIds.length === 0
          ? null
          : `${String(outcome.skippedAttemptIds.length)} attempt ID${
              outcome.skippedAttemptIds.length === 1 ? '' : 's'
            } (${outcome.skippedAttemptIds.join(', ')}) appear more than once in this ` +
            'file. DSpatch writes each ID once, so the file has been edited or damaged ' +
            'outside it. The first record of each was read back; DSpatch will not merge ' +
            'two records under one ID, and the next save writes only the record it read. ' +
            'Export the file first if the other records matter.',
    };
  }

  /** A conversation new to this window, with nothing carried in. */
  private holdNew(conversationId: string, projectPath: string): HeldConversation {
    const held: HeldConversation = {
      conversationId,
      projectPath,
      createdAtUtc: nowIso(),
      ledger: new AttemptLedger(undefined, this.attemptSequence, conversationId),
      carriedMessages: [],
      testRuns: [],
      lastTest: null,
      reviewedDiff: null,
      carriedBaseline: null,
      storedBaseline: null,
      project: null,
      session: null,
      lastSavedDigest: null,
    };
    this.held.set(conversationId, held);
    return held;
  }

  /**
   * Hold the saved conversations that can block work in this working copy.
   *
   * The repeat block belongs to the working copy and survives a restart (WS-1 #11),
   * so a new app run that opens a folder inside another conversation's project must
   * know about that conversation's unresolved attempts without that conversation
   * being opened first. Only conversations whose file reports something unresolved
   * and whose project overlaps this one are read; they are held, not made current,
   * and nothing is written to their files unless an acknowledgement changes them.
   *
   * The store is listed once per app run, at the first open whose listing succeeds:
   * listing reads every file, and after that every new unresolved attempt is made in a
   * conversation this window already holds. A listing that fails — the directory
   * itself cannot be read — is not taken as "nothing saved": it is tried again at the
   * next open (review 007 N3), and nothing here throws.
   *
   * The same listing raises the window's attempt counter past the highest attempt
   * number in any readable conversation file (review 004 S1). When it succeeds at the
   * first open, as it does unless the directory cannot be read, it happens before the
   * session exists, and an attempt can only be made in an open session, so no attempt
   * of this run is numbered before it.
   */
  private holdBlockersFromDisk(workspacePath: string, store: ConversationStore | null): void {
    if (store === null) {
      return;
    }
    if (this.unresolvedOnDisk === null) {
      const { listing, attemptIds } = store.listWithAttemptIds();
      if (listing.error !== null) {
        this.options.log(
          `[conversation] the saved conversations could not be listed, so attempts ` +
            `saved in them are not counted yet; listing again at the next open: ` +
            listing.error,
        );
        return;
      }
      this.attemptSequence.last = attemptIds.reduce(
        (highest, attemptId) => Math.max(highest, attemptOrdinal(attemptId)),
        this.attemptSequence.last,
      );
      this.unresolvedOnDisk = listing.entries
        .filter((entry) => entry.unresolvedAttemptCount > 0 && entry.error === null)
        .map((entry) => ({ conversationId: entry.conversationId, projectPath: entry.projectPath }));
    }
    for (const entry of this.unresolvedOnDisk) {
      if (
        this.held.has(entry.conversationId) ||
        !workingCopiesOverlap(entry.projectPath, workspacePath)
      ) {
        continue;
      }
      const conversation = store.read(entry.conversationId).conversation;
      if (conversation === null) {
        continue;
      }
      const adopted = this.adoptSaved(conversation);
      this.options.log(
        `holding ${String(adopted.reconciliations.length)} unresolved attempt(s) of ` +
          `${entry.conversationId} (${entry.projectPath}), which shares this working copy`,
      );
    }
  }

  /**
   * Decide which conversation the opening session's work belongs to.
   *
   * A project that has been worked on before continues its own conversation, so
   * opening the project directly cannot lose the history or quietly skip an
   * unresolved attempt that pressing *Continue* would have shown. A conversation
   * this window already holds — because work was done in it, or because it was read
   * back — is taken as it is in memory: the file is a copy of that, and reading it
   * again would raise the same unknown outcomes a second time. Its own record comes
   * with it, and nothing of the conversation that was open before (WS-1 #7).
   */
  private adoptConversationFor(
    workspacePath: string,
    baseline: WorkspaceSnapshot,
    /**
     * DSP-149: the conversation the host chose — a workspace's last chat, the carried
     * one, or `null` for a new one. Absent keeps the earlier rule.
     */
    explicit?: string | null,
  ): string {
    const store = this.options.conversations?.() ?? null;
    const current = this.current();
    const known =
      explicit !== undefined
        ? explicit
        : current !== null && samePath(current.projectPath, workspacePath)
          ? current.conversationId
          : (this.options.conversationForProject?.(workspacePath) ?? null);
    const inMemory = known === null ? null : (this.held.get(known) ?? null);
    // The whole read is kept, not just the conversation in it: a file that exists and
    // could not be parsed is the one case where the window must say so rather than
    // draw the empty thread that a genuinely new conversation gets.
    const read =
      known === null || inMemory !== null || store === null ? null : store.read(known);
    const saved = read?.conversation ?? null;

    let held: HeldConversation;
    if (inMemory !== null) {
      held = inMemory;
      held.projectPath = workspacePath;
    } else if (saved !== null && samePath(saved.project.path, workspacePath)) {
      const adopted = this.adoptSaved(saved);
      held = adopted.held;
      if (adopted.note !== null) {
        this.options.log(`[conversation] ${adopted.note}`);
      }
    } else {
      held = this.holdNew(known ?? newConversationId(), workspacePath);
    }
    this.conversationId = held.conversationId;
    // The conversation's own last result becomes this session's, so the freshness rule
    // applies it to the code that is on disk now. That is the point: a restart must
    // not be a way for an old pass to look like a current one, and a switch must not
    // be a way for another conversation's result to stand beside this code.
    this.lastTest = held.lastTest;
    // Once per session, from the snapshot the session was actually started against.
    // Rebuilding it later would silently redefine what "since the session started"
    // means, which is the one thing a baseline may not do.
    held.storedBaseline = store === null ? null : this.buildStoredBaseline(baseline, store);
    if (held.storedBaseline !== null) {
      // The save prefers the new baseline, so the file's copy is no longer read.
      held.carriedBaseline = null;
    }
    this.holdBlockersFromDisk(workspacePath, store);
    this.openedHistory = this.historyFor(held.conversationId, store, read);
    return held.conversationId;
  }

  /** The conversation on screen, as held. */
  private current(): HeldConversation | null {
    return this.conversationId === null ? null : (this.held.get(this.conversationId) ?? null);
  }

  private currentLedger(): AttemptLedger {
    return this.current()?.ledger ?? this.noConversationLedger;
  }

  /**
   * The other held conversations whose project is this working copy or overlaps it.
   *
   * Their unresolved attempts block the same kind of work here (WS-1 #11), and only
   * here: a conversation in an unrelated folder is never in this list.
   */
  private conversationsSharingWorkingCopy(): HeldConversation[] {
    const here = this.session?.workspacePath ?? this.current()?.projectPath ?? null;
    if (here === null) {
      return [];
    }
    return [...this.held.values()].filter(
      (held) =>
        held.conversationId !== this.conversationId &&
        workingCopiesOverlap(held.projectPath, here),
    );
  }

  /**
   * Record acknowledgements in this working copy, for the kind of work being gated
   * only, and save any other file they changed.
   */
  private acknowledgeInWorkingCopy(
    ledger: AttemptLedger,
    sharing: readonly HeldConversation[],
    kind: AttemptKind,
    acknowledgements: readonly AttemptAcknowledgement[],
    note: string,
  ): void {
    const touched = AttemptLedger.acknowledgeAcross(
      ledger,
      sharing.map((held) => held.ledger),
      kind,
      acknowledgements,
      note,
    );
    for (const held of sharing) {
      if (touched.includes(held.ledger)) {
        this.saveConversation(held.conversationId);
      }
    }
  }

  /**
   * A conversation's messages: what its file held, then what this window did in it.
   *
   * The one rule for every reader — what the window is given, what is saved and what
   * a recap is built from — so the three cannot disagree (WS-1 #10).
   */
  private mergedMessages(conversationId: string): StoredMessage[] {
    return mergeConversationMessages(
      this.held.get(conversationId)?.carriedMessages ?? [],
      this.turns
        .filter((turn) => turn.conversationId === conversationId)
        .map((turn) => toStoredMessage(turn)),
    );
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
    return {
      conversationId,
      messages: this.mergedMessages(conversationId),
      filePath: store?.filePathFor(conversationId) ?? null,
      savedAtUtc: read?.conversation?.savedAtUtc ?? null,
      // A file that could not be read is the one case where an empty thread is not
      // the same as an empty conversation, so it is said rather than drawn as none.
      error: read?.error ?? null,
    };
  }

  /** Save the conversation a ledger belongs to, whether or not it is on screen. */
  private saveLedgerOwner(ledger: AttemptLedger): void {
    if (ledger.owner !== null && this.held.get(ledger.owner)?.ledger === ledger) {
      this.saveConversation(ledger.owner);
    }
  }

  /**
   * Save a conversation: the current one unless another is named.
   *
   * Called after everything that changes what happened: a project opening, a run
   * starting or ending, a command starting or ending, a diff being produced, and a
   * session closing. A run *starting* matters as much as one ending — an attempt that
   * was never written down as `running` cannot be reconciled as unknown after a
   * restart, and that reconciliation is the point of AC#3. Another conversation is
   * named when something of its own changes while it is not on screen: a command it
   * started ending late, a confirmation timer settling its attempt, or an
   * acknowledgement of its attempt.
   *
   * Every save is built from that conversation's own held record, so no save can write
   * one conversation's records into another's file (WS-1 #12).
   *
   * Failures are recorded per conversation and swallowed. The work on screen is real
   * whether or not it reached the disk, and the window says so, naming the
   * conversation, through {@link conversationSaveStatus}; closing the window tries
   * again ({@link dispose}).
   */
  private saveConversation(conversationId: string | null = this.conversationId): void {
    const store = this.options.conversations?.() ?? null;
    if (store === null || conversationId === null) {
      return;
    }
    const held = this.held.get(conversationId) ?? null;
    const record = held === null ? null : this.buildConversation(conversationId);
    if (held === null || record === null) {
      return;
    }
    // A save is attempted on many events and most of them change nothing that is
    // written down. Comparing bodies keeps the disk quiet without maintaining a
    // second idea of what has changed. `savedAtUtc` is excluded from the comparison
    // for exactly that reason: it changes on every call by construction.
    const digest = createHash('sha256')
      .update(JSON.stringify({ ...record, savedAtUtc: '' }))
      .digest('hex');
    if (digest === held.lastSavedDigest) {
      return;
    }
    const written = store.write(record);
    // Kept for this conversation only: a later save of another one says nothing about
    // whether this one reached the disk.
    if (written.error === null) {
      this.saveErrors.delete(conversationId);
    } else {
      this.saveErrors.set(conversationId, {
        error: written.error,
        readOnly: written.readOnly === true,
      });
    }
    if (written.error === null) {
      held.lastSavedDigest = digest;
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
    const held = this.held.get(conversationId) ?? null;
    if (held === null) {
      return null;
    }
    const session =
      this.session !== null && this.conversationId === conversationId ? this.session : null;

    // While no provider session is open (DSP-121) the session on screen is the
    // recorded one, and the file keeps it exactly as it was — every field, including
    // `createdAt` — until the user's choice opens something. Writing it from
    // `this.session` here would be harmless today and would silently become the old
    // overwrite the moment a field drifted, so it is not written from there at all.
    const storedSession: StoredSession | null =
      session === null || !this.continuity.providerSessionOpen
        ? (held.session ?? this.savedSessionFor(conversationId))
        : {
            dspatchSessionId: session.dspatchSessionId,
            providerSessionId: session.providerSessionId,
            modelRequested: session.modelRequested,
            createdAt: session.createdAt,
            toolPolicy: session.toolPolicy,
            // Written explicitly for every open session, Cursor's included (DSP-122).
            provider: this.sessionProvider,
            origin: session.origin,
            workspaceOrigin: session.workspaceOrigin,
            suggestedTestCommand: session.suggestedTestCommand,
            suggestedTestCwd: session.suggestedTestCwd,
            testCommandNote: session.testCommandNote,
          };
    const project =
      session === null
        ? (held.project ?? this.savedProjectFor(conversationId))
        : { path: session.workspacePath, git: session.git };
    if (storedSession === null || project === null) {
      // Nothing worth saving yet. A conversation with no project is not a
      // conversation, and writing a blank one would put a row in the chooser that
      // opens to nothing.
      return null;
    }
    held.session = storedSession;
    held.project = project;

    return {
      // The version is the content's. A session carried through unchanged from a
      // version 1 file has no `provider`, and a file whose session lacks it is a
      // version 1 file by definition, so it is not stamped 2 until a session with
      // the field is written into it (an open provider session, above).
      formatVersion: storedSession.provider === undefined ? 1 : CONVERSATION_FORMAT_VERSION,
      conversationId,
      createdAtUtc: held.createdAtUtc,
      savedAtUtc: nowIso(),
      // Filled in by the store, which is the only place that knows the build.
      appVersion: 'unknown',
      project,
      session: storedSession,
      messages: this.mergedMessages(conversationId),
      attempts: held.ledger.persistable(),
      testRuns: held.testRuns,
      lastTestAttemptId: held.lastTest?.attemptId ?? null,
      // Rebuilt by each session from its own snapshot, and the file's otherwise:
      // never another conversation's.
      baseline: held.storedBaseline ?? held.carriedBaseline,
      reviewedDiff: held.reviewedDiff,
    };
  }

  /** The project record a conversation's file holds. */
  private savedProjectFor(conversationId: string): StoredConversation['project'] | null {
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
    return AttemptLedger.reportAcross(
      this.currentLedger(),
      this.conversationsSharingWorkingCopy().map((held) => held.ledger),
    );
  }

  /** The attempts, for the run record. */
  attempts(): readonly AttemptInfo[] {
    return this.currentLedger().all();
  }

  /** The snapshot identity of the working copy now, or `null` if unreadable. */
  private safeSnapshotId(): string | null {
    const session = this.session;
    if (session === null) {
      return null;
    }
    try {
      const primary = snapshotWorkspace(session.workspacePath).snapshotId;
      const others = this.workspaceFolders.slice(1);
      if (others.length === 0) {
        return primary;
      }
      // DSP-149: one identity for the code in every folder, so a command's result counts
      // only for the code it ran against in all of them, not only in the first.
      const parts = [primary, ...others.map((folder) => `${folder}=${snapshotWorkspace(folder).snapshotId}`)];
      return `roots-${createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)}`;
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
    const otherFolders = this.otherFolderChanges();
    const full: WorkspaceReport = otherFolders.length === 0 ? report : { ...report, otherFolders };
    const held = this.current();
    if (held !== null) {
      held.reviewedDiff = full;
    }
    this.saveConversation();
    return full;
  }

  /**
   * DSP-149: every non-primary folder's changes since its own baseline, by the same
   * comparison and diff rules as the primary's. A folder that cannot be read now is
   * reported with no changes and a note saying so, never silently left out.
   */
  private otherFolderChanges(): FolderChangeReport[] {
    const reports: FolderChangeReport[] = [];
    for (const [folder, baseline] of this.otherBaselines) {
      let after: WorkspaceSnapshot;
      try {
        after = snapshotWorkspace(folder);
      } catch (error) {
        reports.push({
          folderPath: folder,
          baselineSnapshotId: baseline.snapshotId,
          baselineTakenAtUtc: baseline.snapshot.takenAtUtc,
          observedSnapshotId: '',
          changed: [],
          added: [],
          removed: [],
          unchangedCount: 0,
          truncated: true,
          coverageNote: `This folder could not be read just now, so its changes are unknown: ${describeError(error)}`,
        });
        continue;
      }
      const diff = diffSnapshots(baseline.snapshot, after.snapshot);
      const beforeLabel = `${baseline.snapshotId} (baseline, ${baseline.snapshot.takenAtUtc})`;
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
          before: this.baselineSide(relPath, beforeSha256, baseline),
          after: this.onDiskSide(folder, relPath, afterSha256, after.snapshotId),
          beforeLabel,
          afterLabel,
        });
        return {
          relPath,
          beforeSha256,
          afterSha256,
          beforeBytes,
          afterBytes,
          preexistingDirty: false,
          unifiedDiff: text.unifiedDiff,
          diffLimitation: text.limitation,
          addedLines: text.addedLines,
          removedLines: text.removedLines,
          diffTruncated: text.truncated,
        };
      };
      reports.push({
        folderPath: folder,
        baselineSnapshotId: baseline.snapshotId,
        baselineTakenAtUtc: baseline.snapshot.takenAtUtc,
        observedSnapshotId: after.snapshotId,
        changed: diff.changed.map((file) =>
          describe(file.relPath, file.beforeSha256, file.afterSha256, file.beforeBytes, file.afterBytes),
        ),
        added: diff.added.map((file) => describe(file.relPath, null, file.sha256, null, file.bytes)),
        removed: diff.removed.map((file) => describe(file.relPath, file.sha256, null, file.bytes, null)),
        unchangedCount: diff.unchangedCount,
        truncated: baseline.truncated || after.truncated,
        coverageNote:
          `${this.coverageNote(baseline)} Counted from when this folder joined the session ` +
          '(the session opening, or the folder being added); a restart counts afresh.',
      });
    }
    return reports;
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
  private baselineSide(
    relPath: string,
    beforeSha256: string | null,
    baseline: WorkspaceSnapshot | null = this.baseline,
  ): DiffSide {
    if (beforeSha256 === null) {
      return { kind: 'absent' };
    }
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
      attempts: this.currentLedger().all(),
      nodeRunner: this.runner,
      workspaceChangesAtEnd: this.session === null ? null : this.getWorkspaceChanges(),
      // `null` as well while no provider session is open (DSP-121): the adapter
      // instance then holds no session, and the Cursor adapter throws for an ID it
      // does not hold. Unknown, not zero, and not an exception in the report path.
      providerMessageTypes:
        this.adapter === null || this.session === null || !this.continuity.providerSessionOpen
          ? null
          : this.adapter.providerMessageTypes(this.session.dspatchSessionId),
      streamPumpFinished:
        this.adapter === null || this.session === null || !this.continuity.providerSessionOpen
          ? null
          : this.adapter.streamPumpFinished(this.session.dspatchSessionId),
      modelReported:
        this.adapter === null || this.session === null || !this.continuity.providerSessionOpen
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
  private stopWorkspaceTest(killedByDspatch: boolean): void {
    const run = this.activeCommand;
    this.activeCommand = null;
    if (run === null) return;
    const child = run.child;
    if (child.pid === undefined) return;
    // On Windows as before: a shell that has exited is not stopped again. On
    // POSIX `sh` can have exited while what it started still runs in its group
    // and holds the pipes (`close` has not come), which is the case the group
    // stop exists for, so an exit code alone does not end the stop there.
    if (process.platform === 'win32' && child.exitCode !== null) return;
    if (killedByDspatch) {
      run.killedByDspatch = true;
    }

    const { attemptId, ledger } = run;
    ledger.markCancelRequested(
      attemptId,
      `DSpatch asked the process tree under pid ${String(child.pid)} to die. Until ` +
        'the process closes, whether it is gone is not established — and a ' +
        'surviving child keeps holding the working directory.',
    );
    // A kill that is never confirmed must not sit as "cancellation requested"
    // forever: an unkillable process is exactly the case worth showing.
    const timer = setTimeout(() => {
      if (ledger.get(attemptId)?.state === 'cancel-requested') {
        ledger.markOutcomeUnknown(
          attemptId,
          'The process was asked to die and never reported closing, so whether ' +
            'it is gone is unknown. It may still be holding the working ' +
            'directory open.',
        );
        // Typically after a switch, with the conversation off screen (verifier 001, A5).
        this.saveLedgerOwner(ledger);
      }
    }, this.cancelConfirmMs);
    timer.unref?.();

    this.options.log(`stopping test runner pid=${String(child.pid)}`);
    try {
      // `taskkill /T /F` on Windows as before; the process group elsewhere.
      stopChatCommandTree(
        { pid: child.pid, kill: (signal) => child.kill(signal) },
        {
          platform: process.platform,
          spawnSync,
          log: (message) => {
            this.options.log(message);
          },
        },
      );
    } catch (err) {
      this.options.log(`could not stop the test runner: ${String(err)}`);
    }
  }

  async dispose(): Promise<void> {
    await this.closeSession();
    this.saveHeldAtClose();
    const adapter = this.adapter;
    this.adapter = null;
    this.adapterProvider = null;
    if (adapter !== null) {
      await adapter.dispose();
    }
  }

  /**
   * At window close, save every held conversation that differs from what was last
   * saved, not only the one on screen (WS-1 follow-up, verifier 001 A1/A2).
   *
   * A conversation off screen changes when a command it started ends late or a timer
   * settles its attempt, and its own save at that moment can fail; this is the retry
   * before the window's memory of it is gone. The digest comparison in
   * {@link saveConversation} skips any whose body is unchanged.
   *
   * A conversation this run has neither saved nor failed to save is skipped: it was
   * only read, as a blocker for a shared working copy, and nothing of it changed.
   * Rewriting it would contradict {@link holdBlockersFromDisk}'s promise that nothing
   * is written to such a file unless an acknowledgement changes it.
   *
   * Each failure is logged for its conversation and does not stop the others.
   */
  private saveHeldAtClose(): void {
    for (const [conversationId, held] of this.held) {
      if (held.lastSavedDigest === null && !this.saveErrors.has(conversationId)) {
        continue;
      }
      try {
        this.saveConversation(conversationId);
      } catch (error) {
        this.options.log(
          `[conversation] ${conversationId} could not be saved at close: ${describeError(error)}`,
        );
      }
      const failed = this.saveErrors.get(conversationId);
      if (failed !== undefined) {
        this.options.log(
          `[conversation] ${conversationId} is not on disk as last held; its last ` +
            `successful save is what the next start reads: ${failed.error}`,
        );
      }
    }
  }

  /**
   * DSP-149: the tool scope and app tools a session over this origin gets. A
   * conversation with no workspace has only DSpatch's app tools; a workspace has every
   * folder and the app tools as well; a generated sample has neither app tools nor more
   * than its one folder.
   */
  private sessionScope(origin: SessionOrigin): Pick<SessionConfig, 'toolScope' | 'appTools' | 'workspacePaths'> {
    const appTools = origin === 'generated-sample' ? [] : (this.options.appTools?.() ?? []);
    return {
      toolScope: origin === 'no-workspace' ? 'conversation' : 'workspace',
      ...(appTools.length === 0 ? {} : { appTools }),
      ...(this.workspaceFolders.length > 1 ? { workspacePaths: [...this.workspaceFolders] } : {}),
    };
  }

  /** DSP-149: the policy text, plus DSpatch's own tools when the session is given them. */
  private policyTextWithAppTools(text: string, origin: SessionOrigin): string {
    const scope = this.sessionScope(origin);
    const names = (scope.appTools ?? []).map((tool) => tool.name);
    const base = scope.toolScope === 'conversation' ? 'No built-in tools (a conversation with no workspace yet).' : text;
    return names.length === 0
      ? base
      : `${base} Plus DSpatch's own workspace tools (${names.join(', ')}), given through the SDK's tool mechanism and run in the host.`;
  }

  /** DSP-149: what the session details show of the folders and tools given to the agent. */
  private contextExtras(origin: SessionOrigin): Pick<SessionContextInfo, 'otherFoldersSent' | 'dspatchToolsSent'> {
    const scope = this.sessionScope(origin);
    return {
      ...(scope.workspacePaths === undefined ? {} : { otherFoldersSent: scope.workspacePaths.slice(1) }),
      ...(scope.appTools === undefined
        ? {}
        : { dspatchToolsSent: scope.appTools.map((tool) => ({ name: tool.name, description: tool.description })) }),
    };
  }

  /** Baselines for every non-primary folder that has none yet; dropped ones forgotten. */
  private takeOtherBaselines(): void {
    const others = this.workspaceFolders.slice(1);
    for (const kept of [...this.otherBaselines.keys()]) {
      if (!others.some((folder) => samePath(folder, kept))) {
        this.otherBaselines.delete(kept);
      }
    }
    for (const folder of others) {
      if (![...this.otherBaselines.keys()].some((kept) => samePath(kept, folder))) {
        this.otherBaselines.set(
          folder,
          snapshotWorkspace(folder, DEFAULT_SNAPSHOT_LIMITS, DEFAULT_RETENTION_LIMITS),
        );
      }
    }
  }

  /** The open session's folders, the primary first; empty with no session. */
  sessionFolders(): readonly string[] {
    return this.session === null ? [] : this.workspaceFolders;
  }

  /**
   * DSP-149: the workspace's folders changed (a folder was added or removed). The primary
   * is not changed here: it is the working directory and the provider session's resume
   * key. The adapter is told, and applies it from the next message by its SDK's own
   * means; a new folder gets its own baseline now, so its changes are counted from here.
   */
  setWorkingFolders(folders: readonly string[]): void {
    const session = this.session;
    if (session === null || session.origin === 'no-workspace') {
      return;
    }
    const next: string[] = [session.workspacePath];
    for (const folder of folders) {
      const resolved = path.resolve(folder);
      if (!next.some((kept) => samePath(kept, resolved))) {
        next.push(resolved);
      }
    }
    this.workspaceFolders = next;
    this.takeOtherBaselines();
    if (this.continuity.providerSessionOpen && this.adapter !== null) {
      this.adapter.setWorkspaceRoots?.(session.dspatchSessionId, next);
    }
    this.options.log(`working folders now: ${next.join(', ')}`);
  }

  /** Whether the session on screen is a conversation without a workspace that has messages. */
  looseConversationWithMessages(): string | null {
    const session = this.session;
    if (session === null || session.origin !== 'no-workspace') {
      return null;
    }
    return this.mergedMessages(session.conversationId).length > 0 ? session.conversationId : null;
  }

  /**
   * DSP-149: the same checks a folder gets when opened, for one named without opening it
   * (a workspace being created from the chat). Throws with the reason.
   */
  checkFolder(candidate: string): string {
    return this.validateProjectFolder(candidate);
  }

  private async closeSession(): Promise<void> {
    // DSpatch stops the command because it is closing the session, so its exit is
    // not a verdict about the code (WS-1 #8); the result stays with its conversation.
    this.stopWorkspaceTest(true);
    // Closing a session is DSpatch stopping listening, which is a change in what
    // it knows rather than an ending. An unresolved turn is carried over as
    // unknown so the next session's first message has to reckon with it instead of
    // starting beside work that may still be going in a different agent.
    const ledger = this.currentLedger();
    for (const attempt of ledger.unresolved('agent-turn')) {
      if (attempt.state === 'waiting' || attempt.state === 'running') {
        ledger.markOutcomeUnknown(
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
    // DSP-146: no more ends will be heard for this session's commands, so their Run
    // slots are given back rather than held until DSpatch restarts.
    for (const started of this.agentCommandStarts.values()) {
      started.release();
    }
    this.agentCommandStarts.clear();
    this.session = null;
    this.baseline = null;
    this.dirtyAtStart = new Set<string>();
    this.dirtyFilesAtStart = [];
    this.currentTurn = null;
    // The result belonged to the previous working copy and its snapshots. Kept
    // across a session change it would be a green tick beside unrelated code.
    this.lastTest = null;
    // A recap is owed to one session. Carrying it into the next one would put the
    // record in front of a model that may well already have it.
    this.pendingResendContext = null;
    this.pendingResentContext = null;
    this.continuity = FIRST_SESSION_CONTINUITY;
    // A new session on the same adapter instance would collide on the derived
    // provider agent ID, so the adapter is replaced with the session.
    const adapter = this.adapter;
    this.adapter = null;
    this.adapterProvider = null;
    if (adapter !== null) {
      await adapter.dispose();
    }
  }

  /**
   * The cached adapter for this provider, created when there is none (synchronous,
   * for the identity and capability readings). An adapter cached for another
   * provider is not reused: it is detached and disposed in the background, and one
   * for this provider takes its place (review B2). Opening a session goes through
   * {@link adapterFor}, which waits for that disposal.
   */
  private ensureAdapter(provider: StoredSessionProvider): ChatAdapter {
    if (this.adapter !== null && this.adapterProvider !== provider) {
      const stale = this.adapter;
      this.adapter = null;
      this.adapterProvider = null;
      void stale.dispose().catch((error: unknown) => {
        this.options.log(`could not dispose the ${stale.id} adapter: ${describeError(error)}`);
      });
    }
    if (this.adapter === null) {
      this.adapter = this.createAdapterFor(provider);
      this.adapterProvider = provider;
    }
    return this.adapter;
  }

  /** {@link ensureAdapter}, waiting for a replaced adapter's disposal first. */
  private async adapterFor(provider: StoredSessionProvider): Promise<ChatAdapter> {
    if (this.adapter !== null && this.adapterProvider !== provider) {
      const stale = this.adapter;
      this.adapter = null;
      this.adapterProvider = null;
      await stale.dispose();
    }
    return this.ensureAdapter(provider);
  }

  /**
   * A new adapter for this provider. Production passes a factory (main.ts); without
   * one, Cursor's real adapter, and no Claude adapter at all: this service holds no
   * authorization to build one with.
   */
  private createAdapterFor(provider: StoredSessionProvider): ChatAdapter {
    const created = this.options.createAdapter?.(provider);
    if (created !== undefined) {
      return created;
    }
    if (provider === 'claude') {
      throw new Error('Claude is not enabled for this launch.');
    }
    return new CursorSdkAdapter({ toolPolicy: 'provider-default' });
  }

  private requireSession(): {
    adapter: ChatAdapter;
    session: ChatSessionInfo;
  } {
    const adapter = this.adapter;
    const session = this.session;
    if (session !== null && !this.continuity.providerSessionOpen) {
      // DSP-136: with no agent chosen there is no adapter either; the same refusal.
      throw new Error(
        `No provider session is open for this conversation: ${this.noProviderSessionHeadline()}. ` +
          choicesInstruction(this.continuity.choices, this.continuity.agentNeeded === true),
      );
    }
    if (adapter === null || session === null) {
      throw new Error('No session is open. Start one first.');
    }
    // The guard of DSP-121: a session info over a recorded-but-not-open provider
    // session refuses everything that would reach the adapter, so that opening the
    // history or seeing the failure can never start a model turn. Reading the history
    // is this refusal staying in force. The window's composer already holds a message
    // back in this state, so this is the back-stop; it names only the choices offered,
    // and its prefix is what `recovery.ts` recognises.
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
        const ledger = this.currentLedger();
        this.attemptByRunId.set(event.dspatchRunId, { ledger, attemptId });
        ledger.markRunning(
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
        commands: [],
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
      // DSP-149: after this event's own handling, so the host sees the turn as ended.
      setTimeout(() => {
        this.options.onTurnSettled?.();
      }, 0);
      const owner = this.attemptByRunId.get(event.dspatchRunId);
      if (owner !== undefined) {
        const { ledger, attemptId } = owner;
        const detail =
          `Run ${event.dspatchRunId} reported status "${event.status}" at ${event.at}` +
          `${event.error === undefined ? '' : `: ${event.error.message}`}.`;
        if (event.status === 'cancelled' && event.end === 'unconfirmed') {
          // DSP-116: the adapter ended the run without evidence that its local
          // work stopped. Reported as ended so nothing waits forever, but not a stop.
          ledger.markOutcomeUnknown(
            attemptId,
            `${detail} The adapter reported the end as unconfirmed: it stopped ` +
              'waiting without evidence that its local work ended (such as its ' +
              'process having been seen to exit), so that work may still be going. ' +
              'It is not being treated as stopped; the adapter refuses a new turn in ' +
              'this session until the end is confirmed, and whether the provider kept ' +
              'working on requests already sent is unknown.',
          );
        } else if (
          event.status === 'cancelled' &&
          (event.end === 'stopped' || event.end === 'forced')
        ) {
          ledger.markStopped(
            attemptId,
            `${detail} This is a confirmed local end (${event.end}): the adapter ` +
              (event.end === 'forced'
                ? 'had to escalate (abort, and possibly kill its local process) and '
                : '') +
              'has evidence that its local work ended, such as its process having ' +
              'been seen to exit. Whether the provider kept working on requests ' +
              'already sent is unknown.',
            event.end,
          );
        } else if (event.status === 'cancelled') {
          ledger.markStopped(
            attemptId,
            `${detail} This is a confirmed end: the provider reported it, rather ` +
              'than DSpatch inferring it from silence.',
          );
        } else if (event.status === 'finished') {
          ledger.markCompleted(attemptId, detail);
        } else {
          ledger.markFailed(attemptId, detail);
        }
      }
    }

    if (event.type === 'command.started') {
      // DSP-146: the adapter raises this from inside the runtime's PreToolUse hook, which
      // the runtime awaits before the command runs, so this snapshot is the code the
      // command starts on. The Run slot is held until its end is recorded.
      const workspacePath = this.session?.workspacePath ?? null;
      const slots = this.options.commandSlots ?? WORKSPACE_COMMAND_SLOTS;
      const claim =
        workspacePath === null ? null : slots.claim(workspacePath, { by: 'agent', line: event.line });
      this.agentCommandStarts.set(event.commandId, {
        beforeSnapshotId: this.safeSnapshotId(),
        workspacePath,
        release: () => {
          if (claim?.ok === true) {
            claim.release();
          }
        },
      });
    }

    if (event.type === 'command.finished') {
      // DSP-145: kept on the turn whose run it belongs to, by run ID, even if a newer
      // turn is on screen by now, and saved at once: a command's record is evidence
      // the next window must still have if this one is closed mid-turn.
      const started = this.agentCommandStarts.get(event.command.commandId);
      this.agentCommandStarts.delete(event.command.commandId);
      started?.release();
      // DSP-146: a provider-reported record carries no snapshots of its own; DSpatch's
      // are added here, the after-run one taken as the end is seen (from inside the
      // runtime's PostToolUse hook, before the agent goes on). `null` is not observed.
      const record: AgentCommandRecord =
        event.command.testedSnapshotId === null && event.command.afterRunSnapshotId === null
          ? {
              ...event.command,
              testedSnapshotId: started?.beforeSnapshotId ?? null,
              afterRunSnapshotId: this.safeSnapshotId(),
              snapshotRoots:
                started?.workspacePath === null || started === undefined ? [] : [...this.workspaceFolders],
            }
          : event.command;
      const owner = this.turns.find((candidate) => candidate.dspatchRunId === event.dspatchRunId);
      owner?.commands.push(storedCommandRecord(record));
      this.options.log(
        `agent command ${record.commandId}: \`${record.line}\` in ${record.cwd} ended ` +
          `${record.ending} (exit ${record.exitCode === null ? 'none' : String(record.exitCode)}) ` +
          `after ${String(record.durationMs)} ms; snapshot ${record.testedSnapshotId ?? 'not observed'} -> ` +
          `${record.afterRunSnapshotId ?? 'not observed'}`,
      );
      if (owner !== undefined) {
        this.saveConversation(owner.conversationId);
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
    const reported =
      event.type === 'run.finished' && this.adapter !== null
        ? (() => {
            try {
              return this.adapter.modelReported(event.dspatchSessionId);
            } catch {
              return null;
            }
          })()
        : null;
    this.options.send(
      event.type === 'run.started' && this.pendingResentContext !== null
        ? { ...ui, resentContext: this.pendingResentContext }
        : reported === null
          ? ui
          : { ...ui, modelReported: reported },
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
    ...(turn.commands.length === 0 ? {} : { commands: [...turn.commands] }),
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

/**
 * The unresolved attempts of a conversation this window already holds, in the shape a
 * read-back reports them. Nothing here was closed by a restart, so `stateAtClose` is
 * the state they are in now.
 */
function heldReconciliations(ledger: AttemptLedger): readonly AttemptReconciliation[] {
  return ledger.unresolved().map((attempt) => ({
    attemptId: attempt.attemptId,
    kind: attempt.kind,
    label: attempt.label,
    stateAtClose: attempt.state,
    stateNow: attempt.state,
    blocksRepeat: attempt.acknowledgedAtUtc === null,
    note: attempt.stateReason,
  }));
}

/** What reading back a held conversation means for its open attempts, without restart wording. */
function describeHeldReconciliation(reconciliations: readonly AttemptReconciliation[]): string {
  if (reconciliations.length === 0) {
    return (
      'Every attempt in this conversation has reached a state DSpatch could ' +
      'establish, so there is nothing to reconcile and the conversation can be ' +
      'continued as it stands.'
    );
  }
  const total = reconciliations.length;
  const awaiting = reconciliations.filter((item) => item.blocksRepeat).length;
  return (
    `${String(total)} attempt${total === 1 ? '' : 's'} in this conversation ${
      total === 1 ? 'has' : 'have'
    } no established ending. This window already holds ${
      total === 1 ? 'it' : 'them'
    }, so nothing was read back again and nothing has been repeated. ` +
    (awaiting === 0
      ? 'You confirmed them before, so nothing has to be confirmed again.'
      : `${String(awaiting)} still ${awaiting === 1 ? 'has' : 'have'} to be confirmed ` +
        'before DSpatch sends another message or runs the command again in this working ' +
        'copy. Confirming leaves an attempt on the record as unresolved rather than ' +
        'marking it done.')
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
  /** `window` when the conversation was already held here and taken from memory. */
  source: 'file' | 'window',
): string {
  const parts: string[] = [
    `${
      source === 'file'
        ? 'Read back from a saved file'
        : 'Taken from what this window already holds'
    }: ${String(conversation.messages.length)} message${
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
export function toUiEvent(event: AgentEvent): UiAgentEvent {
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
    case 'command.started':
      return {
        ...base,
        command: { commandId: event.commandId, line: event.line, ending: null, exitCode: null, durationMs: null },
      };
    case 'command.finished':
      return {
        ...base,
        command: {
          commandId: event.command.commandId,
          line: event.command.line,
          ending: event.command.ending,
          exitCode: event.command.exitCode,
          durationMs: event.command.durationMs,
          ...(event.command.ending === 'stopped' && !event.command.killedByDspatch
            ? { stopConfirmed: false }
            : {}),
        },
      };
    case 'approval.requested':
      return { ...base, approvalSummary: event.request.summary };
    case 'usage':
      return { ...base, readings: event.readings };
    case 'run.finished':
      return {
        ...base,
        status: event.status,
        // DSP-117: how a cancelled run ended locally. Without it the window could
        // not tell an unconfirmed end from an ordinary cancel.
        ...(event.end === undefined ? {} : { end: event.end }),
        ...(event.error === undefined ? {} : { errorMessage: event.error.message }),
      };
    default:
      return base;
  }
}

/**
 * DSP-145 (review I1): a command record as a conversation keeps it - the end of each
 * stream within the same bound the run record uses, with a note of what was left out.
 * The whole output exists only while the turn runs; nothing beyond the bound is saved.
 */
export function storedCommandRecord(record: AgentCommandRecord): AgentCommandRecord {
  const out = boundedOutput(record.stdout);
  const err = boundedOutput(record.stderr);
  if (out.cutChars === 0 && err.cutChars === 0) {
    return record;
  }
  const note =
    `The conversation keeps the last ${String(DEFAULT_OUTPUT_BUDGET.maxOutputChars)} characters ` +
    `of each stream: ${String(out.cutChars)} characters of standard output and ` +
    `${String(err.cutChars)} of standard error were left out.`;
  return {
    ...record,
    stdout: out.tail,
    stderr: err.tail,
    outputTruncated: true,
    outputNote: record.outputNote === null ? note : `${record.outputNote} ${note}`,
  };
}

/** DSP-145: why the Run button is refused while another command holds the working copy. */
function describeRunRefused(holder: { readonly by: 'agent' | 'person'; readonly line: string }): string {
  return holder.by === 'agent'
    ? `The agent is running a command in this working copy (${holder.line}). Wait for its ` +
        'result, or cancel the turn, before running another: two at once would interleave ' +
        'their output and their file writes.'
    : 'A command is already running in this working copy. Stop it first: two at once ' +
        'would interleave their output and their file writes.';
}

/** A provider's name as the window says it. */
function providerName(provider: StoredSessionProvider): string {
  return provider === 'claude' ? 'Claude' : 'Cursor';
}
