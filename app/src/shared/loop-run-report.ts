/**
 * DSP-209 S12: the run report — what a finished loop run did, built only from what DSpatch recorded.
 *
 * Its input is the run's journal, the replies the record keeps and the record's ending: the same
 * three things a run read back after a restart has, so a watched run and a restored one get the
 * same report. Nothing here is inferred from an agent's prose. Where an agent's words are shown —
 * a skip reason, a message body, what the integrator said about a proposal — they are quoted and
 * said to be that agent's. A fact DSpatch did not record reads "not recorded"; a cost the provider
 * did not report reads "not reported", never zero.
 *
 * Integration, completion and approval are kept apart (the vision's section on integration): the
 * report says which step ran after a fan-out and what it said, which verdicts steps declared, and
 * which steps were skipped — and closes with the one line that no review in it is the person's.
 *
 * Pure and shared: no Node built-ins, so the window builds it from a record it read back.
 */

import type { RecordedDrawnStep, RecordedRunEnding, RecordedSnapshots } from './loop-record';
import { CHECK_SKIPPED_TERMINAL, isGateCommand } from './loop-record';
import type { RunJournalEntry } from './loop-run';

/** The closing line of every report. Fixed. */
export const NOT_YOUR_APPROVAL = 'Agent review is not your approval.';

/** What a quoted body may show before it is cut, with the cut stated. */
export const REPORT_QUOTE_LIMIT = 600;

/** How many changed files are named before the rest are counted. */
export const REPORT_FILE_LIMIT = 40;

export interface RunReportReply {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly occurrence?: number;
  readonly text: string;
}

export interface RunReportInput {
  readonly journal: readonly RunJournalEntry[];
  readonly replies: readonly RunReportReply[];
  /** `null` when the run wrote no ending (interrupted) or no record came back. */
  readonly ending: RecordedRunEnding | null;
  /**
   * DSP-209 S14: the drawing's steps as the record's header names them. Absent or `null` in a
   * record written before the field: steps not reached are then "not recorded".
   */
  readonly drawnSteps?: readonly RecordedDrawnStep[] | null;
}

/** The fixed last line of "Left for you to examine". */
export const NOTHING_TRIED_BY_HAND = 'Nothing here was tried by hand; agent review is not your approval.';

export interface RunReportSection {
  readonly id:
    | 'path'
    | 'skipped'
    | 'handover'
    | 'fan-outs'
    | 'messages'
    | 'integration'
    | 'usage'
    | 'reviewed'
    | 'files'
    | 'branches'
    | 'not-reached'
    | 'left';
  readonly title: string;
  readonly lines: readonly string[];
}

export interface RunReport {
  /** One line for the folded view. */
  readonly summary: string;
  /** Only the sections that have something to say; a plain run has a short report. */
  readonly sections: readonly RunReportSection[];
  /** Always {@link NOT_YOUR_APPROVAL}. */
  readonly closing: string;
}

type Data = Readonly<Record<string, string | number | boolean>>;

function text(data: Data | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() !== '' && value !== '(none)' ? value : null;
}

function count(data: Data | undefined, key: string): number | null {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A body quoted as its sender's words, cut at the limit with the cut stated. */
export function quoteBody(body: string, limit = REPORT_QUOTE_LIMIT): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) {
    return `“${flat}”`;
  }
  return `“${flat.slice(0, limit)}…” (cut: ${String(limit)} of ${String(flat.length)} characters shown)`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function changedPaths(snapshots: RecordedSnapshots): readonly string[] {
  return [...snapshots.changed, ...snapshots.added, ...snapshots.removed].map((file) => file.relPath);
}

/**
 * DSP-209 S4 finding (i): a run that ended at "Done, check skipped" while DSpatch's own snapshots
 * show changed files says so. Corroboration only: it is said beside the ending and never routes.
 * `null` for every other ending, and when the snapshots were not taken.
 */
