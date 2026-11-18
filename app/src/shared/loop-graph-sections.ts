/**
 * DSP-227: two reusable graph sections a graph builder adds and changes as settings, never as
 * hand-written JSON: a choice made per task (such as the model class the work needs), and a
 * split that runs independent parts in parallel and integrates them.
 *
 * Both are read from and written to the graph's own fields, which stay the one definition:
 * `choices`, a node's `decides` and `model.chosenBy`, a fan-out node's `fanOut` and the edges
 * around it. There is no separate section record that could disagree with the graph. The
 * editor's forms and the chat agent's `propose_graph_section` call the same functions, and the
 * result is checked by the same loader as any other graph. Nothing here knows a role or a node
 * by name: every id comes from the settings.
 */
import {
  BRANCH_FAILED,
  isModelClassChoice,
  type EdgeCondition,
  type FailureKind,
  type FanOutIsolation,
  type LoopEdge,
  type LoopGraph,
  type LoopNode,
  type ModelPolicy,
  type RoleReference,
  type VisitChoiceDef,
} from './loop-graph';
import { integratorsOf } from './loop-split-instructions';

/** The failure a run reports when it reaches a configured call or rework bound. */
export const LIMIT_REACHED = 'limit-reached';

const BRANCH_FAILED_KIND: FailureKind = {
  id: BRANCH_FAILED,
  label: 'A branch failed',
  meaning:
    "A parallel branch faulted, timed out or produced nothing, or the split could not be run. Every branch's work is kept on its temporary branch or in its kept worktree.",
};

const LIMIT_REACHED_KIND: FailureKind = {
  id: LIMIT_REACHED,
  label: 'Run limit reached',
  meaning: 'The runtime reached a configured call or rework bound.',
};

// ---------------------------------------------------------------------------------------------
// A choice made per task

/** A model-class choice to start from: three classes, ordered, the middle one by default. */
export function modelClassChoiceTemplate(id = 'class'): VisitChoiceDef {
  return {
    id,
    label: 'Model class',
    meaning: 'The model capacity the work needs. It picks the model class of the steps that follow it, and nothing else.',
    options: [
      { id: 'small', meaning: 'A straightforward, localized task with an obvious approach.', modelClass: 'small' },
      { id: 'medium', meaning: 'A task that follows established patterns across several places.', modelClass: 'medium' },
      { id: 'large', meaning: 'A complex task: an uncertain design, a wide impact or conflicting evidence.', modelClass: 'large' },
    ],
    default: 'medium',
    order: 'weakest-first',
  };
}

/** A review-route choice to start from: ordered, never weakened by a join, strongest when missing. */
export function reviewChoiceTemplate(id = 'review'): VisitChoiceDef {
  return {
    id,
    label: 'Review route',
    meaning: 'Which checks the work goes through, independently of its model class.',
    options: [
      { id: 'standard', meaning: 'The usual checks for well-understood work.' },
      { id: 'thorough', meaning: 'A deeper review of design and correctness, for risky or uncertain work.' },
    ],
    default: 'standard',
    order: 'weakest-first',
    joins: 'strongest',
    whenMissing: 'strongest',
  };
}

/** A choice section's settings, as the editor shows them and the chat agent passes them. */
export interface ChoiceSectionSettings {
  /** The choice itself: its options, their criteria and classes, its default and order. */
  readonly choice: VisitChoiceDef;
  /** The agent steps that decide it on each visit, on a `CHOICE:` line. */
  readonly decidedBy: readonly string[];
  /**
   * The agent steps whose model follows it, for a model-class choice only, each with the options
   * it may run (absent or empty: every option).
   */
  readonly appliesTo: readonly { readonly nodeId: string; readonly options?: readonly string[] }[];
}

/** The section as the graph holds it now, or `null` when the graph has no such choice. */
export function readChoiceSection(graph: LoopGraph, choiceId: string): ChoiceSectionSettings | null {
  const choice = (graph.choices ?? []).find((candidate) => candidate.id === choiceId);
  if (choice === undefined) {
    return null;
  }
  return {
    choice,
    decidedBy: graph.nodes.filter((node) => (node.decides ?? []).includes(choiceId)).map((node) => node.id),
    appliesTo: graph.nodes.flatMap((node) =>
      node.model?.policy === 'select' && node.model.chosenBy === choiceId
        ? [
            {
              nodeId: node.id,
              ...((node.model.options ?? []).length === choice.options.length ? {} : { options: (node.model.options ?? []).map((option) => option.id) }),
            },
          ]
        : [],
    ),
  };
}

/** What an apply could not do, in words for the person or the agent. Empty when it did all. */
export type SectionProblems = readonly string[];

/**
 * The graph with this choice section in place: the choice added or replaced, `decides` on
 * exactly the deciding steps, and a model chosen by it on exactly the steps it applies to. A
 * step that no longer follows it goes back to the agent's own model (`inherit`).
 */
