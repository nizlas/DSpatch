/**
 * The execution-state ledger, and a negative control for its repeat rule.
 *
 * Two things are being checked. First, that the four states AC#1 asks for are
 * distinguishable — waiting, cancellation requested, confirmed stopped, unknown
 * outcome — and that "unknown" never becomes "stopped" on its own. Second, that
 * AC#4's reconciliation is a rule rather than an intention: a repeat of an action
 * whose previous outcome is unknown is refused until the caller names the attempt
 * it has seen.
 *
 * The negative control is the "one at a time, by whether something is running"
 * rule this replaces. It is what an implementation naturally does, and it lets
 * the exact case report 003 left unknown through: a cancel that never reports an
 * end leaves nothing in a running state, so the guard sees no reason to object
 * and a second job starts beside work that may still be going.
 *
 *     node --test tests/attempt-ledger.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AttemptLedger, isSettled } from '../src/main/attempt-ledger.ts';
import type { AttemptKind, AttemptState, StoredAttempt } from '../src/shared/bridge.ts';

let clock = 0;

/** A fixed clock: the assertions are about ordering, not about wall time. */
function tick(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 8, 15, 0, 0, clock)).toISOString();
}

function ledger(): AttemptLedger {
  clock = 0;
  return new AttemptLedger(tick);
}

// --- The four states --------------------------------------------------------

test('a message that has started nothing is waiting, not running', () => {
  const book = ledger();
  const attempt = book.open('agent-turn', 'count to twenty');

  assert.equal(attempt.state, 'waiting');
  assert.equal(attempt.providerRunId, null);
  assert.equal(attempt.stillRunning.provider, null, 'unknown, not false');
  assert.equal(attempt.stillRunning.dspatchProcess, false);
  // The way out of the wait is offered before anything exists to cancel: this is
  // the gap report 003 measured at 11–12 seconds.
  assert.equal(attempt.nextAction.kind, 'stop-waiting');
  assert.match(attempt.nextAction.detail, /11–12 seconds/);
  assert.equal(isSettled(attempt.state), false);
});

test('the four states are separate values, in order', () => {
  const book = ledger();
  const { attemptId } = book.open('agent-turn', 'change a file');
  assert.equal(book.get(attemptId)?.state, 'waiting');

  book.markRunning(attemptId, { providerRunId: 'dsp-run-1' }, 'run.started arrived.');
  assert.equal(book.get(attemptId)?.state, 'running');
  assert.equal(book.get(attemptId)?.stillRunning.provider, true);

  book.markCancelRequested(attemptId, 'Cancel pressed; cancel() resolved in 44 ms.');
  const cancelling = book.get(attemptId);
  assert.equal(cancelling?.state, 'cancel-requested');
  assert.notEqual(cancelling?.cancelRequestedAtUtc, null);
  // A cancellation that has been asked for says nothing about what is running.
  assert.equal(cancelling?.stillRunning.provider, null);
  assert.match(cancelling?.stillRunning.note ?? '', /69\.5 seconds/);
  assert.equal(cancelling?.nextAction.kind, 'keep-waiting');

  book.markStopped(attemptId, 'run.finished status=cancelled.');
  const stopped = book.get(attemptId);
  assert.equal(stopped?.state, 'stopped-confirmed');
  assert.equal(stopped?.stillRunning.provider, false);
  assert.notEqual(stopped?.endedAtUtc, null);
  assert.equal(isSettled('stopped-confirmed'), true);
});

test('a cancel that never confirms an end becomes unknown, never stopped', () => {
  const book = ledger();
  const { attemptId } = book.open('agent-turn', 'a long job');
  book.markRunning(attemptId, { providerRunId: 'dsp-run-2' }, 'started');
  book.markCancelRequested(attemptId, 'Cancel pressed.');
  book.markOutcomeUnknown(
    attemptId,
    'No terminal event within the confirmation window.',
  );

  const attempt = book.get(attemptId);
  assert.equal(attempt?.state, 'outcome-unknown');
  assert.equal(isSettled('outcome-unknown'), false, 'unknown is not an ending');
  assert.equal(attempt?.stillRunning.provider, null);
  assert.equal(attempt?.endedAtUtc, null, 'nothing ended, so there is no end time');
  assert.equal(attempt?.nextAction.kind, 'acknowledge-then-repeat');
  assert.match(attempt?.nextAction.detail ?? '', /Nothing is repeated automatically/);
});

