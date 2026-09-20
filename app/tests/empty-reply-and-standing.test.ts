/**
 * An empty reply is not a success, and a stall is not a mystery (DSP-57).
 *
 * This is the reliability half of what DSpatch adds over talking to an agent
 * directly, and it is the half a person cannot work around themselves: they can
 * see that nothing is happening, but not whether anything still is.
 *
 * Every comparison here has a negative control beside it. `docs/DEVELOPMENT_LOOP.md`
 * lists six ways this project has already fooled itself, and the relevant one is
 * asserting that a rule exists rather than measuring that it bites.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COULD_NOT_CHECK_OUTCOME,
  emptyReplyOutcome,
  UNCLEAR_OUTCOME,
  undeclaredReadableOutcome,
} from '../src/shared/loop-chat';
import { conversationStanding, type LoopTurn } from '../src/shared/loop-transcript';
import { InstructionQueue } from '../src/main/instruction-queue';

function turn(overrides: Partial<LoopTurn> = {}): LoopTurn {
  return {
    runId: 'chat-loop-1',
    mandate: 'Check whether this project builds',
    sentAtUtc: '2026-09-19T12:00:00.000Z',
    replies: [],
    cancelRequested: false,
    abandoned: false,
    ending: null,
    ...overrides,
  };
}

describe('silence is never a successful result', () => {
  /**
   * The chat loop survived this by accident: both its agent nodes happen to draw
   * a readable fallback, so an empty reply already routed somewhere honest. The
   * accident is what is being replaced by a rule.
   */
  it('takes the drawing\u2019s own name for an unestablished result where there is one', () => {
    assert.equal(emptyReplyOutcome(['succeeded', UNCLEAR_OUTCOME])?.outcome, UNCLEAR_OUTCOME);
    assert.equal(
      emptyReplyOutcome(['met', 'not-met', COULD_NOT_CHECK_OUTCOME])?.outcome,
      COULD_NOT_CHECK_OUTCOME,
    );
    assert.match(
      emptyReplyOutcome(['succeeded', UNCLEAR_OUTCOME])?.why ?? '',
      /An empty reply is not a result/,
    );
  });

  /**
   * The hole. A node drawing neither fallback — `dspatch-live-duration`'s
   * implementer is one — used to reach plain `success` from an empty reply,
   * which is the same product a step that did the work and said so produces.
   * `null` here is what makes the executor raise a fault instead.
   */
  it('gives a node with no such name nothing to route on, rather than success', () => {
    assert.equal(emptyReplyOutcome([]), null);
    assert.equal(emptyReplyOutcome(['succeeded']), null);
    assert.equal(emptyReplyOutcome(['pass', 'fail']), null);
  });

  /**
   * The negative control, and the one that matters most on this card.
   *
   * `productFromAssistantText` used to fall through to `undeclaredReadableOutcome`
   * for an empty reply, so this reproduces the old path exactly. It must return
   * "nothing declared" for a node with no fallback — which is precisely what the
   * caller then read as success. If this ever stops returning `null`, the test
   * above has stopped describing a real defect.
   */
  it('negative control: the old path answered the same way for silence and for prose', () => {
    assert.equal(undeclaredReadableOutcome(['succeeded']), null);
    // Same answer whether the agent wrote nothing or wrote a page: that
    // indistinguishability is the defect, and it is why the empty case had to be
    // decided before this function is consulted rather than inside it.
    assert.equal(undeclaredReadableOutcome(['pass', 'fail']), null);
  });
});