export function applyChoiceSection(graph: LoopGraph, settings: ChoiceSectionSettings): { readonly graph: LoopGraph; readonly problems: SectionProblems } {
  const problems: string[] = [];
  const { choice } = settings;
  const classful = isModelClassChoice(choice);
  const agentIds = new Set(graph.nodes.filter((node) => node.kind === 'agent').map((node) => node.id));
  for (const id of [...settings.decidedBy, ...settings.appliesTo.map((entry) => entry.nodeId)]) {
    if (!agentIds.has(id)) {
      problems.push(`"${id}" is not an agent step of this graph.`);
    }
  }
  if (!classful && settings.appliesTo.length > 0) {
    problems.push(`Choice "${choice.id}" names no model class for each option, so no step's model can follow it.`);
  }
  if (settings.decidedBy.length === 0) {
    problems.push(`No step decides "${choice.id}", so every visit carries its default.`);
  }
  const choices = [...(graph.choices ?? []).filter((candidate) => candidate.id !== choice.id), choice];
  const applies = new Map(settings.appliesTo.map((entry) => [entry.nodeId, entry.options] as const));
  const nodes = graph.nodes.map((node) => {
    let next: LoopNode = node;
    const decides = (node.decides ?? []).filter((id) => id !== choice.id);
    const deciding = settings.decidedBy.includes(node.id) ? [...decides, choice.id] : decides;
    if (deciding.length !== (node.decides ?? []).length || deciding.some((id, index) => id !== node.decides?.[index])) {
      next = withField(next, 'decides', deciding.length === 0 ? undefined : deciding);
    }
    const follows = node.model?.policy === 'select' && node.model.chosenBy === choice.id;
    if (classful && applies.has(node.id)) {
      const allowed = (applies.get(node.id) ?? []).filter((id) => choice.options.some((option) => option.id === id));
      const ids = allowed.length === 0 ? choice.options.map((option) => option.id) : allowed;
      const keep = follows && node.model?.default !== undefined && ids.includes(node.model.default) ? node.model.default : undefined;
      const model: ModelPolicy = {
        policy: 'select',
        options: ids.map((id) => ({ id, modelClass: choice.options.find((option) => option.id === id)?.modelClass })),
        default: keep ?? (ids.includes(choice.default) ? choice.default : (ids[0] ?? choice.default)),
        chosenBy: choice.id,
      };
      next = { ...next, model };
    } else if (follows) {
      next = { ...next, model: { policy: 'inherit' } };
    }
    return next;
  });
  return { graph: { ...graph, choices, nodes }, problems };
}

/** The graph without this choice: no step decides it, no model follows it, no edge names it. */
export function removeChoiceSection(graph: LoopGraph, choiceId: string): LoopGraph {
  const nodes = graph.nodes.map((node) => {
    let next = node;
    if ((node.decides ?? []).includes(choiceId)) {
      const decides = (node.decides ?? []).filter((id) => id !== choiceId);
      next = withField(next, 'decides', decides.length === 0 ? undefined : decides);
    }
    if (node.model?.policy === 'select' && node.model.chosenBy === choiceId) {
      next = { ...next, model: { policy: 'inherit' } };
    }
    if (node.fanOut?.sliceChoices?.includes(choiceId) === true) {
      next = { ...next, fanOut: { ...node.fanOut, sliceChoices: node.fanOut.sliceChoices.filter((id) => id !== choiceId) } };
    }
    return next;
  });
  const edges = graph.edges.map((edge) => {
    let next = edge;
    for (const field of ['sets', 'whenChosen'] as const) {
      const map = next[field];
      if (map !== undefined && choiceId in map) {
        const rest = Object.fromEntries(Object.entries(map).filter(([id]) => id !== choiceId));
        next = withField(next, field, Object.keys(rest).length === 0 ? undefined : rest);
      }
    }
    return next;
  });
  const choices = (graph.choices ?? []).filter((choice) => choice.id !== choiceId);
  return withField({ ...graph, nodes, edges }, 'choices', choices.length === 0 ? undefined : choices);
}

// ---------------------------------------------------------------------------------------------
// Split, run in parallel, integrate

/** Where the integrated work goes: one step, or a step per option of a choice (such as the review route). */
export type AfterIntegration =
  | { readonly to: string }
  | { readonly byChoice: string; readonly to: Readonly<Record<string, string>> };

