/**
 * DSP-209 S3: a step skipped on purpose, declared on the edge, with the deciding step's
 * own reason, shown as its own state.
 *
 * One small drawing throughout: "decide" either sends the work through "check" (full) or
 * straight to "done" along an edge that skips "check" (quick). No provider turn; the
 * executor is scripted.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOOP_GRAPH_FORMAT,
  LOOP_GRAPH_FORMAT_VERSION,
  type LoopGraph,
} from '../src/shared/loop-graph';
import { checkLoopGraph, hasErrors, parseLoopGraph } from '../src/shared/loop-graph-load';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import {
  chatPromptFor,
  declaredOutcomeFrom,
  declaredReasonFrom,
  formatChatLiveLogLine,
  lookupFromGraph,
  skippingRoutesOf,
} from '../src/shared/loop-chat';
import { parseRunRecord, serialiseRecordLine } from '../src/shared/loop-record';
import { NO_SKIP_REASON, runLoopGraph, type StepExecutor, type StepProduct } from '../src/shared/loop-run';
import { nodeRunStateFor, nodeRunStates, runViewFor, type RunView } from '../src/shared/loop-run-view';

function graph(overrides: Partial<LoopGraph> = {}): LoopGraph {
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'skipping',
    name: 'Skipping loop',
    purpose: 'Decide whether the check is needed.',
    target: 'cursor',
    entry: 'decide',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [],
    nodes: [
      { id: 'decide', kind: 'human', label: 'Decide', outcomes: ['full', 'quick'] },
      { id: 'check', kind: 'human', label: 'Check the work' },
      { id: 'other', kind: 'human', label: 'Never visited' },
      { id: 'done', kind: 'terminal', label: 'Done' },
    ],
    edges: [
      { id: 'e-full', from: 'decide', to: 'check', when: { on: 'outcome', outcome: 'full' } },
      { id: 'e-quick', from: 'decide', to: 'done', when: { on: 'outcome', outcome: 'quick' }, skips: ['check'] },
      { id: 'e-check', from: 'check', to: 'done', when: { on: 'success' } },
      { id: 'e-other', from: 'other', to: 'done', when: { on: 'success' } },
    ],
    ...overrides,
  };
}

/** Each node produces what it is told to; `decide` also gives the reason, when there is one. */
function scripted(decision: StepProduct, reason?: string): StepExecutor {
  return async (context) => ({
    product: context.node.id === 'decide' ? decision : { kind: 'success' },
    summary: `scripted ${context.node.id}`,
    providerTurns: 0,
    ...(context.node.id === 'decide' && reason !== undefined ? { reason } : {}),
  });
}

function skipCodes(g: LoopGraph): string[] {
  return checkLoopGraph(g)
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code);
}

function withSkips(skips: readonly string[]): LoopGraph {
  const base = graph();
  return { ...base, edges: base.edges.map((edge) => (edge.id === 'e-quick' ? { ...edge, skips } : edge)) };
}

async function quickRun(reason?: string) {
  return runLoopGraph(graph(), {
    runId: 'skip-run',
    dryRun: true,
    executor: scripted({ kind: 'outcome', outcome: 'quick', source: 'step-declared' }, reason),
  });
}

function endedView(journal: RunView['entries']): RunView {
  return {
    ...runViewFor({
      runId: 'skip-run',
      graphVersionId: 'graph-skip',
      graphId: 'skipping',
      graphName: 'Skipping loop',
      binding: 'chat-loop',
      graphText: '{}',
      startedAtUtc: '2026-11-14T02:00:00.000Z',
    }),
    entries: journal,
    ended: true,
    status: 'completed',
  };
}

