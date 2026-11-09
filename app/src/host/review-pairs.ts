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
 * **One record per review** (DSP-186, Niclas's decision of 9 November 2026). Every review
 * has an id of its own, and its record, walks, discussion and positions are kept under it.
 * The diff window and every walk window of one review read and write that review's record.
 * Starting a review of a pair reviewed before starts a new, empty review; closing keeps a
 * review for reopening; deleting removes only that review's own files. A review recorded
 * before ids keeps its pair key as its id, so its files keep their names.
 */

import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  adoptPairRecord,
  emptyRecord,
  generationStale,
  isFullHash,
  isLegacyReviewId,
  isPairError,
  isReviewId,
  LOG_FORMAT_ARGS,
  pairFilesFrom,
  parseLog,
  reviewTotalsOf,
  scopeFrom,
  storedChecksFromDefinition,
  threadActionFrom,
  type CheckSource,
  type LineRange,
  type LineSide,
  type LogCommit,
  type MarkScope,
  type OngoingReview,
  type OpenPair,
  type PairDirection,
  type PairAnswer,
  type PairWalk,
  type PairMark,
  type PairPosition,
  type PairRecord,
  type ReviewRepository,
  type RevisionPairIdentity,
} from '../shared/review-pair';
import { ORIENTATION_DIFF_CHARS, type AnalysisMaterial, type WalkStepOutline } from '../shared/review-agent';
import { CHECKS_FILE_FORMAT, checksFileOf } from '../shared/review-model';
import { PRESENTATION_INSTRUCTION_VERSION } from '../shared/presentation-profiles';
import { reviewRecordKey } from '../main/review-service';
import { checkThreadId, reviewThreadsOf, reviewerOf, threadActionProblem } from '../shared/review-threads';

const MAX_BUFFER = 64 * 1024 * 1024;

/** Folders not worth looking into for a repository. */
const SKIPPED = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'target', 'vendor']);

/** How deep under a workspace folder a repository is looked for. */
const SEARCH_DEPTH = 2;

/** How many commits one page of the log holds. */
export const LOG_PAGE = 200;

/** A walk step as {@link ReviewPairs.stepOf} reads it, in both languages. */
export interface StepOfWalk {
  readonly walkTitle: { readonly sv: string; readonly en: string };
  readonly stepTitle: { readonly sv: string; readonly en: string };
  readonly summary: { readonly sv: string; readonly en: string };
  readonly body: { readonly sv: string; readonly en: string };
  readonly places: readonly LineRange[];
}

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

/** Run git for its exit status: 0 and 1 are answers; anything else is a failure. */
function gitStatus(repository: string, args: readonly string[]): Promise<0 | 1> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repository, ...args], { windowsHide: true, encoding: 'utf8' }, (error, _stdout, stderr) => {
      if (error === null) {
        resolve(0);
      } else if (error.code === 1) {
        resolve(1);
      } else {
        reject(new Error(stderr.trim() || error.message));
      }
    });
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

/** A repository-relative path that cannot leave the repository or name something odd. */
function safeRepositoryPath(filePath: string): boolean {
  return (
    filePath !== '' &&
    !filePath.includes('\0') &&
    !filePath.includes('\\') &&
    !filePath.startsWith('/') &&
    !/^[A-Za-z]:/.test(filePath) &&
    !filePath.split('/').some((segment) => segment === '..' || segment === '')
  );
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
  /**
   * `userData/reviews`: where a review's walks (`generated/<id>/`) and its discussion's
   * definition (`discussion/<id>.review.json`) are, and where the one backup taken before
   * review ids goes. The parent of `recordsDir` when not named.
   */
  readonly reviewsDir?: string;
  /** A review's record changed: every window of that review should read it again. */
  readonly changed: (key: string, record: PairRecord) => void;
  /** The instruction version current now, for whether walks were prepared with earlier settings. */
  readonly instructionVersion?: number;
}

/** A new review's id: never the form of a pair key, so it cannot meet a review recorded before ids. */
export function newReviewId(): string {
  return `r-${randomBytes(12).toString('hex')}`;
}

/**
 * The review a walk definition belongs to, by where DSpatch wrote it: a review's prepared
 * walks are in `generated/<id>/`, the definition carrying its discussion before any walk is
 * `discussion/<id>.review.json`. `null` for a definition that is not one of those, such as
 * one the person opened from a file.
 */
export function reviewOfDefinition(reviewsDir: string, definitionPath: unknown): string | null {
  if (typeof definitionPath !== 'string' || definitionPath === '') {
    return null;
  }
  const resolved = path.resolve(definitionPath);
  const parent = path.dirname(resolved);
  const same = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(path.dirname(parent), path.resolve(reviewsDir, 'generated'))) {
    const id = path.basename(parent);
    return isReviewId(id) ? id : null;
  }
  if (same(parent, path.resolve(reviewsDir, 'discussion'))) {
    const id = path.basename(resolved).replace(/\.review\.json$/i, '');
    return isReviewId(id) ? id : null;
  }
  return null;
}

