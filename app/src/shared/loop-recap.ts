/**
 * DSP-209 S7: what loop runs in a conversation did, for the chat agent, once.
 *
 * A loop's steps run in sessions of their own, so the conversation's chat session never
 * saw them. After a run ends, the person's next ordinary message is sent with this recap in
 * front of it, disclosed beforehand and removable, the way DSP-121's recap is. Built from
 * the run records by S1's reading of them, and nothing else: the mandate as the person wrote
 * it, how the run ended, the steps it skipped, a handover, and the names of files DSpatch
 * observed changed. No file contents. It is DSpatch's text and says so.
 */

import type { StoredMessage } from './bridge';
import { earlierRunFromRecord, type EarlierRunSummary } from './context-snapshot';
import type { ParsedRunRecord } from './loop-record';

/** The recap the next ordinary message would carry. */
export interface PendingLoopRecap {
  readonly runIds: readonly string[];
  readonly text: string;
}

/** One run's record, as `RunRecordStore.listForConversation` gives it, oldest first. */
export interface LoopRecapRecord {
  readonly runId: string;
  readonly record: ParsedRunRecord | null;
}

/**
 * The runs the next message should tell the chat agent about, oldest first.
 *
 * A run is offered when its record has an ending, the ending is later than the
 * conversation's last saved message, and no saved message has already accounted for it —
 * by carrying its recap, by recording that the person removed it, or by being its handover
 * turn (S6), which delivered its material already. `exclude` is the runs the person removed
 * in this session and has not yet sent a message after.
 */
export function loopRecapRuns(
  records: readonly LoopRecapRecord[],
  messages: readonly Pick<StoredMessage, 'startedAtUtc' | 'handover' | 'loopRecap'>[],
  exclude: readonly string[] = [],
): readonly LoopRecapRecord[] {
  const accounted = new Set<string>(exclude);
  let lastMessageAt = '';
  for (const message of messages) {
    for (const runId of message.loopRecap?.runIds ?? []) {
      accounted.add(runId);
    }
    if (message.handover !== undefined) {
      accounted.add(message.handover.runId);
    }
    if (message.startedAtUtc > lastMessageAt) {
      lastMessageAt = message.startedAtUtc;
    }
  }
  return records.filter((entry) => {
    const ending = entry.record?.ending ?? null;
    return ending !== null && !accounted.has(entry.runId) && ending.endedAtUtc > lastMessageAt;
  });
}

/** The recap for these runs, or `null` when there are none. */
export function buildLoopRecap(runs: readonly LoopRecapRecord[]): PendingLoopRecap | null {
  const described = runs
    .map((entry) => ({ entry, summary: earlierRunFromRecord(entry.runId, entry.record) }))
    .filter((item): item is { entry: LoopRecapRecord; summary: EarlierRunSummary } => item.summary !== null);
  if (described.length === 0) {
    return null;
  }
  const lines: string[] = [
    '=== DSpatch: what loop runs in this conversation did ===',
    '',
    'DSpatch supplied this; the person did not type it. Loop runs started from this ' +
      'conversation ran in agent sessions of their own, so you did not see them. This is ' +
      "DSpatch's record of them, sent once, with the person's next message, which follows it. " +
      'It holds each run\'s mandate, how it ended, the steps it skipped and the names of files ' +
      'DSpatch observed changed. No file contents: read the project for what is there now.',
  ];
  for (const { entry, summary } of described) {
    lines.push(
      '',
      `--- Run ${oneLine(summary.runId)}: ended as ${oneLine(summary.ending)}${
        summary.terminal === null ? ', at no terminal' : `, at "${oneLine(summary.terminal)}"`
      } ---`,
    );
    for (const step of summary.skippedSteps ?? []) {
      lines.push(`Skipped "${oneLine(step.step)}": ${oneLine(step.reason)}.`);
    }
    if (summary.handedOverFrom !== undefined) {
      lines.push(`Handed over to interactive work from "${oneLine(summary.handedOverFrom)}".`);
    }
    lines.push("Its mandate, as the person wrote it:", ...quoted(summary.mandate.trim()));
    const snapshots = entry.record?.ending?.snapshots ?? null;
    if (snapshots === null || snapshots.beforeId === null || snapshots.afterId === null) {
      lines.push('Files changed: not known; DSpatch has no observation of the files for this run.');
    } else {
      const names = [...snapshots.changed, ...snapshots.added, ...snapshots.removed].map((file) => oneLine(file.relPath));
      lines.push(names.length === 0 ? 'Files changed: none observed.' : `Files changed: ${names.join(', ')}.`);
    }
  }
  lines.push('', "=== end of DSpatch's loop recap ===");
  return { runIds: described.map(({ entry }) => entry.runId), text: lines.join('\n') };
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function quoted(text: string): string[] {
  return (text === '' ? '[nothing]' : text).split(/\r?\n/).map((line) => `| ${line}`);
}