test('a settled attempt cannot be rewritten, and the attempt to do so is kept', () => {
  const book = ledger();
  const { attemptId } = book.open('command', 'npm test');
  book.markRunning(attemptId, { localPid: 4242 }, 'spawned');
  book.markStopped(attemptId, 'DSpatch killed the process tree; close observed.');

  // The late claim: the provider or the runtime says it finished after all.
  book.markCompleted(attemptId, 'run.finished status=finished arrived late.');

  const attempt = book.get(attemptId);
  assert.equal(attempt?.state, 'stopped-confirmed', 'the confirmed stop stands');
  const refused = attempt?.history.filter((step) => !step.applied) ?? [];
  assert.equal(refused.length, 1);
  assert.match(refused[0]?.note ?? '', /Not applied/);
  assert.match(refused[0]?.note ?? '', /already settled/);
  // Nothing was lost: the discarded claim is on the record.
  assert.equal(refused[0]?.state, 'completed');
});

// --- Reconciliation before repeating ---------------------------------------

test('a repeat is refused while an outcome is unknown, and allowed once named', () => {
  const book = ledger();
  const first = book.open('agent-turn', 'first message');
  book.markRunning(first.attemptId, { providerRunId: 'dsp-run-3' }, 'started');
  book.markCancelRequested(first.attemptId, 'Cancel pressed.');
  book.markOutcomeUnknown(first.attemptId, 'No end confirmed.');

  const blocked = book.mayRepeat('agent-turn');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.blockedBy, first.attemptId);
  assert.deepEqual(blocked.acknowledgeableAttemptIds, [first.attemptId]);
  assert.match(blocked.reason, /will not repeat this by itself/);

  // A wrong ID is not an acknowledgement of this attempt.
  assert.equal(
    book.mayRepeat('agent-turn', ['dsp-attempt-9999']).allowed,
    false,
    'naming some other attempt does not reconcile this one',
  );

  const allowed = book.mayRepeat('agent-turn', [first.attemptId]);
  assert.equal(allowed.allowed, true);
  assert.match(allowed.reason, /It stays on the record as unresolved/);

  // And the earlier attempt is still unresolved afterwards: acknowledging is not
  // a way of declaring that it stopped.
  book.acknowledge(first.attemptId, 'The user accepted the unknown outcome.');
  assert.equal(book.get(first.attemptId)?.state, 'outcome-unknown');
  assert.notEqual(book.get(first.attemptId)?.acknowledgedAtUtc, null);
  assert.equal(book.unresolved('agent-turn').length, 1);
});

test('a confirmed running attempt blocks a repeat, and no acknowledgement helps', () => {
  const book = ledger();
  const first = book.open('command', 'npm test');
  book.markRunning(first.attemptId, { localPid: 991 }, 'spawned');

  for (const acknowledgement of [undefined, [first.attemptId]]) {
    const decision = book.mayRepeat('command', acknowledgement);
    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.acknowledgeableAttemptIds, []);
    assert.match(decision.reason, /is running/);
  }
});

/**
 * The defect report 006 measured: two unknown outcomes, one named, message sent.
 *
 * Restarting into a conversation with several unresolved attempts is not exotic —
 * one interrupted send and one interrupted command is enough — and naming one of
 * them used to be enough to get past the gate, leaving the other unresolved and
 * unmentioned by the thing that let the message through.
 */
test('every unknown outcome of a kind has to be named, not just one', () => {
  const book = ledger();
  const first = book.open('agent-turn', 'first message');
  book.markOutcomeUnknown(first.attemptId, 'The user stopped waiting for it.');
  const second = book.open('agent-turn', 'second message');
  book.markOutcomeUnknown(second.attemptId, 'The window closed while it ran.');

  const both = book.mayRepeat('agent-turn');
  assert.equal(both.allowed, false);
  assert.deepEqual(both.acknowledgeableAttemptIds, [first.attemptId, second.attemptId]);

  const half = book.mayRepeat('agent-turn', [first.attemptId]);
  assert.equal(half.allowed, false, 'naming one of two is not naming them');
  assert.equal(half.blockedBy, second.attemptId);
  assert.deepEqual(half.acknowledgeableAttemptIds, [first.attemptId, second.attemptId]);

  const named = book.mayRepeat('agent-turn', [first.attemptId, second.attemptId]);
  assert.equal(named.allowed, true);

  // Order is not a way of getting it wrong.
  assert.equal(
    book.mayRepeat('agent-turn', [second.attemptId, first.attemptId]).allowed,
    true,
  );

  // And the report offers the whole list, so the window can name all of them.
  assert.deepEqual(book.report().needsAcknowledgement.agentTurn, [
    first.attemptId,
    second.attemptId,
  ]);
});

