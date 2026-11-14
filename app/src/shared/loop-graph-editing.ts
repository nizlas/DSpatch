/**
 * The operations the editor performs on a graph, kept out of the component.
 *
 * Everything here is pure and returns a new graph, for two reasons. The editor
 * revalidates after every change — `checkLoopGraph` takes a typed graph, so an edit
 * is "make the next graph, check it, draw the findings" — and the rules that make an
 * edit legal are the format's, not the canvas's. Placing a node, drawing an edge and
 * removing either are where a well-meaning editor would quietly produce an invalid
 * file, so the awkward parts of the format live here where they can be read:
 *
 * - **A node that declares outcomes may not also leave on plain success.** So adding
 *   a branch to a node that has a success edge *moves* that edge instead of adding
 *   beside it.
 * - **Every declared outcome and every declared failure needs an edge.** A node given
 *   a new outcome is invalid until the author draws it, which is a normal moment in
 *   drawing and not a mistake — see {@link isDraftFinding}.
 * - **An edge may only carry a failure both the graph and its source declare.** So
 *   drawing a dashed edge declares that failure on the source if it does not already.
 *
 * No filesystem, no React: this module is imported by the window and by the tests.
 */

import { NODE_KINDS } from './loop-graph';
import type {
  EdgeCondition,
  FailureKind,
  LoopEdge,
  LoopGraph,
  LoopNode,
  NodeKind,
  ResolvedRole,
  RoleReference,
  RoleResolver,
} from './loop-graph';
import type { Finding } from './loop-graph-load';
import { nodeSize } from './loop-edge-geometry';
import { edgeLabelText } from './loop-edge-labels';
import { countRouteCrossings, routeLoopEdges, sidePathEdges } from './loop-edge-routing';
import { LAYER_GAP, layeredLayout } from './loop-layout';

/**
 * How a role reference is indexed.
 *
 * All three fields, because two nodes may name the same role id through different
 * files while DSP-23 does not exist yet, and the answer for one is not the answer
 * for the other.
 */
export function roleKey(reference: RoleReference): string {
  return `${reference.id}\u0000${reference.source.kind}\u0000${reference.source.path}`;
}

/** A resolver over answers the main process already gave us, for offline revalidation. */
export function resolverFromEntries(
  entries: ReadonlyMap<string, ResolvedRole | null>,
): RoleResolver {
  return (reference) => entries.get(roleKey(reference)) ?? null;
}

/** Which role references a graph uses, deduplicated. */
export function referencedRoles(graph: LoopGraph): readonly RoleReference[] {
  const seen = new Map<string, RoleReference>();
  for (const node of graph.nodes) {
    if (node.role) {
      seen.set(roleKey(node.role), node.role);
    }
  }
  return [...seen.values()];
}

export function nodeById(graph: LoopGraph, id: string): LoopNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

export function edgeById(graph: LoopGraph, id: string): LoopEdge | null {
  return graph.edges.find((edge) => edge.id === id) ?? null;
}

/** A readable, unique id derived from what the author sees on the node. */
export function uniqueId(base: string, taken: readonly string[]): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'node';
  if (!taken.includes(slug)) {
    return slug;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${slug}-${String(suffix)}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
}

/** What each kind is called on the palette, and what a placed one starts as. */
export const KIND_LABELS: Readonly<Record<NodeKind, string>> = {
  agent: 'Agent',
  gate: 'Gate',
  router: 'Router',
  human: 'Human',
  external: 'External',
  terminal: 'Terminal',
};

export const KIND_HINTS: Readonly<Record<NodeKind, string>> = {
  agent: 'A role doing work. Needs a role description.',
  gate: 'A checkpoint that admits or rejects. May be performed by a role.',
  router: 'Chooses a branch without doing the work. Needs at least two outcomes.',
  human: 'A step where a person acts.',
  external: 'A participant this loop does not run and cannot bound.',
  terminal: 'The run stops here.',
};

export { NODE_KINDS };

