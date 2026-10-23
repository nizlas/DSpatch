/**
 * The review surface's model: a prepared walk definition, the real diff of a fixed
 * revision pair, and the reviewer's own record — kept as three separate things.
 *
 * Review stands alone (VISION §3.3): a repository and two identified revisions are
 * the whole input. Nothing here knows about tasks, loops, the graph editor or an
 * agent run. The walks are prepared material read from a file (VISION §3.4 "prepared
 * walks can test whether the interaction helps before automatic generation is
 * integrated"); nothing in this module or the view generates or adapts them.
 *
 * Three kinds of state are never merged, because merging them is how a review starts
 * to lie (REVIEW_COVERAGE_AND_CODE_WALKS.md §3, TASK_MANAGEMENT §11):
 *
 * - **planned**: what a walk's references cover. A property of the material.
 * - **shown / walked through**: what the reviewer has had on screen in a walk, and
 *   what they have explicitly marked as walked through. Neither is a judgement.
 * - **decided**: an explicit human decision about an identified scope at the
 *   reviewed revision pair, with its provenance. Only this is a review outcome.
 *
 * Pure functions only, so the main process, the renderer and the tests share one
 * reading of the same data.
 */

// --- The prepared definition ---------------------------------------------------

export const REVIEW_DEFINITION_FORMAT = 'dspatch-review/1';

/** Which revision a reference reads. Removed code exists only on `base`. */
export type RevisionSide = 'base' | 'target';

/**
 * What a reference is for. Only `walk` references count as planned coverage of
 * changed lines; `evidence` points at tests or logs the step relies on, `context`
 * at code worth reading that the walk does not claim to cover.
 */
export type ReferenceRole = 'walk' | 'evidence' | 'context';

/**
 * How a statement in a step is supported. The prepared material's own labels; the
 * view shows them verbatim and never upgrades one.
 */
export type EvidenceLabel = 'analysis' | 'test-simulated' | 'test-real-substitute' | 'not-observed';

export const EVIDENCE_LABELS: readonly EvidenceLabel[] = [
  'analysis',
  'test-simulated',
  'test-real-substitute',
  'not-observed',
];

export interface CodeReference {
  readonly path: string;
  readonly side: RevisionSide;
  /** 1-based, inclusive. */
  readonly start: number;
  readonly end: number;
  readonly role: ReferenceRole;
  /**
   * Text that must occur somewhere in the range at that revision. Checked when the
   * review opens, so a reference that points at the wrong lines is reported rather
   * than highlighted with confidence.
   */
  readonly anchor?: string;
  readonly note?: string;
}

export interface StepClaim {
  readonly label: EvidenceLabel;
  readonly text: string;
}

export interface WalkStep {
  readonly id: string;
  readonly title: string;
  /** Markdown, rendered by the existing safe Markdown component. */
  readonly text: string;
  /** The first reference is the one the step opens on. */
  readonly refs: readonly CodeReference[];
  readonly claims: readonly StepClaim[];
}

export interface Walk {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly steps: readonly WalkStep[];
}

export interface ReviewDefinition {
  readonly format: typeof REVIEW_DEFINITION_FORMAT;
  readonly title: string;
  /** Repository path, absolute or relative to the definition file. */
  readonly repository: string;
  readonly base: string;
  readonly target: string;
  /** How the prepared text was written. Information, not a control. */
  readonly teachingMode: string;
  /** Free text shown with the walks: where the material came from and its limits. */
  readonly provenance: string;
  readonly walks: readonly Walk[];
}

export interface DefinitionProblem {
  readonly where: string;
  readonly problem: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string, where: string, problems: DefinitionProblem[]): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push({ where, problem: `"${key}" must be a non-empty string.` });
    return '';
  }
  return value;
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Read a definition, reporting every structural problem rather than the first.
 * Returns `null` only when the shape is too broken to show anything.
 */
