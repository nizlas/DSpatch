/**
 * Pause and the two modes, against the runner that actually walks the graph.
 *
 * `loop-control.test.ts` tests the rules; this tests that the walk obeys them, on the
 * real `dspatch-development-loop.graph.json` rather than a fixture, for the reason
 * `loop-run.test.ts` gives: a fixture would let the runner and the format drift apart
 * with nothing noticing. That graph is also the one graph that has every node kind —
 * a human entry, agents, a router and two terminals — so "what waits
 * and what does not" can be asserted on the thing rather than on a model of it.
 * The two review nodes used to be gates; they are agents since DSP-78. A gate
 * still exists on `dspatch-live-duration`, and the one test that needs a command
 * in flight uses that drawing.
 *
 * Nothing here can spend a provider turn: every run is driven by
 * `createDryRunExecutor`, which closes over no provider at all.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LoopRunController, type RunBeginOutcome } from '../src/main/loop-control-runtime';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { controlPhase, describeControl, isWorkStep, stepWorkFor } from '../src/shared/loop-control';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import type { LoopGraph } from '../src/shared/loop-graph';
import {
  JOURNAL_KINDS,
  createClock,
  createDryRunExecutor,
  formatJournalEntry,
  runLoopGraph,
  type DryRunDecision,
  type RunJournalEntry,
  type RunResult,
  type StepContext,
  type StepExecutor,
  type TestClock,
} from '../src/shared/loop-run';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const graphPath = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json');

function developmentLoop(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(graphPath, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, 'the development loop graph must be valid before it can be run');
  return loaded.graph;
}

function durationLoop(): LoopGraph {
  const loaded = loadLoopGraph(
    fs.readFileSync(path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-live-duration.graph.json'), 'utf8'),
    {
      resolveRole: createFileRoleResolver(repoRoot),
      connectedTargets: ['cursor'],
    },
  );
  assert.ok(loaded.ok, 'the duration graph must be valid before it can be run');
  return loaded.graph;
}

/** Duration drawing plus a work step after the gate, so a pause there has somewhere to hold. */
function durationLoopHeldAfterGate(): LoopGraph {
  const graph = durationLoop();
  return {
    ...graph,
    limits: { ...graph.limits, maxCalls: 12 },
    nodes: [
      ...graph.nodes,
      {
        id: 'after-verify',
        kind: 'agent',
        label: 'After verify',
        purpose: 'Exists so a pause during the gate has a work step left to hold.',
        outcomes: ['succeeded'],
      },
    ],
    edges: [
      ...graph.edges.map((edge) => (edge.id === 'e-pass' ? { ...edge, to: 'after-verify' } : edge)),
      {
        id: 'e-after-verify',
        from: 'after-verify',
        to: 'done',
        when: { on: 'outcome', outcome: 'succeeded' },
      },
    ],
  };
}

/** Mandate, code, verify, accept — the ordinary path through our own loop. */
const HAPPY_PATH = [
  { node: 'niclas-mandate', produce: { kind: 'outcome' as const, outcome: 'start' } },
  { node: 'route-next-step', produce: { kind: 'outcome' as const, outcome: 'implement' } },
  { node: 'implementation-review', produce: { kind: 'outcome' as const, outcome: 'accept' } },
  { node: 'niclas-assessment', produce: { kind: 'outcome' as const, outcome: 'accept' } },
];

/**
 * The work steps on that path: five agents. Review used to be a gate; it is not.
 *
 * Named rather than counted, because the claim is about *which* steps wait — a count
 * would still pass if a router started asking and an agent stopped.
 */
const WORK_STEPS_ON_HAPPY_PATH = [
  'coordinator',
  'implementer',
  'verifier',
  'implementation-review',
  'coordinator-report',
];

/** Let pending promises run. The controller's wait is a promise, not a timer. */
async function settle(rounds = 40): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

async function waitUntil(ready: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (ready()) {
      return;
    }
    await settle(1);
  }
  assert.fail(`timed out waiting for ${what}`);
}

interface Watched {
  /** `node#occurrence` for every step the executor was actually asked to perform. */
  readonly performed: string[];
  /** The headline shown at the moment each *work* step was running. */
  readonly headlinesDuringWork: string[];
  readonly executor: StepExecutor;
}

function isWork(context: StepContext): boolean {
  return isWorkStep(stepWorkFor(context.node.kind));
}

