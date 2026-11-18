/**
 * DSP-209 S20: a fan-out's branches as a person reads them, without hovering.
 *
 * Words only, built from S16's {@link BranchView} and the branches' live activity. The node's
 * summary line, the Branches list in the editor and in chat, and the branch output window all
 * read these, so the three cannot word one branch two ways. Nothing here is an agent's
 * context: it is presentation, and nothing it returns is passed to a step (R4).
 *
 * Pure and shared: no Node built-ins.
 */

import type { BranchActivityState } from './loop-activity';
import {
  TASK_NOT_RECORDED,
  liveOutputAddressFor,
  type BranchState,
  type BranchView,
  type LiveOutputAddress,
} from './run-presentation';

/** How a message is delivered, said once beside the counts. */
export const BRANCH_MESSAGES_NOTE =
  'A message is delivered when the receiving branch next checks its messages, not when it is sent. ' +
  'Acknowledged is separate: the branch said it acted on it. Undelivered means the branch ended without checking.';

const STATE_WORDS: Readonly<Record<BranchState, string>> = {
  queued: 'queued',
  running: 'working',
  finished: 'finished',
  failed: 'failed',
  cancelled: 'cancelled',
};

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * The line on the fan-out node: "3 branches · 1 working · 2 finished".
 *
 * The current visit's branches only. When the node's latest visit has none yet, the line
 * names the earlier visit's and says it is earlier, so an old count is never read as now.
 * `null` for a node with no branches in this run.
 */
export function branchSummaryLine(branches: readonly BranchView[], nodeId: string): string | null {
  const own = branches.filter((branch) => branch.visit.nodeId === nodeId);
  if (own.length === 0) {
    return null;
  }
  const current = own.filter((branch) => branch.current);
  const shown = current.length > 0 ? current : own.filter((branch) => branch.visit.occurrence === Math.max(...own.map((item) => item.visit.occurrence)));
  const counts = new Map<BranchState, number>();
  for (const branch of shown) {
    counts.set(branch.state, (counts.get(branch.state) ?? 0) + 1);
  }
  const parts = [plural(shown.length, 'branch', 'branches')];
  for (const state of ['running', 'queued', 'finished', 'failed', 'cancelled'] as const) {
    const count = counts.get(state) ?? 0;
    if (count > 0) {
      parts.push(`${String(count)} ${STATE_WORDS[state]}`);
    }
  }
  return `${current.length > 0 ? '' : 'earlier visit: '}${parts.join(' · ')}`;
}

/** One branch as a row of the Branches list. Every field is visible text. */
export interface BranchRow {
  readonly key: string;
  readonly sliceId: string;
  /** "visit 2", or "earlier visit (visit 1)" for a visit before the current one. */
  readonly visitLabel: string;
  readonly current: boolean;
  readonly task: string;
  /** The state word, with the journal's ending where it is not `finished` ("failed: no-worktree"). */
  readonly state: string;
  /** DSP-226: the role it ran as ("role generic-researcher, as researcher"), or "not recorded". */
  readonly role: string;
  /** DSP-226: its model class, written out ("Large"), or `null` where it had none. */
  readonly modelClass: string | null;
  readonly model: string;
  readonly messages: string;
  readonly address: LiveOutputAddress;
}

function stateText(branch: BranchView): string {
  const word = STATE_WORDS[branch.state];
  if (branch.ending === null || branch.ending === 'finished' || branch.ending === word) {
    return word;
  }
  return `${word}: ${branch.ending}`;
}

