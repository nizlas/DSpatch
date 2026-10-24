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
  RECAP_REMOVED_NOTE,
  SIMULATION_NOTICE,
  continuityView,
  earlierSendLine,
  providerSessionFact,
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
      [
        'Try again to resume this session',
        'Start a new provider session',
        'Keep reading without starting an agent',
      ],
    );
    for (const choice of view.choices) {
      assert.notEqual(choice.note.trim(), '');
    }
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