/**
 * The dry-run executor, watched, and with a hook that runs *while the step is in
 * flight* — which is the only interval in which the pause honesty rule can be broken.
 */
function watch(
  controller: LoopRunController,
  options: {
    readonly clock?: TestClock;
    readonly decisions?: readonly DryRunDecision[];
    readonly unscripted?: 'first-branch' | 'awaiting-human-at-human-nodes';
    readonly duringStep?: (context: StepContext) => void | Promise<void>;
  } = {},
): Watched {
  const inner = createDryRunExecutor({
    decisions: options.decisions ?? HAPPY_PATH,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.unscripted === undefined ? {} : { unscripted: options.unscripted }),
  });
  const performed: string[] = [];
  const headlinesDuringWork: string[] = [];
  return {
    performed,
    headlinesDuringWork,
    executor: async (context) => {
      performed.push(`${context.node.id}#${String(context.occurrence)}`);
      if (isWork(context)) {
        headlinesDuringWork.push(
          describeControl(controller.report().state, { runActive: true }).headline,
        );
      }
      await options.duringStep?.(context);
      return inner(context);
    },
  };
}

function heldNodes(journal: readonly RunJournalEntry[]): readonly string[] {
  return journal.filter((entry) => entry.kind === 'run-held').map((entry) => entry.nodeId ?? '(none)');
}

/** A run's shape, ignoring anything to do with the control. What must not move. */
function shapeOf(result: RunResult): Record<string, unknown> {
  return {
    runId: result.runId,
    status: result.status,
    path: result.path,
    edgesTaken: result.edgesTaken,
    terminalNodeId: result.terminalNodeId,
    limitsReached: result.limitsReached,
    usage: {
      calls: result.usage.calls,
      providerTurns: result.usage.providerTurns,
      reworkRounds: result.usage.reworkRounds,
      transitions: result.usage.transitions,
      nodesExecuted: result.usage.nodesExecuted,
    },
    // The history, without the two kinds the control adds and without the wall-clock
    // fields, which differ between any two runs for reasons that are not this call's.
    history: result.journal
      .filter((entry) => entry.kind !== 'run-held' && entry.kind !== 'run-released')
      .map((entry) => `${entry.kind}:${entry.nodeId ?? ''}:${entry.edgeId ?? ''}`),
  };
}

async function runAutonomousBaseline(graph: LoopGraph, runId: string): Promise<RunResult> {
  return runLoopGraph(graph, {
    runId,
    dryRun: true,
    executor: createDryRunExecutor({ decisions: HAPPY_PATH }),
  });
}

