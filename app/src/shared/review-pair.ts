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

import { isProfile, type PresentationProfile } from './presentation-profiles';
import { isDecisionOrigin, type DecisionOrigin } from './review-model';
import { stepReferencesFrom, type StepReference } from './review-discussion';
import { isWalkMethod, walkLoopSummaryFrom, type WalkLoopRecordView, type WalkLoopSummary, type WalkMethod } from './walk-method';
import type { WalkLoopRunEvent, WalkLoopRunSnapshot } from './walk-loop-view';

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

/**
 * A review's own identity (DSP-186, Niclas's decision of 9 November 2026). Every review is
 * an instance of its own: a new review of a pair that was reviewed before starts empty, and
 * closing, reopening and deleting act on exactly one review.
 *
 * A review recorded before review ids keeps the key of its repository and two commits (24
 * hexadecimal characters) as its id, so its files keep their names. A review started since
 * has `r-` and 24 random hexadecimal characters, a form a pair key can never take.
 */
const REVIEW_ID = /^(?:[0-9a-f]{24}|r-[0-9a-f]{24})$/;

export function isReviewId(value: unknown): value is string {
  return typeof value === 'string' && REVIEW_ID.test(value);
}

/** A review recorded before review ids, whose id is its pair's key. */
export function isLegacyReviewId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
}

/** An open review: its id (`key`), its pair, the pair's files and the review's record. */
export interface OpenPair {
  /** The review's id (DSP-186): every window and job of this review names it. */
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
  readonly provider: 'cursor' | 'claude' | 'copilot';
  readonly choosable: boolean;
  readonly reason: string | null;
}

/** An agent and model, as chosen; the model is the provider's id, never empty. */
export interface ReviewAgentChoice {
  readonly provider: 'cursor' | 'claude' | 'copilot';
  readonly model: string;
}

/**
 * The agent and model a review's agent work starts from (DSP-152 fix after the first
 * live trial): the choice made in this review, else the one of the chat or loop editor
 * that opened it, else none. Never a provider or model DSpatch picks on its own. An
 * opener on the provider's default has an empty `model`.
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
  readonly provider: 'cursor' | 'claude' | 'copilot';
  readonly model: string;
  readonly scope?: DelegationScope;
  /** DSP-152, `explain`: the step (by its walk definition and ids) and the person's question. */
  readonly question?: { readonly definitionPath: string; readonly walkId: string; readonly stepId: string; readonly question: string };
  /** DSP-152, `explain`: code selected in the diff, as the window read it (the host checks it). */
  readonly selection?: CodeSelectionRequest;
  /** DSP-152, `explain`: a follow-up on an earlier explanation of a selection, by its first job. */
  readonly followUp?: { readonly root: string; readonly action: ExplainAction; readonly question?: string; readonly of?: string };
  /**
   * `explain` with a selection (30 October 2026): the person's own question about the
   * selected code, asked without *Explain this* first. Without it the selection is explained.
   */
  readonly ask?: string;
  /** `checks` (30 October 2026): the walk definition whose change is looked over. */
  readonly definitionPath?: string;
  /** DSP-181, `walks`: the presentation profile the step explanations are written in. */
  readonly presentation?: { readonly profile: PresentationProfile };
  /**
   * DSP-189, `walks`: how the walks are prepared. `single` (the default) is today's one call;
   * `loop` runs the planner, writer and reviewer through the run engine, as an evaluation mode.
   */
  readonly method?: WalkMethod;
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

/**
 * A delegated review as the scope of the person's decision about it (DSP-193): the job
 * the person delegated, whose assessment they accept or do not accept.
 */
export interface DelegatedJob {
  readonly kind: 'job';
  readonly jobId: string;
}

export type MarkScope = LineRange | WholeFile | DelegatedJob;

/**
 * One decision by the reviewer, in the order made.
 *
 * `manual` and `exempt` are decisions over lines or a whole file. `accept-agent` and
 * `reject-agent` are the person's decision about a delegated review (a `job` scope, DSP-193,
 * Niclas's decision of 10 November 2026): only an accepted assessment counts its assessed
 * lines as reviewed through that delegation. `clear` withdraws earlier decisions over its
 * scope. The list is the history: nothing is rewritten, and the latest decision about a
 * line, or about a job, is the one that holds.
 */
export interface PairMark {
  readonly id: string;
  readonly op: 'manual' | 'exempt' | 'clear' | 'accept-agent' | 'reject-agent';
  readonly scope: MarkScope;
  readonly reason: string;
  readonly at: string;
  /**
   * Where it was made (DSP-201): at a walk's place, in the diff window, or as the person's
   * keeping of an earlier mark. Absent on marks recorded before it was kept, whose origin a
   * window cannot tell: a walk's Accept then covered its whole hunk, and the diff window's
   * marks over the same lines look the same.
   */
  readonly origin?: DecisionOrigin;
}

/**
 * A line the agent assessed as acceptable in a delegated review, recorded with the job's
 * result (DSP-152). It is the agent's assessment: a line counts as reviewed through it only
 * once the person has accepted that job's assessment (DSP-193). A walk passing a line, an
 * explanation about it or a discussion of it is never one.
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
  /**
   * For a walk delegated by its exact changed lines (DSP-203): whether the mandate is the lines
   * still without a decision when it started (`remaining`) or all of them (`all`). Absent on a
   * walk delegated before, whose ranges are the whole changes its steps planned, kept as stored.
   */
  readonly basis?: DelegationBasis;
}

export type DelegationBasis = 'remaining' | 'all';

/** Whether a stored or requested value is a delegation basis. */
export function isDelegationBasis(value: unknown): value is DelegationBasis {
  return value === 'remaining' || value === 'all';
}

/** Something the agent found, where it found it when it said. */
export interface AgentFinding {
  readonly severity: 'problem' | 'question' | 'note';
  /** The problem and what it leads to. In an older result, everything the agent said of it. */
  readonly text: string;
  readonly location: LineRange | null;
  /** A short heading from the agent (DSP-158). Absent on older results, which derive one. */
  readonly title?: string;
  /** Longer reasoning, shown on request (DSP-158). Absent on older results. */
  readonly details?: string;
  /** What the observation rests on: the code read, a test, a document (DSP-175). Absent on older results. */
  readonly evidence?: string;
  /** What the agent recommends doing about it (DSP-175). Absent on older results: none is made up. */
  readonly recommendation?: Recommendation;
  /**
   * The place the agent named when DSpatch could not find it at that commit (DSP-175): kept
   * so the thread can say where it was said to be, and never marked in the code.
   */
  readonly missing?: { readonly range: LineRange; readonly reason: string };
  /**
   * Where it shows in another repository of the workspace, read as context and checked at
   * its recorded commit (DSP-175). Never reviewed, approved or covered.
   */
  readonly contextLocation?: ContextRange;
}

/**
 * What the agent recommends for a finding, a question or a verification gap (DSP-175).
 * Accepting it records agreement only: it starts no change, command or other action.
 * `keep` is the explicit "no change is needed", which an accept may close with its reason.
 */
export type RecommendationKind = 'change' | 'test' | 'measure' | 'ask-author' | 'investigate' | 'keep';

export const RECOMMENDATION_KINDS: readonly RecommendationKind[] = ['change', 'test', 'measure', 'ask-author', 'investigate', 'keep'];

