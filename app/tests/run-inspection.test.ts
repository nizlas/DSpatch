/**
 * Inspecting a loop run apart from editing its graph (Niclas, 15 November 2026): the editor's
 * modes, what a step that did not run says, and a finished run read back after a restart on
 * the graph it walked — never on the graph as edited since.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { latestRecordedRun } from '../src/main/run-record-lookup';
import { RunRecordStore, graphVersionIdFor } from '../src/main/run-record-store';
import type { RecordedRunEnding, RunRecordIdentity } from '../src/shared/loop-record';
import type { RunJournalEntry } from '../src/shared/loop-run';
import { finishedRunMarksFrom, endingMarkFor, nodeRunStates } from '../src/shared/loop-run-view';
import { parseLoopGraph } from '../src/shared/loop-graph-load';
import { editorModeAfter, runNodeStatus } from '../src/shared/run-inspection';

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** triage → (fix | split → merge) → shipped, with a skipped step and an ending never reached. */
function graphText(name: string): string {
  const agent = (id: string): Record<string, unknown> => ({ id, kind: 'human', label: id });
  return `${JSON.stringify(
    {
      format: 'dspatch-loop-graph',
      formatVersion: 1,
      id: 'triage-loop',
      name,
      purpose: 'Inspection test.',
      target: 'cursor',
      entry: 'triage',
      onRuntimeFault: 'stop-and-reconcile',
      failureKinds: [],
      nodes: [agent('triage'), agent('fix'), agent('split'), agent('merge'), { id: 'shipped', kind: 'terminal', label: 'Shipped' }, { id: 'dropped', kind: 'terminal', label: 'Dropped' }],
      edges: [
        { id: 'e1', from: 'triage', to: 'fix', when: { on: 'success' } },
        { id: 'e2', from: 'fix', to: 'split', when: { on: 'success' } },
        { id: 'e3', from: 'split', to: 'merge', when: { on: 'success' } },
        { id: 'e4', from: 'merge', to: 'shipped', when: { on: 'success' } },
        { id: 'e5', from: 'merge', to: 'dropped', when: { on: 'success' } },
      ],
    },
    null,
    2,
  )}\n`;
}

let seq = 0;
const entry = (kind: string, nodeId?: string, data?: Record<string, string | number | boolean>): RunJournalEntry =>
  ({ seq: (seq += 1), atIso: '2026-11-15T09:00:00.000Z', sinceStartMs: seq, kind, detail: kind, ...(nodeId === undefined ? {} : { nodeId }), ...(data === undefined ? {} : { data }) }) as RunJournalEntry;

/** Write one run record the way the project host does, with or without its graph beside it. */
function writeRun(dir: string, runId: string, graphPath: string, text: string, startedAtUtc: string, keepGraph: boolean): void {
  const identity: RunRecordIdentity = {
    runId,
    projectPath: path.dirname(graphPath),
    conversationId: 'conv-1',
    mandate: `mandate of ${runId}`,
    graphId: 'triage-loop',
    graphPath,
    graphVersionId: graphVersionIdFor(text),
    modelRequested: 'default',
    appVersion: '1.0.0',
    startedAtUtc,
  };
  const writer = new RunRecordStore(dir).open(identity);
  if (keepGraph) {
    writer.writeGraph(text);
  }
  seq = 0;
  for (const line of [
    entry('node-entered', 'triage', { occurrence: 1, kind: 'human', label: 'triage' }),
    entry('node-produced', 'triage'),
    entry('node-skipped', 'fix'),
    entry('node-entered', 'shipped', { occurrence: 1, kind: 'terminal', label: 'Shipped' }),
    entry('run-ended'),
  ]) {
    writer.journal(line);
  }
  writer.finish({ endedAtUtc: startedAtUtc, kind: 'finished', status: 'completed', terminalNodeId: 'shipped', outcome: 'work-verified', note: '' } as unknown as RecordedRunEnding);
}

