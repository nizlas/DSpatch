/**
 * Failure wording, long waits and bounded retries.
 *
 * The first test is a regression test for a defect report 003 measured in the live
 * window: the refusal to open DSpatch's own repository arrived as
 * `Error invoking remote method 'dspatch:start-session': Error: Refusing to open …`
 * and the real sentence was buried behind the transport's own words.
 *
 *     node --test tests/recovery.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeContainingRefusal,
  ownRepositoryInside,
} from '../src/main/own-repository.ts';
import {
  CONNECTION_RETRY_DELAYS_MS,
  connectionRecheckNote,
  connectionRetryPlan,
  describeBridgeFailure,
  describeReconciledRepeat,
  describeSavedConversationUnresolved,
  describeSendWait,
  failureHasResolved,
  restoreComposerAfterRunFailure,
  runEndingNeedsConnectionRecheck,
  SEND_WAIT_NOTICE_MS,
} from '../src/renderer/recovery.ts';

// --- The message a person reads ---------------------------------------------

test('the IPC wrapper is removed and the real message survives whole', () => {
  // Verbatim from report 003, including its two stacked `Error:` prefixes.
  const observed = new Error(
    "Error invoking remote method 'dspatch:start-session': Error: Refusing to open " +
      "C:\\Users\\nicla\\development\\DSpatch: this is DSpatch's own working copy. " +
      'DSP-1 measured that the agent is not confined to the folder it is given.',
  );

  const failure = describeBridgeFailure(observed);
  assert.equal(
    failure.message.startsWith('Refusing to open C:\\Users\\nicla\\development\\DSpatch'),
    true,
    failure.message,
  );
  assert.match(failure.message, /not confined to the folder it is given/);
  assert.doesNotMatch(failure.message, /invoking remote method/);
  assert.doesNotMatch(failure.message, /^Error/);

  // Nothing is hidden: the channel and the original text are both kept.
  assert.equal(failure.channel, 'dspatch:start-session');
  assert.match(failure.raw, /invoking remote method/);

  // And the refusal is offered the action that fits it.
  assert.equal(failure.kind, 'refused-folder');
  assert.equal(failure.action, 'choose-another-folder');
});

test('the refusal for a folder that contains DSpatch reaches the same handling', () => {
  // The coupling this depends on is a prefix: `classify` recognises a refused
  // folder by `Refusing to open` and nothing else. DSP-16 AC#5 added a third
  // refusal, and its real text — produced by the guard itself here rather than
  // paraphrased — has to keep that prefix or the window loses its *choose another
  // folder* button.
  const chosen = 'C:\\Users\\nicla\\development';
  const contained = ownRepositoryInside(chosen, 'C:\\Users\\nicla\\development\\DSpatch');
  assert.equal(contained.kind, 'contains');
  if (contained.kind !== 'contains') {
    return;
  }
  const failure = describeBridgeFailure(
    new Error(
      `Error invoking remote method 'dspatch:start-session': Error: ${describeContainingRefusal(
        chosen,
        contained,
      )}`,
    ),
  );

  assert.equal(failure.kind, 'refused-folder');
  assert.equal(failure.action, 'choose-another-folder');
  assert.match(failure.message, /own working copy is inside it/);
  // The note has to fit this case too. Suggesting a copy of the chosen folder
  // elsewhere would copy DSpatch along with it.
  assert.doesNotMatch(failure.actionNote, /copy of this one somewhere else/);
  assert.match(failure.actionNote, /Nothing was opened and nothing was changed/);
});

test('a message with no wrapper is left exactly as it is', () => {
  const failure = describeBridgeFailure(new Error('There is no folder at C:\\nope.'));
  assert.equal(failure.message, 'There is no folder at C:\\nope.');
  assert.equal(failure.channel, null);
  assert.equal(failure.raw, 'There is no folder at C:\\nope.');
});

test('a non-Error rejection still produces something readable', () => {
  assert.equal(describeBridgeFailure('plain string').message, 'plain string');
  assert.equal(describeBridgeFailure(undefined).message, 'undefined');
});

test('stripping never leaves an empty message', () => {
  // A wrapper with nothing after it: the raw text is better than a blank line.
  const failure = describeBridgeFailure(
    new Error("Error invoking remote method 'dspatch:run-test': Error: "),
  );
  assert.notEqual(failure.message.trim(), '');
  assert.match(failure.message, /dspatch:run-test/);
});

test('each kind of failure is offered the action that applies to it', () => {
  const cases: readonly [string, string, string][] = [
    [
      'dsp-attempt-0001 (message to the agent) is in state "outcome-unknown": no ' +
        'end confirmed. DSpatch will not repeat this by itself while that is ' +
        'unresolved.',
      'needs-acknowledgement',
      'acknowledge-then-repeat',
    ],
    [
      'Session "dsp-session-1" already has an active run (dsp-run-1).',
      'session-holds-a-run',
      'continue-in-new-session',
    ],
    ['No session is open. Start one first.', 'nothing-open', 'open-project-again'],
    [
      'Cursor adapter operation "send" failed: TypeError: fetch failed',
      'connection',
      'reconnect',
    ],
    ['Something nobody has classified yet.', 'other', 'retry'],
  ];
  for (const [message, kind, action] of cases) {
    const failure = describeBridgeFailure(new Error(message));
    assert.equal(failure.kind, kind, message);
    assert.equal(failure.action, action, message);
    assert.notEqual(failure.actionNote.trim(), '');
  }
});

test("Cursor's own wording for a session that holds a run is recognised too", () => {
  // Verbatim from report 008's measurement, which is the point of this test: the
  // rule matched DSpatch's own sentence — "already has **an** active run" — and the
  // provider's sentence has no `an` in it. So the guidance written for exactly this
  // case never fired, and a user who closed DSpatch mid-answer got the provider's
  // raw sentence with a *Try again* button that failed identically. Twice, measured.
  const observed = new Error(
    "Error invoking remote method 'dspatch:send-prompt': Error: Cursor adapter " +
      'operation "send" failed: UnknownAgentError: Agent ' +
      'agent-b8287ca0-1c4d-4f8e-8a1b-3c9d2e5f7a41 already has active run',
  );

  const failure = describeBridgeFailure(observed);
  assert.equal(failure.kind, 'session-holds-a-run');
  // Not `retry`, which is what it fell through to, and not `open-project-again`,
  // which resumes the same session and is refused in the same words.
  assert.equal(failure.action, 'continue-in-new-session');
  assert.match(failure.actionNote, /new provider session/);
  assert.match(failure.actionNote, /nothing on disk is touched/i);
  // The provider's own words are what the reader sees first, unwrapped.
  assert.match(failure.message, /^Cursor adapter operation "send" failed/);
  assert.equal(failure.channel, 'dspatch:send-prompt');
});

test('the held-run note claims no recovery nobody has seen (DSP-6 item 4)', () => {
  // The sentence this replaces: "If that run reports an end first, this block
  // disappears on its own and sending works again with nothing to reopen." Stated
  // as fact, never observed. Niclas killed a turn at about 17:16 on 15 September
  // 2026 and the session still refused every message at 17:27. DSP-6's probe then
  // killed a client's process tree mid-stream and polled `resume` + `send` once a
  // minute: refused 1.5 s after the kill and at all fifteen polls through 900 s,
  // while a new session over the same repository answered on the first try.
  //
  // Both wordings, because both reach this rule and both used to carry the promise.
  for (const message of [
    'Session "dsp-session-1" already has an active run (dsp-run-1).',
    'Cursor adapter operation "send" failed: UnknownAgentError: Agent ' +
      'agent-b8287ca0-1c4d-4f8e-8a1b-3c9d2e5f7a41 already has active run',
  ]) {
    const { actionNote, action } = describeBridgeFailure(new Error(message));
    assert.equal(action, 'continue-in-new-session', message);

    // The promise, in the words it was made in.
    assert.doesNotMatch(actionNote, /disappears on its own/i, message);
    assert.doesNotMatch(actionNote, /on its own/i, message);
    assert.doesNotMatch(actionNote, /works again with nothing to reopen/i, message);

    // What it says instead: the new session is the way out, waiting is not known
    // to work, the measurement is named, and clearing is left unknown.
    assert.match(actionNote, /new provider session is the way out/i, message);
    assert.match(actionNote, /not known\s+to help/i, message);
    assert.match(actionNote, /11 minutes/, message);
    assert.match(actionNote, /15 minutes/, message);
    assert.match(actionNote, /is\s+unknown/i, message);

    // And the measurement is stated about the case it was measured in. Verifier 004
    // read this note beside the main process's explanation for the case where
    // DSpatch holds the run itself and does see it end, so an unscoped "waiting is
    // not known to help" made the window contradict itself in one place.
    assert.match(actionNote, /never subscribed to/i, message);
    assert.match(
      actionNote,
      /the message above says which of the two this is/i,
      message,
    );
  }
});

// --- The confirmation that DSP-6 item 1 removed ------------------------------
//
// Three strings promised something the fix had made untrue. Verifier 004 measured
// two of them live: it opened a conversation whose unknown outcome was already
// acknowledged and sent a message with nothing to confirm, while the row and the
// panel both said a confirmation was required first.

test('a saved conversation whose attempts are all confirmed promises no confirmation', () => {
  const text = describeSavedConversationUnresolved(1, 0);
  // The wording measured as false, in the words it was measured in.
  assert.doesNotMatch(text, /have to confirm before continuing/i);
  assert.doesNotMatch(text, /waits for you to confirm/i);
  // What it says instead.
  assert.match(text, /already confirmed/i);
  assert.match(text, /nothing is asked again/i);
  assert.match(text, /sending works normally/i);
  // The record is unchanged by the confirmation, which is the point of it.
  assert.match(text, /unresolved/i);
  assert.match(text, /Nothing will be repeated/);
});

test('a saved conversation with an unconfirmed attempt still says the message waits', () => {
  // The half that must not be weakened: the first gate after an unknown outcome is
  // the thing that stops a duplicate, and this row is where a user first meets it.
  const one = describeSavedConversationUnresolved(1, 1);
  assert.match(one, /waits for you to confirm/i);
  assert.match(one, /once per attempt, not once per message/i);
  assert.match(one, /Nothing will be repeated/);

  // Two attempts, one of each: the counts are separate, because a sentence that
  // covers both cases with one number is wrong about one of them.
  const mixed = describeSavedConversationUnresolved(3, 1);
  assert.match(mixed, /confirm the 1 you have not confirmed yet/i);
  assert.match(mixed, /the other 2 you already confirmed/i);
});

test('a reconciled attempt already named says the next message does not wait', () => {
  const named = describeReconciledRepeat('agent-turn', false);
  assert.doesNotMatch(named, /needs this named first/i);
  assert.match(named, /named this one already/i);
  assert.match(named, /does not wait for it/i);
  assert.match(named, /stays\s+recorded as unresolved/i);

  // And the unnamed case is unchanged, for both kinds.
  assert.match(describeReconciledRepeat('agent-turn', true), /next message needs this/i);
  assert.match(
    describeReconciledRepeat('command', true),
    /next run of the command needs this/i,
  );
});

test('the run-block rule does not match a sentence that merely mentions a run', () => {
  // The counter-example that keeps the fix from becoming an over-match: `active
  // run` on its own appears in perfectly ordinary text.
  for (const message of [
    'The active run finished 3 s ago.',
    'dsp-attempt-0002 has no active run, so there is nothing to cancel.',
  ]) {
    assert.notEqual(
      describeBridgeFailure(new Error(message)).kind,
      'session-holds-a-run',
      message,
    );
  }
});

test('a refusal is never classified as a connection problem', () => {
  // The classifier looks for connection wording, and a refusal message mentions
  // measurement and containment. Sending someone to check their network because a
  // folder was refused would be worse than saying nothing.
  const failure = describeBridgeFailure(
    new Error(
      "Refusing to open C:\\tmp\\x: this is DSpatch's own working copy. Set " +
        'DSPATCH_ALLOW_OWN_REPO=1 if you mean to do this anyway.',
    ),
  );
  assert.equal(failure.kind, 'refused-folder');
});

// --- Waiting is not failing -------------------------------------------------

test('a wait is never reported as a failure, however long it gets', () => {
  for (const elapsed of [0, 5_000, 11_500, 19_999, 30_000, 60_000, 600_000]) {
    const status = describeSendWait(elapsed, false);
    assert.equal(status.isFailure, false, `${String(elapsed)} ms`);
    assert.equal(status.offerStopWaiting, true, 'there is always a way out');
    assert.notEqual(status.text.trim(), '');
  }
});

test('the measured 11–12 seconds to first text does not put a number on screen', () => {
  assert.doesNotMatch(describeSendWait(11_500, false).text, /\d+ s ago/);
  assert.ok(SEND_WAIT_NOTICE_MS > 12_000, 'the threshold is above what was measured');

  const noticed = describeSendWait(SEND_WAIT_NOTICE_MS, false);
  assert.match(noticed.text, /Sent 20 s ago/);
  assert.match(noticed.text, /nothing has failed/);
});

/**
 * DSP-87 shortened these and removed the second threshold, and the assertion that
 * matters is the one that survived: a wait is never a verdict, at any length.
 *
 * What went was the argument. The line used to cite what earlier runs had measured,
 * that this was *slow rather than wrong*, and that DSpatch could not see whether the
 * provider was working — and then a second paragraph under the composer said the last
 * of those again, longer. A rising number and *nothing has failed* is what a person
 * can act on; the button beside it is what they can do about it.
 */
