/**
 * DSP-209 S18a: edge routing around nodes.
 *
 * The acceptance criteria are measured here, not judged: (1) for every bundled graph at its
 * saved positions, no route segment crosses a node box other than its own two; (2) the same
 * input gives the same routes; (3) nothing a run changes reaches the routing. Whether the
 * result is visually clear is Niclas's judgement, and nothing here claims it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FAN_OUT_NODE_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeSize,
  type Box,
  type Point,
} from '../src/shared/loop-edge-geometry';
import {
  findBackEdges,
  roundedPath,
  routeLoopEdges,
  routingBox,
  segmentCrossesBox,
  type RoutingGraph,
} from '../src/shared/loop-edge-routing';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphsDir = path.join(repoRoot, 'docs', 'loop', 'graphs');

interface FileGraph extends RoutingGraph {
  readonly edges: readonly { id: string; from: string; to: string; label?: string }[];
}

function bundledGraphs(): { name: string; text: string; graph: FileGraph }[] {
  return fs
    .readdirSync(graphsDir)
    .filter((name) => name.endsWith('.graph.json'))
    .sort()
    .map((name) => {
      const text = fs.readFileSync(path.join(graphsDir, name), 'utf8');
      return { name, text, graph: JSON.parse(text) as FileGraph };
    });
}

function insideOrOn(point: Point, box: Box): boolean {
  const e = 1e-6;
  return point.x >= box.x - e && point.x <= box.x + box.width + e && point.y >= box.y - e && point.y <= box.y + box.height + e;
}

describe('routes for the bundled graphs at their saved positions', () => {
  const graphs = bundledGraphs();

  it('includes the generic agent network among the bundled graphs', () => {
    assert.ok(graphs.some(({ name }) => name === 'generic-agent-network.graph.json'));
  });

  for (const { name, graph } of graphs) {
    it(`${name}: no segment crosses a node box other than its own two`, (t) => {
      const started = performance.now();
      const routes = routeLoopEdges(graph);
      t.diagnostic(`${name}: ${String(graph.edges.length)} edges in ${(performance.now() - started).toFixed(1)} ms`);
      const boxes = new Map(graph.nodes.map((node) => [node.id, routingBox(node)]));
      assert.equal(routes.size, graph.edges.length, 'every edge gets a route');
      for (const edge of graph.edges) {
        const route = routes.get(edge.id);
        assert.ok(route !== undefined, `${edge.id} has a route`);
        const points = route.points;
        assert.ok(points.length >= 2);
        const source = boxes.get(edge.from) as Box;
        const target = boxes.get(edge.to) as Box;
        assert.ok(insideOrOn(points[0] as Point, source), `${edge.id} starts on its source`);
        assert.ok(insideOrOn(points[points.length - 1] as Point, target), `${edge.id} ends on its target`);
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1] as Point;
          const b = points[i] as Point;
          assert.ok(a.x === b.x || a.y === b.y, `${edge.id} segment ${String(i)} is orthogonal`);
          for (const [id, box] of boxes) {
            if (id === edge.from || id === edge.to) {
              continue;
            }
            assert.ok(
              !segmentCrossesBox(a, b, box),
              `${name}: ${edge.id} (${edge.from}→${edge.to}) segment ${JSON.stringify(a)}–${JSON.stringify(b)} crosses ${id}`,
            );
          }
          // Its own boxes only at the two stubs: a route does not cut back through them.
          if (i > 1 && i < points.length - 1) {
            for (const own of [source, target]) {
              assert.ok(!segmentCrossesBox(a, b, own), `${name}: ${edge.id} re-enters its own node`);
            }
          }
        }
      }
    });
  }

  it('runs every back edge in an outer lane, leaving and entering on the lane side', () => {
    let count = 0;
    for (const { graph } of graphs) {
      const back = findBackEdges(graph);
      const routes = routeLoopEdges(graph);
      for (const route of routes.values()) {
        assert.equal(route.back, back.has(route.edgeId));
        if (route.back) {
          count += 1;
          assert.ok(route.lane !== null);
          assert.equal(route.sourceSide, route.lane);
          assert.equal(route.targetSide, route.lane);
        } else {
          assert.equal(route.lane, null);
        }
      }
    }
    assert.ok(count > 0, 'the bundled graphs have rework edges');
  });

  it('spreads parallel edges over separate ports', () => {
    const mission = graphs.find((entry) => entry.name === 'dspatch-mission-loop.graph.json')?.graph as FileGraph;
    const routes = routeLoopEdges(mission);
    const parallel = mission.edges.filter((edge) => edge.from === 'implementer' && edge.to === 'coordinator');
    assert.ok(parallel.length >= 3);
    const starts = new Set(parallel.map((edge) => JSON.stringify(routes.get(edge.id)?.points[0])));
    const ends = new Set(parallel.map((edge) => JSON.stringify(routes.get(edge.id)?.points.at(-1))));
    assert.equal(starts.size, parallel.length);
    assert.equal(ends.size, parallel.length);
  });
});

describe('the same input gives the same routes', () => {
  it('for each bundled graph, parsed twice and routed twice', () => {
    for (const { text } of bundledGraphs()) {
      const first = routeLoopEdges(JSON.parse(text) as FileGraph);
      const second = routeLoopEdges(JSON.parse(text) as FileGraph);
      assert.deepEqual([...second.entries()], [...first.entries()]);
    }
  });

  it('labels move labels only, never a route', () => {
    for (const { graph } of bundledGraphs()) {
      const plain = routeLoopEdges(graph);
      const labelled = routeLoopEdges(graph, { labelOf: (edge) => `a much longer label for ${edge.id}` });
      for (const [id, route] of plain) {
        assert.deepEqual(labelled.get(id)?.points, route.points);
      }
    }
  });
});

describe('a run changes no route', () => {
  /**
   * The canvas routes from the graph alone and memoises on it; run state, working marks,
   * endings and branch summaries are separate props. Here the same graph carries every
   * kind of run decoration a node or edge could be given, and the routes do not move.
   */
  it('routing reads positions, kinds, fan-out and edge ends, and nothing a run sets', () => {
    for (const { graph } of bundledGraphs()) {
      const before = routeLoopEdges(graph);
      for (const runState of ['not-reached', 'ready', 'active', 'done', 'failed', 'stopped']) {
        const decorated = {
          ...graph,
          nodes: graph.nodes.map((node) => ({ ...node, runState, working: true, ending: 'success', branches: '3 working' })),
          edges: graph.edges.map((edge) => ({ ...edge, taken: true, runState })),
        };
        assert.deepEqual([...routeLoopEdges(decorated).entries()], [...before.entries()]);
      }
    }
  });

  it('sizes a node by kind and fan-out only', () => {
    assert.deepEqual(nodeSize({ kind: 'agent' }), { width: NODE_WIDTH, height: NODE_HEIGHT });
    assert.deepEqual(nodeSize({ kind: 'agent', fanOut: { slicesFrom: 's', maxConcurrent: 2, isolation: 'worktree' } }), {
      width: NODE_WIDTH,
      height: FAN_OUT_NODE_HEIGHT,
    });
    assert.ok(FAN_OUT_NODE_HEIGHT > NODE_HEIGHT);
    const running = { kind: 'agent' as const, runState: 'active', working: true };
    assert.deepEqual(nodeSize(running), nodeSize({ kind: 'agent' }));
  });
});

