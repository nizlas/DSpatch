/**
 * Review threads (DSP-175): the agent's findings, questions and verification gaps as
 * threads a person can read at the code, comment on and decide about.
 *
 * **One identity, one store.** A thread is read from a delegated review's recorded result,
 * which stays as the agent's checked answer, and the person's comments and decisions are
 * kept under the thread's id in the pair record (`PairRecord.threads`). Every window of a
 * review reads the same record, so the diff, the walk and the discussion show the same
 * thread with the same status; there is no copy with a status of its own.
 *
 * **A decision is not a resolution.** Accepting a recommendation records agreement. When the
 * recommendation needs work it reads *Action agreed* and stays among what remains; only a
 * recommendation that explicitly says no change is needed closes on accept. Nothing here
 * runs anything, approves a line or changes what an agent reported.
 *
 * **Older results read too.** A finding without a recommendation says so; none is made up.
 * Plain `uncertainties` become verification gaps of their own.
 *
 * **Points worth checking are threads too.** The points of the code walks, recorded by the
 * host as `PairRecord.checkSources`, are read here as the same threads: a finding point is a
 * problem, a question a question and an uncertainty a verification gap. A point that says
 * the same as a finding (the same title, or exactly the same places) is that finding's
 * thread, and the same point read again (the same title) is its own thread again: never a
 * second one.
 */

import { headed, sameKey } from './delegated-review-view';
import type { AgentFinding, AgentGap, AgentJob, CheckSource, LineRange, PairRecord, Recommendation, StoredCheck, ThreadEvent, ThreadEventKind } from './review-pair';

export type ThreadKind = 'problem' | 'question' | 'note' | 'gap';

export type ThreadStatus = 'open' | 'action-agreed' | 'resolved' | 'dismissed';

/** A verification gap the agent tied to a finding: shown inside that finding's thread. */
export interface AttachedGap {
  readonly text: string;
  readonly evidence: string;
  readonly recommendation: Recommendation | null;
}

export interface ReviewThread {
  readonly id: string;
  readonly jobId: string;
  readonly kind: ThreadKind;
  readonly title: string;
  /** What was observed and what it leads to; `''` when the title says all of it. */
  readonly explanation: string;
  /** Longer reasoning and differently worded repeats. */
  readonly details: string;
  /** What the observation rests on, as the agent said; `''` in an older result. */
  readonly evidence: string;
  /** `null` when the agent gave none (every older result): never made up. */
  readonly recommendation: Recommendation | null;
  /** Checked places at the pair's commits, each once. */
  readonly anchors: readonly LineRange[];
  /** Places the agent named that DSpatch could not find at that commit. */
  readonly missing: readonly { readonly range: LineRange; readonly reason: string }[];
  /** Where it is shown: at its lines, at a file, or over the review. */
  readonly level: 'lines' | 'file' | 'review';
  /** The file a file-level thread belongs to (its path at the side named), else `null`. */
  readonly file: { readonly side: LineRange['side']; readonly path: string } | null;
  /**
   * Who reported it and over what: the agent and model, the delegated part, the time, and
   * whether it came from a delegated review or the walks' *Worth checking*.
   */
  readonly origin: { readonly reviewer: string; readonly scope: string; readonly at: string; readonly source: 'review' | 'worth-checking' };
  readonly gaps: readonly AttachedGap[];
  /** The points worth checking of the walks this thread stands for; empty for a finding alone. */
  readonly points: readonly CheckPointRef[];
  readonly events: readonly ThreadEvent[];
  readonly status: ThreadStatus;
}

/** A point worth checking in one walk definition, by its id there. */
export interface CheckPointRef {
  readonly definitionPath: string;
  readonly checkId: string;
}

const PROVIDER_NAMES: Readonly<Record<AgentJob['provider'], string>> = { claude: 'Claude', copilot: 'Copilot', cursor: 'Cursor' };

const KIND_ORDER: readonly ThreadKind[] = ['problem', 'question', 'gap', 'note'];

/** A short, stable hash of a text, for thread ids that survive a reload. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function samePlace(a: LineRange, b: LineRange): boolean {
  return a.side === b.side && a.path === b.path && a.start === b.start && a.end === b.end;
}

/** What a list of a person's events leaves the thread at. */
export function statusOf(events: readonly ThreadEvent[], recommendation: Recommendation | null): ThreadStatus {
  let status: ThreadStatus = 'open';
  for (const event of events) {
    if (event.kind === 'accept') {
      status = recommendation?.kind === 'keep' ? 'resolved' : 'action-agreed';
    } else if (event.kind === 'keep-open' || event.kind === 'reopen') {
      status = 'open';
    } else if (event.kind === 'resolve') {
      status = 'resolved';
    } else if (event.kind === 'dismiss') {
      status = 'dismissed';
    }
  }
  return status;
}

