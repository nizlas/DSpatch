/**
 * Walking a loop graph: what turns the editor's drawing into a run.
 *
 * DSP-21 delivered the format and DSP-22 an editor for it. Neither executes
 * anything, which is why `ATTRIBUTE_SUPPORT` in `loop-graph.ts` marks six
 * attributes *recorded and not honoured, waiting on DSP-18*. This module is that
 * wait ending for four of them: `limits`, `onRuntimeFault`, `report` and
 * `archive` are now read by something that acts on them.
 *
 * Three properties are the whole point, and each is a thing our own external loop
 * got wrong first.
 *
 * **A declared failure routes; a runtime fault stops the run.** The format refuses
 * to let an author draw an edge for a hang, so the runner must supply the other
 * half: a hung, crashed or undelivered step becomes a {@link RuntimeFault}, is
 * journalled as one, and ends the run under the graph's `onRuntimeFault` policy.
 * It is never offered to the edges, so nothing in a graph can turn a broken
 * machine into a routed decision. On 14 September 2026 a finished Implementer call
 * was never delivered and the coordinator waited five hours and fifty minutes; no
 * edge would have helped, and an edge that appeared to help would have been worse.
 *
 * **Reaching a bound is reaching a bound.** `maxCalls` spent is not a failure of
 * the work. The journal records it as {@link RunStatus} `limit-reached`, and a
 * graph that draws a route for it — ours draws `limit-reached` from the coordinator
 * to its report — gets to take that route while the run still reports the bound as
 * spent. See {@link RunOptions.routeLimitAs} for why that binding has to be handed
 * in rather than read from the file.
 *
 * **Every transition is journalled while it happens.** Which node, which edge, why,
 * when, and what it produced, in an order a person can replay. A run nobody can
 * reconstruct is a run nobody can trust, which is DSP-18 #3.
 *
 * Nothing here touches a filesystem, a provider or Electron: the work of a step is
 * an injected {@link StepExecutor}. That is what makes {@link createDryRunExecutor}
 * possible — a dry run is not a flag the runner checks, it is an executor with no
 * provider to call, so it *cannot* spend a turn rather than being trusted not to.
 */

import type { LoopEdge, LoopGraph, LoopNode, StepLimits } from './loop-graph';
import { isWorkStep, stepWorkFor, type StepHold, type StepRef } from './loop-control';

/** What a step produced, in the only four shapes the runner understands. */
export type StepProduct =
  /** Done, nothing to branch on. Routes on the node's `success` edge. */
  | { readonly kind: 'success' }
  /** One of the node's declared `outcomes`: a router's branch, a gate's verdict. */
  | { readonly kind: 'outcome'; readonly outcome: string }
  /** One of the node's `declaredFailures`. The dashed arrow, and it routes. */
  | { readonly kind: 'declared-failure'; readonly failure: string }
  /**
   * The machinery broke. Not routable, by design — see {@link RUNTIME_FAULT_KINDS}.
   * An executor returns this when it knows; the runner detects the rest itself.
   */
  | { readonly kind: 'runtime-fault'; readonly fault: RuntimeFaultKind; readonly detail: string }
  /**
   * A person has to act before the run can continue. Distinct from a fault: nothing
   * is broken. The run stops with its history intact and reports what is being
   * waited for. Resuming is not implemented in this increment.
   */
  | { readonly kind: 'awaiting-human'; readonly question: string };

/**
 * The ways a run can break, as opposed to the ways work can fail.
 *
 * Deliberately a closed list the graph cannot extend: a graph author has no way to
 * add one, and therefore no way to route one.
 */
export const RUNTIME_FAULT_KINDS = [
  /** The step outran the `maxMinutes` that bounds it. The figure's hung call. */
  'step-timed-out',
  /** The executor returned, but with nothing the runner can route on. */
  'no-outcome-delivered',
  /** The executor threw. The step's own outcome is unknown, which is the point. */
  'executor-threw',
  /** The node produced something it never declared, so the graph did not plan for it. */
  'undeclared-product',
  /** Nothing leaves this node for what it produced. Validation catches it; a graph may still arrive unvalidated. */
  'no-edge-for-product',
  /** An edge points at a node that is not in the graph. */
  'edge-target-missing',
  /** The run made more transitions than the runner will make. A cycle with no exit. */
  'transition-budget-spent',
] as const;
export type RuntimeFaultKind = (typeof RUNTIME_FAULT_KINDS)[number];

export interface RuntimeFault {
  readonly kind: RuntimeFaultKind;
  /** Where it happened. A node, or an edge when the fault is in the wiring. */
  readonly nodeId?: string;
  readonly edgeId?: string;
  /** What broke, in one sentence. */
  readonly detail: string;
  /** What a person has to establish before anything is repeated. */
  readonly reconcile: string;
}

/** What the runner hands an executor. Everything a step needs and nothing else. */
export interface StepContext {
  readonly runId: string;
  readonly graph: LoopGraph;
  readonly node: LoopNode;
  /** 1-based: the second visit to a node is a different step from the first. */
  readonly occurrence: number;
  /** The journal's sequence number for this call, which is the handoff's call-id. */
  readonly callId: number;
  /** Effective bounds: the node's own, falling back to the graph's. */
  readonly limits: StepLimits;
  /** When the step must have finished, from the runner's clock, or null when unbounded. */
  readonly deadlineAt: number | null;
  /** Where this step's report belongs, and who writes it. Computed from `archive` and `report`. */
  readonly archive: ArchivePlacement | null;
  /**
   * Write one line into the run's journal while this step is still running.
   *
   * The entry is recorded against this node and reaches every reader the walk's
   * own entries reach — `onJournalEntry`, the run record, the chat column's live
   * log and the graph view — because it is the same entry, not a second channel
   * beside it. {@link STEP_NOTE_KINDS} is the whole of what a step may say.
   */
  readonly note: StepNote;
}

/** Where a step's entry lands and who is responsible for filing it. */
export interface ArchivePlacement {
  readonly path: string;
  /** The node id that writes it. Not always the node that produced the work. */
  readonly writtenBy: string;
  /** True when the producing node cannot file its own entry — the 15 September mistake. */
  readonly writtenByAnotherNode: boolean;
}

