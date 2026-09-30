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
  checkDeletedProseIsGone,
  checkNeverSilentWhileAnswering,
  checkInterruptedRunKeepsItsWork,
  checkMessageJoinedTheRun,
  checkFolderTree,
  checkGlintFrameIsWorthReading,
  checkLoopFiledAndHandedOver,
  checkPulseCarriesFurther,
  checkOneThreadWithHandover,
  checkSelectionIsInert,
  checkStopSaysNothingExtra,
  checkWorkingRootsReadHonestly,
  checkWorkspaceReopened,
  type ComposerKeyObservation,
  type DeletedProseObservation,
  type StopAsAskedObservation,
  type StreamingSilenceSample,
  type WorkingRootsObservation,
  type FolderTreeObservation,
  type InertSelectionObservation,
  type ReopenedWorkspaceObservation,
  type InterruptedRunObservation,
  type LoopResultObservation,
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
  routeNoteShownInWindow: composerRouteNote({ kind: 'instruction', runId: 'run-1' }) ?? '',
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

/*
 * This gate ran the other way until DSP-87, and the inversion is the point rather
 * than an accident of wording. The window used to have to say, beside the composer
 * and for the whole of every run, that a press would join the run rather than start
 * a second one. Niclas read the built app and the sentence was standing there next
 * to a message that already said what had become of it.
 *
 * Nothing it asserted has stopped being asserted: that no second run starts is the
 * entry count two tests above, which measures the run rather than a promise about
 * it, and what became of the message is the three sentences below, written after the
 * fact about the message actually sent. What is gone is the telling in advance.
 */
test('rejects a standing paragraph beside the composer', () => {
  const verdict = checkMessageJoinedTheRun({
    ...MESSAGE_AS_IT_SHOULD_BE,
    routeNoteShownInWindow:
      'A loop run is working. Sending adds your message to it rather than starting a ' +
      'second run in this project.',
  });
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
});

const STOPPED_AS_ASKED = conversationStanding({
  turn: {
    ...RUNNING_TURN,
    cancelRequested: true,
    ending: {
      kind: 'cancelled',
      text:
        'You asked this run to stop. Completed steps were not replayed and files were ' +
        'left as they are.',
      shortText: null,
      actionNote: null,
      terminalNodeId: null,
      terminalLabel: null,
      outcome: null,
    },
  },
  stillWatching: true,
});

/**
 * The window as DSP-90 leaves it at a stop somebody asked for: the marking, and
 * nothing after it.
 *
 * `accountShownInWindow` is empty in the *passing* fixture, which is the inversion
 * this card makes. It used to be the account sentence, and requiring it is what put
 * a paragraph of internal vocabulary under Niclas's own cancellation.
 *
 * Both notes are taken from `conversationStanding` rather than written here, so the
 * gate is checked against what the product actually says. A fixture with hand-written
 * prose in it would pass a gate the product fails.
 */
const INTERRUPTION_AS_IT_SHOULD_BE: InterruptedRunObservation = {
  standingsSeen: ['active', 'stop-requested', 'stopped'],
  noteWhileStopping: STOP_REQUESTED.actionNote ?? '',
  noteAfterTheEnd: STOPPED_AS_ASKED.actionNote ?? '',
  standingDisclosuresInTheWindow: 0,
  badgeShownInWindow: 'stopped short',
  accountShownInWindow: '',
  mandateShownInWindow: 'read the files and write READING.md',
  mandateAsSent: 'read the files and write READING.md',
  earlierMandateShownInWindow: 'create NOTES.md',
  earlierMandateAsSent: 'create NOTES.md',
  earlierRepliesStillShown: 2,
};

test('what the product says at an interruption satisfies the interruption gate', () => {
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
    noteWhileStopping: 'The agent has stopped.',
  });
  assert.match(String(verdict.failure), /asking is not stopping/);
});

/**
 * DSP-90's own assertion, and it replaces the test that required §9's four questions
 * to be answered in prose at every state.
 *
 * The fault it reproduces is the one Niclas met: the stop is confirmed, and the
 * window explains it anyway. The old test demanded exactly that explanation, so the
 * two cannot both exist — which is why this is an inversion rather than an addition.
 */
test('rejects a confirmed stop that was explained anyway', () => {
  const verdict = checkInterruptedRunKeepsItsWork({
    ...INTERRUPTION_AS_IT_SHOULD_BE,
    noteAfterTheEnd:
      'The run was stopped before it finished. What it had already done is still in ' +
      'your project; nothing was undone and nothing was replayed.',
  });
  assert.match(String(verdict.failure), /explained it anyway/);
});

/**
 * And the one circumstance that may still speak there, allowed by name.
 *
 * Without this the gate would be *silence after a stop*, which would also forbid
 * telling someone their run's record was lost — the case Niclas gave as an example
 * of what must appear.
 */
