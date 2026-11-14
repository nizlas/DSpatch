/**
 * DSP-209 S16: the shared run-presentation model, on scripted journals. No runner, no provider.
 *
 * One test per acceptance criterion: an earlier visit's branches are not current, a rework
 * arrival is attempt 2, a fan-out is one step and two branch invocations, missing data is never
 * zero, and an undelivered message is never counted delivered. Plus the integrator found by
 * structure and a branch's task read from its slice.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { JournalKind, RunJournalEntry } from '../src/shared/loop-run';
import {
  branchViewsFromJournal,
  runCountersFrom,
  stepReportsFrom,
  visitsFromJournal,
} from '../src/shared/run-presentation';

const RUN = 'run-1';

type Line = [JournalKind, string | undefined, Record<string, string | number | boolean>?, string?];

function journal(lines: readonly Line[]): RunJournalEntry[] {
  return lines.map(([kind, nodeId, data, edgeId], index) => ({
    seq: index + 1,
    atIso: new Date(Date.UTC(2026, 10, 14, 9, 0, index)).toISOString(),
    sinceStartMs: index * 1000,
    kind,
    detail: kind,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(edgeId === undefined ? {} : { edgeId }),
    ...(data === undefined ? {} : { data }),
  }));
}

const entered = (id: string, occurrence: number, kind = 'agent', arrivedBy?: string): Line => [
  'node-entered',
  id,
  { kind, occurrence, callId: occurrence, label: id.toUpperCase(), ...(arrivedBy === undefined ? {} : { arrivedBy }) },
];
const edge = (id: string, from: string, to: string, extra: Record<string, string | number | boolean> = {}): Line => [
  'edge-taken',
  from,
  { from, to, reworkRound: false, declaredFailure: false, ...extra },
  id,
];
const branch = (kind: 'branch-started' | 'branch-ended', node: string, occurrence: number, slice: string, ending?: string): Line => [
  kind,
  node,
  {
    instanceId: `${node}#${String(occurrence)}/${slice}`,
    sliceId: slice,
    sessionId: `s-${node}-${String(occurrence)}-${slice}`,
    ...(ending === undefined ? {} : { ending }),
  },
];

/** plan → fan (a, b) → merge (delivers fan) → done. */
const FAN_OUT: readonly Line[] = [
  ['run-started', undefined, {}],
  entered('plan', 1),
  ['node-produced', 'plan', { product: 'success' }],
  edge('e1', 'plan', 'fan'),
  entered('fan', 1, 'agent', 'e1'),
  branch('branch-started', 'fan', 1, 'a'),
  branch('branch-started', 'fan', 1, 'b'),
  branch('branch-ended', 'fan', 1, 'a', 'finished'),
  branch('branch-ended', 'fan', 1, 'b', 'finished'),
  ['node-produced', 'fan', { product: 'success' }],
  edge('e2', 'fan', 'merge', { delivers: 'fan' }),
  entered('merge', 1, 'agent', 'e2'),
  ['node-produced', 'merge', { product: 'outcome', outcome: 'done', outcomeSource: 'step-declared' }],
  edge('e3', 'merge', 'end'),
  entered('end', 1, 'terminal', 'e3'),
  ['run-ended', undefined, { status: 'completed', calls: 4, providerTurns: 9, reworkRounds: 0 }],
];

