/**
 * What the loop editor does when Dry-run or Run is pressed.
 *
 * The runner already exists (`loop-run.ts`) and a CLI already walks a file
 * (`run-loop-graph.mjs`). This module is the missing join: the graph on the
 * canvas is the input. Nothing here re-opens a file from disk.
 *
 * Dry-run is renderer-safe. It uses {@link createDryRunExecutor}, which closes
 * over no provider, so a press in the window cannot spend a turn. Live is only
 * *described* here: the prompt and test gate are still hardcoded for
 * {@link LIVE_DURATION_GRAPH_ID}, and a different drawing must be refused with
 * a sentence rather than silently given that prompt.
 */

import type { LoopGraph } from './loop-graph';
import {
  createDryRunExecutor,
  formatRunJournal,
  runLoopGraph,
  type DryRunDecision,
  type RunJournalEntry,
  type RunResult,
  type StepExecutor,
} from './loop-run';

/** The only graph this increment will live-run. */
export const LIVE_DURATION_GRAPH_ID = 'dspatch-live-duration';

/** Our own external loop. A live writing turn must not use DSpatch as a workspace. */
export const FORBIDDEN_LIVE_GRAPH_ID = 'dspatch-development-loop';

/**
 * The ordinary answers for the nodes our development loop already has.
 *
 * Same products as the CLI `happy-path` scenario. They are answers, not a path:
 * the canvas edges decide where each answer goes. Redirecting an edge on this
 * walk is what makes "changing the drawing changes the run" visible. A newly
 * placed graph whose nodes are not these ids falls through to first-branch.
 */
export const ORDINARY_CANVAS_WALK: readonly DryRunDecision[] = [
  { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' } },
  { node: 'route-next-step', produce: { kind: 'outcome', outcome: 'implement' } },
  { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'accept' } },
  { node: 'niclas-assessment', produce: { kind: 'outcome', outcome: 'accept' } },
];

export type LiveBindingState = 'ready' | 'forbidden' | 'unbound';

export interface LiveBinding {
  readonly ready: boolean;
  readonly state: LiveBindingState;
  /** One sentence the window can show. Why live will or will not start. */
  readonly reason: string;
}

export function describeLiveBinding(graph: {
  readonly id: string;
  readonly name: string;
}): LiveBinding {
  if (graph.id === FORBIDDEN_LIVE_GRAPH_ID) {
    return {
      ready: false,
      state: 'forbidden',
      reason:
        `Refusing to live-run "${graph.name}" (${graph.id}). That drawing is the external ` +
        `DSpatch development loop. A live writing turn must not use DSpatch itself as a ` +
        `workspace. Dry-run still walks this canvas as it is, and spends 0 provider turns. ` +
        `Live is bound to ${LIVE_DURATION_GRAPH_ID} on an isolated experiment repository.`,
    };
  }
  if (graph.id !== LIVE_DURATION_GRAPH_ID) {
    return {
      ready: false,
      state: 'unbound',
      reason:
        `Refusing to live-run "${graph.name}" (${graph.id}): this drawing has no live binding. ` +
        `The live prompt and the local test gate are hardcoded for ${LIVE_DURATION_GRAPH_ID} ` +
        `(complete formatDuration in an isolated experiment repository). Running that prompt ` +
        `against a different drawing would silently do the wrong work. Dry-run still walks ` +
        `this canvas as it is.`,
    };
  }
  return {
    ready: true,
    state: 'ready',
    reason:
      `Live is ready for ${LIVE_DURATION_GRAPH_ID}. Run uses an isolated experiment ` +
      `repository and the cheapest writing model already seen to work; it does not use ` +
      `the DSpatch working copy. The graph on the canvas is what will be walked, including ` +
      `unsaved edits.`,
  };
}

function graphDeclaresLimitReached(graph: LoopGraph): boolean {
  return graph.failureKinds.some((kind) => kind.id === 'limit-reached');
}

/**
 * Stop a step that has not started when the operator cancelled.
 *
 * Cancel must not reset the graph or replay a finished step. The wrapper only
 * refuses the *next* step; the runner keeps the journal it already wrote.
 */
export function withAbort(executor: StepExecutor, signal?: AbortSignal): StepExecutor {
  if (signal === undefined) {
    return executor;
  }
  return async (context) => {
    if (signal.aborted) {
      return {
        product: {
          kind: 'runtime-fault',
          fault: 'no-outcome-delivered',
          detail:
            `The operator cancelled before "${context.node.id}" produced anything. ` +
            `The graph and the workspace were left as they are; completed steps were not replayed.`,
        },
        summary: 'Cancelled. No provider was called and nothing was written.',
        providerTurns: 0,
      };
    }
    return executor(context);
  };
}

