/**
 * The walk window's "Delegate to agent" action, from the review's real state: what the button
 * says and whether it can be pressed before, during and after a delegation, and what it delegates.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DELEGATE_LABEL, walkDelegationAction, type WalkDelegationInput } from '../src/shared/walk-delegation-action';

const base: WalkDelegationInput = {
  available: true,
  walkTitle: 'Totals',
  lineCount: 12,
  remainingCount: 5,
  job: null,
  otherRunning: false,
  starting: false,
  choosing: false,
};

test('before any delegation the button delegates the whole walk, and says so', () => {
  const action = walkDelegationAction(base);
  assert.equal(action.label, DELEGATE_LABEL);
  assert.equal(action.enabled, true);
  assert.equal(action.status, null);
  assert.equal(action.scope, 'Scope: the whole walk “Totals”, 12 changed lines, 5 still without your decision.');
});

test('while one is starting, running or stopping the button stays, disabled, and says which', () => {
  for (const [input, label, state] of [
    [{ ...base, starting: true }, 'Starting delegation…', 'starting'],
    [{ ...base, job: { state: 'running', decision: null } }, 'Delegation in progress…', 'running'],
    [{ ...base, job: { state: 'cancelling', decision: null } }, 'Stopping delegation…', 'stopping'],
  ] as const) {
    const action = walkDelegationAction(input);
    assert.equal(action.label, label);
    assert.equal(action.enabled, false);
    assert.equal(action.state, state);
    assert.ok((action.status ?? '') !== '', 'the reason is in words');
  }
});

test('a finished delegation says so on the button, keeps delegating again, and is not an approval', () => {
  const pending = walkDelegationAction({ ...base, job: { state: 'done', decision: null } });
  assert.equal(pending.label, 'Already delegated · Delegate again…');
  assert.equal(pending.enabled, true);
  assert.match(pending.status ?? '', /awaits your decision/);
  assert.match(walkDelegationAction({ ...base, job: { state: 'done', decision: 'accept-agent' } }).status ?? '', /You accepted/);
  assert.match(walkDelegationAction({ ...base, job: { state: 'done', decision: 'reject-agent' } }).status ?? '', /You rejected/);
  assert.match(walkDelegationAction({ ...base, job: { state: 'failed', decision: null } }).status ?? '', /failed/);
  assert.equal(walkDelegationAction({ ...base, job: { state: 'failed', decision: null } }).label, DELEGATE_LABEL);
});

test('unavailable for another reason, the button is shown disabled with a short reason', () => {
  for (const [input, reason] of [
    [{ ...base, available: false }, /no agent connection/],
    [{ ...base, lineCount: 0, remainingCount: 0 }, /no changed lines/],
    [{ ...base, otherRunning: true }, /another delegated review of this change is running/],
  ] as const) {
    const action = walkDelegationAction(input);
    assert.equal(action.label, DELEGATE_LABEL);
    assert.equal(action.enabled, false);
    assert.match(action.status ?? '', reason);
  }
  // Choosing: the button is not a second way in while the choice is open below it.
  assert.equal(walkDelegationAction({ ...base, choosing: true }).enabled, false);
});
