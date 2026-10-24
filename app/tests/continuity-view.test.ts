/**
 * What the window shows while no provider session is open (DSP-121), as a rule.
 *
 * The three non-open kinds must each show the main process's statement, the
 * choices it listed and nothing more; "keep reading" must remove the choices and
 * nothing else; and a removed recap must stay removed. The component draws what
 * `continuityView` returns, so this is where those claims are checked. No React,
 * no provider.
 *
 *     node --test tests/continuity-view.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionContinuity, SessionContinuityKind } from '../src/shared/bridge';
import {
  CONTINUITY_HEADING,
  EARLIER_SENDS_NOTE,
  NEW_SESSION_NOTE,
  NO_SESSION_STATUS,
  RECAP_REMOVED_NOTE,
  RUNNING_COMMAND_NOTE,
  SIMULATION_LABEL,
  SIMULATION_NOTICE,
  composerStatus,
  continuityBody,
  continuityView,
  earlierSendLine,
  providerSessionFact,
  runningCommandNote,
  simulationLabel,
  simulationNotice,
} from '../src/renderer/continuity-view';

const ALL_CHOICES = ['try-again', 'new-session', 'keep-reading'] as const;

/** A continuity of one of the non-open kinds, as `ChatService` builds it. */
function notOpen(kind: SessionContinuityKind, detail: string): SessionContinuity {
  return {
    kind,
    providerSessionOpen: false,
    attemptedDspatchSessionId: 'dsp-session-1',
    resumedProviderSessionId: null,
    resumeError: detail,
    resumeFailure: { kind: 'error', detail, providerCode: null },
    earlierSendsMayHaveReached: [],
    choices: ALL_CHOICES,
    contextToResend: null,
    contextNote: 'Nothing was resent and nothing will be: no provider session is open.',
    savedMessageCount: 2,
    statement: `Statement for ${kind}. No new session was opened and nothing was sent.`,
  };
}

const NOT_ON_SCREEN = { sentAnything: false, recapDiscarded: false, choicesDismissed: false };

for (const kind of ['resume-refused', 'resume-failed', 'resume-unavailable'] as const) {
  test(`${kind}: the statement, the technical detail and all three choices are shown`, () => {
    const view = continuityView(notOpen(kind, 'the adapter said why'), NOT_ON_SCREEN);
    assert.equal(view.providerSessionOpen, false);
    assert.equal(view.statement, `Statement for ${kind}. No new session was opened and nothing was sent.`);
    assert.equal(view.technicalDetail, 'the adapter said why');
    assert.deepEqual(
      view.choices.map((choice) => choice.testId),
      ['continuity-choice-try-again', 'continuity-choice-new-session', 'continuity-choice-keep-reading'],
    );
    assert.deepEqual(
      view.choices.map((choice) => choice.label),
      ['Try again', 'Start new session', 'Read history'],
    );
    for (const choice of view.choices) {
      assert.notEqual(choice.note.trim(), '');
    }
    assert.equal(view.heading, CONTINUITY_HEADING);
    assert.equal(view.drawerLine, CONTINUITY_HEADING, 'the drawer line is the heading, not the statement');
    assert.notEqual(view.body, null);
    assert.equal(view.earlierSendsNote, null, 'no earlier-sends note without earlier sends');
    assert.equal(view.recap, null, 'no recap is shown while nothing is open');
    assert.equal(view.recapRemovedNote, null);
  });
}

test('the choices are the ones the main process listed, in its order, and no others', () => {
  const view = continuityView(
    { ...notOpen('resume-refused', 'x'), choices: ['keep-reading', 'try-again'] },
    NOT_ON_SCREEN,
  );
  assert.deepEqual(
    view.choices.map((choice) => choice.choice),
    ['keep-reading', 'try-again'],
  );
});

test('keep reading removes the choices and leaves the statement and the detail', () => {
  const view = continuityView(notOpen('resume-failed', 'TypeError: fetch failed'), {
    ...NOT_ON_SCREEN,
    choicesDismissed: true,
  });
  assert.deepEqual(view.choices, []);
  assert.match(String(view.statement), /Statement for resume-failed/);
  assert.equal(view.technicalDetail, 'TypeError: fetch failed');
});

