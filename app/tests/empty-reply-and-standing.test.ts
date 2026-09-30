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

import { emptyReplyOutcome, undeclaredReadableOutcome } from '../src/shared/loop-chat';
import {
  conversationStanding,
  loopTurnEndingLine,
  stoppedAsAsked,
  type LoopEnding,
  type LoopTurn,
} from '../src/shared/loop-transcript';
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

/**
 * The ending a stopped run reports, with the account it used to show in the column.
 *
 * Kept deliberately long-winded, because the point of the tests below is that this
 * text is withheld at a stop somebody asked for. A short, harmless account would make
 * them pass for the wrong reason.
 */
function cancelledEnding(overrides: Partial<LoopEnding> = {}): LoopEnding {
  return {
    kind: 'cancelled',
    text:
      'This run was stopped before it finished. Completed steps were not replayed and ' +
      'files were left as they are.',
    shortText: null,
    actionNote: null,
    terminalNodeId: null,
    terminalLabel: null,
    outcome: null,
    ...overrides,
  };
}

describe('silence is never a successful result', () => {
  /**
   * The chat loop survived this by accident: both its agent nodes happen to state
   * a readable fallback, so an empty reply already routed somewhere honest. The
   * accident is what is being replaced by a rule.
   *
   * DSP-103 changed where the name comes from and not what it is for. These used to
   * pass the outcome list and rely on one entry being spelled `unclear` or
   * `could-not-check`; they now state `whenUndeclared`, which is what those two
   * drawings say in their own files.
   */
  it('takes the drawing\u2019s own name for an unestablished result where there is one', () => {
    const work = { outcomes: ['succeeded', 'unclear'], whenUndeclared: 'unclear' };
    assert.equal(emptyReplyOutcome(work)?.outcome, 'unclear');
    assert.equal(
      emptyReplyOutcome({
        outcomes: ['met', 'not-met', 'could-not-check'],
        whenUndeclared: 'could-not-check',
      })?.outcome,
      'could-not-check',
    );
    assert.match(emptyReplyOutcome(work)?.why ?? '', /An empty reply is not a result/);
  });

  /**
   * The hole. A node stating no fallback — `dspatch-live-duration`'s implementer is
   * one — used to reach plain `success` from an empty reply, which is the same
   * product a step that did the work and said so produces. `null` here is what makes
   * the executor raise a fault instead.
   *
   * The third case is DSP-103's own: the two words that used to buy the graceful
   * route buy nothing now. A node that spells its outcome `unclear` and states no
   * `whenUndeclared` is answered exactly like a node that spells it anything else,
   * which is the whole of what "no outcome name carries behaviour" has to mean.
   */
  it('gives a node with no such name nothing to route on, rather than success', () => {
    assert.equal(emptyReplyOutcome({}), null);
    assert.equal(emptyReplyOutcome({ outcomes: ['succeeded'] }), null);
    assert.equal(emptyReplyOutcome({ outcomes: ['pass', 'fail'] }), null);
    assert.equal(emptyReplyOutcome({ outcomes: ['succeeded', 'unclear'] }), null);
    assert.equal(emptyReplyOutcome({ outcomes: ['met', 'could-not-check'] }), null);
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
    assert.equal(undeclaredReadableOutcome({ outcomes: ['succeeded'] }), null);
    // Same answer whether the agent wrote nothing or wrote a page: that
    // indistinguishability is the defect, and it is why the empty case had to be
    // decided before this function is consulted rather than inside it.
    assert.equal(undeclaredReadableOutcome({ outcomes: ['pass', 'fail'] }), null);
  });
});