export interface Recommendation {
  readonly kind: RecommendationKind;
  /** The recommended action in a sentence. */
  readonly action: string;
  /** Why, briefly. */
  readonly rationale: string;
  /** What is still uncertain; `''` when nothing is said. */
  readonly uncertainty: string;
  /** A concrete next step when more investigation is needed; `''` otherwise. */
  readonly nextStep: string;
}

/**
 * Something the agent could not establish (DSP-175): a verification gap, not a defect. It
 * belongs to the finding with the title `finding` when the agent tied it to one.
 */
export interface AgentGap {
  readonly text: string;
  readonly evidence?: string;
  readonly finding?: string;
  readonly location: LineRange | null;
  readonly recommendation?: Recommendation;
}

/** What a person did in a review thread (DSP-175). Kept in order; nothing is rewritten. */
export type ThreadEventKind = 'comment' | 'accept' | 'keep-open' | 'resolve' | 'dismiss' | 'reopen';

export interface ThreadEvent {
  readonly id: string;
  readonly kind: ThreadEventKind;
  readonly at: string;
  /** The person's words; required for a dismissal, optional otherwise. */
  readonly text: string;
}

/** The person's side of one thread, under the thread's identity. */
export interface ThreadRecord {
  readonly threadId: string;
  readonly events: readonly ThreadEvent[];
}

/**
 * One point worth checking as the host read it from a walk definition or its checks file
 * (DSP-175), so the point is a review thread like a finding. Its text is the agent's as
 * written; its places are those DSpatch checked when the point was written.
 */
export interface StoredCheck {
  /** Its id in the definition (`C1` …), for finding the point in the walk window. */
  readonly checkId: string;
  readonly kind: 'question' | 'uncertainty' | 'finding';
  readonly title: string;
  readonly detail: string;
  readonly reasoning: string;
  readonly places: readonly LineRange[];
  /** What it rests on; absent on a point written before recommendations were asked for. */
  readonly evidence?: string;
  /** Absent on an older point: none is made up. */
  readonly recommendation?: Recommendation;
  /**
   * No longer in its definition (the points were asked for again) but kept because the
   * person already commented on or decided about it. It is shown as a thread, not in the walk.
   */
  readonly retired?: boolean;
}

/** The points worth checking of one walk definition, as last read by the host. */
export interface CheckSource {
  readonly definitionPath: string;
  /** The job that wrote them, when one recorded here did. */
  readonly jobId: string | null;
  /** Who prepared them, as threads name a reviewer: "Claude · model"; `''` when unknown. */
  readonly reviewer: string;
  readonly at: string;
  readonly checks: readonly StoredCheck[];
}

/** What a delegated review reported, after DSpatch checked it against the scope. */
export interface DelegationResult {
  readonly assessment: string;
  /**
   * The agent's own one or two sentences on what it approved and what remains (DSP-158).
   * Absent on older results, which open with the start of the assessment. Never what says
   * what was approved: that is read from `approved`.
   */
  readonly summary?: string;
  /** The changed lines the agent says it reviewed, within the scope. */
  readonly reviewed: readonly LineRange[];
  /** The changed lines approved under the mandate, within the scope and reviewed. */
  readonly approved: readonly LineRange[];
  readonly findings: readonly AgentFinding[];
  readonly uncertainties: readonly string[];
  /**
   * The same things not established, with what they rest on and a recommendation (DSP-175).
   * Absent on older results, whose `uncertainties` are then the gaps.
   */
  readonly gaps?: readonly AgentGap[];
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
  /**
   * For `simpler` (30 October 2026): the answer, by its job, to explain more simply. The
   * thread it is given ends with that answer and the question it answered. Absent: the last.
   */
  readonly of?: string;
}

/**
 * The file key of a selection in a file outside the change (30 October 2026): a reference
 * followed to a file the change does not touch. Every line there is unchanged.
 */
export function outsideFileKey(filePath: string): string {
  return `outside:${filePath}`;
}

/**
 * What a tool call the provider reported says the agent is doing (30 October 2026): the
 * file it reads, by name, or that it searches. The purpose of a search is not guessed, and
 * a tool that neither reads nor searches says nothing here (DSP-158): `null`, so the line
 * goes on saying what it last knew rather than claim a search that was not reported.
 */
export function toolActivity(name: string, subject: string | null): string | null {
  if (name === 'Read') {
    const file = subject === null ? '' : (subject.split(/[\\/]/).pop() ?? '');
    return file === '' ? 'Reading a file' : `Reading ${file}`;
  }
  return name === 'Glob' || name === 'Grep' ? 'Searching the code' : null;
}

/**
 * The same line for the project chat, whose agent also edits and runs things. The tool's
 * name is all most providers report, so a tool it cannot place reads as work, not as a search.
 */
export function chatToolActivity(name: string, subject: string | null): string {
  const tool = name.toLowerCase();
  if (/read|view|open/.test(tool)) {
    return `${toolActivity('Read', subject) ?? 'Reading a file'}…`;
  }
  if (/grep|glob|search|find|list/.test(tool)) {
    return 'Searching the code…';
  }
  if (/edit|write|patch|create|replace/.test(tool)) {
    return 'Editing the code…';
  }
  if (/bash|shell|terminal|powershell|command|exec/.test(tool)) {
    return 'Running a command…';
  }
  return 'Working…';
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

/**
 * A place in another repository of the review's workspace, read as context at the commit
 * DSpatch recorded for it (DSP-175). Context is not under review: such a place is never
 * reviewed, approved or covered, so it is kept apart from {@link LineRange}, and it opens
 * from Git at `commit` (`readContextFile`), never from a working copy.
 */
export interface ContextRange {
  readonly kind: 'context';
  /** The context repository's name in this review: its folder under `context/`. */
  readonly repository: string;
  /** The full commit the place was read and checked at. */
  readonly commit: string;
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

/** A context place an answer rests on, checked at its recorded commit (DSP-175). */
export interface ContextReference {
  readonly label: string;
  readonly range: ContextRange;
}

/** A stored context place, or `null`. */
export function contextRangeFrom(raw: unknown): ContextRange | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const { repository, commit, path: filePath, start, end } = value;
  if (value['kind'] !== 'context' || typeof repository !== 'string' || repository === '' || !isFullHash(commit) || typeof filePath !== 'string' || filePath === '') {
    return null;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number)) {
    return null;
  }
  return { kind: 'context', repository, commit, path: filePath, start: start as number, end: end as number };
}

/** What `readContextFile` answers: a file of a context repository at its recorded commit (DSP-175). */
export interface ContextFileView {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  /** `null` for a binary file. */
  readonly text: string | null;
  readonly binary: boolean;
  /** How the commit was chosen: a submodule pin, a declared version, a path dependency, or HEAD. */
  readonly how: 'submodule' | 'dependency' | 'path-dependency' | 'head';
  /** Whether that commit is established as what the reviewed build uses. */
  readonly established: boolean;
  /** The plain sentence on how it was chosen, as the agent was told it. */
  readonly note: string;
}

