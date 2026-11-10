/**
 * DSP-190: the walk loop run as the windows follow it: the activity model, the usage summary,
 * the host's follow state (what the provider reports in a turn becomes addressed, numbered
 * entries; text is coalesced; the run's drawing, journal and ending are the editor's own view),
 * the read-back from the run's files, and what a window does with the events. No provider, no
 * window: these establish DSpatch's own handling and say nothing about what a model writes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import type { AgentEvent } from '../src/adapter/types';
import { WALK_LOOP_ACTIVITY_FILE, WALK_LOOP_GRAPH_FILE, WalkLoopFollow, readWalkLoopFollow } from '../src/host/walk-loop-follow';
import { runWalkLoop, type WalkLoopSessions, type WalkLoopTurnResult } from '../src/host/walk-loop-run';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { nodeRunStates, type RunView } from '../src/shared/loop-run-view';
import { DETAILS_MARKER } from '../src/shared/presentation-profiles';
import type { AnalysisMaterial } from '../src/shared/review-agent';
import type { AgentMaterial } from '../src/shared/review-pair';
import { WALK_LOOP_GRAPH_REL } from '../src/shared/walk-loop';
import { foldWalkLoopActivity, summariseUsage, walkLoopActivityFrom, type WalkLoopActivity } from '../src/shared/walk-method';
import { applyWalkLoopRunEvent, runEventBelongsTo, type WalkLoopFollowState, type WalkLoopRunEvent } from '../src/shared/walk-loop-view';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphText = fs.readFileSync(path.join(repoRoot, WALK_LOOP_GRAPH_REL), 'utf8');
const resolveRole = createFileRoleResolver(repoRoot);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-follow-'));

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// --- The usage summary -----------------------------------------------------------------------

describe('the usage summary (DSP-190)', () => {
  it('sums a named field over its readings and keeps unknown as unknown', () => {
    const summary = summariseUsage([
      { unit: 'tokens', scope: 'call', value: 100, source: 'assistant.usage.inputTokens' },
      { unit: 'tokens', scope: 'call', value: 10, source: 'assistant.usage.outputTokens' },
      { unit: 'tokens', scope: 'call', value: 250, source: 'assistant.usage.inputTokens' },
      { unit: 'tokens', scope: 'call', value: null, source: 'assistant.usage.outputTokens' },
    ]);
    assert.equal(summary.silent, false);
    assert.equal(summary.readings, 4);
    const input = summary.lines.find((line) => line.source === 'assistant.usage.inputTokens');
    const output = summary.lines.find((line) => line.source === 'assistant.usage.outputTokens');
    assert.deepEqual({ value: input?.value, summed: input?.summed, readings: input?.readings, unknown: input?.unknown }, { value: 350, summed: true, readings: 2, unknown: 0 });
    assert.deepEqual({ value: output?.value, summed: output?.summed, readings: output?.readings, unknown: output?.unknown }, { value: 10, summed: true, readings: 2, unknown: 1 });
    assert.ok(summary.text.includes('350 input tokens') && summary.text.includes('10 output tokens') && summary.text.includes('per model call') && summary.text.includes('1 unknown'), summary.text);
  });
  it('does not add readings whose field is not recorded, a cumulative scope, or a provider total', () => {
    const summary = summariseUsage([
      { unit: 'tokens', scope: 'call', value: 5, source: 'assistant.usage' },
      { unit: 'tokens', scope: 'call', value: 7, source: 'assistant.usage' },
      { unit: 'tokens', scope: 'turn', value: 40, source: 'SDKUsageMessage.usage.totalTokens' },
      { unit: 'tokens', scope: 'turn', value: 30, source: 'SDKUsageMessage.usage.inputTokens' },
      { unit: 'tokens', scope: 'turn', value: 60, source: 'SDKUsageMessage.usage.totalTokens' },
      { unit: 'tokens', scope: 'turn', value: 50, source: 'SDKUsageMessage.usage.inputTokens' },
      { unit: 'cents', scope: 'session', value: 12, source: 'agent.getUsage().cost.total' },
      { unit: 'cents', scope: 'session', value: 15, source: 'agent.getUsage().cost.total' },
    ]);
    const plain = summary.lines.find((line) => line.source === 'assistant.usage');
    assert.ok(plain !== undefined && !plain.summed && plain.value === 7 && plain.why !== null && plain.why.includes('not recorded'));
    const total = summary.lines.find((line) => line.source === 'SDKUsageMessage.usage.totalTokens');
    assert.ok(total !== undefined && !total.summed && total.value === 60 && total.why !== null && total.why.includes('not added'));
    const input = summary.lines.find((line) => line.source === 'SDKUsageMessage.usage.inputTokens');
    assert.ok(input !== undefined && input.summed && input.value === 80);
    const cost = summary.lines.find((line) => line.source === 'agent.getUsage().cost.total');
    assert.ok(cost !== undefined && !cost.summed && cost.value === 15 && cost.why !== null && cost.why.includes('cumulative'));
    assert.ok(summary.text.includes('80 input tokens') && summary.text.includes('not added'), summary.text);
  });
  it('says silence as unknown, never as zero', () => {
    assert.equal(summariseUsage('unknown').text, 'usage not reported by the provider');
    assert.equal(summariseUsage([]).silent, true);
    assert.ok(!summariseUsage('unknown').text.includes('0'));
  });
});

// --- The activity fold and the window's state ------------------------------------------------

function entry(seq: number, turn: number, nodeId: string, occurrence: number, body: Record<string, unknown>): WalkLoopActivity {
  return walkLoopActivityFrom({ seq, runId: 'run-1', nodeId, occurrence, turn, atUtc: `2026-11-10T08:00:${String(seq).padStart(2, '0')}.000Z`, ...body }) as WalkLoopActivity;
}

describe('the activity fold', () => {
  it('groups by node visit, joins text fragments of one turn and counts its turns', () => {
    const visits = foldWalkLoopActivity([
      entry(1, 1, 'plan', 1, { kind: 'turn-started', stepId: null, roleId: 'walk-planner', what: 'Planning the walks' }),
      entry(2, 1, 'plan', 1, { kind: 'reply-text', text: 'Hel' }),
      entry(3, 1, 'plan', 1, { kind: 'reply-text', text: 'lo' }),
      entry(4, 1, 'plan', 1, { kind: 'tool-started', callId: 'c1', name: 'Read', summary: 'Reading a.ts' }),
      entry(5, 1, 'plan', 1, { kind: 'reply-text', text: '!' }),
      entry(6, 1, 'plan', 1, { kind: 'turn-ended', status: 'finished', error: null, textLength: 6 }),
      entry(7, 2, 'write', 1, { kind: 'turn-started', stepId: 'W1.1', roleId: 'walk-writer', what: 'Writing step W1.1 (1 of 2)' }),
      entry(8, 3, 'write', 1, { kind: 'turn-started', stepId: 'W1.2', roleId: 'walk-writer', what: 'Writing step W1.2 (2 of 2)' }),
      entry(9, 4, 'write', 2, { kind: 'turn-started', stepId: 'W1.1', roleId: 'walk-writer', what: 'Writing again step W1.1 (1 of 1)' }),
    ]);
    assert.deepEqual(visits.map((visit) => [visit.nodeId, visit.occurrence, visit.turns, visit.open]), [['plan', 1, 1, false], ['write', 1, 2, true], ['write', 2, 1, true]]);
    const plan = visits[0];
    assert.deepEqual(plan?.entries.map((item) => item.kind), ['turn-started', 'reply-text', 'tool-started', 'reply-text', 'turn-ended']);
    assert.equal(plan?.entries[1]?.kind === 'reply-text' ? plan.entries[1].text : '', 'Hello', 'consecutive fragments are one text');
    assert.equal(plan?.roleId, 'walk-planner');
  });
  it('reads back only entries it knows, with their fields', () => {
    assert.equal(walkLoopActivityFrom({ seq: 1, runId: 'r', nodeId: 'n', kind: 'something-else' }), null);
    const verdict = walkLoopActivityFrom({ seq: 2, runId: 'r', nodeId: 'review', occurrence: 1, turn: 3, atUtc: 't', kind: 'verdict', final: true, review: { assessment: 'ok', verdict: 'accept', findings: [] } });
    assert.ok(verdict !== null && verdict.kind === 'verdict' && verdict.final && verdict.review.verdict === 'accept');
    assert.equal(walkLoopActivityFrom({ seq: 3, runId: 'r', nodeId: 'review', kind: 'verdict', review: { verdict: 'maybe' } }), null, 'a verdict that cannot be read is left out');
  });
});

describe('what a window holds of the run', () => {
  const started: WalkLoopRunEvent = {
    key: 'review-a',
    jobId: 'job-1',
    event: { kind: 'started', run: { runId: 'run-1', graphVersionId: 'graph-1', graphId: 'dspatch-walk-loop', graphName: 'Walks', binding: 'walk-loop', graphText, startedAtUtc: '2026-11-10T08:00:00.000Z', roles: [], phase: 'running' } },
  };
  const journal = (seq: number, kind: 'node-entered' | 'node-produced', nodeId: string): WalkLoopRunEvent => ({
    key: 'review-a',
    jobId: 'job-1',
    event: { kind: 'journal', runId: 'run-1', graphVersionId: 'graph-1', entry: { seq, atIso: 't', sinceStartMs: 0, kind, nodeId, detail: '' } },
  });
  const activity = (seq: number): WalkLoopRunEvent => ({ key: 'review-a', jobId: 'job-1', activity: entry(seq, 1, 'plan', 1, { kind: 'note', text: `note ${String(seq)}` }) });
  it('applies events once, in order, and only its own', () => {
    let state: WalkLoopFollowState = { view: null, activity: [] };
    assert.equal(runEventBelongsTo(started, 'review-a', 'job-1'), true);
    assert.equal(runEventBelongsTo(started, 'review-b', 'job-1'), false);
    assert.equal(runEventBelongsTo(started, 'review-a', 'job-2'), false);
    state = applyWalkLoopRunEvent(state, started);
    assert.ok(state.view !== null && state.view.run.runId === 'run-1');
    state = applyWalkLoopRunEvent(state, journal(1, 'node-entered', 'plan'));
    assert.equal(nodeRunStates(state.view).get('plan'), 'active');
    const same = applyWalkLoopRunEvent(state, journal(1, 'node-entered', 'plan'));
    assert.equal(same, state, 'a journal entry already held changes nothing');
    state = applyWalkLoopRunEvent(state, activity(1));
    state = applyWalkLoopRunEvent(state, activity(2));
    assert.equal(applyWalkLoopRunEvent(state, activity(2)), state, 'an activity entry already held changes nothing');
    assert.equal(applyWalkLoopRunEvent(state, activity(1)), state, 'an earlier one neither');
    state = applyWalkLoopRunEvent(state, activity(3));
    assert.deepEqual(state.activity.map((item) => item.seq), [1, 2, 3]);
    const again = applyWalkLoopRunEvent(state, started);
    assert.equal(again, state, 'the announcement of the run already watched clears nothing');
    state = applyWalkLoopRunEvent(state, journal(2, 'node-produced', 'plan'));
    state = applyWalkLoopRunEvent(state, { key: 'review-a', jobId: 'job-1', event: { kind: 'ended', runId: 'run-1', graphVersionId: 'graph-1', status: 'completed', note: 'done', terminalNodeId: 'delivered' } });
    assert.ok(state.view?.ended && state.view.terminalNodeId === 'delivered');
    assert.equal(nodeRunStates(state.view).get('plan'), 'finished');
  });
});

// --- The host's follow state, through a scripted run ------------------------------------------

const FILES: Record<string, string[]> = {
  'src/a.ts': ['export function start(): void {', '  connect();', '}', 'function connect(): boolean {', '  return open();', '}'],
};
const material: AnalysisMaterial = { pair: { repository: '/repo', base: 'a'.repeat(40), target: 'b'.repeat(40) }, repositoryName: 'repo', baseSubject: 'before', targetSubject: 'after', files: [], diff: '', diffLeftOut: [] };
const folder: AgentMaterial = { base: material.pair.base, target: material.pair.target, files: 1, skipped: [], skippedCount: 0 };
const read = (_side: 'base' | 'target', filePath: string): Promise<readonly string[] | null> => Promise.resolve(FILES[filePath] ?? null);
function place(start: number, end: number, from?: { start: number; end: number }): Record<string, unknown> {
  return { label: `lines ${String(start)}-${String(end)}`, path: 'src/a.ts', side: 'target', start, end, ...(from === undefined ? {} : { from: { label: 'the call', path: 'src/a.ts', side: 'target', ...from } }) };
}
const PLAN = `\`\`\`json\n${JSON.stringify({
  summary: 'Connects on start.',
  background: '',
  walks: [{ kind: 'walk', title: 'Starting', question: 'What happens on start?', purpose: 'Follow the start.', steps: [{ title: 'Start', summary: 'start() calls connect().', brief: 'Say it.', places: [place(1, 3)] }, { title: 'Connect', summary: 'connect() opens.', brief: 'Say it.', places: [place(4, 6, { start: 2, end: 2 })] }] }],
})}\n\`\`\``;
const reviewJson = (verdict: string, findings: readonly Record<string, unknown>[]): string => `\`\`\`json\n${JSON.stringify({ assessment: `SCRIPTED ${verdict}`, verdict, findings })}\n\`\`\``;

/** A scripted session that also reports what a provider reports: deltas, a tool, usage. */
function sessions(onEvent: (event: AgentEvent) => void, reviews: readonly string[]): WalkLoopSessions {
  let reviewCount = 0;
  let runs = 0;
  return {
    open: () => Promise.resolve(),
    turn: async (nodeId, prompt) => {
      runs += 1;
      const base = { dspatchSessionId: `session-${nodeId}`, dspatchRunId: `run-${String(runs)}`, at: new Date().toISOString(), rawProviderEvent: null };
      onEvent({ ...base, type: 'run.started' });
      onEvent({ ...base, type: 'tool.started', toolCallId: `${String(runs)}-read`, name: 'Read', subject: '/revisions/target/src/a.ts' });
      onEvent({ ...base, type: 'tool.finished', toolCallId: `${String(runs)}-read`, name: 'Read', status: 'ok' });
      onEvent({ ...base, type: 'reasoning.delta', text: 'thinking ' });
      onEvent({ ...base, type: 'reasoning.delta', text: 'about it' });
      let text: string;
      if (nodeId === 'plan') {
        text = PLAN;
      } else if (nodeId === 'review') {
        text = reviews[Math.min(reviewCount, reviews.length - 1)] ?? '';
        reviewCount += 1;
      } else {
        const stepId = /^## This step: (\S+)/m.exec(prompt)?.[1] ?? '?';
        text = `Text for ${stepId}.\n\n${DETAILS_MARKER}\nMore on ${stepId}.`;
      }
      for (const piece of text.match(/[\s\S]{1,30}/g) ?? [text]) {
        onEvent({ ...base, type: 'assistant.delta', text: piece });
      }
      onEvent({ ...base, type: 'usage', readings: [{ provider: 'claude', unit: 'tokens', scope: 'turn', value: 100 * runs, source: 'SDKResultMessage.usage.input_tokens', observedAt: base.at }] });
      onEvent({ ...base, type: 'assistant.message', text });
      onEvent({ ...base, type: 'run.finished', status: 'finished' });
      // What a real turn gives the follow state a moment to coalesce.
      await delay(5);
      const result: WalkLoopTurnResult = { status: 'finished', text, error: null, sessionId: `session-${nodeId}` };
      return result;
    },
    usageSinceLast: () => [],
  };
}

