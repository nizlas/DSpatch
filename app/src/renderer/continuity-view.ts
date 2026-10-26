/**
 * What the window shows about a session's continuity, as rules rather than a
 * component (DSP-121).
 *
 * The same reason `recovery.ts` has no React in it: while no provider session is
 * open the window has to give a short, true account of what happened, offer the
 * choices the main process lists and nothing it does not, and say what a choice
 * means where it is made - and a rule welded into JSX cannot be shown to do that.
 * `App.tsx` draws exactly what these functions return.
 *
 * Nothing here decides anything. The main process decides which choices exist and
 * whether a provider session is open; this module turns that into words.
 *
 * Niclas's decisions of 24 October 2026, after two rounds in the window: what
 * happened, what can I do and what does my choice mean, in that order and briefly.
 * There is no reading mode - the history is always readable in the same view, with
 * the way forward beside it. *Try again* is offered only where it can work (the
 * main process's `choices`). No sentence says the session existed, disappeared or
 * is missing when the only evidence is that it was not found. Diagnostics are out
 * of the conversation, complete and copyable, in the Session details view
 * (`conversationDiagnostics`); nothing here opens them.
 */

import type {
  ContinuityChoice,
  StoredSessionProvider,
  EarlierSendMayHaveReached,
  RestoredHistory,
  ScriptedRunPlan,
  SessionContextInfo,
  SessionContinuity,
} from '../shared/bridge';

/**
 * The full sentence about a refusal or failure that the presentation adapter
 * simulated (DSP-121 presentation runs), for the diagnostics; the short
 * `SIMULATION_LABEL` is what stands in the panel.
 *
 * Keyed on the scripted plan's `resumeMode` and on nothing else: an ordinary launch
 * has no plan, and a plan whose mode is `ok` or absent asked for no simulation, so
 * both get nothing. The statement beside it is the service's honest reading of what
 * the adapter answered ("the provider answered that it does not have that
 * session"); this is what keeps that reading apart from a real provider's answer.
 */
export const SIMULATION_NOTICE =
  'Presentation mode: this refusal or failure is simulated by the presentation adapter ' +
  'on this machine; no provider was asked anything.';

/** The short form of `SIMULATION_NOTICE`, for the panel. */
export const SIMULATION_LABEL = 'Test mode — no provider calls';

function simulatedResume(plan: Pick<ScriptedRunPlan, 'resumeMode'> | null | undefined): boolean {
  const mode = plan?.resumeMode;
  return mode === 'refused' || mode === 'failed' || mode === 'refused-once';
}

export function simulationNotice(
  plan: Pick<ScriptedRunPlan, 'resumeMode'> | null | undefined,
): string | null {
  return simulatedResume(plan) ? SIMULATION_NOTICE : null;
}

export function simulationLabel(
  plan: Pick<ScriptedRunPlan, 'resumeMode'> | null | undefined,
): string | null {
  return simulatedResume(plan) ? SIMULATION_LABEL : null;
}

/** The heading of the panel, the same in every state without an open session. */
export const CONTINUITY_HEADING = 'Could not resume the agent session.';

/** The sentence every body carries: reading needs no choice. */
export const STILL_AVAILABLE = 'Your saved conversation is still available.';

/** The sentence shown only when an earlier message of this conversation has no confirmed end. */
export const EARLIER_SENDS_NOTE =
  'An earlier message may have reached the agent; nothing is resent.';

/**
 * Under the buttons, where the choice is made: what a new session means. Shown
 * whenever *Start new session* is offered.
 */
export const NEW_SESSION_AT_CHOICE =
  'A new session starts without the earlier conversation. You can send a summary ' +
  'with your next message.';

/** The composer's status while no agent session is open. */
export const NO_SESSION_STATUS = 'No agent session — history only';

/** The small entry into the diagnostics, at the end of the panel's action row. */
export const DETAILS_ENTRY_LABEL = 'Details';

/** The diagnostics section's copy button, and what it says once the copy is done. */
export const COPY_DIAGNOSTICS_LABEL = 'Copy diagnostic info';
export const COPIED_NOTE = 'Copied';