export function parseReviewDefinition(raw: unknown): {
  readonly definition: ReviewDefinition | null;
  readonly problems: readonly DefinitionProblem[];
} {
  const problems: DefinitionProblem[] = [];
  if (!isRecord(raw)) {
    return { definition: null, problems: [{ where: 'file', problem: 'The file is not a JSON object.' }] };
  }
  if (raw['format'] !== REVIEW_DEFINITION_FORMAT) {
    problems.push({
      where: 'file',
      problem: `"format" must be "${REVIEW_DEFINITION_FORMAT}", found ${JSON.stringify(raw['format'])}.`,
    });
  }
  const title = str(raw, 'title', 'file', problems);
  const repository = str(raw, 'repository', 'file', problems);
  const base = str(raw, 'base', 'file', problems);
  const target = str(raw, 'target', 'file', problems);
  for (const [key, value] of [
    ['base', base],
    ['target', target],
  ] as const) {
    if (value !== '' && !/^[0-9a-f]{40}$/i.test(value)) {
      problems.push({
        where: 'file',
        problem: `"${key}" is "${value}", not a full commit SHA. It was resolved when the review opened, but a branch or short name can move; name the commit in full.`,
      });
    }
  }
  const teachingMode = typeof raw['teachingMode'] === 'string' ? raw['teachingMode'] : '';
  const provenance = typeof raw['provenance'] === 'string' ? raw['provenance'] : '';
  const walksRaw = raw['walks'];
  const walks: Walk[] = [];
  const seenIds = new Set<string>();
  if (!Array.isArray(walksRaw)) {
    problems.push({ where: 'file', problem: '"walks" must be an array.' });
  } else {
    walksRaw.forEach((walkRaw: unknown, walkIndex) => {
      const where = `walks[${String(walkIndex)}]`;
      if (!isRecord(walkRaw)) {
        problems.push({ where, problem: 'A walk must be an object.' });
        return;
      }
      const id = str(walkRaw, 'id', where, problems);
      if (seenIds.has(id)) {
        problems.push({ where, problem: `Duplicate id "${id}".` });
      }
      seenIds.add(id);
      const steps: WalkStep[] = [];
      const stepsRaw = walkRaw['steps'];
      if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
        problems.push({ where, problem: '"steps" must be a non-empty array.' });
      } else {
        stepsRaw.forEach((stepRaw: unknown, stepIndex) => {
          const stepWhere = `${id || where}.steps[${String(stepIndex)}]`;
          if (!isRecord(stepRaw)) {
            problems.push({ where: stepWhere, problem: 'A step must be an object.' });
            return;
          }
          const stepId = str(stepRaw, 'id', stepWhere, problems);
          if (seenIds.has(stepId)) {
            problems.push({ where: stepWhere, problem: `Duplicate id "${stepId}".` });
          }
          seenIds.add(stepId);
          const refs: CodeReference[] = [];
          const refsRaw = stepRaw['refs'];
          if (!Array.isArray(refsRaw) || refsRaw.length === 0) {
            problems.push({ where: stepWhere, problem: '"refs" must be a non-empty array.' });
          } else {
            refsRaw.forEach((refRaw: unknown, refIndex) => {
              const refWhere = `${stepId || stepWhere}.refs[${String(refIndex)}]`;
              if (!isRecord(refRaw)) {
                problems.push({ where: refWhere, problem: 'A reference must be an object.' });
                return;
              }
              const path = str(refRaw, 'path', refWhere, problems);
              const side = refRaw['side'];
              const role = refRaw['role'];
              const start = refRaw['start'];
              const end = refRaw['end'];
              if (side !== 'base' && side !== 'target') {
                problems.push({ where: refWhere, problem: '"side" must be "base" or "target".' });
              }
              if (role !== 'walk' && role !== 'evidence' && role !== 'context') {
                problems.push({ where: refWhere, problem: '"role" must be "walk", "evidence" or "context".' });
              }
              if (!positiveInt(start) || !positiveInt(end) || end < start) {
                problems.push({ where: refWhere, problem: '"start" and "end" must be 1-based lines with start ≤ end.' });
              }
              if (path.includes('\\') || path.startsWith('/')) {
                problems.push({ where: refWhere, problem: 'Paths are repository-relative with forward slashes.' });
              }
              if (
                (side === 'base' || side === 'target') &&
                (role === 'walk' || role === 'evidence' || role === 'context') &&
                positiveInt(start) &&
                positiveInt(end) &&
                end >= start
              ) {
                refs.push({
                  path,
                  side,
                  start,
                  end,
                  role,
                  ...(typeof refRaw['anchor'] === 'string' ? { anchor: refRaw['anchor'] } : {}),
                  ...(typeof refRaw['note'] === 'string' ? { note: refRaw['note'] } : {}),
                });
              }
            });
          }
          const claims: StepClaim[] = [];
          const claimsRaw = stepRaw['claims'];
          if (claimsRaw !== undefined && !Array.isArray(claimsRaw)) {
            problems.push({ where: stepWhere, problem: '"claims" must be an array when present.' });
          } else if (Array.isArray(claimsRaw)) {
            claimsRaw.forEach((claimRaw: unknown, claimIndex) => {
              const claimWhere = `${stepId || stepWhere}.claims[${String(claimIndex)}]`;
              if (!isRecord(claimRaw)) {
                problems.push({ where: claimWhere, problem: 'A claim must be an object.' });
                return;
              }
              const label = claimRaw['label'];
              if (!EVIDENCE_LABELS.includes(label as EvidenceLabel)) {
                problems.push({
                  where: claimWhere,
                  problem: `"label" must be one of ${EVIDENCE_LABELS.join(', ')}.`,
                });
                return;
              }
              claims.push({ label: label as EvidenceLabel, text: str(claimRaw, 'text', claimWhere, problems) });
            });
          }
          steps.push({
            id: stepId,
            title: str(stepRaw, 'title', stepWhere, problems),
            text: str(stepRaw, 'text', stepWhere, problems),
            refs,
            claims,
          });
        });
      }
      walks.push({
        id,
        title: str(walkRaw, 'title', where, problems),
        question: str(walkRaw, 'question', where, problems),
        steps,
      });
    });
  }
  return {
    definition: {
      format: REVIEW_DEFINITION_FORMAT,
      title,
      repository,
      base,
      target,
      teachingMode,
      provenance,
      walks,
    },
    problems,
  };
}

