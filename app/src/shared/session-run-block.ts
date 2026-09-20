/**
 * Recognising the one refusal a restarted user actually hits.
 *
 * A provider session holds at most one run at a time. Two different layers say
 * so, in two different sentences, and report 008 measured that DSpatch was only
 * matching its own:
 *
 * 1. **DSpatch's own adapter guard** (`cursor-sdk-adapter.ts`), when this window
 *    started a run and has not seen it end:
 *
 *        Session "dsp-session-1" already has an active run (dsp-run-1). At most
 *        one run per session.
 *
 * 2. **Cursor's own refusal**, which is what a session that still holds an
 *    unfinished run from *before* a restart produces, quoted verbatim from
 *    report 008's measurement:
 *
 *        Cursor adapter operation "send" failed: UnknownAgentError: Agent
 *        agent-b8287ca0-… already has active run
 *
 * The difference is one word — `an` — and it made the guidance written for case 2
 * dead code for the whole of DSP-4. So the match lives here, once, used by both
 * the main process and the window, with both exact sentences in the tests.
 *
 * This is prose matching and it is a compromise. The provider's error carries a
 * class name and possibly a code, but only its *message* survives the trip to the
 * renderer through Electron's IPC rejection, so the window has nothing else to go
 * on. What is deliberately **not** decided from prose is *which* of the two cases
 * it is: the main process reads that from the adapter's own state
 * (`hasActiveRun`), because that is a fact rather than a sentence.
 */

/**
 * Whether this message says a session already holds a run.
 *
 * Both wordings, and nothing wider. `active run` on its own would also match a
 * sentence merely mentioning one, and a classifier that over-matches sends the
 * reader to the wrong recovery — the same trade-off `looksLikeConnectionTrouble`
 * makes in the other direction.
 */
export function saysSessionAlreadyHasARun(message: string): boolean {
  return /already has (?:an )?active run/i.test(message);
}
