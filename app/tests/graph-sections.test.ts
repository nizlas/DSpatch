/**
 * DSP-227: model choice per task and controlled parallelism as reusable graph sections.
 *
 * A small graph with its own step and role names — a coordinator, a maker, a scout, an assembler
 * and two checks, nothing from the generic network — is built through the chat agent's graph
 * tools: the bare graph with `propose_loop_graph`, then a model-class choice, a review choice and
 * a parallel section with `propose_graph_section`, then applied as the person would. It is run
 * through the engine with scripted steps (no provider is called here), read back into the same
 * settings, edited and saved again. The committed example in docs/loop/examples/workshop is
 * written by this same path (`DSPATCH_WRITE_EXAMPLE=1`).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import { graphAuthoringTools, type GraphAuthoringHost } from '../src/host/graph-authoring-tools';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { applyProposal, supersedeWith, type GraphEditProposal } from '../src/shared/graph-proposal';
import { describeVisitChoices, decideChoices, statedChoicesFrom } from '../src/shared/loop-choices';
import type { LoopGraph } from '../src/shared/loop-graph';
import { loadLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';
import { applyChoiceSection, applyParallelSection, readChoiceSection, readParallelSection, reviewChoiceTemplate } from '../src/shared/loop-graph-sections';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import { createMemoryResultStore } from '../src/shared/loop-results';
import { nodeModelMark, runLoopGraph, type FanOutDriver, type RunJournalEntry, type StepContext, type StepExecution } from '../src/shared/loop-run';
import { readSlices } from '../src/shared/loop-slices';
import { describeSplitInstructions, sliceChoicesOf } from '../src/shared/loop-split-instructions';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FENCE = '```';
const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function role(id: string, title: string, summary: string, purpose: string): string {
  return ['---', `role: ${id}`, `title: ${title}`, `summary: "${summary}"`, 'targets: cursor, claude-code', '---', '', '## Purpose', '', purpose, '', '## Delivery', '', 'Say what you did, what you checked and what is left.'].join('\n');
}

const ROLES = [
  role('coordinator', 'Coordinator', 'Decide how the request is done and by whom.', 'Read the request and decide how it is done: by one maker, by a scout first, or split into independent parts.'),
  role('maker', 'Maker', 'Make the change asked for and check it.', 'Make the change you are given, inside the paths you are given, and run its check.'),
  role('scout', 'Scout', 'Find out what a question needs and write it down.', 'Investigate the question you are given in the existing material and write down what you found, with where.'),
  role('assembler', 'Assembler', 'Bring parallel parts together into one checked whole.', 'Combine the parts made in parallel, resolve what conflicts and check that the whole works.'),
  role('checker', 'Checker', 'Judge whether the work meets its request.', 'Check the work against the request and its own checks; pass it or say what to fix.'),
];

const ref = (name: string): { id: string; source: { kind: 'role-source'; path: string } } => ({
  id: name,
  source: { kind: 'role-source', path: `.dspatch/loops/roles/workshop-${name}.role.md` },
});

/** The bare graph a person might start from: no choices, no parallelism. */
const BARE = JSON.stringify({
  format: 'dspatch-loop-graph',
  formatVersion: 1,
  id: 'workshop',
  name: 'Workshop',
  purpose: 'A small workshop: a coordinator assigns a request to a maker or a scout, and a check judges the result.',
  target: 'cursor',
  entry: 'coordinator',
  onRuntimeFault: 'stop-and-reconcile',
  failureKinds: [],
  nodes: [
    { id: 'coordinator', kind: 'agent', label: 'Coordinator', purpose: 'Decide how the request is done. Choose make for a change, scout for a question to answer first, or stop when it cannot be done.', role: ref('coordinator'), outcomes: ['make', 'scout', 'stop'], produces: { required: true, form: 'stored-result' } },
    { id: 'maker', kind: 'agent', label: 'Maker', purpose: 'Make the change the coordinator assigned and run its check.', role: ref('maker'), produces: { required: true, form: 'stored-result' } },
    { id: 'scout', kind: 'agent', label: 'Scout', purpose: 'Answer the question the coordinator assigned from the existing material, with where you found it.', role: ref('scout'), produces: { required: true, form: 'stored-result' } },
    { id: 'quick-check', kind: 'agent', label: 'Quick check', purpose: 'Check the work against the request and its own check. Choose pass or fix.', role: ref('checker'), outcomes: ['pass', 'fix'], consumes: ['maker'] },
    { id: 'deep-check', kind: 'agent', label: 'Deep check', purpose: 'Check the design and the correctness of the work, and run the checks that show it works. Choose pass or fix.', role: ref('checker'), outcomes: ['pass', 'fix'] },
    { id: 'done', kind: 'terminal', label: 'Done', ending: 'success' },
    { id: 'stopped', kind: 'terminal', label: 'Stopped', ending: 'not-success' },
  ],
  edges: [
    { id: 'e1', from: 'coordinator', to: 'maker', when: { on: 'outcome', outcome: 'make' } },
    { id: 'e2', from: 'coordinator', to: 'scout', when: { on: 'outcome', outcome: 'scout' } },
    { id: 'e3', from: 'coordinator', to: 'stopped', when: { on: 'outcome', outcome: 'stop' } },
    { id: 'e4', from: 'maker', to: 'quick-check', when: { on: 'success' } },
    { id: 'e5', from: 'scout', to: 'coordinator', when: { on: 'success' } },
    { id: 'e6', from: 'quick-check', to: 'done', when: { on: 'outcome', outcome: 'pass' } },
    { id: 'e7', from: 'quick-check', to: 'coordinator', when: { on: 'outcome', outcome: 'fix' } },
    { id: 'e8', from: 'deep-check', to: 'done', when: { on: 'outcome', outcome: 'pass' } },
    { id: 'e9', from: 'deep-check', to: 'coordinator', when: { on: 'outcome', outcome: 'fix' } },
  ],
});