/**
 * Check one reference against the file it names at its revision. `lines` is the
 * file's content split into lines, or `null` when the file does not exist there.
 */
export function checkReference(ref: CodeReference, lines: readonly string[] | null): string | null {
  if (lines === null) {
    return `${ref.path} does not exist at ${ref.side}.`;
  }
  if (ref.end > lines.length) {
    return `${ref.path} has ${String(lines.length)} lines at ${ref.side}; the reference ends at ${String(ref.end)}.`;
  }
  if (ref.anchor !== undefined) {
    const range = lines.slice(ref.start - 1, ref.end);
    if (!range.some((line) => line.includes(ref.anchor ?? ''))) {
      return `"${ref.anchor}" does not occur in ${ref.path}:${String(ref.start)}–${String(ref.end)} at ${ref.side}.`;
    }
  }
  return null;
}

// --- The real diff ---------------------------------------------------------------

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'type-changed';

/** One hunk of `git diff -U0`: the exact changed lines, nothing else. */
export interface DiffHunk {
  /** Stable for the fixed revision pair: diff order across the whole change, from 1. */
  readonly id: string;
  readonly path: string;
  readonly baseStart: number;
  readonly baseCount: number;
  readonly targetStart: number;
  readonly targetCount: number;
}

export interface DiffFile {
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly binary: boolean;
  readonly hunks: readonly DiffHunk[];
  readonly added: number;
  readonly deleted: number;
}

