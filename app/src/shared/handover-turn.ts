/**
 * DSP-209 S6: the one chat turn DSpatch sends after a loop run was handed over to
 * interactive work, so the chat agent continues the task without the person typing it again.
 *
 * Pure. Everything in it is DSpatch's own record of the run — the mandate as the person
 * wrote it, the snapshot's id, the steps it walked, the handing-over step's own words and
 * the names of files DSpatch observed changed — and nothing else: no file contents, no diff
 * text. Record fields are written on one line, as the context snapshot writes them, so no
 * field can start a line that reads like a heading. The text says it is DSpatch's, so the
 * agent never takes it for the person's words (TASK_PRECEDENCE).
 */

import type { RunJournalEntry } from './loop-run';

export interface HandoverStep {
  readonly label: string;
  /** What the visit ended in, in a few words: an outcome, a failure, a recommendation. */
  readonly ending: string;
}

export interface HandoverInput {
  readonly runId: string;
  /** The run's mandate, verbatim. */
  readonly mandate: string;
  /** The context snapshot the run was given, or `null` when it was given none. */
  readonly contextSnapshotId: string | null;
  readonly steps: readonly HandoverStep[];
  /** The step that recommended continuing interactively. */
  readonly fromStep: string;
  /** Its reason, from its tool call. */
  readonly reason: string;
  /** That step's reply on the visit it recommended from, or `null` when none was kept. */
  readonly lastReply: string | null;
  /** Paths DSpatch observed changed, added or removed; `null` when it observed nothing it can say. */
  readonly changedPaths: readonly string[] | null;
  readonly limits?: { readonly maxReplyChars?: number; readonly maxPaths?: number };
}

const MAX_REPLY_CHARS = 2_000;
const MAX_PATHS = 50;

/** How the chat shows a handover turn in place of the person's message. */
export function handoverLabel(fromStep: string): string {
  return `Continued from the loop run — handed over by “${oneLine(fromStep)}”`;
}

/** The handover turn's text, as it is sent to the chat agent. */
export function buildHandoverTurn(input: HandoverInput): string {
  const maxReply = input.limits?.maxReplyChars ?? MAX_REPLY_CHARS;
  const maxPaths = input.limits?.maxPaths ?? MAX_PATHS;
  const from = oneLine(input.fromStep);
  const lines: string[] = [
    `=== DSpatch: handover from loop run ${oneLine(input.runId)} ===`,
    '',
    'DSpatch supplied this; the person did not type it. The loop run below was started from ' +
      `this conversation. At the step "${from}" its agent recommended continuing ` +
      'interactively, and the person chose to. Continue the task here, in this conversation: ' +
      'do what the mandate asks, building on what the run already did, and ask the person ' +
      'wherever a decision is needed. You have the same tools and permissions as before; ' +
      'nothing was granted for this. No file contents are included — read the project for ' +
      'what is there now.',
    '',
    "--- The run's mandate, as the person wrote it ---",
    ...quoted(input.mandate.trim()),
    '',
    '--- The context the run was given ---',
    input.contextSnapshotId === null
      ? 'None: the run was started without earlier conversation to carry.'
      : `Context snapshot ${oneLine(input.contextSnapshotId)}, kept with the run's record. It is ` +
        'not repeated here; the conversation above is where it came from.',
    '',
    "--- What the run did, from DSpatch's record ---",
    ...(input.steps.length === 0
      ? ['No step is recorded.']
      : input.steps.map((step) => `- ${oneLine(step.label)}: ${oneLine(step.ending)}.`)),
    '',
    `--- Why "${from}" recommended continuing interactively: the agent's words ---`,
    ...quoted(input.reason.trim()),
  ];

  lines.push('', `--- "${from}"'s last reply: the agent's words, not decisions ---`);
  const reply = input.lastReply?.trim() ?? '';
  if (reply === '') {
    lines.push('None was kept.');
  } else if (reply.length <= maxReply) {
    lines.push(...quoted(reply));
  } else {
    lines.push(
      ...quoted(reply.slice(0, maxReply)),
      `[DSpatch cut this reply at ${String(maxReply)} of ${String(reply.length)} characters; ` +
        `the whole reply is in the run's record.]`,
    );
  }

  lines.push('', '--- Files DSpatch observed changed during the run: names only, contents not included ---');
  if (input.changedPaths === null) {
    lines.push('Not known: DSpatch has no observation of the files for this run.');
  } else if (input.changedPaths.length === 0) {
    lines.push('None observed.');
  } else {
    const shown = input.changedPaths.slice(0, maxPaths);
    lines.push(...shown.map((name) => `- ${oneLine(name)}`));
    if (shown.length < input.changedPaths.length) {
      lines.push(`[${String(input.changedPaths.length - shown.length)} more not named here; git status lists them.]`);
    }
  }

  lines.push('', `=== end of DSpatch's handover from loop run ${oneLine(input.runId)} ===`);
  return lines.join('\n');
}

/**
 * The steps a run walked, as the handover names them, from its own journal: each visit's
 * produced outcome or failure, a recommendation to continue interactively, and skips.
 */
export function handoverStepsFrom(
  journal: readonly RunJournalEntry[],
  labelOf: (nodeId: string) => string,
): readonly HandoverStep[] {
  const steps: HandoverStep[] = [];
  for (const entry of journal) {
    const nodeId = entry.nodeId;
    if (nodeId === undefined) {
      continue;
    }
    if (entry.kind === 'node-produced') {
      const outcome = entry.data?.['outcome'];
      const product = entry.data?.['product'];
      steps.push({
        label: labelOf(nodeId),
        ending: typeof outcome === 'string' ? `ended as ${outcome}` : `ended with ${typeof product === 'string' ? product : 'a result'}`,
      });
    } else if (entry.kind === 'handoff-requested') {
      steps.push({ label: labelOf(nodeId), ending: 'recommended continuing interactively' });
    } else if (entry.kind === 'node-skipped') {
      const reason = entry.data?.['reason'];
      steps.push({ label: labelOf(nodeId), ending: `skipped (${typeof reason === 'string' ? reason : 'no reason given'})` });
    }
  }
  return steps;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Quoted line by line behind a bar, so nothing inside can read as one of the headings. */
function quoted(text: string): string[] {
  return (text === '' ? '[nothing]' : text).split(/\r?\n/).map((line) => `| ${line}`);
}