export interface StepExecution {
  readonly product: StepProduct;
  /** One line for the journal: what this step did. */
  readonly summary: string;
  /**
   * How many provider turns this step spent. A dry run reports 0 because it has no
   * provider, not because it chose not to bill.
   */
  readonly providerTurns: number;
  /** A reference to what it produced, when there is one. */
  readonly archiveRef?: string;
}

export type StepExecutor = (context: StepContext) => Promise<StepExecution>;

export type RunStatus =
  /** A terminal node was reached. */
  | 'completed'
  /** A bound was spent. Not a failure; the run stops and says which bound. */
  | 'limit-reached'
  /** The machinery broke. `onRuntimeFault` decided what happened next. */
  | 'runtime-fault'
  /** A human step is pending. History intact, nothing repeated. */
  | 'awaiting-human'
  /** The runner would not start: the graph could not be walked at all. */
  | 'refused';

export const JOURNAL_KINDS = [
  'run-started',
  'node-entered',
  'node-produced',
  'edge-taken',
  'limit-reached',
  'runtime-fault',
  'awaiting-human',
  'run-ended',
  'refused',
  /**
   * The run reached a work step and did not start it: a pause was asked for, or the
   * user is working interactively. Added to this list rather than replacing anything
   * in it, so a record written before DSP-29 still parses unchanged.
   */
  'run-held',
  /** The held step was let go, with how long it waited and who let it go. */
  'run-released',
  /**
   * A step that has started is waiting for a person to answer something before it
   * can go on. DSP-51.
   *
   * Deliberately **not** `run-held`. That pair is the pause control's, and it says
   * *the walk has not started this step* — it is recorded before `node-entered`,
   * the step's own bound has not begun, and nothing is in flight. This says the
   * opposite: the step is running, it has asked the person a question, and the
   * answer decides what it does next. Reusing the pause's words would make a
   * reader of the journal unable to tell a run nobody has resumed from a run that
   * is holding a question in front of somebody.
   */
  'waiting-for-person',
  /** The wait ended, with how long it took and what the person said. */
  'person-answered',
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/**
 * The journal kinds a step may write for itself while it is still running.
 *
 * A closed list, and the closure is the content: a step gets to say that it is
 * waiting on a person and that the wait ended, and it does not get to write
 * `run-ended`, `edge-taken` or a fault. The walk owns the account of the walk.
 */
export const STEP_NOTE_KINDS = ['waiting-for-person', 'person-answered'] as const;
export type StepNoteKind = (typeof STEP_NOTE_KINDS)[number];

/**
 * How a step writes a line into the run's journal before it has finished.
 *
 * Handed to the executor rather than returned by it, because the point is the
 * timing: a line that arrives with the step's result would be written after the
 * wait it describes was over, which is exactly when nobody needs it.
 */
export type StepNote = (
  kind: StepNoteKind,
  detail: string,
  data?: Readonly<Record<string, string | number | boolean>>,
) => void;

/**
 * One line of the run's history.
 *
 * Written as the run happens rather than assembled at the end, because a run that
 * is interrupted has to leave a record that stops at the interruption rather than
 * leaving none at all.
 */
export interface RunJournalEntry {
  readonly seq: number;
  readonly atIso: string;
  readonly sinceStartMs: number;
  readonly kind: JournalKind;
  readonly nodeId?: string;
  readonly edgeId?: string;
  /** Why this happened, addressed to whoever is reconstructing the run. */
  readonly detail: string;
  /** Machine-readable specifics: the outcome name, the bound, the fault kind. */
  readonly data?: Readonly<Record<string, string | number | boolean>>;
}

export interface RunUsage {
  /** Executions of nodes that spend a call: `agent`, `gate`, `external`. */
  readonly calls: number;
  /** Provider turns actually spent, as reported by the executor. Zero in a dry run. */
  readonly providerTurns: number;
  /** Edges taken whose outcome the caller named as rework. */
  readonly reworkRounds: number;
  readonly transitions: number;
  readonly nodesExecuted: number;
  readonly wallClockMs: number;
}

export interface RunResult {
  readonly runId: string;
  readonly graphId: string;
  readonly status: RunStatus;
  readonly dryRun: boolean;
  readonly startedAtIso: string;
  readonly endedAtIso: string;
  /** Node ids in the order they were entered, including repeats. */
  readonly path: readonly string[];
  /** Edge ids in the order they were taken. This is the answer to "which edge, and why". */
  readonly edgesTaken: readonly string[];
  readonly terminalNodeId: string | null;
  /** Bounds that were spent during the run, whether or not the run then continued. */
  readonly limitsReached: readonly string[];
  readonly fault: RuntimeFault | null;
  /** Set when `status` is `awaiting-human`. */
  readonly awaiting: { readonly nodeId: string; readonly question: string } | null;
  /** Why the runner refused to start. */
  readonly refusal: string | null;
  readonly usage: RunUsage;
  readonly journal: readonly RunJournalEntry[];
}

/** What the runner learned by asking whether a work step may start. */
export interface StepReleaseOutcome {
  /** `start` means go; `cancelled` means the user abandoned the run while it waited. */
  readonly kind: 'start' | 'cancelled';
  /** Why, in the words a person reads. */
  readonly detail: string;
  /** `null` when the step was never held, so the journal stays quiet in the ordinary case. */
  readonly heldBy: StepHold | null;
  readonly waitedMs: number;
}

/**
 * Who decides that the next work step starts.
 *
 * Injected rather than read, for the same reason {@link StepExecutor} is: the runner
 * has no window to ask and no button to watch, and a rule living inside its control
 * flow could not be tested. The decision itself is `decideNextStep` in
 * `loop-control.ts`; this is only how the answer reaches the walk.
 *
 * **The runner reports the step's own boundaries.** `stepStarted` and `stepEnded`
 * bracket the executor call and nothing else, so "work is in flight" is the executor
 * actually running — which is what makes a pause arrive when the step ends rather than
 * when the button was pressed.
 */
export interface RunControlPort {
  /**
   * Resolve when this step may start. May wait indefinitely: a paused run is a run
   * that is waiting, with its history, its counters and its mandate intact in this
   * closure, which is why pausing cannot restart anything.
   *
   * `onHeld` is called at the moment the step is held, so the journal records the wait
   * while it is happening rather than after it is over.
   */
  awaitStepRelease(
    step: StepRef,
    onHeld: (hold: StepHold, why: string) => void,
  ): Promise<StepReleaseOutcome>;
  stepStarted(step: StepRef): void;
  stepEnded(step: StepRef): void;
}

export interface RunOptions {
  readonly runId: string;
  readonly executor: StepExecutor;
  /**
   * Consulted before every work step. Left out — as the CLI and every existing test
   * leave it out — the run is autonomous and never waits, which is what it did before
   * DSP-29 existed.
   */
  readonly control?: RunControlPort;
  /**
   * Whether the operator has cancelled, read before every node the walk enters.
   *
   * Until DSP-38's sibling card this module contained no reference to a signal at
   * all, so a cancel was noticed only by whatever the executor happened to check —
   * and the live executor checks it in its agent branch and **not** in its gate
   * branch. A cancel pressed after an agent had produced and before the next node
   * was entered therefore crossed the `node-produced` record, the routing decision
   * and any router on the way without being seen, and if the next node was a gate,
   * DSpatch spawned the person's own build or test command after they said stop.
   *
   * Read here rather than in the executor because the walk is the one place that
   * sees every node kind, so one check covers agents, gates, routers, externals and
   * human nodes instead of one per executor branch. Optional, and a run without one
   * behaves exactly as it did before: the checks below are the only readers.
   */
  readonly signal?: AbortSignal;
  /**
   * True when no provider can be reached, for the record and the report. The
   * guarantee comes from the executor, not from this flag.
   */
  readonly dryRun: boolean;
  /** Injectable so a test can drive a clock and a timeout can be demonstrated. */
  readonly now?: () => number;
  /**
   * Which outcome names count as a rework round.
   *
   * The format has no way to mark an edge as the loop-back that `maxReworkRounds`
   * bounds — see the report for this call — so the binding is the caller's and is
   * recorded in the journal rather than inferred silently. Defaults to `rework`,
   * which is what both of our gates call it.
   */
  readonly reworkOutcomes?: readonly string[];
  /**
   * The failure kind a spent bound may route through, when the graph draws one.
   *
   * Also not expressible in the format: our graph declares a `limit-reached`
   * failure on the coordinator and draws it to the report, but nothing in the file
   * says that kind *is* the run's bounds. Hand it in and the route is taken and
   * journalled as a bound rather than as a failure of the work; leave it out and a
   * spent bound stops the run.
   */
  readonly routeLimitAs?: string;
  /**
   * The runner's own bound on how far it will walk, which the format does not
   * express. A cycle whose exit is never produced would otherwise run forever.
   */
  readonly maxTransitions?: number;
  /** Called with each entry as it is journalled, so a caller can stream it to disk. */
  readonly onJournalEntry?: (entry: RunJournalEntry) => void;
}

const DEFAULT_MAX_TRANSITIONS = 200;

function effectiveLimits(graph: LoopGraph, node: LoopNode): StepLimits {
  return { ...(graph.limits ?? {}), ...(node.limits ?? {}) };
}

/** `agent`, `gate` and `external` are work someone is asked to do; the rest are not. */
function spendsACall(node: LoopNode): boolean {
  return node.kind === 'agent' || node.kind === 'gate' || node.kind === 'external';
}

function archivePlacement(
  graph: LoopGraph,
  node: LoopNode,
  runId: string,
  callId: number,
): ArchivePlacement | null {
  const archive = graph.archive;
  if (!archive) {
    return null;
  }
  const base = (node.report?.path ?? archive.path).replaceAll('<run-id>', runId);
  const writtenBy = node.report?.writtenBy ?? 'self';
  const sequence = String(callId).padStart(3, '0');
  return {
    path: `${base}${base.endsWith('/') ? '' : '/'}${sequence}-${node.id}.md`,
    writtenBy: writtenBy === 'self' ? node.id : writtenBy,
    writtenByAnotherNode: writtenBy !== 'self',
  };
}

/**
 * What the graph says happens when the machinery breaks. One policy today.
 *
 * The generic sentence tells a person the step's real outcome is unknown, which is the
 * point of `step-timed-out` and `no-outcome-delivered`: the runner gave up on a call it
 * could not see the end of, and whether the work happened is genuinely open.
 *
 * It is false for `transition-budget-spent`. Nothing there is unknown — every step
 * finished, every outcome is in the journal, and what ran out is the runner's own budget
 * for how many transitions it will make while walking a cycle whose exit never comes.
 * An independent Verifier hit this on 16 September 2026 on the first graph other than
 * our own the runner had ever executed, and reported the message as falsely alarming:
 * it sends a tired person looking for a hung agent that does not exist. So this fault
 * gets the sentence that is true of it.
 */
function reconcileGuidance(graph: LoopGraph, fault: RuntimeFaultKind): string {
  if (graph.onRuntimeFault !== 'stop-and-reconcile') {
    return `Unrecognised onRuntimeFault "${String(graph.onRuntimeFault)}"; the run stopped.`;
  }
  const stopped =
    `The graph's onRuntimeFault is stop-and-reconcile, so the run stopped here and ` +
    `nothing was repeated.`;
  const notAFailure = `Do not treat this as a declared failure: no edge was taken.`;
  if (fault === 'transition-budget-spent') {
    return (
      `${stopped} Nothing about this step is unknown and no agent hung: every step in ` +
      `this run finished and its outcome is in the journal. What ran out is the runner's ` +
      `own transition budget, so read the path this run took and find the cycle that ` +
      `never produced its exit — the graph's own limits are what bound a loop, and ` +
      `raising the runner's budget would only walk the same cycle for longer. ` +
      `${notAFailure}`
    );
  }
  return (
    `${stopped} Establish what actually happened to this step — ${fault} means its real ` +
    `outcome is unknown, not that it failed — before resuming or re-running it. ` +
    `${notAFailure}`
  );
}

/**
 * A step the run never started, as a fault.
 *
 * Shared by the only two things that can decide it — a held step whose wait ended in
 * a cancel, and the signal read before a node is entered — so the two cannot drift
 * into describing the same event in different words. `no-outcome-delivered` is the
 * kind both already used: `withAbort` in `loop-editor-run.ts` picks it for exactly
 * this situation too, so nothing here extends the closed list of fault kinds or the
 * vocabulary anything downstream reads.
 *
 * Deliberately **not** `reconcileGuidance`'s generic sentence, which says the step's
 * real outcome is unknown. Here it is known: the step did not happen. The same
 * exception `transition-budget-spent` already gets, for the same reason — a fault
 * sentence that sends a tired person looking for a hung agent that does not exist is
 * a cost, not a safety margin.
 *
 * `why` is the sentence that says who stopped it, and it comes first because that is
 * the part a person has not already guessed.
 */
function neverStarted(nodeId: string, why: string): RuntimeFault {
  return {
    kind: 'no-outcome-delivered',
    nodeId,
    detail:
      `${why} "${nodeId}" was never started, so it called no agent, ran no ` +
      `command and changed nothing.`,
    reconcile:
      `The run stopped here and nothing was repeated. Nothing about this step is unknown: ` +
      `it never started, so it spent nothing and changed nothing, and every step before it ` +
      `is in the journal with its own result. Do not treat this as a declared failure: no ` +
      `edge was taken.`,
  };
}

/** The edge a product routes through, or why there is none. */
export function selectEdge(
  graph: LoopGraph,
  node: LoopNode,
  product: StepProduct,
): { readonly edge: LoopEdge; readonly why: string } | { readonly edge: null; readonly why: string } {
  const outgoing = graph.edges.filter((edge) => edge.from === node.id);
  if (product.kind === 'success') {
    const edge = outgoing.find((candidate) => candidate.when.on === 'success');
    return edge
      ? { edge, why: `"${node.id}" finished with nothing to branch on, so its success edge was taken.` }
      : { edge: null, why: `"${node.id}" finished on plain success and no success edge leaves it.` };
  }
  if (product.kind === 'outcome') {
    const edge = outgoing.find(
      (candidate) => candidate.when.on === 'outcome' && candidate.when.outcome === product.outcome,
    );
    return edge
      ? {
          edge,
          why: `"${node.id}" produced outcome "${product.outcome}", which is the condition on this edge.`,
        }
      : {
          edge: null,
          why: `"${node.id}" produced outcome "${product.outcome}" and no edge leaves it on that outcome.`,
        };
  }
  if (product.kind === 'declared-failure') {
    const edge = outgoing.find(
      (candidate) =>
        candidate.when.on === 'declared-failure' && candidate.when.failure === product.failure,
    );
    return edge
      ? {
          edge,
          why:
            `"${node.id}" declared failure "${product.failure}", and the graph routes that ` +
            `failure along this edge. This is a routed decision, not a broken step.`,
        }
      : {
          edge: null,
          why: `"${node.id}" declared failure "${product.failure}" and no edge carries it.`,
        };
  }
  return { edge: null, why: `A ${product.kind} is not routable and no edge was considered.` };
}

/** Whether the node declared what it produced, so the graph could have planned for it. */
function productIsDeclared(node: LoopNode, product: StepProduct): string | null {
  if (product.kind === 'outcome') {
    const declared = node.outcomes ?? [];
    return declared.includes(product.outcome)
      ? null
      : `"${node.id}" produced outcome "${product.outcome}", which it does not declare. It declares ${
          declared.length > 0 ? declared.join(', ') : '(none)'
        }.`;
  }
  if (product.kind === 'declared-failure') {
    const declared = node.declaredFailures ?? [];
    return declared.includes(product.failure)
      ? null
      : `"${node.id}" reported failure "${product.failure}", which it does not declare. It declares ${
          declared.length > 0 ? declared.join(', ') : '(none)'
        }.`;
  }
  if (product.kind === 'success' && (node.outcomes ?? []).length > 0) {
    return `"${node.id}" declares outcomes and may not finish on plain success. It declares ${(
      node.outcomes ?? []
    ).join(', ')}.`;
  }
  return null;
}

function describeProduct(product: StepProduct): string {
  switch (product.kind) {
    case 'success':
      return 'success';
    case 'outcome':
      return `outcome "${product.outcome}"`;
    case 'declared-failure':
      return `declared failure "${product.failure}"`;
    case 'runtime-fault':
      return `runtime fault ${product.fault}`;
    case 'awaiting-human':
      return 'a pending human decision';
  }
}

/**
 * Walk the graph from its entry until a terminal, a bound, a fault or a person.
 *
 * The graph is taken as already valid: `loadLoopGraph` refuses a graph rather than
 * half-loading it, and running an invalid one would be running something nobody
 * drew. What is checked here is only what would make the walk impossible, and that
 * is a refusal with a reason rather than a fault.
 */
export async function runLoopGraph(graph: LoopGraph, options: RunOptions): Promise<RunResult> {
  const now = options.now ?? (() => Date.now());
  const reworkOutcomes = options.reworkOutcomes ?? ['rework'];
  const maxTransitions = options.maxTransitions ?? DEFAULT_MAX_TRANSITIONS;
  const startedAt = now();

  const journal: RunJournalEntry[] = [];
  const path: string[] = [];
  const edgesTaken: string[] = [];
  const limitsReached: string[] = [];
  const occurrences = new Map<string, number>();
  /** A bound is offered to the graph once. The second time it is spent, the run stops. */
  const boundsAlreadyRouted = new Set<string>();

  let callId = 0;
  let calls = 0;
  let providerTurns = 0;
  let reworkRounds = 0;
  let transitions = 0;
  let nodesExecuted = 0;

  const record = (
    kind: JournalKind,
    detail: string,
    extra: {
      readonly nodeId?: string;
      readonly edgeId?: string;
      readonly data?: Readonly<Record<string, string | number | boolean>>;
    } = {},
  ): void => {
    const at = now();
    const entry: RunJournalEntry = {
      seq: journal.length + 1,
      atIso: new Date(at).toISOString(),
      sinceStartMs: at - startedAt,
      kind,
      detail,
      ...extra,
    };
    journal.push(entry);
    options.onJournalEntry?.(entry);
  };

  const finish = (
    status: RunStatus,
    detail: string,
    parts: {
      readonly terminalNodeId?: string | null;
      readonly fault?: RuntimeFault | null;
      readonly awaiting?: { readonly nodeId: string; readonly question: string } | null;
      readonly refusal?: string | null;
    } = {},
  ): RunResult => {
    record(status === 'refused' ? 'refused' : 'run-ended', detail, {
      data: {
        status,
        calls,
        providerTurns,
        reworkRounds,
        transitions,
        limitsReached: limitsReached.join(', '),
      },
    });
    const endedAt = now();
    return {
      runId: options.runId,
      graphId: graph.id,
      status,
      dryRun: options.dryRun,
      startedAtIso: new Date(startedAt).toISOString(),
      endedAtIso: new Date(endedAt).toISOString(),
      path,
      edgesTaken,
      terminalNodeId: parts.terminalNodeId ?? null,
      limitsReached,
      fault: parts.fault ?? null,
      awaiting: parts.awaiting ?? null,
      refusal: parts.refusal ?? null,
      usage: {
        calls,
        providerTurns,
        reworkRounds,
        transitions,
        nodesExecuted,
        wallClockMs: endedAt - startedAt,
      },
      journal,
    };
  };

  const fail = (fault: RuntimeFault): RunResult => {
    record('runtime-fault', `${fault.detail} ${fault.reconcile}`, {
      ...(fault.nodeId === undefined ? {} : { nodeId: fault.nodeId }),
      ...(fault.edgeId === undefined ? {} : { edgeId: fault.edgeId }),
      data: { fault: fault.kind, onRuntimeFault: graph.onRuntimeFault, routed: false },
    });
    return finish(
      'runtime-fault',
      `The run stopped on a runtime fault (${fault.kind}). No edge was taken, because a ` +
        `runtime fault is the runner's and never the graph's.`,
      { fault },
    );
  };

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const entry = nodeById.get(graph.entry);

  const maxTasks = graph.limits?.maxTasks;
  record(
    'run-started',
    `Run ${options.runId} of graph "${graph.id}" (${graph.name}).` +
      (maxTasks === undefined || maxTasks < 1
        ? ''
        : ` maxTasks is ${maxTasks} and a run is one task, so that bound holds by construction: ` +
          `the runner has no notion of a task boundary inside a graph, so it cannot be spent mid-run.`),
    {
    data: {
      dryRun: options.dryRun,
      entry: graph.entry,
      target: graph.target,
      onRuntimeFault: graph.onRuntimeFault,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      maxTransitions,
      reworkOutcomes: reworkOutcomes.join(', '),
      routeLimitAs: options.routeLimitAs ?? '(none: a spent bound stops the run)',
      ...(maxTasks === undefined ? {} : { maxTasks }),
    },
    },
  );

  if (!entry) {
    const refusal =
      `The graph's entry is "${graph.entry}", which is not one of its nodes, so there is ` +
      `nowhere to start. Nothing was executed.`;
    return finish('refused', refusal, { refusal });
  }

  if (maxTasks !== undefined && maxTasks < 1) {
    const refusal =
      `The graph's limits allow maxTasks ${maxTasks}, and a run is one task, so this run ` +
      `would exceed its bound before starting. Nothing was executed.`;
    limitsReached.push('maxTasks');
    return finish('refused', refusal, { refusal });
  }

  let current: LoopNode = entry;

  for (;;) {
    const occurrence = (occurrences.get(current.id) ?? 0) + 1;
    occurrences.set(current.id, occurrence);
    path.push(current.id);

    if (current.kind === 'terminal') {
      record('node-entered', `Reached terminal "${current.id}" (${current.label ?? current.id}).`, {
        nodeId: current.id,
        // The label beside the id, because a reader who has only the result — the
        // conversation's ending sentence is one — otherwise has to name the ending by
        // its identifier. The five terminals were given labels so that an ending could
        // be read rather than decoded, and `RunResult` carries no labels at all.
        data: { kind: current.kind, occurrence, label: current.label ?? current.id },
      });
      return finish(
        'completed',
        `The run reached terminal "${current.id}" after ${transitions} transitions and ` +
          `${calls} calls.`,
        { terminalNodeId: current.id },
      );
    }

    callId += 1;
    const limits = effectiveLimits(graph, current);
    const step: StepRef = {
      nodeId: current.id,
      nodeLabel: current.label ?? current.id,
      occurrence,
      callId,
      work: stepWorkFor(current.kind),
    };

    // Who decides that this step starts (DSP-29 #2, DSP-30 #2).
    //
    // Asked here, and the position is the content. **Before `node-entered`**, because
    // a node the graph view marks `running` while it is actually held would be the
    // picture claiming work that is not happening — the same shape as a badge that is
    // green over a failed run. **Before `deadlineAt`**, because a step must not spend
    // its own `maxMinutes` sitting in a pause: the budget belongs to the work, and a
    // run that timed out because a person thought about it for twenty minutes would
    // make pausing the expensive choice at exactly the moment it matters.
    //
    // Only for work steps. A router and a terminal pass straight through: asking a
    // person to approve the graph walking along an edge would teach them nothing and
    // would train them to click past the prompts that do matter. A human node is not
    // asked about here either — it waits by its own mechanism, further down, and
    // `decideNextStep` says so rather than this gate taking it over.
    if (options.control !== undefined && isWorkStep(step.work)) {
      const release = await options.control.awaitStepRelease(step, (hold, why) => {
        record('run-held', why, {
          nodeId: current.id,
          data: { hold, callId, occurrence, work: step.work },
        });
      });
      if (release.heldBy !== null) {
        record('run-released', release.detail, {
          nodeId: current.id,
          data: {
            hold: release.heldBy,
            heldMs: release.waitedMs,
            started: release.kind === 'start',
          },
        });
      }
      if (release.kind === 'cancelled') {
        return fail(neverStarted(current.id, release.detail));
      }
    }

    // Has the operator cancelled? (DSP-37.)
    //
    // Asked **after** the control's question rather than before it, so a run
    // cancelled while it was *held* still ends through the branch above and still
    // reports how long it waited and what was holding it. This branch is the one
    // that catches the case nothing caught: an autonomous run, where
    // `awaitStepRelease` answers `start` without consulting anything, and a run
    // with no control at all, where the question is never asked.
    //
    // A terminal never reaches here, because the terminal branch above has already
    // returned. That is deliberate: a run whose walk is over has no work left to
    // stop, and reporting it as cancelled would be less true than reporting that it
    // finished.
    if (options.signal?.aborted === true) {
      return fail(neverStarted(current.id, 'The operator cancelled the run.'));
    }

    const placement = archivePlacement(graph, current, options.runId, callId);
    const deadlineAt = limits.maxMinutes === undefined ? null : now() + limits.maxMinutes * 60_000;

    record(
      'node-entered',
      `Entered "${current.id}" (${current.label ?? current.id}), ${
        current.kind === 'agent' || current.kind === 'external' ? 'an' : 'a'
      } ${current.kind}${
        current.role ? ` performed by role ${current.role.id}` : ''
      }. ${current.purpose ?? ''}`.trim(),
      {
        nodeId: current.id,
        data: {
          kind: current.kind,
          occurrence,
          callId,
          spendsACall: spendsACall(current),
          ...(current.role ? { role: current.role.id, roleSource: current.role.source.path } : {}),
          ...(current.model ? { model: current.model.policy } : {}),
          ...(limits.maxMinutes === undefined ? {} : { maxMinutes: limits.maxMinutes }),
          ...(placement
            ? { archive: placement.path, reportWrittenBy: placement.writtenBy }
            : {}),
        },
      },
    );

    const startedStepAt = now();
    let execution: StepExecution;
    // The two lines that make a pause honest. Work is in flight from here until the
    // executor settles — including when it throws, which is why the report is in a
    // `finally`: a step that blew up has still ended, and a run that could never say
    // it had stopped would be the opposite failure of one that says so too early.
    const control = isWorkStep(step.work) ? options.control : undefined;
    control?.stepStarted(step);
    try {
      execution = await options.executor({
        runId: options.runId,
        graph,
        node: current,
        occurrence,
        callId,
        limits,
        deadlineAt,
        archive: placement,
        note: (kind, detail, data) => {
          record(kind, detail, {
            nodeId: current.id,
            ...(data === undefined ? {} : { data }),
          });
        },
      });
    } catch (error) {
      return fail({
        kind: 'executor-threw',
        nodeId: current.id,
        detail:
          `Executing "${current.id}" threw before it produced anything: ${
            error instanceof Error ? error.message : String(error)
          }.`,
        reconcile: reconcileGuidance(graph, 'executor-threw'),
      });
    } finally {
      control?.stepEnded(step);
    }

    nodesExecuted += 1;
    providerTurns += execution.providerTurns;
    if (spendsACall(current)) {
      calls += 1;
    }
    const stepMs = now() - startedStepAt;

    record(
      'node-produced',
      `"${current.id}" produced ${describeProduct(execution.product)} after ${Math.round(
        stepMs / 1000,
      )}s. ${execution.summary}`,
      {
        nodeId: current.id,
        data: {
          product: execution.product.kind,
          stepMs,
          providerTurns: execution.providerTurns,
          callsSoFar: calls,
          ...(execution.archiveRef === undefined ? {} : { archiveRef: execution.archiveRef }),
          ...(placement?.writtenByAnotherNode
            ? { reportWrittenBy: placement.writtenBy, writesItsOwnReport: false }
            : {}),
        },
      },
    );

    // A bound on wall-clock time is how the runner *detects* a step that stopped
    // moving. It is not a route: the format says so, and this is the code that
    // means it. Checked before the product is trusted, because a step that came
    // back too late came back with an outcome nobody should act on.
    if (deadlineAt !== null && now() > deadlineAt) {
      return fail({
        kind: 'step-timed-out',
        nodeId: current.id,
        detail:
          `"${current.id}" is bounded at ${String(limits.maxMinutes)} minutes and took ` +
          `${Math.round(stepMs / 60_000)}. It reported ${describeProduct(execution.product)}, ` +
          `which the runner did not act on.`,
        reconcile: reconcileGuidance(graph, 'step-timed-out'),
      });
    }

    if (execution.product.kind === 'runtime-fault') {
      return fail({
        kind: execution.product.fault,
        nodeId: current.id,
        detail: `"${current.id}" reported a runtime fault: ${execution.product.detail}`,
        reconcile: reconcileGuidance(graph, execution.product.fault),
      });
    }

    if (execution.product.kind === 'awaiting-human') {
      const question = execution.product.question;
      record(
        'awaiting-human',
        `"${current.id}" is waiting for a person: ${question} Nothing was repeated and ` +
          `nothing was reset; the run's history stands as journalled.`,
        { nodeId: current.id, data: { question } },
      );
      return finish(
        'awaiting-human',
        `The run stopped at "${current.id}" for a human decision. This is not a fault and ` +
          `not a failure. Resuming from a journal is not implemented in this increment.`,
        { awaiting: { nodeId: current.id, question } },
      );
    }

    const undeclared = productIsDeclared(current, execution.product);
    if (undeclared) {
      return fail({
        kind: 'undeclared-product',
        nodeId: current.id,
        detail: `${undeclared} The graph cannot route what it does not declare.`,
        reconcile: reconcileGuidance(graph, 'undeclared-product'),
      });
    }

    const selected = selectEdge(graph, current, execution.product);
    if (selected.edge === null) {
      return fail({
        kind: 'no-edge-for-product',
        nodeId: current.id,
        detail:
          `${selected.why} A validated graph cannot be in this state, so either this graph ` +
          `was not validated or the executor answered for a different graph.`,
        reconcile: reconcileGuidance(graph, 'no-edge-for-product'),
      });
    }

    const productEdge = selected.edge;
    const isRework =
      execution.product.kind === 'outcome' && reworkOutcomes.includes(execution.product.outcome);

    // Bounds are checked after the step that spends them and before its edge is
    // taken, so the record shows the work that used the last of the room rather
    // than a run that stopped just short of doing any. A bound is spent when
    // there is no room for another call, or when another rework round would be
    // one too many.
    const spent = boundsSpent({ graph, calls, reworkRounds, isRework, reworkOutcomes });
    if (spent && !boundsAlreadyRouted.has(spent.bound)) {
      limitsReached.push(spent.bound);
      record('limit-reached', spent.detail, {
        nodeId: current.id,
        data: {
          bound: spent.bound,
          limit: spent.limit,
          reached: spent.reached,
          declaredFailure: false,
          runtimeFault: false,
        },
      });

      const boundEdge = options.routeLimitAs
        ? routeForSpentBound(graph, current, options.routeLimitAs)
        : null;
      if (!boundEdge) {
        return finish(
          'limit-reached',
          `${spent.detail} ${
            options.routeLimitAs
              ? `The graph draws no "${options.routeLimitAs}" route from "${current.id}", so the ` +
                `run stops here with its result and a proposed next step rather than starting ` +
                `again with the counter reset.`
              : `No failure kind was nominated as the run's bounds, so the run stops here with ` +
                `its result and a proposed next step.`
          } Edge "${productEdge.id}", which this step's own ${describeProduct(
            execution.product,
          )} would have taken, was not taken.`,
        );
      }
      const boundTarget = nodeById.get(boundEdge.to);
      if (!boundTarget) {
        return fail({
          kind: 'edge-target-missing',
          nodeId: current.id,
          edgeId: boundEdge.id,
          detail: `Edge "${boundEdge.id}" points at "${boundEdge.to}", which is not a node in this graph.`,
          reconcile: reconcileGuidance(graph, 'edge-target-missing'),
        });
      }
      boundsAlreadyRouted.add(spent.bound);
      transitions += 1;
      edgesTaken.push(boundEdge.id);
      record(
        'edge-taken',
        `Took edge "${boundEdge.id}" from "${current.id}" to "${boundEdge.to}"${
          boundEdge.label ? ` (${boundEdge.label})` : ''
        }, which is where this graph sends a spent bound — instead of "${productEdge.id}", which ` +
          `the step's own result would have taken. The bound is recorded as reached rather than ` +
          `as a failure of the work: nothing went wrong, the run ran out of room.`,
        {
          edgeId: boundEdge.id,
          nodeId: current.id,
          data: {
            from: current.id,
            to: boundEdge.to,
            when: boundEdge.when.on,
            boundRouted: spent.bound,
            insteadOf: productEdge.id,
            declaredFailure: false,
            runtimeFault: false,
            transitions,
          },
        },
      );
      current = boundTarget;
    } else {
      const target = nodeById.get(productEdge.to);
      if (!target) {
        return fail({
          kind: 'edge-target-missing',
          nodeId: current.id,
          edgeId: productEdge.id,
          detail: `Edge "${productEdge.id}" leaves "${current.id}" for "${productEdge.to}", which is not a node in this graph.`,
          reconcile: reconcileGuidance(graph, 'edge-target-missing'),
        });
      }
      transitions += 1;
      edgesTaken.push(productEdge.id);
      if (isRework) {
        reworkRounds += 1;
      }
      record(
        'edge-taken',
        `Took edge "${productEdge.id}" from "${current.id}" to "${productEdge.to}"${
          productEdge.label ? ` (${productEdge.label})` : ''
        }. ${selected.why}`,
        {
          edgeId: productEdge.id,
          nodeId: current.id,
          data: {
            from: current.id,
            to: productEdge.to,
            when: productEdge.when.on,
            ...(productEdge.when.on === 'outcome' ? { outcome: productEdge.when.outcome } : {}),
            ...(productEdge.when.on === 'declared-failure'
              ? { failure: productEdge.when.failure }
              : {}),
            declaredFailure: productEdge.when.on === 'declared-failure',
            runtimeFault: false,
            reworkRound: isRework,
            transitions,
          },
        },
      );
      current = target;
    }

    if (transitions >= maxTransitions) {
      return fail({
        kind: 'transition-budget-spent',
        nodeId: current.id,
        detail:
          `The run made ${transitions} transitions, which is the runner's own bound of ` +
          `${maxTransitions}. The format expresses no per-edge loop counter, so a cycle whose ` +
          `exit is never produced is stopped here rather than run forever.`,
        reconcile: reconcileGuidance(graph, 'transition-budget-spent'),
      });
    }
  }
}