export function checkSkippedCorroboration(
  terminalNodeId: string | null,
  snapshots: RecordedSnapshots | null | undefined,
): string | null {
  if (terminalNodeId !== CHECK_SKIPPED_TERMINAL || snapshots === null || snapshots === undefined) {
    return null;
  }
  if (snapshots.beforeId === null || snapshots.afterId === null) {
    return null;
  }
  const paths = changedPaths(snapshots);
  if (paths.length === 0) {
    return null;
  }
  return `DSpatch observed ${plural(paths.length, 'changed file')}, and the check was skipped, so nothing reviewed ${paths.length === 1 ? 'it' : 'them'}.`;
}

interface Visit {
  readonly nodeId: string;
  readonly occurrence: number;
  readonly label: string;
  readonly kind: string;
  readonly role: string | null;
  ending: string;
  declared: string | null;
  providerTurns: number | null;
  stepMs: number | null;
  fanOutBound: boolean;
}

/** Labels the record knows: terminals carry theirs, replies carry the step's. */
function labelsFrom(input: RunReportInput): Map<string, string> {
  const labels = new Map<string, string>();
  // The drawing's own labels first (DSP-209 S14), then what replies and the journal say.
  for (const step of Array.isArray(input.drawnSteps) ? input.drawnSteps : []) {
    labels.set(step.id, step.label);
  }
  for (const reply of input.replies) {
    labels.set(reply.nodeId, reply.nodeLabel);
  }
  for (const entry of input.journal) {
    const label = text(entry.data, 'label');
    if (entry.kind === 'node-entered' && entry.nodeId !== undefined && label !== null) {
      labels.set(entry.nodeId, label);
    }
  }
  return labels;
}

function visitsFrom(journal: readonly RunJournalEntry[], labels: Map<string, string>): Visit[] {
  const visits: Visit[] = [];
  const counts = new Map<string, number>();
  let open: Visit | null = null;
  for (const entry of journal) {
    const nodeId = entry.nodeId;
    if (entry.kind === 'node-entered' && nodeId !== undefined) {
      const occurrence = count(entry.data, 'occurrence') ?? (counts.get(nodeId) ?? 0) + 1;
      counts.set(nodeId, occurrence);
      open = {
        nodeId,
        occurrence,
        label: labels.get(nodeId) ?? nodeId,
        kind: text(entry.data, 'kind') ?? 'step',
        role: text(entry.data, 'role'),
        ending: text(entry.data, 'kind') === 'terminal' ? 'the run ended here' : 'no ending recorded',
        declared: null,
        providerTurns: null,
        stepMs: null,
        fanOutBound: false,
      };
      visits.push(open);
      continue;
    }
    if (open === null || nodeId !== open.nodeId) {
      continue;
    }
    switch (entry.kind) {
      case 'node-produced': {
        const outcome = text(entry.data, 'outcome');
        const source = text(entry.data, 'outcomeSource');
        open.providerTurns = count(entry.data, 'providerTurns');
        open.stepMs = count(entry.data, 'stepMs');
        open.fanOutBound = text(entry.data, 'fanOutBound') !== null;
        open.declared = outcome !== null && (source === 'step-declared' || source === 'gate-verdict') ? outcome : null;
        open.ending =
          outcome === null
            ? (text(entry.data, 'product') ?? 'produced')
            : source === 'step-declared'
              ? `declared “${outcome}”`
              : source === 'gate-verdict'
                ? `gate verdict “${outcome}”`
                : source === 'engine-fallback'
                  ? `“${outcome}”, routed by the drawing because the step declared none`
                  : `“${outcome}”`;
        break;
      }
      case 'edge-taken': {
        const failure = text(entry.data, 'failure');
        if (open.fanOutBound) {
          open.ending = 'no branch started: not enough calls left for every branch (a bound, not a branch failing)';
        } else if (failure !== null && !open.ending.includes(failure)) {
          open.ending = `declared failure “${failure}”`;
        }
        break;
      }
      case 'runtime-fault':
        open.ending = `runtime fault: ${text(entry.data, 'fault') ?? 'kind not recorded'}`;
        break;
      case 'limit-reached':
        open.ending = `${open.ending}; bound ${text(entry.data, 'bound') ?? 'not recorded'} reached`;
        break;
      case 'handoff-requested':
        open.ending = 'recommended continuing interactively';
        break;
      default:
        break;
    }
  }
  return visits;
}

