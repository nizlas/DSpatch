/**
 * Negative controls for the scripted workflow's gates.
 *
 * The point of these tests is not coverage. It is that report 013 found two gates
 * that could not fail: the streaming rule accepted a buffered replay, and element
 * 1 never checked that an account was named. A gate that cannot fail is not
 * evidence, so each gate here is fed a counter-example and must reject it.
 *
 * They import the same functions `workflow-script.ts` calls, not a copy of the
 * rules. Node strips the types itself, so there is no build step:
 *
 *     node --test tests/workflow-gates.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkAnswerGrewWhileStreaming,
  checkComposerKeysBehave,
  checkConnectionNamesAnAccount,
  checkInterruptedRunKeepsItsWork,
  checkMessageJoinedTheRun,
  checkOneThreadWithHandover,
  type ComposerKeyObservation,
  type InterruptedRunObservation,
  type MessageDuringWorkObservation,
  type ThreadObservation,
} from '../src/renderer/workflow-gates.ts';
import { handoffTrail } from '../src/shared/chat-workspace.ts';
import {
  composerRouteNote,
  loopInstructionBadgeText,
  loopInstructionStatusText,
  type LoopInstruction,
} from '../src/shared/loop-instruction.ts';
import { conversationStanding, type LoopTurn } from '../src/shared/loop-transcript.ts';

// --- S1: the streaming gate ------------------------------------------------

test('rejects a buffered replay: the placeholder, then the whole answer at once', () => {
  // Exactly the shape the old gate accepted: the `…` placeholder, then one delta
  // carrying everything. Two distinct lengths at two distinct times, growing.
  const verdict = checkAnswerGrewWhileStreaming([
    { atMs: 110, answerChars: 1 },
    { atMs: 5_420, answerChars: 229 },
  ]);
  assert.equal(verdict.substantiveSampleCount, 1);
  assert.equal(verdict.distinctSubstantiveAnswerLengths, 1);
  assert.notEqual(verdict.failure, null);
  assert.match(String(verdict.failure), /did not visibly grow/);
});

test('the superseded rule accepted that same buffered replay', () => {
  // Not a test of shipped code: a reconstruction of the rule report 013 found
  // toothless, kept here so the counter-example above is visibly a counter-example
  // and not just an assertion that passes.
  const samples = [
    { atMs: 110, answerChars: 1 },
    { atMs: 5_420, answerChars: 229 },
  ];
  const oldDistinctLengths = new Set(samples.map((s) => s.answerChars)).size;
  const oldDistinctTimes = new Set(samples.map((s) => s.atMs)).size;
  const oldGrew = samples.some(
    (sample, at) => at > 0 && sample.answerChars > (samples[at - 1]?.answerChars ?? 0),
  );
  const oldRulePassed = oldDistinctLengths >= 2 && oldDistinctTimes >= 2 && oldGrew;
  assert.equal(oldRulePassed, true);
  assert.notEqual(checkAnswerGrewWhileStreaming(samples).failure, null);
});

test('rejects a turn that never showed any text at all', () => {
  const verdict = checkAnswerGrewWhileStreaming([{ atMs: 110, answerChars: 1 }]);
  assert.equal(verdict.substantiveSampleCount, 0);
  assert.notEqual(verdict.failure, null);
});

test('rejects no samples at all', () => {
  const verdict = checkAnswerGrewWhileStreaming([]);
  assert.equal(verdict.substantiveSampleCount, 0);
  assert.notEqual(verdict.failure, null);
});

test('rejects a single long answer with no placeholder before it', () => {
  const verdict = checkAnswerGrewWhileStreaming([{ atMs: 5_420, answerChars: 229 }]);
  assert.notEqual(verdict.failure, null);
});

test('accepts the real recorded run: 1 then 26, 121, 229 characters', () => {
  // Report 013's own independent artifact run. The two intermediate lengths are
  // what a single delivery cannot produce.
  const verdict = checkAnswerGrewWhileStreaming([
    { atMs: 109, answerChars: 1 },
    { atMs: 5_151, answerChars: 26 },
    { atMs: 5_339, answerChars: 121 },
    { atMs: 5_420, answerChars: 229 },
  ]);
  assert.equal(verdict.substantiveSampleCount, 3);
  assert.equal(verdict.distinctSubstantiveAnswerLengths, 3);
  assert.equal(verdict.grewBetweenSubstantiveSamples, true);
  assert.equal(verdict.failure, null);
});

test('accepts the minimum honest case: two substantive lengths at two times', () => {
  const verdict = checkAnswerGrewWhileStreaming([
    { atMs: 100, answerChars: 1 },
    { atMs: 900, answerChars: 42 },
    { atMs: 1_800, answerChars: 205 },
  ]);
  assert.equal(verdict.failure, null);
});

test('rejects two substantive samples of equal length at different times', () => {
  // Re-rendering the same text is not growth.
  const verdict = checkAnswerGrewWhileStreaming([
    { atMs: 100, answerChars: 1 },
    { atMs: 900, answerChars: 205 },
    { atMs: 1_800, answerChars: 205 },
  ]);
  assert.equal(verdict.distinctSubstantiveAnswerLengths, 1);
  assert.notEqual(verdict.failure, null);
});

// --- B1: the connection gate ----------------------------------------------

test('rejects a connected window that named no account', () => {
  const verdict = checkConnectionNamesAnAccount({
    connectionKind: 'connected',
    accountCharacters: 0,
    accountLooksLikeAnAddress: false,
    accountSaysUnknown: false,
  });
  assert.notEqual(verdict.failure, null);
  assert.match(String(verdict.failure), /named no account/);
});

test('rejects an account field that says unknown', () => {
  const verdict = checkConnectionNamesAnAccount({
    connectionKind: 'connected',
    accountCharacters: 15,
    accountLooksLikeAnAddress: false,
    accountSaysUnknown: true,
  });
  assert.notEqual(verdict.failure, null);
  assert.match(String(verdict.failure), /unknown/);
});

test('rejects a malformed account that is not address-shaped', () => {
  const verdict = checkConnectionNamesAnAccount({
    connectionKind: 'connected',
    accountCharacters: 7,
    accountLooksLikeAnAddress: false,
    accountSaysUnknown: false,
  });
  assert.notEqual(verdict.failure, null);
  assert.match(String(verdict.failure), /not address-shaped/);
});

test('rejects an implausibly short account even when it contains an at sign', () => {
  const verdict = checkConnectionNamesAnAccount({
    connectionKind: 'connected',
    accountCharacters: 1,
    accountLooksLikeAnAddress: true,
    accountSaysUnknown: false,
  });
  assert.notEqual(verdict.failure, null);
});

test('still rejects a window that is not connected', () => {
  for (const kind of ['not-connected', 'error', 'checking']) {
    const verdict = checkConnectionNamesAnAccount({
      connectionKind: kind,
      accountCharacters: 27,
      accountLooksLikeAnAddress: true,
      accountSaysUnknown: false,
    });
    assert.notEqual(verdict.failure, null, `kind ${kind} should be rejected`);
  }
});

test('accepts the real recorded shape: connected, 27 characters, contains an at sign', () => {
  const verdict = checkConnectionNamesAnAccount({
    connectionKind: 'connected',
    accountCharacters: 27,
    accountLooksLikeAnAddress: true,
    accountSaysUnknown: false,
  });
  assert.equal(verdict.failure, null);
});

test('no failure message can contain an account address (connection gate)', () => {
  // The gate never receives the text, so it cannot repeat it. This asserts the
  // property rather than trusting the reading: an address-shaped value is passed
  // in no parameter at all, and the messages carry only counts and booleans.
  const verdicts = [
    checkConnectionNamesAnAccount({
      connectionKind: 'connected',
      accountCharacters: 0,
      accountLooksLikeAnAddress: false,
      accountSaysUnknown: false,
    }),
    checkConnectionNamesAnAccount({
      connectionKind: 'connected',
      accountCharacters: 7,
      accountLooksLikeAnAddress: false,
      accountSaysUnknown: false,
    }),
  ];
  for (const verdict of verdicts) {
    assert.doesNotMatch(String(verdict.failure), /@/);
  }
});

/* ------------------------------------------------------------------------- */
/* The conversation gates: §10 trials 4, 10 and 11                            */
/* ------------------------------------------------------------------------- */

