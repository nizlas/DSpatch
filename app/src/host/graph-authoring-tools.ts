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
 *
 * A project with no roles of its own can still be given a loop: its roles go in the same
 * proposal, as role sources, and are checked as the file will read once Apply has written it.
 * The tools say where such a role goes and how a node refers to it — in the building blocks, in
 * the tool's description and in every answer about roles — so the agent never has to read
 * DSpatch's own files or guess a path.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AppTool, AppToolResult } from '../adapter/types';
import { discoverLoopDefinitions, type LoopDefinitionRow } from '../main/loop-definition-files';
import { parseRoleSource, ROLE_SECTIONS } from '../main/role-source';
import { catalogDirFor, installedRoleCatalog, planCatalogCopies } from '../main/role-catalog-files';
import { catalogFileFor, catalogReference, latestVersion, type RoleCatalogIndex } from '../shared/role-catalog';
import { referencedRoles } from '../shared/loop-graph-editing';
import { proposedRoleResolver } from './graph-proposal-preview';
import { NODE_HELP_LABEL_MAX } from '../shared/loop-chat';
import {
  applyChoiceSection,
  applyParallelSection,
  readSectionSettings,
  SECTION_SETTINGS_HELP,
  type ChoiceSectionSettings,
  type ParallelSectionSettings,
} from '../shared/loop-graph-sections';
import {
  createProposal,
  describeChangeLines,
  isNewLoopTarget,
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
  type LoopGraph,
  type RoleResolver,
  type RunProvider,
} from '../shared/loop-graph';
import { layOutMissingViews, withSavedPositionsOnly } from '../shared/loop-graph-editing';
import { hasErrors, parseLoopGraph, type Finding } from '../shared/loop-graph-load';
import { serialiseLoopGraph } from '../shared/loop-graph-write';
import { LOOP_DEFINITION_FORMAT, LOOP_DEFINITION_FORMAT_VERSION } from '../shared/loop-definition';
import {
  DECLARES_SUBGOAL_HELP,
  FAN_OUT_HELP,
  REQUIRED_HELP,
  REQUIREMENT_HELP,
  SELECTS_MODEL_HELP,
  VISIT_CHOICES_HELP,
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

/** The smallest role source a proposal can add: the form every `role-source` reference is read in. */
const ROLE_SOURCE_EXAMPLE = [
  '---',
  'role: worker',
  'title: Worker',
  'summary: "Do the work the mandate asks for and say what was done."',
  `targets: ${LOOP_TARGETS[0]}`,
  '---',
  '',
  '## Purpose',
  '',
  'Do the work the mandate asks for.',
  '',
  '## Delivery',
  '',
  'Say what you changed and how you checked it.',
].join('\n');

/** The rules of a role source, as `parseRoleSource` holds them. */
const ROLE_SOURCE_RULES =
  '`role` is its id (lower case, digits, hyphens) and is the id a node references; `title` is required, and so is `summary`: ' +
  'one complete sentence on what the step does, which is what a person reads when hovering a node that uses the role; ' +
  `\`targets\` lists the frameworks its agent files may be exported for (${LOOP_TARGETS.join(', ')}); DSpatch's own runs read the common prose and run with the agent chosen in the chat, whatever it says; ` +
  `\`requires\` is optional (${REQUIREMENTS.join(', ')}). The prose goes under the headings ` +
  `${ROLE_SECTIONS.map((section) => `## ${section[0]?.toUpperCase() ?? ''}${section.slice(1)}`).join(', ')}, in that order, ` +
  '`## Purpose` required and nothing outside them.';

/** Where a new role of `loopId` goes, as a path from the loop's resource root. */
function rolePlace(loopsDir: string, resourceRoot: string, loopId: string, role: string): { readonly file: string; readonly reference: string } {
  const file = path.join(loopsDir, 'roles', `${loopId}-${role}.role.md`);
  return { file, reference: path.relative(resourceRoot, file).split(path.sep).join('/') };
}

/** A node's role reference, written out as the graph file wants it. */
function referenceText(role: string, referencePath: string): string {
  return JSON.stringify({ id: role, source: { kind: 'role-source', path: referencePath } });
}

/** The smallest graph that uses the role above, for a new loop "example". */
function graphExample(): string {
  return JSON.stringify(
    {
      format: 'dspatch-loop-graph',
      formatVersion: 1,
      id: 'example',
      name: 'Example workflow',
      purpose: 'What the graph is for, in a sentence or two.',
      target: LOOP_TARGETS[0],
      entry: 'work',
      onRuntimeFault: 'stop-and-reconcile',
      failureKinds: [],
      nodes: [
        { id: 'work', kind: 'agent', label: 'Do the work', role: { id: 'worker', source: { kind: 'role-source', path: '.dspatch/loops/roles/example-worker.role.md' } } },
        { id: 'done', kind: 'terminal', label: 'Done' },
      ],
      edges: [{ id: 'e-done', from: 'work', to: 'done', when: { on: 'success' } }],
    },
    null,
    2,
  );
}

/** The findings that are about a node's role, after which the agent is told how roles are referenced. */
const ROLE_FINDINGS = new Set([
  'agent-without-role',
  'role-without-source',
  'bad-role-source-kind',
  'role-does-not-resolve',
  'role-id-mismatch',
  'role-has-no-instructions',
  'role-export-form',
]);

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
        'The agent execution graphs this project and DSpatch itself declare (the tool names keep the older word "loop"): each graph id, name, where it comes from, ' +
        'its definition file and its graph file. Reads only.',
      parameters: {},
      readOnly: true,
      execute: () => {
        const found = rows();
        if (found.length === 0) {
          return Promise.resolve(ok('No graph is declared in the open folders or by DSpatch.'));
        }
        const lines = found.map(({ row, from }) =>
          row.definition === null
            ? `- (unreadable) ${row.filePath} [${from}]: ${row.findings.map((finding) => finding.message).join(' ')}`
            : `- ${row.definition.id} — ${row.definition.name} [${from}]\n  definition: ${row.filePath}\n  graph: ${row.graphPath ?? '(not resolved)'}`,
        );
        return Promise.resolve(ok(`Graphs (${String(found.length)}):\n${lines.join('\n')}`));
      },
    },
    {
      name: 'read_loop_graph',
      description:
        'The graph file of one declared graph as it is on disk now, by its id from list_loops, and what was ' +
        'changed by hand since the last proposal applied for it in this conversation. Reads only.',
      parameters: { loopId: { type: 'string', description: 'The graph id, as list_loops gives it.' } },
      readOnly: true,
      execute: (args) => {
        const loopId = typeof args['loopId'] === 'string' ? args['loopId'] : '';
        const row = loopById(loopId);
        if (row === null || row.graphPath === null) {
          return Promise.resolve(refuse(`No graph "${loopId}" with a graph file is declared. list_loops names the graphs there are.`));
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
          edits = 'No proposal for this graph has been applied in this conversation, so there is nothing to compare by hand.';
        } else {
          const manual = manualEditsSince(applied.graphText, text);
          edits = !manual.edited
            ? 'Unchanged since the last proposal applied for it in this conversation.'
            : !manual.readable
              ? 'Changed by hand since the last applied proposal, and the file no longer reads as a graph file.'
              : `Changed by hand since the last applied proposal:\n${manual.change === null ? '- (the change could not be established)' : describeChangeLines(manual.change).map((line) => `- ${line}`).join('\n')}`;
        }
        return Promise.resolve(ok(`Graph file: ${row.graphPath}\n\n${edits}\n\n${text}`));
      },
    },
    {
      name: 'describe_loop_building_blocks',
      description:
        "What an agent execution graph can contain: node kinds, the settings DSpatch honours and where it does " +
        'not, and what each agent provider supports. Reads only.',
      parameters: {},
      readOnly: true,
      execute: () => Promise.resolve(ok(buildingBlocks())),
    },
    {
      name: 'propose_loop_graph',
      description:
        'Propose an agent execution graph for the person to review and apply. Writes nothing and runs nothing: ' +
        'the proposal is kept on this conversation, and only the person can apply it. The draft is ' +
        'checked first; if it has errors they are returned and nothing is kept, so fix them and ' +
        'propose again. target is a graph id from list_loops, or "new:<id>" for a new graph in this ' +
        'project. Every agent node needs a role. Reuse a shared role from DSpatch\'s role catalog ' +
        'whenever its responsibility fits the step (describe_loop_building_blocks lists them): a node ' +
        'references one by identity and version, as {"id": "implementer", "version": 1, "source": ' +
        '{"kind": "role-catalog", "path": "<catalog>/implementer/v1.role.md"}}, where <catalog> is ' +
        '.dspatch/roles in a project, and DSpatch adds the copies to the proposal. Put what is specific ' +
        'to this graph in the node\'s purpose, not in a new role. Only a responsibility no shared role ' +
        'has gets a new role, under an id of its own, never a catalog id. A new role goes in ' +
        'roleFiles, in the same proposal, written to disk only when the person applies it: each ' +
        'entry is a whole role source (describe_loop_building_blocks shows one). A new role R of ' +
        'graph L is placed at .dspatch/loops/roles/L-R.role.md, and a node references it as ' +
        '{"id": "R", "source": {"kind": "role-source", "path": ".dspatch/loops/roles/L-R.role.md"}}; ' +
        'for a new graph the path is from the project folder.',
      parameters: {
        target: { type: 'string', description: 'A graph id from list_loops, or "new:<id>" with a lower-case id.' },
        graphText: { type: 'string', description: 'The whole graph file, in the dspatch-loop-graph format.' },
        explanation: { type: 'string', description: 'Why this graph, in your words. Shown to the person as yours.' },
        roleFiles: {
          type: 'string-list',
          description:
            'New roles: each entry is one whole role source, starting with its "---" field block; its "role" field is the id a node references.',
          optional: true,
        },
      },
      readOnly: false,
      execute: (args) => Promise.resolve(propose(host, rows, args)),
    },
    {
      name: 'propose_graph_section',
      description:
        'Add or change a reusable section of a graph from its settings, and propose the result for the person to review and apply, ' +
        'exactly as propose_loop_graph does: it writes nothing and runs nothing. section "choice" is a choice made per task, such as the ' +
        'model class the work needs or its review route; section "parallel" splits independent parts into parallel branches and ' +
        'integrates them, beside the sequential path. The same settings are what the graph editor shows. The section is applied to the ' +
        "latest open proposal for that graph in this conversation, so a new graph proposed a moment ago can be given sections before it " +
        'is applied, else to the graph on disk. DSpatch writes the deciding and proposing steps\' instructions from these settings, so ' +
        'put no CHOICE or slice format in a purpose or role. ' +
        `Choice settings: ${SECTION_SETTINGS_HELP.choice} Parallel settings: ${SECTION_SETTINGS_HELP.parallel}`,
      parameters: {
        target: { type: 'string', description: 'A graph id from list_loops, or "new:<id>" for a new graph proposed earlier in this conversation.' },
        section: { type: 'string', description: '"choice" or "parallel".' },
        settings: { type: 'string', description: "The section's settings, as one JSON object." },
        explanation: { type: 'string', description: 'Why this section, and what it changes for a run, in your words. Shown to the person as yours.' },
      },
      readOnly: false,
      execute: (args) => Promise.resolve(proposeSection(host, rows, args)),
    },
  ];
}