describe('the host\'s follow state over a scripted run', () => {
  it('announces, journals, addresses every turn\'s activity, coalesces text, keeps the files and reads them back', async () => {
    const dir = path.join(scratch, 'accept');
    const events: WalkLoopRunEvent[] = [];
    const follow = new WalkLoopFollow({ key: 'review-a', jobId: 'job-1', dir, emit: (event) => events.push(event), log: () => undefined, relative: (subject) => subject.replace('/revisions/', '') });
    const snapshotsDuring: number[] = [];
    const outcome = await runWalkLoop({
      graphText,
      graphPath: WALK_LOOP_GRAPH_REL,
      resolveRole,
      material,
      folder,
      language: 'en',
      profile: 'standard',
      files: [],
      read,
      context: null,
      sessions: sessions(
        (event) => {
          follow.adapterEvent(event);
          if (event.type === 'run.finished') {
            snapshotsDuring.push(follow.snapshot().activity.length);
          }
        },
        [reviewJson('rework', [{ kind: 'explanation', steps: ['W1.1'], problem: 'Wrong.', why: 'It says so.', evidence: 'line 2', reference: '2' }]), reviewJson('accept', [])],
      ),
      recordDir: dir,
      follow,
      identity: { projectPath: '/revisions', mandate: 'Prepare code walks.', modelRequested: 'scripted', provider: 'claude', appVersion: 'test' },
      signal: new AbortController().signal,
      activity: () => undefined,
      log: () => undefined,
    });
    assert.equal(outcome.kind, 'delivered', outcome.kind === 'failed' ? outcome.detail : '');
    // The graph side: the editor's own events, in order, addressed to the run.
    const runEvents = events.flatMap((event) => ('event' in event ? [event.event] : []));
    assert.equal(runEvents[0]?.kind, 'started');
    const announced = runEvents[0]?.kind === 'started' ? runEvents[0].run : null;
    assert.ok(announced !== null && announced.binding === 'walk-loop' && announced.graphText === graphText && (announced.roles?.length ?? 0) === 3, 'the run announces its drawing and roles');
    assert.ok(runEvents.some((event) => event.kind === 'journal' && event.entry.kind === 'edge-taken'));
    assert.equal(runEvents.at(-1)?.kind, 'ended');
    assert.ok(events.every((event) => event.key === 'review-a' && event.jobId === 'job-1'));
    // The activity side: every turn addressed to its node visit and numbered in sequence.
    const activity = events.flatMap((event) => ('activity' in event ? [event.activity] : []));
    assert.ok(activity.every((item, index) => index === 0 || item.seq > (activity[index - 1]?.seq ?? 0)), 'sequence numbers rise');
    const starts = activity.filter((item) => item.kind === 'turn-started');
    assert.deepEqual(starts.map((item) => [item.nodeId, item.occurrence, item.turn]), [['plan', 1, 1], ['write', 1, 2], ['write', 1, 3], ['review', 1, 4], ['write', 2, 5], ['review', 2, 6]], 'plan, two steps, review, one step again, final assessment');
    assert.ok(starts.some((item) => item.kind === 'turn-started' && item.what.startsWith('Writing step W1.1') && item.stepId === 'W1.1'));
    assert.ok(starts.some((item) => item.kind === 'turn-started' && item.what.startsWith('Writing again step W1.1')));
    const tools = activity.filter((item) => item.kind === 'tool-started');
    assert.equal(tools.length, 6, 'one read per turn');
    assert.ok(tools[0]?.kind === 'tool-started' && tools[0].summary === 'Reading a.ts' && tools[0].turn === 1);
    const reasoning = activity.filter((item) => item.kind === 'reasoning-text');
    assert.ok(reasoning.length >= 6 && reasoning.length <= 12, `reasoning fragments coalesced: ${String(reasoning.length)}`);
    const replies = activity.filter((item) => item.kind === 'reply-text');
    assert.ok(replies.length >= 6, 'reply text streamed');
    const verdicts = activity.filter((item) => item.kind === 'verdict');
    assert.deepEqual(verdicts.map((item) => (item.kind === 'verdict' ? [item.review.verdict, item.final] : [])), [['rework', false], ['accept', true]]);
    assert.ok(activity.some((item) => item.kind === 'usage'));
    assert.ok(activity.some((item) => item.kind === 'note' && item.text.startsWith('Plan read')));
    const ends = activity.filter((item) => item.kind === 'turn-ended');
    assert.equal(ends.length, 6);
    // A snapshot during the run holds the fragments so far; after a turn, one text per kind.
    assert.ok(snapshotsDuring.length === 6 && snapshotsDuring.every((count) => count > 0));
    const snapshot = follow.snapshot();
    const replyEntriesPerTurn = new Map<number, number>();
    for (const item of snapshot.activity.filter((candidate) => candidate.kind === 'reply-text')) {
      replyEntriesPerTurn.set(item.turn, (replyEntriesPerTurn.get(item.turn) ?? 0) + 1);
    }
    assert.ok([...replyEntriesPerTurn.values()].every((count) => count === 1), 'after a turn its fragments are one text in the snapshot');
    assert.equal(snapshot.live, true);
    // The files beside the record.
    assert.ok(fs.existsSync(path.join(dir, WALK_LOOP_GRAPH_FILE)));
    const lines = fs.readFileSync(path.join(dir, WALK_LOOP_ACTIVITY_FILE), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { activity: { kind: string } });
    assert.ok(!lines.some((line) => line.activity.kind === 'reply-text'), 'reply text is on the record\'s reply lines, not kept twice');
    assert.ok(lines.some((line) => line.activity.kind === 'reasoning-text'));
    assert.ok(lines.some((line) => line.activity.kind === 'tool-started') && lines.some((line) => line.activity.kind === 'usage') && lines.some((line) => line.activity.kind === 'verdict'));
    // Read back: the view ended at the terminal, every turn with its answer whole.
    const back = readWalkLoopFollow({ jobId: 'job-1', dir, summary: null, fallbackGraphText: null, resolveRole, provider: 'claude', model: 'scripted' });
    assert.ok(!('error' in back), 'error' in back ? back.error : '');
    const view = back.view as RunView;
    assert.ok(view.ended && view.terminalNodeId === 'delivered');
    assert.equal(nodeRunStates(view).get('review'), 'finished');
    assert.equal(back.live, false);
    assert.deepEqual(back.limitations, []);
    assert.ok(back.summary !== null && back.summary.rounds === 1, 'the summary kept with the run');
    const backReplies = back.activity.filter((item) => item.kind === 'reply-text');
    assert.equal(backReplies.length, 6, 'one whole answer per turn');
    assert.ok(backReplies[0]?.kind === 'reply-text' && backReplies[0].text.includes('Connects on start'));
    assert.ok(back.activity.every((item, index) => item.seq === index + 1), 'renumbered in order');
    const visits = foldWalkLoopActivity(back.activity);
    assert.deepEqual(visits.map((visit) => [visit.nodeId, visit.occurrence, visit.turns]), [['plan', 1, 1], ['write', 1, 2], ['review', 1, 1], ['write', 2, 1], ['review', 2, 1]]);
  });

  it('shows a run recorded before the activity was kept as far as it goes, and says what is missing', async () => {
    const dir = path.join(scratch, 'legacy');
    const sessionsOf = sessions(() => undefined, [reviewJson('accept', [])]);
    const outcome = await runWalkLoop({
      graphText,
      graphPath: WALK_LOOP_GRAPH_REL,
      resolveRole,
      material,
      folder,
      language: 'en',
      profile: 'standard',
      files: [],
      read,
      context: null,
      sessions: sessionsOf,
      recordDir: dir,
      identity: { projectPath: '/revisions', mandate: 'Prepare code walks.', modelRequested: 'scripted', provider: 'claude', appVersion: '0.1.14' },
      signal: new AbortController().signal,
      activity: () => undefined,
      log: () => undefined,
    });
    assert.equal(outcome.kind, 'delivered');
    assert.ok(!fs.existsSync(path.join(dir, WALK_LOOP_ACTIVITY_FILE)) && !fs.existsSync(path.join(dir, WALK_LOOP_GRAPH_FILE)), 'a run without a follow keeps no activity file and no drawing');
    const back = readWalkLoopFollow({ jobId: 'job-legacy', dir, summary: null, fallbackGraphText: graphText, resolveRole, provider: 'claude', model: 'scripted' });
    assert.ok(!('error' in back));
    assert.ok(back.limitations.some((line) => line.includes('kept only its answers')));
    assert.ok(back.limitations.some((line) => line.includes('drawing was not kept')));
    assert.ok(back.view !== null && back.view.ended);
    const kinds = new Set(back.activity.map((item) => item.kind));
    assert.deepEqual([...kinds].sort(), ['reply-text', 'turn-ended', 'turn-started']);
    assert.equal(back.activity.filter((item) => item.kind === 'turn-started').length, 4, 'plan, two steps, review');
    const none = readWalkLoopFollow({ jobId: 'x', dir: path.join(scratch, 'nowhere'), summary: null, fallbackGraphText: null, resolveRole, provider: 'claude', model: 'm' });
    assert.ok('error' in none);
  });

  it('keeps a reported command with its output, cut to the record\'s bound', () => {
    const dir = path.join(scratch, 'command');
    const events: WalkLoopRunEvent[] = [];
    const follow = new WalkLoopFollow({ key: 'k', jobId: 'j', dir, emit: (event) => events.push(event), log: () => undefined });
    follow.announce({ runId: 'r', graphVersionId: 'g', graphId: 'i', graphName: 'n', binding: 'walk-loop', graphText, startedAtUtc: 't' });
    follow.journal({ seq: 1, atIso: 't', sinceStartMs: 0, kind: 'node-entered', nodeId: 'plan', detail: '' });
    follow.turnStarted({ nodeId: 'plan', occurrence: 1 }, null, 'walk-planner', 'Planning the walks');
    const base = { dspatchSessionId: 's', dspatchRunId: 'run', at: 't', rawProviderEvent: null };
    follow.adapterEvent({
      ...base,
      type: 'command.finished',
      toolCallId: 'c1',
      command: {
        commandId: 'c1',
        requestedBy: 'provider-reported',
        line: 'git log --oneline -3',
        shell: 'sh -c',
        cwd: '/revisions',
        pid: null,
        startedAtUtc: 't',
        finishedAtUtc: 't',
        durationMs: 10,
        timeoutMs: null,
        ending: 'exited',
        endingMessage: null,
        exitCode: 0,
        signal: null,
        killedByDspatch: false,
        stdout: 'x'.repeat(10_000),
        stderr: 'warn',
        outputTruncated: false,
        outputNote: null,
        testedSnapshotId: null,
        afterRunSnapshotId: null,
        snapshotRoots: [],
      },
    });
    const command = follow.snapshot().activity.find((entry) => entry.kind === 'command');
    assert.ok(command !== undefined && command.kind === 'command');
    assert.equal(command.line, 'git log --oneline -3');
    assert.equal(command.exitCode, 0);
    assert.equal(command.output.length, 8 * 1024);
    assert.equal(command.truncated, true);
    assert.deepEqual({ nodeId: command.nodeId, occurrence: command.occurrence, turn: command.turn }, { nodeId: 'plan', occurrence: 1, turn: 1 });
    const lines = fs.readFileSync(path.join(dir, WALK_LOOP_ACTIVITY_FILE), 'utf8').trim().split('\n');
    assert.ok(lines.some((line) => (JSON.parse(line) as { activity: { kind: string } }).activity.kind === 'command'));
    follow.close();
  });

  it('records and sends nothing once closed', () => {
    const dir = path.join(scratch, 'closed');
    const events: WalkLoopRunEvent[] = [];
    const follow = new WalkLoopFollow({ key: 'k', jobId: 'j', dir, emit: (event) => events.push(event), log: () => undefined });
    follow.close();
    follow.announce({ runId: 'r', graphVersionId: 'g', graphId: 'i', graphName: 'n', binding: 'walk-loop', graphText, startedAtUtc: 't' });
    follow.turnStarted({ nodeId: 'plan', occurrence: 1 }, null, null, 'x');
    follow.note('nothing');
    assert.equal(events.length, 0);
    assert.ok(!fs.existsSync(dir));
  });
});