test('allows a record that could not be written to speak at a confirmed stop', () => {
  const verdict = checkInterruptedRunKeepsItsWork({
    ...INTERRUPTION_AS_IT_SHOULD_BE,
    noteAfterTheEnd:
      'This run was not fully kept on disk: the file could not be written. What is on ' +
      'screen is all there will be after a restart.',
  });
  assert.equal(verdict.failure, null);
});

/**
 * The obvious way to appear to comply, refused.
 *
 * A collapsed `details` holding the same paragraphs would satisfy every assertion
 * about what is visible while changing nothing, and the card rules it out by name.
 */
test('rejects a disclosure still holding a run\u2019s standing', () => {
  const verdict = checkInterruptedRunKeepsItsWork({
    ...INTERRUPTION_AS_IT_SHOULD_BE,
    standingDisclosuresInTheWindow: 1,
  });
  assert.match(String(verdict.failure), /not a removal/);
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

/**
 * The invariant the empty account used to protect, restated for the new truth.
 *
 * It was never "there is a paragraph", it was "the entry is not silent about its own
 * run". At a stop the person asked for, the marking is what says it — so an empty
 * account is only a fault when there is no marking either, or when the window is not
 * even showing the run as stopped.
 */
test('rejects an interrupted run left with neither an account nor a marking', () => {
  assert.match(
    String(
      checkInterruptedRunKeepsItsWork({
        ...INTERRUPTION_AS_IT_SHOULD_BE,
        accountShownInWindow: '   ',
        badgeShownInWindow: '  ',
      }).failure,
    ),
    /neither an account.*nor a marking/s,
  );
  // A marking with no account passes, which is the whole of DSP-90 #2.
  assert.equal(
    checkInterruptedRunKeepsItsWork({
      ...INTERRUPTION_AS_IT_SHOULD_BE,
      accountShownInWindow: '   ',
    }).failure,
    null,
  );
});

// --- DSP-71 and DSP-73: the folders, the tree and the inert selection -------
//
// The counter-examples are the point. "Expanding a directory reads that directory
// only" is a gate that has to be able to fail, and the way it fails is a name from
// two levels down appearing after one expansion — which is exactly what a tree that
// read the subtree in advance would produce, and is indistinguishable from correct
// until someone opens a folder with `node_modules` in it.

const TREE_AS_IT_SHOULD_BE: FolderTreeObservation = {
  rootsShown: ['C:/work/project', 'C:/work/project-second'],
  namesUnderRoot: ['deep', 'many', 'picture.bin', 'readme.txt'],
  namesOnlyDeeper: ['nested', 'leaf.txt'],
  cappedNoteShown: 'Showing 500 of 1200 entries. 700 more are in this folder and not drawn.',
  cappedRowsDrawn: 500,
  cappedEntriesOnDisk: 1200,
  cappedExpansionMs: 90,
  textFileShown: 'MARKER-readable-text\nand a second line\n',
  textFileMarker: 'MARKER-readable-text',
  binaryRefusalShown: 'This looks like a binary file, so it was not opened as text.',
};

test('accepts a tree that read one directory, capped a large one and read a file', () => {
  assert.equal(checkFolderTree(TREE_AS_IT_SHOULD_BE).failure, null);
});

test('rejects a tree that pulled in a name from deeper than the directory expanded', () => {
  const verdict = checkFolderTree({
    ...TREE_AS_IT_SHOULD_BE,
    namesUnderRoot: [...TREE_AS_IT_SHOULD_BE.namesUnderRoot, 'leaf.txt'],
  });
  assert.match(String(verdict.failure), /read more than the directory it was asked for/);
});

test('rejects a large folder drawn in full', () => {
  const verdict = checkFolderTree({
    ...TREE_AS_IT_SHOULD_BE,
    cappedRowsDrawn: 1200,
  });
  assert.match(String(verdict.failure), /the cap did not apply/);
});

test('rejects a cap applied without saying how much is not shown', () => {
  const verdict = checkFolderTree({
    ...TREE_AS_IT_SHOULD_BE,
    cappedNoteShown: 'This folder is large.',
  });
  assert.match(String(verdict.failure), /counted out loud/);
});

test('rejects a reading view that did not show the file it opened', () => {
  const verdict = checkFolderTree({ ...TREE_AS_IT_SHOULD_BE, textFileShown: '' });
  assert.match(String(verdict.failure), /was not the file/);
});

test('rejects a binary file opened in silence', () => {
  const verdict = checkFolderTree({ ...TREE_AS_IT_SHOULD_BE, binaryRefusalShown: '  ' });
  assert.match(String(verdict.failure), /said nothing/);
});

test('rejects a window that drew one root when a workspace has several', () => {
  const verdict = checkFolderTree({ ...TREE_AS_IT_SHOULD_BE, rootsShown: ['C:/work/project'] });
  assert.match(String(verdict.failure), /root\(s\)/);
});

const SELECTION_AS_IT_SHOULD_BE: InertSelectionObservation = {
  definitionBefore: 'C:/work/project/.dspatch/loops/mine.loop.json',
  definitionAfter: 'C:/work/project/.dspatch/loops/mine.loop.json',
  workingRootBefore: 'C:/work/project',
  workingRootAfter: 'C:/work/project',
  foldersBefore: ['C:/work/project', 'C:/work/project-second'],
  foldersAfter: ['C:/work/project', 'C:/work/project-second'],
  fileSelected: 'C:/work/project-second/readme.txt',
};

test('accepts a selection that moved nothing', () => {
  assert.equal(checkSelectionIsInert(SELECTION_AS_IT_SHOULD_BE).failure, null);
});

test('rejects a selection that moved the working copy', () => {
  const verdict = checkSelectionIsInert({
    ...SELECTION_AS_IT_SHOULD_BE,
    workingRootAfter: 'C:/work/project-second',
  });
  assert.match(String(verdict.failure), /a way of looking, not a way of steering/);
});

test('rejects a selection that changed the chosen loop', () => {
  const verdict = checkSelectionIsInert({
    ...SELECTION_AS_IT_SHOULD_BE,
    definitionAfter: 'C:/work/project-second/.dspatch/loops/other.loop.json',
  });
  assert.match(String(verdict.failure), /changed the chosen loop definition/);
});

test('rejects a selection that changed the open folders', () => {
  const verdict = checkSelectionIsInert({
    ...SELECTION_AS_IT_SHOULD_BE,
    foldersAfter: ['C:/work/project'],
  });
  assert.match(String(verdict.failure), /changed the open folders/);
});

const REOPEN_AS_IT_SHOULD_BE: ReopenedWorkspaceObservation = {
  foldersAtStart: ['C:/one', 'C:/two', 'C:/three'],
  foldersSaved: ['C:/one', 'C:/two', 'C:/three'],
  definitionAtStart: 'C:/one/.dspatch/loops/mine.loop.json',
  definitionSaved: 'C:/one/.dspatch/loops/mine.loop.json',
  savedFileText: JSON.stringify({
    format: 'dspatch-workspace',
    formatVersion: 1,
    folders: [{ path: 'C:/one' }, { path: 'C:/two' }, { path: 'C:/three' }],
    loopDefinition: 'C:/one/.dspatch/loops/mine.loop.json',
  }),
};

test('accepts a workspace that came back with its folders and its loop', () => {
  assert.equal(checkWorkspaceReopened(REOPEN_AS_IT_SHOULD_BE).failure, null);
});

test('rejects a workspace that came back one folder short', () => {
  const verdict = checkWorkspaceReopened({
    ...REOPEN_AS_IT_SHOULD_BE,
    foldersAtStart: ['C:/one', 'C:/two'],
  });
  assert.match(String(verdict.failure), /came back without C:\/three/);
});

test('rejects a workspace that came back with a different loop', () => {
  const verdict = checkWorkspaceReopened({
    ...REOPEN_AS_IT_SHOULD_BE,
    definitionAtStart: 'C:/two/.dspatch/loops/other.loop.json',
  });
  assert.match(String(verdict.failure), /rather than the/);
});

test('rejects a saved workspace carrying a run result', () => {
  const verdict = checkWorkspaceReopened({
    ...REOPEN_AS_IT_SHOULD_BE,
    savedFileText: `${REOPEN_AS_IT_SHOULD_BE.savedFileText.slice(0, -1)},"runId":"dsp-run-1"}`,
  });
  assert.match(String(verdict.failure), /a run result in it would be state nobody asked to keep/);
});

/* ------------------------------------------------------------------------- */
/* DSP-79: the window's own loop filed a result and handed it over            */
/* ------------------------------------------------------------------------- */

/**
 * A run of the shipped chat loop as the record on disk describes it.
 *
 * Shaped from a real record: two agent steps, two sessions, one `result-filed` entry
 * for `work`, and `check`'s prompt carrying `work`'s reply whole.
 */
const WORK_REPLY = 'I read the project. It is a duration formatter.\n\nRESULT: succeeded';

const LOOP_AS_IT_SHOULD_BE: LoopResultObservation = {
  runId: 'dsp-run-7',
  status: 'completed',
  resultsFiled: [{ nodeId: 'work', bytes: 62, digest: 'a1b2c3d4e5f60718' }],
  steps: [
    {
      nodeId: 'work',
      sessionId: 'dsp-session-dsp-run-7--work',
      prompt: 'You are step "work" … Mandate: read this project.',
      text: WORK_REPLY,
    },
    {
      nodeId: 'check',
      sessionId: 'dsp-session-dsp-run-7--check',
      prompt: `You are step "check" … "work" left this result …\n\n${WORK_REPLY}\n`,
      text: 'The assignment was met.\n\nRESULT: met',
    },
  ],
  refusal: '',
};

test('accepts a window run that filed a result and handed it to a second agent', () => {
  assert.equal(checkLoopFiledAndHandedOver(LOOP_AS_IT_SHOULD_BE).failure, null);
});

/**
 * The counter-example this gate exists for.
 *
 * Dropping `resultsDir` from the window's chat-loop handler leaves the run with
 * nowhere to keep results, and since the chat loop declares `consumes` the runner
 * refuses it before it walks. Every unit test in the suite still passes; this is what
 * the record looks like when it happens.
 */
test('rejects a window run that was refused for having nowhere to keep results', () => {
  const verdict = checkLoopFiledAndHandedOver({
    runId: 'dsp-run-8',
    status: 'refused',
    resultsFiled: [],
    steps: [],
    refusal:
      'This graph requires at least one step to leave a result, and this run was given ' +
      'nowhere to file one.',
  });
  assert.match(String(verdict.failure), /refused rather than walked/);
  assert.match(String(verdict.failure), /nowhere to keep results/);
});

test('rejects a window run that walked but filed nothing', () => {
  const verdict = checkLoopFiledAndHandedOver({ ...LOOP_AS_IT_SHOULD_BE, resultsFiled: [] });
  assert.match(String(verdict.failure), /filed no result/);
});

test('rejects a filed result of no bytes, which is a journal entry about nothing', () => {
  const verdict = checkLoopFiledAndHandedOver({
    ...LOOP_AS_IT_SHOULD_BE,
    resultsFiled: [{ nodeId: 'work', bytes: 0, digest: '' }],
  });
  assert.match(String(verdict.failure), /silence this mechanism exists to end/);
});

/** One agent asked two questions is the thing the card exists to stop being true. */
test('rejects two steps that ran in one provider session', () => {
  const [first, second] = LOOP_AS_IT_SHOULD_BE.steps;
  assert.ok(first !== undefined && second !== undefined);
  const verdict = checkLoopFiledAndHandedOver({
    ...LOOP_AS_IT_SHOULD_BE,
    steps: [first, { ...second, sessionId: first.sessionId }],
  });
  assert.match(String(verdict.failure), /one agent asked two questions/);
});

/** A record from before per-node sessions says nothing either way, and must not pass. */
test('rejects a record that does not say which session a step ran in', () => {
  const [first, second] = LOOP_AS_IT_SHOULD_BE.steps;
  assert.ok(first !== undefined && second !== undefined);
  const verdict = checkLoopFiledAndHandedOver({
    ...LOOP_AS_IT_SHOULD_BE,
    steps: [{ ...first, sessionId: '' }, second],
  });
  assert.match(String(verdict.failure), /does not say which provider session/);
});

/**
 * Separate sessions and no handover is the worst of both, and it is the shape a
 * `consumes` that quietly stopped working would take.
 */
test('rejects a second agent started without the first step\u2019s words', () => {
  const [first, second] = LOOP_AS_IT_SHOULD_BE.steps;
  assert.ok(first !== undefined && second !== undefined);
  const verdict = checkLoopFiledAndHandedOver({
    ...LOOP_AS_IT_SHOULD_BE,
    steps: [first, { ...second, prompt: 'You are step "check" … Mandate: read this project.' }],
  });
  assert.match(String(verdict.failure), /told nothing about/);
});

/* ------------------------------------------------------------------------- */
/* DSP-72: several working roots, and the sentence about them                 */
/* ------------------------------------------------------------------------- */

const HONEST_HEADLINE =
  '2 working folders. Not a boundary: DSpatch reports what changed inside these folders ' +
  'and cannot stop an agent leaving them.';

const HONEST_DETAIL =
  'target is the working directory. Not a boundary: DSpatch reports what changed inside ' +
  'these folders and cannot stop an agent leaving them. These are the folders this run ' +
  'works with. DSpatch hands them to Cursor as the session\u2019s workspace folders, and ' +
  'Cursor\u2019s local agent runs with no filesystem confinement by default.';

const ROOTS_AS_THEY_SHOULD_BE: WorkingRootsObservation = {
  rootsGiven: ['C:/work/target', 'C:/work/source'],
  workingRoot: 'C:/work/target',
  noteFromMain: { headline: HONEST_HEADLINE, detail: HONEST_DETAIL },
  noteOnScreen: { headline: HONEST_HEADLINE, detail: HONEST_DETAIL },
  detailClosedAtFirst: true,
  detailOpensOnClick: true,
  definitionChosen: 'C:/elsewhere/.dspatch/loops/mine.loop.json',
  graphMarkerOnScreen: 'MARKER-outside-loop',
  graphMarkerExpected: 'MARKER-outside-loop',
  refusalForOwnRepository:
    'The working folder "DSpatch" cannot be worked in by a run, so nothing was started. ' +
    'C:/dev/DSpatch',
  ownRepository: 'C:/dev/DSpatch',
};

test('accepts two roots, a definition from elsewhere and a note that claims nothing', () => {
  assert.equal(checkWorkingRootsReadHonestly(ROOTS_AS_THEY_SHOULD_BE).failure, null);
});

test('rejects a single root, because two folders were never set up', () => {
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    rootsGiven: ['C:/work/target'],
  });
  assert.match(String(verdict.failure), /was never set up/);
});

