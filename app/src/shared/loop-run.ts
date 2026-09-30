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

import type { LoopEdge, LoopGraph, LoopNode, ResultForm, StepLimits } from './loop-graph';
import { isWorkStep, stepWorkFor, type StepHold, type StepRef } from './loop-control';
import {
  bodyBytes,
  resultHandedOver,
  storedResultRef,
  type OutcomeSource,
  type ProducedOutcome,
  type RecordedResult,
  type ResultStore,
} from './loop-results';

/** What a step produced, in the only four shapes the runner understands. */
export type StepProduct =
  /** Done, nothing to branch on. Routes on the node's `success` edge. */
  | { readonly kind: 'success' }
  /**
   * One of the node's declared `outcomes`: a router's branch, a gate's verdict.
   *
   * `source` is DSP-103 #5 and it changes no routing: the edge taken for an outcome is
   * the same whoever chose it. What it changes is what the record and the next step can
   * say.
   *
   * **Absent means nobody recorded it, and is read as `unknown`** (#8). It used to mean
   * `step-declared`, which put a gate's exit code, a router's branch and every product a
   * caller had not thought about on record as an agent's own verdict. Every producer in
   * this build states its own instead (#9) — the reply's declared line, the engine's
   * fallback, a gate's command, a router's configuration, a dry run standing in — so an
   * absence here is a product from something that did not, and the record says that much
   * and no more.
   */
  | {
      readonly kind: 'outcome';
      readonly outcome: string;
      readonly source?: OutcomeSource;
    }
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
  /**
   * A step that had to leave a result left none, or a step that had to receive one
   * could not be given it.
   *
   * Its own kind rather than `no-outcome-delivered`, and the difference is what the
   * reconcile sentence can then say: *which* result was required, where it was
   * expected and who was to file it. A step that produced a perfectly routable outcome
   * and filed nothing is not a step that delivered no outcome — it is a step whose
   * outcome says the work is done and whose evidence is absent, which is the more
   * dangerous of the two and used to be the silent one.
   *
   * **Deliberately not an edge.** The format refuses a declared failure named
   * `missing-report`, `no-result` or `not-delivered`, and that refusal is right: an
   * edge routes onward, and a missing required result is exactly the case where
   * nothing should route onward. Under `stop-and-reconcile` the run stops and a person
   * establishes what happened, which is more explicit than a branch, not less.
   */
  'required-result-missing',
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

/**
 * The edge the run took to get here, as the arriving step's own address for it.
 *
 * DSP-100. The walk always knew which edge it had just taken and threw the fact away at
 * the top of the next iteration, so a step could not be told why it was there and the
 * inputs it was given could not depend on how it was reached. `null` for the entry node,
 * which nothing routed to.
 */
export interface ArrivalRef {
  readonly edgeId: string;
  /** The node the run came from. */
  readonly from: string;
  /**
   * Which visit of `from` produced the outcome that took this edge.
   *
   * The half of the binding nothing else can supply. "The latest result of that node" is
   * the same answer almost always and is the wrong question: what routed the run here is
   * one particular visit, and on the third pass round a loop the difference is a review
   * of the wrong attempt.
   */
  readonly fromOccurrence: number;
  readonly label: string | null;
  /** What the edge says it delivers, or `null` where it says nothing and the node decides. */
  readonly delivers: readonly string[] | null;
}

/** Which earlier steps this step is given, and what decided. */
export interface StepInputs {
  /** Node ids, in the order the deciding declaration lists them. */
  readonly ids: readonly string[];
  /** `edge` when the arrival declared them; `node` when the node's own `consumes` did. */
  readonly from: 'edge' | 'node';
  /** The edge that decided, or `null` when the node did. */
  readonly edgeId: string | null;
}

/**
 * What a step receives, decided by the edge that brought the run to it.
 *
 * The whole rule, in one place and as a pure function, because it is the sentence the
 * card is about and it should be readable and testable without a walk around it:
 * **an arrival that says what it delivers decides; one that says nothing leaves the
 * node's own `consumes` deciding, exactly as before.**
 *
 * An edge's empty list is a statement and not an absence: *this arrival hands over
 * nothing*. That is how a graph says a first visit needs no earlier result while a later
 * arrival at the same node needs one, which is the case that stopped runs at their first
 * step before the field existed. `undefined` — the field not written at all — is the
 * silence that falls back, so every graph drawn before DSP-100 is untouched.
 */