/**
 * What the conversation says about where a run stands — which is now almost nothing.
 *
 * This block has been turned round twice by the same person meeting the same habit,
 * and both turns are worth keeping next to it.
 *
 * It began as four sentences per state, asserted state by state. DSP-87 removed them
 * for a working run, because one of them — *the first step to answer, nothing has
 * come back yet* — came from `replies`, which holds **finished** replies, so a step
 * that had been streaming for four minutes with its text directly above was described
 * underneath as having produced nothing. Niclas met that as *281 s with nothing back*,
 * and the test had passed throughout, because it asserted the sentence rather than
 * the claim.
 *
 * DSP-90 removed them for every other state. The DSP-87 argument for keeping them —
 * these are the states a person may have to act on — was met at Niclas's own
 * cancellation: he pressed stop, was told the run had stopped, and was then given the
 * project's internal vocabulary about what a stop does not replay. *May have to act
 * on* turned out not to be the same as *has to act on*.
 *
 * So what is asserted below is silence, by state, with one exception for the case
 * that still has something to do and one for a circumstance that outlives it. The
 * lesson from the first turn is applied to the second: each claim of silence has a
 * negative control, because a test that asserts wording cannot notice that the
 * wording is false.
 */
describe('where a run stands, and when it says nothing at all', () => {
  it('has nothing to say about a run that is working: the step says it', () => {
    const standing = conversationStanding({ turn: turn(), stillWatching: true });
    assert.equal(standing.standing, 'active');
    assert.equal(standing.activityIsKnown, true);
    assert.equal(standing.actionNote, null);
  });

  /**
   * The negative control for the test above: the claim that was false, stated as the
   * condition that used to produce it. A working run with no finished replies is
   * exactly the state the old block described as *nothing has come back yet*, and it
   * is a state in which a step may well have said a great deal.
   */
  it('cannot describe a working run as silent, because it describes it not at all', () => {
    const working = conversationStanding({
      turn: turn({ replies: [] }),
      stillWatching: true,
    });
    assert.equal(working.actionNote, null);
  });

  /**
   * The assertion DSP-90 exists for.
   *
   * A stop the person asked for and got: `cancelRequested` because they pressed it,
   * a `cancelled` ending because the run said it had stopped. Nothing beside the run,
   * and — the test below — nothing in the column either. The badge says *stopped
   * short*, which is the one thing they did not already know, and it is enough.
   */
  it('says nothing about a stop the person asked for and got', () => {
    const stopped = conversationStanding({
      turn: turn({ cancelRequested: true, ending: cancelledEnding() }),
      stillWatching: true,
    });
    assert.equal(stopped.standing, 'stopped');
    assert.equal(stopped.actionNote, null);
  });

  it('withholds the ending\u2019s own account at a stop the person asked for', () => {
    const asked = turn({ cancelRequested: true, ending: cancelledEnding() });
    assert.equal(stoppedAsAsked(asked), true);
    const line = loopTurnEndingLine(asked);
    assert.equal(line.text, '');
    // And not behind a disclosure either: `hasMore` is what draws one, and a
    // collapsed summary holding the same prose is what this card rules out by name.
    assert.equal(line.hasMore, false);
  });

  /**
   * The negative control for both tests above, and the reason the predicate is a
   * conjunction rather than a single flag.
   *
   * Same ending, nobody having asked for it. DSpatch cannot assume the person knows
   * why a run stopped when they did not stop it, so the account stays.
   */
  it('negative control: a stop nobody asked for keeps its account', () => {
    const unasked = turn({ ending: cancelledEnding() });
    assert.equal(stoppedAsAsked(unasked), false);
    assert.notEqual(loopTurnEndingLine(unasked).text, '');
  });

  /**
   * The other half of the same conjunction: asked for, and never confirmed.
   *
   * §4.5, and DSP-1's measurement of 69.5 s of remote work continuing after a severed
   * connection. This is the one stop state with something to do in it, so it is the
   * one that still speaks — briefly, which the bound below enforces rather than
   * describes.
   */
  it('keeps telling a requested stop from a confirmed one', () => {
    const asked = conversationStanding({
      turn: turn({ cancelRequested: true }),
      stillWatching: true,
    });
    assert.equal(asked.standing, 'stop-requested');
    assert.equal(asked.activityIsKnown, false);
    assert.match(asked.actionNote ?? '', /asking is not stopping/);
    // What to do while it is unknown, which is DSP-57 #4: never "try again".
    assert.match(asked.actionNote ?? '', /check your project/i);
    assert.equal(/try again/i.test(asked.actionNote ?? ''), false);
    assert.ok(
      (asked.actionNote ?? '').length < 200,
      `two sentences, not a paragraph: ${String(asked.actionNote?.length)} characters`,
    );
  });

  /**
   * §9: *do not present a running animation as proof of activity when activity is
   * not known.* `activityIsKnown` is what the window's pulse hangs off, so this is
   * the assertion that keeps the rule enforceable — and it survives the prose that
   * used to state the same thing in words.
   */
  it('reports activity as unknown, not active, once DSpatch has stopped watching', () => {
    const standing = conversationStanding({ turn: turn(), stillWatching: false });
    assert.equal(standing.standing, 'unknown');
    assert.equal(standing.activityIsKnown, false);
    assert.match(standing.actionNote ?? '', /may still be working in your project/);
    assert.match(standing.actionNote ?? '', /Check the project/);
    assert.ok((standing.actionNote ?? '').length < 200, standing.actionNote ?? '');
  });

  it('says a run whose wait was abandoned may still be working', () => {
    const standing = conversationStanding({
      turn: turn({ cancelRequested: true, abandoned: true }),
      stillWatching: true,
    });
    assert.equal(standing.standing, 'unknown');
    assert.equal(standing.activityIsKnown, false);
    assert.match(standing.actionNote ?? '', /may still be/);
  });

  /**
   * The exception, and Niclas named it: a file that could not be saved.
   *
   * A record that could not be written is a fact about his project rather than an
   * account of a run whose fate he already knows, so it has to survive the silence
   * this card imposes. It reaches the column through `actionNote`, which is the one
   * channel that outlives a confirmed stop.
   */
  it('still speaks when the run\u2019s record could not be written', () => {
    const couldNotSave =
      'This run was not fully kept on disk: the disk was full. What is on screen is ' +
      'all there will be after a restart.';
    const standing = conversationStanding({
      turn: turn({
        cancelRequested: true,
        ending: { ...cancelledEnding(), actionNote: couldNotSave },
      }),
      stillWatching: true,
    });
    assert.equal(standing.standing, 'stopped');
    assert.equal(standing.actionNote, couldNotSave);
  });

  /**
   * Replaces two tests that asserted the message count inside *what happens next*
   * — *One message of yours is waiting…* and *Your message never reached a step…*
   *
   * The fact is not gone from the window and is not untested: it is on the message
   * itself, which is where DSP-87 put it and where §6 requires a question and its
   * answer to be readable together. `loop-instruction.test.ts` owns it now, against
   * `loopInstructionStatusText`. What is asserted here is that it is not *also*
   * restated in a paragraph beside the run, since two accounts of one message is how
   * the pair came to disagree in the first place.
   */
  it('leaves a waiting message to its own entry rather than counting it here', () => {
    const standing = conversationStanding({
      turn: turn({ cancelRequested: true }),
      stillWatching: true,
    });
    assert.equal(/message/i.test(standing.actionNote ?? ''), false, standing.actionNote ?? '');
  });

  it('says nothing at all when there is no run', () => {
    const standing = conversationStanding({ turn: null, stillWatching: false });
    assert.equal(standing.standing, 'idle');
    assert.equal(standing.activityIsKnown, true);
    assert.equal(standing.actionNote, null);
  });

  /**
   * The state is still readable after its prose has gone, which is what §9 actually
   * asks for: a reader must be able to tell the six apart. The window branches on
   * `standing`, and a scripted run reads it off `data-standing`, so removing the
   * sentences did not remove the distinction.
   */
  it('still distinguishes every state it is asked to', () => {
    const seen = [
      conversationStanding({ turn: null, stillWatching: false }),
      conversationStanding({ turn: turn(), stillWatching: true }),
      conversationStanding({ turn: turn({ cancelRequested: true }), stillWatching: true }),
      conversationStanding({ turn: turn(), stillWatching: false }),
      conversationStanding({
        turn: turn({ cancelRequested: true, ending: cancelledEnding() }),
        stillWatching: true,
      }),
    ].map((standing) => standing.standing);
    assert.deepEqual(seen, ['idle', 'active', 'stop-requested', 'unknown', 'stopped']);
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
