/**
 * The two revisions of a pair, as files an analysis agent can read with its provider's own
 * tools (DSP-152).
 *
 * Walk preparation, delegated review and step questions let the agent examine the code
 * itself: read whole files, follow callers and definitions across files, look at unchanged
 * code and tests. Its tools read files, so the host writes the two commits out as files:
 *
 * ```
 * userData/reviews/revisions/<pair key>/
 *   base/     the tree of From, exactly as committed
 *   target/   the tree of To, exactly as committed
 * ```
 *
 * **From Git's object store only.** The tree is listed with `git ls-tree` at the full
 * commit hash and every file is written from its blob with `git cat-file --batch`. No
 * checkout, no worktree, no index: the person's working copy, branch, index, stash and
 * uncommitted work are neither read nor changed, and the repository's `.git` gains
 * nothing. Line endings and bytes are the commit's (no filters or attributes apply).
 *
 * **Nothing stands in for what cannot be written.** A symbolic link, a submodule, a name
 * this system cannot hold, a second name differing only in letter case, or a file beyond
 * the size bound is left out and named in the snapshot's manifest, which the agent is told
 * about and the job records. The working copy is never used instead.
 *
 * **Owned by the host, held by jobs.** A job holds the snapshot while it runs; jobs over the
 * same pair share it. When the last holder lets go it is deleted. Results never point
 * into it: walks and findings name repository paths at a commit and are checked against
 * Git, so they open after the snapshot is gone. Folders left by an earlier run, whose jobs
 * cannot still be running, are deleted when the host starts.
 *
 * Files are written read-only. That is a guard against accidents, not containment: what
 * keeps the agent to reading is its provider's permission policy (ANALYSIS_PERMISSIONS).
 */

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { RevisionPairIdentity } from '../shared/review-pair';

/** The folders of one side, as the agent's prompt names them. */
export const SIDE_FOLDERS = { base: 'base', target: 'target' } as const;

/** Bytes written per side at most; beyond it files are left out (changed files first, always). */
export const SNAPSHOT_BYTES_PER_SIDE = 1024 * 1024 * 1024;

/** Files written per side at most. */
export const SNAPSHOT_FILES_PER_SIDE = 200_000;

export interface SkippedFile {
  readonly path: string;
  readonly reason: string;
}

export interface SnapshotSide {
  readonly commit: string;
  readonly tree: string;
  readonly files: number;
  readonly bytes: number;
  readonly skipped: readonly SkippedFile[];
}

/** What was written, for the prompt, the job's details and checks. */
export interface SnapshotManifest {
  readonly repository: string;
  readonly createdAt: string;
  readonly base: SnapshotSide;
  readonly target: SnapshotSide;
}

export interface RevisionSnapshot {
  /** The folder the agent works in; it holds `base/` and `target/`. */
  readonly folder: string;
  readonly manifest: SnapshotManifest;
}

export interface RevisionSnapshotsOptions {
  /** `userData/reviews/revisions`. */
  readonly root: string;
  readonly log: (message: string) => void;
}

interface Entry {
  readonly snapshot: Promise<RevisionSnapshot>;
  readonly holders: Set<string>;
}

const MAX_BUFFER = 256 * 1024 * 1024;

function git(repository: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotePath=false', '-C', repository, ...args], { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Why a repository path cannot be written here as it is named, or `null` when it can. */
export function unwritablePath(filePath: string, platform: NodeJS.Platform = process.platform): string | null {
  if (filePath === '' || filePath.includes('\0') || filePath.startsWith('/') || filePath.includes('\\')) {
    return 'its name cannot be written as a file here';
  }
  const segments = filePath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'its name cannot be written as a file here';
  }
  if (platform === 'win32') {
    for (const segment of segments) {
      // eslint-disable-next-line no-control-regex
      if (/[<>:"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment)) {
        return 'its name cannot be written as a file on Windows';
      }
    }
  }
  return null;
}

interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly object: string;
  readonly size: number;
  readonly path: string;
}

function parseTree(text: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of text.split('\0')) {
    if (record === '') {
      continue;
    }
    const tab = record.indexOf('\t');
    const [mode = '', type = '', object = '', size = '-'] = record.slice(0, tab).trim().split(/\s+/);
    entries.push({ mode, type, object, size: size === '-' ? 0 : Number(size), path: record.slice(tab + 1) });
  }
  return entries;
}

