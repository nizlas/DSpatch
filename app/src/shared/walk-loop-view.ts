/**
 * DSP-190: what a window that follows a walk preparation holds, and how an event reaches it.
 *
 * The graph side is the run view the graph editor already reads (`loop-run-view.ts`): the
 * run's announcement, the engine's journal folded by `applyRunEvent`, and the ending. The
 * activity side is the walk loop's own list (`walk-method.ts`), addressed by run, node visit
 * and turn and numbered in sequence. Both travel one addressed channel from the host to every
 * window over the review, and a window opened halfway through asks for the state so far once
 * and applies only what comes after it. Nothing here starts, stops or repeats anything: a
 * window that looks is a window that looks.
 */

import { applyRunEvent, type LoopRunEvent, type RunView } from './loop-run-view';
import type { WalkLoopActivity, WalkLoopSummary } from './walk-method';

/** The channel the host's run events for a review travel on; the review preload repeats it. */
export const REVIEW_PAIR_RUN_EVENT = 'dspatch:review-pair-run-event';

/** One addressed thing that happened in a review's walk loop run. */
export type WalkLoopRunEvent =
  | { readonly key: string; readonly jobId: string; readonly event: LoopRunEvent }
  | { readonly key: string; readonly jobId: string; readonly activity: WalkLoopActivity };

/** The run so far, as a window opening or reopening is handed it. */
export interface WalkLoopRunSnapshot {
  readonly jobId: string;
  /** `null` before the run has announced itself (the revision folder is still being written). */
  readonly view: RunView | null;
  readonly activity: readonly WalkLoopActivity[];
  /** The run's summary once it has ended; `null` while it runs or when none was kept. */
  readonly summary: WalkLoopSummary | null;
  /** Served from the running job: events will follow. Otherwise read from the run's files. */
  readonly live: boolean;
  /** What this snapshot cannot show, in plain sentences; empty when it shows everything kept. */
  readonly limitations: readonly string[];
}

/** What a window holds of the run it follows. */
export interface WalkLoopFollowState {
  readonly view: RunView | null;
  readonly activity: readonly WalkLoopActivity[];
}

/** Whether this event is about the review and job the window follows. */
export function runEventBelongsTo(event: WalkLoopRunEvent, key: string, jobId: string): boolean {
  return event.key === key && event.jobId === jobId;
}

/**
 * Fold one event into what the window holds.
 *
 * Returns **the same object** when nothing changed: an event already held (its `seq` is not
 * past the last one), a journal entry already in the view, or one addressed to another run.
 */
export function applyWalkLoopRunEvent(state: WalkLoopFollowState, event: WalkLoopRunEvent): WalkLoopFollowState {
  if ('activity' in event) {
    const last = state.activity.at(-1);
    if (last !== undefined && event.activity.seq <= last.seq) {
      return state;
    }
    if (state.view !== null && event.activity.runId !== state.view.run.runId) {
      return state;
    }
    return { ...state, activity: [...state.activity, event.activity] };
  }
  const inner = event.event;
  if (inner.kind === 'started') {
    if (state.view !== null && state.view.run.runId === inner.run.runId) {
      return state;
    }
    return { view: { run: inner.run, entries: [], ended: false, status: null, note: '', steps: [], terminalNodeId: null }, activity: state.activity.filter((entry) => entry.runId === inner.run.runId) };
  }
  if (inner.kind === 'journal' && state.view !== null && state.view.entries.some((entry) => entry.seq === inner.entry.seq)) {
    return state;
  }
  const view = applyRunEvent(state.view, inner);
  return view === state.view ? state : { ...state, view };
}

/** The window's state from a snapshot: what the host folded, taken as it is. */
export function followStateFrom(snapshot: WalkLoopRunSnapshot): WalkLoopFollowState {
  return { view: snapshot.view, activity: snapshot.activity };
}
