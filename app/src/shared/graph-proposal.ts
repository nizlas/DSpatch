/**
 * Graph-edit proposals: a change to a loop graph that a conversation suggests, held apart
 * from the graph file until someone applies it (DSP-209 S17, requirement R1).
 *
 * The design rules are CONTROLLED_PARALLELISM_AND_DIALOGUE_BASED_GRAPH_DESIGN.md §5:
 *
 * - **Changes are visible before they replace anything.** A proposal carries the exact
 *   change it would make ({@link describeGraphChange}) and the validation findings of the
 *   text it would write, both computed when it is made.
 * - **Construction is never execution.** Nothing here starts a run, and applying a
 *   proposal only returns what to write ({@link ProposalWrite}). Writing it is the
 *   caller's work, through the same save path the editor uses.
 * - **Manual edits are kept.** A proposal records the hash of the text it was made
 *   against; if the file on disk is no longer that text, applying it is a `conflict` and
 *   nothing is written. {@link reconcileDisk} and {@link manualEditsSince} let the editor
 *   and the next turn of the conversation see what changed by hand.
 * - **There is no second source of truth.** A proposal holds the whole graph text it
 *   would write, in the existing format; the change and findings are derived from that
 *   text and from the existing validation in `loop-graph-load.ts`, never a parallel model.
 *
 * Pure: no Node built-ins, no filesystem, no React. The window, the main process and the
 * tests all import it.
 */

import type { GraphProposalsUpdate, GraphToEdit, StoredMessage } from './bridge';
import { replaceNode } from './loop-graph-editing';
import { hasErrors, loadLoopGraph, parseLoopGraph } from './loop-graph-load';
import type { CheckOptions, Finding } from './loop-graph-load';
import type { LoopEdge, LoopGraph, LoopNode } from './loop-graph';

// ---------------------------------------------------------------------------------------
// The proposal

