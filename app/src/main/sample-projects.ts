/**
 * Where DSpatch puts the sample project it generates, and what may be cleaned up.
 *
 * DSP-61. The generator refuses to wipe a non-empty directory that has no
 * `.dspatch-experiment` marker, and that refusal is the thing standing between a
 * loop run and somebody's real directory. It is not weakened anywhere in this
 * file. What went wrong is narrower: every session reused **one** fixed path,
 * `%TEMP%/dspatch-chat/duration-repo`, and the copy sitting there on Niclas's
 * machine was generated on 14–16 September, before the marker existed. So the
 * generator correctly declined to touch it, and *Use a generated sample project*
 * failed for good, with nothing offered.
 *
 * Niclas's decision, 19 September 2026: **a new sample project goes in its own
 * fresh folder, and clearing out old ones is a separate action rather than
 * something a new session does on the way past.** The user's own project
 * directories are never touched.
 *
 * The distinction that makes removal safe is the one the generator already uses —
 * whether DSpatch created the folder — read here by **location** rather than by
 * marker, because the marker is exactly what the leftover lacks:
 *
 * - A direct child of {@link sampleProjectsRoot} is content DSpatch created. It may
 *   be removed **when asked**, marker or no marker.
 * - Anything else is not ours. Nothing here looks at it, and the generator's
 *   refusal applies to it unchanged.
 *
 * Nothing in this module removes anything on its own. `cleanUpSampleProjects` runs
 * only when a person asks for it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The directory DSpatch generates sample projects into. */
export function sampleProjectsRoot(tmpDir: string = os.tmpdir()): string {
  return path.join(tmpDir, 'dspatch-chat');
}

/**
 * Whether `candidate` is a direct child of the sample location.
 *
 * Direct child only. A grandchild is a folder *inside* a sample project, and
 * removing one of those is not "clean up the sample projects"; the root itself is
 * not a sample project either. Compared case-insensitively on Windows, where two
 * spellings of one path differ without differing.
 */
export function isSampleProjectFolder(root: string, candidate: string): boolean {
  const parent = path.resolve(path.dirname(path.resolve(candidate)));
  const resolvedRoot = path.resolve(root);
  return process.platform === 'win32'
    ? parent.toLowerCase() === resolvedRoot.toLowerCase()
    : parent === resolvedRoot;
}

/**
 * A fresh folder for a new sample project, created empty.
 *
 * `mkdtemp` rather than a name built from the clock: two sessions started in the
 * same second must not land in the same folder, and the whole defect this fixes
 * was two runs sharing one directory. The timestamp is in the name anyway, because
 * the person deciding what to clean up later reads these names.
 *
 * It is created here rather than merely named, so the returned path is the folder
 * this session owns and no later caller can be handed the same one. Empty, so the
 * generator's own check passes without the marker being involved.
 */
export function createSampleProjectFolder(
  root: string,
  now: Date = new Date(),
): string {
  fs.mkdirSync(root, { recursive: true });
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  return fs.mkdtempSync(path.join(root, `sample-${stamp}-`));
}

/** One sample project found in DSpatch's sample location. */
export interface SampleProjectFolder {
  readonly path: string;
  readonly name: string;
  /**
   * Whether it carries `.dspatch-experiment`.
   *
   * Reported rather than acted on. An unmarked folder here is old app-created
   * content — the folders generated before the marker existed — and saying so is
   * how the window can be honest about what it is about to remove.
   */
  readonly marked: boolean;
  readonly fileCount: number;
  /** Last modification of the folder itself, or `null` if it could not be read. */
  readonly lastChangedUtc: string | null;
  /** Why this folder could not be read, or `null`. Unreadable is not absent. */
  readonly error: string | null;
}

export interface SampleProjectListing {
  readonly root: string;
  readonly folders: readonly SampleProjectFolder[];
  /** The sample project the open session is using, which is never offered. */
  readonly inUse: string | null;
  /** Why the location could not be listed, or `null`. */
  readonly error: string | null;
}

/**
 * The sample projects in DSpatch's own sample location.
 *
 * `inUse` is excluded rather than listed-and-disabled: the folder the open session
 * is working in is not old content, and offering it would make "clean up" mean
 * "delete what I am using".
 *
 * A location that does not exist is an empty listing, not a failure — there is
 * nothing to clean up, which is the normal state on a fresh machine.
 */
