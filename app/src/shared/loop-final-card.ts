/**
 * DSP-209 S22 (R5): the final run card — one per ended run, owned by the runtime.
 *
 * Built from the run's record and journal only: no agent, no reporting node and no model call
 * decides what it says. It is derived each time and never stored, so a run has exactly one card
 * however often its conversation is reopened. An agent's narrative may sit beside it (S12's
 * report and the replies), never inside it as a fact.
 *
 * What it keeps apart, because R5 asks for each:
 * - this run's result from the mission's cumulative status, which DSpatch does not track;
 * - an agent's review from the person's approval;
 * - an ended run from an in-memory pause that can still continue (a pause gets no card);
 * - an interrupted record (DSpatch stopped first) from a run the host is still running.
 *
 * It names no step "integrator": S16's structural label is still under review (suggestion S1).
 *
 * Pure and shared: no Node built-ins, so the window builds it from a record it read back.
 */

import {
  recordedRunCommitsFrom,
  recordedRunFaultFrom,
  type RecordedDrawnStep,
  type RecordedRunEnding,
} from './loop-record';
import type { RunJournalEntry } from './loop-run';
import { runCountersFrom, stepReportsFrom } from './run-presentation';

/** What the card says about how the run stands. `running` is not a final card. */
export type FinalRunStatus =
  | 'completed'
  | 'waiting-for-person'
  | 'handed-over'
  | 'limit-reached'
  | 'cancelled'
  | 'runtime-fault'
  | 'refused'
  /** DSpatch could not run the loop at all: the call failed and there is no runner result. */
  | 'failed'
  /** The record has no ending and the host is not running it: DSpatch stopped before the run did. */
  | 'interrupted'
  /** No ending yet, and the host reports this run as its active one (it may be paused). */
  | 'running';

/** Where the next action came from. Never from a node's name. */
export type NextActionSource =
  | 'terminal-purpose'
  | 'human-question'
  | 'fault-reconcile'
  | 'handover'
  | 'refusal'
  | 'runtime'
  | 'none';

export interface FinalCardLine {
  readonly label: string;
  readonly value: string;
}

export interface FinalRunCard {
  readonly runId: string;
  readonly status: FinalRunStatus;
  /** A short label for the status, fit for a badge. */
  readonly statusLabel: string;
  /** Why the run ended, in the runtime's or the drawing's words. */
  readonly reason: string;
  readonly nextAction: string;
  readonly nextActionSource: NextActionSource;
  /** The mandate, whole. */
  readonly assignment: string;
  /** "not declared" until steps can declare sub-goals (S21). */
  readonly subGoals: string;
  /** Each step's own declared outcome, attributed to it; a branch's ending as the journal says. */
  readonly stepOutcomes: readonly string[];
  readonly counters: readonly FinalCardLine[];
  /** The models the journal says were chosen, or `['unknown']`. */
  readonly models: readonly string[];
  /** Commit lines, or `['not recorded']` for a record written before commits were kept. */
  readonly commits: readonly string[];
  /** The fixed distinctions R5 asks the card to state. */
  readonly distinctions: readonly string[];
  /** The journal, one line per entry, for the card's expansion. */
  readonly journal: readonly string[];
}

/** What the card needs of a run's record: a parsed record, or a live run's recorded ending. */
export interface FinalCardRecord {
  readonly runId: string;
  readonly mandate: string;
  /** `null` when the record has no ending line. */
  readonly ending: RecordedRunEnding | null;
  readonly drawnSteps?: readonly RecordedDrawnStep[] | null;
  /**
   * A live run that ended before any record was opened: refused before it started, or the call
   * failed. Only the window that sent it knows this; a reopened conversation has no such run.
   */
  readonly beforeRecord?: { readonly status: 'refused' | 'failed'; readonly text: string };
}

export const NOT_RECORDED = 'not recorded';
export const UNKNOWN = 'unknown';
export const NONE_REQUIRED = 'None required.';
export const SUB_GOALS_NOT_DECLARED = 'not declared';
export const MISSION_STATUS_NOT_TRACKED =
  'This card is about this run only. DSpatch does not track the mission’s status.';
export const REVIEW_IS_NOT_APPROVAL =
  'A step’s verdict or review is an agent’s, not your approval. Approval is yours to give.';
export const ENDED_NOT_PAUSED =
  'This run has ended and does not continue or resume. A paused run gets no final card.';

const STATUS_LABEL: Readonly<Record<FinalRunStatus, string>> = {
  completed: 'Completed',
  'waiting-for-person': 'Waiting for you',
  'handed-over': 'Handed over',
  'limit-reached': 'Limit spent',
  cancelled: 'Cancelled',
  'runtime-fault': 'Runtime fault',
  refused: 'Refused',
  failed: 'Could not run',
  interrupted: 'Interrupted',
  running: 'Running',
};

