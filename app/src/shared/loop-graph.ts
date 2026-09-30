/**
 * The file between the editor and the runner: what a loop graph *is*.
 *
 * DSP-21 exists because [DSP-22](the editor) and DSP-18 (the runner) are meant to
 * be built in parallel, and the one thing they both need is this contract. So this
 * module is deliberately a contract and not a feature: types, the small closed
 * vocabularies validation can check a graph against, and two pure operations on a
 * graph. Loading and validation are in `loop-graph-load.ts`; nothing here touches
 * a filesystem, because the window imports it too.
 *
 * Three decisions are worth reading before the types.
 *
 * **A declared failure routes through the graph; a runtime fault does not.** An
 * outcome the loop understands — a wrong premise, a budget spent, a decision only
 * Niclas can make — changes the path, so it is an edge. A call that hangs, a report
 * that never arrives, a dead process: that is the machinery breaking, and it is the
 * runner's business through timeouts, the journal and resumption. It is deliberately
 * *not* expressible as an edge, and {@link RUNTIME_FAULT_WORDS} makes the attempt a
 * validation error rather than a silent misdesign. See {@link RuntimeFaultPolicy} for
 * the one seam between the two and how the format closes it.
 *
 * **Requirements are portable; mechanisms are not.** A node or a role says it must
 * not be able to write files. It does not say `readonly: true`, which is Cursor's
 * word for it. Each target answers the requirement natively, by other means, or not
 * at all, and the last one is said out loud rather than generating something that
 * reads as though the requirement holds. This is DSP-23's rule, adopted here so the
 * two formats cannot contradict each other.
 *
 * **The target is stored in the file.** The connected account may supply a default
 * for a *new* graph and nothing more. A stored graph opened on another machine must
 * mean what it meant on the first one — DSP-12 recorded what happens when the reader's
 * installation decides what the reader sees. A graph drawn for a target this account
 * cannot run is *not runnable here*: reported, never refused, never migrated.
 */

/** The marker that distinguishes a loop graph from any other JSON object. */
export const LOOP_GRAPH_FORMAT = 'dspatch-loop-graph';

/** Bumped only when a change would make an older DSpatch misread a file. */
export const LOOP_GRAPH_FORMAT_VERSION = 1;

/**
 * The frameworks on the map.
 *
 * Only `cursor` is described from behaviour anyone has seen. Claude Code is here
 * because Niclas is considering trying it, and Copilot because VISION.md asks for
 * it — for both, what this module states is documentation at best and is labelled
 * that way in {@link TARGET_CAPABILITIES}.
 */
export const LOOP_TARGETS = ['cursor', 'copilot', 'claude-code'] as const;
export type LoopTarget = (typeof LOOP_TARGETS)[number];

/**
 * What a node is, which is what determines how it may be wired.
 *
 * The list is closed and short on purpose, and every entry is drawn by
 * `docs/assets/agentloop_generisk.png` rather than anticipated:
 *
 * - `agent` — a role doing work: Implementer, Researcher, Tech Lead, Publisher.
 * - `gate` — a checkpoint that admits or rejects, such as *Plangrind* or the
 *   *Skeptic påståendegrind*. A gate may itself be performed by a role; the figure
 *   labels its gates with one.
 * - `router` — branches on a classification without doing the work, such as the
 *   *Slicetyp* diamond.
 * - `human` — a step where a person acts: *Du: godkänn och starta*.
 * - `external` — a participant this loop does not run and cannot bound, such as the
 *   figure's *Externa agenter*. Our own loop has none; the kind exists because the
 *   figure needs it, and a format that could not hold it would be a format that
 *   quietly redraws the picture.
 * - `terminal` — the run stops here, successfully.
 */
