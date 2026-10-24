/**
 * What the window shows while no provider session is open (DSP-121), as rules.
 *
 * The panel must give a short, true account of what happened, offer exactly the
 * choices the main process listed, and say what a new session means where it is
 * chosen; the new-session block must show what will be sent and what removing it
 * does; and the diagnostics must carry every text the service produced, in the one
 * list that *Copy diagnostic info* copies. The components draw what these functions
 * return, so this is where those claims are checked. No React, no provider.
 *
 *     node --test tests/continuity-view.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ContinuityChoice,
  ResumeFailure,
  SessionContinuity,
  SessionContinuityKind,
} from '../src/shared/bridge';
import {
  CONTINUITY_HEADING,
  EARLIER_SENDS_NOTE,
  NEW_SESSION_AT_CHOICE,
  NEW_SESSION_HEADING,
  NO_SESSION_STATUS,
  SIMULATION_LABEL,
  SIMULATION_NOTICE,
  STILL_AVAILABLE,
  SUMMARY_REMOVED,
  SUMMARY_WILL_BE_SENT,
  actionSentence,
  composerStatus,
  continuityBody,
  continuityClause,
  continuityPanel,
  conversationDiagnostics,
  diagnosticsText,
  earlierSendLine,
  newSessionView,
  noSessionRouteNote,
  providerSessionFact,
  sentWithSummaryLine,
  runningCommandNote,
  simulationLabel,
  simulationNotice,
} from '../src/renderer/continuity-view';

const RETRY_AND_NEW: readonly ContinuityChoice[] = ['try-again', 'new-session'];
const NEW_ONLY: readonly ContinuityChoice[] = ['new-session'];

/** A continuity of one of the non-open kinds, as `ChatService` builds it. */
function notOpen(
  kind: SessionContinuityKind,
  failure: ResumeFailure | null,
  choices: readonly ContinuityChoice[] = RETRY_AND_NEW,
): SessionContinuity {
  return {
    kind,
    providerSessionOpen: false,
    attemptedDspatchSessionId: 'dsp-session-1',
    resumedProviderSessionId: null,
    resumeError: failure?.detail ?? null,
    resumeFailure: failure,
    earlierSendsMayHaveReached: [],
    choices,
    contextToResend: null,
    contextNote: 'Nothing was resent and nothing will be: no provider session is open.',
    savedMessageCount: 2,
    statement: `Statement for ${kind}. No new session was opened and nothing was sent.`,
  };
}

const MISSING: ResumeFailure = { kind: 'provider-missing', detail: 'x', providerCode: 'agent_not_found' };
const FAILED: ResumeFailure = { kind: 'error', detail: 'TypeError: fetch failed', providerCode: null };

/** A new provider session, as `ChatService` builds it after the user chose one. */
function fresh(contextToResend: string | null): SessionContinuity {
  return {
    kind: 'new-provider-session',
    providerSessionOpen: true,
    attemptedDspatchSessionId: 'dsp-session-1',
    resumedProviderSessionId: null,
    resumeError: null,
    resumeFailure: null,
    earlierSendsMayHaveReached: [],
    choices: [],
    contextToResend,
    contextNote: 'what the summary covers',
    savedMessageCount: 2,
    statement: 'This is a new provider session, opened because you asked for one.',
  };
}

const NOTHING_DONE = { sentAnything: false, recapDiscarded: false };

// --- The panel ---------------------------------------------------------------

test('refused: the heading, one body line, the two offered buttons and what a new session means', () => {
  const panel = continuityPanel(notOpen('resume-refused', MISSING), false);
  assert.notEqual(panel, null);
  assert.equal(panel?.heading, 'Could not resume the agent session.');
  assert.equal(
    panel?.body,
    'The session was not found. Your saved conversation is still available. ' +
      'Try again, or start a new session.',
  );
  assert.deepEqual(
    panel?.choices.map((choice) => [choice.testId, choice.label]),
    [
      ['continuity-choice-try-again', 'Try again'],
      ['continuity-choice-new-session', 'Start new session'],
    ],
  );
  // The tooltips say what is not sent: a message. The resume call itself carries the
  // session ID, the model and the path (DSP-121 review S5).
  assert.deepEqual(
    panel?.choices.map((choice) => choice.note),
    [
      'Asks for the same session once more. No message is sent.',
      'Opens a new agent session. DSpatch shows the summary it would send first; you can ' +
        'remove it. No message is sent until you send.',
    ],
  );
  for (const choice of panel?.choices ?? []) {
    assert.notEqual(choice.note.trim(), '');
  }
  assert.equal(
    panel?.newSessionNote,
    'A new session starts without the earlier conversation. You can send a summary ' +
      'with your next message.',
  );
  assert.equal(panel?.earlierSendsNote, null, 'no earlier-sends note without earlier sends');
  assert.equal(panel?.runningCommandNote, null, 'no command note with nothing running');
});