/** `git diff --name-status -z` output, as path and status letter. */
export function parseNameStatus(text: string): readonly { path: string; status: FileChangeStatus }[] {
  const parts = text.split('\0').filter((part) => part !== '');
  const out: { path: string; status: FileChangeStatus }[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const letter = (parts[index] ?? '').charAt(0);
    const path = parts[index + 1] ?? '';
    const status: FileChangeStatus | null =
      letter === 'A' ? 'added' : letter === 'M' ? 'modified' : letter === 'D' ? 'deleted' : letter === 'T' ? 'type-changed' : null;
    if (status === null) {
      throw new Error(`Unexpected name-status "${parts[index] ?? ''}" for ${path}; renames and copies are not detected here.`);
    }
    out.push({ path, status });
  }
  return out;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripPathPrefix(raw: string, prefix: 'a/' | 'b/'): string | null {
  // git appends a tab to a ---/+++ path containing a space.
  const trimmed = raw.replace(/\t$/, '');
  if (trimmed === '/dev/null') {
    return null;
  }
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

/**
 * Combine `--name-status` (the authority on which files changed) with `-U0` output
 * (the hunks). Every listed file must have a section, in the same order, and every
 * section must name the file it is matched to — a mismatch throws instead of
 * producing a diff that silently lacks a file.
 */
export function parseDiff(
  nameStatus: readonly { path: string; status: FileChangeStatus }[],
  unifiedZero: string,
): readonly DiffFile[] {
  const sections = unifiedZero.split(/^diff --git /m).slice(1);
  if (sections.length !== nameStatus.length) {
    throw new Error(
      `git listed ${String(nameStatus.length)} changed files but the diff has ${String(sections.length)} sections.`,
    );
  }
  let hunkNumber = 0;
  return nameStatus.map((entry, index) => {
    const section = sections[index] ?? '';
    const lines = section.split('\n');
    let binary = false;
    const hunks: DiffHunk[] = [];
    let added = 0;
    let deleted = 0;
    // File headers come before the first hunk. After it, a line that starts with
    // `--- ` is a deleted line whose text begins with `-- `, not a header.
    let inHunks = false;
    for (const line of lines) {
      if (!inHunks && line.startsWith('Binary files ')) {
        binary = true;
      } else if (!inHunks && line.startsWith('--- ')) {
        const named = stripPathPrefix(line.slice(4), 'a/');
        if (named !== null && named !== entry.path) {
          throw new Error(`Diff section ${String(index + 1)} names ${named}, expected ${entry.path}.`);
        }
      } else if (!inHunks && line.startsWith('+++ ')) {
        const named = stripPathPrefix(line.slice(4), 'b/');
        if (named !== null && named !== entry.path) {
          throw new Error(`Diff section ${String(index + 1)} names ${named}, expected ${entry.path}.`);
        }
      } else {
        const match = HUNK_HEADER.exec(line);
        if (match !== null) {
          inHunks = true;
          hunkNumber += 1;
          const baseCount = match[2] === undefined ? 1 : Number(match[2]);
          const targetCount = match[4] === undefined ? 1 : Number(match[4]);
          hunks.push({
            id: `H${String(hunkNumber)}`,
            path: entry.path,
            baseStart: Number(match[1]),
            baseCount,
            targetStart: Number(match[3]),
            targetCount,
          });
          added += targetCount;
          deleted += baseCount;
        }
      }
    }
    return { path: entry.path, status: entry.status, binary, hunks, added, deleted };
  });
}

/** Split file content into lines without their terminators. A final newline adds no line. */
export function splitLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export interface DiffRow {
  readonly kind: 'context' | 'deleted' | 'added';
  readonly baseLine: number | null;
  readonly targetLine: number | null;
  readonly text: string;
  readonly hunkId: string | null;
}

/**
 * Every line of both versions in diff order: unchanged lines once, with both line
 * numbers; deleted then added lines at each hunk. The view decides what to collapse;
 * this never drops a line. Throws if the hunks and the contents disagree, because a
 * diff drawn from inconsistent inputs would show the wrong code with confidence.
 */
export function buildDiffRows(
  baseLines: readonly string[],
  targetLines: readonly string[],
  hunks: readonly DiffHunk[],
): DiffRow[] {
  const rows: DiffRow[] = [];
  let b = 1;
  let t = 1;
  const context = (untilBase: number, untilTarget: number): void => {
    if (untilBase - b !== untilTarget - t) {
      throw new Error(
        `Hunks do not match the file contents: ${String(untilBase - b)} base and ${String(untilTarget - t)} target context lines.`,
      );
    }
    while (b < untilBase) {
      rows.push({ kind: 'context', baseLine: b, targetLine: t, text: targetLines[t - 1] ?? '', hunkId: null });
      b += 1;
      t += 1;
    }
  };
  for (const hunk of hunks) {
    // With a count of 0, git's start is the line *after which* the change happens.
    const baseFirst = hunk.baseCount === 0 ? hunk.baseStart + 1 : hunk.baseStart;
    const targetFirst = hunk.targetCount === 0 ? hunk.targetStart + 1 : hunk.targetStart;
    context(baseFirst, targetFirst);
    for (let index = 0; index < hunk.baseCount; index += 1) {
      rows.push({ kind: 'deleted', baseLine: b, targetLine: null, text: baseLines[b - 1] ?? '', hunkId: hunk.id });
      b += 1;
    }
    for (let index = 0; index < hunk.targetCount; index += 1) {
      rows.push({ kind: 'added', baseLine: null, targetLine: t, text: targetLines[t - 1] ?? '', hunkId: hunk.id });
      t += 1;
    }
  }
  context(baseLines.length + 1, targetLines.length + 1);
  return rows;
}

// --- The reviewer's record ------------------------------------------------------

export interface RevisionPair {
  readonly base: string;
  readonly target: string;
}

export interface CodeLocation {
  readonly path: string;
  readonly side: RevisionSide;
  readonly start: number;
  readonly end: number;
}

/** Who made a decision. Only `human` is produced by this increment. */
export type DecisionProvenance =
  | { readonly kind: 'human' }
  /** Reserved for delegated agent review under an explicit mandate. Never simulated. */
  | { readonly kind: 'agent-delegated'; readonly adapterId: string; readonly mandate: string };

export type DecisionScope =
  | { readonly kind: 'hunk'; readonly path: string; readonly hunkId: string }
  | { readonly kind: 'file'; readonly path: string; readonly hunkIds: readonly string[] };

export interface ReviewDecision {
  readonly id: string;
  readonly scope: DecisionScope;
  /** `withdrawn` returns the scope to remaining; the history keeps the earlier entry. */
  readonly outcome: 'accepted' | 'exempted' | 'withdrawn';
  readonly reason: string;
  readonly by: DecisionProvenance;
  readonly at: string;
  readonly revisions: RevisionPair;
}

export interface ReviewNote {
  readonly id: string;
  readonly kind: 'question' | 'finding';
  readonly text: string;
  readonly location: CodeLocation | null;
  readonly stepId: string | null;
  readonly status: 'open' | 'resolved';
  readonly resolution: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: RevisionPair;
}

/** Where the reviewer is. `away` keeps the walk position to return to. */
export interface ReviewPosition {
  readonly walkId: string | null;
  readonly stepId: string | null;
  readonly refIndex: number;
  readonly away: CodeLocation | null;
  readonly codeMode: 'diff' | 'file';
}

export interface ReviewState {
  readonly version: 1;
  readonly revisions: RevisionPair;
  readonly definitionPath: string;
  readonly definitionHash: string;
  readonly position: ReviewPosition;
  /** Step id → when it was first opened. Being shown is not being reviewed. */
  readonly shownSteps: Readonly<Record<string, string>>;
  /**
   * `stepId#refIndex` → when that reference was first on screen. Coverage counts
   * these, so a step's second reference is not "shown" until it has been opened.
   */
  readonly shownRefs: Readonly<Record<string, string>>;
  /** Step id → when the reviewer marked it walked through. Not an acceptance. */
  readonly walkedSteps: Readonly<Record<string, string>>;
  readonly decisions: readonly ReviewDecision[];
  readonly notes: readonly ReviewNote[];
  readonly savedAt: string;
}

export function emptyReviewState(revisions: RevisionPair, definitionPath: string, definitionHash: string): ReviewState {
  return {
    version: 1,
    revisions,
    definitionPath,
    definitionHash,
    position: { walkId: null, stepId: null, refIndex: 0, away: null, codeMode: 'diff' },
    shownSteps: {},
    shownRefs: {},
    walkedSteps: {},
    decisions: [],
    notes: [],
    savedAt: '',
  };
}

/**
 * Accept a stored state only for the same revision pair. A record about other code
 * is not silently applied to this code (VISION §3, "Earlier approval must not
 * automatically apply to later code").
 */
export function adoptStoredState(raw: unknown, revisions: RevisionPair): ReviewState | null {
  if (!isRecord(raw) || raw['version'] !== 1) {
    return null;
  }
  const stored = raw['revisions'];
  if (!isRecord(stored) || stored['base'] !== revisions.base || stored['target'] !== revisions.target) {
    return null;
  }
  const position = raw['position'];
  const stringMap = (value: unknown): value is Record<string, string> =>
    isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
  if (
    !isRecord(position) ||
    (position['stepId'] !== null && typeof position['stepId'] !== 'string') ||
    typeof position['refIndex'] !== 'number' ||
    (position['codeMode'] !== 'diff' && position['codeMode'] !== 'file') ||
    !stringMap(raw['shownSteps']) ||
    !stringMap(raw['walkedSteps']) ||
    (raw['shownRefs'] !== undefined && !stringMap(raw['shownRefs'])) ||
    !Array.isArray(raw['decisions']) ||
    !Array.isArray(raw['notes']) ||
    typeof raw['definitionHash'] !== 'string'
  ) {
    return null;
  }
  return {
    ...(raw as unknown as ReviewState),
    shownRefs: (raw['shownRefs'] as Record<string, string> | undefined) ?? {},
  };
}

/** The current decision for each hunk: the latest entry whose scope includes it. */
export function currentHunkDecisions(
  decisions: readonly ReviewDecision[],
): ReadonlyMap<string, ReviewDecision> {
  const current = new Map<string, ReviewDecision>();
  for (const decision of decisions) {
    const ids = decision.scope.kind === 'hunk' ? [decision.scope.hunkId] : decision.scope.hunkIds;
    for (const id of ids) {
      if (decision.outcome === 'withdrawn') {
        current.delete(id);
      } else {
        current.set(id, decision);
      }
    }
  }
  return current;
}

// --- Coverage ----------------------------------------------------------------------

export type PlanState = 'full' | 'partial' | 'none';

export interface HunkCoverage {
  readonly hunk: DiffHunk;
  /** Changed lines in the hunk: deletions plus additions. */
  readonly lines: number;
  readonly planned: PlanState;
  readonly plannedBy: readonly string[];
  readonly shown: PlanState;
  readonly walked: PlanState;
  readonly decision: ReviewDecision | null;
  readonly openFindings: number;
  readonly openQuestions: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * How far a set of walk references covers one hunk.
 *
 * A hunk with added lines is covered by `target` references over those lines; its
 * deleted lines are shown in the same place and follow it. A pure deletion is
 * covered by a `base` reference over the removed lines, or by a `target` reference
 * that spans the point where they were removed. `full` means every added line (or
 * the deletion) is inside a reference; `partial` means some of it.
 */
export function hunkPlanState(hunk: DiffHunk, refs: readonly CodeReference[]): PlanState {
  const own = refs.filter((ref) => ref.path === hunk.path && ref.role === 'walk');
  if (hunk.targetCount > 0) {
    let covered = 0;
    for (let line = hunk.targetStart; line < hunk.targetStart + hunk.targetCount; line += 1) {
      if (own.some((ref) => ref.side === 'target' && ref.start <= line && line <= ref.end)) {
        covered += 1;
      }
    }
    if (covered === 0) {
      // Deleted lines of a mixed hunk named directly on the base side still count.
      const baseHit = own.some(
        (ref) =>
          ref.side === 'base' &&
          hunk.baseCount > 0 &&
          overlaps(ref.start, ref.end, hunk.baseStart, hunk.baseStart + hunk.baseCount - 1),
      );
      return baseHit ? 'partial' : 'none';
    }
    return covered === hunk.targetCount ? 'full' : 'partial';
  }
  // Pure deletion.
  const baseEnd = hunk.baseStart + hunk.baseCount - 1;
  let covered = 0;
  for (let line = hunk.baseStart; line <= baseEnd; line += 1) {
    if (own.some((ref) => ref.side === 'base' && ref.start <= line && line <= ref.end)) {
      covered += 1;
    }
  }
  const spanned = own.some(
    (ref) => ref.side === 'target' && ref.start <= hunk.targetStart && hunk.targetStart + 1 <= ref.end,
  );
  if (spanned || covered === hunk.baseCount) {
    return 'full';
  }
  return covered > 0 ? 'partial' : 'none';
}

export interface CoverageSummary {
  readonly hunks: readonly HunkCoverage[];
  readonly totalLines: number;
  readonly plannedLines: { readonly full: number; readonly partialHunks: number };
  readonly shownLines: { readonly full: number; readonly partialHunks: number };
  readonly walkedLines: { readonly full: number; readonly partialHunks: number };
  readonly acceptedLines: number;
  readonly exemptedLines: number;
  readonly remainingLines: number;
  readonly openFindings: number;
  readonly openQuestions: number;
}

function stepRefs(definition: ReviewDefinition, stepIds: ReadonlySet<string> | null): CodeReference[] {
  const refs: CodeReference[] = [];
  for (const walk of definition.walks) {
    for (const step of walk.steps) {
      if (stepIds === null || stepIds.has(step.id)) {
        refs.push(...step.refs);
      }
    }
  }
  return refs;
}

/** The references that have actually been on screen, by `stepId#refIndex`. */
function shownReferences(definition: ReviewDefinition, shown: Readonly<Record<string, string>>): CodeReference[] {
  const refs: CodeReference[] = [];
  for (const walk of definition.walks) {
    for (const step of walk.steps) {
      step.refs.forEach((ref, index) => {
        if (shown[`${step.id}#${String(index)}`] !== undefined) {
          refs.push(ref);
        }
      });
    }
  }
  return refs;
}

function noteTouchesHunk(note: ReviewNote, hunk: DiffHunk): boolean {
  const location = note.location;
  if (location === null || location.path !== hunk.path) {
    return false;
  }
  if (location.side === 'target') {
    return hunk.targetCount > 0
      ? overlaps(location.start, location.end, hunk.targetStart, hunk.targetStart + hunk.targetCount - 1)
      : overlaps(location.start, location.end, hunk.targetStart, hunk.targetStart + 1);
  }
  return hunk.baseCount > 0 && overlaps(location.start, location.end, hunk.baseStart, hunk.baseStart + hunk.baseCount - 1);
}

/**
 * Coverage of every hunk, from the definition (planned), the reviewer's progress
 * (shown, walked) and their record (decisions, notes). Lines are the diff's changed
 * lines; a line in several walks counts once.
 */
export function computeCoverage(
  definition: ReviewDefinition,
  files: readonly DiffFile[],
  state: ReviewState,
): CoverageSummary {
  const allRefs = stepRefs(definition, null);
  const shownRefs = shownReferences(definition, state.shownRefs);
  const walkedRefs = stepRefs(definition, new Set(Object.keys(state.walkedSteps)));
  const decisions = currentHunkDecisions(state.decisions);
  const hunks: HunkCoverage[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      const plannedBy: string[] = [];
      for (const walk of definition.walks) {
        for (const step of walk.steps) {
          if (hunkPlanState(hunk, step.refs) !== 'none') {
            plannedBy.push(step.id);
          }
        }
      }
      const notes = state.notes.filter((note) => note.status === 'open' && noteTouchesHunk(note, hunk));
      hunks.push({
        hunk,
        lines: hunk.baseCount + hunk.targetCount,
        planned: hunkPlanState(hunk, allRefs),
        plannedBy,
        shown: hunkPlanState(hunk, shownRefs),
        walked: hunkPlanState(hunk, walkedRefs),
        decision: decisions.get(hunk.id) ?? null,
        openFindings: notes.filter((note) => note.kind === 'finding').length,
        openQuestions: notes.filter((note) => note.kind === 'question').length,
      });
    }
  }
  const sum = (pick: (entry: HunkCoverage) => PlanState): { full: number; partialHunks: number } => ({
    full: hunks.filter((entry) => pick(entry) === 'full').reduce((total, entry) => total + entry.lines, 0),
    partialHunks: hunks.filter((entry) => pick(entry) === 'partial').length,
  });
  const decided = (outcome: 'accepted' | 'exempted'): number =>
    hunks.filter((entry) => entry.decision?.outcome === outcome).reduce((total, entry) => total + entry.lines, 0);
  const totalLines = hunks.reduce((total, entry) => total + entry.lines, 0);
  const acceptedLines = decided('accepted');
  const exemptedLines = decided('exempted');
  return {
    hunks,
    totalLines,
    plannedLines: sum((entry) => entry.planned),
    shownLines: sum((entry) => entry.shown),
    walkedLines: sum((entry) => entry.walked),
    acceptedLines,
    exemptedLines,
    remainingLines: totalLines - acceptedLines - exemptedLines,
    openFindings: state.notes.filter((note) => note.status === 'open' && note.kind === 'finding').length,
    openQuestions: state.notes.filter((note) => note.status === 'open' && note.kind === 'question').length,
  };
}

// --- Syntax highlighting -------------------------------------------------------------

export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue debugger declare default delete do else ' +
    'enum export extends false finally for from function get if implements import in instanceof interface ' +
    'keyof let new null of private protected public readonly return satisfies set static super switch this ' +
    'throw true try type typeof undefined unknown var void while yield never number string boolean'
  ).split(' '),
);