/**
 * A newly placed node.
 *
 * A router starts with two outcomes and a gate with the three verdicts our own loop
 * uses, because both kinds are invalid without them and offering the shape the format
 * requires is more use than an empty node plus an error. An agent starts with an
 * unresolved role reference rather than none: the format requires a role on an agent,
 * and a reference that resolves to nothing is shown as broken, which is the state the
 * author is actually in.
 */
export function newNode(kind: NodeKind, graph: LoopGraph, x: number, y: number): LoopNode {
  const taken = graph.nodes.map((node) => node.id);
  const label = KIND_LABELS[kind];
  const id = uniqueId(label, taken);
  const base: LoopNode = { id, kind, label, view: { x: Math.round(x), y: Math.round(y) } };
  if (kind === 'agent') {
    return {
      ...base,
      role: { id, source: { kind: 'cursor-agent-file', path: `.cursor/agents/${id}.md` } },
      model: { policy: 'inherit' },
    };
  }
  if (kind === 'router') {
    return { ...base, outcomes: ['first', 'second'] };
  }
  if (kind === 'gate') {
    return { ...base, outcomes: ['accept', 'rework'] };
  }
  return base;
}

export function withNode(graph: LoopGraph, node: LoopNode): LoopGraph {
  return { ...graph, nodes: [...graph.nodes, node] };
}

/**
 * Where a node the file did not position is put, and how far apart.
 *
 * The origin keeps the first row clear of the palette bar above the canvas, which is
 * what hid the one node that was visible when a twenty-node hand-written graph was
 * opened on 16 September 2026. The steps are a node's box plus room for an arrow.
 */
export const LAYOUT_ORIGIN = { x: 48, y: 40 } as const;
export const LAYOUT_STEP = { x: 224, y: 132 } as const;
export const LAYOUT_MAX_COLUMNS = 6;

/**
 * Give every node without a `view` a position (DSP-209 S18b: by the layered layout, which
 * replaced the grid described below; the rest of this account still holds).
 *
 * `view` is optional in the format, so a graph written by hand is drawn entirely at
 * 0,0 — twenty nodes stacked on each other with thirty-one zero-length edges, which is
 * what an independent Verifier saw when it transcribed the reference figure and opened
 * it. There is no cue that anything else exists and nothing to aim a drag at, so the
 * file is read correctly and cannot be seen.
 *
 * A grid is not a layout algorithm and is not meant to be one: it is the difference
 * between a graph an author can start arranging and one they cannot find. Automatic
 * layout is out of DSP-22's scope, deliberately.
 *
 * **This is a view, not an edit.** The caller must not count these positions as an
 * unsaved change — see how {@link LoopEditor} sets its saved text — so a file the
 * author only looked at is never rewritten with positions they did not choose. Once
 * they do change something, saving writes the arrangement along with it, which is the
 * point: by then the layout is theirs.
 *
 * Nodes the file did position keep exactly what it says, and the grid starts below
 * them, so a partly arranged graph does not gain a pile on top of the part its author
 * placed by hand.
 */
export function layOutMissingViews(graph: LoopGraph): {
  readonly graph: LoopGraph;
  readonly placed: readonly string[];
} {
  const placed = graph.nodes.filter((node) => node.view === undefined).map((node) => node.id);
  if (placed.length === 0) {
    return { graph, placed };
  }
  // DSP-209 S18b: by the layered layout rather than a grid. Laid out with the whole drawing,
  // so the missing nodes keep their layers and order; then moved, as one block, below every
  // node the file did place, which therefore cannot be overlapped.
  const layout = bestLayout(graph);
  const missing = new Set(placed);
  const lowestPlaced = graph.nodes.reduce<number | null>(
    (lowest, node) => (node.view === undefined ? lowest : Math.max(lowest ?? 0, node.view.y + nodeSize(node).height)),
    null,
  );
  const topOfMissing = Math.min(...placed.map((id) => layout.get(id)?.y ?? LAYOUT_ORIGIN.y));
  const shift = lowestPlaced === null ? 0 : lowestPlaced + LAYER_GAP - topOfMissing;
  const nodes = graph.nodes.map((node) => {
    if (!missing.has(node.id) || node.view !== undefined) {
      return node;
    }
    const at = layout.get(node.id) ?? { x: LAYOUT_ORIGIN.x, y: LAYOUT_ORIGIN.y };
    return { ...node, view: { x: at.x, y: at.y + shift } };
  });
  return { graph: { ...graph, nodes }, placed };
}