test('failed: may be temporary, and the same two choices', () => {
  const panel = continuityPanel(notOpen('resume-failed', FAILED), false);
  assert.equal(
    panel?.body,
    'This may be temporary. Your saved conversation is still available. Try again, or start a new session.',
  );
  assert.deepEqual(panel?.choices.map((choice) => choice.choice), ['try-again', 'new-session']);
});

test('the choices are the ones the main process listed, in its order, and no others', () => {
  const panel = continuityPanel(
    { ...notOpen('resume-refused', MISSING), choices: ['new-session', 'try-again'] },
    false,
  );
  assert.deepEqual(panel?.choices.map((choice) => choice.choice), ['new-session', 'try-again']);
  // Reading the history is not a choice any more: no state offers a third button.
  for (const choices of [RETRY_AND_NEW, NEW_ONLY]) {
    const labels = continuityPanel(notOpen('resume-refused', MISSING, choices), false)?.choices.map(
      (choice) => choice.label,
    );
    assert.ok(!(labels ?? []).includes('Read history'));
  }
});

test('where a retry cannot work, the panel offers only a new session and says so', () => {
  const blocked: readonly [SessionContinuityKind, ResumeFailure, string][] = [
    ['resume-unavailable', { kind: 'error', detail: 'x', providerCode: null }, 'This adapter cannot resume sessions.'],
    ['resume-refused', { kind: 'unconfirmed-end', detail: 'x', providerCode: null }, 'The last message has no confirmed end, so the session was not resumed.'],
    ['resume-refused', { kind: 'error', detail: 'x', providerCode: 'config_mismatch' }, 'The session was recorded with other settings.'],
  ];
  for (const [kind, failure, clause] of blocked) {
    const panel = continuityPanel(notOpen(kind, failure, NEW_ONLY), false);
    assert.equal(panel?.body, `${clause} ${STILL_AVAILABLE} Start a new session to continue.`, kind);
    assert.deepEqual(panel?.choices.map((choice) => choice.label), ['Start new session']);
    assert.doesNotMatch(panel?.body ?? '', /Try again/);
    assert.equal(panel?.newSessionNote, NEW_SESSION_AT_CHOICE);
  }
});

test('an open session has no panel, no body and no route note, whatever the kind', () => {
  const resumed: SessionContinuity = {
    ...fresh(null),
    kind: 'provider-session-resumed',
    statement: 'The provider session dsp-session-1 was resumed.',
  };
  assert.equal(continuityPanel(resumed, false), null);
  assert.equal(continuityPanel(fresh('SUMMARY'), true), null);
  assert.equal(continuityBody(resumed), null);
  assert.equal(noSessionRouteNote(resumed), null);
  assert.equal(noSessionRouteNote(null), null);
});

// --- What happened: one clause per state, true to the evidence ---------------