interface SpentBound {
  readonly bound: string;
  readonly limit: number;
  readonly reached: number;
  readonly detail: string;
}

function boundsSpent(input: {
  readonly graph: LoopGraph;
  readonly calls: number;
  readonly reworkRounds: number;
  readonly isRework: boolean;
  readonly reworkOutcomes: readonly string[];
}): SpentBound | null {
  const limits = input.graph.limits;
  if (!limits) {
    return null;
  }
  if (limits.maxCalls !== undefined && input.calls >= limits.maxCalls) {
    return {
      bound: 'maxCalls',
      limit: limits.maxCalls,
      reached: input.calls,
      detail:
        `The run has spent ${input.calls} of its ${limits.maxCalls} calls, so there is no room ` +
        `for another. Reaching a bound is reaching a bound: no step failed, and no step ` +
        `declared this.`,
    };
  }
  if (
    input.isRework &&
    limits.maxReworkRounds !== undefined &&
    input.reworkRounds + 1 > limits.maxReworkRounds
  ) {
    return {
      bound: 'maxReworkRounds',
      limit: limits.maxReworkRounds,
      reached: input.reworkRounds,
      detail:
        `This would be rework round ${input.reworkRounds + 1} of a permitted ` +
        `${limits.maxReworkRounds}, counting edges whose outcome is ${input.reworkOutcomes.join(
          ' or ',
        )}. The bound is spent, which is not a failure of the review that asked for the rework.`,
    };
  }
  return null;
}

