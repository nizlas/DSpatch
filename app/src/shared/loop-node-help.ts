/**
 * What a node's settings mean, in words rather than in field names.
 *
 * DSP-83. The node panel used to show the format's own vocabulary — `maxReworkRounds`,
 * a comma-separated outcome list, `research-needed — research needed` — and a person
 * reading it had to already know the format to learn anything from it. This module is
 * the other half of the panel: the readable name, the unit, the scope, what an empty
 * value means, and where a branch actually goes.
 *
 * Three rules shape everything here, and they are the ones the panel kept breaking.
 *
 * **An inherited setting is not an absent one.** A requirement the role states is in
 * force whether or not the node's own box is ticked, so {@link requirementStanding}
 * answers with both where it came from and whether it holds, and never with a bare
 * boolean the panel would have to draw as an empty checkbox.
 *
 * **Enforced and merely asked for are different things, and which one a requirement is
 * depends on how the agent is started.** `readonly: true` in a generated agent file is a
 * restriction Cursor applies; the same requirement on a run DSpatch walks itself is a
 * sentence in the role text that the agent is trusted to honour, as
 * `no-subagent-delegation` has always been. Everything in the format calls all of them
 * "required", so the sentence a person reads says which — from `TARGET_CAPABILITIES`,
 * asked for the path the panel is about, and not from a second opinion written here.
 *
 * **A setting that reaches nothing must say so.** Only an agent node reaches the
 * adapter (`loop-live.ts`: *Agent: the only kind that may reach the adapter*), so a
 * role bound to a gate is a role nothing sends and a purpose written on a terminal is
 * documentation. {@link kindEffect} states that per kind, because the alternative is a
 * panel that offers the field and lets the author assume it works.
 *
 * Pure, and shared with the window: no filesystem, no React.
 */

import { capabilityAnswer, effectiveRequirements, undeclaredOutcomeOf } from './loop-graph';
import type {
  FailureKind,
  LoopEdge,
  LoopGraph,
  LoopNode,
  LoopTarget,
  NodeKind,
  RequirementId,
  ResolvedRole,
  StepLimits,
} from './loop-graph';

/** A field, as a person reads it: what it is called, and what it actually does. */
export interface SettingHelp {
  /** The readable name. The field name stays visible beside it; this is not a rename. */
  readonly name: string;
  /** What it counts or bounds, in what unit, and over what. */
  readonly detail: string;
  /** What leaving it empty means. Never "nothing"; always what happens instead. */
  readonly whenEmpty: string;
}

/** The four bounds a graph or a node may set. */
export type LimitKey = 'maxCalls' | 'maxReworkRounds' | 'maxMinutes' | 'maxTasks';

export const LIMIT_KEYS: readonly LimitKey[] = [
  'maxCalls',
  'maxReworkRounds',
  'maxMinutes',
  'maxTasks',
];

/**
 * A bound, explained for the place it is set.
 *
 * `scope` matters more than it looks. The same four names appear on the graph and on a
 * node and mean different things there — `maxCalls` on the graph bounds the run and on
 * a node bounds that node — and a panel that used one sentence for both was the reason
 * a node's empty box read as "no limit at all" when the run had one.
 */
