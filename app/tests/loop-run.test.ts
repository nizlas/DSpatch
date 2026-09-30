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
import { terminalDeclaresSuccess, type LoopGraph } from '../src/shared/loop-graph';
import { undeclaredReadableOutcome } from '../src/shared/loop-chat';
import { runOutcomeFrom } from '../src/shared/loop-record';
import { createMemoryResultStore } from '../src/shared/loop-results';
import {
  createClock,
  createDryRunExecutor,
  formatJournalEntry,
  formatRunJournal,
  journalToJsonl,
  runLoopGraph,
  type DryRunDecision,
  type RunJournalEntry,
  type StepExecutor,
} from '../src/shared/loop-run';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const graphPath = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json');
const runnablePath = path.join(
  repoRoot,
  'docs',
  'loop',
  'graphs',
  'dspatch-development-loop-runnable.graph.json',
);

function loadDevelopmentLoop(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(graphPath, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, 'the development loop graph must be valid before it can be run');
  return loaded.graph;
}

/** The subset DSpatch can actually walk, loaded the way the main process loads it. */
function loadRunnable(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(runnablePath, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, 'the runnable subset must be valid before it can be walked');
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

/* ------------------------------------------------------------------------- */
/* DSP-96 #10: what arriving at Delivered claims, and what it does not         */
/* ------------------------------------------------------------------------- */

/**
 * Whether a competently written final report can be read as a fulfilled assignment.
 *
 * The question this answers comes from part 1 of the same card. A step whose node
 * declares no failures is now told to describe an obstacle in ordinary prose rather
 * than open with a word the graph cannot route — and `coordinator-report` is such a
 * step, with one edge out of it, `e14`, to a terminal whose `ending` is `success`.
 *
 * These walk the shipped runnable graph with the dry-run executor. No provider is
 * reached and nothing here reads a report body: the runner does not read one either,
 * which is the point.
 */
describe('reaching Delivered is a claim about the walk and not about the work', () => {
  /**
   * The only way in is the reviewer's accept, which is what keeps an obstacle in the
   * *work* away from this terminal. Asserted on the drawing rather than inferred from
   * one walk, because a second edge added later is exactly what would undo it.
   */
  it('lets nothing but an accepted review reach the report step', () => {
    const graph = loadRunnable();
    const into = graph.edges.filter((edge) => edge.to === 'coordinator-report');
    assert.deepEqual(
      into.map((edge) => [edge.id, edge.from, edge.when.on, edge.when.outcome ?? null]),
      [['e11', 'implementation-review', 'outcome', 'accept']],
    );
    const review = graph.nodes.find((node) => node.id === 'implementation-review');
    // DSP-97 added a fourth name here and it is not a fourth verdict: the three verdicts
    // are unchanged and `could-not-review` is what this step says when the reporting
    // contract its node sets cannot be fulfilled at all.
    assert.deepEqual(review?.outcomes, ['accept', 'rework', 'needs-decision', 'could-not-review']);
    // The other verdicts leave the loop elsewhere, and none of them is Delivered.
    assert.equal(graph.edges.find((edge) => edge.id === 'e12')?.to, 'implementer');
    assert.equal(graph.edges.find((edge) => edge.id === 'e13')?.to, 'needs-a-decision');
    assert.equal(graph.edges.find((edge) => edge.id === 'e13a')?.to, 'reporting-incomplete');
    assert.equal(
      graph.nodes.find((node) => node.id === 'needs-a-decision')?.ending,
      'not-success',
    );
  });

  /**
   * The ordinary path, walked, with the obstacle still in the text.
   *
   * This used to be the card's finding rather than its fix: the report step produced plain
   * `success` whatever it had written, so the summary below — a report saying the evidence
   * could not be read — reached an ending whose tick claims the assignment was reported.
   * DSP-97 made `reported` a name the step has to give, and the summary is kept here
   * verbatim to hold the other half of the claim: a step that *says* it reported goes to
   * Delivered no matter what its prose says, because nothing reads the prose.
   */
  it('routes the report step to Delivered on the name it gave, not on what it wrote', async () => {
    const graph = loadRunnable();
    const result = await runLoopGraph(graph, {
      runId: 'test-delivered-with-an-obstacle',
      dryRun: true,
      executor: createDryRunExecutor({
        decisions: [
          { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'accept' } },
          {
            node: 'coordinator-report',
            produce: { kind: 'outcome', outcome: 'reported' },
            summary:
              'I could not read the verifier\u2019s evidence file, so what follows is the ' +
              'implementer\u2019s account alone and the commands are unconfirmed.',
          },
        ],
      }),
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(result.path, [
      'coordinator',
      'implementer',
      'verifier',
      'implementation-review',
      'coordinator-report',
      'delivered',
    ]);
    assert.deepEqual(result.edgesTaken, ['e01', 'e02', 'e09', 'e11', 'e14']);
    assert.equal(result.terminalNodeId, 'delivered');

    // The drawing does declare this ending a success, so the graph view ticks it.
    const delivered = graph.nodes.find((node) => node.id === 'delivered');
    assert.equal(terminalDeclaresSuccess(delivered), true);

    // And the step now has a way to say it was in trouble that the graph can route:
    // DSP-97's own tests below walk it. It still declares no failure, which is why part 1
    // of DSP-96 told it to describe an obstacle in prose rather than open with a word.
    const report = graph.nodes.find((node) => node.id === 'coordinator-report');
    assert.deepEqual(report?.outcomes, ['reported', 'could-not-report']);
    assert.equal(report?.declaredFailures, undefined);
  });

  /**
   * The separation that does hold, and it is the one a person reads. Arriving at a
   * terminal earns nothing: `runOutcomeFrom` never looks at `terminalNodeId`, so the
   * run above records `verification-not-performed` and not `work-verified`. This
   * runnable subset draws no gate at all, so no run of it can record anything else.
   */
  it('records verification as not performed, terminal or no terminal', async () => {
    const graph = loadRunnable();
    assert.equal(
      graph.nodes.some((node) => node.kind === 'gate'),
      false,
      'this subset runs no command, so nothing in it can verify anything',
    );
    const result = await runLoopGraph(graph, {
      runId: 'test-delivered-outcome',
      dryRun: true,
      executor: createDryRunExecutor({
        decisions: [
          { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'accept' } },
        ],
      }),
    });
    assert.equal(result.terminalNodeId, 'delivered');
    assert.equal(
      runOutcomeFrom({
        commands: [],
        status: result.status,
        cancelled: false,
        recordComplete: true,
        walk: { terminalNodeId: result.terminalNodeId, movedPaths: [], movedPathsNotListed: 0 },
      }),
      'verification-not-performed',
    );
  });
});

/* ------------------------------------------------------------------------- */
/* DSP-102: a step that must name its result cannot pass by not naming one     */
/* ------------------------------------------------------------------------- */

/**
 * The dry-run executor, with the body a real step would have left attached.
 *
 * `createDryRunExecutor` hands back no `resultBody`: a dry run has no store, so there
 * has never been anything for it to give one to. The claim below is that a step's own
 * account is filed **before** the run decides where its outcome goes, so these runs do
 * have a store — and the products still come from the dry-run executor, which closes
 * over nothing that could reach a provider.
 *
 * A decision that scripts a `summary` gets it as the body as well, which is what a real
 * step leaves: one account, written by the step, filed whole. Every other step gets a
 * placeholder, because the point of the placeholder is that nothing routing reads it.
 */
function dryRunLeavingBodies(decisions: readonly DryRunDecision[]): StepExecutor {
  const dry = createDryRunExecutor({ decisions });
  const scripted = new Map(
    decisions
      .filter((decision) => decision.summary !== undefined)
      .map((decision) => [decision.node, decision.summary as string]),
  );
  return async (context) => ({
    ...(await dry(context)),
    resultBody:
      scripted.get(context.node.id) ??
      `What "${context.node.id}" wrote, which is not read by anything routing it.`,
  });
}

/** A store that keeps bodies in memory, so no test here touches a filesystem. */
function bodiesInMemory(): ReturnType<typeof createMemoryResultStore> {
  return createMemoryResultStore((body) => `digest-of-${String(body.length)}-bytes`);
}

/**
 * DSP-102, on the drawing rather than in the routing.
 *
 * On 22 September 2026 the implementer of this loop was offered `RESULT: blocked`, asked
 * a question instead, and was routed to the verifier as a step that had finished; the
 * verifier wrote **BLOCKED** in prose and was routed to the reviewer the same way. Neither
 * was a misreading. `outcomes` has always meant *this step must name its result* and the
 * runner has always refused to let a node carrying it finish on plain success — these
 * three steps simply did not carry the field, so for them success was the residue of
 * every reply that was not a declared failure, and their own message said so.
 *
 * The drawing now says what each of them must name, and what a reply that names nothing
 * means. Nothing here reads a report body and nothing asks anything what a reply meant:
 * a route is taken because a form the message asked for is absent.
 */
describe('a step that must name its result does not pass by not naming one', () => {
  /** The three steps down the middle: the name for having done it, and the name for not. */
  const MUST_NAME = [
    { node: 'coordinator', done: 'briefed', unestablished: 'unclear', stops: 'e01c', onward: 'e01' },
    { node: 'implementer', done: 'done', unestablished: 'unclear', stops: 'e02a', onward: 'e02' },
    {
      node: 'verifier',
      done: 'checked',
      unestablished: 'could-not-check',
      stops: 'e09a',
      onward: 'e09',
    },
  ] as const;

  /**
   * Four mechanics that are each a way to get this wrong, asserted on the shipped file.
   *
   * The success name is first because an unscripted dry run takes `declared[0]`, and the
   * check that this graph reaches `delivered` walks it that way. The other name is the one
   * the node's own `whenUndeclared` points at — DSP-103, where it used to be whichever of
   * two literals the author had happened to spell. Say nothing there and a reply that
   * declared nothing stops the run as a fault instead of taking the drawn route, whatever
   * the outcome is called.
   */
  it('names its success first and routes the other name to Stopped', () => {
    const graph = loadRunnable();
    for (const step of MUST_NAME) {
      const node = graph.nodes.find((candidate) => candidate.id === step.node);
      assert.ok(node, `${step.node} must be a node of this graph`);
      assert.deepEqual(node.outcomes, [step.done, step.unestablished]);
      assert.equal(
        node.whenUndeclared,
        step.unestablished,
        `${step.node} must state the route, because nothing is inferred from a name`,
      );
      assert.equal(
        undeclaredReadableOutcome(node)?.outcome,
        step.unestablished,
        `${step.node}'s stated route is the one the run's own reader takes`,
      );

      const out = graph.edges.filter((edge) => edge.from === step.node);
      assert.equal(
        out.some((edge) => edge.when.on === 'success'),
        false,
        `${step.node} declares outcomes, so plain success has nowhere to go from it`,
      );
      const onward = out.find((edge) => edge.id === step.onward);
      assert.deepEqual(
        [onward?.when.on, onward?.when.outcome],
        ['outcome', step.done],
        `${step.onward} must carry the work on only when the step said it did the work`,
      );
      const stops = out.find((edge) => edge.id === step.stops);
      assert.deepEqual([stops?.when.on, stops?.when.outcome, stops?.to], [
        'outcome',
        step.unestablished,
        'stopped',
      ]);
    }

    // The one node this card left permissive was `coordinator-report`, deliberately,
    // because it was DSP-97's subject. That card has since decided it, and its own block
    // below is where the contract is asserted — the point kept here is that it did not
    // reuse this card's route: naming no result at the report step does not reach
    // `stopped`, whose three sentences would all be untrue of it.
    const report = graph.nodes.find((node) => node.id === 'coordinator-report');
    assert.equal(report?.whenUndeclared, 'could-not-report');
    assert.equal(
      graph.edges.some((edge) => edge.from === 'coordinator-report' && edge.to === 'stopped'),
      false,
    );

    // These three routes added no ending and relabelled none. They reuse the terminal that
    // already took seven edges, and it names the third cause it can arrive by — without
    // saying the step failed at its work, because it may well not have.
    assert.deepEqual(
      graph.nodes.filter((node) => node.kind === 'terminal').map((node) => node.id),
      ['delivered', 'needs-a-decision', 'reporting-incomplete', 'stopped'],
    );
    const stopped = graph.nodes.find((node) => node.id === 'stopped');
    assert.equal(stopped?.ending, 'not-success');
    assert.equal(stopped?.label, 'Stopped without a result');
    assert.match(stopped?.purpose ?? '', /a form the run could not route/);
    assert.match(stopped?.purpose ?? '', /not a verdict on the work/);
    assert.match(
      graph.nodes.find((node) => node.id === 'delivered')?.purpose ?? '',
      /^The assignment was carried out, verified, reviewed and reported/,
    );
  });

  for (const step of MUST_NAME) {
    it(`sends "${step.node}" to Stopped when it names no result, its account already filed`, async () => {
      const graph = loadRunnable();
      const result = await runLoopGraph(graph, {
        runId: `dsp-102-${step.node}`,
        dryRun: true,
        resultStore: bodiesInMemory(),
        // What a reply with none of the asked-for line produces, which is this outcome
        // and not plain success: the fallback is applied when the reply is read, before
        // the runner sees a product at all.
        executor: dryRunLeavingBodies([
          { node: step.node, produce: { kind: 'outcome', outcome: step.unestablished } },
        ]),
      });

      assert.equal(result.status, 'completed', result.fault?.detail ?? '');
      assert.equal(result.terminalNodeId, 'stopped');
      assert.equal(result.path.at(-1), 'stopped');
      assert.equal(result.path.at(-2), step.node);
      assert.ok(result.edgesTaken.includes(step.stops), `${step.stops} is the route that was drawn`);
      assert.equal(
        result.edgesTaken.includes(step.onward),
        false,
        'and the work must not have been carried on as though it had been done',
      );

      // The step's own account survives the stop, which is what makes stopping cheap: a
      // person reads the question, the refusal or the essay rather than an inference
      // about it. Filed first, routed second, and in that order in the journal.
      const filed = result.results.filter((entry) => entry.nodeId === step.node);
      assert.equal(filed.length, 1, 'the step that named nothing still left its result');
      const filedAt = result.journal.findIndex(
        (entry) => entry.kind === 'result-filed' && entry.nodeId === step.node,
      );
      const routedAt = result.journal.findIndex(
        (entry) => entry.kind === 'edge-taken' && entry.edgeId === step.stops,
      );
      assert.ok(filedAt >= 0, 'the filing is journalled');
      assert.ok(routedAt > filedAt, 'the result is filed before the run decides where to go');
    });
  }

  /**
   * DSP-103 #7, and it is a change to this drawing rather than to anything general.
   *
   * The researcher was the one step DSP-102 left permissive, on the grounds that it was
   * the cheapest case to leave alone. It was not: `e06` returned on plain success, and
   * plain success is the residue of every reply that is not a declared failure — so a
   * researcher that asked a question back, or that investigated honestly and settled
   * nothing, arrived at the implementer as finished research. The two names make that
   * difference visible, and both of them come back to the implementer, because either way
   * the work resumes where it stopped and what it resumes with is the researcher's own
   * account.
   *
   * Nothing in the engine knows what a researcher is. This asserts the drawing.
   */
  for (const [outcome, edgeId] of [
    ['answered', 'e06'],
    ['not-established', 'e06a'],
  ] as const) {
    it(`returns a researcher that ${outcome === 'answered' ? 'answered' : 'settled nothing'} to the implementer`, async () => {
      const graph = loadRunnable();
      const researcher = graph.nodes.find((node) => node.id === 'researcher');
      assert.deepEqual(researcher?.outcomes, ['answered', 'not-established']);
      assert.equal(researcher?.whenUndeclared, 'not-established');

      const result = await runLoopGraph(graph, {
        runId: `dsp-103-${outcome}`,
        dryRun: true,
        resultStore: bodiesInMemory(),
        executor: dryRunLeavingBodies([
          // The one route to the researcher: the implementer stops on a question, and
          // its second visit carries on with whatever came back.
          {
            node: 'implementer',
            occurrence: 1,
            produce: { kind: 'declared-failure', failure: 'research-needed' },
          },
          { node: 'researcher', produce: { kind: 'outcome', outcome } },
        ]),
      });

      assert.equal(result.status, 'completed', result.fault?.detail ?? '');
      assert.ok(result.edgesTaken.includes('e03'), 'the research need is what reaches it');
      assert.ok(
        result.edgesTaken.includes(edgeId),
        `${outcome} must leave the researcher on ${edgeId}`,
      );
      assert.deepEqual(result.path.slice(0, 4), [
        'coordinator',
        'implementer',
        'researcher',
        'implementer',
      ]);

      // And what comes back is the researcher's own account, on both routes — the
      // question it was sent with is not what resumes the work.
      const back = result.journal.find(
        (entry) => entry.kind === 'edge-taken' && entry.edgeId === edgeId,
      );
      assert.ok(back);
      assert.ok(
        result.results.some((entry) => entry.nodeId === 'researcher'),
        'the researcher filed what it established, whichever name it gave it',
      );
    });
  }

  /**
   * And the product the old contract turned every non-answer into. A node declaring
   * outcomes may not finish on plain success, so if anything ever hands one back for
   * these steps the run stops instead of walking on — which is the strict behaviour the
   * graceful route is drawn on top of, not instead of.
   */
  it('stops rather than walking on if such a step reports plain success', async () => {
    const result = await runLoopGraph(loadRunnable(), {
      runId: 'dsp-102-plain-success',
      dryRun: true,
      resultStore: bodiesInMemory(),
      executor: dryRunLeavingBodies([{ node: 'implementer', produce: { kind: 'success' } }]),
    });

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'undeclared-product');
    assert.equal(result.fault?.nodeId, 'implementer');
    assert.match(result.fault?.detail ?? '', /may not finish on plain success/);
    assert.equal(result.terminalNodeId, null);
    assert.equal(result.edgesTaken.includes('e02'), false);
    // Filed before the check here too, so nothing is lost either way.
    assert.ok(result.results.some((entry) => entry.nodeId === 'implementer'));
  });
});

