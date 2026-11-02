import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, statSync, type BigIntStats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FileEntry, TreeSnapshot } from './experiment-repo';
import { snapshotIdFor, type FileListSource } from './workspace-baseline';

/*
 * The loop's snapshots of its working folders (DSP-163).
 *
 * Until this card a loop run used `snapshotTree`: every file under every root, read and hashed
 * synchronously, before each step and at the start and end of every shell command. On a real
 * three-folder workspace of about 137 GB that held the host's event loop for minutes at a time,
 * so the client's connection was dropped, the provider's runtime missed its pings and the run
 * ended as a runtime fault with an unknown outcome (attempt 0028, 1 November 2026).
 *
 * What this module guarantees instead, and what it does not:
 *
 * - **Scope.** Where a root is a git repository its files are git's own list: tracked files
 *   plus untracked files that are not ignored — the chat's baseline policy
 *   (`workspace-baseline.ts`). A change to a git-ignored file (`tmp/`, `.venv`, datasets) is
 *   outside the snapshot, and every account built on it says so. Where git cannot list a root
 *   the directory is walked, skipping only `.git` and `node_modules`.
 * - **Content.** A file is identified by the SHA-256 of its bytes. Two bounds keep a scan
 *   proportionate: a file above the per-file size, and files past the per-scan hashing budget,
 *   are identified by size and modification time instead (`stat:` entries) and counted as such.
 *   A file whose size, times and inode are unchanged since an earlier scan in this process
 *   keeps its earlier identity without being read again; one modified within the last two
 *   seconds is always re-read, because a second write in the same instant could leave its
 *   times unchanged.
 * - **Completeness.** A scan is complete when every file in scope was listed. A root with more
 *   files than the bound, or one whose listing failed, gives an *incomplete* snapshot, and an
 *   incomplete snapshot is never the basis of "unchanged" or "nothing changed": its callers
 *   treat it as not observed.
 * - **Not a guard.** A snapshot observes; it prevents nothing. A write is stopped, where it is
 *   stopped at all, by the tool permissions and hooks, not by comparing two snapshots.
 *
 * And how it stays out of the way: the listing is a child process, file reads are asynchronous
 * and hashing proceeds in stream chunks, so the event loop keeps turning. Reads run a few at a
 * time, scans of one root by one run are coalesced (a request joins the next scan rather than
 * starting another), at most two roots are scanned at once across the process, and a scan
 * stops at the run's abort signal between files.
 */

export interface LoopSnapshotLimits {
  /** Files listed in one root before the snapshot counts as incomplete. */
  readonly maxFiles: number;
  /** Larger files are identified by size and modification time, not content. */
  readonly maxFileBytes: number;
  /** Bytes newly read and hashed in one scan; past it files are identified by metadata. */
  readonly maxHashBytesPerScan: number;
  /** Files read at once within one scan. */
  readonly concurrency: number;
}

export const LOOP_SNAPSHOT_LIMITS: LoopSnapshotLimits = {
  maxFiles: 100_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxHashBytesPerScan: 2 * 1024 * 1024 * 1024,
  concurrency: 8,
};

/** How many roots may be scanned at once in this process. */
const ROOT_SCANS_AT_ONCE = 2;

/** A file modified this recently is read again whatever its metadata says. */
const RACY_MS = 2_000;

const WALK_SKIP_DIRS = new Set(['.git', 'node_modules']);

/** What one root's scan covered. Counts and bounds only: no file content, no path list. */
export interface SnapshotCoverage {
  readonly root: string;
  readonly source: FileListSource;
  readonly complete: boolean;
  /** Why the scan is incomplete, or `null` when it is complete. */
  readonly incompleteBecause: string | null;
  readonly fileCount: number;
  /** Files identified by their content's hash. */
  readonly contentFiles: number;
  /** Files identified by size and modification time (over a bound). */
  readonly metadataFiles: number;
  /** Of the content-hashed files, how many were read in this scan. */
  readonly readFiles: number;
  readonly readBytes: number;
  readonly totalBytes: number;
  readonly durationMs: number;
  readonly startedAtUtc: string;
}

export interface RootSnapshot {
  readonly tree: TreeSnapshot;
  readonly snapshotId: string;
  readonly coverage: SnapshotCoverage;
  /** Each observed file's size, times and inode as this scan found them, by relative path. */
  readonly signatures: ReadonlyMap<string, string>;
}

