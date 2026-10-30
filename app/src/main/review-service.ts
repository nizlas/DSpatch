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
  stepsWalks,
  type CodeLocation,
  type Lang,
  type ReviewDefinition,
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
import {
  EVIDENCE_LABEL_TEXT,
  PROVIDER_ADDED_CONTEXT_LINE,
  type DiscussionRequest,
  type DiscussionSubject,
  type EnvelopeExplanation,
  type EnvelopeNote,
  type EnvelopeOutcome,
  type EnvelopeOverview,
  type EnvelopeQuote,
  type EnvelopeRange,
  type EnvelopeRangeRole,
} from '../shared/review-discussion';
import type { ReviewIdentity } from '../shared/review-host-contract';
import { checkedQuote, envelopeRange } from '../shared/review-envelope-read';
import { CHECKS_FILE_FORMAT, checksFileOf } from '../shared/review-model';

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

/**
 * A git command that failed, with what is needed to say why: git's own text, and
 * whether git ran at all. `execFile` gives a string `code` (`ENOENT`, `EACCES`) when
 * the process could not be started, and the exit status as a number when it ran.
 */
class GitFailure extends Error {
  readonly stderr: string;
  readonly couldNotStart: boolean;

  constructor(message: string, stderr: string, couldNotStart: boolean) {
    super(message);
    this.stderr = stderr;
    this.couldNotStart = couldNotStart;
  }
}

/**
 * A review that could not be opened: a plain message for the window, and the
 * technical text behind it (git's own words) kept apart for a closed Details.
 */
class ReviewOpenError extends Error {
  readonly detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

function git(repository: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', '-C', repository, ...args],
      { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            new GitFailure(
              `git ${args.join(' ')} failed: ${stderr.trim() || error.message}`,
              stderr.trim(),
              typeof (error as NodeJS.ErrnoException).code === 'string',
            ),
          );
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
  let out: string;
  try {
    out = await git(repository, ['log', '-1', '--format=%H%x00%s', `${revision}^{commit}`]);
  } catch (error) {
    throw await missingRevision(repository, revision, error);
  }
  const [sha, subject] = out.trimEnd().split('\0');
  if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`"${revision}" is not a commit in ${repository}.`);
  }
  return { sha, subject: subject ?? '' };
}

/**
 * Why a revision the definition names could not be read, in plain words (DSP-129).
 *
 * A review is of its two named revisions or of nothing: nothing is offered in their
 * place, neither another pair nor the working tree. The message says which cause it
 * is - the folder is missing, git cannot run, the folder is not a repository, git
 * cannot read it (for instance `safe.directory`), a shallow clone, or a history
 * without the revision - and git's own text goes to the detail, never the message.
 */
async function missingRevision(repository: string, revision: string, error: unknown): Promise<ReviewOpenError> {
  const raw = error instanceof Error ? error.message : String(error);
  const nothingElse = 'nothing else is shown in their place.';
  if (!fs.existsSync(repository)) {
    return new ReviewOpenError(
      `The review's repository, ${repository}, does not exist, so the revision "${revision}" it names cannot be read. ` +
        `This review needs a full clone that contains both of its revisions; ${nothingElse}`,
      raw,
    );
  }
  const gitCannotRun = (): ReviewOpenError =>
    new ReviewOpenError(
      `Git could not be started (git was not found on PATH, or could not run), so the revision "${revision}" in ${repository} cannot be read. ` +
        `Make git available and open the review again; ${nothingElse}`,
      raw,
    );
  if (error instanceof GitFailure && error.couldNotStart) {
    return gitCannotRun();
  }
  try {
    await git(repository, ['rev-parse', '--git-dir']);
  } catch (probe) {
    if (probe instanceof GitFailure && probe.couldNotStart) {
      return gitCannotRun();
    }
    const probeText = probe instanceof GitFailure ? probe.stderr : String(probe);
    const detail = `${raw}\n${probe instanceof Error ? probe.message : String(probe)}`;
    if (/not a git repository/i.test(probeText)) {
      return new ReviewOpenError(
        `The review's repository, ${repository}, is not a git repository, so the revision "${revision}" it names cannot be read. ` +
          `This review needs a full clone that contains both of its revisions; ${nothingElse}`,
        detail,
      );
    }
    return new ReviewOpenError(
      `Git could not read the repository at ${repository}, so the revision "${revision}" it names cannot be read; git's reason is under Details. ` +
        'Nothing else is shown in their place.',
      detail,
    );
  }
  const shallow = await git(repository, ['rev-parse', '--is-shallow-repository']).then(
    (answer) => answer.trim() === 'true',
    () => false,
  );
  if (shallow) {
    return new ReviewOpenError(
      `The revision "${revision}" is not in ${repository}, which is a shallow clone holding only part of its history. ` +
        `The review needs a full clone with both of its revisions (git fetch --unshallow completes this one); ${nothingElse}`,
      raw,
    );
  }
  return new ReviewOpenError(
    `The revision "${revision}" that this review names is not in the repository at ${repository}. ` +
      `The review needs a full clone that contains both of its revisions, not a shallow one or a copy without its history; ${nothingElse}`,
    raw,
  );
}