/** The answer to a step question, after DSpatch checked its references. */
export interface StepAnswer {
  /** Markdown: the explanation, written to the plan's rules. */
  readonly answer: string;
  /** Markdown: more detail, shown under Show more (30 October 2026). Absent on earlier answers. */
  readonly details?: string;
  /** References that exist at their commit. */
  readonly references: readonly AnswerReference[];
  /**
   * Places in other repositories of the workspace, read as context and checked at their
   * recorded commit (DSP-175). Never reviewed, approved or covered. Absent when there are none.
   */
  readonly contextReferences?: readonly ContextReference[];
  /** DSP-185: pointers to other steps of the walk, by id, resolved by the window. Absent when there are none. */
  readonly stepReferences?: readonly StepReference[];
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
  readonly provider: 'cursor' | 'claude' | 'copilot';
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
  /** DSP-181, for a walk preparation: the profile the explanations are written in, and the instruction version. */
  readonly presentation?: { readonly profile: PresentationProfile; readonly version: number };
  /** DSP-189, for a walk preparation: how it was done. Absent on jobs before it, which were one call. */
  readonly method?: WalkMethod;
  /** DSP-189, for a walk preparation by the loop: what the run did, and where its record is. */
  readonly loop?: WalkLoopSummary;
  /** For a step question: the question, and its checked answer once there is one. */
  readonly question?: StepQuestion;
  readonly answer?: StepAnswer;
  /** For an explanation of selected code: the selection, and for a follow-up what it asks. */
  readonly selection?: CodeSelection;
  readonly followUp?: ExplainFollowUp;
  /** For an explanation of selected code: the person's own question about it, when asked. */
  readonly asked?: string;
  /** What the agent could read, and what it looked at (DSP-152 analysis access). */
  readonly material?: AgentMaterial;
  readonly investigation?: AgentInvestigation;
  /**
   * While it runs: what the agent is doing now, from what it reports (30 October 2026),
   * for instance the file it reads or the part of its answer it writes. Not kept after.
   */
  readonly activity?: string;
  /**
   * For a delegated review: the instruction it was sent, without the change and folder
   * sections that follow it (DSP-158), so what DSpatch told the agent can be read in the
   * window. Absent on older jobs.
   */
  readonly instruction?: string;
}

/**
 * What was once a choice of what counts as handled, kept only as it is stored.
 *
 * Niclas's decision of 30 October 2026 makes one rule for every review, old or new: a line
 * is reviewed when the person reviewed it, or when an agent approved it in a review the
 * person explicitly delegated; an exempted line is handled as exempted. There is no setting.
 * A record that stored `manual-or-agent` (the DSP-150 default) keeps the value on disk, with
 * its decisions, actors and history, but nothing reads it: an agent review that no delegated
 * job recorded counts nowhere, so a hidden old value never gives other results than what
 * the window shows. Nothing is approved anew when an older review opens.
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

/**
 * The settings walks are generated with (DSP-186): the agent and model, the presentation
 * profile and the version of DSpatch's instructions for it. A review records those current
 * when it was started and those its walks were last prepared with, so it can say when its
 * walks were prepared with earlier settings. Nothing is regenerated because of it.
 */
export interface ReviewGeneration {
  readonly provider: 'cursor' | 'claude' | 'copilot' | null;
  readonly model: string;
  readonly profile: PresentationProfile | null;
  /** `null` for walks prepared before instruction versions were recorded. */
  readonly instructionVersion: number | null;
  /** DSP-189: one call or the loop. Absent on records before it. */
  readonly method?: WalkMethod;
  readonly at: string;
}

export interface PairRecord {
  /** 2 since review ids (DSP-186); a stored version 1 record is read as a review whose id is its pair key. */
  readonly version: 2;
  /** The review's own id; the record file is `<id>.json`. */
  readonly id: string;
  /** When the review was started; for a review recorded before ids, when it was first saved, if known. */
  readonly createdAt: string;
  /** The instruction version current when the review was started; `null` when not known. */
  readonly startedWith: { readonly instructionVersion: number | null };
  /** What the review's walks were last prepared with, or `null` when none were. */
  readonly generation: ReviewGeneration | null;
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
  /**
   * What the person did in the review's threads (DSP-175): comments and decisions, under
   * each thread's identity. The threads themselves are read from the jobs' results, so a
   * finding is never copied with a status of its own.
   */
  readonly threads: readonly ThreadRecord[];
  /**
   * The points worth checking of the walks over this pair (DSP-175), read by the host from
   * the definitions so they are threads with the findings. Absent or empty in a record
   * written before; a walk opened again adopts its points then.
   */
  readonly checkSources?: readonly CheckSource[];
  readonly savedAt: string;
}

