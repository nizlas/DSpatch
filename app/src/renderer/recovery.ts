/**
 * What the window says and offers when something fails or takes too long.
 *
 * A separate module with no React in it, for the same reason `turn-routing.ts` is
 * one: these are rules, and a rule welded into a component cannot be shown to
 * work. The first three came out of report 003.
 *
 * 1. **A user-facing message carried Electron's plumbing.** The refusal to open
 *    DSpatch's own repository reached the window as `Error invoking remote method
 *    'dspatch:start-session': Error: Refusing to open …`. The real sentence was in
 *    there, behind two layers of transport detail. Stripping it is not cosmetic:
 *    the first line of a failure is what a person reads, and the channel name is
 *    the least useful thing that could be there. It is kept as evidence rather
 *    than thrown away.
 * 2. **Long processing is not a failure.** 11–12 seconds passed between Send and
 *    the first text in the measured runs, and DSP-1 saw a turn keep working for
 *    69.5 seconds after its connection was severed. So waiting has to read as
 *    waiting, with a way out, for far longer than feels natural.
 * 3. **Retries have to be bounded, and by a number with a reason.** An automatic
 *    retry loop against a provider that is down produces a window that looks busy
 *    and an account that is being charged for nothing.
 *
 * Report 005 added three more, all of them cases where two parts of the window
 * disagreed or where it promised something it did not do: the connection card that
 * read `connected` through a real outage, the failure block that stayed up after
 * the run it named had ended, and the composer that was empty after a run-level
 * failure whose own note said the text was kept.
 *
 * Report 008 found the worst of them: the rule for `session-holds-a-run` matched
 * only DSpatch's own wording, so the failure a restarted user actually hits fell
 * through to `other` and was offered *Try again*, which fails identically. The
 * match now lives in `shared/session-run-block.ts` and covers Cursor's wording as
 * well, and the action is no longer *Open a project again* — see `classify`.
 *
 * DSP-5's trial found the one remaining sentence here that was not a measurement.
 * The held-run note promised that the block "disappears on its own" once the run
 * ends; Niclas measured eleven minutes in which it did not, and DSP-6's probe
 * measured fifteen. That note now says what was observed — see `classify` again.
 */

import { saysSessionAlreadyHasARun } from '../shared/session-run-block';

/** What kind of failure this is, which decides what is offered. */
export type FailureKind =
  | 'refused-folder'
  /**
   * The generator declining to wipe a directory it did not create (DSP-61).
   *
   * Its own kind rather than `other`, and that is a correction rather than tidying.
   * The rule below matched only `Refusing to open`, so this refusal fell through to
   * `other` and the window offered **Try again** — which asks the generator to do the
   * identical thing and be refused identically, the same shape of defect report 008
   * found for a held run. The refusal is unchanged; what is offered beside it is not.
   */
  | 'refused-generated-folder'
  | 'needs-acknowledgement'
  | 'connection'
  | 'session-holds-a-run'
  | 'nothing-open'
  | 'other';

/** The action the window offers beside the message. */
export type RecoveryAction =
  | 'none'
  | 'retry'
  | 'reconnect'
  | 'acknowledge-then-repeat'
  | 'choose-another-folder'
  | 'open-project-again'
  | 'continue-in-new-session';

export interface BridgeFailure {
  /** The message to show, with the transport's own wrapping removed. */
  readonly message: string;
  /** Exactly what arrived, kept so nothing is hidden by the tidying. */
  readonly raw: string;
  /** The IPC channel, when the wrapper named one. Detail, not headline. */
  readonly channel: string | null;
  readonly kind: FailureKind;
  readonly action: RecoveryAction;
  /** What the offered action will do, in the user's terms. */
  readonly actionNote: string;
}

/** Electron's wrapper around a rejection from `ipcMain.handle`. */
const IPC_WRAPPER = /^Error invoking remote method '([^']+)':\s*/;