const HIGHLIGHTED = /\.(?:[cm]?[jt]sx?)$/i;

export function isHighlighted(path: string): boolean {
  return HIGHLIGHTED.test(path);
}

/**
 * A small lexer for TypeScript and JavaScript: comments, strings, numbers and
 * keywords, with block comments and template strings carried across lines. It is
 * a reading aid, not a parser — regular expressions and nested template
 * expressions are not understood — and a file it does not recognise is shown plain.
 */
export function highlightLines(lines: readonly string[], path: string): Token[][] {
  if (!isHighlighted(path)) {
    return lines.map((line) => [{ kind: 'plain', text: line }]);
  }
  let carry: 'block-comment' | 'template' | null = null;
  return lines.map((line) => {
    const tokens: Token[] = [];
    const push = (kind: TokenKind, text: string): void => {
      if (text === '') {
        return;
      }
      const last = tokens[tokens.length - 1];
      if (last !== undefined && last.kind === kind) {
        tokens[tokens.length - 1] = { kind, text: last.text + text };
      } else {
        tokens.push({ kind, text });
      }
    };
    let index = 0;
    if (carry === 'block-comment') {
      const close = line.indexOf('*/');
      if (close === -1) {
        push('comment', line);
        return tokens;
      }
      push('comment', line.slice(0, close + 2));
      index = close + 2;
      carry = null;
    } else if (carry === 'template') {
      const close = findClosingQuote(line, 0, '`');
      if (close === -1) {
        push('string', line);
        return tokens;
      }
      push('string', line.slice(0, close + 1));
      index = close + 1;
      carry = null;
    }
    while (index < line.length) {
      const rest = line.slice(index);
      const char = line.charAt(index);
      if (rest.startsWith('//')) {
        push('comment', rest);
        break;
      }
      if (rest.startsWith('/*')) {
        const close = line.indexOf('*/', index + 2);
        if (close === -1) {
          push('comment', rest);
          carry = 'block-comment';
          break;
        }
        push('comment', line.slice(index, close + 2));
        index = close + 2;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        const close = findClosingQuote(line, index + 1, char);
        if (close === -1) {
          push('string', rest);
          if (char === '`') {
            carry = 'template';
          }
          break;
        }
        push('string', line.slice(index, close + 1));
        index = close + 1;
        continue;
      }
      const number = /^(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?/.exec(rest);
      if (number !== null && !/[\w$]/.test(line.charAt(index - 1))) {
        push('number', number[0]);
        index += number[0].length;
        continue;
      }
      const word = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (word !== null) {
        push(KEYWORDS.has(word[0]) ? 'keyword' : 'plain', word[0]);
        index += word[0].length;
        continue;
      }
      push('plain', char);
      index += 1;
    }
    return tokens;
  });
}

function findClosingQuote(line: string, from: number, quote: string): number {
  for (let index = from; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === '\\') {
      index += 1;
    } else if (char === quote) {
      return index;
    }
  }
  return -1;
}

