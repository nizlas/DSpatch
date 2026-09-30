/**
 * DSP-27's rules, tested where they can be tested.
 *
 * The window itself has no harness in this repository, so what these assertions
 * protect is the reasoning: which strings are allowed in the compressed header,
 * what a keypress means, what the activity line may claim, and what the history of
 * a run looks like when it is read from the record's replies. Every failure
 * message is written for the user-visible consequence rather than the shape of the
 * data, because that is the sentence someone reads when they break it.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ACTIVITY_OWN_SENTENCES,
  activityLine,
  chatHeaderView,
  composerKeyAction,
  composerTextAfterSend,
  handoffTrail,
  headerProblems,
  headerSummaryStrings,
  type ChatHeaderInput,
  type ComposerKey,
} from '../src/shared/chat-workspace.ts';

const PATH = 'C:/Users/nicla/development/DSpatch';
const SESSION = 'dspatch-session-8f2c1a44';
const PROVIDER_SESSION = 'bc-3f9a17c2-4d8e';

function headerInput(over: Partial<ChatHeaderInput> = {}): ChatHeaderInput {
  return {
    project: {
      name: 'DSpatch',
      fullPath: PATH,
      dspatchSessionId: SESSION,
      providerSessionId: PROVIDER_SESSION,
      gitSummary: 'main at 3d441718aa2c',
      dirtySummary: '12 files already modified before this session',
    },
    connection: {
      kind: 'connected',
      modelRequested: 'claude-4.5-sonnet',
      account: 'niclas@example.com',
      problem: null,
    },
    activityText: 'Waiting for your message.',
    unresolvedRuns: 0,
    unresolvedAttempts: [],
    refusal: null,
    saveFailure: null,
    context: {
      promptsSent: 3,
      promptCharactersSent: 2070,
      fileContentsSentByDspatch: 0,
      toolCallsByAgent: 7,
      toolNames: ['read_file', 'run_terminal_cmd'],
    },
    adapterNote:
      'Every provider call goes through the Cursor adapter, which streams run events over an ' +
      'IPC channel the renderer subscribes to.',
    ...over,
  };
}

describe('the compressed header (DSP-27 #1)', () => {
  it('keeps the four continuous things and nothing longer', () => {
    const view = chatHeaderView(headerInput());
    assert.equal(view.project, 'DSpatch');
    assert.equal(view.agent, 'claude-4.5-sonnet');
    assert.equal(view.connection, 'connected');
    assert.equal(view.activity, 'Waiting for your message.');
  });

  it('puts no full path and no session identifier in front of the person working', () => {
    const view = chatHeaderView(headerInput());
    const summary = headerSummaryStrings(view).join(' | ');
    for (const debugging of [PATH, SESSION, PROVIDER_SESSION]) {
      assert.equal(
        summary.includes(debugging),
        false,
        'the top of the window is what a person reads continuously, and a full path or a ' +
          'session id belongs to whoever is debugging DSpatch rather than to the person ' +
          `doing the work. The summary read: ${summary}`,
      );
    }
  });

  it('still has all of it, one expander away', () => {
    const view = chatHeaderView(headerInput());
    const detailText = view.details.map((fact) => `${fact.label}: ${fact.value}`).join('\n');
    for (const occasional of [PATH, SESSION, PROVIDER_SESSION, '2070', 'read_file']) {
      assert.equal(
        detailText.includes(occasional),
        true,
        `moving something out of the header must not lose it — ${occasional} is not in the ` +
          `detail view either. It reads:\n${detailText}`,
      );
    }
  });

  it('keeps the technical explanation of the adapter out of the header', () => {
    const view = chatHeaderView(headerInput());
    assert.equal(
      headerSummaryStrings(view).some((line) => line.includes('IPC')),
      false,
      'how the adapter is wired is a detail however well it is written, and the header is ' +
        'the one place it must not be.',
    );
    assert.equal(
      view.details.some((fact) => fact.value.includes('IPC')),
      true,
      'the explanation must still be readable somewhere, or compressing the header deleted it.',
    );
  });

  it('says what it can when no project is open', () => {
    const view = chatHeaderView(
      headerInput({
        project: null,
        connection: { kind: 'checking', modelRequested: null, account: null, problem: null },
        activityText: 'No project open, so nothing is running.',
      }),
    );
    assert.equal(view.project, 'No project open');
    assert.equal(view.agent, 'no model requested yet');
    assert.deepEqual(view.problems, []);
  });
});

describe('problems the detail view is not allowed to hide (DSP-27 #1)', () => {
  /**
   * The test of a good cut: a person who never opens the detail view must not be
   * able to be surprised by something bad. Each of these four is a thing that has
   * gone wrong, or a thing whose outcome nobody established, and each is easy to
   * lose in a tidy-up.
   */
  const bad: readonly { readonly what: string; readonly over: Partial<ChatHeaderInput>; readonly needle: string }[] = [
    {
      what: 'a connection that failed',
      over: {
        connection: {
          kind: 'not-connected',
          modelRequested: 'claude-4.5-sonnet',
          account: null,
          problem: 'No stored login was valid, so nothing can be sent.',
        },
      },
      needle: 'No stored login was valid',
    },
    {
      what: 'a refusal',
      over: { refusal: 'The gate refused the send: the project has uncommitted changes it did not expect.' },
      needle: 'The gate refused the send',
    },
    {
      what: 'a save that did not happen',
      over: { saveFailure: 'The conversation was not saved: the file was open in another program.' },
      needle: 'The conversation was not saved',
    },
    {
      what: 'an attempt with no known outcome',
      over: { unresolvedAttempts: ['attempt-14', 'attempt-15'] },
      needle: 'attempt-14, attempt-15',
    },
  ];

  for (const each of bad) {
    it(`shows ${each.what} without anything being expanded`, () => {
      const view = chatHeaderView(headerInput(each.over));
      const visible = view.problems.map((problem) => problem.text).join('\n');
      assert.equal(
        visible.includes(each.needle),
        true,
        `${each.what} is not a detail. A person who never opens the detail view would not ` +
          `know about it, which is exactly the surprise this header is meant to prevent. ` +
          `What stayed visible was: ${visible === '' ? '(nothing)' : visible}`,
      );
    });
  }

  it('names every unresolved attempt rather than counting them', () => {
    const problems = headerProblems(headerInput({ unresolvedAttempts: ['attempt-14', 'attempt-15'] }));
    const text = problems.map((problem) => problem.text).join('\n');
    assert.equal(
      text.includes('attempt-15'),
      true,
      'a count tells someone two attempts are unresolved and leaves them unable to say ' +
        `which. It said: ${text}`,
    );
  });

  it('does not call an unestablished outcome a failure', () => {
    const problems = headerProblems(
      headerInput({ unresolvedAttempts: ['attempt-14'], unresolvedRuns: 2 }),
    );
    for (const problem of problems) {
      assert.equal(
        problem.severity,
        'unknown',
        `nobody measured what happened to ${problem.id}, so the window must not present it ` +
          'as something that went wrong. Unknown and failed are different things to a person ' +
          'deciding whether to run the work again.',
      );
    }
  });

  it('shows an unresolved run even while the window is otherwise idle', () => {
    const view = chatHeaderView(
      headerInput({ unresolvedRuns: 1, activityText: 'Waiting for your message.' }),
    );
    assert.equal(
      view.problems.some((problem) => problem.id === 'unresolved-runs'),
      true,
      'the window saying it is waiting for your message, with a run outstanding that it has ' +
        'stopped listening to, is the state a person most needs told about.',
    );
  });
});

