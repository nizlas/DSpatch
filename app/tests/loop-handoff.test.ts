/**
 * DSP-209 S5a: a loop step recommends continuing interactively, through a DSpatch tool.
 *
 * The parts the live end-to-end case in `loop-live.test.ts` does not reach: the drawing's
 * field, the record, the conversation's lines, the run's ending, and the answer's shape.
 * No provider; the runner cases use a scripted executor.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LoopRunController } from '../src/main/loop-control-runtime';
import { createHandoffTool, offersHandoff } from '../src/main/loop-live';
import { CHAT_LOOP_WINDOW_LOOKUP, formatChatLiveLogLine } from '../src/shared/loop-chat';
import { handoffAnswerFrom } from '../src/shared/loop-control';
import { LOOP_GRAPH_FORMAT, LOOP_GRAPH_FORMAT_VERSION, type LoopGraph } from '../src/shared/loop-graph';
import { checkLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import { parseRunRecord, runOutcomeFrom, serialiseRecordLine } from '../src/shared/loop-record';
import { runLoopGraph, type RunJournalEntry, type StepExecutor } from '../src/shared/loop-run';
import { describeLoopEnding } from '../src/shared/loop-transcript';

function graph(capabilities?: unknown, kind: 'agent' | 'human' = 'agent'): LoopGraph {
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'handoff',
    name: 'Handoff',
    purpose: 'One step that may recommend interactive work.',
    target: 'cursor',
    entry: 'work',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [],
    nodes: [
      {
        id: 'work',
        kind,
        label: 'Do what was asked',
        ...(capabilities === undefined ? {} : { capabilities: capabilities as never }),
      },
      { id: 'end', kind: 'terminal', label: 'End' },
    ],
    edges: [{ id: 'e1', from: 'work', to: 'end', when: { on: 'success' } }],
  };
}

function codesOf(text: string): string[] {
  return parseLoopGraph(text).findings.map((finding) => finding.code);
}

function entry(kind: RunJournalEntry['kind'], data: RunJournalEntry['data']): RunJournalEntry {
  return { seq: 1, atIso: '2026-11-14T03:00:00.000Z', sinceStartMs: 0, kind, nodeId: 'work', detail: '', ...(data ? { data } : {}) };
}

/** First visit recommends; later visits do the work. */
const recommendsOnce: StepExecutor = async (context) => ({
  product: { kind: 'success' },
  summary: `scripted ${context.node.id}`,
  providerTurns: 1,
  ...(context.occurrence === 1 ? { handoff: { reason: 'a decision only you can make' } } : {}),
});

describe('the suggest-interactive capability (DSP-209 S5a)', () => {
  it('loads on an agent node, round-trips, and leaves a drawing without it as it was', () => {
    const withIt = serialiseLoopGraph(graph(['suggest-interactive']));
    const back = parseLoopGraph(withIt);
    assert.ok(back.ok);
    assert.deepEqual(back.graph.nodes[0]?.capabilities, ['suggest-interactive']);
    assert.equal(serialiseLoopGraph(back.graph), withIt);
    assert.equal(offersHandoff(back.graph.nodes[0]!), true);

    const without = serialiseLoopGraph(graph());
    assert.equal(without.includes('capabilities'), false);
    const plain = parseLoopGraph(without);
    assert.ok(plain.ok);
    assert.equal(plain.graph.nodes[0]?.capabilities, undefined);
    assert.equal(offersHandoff(plain.graph.nodes[0]!), false);
    // The fixture's agent has no role, which validation refuses for its own reason; what
    // matters here is that the capability adds no finding of its own on either drawing.
    for (const parsed of [plain.graph, back.graph]) {
      assert.equal(checkLoopGraph(parsed).some((finding) => /capabilit/.test(finding.code)), false);
    }
  });

  it('refuses an unknown capability and one on a node that is not an agent, each with its own finding', () => {
    assert.ok(codesOf(JSON.stringify(graph(['read-minds']))).includes('unknown-capability'));
    assert.ok(codesOf(JSON.stringify(graph(['suggest-interactive'], 'human'))).includes('capabilities-on-a-non-agent'));
    assert.ok(codesOf(JSON.stringify(graph('suggest-interactive'))).includes('bad-capabilities'));
  });

  it('refuses a second request once the person chose the loop, and records nothing for it', async () => {
    const state = { requested: null as string | null, declined: false };
    const tool = createHandoffTool(state);
    assert.equal((await tool.execute({ reason: '' })).isError, true);
    assert.equal(state.requested, null);
    assert.equal((await tool.execute({ reason: 'exploratory' })).isError, false);
    assert.equal(state.requested, 'exploratory');
    state.requested = null;
    state.declined = true;
    const refused = await tool.execute({ reason: 'again' });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /already chose to continue in the loop/);
    assert.equal(state.requested, null);
  });
});

