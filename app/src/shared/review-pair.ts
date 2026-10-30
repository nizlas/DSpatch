/**
 * Reviewing a chosen revision pair (DSP-150): the repository, the From and To commits,
 * the diff between them, and what the reviewer has decided about each changed line.
 *
 * Niclas's decision of 28 October 2026. A review starts from a repository and two
 * revisions, with no review definition and no provider call (VISION.md section 3.3). The
 * decisions are kept per revision pair rather than per walk, so a change several walks
 * pass through counts once, and the diff window and a walk window read one state.
 *
 * Pure functions and types only: the host runs git and keeps the record, the windows
 * draw what these functions derive. Nothing here reads the working copy.
 */

import { diffChars } from 'diff';

// --- Identity ------------------------------------------------------------------------

/** One Git repository found in the workspace, named by its folder. */
export interface ReviewRepository {
  /** The repository's top level, as Git reports it. */
  readonly path: string;
  /** The folder name, which is what the list shows. */
  readonly name: string;
}

/** One commit of the log, with what a traditional `git log` shows of it. */
export interface LogCommit {
  readonly hash: string;
  /** The message's first line. */
  readonly subject: string;
  /** The whole message, as written. */
  readonly message: string;
  readonly author: string;
  readonly email: string;
  /** ISO 8601, the author date. */
  readonly date: string;
  /** The author date as `git log` writes it (`--date=default`). */
  readonly dateText: string;
}

/** The `git log` arguments {@link parseLog} reads. */
export const LOG_FORMAT_ARGS: readonly string[] = ['--date=default', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%ad%x1f%B%x1e'];

/** The two revisions a review is of, both full commit hashes. */
export interface RevisionPairIdentity {
  readonly repository: string;
  readonly base: string;
  readonly target: string;
}

const FULL_HASH = /^[0-9a-f]{40}$/;

export function isFullHash(value: unknown): value is string {
  return typeof value === 'string' && FULL_HASH.test(value);
}

/** An open pair: its identity, its files and their record. */
export interface OpenPair {
  readonly key: string;
  readonly pair: RevisionPairIdentity;
  readonly repositoryName: string;
  readonly base: LogCommit;
  readonly target: LogCommit;
  readonly files: readonly PairFile[];
  readonly record: PairRecord;
}

/** A walk definition over exactly this pair, offered from the diff review. */
export interface PairWalk {
  readonly definitionPath: string;
  readonly title: string;
  /** Where it came from, in a line: who prepared it and when, for a generated one. */
  readonly note: string;
}

/** An agent review can use in this launch (DSP-152), and why not when it cannot. */
export interface ReviewAgentOption {
  readonly provider: 'cursor' | 'claude';
  readonly choosable: boolean;
  readonly reason: string | null;
}

/** An agent and model, as chosen; the model is the provider's id, never empty. */
export interface ReviewAgentChoice {
  readonly provider: 'cursor' | 'claude';
  readonly model: string;
}

/**
 * The agent and model a review's agent work starts from (DSP-152 fix after the first
 * live trial): the choice made in this review, else the one of the chat or loop editor
 * that opened it, else none. Never a provider or model DSpatch picks on its own.
 */
export interface ReviewAgentCurrent extends ReviewAgentChoice {
  /** `review`: chosen in this review; `opener`: taken from the window that opened it. */
  readonly from: 'review' | 'opener';
  /** Whether it can be used in this launch; when not, the picker asks for a choice. */
  readonly choosable: boolean;
  readonly reason: string | null;
}

/** What the picker starts from. */
export interface ReviewAgents {
  readonly options: readonly ReviewAgentOption[];
  readonly current: ReviewAgentCurrent | null;
}

/** What a window asks of the host to start agent work over the pair. */
export interface AgentJobRequestInput {
  readonly kind: 'walks' | 'review' | 'explain' | 'checks';
  readonly provider: 'cursor' | 'claude';
  readonly model: string;
  readonly scope?: DelegationScope;
  /** DSP-152, `explain`: the step (by its walk definition and ids) and the person's question. */
  readonly question?: { readonly definitionPath: string; readonly walkId: string; readonly stepId: string; readonly question: string };
  /** DSP-152, `explain`: code selected in the diff, as the window read it (the host checks it). */
  readonly selection?: CodeSelectionRequest;
  /** DSP-152, `explain`: a follow-up on an earlier explanation of a selection, by its first job. */
  readonly followUp?: { readonly root: string; readonly action: ExplainAction; readonly question?: string };
  /** `checks` (30 October 2026): the walk definition whose change is looked over. */
  readonly definitionPath?: string;
}

/** What a window sends for a selection: where it is, and the text it saw there. */
export interface CodeSelectionRequest {
  readonly fileKey: string;
  readonly layout: 'split' | 'unified';
  readonly segments: readonly Omit<SelectionSegment, 'text' | 'kind'>[];
  readonly text: string;
}

/** A host answer, or why there is none. */
export type PairAnswer<T> = T | { readonly error: string };

export function isPairError(value: unknown): value is { readonly error: string } {
  return typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string';
}

// --- The diff ------------------------------------------------------------------------

export type PairFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'type-changed';

/** One hunk, as `git diff -U0` numbers it: base lines removed, target lines added. */
export interface PairHunk {
  readonly baseStart: number;
  readonly baseCount: number;
  readonly targetStart: number;
  readonly targetCount: number;
}

export interface PairFile {
  /** Stable within the pair: the paths on both sides. */
  readonly key: string;
  readonly status: PairFileStatus;
  /** The path at From, or `null` for an added file. */
  readonly oldPath: string | null;
  /** The path at To, or `null` for a deleted file. */
  readonly newPath: string | null;
  /** Rename or copy similarity, as Git scored it. */
  readonly similarity: number | null;
  /** Git found no text to compare: a binary file, or one it would not diff as text. */
  readonly binary: boolean;
  readonly hunks: readonly PairHunk[];
  readonly added: number;
  readonly deleted: number;
}

export function fileKeyOf(oldPath: string | null, newPath: string | null): string {
  return `${oldPath ?? ''}→${newPath ?? ''}`;
}

/** The path a file is shown under: its path at To, or at From for a deleted file. */
export function shownPath(file: Pick<PairFile, 'oldPath' | 'newPath'>): string {
  return file.newPath ?? file.oldPath ?? '';
}

interface NameStatusEntry {
  readonly status: PairFileStatus;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly similarity: number | null;
}

/** `git diff -M --name-status -z` output. Renames and copies carry two paths. */
export function parsePairNameStatus(text: string): readonly NameStatusEntry[] {
  const parts = text.split('\0');
  const out: NameStatusEntry[] = [];
  let index = 0;
  while (index < parts.length) {
    const code = parts[index] ?? '';
    index += 1;
    if (code === '') {
      continue;
    }
    const letter = code.charAt(0);
    const score = code.length > 1 ? Number(code.slice(1)) : null;
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[index] ?? '';
      const newPath = parts[index + 1] ?? '';
      index += 2;
      out.push({
        status: letter === 'R' ? 'renamed' : 'copied',
        oldPath,
        newPath,
        similarity: score !== null && Number.isFinite(score) ? score : null,
      });
      continue;
    }
    const filePath = parts[index] ?? '';
    index += 1;
    if (letter === 'A') {
      out.push({ status: 'added', oldPath: null, newPath: filePath, similarity: null });
    } else if (letter === 'D') {
      out.push({ status: 'deleted', oldPath: filePath, newPath: null, similarity: null });
    } else if (letter === 'T') {
      out.push({ status: 'type-changed', oldPath: filePath, newPath: filePath, similarity: null });
    } else {
      out.push({ status: 'modified', oldPath: filePath, newPath: filePath, similarity: null });
    }
  }
  return out;
}

interface PatchSection {
  readonly binary: boolean;
  readonly hunks: readonly PairHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * `git diff -U0 -M` output, one section per `diff --git` header, in Git's order.
 *
 * Paths are taken from the name-status listing rather than from these headers, which
 * cannot be split reliably when a path holds a space. Git writes both in the same order
 * for the same options, and {@link pairFilesFrom} checks the counts agree.
 */
export function parsePatchSections(text: string): readonly PatchSection[] {
  const sections: { binary: boolean; hunks: PairHunk[] }[] = [];
  let current: { binary: boolean; hunks: PairHunk[] } | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { binary: false, hunks: [] };
      sections.push(current);
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      current.binary = true;
      continue;
    }
    const match = HUNK_HEADER.exec(line);
    if (match !== null) {
      current.hunks.push({
        baseStart: Number(match[1]),
        baseCount: match[2] === undefined ? 1 : Number(match[2]),
        targetStart: Number(match[3]),
        targetCount: match[4] === undefined ? 1 : Number(match[4]),
      });
    }
  }
  return sections;
}