test('the two kinds do not block each other', () => {
  const book = ledger();
  const turn = book.open('agent-turn', 'change a file');
  book.markRunning(turn.attemptId, { providerRunId: 'dsp-run-4' }, 'started');

  assert.equal(book.mayRepeat('agent-turn').allowed, false);
  assert.equal(
    book.mayRepeat('command').allowed,
    true,
    'running a test while the agent works is a normal thing to want',
  );
});

test('a settled attempt blocks nothing', () => {
  const book = ledger();
  const first = book.open('agent-turn', 'one');
  book.markRunning(first.attemptId, { providerRunId: 'dsp-run-5' }, 'started');
  book.markCompleted(first.attemptId, 'run.finished status=finished.');
  assert.equal(book.mayRepeat('agent-turn').allowed, true);

  const failed = book.open('agent-turn', 'two');
  book.markFailed(failed.attemptId, 'The provider refused the request.');
  assert.equal(book.mayRepeat('agent-turn').allowed, true);
  // A failure that was observed is safe to repeat, and that is the offer made.
  assert.equal(book.get(failed.attemptId)?.nextAction.kind, 'retry');
});

test('every attempt has its own ID and they do not repeat', () => {
  const book = ledger();
  const ids = [
    book.open('agent-turn', 'a').attemptId,
    book.open('agent-turn', 'a').attemptId,
    book.open('command', 'npm test').attemptId,
  ];
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids, ['dsp-attempt-0001', 'dsp-attempt-0002', 'dsp-attempt-0003']);
  assert.equal(book.latest('command')?.label, 'npm test');
  assert.equal(book.latest('agent-turn')?.attemptId, 'dsp-attempt-0002');
});

test('the report names what a repeat of each kind needs', () => {
  const book = ledger();
  const turn = book.open('agent-turn', 'a message');
  book.markOutcomeUnknown(turn.attemptId, 'The user stopped waiting for it.');
  const command = book.open('command', 'npm test');
  book.markRunning(command.attemptId, { localPid: 7 }, 'spawned');

  const report = book.report();
  assert.equal(report.attempts.length, 2);
  assert.equal(report.unresolved.length, 2);
  assert.deepEqual(report.needsAcknowledgement.agentTurn, [turn.attemptId]);
  // Running work cannot be acknowledged away, so there is nothing to name.
  assert.deepEqual(report.needsAcknowledgement.command, []);
});

// --- Acknowledging once per attempt, not once per message (DSP-6 item 1) ----
//
// The defect DSP-5's trial found. `acknowledge()` wrote `acknowledgedAtUtc` to the
// record and `mayRepeat` never read it, so the acknowledgement had no effect on
// the next call: the window passed the IDs on one send and met the same gate on
// the next message. Niclas's conversation held eleven attempts, exactly one
// `outcome-unknown`, and no listener that could ever resolve it — so the gate was
// permanent, and he met it three times in twelve minutes.

test('an acknowledged attempt is not asked about again, and stays unresolved', () => {
  const book = ledger();
  const first = book.open('agent-turn', 'the message that vanished');
  book.markOutcomeUnknown(first.attemptId, 'The window stopped waiting for it.');

  // The first gate is untouched: the first message after an unknown outcome still
  // stops and explains.
  const refused = book.mayRepeat('agent-turn');
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.acknowledgeableAttemptIds, [first.attemptId]);
  assert.deepEqual(book.report().needsAcknowledgement.agentTurn, [first.attemptId]);

  book.acknowledge(first.attemptId, 'The user accepted the unknown outcome.');

  // And now the second message, with no IDs passed at all — which is what the
  // composer sends. This is the assertion that fails if the change is reverted.
  const later = book.mayRepeat('agent-turn');
  assert.equal(later.allowed, true, 'one acknowledgement holds for the conversation');
  assert.deepEqual(
    later.acknowledgeableAttemptIds,
    [],
    'nothing is left for the window to ask about, so no gate is raised',
  );
  assert.deepEqual(book.report().needsAcknowledgement.agentTurn, []);
  assert.match(later.reason, /Already acknowledged/);
  assert.match(later.reason, new RegExp(first.attemptId));

  // Nothing about the record has softened. It is still unknown, still unresolved,
  // still not settled, and the panel still lists it.
  assert.equal(book.get(first.attemptId)?.state, 'outcome-unknown');
  assert.equal(isSettled(book.get(first.attemptId)?.state ?? 'waiting'), false);
  assert.equal(book.unresolved('agent-turn').length, 1);
  assert.equal(book.report().unresolved.length, 1);
  // And the row offers no button to confirm what has already been confirmed.
  assert.equal(book.get(first.attemptId)?.nextAction.kind, 'none');
  assert.match(
    String(book.get(first.attemptId)?.nextAction.detail),
    /stays recorded as unresolved/,
  );
});

