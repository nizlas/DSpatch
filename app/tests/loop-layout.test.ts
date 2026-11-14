/**
 * DSP-209 S18b: the layered layout, on the eight bundled drawings and a synthetic 25-node one.
 *
 * What is asserted is what a person relies on: no box on another, the entry at the top, rework
 * edges still drawn as rework and going back up, the same answer every time, a placed drawing
 * left alone on open, and S18a's last-resort route (review suggestion 2) not taken. Whether
 * the result looks clear is not something a test establishes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { nodeSize, type Box, type Point } from '../src/shared/loop-edge-geometry';
import { edgeLabelText, LABEL_WRAP_WIDTH, labelTextWidth } from '../src/shared/loop-edge-labels';
import { countRouteCrossings, findBackEdges, routeLoopEdges, routingBox, segmentCrossesBox, sidePathEdges } from '../src/shared/loop-edge-routing';
import type { LoopEdge, LoopGraph, LoopNode } from '../src/shared/loop-graph';
import { LOOP_GRAPH_FORMAT, LOOP_GRAPH_FORMAT_VERSION } from '../src/shared/loop-graph';
import { arrangeGraph, layOutMissingViews } from '../src/shared/loop-graph-editing';
import { parseLoopGraph } from '../src/shared/loop-graph-load';
import { layeredLayout } from '../src/shared/loop-layout';

const here = path.dirname(fileURLToPath(import.meta.url));
const graphsDir = path.join(here, '..', '..', 'docs', 'loop', 'graphs');

function bundled(): readonly { readonly name: string; readonly graph: LoopGraph }[] {
  return fs
    .readdirSync(graphsDir)
    .filter((name) => name.endsWith('.graph.json'))
    .sort()
    .map((name) => {
      const parsed = parseLoopGraph(fs.readFileSync(path.join(graphsDir, name), 'utf8'));
      assert.ok(parsed.ok, `${name} parses`);
      return { name, graph: parsed.graph };
    });
}

/** 22 work steps in a chain with skips, rework edges and early exits, plus 3 terminals. */
function synthetic(): LoopGraph {
  const nodes: LoopNode[] = [];
  const edges: LoopEdge[] = [];
  for (let index = 0; index < 22; index += 1) {
    nodes.push({ id: `s${String(index)}`, kind: index % 5 === 4 ? 'router' : 'agent', label: `Step ${String(index)}`, ...(index === 9 ? { fanOut: { slicesFrom: 's8', maxConcurrent: 2, isolation: 'worktree' as const } } : {}) });
  }
  nodes.push({ id: 'done', kind: 'terminal', label: 'Done' }, { id: 'stopped', kind: 'terminal', label: 'Stopped' }, { id: 'blocked', kind: 'terminal', label: 'Blocked' });
  let id = 0;
  const edge = (from: string, to: string): void => {
    id += 1;
    edges.push({ id: `e${String(id)}`, from, to, when: { on: 'success' } });
  };
  for (let index = 0; index < 21; index += 1) {
    edge(`s${String(index)}`, `s${String(index + 1)}`);
    if (index % 3 === 0 && index + 2 < 22) {
      edge(`s${String(index)}`, `s${String(index + 2)}`);
    }
    if (index % 4 === 3) {
      edge(`s${String(index)}`, `s${String(index - 2)}`);
    }
  }
  edge('s21', 'done');
  edge('s6', 'stopped');
  edge('s13', 'blocked');
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'synthetic-25',
    name: 'Synthetic 25',
    purpose: 'Layout test.',
    target: 'cursor',
    entry: 's0',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [],
    nodes,
    edges,
  };
}

const cases = (): readonly { readonly name: string; readonly graph: LoopGraph }[] => [...bundled(), { name: 'synthetic-25', graph: synthetic() }];

function overlaps(graph: LoopGraph): string[] {
  const boxes = graph.nodes.map((node) => ({ id: node.id, x: node.view?.x ?? 0, y: node.view?.y ?? 0, ...nodeSize(node) }));
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
        found.push(`${a.id}/${b.id}`);
      }
    }
  }
  return found;
}

