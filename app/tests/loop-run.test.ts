/**
 * DSP-18's first increment, tested on the graph we actually use.
 *
 * Every test here runs the real `docs/loop/graphs/dspatch-development-loop.graph.json`
 * rather than a fixture, because the criterion is that *this* loop runs, and because
 * a fixture would have let the runner and the format drift apart without anything
 * noticing. The one exception is the variant graph, which is this file with exactly
 * one edge redirected — that is the test for "changing the drawing changes the run".
 *
 * Nothing here can spend a provider turn: every run is driven by
 * `createDryRunExecutor`, which has no provider to call, and one test asserts that
 * an executor wired to a provider that throws on contact is never reached.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import type { LoopGraph } from '../src/shared/loop-graph';
import {
  createClock,
  createDryRunExecutor,
  formatJournalEntry,
  formatRunJournal,
  journalToJsonl,
  runLoopGraph,
  type RunJournalEntry,
  type StepExecutor,
} from '../src/shared/loop-run';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const graphPath = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json');

function loadDevelopmentLoop(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(graphPath, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, 'the development loop graph must be valid before it can be run');
  return loaded.graph;
}

/** The same graph with one edge pointing somewhere else, and nothing else changed. */
function withRedirectedEdge(graph: LoopGraph, edgeId: string, to: string): LoopGraph {
  const found = graph.edges.some((edge) => edge.id === edgeId);
  assert.ok(found, `edge ${edgeId} must exist for this test to mean anything`);
  return {
    ...graph,
    edges: graph.edges.map((edge) => (edge.id === edgeId ? { ...edge, to } : edge)),
  };
}

/** The scripted decisions that walk the ordinary path: mandate, code, verify, accept. */
const HAPPY_PATH = [
  { node: 'niclas-mandate', produce: { kind: 'outcome' as const, outcome: 'start' } },
  { node: 'route-next-step', produce: { kind: 'outcome' as const, outcome: 'implement' } },
  { node: 'implementation-review', produce: { kind: 'outcome' as const, outcome: 'accept' } },
  { node: 'niclas-assessment', produce: { kind: 'outcome' as const, outcome: 'accept' } },
];