export function emptyRecord(pair: RevisionPairIdentity, id = '', createdAt = new Date(0).toISOString(), instructionVersion: number | null = null): PairRecord {
  return {
    version: 2,
    id,
    createdAt,
    startedWith: { instructionVersion },
    generation: null,
    pair,
    requirement: DEFAULT_REQUIREMENT,
    marks: [],
    agentReviews: [],
    jobs: [],
    agent: null,
    position: START_POSITION,
    walkDefinition: null,
    endedAt: null,
    threads: [],
    checkSources: [],
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
    ...((): Partial<StepAnswer> => {
      const context = (Array.isArray(raw['contextReferences']) ? raw['contextReferences'] : []).filter(isRecordObject).flatMap((entry) => {
        const range = contextRangeFrom(entry['range']);
        return range === null ? [] : [{ label: typeof entry['label'] === 'string' ? entry['label'] : '', range }];
      });
      return context.length === 0 ? {} : { contextReferences: context };
    })(),
    ...((): Partial<StepAnswer> => {
      const steps = stepReferencesFrom(raw['stepReferences']);
      return steps.length === 0 ? {} : { stepReferences: steps };
    })(),
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
  return {
    root: raw['root'],
    action: raw['action'],
    question: typeof raw['question'] === 'string' ? raw['question'] : '',
    ...(typeof raw['of'] === 'string' ? { of: raw['of'] } : {}),
  };
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
  if (raw['provider'] !== 'claude' && raw['provider'] !== 'cursor' && raw['provider'] !== 'copilot') {
    return null;
  }
  const state = JOB_STATES.includes(raw['state'] as AgentJobState) ? (raw['state'] as AgentJobState) : 'unknown';
  const scopeRaw = raw['scope'];
  const scope: DelegationScope | null =
    isRecordObject(scopeRaw) && (scopeRaw['kind'] === 'lines' || scopeRaw['kind'] === 'file' || scopeRaw['kind'] === 'walk')
      ? {
          kind: scopeRaw['kind'],
          label: typeof scopeRaw['label'] === 'string' ? scopeRaw['label'] : '',
          ranges: rangesFrom(scopeRaw['ranges']),
          ...(scopeRaw['kind'] === 'walk' && isDelegationBasis(scopeRaw['basis']) ? { basis: scopeRaw['basis'] } : {}),
        }
      : null;
  const resultRaw = raw['result'];
  const result: DelegationResult | null = isRecordObject(resultRaw)
    ? {
        assessment: typeof resultRaw['assessment'] === 'string' ? resultRaw['assessment'] : '',
        ...(typeof resultRaw['summary'] === 'string' && resultRaw['summary'] !== '' ? { summary: resultRaw['summary'] } : {}),
        reviewed: rangesFrom(resultRaw['reviewed']),
        approved: rangesFrom(resultRaw['approved']),
        findings: (Array.isArray(resultRaw['findings']) ? resultRaw['findings'] : [])
          .filter(isRecordObject)
          .map((finding) => ({
            severity: finding['severity'] === 'problem' || finding['severity'] === 'question' ? finding['severity'] : 'note',
            text: typeof finding['text'] === 'string' ? finding['text'] : '',
            location: rangeFrom(finding['location']),
            ...(typeof finding['title'] === 'string' && finding['title'] !== '' ? { title: finding['title'] } : {}),
            ...(typeof finding['details'] === 'string' && finding['details'] !== '' ? { details: finding['details'] } : {}),
            ...(typeof finding['evidence'] === 'string' && finding['evidence'] !== '' ? { evidence: finding['evidence'] } : {}),
            ...optionalRecommendation(finding['recommendation']),
            ...((): Partial<AgentFinding> => {
              const missing = finding['missing'];
              const range = isRecordObject(missing) ? rangeFrom(missing['range']) : null;
              return range === null || !isRecordObject(missing) ? {} : { missing: { range, reason: typeof missing['reason'] === 'string' ? missing['reason'] : '' } };
            })(),
            ...((): Partial<AgentFinding> => {
              const context = contextRangeFrom(finding['contextLocation']);
              return context === null ? {} : { contextLocation: context };
            })(),
          })),
        uncertainties: stringsFrom(resultRaw['uncertainties']),
        ...(Array.isArray(resultRaw['gaps'])
          ? {
              gaps: resultRaw['gaps'].filter(isRecordObject).flatMap((gap): AgentGap[] =>
                typeof gap['text'] === 'string' && gap['text'].trim() !== ''
                  ? [
                      {
                        text: gap['text'],
                        location: rangeFrom(gap['location']),
                        ...(typeof gap['evidence'] === 'string' && gap['evidence'] !== '' ? { evidence: gap['evidence'] } : {}),
                        ...(typeof gap['finding'] === 'string' && gap['finding'] !== '' ? { finding: gap['finding'] } : {}),
                        ...optionalRecommendation(gap['recommendation']),
                      },
                    ]
                  : [],
              ),
            }
          : {}),
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
        ...(typeof raw['asked'] === 'string' && raw['asked'] !== '' ? { asked: raw['asked'] } : {}),
        ...(material === null ? {} : { material }),
        ...(investigation === null ? {} : { investigation }),
        ...(typeof raw['activity'] === 'string' && state === 'running' ? { activity: raw['activity'] } : {}),
        ...(typeof raw['instruction'] === 'string' && raw['instruction'] !== '' ? { instruction: raw['instruction'] } : {}),
        ...((): Partial<AgentJob> => {
          const presentation = raw['presentation'];
          return isRecordObject(presentation) && isProfile(presentation['profile'])
            ? { presentation: { profile: presentation['profile'], version: typeof presentation['version'] === 'number' && Number.isInteger(presentation['version']) ? presentation['version'] : 0 } }
            : {};
        })(),
        // DSP-189: how the walks were prepared, and the loop's summary when they were prepared by it.
        ...(isWalkMethod(raw['method']) ? { method: raw['method'] } : {}),
        ...((): Partial<AgentJob> => {
          const loop = walkLoopSummaryFrom(raw['loop']);
          return loop === null ? {} : { loop };
        })(),
      };
    })(),
  };
}

/**
 * The agent of the window that opened a review. Unlike a stored choice its model may be
 * empty, or the provider's `default` alias: that is an agent running on the provider's
 * default, which the picker shows as the model the list marks as the default.
 */
export function openerChoiceFrom(raw: unknown): ReviewAgentChoice | null {
  if (!isRecordObject(raw) || (raw['provider'] !== 'cursor' && raw['provider'] !== 'claude' && raw['provider'] !== 'copilot')) {
    return null;
  }
  const model = typeof raw['model'] === 'string' ? raw['model'].trim() : '';
  return model.length > 200 ? null : { provider: raw['provider'], model: model === 'default' ? '' : model };
}

/** A stored agent choice, or `null` for none or one that does not name both. */
export function agentChoiceFrom(raw: unknown): ReviewAgentChoice | null {
  if (!isRecordObject(raw) || (raw['provider'] !== 'cursor' && raw['provider'] !== 'claude' && raw['provider'] !== 'copilot')) {
    return null;
  }
  const model = typeof raw['model'] === 'string' ? raw['model'].trim() : '';
  return model === '' || model.length > 200 ? null : { provider: raw['provider'], model };
}

export function scopeFrom(raw: unknown): MarkScope | null {
  if (isRecordObject(raw) && raw['kind'] === 'file') {
    return typeof raw['fileKey'] === 'string' && raw['fileKey'] !== '' ? { kind: 'file', fileKey: raw['fileKey'] } : null;
  }
  if (isRecordObject(raw) && raw['kind'] === 'job') {
    return typeof raw['jobId'] === 'string' && raw['jobId'] !== '' ? { kind: 'job', jobId: raw['jobId'] } : null;
  }
  return rangeFrom(raw);
}

/** Whether an op may be recorded over a scope: a decision about a job is accept, reject or clear; lines and files take the rest. */
export function markFits(op: PairMark['op'], scope: MarkScope): boolean {
  return scope.kind === 'job' ? op === 'accept-agent' || op === 'reject-agent' || op === 'clear' : op === 'manual' || op === 'exempt' || op === 'clear';
}