/* ------------------------------------------------------------------------- */
/* DSP-97: what this loop says when the work was accepted and it could not     */
/* report on it                                                               */
/* ------------------------------------------------------------------------- */

/**
 * The ending Niclas decided, and the two things its wording must keep apart.
 *
 * The gap was narrow and real. `coordinator-report` declared no outcomes, so a report
 * step that filed a report saying it could not do its own step still produced plain
 * success, took `e14` and reached `delivered`, whose `ending` is `success`. Only the tick
 * was wrong — the recorded outcome, the badge and the sentence beside it were all honest,
 * and `runOutcomeFrom` never reads `terminalNodeId` — but the tick was ahead of the facts.
 *
 * The destination is described factually and **asserts nothing about the work**: not that
 * it was done because a report is missing, and not that it was done because there are
 * files in the folder. The reason is preserved in the step's own report and in the
 * recorded outcome's provenance; evidence about completed work is stated separately from
 * the ending. Those are different registers and the tests below check that the wording
 * keeps them apart, because the wording is the deliverable of this card.
 *
 * Nothing here reads a report body, and neither does the run: every route is taken on a
 * name the step gave or on the absence of one.
 */
describe('a run that could not report on accepted work says that and nothing more', () => {
  /** The terminal the card adds, with the label Niclas settled. */
  const ENDING = 'reporting-incomplete';

  it('declares the ending factually and refuses to claim the work either way', () => {
    const graph = loadRunnable();
    const node = graph.nodes.find((each) => each.id === ENDING);
    assert.ok(node, 'the drawing must have the ending this card decided');
    assert.equal(node.kind, 'terminal');
    assert.equal(node.label, 'Ended without complete reporting');

    // Not success, and not by omission: an absent `ending` means the author has not said,
    // and the author has. `TerminalEnding` has two values, so this needs no third — the
    // reasons live in the purpose, which is the one place they cannot contradict a second
    // vocabulary.
    assert.equal(node.ending, 'not-success');
    assert.equal(terminalDeclaresSuccess(node), false, 'nothing on this path earns a tick');

    const purpose = node.purpose ?? '';
    // What it says.
    assert.match(purpose, /ended without one/);
    // What it refuses to say, and the two tempting reasons for saying it.
    assert.match(purpose, /does not assert that the work was done/);
    assert.match(purpose, /A report that is missing is a report that is missing/);
    assert.match(purpose, /files in the working folders are files in the working folders/);
    // Where the reason actually is.
    assert.match(purpose, /The actual reason is preserved/);
    assert.match(purpose, /filed before this route is chosen/);
    // And the separation the card asks for by name.
    assert.match(purpose, /stated separately from this ending/);
  });

  /**
   * The bounds, asserted rather than trusted. Delivered keeps its label, its ending and
   * its sentence, and no other terminal was touched.
   */
  it('leaves Delivered and the other endings exactly as they were', () => {
    const graph = loadRunnable();
    const delivered = graph.nodes.find((node) => node.id === 'delivered');
    assert.equal(delivered?.label, 'Delivered');
    assert.equal(delivered?.ending, 'success');
    assert.match(
      delivered?.purpose ?? '',
      /^The assignment was carried out, verified, reviewed and reported/,
    );
    const stopped = graph.nodes.find((node) => node.id === 'stopped');
    assert.equal(stopped?.label, 'Stopped without a result');
    assert.equal(stopped?.ending, 'not-success');
    assert.equal(
      graph.nodes.find((node) => node.id === 'needs-a-decision')?.label,
      'Needs a decision',
    );
  });

  /**
   * Shared destination, distinct reason — which is the shape of the decision.
   *
   * Two nodes arrive, each on its own edge and its own outcome name, so the record says
   * which without anything having to read a report to work it out.
   */
  it('is reached by two steps on distinct reasons', () => {
    const graph = loadRunnable();
    const into = graph.edges.filter((edge) => edge.to === ENDING);
    assert.deepEqual(
      into.map((edge) => [edge.id, edge.from, edge.when.outcome ?? null, edge.label ?? null]),
      [
        ['e13a', 'implementation-review', 'could-not-review', 'could not report a verdict'],
        ['e14a', 'coordinator-report', 'could-not-report', 'could not report'],
      ],
    );

    // The report step: its success is a name now, so `e14` no longer takes every reply
    // that was not a declared failure.
    const report = graph.nodes.find((node) => node.id === 'coordinator-report');
    assert.deepEqual(report?.outcomes, ['reported', 'could-not-report']);
    assert.equal(report?.whenUndeclared, 'could-not-report');
    assert.equal(undeclaredReadableOutcome(report!)?.outcome, 'could-not-report');
    assert.deepEqual(
      graph.edges.find((edge) => edge.id === 'e14')?.when,
      { on: 'outcome', outcome: 'reported' },
    );
    assert.equal(
      graph.edges.some((edge) => edge.from === 'coordinator-report' && edge.when.on === 'success'),
      false,
      'a node that declares outcomes routes on them, so plain success has nowhere to go',
    );

    // The review: the three verdicts keep the routes they had, and the fourth name is not
    // one of them.
    const review = graph.nodes.find((node) => node.id === 'implementation-review');
    assert.deepEqual(review?.outcomes, ['accept', 'rework', 'needs-decision', 'could-not-review']);
    assert.equal(review?.whenUndeclared, 'could-not-review');
    assert.deepEqual(
      ['e11', 'e12', 'e13'].map((id) => {
        const edge = graph.edges.find((each) => each.id === id);
        return [edge?.when.outcome ?? null, edge?.to ?? null];
      }),
      [
        ['accept', 'coordinator-report'],
        ['rework', 'implementer'],
        ['needs-decision', 'needs-a-decision'],
      ],
    );
  });

  /**
   * The report step's own route, walked with a scripted product.
   *
   * The other way in — a reply that names nothing, routed on the absence of a form rather
   * than on a verdict — needs a real reply to be read, so it is in `loop-live.test.ts`
   * against a fake adapter. What this one pins is that the step's account is filed before
   * the route is chosen, which is what makes the reason recoverable at all: the ending says
   * the run did not report, and the report that does exist says why.
   */
  it('ends at the new terminal when the report step says it could not report', async () => {
    const graph = loadRunnable();
    const result = await runLoopGraph(graph, {
      runId: 'dsp-97-could-not-report',
      dryRun: true,
      resultStore: bodiesInMemory(),
      executor: dryRunLeavingBodies([
        { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'accept' } },
        {
          node: 'coordinator-report',
          produce: { kind: 'outcome', outcome: 'could-not-report' },
          summary:
            'The run\u2019s own storage was unreachable, so I could not assemble the report ' +
            'from the steps\u2019 results.',
        },
      ]),
    });

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(result.path, [
      'coordinator',
      'implementer',
      'verifier',
      'implementation-review',
      'coordinator-report',
      ENDING,
    ]);
    assert.deepEqual(result.edgesTaken, ['e01', 'e02', 'e09', 'e11', 'e14a']);
    assert.equal(result.terminalNodeId, ENDING);
    assert.equal(result.edgesTaken.includes('e14'), false, 'Delivered is not on this path');

    // No tick, and the recorded outcome is what it would have been at Delivered: arriving
    // at a terminal earns nothing either way, so this card changed no claim about the work.
    assert.equal(
      terminalDeclaresSuccess(graph.nodes.find((node) => node.id === ENDING)),
      false,
    );
    assert.equal(
      runOutcomeFrom({
        commands: [],
        status: result.status,
        cancelled: false,
        recordComplete: true,
        walk: { terminalNodeId: result.terminalNodeId, movedPaths: [], movedPathsNotListed: 0 },
      }),
      'verification-not-performed',
    );

    // The reason is preserved where the ending says it is: in the step's own account,
    // filed before the route was chosen.
    const filed = result.results.find((entry) => entry.nodeId === 'coordinator-report');
    assert.ok(filed, 'the report step still left what it wrote');
    assert.match(filed.body, /could not assemble the report/);
    const filedAt = result.journal.findIndex(
      (entry) => entry.kind === 'result-filed' && entry.nodeId === 'coordinator-report',
    );
    const routedAt = result.journal.findIndex(
      (entry) => entry.kind === 'edge-taken' && entry.edgeId === 'e14a',
    );
    assert.ok(filedAt >= 0 && routedAt > filedAt, 'filed first, routed second');

    // And the evidence about the work that *was* done is stated separately from the
    // ending: it is in the earlier steps' own results, which the run still has.
    assert.deepEqual(
      result.results.map((entry) => entry.nodeId),
      ['coordinator', 'implementer', 'verifier', 'implementation-review', 'coordinator-report'],
    );
  });

  /**
   * The review's share of the same destination, and its verdicts left alone.
   *
   * Before this the node declared outcomes and stated no fallback, so a reviewer that
   * could not answer — or that reasoned in prose and never put a verdict on the line the
   * message asked for — was an undeclared product and stopped the run as a runtime fault
   * one step from the end.
   */
  it('ends at the same terminal when the review could not report a verdict', async () => {
    const graph = loadRunnable();
    const result = await runLoopGraph(graph, {
      runId: 'dsp-97-could-not-review',
      dryRun: true,
      resultStore: bodiesInMemory(),
      executor: dryRunLeavingBodies([
        {
          node: 'implementation-review',
          produce: { kind: 'outcome', outcome: 'could-not-review' },
        },
      ]),
    });

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.equal(result.terminalNodeId, ENDING);
    assert.deepEqual(result.edgesTaken, ['e01', 'e02', 'e09', 'e13a']);
    assert.equal(result.path.at(-2), 'implementation-review');
    assert.ok(
      result.results.some((entry) => entry.nodeId === 'implementation-review'),
      'what the review did read is filed, whichever name it gave',
    );
  });

  /** And the ordinary verdicts still go where they went, on the same drawing. */
  for (const [outcome, edgeId, next] of [
    ['accept', 'e11', 'coordinator-report'],
    ['rework', 'e12', 'implementer'],
    ['needs-decision', 'e13', 'needs-a-decision'],
  ] as const) {
    it(`leaves "${outcome}" on ${edgeId} to ${next}`, async () => {
      const result = await runLoopGraph(loadRunnable(), {
        runId: `dsp-97-verdict-${outcome}`,
        dryRun: true,
        resultStore: bodiesInMemory(),
        executor: dryRunLeavingBodies([
          { node: 'implementation-review', occurrence: 1, produce: { kind: 'outcome', outcome } },
        ]),
      });

      assert.equal(result.status, 'completed', result.fault?.detail ?? '');
      assert.ok(result.edgesTaken.includes(edgeId), `${outcome} must still leave on ${edgeId}`);
      assert.equal(result.path[4], next);
      assert.notEqual(result.terminalNodeId, ENDING);
    });
  }
});