/** The new-session block, in the panel's place, until the next message goes. */
export const NEW_SESSION_HEADING =
  'New session. The agent does not have the earlier conversation.';
export const SUMMARY_WILL_BE_SENT = 'This summary will be sent with your next message.';
export const REMOVE_SUMMARY_LABEL = 'Remove summary';
export const SUMMARY_REMOVED = 'Summary removed. Only your message will be sent.';

/**
 * What a message that carried a summary says about it: on the live turn and when it
 * is read back, the same sentence in the new-session block's words ("new session",
 * "summary"), so the flow reads as one thing from the choice to the message it
 * shaped. The exact text the model was given stays behind it, unchanged.
 */
export function sentWithSummaryLine(characters: number): string {
  return `Sent in a new session with a summary of the earlier conversation (${String(characters)} characters).`;
}

/**
 * The first clause of the panel's body: what happened, keyed on what the failure
 * established and nothing else. `null` while a session is open.
 *
 * The rule that matters: no clause says the session is missing, no longer there,
 * disappeared or existed. `provider-missing` is the provider answering that it does
 * not find the ID - which says nothing about whether the session ever existed - so
 * it reads *not found*. A failed attempt, an unknown outcome, a local check that was
 * never a provider check and a refusal DSpatch made on its own record each get
 * their own clause.
 */
export function continuityClause(
  continuity: Pick<SessionContinuity, 'kind' | 'providerSessionOpen' | 'resumeFailure'>,
): string | null {
  if (continuity.providerSessionOpen) {
    return null;
  }
  if (continuity.kind === 'resume-unavailable') {
    return 'This adapter cannot resume sessions.';
  }
  const failure = continuity.resumeFailure;
  switch (failure?.kind) {
    case 'provider-missing':
      return 'The session was not found.';
    case 'local-record-missing':
      return 'No local record of the session was found.';
    case 'unconfirmed-end':
      return 'The last message has no confirmed end, so the session was not resumed.';
    case 'provider-differs':
      // DSP-117: the detail names both providers; the clause says only the rule.
      return 'The session belongs to another agent, so it was not resumed.';
    case 'error':
      if (failure.providerCode === 'config_mismatch') {
        return 'The session was recorded with other settings.';
      }
      if (failure.providerCode === 'authentication_refused') {
        // Only the Claude adapter uses this code, and it refuses before Claude is
        // started. The rule's own words stay in Session details (DSP-117).
        return "DSpatch's own credential rule refused Claude; Claude was not asked.";
      }
      return continuity.kind === 'resume-failed'
        ? 'This may be temporary.'
        : 'The resume was refused.';
    case 'unknown':
    default:
      return 'DSpatch could not check the session.';
  }
}

/** What the user can do, from the choices the main process listed and no others. */
export function actionSentence(choices: readonly ContinuityChoice[]): string | null {
  if (choices.includes('try-again')) {
    return 'Try again, or start a new session.';
  }
  return choices.includes('new-session') ? 'Start a new session to continue.' : null;
}

/**
 * The panel's one body line: what happened, that the history is there, what to do.
 *
 * "Your saved conversation is still available." only when there is one: a project
 * opened and closed before anything was sent is saved with its session and no
 * messages, and its body must not point at a history that does not exist (DSP-121
 * review B1). `savedMessageCount` is the service's merged count - the file's messages
 * and this run's turns - the same count its summary is built from.
 */
export function continuityBody(
  continuity: Pick<
    SessionContinuity,
    'kind' | 'providerSessionOpen' | 'resumeFailure' | 'choices' | 'savedMessageCount'
  >,
): string | null {
  const clause = continuityClause(continuity);
  if (clause === null) {
    return null;
  }
  const action = actionSentence(continuity.choices);
  const stillAvailable = continuity.savedMessageCount > 0 ? STILL_AVAILABLE : null;
  return [clause, stillAvailable, action].filter((part) => part !== null).join(' ');
}

/**
 * Above the buttons, only while a workspace command is actually running: every
 * choice that opens a session closes this one first, which stops the command. Names
 * only the choices offered.
 */
