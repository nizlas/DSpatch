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
  /** `null` while the run goes (DSP-191): the summary is written with the end. */
  readonly summary: WalkLoopSummary | null;
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

// --- DSP-190: the run as it is followed ---------------------------------------------------
//
// What the run view shows beside the graph is what the provider and DSpatch actually
// reported, each entry addressed to the run, the node visit and the provider turn it
// happened in, so the writer's first pass and its correction pass are told apart. Nothing
// here is invented to fill a silence: a turn with no events has no entries.

/** Where in the run an activity entry belongs: the node visit, and the provider turn in it. */
export interface WalkLoopTurnAddress {
  readonly nodeId: string;
  /** 1-based visit count of the node, so the writer's correction pass is a visit of its own. */
  readonly occurrence: number;
  /** 1-based count of provider turns in the whole run; `0` before the visit's first turn. */
  readonly turn: number;
}

export type WalkLoopTurnStatus = 'finished' | 'failed' | 'cancelled' | 'unconfirmed';

/**
 * One thing that happened in the run, as the provider or DSpatch reported it.
 *
 * `seq` is DSpatch's own order, one counter per run: a window that opens halfway through is
 * handed the entries so far and applies only what comes after the last one it holds.
 */
export type WalkLoopActivity = WalkLoopTurnAddress & {
  readonly seq: number;
  readonly runId: string;
  readonly atUtc: string;
} & (
    | {
        /** A prompt was sent: DSpatch's own sentence about what the turn is for. */
        readonly kind: 'turn-started';
        readonly stepId: string | null;
        readonly roleId: string | null;
        readonly what: string;
      }
    /** The agent's reply as it is streamed (a fragment, or the whole text once the turn has ended). */
    | { readonly kind: 'reply-text'; readonly text: string }
    /** Reasoning text the provider exposes, as it is streamed. Never the model's whole thinking. */
    | { readonly kind: 'reasoning-text'; readonly text: string }
    | { readonly kind: 'tool-started'; readonly callId: string; readonly name: string; readonly summary: string }
    | {
        readonly kind: 'tool-finished';
        readonly callId: string;
        readonly name: string;
        readonly status: 'ok' | 'error';
        readonly summary: string;
        /** What the provider reported of the result, when it reported something readable; else `null`. */
        readonly detail: string | null;
      }
    /** A command the agent ran, as the provider reported it. */
    | { readonly kind: 'command'; readonly line: string; readonly ending: string; readonly exitCode: number | null; readonly output: string; readonly truncated: boolean }
    | { readonly kind: 'usage'; readonly readings: readonly WalkLoopUsage[] }
    | { readonly kind: 'turn-ended'; readonly status: WalkLoopTurnStatus; readonly error: string | null; readonly textLength: number }
    /** DSpatch's own status: the mechanical checks, a repair asked for, the outcome declared. */
    | { readonly kind: 'note'; readonly text: string }
    /** The reviewer's verdict and findings, as read from its answer. */
    | { readonly kind: 'verdict'; readonly review: WalkReview; readonly final: boolean }
  );

export type WalkLoopActivityKind = WalkLoopActivity['kind'];

const ACTIVITY_KINDS: readonly WalkLoopActivityKind[] = ['turn-started', 'reply-text', 'reasoning-text', 'tool-started', 'tool-finished', 'command', 'usage', 'turn-ended', 'note', 'verdict'];

function usageReadingsFrom(raw: unknown): WalkLoopUsage[] {
  return (Array.isArray(raw) ? raw : []).filter(isRecord).map((entry) => ({ unit: text(entry['unit']), scope: text(entry['scope']), value: typeof entry['value'] === 'number' ? entry['value'] : null, source: text(entry['source']) }));
}