/**
 * The message a person should read, and the kind of failure it is.
 *
 * The stripping is deliberately narrow: one known wrapper, then repeated `Error:`
 * prefixes that stack up as a rejection crosses the bridge. Anything else is left
 * exactly as it arrived, because a message that has been cleverly rewritten is
 * worse than a slightly ugly one.
 */
export function describeBridgeFailure(error: unknown): BridgeFailure {
  const raw = error instanceof Error ? error.message : String(error);
  const wrapper = IPC_WRAPPER.exec(raw);
  const channel = wrapper?.[1] ?? null;
  let message = wrapper === null ? raw : raw.slice(wrapper[0].length);
  // `Error: Error: …` happens when a rejection is stringified more than once on
  // the way across. The words carry no information; the sentence after them does.
  while (/^(?:[A-Z][A-Za-z]*Error|Error):\s/.test(message)) {
    message = message.replace(/^(?:[A-Z][A-Za-z]*Error|Error):\s/, '');
  }
  message = message.trim() === '' ? raw : message.trim();
  const { kind, action, actionNote } = classify(message);
  return { message, raw, channel, kind, action, actionNote };
}

function classify(message: string): {
  kind: FailureKind;
  action: RecoveryAction;
  actionNote: string;
} {
  if (message.startsWith('Refusing to open')) {
    return {
      kind: 'refused-folder',
      action: 'choose-another-folder',
      actionNote:
        // Deliberately not "or a copy of this one somewhere else", which was
        // written when every refusal meant the chosen folder *was* DSpatch. A
        // folder that merely contains DSpatch is refused too, and copying that
        // one elsewhere would copy DSpatch with it. The refusal itself says which
        // case this is and what to choose instead.
        'Nothing was opened and nothing was changed. Choose a different folder; ' +
        'the message above says what was found and what to choose instead.',
    };
  }
  if (message.startsWith('Refusing to delete')) {
    return {
      kind: 'refused-generated-folder',
      action: 'choose-another-folder',
      actionNote:
        'Nothing in that folder was deleted, moved or written to, and nothing will ' +
        'be: DSpatch generates a sample project only into a folder it created itself. ' +
        'Trying the same thing again would be refused in the same words, so the way ' +
        'forward is a different folder — open the project you actually want to work ' +
        'in, or, if a sample project is what you wanted, point ' +
        'DSPATCH_CHAT_WORKSPACE at an empty directory or unset it and let DSpatch ' +
        'choose one. Old sample projects DSpatch generated can be removed from ' +
        'Project → Old sample projects….',
    };
  }
  if (message.includes('will not repeat this by itself')) {
    return {
      kind: 'needs-acknowledgement',
      action: 'acknowledge-then-repeat',
      actionNote:
        'The earlier attempt is named above with what is known about it. ' +
        'Confirming leaves it recorded as unresolved and starts a new attempt.',
    };
  }
  // Both wordings, and the action that is actually a way out. *Open a project
  // again* was not one: re-opening the same project resumes the same provider
  // session, which holds the same run and refuses the message again — which is
  // why report 008 hit this twice across a restart. A new provider session is the
  // only thing that clears it from DSpatch's side, and the message the main
  // process wrote above says which of the two situations this is.
  //
  // What this note used to end with was a promise: "If that run reports an end
  // first, this block disappears on its own and sending works again with nothing
  // to reopen." Nobody had ever seen that happen. Two measurements on 15 September
  // 2026, and neither of them saw it either:
  //
  // 1. Niclas killed a turn in the packaged window at about 17:16 and the session
  //    still refused every message at 17:27. Eleven minutes, no change.
  // 2. DSP-6's probe, `logs/001-implementer/hold-probe.mjs`: a real turn in a
  //    scratch repository, the client's whole process tree killed at the first text
  //    fragment, then `Agent.resume` plus `send` once a minute — exactly what the
  //    next message does. `resume` succeeded every time and `send` was refused
  //    every time, with `already has active run`: first at 2.3 s after the kill,
  //    last at 14 min 5 s, fifteen checks inside a 15-minute limit the probe
  //    reached rather than escaped. A brand-new session over the same repository
  //    then answered `READY` on the first try.
  //
  // So the block is stated as observed, the new session is named as the way out
  // that does not wait on the run, and whether it ever clears by itself is left as
  // unknown. Fifteen minutes is not proof of "never", and the text does not say
  // never — it says what was measured and stops there.
  //
  // One rule reaches two situations, and Verifier 004 read the consequence on
  // screen: this note appeared beside the main process's own explanation for the
  // case where **DSpatch** holds the run, which it is subscribed to and does see
  // end. Both texts were defensible and together they contradicted each other. The
  // measurements above were made on runs nothing was subscribed to, so that is what
  // they are now stated about, and the message above — which knows which case it is,
  // from the adapter's state rather than from prose — says which of the two applies.
  // Neither claim is weakened: waiting is still not known to help in the case it was
  // measured in, and the new session is still the only thing that does not wait.
  if (saysSessionAlreadyHasARun(message)) {
    return {
      kind: 'session-holds-a-run',
      action: 'continue-in-new-session',
      actionNote:
        'A provider session holds one run at a time, so this one will refuse every ' +
        'message until the run it is holding ends. Continuing in a new provider ' +
        'session is the way out that does not depend on that run ending. It opens a ' +
        'new session over the same project and the same conversation: nothing on ' +
        'disk is touched, nothing is sent to the run that is in the way, and ' +
        'DSpatch shows you the record it will put in front of your next message ' +
        'before it sends anything. When the run is one DSpatch never subscribed to ' +
        '— the usual case after a restart, and the message above says which of the ' +
        'two this is — waiting is not known to help, and this used to claim ' +
        'otherwise. Measured on 15 September 2026: a turn killed in this window was ' +
        'still refused 11 minutes later, and a run whose client was killed ' +
        'mid-stream was refused at every one of fifteen checks across 15 minutes, ' +
        'the last of them 14 minutes after the kill, while a new session over the ' +
        'same project answered at once. Whether such a run ever reports an end is ' +
        'unknown — DSpatch never subscribed to it and cannot see it end, so nothing ' +
        'here is waiting on your behalf.',
    };
  }
  if (message.startsWith('No session is open')) {
    return {
      kind: 'nothing-open',
      action: 'open-project-again',
      actionNote: 'Open a project first.',
    };
  }
  if (looksLikeConnectionTrouble(message)) {
    return {
      kind: 'connection',
      action: 'reconnect',
      actionNote:
        'DSpatch could not reach the provider. Check the connection again — ' +
        'nothing is retried on its own, so nothing has been sent twice.',
    };
  }
  return {
    kind: 'other',
    action: 'retry',
    actionNote:
      'Your text and everything already received are kept. Trying again starts a ' +
      'new attempt with its own ID.',
  };
}

