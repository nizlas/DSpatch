/**
 * DSP-189: the walk loop's stored shapes, with no imports, so the review record module can read
 * them back from disk without a cycle through the prompt builders. `walk-loop.ts` re-exports them.
 */

/** How a walk preparation is done: today's one call, or the planner, writer and reviewer loop. */
export type WalkMethod = 'single' | 'loop';

export const WALK_METHODS: readonly WalkMethod[] = ['single', 'loop'];

export function isWalkMethod(value: unknown): value is WalkMethod {
  return value === 'single' || value === 'loop';
}

export type WalkFindingKind = 'structure' | 'explanation';

export interface WalkFinding {
  readonly kind: WalkFindingKind;
  /** Step ids the finding concerns; empty when it is about the walks as a whole (routed to the planner). */
  readonly steps: readonly string[];
  readonly problem: string;
  readonly why: string;
  readonly evidence: string;
  readonly reference: string;
}

export type WalkVerdict = 'accept' | 'rework' | 'objections';

export interface WalkReview {
  readonly assessment: string;
  readonly verdict: WalkVerdict;
  readonly findings: readonly WalkFinding[];
}

export interface WalkLoopTurn {
  readonly node: string;
  readonly occurrence: number;
  /** The step written, for a writer turn. */
  readonly stepId?: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
}

export interface WalkLoopUsage {
  readonly unit: string;
  readonly scope: string;
  readonly value: number | null;
  readonly source: string;
}

export type WalkLoopStatus = 'delivered' | 'delivered-with-objections' | 'stopped' | 'cancelled' | 'failed' | 'unknown';

const WALK_LOOP_STATUSES: readonly WalkLoopStatus[] = ['delivered', 'delivered-with-objections', 'stopped', 'cancelled', 'failed', 'unknown'];

/**
 * What a walks job keeps of its loop run, for the window: enough to say what happened and to
 * find the record. The prompts and answers stay in the record and are read on request.
 */
export interface WalkLoopSummary {
  readonly runId: string;
  readonly graphId: string;
  readonly graphVersionId: string;
  readonly roles: readonly { readonly id: string; readonly sourcePath: string }[];
  readonly recordPath: string;
  readonly resultsDir: string;
  readonly status: WalkLoopStatus;
  /** The nodes entered, in order. */
  readonly path: readonly string[];
  readonly first: WalkReview | null;
  readonly final: WalkReview | null;
  /** Whether a correction round ran, and what it changed. */
  readonly rounds: 0 | 1;
  readonly replanned: boolean;
  readonly rewritten: readonly string[];
  readonly turns: readonly WalkLoopTurn[];
  readonly durationMs: number;
  /** What the provider reported, or `'unknown'` when it reported nothing. Never zero for silence. */
  readonly usage: 'unknown' | readonly WalkLoopUsage[];
}

/** A walk loop's record as the window reads it on request (DSP-189): every exchange, and the journal. */
export interface WalkLoopRecordView {
  readonly summary: WalkLoopSummary;
  readonly replies: readonly {
    readonly nodeId: string;
    readonly nodeLabel: string;
    readonly occurrence: number;
    readonly atUtc: string;
    /** `''` when the record did not keep it. */
    readonly prompt: string;
    readonly text: string;
    readonly roleId: string | null;
    readonly sessionId: string | null;
  }[];
  readonly journal: readonly { readonly seq: number; readonly atIso: string; readonly kind: string; readonly nodeId: string | null; readonly detail: string }[];
  /** Whether the record has its ending line. */
  readonly complete: boolean;
  readonly error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function walkReviewFrom(raw: unknown): WalkReview | null {
  if (!isRecord(raw)) {
    return null;
  }
  const verdict = raw['verdict'];
  if (verdict !== 'accept' && verdict !== 'rework' && verdict !== 'objections') {
    return null;
  }
  const findings: WalkFinding[] = [];
  for (const entry of Array.isArray(raw['findings']) ? raw['findings'] : []) {
    if (!isRecord(entry) || (entry['kind'] !== 'structure' && entry['kind'] !== 'explanation')) {
      continue;
    }
    findings.push({ kind: entry['kind'], steps: strings(entry['steps']), problem: text(entry['problem']), why: text(entry['why']), evidence: text(entry['evidence']), reference: text(entry['reference']) });
  }
  return { assessment: text(raw['assessment']), verdict, findings };
}

/** A stored summary read back, or `null` when it is not one this build can show. */
export function walkLoopSummaryFrom(raw: unknown): WalkLoopSummary | null {
  if (!isRecord(raw)) {
    return null;
  }
  const status = raw['status'];
  if (typeof raw['runId'] !== 'string' || typeof raw['recordPath'] !== 'string' || !WALK_LOOP_STATUSES.includes(status as WalkLoopStatus)) {
    return null;
  }
  const turns: WalkLoopTurn[] = [];
  for (const entry of Array.isArray(raw['turns']) ? raw['turns'] : []) {
    if (isRecord(entry) && typeof entry['node'] === 'string') {
      turns.push({
        node: entry['node'],
        occurrence: typeof entry['occurrence'] === 'number' ? entry['occurrence'] : 1,
        ...(typeof entry['stepId'] === 'string' ? { stepId: entry['stepId'] } : {}),
        startedAt: text(entry['startedAt']),
        endedAt: text(entry['endedAt']),
        durationMs: typeof entry['durationMs'] === 'number' ? entry['durationMs'] : 0,
      });
    }
  }
  const usageRaw = raw['usage'];
  const usage: 'unknown' | WalkLoopUsage[] = Array.isArray(usageRaw)
    ? usageRaw.filter(isRecord).map((entry) => ({ unit: text(entry['unit']), scope: text(entry['scope']), value: typeof entry['value'] === 'number' ? entry['value'] : null, source: text(entry['source']) }))
    : 'unknown';
  return {
    runId: raw['runId'],
    graphId: text(raw['graphId']),
    graphVersionId: text(raw['graphVersionId']),
    roles: (Array.isArray(raw['roles']) ? raw['roles'] : []).filter(isRecord).map((role) => ({ id: text(role['id']), sourcePath: text(role['sourcePath']) })),
    recordPath: raw['recordPath'],
    resultsDir: text(raw['resultsDir']),
    status: status as WalkLoopStatus,
    path: strings(raw['path']),
    first: walkReviewFrom(raw['first']),
    final: walkReviewFrom(raw['final']),
    rounds: raw['rounds'] === 1 ? 1 : 0,
    replanned: raw['replanned'] === true,
    rewritten: strings(raw['rewritten']),
    turns,
    durationMs: typeof raw['durationMs'] === 'number' ? raw['durationMs'] : 0,
    usage,
  };
}