const CLASS_SECTION = {
  template: 'model-class',
  choice: { id: 'size', label: 'Work size' },
  decidedBy: ['coordinator'],
  appliesTo: ['maker', { nodeId: 'scout', options: ['medium', 'large'] }],
};
const REVIEW_SECTION = { template: 'review', choice: { id: 'review' }, decidedBy: ['coordinator'] };
const PARALLEL_SECTION = {
  proposer: 'coordinator',
  splitOutcome: 'split',
  branches: { id: 'crew', label: 'Crew: parallel parts', role: 'maker' },
  branchAs: ['maker', 'scout'],
  sliceChoices: ['size', 'review'],
  branchModelChoice: 'size',
  maxConcurrent: 3,
  isolation: 'worktree',
  splitWhen: 'The request names several independent files or features.',
  integrator: { id: 'assembler', label: 'Assembler', role: ref('assembler'), model: { policy: 'select', options: [{ id: 'steady', modelClass: 'medium' }], default: 'steady' } },
  afterIntegration: { byChoice: 'review', to: { standard: 'quick-check', thorough: 'deep-check' } },
};

/** The workshop built the way a person and the chat agent would build it, in a fresh project. */
async function buildThroughTheChat(): Promise<{ readonly root: string; readonly graphPath: string; readonly answers: readonly string[] }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-workshop-'));
  scratch.push(root);
  let proposals: readonly GraphEditProposal[] = [];
  let counter = 0;
  const host: GraphAuthoringHost = {
    folders: () => [root],
    ownRoot: () => null,
    conversationId: () => 'conv-1',
    proposals: () => proposals,
    record: (proposal) => {
      proposals = supersedeWith(proposals, proposal);
      return { ok: true };
    },
    newId: () => `proposal-${String((counter += 1))}`,
  };
  const tools = graphAuthoringTools(host);
  const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const answer = await tools.find((each) => each.name === name)!.execute(args);
    assert.equal(answer.isError, false, answer.text);
    return answer.text;
  };
  const answers = [
    await call('propose_loop_graph', { target: 'new:workshop', graphText: BARE, explanation: 'A small workshop to start from.', roleFiles: ROLES }),
    await call('propose_graph_section', { target: 'new:workshop', section: 'choice', settings: JSON.stringify(CLASS_SECTION), explanation: 'Pick the model class per request.' }),
    await call('propose_graph_section', { target: 'new:workshop', section: 'choice', settings: JSON.stringify(REVIEW_SECTION), explanation: 'Pick the review route per request.' }),
    await call('propose_graph_section', { target: 'new:workshop', section: 'parallel', settings: JSON.stringify(PARALLEL_SECTION), explanation: 'Run independent parts in parallel and review the whole.' }),
  ];
  // Apply, as the person does from the proposal card.
  const open = proposals.filter((proposal) => proposal.status === 'proposed');
  assert.equal(open.length, 1, 'each section superseded the one before');
  const proposal = open[0]!;
  const applied = applyProposal(proposal, { graph: null, definition: null, roles: Object.fromEntries(proposal.roleFiles.map((file) => [file.path, null])) });
  assert.equal(applied.outcome, 'applied', JSON.stringify(applied));
  if (applied.outcome !== 'applied') throw new Error('not applied');
  for (const file of [{ path: applied.write.graphPath, text: applied.write.graphText }, applied.write.definition!, ...applied.write.roleFiles]) {
    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, file.text);
  }
  if (process.env['DSPATCH_WRITE_EXAMPLE'] === '1') {
    const target = path.join(repoRoot, 'docs/loop/examples/workshop');
    fs.rmSync(path.join(target, '.dspatch'), { recursive: true, force: true });
    fs.cpSync(path.join(root, '.dspatch'), path.join(target, '.dspatch'), { recursive: true });
  }
  return { root, graphPath: applied.write.graphPath, answers };
}