function describeVisit(visit: Visit): string {
  return `“${visit.label}” (${visit.nodeId})${visit.occurrence > 1 ? `, visit ${String(visit.occurrence)}` : ''}: ${visit.ending}`;
}

interface BranchRecord {
  readonly visitKey: string;
  readonly nodeId: string;
  readonly sliceId: string;
  started: Data | null;
  ended: Data | null;
}

function branchesFrom(journal: readonly RunJournalEntry[]): BranchRecord[] {
  const branches: BranchRecord[] = [];
  for (const entry of journal) {
    if (entry.kind !== 'branch-started' && entry.kind !== 'branch-ended') {
      continue;
    }
    const instanceId = text(entry.data, 'instanceId');
    const sliceId = text(entry.data, 'sliceId');
    if (instanceId === null || sliceId === null) {
      continue;
    }
    const visitKey = instanceId.slice(0, instanceId.lastIndexOf('/'));
    let branch = branches.find((known) => known.visitKey === visitKey && known.sliceId === sliceId);
    if (branch === undefined) {
      branch = { visitKey, nodeId: entry.nodeId ?? visitKey.split('#')[0] ?? visitKey, sliceId, started: null, ended: null };
      branches.push(branch);
    }
    if (entry.kind === 'branch-started') {
      branch.started = entry.data ?? {};
    } else {
      branch.ended = entry.data ?? {};
    }
  }
  return branches;
}

function fanOutLines(branches: readonly BranchRecord[], visits: readonly Visit[]): string[] {
  const lines: string[] = [];
  const keys = [...new Set(branches.map((branch) => branch.visitKey))];
  for (const key of keys) {
    const own = branches.filter((branch) => branch.visitKey === key);
    const first = own.find((branch) => branch.started !== null)?.started ?? null;
    const commit = text(first ?? undefined, 'base');
    const kind = text(first ?? undefined, 'baseKind');
    const untracked = count(first ?? undefined, 'untrackedNotIncluded');
    const base =
      first === null
        ? 'base not recorded'
        : commit === null
          ? 'no base commit (branches read the working folder, read-only)'
          : `base ${commit}${kind === null ? '' : ` (${kind})`}` +
            (untracked === null ? '' : untracked === 0 ? ', no untracked file left out' : `, ${plural(untracked, 'untracked file')} left out`);
    lines.push(`Fan-out ${key}: ${base}.`);
    for (const branch of own) {
      const owned = branch.started === null ? null : branch.started['ownedPaths'];
      const owns =
        typeof owned !== 'string' ? 'owned paths not recorded' : owned.trim() === '' ? 'owns no paths' : `owns ${owned}`;
      const ended = branch.ended;
      if (ended === null) {
        lines.push(`- ${branch.sliceId}: ${owns}; its ending is not recorded.`);
        continue;
      }
      const name = text(ended, 'branch');
      const sha = text(ended, 'commit');
      const kept = ended['worktreeKept'] === true;
      const problem = text(ended, 'problem');
      lines.push(
        `- ${branch.sliceId}: ${owns}; ${text(ended, 'ending') ?? 'ending not recorded'}` +
          (name === null ? '' : `; ${sha === null ? 'no commit' : `commit ${sha}`} on ${name}`) +
          (kept ? `; worktree kept: ${problem ?? 'reason not recorded'}` : '') +
          '.',
      );
    }
  }
  for (const visit of visits.filter((entry) => entry.fanOutBound)) {
    lines.push(
      `Fan-out ${visit.nodeId}#${String(visit.occurrence)}: no branch was started, because the run had not enough calls ` +
        'left for every branch. A bound, not a branch failing.',
    );
  }
  return lines;
}

interface SentMessage {
  readonly id: string;
  readonly data: Data;
}

