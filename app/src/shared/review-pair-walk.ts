/**
 * A walk window's hunk decisions, read from and written to its revision pair's record
 * (DSP-150).
 *
 * A walk shows a hunk and lets the reviewer accept or exempt it. Since Niclas's decision
 * of 28 October 2026 the diff window and every walk over the same pair share one record
 * of line decisions, so a change several walks pass counts once. This module is the
 * translation: a hunk decision becomes a decision over the hunk's changed lines, and the
 * walk's existing views read a hunk as accepted or exempted when every changed line of
 * it is. A hunk only partly decided reads as remaining there; the diff window shows it
 * line by line.
 */

import type { DiffFile, DiffHunk, ReviewDecision, RevisionPair } from './review-model';
import { isDelegatedApproval, lineStatusOf, type LineRange, type PairRecord } from './review-pair';

/** The changed lines of a hunk as ranges: its deletions at From, its additions at To. */
export function hunkRanges(hunk: DiffHunk): readonly LineRange[] {
  const ranges: LineRange[] = [];
  if (hunk.baseCount > 0) {
    ranges.push({ kind: 'lines', side: 'base', path: hunk.path, start: hunk.baseStart, end: hunk.baseStart + hunk.baseCount - 1 });
  }
  if (hunk.targetCount > 0) {
    ranges.push({ kind: 'lines', side: 'target', path: hunk.path, start: hunk.targetStart, end: hunk.targetStart + hunk.targetCount - 1 });
  }
  return ranges;
}

/**
 * The outcome over every changed line of a hunk, when it is one, by the one rule of what is
 * reviewed (Niclas's decision of 30 October 2026): each line reviewed by the person or
 * approved in a review the person delegated makes the hunk reviewed; each line exempted
 * makes it exempted. Who reviewed is kept: the agents and the jobs of their mandates.
 */
function hunkOutcome(
  hunk: DiffHunk,
  record: PairRecord,
): { readonly op: 'manual' | 'exempt'; readonly reason: string; readonly at: string; readonly agents: readonly string[]; readonly jobs: readonly string[]; readonly person: boolean } | null {
  let op: 'manual' | 'exempt' | null = null;
  let reason = '';
  let at = '';
  let person = false;
  const agents = new Set<string>();
  const jobs = new Set<string>();
  for (const range of hunkRanges(hunk)) {
    for (let line = range.start; line <= range.end; line += 1) {
      const status = lineStatusOf({ side: range.side, path: range.path, line }, record);
      const decision = status.decision;
      const approvals = status.agent.filter(isDelegatedApproval);
      const lineOp: 'manual' | 'exempt' | null = decision !== null && decision.op !== 'clear' ? decision.op : approvals.length > 0 ? 'manual' : null;
      if (lineOp === null || (op !== null && op !== lineOp)) {
        return null;
      }
      op = lineOp;
      if (decision !== null && decision.op !== 'clear') {
        person = true;
        reason = reason === '' ? decision.reason : reason;
        at = decision.at > at ? decision.at : at;
      } else {
        for (const review of approvals) {
          agents.add(review.reviewer === '' ? 'Agent' : review.reviewer);
          jobs.add(review.jobId ?? '');
          at = review.recordedAt > at ? review.recordedAt : at;
        }
      }
    }
  }
  return op === null ? null : { op, reason, at, agents: [...agents], jobs: [...jobs], person };
}

/**
 * The walk's decisions as its existing views expect them, derived from the pair record.
 *
 * Each is a person's decision (`human`): an agent review is shown in the diff window and
 * never turned into a hunk acceptance here.
 */
export function hunkDecisionsFromPair(files: readonly DiffFile[], record: PairRecord, revisions: RevisionPair): readonly ReviewDecision[] {
  const decisions: ReviewDecision[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      const outcome = hunkOutcome(hunk, record);
      if (outcome !== null) {
        decisions.push({
          id: `pair-${hunk.id}`,
          scope: { kind: 'hunk', path: hunk.path, hunkId: hunk.id },
          outcome: outcome.op === 'manual' ? 'accepted' : 'exempted',
          reason: outcome.reason,
          // Shown, never saved from here: the pair record keeps the decisions and approvals.
          by: outcome.agents.length > 0 && !outcome.person ? { kind: 'agent-delegated', adapterId: outcome.agents.join(', '), mandate: outcome.jobs.join(', ') } : { kind: 'human' },
          at: outcome.at,
          revisions,
        });
      }
    }
  }
  return decisions;
}

/** A walk's hunk decision as a decision over lines in the pair record. */
export function pairOpFor(outcome: ReviewDecision['outcome']): 'manual' | 'exempt' | 'clear' {
  return outcome === 'accepted' ? 'manual' : outcome === 'exempted' ? 'exempt' : 'clear';
}