type Data = Readonly<Record<string, string | number | boolean>>;

function text(data: Data | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function last(journal: readonly RunJournalEntry[], kind: RunJournalEntry['kind']): RunJournalEntry | null {
  for (let at = journal.length - 1; at >= 0; at -= 1) {
    const entry = journal[at];
    if (entry !== undefined && entry.kind === kind) {
      return entry;
    }
  }
  return null;
}

function labelOf(nodeId: string, journal: readonly RunJournalEntry[], drawn: readonly RecordedDrawnStep[] | null): string {
  const entered = journal.find((entry) => entry.kind === 'node-entered' && entry.nodeId === nodeId);
  return text(entered?.data, 'label') ?? drawn?.find((step) => step.id === nodeId)?.label ?? nodeId;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${String(hours)} h ${String(minutes)} min`;
  }
  return minutes > 0 ? `${String(minutes)} min ${String(rest)} s` : `${String(rest)} s`;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

interface Standing {
  readonly status: FinalRunStatus;
  readonly reason: string;
  readonly nextAction: string;
  readonly nextActionSource: NextActionSource;
}

function standingOf(record: FinalCardRecord, journal: readonly RunJournalEntry[], liveRunId: string | null): Standing {
  const drawn = record.drawnSteps ?? null;
  if (record.beforeRecord !== undefined) {
    return record.beforeRecord.status === 'refused'
      ? {
          status: 'refused',
          reason: record.beforeRecord.text,
          nextAction: 'Deal with what the refusal names, then send the run again. Nothing was started.',
          nextActionSource: 'refusal',
        }
      : {
          status: 'failed',
          reason: record.beforeRecord.text,
          nextAction: 'Check the project before anything is repeated: the outcome is unknown.',
          nextActionSource: 'runtime',
        };
  }
  const ending = record.ending;
  if (ending === null) {
    // Only the host's own word makes a record without an ending a running run.
    return liveRunId !== null && liveRunId === record.runId
      ? {
          status: 'running',
          reason: 'The host reports this run as still running (it may be paused). It has no ending yet.',
          nextAction: NONE_REQUIRED,
          nextActionSource: 'none',
        }
      : {
          status: 'interrupted',
          reason:
            'DSpatch stopped before the run reported an end, and the host is not running it. What happened ' +
            'after the last recorded line is unknown. It is not complete, and it does not resume by itself.',
          nextAction:
            'Check the project: anything the run changed is still there. Start a new run to continue; nothing is repeated for you.',
          nextActionSource: 'runtime',
        };
  }
  if (ending.kind === 'cancelled' || ending.cancelled) {
    return {
      status: 'cancelled',
      reason: 'The run was cancelled and stopped where it was. Files stay as they are.',
      nextAction: NONE_REQUIRED,
      nextActionSource: 'none',
    };
  }
  switch (ending.status) {
    case 'completed': {
      const terminal = ending.terminalNodeId;
      const label = terminal === null ? UNKNOWN : labelOf(terminal, journal, drawn);
      const purpose = typeof ending.terminalPurpose === 'string' ? ending.terminalPurpose.trim() : '';
      return {
        status: 'completed',
        reason:
          `Reached the ending “${label}”` +
          (ending.terminalEnding === undefined ? '.' : ` (ending: ${ending.terminalEnding}).`),
        // The drawing's purpose for that ending, quoted; a record before it was kept says so.
        nextAction:
          purpose !== ''
            ? `The drawing says of this ending: “${purpose}”`
            : ending.terminalPurpose === null
              ? NONE_REQUIRED
              : `${NONE_REQUIRED} (The ending’s purpose was ${NOT_RECORDED} in this record.)`,
        nextActionSource: purpose !== '' ? 'terminal-purpose' : 'none',
      };
    }
    case 'awaiting-human': {
      const waiting = last(journal, 'awaiting-human');
      const question = text(waiting?.data, 'question');
      const who = waiting?.nodeId === undefined ? UNKNOWN : labelOf(waiting.nodeId, journal, drawn);
      return {
        status: 'waiting-for-person',
        reason: `The step “${who}” stopped for a person’s decision.`,
        nextAction: question === null ? `Answer the step “${who}”; its question was ${NOT_RECORDED}.` : `Answer: “${question}”`,
        nextActionSource: question === null ? 'runtime' : 'human-question',
      };
    }
    case 'handed-over': {
      const asked = last(journal, 'handoff-requested');
      const why = text(asked?.data, 'reason');
      const who = asked?.nodeId === undefined ? UNKNOWN : labelOf(asked.nodeId, journal, drawn);
      const handover = ending.handover;
      return {
        status: 'handed-over',
        reason: `The step “${who}” recommended continuing interactively${why === null ? '' : ` (“${why}”)`}, and you chose to.`,
        nextAction:
          handover?.turn === 'queued'
            ? 'Continue the work in the chat; the handover was queued as its next turn.'
            : handover?.turn === 'refused'
              ? `Continue the work in the chat yourself: the handover turn was refused (${handover.note ?? 'no reason recorded'}).`
              : `Continue the work in the chat; what became of the handover turn is ${NOT_RECORDED}.`,
        nextActionSource: 'handover',
      };
    }
    case 'limit-reached': {
      const limit = last(journal, 'limit-reached');
      const bound = text(limit?.data, 'bound');
      return {
        status: 'limit-reached',
        reason: limit?.detail ?? `A bound${bound === null ? '' : ` (${bound})`} was spent.`,
        nextAction: 'Start a new run to continue; this one does not resume.',
        nextActionSource: 'runtime',
      };
    }
    case 'runtime-fault': {
      const fault = recordedRunFaultFrom(ending.fault);
      const line = last(journal, 'runtime-fault');
      return {
        status: 'runtime-fault',
        reason: fault?.detail ?? line?.detail ?? `The runtime fault was ${NOT_RECORDED}.`,
        // The runner's reconcile guidance; an older record holds it only joined to the detail.
        nextAction: fault?.reconcile ?? (line === null ? `Reconcile guidance ${NOT_RECORDED}.` : line.detail),
        nextActionSource: fault !== null || line !== null ? 'fault-reconcile' : 'none',
      };
    }
    case 'refused': {
      const refused = last(journal, 'refused');
      return {
        status: 'refused',
        reason: refused?.detail ?? `The runner refused the run; its reason was ${NOT_RECORDED}.`,
        nextAction: 'Deal with what the refusal names, then send the run again. No step ran.',
        nextActionSource: 'refusal',
      };
    }
    default:
      return {
        status: 'failed',
        reason: ending.note.trim() === '' ? 'DSpatch could not run the graph.' : ending.note,
        nextAction: 'Check the project before anything is repeated: the outcome is unknown.',
        nextActionSource: 'runtime',
      };
  }
}

function counterLines(journal: readonly RunJournalEntry[], ending: RecordedRunEnding | null): readonly FinalCardLine[] {
  const counters = runCountersFrom(journal);
  const elapsed =
    counters.elapsedMs === null
      ? UNKNOWN
      : typeof counters.elapsedMs === 'number'
        ? duration(counters.elapsedMs)
        : `at least ${duration(counters.elapsedMs.atLeast)} (no ending)`;
  const cost = ending === null ? UNKNOWN : ending.cost === 'unknown' ? 'not reported by the provider' : `${String(ending.cost)} cents`;
  return [
    { label: 'Agent steps (node visits)', value: String(counters.steps) },
    { label: 'Parallel branches started', value: String(counters.branchInvocations) },
    { label: 'Rework rounds', value: String(counters.reworkRounds) },
    { label: 'Calls (the run’s budget)', value: counters.calls === null ? UNKNOWN : String(counters.calls) },
    { label: 'Provider turns', value: counters.providerTurns === null ? UNKNOWN : String(counters.providerTurns) },
    { label: 'Provider API calls', value: counters.providerApiCalls },
    { label: 'Tool calls', value: typeof counters.toolCalls === 'number' ? String(counters.toolCalls) : counters.toolCalls },
    { label: 'Elapsed', value: elapsed },
    { label: 'Cost', value: cost },
    { label: 'Tokens', value: NOT_RECORDED },
  ];
}

/** The models the journal recorded on `node-entered` and `branch-started` (S19's data). */
function modelLines(journal: readonly RunJournalEntry[]): readonly string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of journal) {
    if (entry.kind !== 'node-entered' && entry.kind !== 'branch-started') {
      continue;
    }
    // S19's flat fields (model, modelProvider, modelPolicy, modelOption, modelReason,
    // modelSource). Before S19, `model` on node-entered held the policy name, so a model is
    // read only beside a `modelSource`; without one it is not a recorded choice.
    const source = text(entry.data, 'modelSource');
    const model = text(entry.data, 'model');
    if (model === null || source === null) {
      continue;
    }
    const provider = text(entry.data, 'modelProvider');
    const option = text(entry.data, 'modelOption');
    const reason = text(entry.data, 'modelReason');
    const slice = entry.kind === 'branch-started' ? text(entry.data, 'sliceId') : null;
    const where = `${entry.nodeId ?? UNKNOWN}${slice === null ? '' : ` · ${slice}`}`;
    const line =
      `${where}: ${provider === null ? '' : `${provider} `}${model}` +
      (option === null ? '' : `, option “${option}”`) +
      `, chosen by ${source}` +
      (reason === null ? '' : ` (${reason})`);
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  return lines.length === 0 ? [UNKNOWN] : lines;
}

function commitLines(ending: RecordedRunEnding | null): readonly string[] {
  if (ending === null || !('commits' in ending)) {
    return [NOT_RECORDED];
  }
  const commits = recordedRunCommitsFrom(ending.commits);
  if (commits === null) {
    return [NOT_RECORDED];
  }
  const lines: string[] = [];
  const head = (sha: string | null): string => (sha === null ? UNKNOWN : short(sha));
  lines.push(
    `In ${commits.folder}: HEAD ${head(commits.startHead)} at the start, ${head(commits.endHead)} at the end` +
      `${commits.branch === null ? '' : ` (branch ${commits.branch})`}.`,
  );
  if (commits.commits.length === 0 && commits.notListed === 0 && commits.startHead !== null && commits.endHead !== null) {
    lines.push('No commits were made during the run.');
  }
  for (const commit of commits.commits) {
    const where = commit.onUpstream === null ? 'pushed: unknown' : commit.onUpstream ? 'on the upstream' : 'local only';
    lines.push(`${short(commit.sha)} ${commit.subject} — ${where}`);
  }
  if (commits.notListed > 0) {
    lines.push(`${plural(commits.notListed, 'further commit')} not listed.`);
  }
  lines.push(
    commits.upstream === null
      ? 'No upstream branch was known at the end, so whether the commits are pushed is unknown.'
      : `Upstream ${commits.upstream.name}: ${String(commits.upstream.ahead)} ahead, ${String(commits.upstream.behind)} behind, ` +
          'as of the run’s end (no fetch).',
  );
  if (commits.note !== null) {
    lines.push(commits.note);
  }
  return lines;
}

function outcomeLines(runId: string, journal: readonly RunJournalEntry[]): readonly string[] {
  const lines: string[] = [];
  for (const report of stepReportsFrom({ runId, journal })) {
    const visit = report.visit.occurrence > 1 ? ` (visit ${String(report.visit.occurrence)})` : '';
    if (report.role === 'branch') {
      continue;
    }
    lines.push(
      report.declaredOutcome === null
        ? `${report.nodeLabel}${visit}: no outcome declared`
        : `${report.nodeLabel}${visit}: declared “${report.declaredOutcome}” (the step’s own claim)`,
    );
  }
  for (const entry of journal) {
    if (entry.kind !== 'branch-ended') {
      continue;
    }
    const slice = text(entry.data, 'sliceId') ?? UNKNOWN;
    lines.push(`${entry.nodeId ?? UNKNOWN} · ${slice}: branch ended ${text(entry.data, 'ending') ?? NOT_RECORDED}`);
  }
  return lines;
}

function journalLines(journal: readonly RunJournalEntry[]): readonly string[] {
  return journal.map(
    (entry) => `${String(entry.seq)}. ${entry.kind}${entry.nodeId === undefined ? '' : ` ${entry.nodeId}`}: ${entry.detail}`,
  );
}

/**
 * The run's final card, from its record and journal and the host's active run id.
 *
 * `liveRunId` is the run the host reports as walking now (`currentLoopRun`), or `null`. It only
 * decides between `running` and `interrupted` for a record without an ending.
 */
export function buildFinalRunCard(
  record: FinalCardRecord,
  journal: readonly RunJournalEntry[],
  liveRunId: string | null,
): FinalRunCard {
  const standing = standingOf(record, journal, liveRunId);
  const ended = standing.status !== 'running';
  return {
    runId: record.runId,
    status: standing.status,
    statusLabel: STATUS_LABEL[standing.status],
    reason: standing.reason,
    nextAction: standing.nextAction,
    nextActionSource: standing.nextActionSource,
    assignment: record.mandate,
    subGoals: SUB_GOALS_NOT_DECLARED,
    stepOutcomes: outcomeLines(record.runId, journal),
    counters: counterLines(journal, record.ending),
    models: modelLines(journal),
    commits: record.beforeRecord !== undefined ? ['None: the run never started.'] : commitLines(record.ending),
    distinctions: [
      MISSION_STATUS_NOT_TRACKED,
      REVIEW_IS_NOT_APPROVAL,
      ...(ended ? [ENDED_NOT_PAUSED] : []),
    ],
    journal: journalLines(journal),
  };
}

/** Whether a card is a final one: a running run's is not shown as an ending. */
export function isFinalCard(card: FinalRunCard): boolean {
  return card.status !== 'running';
}