export const NODE_KINDS = ['agent', 'gate', 'router', 'human', 'external', 'terminal'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * What a step *requires*, in portable terms.
 *
 * Each entry is a requirement, not a mechanism, so that a target can answer it three
 * ways instead of one. `no-file-writes` is the load-bearing example: it is Cursor's
 * `readonly: true` in a generated agent file, it shaped this project's whole delivery
 * contract on 15 September 2026, and a target with no equivalent must not produce a role
 * that reads as though it were enforced. The same target can answer the same requirement
 * differently depending on **how the agent is started** — see {@link CapabilityPath}.
 */
export const REQUIREMENTS = [
  'no-file-writes',
  'background-execution',
  'fixed-model-selection',
  'no-subagent-delegation',
  'tool-restriction',
] as const;
export type RequirementId = (typeof REQUIREMENTS)[number];

/**
 * How a target answers a requirement.
 *
 * `other-means` and `unknown` are the two that matter. Collapsing them into "yes"
 * is the failure DSP-23 forbids, and collapsing either into "no" would refuse
 * graphs we can in fact run.
 */
export type CapabilityStatus =
  /** The framework enforces it itself. */
  | 'enforced'
  /** Achieved another way — a sandbox, a permission, or an instruction the agent is trusted to follow. Not enforced. */
  | 'other-means'
  /** There is no way to meet it here. A graph requiring it cannot be run against this target. */
  | 'unmet'
  /** Nobody has established either way. Not a pass. */
  | 'unknown';

export interface CapabilityAnswer {
  readonly status: CapabilityStatus;
  /** The mechanism, or why there is none, in one sentence a person can act on. */
  readonly how: string;
  /** Whether we watched this work, read that it works, or neither. */
  readonly evidence: 'observed' | 'documentation' | 'none';
}

/**
 * How the agent was started, which is what decides whether a mechanism is in play.
 *
 * DSP-96 part 2, from DSP-92's F3. A requirement is answered by a *mechanism*, and the
 * same framework offers different mechanisms depending on who opens the session:
 *
 * - `generated-agent-file` — DSpatch writes the framework's own agent definition (see
 *   `role-generate.ts`) and the framework runs it. `readonly: true` in that file is a
 *   real restriction applied by something other than the agent.
 * - `dspatch-walked-run` — DSpatch's own run engine opens the session through the
 *   adapter and sends the role as text. No agent definition is read, so a field in one
 *   answers nothing.
 *
 * The distinction is not decoration. Before this existed, `no-file-writes` read
 * `enforced` for every reader of the table, on the strength of a file the live path
 * never writes and never loads, and the graph editor, graph validation and the run's
 * own snapshot decision each treated a sentence in a role as a technical guarantee.
 */
export const CAPABILITY_PATHS = ['generated-agent-file', 'dspatch-walked-run'] as const;
export type CapabilityPath = (typeof CAPABILITY_PATHS)[number];

/**
 * One cell of the table: the answer, and where a path answers differently.
 *
 * The bare answer is the `generated-agent-file` one, because that is the path the
 * framework's own documentation describes and the one the table was written from.
 * `whenDSpatchWalksTheRun` is filled **only** where the mechanism named above is not the
 * mechanism in play on DSpatch's own path; absent means the same answer holds for both,
 * and that absence is a claim like any other.
 */
export interface CapabilityCell extends CapabilityAnswer {
  readonly whenDSpatchWalksTheRun?: CapabilityAnswer;
}

export type TargetCapabilities = Readonly<
  Record<LoopTarget, Readonly<Record<RequirementId, CapabilityCell>>>
>;

const NOT_RUN: CapabilityAnswer = {
  status: 'unknown',
  how:
    'Nothing has been run against this framework from this repository. Whatever we ' +
    'believe about it is documentation nobody has tested, so a graph targeting it ' +
    'cannot be checked here — only reported as unchecked.',
  evidence: 'none',
};

const NOT_RUN_FOR_ALL = {
  'no-file-writes': NOT_RUN,
  'background-execution': NOT_RUN,
  'fixed-model-selection': NOT_RUN,
  'no-subagent-delegation': NOT_RUN,
  'tool-restriction': NOT_RUN,
} as const;

/**
 * What each framework can actually do about a requirement.
 *
 * **Cursor's row is from this repository's own use of it; the other two rows are
 * deliberately unknown.** Nobody has run Copilot or Claude Code here, and a table
 * that guessed on their behalf would be exactly the "degraded file that reads as
 * though the requirement holds" that DSP-23 forbids. Filling those rows is a
 * separate, evidenced piece of work.
 *
 * **Every Cursor `how` below names a mechanism in a generated agent definition.** That
 * is the path the sentences were written from, so each one that is not also the
 * mechanism on DSpatch's own path carries a `whenDSpatchWalksTheRun` saying what is
 * actually in play there. Three of the five do; the other two answer the same on both.
 */
export const TARGET_CAPABILITIES: TargetCapabilities = {
  cursor: {
    'no-file-writes': {
      status: 'enforced',
      how:
        '`readonly: true` in a project agent definition. Observed in this repository: ' +
        'the read-only specialists could not write their own reports, which is why ' +
        'docs/loop/HANDOFF.md states the delivery rule per role.',
      evidence: 'observed',
      whenDSpatchWalksTheRun: {
        status: 'other-means',
        how:
          'nothing applies it on this path, so it is an instruction in the role text and ' +
          'the agent is trusted to follow it. DSpatch opens the session itself through ' +
          '`CursorSdkAdapter`, which writes and loads no agent definition, so `readonly` ' +
          'is never set; `localOptionsFor` passes `cwd` and `dirs`, and the SDK derives ' +
          'its sandbox policy from `cwd` alone, defaulting to `{type:"insecure_none"}`. ' +
          'An empty tool list is passed only under `toolPolicy: \'text-only\'`, which no ' +
          'live run selects. DSpatch has measured an agent reading and writing outside ' +
          'the folder it was given.',
        evidence: 'observed',
      },
    },
    'background-execution': {
      status: 'enforced',
      how: '`is_background` in the agent definition, and the run mode chosen per call.',
      evidence: 'documentation',
      whenDSpatchWalksTheRun: {
        status: 'other-means',
        how:
          '`is_background` is a field of an agent definition and this path writes none. ' +
          'What holds instead is the transport: a walked step runs headless with no ' +
          'human-in-the-loop flow, which the adapter reports as `approvals: ' +
          "'unsupported'`. Nobody has established that this is the same thing Cursor " +
          'means by background execution, so it is achieved another way rather than ' +
          'enforced.',
        evidence: 'observed',
      },
    },
    'fixed-model-selection': {
      status: 'enforced',
      how:
        'the `model` field in the agent definition. This repository has only ever used ' +
        '`inherit`, so a pinned slug is documented rather than observed.',
      evidence: 'documentation',
      whenDSpatchWalksTheRun: {
        status: 'enforced',
        how:
          'the `model` the adapter passes to `Agent.create` for the session, not a field ' +
          'in any file. Still enforced, and by something outside the agent \u2014 but the ' +
          "value comes from the run: `modelForChatNode` reads the *entry* node's fixed " +
          'model and every session of the run is opened with it.',
        evidence: 'observed',
      },
    },
    'no-subagent-delegation': {
      status: 'other-means',
      how:
        'stated in the role instructions and honoured by the agent, not by the platform. ' +
        "Cursor's documentation says subagents may launch child subagents from 2.5, so " +
        'this is our policy rather than a restriction — see docs/DEVELOPMENT_LOOP.md.',
      evidence: 'documentation',
    },
    'tool-restriction': {
      status: 'unknown',
      how:
        'Cursor exposes tool and MCP configuration for agents, but nothing in this ' +
        'repository has set or tested it, so its effect here is unestablished.',
      evidence: 'none',
    },
  },
  copilot: NOT_RUN_FOR_ALL,
  'claude-code': NOT_RUN_FOR_ALL,
};

/**
 * Words a declared failure may not be named after.
 *
 * These are the runner's problems, and the point of listing them is that the
 * mistake they describe is an attractive one: every node could be given a "what if
 * this hangs" edge, and the graph would become unreadable while saying nothing the
 * runner could act on. A graph that tries is refused with the reason, which is more
 * use than a sentence in a document nobody opens.
 *
 * Matching is deliberately narrow, in two lists, because over-matching would refuse
 * legitimate failures: `missing-authority` is a real declared failure in our own loop
 * and must stay expressible, while `missing-report` must not. Single words match any
 * hyphen- or underscore-separated part of an identifier; phrases match the whole of it.
 */
export const RUNTIME_FAULT_WORDS = [
  'timeout',
  'hang',
  'hung',
  'stuck',
  'stalled',
  'unresponsive',
  'crash',
  'crashed',
  'died',
  'dead',
  'disconnected',
  'cancelled',
  'canceled',
  'undelivered',
] as const;

export const RUNTIME_FAULT_PHRASES = [
  'timed-out',
  'no-outcome',
  'unknown-outcome',
  'no-report',
  'missing-report',
  'no-result',
  'no-response',
  'not-delivered',
  'never-returned',
  'never-arrived',
] as const;

/**
 * Whether this identifier names something the runner handles rather than the graph.
 *
 * Returns the matched word or phrase so the message can quote it back.
 */
export function namesARuntimeFault(id: string): string | null {
  const normalised = id.trim().toLowerCase();
  const phrase = RUNTIME_FAULT_PHRASES.find((entry) => entry === normalised);
  if (phrase) {
    return phrase;
  }
  const parts = normalised.split(/[-_\s]+/);
  return RUNTIME_FAULT_WORDS.find((word) => parts.includes(word)) ?? null;
}

/**
 * What happens when the runner finally gives up on a stuck node.
 *
 * DSP-21 named this as the one seam between a declared failure and a runtime fault,
 * and asked for it to be decided rather than left ambiguous. **It is decided: the run
 * stops for a human.** That is what our own external loop does — it enters
 * RECONCILING and someone establishes what actually happened before anything is
 * repeated — and it is the only honest answer while the runner cannot tell a slow
 * call from a dead one.
 *
 * It is a field rather than an assumption so that the decision is visible in every
 * file, and so that the alternative the task predicted — "no outcome" becoming a
 * routable condition — arrives as one more value here plus one more edge condition,
 * and changes nothing else.
 */
export type RuntimeFaultPolicy = 'stop-and-reconcile';
export const RUNTIME_FAULT_POLICIES = ['stop-and-reconcile'] as const;

/**
 * Which model runs a step.
 *
 * `described` exists because DSP-8 has not been decided: a graph can record *how* the
 * model should be chosen without pretending the choice is already automated. No
 * runner honours any of this yet — see {@link ATTRIBUTE_SUPPORT}.
 */
export interface ModelPolicy {
  readonly policy: 'inherit' | 'fixed' | 'described';
  /** Required when `policy` is `fixed`. A provider slug, meaningful only for the graph's target. */
  readonly model?: string;
  /** Required when `policy` is `described`. What should decide, for a human to apply. */
  readonly description?: string;
}

/**
 * What bounds a step, or a whole run when set on the graph.
 *
 * `maxMinutes` is the only field that touches runtime faults, and it does so from the
 * right side: it is how the runner *detects* one. It is not a route.
 */
export interface StepLimits {
  readonly maxCalls?: number;
  readonly maxReworkRounds?: number;
  readonly maxMinutes?: number;
  readonly maxTasks?: number;
  readonly note?: string;
}

/**
 * Where a role description lives.
 *
 * `role-source` is DSP-23's provider-neutral form. It does not exist yet, and it is
 * named here so that a graph written tonight moves to it by changing two fields
 * instead of every node. The `id` is stable across that change; the source is not.
 */
export type RoleSourceKind = 'cursor-agent-file' | 'cursor-skill-file' | 'role-source';
export const ROLE_SOURCE_KINDS = ['cursor-agent-file', 'cursor-skill-file', 'role-source'] as const;

/**
 * A node's role: a reference, never the prose.
 *
 * The graph stays readable, a role can be shared by more than one graph and by more
 * than one node in the same graph, and DSP-23 can regenerate the role files without
 * touching a single graph. `path` is relative to the project root the caller supplies,
 * not to the graph file, so moving a graph does not break its references.
 */
export interface RoleReference {
  readonly id: string;
  readonly source: {
    readonly kind: RoleSourceKind;
    readonly path: string;
  };
}

/**
 * Who writes this step's report into the archive.
 *
 * `self` is the normal answer. Naming another node is what a step that *cannot* write
 * must do, and the format requires it: a role required not to write files, whose
 * report it also writes, is the mistake made on 15 September 2026 when a read-only
 * Researcher was asked to write both its survey and its report and could write
 * neither. Validation refuses it now.
 */
export interface ReportPolicy {
  /** `self`, or the id of the node that files it. `self` is not a legal node id. */
  readonly writtenBy: string;
  /** Where it lands, if this step differs from the graph's archive. */
  readonly path?: string;
}

/** The reserved value of {@link ReportPolicy.writtenBy}. No node may use it as an id. */
export const REPORT_WRITTEN_BY_SELF = 'self';

/**
 * What shape a step's required result takes.
 *
 * `markdown-file` — the file at the step's {@link ArchivePlacement} is the result, and
 * the bytes in it are the only copy of the body there is. `stored-result` — there is no
 * file, and the run record holds the body. `none` — this step leaves nothing, which is
 * worth being able to say out loud about a router or a gate in a graph where every
 * other step leaves something.
 */
export type ResultForm = 'markdown-file' | 'stored-result' | 'none';
export const RESULT_FORMS = ['markdown-file', 'stored-result', 'none'] as const;

/**
 * Whether arriving at a terminal is this loop's own idea of the assignment being met.
 *
 * DSP-36. Until this field the format could not say it, and DSP-26 recorded the
 * consequence in as many words: *the format cannot say which terminals mean success, so
 * success cannot be inferred from arrival*. Every terminal was `kind: "terminal"` and
 * differed from every other only in `label` and `purpose` — so the one thing left to
 * read was the wording, and a drawing that renamed *Assignment not met* to *Done* would
 * have changed what DSpatch believed had happened. Niclas's instruction is that it must
 * not: success is decided from what the graph **records**, never from what a node is
 * called.
 *
 * **Two values, not four.** `not-success` covers *Assignment not met*, *Could not
 * establish* and *Stopped without doing the work* alike, and it is deliberately not
 * called `failure`: whether the project is broken, whether the work was refused and
 * whether nothing could be decided are three different things, they are already told
 * apart by {@link RunOutcomeKind} and by the terminal's own purpose, and a second
 * vocabulary here would be a second place for them to disagree. All this field has to
 * answer is the question the green tick asks.
 *
 * **Absent means the author has not said**, and is read as *not declared success* — a
 * graph written before this field existed shows the ending it reached without a tick,
 * which is the honest reading of a drawing that never claimed one.
 *
 * **It says nothing about verification.** `work-verified` still requires a command that
 * ran and exited 0, and nothing here can reach it: arriving at a terminal earns nothing
 * (DSP-26 #3, enforced in `runOutcomeFrom`). This says only *the walk ended where this
 * loop says a met assignment ends*.
 */
export type TerminalEnding = 'success' | 'not-success';
export const TERMINAL_ENDINGS = ['success', 'not-success'] as const;

/**
 * Whether this node is a terminal its own graph declares as success.
 *
 * One function, so that nothing reads `ending` and adds its own interpretation on the
 * way — and so that a caller cannot reach a tick by way of a label. `false` for a node
 * that is not a terminal, for one that declares nothing, and for `null`.
 */
export function terminalDeclaresSuccess(node: LoopNode | null | undefined): boolean {
  return node !== null && node !== undefined && node.kind === 'terminal' && node.ending === 'success';
}

/**
 * What result this step must leave.
 *
 * The one thing `archive` and `report` could never say. Between them they settle
 * *where* an entry lands and *who* is responsible for filing it, and neither says
 * **whether** anything has to be there — so a step that filed nothing at all was
 * indistinguishable from a step whose graph simply did not ask. That gap is the whole
 * of why a missing report could read as a delivered one.
 *
 * `required: true` is what the runner checks: presence, and that what is there belongs
 * to this run and this visit. It never opens the body to decide whether the work is any
 * good — checking that a result exists is the run engine's business, and judging it
 * belongs to the appointed agents or to the person.
 *
 * Optional, and a graph that sets none of this behaves exactly as it did before this
 * field existed. That is the point of it being a field rather than a second code path:
 * a simple loop must work without a reporting package.
 */
export interface ResultPolicy {
  /** Whether the run may go on without it. `false` records the shape without the check. */
  readonly required: boolean;
  readonly form: ResultForm;
  /** What the result is for, in the author's words. Never read by the runner. */
  readonly note?: string;
}

export interface LoopNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** For people and for the editor. Falls back to `id`. */
  readonly label?: string;
  /** One sentence on what this step is for. */
  readonly purpose?: string;
  /**
   * What arriving here means for the assignment. Terminals only. See {@link TerminalEnding}.
   */
  readonly ending?: TerminalEnding;
  /** Required for `agent`; allowed on `gate` and `external`; meaningless elsewhere. */
  readonly role?: RoleReference;
  readonly model?: ModelPolicy;
  readonly limits?: StepLimits;
  /** Requirements this graph adds to whatever the role already requires. */
  readonly requirements?: readonly RequirementId[];
  /**
   * The named outcomes this node may produce — a router's branches, a gate's verdicts.
   * Declaring them is what lets validation catch an edge that routes on a typo, and
   * what lets the editor offer the real choices. A node that declares outcomes routes
   * only on them, never on plain success.
   */
  readonly outcomes?: readonly string[];
  /**
   * Which of this node's own outcomes a reply that declares none is routed on.
   *
   * DSP-103. Until this field existed the answer was inferred from **how an outcome was
   * spelled**: the run gave a node the graceful "declared nothing" route if its list
   * happened to contain the literal `unclear`, or failing that `could-not-check`, and any
   * other spelling of the same idea stopped the run as a fault instead. Nothing in the
   * drawing said so, so a person could only discover it by reading the prompt builder —
   * and `AGENT_BEHAVIOUR_AND_ORCHESTRATION.md` §2 requires every control DSpatch
   * introduces to be explicit and inspectable, which a name whose spelling silently
   * changes the routing is not. No outcome name carries behaviour any more: this field is
   * the whole of it, and an author writes whatever word their loop uses.
   *
   * **Absent means the run stops.** A node that declares outcomes and names none of them
   * here faults with `undeclared-product` when a reply declares nothing, which is exactly
   * what a node without one of the two old spellings already got. It is not a default
   * anybody has to write down to keep today's behaviour of a node that had neither.
   *
   * **It must name one of this node's own `outcomes`.** Validation refuses anything else
   * (`when-undeclared-not-an-outcome`), because a fallback the node cannot produce is a
   * route the runner would refuse a step for taking. On a node declaring no outcomes it is
   * refused for the same reason: such a node's ordinary reply is its result, and there is
   * nothing for a missing declaration to fall back to.
   */
  readonly whenUndeclared?: string;
  /** The failure kinds this node may declare. Each one needs somewhere to go. */
  readonly declaredFailures?: readonly string[];
  readonly report?: ReportPolicy;
  /** What this step must leave behind. See {@link ResultPolicy}. */
  readonly produces?: ResultPolicy;
  /**
   * Which earlier steps' results this step is given, whatever brought the run here.
   *
   * Node ids, each resolved by the runner to the **most recent completed visit** of
   * that node within this run. That resolution is the field's reason for existing: a
   * loop comes back around, and handing a second Implementer's Verifier the first
   * Implementer's report would be the same trap DSP-31 named for human answers, one
   * layer down. Edges carried control flow and only control flow; until this field there
   * was no way at all for a graph to say *the Verifier receives the Implementer's
   * report*.
   *
   * **It is the node's standing answer and no longer its only one.** A node is reached
   * by more than one edge, and the inputs a step needs depend on which — the Implementer
   * arriving on a rework round needs the review that sent it back, and arriving on its
   * first brief cannot be given one. See {@link LoopEdge.delivers}, which overrides this
   * for the arrival that declares it and leaves every other arrival reading this field
   * exactly as it did.
   */
  readonly consumes?: readonly string[];
  readonly notes?: string;
  /**
   * Where the editor drew it. Presentation only: it never affects meaning, and the
   * runner ignores it. It lives in the format anyway, because a hand-arranged graph
   * that loses its arrangement on save is a graph nobody arranges twice.
   */
  readonly view?: { readonly x: number; readonly y: number };
}

