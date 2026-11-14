/**
 * DSP-209 S17: the graph-edit proposal model (R1).
 *
 * Acceptance: (1) proposals against all eight bundled graphs report the exact changes;
 * (2) disk content that differs from the base gives `conflict` on apply; (3) a
 * position-only edit is reported as layout only. Reference expectations for a rename are
 * computed here from the format's eight node-id fields, independently of the module,
 * which finds them through S15's `replaceNode`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  AGENT_WORDS_LABEL,
  applyProposal,
  createProposal,
  describeChangeLines,
  describeGraphChange,
  discardProposal,
  graphContentHash,
  manualEditsSince,
  reconcileDisk,
  supersedeWith,
} from '../src/shared/graph-proposal';
import type { GraphEditProposal, ReferenceFollowed } from '../src/shared/graph-proposal';
import { replaceNode } from '../src/shared/loop-graph-editing';
import { loadLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import type { LoopGraph, LoopNode } from '../src/shared/loop-graph';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const graphsDir = path.join(repoRoot, 'docs', 'loop', 'graphs');
const bundled = fs
  .readdirSync(graphsDir)
  .filter((name) => name.endsWith('.graph.json'))
  .sort();

function read(name: string): { text: string; graph: LoopGraph } {
  const text = fs.readFileSync(path.join(graphsDir, name), 'utf8');
  const parsed = parseLoopGraph(text);
  assert.ok(parsed.ok, `${name} parses`);
  return { text, graph: parsed.graph };
}

/** Independent oracle: every place the format holds node id `id` (the eight fields S15 names). */
function expectedReferences(graph: LoopGraph, id: string): ReferenceFollowed[] {
  const out: ReferenceFollowed[] = [];
  if (graph.entry === id) out.push({ in: 'graph', field: 'entry' });
  for (const node of graph.nodes) {
    if (node.id === id) continue;
    if (node.report?.writtenBy === id) out.push({ in: 'node', id: node.id, field: 'report.writtenBy' });
    if (node.consumes?.includes(id)) out.push({ in: 'node', id: node.id, field: 'consumes' });
    if (node.fanOut?.slicesFrom === id) out.push({ in: 'node', id: node.id, field: 'fanOut.slicesFrom' });
  }
  for (const edge of graph.edges) {
    if (edge.from === id) out.push({ in: 'edge', id: edge.id, field: 'from' });
    if (edge.to === id) out.push({ in: 'edge', id: edge.id, field: 'to' });
    if (edge.delivers?.includes(id)) out.push({ in: 'edge', id: edge.id, field: 'delivers' });
    if (edge.skips?.includes(id)) out.push({ in: 'edge', id: edge.id, field: 'skips' });
  }
  return out;
}

const key = (reference: ReferenceFollowed): string => `${reference.in}|${reference.id ?? ''}|${reference.field}`;
const sorted = (references: readonly ReferenceFollowed[]): string[] => references.map(key).sort();

function proposalFor(baseText: string, graphText: string, id = 'p1'): GraphEditProposal {
  return createProposal({
    id,
    conversationId: 'conv-1',
    target: { definitionPath: '.dspatch/loops/x.loop.json', graphPath: 'docs/loop/graphs/x.graph.json' },
    baseText,
    graphText,
    explanation: 'I added a review step.',
  });
}