test('the clause is keyed on what the failure established, and never claims existence or loss', () => {
  const clause = (kind: SessionContinuityKind, failure: ResumeFailure | null): string =>
    String(continuityClause({ kind, providerSessionOpen: false, resumeFailure: failure }));

  assert.equal(clause('resume-refused', MISSING), 'The session was not found.');
  assert.equal(clause('resume-failed', FAILED), 'This may be temporary.');
  assert.equal(
    clause('resume-failed', { kind: 'error', detail: 'x', providerCode: 'local_lookup_failed' }),
    'This may be temporary.',
  );
  // The service adds nothing to an authentication rule's own words; neither does
  // the clause, so it is not called temporary.
  assert.equal(
    clause('resume-failed', { kind: 'error', detail: 'x', providerCode: 'authentication_refused' }),
    'Authentication was refused.',
  );
  assert.equal(
    clause('resume-refused', { kind: 'error', detail: 'x', providerCode: 'config_mismatch' }),
    'The session was recorded with other settings.',
  );
  assert.equal(
    clause('resume-refused', { kind: 'error', detail: 'x', providerCode: 'something_else' }),
    'The resume was refused.',
  );
  assert.equal(
    clause('resume-refused', { kind: 'unknown', detail: 'x', providerCode: 'local_record_missing_unaligned' }),
    'DSpatch could not check the session.',
  );
  assert.equal(
    clause('resume-refused', { kind: 'local-record-missing', detail: 'x', providerCode: 'local_record_missing' }),
    'No local record of the session was found.',
  );
  assert.equal(
    clause('resume-refused', { kind: 'unconfirmed-end', detail: 'x', providerCode: null }),
    'The last message has no confirmed end, so the session was not resumed.',
  );
  assert.equal(clause('resume-unavailable', FAILED), 'This adapter cannot resume sessions.');
  // No failure recorded at all while not open: the uncertainty is stated, not a loss.
  assert.equal(clause('resume-failed', null), 'DSpatch could not check the session.');

  // Niclas, 24 October 2026: never claim the session existed or disappeared when the
  // only evidence is that the provider does not find the ID - in any state, in the
  // clause or the whole body, whichever choices are offered.
  const kinds: readonly SessionContinuityKind[] = ['resume-refused', 'resume-failed', 'resume-unavailable'];
  const failures: readonly (ResumeFailure | null)[] = [
    MISSING,
    FAILED,
    null,
    { kind: 'unknown', detail: 'x', providerCode: null },
    { kind: 'local-record-missing', detail: 'x', providerCode: 'local_record_missing' },
    { kind: 'unconfirmed-end', detail: 'x', providerCode: null },
    { kind: 'error', detail: 'x', providerCode: 'config_mismatch' },
    { kind: 'error', detail: 'x', providerCode: 'authentication_refused' },
  ];
  for (const kind of kinds) {
    for (const failure of failures) {
      for (const choices of [RETRY_AND_NEW, NEW_ONLY]) {
        const body = String(
          continuityBody({ kind, providerSessionOpen: false, resumeFailure: failure, choices, savedMessageCount: 2 }),
        );
        assert.doesNotMatch(body, /no longer|missing|disappeared|existed|gone|lost/i, `${kind}/${failure?.kind ?? 'none'}: ${body}`);
        assert.ok(body.includes(STILL_AVAILABLE), body);
      }
    }
  }
});

test('the action sentence follows the offered choices and nothing else', () => {
  assert.equal(actionSentence(RETRY_AND_NEW), 'Try again, or start a new session.');
  assert.equal(actionSentence(['new-session', 'try-again']), 'Try again, or start a new session.');
  assert.equal(actionSentence(NEW_ONLY), 'Start a new session to continue.');
  assert.equal(actionSentence([]), null);
  assert.equal(
    continuityBody({ ...notOpen('resume-refused', MISSING), choices: [] }),
    `The session was not found. ${STILL_AVAILABLE}`,
    'no action is offered that the main process did not list',
  );
});

test('the earlier-sends sentence appears only when an earlier message has no confirmed end', () => {
  assert.equal(continuityPanel(notOpen('resume-refused', MISSING), false)?.earlierSendsNote, null);
  const some = continuityPanel(
    {
      ...notOpen('resume-refused', MISSING),
      earlierSendsMayHaveReached: [
        { attemptId: 'dsp-attempt-0003', label: 'a job left going', state: 'outcome-unknown', acknowledged: false },
      ],
    },
    false,
  );
  assert.equal(some?.earlierSendsNote, EARLIER_SENDS_NOTE);
  assert.equal(EARLIER_SENDS_NOTE, 'An earlier message may have reached the agent; nothing is resent.');
  assert.equal(
    earlierSendLine({ attemptId: 'a', label: 'b', state: 'waiting', acknowledged: false }),
    '"b" (a, waiting)',
  );
  assert.equal(
    earlierSendLine({ attemptId: 'a', label: 'b', state: 'cancel-requested', acknowledged: true }),
    '"b" (a, cancel-requested, acknowledged)',
  );
});

