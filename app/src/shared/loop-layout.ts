/**
 * DSP-209 S18b: a layered layout for a loop drawing, top to bottom.
 *
 * A small Sugiyama-style layout, pure and deterministic, with no dependency (decision 36):
 *
 * 1. **Back edges are set aside** with S18a's {@link findBackEdges}, so a rework edge never
 *    pushes its target down; it stays a back edge and S18a's router draws it in a lane.
 * 2. **Layers by longest path** over the remaining edges. The entry is in the first layer.
 *    Terminals go together in the last layer, so every ending reads at the bottom, except, when
 *    side paths are given, an ending only they reach: it goes in a column beside the flow (5).
 * 3. **A few barycentre sweeps**, down then up, order each layer to reduce crossings. Ties
 *    keep the order of the file, so the same drawing always gives the same layout.
 * 4. **Compact coordinates** from {@link nodeSize}: rows as tall as their tallest box plus
 *    a gap, boxes side by side with a gap, each row centred on the widest.
 *
 * It places boxes only. It never changes what the drawing means, and it runs when the person
 * asks (**Arrange**) or for nodes the file gave no position; a placed drawing is not moved.
 */

import type { NodeKind } from './loop-graph';
import { nodeSize } from './loop-edge-geometry';
import { findBackEdges } from './loop-edge-routing';

/** Where the first row starts: clear of the palette bar, as the grid it replaces was. */
export const LAYOUT_TOP_LEFT = { x: 48, y: 40 } as const;
/** Between one row's tallest box and the next row, room for edges and their labels. */
export const LAYER_GAP = 76;
/** Between two boxes in a row. */
export const COLUMN_GAP = 56;
/** Barycentre sweeps (each one down and one up). */
const SWEEPS = 4;

export interface LayoutNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly fanOut?: unknown;
}

export interface LayoutGraph {
  readonly entry: string;
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly { readonly id: string; readonly from: string; readonly to: string }[];
}

export interface LayoutResult {
  /** Each node's top-left corner, by id. */
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  /** Each node's layer, 0 for the first row. */
  readonly layers: ReadonlyMap<string, number>;
}

/**
 * Lay out every node of the drawing. Nodes are identified by id; duplicates keep the first.
 *
 * With `sidePaths` (S18a's `sidePathEdges`), an ending reached only by side paths — a declared
 * failure, or a node's own route for a reply that established nothing — is set beside the main
 * flow rather than in its last row, at the height of the steps that lead to it. The main flow
 * then reads top to bottom on its own, and those paths stay short and outside it (Niclas,
 * 14 November 2026).
 */
