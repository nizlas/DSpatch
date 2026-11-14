/**
 * DSP-209 S23a: the chat's graph tools on a scratch project. No provider, no window.
 *
 * What a person relies on: an invalid draft comes back with its findings and is not kept; no
 * tool writes anything under the project; a newer proposal supersedes an older one; the
 * graph as it is on disk reports what was changed by hand; and a loop step never gets them.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { graphAuthoringTools, type GraphAuthoringHost } from '../src/host/graph-authoring-tools';
import { graphContentHash, isNewLoopTarget, supersedeWith, type GraphEditProposal } from '../src/shared/graph-proposal';
import { parseLoopDefinition } from '../src/shared/loop-definition';
import { parseLoopGraph } from '../src/shared/loop-graph-load';

const here = path.dirname(fileURLToPath(import.meta.url));
const scratchRoots: string[] = [];
after(() => {
  for (const root of scratchRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function graph(id: string, nodes: readonly Record<string, unknown>[], edges: readonly Record<string, unknown>[], entry = 'start'): string {
  return `${JSON.stringify(
    {
      format: 'dspatch-loop-graph',
      formatVersion: 1,
      id,
      name: `Loop ${id}`,
      purpose: 'A test loop.',
      target: 'cursor',
      entry,
      onRuntimeFault: 'stop-and-reconcile',
      failureKinds: [],
      nodes,
      edges,
    },
    null,
    2,
  )}\n`;
}

const TINY = graph(
  'tiny',
  [
    { id: 'start', kind: 'human', label: 'Start', view: { x: 48, y: 40 } },
    { id: 'done', kind: 'terminal', label: 'Done', view: { x: 48, y: 200 } },
  ],
  [{ id: 'e1', from: 'start', to: 'done', when: { on: 'success' } }],
);

/** A scratch project with one loop of its own, and every file in it, read back. */
function project(): { readonly root: string; readonly snapshot: () => Record<string, string>; readonly graphPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-graph-tools-'));
  scratchRoots.push(root);
  const loops = path.join(root, '.dspatch', 'loops');
  fs.mkdirSync(loops, { recursive: true });
  fs.writeFileSync(
    path.join(loops, 'tiny.loop.json'),
    JSON.stringify({ format: 'dspatch-loop-definition', formatVersion: 1, id: 'tiny', name: 'Tiny loop', graph: 'tiny.graph.json' }, null, 2),
  );
  const graphPath = path.join(loops, 'tiny.graph.json');
  fs.writeFileSync(graphPath, TINY);
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
  return { root, snapshot, graphPath };
}

function hostFor(root: string): { readonly host: GraphAuthoringHost; readonly kept: () => readonly GraphEditProposal[]; readonly set: (next: readonly GraphEditProposal[]) => void } {
  let proposals: readonly GraphEditProposal[] = [];
  let counter = 0;
  const host: GraphAuthoringHost = {
    folders: () => [root],
    ownRoot: () => null,
    conversationId: () => 'conv-1',
    proposals: () => proposals,
    record: (proposal) => {
      proposals = supersedeWith(proposals, proposal);
      return { ok: true };
    },
    newId: () => {
      counter += 1;
      return `proposal-${String(counter)}`;
    },
  };
  return { host, kept: () => proposals, set: (next) => (proposals = next) };
}

function tool(host: GraphAuthoringHost, name: string): (args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }> {
  const found = graphAuthoringTools(host).find((each) => each.name === name);
  assert.ok(found, `${name} is offered`);
  return (args) => found.execute(args);
}