describe('the run holding on a recommendation (DSP-209 S5a)', () => {
  it('journals the request before any work result, and with no control continues in the loop', async () => {
    const result = await runLoopGraph(graph(['suggest-interactive']), { runId: 'no-control', dryRun: true, executor: recommendsOnce });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.path, ['work', 'work', 'end']);
    assert.deepEqual(result.edgesTaken, ['e1']);
    assert.equal(result.usage.reworkRounds, 0);
    const kinds = result.journal.map((line) => line.kind);
    assert.ok(kinds.indexOf('handoff-requested') < kinds.indexOf('node-produced'));
    assert.match(result.journal.find((line) => line.kind === 'handoff-answered')?.detail ?? '', /no control a person could answer/);
  });

  it('ends the run for the loop when no call is left to continue with', async () => {
    const tight = { ...graph(['suggest-interactive']), limits: { maxCalls: 1 } };
    const result = await runLoopGraph(tight, { runId: 'no-room', dryRun: true, executor: recommendsOnce });
    assert.equal(result.status, 'limit-reached');
    assert.deepEqual(result.limitsReached, ['maxCalls']);
  });

  it('waits on the control, refuses an answer for another run or visit, and hands over on the right one', async () => {
    const control = new LoopRunController();
    control.beginRun('held', null);
    let starts = 0;
    const counting: StepExecutor = async (context) => {
      starts += 1;
      return recommendsOnce(context);
    };
    const running = runLoopGraph(graph(['suggest-interactive']), { runId: 'held', dryRun: true, control, executor: counting });
    for (let tries = 0; tries < 200 && control.report().handoff === undefined; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(control.report().handoff?.visit, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(starts, 1, 'silence switches nothing and starts nothing');
    assert.equal(control.answerHandoff({ runId: 'other', visit: 1, choice: 'interactive' }).accepted, false);
    assert.equal(control.answerHandoff({ runId: 'held', visit: 3, choice: 'interactive' }).accepted, false);
    assert.equal(control.answerHandoff({ runId: 'held', visit: 1, choice: 'interactive' }).accepted, true);
    assert.equal(control.answerHandoff({ runId: 'held', visit: 1, choice: 'loop' }).accepted, false, 'the first answer stands');
    const result = await running;
    control.endRun('held');
    assert.equal(result.status, 'handed-over');
    assert.deepEqual(result.handedOver, { nodeId: 'work', occurrence: 1, reason: 'a decision only you can make' });
    assert.deepEqual(result.edgesTaken, []);
    assert.equal(control.report().handoff, undefined);

    // What the conversation and the ending say: handed over, never finished, met, failed or delivered.
    const lines = result.journal
      .map((line) => formatChatLiveLogLine(line, CHAT_LOOP_WINDOW_LOOKUP))
      .filter((line): line is string => line !== null);
    assert.ok(lines.some((line) => /recommends continuing interactively: a decision only you can make/.test(line)), lines.join('\n'));
    assert.ok(lines.includes('You chose to continue interactively; the run is handed over to interactive work.'));
    const ending = describeLoopEnding(
      { kind: 'finished', result, journalText: '', workspaceNote: '' },
      { cancelRequested: false, abandoned: false },
    );
    for (const text of [...lines, ending.text]) {
      assert.doesNotMatch(text, /\bfinished\b|\bmet\b|\bfailed\b|\bdelivered\b/i, text);
    }
    assert.match(ending.text, /Handed over to interactive work/);
  });

  it('keeps a handed-over ending through the record, and reads it as nothing established', () => {
    const line = serialiseRecordLine({
      line: 'ending',
      ending: {
        endedAtUtc: '2026-11-14T03:00:00.000Z',
        kind: 'finished',
        status: 'handed-over',
        terminalNodeId: null,
        outcome: 'unresolved',
        outcomeText: 'Handed over.',
        modelRequested: 'opus',
        modelReported: null,
        commands: [],
        snapshots: null,
        note: '',
        cancelled: false,
        cost: 'unknown',
      } as never,
    });
    assert.equal(parseRunRecord(line).ending?.status, 'handed-over');
    assert.equal(
      runOutcomeFrom({ commands: [], status: 'handed-over', cancelled: false, recordComplete: true }),
      'unresolved',
    );
    const kinds = [entry('handoff-requested', { reason: 'x' }), entry('handoff-answered', { choice: 'loop' })];
    assert.deepEqual(parseRunRecord(kinds.map((item) => serialiseRecordLine({ line: 'journal', entry: item })).join('')).journal, kinds);
  });

  it('reads an answer only in the shape the control expects', () => {
    assert.deepEqual(handoffAnswerFrom({ runId: 'r', visit: 2, choice: 'loop' }), { runId: 'r', visit: 2, choice: 'loop' });
    for (const bad of [null, 'loop', { runId: 'r', visit: 0, choice: 'loop' }, { runId: 'r', visit: 1.5, choice: 'loop' }, { runId: '', visit: 1, choice: 'loop' }, { runId: 'r', visit: 1, choice: 'maybe' }]) {
      assert.equal(handoffAnswerFrom(bad), null);
    }
  });
});
