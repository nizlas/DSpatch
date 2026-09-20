/**
 * The superseded-run guard, and a negative control for it.
 *
 * AC#4 requires that late events cannot affect the wrong conversation. That is
 * not a hypothetical requirement: DSP-1 measured a turn that kept producing tool
 * calls for 69.5 s after DSpatch had stopped listening, and `cancel()` resolving
 * in single-digit milliseconds means the terminal state is decided locally, so a
 * cancelled turn can stay without a terminal event indefinitely.
 *
 * A guard that cannot fail is not evidence. The second test here reconstructs the
 * rule this module replaces — fold by run ID, with no notion of a current run —
 * and shows that the same event sequence contaminates the conversation under it.
 * That is what makes the first test a counter-example rather than an assertion
 * that happens to pass.
 *
 *     node --test tests/turn-routing.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { UiAgentEvent } from '../src/shared/bridge.ts';
import {
  attachUsage,
  currentTurn,
  describeActivity,
  emptyChatState,
  markCancelRequested,
  routeEvent,
  summariseContext,
  unfinishedSupersededTurns,
} from '../src/renderer/turn-routing.ts';

const SESSION = 'dsp-session-1';
const RUN_A = 'dsp-run-a';
const RUN_B = 'dsp-run-b';

let clock = 0;

function at(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 8, 14, 21, 0, clock)).toISOString();
}

function event(
  type: UiAgentEvent['type'],
  dspatchRunId: string,
  extra: Partial<UiAgentEvent> = {},
): UiAgentEvent {
  return {
    type,
    dspatchSessionId: SESSION,
    dspatchRunId,
    at: at(),
    ...extra,
  } as UiAgentEvent;
}

/** A: streams, is cancelled, never reports an end. B: the follow-up. */
function supersededSequence(): readonly UiAgentEvent[] {
  return [
    event('run.started', RUN_A),
    event('assistant.delta', RUN_A, { text: 'counting: one' }),
    event('tool.started', RUN_A, { toolName: 'Write' }),
    event('tool.finished', RUN_A, { toolName: 'Write', toolStatus: 'ok' }),
    // Cancel is pressed here. No `run.finished` ever arrives for A: this is the
    // observed case, not a contrived one.
    event('run.started', RUN_B),
    event('assistant.delta', RUN_B, { text: 'the token is' }),
    // A keeps going on the provider's side.
    event('assistant.delta', RUN_A, { text: ' two three four' }),
    event('tool.started', RUN_A, { toolName: 'Write' }),
    event('run.finished', RUN_A, { status: 'finished' }),
    event('assistant.delta', RUN_B, { text: ' KPXQ' }),
    event('run.finished', RUN_B, { status: 'finished' }),
  ];
}

// --- The guard --------------------------------------------------------------

test('late events from a superseded run are dropped, not applied', () => {
  let state = emptyChatState(SESSION);
  for (const [index, next] of supersededSequence().entries()) {
    if (index === 4) {
      state = markCancelRequested(state);
    }
    state = routeEvent(state, next, index === 0 ? 'count to twenty' : 'what was the token?');
  }

  const [turnA, turnB] = state.turns;
  assert.ok(turnA !== undefined && turnB !== undefined);

  // The follow-up carries only its own text.
  assert.equal(turnB.answer, 'the token is KPXQ');
  assert.equal(turnB.status, 'finished');
  assert.equal(currentTurn(state)?.dspatchRunId, RUN_B);

  // The superseded turn is frozen where DSpatch stopped applying its events.
  assert.equal(turnA.answer, 'counting: one');
  assert.equal(turnA.superseded, true);
  assert.equal(turnA.cancelRequested, true);
  assert.equal(turnA.status, 'streaming');

  // Nothing was dropped silently: three late events, named by type.
  assert.equal(turnA.lateEventsDropped, 3);
  assert.deepEqual(turnA.lateEventTypes, {
    'assistant.delta': 1,
    'tool.started': 1,
    'run.finished': 1,
  });
  assert.equal(state.droppedCount, 3);
  assert.equal(
    state.droppedEvents.every((dropped) => dropped.reason === 'superseded-run'),
    true,
  );

  // And the run that never reported an end stays visible as unresolved.
  assert.equal(unfinishedSupersededTurns(state).length, 1);
  assert.equal(describeActivity(state).unresolvedRuns, 1);
});

