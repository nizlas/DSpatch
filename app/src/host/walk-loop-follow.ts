/**
 * DSP-190: the walk loop run as the windows follow it, kept by the host while it runs and
 * read back from its files afterwards.
 *
 * Two things are held here, and one rule binds them. The graph side is the run view the graph
 * editor reads (`loop-run-view.ts`): the announcement, the engine's journal folded by the same
 * `applyRunEvent`, the ending. The activity side is the walk loop's own list: what the provider
 * reported in the active turn (streamed reply text, reasoning text where the provider exposes
 * it, tool calls and their results, commands, usage) and what DSpatch itself did (a turn sent,
 * a check made, a verdict read), each entry addressed to the node visit and the turn it happened
 * in and numbered in sequence. The rule: **nothing is said that was not reported.** A quiet turn
 * has no entries, and silence from the provider stays silence.
 *
 * Text fragments are coalesced for a short moment before they leave the host, so a stream of
 * one-word deltas does not become a stream of one-word messages; every other event goes out at
 * once, after any text waiting, so the order a window sees is the order things happened. The
 * reply text is not written to disk here (the record keeps every answer whole); reasoning text
 * is, within a bound per turn; everything else is written as it comes. A window that opens
 * while the run goes is handed the state so far (`snapshot`) and then only what follows.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AgentEvent } from '../adapter/types';
import { referencedRoles, resolvedRolesWith } from '../main/loop-graph-open';
import { describeToolActivity } from '../shared/loop-activity';
import type { RoleResolver } from '../shared/loop-graph';
import { parseRunRecord } from '../shared/loop-record';
import type { RunJournalEntry, RunStatus } from '../shared/loop-run';
import { applyRunEvent, runViewFor, type LiveRunAnnouncement, type RunView } from '../shared/loop-run-view';
import { toolActivity } from '../shared/review-pair';
import { walkLoopActivityFrom, walkLoopSummaryFrom, type WalkLoopActivity, type WalkLoopSummary, type WalkLoopTurnAddress, type WalkLoopTurnStatus, type WalkLoopUsage, type WalkReview } from '../shared/walk-method';
import type { WalkLoopRunEvent, WalkLoopRunSnapshot } from '../shared/walk-loop-view';

export const WALK_LOOP_ACTIVITY_FILE = 'activity.jsonl';
export const WALK_LOOP_GRAPH_FILE = 'graph.json';
export const WALK_LOOP_SUMMARY_FILE_NAME = 'summary.json';

/** How long text fragments wait for company before they are sent on. */
export const TEXT_FLUSH_MS = 150;
/** Reasoning text kept on disk per turn; what follows is counted and not kept. */
export const REASONING_KEPT_PER_TURN = 64 * 1024;
/** A command's output kept in the activity (the adapter's own bound applies before it). */
const COMMAND_OUTPUT_KEPT = 8 * 1024;

export interface WalkLoopFollowOptions {
  readonly key: string;
  readonly jobId: string;
  /** The run's folder: `activity.jsonl` and `graph.json` go beside its record. */
  readonly dir: string;
  readonly emit: (event: WalkLoopRunEvent) => void;
  readonly log: (message: string) => void;
  /** A tool's subject as shown: relative to the revision folder. */
  readonly relative?: (subject: string) => string;
  readonly now?: () => number;
}

/** Omit over each member of the union, so each kind keeps its own fields. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** An entry as a caller gives it: the address, the sequence number and the time are added here. */
type ActivityBody = DistributiveOmit<WalkLoopActivity, 'seq' | 'runId' | 'atUtc' | 'nodeId' | 'occurrence' | 'turn'>;

export class WalkLoopFollow {
  private readonly options: WalkLoopFollowOptions;

  private view: RunView | null = null;

  private activity: WalkLoopActivity[] = [];

  private seq = 0;

  private runId = '';

  private address: WalkLoopTurnAddress = { nodeId: '', occurrence: 0, turn: 0 };

  private readonly visits = new Map<string, number>();

