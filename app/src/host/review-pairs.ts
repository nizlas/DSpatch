/**
 * The host's side of reviewing a chosen revision pair (DSP-150).
 *
 * Everything that touches a repository is here, in the host: finding the Git
 * repositories of the workspace, reading a log, the diff between two commits, a file at
 * one of them, and the record of what the reviewer decided. The windows ask through the
 * contract and draw the answers; none of them runs git.
 *
 * **Exactly the two commits.** Text is read with `git cat-file` at the named commit and
 * the diff is computed between the two commits. Nothing is ever read from the working
 * copy, and nothing stands in for a revision that cannot be read.
 *
 * **One record per pair.** Decisions about a pair are kept under a key of the repository
 * and both full hashes, so the diff window and every walk window over the same pair read
 * and write one record, and a review of changed code starts empty instead of inheriting
 * approvals given to other code.
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  adoptPairRecord,
  emptyRecord,
  isFullHash,
  isPairError,
  LOG_FORMAT_ARGS,
  pairFilesFrom,
  parseLog,
  scopeFrom,
  type LogCommit,
  type MarkScope,
  type OpenPair,
  type PairAnswer,
  type PairWalk,
  type PairMark,
  type PairPosition,
  type PairRecord,
  type ReviewRepository,
  type ReviewRequirement,
  type RevisionPairIdentity,
} from '../shared/review-pair';

const MAX_BUFFER = 64 * 1024 * 1024;

/** Folders not worth looking into for a repository. */
const SKIPPED = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'target', 'vendor']);

/** How deep under a workspace folder a repository is looked for. */
const SEARCH_DEPTH = 2;

/** How many commits one page of the log holds. */
export const LOG_PAGE = 200;