/** The files of a pair, from the two Git listings. Throws when they disagree. */
export function pairFilesFrom(nameStatus: string, patch: string): readonly PairFile[] {
  const entries = parsePairNameStatus(nameStatus);
  const sections = parsePatchSections(patch);
  if (entries.length !== sections.length) {
    throw new Error(
      `Git listed ${String(entries.length)} changed files but wrote ${String(sections.length)} diff sections for them.`,
    );
  }
  return entries.map((entry, index) => {
    const section = sections[index] as PatchSection;
    let added = 0;
    let deleted = 0;
    for (const hunk of section.hunks) {
      added += hunk.targetCount;
      deleted += hunk.baseCount;
    }
    return {
      key: fileKeyOf(entry.oldPath, entry.newPath),
      status: entry.status,
      oldPath: entry.oldPath,
      newPath: entry.newPath,
      similarity: entry.similarity,
      binary: section.binary,
      hunks: section.hunks,
      added,
      deleted,
    };
  });
}

/** `git log` output in {@link LOG_FORMAT_ARGS}. */
export function parseLog(text: string): readonly LogCommit[] {
  const out: LogCommit[] = [];
  for (const record of text.split('\x1e')) {
    const trimmed = record.replace(/^\s+/, '');
    if (trimmed === '') {
      continue;
    }
    const [hash, author, email, date, dateText, ...rest] = trimmed.split('\x1f');
    if (!isFullHash(hash)) {
      continue;
    }
    const message = rest.join('\x1f').replace(/\s+$/, '');
    out.push({
      hash,
      author: author ?? '',
      email: email ?? '',
      date: date ?? '',
      dateText: dateText ?? '',
      message,
      subject: (message.split('\n')[0] ?? '').trim(),
    });
  }
  return out;
}

// --- Lines, marks and requirements --------------------------------------------------

export type LineSide = 'base' | 'target';

/** One changed line: a deletion on the From side or an addition on the To side. */
export interface ChangedLine {
  readonly side: LineSide;
  readonly path: string;
  readonly line: number;
}

/** Every changed line of a file: deletions first, then additions. Context is not here. */
export function changedLinesOf(file: PairFile): readonly ChangedLine[] {
  const lines: ChangedLine[] = [];
  for (const hunk of file.hunks) {
    if (file.oldPath !== null) {
      for (let line = hunk.baseStart; line < hunk.baseStart + hunk.baseCount; line += 1) {
        lines.push({ side: 'base', path: file.oldPath, line });
      }
    }
  }
  for (const hunk of file.hunks) {
    if (file.newPath !== null) {
      for (let line = hunk.targetStart; line < hunk.targetStart + hunk.targetCount; line += 1) {
        lines.push({ side: 'target', path: file.newPath, line });
      }
    }
  }
  return lines;
}

export function lineKey(line: Pick<ChangedLine, 'side' | 'path' | 'line'>): string {
  return `${line.side}\0${line.path}\0${String(line.line)}`;
}