function loadAt(root: string, graphPath: string): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(graphPath, 'utf8'), { resolveRole: createFileRoleResolver(root) });
  assert.ok(loaded.ok, JSON.stringify(loaded.ok ? [] : loaded.findings));
  return loaded.graph;
}

function slices(list: readonly { id: string; owns: string; as?: string; choices?: Record<string, string> }[]): string {
  return `${FENCE}dspatch-slices\n${JSON.stringify({
    slices: list.map((slice) => ({
      id: slice.id,
      result: `${slice.id} done`,
      ...(slice.as === undefined ? {} : { as: slice.as }),
      ...(slice.choices === undefined ? {} : { choices: slice.choices }),
      ownedPaths: [slice.owns],
      allowedActions: ['edit'],
      contractRefs: [],
      verification: `check ${slice.id}`,
    })),
  })}\n${FENCE}`;
}

function driver(log: string[]): FanOutDriver {
  return {
    base: async () => ({ commit: 'base0', kind: 'head', untrackedNotIncluded: 0 }),
    open: async ({ sliceId, visit }) => {
      log.push(`open v${String(visit)} ${sliceId}`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dsp-ws-${sliceId}-`));
      scratch.push(dir);
      return { workspacePath: dir, branch: `dspatch/run/r/crew/v${String(visit)}/${sliceId}` };
    },
    close: async ({ branch }) => ({ commit: `commit-of-${branch}`, removed: true, problem: null }),
  };
}

async function run(graph: LoopGraph, steps: Record<string, { outcome?: string; body?: string }>): Promise<{ result: Awaited<ReturnType<typeof runLoopGraph>>; seen: StepContext[]; entries: RunJournalEntry[]; log: string[] }> {
  const seen: StepContext[] = [];
  const entries: RunJournalEntry[] = [];
  const log: string[] = [];
  const result = await runLoopGraph(graph, {
    runId: 'r',
    dryRun: false,
    maxTransitions: 40,
    onJournalEntry: (entry) => entries.push(entry),
    resultStore: createMemoryResultStore((text) => createHash('sha256').update(text).digest('hex')),
    fanOutDriver: driver(log),
    runModel: { provider: 'claude', model: 'chat-model', classes: { small: 'model-s', medium: 'model-m', large: 'model-l' } },
    executor: async (context): Promise<StepExecution> => {
      seen.push(context);
      if (context.instance !== undefined) {
        return { product: { kind: 'success' }, summary: 'branch', providerTurns: 1, resultBody: `${context.instance.sliceId} done` };
      }
      const step = steps[`${context.node.id}#${String(context.occurrence)}`] ?? steps[context.node.id] ?? {};
      return {
        product: step.outcome === undefined ? { kind: 'success' } : { kind: 'outcome', outcome: step.outcome, source: 'step-declared' },
        summary: context.node.id,
        providerTurns: 1,
        resultBody: step.body ?? `${context.node.id} done`,
        // As the live executor does: the CHOICE lines of the reply, for the choices the node decides.
        choices: statedChoicesFrom(step.body ?? '', context.node.decides ?? []),
      };
    },
  });
  return { result, seen, entries, log };
}