describe('the layered layout (DSP-209 S18b)', () => {
  it('covers eight bundled drawings and the 25-node one', () => {
    assert.equal(bundled().length, 8);
    assert.equal(synthetic().nodes.length, 25);
  });

  it('puts no box on another, and the entry alone at the top', () => {
    for (const { name, graph } of cases()) {
      const arranged = arrangeGraph(graph);
      assert.deepEqual(overlaps(arranged), [], `${name}: boxes overlap`);
      assert.equal(layeredLayout(graph).layers.get(graph.entry), 0, `${name}: the entry is in the first layer`);
      const top = Math.min(...arranged.nodes.map((node) => node.view?.y ?? 0));
      assert.equal(arranged.nodes.find((node) => node.id === graph.entry)?.view?.y, top, `${name}: nothing above the entry`);
    }
  });

  it('keeps back edges back edges, drawn as rework, going back up', () => {
    for (const { name, graph } of cases()) {
      const arranged = arrangeGraph(graph);
      const back = findBackEdges(graph);
      assert.deepEqual([...findBackEdges(arranged)], [...back], `${name}: the same back edges`);
      const routes = routeLoopEdges(arranged);
      const y = new Map(arranged.nodes.map((node) => [node.id, node.view?.y ?? 0]));
      for (const edge of graph.edges.filter((item) => back.has(item.id))) {
        assert.equal(routes.get(edge.id)?.back, true, `${name}: ${edge.id} is drawn as rework`);
        assert.ok((y.get(edge.to) ?? 0) <= (y.get(edge.from) ?? 0), `${name}: ${edge.id} returns upward`);
      }
    }
  });

  it('gives the same layout every time', () => {
    for (const { name, graph } of cases()) {
      assert.deepEqual(arrangeGraph(graph), arrangeGraph(graph), name);
    }
  });

  it('leaves a fully placed drawing exactly as it is on open, and places a missing node below the rest', () => {
    for (const { name, graph } of bundled()) {
      assert.equal(layOutMissingViews(graph).graph, graph, `${name}: the same graph object`);
    }
    const { graph } = bundled().find((item) => item.name === 'dspatch-mission-loop.graph.json')!;
    const target = graph.nodes.find((node) => node.kind === 'agent')!;
    const partly: LoopGraph = { ...graph, nodes: graph.nodes.map((node) => (node.id === target.id ? { id: node.id, kind: node.kind, ...(node.label === undefined ? {} : { label: node.label }) } : node)) };
    const laidOut = layOutMissingViews(partly);
    assert.deepEqual(laidOut.placed, [target.id]);
    assert.deepEqual(overlaps(laidOut.graph), []);
    const lowest = Math.max(...graph.nodes.filter((node) => node.id !== target.id).map((node) => (node.view?.y ?? 0) + nodeSize(node).height));
    assert.ok((laidOut.graph.nodes.find((node) => node.id === target.id)?.view?.y ?? 0) > lowest, 'below what the file placed');
    // Every other node keeps its position.
    for (const node of graph.nodes.filter((item) => item.id !== target.id)) {
      assert.deepEqual(laidOut.graph.nodes.find((item) => item.id === node.id)?.view, node.view);
    }
  });

  it('routes every arranged drawing without S18a’s last-resort route (review suggestion 2), every label clear', () => {
    for (const { name, graph } of cases()) {
      let report: { readonly narrowed: boolean; readonly dogLegs: readonly string[]; readonly labelConflicts: readonly string[] } | null = null;
      routeLoopEdges(arrangeGraph(graph), { labelOf: edgeLabelText, report: (seen) => (report = seen) });
      assert.deepEqual(report, { narrowed: false, dogLegs: [], labelConflicts: [] }, `${name}: no narrowed pass, no dog-leg, no label without room`);
    }
  });
});

