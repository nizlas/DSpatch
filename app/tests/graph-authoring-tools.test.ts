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
import { saveGraphChecked } from '../src/host/graph-save';
import { discoverLoopDefinitions } from '../src/main/loop-definition-files';
import { openChosenLoop, rowForKey } from '../src/main/loop-definition-choice';
import { openedFromDefinition } from '../src/main/loop-graph-open';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { editorOpenFor, graphContentHash, isNewLoopTarget, supersedeWith, type GraphEditProposal } from '../src/shared/graph-proposal';
import { resolverFromEntries } from '../src/shared/loop-graph-editing';
import { parseLoopDefinition } from '../src/shared/loop-definition';
import { hasErrors, loadLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';

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

const ROLE_WORKER = ['---', 'role: worker', 'title: Worker', 'summary: Does the work.', 'targets: cursor', '---', '', '## Purpose', '', 'You do the work the mandate asks for.'].join('\n');

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
        { id: 'start', kind: 'agent', label: 'Work', role: { id: 'worker', source: { kind: 'role-source', path: '.dspatch/loops/roles/fresh-worker.role.md' } } },
        { id: 'done', kind: 'terminal', label: 'Done' },
      ],
      [{ id: 'e1', from: 'start', to: 'done', when: { on: 'success' } }],
    );
    const answer = await tool(host, 'propose_loop_graph')({
      target: 'new:fresh',
      graphText: draft,
      explanation: 'One step and an ending.',
      roleFiles: [ROLE_WORKER],
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

  it('gives a project without roles a loop from what the tools say alone, its roles in the same proposal, written only by Apply', async () => {
    // A project with nothing of DSpatch's in it: no .dspatch folder, no role files.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-graph-tools-bare-'));
    scratchRoots.push(root);
    fs.writeFileSync(path.join(root, 'README.md'), 'A project.\n');
    const { host, kept } = hostFor(root);
    const files = (): readonly string[] => fs.readdirSync(root, { recursive: true }).map(String).sort();
    const before = files();

    // The agent's only source: the building blocks' smallest graph and role source.
    const blocks = (await tool(host, 'describe_loop_building_blocks')({})).text;
    const graphText = /```json\n([\s\S]*?)\n```/.exec(blocks)?.[1];
    const roleText = /```markdown\n([\s\S]*?)\n```/.exec(blocks)?.[1];
    assert.ok(graphText !== undefined && roleText !== undefined, 'the building blocks show a graph and a role source');
    assert.ok(!blocks.includes('GRAPH_FORMAT.md'), 'nothing points at a file in DSpatch’s own repository');

    // A guessed path is refused with the reference that works.
    const guessed = graphText.replace('.dspatch/loops/roles/example-worker.role.md', '.dspatch/roles/worker.role.md');
    const wrong = await tool(host, 'propose_loop_graph')({ target: 'new:example', graphText: guessed, explanation: 'One step.', roleFiles: [roleText] });
    assert.equal(wrong.isError, true);
    assert.ok(wrong.text.includes('{"id":"worker","source":{"kind":"role-source","path":".dspatch/loops/roles/example-worker.role.md"}}'), wrong.text);
    // A role text that is not a role source is refused with what is wrong and the form to use.
    const plain = await tool(host, 'propose_loop_graph')({ target: 'new:example', graphText, explanation: 'One step.', roleFiles: ['worker\nDo the work.'] });
    assert.equal(plain.isError, true);
    assert.match(plain.text, /not a role source[\s\S]*---\nrole: worker/);
    assert.deepEqual(kept(), []);

    const answer = await tool(host, 'propose_loop_graph')({ target: 'new:example', graphText, explanation: 'One step.', roleFiles: [roleText] });
    assert.equal(answer.isError, false, answer.text);
    const proposal = kept()[0];
    assert.ok(proposal !== undefined);
    const rolePath = path.join(root, '.dspatch', 'loops', 'roles', 'example-worker.role.md');
    assert.deepEqual(
      isNewLoopTarget(proposal.target) ? [proposal.target.newLoop.graphPath, proposal.target.newLoop.definitionPath, ...proposal.roleFiles.map((file) => file.path)] : [],
      [path.join(root, '.dspatch', 'loops', 'example.graph.json'), path.join(root, '.dspatch', 'loops', 'example.loop.json'), rolePath],
      'the proposal holds the graph, the definition and the role, which the card lists',
    );
    assert.deepEqual(files(), before, 'proposing wrote nothing');

    const context = (activeRunGraphId: string | null) => ({
      projectFolders: [root],
      activeRunGraphId,
      proposal: () => kept().find((each) => each.id === proposal.id) ?? null,
      keep: () => undefined,
    });
    const act = (action: 'apply' | 'discard', activeRunGraphId: string | null = null) =>
      saveGraphChecked({ path: '', text: '', proposal: { conversationId: 'conv-1', proposalId: proposal.id, action } }, context(activeRunGraphId));
    assert.equal(act('discard').kind, 'refused');
    assert.deepEqual(files(), before, 'Discard wrote nothing');
    assert.equal(act('apply', 'example').kind, 'refused', 'not while a run of it is active');
    assert.deepEqual(files(), before);
    assert.equal(act('apply').kind, 'written');
    assert.equal(fs.readFileSync(rolePath, 'utf8'), `${roleText}\n`);
    // Once written, the graph reads from disk without errors: the role resolves as it did when proposed.
    const loaded = loadLoopGraph(fs.readFileSync(path.join(root, '.dspatch', 'loops', 'example.graph.json'), 'utf8'), { resolveRole: createFileRoleResolver(root) });
    assert.ok(!hasErrors(loaded.findings), JSON.stringify(loaded.findings));

    // The card's Open in editor, the way the editor and host take it: the definition is chosen
    // (the host's chooseLoop: the row for that key, opened) and its graph drawn from the
    // project, with the project's roles. Opening the graph file alone read roles from
    // DSpatch's own copy, and every role was refused (MiniDAWLab, af8b60c).
    const asked = editorOpenFor(proposal);
    assert.deepEqual(asked, { path: path.join(root, '.dspatch', 'loops', 'example.loop.json'), as: 'loop' });
    const opened = openedFromDefinition(openChosenLoop(rowForKey(discoverLoopDefinitions([root]).rows, asked.path)));
    assert.equal(opened.kind, 'read', JSON.stringify(opened));
    assert.ok(opened.kind === 'read');
    assert.equal(opened.definition?.id, 'example', 'the Loop chooser names the loop');
    assert.equal(path.resolve(opened.projectRoot), path.resolve(root), 'roles are read from the project');
    const drawn = loadLoopGraph(opened.text, { resolveRole: resolverFromEntries(new Map(opened.roles.map((entry) => [entry.key, entry.role]))) });
    assert.ok(drawn.ok && !hasErrors(drawn.findings), JSON.stringify(drawn.findings));
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
