/**
 * DSP-209 S18a (R2): orthogonal edge routes that go around nodes.
 *
 * Every edge is drawn as horizontal and vertical segments between ports on the sides of
 * its two nodes, at the positions the drawing saved. Nothing here moves a node or writes
 * anything: the routes are derived from the graph each time, so the saved bytes stay what
 * they were and there is no second copy of the layout to drift.
 *
 * **How a route is found.** The node boxes, grown by a margin, are obstacles. Their edges,
 * the ports and the lanes give a small set of x and y lines; their crossings outside every
 * obstacle form a grid, and an A* search over that grid finds the cheapest path, where a
 * bend costs extra and a stretch another edge already uses costs a little more. So routes
 * are short, turn rarely and spread out rather than stacking on one line.
 *
 * **Back edges.** An edge that returns to a node still being explored by a depth-first
 * search from `entry` (outgoing edges taken in the order the file lists them) is a back
 * edge: rework and return paths. It leaves and enters on the same outer side of its two
 * nodes and runs in a lane outside every node in the band it spans, so the main flow
 * reads without it. {@link findBackEdges} is exported for the layered layout (S18b).
 *
 * **Deterministic.** Every order is the file's order or a sort with an explicit tie-break,
 * and the inputs are only the nodes' kinds, fan-out declarations and saved positions and
 * the edges' ends. Run state is not an input, so a run cannot move a route.
 *
 * Pure: no DOM, no Node built-ins, no dependency (decision 36).
 */

import type { NodeKind } from './loop-graph';
import { nodeCornerRadius, nodeSize, type Box, type NodeSide, type Point } from './loop-edge-geometry';

/* ------------------------------------------------------------------------- */
/* Inputs and outputs                                                         */
/* ------------------------------------------------------------------------- */

/** What routing reads of a node: no run state, no role, no text. */
export interface RoutingNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly fanOut?: unknown;
  readonly view?: { readonly x?: number; readonly y?: number };
}

export interface RoutingEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface RoutingGraph {
  readonly entry: string;
  readonly nodes: readonly RoutingNode[];
  readonly edges: readonly RoutingEdge[];
}

export type LaneSide = NodeSide;

export interface EdgeRoute {
  readonly edgeId: string;
  /** Port on the source outline, every bend, port on the target outline. */
  readonly points: readonly Point[];
  /** The same points as an SVG path, with rounded corners. */
  readonly path: string;
  readonly back: boolean;
  /** The outer side a back edge's lane runs on; `null` for the main flow. */
  readonly lane: LaneSide | null;
  readonly sourceSide: NodeSide;
  readonly targetSide: NodeSide;
  /** Where the label's text is centred (baseline), on a segment clear of nodes and other labels. */
  readonly label: Point;
}

export interface RouteOptions<E extends RoutingEdge = RoutingEdge> {
  /** The label each edge will show, so it can be placed where it fits. */
  readonly labelOf?: (edge: E) => string;
}

/* ------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* ------------------------------------------------------------------------- */

/** How far a route keeps from any node box, and the length of the straight stub at a port. */
const MARGIN = 16;
/** Ports on one side are at most this far apart. */
const PORT_GAP = 14;
/** The first lane is this far outside the outermost node in its band; later lanes step out by `LANE_GAP`. */
const LANE_OFFSET = 30;
const LANE_GAP = 14;
/** The cost of one bend, in units of length. */
const BEND_COST = 40;
/** The extra cost per unit of length for running along a stretch another route already uses. */
const SHARED_COST = 0.6;
/** Corner rounding of the drawn path. */
export const ROUTE_CORNER_RADIUS = 8;
/** Label metrics, matching `.edge-label` (10px). */
const LABEL_CHAR_WIDTH = 5.6;
const LABEL_HEIGHT = 12;

/* ------------------------------------------------------------------------- */
/* Back edges                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * The ids of the edges that return to a node still on the depth-first path from `entry`.
 *
 * Outgoing edges are taken in the order the file lists them. Nodes the entry does not
 * reach are searched afterwards, in the order the file lists them, so every edge is
 * classified. A self-loop is a back edge. Edges to or from an unknown node are not.
 */
export function findBackEdges(graph: RoutingGraph): ReadonlySet<string> {
  const outgoing = new Map<string, RoutingEdge[]>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (outgoing.has(edge.to)) {
      outgoing.get(edge.from)?.push(edge);
    }
  }
  const state = new Map<string, 'open' | 'done'>();
  const back = new Set<string>();
  const visit = (id: string): void => {
    state.set(id, 'open');
    for (const edge of outgoing.get(id) ?? []) {
      const seen = state.get(edge.to);
      if (seen === 'open') {
        back.add(edge.id);
      } else if (seen === undefined) {
        visit(edge.to);
      }
    }
    state.set(id, 'done');
  };
  if (outgoing.has(graph.entry)) {
    visit(graph.entry);
  }
  for (const node of graph.nodes) {
    if (!state.has(node.id)) {
      visit(node.id);
    }
  }
  return back;
}