describe('who is working, on what, waiting for what, and what next', () => {
  it('answers all four for a run that is walking', () => {
    const standing = conversationStanding({
      turn: turn(),
      stillWatching: true,
      currentStepLabel: 'Do what was asked',
      instructions: [],
    });
    assert.equal(standing.standing, 'active');
    assert.equal(standing.activityIsKnown, true);
    assert.match(standing.whoIsWorking, /“Do what was asked” is the current step/);
    assert.match(standing.onWhat, /Check whether this project builds/);
    assert.match(standing.waitingFor, /first step to answer/);
    assert.match(standing.whatHappensNext, /handover to the next step is marked in this thread/);
  });

  /**
   * §9: *do not present a running animation as proof of activity when activity
   * is not known.* `activityIsKnown` is what the window's pulse hangs off, so
   * this is the assertion that keeps the rule enforceable.
   */
  it('reports activity as unknown, not active, once DSpatch has stopped watching', () => {
    const standing = conversationStanding({
      turn: turn(),
      stillWatching: false,
      currentStepLabel: 'Do what was asked',
      instructions: [],
    });
    assert.equal(standing.standing, 'unknown');
    assert.equal(standing.activityIsKnown, false);
    assert.match(standing.whoIsWorking, /Unknown/);
    assert.match(standing.waitingFor, /no animation on this screen is evidence/);
    // DSP-57 #4: a concrete next action that repeats nothing.
    assert.match(standing.whatHappensNext, /will not repeat a step whose outcome it does not know/);
  });

  it('tells a requested stop from an actual one', () => {
    const asked = conversationStanding({
      turn: turn({ cancelRequested: true }),
      stillWatching: true,
      currentStepLabel: 'Do what was asked',
      instructions: [],
    });
    assert.equal(asked.standing, 'stop-requested');
    assert.equal(asked.activityIsKnown, false);
    assert.match(asked.whoIsWorking, /asking is not stopping/);

    const stopped = conversationStanding({
      turn: turn({
        cancelRequested: true,
        ending: {
          kind: 'cancelled',
          text: 'This run was stopped before it finished.',
          terminalNodeId: null,
          terminalLabel: null,
          outcome: null,
        },
      }),
      stillWatching: true,
      currentStepLabel: null,
      instructions: [],
    });
    assert.equal(stopped.standing, 'stopped');
    assert.match(stopped.whatHappensNext, /nothing was undone and nothing was replayed/);
  });

  it('counts the user\u2019s waiting messages into what happens next', () => {
    const standing = conversationStanding({
      turn: turn(),
      stillWatching: true,
      currentStepLabel: 'Do what was asked',
      instructions: [
        {
          id: 'msg-1',
          runId: 'chat-loop-1',
          text: 'also check the Linux build',
          receivedAtUtc: '2026-09-19T12:00:10.000Z',
          delivered: null,
          runEnded: false,
        },
      ],
    });
    assert.match(standing.whatHappensNext, /One message of yours is waiting/);
  });

  it('says a message never reached a step once the run has ended', () => {
    const standing = conversationStanding({
      turn: turn({
        ending: {
          kind: 'completed',
          text: 'The loop ran to a terminal step and stopped.',
          terminalNodeId: 'done',
          terminalLabel: 'Assignment met',
          outcome: null,
        },
      }),
      stillWatching: true,
      currentStepLabel: null,
      instructions: [
        {
          id: 'msg-1',
          runId: 'chat-loop-1',
          text: 'also check the Linux build',
          receivedAtUtc: '2026-09-19T12:00:10.000Z',
          delivered: null,
          runEnded: false,
        },
      ],
    });
    assert.match(standing.whatHappensNext, /never reached a step/);
  });

  it('says so plainly when there is no run at all', () => {
    const standing = conversationStanding({
      turn: null,
      stillWatching: false,
      currentStepLabel: null,
      instructions: [],
    });
    assert.equal(standing.standing, 'idle');
    assert.equal(standing.activityIsKnown, true);
  });
});

describe('the queue behind a message into a run', () => {
  it('hands a run\u2019s messages over once and only once', () => {
    const queue = new InstructionQueue();
    queue.add('run-1', 'first', 'a');
    queue.add('run-1', 'second', 'b');
    assert.deepEqual(
      queue.takeFor('run-1').map((entry) => entry.text),
      ['first', 'second'],
    );
    // Draining is the delivery, so a second step must not be given them again:
    // an instruction applied twice cannot be un-applied.
    assert.deepEqual(queue.takeFor('run-1'), []);
  });

  it('never hands one run\u2019s messages to another', () => {
    const queue = new InstructionQueue();
    queue.add('run-1', 'for the first run', 'a');
    queue.add('run-2', 'for the second', 'b');
    assert.deepEqual(
      queue.takeFor('run-2').map((entry) => entry.text),
      ['for the second'],
    );
    assert.deepEqual(
      queue.peekFor('run-1').map((entry) => entry.text),
      ['for the first run'],
    );
  });

  it('gives back what was never delivered when a run is released', () => {
    const queue = new InstructionQueue();
    queue.add('run-1', 'nobody read this', 'a');
    assert.deepEqual(
      queue.releaseRun('run-1').map((entry) => entry.text),
      ['nobody read this'],
    );
    // And it is gone, so it cannot reach the next run.
    assert.deepEqual(queue.peekFor('run-1'), []);
  });

  it('mints distinct ids so two messages cannot be confused', () => {
    const queue = new InstructionQueue();
    const first = queue.add('run-1', 'one', '2026-09-19T12:00:00.000Z');
    const second = queue.add('run-1', 'two', '2026-09-19T12:00:00.000Z');
    assert.notEqual(first.id, second.id);
  });
});