/**
 * These four gates are fed the **product's own sentences** wherever an accepted case
 * is asserted, rather than strings retyped here.
 *
 * That is the difference between a gate that matches the window and a gate that
 * matches what someone remembered of it. `loopInstructionStatusText`,
 * `composerRouteNote`, `handoffTrail` and `conversationStanding` write every sentence
 * the scenario reads out of the DOM, so calling them here means a reworded product
 * makes this file fail rather than quietly leaving a gate matching text that no
 * longer appears.
 */

// --- Enter and Shift+Enter -------------------------------------------------

const KEYS_BEHAVING: ComposerKeyObservation = {
  shiftEnterSentSomething: false,
  shiftEnterDefaultPrevented: false,
  shiftEnterTextPreserved: true,
  enterSentSomething: true,
  enterDefaultPrevented: true,
};

test('accepts the keyboard behaving as §9 specifies', () => {
  assert.equal(checkComposerKeysBehave(KEYS_BEHAVING).failure, null);
});

test('rejects Shift+Enter sending the message', () => {
  const verdict = checkComposerKeysBehave({
    ...KEYS_BEHAVING,
    shiftEnterSentSomething: true,
  });
  assert.match(String(verdict.failure), /Shift\+Enter sent the message/);
});

test('rejects Shift+Enter being swallowed, which inserts no line break', () => {
  // The likeliest wrong fix: prevent the default for every Enter, so nothing sends
  // on Shift+Enter and nothing breaks the line either.
  const verdict = checkComposerKeysBehave({
    ...KEYS_BEHAVING,
    shiftEnterDefaultPrevented: true,
  });
  assert.match(String(verdict.failure), /no line break can be inserted/);
});