test('rejects a definition that lives inside one of the working folders', () => {
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    definitionChosen: 'C:/work/target/.dspatch/loops/mine.loop.json',
  });
  assert.match(String(verdict.failure), /a definition from a third place/);
});

test('rejects a graph on screen that is not the chosen definition\u2019s own', () => {
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    graphMarkerOnScreen: 'MARKER-something-else',
  });
  assert.match(String(verdict.failure), /is not the one that reached the screen/);
});

/**
 * The counter-example this gate exists for.
 *
 * A note that reads as a boundary is the defect DSP-72 can ship while every other
 * criterion passes, so the gate has to fail on wording alone with everything else in
 * place.
 */
test('rejects a note that says the agent is limited to the folders', () => {
  const claiming = `${HONEST_DETAIL} The agent is limited to these folders.`;
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    noteFromMain: { headline: HONEST_HEADLINE, detail: claiming },
    noteOnScreen: { headline: HONEST_HEADLINE, detail: claiming },
  });
  assert.match(String(verdict.failure), /reads as a restriction/);
});

/**
 * DSP-64's shape applied badly, which is the regression this pair of tests exists for.
 *
 * Everything else about the observation is correct — the folders, the definition, the
 * refusal, and a full paragraph behind the disclosure that says all the right things.
 * The only fault is that the line most people will actually read is the comfortable
 * half. The gate has to fail on that alone.
 */
