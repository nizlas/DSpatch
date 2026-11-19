/**
 * DSP-231: shared, versioned agent roles, and the reviewable upgrade from the roles graphs had before.
 *
 * A role catalog is a folder of role sources, one file per version (`<id>/v<version>.role.md`), and a
 * `catalog.json` index listing each version with the SHA-256 of its text. DSpatch's own catalog is
 * `docs/loop/roles/catalog/`; a repository keeps its copies and its own roles in `.dspatch/roles/`,
 * with an index of the same form. A graph refers to a catalog role by identity and version
 * (`{"id": "implementer", "version": 1, "source": {"kind": "role-catalog", "path": …}}`), so the same
 * identity and version always mean the same text: a copy whose digest differs from the one a catalog
 * lists is an edited copy and is refused, never a silent variant.
 *
 * The four things a step is made of stay apart: the generic role (this catalog), the node's task and
 * contract (the graph), the project's additions (DSP-229's `<id>.project.json`), and the run.
 *
 * The index also carries `legacy`: how each role of the graphs before DSP-231 maps to a catalog role,
 * and the text that moved from that role into the task of the nodes that used it. One function,
 * {@link planRoleUpgrade}, applies that mapping, both to migrate DSpatch's bundled graphs and to offer
 * a person an upgrade of their own graph for review. It never writes anything. Pure: no file system.
 */
import type { LoopGraph, LoopNode, RequirementId, ResolvedRole, RoleReference } from './loop-graph';
import { EMPTY_SECTION, sectionIsEmpty, type InstructionSection, type ProjectInstructions } from './project-instructions';

export const ROLE_CATALOG_FORMAT = 'dspatch-role-catalog';
export const ROLE_CATALOG_FORMAT_VERSION = 1;
/** The file every catalog folder keeps its index in. */
export const ROLE_CATALOG_INDEX = 'catalog.json';
/** Where DSpatch's own catalog lives, relative to its resource root. */
export const DSPATCH_ROLE_CATALOG_DIR = 'docs/loop/roles/catalog';
/** Where a repository keeps its catalog roles: copies of shared ones and its own. */
export const PROJECT_ROLE_CATALOG_DIR = '.dspatch/roles';

export interface CatalogRoleVersion {
  readonly version: number;
  /** Relative to the catalog folder, with forward slashes. */
  readonly file: string;
  readonly sha256: string;
  /** For a project's own role made from another: `<id>@<version>`. */
  readonly derivedFrom?: string;
}

export interface CatalogRole {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Who published the role; defaults to the catalog's own origin. */
  readonly origin?: string;
  readonly versions: readonly CatalogRoleVersion[];
}

/** One target a legacy role maps to. */
export interface LegacyTarget {
  readonly role: string;
  readonly version: number;
  /** The target taken when nothing else decides. */
  readonly default?: boolean;
  /** When this target is the right one, for the person choosing. */
  readonly when?: string;
}

/** A role graphs used before DSP-231, and where it went. */
export interface LegacyRole {
  readonly id: string;
  readonly title: string;
  /** The files it was read from, with the digest of the text as DSpatch shipped it. */
  readonly sources: readonly { readonly path: string; readonly sha256: string }[];
  readonly to: readonly LegacyTarget[];
  /** Text that was in the role but is the node's contract: appended to the task of every node that used it. */
  readonly nodeTask?: string;
  /** Per node of a known graph, `<graph id>/<node id>`: which target. */
  readonly nodes?: Readonly<Record<string, string>>;
  readonly note?: string;
}

export interface RoleCatalogIndex {
  readonly format: typeof ROLE_CATALOG_FORMAT;
  readonly formatVersion: number;
  readonly origin: string;
  readonly note?: string;
  readonly roles: readonly CatalogRole[];
  readonly legacy?: readonly LegacyRole[];
}

export function emptyRoleCatalog(origin: string): RoleCatalogIndex {
  return { format: ROLE_CATALOG_FORMAT, formatVersion: ROLE_CATALOG_FORMAT_VERSION, origin, roles: [] };
}

