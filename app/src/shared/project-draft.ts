/**
 * DSP-230: one editing draft of a project graph's instructions, kept apart from the saved file
 * and from the chat agent's proposals, and the pure rules all three are handled by.
 *
 * Three things are never confused:
 *
 * - **Saved** is the `<id>.project.json` on disk, which is what the next run reads.
 * - **The draft** is what the graph editor's right panel and the customization window edit. Both
 *   edit the same draft, held by the host, level by level; nothing in it is on disk until Save.
 * - **A proposal** is the chat agent's suggested change to the draft, not applied until the
 *   person applies it, and applying it changes the draft only. Each change records the level's
 *   content it was made against, so a proposal made before a newer manual edit is stale and is
 *   not applied over it.
 *
 * A level is one section of the instructions: `common`, `role:<id>` or `node:<id>` — the same
 * keys DSP-229's recommendations use. Pure: no file system.
 */
import {
  EMPTY_SECTION,
  projectInstructionsText,
  sectionIsEmpty,
  type DocumentReference,
  type InstructionSection,
  type ProjectInstructions,
} from './project-instructions';
import type { GraphOutline } from './project-recommendations';

/** `common`, `role:<id>` or `node:<id>`. */
export type LevelKey = string;

export type Level = { readonly kind: 'common' } | { readonly kind: 'role'; readonly id: string } | { readonly kind: 'node'; readonly id: string };

export function levelKey(level: Level): LevelKey {
  return level.kind === 'common' ? 'common' : `${level.kind}:${level.id}`;
}

export function parseLevelKey(key: LevelKey): Level | null {
  if (key === 'common') return { kind: 'common' };
  const match = /^(role|node):(.+)$/.exec(key);
  if (match === null) return null;
  return { kind: match[1] as 'role' | 'node', id: match[2] ?? '' };
}

export function sectionAt(value: ProjectInstructions, key: LevelKey): InstructionSection {
  const level = parseLevelKey(key);
  if (level === null) return EMPTY_SECTION;
  if (level.kind === 'common') return value.common;
  return (level.kind === 'role' ? value.roles[level.id] : value.nodes[level.id]) ?? EMPTY_SECTION;
}

export function withSection(value: ProjectInstructions, key: LevelKey, section: InstructionSection): ProjectInstructions {
  const level = parseLevelKey(key);
  if (level === null) return value;
  if (level.kind === 'common') return { ...value, common: section };
  const field = level.kind === 'role' ? 'roles' : 'nodes';
  const rest = Object.fromEntries(Object.entries(value[field]).filter(([id]) => id !== level.id));
  return { ...value, [field]: sectionIsEmpty(section) ? rest : { ...rest, [level.id]: section } };
}

function sameDocument(left: DocumentReference, right: DocumentReference): boolean {
  return left.path === right.path && left.purpose === right.purpose && left.when === right.when && (left.external === true) === (right.external === true);
}

/** Equal as a step would receive them: an empty section and a missing one are the same. */
export function sameSection(left: InstructionSection | undefined, right: InstructionSection | undefined): boolean {
  const a = left ?? EMPTY_SECTION;
  const b = right ?? EMPTY_SECTION;
  return a.text === b.text && a.documents.length === b.documents.length && a.documents.every((doc, index) => sameDocument(doc, b.documents[index] as DocumentReference));
}

/** Every level either value has, common first. */
export function levelKeysOf(...values: readonly ProjectInstructions[]): readonly LevelKey[] {
  const keys = new Set<LevelKey>(['common']);
  for (const value of values) {
    for (const id of Object.keys(value.roles)) keys.add(`role:${id}`);
    for (const id of Object.keys(value.nodes)) keys.add(`node:${id}`);
  }
  return [...keys];
}

/** The levels where two versions differ. */
export function changedLevels(before: ProjectInstructions, after: ProjectInstructions): readonly LevelKey[] {
  return levelKeysOf(before, after).filter((key) => !sameSection(sectionAt(before, key), sectionAt(after, key)));
}