function git(repository: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', '-C', repository, ...args],
      { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function gitBuffer(repository: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', repository, ...args],
      { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(stderr.toString('utf8').trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** The same folder however it was spelled: resolved, real, and case-blind on Windows. */
function folderIdentity(folder: string): string {
  let real = path.resolve(folder);
  try {
    real = fs.realpathSync.native(real);
  } catch {
    // A folder that cannot be resolved keeps its spelling.
  }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

export function pairKeyOf(pair: RevisionPairIdentity): string {
  return createHash('sha256')
    .update(`${folderIdentity(pair.repository)}\0${pair.base}\0${pair.target}`)
    .digest('hex')
    .slice(0, 24);
}

export interface ReviewPairsOptions {
  /** `userData/reviews/pairs`. */
  readonly recordsDir: string;
  /** A pair's record changed: every window over that pair should read it again. */
  readonly changed: (key: string, record: PairRecord) => void;
}

/** What a mark request may carry, checked before it is written. */
interface MarkRequest {
  readonly op: PairMark['op'];
  readonly scopes: readonly MarkScope[];
  readonly reason: string;
}

function markRequestFrom(raw: unknown): MarkRequest | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const op = value['op'];
  if (op !== 'manual' && op !== 'exempt' && op !== 'clear') {
    return null;
  }
  const scopes: MarkScope[] = [];
  for (const entry of Array.isArray(value['scopes']) ? value['scopes'] : []) {
    const scope = scopeFrom(entry);
    if (scope === null) {
      return null;
    }
    scopes.push(scope);
  }
  if (scopes.length === 0) {
    return null;
  }
  return { op, scopes, reason: typeof value['reason'] === 'string' ? value['reason'].slice(0, 2000) : '' };
}

export class ReviewPairs {
  private readonly options: ReviewPairsOptions;

  /** Repositories this host has offered or opened: the only ones a window may name. */
  private readonly known = new Map<string, string>();

  /** Open pairs by key, so a later window over the same pair gets the same files. */
  private readonly open = new Map<string, OpenPair>();

  constructor(options: ReviewPairsOptions) {
    this.options = options;
  }

  /**
   * The Git repositories of the workspace, each once, folders without Git left out.
   *
   * A folder inside a repository names that repository; a folder that holds
   * repositories (a checkout of several projects side by side) names each of them.
   */
  async repositories(folders: readonly string[]): Promise<readonly ReviewRepository[]> {
    const found = new Map<string, string>();
    const consider = async (folder: string): Promise<void> => {
      try {
        const top = (await git(folder, ['rev-parse', '--show-toplevel'])).trim();
        if (top !== '') {
          const resolved = path.resolve(top);
          found.set(folderIdentity(resolved), resolved);
        }
      } catch {
        // Not a repository.
      }
    };
    const walk = async (folder: string, depth: number): Promise<void> => {
      if (fs.existsSync(path.join(folder, '.git'))) {
        await consider(folder);
      }
      if (depth >= SEARCH_DEPTH) {
        return;
      }
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !SKIPPED.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(path.join(folder, entry.name), depth + 1);
        }
      }
    };
    for (const folder of folders) {
      if (!fs.existsSync(folder)) {
        continue;
      }
      await consider(folder);
      await walk(folder, 0);
    }
    const repositories = [...found.values()].map((repository) => ({ path: repository, name: path.basename(repository) }));
    // Two repositories with one folder name are told apart by their parent.
    const named = repositories.map((entry) =>
      repositories.filter((other) => other.name === entry.name).length > 1
        ? { ...entry, name: `${path.basename(path.dirname(entry.path))}/${entry.name}` }
        : entry,
    );
    named.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of named) {
      this.known.set(folderIdentity(entry.path), entry.path);
    }
    return named;
  }

  /** Let a repository be named, for one that came from a walk definition rather than the workspace. */
  admit(repository: string): void {
    this.known.set(folderIdentity(repository), path.resolve(repository));
  }

  private repositoryOf(raw: unknown): string | null {
    return typeof raw === 'string' ? (this.known.get(folderIdentity(raw)) ?? null) : null;
  }

  /** One page of the log of the repository's current branch, newest first. */
  async log(repository: unknown, skip: unknown): Promise<PairAnswer<{ readonly commits: readonly LogCommit[]; readonly more: boolean }>> {
    const folder = this.repositoryOf(repository);
    if (folder === null) {
      return { error: 'That folder is not one of the repositories offered for review.' };
    }
    const from = Number.isInteger(skip) && (skip as number) > 0 ? (skip as number) : 0;
    try {
      const text = await git(folder, [
        'log',
        `--skip=${String(from)}`,
        `--max-count=${String(LOG_PAGE + 1)}`,
        ...LOG_FORMAT_ARGS,
      ]);
      const commits = parseLog(text);
      return { commits: commits.slice(0, LOG_PAGE), more: commits.length > LOG_PAGE };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return /does not have any commits/i.test(message)
        ? { commits: [], more: false }
        : { error: `The log of ${path.basename(folder)} could not be read: ${message}` };
    }
  }

  private async commitOf(repository: string, hash: string): Promise<LogCommit> {
    const text = await git(repository, ['log', '-1', ...LOG_FORMAT_ARGS, `${hash}^{commit}`]);
    const [commit] = parseLog(text);
    if (commit === undefined || commit.hash !== hash) {
      throw new Error(`${hash.slice(0, 7)} is not a commit in ${path.basename(repository)}.`);
    }
    return commit;
  }

  /** Open the diff between exactly two commits, with its record. */
  async openPair(raw: unknown): Promise<PairAnswer<OpenPair>> {
    if (typeof raw !== 'object' || raw === null) {
      return { error: 'No revision pair was named.' };
    }
    const value = raw as Record<string, unknown>;
    const repository = this.repositoryOf(value['repository']);
    if (repository === null) {
      return { error: 'That folder is not one of the repositories offered for review.' };
    }
    if (!isFullHash(value['base']) || !isFullHash(value['target'])) {
      return { error: 'A review needs two full commit hashes.' };
    }
    if (value['base'] === value['target']) {
      return { error: 'From and To are the same commit, so there is no change to review.' };
    }
    const pair: RevisionPairIdentity = { repository, base: value['base'], target: value['target'] };
    const key = pairKeyOf(pair);
    const already = this.open.get(key);
    if (already !== undefined) {
      this.rememberLastPair(pair);
      return { ...already, record: this.readRecord(key, pair) };
    }
    try {
      const [base, target] = await Promise.all([this.commitOf(repository, pair.base), this.commitOf(repository, pair.target)]);
      const common = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', pair.base, pair.target];
      const [nameStatus, patch] = await Promise.all([
        git(repository, [...common.slice(0, 5), '--name-status', '-z', ...common.slice(5)]),
        git(repository, [...common.slice(0, 5), '-U0', ...common.slice(5)]),
      ]);
      const opened: OpenPair = {
        key,
        pair,
        repositoryName: path.basename(repository),
        base,
        target,
        files: pairFilesFrom(nameStatus, patch),
        record: this.readRecord(key, pair),
      };
      this.open.set(key, opened);
      this.rememberLastPair(pair);
      return opened;
    } catch (error) {
      return { error: `The change could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private openOf(key: unknown): OpenPair | null {
    return typeof key === 'string' ? (this.open.get(key) ?? null) : null;
  }

  /** A file's text at one of the two commits, or `binary: true` when it is not text. */
  async readFile(
    key: unknown,
    side: unknown,
    filePath: unknown,
  ): Promise<PairAnswer<{ readonly text: string | null; readonly binary: boolean }>> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    if (side !== 'base' && side !== 'target') {
      return { error: 'The side must be base or target.' };
    }
    const known = opened.files.some((file) => (side === 'base' ? file.oldPath : file.newPath) === filePath);
    if (typeof filePath !== 'string' || !known) {
      return { error: 'That file is not part of this change.' };
    }
    try {
      const commit = side === 'base' ? opened.pair.base : opened.pair.target;
      const buffer = await gitBuffer(opened.pair.repository, ['cat-file', 'blob', `${commit}:${filePath}`]);
      if (buffer.subarray(0, 8000).includes(0)) {
        return { text: null, binary: true };
      }
      return { text: buffer.toString('utf8'), binary: false };
    } catch (error) {
      return { error: `The file could not be read at ${side === 'base' ? 'From' : 'To'}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  state(key: unknown): PairAnswer<PairRecord> {
    const opened = this.openOf(key);
    return opened === null ? { error: 'That review is not open.' } : this.readRecord(opened.key, opened.pair);
  }

  /** Record one decision over one or more scopes, and tell every window over the pair. */
  mark(key: unknown, raw: unknown): PairAnswer<PairRecord> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    const request = markRequestFrom(raw);
    if (request === null) {
      return { error: 'That mark names no lines this review can hold.' };
    }
    const at = new Date().toISOString();
    const record = this.readRecord(opened.key, opened.pair);
    const marks: PairMark[] = request.scopes.map((scope) => ({ id: randomUUID(), op: request.op, scope, reason: request.reason, at }));
    return this.write(opened.key, { ...record, marks: [...record.marks, ...marks] }, true);
  }

  setRequirement(key: unknown, requirement: unknown): PairAnswer<PairRecord> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    if (requirement !== 'manual' && requirement !== 'manual-or-agent') {
      return { error: 'Unknown requirement.' };
    }
    const record = this.readRecord(opened.key, opened.pair);
    return this.write(opened.key, { ...record, requirement: requirement as ReviewRequirement }, true);
  }

  /** Where the diff window is. Not news to anyone else, so no other window is told. */
  savePosition(key: unknown, position: unknown): PairAnswer<{ readonly saved: true }> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    const record = this.readRecord(opened.key, opened.pair);
    const adopted = adoptPairRecord({ ...record, position }, opened.pair).position as PairPosition;
    const written = this.write(opened.key, { ...record, position: adopted }, false);
    return isPairError(written) ? written : { saved: true };
  }

  /** The pair last opened for a repository, so the log can offer it again. */
  lastPair(repository: unknown): { readonly base: string; readonly target: string } | null {
    const folder = this.repositoryOf(repository);
    if (folder === null) {
      return null;
    }
    const entry = this.readRecent()[folderIdentity(folder)];
    return entry === undefined ? null : entry;
  }

  private recentPath(): string {
    return path.join(this.options.recordsDir, 'recent.json');
  }

  private readRecent(): Record<string, { base: string; target: string }> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.recentPath(), 'utf8')) as unknown;
      if (typeof raw !== 'object' || raw === null) {
        return {};
      }
      const out: Record<string, { base: string; target: string }> = {};
      for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
        const value = entry as Record<string, unknown> | null;
        if (value !== null && isFullHash(value['base']) && isFullHash(value['target'])) {
          out[name] = { base: value['base'], target: value['target'] };
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  private rememberLastPair(pair: RevisionPairIdentity): void {
    const recent = { ...this.readRecent(), [folderIdentity(pair.repository)]: { base: pair.base, target: pair.target } };
    this.writeFile(this.recentPath(), recent);
  }

  private recordPath(key: string): string {
    return path.join(this.options.recordsDir, `${key}.json`);
  }

  private readRecord(key: string, pair: RevisionPairIdentity): PairRecord {
    try {
      return adoptPairRecord(JSON.parse(fs.readFileSync(this.recordPath(key), 'utf8')) as unknown, pair);
    } catch {
      return emptyRecord(pair);
    }
  }

  private writeFile(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  }

  private write(key: string, record: PairRecord, announce: boolean): PairAnswer<PairRecord> {
    const saved: PairRecord = { ...record, savedAt: new Date().toISOString() };
    try {
      this.writeFile(this.recordPath(key), saved);
    } catch (error) {
      return { error: `The review record could not be saved: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (announce) {
      this.options.changed(key, saved);
    }
    return saved;
  }

  /**
   * Open the pair a walk window is over, so its decisions go to the same record.
   *
   * The repository comes from the walk definition the host itself opened, never from a
   * window, which is why it may be admitted here.
   */
  async openForWalk(pair: RevisionPairIdentity): Promise<PairAnswer<OpenPair>> {
    this.admit(pair.repository);
    return this.openPair(pair);
  }

  /**
   * The walk definitions among `candidates` that are over exactly this pair.
   *
   * A walk belongs to one repository and one revision pair; one over other commits is
   * about other code and is not offered, however similar its name.
   */
  walksFor(key: unknown, candidates: readonly string[]): PairAnswer<readonly PairWalk[]> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    const walks: PairWalk[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (seen.has(folderIdentity(resolved))) {
        continue;
      }
      seen.add(folderIdentity(resolved));
      try {
        const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as Record<string, unknown>;
        const repository = typeof raw['repository'] === 'string' ? path.resolve(path.dirname(resolved), raw['repository']) : null;
        if (
          repository !== null &&
          folderIdentity(repository) === folderIdentity(opened.pair.repository) &&
          raw['base'] === opened.pair.base &&
          raw['target'] === opened.pair.target &&
          Array.isArray(raw['walks']) &&
          raw['walks'].length > 0
        ) {
          const title = raw['title'];
          const text =
            typeof title === 'string'
              ? title
              : typeof title === 'object' && title !== null
                ? String((title as Record<string, unknown>)['en'] ?? (title as Record<string, unknown>)['sv'] ?? path.basename(resolved))
                : path.basename(resolved);
          walks.push({ definitionPath: resolved, title: text });
        }
      } catch {
        // Not a readable walk definition.
      }
    }
    return walks;
  }

  /** The pair key of a walk definition's repository and revisions, for matching walks to a pair. */
  keyFor(pair: RevisionPairIdentity): string {
    return pairKeyOf(pair);
  }

  /** The open pair under a key, if any. */
  opened(key: string): OpenPair | null {
    return this.open.get(key) ?? null;
  }
}