// --- Consequences and the composer --------------------------------------------

test('the running-command note is shown only while a command runs, naming only the offered choices', () => {
  assert.equal(
    runningCommandNote(true, RETRY_AND_NEW),
    'A running command is stopped by Try again or Start new session.',
  );
  assert.equal(runningCommandNote(true, NEW_ONLY), 'A running command is stopped by Start new session.');
  assert.equal(runningCommandNote(false, RETRY_AND_NEW), null);
  assert.equal(runningCommandNote(true, []), null);
  assert.equal(
    continuityPanel(notOpen('resume-refused', MISSING), true)?.runningCommandNote,
    'A running command is stopped by Try again or Start new session.',
  );
});

test('Enter is held back with a note that names the way forward', () => {
  assert.equal(noSessionRouteNote(notOpen('resume-refused', MISSING)), 'Try again or start a new session to send.');
  assert.equal(noSessionRouteNote(notOpen('resume-unavailable', FAILED, NEW_ONLY)), 'Start a new session to send.');
});

test('the composer status says there is no agent session rather than waiting for a message', () => {
  assert.equal(NO_SESSION_STATUS, 'No agent session — history only');
  assert.equal(composerStatus({ providerSessionOpen: false }, 'Waiting for your message.', false, false), NO_SESSION_STATUS);
  assert.equal(composerStatus({ providerSessionOpen: true }, 'Waiting for your message.', false, false), 'Waiting for your message.');
  assert.equal(composerStatus(null, 'No project open, so nothing is running.', false, false), 'No project open, so nothing is running.');
  // A loop run has sessions of its own; its line wins while it runs.
  assert.equal(composerStatus({ providerSessionOpen: false }, 'Step 2 of 4', true, false), 'Step 2 of 4');
});

test('with Use loop on, the status is not "history only": Enter starts a loop run then', () => {
  // DSP-121 review S3: a loop run opens sessions of its own, so the next press is not
  // held back and the status falls back to the activity text.
  assert.equal(composerStatus({ providerSessionOpen: false }, 'Waiting for your message.', false, true), 'Waiting for your message.');
  assert.equal(composerStatus({ providerSessionOpen: false }, 'Waiting for your message.', false, false), NO_SESSION_STATUS);
});

test('with no saved messages, nothing points at a history or promises a summary (DSP-121 review B1)', () => {
  // A project opened and closed before anything was sent is saved with its session and
  // no messages; if its resume is refused, there is no history to point at and a new
  // session gets no summary.
  const empty = { ...notOpen('resume-refused', MISSING), savedMessageCount: 0 };
  const panel = continuityPanel(empty, false);
  assert.equal(panel?.body, 'The session was not found. Try again, or start a new session.');
  assert.doesNotMatch(panel?.body ?? '', /saved conversation/);
  assert.equal(panel?.newSessionNote, null, 'no line promising a summary that will not exist');
  assert.deepEqual(panel?.choices.map((choice) => choice.label), ['Try again', 'Start new session']);
  assert.equal(
    continuityBody({ ...empty, choices: NEW_ONLY, kind: 'resume-unavailable', resumeFailure: FAILED }),
    'This adapter cannot resume sessions. Start a new session to continue.',
  );
  // One saved message is enough for both.
  const one = continuityPanel({ ...empty, savedMessageCount: 1 }, false);
  assert.match(one?.body ?? '', /Your saved conversation is still available\./);
  assert.equal(one?.newSessionNote, NEW_SESSION_AT_CHOICE);
});

// --- The new session, explained where it is made -------------------------------