/** A contiguous range of lines on one side of one path. */
export interface LineRange {
  readonly kind: 'lines';
  readonly side: LineSide;
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The whole of a file with no countable lines: binary, a pure rename, a mode change.
 *
 * The existing review model already decides about a whole file (a `DecisionScope` of
 * kind `file`); this is that scope for the files whose denominator is zero, so such a
 * file is done only after someone decided about it, never because nothing was counted.
 */
export interface WholeFile {
  readonly kind: 'file';
  readonly fileKey: string;
}

export type MarkScope = LineRange | WholeFile;

/**
 * One decision by the reviewer, in the order made.
 *
 * `clear` withdraws earlier decisions over its scope. The list is the history: nothing
 * is rewritten, and the latest decision about a line is the one that holds.
 */
export interface PairMark {
  readonly id: string;
  readonly op: 'manual' | 'exempt' | 'clear';
  readonly scope: MarkScope;
  readonly reason: string;
  readonly at: string;
}

/**
 * A review an agent actually performed and that was recorded with its result.
 *
 * Only such a record makes a line agent-reviewed. A walk passing a line, an explanation
 * about it or a discussion of it is not one. Nothing in DSpatch writes these yet: the
 * existing model reserves delegated agent review and refuses to save it, so this list is
 * read and drawn, and stays empty until a recorded agent review exists.
 */
export interface AgentReview {
  readonly id: string;
  readonly scope: LineRange;
  readonly reviewer: string;
  readonly recordedAt: string;
  readonly summary: string;
  /**
   * The delegated review this approval came from (DSP-152): the person's explicit mandate
   * for exactly this part. Absent on a record written before delegation existed.
   */
  readonly jobId?: string;
}

// --- Agent work over a pair (DSP-152) ----------------------------------------------------

/** Where a delegated review or a walk preparation stands. */
export type AgentJobState = 'running' | 'cancelling' | 'done' | 'failed' | 'cancelled' | 'unknown';

/** What the person delegated: lines of a file, a whole file, or the changed lines a walk covers. */
export interface DelegationScope {
  readonly kind: 'lines' | 'file' | 'walk';
  /** How the scope reads to a person: "src/keep.ts lines 8–9", "walk W1 · The user cancels". */
  readonly label: string;
  readonly ranges: readonly LineRange[];
}

/** Something the agent found, where it found it when it said. */
export interface AgentFinding {
  readonly severity: 'problem' | 'question' | 'note';
  readonly text: string;
  readonly location: LineRange | null;
}

/** What a delegated review reported, after DSpatch checked it against the scope. */
export interface DelegationResult {
  readonly assessment: string;
  /** The changed lines the agent says it reviewed, within the scope. */
  readonly reviewed: readonly LineRange[];
  /** The changed lines approved under the mandate, within the scope and reviewed. */
  readonly approved: readonly LineRange[];
  readonly findings: readonly AgentFinding[];
  readonly uncertainties: readonly string[];
  /** The agent said the material was not enough to judge; nothing is approved then. */
  readonly insufficient: boolean;
  /** What DSpatch changed in the agent's answer before recording it, in plain words. */
  readonly adjustments: readonly string[];
}

/**
 * A question about one step of a walk that the agent answers by looking into the code
 * (DSP-152): the step, the code it points at, and what the person asked.
 */
export interface StepQuestion {
  /** The walk definition the step belongs to. */
  readonly definitionPath: string;
  readonly walkId: string;
  readonly stepId: string;
  /** The step's title as the person saw it. */
  readonly stepTitle: string;
  /** What the person asked, in their words. */
  readonly question: string;
  /** The step's places at the pair's commits. */
  readonly places: readonly LineRange[];
}

/**
 * How selected code relates to the change: removed (only in From, the base commit), added
 * (only in To, the target commit) or unchanged (the same in both; read at the side it was
 * selected on).
 */
export type SelectedCodeKind = 'removed' | 'added' | 'unchanged';

/**
 * One run of selected lines on one side of the diff, all of one kind (DSP-152). `from` is
 * the 0-based character offset on `start` where the selection begins, `to` the 0-based
 * offset on `end` just after it ends; a whole line is `0` to its length. `text` is the
 * selected text as the host read it from the commit, not as the window drew it.
 */
export interface SelectionSegment {
  readonly side: LineSide;
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly from: number;
  readonly to: number;
  readonly kind: SelectedCodeKind;
  readonly text: string;
}

/** Code selected in the diff window for an explanation, checked against the commits. */
export interface CodeSelection {
  /** The diff's file the selection was made in. */
  readonly fileKey: string;
  /** The layout it was selected in; the segments do not depend on it. */
  readonly layout: 'split' | 'unified';
  readonly segments: readonly SelectionSegment[];
}

/** A follow-up on an explanation: tell more, explain more simply, or the person's question. */
export type ExplainAction = 'more' | 'simpler' | 'question';

/** What a follow-up job asks, and the explanation (its first job) it follows. */
export interface ExplainFollowUp {
  readonly root: string;
  readonly action: ExplainAction;
  /** For `question`: what the person asked. */
  readonly question: string;
}

/** The selected text, segment by segment, as one string. */
export function selectionText(selection: Pick<CodeSelection, 'segments'>): string {
  return selection.segments.map((segment) => segment.text).join('\n');
}

/** Where a segment is, in words: "src/a.ts line 4, characters 9–20 (To, added)". */
export function segmentWords(segment: Omit<SelectionSegment, 'text'>): string {
  const lines = segment.start === segment.end ? `line ${String(segment.start)}` : `lines ${String(segment.start)}–${String(segment.end)}`;
  const characters = segment.start === segment.end ? `, characters ${String(segment.from + 1)}–${String(segment.to)}` : '';
  const where = segment.kind === 'removed' ? 'From, removed' : segment.kind === 'added' ? 'To, added' : `${segment.side === 'base' ? 'From' : 'To'}, unchanged`;
  return `${segment.path} ${lines}${characters} (${where})`;
}

/** A code reference in an answer, checked against its commit. */
export interface AnswerReference {
  readonly label: string;
  readonly range: LineRange;
}

/** The answer to a step question, after DSpatch checked its references. */
export interface StepAnswer {
  /** Markdown: the explanation, written to the plan's rules. */
  readonly answer: string;
  /** Markdown: more detail, shown under Show more (30 October 2026). Absent on earlier answers. */
  readonly details?: string;
  /** References that exist at their commit. */
  readonly references: readonly AnswerReference[];
  /** The agent could not establish an answer from the code it could read. */
  readonly insufficient: boolean;
  /** What DSpatch left out of the answer, in plain words. */
  readonly adjustments: readonly string[];
}

/**
 * What the agent looked at while it worked (DSP-152), as its provider reported the tool
 * calls: files read and searches made, by their place in the revision folder (`target/…`,
 * `base/…`). Shown under Details; never content.
 */
export interface AgentInvestigation {
  readonly reads: readonly string[];
  readonly searches: readonly string[];
  /** Tool calls the provider reported as failed or refused. */
  readonly refused: number;
  /** Those calls, by tool and subject where known: not among `reads` or `searches`. */
  readonly refusedCalls?: readonly string[];
}

/** What the agent could read: the two commits as written for it, and what was left out. */
export interface AgentMaterial {
  readonly base: string;
  readonly target: string;
  readonly files: number;
  readonly skipped: readonly { readonly side: LineSide; readonly path: string; readonly reason: string }[];
  /** How many were left out in all; `skipped` names at most the first fifty. */
  readonly skippedCount: number;
}

/** One piece of agent work over the pair, from the press to its recorded outcome. */
export interface AgentJob {
  readonly id: string;
  /**
   * Walk preparation, a delegated review, a question about one step, or what is worth
   * checking over walks already written (asked for on its own since 30 October 2026).
   */
  readonly kind: 'walks' | 'review' | 'explain' | 'checks';
  readonly state: AgentJobState;
  readonly provider: 'cursor' | 'claude';
  readonly model: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** A plain sentence about the outcome, for the window. */
  readonly note: string;
  /** The provider's or SDK's own error text, when there was one, for the details only. */
  readonly detail: string;
  /** For a delegated review. */
  readonly scope: DelegationScope | null;
  readonly result: DelegationResult | null;
  /** For a walk preparation: the definition written, when one was. */
  readonly definitionPath: string | null;
  /** For a walk preparation: changed lines no walk covers, and references left out. */
  readonly uncovered: readonly LineRange[];
  /** For a step question: the question, and its checked answer once there is one. */
  readonly question?: StepQuestion;
  readonly answer?: StepAnswer;
  /** For an explanation of selected code: the selection, and for a follow-up what it asks. */
  readonly selection?: CodeSelection;
  readonly followUp?: ExplainFollowUp;
  /** What the agent could read, and what it looked at (DSP-152 analysis access). */
  readonly material?: AgentMaterial;
  readonly investigation?: AgentInvestigation;
  /**
   * While it runs: what the agent is doing now, from what it reports (30 October 2026),
   * for instance the file it reads or the part of its answer it writes. Not kept after.
   */
  readonly activity?: string;
}

/**
 * What counts as handled. Exempted lines are handled under both.
 *
 * `manual` (the default since DSP-152, Niclas's decision of 29 October 2026): the person's
 * review, or an agent's approval where the person explicitly delegated that part.
 * `manual-or-agent`: the DSP-150 default, kept as stored for a record that has it, so an
 * older review keeps its meaning; any recorded agent review counts there.
 */
export type ReviewRequirement = 'manual' | 'manual-or-agent';

export const DEFAULT_REQUIREMENT: ReviewRequirement = 'manual';

/** Where the diff window was, so reopening puts the reviewer back. */
export interface PairPosition {
  readonly view: 'files' | 'file';
  readonly fileKey: string | null;
  readonly layout: 'split' | 'unified';
  /** The first changed line shown, side and number, when one is known. */
  readonly line: { readonly side: LineSide; readonly line: number } | null;
}

export const START_POSITION: PairPosition = { view: 'files', fileKey: null, layout: 'split', line: null };

export interface PairRecord {
  readonly version: 1;
  readonly pair: RevisionPairIdentity;
  readonly requirement: ReviewRequirement;
  readonly marks: readonly PairMark[];
  readonly agentReviews: readonly AgentReview[];
  /** Walk preparations and delegated reviews, newest last (DSP-152). */
  readonly jobs: readonly AgentJob[];
  /** The agent and model last chosen in this review for its agent work, or `null`. */
  readonly agent: ReviewAgentChoice | null;
  readonly position: PairPosition;
  /**
   * The walk definition last opened from this review, so *Code walks* opens it again at
   * the position its own record keeps. `null` until one is opened.
   */
  readonly walkDefinition: string | null;
  /**
   * When the person ended this review: it leaves the list of ongoing reviews. Ending
   * approves nothing and deletes nothing; opening the pair again makes it ongoing again.
   */
  readonly endedAt: string | null;
  readonly savedAt: string;
}

export function emptyRecord(pair: RevisionPairIdentity): PairRecord {
  return {
    version: 1,
    pair,
    requirement: DEFAULT_REQUIREMENT,
    marks: [],
    agentReviews: [],
    jobs: [],
    agent: null,
    position: START_POSITION,
    walkDefinition: null,
    endedAt: null,
    savedAt: new Date(0).toISOString(),
  };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rangeFrom(raw: unknown): LineRange | null {
  if (!isRecordObject(raw) || raw['kind'] !== 'lines') {
    return null;
  }
  const { side, path, start, end } = raw;
  if ((side !== 'base' && side !== 'target') || typeof path !== 'string' || path === '') {
    return null;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number)) {
    return null;
  }
  return { kind: 'lines', side, path, start: start as number, end: end as number };
}

function rangesFrom(raw: unknown): LineRange[] {
  const out: LineRange[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const range = rangeFrom(entry);
    if (range !== null) {
      out.push(range);
    }
  }
  return out;
}

function stringsFrom(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];
}

const JOB_STATES: readonly AgentJobState[] = ['running', 'cancelling', 'done', 'failed', 'cancelled', 'unknown'];

/** A stored job, or `null` for one too broken to show. */
/**
 * Before the fix of 29 October 2026 a failure put the provider's raw text inside the note
 * itself and kept no detail. Such a note is split as a new one is written: the short
 * meaning in the note, the provider's own words in the detail.
 */
const LEGACY_FAILURES: readonly { readonly prefix: string; readonly note: string }[] = [
  { prefix: 'The agent could not be asked: ', note: 'The agent could not be asked. Nothing was approved.' },
  { prefix: 'The agent did not finish: ', note: 'The agent did not finish. Nothing was approved.' },
];
const LEGACY_END = '. Nothing was approved.';

function splitLegacyNote(note: string, detail: string): { readonly note: string; readonly detail: string } {
  if (detail !== '' || !note.endsWith(LEGACY_END)) {
    return { note, detail };
  }
  const legacy = LEGACY_FAILURES.find((entry) => note.startsWith(entry.prefix));
  return legacy === undefined ? { note, detail } : { note: legacy.note, detail: note.slice(legacy.prefix.length, note.length - LEGACY_END.length) };
}

function questionFrom(raw: unknown): StepQuestion | null {
  if (!isRecordObject(raw)) {
    return null;
  }
  const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  if (text('definitionPath') === '' || text('stepId') === '') {
    return null;
  }
  return {
    definitionPath: text('definitionPath'),
    walkId: text('walkId'),
    stepId: text('stepId'),
    stepTitle: text('stepTitle'),
    question: text('question'),
    places: rangesFrom(raw['places']),
  };
}

function answerFrom(raw: unknown): StepAnswer | null {
  if (!isRecordObject(raw) || typeof raw['answer'] !== 'string') {
    return null;
  }
  return {
    answer: raw['answer'],
    ...(typeof raw['details'] === 'string' && raw['details'].trim() !== '' ? { details: raw['details'] } : {}),
    references: (Array.isArray(raw['references']) ? raw['references'] : []).filter(isRecordObject).flatMap((entry) => {
      const range = rangeFrom(entry['range']);
      return range === null ? [] : [{ label: typeof entry['label'] === 'string' ? entry['label'] : '', range }];
    }),
    insufficient: raw['insufficient'] === true,
    adjustments: stringsFrom(raw['adjustments']),
  };
}