/** The edge a spent bound may take, when the graph actually draws one from here. */
function routeForSpentBound(
  graph: LoopGraph,
  node: LoopNode,
  failureKind: string,
): LoopEdge | null {
  if (!(node.declaredFailures ?? []).includes(failureKind)) {
    return null;
  }
  return (
    graph.edges.find(
      (edge) =>
        edge.from === node.id &&
        edge.when.on === 'declared-failure' &&
        edge.when.failure === failureKind,
    ) ?? null
  );
}

/* ------------------------------------------------------------------------- */
/* A dry run                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * A clock the caller advances, so a run's timing is a decision rather than a wait.
 *
 * This is what makes a timeout demonstrable: a scripted step can take two hours in
 * a test that finishes in a millisecond, and the fault the runner raises is the same
 * one a real hang would raise.
 */
export interface TestClock {
  readonly now: () => number;
  readonly advanceMinutes: (minutes: number) => void;
}

export function createClock(startMs = Date.parse('2026-09-16T00:00:00.000Z')): TestClock {
  let current = startMs;
  return {
    now: () => current,
    advanceMinutes: (minutes: number) => {
      current += minutes * 60_000;
    },
  };
}

/** One scripted answer for one step. */
export interface DryRunDecision {
  readonly node: string;
  /** 1-based visit. Omitted means every visit not claimed by a numbered decision. */
  readonly occurrence?: number;
  readonly produce: StepProduct;
  /** How long the step is to have taken. This is how a timeout is demonstrated. */
  readonly minutes?: number;
  readonly summary?: string;
}