/** Read a `catalog.json`, refusing what this build would misread. */
export function parseRoleCatalog(text: string): { readonly ok: true; readonly index: RoleCatalogIndex } | { readonly ok: false; readonly problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    return { ok: false, problem: `The role catalog index is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isRecord(raw) || raw['format'] !== ROLE_CATALOG_FORMAT) return { ok: false, problem: `A role catalog index has "format": "${ROLE_CATALOG_FORMAT}".` };
  const formatVersion = raw['formatVersion'];
  if (typeof formatVersion !== 'number' || formatVersion < 1 || formatVersion > ROLE_CATALOG_FORMAT_VERSION) {
    return { ok: false, problem: `The role catalog index has "formatVersion" ${JSON.stringify(formatVersion)}, which this build does not read.` };
  }
  const roles: CatalogRole[] = [];
  for (const entry of Array.isArray(raw['roles']) ? raw['roles'] : []) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string') continue;
    const versions: CatalogRoleVersion[] = [];
    for (const version of Array.isArray(entry['versions']) ? entry['versions'] : []) {
      if (!isRecord(version) || typeof version['version'] !== 'number' || typeof version['file'] !== 'string' || typeof version['sha256'] !== 'string') continue;
      versions.push({
        version: version['version'],
        file: version['file'],
        sha256: version['sha256'],
        ...(typeof version['derivedFrom'] === 'string' ? { derivedFrom: version['derivedFrom'] } : {}),
      });
    }
    roles.push({
      id: entry['id'],
      title: typeof entry['title'] === 'string' ? entry['title'] : entry['id'],
      summary: typeof entry['summary'] === 'string' ? entry['summary'] : '',
      ...(typeof entry['origin'] === 'string' ? { origin: entry['origin'] } : {}),
      versions: versions.sort((a, b) => a.version - b.version),
    });
  }
  const legacy = Array.isArray(raw['legacy']) ? (raw['legacy'].filter((entry) => isRecord(entry) && typeof entry['id'] === 'string') as unknown as LegacyRole[]) : undefined;
  return {
    ok: true,
    index: {
      format: ROLE_CATALOG_FORMAT,
      formatVersion,
      origin: typeof raw['origin'] === 'string' ? raw['origin'] : 'unknown',
      ...(typeof raw['note'] === 'string' ? { note: raw['note'] } : {}),
      roles,
      ...(legacy === undefined ? {} : { legacy }),
    },
  };
}

/** Written with roles and versions sorted, so a diff shows what was added. */
export function serialiseRoleCatalog(index: RoleCatalogIndex): string {
  const roles = [...index.roles]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((role) => ({ ...role, versions: [...role.versions].sort((a, b) => a.version - b.version) }));
  return `${JSON.stringify({ ...index, roles }, null, 2)}\n`;
}

/** The text a digest is taken over: a byte-order mark dropped and CRLF read as LF, so a checkout convention is not an edit. */
export function normaliseRoleText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

/** The version entry a catalog lists for `id@version`, with its role. */
export function catalogVersion(index: RoleCatalogIndex, id: string, version: number): { readonly role: CatalogRole; readonly entry: CatalogRoleVersion } | null {
  const role = index.roles.find((candidate) => candidate.id === id);
  const entry = role?.versions.find((candidate) => candidate.version === version);
  return role === undefined || entry === undefined ? null : { role, entry };
}

/** The newest version a catalog lists of a role. */
export function latestVersion(index: RoleCatalogIndex, id: string): number | null {
  const versions = index.roles.find((candidate) => candidate.id === id)?.versions ?? [];
  return versions.length === 0 ? null : Math.max(...versions.map((entry) => entry.version));
}

/** The file of `id@version` inside a catalog folder, with forward slashes. */
export function catalogFileFor(id: string, version: number): string {
  return `${id}/v${String(version)}.role.md`;
}

/** The reference a node writes for `id@version` kept at `catalogDir` (relative to the resource root). */
export function catalogReference(id: string, version: number, catalogDir: string): RoleReference {
  return { id, version, source: { kind: 'role-catalog', path: `${catalogDir.replace(/\/+$/, '')}/${catalogFileFor(id, version)}` } };
}

/** How a person reads a role's identity: "Implementer · implementer v1 · DSpatch catalog". */
export function roleIdentityLine(role: Pick<ResolvedRole, 'id' | 'title' | 'version' | 'origin' | 'catalog'>): string {
  if (role.version === undefined) return `${role.title ?? role.id} · ${role.id} · local role, not versioned`;
  const origin = role.origin === 'dspatch' ? 'DSpatch catalog' : role.origin === 'project' ? 'project role' : role.origin ?? 'unknown origin';
  return `${role.title ?? role.id} · ${role.id} v${String(role.version)} · ${origin}`;
}

// ---------------------------------------------------------------------------------------------
// The upgrade from legacy roles.

/** One node's mapping, as the person reviews it. */
export interface NodeRoleMapping {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly from: RoleReference;
  readonly to: RoleReference;
  /** The other targets the legacy role offers, for the person to choose instead. */
  readonly alternatives: readonly LegacyTarget[];
  /** Requirements the old role had and the new one does not: added to the node so the step keeps them. */
  readonly requirementsMovedToNode: readonly RequirementId[];
  /** Text appended to the node's task because it was the node's contract inside the old role. */
  readonly taskAddition: string;
  /** Why this mapping, in a line. */
  readonly reason: string;
}

/** What happens to one role-level project addition. */
export interface AdditionMove {
  readonly fromRole: string;
  /** `role`: kept as "All nodes with this role" of `toRole`; `nodes`: placed on each node it reached. */
  readonly kind: 'role' | 'nodes';
  readonly toRole?: string;
  readonly nodes?: readonly string[];
  /** Why, in a line; a `nodes` move is always explained, because it is the conflict case. */
  readonly reason: string;
}

export interface RoleUpgradePlan {
  readonly graph: LoopGraph;
  readonly instructions: ProjectInstructions | null;
  readonly mappings: readonly NodeRoleMapping[];
  readonly additions: readonly AdditionMove[];
  /** Roles left as they are, and why: unknown to the catalog, or edited after they were copied. */
  readonly kept: readonly { readonly nodeId: string; readonly roleId: string; readonly reason: string }[];
  /** Things the person has to look at: reach that would change, text that was merged. */
  readonly conflicts: readonly string[];
  /** The catalog roles the upgraded graph references, for copying into a repository. */
  readonly catalogRoles: readonly { readonly id: string; readonly version: number }[];
}

export interface RoleUpgradeInput {
  readonly graph: LoopGraph;
  readonly instructions: ProjectInstructions | null;
  readonly catalog: RoleCatalogIndex;
  /** Resolves a node's current role, to compare requirements and digests. */
  readonly resolve: (reference: RoleReference) => ResolvedRole | null;
  /** Where the new references point, relative to the graph's resource root. */
  readonly catalogDir: string;
  /** The template graph this one was made from, for the per-node mapping; defaults to the graph's id. */
  readonly templateGraphId?: string;
  /** The person's choice per node, overriding the mapping's own (`nodeId` → catalog role id). */
  readonly choices?: Readonly<Record<string, string>>;
  /** The resolved catalog roles, for their requirements. */
  readonly resolveCatalog: (id: string, version: number) => ResolvedRole | null;
}

/**
 * The upgrade of a graph whose nodes use legacy roles to catalog roles, for review; nothing is written.
 *
 * Kept invariant: every node's effective requirements (role ∪ node) and every node's reach of the
 * project's additions. Requirements the shared role does not carry move onto the node. A role's
 * additions move to the new role only when exactly the same nodes use the new role as used the old;
 * otherwise the reach would change, so they are placed on each node they reached and named as a
 * conflict the person can resolve by hand. A role whose copy was edited after it was made, or that
 * the catalog does not know, is kept, with the reason.
 */
export function planRoleUpgrade(input: RoleUpgradeInput): RoleUpgradePlan {
  const legacyById = new Map((input.catalog.legacy ?? []).map((entry) => [entry.id, entry]));
  const templateGraphId = input.templateGraphId ?? input.graph.id;
  const mappings: NodeRoleMapping[] = [];
  const kept: { nodeId: string; roleId: string; reason: string }[] = [];
  const conflicts: string[] = [];
  const nodes: LoopNode[] = [];
  for (const node of input.graph.nodes) {
    const reference = node.role;
    if (reference === undefined || reference.source.kind === 'role-catalog') {
      nodes.push(node);
      continue;
    }
    const legacy = legacyById.get(reference.id);
    if (legacy === undefined) {
      kept.push({ nodeId: node.id, roleId: reference.id, reason: 'the catalog has no mapping for this role; it stays a local role' });
      nodes.push(node);
      continue;
    }
    const current = input.resolve(reference);
    if (current !== null && current.sha256 !== undefined && !legacy.sources.some((source) => source.sha256 === current.sha256)) {
      kept.push({
        nodeId: node.id,
        roleId: reference.id,
        reason: 'its text differs from the role DSpatch shipped, so it was edited; upgrading would drop the edit. Keep it, or move the edit into the project additions first',
      });
      nodes.push(node);
      continue;
    }
    const chosen = input.choices?.[node.id] ?? legacy.nodes?.[`${templateGraphId}/${node.id}`] ?? (legacy.to.find((target) => target.default === true) ?? legacy.to[0])?.role;
    const target = legacy.to.find((candidate) => candidate.role === chosen) ?? legacy.to[0];
    if (target === undefined) {
      kept.push({ nodeId: node.id, roleId: reference.id, reason: 'the mapping names no target' });
      nodes.push(node);
      continue;
    }
    const to = catalogReference(target.role, target.version, input.catalogDir);
    const shared = input.resolveCatalog(target.role, target.version);
    const before = new Set<RequirementId>([...(current?.requirements ?? []), ...(node.requirements ?? [])]);
    const sharedRequirements = new Set<RequirementId>(shared?.requirements ?? []);
    const moved = [...(current?.requirements ?? [])].filter((requirement) => !sharedRequirements.has(requirement) && !(node.requirements ?? []).includes(requirement));
    const taskAddition = legacy.nodeTask?.trim() ?? '';
    const purpose = node.purpose?.trim() ?? '';
    const alreadyThere = taskAddition !== '' && purpose.includes(taskAddition);
    const requirements = [...(node.requirements ?? []), ...moved];
    const after = new Set<RequirementId>([...sharedRequirements, ...requirements]);
    if ([...before].some((requirement) => !after.has(requirement))) {
      conflicts.push(`${node.label ?? node.id}: a requirement would be lost; this is a fault in the mapping.`);
    }
    nodes.push({
      ...node,
      role: to,
      ...(requirements.length === 0 ? {} : { requirements }),
      ...(taskAddition === '' || alreadyThere ? {} : { purpose: purpose === '' ? taskAddition : `${purpose}\n\n${taskAddition}` }),
    });
    mappings.push({
      nodeId: node.id,
      nodeLabel: node.label ?? node.id,
      from: reference,
      to,
      alternatives: legacy.to.filter((candidate) => candidate.role !== target.role),
      requirementsMovedToNode: moved,
      taskAddition: alreadyThere ? '' : taskAddition,
      reason:
        legacy.nodes?.[`${templateGraphId}/${node.id}`] !== undefined
          ? `the catalog maps this step of ${templateGraphId} to ${target.role}`
          : input.choices?.[node.id] !== undefined
            ? 'your choice'
            : (target.when ?? legacy.note ?? `${legacy.title} is now ${target.role}`),
    });
  }
  const graph: LoopGraph = { ...input.graph, nodes };
  const { instructions, additions } = moveAdditions(input.graph, graph, input.instructions, conflicts);
  const catalogRoles = [
    ...new Map(
      graph.nodes.flatMap((node) => (node.role?.source.kind === 'role-catalog' && node.role.version !== undefined ? [[`${node.role.id}@${String(node.role.version)}`, { id: node.role.id, version: node.role.version }] as const] : [])),
    ).values(),
  ];
  return { graph, instructions, mappings, additions, kept, conflicts, catalogRoles };
}

/** The nodes using each role id, in a graph. */
export function nodesByRole(graph: Pick<LoopGraph, 'nodes'>): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.role === undefined) continue;
    map.set(node.role.id, [...(map.get(node.role.id) ?? []), node.id]);
  }
  return map;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function joinSections(a: InstructionSection, b: InstructionSection): InstructionSection {
  const text = [a.text.trim(), b.text.trim()].filter((part) => part !== '').join('\n\n');
  const documents = [...a.documents, ...b.documents.filter((document) => !a.documents.some((existing) => existing.path === document.path))];
  return { text, documents };
}

/**
 * Role additions keyed by the old role ids, moved so that each reaches exactly the nodes it reached.
 * Node-level additions follow the node id and are untouched.
 */
function moveAdditions(
  before: LoopGraph,
  after: LoopGraph,
  instructions: ProjectInstructions | null,
  conflicts: string[],
): { readonly instructions: ProjectInstructions | null; readonly additions: readonly AdditionMove[] } {
  if (instructions === null) return { instructions: null, additions: [] };
  const oldNodes = nodesByRole(before);
  const newNodes = nodesByRole(after);
  const roles: Record<string, InstructionSection> = {};
  const nodes: Record<string, InstructionSection> = { ...instructions.nodes };
  const additions: AdditionMove[] = [];
  // Roles whose id did not change keep their additions where they are.
  for (const [roleId, section] of Object.entries(instructions.roles)) {
    if (sectionIsEmpty(section)) continue;
    const reached = oldNodes.get(roleId) ?? [];
    const stillUsed = newNodes.get(roleId) ?? [];
    if (sameSet(reached, stillUsed)) {
      roles[roleId] = joinSections(roles[roleId] ?? EMPTY_SECTION, section);
      continue;
    }
    // Where did the nodes go? One new role used by exactly these nodes takes the addition whole.
    const targets = [...new Set(reached.map((nodeId) => after.nodes.find((node) => node.id === nodeId)?.role?.id).filter((id): id is string => id !== undefined))];
    const only = targets.length === 1 ? targets[0] : undefined;
    if (only !== undefined && sameSet(reached, newNodes.get(only) ?? []) && (instructions.roles[only] === undefined || sectionIsEmpty(instructions.roles[only]) || only === roleId)) {
      if (roles[only] !== undefined && !sectionIsEmpty(roles[only])) {
        conflicts.push(`The additions for ${roleId} and another role both move to ${only}; their texts are joined. Read the result.`);
      }
      roles[only] = joinSections(roles[only] ?? EMPTY_SECTION, section);
      additions.push({ fromRole: roleId, kind: 'role', toRole: only, reason: `${only} is used by exactly the steps that used ${roleId}` });
      continue;
    }
    for (const nodeId of reached) nodes[nodeId] = joinSections(nodes[nodeId] ?? EMPTY_SECTION, section);
    const why =
      targets.length > 1
        ? `the steps that used ${roleId} now use ${targets.join(' and ')}`
        : `${only ?? 'the new role'} is also used by steps that did not get these additions`;
    additions.push({ fromRole: roleId, kind: 'nodes', nodes: reached, reason: `${why}; placed on each of its steps so none gains or loses them` });
    conflicts.push(
      `The additions for all nodes with the role ${roleId} are placed on its ${String(reached.length)} step(s) one by one, because ${why}. ` +
        'Move them back to "All nodes with this role" if they should reach every step using the new role.',
    );
  }
  return { instructions: { ...instructions, roles, nodes }, additions };
}

/**
 * The role-level additions that reach no node of the graph any more, for example after a node's role
 * was changed: they are shown and handled explicitly rather than following the wrong role or vanishing.
 */
export function orphanedRoleAdditions(graph: Pick<LoopGraph, 'nodes'>, instructions: ProjectInstructions | null): readonly string[] {
  if (instructions === null) return [];
  const used = new Set(graph.nodes.flatMap((node) => (node.role === undefined ? [] : [node.role.id])));
  return Object.keys(instructions.roles).filter((id) => !used.has(id) && !sectionIsEmpty(instructions.roles[id]));
}

/** Whether a graph uses any role the catalog maps to a shared one, so an upgrade can be offered. */
export function legacyRolesIn(graph: Pick<LoopGraph, 'nodes'>, catalog: RoleCatalogIndex): readonly string[] {
  const legacy = new Set((catalog.legacy ?? []).map((entry) => entry.id));
  return [...new Set(graph.nodes.flatMap((node) => (node.role !== undefined && node.role.source.kind !== 'role-catalog' && legacy.has(node.role.id) ? [node.role.id] : [])))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