describe('the composer (DSP-27 #2)', () => {
  function key(over: Partial<ComposerKey> = {}): ComposerKey {
    return {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      composing: false,
      ...over,
    };
  }

  it('sends on Enter', () => {
    assert.equal(
      composerKeyAction(key(), { canSend: true }),
      'send',
      'Enter is how a person sends a message in every chat they have ever used, and this ' +
        'window asked them for Ctrl+Enter.',
    );
  });

  it('breaks the line on Shift+Enter', () => {
    assert.equal(
      composerKeyAction(key({ shiftKey: true }), { canSend: true }),
      'insert-break',
      'Shift+Enter sending the message would make a multi-line mandate impossible to type.',
    );
  });

  it('keeps Ctrl+Enter and Cmd+Enter working', () => {
    assert.equal(composerKeyAction(key({ ctrlKey: true }), { canSend: true }), 'send');
    assert.equal(
      composerKeyAction(key({ metaKey: true }), { canSend: true }),
      'send',
      'the accelerator this window has asked for until now must not stop working in the ' +
        'release that adds a shorter one — someone has already learned it.',
    );
  });

  it('leaves an in-progress IME composition alone', () => {
    assert.equal(
      composerKeyAction(key({ composing: true }), { canSend: true }),
      'insert-break',
      'Enter while an input method is composing chooses the word. Sending there would take ' +
        'the message away mid-word from anyone typing a language that needs one.',
    );
  });

  it('does not reshape the text when it cannot send', () => {
    assert.equal(
      composerKeyAction(key(), { canSend: false }),
      'ignore',
      'someone who pressed Enter meaning send did not mean insert a line break, and the ' +
        'reason it did not send is already on screen beside the button.',
    );
  });

  it('leaves every other key to the textarea', () => {
    for (const other of ['a', 'Tab', 'Escape', 'ArrowUp']) {
      assert.equal(composerKeyAction(key({ key: other }), { canSend: true }), 'insert-break');
    }
  });

  it('clears the box only once the message has been accepted', () => {
    assert.equal(composerTextAfterSend('rework the verifier report', 'accepted'), '');
  });

  it('leaves the text in place on a refusal or a failed handover', () => {
    const typed = 'Walk the loop over DSP-27 and report what it finds.';
    for (const outcome of ['refused', 'failed', 'superseded'] as const) {
      assert.equal(
        composerTextAfterSend(typed, outcome),
        typed,
        `a send that came back ${outcome} left the person with nothing: the product ate what ` +
          'they typed at the same moment it told them no. Retyping a mandate from memory is ' +
          'not a recovery.',
      );
    }
  });
});