function selectionFrom(raw: unknown): CodeSelection | null {
  if (!isRecordObject(raw) || typeof raw['fileKey'] !== 'string' || !Array.isArray(raw['segments'])) {
    return null;
  }
  const segments = raw['segments'].filter(isRecordObject).flatMap((entry): SelectionSegment[] => {
    // A segment's `kind` says how it relates to the change; its place reads as a line range.
    const range = rangeFrom({ ...entry, kind: 'lines' });
    const kind = entry['kind'];
    if (range === null || (kind !== 'removed' && kind !== 'added' && kind !== 'unchanged')) {
      return [];
    }
    const offset = (key: string): number => (Number.isInteger(entry[key]) ? (entry[key] as number) : 0);
    return [{ side: range.side, path: range.path, start: range.start, end: range.end, from: offset('from'), to: offset('to'), kind, text: typeof entry['text'] === 'string' ? entry['text'] : '' }];
  });
  return segments.length === 0 ? null : { fileKey: raw['fileKey'], layout: raw['layout'] === 'unified' ? 'unified' : 'split', segments };
}

function followUpFrom(raw: unknown): ExplainFollowUp | null {
  if (!isRecordObject(raw) || typeof raw['root'] !== 'string' || (raw['action'] !== 'more' && raw['action'] !== 'simpler' && raw['action'] !== 'question')) {
    return null;
  }
  return { root: raw['root'], action: raw['action'], question: typeof raw['question'] === 'string' ? raw['question'] : '' };
}

function materialFrom(raw: unknown): AgentMaterial | null {
  if (!isRecordObject(raw) || typeof raw['base'] !== 'string' || typeof raw['target'] !== 'string') {
    return null;
  }
  const skipped = (Array.isArray(raw['skipped']) ? raw['skipped'] : []).filter(isRecordObject).flatMap((entry) =>
    (entry['side'] === 'base' || entry['side'] === 'target') && typeof entry['path'] === 'string'
      ? [{ side: entry['side'] as LineSide, path: entry['path'], reason: typeof entry['reason'] === 'string' ? entry['reason'] : '' }]
      : [],
  );
  return {
    base: raw['base'],
    target: raw['target'],
    files: Number.isInteger(raw['files']) ? (raw['files'] as number) : 0,
    skipped,
    skippedCount: Number.isInteger(raw['skippedCount']) ? (raw['skippedCount'] as number) : skipped.length,
  };
}

function investigationFrom(raw: unknown): AgentInvestigation | null {
  if (!isRecordObject(raw)) {
    return null;
  }
  return {
    reads: stringsFrom(raw['reads']),
    searches: stringsFrom(raw['searches']),
    refused: Number.isInteger(raw['refused']) ? (raw['refused'] as number) : 0,
    refusedCalls: stringsFrom(raw['refusedCalls']),
  };
}

export function jobFrom(raw: unknown): AgentJob | null {
  if (!isRecordObject(raw) || typeof raw['id'] !== 'string' || (raw['kind'] !== 'walks' && raw['kind'] !== 'review' && raw['kind'] !== 'explain' && raw['kind'] !== 'checks')) {
    return null;
  }
  // A job is always written with the agent it was started with; one without a known
  // agent cannot be attributed, and is not given one.
  if (raw['provider'] !== 'claude' && raw['provider'] !== 'cursor') {
    return null;
  }
  const state = JOB_STATES.includes(raw['state'] as AgentJobState) ? (raw['state'] as AgentJobState) : 'unknown';
  const scopeRaw = raw['scope'];
  const scope: DelegationScope | null =
    isRecordObject(scopeRaw) && (scopeRaw['kind'] === 'lines' || scopeRaw['kind'] === 'file' || scopeRaw['kind'] === 'walk')
      ? { kind: scopeRaw['kind'], label: typeof scopeRaw['label'] === 'string' ? scopeRaw['label'] : '', ranges: rangesFrom(scopeRaw['ranges']) }
      : null;
  const resultRaw = raw['result'];
  const result: DelegationResult | null = isRecordObject(resultRaw)
    ? {
        assessment: typeof resultRaw['assessment'] === 'string' ? resultRaw['assessment'] : '',
        reviewed: rangesFrom(resultRaw['reviewed']),
        approved: rangesFrom(resultRaw['approved']),
        findings: (Array.isArray(resultRaw['findings']) ? resultRaw['findings'] : [])
          .filter(isRecordObject)
          .map((finding) => ({
            severity: finding['severity'] === 'problem' || finding['severity'] === 'question' ? finding['severity'] : 'note',
            text: typeof finding['text'] === 'string' ? finding['text'] : '',
            location: rangeFrom(finding['location']),
          })),
        uncertainties: stringsFrom(resultRaw['uncertainties']),
        insufficient: resultRaw['insufficient'] === true,
        adjustments: stringsFrom(resultRaw['adjustments']),
      }
    : null;
  return {
    id: raw['id'],
    kind: raw['kind'],
    state,
    provider: raw['provider'],
    model: typeof raw['model'] === 'string' ? raw['model'] : '',
    startedAt: typeof raw['startedAt'] === 'string' ? raw['startedAt'] : '',
    endedAt: typeof raw['endedAt'] === 'string' ? raw['endedAt'] : null,
    ...splitLegacyNote(typeof raw['note'] === 'string' ? raw['note'] : '', typeof raw['detail'] === 'string' ? raw['detail'] : ''),
    scope,
    result,
    definitionPath: typeof raw['definitionPath'] === 'string' ? raw['definitionPath'] : null,
    uncovered: rangesFrom(raw['uncovered']),
    ...((): Partial<AgentJob> => {
      const question = questionFrom(raw['question']);
      const answer = answerFrom(raw['answer']);
      const material = materialFrom(raw['material']);
      const investigation = investigationFrom(raw['investigation']);
      const selection = selectionFrom(raw['selection']);
      const followUp = followUpFrom(raw['followUp']);
      return {
        ...(question === null ? {} : { question }),
        ...(answer === null ? {} : { answer }),
        ...(selection === null ? {} : { selection }),
        ...(followUp === null ? {} : { followUp }),
        ...(material === null ? {} : { material }),
        ...(investigation === null ? {} : { investigation }),
        ...(typeof raw['activity'] === 'string' && state === 'running' ? { activity: raw['activity'] } : {}),
      };
    })(),
  };
}

/** A stored agent choice, or `null` for none or one that does not name both. */
export function agentChoiceFrom(raw: unknown): ReviewAgentChoice | null {
  if (!isRecordObject(raw) || (raw['provider'] !== 'cursor' && raw['provider'] !== 'claude')) {
    return null;
  }
  const model = typeof raw['model'] === 'string' ? raw['model'].trim() : '';
  return model === '' || model.length > 200 ? null : { provider: raw['provider'], model };
}

export function scopeFrom(raw: unknown): MarkScope | null {
  if (isRecordObject(raw) && raw['kind'] === 'file') {
    return typeof raw['fileKey'] === 'string' && raw['fileKey'] !== '' ? { kind: 'file', fileKey: raw['fileKey'] } : null;
  }
  return rangeFrom(raw);
}

function positionFrom(raw: unknown): PairPosition {
  if (!isRecordObject(raw)) {
    return START_POSITION;
  }
  const line = isRecordObject(raw['line']) &&
    (raw['line']['side'] === 'base' || raw['line']['side'] === 'target') &&
    Number.isInteger(raw['line']['line'])
    ? { side: raw['line']['side'] as LineSide, line: raw['line']['line'] as number }
    : null;
  return {
    view: raw['view'] === 'file' ? 'file' : 'files',
    fileKey: typeof raw['fileKey'] === 'string' ? raw['fileKey'] : null,
    layout: raw['layout'] === 'unified' ? 'unified' : 'split',
    line,
  };
}

/**
 * A stored record, accepted only for the pair it names.
 *
 * Unknown or malformed entries are dropped one by one rather than failing the whole
 * record; a record for another pair is refused, since its decisions are about other code.
 */
