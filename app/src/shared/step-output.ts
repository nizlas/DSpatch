/**
 * A step's output as a person opens it from the graph (Niclas, 15 November 2026): live while
 * the step works, the saved output once it is done, for every visit of every agent step and
 * for each fan-out branch.
 *
 * DSP-209 S20's branch window followed one branch's live output and nothing else: it needed a
 * slice, it was reached only from a fan-out node's Branches list, and it showed what arrived
 * while it was open. A run that walked its steps one after another therefore had no way in.
 * This module widens the same window to any step visit, live from the run view every window
 * already folds (`RunView.steps`, `RunView.branchSteps`), and saved from the run record the
 * runner already writes (its `agent-reply` and `command` lines). It reads; nothing here
 * reaches the run, and what a step is given is still decided by the graph, never by what a
 * window shows.
 *
 * Pure and shared: no Node built-ins.
 */

import type { StepActivityState } from './loop-activity';
import type { ParsedRunRecord, RecordedAgentReply, RecordedCommand } from './loop-record';
import { modelSelectionFromData, type RunJournalEntry } from './loop-run';
import { addressOf, applyRunEvent, runViewFor, type LoopRunEvent, type RunView } from './loop-run-view';
import { visitsFromJournal, type LiveOutputAddress, type ModelSelectionRecord, type VisitIdentity } from './run-presentation';

/** A step visit, or one branch of it, and the conversation whose records keep its run. */
export type StepOutputAddress = LiveOutputAddress & { readonly conversationId?: string };

/** One visit of a node, as the node panel lists it. */
export interface StepVisitRow {
  readonly visit: VisitIdentity;
  /** "visit 2 · attempt 2, rework", or "visit 1". */
  readonly label: string;
  /** The node closed this visit (`node-produced` or a runtime fault), or the run ended. */
  readonly ended: boolean;
  /** DSP-225: the model this visit ran with, from its own `node-entered`; `null` when none was recorded. */
  readonly model: ModelSelectionRecord | null;
  /**
   * DSP-225: whether the visit's turn continued the node's session from an earlier visit, from its
   * own `node-produced`; `null` before it closed, or when no session was recorded.
   */
  readonly sessionContinued: boolean | null;
}

/** DSP-225: "Large · model-l", "Small · chat model x", or the model alone, for a visit's row and heading. */
export function visitModelWords(model: ModelSelectionRecord | null): string | null {
  if (model === null) {
    return null;
  }
  const name = model.model === '' ? 'the provider’s default' : model.model;
  const which = model.classUsesChatModel === true ? `chat model ${name}` : name;
  return model.modelClass === undefined ? which : `${model.modelClass.slice(0, 1).toUpperCase()}${model.modelClass.slice(1)} · ${which}`;
}

/**
 * DSP-225: what the agent of this visit had in its context, said plainly. A visit shown on its own
 * is not therefore an independent judgement: a continued session holds the node's earlier visits.
 */
export function visitContextWords(row: Pick<StepVisitRow, 'sessionContinued' | 'visit'>): string | null {
  if (row.sessionContinued === null) {
    return null;
  }
  return row.sessionContinued
    ? `The agent continued this step’s session from an earlier visit, so its earlier conversation here was in its context. ` +
        'Shown apart, this visit is still not an independent review of the earlier one.'
    : row.visit.occurrence > 1
      ? 'The agent ran in a new session opened for this visit: it had no conversation from the earlier visits, only what its brief carried.'
      : 'The agent ran in a session opened for this step: it had only what its brief carried.';
}

/** Words for a visit: its number, and its attempt when a rework brought the run back. */
export function visitWords(visit: VisitIdentity): string {
  const attempt = visit.attempt > 1 || visit.isRework ? ` · attempt ${String(visit.attempt)}${visit.isRework ? ', rework' : ''}` : '';
  return `visit ${String(visit.occurrence)}${attempt}`;
}

/**
 * The visits of one node in a run, oldest first. A visit has ended when its node closed it
 * (a `node-produced` or `runtime-fault` line for that node after it was entered) or when the
 * whole run has ended; otherwise it is the step working now.
 */