describe('bundled graphs', () => {
  it('there are eight, and each loads without errors as it stands', () => {
    assert.equal(bundled.length, 8);
    for (const name of bundled) {
      const { text } = read(name);
      assert.ok(loadLoopGraph(text).ok, `${name} loads`);
    }
  });

  for (const name of bundled) {
    describe(name, () => {
      const { text, graph } = read(name);

      it('the same graph is no change', () => {
        const again = parseLoopGraph(text);
        assert.ok(again.ok);
        const change = describeGraphChange(graph, again.graph);
        assert.equal(change.unchanged, true);
        assert.equal(change.layoutOnly, false);
        assert.deepEqual(describeChangeLines(change), ['No change.']);
      });

      it('a position-only edit is reported as layout only', () => {
        const [first, second] = graph.nodes;
        const moved: LoopGraph = {
          ...graph,
          nodes: graph.nodes.map((node) =>
            node === first || node === second
              ? { ...node, view: { x: (node.view?.x ?? 0) + 20, y: (node.view?.y ?? 0) - 8 } }
              : node,
          ),
        };
        const proposal = proposalFor(text, serialiseLoopGraph(moved));
        assert.ok(proposal.change);
        assert.equal(proposal.change.layoutOnly, true);
        assert.equal(proposal.change.unchanged, false);
        assert.deepEqual(proposal.change.moved, [first!.id, second!.id]);
        assert.match(describeChangeLines(proposal.change)[0]!, /^Layout only: 2 nodes moved/);
      });

      it('renaming the entry node reports one rename with every reference it follows, and nothing else', () => {
        const entry = graph.nodes.find((node) => node.id === graph.entry)!;
        const to = `${entry.id}-renamed`;
        const after = replaceNode(graph, entry.id, { ...entry, id: to });
        const change = describeGraphChange(graph, after);
        assert.equal(change.renamed.length, 1);
        assert.equal(change.renamed[0]!.from, entry.id);
        assert.equal(change.renamed[0]!.to, to);
        assert.deepEqual(sorted(change.renamed[0]!.references), sorted(expectedReferences(graph, entry.id)));
        assert.ok(change.renamed[0]!.references.some((reference) => reference.field === 'entry'));
        assert.deepEqual(change.nodes, { added: [], removed: [], changed: [] });
        assert.deepEqual(change.edges, { added: [], removed: [], changed: [] });
        assert.deepEqual(change.graph, []);
        assert.equal(change.layoutOnly, false);
      });

      it('additions, removals and field edits are reported exactly', () => {
        const lastEdge = graph.edges[graph.edges.length - 1]!;
        const firstEdge = graph.edges[0]!;
        const relabelled = graph.nodes[0]!;
        const extra: LoopNode = { id: 'proposal-extra', kind: 'terminal', ending: 'not-success', view: { x: 1, y: 2 } };
        const after: LoopGraph = {
          ...graph,
          name: `${graph.name} (revised)`,
          nodes: [
            ...graph.nodes.map((node) =>
              node === relabelled ? { ...node, label: 'Relabelled', limits: { ...node.limits, maxCalls: 99 } } : node,
            ),
            extra,
          ],
          edges: graph.edges
            .filter((edge) => edge !== lastEdge)
            .map((edge) => (edge === firstEdge ? { ...edge, label: 'new label' } : edge)),
        };
        const proposal = proposalFor(text, serialiseLoopGraph(after));
        const change = proposal.change!;
        assert.deepEqual(change.graph, [{ field: 'name', before: graph.name, after: `${graph.name} (revised)` }]);
        assert.deepEqual(change.renamed, []);
        assert.deepEqual(change.nodes.added, ['proposal-extra']);
        assert.deepEqual(change.nodes.removed, []);
        const expectedNodeFields = [
          ...(relabelled.label === 'Relabelled' ? [] : [{ field: 'label', before: relabelled.label, after: 'Relabelled' }]),
          ...(relabelled.limits?.maxCalls === 99
            ? []
            : [{ field: relabelled.limits ? 'limits.maxCalls' : 'limits', before: relabelled.limits ? relabelled.limits.maxCalls : undefined, after: relabelled.limits ? 99 : { maxCalls: 99 } }]),
        ];
        assert.deepEqual(change.nodes.changed, [{ id: relabelled.id, fields: expectedNodeFields }]);
        assert.deepEqual(change.edges.added, []);
        assert.deepEqual(change.edges.removed, lastEdge === firstEdge ? [] : [lastEdge.id]);
        if (lastEdge !== firstEdge) {
          assert.deepEqual(change.edges.changed, [
            { id: firstEdge.id, fields: [{ field: 'label', before: firstEdge.label, after: 'new label' }] },
          ]);
        }
        assert.equal(change.layoutOnly, false);
        assert.deepEqual(change.reordered, { nodes: false, edges: false });
        const lines = describeChangeLines(change);
        assert.ok(lines.includes('Node "proposal-extra" added.'));
        if (lastEdge !== firstEdge) assert.ok(lines.includes(`Edge "${lastEdge.id}" removed.`));
      });

      it("the proposal's findings are the existing validation's, unchanged", () => {
        const proposal = proposalFor(text, text);
        assert.deepEqual(proposal.findings, loadLoopGraph(text).findings);
        assert.equal(proposal.change?.unchanged, true);
      });
    });
  }
});

