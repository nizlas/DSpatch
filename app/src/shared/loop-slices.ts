/**
 * DSP-209 S10a: the slice block a fan-out's branches are made from.
 *
 * A step named in a fan-out's `slicesFrom` writes, in its result, exactly one fenced block
 * whose info string is `dspatch-slices` and whose body is JSON. This module finds that block
 * and checks it against GRAPH_FORMAT.md's *Fan-out* section. Pure: no file system, no git.
 * Every problem is named, so a step whose slices are refused can be told exactly why.
 *
 * **Write ownership.** A slice's `ownedPaths` are repository-relative paths or directory
 * prefixes. Two slices overlap when one's path equals the other's or contains it as a
 * directory — `app/src` overlaps `app/src/a.ts`, while `app/src` does not overlap
 * `app/srcx` — compared without regard to case, because the repositories this runs in
 * include case-insensitive file systems and a rule that let `A.ts` and `a.ts` be owned
 * twice would let two branches write one file. Patterns are not paths: `*`, `?` and `[`
 * are refused rather than interpreted.
 */

import type { FanOutIsolation } from './loop-graph';

/** The most slices one fan-out takes (mission decision 24). More wait their turn only up to this. */
export const MAX_SLICES = 6;

/** The info string of the fenced block. */
export const SLICE_BLOCK_INFO = 'dspatch-slices';

export interface Slice {
  readonly id: string;
  readonly result: string;
  /** Normalised: forward slashes, no leading `./`, no trailing `/`. */
  readonly ownedPaths: readonly string[];
  readonly allowedActions: readonly string[];
  readonly contractRefs: readonly string[];
  readonly verification: string;
}

export interface SliceProblem {
  readonly code:
    | 'no-slice-block'
    | 'several-slice-blocks'
    | 'bad-slice-json'
    | 'no-slices'
    | 'too-many-slices'
    | 'bad-slice'
    | 'duplicate-slice-id'
    | 'unsafe-slice-id'
    | 'unsafe-owned-path'
    | 'overlapping-ownership'
    | 'no-owned-paths';
  readonly message: string;
  /** The slice it is about, where it is about one. */
  readonly sliceId?: string;
}

export type SliceReading =
  | { readonly ok: true; readonly slices: readonly Slice[] }
  | { readonly ok: false; readonly problems: readonly SliceProblem[] };

/**
 * Read and check the slice block in a step's result.
 *
 * `isolation` matters for one rule: under `worktree` a slice must own at least one path,
 * because a writing branch with nothing it may write has no work to do.
 */