describe('the activity line (DSP-27 #4, #5)', () => {
  const idle = {
    loopLines: [] as readonly string[],
    loopRunning: false,
    chatActivityText: null,
    chatRunning: false,
  };

  it('says nothing at all when nothing is running', () => {
    assert.equal(
      activityLine(idle),
      null,
      'an empty moment is better than a confident fiction. A line describing activity while ' +
        'nothing is happening is invented by definition.',
    );
  });

  it('forwards the newest real journal line and keeps the earlier ones', () => {
    const line = activityLine({
      ...idle,
      loopRunning: true,
      loopLines: ['Entered agent \u201cImplementer\u201d.', 'Produced a report.'],
    });
    assert.equal(line?.text, 'Produced a report.');
    assert.equal(line?.source, 'loop-journal');
    assert.deepEqual(line?.earlier, ['Entered agent \u201cImplementer\u201d.']);
  });

  it('admits it has nothing yet rather than guessing a first step', () => {
    const line = activityLine({ ...idle, loopRunning: true });
    assert.equal(line?.source, 'dspatch');
    assert.equal(
      line?.text.includes('Waiting for the first step'),
      true,
      'the honest thing to say before the first journal entry is that there is not one yet.',
    );
  });

  it('leaves the screen once the result has arrived', () => {
    assert.equal(
      activityLine({
        ...idle,
        loopRunning: false,
        loopLines: ['Entered agent \u201cImplementer\u201d.', 'Run ended: completed.'],
      }),
      null,
      'the live log is a ticker, not history. Leaving it beside a finished loop turn is what ' +
        'made the window read like a debug view: the run is already accounted for above it, ' +
        'with the mandate, every reply and the recorded ending.',
    );
  });

  /**
   * The assertion that keeps "invent nothing" true under later edits. Every text
   * the function can produce is either a line that came from a recorded event or
   * one of the two sentences the module declares about DSpatch's own knowledge.
   */
  it('never says anything it was not given', () => {
    const real = ['Entered agent \u201cVerifier\u201d.', 'Took branch \u201crework\u201d to Implementer.'];
    const chat = 'Running a tool (read_file). 2 of 3 tool calls have finished.';
    for (const loopRunning of [true, false]) {
      for (const chatRunning of [true, false]) {
        for (const loopLines of [[], real]) {
          for (const chatActivityText of [null, chat, '']) {
            const line = activityLine({ loopLines, loopRunning, chatActivityText, chatRunning });
            if (line === null) {
              continue;
            }
            const allowed =
              loopLines.includes(line.text) ||
              line.text === chatActivityText ||
              (ACTIVITY_OWN_SENTENCES as readonly string[]).includes(line.text);
            assert.equal(
              allowed,
              true,
              'the activity line said something no event said and DSpatch never declared: ' +
                `\u201c${line.text}\u201d. A product whose claim is that work is traceable to real ` +
                'code cannot narrate work it did not see.',
            );
          }
        }
      }
    }
  });

  it('describes an ordinary turn from the events, not from a guess', () => {
    const chat = 'Running a tool (read_file). 2 of 3 tool calls have finished.';
    const line = activityLine({ ...idle, chatRunning: true, chatActivityText: chat });
    assert.equal(line?.text, chat);
    assert.equal(line?.source, 'chat-events');
    assert.equal(line?.stepText, null, 'no loop is running, so no step is open');
  });

  /*
   * Where the run is, and what the step is doing: two facts, one call (DSP-87).
   *
   * The journal's newest line is written when a node is *entered* and does not move
   * again until the next one is, so a step streaming for four minutes leaves it
   * frozen on `Entered agent "…"`. True, and not activity. `stepText` is the half
   * that moves, and it comes out of the same call as `text` on purpose: the defect
   * this card was raised for was two places in the window answering "is anything
   * happening" from two sources and disagreeing, so the cure has to be a shape in
   * which they cannot.
   */
  it('reports where the run is and what the step is doing, separately', () => {
    const line = activityLine({
      ...idle,
      loopRunning: true,
      loopLines: ['Entered agent \u201cImplementer\u201d.'],
      loopStepText: 'Working \u2014 writing a reply.',
    });
    assert.equal(line?.text, 'Entered agent \u201cImplementer\u201d.');
    assert.equal(line?.stepText, 'Working \u2014 writing a reply.');
    assert.equal(line?.source, 'loop-step');
  });

  it('has no step line between steps, and still says where the run is', () => {
    const line = activityLine({
      ...idle,
      loopRunning: true,
      loopLines: ['Entered agent \u201cImplementer\u201d.', 'Produced a report.'],
      loopStepText: null,
    });
    assert.equal(line?.stepText, null);
    assert.equal(line?.text, 'Produced a report.');
    assert.equal(line?.source, 'loop-journal');
  });

  it('never lets the step line be the same sentence as the run line', () => {
    // Two places showing one sentence twice is what the window did after the first
    // attempt at this fix, and "the chat says less" is the card. They are allowed to
    // be different or one of them absent; they may not be a duplicate.
    for (const stepText of [null, 'Working \u2014 writing a reply.', '']) {
      const line = activityLine({
        ...idle,
        loopRunning: true,
        loopLines: ['Entered agent \u201cImplementer\u201d.'],
        loopStepText: stepText,
      });
      assert.notEqual(line?.stepText, line?.text);
    }
  });
});