/** Whether an action makes sense now; the reason when it does not. */
export function threadActionProblem(thread: ReviewThread, kind: ThreadEventKind): string | null {
  if (kind === 'accept') {
    if (thread.recommendation === null) {
      return 'There is no recommendation to accept.';
    }
    return thread.status === 'open' ? null : 'Only an open thread can accept its recommendation.';
  }
  if (kind === 'reopen') {
    return thread.status === 'open' ? 'The thread is already open.' : null;
  }
  if (kind === 'resolve' || kind === 'dismiss') {
    return thread.status === 'resolved' || thread.status === 'dismissed' ? 'The thread is already closed.' : null;
  }
  return null;
}

function fileOf(job: AgentJob): ReviewThread['file'] {
  const ranges = job.scope?.ranges ?? [];
  const first = ranges[0];
  if (first === undefined || !ranges.every((range) => range.path === first.path && range.side === first.side)) {
    return null;
  }
  return { side: first.side, path: first.path };
}

function levelOf(anchors: readonly LineRange[], missing: ReviewThread['missing'], fallback: ReviewThread['file']): Pick<ReviewThread, 'level' | 'file'> {
  const first = anchors[0];
  if (first !== undefined) {
    return { level: 'lines', file: { side: first.side, path: first.path } };
  }
  const named = missing[0]?.range ?? null;
  const file = named === null ? fallback : { side: named.side, path: named.path };
  return file === null ? { level: 'review', file: null } : { level: 'file', file };
}

function attached(gap: AgentGap): AttachedGap {
  return { text: gap.text.trim(), evidence: gap.evidence?.trim() ?? '', recommendation: gap.recommendation ?? null };
}

/** The threads of one recorded delegated review, without the person's events. */
function threadsOfJob(job: AgentJob): Omit<ReviewThread, 'events' | 'status'>[] {
  const result = job.result;
  if (job.kind !== 'review' || job.state !== 'done' || result === null) {
    return [];
  }
  const origin = { reviewer: reviewerOf(job), scope: job.scope?.label ?? '', at: job.endedAt ?? job.startedAt, source: 'review' as const };
  const fallback = fileOf(job);
  interface Gathering {
    kind: ThreadKind;
    readonly key: string;
    readonly title: string;
    readonly explanation: string;
    readonly more: string[];
    evidence: string;
    recommendation: Recommendation | null;
    readonly anchors: LineRange[];
    readonly missing: { range: LineRange; reason: string }[];
    readonly gaps: AttachedGap[];
  }
  const groups = new Map<string, Gathering>();
  const add = (finding: AgentFinding): void => {
    const { title, explanation } = headed(finding);
    const key = sameKey(finding.title ?? finding.text);
    let group = groups.get(key);
    if (group === undefined) {
      group = { kind: finding.severity, key, title, explanation, more: [], evidence: '', recommendation: null, anchors: [], missing: [], gaps: [] };
      groups.set(key, group);
    } else {
      if (KIND_ORDER.indexOf(finding.severity) < KIND_ORDER.indexOf(group.kind)) {
        group.kind = finding.severity;
      }
      if (explanation !== '' && sameKey(explanation) !== sameKey(group.explanation) && !group.more.some((entry) => sameKey(entry) === sameKey(explanation))) {
        group.more.push(explanation);
      }
    }
    const details = finding.details?.trim() ?? '';
    if (details !== '' && !group.more.some((entry) => sameKey(entry) === sameKey(details))) {
      group.more.push(details);
    }
    if (group.evidence === '' && finding.evidence !== undefined) {
      group.evidence = finding.evidence.trim();
    }
    group.recommendation ??= finding.recommendation ?? null;
    const place = finding.location;
    if (place !== null && !group.anchors.some((known) => samePlace(known, place))) {
      group.anchors.push(place);
    }
    if (finding.missing !== undefined && !group.missing.some((known) => samePlace(known.range, finding.missing!.range))) {
      group.missing.push({ ...finding.missing });
    }
  };
  for (const finding of result.findings) {
    add(finding);
  }
  const findingThreads = [...groups.values()];
  // Gaps: tied to the finding they name when there is one, otherwise threads of their own.
  // Older results have only plain sentences; those are gaps of their own, each once.
  const gaps: readonly AgentGap[] = result.gaps ?? result.uncertainties.map((text) => ({ text, location: null }));
  const ownGaps = new Map<string, AgentGap>();
  for (const gap of gaps) {
    const owner = gap.finding === undefined ? undefined : groups.get(sameKey(gap.finding));
    if (owner !== undefined) {
      if (!owner.gaps.some((known) => sameKey(known.text) === sameKey(gap.text))) {
        owner.gaps.push(attached(gap));
      }
    } else if (gap.text.trim() !== '' && !ownGaps.has(sameKey(gap.text))) {
      ownGaps.set(sameKey(gap.text), gap);
    }
  }
  const out: Omit<ReviewThread, 'events' | 'status'>[] = findingThreads.map((group) => ({
    id: `${job.id}:f:${hashOf(group.key)}`,
    jobId: job.id,
    kind: group.kind,
    title: group.title,
    explanation: group.explanation,
    details: group.more.join('\n\n'),
    evidence: group.evidence,
    recommendation: group.recommendation,
    anchors: group.anchors,
    missing: group.missing,
    ...levelOf(group.anchors, group.missing, fallback),
    origin,
    gaps: group.gaps,
    points: [],
  }));
  for (const [key, gap] of ownGaps) {
    const { title, explanation } = headed({ severity: 'note', text: gap.text, location: null });
    const anchors = gap.location === null ? [] : [gap.location];
    out.push({
      id: `${job.id}:g:${hashOf(key)}`,
      jobId: job.id,
      kind: 'gap',
      title,
      explanation,
      details: '',
      evidence: gap.evidence?.trim() ?? '',
      recommendation: gap.recommendation ?? null,
      anchors,
      missing: [],
      ...levelOf(anchors, [], fallback),
      origin,
      gaps: [],
      points: [],
    });
  }
  return out;
}