export const PROPOSAL_STATUSES = ['proposed', 'applied', 'discarded', 'superseded', 'conflict'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** A change to a loop that already has a definition and a graph file. */
export interface ExistingLoopTarget {
  readonly definitionPath: string;
  readonly graphPath: string;
}

/** A loop that does not exist yet: its definition file and graph file are both new. */
export interface NewLoopTarget {
  readonly newLoop: {
    readonly definitionPath: string;
    readonly graphPath: string;
    /** The `.loop.json` text to write beside the graph. */
    readonly definitionText: string;
  };
}

export type ProposalTarget = ExistingLoopTarget | NewLoopTarget;

export function isNewLoopTarget(target: ProposalTarget): target is NewLoopTarget {
  return 'newLoop' in target;
}

/** The graph file a target writes, whichever kind it is. */
export function targetGraphPath(target: ProposalTarget): string {
  return isNewLoopTarget(target) ? target.newLoop.graphPath : target.graphPath;
}

/** The definition file a target belongs to, whichever kind it is. */
export function targetDefinitionPath(target: ProposalTarget): string {
  return isNewLoopTarget(target) ? target.newLoop.definitionPath : target.definitionPath;
}

/**
 * What a proposal card's **Open in editor** asks the editor for: the loop, by its definition,
 * never the graph file alone. A graph opened alone has no project behind it, so its roles are
 * read from DSpatch's own copy and a project's own roles do not resolve; the Loop chooser does
 * not name it either.
 */
export function editorOpenFor(proposal: Pick<GraphEditProposal, 'target'>): GraphToEdit {
  return { path: targetDefinitionPath(proposal.target), as: 'loop' };
}

/** A role file a proposal adds. Role files are only ever created, never overwritten. */
export interface ProposedRoleFile {
  readonly path: string;
  readonly text: string;
}

/**
 * Why the agent proposes this, in the agent's own words. Labelled as such so no view can
 * present it as DSpatch's account or as a verified description of the change: the
 * verified description is {@link GraphEditProposal.change}.
 */
export interface AgentWords {
  readonly source: 'agent';
  readonly text: string;
}

/** The label a view shows on {@link AgentWords}. */
export const AGENT_WORDS_LABEL = "The agent's words";

export interface GraphEditProposal {
  readonly id: string;
  readonly conversationId: string;
  readonly target: ProposalTarget;
  /**
   * {@link graphContentHash} of the graph text the proposal was made against, or `null`
   * for a new loop, whose graph file must not exist when the proposal is applied.
   */
  readonly baseContentHash: string | null;
  /** The whole graph file the proposal would write, in the existing format. */
  readonly graphText: string;
  readonly roleFiles: readonly ProposedRoleFile[];
  readonly explanation: AgentWords;
  /** `loadLoopGraph`'s findings for {@link graphText}, unchanged. */
  readonly findings: readonly Finding[];
  /**
   * What applying it would change, against the base. `null` when either text cannot be
   * read as a loop graph, so no change can be established; the findings say why.
   */
  readonly change: GraphChange | null;
  readonly status: ProposalStatus;
}

export interface ProposalInput {
  readonly id: string;
  readonly conversationId: string;
  readonly target: ProposalTarget;
  /** The graph text the proposal is made against. Required for an existing loop, `null` for a new one. */
  readonly baseText: string | null;
  readonly graphText: string;
  readonly roleFiles?: readonly ProposedRoleFile[];
  /** The agent's explanation, stored as {@link AgentWords}. */
  readonly explanation: string;
}

/**
 * Make a proposal: validate its text with the existing loader and describe its change.
 * Nothing is written and nothing is run.
 */
export function createProposal(input: ProposalInput, options: CheckOptions = {}): GraphEditProposal {
  const newLoop = isNewLoopTarget(input.target);
  if (newLoop && input.baseText !== null) {
    throw new Error('A proposal for a new loop has no base text.');
  }
  if (!newLoop && input.baseText === null) {
    throw new Error('A proposal for an existing loop needs the graph text it was made against.');
  }
  const loaded = loadLoopGraph(input.graphText, options);
  const after = parseLoopGraph(input.graphText);
  let change: GraphChange | null = null;
  if (after.ok) {
    if (input.baseText === null) {
      change = describeGraphChange(null, after.graph);
    } else {
      const before = parseLoopGraph(input.baseText);
      change = before.ok ? describeGraphChange(before.graph, after.graph) : null;
    }
  }
  return {
    id: input.id,
    conversationId: input.conversationId,
    target: input.target,
    baseContentHash: input.baseText === null ? null : graphContentHash(input.baseText),
    graphText: input.graphText,
    roleFiles: input.roleFiles ?? [],
    explanation: { source: 'agent', text: input.explanation },
    findings: loaded.findings,
    change,
    status: 'proposed',
  };
}

/** What the files a proposal touches hold on disk now. `null` means the file does not exist. */
export interface DiskState {
  readonly graph: string | null;
  /** Needed for a new loop only. */
  readonly definition?: string | null;
  /** Current text of each proposed role file's path. A path left out is unknown, which is a conflict. */
  readonly roles?: Readonly<Record<string, string | null>>;
}

/** What to write for an applied proposal. The caller writes it; nothing here touches a file. */
export interface ProposalWrite {
  readonly graphPath: string;
  readonly graphText: string;
  /** Set for a new loop only. */
  readonly definition?: { readonly path: string; readonly text: string };
  /** Role files to create. A file already on disk with exactly this text is left out. */
  readonly roleFiles: readonly ProposedRoleFile[];
}

export type ApplyResult =
  | { readonly outcome: 'applied'; readonly proposal: GraphEditProposal; readonly write: ProposalWrite }
  | { readonly outcome: 'conflict'; readonly proposal: GraphEditProposal; readonly reasons: readonly string[] }
  /** Not applied and not changed: the proposal is not open, or its text has errors. */
  | { readonly outcome: 'refused'; readonly proposal: GraphEditProposal; readonly reasons: readonly string[] };

/**
 * Decide whether a proposal can be applied over what is on disk now.
 *
 * A file that differs from the base, a new loop whose files already exist, and a role
 * file that exists with other text are all conflicts: the proposal's status becomes
 * `conflict` and nothing is to be written, so a manual edit is never overwritten. A
 * proposal that is not `proposed`, or whose text has validation errors, is refused and
 * left as it was.
 */
export function applyProposal(proposal: GraphEditProposal, disk: DiskState): ApplyResult {
  if (proposal.status !== 'proposed') {
    return {
      outcome: 'refused',
      proposal,
      reasons: [`This proposal is ${proposal.status}, so it cannot be applied.`],
    };
  }
  if (hasErrors(proposal.findings)) {
    return {
      outcome: 'refused',
      proposal,
      reasons: ['The proposed graph has validation errors, so it is not applied. Its findings say what is wrong.'],
    };
  }
  const reasons: string[] = [];
  const graphPath = targetGraphPath(proposal.target);
  if (isNewLoopTarget(proposal.target)) {
    if (disk.graph !== null) {
      reasons.push(`${graphPath} already exists, and a new loop never replaces a file.`);
    }
    const definitionPath = proposal.target.newLoop.definitionPath;
    if (disk.definition === undefined) {
      reasons.push(`What ${definitionPath} holds was not established.`);
    } else if (disk.definition !== null) {
      reasons.push(`${definitionPath} already exists, and a new loop never replaces a file.`);
    }
  } else if (disk.graph === null) {
    reasons.push(`${graphPath} no longer exists.`);
  } else if (graphContentHash(disk.graph) !== proposal.baseContentHash) {
    reasons.push(`${graphPath} has changed since the proposal was made.`);
  }
  const roleFiles: ProposedRoleFile[] = [];
  for (const role of proposal.roleFiles) {
    const roles = disk.roles ?? {};
    if (!Object.prototype.hasOwnProperty.call(roles, role.path)) {
      reasons.push(`What ${role.path} holds was not established.`);
      continue;
    }
    const current = roles[role.path];
    if (current === null || current === undefined) {
      roleFiles.push(role);
    } else if (current !== role.text) {
      reasons.push(`${role.path} already exists with other text, and a proposal never replaces a role file.`);
    }
  }
  if (reasons.length > 0) {
    return { outcome: 'conflict', proposal: { ...proposal, status: 'conflict' }, reasons };
  }
  return {
    outcome: 'applied',
    proposal: { ...proposal, status: 'applied' },
    write: {
      graphPath,
      graphText: proposal.graphText,
      ...(isNewLoopTarget(proposal.target)
        ? { definition: { path: proposal.target.newLoop.definitionPath, text: proposal.target.newLoop.definitionText } }
        : {}),
      roleFiles,
    },
  };
}

/** Discard an open proposal. Any other status is left as it is. */
export function discardProposal(proposal: GraphEditProposal): GraphEditProposal {
  return proposal.status === 'proposed' ? { ...proposal, status: 'discarded' } : proposal;
}

/**
 * A later proposal in the same conversation for the same graph file revises the earlier
 * ones: each still-open earlier proposal becomes `superseded`. The list's order is kept
 * and the newer proposal is added at the end.
 */
export function supersedeWith(
  proposals: readonly GraphEditProposal[],
  newer: GraphEditProposal,
): readonly GraphEditProposal[] {
  const path = normalisePath(targetGraphPath(newer.target));
  return [
    ...proposals.map((each) =>
      each.status === 'proposed' &&
      each.id !== newer.id &&
      each.conversationId === newer.conversationId &&
      normalisePath(targetGraphPath(each.target)) === path
        ? { ...each, status: 'superseded' as const }
        : each,
    ),
    newer,
  ];
}

function normalisePath(value: string): string {
  // Compared case-insensitively, as owned paths are (decision 26): Windows is a target.
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * DSP-209 S23b: the `loop.saveGraph` request for an editor drawing the unsaved-drawing question
 * saves, with the editor's base hash when it gave one, so that save is checked as a direct Save is.
 */
export function drawingSaveRequest(drawing: {
  readonly path: string;
  readonly text: string;
  readonly baseContentHash?: string;
}): { readonly path: string; readonly text: string; readonly expectedContentHash?: string } {
  return {
    path: drawing.path,
    text: drawing.text,
    ...(drawing.baseContentHash === undefined ? {} : { expectedContentHash: drawing.baseContentHash }),
  };
}

// ---------------------------------------------------------------------------------------
// Disk reconciliation

export type DiskReconciliation = 'same' | 'reload' | 'ask';

/**
 * What the editor should do about the file on disk.
 *
 * `base` is the text the editor last loaded or saved, `disk` what the file holds now and
 * `editor` the text the editor would save now (`null` for a file that does not exist).
 *
 * - `same`: disk is still the base, or already holds exactly what the editor has.
 * - `reload`: disk changed and the editor has no unsaved edits, so loading disk loses nothing.
 * - `ask`: both changed differently; neither may silently replace the other.
 */
export function reconcileDisk(input: {
  readonly base: string | null;
  readonly disk: string | null;
  readonly editor: string | null;
}): DiskReconciliation {
  const { base, disk, editor } = input;
  if (disk === base || disk === editor) {
    return 'same';
  }
  return editor === base ? 'reload' : 'ask';
}

/** What changed by hand in a graph since a proposal was applied. */
export interface ManualEdits {
  readonly edited: boolean;
  /** `false` when the file on disk cannot be read as a loop graph. */
  readonly readable: boolean;
  /** `null` when nothing was edited or the change cannot be established. */
  readonly change: GraphChange | null;
}

/**
 * The manual edits made since `lastApplied` was written, so the next turn of the
 * conversation starts from the graph as it is, not as it was proposed (§5: "a manual edit
 * should become part of the next discussion").
 */
export function manualEditsSince(lastApplied: string, disk: string | null): ManualEdits {
  if (disk === lastApplied) {
    return { edited: false, readable: true, change: null };
  }
  if (disk === null) {
    return { edited: true, readable: false, change: null };
  }
  const after = parseLoopGraph(disk);
  if (!after.ok) {
    return { edited: true, readable: false, change: null };
  }
  const before = parseLoopGraph(lastApplied);
  return {
    edited: true,
    readable: true,
    change: before.ok ? describeGraphChange(before.graph, after.graph) : null,
  };
}

// ---------------------------------------------------------------------------------------
// Describing a change

/** A JSON value as it appears in the graph; `undefined` means the field is absent. */
export type FieldValue = unknown;

/** One field that differs. `field` is a dotted path inside the node, edge or graph, such as `model.name`. */
export interface FieldChange {
  readonly field: string;
  readonly before: FieldValue;
  readonly after: FieldValue;
}

/** Where a renamed node's id was followed, as S15's `replaceNode` follows it. */
export interface ReferenceFollowed {
  readonly in: 'graph' | 'node' | 'edge';
  /** The node or edge id; absent for the graph. */
  readonly id?: string;
  readonly field: string;
}

export interface NodeRename {
  readonly from: string;
  readonly to: string;
  readonly references: readonly ReferenceFollowed[];
}

export interface ItemChange {
  readonly id: string;
  readonly fields: readonly FieldChange[];
}

export interface GraphChange {
  /** Nothing that the file means or shows differs. */
  readonly unchanged: boolean;
  /** Something changed, and every change is a node's position (`view`). */
  readonly layoutOnly: boolean;
  /** Graph fields other than `nodes` and `edges`, after renames are followed. */
  readonly graph: readonly FieldChange[];
  readonly renamed: readonly NodeRename[];
  readonly nodes: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly ItemChange[];
  };
  readonly edges: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly ItemChange[];
  };
  /** Nodes whose `view` changed. */
  readonly moved: readonly string[];
  /** The order of nodes or edges in the file differs, which changes no meaning. */
  readonly reordered: { readonly nodes: boolean; readonly edges: boolean };
}