/** The identity of one review; defined in the host contract, which carries it. */
export type { ReviewIdentity };

/** The record key for an identity, as the record file is named. */
export function reviewRecordKey(repository: string, base: string, target: string, definitionPath: string): string {
  return createHash('sha256').update(`${repository}\0${base}\0${target}\0${definitionPath}`).digest('hex').slice(0, 24);
}

export interface ReviewServiceOptions {
  /** Where review records are kept: DSpatch's data directory. */
  readonly recordsDir: string;
  readonly log: (message: string) => void;
  /**
   * DSP-152: the answers the agent gave to code questions about a step of a walk over a
   * revision pair, from the pair's record, for the discussion's context. Absent: none.
   */
  readonly stepAnalysis?: (definitionPath: string, stepId: string) => readonly { readonly question: string; readonly answer: string }[];
}

/**
 * One open review: its fixed revisions, the definition it was opened with, the
 * reviewer's record as last saved, and a cache of file contents at the revisions.
 */
interface OpenReview {
  readonly definitionPath: string;
  readonly definitionHash: string;
  readonly repository: string;
  readonly base: string;
  readonly target: string;
  readonly baseSubject: string;
  readonly targetSubject: string;
  readonly recordPath: string;
  readonly cache: Map<string, ReviewFileOutcome>;
  /** As opened, with the revisions resolved to full commits. */
  readonly definition: ReviewDefinition;
  readonly files: readonly DiffFile[];
  /** The record as opened, then as last saved: what a discussion reads the notes from. */
  state: ReviewState;
}

function isLocation(value: unknown): value is CodeLocation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const location = value as Record<string, unknown>;
  const start = location['start'];
  const end = location['end'];
  return (
    checkFileRequest(location['side'], location['path']) === null &&
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 1 &&
    end >= start
  );
}

/** Only the four fields of a location: nothing else the window sent travels on. */
function cleanLocation(location: CodeLocation): CodeLocation {
  return { path: location.path, side: location.side, start: location.start, end: location.end };
}

function overlaps(a: CodeLocation, b: CodeLocation): boolean {
  return a.path === b.path && a.side === b.side && a.start <= b.end && b.start <= a.end;
}

/**
 * A definition with the points worth checking that were asked for on their own, when there
 * are any: they replace those written with the walks. A file that cannot be read changes nothing.
 */
function withSeparateChecks(raw: unknown, definitionPath: string): unknown {
  const file = checksFileOf(definitionPath);
  if (typeof raw !== 'object' || raw === null || !fs.existsSync(file)) {
    return raw;
  }
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8')) as { format?: unknown; checks?: unknown };
    return kept.format === CHECKS_FILE_FORMAT && Array.isArray(kept.checks) ? { ...raw, checks: kept.checks } : raw;
  } catch {
    return raw;
  }
}

export class ReviewService {
  private open: OpenReview | null = null;