test('earlier messages with no confirmed end are listed with their attempt, state and acknowledgement', () => {
  const continuity: SessionContinuity = {
    ...notOpen('resume-refused', 'x'),
    earlierSendsMayHaveReached: [
      { attemptId: 'dsp-attempt-0003', label: 'a job left going', state: 'outcome-unknown', acknowledged: false },
      { attemptId: 'dsp-attempt-0004', label: 'another', state: 'cancel-requested', acknowledged: true },
    ],
  };
  const view = continuityView(continuity, NOT_ON_SCREEN);
  assert.deepEqual(view.earlierSends, [
    '"a job left going" (dsp-attempt-0003, outcome-unknown)',
    '"another" (dsp-attempt-0004, cancel-requested, acknowledged)',
  ]);
  assert.equal(
    earlierSendLine({ attemptId: 'a', label: 'b', state: 'waiting', acknowledged: false }),
    '"b" (a, waiting)',
  );
});

test('an open session shows no choices and no detail, whatever the kind', () => {
  const resumed: SessionContinuity = {
    kind: 'provider-session-resumed',
    providerSessionOpen: true,
    attemptedDspatchSessionId: 'dsp-session-1',
    resumedProviderSessionId: 'agent-1',
    resumeError: null,
    resumeFailure: null,
    earlierSendsMayHaveReached: [],
    choices: [],
    contextToResend: null,
    contextNote: 'nothing resent',
    savedMessageCount: 2,
    statement: 'The provider session dsp-session-1 was resumed.',
  };
  const view = continuityView(resumed, NOT_ON_SCREEN);
  assert.equal(view.providerSessionOpen, true);
  assert.deepEqual(view.choices, []);
  assert.equal(view.technicalDetail, null);
  assert.equal(view.recap, null);
  const first = continuityView({ ...resumed, kind: 'first-session', statement: 'ignored' }, NOT_ON_SCREEN);
  assert.equal(first.statement, null, 'a first session has nothing to say');
});

test('a new provider session shows its recap until it is sent or removed', () => {
  const fresh: SessionContinuity = {
    kind: 'new-provider-session',
    providerSessionOpen: true,
    attemptedDspatchSessionId: 'dsp-session-1',
    resumedProviderSessionId: null,
    resumeError: null,
    resumeFailure: null,
    earlierSendsMayHaveReached: [],
    choices: [],
    contextToResend: 'RECAP TEXT',
    contextNote: 'what the recap covers',
    savedMessageCount: 2,
    statement: 'This is a new provider session, opened because you asked for one.',
  };
  const shown = continuityView(fresh, NOT_ON_SCREEN);
  assert.deepEqual(shown.recap, { text: 'RECAP TEXT', note: 'what the recap covers' });
  assert.equal(shown.recapRemovedNote, null);
  assert.deepEqual(shown.choices, []);

  // After the send the recap is no longer pending; nothing claims it was removed.
  const sent = continuityView(fresh, { ...NOT_ON_SCREEN, sentAnything: true });
  assert.equal(sent.recap, null);
  assert.equal(sent.recapRemovedNote, null);

  // After `discardPendingRecap` the main process answers with `contextToResend`
  // null, and the window says so in place of the recap.
  const removed = continuityView(
    { ...fresh, contextToResend: null, contextNote: 'The recap was removed at your request.' },
    { ...NOT_ON_SCREEN, recapDiscarded: true },
  );
  assert.equal(removed.recap, null);
  assert.equal(removed.recapRemovedNote, RECAP_REMOVED_NOTE);
  assert.equal(RECAP_REMOVED_NOTE, 'The recap was removed; only your message will be sent.');

  // The window's flag alone does not hide a recap the main process still holds:
  // what is shown is what would be sent.
  const stillHeld = continuityView(fresh, { ...NOT_ON_SCREEN, recapDiscarded: true });
  assert.equal(stillHeld.recap, null, 'the window does not show a recap it asked to remove');
  assert.equal(stillHeld.recapRemovedNote, null, 'but it does not claim the removal until the main process confirms it');
});

test('the provider session fact says when the session is on record but not open', () => {
  assert.equal(providerSessionFact('agent-1', true), 'agent-1');
  assert.equal(providerSessionFact('agent-1', false), 'agent-1 (on record, not open)');
});

