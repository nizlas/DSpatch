/**
 * DSP-224: the choices a run makes per visit, and how they travel with the work.
 *
 * A graph declares its choices once ({@link LoopGraph.choices}) — which model class the work
 * needs, which review route it takes — and they are independent of each other and of the
 * outcome. A step whose node `decides` a choice states it on a `CHOICE:` line; an edge may
 * `sets` it; an edge may be taken only `whenChosen`; a `select` model policy may be
 * `chosenBy` it. The values travel from visit to visit with the arrival, so a revisit through
 * a rework edge keeps them, and the next decision replaces them, so one subtask's choice
 * never reaches the next one's work. Nothing here knows a role or a size by name.
 */
import type { ChoiceValues, LoopEdge, LoopGraph, LoopNode, VisitChoiceDef } from './loop-graph';

/** The token a step states a choice with, on a whole line: `CHOICE: <choice> <option> <reason>`. */
export const CHOICE_TOKEN = 'CHOICE:';

/** One choice's value for a visit, with who decided it and why. */
export interface ChoiceValue {
  readonly value: string;
  /** `step`: stated by the deciding step; `default`: the choice's default; `edge`: an edge's `sets`. */
  readonly by: 'step' | 'default' | 'edge';
  /** The node that decided, or the edge that set it. */
  readonly decidedBy: string;
  readonly reason: string;
}

/** The choices a visit carries, by choice id. */
export type VisitChoices = Readonly<Record<string, ChoiceValue>>;

/** What a step stated on its `CHOICE:` lines, by choice id, before anything checked it. */
export type StatedChoices = Readonly<Record<string, { readonly value: string; readonly reason: string | null }>>;

/** A choice decided or set at a step or edge, as the journal records it. */
export interface ChoiceMade extends ChoiceValue {
  readonly id: string;
}

function definitionOf(graph: Pick<LoopGraph, 'choices'>, id: string): VisitChoiceDef | undefined {
  return (graph.choices ?? []).find((choice) => choice.id === id);
}

/**
 * The values routing and model selection read: each declared choice's carried value, else its
 * default, so a guard is answered before anything has decided.
 */
export function choiceValuesOf(graph: Pick<LoopGraph, 'choices'>, carried: VisitChoices): ChoiceValues {
  const values: Record<string, string> = {};
  for (const choice of graph.choices ?? []) {
    values[choice.id] = carried[choice.id]?.value ?? choice.default;
  }
  return values;
}

/**
 * The `CHOICE:` lines of a reply for the choices this node decides: the first line per choice,
 * its option word and the reason after it. Unchecked: {@link decideChoices} holds each value to
 * the choice's options.
 */
export function statedChoicesFrom(text: string, decides: readonly string[]): StatedChoices {
  const stated: Record<string, { value: string; reason: string | null }> = {};
  for (const raw of text.split(/\r?\n/)) {
    const opening = raw.trim().replace(/^[*_\s]+/, '');
    if (!opening.startsWith(CHOICE_TOKEN)) {
      continue;
    }
    const words = opening.slice(CHOICE_TOKEN.length).trim().split(/\s+/);
    const id = (words[0] ?? '').replace(/[*_:=]+$/, '');
    const value = (words[1] ?? '').replace(/^[=:]+/, '').replace(/[*_:,.;]+$/, '');
    if (!decides.includes(id) || value === '' || stated[id] !== undefined) {
      continue;
    }
    const reason = words
      .slice(2)
      .join(' ')
      .replace(/^[\s:;,.\-–—(]+/, '')
      .replace(/[\s*_)]+$/, '')
      .trim();
    stated[id] = { value, reason: reason === '' ? null : reason };
  }
  return stated;
}

/**
 * The visit's choices after its step decided the ones its node `decides`: each stated value the
 * choice offers, else the default with the reason saying why. Choices the node does not decide
 * pass through unchanged.
 */
