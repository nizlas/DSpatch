/**
 * DSP-209 S23b: what `loop.saveGraph` checks before it writes, and how a proposal is applied.
 *
 * Two callers reach the same handler. An **editor save** may name the content hash of the
 * file it was loaded from (`expectedContentHash`); when the disk no longer holds that, nothing
 * is written, so a stale editor cannot quietly overwrite a change applied from the chat. An
 * editor save without the field writes exactly as before, for older windows.
 *
 * A **proposal action** names a proposal kept on the conversation. The host takes the files to
 * write from the stored proposal, never from the window, and refuses — writing nothing — when
 * a target lies outside the open project folders (decision 52: DSpatch's own loops are not the
 * project's to rewrite unless DSpatch is the project), when a run of that graph is active, or
 * when S17's `applyProposal` finds the disk moved on since the proposal was made (`conflict`).
 * A new loop's definition and role files are written only if absent. Nothing here starts a run.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { LoopGraphSaveOutcome, LoopGraphSaveRequest } from '../shared/bridge';
import {
  applyProposal,
  discardProposal,
  graphContentHash,
  isNewLoopTarget,
  targetDefinitionPath,
  targetGraphPath,
  type GraphEditProposal,
} from '../shared/graph-proposal';
import { parseLoopGraph } from '../shared/loop-graph-load';

/** What a save is checked against. */
export interface GraphSaveContext {
  /** The open workspace's folders; a proposal writes only inside them. */
  readonly projectFolders: readonly string[];
  /** The graph id of a run that is active now, or `null` when none is. */
  readonly activeRunGraphId: string | null;
  /** The stored proposal a request names, or `null` when the conversation holds no such one. */
  readonly proposal: (conversationId: string, proposalId: string) => GraphEditProposal | null;
  /** Keep a proposal's new status on its conversation. */
  readonly keep: (proposal: GraphEditProposal) => void;
  readonly log?: (message: string) => void;
  readonly now?: () => string;
}

/** The file system the checks use; the default is Node's, a test may pass its own. */
export interface GraphSaveFiles {
  readonly read: (file: string) => string | null;
  readonly write: (file: string, text: string) => void;
}

export const nodeGraphSaveFiles: GraphSaveFiles = {
  read: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
  write: (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  },
};

/** The sentence the card shows when the disk moved on since the proposal was made. */
export const PROPOSAL_CONFLICT_NOTE =
  'Not applied: the graph was changed in the editor since this proposal was made. Ask the chat to revise it from the current version.';