describe('runLoopGraph — walking our own development loop', () => {
  it('starts at the entry, follows matching edges and stops at a terminal', async () => {
    const graph = loadDevelopmentLoop();
    const clock = createClock();
    const result = await runLoopGraph(graph, {
      runId: 'test-happy-path',
      dryRun: true,
      now: clock.now,
      executor: createDryRunExecutor({ decisions: HAPPY_PATH, clock }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'run-complete');
    assert.equal(result.path[0], 'niclas-mandate', 'the run must start at the graph entry');
    assert.deepEqual(result.path, [
      'niclas-mandate',
      'coordinator',
      'route-next-step',
      'implementer',
      'verifier',
      'implementation-review',
      'coordinator-report',
      'niclas-assessment',
      'run-complete',
    ]);
    assert.deepEqual(result.edgesTaken, ['e01', 'e03', 'e08', 'e18', 'e22', 'e24', 'e29', 'e30']);
    assert.equal(result.fault, null);
    assert.deepEqual(result.limitsReached, []);
  });

  it('spends nothing in a dry run, and cannot reach a provider at all', async () => {
    const graph = loadDevelopmentLoop();
    const providerContact: StepExecutor = () => {
      throw new Error('a dry run must not reach a provider');
    };
    void providerContact;

    const result = await runLoopGraph(graph, {
      runId: 'test-costs-nothing',
      dryRun: true,
      executor: createDryRunExecutor({ decisions: HAPPY_PATH }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.usage.providerTurns, 0, 'a dry run spends no provider turns');
    assert.equal(result.dryRun, true);
    // Five nodes of kinds agent/gate/external were executed — coordinator,
    // implementer, verifier, implementation-review and the coordinator's report. The
    // two human steps and the router are not calls, and the terminal is not executed.
    assert.equal(result.usage.calls, 5);
    assert.equal(result.usage.nodesExecuted, 8);
  });

  it('journals every transition with the node, the edge, the reason and the time', async () => {
    const graph = loadDevelopmentLoop();
    const streamed: RunJournalEntry[] = [];
    const result = await runLoopGraph(graph, {
      runId: 'test-journal',
      dryRun: true,
      executor: createDryRunExecutor({ decisions: HAPPY_PATH }),
      onJournalEntry: (entry) => streamed.push(entry),
    });

    // Streamed as it happens, not assembled at the end: an interrupted run still
    // leaves the part that did happen.
    assert.deepEqual(
      streamed.map((entry) => entry.seq),
      result.journal.map((entry) => entry.seq),
    );

    const entered = result.journal.filter((entry) => entry.kind === 'node-entered');
    const produced = result.journal.filter((entry) => entry.kind === 'node-produced');
    const taken = result.journal.filter((entry) => entry.kind === 'edge-taken');
    assert.equal(taken.length, result.edgesTaken.length);
    assert.equal(produced.length, result.usage.nodesExecuted);
    assert.ok(entered.length >= produced.length);
    assert.equal(result.journal[0]?.kind, 'run-started');
    assert.equal(result.journal.at(-1)?.kind, 'run-ended');

    for (const entry of taken) {
      assert.ok(entry.edgeId, 'an edge-taken entry names its edge');
      assert.ok(entry.detail.length > 20, 'and says why in a sentence a person can read');
      assert.equal(entry.data?.runtimeFault, false);
    }

    const text = formatRunJournal(result);
    assert.ok(text.includes(formatJournalEntry(result.journal[0]!)));
    assert.match(text, /^run {8}test-journal$/m);
    assert.match(text, /edge-taken {5}edge e08/);
    assert.match(text, /status {5}completed/);
    // Every entry round-trips as one JSON object per line.
    const lines = journalToJsonl(result).trim().split('\n');
    assert.equal(lines.length, result.journal.length);
    assert.equal(JSON.parse(lines[0] ?? '{}').kind, 'run-started');
  });
});

describe('runLoopGraph — declared failures route', () => {
  it("takes the graph's declared-failure edge and records which one and why", async () => {
    const graph = loadDevelopmentLoop();
    const result = await runLoopGraph(graph, {
      runId: 'test-declared-failure',
      dryRun: true,
      executor: createDryRunExecutor({
        decisions: [
          ...HAPPY_PATH,
          {
            node: 'implementer',
            occurrence: 1,
            produce: { kind: 'declared-failure', failure: 'spec-error' },
          },
          { node: 'plan-review', produce: { kind: 'outcome', outcome: 'accept' } },
          { node: 'route-next-step', occurrence: 2, produce: { kind: 'outcome', outcome: 'wrap-up' } },
        ],
      }),
    });

    assert.equal(result.status, 'completed');
    // e19 is the dashed arrow: implementer --spec-error--> backlog-planner.
    assert.ok(result.edgesTaken.includes('e19'), 'the declared failure must route as drawn');
    assert.deepEqual(result.path.slice(0, 6), [
      'niclas-mandate',
      'coordinator',
      'route-next-step',
      'implementer',
      'backlog-planner',
      'plan-review',
    ]);

    const routed = result.journal.find((entry) => entry.edgeId === 'e19');
    assert.ok(routed, 'the journal records the edge a declared failure took');
    assert.equal(routed.data?.when, 'declared-failure');
    assert.equal(routed.data?.failure, 'spec-error');
    assert.equal(routed.data?.declaredFailure, true);
    assert.equal(routed.data?.runtimeFault, false, 'and keeps it apart from a runtime fault');
    assert.match(routed.detail, /declared failure "spec-error"/);
    assert.match(routed.detail, /routed decision, not a broken step/);
  });

  it('changes where a failure goes when one edge in the drawing is changed', async () => {
    const original = loadDevelopmentLoop();
    // One edge, redirected: the specification error now escalates to Niclas instead
    // of going back to planning. Nothing else about the graph differs.
    const variant = withRedirectedEdge(original, 'e19', 'niclas-decision');

    const decisions = [
      ...HAPPY_PATH,
      {
        node: 'implementer',
        occurrence: 1,
        produce: { kind: 'declared-failure' as const, failure: 'spec-error' },
      },
      { node: 'plan-review', produce: { kind: 'outcome' as const, outcome: 'accept' } },
      { node: 'niclas-decision', produce: { kind: 'outcome' as const, outcome: 'deferred' } },
      {
        node: 'route-next-step',
        occurrence: 2,
        produce: { kind: 'outcome' as const, outcome: 'wrap-up' },
      },
    ];

    const before = await runLoopGraph(original, {
      runId: 'test-variant-before',
      dryRun: true,
      executor: createDryRunExecutor({ decisions }),
    });
    const after = await runLoopGraph(variant, {
      runId: 'test-variant-after',
      dryRun: true,
      executor: createDryRunExecutor({ decisions }),
    });

    assert.equal(before.path[4], 'backlog-planner');
    assert.equal(after.path[4], 'niclas-decision', 'the redirected edge changes where the run goes');
    assert.ok(before.edgesTaken.includes('e19'));
    assert.ok(after.edgesTaken.includes('e19'));
    assert.notDeepEqual(before.path, after.path);
    assert.equal(after.status, 'completed');
  });

  it('refuses to route a failure a node never declared', async () => {
    const graph = loadDevelopmentLoop();
    const result = await runLoopGraph(graph, {
      runId: 'test-undeclared',
      dryRun: true,
      executor: createDryRunExecutor({
        decisions: [
          ...HAPPY_PATH,
          { node: 'verifier', produce: { kind: 'declared-failure', failure: 'spec-error' } },
        ],
      }),
    });

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'undeclared-product');
    assert.equal(result.fault?.nodeId, 'verifier');
    assert.match(result.fault?.detail ?? '', /does not declare/);
    assert.ok(!result.edgesTaken.includes('e23'), 'nothing was routed on an undeclared failure');
  });
});

describe('runLoopGraph — runtime faults belong to the runner', () => {
  it("stops and reconciles when a step outruns its own maxMinutes, and routes nothing", async () => {
    const graph = loadDevelopmentLoop();
    const clock = createClock();
    const result = await runLoopGraph(graph, {
      runId: 'test-timeout',
      dryRun: true,
      now: clock.now,
      executor: createDryRunExecutor({
        clock,
        decisions: [
          ...HAPPY_PATH,
          // The Implementer node is bounded at 90 minutes in the graph.
          { node: 'implementer', minutes: 240, produce: { kind: 'success' } },
        ],
      }),
    });

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'step-timed-out');
    assert.equal(result.fault?.nodeId, 'implementer');
    assert.match(result.fault?.detail ?? '', /bounded at 90 minutes and took 240/);
    assert.match(result.fault?.reconcile ?? '', /stop-and-reconcile/);
    assert.match(result.fault?.reconcile ?? '', /real outcome is unknown/);

    // The distinction the whole design exists for: not a declared failure, and no
    // edge was taken out of the timed-out node.
    assert.ok(!result.edgesTaken.includes('e18'));
    const fault = result.journal.find((entry) => entry.kind === 'runtime-fault');
    assert.equal(fault?.data?.routed, false);
    assert.equal(fault?.data?.fault, 'step-timed-out');
    assert.equal(fault?.data?.onRuntimeFault, 'stop-and-reconcile');
    assert.equal(
      result.journal.some(
        (entry) => entry.kind === 'edge-taken' && entry.data?.from === 'implementer',
      ),
      false,
    );
    assert.equal(
      graph.failureKinds.some((kind) => kind.id === 'step-timed-out'),
      false,
      'and a timeout is not in the graph vocabulary at all',
    );
  });

  it('records an executor that threw as a fault with an unknown outcome', async () => {
    const graph = loadDevelopmentLoop();
    const result = await runLoopGraph(graph, {
      runId: 'test-threw',
      dryRun: true,
      executor: async (context) => {
        if (context.node.id === 'implementer') {
          throw new Error('the call never came back');
        }
        return createDryRunExecutor({ decisions: HAPPY_PATH })(context);
      },
    });

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'executor-threw');
    assert.match(result.fault?.detail ?? '', /the call never came back/);
    assert.equal(result.journal.at(-2)?.kind, 'runtime-fault');
  });

  it('faults rather than guesses when nothing leaves a node for what it produced', async () => {
    const graph = loadDevelopmentLoop();
    // A graph that validation would refuse: the success edge out of the verifier is
    // removed, so the run arrives somewhere with nowhere to go.
    const broken: LoopGraph = { ...graph, edges: graph.edges.filter((edge) => edge.id !== 'e22') };
    const result = await runLoopGraph(broken, {
      runId: 'test-no-edge',
      dryRun: true,
      executor: createDryRunExecutor({ decisions: HAPPY_PATH }),
    });

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'no-edge-for-product');
    assert.match(result.fault?.detail ?? '', /no success edge leaves it/);
  });

  it('refuses to start, rather than faulting, when the entry is not a node', async () => {
    const graph = loadDevelopmentLoop();
    const result = await runLoopGraph({ ...graph, entry: 'nowhere' }, {
      runId: 'test-refused',
      dryRun: true,
      executor: createDryRunExecutor(),
    });

    assert.equal(result.status, 'refused');
    assert.equal(result.usage.nodesExecuted, 0);
    assert.match(result.refusal ?? '', /is not one of its nodes/);
  });

  it("stops a cycle at the runner's own transition bound", async () => {
    const graph = loadDevelopmentLoop();
    // maxCalls and maxReworkRounds removed so the cycle is bounded by nothing the
    // format expresses, which is exactly the case the runner's own bound covers.
    const unbounded: LoopGraph = { ...graph, limits: { maxTasks: 1 } };
    const result = await runLoopGraph(unbounded, {
      runId: 'test-cycle',
      dryRun: true,
      maxTransitions: 12,
      executor: createDryRunExecutor({
        decisions: [
          { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' } },
          { node: 'route-next-step', produce: { kind: 'outcome', outcome: 'implement' } },
          { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'rework' } },
        ],
      }),
    });

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'transition-budget-spent');
    assert.equal(result.usage.transitions, 12);
  });

  it('does not tell a person a spent transition budget means the step is unknown', async () => {
    // An independent Verifier hit this on 16 September 2026: the generic reconcile
    // sentence is true of a step that hung and false of a cycle the runner walked to
    // the end of its own budget. Every step there finished and every outcome is in the
    // journal, so "its real outcome is unknown" sends a tired person hunting a hang
    // that did not happen.
    const graph = loadDevelopmentLoop();
    const result = await runLoopGraph({ ...graph, limits: { maxTasks: 1 } }, {
      runId: 'test-cycle-message',
      dryRun: true,
      maxTransitions: 12,
      executor: createDryRunExecutor({
        decisions: [
          { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' } },
          { node: 'route-next-step', produce: { kind: 'outcome', outcome: 'implement' } },
          { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'rework' } },
        ],
      }),
    });

    const reconcile = result.fault?.reconcile ?? '';
    assert.equal(result.fault?.kind, 'transition-budget-spent');
    assert.doesNotMatch(reconcile, /outcome is unknown/);
    assert.match(reconcile, /Nothing about this step is unknown/);
    assert.match(reconcile, /transition budget/);
    // What is still true of every runtime fault, and the reason the distinction exists.
    assert.match(reconcile, /no edge was taken/);
    assert.match(reconcile, /stop-and-reconcile/);
    // The sentence that is right for a step nobody saw the end of is still asserted by
    // the timeout test above, which is what keeps this a correction and not a removal.
  });
});