export const MARK_OPS: readonly PairMark['op'][] = ['manual', 'exempt', 'clear', 'accept-agent', 'reject-agent'];

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
export function adoptPairRecord(raw: unknown, pair: RevisionPairIdentity, id = ''): PairRecord {
  const empty = emptyRecord(pair, id);
  if (!isRecordObject(raw) || (raw['version'] !== 1 && raw['version'] !== 2) || !isRecordObject(raw['pair'])) {
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
    const op = (MARK_OPS as readonly unknown[]).includes(entry['op']) ? (entry['op'] as PairMark['op']) : null;
    if (scope === null || op === null || !markFits(op, scope) || typeof entry['id'] !== 'string') {
      continue;
    }
    marks.push({
      id: entry['id'],
      op,
      scope,
      reason: typeof entry['reason'] === 'string' ? entry['reason'] : '',
      at: typeof entry['at'] === 'string' ? entry['at'] : '',
      // An origin this version cannot read is left out, as an absent one: the mark itself holds.
      ...(isDecisionOrigin(entry['origin']) ? { origin: entry['origin'] } : {}),
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
  const savedAt = typeof raw['savedAt'] === 'string' ? raw['savedAt'] : empty.savedAt;
  const startedWith = isRecordObject(raw['startedWith']) ? raw['startedWith'] : {};
  return {
    version: 2,
    id: typeof raw['id'] === 'string' && raw['id'] !== '' ? raw['id'] : id,
    // A review recorded before ids says nothing of when it began; the earliest it knew of stands in.
    createdAt: typeof raw['createdAt'] === 'string' && raw['createdAt'] !== '' ? raw['createdAt'] : (jobs[0]?.startedAt ?? savedAt),
    startedWith: { instructionVersion: typeof startedWith['instructionVersion'] === 'number' && Number.isInteger(startedWith['instructionVersion']) ? startedWith['instructionVersion'] : null },
    generation: generationFrom(raw['generation']) ?? generationOfJobs(jobs),
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
    threads: threadRecordsFrom(raw['threads']),
    checkSources: checkSourcesFrom(raw['checkSources']),
    savedAt,
  };
}

function generationFrom(raw: unknown): ReviewGeneration | null {
  if (!isRecordObject(raw)) {
    return null;
  }
  const provider = raw['provider'];
  const version = raw['instructionVersion'];
  return {
    provider: provider === 'cursor' || provider === 'claude' || provider === 'copilot' ? provider : null,
    model: typeof raw['model'] === 'string' ? raw['model'] : '',
    profile: isProfile(raw['profile']) ? raw['profile'] : null,
    instructionVersion: typeof version === 'number' && Number.isInteger(version) ? version : null,
    ...(isWalkMethod(raw['method']) ? { method: raw['method'] } : {}),
    at: typeof raw['at'] === 'string' ? raw['at'] : '',
  };
}

/** What the latest walk preparation of a record was started with, for a record that says nothing of it. */
export function generationOfJobs(jobs: readonly AgentJob[]): ReviewGeneration | null {
  const latest = [...jobs].reverse().find((job) => job.kind === 'walks');
  return latest === undefined ? null : generationOfJob(latest);
}

export function generationOfJob(job: AgentJob): ReviewGeneration {
  return {
    provider: job.provider,
    model: job.model,
    profile: job.presentation?.profile ?? null,
    instructionVersion: job.presentation?.version ?? null,
    ...(job.method === undefined ? {} : { method: job.method }),
    at: job.startedAt,
  };
}

/**
 * Whether a review's walks were prepared with earlier settings than DSpatch's current
 * instructions (DSP-186): said in the window, never acted on by itself.
 */
export function generationStale(record: Pick<PairRecord, 'generation'>, currentInstructionVersion: number): boolean {
  return record.generation !== null && record.generation.instructionVersion !== currentInstructionVersion;
}

const CHECK_POINT_KINDS: readonly StoredCheck['kind'][] = ['question', 'uncertainty', 'finding'];

/** A stored point, or `null` for one with no title or no known kind. */
function storedCheckFrom(raw: unknown): StoredCheck | null {
  if (!isRecordObject(raw) || typeof raw['title'] !== 'string' || raw['title'].trim() === '' || !CHECK_POINT_KINDS.includes(raw['kind'] as StoredCheck['kind'])) {
    return null;
  }
  const text = (name: string): string => (typeof raw[name] === 'string' ? (raw[name] as string) : '');
  return {
    checkId: text('checkId'),
    kind: raw['kind'] as StoredCheck['kind'],
    title: text('title'),
    detail: text('detail'),
    reasoning: text('reasoning'),
    places: rangesFrom(raw['places']),
    ...(typeof raw['evidence'] === 'string' && raw['evidence'].trim() !== '' ? { evidence: raw['evidence'] } : {}),
    ...optionalRecommendation(raw['recommendation']),
    ...(raw['retired'] === true ? { retired: true } : {}),
  };
}

function checkSourcesFrom(raw: unknown): CheckSource[] {
  const out: CheckSource[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecordObject(entry) || typeof entry['definitionPath'] !== 'string' || entry['definitionPath'] === '') {
      continue;
    }
    const checks: StoredCheck[] = [];
    for (const check of Array.isArray(entry['checks']) ? entry['checks'] : []) {
      const read = storedCheckFrom(check);
      if (read !== null) {
        checks.push(read);
      }
    }
    out.push({
      definitionPath: entry['definitionPath'],
      jobId: typeof entry['jobId'] === 'string' && entry['jobId'] !== '' ? entry['jobId'] : null,
      reviewer: typeof entry['reviewer'] === 'string' ? entry['reviewer'] : '',
      at: typeof entry['at'] === 'string' ? entry['at'] : '',
      checks,
    });
  }
  return out;
}

/** One language of a definition text: English, else Swedish, else a plain string. */
function definitionText(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.trim();
  }
  if (!isRecordObject(raw)) {
    return '';
  }
  const en = typeof raw['en'] === 'string' ? raw['en'].trim() : '';
  const sv = typeof raw['sv'] === 'string' ? raw['sv'].trim() : '';
  return en || sv;
}

/**
 * The points worth checking of a walk definition's `checks` array, as written to a definition
 * or its checks file (`dspatch-review/2`, `dspatch-checks/1`). A place is kept when it names a
 * side, a relative path and 1-based lines; `isSafePath` says which paths the host accepts.
 * Text is read in English, else Swedish. Nothing is made up for a point that has none.
 */
export function storedChecksFromDefinition(raw: unknown, isSafePath: (filePath: string) => boolean): StoredCheck[] {
  const out: StoredCheck[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecordObject(entry)) {
      continue;
    }
    const title = definitionText(entry['title']);
    const kind = entry['kind'];
    if (title === '' || !CHECK_POINT_KINDS.includes(kind as StoredCheck['kind'])) {
      continue;
    }
    const places: LineRange[] = [];
    for (const place of Array.isArray(entry['places']) ? entry['places'] : []) {
      const range = isRecordObject(place) ? rangeFrom({ ...place, kind: 'lines' }) : null;
      if (range !== null && isSafePath(range.path) && !places.some((known) => known.side === range.side && known.path === range.path && known.start === range.start && known.end === range.end)) {
        places.push(range);
      }
    }
    const evidence = definitionText(entry['evidence']);
    out.push({
      checkId: typeof entry['id'] === 'string' ? entry['id'] : '',
      kind: kind as StoredCheck['kind'],
      title,
      detail: definitionText(entry['detail']),
      reasoning: definitionText(entry['reasoning']),
      places,
      ...(evidence === '' ? {} : { evidence }),
      ...optionalRecommendation(entry['recommendation']),
    });
  }
  return out;
}

const THREAD_EVENT_KINDS: readonly ThreadEventKind[] = ['comment', 'accept', 'keep-open', 'resolve', 'dismiss', 'reopen'];

/** What a window asks of a thread: one event, with the person's words. */
export interface ThreadActionRequest {
  readonly threadId: string;
  readonly kind: ThreadEventKind;
  readonly text: string;
}

/** A thread request as a window sent it, or why it is refused. */
export function threadActionFrom(raw: unknown): ThreadActionRequest | { readonly error: string } {
  if (!isRecordObject(raw) || typeof raw['threadId'] !== 'string' || raw['threadId'] === '' || !THREAD_EVENT_KINDS.includes(raw['kind'] as ThreadEventKind)) {
    return { error: 'That names no thread action.' };
  }
  const text = typeof raw['text'] === 'string' ? raw['text'].trim().slice(0, 20_000) : '';
  const kind = raw['kind'] as ThreadEventKind;
  if (kind === 'dismiss' && text === '') {
    return { error: 'Dismissing a thread needs a comment saying why.' };
  }
  if (kind === 'comment' && text === '') {
    return { error: 'An empty comment is not kept.' };
  }
  return { threadId: raw['threadId'], kind, text };
}

