/**
 * What the window shows about a session's continuity, as a rule rather than a
 * component (DSP-121).
 *
 * The same reason `recovery.ts` has no React in it: the three states in which no
 * provider session is open each have to show a statement, the choices the main
 * process offers and nothing it does not, and a rule welded into JSX cannot be
 * shown to do that. `App.tsx` draws exactly what this returns.
 *
 * Nothing here decides anything. The main process decides which choices exist and
 * whether a provider session is open; this module turns that into labels and says
 * what the user has already done in this window - dismissed the choices to keep
 * reading, or removed the recap - so the drawing does not have to remember it.
 */

import type {
  ContinuityChoice,
  EarlierSendMayHaveReached,
  SessionContinuity,
} from '../shared/bridge';

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
  /** `null` for a first session: there is nothing to say. */
  readonly statement: string | null;
  /** The refused or failed resume's own words, for a disclosure; `null` otherwise. */
  readonly technicalDetail: string | null;
  /** One line per earlier message with no confirmed end. */
  readonly earlierSends: readonly string[];
  /**
   * The buttons. Empty while a provider session is open, and empty once the user
   * chose to keep reading: that choice is made in the window and sends nothing.
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
  /** The user chose to keep reading, which dismisses the choices locally. */
  readonly choicesDismissed: boolean;
}

export const RECAP_REMOVED_NOTE = 'The recap was removed; only your message will be sent.';

const CHOICE_LABELS: Record<ContinuityChoice, { readonly label: string; readonly note: string }> =
  {
    'try-again': {
      label: 'Try again to resume this session',
      note:
        'Asks to resume the same session ID once more. This closes the session on ' +
        'screen first, which stops a build or test command that is still running; ' +
        'nothing is sent to the provider.',
    },
    'new-session': {
      label: 'Start a new provider session',
      note:
        'Opens a new provider session over this project and this conversation. The ' +
        'model in it has no memory of the conversation above; DSpatch shows the recap ' +
        'it would put in front of your next message, and you can remove it before ' +
        'sending. Nothing is sent until you send.',
    },
    'keep-reading': {
      label: 'Keep reading without starting an agent',
      note:
        'Hides these choices and changes nothing: no provider session is opened, ' +
        'nothing is written, and a message sent from the box is refused until you ' +
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

export function continuityView(
  continuity: SessionContinuity,
  state: ContinuityWindowState,
): ContinuityView {
  const recapText = state.sentAnything || state.recapDiscarded ? null : continuity.contextToResend;
  return {
    providerSessionOpen: continuity.providerSessionOpen,
    statement: continuity.kind === 'first-session' ? null : continuity.statement,
    technicalDetail: continuity.resumeFailure?.detail ?? null,
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
