/**
 * Where a connection meets a node's box.
 *
 * Side is decided by the geometry of the two centres (or a control point), not by
 * port ids in the file. The attach point sits on the box edge — not offset into
 * empty space. Routing stays a straight or bowed curve; nothing here turns a
 * connection into an orthogonal path.
 *
 * It also holds the node's drawn outline, because a run's liveness is drawn on that
 * outline and the shape has to be stated in one place to stay the same shape.
 */

import type { NodeKind } from './loop-graph';

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
 * The corner rounding each kind of node is drawn with.
 *
 * Taken out of the `<rect>` it used to be written inline on, because DSP-80's glint
 * traces the outline as a separate path and the two must agree: a glint drawn with a
 * 6-pixel corner on a terminal drawn as a pill would cut across the ends. One function,
 * so that they cannot drift apart. `router` has no radius — it is a diamond — and is
 * answered for completeness rather than used.
 */
export function nodeCornerRadius(kind: NodeKind): number {
  switch (kind) {
    case 'terminal':
      return NODE_HEIGHT / 2;
    case 'human':
      return 14;
    case 'router':
      return 0;
    default:
      return 6;
  }
}

/**
 * Every dash and offset in the stylesheet, as a share of the outline rather than pixels.
 *
 * SVG's `pathLength` tells the browser to treat this path as being this long and to scale
 * every dash length and dash offset to it. Setting it to 100 makes the glint's numbers
 * percentages of the perimeter, which is the only reason one CSS rule can animate a
 * 168×54 box with 6-pixel corners, a pill and a diamond alike: their real perimeters are
 * 430, 402 and 353 user units, and a dash written in pixels would be a different fraction
 * of each, so the glint would be a different length and speed on every kind of node.
 *
 * It is also what keeps the glint honest under zoom. The value scales with the path, and
 * the path is in the same user space as the node, so magnifying the canvas magnifies the
 * glint with the border it is tracing and nothing is re-measured.
 */
export const GLINT_PATH_LENGTH = 100;

/**
 * How much of the outline the glint covers, as a share of it.
 *
 * `15.04` is not a new choice. Niclas approved the movement as it was, and the glint it
 * replaced was four dashes staggered by 0.1 s on a 2.6 s lap — 3.846 units of the outline
 * per step — so its head began at 0 and its last tail ended at 3 × 3.846 + 3.5 = 15.04.
 * Keeping the number means the light is redistributed and the object is the same size.
 */
export const GLINT_TOTAL_LENGTH = 15.04;

/**
 * The fade *ahead* of the brightest point: "nearly sharp, but without a hard cut."
 *
 * 1.2 units of a ~430-unit perimeter is about four or five screen pixels at the zoom the
 * editor opens at. Short enough to read as an edge, long enough that it is not the stair
 * step a butt-ended dash would leave.
 */
export const GLINT_LEADING_FADE = 1.2;

/** How steeply the tail gives up its light. Above 1 concentrates it near the head. */
const GLINT_TAIL_FALLOFF = 1.6;

/** Steps in the tail, and in the leading fade. See {@link glintSegments}. */
const GLINT_TAIL_STEPS = 20;
const GLINT_LEADING_STEPS = 3;

/** The brightest colour, at the leading edge, and the faintest, at the end of the tail. */
const GLINT_HEAD_COLOUR = [0xe8, 0xfb, 0xf1] as const;
const GLINT_TAIL_COLOUR = [0x7f, 0xc4, 0xa0] as const;

/** Stroke width at the leading edge and at the end of the tail. */
const GLINT_HEAD_WIDTH = 3;
const GLINT_TAIL_WIDTH = 1.8;

export interface GlintSegment {
  /** Distance back from the leading edge where this piece begins and ends, in units. */
  readonly from: number;
  readonly to: number;
  /** `stroke-dasharray`, summing to `GLINT_PATH_LENGTH` so the pattern repeats once a lap. */
  readonly dashArray: string;
  readonly width: number;
  readonly alpha: number;
  readonly colour: string;
}

