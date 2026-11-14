/**
 * DSP-209 S16: the shared run-presentation model — visits, branches, step reports and counters,
 * folded from the run's journal.
 *
 * The contract the chat's step reports, the branch view, the final run card and model selection
 * (S19–S22) build on. It reads only what the runtime journalled: nothing here comes from an
 * agent's prose, and nothing is invented to fill a gap. A fact the journal does not hold reads
 * `null`, `'unknown'` or `'not recorded'` — never `0`, because a zero claims it was counted.
 *
 * Presentation only. Nothing in this module is saved, and nothing it returns is passed to an
 * agent: what a later step receives is still decided by the graph's `consumes`/`delivers`.
 *
 * Pure and shared: no Node built-ins, so the window can fold a record it read back.
 */

import type { StepAddress } from './loop-activity';
import { modelSelectionFromData, type RunJournalEntry } from './loop-run';
import type { FanOutIsolation } from './loop-graph';
import { readSlices } from './loop-slices';

type Data = Readonly<Record<string, string | number | boolean>>;

function text(data: Data | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() !== '' && value !== '(none)' ? value : null;
}

function count(data: Data | undefined, key: string): number | null {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Which visit of which node, and how it was reached. */
export interface VisitIdentity {
  readonly runId: string;
  readonly nodeId: string;
  /** 1-based visit count of the node, from `node-entered`'s `occurrence`. */
  readonly occurrence: number;
  /**
   * 1 plus the number of rework arrivals into this node up to and including this one. A first
   * visit is attempt 1; the first time a rework edge brings the run back here is attempt 2.
   * A non-rework revisit keeps the attempt it had.
   */
  readonly attempt: number;
  /** The edge the run arrived on (`node-entered`'s `arrivedBy`), or `null` for the entry step. */
  readonly arrivedByEdge: string | null;
  /** The arriving `edge-taken` said `reworkRound: true`. */
  readonly isRework: boolean;
}

/** One `node-entered` with what the journal says about the node at that moment. */
export interface JournalVisit {
  readonly visit: VisitIdentity;
  /** The node kind as journalled (`agent`, `external`, `gate`, `terminal`, …), or `null`. */
  readonly kind: string | null;
  readonly label: string;
  readonly callId: number | null;
  /** The `seq` of its `node-entered`, so a reader can line it up with the journal. */
  readonly seq: number;
}

/** Where the live view finds a step's output; `sliceId` narrows it to one branch. */
export type LiveOutputAddress = StepAddress & { readonly sliceId?: string };

export function liveOutputAddressFor(visit: VisitIdentity, sliceId?: string): LiveOutputAddress {
  return {
    runId: visit.runId,
    nodeId: visit.nodeId,
    occurrence: visit.occurrence,
    ...(sliceId === undefined ? {} : { sliceId }),
  };
}

export type BranchState = 'queued' | 'running' | 'finished' | 'failed' | 'cancelled';

/**
 * A branch's mailbox, counted only from the journal's own message lines. `sent` is what this
 * branch sent; the other three are messages addressed to it, as the journal recorded them.
 * Delivered and acknowledged are never inferred from sent.
 */
export interface BranchMessages {
  readonly sent: number;
  readonly delivered: number;
  readonly acknowledged: number;
  readonly undelivered: number;
}

export interface BranchView {
  /** The fan-out visit this branch belongs to. */
  readonly visit: VisitIdentity;
  readonly sliceId: string;
  /** The slice's `result`, when the slice text was given; `null` reads "not recorded". */
  readonly task: string | null;
  readonly state: BranchState;
  /** How it ended, in the journal's word (`finished`, `no-worktree`, a declared failure…), once it has. */
  readonly ending: string | null;
  /** DSP-209 S19's model fields on `branch-started`, or `null` where it recorded none. */
  readonly model: ModelSelectionRecord | null;
  readonly sessionId: string | null;
  readonly messages: BranchMessages;
  /** `false` for every branch of an earlier visit to the same node. */
  readonly current: boolean;
}

/** The display text for a branch task that was not recorded. */
export const TASK_NOT_RECORDED = 'not recorded';

export type StepReportRole = 'step' | 'branch' | 'integrator';
export type StepAttention = 'failure' | 'question' | 'action';

export interface StepReport {
  readonly visit: VisitIdentity;
  readonly nodeLabel: string;
  /**
   * `integrator` by structure and role only (decision 47): the step a fan-out's `success`
   * edge reaches directly, whose drawn role is in {@link INTEGRATOR_ROLE_IDS}.
   * `branch` is one branch instance of a fan-out visit. Never decided by a node's name.
   */
  readonly role: StepReportRole;
  /** Set for `branch` reports, `null` otherwise. */
  readonly sliceId: string | null;
  /** DSP-209 S21: the reply's `SUBGOAL:` line — the agent's claim, unchecked — or `null`. */
  readonly subGoal: null | { readonly id: string; readonly title: string };
  /** The outcome the step itself declared, a gate's verdict, or its declared failure; else `null`. */
  readonly declaredOutcome: string | null;
  /** Index into the replies given to {@link stepReportsFrom}, or `null` when none matches. */
  readonly replyIndex: number | null;
  /** What needs the person's eye: a failure, a pending question, or an action only they can take. */
  readonly attention: StepAttention | null;
}

/**
 * The run's counters. Each is a different thing; none is derived from another.
 *
 * - `steps`: `node-entered` entries for `agent` and `external` nodes. A fan-out visit counts
 *   once, however many branches it ran. Gates and terminals are not steps.
 * - `branchInvocations`: `branch-started` entries. A branch that never started (cancelled, no
 *   worktree) is not an invocation.
 * - `reworkRounds`: `edge-taken` entries with `reworkRound: true`.
 * - `calls`: exactly `run-ended`'s `calls` (the runner's own call budget count); `null` with
 *   no ending.
 * - `providerTurns`: `run-ended`'s `providerTurns`; `null` with no ending.
 * - `providerApiCalls`: always `'unknown'`. The journal does not record API requests, and a
 *   provider turn is not one.
 * - `toolCalls`: `'not recorded'` unless a count is given from outside the journal.
 * - `elapsedMs`: `run-started` to `run-ended` (or `refused`); `{ atLeast }` up to the last entry
 *   when the run wrote no ending; `null` without a `run-started`.
 */
export interface RunCounters {
  readonly steps: number;
  readonly branchInvocations: number;
  readonly reworkRounds: number;
  readonly calls: number | null;
  readonly providerTurns: number | null;
  readonly providerApiCalls: 'unknown';
  readonly toolCalls: number | 'not recorded';
  readonly elapsedMs: number | { readonly atLeast: number } | null;
}

/** How a model was chosen for one invocation. Type only; DSP-209 S19 records it. */
export interface ModelSelectionRecord {
  readonly provider: string;
  readonly model: string;
  /** The node's model-selection policy, or `null` for a fixed model. */
  readonly policy: string | null;
  /** Which of the policy's options was taken, or `null`. */
  readonly option: string | null;
  readonly reason: string;
  /** Who chose: the drawing's fixed model, the policy, or the person. */
  readonly source: 'fixed' | 'policy' | 'person';
}

interface OpenVisit {
  readonly journal: JournalVisit;
}

/** Every `node-entered` in order, with its identity. Terminals included; filter on `kind`. */
export function visitsFromJournal(runId: string, journal: readonly RunJournalEntry[]): readonly JournalVisit[] {
  const visits: JournalVisit[] = [];
  const occurrences = new Map<string, number>();
  const reworks = new Map<string, number>();
  let lastEdge: RunJournalEntry | null = null;
  for (const entry of journal) {
    if (entry.kind === 'edge-taken') {
      lastEdge = entry;
      continue;
    }
    if (entry.kind !== 'node-entered' || entry.nodeId === undefined) {
      continue;
    }
    const nodeId = entry.nodeId;
    const occurrence = count(entry.data, 'occurrence') ?? (occurrences.get(nodeId) ?? 0) + 1;
    occurrences.set(nodeId, occurrence);
    const arrivedByEdge = text(entry.data, 'arrivedBy');
    const edge =
      lastEdge !== null &&
      text(lastEdge.data, 'to') === nodeId &&
      (arrivedByEdge === null || lastEdge.edgeId === arrivedByEdge)
        ? lastEdge
        : null;
    const isRework = edge?.data?.['reworkRound'] === true;
    if (isRework) {
      reworks.set(nodeId, (reworks.get(nodeId) ?? 0) + 1);
    }
    visits.push({
      visit: { runId, nodeId, occurrence, attempt: 1 + (reworks.get(nodeId) ?? 0), arrivedByEdge, isRework },
      kind: text(entry.data, 'kind'),
      label: text(entry.data, 'label') ?? nodeId,
      callId: count(entry.data, 'callId'),
      seq: entry.seq,
    });
    lastEdge = null;
  }
  return visits;
}

/** Each journal entry paired with the visit open when it was written, for its node. */
function entriesByVisit(runId: string, journal: readonly RunJournalEntry[]): {
  readonly visits: readonly JournalVisit[];
  readonly of: (entry: RunJournalEntry) => JournalVisit | null;
} {
  const visits = visitsFromJournal(runId, journal);
  const bySeq = new Map<number, JournalVisit>();
  const latest = new Map<string, OpenVisit>();
  let index = 0;
  let open: JournalVisit | null = null;
  for (const entry of journal) {
    if (entry.kind === 'node-entered' && entry.nodeId !== undefined) {
      const visit = visits[index];
      index += 1;
      if (visit !== undefined) {
        latest.set(visit.visit.nodeId, { journal: visit });
        open = visit;
      }
      continue;
    }
    // An entry naming a node belongs to that node's latest visit; one naming none, to the open one.
    const owner = entry.nodeId === undefined ? open : (latest.get(entry.nodeId)?.journal ?? null);
    if (owner !== null) {
      bySeq.set(entry.seq, owner);
    }
  }
  return { visits, of: (entry) => bySeq.get(entry.seq) ?? null };
}

function sameVisit(left: VisitIdentity, right: VisitIdentity): boolean {
  return left.nodeId === right.nodeId && left.occurrence === right.occurrence;
}

/** Where to read one fan-out visit's slices from, when the caller has the text. */
export type SliceSource = (visit: VisitIdentity) => { readonly text: string; readonly isolation: FanOutIsolation } | null;

function stateOf(ending: string | null, started: boolean): BranchState {
  if (ending === null) {
    return started ? 'running' : 'queued';
  }
  if (ending === 'finished') {
    return 'finished';
  }
  return ending === 'not-started' ? 'cancelled' : 'failed';
}

/**
 * Every branch instance of every fan-out visit, in the order the journal first names it.
 *
 * Folded from `branch-started`, `branch-ended` and the four message kinds. With `slices`, every
 * branch's `task` is its slice's `result`, and while the run has not ended, a slice of the
 * latest, still-open agent or external visit that has no line yet is listed `queued`.
 */
export function branchViewsFromJournal(
  runId: string,
  journal: readonly RunJournalEntry[],
  options: { readonly slices?: SliceSource } = {},
): readonly BranchView[] {
  const { visits, of } = entriesByVisit(runId, journal);
  interface Building {
    visit: VisitIdentity;
    sliceId: string;
    started: boolean;
    ending: string | null;
    sessionId: string | null;
    /** DSP-209 S20: from `branch-started` (`task`, and S19's model fields). */
    journalTask: string | null;
    model: ModelSelectionRecord | null;
    messages: { sent: number; delivered: number; acknowledged: number; undelivered: number };
  }
  const branches: Building[] = [];
  const find = (visit: VisitIdentity, sliceId: string): Building => {
    let branch = branches.find((known) => sameVisit(known.visit, visit) && known.sliceId === sliceId);
    if (branch === undefined) {
      branch = {
        visit,
        sliceId,
        started: false,
        ending: null,
        sessionId: null,
        journalTask: null,
        model: null,
        messages: { sent: 0, delivered: 0, acknowledged: 0, undelivered: 0 },
      };
      branches.push(branch);
    }
    return branch;
  };
  const closed = new Set<string>();
  for (const entry of journal) {
    const owner = of(entry);
    if (owner === null) {
      continue;
    }
    const visit = owner.visit;
    if (entry.kind === 'node-produced' || entry.kind === 'edge-taken') {
      closed.add(`${visit.nodeId}#${String(visit.occurrence)}`);
    }
    if (entry.kind === 'branch-started' || entry.kind === 'branch-ended') {
      const sliceId = text(entry.data, 'sliceId');
      if (sliceId === null) {
        continue;
      }
      const branch = find(visit, sliceId);
      branch.sessionId = text(entry.data, 'sessionId') ?? branch.sessionId;
      if (entry.kind === 'branch-started') {
        branch.started = true;
        branch.journalTask = text(entry.data, 'task') ?? branch.journalTask;
        branch.model = modelSelectionFromData(entry.data) ?? branch.model;
      } else {
        branch.ending = text(entry.data, 'ending') ?? 'not recorded';
      }
      continue;
    }
    const field =
      entry.kind === 'message-delivered'
        ? 'delivered'
        : entry.kind === 'message-acknowledged'
          ? 'acknowledged'
          : entry.kind === 'message-undelivered'
            ? 'undelivered'
            : entry.kind === 'message-sent'
              ? 'sent'
              : null;
    if (field === null) {
      continue;
    }
    const sliceId = field === 'sent' ? text(entry.data, 'from') : field === 'acknowledged' ? text(entry.data, 'by') : text(entry.data, 'to');
    if (sliceId === null) {
      continue;
    }
    const branch = branches.find((known) => sameVisit(known.visit, visit) && known.sliceId === sliceId);
    if (branch !== undefined) {
      branch.messages[field] += 1;
    }
  }

  const tasks = new Map<string, ReadonlyMap<string, string>>();
  const slicesOf = (visit: VisitIdentity): ReadonlyMap<string, string> | null => {
    const key = `${visit.nodeId}#${String(visit.occurrence)}`;
    if (!tasks.has(key)) {
      const source = options.slices?.(visit) ?? null;
      const reading = source === null ? null : readSlices(source.text, { isolation: source.isolation });
      tasks.set(key, new Map(reading !== null && reading.ok ? reading.slices.map((slice) => [slice.id, slice.result] as const) : []));
    }
    const found = tasks.get(key);
    return found === undefined || found.size === 0 ? null : found;
  };

  // Queued: slices of a fan-out visit still open, at the very end of the journal, with no line yet.
  // Never after the run ended, and never for a terminal or a gate.
  const lastVisit = visits[visits.length - 1];
  const runEnded = journal.some((entry) => entry.kind === 'run-ended' || entry.kind === 'refused');
  if (
    lastVisit !== undefined &&
    !runEnded &&
    (lastVisit.kind === 'agent' || lastVisit.kind === 'external') &&
    !closed.has(`${lastVisit.visit.nodeId}#${String(lastVisit.visit.occurrence)}`)
  ) {
    for (const sliceId of slicesOf(lastVisit.visit)?.keys() ?? []) {
      find(lastVisit.visit, sliceId);
    }
  }

  const latestOccurrence = new Map<string, number>();
  for (const visit of visits) {
    latestOccurrence.set(visit.visit.nodeId, visit.visit.occurrence);
  }
  return branches.map((branch) => ({
    visit: branch.visit,
    sliceId: branch.sliceId,
    task: slicesOf(branch.visit)?.get(branch.sliceId) ?? branch.journalTask,
    state: stateOf(branch.ending, branch.started),
    ending: branch.ending,
    model: branch.model,
    sessionId: branch.sessionId,
    messages: { ...branch.messages },
    current: latestOccurrence.get(branch.visit.nodeId) === branch.visit.occurrence,
  }));
}

/** A reply the record keeps, as {@link stepReportsFrom} matches it to a visit. */
export interface PresentationReply {
  readonly nodeId: string;
  readonly occurrence?: number;
  readonly sliceId?: string;
  /** DSP-209 S21: the reply's text, read only for its `SUBGOAL:` line. */
  readonly text?: string;
}

/**
 * DSP-209 S21: the sub-goal a reply claims, from its first whole `SUBGOAL: <id> — <title>`
 * line, or `null`. Read for display only: it never routes and is never passed on. The
 * separator may be an em dash, an en dash or a hyphen.
 */
export function subGoalClaimFrom(text: string): { readonly id: string; readonly title: string } | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\**SUBGOAL:\**\s*(\S+)\s+[—–-]\s+(.+?)\s*$/.exec(line);
    if (match !== null) {
      return { id: (match[1] ?? '').replace(/[*_`]/g, ''), title: (match[2] ?? '').trim() };
    }
  }
  return null;
}

/**
 * DSP-209 S21 (decision 47): the role ids that make a step the integrator. Read from the
 * drawing's `role` as the run journalled it on `node-entered`, never from a node's name.
 */
export const INTEGRATOR_ROLE_IDS: ReadonlySet<string> = new Set(['project-integrate']);

const ATTENTION_ORDER: readonly StepAttention[] = ['failure', 'question', 'action'];

function stronger(current: StepAttention | null, next: StepAttention): StepAttention {
  return current === null || ATTENTION_ORDER.indexOf(next) < ATTENTION_ORDER.indexOf(current) ? next : current;
}

/**
 * One report per agent or external visit, followed by one per branch of a fan-out visit.
 *
 * `attention` comes only from the journal: a declared failure, a runtime fault, a pending
 * `awaiting-human` or unanswered `waiting-for-person` (a question), a `handoff-requested`
 * (an action), and for a branch, a failed ending.
 */
export function stepReportsFrom(input: {
  readonly runId: string;
  readonly journal: readonly RunJournalEntry[];
  readonly replies?: readonly PresentationReply[];
  readonly slices?: SliceSource;
  /**
   * DSP-209 S21b: the nodes whose drawing declares `subgoal`. A reply's `SUBGOAL:` line is
   * read only for these — a branch by its fan-out node — since only they are asked for it.
   * Absent reads no claim at all, never every reply's.
   */
  readonly subGoalNodes?: ReadonlySet<string>;
}): readonly StepReport[] {
  const { journal } = input;
  const replies = input.replies ?? [];
  const claimFor = (nodeId: string, text: string | undefined): StepReport['subGoal'] =>
    text === undefined || input.subGoalNodes?.has(nodeId) !== true ? null : subGoalClaimFrom(text);
  const { visits, of } = entriesByVisit(input.runId, journal);
  const branches = branchViewsFromJournal(input.runId, journal, input.slices === undefined ? {} : { slices: input.slices });
  const fanOutNodes = new Set(branches.map((branch) => branch.visit.nodeId));

  const declared = new Map<number, string>();
  const attention = new Map<number, StepAttention>();
  const waiting = new Map<number, boolean>();
  const note = (visit: JournalVisit, what: StepAttention): void => {
    attention.set(visit.seq, stronger(attention.get(visit.seq) ?? null, what));
  };
  for (const entry of journal) {
    const owner = of(entry);
    if (owner === null) {
      continue;
    }
    switch (entry.kind) {
      case 'node-produced': {
        const outcome = text(entry.data, 'outcome');
        const source = text(entry.data, 'outcomeSource');
        if (outcome !== null && (source === 'step-declared' || source === 'gate-verdict')) {
          declared.set(owner.seq, outcome);
        }
        if (text(entry.data, 'product') === 'declared-failure') {
          note(owner, 'failure');
        }
        break;
      }
      case 'edge-taken': {
        const failure = text(entry.data, 'failure');
        if (entry.data?.['declaredFailure'] === true) {
          note(owner, 'failure');
          if (failure !== null) {
            declared.set(owner.seq, failure);
          }
        }
        break;
      }
      case 'runtime-fault':
        note(owner, 'failure');
        break;
      case 'awaiting-human':
        note(owner, 'question');
        break;
      case 'waiting-for-person':
        waiting.set(owner.seq, true);
        break;
      case 'person-answered':
        waiting.set(owner.seq, false);
        break;
      case 'handoff-requested':
        note(owner, 'action');
        break;
      default:
        break;
    }
  }
  for (const [seq, open] of waiting) {
    if (open) {
      attention.set(seq, stronger(attention.get(seq) ?? null, 'question'));
    }
  }

  // The integrator (decision 47, narrowing S16's rule): the step a fan-out's `success` edge
  // reaches directly, and only when the drawing gives that step the integrator role. By
  // structure and role, never by a node's name; a step reached later is an ordinary step.
  const integrators = new Set<number>();
  let lastEdge: RunJournalEntry | null = null;
  for (const entry of journal) {
    if (entry.kind === 'edge-taken') {
      lastEdge = entry;
    } else if (entry.kind === 'node-entered') {
      const from = text(lastEdge?.data, 'from');
      const role = text(entry.data, 'role');
      if (
        from !== null &&
        fanOutNodes.has(from) &&
        text(lastEdge?.data, 'when') === 'success' &&
        role !== null &&
        INTEGRATOR_ROLE_IDS.has(role)
      ) {
        integrators.add(entry.seq);
      }
      lastEdge = null;
    }
  }

  const reports: StepReport[] = [];
  for (const visit of visits) {
    if (visit.kind !== 'agent' && visit.kind !== 'external') {
      continue;
    }
    const replyAt = replies.findIndex(
      (reply) =>
        reply.sliceId === undefined &&
        reply.nodeId === visit.visit.nodeId &&
        (reply.occurrence === undefined || reply.occurrence === visit.visit.occurrence),
    );
    const integrator = integrators.has(visit.seq);
    const replyText = replyAt < 0 ? undefined : replies[replyAt]?.text;
    reports.push({
      visit: visit.visit,
      nodeLabel: visit.label,
      role: integrator ? 'integrator' : 'step',
      sliceId: null,
      // DSP-209 S21: the agent's own claim, from its reply; `null` when it made none.
      subGoal: claimFor(visit.visit.nodeId, replyText),
      declaredOutcome: declared.get(visit.seq) ?? null,
      replyIndex: replyAt < 0 ? null : replyAt,
      attention: attention.get(visit.seq) ?? null,
    });
    for (const branch of branches.filter((item) => sameVisit(item.visit, visit.visit))) {
      const branchReply = replies.findIndex(
        (reply) =>
          reply.sliceId === branch.sliceId &&
          reply.nodeId === visit.visit.nodeId &&
          (reply.occurrence === undefined || reply.occurrence === visit.visit.occurrence),
      );
      reports.push({
        visit: visit.visit,
        nodeLabel: visit.label,
        role: 'branch',
        sliceId: branch.sliceId,
        subGoal: claimFor(visit.visit.nodeId, branchReply < 0 ? undefined : replies[branchReply]?.text),
        declaredOutcome: null,
        replyIndex: branchReply < 0 ? null : branchReply,
        attention: branch.state === 'failed' ? 'failure' : null,
      });
    }
  }
  return reports;
}

/** The run's counters from its journal. See {@link RunCounters} for what each one counts. */
export function runCountersFrom(
  journal: readonly RunJournalEntry[],
  options: { readonly toolCalls?: number } = {},
): RunCounters {
  let steps = 0;
  let branchInvocations = 0;
  let reworkRounds = 0;
  let started: RunJournalEntry | null = null;
  let ended: RunJournalEntry | null = null;
  for (const entry of journal) {
    switch (entry.kind) {
      case 'run-started':
        started ??= entry;
        break;
      case 'run-ended':
      case 'refused':
        ended = entry;
        break;
      case 'node-entered': {
        const kind = text(entry.data, 'kind');
        if (kind === 'agent' || kind === 'external') {
          steps += 1;
        }
        break;
      }
      case 'branch-started':
        branchInvocations += 1;
        break;
      case 'edge-taken':
        if (entry.data?.['reworkRound'] === true) {
          reworkRounds += 1;
        }
        break;
      default:
        break;
    }
  }
  const last = journal[journal.length - 1];
  const elapsedMs =
    started === null
      ? null
      : ended !== null
        ? ended.sinceStartMs - started.sinceStartMs
        : { atLeast: (last?.sinceStartMs ?? started.sinceStartMs) - started.sinceStartMs };
  return {
    steps,
    branchInvocations,
    reworkRounds,
    calls: count(ended?.data, 'calls'),
    providerTurns: count(ended?.data, 'providerTurns'),
    providerApiCalls: 'unknown',
    toolCalls: options.toolCalls ?? 'not recorded',
    elapsedMs,
  };
}
