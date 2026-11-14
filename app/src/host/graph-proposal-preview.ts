/**
 * DSP-209 S23b: a graph proposal read as the loop it would make, before anything is written.
 *
 * Two readers need one answer. `propose_loop_graph` checks a draft with its new role files
 * resolvable as if they existed, and the editor's preview draws a stored proposal the same
 * way, so a role that passed when it was proposed is not broken when it is looked at. The
 * proposal's own role files come first; every other reference is read from the loop's
 * resource root on disk, exactly as an applied loop's are.
 *
 * It reads and writes nothing of the project's beyond what a role reference names, and it
 * chooses no loop and starts nothing.
 */

import fs from 'node:fs';
import path from 'node:path';

import { resourceRootFor } from '../main/loop-definition-files';
import { referencedRoles, resolvedRolesWith } from '../main/loop-graph-open';
import { createFileRoleResolver, resolveRoleText } from '../main/loop-graph-roles';
import type { LoopGraphOpenOutcome } from '../shared/bridge';
import { isNewLoopTarget, targetDefinitionPath, targetGraphPath, type GraphEditProposal, type ProposedRoleFile } from '../shared/graph-proposal';
import { parseLoopDefinition } from '../shared/loop-definition';
import type { RoleReference, RoleResolver } from '../shared/loop-graph';
import { detectNewline } from '../shared/loop-graph-write';

/** Roles from `resourceRoot`, with the proposal's own new role files read from their text. */
export function proposedRoleResolver(resourceRoot: string, roleFiles: readonly ProposedRoleFile[]): RoleResolver {
  const onDisk = createFileRoleResolver(resourceRoot);
  const pending = new Map(roleFiles.map((file) => [path.resolve(file.path).toLowerCase(), file]));
  return (reference: RoleReference) => {
    const requested = path.resolve(resourceRoot, reference.source.path);
    const proposedFile = pending.get(requested.toLowerCase());
    return proposedFile === undefined ? onDisk(reference) : resolveRoleText(proposedFile.text, reference, requested);
  };
}

/** Where the proposal's loop reads its roles from: its definition's resource root. */
export function proposalResourceRoot(proposal: Pick<GraphEditProposal, 'target'>): string | null {
  const definitionPath = targetDefinitionPath(proposal.target);
  let text: string;
  if (isNewLoopTarget(proposal.target)) {
    text = proposal.target.newLoop.definitionText;
  } else {
    try {
      text = fs.readFileSync(definitionPath, 'utf8');
    } catch {
      return null;
    }
  }
  const parsed = parseLoopDefinition(text);
  return parsed.ok ? resourceRootFor(definitionPath, parsed.definition) : null;
}

/** The editor's preview of a stored proposal: its graph text, its roles, and that it is not applied. */
export function openedFromProposal(proposal: GraphEditProposal | null): LoopGraphOpenOutcome {
  if (proposal === null) {
    return { kind: 'unavailable', note: 'That proposal is not in this conversation any more, so there is nothing to preview.' };
  }
  const resourceRoot = proposalResourceRoot(proposal);
  if (resourceRoot === null) {
    return { kind: 'unavailable', note: `The loop definition ${targetDefinitionPath(proposal.target)} could not be read, so its roles cannot be found.` };
  }
  const graphPath = targetGraphPath(proposal.target);
  return {
    kind: 'read',
    path: graphPath,
    displayPath: path.relative(resourceRoot, graphPath) || graphPath,
    text: proposal.graphText,
    newline: detectNewline(proposal.graphText),
    projectRoot: resourceRoot,
    roles: resolvedRolesWith(referencedRoles(proposal.graphText), proposedRoleResolver(resourceRoot, proposal.roleFiles)),
    preview: { conversationId: proposal.conversationId, proposalId: proposal.id, status: proposal.status, roleFiles: proposal.roleFiles.length },
  };
}
