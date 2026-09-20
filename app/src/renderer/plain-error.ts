/**
 * How an error a person meets reads: one sentence first, the rest on request.
 *
 * DSP-64, and INTERACTION_MODEL §9's "diagnostics behind details rather than above
 * the conversation". Niclas asked for this after meeting a refusal that was
 * correct, accurate, and silent about what to do:
 *
 *     Refusing to delete C:\Users\…\duration-repo: it is not empty and has no
 *     .dspatch-experiment file, so it was not generated here and may be someone's
 *     work.
 *
 * **This is presentation only.** §5's honesty rules are unchanged by it, and three
 * of them constrain every line below:
 *
 * 1. **No refusal becomes vaguer in the name of being shorter.** The headline is
 *    the failure's **own first sentence, verbatim** — never a summary written here
 *    and never truncated with an ellipsis. Shortening by rewriting is how a
 *    refusal quietly stops saying what it refused.
 * 2. **An unknown stays unknown.** Nothing here adds a cause, a certainty or a
 *    promise the failure did not make. `nextStep` says what the user can do; when
 *    there is nothing useful to say, it says that instead of inventing one.
 * 3. **Nothing is thrown away.** Everything the failure carried — the whole
 *    message, the longer explanation, the IPC channel, the untouched raw text — is
 *    in `detail`, one labelled line each. Behind a disclosure is not the same as
 *    gone.
 *
 * The failure to design against is an error that is either too short to act on or
 * too long to read. The long explanations in `recovery.ts` are the second kind:
 * `session-holds-a-run` is over a thousand characters of measured detail, all of it
 * worth keeping and none of it a first line. That text is now `detail`, and the
 * short sentence beside the headline comes from {@link SHORT_NEXT_STEP}.
 */

import type { BridgeFailure, FailureKind } from './recovery';

/** One labelled piece of technical detail, shown only when asked for. */
export interface ErrorDetailLine {
  readonly label: string;
  readonly value: string;
}

export interface PlainError {
  /** The failure's own first sentence. Verbatim, never rewritten or truncated. */
  readonly headline: string;
  /**
   * What the person can do, in one short sentence, or `''` when nothing specific
   * can be said. Empty rather than filled with reassurance.
   */
  readonly nextStep: string;
  /** Everything else, for the disclosure. Never empty: the full message is here. */
  readonly detail: readonly ErrorDetailLine[];
  /** Whether the message said more than the headline shows. */
  readonly hasMoreThanHeadline: boolean;
}

/**
 * The short "what you can do" line for each kind of failure.
 *
 * Deliberately one sentence each, and deliberately about the **action**: the
 * reason, the measurements and the caveats are in the full text below the
 * disclosure, where they can be read without being in the way. `other` is the
 * unclassified case and says only what is actually known — that the text is kept
 * and a retry is a new attempt — because DSpatch does not know what went wrong.
 */
export const SHORT_NEXT_STEP: Record<FailureKind, string> = {
  'refused-folder':
    'Nothing was opened or changed. Choose a different folder.',
  'refused-generated-folder':
    'Nothing in that folder was touched. Open the project you want, or use an empty folder.',
  'needs-acknowledgement':
    'An earlier attempt has no known outcome; confirming it starts a new one.',
  connection:
    'The provider could not be reached. Nothing was sent twice — check the connection again.',
  'session-holds-a-run':
    'This provider session is holding a run. Continuing in a new one is the way out.',
  'nothing-open': 'Open a project first.',
  other: 'Your text is kept. Trying again starts a new attempt.',
};

/**
 * Split off the first sentence.
 *
 * A boundary is a `.`, `!` or `?` followed by whitespace and then something that
 * starts a sentence. The whitespace requirement is what keeps `.dspatch-experiment`
 * and `C:\x\file.txt` in one piece, and it is why the refusal above survives
 * whole — which is the property that matters most here.
 *
 * If no boundary is found the whole message is the headline. A long single
 * sentence is shown in full rather than cut: a truncated refusal is exactly the
 * vagueness rule 1 forbids, and a sentence is the smallest unit that can still be
 * true.
 */
export function firstSentence(message: string): string {
  const text = message.trim();
  const boundary = /[.!?](?=\s+["'`(\[]?[A-Z0-9])/.exec(text);
  if (boundary === null || boundary.index < 1) {
    return text;
  }
  return text.slice(0, boundary.index + 1);
}

/**
 * What the window shows for a failure, and what it keeps for the disclosure.
 *
 * `detail` always carries the full message, even when the headline is the whole of
 * it. Duplication is the cheap half of the bargain; a reader opening the details
 * and finding the message missing from them is the expensive half.
 */
export function describePlainly(failure: BridgeFailure): PlainError {
  const headline = firstSentence(failure.message);
  const detail: ErrorDetailLine[] = [
    { label: 'What DSpatch reported, in full', value: failure.message },
  ];
  if (failure.actionNote.trim() !== '' && failure.actionNote.trim() !== headline) {
    detail.push({ label: 'What this means and what it does not', value: failure.actionNote });
  }
  if (failure.channel !== null) {
    detail.push({
      label: 'Reported over',
      value:
        `${failure.channel}. The message above is the failure's own words: DSpatch ` +
        "removed the transport's wrapping from it.",
    });
  }
  if (failure.raw.trim() !== failure.message.trim()) {
    detail.push({ label: 'Exactly as it arrived', value: failure.raw });
  }
  return {
    headline,
    nextStep: SHORT_NEXT_STEP[failure.kind],
    detail,
    hasMoreThanHeadline: headline.trim() !== failure.message.trim(),
  };
}