/** The scope sentence every account built on these snapshots carries. */
export function describeSnapshotScope(coverages: readonly SnapshotCoverage[]): string {
  const viaGit = coverages.some((coverage) => coverage.source === 'git-ls-files');
  const walked = coverages.some((coverage) => coverage.source === 'directory-walk');
  const parts: string[] = [];
  if (viaGit) {
    parts.push(
      'In a git repository DSpatch observes tracked files and untracked files that are not ' +
        'ignored; a change to a git-ignored file is outside what it observes.',
    );
  }
  if (walked) {
    parts.push('A folder git could not list is observed by walking it, without .git and node_modules.');
  }
  const metadata = coverages.reduce((sum, coverage) => sum + coverage.metadataFiles, 0);
  if (metadata > 0) {
    parts.push(
      `${String(metadata)} large file${metadata === 1 ? ' is' : 's are'} compared by size and ` +
        'modification time rather than content.',
    );
  }
  return parts.join(' ');
}

interface CachedEntry {
  readonly signature: string;
  readonly identity: string;
}

/**
 * Identities from earlier scans, per root, keyed by relative path.
 *
 * Process-wide so a second run over the same folders does not read them all again. Replaced
 * wholesale by each complete scan of a root, so it never holds more than one root's bound.
 */
const identityCache = new Map<string, Map<string, CachedEntry>>();

/** The most recent listing of each root, for {@link fingerprintRoots}. */
const lastListing = new Map<string, readonly string[]>();

/** Forget every remembered identity and listing. For tests. */
export function clearSnapshotCache(): void {
  identityCache.clear();
  lastListing.clear();
}

function signatureOf(info: BigIntStats): string {
  return `${String(info.size)}:${String(info.mtimeNs)}:${String(info.ctimeNs)}:${String(info.ino)}`;
}

let rootScansRunning = 0;
const rootScanQueue: (() => void)[] = [];

async function withRootSlot<T>(work: () => Promise<T>): Promise<T> {
  if (rootScansRunning >= ROOT_SCANS_AT_ONCE) {
    await new Promise<void>((resolve) => {
      rootScanQueue.push(resolve);
    });
  } else {
    rootScansRunning += 1;
  }
  try {
    return await work();
  } finally {
    const next = rootScanQueue.shift();
    if (next === undefined) {
      rootScansRunning -= 1;
    } else {
      next();
    }
  }
}

function abortError(): Error {
  const error = new Error('The snapshot was stopped.');
  error.name = 'AbortError';
  return error;
}

function listByGit(root: string, signal: AbortSignal | undefined): Promise<readonly string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        encoding: 'buffer',
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: 256 * 1024 * 1024,
        ...(signal === undefined ? {} : { signal }),
      },
      (error, stdout) => {
        if (error !== null) {
          resolve(null);
          return;
        }
        resolve(
          stdout
            .toString('utf8')
            .split('\0')
            .filter((entry) => entry !== ''),
        );
      },
    );
  });
}

async function listByWalk(
  root: string,
  maxFiles: number,
  signal: AbortSignal | undefined,
): Promise<{ readonly files: readonly string[]; readonly overflowed: boolean }> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    if (signal?.aborted === true) {
      throw abortError();
    }
    const dir = pending.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_SKIP_DIRS.has(entry.name)) {
          pending.push(full);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (files.length >= maxFiles) {
        return { files, overflowed: true };
      }
      files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  return { files, overflowed: false };
}

