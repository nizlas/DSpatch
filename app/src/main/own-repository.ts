/**
 * Recognising DSpatch's own working copy, from any folder inside it.
 *
 * This finds where DSpatch's own sources are, for what the application reads of itself:
 * its loop definitions and the example review. It refuses nothing. Niclas decided on
 * 31 October 2026 that DSpatch opens and works on its own repository like any other
 * project, under the same rules for reading, changes and the person's mandate, so the
 * refusal that used to live here is gone, with `DSPATCH_ALLOW_OWN_REPO`.
 *
 * What DSP-1 measured still holds and is why that is a decision rather than a detail:
 * an agent is not confined to the folder it is given. A writing run in this repository
 * can edit the DSpatch that is running.
 *
 * `findOwnRepository` walks **up** from a folder, so any folder inside the repository
 * resolves to the repository, and goes all the way to the filesystem root, because a
 * nested repository would otherwise hide everything above it. An ancestor with
 * DSpatch's markers and a manifest that cannot be read is `undecidable`, which
 * `ownRepositoryRoot` reads as DSpatch: the other distinctive files corroborate it.
 */

import fs from 'node:fs';
import path from 'node:path';

/** The manifest whose `name` field identifies this repository. */
const MANIFEST_REL = path.join('app', 'package.json');

/**
 * The file that must be beside the manifest before a directory is examined at
 * all. It keeps the check off the many unrelated projects that have an
 * `app/package.json` and nothing else in common with DSpatch.
 */
const VISION_REL = path.join('docs', 'VISION.md');

/** The name in `app/package.json` that identifies this repository. */
const OWN_PACKAGE_NAME = 'dspatch';

/**
 * Files that corroborate a manifest DSpatch cannot read. Any one of them, with
 * `docs/VISION.md`, is enough for the directory to count as possibly DSpatch's own.
 */
const CORROBORATING_REL: readonly string[] = [
  'AGENTS.md',
  'BACKLOG.md',
  path.join('docs', 'DEVELOPMENT_LOOP.md'),
  path.join('backlog', 'tasks'),
];

/** What DSpatch concluded about a directory, and what it looked at to conclude it. */
export type OwnRepositoryVerdict =
  | {
      /** No ancestor of the chosen folder carries DSpatch's markers. */
      readonly kind: 'unrelated';
    }
  | {
      /** An ancestor is DSpatch's own working copy, by the name in its manifest. */
      readonly kind: 'own-repository';
      /** The directory that carries the markers. Equal to the chosen folder, or above it. */
      readonly root: string;
      readonly manifestPath: string;
      /** Paths, relative to `root`, that were found. */
      readonly markersFound: readonly string[];
    }
  | {
      /**
       * An ancestor carries DSpatch's markers but its manifest could not be read
       * or parsed, so whether this is DSpatch cannot be established.
       */
      readonly kind: 'undecidable';
      readonly root: string;
      readonly manifestPath: string;
      /** Why the manifest could not be used, in the words of the failure. */
      readonly reason: string;
      readonly markersFound: readonly string[];
    };

function exists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    // `existsSync` swallows its own errors, so this is belt and braces. An
    // unanswerable question about a path is not evidence that it is absent, but
    // there is nothing more to ask, and the manifest read below is what decides.
    return false;
  }
}

/** What the directory carries, relative to itself, for the message. */
function markersIn(dir: string): readonly string[] {
  const found: string[] = [];
  for (const rel of [MANIFEST_REL, VISION_REL, ...CORROBORATING_REL]) {
    if (exists(path.join(dir, rel))) {
      found.push(rel);
    }
  }
  return found;
}

/**
 * Examine one directory. No walking: `findOwnRepository` does that.
 *
 * Exported for the tests, which check the three outcomes directly as well as
 * through the walk.
 */
export function inspectDirectory(dir: string): OwnRepositoryVerdict {
  const root = path.resolve(dir);
  const manifestPath = path.join(root, MANIFEST_REL);
  if (!exists(manifestPath) || !exists(path.join(root, VISION_REL))) {
    return { kind: 'unrelated' };
  }

  let text: string;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    return undecidable(root, manifestPath, `it could not be read: ${String(error)}`);
  }

  let parsed: unknown;
  try {
    // A UTF-8 BOM is the case Verifier 010 hit by accident, and stripping it is
    // not leniency: `JSON.parse` is the only thing that objects to it, so a BOM
    // would otherwise make a perfectly ordinary manifest undecidable and refuse
    // an unrelated project. Anything else that will not parse stays undecidable.
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    return undecidable(root, manifestPath, `it is not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undecidable(
      root,
      manifestPath,
      'it parsed as JSON but is not an object, so it has no name field to read',
    );
  }
  const name = (parsed as Record<string, unknown>)['name'];
  if (name === OWN_PACKAGE_NAME) {
    return {
      kind: 'own-repository',
      root,
      manifestPath,
      markersFound: markersIn(root),
    };
  }
  if (typeof name !== 'string' || name.trim() === '') {
    // A manifest that parses but names nothing cannot clear this folder either.
    return undecidable(
      root,
      manifestPath,
      'it parsed as JSON but its name field is missing or empty',
    );
  }
  return { kind: 'unrelated' };
}

/**
 * The manifest could not clear the folder: it counts only if anything else here
 * looks like DSpatch.
 */
function undecidable(
  root: string,
  manifestPath: string,
  reason: string,
): OwnRepositoryVerdict {
  const markersFound = markersIn(root);
  const corroborated = CORROBORATING_REL.some((rel) => markersFound.includes(rel));
  if (!corroborated) {
    return { kind: 'unrelated' };
  }
  return { kind: 'undecidable', root, manifestPath, reason, markersFound };
}

/**
 * Walk up from `startDir`, inclusive, and report the first ancestor that is or
 * might be DSpatch's own working copy.
 *
 * The chosen folder itself is examined first, so the behaviour for the
 * repository root is unchanged; the ancestors are what closes hole 1.
 */
export function findOwnRepository(startDir: string): OwnRepositoryVerdict {
  let dir = path.resolve(startDir);
  for (;;) {
    const verdict = inspectDirectory(dir);
    if (verdict.kind !== 'unrelated') {
      return verdict;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // `path.dirname` is a fixed point at the root of a drive and at a UNC
      // share root, which is the only termination condition that holds on both
      // Windows and Linux.
      return { kind: 'unrelated' };
    }
    dir = parent;
  }
}

/**
 * Where DSpatch's own sources are, as far as the running process can tell.
 *
 * `appPath` is `<repo>/app` when running from source and a path inside
 * `app.asar` when packaged. Walking up from either finds the repository whenever
 * the artifact is still inside the tree it was built in — which the packaged
 * artifact under `app/release/win-unpacked` is. It returns `null` for a copy that
 * has been moved out of the tree, and that is the honest answer.
 */
export function ownRepositoryRoot(appPath: string): string | null {
  const verdict = findOwnRepository(appPath);
  return verdict.kind === 'unrelated' ? null : verdict.root;
}