/** A recommendation as stored or as the agent wrote it; `null` when it says no action. */
export function recommendationFrom(raw: unknown): Recommendation | null {
  if (!isRecordObject(raw)) {
    return null;
  }
  const text = (name: string): string => (typeof raw[name] === 'string' ? (raw[name] as string).trim() : '');
  const action = text('action');
  if (action === '') {
    return null;
  }
  const kind = RECOMMENDATION_KINDS.includes(raw['kind'] as RecommendationKind) ? (raw['kind'] as RecommendationKind) : 'investigate';
  return { kind, action, rationale: text('rationale'), uncertainty: text('uncertainty'), nextStep: text('nextStep') };
}

function optionalRecommendation(raw: unknown): { readonly recommendation?: Recommendation } {
  const recommendation = recommendationFrom(raw);
  return recommendation === null ? {} : { recommendation };
}

function threadRecordsFrom(raw: unknown): ThreadRecord[] {
  const out: ThreadRecord[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecordObject(entry) || typeof entry['threadId'] !== 'string' || entry['threadId'] === '') {
      continue;
    }
    const events: ThreadEvent[] = [];
    for (const event of Array.isArray(entry['events']) ? entry['events'] : []) {
      if (!isRecordObject(event) || typeof event['id'] !== 'string' || !THREAD_EVENT_KINDS.includes(event['kind'] as ThreadEventKind)) {
        continue;
      }
      events.push({ id: event['id'], kind: event['kind'] as ThreadEventKind, at: typeof event['at'] === 'string' ? event['at'] : '', text: typeof event['text'] === 'string' ? event['text'] : '' });
    }
    out.push({ threadId: entry['threadId'], events });
  }
  return out;
}

function rangeHolds(range: LineRange, line: Pick<ChangedLine, 'side' | 'path' | 'line'>): boolean {
  return range.side === line.side && range.path === line.path && line.line >= range.start && line.line <= range.end;
}

/** What has been decided about one changed line. */
export interface LineStatus {
  /** The reviewer's latest decision about the line, or `null` when none holds. */
  readonly decision: PairMark | null;
  /** Every recorded agent review over the line: the agent's assessment, decided on or not. */
  readonly agent: readonly AgentReview[];
  /** Of those, the assessments the person has accepted (DSP-193): the only ones that count. */
  readonly accepted: readonly AgentReview[];
  /** Of those, the assessments the person has not decided on yet. */
  readonly awaiting: readonly AgentReview[];
}

/**
 * The status drawn in the strip: manual wins over agent; exempted is the person's decision;
 * `agent` is an assessment the person accepted; `assessed` one the person has not decided on.
 */
export type StripStatus = 'manual' | 'agent' | 'assessed' | 'exempt' | 'none';

export function stripStatusOf(status: LineStatus): StripStatus {
  if (status.decision?.op === 'manual') {
    return 'manual';
  }
  if (status.decision?.op === 'exempt') {
    return 'exempt';
  }
  if (status.accepted.length > 0) {
    return 'agent';
  }
  return status.awaiting.length > 0 ? 'assessed' : 'none';
}

/**
 * Whether a line is handled: a decision of the person's (reviewed or exempted), or an
 * assessment from a review the person delegated **and then accepted** (Niclas's decision of
 * 10 November 2026, DSP-193, which changes the one rule of 30 October 2026 for the agent's
 * part). A delegated review's result by itself handles nothing: it is the agent's assessment,
 * awaiting the person's; a failed, stopped, insufficient or unconfirmed job, a walk, an
 * explanation or a discussion assesses nothing either.
 */
export function isHandled(status: LineStatus): boolean {
  if (status.decision !== null) {
    return true;
  }
  return status.accepted.length > 0;
}

/** An agent's assessment that can count: recorded by a review the person delegated. */
export function isDelegatedApproval(review: Pick<AgentReview, 'jobId'>): boolean {
  return review.jobId !== undefined;
}

/** The person's latest decision about a delegated review, or `null` when none holds (DSP-193). */
export function delegationDecisionOf(record: Pick<PairRecord, 'marks'>, jobId: string): PairMark | null {
  let decision: PairMark | null = null;
  for (const mark of record.marks) {
    if (mark.scope.kind === 'job' && mark.scope.jobId === jobId) {
      decision = mark.op === 'clear' ? null : mark;
    }
  }
  return decision;
}

/** The delegated reviews whose assessment the person has accepted. */
export function acceptedJobsOf(record: Pick<PairRecord, 'marks'>): ReadonlySet<string> {
  const latest = new Map<string, PairMark['op']>();
  for (const mark of record.marks) {
    if (mark.scope.kind === 'job') {
      latest.set(mark.scope.jobId, mark.op);
    }
  }
  return new Set([...latest].filter(([, op]) => op === 'accept-agent').map(([jobId]) => jobId));
}