export interface DryRunOptions {
  readonly decisions?: readonly DryRunDecision[];
  /** Advanced by each decision's `minutes`. Supply the same clock the runner uses. */
  readonly clock?: TestClock;
  /**
   * What an unscripted node does. `first-branch` takes a node's first declared
   * outcome, which walks the graph's default path; `awaiting-human` stops at the
   * first `human` node, which is what a run with autonomy off would do.
   */
  readonly unscripted?: 'first-branch' | 'awaiting-human-at-human-nodes';
}

/**
 * An executor with no provider, which is what a dry run is.
 *
 * The guarantee is structural rather than promised: this function closes over
 * nothing that could reach Cursor, so there is no code path from a dry run to a
 * billed turn. It reports `providerTurns: 0` because it spent none.
 */
export function createDryRunExecutor(options: DryRunOptions = {}): StepExecutor {
  const used = new Set<number>();
  const unscripted = options.unscripted ?? 'first-branch';

  return async (context: StepContext): Promise<StepExecution> => {
    const decisions = options.decisions ?? [];
    let index = decisions.findIndex(
      (decision, position) =>
        decision.node === context.node.id &&
        decision.occurrence === context.occurrence &&
        !used.has(position),
    );
    if (index < 0) {
      index = decisions.findIndex(
        (decision, position) =>
          decision.node === context.node.id &&
          decision.occurrence === undefined &&
          !used.has(position),
      );
    }
    const decision = index >= 0 ? decisions[index] : undefined;
    if (index >= 0 && decision?.occurrence !== undefined) {
      used.add(index);
    }

    if (decision) {
      if (decision.minutes !== undefined) {
        options.clock?.advanceMinutes(decision.minutes);
      }
      return {
        product: decision.produce,
        summary:
          decision.summary ??
          `Scripted dry run: no provider was called, and nothing was written. ${
            context.archive
              ? `A real run would file ${context.archive.path}, written by "${context.archive.writtenBy}".`
              : 'This graph declares no archive.'
          }`,
        providerTurns: 0,
      };
    }

    const declared = context.node.outcomes ?? [];
    if (
      unscripted === 'awaiting-human-at-human-nodes' &&
      context.node.kind === 'human'
    ) {
      return {
        product: {
          kind: 'awaiting-human',
          question: `"${context.node.id}" is a human step: ${
            context.node.purpose ?? 'a person has to act'
          }`,
        },
        summary: 'A dry run does not answer for a person.',
        providerTurns: 0,
      };
    }

    const first = declared[0];
    return {
      product: first === undefined ? { kind: 'success' } : { kind: 'outcome', outcome: first },
      summary:
        first === undefined
          ? 'Unscripted dry run: plain success, no provider called.'
          : `Unscripted dry run: took this node's first declared outcome, "${first}". No provider called.`,
      providerTurns: 0,
    };
  };
}