describe('a pause lets the step finish and starts no new work step', () => {
  it('reports pause requested while the agent is still writing, and paused only after', async () => {
    const graph = developmentLoop();
    const controller = new LoopRunController();
    controller.beginRun('pause-during-agent');

    let phaseInsideTheStep = '';
    let headlineInsideTheStep = '';
    const watched = watch(controller, {
      duringStep: (context) => {
        if (context.node.id !== 'implementer') {
          return;
        }
        // Pressed while this very step is running: the agent for "implementer" is in
        // flight and the run has not stopped.
        controller.requestPause();
        phaseInsideTheStep = controlPhase(controller.report().state);
        headlineInsideTheStep = describeControl(controller.report().state, { runActive: true }).headline;
      },
    });

    let finished = false;
    const running = runLoopGraph(graph, {
      runId: 'pause-during-agent',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    }).then((result) => {
      finished = true;
      return result;
    });

    await waitUntil(() => controlPhase(controller.report().state) === 'paused', 'the run to pause');

    assert.equal(
      phaseInsideTheStep,
      'pause-requested',
      'while the agent was still writing, the run had not paused and must not have said it had',
    );
    assert.notEqual(
      headlineInsideTheStep,
      'Paused',
      `the window said "${headlineInsideTheStep}" while the agent for "implementer" was still writing`,
    );

    // Asserted before the weaker "the run is still going", so a revert fails on the
    // sentence a person would recognise rather than on a boolean.
    assert.ok(
      !watched.performed.includes('verifier#1'),
      `no new work step may start after a pause was asked for, and one did. It performed: ${watched.performed.join(', ')}`,
    );
    assert.ok(
      watched.performed.includes('implementer#1'),
      'the step that was already running was left to finish, which is what pause means',
    );
    assert.equal(finished, false, 'a paused run is waiting, not ended');
    assert.equal(controlPhase(controller.report().state), 'paused');

    controller.continueRun();
    const result = await running;
    assert.equal(result.status, 'completed');
    assert.ok(watched.performed.includes('verifier#1'), 'continuing carries on rather than ending');
    assert.equal(
      watched.performed.filter((entry) => entry === 'implementer#1').length,
      1,
      'continuing must not repeat the step that had already been performed',
    );
  });

  it('reports pause requested while a command is still running, and names the command', async () => {
    // A command in flight needs a gate. Our development loop no longer has one —
    // review is an agent — so this uses the duration drawing, which still does.
    // A trailing work step is added so the pause has somewhere to hold: the
    // duration drawing's next node after the gate is a terminal, and a terminal
    // ends the run rather than waiting.
    const graph = durationLoopHeldAfterGate();
    const controller = new LoopRunController();
    controller.beginRun('pause-during-command');

    let detailInsideTheCommand = '';
    let headlineInsideTheCommand = '';
    const watched = watch(controller, {
      duringStep: (context) => {
        if (context.node.kind !== 'gate') {
          return;
        }
        controller.requestPause();
        const report = describeControl(controller.report().state, { runActive: true });
        detailInsideTheCommand = report.detail;
        headlineInsideTheCommand = report.headline;
      },
    });

    let finished = false;
    const running = runLoopGraph(graph, {
      runId: 'pause-during-command',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    }).then((result) => {
      finished = true;
      return result;
    });

    await waitUntil(() => controlPhase(controller.report().state) === 'paused', 'the run to pause');

    assert.notEqual(
      headlineInsideTheCommand,
      'Paused',
      `the window said "${headlineInsideTheCommand}" while the gate's command was still running`,
    );
    assert.match(
      detailInsideTheCommand,
      /the command for "Run the project's tests" is still running/,
      `a person watching a command they asked to stop must be told it has not stopped. It said: ${detailInsideTheCommand}`,
    );
    assert.doesNotMatch(
      detailInsideTheCommand,
      /\bpaused\b/i,
      `nothing may contain the word "paused" while the command is still running. It said: ${detailInsideTheCommand}`,
    );
    assert.equal(finished, false);
    assert.ok(
      !watched.performed.includes('after-verify#1'),
      'the work step after the gate must not have been started',
    );

    controller.continueRun();
    assert.equal((await running).status, 'completed');
  });

  it('never shows Paused at any moment a step is in flight, across the whole run', async () => {
    const graph = developmentLoop();
    const controller = new LoopRunController();
    controller.beginRun('pause-honesty-throughout');

    // Asked for at the first work step and left outstanding, so every later sample is
    // taken with a pause request live rather than in the easy case.
    const ranWhilePaused: string[] = [];
    const watched = watch(controller, {
      duringStep: (context) => {
        if (context.node.id === 'coordinator') {
          controller.requestPause();
        }
        if (controlPhase(controller.report().state) === 'paused') {
          ranWhilePaused.push(context.node.id);
        }
        if (!isWork(context)) {
          return;
        }
        assert.notEqual(
          describeControl(controller.report().state, { runActive: true }).headline,
          'Paused',
          `"${context.node.id}" was executing and the window said Paused`,
        );
        assert.notEqual(
          controlPhase(controller.report().state),
          'paused',
          `"${context.node.id}" was executing and the phase said paused`,
        );
      },
    });

    const running = runLoopGraph(graph, {
      runId: 'pause-honesty-throughout',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });

    // Continue each time it stops, so the run walks the whole graph while a pause is
    // repeatedly asked for and granted.
    for (let round = 0; round < 10; round += 1) {
      await settle(4);
      if (controlPhase(controller.report().state) === 'paused') {
        controller.continueRun();
      }
    }
    const result = await running;
    assert.equal(result.status, 'completed');
    assert.ok(
      watched.headlinesDuringWork.length >= WORK_STEPS_ON_HAPPY_PATH.length,
      'the samples must actually have been taken',
    );
    assert.ok(
      !watched.headlinesDuringWork.includes('Paused'),
      `a work step ran while the window said Paused: ${watched.headlinesDuringWork.join(', ')}`,
    );

    // The judgement this makes explicit, because the first version of this test found
    // it and I would rather it were a rule than a surprise. A paused run may still
    // finish routing itself towards the next work step: a router starts no agent and
    // runs no command, holding one would freeze the run halfway along an edge, and
    // holding a terminal would keep a finished run open forever. So "paused" means no
    // *work* is in flight — which is the claim DSP-29 actually makes — and the picture
    // may advance by a router's width after the pause arrives.
    for (const nodeId of ranWhilePaused) {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      assert.ok(
        node?.kind === 'router' || node?.kind === 'terminal',
        `"${nodeId}" is a ${node?.kind ?? 'missing'} node and it executed while the run reported ` +
          'itself paused. Only routing and terminals may do that.',
      );
    }
  });

  it('does not spend the held step\'s own time bound while it waits', async () => {
    // `implementer` is bounded at 90 minutes in our graph. A person thinking for two
    // hours must not make the step time out: the budget belongs to the work, and a
    // pause that ate it would make pausing the expensive choice at exactly the moment
    // it matters.
    const graph = developmentLoop();
    const clock = createClock();
    const controller = new LoopRunController({ now: clock.now });
    controller.beginRun('pause-costs-no-budget');
    controller.setMode('interactive');

    const watched = watch(controller, { clock });
    const running = runLoopGraph(graph, {
      runId: 'pause-costs-no-budget',
      dryRun: true,
      now: clock.now,
      control: controller,
      executor: watched.executor,
    });

    let advanced = false;
    for (let round = 0; round < 40; round += 1) {
      await settle(4);
      const held = controller.report().state.held;
      if (held === null) {
        continue;
      }
      if (held.nodeId === 'implementer' && !advanced) {
        clock.advanceMinutes(120);
        advanced = true;
      }
      controller.continueRun();
    }

    const result = await running;
    assert.equal(advanced, true, 'the test only means something if the implementer step was held');
    assert.equal(
      result.fault,
      null,
      `waiting for a person must not spend the step's bound. It faulted: ${result.fault === null ? '' : String((result.fault as { kind: string }).kind)}`,
    );
    assert.equal(result.status, 'completed');
  });
});