test('a second unknown outcome raises the gate again, on its own account', () => {
  // Acknowledging is per attempt, not a standing permission for the conversation.
  // A new unknown outcome is new information and has to be seen.
  const book = ledger();
  const first = book.open('agent-turn', 'first');
  book.markOutcomeUnknown(first.attemptId, 'unknown');
  book.acknowledge(first.attemptId, 'seen');
  assert.equal(book.mayRepeat('agent-turn').allowed, true);

  const second = book.open('agent-turn', 'second');
  book.markOutcomeUnknown(second.attemptId, 'unknown as well');

  const decision = book.mayRepeat('agent-turn');
  assert.equal(decision.allowed, false);
  assert.equal(decision.blockedBy, second.attemptId);
  assert.deepEqual(
    decision.acknowledgeableAttemptIds,
    [second.attemptId],
    'only the one that has not been seen',
  );
});

test('an acknowledgement is written once and keeps the time it was first seen', () => {
  const book = ledger();
  const attempt = book.open('agent-turn', 'once');
  book.markOutcomeUnknown(attempt.attemptId, 'unknown');
  book.acknowledge(attempt.attemptId, 'seen');
  const firstTime = book.get(attempt.attemptId)?.acknowledgedAtUtc;
  assert.notEqual(firstTime, null);

  book.acknowledge(attempt.attemptId, 'mentioned again');
  assert.equal(book.get(attempt.attemptId)?.acknowledgedAtUtc, firstTime);
  // The later mention is not lost; it is in the history where it belongs.
  assert.equal(
    book.get(attempt.attemptId)?.history.filter((step) => step.note === 'mentioned again')
      .length,
    1,
  );
});

test('running work is still refused, and an acknowledgement does not change that', () => {
  // The gate that must not soften. `acknowledgedAtUtc` is consulted only for an
  // ambiguous attempt; confirmed concurrent work is refused regardless.
  const book = ledger();
  const attempt = book.open('command', 'npm test');
  book.acknowledge(attempt.attemptId, 'seen while it was still waiting');
  book.markRunning(attempt.attemptId, { localPid: 4242 }, 'spawned');

  const decision = book.mayRepeat('command');
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /is running/);
  assert.deepEqual(decision.acknowledgeableAttemptIds, []);
});

// --- Reading attempts back after a restart (DSP-4) --------------------------

function stored(
  attemptId: string,
  state: AttemptState,
  kind: AttemptKind = 'agent-turn',
): StoredAttempt {
  return {
    attemptId,
    kind,
    label: kind === 'agent-turn' ? 'a message' : 'npm test',
    state,
    stateReason: 'as it was when the window closed',
    requestedAtUtc: '2026-09-15T00:00:01.000Z',
    endedAtUtc: null,
    providerRunId: kind === 'agent-turn' ? 'dsp-run-1' : null,
    localPid: kind === 'command' ? 4242 : null,
    cancelRequestedAtUtc: state === 'cancel-requested' ? '2026-09-15T00:00:02.000Z' : null,
    acknowledgedAtUtc: null,
    history: [],
  };
}

test('an attempt that was running when the window closed comes back as unknown', () => {
  const book = ledger();
  const outcome = book.restore([stored('dsp-attempt-0001', 'running')]);

  const attempt = book.get('dsp-attempt-0001');
  assert.equal(attempt?.state, 'outcome-unknown');
  // Not stopped, and the words say why: closing a window is not an ending, and
  // DSP-1 measured 69.5 s of continued remote work after DSpatch stopped listening.
  assert.match(String(attempt?.stateReason), /closing a\s+window is not an ending/);
  assert.equal(outcome.reconciliations.length, 1);
  assert.equal(outcome.reconciliations[0]?.stateAtClose, 'running');
  assert.equal(outcome.reconciliations[0]?.stateNow, 'outcome-unknown');
  assert.equal(outcome.reconciliations[0]?.blocksRepeat, true);
});