describe('runLoopGraph — bounds are reached, not failed', () => {
  it('records a spent call bound as reached and takes the route the graph draws for it', async () => {
    const graph = loadDevelopmentLoop();
    // One call instead of twelve, so the bound runs out on the coordinator — the node
    // that declares `limit-reached` and draws it to the report as e05.
    const tight: LoopGraph = { ...graph, limits: { ...graph.limits, maxCalls: 1 } };
    const result = await runLoopGraph(tight, {
      runId: 'test-limit',
      dryRun: true,
      routeLimitAs: 'limit-reached',
      executor: createDryRunExecutor({ decisions: HAPPY_PATH }),
    });

    assert.deepEqual(result.limitsReached, ['maxCalls']);
    const reached = result.journal.find((entry) => entry.kind === 'limit-reached');
    assert.ok(reached, 'reaching a bound is journalled in its own right');
    assert.equal(reached.data?.bound, 'maxCalls');
    assert.equal(reached.data?.declaredFailure, false, 'a bound is not a declared failure');
    assert.equal(reached.data?.runtimeFault, false, 'and it is not a fault either');
    assert.match(reached.detail, /Reaching a bound is reaching a bound/);

    // e05 is the graph's own "bounds spent: deliver and stop", taken instead of e03,
    // which the coordinator's plain success would otherwise have taken.
    assert.deepEqual(result.edgesTaken, ['e01', 'e05', 'e29', 'e30']);
    const routed = result.journal.find((entry) => entry.edgeId === 'e05');
    assert.equal(routed?.data?.boundRouted, 'maxCalls');
    assert.equal(routed?.data?.insteadOf, 'e03');
    assert.equal(routed?.data?.declaredFailure, false, 'a spent bound is not the work failing');
    // The run still delivers a result, and the bound stays on the record.
    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'run-complete');
  });

  it('stops with a result when a spent bound has nowhere drawn to go', async () => {
    const graph = loadDevelopmentLoop();
    const tight: LoopGraph = { ...graph, limits: { ...graph.limits, maxCalls: 2 } };
    const result = await runLoopGraph(tight, {
      runId: 'test-limit-unrouted',
      dryRun: true,
      executor: createDryRunExecutor({ decisions: HAPPY_PATH }),
    });

    assert.equal(result.status, 'limit-reached');
    assert.equal(result.fault, null, 'a spent bound is not a fault');
    assert.deepEqual(result.limitsReached, ['maxCalls']);
    assert.match(result.journal.at(-1)?.detail ?? '', /No failure kind was nominated/);
  });

  it('stops before one rework round too many', async () => {
    const graph = loadDevelopmentLoop();
    const tight: LoopGraph = {
      ...graph,
      limits: { maxTasks: 1, maxReworkRounds: 1 },
    };
    const result = await runLoopGraph(tight, {
      runId: 'test-rework-bound',
      dryRun: true,
      executor: createDryRunExecutor({
        decisions: [
          { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' } },
          { node: 'route-next-step', produce: { kind: 'outcome', outcome: 'implement' } },
          { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'rework' } },
        ],
      }),
    });

    assert.equal(result.status, 'limit-reached');
    assert.deepEqual(result.limitsReached, ['maxReworkRounds']);
    assert.equal(result.usage.reworkRounds, 1, 'one rework round was taken and a second was not');
    assert.equal(result.path.filter((id) => id === 'implementer').length, 2);
    assert.match(result.journal.at(-2)?.detail ?? '', /rework round 2 of a permitted 1/);
  });

  it('refuses to start a run a task bound has no room for', async () => {
    const graph = loadDevelopmentLoop();
    const result = await runLoopGraph({ ...graph, limits: { maxTasks: 0 } }, {
      runId: 'test-no-tasks',
      dryRun: true,
      executor: createDryRunExecutor(),
    });
    assert.equal(result.status, 'refused');
    assert.deepEqual(result.limitsReached, ['maxTasks']);
    assert.equal(result.usage.nodesExecuted, 0);
  });
});