// --- The bridge between the main process and the view ------------------------------

/**
 * The review surface's IPC channels. `preload.ts` repeats them as literals because
 * the sandboxed preload cannot load this module; a test compares the two.
 */
export const REVIEW_CHANNELS = {
  initial: 'dspatch:review-initial',
  choose: 'dspatch:review-choose',
  readFile: 'dspatch:review-read-file',
  listFiles: 'dspatch:review-list-files',
  search: 'dspatch:review-search',
  saveState: 'dspatch:review-save-state',
} as const;

/** Validate a renderer-supplied revision side and repository path before git sees them. */
export function checkFileRequest(side: unknown, filePath: unknown): string | null {
  if (side !== 'base' && side !== 'target') {
    return 'The revision side must be "base" or "target".';
  }
  if (
    typeof filePath !== 'string' ||
    filePath === '' ||
    filePath.includes('\0') ||
    filePath.includes('\\') ||
    filePath.startsWith('/')
  ) {
    return 'A repository-relative file path with forward slashes is required.';
  }
  return null;
}

/**
 * What the main process accepts as a record to save: the open revision pair, and
 * decisions and notes only from a person at that pair. Agent provenance is
 * reserved for delegated review, which this increment does not have.
 */
export function checkStateForSave(state: unknown, revisions: RevisionPair): string | null {
  if (adoptStoredState(state, revisions) === null) {
    return 'The record does not have the expected shape for the open revision pair.';
  }
  const record = state as ReviewState;
  for (const decision of record.decisions) {
    if (decision.by.kind !== 'human') {
      return 'Only decisions made by a person can be recorded here; delegated agent review is not available.';
    }
    if (decision.revisions.base !== revisions.base || decision.revisions.target !== revisions.target) {
      return 'A decision names a different revision pair than the open review.';
    }
  }
  for (const note of record.notes) {
    if (note.revisions.base !== revisions.base || note.revisions.target !== revisions.target) {
      return 'A note names a different revision pair than the open review.';
    }
  }
  return null;
}