export function limitHelp(key: LimitKey, scope: 'graph' | 'node'): SettingHelp {
  const onNode = scope === 'node';
  switch (key) {
    case 'maxCalls':
      return {
        name: 'Most calls allowed',
        detail: onNode
          ? 'How many times this step may be entered and spend a call. Entering it again after a ' +
            'correction round counts again.'
          : 'How many steps this run may call in total. A step that calls an agent spends one; a ' +
            'terminal, a router and a human step spend none.',
        whenEmpty: onNode
          ? 'Empty: this step adds no bound of its own and the run’s own limit is what applies.'
          : 'Empty: the run is not bounded by a number of calls. Only the other limits and the ' +
            'drawing itself stop it.',
      };
    case 'maxReworkRounds':
      return {
        name: 'Maximum correction rounds',
        detail:
          'How many times work may be sent back for correction. A round is counted each time the ' +
          'run returns to a step it has already completed — the review’s "rework" branch back to ' +
          'the implementer is one round. At the limit the run does not hand the work back again: ' +
          'it ends as "a bound was reached", which is not a verdict on the work, and what has been ' +
          'changed stays in the working copy.',
        whenEmpty: onNode
          ? 'Empty: this step sets no bound of its own and the run’s own limit applies.'
          : 'Empty: nothing bounds correction rounds, so a review that keeps answering "rework" ' +
            'keeps the run going.',
      };
    case 'maxMinutes':
      return {
        name: 'Longest this may take, in minutes',
        detail: onNode
          ? 'Wall clock from the moment this step starts. When it runs out the step is treated as ' +
            'machinery that stopped moving, not as a result: the run stops for a person the way ' +
            'the graph’s "on a runtime fault" setting says, and no branch is taken. Files are left ' +
            'as they are.'
          : 'Wall clock for the whole run, applied to a step that sets no bound of its own. ' +
            'Running out is a runtime fault, not a branch.',
        whenEmpty: onNode
          ? 'Empty: the run’s own limit applies, and failing that DSpatch still refuses to wait ' +
            'forever — twenty minutes is the backstop.'
          : 'Empty: each step falls back to DSpatch’s own twenty-minute backstop rather than ' +
            'waiting indefinitely.',
      };
    case 'maxTasks':
      return {
        name: 'Assignments per run',
        detail:
          'How many separate assignments one run may take on. One is the normal answer and holds ' +
          'by construction: a run is started with one mandate.',
        whenEmpty:
          'Empty: nothing states it, and a run still carries the one mandate it was started with.',
      };
  }
}

/** A limit as it stands here: the number, and where the number came from. */
export interface LimitStanding {
  readonly key: LimitKey;
  readonly help: SettingHelp;
  /** What this node sets, or `undefined` when it sets nothing. */
  readonly onNode: number | undefined;
  /** What the graph sets, which is what applies when the node sets nothing. */
  readonly onGraph: number | undefined;
  /** The number actually in force, or `null` when neither sets one. */
  readonly inForce: number | null;
  /** `node`, `graph`, or `none`. The panel shows this instead of an empty box. */
  readonly from: 'node' | 'graph' | 'none';
}

export function limitStandings(
  node: Pick<LoopNode, 'limits'>,
  graphLimits: StepLimits | undefined,
): readonly LimitStanding[] {
  return LIMIT_KEYS.map((key) => {
    const onNode = node.limits?.[key];
    const onGraph = graphLimits?.[key];
    const from = onNode !== undefined ? 'node' : onGraph !== undefined ? 'graph' : 'none';
    return {
      key,
      help: limitHelp(key, 'node'),
      onNode,
      onGraph,
      inForce: onNode ?? onGraph ?? null,
      from,
    };
  });
}

/** The readable name of each requirement. The identifier stays visible beside it. */
export const REQUIREMENT_HELP: Readonly<Record<RequirementId, SettingHelp>> = {
  'no-file-writes': {
    name: 'May not write files',
    detail: 'The step may read and reason and must not change anything on disk.',
    whenEmpty: 'Not required: the step may write where the run lets it.',
  },
  'background-execution': {
    name: 'Runs unattended, in the background',
    detail: 'The step is expected to run without a person watching it or answering it.',
    whenEmpty: 'Not required: the step runs the way the run is running.',
  },
  'fixed-model-selection': {
    name: 'Must use one named model',
    detail: 'The step needs a particular model rather than whatever the run is using.',
    whenEmpty: 'Not required: the model comes from this node’s model choice, or from the run.',
  },
  'no-subagent-delegation': {
    name: 'May not call further agents',
    detail: 'The step does the work itself and does not hand it on to agents of its own.',
    whenEmpty: 'Not required: nothing here says whether the step may delegate.',
  },
  'tool-restriction': {
    name: 'Restricted to a named set of tools',
    detail: 'The step should only reach the tools it has been given, not everything available.',
    whenEmpty: 'Not required: the step has whatever tools the provider gives it.',
  },
};

