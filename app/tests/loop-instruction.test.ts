/**
 * The conversation stays a conversation while work happens (DSP-53, DSP-32).
 *
 * Two things are under test here and they are worth naming apart, because only
 * one of them is the card and the other is the hazard the card carries.
 *
 * **Where a press of Send goes.** `composerSendRoute` is the only thing that
 * decides, and the assertions below are mostly about combinations that must be
 * impossible rather than about the ordinary path: a message typed while a walk is
 * in flight must never be able to start a second walk in the same working copy.
 *
 * **What the person is told about it.** Received is not delivered. Every
 * assertion on a sentence checks the sentence, not a flag, because the flag is
 * not what anyone reads.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composerCanSend,
  composerRouteNote,
  composerSendRoute,
  earlierInstructionsContext,
  instructionPreamble,
  INSTRUCTION_BLOCK_CLOSE,
  INSTRUCTION_BLOCK_OPEN,
  loopInstructionBadgeText,
  loopInstructionState,
  loopInstructionStatusText,
  loopInstructionsAfter,
  pendingInstructionsFor,
  storedSteeringAsInstruction,
  type ComposerState,
  type LoopInstruction,
} from '../src/shared/loop-instruction';

/** An idle window with a project open and something typed. */
function composer(overrides: Partial<ComposerState> = {}): ComposerState {
  return {
    text: 'also check the Linux build',
    loopRunning: false,
    loopRunId: null,
    useLoop: false,
    outstandingTurn: false,
    unresolvedAttempts: [],
    otherWorkInProgress: false,
    sessionOpen: true,
    noProviderSession: null,
    ...overrides,
  };
}

function received(overrides: Partial<LoopInstruction> = {}): LoopInstruction {
  return {
    id: 'msg-1',
    runId: 'chat-loop-1',
    text: 'also check the Linux build',
    receivedAtUtc: '2026-09-19T12:00:00.000Z',
    delivered: null,
    runEnded: false,
    ...overrides,
  };
}