/**
 * What a saved conversation's row says about attempts that had no ending.
 *
 * A rule rather than a sentence in the JSX, for the reason the whole module exists:
 * this claim is about what will happen when the conversation is opened, and a claim
 * welded into a component cannot be shown to be true. Verifier 004 measured the old
 * one being false. It said, unconditionally, "Opening this will record it as an
 * unknown outcome you have to confirm before continuing" — but DSP-6's first item
 * made one acknowledgement hold for the attempt, so for an attempt already on record
 * as seen the Verifier opened the conversation and sent a message with nothing to
 * confirm.
 *
 * `unacknowledged` is how many of the `unresolved` attempts have no acknowledgement
 * on record, which is exactly what decides whether the next message is gated.
 */
export function describeSavedConversationUnresolved(
  unresolved: number,
  unacknowledged: number,
): string {
  const opening =
    `${String(unresolved)} attempt${unresolved === 1 ? '' : 's'} had not reported ` +
    `an ending when DSpatch closed. Opening this records ${
      unresolved === 1 ? 'it' : 'them'
    } as an unknown outcome. `;
  if (unacknowledged === 0) {
    return (
      `${opening}You already confirmed ${
        unresolved === 1 ? 'it' : 'all of them'
      }, so nothing is asked again and sending works normally; ${
        unresolved === 1 ? 'it stays' : 'they stay'
      } on the record as unresolved. Nothing will be repeated.`
    );
  }
  if (unacknowledged === unresolved) {
    return (
      `${opening}The next message waits for you to confirm ${
        unresolved === 1 ? 'it' : 'all of them'
      } — once per attempt, not once per message. Nothing will be repeated.`
    );
  }
  return (
    `${opening}The next message waits for you to confirm the ${String(
      unacknowledged,
    )} you have not confirmed yet; the other ${String(
      unresolved - unacknowledged,
    )} you already confirmed and will not be asked about again. Nothing will be ` +
    'repeated.'
  );
}

