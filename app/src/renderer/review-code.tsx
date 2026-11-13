import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';

import {
  buildDiffRows,
  referenceRows,
  type CodeLocation,
  type CodeReference,
  type DiffFile,
  type DiffRow,
  type ReviewBridge,
  type ReviewFileOutcome,
  type RevisionSide,
} from '../shared/review-model';
import { highlightLines, type Token } from './syntax';

/**
 * Code reading shared by the review surface's panes: files read from git at a
 * revision, a file's rows (its real diff, or the file itself), and highlighted text.
 */

/**
 * A code row's gutter in the walk window: the line's numbers in both revisions and a
 * narrow mark, − for a removed line, + for an added one, ↳ for where a place is reached
 * from. The mark's word is its tooltip and what a screen reader says. The numbers take the
 * width the pane's largest line number needs (`--rv-digits` on the rows).
 */
export function LineGutter({
  base,
  target,
  mark,
  strong,
  title,
  onSelect,
}: {
  readonly base: number | null;
  readonly target: number | null;
  readonly mark: { readonly sign: string; readonly word: string } | null;
  readonly strong: boolean;
  readonly title: string;
  readonly onSelect: (shift: boolean) => void;
}): JSX.Element {
  return (
    <span className="rv-gutter">
      <button type="button" className="rv-ln" title={title} onClick={(event) => onSelect(event.shiftKey)}>
        <span>{base ?? ''}</span>
        <span>{target ?? ''}</span>
      </button>
      <span className={strong ? 'rv-marker rv-marker-strong' : 'rv-marker'} title={mark?.word}>
        {mark !== null && (
          <>
            <span aria-hidden="true">{mark.sign}</span>
            <span className="rv-sr">{mark.word}</span>
          </>
        )}
      </span>
    </span>
  );
}

/** How many digits the largest line number of these rows has, for the gutter's width. */
export function lineDigits(rows: readonly { readonly baseLine: number | null; readonly targetLine: number | null }[]): number {
  let largest = 1;
  for (const row of rows) {
    largest = Math.max(largest, row.baseLine ?? 0, row.targetLine ?? 0);
  }
  return String(largest).length;
}

export function rangeText(location: { start: number; end: number }): string {
  return location.start === location.end ? String(location.start) : `${String(location.start)}–${String(location.end)}`;
}

export function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function asLocation(ref: CodeReference): CodeLocation {
  return { path: ref.path, side: ref.side, start: ref.start, end: ref.end };
}

/** A one-line prepared text: `code names` in backticks are shown as code, nothing else is parsed. */
export function Inline({ text }: { readonly text: string }): JSX.Element {
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}
    </>
  );
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// --- File contents --------------------------------------------------------------

export type Files = {
  get: (side: RevisionSide, path: string) => ReviewFileOutcome | null;
  load: (side: RevisionSide, path: string) => void;
};

export function useFiles(bridge: ReviewBridge | undefined): Files {
  const cache = useRef(new Map<string, ReviewFileOutcome>());
  const pending = useRef(new Set<string>());
  const [tick, setTick] = useState(0);
  const load = useCallback(
    (side: RevisionSide, path: string) => {
      const key = `${side}:${path}`;
      if (bridge === undefined || cache.current.has(key) || pending.current.has(key)) {
        return;
      }
      pending.current.add(key);
      void bridge.readFile(side, path).then((outcome) => {
        cache.current.set(key, outcome);
        pending.current.delete(key);
        setTick((value) => value + 1);
      });
    },
    [bridge],
  );
  const get = useCallback((side: RevisionSide, path: string) => cache.current.get(`${side}:${path}`) ?? null, []);
  // A new object when a file arrives, so panes that skip re-rendering notice it.
  return useMemo(() => ({ get, load }), [get, load, tick]);
}

/** The side of a diff that does not exist (an added or a deleted file). */
export const NO_LINES: ReviewFileOutcome = { kind: 'text', lines: [] };

type FileContent = { rows: DiffRow[]; error: string | null; tokens: { base: Token[][]; target: Token[][] } };

// A file's rows and highlighting are computed once per pair of read files, not once
// per pane: the walk shows the same file in many panes, and panes mount and unmount
// as the map is panned.
const contents = new WeakMap<ReviewFileOutcome, WeakMap<ReviewFileOutcome, Map<string, FileContent>>>();