/**
 * The outcome a reply that declares none is routed on, or `null` for "the run stops".
 *
 * One function, for the reason {@link terminalDeclaresSuccess} is one: the alternative is
 * three readers of {@link LoopNode.whenUndeclared} — the prompt, the node panel and the
 * runner — each free to disagree about what an absent or impossible value means. It lives
 * here rather than beside any of them because all three can reach the format.
 *
 * A name the node does not declare answers `null`, so the engine can never produce an
 * outcome the graph would then refuse the step for. Validation refuses that graph outright
 * (`when-undeclared-not-an-outcome`); this is what an unvalidated one does, and stopping is
 * the same answer a node that says nothing gets.
 */
export function undeclaredOutcomeOf(
  node: Pick<LoopNode, 'outcomes' | 'whenUndeclared'>,
): string | null {
  const fallback = node.whenUndeclared;
  if (fallback === undefined) {
    return null;
  }
  return (node.outcomes ?? []).includes(fallback) ? fallback : null;
}

/**
 * When an edge is taken.
 *
 * Three forms, and no fourth. `success` is the figure's plain arrow, `outcome` its
 * labelled branch (`kod`, `research`, or a gate's verdict), `declared-failure` its
 * dashed arrow (`specfel: planera om`). What is missing is any way to route on the
 * machinery breaking, and that absence is the design — see {@link RuntimeFaultPolicy}.
 */
