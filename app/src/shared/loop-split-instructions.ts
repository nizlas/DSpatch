/**
 * DSP-227: the instructions DSpatch writes for the step that proposes a split, from the graph.
 *
 * A fan-out's settings — the node whose result holds the slices (`slicesFrom`), the nodes a
 * branch may run as (`branchAs`), the choices a slice may set (`sliceChoices`), its concurrency
 * and isolation, and the builder's own criteria (`splitWhen`) — are the one definition. The
 * slice reader validates against them, the engine runs by them, the editor shows them, and this
 * module turns them into the proposing step's instructions, so a graph builder never copies the
 * `dspatch-slices` format into a role or a purpose, and the instructions cannot say something
 * the validation does not hold. Nothing here knows a role or a node by name.
 *
 * What a branch is, said where the step reads it: a branch runs as a separate agent task with
 * the role, purpose, requirements and model policy of the node it runs as. It does not take that
 * node's routes or continuations; its result returns to the fan-out and on to whoever the graph
 * sends the fan-out's result to. It is not a subgraph.
 */
import { MAX_SLICES, SLICE_BLOCK_INFO } from './loop-slices';
import { type FanOutPolicy, type LoopGraph, type LoopNode, type VisitChoiceDef } from './loop-graph';

/** A fan-out node and its policy. */
interface FanOutNode {
  readonly node: LoopNode;
  readonly fanOut: FanOutPolicy;
}

/** The fan-out nodes whose slices this node writes. */
export function fanOutsProposedBy(graph: Pick<LoopGraph, 'nodes'>, nodeId: string): readonly FanOutNode[] {
  return graph.nodes.flatMap((node) =>
    node.fanOut !== undefined && node.fanOut.slicesFrom === nodeId ? [{ node, fanOut: node.fanOut }] : [],
  );
}

/** The choices a slice of this fan-out may set: its `sliceChoices`, else every choice of the graph. */
export function sliceChoicesOf(graph: Pick<LoopGraph, 'choices'>, fanOut: Pick<FanOutPolicy, 'sliceChoices'>): readonly VisitChoiceDef[] {
  const all = graph.choices ?? [];
  return fanOut.sliceChoices === undefined ? all : all.filter((choice) => fanOut.sliceChoices?.includes(choice.id) === true);
}

/** The node's name for people: its label, else its id. */
function nameOf(node: Pick<LoopNode, 'id' | 'label'>): string {
  return node.label ?? node.id;
}

/** The outcomes of `from` whose edge leads to `to`. */
function outcomesTo(graph: Pick<LoopGraph, 'edges'>, from: string, to: string): readonly string[] {
  return [
    ...new Set(
      graph.edges.flatMap((edge) =>
        edge.from === from && edge.to === to && edge.when.on === 'outcome' && edge.when.outcome !== undefined ? [edge.when.outcome] : [],
      ),
    ),
  ];
}

/** Where a fan-out's results go: the targets of its success edges. */
export function integratorsOf(graph: Pick<LoopGraph, 'edges' | 'nodes'>, fanOutId: string): readonly LoopNode[] {
  const ids = [...new Set(graph.edges.filter((edge) => edge.from === fanOutId && edge.when.on === 'success').map((edge) => edge.to))];
  return ids.flatMap((id) => graph.nodes.filter((node) => node.id === id));
}

/** The options a node's model takes from a choice, when it takes them from one. */
function optionsFollowing(node: Pick<LoopNode, 'model'>, choice: VisitChoiceDef): readonly string[] | null {
  const model = node.model;
  return model?.policy === 'select' && model.chosenBy === choice.id ? (model.options ?? []).map((option) => option.id) : null;
}

/**
 * One sentence on what a branch is and is not, for the editor, the docs' wording and the
 * proposing step alike.
 */
export const BRANCH_MEANING =
  'Each branch is a separate agent task in its own session. It runs with the role, purpose, requirements and model policy of the node it runs as, ' +
  'but it does not take that node\'s routes or continuations: it is not a subgraph. When it ends, its result returns to the fan-out step, and the ' +
  'graph sends all branch results on together.';

/**
 * The proposing step's instructions for every fan-out it writes the slices for, or `''` when it
 * writes none, so every other prompt is byte for byte what it was.
 */
export function describeSplitInstructions(graph: Pick<LoopGraph, 'nodes' | 'edges' | 'choices'>, node: Pick<LoopNode, 'id'>): string {
  const fanOuts = fanOutsProposedBy(graph, node.id);
  if (fanOuts.length === 0) {
    return '';
  }
  return `\n\n${fanOuts.map((entry) => splitSection(graph, node.id, entry)).join('\n\n')}`;
}