describe('the loop editor’s modes', () => {
  it('shows a run when it starts, keeps it when it ends, and changes only on the person’s buttons', () => {
    assert.equal(editorModeAfter('edit', 'run-started'), 'run');
    assert.equal(editorModeAfter('run', 'run-ended'), 'run', 'a finished run stays on screen');
    assert.equal(editorModeAfter('edit', 'run-ended'), 'edit', 'and a run ending does not pull editing into Run');
    assert.equal(editorModeAfter('run', 'back-to-editing'), 'edit');
    assert.equal(editorModeAfter('edit', 'show-latest-run'), 'run');
  });
});

describe('a finished run read back after a restart', () => {
  const setup = (): { dir: string; graphPath: string } => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-run-inspection-'));
    scratch.push(dir);
    const project = path.join(dir, 'project');
    fs.mkdirSync(project);
    return { dir: path.join(dir, 'loop-runs'), graphPath: path.join(project, 'triage-loop.graph.json') };
  };

  it('is drawn on the graph saved with it, not on the graph as edited since, and is the latest run', () => {
    const { dir, graphPath } = setup();
    const walked = graphText('As it ran');
    fs.writeFileSync(graphPath, walked);
    writeRun(dir, 'run-old', graphPath, walked, '2026-11-15T08:00:00.000Z', true);
    writeRun(dir, 'run-new', graphPath, walked, '2026-11-15T09:00:00.000Z', true);
    writeRun(dir, 'run-elsewhere', path.join(path.dirname(graphPath), 'other.graph.json'), walked, '2026-11-15T10:00:00.000Z', true);
    fs.writeFileSync(graphPath, graphText('Edited since'));
    const found = latestRecordedRun(dir, graphPath);
    assert.equal(found.kind, 'found');
    if (found.kind !== 'found' || found.view === null) {
      throw new Error('no view');
    }
    assert.equal(found.runId, 'run-new');
    assert.equal(found.graphSource, 'saved-with-run');
    assert.equal(found.view.run.graphText, walked);
    assert.equal(found.view.run.conversationId, 'conv-1');

    // What the Run panel says for each step, from that run alone.
    const graph = parseLoopGraph(found.view.run.graphText);
    assert.ok(graph.ok);
    const states = nodeRunStates(found.view);
    const marks = finishedRunMarksFrom(found.view, graph.graph, null);
    const say = (nodeId: string, kind: 'human' | 'terminal'): string =>
      runNodeStatus({ kind, state: states.get(nodeId), ending: endingMarkFor(marks, nodeId), runEnded: found.view?.ended ?? true }).word;
    assert.equal(say('triage', 'human'), 'Done');
    assert.equal(say('fix', 'human'), 'Skipped');
    assert.equal(say('merge', 'human'), 'Did not run');
    assert.equal(say('shipped', 'terminal'), 'Ending reached');
    assert.equal(say('dropped', 'terminal'), 'Ending not reached');
  });

  it('uses the graph file only while it is unchanged, and otherwise says why it shows nothing', () => {
    const { dir, graphPath } = setup();
    const walked = graphText('As it ran');
    fs.writeFileSync(graphPath, walked);
    // A run recorded before graph copies were kept.
    writeRun(dir, 'run-before-copies', graphPath, walked, '2026-11-15T08:00:00.000Z', false);
    const unchanged = latestRecordedRun(dir, graphPath);
    assert.ok(unchanged.kind === 'found' && unchanged.graphSource === 'unchanged-file' && unchanged.view?.run.graphText === walked);
    fs.writeFileSync(graphPath, graphText('Edited since'));
    const changed = latestRecordedRun(dir, graphPath);
    assert.ok(changed.kind === 'found');
    assert.equal(changed.view, null, 'never drawn on today’s graph');
    assert.match(changed.problem ?? '', /cannot be shown on the graph it walked/);
    assert.deepEqual(latestRecordedRun(dir, path.join(path.dirname(graphPath), 'never-run.graph.json')), { kind: 'none' });
  });
});
