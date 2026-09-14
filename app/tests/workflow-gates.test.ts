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
  checkConnectionNamesAnAccount,
} from '../src/renderer/workflow-gates.ts';

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

test('no failure message can contain an account address', () => {
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