test('a long wait stays one short line and still claims nothing', () => {
  const long = describeSendWait(300_000, false);
  assert.equal(long.isFailure, false);
  assert.match(long.text, /^Sent 300 s ago\./);
  assert.match(long.text, /nothing has failed/);
  assert.ok(long.text.length < 80, `one line: ${String(long.text.length)} characters`);
  assert.equal(long.text.includes('\n'), false);
});

// --- Retries are bounded ----------------------------------------------------

test('the connection check retries twice and then stops', () => {
  assert.deepEqual(CONNECTION_RETRY_DELAYS_MS, [2_000, 6_000]);

  const first = connectionRetryPlan(0);
  assert.equal(first.retry, true);
  assert.equal(first.delayMs, 2_000);

  const second = connectionRetryPlan(1);
  assert.equal(second.retry, true);
  assert.equal(second.delayMs, 6_000);

  const done = connectionRetryPlan(2);
  assert.equal(done.retry, false);
  assert.equal(done.delayMs, null);
  assert.match(done.note, /stopped retrying/);

  // And it stays stopped: no schedule reappears at a higher count.
  for (const attempts of [3, 4, 10, 100]) {
    assert.equal(connectionRetryPlan(attempts).retry, false);
  }
});

test('every retry note says that only the check is repeated', () => {
  for (const attempts of [0, 1, 2]) {
    assert.match(
      connectionRetryPlan(attempts).note,
      /no message or command is ever retried on its own|Only the check is repeated/,
    );
  }
});