/**
 * A proposed graph with only the positions the person saved (Niclas, 14 November 2026): a node
 * the saved graph `base` has keeps that node's saved `view`, or none if it had none, and every
 * other node loses whatever `view` the proposal gave it. {@link layOutMissingViews} then places
 * the rest by the layered layout, so a graph proposal cannot bypass the layout with positions
 * of its own, and never moves what the person placed. With no base, a new loop, nothing is kept.
 */
export function withSavedPositionsOnly(proposed: LoopGraph, base: LoopGraph | null): LoopGraph {
  const saved = new Map((base?.nodes ?? []).map((node) => [node.id, node.view]));
  return {
    ...proposed,
    nodes: proposed.nodes.map((node) => {
      const view = saved.get(node.id);
      if (view !== undefined) {
        return { ...node, view };
      }
      const { view: _ignored, ...rest } = node;
      return rest;
    }),
  };
}

type Positions = ReadonlyMap<string, { readonly x: number; readonly y: number }>;

function placedAt(graph: LoopGraph, layout: Positions): LoopGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const at = layout.get(node.id);
      return at === undefined ? node : { ...node, view: { ...(node.view ?? {}), x: at.x, y: at.y } };
    }),
  };
}

/** How many times the layout may make more room for labels that found no clear place. */
const LABEL_ROOM_TRIES = 4;

/**
 * The layered layout to use (Niclas, 14 November 2026: side paths outside the main flow where
 * possible, and room for every edge's label from the start). Two candidates: the endings only
 * side paths reach set beside the main flow, and every ending in the last row. Each is routed
 * with the labels the canvas draws; while some label finds no place clear of nodes and other
 * labels, the layout makes more room where that label is — the column beside the flow moves out
 * when the label's edge goes into it, every gap grows otherwise — and it is routed again, up to
 * {@link LABEL_ROOM_TRIES} times. Then the candidate with fewer such labels wins, and between
 * equals the one whose routes cross fewer times, the first on a tie; a drawing with no side
 * path has one candidate. That is a few routings, which is why it happens on **Arrange** and
 * when unplaced nodes are laid out, never while a node is dragged. Labels are placed the same
 * whether they are shown or not, so a selection that shows some of them moves nothing.
 */
function bestLayout(graph: LoopGraph): Positions {
  const side = sidePathEdges(graph);
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const labelOf = (edgeId: string): string => {
    const edge = edges.get(edgeId);
    return edge === undefined ? '' : edgeLabelText(edge);
  };
  type Scored = { readonly positions: Positions; readonly conflicts: number; readonly crossings: number };
  let best: Scored | null = null;
  for (const besideEndings of side.size === 0 ? [false] : [true, false]) {
    let chosen: Scored | null = null;
    let widen = 0;
    let widenBeside = 0;
    for (let attempt = 0; attempt <= LABEL_ROOM_TRIES; attempt += 1) {
      const layout = layeredLayout(graph, { sidePaths: side, besideEndings, labelOf, widen, widenBeside });
      let conflicts: readonly string[] = [];
      const routes = routeLoopEdges(placedAt(graph, layout.positions), {
        labelOf: edgeLabelText,
        report: (report) => (conflicts = report.labelConflicts),
      });
      if (chosen === null || conflicts.length < chosen.conflicts) {
        chosen = { positions: layout.positions, conflicts: conflicts.length, crossings: countRouteCrossings(routes) };
      }
      if (conflicts.length === 0) {
        break;
      }
      if (conflicts.some((id) => layout.beside.has(edges.get(id)?.to ?? ''))) {
        widenBeside += 1;
      } else {
        widen += 1;
      }
    }
    if (
      chosen !== null &&
      (best === null || chosen.conflicts < best.conflicts || (chosen.conflicts === best.conflicts && chosen.crossings < best.crossings))
    ) {
      best = chosen;
    }
  }
  return best?.positions ?? new Map();
}