function messageLines(journal: readonly RunJournalEntry[]): string[] {
  const sent: SentMessage[] = [];
  const lines: string[] = [];
  for (const entry of journal) {
    const id = text(entry.data, 'messageId');
    if (entry.kind === 'message-sent' && id !== null && entry.data !== undefined) {
      sent.push({ id, data: entry.data });
    }
  }
  for (const message of sent) {
    const from = text(message.data, 'from') ?? 'not recorded';
    const to = text(message.data, 'to') ?? 'not recorded';
    const purpose = text(message.data, 'purpose') ?? 'message';
    const body = typeof message.data['body'] === 'string' ? quoteBody(message.data['body']) : 'body not recorded';
    const person = from === 'the person';
    const contract = text(message.data, 'contractRef');
    lines.push(
      person
        ? `${message.id}: your instruction to the branches: ${body} (your words).`
        : `${message.id}: ${purpose} from ${from} to ${to}${contract === null ? '' : `, about ${contract}`}: ${body} (${from}'s words).`,
    );
    if (to === 'integrator') {
      lines.push('  to the integrator: no branch receives it; it was listed for the step after the fan-out.');
      continue;
    }
    const recipientsValue = message.data['recipients'];
    const recipients =
      typeof recipientsValue === 'string' && recipientsValue.trim() !== ''
        ? recipientsValue.split(',').map((part) => part.trim()).filter((part) => part !== '')
        : [];
    if (recipients.length === 0) {
      lines.push('  recipients not recorded.');
      continue;
    }
    for (const recipient of recipients) {
      const about = (kind: RunJournalEntry['kind'], key: string): boolean =>
        journal.some((entry) => entry.kind === kind && text(entry.data, 'messageId') === message.id && text(entry.data, key) === recipient);
      const state = about('message-delivered', 'to')
        ? about('message-acknowledged', 'by')
          ? 'delivered, acknowledged'
          : 'delivered, not acknowledged'
        : about('message-undelivered', 'to')
          ? 'undelivered: it ended without checking its messages'
          : 'delivery not recorded';
      lines.push(`  ${recipient}: ${state}.`);
    }
  }
  for (const entry of journal) {
    if (entry.kind === 'message-undelivered' && text(entry.data, 'messageId') === null) {
      const from = text(entry.data, 'from') ?? 'not recorded';
      const body = typeof entry.data?.['body'] === 'string' ? quoteBody(entry.data['body']) : 'body not recorded';
      lines.push(
        `Refused: ${text(entry.data, 'purpose') ?? 'message'} from ${from} to ${text(entry.data, 'to') ?? 'not recorded'}, ` +
          `which had already ended: ${body} (${from}'s words). No branch was restarted for it.`,
      );
    }
  }
  return lines;
}

function integrationLines(
  input: RunReportInput,
  visits: readonly Visit[],
  branches: readonly BranchRecord[],
  /** Filled with one line per open proposal, for "Left for you to examine". */
  proposalsOut: string[] = [],
): string[] {
  const lines: string[] = [];
  const keys = [...new Set(branches.map((branch) => branch.visitKey))];
  for (const key of keys) {
    const [nodeId, occurrenceText] = key.split('#');
    const at = visits.findIndex((visit) => visit.nodeId === nodeId && String(visit.occurrence) === occurrenceText);
    const next = at === -1 ? undefined : visits[at + 1];
    const proposals = input.journal.filter(
      (entry) =>
        entry.kind === 'message-sent' &&
        (text(entry.data, 'messageId') ?? '').startsWith(`${key}/`) &&
        (text(entry.data, 'purpose') === 'contract-change' || text(entry.data, 'to') === 'integrator'),
    );
    const ids = proposals.map((entry) => text(entry.data, 'messageId') ?? '');
    if (next === undefined || next.kind === 'terminal') {
      lines.push(`Fan-out ${key}: no step ran after it${ids.length === 0 ? '' : `, so its open proposals (${ids.join(', ')}) reached nobody`}.`);
      for (const id of ids) {
        proposalsOut.push(`Open proposal ${id}: no step ran after the fan-out to resolve it.`);
      }
      continue;
    }
    lines.push(
      `Fan-out ${key}: the step after it was “${next.label}” (${next.nodeId}); it ${next.ending}.` +
        (ids.length === 0 ? ' It was given no open proposal.' : ` It was given ${plural(ids.length, 'open proposal')}: ${ids.join(', ')}.`),
    );
    if (ids.length === 0) {
      continue;
    }
    const reply = input.replies.find(
      (entry) => entry.nodeId === next.nodeId && (entry.occurrence === undefined || entry.occurrence === next.occurrence),
    );
    for (const id of ids) {
      const said = reply === undefined ? null : reply.text.split(/\r?\n/).filter((line) => line.includes(id));
      const claim =
        said === null
          ? 'its reply is not recorded.'
          : said.length === 0
            ? 'its reply does not name it.'
            : `${quoteBody(said.join(' '), 300)} (${next.label}'s words, not DSpatch's finding).`;
      lines.push(`  ${id}: ${claim}`);
      proposalsOut.push(`Open proposal ${id}, given to “${next.label}”: ${claim}`);
    }
  }
  return lines;
}