describe('graph tools on the chat session (DSP-209 S23a)', () => {
  it('lists the project’s loops and describes the building blocks, provider limits included', async () => {
    const { root } = project();
    const { host } = hostFor(root);
    const listed = await tool(host, 'list_loops')({});
    assert.ok(!listed.isError && listed.text.includes('tiny — Tiny loop [project]'), listed.text);
    const blocks = await tool(host, 'describe_loop_building_blocks')({});
    assert.ok(blocks.text.includes('fanOut') && blocks.text.includes('cursor:') && blocks.text.includes('claude:'), 'every provider is described');
    assert.ok(/unmet|other-means/.test(blocks.text), 'what a provider cannot hold is said plainly');
  });

  it('returns an invalid draft’s findings to the agent and keeps nothing', async () => {
    const { root, snapshot } = project();
    const { host, kept } = hostFor(root);
    const before = snapshot();
    const invalid = graph('tiny', [{ id: 'start', kind: 'human', label: 'Start' }], [{ id: 'e1', from: 'start', to: 'nowhere', when: { on: 'success' } }]);
    const answer = await tool(host, 'propose_loop_graph')({ target: 'tiny', graphText: invalid, explanation: 'Shorter.' });
    assert.equal(answer.isError, true);
    assert.match(answer.text, /has errors, so it was not kept/);
    assert.match(answer.text, /error /);
    assert.deepEqual(kept(), []);
    assert.deepEqual(snapshot(), before, 'nothing under the project changed');
  });

  it('keeps a valid proposal against the disk, supersedes the older one, and writes nothing', async () => {
    const { root, snapshot } = project();
    const { host, kept } = hostFor(root);
    const before = snapshot();
    const relabelled = TINY.replace('"Done"', '"Finished"');
    const first = await tool(host, 'propose_loop_graph')({ target: 'tiny', graphText: relabelled, explanation: 'A clearer ending.' });
    assert.equal(first.isError, false, first.text);
    assert.match(first.text, /Nothing has been written/);
    const second = await tool(host, 'propose_loop_graph')({ target: 'tiny', graphText: TINY.replace('"Done"', '"Complete"'), explanation: 'Better still.' });
    assert.equal(second.isError, false, second.text);
    assert.deepEqual(kept().map((each) => [each.id, each.status]), [['proposal-1', 'superseded'], ['proposal-2', 'proposed']]);
    assert.equal(kept()[1]?.baseContentHash, graphContentHash(TINY), 'made against the file on disk');
    assert.deepEqual(kept()[1]?.explanation, { source: 'agent', text: 'Better still.' });
    assert.deepEqual(snapshot(), before, 'nothing under the project changed');
  });

  it('proposes a new loop in the project’s .dspatch/loops, places unplaced nodes, and still writes nothing', async () => {
    const { root, snapshot } = project();
    const { host, kept } = hostFor(root);
    const before = snapshot();
    const draft = graph(
      'fresh',
      [
        { id: 'start', kind: 'agent', label: 'Work', role: { id: 'fresh-worker', source: { kind: 'role-source', path: '.dspatch/loops/roles/fresh-worker.role.md' } } },
        { id: 'done', kind: 'terminal', label: 'Done' },
      ],
      [{ id: 'e1', from: 'start', to: 'done', when: { on: 'success' } }],
    );
    const answer = await tool(host, 'propose_loop_graph')({
      target: 'new:fresh',
      graphText: draft,
      explanation: 'One step and an ending.',
      roleFiles: ['worker\nYou do the work the mandate asks for.'],
    });
    assert.equal(answer.isError, false, answer.text);
    const proposal = kept()[0];
    assert.ok(proposal !== undefined && isNewLoopTarget(proposal.target));
    assert.equal(proposal.target.newLoop.graphPath, path.join(root, '.dspatch', 'loops', 'fresh.graph.json'));
    assert.equal(proposal.target.newLoop.definitionPath, path.join(root, '.dspatch', 'loops', 'fresh.loop.json'));
    const definition = parseLoopDefinition(proposal.target.newLoop.definitionText);
    assert.ok(definition.ok && definition.definition.graph === '.dspatch/loops/fresh.graph.json');
    assert.deepEqual(proposal.roleFiles.map((file) => file.path), [path.join(root, '.dspatch', 'loops', 'roles', 'fresh-worker.role.md')]);
    const parsed = parseLoopGraph(proposal.graphText);
    assert.ok(parsed.ok && parsed.graph.nodes.every((node) => node.view !== undefined), 'every node has a position');
    assert.deepEqual(snapshot(), before, 'no definition, graph or role file was written');
    // A new loop whose id is taken is refused.
    const taken = await tool(host, 'propose_loop_graph')({ target: 'new:tiny', graphText: draft, explanation: 'Again.' });
    assert.equal(taken.isError, true);
  });

  it('reads the graph as it is on disk, with what was changed by hand since the last applied proposal', async () => {
    const { root, graphPath } = project();
    const { host, kept, set } = hostFor(root);
    const none = await tool(host, 'read_loop_graph')({ loopId: 'tiny' });
    assert.match(none.text, /No proposal for this loop has been applied/);
    assert.ok(none.text.includes('"Done"'));
    await tool(host, 'propose_loop_graph')({ target: 'tiny', graphText: TINY, explanation: 'As it is.' });
    // As S23b's Apply will leave it: applied, with the same text on disk.
    set(kept().map((each) => ({ ...each, status: 'applied' as const })));
    assert.match((await tool(host, 'read_loop_graph')({ loopId: 'tiny' })).text, /Unchanged since the last proposal applied/);
    // The person edits the file by hand.
    fs.writeFileSync(graphPath, TINY.replace('"Done"', '"Done by hand"'));
    const edited = await tool(host, 'read_loop_graph')({ loopId: 'tiny' });
    assert.match(edited.text, /Changed by hand since the last applied proposal/);
    assert.ok(edited.text.includes('Done by hand'));
  });

  it('is never offered to a loop step', () => {
    // Loop steps get their tools in loop-live.ts and nowhere else: the mailbox tools for a
    // branch and the handoff tool where the drawing offers it. Neither file reaches these.
    for (const file of ['loop-live.ts', 'loop-live-run.ts', 'loop-run-agent.ts']) {
      const source = fs.readFileSync(path.join(here, '..', 'src', 'main', file), 'utf8');
      assert.ok(!source.includes('graph-authoring-tools') && !source.includes('propose_loop_graph'), `${file} does not offer the graph tools`);
    }
    // The host builds them only into the chat session's app tools.
    const host = fs.readFileSync(path.join(here, '..', 'src', 'host', 'project-host.ts'), 'utf8');
    assert.equal(host.split('graphAuthoringTools(').length - 1, 1, 'built in one place');
    assert.match(host, /appTools: \(\) => chatWorkspaceTools\(\)/);
  });
});
