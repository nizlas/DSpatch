/**
 * Who decides that the next work step starts — the rules, on their own.
 *
 * DSP-29 and DSP-30. These test `shared/loop-control.ts` and nothing else, which is
 * the point of that module existing: a rule living inside the runner's control flow or
 * inside a React component could not be tested in this repository at all, and the two
 * claims this call has to make good on are exactly the sort that get asserted in a
 * report and never checked.
 *
 * The two hardest ones have a test each and neither is a count:
 *
 * - **Nothing may report a pause while work is in flight.** Asserted not on the
 *   handful of states this file happens to build, but on every state reachable by
 *   every sequence of five user and runner events — 16,807 of them.
 * - **Switching mode changes who decides the next step and nothing else.** Asserted by
 *   comparing the whole state either side of the switch, so a field added later is
 *   covered without anyone remembering to add it here.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_LOOP_MODE,
  LOOP_MODES,
  LOOP_MODE_CHOICES,
  applyControlAction,
  controlActionsFor,
  controlForNewRun,
  controlPhase,
  decideNextStep,
  describeControl,
  initialControlState,
  isWorkStep,
  stepWorkFor,
  type LoopControlAction,
  type LoopControlState,
  type StepRef,
} from '../src/shared/loop-control';
import { NODE_KINDS } from '../src/shared/loop-graph';

function step(overrides: Partial<StepRef> = {}): StepRef {
  return {
    nodeId: 'implementer',
    nodeLabel: 'Implementer',
    occurrence: 1,
    callId: 1,
    work: 'agent',
    ...overrides,
  };
}

const agentStep = step();
const commandStep = step({ nodeId: 'gate', nodeLabel: 'Project test', callId: 2, work: 'command' });
const routerStep = step({ nodeId: 'route', nodeLabel: 'Route', callId: 3, work: 'bookkeeping' });
const humanStep = step({ nodeId: 'approve', nodeLabel: 'You approve', callId: 4, work: 'human' });

function drive(start: LoopControlState, actions: readonly LoopControlAction[]): LoopControlState {
  return actions.reduce(applyControlAction, start);
}

describe('what a step would do decides whether it waits', () => {
  it('maps every node kind the format has, so a new kind cannot fall through silently', () => {
    const mapped = NODE_KINDS.map((kind) => [kind, stepWorkFor(kind)] as const);
    assert.deepEqual(Object.fromEntries(mapped), {
      agent: 'agent',
      gate: 'command',
      external: 'external',
      human: 'human',
      router: 'bookkeeping',
      terminal: 'bookkeeping',
    });
  });

  it('counts starting an agent, running a command and handing work outside as work', () => {
    assert.equal(isWorkStep('agent'), true, 'starting an agent is work');
    assert.equal(isWorkStep('command'), true, 'running a command is work');
    assert.equal(isWorkStep('external'), true, 'handing a step to someone else is work');
    assert.equal(
      isWorkStep('bookkeeping'),
      false,
      'routing along an edge is not work, and a person asked to approve it would learn nothing',
    );
    assert.equal(
      isWorkStep('human'),
      false,
      'a human step does not wait because of the mode; it waits because it is a human step',
    );
  });
});

describe('pause is a request until the work step actually ends', () => {
  it('says pause requested — not paused — while the agent is still writing', () => {
    const state = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: agentStep },
      { kind: 'request-pause' },
    ]);

    assert.equal(
      controlPhase(state),
      'pause-requested',
      'a pause asked for while a provider call is in flight has been requested and has not arrived',
    );

    const described = describeControl(state, { runActive: true });
    assert.equal(described.headline, 'Pause requested');
    assert.doesNotMatch(
      `${described.headline} ${described.detail}`,
      /\bpaused\b/i,
      'while the agent is still writing, nothing DSpatch shows may contain the word "paused": ' +
        'a pause that claims to have happened while a provider call is in flight is the same ' +
        `class of untruth as a green badge over a failed run. It said: ${described.headline} — ${described.detail}`,
    );
    assert.match(
      described.detail,
      /the agent for "Implementer" is still writing/,
      'the person is told what is actually still happening, not just that the pause is pending',
    );
  });

  it('says pause requested while a command is still running, and names the command', () => {
    const state = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: commandStep },
      { kind: 'request-pause' },
    ]);

    const described = describeControl(state, { runActive: true });
    assert.equal(controlPhase(state), 'pause-requested');
    assert.doesNotMatch(
      `${described.headline} ${described.detail}`,
      /\bpaused\b/i,
      `a command still running is not a paused run. It said: ${described.headline} — ${described.detail}`,
    );
    assert.match(described.detail, /the command for "Project test" is still running/);
  });

  it('becomes paused when the step ends, and only then', () => {
    const requested = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: agentStep },
      { kind: 'request-pause' },
    ]);

    // Nothing else may do it: not asking again, not changing the mode, not a second
    // window pressing the same button. The step ending is the event.
    for (const action of [
      { kind: 'request-pause' } as const,
      { kind: 'set-mode', mode: 'interactive' } as const,
      { kind: 'set-mode', mode: 'autonomous' } as const,
      { kind: 'step-held', step: commandStep } as const,
    ]) {
      assert.equal(
        controlPhase(applyControlAction(requested, action)),
        'pause-requested',
        `"${action.kind}" is not the work step ending, so it must not turn a request into a pause`,
      );
    }

    const arrived = applyControlAction(requested, { kind: 'step-ended', step: agentStep });
    assert.equal(controlPhase(arrived), 'paused');
    assert.equal(describeControl(arrived, { runActive: true }).headline, 'Paused');
  });

  it('ignores a step-ended from a step that is not the one in flight', () => {
    const state = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: agentStep },
      { kind: 'request-pause' },
      // The shape of the hazard `LoopRunAudience.end` already guards on the sending
      // side: a late report from a run or step that has been superseded.
      { kind: 'step-ended', step: commandStep },
    ]);

    assert.equal(
      controlPhase(state),
      'pause-requested',
      'a late report about a different step must not clear the step that is really running, ' +
        'because the product would then say the run had stopped while the agent was still writing',
    );
  });

  it('pauses immediately when nothing is in flight, because nothing has to finish first', () => {
    const state = applyControlAction(initialControlState('autonomous'), { kind: 'request-pause' });
    assert.equal(controlPhase(state), 'paused');
  });

  it('no sequence of events reaches a state that reports paused while work is in flight', () => {
    // The assertion this call most has to earn, so it is not made against the states
    // this file happens to construct. Every sequence of five events over the whole
    // alphabet is driven, and the invariant is checked after each one.
    const alphabet: readonly LoopControlAction[] = [
      { kind: 'request-pause' },
      { kind: 'continue' },
      { kind: 'set-mode', mode: 'autonomous' },
      { kind: 'set-mode', mode: 'interactive' },
      { kind: 'step-held', step: agentStep },
      { kind: 'step-started', step: agentStep },
      { kind: 'step-ended', step: agentStep },
    ];

    let checked = 0;
    const walk = (state: LoopControlState, depth: number, trail: readonly string[]): void => {
      const phase = controlPhase(state);
      checked += 1;
      if (state.inFlight !== null) {
        assert.notEqual(
          phase,
          'paused',
          `a run with "${state.inFlight.nodeLabel}" still in flight reported "paused" after ` +
            `${trail.join(' → ')}. Work was still happening and the product said it had stopped.`,
        );
        assert.doesNotMatch(
          describeControl(state, { runActive: true }).headline,
          /^Paused$/,
          `the headline claimed a pause with "${state.inFlight.nodeLabel}" still in flight, after ${trail.join(' → ')}`,
        );
      }
      if (depth === 0) {
        return;
      }
      for (const action of alphabet) {
        walk(applyControlAction(state, action), depth - 1, [
          ...trail,
          action.kind === 'set-mode' ? `set-mode(${action.mode})` : action.kind,
        ]);
      }
    };

    for (const mode of LOOP_MODES) {
      walk(initialControlState(mode), 5, [`start ${mode}`]);
    }
    assert.ok(checked > 30_000, `the walk must actually have run; it checked ${String(checked)} states`);
  });
});

describe('what waits, and what does not', () => {
  it('holds an agent step in interactive mode and starts it in autonomous mode', () => {
    const interactive = decideNextStep(initialControlState('interactive'), agentStep);
    assert.equal(interactive.start, false);
    assert.equal(interactive.start === false && interactive.hold, 'interactive-mode');

    const autonomous = decideNextStep(initialControlState('autonomous'), agentStep);
    assert.equal(autonomous.start, true);
  });

  it('holds a command step in interactive mode', () => {
    const decision = decideNextStep(initialControlState('interactive'), commandStep);
    assert.equal(decision.start, false, 'running a command is work and interactive mode asks first');
    assert.equal(decision.start === false && decision.hold, 'interactive-mode');
  });

  it('never asks about routing, in either mode and even while paused', () => {
    for (const mode of LOOP_MODES) {
      for (const paused of [false, true]) {
        const state = { ...initialControlState(mode), pauseRequested: paused };
        assert.equal(
          decideNextStep(state, routerStep).start,
          true,
          `${mode}${paused ? ', paused' : ''}: the graph walking along an edge starts no agent and ` +
            'runs no command, so asking a person to approve it would teach them nothing and would ' +
            'train them to click past the prompts that matter',
        );
      }
    }
  });

  it('holds a human step in autonomous mode with nothing else asking it to', () => {
    const decision = decideNextStep(initialControlState('autonomous'), humanStep);
    assert.equal(
      decision.start,
      false,
      'an explicit human step waits for its answer in either mode — that is what makes it a ' +
        'human step rather than a comment',
    );
    assert.equal(decision.start === false && decision.hold, 'human-node');
  });

  it('no state, however reached, lets a human step through', () => {
    // Including the one that would be easiest to get wrong: a release the user granted
    // for the work step they were actually looking at.
    for (const mode of LOOP_MODES) {
      for (const pauseRequested of [false, true]) {
        for (const released of [false, true]) {
          const state: LoopControlState = {
            mode,
            pauseRequested,
            released,
            inFlight: null,
            held: null,
          };
          assert.equal(
            decideNextStep(state, humanStep).start,
            false,
            `mode=${mode} pause=${String(pauseRequested)} released=${String(released)}: a human ` +
              'step must still wait. Releasing one would make a human node a comment.',
          );
        }
      }
    }
  });

  it('a pause outranks a release granted just before it', () => {
    const state = drive(initialControlState('autonomous'), [
      { kind: 'continue' },
      { kind: 'request-pause' },
    ]);
    const decision = decideNextStep(state, agentStep);
    assert.equal(
      decision.start,
      false,
      'the newer instruction is the pause; a step starting anyway would be the product ignoring the button',
    );
    assert.equal(decision.start === false && decision.hold, 'pause');
  });

  it('a release is spent on one step, so interactive mode stays a decision per step', () => {
    const released = applyControlAction(initialControlState('interactive'), { kind: 'continue' });
    assert.equal(decideNextStep(released, agentStep).start, true, 'the released step starts');

    const afterItStarted = applyControlAction(released, { kind: 'step-started', step: agentStep });
    const next = decideNextStep(afterItStarted, commandStep);
    assert.equal(
      next.start,
      false,
      'continuing lets one work step go, not the rest of the run — otherwise Continue would be ' +
        'a way of silently switching autonomy back on',
    );
    assert.equal(next.start === false && next.hold, 'interactive-mode');
  });

  it('continuing out of a pause in autonomous mode does not ask again', () => {
    const state = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: agentStep },
      { kind: 'request-pause' },
      { kind: 'step-ended', step: agentStep },
      { kind: 'continue' },
    ]);
    assert.equal(decideNextStep(state, agentStep).start, true);
    assert.equal(
      decideNextStep(applyControlAction(state, { kind: 'step-started', step: agentStep }), commandStep)
        .start,
      true,
      'an autonomous run that was paused and continued is autonomous again',
    );
  });
});

describe('switching mode changes who decides the next step, and nothing else', () => {
  it('leaves every other field of the control exactly as it was', () => {
    // Mid-run and mid-step, which is when it matters and when a reset would be worst.
    const midRun = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: agentStep },
      { kind: 'request-pause' },
    ]);

    const switched = applyControlAction(midRun, { kind: 'set-mode', mode: 'interactive' });

    assert.equal(switched.mode, 'interactive');
    // Compared as whole objects rather than field by field, so a sixth field added
    // later is covered without anyone remembering to extend this test.
    assert.deepEqual(
      { ...switched, mode: null },
      { ...midRun, mode: null },
      'switching mode moved something other than the mode. If switching could quietly change ' +
        'the run, nobody would dare switch it at the moment they most want to.',
    );
  });

  it('is reversible and carries nothing back with it', () => {
    const start = drive(initialControlState('autonomous'), [
      { kind: 'step-held', step: commandStep },
    ]);
    const there = applyControlAction(start, { kind: 'set-mode', mode: 'interactive' });
    const andBack = applyControlAction(there, { kind: 'set-mode', mode: 'autonomous' });
    assert.deepEqual(andBack, start, 'a mode switch and its reverse leave the control where it was');
  });

  it('a new run keeps the mode and drops the previous run pause', () => {
    const ended = drive(initialControlState('interactive'), [
      { kind: 'step-started', step: agentStep },
      { kind: 'request-pause' },
      { kind: 'step-ended', step: agentStep },
    ]);
    const next = controlForNewRun(ended);
    assert.equal(next.mode, 'interactive', 'the mode is the standing answer and survives the run');
    assert.equal(
      next.pauseRequested,
      false,
      'a pause asked of a run that has ended must not pause the next one before its first step',
    );
    assert.deepEqual(next, initialControlState('interactive'));
  });
});

describe('the words and the buttons', () => {
  it('offers Pause and Continue, and neither can do anything with no run', () => {
    const offers = controlActionsFor(initialControlState(), { runActive: false });
    assert.deepEqual(
      offers.map((offer) => offer.id),
      ['pause', 'continue'],
    );
    assert.ok(
      offers.every((offer) => !offer.enabled),
      'with nothing running there is nothing to pause and nothing to continue',
    );
    assert.ok(
      offers.every((offer) => offer.title.trim() !== ''),
      'a disabled button that does not say why is a button that looks broken',
    );
  });

  it('enables Continue exactly when there is something a click would release', () => {
    const paused = drive(initialControlState('autonomous'), [{ kind: 'request-pause' }]);
    const held = drive(initialControlState('interactive'), [{ kind: 'step-held', step: agentStep }]);
    const humanHeld = drive(initialControlState('autonomous'), [
      { kind: 'step-held', step: humanStep },
    ]);
    const running = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: agentStep },
    ]);

    const continueOf = (state: LoopControlState): boolean =>
      controlActionsFor(state, { runActive: true }).find((offer) => offer.id === 'continue')
        ?.enabled === true;

    assert.equal(continueOf(paused), true, 'a paused run can be continued');
    assert.equal(continueOf(held), true, 'a held step can be let go');
    assert.equal(
      continueOf(humanHeld),
      false,
      'Continue cannot answer a human step, and offering it as though it could would be a ' +
        'button that appears to do something and does not',
    );
    assert.equal(continueOf(running), false, 'a run that is simply walking has nothing to continue');
  });

  it('disables Pause once a pause has been asked for, rather than asking twice', () => {
    const requested = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: agentStep },
      { kind: 'request-pause' },
    ]);
    const pause = controlActionsFor(requested, { runActive: true }).find((o) => o.id === 'pause');
    assert.equal(pause?.enabled, false);
  });

  it('points at Cancel as the separate action for work in progress', () => {
    const requested = drive(initialControlState('autonomous'), [
      { kind: 'step-started', step: commandStep },
      { kind: 'request-pause' },
    ]);
    assert.match(
      describeControl(requested, { runActive: true }).detail,
      /Cancel/,
      'the person watching a step they wanted stopped must be told which button abandons it, ' +
        'or pause becomes the button that looks broken',
    );
  });

  it('describes both modes distinctly, in words and in the tooltip', () => {
    assert.deepEqual(
      LOOP_MODE_CHOICES.map((choice) => choice.mode),
      [...LOOP_MODES],
    );
    const labels = new Set(LOOP_MODE_CHOICES.map((choice) => choice.label));
    assert.equal(labels.size, LOOP_MODE_CHOICES.length, 'two modes with one label are one mode');
    for (const choice of LOOP_MODE_CHOICES) {
      assert.ok(choice.title.length > 40, `${choice.mode} needs a tooltip that says what it means`);
    }
  });

  it('says what is happening when no run is walking, without claiming a state of one', () => {
    const report = describeControl(initialControlState('interactive'), { runActive: false });
    assert.match(report.detail, /No loop is running/);
    assert.doesNotMatch(report.headline, /^Paused$/);
  });

  it('defaults to autonomous, which is what the loop did before any of this existed', () => {
    assert.equal(DEFAULT_LOOP_MODE, 'autonomous');
    assert.equal(initialControlState().mode, 'autonomous');
    assert.equal(controlPhase(initialControlState()), 'ready');
  });
});
