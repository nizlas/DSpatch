/**
 * DSP-209 S7: the words the chat uses for DSpatch's recap of what loop runs did.
 *
 * Short and action-oriented: the pending line says what the next message will carry and
 * that it can be removed; nothing opens on its own, and the exact text sits behind a
 * disclosure. Pure, so the wording is tested without a window.
 */

/** Beside the composer, while a recap waits for the next message. */
export function loopRecapPendingLine(runCount: number): string {
  return runCount === 1
    ? 'Your next message also tells the agent what the loop run did. DSpatch sends this once.'
    : `Your next message also tells the agent what ${String(runCount)} loop runs did. DSpatch sends this once.`;
}

/** The disclosure's summary, before sending and on the message that carried it. */
export function loopRecapSentLine(characters: number): string {
  return `DSpatch's recap of what the loop did (${String(characters)} characters)`;
}