export type EdgeCondition =
  | { readonly on: 'success' }
  | { readonly on: 'outcome'; readonly outcome: string }
  | { readonly on: 'declared-failure'; readonly failure: string };

export const EDGE_CONDITIONS = ['success', 'outcome', 'declared-failure'] as const;

export interface LoopEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly when: EdgeCondition;
  /**
   * Which earlier steps' results this arrival hands to the node it leads to.
   *
   * DSP-100. {@link LoopNode.consumes} is one list per node and the runner read it
   * whichever edge arrived, so a node reached two ways was given the same inputs both
   * times. On 22 September 2026 that sent an Implementer back on the review's own rework
   * edge with the coordinator's opening brief and nothing the reviewer had written; it
   * read the re-prompt itself as the answer to the question it had asked, wrote *"I
   * understand the clarification."* and narrowed its own limit. The drawing already
   * claimed otherwise in two places — this node's `notes` and the comment on
   * `TASK_PRECEDENCE` — and only the wiring was missing.
   *
   * **Set, it replaces the node's list for this arrival; absent, the node's list applies
   * unchanged.** That is what keeps every graph written before this field behaving to the
   * byte: an edge that says nothing delivers what it always delivered. It is a
   * replacement rather than an addition because the whole point is that a first visit
   * must not be made to require what only a second could have — a node whose `consumes`
   * had to be the union of every path's inputs is the shape that stops a run at its
   * first step.
   *
   * **Ids, never prose, and never "everything so far".** The set a step receives stays
   * small, deliberate and readable off the drawing; validation checks each id the same
   * way it checks `consumes`, and the node panel shows what each arrival brings.
   */
  readonly delivers?: readonly string[];
  /** What the figure writes on the arrow. Falls back to the condition. */
  readonly label?: string;
  readonly notes?: string;
}