  /**
   * Every review this service has opened, by record key. A window that switches to
   * another review can still be saving the one it showed before; that save goes to
   * the record it names (its revisions and definition), never to whichever review
   * happens to be open now.
   */
  private readonly opened = new Map<string, OpenReview>();

  private readonly options: ReviewServiceOptions;

  constructor(options: ReviewServiceOptions) {
    this.options = options;
  }

  /**
   * Which review a definition file names, without opening it: the definition is read
   * and its two revisions resolved, nothing more. Lets the window registry find a
   * window that already has this review before a second one is opened on it.
   */
  async identify(definitionPath: string): Promise<{ readonly identity: ReviewIdentity } | { readonly error: string }> {
    try {
      const absolute = path.resolve(definitionPath);
      const { definition, problems } = parseReviewDefinition(JSON.parse(fs.readFileSync(absolute, 'utf8')));
      if (definition === null) {
        return { error: problems.map((entry) => entry.problem).join(' ') };
      }
      const repository = path.resolve(path.dirname(absolute), definition.repository);
      const base = await commit(repository, definition.base);
      const target = await commit(repository, definition.target);
      return {
        identity: {
          key: reviewRecordKey(repository, base.sha, target.sha, absolute),
          definitionPath: absolute,
          repository,
          base: base.sha,
          target: target.sha,
        },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
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
      // Points worth checking asked for on their own (30 October 2026) are kept beside the
      // definition and read with it; the definition and its hash stay as they were written.
      const { definition, problems } = parseReviewDefinition(withSeparateChecks(raw, absolute));
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

      const recordKey = reviewRecordKey(repository, base.sha, target.sha, absolute);
      const recordPath = path.join(this.options.recordsDir, `${recordKey}.json`);
      const opened: OpenReview = {
        definitionPath: absolute,
        definitionHash,
        repository,
        base: base.sha,
        target: target.sha,
        baseSubject: base.subject,
        targetSubject: target.subject,
        recordPath,
        cache: new Map(),
        definition: { ...definition, base: base.sha, target: target.sha },
        files,
        state: emptyReviewState({ base: base.sha, target: target.sha }, absolute, definitionHash),
      };
      this.open = opened;
      this.opened.set(recordKey, opened);

      const referenceProblems: { stepId: string; refId: string; problem: string }[] = [];
      // The points' own tours are checked like walks: a tour points at code too.
      for (const walk of stepsWalks(definition)) {
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
      opened.state = state;
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
      if (error instanceof ReviewOpenError) {
        return { kind: 'failed', error: error.message, detail: error.detail };
      }
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

  /**
   * `writeFailed` tells a record that could not be written from one that was refused;
   * the host turns it into a `save-failed` answer and keeps it off the contract.
   */
  saveState(state: unknown): { saved: boolean; at: string; error?: string; writeFailed?: true } {
    const open = this.recordFor(state);
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
      open.state = { ...(state as ReviewState), savedAt: at };
      return { saved: true, at };
    } catch (error) {
      return { saved: false, at, error: error instanceof Error ? error.message : String(error), writeFailed: true };
    }
  }

  /**
   * The open review a record to save belongs to: the one with its revisions and
   * definition, else the current one (which the check below then judges).
   */
  private recordFor(state: unknown): OpenReview | null {
    if (typeof state === 'object' && state !== null) {
      const record = state as { revisions?: { base?: unknown; target?: unknown }; definitionPath?: unknown };
      for (const candidate of this.opened.values()) {
        if (
          candidate.base === record.revisions?.base &&
          candidate.target === record.revisions?.target &&
          candidate.definitionPath === record.definitionPath
        ) {
          return candidate;
        }
      }
    }
    return this.open;
  }

  /**
   * What a question about the open review is sent with, built here in main from the
   * definition, the reviewer's last saved record and code read from git at the fixed
   * commits: never from the working tree, and never from text the window sends.
   *
   * This is where repository bytes become model context. Nothing is excluded today;
   * a content-exclusion check belongs here, before an envelope exists.
   */
  async envelopeFor(request: unknown): Promise<EnvelopeOutcome> {
    const open = this.open;
    if (open === null) {
      return { kind: 'refused', error: 'No review is open.' };
    }
    if (typeof request !== 'object' || request === null) {
      return { kind: 'refused', error: 'The question has no subject.' };
    }
    const raw = request as Partial<Record<keyof DiscussionRequest, unknown>>;
    const selectionRaw = raw.selection ?? null;
    if (selectionRaw !== null && !isLocation(selectionRaw)) {
      return { kind: 'refused', error: 'The selected lines are not a valid location in this review.' };
    }
    const selection = selectionRaw === null ? null : cleanLocation(selectionRaw);
    const language: Lang = raw.language === 'sv' || raw.language === 'en' ? raw.language : this.getPreferences().language;
    const subjectRaw = typeof raw.subject === 'object' && raw.subject !== null ? (raw.subject as Record<string, unknown>) : null;
    const definition = open.definition;
    const notes = open.state.notes;
    const near = (note: (typeof notes)[number], location: CodeLocation): boolean =>
      note.location !== null && (overlaps(note.location, location) || (selection !== null && overlaps(note.location, selection)));
    const ranges: { role: EnvelopeRangeRole; location: CodeLocation }[] = [];
    let subject: DiscussionSubject;
    let explanation: EnvelopeExplanation | null = null;
    let overview: EnvelopeOverview | null = null;
    let relevantNotes: typeof notes = [];

    if (subjectRaw?.['kind'] === 'point') {
      const walks = stepsWalks(definition);
      const walkIndex = walks.findIndex((walk) => walk.id === subjectRaw['walkId']);
      const walk = walks[walkIndex];
      if (walk === undefined) {
        return { kind: 'refused', error: `This review has no walk "${String(subjectRaw['walkId'])}".` };
      }
      const step = walk.steps.find((candidate) => candidate.id === subjectRaw['stepId']);
      if (step === undefined) {
        return { kind: 'refused', error: `Walk "${walk.id}" has no step "${String(subjectRaw['stepId'])}".` };
      }
      const placeIndex = subjectRaw['placeIndex'];
      const place = typeof placeIndex === 'number' && Number.isInteger(placeIndex) ? step.places[placeIndex] : undefined;
      if (place === undefined || typeof placeIndex !== 'number') {
        return { kind: 'refused', error: `Step "${step.id}" has no place ${String(placeIndex)}.` };
      }
      // Asked from a point worth checking: its reasoning and places go along (30 October 2026).
      const check = typeof subjectRaw['checkId'] === 'string' ? (definition.checks.find((entry) => entry.id === subjectRaw['checkId']) ?? null) : null;
      if (typeof subjectRaw['checkId'] === 'string' && check === null) {
        return { kind: 'refused', error: `This review has no point to check "${subjectRaw['checkId']}".` };
      }
      subject = { kind: 'point', walkId: walk.id, stepId: step.id, placeIndex, ...(check === null ? {} : { checkId: check.id }) };
      ranges.push({ role: 'focus', location: place.focus });
      for (const checkPlace of check?.places ?? []) {
        ranges.push({ role: 'context', location: checkPlace });
      }
      if (place.unit !== null) {
        ranges.push({ role: 'unit', location: place.unit.ref });
        if (place.unit.counterpart !== null) {
          ranges.push({ role: 'counterpart', location: place.unit.counterpart });
        }
      }
      for (const context of place.context) {
        ranges.push({ role: 'context', location: context });
      }
      // DSP-152: the step's other places too, so a deepening has the whole step's code.
      step.places.forEach((other, index) => {
        if (index !== placeIndex) {
          ranges.push({ role: 'context', location: other.focus });
        }
      });
      explanation = {
        walkNumber: walkIndex + 1,
        walkTitle: walk.title[language],
        stepTitle: step.title[language],
        summary: step.summary[language],
        body: step.body[language],
        why: step.why[language],
        placeLabel: place.label[language],
        evidence: step.evidence.map((entry) => ({
          label: entry.label,
          labelText: EVIDENCE_LABEL_TEXT[language][entry.label],
          text: entry.text[language],
        })),
        ...((): { analysis?: readonly { readonly question: string; readonly answer: string }[] } => {
          const analysis = this.options.stepAnalysis?.(open.definitionPath, step.id) ?? [];
          return analysis.length === 0 ? {} : { analysis };
        })(),
        ...(check === null ? {} : { check: { id: check.id, kind: check.kind, title: check.title[language], reasoning: check.reasoning[language] } }),
      };
      relevantNotes = notes.filter((note) => note.stepId === step.id || near(note, place.focus));
    } else if (subjectRaw?.['kind'] === 'away') {
      const location = subjectRaw['location'];
      if (!isLocation(location)) {
        return { kind: 'refused', error: 'The code location asked about is not a valid location in this review.' };
      }
      const clean = cleanLocation(location);
      subject = { kind: 'away', location: clean };
      ranges.push({ role: 'location', location: clean });
      relevantNotes = notes.filter((note) => near(note, clean));
    } else if (subjectRaw?.['kind'] === 'review') {
      subject = { kind: 'review' };
      overview = {
        summary: definition.overviewSummary[language],
        walkTitles: definition.walks.map((walk) => walk.title[language]),
        changedFiles: open.files.map((file) => ({ path: file.path, status: file.status })),
      };
      // A question about the whole review is about every note in it.
      relevantNotes = notes;
    } else {
      return { kind: 'refused', error: 'The question is not about a point, a code location or the review as a whole.' };
    }
    if (selection !== null) {
      ranges.push({ role: 'selection', location: selection });
    }
    const quote = await this.quoteOf(open, raw.quote ?? null);
    if (quote !== null && 'error' in quote) {
      return { kind: 'refused', error: quote.error };
    }

    const read: EnvelopeRange[] = [];
    for (const { role, location } of ranges) {
      read.push(await this.rangeOf(open, role, location));
    }
    const envelopeNotes: EnvelopeNote[] = relevantNotes.map((note) => ({
      kind: note.kind,
      status: note.status,
      text: note.text,
      resolution: note.resolution,
      location: note.location,
      stepId: note.stepId,
    }));
    return {
      kind: 'built',
      envelope: {
        version: 1,
        identity: {
          title: definition.title[language],
          definitionPath: open.definitionPath,
          definitionHash: open.definitionHash,
          repository: open.repository,
          base: { sha: open.base, subject: open.baseSubject },
          target: { sha: open.target, subject: open.targetSubject },
        },
        language,
        subject,
        selection,
        explanation,
        overview,
        ranges: read,
        quote,
        notes: envelopeNotes,
        providerContext: PROVIDER_ADDED_CONTEXT_LINE,
        builtAt: new Date().toISOString(),
      },
    };
  }

  private quoteOf(open: OpenReview, raw: unknown): Promise<EnvelopeQuote | { readonly error: string } | null> {
    return checkedQuote(raw, (side, filePath) => this.readFile(side, filePath), (side) => (side === 'base' ? open.base : open.target));
  }

  private rangeOf(open: OpenReview, role: EnvelopeRangeRole, location: CodeLocation): Promise<EnvelopeRange> {
    return envelopeRange((side, filePath) => this.readFile(side, filePath), (side) => (side === 'base' ? open.base : open.target), role, location);
  }

  /** The reviewer's preferences, kept beside the review records. */
  getPreferences(): ReviewPreferences {
    try {
      return adoptPreferences(JSON.parse(fs.readFileSync(this.preferencesPath(), 'utf8')));
    } catch {
      return adoptPreferences(null);
    }
  }

  setPreferences(raw: unknown): { saved: boolean; error?: string; writeFailed?: true } {
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
      return { saved: false, error: error instanceof Error ? error.message : String(error), writeFailed: true };
    }
  }

  private preferencesPath(): string {
    return path.join(this.options.recordsDir, 'preferences.json');
  }
}