/**
 * How a requirement stands on one node: where it came from, and what holds it.
 *
 * `onNode` and `fromRole` together are the fix for *an inherited requirement must not
 * look switched off because a local checkbox is empty*. `onNode` is what the checkbox
 * controls; `fromRole` is what the role already states; `inForce` is the answer to the
 * question a person is actually asking.
 */
export interface RequirementStanding {
  readonly requirement: RequirementId;
  readonly help: SettingHelp;
  /** Ticked on this node. */
  readonly onNode: boolean;
  /** Stated by the role this node performs. */
  readonly fromRole: boolean;
  readonly inForce: boolean;
  /**
   * What the target does about it: enforced, achieved another way, unestablished, or
   * impossible. This is the line that separates a restriction from an instruction.
   */
  readonly enforcement: 'enforced' | 'other-means' | 'unknown' | 'unmet';
  /** One sentence naming the mechanism, or naming its absence. Empty when not in force. */
  readonly howItHolds: string;
}

export function requirementStanding(
  requirement: RequirementId,
  node: Pick<LoopNode, 'requirements'>,
  role: ResolvedRole | null,
  target: LoopTarget,
): RequirementStanding {
  const onNode = (node.requirements ?? []).includes(requirement);
  const fromRole = (role?.requirements ?? []).includes(requirement);
  // The panel describes a node of a drawing DSpatch runs, so it asks about that path and
  // not about a generated agent file, which nothing in a walked run reads.
  const answer = capabilityAnswer(target, requirement, 'dspatch-walked-run');
  const inForce = onNode || fromRole;
  return {
    requirement,
    help: REQUIREMENT_HELP[requirement],
    onNode,
    fromRole,
    inForce,
    enforcement: answer.status,
    howItHolds: inForce ? howRequirementHolds(target, answer.status, answer.how) : '',
  };
}

function howRequirementHolds(
  target: LoopTarget,
  status: RequirementStanding['enforcement'],
  how: string,
): string {
  switch (status) {
    case 'enforced':
      return `${target} enforces this itself: ${how}`;
    case 'other-means':
      return (
        `${target} does not enforce this. It is an instruction the agent is expected to follow, ` +
        `not a restriction anything applies: ${how}`
      );
    case 'unknown':
      return (
        `Nobody has established whether ${target} can do anything about this, so treat it as ` +
        `stated and not held: ${how}`
      );
    case 'unmet':
      return `${target} cannot meet this at all, so the graph is not runnable as drawn: ${how}`;
  }
}

/** Every requirement, with where it came from, for one node. */
export function requirementStandings(
  node: Pick<LoopNode, 'requirements'>,
  role: ResolvedRole | null,
  target: LoopTarget,
  requirements: readonly RequirementId[],
): readonly RequirementStanding[] {
  return requirements.map((requirement) => requirementStanding(requirement, node, role, target));
}

/** What the role brings to this node, as opposed to what the node adds itself. */
export function inheritedFromRole(
  node: LoopNode,
  role: ResolvedRole | null,
): readonly RequirementId[] {
  return effectiveRequirements(node, role)
    .filter((entry) => entry.from === 'role')
    .map((entry) => entry.requirement);
}

/** One named answer this step may give, and where answering it goes. */
export interface OutcomeStanding {
  readonly outcome: string;
  /** The words on the arrow, when the author wrote any. */
  readonly edgeLabel: string | null;
  /** The step it leads to, by name, or `null` when nothing is drawn for it yet. */
  readonly leadsTo: string | null;
  readonly leadsToId: string | null;
  /** True when an edge carries this outcome. A graph is not saveable until every one does. */
  readonly drawn: boolean;
}

