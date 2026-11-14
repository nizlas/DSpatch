/**
 * An edge's label as the canvas shows it: its words, its lines and how much room it takes.
 *
 * Niclas, 14 November 2026: the layout reserves room for every label from the start, whether
 * Edge labels is on or a selection shows only some of them, so a label shown on selection is
 * whole, clear of nodes and other labels, and nothing moves when it appears. The layout, the
 * router and the canvas therefore measure a label the same way, here.
 *
 * The layout also runs where there is no window (a graph proposal is laid out in the project
 * host), so a label is measured from a table of character widths for the canvas font, Segoe UI
 * at `.edge-label`'s 10 px, rounded up and with a small margin, rather than from the DOM. A
 * label wider than {@link LABEL_WRAP_WIDTH} is broken between words.
 */

import type { EdgeCondition } from './loop-graph';

/** `.edge-label`'s font size, and the distance between two of its lines. */
export const LABEL_FONT_SIZE = 10;
export const LABEL_LINE_HEIGHT = 12;
/** A line longer than this is broken between words; a single longer word keeps its line. */
export const LABEL_WRAP_WIDTH = 100;
/** Room on each side of the text, inside the label's box. */
const LABEL_PADDING = 3;

/**
 * Advance widths in em for Segoe UI, rounded up. Characters not listed take {@link WIDE}, the
 * width of the wider capitals, so an unusual character makes a label too wide, never too narrow.
 */
const WIDTHS: Readonly<Record<string, number>> = {
  ' ': 0.28, a: 0.53, b: 0.59, c: 0.47, d: 0.59, e: 0.54, f: 0.32, g: 0.59, h: 0.57, i: 0.25,
  j: 0.25, k: 0.5, l: 0.25, m: 0.87, n: 0.57, o: 0.59, p: 0.59, q: 0.59, r: 0.36, s: 0.44,
  t: 0.34, u: 0.57, v: 0.49, w: 0.74, x: 0.48, y: 0.49, z: 0.45, å: 0.53, ä: 0.53, ö: 0.59,
  é: 0.54, ü: 0.57, A: 0.64, B: 0.6, C: 0.64, D: 0.72, E: 0.53, F: 0.5, G: 0.71, H: 0.74,
  I: 0.27, J: 0.37, K: 0.6, L: 0.49, M: 0.92, N: 0.76, O: 0.77, P: 0.58, Q: 0.77, R: 0.62,
  S: 0.55, T: 0.56, U: 0.71, V: 0.63, W: 0.95, X: 0.61, Y: 0.57, Z: 0.58, Å: 0.64, Ä: 0.64,
  Ö: 0.77, '0': 0.55, '1': 0.55, '2': 0.55, '3': 0.55, '4': 0.55, '5': 0.55, '6': 0.55,
  '7': 0.55, '8': 0.55, '9': 0.55, '.': 0.25, ',': 0.25, ':': 0.25, ';': 0.25, '-': 0.4,
  '–': 0.5, '—': 1, '(': 0.31, ')': 0.31, '/': 0.4, "'": 0.22, '"': 0.37, '?': 0.43, '!': 0.27,
  _: 0.43, '<': 0.65, '>': 0.65, '=': 0.65, '+': 0.65, '&': 0.78, '%': 0.83,
};
const WIDE = 0.8;
/** Rendering differs a little between machines; a label measured slightly wide is harmless. */
const SAFETY = 1.06;

/** The words an edge is labelled with on the canvas. */
export function edgeLabelText(edge: { readonly label?: string; readonly when: EdgeCondition }): string {
  return (
    edge.label ??
    (edge.when.on === 'outcome' ? edge.when.outcome : edge.when.on === 'declared-failure' ? edge.when.failure : 'success')
  );
}

/** How wide a line of label text is drawn, in canvas units. */
export function labelTextWidth(text: string): number {
  let ems = 0;
  for (const character of text) {
    ems += WIDTHS[character] ?? WIDE;
  }
  return Math.ceil(ems * LABEL_FONT_SIZE * SAFETY);
}

/** The label's lines: broken between words so no line is wider than {@link LABEL_WRAP_WIDTH}. */
export function wrapLabel(text: string): readonly string[] {
  const words = text.trim().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) {
    return [''];
  }
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && labelTextWidth(next) > LABEL_WRAP_WIDTH) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}

export interface LabelSize {
  readonly lines: readonly string[];
  /** The label's box, padding included. */
  readonly width: number;
  readonly height: number;
}

export function measureLabel(text: string): LabelSize {
  const lines = wrapLabel(text);
  return {
    lines,
    width: Math.max(...lines.map(labelTextWidth)) + 2 * LABEL_PADDING,
    height: lines.length * LABEL_LINE_HEIGHT,
  };
}
