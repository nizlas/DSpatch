import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
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
import { runLoopGraph, type StepContext, type StepExecution } from '../src/shared/loop-run';
import { prepareBundled } from '../scripts/prepare-bundled.mjs';

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
  assert.equal(agents.length, 36);
  assert.equal(graph.edges.length, 140);
  assert.equal(new Set(agents.map((node) => node.role?.id)).size, 21);
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
  assert.equal(graph.nodes.filter((node) => node.kind === 'agent').length, 36);
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

for (const worker of ['implementer-s', 'implementer-m', 'implementer-l']) {
  test(`${worker} passes its actual contract and work through QA, review, challenge and acceptance`, async () => {
    const { result, seen } = await scriptedRun({ outcomes: { 'tl-dispatch': worker } });
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

for (const worker of ['researcher-m', 'researcher-l', 'explorer-s', 'explorer-m', 'data-curator', 'experiment-analyst', 'infra']) {
  test(`${worker} delivers only its executed branch to acceptance`, async () => {
    const { result, seen } = await scriptedRun({ outcomes: { 'tl-dispatch': worker } });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const body = receivedBy(seen, 'tl-accept').map((item) => item.body).join('\n');
    assert.match(body, /planner#1 evidence/);
    assert.ok(body.includes(`${worker}#1 evidence`));
    assert.ok(!body.includes('implementer-s#1 evidence'));
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
  for (const marker of ['planner#1 evidence', 'implementer-s#1 evidence', 'qa#1 evidence', 'reviewer-s#1 evidence']) {
    assert.ok(design.includes(marker));
  }
  const escalated = await scriptedRun({ outcomes: { 'skeptic-s': 'escalate' } });
  assert.equal(escalated.result.status, 'completed', escalated.result.fault?.detail ?? '');
  const skeptic = receivedBy(escalated.seen, 'skeptic').map((item) => item.body).join('\n');
  for (const marker of ['planner#1 evidence', 'implementer-s#1 evidence', 'qa#1 evidence', 'reviewer-s#1 evidence', 'skeptic-s#1 evidence']) {
    assert.ok(skeptic.includes(marker));
  }
});

test('QA rework carries the failure forward and later review receives the new worker visit', async () => {
  const { result, seen } = await scriptedRun({ outcomes: { 'qa#1': 'fail', 'qa#2': 'pass' } });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const dispatch = seen.filter((item) => item.node.id === 'tl-dispatch')[1];
  assert.ok(dispatch?.received.some((item) => item.nodeId === 'qa' && item.body.includes('qa#1 evidence')));
  const reviewer = receivedBy(seen, 'reviewer-s').find((item) => item.nodeId === 'qa');
  assert.ok(reviewer?.body.includes('implementer-s#2 evidence'));
  assert.equal(reviewer?.occurrence, 2);
});

test('a worker failure reaches dispatch with its contract and reported state', async () => {
  const { result, seen } = await scriptedRun({
    failures: { 'implementer-s#1': 'research-needed' },
    bodies: { 'implementer-s#1': 'Evidence needed; no change reported.' },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const dispatch = seen.filter((item) => item.node.id === 'tl-dispatch')[1];
  const worker = dispatch?.received.find((item) => item.nodeId === 'implementer-s');
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
      if (node === 'implementer-s') output.work = `work-${context.occurrence}`;
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