/**
 * DSP-209 S5b: the chat's prompt for a loop step's recommendation to continue interactively.
 *
 * The view model the component renders, tested without a window the way the other renderer
 * modules are: what it shows, and what each button sends.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handoffPromptView, loopStaysTickedAfter, sendHandoffAnswer } from '../src/renderer/handoff-prompt';
import {
  initialControlState,
  type HandoffAnswerAction,
  type LoopControlOutcome,
  type LoopControlReport,
} from '../src/shared/loop-control';

function report(withHandoff: boolean, runId = 'chat-loop-1'): LoopControlReport {
  return {
    runId,
    state: initialControlState(),
    ...(withHandoff
      ? {
          handoff: {
            runId: 'chat-loop-1',
            nodeId: 'work',
            nodeLabel: 'Do what was asked',
            visit: 2,
            reason: 'The next choice is a product decision only you can make.',
            heldSinceUtc: '2026-11-14T03:00:00.000Z',
          },
        }
      : {}),
  };
}

function outcome(accepted: boolean, note: string): LoopControlOutcome {
  return { accepted, note, report: report(false) };
}

describe('the handoff prompt in the chat (DSP-209 S5b)', () => {
  it('shows the step, the agent\'s reason and the two choices while a recommendation waits', () => {
    const view = handoffPromptView(report(true));
    assert.ok(view !== null);
    assert.equal(view.headline, '“Do what was asked” recommends continuing interactively.');
    assert.equal(view.reason, 'The next choice is a product decision only you can make.');
    assert.deepEqual(
      view.choices.map((choice) => [choice.label, choice.answer]),
      [
        ['Continue interactively', { runId: 'chat-loop-1', visit: 2, choice: 'interactive' }],
        ['Continue in the loop', { runId: 'chat-loop-1', visit: 2, choice: 'loop' }],
      ],
    );
  });

  it('shows nothing without a recommendation, or for a run that is not the one controlled', () => {
    assert.equal(handoffPromptView(report(false)), null);
    assert.equal(handoffPromptView(report(true, 'another-run')), null);
    assert.equal(handoffPromptView({ ...report(true), runId: null }), null);
  });

  it('sends each answer bound to the run and visit, and shows only a refusal\'s note', async () => {
    const view = handoffPromptView(report(true));
    assert.ok(view !== null);
    const sent: HandoffAnswerAction[] = [];
    for (const choice of view.choices) {
      const note = await sendHandoffAnswer(async (answer) => {
        sent.push(answer);
        return outcome(true, 'Accepted.');
      }, choice);
      assert.equal(note, null, 'an accepted answer needs no note: the prompt goes away');
    }
    assert.deepEqual(sent.map((answer) => answer.choice), ['interactive', 'loop']);
    assert.ok(sent.every((answer) => answer.runId === 'chat-loop-1' && answer.visit === 2));

    const refused = await sendHandoffAnswer(
      async () => outcome(false, 'This recommendation has already been answered.'),
      view.choices[0]!,
    );
    assert.equal(refused, 'This recommendation has already been answered.');
    const failed = await sendHandoffAnswer(async () => {
      throw new Error('the host is not reachable');
    }, view.choices[1]!);
    assert.match(failed ?? '', /could not be sent: the host is not reachable/);
  });

  // DSP-209 S6: what the button promises is what happens, and the tick follows the handover.
  it('says that DSpatch sends the run\'s material to the chat once, and unticks Use loop only on a handover', () => {
    const view = handoffPromptView(report(true));
    assert.match(view?.choices[0]?.title ?? '', /sends the run’s mandate and what it did to the agent in this chat, once/);
    assert.equal(loopStaysTickedAfter({ kind: 'finished', result: { status: 'handed-over' } }), false);
    for (const status of ['completed', 'limit-reached', 'runtime-fault']) {
      assert.equal(loopStaysTickedAfter({ kind: 'finished', result: { status } }), true);
    }
    assert.equal(loopStaysTickedAfter({ kind: 'cancelled', result: { status: 'handed-over' } }), true);
    assert.equal(loopStaysTickedAfter({ kind: 'refused' }), true);
  });
});