/**
 * A failure the loop understands and routes on.
 *
 * Declared per graph rather than globally, because the failures a small loop
 * distinguishes are not the ones a large loop does, and a global vocabulary would
 * grow to the union of every loop anyone ever drew.
 */
export interface FailureKind {
  readonly id: string;
  readonly label: string;
  /** What it means when a node declares it, in terms an author can act on. */
  readonly meaning: string;
}

/**
 * The iteration archive: every node writes its report and returns a reference.
 *
 * The figure draws this as an aside. Our own loop learned it is not one — on
 * 14 September 2026 an Implementer's finished work was recovered only because it had
 * been written to disk, and on 15 September a lost read-only call could not be.
 */
export interface ArchivePolicy {
  /** Where reports land. May contain `<run-id>`, which the runner substitutes. */
  readonly path: string;
  /** Every node files one. */
  readonly entryPerNode: boolean;
  /** A node's result is a reference to its entry, not the prose passed along. */
  readonly referenceReturned: boolean;
  readonly notes?: string;
}

export interface LoopGraph {
  readonly format: typeof LOOP_GRAPH_FORMAT;
  readonly formatVersion: number;
  /**
   * This graph's own identity. There will be several loops — a small one and a large
   * one, or one per kind of task — and retrofitting identity onto a format that
   * assumed uniqueness invalidates every file already written.
   */
  readonly id: string;
  readonly name: string;
  /** What kind of work this loop is for, so a set of loops can be told apart. */
  readonly purpose: string;
  /** Stored here, decided by the author, and never changed by whoever opens the file. */
  readonly target: LoopTarget;
  readonly entry: string;
  readonly onRuntimeFault: RuntimeFaultPolicy;
  readonly failureKinds: readonly FailureKind[];
  /** Bounds on the whole run. */
  readonly limits?: StepLimits;
  readonly archive?: ArchivePolicy;
  readonly nodes: readonly LoopNode[];
  readonly edges: readonly LoopEdge[];
  readonly notes?: string;
}

/**
 * Which attributes anything actually honours today.
 *
 * DSP-21 asks that an attribute the runner does not yet honour be marked as not yet
 * honoured rather than silently ignored, and today that is nearly all of them: the
 * runner is DSP-18 and does not exist. Validation reports one notice per attribute a
 * graph actually sets, so an author sees that their `maxCalls: 12` is a statement of
 * intent rather than a bound anything enforces.
 */
export interface AttributeSupport {
  readonly attribute: string;
  readonly honoured: boolean;
  /** Who honours it, or who will. */
  readonly by: string;
  /**
   * Where an honoured attribute is **not** honoured, when that is somewhere.
   *
   * DSP-46 #3. `honoured` is one boolean for a product with more than one runner path,
   * and `role` is the attribute that proved a boolean too coarse: the live chat loop
   * now sends the role's text, while the editor's Run path and the dry run do not. The
   * choice was between claiming `false` — a false negative the moment the chat loop
   * sends it — and claiming `true`, which is what the previous state of this table did
   * for `role` by simply not listing it. Neither is the truth, so the truth gets a
   * field, and `loop-graph-load.ts` reports it against any graph that sets the
   * attribute. An attribute honoured everywhere leaves this undefined.
   */
  readonly caveat?: string;
}

/**
 * Which tools a run DSpatch walks opens its sessions with.
 *
 * DSP-94, from DSP-92's F6. This was a literal in `loop-live-run.ts` and appeared on no
 * screen, so whether a step could touch a file at all was a run-level decision a reader
 * had to find by opening the main process. It is a constant here, beside the capability
 * table that already names the value that is *not* chosen, and `loop-live-run.ts` passes
 * it to the adapter — so the panel showing it is showing what is used, not a copy.
 *
 * It is deliberately **not** a field on a node or a graph. Nothing in the format selects
 * it, no drawing can vary it, and giving it a box before anything can honour one would be
 * the opposite of disclosure. When a run needs to vary it, that is a card of its own.
 */
export const LOOP_RUN_TOOL_POLICY = 'provider-default' as const;

/**
 * What {@link LOOP_RUN_TOOL_POLICY} means for a person reading the node panel.
 *
 * Takes the value rather than closing over it, so the sentence is chosen by the policy
 * in force and a different one cannot be described while another is passed.
 */
