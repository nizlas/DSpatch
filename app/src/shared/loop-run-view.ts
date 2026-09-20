/**
 * What the graph view shows while a run is happening, and how an event reaches it.
 *
 * DSP-28 #3 and #4. There is one rule here and everything else follows from it:
 * **the marking is a reading of the run's own journal, never a second opinion about
 * it.** `loop-run.ts` already writes one entry per node entered, produced, awaited
 * and faulted; `runOutcomeFrom` in `loop-record.ts` already decides the one outcome
 * a run has. This module adds no third derivation of either. It turns entries into
 * "which box is lit" and nothing more, so a finished or cancelled step cannot keep
 * looking active — that would be a state model of its own, disagreeing with the
 * record, which is the defect DSP-26 #1 exists to prevent.
 *
 * **Addressing.** A window can be opened halfway through a run, two windows can be
 * open at once, and a user can cancel one run and start another while entries from
 * the first are still in flight. So an event is addressed to a run rather than sent
 * to whichever window asked for it: `runId` *and* `graphVersionId` must both match
 * what the view is watching, or the event is dropped and the view is returned
 * unchanged. Both, because a run id says which walk and the graph version says
 * which drawing, and a view that accepted one without the other could light a node
 * in a picture that never contained it.
 */

import type { RunJournalEntry, RunStatus } from './loop-run';

/**
 * How a node looks while a run walks the graph.
 *
 * Five, not four. The card names waiting, active, finished and failed; `stopped` is
 * here because a node that was entered and never produced anything, in a run that
 * has since ended, is none of those — and calling it finished or failed would be a
 * statement nobody measured. `not-reached` is the ordinary state of most of the
 * drawing and carries no mark at all.
 *
 * None of these is a verdict about the user's project. That is the run's outcome,
 * it is computed once by `runOutcomeFrom`, and nothing here recomputes it.
 */
export type NodeRunState = 'not-reached' | 'waiting' | 'active' | 'finished' | 'failed' | 'stopped';

/**
 * The mark each state carries, and the class that draws it.
 *
 * DSP-28 #3 in one table: every state that means something has a **word** as well
 * as a class, so the difference between waiting, active, finished and failed
 * survives a person who cannot see, does not want, or has switched off the pulse.
 * Motion is added by the stylesheet on top of `active`; it is never what tells the
 * states apart.
 */
export const NODE_RUN_STATE_MARKS: Readonly<
  Record<NodeRunState, { readonly mark: string; readonly label: string; readonly className: string }>
> = {
  'not-reached': {
    mark: '',
    label: 'not reached in this run',
    className: 'node-run-not-reached',
  },
  waiting: {
    mark: 'waiting',
    label: 'waiting for a person before the run can continue',
    className: 'node-run-waiting',
  },
  active: {
    mark: 'running',
    label: 'running now',
    className: 'node-run-active',
  },
  finished: {
    mark: 'done',
    label: 'entered and produced its result',
    className: 'node-run-finished',
  },
  failed: {
    mark: 'failed',
    label: 'reported a runtime fault',
    className: 'node-run-failed',
  },
  stopped: {
    mark: 'stopped',
    label: 'entered, and the run ended before it produced anything',
    className: 'node-run-stopped',
  },
};

/** Which run, and which drawing. Both are needed to address an event. */
export interface LoopRunIdentity {
  readonly runId: string;
  readonly graphVersionId: string;
}

/**
 * The graph version a run is walking, announced once when it starts.
 *
 * `graphText` is carried rather than a path, because DSP-28 #2 asks for *exactly
 * the version being executed* and the author may have edited the drawing since. The
 * text is the bytes that were validated and walked; `graphVersionId` is the content
 * hash of those bytes, so a window that was not the one to press Run can still show
 * the right picture.
 *
 * A dry run walks the canvas in the window and reads nothing from disk, so it has
 * no content hash to offer. It says so in `graphVersionId` rather than inventing
 * one — see {@link UNVERSIONED_CANVAS}.
 */
export interface LiveRunAnnouncement extends LoopRunIdentity {
  readonly graphId: string;
  readonly graphName: string;
  readonly binding: LoopRunBinding;
  readonly graphText: string;
  readonly startedAtUtc: string;
}

export type LoopRunBinding = 'editor-loop' | 'chat-loop' | 'canvas-dry-run';

/**
 * The version id of a graph that was never read from a file.
 *
 * A dry run walks the drawing in front of the author, unsaved edits included. There
 * is nothing to hash the way `graphVersionIdFor` hashes the bytes a live run read,
 * and a hash computed here would be a different kind of claim wearing the same name.
 * Addressing still works because a run id and a version id must *both* match, and
 * every press produces a new run id.
 */
export const UNVERSIONED_CANVAS = 'canvas-unversioned';

/** One addressed thing that happened to a run. */
export type LoopRunEvent =
  | { readonly kind: 'started'; readonly run: LiveRunAnnouncement }
  | {
      readonly kind: 'journal';
      readonly runId: string;
      readonly graphVersionId: string;
      readonly entry: RunJournalEntry;
    }
  | {
      readonly kind: 'ended';
      readonly runId: string;
      readonly graphVersionId: string;
      readonly status: RunStatus | null;
      readonly note: string;
    };

/** What the view holds: one run, the drawing it is walking, and its journal. */
export interface RunView {
  readonly run: LiveRunAnnouncement;
  readonly entries: readonly RunJournalEntry[];
  readonly ended: boolean;
  /** The runner's own status when it ended, or `null` while it is still walking. */
  readonly status: RunStatus | null;
  readonly note: string;
}