test('the unguarded rule this replaces contaminates the conversation', () => {
  // A reconstruction of the fold in `App.tsx` before this module existed: append
  // on `run.started`, otherwise apply to whichever turn carries the run ID, with
  // no notion of a current run. Kept here only as the negative control.
  interface OldTurn {
    runId: string;
    answer: string;
    status: string;
  }
  let turns: OldTurn[] = [];
  for (const next of supersededSequence()) {
    if (next.type === 'run.started') {
      turns = [...turns, { runId: next.dspatchRunId, answer: '', status: 'streaming' }];
      continue;
    }
    turns = turns.map((turn) => {
      if (turn.runId !== next.dspatchRunId) {
        return turn;
      }
      if (next.type === 'assistant.delta') {
        return { ...turn, answer: turn.answer + (next.text ?? '') };
      }
      if (next.type === 'run.finished') {
        return { ...turn, status: next.status === 'finished' ? 'finished' : 'error' };
      }
      return turn;
    });
  }

  const oldA = turns[0];
  assert.ok(oldA !== undefined);
  // The superseded run's later text landed in the transcript.
  assert.equal(oldA.answer, 'counting: one two three four');

  // Worse, `App.tsx` chose the active turn as the first one still streaming, and
  // for most of the sequence that is A rather than B. So the element the window
  // presents as the live answer is fed by a run the user cancelled — which is
  // precisely what AC#4 forbids. Sampled just before B's first delta:
  let sampled: OldTurn[] = [];
  for (const next of supersededSequence().slice(0, 5)) {
    if (next.type === 'run.started') {
      sampled = [...sampled, { runId: next.dspatchRunId, answer: '', status: 'streaming' }];
      continue;
    }
    sampled = sampled.map((turn) =>
      turn.runId === next.dspatchRunId && next.type === 'assistant.delta'
        ? { ...turn, answer: turn.answer + (next.text ?? '') }
        : turn,
    );
  }
  const oldActive = sampled.find((turn) => turn.status === 'streaming');
  assert.equal(oldActive?.runId, RUN_A, 'the old rule treats A as the live turn');
  assert.notEqual(oldActive?.runId, RUN_B);
});

test('events for another session are dropped', () => {
  let state = emptyChatState(SESSION);
  state = routeEvent(state, event('run.started', RUN_A), 'hello');
  const foreign: UiAgentEvent = {
    type: 'assistant.delta',
    dspatchSessionId: 'dsp-session-2',
    dspatchRunId: RUN_A,
    at: at(),
    text: 'from another working copy',
  };
  const after = routeEvent(state, foreign, 'hello');
  assert.equal(after.turns[0]?.answer, '');
  assert.equal(after.droppedCount, 1);
  assert.equal(after.droppedEvents[0]?.reason, 'other-session');
});

test('an event for an unknown run is dropped', () => {
  const state = routeEvent(
    emptyChatState(SESSION),
    event('assistant.delta', 'dsp-run-never-seen', { text: 'orphan' }),
    '',
  );
  assert.equal(state.turns.length, 0);
  assert.equal(state.droppedEvents[0]?.reason, 'unknown-run');
});

test('a repeated run.started does not create a second turn', () => {
  let state = routeEvent(emptyChatState(SESSION), event('run.started', RUN_A), 'hi');
  state = routeEvent(state, event('run.started', RUN_A), 'hi');
  assert.equal(state.turns.length, 1);
  assert.equal(state.droppedEvents[0]?.reason, 'duplicate-run-started');
});

test('no session open: every event is dropped', () => {
  const state = routeEvent(emptyChatState(null), event('run.started', RUN_A), 'hi');
  assert.equal(state.turns.length, 0);
  assert.equal(state.droppedEvents[0]?.reason, 'other-session');
});

// --- The ordinary path still works -----------------------------------------

