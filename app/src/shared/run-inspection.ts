/**
 * Inspecting a loop run, apart from editing its graph (Niclas, 15 November 2026).
 *
 * The loop editor has two modes. **Edit** is the drawing as the person is changing it.
 * **Run** is one run on the drawing it walked: the graph text the run loaded, never the
 * one being edited since, with that run's states, endings and step output. This module is
 * the pure part of Run: a view built from a saved run record, and what a node's state
 * means in words. Which graph a record belongs to is decided by the main process, which can
 * hash a file (`graphVersionIdFor`); a record whose graph cannot be established is shown as
 * such, never on today's graph.
 *
 * Reading only. Nothing here starts, stops or repeats work, and nothing is written.
 *
 * Pure and shared: no Node built-ins.
 */

import type { NodeKind } from './loop-graph';
import type { ParsedRunRecord } from './loop-record';
import { NODE_RUN_STATE_MARKS, type EndingMark, type NodeRunState, type RunView } from './loop-run-view';

/** Which mode the loop editor is in. */
export type EditorMode = 'edit' | 'run';

/** What moves the editor between its modes. */
export type EditorModeEvent =
  /** A run began walking. */
  | 'run-started'
  /** The run ended, or the Ready offer replaced it: the view stays where it is. */
  | 'run-ended'
  /** The person pressed Show latest run. */
  | 'show-latest-run'
  /** The person pressed Back to editing (or Edit this step). */
  | 'back-to-editing';

/**
 * The mode after an event. A run starting shows it; its ending leaves the window where it is,
 * so a finished run stays on screen until the person leaves it; the two buttons go where they
 * say. Nothing else moves the mode, and no mode change starts, stops or deletes anything.
 */
export function editorModeAfter(mode: EditorMode, event: EditorModeEvent): EditorMode {
  switch (event) {
    case 'run-started':
    case 'show-latest-run':
      return 'run';
    case 'back-to-editing':
      return 'edit';
    case 'run-ended':
      return mode;
  }
}

/** Where the graph a recorded run is drawn on came from. */
export type RunGraphSource =
  /** The copy saved beside the record when the run started (`<runId>/graph.json`). */
  | 'saved-with-run'
  /** The loop's graph file, unchanged since the run: its hash is the run's `graphVersionId`. */
  | 'unchanged-file';

/** The latest recorded run of a loop, as the main process found it after a restart. */
export type RecordedRunLookup =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'found';
      readonly runId: string;
      readonly mandate: string;
      readonly startedAtUtc: string;
      /** The run on its own graph, or `null` when that graph cannot be established. */
      readonly view: RunView | null;
      readonly graphSource: RunGraphSource | null;
      /** Why there is no view, in words; `null` when there is one. */
      readonly problem: string | null;
    };

/**
 * A finished (or interrupted) run, rebuilt from its record onto the graph text it walked.
 * `null` when the record names no run. Its journal is the record's; live activity is not
 * recorded, so `steps` is empty and the step output window reads replies from the record.
 */
export function runViewFromRecord(record: ParsedRunRecord, graphText: string, graphName: string): RunView | null {
  const identity = record.identity;
  if (identity === null) {
    return null;
  }
  return {
    run: {
      runId: identity.runId,
      graphVersionId: identity.graphVersionId,
      graphId: identity.graphId,
      graphName,
      binding: 'chat-loop',
      graphText,
      startedAtUtc: identity.startedAtUtc,
      phase: 'running',
      ...(identity.conversationId === null ? {} : { conversationId: identity.conversationId }),
    },
    entries: record.journal,
    // A record without an ending is a run that was interrupted: shown as over, not as running.
    ended: true,
    status: record.ending?.status ?? null,
    note: record.ending === null ? 'This run has no recorded ending: it was interrupted.' : record.ending.note,
    steps: [],
    terminalNodeId: record.ending?.terminalNodeId ?? null,
  };
}

/** A node's state in the run shown, as the Run panel says it. */
export interface RunNodeStatus {
  /** One or two words: "Done", "Did not run", "Skipped", "Ending reached", … */
  readonly word: string;
  readonly detail: string;
}

export function runNodeStatus(input: {
  readonly kind: NodeKind;
  readonly state: NodeRunState | undefined;
  readonly ending: EndingMark | null;
  readonly runEnded: boolean;
}): RunNodeStatus {
  const { kind, state, ending, runEnded } = input;
  if (kind === 'terminal') {
    if (ending === 'success') {
      return { word: 'Ending reached', detail: 'The run ended here, and the graph declares this ending a success.' };
    }
    if (ending === 'reached') {
      return { word: 'Ending reached', detail: 'The run ended here.' };
    }
    return runEnded
      ? { word: 'Ending not reached', detail: 'The run did not end here.' }
      : { word: 'Not reached yet', detail: 'The run has not got here.' };
  }
  if (state === 'skipped') {
    return { word: 'Skipped', detail: 'The route the run took passed this step by on purpose; the run journal says why.' };
  }
  if (state === undefined || state === 'not-reached' || state === 'ready') {
    return runEnded
      ? { word: 'Did not run', detail: 'The run never reached this step.' }
      : { word: 'Not reached yet', detail: 'The run has not got to this step.' };
  }
  const mark = NODE_RUN_STATE_MARKS[state];
  return { word: mark.mark === '' ? state : mark.mark.charAt(0).toUpperCase() + mark.mark.slice(1), detail: `${mark.label.charAt(0).toUpperCase()}${mark.label.slice(1)}.` };
}
