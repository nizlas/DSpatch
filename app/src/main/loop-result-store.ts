/**
 * Where a live run's results are actually kept.
 *
 * The one implementation of {@link ResultStore} that touches a disk, which is why it
 * lives here and not beside the runner: `loop-run.ts` imports no Node and reaches no
 * filesystem, so a dry run cannot file anything by accident rather than by promise.
 *
 * **Results are DSpatch's to place, not the definition's.** A graph's `archive.path` is
 * resolved under a run-scoped directory DSpatch owns, and never under the definition's
 * `resourceRoot` and never by default into a working root. A standalone definition —
 * say, one describing a development loop — whose reports landed in the repository it
 * was reading would be exactly the collapse the resource-root work exists to undo,
 * arriving through the back door. So the base is handed in by whoever starts the run,
 * a path that leaves it is refused, and the refusal says so.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { bodyBytes, type ResultStore, type ResultWrite, type StoredBody } from '../shared/loop-results';

export function sha256Of(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * Resolve a declared archive path under the base, or say why it cannot be.
 *
 * Absolute paths and anything climbing out with `..` are refused rather than
 * normalised: a graph that asks to write into `C:\Windows` or three levels above the
 * run has asked for something a run-scoped store is not, and quietly relocating it
 * would leave the author believing the file went where they wrote.
 */
export function resolveResultPath(
  base: string,
  declared: string,
): { readonly ok: true; readonly full: string } | { readonly ok: false; readonly why: string } {
  const trimmed = declared.trim();
  if (trimmed === '') {
    return { ok: false, why: 'The archive path is empty, so there is nowhere to put anything.' };
  }
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed)) {
    return {
      ok: false,
      why:
        `"${trimmed}" is an absolute path. A run's results are kept under the folder DSpatch ` +
        `gave this run (${base}), so that a definition cannot write its reports into whatever ` +
        `project it happens to be reading. Use a relative path.`,
    };
  }
  const resolvedBase = path.resolve(base);
  const full = path.resolve(resolvedBase, trimmed);
  const inside =
    full === resolvedBase || full.startsWith(`${resolvedBase}${path.sep}`);
  if (!inside) {
    return {
      ok: false,
      why:
        `"${trimmed}" leads out of this run's results folder (${resolvedBase}). A run's ` +
        `results stay where DSpatch put them.`,
    };
  }
  return { ok: true, full };
}

/**
 * A result store writing files under one run-scoped directory.
 *
 * `put` writes the body it is given and nothing else: no header, no front matter, no
 * summary of it. That is what makes the file and the run record's copy the same body
 * rather than two renderings of one — and it is why `get` returns the bytes rather than
 * anything derived from them.
 */
export function createFileResultStore(baseDir: string): ResultStore {
  const base = path.resolve(baseDir);
  return {
    put(declared: string, body: string): ResultWrite {
      const resolved = resolveResultPath(base, declared);
      if (!resolved.ok) {
        return { ok: false, why: resolved.why };
      }
      try {
        fs.mkdirSync(path.dirname(resolved.full), { recursive: true });
        fs.writeFileSync(resolved.full, body, 'utf8');
      } catch (error) {
        return {
          ok: false,
          why: `DSpatch could not write ${resolved.full}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      return { ok: true, digest: sha256Of(body), bytes: bodyBytes(body) };
    },
    get(declared: string): StoredBody | null {
      const resolved = resolveResultPath(base, declared);
      if (!resolved.ok) {
        return null;
      }
      let body: string;
      try {
        body = fs.readFileSync(resolved.full, 'utf8');
      } catch {
        // Absent, unreadable or a directory. All three mean the same thing to the
        // runner — there is no result here — and the runner's own message is the one
        // written for whoever has to reconcile it.
        return null;
      }
      return { body, digest: sha256Of(body), bytes: bodyBytes(body) };
    },
    locate(declared: string): string {
      const resolved = resolveResultPath(base, declared);
      return resolved.ok ? resolved.full : path.join(base, declared);
    },
    digest: sha256Of,
  };
}