test('the workshop is built through the chat tools from settings, with nothing copied into a purpose', async () => {
  const { root, graphPath, answers } = await buildThroughTheChat();
  assert.match(answers[3] ?? '', /Proposed \(proposal-4\)/);
  const graph = loadAt(root, graphPath);
  const text = fs.readFileSync(graphPath, 'utf8');
  // The class is written once, in the choice; the steps list options by id.
  assert.deepEqual(JSON.parse(text).nodes.find((node: { id: string }) => node.id === 'scout').model, {
    policy: 'select',
    options: [{ id: 'medium' }, { id: 'large' }],
    default: 'medium',
    chosenBy: 'size',
  });
  assert.deepEqual(graph.nodes.find((node) => node.id === 'scout')?.model?.options?.map((option) => option.modelClass), ['medium', 'large']);
  // No purpose or role carries the CHOICE or slice format: DSpatch writes those.
  for (const node of graph.nodes) assert.doesNotMatch(node.purpose ?? '', /CHOICE:|dspatch-slices/);
  for (const file of ROLES) assert.doesNotMatch(file, /CHOICE:|dspatch-slices/);
  // What DSpatch writes for the coordinator, from the graph.
  const coordinator = graph.nodes.find((node) => node.id === 'coordinator')!;
  const choices = describeVisitChoices(graph, coordinator, {});
  assert.match(choices, /CHOICE: size small — A straightforward, localized task/);
  assert.match(choices, /review — .*Without a valid line the strongest option, thorough, applies/);
  const split = describeSplitInstructions(graph, coordinator);
  assert.match(split, /choose the outcome "split"/);
  assert.match(split, /When to split, in the graph's words: The request names several independent files or features\./);
  assert.match(split, /"maker": Maker[\s\S]*"scout": Scout/);
  assert.match(split, /"scout" runs medium, large/);
  assert.match(split, /it is not a subgraph/);
  assert.match(split, /The branch results go to "Assembler"/);
  assert.match(split, /review route goes on as the strongest any branch had \(weakest first: standard, thorough\)/);
  assert.doesNotMatch(split, /work size goes on as the strongest/, 'the size choice does not join, so the assembler keeps its own policy');
  // The example block in the instructions is one the reader accepts.
  const example = /```dspatch-slices[\s\S]*?```/.exec(split)?.[0] ?? '';
  const fan = graph.nodes.find((node) => node.id === 'crew')!.fanOut!;
  assert.ok(readSlices(example, { isolation: fan.isolation, branchAs: fan.branchAs ?? [], choices: sliceChoicesOf(graph, fan) }).ok);
  // Every other step's prompt is untouched by the split.
  assert.equal(describeSplitInstructions(graph, graph.nodes.find((node) => node.id === 'maker')!), '');
});

test('the workshop runs its sequential path with the class the coordinator chose', async () => {
  const { root, graphPath } = await buildThroughTheChat();
  const graph = loadAt(root, graphPath);
  const { result, seen, entries } = await run(graph, {
    coordinator: { outcome: 'make', body: 'One maker.\nCHOICE: size large the change is wide\nCHOICE: review standard routine' },
    'quick-check': { outcome: 'pass' },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.deepEqual(seen.map((each) => each.node.id), ['coordinator', 'maker', 'quick-check']);
  assert.equal(seen[1]?.choices?.['size']?.value, 'large');
  assert.match(nodeModelMark(graph.nodes.find((node) => node.id === 'maker')!, entries)?.line ?? '', /model-l/);
});

test('a missing review line takes the strongest route, so review is never silently weaker', async () => {
  const { root, graphPath } = await buildThroughTheChat();
  const graph = loadAt(root, graphPath);
  const decided = decideChoices(graph, graph.nodes.find((node) => node.id === 'coordinator')!, {}, { size: { value: 'small', reason: null } });
  assert.equal(decided.choices['review']?.value, 'thorough');
  assert.match(decided.choices['review']?.reason ?? '', /stated no review, so its strongest option, thorough, applies/);
});

test('the workshop splits, runs each branch with its own class, and sends the whole to the review its branches need', async () => {
  const { root, graphPath } = await buildThroughTheChat();
  const graph = loadAt(root, graphPath);
  const { result, seen, entries, log } = await run(graph, {
    'coordinator#1': {
      outcome: 'split',
      body: `Two parts.\nCHOICE: size medium\nCHOICE: review standard\n${slices([
        { id: 'docs', owns: 'docs', choices: { size: 'small' } },
        { id: 'probe', owns: 'notes', as: 'scout', choices: { size: 'small', review: 'thorough' } },
      ])}`,
    },
    assembler: { outcome: 'integrated' },
    'deep-check': { outcome: 'pass' },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.deepEqual(log, ['open v1 docs', 'open v1 probe']);
  const branches = seen.filter((each) => each.instance !== undefined);
  assert.deepEqual(branches.map((each) => [each.instance?.sliceId, each.node.role?.id]), [['docs', 'maker'], ['probe', 'scout']]);
  const started = entries.filter((entry) => entry.kind === 'branch-started');
  // The scout runs medium or large only: its slice's "small" runs its default, and the run records it.
  assert.deepEqual(started.map((entry) => [entry.data?.['sliceId'], entry.data?.['modelClass'], entry.data?.['model']]), [
    ['docs', 'small', 'model-s'],
    ['probe', 'medium', 'model-m'],
  ]);
  // The assembler keeps its own explicit policy, whatever the branches ran.
  const assembler = seen.find((each) => each.node.id === 'assembler' && each.instance === undefined)!;
  assert.equal(assembler.choices?.['size']?.value, 'medium', 'size does not join');
  assert.equal(assembler.choices?.['review']?.value, 'thorough', 'review joins on its strongest');
  assert.ok(seen.some((each) => each.node.id === 'deep-check'));
  assert.ok(!seen.some((each) => each.node.id === 'quick-check'));
  assert.deepEqual(nodeModelMark(graph.nodes.find((node) => node.id === 'crew')!, entries)?.badge, { full: 'S·M', short: 'SM' });
});

test('the sections read back into their settings, can be edited, and the graph saves and reopens the same', async () => {
  const { root, graphPath } = await buildThroughTheChat();
  const graph = loadAt(root, graphPath);
  const parallel = readParallelSection(graph, 'crew');
  assert.ok(parallel);
  assert.equal(parallel.proposer, 'coordinator');
  assert.equal(parallel.splitOutcome, 'split');
  assert.deepEqual(parallel.branchAs, ['maker', 'scout']);
  assert.deepEqual(parallel.afterIntegration, { byChoice: 'review', to: { standard: 'quick-check', thorough: 'deep-check' } });
  assert.equal(parallel.onUnresolved, 'coordinator');
  assert.deepEqual(parallel.outcomes, { integrated: 'integrated', rework: 'rework', unresolved: 'needs-decision' });
  const size = readChoiceSection(graph, 'size');
  assert.deepEqual(size?.decidedBy, ['coordinator']);
  assert.deepEqual(size?.appliesTo, [{ nodeId: 'maker' }, { nodeId: 'scout', options: ['medium', 'large'] }, { nodeId: 'crew' }]);

  // Edit: one branch at a time, the scout no longer a branch role, the integrated work always deep-checked.
  const edited = applyParallelSection(graph, { ...parallel, maxConcurrent: 1, branchAs: ['maker'], afterIntegration: { to: 'deep-check' } });
  assert.deepEqual(edited.problems, []);
  const again = applyChoiceSection(edited.graph, { ...size!, appliesTo: [{ nodeId: 'maker' }, { nodeId: 'crew' }] });
  const text = serialiseLoopGraph(again.graph);
  fs.writeFileSync(graphPath, text);
  const reopened = loadAt(root, graphPath);
  assert.equal(serialiseLoopGraph(reopened), text, 'saved and reopened, byte for byte');
  assert.deepEqual(readParallelSection(reopened, 'crew')?.branchAs, ['maker']);
  assert.equal(reopened.nodes.find((node) => node.id === 'crew')?.fanOut?.maxConcurrent, 1);
  assert.deepEqual(reopened.nodes.find((node) => node.id === 'scout')?.model, { policy: 'inherit' });
  assert.deepEqual(readParallelSection(reopened, 'crew')?.afterIntegration, { to: 'deep-check' });
  assert.equal(reopened.edges.filter((edge) => edge.from === 'assembler' && edge.when.on === 'outcome' && edge.when.outcome === 'integrated').length, 1);
});

test('a contradicting class, an unordered join and a section that leaves no sequential path are refused or warned', () => {
  const base = parseLoopGraph(BARE);
  assert.ok(base.ok);
  const withSize = applyChoiceSection(base.graph, {
    choice: { ...reviewChoiceTemplate('size'), options: [{ id: 'small', meaning: 'small', modelClass: 'small' }, { id: 'large', meaning: 'large', modelClass: 'large' }], default: 'small', joins: undefined, whenMissing: undefined },
    decidedBy: ['coordinator'],
    appliesTo: [{ nodeId: 'maker' }],
  }).graph;
  const raw = JSON.parse(serialiseLoopGraph(withSize));
  raw.nodes.find((node: { id: string }) => node.id === 'maker').model.options = [{ id: 'small', modelClass: 'large' }];
  const contradicted = loadLoopGraph(JSON.stringify(raw), { resolveRole: () => null });
  assert.ok(!contradicted.ok && contradicted.findings.some((finding) => finding.code === 'model-option-contradicts-choice'));
  raw.nodes.find((node: { id: string }) => node.id === 'maker').model.options = [{ id: 'small' }];
  raw.choices[0].joins = 'strongest';
  delete raw.choices[0].order;
  const unordered = parseLoopGraph(JSON.stringify(raw));
  assert.ok(unordered.ok, 'a file from before "order" still loads');
  const strict = loadLoopGraph(JSON.stringify(raw), { resolveRole: () => null });
  assert.ok(strict.findings.some((finding) => finding.code === 'choice-joins-without-order' && finding.severity === 'warning'));
  raw.choices[0].whenMissing = 'strongest';
  assert.ok(!parseLoopGraph(JSON.stringify(raw)).ok, 'falling back to the strongest needs an order');
  const noSequential = applyParallelSection(
    { ...base.graph, nodes: base.graph.nodes.map((node) => (node.id === 'coordinator' ? { ...node, outcomes: [] } : node)) },
    { ...(PARALLEL_SECTION as never), branches: { id: 'crew', role: ref('maker') }, integrator: { id: 'assembler', role: ref('assembler') }, outcomes: { integrated: 'integrated', rework: 'rework', unresolved: 'needs-decision' }, onUnresolved: 'coordinator', onLimit: null, sliceChoices: [], branchModelChoice: null, branchAs: [] },
  );
  assert.match(noSequential.problems.join(' '), /no sequential path/);
});

test('a branch is told who works beside it and when to send; without the mailbox it is told nothing of one', async () => {
  const { describeBranchAssignment } = await import('../src/main/loop-live');
  const slice = (id: string, owns: string) => ({ id, result: `${id} result.`, ownedPaths: [owns], allowedActions: ['edit'], contractRefs: ['README.md'], verification: 'npm test' });
  const instance = {
    instanceId: 'crew#1/a',
    sliceId: 'a',
    slice: slice('a', 'src/a.js'),
    isolation: 'worktree' as const,
    sessionId: 's',
    workspacePath: '/w/a',
    branch: 'dspatch/run/r/crew/v1/a',
    base: 'base0',
    mailbox: {} as never,
    siblings: [slice('b', 'src/b.js')],
  };
  const withMail = describeBranchAssignment(instance);
  assert.match(withMail, /The other branches of this step[\s\S]*- b: b result\. Owns `src\/b\.js`\./);
  assert.match(withMail, /another branch's task depends on[\s\S]*send it to that branch with send_message as soon as you have established it/);
  const without = describeBranchAssignment(instance, { messaging: false });
  assert.doesNotMatch(without, /send_message|check_messages|messages/);
  assert.match(without, /- b: b result\./, 'the control still knows its siblings, so only the mailbox differs');
  assert.match(without, /"Open decision"/);
});

test('a branch that ends with messages waiting is asked once to check them; delivery is still at its check', async () => {
  const { createRunMailbox } = await import('../src/shared/run-mailbox');
  const posts: string[] = [];
  const mailbox = createRunMailbox({ visitId: 'v', sliceIds: ['a', 'b'], post: (kind) => posts.push(kind) });
  mailbox.branchStarted('a');
  mailbox.branchStarted('b');
  const a = mailbox.portFor('a', { base: null, branch: null });
  const b = mailbox.portFor('b', { base: null, branch: null });
  assert.equal(b.waiting?.(), 0);
  a.send({ to: 'b', purpose: 'finding', body: 'Till amounts are kronor.' });
  assert.equal(b.waiting?.(), 1);
  assert.ok(!posts.includes('message-delivered'), 'counting what waits delivers nothing');
  assert.equal(b.check().length, 1);
  assert.equal(b.waiting?.(), 0);
  assert.ok(posts.includes('message-delivered'));
});
