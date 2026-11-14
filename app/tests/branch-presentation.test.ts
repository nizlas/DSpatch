/**
 * DSP-209 S20: a fan-out's branches as visible text, on scripted journals. No runner, no window.
 *
 * What a person reads without hovering — the node's line and each branch's row — is plain text
 * from these functions, so asserting the text is asserting what is on screen with hover off.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BRANCH_MESSAGES_NOTE,
  branchAddressFromQuery,
  branchAddressQuery,
  branchOutputLines,
  branchRows,
  branchSummaryLine,
} from '../src/shared/branch-presentation';
import { foldBranchActivity, foldStepActivity, type StepActivity } from '../src/shared/loop-activity';
import type { JournalKind, RunJournalEntry } from '../src/shared/loop-run';
import { branchViewsFromJournal } from '../src/shared/run-presentation';

const RUN = 'run-1';
type Data = Record<string, string | number | boolean>;

function journal(lines: readonly [JournalKind, string | undefined, Data?][]): RunJournalEntry[] {
  return lines.map(([kind, nodeId, data], index) => ({
    seq: index + 1,
    atIso: '2026-11-14T10:00:00.000Z',
    sinceStartMs: index * 1000,
    kind,
    detail: kind,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(data === undefined ? {} : { data }),
  }));
}

const entered = (occurrence: number): [JournalKind, string, Data] => ['node-entered', 'fan', { kind: 'agent', occurrence, label: 'Fan' }];
const started = (occurrence: number, slice: string, extra: Data = {}): [JournalKind, string, Data] => [
  'branch-started',
  'fan',
  { instanceId: `fan#${String(occurrence)}/${slice}`, sliceId: slice, sessionId: `s-${slice}`, ...extra },
];
const ended = (occurrence: number, slice: string, ending: string): [JournalKind, string, Data] => [
  'branch-ended',
  'fan',
  { instanceId: `fan#${String(occurrence)}/${slice}`, sliceId: slice, ending },
];

describe('branches read without hovering (DSP-209 S20)', () => {
  it('writes the node line and every row as visible text, with the ending word kept', () => {
    const lines = journal([
      ['run-started', undefined, {}],
      entered(1),
      started(1, 'a', { task: 'Write the parser', model: 'opus', modelProvider: 'claude', modelReason: 'fixed by the step', modelSource: 'fixed' }),
      started(1, 'b'),
      ended(1, 'b', 'no-worktree'),
    ]);
    const views = branchViewsFromJournal(RUN, lines);
    assert.equal(branchSummaryLine(views, 'fan'), '2 branches · 1 working · 1 failed');
    const [a, b] = branchRows(views, 'fan');
    assert.equal(a?.task, 'Write the parser');
    assert.equal(a?.state, 'working');
    assert.equal(a?.model, 'opus on claude, fixed by the step');
    assert.equal(b?.task, 'not recorded');
    assert.equal(b?.state, 'failed: no-worktree', 'the journal’s ending word, not only "failed"');
    assert.equal(b?.model, 'the run’s model');
    assert.match(BRANCH_MESSAGES_NOTE, /delivered when the receiving branch next checks its messages/);
  });

  it('shows only the second visit’s branches as current, and marks the first as earlier', () => {
    const lines = journal([
      ['run-started', undefined, {}],
      entered(1),
      started(1, 'a'),
      ended(1, 'a', 'finished'),
      ['node-produced', 'fan', { product: 'success' }],
      ['edge-taken', 'fan', { from: 'fan', to: 'fan', reworkRound: true }],
      entered(2),
      started(2, 'a'),
      started(2, 'b'),
    ]);
    const views = branchViewsFromJournal(RUN, lines);
    assert.equal(branchSummaryLine(views, 'fan'), '2 branches · 2 working');
    const rows = branchRows(views, 'fan');
    assert.deepEqual(
      rows.map((row) => [row.visitLabel, row.sliceId, row.current]),
      [
        ['visit 2', 'a', true],
        ['visit 2', 'b', true],
        ['earlier visit (visit 1)', 'a', false],
      ],
    );
    // Before visit 2 has a branch line, the node says the count it shows is the earlier visit's.
    const between = branchViewsFromJournal(RUN, lines.slice(0, 7));
    assert.equal(branchSummaryLine(between, 'fan'), 'earlier visit: 1 branch · 1 finished');
  });

  it('never says delivered for a message that was not delivered', () => {
    const lines = journal([
      ['run-started', undefined, {}],
      entered(1),
      started(1, 'a'),
      started(1, 'b'),
      ['message-sent', 'fan', { from: 'a', to: 'b' }],
      ended(1, 'b', 'finished'),
      ['message-undelivered', 'fan', { from: 'a', to: 'b' }],
    ]);
    const rows = new Map(branchRows(branchViewsFromJournal(RUN, lines), 'fan').map((row) => [row.sliceId, row.messages]));
    assert.equal(rows.get('a'), '1 sent · 0 delivered to it · 0 acknowledged');
    assert.equal(rows.get('b'), '0 sent · 0 delivered to it · 0 acknowledged · 1 not delivered');
  });

  it('folds each branch’s live output apart, and keeps it out of the node’s own step', () => {
    const at = '2026-11-14T10:00:00.000Z';
    const base = { runId: RUN, nodeId: 'fan', occurrence: 1, atUtc: at };
    const events: StepActivity[] = [
      { ...base, sliceId: 'a', kind: 'step-started', roleId: null, roleSourcePath: null },
      { ...base, sliceId: 'b', kind: 'step-started', roleId: null, roleSourcePath: null },
      { ...base, sliceId: 'a', kind: 'reply-text', text: 'parsing' },
      { ...base, sliceId: 'b', kind: 'tool-started', callId: 't1', name: 'read', summary: 'Read src/b' },
    ];
    const branches = events.reduce(foldBranchActivity, []);
    assert.deepEqual(branches.map((branch) => [branch.sliceId, branch.text, branch.tools.length]), [
      ['a', 'parsing', 0],
      ['b', '', 1],
    ]);
    assert.equal(events.reduce(foldStepActivity, []).length, 0, 'a branch is not its node speaking');
    assert.deepEqual(branchOutputLines(branches[1] ?? null), ['… Read src/b', 'No reply text yet.']);
  });

  it('carries a branch address through a window’s query and back', () => {
    const address = { runId: 'chat-loop-1', nodeId: 'fan', occurrence: 2, sliceId: 's 1' };
    assert.deepEqual(branchAddressFromQuery(`window=branch&${branchAddressQuery(address)}`), address);
    assert.equal(branchAddressFromQuery('window=branch&runId=x&nodeId=fan&occurrence=0&sliceId=a'), null);
  });
});