describe('where a press of Send goes', () => {
  it('starts a walk when Use loop is on and nothing is running', () => {
    assert.equal(composerSendRoute(composer({ useLoop: true })).kind, 'loop-run');
  });

  it('sends an ordinary turn when Use loop is off', () => {
    assert.equal(composerSendRoute(composer()).kind, 'agent-turn');
  });

  /**
   * The card. `busy` was `'sending'` for the whole of a loop run and the composer
   * read `busy !== null`, so this combination produced a dead box.
   */
  it('is live during a loop run rather than dead', () => {
    assert.equal(
      composerCanSend(composer({ loopRunning: true, loopRunId: 'chat-loop-1' })),
      true,
    );
  });

  /**
   * DSP-53 #2 and DSP-32 #4, as a property of the function rather than of the
   * caller. There is no combination of inputs that produces `loop-run` while a
   * walk is in flight — including the one a caller would most plausibly get
   * wrong, which is Use loop still switched on.
   */
  it('cannot start a second walk while one is in flight, whatever the toggle says', () => {
    for (const useLoop of [true, false]) {
      const route = composerSendRoute(
        composer({ loopRunning: true, loopRunId: 'chat-loop-1', useLoop }),
      );
      assert.equal(route.kind, 'instruction');
      assert.equal(route.kind === 'instruction' ? route.runId : null, 'chat-loop-1');
    }
  });

  /**
   * The negative control for the assertion above: break the ordering the guard
   * depends on and the guarantee has to fail. `composerSendRoute` checks
   * `loopRunning` before it reads `useLoop`; a version that reads them the other
   * way round is exactly the defect, so a stand-in written that way must produce
   * the forbidden route. If this ever stops producing `loop-run`, the test above
   * has stopped being able to detect the bug it is there for.
   */
  it('negative control: reading the toggle first would start the competing walk', () => {
    const wrongOrder = (state: ComposerState): string =>
      state.useLoop ? 'loop-run' : state.loopRunning ? 'instruction' : 'agent-turn';
    assert.equal(
      wrongOrder(composer({ loopRunning: true, loopRunId: 'chat-loop-1', useLoop: true })),
      'loop-run',
    );
  });

  it('refuses rather than guessing when the run in flight cannot be named', () => {
    const route = composerSendRoute(composer({ loopRunning: true, loopRunId: null }));
    assert.equal(route.kind, 'blocked');
    assert.match(route.kind === 'blocked' ? route.reason : '', /Your text is kept/);
  });

  it('still blocks for the things that are genuinely the window being elsewhere', () => {
    assert.equal(composerSendRoute(composer({ otherWorkInProgress: true })).kind, 'blocked');
    assert.equal(composerSendRoute(composer({ sessionOpen: false })).kind, 'blocked');
    assert.equal(composerSendRoute(composer({ text: '   ' })).kind, 'blocked');
  });

  /**
   * DSP-121 flow (Niclas, 24 October 2026): with no agent session behind the
   * conversation, Enter holds an ordinary message in the box and the note says what
   * to do; it is not sent to be refused. A loop run, which opens sessions of its own,
   * is routed exactly as before (DSP-121 review B2).
   */
  it('holds an ordinary message back while no agent session is open, and says what to do', () => {
    const note = 'Try again or start a new session to send.';
    const route = composerSendRoute(composer({ noProviderSession: note }));
    assert.deepEqual(route, { kind: 'blocked', reason: note });
    assert.equal(composerCanSend(composer({ noProviderSession: note })), false);
    assert.equal(composerRouteNote(route), note, 'the reason is shown, not kept quiet');
    // The loop routes do not depend on the conversation's agent session.
    assert.equal(composerSendRoute(composer({ noProviderSession: note, useLoop: true })).kind, 'loop-run');
    const inFlight = composerSendRoute(
      composer({ noProviderSession: note, loopRunning: true, loopRunId: 'chat-loop-1' }),
    );
    assert.equal(inFlight.kind, 'instruction');
    // An empty box stays quiet, as it does everywhere else.
    assert.equal(composerRouteNote(composerSendRoute(composer({ noProviderSession: note, text: '' }))), null);
  });

  // DSP-121 review B2: an earlier attempt with no known outcome must not take the
  // note's place while no agent session is open - acknowledging it could not get the
  // message sent, and the panel's choices are the way forward.
  it('names the way forward, not an earlier unresolved attempt, while no agent session is open', () => {
    const note = 'Try again or start a new session to send.';
    const route = composerSendRoute(
      composer({
        noProviderSession: note,
        unresolvedAttempts: [{ conversationId: 'conv-A', attemptId: 'dsp-attempt-0003' }],
      }),
    );
    assert.deepEqual(route, { kind: 'blocked', reason: note });
    // With an agent session open the unresolved attempt still gates, as before.
    const gated = composerSendRoute(
      composer({ unresolvedAttempts: [{ conversationId: 'conv-A', attemptId: 'dsp-attempt-0003' }] }),
    );
    assert.equal(gated.kind, 'blocked');
    assert.match(gated.kind === 'blocked' ? gated.reason : '', /dsp-attempt-0003/);
  });

  it('names every unresolved attempt rather than counting them', () => {
    const route = composerSendRoute(
      composer({
        unresolvedAttempts: [
          { conversationId: 'conv-A', attemptId: 'dsp-run-1' },
          { conversationId: 'conv-A', attemptId: 'dsp-run-2' },
        ],
      }),
    );
    assert.equal(route.kind, 'blocked');
    const reason = route.kind === 'blocked' ? route.reason : '';
    assert.match(reason, /dsp-run-1/);
    assert.match(reason, /dsp-run-2/);
  });

  // DSP-124: *Send anyway* and the Execution state's button name the attempts they
  // acknowledge. The route used to be computed without them, so the very attempts
  // being acknowledged blocked the send that acknowledged them and nothing could be
  // sent in that conversation. Only the named attempts stop counting, by conversation
  // and ID; every other gate stays where it was.
  describe('a send that acknowledges unresolved attempts (DSP-124)', () => {
    const a4 = { conversationId: 'conv-A', attemptId: 'dsp-attempt-0004' };
    const a5 = { conversationId: 'conv-A', attemptId: 'dsp-attempt-0005' };
    const b4 = { conversationId: 'conv-B', attemptId: 'dsp-attempt-0004' };

    it('is not blocked by the attempts it acknowledges', () => {
      assert.deepEqual(composerSendRoute(composer({ unresolvedAttempts: [a5] }), [a5]), {
        kind: 'agent-turn',
      });
      assert.deepEqual(composerSendRoute(composer({ unresolvedAttempts: [a4, a5] }), [a4, a5]), {
        kind: 'agent-turn',
      });
    });

    it('is still blocked by an attempt it does not name', () => {
      const route = composerSendRoute(composer({ unresolvedAttempts: [a4, a5] }), [a5]);
      assert.equal(route.kind, 'blocked');
      const reason = route.kind === 'blocked' ? route.reason : '';
      assert.match(reason, /An earlier attempt has no known outcome \(dsp-attempt-0004\)/);
      assert.doesNotMatch(reason, /dsp-attempt-0005/);
    });

    it('tells two attempts with one ID apart by their conversation', () => {
      const route = composerSendRoute(composer({ unresolvedAttempts: [a4, b4] }), [a4]);
      assert.equal(route.kind, 'blocked');
      assert.match(
        route.kind === 'blocked' ? route.reason : '',
        /\(dsp-attempt-0004 \(conversation conv-B\)\)/,
      );
    });

    it('still holds Enter back, which names nothing', () => {
      assert.equal(composerSendRoute(composer({ unresolvedAttempts: [a5] })).kind, 'blocked');
      assert.equal(composerCanSend(composer({ unresolvedAttempts: [a5] })), false);
    });

    it('leaves the no-session reason, an outstanding turn and other work in front', () => {
      const note = 'Try again or start a new session to send.';
      assert.deepEqual(
        composerSendRoute(composer({ noProviderSession: note, unresolvedAttempts: [a5] }), [a5]),
        { kind: 'blocked', reason: note },
      );
      assert.equal(
        composerSendRoute(composer({ otherWorkInProgress: true, unresolvedAttempts: [a5] }), [a5]).kind,
        'blocked',
      );
      assert.equal(
        composerSendRoute(composer({ text: '  ', unresolvedAttempts: [a5] }), [a5]).kind,
        'blocked',
      );
    });

    // The acknowledgement travels with `sendPrompt` only; a loop run or a message into
    // a running walk carries none, so it must not be let through by one.
    // DSP-147: a message into a running walk is steering of work already going, not a new
    // attempt, so earlier attempts with no known outcome do not hold it back either way.
    it('does not let an acknowledgement start a loop run, and does not hold back steering', () => {
      assert.equal(
        composerSendRoute(composer({ useLoop: true, unresolvedAttempts: [a5] }), [a5]).kind,
        'blocked',
      );
      assert.equal(
        composerSendRoute(
          composer({ loopRunning: true, loopRunId: 'chat-loop-1', unresolvedAttempts: [a5] }),
          [a5],
        ).kind,
        'instruction',
      );
    });
  });

  /**
   * DSP-87. This used to assert the opposite: that a paragraph beside the composer
   * said *A loop run is working. Sending adds your message to it rather than starting
   * a second run…*. It was true, and it stood under the box for the whole of every
   * run, ahead of a message nobody had typed yet. The acknowledgement moved to the
   * message itself, where it is about something that happened — see
   * `loopInstructionStatusText` below, whose delivered case names the step.
   *
   * §7's requirement survives the move and is what the second half checks: the window
   * states what DSpatch did with the text and never offers the person a
   * classification to make.
   */
  it('says nothing beside the composer about a message that joins the run', () => {
    const note = composerRouteNote(
      composerSendRoute(composer({ loopRunning: true, loopRunId: 'chat-loop-1' })),
    );
    assert.equal(note, null);
  });

  it('offers no classification on the message itself either', () => {
    const said = loopInstructionStatusText(received());
    for (const word of ['question', 'instruction', 'choose', 'instead send', 'type of message']) {
      assert.equal(said.toLowerCase().includes(word), false, `offers a choice: ${word}`);
    }
  });

  it('says nothing beside the button on the ordinary paths', () => {
    assert.equal(composerRouteNote(composerSendRoute(composer())), null);
    assert.equal(composerRouteNote(composerSendRoute(composer({ useLoop: true }))), null);
  });

  // An empty box is the state the composer is in for most of a session, and it
  // explains itself. The refusal still exists for a press that reaches `send`.
  it('does not explain an empty box beside an empty box', () => {
    const route = composerSendRoute(composer({ text: '  ' }));
    assert.equal(route.kind, 'blocked');
    assert.match(route.kind === 'blocked' ? route.reason : '', /nothing in the box/);
    assert.equal(composerRouteNote(route), null);
  });

  // The reasons that are not obvious from the screen are still said.
  it('still explains a block the person cannot see the cause of', () => {
    assert.notEqual(composerRouteNote(composerSendRoute(composer({ otherWorkInProgress: true }))), null);
    assert.notEqual(composerRouteNote(composerSendRoute(composer({ sessionOpen: false }))), null);
  });
});

