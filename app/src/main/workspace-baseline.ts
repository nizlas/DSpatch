import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { FileEntry, TreeSnapshot } from './experiment-repo';

/**
 * A content snapshot of a real project, and the identity of that snapshot.
 *
 * DSP-1's `snapshotTree` walks a directory and hashes everything it finds. That
 * is right for a generated eight-file repository and wrong for somebody's actual
 * project: it would hash `dist/`, `release/`, virtual environments and build
 * output, which can be gigabytes, and it would block the main process while
 * doing it.
 *
 * So when the directory is a git repository, the file list comes from **git**:
 * tracked files plus untracked files that are not ignored. That is the project's
 * own definition of its content, it excludes build output without DSpatch having
 * to guess directory names, and it is cheap. The consequence is stated rather
 * than hidden: a change to an ignored file is invisible to the baseline, and the
 * snapshot says which method produced it.
 *
 * `snapshotId` exists because criteria #7 and #8 both require results to be tied
 * to an *identified* snapshot. It is derived from the content hashes themselves,
 * so two snapshots with the same ID have the same bytes, and a test result
 * carrying a snapshot ID can be checked against the code it actually ran on.
 */

export type FileListSource = 'git-ls-files' | 'directory-walk';

export interface SkippedFile {
  readonly relPath: string;
  readonly reason: string;
}

export interface WorkspaceSnapshot {
  readonly snapshot: TreeSnapshot;
  /** Content-addressed identity of the whole snapshot. */
  readonly snapshotId: string;
  readonly fileSource: FileListSource;
  readonly fileSourceNote: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  /** A limit was reached, so the snapshot covers only part of the project. */
  readonly truncated: boolean;
  readonly skipped: readonly SkippedFile[];
  readonly durationMs: number;
  /**
   * The bytes themselves, kept for later comparison. `null` when this snapshot
   * was taken without retention, which is the default.
   *
   * A hash tells you *that* a file changed; only the original bytes can tell you
   * *how*. Once the agent has written over a file its previous content exists
   * nowhere else — not in git, because the file may already have been dirty when
   * the session opened — so the session baseline is the only place it can come
   * from, and it has to be kept at the moment the baseline is taken.
   */
  readonly contents: ReadonlyMap<string, Buffer> | null;
  /** Files whose bytes were deliberately not kept, each with its reason. */
  readonly contentOmissions: ReadonlyMap<string, string>;
  readonly retainedBytes: number;
}