export function readSlices(resultText: string, options: { readonly isolation: FanOutIsolation }): SliceReading {
  const blocks = fencedBlocks(resultText).filter((block) => block.info === SLICE_BLOCK_INFO);
  if (blocks.length === 0) {
    return refused({ code: 'no-slice-block', message: `There is no fenced \`${SLICE_BLOCK_INFO}\` block in the result.` });
  }
  if (blocks.length > 1) {
    return refused({
      code: 'several-slice-blocks',
      message: `There are ${String(blocks.length)} \`${SLICE_BLOCK_INFO}\` blocks in the result; exactly one is read, so none is.`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(blocks[0]?.body ?? '');
  } catch (error) {
    return refused({
      code: 'bad-slice-json',
      message: `The \`${SLICE_BLOCK_INFO}\` block is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const list = isRecord(parsed) ? parsed['slices'] : undefined;
  if (!Array.isArray(list)) {
    return refused({ code: 'bad-slice-json', message: 'The block must be a JSON object with a "slices" list.' });
  }
  if (list.length === 0) {
    return refused({ code: 'no-slices', message: 'The block lists no slices.' });
  }
  if (list.length > MAX_SLICES) {
    return refused({
      code: 'too-many-slices',
      message: `The block lists ${String(list.length)} slices; a fan-out takes at most ${String(MAX_SLICES)}.`,
    });
  }

  const problems: SliceProblem[] = [];
  const slices: Slice[] = [];
  list.forEach((entry, index) => {
    const slice = readSlice(entry, index, options.isolation, problems);
    if (slice !== null) {
      slices.push(slice);
    }
  });

  const seen = new Set<string>();
  for (const slice of slices) {
    if (seen.has(slice.id.toLowerCase())) {
      problems.push({ code: 'duplicate-slice-id', message: `Two slices are called "${slice.id}".`, sliceId: slice.id });
    }
    seen.add(slice.id.toLowerCase());
  }

  for (let i = 0; i < slices.length; i += 1) {
    for (let j = i + 1; j < slices.length; j += 1) {
      const left = slices[i];
      const right = slices[j];
      if (left === undefined || right === undefined) {
        continue;
      }
      for (const a of left.ownedPaths) {
        for (const b of right.ownedPaths) {
          if (pathsOverlap(a, b)) {
            problems.push({
              code: 'overlapping-ownership',
              message:
                `Slices "${left.id}" and "${right.id}" would both write "${a === b ? a : `${a}" and "${b}`}": ` +
                'one path is the other or lies inside it. Each path may be owned by one slice only.',
              sliceId: right.id,
            });
          }
        }
      }
    }
  }

  return problems.length === 0 ? { ok: true, slices } : { ok: false, problems };
}

/** Whether two normalised owned paths overlap: equal, or one a directory containing the other. */
export function pathsOverlap(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left === right || right.startsWith(`${left}/`) || left.startsWith(`${right}/`);
}

/**
 * An owned path in its one written form, or `null` when it is not a safe repository-relative
 * path: empty, absolute (a leading slash, a drive letter, a UNC prefix), with a `..` or `.`
 * segment, or with a pattern character.
 */
export function normaliseOwnedPath(value: string): string | null {
  let path = value.trim().split('\\').join('/');
  while (path.startsWith('./')) {
    path = path.slice(2);
  }
  while (path.endsWith('/') && path.length > 1) {
    path = path.slice(0, -1);
  }
  if (path === '' || path.startsWith('/') || /^[A-Za-z]:/.test(path) || /[*?[\u0000]/.test(path)) {
    return null;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  // DSP-209 S10b (S10a review finding iii): git's own folder is never a slice's to write.
  if ((segments[0] ?? '').toLowerCase() === '.git') {
    return null;
  }
  return path;
}

/** A slice id that can name a git branch and a folder: letters, digits, `.`, `_`, `-`. */
export function isSafeSliceId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && !id.includes('..') && !id.endsWith('.lock') && !id.endsWith('.');
}

function readSlice(entry: unknown, index: number, isolation: FanOutIsolation, problems: SliceProblem[]): Slice | null {
  const where = `Slice ${String(index + 1)}`;
  if (!isRecord(entry)) {
    problems.push({ code: 'bad-slice', message: `${where} is not an object.` });
    return null;
  }
  const id = entry['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    problems.push({ code: 'bad-slice', message: `${where} has no "id".` });
    return null;
  }
  if (!isSafeSliceId(id)) {
    problems.push({
      code: 'unsafe-slice-id',
      message: `${where}'s id "${id}" cannot name a branch: use letters, digits, ".", "_" and "-", starting with a letter or digit.`,
      sliceId: id,
    });
    return null;
  }
  const missing: string[] = [];
  const result = nonEmpty(entry['result']);
  if (result === null) missing.push('"result"');
  const verification = nonEmpty(entry['verification']);
  if (verification === null) missing.push('"verification"');
  const ownedPaths = stringList(entry['ownedPaths']);
  if (ownedPaths === null) missing.push('"ownedPaths" (a list of strings)');
  const allowedActions = stringList(entry['allowedActions']);
  if (allowedActions === null) missing.push('"allowedActions" (a list of strings)');
  const contractRefs = stringList(entry['contractRefs']);
  if (contractRefs === null) missing.push('"contractRefs" (a list of strings)');
  if (missing.length > 0 || result === null || verification === null || ownedPaths === null || allowedActions === null || contractRefs === null) {
    problems.push({ code: 'bad-slice', message: `Slice "${id}" is missing ${missing.join(', ')}.`, sliceId: id });
    return null;
  }
  const normalised: string[] = [];
  for (const path of ownedPaths) {
    const safe = normaliseOwnedPath(path);
    if (safe === null) {
      problems.push({
        code: 'unsafe-owned-path',
        message:
          `Slice "${id}" owns "${path}", which is not a path inside the repository: owned paths are ` +
          'relative, without "..", and are paths rather than patterns.',
        sliceId: id,
      });
      continue;
    }
    if (!normalised.includes(safe)) {
      normalised.push(safe);
    }
  }
  if (isolation === 'worktree' && ownedPaths.length === 0) {
    problems.push({
      code: 'no-owned-paths',
      message: `Slice "${id}" owns no paths, and a branch in its own worktree that may write nothing has no work to do.`,
      sliceId: id,
    });
  }
  return { id, result, ownedPaths: normalised, allowedActions, contractRefs, verification };
}

/** Fenced code blocks, by their info string's first word: ``` or ~~~, closed by the same fence or longer. */
function fencedBlocks(text: string): readonly { readonly info: string; readonly body: string }[] {
  const blocks: { info: string; body: string }[] = [];
  const lines = text.split(/\r?\n/);
  let open: { fence: string; info: string; body: string[] } | null = null;
  for (const line of lines) {
    if (open === null) {
      const start = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (start !== null) {
        open = { fence: start[1] ?? '```', info: (start[2] ?? '').trim().split(/\s+/)[0] ?? '', body: [] };
      }
      continue;
    }
    const fence = open.fence;
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${String(fence.length)},}\\s*$`);
    if (close.test(line)) {
      blocks.push({ info: open.info, body: open.body.join('\n') });
      open = null;
    } else {
      open.body.push(line);
    }
  }
  return blocks;
}

function refused(problem: SliceProblem): SliceReading {
  return { ok: false, problems: [problem] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null;
}