describe('skipping a step on purpose (DSP-209 S3)', () => {
  it('journals node-skipped with the reason from the step, or "no reason given"', async () => {
    const result = await quickRun('the change is\ndocumentation only');
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.path, ['decide', 'done']);
    const skips = result.journal.filter((entry) => entry.kind === 'node-skipped');
    assert.equal(skips.length, 1);
    assert.equal(skips[0]?.nodeId, 'check');
    assert.equal(skips[0]?.edgeId, 'e-quick');
    assert.deepEqual(skips[0]?.data, { decidedBy: 'decide', reason: 'the change is documentation only' });
    const edgeAt = result.journal.findIndex((entry) => entry.kind === 'edge-taken' && entry.edgeId === 'e-quick');
    assert.ok(edgeAt >= 0 && edgeAt < result.journal.indexOf(skips[0]!), 'after the edge it follows from');
    assert.deepEqual(result.skipped, [
      { nodeId: 'check', edgeId: 'e-quick', decidedBy: 'decide', reason: 'the change is documentation only' },
    ]);

    const silent = await quickRun();
    assert.equal(silent.skipped[0]?.reason, NO_SKIP_REASON);
    assert.equal(NO_SKIP_REASON, 'no reason given');
  });

  it('skips nothing on the route without skips, and chooses the same edges either way', async () => {
    const full = await runLoopGraph(graph(), {
      runId: 'full-run',
      dryRun: true,
      executor: scripted({ kind: 'outcome', outcome: 'full', source: 'step-declared' }),
    });
    assert.deepEqual(full.path, ['decide', 'check', 'done']);
    assert.deepEqual(full.skipped, []);
    assert.equal(full.journal.some((entry) => entry.kind === 'node-skipped'), false);
    const withoutField = await runLoopGraph(withSkips([]), {
      runId: 'no-field',
      dryRun: true,
      executor: scripted({ kind: 'outcome', outcome: 'quick', source: 'step-declared' }),
    });
    assert.deepEqual(withoutField.edgesTaken, (await quickRun()).edgesTaken);
  });

  it('marks the skipped node skipped in the run view, and leaves a node never visited not reached', async () => {
    const result = await quickRun('docs only');
    const states = nodeRunStates(endedView(result.journal));
    assert.equal(nodeRunStateFor(states, 'check'), 'skipped');
    assert.equal(nodeRunStateFor(states, 'other'), 'not-reached');
    assert.equal(nodeRunStateFor(states, 'decide'), 'finished');
  });

  it('refuses each kind of skip that cannot be right, with its own finding', () => {
    assert.deepEqual(skipCodes(graph()), [], 'the drawing itself is valid');
    assert.deepEqual(skipCodes(withSkips(['nowhere'])), ['skips-a-missing-node']);
    assert.deepEqual(skipCodes(withSkips(['done'])), ['skips-its-own-target']);
    assert.deepEqual(skipCodes(withSkips(['decide'])), ['skips-its-own-source']);
    const terminal = graph({
      nodes: [...graph().nodes, { id: 'other-end', kind: 'terminal', label: 'Other end' }],
      edges: [...graph().edges, { id: 'e-other-end', from: 'check', to: 'other-end', when: { on: 'outcome', outcome: 'x' } }],
    });
    assert.ok(
      skipCodes({ ...terminal, edges: terminal.edges.map((edge) => (edge.id === 'e-quick' ? { ...edge, skips: ['other-end'] } : edge)) }).includes('skips-a-terminal'),
    );
    const required = graph({
      nodes: graph().nodes.map((node) => (node.id === 'check' ? { ...node, required: true as const } : node)),
    });
    assert.deepEqual(skipCodes(required), ['skips-a-required-node']);
    const parsed = parseLoopGraph(JSON.stringify({ ...graph(), nodes: [{ ...graph().nodes[1], required: 'yes' }] }));
    assert.ok(parsed.findings.some((finding) => finding.code === 'bad-required'));
  });

  it('round-trips both fields through the file, and a drawing without them saves as before', () => {
    const required = graph({
      nodes: graph().nodes.map((node) => (node.id === 'check' ? { ...node, required: true as const } : node)),
      edges: graph().edges.map((edge) => (edge.id === 'e-quick' ? { ...edge, skips: ['other'] } : edge)),
    });
    const text = serialiseLoopGraph(required);
    const back = parseLoopGraph(text);
    assert.ok(back.ok);
    assert.equal(back.graph.nodes.find((node) => node.id === 'check')?.required, true);
    assert.deepEqual(back.graph.edges.find((edge) => edge.id === 'e-quick')?.skips, ['other']);
    assert.equal(serialiseLoopGraph(back.graph), text);

    const plain = withSkips([]);
    const plainText = serialiseLoopGraph({ ...plain, edges: plain.edges.map(({ skips: _skips, ...edge }) => edge) });
    assert.equal(plainText.includes('skips'), false);
    assert.equal(plainText.includes('required'), false);
    const reread = parseLoopGraph(plainText);
    assert.ok(reread.ok && !hasErrors(checkLoopGraph(reread.graph)));
    assert.equal(serialiseLoopGraph(reread.graph), plainText);
  });

  it('keeps a node-skipped line through a run record, and older records still read', async () => {
    const result = await quickRun('docs only');
    const skip = result.journal.find((entry) => entry.kind === 'node-skipped');
    assert.ok(skip !== undefined);
    const parsed = parseRunRecord(serialiseRecordLine({ line: 'journal', entry: skip }));
    assert.deepEqual(parsed.journal, [skip]);
    assert.equal(parsed.unreadableLines, 0);
  });

  it('says in the conversation that the step was skipped and why, never that it finished', async () => {
    const result = await quickRun('docs only');
    const skip = result.journal.find((entry) => entry.kind === 'node-skipped');
    assert.ok(skip !== undefined);
    const line = formatChatLiveLogLine(skip, lookupFromGraph(graph()));
    assert.equal(line, '“Check the work” skipped: docs only.');
    assert.doesNotMatch(line ?? '', /finished|passed|done|checked/i);
  });

  it('reads the reason after the outcome word, without changing which outcome is read', () => {
    const reply = 'Work done.\n**RESULT: quick — documentation only**';
    assert.equal(declaredOutcomeFrom(reply, ['full', 'quick'])?.outcome, 'quick');
    assert.equal(declaredReasonFrom(reply, 'quick'), 'documentation only');
    assert.equal(declaredReasonFrom('RESULT: quick', 'quick'), null);
    assert.equal(declaredReasonFrom('RESULT: full because', 'quick'), null);
  });

  it('tells only a step with a skipping outcome which steps it skips, and asks for a reason', () => {
    const g = graph();
    const decide = g.nodes[0]!;
    const check = g.nodes[1]!;
    const routes = skippingRoutesOf(g, 'decide');
    assert.deepEqual(routes, [{ outcome: 'quick', skips: ['"Check the work" (check)'] }]);
    const prompt = chatPromptFor(decide, { entryId: 'decide', mandate: 'Fix the README.', skipping: routes });
    assert.match(prompt, /Naming quick skips "Check the work" \(check\): that step is not run/);
    assert.match(prompt, /put a short reason after the name on the same line/);
    assert.doesNotMatch(prompt, /nothing else on that line:/);
    assert.equal(
      chatPromptFor(decide, { entryId: 'decide', mandate: 'Fix the README.', skipping: [] }),
      chatPromptFor(decide, { entryId: 'decide', mandate: 'Fix the README.' }),
      'an empty list changes nothing',
    );
    assert.deepEqual(skippingRoutesOf(g, 'check'), []);
    assert.equal(
      chatPromptFor(check, { entryId: 'decide', mandate: 'Fix the README.', skipping: skippingRoutesOf(g, 'check') }),
      chatPromptFor(check, { entryId: 'decide', mandate: 'Fix the README.' }),
    );
  });
});