export function adoptPairRecord(raw: unknown, pair: RevisionPairIdentity): PairRecord {
  const empty = emptyRecord(pair);
  if (!isRecordObject(raw) || raw['version'] !== 1 || !isRecordObject(raw['pair'])) {
    return empty;
  }
  const stored = raw['pair'];
  if (stored['repository'] !== pair.repository || stored['base'] !== pair.base || stored['target'] !== pair.target) {
    return empty;
  }
  const marks: PairMark[] = [];
  for (const entry of Array.isArray(raw['marks']) ? raw['marks'] : []) {
    if (!isRecordObject(entry)) {
      continue;
    }
    const scope = scopeFrom(entry['scope']);
    const op = entry['op'];
    if (scope === null || (op !== 'manual' && op !== 'exempt' && op !== 'clear') || typeof entry['id'] !== 'string') {
      continue;
    }
    marks.push({
      id: entry['id'],
      op,
      scope,
      reason: typeof entry['reason'] === 'string' ? entry['reason'] : '',
      at: typeof entry['at'] === 'string' ? entry['at'] : '',
    });
  }
  const agentReviews: AgentReview[] = [];
  for (const entry of Array.isArray(raw['agentReviews']) ? raw['agentReviews'] : []) {
    if (!isRecordObject(entry)) {
      continue;
    }
    const scope = rangeFrom(entry['scope']);
    if (scope === null || typeof entry['id'] !== 'string' || typeof entry['recordedAt'] !== 'string') {
      continue;
    }
    agentReviews.push({
      id: entry['id'],
      scope,
      reviewer: typeof entry['reviewer'] === 'string' ? entry['reviewer'] : '',
      recordedAt: entry['recordedAt'],
      summary: typeof entry['summary'] === 'string' ? entry['summary'] : '',
      ...(typeof entry['jobId'] === 'string' ? { jobId: entry['jobId'] } : {}),
    });
  }
  const jobs: AgentJob[] = [];
  for (const entry of Array.isArray(raw['jobs']) ? raw['jobs'] : []) {
    const job = jobFrom(entry);
    if (job !== null) {
      jobs.push(job);
    }
  }
  return {
    version: 1,
    pair,
    // A stored requirement is kept as stored; a record without one takes today's default.
    requirement: raw['requirement'] === 'manual-or-agent' ? 'manual-or-agent' : raw['requirement'] === 'manual' ? 'manual' : DEFAULT_REQUIREMENT,
    jobs,
    agent: agentChoiceFrom(raw['agent']),
    marks,
    agentReviews,
    position: positionFrom(raw['position']),
    walkDefinition: typeof raw['walkDefinition'] === 'string' && raw['walkDefinition'] !== '' ? raw['walkDefinition'] : null,
    endedAt: typeof raw['endedAt'] === 'string' && raw['endedAt'] !== '' ? raw['endedAt'] : null,
    savedAt: typeof raw['savedAt'] === 'string' ? raw['savedAt'] : empty.savedAt,
  };
}

function rangeHolds(range: LineRange, line: Pick<ChangedLine, 'side' | 'path' | 'line'>): boolean {
  return range.side === line.side && range.path === line.path && line.line >= range.start && line.line <= range.end;
}

/** What has been decided about one changed line. */
export interface LineStatus {
  /** The reviewer's latest decision about the line, or `null` when none holds. */
  readonly decision: PairMark | null;
  /** Every recorded agent review over the line. */
  readonly agent: readonly AgentReview[];
}

/** The status drawn in the strip: manual wins over agent; exempted is the person's decision. */
export type StripStatus = 'manual' | 'agent' | 'exempt' | 'none';

export function stripStatusOf(status: LineStatus): StripStatus {
  if (status.decision?.op === 'manual') {
    return 'manual';
  }
  if (status.decision?.op === 'exempt') {
    return 'exempt';
  }
  return status.agent.length > 0 ? 'agent' : 'none';
}

export function isHandled(status: LineStatus, requirement: ReviewRequirement): boolean {
  if (status.decision !== null) {
    return true;
  }
  // An agent approval counts where the person delegated that part (it carries the job of
  // that mandate), or anywhere under the older `manual-or-agent` requirement.
  return status.agent.some((review) => requirement === 'manual-or-agent' || review.jobId !== undefined);
}

/** What has been decided about one line: the latest decision over it, and agent reviews. */
export function lineStatusOf(
  line: Pick<ChangedLine, 'side' | 'path' | 'line'>,
  record: Pick<PairRecord, 'marks' | 'agentReviews'>,
): LineStatus {
  let decision: PairMark | null = null;
  for (const mark of record.marks) {
    if (mark.scope.kind === 'lines' && rangeHolds(mark.scope, line)) {
      decision = mark.op === 'clear' ? null : mark;
    }
  }
  return { decision, agent: record.agentReviews.filter((review) => rangeHolds(review.scope, line)) };
}

/** The status of every changed line of a file, keyed by {@link lineKey}. */
export function lineStatusesOf(file: PairFile, record: Pick<PairRecord, 'marks' | 'agentReviews'>): ReadonlyMap<string, LineStatus> {
  const statuses = new Map<string, LineStatus>();
  for (const line of changedLinesOf(file)) {
    statuses.set(lineKey(line), lineStatusOf(line, record));
  }
  return statuses;
}

/** The reviewer's latest whole-file decision, for a file with no countable lines. */
export function wholeFileDecisionOf(file: PairFile, record: Pick<PairRecord, 'marks'>): PairMark | null {
  let decision: PairMark | null = null;
  for (const mark of record.marks) {
    if (mark.scope.kind === 'file' && mark.scope.fileKey === file.key) {
      decision = mark.op === 'clear' ? null : mark;
    }
  }
  return decision;
}

export interface FileProgress {
  /** Changed lines: deletions and additions. Context lines are not counted. */
  readonly total: number;
  readonly handled: number;
  readonly manual: number;
  readonly exempted: number;
  /** Lines handled only through a recorded agent review. */
  readonly agent: number;
  /** Handled percentage, rounded down so a file never reads 100 before it is done. */
  readonly percent: number;
  /** Every changed line is handled under the requirement, or a whole-file decision holds. */
  readonly done: boolean;
  /** For a file with nothing to count: the whole-file decision, or `null`. */
  readonly wholeFile: PairMark | null;
}

export function fileProgressOf(file: PairFile, record: PairRecord): FileProgress {
  const statuses = lineStatusesOf(file, record);
  let handled = 0;
  let manual = 0;
  let exempted = 0;
  let agent = 0;
  for (const status of statuses.values()) {
    if (!isHandled(status, record.requirement)) {
      continue;
    }
    handled += 1;
    if (status.decision?.op === 'manual') {
      manual += 1;
    } else if (status.decision?.op === 'exempt') {
      exempted += 1;
    } else {
      agent += 1;
    }
  }
  const total = statuses.size;
  const wholeFile = total === 0 ? wholeFileDecisionOf(file, record) : null;
  return {
    total,
    handled,
    manual,
    exempted,
    agent,
    percent: total === 0 ? 0 : Math.floor((handled * 100) / total),
    done: total === 0 ? wholeFile !== null : handled === total,
    wholeFile,
  };
}

/**
 * What the file list says about a file beside its progress: who reviewed it and what is
 * still open there. A finished file keeps showing both; the checkbox never hides them.
 */
export interface FileReviewFacts {
  /** The agents whose recorded review counts for lines of this file, by name and model. */
  readonly agents: readonly string[];
  /** Problems and questions an agent reported at this file. */
  readonly findings: number;
}

export function fileReviewFactsOf(file: PairFile, record: PairRecord): FileReviewFacts {
  const agents = new Set<string>();
  for (const status of lineStatusesOf(file, record).values()) {
    if (status.decision === null && isHandled(status, record.requirement)) {
      for (const review of status.agent) {
        if (record.requirement === 'manual-or-agent' || review.jobId !== undefined) {
          agents.add(review.reviewer === '' ? 'Agent' : review.reviewer);
        }
      }
    }
  }
  let findings = 0;
  for (const job of record.jobs) {
    if (job.kind !== 'review' || job.state !== 'done' || job.result === null) {
      continue;
    }
    for (const finding of job.result.findings) {
      const at = finding.location;
      if (finding.severity !== 'note' && at !== null && at.path === (at.side === 'base' ? file.oldPath : file.newPath)) {
        findings += 1;
      }
    }
  }
  return { agents: [...agents], findings };
}

/** A review that has not been ended, as the way into review lists it. */
export interface OngoingReview {
  readonly key: string;
  readonly pair: RevisionPairIdentity;
  readonly repositoryName: string;
  readonly base: Pick<LogCommit, 'hash' | 'subject'>;
  readonly target: Pick<LogCommit, 'hash' | 'subject'>;
  readonly files: number;
  readonly filesDone: number;
  /** Changed lines in all, and how many of them are handled under the review's requirement. */
  readonly total: number;
  readonly handled: number;
  readonly savedAt: string;
}