/**
 * Write blobs from `git cat-file --batch`, one file per request, in order. The batch
 * protocol answers each object id with `<id> <type> <size>\n<bytes>\n`, or `<id> missing\n`.
 */
function writeBlobs(repository: string, wanted: readonly { readonly object: string; readonly file: string }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (wanted.length === 0) {
      resolve();
      return;
    }
    const child = spawn('git', ['-C', repository, 'cat-file', '--batch'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let index = 0;
    let pending: Buffer = Buffer.alloc(0);
    let body: { size: number } | null = null;
    let failed: Error | null = null;
    let stderr = '';
    const fail = (error: Error): void => {
      if (failed === null) {
        failed = error;
        child.kill();
      }
    };
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (failed !== null) {
        return;
      }
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      for (;;) {
        if (body === null) {
          const newline = pending.indexOf(0x0a);
          if (newline < 0) {
            return;
          }
          const header = pending.subarray(0, newline).toString('utf8');
          pending = pending.subarray(newline + 1);
          const [, type, size] = header.split(' ');
          if (type !== 'blob' || size === undefined) {
            fail(new Error(`Git did not return the file ${wanted[index]?.file ?? ''} (${header}).`));
            return;
          }
          body = { size: Number(size) };
        }
        if (pending.length < body.size + 1) {
          return;
        }
        const target = wanted[index];
        if (target === undefined) {
          fail(new Error('Git returned more objects than were asked for.'));
          return;
        }
        try {
          fs.mkdirSync(path.dirname(target.file), { recursive: true });
          fs.writeFileSync(target.file, pending.subarray(0, body.size));
          fs.chmodSync(target.file, 0o444);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        pending = pending.subarray(body.size + 1);
        body = null;
        index += 1;
      }
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (failed !== null) {
        reject(failed);
      } else if (index !== wanted.length) {
        reject(new Error(stderr.trim() || `git cat-file ended after ${String(index)} of ${String(wanted.length)} files (exit ${String(code)}).`));
      } else {
        resolve();
      }
    });
    child.stdin.on('error', fail);
    child.stdin.end(`${wanted.map((entry) => entry.object).join('\n')}\n`);
  });
}

/** Delete a tree DSpatch wrote, read-only files included. */
export function removeTree(folder: string): void {
  try {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    return;
  } catch {
    // Read-only files can refuse deletion on Windows: make them writable and try again.
  }
  const visit = (entry: string): void => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(entry);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entry)) {
        visit(path.join(entry, name));
      }
    }
    try {
      fs.chmodSync(entry, 0o777);
    } catch {
      // Best effort.
    }
  };
  visit(folder);
  fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
}

/** Write one side's tree under `folder`. Changed paths first, so the size bound never drops them. */
async function writeSide(repository: string, commit: string, folder: string, changed: ReadonlySet<string>): Promise<SnapshotSide> {
  const tree = (await git(repository, ['rev-parse', '--verify', `${commit}^{tree}`])).trim();
  const entries = parseTree(await git(repository, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit]));
  const skipped: SkippedFile[] = [];
  const caseSeen = new Map<string, string>();
  const caseBlind = process.platform === 'win32' || process.platform === 'darwin';
  const ordered = [...entries].sort((a, b) => Number(changed.has(b.path)) - Number(changed.has(a.path)));
  const wanted: { object: string; file: string }[] = [];
  let bytes = 0;
  for (const entry of ordered) {
    if (entry.type === 'commit') {
      skipped.push({ path: entry.path, reason: 'a submodule: its files are in another repository and are not part of this commit' });
      continue;
    }
    if (entry.mode === '120000') {
      skipped.push({ path: entry.path, reason: 'a symbolic link, which is not written so nothing outside the revision can be reached through it' });
      continue;
    }
    if (entry.type !== 'blob') {
      continue;
    }
    const unwritable = unwritablePath(entry.path);
    if (unwritable !== null) {
      skipped.push({ path: entry.path, reason: unwritable });
      continue;
    }
    if (caseBlind) {
      const folded = entry.path.toLowerCase();
      const other = caseSeen.get(folded);
      if (other !== undefined) {
        skipped.push({ path: entry.path, reason: `its name differs from ${other} only in letter case, which this file system cannot hold apart` });
        continue;
      }
      caseSeen.set(folded, entry.path);
    }
    if (!changed.has(entry.path) && (bytes + entry.size > SNAPSHOT_BYTES_PER_SIDE || wanted.length >= SNAPSHOT_FILES_PER_SIDE)) {
      skipped.push({ path: entry.path, reason: "beyond DSpatch's size bound for analysis material" });
      continue;
    }
    bytes += entry.size;
    wanted.push({ object: entry.object, file: path.join(folder, ...entry.path.split('/')) });
  }
  fs.mkdirSync(folder, { recursive: true });
  await writeBlobs(repository, wanted);
  return { commit, tree, files: wanted.length, bytes, skipped };
}