export function inputsFor(
  node: Pick<LoopNode, 'consumes'>,
  arrival: Pick<ArrivalRef, 'edgeId' | 'delivers'> | null,
): StepInputs {
  if (arrival !== null && arrival.delivers !== null) {
    return { ids: arrival.delivers, from: 'edge', edgeId: arrival.edgeId };
  }
  return { ids: node.consumes ?? [], from: 'node', edgeId: null };
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
   * How the run got here, or `null` at the entry node. See {@link ArrivalRef}.
   */
  readonly arrivedBy: ArrivalRef | null;
  /**
   * The earlier results this step was given, in the order the deciding declaration
   * lists them.
   *
   * One entry per id in {@link inputsFor}'s answer — the arriving edge's `delivers`
   * where it has one, and the node's own `consumes` otherwise — each resolved within
   * *this run* to a particular visit of that node. Never partial: an input that has
   * been left nothing stops the run before the step starts, because a step handed an
   * empty report would go on to do work about nothing.
   */
  readonly received: readonly RecordedResult[];
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
  /**
   * Where `path` actually is, once the run has somewhere to keep its results.
   *
   * `null` in a run with no store, which is what a dry run is: the placement is still
   * computed and still reported, because saying what a real run *would* file is the
   * whole value of a dry run, and there is simply nowhere for it to be.
   */
  readonly location: string | null;
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
  /**
   * The body of what this step produced, whole, when the runner is the one to file it.
   *
   * One string, handed over once. The runner writes exactly these bytes and records
   * exactly this string, so the copy on disk and the copy anything shows are the same
   * copy — a step that returned a body here and *also* wrote its own summary somewhere
   * would be the shape this field exists to make unnecessary.
   *
   * Ignored where the graph says the node files its own entry: there the file is
   * canonical and the runner reads it rather than writing beside it.
   */
  readonly resultBody?: string;
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
  /**
   * A step's required result was filed, or found where the graph said it would be.
   *
   * Its own line rather than a field on `node-produced`, because the two answer
   * different questions and can disagree: a step can produce a routable outcome and
   * leave nothing, which is the case this whole mechanism exists for. A reader
   * reconstructing a run needs to see the outcome and the evidence as two statements.
   */
  'result-filed',
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
  /**
   * What the run's steps left, in the order they left it.
   *
   * The run record's own copy, so a result is retrievable by run, node and visit
   * without going back to the filesystem — `resultOfVisit` is the lookup. A run whose
   * graph asks for nothing carries an empty list and is unchanged by this field's
   * existence.
   */
  readonly results: readonly RecordedResult[];
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
  /**
   * Where the results this graph requires are filed and looked for.
   *
   * Left out, nothing is filed and nothing is checked — which is exactly right for a
   * graph that requires nothing, and is refused for one that does. A live run that
   * required results and was given nowhere to keep them would either lose them or
   * report a check it never made, and both are the silence this card exists to end. A
   * dry run is the one exception and says so in its journal: it has no store because
   * it reaches no filesystem at all, so it reports the placement a real run would use
   * and writes nothing at it.
   */
  readonly resultStore?: ResultStore;
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
  store: ResultStore | undefined,
): ArchivePlacement | null {
  const archive = graph.archive;
  if (!archive) {
    return null;
  }
  const base = (node.report?.path ?? archive.path).replaceAll('<run-id>', runId);
  const writtenBy = node.report?.writtenBy ?? 'self';
  const sequence = String(callId).padStart(3, '0');
  const path = `${base}${base.endsWith('/') ? '' : '/'}${sequence}-${node.id}.md`;
  return {
    path,
    writtenBy: writtenBy === 'self' ? node.id : writtenBy,
    writtenByAnotherNode: writtenBy !== 'self',
    location: store?.locate(path) ?? null,
  };
}

