import assert from 'node:assert/strict';
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
import { modelSelectionData, modelSelectionFromData, runLoopGraph, type StepContext, type StepExecution } from '../src/shared/loop-run';
import { prepareBundled } from '../scripts/prepare-bundled.mjs';
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
  assert.equal(agents.length, 34);
  assert.equal(graph.edges.length, 130);
  assert.equal(new Set(agents.map((node) => node.role?.id)).size, 19);
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
  assert.equal(graph.nodes.filter((node) => node.kind === 'agent').length, 34);
  for (const file of [definitionPath, graphPath, ...fs.readdirSync(path.join(root, roleDirectory)).map((name) => `${roleDirectory}/${name}`)]) {
    assert.deepEqual(fs.readFileSync(path.join(bundled, file)), fs.readFileSync(path.join(root, file)), file);
  }
});

const defaultOutcomes: Record<string, string> = {
  'executive-intake': 'select-slice',
  'tl-select': 'slice-selected',
  'reviewer-s-plan-gate': 'accept',
  'tl-dispatch': 'implementer-s',
  infra: 'done',
  qa: 'pass',
  'qa-design': 'pass',
  'reviewer-s': 'accept',
  'reviewer-l': 'accept',
  'skeptic-s': 'pass',
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
} = {}) {
  const graph = load(root);
  const seen: StepContext[] = [];
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
    resultStore: store,
    executor: async (context): Promise<StepExecution> => {
      seen.push(context);
      const node = context.node.id;
      const key = `${node}#${context.occurrence}`;
      const failure = options.failures?.[key] ?? options.failures?.[node];
      const outcome = options.outcomes?.[key] ?? options.outcomes?.[node] ?? defaultOutcomes[node];
      const product: StepExecution['product'] = failure !== undefined
        ? { kind: 'declared-failure', failure }
        : outcome !== undefined
          ? { kind: 'outcome', outcome, source: 'step-declared' }
          : { kind: 'success' };
      const received = [...new Set(context.received.flatMap((item) => item.body.split('\n')).filter((line) => /^[a-z-]+#\d+ evidence$/.test(line) || Object.values(options.bodies ?? {}).includes(line)))].join('\n');
      return {
        product,
        summary: `Scripted ${node}`,
        providerTurns: 0,
        resultBody: `${node}#${context.occurrence} evidence\n${options.bodies?.[key] ?? options.bodies?.[node] ?? ''}\n${received}`,
      };
    },
  });
  return { result, seen };
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

/** DSP-222: the node a dispatch outcome runs: the small and medium variants are one node each. */
function workerNode(outcome: string): string {
  return outcome === 'implementer-s' || outcome === 'implementer-m' ? 'implementer' : outcome === 'explorer-s' || outcome === 'explorer-m' ? 'explorer' : outcome;
}

for (const outcome of ['implementer-s', 'implementer-m', 'implementer-l']) {
  const worker = workerNode(outcome);
  test(`${outcome} passes its actual contract and work through QA, review, challenge and acceptance`, async () => {
    const { result, seen } = await scriptedRun({ outcomes: { 'tl-dispatch': outcome } });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const qa = worker === 'implementer-l' ? 'qa-design' : 'qa';
    const reviewer = worker === 'implementer-l' ? 'reviewer-l' : 'reviewer-s';
    const skeptic = worker === 'implementer-l' ? 'skeptic' : 'skeptic-s';
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
  });
}

for (const outcome of ['researcher-m', 'researcher-l', 'explorer-s', 'explorer-m', 'data-curator', 'experiment-analyst', 'infra']) {
  const worker = workerNode(outcome);
  test(`${outcome} delivers only its executed branch to acceptance`, async () => {
    const { result, seen } = await scriptedRun({ outcomes: { 'tl-dispatch': outcome } });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const body = receivedBy(seen, 'tl-accept').map((item) => item.body).join('\n');
    assert.match(body, /planner#1 evidence/);
    assert.ok(body.includes(`${worker}#1 evidence`));
    assert.ok(!body.includes('implementer#1 evidence'));
  });
}

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

test('design review and skeptic escalation carry the actual prior evidence', async () => {
  const { result, seen } = await scriptedRun({ outcomes: { 'reviewer-s': 'design-review', 'skeptic': 'pass' } });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const design = receivedBy(seen, 'reviewer-l').map((item) => item.body).join('\n');
  for (const marker of ['planner#1 evidence', 'implementer#1 evidence', 'qa#1 evidence', 'reviewer-s#1 evidence']) {
    assert.ok(design.includes(marker));
  }
  const escalated = await scriptedRun({ outcomes: { 'skeptic-s': 'escalate' } });
  assert.equal(escalated.result.status, 'completed', escalated.result.fault?.detail ?? '');
  const skeptic = receivedBy(escalated.seen, 'skeptic').map((item) => item.body).join('\n');
  for (const marker of ['planner#1 evidence', 'implementer#1 evidence', 'qa#1 evidence', 'reviewer-s#1 evidence', 'skeptic-s#1 evidence']) {
    assert.ok(skeptic.includes(marker));
  }
});

test('QA rework carries the failure forward and later review receives the new worker visit', async () => {
  const { result, seen } = await scriptedRun({ outcomes: { 'qa#1': 'fail', 'qa#2': 'pass' } });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const dispatch = seen.filter((item) => item.node.id === 'tl-dispatch')[1];
  assert.ok(dispatch?.received.some((item) => item.nodeId === 'qa' && item.body.includes('qa#1 evidence')));
  const reviewer = receivedBy(seen, 'reviewer-s').find((item) => item.nodeId === 'qa');
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
  const { result, seen } = await scriptedRun({ outcomes: { 'reviewer-s': 'rework' }, maxReworkRounds: 1, routeLimit: true });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.deepEqual(result.limitsReached, ['maxReworkRounds']);
  assert.equal(seen.filter((item) => item.node.id === 'reviewer-s').length, 2);
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
  /** DSP-222: the model each turn of a node was sent with, in order. */
  private readonly sessionModel = new Map<string, string>();
  private readonly turnModels = new Map<string, string[]>();
  constructor(provider: RunProvider, nodeIds: readonly string[], outcomes: Readonly<Record<string, string>> = {}) {
    this.provider = provider;
    this.nodeIds = nodeIds;
    this.outcomes = outcomes;
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
    const outcome = this.outcomes[`${node}#${String(visit)}`] ?? defaultOutcomes[node] ?? 'succeeded';
    const runId = `${sessionId}-${String(this.prompts.get(node)?.length ?? 0)}`;
    const emit = (event: Partial<AgentEvent>): void => {
      this.listeners.get(sessionId)?.({ dspatchSessionId: sessionId, dspatchRunId: runId, at: new Date().toISOString(), rawProviderEvent: null, ...event } as AgentEvent);
    };
    setImmediate(() => {
      emit({ type: 'run.started' });
      emit({ type: 'assistant.message', text: `${node} done.\n\nRESULT: ${outcome}` } as Partial<AgentEvent>);
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
    for (const node of ['tl-dispatch', 'implementer', 'qa', 'reviewer-s', 'tl-accept', 'documenter-wrapup', 'executive-report']) {
      assert.ok(agent.prompts.has(node), `${node} ran`);
    }
  });
}

/* DSP-222: the small and medium variants as one node each, with a model class per visit. */

test('DSP-222: implementer and explorer variants run as one node each, the class chosen by the dispatch route', () => {
  const graph = load(root);
  const ids = graph.nodes.map((node) => node.id);
  for (const gone of ['implementer-s', 'implementer-m', 'explorer-s', 'explorer-m']) {
    assert.ok(!ids.includes(gone), `${gone} is merged`);
  }
  for (const id of ['implementer', 'explorer']) {
    const node = graph.nodes.find((item) => item.id === id);
    assert.equal(node?.model?.policy, 'select');
    assert.deepEqual(node?.model?.options?.map((option) => option.modelClass), ['small', 'medium']);
    assert.ok(node?.model?.options?.every((option) => option.model === undefined), 'the generic graph names no concrete model');
  }
  const outcomeOf = (edge: (typeof graph.edges)[number]): string => ('outcome' in edge.when ? String(edge.when.outcome) : edge.when.on);
  const chosen = graph.edges
    .filter((edge) => edge.from === 'tl-dispatch' && edge.selectsModel !== undefined)
    .map((edge) => `${outcomeOf(edge)}->${edge.to}:${edge.selectsModel ?? ''}`)
    .sort();
  assert.deepEqual(chosen, ['explorer-m->explorer:medium', 'explorer-s->explorer:small', 'implementer-m->implementer:medium', 'implementer-s->implementer:small']);
  // The large implementer keeps its own path through design QA and the large review.
  assert.ok(graph.edges.some((edge) => edge.from === 'implementer-l' && edge.to === 'qa-design'));
  // A merged node's routes are those of either variant, once.
  for (const id of ['implementer', 'explorer']) {
    const routes = graph.edges.filter((edge) => edge.from === id).map((edge) => `${outcomeOf(edge)}${'failure' in edge.when ? String(edge.when.failure) : ''}->${edge.to}`);
    assert.equal(new Set(routes).size, routes.length, `${id}: ${routes.join(', ')}`);
    assert.equal(routes.length, 5);
  }
  assert.match(graph.nodes.find((node) => node.id === 'tl-dispatch')?.purpose ?? '', /Model class policy/);
});

test('DSP-222: the class varies between slices and each visit records class, model and reason', async () => {
  const graph = load(root);
  const entries: { nodeId?: string; kind: string; data?: Readonly<Record<string, string | number | boolean>> }[] = [];
  const store = createMemoryResultStore((text) => createHash('sha256').update(text).digest('hex'));
  const result = await runLoopGraph(graph, {
    runId: 'model-classes',
    dryRun: false,
    maxTransitions: 100,
    resultStore: store,
    runModel: { provider: 'copilot', model: 'person-model', classes: { small: 'model-for-small', medium: 'model-for-medium' } },
    onJournalEntry: (entry) => entries.push(entry),
    executor: async (context): Promise<StepExecution> => {
      const node = context.node.id;
      const outcome =
        node === 'tl-dispatch' ? (context.occurrence === 1 ? 'implementer-s' : 'implementer-m')
          : node === 'executive-continue' && context.occurrence === 1 ? 'next-slice'
            : defaultOutcomes[node];
      return {
        product: outcome === undefined ? { kind: 'success' } : { kind: 'outcome', outcome, source: 'step-declared' },
        summary: node,
        providerTurns: 0,
        resultBody: `${node}#${context.occurrence}`,
        ...(node === 'tl-dispatch' ? { reason: context.occurrence === 1 ? 'one localized fix' : 'the same pattern in four places' } : {}),
      };
    },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const visits = entries.filter((entry) => entry.kind === 'node-entered' && entry.nodeId === 'implementer').map((entry) => modelSelectionFromData(entry.data));
  assert.equal(visits.length, 2);
  assert.deepEqual(visits.map((visit) => [visit?.modelClass, visit?.model, visit?.source]), [['small', 'model-for-small', 'policy'], ['medium', 'model-for-medium', 'policy']]);
  assert.match(visits[0]?.reason ?? '', /one localized fix/);
  assert.match(visits[1]?.reason ?? '', /the same pattern in four places/);
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
  assert.match(prepared.classNote ?? '', /Model class small has no model configured for Copilot, so that class runs with person-model/);
  const data = modelSelectionData(
    graph.nodes.find((node) => node.id === 'implementer')!,
    graph.edges.find((edge) => edge.from === 'tl-dispatch' && edge.selectsModel === 'small') ?? null,
    'one localized fix',
    { provider: 'copilot', model: 'person-model', classes: prepared.modelClasses },
  );
  assert.equal(data['model'], 'person-model');
  assert.equal(data['modelClass'], 'small');
  assert.match(String(data['modelReason']), /class small has no model configured for copilot, so the model chosen for the run ran/);
});

test('DSP-222: on the live path the class\'s model reaches the adapter, and a revisit with another class gets its model', async (context) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-generic-classes-'));
  context.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const project = path.join(scratch, 'project');
  fs.mkdirSync(project);
  const graph = load(root);
  const resolveRole = createFileRoleResolver(root);
  const agent = new NetworkAgent('copilot', graph.nodes.map((node) => node.id), {
    'tl-dispatch#1': 'implementer-s',
    'tl-dispatch#2': 'implementer-m',
    'executive-continue#1': 'next-slice',
  });
  const delivery = await runLiveGraph(graph, {
    runId: 'generic-classes',
    repoRoot: root,
    outDir: null,
    resultsDir: path.join(scratch, 'results'),
    modelRequested: 'person-model',
    personModel: 'person-model',
    modelClasses: { small: 'model-for-small', medium: 'model-for-medium' },
    workspacePath: project,
    keepWorkspace: true,
    bindingKind: 'chat-loop',
    provider: 'copilot',
    createAdapter: () => agent as unknown as ChatAdapter,
    promptFor: (node, step) => chatPromptFor(node, { entryId: graph.entry, mandate: 'Two slices.', step, role: (() => { const resolved = node.role === undefined ? null : resolveRole(node.role); return resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null }; })(), skipping: skippingRoutesOf(graph, node.id) }),
  });
  assert.equal(delivery.result.status, 'completed', delivery.journalText);
  assert.deepEqual(agent.modelsOf('implementer'), ['model-for-small', 'model-for-medium']);
  assert.ok(agent.modelsOf('qa').every((model) => model === 'person-model'), 'a step without a policy keeps the chat\'s model');
});

test('DSP-222: an option names a model or a known class, never both and never an unknown class', () => {
  const text = fs.readFileSync(path.join(root, graphPath), 'utf8');
  const resolveRole = createFileRoleResolver(root);
  for (const bad of ['{ "id": "small", "modelClass": "small", "model": "x" }', '{ "id": "small", "modelClass": "tiny" }', '{ "id": "small" }']) {
    const json = JSON.parse(text);
    json.nodes.find((node: { id: string }) => node.id === 'implementer').model.options[0] = JSON.parse(bad);
    const loaded = loadLoopGraph(JSON.stringify(json), { resolveRole });
    assert.equal(loaded.ok, false, bad);
    assert.ok(!loaded.ok && loaded.findings.some((finding) => finding.code === 'bad-model-option'), bad);
  }
});