/** A parallel section's settings, as the editor shows them and the chat agent passes them. */
export interface ParallelSectionSettings {
  /** The step that proposes the split and writes the slices. */
  readonly proposer: string;
  /** The proposer's outcome that sends the work to the branches. */
  readonly splitOutcome: string;
  /** Optional: a sequential route to make sure of, the proposer's outcome and the step it leads to. */
  readonly sequential?: { readonly outcome: string; readonly to: string };
  /** The fan-out step: its id, label, and the role a branch runs with when its slice names no other. */
  readonly branches: {
    readonly id: string;
    readonly label?: string;
    readonly role: RoleReference;
    readonly purpose?: string;
  };
  /** The steps a slice may name to run its branch as: their role, purpose, requirements and model policy. */
  readonly branchAs: readonly string[];
  /** The graph's choices a slice may set for its own branch (such as model class and review route). */
  readonly sliceChoices: readonly string[];
  /** A model-class choice the fan-out step's own model follows, or `null` for the agent's own model. */
  readonly branchModelChoice: string | null;
  readonly maxConcurrent: number;
  readonly isolation: FanOutIsolation;
  /** The builder's own criteria for when to split. */
  readonly splitWhen?: string;
  /** The step that integrates the branches; created when the graph does not have it. */
  readonly integrator: {
    readonly id: string;
    readonly label?: string;
    readonly role: RoleReference;
    readonly purpose?: string;
    /** Its model, an explicit policy: a branch's class does not decide it unless this says so. */
    readonly model?: ModelPolicy;
  };
  /** The integrator's three outcomes, by name. */
  readonly outcomes: { readonly integrated: string; readonly rework: string; readonly unresolved: string };
  readonly afterIntegration: AfterIntegration;
  /** Where an unresolved decision, a failed branch or a needed resplit goes; usually the proposer. */
  readonly onUnresolved: string;
  /** Where a reached run limit goes from the branches and the integrator, or `null` for none. */
  readonly onLimit: string | null;
}

/** The integrator's outcomes when nothing names them. */
export const DEFAULT_INTEGRATOR_OUTCOMES = { integrated: 'integrated', rework: 'rework', unresolved: 'needs-decision' } as const;

/** The purpose a new fan-out step gets, editable afterwards. */
export const DEFAULT_BRANCH_PURPOSE =
  'Do your slice of the work in your own branch, inside the paths your slice owns, and run your slice\'s check. Report what you changed, ' +
  'the checks you ran and their results, what you could not do, and any open decision about a shared contract. On a later visit you are ' +
  'given the integrator\'s findings: act on those that concern your slice.';

/** The purpose a new integrator gets, editable afterwards; the outcome names are filled in. */
export function defaultIntegratorPurpose(outcomes: ParallelSectionSettings['outcomes']): string {
  return (
    "Combine the branches into the working copy: read each branch's result and ending, its open decisions and the messages between the " +
    'branches; check each against the shared contracts; merge the temporary branches in the order listed, resolve conflicts and name each ' +
    'merge and resolution; run the checks that show the parts work together. A merge is not proof that they do. ' +
    `Choose ${outcomes.integrated} only when every branch finished and was combined and checked and no contract proposal is left open. ` +
    `Choose ${outcomes.rework}, with concrete findings per branch, when the branches can fix what is wrong in another round. ` +
    `Choose ${outcomes.unresolved} when a branch failed or was cancelled, a shared contract needs a decision, or the work must be split ` +
    'differently or done in sequence; name each such branch and where its work is kept. Never delete a temporary branch.'
  );
}

/** The section around a fan-out step as the graph holds it now, or `null` when it is not one. */
export function readParallelSection(graph: LoopGraph, fanOutId: string): ParallelSectionSettings | null {
  const fan = graph.nodes.find((node) => node.id === fanOutId);
  if (fan?.fanOut === undefined || fan.role === undefined) {
    return null;
  }
  const fanOut = fan.fanOut;
  const outcomeTo = (from: string, to: string): string | undefined => {
    const edge = graph.edges.find((candidate) => candidate.from === from && candidate.to === to && candidate.when.on === 'outcome');
    return edge?.when.on === 'outcome' ? edge.when.outcome : undefined;
  };
  const integrator = integratorsOf(graph, fan.id)[0];
  const fromIntegrator = integrator === undefined ? [] : graph.edges.filter((edge) => edge.from === integrator.id);
  const rework = fromIntegrator.find((edge) => edge.to === fan.id && edge.when.on === 'outcome');
  const unresolvedEdge = fromIntegrator.find(
    (edge) => edge.when.on === 'outcome' && (edge.when.outcome === integrator?.whenUndeclared || edge.to === fanOut.slicesFrom),
  );
  const outcomeOf = (edge: LoopEdge | undefined): string | undefined => (edge?.when.on === 'outcome' ? edge.when.outcome : undefined);
  const unresolved = outcomeOf(unresolvedEdge) ?? DEFAULT_INTEGRATOR_OUTCOMES.unresolved;
  const reworkOutcome = outcomeOf(rework) ?? DEFAULT_INTEGRATOR_OUTCOMES.rework;
  const integratedEdges = fromIntegrator.filter(
    (edge) => edge.when.on === 'outcome' && edge.when.outcome !== unresolved && edge.when.outcome !== reworkOutcome,
  );
  const integrated = outcomeOf(integratedEdges[0]) ?? DEFAULT_INTEGRATOR_OUTCOMES.integrated;
  const guarded = integratedEdges.filter((edge) => edge.whenChosen !== undefined);
  const byChoice = guarded.length > 0 ? Object.keys(guarded[0]?.whenChosen ?? {})[0] : undefined;
  const afterIntegration: AfterIntegration =
    byChoice !== undefined
      ? { byChoice, to: Object.fromEntries(guarded.map((edge) => [edge.whenChosen?.[byChoice] ?? '', edge.to])) }
      : { to: integratedEdges[0]?.to ?? '' };
  const limit = graph.edges.find((edge) => edge.from === fan.id && edge.when.on === 'declared-failure' && edge.when.failure === LIMIT_REACHED);
  const sequentialEdge = graph.edges.find(
    (edge) => edge.from === fanOut.slicesFrom && edge.when.on === 'outcome' && edge.to !== fan.id,
  );
  const model = fan.model;
  return {
    proposer: fanOut.slicesFrom,
    splitOutcome: outcomeTo(fanOut.slicesFrom, fan.id) ?? 'parallel',
    ...(sequentialEdge?.when.on === 'outcome' ? { sequential: { outcome: sequentialEdge.when.outcome, to: sequentialEdge.to } } : {}),
    branches: { id: fan.id, ...(fan.label === undefined ? {} : { label: fan.label }), role: fan.role, ...(fan.purpose === undefined ? {} : { purpose: fan.purpose }) },
    branchAs: fanOut.branchAs ?? [],
    sliceChoices: fanOut.sliceChoices ?? (graph.choices ?? []).map((choice) => choice.id),
    branchModelChoice: model?.policy === 'select' && model.chosenBy !== undefined ? model.chosenBy : null,
    maxConcurrent: fanOut.maxConcurrent,
    isolation: fanOut.isolation,
    ...(fanOut.splitWhen === undefined ? {} : { splitWhen: fanOut.splitWhen }),
    integrator:
      integrator === undefined || integrator.role === undefined
        ? { id: `${fan.id}-integrator`, role: fan.role }
        : {
            id: integrator.id,
            ...(integrator.label === undefined ? {} : { label: integrator.label }),
            role: integrator.role,
            ...(integrator.purpose === undefined ? {} : { purpose: integrator.purpose }),
            ...(integrator.model === undefined ? {} : { model: integrator.model }),
          },
    outcomes: { integrated, rework: reworkOutcome, unresolved },
    afterIntegration,
    onUnresolved: unresolvedEdge?.to ?? fanOut.slicesFrom,
    onLimit: limit?.to ?? null,
  };
}

