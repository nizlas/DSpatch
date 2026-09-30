/**
 * Two things that must hold when a person presses Cancel, and one that must hold
 * when the machinery does not.
 *
 * **DSP-37: stop means stop.** `runLoopGraph` used to contain no reference to a
 * cancel signal at all, so a cancel was noticed only by whatever the executor
 * happened to check — and the live executor checks it in its agent branch and not in
 * its gate branch. A cancel pressed after an agent produced and before the next node
 * was entered was therefore not seen, and if the next node was a gate, DSpatch
 * spawned the person's own build or test command after they had said stop. That is
 * the assertion the first suite makes: the command must not run.
 *
 * **DSP-38: a claim that is always released.** Both run handlers in `main.ts` claim
 * the loop control and then enter the `try` whose `finally` releases it. Anything
 * that threw between the two would leave the control held by a run that is not
 * walking, and the Verifier of run `20260917-204500-obs18` measured what follows:
 * nothing a person can press recovers it, and every later run is refused by a
 * sentence naming a run that does not exist. Nothing in the old gap could throw, so
 * the second suite tests a **guard rather than a live defect** — it simulates the
 * throw, because no statement in that gap will produce one. It is here because the
 * trigger is one line of bookkeeping added between the claim and the `try` by
 * someone who did not know that, which is a change a test can refuse and a comment
 * cannot.
 *
 * Nothing here can spend a provider turn: every run is driven by
 * `createDryRunExecutor`, which closes over no provider at all.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LoopRunController } from '../src/main/loop-control-runtime';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import type { LoopGraph } from '../src/shared/loop-graph';
import {
  createDryRunExecutor,
  runLoopGraph,
  type RunResult,
  type StepExecutor,
} from '../src/shared/loop-run';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function developmentLoop(): LoopGraph {
  const loaded = loadLoopGraph(
    fs.readFileSync(
      path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json'),
      'utf8',
    ),
    { resolveRole: createFileRoleResolver(repoRoot), connectedTargets: ['cursor'] },
  );
  assert.ok(loaded.ok, 'the development loop graph must be valid before it can be run');
  return loaded.graph;
}

/** Mandate, code, verify, accept — the ordinary path through our own loop. */
const HAPPY_PATH = [
  { node: 'niclas-mandate', produce: { kind: 'outcome' as const, outcome: 'start' } },
  { node: 'route-next-step', produce: { kind: 'outcome' as const, outcome: 'implement' } },
  { node: 'implementation-review', produce: { kind: 'outcome' as const, outcome: 'accept' } },
  { node: 'niclas-assessment', produce: { kind: 'outcome' as const, outcome: 'accept' } },
];

interface CancelWalk {
  /** Every node the executor was actually asked to perform, in order. */
  readonly performed: string[];
  /**
   * The gates that reached the point of running a command.
   *
   * Separate from `performed` because this is the list the defect is about. In a live
   * run, reaching a gate's branch of `createLiveExecutor` *is* spawning the project's
   * configured build or test command — so a name in here after a cancel is DSpatch
   * having run the person's command after they said stop.
   */
  readonly commandsRun: string[];
  readonly result: RunResult;
}

/**
 * Walk our own loop, cancelling while one named agent step is in flight.
 *
 * Driven through a real `LoopRunController` in its default autonomous mode, because
 * that is the live shape and the one the control does **not** catch:
 * `awaitStepRelease` answers `start` immediately without consulting the signal, so an
 * autonomous run's cancel is only ever seen by the walk or by the executor.
 */
async function cancelDuring(
  graph: LoopGraph,
  runId: string,
  cancelAfter: string | null,
): Promise<CancelWalk> {
  const abort = new AbortController();
  const controller = new LoopRunController();
  controller.beginRun(runId, abort.signal);

  const performed: string[] = [];
  const commandsRun: string[] = [];
  const inner = createDryRunExecutor({ decisions: HAPPY_PATH });
  const executor: StepExecutor = async (context) => {
    performed.push(context.node.id);
    if (context.node.kind === 'gate') {
      commandsRun.push(context.node.id);
    }
    // Pressed while this very step is in flight, which is the interval the card is
    // about: the agent has produced nothing yet, and by the time it has, the walk is
    // on its way to the next node with nobody reading the signal.
    if (context.node.id === cancelAfter) {
      abort.abort();
    }
    return inner(context);
  };

  const result = await runLoopGraph(graph, {
    runId,
    dryRun: true,
    control: controller,
    signal: abort.signal,
    executor,
  });
  return { performed, commandsRun, result };
}

