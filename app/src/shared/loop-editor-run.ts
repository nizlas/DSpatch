/**
 * What the loop editor does when Dry-run or Run is pressed.
 *
 * The runner already exists (`loop-run.ts`) and a CLI already walks a file
 * (`run-loop-graph.mjs`). This module is the missing join: the graph on the
 * canvas is the input. Nothing here re-opens a file from disk.
 *
 * Dry-run is renderer-safe. It uses {@link createDryRunExecutor}, which closes
 * over no provider, so a press in the window cannot spend a turn. Live is only
 * *described* here: each drawing the editor may live-run has an entry in
 * {@link EDITOR_LIVE_BINDINGS} saying what its prompts and its gate command are, and
 * a drawing with none must be refused with a sentence rather than silently given
 * somebody else's prompt.
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

/** The duration fixture: one agent with a hardcoded prompt, then the test gate. */
export const LIVE_DURATION_GRAPH_ID = 'dspatch-live-duration';

/**
 * The example that changes code, lets DSpatch run the tests and has a second agent
 * check the change against the real result (DSP-139). Its agent steps inherit the run's
 * model, so it runs under Claude as well as under Cursor.
 */
export const DURATION_CHECK_GRAPH_ID = 'dspatch-duration-check';

/**
 * The command DSpatch runs for {@link DURATION_CHECK_GRAPH_ID}'s gate, in the run's
 * working folder, through the same shell and bounds as every configured gate command.
 *
 * In code and not in the drawing, on purpose (DSP-139 Q1): the drawing format has no
 * command field, and giving it one would let any drawing file have a shell line run when
 * Run is pressed. This is one bundled drawing declaring its own gate; its purpose names
 * the same command and a test holds the two equal. `node` must be on DSpatch's PATH.
 */
export const EXAMPLE_GATE_COMMAND = 'node --test test/duration.test.ts';

/**
 * What the editor's Run does for one drawing it may live-run.
 *
 * `prompts` says whose words an agent step is sent: the duration fixture's one hardcoded
 * prompt, or the chat loop's brief built from the drawing's own purposes and role files.
 * `gateCommand` is the command line shown for its gate, which DSpatch runs itself.
 */
export interface EditorLiveBinding {
  readonly graphId: string;
  readonly prompts: 'duration-fixture' | 'drawing-purposes';
  /** The command its gate runs, as a person would type it. */
  readonly gateCommand: string;
  /** How that command is started, in a sentence for the gate's panel. */
  readonly gateRunsHow: string;
  readonly readyReason: string;
}

/**
 * Every drawing the editor's Run will live-run, by id. Every other id is refused.
 *
 * A table rather than a second `if`, so that what is bound is listed in one place and a
 * third entry is a decision somebody writes down rather than a branch that grows.
 */
export const EDITOR_LIVE_BINDINGS: readonly EditorLiveBinding[] = [
  {
    graphId: LIVE_DURATION_GRAPH_ID,
    prompts: 'duration-fixture',
    gateCommand: 'node --test test/duration.test.ts',
    gateRunsHow:
      'with the Node runtime DSpatch itself runs on, without a shell, in the run’s ' +
      'working folder',
    readyReason:
      `Live is ready for ${LIVE_DURATION_GRAPH_ID}. Run uses an isolated experiment ` +
      `repository and the cheapest writing model already seen to work; it does not use ` +
      `the DSpatch working copy. The graph on the canvas is what will be walked, including ` +
      `unsaved edits.`,
  },
  {
    graphId: DURATION_CHECK_GRAPH_ID,
    prompts: 'drawing-purposes',
    gateCommand: EXAMPLE_GATE_COMMAND,
    gateRunsHow: 'through the shell, in the run’s working folder',
    readyReason:
      `Live is ready for ${DURATION_CHECK_GRAPH_ID}. Run uses an isolated experiment ` +
      `repository, not the DSpatch working copy: an agent changes the code, DSpatch runs ` +
      `${EXAMPLE_GATE_COMMAND} itself, and a second agent checks the change against that ` +
      `result. Each agent step is sent its node's purpose and its role file as drawn. The ` +
      `graph on the canvas is what will be walked, including unsaved edits.`,
  },
];

/** The editor's binding for a drawing, or `null` when it has none. */
export function editorLiveBindingFor(graphId: string): EditorLiveBinding | null {
  return EDITOR_LIVE_BINDINGS.find((binding) => binding.graphId === graphId) ?? null;
}

/**
 * What a gate step's panel says about who runs it (DSP-139).
 *
 * A gate has no agent, so the agent's tools and the requirement answers do not apply to
 * it. Where the editor's Run binds a command to this drawing, the command is named.
 */
export function describeGateRunner(graphId: string): string {
  const binding = editorLiveBindingFor(graphId);
  return binding === null
    ? 'No agent works in this step. DSpatch runs a gate’s command itself, and this ' +
        'drawing has no command bound for the editor’s Run, so a live run of it is ' +
        'refused. The agent’s tools and the requirements below do not apply here.'
    : `No agent works in this step. DSpatch runs \`${binding.gateCommand}\` itself, ` +
        `${binding.gateRunsHow}; pass or fail is its exit code. The agent’s tools and ` +
        `the requirements below do not apply here.`;
}

/**
 * There is no forbidden graph id, and the absence is the point (DSP-78).
 *
 * `FORBIDDEN_LIVE_GRAPH_ID` was `dspatch-development-loop`, and it refused that drawing
 * **by its id, whatever folder was open**. That is broader than the danger it was
 * standing in for: which folders a run works in is a question about the run, not about
 * the picture. Refusing the drawing meant our own development loop could not be chosen
 * even to run against somebody else's project, which is precisely what the standalone
 * definition is for.
 */

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

/**
 * `forbidden` is gone with the id check that was its only producer (DSP-78).
 *
 * Kept out rather than left in place unused: a state nothing can reach reads as a
 * refusal that still exists somewhere, and the next person looking for what refuses our
 * development loop would look here and find a plausible answer that is not the one.
 * Both remaining states are refusals *of a binding* — this drawing has no live prompt —
 * and neither is a refusal about a folder.
 */
export type LiveBindingState = 'ready' | 'unbound';

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
  const binding = editorLiveBindingFor(graph.id);
  if (binding === null) {
    return {
      ready: false,
      state: 'unbound',
      reason:
        `Refusing to live-run "${graph.name}" (${graph.id}): this drawing has no live binding. ` +
        `The editor's Run has prompts and a local test gate only for ` +
        `${EDITOR_LIVE_BINDINGS.map((entry) => entry.graphId).join(' and ')} (complete ` +
        `formatDuration in an isolated experiment repository). Running those against a ` +
        `different drawing would silently do the wrong work. Dry-run still walks this canvas ` +
        `as it is.`,
    };
  }
  return { ready: true, state: 'ready', reason: binding.readyReason };
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
