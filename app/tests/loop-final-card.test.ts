/**
 * DSP-209 S22 (R5): the final run card, built from the record and the journal only.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildFinalRunCard,
  ENDED_NOT_PAUSED,
  MISSION_STATUS_NOT_TRACKED,
  NONE_REQUIRED,
  NOT_RECORDED,
  REVIEW_IS_NOT_APPROVAL,
  SUB_GOALS_NOT_DECLARED,
  type FinalCardRecord,
} from '../src/shared/loop-final-card';
import { serialiseRecordLine, type RecordedRunEnding, type RunRecordIdentity } from '../src/shared/loop-record';
import type { RunJournalEntry, RunStatus } from '../src/shared/loop-run';
import { loopTurnsAfter, loopTurnsFromRecordText } from '../src/shared/loop-transcript';

const RUN = 'chat-loop-2026-11-14T10-00-00-000Z';

let seq = 0;
function entry(kind: RunJournalEntry['kind'], parts: Partial<RunJournalEntry> = {}): RunJournalEntry {
  seq += 1;
  return { seq, atIso: '2026-11-14T10:00:00.000Z', sinceStartMs: seq * 1000, kind, detail: `${kind} line`, ...parts };
}

function ending(status: RunStatus | null, parts: Partial<RecordedRunEnding> = {}): RecordedRunEnding {
  return {
    endedAtUtc: '2026-11-14T10:05:00.000Z',
    kind: 'finished',
    status,
    terminalNodeId: null,
    outcome: 'unresolved',
    outcomeText: 'outcome text',
    modelRequested: 'opus',
    modelReported: null,
    commands: [],
    snapshots: { beforeId: null, beforeFileCount: 0, afterId: null, afterFileCount: 0, changed: [], added: [], removed: [], truncated: null },
    note: 'workspace note',
    cancelled: false,
    cost: 'unknown',
    ...parts,
  };
}

function record(end: RecordedRunEnding | null): FinalCardRecord {
  return { runId: RUN, mandate: 'Implement that.', ending: end };
}

function started(): RunJournalEntry {
  seq = 0;
  return entry('run-started');
}

function step(nodeId: string, label: string): RunJournalEntry {
  return entry('node-entered', { nodeId, data: { kind: 'agent', occurrence: 1, label } });
}

function ended(status: RunStatus, calls = 1): RunJournalEntry {
  return entry(status === 'refused' ? 'refused' : 'run-ended', { data: { status, calls, providerTurns: calls, reworkRounds: 0 } });
}

describe('the final run card: one test per ending', () => {
  it('completed: the terminal label and ending, and its purpose quoted as the next action', () => {
    const journal = [
      started(),
      step('work', 'Do the work'),
      entry('node-entered', { nodeId: 'done', data: { kind: 'terminal', occurrence: 1, label: 'Done, awaits review' } }),
      ended('completed'),
    ];
    const card = buildFinalRunCard(
      record(ending('completed', { terminalNodeId: 'done', terminalEnding: 'success', terminalPurpose: 'Niclas reviews the change.' })),
      journal,
      null,
    );
    assert.equal(card.status, 'completed');
    assert.match(card.reason, /“Done, awaits review” \(ending: success\)/);
    assert.equal(card.nextAction, 'The drawing says of this ending: “Niclas reviews the change.”');
    assert.equal(card.nextActionSource, 'terminal-purpose');
    assert.equal(card.assignment, 'Implement that.');
    assert.equal(card.subGoals, SUB_GOALS_NOT_DECLARED);
    assert.deepEqual(card.distinctions, [MISSION_STATUS_NOT_TRACKED, REVIEW_IS_NOT_APPROVAL, ENDED_NOT_PAUSED]);
  });

  it('completed at a terminal without a purpose: none required, nothing inferred from its name', () => {
    const journal = [started(), entry('node-entered', { nodeId: 'blocked', data: { kind: 'terminal', label: 'Blocked' } }), ended('completed')];
    const card = buildFinalRunCard(record(ending('completed', { terminalNodeId: 'blocked', terminalPurpose: null })), journal, null);
    assert.equal(card.nextAction, NONE_REQUIRED);
    assert.equal(card.nextActionSource, 'none');
    // A record written before the purpose was kept says so rather than claiming none.
    const older = buildFinalRunCard(record(ending('completed', { terminalNodeId: 'blocked' })), journal, null);
    assert.match(older.nextAction, /^None required\. .*not recorded/);
  });

  it('waiting for a person: the human step’s question', () => {
    const journal = [started(), step('ask', 'Ask Niclas'), entry('awaiting-human', { nodeId: 'ask', data: { question: 'Which provider?' } }), ended('awaiting-human')];
    const card = buildFinalRunCard(record(ending('awaiting-human')), journal, null);
    assert.equal(card.status, 'waiting-for-person');
    assert.equal(card.nextAction, 'Answer: “Which provider?”');
    assert.equal(card.nextActionSource, 'human-question');
  });

  it('handed over: the step’s reason and what became of the handover turn', () => {
    const journal = [
      started(),
      step('work', 'Do the work'),
      entry('handoff-requested', { nodeId: 'work', data: { reason: 'small change' } }),
      ended('handed-over'),
    ];
    const card = buildFinalRunCard(record(ending('handed-over', { handover: { turn: 'queued', note: null } })), journal, null);
    assert.equal(card.status, 'handed-over');
    assert.match(card.reason, /“small change”/);
    assert.match(card.nextAction, /queued/);
  });

  it('limit spent: the runner’s words about the bound', () => {
    const journal = [started(), step('work', 'Do the work'), entry('limit-reached', { detail: 'maxCalls 3 reached.', data: { bound: 'maxCalls' } }), ended('limit-reached')];
    const card = buildFinalRunCard(record(ending('limit-reached')), journal, null);
    assert.equal(card.status, 'limit-reached');
    assert.equal(card.reason, 'maxCalls 3 reached.');
    assert.match(card.nextAction, /new run/);
  });

  it('cancelled: none required', () => {
    const journal = [started(), step('work', 'Do the work'), ended('completed')];
    const card = buildFinalRunCard(record(ending('completed', { kind: 'cancelled', cancelled: true })), journal, null);
    assert.equal(card.status, 'cancelled');
    assert.equal(card.nextAction, NONE_REQUIRED);
  });

  it('runtime fault: the reconcile guidance, kept apart from the detail', () => {
    const journal = [started(), step('work', 'Do the work'), entry('runtime-fault', { nodeId: 'work', detail: 'It timed out. Reconcile it.' }), ended('runtime-fault')];
    const card = buildFinalRunCard(
      record(ending('runtime-fault', { fault: { kind: 'step-timed-out', detail: 'It timed out.', reconcile: 'Reconcile it.' } })),
      journal,
      null,
    );
    assert.equal(card.status, 'runtime-fault');
    assert.equal(card.reason, 'It timed out.');
    assert.equal(card.nextAction, 'Reconcile it.');
    assert.equal(card.nextActionSource, 'fault-reconcile');
    // An older record: the journal's joined line stands in for the guidance.
    const older = buildFinalRunCard(record(ending('runtime-fault')), journal, null);
    assert.equal(older.nextAction, 'It timed out. Reconcile it.');
  });

  it('refused: the runner’s refusal', () => {
    const journal = [started(), entry('refused', { detail: 'The graph has no entry.', data: { status: 'refused' } })];
    const card = buildFinalRunCard(record(ending('refused')), journal, null);
    assert.equal(card.status, 'refused');
    assert.equal(card.reason, 'The graph has no entry.');
    const before = buildFinalRunCard({ ...record(null), beforeRecord: { status: 'refused', text: 'Model not listed.' } }, [], null);
    assert.equal(before.status, 'refused');
    assert.equal(before.reason, 'Model not listed.');
  });

  it('could not run: the call failed with no runner result', () => {
    const card = buildFinalRunCard(record(ending(null, { kind: 'failed', note: 'The loop could not be run: boom' })), [started()], null);
    assert.equal(card.status, 'failed');
    assert.match(card.reason, /boom/);
  });

  it('interrupted only when the host is not running it; running when it is', () => {
    const journal = [started(), step('work', 'Do the work')];
    const interrupted = buildFinalRunCard(record(null), journal, null);
    assert.equal(interrupted.status, 'interrupted');
    assert.equal(buildFinalRunCard(record(null), journal, 'another-run').status, 'interrupted');
    const running = buildFinalRunCard(record(null), journal, RUN);
    assert.equal(running.status, 'running');
    assert.ok(!running.distinctions.includes(ENDED_NOT_PAUSED));
  });
});

describe('the final run card: counters, models and commits', () => {
  it('counts a fan-out visit once and each branch once', () => {
    const journal = [
      started(),
      step('slicer', 'Slice'),
      step('branches', 'Implement the slices'),
      entry('branch-started', { nodeId: 'branches', data: { sliceId: 'a' } }),
      entry('branch-started', { nodeId: 'branches', data: { sliceId: 'b' } }),
      entry('branch-ended', { nodeId: 'branches', data: { sliceId: 'a', ending: 'finished' } }),
      entry('branch-ended', { nodeId: 'branches', data: { sliceId: 'b', ending: 'finished' } }),
      ended('completed', 2),
    ];
    const card = buildFinalRunCard(record(ending('completed')), journal, null);
    const value = (label: string): string | undefined => card.counters.find((line) => line.label.startsWith(label))?.value;
    assert.equal(value('Agent steps'), '2');
    assert.equal(value('Parallel branches'), '2');
    assert.equal(value('Provider API calls'), 'unknown');
    assert.equal(value('Tool calls'), 'not recorded');
    assert.equal(value('Cost'), 'not reported by the provider');
    // No step is labelled integrator.
    assert.ok(card.stepOutcomes.every((line) => !/integrator/i.test(line)));
  });

  it('reads an older record’s commits as not recorded, and an old policy word as no model', () => {
    const journal = [started(), entry('node-entered', { nodeId: 'work', data: { kind: 'agent', model: 'inherit' } }), ended('completed')];
    const card = buildFinalRunCard(record(ending('completed')), journal, null);
    assert.deepEqual(card.commits, [NOT_RECORDED]);
    assert.deepEqual(card.models, ['unknown']);
  });

  it('shows the model S19 recorded, and the commits with local and pushed kept apart', () => {
    const journal = [
      started(),
      entry('node-entered', {
        nodeId: 'implement',
        data: { kind: 'agent', model: 'claude-haiku', modelProvider: 'claude', modelOption: 'small', modelReason: 'one file', modelSource: 'policy' },
      }),
      ended('completed'),
    ];
    const card = buildFinalRunCard(
      record(
        ending('completed', {
          commits: {
            folder: 'C:/repo',
            startHead: 'a'.repeat(40),
            endHead: 'c'.repeat(40),
            branch: 'main',
            commits: [
              { sha: 'c'.repeat(40), subject: 'second', onUpstream: false },
              { sha: 'b'.repeat(40), subject: 'first', onUpstream: true },
            ],
            notListed: 0,
            upstream: { name: 'origin/main', ahead: 1, behind: 0 },
            note: null,
          },
        }),
      ),
      journal,
      null,
    );
    assert.deepEqual(card.models, ['implement: claude claude-haiku, option “small”, chosen by policy (one file)']);
    assert.ok(card.commits.includes('ccccccc second — local only'));
    assert.ok(card.commits.includes('bbbbbbb first — on the upstream'));
    assert.ok(card.commits.some((line) => line.startsWith('Upstream origin/main: 1 ahead, 0 behind')));
  });
});

describe('the final run card in the conversation', () => {
  const identity: RunRecordIdentity = {
    runId: RUN,
    projectPath: 'C:/repo',
    conversationId: 'conv-1',
    mandate: 'Implement that.',
    graphId: 'g',
    graphPath: 'g.graph.json',
    graphVersionId: 'graph-0',
    modelRequested: 'opus',
    appVersion: '1.0.0',
    startedAtUtc: '2026-11-14T10:00:00.000Z',
  };
  const header = serialiseRecordLine({ line: 'header', formatVersion: 1, identity });
  const journal = [started(), step('work', 'Do the work')];
  const journalText = journal.map((line) => serialiseRecordLine({ line: 'journal', entry: line })).join('');

  it('leaves one card when the conversation is reopened', () => {
    const text = header + journalText + serialiseRecordLine({ line: 'ending', ending: ending('completed') });
    let turns = loopTurnsAfter([], { kind: 'records-restored', turns: loopTurnsFromRecordText(text) });
    turns = loopTurnsAfter(turns, { kind: 'records-restored', turns: loopTurnsFromRecordText(text) });
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.finalCard?.status, 'completed');
  });

  it('reads a record without an ending as running while the host runs it, and interrupted otherwise', async () => {
    const { parseRunRecord } = await import('../src/shared/loop-record');
    const { loopTurnsFromRecords } = await import('../src/shared/loop-transcript');
    const parsed = parseRunRecord(header + journalText);
    const live = loopTurnsFromRecords([{ record: parsed, error: null }], { liveRunId: RUN });
    assert.equal(live[0]?.finalCard?.status, 'running');
    assert.equal(live[0]?.ending, null);
    const gone = loopTurnsFromRecords([{ record: parsed, error: null }]);
    assert.equal(gone[0]?.finalCard?.status, 'interrupted');
    assert.equal(gone[0]?.ending?.kind, 'interrupted');
  });
});