export function outcomeStandings(
  graph: Pick<LoopGraph, 'nodes' | 'edges'>,
  node: Pick<LoopNode, 'id' | 'outcomes'>,
): readonly OutcomeStanding[] {
  return (node.outcomes ?? []).map((outcome) => {
    const edge = graph.edges.find(
      (candidate) =>
        candidate.from === node.id &&
        candidate.when.on === 'outcome' &&
        candidate.when.outcome === outcome,
    );
    return { outcome, ...destination(graph, edge) };
  });
}

/**
 * Where a reply that names none of this node's outcomes goes.
 *
 * DSP-103 #2. The panel used to say nothing at all about this, and there was nothing
 * honest it could have said: the answer depended on whether the author had happened to
 * spell an outcome `unclear` or `could-not-check`, which is not a fact the drawing
 * records. It is a field now, so the panel states it — and states it from
 * {@link undeclaredOutcomeOf}, the same function the runner and the prompt ask, rather
 * than from a second reading of `whenUndeclared` written here.
 */
export interface UndeclaredStanding {
  /** What the node states, even where it names an outcome the node cannot produce. */
  readonly stated: string | null;
  /** The outcome actually taken, or `null` when a missing declaration stops the run. */
  readonly outcome: string | null;
  /** True when `stated` names something this node does not declare — a graph error. */
  readonly impossible: boolean;
  /** Whether this node declares any outcomes, which is what makes the field meaningful. */
  readonly declaresOutcomes: boolean;
  readonly edgeLabel: string | null;
  readonly leadsTo: string | null;
  readonly leadsToId: string | null;
  readonly drawn: boolean;
}

export function undeclaredStanding(
  graph: Pick<LoopGraph, 'nodes' | 'edges'>,
  node: Pick<LoopNode, 'id' | 'outcomes' | 'whenUndeclared'>,
): UndeclaredStanding {
  const outcome = undeclaredOutcomeOf(node);
  const edge =
    outcome === null
      ? undefined
      : graph.edges.find(
          (candidate) =>
            candidate.from === node.id &&
            candidate.when.on === 'outcome' &&
            candidate.when.outcome === outcome,
        );
  return {
    stated: node.whenUndeclared ?? null,
    outcome,
    impossible: node.whenUndeclared !== undefined && outcome === null,
    declaresOutcomes: (node.outcomes ?? []).length > 0,
    ...destination(graph, edge),
  };
}

/** One failure this step may declare: what it means, and where declaring it goes. */
export interface FailureStanding {
  readonly kind: FailureKind;
  /** Whether this node may declare it. Only a declared failure can route. */
  readonly declared: boolean;
  readonly edgeLabel: string | null;
  readonly leadsTo: string | null;
  readonly leadsToId: string | null;
  readonly drawn: boolean;
}

export function failureStandings(
  graph: Pick<LoopGraph, 'nodes' | 'edges' | 'failureKinds'>,
  node: Pick<LoopNode, 'id' | 'declaredFailures'>,
): readonly FailureStanding[] {
  return graph.failureKinds.map((kind) => {
    const edge = graph.edges.find(
      (candidate) =>
        candidate.from === node.id &&
        candidate.when.on === 'declared-failure' &&
        candidate.when.failure === kind.id,
    );
    return {
      kind,
      declared: (node.declaredFailures ?? []).includes(kind.id),
      ...destination(graph, edge),
    };
  });
}

function destination(
  graph: Pick<LoopGraph, 'nodes'>,
  edge: LoopEdge | undefined,
): {
  readonly edgeLabel: string | null;
  readonly leadsTo: string | null;
  readonly leadsToId: string | null;
  readonly drawn: boolean;
} {
  if (edge === undefined) {
    return { edgeLabel: null, leadsTo: null, leadsToId: null, drawn: false };
  }
  const target = graph.nodes.find((candidate) => candidate.id === edge.to);
  return {
    edgeLabel: edge.label ?? null,
    leadsTo: target?.label ?? edge.to,
    leadsToId: edge.to,
    drawn: true,
  };
}