/**
 * DSP-209 S18b: every node at its place in the layered layout, for **Arrange**.
 *
 * An ordinary edit: the caller applies it like any other change, so it is unsaved until the
 * person saves and gone on Reload. Only `view` changes; the drawing means what it meant.
 */
export function arrangeGraph(graph: LoopGraph): LoopGraph {
  return placedAt(graph, bestLayout(graph));
}

/**
 * Replace one node, keeping its position in the file.
 *
 * A renamed node is still the same node, so everything that names it follows, which is
 * every place the format holds a node id: the graph's `entry`; each edge's `from`, `to`,
 * `delivers` and `skips`; and each node's `report.writtenBy`, `consumes` and
 * `fanOut.slicesFrom` (DSP-209 S15 added the last four of these). Leaving any of them
 * behind would turn a rename into a broken reference the author did not make. Only
 * exact ids are replaced, and a field that is absent stays absent.
 */
export function replaceNode(graph: LoopGraph, id: string, next: LoopNode): LoopGraph {
  const renamed = next.id !== id;
  const follow = (ids: readonly string[] | undefined): readonly string[] | undefined =>
    ids === undefined || !ids.includes(id) ? ids : ids.map((each) => (each === id ? next.id : each));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const own = node.id === id ? next : node;
      if (!renamed) {
        return own;
      }
      let result = own;
      if (result.report?.writtenBy === id) {
        result = { ...result, report: { ...result.report, writtenBy: next.id } };
      }
      if (result.consumes?.includes(id)) {
        result = { ...result, consumes: follow(result.consumes) };
      }
      if (result.fanOut?.slicesFrom === id) {
        result = { ...result, fanOut: { ...result.fanOut, slicesFrom: next.id } };
      }
      return result;
    }),
    edges: renamed
      ? graph.edges.map((edge) => {
          let result: LoopEdge = {
            ...edge,
            from: edge.from === id ? next.id : edge.from,
            to: edge.to === id ? next.id : edge.to,
          };
          if (edge.delivers?.includes(id)) {
            result = { ...result, delivers: follow(edge.delivers) };
          }
          if (edge.skips?.includes(id)) {
            result = { ...result, skips: follow(edge.skips) };
          }
          return result;
        })
      : graph.edges,
    entry: graph.entry === id ? next.id : graph.entry,
  };
}

/** Remove a node and every edge that touched it, because a dangling edge is an error. */
export function withoutNode(graph: LoopGraph, id: string): LoopGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== id),
    edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

export function replaceEdge(graph: LoopGraph, id: string, next: LoopEdge): LoopGraph {
  return { ...graph, edges: graph.edges.map((edge) => (edge.id === id ? next : edge)) };
}

export function withoutEdge(graph: LoopGraph, id: string): LoopGraph {
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== id) };
}

function nextEdgeId(graph: LoopGraph): string {
  for (let index = graph.edges.length + 1; ; index += 1) {
    const candidate = `e${String(index).padStart(2, '0')}`;
    if (!graph.edges.some((edge) => edge.id === candidate)) {
      return candidate;
    }
  }
}

/** The outcomes of a node that no edge routes yet. */
export function unroutedOutcomes(graph: LoopGraph, node: LoopNode): readonly string[] {
  const routed = graph.edges
    .filter((edge) => edge.from === node.id && edge.when.on === 'outcome')
    .map((edge) => (edge.when.on === 'outcome' ? edge.when.outcome : ''));
  return (node.outcomes ?? []).filter((outcome) => !routed.includes(outcome));
}