/**
 * Everything that differs between two graphs: nodes and edges added, removed or changed,
 * field by field, and graph fields.
 *
 * A node whose id is gone while a new id of the same kind appears is reported as a rename
 * when `replaceNode` (S15) applied to the old graph explains it: the renamed node matches
 * the new one apart from its position, or the references the rename follows are exactly
 * the references the new graph holds. The references followed are listed on the rename,
 * found by `replaceNode` itself, and the remaining comparison is against the old graph
 * with the rename applied, so a followed reference is not reported a second time.
 *
 * `before` is `null` for a new loop: every node and edge is added.
 */
export function describeGraphChange(before: LoopGraph | null, after: LoopGraph): GraphChange {
  if (before === null) {
    return {
      unchanged: false,
      layoutOnly: false,
      graph: diffFields(graphFields(null), graphFields(after)),
      renamed: [],
      nodes: { added: after.nodes.map((node) => node.id), removed: [], changed: [] },
      edges: { added: after.edges.map((edge) => edge.id), removed: [], changed: [] },
      moved: [],
      reordered: { nodes: false, edges: false },
    };
  }

  const afterIds = new Set(after.nodes.map((node) => node.id));
  const beforeIds = new Set(before.nodes.map((node) => node.id));
  const removedCandidates = before.nodes.filter((node) => !afterIds.has(node.id)).map((node) => node.id);
  const addedCandidates = after.nodes.filter((node) => !beforeIds.has(node.id)).map((node) => node.id);

  let current = before;
  const renamed: NodeRename[] = [];
  const paired = new Set<string>();
  for (const from of removedCandidates) {
    const node = findNode(current, from);
    if (node === null) {
      continue;
    }
    for (const to of addedCandidates) {
      if (paired.has(to)) {
        continue;
      }
      const target = findNode(after, to);
      if (target === null || target.kind !== node.kind) {
        continue;
      }
      const candidate = replaceNode(current, from, { ...node, id: to });
      if (!explainsRename(candidate, after, to)) {
        continue;
      }
      renamed.push({ from, to, references: referencesChanged(current, candidate, to) });
      paired.add(to);
      current = candidate;
      break;
    }
  }

  const nodes = diffItems(current.nodes, after.nodes);
  const edges = diffItems(current.edges, after.edges);
  const graph = diffFields(graphFields(current), graphFields(after));
  const moved = nodes.changed
    .filter((item) => item.fields.some((field) => field.field === 'view' || field.field.startsWith('view.')))
    .map((item) => item.id);
  const reordered = {
    nodes: sameMembersOtherOrder(current.nodes, after.nodes),
    edges: sameMembersOtherOrder(current.edges, after.edges),
  };
  const nothingButViews =
    renamed.length === 0 &&
    graph.length === 0 &&
    nodes.added.length === 0 &&
    nodes.removed.length === 0 &&
    edges.added.length === 0 &&
    edges.removed.length === 0 &&
    edges.changed.length === 0 &&
    !reordered.nodes &&
    !reordered.edges &&
    nodes.changed.every((item) => item.fields.every((field) => isViewField(field.field)));
  const unchanged = nothingButViews && nodes.changed.length === 0;
  return {
    unchanged,
    layoutOnly: nothingButViews && !unchanged,
    graph,
    renamed,
    nodes,
    edges,
    moved,
    reordered,
  };
}