export function listSampleProjects(
  root: string,
  inUse: string | null = null,
): SampleProjectListing {
  const resolvedRoot = path.resolve(root);
  const same = (left: string, right: string): boolean =>
    process.platform === 'win32'
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code === 'ENOENT') {
      return { root: resolvedRoot, folders: [], inUse, error: null };
    }
    return {
      root: resolvedRoot,
      folders: [],
      inUse,
      error: `Could not read ${resolvedRoot}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const folders: SampleProjectFolder[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const full = path.join(resolvedRoot, entry.name);
    if (inUse !== null && same(path.resolve(inUse), full)) {
      continue;
    }
    folders.push(describeFolder(full, entry.name));
  }
  folders.sort((left, right) => (left.name < right.name ? -1 : 1));
  return { root: resolvedRoot, folders, inUse, error: null };
}

function describeFolder(full: string, name: string): SampleProjectFolder {
  let fileCount = 0;
  let error: string | null = null;
  try {
    fileCount = countFiles(full, 0);
  } catch (readError) {
    error = readError instanceof Error ? readError.message : String(readError);
  }
  let lastChangedUtc: string | null = null;
  try {
    lastChangedUtc = fs.statSync(full).mtime.toISOString();
  } catch {
    lastChangedUtc = null;
  }
  return {
    path: full,
    name,
    marked: fs.existsSync(path.join(full, '.dspatch-experiment')),
    fileCount,
    lastChangedUtc,
    error,
  };
}

/** Bounded: a count is for the window, and a sample project is small. */
function countFiles(dir: string, depth: number): number {
  if (depth > 6) {
    return 0;
  }
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name), depth + 1);
      continue;
    }
    count += 1;
  }
  return count;
}

export interface SampleProjectRemoval {
  readonly path: string;
  /** Why it is still there. Never empty when a folder appears here. */
  readonly reason: string;
}

export interface SampleCleanupResult {
  readonly root: string;
  readonly removed: readonly string[];
  /** Folders that could not be removed, each with the reason. */
  readonly held: readonly SampleProjectRemoval[];
  /** What was and was not touched, for the window to show. */
  readonly note: string;
  readonly remaining: SampleProjectListing;
}

/** Delete failures worth explaining rather than passing along as a code. */
const HELD_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

/**
 * Remove old sample projects, because a person asked.
 *
 * Every path is checked against the sample location again here, not only where the
 * list was produced. The renderer names paths it was shown, and a folder that is
 * not a direct child of the sample location is refused rather than removed — that
 * refusal is the same guarantee the generator's is, at the other end of the same
 * decision, and it is why this function can take paths from outside the main
 * process at all.
 *
 * A folder held open by a live process — the case that started this, and the one
 * DSP-62's lingering run produces — is reported as held with the reason, not
 * silently counted as removed. Nothing here fails the whole action because one
 * folder is locked.
 */
export function cleanUpSampleProjects(
  root: string,
  request: {
    readonly paths: readonly string[];
    /** The sample project the open session is using. Never removed. */
    readonly inUse?: string | null;
  },
): SampleCleanupResult {
  const resolvedRoot = path.resolve(root);
  const inUse = request.inUse ?? null;
  const removed: string[] = [];
  const held: SampleProjectRemoval[] = [];

  for (const asked of request.paths) {
    const target = path.resolve(asked);
    if (!isSampleProjectFolder(resolvedRoot, target)) {
      held.push({
        path: target,
        reason:
          `Not removed: this is not one of DSpatch's own sample projects. Only the ` +
          `folders directly inside ${resolvedRoot} are, and DSpatch does not delete ` +
          'anything anywhere else.',
      });
      continue;
    }
    if (
      inUse !== null &&
      (process.platform === 'win32'
        ? path.resolve(inUse).toLowerCase() === target.toLowerCase()
        : path.resolve(inUse) === target)
    ) {
      held.push({
        path: target,
        reason:
          'Not removed: this is the sample project the open session is working in. ' +
          'Close it or open another project first.',
      });
      continue;
    }
    if (!fs.existsSync(target)) {
      // Already gone. Not an error, and not a removal this action performed.
      continue;
    }
    try {
      // Barely any retrying, unlike the generator's own delete: what holds one of
      // these is a live process, and that does not pass in a second. Reporting it
      // as held quickly is more use than a window that sits still for ten seconds.
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      removed.push(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      const detail = error instanceof Error ? error.message : String(error);
      held.push({
        path: target,
        reason: HELD_CODES.has(code)
          ? `Still there (${code}): a live process is holding it. Usually a test ` +
            'runner or a terminal whose working directory is inside it. Close that ' +
            'and ask again.'
          : `Still there: ${detail}`,
      });
    }
  }

  return {
    root: resolvedRoot,
    removed,
    held,
    note: describeCleanup(resolvedRoot, removed, held),
    remaining: listSampleProjects(resolvedRoot, inUse),
  };
}

function describeCleanup(
  root: string,
  removed: readonly string[],
  held: readonly SampleProjectRemoval[],
): string {
  const scope =
    `Only folders DSpatch generated inside ${root} are touched by this. Your own ` +
    'project folders are never removed, and no saved conversation was deleted.';
  if (removed.length === 0 && held.length === 0) {
    return `There was nothing to remove. ${scope}`;
  }
  const first =
    removed.length === 0
      ? 'Nothing was removed.'
      : `Removed ${String(removed.length)} sample ${
          removed.length === 1 ? 'project' : 'projects'
        }.`;
  const stuck =
    held.length === 0
      ? ''
      : ` ${String(held.length)} ${held.length === 1 ? 'was' : 'were'} left in place; ` +
        'each one says why below.';
  return `${first}${stuck} ${scope}`;
}