test('rejects a headline that leaves "not a boundary" to whoever clicks', () => {
  const comfortable = '2 working folders, with target as the working directory.';
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    noteFromMain: { headline: comfortable, detail: HONEST_DETAIL },
    noteOnScreen: { headline: comfortable, detail: HONEST_DETAIL },
  });
  assert.match(String(verdict.failure), /must not come away believing they are one/);
});

test('rejects a headline that has grown back into a paragraph', () => {
  const grown = `${HONEST_HEADLINE} ${HONEST_DETAIL} ${HONEST_DETAIL}`;
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    noteFromMain: { headline: grown, detail: HONEST_DETAIL },
    noteOnScreen: { headline: grown, detail: HONEST_DETAIL },
  });
  assert.match(String(verdict.failure), /the detail is where length belongs/);
  assert.match(String(verdict.failure), /761 characters/);
});

test('rejects a detail that was already open, unasked', () => {
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    detailClosedAtFirst: false,
  });
  assert.match(String(verdict.failure), /drawing the whole paragraph unasked/);
});

test('rejects a detail that cannot be opened, because unreachable is removed', () => {
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    detailOpensOnClick: false,
  });
  assert.match(String(verdict.failure), /unreachable is the same as removed/);
});

test('rejects a window that describes the folders differently from the main process', () => {
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    noteOnScreen: {
      headline: HONEST_HEADLINE,
      detail: `${HONEST_DETAIL} And something the main process never said.`,
    },
  });
  assert.match(String(verdict.failure), /second description/);
});