/**
 * The graph with this parallel section in place. The proposer gains the split outcome; the
 * fan-out step and the integrator are created or updated; the edges between them, and the
 * integrator's and the fan-out's own edges, are made to match the settings, keeping each
 * matching edge's id, label and what it delivers. Nothing else in the graph changes: the
 * proposer's other outcomes, which are the sequential path, stay as they are.
 */
export function applyParallelSection(graph: LoopGraph, settings: ParallelSectionSettings): { readonly graph: LoopGraph; readonly problems: SectionProblems } {
  const problems: string[] = [];
  const { proposer, branches, integrator, outcomes } = settings;
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const proposerNode = byId.get(proposer);
  if (proposerNode === undefined || proposerNode.kind !== 'agent') {
    return { graph, problems: [`The proposing step "${proposer}" is not an agent step of this graph.`] };
  }
  if (branches.id === proposer || integrator.id === proposer || integrator.id === branches.id) {
    return { graph, problems: ['The proposing step, the branches and the integrator must be three different steps.'] };
  }
  for (const id of settings.branchAs) {
    const node = byId.get(id);
    if (node === undefined || node.kind !== 'agent' || node.role === undefined || node.fanOut !== undefined) {
      problems.push(`A branch cannot run as "${id}": it is not an agent step with a role that does not fan out itself.`);
    }
  }
  for (const id of settings.sliceChoices) {
    if (!(graph.choices ?? []).some((choice) => choice.id === id)) {
      problems.push(`"${id}" is not one of the graph's choices, so a slice cannot set it.`);
    }
  }
  const modelChoice = settings.branchModelChoice === null ? undefined : (graph.choices ?? []).find((choice) => choice.id === settings.branchModelChoice);
  if (settings.branchModelChoice !== null && (modelChoice === undefined || !isModelClassChoice(modelChoice))) {
    problems.push(`"${settings.branchModelChoice}" is not a model-class choice of this graph, so the branches' model cannot follow it.`);
  }
  const outcomeNames = [outcomes.integrated, outcomes.rework, outcomes.unresolved];
  if (new Set(outcomeNames).size !== 3 || outcomeNames.some((name) => !/^[a-z0-9][a-z0-9-]*$/.test(name))) {
    problems.push('The integrator needs three different outcome names, of lower-case letters, digits and hyphens.');
  }
  const targets = settings.afterIntegration.to;
  const afterTargets = typeof targets === 'string' ? [targets] : Object.values(targets);
  for (const id of [...afterTargets, settings.onUnresolved, ...(settings.onLimit === null ? [] : [settings.onLimit]), ...(settings.sequential === undefined ? [] : [settings.sequential.to])]) {
    if (!byId.has(id) && id !== branches.id && id !== integrator.id) {
      problems.push(`"${id}" is not a step of this graph.`);
    }
  }
  if ('byChoice' in settings.afterIntegration) {
    const choice = (graph.choices ?? []).find((candidate) => candidate.id === (settings.afterIntegration as { byChoice: string }).byChoice);
    const routed = settings.afterIntegration.to;
    if (choice === undefined || choice.options.some((option) => routed[option.id] === undefined)) {
      problems.push('Routing the integrated work by a choice needs a step for every option of that choice.');
    }
  }
  const otherOutcomes = (proposerNode.outcomes ?? []).filter((outcome) => outcome !== settings.splitOutcome);
  if (otherOutcomes.length === 0 && settings.sequential === undefined) {
    problems.push(`"${proposer}" has no outcome but the split, so there is no sequential path for work that does not split.`);
  }
  if (problems.length > 0) {
    return { graph, problems };
  }

  // Failure kinds the section routes on.
  const failureKinds = [...graph.failureKinds];
  for (const kind of [BRANCH_FAILED_KIND, ...(settings.onLimit === null ? [] : [LIMIT_REACHED_KIND])]) {
    if (!failureKinds.some((known) => known.id === kind.id)) {
      failureKinds.push(kind);
    }
  }

  // The proposer: the split outcome, and the sequential one if asked for.
  const proposerOutcomes = [...(proposerNode.outcomes ?? [])];
  for (const outcome of [settings.splitOutcome, ...(settings.sequential === undefined ? [] : [settings.sequential.outcome])]) {
    if (!proposerOutcomes.includes(outcome)) {
      proposerOutcomes.push(outcome);
    }
  }
  // An outcome the old settings split on, which now leads nowhere, is dropped with its edge.
  const previous = readParallelSection(graph, branches.id);
  const droppedSplit = previous !== null && previous.splitOutcome !== settings.splitOutcome ? previous.splitOutcome : null;
  const nextProposer: LoopNode = { ...proposerNode, outcomes: proposerOutcomes.filter((outcome) => outcome !== droppedSplit) };

  const limitFailures = settings.onLimit === null ? [] : [LIMIT_REACHED];
  const oldFan = byId.get(branches.id);
  const fanNode: LoopNode = {
    ...(oldFan ?? {}),
    id: branches.id,
    kind: 'agent',
    label: branches.label ?? oldFan?.label ?? 'Parallel branches',
    purpose: branches.purpose ?? oldFan?.purpose ?? DEFAULT_BRANCH_PURPOSE,
    role: branches.role,
    model:
      settings.branchModelChoice === null
        ? (oldFan?.model?.policy === 'select' && oldFan.model.chosenBy !== undefined ? { policy: 'inherit' } : (oldFan?.model ?? { policy: 'inherit' }))
        : followModel(oldFan?.model, modelChoice as VisitChoiceDef),
    declaredFailures: [...new Set([...(oldFan?.declaredFailures ?? []).filter((failure) => failure !== LIMIT_REACHED), BRANCH_FAILED, ...limitFailures])],
    fanOut: {
      slicesFrom: proposer,
      maxConcurrent: settings.maxConcurrent,
      isolation: settings.isolation,
      ...(settings.branchAs.length === 0 ? {} : { branchAs: settings.branchAs }),
      sliceChoices: settings.sliceChoices,
      ...(settings.splitWhen === undefined || settings.splitWhen.trim() === '' ? {} : { splitWhen: settings.splitWhen.trim() }),
    },
    report: oldFan?.report ?? { writtenBy: 'self' },
    produces: oldFan?.produces ?? {
      required: true,
      form: 'stored-result',
      note: 'Written by DSpatch: per branch, its role, choices, ending, temporary branch and commit, and its reply, clipped; and the messages between the branches with their delivery.',
    },
  };
  delete (fanNode as { outcomes?: unknown }).outcomes;
  delete (fanNode as { whenUndeclared?: unknown }).whenUndeclared;

  const oldIntegrator = byId.get(integrator.id);
  const integratorNode: LoopNode = {
    ...(oldIntegrator ?? {}),
    id: integrator.id,
    kind: 'agent',
    label: integrator.label ?? oldIntegrator?.label ?? 'Integrate the branches',
    purpose: integrator.purpose ?? oldIntegrator?.purpose ?? defaultIntegratorPurpose(outcomes),
    role: integrator.role,
    model: integrator.model ?? oldIntegrator?.model ?? { policy: 'inherit' },
    outcomes: [outcomes.integrated, outcomes.rework, outcomes.unresolved],
    whenUndeclared: outcomes.unresolved,
    declaredFailures: [...new Set([...(oldIntegrator?.declaredFailures ?? []).filter((failure) => failure !== LIMIT_REACHED), ...limitFailures])],
    report: oldIntegrator?.report ?? { writtenBy: 'self' },
    produces: oldIntegrator?.produces ?? {
      required: true,
      form: 'stored-result',
      note: 'What was merged, from which branch and commit, what conflicted and how it was resolved, what was checked, and each branch\'s ending and open decision.',
    },
    consumes: [...new Set([...(oldIntegrator?.consumes ?? []), branches.id])],
  };
  if (integratorNode.declaredFailures?.length === 0) {
    delete (integratorNode as { declaredFailures?: unknown }).declaredFailures;
  }

  const nodes: LoopNode[] = graph.nodes.map((node) =>
    node.id === proposer ? nextProposer : node.id === branches.id ? fanNode : node.id === integrator.id ? integratorNode : node,
  );
  if (oldFan === undefined) nodes.push(fanNode);
  if (oldIntegrator === undefined) nodes.push(integratorNode);

  // The section's edges: everything out of the branches and the integrator, and the split.
  const wanted: Omit<LoopEdge, 'id'>[] = [
    { from: proposer, to: branches.id, when: { on: 'outcome', outcome: settings.splitOutcome }, label: 'split into parallel branches' },
    ...(settings.sequential === undefined ? [] : [{ from: proposer, to: settings.sequential.to, when: { on: 'outcome', outcome: settings.sequential.outcome } as EdgeCondition }]),
    { from: branches.id, to: integrator.id, when: { on: 'success' }, label: 'every branch finished' },
    { from: branches.id, to: integrator.id, when: { on: 'declared-failure', failure: BRANCH_FAILED }, label: 'a branch failed' },
    ...(settings.onLimit === null ? [] : [{ from: branches.id, to: settings.onLimit, when: { on: 'declared-failure', failure: LIMIT_REACHED } as EdgeCondition }]),
    ...('byChoice' in settings.afterIntegration
      ? Object.entries(settings.afterIntegration.to).map(([option, to]) => ({
          from: integrator.id,
          to,
          when: { on: 'outcome', outcome: outcomes.integrated } as EdgeCondition,
          whenChosen: { [(settings.afterIntegration as { byChoice: string }).byChoice]: option },
        }))
      : [{ from: integrator.id, to: settings.afterIntegration.to, when: { on: 'outcome', outcome: outcomes.integrated } as EdgeCondition }]),
    { from: integrator.id, to: branches.id, when: { on: 'outcome', outcome: outcomes.rework }, label: 'another round of the branches' },
    { from: integrator.id, to: settings.onUnresolved, when: { on: 'outcome', outcome: outcomes.unresolved } },
    ...(settings.onLimit === null ? [] : [{ from: integrator.id, to: settings.onLimit, when: { on: 'declared-failure', failure: LIMIT_REACHED } as EdgeCondition }]),
  ];
  const managed = (edge: LoopEdge): boolean =>
    edge.from === branches.id ||
    edge.from === integrator.id ||
    (edge.from === proposer &&
      edge.when.on === 'outcome' &&
      (edge.when.outcome === settings.splitOutcome ||
        edge.when.outcome === droppedSplit ||
        edge.to === branches.id ||
        (settings.sequential !== undefined && edge.when.outcome === settings.sequential.outcome && edge.to === settings.sequential.to)));
  const pool = graph.edges.filter(managed);
  const sameRoute = (edge: LoopEdge, want: Omit<LoopEdge, 'id'>): boolean =>
    edge.from === want.from && conditionText(edge.when) === conditionText(want.when) && sameChosen(edge.whenChosen, want.whenChosen);
  const taken = new Set(graph.edges.map((edge) => edge.id));
  // Each wanted route keeps the old edge that already is it (same route and target), else one of the same route.
  const made = new Map<string, LoopEdge>();
  const fresh: LoopEdge[] = [];
  for (const want of wanted) {
    const match = pool.find((edge) => sameRoute(edge, want) && edge.to === want.to) ?? pool.find((edge) => sameRoute(edge, want));
    if (match === undefined) {
      fresh.push({ id: freshEdgeId(taken, branches.id), ...want });
      continue;
    }
    pool.splice(pool.indexOf(match), 1);
    made.set(match.id, {
      ...match,
      to: want.to,
      ...(want.whenChosen === undefined ? {} : { whenChosen: want.whenChosen }),
      ...(match.label === undefined && want.label !== undefined ? { label: want.label } : {}),
    });
  }
  const edges = [
    ...graph.edges.flatMap((edge) => (!managed(edge) ? [edge] : made.has(edge.id) ? [made.get(edge.id) as LoopEdge] : [])),
    ...fresh,
  ];
  return { graph: { ...graph, failureKinds, nodes, edges }, problems };
}