/** How far a review has come, over all its files. */
export function reviewTotalsOf(files: readonly PairFile[], record: PairRecord): Pick<OngoingReview, 'files' | 'filesDone' | 'total' | 'handled'> {
  let total = 0;
  let handled = 0;
  let filesDone = 0;
  for (const file of files) {
    const progress = fileProgressOf(file, record);
    total += progress.total;
    handled += progress.handled;
    filesDone += progress.done ? 1 : 0;
  }
  return { files: files.length, filesDone, total, handled };
}

/** Collapse a set of changed lines into contiguous ranges per side and path. */
export function rangesOf(lines: readonly Pick<ChangedLine, 'side' | 'path' | 'line'>[]): readonly LineRange[] {
  const sorted = [...lines].sort((a, b) =>
    a.side !== b.side ? (a.side < b.side ? -1 : 1) : a.path !== b.path ? (a.path < b.path ? -1 : 1) : a.line - b.line,
  );
  const ranges: LineRange[] = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last !== undefined && last.side === line.side && last.path === line.path && last.end + 1 >= line.line) {
      ranges[ranges.length - 1] = { ...last, end: Math.max(last.end, line.line) };
    } else {
      ranges.push({ kind: 'lines', side: line.side, path: line.path, start: line.line, end: line.line });
    }
  }
  return ranges;
}

// --- Rows for drawing a file ----------------------------------------------------------

/** One row of a unified diff. */
export type UnifiedRow =
  | { readonly kind: 'context'; readonly base: number; readonly target: number }
  | { readonly kind: 'deleted'; readonly base: number }
  | { readonly kind: 'added'; readonly target: number }
  | { readonly kind: 'gap'; readonly id: string; readonly base: number; readonly target: number; readonly count: number };

/** One row of a side-by-side diff; either side may be empty. */
export interface SplitRow {
  readonly kind: 'context' | 'change' | 'gap';
  readonly base: number | null;
  readonly target: number | null;
  /** For a gap: its id and how many unchanged lines it hides. */
  readonly gap?: { readonly id: string; readonly count: number };
}

interface Segment {
  readonly kind: 'same' | 'hunk';
  readonly baseStart: number;
  readonly targetStart: number;
  readonly baseCount: number;
  readonly targetCount: number;
}

function segmentsOf(file: PairFile, baseLength: number, targetLength: number): readonly Segment[] {
  const segments: Segment[] = [];
  let base = 1;
  let target = 1;
  for (const hunk of file.hunks) {
    // A -U0 hunk with no deleted lines names the line *after which* it adds; with no
    // added lines, the line after which it removed. Either way the unchanged run before
    // it ends there.
    const hunkBase = hunk.baseCount === 0 ? hunk.baseStart + 1 : hunk.baseStart;
    const same = hunkBase - base;
    if (same > 0) {
      segments.push({ kind: 'same', baseStart: base, targetStart: target, baseCount: same, targetCount: same });
    }
    base = hunkBase;
    target = hunk.targetCount === 0 ? hunk.targetStart + 1 : hunk.targetStart;
    segments.push({ kind: 'hunk', baseStart: base, targetStart: target, baseCount: hunk.baseCount, targetCount: hunk.targetCount });
    base += hunk.baseCount;
    target += hunk.targetCount;
  }
  const tail = Math.max(baseLength - base + 1, targetLength - target + 1, 0);
  if (tail > 0) {
    segments.push({ kind: 'same', baseStart: base, targetStart: target, baseCount: tail, targetCount: tail });
  }
  return segments;
}

/** How many unchanged lines stay visible around a change before the rest fold away. */
export const CONTEXT_LINES = 3;

function sameRows(
  segment: Segment,
  first: boolean,
  last: boolean,
  expanded: ReadonlySet<string>,
): { readonly lines: readonly { base: number; target: number }[]; readonly gaps: readonly { at: number; id: string; base: number; target: number; count: number }[] } {
  const count = segment.baseCount;
  const id = `gap-${String(segment.baseStart)}-${String(segment.targetStart)}`;
  const all = Array.from({ length: count }, (_, index) => ({ base: segment.baseStart + index, target: segment.targetStart + index }));
  const keepBefore = first ? 0 : CONTEXT_LINES;
  const keepAfter = last ? 0 : CONTEXT_LINES;
  if (expanded.has(id) || expanded.has('*') || count <= keepBefore + keepAfter + 1) {
    return { lines: all, gaps: [] };
  }
  const head = all.slice(0, keepBefore);
  const tail = all.slice(count - keepAfter);
  const hidden = all[keepBefore] as { base: number; target: number };
  return {
    lines: [...head, ...tail],
    gaps: [{ at: head.length, id, base: hidden.base, target: hidden.target, count: count - keepBefore - keepAfter }],
  };
}

/** The unified rows of a file, with long unchanged runs folded into gaps; `'*'` in `expanded` unfolds every one. */
export function unifiedRowsOf(
  file: PairFile,
  baseLength: number,
  targetLength: number,
  expanded: ReadonlySet<string> = new Set(),
): readonly UnifiedRow[] {
  const segments = segmentsOf(file, baseLength, targetLength);
  const rows: UnifiedRow[] = [];
  segments.forEach((segment, index) => {
    if (segment.kind === 'hunk') {
      for (let line = 0; line < segment.baseCount; line += 1) {
        rows.push({ kind: 'deleted', base: segment.baseStart + line });
      }
      for (let line = 0; line < segment.targetCount; line += 1) {
        rows.push({ kind: 'added', target: segment.targetStart + line });
      }
      return;
    }
    const { lines, gaps } = sameRows(segment, index === 0, index === segments.length - 1, expanded);
    lines.forEach((line, at) => {
      for (const gap of gaps) {
        if (gap.at === at) {
          rows.push({ kind: 'gap', id: gap.id, base: gap.base, target: gap.target, count: gap.count });
        }
      }
      rows.push({ kind: 'context', base: line.base, target: line.target });
    });
    for (const gap of gaps) {
      if (gap.at === lines.length) {
        rows.push({ kind: 'gap', id: gap.id, base: gap.base, target: gap.target, count: gap.count });
      }
    }
  });
  return rows;
}

/** The side-by-side rows of a file: a hunk's deletions and additions paired line by line. */
export function splitRowsOf(
  file: PairFile,
  baseLength: number,
  targetLength: number,
  expanded: ReadonlySet<string> = new Set(),
): readonly SplitRow[] {
  const rows: SplitRow[] = [];
  const unified = unifiedRowsOf(file, baseLength, targetLength, expanded);
  let index = 0;
  while (index < unified.length) {
    const row = unified[index] as UnifiedRow;
    if (row.kind === 'context') {
      rows.push({ kind: 'context', base: row.base, target: row.target });
      index += 1;
      continue;
    }
    if (row.kind === 'gap') {
      rows.push({ kind: 'gap', base: row.base, target: row.target, gap: { id: row.id, count: row.count } });
      index += 1;
      continue;
    }
    const deleted: number[] = [];
    const added: number[] = [];
    while (index < unified.length) {
      const next = unified[index] as UnifiedRow;
      if (next.kind === 'deleted' && added.length === 0) {
        deleted.push(next.base);
      } else if (next.kind === 'added') {
        added.push(next.target);
      } else {
        break;
      }
      index += 1;
    }
    for (let line = 0; line < Math.max(deleted.length, added.length); line += 1) {
      rows.push({ kind: 'change', base: deleted[line] ?? null, target: added[line] ?? null });
    }
  }
  return rows;
}

// --- The windows' bridge -------------------------------------------------------------

/** A place in the diff a walk asks the diff window to show (`Show in diff`). */
export interface DiffLocation {
  readonly side: LineSide;
  readonly path: string;
  readonly line: number;
}

/**
 * How two chosen commits relate in Git's history, which decides which is From and which
 * is To. Only ancestry decides: not dates, not the order of the log, not the order of the
 * clicks. Where it cannot decide, the person chooses; DSpatch never guesses and never
 * compares with a merge base instead.
 */
export type PairDirection =
  /** `base` is an ancestor of `target`. */
  | { readonly kind: 'ordered'; readonly base: string; readonly target: string }
  /** Neither commit is an ancestor of the other, as on two branches. */
  | { readonly kind: 'unrelated' }
  /** Git could not say: a shallow history, a missing commit or a failed read. */
  | { readonly kind: 'unknown'; readonly reason: string };

/** What a review window over a pair starts with. */
export type PairWindowStart =
  /** A diff window that has not chosen a pair yet: repository list or log. */
  | { readonly kind: 'choose' }
  /** A diff window reopened onto a pair, and where to go in it, if anywhere. */
  | { readonly kind: 'pair'; readonly pair: RevisionPairIdentity; readonly at: DiffLocation | null };

