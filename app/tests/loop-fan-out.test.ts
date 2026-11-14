/**
 * DSP-209 S10a: the `fanOut` field — loaded, validated, saved — and the runner's refusal to
 * run a fan-out node before S10b, so no ordinary step ever stands in for its branches.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LOOP_GRAPH_FORMAT, LOOP_GRAPH_FORMAT_VERSION, type LoopGraph, type LoopNode } from '../src/shared/loop-graph';
import { checkLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import { createMemoryResultStore } from '../src/shared/loop-results';
import { runLoopGraph, type StepExecutor } from '../src/shared/loop-run';

const role = { id: 'r', source: { kind: 'role-source' as const, path: 'docs/loop/roles/r.role.md' } };

function graph(work: Partial<LoopNode> = {}, overrides: Partial<LoopGraph> = {}): LoopGraph {
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'fan',
    name: 'Fan-out',
    purpose: 'Slice, implement in parallel, integrate.',
    target: 'cursor',
    entry: 'slice',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [{ id: 'branch-failed', label: 'branch failed', meaning: 'A branch or the slice block failed.' }],
    nodes: [
      { id: 'slice', kind: 'agent', label: 'Slice', role, produces: { required: true, form: 'stored-result' } },
      {
        id: 'work',
        kind: 'agent',
        label: 'Implement',
        role,
        declaredFailures: ['branch-failed'],
        fanOut: { slicesFrom: 'slice', maxConcurrent: 2, isolation: 'worktree' },
        ...work,
      },
      { id: 'integrate', kind: 'agent', label: 'Integrate', role },
      { id: 'done', kind: 'terminal', label: 'Done' },
      { id: 'failed', kind: 'terminal', label: 'Failed', ending: 'not-success' },
    ],
    edges: [
      { id: 'e1', from: 'slice', to: 'work', when: { on: 'success' } },
      { id: 'e2', from: 'work', to: 'integrate', when: { on: 'success' } },
      { id: 'e3', from: 'work', to: 'failed', when: { on: 'declared-failure', failure: 'branch-failed' } },
      { id: 'e4', from: 'integrate', to: 'done', when: { on: 'success' } },
    ],
    ...overrides,
  };
}

/** Error codes, leaving out the fixture's own unresolvable role reference. */
function errors(g: LoopGraph): string[] {
  return checkLoopGraph(g)
    .filter((finding) => finding.severity === 'error' && !/role/.test(finding.code))
    .map((finding) => finding.code);
}

function parsedErrors(value: unknown): string[] {
  return parseLoopGraph(JSON.stringify(value)).findings.filter((finding) => finding.severity === 'error').map((finding) => finding.code);
}

describe('fanOut in the format (DSP-209 S10a)', () => {
  it('loads a valid fan-out, round-trips it, and no longer calls it unhonoured (S10b runs it)', () => {
    const text = serialiseLoopGraph(graph());
    const back = parseLoopGraph(text);
    assert.ok(back.ok, back.ok ? '' : JSON.stringify(back.findings));
    assert.deepEqual(back.graph.nodes[1]?.fanOut, { slicesFrom: 'slice', maxConcurrent: 2, isolation: 'worktree' });
    assert.equal(serialiseLoopGraph(back.graph), text);
    assert.match(text, /"fanOut": \{ "slicesFrom": "slice", "maxConcurrent": 2, "isolation": "worktree" \}/);
    assert.deepEqual(errors(back.graph), []);
    const notice = checkLoopGraph(back.graph).find((finding) => finding.code === 'not-yet-honoured' && finding.message.includes('"fanOut"'));
    assert.equal(notice, undefined, 'S10b honours it, so the notice is gone');
  });

  it('refuses each misuse with its own finding', () => {
    // On a non-agent, and a malformed value: refused while parsing.
    const base = JSON.parse(serialiseLoopGraph(graph())) as { nodes: Record<string, unknown>[] };
    const onTerminal = structuredClone(base);
    onTerminal.nodes[3]!['fanOut'] = { slicesFrom: 'slice', maxConcurrent: 1, isolation: 'worktree' };
    assert.ok(parsedErrors(onTerminal).includes('fan-out-on-a-non-agent'));
    for (const bad of [{ slicesFrom: 'slice', maxConcurrent: 4, isolation: 'worktree' }, { slicesFrom: 'slice', maxConcurrent: 0, isolation: 'worktree' }, { slicesFrom: 'slice', maxConcurrent: 2, isolation: 'copy' }, { maxConcurrent: 2, isolation: 'worktree' }, 'yes']) {
      const malformed = structuredClone(base);
      malformed.nodes[1]!['fanOut'] = bad;
      assert.ok(parsedErrors(malformed).includes('bad-fan-out'), JSON.stringify(bad));
    }

    // Against the drawing.
    assert.deepEqual(errors(graph({ fanOut: { slicesFrom: 'nowhere', maxConcurrent: 2, isolation: 'worktree' } })), ['fan-out-slices-from-unusable']);
    assert.deepEqual(errors(graph({ fanOut: { slicesFrom: 'integrate', maxConcurrent: 2, isolation: 'worktree' } })).includes('fan-out-slices-from-unusable'), true, 'a node that runs after it');
    const noResult = graph({}, { nodes: graph().nodes.map((node) => (node.id === 'slice' ? { ...node, produces: undefined } : node)) as LoopNode[] });
    assert.ok(errors(noResult).includes('fan-out-slices-from-unusable'));
    assert.ok(errors(graph({ capabilities: ['suggest-interactive'] })).includes('fan-out-with-handoff'));
    const noRoute = graph({}, { edges: graph().edges.filter((edge) => edge.id !== 'e3') });
    assert.ok(errors(noRoute).includes('fan-out-without-branch-failed'));
  });

  it('saves a drawing without fanOut exactly as before', () => {
    const plain = graph();
    const { fanOut: _fanOut, ...work } = plain.nodes[1]!;
    const without = { ...plain, nodes: plain.nodes.map((node) => (node.id === 'work' ? (work as LoopNode) : node)) };
    const text = serialiseLoopGraph(without);
    assert.equal(text.includes('fanOut'), false);
    const back = parseLoopGraph(text);
    assert.ok(back.ok);
    assert.equal(serialiseLoopGraph(back.graph), text);
  });
});

describe('a run reaching a fan-out node (DSP-209 S10a, as changed by S10b)', () => {
  it('never runs it as one ordinary step: with no slice block it ends as branch-failed, having started no branch', async () => {
    const ran: string[] = [];
    const executor: StepExecutor = async (context) => {
      ran.push(context.instance === undefined ? context.node.id : `${context.node.id}/${context.instance.sliceId}`);
      return { product: { kind: 'success' }, summary: 'scripted', providerTurns: 0, resultBody: 'slices' };
    };
    const result = await runLoopGraph(graph(), {
      runId: 'fan-1',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      executor,
    });
    assert.deepEqual(ran, ['slice'], 'the fan-out node was not executed as an ordinary step, and no branch started');
    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'failed');
    assert.equal(result.journal.some((entry) => entry.kind === 'branch-started'), false);
    const produced = result.journal.find((entry) => entry.kind === 'node-produced' && entry.nodeId === 'work');
    assert.match(produced?.detail ?? '', /no fenced `dspatch-slices` block/);
  });
});
