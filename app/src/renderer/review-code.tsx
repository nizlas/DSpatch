import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';

import {
  buildDiffRows,
  highlightLines,
  type CodeLocation,
  type CodeReference,
  type DiffFile,
  type DiffRow,
  type ReviewBridge,
  type ReviewFileOutcome,
  type RevisionSide,
  type Token,
} from '../shared/review-model';

/**
 * Code reading shared by the review surface's panes: files read from git at a
 * revision, a file's rows (its real diff, or the file itself), and highlighted text.
 */

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
  const [, setTick] = useState(0);
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
  return useMemo(() => ({ get, load }), [get, load]);
}

/** The side of a diff that does not exist (an added or a deleted file). */
export const NO_LINES: ReviewFileOutcome = { kind: 'text', lines: [] };

/** A file's rows: the real diff when it changed, otherwise the file at one side. */
export function useRows(
  files: Files,
  path: string,
  diffFile: DiffFile | null,
  plainSide: RevisionSide,
): { rows: DiffRow[]; error: string | null; tokens: { base: Token[][]; target: Token[][] } } | null {
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
  }, [base, target, inDiff, diffFile, plainSide, path]);
}

export function TokensView({ tokens }: { readonly tokens: readonly Token[] | undefined }): JSX.Element {
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
}