/**
 * What a reconciled attempt's row says about the next action of its kind.
 *
 * `blocksRepeat` comes from the ledger, which decides it from the acknowledgement on
 * the attempt's record. It used to be `true` for every unresolved attempt, so a row
 * for an attempt whose acknowledgement was already on record told the reader to name
 * it first — an instruction for something that had been done and would not be asked
 * for again.
 */
export function describeReconciledRepeat(
  kind: 'agent-turn' | 'command',
  blocksRepeat: boolean,
): string {
  const next = kind === 'agent-turn' ? 'message' : 'run of the command';
  if (blocksRepeat) {
    return (
      `The next ${next} needs this named first. Naming it leaves it recorded as ` +
      'unresolved; it does not mark it done.'
    );
  }
  return (
    `You named this one already, so the next ${next} does not wait for it. It stays ` +
    'recorded as unresolved: naming it did not establish how the work ended, and ' +
    'nothing since has.'
  );
}

/**
 * Wording that indicates the transport rather than the request.
 *
 * A list of substrings rather than a clever classifier, and it deliberately fails
 * towards `other`: offering Retry when Reconnect was meant costs a click, while
 * calling a real refusal a network problem sends someone looking in the wrong
 * place.
 */
const CONNECTION_SIGNS: readonly string[] = [
  'fetch failed',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'socket hang up',
  'network',
  'getaddrinfo',
  'TLS',
  'certificate',
  'not-connected',
  'logged-out',
  'unauthorized',
  'Unauthorized',
  '401',
  '403',
  '502',
  '503',
  '504',
];

export function looksLikeConnectionTrouble(message: string): boolean {
  return CONNECTION_SIGNS.some((sign) => message.includes(sign));
}

/**
 * How long a send may be silent before the window puts a number on it.
 *
 * Above the 11–12 s measured to the first text, so an ordinary turn never trips it.
 *
 * There used to be a second threshold, `SEND_WAIT_LONG_MS`, where the wording changed
 * again and an extra paragraph appeared under the composer. DSP-87 removed both: the
 * number already rises, and a product that cannot see the provider has nothing to add
 * at 45 s that it did not have at 20.
 */
export const SEND_WAIT_NOTICE_MS = 20_000;

export interface WaitingStatus {
  readonly text: string;
  /**
   * Always `false`. A wait is never a verdict, and the field exists so that any
   * code tempted to render a wait as an error has to write the word `false`.
   */
  readonly isFailure: false;
  /** Whether to offer a way out of the wait. */
  readonly offerStopWaiting: boolean;
}

