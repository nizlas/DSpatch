/**
 * DSP-209 S23a: the chat agent's graph tools — list, read, describe, propose (requirement R1).
 *
 * Offered on chat sessions only, beside the workspace tools; a loop step is never offered
 * them. They follow CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md §5–§7:
 *
 * - **Construction is never execution.** No tool here writes a graph, a definition or a role
 *   file, and none starts or changes a run. `propose_loop_graph` makes S17's
 *   {@link GraphEditProposal} and keeps it on the conversation with status `proposed`; the
 *   person applies it later (S23b), through the same save path as the editor.
 * - **Validation is the loader's.** A draft is checked with `loadLoopGraph`, and its findings
 *   go back to the agent word for word. A draft with errors is **not stored**: the agent is
 *   told what to fix and proposes again, so an invalid draft never supersedes a valid one.
 * - **The disk is the base.** An existing loop's proposal is made against the graph text on
 *   disk now, by its content hash; `read_loop_graph` reports what changed by hand since the
 *   last proposal applied for that loop, so a manual edit becomes part of the conversation.
 * - **What is offered is said plainly**, including what a provider does not support (§7).
 *
 * The tools read only what the chat agent can already read: the open folders and DSpatch's own
 * loops. A new loop's place is decision 50's: `<first folder>/.dspatch/loops/<id>.loop.json`
 * and `<id>.graph.json`, with new roles at `.dspatch/loops/roles/<id>-<role>.role.md`.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AppTool, AppToolResult } from '../adapter/types';
import { discoverLoopDefinitions, type LoopDefinitionRow } from '../main/loop-definition-files';
import { createFileRoleResolver } from '../main/loop-graph-roles';
import {
  createProposal,
  describeChangeLines,
  manualEditsSince,
  targetGraphPath,
  type GraphEditProposal,
  type ProposalTarget,
  type ProposedRoleFile,
} from '../shared/graph-proposal';
import {
  ATTRIBUTE_SUPPORT,
  LOOP_TARGETS,
  NODE_KINDS,
  REQUIREMENTS,
  RUN_PROVIDER_CAPABILITIES,
  type RoleResolver,
  type RunProvider,
} from '../shared/loop-graph';
import { layOutMissingViews } from '../shared/loop-graph-editing';
import { hasErrors, parseLoopGraph, type Finding } from '../shared/loop-graph-load';
import { serialiseLoopGraph } from '../shared/loop-graph-write';
import { LOOP_DEFINITION_FORMAT, LOOP_DEFINITION_FORMAT_VERSION } from '../shared/loop-definition';
import {
  DECLARES_SUBGOAL_HELP,
  FAN_OUT_HELP,
  REQUIRED_HELP,
  REQUIREMENT_HELP,
  SELECTS_MODEL_HELP,
  SKIPS_HELP,
  SUGGEST_INTERACTIVE_HELP,
  kindEffect,
} from '../shared/loop-node-help';

/** What the tools reach. The host passes its own functions; a test passes its own. */
export interface GraphAuthoringHost {
  /** The open workspace's folders, the project first. */
  readonly folders: () => readonly string[];
  /** DSpatch's own repository or bundled folder, whose loops are listed as DSpatch's. */
  readonly ownRoot: () => string | null;
  /** The conversation of the turn that is working, or `null`. */
  readonly conversationId: () => string | null;
  /** Every proposal in that conversation, oldest first. */
  readonly proposals: (conversationId: string) => readonly GraphEditProposal[];
  /** Keep a valid proposal on the conversation; earlier open ones for its graph are superseded. */
  readonly record: (proposal: GraphEditProposal) => { readonly ok: true } | { readonly ok: false; readonly problem: string };
  /** A new proposal id. Defaults to time and randomness. */
  readonly newId?: () => string;
}