  private pending: { readonly kind: 'reply-text' | 'reasoning-text'; text: string } | null = null;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private reasoningKept = 0;

  private reasoningCut = false;

  private closed = false;

  constructor(options: WalkLoopFollowOptions) {
    this.options = options;
  }

  /** The run announces itself: which drawing, which roles, which agent. The drawing is kept with the run. */
  announce(run: LiveRunAnnouncement): void {
    if (this.closed) {
      return;
    }
    this.runId = run.runId;
    this.view = runViewFor(run);
    try {
      fs.mkdirSync(this.options.dir, { recursive: true });
      fs.writeFileSync(path.join(this.options.dir, WALK_LOOP_GRAPH_FILE), run.graphText, 'utf8');
    } catch (error) {
      this.options.log(`walk loop ${run.runId}: the drawing could not be kept with the run: ${describe(error)}`);
    }
    this.options.emit({ key: this.options.key, jobId: this.options.jobId, event: { kind: 'started', run } });
  }

  /** One line of the engine's journal: the same event the graph editor folds. */
  journal(entry: RunJournalEntry): void {
    if (this.view === null || this.closed) {
      return;
    }
    if (entry.kind === 'node-entered' && entry.nodeId !== undefined) {
      const occurrence = (this.visits.get(entry.nodeId) ?? 0) + 1;
      this.visits.set(entry.nodeId, occurrence);
      this.address = { nodeId: entry.nodeId, occurrence, turn: this.address.turn };
    }
    this.flush();
    const event = { kind: 'journal' as const, runId: this.view.run.runId, graphVersionId: this.view.run.graphVersionId, entry };
    this.view = applyRunEvent(this.view, event);
    this.options.emit({ key: this.options.key, jobId: this.options.jobId, event });
  }

  /** The run has ended, as the engine reported it. */
  ended(ending: { readonly status: RunStatus | null; readonly note: string; readonly terminalNodeId: string | null }): void {
    if (this.view === null || this.closed) {
      return;
    }
    this.flush();
    const event = { kind: 'ended' as const, runId: this.view.run.runId, graphVersionId: this.view.run.graphVersionId, status: ending.status, note: ending.note, terminalNodeId: ending.terminalNodeId };
    this.view = applyRunEvent(this.view, event);
    this.options.emit({ key: this.options.key, jobId: this.options.jobId, event });
  }

  /** A prompt is being sent in this node visit. `what` is DSpatch's sentence about the turn. */
  turnStarted(visit: { readonly nodeId: string; readonly occurrence: number }, stepId: string | null, roleId: string | null, what: string): void {
    if (this.closed) {
      return;
    }
    this.flush();
    this.address = { nodeId: visit.nodeId, occurrence: visit.occurrence, turn: this.address.turn + 1 };
    this.reasoningKept = 0;
    this.reasoningCut = false;
    this.add({ kind: 'turn-started', stepId, roleId, what }, true);
  }

  /** The turn ended, as the provider reported it. The turn's fragments become one text each. */
  turnEnded(status: WalkLoopTurnStatus, error: string | null, textLength: number): void {
    if (this.closed) {
      return;
    }
    this.flush();
    this.compact(this.address.turn);
    this.add({ kind: 'turn-ended', status, error, textLength }, true);
  }

  /** DSpatch's own status, between turns: a check made, a repair asked for. */
  note(text: string): void {
    if (this.closed) {
      return;
    }
    this.flush();
    this.add({ kind: 'note', text }, true);
  }

  /** The reviewer's verdict, as read from its answer. */
  verdict(review: WalkReview, final: boolean): void {
    if (this.closed) {
      return;
    }
    this.flush();
    this.add({ kind: 'verdict', review, final }, true);
  }