test('rejects a keypress that changed what the person had written', () => {
  const verdict = checkComposerKeysBehave({
    ...KEYS_BEHAVING,
    shiftEnterTextPreserved: false,
  });
  assert.notEqual(verdict.failure, null);
});

test('rejects Enter not sending, and Enter sending without cancelling the key', () => {
  assert.match(
    String(checkComposerKeysBehave({ ...KEYS_BEHAVING, enterSentSomething: false }).failure),
    /Enter did not send/,
  );
  assert.match(
    String(checkComposerKeysBehave({ ...KEYS_BEHAVING, enterDefaultPrevented: false }).failure),
    /also inserted a line break/,
  );
});

// --- One thread, with a handover -------------------------------------------

/** The handover sentence the window actually writes, from the product's own function. */
const REAL_HANDOVER = handoffTrail(
  [
    { nodeId: 'work', nodeLabel: 'Do what was asked', text: 'I created NOTES.md.' },
    { nodeId: 'check', nodeLabel: 'Check the work', text: 'RESULT: met' },
  ],
  [{ fromNodeId: 'work', toNodeId: 'check', label: 'work succeeded' }],
)
  .filter((item) => item.kind === 'handoff')
  .map((item) => item.text);

const THREAD_AS_IT_SHOULD_BE: ThreadObservation = {
  userMessagesSent: ['do the work', 'one more thing', 'and one last thing'],
  userMessagesShownInThread: ['do the work', 'one more thing', 'and one last thing'],
  replyAuthorLinesShownInThread: [
    'Do what was asked (work) answered:',
    'Check the work (check) answered:',
  ],
  handoverSentencesShownInThread: REAL_HANDOVER,
  replyTextsShownInThread: ['I created NOTES.md.', 'RESULT: met'],
};

test('the handover sentence the product writes satisfies the thread gate', () => {
  assert.equal(REAL_HANDOVER.length, 1);
  assert.equal(checkOneThreadWithHandover(THREAD_AS_IT_SHOULD_BE).failure, null);
});

test('rejects a thread missing one of the user\u2019s own messages', () => {
  // What a pending-instructions panel beside the conversation would look like: the
  // message exists in the window and is not in the thread, so the reader is sent
  // elsewhere for half the conversation.
  const verdict = checkOneThreadWithHandover({
    ...THREAD_AS_IT_SHOULD_BE,
    userMessagesShownInThread: ['do the work', '', 'and one last thing'],
  });
  assert.match(String(verdict.failure), /not in the conversation thread/);
});