describe('a renamed node with edits, and a reorder', () => {
  const { graph } = read('dspatch-development-loop.graph.json');

  it('a rename that also changes the label is a rename plus a field change', () => {
    const node = graph.nodes.find((each) => each.id !== graph.entry && each.kind === 'agent')!;
    const after = replaceNode(graph, node.id, { ...node, id: 'renamed', label: 'Changed label' });
    const change = describeGraphChange(graph, after);
    assert.equal(change.renamed.length, 1);
    assert.deepEqual(sorted(change.renamed[0]!.references), sorted(expectedReferences(graph, node.id)));
    assert.deepEqual(change.nodes.changed, [
      { id: 'renamed', fields: [{ field: 'label', before: node.label, after: 'Changed label' }] },
    ]);
  });

  it('a reordered node list is reported, and is not layout only', () => {
    const after = { ...graph, nodes: [...graph.nodes].reverse() };
    const change = describeGraphChange(graph, after);
    assert.equal(change.reordered.nodes, true);
    assert.equal(change.layoutOnly, false);
    assert.equal(change.unchanged, false);
  });
});

describe('applying', () => {
  const { text, graph } = read('dspatch-mission-loop.graph.json');
  const changed = serialiseLoopGraph({ ...graph, name: 'Changed' });

  it('applies when disk still holds the base, and only returns what to write', () => {
    const proposal = proposalFor(text, changed);
    assert.equal(proposal.status, 'proposed');
    assert.equal(proposal.baseContentHash, graphContentHash(text));
    assert.deepEqual(proposal.explanation, { source: 'agent', text: 'I added a review step.' });
    assert.equal(AGENT_WORDS_LABEL, "The agent's words");
    const result = applyProposal(proposal, { graph: text });
    assert.equal(result.outcome, 'applied');
    assert.equal(result.proposal.status, 'applied');
    assert.ok(result.outcome === 'applied');
    assert.deepEqual(result.write, { graphPath: 'docs/loop/graphs/x.graph.json', graphText: changed, roleFiles: [] });
  });

  it('a disk content that differs from the base gives conflict and nothing to write', () => {
    const proposal = proposalFor(text, changed);
    for (const disk of [`${text} `, text.replace(/\r?\n/g, '\r\n') === text ? text.replace(/\r\n/g, '\n') : text.replace(/\n/g, '\r\n'), null]) {
      const result = applyProposal(proposal, { graph: disk });
      assert.equal(result.outcome, 'conflict');
      assert.equal(result.proposal.status, 'conflict');
      assert.equal('write' in result, false);
    }
  });

  it('a new loop conflicts when its files exist, and writes its definition when they do not', () => {
    const proposal = createProposal({
      id: 'p-new',
      conversationId: 'conv-1',
      target: { newLoop: { definitionPath: '.dspatch/loops/n.loop.json', graphPath: 'n.graph.json', definitionText: '{}' } },
      baseText: null,
      graphText: text,
      roleFiles: [{ path: 'roles/r.md', text: 'role' }],
      explanation: 'New loop.',
    });
    assert.equal(proposal.baseContentHash, null);
    assert.equal(proposal.change?.nodes.added.length, graph.nodes.length);
    assert.equal(applyProposal(proposal, { graph: 'x', definition: null, roles: { 'roles/r.md': null } }).outcome, 'conflict');
    assert.equal(applyProposal(proposal, { graph: null, definition: '{}', roles: { 'roles/r.md': null } }).outcome, 'conflict');
    assert.equal(applyProposal(proposal, { graph: null, definition: null, roles: { 'roles/r.md': 'other' } }).outcome, 'conflict');
    assert.equal(applyProposal(proposal, { graph: null, definition: null }).outcome, 'conflict');
    const result = applyProposal(proposal, { graph: null, definition: null, roles: { 'roles/r.md': null } });
    assert.ok(result.outcome === 'applied');
    assert.deepEqual(result.write.definition, { path: '.dspatch/loops/n.loop.json', text: '{}' });
    assert.deepEqual(result.write.roleFiles, [{ path: 'roles/r.md', text: 'role' }]);
  });

  it('refuses a proposal with validation errors, or one that is not open', () => {
    const broken = proposalFor(text, serialiseLoopGraph({ ...graph, entry: 'no-such-node' }));
    assert.ok(broken.findings.some((finding) => finding.severity === 'error'));
    assert.equal(applyProposal(broken, { graph: text }).outcome, 'refused');
    const unreadable = proposalFor(text, '{ not json');
    assert.equal(unreadable.change, null);
    assert.equal(applyProposal(unreadable, { graph: text }).outcome, 'refused');
    const discarded = discardProposal(proposalFor(text, changed));
    assert.equal(discarded.status, 'discarded');
    assert.equal(applyProposal(discarded, { graph: text }).outcome, 'refused');
  });

  it('a later proposal for the same graph supersedes the open earlier ones', () => {
    const first = proposalFor(text, changed, 'a');
    const applied = { ...proposalFor(text, changed, 'b'), status: 'applied' as const };
    const later = proposalFor(text, changed, 'c');
    const list = supersedeWith([first, applied], later);
    assert.deepEqual(list.map((each) => [each.id, each.status]), [
      ['a', 'superseded'],
      ['b', 'applied'],
      ['c', 'proposed'],
    ]);
  });
});