/** An activity entry read back from disk, or `null` when it is not one this build can show. */
export function walkLoopActivityFrom(raw: unknown): WalkLoopActivity | null {
  if (!isRecord(raw) || typeof raw['seq'] !== 'number' || typeof raw['runId'] !== 'string' || typeof raw['nodeId'] !== 'string' || !ACTIVITY_KINDS.includes(raw['kind'] as WalkLoopActivityKind)) {
    return null;
  }
  const base = {
    seq: raw['seq'],
    runId: raw['runId'],
    nodeId: raw['nodeId'],
    occurrence: typeof raw['occurrence'] === 'number' ? raw['occurrence'] : 1,
    turn: typeof raw['turn'] === 'number' ? raw['turn'] : 0,
    atUtc: text(raw['atUtc']),
  };
  switch (raw['kind'] as WalkLoopActivityKind) {
    case 'turn-started':
      return { ...base, kind: 'turn-started', stepId: typeof raw['stepId'] === 'string' ? raw['stepId'] : null, roleId: typeof raw['roleId'] === 'string' ? raw['roleId'] : null, what: text(raw['what']) };
    case 'reply-text':
      return { ...base, kind: 'reply-text', text: text(raw['text']) };
    case 'reasoning-text':
      return { ...base, kind: 'reasoning-text', text: text(raw['text']) };
    case 'tool-started':
      return { ...base, kind: 'tool-started', callId: text(raw['callId']), name: text(raw['name']), summary: text(raw['summary']) };
    case 'tool-finished':
      return { ...base, kind: 'tool-finished', callId: text(raw['callId']), name: text(raw['name']), status: raw['status'] === 'error' ? 'error' : 'ok', summary: text(raw['summary']), detail: typeof raw['detail'] === 'string' ? raw['detail'] : null };
    case 'command':
      return { ...base, kind: 'command', line: text(raw['line']), ending: text(raw['ending']), exitCode: typeof raw['exitCode'] === 'number' ? raw['exitCode'] : null, output: text(raw['output']), truncated: raw['truncated'] === true };
    case 'usage':
      return { ...base, kind: 'usage', readings: usageReadingsFrom(raw['readings']) };
    case 'turn-ended': {
      const status = raw['status'];
      return { ...base, kind: 'turn-ended', status: status === 'failed' || status === 'cancelled' || status === 'unconfirmed' ? status : 'finished', error: typeof raw['error'] === 'string' ? raw['error'] : null, textLength: typeof raw['textLength'] === 'number' ? raw['textLength'] : 0 };
    }
    case 'note':
      return { ...base, kind: 'note', text: text(raw['text']) };
    case 'verdict': {
      const review = walkReviewFrom(raw['review']);
      return review === null ? null : { ...base, kind: 'verdict', review, final: raw['final'] === true };
    }
  }
}

/** One visit of a node in the run, with its activity in order: what the panel lists. */
export interface WalkLoopVisitView {
  readonly nodeId: string;
  readonly occurrence: number;
  readonly roleId: string | null;
  readonly entries: readonly WalkLoopActivity[];
  /** Provider turns that started in this visit. */
  readonly turns: number;
  readonly firstAtUtc: string;
  readonly lastAtUtc: string;
  /** A turn has started and not ended. */
  readonly open: boolean;
}

/**
 * Fold the activity into node visits, in the order the visits were first heard of.
 *
 * Consecutive text fragments of one kind in one turn are joined, so the panel holds one
 * growing text per turn rather than a list of fragments; everything else is kept as it came.
 */