test('rejects a run that was not refused with DSpatch among its roots', () => {
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    refusalForOwnRepository: '',
  });
  assert.match(String(verdict.failure), /not confined to the folders it is given/);
});

test('rejects a refusal that names no folder', () => {
  const verdict = checkWorkingRootsReadHonestly({
    ...ROOTS_AS_THEY_SHOULD_BE,
    refusalForOwnRepository: 'This workspace contains DSpatch, so nothing was started.',
  });
  assert.match(String(verdict.failure), /does not name C:\/dev\/DSpatch/);
});

// --- Never silent while answering (DSP-87) ----------------------------------

/**
 * A stream, sampled: the reply grows and the window says nothing about silence.
 *
 * Each sample is one instant, both halves read together, because that is the only
 * shape in which the fault is visible. Niclas's window drew a reply and the words
 * *281 s with nothing back* at the same time, and either half on its own is a
 * reasonable thing for a window to show.
 */
const STREAM_AS_IT_SHOULD_BE: readonly StreamingSilenceSample[] = [
  { atMs: 0, replyCharsShown: 0, toolCallsShown: 0, silenceSentencesShown: [] },
  { atMs: 400, replyCharsShown: 38, toolCallsShown: 0, silenceSentencesShown: [] },
  { atMs: 800, replyCharsShown: 122, toolCallsShown: 1, silenceSentencesShown: [] },
  { atMs: 1_200, replyCharsShown: 240, toolCallsShown: 1, silenceSentencesShown: [] },
];

