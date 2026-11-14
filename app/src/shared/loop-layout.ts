/**
 * DSP-209 S18b: a layered layout for a loop drawing, top to bottom.
 *
 * A small Sugiyama-style layout, pure and deterministic, with no dependency (decision 36):
 *
 * 1. **Back edges are set aside** with S18a's {@link findBackEdges}, so a rework edge never
 *    pushes its target down; it stays a back edge and S18a's router draws it in a lane.
 * 2. **Layers by longest path** over the remaining edges. The entry is in the first layer.
 *    Terminals go together in the last layer, so every ending reads at the bottom, except, when
 *    side paths are given, an ending only they reach: it goes in a column beside the flow (6).
 * 3. **Passages for long edges.** A main-flow edge that spans several layers gets a placeholder
 *    in each layer between its ends, so the layers below see it as a neighbour and the path it
 *    belongs to keeps its column until the paths actually meet (Niclas, 14 November 2026). Side
 *    paths — declared failures and a node's fallback outcome — and rework edges get none, so
 *    they never pull the main flow's grouping out of shape; a node only they connect is ordered
 *    by them.
 * 4. **A few barycentre sweeps**, down then up, order each layer to reduce crossings. Ties
 *    keep the order of the file, so the same drawing always gives the same layout.
 * 5. **Coordinates.** Each node is placed as near as it can be to its neighbours in the main
 *    flow, above and below, keeping its layer's order and gaps (an isotonic fit per row,
 *    repeated over the rows until it settles). A node with one main predecessor sits under it;
 *    where two paths join, the node sits between them. Rows are as tall as their tallest box
 *    plus a gap.
 *
 * **Room for labels** (Niclas, 14 November 2026): every gap is at least as large as the labels
 * that will be drawn in it, measured as the canvas draws them ({@link measureLabel}). A long
 * edge's passage is wide enough for its label beside its line, a row gap is tall enough for the
 * labels below the row, and the column beside the flow is far enough out for the label of a
 * connection into it. The caller checks the result by routing it, and asks for more room where
 * a label still found no clear place — before the side column (`widenBeside`) when the label's
 * edge goes into it, else in every gap (`widen`); see `bestLayout` in loop-graph-editing.
 *
 * It places boxes only. It never changes what the drawing means, and it runs when the person
 * asks (**Arrange**) or for nodes the file gave no position; a placed drawing is not moved.
 */

import type { NodeKind } from './loop-graph';
import { nodeSize } from './loop-edge-geometry';
import { measureLabel } from './loop-edge-labels';
import { findBackEdges } from './loop-edge-routing';

/** Where the first row starts: clear of the palette bar, as the grid it replaces was. */
export const LAYOUT_TOP_LEFT = { x: 48, y: 40 } as const;
/** Between one row's tallest box and the next row, room for edges and their labels. */
export const LAYER_GAP = 76;
/** Between two boxes in a row. */
export const COLUMN_GAP = 56;
/** Barycentre sweeps (each one down and one up). */
const SWEEPS = 4;
/** Coordinate passes (each one down and one up); the fit settles well within them. */
const FIT_PASSES = 60;
/** How much harder a link along a path pulls its ends into line than a fork or a join does. */
const PATH_PULL = 32;
/** A node this close to in line with the one above it is put exactly in line. */
const SNAP = 8;
/** How much each step of `widen` adds to every column gap and every row gap. */
const WIDEN_COLUMN = 24;
const WIDEN_LAYER = 16;
/** How much each step of `widenBeside` moves the column beside the flow out. */
const WIDEN_BESIDE = 40;
/** The router keeps this far from a box (its MARGIN); a label in a gap needs it on both sides. */
const ROUTE_MARGIN = 16;
/** A label's own clearance from boxes and other labels, with a little to spare. */
const LABEL_ROOM = 8;
/** A long edge's passage, left of its line. Its label goes right of the line. */
const PASSAGE_HALF = 8;

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