describe('received is not delivered', () => {
  /**
   * DSP-87 shortened these three sentences to one each, and the assertions moved with
   * them rather than being dropped. What each one has to carry is unchanged: the two
   * facts below are still the reason this sentence exists, and the second is the one
   * that stops a person expecting the step now running to act on their message.
   */
  it('holds a new message as pending and says so in one line', () => {
    const list = loopInstructionsAfter([], { kind: 'received', instruction: received() });
    assert.equal(loopInstructionState(list[0]!), 'pending');
    const text = loopInstructionStatusText(list[0]!);
    assert.match(text, /^Waiting\./);
    // It must not imply the running step will act on it.
    assert.match(text, /next step/);
    assert.equal(text.split(/(?<=\.)\s/).length, 2, 'two short sentences at most');
    assert.ok(text.length < 80, `still short: ${String(text.length)} characters`);
  });

  it('names the step that took it, and only after it took it', () => {
    const list = loopInstructionsAfter([], { kind: 'received', instruction: received() });
    const after = loopInstructionsAfter(list, {
      kind: 'delivered',
      runId: 'chat-loop-1',
      instructionIds: ['msg-1'],
      delivery: {
        nodeId: 'check',
        nodeLabel: 'Check the work',
        occurrence: 1,
        atUtc: '2026-09-19T12:01:00.000Z',
      },
    });
    assert.equal(loopInstructionState(after[0]!), 'delivered');
    assert.match(loopInstructionStatusText(after[0]!), /Given to “Check the work” when that step started/);
    assert.equal(loopInstructionBadgeText(after[0]!), 'reached the agent');
  });

  it('says which time round when a node takes a message on a later pass', () => {
    const list = loopInstructionsAfter([], { kind: 'received', instruction: received() });
    const after = loopInstructionsAfter(list, {
      kind: 'delivered',
      runId: 'chat-loop-1',
      instructionIds: ['msg-1'],
      delivery: {
        nodeId: 'work',
        nodeLabel: 'Do what was asked',
        occurrence: 2,
        atUtc: '2026-09-19T12:01:00.000Z',
      },
    });
    assert.match(loopInstructionStatusText(after[0]!), /on its second turn/);
  });

  /**
   * §4.4's last requirement. A message that never reached anybody must say so
   * rather than sitting on "waiting" for ever after the run it was waiting for
   * has gone.
   */
  it('says plainly when the run ended before any step took it', () => {
    const list = loopInstructionsAfter([], { kind: 'received', instruction: received() });
    const after = loopInstructionsAfter(list, { kind: 'run-ended', runId: 'chat-loop-1' });
    assert.equal(loopInstructionState(after[0]!), 'never-delivered');
    // One sentence now (DSP-87). The fact kept is the one §4.4 asks for — that no
    // agent received it — and the badge beside it carries the rest.
    assert.match(loopInstructionStatusText(after[0]!), /no agent ever received it/);
    assert.equal(loopInstructionBadgeText(after[0]!), 'never reached an agent');
  });

  it('leaves a delivered message alone when its run ends', () => {
    const delivered = received({
      delivered: {
        nodeId: 'check',
        nodeLabel: 'Check the work',
        occurrence: 1,
        atUtc: '2026-09-19T12:01:00.000Z',
      },
    });
    const after = loopInstructionsAfter([delivered], {
      kind: 'run-ended',
      runId: 'chat-loop-1',
    });
    assert.equal(loopInstructionState(after[0]!), 'delivered');
  });

  it('records one delivery per message and does not let a second rewrite it', () => {
    const list = loopInstructionsAfter([], { kind: 'received', instruction: received() });
    const once = loopInstructionsAfter(list, {
      kind: 'delivered',
      runId: 'chat-loop-1',
      instructionIds: ['msg-1'],
      delivery: { nodeId: 'work', nodeLabel: 'Do what was asked', occurrence: 1, atUtc: 'a' },
    });
    const twice = loopInstructionsAfter(once, {
      kind: 'delivered',
      runId: 'chat-loop-1',
      instructionIds: ['msg-1'],
      delivery: { nodeId: 'check', nodeLabel: 'Check the work', occurrence: 1, atUtc: 'b' },
    });
    assert.equal(twice[0]?.delivered?.nodeId, 'work');
  });

  it('does not touch another run\u2019s messages', () => {
    const mine = received();
    const theirs = received({ id: 'msg-2', runId: 'chat-loop-2' });
    const after = loopInstructionsAfter([mine, theirs], {
      kind: 'run-ended',
      runId: 'chat-loop-1',
    });
    assert.equal(loopInstructionState(after[0]!), 'never-delivered');
    assert.equal(loopInstructionState(after[1]!), 'pending');
  });

  it('empties when the conversation is replaced', () => {
    const list = loopInstructionsAfter([], { kind: 'received', instruction: received() });
    assert.deepEqual(loopInstructionsAfter(list, { kind: 'conversation-replaced' }), []);
  });

  it('keeps the first of a repeated id rather than adding a second', () => {
    const list = loopInstructionsAfter([], { kind: 'received', instruction: received() });
    const again = loopInstructionsAfter(list, {
      kind: 'received',
      instruction: received({ text: 'something else' }),
    });
    assert.equal(again.length, 1);
    assert.equal(again[0]?.text, 'also check the Linux build');
  });

  it('offers only this run\u2019s undelivered messages to a starting step', () => {
    const pending = received();
    const done = received({
      id: 'msg-2',
      delivered: { nodeId: 'work', nodeLabel: 'Do what was asked', occurrence: 1, atUtc: 'a' },
    });
    const other = received({ id: 'msg-3', runId: 'chat-loop-2' });
    assert.deepEqual(
      pendingInstructionsFor([pending, done, other], 'chat-loop-1').map((each) => each.id),
      ['msg-1'],
    );
  });
});