export class RevisionSnapshots {
  private readonly options: RevisionSnapshotsOptions;

  private readonly entries = new Map<string, Entry>();

  /** A deletion under way per pair, which a new snapshot of that pair waits for. */
  private readonly removals = new Map<string, Promise<void>>();

  constructor(options: RevisionSnapshotsOptions) {
    this.options = options;
  }

  /** At host start: nothing can hold a snapshot yet, so every folder left is stale. */
  sweep(): void {
    if (!fs.existsSync(this.options.root)) {
      return;
    }
    for (const name of fs.readdirSync(this.options.root)) {
      try {
        removeTree(path.join(this.options.root, name));
        this.options.log(`revisions: removed ${name.slice(0, 12)} left by an earlier run`);
      } catch (error) {
        this.options.log(`revisions: could not remove ${name.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * The pair's snapshot for `holder`, written if no job holds one. `changed` are the
   * repository paths the diff names at each side, which the size bound never leaves out.
   */
  acquire(key: string, pair: RevisionPairIdentity, changed: { readonly base: ReadonlySet<string>; readonly target: ReadonlySet<string> }, holder: string): Promise<RevisionSnapshot> {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.holders.add(holder);
      return existing.snapshot;
    }
    const folder = path.join(this.options.root, key);
    const previous = this.removals.get(key);
    const snapshot = (async (): Promise<RevisionSnapshot> => {
      await previous;
      // A folder no job holds is not trusted: it is written again from the commits.
      removeTree(folder);
      const started = Date.now();
      const base = await writeSide(pair.repository, pair.base, path.join(folder, SIDE_FOLDERS.base), changed.base);
      const target = await writeSide(pair.repository, pair.target, path.join(folder, SIDE_FOLDERS.target), changed.target);
      this.options.log(
        `revisions: ${key.slice(0, 12)} written in ${String(Date.now() - started)} ms ` +
          `(base ${pair.base.slice(0, 7)}: ${String(base.files)} files, ${String(base.skipped.length)} left out; ` +
          `target ${pair.target.slice(0, 7)}: ${String(target.files)} files, ${String(target.skipped.length)} left out)`,
      );
      return { folder, manifest: { repository: pair.repository, createdAt: new Date().toISOString(), base, target } };
    })();
    const entry: Entry = { snapshot, holders: new Set([holder]) };
    this.entries.set(key, entry);
    snapshot.catch(() => {
      // A snapshot that could not be written is not kept for the next job.
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
        try {
          removeTree(folder);
        } catch {
          // Swept at the next start.
        }
      }
    });
    return snapshot;
  }

  /** `holder` is done with it; the last holder's release deletes it. */
  release(key: string, holder: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined || !entry.holders.delete(holder) || entry.holders.size > 0) {
      return;
    }
    this.entries.delete(key);
    const removal = entry.snapshot
      .then(
        (snapshot) => {
          removeTree(snapshot.folder);
          this.options.log(`revisions: ${key.slice(0, 12)} removed after its last job`);
        },
        // One that could not be written was removed where it failed.
        () => undefined,
      )
      .catch((error: unknown) => {
        this.options.log(`revisions: ${key.slice(0, 12)} could not be removed now (${error instanceof Error ? error.message : String(error)}); it is removed at the next start`);
      })
      .finally(() => {
        if (this.removals.get(key) === removal) {
          this.removals.delete(key);
        }
      });
    this.removals.set(key, removal);
  }

  /** Wait for deletions under way (for checks and for quitting). */
  async settled(): Promise<void> {
    await Promise.all([...this.removals.values()]);
  }

  /** Who holds the pair's snapshot (for checks). */
  holders(key: string): readonly string[] {
    return [...(this.entries.get(key)?.holders ?? [])];
  }
}