test('rejects a handover sentence that does not say why control moved', () => {
  // Exactly the sentence this window wrote before the previous increment.
  const verdict = checkOneThreadWithHandover({
    ...THREAD_AS_IT_SHOULD_BE,
    handoverSentencesShownInThread: ['Do what was asked handed over to Check the work.'],
  });
  assert.match(String(verdict.failure), /without saying why/);
});

test('rejects two replies with nothing between them', () => {
  const verdict = checkOneThreadWithHandover({
    ...THREAD_AS_IT_SHOULD_BE,
    handoverSentencesShownInThread: [],
  });
  assert.match(String(verdict.failure), /no handover/);
});

test('rejects a thread where only one agent ever spoke', () => {
  const verdict = checkOneThreadWithHandover({
    ...THREAD_AS_IT_SHOULD_BE,
    replyAuthorLinesShownInThread: ['Do what was asked (work) answered:'],
  });
  assert.match(String(verdict.failure), /no handover in it to follow/);
});

test('rejects a blank block attributed to an agent', () => {
  const verdict = checkOneThreadWithHandover({
    ...THREAD_AS_IT_SHOULD_BE,
    replyTextsShownInThread: ['I created NOTES.md.', '   '],
  });
  assert.match(String(verdict.failure), /no text in it/);
});

// --- A message sent while the loop is working -------------------------------

const RECEIVED: LoopInstruction = {
  id: 'ins-1',
  runId: 'run-1',
  text: 'one more thing',
  receivedAtUtc: '2026-09-19T12:00:00.000Z',
  delivered: null,
  runEnded: false,
};

const DELIVERED: LoopInstruction = {
  ...RECEIVED,
  delivered: {
    nodeId: 'check',
    nodeLabel: 'Check the work',
    occurrence: 1,
    atUtc: '2026-09-19T12:04:00.000Z',
  },
};

const NEVER_DELIVERED: LoopInstruction = { ...RECEIVED, id: 'ins-2', runEnded: true };

/** The window's own sentences, so the gate is matched against the product. */
const MESSAGE_AS_IT_SHOULD_BE: MessageDuringWorkObservation = {
  routeNoteShownInWindow: String(composerRouteNote({ kind: 'instruction', runId: 'run-1' })),
  loopEntriesBeforeSending: 1,
  loopEntriesAfterSending: 1,
  stepRunningWhenSent: 'Do what was asked',
  pendingBadgeShownInWindow: loopInstructionBadgeText(RECEIVED),
  pendingSentenceShownInWindow: loopInstructionStatusText(RECEIVED),
  deliveredBadgeShownInWindow: loopInstructionBadgeText(DELIVERED),
  deliveredSentenceShownInWindow: loopInstructionStatusText(DELIVERED),
  undeliveredBadgeShownInWindow: loopInstructionBadgeText(NEVER_DELIVERED),
  undeliveredSentenceShownInWindow: loopInstructionStatusText(NEVER_DELIVERED),
};

test('the sentences the product writes for a message satisfy the gate', () => {
  assert.equal(checkMessageJoinedTheRun(MESSAGE_AS_IT_SHOULD_BE).failure, null);
});

test('rejects a second loop run appearing when a message was sent during one', () => {
  // The competing-run defect, which is the whole reason the composer could not be
  // unlocked before: two walks in one working copy.
  const verdict = checkMessageJoinedTheRun({
    ...MESSAGE_AS_IT_SHOULD_BE,
    loopEntriesAfterSending: 2,
  });
  assert.match(String(verdict.failure), /must never start a second run/);
});

test('rejects a window that did not say where the press would go', () => {
  const verdict = checkMessageJoinedTheRun({
    ...MESSAGE_AS_IT_SHOULD_BE,
    routeNoteShownInWindow: '',
  });
  // "beside the composer" since the Send button went: the note is in the same place,
  // and it is now the only thing that says where a press would go.
  assert.match(String(verdict.failure), /beside the composer/);
});