export function runningCommandNote(
  commandRunning: boolean,
  choices: readonly ContinuityChoice[],
): string | null {
  if (!commandRunning || choices.length === 0) {
    return null;
  }
  return choices.includes('try-again')
    ? 'A running command is stopped by Try again or Start new session.'
    : 'A running command is stopped by Start new session.';
}

/**
 * Why Enter holds an ordinary message back while no agent session is open, naming
 * the way forward - the reason the composer gives instead of sending a message to be
 * refused. `null` while a session is open.
 */
export function noSessionRouteNote(
  continuity: Pick<SessionContinuity, 'providerSessionOpen' | 'choices'> | null,
): string | null {
  if (continuity === null || continuity.providerSessionOpen) {
    return null;
  }
  return continuity.choices.includes('try-again')
    ? 'Try again or start a new session to send.'
    : 'Start a new session to send.';
}

/**
 * The status beside the composer. "Waiting for your message" is false while no
 * agent session is open - a message is held back - so that state gets its own line,
 * unless something (a loop run, which has sessions of its own) is actually running,
 * or *Use loop* is on: Enter then starts a loop run, which opens sessions of its own,
 * so "history only" would not be true of the next press (DSP-121 review S3).
 */
export function composerStatus(
  continuity: Pick<SessionContinuity, 'providerSessionOpen'> | null,
  activityText: string,
  somethingRunning: boolean,
  useLoop: boolean,
): string {
  return continuity !== null && !continuity.providerSessionOpen && !somethingRunning && !useLoop
    ? NO_SESSION_STATUS
    : activityText;
}

/** One button, in the order the main process listed the choices. */
export interface ContinuityChoiceView {
  readonly choice: ContinuityChoice;
  readonly label: string;
  /** `data-ev` of the button. */
  readonly testId: string;
  /** What pressing it does and does not do, in the user's terms (its tooltip). */
  readonly note: string;
}

const CHOICE_LABELS: Record<ContinuityChoice, { readonly label: string; readonly note: string }> =
  {
    'try-again': {
      label: 'Try again',
      note: 'Asks for the same session once more. No message is sent.',
    },
    'new-session': {
      label: 'Start new session',
      note:
        'Opens a new agent session. DSpatch shows the summary it would send first; ' +
        'you can remove it. No message is sent until you send.',
    },
    'switch-to-cursor': {
      label: 'Switch to Cursor',
      note:
        'Opens a new Cursor session for this conversation instead. DSpatch shows the ' +
        'summary it would send first; you can remove it. No message is sent until you send.',
    },
  };

/**
 * Whether the Claude adapter refused on DSpatch's own credential rule.
 *
 * Only the Claude adapter uses `authentication_refused`, so this also says which
 * provider the session was: a new session after it is a new **Claude** session,
 * never silently a Cursor one (DSP-117). Switching to Cursor is a separate,
 * explicit choice (`switch-to-cursor`), offered beside it.
 */
function refusedByCredentialRule(continuity: Pick<SessionContinuity, 'resumeFailure'>): boolean {
  return continuity.resumeFailure?.providerCode === 'authentication_refused';
}

/** *Start new session* after Claude was refused by DSpatch's credential rule. */
export const NEW_CLAUDE_SESSION_NOTE =
  'Opens a new Claude session. DSpatch applies the same credential rule first, so ' +
  'it is refused the same way until DSpatch is started from an environment the ' +
  'rule accepts. No message is sent until you send.';

/** The panel while no provider session is open: everything it says, in order. */
export interface ContinuityPanelView {
  readonly heading: string;
  /** What happened, that the history is still there, and what to do. */
  readonly body: string;
  /** `EARLIER_SENDS_NOTE` when an earlier message has no confirmed end, else `null`. */
  readonly earlierSendsNote: string | null;
  /** The consequence for a running command, before the click, only while one runs. */
  readonly runningCommandNote: string | null;
  /** Exactly the choices the main process listed, in its order. */
  readonly choices: readonly ContinuityChoiceView[];
  /** What a new session means, under the buttons, when that choice is offered. */
  readonly newSessionNote: string | null;
}