export function nodeVisitRows(
  runId: string,
  journal: readonly RunJournalEntry[],
  nodeId: string,
  runEnded: boolean,
): readonly StepVisitRow[] {
  const visits = visitsFromJournal(runId, journal).filter((entry) => entry.visit.nodeId === nodeId);
  return visits.map((entry, index) => {
    const next = visits[index + 1]?.seq ?? Number.POSITIVE_INFINITY;
    const closing = journal.find(
      (line) =>
        line.nodeId === nodeId &&
        (line.kind === 'node-produced' || line.kind === 'runtime-fault') &&
        line.seq > entry.seq &&
        line.seq < next,
    );
    const entered = journal.find((line) => line.seq === entry.seq);
    const continued = closing?.data?.['sessionContinued'];
    return {
      visit: entry.visit,
      label: visitWords(entry.visit),
      ended: runEnded || closing !== undefined || index < visits.length - 1,
      model: modelSelectionFromData(entered?.data),
      sessionContinued: typeof continued === 'boolean' ? continued : null,
    };
  });
}

/** The window's heading: which step, which visit, which branch, which run. */
export function describeStepOutput(address: StepOutputAddress, nodeLabel: string, visit: VisitIdentity | null): string {
  const which = visit === null ? `visit ${String(address.occurrence)}` : visitWords(visit);
  const step = address.sliceId === undefined ? `“${nodeLabel}”` : `Branch “${address.sliceId}” of “${nodeLabel}”`;
  return `${step}, ${which} — run ${address.runId}`;
}

/** The live activity for one step visit (no slice) or one branch, or `null` when none was observed. */
export function liveStateFor(
  steps: readonly StepActivityState[] | undefined,
  branches: readonly (StepActivityState & { readonly sliceId: string })[] | undefined,
  address: LiveOutputAddress,
): StepActivityState | null {
  const same = (item: StepActivityState): boolean =>
    item.runId === address.runId && item.nodeId === address.nodeId && item.occurrence === address.occurrence;
  if (address.sliceId !== undefined) {
    return branches?.find((item) => same(item) && item.sliceId === address.sliceId) ?? null;
  }
  return steps?.find(same) ?? null;
}

/** What the run record kept of one step visit or branch. */
export interface SavedStepOutput {
  readonly replies: readonly RecordedAgentReply[];
  /** The commands the visit ran; empty for a branch, whose commands are not recorded per branch. */
  readonly commands: readonly RecordedCommand[];
  /** What the record cannot say for this address, in words; `null` when nothing is missing. */
  readonly note: string | null;
}

/**
 * The saved output of one step visit or branch: the replies recorded for it and, for a step,
 * the commands it ran. A branch reply is found by its `sliceId`, or, in a record written
 * before that field, by the " · <slice>" the runner appended to its label then.
 */
export function savedStepOutput(record: ParsedRunRecord, address: LiveOutputAddress): SavedStepOutput {
  const visit = (item: { readonly nodeId?: string; readonly occurrence?: number }): boolean =>
    item.nodeId === address.nodeId && item.occurrence === address.occurrence;
  const slice = address.sliceId;
  if (slice !== undefined) {
    return {
      replies: record.replies.filter(
        (reply) => visit(reply) && (reply.sliceId === slice || (reply.sliceId === undefined && reply.nodeLabel.endsWith(` · ${slice}`))),
      ),
      commands: [],
      note: 'Commands are recorded per step visit, not per branch, so a branch’s commands are not listed here.',
    };
  }
  return {
    replies: record.replies.filter((reply) => visit(reply) && reply.sliceId === undefined),
    commands: record.commands.filter(visit),
    note: null,
  };
}

/** The saved output as lines: each reply whole, then each command with how it ended. */
export function savedOutputLines(saved: SavedStepOutput): readonly string[] {
  const lines: string[] = [];
  for (const command of saved.commands) {
    const ended = command.notRun !== null ? 'not run' : command.exitCode === null ? `ended by ${command.signal ?? 'a signal'}` : `exit ${String(command.exitCode)}`;
    lines.push(`$ ${command.line ?? command.command}  (${ended})`);
  }
  if (saved.commands.length > 0) {
    lines.push('');
  }
  if (saved.replies.length === 0) {
    lines.push('The run record holds no reply for this.');
  }
  for (const reply of saved.replies) {
    if (saved.replies.length > 1) {
      lines.push(`— ${reply.nodeLabel} —`);
    }
    lines.push(reply.text);
  }
  if (saved.note !== null) {
    lines.push('', saved.note);
  }
  return lines;
}