/**
 * Every file and folder that is one review's own (DSP-186), for deleting it: its walks and
 * their points, the definition carrying its discussion, the discussion, its step
 * explanations, the discussion's working folder, the context it was given, and the record
 * of where each of its walk windows was. Not its pair record, which {@link ReviewPairs}
 * removes, and nothing outside `reviewsDir`.
 */
export function reviewArtefacts(reviewsDir: string, id: string): { readonly files: readonly string[]; readonly folders: readonly string[]; readonly definitions: readonly string[] } {
  if (!isReviewId(id)) {
    return { files: [], folders: [], definitions: [] };
  }
  const generated = path.join(reviewsDir, 'generated', id);
  const definitions: string[] = [];
  try {
    for (const name of fs.readdirSync(generated)) {
      if (name.endsWith('.review.json')) {
        definitions.push(path.join(generated, name));
      }
    }
  } catch {
    // No walks were prepared.
  }
  const placeholder = path.join(reviewsDir, 'discussion', `${id}.review.json`);
  if (fs.existsSync(placeholder)) {
    definitions.push(placeholder);
  }
  const files = [
    placeholder,
    path.join(reviewsDir, `${id}.discussion.json`),
    path.join(reviewsDir, `${id}.explanations.json`),
    path.join(reviewsDir, 'context', `${id}.json`),
  ];
  // Where each walk window of this review was: kept under the walk's repository, commits and definition.
  for (const definition of definitions) {
    try {
      const raw = JSON.parse(fs.readFileSync(definition, 'utf8')) as Record<string, unknown>;
      if (typeof raw['repository'] === 'string' && typeof raw['base'] === 'string' && typeof raw['target'] === 'string') {
        const repository = path.resolve(path.dirname(definition), raw['repository']);
        files.push(path.join(reviewsDir, `${reviewRecordKey(repository, raw['base'], raw['target'], definition)}.json`));
      }
    } catch {
      // A definition that cannot be read has no walk record to find.
    }
  }
  return { files: files.filter((file) => fs.existsSync(file)), folders: [generated, path.join(reviewsDir, 'discussion-cwd', id)].filter((folder) => fs.existsSync(folder)), definitions };
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

  /** Open reviews by id, so a later window of the same review gets the same files. */
  private readonly open = new Map<string, OpenPair>();

  /** The diff of each pair, read once, whichever of its reviews asked. */
  private readonly diffs = new Map<string, Omit<OpenPair, 'key' | 'record'>>();

  /**
   * Reviews deleted in this run (DSP-186): nothing is written for them again, so an agent's
   * late answer cannot bring one back.
   */
  private readonly deleted = new Set<string>();

  /** Whether the backup before the first record in the new form has been seen to. */
  private backupChecked = false;

  constructor(options: ReviewPairsOptions) {
    this.options = options;
  }

  private reviewsDir(): string {
    return this.options.reviewsDir ?? path.dirname(this.options.recordsDir);
  }

  private instructionVersion(): number {
    return this.options.instructionVersion ?? PRESENTATION_INSTRUCTION_VERSION;
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

  /**
   * Which of two chosen commits is From: the one that is an ancestor of the other. Only
   * Git's ancestry decides. Two commits on separate branches, or a history too shallow or
   * unreadable to tell, are left to the person.
   */
  async direction(repository: unknown, first: unknown, second: unknown): Promise<PairAnswer<PairDirection>> {
    const folder = this.repositoryOf(repository);
    if (folder === null) {
      return { error: 'That folder is not one of the repositories offered for review.' };
    }
    if (!isFullHash(first) || !isFullHash(second)) {
      return { error: 'A review needs two full commit hashes.' };
    }
    if (first === second) {
      return { error: 'From and To are the same commit, so there is no change to review.' };
    }
    try {
      if ((await gitStatus(folder, ['merge-base', '--is-ancestor', first, second])) === 0) {
        return { kind: 'ordered', base: first, target: second };
      }
      if ((await gitStatus(folder, ['merge-base', '--is-ancestor', second, first])) === 0) {
        return { kind: 'ordered', base: second, target: first };
      }
      const shallow = (await git(folder, ['rev-parse', '--is-shallow-repository'])).trim() === 'true';
      return shallow
        ? { kind: 'unknown', reason: 'This clone has only part of the history, so Git cannot tell which commit came first.' }
        : { kind: 'unrelated' };
    } catch {
      return { kind: 'unknown', reason: 'Git could not tell which commit came first.' };
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

  /**
   * Open a review (DSP-186). `{ review: id }` opens that review again, a closed one becoming
   * open; a repository and two commits start a new review of them, empty, with the current
   * settings, whatever reviews of the same pair there are.
   */
  async openPair(raw: unknown): Promise<PairAnswer<OpenPair>> {
    if (typeof raw !== 'object' || raw === null) {
      return { error: 'No revision pair was named.' };
    }
    const value = raw as Record<string, unknown>;
    if (value['review'] !== undefined) {
      return this.openReview(value['review'], true);
    }
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
    return this.startReview({ repository, base: value['base'], target: value['target'] });
  }

  /** A new review of a pair: its own id, an empty record written at once, the current settings. */
  private async startReview(pair: RevisionPairIdentity): Promise<PairAnswer<OpenPair>> {
    const diff = await this.diffOf(pair);
    if (isPairError(diff)) {
      return diff;
    }
    const id = newReviewId();
    const now = new Date().toISOString();
    const written = this.write(id, emptyRecord(pair, id, now, this.instructionVersion()), false, true);
    if (isPairError(written)) {
      return written;
    }
    this.rememberLastPair(pair);
    const opened: OpenPair = { ...diff, key: id, record: written };
    this.open.set(id, opened);
    return opened;
  }

  /** An existing review by its id; `reopen` makes a closed one open, as the person asked. */
  private async openReview(raw: unknown, reopen: boolean): Promise<PairAnswer<OpenPair>> {
    if (!isReviewId(raw) || this.deleted.has(raw)) {
      return { error: 'That review is not known. It may have been deleted.' };
    }
    const pair = this.storedPairOf(`${raw}.json`);
    if (pair === null) {
      return { error: 'That review is not known. It may have been deleted.' };
    }
    // The repository is read from the host's own record, which is why it may be admitted.
    this.admit(pair.repository);
    const opened = await this.load(raw, pair);
    if (isPairError(opened) || !reopen) {
      return opened;
    }
    this.rememberLastPair(pair);
    // Opening a closed review makes it open again; nothing else about it changes.
    if (opened.record.endedAt !== null) {
      const resumed = this.write(opened.key, { ...opened.record, endedAt: null }, false);
      return isPairError(resumed) ? opened : { ...opened, record: resumed };
    }
    return opened;
  }

  /** A review's files and record, its pair's diff read once per pair. */
  private async load(id: string, pair: RevisionPairIdentity): Promise<PairAnswer<OpenPair>> {
    const already = this.open.get(id);
    if (already !== undefined) {
      return { ...already, record: this.readRecord(id, pair) };
    }
    const diff = await this.diffOf(pair);
    if (isPairError(diff)) {
      return diff;
    }
    const opened: OpenPair = { ...diff, key: id, record: this.readRecord(id, pair) };
    this.open.set(id, opened);
    return opened;
  }

  /** The pair's commits and changed files, from Git, once per pair. */
  private async diffOf(pair: RevisionPairIdentity): Promise<PairAnswer<Omit<OpenPair, 'key' | 'record'>>> {
    const pairKey = pairKeyOf(pair);
    const known = this.diffs.get(pairKey);
    if (known !== undefined) {
      return known;
    }
    const repository = pair.repository;
    try {
      const [base, target] = await Promise.all([this.commitOf(repository, pair.base), this.commitOf(repository, pair.target)]);
      const common = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', pair.base, pair.target];
      const [nameStatus, patch] = await Promise.all([
        git(repository, [...common.slice(0, 5), '--name-status', '-z', ...common.slice(5)]),
        git(repository, [...common.slice(0, 5), '-U0', ...common.slice(5)]),
      ]);
      const diff = { pair, repositoryName: path.basename(repository), base, target, files: pairFilesFrom(nameStatus, patch) };
      this.diffs.set(pairKey, diff);
      return diff;
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
    // Any file of the chosen commits, read from Git (30 October 2026): a reference may lead
    // outside the change, and the reader may follow it there. Never the working copy.
    if (typeof filePath !== 'string' || !safeRepositoryPath(filePath)) {
      return { error: 'That is not a file of this repository.' };
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

  /**
   * A person's comment or decision in a review thread (DSP-175), kept under the thread's
   * identity and sent to every window of the review. The thread must exist in this
   * review's results. Nothing runs, no line is approved and no agent result changes.
   */
  thread(key: unknown, raw: unknown): PairAnswer<PairRecord> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    const request = threadActionFrom(raw);
    if ('error' in request) {
      return request;
    }
    const record = this.readRecord(opened.key, opened.pair);
    const thread = reviewThreadsOf(record).find((entry) => entry.id === request.threadId);
    if (thread === undefined) {
      return { error: 'That thread is not in this review.' };
    }
    const problem = threadActionProblem(thread, request.kind);
    if (problem !== null) {
      return { error: problem };
    }
    const event = { id: randomUUID(), kind: request.kind, at: new Date().toISOString(), text: request.text };
    const known = record.threads.some((entry) => entry.threadId === request.threadId);
    const threads = known
      ? record.threads.map((entry) => (entry.threadId === request.threadId ? { ...entry, events: [...entry.events, event] } : entry))
      : [...record.threads, { threadId: request.threadId, events: [event] }];
    return this.write(opened.key, { ...record, threads }, true);
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

  /**
   * Every review, open and closed, newest first (DSP-186): each review on disk whose
   * repository still exists. The repositories are read from the host's own records, which
   * is why they may be admitted here. Reading starts nothing and writes nothing.
   */
  async ongoing(): Promise<readonly OngoingReview[]> {
    let names: string[];
    try {
      names = fs.readdirSync(this.options.recordsDir).filter((name) => name.endsWith('.json') && isReviewId(name.slice(0, -'.json'.length)));
    } catch {
      return [];
    }
    const out: OngoingReview[] = [];
    for (const name of names) {
      const id = name.slice(0, -'.json'.length);
      const pair = this.storedPairOf(name);
      if (pair === null || this.deleted.has(id) || !fs.existsSync(pair.repository)) {
        continue;
      }
      this.admit(pair.repository);
      const opened = await this.load(id, pair);
      if (isPairError(opened)) {
        continue;
      }
      const record = opened.record;
      out.push({
        key: opened.key,
        closed: record.endedAt !== null,
        createdAt: record.createdAt,
        stale: generationStale(record, this.instructionVersion()),
        pair,
        repositoryName: opened.repositoryName,
        base: { hash: opened.base.hash, subject: opened.base.subject },
        target: { hash: opened.target.hash, subject: opened.target.subject },
        ...reviewTotalsOf(opened.files, record),
        savedAt: record.savedAt,
      });
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /**
   * Close a review: it is kept, listed as closed, for reopening. Its marks, jobs and walks
   * stay as they are; nothing is approved. Named by its id; a pair names the review recorded
   * for it before review ids.
   */
  end(raw: unknown): PairAnswer<{ readonly ended: true }> {
    const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const id =
      typeof raw === 'string'
        ? raw
        : typeof value['review'] === 'string'
          ? value['review']
          : typeof value['repository'] === 'string' && isFullHash(value['base']) && isFullHash(value['target'])
            ? pairKeyOf({ repository: value['repository'], base: value['base'], target: value['target'] })
            : null;
    if (id === null || !isReviewId(id)) {
      return { error: 'No review was named.' };
    }
    const stored = this.deleted.has(id) ? null : this.storedPairOf(`${id}.json`);
    if (stored === null) {
      return { error: 'That review is not known.' };
    }
    const record = this.readRecord(id, stored);
    const written = this.write(id, { ...record, endedAt: new Date().toISOString() }, true);
    return isPairError(written) ? written : { ended: true };
  }

  /**
   * Delete a review's record (DSP-186). From now on nothing is written for it in this run,
   * so a late agent answer cannot bring it back. Its other files are removed by the caller
   * from {@link reviewArtefacts}; no other review and nothing in a repository is touched.
   */
  remove(raw: unknown): PairAnswer<{ readonly deleted: true }> {
    if (!isReviewId(raw)) {
      return { error: 'No review was named.' };
    }
    const file = this.recordPath(raw);
    if (!fs.existsSync(file) && !this.open.has(raw)) {
      return { error: 'That review is not known.' };
    }
    const backup = this.ensureBackup();
    if (backup !== null) {
      return backup;
    }
    this.deleted.add(raw);
    this.open.delete(raw);
    try {
      fs.rmSync(file, { force: true });
    } catch (error) {
      return { error: `The review record could not be deleted: ${error instanceof Error ? error.message : String(error)}` };
    }
    return { deleted: true };
  }

  /** Whether a review may still be written: not deleted, and open in this host. */
  holds(key: string): boolean {
    return !this.deleted.has(key) && this.open.has(key) && (isLegacyReviewId(key) || fs.existsSync(this.recordPath(key)));
  }

  /**
   * The points worth checking of a walk definition over exactly this pair, read by the host
   * from the definition and its checks file and kept in the pair record (DSP-175), so they are
   * review threads every window shows with the same status. Called when a job wrote them
   * (`jobId`) and when a walk window joins the pair, so a walk prepared before adopts its
   * points without being prepared again. A point the person commented on or decided about
   * stays when the points are asked for again, retired from the walk. Writes only on a change.
   */
  adoptChecks(key: unknown, definitionPath: unknown, jobId?: string): void {
    const opened = this.openOf(key);
    if (opened === null || typeof definitionPath !== 'string' || definitionPath === '') {
      return;
    }
    const resolved = path.resolve(definitionPath);
    const owner = reviewOfDefinition(this.reviewsDir(), resolved);
    if (owner !== null && owner !== opened.key) {
      // Another review's walks: never this review's points.
      return;
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    const repository = typeof raw['repository'] === 'string' ? path.resolve(path.dirname(resolved), raw['repository']) : null;
    if (repository === null || folderIdentity(repository) !== folderIdentity(opened.pair.repository) || raw['base'] !== opened.pair.base || raw['target'] !== opened.pair.target) {
      return;
    }
    // Points asked for on their own replace those written with the walks, as the walk window shows them.
    let checksRaw: unknown = raw['checks'];
    let separate = false;
    try {
      const kept = JSON.parse(fs.readFileSync(checksFileOf(resolved), 'utf8')) as { format?: unknown; checks?: unknown };
      if (kept.format === CHECKS_FILE_FORMAT && Array.isArray(kept.checks)) {
        checksRaw = kept.checks;
        separate = true;
      }
    } catch {
      // No checks file, or one that cannot be read: the definition's own points hold.
    }
    const checks = storedChecksFromDefinition(checksRaw, safeRepositoryPath);
    const record = this.readRecord(opened.key, opened.pair);
    const sources = record.checkSources ?? [];
    const before = sources.find((source) => folderIdentity(source.definitionPath) === folderIdentity(resolved));
    if (before === undefined && checks.length === 0) {
      return;
    }
    const engaged = new Set(record.threads.filter((entry) => entry.events.length > 0).map((entry) => entry.threadId));
    const now = new Set(checks.map(checkThreadId));
    const retired = (before?.checks ?? [])
      .filter((check) => !now.has(checkThreadId(check)) && engaged.has(checkThreadId(check)))
      .map((check) => ({ ...check, retired: true }));
    // Who prepared them: the job named, else the latest job over this definition that could have.
    const over = (job: (typeof record.jobs)[number]): boolean => job.definitionPath !== null && folderIdentity(job.definitionPath) === folderIdentity(resolved);
    const job =
      (jobId === undefined ? undefined : record.jobs.find((entry) => entry.id === jobId)) ??
      [...record.jobs].reverse().find((entry) => entry.state === 'done' && entry.kind === (separate ? 'checks' : 'walks') && over(entry));
    const next: CheckSource = {
      definitionPath: resolved,
      jobId: job?.id ?? before?.jobId ?? null,
      reviewer: job === undefined ? (before?.reviewer ?? '') : reviewerOf(job),
      at: jobId !== undefined ? new Date().toISOString() : (before?.at ?? job?.endedAt ?? ''),
      checks: [...checks, ...retired],
    };
    if (before !== undefined && JSON.stringify({ ...before, at: '' }) === JSON.stringify({ ...next, at: '' })) {
      return;
    }
    const written = before === undefined ? [...sources, next] : sources.map((source) => (source === before ? next : source));
    this.write(opened.key, { ...record, checkSources: written }, true);
  }

  /** The walk definition just opened from this review, for the next *Code walks*. */
  walkOpened(key: unknown, definitionPath: unknown): void {
    const opened = this.openOf(key);
    if (opened === null || typeof definitionPath !== 'string') {
      return;
    }
    const record = this.readRecord(opened.key, opened.pair);
    if (record.walkDefinition !== definitionPath) {
      this.write(opened.key, { ...record, walkDefinition: definitionPath }, false);
    }
  }

  /**
   * Which walk *Code walks* opens, among the walks over the pair: the one last opened
   * from this review, else the first offered (the newest prepared one comes first).
   */
  walkToOpen(key: unknown, walks: readonly PairWalk[]): string | null {
    const opened = this.openOf(key);
    if (opened === null || walks.length === 0) {
      return null;
    }
    const last = this.readRecord(opened.key, opened.pair).walkDefinition;
    const again = last === null ? undefined : walks.find((walk) => folderIdentity(walk.definitionPath) === folderIdentity(last));
    return (again ?? walks[0])?.definitionPath ?? null;
  }

  /**
   * The pair a stored review record names, when the file is that review's record: a record
   * written with review ids names its id; one written before is under its pair's key.
   */
  private storedPairOf(name: string): RevisionPairIdentity | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.options.recordsDir, name), 'utf8')) as Record<string, unknown>;
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
      const stored = raw['pair'];
      if (typeof stored !== 'object' || stored === null) {
        return null;
      }
      const value = stored as Record<string, unknown>;
      if (typeof value['repository'] !== 'string' || !isFullHash(value['base']) || !isFullHash(value['target'])) {
        return null;
      }
      const pair: RevisionPairIdentity = { repository: value['repository'], base: value['base'], target: value['target'] };
      if (raw['version'] === 2 && typeof raw['id'] === 'string') {
        return raw['id'] === id && isReviewId(id) ? pair : null;
      }
      return raw['version'] === 1 && `${pairKeyOf(pair)}.json` === name ? pair : null;
    } catch {
      return null;
    }
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

  /**
   * A review's record. A missing one is empty. One that cannot be read as JSON is moved
   * aside (`<id>.json.corrupt-<time>`), never overwritten by the next save (DSP-186).
   */
  private readRecord(key: string, pair: RevisionPairIdentity): PairRecord {
    const file = this.recordPath(key);
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return emptyRecord(pair, key);
    }
    try {
      return adoptPairRecord(JSON.parse(text) as unknown, pair, key);
    } catch {
      try {
        fs.renameSync(file, `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      } catch {
        // Left where it is; the next save is refused below rather than writing over it.
      }
      return emptyRecord(pair, key);
    }
  }

  /**
   * Once, before the first record is written in the form with review ids: a copy of every
   * pair record as it was, beside them in `backup-<time>-pre-review-ids` (DSP-186). Only when
   * there is a record of the earlier form to keep, and never again once a backup exists.
   * `null` when writing may go on; the reason when the backup failed, so nothing is written.
   */
  private ensureBackup(): { readonly error: string } | null {
    if (this.backupChecked) {
      return null;
    }
    const parent = this.reviewsDir();
    try {
      if (fs.readdirSync(parent).some((name) => /^backup-.*-pre-review-ids$/.test(name))) {
        this.backupChecked = true;
        return null;
      }
    } catch {
      // No reviews folder yet: nothing to keep.
    }
    let earlier = false;
    try {
      for (const name of fs.readdirSync(this.options.recordsDir)) {
        if (!name.endsWith('.json') || !isLegacyReviewId(name.slice(0, -'.json'.length))) {
          continue;
        }
        try {
          if ((JSON.parse(fs.readFileSync(path.join(this.options.recordsDir, name), 'utf8')) as Record<string, unknown>)['version'] === 1) {
            earlier = true;
            break;
          }
        } catch {
          // An unreadable record is copied with the rest when there is a backup to take.
        }
      }
    } catch {
      this.backupChecked = true;
      return null;
    }
    if (!earlier) {
      this.backupChecked = true;
      return null;
    }
    const target = path.join(parent, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-pre-review-ids`);
    try {
      fs.cpSync(this.options.recordsDir, target, { recursive: true, filter: (source) => !source.endsWith('.tmp') });
    } catch (error) {
      return { error: `The review records could not be backed up before their first change, so nothing was saved: ${error instanceof Error ? error.message : String(error)}` };
    }
    this.backupChecked = true;
    return null;
  }

  private writeFile(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  }

  /**
   * Save a review's record. Nothing is written for a deleted review, nor for a review with
   * ids whose record is gone (`creating` only when it is first written), so a late answer
   * cannot make one appear again.
   */
  private write(key: string, record: PairRecord, announce: boolean, creating = false): PairAnswer<PairRecord> {
    if (this.deleted.has(key) || (!creating && !isLegacyReviewId(key) && !fs.existsSync(this.recordPath(key)))) {
      return { error: 'That review was deleted, so nothing was saved.' };
    }
    const backup = this.ensureBackup();
    if (backup !== null) {
      return backup;
    }
    const saved: PairRecord = { ...record, version: 2, id: key, savedAt: new Date().toISOString() };
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
  async openForWalk(pair: RevisionPairIdentity, definitionPath?: unknown, review?: unknown): Promise<PairAnswer<OpenPair>> {
    this.admit(pair.repository);
    // DSP-186: the review the window belongs to; else the one the walk was written for; else,
    // for a walk from a file, the review of this pair recorded under its pair key.
    const id = isReviewId(review) ? review : (reviewOfDefinition(this.reviewsDir(), definitionPath) ?? pairKeyOf(pair));
    let opened: PairAnswer<OpenPair>;
    if (fs.existsSync(this.recordPath(id))) {
      const stored = this.storedPairOf(`${id}.json`);
      if (stored === null || folderIdentity(stored.repository) !== folderIdentity(pair.repository) || stored.base !== pair.base || stored.target !== pair.target) {
        return { error: 'That walk is about other commits than its review.' };
      }
      opened = await this.openReview(id, true);
    } else if (isLegacyReviewId(id) && id === pairKeyOf(pair)) {
      // Nothing recorded for this pair yet: an empty review under its key, written on its first change.
      this.deleted.delete(id);
      const repository = this.repositoryOf(pair.repository) ?? pair.repository;
      opened = await this.load(id, { ...pair, repository });
    } else {
      return { error: 'The review this walk belongs to is not known. It may have been deleted.' };
    }
    // DSP-175: the walk's points worth checking become the review's threads, read here from the file.
    if (isPairError(opened) || typeof definitionPath !== 'string') {
      return opened;
    }
    this.adoptChecks(opened.key, definitionPath);
    return { ...opened, record: this.readRecord(opened.key, opened.pair) };
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
      const owner = reviewOfDefinition(this.reviewsDir(), resolved);
      if (owner !== null && owner !== opened.key) {
        // DSP-186: another review's walks are never offered here, however exactly they match the pair.
        continue;
      }
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
          const provenance = raw['provenance'];
          const note =
            raw['teachingMode'] === 'Generated' && typeof provenance === 'object' && provenance !== null
              ? String((provenance as Record<string, unknown>)['en'] ?? '').split('. ')[0] ?? ''
              : '';
          walks.push({ definitionPath: resolved, title: text, note });
        }
      } catch {
        // Not a readable walk definition.
      }
    }
    return walks;
  }

  /**
   * One step of a walk definition over exactly this pair (DSP-152), for a question about
   * it: its texts in both languages and the places it points at. Read here from the file,
   * never taken from a window; a definition over other commits is refused.
   */
  stepOf(key: unknown, definitionPath: unknown, walkId: unknown, stepId: unknown): PairAnswer<StepOfWalk> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    if (typeof definitionPath !== 'string' || typeof walkId !== 'string' || typeof stepId !== 'string') {
      return { error: 'That step is not known.' };
    }
    const owner = reviewOfDefinition(this.reviewsDir(), definitionPath);
    if (owner !== null && owner !== opened.key) {
      return { error: 'That walk belongs to another review.' };
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(path.resolve(definitionPath), 'utf8')) as Record<string, unknown>;
    } catch {
      return { error: 'The walk this step belongs to could not be read.' };
    }
    const repository = typeof raw['repository'] === 'string' ? path.resolve(path.dirname(path.resolve(definitionPath)), raw['repository']) : null;
    if (repository === null || folderIdentity(repository) !== folderIdentity(opened.pair.repository) || raw['base'] !== opened.pair.base || raw['target'] !== opened.pair.target) {
      return { error: 'That walk is about other commits than this review.' };
    }
    const both = (value: unknown): { readonly sv: string; readonly en: string } => {
      if (typeof value === 'string') {
        return { sv: value, en: value };
      }
      const entry = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
      const en = typeof entry['en'] === 'string' ? entry['en'] : '';
      const sv = typeof entry['sv'] === 'string' ? entry['sv'] : '';
      return { sv: sv || en, en: en || sv };
    };
    const walks = Array.isArray(raw['walks']) ? (raw['walks'] as unknown[]) : [];
    const walk = walks.find((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>)['id'] === walkId);
    const steps = walk !== undefined && Array.isArray(walk['steps']) ? (walk['steps'] as unknown[]) : [];
    const step = steps.find((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>)['id'] === stepId);
    if (walk === undefined || step === undefined) {
      return { error: 'That step is not in its walk.' };
    }
    const places: LineRange[] = [];
    for (const place of Array.isArray(step['places']) ? (step['places'] as unknown[]) : []) {
      const focus = typeof place === 'object' && place !== null ? (place as Record<string, unknown>)['focus'] : null;
      const range = typeof focus === 'object' && focus !== null ? (focus as Record<string, unknown>) : null;
      if (
        range !== null &&
        (range['side'] === 'base' || range['side'] === 'target') &&
        typeof range['path'] === 'string' &&
        safeRepositoryPath(range['path']) &&
        Number.isInteger(range['start']) &&
        Number.isInteger(range['end'])
      ) {
        places.push({ kind: 'lines', side: range['side'], path: range['path'], start: range['start'] as number, end: range['end'] as number });
      }
    }
    return {
      walkTitle: both(walk['title']),
      stepTitle: both(step['title']),
      summary: both(step['summary']),
      body: both(step['body']),
      places,
    };
  }

  /**
   * Every walk and step of a definition over exactly this pair, outlined in one language, for
   * asking what is worth checking beyond them (30 October 2026). Read with {@link stepOf}.
   */
  walksOf(key: unknown, definitionPath: unknown, language: 'sv' | 'en'): PairAnswer<readonly { readonly id: string; readonly title: string; readonly steps: readonly WalkStepOutline[] }[]> {
    if (typeof definitionPath !== 'string') {
      return { error: 'No walks were named.' };
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(path.resolve(definitionPath), 'utf8')) as Record<string, unknown>;
    } catch {
      return { error: 'The walks could not be read.' };
    }
    const outline: { id: string; title: string; steps: WalkStepOutline[] }[] = [];
    for (const walk of Array.isArray(raw['walks']) ? (raw['walks'] as unknown[]) : []) {
      const walkId = typeof walk === 'object' && walk !== null ? (walk as Record<string, unknown>)['id'] : null;
      const steps = typeof walk === 'object' && walk !== null && Array.isArray((walk as Record<string, unknown>)['steps']) ? ((walk as Record<string, unknown>)['steps'] as unknown[]) : [];
      const entry: { id: string; title: string; steps: WalkStepOutline[] } = { id: typeof walkId === 'string' ? walkId : '', title: '', steps: [] };
      for (const step of steps) {
        const stepId = typeof step === 'object' && step !== null ? (step as Record<string, unknown>)['id'] : null;
        const read = this.stepOf(key, definitionPath, walkId, stepId);
        if (isPairError(read)) {
          return read;
        }
        entry.title = read.walkTitle[language];
        entry.steps.push({ id: String(stepId), title: read.stepTitle[language], summary: read.summary[language], places: read.places });
      }
      if (entry.steps.length > 0) {
        outline.push(entry);
      }
    }
    return outline.length === 0 ? { error: 'Those walks have no steps to look beyond.' } : outline;
  }

  /**
   * A file's lines at one of the pair's commits, for checking a reference (DSP-152): any
   * file of that commit, not only a changed one, since a walk may lead through unchanged
   * code. `null` when the path does not exist there or is not text.
   */
  async linesAt(key: string, side: LineSide, filePath: string): Promise<readonly string[] | null> {
    const opened = this.openOf(key);
    if (opened === null || !safeRepositoryPath(filePath)) {
      return null;
    }
    try {
      const commit = side === 'base' ? opened.pair.base : opened.pair.target;
      const buffer = await gitBuffer(opened.pair.repository, ['cat-file', 'blob', `${commit}:${filePath}`]);
      if (buffer.subarray(0, 8000).includes(0)) {
        return null;
      }
      const lines = buffer.toString('utf8').split('\n');
      if (lines.at(-1) === '') {
        lines.pop();
      }
      return lines.map((line) => line.replace(/\r$/, ''));
    } catch {
      return null;
    }
  }

  /**
   * What the agent is told about the pair at the start (DSP-152): the change, its changed
   * lines and the unified diff between the two commits for orientation, each file's diff
   * whole or not at all, up to {@link ORIENTATION_DIFF_CHARS}. The agent reads the
   * revisions themselves from the folder `RevisionSnapshots` writes; this bound limits only
   * the opening diff.
   *
   * Read with `git diff` between the two commits only. Repository content reaches the model
   * through this diff and through the agent's own reads of the revision folder; DSpatch
   * excludes nothing from either today (see `RevisionSnapshots`).
   */
  async material(key: string): Promise<PairAnswer<AnalysisMaterial>> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    let patch: string;
    try {
      patch = await git(opened.pair.repository, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-U3', opened.pair.base, opened.pair.target]);
    } catch (error) {
      return { error: `The change could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
    const chunks = patch.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith('diff --git '));
    const shown: string[] = [];
    const diffLeftOut: string[] = [];
    let used = 0;
    for (const chunk of chunks) {
      if (used + chunk.length <= ORIENTATION_DIFF_CHARS) {
        shown.push(chunk);
        used += chunk.length;
      } else {
        const header = /^diff --git a\/(.*?) b\/(.*)$/m.exec(chunk);
        diffLeftOut.push(header?.[2] ?? header?.[1] ?? '(a file)');
      }
    }
    return {
      pair: opened.pair,
      repositoryName: opened.repositoryName,
      baseSubject: opened.base.subject,
      targetSubject: opened.target.subject,
      files: opened.files,
      diff: shown.join('').trimEnd(),
      diffLeftOut,
    };
  }

  /**
   * DSP-152: the finished code questions about one step of a walk definition, with their
   * answers, from the record of whichever open pair holds them. For the discussion's context.
   */
  stepAnswers(definitionPath: string, stepId: string): readonly { readonly question: string; readonly answer: string }[] {
    const wanted = folderIdentity(definitionPath);
    for (const opened of this.open.values()) {
      const record = this.readRecord(opened.key, opened.pair);
      const answers = record.jobs.flatMap((job) =>
        job.kind === 'explain' &&
        job.state === 'done' &&
        job.answer !== undefined &&
        !job.answer.insufficient &&
        job.question !== undefined &&
        job.question.stepId === stepId &&
        folderIdentity(job.question.definitionPath) === wanted
          ? [{ question: job.question.question, answer: job.answer.answer }]
          : [],
      );
      if (answers.length > 0) {
        return answers.slice(-3);
      }
    }
    return [];
  }

  /** Change a pair's record and tell every window over it. */
  update(key: string, change: (record: PairRecord) => PairRecord): PairAnswer<PairRecord> {
    const opened = this.openOf(key);
    if (opened === null) {
      return { error: 'That review is not open.' };
    }
    return this.write(opened.key, change(this.readRecord(opened.key, opened.pair)), true);
  }

  /** The open review under an id, if any. */
  opened(key: string): OpenPair | null {
    return this.open.get(key) ?? null;
  }

  /**
   * A review's stored record, read without opening it; an empty one when there is none, or
   * when the record is of another pair than `pair`.
   */
  storedRecord(key: string, pair: RevisionPairIdentity): PairRecord {
    if (!isReviewId(key) || this.deleted.has(key)) {
      return emptyRecord(pair, '');
    }
    return this.readRecord(key, pair);
  }

  /** Whether walks of this review were prepared with earlier settings than the current ones. */
  stale(key: string): boolean {
    const opened = this.open.get(key);
    return opened !== undefined && generationStale(this.readRecord(key, opened.pair), this.instructionVersion());
  }
}
