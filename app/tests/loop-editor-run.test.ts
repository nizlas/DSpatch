/**
 * The editor's Run is the canvas, not the last file on disk.
 *
 * These tests call the same functions the window calls. They exist because the
 * assignment is "changing the drawing changes the generated run", and a test
 * that re-reads the file would have let the window do the wrong thing.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { replaceEdge } from '../src/shared/loop-graph-editing';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import type { LoopGraph } from '../src/shared/loop-graph';
import {
  describeLiveBinding,
  editorJournalOpen,
  liveRunOffer,
  LIVE_DURATION_GRAPH_ID,
  runCanvasGraph,
  summariseEditorRun,
} from '../src/shared/loop-editor-run';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadGraph(rel: string): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, `${rel} must be valid`);
  return loaded.graph;
}

describe('describeLiveBinding', () => {
  it('refuses our development loop for having no live binding, and no longer for its id', () => {
    // The assertion this replaces required `state: 'forbidden'` and a sentence about
    // DSpatch being the workspace. That refusal is gone (DSP-78): the editor's Run is
    // bound to one fixture, so our drawing is refused here for the reason every other
    // drawing is — there is no live prompt for it — and not for being itself.
    const graph = loadGraph('docs/loop/graphs/dspatch-development-loop.graph.json');
    const binding = describeLiveBinding(graph);
    assert.equal(binding.ready, false);
    assert.equal(binding.state, 'unbound');
    assert.match(binding.reason, /no live binding/);
    assert.doesNotMatch(binding.reason, /must not use DSpatch/);
  });

  it('gives the runnable development-loop subset the same unbound answer as any other graph', () => {
    // It is the graph the standalone definition points at, and Editor Run must not
    // acquire an opinion about it: the id check that would have refused its sibling is
    // gone, and nothing replaced it with a check on this one.
    const graph = loadGraph('docs/loop/graphs/dspatch-development-loop-runnable.graph.json');
    const binding = describeLiveBinding(graph);
    assert.equal(binding.ready, false);
    assert.equal(binding.state, 'unbound');
    assert.match(binding.reason, /no live binding/);
  });

  it('is ready only for the duration graph, not for a just-drawn id', () => {
    const duration = loadGraph('docs/loop/graphs/dspatch-live-duration.graph.json');
    assert.equal(duration.id, LIVE_DURATION_GRAPH_ID);
    const ready = describeLiveBinding(duration);
    assert.equal(ready.ready, true);
    assert.equal(ready.state, 'ready');

    const unbound = describeLiveBinding({ id: 'just-drawn-this-evening', name: 'A new loop' });
    assert.equal(unbound.ready, false);
    assert.equal(unbound.state, 'unbound');
    assert.match(unbound.reason, /no live binding/);
    assert.match(unbound.reason, /would silently do the wrong work/);
  });
});

describe('runCanvasGraph — the drawing is the input', () => {
  it('dry-runs our development loop from the typed graph and spends 0 turns', async () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-development-loop.graph.json');
    const result = await runCanvasGraph(graph, { runId: 'editor-dev-loop' });

    assert.equal(result.status, 'completed');
    assert.equal(result.dryRun, true);
    assert.equal(result.usage.providerTurns, 0);
    assert.equal(result.graphId, graph.id);
    assert.deepEqual(result.path, [
      'niclas-mandate',
      'coordinator',
      'route-next-step',
      'implementer',
      'verifier',
      'implementation-review',
      'coordinator-report',
      'niclas-assessment',
      'run-complete',
    ]);
    assert.deepEqual(result.edgesTaken, ['e01', 'e03', 'e08', 'e18', 'e22', 'e24', 'e29', 'e30']);

    const summary = summariseEditorRun(result);
    assert.match(summary.headline, /Dry-run completed/);
    assert.equal(summary.path, result.path.join(' → '));
    assert.equal(summary.edges, result.edgesTaken.join(', '));
    assert.match(summary.usage, /0 provider turns/);
    assert.match(summary.reconcile, /Nothing to reconcile/);
  });

  it('follows a redirected edge on the canvas, not the file the graph came from', async () => {
    const original = loadGraph('docs/loop/graphs/dspatch-development-loop.graph.json');
    const edge = original.edges.find((entry) => entry.id === 'e08');
    assert.ok(edge, 'e08 is the router\'s implement branch on the ordinary walk');
    const edited = replaceEdge(original, 'e08', { ...edge, to: 'coordinator-report' });

    const before = await runCanvasGraph(original, { runId: 'editor-before-edit' });
    const after = await runCanvasGraph(edited, { runId: 'editor-after-edit' });

    assert.equal(before.status, 'completed');
    assert.equal(after.status, 'completed');
    assert.equal(after.usage.providerTurns, 0);
    assert.notDeepEqual(after.path, before.path, 'changing the drawing must change the path');
    assert.deepEqual(after.path, [
      'niclas-mandate',
      'coordinator',
      'route-next-step',
      'coordinator-report',
      'niclas-assessment',
      'run-complete',
    ]);
    assert.deepEqual(after.edgesTaken, ['e01', 'e03', 'e08', 'e29', 'e30']);
    assert.ok(!after.path.includes('implementer'), 'the skipped implementation chain must not be visited');
    assert.ok(!after.path.includes('verifier'));
  });

  it('dry-runs a newly placed two-node graph on first-branch', async () => {
    const drawn: LoopGraph = {
      format: 'dspatch-loop-graph',
      formatVersion: 1,
      id: 'just-drawn-this-evening',
      name: 'A new loop',
      purpose: 'A graph that exists only in memory, the way a just-placed canvas does.',
      target: 'cursor',
      entry: 'start',
      onRuntimeFault: 'stop-and-reconcile',
      failureKinds: [],
      nodes: [
        { id: 'start', kind: 'human', label: 'Start', purpose: 'Begin' },
        { id: 'end', kind: 'terminal', label: 'End' },
      ],
      edges: [{ id: 'e-go', from: 'start', to: 'end', when: { on: 'success' } }],
    };

    const result = await runCanvasGraph(drawn, { runId: 'editor-just-drawn' });
    assert.equal(result.status, 'completed');
    assert.equal(result.usage.providerTurns, 0);
    assert.deepEqual(result.path, ['start', 'end']);
    assert.deepEqual(result.edgesTaken, ['e-go']);
    assert.equal(describeLiveBinding(drawn).ready, false);
  });

  it('cancel stops the next step and does not reset the path already journalled', async () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-development-loop.graph.json');
    const abort = new AbortController();
    abort.abort();
    const snapshot = structuredClone(graph);

    const result = await runCanvasGraph(graph, {
      runId: 'editor-cancel',
      abortSignal: abort.signal,
    });

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'no-outcome-delivered');
    assert.deepEqual(result.path, ['niclas-mandate']);
    assert.deepEqual(result.edgesTaken, []);
    assert.equal(result.usage.providerTurns, 0);
    assert.deepEqual(graph, snapshot, 'cancel must not mutate the graph it was given');
    assert.match(summariseEditorRun(result).reconcile, /stop-and-reconcile/);
  });
});

describe('editorJournalOpen', () => {
  it('opens the pane while a run is in progress, even with no finished summary', () => {
    assert.equal(editorJournalOpen({ busy: true, summary: null, refuse: null }), true);
    assert.equal(editorJournalOpen({ busy: false, summary: null, refuse: null }), false);
    assert.equal(
      editorJournalOpen({
        busy: false,
        summary: null,
        refuse: 'This drawing has no live binding.',
      }),
      true,
    );
  });
});

describe('the Run button knows about runs this window did not start', () => {
  const ready = { ownRunBusy: false, activeRunId: null, blocked: false, reason: 'Walk the real graph.' };

  it('offers Run when nothing is running anywhere', () => {
    const offer = liveRunOffer(ready);
    assert.equal(offer.enabled, true);
    assert.equal(offer.title, 'Walk the real graph.');
  });

  it('withholds Run while a run started in another window is walking', () => {
    // The button used to read only this window's own `runBusy`, so a chat loop run
    // left the editor's Run enabled and the person learnt about the overlap by
    // pressing it.
    const offer = liveRunOffer({ ...ready, activeRunId: 'chat-loop-run-1' });
    assert.equal(
      offer.enabled,
      false,
      'a second live run must not be offered while one is walking, whichever window started it',
    );
    assert.match(
      offer.title,
      /already in progress/i,
      `a disabled button has to say why. It said: ${offer.title}`,
    );
    assert.match(
      offer.title,
      /stays exactly as it is/i,
      `and that waiting costs the author nothing. It said: ${offer.title}`,
    );
  });

  it('keeps its own wording for a run this window started', () => {
    const offer = liveRunOffer({ ...ready, ownRunBusy: true, activeRunId: 'editor-live-1', blocked: true });
    assert.equal(offer.enabled, false);
    assert.equal(offer.title, 'Walk the real graph.', 'this window already shows its own run and its Cancel');
  });

  it('still withholds Run for the reasons it had before', () => {
    const offer = liveRunOffer({ ...ready, blocked: true, reason: 'The graph has errors.' });
    assert.equal(offer.enabled, false);
    assert.equal(offer.title, 'The graph has errors.');
  });
});