/** The address as a window's query string, and read back. `null` when it is not one. */
export function stepOutputQuery(address: StepOutputAddress): string {
  const params = new URLSearchParams({ runId: address.runId, nodeId: address.nodeId, occurrence: String(address.occurrence) });
  if (address.sliceId !== undefined) {
    params.set('sliceId', address.sliceId);
  }
  if (address.conversationId !== undefined) {
    params.set('conversationId', address.conversationId);
  }
  return params.toString();
}

export function stepOutputFromQuery(search: string): StepOutputAddress | null {
  const params = new URLSearchParams(search);
  const runId = params.get('runId');
  const nodeId = params.get('nodeId');
  const occurrence = Number(params.get('occurrence'));
  const sliceId = params.get('sliceId');
  const conversationId = params.get('conversationId');
  if (runId === null || runId === '' || nodeId === null || nodeId === '' || !Number.isInteger(occurrence) || occurrence < 1) {
    return null;
  }
  return {
    runId,
    nodeId,
    occurrence,
    ...(sliceId === null || sliceId === '' ? {} : { sliceId }),
    ...(conversationId === null || conversationId === '' ? {} : { conversationId }),
  };
}

/**
 * The runs the main process has seen, each folded from the events it relays to the windows
 * (Niclas, 15 November 2026). The host keeps only the run on screen now, and replaces it with
 * the Ready offer when a run ends; this keeps the last few, so a step output window opened or
 * reopened after its step, or after the run, still shows everything that step streamed, once.
 * A run is kept from its `started`; one already running when the main process began is adopted
 * from the host's view when a window first asks for it.
 */
export class RunViewCache {
  private readonly views = new Map<string, RunView>();
  private readonly limit: number;

  constructor(limit = 3) {
    this.limit = limit;
  }

  receive(event: LoopRunEvent): void {
    if (event.kind === 'stood-down') {
      return;
    }
    if (event.kind === 'started') {
      if ((event.run.phase ?? 'running') !== 'ready' && !this.views.has(event.run.runId)) {
        this.keep(runViewFor(event.run));
      }
      return;
    }
    const runId = addressOf(event).runId;
    const view = this.views.get(runId);
    if (view !== undefined) {
      const next = applyRunEvent(view, event);
      if (next !== null && next !== view) {
        this.views.set(runId, next);
      }
    }
  }

  get(runId: string): RunView | null {
    return this.views.get(runId) ?? null;
  }

  /** A run the host is showing that this cache did not see start. */
  adopt(view: RunView): void {
    if (!this.views.has(view.run.runId) && view.run.phase !== 'ready') {
      this.keep(view);
    }
  }

  private keep(view: RunView): void {
    this.views.set(view.run.runId, view);
    while (this.views.size > this.limit) {
      const oldest = this.views.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.views.delete(oldest);
    }
  }
}

/**
 * A step output window's view of its run: events folded as they come, after one read of the
 * run as it stood. Events that arrive while that read is out are held and dropped when it
 * answers, because the answer already holds them (it and the events travel one ordered
 * path); applied again, a text fragment would appear twice. Without an answer, the held
 * events are all the window has, and they stay unapplied: a view cannot be built from the
 * middle of a run.
 */
export interface StepOutputFeed {
  readonly view: RunView | null;
  /** Events received before the opening read answered; `null` once it has. */
  readonly held: readonly LoopRunEvent[] | null;
}

export const OPENING_FEED: StepOutputFeed = { view: null, held: [] };

export function feedEvent(feed: StepOutputFeed, event: LoopRunEvent): StepOutputFeed {
  if (feed.held !== null) {
    return { ...feed, held: [...feed.held, event] };
  }
  const view = applyRunEvent(feed.view, event);
  return view === feed.view ? feed : { ...feed, view };
}

export function feedSeed(feed: StepOutputFeed, seed: RunView | null): StepOutputFeed {
  return { view: feed.view ?? seed, held: null };
}