/** A select policy following a model-class choice, keeping the options an earlier one allowed. */
function followModel(previous: ModelPolicy | undefined, choice: VisitChoiceDef): ModelPolicy {
  const kept =
    previous?.policy === 'select' && previous.chosenBy === choice.id
      ? (previous.options ?? []).map((option) => option.id).filter((id) => choice.options.some((option) => option.id === id))
      : [];
  const ids = kept.length === 0 ? choice.options.map((option) => option.id) : kept;
  return {
    policy: 'select',
    options: ids.map((id) => ({ id, modelClass: choice.options.find((option) => option.id === id)?.modelClass })),
    default: ids.includes(choice.default) ? choice.default : (ids[0] ?? choice.default),
    chosenBy: choice.id,
  };
}

function conditionText(when: EdgeCondition): string {
  return when.on === 'outcome' ? `outcome:${when.outcome}` : when.on === 'declared-failure' ? `failure:${when.failure}` : 'success';
}

function sameChosen(left: LoopEdge['whenChosen'], right: LoopEdge['whenChosen']): boolean {
  return JSON.stringify(Object.entries(left ?? {}).sort()) === JSON.stringify(Object.entries(right ?? {}).sort());
}

function freshEdgeId(taken: Set<string>, base: string): string {
  let n = 1;
  while (taken.has(`e-${base}-${String(n)}`)) n += 1;
  const id = `e-${base}-${String(n)}`;
  taken.add(id);
  return id;
}