test('rejects a received message that reads as delivered', () => {
  // The §4.4 defect in one string: DSpatch holding a message presented as an agent
  // having read it.
  const verdict = checkMessageJoinedTheRun({
    ...MESSAGE_AS_IT_SHOULD_BE,
    pendingSentenceShownInWindow:
      'Given to \u201CDo what was asked\u201D when that step started.',
  });
  assert.notEqual(verdict.failure, null);
});

test('rejects a delivery that names no step', () => {
  const verdict = checkMessageJoinedTheRun({
    ...MESSAGE_AS_IT_SHOULD_BE,
    deliveredSentenceShownInWindow: 'Your message has been delivered to the agent.',
  });
  assert.match(String(verdict.failure), /without naming the step/);
});

test('rejects a delivery to the step that was already running', () => {
  // A provider turn in flight cannot be told anything mid-way, so this claim cannot
  // be true. The gate exists because the alternative is the script sending its
  // message a moment too early and the run looking correct.
  const verdict = checkMessageJoinedTheRun({
    ...MESSAGE_AS_IT_SHOULD_BE,
    deliveredSentenceShownInWindow: loopInstructionStatusText({
      ...RECEIVED,
      delivered: {
        nodeId: 'work',
        nodeLabel: 'Do what was asked',
        occurrence: 1,
        atUtc: '2026-09-19T12:04:00.000Z',
      },
    }),
  });
  assert.match(String(verdict.failure), /already running when it was sent/);
});

test('rejects a message the run outran still reading as waiting', () => {
  const verdict = checkMessageJoinedTheRun({
    ...MESSAGE_AS_IT_SHOULD_BE,
    undeliveredSentenceShownInWindow: loopInstructionStatusText(RECEIVED),
    undeliveredBadgeShownInWindow: loopInstructionBadgeText(RECEIVED),
  });
  assert.match(String(verdict.failure), /never received/);
});

test('rejects one sentence used for all three states', () => {
  const same = 'Your message has been noted.';
  const verdict = checkMessageJoinedTheRun({
    ...MESSAGE_AS_IT_SHOULD_BE,
    pendingSentenceShownInWindow: `${same} no agent has been given it yet`,
    deliveredSentenceShownInWindow: `${same} no agent has been given it yet`,
    undeliveredSentenceShownInWindow: `${same} no agent has been given it yet`,
  });
  assert.notEqual(verdict.failure, null);
});

// --- An interrupted run ----------------------------------------------------

const RUNNING_TURN: LoopTurn = {
  runId: 'run-2',
  mandate: 'read the files and write READING.md',
  sentAtUtc: '2026-09-19T12:10:00.000Z',
  replies: [],
  cancelRequested: false,
  abandoned: false,
  ending: null,
};

const STOP_REQUESTED = conversationStanding({
  turn: { ...RUNNING_TURN, cancelRequested: true },
  stillWatching: true,
  currentStepLabel: 'Do what was asked',
  instructions: [],
});

const AFTER_THE_STOP = conversationStanding({
  turn: {
    ...RUNNING_TURN,
    cancelRequested: true,
    ending: {
      kind: 'cancelled',
      text:
        'You asked this run to stop. Completed steps were not replayed and files were ' +
        'left as they are.',
      terminalNodeId: null,
      terminalLabel: null,
      outcome: null,
    },
  },
  stillWatching: true,
  currentStepLabel: 'Do what was asked',
  instructions: [],
});

const INTERRUPTION_AS_IT_SHOULD_BE: InterruptedRunObservation = {
  standingsSeen: ['active', 'stop-requested', 'stopped'],
  whileStopping: STOP_REQUESTED,
  afterTheEnd: AFTER_THE_STOP,
  badgeShownInWindow: 'stopped short',
  accountShownInWindow:
    'You asked this run to stop. Completed steps were not replayed and files were left ' +
    'as they are.',
  mandateShownInWindow: 'read the files and write READING.md',
  mandateAsSent: 'read the files and write READING.md',
  earlierMandateShownInWindow: 'create NOTES.md',
  earlierMandateAsSent: 'create NOTES.md',
  earlierRepliesStillShown: 2,
};

test('the standing sentences the product writes satisfy the interruption gate', () => {
  assert.equal(checkInterruptedRunKeepsItsWork(INTERRUPTION_AS_IT_SHOULD_BE).failure, null);
});