function classWord(name: string | null): string | null {
  return name === null || name === '' ? null : `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
}

/**
 * DSP-226: the model classes of a fan-out node's current (or latest) visit's branches, each
 * with its count, in the order the branches started: "Small ×1 · Large ×2". `null` when none
 * recorded a class. A fan-out with several classes is never shown as one of them.
 */
export function branchClassSummary(branches: readonly BranchView[], nodeId: string): {
  readonly classes: readonly string[];
  readonly line: string;
} | null {
  const own = branches.filter((branch) => branch.visit.nodeId === nodeId);
  if (own.length === 0) {
    return null;
  }
  const latest = Math.max(...own.map((branch) => branch.visit.occurrence));
  const counts = new Map<string, number>();
  for (const branch of own.filter((item) => item.visit.occurrence === latest)) {
    const word = classWord(branch.model?.modelClass ?? null);
    if (word !== null) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return null;
  }
  return {
    classes: [...counts.keys()],
    line: [...counts.entries()].map(([word, count]) => `${word} ×${String(count)}`).join(' · '),
  };
}

function modelText(branch: BranchView): string {
  const model = branch.model;
  if (model === null) {
    return 'the run’s model';
  }
  const name = model.model === '' ? 'the provider’s default' : model.model;
  const how = model.source === 'policy' ? `${model.modelClass == null ? '' : `class ${classWord(model.modelClass) ?? ''}, `}chosen by the policy${model.option === null ? '' : ` (option “${model.option}”)`}` : model.source === 'fixed' ? 'fixed by the step' : 'the run’s model';
  return `${name} on ${model.provider}, ${how}`;
}

function messagesText(branch: BranchView): string {
  const { sent, delivered, acknowledged, undelivered } = branch.messages;
  if (sent + delivered + acknowledged + undelivered === 0) {
    return 'no messages';
  }
  // Each count is its own journal line kind; delivered is never derived from sent.
  const parts = [`${String(sent)} sent`, `${String(delivered)} delivered to it`, `${String(acknowledged)} acknowledged`];
  if (undelivered > 0) {
    parts.push(`${String(undelivered)} not delivered`);
  }
  return parts.join(' · ');
}

/** The rows for one node, current visit first, then earlier visits, newest first. */
export function branchRows(branches: readonly BranchView[], nodeId: string): readonly BranchRow[] {
  return branches
    .filter((branch) => branch.visit.nodeId === nodeId)
    .slice()
    .sort((left, right) => right.visit.occurrence - left.visit.occurrence)
    .map((branch) => ({
      key: `${branch.visit.nodeId}#${String(branch.visit.occurrence)}/${branch.sliceId}`,
      sliceId: branch.sliceId,
      visitLabel: branch.current
        ? `visit ${String(branch.visit.occurrence)}`
        : `earlier visit (visit ${String(branch.visit.occurrence)})`,
      current: branch.current,
      task: branch.task ?? TASK_NOT_RECORDED,
      state: stateText(branch),
      role: branch.roleId === null ? 'not recorded' : `role ${branch.roleId}${branch.runsAs === null || branch.runsAs === nodeId ? '' : `, as ${branch.runsAs}`}`,
      modelClass: classWord(branch.model?.modelClass ?? null),
      model: modelText(branch),
      messages: messagesText(branch),
      address: liveOutputAddressFor(branch.visit, branch.sliceId),
    }));
}

/** The nodes that have branches in this run, in the order the journal first names them. */
export function fanOutNodesIn(branches: readonly BranchView[]): readonly string[] {
  return [...new Set(branches.map((branch) => branch.visit.nodeId))];
}

/** The live activity for one branch address, or `null` when none was observed. */
export function branchActivityFor(
  activity: readonly BranchActivityState[] | undefined,
  address: LiveOutputAddress,
): BranchActivityState | null {
  return (
    activity?.find(
      (item) =>
        item.runId === address.runId &&
        item.nodeId === address.nodeId &&
        item.occurrence === address.occurrence &&
        item.sliceId === address.sliceId,
    ) ?? null
  );
}

/**
 * A branch's live output as lines: its tool calls, then the reply as written so far.
 * Says plainly when nothing was observed, rather than showing an empty box.
 */
export function branchOutputLines(state: BranchActivityState | null): readonly string[] {
  if (state === null) {
    return ['No live output observed for this branch in this window. Output reaches a window only while it is open.'];
  }
  const lines = state.tools.map(
    (tool) => `${tool.status === null ? '…' : tool.status === 'ok' ? '✓' : '✗'} ${tool.summary}`,
  );
  if (state.awaitingApproval !== null) {
    lines.push(`Waiting: ${state.awaitingApproval}`);
  }
  lines.push(state.text === '' ? (state.finished ? 'The branch wrote no reply text here.' : 'No reply text yet.') : state.text);
  if (state.finished) {
    lines.push('— the branch has ended —');
  }
  return lines;
}

/** Where the address is, in words, for a window's title and heading. */
export function describeBranchAddress(address: LiveOutputAddress, nodeLabel: string): string {
  return `Branch “${address.sliceId ?? ''}” of “${nodeLabel}”, visit ${String(address.occurrence)}`;
}

/** The address as a window's query string, and read back. `null` when it is not one. */
export function branchAddressQuery(address: LiveOutputAddress): string {
  const params = new URLSearchParams({
    runId: address.runId,
    nodeId: address.nodeId,
    occurrence: String(address.occurrence),
    sliceId: address.sliceId ?? '',
  });
  return params.toString();
}

export function branchAddressFromQuery(search: string): LiveOutputAddress | null {
  const params = new URLSearchParams(search);
  const runId = params.get('runId');
  const nodeId = params.get('nodeId');
  const occurrence = Number(params.get('occurrence'));
  const sliceId = params.get('sliceId');
  if (runId === null || runId === '' || nodeId === null || nodeId === '' || !Number.isInteger(occurrence) || occurrence < 1 || sliceId === null || sliceId === '') {
    return null;
  }
  return { runId, nodeId, occurrence, sliceId };
}