function splitSection(graph: Pick<LoopGraph, 'nodes' | 'edges' | 'choices'>, proposerId: string, { node: fan, fanOut }: FanOutNode): string {
  const outcomes = outcomesTo(graph, proposerId, fan.id);
  const choose =
    outcomes.length === 0
      ? `when your result leads to "${nameOf(fan)}"`
      : `choose the outcome ${outcomes.map((outcome) => `"${outcome}"`).join(' or ')}`;
  const runsAs = (fanOut.branchAs ?? []).flatMap((id) => graph.nodes.filter((candidate) => candidate.id === id));
  const choices = sliceChoicesOf(graph, fanOut);
  const integrators = integratorsOf(graph, fan.id);
  const lines: string[] = [
    `Parallel branches ("${nameOf(fan)}"). DSpatch generated this section from the graph's settings for that step.`,
    fanOut.splitWhen === undefined
      ? 'Split only when the work divides into parts that can be done at the same time, without writing the same files and without one part needing another\'s result. Otherwise do the work in sequence, the usual way.'
      : `When to split, in the graph's words: ${fanOut.splitWhen} Split only into parts that can be done at the same time without writing the same files and without one part needing another's result; otherwise work in sequence.`,
    `To split, ${choose} and write exactly one fenced block whose info string is ${SLICE_BLOCK_INFO} and whose body is JSON {"slices": [...]}, with 2 to ${String(MAX_SLICES)} entries, one per branch:`,
    '- "id": a short name of letters, digits, ".", "_" or "-".',
    '- "result": the branch\'s task and the result it must deliver.',
    fanOut.isolation === 'worktree'
      ? '- "ownedPaths": the repository paths only this branch may change, at least one. No two branches may own the same path, or one inside another.'
      : '- "ownedPaths": the repository paths only this branch may change. No two branches may own the same path, or one inside another.',
    '- "allowedActions": what the branch may do, for example ["edit", "run tests"].',
    '- "contractRefs": the shared contracts and settled facts the branch works against (files, interfaces, decisions); [] when there are none.',
    '- "verification": the smallest check that shows its part works.',
    '- "acceptance" (optional): what its result must meet.',
  ];
  if (runsAs.length > 0) {
    lines.push(
      `- "as" (optional): the step whose role the branch runs as. Without it, it runs as "${nameOf(fan)}". One of:`,
      ...runsAs.map((each) => `  - "${each.id}": ${nameOf(each)}${each.purpose === undefined ? '' : ` — ${firstSentence(each.purpose)}`}`),
    );
  }
  if (choices.length > 0) {
    lines.push(`- "choices" (optional): this branch's own ${choices.map((choice) => `"${choice.id}"`).join(' and ')}; where it sets none, this visit's apply. For example {${choices.map((choice) => `"${choice.id}": "${choice.options[0]?.id ?? ''}"`).join(', ')}}.`);
    for (const choice of choices) {
      lines.push(`  - "${choice.id}" (${choice.label}): ${choice.options.map((option) => `"${option.id}" — ${option.meaning}`).join('; ')}`);
      const limited = [fan, ...runsAs].flatMap((each) => {
        const allowed = optionsFollowing(each, choice);
        return allowed !== null && allowed.length < choice.options.length ? [`"${each.id}" runs ${allowed.join(', ')}`] : [];
      });
      if (limited.length > 0) {
        lines.push(`    Not every step runs every option: ${limited.join('; ')}. Another value runs that step's default, and the run records it.`);
      }
    }
  }
  lines.push(
    '- "dependsOn" is refused: a part that needs another part\'s result cannot start beside it from the same base. Do it in a later round, after the integration, or work in sequence.',
    BRANCH_MEANING,
    `Up to ${String(fanOut.maxConcurrent)} branches run at the same time (the agent running the graph may allow fewer, and then they wait their turn), ` +
      (fanOut.isolation === 'worktree'
        ? 'each in its own worktree from one base commit, on a temporary branch the integration merges.'
        : 'all read-only in the shared working copy.'),
  );
  if (integrators.length > 0) {
    lines.push(`The branch results go to ${integrators.map((each) => `"${nameOf(each)}"`).join(' and ')}, which integrates them.`);
  }
  const joined = (graph.choices ?? []).filter((choice) => choice.joins === 'strongest');
  if (joined.length > 0) {
    lines.push(
      `After the branches, ${joined.map((choice) => `${choice.label.toLowerCase()} goes on as the strongest any branch had (weakest first: ${choice.options.map((option) => option.id).join(', ')})`).join('; ')}. ` +
        'Every other choice goes on as this visit\'s.',
    );
  }
  lines.push('For example:', '```' + SLICE_BLOCK_INFO, JSON.stringify({ slices: [exampleSlice('part-a', 'src/a', runsAs[0]?.id, choices), exampleSlice('part-b', 'src/b', undefined, [])] }, null, 2), '```');
  return lines.join('\n');
}

function exampleSlice(id: string, owned: string, as: string | undefined, choices: readonly VisitChoiceDef[]): Record<string, unknown> {
  return {
    id,
    result: 'What this branch does and delivers.',
    ...(as === undefined ? {} : { as }),
    ...(choices.length === 0 ? {} : { choices: Object.fromEntries(choices.map((choice) => [choice.id, choice.default])) }),
    ownedPaths: [owned],
    allowedActions: ['edit', 'run tests'],
    contractRefs: [],
    acceptance: 'What its result must meet.',
    verification: 'The smallest check of its part.',
  };
}

function firstSentence(text: string): string {
  const match = /^.*?[.!?](\s|$)/.exec(text.trim());
  return (match?.[0] ?? text).trim();
}