test('deltas accumulate, the final message replaces them, status is terminal', () => {
  let state = emptyChatState(SESSION);
  state = routeEvent(state, event('run.started', RUN_A), 'ask something');
  state = routeEvent(state, event('assistant.delta', RUN_A, { text: 'one ' }), '');
  state = routeEvent(state, event('assistant.delta', RUN_A, { text: 'two' }), '');
  assert.equal(state.turns[0]?.answer, 'one two');
  assert.equal(state.turns[0]?.deltaCount, 2);

  state = routeEvent(state, event('assistant.message', RUN_A, { text: 'one two' }), '');
  assert.equal(state.turns[0]?.answer, 'one two');

  state = routeEvent(state, event('run.finished', RUN_A, { status: 'cancelled' }), '');
  assert.equal(state.turns[0]?.status, 'cancelled');
  assert.notEqual(state.turns[0]?.finishedAtUtc, null);
  assert.equal(state.droppedCount, 0);
});

test('a follow-up in the same session keeps both turns and their own text', () => {
  let state = emptyChatState(SESSION);
  state = routeEvent(state, event('run.started', RUN_A), 'first');
  state = routeEvent(state, event('assistant.delta', RUN_A, { text: 'A' }), '');
  state = routeEvent(state, event('run.finished', RUN_A, { status: 'finished' }), '');
  state = routeEvent(state, event('run.started', RUN_B), 'second');
  state = routeEvent(state, event('assistant.delta', RUN_B, { text: 'B' }), '');
  state = routeEvent(state, event('run.finished', RUN_B, { status: 'finished' }), '');
  assert.deepEqual(
    state.turns.map((turn) => [turn.prompt, turn.answer, turn.status]),
    [
      ['first', 'A', 'finished'],
      ['second', 'B', 'finished'],
    ],
  );
  assert.equal(state.droppedCount, 0);
  assert.equal(unfinishedSupersededTurns(state).length, 0);
});

test('usage is attached by run id and may reach a superseded turn', () => {
  let state = emptyChatState(SESSION);
  state = routeEvent(state, event('run.started', RUN_A), 'first');
  state = routeEvent(state, event('run.started', RUN_B), 'second');
  state = attachUsage(state, RUN_A, { totalTokens: 1234, source: 'test' });
  assert.equal(state.turns[0]?.usage?.totalTokens, 1234);
  assert.equal(state.turns[1]?.usage, null);
});

// --- Activity and context ---------------------------------------------------

test('activity reads as waiting while waiting, and names the running tool', () => {
  assert.equal(describeActivity(emptyChatState(null)).kind, 'no-session');
  assert.equal(describeActivity(emptyChatState(SESSION)).kind, 'idle');

  let state = routeEvent(emptyChatState(SESSION), event('run.started', RUN_A), 'hi');
  assert.equal(describeActivity(state).kind, 'streaming');
  assert.match(describeActivity(state).text, /first text/);

  state = routeEvent(state, event('assistant.delta', RUN_A, { text: 'x' }), '');
  assert.match(describeActivity(state).text, /1 fragments/);

  state = routeEvent(state, event('tool.started', RUN_A, { toolName: 'Read' }), '');
  assert.equal(describeActivity(state).kind, 'tool');
  assert.match(describeActivity(state).text, /Read/);

  state = routeEvent(
    state,
    event('tool.finished', RUN_A, { toolName: 'Read', toolStatus: 'ok' }),
    '',
  );
  assert.equal(describeActivity(state).kind, 'streaming');

  state = markCancelRequested(state);
  assert.equal(describeActivity(state).kind, 'cancel-requested');
  assert.match(describeActivity(state).text, /has not reported an end/);

  state = routeEvent(state, event('run.finished', RUN_A, { status: 'cancelled' }), '');
  assert.equal(describeActivity(state).kind, 'idle');
});

test('the context summary counts what was sent, never what is on disk', () => {
  let state = emptyChatState(SESSION);
  state = routeEvent(state, event('run.started', RUN_A), 'twelve chars');
  state = routeEvent(state, event('tool.started', RUN_A, { toolName: 'Read' }), '');
  state = routeEvent(state, event('tool.started', RUN_A, { toolName: 'Read' }), '');
  state = routeEvent(state, event('tool.started', RUN_A, { toolName: 'Write' }), '');
  const summary = summariseContext(state);
  assert.equal(summary.promptsSent, 1);
  assert.equal(summary.promptCharactersSent, 'twelve chars'.length);
  assert.equal(summary.fileContentsSentByDspatch, 0);
  assert.equal(summary.toolCallsByAgent, 3);
  assert.deepEqual(summary.toolNames, ['Read', 'Write']);
});
