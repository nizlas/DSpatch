/**
 * The walk window's "Delegate to agent" action: what its button says, whether it can be pressed,
 * and the short status and scope beside it. Pure, from the review's real state: the walk's latest
 * delegated review and the person's decision about it, any other delegated review of the change
 * that is running (the host runs one at a time), and whether a start was just asked for.
 *
 * The action delegates the whole walk the step belongs to, never the step alone, so the scope line
 * names the walk and its changed lines. A finished delegation is not an accepted one: the status
 * says whether the person has decided about the agent's assessment.
 */
import type { AgentJobState, PairMark } from './review-pair';

export interface WalkDelegationInput {
  /** The review has its agent connection in this window. */
  readonly available: boolean;
  readonly walkTitle: string;
  /** The walk's changed lines, and those without the person's decision or an accepted assessment. */
  readonly lineCount: number;
  readonly remainingCount: number;
  /** The walk's latest delegated review, with the person's decision about it. */
  readonly job: { readonly state: AgentJobState; readonly decision: PairMark['op'] | null } | null;
  /** Another delegated review of this change is running, which keeps this one from starting. */
  readonly otherRunning: boolean;
  /** A start has been asked for and has not answered yet. */
  readonly starting: boolean;
  /** The person is choosing the lines and the agent. */
  readonly choosing: boolean;
}

export interface WalkDelegationAction {
  readonly label: string;
  readonly enabled: boolean;
  /** Why the button cannot be pressed, or what the latest delegation came to; always words, never colour alone. */
  readonly status: string | null;
  /** What pressing it delegates. */
  readonly scope: string;
  /** For the button's data attribute and for tests. */
  readonly state: 'unavailable' | 'no-lines' | 'starting' | 'running' | 'stopping' | 'other-running' | 'choosing' | 'delegated' | 'ready';
}

export const DELEGATE_LABEL = 'Delegate to agent';

export function walkDelegationAction(input: WalkDelegationInput): WalkDelegationAction {
  const lines = (count: number): string => `${String(count)} changed line${count === 1 ? '' : 's'}`;
  const scope =
    input.lineCount === 0
      ? `Scope: the whole walk “${input.walkTitle}”, which changes no lines.`
      : `Scope: the whole walk “${input.walkTitle}”, ${lines(input.lineCount)}` +
        (input.remainingCount === input.lineCount
          ? ', none decided yet.'
          : input.remainingCount === 0
            ? ', each with your decision or an assessment you accepted.'
            : `, ${String(input.remainingCount)} still without your decision.`);
  const off = (state: WalkDelegationAction['state'], label: string, status: string): WalkDelegationAction => ({ label, enabled: false, status, scope, state });
  if (!input.available) {
    return off('unavailable', DELEGATE_LABEL, 'Not available: this window has no agent connection for the review.');
  }
  if (input.lineCount === 0) {
    return off('no-lines', DELEGATE_LABEL, 'Not available: this walk has no changed lines to review.');
  }
  if (input.starting) {
    return off('starting', 'Starting delegation…', 'Asking the agent to start.');
  }
  if (input.job?.state === 'running') {
    return off('running', 'Delegation in progress…', 'The agent is reviewing this walk. Its report appears under Review.');
  }
  if (input.job?.state === 'cancelling') {
    return off('stopping', 'Stopping delegation…', 'The agent is being stopped.');
  }
  if (input.otherRunning) {
    return off('other-running', DELEGATE_LABEL, 'Not available now: another delegated review of this change is running, and one runs at a time.');
  }
  if (input.choosing) {
    return { label: DELEGATE_LABEL, enabled: false, status: 'Choose the lines and the agent below.', scope, state: 'choosing' };
  }
  if (input.job?.state === 'done') {
    const decided =
      input.job.decision === 'accept-agent'
        ? 'You accepted the agent’s assessment.'
        : input.job.decision === 'reject-agent'
          ? 'You rejected the agent’s assessment.'
          : 'The agent’s assessment is under Review and awaits your decision.';
    return { label: 'Already delegated · Delegate again…', enabled: true, status: decided, scope, state: 'delegated' };
  }
  const before =
    input.job?.state === 'failed'
      ? 'The last delegation of this walk failed.'
      : input.job?.state === 'cancelled'
        ? 'The last delegation of this walk was stopped.'
        : input.job?.state === 'unknown'
          ? 'How the last delegation of this walk ended is not known.'
          : null;
  return { label: DELEGATE_LABEL, enabled: true, status: before, scope, state: 'ready' };
}