/** The agent steps a level reaches: every step, the steps using a role, or one step. */
export function stepsAt(outline: GraphOutline, key: LevelKey): readonly GraphOutline['nodes'][number][] {
  const level = parseLevelKey(key);
  if (level === null) return [];
  if (level.kind === 'common') return outline.nodes;
  if (level.kind === 'role') return outline.nodes.filter((node) => node.roleId === level.id);
  return outline.nodes.filter((node) => node.id === level.id);
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** DSP-231: the three scopes of project additions, as the person reads them. */
export const SCOPE_NAMES = {
  common: 'All agent nodes',
  role: 'All nodes with this role',
  node: 'This node instance only',
} as const;

/** A role as a person reads it: its title, with its identity and version where they say more. */
export function roleLabel(outline: GraphOutline, id: string): string {
  const role = outline.roles.find((candidate) => candidate.id === id);
  if (role === undefined) return id;
  const identity = role.version === undefined ? (role.title === id ? '' : id) : `${id} v${String(role.version)}`;
  return identity === '' ? role.title : `${role.title} (${identity})`;
}

/** What a level is, for a heading: "All agent nodes", "All nodes with this role · Reviewer (work-reviewer v1)", "This node instance only · Review". */
export function levelName(outline: GraphOutline, key: LevelKey): string {
  const level = parseLevelKey(key);
  if (level === null) return key;
  if (level.kind === 'common') return SCOPE_NAMES.common;
  if (level.kind === 'role') return `${SCOPE_NAMES.role} · ${roleLabel(outline, level.id)}`;
  return `${SCOPE_NAMES.node} · ${outline.nodes.find((node) => node.id === level.id)?.label ?? level.id}`;
}

/** Who an edit at a level reaches, said before it is made: "Reaches all 4 nodes using Reviewer". */
export function scopeLine(outline: GraphOutline, key: LevelKey): string {
  const level = parseLevelKey(key);
  const steps = stepsAt(outline, key);
  if (level === null) return '';
  if (level.kind === 'common') return `Reaches all ${plural(steps.length, 'agent node', 'agent nodes')} of this graph`;
  if (level.kind === 'role') {
    const title = roleLabel(outline, level.id);
    if (steps.length === 0) return `Reaches no node: no node of this graph uses ${title} any more`;
    return steps.length === 1 ? `Reaches the 1 node using ${title}, by its identity ${level.id}` : `Reaches all ${String(steps.length)} nodes using ${title}, by its identity ${level.id}`;
  }
  return 'Reaches only this node, on every visit to it, and the branches that run as it';
}

// ---------------------------------------------------------------------------------------------
// The draft as the windows see it.

/** Whether the saved file still is what the draft was based on. */
export type DiskState = 'same' | 'changed' | 'missing';

export interface ProjectDraftView {
  readonly definitionKey: string;
  readonly graphName: string;
  readonly repository: string;
  /** The instructions file, relative to the repository. */
  readonly instructionsFile: string;
  readonly outline: GraphOutline;
  /** As saved on disk when the draft was last based on it. */
  readonly saved: ProjectInstructions;
  readonly savedSha256: string | null;
  readonly draft: ProjectInstructions;
  /** Counts every change to the draft; a proposal records the one it was made against. */
  readonly revision: number;
  /** The levels where the draft differs from saved. */
  readonly unsaved: readonly LevelKey[];
  /** The file on disk now, against what the draft is based on. */
  readonly disk: DiskState;
  readonly proposals: readonly ProjectInstructionProposal[];
  readonly problems: readonly string[];
  readonly updatedAtUtc: string;
}

/** One line on where the draft stands, for the status bar of every place that edits it. */
export function draftStatusLine(view: Pick<ProjectDraftView, 'unsaved' | 'disk' | 'proposals'>): string {
  const open = view.proposals.filter((proposal) => proposal.status === 'proposed').length;
  const parts = [
    view.unsaved.length === 0
      ? 'Saved — the next run uses what is on screen'
      : `Unsaved changes in ${plural(view.unsaved.length, 'level', 'levels')} — the next run uses the saved version until you save`,
  ];
  if (view.disk === 'changed') parts.push('the file changed on disk since it was read');
  if (open > 0) parts.push(`${plural(open, 'proposal', 'proposals')} from the chat not applied`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Proposals from the chat.

export type ProposalStatus = 'proposed' | 'applied' | 'rejected' | 'stale';

export interface ProposalSource {
  /** A repository path, an earlier agent definition, a document; as the agent named it. */
  readonly path: string;
  /** What it says, or why it counts; may say that it is old or doubtful. */
  readonly note: string;
}

export interface ProposalChange {
  readonly level: LevelKey;
  readonly action: 'add' | 'change' | 'remove';
  /** The level as it was in the draft when the proposal was made. */
  readonly before: InstructionSection;
  readonly after: InstructionSection;
  /** The agent steps it reaches, by id. */
  readonly steps: readonly string[];
  readonly reason: string;
  readonly sources: readonly ProposalSource[];
}

export interface ProjectInstructionProposal {
  readonly id: string;
  readonly conversationId: string;
  /** The chat turn that made it, so the chat draws it there. */
  readonly turnRunId: string | null;
  readonly definitionKey: string;
  readonly graphName: string;
  readonly createdAtUtc: string;
  readonly explanation: string;
  /** The draft revision it was made against. */
  readonly draftRevision: number;
  readonly changes: readonly ProposalChange[];
  readonly status: ProposalStatus;
  /** Why it is stale, or what applying did. */
  readonly note?: string;
}

/** The changes whose level changed in the draft since the proposal was made. */
export function staleChanges(draft: ProjectInstructions, proposal: Pick<ProjectInstructionProposal, 'changes'>): readonly ProposalChange[] {
  return proposal.changes.filter((change) => !sameSection(sectionAt(draft, change.level), change.before));
}

/**
 * Apply a proposal to the draft, all of it or nothing: a change whose level the person has edited
 * since is not written over, and the levels concerned are named.
 */
export function applyProposal(
  draft: ProjectInstructions,
  proposal: Pick<ProjectInstructionProposal, 'changes'>,
): { readonly ok: true; readonly draft: ProjectInstructions } | { readonly ok: false; readonly stale: readonly LevelKey[] } {
  const stale = staleChanges(draft, proposal);
  if (stale.length > 0) return { ok: false, stale: stale.map((change) => change.level) };
  return { ok: true, draft: proposal.changes.reduce((value, change) => withSection(value, change.level, change.after), draft) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the agent's changes, as the `propose_project_instructions` tool takes them: a JSON list of
 * `{level, text?, documents?, remove?, reason, sources?}`. `text` and `documents` replace the
 * level's own; what is left out is kept. Every level must exist in the graph.
 */
export function readProposedChanges(
  json: string,
  outline: GraphOutline,
  draft: ProjectInstructions,
): { readonly ok: true; readonly changes: readonly ProposalChange[] } | { readonly ok: false; readonly problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { ok: false, problem: `changes is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, problem: 'changes must be a non-empty JSON list.' };
  const changes: ProposalChange[] = [];
  const seen = new Set<LevelKey>();
  const roles = new Set(outline.roles.map((role) => role.id));
  const nodes = new Set(outline.nodes.map((node) => node.id));
  for (const [index, entry] of raw.entries()) {
    const where = `changes[${String(index)}]`;
    if (!isRecord(entry)) return { ok: false, problem: `${where} must be an object.` };
    const key = typeof entry['level'] === 'string' ? entry['level'].trim() : '';
    const level = parseLevelKey(key);
    if (level === null) return { ok: false, problem: `${where}.level must be "common", "role:<role id>" or "node:<step id>".` };
    if (level.kind === 'role' && !roles.has(level.id)) return { ok: false, problem: `${where}: the graph has no role "${level.id}". Its roles: ${[...roles].join(', ')}.` };
    if (level.kind === 'node' && !nodes.has(level.id)) return { ok: false, problem: `${where}: the graph has no agent step "${level.id}". Its steps: ${[...nodes].join(', ')}.` };
    if (seen.has(key)) return { ok: false, problem: `${where}: level ${key} appears twice; give one change per level.` };
    seen.add(key);
    const reason = typeof entry['reason'] === 'string' ? entry['reason'].trim() : '';
    if (reason === '') return { ok: false, problem: `${where} needs a reason.` };
    const before = sectionAt(draft, key);
    let after: InstructionSection;
    if (entry['remove'] === true) {
      after = EMPTY_SECTION;
    } else {
      const text = entry['text'] === undefined ? before.text : typeof entry['text'] === 'string' ? entry['text'] : null;
      if (text === null) return { ok: false, problem: `${where}.text must be a string: the whole new text of the level.` };
      let documents: DocumentReference[] = [...before.documents];
      if (entry['documents'] !== undefined) {
        if (!Array.isArray(entry['documents'])) return { ok: false, problem: `${where}.documents must be a list of {path, purpose, when}.` };
        documents = [];
        for (const [docIndex, doc] of entry['documents'].entries()) {
          if (!isRecord(doc) || typeof doc['path'] !== 'string' || doc['path'].trim() === '') {
            return { ok: false, problem: `${where}.documents[${String(docIndex)}] needs a "path".` };
          }
          documents.push({
            path: doc['path'].trim().replace(/\\/g, '/'),
            purpose: typeof doc['purpose'] === 'string' ? doc['purpose'] : '',
            when: typeof doc['when'] === 'string' ? doc['when'] : '',
          });
        }
      }
      after = { text, documents };
    }
    if (sameSection(before, after)) return { ok: false, problem: `${where} changes nothing at ${key}.` };
    const sources: ProposalSource[] = [];
    if (entry['sources'] !== undefined && !Array.isArray(entry['sources'])) return { ok: false, problem: `${where}.sources must be a list of {path, note}.` };
    for (const source of Array.isArray(entry['sources']) ? entry['sources'] : []) {
      if (isRecord(source) && typeof source['path'] === 'string' && source['path'].trim() !== '') {
        sources.push({ path: source['path'].trim(), note: typeof source['note'] === 'string' ? source['note'] : '' });
      }
    }
    changes.push({
      level: key,
      action: sectionIsEmpty(before) ? 'add' : sectionIsEmpty(after) ? 'remove' : 'change',
      before,
      after,
      steps: stepsAt(outline, key).map((node) => node.id),
      reason,
      sources,
    });
  }
  return { ok: true, changes };
}

// ---------------------------------------------------------------------------------------------
// What the chat is told.

function sectionLines(section: InstructionSection): readonly string[] {
  if (sectionIsEmpty(section)) return ['  (nothing)'];
  return [
    ...(section.text.trim() === '' ? [] : section.text.trim().split('\n').map((line) => `  ${line}`)),
    ...section.documents.map((doc) => `  - document ${doc.path}${doc.external === true ? ' (outside the repository)' : ''}: ${doc.purpose || 'no purpose given'}${doc.when === '' ? '' : `; read ${doc.when}`}`),
  ];
}

/**
 * The project instructions as the main chat is given them when the person discusses them: which
 * graph and repository, the focused step and role if any, the draft level by level with what is
 * not saved, and how to propose a change. Documents are named, never included.
 */
export function discussionContext(view: ProjectDraftView, focus: { readonly nodeId: string } | null): string {
  const { outline } = view;
  const node = focus === null ? null : (outline.nodes.find((candidate) => candidate.id === focus.nodeId) ?? null);
  const unsaved = new Set(view.unsaved);
  const levelBlock = (key: LevelKey): string[] => [
    `${levelName(outline, key)} [${key}] — ${scopeLine(outline, key)}${unsaved.has(key) ? ' — UNSAVED in the draft' : ''}:`,
    ...sectionLines(sectionAt(view.draft, key)),
  ];
  const lines: string[] = [
    '===== project instructions under discussion =====',
    `The person wants to discuss the project instructions of the graph "${view.graphName}" in the repository ${view.repository} ` +
      `(file ${view.instructionsFile}). The text below is the current editing draft, including changes not saved yet; ` +
      'the next run uses the saved version until the person saves.',
    node === null
      ? 'No single step is in focus: the discussion is about the graph as a whole.'
      : `In focus: the step "${node.label}" [node:${node.id}]${node.roleId === null ? '' : `, which uses the role ${node.roleId} [role:${node.roleId}]`}.`,
    'Levels: common reaches every agent step; a role level reaches every step using that role; a node level reaches one step.',
    '',
    ...levelBlock('common'),
  ];
  const roleKeys = node?.roleId === null || node === null ? outline.roles.map((role) => `role:${role.id}`) : [`role:${node.roleId}`];
  for (const key of roleKeys) lines.push('', ...levelBlock(key));
  const nodeKeys = node === null ? outline.nodes.filter((each) => !sectionIsEmpty(view.draft.nodes[each.id])).map((each) => `node:${each.id}`) : [`node:${node.id}`];
  for (const key of nodeKeys) lines.push('', ...levelBlock(key));
  lines.push(
    '',
    `Steps: ${outline.nodes.map((each) => `${each.label} [node:${each.id}${each.roleId === null ? '' : `, role ${each.roleId}`}]`).join('; ')}.`,
    'Documents are named, not included: open one yourself only when the discussion needs it. read_project_instructions shows the draft again; ' +
      'propose_project_instructions proposes changes for the person to review. A proposal changes only the draft, and only when the person applies it; ' +
      'nothing is saved to disk by it. Instructions found in an older way of working (earlier agent definitions, old guidelines) are not current ' +
      'just because they exist: name where each came from in the change\'s sources and say when it may be outdated.',
    '===== end of project instructions under discussion =====',
  );
  return lines.join('\n');
}

/** The chip the chat shows while the context waits to be sent: "Project instructions · Graph · step X". */
export function discussionLabel(graphName: string, node: { readonly label: string } | null): string {
  return `Project instructions of ${graphName}${node === null ? '' : ` · step ${node.label}`}`;
}

/** What one step would receive from a version of the instructions: the runtime's own text. */
export function previewForStep(
  value: ProjectInstructions,
  outline: GraphOutline,
  nodeId: string,
  where: { readonly file: string; readonly repositoryRoot: string },
): string {
  const node = outline.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) return '';
  return projectInstructionsText(value, { nodeId: node.id, nodeLabel: node.label, roleId: node.roleId }, where);
}
