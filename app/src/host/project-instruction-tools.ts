/**
 * DSP-230: the chat agent's tools for a project graph's instructions — read the current draft,
 * and propose changes to it.
 *
 * Offered on chat sessions beside the graph tools, never to a loop step. Neither writes a file:
 * a proposal is kept with the draft, the person reviews it in the chat or the graph editor and
 * applies it to the draft or rejects it, and only Save writes the file. Each change names its
 * level, the steps it reaches, a reason and its sources, and records the level as it was, so a
 * proposal made before a newer manual edit is never applied over it.
 */
import type { AppTool, AppToolResult } from '../adapter/types';
import type { ProjectDraftStore } from '../main/project-drafts';
import { discussionContext, readProposedChanges, levelName, type ProjectInstructionProposal } from '../shared/project-draft';

export interface ProjectInstructionToolsHost {
  readonly drafts: ProjectDraftStore;
  /** The project graph with this definition id, as a definition key, or `null`. */
  readonly definitionKeyFor: (loopId: string) => string | null;
  readonly conversationId: () => string | null;
  readonly turnRunId: () => string | null;
  readonly newId?: () => string;
  readonly now?: () => Date;
  readonly recorded?: (proposal: ProjectInstructionProposal) => void;
}

function ok(text: string): AppToolResult {
  return { text, isError: false };
}

function refuse(text: string): AppToolResult {
  return { text, isError: true };
}

const LEVEL_HELP =
  'level is "common" (every agent step), "role:<role id>" (every step using that role) or "node:<step id>" (one step).';

export function projectInstructionTools(host: ProjectInstructionToolsHost): readonly AppTool[] {
  const viewFor = (graphArg: unknown): { readonly key: string } | { readonly problem: string } => {
    const loopId = typeof graphArg === 'string' ? graphArg.trim() : '';
    const key = host.definitionKeyFor(loopId);
    return key === null
      ? { problem: `"${loopId}" is not a project graph with project instructions in the open repositories. list_loops names the graphs; a built-in one gets project instructions through Apply to repository… in the graph editor.` }
      : { key };
  };
  return [
    {
      name: 'read_project_instructions',
      description:
        "A project graph's project instructions as the person's current editing draft, including changes not saved yet: common, per role and per " +
        'step, each with its text and document references, which steps each level reaches, and what is unsaved. Documents are named, not included. Reads only.',
      parameters: {
        graph: { type: 'string', description: 'The graph id, as list_loops gives it.' },
        step: { type: 'string', description: 'A step id to focus on, optional.', optional: true },
      },
      readOnly: true,
      execute: (args) => {
        const found = viewFor(args['graph']);
        if ('problem' in found) return Promise.resolve(refuse(found.problem));
        const answer = host.drafts.view(found.key);
        if (!answer.ok) return Promise.resolve(refuse(answer.problem));
        const step = typeof args['step'] === 'string' && args['step'].trim() !== '' ? { nodeId: args['step'].trim() } : null;
        const open = answer.view.proposals.filter((proposal) => proposal.status === 'proposed');
        return Promise.resolve(
          ok(
            [
              discussionContext(answer.view, step),
              open.length === 0
                ? 'No proposal of yours is waiting for the person.'
                : `Proposals waiting for the person: ${open.map((proposal) => `${proposal.id} (${proposal.changes.map((change) => change.level).join(', ')})`).join('; ')}.`,
            ].join('\n\n'),
          ),
        );
      },
    },
    {
      name: 'propose_project_instructions',
      description:
        "Propose changes to a project graph's project instructions for the person to review. Writes nothing and saves nothing: the proposal is kept " +
        'beside the draft, and the person applies it to the draft or rejects it, then saves the draft separately. changes is a JSON list; each entry ' +
        `changes one level: {"level", "text"?, "documents"?, "remove"?, "reason", "sources"?}. ${LEVEL_HELP} text is the whole new text of that level ` +
        'and documents its whole new list of {path, purpose, when}, paths relative to the repository root; what you leave out is kept; "remove": true empties ' +
        'the level. Put a rule at the narrowest level it holds for, and say in reason why it belongs there. sources lists {path, note} for where the ' +
        'instruction comes from — a governing document, an earlier agent definition, an old guideline — and the note says whether it is current or may be ' +
        'outdated. Read the draft first with read_project_instructions: a proposal is made against the draft as it is now, and a level the person edits ' +
        'afterwards is not overwritten by it.',
      parameters: {
        graph: { type: 'string', description: 'The graph id, as list_loops gives it.' },
        changes: { type: 'string', description: 'A JSON list of changes, one per level, as described.' },
        explanation: { type: 'string', description: 'What the proposal does as a whole, in your words. Shown to the person as yours.' },
      },
      readOnly: false,
      execute: (args) => {
        const conversationId = host.conversationId();
        if (conversationId === null) return Promise.resolve(refuse('There is no saved conversation for this turn to keep a proposal on, so nothing was proposed.'));
        const found = viewFor(args['graph']);
        if ('problem' in found) return Promise.resolve(refuse(`${found.problem} Nothing was proposed.`));
        const explanation = typeof args['explanation'] === 'string' ? args['explanation'].trim() : '';
        if (explanation === '') return Promise.resolve(refuse('A proposal needs an explanation. Nothing was proposed.'));
        const answer = host.drafts.view(found.key);
        if (!answer.ok) return Promise.resolve(refuse(`${answer.problem} Nothing was proposed.`));
        const { view } = answer;
        const read = readProposedChanges(typeof args['changes'] === 'string' ? args['changes'] : '', view.outline, view.draft);
        if (!read.ok) return Promise.resolve(refuse(`${read.problem} ${LEVEL_HELP} Nothing was proposed.`));
        const proposal: ProjectInstructionProposal = {
          id: host.newId?.() ?? `instructions-${(host.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
          conversationId,
          turnRunId: host.turnRunId(),
          definitionKey: view.definitionKey,
          graphName: view.graphName,
          createdAtUtc: (host.now?.() ?? new Date()).toISOString(),
          explanation,
          draftRevision: view.revision,
          changes: read.changes,
          status: 'proposed',
        };
        const kept = host.drafts.record(proposal);
        if (!kept.ok) return Promise.resolve(refuse(`${kept.problem} Nothing was proposed.`));
        host.recorded?.(proposal);
        return Promise.resolve(
          ok(
            [
              `Proposed (${proposal.id}) for the project instructions of "${view.graphName}". Nothing was written or saved: the person reviews it and applies it to the draft or rejects it.`,
              ...read.changes.map(
                (change) =>
                  `- ${change.action} ${levelName(view.outline, change.level)} [${change.level}], reaching ${String(change.steps.length)} step${change.steps.length === 1 ? '' : 's'}`,
              ),
            ].join('\n'),
          ),
        );
      },
    },
  ];
}