function isViewField(field: string): boolean {
  return field === 'view' || field.startsWith('view.');
}

function findNode(graph: LoopGraph, id: string): LoopNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

function withoutIdAndView(node: LoopNode): Record<string, unknown> {
  const { id: _id, view: _view, ...rest } = node;
  return rest;
}

/**
 * Whether renaming in `candidate` explains `to` in `after`: the node itself matches apart
 * from position, or it is referenced and its references are exactly the new graph's.
 */
function explainsRename(candidate: LoopGraph, after: LoopGraph, to: string): boolean {
  const mine = findNode(candidate, to);
  const theirs = findNode(after, to);
  if (mine === null || theirs === null) {
    return false;
  }
  if (jsonEqual(withoutIdAndView(mine), withoutIdAndView(theirs))) {
    return true;
  }
  const refsMine = referencesOf(candidate, to);
  return refsMine.length > 0 && jsonEqual(refsMine, referencesOf(after, to));
}

/** Every place a graph refers to node `id`, found by asking `replaceNode` to rename it. */
function referencesOf(graph: LoopGraph, id: string): readonly ReferenceFollowed[] {
  const node = findNode(graph, id);
  if (node === null) {
    return [];
  }
  const probe = `\u0000${id}`;
  return referencesChanged(graph, replaceNode(graph, id, { ...node, id: probe }), probe);
}