export function layeredLayout(graph: LayoutGraph, options: { readonly sidePaths?: ReadonlySet<string> } = {}): LayoutResult {
  const all: LayoutNode[] = [];
  const known = new Set<string>();
  for (const node of graph.nodes) {
    if (!known.has(node.id)) {
      known.add(node.id);
      all.push(node);
    }
  }
  const incoming = new Map<string, { readonly id: string; readonly from: string }[]>();
  for (const edge of graph.edges) {
    if (known.has(edge.from) && edge.from !== edge.to) {
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    }
  }
  const besideIds = new Set(
    all
      .filter((node) => {
        const into = incoming.get(node.id) ?? [];
        return (
          node.kind === 'terminal' &&
          node.id !== graph.entry &&
          into.length > 0 &&
          into.every((edge) => options.sidePaths?.has(edge.id) === true)
        );
      })
      .map((node) => node.id),
  );
  const nodes = all.filter((node) => !besideIds.has(node.id));
  known.clear();
  for (const node of nodes) {
    known.add(node.id);
  }
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const back = findBackEdges({ entry: graph.entry, nodes, edges: graph.edges });
  const forward = graph.edges.filter(
    (edge) => !back.has(edge.id) && edge.from !== edge.to && known.has(edge.from) && known.has(edge.to),
  );
  const successors = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  const predecessors = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of forward) {
    successors.get(edge.from)?.push(edge.to);
    predecessors.get(edge.to)?.push(edge.from);
  }

  // 2. Longest path, in a topological order (Kahn, ties by file order). Forward edges form
  //    no cycle once back edges are removed, so every node is reached.
  const indegree = new Map(nodes.map((node) => [node.id, predecessors.get(node.id)?.length ?? 0]));
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const topo: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (a === graph.entry ? -1 : b === graph.entry ? 1 : (order.get(a) ?? 0) - (order.get(b) ?? 0)));
    const id = ready.shift() as string;
    topo.push(id);
    for (const next of successors.get(id) ?? []) {
      const left = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, left);
      if (left === 0) {
        ready.push(next);
      }
    }
  }
  // The entry is always the first row, whatever reaches it; everything else is one row
  // below its lowest predecessor, so no node sits above the entry.
  const layer = new Map<string, number>();
  for (const id of topo) {
    const fromPredecessors = Math.max(-1, ...(predecessors.get(id) ?? []).map((pred) => layer.get(pred) ?? 0));
    layer.set(id, id === graph.entry ? 0 : fromPredecessors + 1);
  }
  // Terminals together in the last row.
  const kinds = new Map(nodes.map((node) => [node.id, node.kind]));
  const lastWork = Math.max(0, ...nodes.filter((node) => node.kind !== 'terminal').map((node) => layer.get(node.id) ?? 0));
  for (const node of nodes) {
    if (node.kind === 'terminal' && node.id !== graph.entry) {
      layer.set(node.id, lastWork + 1);
    }
  }

  // 3. Rows, ordered by barycentre sweeps.
  const depth = Math.max(0, ...layer.values());
  const rows: string[][] = Array.from({ length: depth + 1 }, () => []);
  for (const node of nodes) {
    rows[layer.get(node.id) ?? 0]?.push(node.id);
  }
  const position = new Map<string, number>();
  const remember = (): void => {
    for (const row of rows) {
      row.forEach((id, index) => position.set(id, row.length === 1 ? 0.5 : index / (row.length - 1)));
    }
  };
  remember();
  const reorder = (row: string[], neighbours: (id: string) => readonly string[]): void => {
    const keyed = row.map((id, index) => {
      const near = neighbours(id).filter((other) => position.has(other));
      const key = near.length === 0 ? (position.get(id) ?? 0) : near.reduce((sum, other) => sum + (position.get(other) ?? 0), 0) / near.length;
      return { id, key, index };
    });
    keyed.sort((a, b) => a.key - b.key || a.index - b.index);
    row.splice(0, row.length, ...keyed.map((entry) => entry.id));
  };
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    for (let at = 1; at < rows.length; at += 1) {
      reorder(rows[at] as string[], (id) => predecessors.get(id) ?? []);
      remember();
    }
    for (let at = rows.length - 2; at >= 0; at -= 1) {
      reorder(rows[at] as string[], (id) => successors.get(id) ?? []);
      remember();
    }
  }

  // 4. Coordinates.
  const byId = new Map(all.map((node) => [node.id, node]));
  const sizeOf = (id: string): { width: number; height: number } => nodeSize(byId.get(id) ?? { kind: kinds.get(id) ?? 'agent' });
  const rowWidth = (row: readonly string[]): number =>
    row.reduce((sum, id) => sum + sizeOf(id).width, 0) + Math.max(0, row.length - 1) * COLUMN_GAP;
  const widest = Math.max(0, ...rows.map(rowWidth));
  const positions = new Map<string, { x: number; y: number }>();
  const rowTops: number[] = [];
  let y: number = LAYOUT_TOP_LEFT.y;
  for (const row of rows) {
    rowTops.push(y);
    let x = LAYOUT_TOP_LEFT.x + Math.round((widest - rowWidth(row)) / 2);
    for (const id of row) {
      positions.set(id, { x, y });
      x += sizeOf(id).width + COLUMN_GAP;
    }
    y += Math.max(0, ...row.map((id) => sizeOf(id).height)) + LAYER_GAP;
  }

  // 5. The endings beside the main flow: one column to its right, each at the row of the
  //    middle one of the steps leading to it, moved down a row while that place is taken.
  //    Ordered by that row, then by file order.
  const besideX = LAYOUT_TOP_LEFT.x + widest + COLUMN_GAP;
  const wanted = all
    .filter((node) => besideIds.has(node.id))
    .map((node, index) => {
      const sourceRows = (incoming.get(node.id) ?? [])
        .map((edge) => layer.get(edge.from))
        .filter((at): at is number => at !== undefined)
        .sort((a, b) => a - b);
      return { id: node.id, row: sourceRows[Math.floor((sourceRows.length - 1) / 2)] ?? 0, index };
    })
    .sort((a, b) => a.row - b.row || a.index - b.index);
  const taken = new Set<number>();
  for (const entry of wanted) {
    let row = entry.row;
    while (taken.has(row)) {
      row += 1;
    }
    taken.add(row);
    const top = rowTops[row] ?? y + (row - rowTops.length) * (sizeOf(entry.id).height + LAYER_GAP);
    positions.set(entry.id, { x: besideX, y: top });
    layer.set(entry.id, row);
  }
  return { positions, layers: layer };
}