test('a restored unknown outcome blocks the next message until it is named', () => {
  const book = ledger();
  book.restore([stored('dsp-attempt-0001', 'running')]);

  const refused = book.mayRepeat('agent-turn');
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.acknowledgeableAttemptIds, ['dsp-attempt-0001']);

  const named = book.mayRepeat('agent-turn', ['dsp-attempt-0001']);
  assert.equal(named.allowed, true);
  // Naming it does not settle it. The record still says nobody established an end.
  assert.equal(isSettled(book.get('dsp-attempt-0001')?.state ?? 'waiting'), false);
});

test('an acknowledgement survives the restart, so the gate is not paid twice', () => {
  // "Once per conversation" has to mean the conversation, not the window. The
  // acknowledgement is part of what `persistable()` writes and what `restore()`
  // reads, so a conversation reopened tomorrow does not ask again.
  const before = ledger();
  const attempt = before.open('agent-turn', 'the message that vanished');
  before.markOutcomeUnknown(attempt.attemptId, 'The window stopped waiting for it.');
  before.acknowledge(attempt.attemptId, 'The user accepted the unknown outcome.');
  const saved = before.persistable();
  assert.notEqual(saved[0]?.acknowledgedAtUtc, null, 'it reaches the file');

  const after = ledger();
  const outcome = after.restore(saved);
  assert.equal(after.get(attempt.attemptId)?.state, 'outcome-unknown');
  assert.equal(after.mayRepeat('agent-turn').allowed, true);
  assert.deepEqual(after.report().needsAcknowledgement.agentTurn, []);
  // It is still reported as something the restore could not resolve, and still
  // listed as unresolved. Only the asking has stopped.
  assert.equal(outcome.reconciliations.length, 1);
  assert.equal(outcome.reconciliations[0]?.stateNow, 'outcome-unknown');
  assert.equal(after.unresolved('agent-turn').length, 1);
  // And it says so. `blocksRepeat` was `true` for every unresolved attempt until
  // Verifier 004 measured the panel that renders it telling the reader to name an
  // attempt that had been named and would not be asked about again. It means what
  // `mayRepeat` above has just answered.
  assert.equal(outcome.reconciliations[0]?.blocksRepeat, false);
});

test('an unacknowledged attempt still blocks after a restart', () => {
  // The negative control for the test above: without the acknowledgement on the
  // record, restoring the same attempt refuses the next message as it always did.
  const before = ledger();
  const attempt = before.open('agent-turn', 'the message that vanished');
  before.markOutcomeUnknown(attempt.attemptId, 'The window stopped waiting for it.');

  const after = ledger();
  after.restore(before.persistable());
  assert.equal(after.mayRepeat('agent-turn').allowed, false);
  assert.deepEqual(after.report().needsAcknowledgement.agentTurn, [attempt.attemptId]);
});

test('a cancellation with no confirmed end is restored as unknown, never as stopped', () => {
  const book = ledger();
  book.restore([stored('dsp-attempt-0001', 'cancel-requested', 'command')]);
  assert.equal(book.get('dsp-attempt-0001')?.state, 'outcome-unknown');
  assert.equal(book.mayRepeat('command').allowed, false);
});

test('a settled attempt is restored as it was and blocks nothing', () => {
  const book = ledger();
  const outcome = book.restore([
    stored('dsp-attempt-0001', 'completed'),
    stored('dsp-attempt-0002', 'stopped-confirmed'),
    stored('dsp-attempt-0003', 'failed'),
  ]);
  assert.deepEqual(outcome.reconciliations, []);
  assert.equal(book.get('dsp-attempt-0001')?.state, 'completed');
  assert.equal(book.get('dsp-attempt-0002')?.state, 'stopped-confirmed');
  assert.equal(book.mayRepeat('agent-turn').allowed, true);
});

test('a new attempt after a restore cannot reuse a restored ID', () => {
  const book = ledger();
  book.restore([
    stored('dsp-attempt-0001', 'completed'),
    stored('dsp-attempt-0002', 'completed'),
    stored('dsp-attempt-0003', 'completed'),
  ]);
  assert.equal(book.open('agent-turn', 'the next message').attemptId, 'dsp-attempt-0004');
});