test('the total automatic wait before giving up is bounded and small', () => {
  // 8 seconds. The number matters: it has to be long enough to survive one
  // dropped request and short enough that a real outage stops looking like work.
  const total = CONNECTION_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
  assert.equal(total, 8_000);
});

// --- Two readings of the provider must not disagree (report 005) ------------

test('a run that did not complete is a reason to re-read the connection', () => {
  // Report 005 measured the card reading `connected` for a whole 60-second outage
  // while the attempt beside it read `failed`.
  assert.equal(runEndingNeedsConnectionRecheck('error', 'fetch failed'), true);
  assert.equal(runEndingNeedsConnectionRecheck('error', undefined), true);
  // Deliberately not restricted to messages that look like transport trouble: an
  // unclassifiable failure is exactly when the card's claim is least worth trusting.
  assert.equal(runEndingNeedsConnectionRecheck('error', 'the model refused'), true);
});

test('a completed or confirmed-cancelled run is not', () => {
  // Nothing to re-read: the provider answered. Re-checking on every finished turn
  // would put a round trip on the ordinary path for no information.
  assert.equal(runEndingNeedsConnectionRecheck('finished', undefined), false);
  assert.equal(runEndingNeedsConnectionRecheck('cancelled', undefined), false);
  assert.equal(runEndingNeedsConnectionRecheck(undefined, undefined), false);
});