describe('cancel stays a separate action, and reaches a run that is waiting', () => {
  it('ends a waiting run without starting the step it was holding', async () => {
    const graph = developmentLoop();
    const abort = new AbortController();
    const controller = new LoopRunController();
    controller.beginRun('cancel-while-held', abort.signal);
    controller.setMode('interactive');

    const watched = watch(controller);
    const running = runLoopGraph(graph, {
      runId: 'cancel-while-held',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });

    await waitUntil(
      () => controller.report().state.held?.nodeId === 'coordinator',
      'the first work step to be held',
    );
    abort.abort();

    const result = await running;
    assert.ok(
      !watched.performed.includes('coordinator#1'),
      `a cancel pressed while the run was waiting must not release it into the step it was holding, ` +
        `and it did. It performed: ${watched.performed.join(', ') || '(nothing)'}`,
    );
    assert.equal(result.status, 'runtime-fault');
    assert.match(
      result.fault?.detail ?? '',
      /was never started, so it called no agent, ran no command and changed nothing/,
      `the reason must say what happened to the step. It said: ${result.fault?.detail ?? '(nothing)'}`,
    );
    assert.doesNotMatch(
      result.fault?.reconcile ?? '',
      /real outcome is unknown/,
      'a step that never started has no unknown outcome, and sending a tired person to look for ' +
        `a hung agent that does not exist is a cost. It said: ${result.fault?.reconcile ?? '(nothing)'}`,
    );
  });
});