export function decideChoices(
  graph: Pick<LoopGraph, 'choices'>,
  node: Pick<LoopNode, 'id' | 'decides'>,
  carried: VisitChoices,
  stated: StatedChoices | undefined,
): { readonly choices: VisitChoices; readonly made: readonly ChoiceMade[] } {
  const decides = node.decides ?? [];
  if (decides.length === 0) {
    return { choices: carried, made: [] };
  }
  const next: Record<string, ChoiceValue> = { ...carried };
  const made: ChoiceMade[] = [];
  for (const id of decides) {
    const choice = definitionOf(graph, id);
    if (choice === undefined) {
      continue;
    }
    const said = stated?.[id];
    const offered = said !== undefined && choice.options.some((option) => option.id === said.value);
    // DSP-227: a missing or invalid value is the default, or the strongest option where the
    // choice says so, so a missing review route is never a weaker one.
    const strongest = choice.whenMissing === 'strongest' ? choice.options[choice.options.length - 1]?.id : undefined;
    const fallback = strongest ?? choice.default;
    const fallbackWords = strongest === undefined ? 'the default applies' : `its strongest option, ${strongest}, applies`;
    const value: ChoiceValue = offered
      ? { value: said.value, by: 'step', decidedBy: node.id, reason: said.reason ?? 'no reason given' }
      : {
          value: fallback,
          by: 'default',
          decidedBy: node.id,
          reason:
            said === undefined
              ? `the step stated no ${id}, so ${fallbackWords}`
              : `the step stated ${id} "${said.value}", which is not one of its options, so ${fallbackWords}`,
        };
    next[id] = value;
    made.push({ id, ...value });
  }
  return { choices: next, made };
}

/** The choices after an arrival on `edge`, with what its `sets` changed. */
export function applyEdgeSets(
  carried: VisitChoices,
  edge: Pick<LoopEdge, 'id' | 'sets' | 'label'>,
): { readonly choices: VisitChoices; readonly made: readonly ChoiceMade[] } {
  const sets = Object.entries(edge.sets ?? {});
  if (sets.length === 0) {
    return { choices: carried, made: [] };
  }
  const next: Record<string, ChoiceValue> = { ...carried };
  const made: ChoiceMade[] = [];
  for (const [id, value] of sets) {
    const set: ChoiceValue = {
      value,
      by: 'edge',
      decidedBy: edge.id,
      reason: `set by edge ${edge.id}${edge.label === undefined ? '' : ` (${edge.label})`}`,
    };
    next[id] = set;
    made.push({ id, ...set });
  }
  return { choices: next, made };
}

/** Whether an edge's `whenChosen` admits these values. An edge without one always does. */
export function edgeAdmits(edge: Pick<LoopEdge, 'whenChosen'>, values: ChoiceValues): boolean {
  return Object.entries(edge.whenChosen ?? {}).every(([id, value]) => values[id] === value);
}

/**
 * The node as this visit sees it: without the outcomes whose every edge is excluded by a choice
 * the node does not decide itself, so the step is not offered a route its visit cannot take
 * (a thorough review is not offered the escalation to a thorough review). The same object when
 * nothing is withheld, and the `whenUndeclared` outcome is never withheld.
 */
export function nodeForVisit<T extends Pick<LoopNode, 'id' | 'outcomes' | 'whenUndeclared' | 'decides'>>(
  graph: Pick<LoopGraph, 'edges'>,
  node: T,
  values: ChoiceValues,
): T {
  const outcomes = node.outcomes ?? [];
  const decides = node.decides ?? [];
  const withheld = outcomes.filter((outcome) => {
    if (outcome === node.whenUndeclared) {
      return false;
    }
    const routes = graph.edges.filter(
      (edge) => edge.from === node.id && edge.when.on === 'outcome' && edge.when.outcome === outcome,
    );
    const fixedElsewhere = routes.every((edge) => Object.keys(edge.whenChosen ?? {}).every((id) => !decides.includes(id)));
    return routes.length > 0 && fixedElsewhere && !routes.some((edge) => edgeAdmits(edge, values));
  });
  return withheld.length === 0 ? node : { ...node, outcomes: outcomes.filter((outcome) => !withheld.includes(outcome)) };
}

/** `class large (tl-dispatch: reason); review thorough (default)`, for journal lines. */
export function describeChoices(made: readonly ChoiceMade[]): string {
  return made
    .map((choice) => `${choice.id} ${choice.value} (${choice.by === 'default' ? 'default' : choice.decidedBy}: ${choice.reason})`)
    .join('; ');
}

/** Journal data for a visit's carried choices: `choice.<id>` and `choiceBy.<id>`, flat. */
export function choiceData(carried: VisitChoices): Readonly<Record<string, string>> {
  const data: Record<string, string> = {};
  for (const [id, value] of Object.entries(carried)) {
    data[`choice.${id}`] = value.value;
    data[`choiceBy.${id}`] = `${value.decidedBy}: ${value.reason}`;
  }
  return data;
}

/**
 * The prompt section for a visit: the choices it carries, as the task parameters they are, and
 * for a node that decides choices, the lines to state them on. Empty for a graph without
 * choices, so every other prompt is byte for byte what it was.
 */