describe('side paths outside the main flow (Niclas, 14 November 2026)', () => {
  it('reads side paths from the drawing’s own declarations: failures and a node’s fallback outcome', () => {
    const chat = bundled().find((entry) => entry.name === 'dspatch-chat-loop.graph.json')?.graph;
    assert.ok(chat !== undefined);
    const side = sidePathEdges(chat);
    for (const edge of chat.edges) {
      const fallback = chat.nodes.find((node) => node.id === edge.from)?.whenUndeclared;
      const expected = edge.when.on === 'declared-failure' || (edge.when.on === 'outcome' && edge.when.outcome === fallback);
      assert.equal(side.has(edge.id), expected, edge.id);
    }
    assert.ok(side.size > 0);
  });

  it('Arrange never crosses the main flow more than a layout that ignores side paths, and no boxes overlap', () => {
    // Side paths are drawn fainter and kept out of the main flow's grouping (Niclas, 14 November
    // 2026), so what Arrange must not make worse is the main flow: its own edges' crossings.
    const mainCrossings = (graph: LoopGraph): number => {
      const side = sidePathEdges(graph);
      const routes = routeLoopEdges(graph);
      return countRouteCrossings(new Map([...routes].filter(([id, route]) => !side.has(id) && !route.back)));
    };
    for (const { name, graph } of cases()) {
      const plain = layeredLayout(graph).positions;
      const placedPlain = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, view: plain.get(node.id) ?? node.view })) };
      const arranged = arrangeGraph(graph);
      assert.ok(mainCrossings(arranged) <= mainCrossings(placedPlain), `${name}: the main flow crosses no more`);
      assert.deepEqual(overlaps(arranged), [], `${name}: no boxes overlap`);
    }
    // The chat loop's endings that only failures and "not established" reach go beside the flow,
    // and its routes cross fewer times than with every ending in the last row.
    const chat = bundled().find((entry) => entry.name === 'dspatch-chat-loop.graph.json')?.graph as LoopGraph;
    const plain = layeredLayout(chat).positions;
    const placedPlain = { ...chat, nodes: chat.nodes.map((node) => ({ ...node, view: plain.get(node.id) ?? node.view })) };
    assert.ok(countRouteCrossings(routeLoopEdges(arrangeGraph(chat))) < countRouteCrossings(routeLoopEdges(placedPlain)));
  });
});

/**
 * Alternative paths that join later, with failures and a rework edge around them. Built from
 * `names`, so the same structure can be asserted under other node names and another file order:
 * the rules come from the drawing's structure, never from what its nodes are called.
 */
function branching(
  names: Readonly<Record<'start' | 'short' | 'fork' | 'merge' | 'join' | 'ok' | 'no' | 'unsure' | 'halted' | 'partFailed', string>>,
  longFirst: boolean,
): LoopGraph {
  const n = names;
  const agent = (id: string, extra: Partial<LoopNode> = {}): LoopNode => ({ id, kind: 'agent', label: id, ...extra });
  const fork = agent(n.fork, { failures: ['part-failed'] });
  const branchNodes = longFirst ? [fork, agent(n.merge), agent(n.short)] : [agent(n.short), fork, agent(n.merge)];
  const nodes: LoopNode[] = [
    agent(n.start, { outcomes: ['quick', 'split', 'unsure'], whenUndeclared: 'unsure', failures: ['blocked'] }),
    ...branchNodes,
    agent(n.join, { outcomes: ['ok', 'redo', 'no', 'unsure'], whenUndeclared: 'unsure' }),
    ...[n.ok, n.no, n.unsure, n.halted, n.partFailed].map((id): LoopNode => ({ id, kind: 'terminal', label: id })),
  ];
  const edge = (id: string, from: string, to: string, when: LoopEdge['when'], label: string): LoopEdge => ({ id, from, to, when, label });
  const edges: LoopEdge[] = [
    edge('s-quick', n.start, n.short, { on: 'outcome', outcome: 'quick' }, 'one person can do it'),
    edge('s-split', n.start, n.fork, { on: 'outcome', outcome: 'split' }, 'in parts'),
    edge('s-unsure', n.start, n.unsure, { on: 'outcome', outcome: 'unsure' }, 'no readable choice'),
    edge('s-blocked', n.start, n.halted, { on: 'declared-failure', failure: 'blocked' }, 'blocked'),
    edge('short-done', n.short, n.join, { on: 'success' }, 'done, to the check'),
    edge('fork-done', n.fork, n.merge, { on: 'success' }, 'every part done'),
    edge('fork-failed', n.fork, n.partFailed, { on: 'declared-failure', failure: 'part-failed' }, 'every one of the partial results failed'),
    edge('merge-done', n.merge, n.join, { on: 'success' }, 'merged, to the check'),
    edge('join-ok', n.join, n.ok, { on: 'outcome', outcome: 'ok' }, 'met'),
    edge('join-redo', n.join, n.short, { on: 'outcome', outcome: 'redo' }, 'rework with findings'),
    edge('join-no', n.join, n.no, { on: 'outcome', outcome: 'no' }, 'not met'),
    edge('join-unsure', n.join, n.unsure, { on: 'outcome', outcome: 'unsure' }, 'could not check'),
  ];
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'branching',
    name: 'Branching',
    purpose: 'Layout test.',
    target: 'cursor',
    entry: n.start,
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [],
    nodes,
    edges,
  };
}