test('accepts a stream the window never described as silence', () => {
  assert.equal(checkNeverSilentWhileAnswering(STREAM_AS_IT_SHOULD_BE).failure, null);
});

test('rejects the defect itself: a growing reply and a claim of nothing back', () => {
  const verdict = checkNeverSilentWhileAnswering(
    STREAM_AS_IT_SHOULD_BE.map((sample, at) =>
      at === 3
        ? { ...sample, silenceSentencesShown: ['281 s with nothing back'] }
        : sample,
    ),
  );
  assert.match(String(verdict.failure), /281 s with nothing back/);
  assert.match(String(verdict.failure), /while it is receiving it/);
});

test('rejects a tool call arriving under a claim that nothing has', () => {
  // Text is not the only activity, and a step running a command for four minutes
  // writes no reply at all. Growth in either half is activity arriving.
  const verdict = checkNeverSilentWhileAnswering([
    { atMs: 0, replyCharsShown: 0, toolCallsShown: 0, silenceSentencesShown: [] },
    { atMs: 500, replyCharsShown: 0, toolCallsShown: 1, silenceSentencesShown: [] },
    {
      atMs: 900,
      replyCharsShown: 0,
      toolCallsShown: 3,
      silenceSentencesShown: ['Waiting for agent activity'],
    },
  ]);
  assert.match(String(verdict.failure), /3 tool call/);
});

test('refuses to pass a trial that never saw a stream', () => {
  // The vacuous pass, which is what a gate written the easy way would give: no
  // sample contradicts the rule when no sample observed anything.
  const verdict = checkNeverSilentWhileAnswering([
    { atMs: 0, replyCharsShown: 0, toolCallsShown: 0, silenceSentencesShown: [] },
    { atMs: 500, replyCharsShown: 0, toolCallsShown: 0, silenceSentencesShown: [] },
  ]);
  assert.match(String(verdict.failure), /fault in the instrument/);
});

test('leaves a genuinely quiet moment alone', () => {
  // The sentence is not forbidden — it is the honest thing to say when nothing has
  // arrived. What is forbidden is saying it over activity. Here it appears before
  // the reply starts, and the samples that follow it are clean.
  const verdict = checkNeverSilentWhileAnswering([
    {
      atMs: 0,
      replyCharsShown: 0,
      toolCallsShown: 0,
      silenceSentencesShown: ['Waiting for agent activity'],
    },
    ...STREAM_AS_IT_SHOULD_BE.slice(1),
  ]);
  assert.equal(verdict.failure, null);
});

// --- The deletions, checked as deletions (DSP-87) ---------------------------

const PROSE_AS_IT_SHOULD_BE: DeletedProseObservation = {
  passagesFoundInDocument: [],
  placeholderShownInWindow: 'Describe the task. Enter sends, Shift+Enter starts a new line.',
  wordsFoundInTheConversation: [],
};

test('accepts a window with none of the four passages in it', () => {
  assert.equal(checkDeletedProseIsGone(PROSE_AS_IT_SHOULD_BE).failure, null);
});

test('rejects a deleted passage that is merely unreachable', () => {
  const verdict = checkDeletedProseIsGone({
    ...PROSE_AS_IT_SHOULD_BE,
    passagesFoundInDocument: ['This wait is longer'],
  });
  assert.match(String(verdict.failure), /This wait is longer/);
});

test('rejects a placeholder that has become a paragraph again', () => {
  const verdict = checkDeletedProseIsGone({
    ...PROSE_AS_IT_SHOULD_BE,
    placeholderShownInWindow:
      'Describe the work. Send runs the chat loop; this text is the entry assignment. ' +
      'Enter sends, Shift+Enter starts a new line.',
  });
  assert.match(String(verdict.failure), /characters/);
});

test('refuses to delete the one fact the placeholder carries', () => {
  // Shortening is not the objective; removing explanation is. What the two keys do
  // cannot be seen by looking at the box, so it is the part that stays.
  const verdict = checkDeletedProseIsGone({
    ...PROSE_AS_IT_SHOULD_BE,
    placeholderShownInWindow: 'Describe the task.',
  });
  assert.match(String(verdict.failure), /what the two keys do/);
});