test('DSP-121 SIMULATED: the simulation line appears only for a scripted plan that asked for a simulated resume', () => {
  assert.equal(
    SIMULATION_NOTICE,
    'Presentation mode: this refusal or failure is simulated by the presentation adapter ' +
      'on this machine; no provider was asked anything.',
  );
  for (const mode of ['refused', 'failed', 'refused-once'] as const) {
    assert.equal(simulationNotice({ resumeMode: mode }), SIMULATION_NOTICE, mode);
  }
  // An ordinary launch has no plan; a plan that asked for no simulation gets nothing.
  assert.equal(simulationNotice(null), null);
  assert.equal(simulationNotice(undefined), null);
  assert.equal(simulationNotice({}), null);
  assert.equal(simulationNotice({ resumeMode: 'ok' }), null);
});

// --- DSP-121 UX (Niclas, 24 October 2026): short in the open, complete behind -----

test('the body is keyed on what the failure established, and never says missing unless the provider said so', () => {
  const body = (
    kind: SessionContinuityKind,
    failure: SessionContinuity['resumeFailure'],
  ): string => String(continuityBody({ kind, providerSessionOpen: false, resumeFailure: failure }));
  const still = 'Your saved conversation is still available. Try again or start a new agent session.';

  assert.equal(
    body('resume-refused', { kind: 'provider-missing', detail: 'x', providerCode: 'agent_not_found' }),
    `The agent no longer has this session. ${still}`,
  );
  assert.equal(
    body('resume-failed', { kind: 'error', detail: 'TypeError: fetch failed', providerCode: null }),
    `Resuming did not work this time; it may be temporary. ${still}`,
  );
  // A refusal with a plain error is the adapter's own rule, not a transport failure:
  // not called temporary, and still not called missing.
  assert.equal(
    body('resume-refused', { kind: 'error', detail: 'config mismatch', providerCode: 'config_mismatch' }),
    `Resuming did not work this time. ${still}`,
  );
  assert.equal(
    body('resume-refused', { kind: 'unknown', detail: 'x', providerCode: 'local_record_missing_unaligned' }),
    `DSpatch could not tell whether the agent still has this session. ${still}`,
  );
  assert.equal(
    body('resume-refused', { kind: 'local-record-missing', detail: 'x', providerCode: 'local_record_missing' }),
    `No local record of this session was found; the agent was not asked. ${still}`,
  );
  assert.equal(
    body('resume-refused', { kind: 'unconfirmed-end', detail: 'x', providerCode: null }),
    `The last message of this conversation has no confirmed end, so the session was not resumed. ${still}`,
  );
  assert.equal(
    body('resume-unavailable', { kind: 'error', detail: 'x', providerCode: null }),
    'This adapter cannot resume sessions. Your saved conversation is still available. ' +
      'Start a new agent session or read the history.',
  );
  // No failure recorded at all while not open: the uncertainty is stated, not a loss.
  assert.match(body('resume-failed', null), /^DSpatch could not tell/);

  for (const failureKind of ['error', 'unknown', 'local-record-missing', 'unconfirmed-end'] as const) {
    for (const kind of ['resume-refused', 'resume-failed'] as const) {
      const text = body(kind, { kind: failureKind, detail: 'x', providerCode: null });
      assert.doesNotMatch(text, /no longer has/, `${kind}/${failureKind} must not claim the session is missing`);
      assert.doesNotMatch(text, /missing/i, `${kind}/${failureKind} must not claim the session is missing`);
    }
  }
  // An open session has no body.
  assert.equal(
    continuityBody({ kind: 'provider-session-resumed', providerSessionOpen: true, resumeFailure: null }),
    null,
  );
});

test('the earlier-sends sentence appears only when an earlier message has no confirmed end', () => {
  const none = continuityView(notOpen('resume-refused', 'x'), NOT_ON_SCREEN);
  assert.equal(none.earlierSendsNote, null);
  const some = continuityView(
    {
      ...notOpen('resume-refused', 'x'),
      earlierSendsMayHaveReached: [
        { attemptId: 'dsp-attempt-0003', label: 'a job left going', state: 'outcome-unknown', acknowledged: false },
      ],
    },
    NOT_ON_SCREEN,
  );
  assert.equal(some.earlierSendsNote, EARLIER_SENDS_NOTE);
  assert.equal(EARLIER_SENDS_NOTE, 'An earlier message may have reached the agent; nothing is resent.');
  assert.equal(some.earlierSends.length, 1, 'the full list is still there for Technical details');
});

