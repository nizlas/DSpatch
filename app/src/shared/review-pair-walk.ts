/**
 * A walk window's decisions, read from and written to its revision pair's record (DSP-150).
 *
 * Since Niclas's decision of 28 October 2026 the diff window and every walk over the same
 * pair share one record of line decisions, so a change several walks pass counts once and a
 * mark made in one window is seen in the others. This module is the translation.
 *
 * DSP-201 (Niclas, 12 November 2026): a walk's Accept, Exempt and Withdraw decide about
 * exactly the changed lines its marking covers, not the hunk around them. A decision is
 * written as marks over those lines with where it was made; what holds on a line is read
 * back line by line, so a hunk decided only in part reads as exactly that.
 */

import { stillHeld, type CodeLocation, type DiffFile, type HeldDecision, type HoldsAt, type ReviewDecision, type RevisionPair } from './review-model';
import { lineStatusOf, type LineRange, type PairMark, type PairRecord } from './review-pair';

/** Lines as the pair record keeps them. */
export function pairRanges(locations: readonly CodeLocation[]): readonly LineRange[] {
  return locations.map((location) => ({ kind: 'lines', side: location.side, path: location.path, start: location.start, end: location.end }));
}

function locationOf(range: LineRange): CodeLocation {
  return { path: range.path, side: range.side, start: range.start, end: range.end };
}

/**
 * What holds on a line in the pair record, by the one rule of what is reviewed (Niclas's
 * decision of 30 October 2026, as changed on 10 November 2026, DSP-193): the person's latest
 * decision over the line; else an assessment from a delegated review the person accepted. An
 * assessment not yet accepted holds nothing. A mark recorded before marks said where they were
 * made is one whose intended scope is not known (DSP-201): a walk's Accept then covered its
 * whole hunk, and the diff window's marks over the same lines look the same.
 */
export function pairHolds(record: Pick<PairRecord, 'marks' | 'agentReviews'>): HoldsAt {
  const cache = new Map<string, HeldDecision | null>();
  return (path, side, line) => {
    const key = `${side}\0${path}\0${String(line)}`;
    const known = cache.get(key);
    if (known !== undefined) {
      return known;
    }
    const status = lineStatusOf({ side, path, line }, record);
    let held: HeldDecision | null = null;
    const decision: PairMark | null = status.decision;
    if (decision !== null && (decision.op === 'manual' || decision.op === 'exempt') && decision.scope.kind === 'lines') {
      held = {
        id: decision.id,
        outcome: decision.op === 'manual' ? 'accepted' : 'exempted',
        by: { kind: 'human' },
        at: decision.at,
        reason: decision.reason,
        over: [locationOf(decision.scope)],
        scopeUncertain: decision.origin === undefined,
      };
    } else if (status.accepted.length > 0) {
      const agents = [...new Set(status.accepted.map((review) => (review.reviewer === '' ? 'Agent' : review.reviewer)))];
      const jobs = [...new Set(status.accepted.map((review) => review.jobId ?? ''))].sort();
      held = {
        id: `agent:${jobs.join(',')}`,
        outcome: 'accepted',
        by: { kind: 'agent-delegated', adapterId: agents.join(', '), mandate: jobs.join(', ') },
        at: status.accepted.reduce((latest, review) => (review.recordedAt > latest ? review.recordedAt : latest), ''),
        reason: '',
        over: status.accepted.map((review) => locationOf(review.scope)),
        scopeUncertain: false,
      };
    }
    cache.set(key, held);
    return held;
  };
}

/**
 * The walk's decisions as its coverage and history read them, derived from the pair record:
 * one exact decision per holding decision and file, over the changed lines it holds on. They
 * never overlap, so no line counts twice. Shown, never saved from here: the pair record keeps
 * the decisions and approvals.
 */
export function lineDecisionsFromPair(files: readonly DiffFile[], record: Pick<PairRecord, 'marks' | 'agentReviews'>, revisions: RevisionPair): readonly ReviewDecision[] {
  const holds = pairHolds(record);
  const found = new Map<string, { held: HeldDecision; path: string }>();
  for (const file of files) {
    for (const hunk of file.hunks) {
      const sides = [
        ['base', hunk.baseStart, hunk.baseCount],
        ['target', hunk.targetStart, hunk.targetCount],
      ] as const;
      for (const [side, start, count] of sides) {
        for (let line = start; line < start + count; line += 1) {
          const held = holds(hunk.path, side, line);
          if (held !== null) {
            found.set(`${held.id}\0${hunk.path}`, { held, path: hunk.path });
          }
        }
      }
    }
  }
  return [...found.values()].map(({ held, path }) => {
    const ranges = stillHeld(held, holds).filter((location) => location.path === path);
    return {
      id: `pair-${held.id}-${path}`,
      scope: { kind: 'lines', path, ranges: ranges.map(({ side, start, end }) => ({ side, start, end })) },
      outcome: held.outcome,
      reason: held.reason,
      by: held.by,
      at: held.at,
      revisions,
    };
  });
}

/** A walk's decision as a decision over lines in the pair record. */
export function pairOpFor(outcome: ReviewDecision['outcome']): 'manual' | 'exempt' | 'clear' {
  return outcome === 'accepted' ? 'manual' : outcome === 'exempted' ? 'exempt' : 'clear';
}