/** The object with `field` set, or without it when `value` is `undefined`. */
function withField<T extends object, K extends string>(object: T, field: K, value: unknown): T {
  const next = { ...object } as Record<string, unknown>;
  if (value === undefined) {
    delete next[field];
  } else {
    next[field] = value;
  }
  return next as T;
}

// ---------------------------------------------------------------------------------------------
// Settings given as data, by the chat agent

/** What `propose_graph_section` tells the agent about each section's settings. */
export const SECTION_SETTINGS_HELP = {
  choice:
    'A choice made per task. settings: {"template": "model-class" | "review" (optional, a starting point), "choice": {"id", "label", "meaning", ' +
    '"options": [{"id", "meaning" (the criteria for choosing it), "modelClass": "small" | "medium" | "large" (every option or none)}], "default", ' +
    '"order": "weakest-first" (only when the options really are ordered), "joins": "strongest" (after parallel branches, carry the strongest any ' +
    'branch had; needs order), "whenMissing": "default" | "strongest" (what a missing or invalid value becomes; strongest needs order)} — fields ' +
    'given override the template, "decidedBy": [agent step ids that state it on each visit], "appliesTo": [agent step ids whose model follows it, ' +
    'or {"nodeId", "options": [the option ids it may run]}; model-class choices only]}. DSpatch writes the deciding steps\' instructions from the ' +
    'choice: its options, their criteria and the CHOICE line; put no CHOICE format in a purpose or role. The concrete model of each class is the ' +
    "agent's Model classes setting, never the graph's. A model-class choice and a review choice are separate choices, so one never decides the other.",
  parallel:
    'Split, run in parallel and integrate. settings: {"proposer": the agent step that proposes the split, "splitOutcome": its outcome that ' +
    'splits (default "parallel"), "sequential": {"outcome", "to"} (optional: the sequential route to make sure of; the proposer\'s other outcomes ' +
    'stay as they are), "branches": {"id", "label", "role": a role reference or the id of a step whose role to use, "purpose"}, "branchAs": [agent ' +
    'step ids a slice may name to run its branch with that step\'s role, purpose, requirements and model policy — not its routes: a branch is not ' +
    'a subgraph], "sliceChoices": [choice ids a slice may set for its own branch, default all], "branchModelChoice": a model-class choice id the ' +
    'fan-out step\'s own model follows, or null, "maxConcurrent": 1 to 3 (default 3; the agent may allow fewer), "isolation": "worktree" | "shared-read-only" (read-only branches in the shared working copy) ' +
    '(default "worktree"), "splitWhen": the graph\'s own criteria for when to split, "integrator": {"id", "label", "role", "purpose", "model": an ' +
    'explicit model policy — a branch\'s class does not choose it}, "outcomes": {"integrated", "rework", "unresolved"} (defaults integrated, rework, ' +
    'needs-decision), "afterIntegration": {"to": step id} or {"byChoice": choice id, "to": {option: step id}}, "onUnresolved": step id (default the ' +
    'proposer), "onLimit": step id or null}. DSpatch writes the proposer\'s instructions for the slice block from these settings; put no slice format ' +
    'in a purpose or role.',
} as const;