export type PairOpenOutcome =
  | { readonly kind: 'opened'; readonly open: OpenPair }
  /** Another window already shows this pair; it was brought to the front. */
  | { readonly kind: 'focused'; readonly note: string }
  | { readonly kind: 'failed'; readonly error: string };

export interface PairChangedEvent {
  readonly key: string;
  readonly record: PairRecord;
}

/** The channels of the pair bridge. `review-preload.ts` repeats them as literals. */
export const REVIEW_PAIR_CHANNELS = {
  start: 'dspatch:review-pair-start',
  repositories: 'dspatch:review-pair-repositories',
  log: 'dspatch:review-pair-log',
  direction: 'dspatch:review-pair-direction',
  open: 'dspatch:review-pair-open',
  forWalk: 'dspatch:review-pair-for-walk',
  readFile: 'dspatch:review-pair-read-file',
  state: 'dspatch:review-pair-state',
  mark: 'dspatch:review-pair-mark',
  setRequirement: 'dspatch:review-pair-set-requirement',
  savePosition: 'dspatch:review-pair-save-position',
  walks: 'dspatch:review-pair-walks',
  openWalk: 'dspatch:review-pair-open-walk',
  openWalks: 'dspatch:review-pair-open-walks',
  ongoing: 'dspatch:review-pair-ongoing',
  end: 'dspatch:review-pair-end',
  showInDiff: 'dspatch:review-pair-show-in-diff',
  agents: 'dspatch:review-pair-agents',
  startJob: 'dspatch:review-pair-start-job',
  cancelJob: 'dspatch:review-pair-cancel-job',
} as const;

/** A pair's record changed; sent to every review window over that pair. */
export const REVIEW_PAIR_CHANGED = 'dspatch:review-pair-changed';

/** The diff window is asked to show a place (from `Show in diff`). */
export const REVIEW_PAIR_NAVIGATE = 'dspatch:review-pair-navigate';

export interface MarkRequestInput {
  readonly op: PairMark['op'];
  readonly scopes: readonly MarkScope[];
  readonly reason: string;
}

/** What a review window may ask about pairs. Exposed as `window.dspatchReviewPair`. */
export interface ReviewPairBridge {
  start(): Promise<PairWindowStart>;
  repositories(): Promise<readonly ReviewRepository[]>;
  log(
    repository: string,
    skip: number,
  ): Promise<PairAnswer<{ readonly commits: readonly LogCommit[]; readonly more: boolean; readonly last: { readonly base: string; readonly target: string } | null }>>;
  /** Which of two chosen commits is From and which is To, from Git's ancestry. Reads only. */
  direction(repository: string, first: string, second: string): Promise<PairAnswer<PairDirection>>;
  open(pair: RevisionPairIdentity): Promise<PairOpenOutcome>;
  /** In a walk window: the pair the walk is over, opened so decisions share its record. */
  forWalk(): Promise<PairAnswer<OpenPair>>;
  readFile(key: string, side: LineSide, path: string): Promise<PairAnswer<{ readonly text: string | null; readonly binary: boolean }>>;
  state(key: string): Promise<PairAnswer<PairRecord>>;
  mark(key: string, request: MarkRequestInput): Promise<PairAnswer<PairRecord>>;
  setRequirement(key: string, requirement: ReviewRequirement): Promise<PairAnswer<PairRecord>>;
  savePosition(key: string, position: PairPosition): Promise<PairAnswer<{ readonly saved: true }>>;
  walks(key: string): Promise<PairAnswer<readonly PairWalk[]>>;
  /**
   * Open one walk definition over the pair in the review's walk window: the open one is
   * reused (one walk window per review), else one is made. Its record keeps its position.
   */
  openWalk(key: string, definitionPath: string): Promise<{ readonly ok: boolean; readonly note: string }>;
  /** *Code walks*: the walk last opened from this review (else the newest), in its walk window. */
  openWalks(key: string): Promise<{ readonly ok: boolean; readonly note: string }>;
  /** The reviews not ended, newest first, for the way into review. Reads; starts nothing. */
  ongoing(): Promise<readonly OngoingReview[]>;
  /** End a review: it leaves the ongoing list. Approves nothing and deletes nothing. */
  end(pair: RevisionPairIdentity): Promise<PairAnswer<{ readonly ended: true }>>;
  showInDiff(location: DiffLocation): Promise<{ readonly ok: boolean; readonly note: string }>;
  /** DSP-152: the agents that can prepare walks or review a delegated part here. */
  agents(key: string): Promise<PairAnswer<ReviewAgents>>;
  startJob(key: string, request: AgentJobRequestInput): Promise<PairAnswer<AgentJob>>;
  cancelJob(key: string, jobId: string): Promise<PairAnswer<{ readonly note: string }>>;
  onChanged(listener: (event: PairChangedEvent) => void): () => void;
  onNavigate(listener: (location: DiffLocation) => void): () => void;
}

// --- What changed inside the changed lines -------------------------------------------
//
// The behaviour of Gerrit's diff view, as of Gerrit v3.14.4 (commit 6d03864). Written here
// from Gerrit's documented behaviour and its source, not copied from it:
// `IntraLineLoader.compute` decides the ranges, `DiffInfoCreator` hands them to the
// browser, and `gr-diff-processor` and `gr-diff-styles` draw them.
//
// - A block of removed lines followed by added lines (a hunk with both) is compared as
//   one text, character by character, with the line breaks included. The block is not
//   cut into line pairs first, so three removed lines replaced by one are compared with
//   that one line as a whole, and whatever of the three did not survive is marked.
// - Lines of such a block keep the light line colour, and the characters that changed
//   get the strong one. A line can have no strong part at all: everything on it survived.
// - A block with only removed or only added lines has nothing to compare with, and all of
//   its text is strong.
// - Nothing is dropped for having changed too much: a rewritten line is all strong.
// - Whitespace counts like any other character, and the comparison works on the file's
//   own lines. How a long line wraps in the window changes nothing.

/** Character ranges `[start, end)` on one line, in the line's own characters. */
export type LineRanges = readonly (readonly [number, number])[];

/** How one changed line shows what changed on it. */
export type ChangedLineMarks =
  /** In a block compared with the other side: light, with these characters strong. */
  | { readonly kind: 'ranges'; readonly ranges: LineRanges }
  /** All of the line is strong: nothing on the other side, or too large to compare. */
  | { readonly kind: 'whole' };

/** The ranges of a compared block, per line of each side, in the block's line order. */
export interface IntralineBlock {
  readonly base: readonly LineRanges[];
  readonly target: readonly LineRanges[];
}

/**
 * Where Gerrit gives up comparing a block (its five-second timeout), DSpatch stops at a
 * size instead, so the same change always looks the same. Past either bound every line
 * of the block is strong, as Gerrit draws a block without a comparison.
 */
export const INTRALINE_LIMITS = { characters: 20_000, edits: 2_000 } as const;

/** One difference, in characters of the two block texts: `a` is From, `b` is To. */
interface CharEdit {
  readonly a0: number;
  readonly a1: number;
  readonly b0: number;
  readonly b1: number;
}

/** The character edits that turn `a` into `b`, adjacent removals and additions joined. */
function charEdits(a: string, b: string): CharEdit[] | null {
  const parts = diffChars(a, b, { maxEditLength: INTRALINE_LIMITS.edits });
  if (parts === undefined) {
    return null;
  }
  const edits: CharEdit[] = [];
  let atA = 0;
  let atB = 0;
  let open: { a0: number; a1: number; b0: number; b1: number } | null = null;
  for (const part of parts) {
    const length = part.value.length;
    if (!part.added && !part.removed) {
      if (open !== null) {
        edits.push(open);
        open = null;
      }
      atA += length;
      atB += length;
      continue;
    }
    open ??= { a0: atA, a1: atA, b0: atB, b1: atB };
    if (part.removed) {
      atA += length;
      open.a1 = atA;
    } else {
      atB += length;
      open.b1 = atB;
    }
  }
  if (open !== null) {
    edits.push(open);
  }
  return joinedAcrossCommon(a, b, edits);
}

/**
 * Two additions (or two removals) with a short common run between them, where one of
 * them can slide over that run onto the other, as one span. A minimal comparison is not
 * unique: JGit's Myers, which Gerrit uses, gives "multi\nline" added at once where the
 * `diff` package gives "multi", a common "\n", then "line\n". Both are minimal; this
 * picks the one Gerrit draws.
 */