/** The panel, or `null` while a provider session is open. */
export function continuityPanel(
  continuity: SessionContinuity,
  commandRunning: boolean,
  /**
   * DSP-117 (review R3): the agent a new session would use, `session.provider`.
   * When given, *Start new session* names it, so the choice cannot open another
   * provider than the one it says. Absent keeps the generic words.
   */
  provider?: StoredSessionProvider,
): ContinuityPanelView | null {
  const body = continuityBody(continuity);
  if (body === null) {
    return null;
  }
  return {
    heading: CONTINUITY_HEADING,
    body,
    earlierSendsNote:
      continuity.earlierSendsMayHaveReached.length > 0 ? EARLIER_SENDS_NOTE : null,
    runningCommandNote: runningCommandNote(commandRunning, continuity.choices),
    choices: continuity.choices.map((choice) => ({
      choice,
      label:
        choice === 'new-session' && provider !== undefined
          ? `Start new ${providerWord(provider)} session`
          : CHOICE_LABELS[choice].label,
      testId: `continuity-choice-${choice}`,
      note:
        choice === 'new-session' && refusedByCredentialRule(continuity)
          ? NEW_CLAUDE_SESSION_NOTE
          : choice === 'new-session' && provider !== undefined
            ? `Opens a new ${providerWord(provider)} session. DSpatch shows the summary ` +
              'it would send first; you can remove it. No message is sent until you send.'
            : CHOICE_LABELS[choice].note,
    })),
    // Only when there is something to summarise: with no saved messages a new session
    // gets no summary (the service builds none), so the line would promise one that
    // will not exist (DSP-121 review B1).
    newSessionNote:
      continuity.choices.includes('new-session') && continuity.savedMessageCount > 0
        ? NEW_SESSION_AT_CHOICE
        : null,
  };
}

function providerWord(provider: StoredSessionProvider): string {
  return provider === 'claude' ? 'Claude' : 'Cursor';
}

/** What the window has done with a new session, which the main process does not know. */
export interface NewSessionWindowState {
  /** A message has gone in this session, so the summary is no longer pending. */
  readonly sentAnything: boolean;
  /** The user removed the summary through `discardPendingRecap`. */
  readonly recapDiscarded: boolean;
}

/** The block that stands in the panel's place after *Start new session*. */
export interface NewSessionView {
  readonly heading: string;
  /** The summary the main process will put in front of the next message, or `null`. */
  readonly summary: {
    readonly text: string;
    /** `SUMMARY_WILL_BE_SENT`. */
    readonly line: string;
    /** The disclosure's label, with the exact length. */
    readonly toggle: string;
  } | null;
  /** `SUMMARY_REMOVED` once the main process has confirmed the removal. */
  readonly removedLine: string | null;
}

/**
 * The new-session block, or `null`.
 *
 * Drawn for a new provider session until its first message goes - the one opened
 * by *Start new session* in the panel or beside a session holding a run, and the one a
 * conversation with saved messages but no recorded session gets. What it shows is
 * what the main process holds: the summary while `contextToResend` carries it, the
 * removed line once the main process has answered the removal with `null`. A first
 * session, a resumed one and a new one with nothing to summarise get no block.
 */
export function newSessionView(
  continuity: SessionContinuity,
  state: NewSessionWindowState,
): NewSessionView | null {
  if (
    continuity.kind !== 'new-provider-session' ||
    !continuity.providerSessionOpen ||
    state.sentAnything
  ) {
    return null;
  }
  if (continuity.contextToResend !== null) {
    return {
      heading: NEW_SESSION_HEADING,
      summary: {
        text: continuity.contextToResend,
        line: SUMMARY_WILL_BE_SENT,
        toggle: `Summary (${String(continuity.contextToResend.length)} characters)`,
      },
      removedLine: null,
    };
  }
  return state.recapDiscarded
    ? { heading: NEW_SESSION_HEADING, summary: null, removedLine: SUMMARY_REMOVED }
    : null;
}

/** The line for one earlier message with no confirmed end. */
export function earlierSendLine(send: EarlierSendMayHaveReached): string {
  return (
    `"${send.label}" (${send.attemptId}, ${send.state}` +
    `${send.acknowledged ? ', acknowledged' : ''})`
  );
}

/** The "Provider session" fact: the ID, and whether a session is open behind it. */
export function providerSessionFact(providerSessionId: string, providerSessionOpen: boolean): string {
  return providerSessionOpen ? providerSessionId : `${providerSessionId} (on record, not open)`;
}

