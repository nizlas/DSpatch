/**
 * DSP-209 S21: a loop run's step reports as the chat shows them — one card per visit.
 *
 * Words and grouping only, from S16's {@link StepReport} and the replies the chat already
 * holds. Nothing here is stored, nothing is passed to a step, and nothing changes a reply:
 * the excerpt is a view of the text, cut mechanically, and **Full report** shows it whole.
 * A step card is never the run's report; S22's final card is that.
 *
 * Pure and shared: no Node built-ins.
 */

import type { StepAttention, StepReport } from './run-presentation';

/** The excerpt's length: the first block of the reply, cut at this many characters. */
export const STEP_EXCERPT_CHARS = 600;

/** A reply as the cards need it: the chat's `LoopAgentReply`, narrowed. */
export interface CardReply {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly text: string;
  readonly occurrence?: number;
  readonly sliceId?: string;
}

/**
 * The reply's first block (up to its first blank line), cut at {@link STEP_EXCERPT_CHARS}
 * characters, with its last whole `RESULT:` line added when the block does not hold it.
 * `cut` says the excerpt is not the whole reply, so **Full report** is worth offering.
 */
export function stepReportExcerpt(text: string): { readonly text: string; readonly cut: boolean } {
  const whole = text.trim();
  const block = whole.split(/\r?\n\s*\r?\n/)[0]?.trim() ?? '';
  const shortened = block.length > STEP_EXCERPT_CHARS ? `${block.slice(0, STEP_EXCERPT_CHARS).trimEnd()}…` : block;
  const resultLine =
    whole
      .split(/\r?\n/)
      .filter((line) => /^\s*\**RESULT:/.test(line))
      .pop()
      ?.trim() ?? null;
  const withResult = resultLine === null || shortened.includes(resultLine) ? shortened : `${shortened}\n\n${resultLine}`;
  return { text: withResult, cut: withResult !== whole };
}

/** "visit n", or "rework attempt n" for a rework arrival; from the run's own counts. */
export function visitWords(report: StepReport | null, reply: Pick<CardReply, 'occurrence'> | null): string | null {
  if (report !== null) {
    return report.visit.isRework
      ? `rework attempt ${String(report.visit.attempt)}`
      : `visit ${String(report.visit.occurrence)}`;
  }
  return reply?.occurrence === undefined ? null : `visit ${String(reply.occurrence)}`;
}

/** **Combined report** for the integrator by decision 47's rule, else **Step report**. Never the run's report. */
export function stepCardLabel(report: StepReport | null): 'Step report' | 'Combined report' {
  return report?.role === 'integrator' ? 'Combined report' : 'Step report';
}

/** The sub-goal as the heading shows it, marked as the agent's claim. */
export function subGoalWords(report: StepReport | null): string | null {
  const claim = report?.subGoal ?? null;
  return claim === null ? null : `sub-goal ${claim.id} — ${claim.title} (the agent’s claim)`;
}

/** The heading's parts in order: node, sub-goal where declared, visit or rework attempt. */
export function stepCardHeading(label: string, report: StepReport | null, reply: Pick<CardReply, 'occurrence'> | null): string {
  return [label, subGoalWords(report), visitWords(report, reply)].filter((part): part is string => part !== null).join(' · ');
}

/** What needs the person, in words shown on the card itself. */
export function attentionWords(attention: StepAttention | null): string | null {
  switch (attention) {
    case 'failure':
      return 'Needs attention: this step failed or was faulted.';
    case 'question':
      return 'Waiting for your answer.';
    case 'action':
      return 'Asks you to decide: continue in the loop or interactively.';
    case null:
      return null;
  }
}

/** The report for one reply, by its index among the turn's replies. */
export function reportForReply(reports: readonly StepReport[] | null, replyIndex: number): StepReport | null {
  return reports?.find((report) => report.replyIndex === replyIndex) ?? null;
}

/** A fan-out visit's own report (not a branch's), for the group's heading and attention. */
export function reportForVisit(reports: readonly StepReport[] | null, nodeId: string, occurrence: number | undefined): StepReport | null {
  return (
    reports?.find(
      (report) => report.sliceId === null && report.visit.nodeId === nodeId && (occurrence === undefined || report.visit.occurrence === occurrence),
    ) ?? null
  );
}

/**
 * Branch replies grouped by their fan-out visit, in reply order. A group is shown once,
 * where its first branch reply falls; its other replies are shown inside it, not again.
 */
export function branchReplyGroups(replies: readonly CardReply[]): ReadonlyMap<string, readonly number[]> {
  const groups = new Map<string, number[]>();
  replies.forEach((reply, index) => {
    if (reply.sliceId === undefined) {
      return;
    }
    const key = `${reply.nodeId}#${String(reply.occurrence ?? 0)}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return groups;
}

export function branchGroupKey(reply: CardReply): string | null {
  return reply.sliceId === undefined ? null : `${reply.nodeId}#${String(reply.occurrence ?? 0)}`;
}