test('a new session shows its summary until it is sent, and says so once it is removed', () => {
  const shown = newSessionView(fresh('SUMMARY TEXT'), NOTHING_DONE);
  assert.deepEqual(shown, {
    heading: 'New session. The agent does not have the earlier conversation.',
    summary: {
      text: 'SUMMARY TEXT',
      line: 'This summary will be sent with your next message.',
      toggle: 'Summary (12 characters)',
    },
    removedLine: null,
  });
  assert.equal(shown?.heading, NEW_SESSION_HEADING);
  assert.equal(shown?.summary?.line, SUMMARY_WILL_BE_SENT);

  // After the send the block goes; the turn shows what went with the message.
  assert.equal(newSessionView(fresh('SUMMARY TEXT'), { ...NOTHING_DONE, sentAnything: true }), null);

  // After `discardPendingRecap` the main process answers with `contextToResend` null.
  const removed = newSessionView(fresh(null), { ...NOTHING_DONE, recapDiscarded: true });
  assert.deepEqual(removed, { heading: NEW_SESSION_HEADING, summary: null, removedLine: SUMMARY_REMOVED });
  assert.equal(SUMMARY_REMOVED, 'Summary removed. Only your message will be sent.');
  assert.equal(newSessionView(fresh(null), { sentAnything: true, recapDiscarded: true }), null);

  // What is shown is what the main process holds: a summary it still holds is shown,
  // whatever the window believes it asked for, and no removal is claimed early.
  assert.equal(newSessionView(fresh('STILL HELD'), { ...NOTHING_DONE, recapDiscarded: true })?.summary?.text, 'STILL HELD');
});

test('a message that carried a summary says so in the block\'s words, the same live and read back', () => {
  assert.equal(
    sentWithSummaryLine(1920),
    'Sent in a new session with a summary of the earlier conversation (1920 characters).',
  );
  assert.doesNotMatch(sentWithSummaryLine(12), /recap|provider session/i);
});

test('no block for a first session, a resumed one, a new one with nothing to summarise, or no session', () => {
  assert.equal(newSessionView({ ...fresh(null), kind: 'first-session' }, NOTHING_DONE), null);
  assert.equal(newSessionView({ ...fresh('X'), kind: 'provider-session-resumed' }, NOTHING_DONE), null);
  assert.equal(newSessionView(fresh(null), NOTHING_DONE), null);
  assert.equal(newSessionView(notOpen('resume-refused', MISSING), NOTHING_DONE), null);
});

// --- Diagnostics, out of the conversation, complete and copyable ---------------

const HISTORY = {
  filePath: '/kit/userData/conversations/dsp-conv-1.json',
  savedAtUtc: '2026-10-24T13:30:54.912Z',
  messages: [{}, {}, {}] as never[],
  error: null,
};

test('the diagnostics carry every text the service produced, verbatim, and the storage metadata', () => {
  const continuity: SessionContinuity = {
    ...notOpen('resume-refused', {
      kind: 'provider-missing',
      detail: 'Presentation adapter: simulated refusal',
      providerCode: 'agent_not_found',
    }),
    earlierSendsMayHaveReached: [
      { attemptId: 'dsp-attempt-0003', label: 'a job left going', state: 'outcome-unknown', acknowledged: false },
    ],
  };
  const lines = conversationDiagnostics({
    continuity,
    context: {
      statement: 'The one call DSpatch made was the resume attempt.',
      workingDirectorySent: '/kit/projects/A',
      modelSent: 'claude-haiku-4-5',
      toolPolicySent: 'provider-default',
    },
    adapterId: 'presentation-local',
    history: HISTORY,
    simulation: SIMULATION_NOTICE,
  });
  assert.deepEqual(
    lines.map((line) => [line.key, line.label, line.value]),
    [
      ['simulated', 'Test mode', SIMULATION_NOTICE],
      ['statement', 'Session continuity', 'Statement for resume-refused. No new session was opened and nothing was sent.'],
      ['failure-detail', 'Failure detail', 'Presentation adapter: simulated refusal'],
      ['provider-code', 'Provider code', 'agent_not_found'],
      ['attempted-session', 'Attempted session', 'dsp-session-1'],
      ['adapter', 'Adapter', 'presentation-local'],
      ['context-statement', 'What DSpatch sent', 'The one call DSpatch made was the resume attempt.'],
      ['working-directory', 'Working directory', '/kit/projects/A'],
      ['model', 'Model', 'claude-haiku-4-5'],
      ['tool-policy', 'Tool policy', 'provider-default'],
      ['context-note', 'What is resent', 'Nothing was resent and nothing will be: no provider session is open.'],
      ['earlier-send-0', 'Earlier message with no confirmed end', '"a job left going" (dsp-attempt-0003, outcome-unknown)'],
      ['conversation-file', 'Conversation file', '/kit/userData/conversations/dsp-conv-1.json'],
      ['saved-at', 'File saved at', '2026-10-24T13:30:54.912Z'],
      ['messages-read', 'Messages read back', '3'],
    ],
  );
  // The copy is exactly what is shown: one `Label: value` per line, in the same order.
  const text = diagnosticsText(lines);
  assert.equal(text.split('\n').length, lines.length);
  assert.equal(text.split('\n')[3], 'Provider code: agent_not_found');
  assert.equal(text, lines.map((line) => `${line.label}: ${line.value}`).join('\n'));
  // The history introduction's sentence is gone everywhere, diagnostics included.
  assert.doesNotMatch(text, /This is what was written down/);
  // Unique keys, so no `data-ev` name is drawn twice.
  assert.equal(new Set(lines.map((line) => line.key)).size, lines.length);
});