/** The reference fields that differ between a graph and the same graph with one node renamed to `renamedTo`. */
function referencesChanged(before: LoopGraph, after: LoopGraph, renamedTo: string): readonly ReferenceFollowed[] {
  const found: ReferenceFollowed[] = [];
  for (const field of diffFields(graphFields(before), graphFields(after))) {
    found.push({ in: 'graph', field: field.field });
  }
  after.nodes.forEach((node, index) => {
    if (node.id === renamedTo) {
      return;
    }
    for (const field of diffFields(asRecord(before.nodes[index]), asRecord(node))) {
      found.push({ in: 'node', id: node.id, field: field.field });
    }
  });
  after.edges.forEach((edge, index) => {
    for (const field of diffFields(asRecord(before.edges[index]), asRecord(edge))) {
      found.push({ in: 'edge', id: edge.id, field: field.field });
    }
  });
  return found;
}

function graphFields(graph: LoopGraph | null): Record<string, unknown> {
  if (graph === null) {
    return {};
  }
  const { nodes: _nodes, edges: _edges, ...rest } = graph;
  return rest;
}

function asRecord(value: LoopNode | LoopEdge | undefined): Record<string, unknown> {
  return value === undefined ? {} : (value as unknown as Record<string, unknown>);
}

function diffItems<T extends LoopNode | LoopEdge>(
  before: readonly T[],
  after: readonly T[],
): { added: string[]; removed: string[]; changed: ItemChange[] } {
  const beforeById = new Map(before.map((item) => [item.id, item] as const));
  const afterIds = new Set(after.map((item) => item.id));
  const added: string[] = [];
  const changed: ItemChange[] = [];
  for (const item of after) {
    const old = beforeById.get(item.id);
    if (old === undefined) {
      added.push(item.id);
      continue;
    }
    const fields = diffFields(asRecord(old), asRecord(item));
    if (fields.length > 0) {
      changed.push({ id: item.id, fields });
    }
  }
  const removed = before.filter((item) => !afterIds.has(item.id)).map((item) => item.id);
  return { added, removed, changed };
}

