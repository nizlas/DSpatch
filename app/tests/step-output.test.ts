/**
 * A step's output opened from the graph (Niclas, 15 November 2026): which visit of which node,
 * whether it is still working, and what the run record saved for it — for an ordinary step,
 * a rework attempt and one fan-out branch, in a record written with and before `sliceId`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ParsedRunRecord, RecordedAgentReply, RecordedCommand } from '../src/shared/loop-record';
import type { RunJournalEntry } from '../src/shared/loop-run';
import {
  OPENING_FEED,
  RunViewCache,
  feedEvent,
  feedSeed,
  liveStateFor,
  nodeVisitRows,
  savedOutputLines,
  savedStepOutput,
  stepOutputFromQuery,
  stepOutputQuery,
  type StepOutputFeed,
} from '../src/shared/step-output';
import type { LiveRunAnnouncement, LoopRunEvent } from '../src/shared/loop-run-view';

let seq = 0;
const line = (kind: string, fields: Partial<RunJournalEntry> = {}): RunJournalEntry =>
  ({ seq: (seq += 1), atIso: '2026-11-14T22:17:42.000Z', sinceStartMs: seq, kind, detail: kind, ...fields }) as RunJournalEntry;
const entered = (nodeId: string, occurrence: number, label: string): RunJournalEntry =>
  line('node-entered', { nodeId, data: { occurrence, label, kind: 'agent' } });
const produced = (nodeId: string): RunJournalEntry => line('node-produced', { nodeId });
const edge = (id: string, to: string, rework = false): RunJournalEntry =>
  line('edge-taken', { edgeId: id, data: { to, ...(rework ? { reworkRound: true } : {}) } });

/** assess → implement → review, back to implement for rework, review again, still working. */
function journal(): readonly RunJournalEntry[] {
  seq = 0;
  return [
    entered('assess', 1, 'Assess'),
    produced('assess'),
    edge('a-single', 'implement'),
    entered('implement', 1, 'Implement'),
    produced('implement'),
    edge('i-done', 'review'),
    entered('review', 1, 'Review'),
    produced('review'),
    edge('r-rework', 'implement', true),
    entered('implement', 2, 'Implement'),
    produced('implement'),
    edge('i-done', 'review'),
    entered('review', 2, 'Review'),
  ];
}

const reply = (nodeId: string, occurrence: number, text: string, extra: Partial<RecordedAgentReply> = {}): RecordedAgentReply => ({
  atUtc: '2026-11-14T22:18:00.000Z',
  nodeId,
  nodeLabel: nodeId,
  occurrence,
  text,
  terminalStatus: 'finished',
  ...extra,
});
const command = (nodeId: string, occurrence: number, text: string): RecordedCommand =>
  ({ command: text, line: text, cwd: '.', exitCode: 0, signal: null, durationMs: 1, startedAtUtc: '', notRun: null, stdoutTail: '', stderrTail: '', truncatedOutput: null, snapshotAfterId: null, nodeId, occurrence }) as RecordedCommand;
const record = (replies: readonly RecordedAgentReply[], commands: readonly RecordedCommand[]): ParsedRunRecord =>
  ({ formatVersion: 1, identity: null, journal: [], replies, commands, ending: null, completeness: 'complete', truncatedLastLine: false, unreadableLines: 0, error: null, recovery: null, readOnly: false }) as ParsedRunRecord;

describe('a step visit, as the node panel lists it', () => {
  it('numbers visits and rework attempts, and knows which one is still working', () => {
    const rows = nodeVisitRows('run-1', journal(), 'implement', false);
    assert.deepEqual(rows.map((row) => [row.label, row.ended]), [['visit 1', true], ['visit 2 · attempt 2, rework', true]]);
    const review = nodeVisitRows('run-1', journal(), 'review', false);
    assert.deepEqual(review.map((row) => [row.label, row.ended]), [['visit 1', true], ['visit 2', false]]);
    // Once the run has ended, nothing is working.
    assert.equal(nodeVisitRows('run-1', journal(), 'review', true).at(-1)?.ended, true);
    // A node the run never reached has no visit to open.
    assert.deepEqual(nodeVisitRows('run-1', journal(), 'integrate', false), []);
  });
});