/**
 * Whether this graph needs somewhere to keep results, which decides whether a run
 * without a store may start at all.
 *
 * **Two halves, and the second was missing until a real graph declared both.** A node
 * that must *leave* a result obviously needs a store. So does a node that *receives*
 * one: the result it is waiting for can only arrive through the store, so a run with
 * nowhere to file would reach that node, find nothing, and stop with a fault blaming
 * the producing step for an absence the run made certain of before it started. The
 * graph is fine; the run was never equipped.
 *
 * Found by declaring `produces` and `consumes` on `dspatch-development-loop` and
 * `dspatch-chat-loop` — the first shipped graphs to use either — which is precisely
 * what DSP-74's report said fixtures would not find.
 *
 * The edges are asked too (DSP-100). A drawing can now hand work over on the arrival
 * alone, with no node declaring `consumes` at all, and such a run needs a store for
 * exactly the reason above: the result can only arrive through one.
 */
function requiresAResult(graph: LoopGraph): boolean {
  return (
    graph.nodes.some(
      (node) =>
        (node.produces?.required === true && node.produces.form !== 'none') ||
        (node.consumes?.length ?? 0) > 0,
    ) || graph.edges.some((edge) => (edge.delivers?.length ?? 0) > 0)
  );
}

/**
 * Why there is no usable body here, or `null` when there is one.
 *
 * The **only** place the runner looks inside a result, and all it looks for is whether
 * anything is in it. A file of blank lines is not a result: there is nothing for a
 * later step to read and nothing for a person to check, and accepting it would be the
 * silence this whole mechanism exists to end, wearing a filename.
 *
 * One function so the rule is one rule. It used to be written twice, and the two copies
 * did not agree: a runner-filed body of whitespace stopped the run while a *self-filed*
 * file containing exactly the same whitespace was accepted, so the same content meant
 * two different things depending on who wrote it and nothing said so.
 *
 * Note what it still does not do. It does not ask whether the body is long enough, has
 * the right sections, or describes the work — that is judgement, and judgement belongs
 * to the appointed agents or to the person.
 */
function noUsableBody(body: string | undefined): string | null {
  if (body === undefined) {
    return 'It handed back no body at all.';
  }
  if (body.trim() === '') {
    return (
      `What is there is nothing but whitespace, which is not a result: there is nothing ` +
      `for a later step to read and nothing for a person to check.`
    );
  }
  return null;
}

/**
 * What a step left, or the fault that says it did not.
 *
 * The whole of the runner's judgement about results, and the list of what it does
 * **not** do is the important half: it does not measure a body, does not compare one
 * against a schema and does not care what the work was. It asks whether the result is
 * there — see {@link noUsableBody} for the whole of what "there" means — and whether it
 * belongs to this run, this node and this visit. Everything past that belongs to the
 * appointed agents or to the person.
 */