/**
 * DSP-227: a section applied to the graph the agent is working on — the latest open proposal for
 * the target in this conversation, else the file on disk — and proposed through {@link propose},
 * with the roles that proposal adds, so the person reviews one whole graph as always.
 */
function proposeSection(
  host: GraphAuthoringHost,
  rows: () => readonly { readonly row: LoopDefinitionRow }[],
  args: Readonly<Record<string, unknown>>,
): AppToolResult {
  const targetArg = typeof args['target'] === 'string' ? args['target'].trim() : '';
  const section = args['section'];
  const explanation = typeof args['explanation'] === 'string' ? args['explanation'].trim() : '';
  const conversationId = host.conversationId();
  if (section !== 'choice' && section !== 'parallel') {
    return refuse('section is "choice" or "parallel". Nothing was proposed.');
  }
  if (conversationId === null) {
    return refuse('There is no saved conversation for this turn to keep a proposal on, so nothing was proposed.');
  }
  let settingsValue: unknown;
  try {
    settingsValue = JSON.parse(typeof args['settings'] === 'string' ? args['settings'] : '');
  } catch (error) {
    return refuse(`settings is not JSON: ${error instanceof Error ? error.message : String(error)}. Nothing was proposed.`);
  }
  const newId = targetArg.startsWith('new:') ? targetArg.slice(4).trim() : null;
  const row = newId === null ? (rows().find((entry) => entry.row.definition?.id === targetArg)?.row ?? null) : null;
  const open = [...host.proposals(conversationId)].reverse().find((proposal) => {
    if (proposal.status !== 'proposed') {
      return false;
    }
    const graphPath = targetGraphPath(proposal.target);
    return newId !== null
      ? isNewLoopTarget(proposal.target) && path.basename(graphPath) === `${newId}.graph.json`
      : row?.graphPath !== null && row?.graphPath !== undefined && samePath(graphPath, row.graphPath);
  });
  const baseText = open?.graphText ?? (row?.graphPath === null || row?.graphPath === undefined ? null : readText(row.graphPath));
  if (baseText === null) {
    return refuse(
      newId !== null
        ? `There is no open proposal for the new graph "${newId}" in this conversation. Propose the graph first with propose_loop_graph. Nothing was proposed.`
        : `No graph "${targetArg}" with a readable graph file is declared; list_loops names them. Nothing was proposed.`,
    );
  }
  const base = parseLoopGraph(baseText);
  if (!base.ok) {
    return refuse(`The graph to add the section to does not read as a graph:\n${describeFindings(base.findings)}\nNothing was proposed.`);
  }
  const read = readSectionSettings(base.graph, section, settingsValue);
  if (!read.ok) {
    return refuse(`${read.problem} Nothing was proposed.`);
  }
  const applied =
    section === 'choice'
      ? applyChoiceSection(base.graph, read.settings as ChoiceSectionSettings)
      : applyParallelSection(base.graph, read.settings as ParallelSectionSettings);
  const blocking = applied.problems.filter((problem) => !/^No step decides/.test(problem));
  if (blocking.length > 0 || applied.graph === base.graph) {
    return refuse(`The section could not be applied, so nothing was proposed:\n${(blocking.length > 0 ? blocking : applied.problems).map((problem) => `- ${problem}`).join('\n')}`);
  }
  const result = propose(host, rows, {
    target: targetArg,
    graphText: serialiseLoopGraph(applied.graph, { newline: '\n' }),
    explanation,
    roleFiles: (open?.roleFiles ?? []).map((file) => file.text),
  });
  const notes = applied.problems.filter((problem) => !blocking.includes(problem));
  return notes.length === 0 || result.isError ? result : ok(`${result.text}\n\nNote: ${notes.join(' ')}`);
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
      return refuse(`"${loopId}" is not a usable graph id: use lower-case letters, digits and hyphens. Nothing was proposed.`);
    }
    if (project === undefined) {
      return refuse('No project folder is open, so a new graph has nowhere to go. Nothing was proposed.');
    }
    loopsDir = path.join(project, '.dspatch', 'loops');
    const definitionPath = path.join(loopsDir, `${loopId}.loop.json`);
    const graphPath = path.join(loopsDir, `${loopId}.graph.json`);
    if (fs.existsSync(definitionPath) || fs.existsSync(graphPath) || rows().some((entry) => entry.row.definition?.id === loopId)) {
      return refuse(`A graph "${loopId}" exists already. Propose a change to it by its id instead. Nothing was proposed.`);
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
      return refuse(`No graph "${targetArg}" is declared; list_loops names them, and "new:<id>" proposes a new one. Nothing was proposed.`);
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

  // New roles: role sources, created beside the loop, never over an existing file.
  const roleFiles: ProposedRoleFile[] = [];
  const added: { readonly role: string; readonly reference: string }[] = [];
  for (const [index, entry] of roleArgs.entries()) {
    const text = `${entry.trim()}\n`;
    const parsedRole = parseRoleSource(text);
    if (!parsedRole.ok) {
      const problems = parsedRole.problems.map((problem) => `- ${problem.line === undefined ? '' : `line ${String(problem.line)}: `}${problem.message}`);
      return refuse(
        `roleFiles entry ${String(index + 1)} is not a role source, so nothing was proposed:\n${problems.join('\n')}\n\n` +
          `A role source looks like this. ${ROLE_SOURCE_RULES}\n\n${ROLE_SOURCE_EXAMPLE}`,
      );
    }
    const role = parsedRole.source.id;
    if (!SLUG.test(role)) {
      return refuse(`roleFiles entry ${String(index + 1)} has role "${role}"; use lower-case letters, digits and hyphens. Nothing was proposed.`);
    }
    if (added.some((each) => each.role === role)) {
      return refuse(`Two roleFiles entries are both role "${role}". Nothing was proposed.`);
    }
    // DSP-231: a shared identity always means the shared definition.
    if (installedRoleCatalog()?.roles.some((shared) => shared.id === role) === true) {
      return refuse(
        `roleFiles entry ${String(index + 1)} has role "${role}", which is a shared role of DSpatch's catalog. Reference the shared role ` +
          `(${JSON.stringify(catalogReference(role, latestVersion(installedRoleCatalog() as RoleCatalogIndex, role) ?? 1, catalogDirFor(resourceRoot)))}) and put what this graph needs in the node's purpose, ` +
          'or give a role with a different responsibility an id of its own. Nothing was proposed.',
      );
    }
    const place = rolePlace(loopsDir, resourceRoot, loopId, role);
    if (fs.existsSync(place.file)) {
      return refuse(
        `${place.file} exists already, and a proposal only ever adds role files. Reference it as ${referenceText(role, place.reference)} instead. Nothing was proposed.`,
      );
    }
    roleFiles.push({ path: place.file, text });
    added.push({ role, reference: place.reference });
  }
  // DSP-231: the shared catalog roles the draft references and the project does not have yet are
  // copied into it with the proposal, create-only and checked against the catalog's digest.
  const draftForCopies = parseLoopGraph(graphArg);
  if (draftForCopies.ok) {
    const wanted = referencedRoles(draftForCopies.graph).filter(
      (reference) => reference.source.kind === 'role-catalog' && reference.version !== undefined && !fs.existsSync(path.resolve(resourceRoot, reference.source.path)),
    );
    const catalogDir = path.resolve(resourceRoot, catalogDirFor(resourceRoot));
    const misplaced = wanted.filter((reference) => path.resolve(resourceRoot, reference.source.path) !== path.join(catalogDir, catalogFileFor(reference.id, reference.version as number)));
    if (misplaced.length > 0) {
      return refuse(
        `These shared roles are referenced at a path DSpatch does not copy them to: ${misplaced.map((reference) => reference.source.path).join(', ')}. ` +
          `Reference them as ${misplaced.map((reference) => JSON.stringify(catalogReference(reference.id, reference.version as number, catalogDirFor(resourceRoot)))).join(', ')}. Nothing was proposed.`,
      );
    }
    const copies = planCatalogCopies(catalogDir, wanted.map((reference) => ({ id: reference.id, version: reference.version as number })));
    if (copies.problems.length > 0) return refuse(`${copies.problems.join(' ')} Nothing was proposed.`);
    for (const file of copies.files) {
      // A proposal only adds files: an existing index is left as it is, and the copies are checked against the installed catalog.
      if (fs.existsSync(file.path)) continue;
      roleFiles.push({ path: file.path, text: file.text });
    }
  }
  // How roles are referenced here, said with every answer about a node's role.
  const roleHelp = (): string =>
    [
      added.length === 0
        ? `This draft adds no role. A role the project does not have goes in roleFiles as a role source (describe_loop_building_blocks shows one); ` +
          `role R is placed at ${rolePlace(loopsDir, resourceRoot, loopId, 'R').reference}, and a node references it by that path.`
        : `The roles this draft adds, as a node references them:\n${added.map((each) => `- ${referenceText(each.role, each.reference)}`).join('\n')}`,
      `A role path is read from ${resourceRoot}; a role outside it, such as one of DSpatch's own, cannot be used here.`,
    ].join('\n');

  // Positions are DSpatch's (Niclas, 14 November 2026): a node the loop already has keeps the
  // place saved on disk, and every other node is placed by the layered layout, with room for the
  // labels. Positions the agent wrote are not kept, or a proposal would bypass the layout.
  let graphText = graphArg;
  const parsed = parseLoopGraph(graphArg);
  if (parsed.ok) {
    const base = baseText === null ? null : parseLoopGraph(baseText);
    const placed = layOutMissingViews(withSavedPositionsOnly(parsed.graph, base?.ok === true ? base.graph : null));
    const views = (graph: LoopGraph): string => JSON.stringify(graph.nodes.map((node) => node.view ?? null));
    if (views(placed.graph) !== views(parsed.graph)) {
      graphText = serialiseLoopGraph(placed.graph, { newline: '\n' });
    }
  }

  // The loader's own check, with the proposed role files read as they will be once written,
  // by the same resolver the editor's preview of this proposal uses.
  const resolveRole: RoleResolver = proposedRoleResolver(resourceRoot, roleFiles);
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
    const errors = proposal.findings.filter((finding) => finding.severity === 'error');
    return refuse(
      [
        `The draft has errors, so it was not kept. Fix them and propose again:\n${describeFindings(errors)}`,
        ...(errors.some((finding) => ROLE_FINDINGS.has(finding.code)) ? [roleHelp()] : []),
      ].join('\n\n'),
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
      ...(roleFiles.length === 0
        ? []
        : [`New role files, written only when the person applies the proposal: ${roleFiles.map((file) => file.path).join(', ')}`]),
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
    ['choices, decides, edge sets and whenChosen, model chosenBy', VISIT_CHOICES_HELP],
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
  // DSP-231: the shared roles a graph should reuse before writing one of its own.
  const catalog = installedRoleCatalog();
  const shared =
    catalog === null
      ? ['DSpatch\'s role catalog could not be read here.']
      : catalog.roles.map((role) => `- ${role.id} v${String(latestVersion(catalog, role.id) ?? 1)} — ${role.title}: ${role.summary}`);
  return [
    'Shared roles (DSpatch\'s role catalog). Reuse one whenever its responsibility fits; a node references it by identity and version, ' +
      '{"id": "<id>", "version": <n>, "source": {"kind": "role-catalog", "path": ".dspatch/roles/<id>/v<n>.role.md"}} in a project, and ' +
      'DSpatch copies the shared text into the project with the proposal. What only this graph needs goes in the node\'s purpose; the ' +
      'project\'s own rules go in its project instructions. The same identity and version always mean the same text, so a role with another ' +
      'responsibility needs an id of its own:\n' +
      shared.join('\n'),
    'Terms. DSpatch orchestrates agents through agent execution graphs: nodes are steps with their work and responsibilities, and connections decide how execution proceeds. ' +
      'A step\'s declared outcome or failure picks the next connection, so a run can take different paths, return to earlier steps or split into parallel branches and join them. ' +
      'A loop is a recurring path through the graph; a graph may hold several loops or none. The path is chosen during a run; the graph\'s structure is not changed by a run, which keeps the version it started with. ' +
      'Call the whole thing a graph or a workflow when you explain it to the person, and a loop only for a recurring path.',
    'The graph format is dspatch-loop-graph. One provider runs a whole run. read_loop_graph shows any listed graph whole, as a fuller example. ' +
      'The smallest graph, for a new graph "example" (propose it with target "new:example"), and the role source it uses, passed in roleFiles:',
    `\`\`\`json\n${graphExample()}\n\`\`\``,
    `\`\`\`markdown\n${ROLE_SOURCE_EXAMPLE}\n\`\`\``,
    `Roles. Every agent node references one role, as {"id", "source": {"kind": "role-source", "path"}}. The path is read from the graph's resource root, ` +
      'which for a new graph is the project folder; a role outside it cannot be used. A role the project does not have goes in the proposal\'s roleFiles: ' +
      `role R of graph L is placed at .dspatch/loops/roles/L-R.role.md, and nothing is written until the person applies the proposal. A role source: ${ROLE_SOURCE_RULES}`,
    'What a person reads. Hovering a node shows its purpose when that is one line of at most ' +
      `${String(NODE_HELP_LABEL_MAX)} characters, otherwise its role's summary, never a purpose cut short. So put a step's whole instruction in its ` +
      "purpose, and give each role a summary that says in one sentence what its step does; an ending's purpose can say in a sentence or two how the run ended. " +
      "Leave out each node's view: DSpatch places the nodes, with room for every edge's label. A node the graph already has keeps the place the person " +
      'saved; positions written in a proposal are not used.',
    `Node kinds:\n${kinds.join('\n')}`,
    `Settings on a node or edge:\n${settings.join('\n')}`,
    `What DSpatch honours, attribute by attribute:\n${attributes.join('\n')}`,
    'Reusable sections. propose_graph_section adds or changes a choice made per task (such as the model class the work needs, or its review route) ' +
      'or a parallel section (split independent parts into branches, integrate them, keep the sequential path) from settings, the same settings ' +
      "the graph editor shows. DSpatch writes the instructions for deciding a choice and for writing the slices from the graph's settings. " +
      `Choice: ${SECTION_SETTINGS_HELP.choice}\nParallel: ${SECTION_SETTINGS_HELP.parallel}`,
    `Requirements, by agent provider ("unmet" means that provider cannot hold it; "other-means" means it is an instruction, not a restriction):\n${providers.join('\n')}`,
  ].join('\n\n');
}