describe('runLoopGraph — human steps and the archive', () => {
  it('stops for a person without resetting or replaying anything', async () => {
    const graph = loadDevelopmentLoop();
    const result = await runLoopGraph(graph, {
      runId: 'test-human',
      dryRun: true,
      executor: createDryRunExecutor({ unscripted: 'awaiting-human-at-human-nodes' }),
    });

    assert.equal(result.status, 'awaiting-human');
    assert.equal(result.awaiting?.nodeId, 'niclas-mandate');
    assert.equal(result.fault, null, 'waiting for a person is not a fault');
    assert.deepEqual(result.path, ['niclas-mandate']);
    assert.equal(result.usage.calls, 0);
    assert.match(result.journal.at(-1)?.detail ?? '', /not a fault and not a failure/);
  });

  it("honours report.writtenBy, including a node that cannot file its own entry", async () => {
    const graph = loadDevelopmentLoop();
    const placements: Record<string, string> = {};
    // The planning branch, so the read-only Backlog Planner is actually executed.
    const planThenWrapUp = createDryRunExecutor({
      decisions: [
        { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' } },
        { node: 'route-next-step', occurrence: 1, produce: { kind: 'outcome', outcome: 'plan' } },
        { node: 'plan-review', produce: { kind: 'outcome', outcome: 'accept' } },
        { node: 'route-next-step', occurrence: 2, produce: { kind: 'outcome', outcome: 'wrap-up' } },
        { node: 'niclas-assessment', produce: { kind: 'outcome', outcome: 'accept' } },
      ],
    });
    const result = await runLoopGraph(graph, {
      runId: 'test-archive',
      dryRun: true,
      executor: async (context) => {
        if (context.archive) {
          placements[context.node.id] = `${context.archive.writtenBy}:${context.archive.path}`;
        }
        return planThenWrapUp(context);
      },
    });

    assert.equal(result.status, 'completed');
    // The Implementer files its own; the read-only Backlog Planner does not, which is
    // the 15 September mistake encoded as behaviour rather than remembered.
    assert.match(placements['backlog-planner'] ?? '', /^coordinator:\.dspatch-loop\/runs\/test-archive\/reports\//);
    assert.match(placements['coordinator'] ?? '', /^coordinator:/);
    assert.ok(!(placements['backlog-planner'] ?? '').startsWith('backlog-planner:'));
    // `<run-id>` in the archive path is substituted by the runner.
    assert.ok(!(placements['coordinator'] ?? '').includes('<run-id>'));
  });
});