test('the re-check says why it happened and that nothing was sent', () => {
  const note = connectionRecheckNote('run-failed', 'fetch failed');
  assert.match(note, /re-read/);
  assert.match(note, /Nothing was sent/);
  assert.match(note, /fetch failed/);
  // No detail is not an empty sentence fragment.
  assert.doesNotMatch(connectionRecheckNote('send-failed', null), /What failed:/);
});

// --- A block that has stopped being true (report 005) -----------------------

test('the active-run block clears once nothing of that kind is unresolved', () => {
  const failure = describeBridgeFailure(
    new Error('CursorAdapterError: this session already has an active run'),
  );
  assert.equal(failure.kind, 'session-holds-a-run');

  assert.equal(
    failureHasResolved(failure, {
      unresolvedAgentTurns: 1,
      needsAcknowledgementAgentTurn: [],
    }),
    false,
    'while the run it names is still unresolved, the message is still true',
  );
  assert.equal(
    failureHasResolved(failure, {
      unresolvedAgentTurns: 0,
      needsAcknowledgementAgentTurn: [],
    }),
    true,
    'once the run has reported an end, it is not standing in the way any more',
  );
});

test('an acknowledgement block stays up while any attempt is still unnamed', () => {
  const failure = describeBridgeFailure(
    new Error('DSpatch will not repeat this by itself: dsp-attempt-0002 has no known end.'),
  );
  assert.equal(failure.kind, 'needs-acknowledgement');

  assert.equal(
    failureHasResolved(failure, {
      unresolvedAgentTurns: 2,
      needsAcknowledgementAgentTurn: ['dsp-attempt-0002'],
    }),
    false,
    'one attempt left to name is still a reason to refuse',
  );
  assert.equal(
    failureHasResolved(failure, {
      unresolvedAgentTurns: 2,
      needsAcknowledgementAgentTurn: [],
    }),
    true,
    'nothing left to name means the block has nothing left to say',
  );
});

