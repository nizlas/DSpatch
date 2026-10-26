import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  adoptPreferences,
  adoptStoredState,
  checkFileRequest,
  checkReference,
  checkStateForSave,
  emptyReviewState,
  parseDiff,
  parseNameStatus,
  parseReviewDefinition,
  splitLines,
  carryStepMarks,
  stepHashesOf,
  type ReviewPreferences,
  type ReviewStateNotice,
  type DiffFile,
  type ReviewBundle,
  type ReviewCommit,
  type ReviewFileOutcome,
  type ReviewOpenOutcome,
  type ReviewSearchHit,
  type ReviewState,
  type RevisionSide,
} from '../shared/review-model';

/**
 * The review surface's access to a repository: read-only git at two fixed commits.
 *
 * Everything is read from the object database by commit (`git show <sha>:<path>`,
 * `git diff <base> <target>`, `git ls-tree`, `git grep <sha>`), never from the
 * working tree, so what is shown is the revision named and nothing a checkout
 * happens to contain. Nothing here writes to the repository.
 *
 * The reviewer's record is kept apart, in DSpatch's own data directory, keyed by the
 * repository, the revision pair and the definition file. It is written whole to a
 * temporary file and renamed, so a crash leaves the previous record rather than half
 * of a new one.
 */

const MAX_BUFFER = 64 * 1024 * 1024;