test('rejects the project\u2019s own vocabulary in the conversation', () => {
  const verdict = checkDeletedProseIsGone({
    ...PROSE_AS_IT_SHOULD_BE,
    wordsFoundInTheConversation: ['mandate', 'walks'],
  });
  assert.match(String(verdict.failure), /mandate/);
  assert.match(String(verdict.failure), /walks/);
});

/* ------------------------------------------------------------------------- */
/* DSP-90: a stop the person asked for, explained by nothing                  */
/* ------------------------------------------------------------------------- */

/**
 * The window as DSP-90 leaves it: a sentence while the stop is unconfirmed, and
 * nothing once it is.
 *
 * The note in the middle reading is taken from what `conversationStanding` writes, so
 * a product that stopped saying it would fail the gate rather than the fixture.
 */
const STOP_AS_IT_SHOULD_BE: StopAsAskedObservation = {
  samples: [
    {
      atMs: 4_100,
      stateShown: 'stop-requested',
      noteShown: STOP_REQUESTED.actionNote ?? '',
      runHasReportedAnEnd: false,
    },
    { atMs: 4_600, stateShown: 'stopped', noteShown: '', runHasReportedAnEnd: true },
  ],
  badgeAfterTheStop: 'stopped short',
  accountAfterTheStop: '',
  noteAfterTheStop: '',
  explanationsFoundAfterTheStop: [],
  standingDisclosuresInTheWindow: 0,
  stopWaitingNoteAfterTheStop: '',
};

test('accepts a stop that was asked for, confirmed, and left at that', () => {
  assert.equal(checkStopSaysNothingExtra(STOP_AS_IT_SHOULD_BE).failure, null);
});

test('rejects the fault itself: the column explaining a confirmed stop', () => {
  const verdict = checkStopSaysNothingExtra({
    ...STOP_AS_IT_SHOULD_BE,
    accountAfterTheStop:
      'You asked this run to stop. Completed steps were not replayed and files were ' +
      'left as they are.',
  });
  assert.match(String(verdict.failure), /still explained it/);
});

test('rejects a paragraph that moved beside the run instead', () => {
  const verdict = checkStopSaysNothingExtra({
    ...STOP_AS_IT_SHOULD_BE,
    noteAfterTheStop: 'Nobody. This run has reported an end.',
  });
  assert.match(String(verdict.failure), /a note still stood beside the run/);
});

test('rejects a recovery rule left beside the composer after the stop', () => {
  const verdict = checkStopSaysNothingExtra({
    ...STOP_AS_IT_SHOULD_BE,
    stopWaitingNoteAfterTheStop:
      'Cancel requested. Completed steps are not replayed; files stay as they are.',
  });
  assert.match(String(verdict.failure), /still beside the composer/);
});

test('rejects a deleted explanation found anywhere in the document', () => {
  const verdict = checkStopSaysNothingExtra({
    ...STOP_AS_IT_SHOULD_BE,
    explanationsFoundAfterTheStop: ['Where this run stands, and what it left behind'],
  });
  assert.match(String(verdict.failure), /Where this run stands/);
});

test('rejects a disclosure holding the removed prose after a stop', () => {
  const verdict = checkStopSaysNothingExtra({
    ...STOP_AS_IT_SHOULD_BE,
    standingDisclosuresInTheWindow: 1,
  });
  assert.match(String(verdict.failure), /collapsed summary/);
});

/**
 * The negative control, and the one that matters most on this card.
 *
 * Everything above is satisfied by a window that says nothing ever, which would have
 * thrown away §4.5's one honest sentence along with the noise. A stop that was never
 * shown as unconfirmed has to fail.
 */
test('refuses a window that never said the stop was unconfirmed', () => {
  const verdict = checkStopSaysNothingExtra({
    ...STOP_AS_IT_SHOULD_BE,
    samples: [
      { atMs: 4_100, stateShown: 'active', noteShown: '', runHasReportedAnEnd: false },
      { atMs: 4_600, stateShown: 'stopped', noteShown: '', runHasReportedAnEnd: true },
    ],
  });
  assert.match(String(verdict.failure), /asking is not stopping/);
});

test('refuses a trial that took no readings, or never saw the run end', () => {
  assert.match(
    String(checkStopSaysNothingExtra({ ...STOP_AS_IT_SHOULD_BE, samples: [] }).failure),
    /fault in the instrument/,
  );
  assert.match(
    String(
      checkStopSaysNothingExtra({
        ...STOP_AS_IT_SHOULD_BE,
        samples: [
          {
            atMs: 4_100,
            stateShown: 'stop-requested',
            noteShown: STOP_REQUESTED.actionNote ?? '',
            runHasReportedAnEnd: false,
          },
        ],
      }).failure,
    ),
    /never reported an end/,
  );
});