function cachedContent(base: ReviewFileOutcome, target: ReviewFileOutcome, key: string, compute: () => FileContent): FileContent {
  let byTarget = contents.get(base);
  if (byTarget === undefined) {
    byTarget = new WeakMap();
    contents.set(base, byTarget);
  }
  let byKey = byTarget.get(target);
  if (byKey === undefined) {
    byKey = new Map();
    byTarget.set(target, byKey);
  }
  let content = byKey.get(key);
  if (content === undefined) {
    content = compute();
    byKey.set(key, content);
  }
  return content;
}

// The rows of a reference, once per file's rows and reference.
const referenceCache = new WeakMap<readonly DiffRow[], Map<string, ReturnType<typeof referenceRows>>>();

/** `referenceRows`, remembered: every pane asks it for its own and its neighbours' places. */
export function rowsOf(rows: readonly DiffRow[], ref: { readonly side: RevisionSide; readonly start: number; readonly end: number }): ReturnType<typeof referenceRows> {
  let byRef = referenceCache.get(rows);
  if (byRef === undefined) {
    byRef = new Map();
    referenceCache.set(rows, byRef);
  }
  const key = `${ref.side}:${String(ref.start)}:${String(ref.end)}`;
  let found = byRef.get(key);
  if (found === undefined) {
    found = referenceRows(rows, ref);
    byRef.set(key, found);
  }
  return found;
}

/** A file's rows: the real diff when it changed, otherwise the file at one side. */
export function useRows(
  files: Files,
  path: string,
  diffFile: DiffFile | null,
  plainSide: RevisionSide,
): FileContent | null {
  const inDiff = diffFile !== null && !diffFile.binary;
  const needBase = inDiff ? diffFile.status !== 'added' : plainSide === 'base';
  const needTarget = inDiff ? diffFile.status !== 'deleted' : plainSide === 'target';
  useEffect(() => {
    if (needBase) {
      files.load('base', path);
    }
    if (needTarget) {
      files.load('target', path);
    }
  }, [files, path, needBase, needTarget]);
  const base = needBase ? files.get('base', path) : NO_LINES;
  const target = needTarget ? files.get('target', path) : NO_LINES;
  return useMemo(() => {
    if (base === null || target === null) {
      return null;
    }
    return cachedContent(base, target, `${path}|${String(inDiff)}|${plainSide}`, () => fileContent(base, target, path, inDiff ? diffFile : null, plainSide));
  }, [base, target, inDiff, diffFile, plainSide, path]);
}

function fileContent(base: ReviewFileOutcome, target: ReviewFileOutcome, path: string, diffFile: DiffFile | null, plainSide: RevisionSide): FileContent {
  const inDiff = diffFile !== null && !diffFile.binary;
  const empty = { base: [], target: [] };
  if (base.kind === 'failed' || target.kind === 'failed') {
    return { rows: [], error: base.kind === 'failed' ? base.error : target.kind === 'failed' ? target.error : '', tokens: empty };
  }
  if (base.kind === 'binary' || target.kind === 'binary' || diffFile?.binary === true) {
    return { rows: [], error: 'binary', tokens: empty };
  }
  const baseLines = base.kind === 'text' ? base.lines : [];
  const targetLines = target.kind === 'text' ? target.lines : [];
  const tokens = { base: highlightLines(baseLines, path), target: highlightLines(targetLines, path) };
  if (inDiff) {
    try {
      return { rows: buildDiffRows(baseLines, targetLines, diffFile.hunks), error: null, tokens };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : String(error), tokens: empty };
    }
  }
  if ((plainSide === 'base' ? base : target).kind === 'missing') {
    return { rows: [], error: 'missing', tokens: empty };
  }
  const lines = plainSide === 'base' ? baseLines : targetLines;
  return {
    rows: lines.map((text, index) => ({
      kind: 'context' as const,
      baseLine: plainSide === 'base' ? index + 1 : null,
      targetLine: plainSide === 'target' ? index + 1 : null,
      text,
      hunkId: null,
    })),
    error: null,
    tokens,
  };
}

// The same highlighted line is drawn again only when its tokens change.
export const TokensView = memo(function TokensView({ tokens }: { readonly tokens: readonly Token[] | undefined }): JSX.Element {
  if (tokens === undefined) {
    return <></>;
  }
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === 'plain' ? (
          token.text
        ) : (
          <span key={index} className={`rv-tk-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
});