/** One labelled line of the diagnostics. */
export interface DiagnosticLine {
  /** Stable; the value's `data-ev` is `diagnostics-<key>`. */
  readonly key: string;
  readonly label: string;
  /** Verbatim: the service's or the store's own words, never reworded. */
  readonly value: string;
}

export interface DiagnosticsInput {
  readonly continuity: SessionContinuity;
  /** `ChatSessionInfo.context.statement`: what DSpatch sent, or what the resume call carried. */
  /**
   * `ChatSessionInfo.context`: the statement of what DSpatch sent or what the resume
   * call carried, and the values it refers to.
   */
  readonly context: Pick<
    SessionContextInfo,
    'statement' | 'workingDirectorySent' | 'modelSent' | 'toolPolicySent'
  >;
  readonly adapterId: string;
  /** Where the conversation on screen was read back from. */
  readonly history: Pick<RestoredHistory, 'filePath' | 'savedAtUtc' | 'messages' | 'error'>;
  /** `simulationNotice(plan)`: the full sentence in a presentation run, else `null`. */
  readonly simulation: string | null;
}

/**
 * The diagnostics for the conversation on screen, as plain labelled lines.
 *
 * Everything that is evidence rather than conversation about how this session
 * relates to the earlier one, word for word: the service's statement for whatever
 * state it is in, the failure's own words, the provider's code, the session DSpatch
 * tried to continue, the adapter, what the resume call or the session carried and the
 * values it carried (working directory, model, tool policy), what is resent, each
 * earlier message with no confirmed end, and the storage metadata
 * that used to introduce the history on screen. IDs the Session details view
 * already shows elsewhere (the conversation, the provider session) are not repeated.
 * One list, so the view and *Copy diagnostic info* cannot disagree: the copy is
 * `diagnosticsText` of exactly these lines.
 */
export function conversationDiagnostics(input: DiagnosticsInput): readonly DiagnosticLine[] {
  const { continuity, history } = input;
  const lines: DiagnosticLine[] = [];
  const add = (key: string, label: string, value: string): void => {
    lines.push({ key, label, value });
  };
  if (input.simulation !== null && !continuity.providerSessionOpen) {
    add('simulated', 'Test mode', input.simulation);
  }
  add('statement', 'Session continuity', continuity.statement);
  if (continuity.resumeFailure !== null) {
    add('failure-detail', 'Failure detail', continuity.resumeFailure.detail);
    if (continuity.resumeFailure.providerCode !== null) {
      add('provider-code', 'Provider code', continuity.resumeFailure.providerCode);
    }
  }
  if (continuity.attemptedDspatchSessionId !== null) {
    add('attempted-session', 'Attempted session', continuity.attemptedDspatchSessionId);
  }
  add('adapter', 'Adapter', input.adapterId);
  add('context-statement', 'What DSpatch sent', input.context.statement);
  // The values that statement refers to ("the values here are what DSpatch would
  // send"), so the copied text carries them too (DSP-121 review S1).
  add('working-directory', 'Working directory', input.context.workingDirectorySent);
  add('model', 'Model', input.context.modelSent);
  add('tool-policy', 'Tool policy', input.context.toolPolicySent);
  add('context-note', 'What is resent', continuity.contextNote);
  continuity.earlierSendsMayHaveReached.forEach((send, index) => {
    add(`earlier-send-${String(index)}`, 'Earlier message with no confirmed end', earlierSendLine(send));
  });
  add('conversation-file', 'Conversation file', history.filePath ?? 'not saved by this build');
  if (history.savedAtUtc !== null) {
    add('saved-at', 'File saved at', history.savedAtUtc);
  }
  add('messages-read', 'Messages read back', String(history.messages.length));
  if (history.error !== null) {
    add('history-error', 'History read error', history.error);
  }
  return lines;
}

/** The text *Copy diagnostic info* puts on the clipboard: one `Label: value` per line. */
export function diagnosticsText(lines: readonly DiagnosticLine[]): string {
  return lines.map((line) => `${line.label}: ${line.value}`).join('\n');
}
