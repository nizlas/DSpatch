/**
 * How the presentation adapter answers a resume when told to refuse or fail (DSP-121).
 *
 * The `resume-choice` window scenario is the test of the window; this is the rule
 * underneath it, which has to be right on its own: which environment values select
 * which behaviour, that a refusal carries the Cursor adapter's provider code and a
 * failure carries none, that `refused-once` remembers a refusal across adapter
 * instances, and that the record says what was asked. Every answer here is
 * SIMULATED: nothing is asked of any provider.
 *
 *     node --test tests/presentation-resume.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PresentationAdapter,
  PresentationResumeBehaviour,
  SIMULATED_SEND_FAILS,
  SIMULATED_SLOW_START,
  SIMULATED_SLOW_START_MS,
  presentationResumeMode,
  presentationSendMode,
} from '../src/main/presentation-adapter';

const CONFIG = { workspacePath: 'C:\somewhere\A', modelRequested: 'claude-haiku-4-5' } as const;

test('DSP-121 SIMULATED: the environment value selects the mode, and anything else is null', () => {
  assert.equal(presentationResumeMode(undefined), 'ok');
  assert.equal(presentationResumeMode(''), 'ok');
  assert.equal(presentationResumeMode('  '), 'ok');
  assert.equal(presentationResumeMode('refused'), 'refused');
  assert.equal(presentationResumeMode('failed'), 'failed');
  assert.equal(presentationResumeMode('refused-once'), 'refused-once');
  assert.equal(presentationResumeMode('ok'), 'ok');
  assert.equal(presentationResumeMode('Refused'), null);
  assert.equal(presentationResumeMode('nonsense'), null);
});

test('DSP-121 SIMULATED: refused throws the provider-missing shape every time, and records it', () => {
  const behaviour = new PresentationResumeBehaviour('refused');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.throws(
      () => {
        behaviour.decideResume('dsp-session-a');
      },
      (error: unknown) =>
        error instanceof Error &&
        (error as { providerCode?: unknown }).providerCode === 'agent_not_found' &&
        /simulated/.test(error.message) &&
        /dsp-session-a/.test(error.message) &&
        /agent_not_found/.test(error.message),
    );
  }
  const record = behaviour.record();
  assert.equal(record.mode, 'refused');
  assert.equal(record.simulated, true);
  assert.deepEqual(
    record.resumeAttempts.map((attempt) => [attempt.sessionId, attempt.outcome]),
    [
      ['dsp-session-a', 'refused'],
      ['dsp-session-a', 'refused'],
    ],
  );
});

test('DSP-121 SIMULATED: failed throws with no provider code and says it is simulated', () => {
  const behaviour = new PresentationResumeBehaviour('failed');
  assert.throws(
    () => {
      behaviour.decideResume('dsp-session-a');
    },
    (error: unknown) =>
      error instanceof Error &&
      !('providerCode' in error) &&
      /simulated temporary failure/.test(error.message) &&
      /fetch failed/.test(error.message),
  );
  assert.deepEqual(
    behaviour.record().resumeAttempts.map((attempt) => attempt.outcome),
    ['failed'],
  );
});

test('DSP-121 SIMULATED: refused-once refuses the first resume of each ID and then succeeds', () => {
  const behaviour = new PresentationResumeBehaviour('refused-once');
  assert.throws(() => {
    behaviour.decideResume('dsp-session-a');
  });
  behaviour.decideResume('dsp-session-a');
  assert.throws(() => {
    behaviour.decideResume('dsp-session-b');
  });
  behaviour.decideResume('dsp-session-a');
  assert.deepEqual(
    behaviour.record().resumeAttempts.map((attempt) => `${attempt.sessionId}:${attempt.outcome}`),
    ['dsp-session-a:refused', 'dsp-session-a:resumed', 'dsp-session-b:refused', 'dsp-session-a:resumed'],
  );
});

test('DSP-121 SIMULATED: ok never refuses, which is the default', () => {
  const behaviour = new PresentationResumeBehaviour();
  behaviour.decideResume('dsp-session-a');
  behaviour.decideResume('dsp-session-a');
  assert.equal(behaviour.mode, 'ok');
  assert.deepEqual(
    behaviour.record().resumeAttempts.map((attempt) => attempt.outcome),
    ['resumed', 'resumed'],
  );
});

test('DSP-121 SIMULATED: a refused resume opens no local session, and the behaviour is shared across adapter instances', async () => {
  const behaviour = new PresentationResumeBehaviour('refused-once');
  const first = new PresentationAdapter({ resume: behaviour });
  await assert.rejects(
    first.resume('dsp-session-a', CONFIG),
    (error: unknown) =>
      error instanceof Error && (error as { providerCode?: unknown }).providerCode === 'agent_not_found',
  );
  // Nothing was opened under that ID: a send has no session to go to.
  await assert.rejects(first.send('dsp-session-a', 'hello'), /No presentation session/);
  await first.dispose();

  // ChatService replaces the adapter per attempt; the second instance must see the
  // first refusal and succeed.
  const second = new PresentationAdapter({ resume: behaviour });
  const handle = await second.resume('dsp-session-a', CONFIG);
  assert.equal(handle.dspatchSessionId, 'dsp-session-a');
  assert.equal(handle.resumeEvidence, 'none');
  await second.dispose();

  const record = behaviour.record();
  assert.deepEqual(
    record.resumeAttempts.map((attempt) => attempt.outcome),
    ['refused', 'resumed'],
  );
  assert.equal(record.startSessionCalls, 0, 'a resume is not counted as a session start');
  assert.deepEqual(record.sent, []);
});

test('DSP-121 SIMULATED: the record counts session starts and keeps the exact text of every send', async () => {
  const behaviour = new PresentationResumeBehaviour('refused');
  const adapter = new PresentationAdapter({ resume: behaviour, deltaMs: 1 });
  const handle = await adapter.startSession(CONFIG);
  await adapter.send(handle.dspatchSessionId, 'Recap of the conversation\n\nthe message');
  // The timers the canned reply runs on are ended with the adapter.
  await adapter.dispose();
  const record = behaviour.record();
  assert.equal(record.startSessionCalls, 1);
  assert.deepEqual(record.sent, ['Recap of the conversation\n\nthe message']);
  assert.deepEqual(record.resumeAttempts, []);
});

test('the run starts inside send, before it returns, as the real adapters start theirs', async () => {
  // The contract `ChatService.sendPrompt` is written against: it holds the prompt and
  // the recap it put in front of the message only while `send` runs, and picks them
  // up from `run.started`. This fixture used to emit it on a timer, after `send` had
  // returned, so no turn in a presentation run recorded its recap (DSP-121).
  const adapter = new PresentationAdapter({ deltaMs: 1 });
  const handle = await adapter.startSession(CONFIG);
  const seen: string[] = [];
  adapter.subscribe(handle.dspatchSessionId, (event) => {
    seen.push(event.type);
  });
  const sending = adapter.send(handle.dspatchSessionId, 'a message');
  assert.deepEqual(seen, ['run.started'], 'run.started is emitted before send returns');
  await sending;
  // The reply itself still arrives on its timers, after the send has returned.
  assert.deepEqual(seen, ['run.started']);
  await adapter.dispose();
});

test('DSP-127 SIMULATED: the review send mode is read only from its own value, and markers refuse or hold a send', async () => {
  assert.equal(presentationSendMode(undefined), 'ok');
  assert.equal(presentationSendMode('markers'), 'markers');
  assert.equal(presentationSendMode('fail-always'), null);

  // A default behaviour - the chat's - never refuses a send, whatever the prompt says.
  const chat = new PresentationAdapter({ deltaMs: 1 });
  const chatSession = await chat.startSession({ ...CONFIG, provider: 'cursor' });
  assert.ok((await chat.send(chatSession.dspatchSessionId, `hello ${SIMULATED_SEND_FAILS}`)).dspatchRunId !== '');
  await chat.dispose();

  const behaviour = new PresentationResumeBehaviour('ok', 'markers');
  const review = new PresentationAdapter({ deltaMs: 1, resume: behaviour });
  const session = await review.startSession({ ...CONFIG, provider: 'cursor' });
  const events: string[] = [];
  review.subscribe(session.dspatchSessionId, (event) => events.push(event.type));
  await assert.rejects(review.send(session.dspatchSessionId, `q ${SIMULATED_SEND_FAILS}`), /simulated send failure/);
  assert.deepEqual(events, [], 'a refused send starts no run');
  assert.equal(review.hasActiveRun(session.dspatchSessionId), false);

  const startedAt = Date.now();
  const held = review.send(session.dspatchSessionId, `q ${SIMULATED_SLOW_START}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, ['run.started'], 'a slow start announces its run before send returns');
  await held;
  assert.ok(Date.now() - startedAt >= SIMULATED_SLOW_START_MS - 50);
  assert.deepEqual(behaviour.record().sent.length, 2);
  await review.dispose();
});