test('the diagnostics cover every state, and say only what applies', () => {
  const resumed: SessionContinuity = {
    ...fresh(null),
    kind: 'provider-session-resumed',
    statement: 'The provider session dsp-session-1 was resumed by the presentation-local adapter.',
  };
  const lines = conversationDiagnostics({
    continuity: resumed,
    context: {
      statement: 'DSpatch sent the agent this working directory path.',
      workingDirectorySent: '/work/project',
      modelSent: 'composer-2',
      toolPolicySent: 'provider-default',
    },
    adapterId: 'cursor-sdk',
    history: { filePath: null, savedAtUtc: null, messages: [], error: 'The file could not be read.' },
    // A presentation run whose session is open again: the simulation line is about a
    // refusal or failure, and there is none on screen.
    simulation: SIMULATION_NOTICE,
  });
  const keys = lines.map((line) => line.key);
  assert.deepEqual(keys, [
    'statement',
    'attempted-session',
    'adapter',
    'context-statement',
    'working-directory',
    'model',
    'tool-policy',
    'context-note',
    'conversation-file',
    'messages-read',
    'history-error',
  ]);
  assert.equal(lines[0]?.value, resumed.statement);
  assert.equal(lines.find((line) => line.key === 'conversation-file')?.value, 'not saved by this build');
  assert.equal(lines.find((line) => line.key === 'messages-read')?.value, '0');
  // A new session's long statement lives here now, not under the summary.
  const newLines = conversationDiagnostics({
    continuity: fresh('SUMMARY'),
    context: { statement: 'x', workingDirectorySent: 'y', modelSent: 'z', toolPolicySent: 'w' },
    adapterId: 'presentation-local',
    history: HISTORY,
    simulation: null,
  });
  assert.equal(newLines[0]?.value, 'This is a new provider session, opened because you asked for one.');
  assert.ok(!newLines.some((line) => line.value === 'SUMMARY'), 'the summary itself is in the block, not here');
});

// --- Unchanged rules ---------------------------------------------------------------

test('the provider session fact says when the session is on record but not open', () => {
  assert.equal(providerSessionFact('agent-1', true), 'agent-1');
  assert.equal(providerSessionFact('agent-1', false), 'agent-1 (on record, not open)');
});

test('DSP-121 SIMULATED: the short test-mode label for the panel, the full sentence for the diagnostics', () => {
  assert.equal(SIMULATION_LABEL, 'Test mode — no provider calls');
  assert.equal(
    SIMULATION_NOTICE,
    'Presentation mode: this refusal or failure is simulated by the presentation adapter ' +
      'on this machine; no provider was asked anything.',
  );
  for (const mode of ['refused', 'failed', 'refused-once'] as const) {
    assert.equal(simulationLabel({ resumeMode: mode }), SIMULATION_LABEL, mode);
    assert.equal(simulationNotice({ resumeMode: mode }), SIMULATION_NOTICE, mode);
  }
  // An ordinary launch has no plan; a plan that asked for no simulation gets nothing.
  for (const plan of [null, undefined, {}, { resumeMode: 'ok' as const }]) {
    assert.equal(simulationLabel(plan), null);
    assert.equal(simulationNotice(plan), null);
  }
});

test('the heading is the same in every state without an open session', () => {
  for (const kind of ['resume-refused', 'resume-failed', 'resume-unavailable'] as const) {
    assert.equal(continuityPanel(notOpen(kind, FAILED), false)?.heading, CONTINUITY_HEADING);
  }
});