export function foldWalkLoopActivity(entries: readonly WalkLoopActivity[]): readonly WalkLoopVisitView[] {
  const visits: { nodeId: string; occurrence: number; roleId: string | null; entries: WalkLoopActivity[]; turns: number; firstAtUtc: string; lastAtUtc: string; open: boolean }[] = [];
  for (const entry of entries) {
    let visit = visits.find((candidate) => candidate.nodeId === entry.nodeId && candidate.occurrence === entry.occurrence);
    if (visit === undefined) {
      visit = { nodeId: entry.nodeId, occurrence: entry.occurrence, roleId: null, entries: [], turns: 0, firstAtUtc: entry.atUtc, lastAtUtc: entry.atUtc, open: false };
      visits.push(visit);
    }
    visit.lastAtUtc = entry.atUtc;
    if (entry.kind === 'turn-started') {
      visit.turns += 1;
      visit.open = true;
      if (entry.roleId !== null) {
        visit.roleId = entry.roleId;
      }
    } else if (entry.kind === 'turn-ended') {
      visit.open = false;
    }
    const last = visit.entries.at(-1);
    if ((entry.kind === 'reply-text' || entry.kind === 'reasoning-text') && last !== undefined && last.kind === entry.kind && last.turn === entry.turn) {
      visit.entries[visit.entries.length - 1] = { ...last, text: `${last.text}${entry.text}`, atUtc: entry.atUtc };
      continue;
    }
    visit.entries.push(entry);
  }
  return visits;
}

/** The entries of one turn, joined the same way, for a reader of one turn. */
export function activityOfTurn(entries: readonly WalkLoopActivity[], turn: number): readonly WalkLoopActivity[] {
  return entries.filter((entry) => entry.turn === turn);
}

// --- Usage, summed only where the readings allow it ---------------------------------------

/**
 * What a reading's source means, as the adapters report them (10 November 2026):
 *
 * - Copilot: `assistant.usage.<field>`, one event per LLM API call (the SDK's own words),
 *   scope `call`: a field summed over the calls is the run's figure for that field.
 * - Claude: `SDKResultMessage.usage.<field>`, once per turn with the turn's total, scope
 *   `turn`: summed over the turns.
 * - Cursor: `SDKUsageMessage.usage.<field>`, once per turn, scope `turn`: summed, except
 *   `totalTokens`, which the provider computed from the others and is shown apart.
 * - The simulated provider: `presentation.usage.<field>`, SIMULATED, per turn.
 *
 * A source not in this table, a cumulative scope (`run`, `session`) and the plain
 * `assistant.usage` of records before the field was named are not summed: the readings
 * are counted and the last value shown, and the line says so. A `null` value is an unknown
 * reading, counted as unknown, and a sum over any unknown reading is reported incomplete.
 */
const USAGE_FIELDS: Readonly<Record<string, string>> = {
  'assistant.usage.inputTokens': 'input tokens',
  'assistant.usage.outputTokens': 'output tokens',
  'assistant.usage.cacheReadTokens': 'cache read tokens',
  'assistant.usage.cacheWriteTokens': 'cache write tokens',
  'SDKResultMessage.usage.input_tokens': 'input tokens',
  'SDKResultMessage.usage.output_tokens': 'output tokens',
  'SDKResultMessage.usage.cache_read_input_tokens': 'cache read tokens',
  'SDKResultMessage.usage.cache_creation_input_tokens': 'cache write tokens',
  'SDKUsageMessage.usage.inputTokens': 'input tokens',
  'SDKUsageMessage.usage.outputTokens': 'output tokens',
  'SDKUsageMessage.usage.cacheReadTokens': 'cache read tokens',
  'SDKUsageMessage.usage.cacheWriteTokens': 'cache write tokens',
  'SDKUsageMessage.usage.reasoningTokens': 'reasoning tokens',
  'presentation.usage.inputTokens': 'input tokens (SIMULATED)',
  'presentation.usage.outputTokens': 'output tokens (SIMULATED)',
};

/** Provider totals, shown but never added to the other lines. */
const USAGE_DERIVED: Readonly<Record<string, string>> = {
  'SDKUsageMessage.usage.totalTokens': 'total tokens (the provider\'s own total)',
};

export interface WalkLoopUsageLine {
  readonly source: string;
  readonly unit: string;
  readonly scope: string;
  /** What the figure is, in words; the source when its meaning is not known. */
  readonly label: string;
  /** The sum, or the last value for a line that is not summed; `null` when nothing known. */
  readonly value: number | null;
  readonly readings: number;
  /** Readings whose value the provider did not give. */
  readonly unknown: number;
  /** Whether `value` is a sum over the readings (`false`: the last value, or nothing). */
  readonly summed: boolean;
  /** Why it is not summed, for a line that is not; `null` otherwise. */
  readonly why: string | null;
}

