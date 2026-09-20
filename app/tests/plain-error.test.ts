/**
 * DSP-64: an error a person meets is one sentence, with the detail on request.
 *
 * The rules are in `renderer/plain-error.ts`, and the three that matter are the
 * ones that could go wrong quietly:
 *
 * 1. The headline is the failure's **own first sentence, verbatim**. Nothing is
 *    summarised, rewritten or truncated — that is how a refusal becomes vaguer
 *    while looking tidier.
 * 2. **Nothing is lost.** Everything that used to be on screen is in `detail`.
 * 3. **An unknown stays unknown.** The short next step for an unclassified failure
 *    says only what is known, and claims no cause.
 *
 * The failures here go through the real `describeBridgeFailure`, so these are the
 * sentences the main process actually writes, including the refusal from DSP-61.
 *
 *     node --test tests/plain-error.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describePlainly, firstSentence, SHORT_NEXT_STEP } from '../src/renderer/plain-error.ts';
import { describeBridgeFailure } from '../src/renderer/recovery.ts';

/** The DSP-61 refusal, exactly as `experiment-repo.ts` writes it. */
const SAMPLE_REFUSAL =
  'Refusing to delete C:\\Users\\nicla\\AppData\\Local\\Temp\\dspatch-chat\\duration-repo: ' +
  "it is not empty and has no .dspatch-experiment file, so it was not generated here and may be someone's work.";

test('the refusal offers a way forward rather than a repeat of what failed', () => {
  // Before this, the rule matched only "Refusing to open", so this refusal fell
  // through to `other` and the window offered *Try again* — which asks for the same
  // thing and is refused in the same words. Measured on screen in trial B.
  const failure = describeBridgeFailure(new Error(SAMPLE_REFUSAL));
  assert.equal(failure.kind, 'refused-generated-folder');
  assert.equal(failure.action, 'choose-another-folder');
  const plain = describePlainly(failure);
  assert.match(plain.nextStep, /Open the project you want/);
  assert.doesNotMatch(plain.nextStep, /Trying again/);
  // And the longer text says what was not done, which is what makes it safe to act on.
  assert.match(failure.actionNote, /Nothing in that folder was deleted/);
  assert.match(failure.actionNote, /Old sample projects/);
});

test('the refusal that started this keeps every word of its own sentence', () => {
  const plain = describePlainly(describeBridgeFailure(new Error(SAMPLE_REFUSAL)));
  // Verbatim, and that is the point: the path, the marker's name and the reason are
  // all still in the first line a person reads.
  assert.equal(plain.headline, SAMPLE_REFUSAL);
  assert.match(plain.headline, /duration-repo/);
  assert.match(plain.headline, /\.dspatch-experiment/);
  assert.match(plain.headline, /may be someone's work/);
  // Not truncated into vagueness.
  assert.doesNotMatch(plain.headline, /…|\.\.\./);
});

test('a path with dots in it does not split the sentence', () => {
  // The obvious way to get this wrong: splitting on every `.` turns the refusal into
  // "Refusing to delete C:" — which is shorter, and useless.
  assert.equal(
    firstSentence('There is no folder at C:\\work\\app.config\\v1.2. Choose another one.'),
    'There is no folder at C:\\work\\app.config\\v1.2.',
  );
  assert.equal(firstSentence('It has no .dspatch-experiment file.'), 'It has no .dspatch-experiment file.');
});

test('a message of one long sentence is shown whole rather than cut', () => {
  const one =
    'DSpatch could not write the conversation file because the directory it lives in ' +
    'is read-only, and nothing about the session has been changed by that.';
  assert.equal(firstSentence(one), one);
  const plain = describePlainly(describeBridgeFailure(new Error(one)));
  assert.equal(plain.headline, one);
  assert.equal(plain.hasMoreThanHeadline, false);
});

test('a long explanation moves behind the disclosure and nothing is lost', () => {
  // `session-holds-a-run` carries over a thousand characters of measured detail. All
  // of it is worth keeping and none of it is a first line.
  const failure = describeBridgeFailure(
    new Error(
      "Error invoking remote method 'dspatch:send-prompt': Error: Session \"dsp-session-1\" " +
        'already has an active run (dsp-run-7). At most one run per session. DSpatch is ' +
        'subscribed to this run, and "Execution state" below reports it.',
    ),
  );
  const plain = describePlainly(failure);

  assert.equal(plain.headline, 'Session "dsp-session-1" already has an active run (dsp-run-7).');
  assert.equal(plain.nextStep, SHORT_NEXT_STEP['session-holds-a-run']);
  assert.ok(plain.nextStep.length < 140, 'the next step is one short sentence');

  const detail = plain.detail.map((line) => line.value).join('\n');
  // The rest of the message, the long note with its measurements, and the channel.
  assert.match(detail, /At most one run per session/);
  assert.match(detail, /"Execution state" below reports it/);
  assert.match(detail, /still refused 11 minutes later/);
  assert.match(detail, /dspatch:send-prompt/);
  assert.equal(plain.hasMoreThanHeadline, true);
  // And the raw text, which the tidying changed, is kept as it arrived.
  assert.match(detail, /Error invoking remote method/);
});

test('every labelled detail line has both a label and something in it', () => {
  const plain = describePlainly(describeBridgeFailure(new Error(SAMPLE_REFUSAL)));
  assert.ok(plain.detail.length > 0, 'the full message is always there');
  for (const line of plain.detail) {
    assert.notEqual(line.label.trim(), '');
    assert.notEqual(line.value.trim(), '');
  }
  assert.equal(plain.detail[0]?.value, SAMPLE_REFUSAL);
});

test('an unclassified failure claims no cause it does not know', () => {
  const plain = describePlainly(describeBridgeFailure(new Error('something nobody classified')));
  assert.equal(plain.nextStep, SHORT_NEXT_STEP.other);
  assert.match(plain.nextStep, /Your text is kept/);
  // No invented cause, and no promise about what will happen.
  assert.doesNotMatch(plain.nextStep, /network|provider|connection|will work|should/i);
});

test('every kind of failure has a short next step, and none is a paragraph', () => {
  // The whole set, so a kind added later cannot arrive without one — and so that
  // "short" stays a measurable claim rather than a style note.
  for (const [kind, sentence] of Object.entries(SHORT_NEXT_STEP)) {
    assert.notEqual(sentence.trim(), '', `${kind} has nothing to say`);
    assert.ok(sentence.length <= 140, `${kind} is ${String(sentence.length)} characters`);
    assert.ok(/[.!?]$/.test(sentence), `${kind} does not end a sentence`);
  }
});

test('the next step matches the action the window actually offers', () => {
  // A short sentence telling someone to do something the button does not do would be
  // worse than the long one it replaced, so the two are checked against each other.
  const cases: readonly { readonly message: string; readonly says: RegExp }[] = [
    { message: 'Refusing to open C:\\work\\DSpatch', says: /Choose a different folder/ },
    { message: 'No session is open, so there is nothing to send.', says: /Open a project first/ },
    { message: 'Cursor adapter operation "send" failed: TypeError: fetch failed', says: /check the connection again/ },
  ];
  for (const { message, says } of cases) {
    assert.match(describePlainly(describeBridgeFailure(new Error(message))).nextStep, says);
  }
});