test('rejects a window that went straight from working to stopped', () => {
  // Asking a provider to stop is not the provider having stopped, and DSpatch has
  // measured runs that kept working afterwards.
  const verdict = checkInterruptedRunKeepsItsWork({
    ...INTERRUPTION_AS_IT_SHOULD_BE,
    standingsSeen: ['active', 'stopped'],
  });
  assert.match(String(verdict.failure), /nothing in between/);
});

test('rejects a run never seen working, and one never seen stopped', () => {
  assert.match(
    String(
      checkInterruptedRunKeepsItsWork({
        ...INTERRUPTION_AS_IT_SHOULD_BE,
        standingsSeen: ['stop-requested', 'stopped'],
      }).failure,
    ),
    /never showed the run as active/,
  );
  assert.match(
    String(
      checkInterruptedRunKeepsItsWork({
        ...INTERRUPTION_AS_IT_SHOULD_BE,
        standingsSeen: ['active', 'stop-requested'],
      }).failure,
    ),
    /never reached a state the window calls stopped/,
  );
});

test('rejects a stop that reads as a stop before the run has said it stopped', () => {
  const verdict = checkInterruptedRunKeepsItsWork({
    ...INTERRUPTION_AS_IT_SHOULD_BE,
    whileStopping: {
      ...STOP_REQUESTED,
      whoIsWorking: 'The agent has stopped.',
    },
  });
  assert.match(String(verdict.failure), /asking is not stopping/);
});

test('rejects an unanswered one of §9\u2019s four questions', () => {
  const verdict = checkInterruptedRunKeepsItsWork({
    ...INTERRUPTION_AS_IT_SHOULD_BE,
    afterTheEnd: { ...AFTER_THE_STOP, waitingFor: '' },
  });
  assert.match(String(verdict.failure), /unanswered/);
});

test('rejects an interruption that promises nothing about repeating work', () => {
  const verdict = checkInterruptedRunKeepsItsWork({
    ...INTERRUPTION_AS_IT_SHOULD_BE,
    afterTheEnd: { ...AFTER_THE_STOP, whatHappensNext: 'Press Send to try again.' },
  });
  assert.match(String(verdict.failure), /nothing will be repeated/i);
});

test('rejects an interruption that lost the assignment or the history', () => {
  assert.match(
    String(
      checkInterruptedRunKeepsItsWork({
        ...INTERRUPTION_AS_IT_SHOULD_BE,
        mandateShownInWindow: '',
      }).failure,
    ),
    /no longer in the thread/,
  );
  assert.match(
    String(
      checkInterruptedRunKeepsItsWork({
        ...INTERRUPTION_AS_IT_SHOULD_BE,
        earlierMandateShownInWindow: '',
      }).failure,
    ),
    /history did not survive/,
  );
  assert.match(
    String(
      checkInterruptedRunKeepsItsWork({
        ...INTERRUPTION_AS_IT_SHOULD_BE,
        earlierRepliesStillShown: 1,
      }).failure,
    ),
    /replies are down to/,
  );
});

test('rejects any claim of success over an interrupted run', () => {
  for (const claim of [
    'a started command passed',
    'the assignment was met',
    'Assignment met',
  ]) {
    assert.match(
      String(
        checkInterruptedRunKeepsItsWork({
          ...INTERRUPTION_AS_IT_SHOULD_BE,
          accountShownInWindow: `You asked this run to stop. ${claim}.`,
        }).failure,
      ),
      /false success/,
      `"${claim}" in the account should be rejected`,
    );
    assert.notEqual(
      checkInterruptedRunKeepsItsWork({
        ...INTERRUPTION_AS_IT_SHOULD_BE,
        badgeShownInWindow: claim,
      }).failure,
      null,
      `"${claim}" in the badge should be rejected`,
    );
  }
});

test('rejects an interrupted run left with nothing said about it', () => {
  const verdict = checkInterruptedRunKeepsItsWork({
    ...INTERRUPTION_AS_IT_SHOULD_BE,
    accountShownInWindow: '   ',
  });
  assert.match(String(verdict.failure), /nothing said about how it/);
});