/** Settings as data, read into a section's settings against the graph they go into. */
export function readSectionSettings(
  graph: LoopGraph,
  section: 'choice' | 'parallel',
  raw: unknown,
): { readonly ok: true; readonly settings: ChoiceSectionSettings | ParallelSectionSettings } | { readonly ok: false; readonly problem: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problem: 'settings must be a JSON object.' };
  }
  const value = raw as Record<string, unknown>;
  return section === 'choice' ? readChoiceSettings(graph, value) : readParallelSettings(graph, value);
}

function readChoiceSettings(graph: LoopGraph, value: Record<string, unknown>): ReturnType<typeof readSectionSettings> {
  const template = value['template'];
  const given = (typeof value['choice'] === 'object' && value['choice'] !== null ? value['choice'] : {}) as Record<string, unknown>;
  const base =
    template === 'model-class'
      ? modelClassChoiceTemplate(typeof given['id'] === 'string' ? given['id'] : undefined)
      : template === 'review'
        ? reviewChoiceTemplate(typeof given['id'] === 'string' ? given['id'] : undefined)
        : (graph.choices ?? []).find((choice) => choice.id === given['id']);
  const merged = { ...(base ?? {}), ...given } as Record<string, unknown>;
  if (typeof merged['id'] !== 'string' || !Array.isArray(merged['options'])) {
    return { ok: false, problem: 'settings.choice needs an "id" and "options", or a "template".' };
  }
  const decidedBy = stringsOf(value['decidedBy']);
  const appliesTo = Array.isArray(value['appliesTo'])
    ? value['appliesTo'].flatMap((entry): { nodeId: string; options?: string[] }[] =>
        typeof entry === 'string'
          ? [{ nodeId: entry }]
          : typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>)['nodeId'] === 'string'
            ? [{ nodeId: (entry as { nodeId: string }).nodeId, ...(Array.isArray((entry as Record<string, unknown>)['options']) ? { options: stringsOf((entry as Record<string, unknown>)['options']) } : {}) }]
            : [],
      )
    : [];
  return { ok: true, settings: { choice: merged as unknown as VisitChoiceDef, decidedBy, appliesTo } };
}