export function runViewFor(run: LiveRunAnnouncement): RunView {
  return { run, entries: [], ended: false, status: null, note: '' };
}

/** The run id and graph version of an event, or `null` for one that has neither. */
export function addressOf(event: LoopRunEvent): LoopRunIdentity {
  return event.kind === 'started'
    ? { runId: event.run.runId, graphVersionId: event.run.graphVersionId }
    : { runId: event.runId, graphVersionId: event.graphVersionId };
}

/**
 * Whether an event is about the run this view is watching.
 *
 * Both fields, and no partial credit. This is the whole of DSP-28 #4's ordering
 * clause: an entry from a run the user cancelled ten seconds ago carries that run's
 * id, so it fails here and never reaches the drawing on screen.
 */
export function eventBelongsTo(view: RunView | null, event: LoopRunEvent): boolean {
  if (view === null) {
    return false;
  }
  const address = addressOf(event);
  return (
    address.runId === view.run.runId && address.graphVersionId === view.run.graphVersionId
  );
}

/**
 * Fold one event into the view.
 *
 * Returns **the same object** when the event is not addressed to this run, so a
 * stale entry is not merely invisible but literally does not change what the window
 * holds — which is a property a caller can assert, and a React state setter can
 * skip re-rendering on.
 */
export function applyRunEvent(view: RunView | null, event: LoopRunEvent): RunView | null {
  if (!eventBelongsTo(view, event)) {
    return view;
  }
  const current = view as RunView;
  if (event.kind === 'started') {
    // The announcement for the run already being watched. Nothing to add: the view
    // was built from it, and re-applying it must not clear the entries so far.
    return current;
  }
  if (event.kind === 'ended') {
    return { ...current, ended: true, status: event.status, note: event.note };
  }
  return { ...current, entries: [...current.entries, event.entry] };
}

/**
 * Which box is lit, and how.
 *
 * A single pass over the run's own entries, latest statement about a node winning,
 * because a node entered a second time is running again. Nothing is inferred from
 * anything but these entries — no timers, no "it has been a while", no guess.
 */
export function nodeRunStates(view: RunView | null): ReadonlyMap<string, NodeRunState> {
  const states = new Map<string, NodeRunState>();
  if (view === null) {
    return states;
  }
  for (const entry of view.entries) {
    const nodeId = entry.nodeId;
    if (nodeId === undefined) {
      continue;
    }
    switch (entry.kind) {
      case 'node-entered':
        states.set(nodeId, 'active');
        break;
      case 'node-produced':
        states.set(nodeId, 'finished');
        break;
      case 'awaiting-human':
      // DSP-51: a gate holding a command in front of a person is waiting on a
      // person, which is what this state means. The answer puts it back to work.
      case 'waiting-for-person':
        states.set(nodeId, 'waiting');
        break;
      case 'person-answered':
        states.set(nodeId, 'active');
        break;
      case 'runtime-fault':
        states.set(nodeId, 'failed');
        break;
      default:
        // `edge-taken` and `limit-reached` name a node without changing what that
        // node is doing: a spent bound is the run's business, not the step's.
        break;
    }
  }
  if (!view.ended) {
    return states;
  }
  // Nothing is running once the run has ended. A terminal is entered and never
  // produces, so on a completed run it reads as finished; anything else still
  // marked active was cut off, and `stopped` says that rather than claiming an
  // outcome the run never reported for it.
  for (const [nodeId, state] of states) {
    if (state === 'active') {
      states.set(nodeId, view.status === 'completed' ? 'finished' : 'stopped');
    }
  }
  return states;
}

export function nodeRunStateFor(
  states: ReadonlyMap<string, NodeRunState>,
  nodeId: string,
): NodeRunState {
  return states.get(nodeId) ?? 'not-reached';
}

/** Edge ids the run has actually taken, from the same entries and no other source. */
export function edgesTakenIn(view: RunView | null): ReadonlySet<string> {
  const taken = new Set<string>();
  for (const entry of view?.entries ?? []) {
    if (entry.kind === 'edge-taken' && entry.edgeId !== undefined) {
      taken.add(entry.edgeId);
    }
  }
  return taken;
}

/**
 * Whether the drawing on screen may be edited.
 *
 * DSP-28 #2: a graph you can edit while it runs is a graph that no longer describes
 * the run. Locked while a view is open at all, including after the run has ended,
 * because what is on screen then is still that run's drawing and not the author's
 * working copy of it — leaving the view is what returns the author to editing, and
 * that is a deliberate act rather than a side effect of the run stopping.
 */
export function viewIsLocked(view: RunView | null): boolean {
  return view !== null;
}

/** One sentence saying which run is on screen, which drawing, and whether it is live. */
export function describeRunView(view: RunView): string {
  const version =
    view.run.graphVersionId === UNVERSIONED_CANVAS
      ? 'the unsaved drawing in this window, which was never read from a file and so has no content version'
      : `graph version ${view.run.graphVersionId}`;
  const state = view.ended
    ? `The run has ended${view.status === null ? '' : ` (${view.status})`}.`
    : 'The run is still walking.';
  return (
    `Watching run ${view.run.runId} — ${view.run.graphName} as ${version}. ${state} ` +
    `This is the version that ${view.ended ? 'ran' : 'is running'}, so it is locked: ` +
    `leave the run view to edit your own drawing again. Leaving changes nothing about the run.`
  );
}