const NAMINGS = [
  {
    names: { start: 'triage', short: 'patch', fork: 'divide', merge: 'combine', join: 'inspect', ok: 'shipped', no: 'rejected', unsure: 'undecided', halted: 'halted', partFailed: 'parts-failed' },
    longFirst: false,
  },
  {
    names: { start: 'intake', short: 'solo', fork: 'fan', merge: 'gather', join: 'verify', ok: 'accepted', no: 'declined', unsure: 'unclear', halted: 'stuck', partFailed: 'lost-part' },
    longFirst: true,
  },
] as const;

describe('alternative paths and room for labels (Niclas, 14 November 2026)', () => {
  const width = nodeSize({ kind: 'agent' }).width;
  const centre = (graph: LoopGraph, id: string): number => (graph.nodes.find((node) => node.id === id)?.view?.x ?? 0) + width / 2;
  const top = (graph: LoopGraph, id: string): number => graph.nodes.find((node) => node.id === id)?.view?.y ?? 0;

  it('keeps a step that belongs to one path along it until the paths join, under any names', () => {
    for (const { names, longFirst } of NAMINGS) {
      const arranged = arrangeGraph(branching(names, longFirst));
      // The step only the long path has sits under that path's first step, in its column.
      assert.equal(centre(arranged, names.merge), centre(arranged, names.fork), `${names.merge}: in line with ${names.fork}`);
      assert.ok(top(arranged, names.merge) > top(arranged, names.fork), `${names.merge}: below ${names.fork}`);
      // The short path goes straight to the join: in a column of its own, through no node.
      assert.ok(Math.abs(centre(arranged, names.short) - centre(arranged, names.merge)) >= width, `${names.short}: its own column`);
      const shortRoute = routeLoopEdges(arranged).get('short-done');
      assert.ok(shortRoute !== undefined);
      for (const node of arranged.nodes.filter((item) => item.id !== names.short && item.id !== names.join)) {
        const crosses = shortRoute.points.slice(1).some((point, index) => segmentCrossesBox(shortRoute.points[index] as Point, point, routingBox(node)));
        assert.ok(!crosses, `${names.short} → ${names.join} passes ${node.id}`);
      }
      // The paths meet at the join, which sits below both and between them.
      assert.ok(top(arranged, names.join) > top(arranged, names.merge), `${names.join}: below the long path`);
      const [left, right] = [centre(arranged, names.short), centre(arranged, names.merge)].sort((a, b) => a - b) as [number, number];
      assert.ok(centre(arranged, names.join) >= left && centre(arranged, names.join) <= right, `${names.join}: between the paths`);
    }
  });

  it('gives every label room, whole and clear of nodes and other labels, from the first layout', () => {
    for (const { names, longFirst } of NAMINGS) {
      const unplaced = branching(names, longFirst);
      // A new graph without positions and Arrange follow the same rules.
      const arranged = arrangeGraph(unplaced);
      assert.deepEqual(
        layOutMissingViews(unplaced).graph.nodes.map((node) => node.view),
        arranged.nodes.map((node) => node.view),
      );
      // Placed the same whether shown or not: Edge labels, or only a selection's.
      const routes = routeLoopEdges(arranged, { labelOf: edgeLabelText });
      const labels = [...routes.values()].map((route) => ({ id: route.edgeId, box: route.labelBox, lines: route.labelLines }));
      const meets = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      for (const { id, box, lines } of labels) {
        assert.ok(box.x >= 0 && box.y >= 0, `${id}: inside the drawing`);
        for (const node of arranged.nodes) {
          assert.ok(!meets(box, routingBox(node)), `${id}'s label is on ${node.id}`);
        }
        for (const other of labels.filter((entry) => entry.id !== id)) {
          assert.ok(!meets(box, other.box), `${id}'s label is on ${other.id}'s`);
        }
        const edge = arranged.edges.find((item) => item.id === id) as LoopEdge;
        assert.equal(lines.join(' '), edgeLabelText(edge), `${id}: the whole text`);
        for (const line of lines) {
          assert.ok(labelTextWidth(line) <= LABEL_WRAP_WIDTH || !line.includes(' '), `"${line}" fits its line`);
        }
      }
      // A long label is broken between words rather than cut.
      assert.ok((labels.find((entry) => entry.id === 'fork-failed')?.lines.length ?? 0) >= 2);
    }
  });
});
