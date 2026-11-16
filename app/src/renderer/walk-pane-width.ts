/*
 * How wide a code pane of a walk is (DSP-216, Niclas, 16 November 2026).
 *
 * A code pane is as wide as the longest line of what it shows by default — its places at the
 * chosen level, in the chosen Before/Both/After — capped at Max width characters, plus its line
 * numbers, diff markers, margins and scrollbar, and never narrower than the map's minimum. Rows
 * folded away do not count, and neither do rows opened by hand later, so a pane does not change
 * width while it is read. A longer line scrolls sideways. Panes take the room they need in the
 * map; the map is panned, so they are not squeezed to fit the window.
 *
 * The limit is the person's, per computer: kept in the windows' own storage, like the
 * presentation profile, so every review window uses the same one. Empty means no limit.
 */
import { useCallback, useEffect, useState } from 'react';

/** Before, Both or After: what a diff pane draws. */
export type CodeView = 'before' | 'both' | 'after';

export const DEFAULT_MAX_CHARS = 120;
/** The largest limit the field takes; anything wider is as good as none. */
export const MAX_CHARS_LIMIT = 9999;
const STORAGE_KEY = 'dspatch.review.paneMaxChars';

/** A line's width in columns as `white-space: pre` draws it, tabs every eight. */
export function textColumns(text: string): number {
  if (!text.includes('\t')) {
    return text.length;
  }
  let column = 0;
  for (const character of text) {
    column = character === '\t' ? column + 8 - (column % 8) : column + 1;
  }
  return column;
}

interface ShownRow {
  readonly kind: string;
  readonly text: string;
}

/**
 * The longest line, in columns, of the rows a pane shows by default: those inside `ranges`
 * (inclusive row indexes) that the view draws. Before leaves out added rows, After removed ones.
 */
export function shownColumns(rows: readonly ShownRow[], ranges: readonly (readonly [number, number])[], view: CodeView): number {
  let columns = 0;
  const seen = new Set<number>();
  for (const [from, to] of ranges) {
    for (let index = Math.max(0, from); index <= to && index < rows.length; index += 1) {
      if (seen.has(index)) {
        continue;
      }
      seen.add(index);
      const row = rows[index] as ShownRow;
      if ((view === 'before' && row.kind === 'added') || (view === 'after' && row.kind === 'deleted')) {
        continue;
      }
      columns = Math.max(columns, textColumns(row.text));
    }
  }
  return columns;
}

/** The columns of code a pane makes room for: its longest shown line, at most the limit. */
export function codeColumns(columns: number, maxChars: number | null): number {
  return maxChars === null ? columns : Math.min(columns, maxChars);
}

export interface CodeMetrics {
  /** One column of the code font, in pixels. */
  readonly ch: number;
  /** The root font size, in pixels. */
  readonly rem: number;
  /** A vertical scrollbar's width, in pixels; 0 where scrollbars overlay the content. */
  readonly scrollbar: number;
}

/**
 * A pane's width in pixels for that many columns of code, so that exactly that many show: the
 * code, its row's gutter (two line-number columns of `digits` each, their padding and gap, and
 * the diff marker), the text's own right padding, the pane's border and its vertical scrollbar;
 * at least `minimum`. The rem parts are review.css's: `.rv-ln` 0.7rem padding and a 0.5rem gap,
 * `.rv-marker` 1.2rem, `.rv-text` 1rem on the right.
 */
export function paneWidthFor(columns: number, digits: number, metrics: CodeMetrics, minimum: number): number {
  return Math.max(minimum, Math.ceil((columns + 2 * digits) * metrics.ch + ROW_CHROME_REM * metrics.rem + metrics.scrollbar + PANE_BORDER));
}

/** The fixed part of a row beside its text's columns, in rem (see paneWidthFor). */
export const ROW_CHROME_REM = 0.7 + 0.5 + 1.2 + 1;
/** The pane's border, both sides, and a pixel of rounding. */
export const PANE_BORDER = 3;

/** The field's text as a limit: a whole number from 1, null for empty (no limit), undefined when it is neither. */
export function parseMaxChars(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_CHARS_LIMIT ? value : undefined;
}

/** What storage holds: the limit as text, `none` for no limit; anything else is the default. */
export function storedMaxChars(value: string | null): number | null {
  if (value === 'none') {
    return null;
  }
  const parsed = value === null ? undefined : parseMaxChars(value);
  return parsed === undefined || parsed === null ? DEFAULT_MAX_CHARS : parsed;
}

function read(): number | null {
  try {
    return storedMaxChars(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_MAX_CHARS;
  }
}

/** The computer's Max width, shared by the review windows through storage. */
export function usePaneMaxChars(): readonly [number | null, (value: number | null) => void] {
  const [maxChars, setState] = useState<number | null>(read);
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) {
        setState(read());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const choose = useCallback((value: number | null) => {
    setState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value === null ? 'none' : String(value));
    } catch {
      // Not kept past this window; the choice still holds here.
    }
  }, []);
  return [maxChars, choose] as const;
}
