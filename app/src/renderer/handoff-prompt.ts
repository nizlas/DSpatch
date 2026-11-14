/**
 * DSP-209 S5b: what the chat shows while a loop step's recommendation to continue
 * interactively is waiting for the person's answer.
 *
 * Pure, so it can be tested without a window. Every value comes from the control report's
 * `handoff` (S5a); nothing is inferred from the step's reply. The two choices are the only
 * actions, and each answer names the run and the visit it answers, so an answer meant for an
 * earlier recommendation cannot land on a later one (INTERACTION_MODEL §4.6).
 */

import type { HandoffAnswerAction, LoopControlOutcome, LoopControlReport } from '../shared/loop-control';

export interface HandoffChoiceView {
  readonly choice: HandoffAnswerAction['choice'];
  readonly label: string;
  readonly title: string;
  readonly answer: HandoffAnswerAction;
}

export interface HandoffPromptView {
  /** One short line: which step, and that it is asking. */
  readonly headline: string;
  /** The agent's own words, shown as quoted. */
  readonly reason: string;
  readonly choices: readonly HandoffChoiceView[];
}

/** The prompt, or `null` when nothing is waiting for an answer. */
export function handoffPromptView(report: LoopControlReport): HandoffPromptView | null {
  const pending = report.handoff;
  if (pending === undefined || report.runId === null || report.runId !== pending.runId) {
    return null;
  }
  const bound = { runId: pending.runId, visit: pending.visit };
  return {
    headline: `“${pending.nodeLabel}” recommends continuing interactively.`,
    reason: pending.reason,
    choices: [
      {
        choice: 'interactive',
        label: 'Continue interactively',
        title:
          'End the loop run here as handed over. DSpatch then sends the run’s mandate and what it ' +
          'did to the agent in this chat, once, and the work continues there; you do not type it again.',
        answer: { ...bound, choice: 'interactive' },
      },
      {
        choice: 'loop',
        label: 'Continue in the loop',
        title: 'Let this step carry on in the loop. It will not recommend this again in this run.',
        answer: { ...bound, choice: 'loop' },
      },
    ],
  };
}

/**
 * DSP-209 S6: whether `Use loop` stays ticked after a run settled. A run handed over to
 * interactive work unticks it, so the next ordinary message continues in the chat instead of
 * starting a new loop run unasked. Every other ending leaves the tick as the person set it.
 */
export function loopStaysTickedAfter(outcome: {
  readonly kind: string;
  readonly result?: { readonly status: string };
}): boolean {
  return !(outcome.kind === 'finished' && outcome.result?.status === 'handed-over');
}

/**
 * Send one answer, and what to show afterwards: the outcome's note when it was refused,
 * otherwise nothing, because the prompt goes away once the report no longer carries it.
 */
export async function sendHandoffAnswer(
  send: (answer: HandoffAnswerAction) => Promise<LoopControlOutcome>,
  choice: HandoffChoiceView,
): Promise<string | null> {
  try {
    const outcome = await send(choice.answer);
    return outcome.accepted ? null : outcome.note;
  } catch (error) {
    return `The answer could not be sent: ${error instanceof Error ? error.message : String(error)}`;
  }
}