describe('one run at a time, so a second run cannot make the first one lie', () => {
  it('refuses a second run while a work step is in flight, and the pause still says requested', async () => {
    // The verification of call 008 found the one path that makes the honesty rule
    // report a truth about inputs that have stopped being true: a *second* run
    // starting resets the control, `inFlight` becomes null, and the product says
    // Paused while the first run's agent is still writing. Reachable through the
    // ordinary UI, because the two run handlers each guard only their own binding.
    const graph = developmentLoop();
    const controller = new LoopRunController();
    controller.beginRun('overlap-first-run');

    let insideTheStep = false;
    let secondRun: RunBeginOutcome | null = null;
    let phaseInsideTheStep = '';
    let headlineInsideTheStep = '';
    let detailInsideTheStep = '';
    let noteInsideTheStep = '';
    const watched = watch(controller, {
      duringStep: (context) => {
        if (context.node.id !== 'implementer') {
          return;
        }
        insideTheStep = true;
        // The other window presses Run while this agent is writing.
        secondRun = controller.beginRun('overlap-second-run', new AbortController().signal);
        noteInsideTheStep = controller.requestPause().note;
        phaseInsideTheStep = controlPhase(controller.report().state);
        const report = describeControl(controller.report().state, { runActive: true });
        headlineInsideTheStep = report.headline;
        detailInsideTheStep = report.detail;
      },
    });

    const running = runLoopGraph(graph, {
      runId: 'overlap-first-run',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });

    await waitUntil(() => controlPhase(controller.report().state) === 'paused', 'the run to pause');
    assert.equal(insideTheStep, true, 'the observation was never taken, so nothing below means anything');

    // The sentences first, in the order a person reads them, so a regression fails on
    // what the window says rather than on a boolean behind it.
    assert.notEqual(
      headlineInsideTheStep,
      'Paused',
      `the window said "${headlineInsideTheStep}" while the agent for "implementer" was still writing`,
    );
    assert.doesNotMatch(
      detailInsideTheStep,
      /\bpaused\b|no work step is running/i,
      `the detail claimed a pause the run had not reached. It said: ${detailInsideTheStep}`,
    );
    assert.doesNotMatch(
      noteInsideTheStep,
      /nothing was in flight/i,
      `the note claimed nothing was in flight while the agent was writing. It said: ${noteInsideTheStep}`,
    );
    assert.equal(phaseInsideTheStep, 'pause-requested');

    // And the cause: the second run must have been refused rather than silently
    // replacing the control, so a third caller added later inherits the protection.
    assert.equal(
      secondRun === null ? null : (secondRun as RunBeginOutcome).started,
      false,
      'a second run started while one was walking, which is what clears the step in flight',
    );
    const refusalNote = secondRun === null ? '' : (secondRun as RunBeginOutcome).note;
    assert.match(
      refusalNote,
      /overlap-first-run/,
      `a refusal has to name the run that is already walking, or the person cannot act on it. ` +
        `It said: ${refusalNote}`,
    );
    assert.match(
      refusalNote,
      /Implementer/,
      `and what that run is doing right now. It said: ${refusalNote}`,
    );
    assert.equal(
      controller.report().runId,
      'overlap-first-run',
      'the refused run must not have taken the control over',
    );

    controller.continueRun();
    const result = await running;
    assert.equal(result.status, 'completed');
    assert.equal(
      watched.performed.filter((entry) => entry === 'implementer#1').length,
      1,
      'the refused second run must not have made the first one repeat a step',
    );
  });

  it('leaves the first run hearing its own Cancel after a second run is refused', async () => {
    // The second consequence of the same defect: `attachAbort` replaced the first
    // run's signal, so the run stopped hearing the Cancel the person pressed for it.
    const graph = developmentLoop();
    const abort = new AbortController();
    const controller = new LoopRunController();
    controller.beginRun('overlap-cancel-first', abort.signal);
    controller.setMode('interactive');

    const watched = watch(controller);
    let settled = false;
    const running = runLoopGraph(graph, {
      runId: 'overlap-cancel-first',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    }).then((result) => {
      settled = true;
      return result;
    });

    await waitUntil(
      () => controller.report().state.held?.nodeId === 'coordinator',
      'the first work step to be held',
    );
    const secondRun = controller.beginRun('overlap-cancel-second', new AbortController().signal);
    assert.equal(secondRun.started, false, 'the second run had to be refused for this to test anything');

    abort.abort();
    await settle(200);

    assert.equal(
      settled,
      true,
      'the run did not end after the person cancelled it: a second run had taken its signal away, ' +
        'so its own Cancel was no longer heard',
    );
    const result = await running;
    assert.equal(result.status, 'runtime-fault');
    assert.ok(
      !watched.performed.includes('coordinator#1'),
      `a cancelled run must not be released into the step it was holding. It performed: ${watched.performed.join(', ') || '(nothing)'}`,
    );
  });
});

