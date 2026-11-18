import assert from 'node:assert/strict';
import { describeVisitChoices } from '../src/shared/loop-choices';
import { describeSplitInstructions } from '../src/shared/loop-split-instructions';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { discoverLoopDefinitions, openLoopDefinitionFile } from '../src/main/loop-definition-files';
import { listChoosableLoops } from '../src/main/loop-definition-choice';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { nodeSize } from '../src/shared/loop-edge-geometry';
import { routeLoopEdges, routingBox, segmentCrossesBox } from '../src/shared/loop-edge-routing';
import { createMemoryResultStore } from '../src/shared/loop-results';
import { modelSelectionData, modelSelectionFromData, nodeModelMark, runLoopGraph, type RunJournalEntry, type RunModel, type StepContext, type StepExecution } from '../src/shared/loop-run';
import { statedChoicesFrom } from '../src/shared/loop-choices';
import { nodeVisitRows, visitContextWords, visitModelWords } from '../src/shared/step-output';
import { prepareBundled } from '../scripts/prepare-bundled.mjs';
import { readModelChoiceFile, writeModelChoiceFile, writeModelClass } from '../src/main/model-choice-file';
import { sharedClassModels } from '../src/shared/loop-graph';
import type { AgentEvent, AgentEventListener } from '../src/adapter/types';
import type { ChatAdapter } from '../src/main/chat-service';
import { runLiveGraph } from '../src/main/loop-live-run';
import { prepareLoopRun } from '../src/main/loop-run-agent';
import type { RunProvider } from '../src/shared/loop-graph';
import { checkLoopGraph } from '../src/shared/loop-graph-load';
import { chatPromptFor, skippingRoutesOf } from '../src/shared/loop-chat';
import { buildContextSnapshot } from '../src/shared/context-snapshot';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const definitionPath = '.dspatch/loops/generic-agent-network.loop.json';
const graphPath = 'docs/loop/graphs/generic-agent-network.graph.json';
const roleDirectory = 'docs/loop/roles/generic';

function load(rootPath: string) {
  const definition = openLoopDefinitionFile(path.join(rootPath, definitionPath));
  assert.ok(definition.definition, JSON.stringify(definition.findings));
  assert.equal(definition.resourceRoot, rootPath);
  assert.equal(definition.graphPath, path.join(rootPath, graphPath));
  const graph = loadLoopGraph(fs.readFileSync(definition.graphPath, 'utf8'), {
    resolveRole: createFileRoleResolver(rootPath),
  });
  assert.ok(graph.ok, JSON.stringify(graph.findings));
  return graph.graph;
}

test('generic network loads, resolves its roles and retains its result and routing contracts', () => {
  const discovery = discoverLoopDefinitions([root]);
  assert.ok(discovery.rows.some((row) => row.definition?.id === 'generic-agent-network'));
  const choice = listChoosableLoops([root]).choices.find((row) => row.definitionId === 'generic-agent-network');
  assert.ok(choice?.usable);
  assert.equal(choice.preselected, false);
  const graph = load(root);
  const agents = graph.nodes.filter((node) => node.kind === 'agent');
  assert.equal(agents.length, 32);
  assert.equal(graph.edges.length, 120);
  assert.equal(new Set(agents.map((node) => node.role?.id)).size, 16);
  assert.ok(agents.every((node) => node.produces?.required && node.produces.form === 'stored-result'));
  assert.ok(graph.nodes.some((node) => node.kind === 'terminal' && node.ending === 'report-delivered'));
  assert.ok(graph.edges.every((edge) => edge.delivers?.includes('executive-intake')));
  assert.ok(graph.edges.every((edge) => edge.delivers?.includes(edge.from)));
  const resolver = createFileRoleResolver(root);
  for (const agent of agents) {
    assert.ok(agent.role);
    const role = resolver(agent.role);
    assert.ok(role?.instructions, agent.role.id);
    assert.match(role.instructions, /project's applicable instructions only as required by the task/);
    assert.match(role.instructions, /Do not delegate to subagents unless the user explicitly authorizes it/);
    assert.match(role.instructions, /Include a carry-forward ledger in every reply, including failures/);
    assert.match(role.instructions, /add an entry only at tl-accept when its outcome is accept/);
  }
});

test('generic resources contain no project-specific references or absolute paths', () => {
  const files = [definitionPath, graphPath, 'docs/loop/graphs/generic-agent-network.README.md', ...fs.readdirSync(path.join(root, roleDirectory)).map((file) => `${roleDirectory}/${file}`)];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /\b(?:reid|axis|s3|copilot|vscode|cluster)\b|(?:\/home\/|\/Users\/|[A-Za-z]:\\)/i, file);
  }
});

test('the saved generic graph positions every node and keeps routes clear of boxes', () => {
  const graph = load(root);
  assert.ok(graph.nodes.every((node) => node.view !== undefined));
  for (const [index, node] of graph.nodes.entries()) {
    const position = node.view!;
    const size = nodeSize(node);
    for (const other of graph.nodes.slice(index + 1)) {
      const otherPosition = other.view!;
      const otherSize = nodeSize(other);
      assert.ok(position.x >= otherPosition.x + otherSize.width || otherPosition.x >= position.x + size.width || position.y >= otherPosition.y + otherSize.height || otherPosition.y >= position.y + size.height, `${node.id} overlaps ${other.id}`);
    }
  }
  const routes = routeLoopEdges(graph);
  assert.equal(routes.size, graph.edges.length);
  for (const edge of graph.edges) {
    const route = routes.get(edge.id);
    assert.ok(route, edge.id);
    for (const node of graph.nodes.filter((item) => item.id !== edge.from && item.id !== edge.to)) {
      for (let index = 1; index < route.points.length; index += 1) {
        assert.ok(!segmentCrossesBox(route.points[index - 1]!, route.points[index]!, routingBox(node)), `${edge.id} crosses ${node.id}`);
      }
    }
  }
});

test('client bundling carries the definition, graph and every role', (context) => {
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, 'tmp', 'generic-bundle-'));
  context.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const app = path.join(fixture, 'app');
  for (const directory of ['docs/loop', '.dspatch/loops', 'app/dist', 'app/release/host', 'app/claude-support', 'app/copilot-support', 'app/remote-setup']) {
    fs.mkdirSync(path.join(fixture, directory), { recursive: true });
  }
  fs.cpSync(path.join(root, 'docs/loop'), path.join(fixture, 'docs/loop'), { recursive: true });
  fs.cpSync(path.join(root, '.dspatch/loops'), path.join(fixture, '.dspatch/loops'), { recursive: true });
  const revision = '123456789abc123456789abc123456789abc1234';
  const version = '0.1.0';
  const hostId = `${version}-${revision.slice(0, 12)}`;
  const bytes = Buffer.from('fixture host archive');
  const filename = `dspatch-host-${hostId}-${process.platform}-${process.arch}.tar.gz`;
  const entry = { platform: process.platform, arch: process.arch, file: filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(app, 'dist/build-identity.json'), JSON.stringify({ git: { revision } }));
  fs.writeFileSync(path.join(app, 'release/host', filename), bytes);
  fs.writeFileSync(path.join(app, 'release/host/host-manifest.json'), JSON.stringify({ format: 1, hostId, appVersion: version, commit: revision.slice(0, 12), packages: [entry] }));
  for (const support of ['claude-support', 'copilot-support']) {
    for (const file of ['package.json', 'package-lock.json']) fs.writeFileSync(path.join(app, support, file), '{}');
  }
  prepareBundled(app);
  const bundled = path.join(app, 'build/bundled');
  const graph = load(bundled);
  assert.equal(graph.nodes.filter((node) => node.kind === 'agent').length, 32);
  for (const file of [definitionPath, graphPath, ...fs.readdirSync(path.join(root, roleDirectory)).map((name) => `${roleDirectory}/${name}`)]) {
    assert.deepEqual(fs.readFileSync(path.join(bundled, file)), fs.readFileSync(path.join(root, file)), file);
  }
});