/** Bounds on how much of a project is held in memory for later diffing. */
export interface RetentionLimits {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

/**
 * Retention bounds.
 *
 * Smaller than the hashing bounds on purpose: hashing streams past a file and
 * forgets it, while retention holds it in the main process for as long as the
 * session lives. 1 MB covers ordinary source files by a wide margin, and 64 MB
 * caps what one session can hold. Anything left out is named, not dropped.
 */
export const DEFAULT_RETENTION_LIMITS: RetentionLimits = {
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

export interface SnapshotLimits {
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxFileBytes: number;
}

/**
 * Bounds, so that opening a large project is slow at worst and never unbounded.
 * Reaching one is reported as truncation, never as "no further changes".
 */
export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 20_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
};

/**
 * Directories never included when walking a non-git project.
 *
 * Short on purpose. Without git's own ignore rules DSpatch has no authority to
 * decide that a directory is output, so this covers only the cases where being
 * wrong is impossible: git's own bookkeeping and installed dependencies.
 */
const WALK_SKIP_DIRS = new Set(['.git', 'node_modules']);

function listByGit(root: string): readonly string[] | null {
  try {
    const stdout = execFileSync(
      'git',
      [
        '-c',
        'core.quotepath=false',
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
      ],
      {
        cwd: root,
        encoding: 'buffer',
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return stdout
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry !== '');
  } catch {
    return null;
  }
}

function listByWalk(root: string, limits: SnapshotLimits): {
  readonly files: readonly string[];
  readonly truncated: boolean;
} {
  const files: string[] = [];
  let truncated = false;
  const walk = (dir: string): void => {
    if (truncated) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_SKIP_DIRS.has(entry.name)) {
          walk(full);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (files.length >= limits.maxFiles) {
        truncated = true;
        return;
      }
      files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return { files, truncated };
}

/**
 * Hash a project's files.
 *
 * Used for both the baseline and every later observation, so that a difference
 * between them is a difference in the files and not in how they were listed.
 */
export function snapshotWorkspace(
  root: string,
  limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
  /** Pass bounds to keep the bytes as well as the hashes. `null` keeps none. */
  retention: RetentionLimits | null = null,
): WorkspaceSnapshot {
  const startedAt = performance.now();
  const takenAtUtc = new Date().toISOString();
  const skipped: SkippedFile[] = [];
  const contents = retention === null ? null : new Map<string, Buffer>();
  const contentOmissions = new Map<string, string>();
  let retainedBytes = 0;

  const fromGit = listByGit(root);
  let relPaths: readonly string[];
  let fileSource: FileListSource;
  let fileSourceNote: string;
  let truncated = false;

  if (fromGit === null) {
    const walked = listByWalk(root, limits);
    relPaths = walked.files;
    truncated = walked.truncated;
    fileSource = 'directory-walk';
    fileSourceNote =
      'listed by walking the directory, because git could not list this folder. ' +
      '.git and node_modules are excluded; nothing else is, so build output is ' +
      'included if it is there.';
  } else {
    fileSource = 'git-ls-files';
    fileSourceNote =
      'listed by git: tracked files plus untracked files that are not ignored. ' +
      'A change to a git-ignored file is therefore outside this snapshot.';
    if (fromGit.length > limits.maxFiles) {
      relPaths = fromGit.slice(0, limits.maxFiles);
      truncated = true;
    } else {
      relPaths = fromGit;
    }
  }

  const files: FileEntry[] = [];
  let totalBytes = 0;
  for (const relPath of relPaths) {
    const full = path.join(root, relPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      // git lists a tracked file that has been deleted from the working tree.
      // Its absence is a real difference and is recorded as such, not skipped.
      skipped.push({ relPath, reason: 'listed by git but not present on disk' });
      continue;
    }
    if (!stat.isFile()) {
      skipped.push({ relPath, reason: 'not a regular file' });
      continue;
    }
    if (stat.size > limits.maxFileBytes) {
      skipped.push({
        relPath,
        reason: `larger than the ${String(
          Math.round(limits.maxFileBytes / (1024 * 1024)),
        )} MB per-file limit (${String(stat.size)} bytes), so its content is not hashed`,
      });
      continue;
    }
    if (totalBytes + stat.size > limits.maxTotalBytes) {
      truncated = true;
      break;
    }
    try {
      const bytes = fs.readFileSync(full);
      totalBytes += bytes.byteLength;
      files.push({
        relPath,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      if (contents !== null && retention !== null) {
        if (bytes.byteLength > retention.maxFileBytes) {
          contentOmissions.set(
            relPath,
            `its content at the baseline was not kept: ${String(bytes.byteLength)} ` +
              `bytes is above the ${String(
                Math.round(retention.maxFileBytes / 1024),
              )} kB per-file limit`,
          );
        } else if (retainedBytes + bytes.byteLength > retention.maxTotalBytes) {
          contentOmissions.set(
            relPath,
            `its content at the baseline was not kept: this session's ${String(
              Math.round(retention.maxTotalBytes / (1024 * 1024)),
            )} MB budget for baseline content was already used`,
          );
        } else {
          contents.set(relPath, bytes);
          retainedBytes += bytes.byteLength;
        }
      }
    } catch (error) {
      skipped.push({
        relPath,
        reason: `could not be read: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  files.sort((left, right) => (left.relPath < right.relPath ? -1 : 1));
  const snapshot: TreeSnapshot = { root, takenAtUtc, files };

  return {
    snapshot,
    snapshotId: snapshotIdFor(snapshot),
    fileSource,
    fileSourceNote,
    fileCount: files.length,
    totalBytes,
    truncated,
    skipped,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    contents,
    contentOmissions,
    retainedBytes,
  };
}

/**
 * The identity of a snapshot: a hash over its file paths and content hashes.
 *
 * The timestamp is deliberately not part of it. Two snapshots of identical bytes
 * must have the same ID, otherwise "the test ran against this snapshot" could
 * not be checked.
 */
export function snapshotIdFor(snapshot: TreeSnapshot): string {
  const hash = createHash('sha256');
  for (const file of [...snapshot.files].sort((left, right) =>
    left.relPath < right.relPath ? -1 : 1,
  )) {
    hash.update(`${file.relPath}\0${file.sha256}\n`);
  }
  return `snap-${hash.digest('hex').slice(0, 16)}`;
}