/** The declared failures of a node that no edge carries yet. */
export function unroutedFailures(graph: LoopGraph, node: LoopNode): readonly string[] {
  const routed = graph.edges
    .filter((edge) => edge.from === node.id && edge.when.on === 'declared-failure')
    .map((edge) => (edge.when.on === 'declared-failure' ? edge.when.failure : ''));
  return (node.declaredFailures ?? []).filter((failure) => !routed.includes(failure));
}

/** The two connection kinds on the palette. The distinction is the point of the design. */
export type ConnectionKind = 'plain' | 'declared-failure';

/**
 * Draw a connection, choosing the condition the format allows here.
 *
 * A plain connection from a node that declares outcomes becomes that node's next
 * unrouted outcome, because such a node may not leave on plain success — offering
 * `success` and then reporting an error for it would be an editor arguing with its
 * own format. A dashed connection carries the source's next unrouted failure, and
 * declares one on the source when it has none left to route: drawing the arrow is how
 * an author says this step can fail that way.
 */
export function connect(
  graph: LoopGraph,
  fromId: string,
  toId: string,
  kind: ConnectionKind,
): { readonly graph: LoopGraph; readonly edgeId: string; readonly note: string } {
  const source = nodeById(graph, fromId);
  const id = nextEdgeId(graph);
  if (source === null) {
    return { graph, edgeId: id, note: `There is no node called ${fromId}.` };
  }

  let next = graph;
  let when: EdgeCondition;
  let note: string;

  if (kind === 'declared-failure') {
    const available = unroutedFailures(graph, source);
    const kinds = graph.failureKinds.map((entry) => entry.id);
    const failure =
      available[0] ??
      kinds.find((entry) => !(source.declaredFailures ?? []).includes(entry)) ??
      kinds[0];
    if (failure === undefined) {
      return {
        graph,
        edgeId: id,
        note:
          'This graph declares no failure kinds yet, so there is no failure for a dashed ' +
          'edge to carry. Add one to the graph first.',
      };
    }
    if (!(source.declaredFailures ?? []).includes(failure)) {
      next = replaceNode(next, source.id, {
        ...source,
        declaredFailures: [...(source.declaredFailures ?? []), failure],
      });
      note = `${source.label ?? source.id} now declares "${failure}", and this edge carries it.`;
    } else {
      note = `Carries the declared failure "${failure}".`;
    }
    when = { on: 'declared-failure', failure };
  } else if ((source.outcomes ?? []).length > 0) {
    const outcome = unroutedOutcomes(graph, source)[0] ?? (source.outcomes ?? [])[0];
    when = { on: 'outcome', outcome: outcome as string };
    note =
      `${source.label ?? source.id} branches on named outcomes, so this edge is taken on ` +
      `"${String(outcome)}" rather than on plain success.`;
  } else {
    when = { on: 'success' };
    note = 'Taken when the step finishes with its normal result.';
  }

  const existingSuccess = next.edges.find(
    (edge) => edge.from === fromId && edge.when.on === 'success',
  );
  if (when.on !== 'success' && existingSuccess !== undefined && (source.outcomes ?? []).length > 0) {
    // The format forbids a node that routes on outcomes from also leaving on plain
    // success. The existing success edge is moved onto this branch rather than left
    // to become an error the author did not cause.
    next = withoutEdge(next, existingSuccess.id);
    note += ` Its plain success edge to ${existingSuccess.to} was removed, because a node that branches on outcomes may not also leave on success.`;
  }

  return {
    graph: { ...next, edges: [...next.edges, { id, from: fromId, to: toId, when }] },
    edgeId: id,
    note,
  };
}

/** Add a failure kind to the graph's vocabulary. */
export function withFailureKind(graph: LoopGraph, kind: FailureKind): LoopGraph {
  return { ...graph, failureKinds: [...graph.failureKinds, kind] };
}