function sameMembersOtherOrder(before: readonly { id: string }[], after: readonly { id: string }[]): boolean {
  const afterIds = new Set(after.map((item) => item.id));
  const beforeIds = new Set(before.map((item) => item.id));
  const left = before.map((item) => item.id).filter((id) => afterIds.has(id));
  const right = after.map((item) => item.id).filter((id) => beforeIds.has(id));
  return left.some((id, index) => right[index] !== id);
}

/** Field-by-field differences: plain objects are compared key by key, everything else as a whole. */
function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, prefix = ''): FieldChange[] {
  const out: FieldChange[] = [];
  const keys = [...Object.keys(before), ...Object.keys(after).filter((key) => !(key in before))];
  for (const key of keys) {
    const left = before[key];
    const right = after[key];
    const field = prefix === '' ? key : `${prefix}.${key}`;
    if (isPlainObject(left) && isPlainObject(right)) {
      out.push(...diffFields(left, right, field));
    } else if (!jsonEqual(left, right)) {
      out.push({ field, before: left, after: right });
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((each, index) => jsonEqual(each, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left).filter((key) => left[key] !== undefined);
    const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
    return keys.length === otherKeys.length && keys.every((key) => jsonEqual(left[key], right[key]));
  }
  return false;
}

// ---------------------------------------------------------------------------------------
// Reading a change aloud

/**
 * One line per change, for a proposal card or a conversation turn. Values longer than a
 * line are shortened here only; {@link GraphChange} holds them whole.
 */
export function describeChangeLines(change: GraphChange): readonly string[] {
  if (change.unchanged) {
    return ['No change.'];
  }
  if (change.layoutOnly) {
    return [`Layout only: ${count(change.moved.length, 'node')} moved (${change.moved.join(', ')}).`];
  }
  const lines: string[] = [];
  for (const field of change.graph) {
    lines.push(`Graph: ${fieldLine(field)}`);
  }
  for (const rename of change.renamed) {
    const where = rename.references.map(referenceText);
    lines.push(
      `Node "${rename.from}" renamed to "${rename.to}"` +
        (where.length === 0 ? '.' : `; its references follow: ${where.join(', ')}.`),
    );
  }
  for (const id of change.nodes.added) lines.push(`Node "${id}" added.`);
  for (const id of change.nodes.removed) lines.push(`Node "${id}" removed.`);
  for (const item of change.nodes.changed) {
    for (const field of item.fields) lines.push(`Node "${item.id}": ${fieldLine(field)}`);
  }
  for (const id of change.edges.added) lines.push(`Edge "${id}" added.`);
  for (const id of change.edges.removed) lines.push(`Edge "${id}" removed.`);
  for (const item of change.edges.changed) {
    for (const field of item.fields) lines.push(`Edge "${item.id}": ${fieldLine(field)}`);
  }
  if (change.reordered.nodes) lines.push('The order of nodes in the file changed.');
  if (change.reordered.edges) lines.push('The order of edges in the file changed.');
  return lines;
}

function referenceText(reference: ReferenceFollowed): string {
  return reference.in === 'graph' ? reference.field : `${reference.in} "${reference.id}" ${reference.field}`;
}

function fieldLine(field: FieldChange): string {
  if (field.before === undefined) return `${field.field} set to ${valueText(field.after)}.`;
  if (field.after === undefined) return `${field.field} removed (was ${valueText(field.before)}).`;
  return `${field.field} changed from ${valueText(field.before)} to ${valueText(field.after)}.`;
}

function valueText(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------------------
// What a person reads first on a proposal's card

/** A proposal in a few readable lines, for the top of its card; the details stay in full below. */
export interface ProposalSummary {
  /** The loop's own name, from the proposed graph. */
  readonly loopName: string;
  readonly isNew: boolean;
  /** The graph's purpose up to the end of its first sentence, whole; `null` when none is written. */
  readonly purpose: string | null;
  /** All of the graph's purpose, when {@link purpose} is not all of it; `null` otherwise. */
  readonly wholePurpose: string | null;
  /** One sentence on what Apply would change. */
  readonly change: string;
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
  readonly notices: readonly Finding[];
}

/** The first sentence of a text, never cut inside one; the whole text when it has no sentence end. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed);
  return match === null ? trimmed : match[0];
}

/** DSP-209 S23b: the card's opening lines. Pure, so the window and a test read it alike. */
export function summariseProposal(proposal: Pick<GraphEditProposal, 'target' | 'graphText' | 'roleFiles' | 'change' | 'findings'>): ProposalSummary {
  const parsed = parseLoopGraph(proposal.graphText);
  const graph = parsed.ok ? parsed.graph : null;
  const isNew = isNewLoopTarget(proposal.target);
  const fullPurpose = graph?.purpose?.trim() ?? '';
  const purpose = fullPurpose === '' ? null : firstSentence(fullPurpose);
  const roles = proposal.roleFiles.length === 0 ? '' : `, and ${count(proposal.roleFiles.length, 'new role')}`;
  let change: string;
  if (isNew && graph !== null) {
    const endings = graph.nodes.filter((node) => node.kind === 'terminal').length;
    change = `A new loop: ${count(graph.nodes.length - endings, 'step')} and ${count(endings, 'ending')}, ${count(graph.edges.length, 'connection')}${roles}.`;
  } else if (proposal.change === null) {
    change = 'The change could not be described; the details say why.';
  } else if (proposal.change.unchanged) {
    change = proposal.roleFiles.length === 0 ? 'No change to the loop.' : `No change to the graph${roles}.`;
  } else if (proposal.change.layoutOnly) {
    change = `Only the layout: ${count(proposal.change.moved.length, 'step')} moved.`;
  } else {
    const { nodes, edges } = proposal.change;
    const parts = [
      nodes.added.length === 0 ? '' : `${count(nodes.added.length, 'step')} added`,
      nodes.removed.length === 0 ? '' : `${count(nodes.removed.length, 'step')} removed`,
      proposal.change.renamed.length === 0 ? '' : `${count(proposal.change.renamed.length, 'step')} renamed`,
      nodes.changed.length === 0 ? '' : `${count(nodes.changed.length, 'step')} changed`,
      edges.added.length === 0 ? '' : `${count(edges.added.length, 'connection')} added`,
      edges.removed.length === 0 ? '' : `${count(edges.removed.length, 'connection')} removed`,
      edges.changed.length === 0 ? '' : `${count(edges.changed.length, 'connection')} changed`,
      proposal.change.graph.length === 0 ? '' : 'the loop’s own settings changed',
    ].filter((part) => part !== '');
    change = parts.length === 0 ? `Changes the file's order only${roles}.` : `Changes: ${parts.join(', ')}${roles}.`;
  }
  return {
    loopName: graph?.name ?? targetGraphPath(proposal.target),
    isNew,
    purpose,
    wholePurpose: purpose === null || purpose === fullPurpose ? null : fullPurpose,
    change,
    errors: proposal.findings.filter((finding) => finding.severity === 'error'),
    warnings: proposal.findings.filter((finding) => finding.severity === 'warning'),
    notices: proposal.findings.filter((finding) => finding.severity === 'notice'),
  };
}

// ---------------------------------------------------------------------------------------
// Identity of a file's content

/**
 * A short, stable hash of a graph file's exact text (two 32-bit FNV-1a lanes). A change
 * detector for "is this still the text the proposal was made against", not a secret.
 */
export function graphContentHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Whether a proposal stays in view: an open one, or the newest of all. The rest are history. */
export function proposalInView(proposal: GraphEditProposal, index: number, all: readonly GraphEditProposal[]): boolean {
  return proposal.status === 'proposed' || proposal.status === 'conflict' || index === all.length - 1;
}

/** A proposal with its number in the conversation and whether it stays in view. */
export interface NumberedProposal {
  readonly proposal: GraphEditProposal;
  readonly ordinal: number;
  readonly shown: boolean;
}

/**
 * Where the conversation's proposals are drawn (Niclas, 15 November 2026): each at the turn
 * that made it, by that turn's `dspatchRunId`, so it keeps its place in the conversation's
 * order whatever happens to its status later. A message read from disk carries its own
 * proposals, which names their turn; a live update names it in `turns`. A proposal whose turn
 * neither names is `unplaced`, and its place is not guessed.
 */
export interface ProposalPlacement {
  readonly byTurn: ReadonlyMap<string, readonly NumberedProposal[]>;
  readonly unplaced: readonly NumberedProposal[];
}

/** Pure, for the window and the tests: the proposals in force and where each is drawn. */
export function placeProposals(restored: readonly StoredMessage[], live: GraphProposalsUpdate | null): ProposalPlacement {
  const fromDisk = restored.flatMap((message) => message.graphProposals ?? []);
  const useLive = live !== null && (fromDisk.length === 0 || fromDisk.some((each) => each.conversationId === live.conversationId));
  const proposals = useLive ? live.proposals : fromDisk;
  const turnOf = new Map<string, string>();
  for (const message of restored) {
    for (const proposal of message.graphProposals ?? []) {
      turnOf.set(proposal.id, message.dspatchRunId);
    }
  }
  if (useLive) {
    for (const [id, turn] of Object.entries(live.turns ?? {})) {
      turnOf.set(id, turn);
    }
  }
  const byTurn = new Map<string, NumberedProposal[]>();
  const unplaced: NumberedProposal[] = [];
  proposals.forEach((proposal, index) => {
    const entry = { proposal, ordinal: index + 1, shown: proposalInView(proposal, index, proposals) };
    const turn = turnOf.get(proposal.id);
    if (turn === undefined) {
      unplaced.push(entry);
    } else {
      byTurn.set(turn, [...(byTurn.get(turn) ?? []), entry]);
    }
  });
  return { byTurn, unplaced };
}
