/**
 * What the window shows about a session's continuity, as a rule rather than a
 * component (DSP-121).
 *
 * The same reason `recovery.ts` has no React in it: the three states in which no
 * provider session is open each have to show a short, true account of what
 * happened, the choices the main process offers and nothing it does not, and a
 * rule welded into JSX cannot be shown to do that. `App.tsx` draws exactly what
 * this returns.
 *
 * Nothing here decides anything. The main process decides which choices exist and
 * whether a provider session is open; this module turns that into a heading, a
 * body keyed on the evidence, labels, and says what the user has already done in
 * this window - dismissed the choices to read the history, or removed the recap -
 * so the drawing does not have to remember it.
 *
 * Niclas's reading of the first panel (24 October 2026): a wall of text, too
 * technical. The user needs to understand what happened and choose the next step;
 * troubleshooting information must be available without dominating the view. So
 * the service's full statement, the failure's own words, the provider code and the
 * rest are kept verbatim but go behind one closed "Technical details" disclosure,
 * and what is in the open is the heading, one short body and three buttons.
 */

import type {
  ContinuityChoice,
  EarlierSendMayHaveReached,
  ScriptedRunPlan,
  SessionContinuity,
} from '../shared/bridge';

/**
 * The full sentence about a refusal or failure that the presentation adapter
 * simulated (DSP-121 presentation runs). Shown under Technical details; the short
 * `SIMULATION_LABEL` is what stands in the open.
 *
 * Keyed on the scripted plan's `resumeMode` and on nothing else: an ordinary launch
 * has no plan, and a plan whose mode is `ok` or absent asked for no simulation, so
 * both get nothing. The statement under it is the service's honest reading of what
 * the adapter answered ("the provider answered that it does not have that
 * session"); this is what keeps that reading apart from a real provider's answer in
 * the one place a person looks.
 */
export const SIMULATION_NOTICE =
  'Presentation mode: this refusal or failure is simulated by the presentation adapter ' +
  'on this machine; no provider was asked anything.';

/** The short form of `SIMULATION_NOTICE`, for the panel and the drawer. */
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

/** The heading of the choice panel, the same in every state without an open session. */
export const CONTINUITY_HEADING = 'Could not resume the agent session';

/** The sentence shown only when an earlier message of this conversation has no confirmed end. */
export const EARLIER_SENDS_NOTE =
  'An earlier message may have reached the agent; nothing is resent.';

/**
 * Above the buttons, only while a workspace command is actually running: both
 * choices that open a session close this one first, which stops the command.
 */
export const RUNNING_COMMAND_NOTE =
  'A running command is stopped by Try again or Start new session.';

/** The drawer's one line while no session is open and the panel shows the state. */
export const DRAWER_POINTER = 'Details are in the panel above.';

/** The drawer's short line for a new provider session, in place of the long statement. */
export const NEW_SESSION_NOTE =
  "The agent's earlier context does not follow automatically. DSpatch will send this " +
  'summary first; you can remove it.';

/** The composer's status while no agent session is open. */
export const NO_SESSION_STATUS = 'No agent session — history only';

const STILL_AVAILABLE = 'Your saved conversation is still available.';
const TRY_OR_NEW = 'Try again or start a new agent session.';

/**
 * The panel's body, keyed on what the failure established and nothing else.
 *
 * The one rule that matters: it never says the session is missing unless the
 * provider itself said so (`provider-missing`). A failed attempt, an unknown
 * outcome, a local check that was never a provider check and a refusal DSpatch made
 * on its own record each get their own sentence. `null` while a session is open.
 */
export function continuityBody(
  continuity: Pick<SessionContinuity, 'kind' | 'providerSessionOpen' | 'resumeFailure'>,
): string | null {
  if (continuity.providerSessionOpen) {
    return null;
  }
  if (continuity.kind === 'resume-unavailable') {
    return (
      `This adapter cannot resume sessions. ${STILL_AVAILABLE} ` +
      'Start a new agent session or read the history.'
    );
  }
  switch (continuity.resumeFailure?.kind) {
    case 'provider-missing':
      return `The agent no longer has this session. ${STILL_AVAILABLE} ${TRY_OR_NEW}`;
    case 'error':
      // A refused resume with a plain error (the adapter's own rule, where trying
      // again gives the same answer) is not called temporary; a failed one may be.
      return (
        `Resuming did not work this time${
          continuity.kind === 'resume-failed' ? '; it may be temporary' : ''
        }. ${STILL_AVAILABLE} ${TRY_OR_NEW}`
      );
    case 'local-record-missing':
      return (
        `No local record of this session was found; the agent was not asked. ` +
        `${STILL_AVAILABLE} ${TRY_OR_NEW}`
      );
    case 'unconfirmed-end':
      return (
        'The last message of this conversation has no confirmed end, so the session ' +
        `was not resumed. ${STILL_AVAILABLE} ${TRY_OR_NEW}`
      );
    case 'unknown':
    default:
      return (
        'DSpatch could not tell whether the agent still has this session. ' +
        `${STILL_AVAILABLE} ${TRY_OR_NEW}`
      );
  }
}

/** The note above the buttons, or `null` when no workspace command is running. */
export function runningCommandNote(commandRunning: boolean): string | null {
  return commandRunning ? RUNNING_COMMAND_NOTE : null;
}

