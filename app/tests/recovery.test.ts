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
  CONNECTION_RETRY_DELAYS_MS,
  forProvider,
  connectionRetryPlan,
  describeBridgeFailure,
  describeReconciledRepeat,
  describeSavedConversationUnresolved,
  describeSendWait,
  failureHasResolved,
  restoreComposerAfterRunFailure,
  runEndingNeedsConnectionRecheck,
  SEND_WAIT_NOTICE_MS,
  shouldCheckCursorConnection,
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

test('a failed reach belongs to the provider of the work: only Cursor has a card to re-read', () => {
  const failure = describeBridgeFailure(new Error('fetch failed'));
  assert.equal(failure.action, 'reconnect');
  assert.equal(forProvider(failure, 'cursor').action, 'reconnect');
  assert.equal(forProvider(failure, 'claude').action, 'retry');
  assert.equal(forProvider(failure, 'copilot').action, 'retry');
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
});

test('text the user has since typed is never overwritten', () => {
  const outcome = restoreComposerAfterRunFailure(
    'explain the diff',
    'something else I started typing',
  );
  assert.equal(outcome.restore, false);
  assert.equal(outcome.text, 'something else I started typing');
});

test('with no recorded text, nothing is claimed', () => {
  const outcome = restoreComposerAfterRunFailure('', '');
  assert.equal(outcome.restore, false);
});

// --- DSP-136: Cursor is checked only when it is the agent in play ------------

test('the window checks Cursor on its own only when Cursor is the agent in play', () => {
  // No project open: the agent chosen in Open a project decides.
  assert.equal(shouldCheckCursorConnection({ projectOpen: false, sessionProvider: null, chosenAgent: null }), false);
  assert.equal(shouldCheckCursorConnection({ projectOpen: false, sessionProvider: null, chosenAgent: 'claude' }), false);
  assert.equal(shouldCheckCursorConnection({ projectOpen: false, sessionProvider: null, chosenAgent: 'cursor' }), true);
  // A project open: its conversation's agent decides, whatever the panel says.
  assert.equal(shouldCheckCursorConnection({ projectOpen: true, sessionProvider: 'claude', chosenAgent: 'cursor' }), false);
  assert.equal(shouldCheckCursorConnection({ projectOpen: true, sessionProvider: null, chosenAgent: 'cursor' }), false);
  assert.equal(shouldCheckCursorConnection({ projectOpen: true, sessionProvider: 'cursor', chosenAgent: 'claude' }), true);
});