  /** What the provider reported in the active turn, as the adapter normalised it. */
  adapterEvent(event: AgentEvent): void {
    if (this.closed || this.runId === '') {
      return;
    }
    switch (event.type) {
      case 'assistant.delta':
        this.text('reply-text', event.text);
        return;
      case 'reasoning.delta':
        this.text('reasoning-text', event.text);
        return;
      case 'tool.started': {
        this.flush();
        const subject = event.subject === undefined ? null : (this.options.relative?.(event.subject) ?? event.subject);
        const summary = toolActivity(event.name, subject) ?? describeToolActivity(event.name, 'started', event.rawProviderEvent).summary;
        this.add({ kind: 'tool-started', callId: event.toolCallId, name: event.name, summary }, true);
        return;
      }
      case 'tool.finished': {
        this.flush();
        const described = describeToolActivity(event.name, event.status, event.rawProviderEvent);
        const started = this.activity.find((entry) => entry.kind === 'tool-started' && entry.callId === event.toolCallId && entry.turn === this.address.turn);
        const summary = started !== undefined && started.kind === 'tool-started' ? `${started.summary}${event.status === 'error' ? ' (refused or failed)' : ''}` : described.summary;
        this.add({ kind: 'tool-finished', callId: event.toolCallId, name: event.name, status: event.status, summary, detail: described.detail }, true);
        return;
      }
      case 'command.finished': {
        this.flush();
        const command = event.command;
        const output = `${command.stdout}${command.stderr === '' ? '' : `${command.stdout === '' ? '' : '\n'}${command.stderr}`}`;
        this.add(
          {
            kind: 'command',
            line: command.line,
            ending: command.ending,
            exitCode: command.exitCode,
            output: output.slice(0, COMMAND_OUTPUT_KEPT),
            truncated: command.outputTruncated || output.length > COMMAND_OUTPUT_KEPT,
          },
          true,
        );
        return;
      }
      case 'usage': {
        this.flush();
        const readings: WalkLoopUsage[] = event.readings.map((reading) => ({ unit: reading.unit, scope: reading.scope, value: reading.value, source: reading.source }));
        this.add({ kind: 'usage', readings }, true);
        return;
      }
      default:
        return;
    }
  }

  /** The run so far, for a window opening or reopening while it goes. */
  snapshot(): WalkLoopRunSnapshot {
    this.flush();
    return { jobId: this.options.jobId, view: this.view, activity: [...this.activity], summary: null, live: true, limitations: [] };
  }

  /** Nothing more will be added. Text still waiting goes out. */
  close(): void {
    this.flush();
    this.closed = true;
  }