describe('a step’s saved output, from the run record', () => {
  const saved = record(
    [
      reply('implement', 1, 'first pass'),
      reply('implement', 2, 'second pass'),
      reply('work', 1, 'slice one, new record', { nodeLabel: 'Parts · s1', sliceId: 's1' }),
      reply('work', 1, 'slice two, old record', { nodeLabel: 'Parts · s2' }),
    ],
    [command('implement', 2, 'npm test'), command('implement', 1, 'ls'), command('review', 1, 'git diff')],
  );

  it('takes the reply and commands of exactly that visit', () => {
    const second = savedStepOutput(saved, { runId: 'run-1', nodeId: 'implement', occurrence: 2 });
    assert.deepEqual(second.replies.map((item) => item.text), ['second pass']);
    assert.deepEqual(second.commands.map((item) => item.command), ['npm test']);
    assert.deepEqual(savedOutputLines(second), ['$ npm test  (exit 0)', '', 'second pass']);
  });

  it('finds a branch by its slice, and by the label suffix in a record written before sliceId', () => {
    const one = savedStepOutput(saved, { runId: 'run-1', nodeId: 'work', occurrence: 1, sliceId: 's1' });
    const two = savedStepOutput(saved, { runId: 'run-1', nodeId: 'work', occurrence: 1, sliceId: 's2' });
    assert.deepEqual(one.replies.map((item) => item.text), ['slice one, new record']);
    assert.deepEqual(two.replies.map((item) => item.text), ['slice two, old record']);
    // Commands are not recorded per branch, and the window says so rather than guess.
    assert.deepEqual(one.commands, []);
    assert.ok(one.note !== null);
  });

  it('says when the record holds nothing for the step', () => {
    const none = savedStepOutput(saved, { runId: 'run-1', nodeId: 'assess', occurrence: 1 });
    assert.deepEqual(savedOutputLines(none), ['The run record holds no reply for this.']);
  });
});

describe('the window’s address and live state', () => {
  it('carries a step or a branch, and the conversation, through the query and back', () => {
    const step = { runId: 'run-1', nodeId: 'review', occurrence: 2, conversationId: 'conv-1' };
    assert.deepEqual(stepOutputFromQuery(`window=branch&${stepOutputQuery(step)}`), step);
    const branch = { runId: 'run-1', nodeId: 'work', occurrence: 1, sliceId: 's2' };
    assert.deepEqual(stepOutputFromQuery(stepOutputQuery(branch)), branch);
    assert.equal(stepOutputFromQuery('runId=run-1&nodeId=review'), null);
  });

  it('follows the step, or the one branch, the address names', () => {
    const base = { roleId: null, roleSourcePath: null, startedAtUtc: '', lastEventAtUtc: null, tools: [], awaitingApproval: null, finished: false };
    const steps = [{ ...base, runId: 'run-1', nodeId: 'review', occurrence: 2, text: 'checking' }];
    const branches = [
      { ...base, runId: 'run-1', nodeId: 'work', occurrence: 1, sliceId: 's1', text: 'one' },
      { ...base, runId: 'run-1', nodeId: 'work', occurrence: 1, sliceId: 's2', text: 'two' },
    ];
    assert.equal(liveStateFor(steps, branches, { runId: 'run-1', nodeId: 'review', occurrence: 2 })?.text, 'checking');
    assert.equal(liveStateFor(steps, branches, { runId: 'run-1', nodeId: 'review', occurrence: 1 }), null);
    assert.equal(liveStateFor(steps, branches, { runId: 'run-1', nodeId: 'work', occurrence: 1, sliceId: 's2' })?.text, 'two');
    assert.equal(liveStateFor(steps, branches, { runId: 'run-2', nodeId: 'work', occurrence: 1, sliceId: 's2' }), null);
  });
});