test('rejects a stop left with no marking at all', () => {
  // The marking is what is left when the paragraph goes, so removing both is the one
  // way this card could be taken too far.
  const verdict = checkStopSaysNothingExtra({
    ...STOP_AS_IT_SHOULD_BE,
    badgeAfterTheStop: '   ',
  });
  assert.match(String(verdict.failure), /no marking on the run/);
});

test('lets a record that could not be written speak after the stop', () => {
  const verdict = checkStopSaysNothingExtra({
    ...STOP_AS_IT_SHOULD_BE,
    noteAfterTheStop:
      'This run was not fully kept on disk: the file could not be written. What is on ' +
      'screen is all there will be after a restart.',
  });
  assert.equal(verdict.failure, null);
});

/* ------------------------------------------------------------------------- */
/* DSP-80, second pass: the pulse's range and a frame worth sampling          */
/* ------------------------------------------------------------------------- */

/**
 * The pulse as the window measured it after the range was widened.
 *
 * Real numbers from the trial rather than invented ones, so that a change to the stylesheet
 * that quietly narrowed the range again would be caught by the first assertion below.
 */
const PULSE_AS_MEASURED = {
  label: 'ready',
  haloTrough: 0.04,
  haloPeak: 0.78,
  bodyTrough: 0.82,
  bodyPeak: 1,
  haloDurationMs: 3200,
  bodyDurationMs: 3200,
  labelClearanceUnits: 4.17,
} as const;

test('accepts a pulse whose ring swings more than twice as far as it used to', () => {
  assert.equal(checkPulseCarriesFurther(PULSE_AS_MEASURED).failure, null);
});

test('refuses the range it had when Niclas called it barely noticeable', () => {
  const verdict = checkPulseCarriesFurther({
    ...PULSE_AS_MEASURED,
    haloTrough: 0.08,
    haloPeak: 0.4,
  });
  assert.match(String(verdict.failure), /barely noticeable/);
});

/**
 * A wider range paid for with a slower breath is the way to satisfy one instruction and
 * break the other, so it is the one this gate has to refuse while the numbers all improve.
 */
test('refuses a wider range bought by changing the rhythm', () => {
  const verdict = checkPulseCarriesFurther({ ...PULSE_AS_MEASURED, haloDurationMs: 5000 });
  assert.match(String(verdict.failure), /5000 ms/);
  assert.match(String(verdict.failure), /rhythm/);
});

test('refuses a ring whose stroke reaches the node\u2019s words', () => {
  const verdict = checkPulseCarriesFurther({
    ...PULSE_AS_MEASURED,
    labelClearanceUnits: -0.5,
  });
  assert.match(String(verdict.failure), /readability/);
});

/** A frame of the frozen glint as the trial reported it for the corner reading. */
const FRAME_AS_MEASURED = {
  label: 'corner',
  leadAt: 38.25,
  turnAcrossSpanDeg: -90,
  screenPixelsPerUnit: 6.939,
  samples: 134,
  samplesOffTheCanvas: 0,
  acrossACorner: true,
} as const;

test('accepts a corner frame that really turns a corner, on screen, at a legible size', () => {
  assert.equal(checkGlintFrameIsWorthReading(FRAME_AS_MEASURED).failure, null);
});

/**
 * The failure that actually happened, and it is why the gate exists.
 *
 * The node sat in a corner of the canvas behind the inspector panel, so the line of samples
 * left the drawing area after two units. The profile that came back was two bright samples
 * and thirteen units of dark, which reads exactly like a glint that is far too short.
 */
test('refuses a frame whose samples left the drawing area', () => {
  const verdict = checkGlintFrameIsWorthReading({
    ...FRAME_AS_MEASURED,
    samplesOffTheCanvas: 91,
  });
  assert.match(String(verdict.failure), /outside the drawing area/);
});

test('refuses a corner reading taken on a straight side', () => {
  const verdict = checkGlintFrameIsWorthReading({
    ...FRAME_AS_MEASURED,
    turnAcrossSpanDeg: 0,
  });
  assert.match(String(verdict.failure), /says nothing about what happens at a corner/);
});

test('refuses a straight reading that crossed a corner after all', () => {
  const verdict = checkGlintFrameIsWorthReading({
    ...FRAME_AS_MEASURED,
    label: 'straight',
    acrossACorner: false,
  });
  assert.match(String(verdict.failure), /not the comparison they are reported as/);
});

/**
 * Below about two pixels per hundredth of the outline the gradient's finest pieces are
 * smaller than a pixel, and a profile read there is a reading of the screen.
 */
test('refuses a frame sampled too small to tell light from resolution', () => {
  const verdict = checkGlintFrameIsWorthReading({
    ...FRAME_AS_MEASURED,
    screenPixelsPerUnit: 1.1,
  });
  assert.match(String(verdict.failure), /reading of the screen/);
});