function readParallelSettings(graph: LoopGraph, value: Record<string, unknown>): ReturnType<typeof readSectionSettings> {
  const roleOf = (raw: unknown): RoleReference | null => {
    if (typeof raw === 'string') {
      return graph.nodes.find((node) => node.id === raw)?.role ?? null;
    }
    return typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>)['id'] === 'string' ? (raw as RoleReference) : null;
  };
  const record = (key: string): Record<string, unknown> =>
    typeof value[key] === 'object' && value[key] !== null ? (value[key] as Record<string, unknown>) : {};
  const text = (raw: unknown): string | undefined => (typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined);
  const proposer = text(value['proposer']);
  const branches = record('branches');
  const integrator = record('integrator');
  const branchRole = roleOf(branches['role']);
  const integratorRole = roleOf(integrator['role']);
  if (proposer === undefined || text(branches['id']) === undefined || branchRole === null || text(integrator['id']) === undefined || integratorRole === null) {
    return {
      ok: false,
      problem:
        'settings need "proposer", "branches": {"id", "role"} and "integrator": {"id", "role"}; a role is a role reference or the id of a step whose role to use.',
    };
  }
  const after = record('afterIntegration');
  const afterIntegration: AfterIntegration | null =
    typeof after['byChoice'] === 'string' && typeof after['to'] === 'object' && after['to'] !== null
      ? { byChoice: after['byChoice'], to: after['to'] as Record<string, string> }
      : typeof after['to'] === 'string'
        ? { to: after['to'] }
        : null;
  if (afterIntegration === null) {
    return { ok: false, problem: 'settings need "afterIntegration": {"to": step id} or {"byChoice": choice id, "to": {option: step id}}.' };
  }
  const outcomes = record('outcomes');
  const sequential = record('sequential');
  const isolation = value['isolation'] === 'shared-read-only' ? 'shared-read-only' : 'worktree';
  const maxConcurrent = typeof value['maxConcurrent'] === 'number' ? value['maxConcurrent'] : 3;
  const model = integrator['model'];
  return {
    ok: true,
    settings: {
      proposer,
      splitOutcome: text(value['splitOutcome']) ?? 'parallel',
      ...(text(sequential['outcome']) !== undefined && text(sequential['to']) !== undefined
        ? { sequential: { outcome: text(sequential['outcome']) as string, to: text(sequential['to']) as string } }
        : {}),
      branches: {
        id: text(branches['id']) as string,
        ...(text(branches['label']) === undefined ? {} : { label: text(branches['label']) }),
        role: branchRole,
        ...(text(branches['purpose']) === undefined ? {} : { purpose: text(branches['purpose']) }),
      },
      branchAs: stringsOf(value['branchAs']),
      sliceChoices: Array.isArray(value['sliceChoices']) ? stringsOf(value['sliceChoices']) : (graph.choices ?? []).map((choice) => choice.id),
      branchModelChoice: text(value['branchModelChoice']) ?? null,
      maxConcurrent,
      isolation,
      ...(text(value['splitWhen']) === undefined ? {} : { splitWhen: text(value['splitWhen']) }),
      integrator: {
        id: text(integrator['id']) as string,
        ...(text(integrator['label']) === undefined ? {} : { label: text(integrator['label']) }),
        role: integratorRole,
        ...(text(integrator['purpose']) === undefined ? {} : { purpose: text(integrator['purpose']) }),
        ...(typeof model === 'object' && model !== null ? { model: model as ModelPolicy } : {}),
      },
      outcomes: {
        integrated: text(outcomes['integrated']) ?? DEFAULT_INTEGRATOR_OUTCOMES.integrated,
        rework: text(outcomes['rework']) ?? DEFAULT_INTEGRATOR_OUTCOMES.rework,
        unresolved: text(outcomes['unresolved']) ?? DEFAULT_INTEGRATOR_OUTCOMES.unresolved,
      },
      afterIntegration,
      onUnresolved: text(value['onUnresolved']) ?? proposer,
      onLimit: text(value['onLimit']) ?? null,
    },
  };
}

function stringsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : [];
}