export interface LayoutOptions {
  /**
   * S18a's `sidePathEdges`. They take no part in the main flow's grouping (3), and, unless
   * `besideEndings` is false, an ending only they reach goes beside the flow.
   */
  readonly sidePaths?: ReadonlySet<string>;
  /** Default true. False keeps every ending in the last row. */
  readonly besideEndings?: boolean;
  /** The label each edge shows, by edge id, so the gaps can hold it. */
  readonly labelOf?: (edgeId: string) => string;
  /** Steps of extra room in every gap, for labels the router still could not place clear. */
  readonly widen?: number;
  /** Steps of extra room before the column beside the flow only, for the labels going into it. */
  readonly widenBeside?: number;
}

export interface LayoutResult {
  /** Each node's top-left corner, by id. */
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  /** Each node's layer, 0 for the first row. */
  readonly layers: ReadonlyMap<string, number>;
  /** The endings set in the column beside the flow. */
  readonly beside: ReadonlySet<string>;
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
export function layeredLayout(graph: LayoutGraph, options: LayoutOptions = {}): LayoutResult {
  const side = options.sidePaths ?? new Set<string>();
  const widen = Math.max(0, options.widen ?? 0);
  const columnGap = COLUMN_GAP + widen * WIDEN_COLUMN;
  const layerGap = LAYER_GAP + widen * WIDEN_LAYER;
  const labelSize = (edgeId: string): { width: number; height: number } =>
    options.labelOf === undefined ? { width: 0, height: 0 } : measureLabel(options.labelOf(edgeId));

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
    options.sidePaths === undefined || options.besideEndings === false
      ? []
      : all
          .filter((node) => {
            const into = incoming.get(node.id) ?? [];
            return node.kind === 'terminal' && node.id !== graph.entry && into.length > 0 && into.every((edge) => side.has(edge.id));
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

  // 3. Passages: the main flow as links between adjacent rows, a long edge through one
  //    placeholder per row it passes. Side paths link their ends directly, as a fallback.
  const depth = Math.max(0, ...layer.values());
  const rows: string[][] = Array.from({ length: depth + 1 }, () => []);
  for (const node of nodes) {
    rows[layer.get(node.id) ?? 0]?.push(node.id);
  }
  const mainUp = new Map<string, string[]>();
  const mainDown = new Map<string, string[]>();
  const sideUp = new Map<string, string[]>();
  const sideDown = new Map<string, string[]>();
  const link = (up: Map<string, string[]>, down: Map<string, string[]>, from: string, to: string): void => {
    down.set(from, [...(down.get(from) ?? []), to]);
    up.set(to, [...(up.get(to) ?? []), from]);
  };
  /** A placeholder's room: left of its line, and right of it, where its label goes. */
  const passage = new Map<string, { readonly left: number; readonly right: number }>();
  for (const edge of forward) {
    const from = layer.get(edge.from) ?? 0;
    const to = layer.get(edge.to) ?? 0;
    if (to <= from) {
      continue;
    }
    if (side.has(edge.id)) {
      link(sideUp, sideDown, edge.from, edge.to);
      continue;
    }
    let previous = edge.from;
    const label = labelSize(edge.id);
    for (let at = from + 1; at < to; at += 1) {
      const id = `\u0000${edge.id}\u0000${String(at)}`;
      rows[at]?.push(id);
      passage.set(id, { left: PASSAGE_HALF, right: label.width === 0 ? PASSAGE_HALF : 4 + label.width + LABEL_ROOM });
      link(mainUp, mainDown, previous, id);
      previous = id;
    }
    link(mainUp, mainDown, previous, edge.to);
  }
  const upOf = (id: string): readonly string[] => mainUp.get(id) ?? sideUp.get(id) ?? [];
  const downOf = (id: string): readonly string[] => mainDown.get(id) ?? sideDown.get(id) ?? [];

  // 4. Rows, ordered by barycentre sweeps.
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
      reorder(rows[at] as string[], upOf);
      remember();
    }
    for (let at = rows.length - 2; at >= 0; at -= 1) {
      reorder(rows[at] as string[], downOf);
      remember();
    }
  }

  // 5. Coordinates: centres by an isotonic fit to the neighbours, down and up, ending down.
  const byId = new Map(all.map((node) => [node.id, node]));
  const sizeOf = (id: string): { width: number; height: number } => nodeSize(byId.get(id) ?? { kind: kinds.get(id) ?? 'agent' });
  const halves = (id: string): { readonly left: number; readonly right: number } => {
    const room = passage.get(id);
    if (room !== undefined) {
      return room;
    }
    const half = sizeOf(id).width / 2;
    return { left: half, right: half };
  };
  const centre = new Map<string, number>();
  for (const row of rows) {
    let x = 0;
    row.forEach((id, index) => {
      if (index > 0) {
        x += columnGap;
      }
      x += halves(id).left;
      centre.set(id, x);
      x += halves(id).right;
    });
  }
  // Each main-flow link pulls its two ends into line, so the fit is a least-squares compromise
  // over the whole drawing. A link along a path — its upper end has no other main successor
  // and its lower end no other main predecessor, as every link of a long edge — pulls far
  // harder, so a branch keeps its column until it meets another; a link into a join or
  // out of a fork pulls lightly, so the join sits between its paths. Where a passage must make
  // room for its label, the rows above and below follow it. A node the main flow does not
  // reach is pulled, more weakly, by its side paths.
  const linkWeight = (upper: string, lower: string): number => {
    return (mainDown.get(upper)?.length ?? 0) === 1 && (mainUp.get(lower)?.length ?? 0) === 1 ? PATH_PULL : 1;
  };
  const pulls = (id: string): readonly { readonly id: string; readonly weight: number }[] => {
    const main = [
      ...(mainUp.get(id) ?? []).map((other) => ({ id: other, weight: linkWeight(other, id) })),
      ...(mainDown.get(id) ?? []).map((other) => ({ id: other, weight: linkWeight(id, other) })),
    ];
    if (main.length > 0) {
      return main;
    }
    return [...(sideUp.get(id) ?? []), ...(sideDown.get(id) ?? [])].map((other) => ({ id: other, weight: 0.3 }));
  };
  const fit = (row: readonly string[]): void => {
    if (row.length === 0) {
      return;
    }
    const targets: number[] = [];
    const weights: number[] = [];
    let offset = 0;
    row.forEach((id, index) => {
      if (index > 0) {
        offset += halves(row[index - 1] as string).right + columnGap + halves(id).left;
      }
      const near = pulls(id).filter((other) => centre.has(other.id));
      const total = near.reduce((sum, other) => sum + other.weight, 0);
      const wanted = total === 0 ? (centre.get(id) ?? 0) : near.reduce((sum, other) => sum + other.weight * (centre.get(other.id) ?? 0), 0) / total;
      targets.push(wanted - offset);
      weights.push(total === 0 ? 0.05 : total);
    });
    const fitted = isotonic(targets, weights);
    offset = 0;
    row.forEach((id, index) => {
      if (index > 0) {
        offset += halves(row[index - 1] as string).right + columnGap + halves(id).left;
      }
      centre.set(id, (fitted[index] ?? 0) + offset);
    });
  };
  for (let pass = 0; pass < FIT_PASSES; pass += 1) {
    for (let at = 0; at < rows.length; at += 1) {
      fit(rows[at] as string[]);
    }
    for (let at = rows.length - 1; at >= 0; at -= 1) {
      fit(rows[at] as string[]);
    }
  }
  // Whole units, and a node all but in line with the one above it put exactly in line, so a
  // straight connection is drawn straight: the lower one moves where its row has room, else,
  // along a path whose upper end is not itself held in line from above, the upper one does.
  for (const [id, at] of centre) {
    centre.set(id, Math.round(at));
  }
  const rowOf = new Map<string, readonly string[]>();
  for (const row of rows) {
    for (const id of row) {
      rowOf.set(id, row);
    }
  }
  const fits = (id: string, aim: number): boolean => {
    const row = rowOf.get(id) ?? [];
    const index = row.indexOf(id);
    const left = row[index - 1];
    const right = row[index + 1];
    return (
      (left === undefined || aim - halves(id).left - columnGap - halves(left).right >= (centre.get(left) ?? 0)) &&
      (right === undefined || aim + halves(id).right + columnGap + halves(right).left <= (centre.get(right) ?? 0))
    );
  };
  const onPath = (upper: string, lower: string): boolean =>
    (mainDown.get(upper)?.length ?? 0) === 1 && (mainUp.get(lower)?.length ?? 0) === 1;
  for (const row of rows) {
    for (const id of row) {
      const above = mainUp.get(id) ?? [];
      const upper = above.length === 1 ? (above[0] as string) : undefined;
      if (upper === undefined) {
        continue;
      }
      const aim = centre.get(upper) ?? 0;
      const now = centre.get(id) ?? 0;
      if (aim === now || Math.abs(aim - now) > SNAP) {
        continue;
      }
      if (fits(id, aim)) {
        centre.set(id, aim);
      } else if (onPath(upper, id) && !(mainUp.get(upper) ?? []).some((top) => onPath(top, upper)) && fits(upper, now)) {
        centre.set(upper, now);
      }
    }
  }
  const lefts = rows.flat().map((id) => (centre.get(id) ?? 0) - halves(id).left);
  const shift = LAYOUT_TOP_LEFT.x - (lefts.length === 0 ? 0 : Math.min(...lefts));
  const positions = new Map<string, { x: number; y: number }>();
  const rowTops: number[] = [];
  let y: number = LAYOUT_TOP_LEFT.y;
  rows.forEach((row, at) => {
    rowTops.push(y);
    for (const id of row) {
      if (!passage.has(id)) {
        positions.set(id, { x: Math.round((centre.get(id) ?? 0) + shift - sizeOf(id).width / 2), y });
      }
    }
    // Tall enough for the labels of the edges that leave this row, between the routes'
    // margins above and below them.
    const labels = forward.filter((edge) => layer.get(edge.from) === at).map((edge) => labelSize(edge.id).height);
    const gap = Math.max(layerGap, 2 * ROUTE_MARGIN + LABEL_ROOM + Math.max(0, ...labels));
    y += Math.max(0, ...row.filter((id) => !passage.has(id)).map((id) => sizeOf(id).height)) + gap;
  });

  // 6. The endings beside the main flow: one column to its right, far enough out for the label
  //    of a connection into it, each at the row of the middle one of the steps leading to it,
  //    moved down a row while that place is taken. Ordered by that row, then by file order.
  const rightmost = Math.max(LAYOUT_TOP_LEFT.x, ...rows.flat().map((id) => (centre.get(id) ?? 0) + shift + halves(id).right));
  const intoBeside = graph.edges.filter((edge) => besideIds.has(edge.to)).map((edge) => labelSize(edge.id).width);
  const besideGap = Math.max(columnGap, 2 * ROUTE_MARGIN + LABEL_ROOM + Math.max(0, ...intoBeside));
  const besideX = Math.round(rightmost + besideGap + Math.max(0, options.widenBeside ?? 0) * WIDEN_BESIDE);
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
    const top = rowTops[row] ?? y + (row - rowTops.length) * (sizeOf(entry.id).height + layerGap);
    positions.set(entry.id, { x: besideX, y: top });
    layer.set(entry.id, row);
  }
  return { positions, layers: layer, beside: besideIds };
}

/**
 * The non-decreasing sequence nearest to `targets` in weighted least squares (pool adjacent
 * violators). Used on a row's centres less their minimum offsets, it keeps the row's order and
 * gaps while placing each box as near as it can be to where its neighbours want it.
 */
function isotonic(targets: readonly number[], weights: readonly number[]): number[] {
  const blocks: { value: number; weight: number; count: number }[] = [];
  targets.forEach((target, index) => {
    blocks.push({ value: target, weight: weights[index] ?? 1, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1] as { value: number; weight: number; count: number };
      const before = blocks[blocks.length - 2] as { value: number; weight: number; count: number };
      if (before.value <= last.value) {
        break;
      }
      const weight = before.weight + last.weight;
      blocks.splice(blocks.length - 2, 2, {
        value: (before.value * before.weight + last.value * last.weight) / weight,
        weight,
        count: before.count + last.count,
      });
    }
  });
  return blocks.flatMap((block) => Array.from({ length: block.count }, () => block.value));
}