/** How a job's agent and model read as a thread's reviewer. */
export function reviewerOf(job: Pick<AgentJob, 'provider' | 'model'>): string {
  return `${PROVIDER_NAMES[job.provider]}${job.model === '' ? '' : ` · ${job.model}`}`;
}

/** What each kind of point worth checking is as a thread. */
export const CHECK_THREAD_KINDS: Readonly<Record<StoredCheck['kind'], ThreadKind>> = { finding: 'problem', question: 'question', uncertainty: 'gap' };

function placesKey(places: readonly LineRange[]): string {
  return places
    .map((place) => `${place.side}:${place.path}:${String(place.start)}-${String(place.end)}`)
    .sort()
    .join('|');
}

/**
 * The identity of a point worth checking, from what it says and where: the same point read
 * again, from the same or another preparation, is the same thread with its events.
 */
export function checkThreadId(check: Pick<StoredCheck, 'kind' | 'title' | 'places'>): string {
  return `check:${hashOf(`${check.kind}\n${sameKey(check.title)}\n${placesKey(check.places)}`)}`;
}

type ThreadBase = Omit<ReviewThread, 'events' | 'status'>;

/**
 * Whether a point says the same as a thread: the same title, or, for a finding of a delegated
 * review, exactly the same places. Two points with other titles at the same lines stay two.
 */
function samePoint(thread: Pick<ThreadBase, 'title' | 'anchors' | 'origin'>, check: StoredCheck): boolean {
  if (sameKey(thread.title) === sameKey(check.title)) {
    return true;
  }
  return thread.origin.source === 'review' && check.places.length > 0 && thread.anchors.length > 0 && placesKey(thread.anchors) === placesKey(check.places);
}

function joined(...parts: readonly string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (text !== '' && !out.some((entry) => sameKey(entry) === sameKey(text))) {
      out.push(text);
    }
  }
  return out.join('\n\n');
}

/**
 * The findings' threads with the points worth checking added: a point that says the same as
 * a thread joins it (its places, and its recommendation and evidence where the thread has
 * none), every other point is a thread of its own. Nothing is shown twice.
 */
function withCheckThreads(findings: readonly ThreadBase[], sources: readonly CheckSource[]): ThreadBase[] {
  const out: ThreadBase[] = findings.map((thread) => ({ ...thread }));
  for (const source of sources) {
    for (const check of source.checks) {
      const point: CheckPointRef[] = check.retired === true || check.checkId === '' ? [] : [{ definitionPath: source.definitionPath, checkId: check.checkId }];
      const at = out.findIndex((thread) => samePoint(thread, check));
      const known = at < 0 ? undefined : out[at];
      if (known !== undefined) {
        const anchors = [...known.anchors];
        for (const place of check.places) {
          if (!anchors.some((entry) => samePlace(entry, place))) {
            anchors.push(place);
          }
        }
        out[at] = {
          ...known,
          anchors,
          ...(known.level === 'review' ? levelOf(anchors, known.missing, null) : {}),
          details: known.points.length === 0 && known.origin.source === 'review' ? joined(known.details, check.reasoning) : known.details,
          evidence: known.evidence === '' ? (check.evidence ?? '').trim() : known.evidence,
          // Filled only where the thread has none, so a decision taken on one is never changed.
          recommendation: known.recommendation ?? check.recommendation ?? null,
          points: [...known.points, ...point.filter((ref) => !known.points.some((entry) => entry.definitionPath === ref.definitionPath && entry.checkId === ref.checkId))],
        };
        continue;
      }
      const anchors = [...check.places];
      out.push({
        id: checkThreadId(check),
        jobId: source.jobId ?? '',
        kind: CHECK_THREAD_KINDS[check.kind],
        title: check.title.trim(),
        explanation: check.detail.trim(),
        details: check.reasoning.trim(),
        evidence: (check.evidence ?? '').trim(),
        recommendation: check.recommendation ?? null,
        anchors,
        missing: [],
        // A point with no place left is about the review as a whole: none is made up.
        ...(anchors[0] === undefined ? { level: 'review' as const, file: null } : { level: 'lines' as const, file: { side: anchors[0].side, path: anchors[0].path } }),
        origin: { reviewer: source.reviewer, scope: 'Worth checking', at: source.at, source: 'worth-checking' },
        gaps: [],
        points: point,
      });
    }
  }
  return out;
}