function costText(cents: number | null): string {
  return cents === null ? 'cost not reported' : `${String(cents)} cents`;
}

function usageLines(input: RunReportInput, visits: readonly Visit[], branches: readonly BranchRecord[]): string[] {
  const lines: string[] = [];
  const end = [...input.journal].reverse().find((entry) => entry.kind === 'run-ended' || entry.kind === 'refused');
  const calls = count(end?.data, 'calls');
  const turns = count(end?.data, 'providerTurns');
  const rework = count(end?.data, 'reworkRounds');
  const cost = input.ending === null ? null : input.ending.cost;
  lines.push(
    `Run: ${calls === null ? 'calls not recorded' : plural(calls, 'call')}, ${turns === null ? 'provider turns not recorded' : plural(turns, 'provider turn')}` +
      `${rework === null || rework === 0 ? '' : `, ${plural(rework, 'rework round')}`}; ` +
      `${cost === null ? 'cost not recorded' : cost === 'unknown' ? 'cost not reported' : `${String(cost)} cents`}.`,
  );
  // Read as raw JSON from disk, so checked for shape here: a damaged value is not recorded, never a crash.
  const rawSessions: unknown = input.ending?.sessions;
  const sessions = Array.isArray(rawSessions)
    ? (rawSessions as unknown[]).filter(
        (session): session is { nodeId: string; costCents: number | null } =>
          typeof session === 'object' &&
          session !== null &&
          typeof (session as Record<string, unknown>)['nodeId'] === 'string' &&
          ((session as Record<string, unknown>)['costCents'] === null || typeof (session as Record<string, unknown>)['costCents'] === 'number'),
      )
    : undefined;
  const costFor = (nodeId: string): string =>
    sessions === undefined
      ? 'cost not recorded'
      : (() => {
          const own = sessions.filter((session) => session.nodeId === nodeId);
          if (own.length === 0) {
            return 'cost not recorded';
          }
          const known = own.filter((session) => session.costCents !== null);
          return known.length === 0 ? 'cost not reported' : costText(known.reduce((sum, session) => sum + (session.costCents ?? 0), 0));
        })();
  const seen = new Set<string>();
  for (const visit of visits) {
    if (visit.kind === 'terminal' || seen.has(visit.nodeId)) {
      continue;
    }
    seen.add(visit.nodeId);
    const own = visits.filter((entry) => entry.nodeId === visit.nodeId);
    const stepTurns = own.reduce<number | null>((sum, entry) => (entry.providerTurns === null ? sum : (sum ?? 0) + entry.providerTurns), null);
    const ms = own.reduce<number | null>((sum, entry) => (entry.stepMs === null ? sum : (sum ?? 0) + entry.stepMs), null);
    // A gate or router opens no provider session; any other step (or one whose kind a record
    // from before the field does not say) has its session's cost, or says it is not recorded.
    const spends = visit.kind !== 'gate' && visit.kind !== 'router';
    lines.push(
      `- “${visit.label}”: ${plural(own.length, 'visit')}, ` +
        `${stepTurns === null ? 'provider turns not recorded' : plural(stepTurns, 'provider turn')}` +
        `${ms === null ? '' : `, ${String(Math.round(ms / 1000))} s`}` +
        `${spends && branches.every((branch) => branch.nodeId !== visit.nodeId) ? `; ${costFor(visit.nodeId)}` : ''}.`,
    );
    for (const branch of branches.filter((entry) => entry.nodeId === visit.nodeId)) {
      const branchTurns = count(branch.ended ?? undefined, 'providerTurns');
      lines.push(
        `  branch ${branch.sliceId}: ${branchTurns === null ? 'provider turns not recorded' : plural(branchTurns, 'provider turn')}; ` +
          `${costFor(`${branch.nodeId}/${branch.sliceId}`)}.`,
      );
    }
  }
  return lines;
}