export interface WalkLoopUsageSummary {
  /** `true` when the provider reported nothing at all. */
  readonly silent: boolean;
  readonly readings: number;
  readonly lines: readonly WalkLoopUsageLine[];
  /** One short line for the summary strip. */
  readonly text: string;
}

function scopeWords(scope: string): string {
  return scope === 'call' ? 'per model call' : scope === 'turn' ? 'per turn' : scope === 'run' ? 'per run' : scope === 'session' ? 'per session' : scope;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-GB');
}

export function summariseUsage(usage: 'unknown' | readonly WalkLoopUsage[]): WalkLoopUsageSummary {
  if (usage === 'unknown' || usage.length === 0) {
    return { silent: true, readings: 0, lines: [], text: 'usage not reported by the provider' };
  }
  const groups = new Map<string, { readonly reading: WalkLoopUsage; values: (number | null)[] }>();
  for (const reading of usage) {
    const key = `${reading.unit}\u0000${reading.scope}\u0000${reading.source}`;
    const group = groups.get(key) ?? { reading, values: [] };
    group.values.push(reading.value);
    groups.set(key, group);
  }
  const lines: WalkLoopUsageLine[] = [];
  for (const { reading, values } of groups.values()) {
    const unknown = values.filter((value) => value === null).length;
    const known = values.filter((value): value is number => value !== null);
    const field = USAGE_FIELDS[reading.source];
    const derived = USAGE_DERIVED[reading.source];
    const cumulative = reading.scope === 'run' || reading.scope === 'session';
    const last = known.at(-1) ?? null;
    if (field !== undefined && !cumulative) {
      lines.push({ source: reading.source, unit: reading.unit, scope: reading.scope, label: field, value: known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0), readings: values.length, unknown, summed: true, why: null });
    } else if (derived !== undefined) {
      lines.push({ source: reading.source, unit: reading.unit, scope: reading.scope, label: derived, value: last, readings: values.length, unknown, summed: false, why: 'a total the provider computed from the other fields; shown as last reported, not added' });
    } else if (cumulative) {
      lines.push({ source: reading.source, unit: reading.unit, scope: reading.scope, label: reading.source, value: last, readings: values.length, unknown, summed: false, why: `a ${scopeWords(reading.scope)} reading is cumulative; shown as last reported, not added` });
    } else {
      lines.push({ source: reading.source, unit: reading.unit, scope: reading.scope, label: reading.source, value: last, readings: values.length, unknown, summed: false, why: 'what this field counts is not recorded, so its readings are not added' });
    }
  }
  const summed = lines.filter((line) => line.summed && line.value !== null);
  const others = lines.filter((line) => !(line.summed && line.value !== null));
  const unknownReadings = lines.reduce((sum, line) => sum + line.unknown, 0);
  const parts: string[] = [];
  if (summed.length > 0) {
    const scope = [...new Set(summed.map((line) => scopeWords(line.scope)))].join(', ');
    parts.push(`${summed.map((line) => `${formatCount(line.value as number)} ${line.label}`).join(', ')} (${scope}, ${formatCount(usage.length)} reading${usage.length === 1 ? '' : 's'}${unknownReadings === 0 ? '' : `, ${formatCount(unknownReadings)} unknown`})`);
  }
  if (others.length > 0) {
    parts.push(`${formatCount(others.reduce((sum, line) => sum + line.readings, 0))} reading${others.length === 1 && others[0]?.readings === 1 ? '' : 's'} not added (${others.map((line) => line.label).join(', ')})`);
  }
  return { silent: false, readings: usage.length, lines, text: parts.length === 0 ? `${formatCount(usage.length)} readings, every value unknown` : parts.join('; ') };
}
