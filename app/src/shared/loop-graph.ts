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
 * `readonly: true` here, it shaped this project's whole delivery contract on
 * 15 September 2026, and a target with no equivalent must not produce a role that
 * reads as though it were enforced.
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

export type TargetCapabilities = Readonly<
  Record<LoopTarget, Readonly<Record<RequirementId, CapabilityAnswer>>>
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
    },
    'background-execution': {
      status: 'enforced',
      how: '`is_background` in the agent definition, and the run mode chosen per call.',
      evidence: 'documentation',
    },
    'fixed-model-selection': {
      status: 'enforced',
      how:
        'the `model` field in the agent definition. This repository has only ever used ' +
        '`inherit`, so a pinned slug is documented rather than observed.',
      evidence: 'documentation',
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

export interface LoopNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** For people and for the editor. Falls back to `id`. */
  readonly label?: string;
  /** One sentence on what this step is for. */
  readonly purpose?: string;
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
  /** The failure kinds this node may declare. Each one needs somewhere to go. */
  readonly declaredFailures?: readonly string[];
  readonly report?: ReportPolicy;
  readonly notes?: string;
  /**
   * Where the editor drew it. Presentation only: it never affects meaning, and the
   * runner ignores it. It lives in the format anyway, because a hand-arranged graph
   * that loses its arrangement on save is a graph nobody arranges twice.
   */
  readonly view?: { readonly x: number; readonly y: number };
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
  { attribute: 'archive', honoured: false, by: 'DSP-18' },
  { attribute: 'onRuntimeFault', honoured: false, by: 'DSP-18' },
  { attribute: 'report', honoured: false, by: 'DSP-18' },
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

export function capabilityAnswer(
  target: LoopTarget,
  requirement: RequirementId,
  table: TargetCapabilities = TARGET_CAPABILITIES,
): CapabilityAnswer {
  return table[target][requirement];
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
    const before = capabilityAnswer(from, requirement, table);
    const after = capabilityAnswer(to, requirement, table);
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
