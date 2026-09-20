/**
 * Where a connection meets a node's box.
 *
 * Side is decided by the geometry of the two centres (or a control point), not by
 * port ids in the file. The attach point sits on the box edge — not offset into
 * empty space. Routing stays a straight or bowed curve; nothing here turns a
 * connection into an orthogonal path.
 */

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 54;
export const ANCHOR_DOT_RADIUS = 3.5;

export type NodeSide = 'top' | 'right' | 'bottom' | 'left';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly side: NodeSide;
}

export function nodeBox(
  view: { readonly x?: number; readonly y?: number } | undefined,
  width = NODE_WIDTH,
  height = NODE_HEIGHT,
): Box {
  return {
    x: view?.x ?? 0,
    y: view?.y ?? 0,
    width,
    height,
  };
}

export function boxCentre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The point on `box` that faces `from`.
 *
 * A ray from the box centre toward `from` hits exactly one face. That face is the
 * side; the hit is the attach point. Two nodes stacked vertically therefore meet
 * on top/bottom; two side by side meet on left/right.
 */
export function attachPoint(from: Point, box: Box): Anchor {
  const centre = boxCentre(box);
  const dx = from.x - centre.x;
  const dy = from.y - centre.y;
  if (dx === 0 && dy === 0) {
    return { x: centre.x, y: box.y, side: 'top' };
  }

  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const scaleX =
    Math.abs(dx) < 1e-9 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const scaleY =
    Math.abs(dy) < 1e-9 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  const x = centre.x + dx * scale;
  const y = centre.y + dy * scale;

  const side: NodeSide =
    scaleX < scaleY ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';

  return { x, y, side };
}