/**
 * What the record holds about review and checking, without classifying steps by their names: a
 * name is a label and decides nothing (S12 review). Every visit that declared an outcome, with its
 * declared word; a gate is named as one because that comes from the drawing's configuration.
 */
function reviewedLines(input: RunReportInput, visits: readonly Visit[], labels: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const visit of visits.filter((entry) => entry.kind !== 'terminal' && entry.declared !== null)) {
    lines.push(
      `${visit.kind === 'gate' ? 'Gate ' : ''}“${visit.label}”${visit.occurrence > 1 ? `, visit ${String(visit.occurrence)}` : ''}: ` +
        `declared “${visit.declared ?? ''}” — its own verdict, not checked by DSpatch.`,
    );
  }
  for (const command of (input.ending?.commands ?? []).filter((entry) => isGateCommand(entry))) {
    lines.push(
      `DSpatch ran ${command.line ?? command.command}: ` +
        (command.notRun === null ? `exit ${command.exitCode === null ? 'not recorded' : String(command.exitCode)}.` : `${command.notRun.message}`),
    );
  }
  for (const entry of input.journal.filter((item) => item.kind === 'node-skipped')) {
    lines.push(`“${labels.get(entry.nodeId ?? '') ?? entry.nodeId ?? 'a step'}” was skipped, so it checked nothing.`);
  }
  const corroboration = checkSkippedCorroboration(input.ending?.terminalNodeId ?? null, input.ending?.snapshots);
  if (corroboration !== null) {
    lines.push(`${corroboration} Said beside the ending only; it did not change the route.`);
  }
  if (lines.length === 0) {
    lines.push('No step declared a verdict, and DSpatch ran no check of its own.');
  }
  return lines;
}

function fileLines(ending: RecordedRunEnding | null): string[] {
  if (ending === null) {
    return ['Not recorded: the run wrote no ending.'];
  }
  const snapshots = ending.snapshots;
  if (snapshots.beforeId === null || snapshots.afterId === null) {
    return [`Not recorded: ${snapshots.truncated ?? 'DSpatch has no before-and-after snapshot of this run.'}`];
  }
  const paths = changedPaths(snapshots);
  if (paths.length === 0) {
    return ['DSpatch observed no file changed, added or removed.'];
  }
  const named = paths.slice(0, REPORT_FILE_LIMIT);
  return [
    ...named,
    ...(paths.length > named.length ? [`and ${plural(paths.length - named.length, 'more file')}`] : []),
    ...(snapshots.truncated === null ? [] : [snapshots.truncated]),
  ];
}