/* ------------------------------------------------------------------------- */
/* The journal, for a person                                                  */
/* ------------------------------------------------------------------------- */

const MARKERS: Readonly<Record<JournalKind, string>> = {
  'run-started': '>>',
  'node-entered': ' >',
  'node-produced': ' =',
  'edge-taken': '->',
  'limit-reached': '[]',
  'runtime-fault': '!!',
  'awaiting-human': '??',
  'run-ended': '<<',
  refused: 'XX',
  'run-held': '||',
  'run-released': '|>',
  'waiting-for-person': '?|',
  'person-answered': '?>',
};

/**
 * The journal as text, which is the form DSP-18 #3 is actually about.
 *
 * One line per entry with the node or edge it concerns, the time since the run
 * started, and the reason — so that reconstructing a run is reading a file rather
 * than trusting an agent's account of it.
 */
export function formatRunJournal(result: RunResult): string {
  const head = [
    `run        ${result.runId}`,
    `graph      ${result.graphId}`,
    `mode       ${result.dryRun ? 'dry run (no provider reachable, 0 turns spent)' : 'live'}`,
    `started    ${result.startedAtIso}`,
    `ended      ${result.endedAtIso}`,
    `status     ${result.status}`,
    `path       ${result.path.join(' -> ')}`,
    `edges      ${result.edgesTaken.length > 0 ? result.edgesTaken.join(', ') : '(none)'}`,
    `usage      ${result.usage.calls} calls, ${result.usage.providerTurns} provider turns, ` +
      `${result.usage.reworkRounds} rework rounds, ${result.usage.transitions} transitions`,
    `bounds     ${result.limitsReached.length > 0 ? `reached: ${result.limitsReached.join(', ')}` : 'none reached'}`,
  ];
  if (result.fault) {
    head.push(`fault      ${result.fault.kind}: ${result.fault.detail}`);
    head.push(`reconcile  ${result.fault.reconcile}`);
  }
  if (result.awaiting) {
    head.push(`awaiting   ${result.awaiting.nodeId}: ${result.awaiting.question}`);
  }
  if (result.refusal) {
    head.push(`refused    ${result.refusal}`);
  }

  const lines = result.journal.map((entry) => formatJournalEntry(entry));

  return [...head, '', ...lines, ''].join('\n');
}

/** One journal entry as the window shows it while a live run is still walking. */
export function formatJournalEntry(entry: RunJournalEntry): string {
  const where = entry.edgeId
    ? `edge ${entry.edgeId}`
    : entry.nodeId
      ? `node ${entry.nodeId}`
      : 'run';
  const seconds = (entry.sinceStartMs / 1000).toFixed(1).padStart(7);
  const data = entry.data
    ? Object.entries(entry.data)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')
    : '';
  return [
    `${String(entry.seq).padStart(3)} ${seconds}s ${MARKERS[entry.kind]} ${entry.kind.padEnd(14)} ${where}`,
    `        ${entry.detail}`,
    ...(data === '' ? [] : [`        · ${data}`]),
  ].join('\n');
}

/** The journal as one JSON object per line, for anything that wants to read it back. */
export function journalToJsonl(result: RunResult): string {
  return `${result.journal.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}