describe('interactive mode asks about work and nothing else', () => {
  it('holds exactly the agent and gate steps, and never the router or the terminal', async () => {
    const graph = developmentLoop();
    const controller = new LoopRunController();
    controller.beginRun('interactive-what-waits');
    controller.setMode('interactive');

    const watched = watch(controller);
    const running = runLoopGraph(graph, {
      runId: 'interactive-what-waits',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });

    for (let round = 0; round < 40; round += 1) {
      await settle(4);
      if (controller.report().state.held !== null) {
        controller.continueRun();
      }
    }
    const result = await running;

    assert.equal(result.status, 'completed');
    assert.deepEqual(
      heldNodes(result.journal),
      WORK_STEPS_ON_HAPPY_PATH,
      'interactive mode must ask before each step that starts an agent or runs a command, and ' +
        'must not ask about the graph walking along an edge or reaching a terminal',
    );
    assert.ok(
      !heldNodes(result.journal).includes('route-next-step'),
      'a person asked to approve a router would learn nothing and would stop reading the prompts',
    );
    assert.ok(
      !heldNodes(result.journal).includes('run-complete'),
      'a terminal is the runner stopping, not work',
    );
  });

  it('holds nothing at all in autonomous mode', async () => {
    const graph = developmentLoop();
    const controller = new LoopRunController();
    controller.beginRun('autonomous-asks-nothing');

    const watched = watch(controller);
    const result = await runLoopGraph(graph, {
      runId: 'autonomous-asks-nothing',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(heldNodes(result.journal), [], 'an autonomous run continues within the graph rules');
  });

  it('a human step still waits in autonomous mode, by its own mechanism', async () => {
    const graph = developmentLoop();
    const controller = new LoopRunController();
    controller.beginRun('human-waits-anyway');

    // No scripted answer for the human entry, so nothing answers for the person.
    const watched = watch(controller, {
      decisions: [],
      unscripted: 'awaiting-human-at-human-nodes',
    });
    const result = await runLoopGraph(graph, {
      runId: 'human-waits-anyway',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });

    assert.equal(
      result.status,
      'awaiting-human',
      'autonomous means the loop continues within the graph rules, and an explicit human step ' +
        'is one of those rules',
    );
    assert.equal(result.awaiting?.nodeId, 'niclas-mandate');
    assert.deepEqual(
      heldNodes(result.journal),
      [],
      'the human step waits by its own mechanism and not by this gate, so DSP-31 has one thing ' +
        'to build on rather than two to reconcile',
    );
  });
});

describe('switching mode mid-run changes who decides the next step, and nothing else', () => {
  it('preserves the run, its path, its history and every budget it has spent', async () => {
    const graph = developmentLoop();
    const baseline = await runAutonomousBaseline(graph, 'mode-switch-mid-run');

    const controller = new LoopRunController();
    controller.beginRun('mode-switch-mid-run');
    const watched = watch(controller, {
      duringStep: (context) => {
        // Switched while the second work step is in flight — mid-run and mid-step,
        // which is when a reset would do the most damage and when a person most wants
        // to take over.
        if (context.node.id === 'implementer') {
          controller.setMode('interactive');
        }
      },
    });

    const running = runLoopGraph(graph, {
      runId: 'mode-switch-mid-run',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });
    for (let round = 0; round < 40; round += 1) {
      await settle(4);
      if (controller.report().state.held !== null) {
        controller.continueRun();
      }
    }
    const switched = await running;

    assert.deepEqual(
      shapeOf(switched),
      shapeOf(baseline),
      'switching mode moved something other than who decides the next step',
    );
    assert.equal(switched.runId, baseline.runId, 'switching mode must not create a new run');
    assert.deepEqual(
      watched.performed,
      [...new Set(watched.performed)],
      `no step may be performed twice because the mode changed: ${watched.performed.join(', ')}`,
    );
    assert.deepEqual(
      heldNodes(switched.journal),
      ['verifier', 'implementation-review', 'coordinator-report'],
      'the switch takes effect from the next work step, and does not reach back to steps already done',
    );

    // The negative control for the comparison above. A comparison that matched
    // nothing would look exactly like one that passed, which is how the last two
    // verifications of this run each nearly reported a catastrophe that did not exist.
    // So the same comparison is pointed at a run that genuinely differs by one edge,
    // and is required to say so.
    const redirected: LoopGraph = {
      ...graph,
      edges: graph.edges.map((edge) => (edge.id === 'e08' ? { ...edge, to: 'researcher' } : edge)),
    };
    assert.ok(
      graph.edges.some((edge) => edge.id === 'e08'),
      'the negative control needs edge e08 to exist',
    );
    const different = await runAutonomousBaseline(redirected, 'mode-switch-mid-run');
    assert.notDeepEqual(
      shapeOf(different),
      shapeOf(baseline),
      'the comparison used above does not discriminate: it reported two genuinely different runs ' +
        'as identical, so its passing would have meant nothing',
    );
  });

  it('spends no extra call, so a re-moded run gets no fresh allowance', async () => {
    const graph = developmentLoop();
    const baseline = await runAutonomousBaseline(graph, 'mode-switch-budget');

    const controller = new LoopRunController();
    controller.beginRun('mode-switch-budget');
    controller.setMode('interactive');
    const watched = watch(controller, {
      duringStep: (context) => {
        if (context.node.id === 'verifier') {
          controller.setMode('autonomous');
        }
      },
    });

    const running = runLoopGraph(graph, {
      runId: 'mode-switch-budget',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });
    for (let round = 0; round < 40; round += 1) {
      await settle(4);
      if (controller.report().state.held !== null) {
        controller.continueRun();
      }
    }
    const result = await running;

    assert.equal(
      result.usage.calls,
      baseline.usage.calls,
      'a run that changed mode twice must have spent exactly the calls it would otherwise have ' +
        'spent. A re-moded run silently getting a fresh allowance is a real cost to the user and ' +
        'invisible until it is expensive.',
    );
    assert.deepEqual(result.limitsReached, baseline.limitsReached);
    assert.equal(result.usage.reworkRounds, baseline.usage.reworkRounds);
    assert.equal(
      heldNodes(result.journal).includes('coordinator-report'),
      false,
      'switching back to autonomous mid-run stops the asking from the next work step',
    );
  });
});

describe('the run record vocabulary is added to, not changed', () => {
  it('keeps every journal kind that existed before, in the order it had', () => {
    assert.deepEqual(
      JOURNAL_KINDS.slice(0, 9),
      [
        'run-started',
        'node-entered',
        'node-produced',
        'edge-taken',
        'limit-reached',
        'runtime-fault',
        'awaiting-human',
        'run-ended',
        'refused',
      ],
      'a record written before DSP-29 must still parse, so the existing vocabulary may only be ' +
        'added to',
    );
    assert.deepEqual(JOURNAL_KINDS.slice(9, 11), ['run-held', 'run-released']);
    // DSP-51's pair, appended after them for the same reason they were appended: a
    // record written by an earlier build must still parse unchanged.
    assert.deepEqual(JOURNAL_KINDS.slice(11, 13), ['waiting-for-person', 'person-answered']);
    // DSP-74's, appended after those for the same reason again. The rule this test is
    // about is the position, not the length: every kind an older build knows is still
    // where it was, so its records still parse.
    assert.deepEqual(JOURNAL_KINDS.slice(13), ['result-filed']);
  });

  it('renders the added kinds rather than printing undefined into the journal', () => {
    for (const kind of [
      'run-held',
      'run-released',
      'waiting-for-person',
      'person-answered',
      'result-filed',
    ] as const) {
      const line = formatJournalEntry({
        seq: 1,
        atIso: '2026-09-18T09:00:00.000Z',
        sinceStartMs: 1000,
        kind,
        nodeId: 'implementer',
        detail: 'A pause was asked for.',
      });
      assert.doesNotMatch(line, /undefined/, `${kind} has no marker in the journal's own table`);
      assert.match(line, /implementer/);
    }
  });

  it('records the hold and the release against the node they concern', async () => {
    const graph = developmentLoop();
    const controller = new LoopRunController();
    controller.beginRun('journal-records-the-wait');
    controller.setMode('interactive');

    const watched = watch(controller);
    const running = runLoopGraph(graph, {
      runId: 'journal-records-the-wait',
      dryRun: true,
      control: controller,
      executor: watched.executor,
    });
    for (let round = 0; round < 40; round += 1) {
      await settle(4);
      if (controller.report().state.held !== null) {
        controller.continueRun();
      }
    }
    const result = await running;

    const held = result.journal.find((entry) => entry.kind === 'run-held');
    const released = result.journal.find((entry) => entry.kind === 'run-released');
    assert.equal(held?.nodeId, 'coordinator');
    assert.equal(held?.data?.['hold'], 'interactive-mode');
    assert.equal(released?.nodeId, 'coordinator');
    assert.equal(released?.data?.['started'], true);
    assert.ok(
      (result.journal.findIndex((entry) => entry.kind === 'run-held') ?? -1) <
        result.journal.findIndex((entry) => entry.kind === 'node-entered' && entry.nodeId === 'coordinator'),
      'the hold is recorded before the node is entered, because a node the graph view marks ' +
        'running while it is actually held would be the picture claiming work that is not happening',
    );
  });
});