/**
 * What this kind of step actually does with the fields the panel offers.
 *
 * Read off `loop-live.ts`'s executor, one branch per kind, rather than inferred from
 * the format. `purposeGoes` is the answer to *check whether Purpose is also part of
 * the agent's prompt before changing the text* — it is, for an agent, and it is also
 * the question a person is shown at a human step, so one text has to serve both.
 */
export interface KindEffect {
  /** Whether a run of this graph reaches a provider for this kind. */
  readonly callsAnAgent: boolean;
  /**
   * Where this node's purpose ends up when the run reaches it.
   *
   * One sentence, deliberately. It sits directly above the role text in the panel and
   * every line it takes is a line of the role pushed below the fold — and the fuller
   * account of what the message contains is already the Brief section's whole job, so a
   * paragraph here would be the same thing said twice at the cost of the thing a person
   * opened the panel to read.
   */
  readonly purposeGoes: string;
  /** What the runner does at this node. One sentence, present tense. */
  readonly whatTheRunnerDoes: string;
  /**
   * Fields this kind offers that nothing acts on, each with what happens instead.
   * Empty for a kind where every offered field is used.
   */
  readonly withoutEffect: readonly string[];
}

export function kindEffect(kind: NodeKind): KindEffect {
  switch (kind) {
    case 'agent':
      return {
        callsAnAgent: true,
        purposeGoes:
          'Sent to the agent as its task, after the role text — and used as this node’s tooltip ' +
          'and its line in the run journal, so it has to read as an instruction and as an ' +
          'explanation at once.',
        whatTheRunnerDoes:
          'Opens a session for this node, sends the brief, and reads the reply for a named result ' +
          'or a declared failure.',
        withoutEffect: [],
      };
    case 'gate':
      return {
        callsAnAgent: false,
        purposeGoes:
          'Nowhere in a run. No brief is built for a gate, so this is read by people only — here, ' +
          'and in the run journal.',
        whatTheRunnerDoes:
          'Runs the project’s configured check command in the working folder and answers "pass" ' +
          'or "fail" from its exit code.',
        withoutEffect: [
          'A role bound to a gate is never sent. No brief is built for a gate, so the role is ' +
            'validated and then unused. Move the work to an agent step if a role has to read ' +
            'anything.',
        ],
      };
    case 'router':
      return {
        callsAnAgent: false,
        purposeGoes:
          'Nowhere in a run. Read by people only: this window, and the run journal’s entry line.',
        whatTheRunnerDoes:
          'Takes its first declared outcome and moves on, without calling anything.',
        withoutEffect: [
          'Every outcome after the first is unreachable in a run today: the runner takes the ' +
            'first one declared. A classification that has to be made by judgement belongs on an ' +
            'agent step that declares those outcomes.',
        ],
      };
    case 'human':
      return {
        callsAnAgent: false,
        purposeGoes:
          'Shown to the person as the question the run is waiting on. It is the whole of what ' +
          'they are asked, so it has to say what to decide.',
        whatTheRunnerDoes:
          'Stops the run and waits for a person. Nothing is reset while it waits.',
        withoutEffect: [],
      };
    case 'external':
      return {
        callsAnAgent: false,
        purposeGoes: 'Nowhere in a run. Read by people only.',
        whatTheRunnerDoes:
          'Nothing. This increment does not run external participants: reaching one stops the run ' +
          'as a runtime fault saying it was not called.',
        withoutEffect: [
          'Everything on this node is documentation. The drawing can say an outside participant ' +
            'belongs here; DSpatch cannot call one.',
        ],
      };
    case 'terminal':
      return {
        callsAnAgent: false,
        purposeGoes:
          'Nowhere in a run. It is what reaching this ending means, for whoever reads the run ' +
          'afterwards.',
        whatTheRunnerDoes:
          'Stops the run here and records this ending as how it finished. Nothing is undone: what ' +
          'the run changed stays changed.',
        withoutEffect: [],
      };
  }
}