/**
 * The status beside the composer. "Waiting for your message" is false while no
 * agent session is open - a message is refused - so that state gets its own line,
 * unless something (a loop run, which has sessions of its own) is actually running.
 */
export function composerStatus(
  continuity: Pick<SessionContinuity, 'providerSessionOpen'> | null,
  activityText: string,
  somethingRunning: boolean,
): string {
  return continuity !== null && !continuity.providerSessionOpen && !somethingRunning
    ? NO_SESSION_STATUS
    : activityText;
}

/** One button, in the order the main process listed the choices. */
export interface ContinuityChoiceView {
  readonly choice: ContinuityChoice;
  readonly label: string;
  /** `data-ev` of the button. */
  readonly testId: string;
  /** What pressing it does and does not do, in the user's terms. */
  readonly note: string;
}

export interface ContinuityView {
  readonly providerSessionOpen: boolean;
  /** The panel's heading; `null` while a session is open. */
  readonly heading: string | null;
  /** The panel's short body, from `continuityBody`; `null` while a session is open. */
  readonly body: string | null;
  /** `EARLIER_SENDS_NOTE` when an earlier message has no confirmed end, else `null`. */
  readonly earlierSendsNote: string | null;
  /**
   * The drawer's one line: the heading while no session is open, the service's
   * statement for a resumed session, the short note for a new one, `null` for a
   * first session.
   */
  readonly drawerLine: string | null;
  /** The service's full statement, for Technical details; `null` for a first session. */
  readonly statement: string | null;
  /** The refused or failed resume's own words, for Technical details; `null` otherwise. */
  readonly technicalDetail: string | null;
  /** The provider's own code on the failure, or `null`. */
  readonly providerCode: string | null;
  /** The session DSpatch tried to continue, or `null`. */
  readonly attemptedSessionId: string | null;
  /** One line per earlier message with no confirmed end. */
  readonly earlierSends: readonly string[];
  /**
   * The buttons. Empty while a provider session is open, and empty once the user
   * chose to read the history: that choice is made in the window and sends nothing.
   */
  readonly choices: readonly ContinuityChoiceView[];
  /** The recap that will go in front of the next message, or `null`. */
  readonly recap: { readonly text: string; readonly note: string } | null;
  /** Shown in place of the recap once it has been removed. */
  readonly recapRemovedNote: string | null;
}

/** What the window has done with the continuity, which the main process does not know. */
export interface ContinuityWindowState {
  /** A message has gone in this session, so a recap is no longer pending. */
  readonly sentAnything: boolean;
  /** The user removed the recap through `discardPendingRecap`. */
  readonly recapDiscarded: boolean;
  /** The user chose to read the history, which dismisses the choices locally. */
  readonly choicesDismissed: boolean;
}

export const RECAP_REMOVED_NOTE = 'The recap was removed; only your message will be sent.';

const CHOICE_LABELS: Record<ContinuityChoice, { readonly label: string; readonly note: string }> =
  {
    'try-again': {
      label: 'Try again',
      note: 'Asks the agent for the same session once more. Nothing is sent.',
    },
    'new-session': {
      label: 'Start new session',
      note:
        'Opens a new agent session. DSpatch shows the summary it would send first; ' +
        'you can remove it. Nothing is sent until you send.',
    },
    'keep-reading': {
      label: 'Read history',
      note:
        'Hides these choices and changes nothing. A message is refused until you ' +
        'choose one of the other two.',
    },
  };

/** The sentence for one earlier message with no confirmed end. */
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

function drawerLineOf(continuity: SessionContinuity): string | null {
  if (!continuity.providerSessionOpen) {
    return CONTINUITY_HEADING;
  }
  switch (continuity.kind) {
    case 'first-session':
      return null;
    case 'new-provider-session':
      return NEW_SESSION_NOTE;
    default:
      return continuity.statement;
  }
}

export function continuityView(
  continuity: SessionContinuity,
  state: ContinuityWindowState,
): ContinuityView {
  const recapText = state.sentAnything || state.recapDiscarded ? null : continuity.contextToResend;
  return {
    providerSessionOpen: continuity.providerSessionOpen,
    heading: continuity.providerSessionOpen ? null : CONTINUITY_HEADING,
    body: continuityBody(continuity),
    earlierSendsNote:
      !continuity.providerSessionOpen && continuity.earlierSendsMayHaveReached.length > 0
        ? EARLIER_SENDS_NOTE
        : null,
    drawerLine: drawerLineOf(continuity),
    statement: continuity.kind === 'first-session' ? null : continuity.statement,
    technicalDetail: continuity.resumeFailure?.detail ?? null,
    providerCode: continuity.resumeFailure?.providerCode ?? null,
    attemptedSessionId: continuity.attemptedDspatchSessionId,
    earlierSends: continuity.earlierSendsMayHaveReached.map(earlierSendLine),
    choices:
      continuity.providerSessionOpen || state.choicesDismissed
        ? []
        : continuity.choices.map((choice) => ({
            choice,
            label: CHOICE_LABELS[choice].label,
            testId: `continuity-choice-${choice}`,
            note: CHOICE_LABELS[choice].note,
          })),
    recap: recapText === null ? null : { text: recapText, note: continuity.contextNote },
    recapRemovedNote:
      state.recapDiscarded && !state.sentAnything && continuity.contextToResend === null
        ? RECAP_REMOVED_NOTE
        : null,
  };
}