describe('reconcileDisk', () => {
  it('answers same, reload or ask', () => {
    assert.equal(reconcileDisk({ base: 'A', disk: 'A', editor: 'A' }), 'same');
    assert.equal(reconcileDisk({ base: 'A', disk: 'A', editor: 'E' }), 'same');
    assert.equal(reconcileDisk({ base: 'A', disk: 'D', editor: 'A' }), 'reload');
    assert.equal(reconcileDisk({ base: 'A', disk: 'D', editor: 'D' }), 'same');
    assert.equal(reconcileDisk({ base: 'A', disk: 'D', editor: 'E' }), 'ask');
    assert.equal(reconcileDisk({ base: 'A', disk: null, editor: 'E' }), 'ask');
    assert.equal(reconcileDisk({ base: null, disk: 'D', editor: null }), 'reload');
  });
});

describe('manualEditsSince', () => {
  const { text, graph } = read('dspatch-parallel-loop.graph.json');

  it('reports nothing when disk is what was applied', () => {
    assert.deepEqual(manualEditsSince(text, text), { edited: false, readable: true, change: null });
  });

  it('reports a manual move as layout only, and an unreadable file as unreadable', () => {
    const node = graph.nodes[0]!;
    const moved = serialiseLoopGraph({
      ...graph,
      nodes: graph.nodes.map((each) => (each === node ? { ...each, view: { x: 5, y: 5 } } : each)),
    });
    const edits = manualEditsSince(text, moved);
    assert.equal(edits.edited, true);
    assert.equal(edits.change?.layoutOnly, true);
    assert.deepEqual(manualEditsSince(text, '{'), { edited: true, readable: false, change: null });
    assert.deepEqual(manualEditsSince(text, null), { edited: true, readable: false, change: null });
  });
});