/** The ids a new loop and its roles may take: lower case, digits and hyphens. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

function ok(text: string): AppToolResult {
  return { text, isError: false };
}

function refuse(text: string): AppToolResult {
  return { text, isError: true };
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function describeFindings(findings: readonly Finding[]): string {
  return findings.map((finding) => `- ${finding.severity} ${finding.code} at ${finding.pointer || '/'}: ${finding.message}`).join('\n');
}

export function graphAuthoringTools(host: GraphAuthoringHost): readonly AppTool[] {
  const rows = (): readonly { readonly row: LoopDefinitionRow; readonly from: 'project' | 'DSpatch' }[] => {
    const own = host.ownRoot();
    const folders = host.folders();
    const ownResolved = own === null ? null : path.resolve(own);
    const list = folders.filter((folder) => ownResolved === null || path.resolve(folder) !== ownResolved);
    const projectRows = discoverLoopDefinitions(list).rows.map((row) => ({ row, from: 'project' as const }));
    const ownRows = ownResolved === null ? [] : discoverLoopDefinitions([ownResolved]).rows.map((row) => ({ row, from: 'DSpatch' as const }));
    return [...projectRows, ...ownRows];
  };
  const loopById = (loopId: string): LoopDefinitionRow | null =>
    rows().find((entry) => entry.row.definition?.id === loopId)?.row ?? null;

  return [
    {
      name: 'list_loops',
      description:
        'The loops this project and DSpatch itself declare: each loop id, name, where it comes from, ' +
        'its definition file and its graph file. Reads only.',
      parameters: {},
      readOnly: true,
      execute: () => {
        const found = rows();
        if (found.length === 0) {
          return Promise.resolve(ok('No loop is declared in the open folders or by DSpatch.'));
        }
        const lines = found.map(({ row, from }) =>
          row.definition === null
            ? `- (unreadable) ${row.filePath} [${from}]: ${row.findings.map((finding) => finding.message).join(' ')}`
            : `- ${row.definition.id} — ${row.definition.name} [${from}]\n  definition: ${row.filePath}\n  graph: ${row.graphPath ?? '(not resolved)'}`,
        );
        return Promise.resolve(ok(`Loops (${String(found.length)}):\n${lines.join('\n')}`));
      },
    },
    {
      name: 'read_loop_graph',
      description:
        'The graph file of one loop as it is on disk now, by loop id from list_loops, and what was ' +
        'changed by hand since the last proposal applied for it in this conversation. Reads only.',
      parameters: { loopId: { type: 'string', description: 'The loop id, as list_loops gives it.' } },
      readOnly: true,
      execute: (args) => {
        const loopId = typeof args['loopId'] === 'string' ? args['loopId'] : '';
        const row = loopById(loopId);
        if (row === null || row.graphPath === null) {
          return Promise.resolve(refuse(`No loop "${loopId}" with a graph file is declared. list_loops names the loops there are.`));
        }
        const text = readText(row.graphPath);
        if (text === null) {
          return Promise.resolve(refuse(`The graph file ${row.graphPath} could not be read.`));
        }
        const conversationId = host.conversationId();
        const applied =
          conversationId === null
            ? undefined
            : [...host.proposals(conversationId)]
                .reverse()
                .find((proposal) => proposal.status === 'applied' && samePath(targetGraphPath(proposal.target), row.graphPath ?? ''));
        let edits: string;
        if (applied === undefined) {
          edits = 'No proposal for this loop has been applied in this conversation, so there is nothing to compare by hand.';
        } else {
          const manual = manualEditsSince(applied.graphText, text);
          edits = !manual.edited
            ? 'Unchanged since the last proposal applied for it in this conversation.'
            : !manual.readable
              ? 'Changed by hand since the last applied proposal, and the file no longer reads as a loop graph.'
              : `Changed by hand since the last applied proposal:\n${manual.change === null ? '- (the change could not be established)' : describeChangeLines(manual.change).map((line) => `- ${line}`).join('\n')}`;
        }
        return Promise.resolve(ok(`Graph file: ${row.graphPath}\n\n${edits}\n\n${text}`));
      },
    },
    {
      name: 'describe_loop_building_blocks',
      description:
        "What a loop graph can contain: node kinds, the settings DSpatch honours and where it does " +
        'not, and what each agent provider supports. Reads only.',
      parameters: {},
      readOnly: true,
      execute: () => Promise.resolve(ok(buildingBlocks())),
    },
    {
      name: 'propose_loop_graph',
      description:
        'Propose a loop graph for the person to review and apply. Writes nothing and runs nothing: ' +
        'the proposal is kept on this conversation, and only the person can apply it. The draft is ' +
        'checked first; if it has errors they are returned and nothing is kept, so fix them and ' +
        'propose again. target is a loop id from list_loops, or "new:<id>" for a new loop in this ' +
        'project. Each roleFiles entry is a new role: its name on the first line, then the role text.',
      parameters: {
        target: { type: 'string', description: 'A loop id from list_loops, or "new:<id>" with a lower-case id.' },
        graphText: { type: 'string', description: 'The whole graph file, in the dspatch-loop-graph format.' },
        explanation: { type: 'string', description: 'Why this graph, in your words. Shown to the person as yours.' },
        roleFiles: {
          type: 'string-list',
          description: 'New roles: each entry is the role name (lower case, hyphens) on the first line, then its text.',
          optional: true,
        },
      },
      readOnly: false,
      execute: (args) => Promise.resolve(propose(host, rows, args)),
    },
  ];
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function propose(
  host: GraphAuthoringHost,
  rows: () => readonly { readonly row: LoopDefinitionRow }[],
  args: Readonly<Record<string, unknown>>,
): AppToolResult {
  const targetArg = typeof args['target'] === 'string' ? args['target'].trim() : '';
  const graphArg = typeof args['graphText'] === 'string' ? args['graphText'] : '';
  const explanation = typeof args['explanation'] === 'string' ? args['explanation'].trim() : '';
  const roleArgs = Array.isArray(args['roleFiles']) ? args['roleFiles'].filter((entry): entry is string => typeof entry === 'string') : [];
  const conversationId = host.conversationId();
  if (conversationId === null) {
    return refuse('There is no saved conversation for this turn to keep a proposal on, so nothing was proposed.');
  }
  if (graphArg.trim() === '' || explanation === '') {
    return refuse('A proposal needs the whole graph text and an explanation. Nothing was proposed.');
  }

  // Where it goes, and what it is made against.
  let target: ProposalTarget;
  let baseText: string | null;
  let resourceRoot: string;
  let loopId: string;
  let loopsDir: string;
  if (targetArg.startsWith('new:')) {
    loopId = targetArg.slice(4).trim();
    const project = host.folders()[0];
    if (!SLUG.test(loopId)) {
      return refuse(`"${loopId}" is not a usable loop id: use lower-case letters, digits and hyphens. Nothing was proposed.`);
    }
    if (project === undefined) {
      return refuse('No project folder is open, so a new loop has nowhere to go. Nothing was proposed.');
    }
    loopsDir = path.join(project, '.dspatch', 'loops');
    const definitionPath = path.join(loopsDir, `${loopId}.loop.json`);
    const graphPath = path.join(loopsDir, `${loopId}.graph.json`);
    if (fs.existsSync(definitionPath) || fs.existsSync(graphPath) || rows().some((entry) => entry.row.definition?.id === loopId)) {
      return refuse(`A loop "${loopId}" exists already. Propose a change to it by its id instead. Nothing was proposed.`);
    }
    const name = (() => {
      const parsed = parseLoopGraph(graphArg);
      return parsed.ok ? parsed.graph.name : loopId;
    })();
    const definitionText = `${JSON.stringify(
      {
        format: LOOP_DEFINITION_FORMAT,
        formatVersion: LOOP_DEFINITION_FORMAT_VERSION,
        id: loopId,
        name,
        resourceRoot: '../..',
        graph: `.dspatch/loops/${loopId}.graph.json`,
      },
      null,
      2,
    )}\n`;
    target = { newLoop: { definitionPath, graphPath, definitionText } };
    baseText = null;
    resourceRoot = project;
  } else {
    const row = rows().find((entry) => entry.row.definition?.id === targetArg)?.row ?? null;
    if (row === null || row.graphPath === null || row.resourceRoot === null || row.definition === null) {
      return refuse(`No loop "${targetArg}" is declared; list_loops names them, and "new:<id>" proposes a new one. Nothing was proposed.`);
    }
    const disk = readText(row.graphPath);
    if (disk === null) {
      return refuse(`The graph file ${row.graphPath} could not be read, so there is no base to propose against. Nothing was proposed.`);
    }
    loopId = row.definition.id;
    loopsDir = path.dirname(row.filePath);
    target = { definitionPath: row.filePath, graphPath: row.graphPath };
    baseText = disk;
    resourceRoot = row.resourceRoot;
  }

  // New roles: created beside the loop, never over an existing file.
  const roleFiles: ProposedRoleFile[] = [];
  for (const entry of roleArgs) {
    const [first, ...rest] = entry.split(/\r?\n/);
    const role = (first ?? '').trim();
    if (!SLUG.test(role) || rest.join('\n').trim() === '') {
      return refuse(`A roleFiles entry needs a lower-case role name on its first line and the role text below it ("${role}"). Nothing was proposed.`);
    }
    const file = path.join(loopsDir, 'roles', `${loopId}-${role}.role.md`);
    if (fs.existsSync(file)) {
      return refuse(`${file} exists already, and a proposal only ever adds role files. Reference it instead. Nothing was proposed.`);
    }
    roleFiles.push({ path: file, text: `${rest.join('\n').trim()}\n` });
  }

  // Nodes without a position are placed by the layered layout (S18b), so the drawing is readable.
  let graphText = graphArg;
  const parsed = parseLoopGraph(graphArg);
  if (parsed.ok) {
    const laidOut = layOutMissingViews(parsed.graph);
    if (laidOut.placed.length > 0) {
      graphText = serialiseLoopGraph(laidOut.graph, { newline: '\n' });
    }
  }

  // The loader's own check, with the proposed role files resolvable as if they existed.
  const onDisk = createFileRoleResolver(resourceRoot);
  const pending = new Map(roleFiles.map((file) => [path.resolve(file.path).toLowerCase(), file]));
  const resolveRole: RoleResolver = (reference) => {
    const proposedFile = pending.get(path.resolve(resourceRoot, reference.source.path).toLowerCase());
    if (proposedFile === undefined) {
      return onDisk(reference);
    }
    return {
      id: reference.id,
      sourcePath: reference.source.path,
      targets: [...LOOP_TARGETS],
      targetsDeclared: false,
      requirements: [],
      requirementsDeclared: false,
      instructions: proposedFile.text,
    };
  };
  const proposal = createProposal(
    {
      id: host.newId?.() ?? `proposal-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      target,
      baseText,
      graphText,
      roleFiles,
      explanation,
    },
    { resolveRole },
  );
  if (hasErrors(proposal.findings)) {
    return refuse(
      `The draft has errors, so it was not kept. Fix them and propose again:\n${describeFindings(proposal.findings.filter((finding) => finding.severity === 'error'))}`,
    );
  }
  const kept = host.record(proposal);
  if (!kept.ok) {
    return refuse(`${kept.problem} Nothing was proposed.`);
  }
  const notes = proposal.findings.filter((finding) => finding.severity !== 'error');
  return ok(
    [
      `Proposed (${proposal.id}) for ${targetGraphPath(proposal.target)}. Nothing has been written and nothing runs: the person reviews the proposal and applies it.`,
      proposal.change === null ? 'The change could not be described.' : `The change:\n${describeChangeLines(proposal.change).map((line) => `- ${line}`).join('\n')}`,
      ...(roleFiles.length === 0 ? [] : [`New role files: ${roleFiles.map((file) => file.path).join(', ')}`]),
      ...(notes.length === 0 ? [] : [`Warnings and notices:\n${describeFindings(notes)}`]),
    ].join('\n\n'),
  );
}

/** The building blocks, from the panel's own texts and the support table, never a second wording. */
function buildingBlocks(): string {
  const kinds = NODE_KINDS.map((kind) => `- ${kind}: ${kindEffect(kind).whatTheRunnerDoes}`);
  const settings = [
    ['fanOut', FAN_OUT_HELP],
    ['capabilities: ["suggest-interactive"]', SUGGEST_INTERACTIVE_HELP],
    ['declares: ["subgoal"]', DECLARES_SUBGOAL_HELP],
    ['required', REQUIRED_HELP],
    ['edge skips', SKIPS_HELP],
    ['edge selectsModel', SELECTS_MODEL_HELP],
  ].map(([field, help]) => {
    const setting = help as { readonly name: string; readonly detail: string };
    return `- ${String(field)} (${setting.name}): ${setting.detail}`;
  });
  const attributes = ATTRIBUTE_SUPPORT.map(
    (entry) => `- ${entry.attribute}: ${entry.honoured ? 'honoured' : 'NOT honoured'} — ${entry.by}${entry.caveat === undefined ? '' : ` Not everywhere: ${entry.caveat}`}`,
  );
  const providers = (Object.keys(RUN_PROVIDER_CAPABILITIES) as RunProvider[]).map((provider) => {
    const answers = REQUIREMENTS.map((requirement) => {
      const answer = RUN_PROVIDER_CAPABILITIES[provider][requirement];
      return `  - ${requirement} (${REQUIREMENT_HELP[requirement].name}): ${answer.status} — ${answer.how}`;
    });
    return `- ${provider}:\n${answers.join('\n')}`;
  });
  return [
    'The graph format is dspatch-loop-graph; DSpatch documents it in docs/loop/GRAPH_FORMAT.md. One provider runs a whole run.',
    `Node kinds:\n${kinds.join('\n')}`,
    `Settings on a node or edge:\n${settings.join('\n')}`,
    `What DSpatch honours, attribute by attribute:\n${attributes.join('\n')}`,
    `Requirements, by agent provider ("unmet" means that provider cannot hold it; "other-means" means it is an instruction, not a restriction):\n${providers.join('\n')}`,
  ].join('\n\n');
}