describe('run presentation (DSP-209 S16)', () => {
  it('marks the branches of an earlier visit to a fan-out node as not current', () => {
    const lines = journal([
      ['run-started', undefined, {}],
      entered('fan', 1),
      branch('branch-started', 'fan', 1, 'a'),
      branch('branch-ended', 'fan', 1, 'a', 'finished'),
      ['node-produced', 'fan', { product: 'success' }],
      edge('back', 'fan', 'fan', { reworkRound: true }),
      entered('fan', 2, 'agent', 'back'),
      branch('branch-started', 'fan', 2, 'a'),
    ]);
    const branches = branchViewsFromJournal(RUN, lines);
    assert.deepEqual(
      branches.map((item) => [item.visit.occurrence, item.sliceId, item.state, item.current]),
      [
        [1, 'a', 'finished', false],
        [2, 'a', 'running', true],
      ],
    );
  });

  it('gives a rework arrival attempt 2 and isRework', () => {
    const lines = journal([
      ['run-started', undefined, {}],
      entered('impl', 1),
      edge('e1', 'impl', 'review'),
      entered('review', 1, 'agent', 'e1'),
      edge('rework', 'review', 'impl', { reworkRound: true }),
      entered('impl', 2, 'agent', 'rework'),
    ]);
    const impl = visitsFromJournal(RUN, lines).filter((visit) => visit.visit.nodeId === 'impl');
    assert.deepEqual(impl[0]?.visit, { runId: RUN, nodeId: 'impl', occurrence: 1, attempt: 1, arrivedByEdge: null, isRework: false });
    assert.deepEqual(impl[1]?.visit, { runId: RUN, nodeId: 'impl', occurrence: 2, attempt: 2, arrivedByEdge: 'rework', isRework: true });
  });

  it('counts a two-slice fan-out as one step and two branch invocations, with calls from run-ended', () => {
    const counters = runCountersFrom(journal(FAN_OUT));
    assert.equal(counters.steps, 3); // plan, fan (once), merge; the terminal is not a step
    assert.equal(counters.branchInvocations, 2);
    assert.equal(counters.calls, 4);
    assert.equal(counters.providerTurns, 9);
    assert.equal(counters.reworkRounds, 0);
    assert.equal(counters.elapsedMs, 15_000);
  });

  it('reads absent data as null or unknown, never 0', () => {
    const lines = journal([
      ['run-started', undefined, {}],
      entered('fan', 1),
      branch('branch-started', 'fan', 1, 'a'),
    ]);
    const counters = runCountersFrom(lines);
    assert.equal(counters.calls, null);
    assert.equal(counters.providerTurns, null);
    assert.equal(counters.providerApiCalls, 'unknown');
    assert.equal(counters.toolCalls, 'not recorded');
    assert.deepEqual(counters.elapsedMs, { atLeast: 2000 });
    const [only] = branchViewsFromJournal(RUN, lines);
    assert.equal(only?.task, null);
    assert.equal(only?.model, null);
    assert.equal(only?.ending, null);
  });

  it('never counts an undelivered message as delivered', () => {
    const lines = journal([
      ['run-started', undefined, {}],
      entered('fan', 1),
      branch('branch-started', 'fan', 1, 'a'),
      branch('branch-started', 'fan', 1, 'b'),
      ['message-sent', 'fan', { messageId: 'fan#1/m1', from: 'a', to: 'b', recipients: 'b' }],
      branch('branch-ended', 'fan', 1, 'b', 'finished'),
      ['message-undelivered', 'fan', { messageId: 'fan#1/m1', from: 'a', to: 'b' }],
    ]);
    const byId = new Map(branchViewsFromJournal(RUN, lines).map((item) => [item.sliceId, item.messages]));
    assert.deepEqual(byId.get('a'), { sent: 1, delivered: 0, acknowledged: 0, undelivered: 0 });
    assert.deepEqual(byId.get('b'), { sent: 0, delivered: 0, acknowledged: 0, undelivered: 1 });
  });

  it('names the integrator by the edge that delivers the fan-out, and reads branch tasks from slices', () => {
    const fence = '```';
    const slices = `${fence}dspatch-slices\n{"slices":[{"id":"a","result":"Write the parser","ownedPaths":["src/a"],"allowedActions":[],"contractRefs":[],"verification":"v"},{"id":"b","result":"Write the view","ownedPaths":["src/b"],"allowedActions":[],"contractRefs":[],"verification":"v"}]}\n${fence}`;
    const reports = stepReportsFrom({
      runId: RUN,
      journal: journal(FAN_OUT),
      replies: [{ nodeId: 'merge', occurrence: 1 }],
      slices: (visit) => (visit.nodeId === 'fan' ? { text: slices, isolation: 'worktree' } : null),
    });
    assert.deepEqual(
      reports.map((report) => [report.visit.nodeId, report.role, report.sliceId]),
      [
        ['plan', 'step', null],
        ['fan', 'step', null],
        ['fan', 'branch', 'a'],
        ['fan', 'branch', 'b'],
        ['merge', 'integrator', null],
      ],
    );
    const merge = reports.find((report) => report.role === 'integrator');
    assert.equal(merge?.declaredOutcome, 'done');
    assert.equal(merge?.replyIndex, 0);
    assert.equal(merge?.subGoal, null);
    const tasks = branchViewsFromJournal(RUN, journal(FAN_OUT), {
      slices: () => ({ text: slices, isolation: 'worktree' }),
    }).map((item) => item.task);
    assert.deepEqual(tasks, ['Write the parser', 'Write the view']);
    // While the fan-out is still going, a slice with no line yet is queued.
    const going = branchViewsFromJournal(RUN, journal(FAN_OUT.slice(0, 6)), {
      slices: () => ({ text: slices, isolation: 'worktree' }),
    }).map((item) => [item.sliceId, item.state]);
    assert.deepEqual(going, [
      ['a', 'running'],
      ['b', 'queued'],
    ]);
  });
});
