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
  placeProposals,
  reconcileDisk,
  supersedeWith,
  summariseProposal,
  firstSentence,
} from '../src/shared/graph-proposal';
import type { GraphEditProposal, ProposalPlacement, ReferenceFollowed } from '../src/shared/graph-proposal';
import type { StoredMessage } from '../src/shared/bridge';
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

describe('the card opens with a readable summary (DSP-209 S23b, Niclas 14 November 2026)', () => {
  it('names the loop, gives its first sentence whole, and says the change in one sentence', () => {
    const { text, graph } = read('dspatch-chat-loop.graph.json');
    const relabelled = serialiseLoopGraph(replaceNode(graph, graph.nodes[0]?.id ?? '', { ...(graph.nodes[0] as LoopNode), label: 'Renamed' }), { newline: '\n' });
    const summary = summariseProposal(proposalFor(text, relabelled));
    assert.equal(summary.loopName, graph.name);
    assert.equal(summary.isNew, false);
    assert.equal(summary.change, 'Changes: 1 step changed.');
    assert.ok(summary.purpose !== null && graph.purpose?.startsWith(summary.purpose), summary.purpose ?? '');
    assert.ok(summary.purpose?.endsWith('.') && !summary.purpose.includes('…'), 'a whole sentence, never cut');
    assert.equal(summary.wholePurpose, graph.purpose?.trim() === summary.purpose ? null : graph.purpose?.trim());
    assert.deepEqual(
      [summary.errors.length, summary.warnings.length, summary.notices.length],
      [0, ...['warning', 'notice'].map((severity) => proposalFor(text, relabelled).findings.filter((finding) => finding.severity === severity).length)],
      'findings are split by severity, none lost',
    );
  });

  it('counts a new loop in steps, endings, connections and roles', () => {
    const { text, graph } = read('dspatch-chat-loop.graph.json');
    const proposal = createProposal({
      id: 'p-new',
      conversationId: 'conv-1',
      target: { newLoop: { definitionPath: 'x.loop.json', graphPath: 'x.graph.json', definitionText: '{}' } },
      baseText: null,
      graphText: text,
      roleFiles: [{ path: 'r.role.md', text: 'x' }],
      explanation: 'A new loop.',
    });
    const endings = graph.nodes.filter((node) => node.kind === 'terminal').length;
    assert.equal(
      summariseProposal(proposal).change,
      `A new loop: ${String(graph.nodes.length - endings)} steps and ${String(endings)} endings, ${String(graph.edges.length)} connections, and 1 new role.`,
    );
    assert.equal(firstSentence('No sentence end here'), 'No sentence end here');
    assert.equal(firstSentence('One. Two.'), 'One.');
    assert.equal(firstSentence('Version 1.5 is out. Next.'), 'Version 1.5 is out.');
  });
});

describe('a proposal is drawn at the turn that made it (Niclas, 15 November 2026)', () => {
  const { text } = read('dspatch-chat-loop.graph.json');
  const message = (ordinal: number, dspatchRunId: string, graphProposals?: readonly GraphEditProposal[]): StoredMessage => ({
    ordinal,
    dspatchRunId,
    prompt: `prompt ${String(ordinal)}`,
    answer: `answer ${String(ordinal)}`,
    deltaCount: 0,
    toolEvents: 0,
    terminalStatus: 'finished',
    errorMessage: null,
    totalTokens: null,
    startedAtUtc: `2026-11-14T1${String(ordinal)}:00:00.000Z`,
    finishedAtUtc: null,
    resentContext: null,
    ...(graphProposals === undefined ? {} : { graphProposals }),
  });
  const first = { ...proposalFor(text, text, 'p1'), status: 'superseded' as const };
  const second = { ...proposalFor(text, text, 'p2'), status: 'superseded' as const };
  const third = { ...proposalFor(text, text, 'p3'), status: 'applied' as const };
  // As read back after a restart: three proposals on two turns, a turn with none between.
  const restored = [message(1, 'run-a', [first, second]), message(2, 'run-b'), message(3, 'run-c', [third])];
  const where = (placement: ProposalPlacement): Record<string, string[]> =>
    Object.fromEntries([...placement.byTurn].map(([turn, entries]) => [turn, entries.map((entry) => `${entry.proposal.id}:${String(entry.ordinal)}:${entry.shown ? 'shown' : 'folded'}`)]));

  it('places proposals read from disk at their own turns, numbered in order, earlier versions folded', () => {
    const placement = placeProposals(restored, null);
    assert.deepEqual(where(placement), { 'run-a': ['p1:1:folded', 'p2:2:folded'], 'run-c': ['p3:3:shown'] });
    assert.deepEqual(placement.unplaced, []);
  });

  it('keeps a proposal at its turn when a later status arrives, and places a new one at the turn that made it', () => {
    // Apply's answer for p3, then a newer proposal from a later turn that supersedes it.
    const applied = placeProposals(restored, { conversationId: 'conv-1', proposals: [first, second, third], turns: { p1: 'run-a', p2: 'run-a', p3: 'run-c' } });
    assert.deepEqual(where(applied), { 'run-a': ['p1:1:folded', 'p2:2:folded'], 'run-c': ['p3:3:shown'] });
    const fourth = proposalFor(text, text, 'p4');
    const later = placeProposals(restored, {
      conversationId: 'conv-1',
      proposals: [first, second, { ...third, status: 'superseded' }, fourth],
      turns: { p1: 'run-a', p2: 'run-a', p3: 'run-c', p4: 'run-d' },
    });
    assert.deepEqual(where(later), { 'run-a': ['p1:1:folded', 'p2:2:folded'], 'run-c': ['p3:3:folded'], 'run-d': ['p4:4:shown'] });
  });

  it('does not guess a turn it is not told', () => {
    // An update from a host that names no turns: what the disk names keeps its place, the rest is unplaced.
    const unnamed = proposalFor(text, text, 'p5');
    const placement = placeProposals(restored, { conversationId: 'conv-1', proposals: [first, second, third, unnamed] });
    assert.deepEqual(where(placement), { 'run-a': ['p1:1:folded', 'p2:2:folded'], 'run-c': ['p3:3:folded'] });
    assert.deepEqual(placement.unplaced.map((entry) => entry.proposal.id), ['p5']);
  });
});