describe('what the next step is actually told', () => {
  it('says nothing at all when nothing is waiting', () => {
    assert.equal(instructionPreamble([]), '');
    assert.equal(instructionPreamble(['   ', '']), '');
  });

  /**
   * The prompt is what the run record saves, so these markers are how *the
   * message reached the provider* stops being a claim and becomes checkable.
   */
  it('puts the user\u2019s words between markers, whole', () => {
    const preamble = instructionPreamble(['also check the **Linux** build\n\n```\nmake\n```']);
    assert.match(preamble, new RegExp(INSTRUCTION_BLOCK_OPEN.replace(/[=]/g, '\\=')));
    assert.match(preamble, new RegExp(INSTRUCTION_BLOCK_CLOSE.replace(/[=]/g, '\\=')));
    assert.match(preamble, /also check the \*\*Linux\*\* build/);
    assert.match(preamble, /```\nmake\n```/);
  });

  it('carries several messages and counts them', () => {
    const preamble = instructionPreamble(['first', 'second']);
    assert.match(preamble, /sent 2 messages/);
    assert.match(preamble, /first/);
    assert.match(preamble, /second/);
  });

  /**
   * Negative control for the two tests above. Truncating the message — the
   * obvious "tidy" that a summariser would introduce — must make them fail, or
   * they are not checking that the text is passed through whole.
   */
  it('negative control: a truncated preamble fails the whole-text assertion', () => {
    const truncated = (texts: readonly string[]): string =>
      `${INSTRUCTION_BLOCK_OPEN}\n${(texts[0] ?? '').slice(0, 10)}\n${INSTRUCTION_BLOCK_CLOSE}`;
    assert.doesNotMatch(
      truncated(['also check the **Linux** build']),
      /also check the \*\*Linux\*\* build/,
    );
  });
});