function settleResult(input: {
  readonly node: LoopNode;
  readonly runId: string;
  readonly occurrence: number;
  readonly callId: number;
  readonly placement: ArchivePlacement | null;
  readonly execution: StepExecution;
  readonly store: ResultStore | undefined;
}): { readonly record: RecordedResult | null; readonly fault: RuntimeFault | null } {
  const { node, placement, store } = input;
  const policy = node.produces;
  const nothing = { record: null, fault: null };
  if (policy === undefined || policy.form === 'none' || store === undefined) {
    return nothing;
  }
  const bind = (
    form: Exclude<ResultForm, 'none'>,
    parts: {
      readonly ref: string;
      readonly path: string | null;
      readonly digest: string;
      readonly bytes: number;
      readonly body: string;
      readonly filedByTheRunner: boolean;
    },
  ): { readonly record: RecordedResult; readonly fault: null } => {
    // The outcome travels with the body (DSP-103 #5), because the step that receives
    // this is given the record and nothing else: without it, "the implementer said it
    // was done" and "the implementer said nothing and the run routed it" arrive in the
    // same shape, and the receiving step has no way to ask.
    const produced = producedOutcomeOf(input.execution.product);
    return {
      record: {
        runId: input.runId,
        nodeId: node.id,
        occurrence: input.occurrence,
        callId: input.callId,
        form,
        ...(produced === null ? {} : { outcome: produced }),
        filedBy: placement?.writtenBy ?? node.id,
        ...parts,
      },
      fault: null,
    };
  };
  const missing = (detail: string, reconcile: string): { record: null; fault: RuntimeFault } => ({
    record: null,
    fault: { kind: 'required-result-missing', nodeId: node.id, detail, reconcile },
  });
  const whoAndWhere = (where: string): string =>
    `"${node.id}" (visit ${String(input.occurrence)}, call ${String(input.callId)}) was to leave ` +
    `a result ${where}, and the graph marks it required.`;
  const stopped =
    `The run stopped here rather than treating the absence as a delivery, and nothing was ` +
    `repeated. Establish whether the step did the work and failed to file it, or did not do ` +
    `it: those need different answers, and the step's own outcome cannot tell them apart. ` +
    `Do not treat this as a declared failure: no edge was taken.`;

  if (policy.form === 'stored-result') {
    const body = input.execution.resultBody;
    const unusable = noUsableBody(body);
    if (unusable !== null || body === undefined) {
      return policy.required
        ? missing(`${whoAndWhere('in the run record')} ${unusable ?? ''}`.trim(), stopped)
        : nothing;
    }
    return bind('stored-result', {
      ref: storedResultRef(input.runId, node.id, input.occurrence),
      path: null,
      digest: store.digest(body),
      bytes: bodyBytes(body),
      body,
      filedByTheRunner: true,
    });
  }

  // A markdown file, and the graph has to have said where. Validation refuses a node
  // that requires one with nowhere for it to land, so reaching this is a graph that was
  // never validated — which the runner has to survive rather than assume away.
  if (placement === null) {
    return missing(
      `${whoAndWhere('as a Markdown file')} This graph declares no archive and this node no ` +
        `report path, so there is nowhere the file could be and nothing to check.`,
      `The graph is at fault, not the step. Give the graph an "archive" path, or the node a ` +
        `"report": {"path": "..."}, and validate it before running it again. ${stopped}`,
    );
  }

  // Who files it decides what happens here, and this is `report.writtenBy` finally being
  // acted on. A node the graph says cannot write has its body written **by the runner**,
  // at the placement the graph computed — the 15 September mistake, closed. A node that
  // files its own is checked for presence and nothing else: the file it wrote is the
  // canonical body, and the runner reads it rather than writing a second one beside it.
  if (placement.writtenByAnotherNode) {
    const body = input.execution.resultBody;
    const unusable = noUsableBody(body);
    if (unusable !== null || body === undefined) {
      return policy.required
        ? missing(
            `${whoAndWhere(`at ${placement.location ?? placement.path}, filed for it because ` +
              `the graph says "${placement.writtenBy}" writes it`)} ${unusable ?? ''} There was ` +
              `nothing to file.`.trim(),
            stopped,
          )
        : nothing;
    }
    const written = store.put(placement.path, body);
    if (!written.ok) {
      return missing(
        `${whoAndWhere(`at ${placement.location ?? placement.path}`)} It produced a body and ` +
          `filing it failed: ${written.why}`,
        `The step's work is not lost — it is in the run record — but it is not where the graph ` +
          `says it belongs. ${stopped}`,
      );
    }
    return bind('markdown-file', {
      ref: placement.path,
      path: placement.location ?? placement.path,
      digest: written.digest,
      bytes: written.bytes,
      body,
      filedByTheRunner: true,
    });
  }

  const found = store.get(placement.path);
  // A file of blank lines is the same absence as no file, and says so in the same
  // words. Which of the two it is still matters to whoever reconciles it — one means
  // the step never wrote, the other that it wrote nothing — so both are named.
  const emptiness = found === null ? 'Nothing is there.' : noUsableBody(found.body);
  if (found === null || emptiness !== null) {
    return policy.required
      ? missing(
          `${whoAndWhere(`at ${placement.location ?? placement.path}`)} ${emptiness ?? ''} The ` +
            `graph says this node files its own, so nobody else was going to.`,
          stopped,
        )
      : nothing;
  }
  return bind('markdown-file', {
    ref: placement.path,
    path: placement.location ?? placement.path,
    digest: found.digest,
    bytes: found.bytes,
    // Read back rather than taken from anything the step said about it. That is what
    // makes the stored copy and the shown copy the same copy: there is one body, it is
    // the bytes in the file, and nothing here can write a different one.
    body: found.body,
    filedByTheRunner: false,
  });
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

/**
 * The provenance a product states, with the absent-is-`unknown` rule applied once.
 *
 * DSP-103 #8. The rule lives here so the journal's sentence, the journal's structured
 * entry and the filed record cannot each pick their own default — which is how the
 * reversed one got into all three at once.
 */
function provenanceOf(product: Extract<StepProduct, { readonly kind: 'outcome' }>): OutcomeSource {
  return product.source ?? 'unknown';
}

/**
 * The outcome a product carries and whose it is, or `null` for a product with none.
 *
 * Always states a `source`, so a record this build writes never leaves the question open.
 * {@link import('./loop-results').outcomeProvenance} is the matching reader for a record
 * that comes back from somewhere older than the field.
 */
export function producedOutcomeOf(product: StepProduct): ProducedOutcome | null {
  return product.kind === 'outcome'
    ? { name: product.outcome, source: provenanceOf(product) }
    : null;
}

function describeProduct(product: StepProduct): string {
  switch (product.kind) {
    case 'success':
      return 'success';
    case 'outcome': {
      // Named as the engine's only where it is the engine's, and named as unrecorded
      // where nothing recorded it. A declared outcome, a gate's verdict and a router's
      // branch read exactly as they always have — the structured entry beside this
      // sentence carries which — so the journal's ordinary lines are unchanged and these
      // two clauses are worth noticing where they do appear.
      const provenance = provenanceOf(product);
      if (provenance === 'engine-fallback') {
        return `outcome "${product.outcome}", which the run selected because the reply declared none`;
      }
      if (provenance === 'unknown') {
        return `outcome "${product.outcome}", with nothing recorded about who chose that name`;
      }
      return `outcome "${product.outcome}"`;
    }
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
  const results: RecordedResult[] = [];
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
      results,
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

  // A graph that requires results, and a run with nowhere to keep them.
  //
  // Refused rather than started, because the alternative is a run that walks to a
  // terminal with every required result unchecked and a status of `completed` — which
  // is precisely "silence read as delivery", produced by the machinery that exists to
  // prevent it. A dry run is the one honest exception and is not a special case in the
  // checking code below: it has no store because it reaches no filesystem at all, so it
  // says here what it would have filed and files nothing.
  if (requiresAResult(graph) && options.resultStore === undefined) {
    if (!options.dryRun) {
      const refusal =
        `This graph requires at least one step to leave a result, and this run was given ` +
        `nowhere to file one. A run that cannot file a required result cannot check for it ` +
        `either, and a run that reported "completed" without having checked would be the ` +
        `silence the requirement exists to end. Nothing was executed.`;
      return finish('refused', refusal, { refusal });
    }
    record(
      'result-filed',
      `This graph declares results and this is a dry run, which has no store and reaches no ` +
        `filesystem. Each step below reports the entry a real run would file at the path ` +
        `computed from the graph's archive, and nothing is written or checked. Nothing is ` +
        `handed over either: a step that receives an earlier result gets none here, and that ` +
        `is the dry run having filed nothing rather than a step having left nothing.`,
      { data: { filed: false, dryRun: true } },
    );
  }

  if (maxTasks !== undefined && maxTasks < 1) {
    const refusal =
      `The graph's limits allow maxTasks ${maxTasks}, and a run is one task, so this run ` +
      `would exceed its bound before starting. Nothing was executed.`;
    limitsReached.push('maxTasks');
    return finish('refused', refusal, { refusal });
  }

  let current: LoopNode = entry;
  /**
   * The edge that brought the run to `current`, which is what lets a step's inputs and
   * its brief depend on how it was reached. `null` at the entry, which nothing routed to.
   */
  let arrival: ArrivalRef | null = null;
  const arrivalOn = (edge: LoopEdge, fromNode: LoopNode, fromOccurrence: number): ArrivalRef => ({
    edgeId: edge.id,
    from: fromNode.id,
    fromOccurrence,
    label: edge.label ?? null,
    delivers: edge.delivers ?? null,
  });

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

    const placement = archivePlacement(graph, current, options.runId, callId, options.resultStore);
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
          // Which arrival this was, because what the step is given now depends on it
          // (DSP-100). A run record that named only the node could not explain why two
          // visits to one node were handed different material.
          ...(arrival === null
            ? {}
            : { arrivedBy: arrival.edgeId, arrivedFrom: arrival.from }),
          ...(current.model ? { model: current.model.policy } : {}),
          ...(limits.maxMinutes === undefined ? {} : { maxMinutes: limits.maxMinutes }),
          ...(placement
            ? { archive: placement.path, reportWrittenBy: placement.writtenBy }
            : {}),
        },
      },
    );

    // What this step receives, resolved before it starts (DSP-75, DSP-100).
    //
    // **Decided by the arrival, not by the node alone.** `inputsFor` is the whole rule:
    // an edge that says what it delivers decides, and one that says nothing leaves the
    // node's `consumes` deciding exactly as it did. That is what makes a rework round
    // carry the review that asked for it while the first visit to the same node is not
    // made to require a result no earlier step could have left.
    //
    // **To a visit, never to a node**, and now to the *right* visit rather than the
    // newest. `resultHandedOver` checks the run, the node and — where the arrival names
    // the step it came from — the exact visit that produced the outcome that routed the
    // run here. Handing over an earlier one would be the trap DSP-31 named for human
    // answers: an old answer arriving at a new question, looking exactly like a fresh one.
    //
    // An input that has been left nothing stops the run. Validation refuses a graph whose
    // handovers cannot be satisfied by any path through it, so arriving here means the run
    // took a path where it genuinely was not produced — and the one thing that must not
    // happen is the step starting with an empty input, doing the work anyway, and
    // producing something about nothing.
    // A run that files nothing checks nothing, on both sides.
    //
    // `settleResult` has always returned early when there is no store; the receiving
    // side did not, so a dry run of any graph declaring `consumes` stopped at the first
    // receiving node with `required-result-missing` — blaming a step for an absence the
    // dry run itself guaranteed. A dry run is the *only* way to reach here with no
    // store, because a live run of a graph that hands anything over is refused above.
    const inputs = inputsFor(current, arrival);
    const received: RecordedResult[] = [];
    for (const wantedId of options.resultStore === undefined ? [] : inputs.ids) {
      // The producing node the arrival itself came from is pinned to the visit that took
      // the edge; anything else is that node's most recent completed visit in this run.
      const pinned =
        inputs.from === 'edge' && arrival !== null && wantedId === arrival.from
          ? arrival.fromOccurrence
          : undefined;
      const found = resultHandedOver(results, {
        runId: options.runId,
        nodeId: wantedId,
        ...(pinned === undefined ? {} : { occurrence: pinned }),
      });
      if (found === null) {
        // Which declaration asked for this, in the words of the thing a person would go
        // and edit. A handover that fails because of an edge sends the reader to that
        // edge; one that fails because of a node's standing list sends them to the node.
        const asked =
          inputs.from === 'edge'
            ? `arrived on edge "${String(inputs.edgeId)}"${
                arrival?.label === null || arrival?.label === undefined
                  ? ''
                  : ` (${arrival.label})`
              } from "${String(arrival?.from)}", and that edge delivers the result of ` +
              `"${wantedId}"`
            : `receives the result of "${wantedId}", which this node's own "consumes" declares`;
        return fail({
          kind: 'required-result-missing',
          nodeId: current.id,
          ...(inputs.edgeId === null ? {} : { edgeId: inputs.edgeId }),
          detail:
            `"${current.id}" (visit ${String(occurrence)}) ${asked}${
              pinned === undefined
                ? ''
                : ` as that step left it on visit ${String(pinned)}`
            }, and there is none in this run. The step was not started: a step given an ` +
            `empty result would do its work about nothing and report it as done.`,
          reconcile:
            inputs.from === 'edge'
              ? `The edge is where to look, not the node's own declaration: edge ` +
                `"${String(inputs.edgeId)}" says this arrival delivers "${wantedId}", and on the ` +
                `path this run took "${wantedId}" left nothing to deliver. Either the edge names ` +
                `a step that does not run before it, or that step ran and left nothing; those ` +
                `need different answers. The run stopped here and nothing was repeated. Do not ` +
                `treat this as a declared failure: no edge was taken from here.`
              : `Read the path this run took. Either "${wantedId}" has not run on it, which is a ` +
                `question about the graph's edges, or it ran and left nothing, which is a ` +
                `question about that step. The run stopped here and nothing was repeated. Do not ` +
                `treat this as a declared failure: no edge was taken.`,
        });
      }
      received.push(found);
    }

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
        arrivedBy: arrival,
        received,
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
    const producedOutcome = producedOutcomeOf(execution.product);

    record(
      'node-produced',
      `"${current.id}" produced ${describeProduct(execution.product)} after ${Math.round(
        stepMs / 1000,
      )}s. ${execution.summary}`,
      {
        nodeId: current.id,
        data: {
          product: execution.product.kind,
          // DSP-103 #5, in the structured record rather than only in the sentence. A
          // reader reconstructing the run has to be able to separate the step's own
          // verdict from the engine having routed on the absence of one, and `product`
          // alone says `outcome` for both.
          ...(producedOutcome === null
            ? {}
            : { outcome: producedOutcome.name, outcomeSource: producedOutcome.source }),
          stepMs,
          providerTurns: execution.providerTurns,
          callsSoFar: calls,
          // No `archiveRef` here, deliberately. This entry used to carry one taken
          // straight from the executor — a claim nobody checked — while `result-filed`
          // carries the reference the runner actually filed and verified, under the
          // same key. A reader looking up "the result's reference" could pick up
          // either, with nothing looking wrong. There is one reference now, it is the
          // checked one, and it is journalled in exactly one place.
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

    // Did this step leave what it had to leave? (DSP-74.)
    //
    // **After the step's own outcome and before its edge.** A step that timed out, was
    // cancelled or asked for a person has already returned above, and blaming one of
    // those for a missing report would send a person looking for the wrong thing. A
    // step that finished, though, is checked *before* anything routes onward: an
    // outcome saying the work is done and no evidence that it happened is the exact
    // case this must not wave through.
    const settled = settleResult({
      node: current,
      runId: options.runId,
      occurrence,
      callId,
      placement,
      execution,
      store: options.resultStore,
    });
    if (settled.fault !== null) {
      return fail(settled.fault);
    }
    if (settled.record !== null) {
      const filed = settled.record;
      results.push(filed);
      record(
        'result-filed',
        `"${current.id}" left its result ${
          filed.path === null ? 'in the run record' : `at ${filed.path}`
        }, ${
          filed.filedByTheRunner
            ? `filed by the runner${
                placement?.writtenByAnotherNode === true
                  ? ` because the graph says "${filed.filedBy}" writes this node's entry`
                  : ''
              }`
            : 'written by the step itself and found where the graph said it would be'
        }. ${String(filed.bytes)} bytes, sha-256 ${filed.digest.slice(0, 16)}.`,
        {
          nodeId: current.id,
          data: {
            archiveRef: filed.ref,
            form: filed.form,
            occurrence: filed.occurrence,
            callId: filed.callId,
            bytes: filed.bytes,
            digest: filed.digest,
            filedBy: filed.filedBy,
            filedByTheRunner: filed.filedByTheRunner,
          },
        },
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
      arrival = arrivalOn(boundEdge, current, occurrence);
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
            // What this arrival hands the next step, in the journal line for the arrival
            // itself. A reader reconstructing a run can otherwise only see which edge was
            // taken and not what travelled along it (DSP-100).
            ...(productEdge.delivers === undefined
              ? {}
              : { delivers: productEdge.delivers.join(', ') || '(nothing)' }),
          },
        },
      );
      arrival = arrivalOn(productEdge, current, occurrence);
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

  /**
   * The dry run named as the origin of its own outcomes (DSP-103 #9).
   *
   * Neither an agent's declaration nor a gate's verdict: a scripted decision was chosen
   * by whoever wrote the script and an unscripted one is the node's first declared
   * outcome, so `dry-run` is the most the record can support. A decision that states a
   * source of its own keeps it, which is how a fixture reproduces a real run's provenance
   * without a provider.
   */
  const fromTheDryRun = (product: StepProduct): StepProduct =>
    product.kind === 'outcome' && product.source === undefined
      ? { ...product, source: 'dry-run' }
      : product;

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
        product: fromTheDryRun(decision.produce),
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
      product:
        first === undefined
          ? { kind: 'success' }
          : { kind: 'outcome', outcome: first, source: 'dry-run' },
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
  'result-filed': '[=',
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
    `results    ${
      result.results.length === 0
        ? 'none required or none filed'
        : result.results
            .map(
              (filed) =>
                `${filed.nodeId}#${String(filed.occurrence)} ${filed.ref} ` +
                `${String(filed.bytes)}B ${filed.digest.slice(0, 16)}`,
            )
            .join('\n           ')
    }`,
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