export interface CanvasRunOptions {
  readonly runId: string;
  readonly abortSignal?: AbortSignal;
  readonly now?: () => number;
  readonly onJournalEntry?: (entry: RunJournalEntry) => void;
}

/**
 * Walk the graph the editor is holding, with no provider reachable.
 *
 * The typed canvas graph is the input. Callers that have just edited a node or
 * an edge pass that next graph, not the last saved file.
 */
export function runCanvasGraph(graph: LoopGraph, options: CanvasRunOptions): Promise<RunResult> {
  return runLoopGraph(graph, {
    runId: options.runId,
    dryRun: true,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onJournalEntry === undefined ? {} : { onJournalEntry: options.onJournalEntry }),
    ...(graphDeclaresLimitReached(graph) ? { routeLimitAs: 'limit-reached' } : {}),
    executor: withAbort(
      createDryRunExecutor({
        decisions: ORDINARY_CANVAS_WALK,
        unscripted: 'first-branch',
      }),
      options.abortSignal,
    ),
  });
}

export interface EditorRunSummary {
  readonly headline: string;
  readonly path: string;
  readonly edges: string;
  readonly usage: string;
  readonly reconcile: string;
  readonly journal: string;
}

/** The journal fields the editor must show, in one place a test can check. */
export function summariseEditorRun(result: RunResult): EditorRunSummary {
  const reconcile = result.fault
    ? result.fault.reconcile
    : result.awaiting
      ? `Waiting at "${result.awaiting.nodeId}": ${result.awaiting.question} Nothing was reset.`
      : result.refusal
        ? result.refusal
        : result.status === 'limit-reached'
          ? `A bound was reached (${result.limitsReached.join(', ') || 'unspecified'}). That is not a failure of the work.`
          : 'Nothing to reconcile: the run ended on a terminal, a bound or a person as journalled.';

  return {
    headline: `${result.dryRun ? 'Dry-run' : 'Live'} ${result.status} · graph ${result.graphId} · run ${result.runId}`,
    path: result.path.length === 0 ? '(none)' : result.path.join(' → '),
    edges: result.edgesTaken.length === 0 ? '(none)' : result.edgesTaken.join(', '),
    usage:
      `${result.usage.calls} calls, ${result.usage.providerTurns} provider turns, ` +
      `${result.usage.reworkRounds} rework rounds, ${result.usage.transitions} transitions`,
    reconcile,
    journal: formatRunJournal(result),
  };
}

export function newEditorRunId(kind: 'dry' | 'live'): string {
  return `editor-${kind}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
}

/**
 * Whether the journal pane is open.
 *
 * A live run can sit on one agent for minutes. Hiding the pane until there is a
 * finished summary made Run look like it did nothing — that is what happened
 * when Niclas pressed it on 16 September 2026.
 */
export function editorJournalOpen(state: {
  readonly busy: boolean;
  readonly summary: EditorRunSummary | null;
  readonly refuse: string | null;
}): boolean {
  return state.busy || state.summary !== null || state.refuse !== null;
}

/** Whether **Run** may start a live run here, and what to say when it may not. */
export interface LiveRunOffer {
  readonly enabled: boolean;
  readonly title: string;
}

/**
 * The editor's Run button, told about runs it did not start.
 *
 * DSpatch runs one loop at a time, and the main process and `LoopRunController` both
 * refuse an overlap. This is the same fact a moment earlier, on the button: the
 * window's own `runBusy` knows nothing about a chat loop walking in another window,
 * so Run stayed enabled over a live run and the only thing stopping a second one was
 * a refusal the person had to press the button to read.
 *
 * `activeRunId` is the shared control's run — including this window's own, which is
 * why `ownRunBusy` is checked first and keeps its own wording.
 */
export function liveRunOffer(state: {
  readonly ownRunBusy: boolean;
  readonly activeRunId: string | null;
  /** The editor's existing reasons: no graph, errors in it, or a run in this window. */
  readonly blocked: boolean;
  readonly reason: string;
}): LiveRunOffer {
  if (!state.ownRunBusy && state.activeRunId !== null) {
    return {
      enabled: false,
      title:
        'A loop run is already in progress in DSpatch, and only one runs at a time. Let it ' +
        'finish or cancel it, and this drawing stays exactly as it is meanwhile.',
    };
  }
  return { enabled: !state.blocked, title: state.reason };
}