function mixChannel(head: number, tail: number, towardsTail: number): number {
  return Math.round(head + (tail - head) * towardsTail);
}

function glintColour(towardsTail: number): string {
  const [r, g, b] = [0, 1, 2].map((channel) =>
    mixChannel(GLINT_HEAD_COLOUR[channel] ?? 0, GLINT_TAIL_COLOUR[channel] ?? 0, towardsTail),
  );
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

/**
 * The glint as one continuous gradient, expressed as pieces of one outline.
 *
 * **What was wrong with four dashes.** Niclas tried the build and read them as what they
 * are: separate bright marks of differing intensity chasing each other. The motion was
 * right; the light was lumpy. What he asked for is one glint whose tail fades continuously
 * up to a bright leading edge, with only a very short fade at that edge, and with the
 * gradient following the direction of travel the whole way round including the corners.
 *
 * **Why this is pieces at all.** SVG cannot put a gradient along a path: `linearGradient`
 * is a gradient in space, and a stroke has one paint for its whole length. So a ramp along
 * a path has to be built from pieces, and the only question worth arguing about is whether
 * the pieces can be seen. Three things here make them not:
 *
 * 1. **They touch.** Each piece begins exactly where the last ended (`to` of one is `from`
 *    of the next) and the caps are butt, so there is no gap to darken and no round cap to
 *    overlap and brighten. The seam is a change of paint, not a join.
 * 2. **The tail is cut into equal steps of *brightness*, not of length.** A tail cut into
 *    equal lengths bands worst where the ramp is steepest — right behind the leading edge,
 *    which is where the eye is. Solving for equal alpha instead puts short pieces where
 *    the light changes fast and long ones out in the faint tail, so no seam anywhere is a
 *    bigger jump than 1/20 of the range.
 * 3. **Nothing can drift.** Every piece carries the same animation with no delay; the
 *    position is in the dash pattern, not in the phase. The four dashes were held apart by
 *    `animation-delay`, which is a timing relationship between four independent animations.
 *
 * **The shape of the light.** Measuring back from the leading edge: 0 to
 * `GLINT_LEADING_FADE` rises from nothing to full, which is the short fade at the front;
 * from there to `GLINT_TOTAL_LENGTH` it falls away as `(1 - u) ** GLINT_TAIL_FALLOFF`. So
 * the brightest point sits just behind the front edge and the tail is long and soft.
 *
 * **Why the direction of travel is free.** The pieces are positioned along the path, so
 * "behind" means behind *along the outline* — round an arc as readily as down a straight
 * side. Nothing here knows or cares where the corners are.
 *
 * Width and colour are tapered across the same pieces, between the two values the file
 * already used. That is not decoration: two quantisations that do not line up hide each
 * other's steps, and the near-white head over the green tail is the look Niclas approved.
 */
export function glintSegments(): readonly GlintSegment[] {
  const segments: GlintSegment[] = [];
  const tailSpan = GLINT_TOTAL_LENGTH - GLINT_LEADING_FADE;

  // The leading fade, front first: equal lengths, because it is only a few pixels long
  // and its whole job is to stop the front being a cut.
  for (let step = 0; step < GLINT_LEADING_STEPS; step += 1) {
    const from = (GLINT_LEADING_FADE * step) / GLINT_LEADING_STEPS;
    const to = (GLINT_LEADING_FADE * (step + 1)) / GLINT_LEADING_STEPS;
    // The midpoint of the piece, so the first piece is not fully transparent and the last
    // is not yet at full brightness: a ramp of steps rather than a ramp with a step at
    // each end.
    segments.push(glintPiece(from, to, (step + 0.5) / GLINT_LEADING_STEPS, 0));
  }

  // The tail, cut at equal steps of brightness. `alphaAt` inverted: u where the falloff
  // curve has fallen to `1 - k / steps`.
  const distanceAtAlpha = (alpha: number): number =>
    GLINT_LEADING_FADE + tailSpan * (1 - alpha ** (1 / GLINT_TAIL_FALLOFF));
  for (let step = 0; step < GLINT_TAIL_STEPS; step += 1) {
    const from = distanceAtAlpha(1 - step / GLINT_TAIL_STEPS);
    const to = distanceAtAlpha(1 - (step + 1) / GLINT_TAIL_STEPS);
    const alpha = 1 - (step + 0.5) / GLINT_TAIL_STEPS;
    // The piece's middle, matching the alpha above, which is also the piece's middle.
    // Taking its near end instead left the last piece of the tail a fifth short of the
    // faintest colour and the narrowest width, and it is the end of the tail.
    segments.push(
      glintPiece(from, to, alpha, ((from + to) / 2 - GLINT_LEADING_FADE) / tailSpan),
    );
  }
  return segments;
}

function glintPiece(
  from: number,
  to: number,
  alpha: number,
  towardsTail: number,
): GlintSegment {
  /*
   * A dash placed by the pattern rather than by the phase.
   *
   * `0 gap dash rest` — a zero-length dash draws nothing with butt caps, so the pattern
   * amounts to "skip `gap`, then draw `dash`". Every piece therefore shares one animation
   * with no delay, and `stroke-dashoffset` moves the whole gradient as one object.
   *
   * `gap` is measured from the *back* of the glint because the pattern runs forwards along
   * the path: the further along the outline a piece sits, the nearer the front it is.
   */
  const gap = GLINT_TOTAL_LENGTH - to;
  const dash = to - from;
  const rest = GLINT_PATH_LENGTH - gap - dash;
  return {
    from,
    to,
    dashArray: `0 ${gap.toFixed(3)} ${dash.toFixed(3)} ${rest.toFixed(3)}`,
    width: GLINT_HEAD_WIDTH + (GLINT_TAIL_WIDTH - GLINT_HEAD_WIDTH) * towardsTail,
    alpha,
    colour: glintColour(towardsTail),
  };
}

/**
 * The node's own border, as one closed path, for anything that has to travel it.
 *
 * DSP-80 needs the outline twice — once for the pulse's halo and once for the glint
 * chasing round it — and neither can be a stroke on the `<rect>`, because a dash pattern
 * on the body would also be the body's border. So the shape is stated once here and drawn
 * as extra paths *at the same coordinates*: within the node's own local space, starting at
 * 0,0 and ending at `NODE_WIDTH`,`NODE_HEIGHT`.
 *
 * That last sentence is the constraint the card warns about. The usual way to draw a
 * travelling highlight is to inflate it a few pixels outside the box so it is clearly
 * *around* the node, and that changes the node's size the moment it appears: connections
 * attach to `nodeBox`, dragging hit-tests against `NODE_WIDTH`/`NODE_HEIGHT`, and a
 * rendered shape wider than both would have the node appear to grow when it started
 * working and shrink when it stopped. Nothing here is offset. The glow that does read as
 * outside the border is the body's own fill covering the inner half of a wide stroke,
 * which costs no geometry at all.
 */
export function nodeOutlinePath(kind: NodeKind): string {
  const w = NODE_WIDTH;
  const h = NODE_HEIGHT;
  if (kind === 'router') {
    // The same four points as the `<polygon>`: top, right, bottom, left.
    return `M ${String(w / 2)} 0 L ${String(w)} ${String(h / 2)} L ${String(w / 2)} ${String(h)} L 0 ${String(h / 2)} Z`;
  }
  const r = Math.min(nodeCornerRadius(kind), w / 2, h / 2);
  return (
    `M ${String(r)} 0 H ${String(w - r)} A ${String(r)} ${String(r)} 0 0 1 ${String(w)} ${String(r)} ` +
    `V ${String(h - r)} A ${String(r)} ${String(r)} 0 0 1 ${String(w - r)} ${String(h)} ` +
    `H ${String(r)} A ${String(r)} ${String(r)} 0 0 1 0 ${String(h - r)} ` +
    `V ${String(r)} A ${String(r)} ${String(r)} 0 0 1 ${String(r)} 0 Z`
  );
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