export const SEVERITY_RANK: Readonly<Record<Finding['severity'], number>> = {
  error: 3,
  warning: 2,
  notice: 1,
};

/** The worst severity among findings, or `null` when there are none. */
export function worstSeverity(findings: readonly Finding[]): Finding['severity'] | null {
  let worst: Finding['severity'] | null = null;
  for (const finding of findings) {
    if (worst === null || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[worst]) {
      worst = finding.severity;
    }
  }
  return worst;
}

/**
 * Findings indexed by the object they concern, so highlighting one is a lookup.
 *
 * DSP-21 put `nodeId` and `edgeId` on every finding for exactly this. Findings about
 * the graph itself land in `graph`, and are the ones worth a quiet panel rather than
 * ink on the canvas.
 */
export interface FindingIndex {
  readonly byNode: ReadonlyMap<string, readonly Finding[]>;
  readonly byEdge: ReadonlyMap<string, readonly Finding[]>;
  readonly graph: readonly Finding[];
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
}

export function indexFindings(findings: readonly Finding[]): FindingIndex {
  const byNode = new Map<string, Finding[]>();
  const byEdge = new Map<string, Finding[]>();
  const graph: Finding[] = [];
  let errors = 0;
  let warnings = 0;
  let notices = 0;
  for (const finding of findings) {
    if (finding.severity === 'error') {
      errors += 1;
    } else if (finding.severity === 'warning') {
      warnings += 1;
    } else {
      notices += 1;
    }
    if (finding.nodeId !== undefined && finding.nodeId !== null) {
      const list = byNode.get(finding.nodeId) ?? [];
      list.push(finding);
      byNode.set(finding.nodeId, list);
    } else if (finding.edgeId !== undefined && finding.edgeId !== null) {
      const list = byEdge.get(finding.edgeId) ?? [];
      list.push(finding);
      byEdge.set(finding.edgeId, list);
    } else {
      graph.push(finding);
    }
  }
  return { byNode, byEdge, graph, errors, warnings, notices };
}

/**
 * Findings grouped by their stable code, with one message and a count.
 *
 * Call 001 measured the need: our own loop produces twenty notices, eight of them the
 * same `role-target-inferred`. Twenty true notices printed as a list read as twenty
 * problems, which is the wall this grouping exists to avoid.
 */
export interface FindingGroup {
  readonly code: string;
  readonly severity: Finding['severity'];
  readonly count: number;
  readonly message: string;
  readonly objects: readonly string[];
}

export function groupFindings(findings: readonly Finding[]): readonly FindingGroup[] {
  const groups = new Map<string, { severity: Finding['severity']; messages: string[]; objects: string[] }>();
  for (const finding of findings) {
    const group = groups.get(finding.code) ?? {
      severity: finding.severity,
      messages: [],
      objects: [],
    };
    group.messages.push(finding.message);
    const object = finding.nodeId ?? finding.edgeId ?? null;
    if (object !== null && object !== undefined && !group.objects.includes(object)) {
      group.objects.push(object);
    }
    groups.set(finding.code, group);
  }
  return [...groups.entries()]
    .map(([code, group]) => ({
      code,
      severity: group.severity,
      count: group.messages.length,
      message: group.messages[0] as string,
      objects: group.objects,
    }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count);
}

/**
 * Whether a finding is the shape of an author mid-draw rather than a broken file.
 *
 * A declared outcome or failure with nowhere to go is an *error* in the format, and
 * rightly so — it is where a run stops while its author believed it would recover.
 * But it is also the unavoidable state one second after adding an outcome, so the
 * editor says "draw this next" rather than "your graph is broken", and only refuses to
 * save. Call 001 predicted this in its note; it is the one place the editor
 * deliberately re-presents a severity without changing it.
 */
export function isDraftFinding(finding: Finding): boolean {
  return (
    finding.severity === 'error' &&
    /nowhere to go|no edge|needs an edge|not routed|unrouted/i.test(finding.message)
  );
}