function inside(folder: string, file: string): boolean {
  const relative = path.relative(path.resolve(folder), path.resolve(file));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function graphIdOf(text: string | null): string | null {
  if (text === null) {
    return null;
  }
  const parsed = parseLoopGraph(text);
  return parsed.ok ? parsed.graph.id : null;
}

/** `loop.saveGraph`, with S23b's checks. */
export function saveGraphChecked(
  request: LoopGraphSaveRequest,
  context: GraphSaveContext,
  files: GraphSaveFiles = nodeGraphSaveFiles,
): LoopGraphSaveOutcome {
  if (request.proposal !== undefined) {
    return actOnProposal(request.proposal, context, files);
  }
  const resolved = path.resolve(request.path);
  if (request.expectedContentHash !== undefined) {
    const disk = files.read(resolved);
    const now = disk === null ? null : graphContentHash(disk);
    if (now !== request.expectedContentHash) {
      return {
        kind: 'refused',
        reason: 'stale-base',
        note:
          `Not saved: ${resolved} changed on disk since this editor loaded it — perhaps a proposal was applied ` +
          'from the chat. Reload to take the file as it is now; your unsaved changes are not written.',
      };
    }
  }
  try {
    files.write(resolved, request.text);
  } catch (error) {
    return { kind: 'failed', note: `${request.path} could not be written: ${String(error)}` };
  }
  context.log?.(`loop graph written: ${resolved} (${String(Buffer.byteLength(request.text))} bytes)`);
  return { kind: 'written', path: resolved, bytes: Buffer.byteLength(request.text), atUtc: context.now?.() ?? new Date().toISOString() };
}

function actOnProposal(
  asked: NonNullable<LoopGraphSaveRequest['proposal']>,
  context: GraphSaveContext,
  files: GraphSaveFiles,
): LoopGraphSaveOutcome {
  const proposal = context.proposal(asked.conversationId, asked.proposalId);
  if (proposal === null) {
    return { kind: 'refused', reason: 'not-open', note: 'That proposal is not in this conversation, so nothing was written.' };
  }
  if (asked.action === 'discard') {
    const discarded = discardProposal(proposal);
    if (discarded !== proposal) {
      context.keep(discarded);
    }
    return { kind: 'refused', reason: 'discarded', note: 'Discarded. Nothing was written.', status: discarded.status };
  }
  if (proposal.status !== 'proposed') {
    return { kind: 'refused', reason: 'not-open', note: `This proposal is ${proposal.status}, so it cannot be applied.`, status: proposal.status };
  }
  const graphPath = path.resolve(targetGraphPath(proposal.target));
  const targets = [
    graphPath,
    ...(isNewLoopTarget(proposal.target) ? [path.resolve(targetDefinitionPath(proposal.target))] : []),
    ...proposal.roleFiles.map((file) => path.resolve(file.path)),
  ];
  const outside = targets.filter((file) => !context.projectFolders.some((folder) => inside(folder, file)));
  if (outside.length > 0) {
    return {
      kind: 'refused',
      reason: 'outside-project',
      note: `Not applied: ${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} outside the open project folders, and a proposal writes only inside them. Nothing was written.`,
      status: proposal.status,
    };
  }
  const activeId = context.activeRunGraphId;
  if (activeId !== null && (graphIdOf(files.read(graphPath)) === activeId || graphIdOf(proposal.graphText) === activeId)) {
    return {
      kind: 'refused',
      reason: 'run-active',
      note: 'Not applied: a run of this graph is active, and it keeps the version it started with. Apply once it has ended. Nothing was written.',
      status: proposal.status,
    };
  }
  const roles: Record<string, string | null> = {};
  for (const file of proposal.roleFiles) {
    roles[file.path] = files.read(path.resolve(file.path));
  }
  const decided = applyProposal(proposal, {
    graph: files.read(graphPath),
    ...(isNewLoopTarget(proposal.target) ? { definition: files.read(path.resolve(targetDefinitionPath(proposal.target))) } : {}),
    roles,
  });
  if (decided.outcome === 'conflict') {
    context.keep(decided.proposal);
    return { kind: 'refused', reason: 'conflict', note: `${PROPOSAL_CONFLICT_NOTE} (${decided.reasons.join(' ')})`, status: 'conflict' };
  }
  if (decided.outcome === 'refused') {
    return { kind: 'refused', reason: 'not-open', note: decided.reasons.join(' '), status: proposal.status };
  }
  try {
    // Definition and role files first: a graph is never left pointing at roles that are not there.
    for (const role of decided.write.roleFiles) {
      files.write(path.resolve(role.path), role.text);
    }
    if (decided.write.definition !== undefined) {
      files.write(path.resolve(decided.write.definition.path), decided.write.definition.text);
    }
    files.write(graphPath, decided.write.graphText);
  } catch (error) {
    return { kind: 'failed', note: `The proposal could not be written: ${String(error)}` };
  }
  context.keep(decided.proposal);
  context.log?.(`proposal ${proposal.id} applied: ${targets.join(', ')}; no run was started`);
  return {
    kind: 'written',
    path: graphPath,
    bytes: Buffer.byteLength(decided.write.graphText),
    atUtc: context.now?.() ?? new Date().toISOString(),
    status: 'applied',
  };
}