async function hashFile(full: string, size: number, signal: AbortSignal | undefined): Promise<string> {
  if (size <= 1024 * 1024) {
    return createHash('sha256').update(await readFile(full)).digest('hex');
  }
  const hash = createHash('sha256');
  const stream = createReadStream(full, {
    highWaterMark: 256 * 1024,
    ...(signal === undefined ? {} : { signal }),
  });
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/**
 * One scan of one root, off the event loop as far as Node allows: see the module comment.
 * Throws an `AbortError` when `signal` aborts.
 */
export async function scanRoot(
  root: string,
  limits: LoopSnapshotLimits = LOOP_SNAPSHOT_LIMITS,
  signal?: AbortSignal,
): Promise<RootSnapshot> {
  return withRootSlot(async () => {
    const aborted = (): boolean => signal?.aborted === true;
    const startedAt = performance.now();
    const startedAtUtc = new Date().toISOString();
    if (aborted()) {
      throw abortError();
    }
    let source: FileListSource;
    let listed: readonly string[];
    let incompleteBecause: string | null = null;
    const fromGit = await listByGit(root, signal);
    if (aborted()) {
      throw abortError();
    }
    if (fromGit === null) {
      source = 'directory-walk';
      const walked = await listByWalk(root, limits.maxFiles, signal);
      listed = walked.files;
      if (walked.overflowed) {
        incompleteBecause = `the folder holds more than ${String(limits.maxFiles)} files, so only part of it was observed`;
      }
    } else {
      source = 'git-ls-files';
      listed = fromGit;
      if (fromGit.length > limits.maxFiles) {
        listed = fromGit.slice(0, limits.maxFiles);
        incompleteBecause = `git lists ${String(fromGit.length)} files here, more than the ${String(limits.maxFiles)} DSpatch observes, so only part of it was observed`;
      }
    }

    lastListing.set(root, listed);
    const previous = identityCache.get(root) ?? new Map<string, CachedEntry>();
    const signatures = new Map<string, string>();
    const next = new Map<string, CachedEntry>();
    const files: (FileEntry | null)[] = new Array<FileEntry | null>(listed.length).fill(null);
    let contentFiles = 0;
    let metadataFiles = 0;
    let readFiles = 0;
    let readBytes = 0;
    let totalBytes = 0;
    let budget = limits.maxHashBytesPerScan;
    let cursor = 0;

    const one = async (index: number): Promise<void> => {
      const relPath = listed[index] as string;
      const full = path.join(root, relPath);
      let info;
      try {
        info = await stat(full, { bigint: true });
      } catch {
        // Listed by git and absent from disk: a deleted tracked file. Its absence shows as removed.
        return;
      }
      if (!info.isFile()) {
        return;
      }
      const size = Number(info.size);
      const signature = signatureOf(info);
      signatures.set(relPath, signature);
      const racy = Date.now() - Number(info.mtimeMs) < RACY_MS || Date.now() - Number(info.ctimeMs) < RACY_MS;
      const cached = previous.get(relPath);
      let identity: string;
      if (cached !== undefined && cached.signature === signature && !racy) {
        identity = cached.identity;
      } else if (size > limits.maxFileBytes || size > budget) {
        identity = `stat:${String(info.size)}:${String(info.mtimeNs)}`;
      } else {
        budget -= size;
        try {
          identity = await hashFile(full, size, signal);
        } catch (error) {
          if (signal?.aborted === true) {
            throw abortError();
          }
          identity = `unreadable:${error instanceof Error ? (error as NodeJS.ErrnoException).code ?? 'error' : 'error'}`;
        }
        readFiles += 1;
        readBytes += size;
      }
      if (identity.startsWith('stat:')) {
        metadataFiles += 1;
      } else {
        contentFiles += 1;
      }
      totalBytes += size;
      if (!racy) {
        next.set(relPath, { signature, identity });
      }
      files[index] = { relPath, bytes: size, sha256: identity };
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted === true) {
          throw abortError();
        }
        const index = cursor;
        cursor += 1;
        if (index >= listed.length) {
          return;
        }
        await one(index);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, limits.concurrency) }, () => worker()));

    if (incompleteBecause === null) {
      identityCache.set(root, next);
    }
    const kept = files.filter((file): file is FileEntry => file !== null);
    kept.sort((left, right) => (left.relPath < right.relPath ? -1 : 1));
    const tree: TreeSnapshot = { root, takenAtUtc: startedAtUtc, files: kept };
    return {
      tree,
      signatures,
      snapshotId: snapshotIdFor(tree),
      coverage: {
        root,
        source,
        complete: incompleteBecause === null,
        incompleteBecause,
        fileCount: kept.length,
        contentFiles,
        metadataFiles,
        readFiles,
        readBytes,
        totalBytes,
        durationMs: Math.round(performance.now() - startedAt),
        startedAtUtc,
      },
    };
  });
}

export function describeCoverage(coverage: SnapshotCoverage): string {
  const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return (
    `root=${coverage.root} source=${coverage.source} files=${String(coverage.fileCount)} ` +
    `read=${String(coverage.readFiles)} (${mb(coverage.readBytes)}) metadata-only=${String(coverage.metadataFiles)} ` +
    `in-scope=${mb(coverage.totalBytes)} durationMs=${String(coverage.durationMs)} ` +
    (coverage.complete ? 'complete' : `INCOMPLETE: ${coverage.incompleteBecause ?? ''}`)
  );
}

export interface LoopSnapshotterOptions {
  readonly limits?: LoopSnapshotLimits;
  readonly signal?: AbortSignal;
  readonly log?: (message: string) => void;
}

/**
 * One run's snapshots: scans of a root are coalesced, so however many tool calls start and
 * end at once there is at most one scan of a root running and one waiting.
 *
 * A request never joins a scan that started before it: the waiting scan begins after the
 * running one ends, so whoever asks gets a look taken after they asked.
 */
export class LoopSnapshotter {
  private readonly running = new Map<string, Promise<RootSnapshot>>();

  private readonly waiting = new Map<string, Promise<RootSnapshot>>();

  private readonly options: LoopSnapshotterOptions;

  constructor(options: LoopSnapshotterOptions = {}) {
    this.options = options;
  }

  snapshot(root: string): Promise<RootSnapshot> {
    const queued = this.waiting.get(root);
    if (queued !== undefined) {
      return queued;
    }
    const current = this.running.get(root);
    if (current === undefined) {
      return this.start(root);
    }
    const after = current
      .catch(() => undefined)
      .then(() => {
        this.waiting.delete(root);
        return this.start(root);
      });
    this.waiting.set(root, after);
    return after;
  }