test('an ID the ledger already holds is not adopted, and is reported', () => {
  // Attempts are numbered per window, so two conversations saved by two runs of
  // DSpatch both contain dsp-attempt-0001. Merging them would put one piece of
  // work's history under another's identity.
  const book = ledger();
  const live = book.open('agent-turn', 'work done in this window');
  assert.equal(live.attemptId, 'dsp-attempt-0001');

  const outcome = book.restore([stored('dsp-attempt-0001', 'running')]);
  assert.deepEqual(outcome.skippedAttemptIds, ['dsp-attempt-0001']);
  assert.deepEqual(outcome.reconciliations, []);
  assert.equal(book.get('dsp-attempt-0001')?.label, 'work done in this window');
  assert.equal(book.all().length, 1);
});

test('dropping restored attempts keeps this window own work', () => {
  const book = ledger();
  const live = book.open('command', 'npm test');
  book.markCompleted(live.attemptId, 'exit 0');
  book.restore([stored('dsp-attempt-0007', 'running')]);
  assert.equal(book.all().length, 2);
  assert.equal(book.mayRepeat('agent-turn').allowed, false);

  const dropped = book.dropRestored();
  assert.equal(dropped, 1);
  assert.deepEqual(
    book.all().map((attempt) => attempt.attemptId),
    [live.attemptId],
  );
  assert.equal(book.mayRepeat('agent-turn').allowed, true);
  // The counter does not go back, so a later attempt cannot take a released ID.
  assert.equal(book.open('agent-turn', 'later').attemptId, 'dsp-attempt-0008');
});

test('the restore rule this replaces lets a killed run pass as an ending', () => {
  // The rule an implementation reaches for first: read the saved states back as they
  // are. It looks conservative — nothing is invented — but it is wrong in both
  // directions at once, and this shows which.
  interface SavedJob {
    id: string;
    state: 'running' | 'completed';
  }
  const saved: SavedJob[] = [{ id: 'job-1', state: 'running' }];

  // Read back verbatim, a `running` job is either taken as still going — in a process
  // that has no connection to it and will never receive its events — or, as here,
  // tidied into an ending nobody observed. Either way the user is told something
  // DSpatch cannot know.
  const asRead = saved.map((job) => ({ ...job }));
  const tidiedIntoAnEnding = asRead.map((job) => ({
    ...job,
    state: job.state === 'running' ? ('completed' as const) : job.state,
  }));
  assert.equal(
    tidiedIntoAnEnding[0]?.state,
    'completed',
    'the naive rule reports an ending that nothing established',
  );
  const oldRuleAllowsAnother = !tidiedIntoAnEnding.some((job) => job.state === 'running');
  assert.equal(oldRuleAllowsAnother, true, 'and therefore blocks nothing');

  // The ledger produces the third answer, which is the true one.
  const book = ledger();
  book.restore([stored('dsp-attempt-0001', 'running')]);
  assert.equal(book.get('dsp-attempt-0001')?.state, 'outcome-unknown');
  assert.equal(book.mayRepeat('agent-turn').allowed, false);
});

// --- The negative control ---------------------------------------------------

test('the running-only guard this replaces lets the unknown case through', () => {
  // The rule an implementation reaches for first: allow a new job unless
  // something is currently running. Report 003 could not settle what happens
  // after a cancel that never ends, and this is why it matters — that path
  // leaves nothing "running", so this guard raises no objection at all.
  interface Job {
    id: string;
    running: boolean;
    endConfirmed: boolean;
  }
  const jobs: Job[] = [{ id: 'job-1', running: true, endConfirmed: false }];

  // Cancel is pressed. The client stops treating it as running; no terminal event
  // ever arrives, so nothing confirms an end.
  const first = jobs[0];
  assert.ok(first !== undefined);
  first.running = false;

  const oldRuleAllowsAnother = !jobs.some((job) => job.running);
  assert.equal(
    oldRuleAllowsAnother,
    true,
    'the old guard starts a second job beside one whose outcome is unknown',
  );
  assert.equal(first.endConfirmed, false, 'and nothing ever established an end');

  // The ledger refuses the same situation until it is reconciled.
  const book = ledger();
  const attempt = book.open('agent-turn', 'the same job');
  book.markRunning(attempt.attemptId, { providerRunId: 'dsp-run-6' }, 'started');
  book.markCancelRequested(attempt.attemptId, 'Cancel pressed.');
  book.markOutcomeUnknown(attempt.attemptId, 'No end confirmed.');
  assert.equal(book.mayRepeat('agent-turn').allowed, false);
});