test('a failure whose condition cannot be observed is never cleared by itself', () => {
  const refusal = describeBridgeFailure(new Error('Refusing to open C:/x'));
  const connection = describeBridgeFailure(new Error('fetch failed'));
  const other = describeBridgeFailure(new Error('something nobody classified'));
  const nothingUnresolved = {
    unresolvedAgentTurns: 0,
    needsAcknowledgementAgentTurn: [],
  };
  assert.equal(failureHasResolved(refusal, nothingUnresolved), false);
  assert.equal(failureHasResolved(connection, nothingUnresolved), false);
  assert.equal(failureHasResolved(other, nothingUnresolved), false);
});

// --- The promise about the composer (report 005) ----------------------------

test('a failed turn text goes back in an empty composer', () => {
  const outcome = restoreComposerAfterRunFailure('explain the diff', '');
  assert.equal(outcome.restore, true);
  assert.equal(outcome.text, 'explain the diff');
  assert.match(outcome.note, /put back in the box/);
});

test('text the user has since typed is never overwritten', () => {
  const outcome = restoreComposerAfterRunFailure(
    'explain the diff',
    'something else I started typing',
  );
  assert.equal(outcome.restore, false);
  assert.equal(outcome.text, 'something else I started typing');
  // And it says where the failed message actually is rather than claiming it is kept
  // in a place it is not. That claim is the defect report 005 found.
  assert.match(outcome.note, /kept in the conversation above/);
});

test('with no recorded text, nothing is claimed', () => {
  const outcome = restoreComposerAfterRunFailure('', '');
  assert.equal(outcome.restore, false);
  assert.match(outcome.note, /no record of the text/);
});