  /** Every root at once, keyed by path. Rejects with an `AbortError` when the run stops. */
  async snapshotAll(roots: readonly string[]): Promise<ReadonlyMap<string, RootSnapshot>> {
    const unique = [...new Set(roots)];
    const taken = await Promise.all(unique.map((root) => this.snapshot(root)));
    return new Map(unique.map((root, index) => [root, taken[index] as RootSnapshot]));
  }

  private start(root: string): Promise<RootSnapshot> {
    const scan = scanRoot(root, this.options.limits ?? LOOP_SNAPSHOT_LIMITS, this.options.signal).then(
      (taken) => {
        this.options.log?.(`[snapshot] ${describeCoverage(taken.coverage)}`);
        return taken;
      },
    );
    this.running.set(root, scan);
    const clear = (): void => {
      if (this.running.get(root) === scan) {
        this.running.delete(root);
      }
    };
    scan.then(clear, clear);
    return scan;
  }
}

/**
 * The working folders' metadata at one moment, read synchronously (DSP-163).
 *
 * For a provider that reports a shell command by an event and cannot hold the agent there
 * (Copilot, Cursor), an asynchronous scan begun at the event can see what the agent did after
 * it. So at the event DSpatch reads, synchronously, only the size, times and inode of each file
 * in the root's most recent listing: no listing is made and nothing is hashed. On a workspace of
 * about 50,000 listed files that is about 0.2 s, against minutes for the full hash it replaces.
 * The scan that follows is trusted for that moment only if nothing it saw differs from this;
 * see {@link changedSince}.
 */
export interface CommandFingerprint {
  /** Wall-clock time of the reading, in nanoseconds since the epoch. */
  readonly takenAtNs: bigint;
  /** Per root, each listed file's signature or `absent`; `null` for a root never listed. */
  readonly roots: ReadonlyMap<string, ReadonlyMap<string, string> | null>;
  readonly fileCount: number;
  readonly durationMs: number;
}

export function fingerprintRoots(roots: readonly string[], log?: (message: string) => void): CommandFingerprint {
  const startedAt = performance.now();
  const takenAtNs = BigInt(Date.now()) * 1_000_000n;
  const byRoot = new Map<string, ReadonlyMap<string, string> | null>();
  let fileCount = 0;
  for (const root of new Set(roots)) {
    const listing = lastListing.get(root);
    if (listing === undefined) {
      byRoot.set(root, null);
      continue;
    }
    const signatures = new Map<string, string>();
    for (const relPath of listing) {
      let info: BigIntStats | undefined;
      try {
        info = statSync(path.join(root, relPath), { bigint: true, throwIfNoEntry: false });
      } catch {
        info = undefined;
      }
      signatures.set(relPath, info !== undefined && info.isFile() ? signatureOf(info) : 'absent');
    }
    fileCount += listing.length;
    byRoot.set(root, signatures);
  }
  const durationMs = Math.round(performance.now() - startedAt);
  log?.(`[snapshot] fingerprint roots=${String(byRoot.size)} files=${String(fileCount)} durationMs=${String(durationMs)}`);
  return { takenAtNs, roots: byRoot, fileCount, durationMs };
}

/**
 * Why a scan taken after `fingerprint` does not show the folders as they were at it, or `null`
 * when it does: no listed file's metadata differs, none disappeared, and no file the scan found
 * beyond the listing was created or changed after (or within the racy window before) the
 * moment. Counts only, no file names.
 */
export function changedSince(
  fingerprint: CommandFingerprint,
  scans: ReadonlyMap<string, RootSnapshot>,
): string | null {
  for (const [root, scan] of scans) {
    const before = fingerprint.roots.get(root);
    if (before === undefined || before === null) {
      return `${root} had not been listed before the command's moment, so it was not observed at it`;
    }
    let differing = 0;
    for (const [relPath, signature] of before) {
      if ((scan.signatures.get(relPath) ?? 'absent') !== signature) {
        differing += 1;
      }
    }
    for (const [relPath, signature] of scan.signatures) {
      if (before.has(relPath)) {
        continue;
      }
      const ctimeNs = signature.split(':')[2];
      // File times come from a coarse kernel clock that can lag the wall clock, so a file made
      // just after the moment can carry a time just before it. Within the racy window it counts
      // as changed: at worst the moment is not established, never wrongly claimed.
      if (ctimeNs === undefined || BigInt(ctimeNs) > fingerprint.takenAtNs - BigInt(RACY_MS) * 1_000_000n) {
        differing += 1;
      }
    }
    if (differing > 0) {
      return `${root}: ${String(differing)} file${differing === 1 ? '' : 's'} changed after the command's moment and before DSpatch read them`;
    }
  }
  return null;
}