  private text(kind: 'reply-text' | 'reasoning-text', text: string): void {
    if (text === '') {
      return;
    }
    if (this.pending !== null && this.pending.kind !== kind) {
      this.flush();
    }
    if (this.pending === null) {
      this.pending = { kind, text: '' };
    }
    this.pending.text += text;
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, TEXT_FLUSH_MS);
    }
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const pending = this.pending;
    this.pending = null;
    if (pending === null || pending.text === '') {
      return;
    }
    if (pending.kind === 'reply-text') {
      // The answer whole is on the record's reply line; the fragments are for the windows.
      this.add({ kind: 'reply-text', text: pending.text }, false);
      return;
    }
    const room = REASONING_KEPT_PER_TURN - this.reasoningKept;
    const kept = pending.text.slice(0, Math.max(0, room));
    this.reasoningKept += kept.length;
    this.add({ kind: 'reasoning-text', text: pending.text }, false, kept === '' ? undefined : { ...this.entryBase(), kind: 'reasoning-text', text: kept });
    if (kept.length < pending.text.length && !this.reasoningCut) {
      this.reasoningCut = true;
      this.write({ ...this.entryBase(), kind: 'note', text: `Reasoning text beyond ${String(REASONING_KEPT_PER_TURN / 1024)} KB in this turn was shown and not kept.` });
    }
  }

  /** Fragments of one turn become one text each, so a snapshot carries one entry per text. */
  private compact(turn: number): void {
    for (const kind of ['reply-text', 'reasoning-text'] as const) {
      const fragments = this.activity.filter((entry) => entry.kind === kind && entry.turn === turn);
      if (fragments.length <= 1) {
        continue;
      }
      const first = fragments[0] as WalkLoopActivity & { readonly kind: typeof kind };
      const joined: WalkLoopActivity = { ...first, text: fragments.map((entry) => (entry.kind === kind ? entry.text : '')).join(''), atUtc: fragments.at(-1)?.atUtc ?? first.atUtc };
      this.activity = this.activity.filter((entry) => !(entry.kind === kind && entry.turn === turn) || entry === first).map((entry) => (entry === first ? joined : entry));
    }
  }

  private entryBase(): WalkLoopTurnAddress & { readonly seq: number; readonly runId: string; readonly atUtc: string } {
    this.seq += 1;
    return { ...this.address, seq: this.seq, runId: this.runId, atUtc: new Date(this.options.now?.() ?? Date.now()).toISOString() };
  }

  private add(partial: ActivityBody, persist: boolean, written?: WalkLoopActivity): void {
    const entry = { ...this.entryBase(), ...partial } as WalkLoopActivity;
    this.activity.push(entry);
    if (persist) {
      this.write(entry);
    } else if (written !== undefined) {
      this.write({ ...written, seq: entry.seq, atUtc: entry.atUtc });
    }
    this.options.emit({ key: this.options.key, jobId: this.options.jobId, activity: entry });
  }

  private write(entry: WalkLoopActivity): void {
    try {
      fs.appendFileSync(path.join(this.options.dir, WALK_LOOP_ACTIVITY_FILE), `${JSON.stringify({ line: 'activity', activity: entry })}\n`, 'utf8');
    } catch (error) {
      this.options.log(`walk loop ${this.runId}: an activity line could not be written: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ReadWalkLoopFollowInput {
  readonly jobId: string;
  readonly dir: string;
  /** The summary the job keeps, or `null` to read `summary.json`. */
  readonly summary: WalkLoopSummary | null;
  /** The current drawing, for a run recorded before the drawing was kept with it. */
  readonly fallbackGraphText: string | null;
  readonly resolveRole: RoleResolver;
  readonly provider: string;
  readonly model: string;
}

/**
 * A finished run as its files hold it: the record's identity, journal and ending as the view,
 * the activity file as the activity, with the answers whole from the record. A run recorded
 * before the activity was kept (0.1.14) shows its turns and answers and says what is missing.
 */
export function readWalkLoopFollow(input: ReadWalkLoopFollowInput): WalkLoopRunSnapshot | { readonly error: string } {
  let recordText: string;
  try {
    recordText = fs.readFileSync(path.join(input.dir, 'record.jsonl'), 'utf8');
  } catch (error) {
    return { error: `The run's record could not be read: ${describe(error)}` };
  }
  const parsed = parseRunRecord(recordText);
  const limitations: string[] = [];
  if (parsed.error !== null) {
    limitations.push(parsed.error);
  }
  let summary = input.summary;
  if (summary === null) {
    try {
      summary = walkLoopSummaryFrom(JSON.parse(fs.readFileSync(path.join(input.dir, WALK_LOOP_SUMMARY_FILE_NAME), 'utf8')));
    } catch {
      summary = null;
    }
  }
  let graphText: string | null = null;
  try {
    graphText = fs.readFileSync(path.join(input.dir, WALK_LOOP_GRAPH_FILE), 'utf8');
  } catch {
    graphText = input.fallbackGraphText;
    if (graphText !== null) {
      limitations.push('The drawing was not kept with this run; the drawing DSpatch has now is shown, and the run\'s marks are placed on it by node name.');
    }
  }
  const identity = parsed.identity;
  let view: RunView | null = null;
  if (identity !== null && graphText !== null) {
    const run: LiveRunAnnouncement = {
      runId: identity.runId,
      graphVersionId: identity.graphVersionId,
      graphId: identity.graphId,
      graphName: graphNameOf(graphText) ?? identity.graphId,
      binding: 'walk-loop',
      graphText,
      startedAtUtc: identity.startedAtUtc,
      roles: resolvedRolesWith(referencedRoles(graphText), input.resolveRole),
      phase: 'running',
      agent: `${input.provider}/${input.model}`,
    };
    view = runViewFor(run);
    for (const entry of parsed.journal) {
      view = applyRunEvent(view, { kind: 'journal', runId: run.runId, graphVersionId: run.graphVersionId, entry });
    }
    const ending = parsed.ending;
    if (ending !== null) {
      view = applyRunEvent(view, { kind: 'ended', runId: run.runId, graphVersionId: run.graphVersionId, status: ending.status, note: ending.note, terminalNodeId: ending.terminalNodeId });
    } else {
      view = applyRunEvent(view, { kind: 'ended', runId: run.runId, graphVersionId: run.graphVersionId, status: null, note: 'The record has no ending line: the run was interrupted before it wrote one.', terminalNodeId: null });
      limitations.push('The record has no ending line: the run was interrupted before it wrote one, so where it stopped is the last line it wrote.');
    }
  } else if (identity === null) {
    limitations.push('The record has no header, so the run cannot be drawn.');
  } else {
    limitations.push('No drawing is available for this run, so it cannot be drawn.');
  }

  // The activity as kept, with each answer whole from the record at its turn's end.
  const runId = identity?.runId ?? '';
  let kept: WalkLoopActivity[] = [];
  let activityFileRead = false;
  try {
    const lines = fs.readFileSync(path.join(input.dir, WALK_LOOP_ACTIVITY_FILE), 'utf8').split('\n');
    activityFileRead = true;
    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }
      try {
        const raw = JSON.parse(line) as { readonly line?: unknown; readonly activity?: unknown };
        const entry = raw.line === 'activity' ? walkLoopActivityFrom(raw.activity) : null;
        if (entry !== null) {
          kept.push(entry);
        }
      } catch {
        // A line this build cannot read is left out; the rest still reads.
      }
    }
  } catch {
    activityFileRead = false;
  }
  const replies = parsed.replies;
  if (!activityFileRead) {
    limitations.push('This run was made by an earlier DSpatch, which kept only its answers: the live text, the reasoning and the tool activity were not recorded for it.');
    // The turns from the record alone: one started, one answer, one ended per reply.
    let turn = 0;
    kept = replies.flatMap((reply): WalkLoopActivity[] => {
      turn += 1;
      const base = { runId, nodeId: reply.nodeId, occurrence: reply.occurrence, turn, atUtc: reply.atUtc };
      return [
        { ...base, seq: 0, kind: 'turn-started', stepId: null, roleId: reply.roleId ?? null, what: `${reply.nodeLabel} (visit ${String(reply.occurrence)})` },
        { ...base, seq: 0, kind: 'reply-text', text: reply.text },
        { ...base, seq: 0, kind: 'turn-ended', status: turnStatusOf(reply.terminalStatus), error: null, textLength: reply.text.length },
      ];
    });
  } else {
    // Each turn's answer, whole, placed before the turn's end.
    const out: WalkLoopActivity[] = [];
    let turn = 0;
    for (const entry of kept) {
      if (entry.kind === 'turn-ended') {
        const reply = replies[turn];
        turn += 1;
        if (reply !== undefined) {
          out.push({ seq: 0, runId: entry.runId, nodeId: entry.nodeId, occurrence: entry.occurrence, turn: entry.turn, atUtc: reply.atUtc, kind: 'reply-text', text: reply.text });
        }
      }
      out.push(entry);
    }
    kept = out;
  }
  const activity = kept.map((entry, index) => ({ ...entry, seq: index + 1 }));
  return { jobId: input.jobId, view, activity, summary, live: false, limitations };
}

function turnStatusOf(status: string | null): WalkLoopTurnStatus {
  return status === 'failed' || status === 'cancelled' || status === 'unconfirmed' ? status : 'finished';
}

function graphNameOf(text: string): string | null {
  try {
    const parsed = JSON.parse(text.replace(/^﻿/, '')) as { readonly name?: unknown };
    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
}