export function describeVisitChoices(
  graph: Pick<LoopGraph, 'choices'>,
  node: Pick<LoopNode, 'decides'>,
  carried: VisitChoices,
): string {
  const defs = graph.choices ?? [];
  if (defs.length === 0) {
    return '';
  }
  const decides = node.decides ?? [];
  const lines: string[] = [];
  const standing = defs.filter((choice) => !decides.includes(choice.id) && carried[choice.id] !== undefined);
  if (standing.length > 0) {
    lines.push('', 'This visit was assigned with these choices. They are part of the task:');
    for (const choice of standing) {
      const value = carried[choice.id];
      const option = choice.options.find((candidate) => candidate.id === value?.value);
      lines.push(
        `- ${choice.label}: ${value?.value ?? ''} — ${option?.meaning ?? ''} (${
          value?.by === 'default' ? 'the default' : `decided by ${value?.decidedBy ?? ''}`
        }${value?.reason === undefined ? '' : `: ${value.reason}`})`,
      );
    }
  }
  const deciding = defs.filter((choice) => decides.includes(choice.id));
  if (deciding.length > 0) {
    lines.push(
      '',
      'This step also decides the following, independently of its result and of each other. For each, ' +
        `write a whole line ${CHOICE_TOKEN} <name> <option> followed by a short reason.`,
    );
    for (const choice of deciding) {
      lines.push(`${choice.id} — ${choice.meaning} ${missingWords(choice)}`);
      for (const option of choice.options) {
        lines.push(`  ${CHOICE_TOKEN} ${choice.id} ${option.id} — ${option.meaning}`);
      }
    }
  }
  return lines.length === 0 ? '' : `\n${lines.join('\n')}`;
}

/** DSP-227: what a missing or invalid line gives, for the deciding step's instructions. */
function missingWords(choice: VisitChoiceDef): string {
  return choice.whenMissing === 'strongest'
    ? `Without a valid line the strongest option, ${choice.options[choice.options.length - 1]?.id ?? ''}, applies.`
    : `Without a valid line the default, ${choice.default}, applies.`;
}

/**
 * DSP-226: a fan-out branch's choices: the visit's, with what its slice set for its own work.
 * The slice was written by `decidedBy`, the step whose result holds the slice block.
 */
export function branchChoices(
  carried: VisitChoices,
  slice: { readonly id: string; readonly choices?: Readonly<Record<string, string>> },
  decidedBy: string,
): VisitChoices {
  const set = Object.entries(slice.choices ?? {});
  if (set.length === 0) {
    return carried;
  }
  const next: Record<string, ChoiceValue> = { ...carried };
  for (const [id, value] of set) {
    next[id] = { value, by: 'step', decidedBy, reason: `set for slice ${slice.id}` };
  }
  return next;
}

/**
 * DSP-226: the choices the work carries on after a fan-out visit. For a choice that `joins`
 * `strongest`, the strongest value (latest listed option) the visit or any branch had, so
 * joining never weakens what a branch needed; every other choice keeps the visit's value.
 * `made` names what the join changed, for the journal.
 */
export function joinBranchChoices(
  graph: Pick<LoopGraph, 'choices'>,
  carried: VisitChoices,
  branches: readonly { readonly sliceId: string; readonly choices: VisitChoices }[],
  nodeId: string,
): { readonly choices: VisitChoices; readonly made: readonly ChoiceMade[] } {
  const next: Record<string, ChoiceValue> = { ...carried };
  const made: ChoiceMade[] = [];
  for (const choice of graph.choices ?? []) {
    // DSP-227: only a choice that joins says its options are ordered; the loader warns where a
    // file joins without "order" and reads it as weakest first.
    if (choice.joins !== 'strongest') {
      continue;
    }
    const rank = (value: string | undefined): number => choice.options.findIndex((option) => option.id === value);
    const own = carried[choice.id]?.value ?? choice.default;
    let strongest = own;
    const from: string[] = [];
    for (const branch of branches) {
      const value = branch.choices[choice.id]?.value ?? own;
      if (rank(value) > rank(strongest)) {
        strongest = value;
        from.length = 0;
      }
      if (value === strongest) {
        from.push(branch.sliceId);
      }
    }
    if (strongest === own) {
      continue;
    }
    const joined: ChoiceValue = {
      value: strongest,
      by: 'step',
      decidedBy: nodeId,
      reason: `the strongest any branch carried (${from.join(', ')}); joining never weakens it`,
    };
    next[choice.id] = joined;
    made.push({ id: choice.id, ...joined });
  }
  return { choices: next, made };
}