export interface ReviewCommit {
  readonly sha: string;
  readonly subject: string;
}

/** Everything the view needs to open a review, read once from git and the definition. */
export interface ReviewBundle {
  readonly definitionPath: string;
  readonly definitionHash: string;
  readonly repository: string;
  readonly base: ReviewCommit;
  readonly target: ReviewCommit;
  /** Whether `base` is `target`'s first parent: the diff is then exactly one commit. */
  readonly singleCommit: boolean;
  readonly definition: ReviewDefinition;
  readonly definitionProblems: readonly DefinitionProblem[];
  /** One entry per reference that failed validation; such references are shown as invalid. */
  readonly referenceProblems: readonly { readonly stepId: string; readonly refIndex: number; readonly problem: string }[];
  readonly files: readonly DiffFile[];
  readonly state: ReviewState;
  /** Why a stored record was not adopted, when there was one. */
  readonly stateNote: string;
}

export type ReviewOpenOutcome =
  | { readonly kind: 'opened'; readonly bundle: ReviewBundle }
  | { readonly kind: 'none'; readonly note: string }
  | { readonly kind: 'failed'; readonly error: string };

export type ReviewFileOutcome =
  | { readonly kind: 'text'; readonly lines: readonly string[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'binary' }
  | { readonly kind: 'failed'; readonly error: string };

export interface ReviewSearchHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface ReviewBridge {
  initial(): Promise<ReviewOpenOutcome>;
  choose(): Promise<ReviewOpenOutcome>;
  readFile(side: RevisionSide, path: string): Promise<ReviewFileOutcome>;
  listFiles(side: RevisionSide): Promise<readonly string[]>;
  search(side: RevisionSide, query: string): Promise<{ readonly hits: readonly ReviewSearchHit[]; readonly truncated: boolean; readonly error?: string }>;
  saveState(state: ReviewState): Promise<{ readonly saved: boolean; readonly at: string; readonly error?: string }>;
}