describe('findBackEdges', () => {
  const node = (id: string) => ({ id, kind: 'agent' as const });
  const edge = (id: string, from: string, to: string) => ({ id, from, to });

  it('marks the edge that returns to a node on the depth-first path', () => {
    const back = findBackEdges({
      entry: 'a',
      nodes: [node('a'), node('b'), node('c')],
      edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ca', 'c', 'a'), edge('ac', 'a', 'c')],
    });
    assert.deepEqual([...back], ['ca']);
  });

  it('follows edge order, so a cross edge to a finished node is not a back edge', () => {
    const back = findBackEdges({
      entry: 'a',
      nodes: [node('a'), node('b'), node('c')],
      edges: [edge('ac', 'a', 'c'), edge('ab', 'a', 'b'), edge('bc', 'b', 'c')],
    });
    assert.equal(back.size, 0);
  });

  it('counts a self-loop, searches nodes the entry does not reach, and ignores unknown ends', () => {
    const back = findBackEdges({
      entry: 'a',
      nodes: [node('a'), node('x'), node('y')],
      edges: [edge('aa', 'a', 'a'), edge('xy', 'x', 'y'), edge('yx', 'y', 'x'), edge('az', 'a', 'zz')],
    });
    assert.deepEqual([...back].sort(), ['aa', 'yx']);
  });

  it('finds the rework edges of the development loop', () => {
    const graph = JSON.parse(
      fs.readFileSync(path.join(graphsDir, 'dspatch-development-loop-runnable.graph.json'), 'utf8'),
    ) as FileGraph;
    const back = findBackEdges(graph);
    const named = graph.edges.filter((entry) => back.has(entry.id)).map((entry) => `${entry.from}>${entry.to}`);
    assert.ok(named.includes('implementation-review>implementer'), named.join(', '));
    assert.ok(!named.includes('coordinator>implementer'));
  });
});

describe('roundedPath', () => {
  it('rounds each corner and ends on the last point', () => {
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ]);
    assert.equal(d, 'M 0 0 L 32 0 Q 40 0 40 8 L 40 40');
  });
});