describe('the step output window follows a run it opened on (Niclas, 15 November 2026)', () => {
  const run = { runId: 'run-7', graphVersionId: 'graph-v1', graphId: 'g', graphName: 'G', binding: 'chat-loop', graphText: '{}', startedAtUtc: '', phase: 'running', conversationId: 'conv-1' } as LiveRunAnnouncement;
  const at = (n: number): string => `2026-11-15T08:55:${String(10 + n).padStart(2, '0')}.000Z`;
  const activity = (occurrence: number, n: number, body: Record<string, unknown>): LoopRunEvent =>
    ({ kind: 'activity', runId: 'run-7', graphVersionId: 'graph-v1', activity: { runId: 'run-7', nodeId: 'review', occurrence, atUtc: at(n), ...body } }) as LoopRunEvent;
  const started = (occurrence: number, n: number): LoopRunEvent => activity(occurrence, n, { kind: 'step-started', roleId: 'review', roleSourcePath: null });
  const text = (occurrence: number, n: number, fragment: string): LoopRunEvent => activity(occurrence, n, { kind: 'reply-text', text: fragment });
  const step = (feed: StepOutputFeed, occurrence: number) =>
    liveStateFor(feed.view?.steps, feed.view?.branchSteps, { runId: 'run-7', nodeId: 'review', occurrence });

  it('keeps every run it relays, also once the Ready offer has replaced it on the host', () => {
    const cache = new RunViewCache(2);
    cache.receive({ kind: 'started', run });
    cache.receive(started(1, 0));
    cache.receive(text(1, 1, 'Checking '));
    cache.receive(text(1, 2, 'the diff.'));
    cache.receive({ kind: 'ended', runId: 'run-7', graphVersionId: 'graph-v1', status: null, note: '', terminalNodeId: 'done' } as LoopRunEvent);
    cache.receive({ kind: 'started', run: { ...run, runId: 'ready-1', phase: 'ready' } });
    const kept = cache.get('run-7');
    assert.equal(kept?.ended, true);
    assert.equal(liveStateFor(kept?.steps, kept?.branchSteps, { runId: 'run-7', nodeId: 'review', occurrence: 1 })?.text, 'Checking the diff.');
    assert.equal(cache.get('ready-1'), null, 'a Ready offer is not a run');
  });

  it('shows what came before it opened once, then every new fragment, for the visit it names', () => {
    const cache = new RunViewCache();
    cache.receive({ kind: 'started', run });
    for (const event of [started(1, 0), text(1, 1, 'First pass.'), started(2, 2), text(2, 3, 'Second ')]) {
      cache.receive(event);
    }
    // The window opens: one event reaches it while its read is out, and the read already has it.
    let feed = feedEvent(OPENING_FEED, text(2, 4, 'pass '));
    cache.receive(text(2, 4, 'pass '));
    feed = feedSeed(feed, cache.get('run-7'));
    assert.equal(step(feed, 2)?.text, 'Second pass ', 'nothing twice');
    // New events reach the open window as they come.
    feed = feedEvent(feed, text(2, 5, 'is fine.'));
    feed = feedEvent(feed, activity(2, 6, { kind: 'tool-started', callId: 'c1', name: 'shell', summary: 'git diff' }));
    assert.equal(step(feed, 2)?.text, 'Second pass is fine.');
    assert.deepEqual(step(feed, 2)?.tools.map((tool) => [tool.summary, tool.status]), [['git diff', null]]);
    // The visit it names, not the node's other one; and an event for another run changes nothing.
    assert.equal(step(feed, 1)?.text, 'First pass.');
    const other = feedEvent(feed, { ...text(2, 7, 'not mine'), runId: 'run-8' } as LoopRunEvent);
    assert.equal(other, feed);
    // The step closes: its live state is kept, marked finished.
    feed = feedEvent(feed, { kind: 'journal', runId: 'run-7', graphVersionId: 'graph-v1', entry: { seq: 9, atIso: at(8), sinceStartMs: 9, kind: 'node-produced', nodeId: 'review', detail: '' } } as LoopRunEvent);
    assert.equal(step(feed, 2)?.finished, true);
    assert.equal(step(feed, 2)?.text, 'Second pass is fine.');
  });
});