/** The delegated reviews the person has decided about, accepted or not. */
export function decidedJobsOf(record: Pick<PairRecord, 'marks'>): ReadonlySet<string> {
  const latest = new Map<string, PairMark['op']>();
  for (const mark of record.marks) {
    if (mark.scope.kind === 'job') {
      latest.set(mark.scope.jobId, mark.op);
    }
  }
  return new Set([...latest].filter(([, op]) => op !== 'clear').map(([jobId]) => jobId));
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
  const agent = record.agentReviews.filter((review) => rangeHolds(review.scope, line));
  const accepted = acceptedJobsOf(record);
  const decided = decidedJobsOf(record);
  return {
    decision,
    agent,
    accepted: agent.filter((review) => review.jobId !== undefined && accepted.has(review.jobId)),
    awaiting: agent.filter((review) => review.jobId !== undefined && !decided.has(review.jobId)),
  };
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
  /** Lines handled only through a delegated review the person accepted. */
  readonly agent: number;
  /** Lines not handled that an agent assessed as acceptable in a review the person has not decided on (DSP-193). */
  readonly assessed: number;
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
  let assessed = 0;
  for (const status of statuses.values()) {
    if (!isHandled(status)) {
      if (status.awaiting.length > 0) {
        assessed += 1;
      }
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
    assessed,
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
    if (status.decision === null) {
      for (const review of status.accepted) {
        agents.add(review.reviewer === '' ? 'Agent' : review.reviewer);
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

/** A review as the way into review lists it (DSP-186: every instance, open or closed). */
export interface OngoingReview {
  /** The review's id. */
  readonly key: string;
  /** Closed reviews are kept for reopening; they are listed apart. */
  readonly closed: boolean;
  readonly createdAt: string;
  /** Its walks were prepared with earlier settings than DSpatch's current ones. */
  readonly stale: boolean;
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
  | GapRow;

/**
 * A run of unchanged lines folded away. `base` and `target` are its first hidden line on
 * each side. `down` says there is a change above it, from which more lines can be shown
 * downwards; `up` that there is one below it, from which more can be shown upwards.
 */
export interface GapRow {
  readonly kind: 'gap';
  readonly id: string;
  readonly base: number;
  readonly target: number;
  readonly count: number;
  readonly down: boolean;
  readonly up: boolean;
}

/**
 * How far one folded run has been opened (Niclas's trial of 30 October 2026): lines shown
 * downwards from the change above it and upwards from the change below it, or all of it.
 */
export type GapExpansion = { readonly down: number; readonly up: number } | 'all';

/**
 * How a file's diff is opened: the whole file, or folded runs opened run by run, by the
 * run's id. Kept per file for as long as the review is open, whichever layout shows it.
 */
export interface FileExpansion {
  readonly whole: boolean;
  readonly gaps: Readonly<Record<string, GapExpansion>>;
}

export const NO_EXPANSION: FileExpansion = { whole: false, gaps: {} };

/** How many more lines one press of *Show more lines* opens. */
export const MORE_LINES = 20;

/** A run opened further in one direction, or all of it. */
export function expandGap(expansion: FileExpansion, gap: Pick<GapRow, 'id'>, how: 'down' | 'up' | 'all'): FileExpansion {
  const before = expansion.gaps[gap.id];
  const opened: GapExpansion =
    how === 'all' || before === 'all'
      ? 'all'
      : { down: (before?.down ?? 0) + (how === 'down' ? MORE_LINES : 0), up: (before?.up ?? 0) + (how === 'up' ? MORE_LINES : 0) };
  return { ...expansion, gaps: { ...expansion.gaps, [gap.id]: opened } };
}

/** The run that hides a line of one side, if one does. */
export function gapHiding(rows: readonly UnifiedRow[], side: LineSide, line: number): GapRow | null {
  for (const row of rows) {
    if (row.kind === 'gap') {
      const first = side === 'base' ? row.base : row.target;
      if (line >= first && line < first + row.count) {
        return row;
      }
    }
  }
  return null;
}

/** One row of a side-by-side diff; either side may be empty. */
export interface SplitRow {
  readonly kind: 'context' | 'change' | 'gap';
  readonly base: number | null;
  readonly target: number | null;
  /** For a gap: the folded run. */
  readonly gap?: GapRow;
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

/**
 * How many unchanged lines stay visible around a change before the rest fold away. Ten
 * since Niclas's trial of 30 October 2026, where three were too few to read a change by.
 */
export const CONTEXT_LINES = 10;

function sameRows(
  segment: Segment,
  first: boolean,
  last: boolean,
  expansion: FileExpansion,
): { readonly lines: readonly { base: number; target: number }[]; readonly gap: (GapRow & { readonly at: number }) | null } {
  const count = segment.baseCount;
  const id = `gap-${String(segment.baseStart)}-${String(segment.targetStart)}`;
  const all = Array.from({ length: count }, (_, index) => ({ base: segment.baseStart + index, target: segment.targetStart + index }));
  const opened = expansion.gaps[id];
  if (expansion.whole || opened === 'all') {
    return { lines: all, gap: null };
  }
  // Lines below the change above the run, and above the change below it.
  const keepBefore = first ? 0 : CONTEXT_LINES + (opened?.down ?? 0);
  const keepAfter = last ? 0 : CONTEXT_LINES + (opened?.up ?? 0);
  // Where the two meet, the run is shown whole: never a fold of one line, never a line twice.
  if (count <= keepBefore + keepAfter + 1) {
    return { lines: all, gap: null };
  }
  const head = all.slice(0, keepBefore);
  const tail = all.slice(count - keepAfter);
  const hidden = all[keepBefore] as { base: number; target: number };
  return {
    lines: [...head, ...tail],
    gap: { kind: 'gap', at: head.length, id, base: hidden.base, target: hidden.target, count: count - keepBefore - keepAfter, down: !first, up: !last },
  };
}

/**
 * The unified rows of a file, with long unchanged runs folded into gaps as `expansion`
 * leaves them. A set of ids is the earlier form: each named run, or `'*'` for all, opened.
 */
export function unifiedRowsOf(
  file: PairFile,
  baseLength: number,
  targetLength: number,
  expansion: FileExpansion | ReadonlySet<string> = NO_EXPANSION,
): readonly UnifiedRow[] {
  const opened: FileExpansion =
    expansion instanceof Set
      ? { whole: expansion.has('*'), gaps: Object.fromEntries([...expansion].map((id) => [id, 'all' as const])) }
      : (expansion as FileExpansion);
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
    const { lines, gap } = sameRows(segment, index === 0, index === segments.length - 1, opened);
    lines.forEach((line, at) => {
      if (gap !== null && gap.at === at) {
        const { at: _at, ...row } = gap;
        rows.push(row);
      }
      rows.push({ kind: 'context', base: line.base, target: line.target });
    });
    if (gap !== null && gap.at === lines.length) {
      const { at: _at, ...row } = gap;
      rows.push(row);
    }
  });
  return rows;
}

/** The side-by-side rows of a file: a hunk's deletions and additions paired line by line. */
export function splitRowsOf(
  file: PairFile,
  baseLength: number,
  targetLength: number,
  expansion: FileExpansion | ReadonlySet<string> = NO_EXPANSION,
): readonly SplitRow[] {
  const rows: SplitRow[] = [];
  const unified = unifiedRowsOf(file, baseLength, targetLength, expansion);
  let index = 0;
  while (index < unified.length) {
    const row = unified[index] as UnifiedRow;
    if (row.kind === 'context') {
      rows.push({ kind: 'context', base: row.base, target: row.target });
      index += 1;
      continue;
    }
    if (row.kind === 'gap') {
      rows.push({ kind: 'gap', base: row.base, target: row.target, gap: row });
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
  /** DSP-175: the review thread to choose there, when a thread was shown in the diff. */
  readonly threadId?: string;
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
  | { readonly kind: 'pair'; readonly pair: RevisionPairIdentity; readonly at: DiffLocation | null; readonly review?: string }
  /** DSP-190: a window that follows one walk preparation of a review, running or finished. */
  | { readonly kind: 'follow'; readonly review: string; readonly jobId: string; readonly pair: RevisionPairIdentity; readonly label: string };

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
  readContextFile: 'dspatch:review-pair-read-context-file',
  state: 'dspatch:review-pair-state',
  mark: 'dspatch:review-pair-mark',
  savePosition: 'dspatch:review-pair-save-position',
  walks: 'dspatch:review-pair-walks',
  openWalk: 'dspatch:review-pair-open-walk',
  openWalks: 'dspatch:review-pair-open-walks',
  ongoing: 'dspatch:review-pair-ongoing',
  end: 'dspatch:review-pair-end',
  delete: 'dspatch:review-pair-delete',
  showInDiff: 'dspatch:review-pair-show-in-diff',
  agents: 'dspatch:review-pair-agents',
  startJob: 'dspatch:review-pair-start-job',
  cancelJob: 'dspatch:review-pair-cancel-job',
  walkLoopRecord: 'dspatch:review-pair-walk-loop-record',
  walkLoopRunView: 'dspatch:review-pair-walk-loop-run-view',
  openFollow: 'dspatch:review-pair-open-follow',
  thread: 'dspatch:review-pair-thread',
} as const;

/** A pair's record changed; sent to every review window over that pair. */
export const REVIEW_PAIR_CHANGED = 'dspatch:review-pair-changed';

/** The diff window is asked to show a place (from `Show in diff`). */
export const REVIEW_PAIR_NAVIGATE = 'dspatch:review-pair-navigate';

export interface MarkRequestInput {
  readonly op: PairMark['op'];
  readonly scopes: readonly MarkScope[];
  readonly reason: string;
  /** Where the decision is made (DSP-201). A host from before it ignores the field. */
  readonly origin?: DecisionOrigin;
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
  /**
   * DSP-186: `{ review }` opens that review again (a closed one becomes open); a pair starts
   * a new review of it, empty, whatever reviews of the same pair there are.
   */
  open(request: RevisionPairIdentity | { readonly review: string }): Promise<PairOpenOutcome>;
  /** In a walk window: the pair the walk is over, opened so decisions share its record. */
  forWalk(): Promise<PairAnswer<OpenPair>>;
  readFile(key: string, side: LineSide, path: string): Promise<PairAnswer<{ readonly text: string | null; readonly binary: boolean }>>;
  /**
   * DSP-175: a file of another repository of the review's workspace, at the commit recorded
   * when it was given to an agent as context. Only a repository and commit this review gave
   * as context; read from Git, never from a working copy. Reading it reviews nothing.
   */
  readContextFile(key: string, repository: string, path: string, commit: string): Promise<PairAnswer<ContextFileView>>;
  state(key: string): Promise<PairAnswer<PairRecord>>;
  mark(key: string, request: MarkRequestInput): Promise<PairAnswer<PairRecord>>;
  savePosition(key: string, position: PairPosition): Promise<PairAnswer<{ readonly saved: true }>>;
  walks(key: string): Promise<PairAnswer<readonly PairWalk[]>>;
  /**
   * Open one walk definition over the pair in the review's walk window: the open one is
   * reused (one walk window per review), else one is made. Its record keeps its position.
   */
  openWalk(key: string, definitionPath: string): Promise<{ readonly ok: boolean; readonly note: string }>;
  /** *Code walks*: the walk last opened from this review (else the newest), in its walk window. */
  openWalks(key: string): Promise<{ readonly ok: boolean; readonly note: string }>;
  /** Every review, open and closed, newest first, for the way into review. Reads; starts nothing. */
  ongoing(): Promise<readonly OngoingReview[]>;
  /** Close a review: it is kept for reopening. Approves nothing and deletes nothing. */
  end(review: string): Promise<PairAnswer<{ readonly ended: true }>>;
  /**
   * DSP-186: delete a review and only its own data: its record, walks, discussion,
   * explanations and walk positions. Its windows close and its agent work is stopped first.
   * Never source code, never another review.
   */
  delete(review: string): Promise<PairAnswer<{ readonly deleted: true }>>;
  showInDiff(location: DiffLocation): Promise<{ readonly ok: boolean; readonly note: string }>;
  /** DSP-152: the agents that can prepare walks or review a delegated part here. */
  agents(key: string): Promise<PairAnswer<ReviewAgents>>;
  startJob(key: string, request: AgentJobRequestInput): Promise<PairAnswer<AgentJob>>;
  cancelJob(key: string, jobId: string): Promise<PairAnswer<{ readonly note: string }>>;
  /** DSP-189: a walk loop's record, read on request: every prompt and answer, and the journal. */
  walkLoopRecord(key: string, jobId: string): Promise<PairAnswer<WalkLoopRecordView>>;
  /**
   * DSP-190: the walk loop run as it stands, for a window that follows it: the run view and the
   * activity so far while it runs, or what its files hold afterwards. A read: starts nothing.
   */
  walkLoopRunView(key: string, jobId: string): Promise<PairAnswer<WalkLoopRunSnapshot>>;
  /** DSP-190: open (or bring to the front) the window that follows this preparation. Starts nothing. */
  openFollow(key: string, jobId: string): Promise<{ readonly ok: boolean; readonly note: string }>;
  /** DSP-190: the run events of every walk loop of this window's review; the listener drops what is not its job's. */
  onRunEvent(listener: (event: WalkLoopRunEvent) => void): () => void;
  /**
   * DSP-175: a person's comment or decision in a review thread. It records what the person
   * did; it never runs anything, never approves lines and never changes an agent's result.
   */
  thread(key: string, request: ThreadActionRequest): Promise<PairAnswer<PairRecord>>;
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

// --- The review's panel (Niclas's decision of 30 October 2026) ---------------------------

/**
 * Where the review's panel is: the whole right panel, Step and Discussion, belongs to the
 * review (repository and revision pair), not to a window. It is in a window of its own by
 * default, or docked in the review's diff window or its walk window, one place at a time.
 */
export type PanelPlace = 'window' | 'diff' | 'walk';

/** What the panel, and a window it may dock in, are told about where it is. */
export interface PanelState {
  readonly place: PanelPlace;
  readonly visible: boolean;
  /** The windows of the same review it may dock in now. */
  readonly offers: { readonly diff: boolean; readonly walk: boolean };
  /** For a code window: the panel is docked here, in the slot this window keeps for it. */
  readonly dockedHere: boolean;
}

/** Where the walk window is, so the panel's Step follows it. */
export interface PanelFollow {
  readonly definitionPath: string;
  readonly stepId: string | null;
  readonly placeIndex: number;
  readonly refIndex: number;
  readonly checkId: string | null;
  /** The way back from the open point, as the walk window names it; `null` when there is none. */
  readonly checkBack: string | null;
}

/** What the panel asks a code window of the same review to do. */
export type PanelAction =
  | { readonly kind: 'goToStep'; readonly stepId: string; readonly placeIndex: number }
  | { readonly kind: 'openLocation'; readonly location: { readonly side: LineSide; readonly path: string; readonly start: number; readonly end: number } }
  | { readonly kind: 'openCheck'; readonly checkId: string }
  /** Close the open point and go back to where it was opened from. */
  | { readonly kind: 'closeCheck' };

export const REVIEW_PANEL_CHANNELS = {
  show: 'dspatch:review-panel-show',
  dock: 'dspatch:review-panel-dock',
  hide: 'dspatch:review-panel-hide',
  slot: 'dspatch:review-panel-slot',
  follow: 'dspatch:review-panel-follow',
  lastFollow: 'dspatch:review-panel-last-follow',
  action: 'dspatch:review-panel-action',
  state: 'dspatch:review-panel-state',
} as const;

/** The review panel's bridge (`window.dspatchReviewPanel`), in every review window. */
export interface ReviewPanelBridge {
  /**
   * Show the review's panel where it is, opening it when it is not open; `ask` puts the
   * cursor in the discussion's question. From a code window, `key` is its pair's. `tab`
   * `'step'` shows the step (a point worth checking opened), without taking the focus.
   */
  show(key: string | null, ask: boolean, tab?: 'step' | 'discussion'): Promise<{ readonly ok: boolean; readonly note: string }>;
  /** From the panel: move it to its own window or dock it in a code window of the review. */
  dock(place: PanelPlace): Promise<void>;
  /** From the panel: hide it. Nothing running stops; the next show brings it back as it was. */
  hide(): Promise<void>;
  /** From a code window: where it keeps room for the panel docked in it, in its own coordinates. */
  slot(rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null): void;
  /** From the walk window: where it is, for the panel's Step. */
  follow(position: PanelFollow): void;
  /** From the panel: the walk window's last position, when it opens. */
  lastFollow(): Promise<PanelFollow | null>;
  /** Where the review's panel is now, as this window is to know it; `null` when it is not open. */
  state(): Promise<PanelState | null>;
  /** From the panel: something for a code window of the review to do. */
  action(action: PanelAction): void;
  onFollow(listener: (position: PanelFollow) => void): () => void;
  onAction(listener: (action: PanelAction) => void): () => void;
  onState(listener: (state: PanelState) => void): () => void;
}