export function describeRunToolPolicy(
  policy: 'provider-default' | 'text-only' = LOOP_RUN_TOOL_POLICY,
): string {
  return policy === 'text-only'
    ? 'Every step of a run DSpatch walks opens its session with the tool policy “text-only”: the ' +
        'adapter passes an empty tool list, so the agent can answer with text and can reach no file ' +
        'and no command.'
    : 'Every step of a run DSpatch walks opens its session with the tool policy “provider-default”: ' +
        'the provider’s own tools are available, so a step can read and change files and run ' +
        'commands in the folders it was given — and, since nothing confines the session, outside ' +
        'them too. It is one value for the whole run, fixed in DSpatch rather than set by this ' +
        'drawing, and the alternative the adapter offers, “text-only”, is not selected. A ' +
        'requirement ticked on a step is an instruction the agent is expected to follow, not a ' +
        'restriction this policy applies.';
}

/**
 * Every attribute a graph or a node may set, and whether anything acts on it.
 *
 * **Complete, and a test holds it complete.** DSP-46 #3 asks that an attribute the
 * runner does not honour say so, and the way that criterion was missed was not a wrong
 * entry — it was a *missing* one: `role` was validated, then ignored, and the table
 * that exists to disclose exactly that had no row for it. So every optional field of
 * {@link LoopNode} and {@link LoopGraph} now has a row, including the ones that are
 * obviously honoured, and `loop-graph.test.ts` fails if a field is added without one.
 * A table that is only populated when someone remembers is a table that will be wrong
 * again in the same way.
 */
export const ATTRIBUTE_SUPPORT: readonly AttributeSupport[] = [
  { attribute: 'model', honoured: false, by: 'DSP-18 for the runner; DSP-8 decides task-aware selection' },
  { attribute: 'limits', honoured: false, by: 'DSP-18' },
  { attribute: 'requirements', honoured: false, by: 'DSP-18 to apply them; DSP-23 to generate roles from them' },
  {
    attribute: 'archive',
    honoured: true,
    by: 'DSP-74. The runner computes each step\'s placement from it and files the result there.',
    caveat:
      'A run files nothing unless it was given somewhere to file it. The live run is, and a ' +
      'dry run is not — by construction, since a dry run reaches no filesystem — so a dry run ' +
      'reports the path a real run would use and writes nothing at it.',
  },
  { attribute: 'onRuntimeFault', honoured: false, by: 'DSP-18' },
  {
    attribute: 'report',
    honoured: true,
    by: 'DSP-74. "writtenBy" decides who files the entry: the node itself, or the runner on its behalf.',
    caveat:
      'Who files it is honoured; a node that files its own is trusted to have done so and is ' +
      'checked for presence, not obedience. Nothing stops a node writing somewhere else as well.',
  },
  {
    attribute: 'produces',
    honoured: true,
    by: 'DSP-74. A required result that does not arrive stops the run as required-result-missing.',
    caveat:
      'Presence and provenance only. The runner never reads the body to judge whether the work ' +
      'is any good — that belongs to the appointed agents or to the person. A dry run checks ' +
      'nothing, because nothing was filed.',
  },
  {
    attribute: 'consumes',
    honoured: true,
    by: 'DSP-75. The runner resolves each id to that node\'s most recent completed visit and gives the step its result.',
    caveat:
      'It is the node\'s answer for an arrival that declares none of its own: an edge\'s ' +
      '"delivers" replaces it for that arrival (DSP-100). What a step then does with what it ' +
      'was given is the step\'s business. The live executor names the received results in the ' +
      'prompt; an executor that ignores StepContext.received receives them all the same and ' +
      'uses none. A dry run hands nothing over, because it files nothing — and a live run of a ' +
      'graph that hands anything over is refused unless it was given somewhere to keep results.',
  },
  {
    attribute: 'delivers',
    honoured: true,
    by: 'DSP-100. The runner builds what a step receives from the edge it arrived on, falling back to the node\'s "consumes" where the edge says nothing.',
    caveat:
      'Bound to this run, the named producing node and the visit that actually took the edge, ' +
      'so a later rework cannot be handed an older review. The same two paths that hand nothing ' +
      'over at all still hand nothing over: a dry run files nothing, and an executor that ' +
      'ignores StepContext.received is given them and uses none.',
  },
  { attribute: 'view', honoured: true, by: 'DSP-22, the editor. Presentation only; it never affects meaning.' },
  {
    attribute: 'role',
    honoured: true,
    by: 'DSP-46. The live chat loop resolves the reference and sends the role\'s own text with the prompt.',
    caveat:
      'Only where the run is given a prompt builder that reads it, which today is the chat ' +
      'loop. The editor\'s Run button walks dspatch-live-duration with a fixed prompt, and a ' +
      'dry run calls no provider at all, so on those two paths a role is validated and its ' +
      'text is not sent.',
  },
  {
    attribute: 'label',
    honoured: true,
    by: 'The editor draws it and the chat column names steps by it.',
  },
  {
    attribute: 'purpose',
    honoured: true,
    by: 'The runner sends it as a non-entry node\'s prompt, and every window shows it.',
  },
  {
    attribute: 'outcomes',
    honoured: true,
    by: 'The runner routes on them and refuses a product that is not among them.',
  },
  {
    attribute: 'ending',
    honoured: true,
    by: 'DSP-36. The graph view marks the ending a run reached and ticks it where the graph declares success.',
    caveat:
      'Read by the drawing and by nothing that decides anything about the work. It does not ' +
      'reach a run\'s recorded outcome, which still requires a command that ran and exited 0, ' +
      'and it changes no route: which terminal a run arrives at is decided by the edges.',
  },
  {
    attribute: 'declaredFailures',
    honoured: true,
    by: 'The runner routes a declared failure only where the node declares it.',
  },
  {
    attribute: 'failureKinds',
    honoured: true,
    by: 'Validation checks every declared failure against them; the windows read their meaning.',
  },
  {
    attribute: 'notes',
    honoured: true,
    by: 'Carried and shown as written. Prose for a reader; the runner takes no decision from it.',
  },
];

export function attributeSupport(attribute: string): AttributeSupport | null {
  return ATTRIBUTE_SUPPORT.find((entry) => entry.attribute === attribute) ?? null;
}