function handoverLines(input: RunReportInput): string[] {
  const lines: string[] = [];
  for (const entry of input.journal) {
    if (entry.kind === 'handoff-requested') {
      const reason = text(entry.data, 'reason');
      lines.push(
        `“${entry.nodeId ?? 'a step'}” recommended continuing interactively: ${reason === null ? 'reason not recorded' : quoteBody(reason, 300)} (its words).`,
      );
    }
    if (entry.kind === 'handoff-answered') {
      const choice = text(entry.data, 'choice');
      lines.push(
        choice === 'interactive'
          ? 'You chose to continue interactively; the loop ran nothing after it.'
          : choice === 'loop'
            ? 'You chose to keep it in the loop.'
            : choice === 'cancelled'
              ? 'The run was cancelled while it waited for your answer.'
              : 'Your answer is not recorded.',
      );
    }
  }
  if (input.ending?.status === 'handed-over') {
    const raw: unknown = input.ending.handover;
    const handover =
      typeof raw === 'object' && raw !== null && ((raw as Record<string, unknown>)['turn'] === 'queued' || (raw as Record<string, unknown>)['turn'] === 'refused')
        ? input.ending.handover
        : undefined;
    lines.push(
      handover === undefined
        ? 'Whether the handover turn was sent into the chat: not recorded.'
        : handover.turn === 'queued'
          ? 'The handover turn was queued to be sent into this chat when the run ended; whether it arrived is not in the record.'
          : `The handover turn was not sent: ${handover.note ?? 'no reason recorded'}`,
    );
  }
  return lines;
}