function git(repository: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', '-C', repository, ...args],
      { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim() || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function gitBuffer(repository: string, args: readonly string[]): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', repository, ...args],
      { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (error !== null) {
          const text = stderr.toString('utf8');
          // `git show <sha>:<path>` for a path that is not in that commit.
          if (/does not exist in|exists on disk, but not in|bad revision|invalid object name|not a valid object name/i.test(text)) {
            resolve(null);
            return;
          }
          reject(new Error(`git ${args.join(' ')} failed: ${text.trim() || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function commit(repository: string, revision: string): Promise<ReviewCommit> {
  const out = await git(repository, ['log', '-1', '--format=%H%x00%s', `${revision}^{commit}`]);
  const [sha, subject] = out.trimEnd().split('\0');
  if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`"${revision}" is not a commit in ${repository}.`);
  }
  return { sha, subject: subject ?? '' };
}

export interface ReviewServiceOptions {
  /** Where review records are kept: DSpatch's data directory. */
  readonly recordsDir: string;
  readonly log: (message: string) => void;
}

/** One open review: its fixed revisions and a cache of file contents at them. */
interface OpenReview {
  readonly repository: string;
  readonly base: string;
  readonly target: string;
  readonly recordPath: string;
  readonly cache: Map<string, ReviewFileOutcome>;
}

export class ReviewService {
  private open: OpenReview | null = null;

  private readonly options: ReviewServiceOptions;

  constructor(options: ReviewServiceOptions) {
    this.options = options;
  }

  /** Read a definition file, resolve its revisions, compute the diff and validate every reference. */
  async openDefinition(definitionPath: string): Promise<ReviewOpenOutcome> {
    try {
      const absolute = path.resolve(definitionPath);
      const text = fs.readFileSync(absolute, 'utf8');
      const definitionHash = createHash('sha256').update(text).digest('hex');
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        return { kind: 'failed', error: `${absolute} is not valid JSON: ${String(error)}` };
      }
      const { definition, problems } = parseReviewDefinition(raw);
      if (definition === null) {
        return { kind: 'failed', error: problems.map((entry) => entry.problem).join(' ') };
      }
      const repository = path.resolve(path.dirname(absolute), definition.repository);
      const base = await commit(repository, definition.base);
      const target = await commit(repository, definition.target);
      const parent = (await git(repository, ['rev-list', '--parents', '-n', '1', target.sha])).trim().split(' ')[1];

      // No renames, external diff drivers or text conversion: the diff is of the stored bytes.
      const diffArgs = ['--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', base.sha, target.sha];
      const nameStatus = parseNameStatus(await git(repository, ['diff', '--name-status', '-z', ...diffArgs]));
      const unified = await git(repository, ['diff', '-U0', '--src-prefix=a/', '--dst-prefix=b/', ...diffArgs]);
      const files: DiffFile[] = [...parseDiff(nameStatus, unified)];

      const recordPath = path.join(
        this.options.recordsDir,
        `${createHash('sha256').update(`${repository}\0${base.sha}\0${target.sha}\0${absolute}`).digest('hex').slice(0, 24)}.json`,
      );
      this.open = { repository, base: base.sha, target: target.sha, recordPath, cache: new Map() };

      const referenceProblems: { stepId: string; refId: string; problem: string }[] = [];
      for (const walk of definition.walks) {
        for (const step of walk.steps) {
          for (const ref of step.refs) {
            const content = await this.readFile(ref.side, ref.path);
            const problem =
              content.kind === 'text'
                ? checkReference(ref, content.lines)
                : content.kind === 'missing'
                  ? checkReference(ref, null)
                  : `${ref.path} cannot be read at ${ref.side} (${content.kind === 'binary' ? 'binary' : content.error}).`;
            if (problem !== null) {
              referenceProblems.push({ stepId: step.id, refId: ref.id, problem });
            }
          }
        }
      }

      const revisions = { base: base.sha, target: target.sha };
      let state: ReviewState = emptyReviewState(revisions, absolute, definitionHash);
      let stateNotice: ReviewStateNotice | null = null;
      if (fs.existsSync(recordPath)) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
        } catch {
          parsed = null;
        }
        const stored = adoptStoredState(parsed, revisions);
        if (stored === null) {
          // Kept aside, never overwritten: it may be the only copy of someone's work.
          const aside = `${recordPath}.unusable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
          fs.renameSync(recordPath, aside);
          stateNotice = { kind: 'unusable', keptAs: aside };
        } else {
          state = stored;
          if (stored.definitionHash !== definitionHash) {
            // Said, not hidden: decisions and notes are about this revision pair and
            // stay as they are; opened and walked marks follow the step's content,
            // not its id, and the rest becomes history in the record.
            const carried = carryStepMarks(definition, stored, definitionHash, new Date().toISOString());
            stateNotice = { kind: 'definition-changed', carriedStepMarks: carried.carried, movedStepMarks: carried.moved };
            state = carried.state;
          }
        }
      }
      // The hashes always describe the definition in use, also for a record from before they existed.
      state = { ...state, stepHashes: stepHashesOf(definition) };
      this.options.log(
        `review opened: ${absolute} ${base.sha.slice(0, 7)}..${target.sha.slice(0, 7)} ` +
          `files=${String(files.length)} referenceProblems=${String(referenceProblems.length)}`,
      );
      return {
        kind: 'opened',
        bundle: {
          definitionPath: absolute,
          definitionHash,
          repository,
          base,
          target,
          singleCommit: parent === base.sha,
          definition: { ...definition, base: base.sha, target: target.sha },
          definitionProblems: problems,
          referenceProblems,
          files,
          state,
          stateNotice,
        } satisfies ReviewBundle,
      };
    } catch (error) {
      return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async readFile(side: RevisionSide, filePath: string): Promise<ReviewFileOutcome> {
    const open = this.open;
    if (open === null) {
      return { kind: 'failed', error: 'No review is open.' };
    }
    const invalid = checkFileRequest(side, filePath);
    if (invalid !== null) {
      return { kind: 'failed', error: invalid };
    }
    const key = `${side}:${filePath}`;
    const cached = open.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    let outcome: ReviewFileOutcome;
    try {
      const sha = side === 'base' ? open.base : open.target;
      // The stored blob, never a textconv rendering of it.
      const bytes = await gitBuffer(open.repository, ['cat-file', 'blob', `${sha}:${filePath}`]);
      if (bytes === null) {
        outcome = { kind: 'missing' };
      } else if (bytes.subarray(0, 8000).includes(0)) {
        outcome = { kind: 'binary' };
      } else {
        outcome = { kind: 'text', lines: splitLines(bytes.toString('utf8')) };
      }
    } catch (error) {
      outcome = { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    open.cache.set(key, outcome);
    return outcome;
  }

  async listFiles(side: RevisionSide): Promise<readonly string[]> {
    const open = this.open;
    if (open === null || (side !== 'base' && side !== 'target')) {
      return [];
    }
    const out = await git(open.repository, ['ls-tree', '-r', '-z', '--name-only', side === 'base' ? open.base : open.target]);
    return out.split('\0').filter((entry) => entry !== '');
  }

  async search(
    side: RevisionSide,
    query: string,
  ): Promise<{ hits: readonly ReviewSearchHit[]; truncated: boolean; error?: string }> {
    const open = this.open;
    if (open === null || typeof query !== 'string' || query.trim() === '') {
      return { hits: [], truncated: false };
    }
    if (side !== 'base' && side !== 'target') {
      return { hits: [], truncated: false, error: 'The revision side must be "base" or "target".' };
    }
    const sha = side === 'base' ? open.base : open.target;
    const out = await new Promise<{ stdout: string; error?: string }>((resolve) => {
      execFile(
        'git',
        ['-c', 'core.quotePath=false', '-C', open.repository, 'grep', '-n', '-I', '--fixed-strings', '--null', '-e', query, sha, '--'],
        { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
        (error, stdout, stderr) => {
          // `git grep` exits 1 when nothing matches: an empty answer, not a failure.
          if (error !== null && !(error.code === 1 && stderr.trim() === '')) {
            resolve({ stdout: '', error: stderr.trim() || error.message });
            return;
          }
          resolve({ stdout });
        },
      );
    });
    if (out.error !== undefined) {
      return { hits: [], truncated: false, error: out.error };
    }
    const hits: ReviewSearchHit[] = [];
    const limit = 500;
    for (const line of out.stdout.split('\n')) {
      if (line === '') {
        continue;
      }
      // `<sha>:<path>\0<line>\0<text>` — with `--null` git delimits both fields with NUL.
      const nul = line.indexOf('\0');
      const rest = line.slice(nul + 1);
      const second = rest.indexOf('\0');
      hits.push({
        path: line.slice(sha.length + 1, nul),
        line: Number(rest.slice(0, second)),
        text: rest.slice(second + 1),
      });
      if (hits.length >= limit) {
        return { hits, truncated: true };
      }
    }
    return { hits, truncated: false };
  }

  saveState(state: unknown): { saved: boolean; at: string; error?: string } {
    const open = this.open;
    const at = new Date().toISOString();
    if (open === null) {
      return { saved: false, at, error: 'No review is open.' };
    }
    try {
      const refused = checkStateForSave(state, { base: open.base, target: open.target });
      if (refused !== null) {
        return { saved: false, at, error: refused };
      }
      fs.mkdirSync(path.dirname(open.recordPath), { recursive: true });
      const temporary = `${open.recordPath}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ ...(state as ReviewState), savedAt: at }, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, open.recordPath);
      return { saved: true, at };
    } catch (error) {
      return { saved: false, at, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The reviewer's preferences, kept beside the review records. */
  getPreferences(): ReviewPreferences {
    try {
      return adoptPreferences(JSON.parse(fs.readFileSync(this.preferencesPath(), 'utf8')));
    } catch {
      return adoptPreferences(null);
    }
  }

  setPreferences(raw: unknown): { saved: boolean; error?: string } {
    const preferences = adoptPreferences(raw);
    if (JSON.stringify(preferences) !== JSON.stringify(raw)) {
      return { saved: false, error: 'Unknown preference value.' };
    }
    try {
      const file = this.preferencesPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(preferences, null, 2)}
`, 'utf8');
      fs.renameSync(`${file}.tmp`, file);
      return { saved: true };
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private preferencesPath(): string {
    return path.join(this.options.recordsDir, 'preferences.json');
  }
}