/** A role description, as resolved from wherever it lives. */
export interface ResolvedRole {
  readonly id: string;
  readonly sourcePath: string;
  /** The targets this role supports. A role may legitimately support only one. */
  readonly targets: readonly LoopTarget[];
  /**
   * False when the targets above were inferred from what kind of file this is rather
   * than read from the role itself. Until DSP-23 exists, no role declares its
   * targets, and validation says so instead of pretending it read them.
   */
  readonly targetsDeclared: boolean;
  /** What the role requires, in portable terms. */
  readonly requirements: readonly RequirementId[];
  /** False when the requirements were inferred from provider-specific fields. */
  readonly requirementsDeclared: boolean;
  readonly summary?: string;
  /**
   * The role's own prose, as the thing an agent is actually told to be.
   *
   * DSP-46 #1. Validation has always refused a reference that resolves to nothing, on
   * the stated ground that *an agent with no description is an agent that will be handed
   * whatever the runner happens to have* — and the runner then handed it whatever it
   * happened to have, because resolution returned an identity, a target list and a set
   * of requirements and never the text. The refusal protected a property nothing
   * provided. This field is that property.
   *
   * Optional because a resolver may legitimately not have it: a role file that is all
   * front matter and no body resolves with no instructions, and that is a different
   * thing from a reference that resolves to nothing. `undefined` therefore means *this
   * role says nothing further*, never *nobody looked*.
   */
  readonly instructions?: string;
}

/**
 * How validation reaches a role. Injected rather than assumed, so the window can
 * check a graph without a filesystem and the resolver can change under DSP-23
 * without this module changing at all.
 */
export type RoleResolver = (reference: RoleReference) => ResolvedRole | null;

/** What a graph's effective requirements are, per node, with where each came from. */
export interface EffectiveRequirement {
  readonly requirement: RequirementId;
  readonly from: 'role' | 'node';
}

export function effectiveRequirements(
  node: LoopNode,
  role: ResolvedRole | null,
): readonly EffectiveRequirement[] {
  const seen = new Map<RequirementId, EffectiveRequirement>();
  for (const requirement of role?.requirements ?? []) {
    seen.set(requirement, { requirement, from: 'role' });
  }
  for (const requirement of node.requirements ?? []) {
    if (!seen.has(requirement)) {
      seen.set(requirement, { requirement, from: 'node' });
    }
  }
  return [...seen.values()];
}

/**
 * What a target does about a requirement, on the path the caller is asking about.
 *
 * The path is not optional and has no default: a caller that did not have to say which
 * one it meant is how `no-file-writes` came to read `enforced` in the graph editor, in
 * validation and in the snapshot decision, for runs where nothing applied it.
 */
export function capabilityAnswer(
  target: LoopTarget,
  requirement: RequirementId,
  path: CapabilityPath,
  table: TargetCapabilities = TARGET_CAPABILITIES,
): CapabilityAnswer {
  const cell = table[target][requirement];
  return path === 'dspatch-walked-run' && cell.whenDSpatchWalksTheRun !== undefined
    ? cell.whenDSpatchWalksTheRun
    : cell;
}

/**
 * Whether any step of this drawing could write into the run's working folders.
 *
 * DSP-91 #7 and AC #7/#8 together. The run engine snapshots every working root — the full
 * bytes of every file, `fs.readFileSync` each, sha-256 over them — immediately before and
 * immediately after every agent step and every gate, unconditionally. For the 21 September
 * run that was **six full-content reads of a 4,734-file project** for a mandate that asked
 * for no project work and changed nothing.
 *
 * The condition is a property of the drawing, never a word in the mandate: DSP-91 forbids
 * special-casing "pi", "demo" or "liveness", and a run whose behaviour turned on the text a
 * person typed would be exactly that. What a drawing does say is what each of its steps is
 * allowed to do, through {@link effectiveRequirements}:
 *
 * - An **agent** step may write unless its role or the node requires `no-file-writes`
 *   **and something other than the agent applies that requirement**. See below.
 * - A **gate** starts the project's own command, which can write anything. It always may.
 * - An **external** step is not run by this engine, but nothing here knows what it does, so
 *   it counts as able to write. Unknown is not none.
 * - A **router**, **human** or **terminal** step runs no tool and writes nothing.
 *
 * Where nothing may write, the two snapshots can only ever be equal, and taking them buys a
 * measurement whose answer is already known at the cost of reading somebody's whole
 * repository. Where anything may write, they stay: the before/after hash is the only thing
 * in this product that can contradict an agent claiming it changed nothing, and losing it
 * would trade one untruth for a worse one.
 *
 * A run that skips it must **say** it measured nothing rather than imply nothing changed.
 * That is {@link import('./working-roots').describeUnobservedOutside}'s register and the
 * reason this returns the reason as well as the verdict.
 *
 * **A requirement is only decisive where something other than the agent applies it**
 * (DSP-96 part 2, from DSP-92's F3 and F12 point 4). This used to ask the drawing alone,
 * and on DSpatch's own path `no-file-writes` is a sentence in a role file: the skip would
 * therefore have fired exactly where the read-only guarantee is weakest, removing the one
 * thing in the product that can contradict an agent claiming it changed nothing. So the
 * capability table is asked too, for the path this engine actually runs on, and a
 * requirement that is merely instructed leaves the step able to write. That is still a
 * property of the drawing and the target and never a word in the mandate.
 *
 * The consequence, stated rather than left to be found: with today's table no drawing with
 * an agent step skips hashing, because no target enforces `no-file-writes` on this path. A
 * drawing of routers, human steps and terminals still skips, and the branch becomes
 * reachable again for an agent step the day a path enforces the requirement — which is
 * what "paired with something that makes read-only true" means.
 */
export interface WriteReach {
  /** True when at least one step of this drawing could write into a working root. */
  readonly mayWrite: boolean;
  /** Which step, and why — or why none of them can. Written for a run record. */
  readonly reason: string;
}