/* ------------------------------------------------------------------------- */
/* Boxes and ports                                                            */
/* ------------------------------------------------------------------------- */

export function routingBox(node: RoutingNode): Box {
  const size = nodeSize(node);
  return { x: node.view?.x ?? 0, y: node.view?.y ?? 0, width: size.width, height: size.height };
}

const OUTWARD: Record<NodeSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function horizontalSide(side: NodeSide): boolean {
  return side === 'top' || side === 'bottom';
}

/** How much of a side ports may be spread over, centred on its middle. */
function usableSpan(kind: NodeKind, box: Box, side: NodeSide): number {
  const length = horizontalSide(side) ? box.width : box.height;
  if (kind === 'router') {
    return length * 0.3;
  }
  const radius = Math.min(nodeCornerRadius(kind), box.width / 2, box.height / 2);
  return Math.max(length - 2 * radius - 8, length * 0.5);
}

/**
 * The point on the node's drawn outline at `offset` from the middle of `side`.
 *
 * On a straight stretch it is the box edge. In a rounded corner, on a pill's ends or on a
 * diamond it is pulled in to the outline, so a connection never ends in the air.
 */
function outlinePoint(kind: NodeKind, box: Box, side: NodeSide, offset: number): Point {
  const half = horizontalSide(side) ? box.width / 2 : box.height / 2;
  const across = horizontalSide(side) ? box.height / 2 : box.width / 2;
  let inset = 0;
  if (kind === 'router') {
    inset = (Math.abs(offset) * across) / half;
  } else {
    const radius = Math.min(nodeCornerRadius(kind), box.width / 2, box.height / 2);
    const intoCorner = Math.abs(offset) - (half - radius);
    if (intoCorner > 0) {
      inset = radius - Math.sqrt(Math.max(0, radius * radius - intoCorner * intoCorner));
    }
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  switch (side) {
    case 'top':
      return { x: cx + offset, y: box.y + inset };
    case 'bottom':
      return { x: cx + offset, y: box.y + box.height - inset };
    case 'left':
      return { x: box.x + inset, y: cy + offset };
    case 'right':
      return { x: box.x + box.width - inset, y: cy + offset };
  }
}

/** The stub's outer end: straight out from the port to the margin around the box. */
function stubEnd(box: Box, side: NodeSide, port: Point): Point {
  switch (side) {
    case 'top':
      return { x: port.x, y: box.y - MARGIN };
    case 'bottom':
      return { x: port.x, y: box.y + box.height + MARGIN };
    case 'left':
      return { x: box.x - MARGIN, y: port.y };
    case 'right':
      return { x: box.x + box.width + MARGIN, y: port.y };
  }
}

function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const SIDES: readonly NodeSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * Whether a route can leave `box` by `side`: the line its stubs end on, across the middle
 * of the side, lies outside every other node and its margin. Two nodes drawn closer than
 * twice the margin leave no room between them, and a port facing the other would be shut in
 * — even when the other is the edge's own far end, which is then reached round the outside.
 */
function sideClear(box: Box, side: NodeSide, boxes: readonly Box[]): boolean {
  const reach = MARGIN;
  const a =
    side === 'top'
      ? { x: box.x + box.width * 0.25, y: box.y - reach }
      : side === 'bottom'
        ? { x: box.x + box.width * 0.25, y: box.y + box.height + reach }
        : side === 'left'
          ? { x: box.x - reach, y: box.y + box.height * 0.25 }
          : { x: box.x + box.width + reach, y: box.y + box.height * 0.25 };
  const b = horizontalSide(side) ? { x: box.x + box.width * 0.75, y: a.y } : { x: a.x, y: box.y + box.height * 0.75 };
  return boxes.every((other) => {
    if (other === box) {
      return true;
    }
    const grown = { x: other.x - MARGIN, y: other.y - MARGIN, width: other.width + 2 * MARGIN, height: other.height + 2 * MARGIN };
    return !segmentCrossesBox(a, b, grown) && !pointInside(a, grown) && !pointInside(b, grown);
  });
}

function pointInside(point: Point, box: Box): boolean {
  return point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height;
}

/**
 * Which sides a main-flow edge leaves and enters by.
 *
 * The facing pair from {@link facingSides} when both are clear; otherwise the clear pair
 * whose stub ends are nearest, counting a pair that does not face each other as longer.
 */
function forwardSides(source: Box, target: Box, boxes: readonly Box[]): { readonly from: NodeSide; readonly to: NodeSide } {
  const preferred = facingSides(source, target);
  if (sideClear(source, preferred.from, boxes) && sideClear(target, preferred.to, boxes)) {
    return preferred;
  }
  let best: { from: NodeSide; to: NodeSide; cost: number } | null = null;
  for (const from of SIDES) {
    if (!sideClear(source, from, boxes)) {
      continue;
    }
    for (const to of SIDES) {
      if (!sideClear(target, to, boxes)) {
        continue;
      }
      const a = sideMiddle(source, from);
      const b = sideMiddle(target, to);
      const cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (from === preferred.from ? 0 : 60) + (to === preferred.to ? 0 : 60);
      if (best === null || cost < best.cost) {
        best = { from, to, cost };
      }
    }
  }
  return best ?? preferred;
}

function sideMiddle(box: Box, side: NodeSide): Point {
  const vector = OUTWARD[side];
  return {
    x: box.x + box.width / 2 + (vector.x * (box.width / 2 + MARGIN)),
    y: box.y + box.height / 2 + (vector.y * (box.height / 2 + MARGIN)),
  };
}

/** The sides that face each other, from where the two boxes are. */
function facingSides(source: Box, target: Box): { readonly from: NodeSide; readonly to: NodeSide } {
  const a = centre(source);
  const b = centre(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const gapX = Math.abs(dx) - (source.width + target.width) / 2;
  const gapY = Math.abs(dy) - (source.height + target.height) / 2;
  const vertical =
    gapY > 0 ? gapX <= 0 || gapY * 2 >= gapX : gapX <= 0 ? Math.abs(dy) * 3 >= Math.abs(dx) : false;
  if (vertical) {
    return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
  }
  return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
}

/* ------------------------------------------------------------------------- */
/* Geometry helpers, exported for the tests' measurements                    */
/* ------------------------------------------------------------------------- */

/**
 * Whether the axis-parallel segment `a`–`b` passes through the inside of `box`.
 * Touching or running along its border is not crossing it.
 */
export function segmentCrossesBox(a: Point, b: Point, box: Box): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const epsilon = 1e-6;
  return (
    maxX > box.x + epsilon &&
    minX < box.x + box.width - epsilon &&
    maxY > box.y + epsilon &&
    minY < box.y + box.height - epsilon
  );
}

function rectsOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** An orthogonal polyline as a path, each corner rounded by up to `radius`. */
export function roundedPath(points: readonly Point[], radius: number = ROUTE_CORNER_RADIUS): string {
  const n = (value: number): string => String(Math.round(value * 100) / 100);
  if (points.length === 0) {
    return '';
  }
  const first = points[0] as Point;
  const parts = [`M ${n(first.x)} ${n(first.y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1] as Point;
    const corner = points[index] as Point;
    const after = points[index + 1] as Point;
    const inLength = Math.hypot(corner.x - before.x, corner.y - before.y);
    const outLength = Math.hypot(after.x - corner.x, after.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0) {
      parts.push(`L ${n(corner.x)} ${n(corner.y)}`);
      continue;
    }
    const enter = {
      x: corner.x - ((corner.x - before.x) / inLength) * r,
      y: corner.y - ((corner.y - before.y) / inLength) * r,
    };
    const leave = {
      x: corner.x + ((after.x - corner.x) / outLength) * r,
      y: corner.y + ((after.y - corner.y) / outLength) * r,
    };
    parts.push(`L ${n(enter.x)} ${n(enter.y)}`, `Q ${n(corner.x)} ${n(corner.y)} ${n(leave.x)} ${n(leave.y)}`);
  }
  const last = points[points.length - 1] as Point;
  parts.push(`L ${n(last.x)} ${n(last.y)}`);
  return parts.join(' ');
}

/** Drops repeated points and points in the middle of a straight run. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(last.x - point.x) < 1e-9 && Math.abs(last.y - point.y) < 1e-9) {
      continue;
    }
    const before = out[out.length - 2];
    if (
      before !== undefined &&
      last !== undefined &&
      ((Math.abs(before.x - last.x) < 1e-9 && Math.abs(last.x - point.x) < 1e-9) ||
        (Math.abs(before.y - last.y) < 1e-9 && Math.abs(last.y - point.y) < 1e-9))
    ) {
      out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* The visibility grid and A*                                                 */
/* ------------------------------------------------------------------------- */

const DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function directionIndex(vector: Point): number {
  return DIRECTIONS.findIndex((entry) => entry.x === vector.x && entry.y === vector.y);
}

class Grid {
  readonly xs: number[];
  readonly ys: number[];
  /** Whether a grid point is free, by `xi * ys.length + yi`. */
  private readonly free: Uint8Array;
  /** Whether the step from a point to its neighbour in direction 0 (right) or 1 (down) is free. */
  private readonly openRight: Uint8Array;
  private readonly openDown: Uint8Array;
  /** Steps already used by a route, keyed like `openRight`/`openDown`. */
  private readonly usedRight: Uint8Array;
  private readonly usedDown: Uint8Array;

  constructor(xs: Iterable<number>, ys: Iterable<number>, obstacles: readonly Box[]) {
    this.xs = [...new Set([...xs].map(round))].sort((a, b) => a - b);
    this.ys = [...new Set([...ys].map(round))].sort((a, b) => a - b);
    const size = this.xs.length * this.ys.length;
    this.free = new Uint8Array(size);
    this.openRight = new Uint8Array(size);
    this.openDown = new Uint8Array(size);
    this.usedRight = new Uint8Array(size);
    this.usedDown = new Uint8Array(size);
    const inside = (x: number, y: number): boolean =>
      obstacles.some((box) => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height);
    for (let xi = 0; xi < this.xs.length; xi += 1) {
      for (let yi = 0; yi < this.ys.length; yi += 1) {
        const x = this.xs[xi] as number;
        const y = this.ys[yi] as number;
        const index = xi * this.ys.length + yi;
        this.free[index] = inside(x, y) ? 0 : 1;
        if (xi + 1 < this.xs.length) {
          this.openRight[index] = inside((x + (this.xs[xi + 1] as number)) / 2, y) ? 0 : 1;
        }
        if (yi + 1 < this.ys.length) {
          this.openDown[index] = inside(x, (y + (this.ys[yi + 1] as number)) / 2) ? 0 : 1;
        }
      }
    }
  }

  indexOf(point: Point): number {
    const xi = binarySearch(this.xs, round(point.x));
    const yi = binarySearch(this.ys, round(point.y));
    if (xi < 0 || yi < 0) {
      return -1;
    }
    return xi * this.ys.length + yi;
  }

  point(index: number): Point {
    const xi = Math.floor(index / this.ys.length);
    const yi = index % this.ys.length;
    return { x: this.xs[xi] as number, y: this.ys[yi] as number };
  }

  isFree(index: number): boolean {
    return this.free[index] === 1;
  }

  /** The neighbour of `index` in `direction`, or -1 when the step is blocked or off the grid. */
  neighbour(index: number, direction: number): number {
    const rows = this.ys.length;
    const xi = Math.floor(index / rows);
    const yi = index % rows;
    switch (direction) {
      case 0:
        return xi + 1 < this.xs.length && this.openRight[index] === 1 ? index + rows : -1;
      case 1:
        return yi + 1 < rows && this.openDown[index] === 1 ? index + 1 : -1;
      case 2:
        return xi > 0 && this.openRight[index - rows] === 1 ? index - rows : -1;
      default:
        return yi > 0 && this.openDown[index - 1] === 1 ? index - 1 : -1;
    }
  }

  private stepKey(index: number, direction: number): { readonly table: Uint8Array; readonly at: number } {
    const rows = this.ys.length;
    switch (direction) {
      case 0:
        return { table: this.usedRight, at: index };
      case 1:
        return { table: this.usedDown, at: index };
      case 2:
        return { table: this.usedRight, at: index - rows };
      default:
        return { table: this.usedDown, at: index - 1 };
    }
  }

  isUsed(index: number, direction: number): boolean {
    const key = this.stepKey(index, direction);
    return key.table[key.at] === 1;
  }

  /** Marks every grid step along an axis-parallel polyline as used. */
  markUsed(points: readonly Point[]): void {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as Point;
      const b = points[i] as Point;
      let index = this.indexOf(a);
      const end = this.indexOf(b);
      if (index < 0 || end < 0) {
        continue;
      }
      const direction = directionIndex({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
      if (direction < 0) {
        continue;
      }
      let guard = this.xs.length + this.ys.length;
      while (index !== end && guard > 0) {
        const key = this.stepKey(index, direction);
        key.table[key.at] = 1;
        const rows = this.ys.length;
        index = direction === 0 ? index + rows : direction === 1 ? index + 1 : direction === 2 ? index - rows : index - 1;
        guard -= 1;
      }
    }
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function binarySearch(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const value = values[mid] as number;
    if (value === target) {
      return mid;
    }
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}

/** A binary heap on (cost, order of insertion), so equal costs pop in a fixed order. */
class Heap {
  private readonly items: { cost: number; seq: number; state: number }[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(cost: number, state: number): void {
    const item = { cost, seq: this.seq, state };
    this.seq += 1;
    this.items.push(item);
    let at = this.items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.less(item, this.items[parent] as typeof item)) {
        break;
      }
      this.items[at] = this.items[parent] as typeof item;
      at = parent;
    }
    this.items[at] = item;
  }

  pop(): number {
    const top = this.items[0] as { state: number };
    const last = this.items.pop() as { cost: number; seq: number; state: number };
    if (this.items.length > 0) {
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let smallest = last;
        let next = -1;
        if (left < this.items.length && this.less(this.items[left] as typeof last, smallest)) {
          smallest = this.items[left] as typeof last;
          next = left;
        }
        if (right < this.items.length && this.less(this.items[right] as typeof last, smallest)) {
          next = right;
        }
        if (next < 0) {
          break;
        }
        this.items[at] = this.items[next] as typeof last;
        at = next;
      }
      this.items[at] = last;
    }
    return top.state;
  }

  private less(a: { cost: number; seq: number }, b: { cost: number; seq: number }): boolean {
    return a.cost < b.cost || (a.cost === b.cost && a.seq < b.seq);
  }
}

/**
 * The cheapest grid path from `from` to `to`, leaving in `startDirection` and preferring to
 * arrive in `endDirection` (`-1` for either). `null` when the two are not connected.
 */
function search(grid: Grid, from: Point, to: Point, startDirection: number, endDirection: number): Point[] | null {
  const start = grid.indexOf(from);
  const goal = grid.indexOf(to);
  if (start < 0 || goal < 0 || !grid.isFree(start) || !grid.isFree(goal)) {
    return null;
  }
  if (start === goal) {
    return [from, to];
  }
  const goalPoint = grid.point(goal);
  const heuristic = (index: number): number => {
    const point = grid.point(index);
    return Math.abs(point.x - goalPoint.x) + Math.abs(point.y - goalPoint.y);
  };
  const best = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const heap = new Heap();
  const startState = start * 4 + startDirection;
  best.set(startState, 0);
  heap.push(heuristic(start), startState);
  while (heap.size > 0) {
    const state = heap.pop();
    const index = state >> 2;
    const direction = state & 3;
    const cost = best.get(state) ?? Number.POSITIVE_INFINITY;
    if (index === goal) {
      const states = [state];
      let at = state;
      while (cameFrom.has(at)) {
        at = cameFrom.get(at) as number;
        states.push(at);
      }
      return simplify(states.reverse().map((entry) => grid.point(entry >> 2)));
    }
    for (let next = 0; next < 4; next += 1) {
      if (next === (direction + 2) % 4) {
        continue;
      }
      const neighbour = grid.neighbour(index, next);
      if (neighbour < 0 || !grid.isFree(neighbour)) {
        continue;
      }
      const a = grid.point(index);
      const b = grid.point(neighbour);
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      let step = length + (next === direction ? 0 : BEND_COST);
      if (grid.isUsed(index, next)) {
        step += length * SHARED_COST;
      }
      if (neighbour === goal && endDirection >= 0 && next !== endDirection) {
        step += BEND_COST;
      }
      const nextState = neighbour * 4 + next;
      const total = cost + step;
      if (total < (best.get(nextState) ?? Number.POSITIVE_INFINITY)) {
        best.set(nextState, total);
        cameFrom.set(nextState, state);
        heap.push(total + heuristic(neighbour), nextState);
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Routing                                                                    */
/* ------------------------------------------------------------------------- */

interface EdgePlan {
  readonly edge: RoutingEdge;
  readonly index: number;
  readonly source: RoutingNode;
  readonly target: RoutingNode;
  readonly sourceBox: Box;
  readonly targetBox: Box;
  readonly back: boolean;
  readonly lane: LaneSide | null;
  readonly laneAt: number;
  readonly fromSide: NodeSide;
  readonly toSide: NodeSide;
}

interface PortEnd {
  readonly plan: EdgePlan;
  readonly end: 'source' | 'target';
  readonly node: RoutingNode;
  readonly box: Box;
  readonly side: NodeSide;
  /** Where the other end lies along this side's axis, for ordering the ports. */
  readonly towards: number;
}

/**
 * Every edge's route, by edge id, for the nodes at their saved positions.
 *
 * Edges whose ends name no node get no route. The result depends only on the graph (and
 * the label texts, which only move labels), never on a run.
 */
export function routeLoopEdges<E extends RoutingEdge>(
  graph: { readonly entry: string; readonly nodes: readonly RoutingNode[]; readonly edges: readonly E[] },
  options: RouteOptions<E> = {},
): ReadonlyMap<string, EdgeRoute> {
  const nodes = new Map<string, RoutingNode>();
  for (const node of graph.nodes) {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  }
  const boxes = new Map<string, Box>();
  for (const node of nodes.values()) {
    boxes.set(node.id, routingBox(node));
  }
  const allBoxes = [...boxes.values()];
  const back = findBackEdges(graph);

  // 1. Sides, and lanes for back edges (shortest band first, so shorter lanes sit inside).
  const plans: EdgePlan[] = [];
  const pending: { edge: RoutingEdge; index: number; source: RoutingNode; target: RoutingNode }[] = [];
  graph.edges.forEach((edge, index) => {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (source !== undefined && target !== undefined) {
      pending.push({ edge, index, source, target });
    }
  });
  const lanes: { side: LaneSide; at: number; from: number; to: number }[] = [];
  const backOrder = pending
    .filter((entry) => back.has(entry.edge.id))
    .map((entry) => ({ ...entry, span: bandSpan(boxes.get(entry.source.id) as Box, boxes.get(entry.target.id) as Box) }))
    .sort((a, b) => a.span - b.span || a.index - b.index);
  const lanePlans = new Map<string, { lane: LaneSide; at: number }>();
  for (const entry of backOrder) {
    const choice = chooseLane(boxes.get(entry.source.id) as Box, boxes.get(entry.target.id) as Box, allBoxes, lanes);
    lanes.push(choice.record);
    lanePlans.set(entry.edge.id, { lane: choice.lane, at: choice.at });
  }
  for (const entry of pending) {
    const sourceBox = boxes.get(entry.source.id) as Box;
    const targetBox = boxes.get(entry.target.id) as Box;
    const lane = lanePlans.get(entry.edge.id);
    const sides = lane === undefined ? forwardSides(sourceBox, targetBox, allBoxes) : { from: lane.lane, to: lane.lane };
    plans.push({
      ...entry,
      sourceBox,
      targetBox,
      back: lane !== undefined,
      lane: lane?.lane ?? null,
      laneAt: lane?.at ?? 0,
      fromSide: sides.from,
      toSide: sides.to,
    });
  }

  // 2. Ports, spread along each side in the order of where their other ends lie.
  const ends = new Map<string, PortEnd[]>();
  for (const plan of plans) {
    const pairs: [PortEnd, PortEnd] = [
      {
        plan,
        end: 'source',
        node: plan.source,
        box: plan.sourceBox,
        side: plan.fromSide,
        towards: alongSide(plan.fromSide, centre(plan.targetBox)),
      },
      {
        plan,
        end: 'target',
        node: plan.target,
        box: plan.targetBox,
        side: plan.toSide,
        towards: alongSide(plan.toSide, centre(plan.sourceBox)),
      },
    ];
    for (const end of pairs) {
      const key = `${end.node.id}\u0000${end.side}`;
      const list = ends.get(key) ?? [];
      list.push(end);
      ends.set(key, list);
    }
  }
  const ports = new Map<string, Point>();
  for (const list of ends.values()) {
    list.sort(
      (a, b) =>
        a.towards - b.towards ||
        a.plan.index - b.plan.index ||
        (a.end === b.end ? 0 : a.end === 'source' ? -1 : 1),
    );
    const first = list[0] as PortEnd;
    const span = usableSpan(first.node.kind, first.box, first.side);
    const gap = list.length > 1 ? Math.min(PORT_GAP, span / (list.length - 1)) : 0;
    list.forEach((end, position) => {
      const offset = (position - (list.length - 1) / 2) * gap;
      // Rounded as the grid's lines are, so the port, its stub and the grid share coordinates
      // exactly and every segment stays truly horizontal or vertical.
      const point = outlinePoint(end.node.kind, end.box, end.side, offset);
      ports.set(`${end.plan.edge.id}\u0000${end.end}`, { x: round(point.x), y: round(point.y) });
    });
  }

  // 3. The grid: box margins, ports, lanes and a frame, minus the grown boxes.
  const routed = routeAll(plans, ports, allBoxes, MARGIN) ?? routeAll(plans, ports, allBoxes, MARGIN / 2, true);

  // 4. Labels on free segments.
  const result = new Map<string, EdgeRoute>();
  const placed: Box[] = [];
  for (const plan of plans) {
    const points = (routed as Map<string, Point[]>).get(plan.edge.id) as Point[];
    const text = options.labelOf?.(plan.edge as E) ?? 'success';
    const label = placeLabel(points, text, allBoxes, placed);
    result.set(plan.edge.id, {
      edgeId: plan.edge.id,
      points,
      path: roundedPath(points),
      back: plan.back,
      lane: plan.lane,
      sourceSide: plan.fromSide,
      targetSide: plan.toSide,
      label,
    });
  }
  return result;
}

function bandSpan(a: Box, b: Box): number {
  return Math.abs(centre(a).x - centre(b).x) + Math.abs(centre(a).y - centre(b).y);
}

function alongSide(side: NodeSide, point: Point): number {
  return horizontalSide(side) ? point.x : point.y;
}

/**
 * The outer side a back edge's lane runs on, and where.
 *
 * Each side is tried: the lane lies outside every node in the band the two nodes span, and
 * outside every lane already on that side whose band overlaps. The cheapest by a rough
 * length, with a penalty for each node a straight leg to the lane would run into, wins;
 * ties go right, bottom, left, top. Left and top are refused when they would leave the
 * drawing's positive coordinates.
 */
function chooseLane(
  source: Box,
  target: Box,
  boxes: readonly Box[],
  lanes: readonly { side: LaneSide; at: number; from: number; to: number }[],
): { lane: LaneSide; at: number; record: { side: LaneSide; at: number; from: number; to: number } } {
  const sides: readonly LaneSide[] = ['right', 'bottom', 'left', 'top'];
  let best: { lane: LaneSide; at: number; from: number; to: number; cost: number } | null = null;
  const self = source === target;
  for (const side of sides) {
    if (!sideClear(source, side, boxes) || !sideClear(target, side, boxes)) {
      continue;
    }
    const vertical = side === 'left' || side === 'right';
    const from = vertical ? Math.min(source.y, target.y) : Math.min(source.x, target.x);
    const to = vertical
      ? Math.max(source.y + source.height, target.y + target.height)
      : Math.max(source.x + source.width, target.x + target.width);
    const inBand = boxes.filter((box) =>
      vertical ? box.y < to && box.y + box.height > from : box.x < to && box.x + box.width > from,
    );
    const outward = side === 'right' || side === 'bottom' ? 1 : -1;
    let at = self
      ? side === 'right'
        ? source.x + source.width + LANE_OFFSET
        : side === 'bottom'
          ? source.y + source.height + LANE_OFFSET
          : side === 'left'
            ? source.x - LANE_OFFSET
            : source.y - LANE_OFFSET
      : outward > 0
        ? Math.max(...inBand.map((box) => (vertical ? box.x + box.width : box.y + box.height))) + LANE_OFFSET
        : Math.min(...inBand.map((box) => (vertical ? box.x : box.y))) - LANE_OFFSET;
    for (const lane of lanes) {
      if (lane.side === side && lane.from < to && lane.to > from) {
        at = outward > 0 ? Math.max(at, lane.at + LANE_GAP) : Math.min(at, lane.at - LANE_GAP);
      }
    }
    if (at < MARGIN) {
      continue;
    }
    const s = centre(source);
    const t = centre(target);
    const legs = vertical
      ? Math.abs(at - (s.x + (outward * source.width) / 2)) + Math.abs(at - (t.x + (outward * target.width) / 2))
      : Math.abs(at - (s.y + (outward * source.height) / 2)) + Math.abs(at - (t.y + (outward * target.height) / 2));
    const run = vertical ? Math.abs(s.y - t.y) : Math.abs(s.x - t.x);
    let blocked = 0;
    for (const [box, start] of [
      [source, s],
      [target, t],
    ] as const) {
      const leg: [Point, Point] = vertical
        ? [{ x: outward > 0 ? box.x + box.width : box.x, y: start.y }, { x: at, y: start.y }]
        : [{ x: start.x, y: outward > 0 ? box.y + box.height : box.y }, { x: start.x, y: at }];
      blocked += boxes.filter((other) => other !== box && segmentCrossesBox(leg[0], leg[1], other)).length;
    }
    const cost = legs + run + blocked * 400;
    if (best === null || cost < best.cost) {
      best = { lane: side, at, from, to, cost };
    }
  }
  const chosen = best ?? {
    lane: 'right' as const,
    at: Math.max(source.x + source.width, target.x + target.width) + LANE_OFFSET,
    from: Math.min(source.y, target.y),
    to: Math.max(source.y + source.height, target.y + target.height),
    cost: 0,
  };
  return {
    lane: chosen.lane,
    at: chosen.at,
    record: { side: chosen.lane, at: chosen.at, from: chosen.from, to: chosen.to },
  };
}

/**
 * Routes every plan on one grid. `null` when some route cannot be found with this margin,
 * unless `lastTry`, when such a route falls back to a plain dog-leg so nothing is lost.
 */
function routeAll(
  plans: readonly EdgePlan[],
  ports: ReadonlyMap<string, Point>,
  boxes: readonly Box[],
  margin: number,
  lastTry = false,
): Map<string, Point[]> | null {
  const grown = boxes.map((box) => ({
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  }));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const box of grown) {
    xs.push(box.x, box.x + box.width);
    ys.push(box.y, box.y + box.height);
  }
  // Corridor middles between neighbouring boxes, so routes can run down the middle of a gap.
  const baseXs = [...new Set(xs)].sort((a, b) => a - b);
  const baseYs = [...new Set(ys)].sort((a, b) => a - b);
  for (let i = 1; i < baseXs.length; i += 1) {
    xs.push(((baseXs[i - 1] as number) + (baseXs[i] as number)) / 2);
  }
  for (let i = 1; i < baseYs.length; i += 1) {
    ys.push(((baseYs[i - 1] as number) + (baseYs[i] as number)) / 2);
  }
  const stubs = new Map<string, { port: Point; stub: Point }>();
  for (const plan of plans) {
    for (const end of ['source', 'target'] as const) {
      const port = ports.get(`${plan.edge.id}\u0000${end}`) as Point;
      const side = end === 'source' ? plan.fromSide : plan.toSide;
      const box = end === 'source' ? plan.sourceBox : plan.targetBox;
      const stub = stubEndAt(box, side, port, margin);
      stubs.set(`${plan.edge.id}\u0000${end}`, { port, stub });
      xs.push(stub.x);
      ys.push(stub.y);
    }
    if (plan.lane !== null) {
      if (plan.lane === 'left' || plan.lane === 'right') {
        xs.push(plan.laneAt);
      } else {
        ys.push(plan.laneAt);
      }
    }
  }
  const minX = Math.min(...grown.map((box) => box.x));
  const minY = Math.min(...grown.map((box) => box.y));
  const maxX = Math.max(...grown.map((box) => box.x + box.width), ...xs);
  const maxY = Math.max(...grown.map((box) => box.y + box.height), ...ys);
  xs.push(Math.max(margin / 2, minX - margin), maxX + margin);
  ys.push(Math.max(margin / 2, minY - margin), maxY + margin);
  const grid = new Grid(xs, ys, grown);

  const routes = new Map<string, Point[]>();
  for (const plan of plans) {
    const start = stubs.get(`${plan.edge.id}\u0000source`) as { port: Point; stub: Point };
    const end = stubs.get(`${plan.edge.id}\u0000target`) as { port: Point; stub: Point };
    const out = directionIndex(OUTWARD[plan.fromSide]);
    const into = (directionIndex(OUTWARD[plan.toSide]) + 2) % 4;
    let middle: Point[] | null;
    if (plan.lane === null) {
      middle = search(grid, start.stub, end.stub, out, into);
    } else {
      const vertical = plan.lane === 'left' || plan.lane === 'right';
      const laneStart = vertical ? { x: plan.laneAt, y: start.stub.y } : { x: start.stub.x, y: plan.laneAt };
      const laneEnd = vertical ? { x: plan.laneAt, y: end.stub.y } : { x: end.stub.x, y: plan.laneAt };
      const along = directionIndex(
        vertical
          ? { x: 0, y: Math.sign(laneEnd.y - laneStart.y) || 1 }
          : { x: Math.sign(laneEnd.x - laneStart.x) || 1, y: 0 },
      );
      const legA = search(grid, start.stub, laneStart, out, along);
      const legB = search(grid, laneEnd, end.stub, along, into);
      middle = legA === null || legB === null ? null : [...legA, ...legB];
    }
    if (middle === null) {
      if (!lastTry) {
        return null;
      }
      middle = [start.stub, { x: end.stub.x, y: start.stub.y }, end.stub];
    }
    const points = simplify([start.port, ...middle, end.port]);
    grid.markUsed(points);
    routes.set(plan.edge.id, points);
  }
  return routes;
}

function stubEndAt(box: Box, side: NodeSide, port: Point, margin: number): Point {
  if (margin === MARGIN) {
    return stubEnd(box, side, port);
  }
  const vector = OUTWARD[side];
  return horizontalSide(side)
    ? { x: port.x, y: (vector.y < 0 ? box.y : box.y + box.height) + vector.y * margin }
    : { x: (vector.x < 0 ? box.x : box.x + box.width) + vector.x * margin, y: port.y };
}

/**
 * The label's centre: the middle of the longest segment where the text clears every node
 * and every label already placed; the longest segment when none does.
 */
function placeLabel(points: readonly Point[], text: string, boxes: readonly Box[], placed: Box[]): Point {
  const width = text.length * LABEL_CHAR_WIDTH + 6;
  const segments: { a: Point; b: Point; length: number; index: number }[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    segments.push({ a, b, length: Math.abs(b.x - a.x) + Math.abs(b.y - a.y), index: i });
  }
  segments.sort((p, q) => q.length - p.length || p.index - q.index);
  const at = (segment: { a: Point; b: Point }): { anchor: Point; rect: Box } => {
    const mid = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
    if (segment.a.y === segment.b.y) {
      return {
        anchor: { x: mid.x, y: mid.y - 4 },
        rect: { x: mid.x - width / 2, y: mid.y - 4 - LABEL_HEIGHT + 2, width, height: LABEL_HEIGHT },
      };
    }
    return {
      anchor: { x: mid.x + 4 + width / 2, y: mid.y + 3 },
      rect: { x: mid.x + 4, y: mid.y + 3 - LABEL_HEIGHT + 2, width, height: LABEL_HEIGHT },
    };
  };
  for (const segment of segments) {
    const candidate = at(segment);
    if (
      !boxes.some((box) => rectsOverlap(candidate.rect, box)) &&
      !placed.some((other) => rectsOverlap(candidate.rect, other))
    ) {
      placed.push(candidate.rect);
      return candidate.anchor;
    }
  }
  const fallback = segments[0];
  if (fallback === undefined) {
    return points[0] ?? { x: 0, y: 0 };
  }
  const candidate = at(fallback);
  placed.push(candidate.rect);
  return candidate.anchor;
}

/** The furthest any route or label reaches, so the canvas can make room for outer lanes. */
export function routeExtent(routes: ReadonlyMap<string, EdgeRoute>): { readonly maxX: number; readonly maxY: number } {
  let maxX = 0;
  let maxY = 0;
  for (const route of routes.values()) {
    for (const point of [...route.points, route.label]) {
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { maxX, maxY };
}