/**
 * DSP-147: a message while work runs is steering of that work, delivered through the
 * runtime's own steering, and the window says how far it got and no further.
 */
describe('steering the running work (DSP-147)', () => {
  it('sends a message during an ordinary turn into that turn, never as a new one', () => {
    assert.deepEqual(composerSendRoute(composer({ outstandingTurn: true })), { kind: 'steer' });
    assert.deepEqual(composerSendRoute(composer({ outstandingTurn: true, useLoop: true })), { kind: 'steer' });
    assert.equal(composerRouteNote({ kind: 'steer' }), null);
  });

  it('is not held back by earlier attempts with no known outcome: it is part of the work going', () => {
    const a5 = { attemptId: 'dsp-attempt-0005', conversationId: 'c1' };
    assert.equal(composerSendRoute(composer({ outstandingTurn: true, unresolvedAttempts: [a5] })).kind, 'steer');
  });

  it('says accepted, delivered into the step, not confirmed and not delivered apart', () => {
    let list = loopInstructionsAfter([], { kind: 'received', instruction: received() });
    list = loopInstructionsAfter(list, { kind: 'accepted', runId: 'chat-loop-1', instructionIds: ['msg-1'] });
    assert.equal(loopInstructionState(list[0]!), 'accepted');
    assert.match(loopInstructionStatusText(list[0]!), /not yet taken in/);
    const delivered = loopInstructionsAfter(list, {
      kind: 'delivered',
      runId: 'chat-loop-1',
      instructionIds: ['msg-1'],
      delivery: {
        nodeId: 'impl',
        nodeLabel: 'Implement',
        occurrence: 1,
        atUtc: '2026-10-28T10:00:00.000Z',
        during: true,
      },
    });
    assert.equal(loopInstructionStatusText(delivered[0]!), 'Delivered to “Implement” while it worked.');
    assert.doesNotMatch(loopInstructionStatusText(delivered[0]!), /read|applied|followed/i);
    const unconfirmed = loopInstructionsAfter(list, {
      kind: 'unconfirmed',
      runId: 'chat-loop-1',
      instructionIds: ['msg-1'],
    });
    assert.equal(loopInstructionState(unconfirmed[0]!), 'unconfirmed');
    assert.match(loopInstructionStatusText(unconfirmed[0]!), /not sent again/);
    // The run ending afterwards does not turn a message the runtime had into one no agent got.
    const ended = loopInstructionsAfter(unconfirmed, { kind: 'run-ended', runId: 'chat-loop-1' });
    assert.equal(loopInstructionState(ended[0]!), 'unconfirmed');
  });

  it('falls back to the next step, or to the end of a chat turn, and says which', () => {
    const loop = loopInstructionsAfter([received()], {
      kind: 'waiting',
      runId: 'chat-loop-1',
      instructionIds: ['msg-1'],
      waitingFor: 'next-step',
    });
    assert.match(loopInstructionStatusText(loop[0]!), /next step/);
    const chat = loopInstructionsAfter([received({ scope: 'chat', runId: 'run-7' })], {
      kind: 'waiting',
      runId: 'run-7',
      instructionIds: ['msg-1'],
      waitingFor: 'end-of-turn',
    });
    assert.match(loopInstructionStatusText(chat[0]!), /sent when this turn ends/);
    const stopped = loopInstructionsAfter(chat, {
      kind: 'not-delivered',
      runId: 'run-7',
      instructionIds: ['msg-1'],
    });
    assert.equal(
      loopInstructionStatusText(stopped[0]!),
      'The turn stopped first, so the agent never received it.',
    );
  });

  it('briefs later steps with what earlier ones were sent, and adds nothing when there was none', () => {
    assert.equal(earlierInstructionsContext([]), '');
    const brief = earlierInstructionsContext(['Ändra inget ännu, undersök först.']);
    assert.match(brief, /assignment as it now stands/);
    assert.ok(brief.includes(INSTRUCTION_BLOCK_OPEN) && brief.includes(INSTRUCTION_BLOCK_CLOSE));
    assert.ok(brief.includes('Ändra inget ännu, undersök först.'));
    // The same precedence rule as the preamble a step gets for a message given to it.
    assert.ok(brief.includes('it governs'));
    // No claim that the earlier step received it: one the runtime had unconfirmed is carried too.
    assert.doesNotMatch(brief, /received it/);
  });

  it('reads a saved chat steering message back as no more than the file establishes', () => {
    const base = {
      id: 's1',
      text: 'x',
      receivedAtUtc: '2026-10-28T10:00:00.000Z',
      settledAtUtc: null,
      providerMessageId: null,
      detail: null,
    };
    assert.equal(
      loopInstructionState(storedSteeringAsInstruction({ ...base, state: 'delivered' }, 'r')),
      'delivered',
    );
    // Accepted when DSpatch stopped: nothing more was learned, so it is not confirmed.
    assert.equal(
      loopInstructionState(storedSteeringAsInstruction({ ...base, state: 'accepted' }, 'r')),
      'unconfirmed',
    );
    assert.equal(
      loopInstructionState(storedSteeringAsInstruction({ ...base, state: 'not-delivered' }, 'r')),
      'never-delivered',
    );
  });
});