export function writeReachOf(
  graph: Pick<LoopGraph, 'nodes' | 'target'>,
  resolveRole: RoleResolver,
  table: TargetCapabilities = TARGET_CAPABILITIES,
): WriteReach {
  const readOnly = capabilityAnswer(graph.target, 'no-file-writes', 'dspatch-walked-run', table);
  for (const node of graph.nodes) {
    if (node.kind === 'gate') {
      return {
        mayWrite: true,
        reason:
          `The gate "${node.id}" starts a command in the working folder, and a command may ` +
          `write anything.`,
      };
    }
    if (node.kind === 'external') {
      return {
        mayWrite: true,
        reason:
          `"${node.id}" is an external step. This engine does not run it and knows nothing ` +
          `about what it does, so it is treated as able to write \u2014 unknown is not none.`,
      };
    }
    if (node.kind !== 'agent') {
      continue;
    }
    const role = node.role === undefined ? null : resolveRole(node.role);
    const required = effectiveRequirements(node, role).map((entry) => entry.requirement);
    const named = `The agent step "${node.id}"${
      node.role === undefined ? '' : ` (role "${node.role.id}")`
    }`;
    if (!required.includes('no-file-writes')) {
      return {
        mayWrite: true,
        reason: `${named} does not require no-file-writes, so it may write in the working folders.`,
      };
    }
    if (readOnly.status !== 'enforced') {
      return {
        mayWrite: true,
        reason:
          `${named} requires no-file-writes, and on the path this run takes ${graph.target} ` +
          `does not enforce it: ${readOnly.how} So the requirement is an instruction the ` +
          `agent is expected to follow, which is not a reason to stop measuring whether it ` +
          `did.`,
      };
    }
  }
  return {
    mayWrite: false,
    reason:
      'No step in this drawing may write in the working folders: every agent step requires ' +
      'no-file-writes, ' +
      `${graph.target} enforces that on the path this run takes (${readOnly.how}), and there ` +
      'is no gate or external step to start anything. Two snapshots of the project could ' +
      'therefore only ever be equal.',
  };
}

/** Whether a graph can be run by the account reading it, which is not a matter of validity. */
export interface RunnableHere {
  readonly runnable: boolean;
  readonly reason: string;
}

/**
 * A graph targeting a framework this account is not connected to is not an invalid
 * graph. It is a graph for somewhere else, and saying so is the whole of the
 * response.
 */
export function runnableHere(
  graph: LoopGraph,
  connectedTargets: readonly LoopTarget[] | null,
): RunnableHere {
  if (connectedTargets === null) {
    return {
      runnable: false,
      reason:
        `This graph is drawn for ${graph.target}. Which frameworks this machine is ` +
        `connected to was not established, so whether it can run here is unknown.`,
    };
  }
  if (connectedTargets.includes(graph.target)) {
    return { runnable: true, reason: `This machine is connected to ${graph.target}.` };
  }
  return {
    runnable: false,
    reason:
      `This graph is drawn for ${graph.target}, which this machine is not connected ` +
      `to${connectedTargets.length > 0 ? ` (connected: ${connectedTargets.join(', ')})` : ''}. ` +
      `It can be opened and edited; it cannot be run here. Changing its target is a ` +
      `separate, reported decision — see describeTargetChange.`,
  };
}

/** What switching target would mean. Nothing is changed and nothing is removed. */
export interface TargetChangeReport {
  readonly from: LoopTarget;
  readonly to: LoopTarget;
  /** Requirements that stop being enforced, each with what is lost. */
  readonly losses: readonly string[];
  /** Requirements the new target enforces and the old one did not. */
  readonly gains: readonly string[];
  /** Requirements nobody has established for the new target. Not losses; unknowns. */
  readonly unknowns: readonly string[];
  /** Requirements the new target cannot meet at all. These would make the graph invalid. */
  readonly blocking: readonly string[];
  /** Roles that do not support the new target. Empty when no resolver was supplied. */
  readonly rolesWithoutSupport: readonly string[];
  /** Whether a resolver was available to check the roles at all. */
  readonly rolesChecked: boolean;
}

/**
 * Report what changing the target would mean, without changing anything.
 *
 * DSP-21 is explicit that this is a reported operation and never a silent migration
 * or an automatic removal: "a requirement silently dropped during a target change is
 * the failure this whole design exists to prevent". So this returns prose for a person
 * and no graph at all. Use {@link withTarget} afterwards, which also removes nothing.
 */
export function describeTargetChange(
  graph: LoopGraph,
  to: LoopTarget,
  options: {
    readonly resolveRole?: RoleResolver;
    readonly targetCapabilities?: TargetCapabilities;
  } = {},
): TargetChangeReport {
  const table = options.targetCapabilities ?? TARGET_CAPABILITIES;
  const from = graph.target;
  const losses: string[] = [];
  const gains: string[] = [];
  const unknowns: string[] = [];
  const blocking: string[] = [];

  const required = new Set<RequirementId>();
  for (const node of graph.nodes) {
    const role = node.role && options.resolveRole ? options.resolveRole(node.role) : null;
    for (const entry of effectiveRequirements(node, role)) {
      required.add(entry.requirement);
    }
  }

  for (const requirement of required) {
    // Both sides on the path this graph would be run on, which is DSpatch's own: a
    // report that compared one framework's file mechanism with another's would be
    // answering a question nobody asked of a drawing.
    const before = capabilityAnswer(from, requirement, 'dspatch-walked-run', table);
    const after = capabilityAnswer(to, requirement, 'dspatch-walked-run', table);
    if (after.status === 'unmet') {
      blocking.push(`${requirement}: ${to} cannot meet it. ${after.how}`);
      continue;
    }
    if (after.status === 'unknown') {
      unknowns.push(`${requirement}: unestablished for ${to}. ${after.how}`);
      continue;
    }
    if (before.status === 'enforced' && after.status === 'other-means') {
      losses.push(
        `${requirement}: enforced by ${from}, but only achieved by other means on ${to}. ${after.how}`,
      );
      continue;
    }
    if (before.status !== 'enforced' && after.status === 'enforced') {
      gains.push(`${requirement}: ${to} enforces it natively. ${after.how}`);
    }
  }

  const rolesWithoutSupport: string[] = [];
  if (options.resolveRole) {
    for (const node of graph.nodes) {
      if (!node.role) {
        continue;
      }
      const role = options.resolveRole(node.role);
      if (role && !role.targets.includes(to)) {
        rolesWithoutSupport.push(
          `${node.id} uses role ${node.role.id} (${node.role.source.path}), which does not ` +
            `support ${to}. It would need a ${to} form before this graph could target ${to}.`,
        );
      }
    }
  }

  return {
    from,
    to,
    losses,
    gains,
    unknowns,
    blocking,
    rolesWithoutSupport,
    rolesChecked: Boolean(options.resolveRole),
  };
}

/**
 * Set the target, and do nothing else.
 *
 * No node is dropped, no requirement is removed and no attribute is rewritten, even
 * where the new target cannot meet it. The result may well be a graph that fails
 * validation — that is the honest outcome, and it is the author's to resolve with
 * {@link describeTargetChange} in front of them.
 */
export function withTarget(graph: LoopGraph, target: LoopTarget): LoopGraph {
  return { ...graph, target };
}