const defaultOutcomes: Record<string, string> = {
  'executive-intake': 'select-slice',
  'tl-select': 'slice-selected',
  'reviewer-plan-gate': 'accept',
  'tl-dispatch': 'implementer',
  infra: 'done',
  qa: 'pass',
  'qa-design': 'pass',
  reviewer: 'accept',
  skeptic: 'pass',
  'tl-accept': 'accept',
  'executive-continue': 'wrap-up',
};

async function scriptedRun(options: {
  outcomes?: Record<string, string>;
  failures?: Record<string, string>;
  bodies?: Record<string, string>;
  maxCalls?: number;
  maxReworkRounds?: number;
  routeLimit?: boolean;
  /** DSP-224: what a step states on its CHOICE lines, by node or node#visit. */
  choices?: Record<string, Record<string, string>>;
  runModel?: RunModel;
} = {}) {
  const graph = load(root);
  const seen: StepContext[] = [];
  const entries: RunJournalEntry[] = [];
  const store = createMemoryResultStore((text) => createHash('sha256').update(text).digest('hex'));
  const result = await runLoopGraph({
    ...graph,
    limits: {
      ...graph.limits,
      ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }),
      ...(options.maxReworkRounds === undefined ? {} : { maxReworkRounds: options.maxReworkRounds }),
    },
  }, {
    runId: 'generic-script',
    dryRun: false,
    maxTransitions: 100,
    ...(options.routeLimit ? { routeLimitAs: 'limit-reached' } : {}),
    ...(options.runModel === undefined ? {} : { runModel: options.runModel }),
    onJournalEntry: (entry) => entries.push(entry),
    resultStore: store,
    executor: async (context): Promise<StepExecution> => {
      seen.push(context);
      const node = context.node.id;
      const key = `${node}#${context.occurrence}`;
      const stated = options.choices?.[key] ?? options.choices?.[node];
      const failure = options.failures?.[key] ?? options.failures?.[node];
      const outcome = options.outcomes?.[key] ?? options.outcomes?.[node] ?? defaultOutcomes[node];
      const product: StepExecution['product'] = failure !== undefined
        ? { kind: 'declared-failure', failure }
        : outcome !== undefined
          ? { kind: 'outcome', outcome, source: 'step-declared' }
          : { kind: 'success' };
      const received = [...new Set(context.received.flatMap((item) => item.body.split('\n')).filter((line) => /^[a-z-]+#\d+ evidence$/.test(line) || Object.values(options.bodies ?? {}).includes(line)))].join('\n');
      return {
        ...(stated === undefined ? {} : { choices: Object.fromEntries(Object.entries(stated).map(([id, value]) => [id, { value, reason: `scripted ${id}` }])) }),
        product,
        summary: `Scripted ${node}`,
        providerTurns: 0,
        resultBody: `${node}#${context.occurrence} evidence\n${options.bodies?.[key] ?? options.bodies?.[node] ?? ''}\n${received}`,
      };
    },
  });
  return { result, seen, entries };
}

/** The context of one visit to a node. */
function visitOf(seen: StepContext[], node: string, occurrence: number): StepContext {
  const context = seen.find((item) => item.node.id === node && item.occurrence === occurrence);
  assert.ok(context, `expected ${node}#${occurrence} to run`);
  return context;
}

function receivedBy(seen: StepContext[], node: string) {
  const context = seen.find((item) => item.node.id === node);
  assert.ok(context, `expected ${node} to run`);
  return context.received;
}

test('a blocked backlog start reaches reporting without dispatching work', async () => {
  const { result, seen } = await scriptedRun({ failures: { 'backlog-start': 'blocked' } });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.ok(result.edgesTaken.includes('e32'));
  assert.ok(!seen.some((context) => context.node.id === 'tl-dispatch'));
  const received = receivedBy(seen, 'documenter-wrapup');
  assert.ok(received.some((item) => item.nodeId === 'backlog-start' && item.body.includes('backlog-start#1 evidence')));
  assert.ok(received.some((item) => item.nodeId === 'planner'));
  assert.match(receivedBy(seen, 'executive-report').find((item) => item.nodeId === 'tl-report')?.body ?? '', /backlog-start#1 evidence/);
});

test('a backlog start limit delivers the existing plan to wrap-up', async () => {
  const { result, seen } = await scriptedRun({ failures: { 'backlog-start': 'limit-reached' } });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.deepEqual(receivedBy(seen, 'documenter-wrapup').map((item) => item.nodeId), ['executive-intake', 'planner', 'backlog-start']);
});

/**
 * DSP-224: what each former dispatch variant is now: one capability outcome, with the model class
 * and the review route stated on the dispatch's CHOICE lines. The original pairing is kept: the
 * large implementer went through design QA, the large review and the full skeptic.
 */
const VARIANTS: Record<string, { readonly worker: string; readonly choices?: Record<string, string> }> = {
  'implementer-s': { worker: 'implementer', choices: { class: 'small', review: 'standard' } },
  'implementer-m': { worker: 'implementer', choices: { class: 'medium', review: 'standard' } },
  'implementer-l': { worker: 'implementer', choices: { class: 'large', review: 'thorough' } },
  'researcher-m': { worker: 'researcher', choices: { class: 'medium', review: 'standard' } },
  'researcher-l': { worker: 'researcher', choices: { class: 'large', review: 'thorough' } },
  'explorer-s': { worker: 'explorer', choices: { class: 'small' } },
  'explorer-m': { worker: 'explorer', choices: { class: 'medium' } },
  'data-curator': { worker: 'data-curator' },
  'experiment-analyst': { worker: 'experiment-analyst' },
  infra: { worker: 'infra' },
};

function dispatching(variant: string): { outcomes: Record<string, string>; choices: Record<string, Record<string, string>> } {
  const chosen = VARIANTS[variant]!;
  return { outcomes: { 'tl-dispatch': chosen.worker }, choices: chosen.choices === undefined ? {} : { 'tl-dispatch': chosen.choices } };
}

for (const variant of ['implementer-s', 'implementer-m', 'implementer-l']) {
  const worker = VARIANTS[variant]!.worker;
  const thorough = VARIANTS[variant]!.choices?.['review'] === 'thorough';
  test(`${variant} (one Implementer node) passes its actual contract and work through QA, review, challenge and acceptance`, async () => {
    const { result, seen } = await scriptedRun(dispatching(variant));
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const qa = thorough ? 'qa-design' : 'qa';
    const reviewer = 'reviewer';
    const skeptic = 'skeptic';
    assert.ok(!seen.some((item) => item.node.id === (thorough ? 'qa' : 'qa-design')), 'only the visit\'s review route runs');
    const qaInputs = receivedBy(seen, qa);
    assert.deepEqual(qaInputs.map((item) => item.nodeId), ['executive-intake', 'planner', worker]);
    const reviewInputs = receivedBy(seen, reviewer);
    const relay = reviewInputs.find((item) => item.nodeId === qa);
    assert.ok(relay);
    assert.match(relay.body, /planner#1 evidence/);
    assert.ok(relay.body.includes(`${worker}#1 evidence`));
    assert.equal(relay.ref, result.results.find((item) => item.nodeId === qa)?.ref);
    for (const stage of [skeptic, 'tl-accept']) {
      const body = receivedBy(seen, stage).map((item) => item.body).join('\n');
      for (const marker of ['planner#1 evidence', `${worker}#1 evidence`, `${qa}#1 evidence`, `${reviewer}#1 evidence`]) {
        assert.ok(body.includes(marker), `${stage} is missing ${marker}`);
      }
    }
    // The review and the challenge run on the visit's route: standard is offered its escalation, thorough is not.
    assert.equal(visitOf(seen, reviewer, 1).choices?.['review']?.value, thorough ? 'thorough' : 'standard');
    assert.equal(visitOf(seen, reviewer, 1).node.outcomes?.includes('design-review'), !thorough);
    assert.equal(visitOf(seen, skeptic, 1).node.outcomes?.includes('escalate'), !thorough);
  });
}

for (const variant of ['researcher-m', 'researcher-l', 'explorer-s', 'explorer-m', 'data-curator', 'experiment-analyst', 'infra']) {
  const worker = VARIANTS[variant]!.worker;
  test(`${variant} delivers only its executed branch to acceptance`, async () => {
    const { result, seen } = await scriptedRun(dispatching(variant));
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const body = receivedBy(seen, 'tl-accept').map((item) => item.body).join('\n');
    assert.match(body, /planner#1 evidence/);
    assert.ok(body.includes(`${worker}#1 evidence`));
    assert.ok(!body.includes('implementer#1 evidence'));
  });
}

test('DSP-224: each worker keeps its former challenge depth: by the dispatch for the researcher, fixed for the others', async () => {
  const expected: Record<string, string> = {
    'researcher-m': 'standard',
    'researcher-l': 'thorough',
    'explorer-s': 'standard',
    'explorer-m': 'standard',
    'experiment-analyst': 'thorough',
    infra: 'thorough',
  };
  for (const [variant, review] of Object.entries(expected)) {
    const { result, seen } = await scriptedRun(dispatching(variant));
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.equal(visitOf(seen, 'skeptic', 1).choices?.['review']?.value, review, variant);
  }
  const curated = await scriptedRun(dispatching('data-curator'));
  assert.equal(visitOf(curated.seen, 'reviewer', 1).choices?.['review']?.value, 'standard');
  assert.ok(curated.result.edgesTaken.includes('e87'));
});

test('a job gate request is reviewed only as a plan and stops before acceptance', async () => {
  const { result, seen } = await scriptedRun({
    outcomes: { 'tl-dispatch': 'infra', infra: 'job-gate-needed' },
    bodies: { infra: 'Authorization and verification pending; no launch observed.' },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.ok(result.edgesTaken.includes('e93'));
  assert.ok(result.edgesTaken.includes('e139'));
  assert.deepEqual(receivedBy(seen, 'reviewer-job-gate').map((item) => item.nodeId), ['executive-intake', 'planner', 'infra']);
  assert.ok(!seen.some((item) => ['tl-accept', 'backlog-done', 'executive-continue'].includes(item.node.id)));
  assert.match(receivedBy(seen, 'documenter-wrapup').find((item) => item.nodeId === 'reviewer-job-gate')?.body ?? '', /infra#1 evidence/);
  assert.match(receivedBy(seen, 'executive-report').find((item) => item.nodeId === 'tl-report')?.body ?? '', /Authorization and verification pending; no launch observed/);
});

test('design review and skeptic escalation carry the actual prior evidence, on the thorough route', async () => {
  const { result, seen } = await scriptedRun({ outcomes: { 'reviewer#1': 'design-review' } });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const designVisit = visitOf(seen, 'reviewer', 2);
  const design = designVisit.received.map((item) => item.body).join('\n');
  for (const marker of ['planner#1 evidence', 'implementer#1 evidence', 'qa#1 evidence', 'reviewer#1 evidence']) {
    assert.ok(design.includes(marker));
  }
  // The escalation set the route: the design review is thorough, is not offered the escalation
  // again, and its acceptance goes to the full challenge.
  assert.equal(designVisit.choices?.['review']?.value, 'thorough');
  assert.equal(designVisit.choices?.['review']?.decidedBy, 'e111');
  assert.ok(!designVisit.node.outcomes?.includes('design-review'));
  assert.equal(visitOf(seen, 'skeptic', 1).choices?.['review']?.value, 'thorough');
  const escalated = await scriptedRun({ outcomes: { 'skeptic#1': 'escalate' } });
  assert.equal(escalated.result.status, 'completed', escalated.result.fault?.detail ?? '');
  const full = visitOf(escalated.seen, 'skeptic', 2);
  const skeptic = full.received.map((item) => item.body).join('\n');
  for (const marker of ['planner#1 evidence', 'implementer#1 evidence', 'qa#1 evidence', 'reviewer#1 evidence', 'skeptic#1 evidence']) {
    assert.ok(skeptic.includes(marker));
  }
  assert.equal(full.choices?.['review']?.value, 'thorough');
  assert.ok(!full.node.outcomes?.includes('escalate'));
});

test('QA rework carries the failure forward and later review receives the new worker visit', async () => {
  const { result, seen } = await scriptedRun({ outcomes: { 'qa#1': 'fail', 'qa#2': 'pass' } });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const dispatch = seen.filter((item) => item.node.id === 'tl-dispatch')[1];
  assert.ok(dispatch?.received.some((item) => item.nodeId === 'qa' && item.body.includes('qa#1 evidence')));
  const reviewer = receivedBy(seen, 'reviewer').find((item) => item.nodeId === 'qa');
  assert.ok(reviewer?.body.includes('implementer#2 evidence'));
  assert.equal(reviewer?.occurrence, 2);
});

test('a worker failure reaches dispatch with its contract and reported state', async () => {
  const { result, seen } = await scriptedRun({
    failures: { 'implementer#1': 'research-needed' },
    bodies: { 'implementer#1': 'Evidence needed; no change reported.' },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const dispatch = seen.filter((item) => item.node.id === 'tl-dispatch')[1];
  const worker = dispatch?.received.find((item) => item.nodeId === 'implementer');
  assert.match(worker?.body ?? '', /planner#1 evidence/);
  assert.match(worker?.body ?? '', /Evidence needed; no change reported/);
});

test('QA failures consume calls but not default rework rounds', async () => {
  const { result, seen } = await scriptedRun({ outcomes: { qa: 'fail' }, maxCalls: 15, maxReworkRounds: 1 });
  assert.equal(result.status, 'limit-reached');
  assert.deepEqual(result.limitsReached, ['maxCalls']);
  assert.ok(seen.filter((item) => item.node.id === 'qa').length >= 2);
  assert.ok(!seen.some((item) => item.node.id === 'documenter-wrapup'));
});

test('a rework bound routes to finite reporting when requested', async () => {
  const { result, seen } = await scriptedRun({ outcomes: { reviewer: 'rework' }, maxReworkRounds: 1, routeLimit: true });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.deepEqual(result.limitsReached, ['maxReworkRounds']);
  assert.equal(seen.filter((item) => item.node.id === 'reviewer').length, 2);
  assert.ok(seen.some((item) => item.node.id === 'executive-report'));
});

test('routing a spent call limit permits the reporting calls beyond the configured cap', async () => {
  const { result, seen } = await scriptedRun({ maxCalls: 1, routeLimit: true });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.deepEqual(result.limitsReached, ['maxCalls']);
  assert.deepEqual(seen.map((item) => item.node.id), ['executive-intake', 'documenter-wrapup', 'tl-report', 'executive-report']);
  assert.equal(result.usage.calls, 4);
});

for (const maxCalls of [2, 3, 4]) {
  test(`a call limit first spent at report call ${maxCalls} stops without delivery`, async () => {
    const { result, seen } = await scriptedRun({ outcomes: { 'executive-intake': 'wrap-up' }, maxCalls, routeLimit: true });
    assert.equal(result.status, 'limit-reached');
    assert.deepEqual(result.limitsReached, ['maxCalls']);
    assert.equal(seen.length, maxCalls);
    assert.ok(!result.edgesTaken.includes('e138'));
  });
}

type LedgerEntry = { slice: string; contract: string; work: string; evidence: string; source: string };
type SelectiveResult = { ledger: LedgerEntry[]; contract?: string; work?: string; evidence?: string };

async function selectiveTwoSliceRun(secondStartFailure?: 'blocked' | 'limit-reached', callLimit?: number) {
  const loaded = load(root);
  const graph = callLimit === undefined ? loaded : { ...loaded, limits: { ...loaded.limits, maxCalls: callLimit } };
  const seen: StepContext[] = [];
  const outputs = new Map<string, SelectiveResult>();
  const store = createMemoryResultStore((text) => createHash('sha256').update(text).digest('hex'));
  const result = await runLoopGraph(graph, {
    runId: 'selective-two-slices',
    dryRun: false,
    maxTransitions: 100,
    ...(callLimit === undefined ? {} : { routeLimitAs: 'limit-reached' }),
    resultStore: store,
    executor: async (context): Promise<StepExecution> => {
      seen.push(context);
      const node = context.node.id;
      const inputs = context.received.map((item) => JSON.parse(item.body) as SelectiveResult);
      const ledger = new Map<string, LedgerEntry>();
      for (const input of inputs) for (const entry of input.ledger) ledger.set(entry.slice, entry);
      const output: SelectiveResult = { ledger: [...ledger.values()] };
      const latest = (key: 'contract' | 'work' | 'evidence') => inputs.map((input) => input[key]).findLast((value) => value !== undefined);
      if (node !== 'tl-select' && node !== 'executive-intake') {
        output.contract = latest('contract');
        output.work = latest('work');
        output.evidence = latest('evidence');
      }
      if (node === 'planner') output.contract = `contract-${context.occurrence}`;
      if (node === 'implementer') output.work = `work-${context.occurrence}`;
      if (node === 'qa') output.evidence = `check-${context.occurrence}`;
      if (node === 'tl-accept') {
        assert.ok(output.contract && output.work && output.evidence);
        output.ledger.push({ slice: `slice-${context.occurrence}`, contract: output.contract, work: output.work, evidence: output.evidence, source: `tl-accept#${context.occurrence}` });
      }
      outputs.set(`${node}#${context.occurrence}`, output);
      const failure = node === 'backlog-start' && context.occurrence === 2 ? secondStartFailure : undefined;
      const outcome = node === 'executive-continue' && context.occurrence === 1 ? 'next-slice' : defaultOutcomes[node];
      return {
        product: failure ? { kind: 'declared-failure', failure } : outcome ? { kind: 'outcome', outcome, source: 'step-declared' } : { kind: 'success' },
        summary: node,
        providerTurns: 0,
        resultBody: JSON.stringify(output),
      };
    },
  });
  return { result, seen, outputs };
}

for (const failure of [undefined, 'blocked', 'limit-reached'] as const) {
  test(`selective handoffs retain accepted slices through ${failure ?? 'two completed slices'}`, async () => {
    const { result, seen, outputs } = await selectiveTwoSliceRun(failure);
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const first = { slice: 'slice-1', contract: 'contract-1', work: 'work-1', evidence: 'check-1', source: 'tl-accept#1' };
    const second = { slice: 'slice-2', contract: 'contract-2', work: 'work-2', evidence: 'check-2', source: 'tl-accept#2' };
    const select = seen.find((item) => item.node.id === 'tl-select' && item.occurrence === 2);
    assert.ok(select);
    assert.deepEqual(JSON.parse(select.received.find((item) => item.nodeId === 'executive-continue')!.body).ledger, [first]);
    assert.deepEqual(outputs.get('planner#2')?.ledger, [first]);
    const expected = failure ? [first] : [first, second];
    for (const stage of ['documenter-wrapup#1', 'tl-report#1', 'executive-report#1']) {
      assert.deepEqual(outputs.get(stage)?.ledger, expected, stage);
    }
    if (failure) assert.ok(!seen.some((item) => item.node.id === 'tl-accept' && item.occurrence === 2));
  });
}

test('a runner-enforced limit on the second backlog start preserves the first accepted slice', async () => {
  const { result, seen, outputs } = await selectiveTwoSliceRun(undefined, 17);
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.deepEqual(result.limitsReached, ['maxCalls']);
  assert.equal(seen[16]?.node.id, 'backlog-start');
  assert.equal(seen[16]?.occurrence, 2);
  const wrapup = receivedBy(seen, 'documenter-wrapup');
  assert.deepEqual(wrapup.map((item) => item.nodeId), ['executive-intake', 'planner', 'backlog-start']);
  assert.deepEqual(outputs.get('executive-report#1')?.ledger, [{ slice: 'slice-1', contract: 'contract-1', work: 'work-1', evidence: 'check-1', source: 'tl-accept#1' }]);
  assert.ok(!seen.some((item) => item.node.id === 'tl-accept' && item.occurrence === 2));
});
/** An agent that answers each step with the outcome {@link defaultOutcomes} names for it, keeping what it was given. */
class NetworkAgent {
  readonly prompts = new Map<string, string[]>();
  readonly workspaces = new Set<string>();
  private readonly listeners = new Map<string, AgentEventListener>();
  private readonly provider: RunProvider;
  private readonly nodeIds: readonly string[];
  private readonly outcomes: Readonly<Record<string, string>>;
  private readonly onSend: ((node: string, visit: number) => void) | undefined;
  /** DSP-222: the model each turn of a node was sent with, in order. */
  private readonly sessionModel = new Map<string, string>();
  private readonly turnModels = new Map<string, string[]>();
  constructor(provider: RunProvider, nodeIds: readonly string[], outcomes: Readonly<Record<string, string>> = {}, onSend?: (node: string, visit: number) => void) {
    this.provider = provider;
    this.nodeIds = nodeIds;
    this.outcomes = outcomes;
    this.onSend = onSend;
  }
  modelsOf(node: string): readonly string[] {
    return this.turnModels.get(node) ?? [];
  }
  private nodeOf(sessionId: string): string {
    const bare = sessionId.replace(/--visit-\d+$/, '');
    return [...this.nodeIds].sort((a, b) => b.length - a.length).find((id) => bare.endsWith(`--${id}`)) ?? '';
  }
  setSessionModel(sessionId: string, model: string) {
    this.sessionModel.set(sessionId, model);
  }
  startSession(config: { dspatchSessionId?: string; workspacePath?: string; modelRequested?: string }) {
    if (config.workspacePath !== undefined) this.workspaces.add(config.workspacePath);
    this.sessionModel.set(config.dspatchSessionId ?? 's', config.modelRequested ?? '');
    const id = config.dspatchSessionId ?? 's';
    return Promise.resolve({ dspatchSessionId: id, provider: this.provider, providerSessionId: `${this.provider}-${id}`, createdAt: new Date().toISOString() });
  }
  subscribe(sessionId: string, listener: AgentEventListener) {
    this.listeners.set(sessionId, listener);
    return () => this.listeners.delete(sessionId);
  }
  send(sessionId: string, prompt: string) {
    const node = this.nodeOf(sessionId);
    this.prompts.set(node, [...(this.prompts.get(node) ?? []), prompt]);
    this.turnModels.set(node, [...(this.turnModels.get(node) ?? []), this.sessionModel.get(sessionId) ?? '']);
    const visit = this.prompts.get(node)?.length ?? 0;
    this.onSend?.(node, visit);
    const outcome = this.outcomes[`${node}#${String(visit)}`] ?? defaultOutcomes[node] ?? 'succeeded';
    const runId = `${sessionId}-${String(this.prompts.get(node)?.length ?? 0)}`;
    const emit = (event: Partial<AgentEvent>): void => {
      this.listeners.get(sessionId)?.({ dspatchSessionId: sessionId, dspatchRunId: runId, at: new Date().toISOString(), rawProviderEvent: null, ...event } as AgentEvent);
    };
    setImmediate(() => {
      emit({ type: 'run.started' });
      emit({ type: 'assistant.message', text: `${node} visit ${String(visit)} done.\n\nRESULT: ${outcome}` } as Partial<AgentEvent>);
      emit({ type: 'run.finished', status: 'finished' } as Partial<AgentEvent>);
    });
    return Promise.resolve({ dspatchRunId: runId });
  }
  cancel() { return Promise.resolve(); }
  readUsage() { return Promise.resolve([]); }
  dispose() { return Promise.resolve(); }
}

for (const provider of ['cursor', 'claude', 'copilot'] as const) {
  test(`installed copy, open project: the network runs on the chat-loop path with ${provider} (simulated adapter)`, async (context) => {
    // As installed: the definition, graph and roles copied out of the repository, and a
    // separate project with its own instruction file and no loop definitions of its own.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-generic-network-'));
    context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const installed = path.join(scratch, 'bundled');
    fs.cpSync(path.join(root, 'docs/loop'), path.join(installed, 'docs/loop'), { recursive: true });
    fs.cpSync(path.join(root, '.dspatch/loops'), path.join(installed, '.dspatch/loops'), { recursive: true });
    const project = path.join(scratch, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Project rules\n', 'utf8');
    const graph = load(installed);
    const resolveRole = createFileRoleResolver(installed);
    assert.deepEqual(checkLoopGraph(graph, { resolveRole, runProvider: provider }).filter((finding) => finding.severity === 'error'), []);

    const agent = new NetworkAgent(provider, graph.nodes.map((node) => node.id));
    const prepared = prepareLoopRun({
      sessionProvider: provider,
      chosenAgent: null,
      rootCount: 1,
      entryNode: graph.nodes.find((node) => node.id === graph.entry),
      graph,
      cursorModel: 'composer-2',
      claudeModel: 'claude-haiku-4-5',
      claudeModels: ['claude-haiku-4-5'],
      copilotModel: 'claude-opus-5.5',
      copilotModels: null,
      adapters: { preflight: () => null, createAdapter: () => agent as unknown as ChatAdapter },
    });
    assert.ok(prepared.ok, prepared.ok ? '' : prepared.reason);
    // The host's shared snapshot names the instruction files of the open project's folder.
    const snapshot = buildContextSnapshot({
      conversationId: 'c1',
      messages: [{ ordinal: 0, prompt: 'Add a changelog entry.', answer: '' } as never],
      earlierRuns: [],
      repository: null,
      instructionFiles: ['AGENTS.md', 'CLAUDE.md'].filter((name) => fs.existsSync(path.join(project, name))),
      mandate: 'Add a changelog entry.',
    });
    assert.ok(snapshot);
    const delivery = await runLiveGraph(graph, {
      runId: `generic-${provider}`,
      repoRoot: installed,
      outDir: null,
      resultsDir: path.join(scratch, 'results'),
      modelRequested: prepared.modelRequested,
      personModel: prepared.personModel,
      workspacePath: project,
      keepWorkspace: true,
      bindingKind: 'chat-loop',
      provider: prepared.provider,
      createAdapter: prepared.createAdapter,
      promptFor: (node, step) => chatPromptFor(node, {
        entryId: graph.entry,
        mandate: 'Add a changelog entry.',
        step,
        role: (() => {
          const resolved = node.role === undefined ? null : resolveRole(node.role);
          return resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null };
        })(),
        context: { text: snapshot.text, personWordsText: snapshot.personWordsText },
        skipping: skippingRoutesOf(graph, node.id),
      }),
    });
    assert.equal(delivery.result.status, 'completed', delivery.journalText);
    assert.equal(delivery.result.terminalNodeId, 'iteration-ended');
    assert.deepEqual([...agent.workspaces], [project], 'every step works in the open project');
    assert.ok(delivery.inspection.sessions.every((session) => session.provider === provider));
    const entry = agent.prompts.get('executive-intake')?.[0] ?? '';
    assert.match(entry, /Project instruction files present[^\n]*\n- AGENTS\.md/);
    const executive = resolveRole({ id: 'generic-executive', source: { kind: 'role-source', path: 'docs/loop/roles/generic/executive.role.md' } });
    assert.ok(executive !== null && fs.existsSync(path.resolve(installed, executive.sourcePath)), 'roles are read from the installed copy');
    assert.ok(entry.includes((executive?.instructions ?? '').split('\n').find((line) => line.trim() !== '') ?? '\u0000'));
    for (const node of ['tl-dispatch', 'implementer', 'qa', 'reviewer', 'tl-accept', 'documenter-wrapup', 'executive-report']) {
      assert.ok(agent.prompts.has(node), `${node} ran`);
    }
  });
}

/* DSP-222, DSP-224: one node per role, with the model class chosen per visit. */

/** The dispatch's reply text for a capability with its CHOICE lines, as a live step writes it. */
function dispatchReply(worker: string, choices: Record<string, string>): string {
  return [worker, ...Object.entries(choices).map(([id, value]) => `CHOICE: ${id} ${value} because the slice needs it`)].join('\n');
}

test('DSP-224: the size variants are one node per role, each choosing its class per visit', () => {
  const graph = load(root);
  const ids = graph.nodes.map((node) => node.id);
  for (const gone of ['implementer-s', 'implementer-m', 'implementer-l', 'explorer-s', 'explorer-m', 'researcher-m', 'researcher-l', 'reviewer-s', 'reviewer-l', 'skeptic-s']) {
    assert.ok(!ids.includes(gone), `${gone} is merged`);
  }
  const classesOf = (id: string) => graph.nodes.find((item) => item.id === id)?.model;
  assert.deepEqual(classesOf('implementer')?.options?.map((option) => option.modelClass), ['small', 'medium', 'large']);
  assert.deepEqual(classesOf('explorer')?.options?.map((option) => option.modelClass), ['small', 'medium']);
  assert.deepEqual(classesOf('researcher')?.options?.map((option) => option.modelClass), ['medium', 'large']);
  for (const id of ['implementer', 'explorer', 'researcher']) assert.equal(classesOf(id)?.chosenBy, 'class', id);
  for (const id of ['reviewer', 'skeptic']) {
    assert.equal(classesOf(id)?.chosenBy, 'review', id);
    assert.deepEqual(classesOf(id)?.options?.map((option) => `${option.id}:${option.modelClass ?? ''}`), ['standard:small', 'thorough:large']);
  }
  assert.ok(graph.nodes.every((node) => (node.model?.options ?? []).every((option) => option.model === undefined)), 'the generic graph names no concrete model');
  // Class and review route are two choices, decided by the dispatch and by nothing else.
  assert.deepEqual(graph.choices?.map((choice) => choice.id), ['class', 'review']);
  assert.deepEqual(graph.nodes.filter((node) => node.decides !== undefined).map((node) => [node.id, node.decides]), [['tl-dispatch', ['class', 'review']]]);
  assert.ok(!graph.edges.some((edge) => edge.selectsModel !== undefined), 'no route stands in for a class');
  // The Implementer's continuation is chosen by the review route.
  const success = graph.edges.filter((edge) => edge.from === 'implementer' && edge.when.on === 'success').map((edge) => `${edge.whenChosen?.['review'] ?? ''}->${edge.to}`).sort();
  assert.deepEqual(success, ['standard->qa', 'thorough->qa-design']);
  // DSP-227: the CHOICE and slice formats are DSpatch's, written from the graph; the purpose keeps the criteria.
  const dispatch = graph.nodes.find((node) => node.id === 'tl-dispatch')!;
  assert.doesNotMatch(dispatch.purpose ?? '', /CHOICE|dspatch-slices/);
  assert.match(dispatch.purpose ?? '', /The Implementer runs any class, the Researcher medium or large/);
  assert.match(describeVisitChoices(graph, dispatch, {}), /CHOICE: class small — A straightforward[\s\S]*CHOICE: review thorough/);
  assert.match(describeSplitInstructions(graph, dispatch), /choose the outcome "parallel"[\s\S]*```dspatch-slices/);
});

test('DSP-222: the class varies between slices and each visit records class, model and reason', async () => {
  const { result, entries } = await scriptedRun({
    outcomes: { 'executive-continue#1': 'next-slice' },
    choices: { 'tl-dispatch#1': { class: 'small' }, 'tl-dispatch#2': { class: 'medium' } },
    runModel: { provider: 'copilot', model: 'person-model', classes: { small: 'model-for-small', medium: 'model-for-medium' } },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const visits = entries.filter((entry) => entry.kind === 'node-entered' && entry.nodeId === 'implementer').map((entry) => modelSelectionFromData(entry.data));
  assert.equal(visits.length, 2);
  assert.deepEqual(visits.map((visit) => [visit?.modelClass, visit?.model, visit?.source, visit?.chosenBy]), [['small', 'model-for-small', 'policy', 'class'], ['medium', 'model-for-medium', 'policy', 'class']]);
  assert.match(visits[0]?.reason ?? '', /class small, decided by tl-dispatch: scripted class/);
});

test('DSP-222: an unmapped class runs the chat\'s model and says so, before the run and on the visit', async () => {
  const graph = load(root);
  const prepared = prepareLoopRun({
    sessionProvider: 'copilot',
    chosenAgent: null,
    rootCount: 1,
    entryNode: graph.nodes.find((node) => node.id === graph.entry),
    graph,
    cursorModel: 'composer-2',
    claudeModel: '',
    copilotModel: 'person-model',
    copilotModels: null,
    modelClasses: { copilot: { medium: 'model-for-medium' } },
    adapters: { preflight: () => null, createAdapter: () => { throw new Error('not built'); } },
  });
  assert.ok(prepared.ok);
  assert.match(prepared.classNote ?? '', /Model classes small, large have no model configured for Copilot, so those classes run with person-model/);
  const data = modelSelectionData(
    graph.nodes.find((node) => node.id === 'implementer')!,
    null,
    undefined,
    { provider: 'copilot', model: 'person-model', classes: prepared.modelClasses },
    { class: { value: 'small', by: 'step', decidedBy: 'tl-dispatch', reason: 'one localized fix' } },
    graph,
  );
  assert.equal(data['model'], 'person-model');
  assert.equal(data['modelClass'], 'small');
  assert.match(String(data['modelReason']), /class small, decided by tl-dispatch: one localized fix; class small uses the chat model for copilot/);
  const mark = nodeModelMark(graph.nodes.find((node) => node.id === 'implementer')!, [{ seq: 1, atIso: '', sinceStartMs: 0, kind: 'node-entered', nodeId: 'implementer', detail: '', data: { ...data, occurrence: 1 } }]);
  assert.equal(mark?.badge?.full, 'Small');
  assert.equal(mark?.line, 'now: visit 1 · chat model person-model');
  assert.match(mark?.detail ?? '', /Use chat model, so it resolved to the chat's model person-model/);
});

test('DSP-222: on the live path the class\'s model reaches the adapter, and a revisit with another class gets its model', async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-generic-classes-'));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const project = path.join(scratch, 'project');
  fs.mkdirSync(project);
  const graph = load(root);
  const resolveRole = createFileRoleResolver(root);
  const entries: RunJournalEntry[] = [];
  // DSP-224: the badge as the canvas would draw it while each Implementer visit runs.
  const badges: string[] = [];
  const agent = new NetworkAgent('copilot', graph.nodes.map((node) => node.id), {
    'tl-dispatch#1': dispatchReply('implementer', { class: 'small', review: 'standard' }),
    'tl-dispatch#2': dispatchReply('implementer', { class: 'large', review: 'thorough' }),
    'executive-continue#1': 'next-slice',
  }, (node) => {
    if (node === 'implementer') {
      const mark = nodeModelMark(graph.nodes.find((item) => item.id === 'implementer')!, entries);
      badges.push(`${mark?.badge?.full ?? ''}/${mark?.badge?.short ?? ''} ${mark?.line ?? ''}`);
    }
  });
  const delivery = await runLiveGraph(graph, {
    runId: 'generic-classes',
    repoRoot: root,
    outDir: null,
    resultsDir: path.join(scratch, 'results'),
    modelRequested: 'person-model',
    personModel: 'person-model',
    modelClasses: { small: 'model-for-small', medium: 'model-for-medium', large: 'model-for-large' },
    workspacePath: project,
    keepWorkspace: true,
    bindingKind: 'chat-loop',
    provider: 'copilot',
    createAdapter: () => agent as unknown as ChatAdapter,
    onJournalEntry: (entry) => entries.push(entry),
    promptFor: (node, step) => chatPromptFor(node, { entryId: graph.entry, mandate: 'Two slices.', step, role: (() => { const resolved = node.role === undefined ? null : resolveRole(node.role); return resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null }; })(), skipping: skippingRoutesOf(graph, node.id) }),
  });
  assert.equal(delivery.result.status, 'completed', delivery.journalText);
  // What the adapter was sent, what the journal says and what the node shows agree, visit by visit.
  assert.deepEqual(agent.modelsOf('implementer'), ['model-for-small', 'model-for-large']);
  const journal = entries.filter((entry) => entry.kind === 'node-entered' && entry.nodeId === 'implementer').map((entry) => modelSelectionFromData(entry.data));
  assert.deepEqual(journal.map((visit) => `${visit?.modelClass ?? ''}:${visit?.model ?? ''}`), ['small:model-for-small', 'large:model-for-large']);
  assert.deepEqual(badges, ['Small/S now: visit 1 · model-for-small', 'Large/L now: visit 2 · model-for-large']);
  // The review route is the visit's own: QA the first slice, design QA the second, and the
  // reviewer's and skeptic's class follows it.
  assert.equal(agent.modelsOf('qa').length, 1);
  assert.equal(agent.modelsOf('qa-design').length, 1);
  assert.deepEqual(agent.modelsOf('reviewer'), ['model-for-small', 'model-for-large'], 'the standard review runs class small, the thorough one large');
  assert.ok(agent.modelsOf('qa').every((model) => model === 'person-model'), 'a step without a policy keeps the chat\'s model');
  // The dispatch was told to decide both, and the implementer was told what it was assigned.
  assert.match(agent.prompts.get('tl-dispatch')?.[0] ?? '', /CHOICE: review thorough — Design QA/);
  assert.match(agent.prompts.get('implementer')?.[1] ?? '', /- Review route: thorough — Design QA[^\n]*decided by tl-dispatch: because the slice needs it/);
});

test('DSP-222: an option names a model or a known class, never both and never an unknown class', () => {
  const text = fs.readFileSync(path.join(root, graphPath), 'utf8');
  const resolveRole = createFileRoleResolver(root);
  for (const bad of ['{ "id": "small", "modelClass": "small", "model": "x" }', '{ "id": "small", "modelClass": "tiny" }', '{ "id": "small" }']) {
    const json = JSON.parse(text);
    // A policy chosen by no choice must say its class itself.
    const model = json.nodes.find((node: { id: string }) => node.id === 'implementer').model;
    delete model.chosenBy;
    model.options = model.options.map((option: { id: string }) => ({ ...option, modelClass: option.id }));
    model.options[0] = JSON.parse(bad);
    const loaded = loadLoopGraph(JSON.stringify(json), { resolveRole });
    assert.equal(loaded.ok, false, bad);
    assert.ok(!loaded.ok && loaded.findings.some((finding) => finding.code === 'bad-model-option'), bad);
  }
  // DSP-227: chosen by the class choice, the id alone takes the choice's class, and another class is refused.
  const json = JSON.parse(text);
  json.nodes.find((node: { id: string }) => node.id === 'implementer').model.options[0] = { id: 'small', modelClass: 'large' };
  const contradicted = loadLoopGraph(JSON.stringify(json), { resolveRole });
  assert.ok(!contradicted.ok && contradicted.findings.some((finding) => finding.code === 'model-option-contradicts-choice'));
});

/* DSP-223: the app-wide model class setting, in the chat's model configuration file. */

test('DSP-223: a class is set and cleared in the model configuration, the chat\'s choice kept, shared models found', (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-model-classes-'));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const file = path.join(scratch, 'dspatch-model-choice.json');
  writeModelChoiceFile(file, { models: { copilot: 'chat-model' }, modelClasses: {} });
  writeModelClass(file, 'copilot', 'medium', 'model-b');
  writeModelClass(file, 'copilot', 'small', 'model-a');
  writeModelClass(file, 'claude', 'large', 'claude-big');
  let read = readModelChoiceFile(file);
  assert.deepEqual(read.models, { copilot: 'chat-model' }, 'the chat\'s model choice is kept');
  assert.deepEqual(read.modelClasses, { copilot: { small: 'model-a', medium: 'model-b' }, claude: { large: 'claude-big' } });
  assert.deepEqual(Object.keys(read.modelClasses.copilot ?? {}), ['small', 'medium'], 'written in class order');
  writeModelClass(file, 'copilot', 'medium', 'model-a');
  assert.deepEqual(sharedClassModels(readModelChoiceFile(file).modelClasses.copilot ?? {}), [{ model: 'model-a', classes: ['small', 'medium'] }]);
  // "Use chat model" removes the class; with none left the agent's entry goes too.
  writeModelClass(file, 'claude', 'large', null);
  read = readModelChoiceFile(file);
  assert.equal(read.modelClasses.claude, undefined);
  assert.deepEqual(read.models, { copilot: 'chat-model' });
});

test('DSP-223: a mapping changed during a run applies from the next run, not to the run in progress', async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-model-classes-run-'));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const file = path.join(scratch, 'dspatch-model-choice.json');
  writeModelClass(file, 'copilot', 'small', 'first-small');
  writeModelClass(file, 'copilot', 'medium', 'first-medium');
  const project = path.join(scratch, 'project');
  fs.mkdirSync(project);
  const graph = load(root);
  const resolveRole = createFileRoleResolver(root);
  const prepare = (agent: unknown) =>
    prepareLoopRun({
      sessionProvider: 'copilot',
      chosenAgent: null,
      rootCount: 1,
      entryNode: graph.nodes.find((node) => node.id === graph.entry),
      graph,
      cursorModel: 'composer-2',
      claudeModel: '',
      copilotModel: 'chat-model',
      copilotModels: null,
      // As the host does: the setting as saved when the run is prepared.
      modelClasses: readModelChoiceFile(file).modelClasses,
      adapters: { preflight: () => null, createAdapter: () => agent as ChatAdapter },
    });
  // The setting is changed while the first implementer visit is in flight.
  const agent = new NetworkAgent('copilot', graph.nodes.map((node) => node.id), {
    'tl-dispatch#1': dispatchReply('implementer', { class: 'small' }),
    'tl-dispatch#2': dispatchReply('implementer', { class: 'medium' }),
    'executive-continue#1': 'next-slice',
  }, (node, visit) => {
    if (node === 'implementer' && visit === 1) {
      writeModelClass(file, 'copilot', 'medium', 'second-medium');
    }
  });
  const prepared = prepare(agent);
  assert.ok(prepared.ok);
  const delivery = await runLiveGraph(graph, {
    runId: 'classes-snapshot',
    repoRoot: root,
    outDir: null,
    resultsDir: path.join(scratch, 'results'),
    modelRequested: prepared.modelRequested,
    personModel: prepared.personModel,
    modelClasses: prepared.modelClasses,
    workspacePath: project,
    keepWorkspace: true,
    bindingKind: 'chat-loop',
    provider: prepared.provider,
    createAdapter: prepared.createAdapter,
    promptFor: (node, step) => chatPromptFor(node, { entryId: graph.entry, mandate: 'Two slices.', step, role: (() => { const resolved = node.role === undefined ? null : resolveRole(node.role); return resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null }; })(), skipping: skippingRoutesOf(graph, node.id) }),
  });
  assert.equal(delivery.result.status, 'completed', delivery.journalText);
  assert.deepEqual(agent.modelsOf('implementer'), ['first-small', 'first-medium'], 'the run keeps the mapping it started with');
  assert.equal(readModelChoiceFile(file).modelClasses.copilot?.medium, 'second-medium');
  const next = prepare(agent);
  assert.ok(next.ok);
  assert.equal(next.modelClasses.medium, 'second-medium', 'the next run reads the changed mapping');
  assert.equal(next.provider, 'copilot', 'the agent is the chat\'s, whatever the mapping');
});

test('DSP-223: a class mapped to a model the agent does not list refuses the run, naming the step, and swaps nothing', () => {
  const graph = load(root);
  const prepared = prepareLoopRun({
    sessionProvider: 'copilot',
    chosenAgent: null,
    rootCount: 1,
    entryNode: graph.nodes.find((node) => node.id === graph.entry),
    // As the editor's line asks: only the steps that offer a class.
    graph: { nodes: graph.nodes.filter((node) => node.model?.policy === 'select') },
    cursorModel: 'composer-2',
    claudeModel: '',
    copilotModel: 'copilot-default',
    copilotModels: ['copilot-default'],
    modelClasses: { copilot: { small: 'gpt-5.5-mini' } },
    adapters: { preflight: () => null, createAdapter: () => { throw new Error('not built'); } },
  });
  assert.equal(prepared.ok, false);
  assert.match(prepared.ok ? '' : prepared.why, /The step "Implementer: implementer" runs class small, set to the model gpt-5\.5-mini, which Copilot does not offer this account\. Choose another model for that class in Model classes/);
});

/* DSP-224: model class and review route, chosen per visit and independently. */

test('DSP-224: the same Implementer node takes any class on either review route, the two chosen independently', async () => {
  const runModel = { provider: 'copilot', model: 'chat', classes: { small: 'm-small', medium: 'm-medium', large: 'm-large' } };
  for (const [klass, review] of [['small', 'thorough'], ['large', 'standard'], ['medium', 'thorough'], ['small', 'standard']] as const) {
    const { result, seen, entries } = await scriptedRun({ choices: { 'tl-dispatch': { class: klass, review } }, runModel });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const implementer = entries.find((entry) => entry.kind === 'node-entered' && entry.nodeId === 'implementer');
    assert.equal(modelSelectionFromData(implementer?.data)?.model, `m-${klass}`, `${klass}/${review}`);
    assert.equal(implementer?.data?.['choice.review'], review);
    assert.ok(result.edgesTaken.includes(review === 'thorough' ? 'e62' : 'e52'), `${klass}/${review}`);
    assert.ok(!seen.some((item) => item.node.id === (review === 'thorough' ? 'qa' : 'qa-design')));
    const reviewer = entries.find((entry) => entry.kind === 'node-entered' && entry.nodeId === 'reviewer');
    assert.equal(modelSelectionFromData(reviewer?.data)?.model, review === 'thorough' ? 'm-large' : 'm-small', `the review's class follows the route, not the worker's class (${klass}/${review})`);
    const decided = entries.find((entry) => entry.kind === 'edge-taken' && entry.nodeId === 'tl-dispatch');
    assert.match(String(decided?.data?.['choicesDecided']), new RegExp(`class ${klass} \\(tl-dispatch: scripted class\\); review ${review} \\(tl-dispatch: scripted review\\)`));
  }
});

test('DSP-224: a revisit after rework runs the new dispatch\'s choices, never the earlier subtask\'s', async () => {
  const runModel = { provider: 'copilot', model: 'chat', classes: { small: 'm-small', large: 'm-large' } };
  const { result, seen, entries } = await scriptedRun({
    outcomes: { 'qa-design#1': 'fail' },
    // The second dispatch states only the class: the route is the default, not the first subtask's.
    choices: { 'tl-dispatch#1': { class: 'large', review: 'thorough' }, 'tl-dispatch#2': { class: 'small' } },
    runModel,
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const second = visitOf(seen, 'implementer', 2);
  assert.equal(second.choices?.['class']?.value, 'small');
  assert.equal(second.choices?.['review']?.value, 'standard');
  assert.equal(second.choices?.['review']?.by, 'default');
  assert.match(second.choices?.['review']?.reason ?? '', /stated no review, so the default applies/);
  assert.equal(seen.filter((item) => item.node.id === 'qa').length, 1, 'the second visit goes through standard QA');
  const visits = entries.filter((entry) => entry.kind === 'node-entered' && entry.nodeId === 'implementer').map((entry) => modelSelectionFromData(entry.data)?.model);
  assert.deepEqual(visits, ['m-large', 'm-small']);
  // A choice the step could not make counts as not made: an unknown value takes the default too.
  const odd = await scriptedRun({ choices: { 'tl-dispatch': { class: 'huge', review: 'thorough' } } });
  assert.equal(visitOf(odd.seen, 'implementer', 1).choices?.['class']?.value, 'medium');
  assert.match(visitOf(odd.seen, 'implementer', 1).choices?.['class']?.reason ?? '', /stated class "huge", which is not one of its options/);
});

test('DSP-224: a class a role does not offer runs its default and the journal says why', async () => {
  const { result, entries } = await scriptedRun({
    outcomes: { 'tl-dispatch': 'researcher' },
    choices: { 'tl-dispatch': { class: 'small', review: 'standard' } },
    runModel: { provider: 'copilot', model: 'chat', classes: { small: 'm-small', medium: 'm-medium' } },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const visit = modelSelectionFromData(entries.find((entry) => entry.kind === 'node-entered' && entry.nodeId === 'researcher')?.data);
  assert.equal(visit?.modelClass, 'medium');
  assert.match(visit?.reason ?? '', /^default: class small, decided by tl-dispatch: scripted class, which is not an option of this step/);
});

test('DSP-224: the canvas says the class is chosen per visit before a run, and shows the visit\'s class during one', () => {
  const graph = load(root);
  const implementer = graph.nodes.find((node) => node.id === 'implementer')!;
  const before = nodeModelMark(implementer, null);
  assert.equal(before?.badge, null, 'no class is shown as chosen before a visit');
  assert.equal(before?.line, 'class chosen per visit: S · M · L');
  assert.match(before?.detail ?? '', /chosen per visit by class/);
  assert.equal(nodeModelMark(graph.nodes.find((node) => node.id === 'qa')!, null), null);
});

test('DSP-224: CHOICE lines are read per choice the node decides, first line wins, reason kept', () => {
  const text = 'Work.\n**CHOICE: class large** the design is open\nCHOICE: review thorough — needs design QA\nCHOICE: class small\nCHOICE: other x\nRESULT: implementer';
  assert.deepEqual(statedChoicesFrom(text, ['class', 'review']), {
    class: { value: 'large', reason: 'the design is open' },
    review: { value: 'thorough', reason: 'needs design QA' },
  });
});

test('DSP-224: validation refuses an unknown choice, an uncovered route and two routes for one value', () => {
  const text = fs.readFileSync(path.join(root, graphPath), 'utf8');
  const resolveRole = createFileRoleResolver(root);
  const codes = (mutate: (json: { nodes: { id: string; decides?: string[] }[]; edges: { id: string; sets?: Record<string, string>; whenChosen?: Record<string, string> }[] }) => void) => {
    const json = JSON.parse(text);
    mutate(json);
    const loaded = loadLoopGraph(JSON.stringify(json), { resolveRole });
    return loaded.ok ? [] : loaded.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.code);
  };
  assert.deepEqual(codes(() => {}), []);
  assert.ok(codes((json) => { json.edges = json.edges.filter((edge) => edge.id !== 'e62'); }).includes('choice-route-gap'));
  assert.ok(codes((json) => { json.edges.find((edge) => edge.id === 'e62')!.whenChosen = { review: 'standard' }; }).includes('choice-routes-ambiguous'));
  assert.ok(codes((json) => { json.edges.find((edge) => edge.id === 'e77')!.sets = { review: 'deep' }; }).includes('edge-names-unknown-choice'));
  assert.ok(codes((json) => { json.nodes.find((node) => node.id === 'tl-dispatch')!.decides = ['size']; }).includes('decides-unknown-choice'));
  // An escalation offered only on the standard route needs no thorough edge: the step is not offered it then.
  assert.deepEqual(codes((json) => { delete json.edges.find((edge) => edge.id === 'e111')!.sets; }), []);
});

/* DSP-225: one node visited twice, small then large: kept apart, with model and agent context per visit. */

for (const provider of ['copilot', 'claude'] as const) {
  test(`DSP-225: two visits of one node, small then large, on ${provider}: each visit's model, output and agent context stay its own`, async (context) => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-visits-'));
    context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const project = path.join(scratch, 'project');
    fs.mkdirSync(project);
    const graph = load(root);
    const implementer = graph.nodes.find((node) => node.id === 'implementer')!;
    const resolveRole = createFileRoleResolver(root);
    const entries: RunJournalEntry[] = [];
    const seenAtSecond: string[] = [];
    const agent = new NetworkAgent(provider, graph.nodes.map((node) => node.id), {
      'tl-dispatch#1': dispatchReply('implementer', { class: 'small', review: 'standard' }),
      'tl-dispatch#2': dispatchReply('implementer', { class: 'large', review: 'thorough' }),
      'executive-continue#1': 'next-slice',
    }, (node, visit) => {
      if (node === 'implementer' && visit === 2) {
        // While visit 2 runs: the mark is visit 2's, and visit 1's row is closed with its own model.
        const rows = nodeVisitRows('two-visits', entries, 'implementer', false);
        seenAtSecond.push(nodeModelMark(implementer, entries)?.line ?? '', ...rows.map((row) => `${row.label}|${visitModelWords(row.model) ?? ''}|${String(row.ended)}`));
      }
    });
    const delivery = await runLiveGraph(graph, {
      runId: 'two-visits',
      repoRoot: root,
      outDir: null,
      resultsDir: path.join(scratch, 'results'),
      modelRequested: 'chat-model',
      personModel: 'chat-model',
      modelClasses: { small: 'model-small', large: 'model-large' },
      workspacePath: project,
      keepWorkspace: true,
      bindingKind: 'chat-loop',
      provider,
      createAdapter: () => agent as unknown as ChatAdapter,
      onJournalEntry: (entry) => entries.push(entry),
      promptFor: (node, step) => chatPromptFor(node, { entryId: graph.entry, mandate: 'Two slices.', step, role: (() => { const resolved = node.role === undefined ? null : resolveRole(node.role); return resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null }; })(), skipping: skippingRoutesOf(graph, node.id) }),
    });
    assert.equal(delivery.result.status, 'completed', delivery.journalText);
    // The adapter got each visit's model.
    assert.deepEqual(agent.modelsOf('implementer'), ['model-small', 'model-large']);
    assert.deepEqual(seenAtSecond, ['now: visit 2 · model-large', 'visit 1|Small · model-small|true', 'visit 2|Large · model-large|false']);
    // After the run: both visits, each with its own model, output and context; the mark says latest.
    const rows = nodeVisitRows('two-visits', entries, 'implementer', true);
    assert.deepEqual(rows.map((row) => [row.visit.occurrence, row.model?.modelClass, row.model?.model, row.model?.provider]), [[1, 'small', 'model-small', provider], [2, 'large', 'model-large', provider]]);
    assert.equal(nodeModelMark(implementer, entries)?.line, 'latest: visit 2 · model-large');
    assert.match(nodeModelMark(implementer, entries)?.detail ?? '', /^Latest visit: visit 2, model class Large, model model-large on /);
    const bodies = delivery.result.results.filter((item) => item.nodeId === 'implementer').map((item) => [item.occurrence, item.body]);
    assert.deepEqual(bodies.map(([occurrence]) => occurrence), [1, 2]);
    assert.match(String(bodies[0]?.[1]), /implementer visit 1 done/);
    assert.match(String(bodies[1]?.[1]), /implementer visit 2 done/);
    assert.doesNotMatch(String(bodies[1]?.[1]), /visit 1 done/);
    // The agent's context, as it really was: Claude switched the model in the node's session, so
    // visit 2 had visit 1's conversation; another agent opened a new session for the new model.
    assert.equal(rows[0]?.sessionContinued, false);
    assert.equal(rows[1]?.sessionContinued, provider === 'claude');
    assert.match(visitContextWords(rows[1]!) ?? '', provider === 'claude' ? /earlier conversation here was in its context.*not an independent review/ : /new session opened for this visit/);
  });
}
