/**
 * DSP-209 S23b: `loop.saveGraph`'s checks, on a scratch project. No window, no run.
 *
 * Apply over an editor's save is a conflict and writes nothing; an editor's save over an Apply
 * is refused for its stale base; Discard writes nothing; Apply writes only inside the project
 * and never while a run of that loop is active; a new loop's files are written only if absent;
 * a save without the new fields writes as before; and nothing here can start a run.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { saveGraphChecked, type GraphSaveContext } from '../src/host/graph-save';
import { createProposal, drawingSaveRequest, graphContentHash, type GraphEditProposal } from '../src/shared/graph-proposal';

const here = path.dirname(fileURLToPath(import.meta.url));
const roots: string[] = [];
after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function graph(label: string, id = 'tiny'): string {
  return `${JSON.stringify(
    {
      format: 'dspatch-loop-graph',
      formatVersion: 1,
      id,
      name: 'Tiny',
      purpose: 'A test loop.',
      target: 'cursor',
      entry: 'start',
      onRuntimeFault: 'stop-and-reconcile',
      failureKinds: [],
      nodes: [
        { id: 'start', kind: 'human', label: 'Start', view: { x: 48, y: 40 } },
        { id: 'done', kind: 'terminal', label, view: { x: 48, y: 200 } },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'done', when: { on: 'success' } }],
    },
    null,
    2,
  )}\n`;
}

function scratch(): { root: string; graphPath: string; snapshot: () => Record<string, string> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-graph-save-'));
  roots.push(root);
  const graphPath = path.join(root, '.dspatch', 'loops', 'tiny.graph.json');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, graph('Done'));
  const snapshot = (): Record<string, string> => {
    const files: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          files[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
        }
      }
    };
    walk(root);
    return files;
  };
  return { root, graphPath, snapshot };
}

function contextFor(folders: readonly string[], proposals: GraphEditProposal[], activeRunGraphId: string | null = null): GraphSaveContext {
  return {
    projectFolders: folders,
    activeRunGraphId,
    proposal: (conversationId, proposalId) => proposals.find((each) => each.conversationId === conversationId && each.id === proposalId) ?? null,
    keep: (proposal) => {
      const at = proposals.findIndex((each) => each.id === proposal.id);
      proposals[at] = proposal;
    },
  };
}

function existingProposal(graphPath: string, base: string, text: string): GraphEditProposal {
  return createProposal({
    id: 'p1',
    conversationId: 'c1',
    target: { definitionPath: path.join(path.dirname(graphPath), 'tiny.loop.json'), graphPath },
    baseText: base,
    graphText: text,
    explanation: 'A better ending.',
  });
}

const apply = { conversationId: 'c1', proposalId: 'p1', action: 'apply' as const };

describe('loop.saveGraph checks (DSP-209 S23b)', () => {
  it('makes Apply after an editor save a conflict, and writes nothing', () => {
    const { root, graphPath } = scratch();
    const original = fs.readFileSync(graphPath, 'utf8');
    const proposals = [existingProposal(graphPath, original, graph('Proposed'))];
    const context = contextFor([root], proposals);
    const edited = graph('Edited by hand');
    assert.equal(saveGraphChecked({ path: graphPath, text: edited, expectedContentHash: graphContentHash(original) }, context).kind, 'written');
    const outcome = saveGraphChecked({ path: graphPath, text: '', proposal: apply }, context);
    assert.ok(outcome.kind === 'refused' && outcome.reason === 'conflict' && outcome.note.includes('changed in the editor since'), JSON.stringify(outcome));
    assert.equal(fs.readFileSync(graphPath, 'utf8'), edited, 'the hand edit stands');
    assert.equal(proposals[0]?.status, 'conflict');
  });

  it('refuses an editor save after Apply for its stale base', () => {
    const { root, graphPath } = scratch();
    const original = fs.readFileSync(graphPath, 'utf8');
    const proposals = [existingProposal(graphPath, original, graph('Proposed'))];
    const context = contextFor([root], proposals);
    const applied = saveGraphChecked({ path: graphPath, text: '', proposal: apply }, context);
    assert.ok(applied.kind === 'written' && applied.status === 'applied');
    assert.equal(proposals[0]?.status, 'applied');
    const stale = saveGraphChecked({ path: graphPath, text: graph('Stale editor'), expectedContentHash: graphContentHash(original) }, context);
    assert.ok(stale.kind === 'refused' && stale.reason === 'stale-base', JSON.stringify(stale));
    assert.equal(fs.readFileSync(graphPath, 'utf8'), graph('Proposed'), 'the applied change is not overwritten');
    // Without the field, a save writes as it always did, for an older window.
    assert.equal(saveGraphChecked({ path: graphPath, text: graph('Old window') }, context).kind, 'written');
    assert.equal(fs.readFileSync(graphPath, 'utf8'), graph('Old window'));
  });

  it('refuses the unsaved-drawing question’s Save after Apply, as a direct Save is refused (review B1)', () => {
    const { root, graphPath } = scratch();
    const original = fs.readFileSync(graphPath, 'utf8');
    const proposals = [existingProposal(graphPath, original, graph('Proposed'))];
    const context = contextFor([root], proposals);
    assert.equal(saveGraphChecked({ path: graphPath, text: '', proposal: apply }, context).kind, 'written');
    // The editor registered its drawing with the hash of the file it loaded, before the Apply.
    const drawing = { path: graphPath, text: graph('Stale drawing'), graphName: 'Tiny', baseContentHash: graphContentHash(original) };
    assert.deepEqual(drawingSaveRequest(drawing), { path: graphPath, text: graph('Stale drawing'), expectedContentHash: graphContentHash(original) });
    const refused = saveGraphChecked(drawingSaveRequest(drawing), context);
    assert.ok(refused.kind === 'refused' && refused.reason === 'stale-base', JSON.stringify(refused));
    assert.equal(fs.readFileSync(graphPath, 'utf8'), graph('Proposed'), 'the applied proposal stands');
    // An older window's drawing carries no hash and is saved as before.
    assert.deepEqual(drawingSaveRequest({ path: graphPath, text: 'x' }), { path: graphPath, text: 'x' });
  });

  it('leaves every file untouched on Discard', () => {
    const { root, graphPath, snapshot } = scratch();
    const proposals = [existingProposal(graphPath, fs.readFileSync(graphPath, 'utf8'), graph('Proposed'))];
    const before = snapshot();
    const outcome = saveGraphChecked({ path: graphPath, text: graph('Ignored'), proposal: { ...apply, action: 'discard' } }, contextFor([root], proposals));
    assert.ok(outcome.kind === 'refused' && outcome.reason === 'discarded');
    assert.equal(proposals[0]?.status, 'discarded');
    assert.deepEqual(snapshot(), before);
  });

  it('refuses a target outside the project folders, and while a run of that loop is active', () => {
    const { root, graphPath, snapshot } = scratch();
    const elsewhere = scratch();
    const before = snapshot();
    const proposals = [existingProposal(graphPath, fs.readFileSync(graphPath, 'utf8'), graph('Proposed'))];
    const outside = saveGraphChecked({ path: graphPath, text: '', proposal: apply }, contextFor([elsewhere.root], proposals));
    assert.ok(outside.kind === 'refused' && outside.reason === 'outside-project' && outside.note.includes(graphPath), JSON.stringify(outside));
    const running = saveGraphChecked({ path: graphPath, text: '', proposal: apply }, contextFor([root], proposals, 'tiny'));
    assert.ok(running.kind === 'refused' && running.reason === 'run-active', JSON.stringify(running));
    assert.equal(proposals[0]?.status, 'proposed', 'still open: neither refusal is a conflict');
    assert.deepEqual(snapshot(), before);
  });

  it('writes a new loop’s graph, definition and role files only when they are absent', () => {
    const { root, snapshot } = scratch();
    const loops = path.join(root, '.dspatch', 'loops');
    const target = {
      newLoop: {
        definitionPath: path.join(loops, 'fresh.loop.json'),
        graphPath: path.join(loops, 'fresh.graph.json'),
        definitionText: '{"format":"dspatch-loop-definition","formatVersion":1,"id":"fresh","name":"Fresh","graph":"fresh.graph.json"}\n',
      },
    };
    const make = (): GraphEditProposal =>
      createProposal({
        id: 'p1',
        conversationId: 'c1',
        target,
        baseText: null,
        graphText: graph('Done', 'fresh'),
        roleFiles: [{ path: path.join(loops, 'roles', 'fresh-worker.role.md'), text: 'Work.\n' }],
        explanation: 'New.',
      });
    // Absent: all three are written.
    const proposals = [make()];
    const written = saveGraphChecked({ path: '', text: '', proposal: apply }, contextFor([root], proposals));
    assert.ok(written.kind === 'written', JSON.stringify(written));
    assert.equal(fs.readFileSync(target.newLoop.graphPath, 'utf8'), graph('Done', 'fresh'));
    assert.equal(fs.readFileSync(target.newLoop.definitionPath, 'utf8'), target.newLoop.definitionText);
    assert.equal(fs.readFileSync(path.join(loops, 'roles', 'fresh-worker.role.md'), 'utf8'), 'Work.\n');
    // Present: a second new-loop proposal for the same files is a conflict and writes nothing.
    fs.writeFileSync(target.newLoop.definitionPath, 'kept by hand\n');
    fs.rmSync(target.newLoop.graphPath);
    const before = snapshot();
    const again = [make()];
    const conflict = saveGraphChecked({ path: '', text: '', proposal: apply }, contextFor([root], again));
    assert.ok(conflict.kind === 'refused' && conflict.reason === 'conflict', JSON.stringify(conflict));
    assert.deepEqual(snapshot(), before, 'not even the absent graph is written');
  });

  it('can start no run: the save path reaches nothing that runs a loop', () => {
    for (const file of [path.join(here, '..', 'src', 'host', 'graph-save.ts'), path.join(here, '..', 'src', 'renderer', 'GraphProposalCard.tsx')]) {
      const source = fs.readFileSync(file, 'utf8');
      for (const runner of ['runLoopGraph', 'runLiveGraph', 'startChatLoopRun', 'startEditorLoopRun', 'loop-live', 'loop-run\'']) {
        assert.ok(!source.includes(runner), `${path.basename(file)} does not reach ${runner}`);
      }
    }
  });
});