/** Every thread of a review, with the person's events and the status they leave. */
export function reviewThreadsOf(record: Pick<PairRecord, 'jobs' | 'threads' | 'checkSources'>): readonly ReviewThread[] {
  const events = new Map(record.threads.map((entry) => [entry.threadId, entry.events]));
  return withCheckThreads(record.jobs.flatMap(threadsOfJob), record.checkSources ?? [])
    .map((thread) => {
      const own = events.get(thread.id) ?? [];
      return { ...thread, events: own, status: statusOf(own, thread.recommendation) };
    })
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/** The thread a point worth checking of a walk is, when the review has it. */
export function threadOfPoint(threads: readonly ReviewThread[], definitionPath: string, checkId: string): ReviewThread | null {
  const same = (a: string, b: string): boolean => a === b || a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
  return threads.find((thread) => thread.points.some((point) => point.checkId === checkId && same(point.definitionPath, definitionPath))) ?? null;
}

/** Still to be dealt with: open, or an agreed action not yet done. */
export function isRemaining(thread: ReviewThread): boolean {
  return thread.status === 'open' || thread.status === 'action-agreed';
}

/** The threads a line range touches, by its checked anchors. */
export function threadsAt(threads: readonly ReviewThread[], side: LineRange['side'], path: string, line: number): readonly ReviewThread[] {
  return threads.filter((thread) => thread.anchors.some((anchor) => anchor.side === side && anchor.path === path && line >= anchor.start && line <= anchor.end));
}

export interface ThreadCounts {
  readonly problems: number;
  readonly questions: number;
  readonly gaps: number;
  readonly actionsAgreed: number;
}

/** What remains, by kind: open problems, questions and gaps, and agreed actions. Notes do not count. */
export function threadCountsOf(threads: readonly ReviewThread[]): ThreadCounts {
  const open = (kind: ThreadKind): number => threads.filter((thread) => thread.kind === kind && thread.status === 'open').length;
  return {
    problems: open('problem'),
    questions: open('question'),
    gaps: open('gap') + threads.filter((thread) => thread.kind !== 'gap' && thread.status === 'open').reduce((total, thread) => total + thread.gaps.length, 0),
    actionsAgreed: threads.filter((thread) => thread.kind !== 'note' && thread.status === 'action-agreed').length,
  };
}

function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** "1 open question · 3 verification gaps", or `''` when nothing remains. */
export function remainingLine(counts: ThreadCounts): string {
  return [
    ...(counts.problems > 0 ? [counted(counts.problems, 'open problem', 'open problems')] : []),
    ...(counts.questions > 0 ? [counted(counts.questions, 'open question', 'open questions')] : []),
    ...(counts.gaps > 0 ? [counted(counts.gaps, 'verification gap', 'verification gaps')] : []),
    ...(counts.actionsAgreed > 0 ? [counted(counts.actionsAgreed, 'action agreed', 'actions agreed')] : []),
  ].join(' · ');
}

/** The open and agreed threads that count in a file, by its path on either side. */
export function remainingInFile(threads: readonly ReviewThread[], paths: { readonly oldPath: string | null; readonly newPath: string | null }): readonly ReviewThread[] {
  return threads.filter(
    (thread) =>
      thread.kind !== 'note' &&
      isRemaining(thread) &&
      thread.file !== null &&
      thread.file.path === (thread.file.side === 'base' ? paths.oldPath : paths.newPath),
  );
}

export const STATUS_WORDS: Readonly<Record<ThreadStatus, string>> = {
  open: 'Open',
  'action-agreed': 'Action agreed',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export const KIND_WORDS: Readonly<Record<ThreadKind, string>> = {
  problem: 'Problem',
  question: 'Question',
  note: 'Note',
  gap: 'Verification gap',
};

export const RECOMMENDATION_WORDS: Readonly<Record<Recommendation['kind'], string>> = {
  change: 'Change the code',
  test: 'Add or run a test',
  measure: 'Measure',
  'ask-author': 'Ask the author',
  investigate: 'Investigate further',
  keep: 'Keep the code as it is',
};