/**
 * What to say while a send has produced nothing yet.
 *
 * `hasRunStarted` matters: once a run exists, Cancel means something, and the
 * status is about the run rather than about the wait.
 *
 * **This is about the ordinary chat path only**, and the caller is what enforces
 * that. A loop run keeps `busy === 'sending'` for its whole length while every one
 * of its events arrives on another channel under another identity, so a wait
 * measured here over a loop run counted an interval nothing was ever going to end
 * and labelled it *nothing back* — see `App.tsx`, where `sendWait` is now null while
 * a loop run is going.
 *
 * **Three sentences became one** (DSP-87). The wait used to argue its case: what had
 * been measured in earlier runs, that this was slow rather than wrong, that nothing
 * had failed, that DSpatch could not see the provider — and then a second paragraph
 * under the composer repeating the last of those at greater length. A number and the
 * fact that nothing has failed is the whole of what a person can act on; the button
 * beside it says what they can do.
 */
export function describeSendWait(
  elapsedMs: number,
  hasRunStarted: boolean,
): WaitingStatus {
  const seconds = Math.floor(elapsedMs / 1000);
  if (hasRunStarted) {
    return {
      text: 'The run has started.',
      isFailure: false,
      offerStopWaiting: true,
    };
  }
  if (elapsedMs < SEND_WAIT_NOTICE_MS) {
    return {
      text: 'Sent. Nothing back yet.',
      isFailure: false,
      offerStopWaiting: true,
    };
  }
  return {
    text: `Sent ${String(seconds)} s ago. Nothing back yet, and nothing has failed.`,
    isFailure: false,
    offerStopWaiting: true,
  };
}

/**
 * The bounded automatic retry for the connection check.
 *
 * Two re-checks, 2 s then 6 s apart, and then it stops and waits for a person.
 * The reasoning: a connection check is a real round trip to the provider, a
 * transient failure that survives roughly eight seconds is not transient, and an
 * unbounded loop makes an outage look like activity. Two is enough to ride out a
 * dropped request and small enough that the window goes quiet and says what it
 * knows.
 *
 * **Only the check is retried.** Nothing here can repeat a send or a command;
 * those go through the ledger's reconciliation and need a person.
 */
export const CONNECTION_RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000];

export interface RetryPlan {
  readonly retry: boolean;
  /** `null` when nothing more will happen without the user. */
  readonly delayMs: number | null;
  readonly note: string;
}

/**
 * Whether a run's ending is a reason to re-read the connection.
 *
 * Report 005 measured the gap this closes: through a real 60-second outage the
 * connection card kept reading `connected` while the attempt beside it read
 * `failed`, because the card is only re-checked on demand. Two readings of the
 * same provider disagreed, and the wrong one was the reassuring one.
 *
 * Any terminal state that is not a completion or a confirmed cancellation counts,
 * rather than only messages that look like transport trouble. A run that failed
 * for a reason DSpatch cannot classify is exactly the case where the card's claim
 * is least worth trusting, and the check itself sends nothing and changes nothing.
 */
export function runEndingNeedsConnectionRecheck(
  status: string | undefined,
  errorMessage: string | undefined,
): boolean {
  if (status === 'finished' || status === 'cancelled') {
    return false;
  }
  return status !== undefined || errorMessage !== undefined;
}

/** Why the connection card was re-read without the user asking. */
export function connectionRecheckNote(
  reason: 'run-failed' | 'send-failed',
  detail: string | null,
): string {
  const cause =
    reason === 'run-failed'
      ? 'a run reported an ending that was not a completion'
      : 'a message could not be handed to the provider';
  return (
    `The connection above was re-read because ${cause}, so the card cannot keep ` +
    'saying "connected" while an attempt beside it says otherwise. Nothing was ' +
    'sent to do this; only the login and the model list were read.' +
    (detail === null || detail.trim() === '' ? '' : ` What failed: ${detail}`)
  );
}