function joinedAcrossCommon(a: string, b: string, raw: readonly CharEdit[]): CharEdit[] {
  const edits = [...raw];
  for (let j = 0; j < edits.length - 1; ) {
    const c = edits[j] as CharEdit;
    const n = edits[j + 1] as CharEdit;
    const inserts = c.a0 === c.a1 && n.a0 === n.a1 && c.b0 < c.b1 && n.b0 < n.b1;
    const removes = c.b0 === c.b1 && n.b0 === n.b1 && c.a0 < c.a1 && n.a0 < n.a1;
    const text = inserts ? b : a;
    const [c0, c1, n0, n1] = inserts ? [c.b0, c.b1, n.b0, n.b1] : [c.a0, c.a1, n.a0, n.a1];
    const common = text.slice(c1, n0);
    let joined: CharEdit | null = null;
    if ((inserts || removes) && common.length > 0) {
      if (text.slice(n0, n1).endsWith(common)) {
        // The second slides back over the common run onto the first.
        joined = inserts
          ? { a0: c.a0, a1: c.a0, b0: c0, b1: n1 - common.length }
          : { a0: c0, a1: n1 - common.length, b0: c.b0, b1: c.b0 };
      } else if (text.slice(c0, c1).startsWith(common)) {
        // The first slides forward over the common run onto the second.
        joined = inserts
          ? { a0: n.a0, a1: n.a0, b0: c0 + common.length, b1: n1 }
          : { a0: c0 + common.length, a1: n1, b0: n.b0, b1: n.b0 };
      }
    }
    if (joined !== null) {
      edits.splice(j, 2, joined);
      continue;
    }
    j += 1;
  }
  return edits;
}

const noBreakIn = (text: string, from: number, to: number): boolean => !text.slice(from, to).includes('\n');

/**
 * Gerrit's tidying of a character comparison: edits a few characters apart on one line
 * become one span; a span's identical ends are dropped; a span slides to the end of a
 * repeated run, but not across a line break; and a span that covers a line up to its
 * break takes the break too.
 */
function tidied(a: string, b: string, raw: readonly CharEdit[]): CharEdit[] {
  const edits = [...raw];
  for (let j = 0; j < edits.length - 1; ) {
    const c = edits[j] as CharEdit;
    const n = edits[j + 1] as CharEdit;
    if ((n.a0 - c.a1 <= 5 || n.b0 - c.b1 <= 5) && noBreakIn(a, c.a1, n.a0) && noBreakIn(b, c.b1, n.b0)) {
      edits.splice(j, 2, { a0: c.a0, a1: n.a1, b0: c.b0, b1: n.b1 });
      continue;
    }
    j += 1;
  }
  for (let j = 0; j < edits.length; j += 1) {
    const c = edits[j] as CharEdit;
    let { a0, a1, b0, b1 } = c;
    // An edit that ends where this one starts is taken into it. Gerrit looks back only
    // from the third edit on; that is kept, since it decides what is drawn.
    if (j > 1) {
      const p = edits[j - 1] as CharEdit;
      if (p.a1 === a0 || p.b1 === b0) {
        if (p.a1 === a0 && p.a0 < p.a1) {
          a0 = p.a0;
        }
        if (p.b1 === b0 && p.b0 < p.b1) {
          b0 = p.b0;
        }
        edits.splice(j - 1, 1);
        j -= 1;
      }
    }
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) {
      a0 += 1;
      b0 += 1;
    }
    while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) {
      a1 -= 1;
      b1 -= 1;
    }
    [a0, a1] = slid(a, a0, a1);
    [b0, b1] = slid(b, b0, b1);
    a1 = withBreak(a, a0, a1);
    b1 = withBreak(b, b0, b1);
    edits[j] = { a0, a1, b0, b1 };
  }
  return edits;
}

/** One side of a span, slid back while its start repeats its end, then forward to its line's end. */
function slid(text: string, from: number, to: number): [number, number] {
  while (from > 0 && from < to && text[from - 1] !== '\n' && text[from - 1] === text[to - 1]) {
    from -= 1;
    to -= 1;
  }
  const lineStart = from === 0 || text[from - 1] === '\n';
  if (!lineStart || !text.slice(from, to).includes('\n')) {
    while (from < to && to < text.length && text[from] === text[to]) {
      from += 1;
      to += 1;
      if (text[to - 1] === '\n') {
        break;
      }
    }
  }
  return [from, to];
}

/** A span covering a whole line but its break ends after the break. */
function withBreak(text: string, from: number, to: number): number {
  const lineStart = from === 0 || text[from - 1] === '\n';
  return from < to && lineStart && to < text.length && text[to - 1] !== '\n' && text[to] === '\n' ? to + 1 : to;
}

/** Whether the edits still turn `a` into `b`; when tidying broke that, Gerrit marks everything. */
function transforms(a: string, b: string, edits: readonly CharEdit[]): boolean {
  const inRange = (text: string, from: number, last: number): boolean =>
    from >= 0 && last >= 0 && from < text.length && last < text.length;
  let left = a;
  let right = b;
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    const e = edits[i] as CharEdit;
    const removes = e.a0 < e.a1;
    const adds = e.b0 < e.b1;
    if (removes && adds) {
      if (!inRange(left, e.a0, e.a1 - 1) || !inRange(b, e.b0, e.b1 - 1)) {
        return false;
      }
      left = left.slice(0, e.a0) + b.slice(e.b0, e.b1) + left.slice(e.a1);
    } else if (removes) {
      if (!inRange(left, e.a0, e.a1 - 1)) {
        return false;
      }
      left = left.slice(0, e.a0) + left.slice(e.a1);
    } else if (adds) {
      if (!inRange(right, e.b0, e.b1 - 1)) {
        return false;
      }
      right = right.slice(0, e.b0) + right.slice(e.b1);
    }
  }
  return left === right;
}

/** Block-wide spans cut into each line's own ranges; a line break is not drawn. */
function perLine(lines: readonly string[], spans: readonly (readonly [number, number])[]): LineRanges[] {
  const out: [number, number][][] = lines.map(() => []);
  let start = 0;
  lines.forEach((line, index) => {
    const end = start + line.length;
    for (const [from, to] of spans) {
      const lo = Math.max(from, start);
      const hi = Math.min(to, end);
      if (lo < hi) {
        (out[index] as [number, number][]).push([lo - start, hi - start]);
      }
    }
    start = end + 1;
  });
  return out;
}

/**
 * What changed between a block of removed lines and the added lines that replace it, per
 * line. Null when the block is too large to compare (`INTRALINE_LIMITS`).
 */
export function intralineBlock(baseLines: readonly string[], targetLines: readonly string[]): IntralineBlock | null {
  const a = baseLines.map((line) => `${line}\n`).join('');
  const b = targetLines.map((line) => `${line}\n`).join('');
  if (a.length + b.length > INTRALINE_LIMITS.characters) {
    return null;
  }
  const raw = charEdits(a, b);
  if (raw === null) {
    return null;
  }
  const tidy = tidied(a, b, raw);
  const edits = transforms(a, b, tidy) ? tidy : [{ a0: 0, a1: a.length, b0: 0, b1: b.length }];
  return {
    base: perLine(baseLines, edits.filter((e) => e.a0 < e.a1).map((e) => [e.a0, e.a1] as const)),
    target: perLine(targetLines, edits.filter((e) => e.b0 < e.b1).map((e) => [e.b0, e.b1] as const)),
  };
}

/**
 * How every changed line of a file shows what changed, keyed `base:N` or `target:N`. One
 * source for both layouts: it follows the file's hunks, not the rows either layout draws.
 */
export function changeMarksOf(
  file: PairFile,
  base: readonly string[],
  target: readonly string[],
): ReadonlyMap<string, ChangedLineMarks> {
  const marks = new Map<string, ChangedLineMarks>();
  const whole: ChangedLineMarks = { kind: 'whole' };
  for (const hunk of file.hunks) {
    const baseLines = Array.from({ length: hunk.baseCount }, (_, index) => hunk.baseStart + index);
    const targetLines = Array.from({ length: hunk.targetCount }, (_, index) => hunk.targetStart + index);
    const block =
      baseLines.length > 0 && targetLines.length > 0
        ? intralineBlock(
            baseLines.map((line) => base[line - 1] ?? ''),
            targetLines.map((line) => target[line - 1] ?? ''),
          )
        : null;
    baseLines.forEach((line, index) => {
      marks.set(`base:${String(line)}`, block === null ? whole : { kind: 'ranges', ranges: block.base[index] ?? [] });
    });
    targetLines.forEach((line, index) => {
      marks.set(`target:${String(line)}`, block === null ? whole : { kind: 'ranges', ranges: block.target[index] ?? [] });
    });
  }
  return marks;
}