describe('the handoff trail (DSP-27 #3)', () => {
  const replies = [
    { nodeId: 'n2', nodeLabel: 'Implementer', text: 'Changed four files.' },
    { nodeId: 'n3', nodeLabel: 'Verifier', text: 'Two assertions do not hold.' },
    { nodeId: 'n2', nodeLabel: 'Implementer', text: 'Both fixed.' },
  ];

  it('shows the step from one role to the next', () => {
    const trail = handoffTrail(replies);
    const handoffs = trail.filter((item) => item.kind === 'handoff');
    assert.equal(
      handoffs.length,
      2,
      'a reader looking at three replies in a column cannot see that work moved between ' +
        'roles unless the move is drawn. It is what a loop run mostly consists of.',
    );
    assert.equal(handoffs[0]?.text, 'Implementer handed over to Verifier.');
  });

  it('keeps every reply, in the recorded order', () => {
    const trail = handoffTrail(replies);
    assert.deepEqual(
      trail.filter((item) => item.kind === 'reply').map((item) => item.text),
      ['Changed four files.', 'Two assertions do not hold.', 'Both fixed.'],
      'the trail is the history. An agent\u2019s final reply that the drawing summarised away ' +
        'is a reply nobody can read after a restart.',
    );
  });

  it('says when a role is working for the second time', () => {
    const trail = handoffTrail(replies);
    const second = trail.filter((item) => item.kind === 'reply').at(-1);
    assert.equal(
      second?.occurrenceNote,
      'second time in this run',
      'implementer, verifier, implementer is what rework looks like, and two entries both ' +
        'labelled Implementer leave a reader unable to tell the second pass from the first.',
    );
    assert.equal(
      trail.filter((item) => item.kind === 'handoff').at(-1)?.text,
      'Verifier handed over to Implementer, for the second time.',
    );
  });

  it('claims only that one role stopped and another started', () => {
    for (const item of handoffTrail(replies)) {
      if (item.kind !== 'handoff') {
        continue;
      }
      for (const verdict of ['approved', 'passed', 'accepted', 'rejected']) {
        assert.equal(
          item.text.toLowerCase().includes(verdict),
          false,
          'the record shows that one node stopped and another started. Whether the first ' +
            `was approved is a different question, decided elsewhere and once. It said: ${item.text}`,
        );
      }
    }
  });

  it('draws no handoff for a run with one reply, or none', () => {
    assert.deepEqual(handoffTrail([]), []);
    assert.equal(handoffTrail([replies[0]!]).length, 1);
  });

  /**
   * DSP-53 #4 asks the handover to name the role **and say briefly why control
   * moved**. The trail could only ever do the first, because it reads replies and
   * a reply says who spoke, not which edge was taken afterwards. The branch comes
   * from the runner's own `edge-taken` entries.
   */
  it('says why control moved when the run\u2019s branches are supplied', () => {
    const trail = handoffTrail(replies, [
      { fromNodeId: 'n2', toNodeId: 'n3', label: 'work succeeded' },
      { fromNodeId: 'n3', toNodeId: 'n2', label: 'assignment not met' },
    ]);
    const handoffs = trail.filter((item) => item.kind === 'handoff');
    assert.equal(
      handoffs[0]?.text,
      'Implementer handed over to Verifier. The run took the branch “work succeeded”.',
    );
    assert.equal(
      handoffs[1]?.text,
      'Verifier handed over to Implementer, for the second time. The run took the branch “assignment not met”.',
    );
  });

  /**
   * The branch is still not a verdict. *assignment not met* is the drawing's word
   * for which edge was taken, and adding it must not smuggle in the claim the
   * test above forbids.
   */
  it('still claims nothing about approval when it names the branch', () => {
    const trail = handoffTrail(replies, [
      { fromNodeId: 'n2', toNodeId: 'n3', label: 'work succeeded' },
    ]);
    for (const item of trail) {
      if (item.kind !== 'handoff') {
        continue;
      }
      for (const verdict of ['approved', 'passed', 'accepted', 'rejected']) {
        assert.equal(item.text.toLowerCase().includes(verdict), false, item.text);
      }
    }
  });

  /**
   * Every record written before today has no branches to supply, and a run whose
   * journal is not to hand must read exactly as it did. This is the assertion
   * that keeps the new clause additive rather than a format change.
   */
  it('produces the sentences it always did when no branches are supplied', () => {
    assert.deepEqual(handoffTrail(replies), handoffTrail(replies, []));
    assert.equal(
      handoffTrail(replies, []).filter((item) => item.kind === 'handoff')[0]?.text,
      'Implementer handed over to Verifier.',
    );
  });

  it('leaves the sentence alone for a branch it has no label for', () => {
    const trail = handoffTrail(replies, [{ fromNodeId: 'n2', toNodeId: 'n3', label: '  ' }]);
    assert.equal(
      trail.filter((item) => item.kind === 'handoff')[0]?.text,
      'Implementer handed over to Verifier.',
    );
  });

  /**
   * A branch belonging to a different pair of nodes must not be attached to this
   * move. The negative control for the matching above: supply only a branch that
   * does not fit, and the sentence must stay unadorned rather than borrowing it.
   */
  it('does not borrow a branch that belongs between two other nodes', () => {
    const trail = handoffTrail(replies, [
      { fromNodeId: 'n9', toNodeId: 'n8', label: 'somewhere else entirely' },
    ]);
    for (const item of trail) {
      assert.equal(item.text.includes('somewhere else entirely'), false, item.text);
    }
  });
});