test('Technical details has every text the service produced: statement, detail, provider code, session', () => {
  const view = continuityView(
    {
      ...notOpen('resume-refused', 'Presentation adapter: simulated refusal'),
      resumeFailure: {
        kind: 'provider-missing',
        detail: 'Presentation adapter: simulated refusal',
        providerCode: 'agent_not_found',
      },
    },
    NOT_ON_SCREEN,
  );
  assert.equal(view.statement, 'Statement for resume-refused. No new session was opened and nothing was sent.');
  assert.equal(view.technicalDetail, 'Presentation adapter: simulated refusal');
  assert.equal(view.providerCode, 'agent_not_found');
  assert.equal(view.attemptedSessionId, 'dsp-session-1');
  const noCode = continuityView(notOpen('resume-failed', 'TypeError: fetch failed'), NOT_ON_SCREEN);
  assert.equal(noCode.providerCode, null);
});

test('the running-command note is shown only while a workspace command runs', () => {
  assert.equal(runningCommandNote(true), RUNNING_COMMAND_NOTE);
  assert.equal(RUNNING_COMMAND_NOTE, 'A running command is stopped by Try again or Start new session.');
  assert.equal(runningCommandNote(false), null);
});

test('DSP-121 SIMULATED: the short test-mode label stands in the open, the full sentence behind it', () => {
  assert.equal(SIMULATION_LABEL, 'Test mode — no provider calls');
  for (const mode of ['refused', 'failed', 'refused-once'] as const) {
    assert.equal(simulationLabel({ resumeMode: mode }), SIMULATION_LABEL, mode);
    assert.equal(simulationNotice({ resumeMode: mode }), SIMULATION_NOTICE, mode);
  }
  assert.equal(simulationLabel(null), null);
  assert.equal(simulationLabel({ resumeMode: 'ok' }), null);
});

test('the composer status says there is no agent session rather than waiting for a message', () => {
  assert.equal(NO_SESSION_STATUS, 'No agent session — history only');
  assert.equal(composerStatus({ providerSessionOpen: false }, 'Waiting for your message.', false), NO_SESSION_STATUS);
  assert.equal(composerStatus({ providerSessionOpen: true }, 'Waiting for your message.', false), 'Waiting for your message.');
  assert.equal(composerStatus(null, 'No project open, so nothing is running.', false), 'No project open, so nothing is running.');
  // A loop run has sessions of its own; its line wins while it runs.
  assert.equal(composerStatus({ providerSessionOpen: false }, 'Step 2 of 4', true), 'Step 2 of 4');
});

test('the drawer line is the heading while not open, the short note for a new session, the statement when resumed', () => {
  const base = { ...notOpen('resume-refused', 'x') };
  assert.equal(continuityView(base, NOT_ON_SCREEN).drawerLine, CONTINUITY_HEADING);
  const fresh: SessionContinuity = {
    ...base,
    kind: 'new-provider-session',
    providerSessionOpen: true,
    resumeFailure: null,
    choices: [],
    contextToResend: 'RECAP',
    statement: 'This is a new provider session, opened because you asked for one. (long)',
  };
  const freshView = continuityView(fresh, NOT_ON_SCREEN);
  assert.equal(freshView.drawerLine, NEW_SESSION_NOTE);
  assert.equal(
    NEW_SESSION_NOTE,
    "The agent's earlier context does not follow automatically. DSpatch will send this summary first; you can remove it.",
  );
  assert.equal(freshView.statement, fresh.statement, 'the long statement is kept for Technical details');
  assert.equal(freshView.heading, null);
  assert.equal(freshView.body, null);
  const resumed = continuityView(
    { ...fresh, kind: 'provider-session-resumed', contextToResend: null, statement: 'Session x was resumed.' },
    NOT_ON_SCREEN,
  );
  assert.equal(resumed.drawerLine, 'Session x was resumed.');
  assert.equal(continuityView({ ...fresh, kind: 'first-session', contextToResend: null }, NOT_ON_SCREEN).drawerLine, null);
});