describe('a cancel between one step producing and the next being entered', () => {
  it('does not enter the next step after a cancel', async () => {
    const graph = developmentLoop();
    // `verifier` is the agent immediately before `implementation-review`. That node
    // used to be a gate (and this test used to watch for a spawned command); it is
    // an agent now, and the property is the same: Cancel after one step produces
    // must stop the walk before the next node is entered, whatever kind it is.
    const cancelled = await cancelDuring(graph, 'cancel-before-next', 'verifier');

    // The user-visible fact first, so a revert fails on what was done to the person's
    // machine rather than on a status code behind it.
    assert.deepEqual(
      cancelled.commandsRun,
      [],
      `DSpatch ran the project's own command after Cancel was pressed. It ran the gate(s): ` +
        `${cancelled.commandsRun.join(', ')}. The walk it took was: ${cancelled.performed.join(' -> ')}`,
    );
    assert.ok(
      !cancelled.performed.includes('implementation-review'),
      `no node may be entered after a cancel, and "implementation-review" was. The walk was: ` +
        `${cancelled.performed.join(' -> ')}`,
    );
    assert.ok(
      cancelled.performed.includes('verifier'),
      'the step that was already running was left to finish, which is what cancel does not undo',
    );

    // And then what the run says about itself, which is the other half of DSP-25: a
    // stopped run has to leave a record a person can act on.
    assert.equal(cancelled.result.status, 'runtime-fault');
    assert.equal(cancelled.result.fault?.kind, 'no-outcome-delivered');
    assert.equal(cancelled.result.fault?.nodeId, 'implementation-review');
    assert.match(
      cancelled.result.fault?.detail ?? '',
      /operator cancelled the run/i,
      `the reason has to say who stopped it. It said: ${cancelled.result.fault?.detail ?? '(nothing)'}`,
    );
    assert.match(
      cancelled.result.fault?.detail ?? '',
      /was never started, so it called no agent, ran no command and changed nothing/,
      `and what happened to the step. It said: ${cancelled.result.fault?.detail ?? '(nothing)'}`,
    );
    assert.doesNotMatch(
      cancelled.result.fault?.reconcile ?? '',
      /real outcome is unknown/,
      'a step that never started has no unknown outcome, and sending a tired person to look for ' +
        `a hung agent that does not exist is a cost. It said: ${cancelled.result.fault?.reconcile ?? '(nothing)'}`,
    );
  });

  it('reaches the next step when nobody cancelled', async () => {
    // The negative control for the test above: a harness that never entered
    // implementation-review would pass `!performed.includes(...)` on a product that
    // always walks on.
    const graph = developmentLoop();
    const ordinary = await cancelDuring(graph, 'no-cancel-at-all', null);

    assert.ok(
      ordinary.performed.includes('implementation-review'),
      `the uncancelled run has to reach the next step, or the assertion above means nothing. Its ` +
        `walk was: ${ordinary.performed.join(' -> ')}`,
    );
    assert.equal(ordinary.result.status, 'completed');
  });

  it('stops before a router too, not only before a gate', async () => {
    // The reason the check is in the walk rather than in the gate branch of the
    // executor: a check in the gate branch protects gates, and a check in the walk
    // protects every node kind in one place. `coordinator` is followed by
    // `route-next-step`, a router — which executes, and which a cancel must also stop.
    const graph = developmentLoop();
    const cancelled = await cancelDuring(graph, 'cancel-before-router', 'coordinator');

    assert.ok(
      !cancelled.performed.includes('route-next-step'),
      `a cancelled run must not keep walking through a router. Its walk was: ` +
        `${cancelled.performed.join(' -> ')}`,
    );
    assert.equal(cancelled.result.fault?.nodeId, 'route-next-step');
  });

  it('leaves a run with no signal behaving exactly as it did before', async () => {
    // `signal` is optional and the CLI, the editor's dry run and every existing test
    // leave it out. A run without one must walk the whole graph, or this change would
    // have been a behaviour change dressed as a guard.
    const graph = developmentLoop();
    const result = await runLoopGraph(graph, {
      runId: 'no-signal-supplied',
      dryRun: true,
      executor: createDryRunExecutor({ decisions: HAPPY_PATH }),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.fault, null);
  });
});

/* ------------------------------------------------------------------------- */
/* DSP-38: the claim and the `try` that releases it                          */
/* ------------------------------------------------------------------------- */

/**
 * What sits between a handler's claim on the control and the `try` that releases it.
 *
 * Read out of `main.ts` rather than modelled, for the reason `loop-run-view.test.ts`
 * reads the stylesheet: the defect this guards against is introduced later by someone
 * adding a line, and only the file itself can answer whether a line was added.
 * Comments and the refusal branch are removed because neither can throw — the refusal
 * returns, and a comment is not a statement.
 */
function gapBetweenClaimAndTry(source: string, from: number): { readonly gap: string; readonly end: number } {
  const claimAt = source.indexOf('loopControl.beginRun(request.runId, abort.signal)', from);
  assert.notEqual(claimAt, -1, 'a run handler that claims the control has to exist for this to test anything');
  const afterClaim = source.indexOf(';', claimAt) + 1;
  const tryMatch = /\n[ \t]*try \{/.exec(source.slice(afterClaim));
  assert.notEqual(tryMatch, null, 'the handler has to reach a `try` for its `finally` to release the control');
  const gapRaw = source.slice(afterClaim, afterClaim + (tryMatch?.index ?? 0));

  // The refusal branch, removed by matching its own braces rather than by a regex, so
  // a longer refusal body cannot silently take the rest of the gap with it.
  const refusalAt = gapRaw.indexOf('if (!began.started) {');
  assert.notEqual(refusalAt, -1, 'the handler has to handle a refusal');
  let depth = 0;
  let refusalEnd = refusalAt;
  for (let at = gapRaw.indexOf('{', refusalAt); at < gapRaw.length; at += 1) {
    if (gapRaw[at] === '{') depth += 1;
    if (gapRaw[at] === '}') {
      depth -= 1;
      if (depth === 0) {
        refusalEnd = at + 1;
        break;
      }
    }
  }

  const gap = `${gapRaw.slice(0, refusalAt)}${gapRaw.slice(refusalEnd)}`
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\/\/[^\n]*/g, '');
  return { gap, end: afterClaim };
}

describe('the loop control is claimed inside the try that releases it', () => {
  it('has nothing between the claim and the try in either run handler', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'app', 'src', 'main', 'main.ts'), 'utf8');

    let from = 0;
    const gaps: string[] = [];
    for (const handler of ['the editor run handler', 'the chat run handler']) {
      const found = gapBetweenClaimAndTry(source, from);
      from = found.end;
      gaps.push(handler);
      assert.equal(
        found.gap.trim(),
        '',
        `${handler} runs a statement between claiming the loop control and entering the \`try\` ` +
          `whose \`finally\` releases it. If that statement ever throws, the control stays held by ` +
          `a run that is not walking: pause, continue, both mode changes, Cancel and a foreign ` +
          `endRun all fail to recover it, and every later run is refused by a sentence naming a ` +
          `run that does not exist. Only restarting DSpatch clears it. Move the statement inside ` +
          `the \`try\`. What was found between them: ${JSON.stringify(found.gap.trim())}`,
      );
    }
    assert.equal(gaps.length, 2, 'both run handlers have to be checked, not just the first one found');
  });

  it('refuses every later run for a run that does not exist, when the claim is not covered', () => {
    // Why the guard above is worth having, measured rather than asserted. Neither
    // shape below is `main.ts` — the handlers are Electron IPC handlers with no test
    // harness — but the controller is the real one, and it is the controller that gets
    // wedged.
    const wedged = new LoopRunController();
    try {
      wedged.beginRun('editor-live-2026-09-18T09-00-00-000Z', new AbortController().signal);
      // One line of bookkeeping, added between the claim and the `try` by someone who
      // did not know what the gap was for. This is the simulation the file's own
      // header is honest about: nothing in the real gap throws today.
      throw new Error('a line of bookkeeping that someone added');
    } catch {
      // The old shape's `finally` never ran, because the `try` had not been entered.
    }

    const later = wedged.beginRun('editor-live-2026-09-18T09-05-00-000Z', new AbortController().signal);
    assert.equal(later.started, false, 'this is the state the guard exists to prevent');
    assert.match(
      later.note,
      /A loop run is already in progress \(editor-live-2026-09-18T09-00-00-000Z\)/,
      `the refusal names a run that is not walking, which is the unrecoverable state. It said: ${later.note}`,
    );

    // The same throw, with the claim covered by the `try` — which is the shape
    // `main.ts` now has, and is what the source-shape test above binds it to.
    const released = new LoopRunController();
    const runId = 'editor-live-2026-09-18T09-10-00-000Z';
    try {
      released.beginRun(runId, new AbortController().signal);
      try {
        throw new Error('a line of bookkeeping that someone added');
      } finally {
        released.endRun(runId);
      }
    } catch {
      // The handler's own `catch` turns this into `{ kind: 'failed' }` for the window.
    }

    assert.equal(released.report().runId, null, 'the control has to be free after a run that threw');
    const next = released.beginRun('editor-live-2026-09-18T09-15-00-000Z', new AbortController().signal);
    assert.equal(
      next.started,
      true,
      `a later run must start after one threw on its way in. It was refused with: ${next.note}`,
    );
  });
});