/**
 * Whether a failure still on screen has been resolved by what is now known.
 *
 * Report 005 measured a `already has an active run` block that stayed up for the
 * remaining 30 seconds of a scenario after the blocking run had reported
 * `cancelled` and the panel beside it already said "Nothing is unresolved". Its
 * own text told the reader to watch that panel, so it was not misleading — but a
 * message that has stopped being true should not need the reader to work that out.
 *
 * Only the two kinds whose condition DSpatch can actually observe are cleared. A
 * refused folder, a connection failure and an unclassified failure stay until
 * something is done about them, because nothing here knows that they have passed.
 */
export function failureHasResolved(
  failure: Pick<BridgeFailure, 'kind'>,
  known: {
    readonly unresolvedAgentTurns: number;
    readonly needsAcknowledgementAgentTurn: readonly string[];
  },
): boolean {
  switch (failure.kind) {
    case 'session-holds-a-run':
      return known.unresolvedAgentTurns === 0;
    case 'needs-acknowledgement':
      // Every one of them, not the first. A block raised by two unknown outcomes
      // has not resolved while one of them is still unknown.
      return known.needsAcknowledgementAgentTurn.length === 0;
    default:
      return false;
  }
}

/** What to say when a block cleared itself rather than being acted on. */
export const FAILURE_RESOLVED_NOTE =
  'The failure reported here has resolved: the run it named has reported an end, ' +
  'so it is no longer standing in the way. Nothing was retried to establish that.';

/**
 * Where a failed turn's prompt text should be, and what to say about it.
 *
 * Report 005 found a promise the window did not keep. A failed attempt's note said
 * "Your text and everything already received are kept", and that is true after
 * *Stop waiting* — but after a run-level failure the composer was measured empty,
 * because the send had been accepted and the text cleared before the run failed.
 * *Try again* then meant retyping.
 *
 * The text goes back in the box only when the box is empty. Overwriting something
 * the user has since started typing would be a worse failure than the one this
 * fixes, so in that case the note says where the text actually is instead of
 * claiming something untrue.
 */
export interface ComposerRestore {
  readonly restore: boolean;
  readonly text: string;
  readonly note: string;
}

export function restoreComposerAfterRunFailure(
  failedPrompt: string,
  composerText: string,
): ComposerRestore {
  if (failedPrompt.trim() === '') {
    return {
      restore: false,
      text: composerText,
      note:
        'DSpatch has no record of the text for this attempt, so there is nothing ' +
        'to put back. Whatever the turn above shows is what it has.',
    };
  }
  if (composerText.trim() !== '') {
    return {
      restore: false,
      text: composerText,
      note:
        'Your message is kept in the conversation above. It has not been put back ' +
        'in the box, because you have text in there already and overwriting it ' +
        'would lose more than it saved.',
    };
  }
  return {
    restore: true,
    text: failedPrompt,
    note:
      'The message that failed has been put back in the box, so sending it again ' +
      'does not mean retyping it. Everything already received is still in the ' +
      'conversation above.',
  };
}

export function connectionRetryPlan(automaticAttemptsSoFar: number): RetryPlan {
  const delay = CONNECTION_RETRY_DELAYS_MS[automaticAttemptsSoFar];
  if (delay === undefined) {
    return {
      retry: false,
      delayMs: null,
      note:
        `The connection check failed ${String(automaticAttemptsSoFar + 1)} times, ` +
        'including ' +
        `${String(CONNECTION_RETRY_DELAYS_MS.length)} automatic retries. DSpatch ` +
        'has stopped retrying: past this point a retry loop only hides the problem. ' +
        'Check it again when you want to. Only the check is repeated; no message or ' +
        'command is ever retried on its own.',
    };
  }
  return {
    retry: true,
    delayMs: delay,
    note:
      `Checking again in ${String(Math.round(delay / 1000))} s ` +
      `(retry ${String(automaticAttemptsSoFar + 1)} of ` +
      `${String(CONNECTION_RETRY_DELAYS_MS.length)}). Only the check is repeated; ` +
      'no message or command is ever retried on its own.',
  };
}