/** Build the report. Every line comes from a recorded event; nothing is guessed. */
export function buildRunReport(input: RunReportInput): RunReport {
  const labels = labelsFrom(input);
  const visits = visitsFrom(input.journal, labels);
  const branches = branchesFrom(input.journal);
  const skipped = input.journal.filter((entry) => entry.kind === 'node-skipped');
  const messages = input.journal.filter((entry) => entry.kind === 'message-sent');

  const sections: RunReportSection[] = [];
  const add = (id: RunReportSection['id'], title: string, lines: readonly string[]): void => {
    if (lines.length > 0) {
      sections.push({ id, title, lines });
    }
  };
  add(
    'path',
    'Path taken',
    visits.length === 0
      ? ['Not recorded: the journal holds no step.']
      : visits.map((visit, index) => `${String(index + 1)}. ${describeVisit(visit)}`),
  );
  add(
    'skipped',
    'Skipped steps',
    skipped.map((entry) => {
      const decidedBy = text(entry.data, 'decidedBy') ?? 'not recorded';
      const reason = text(entry.data, 'reason');
      return `“${labels.get(entry.nodeId ?? '') ?? entry.nodeId ?? 'a step'}”: skipped by “${labels.get(decidedBy) ?? decidedBy}”` +
        ` on edge ${entry.edgeId ?? 'not recorded'}. Reason: ${reason === null ? 'not recorded' : quoteBody(reason, 300)} (its words).`;
    }),
  );
  add('handover', 'Handover', handoverLines(input));
  add('fan-outs', 'Fan-outs', fanOutLines(branches, visits));
  add('messages', 'Messages between the branches', messageLines(input.journal));
  const proposals: string[] = [];
  add('integration', 'Integration', integrationLines(input, visits, branches, proposals));
  add('usage', 'Usage and cost', usageLines(input, visits, branches));
  add('reviewed', 'What was reviewed and checked', reviewedLines(input, visits, labels));
  add('files', 'Changed files DSpatch observed', fileLines(input.ending));
  const names = [...new Set(branches.map((branch) => text(branch.ended ?? branch.started ?? undefined, 'branch')).filter((name): name is string => name !== null))];
  add(
    'branches',
    'Temporary branches kept for you',
    names.length === 0 ? [] : [...names, 'DSpatch does not delete them: keep or delete each yourself.'],
  );

  // DSP-209 S14: drawn steps with no visit and no skip. Terminals and routers are not work.
  const drawn = Array.isArray(input.drawnSteps) ? input.drawnSteps : null;
  const notReached =
    drawn === null
      ? null
      : drawn.filter(
          (step) =>
            step.kind !== 'terminal' &&
            step.kind !== 'router' &&
            !visits.some((visit) => visit.nodeId === step.id) &&
            !skipped.some((entry) => entry.nodeId === step.id),
        );
  add(
    'not-reached',
    'Steps not reached',
    notReached === null
      ? ['Steps not reached: not recorded (older record).']
      : notReached.length === 0
        ? ['Every drawn step was visited or skipped.']
        : notReached.map((step) => `“${step.label}” (${step.id}), ${/^[aeiou]/.test(step.kind) ? 'an' : 'a'} ${step.kind} step: the run never reached it.`),
  );

  // DSP-209 S14: what is left for the person to examine, from recorded facts only; each line
  // points at the section with the detail rather than repeating it.
  const left: string[] = [];
  if (skipped.length > 0) {
    left.push(
      `${plural(skipped.length, 'skipped step')} with ${skipped.length === 1 ? 'its reason' : 'their reasons'}: ` +
        `${skipped.map((entry) => `“${labels.get(entry.nodeId ?? '') ?? entry.nodeId ?? 'a step'}”`).join(', ')} (see Skipped steps).`,
    );
  }
  const corroboration = checkSkippedCorroboration(input.ending?.terminalNodeId ?? null, input.ending?.snapshots);
  if (corroboration !== null) {
    left.push(corroboration);
  }
  const handoverRaw: unknown = input.ending?.handover;
  if (typeof handoverRaw === 'object' && handoverRaw !== null && (handoverRaw as Record<string, unknown>)['turn'] === 'refused') {
    const note = (handoverRaw as Record<string, unknown>)['note'];
    left.push(
      `The handover turn was not sent into the chat${typeof note === 'string' && note.trim() !== '' ? `: ${note.trim().replace(/\.$/, '')}` : ''} (see Handover).`,
    );
  }
  const undelivered = input.journal.filter((entry) => entry.kind === 'message-undelivered').length;
  if (undelivered > 0) {
    left.push(`${plural(undelivered, 'message')} recorded undelivered (see Messages between the branches).`);
  }
  left.push(...proposals);
  if (names.length > 0) {
    left.push(`${plural(names.length, 'temporary branch', 'temporary branches')} kept for you to keep or delete (see Temporary branches kept for you).`);
  }
  for (const branch of branches.filter((entry) => entry.ended?.['worktreeKept'] === true)) {
    left.push(`The worktree of branch ${branch.sliceId} (${branch.visitKey}) was kept: ${text(branch.ended ?? undefined, 'problem') ?? 'reason not recorded'}.`);
  }
  for (const visit of visits.filter((entry) => entry.kind !== 'terminal' && entry.declared !== null)) {
    left.push(`“${visit.label}” declared “${visit.declared ?? ''}”: its own verdict, not checked by DSpatch.`);
  }
  if (notReached !== null && notReached.length > 0) {
    left.push(`${plural(notReached.length, 'drawn step')} never reached: ${notReached.map((step) => `“${step.label}”`).join(', ')} (see Steps not reached).`);
  }
  add('left', 'Left for you to examine', [
    ...(left.length === 0 ? ['The record holds nothing that was skipped, left undelivered, kept or declared for you to examine.'] : left),
    NOTHING_TRIED_BY_HAND,
  ]);

  const steps = visits.filter((visit) => visit.kind !== 'terminal').length;
  const fileCount =
    input.ending === null || input.ending.snapshots.beforeId === null || input.ending.snapshots.afterId === null
      ? null
      : changedPaths(input.ending.snapshots).length;
  const cost = input.ending?.cost;
  const summary = [
    plural(steps, 'step'),
    ...(skipped.length === 0 ? [] : [`${String(skipped.length)} skipped`]),
    ...(branches.length === 0 ? [] : [plural(branches.length, 'branch', 'branches')]),
    ...(messages.length === 0 ? [] : [plural(messages.length, 'message')]),
    fileCount === null ? 'changed files not recorded' : plural(fileCount, 'changed file'),
    cost === undefined ? 'cost not recorded' : cost === 'unknown' ? 'cost not reported' : `${String(cost)} cents`,
  ].join(' · ');

  return { summary: `Run report: ${summary}`, sections, closing: NOT_YOUR_APPROVAL };
}

/** The report as plain text, one section after another, for copying and for tests. */
export function runReportText(report: RunReport): string {
  return [
    report.summary,
    ...report.sections.flatMap((section) => ['', `${section.title}:`, ...section.lines]),
    '',
    report.closing,
  ].join('\n');
}
