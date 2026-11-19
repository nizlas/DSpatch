/**
 * DSP-229: asking the workspace's agent which project instructions and documents fit a graph's
 * roles and steps, and reading its answer as proposals the person reviews one by one.
 *
 * The agent reads the repository and changes nothing (the analysis permission, read-only). "For
 * all" inventories the repository once; the inventory is kept by the window and handed to every
 * later "for this role" and "for this step", which are told to use it rather than read the whole
 * project again. Nothing here writes a file or touches what the person has typed: a proposal is
 * applied only when the person takes it. Pure: prompt and parser only.
 */
import type { DocumentReference, ProjectInstructions } from './project-instructions';

/** A marker the simulated adapter recognises; harmless to a real one. */
export const RECOMMENDATION_MARKER = 'DSPATCH-PROJECT-INSTRUCTION-RECOMMENDATIONS';

export type RecommendationTarget = { readonly kind: 'all' } | { readonly kind: 'role'; readonly roleId: string } | { readonly kind: 'node'; readonly nodeId: string };

/** What the window knows of the graph, enough to say what each role and step is for. */
export interface GraphOutline {
  readonly name: string;
  /** DSP-231: a catalog role's version and origin, so a person sees which shared definition it is. */
  readonly roles: readonly { readonly id: string; readonly title: string; readonly summary: string; readonly version?: number; readonly origin?: string }[];
  readonly nodes: readonly { readonly id: string; readonly label: string; readonly roleId: string | null; readonly purpose: string }[];
}

export interface InventoryEntry {
  readonly path: string;
  readonly why: string;
}

export interface Inventory {
  readonly governing: readonly InventoryEntry[];
  readonly agentDefinitions: readonly InventoryEntry[];
  readonly history: readonly InventoryEntry[];
  readonly examples: readonly InventoryEntry[];
}

export interface RecommendedDocument extends DocumentReference {
  readonly why: string;
}

/** One proposal for one section: text to add and documents to reference, each with its reason. */
export interface Recommendation {
  /** `common`, `role:<id>` or `node:<id>`. */
  readonly target: string;
  readonly text: string;
  readonly textWhy: string;
  readonly documents: readonly RecommendedDocument[];
}

export interface RecommendationAnswer {
  readonly inventory: Inventory;
  readonly recommendations: readonly Recommendation[];
  readonly missing: readonly string[];
  readonly conflicts: readonly string[];
  readonly uncertain: readonly string[];
}

/** The target keys a request may answer for. */
export function targetKeys(outline: GraphOutline, target: RecommendationTarget): readonly string[] {
  if (target.kind === 'role') return [`role:${target.roleId}`];
  if (target.kind === 'node') return [`node:${target.nodeId}`];
  return ['common', ...outline.roles.map((role) => `role:${role.id}`), ...outline.nodes.map((node) => `node:${node.id}`)];
}

export function recommendationPrompt(input: {
  readonly outline: GraphOutline;
  readonly target: RecommendationTarget;
  readonly current: ProjectInstructions;
  /** The inventory an earlier request of this window made, as JSON, or `null` to make one. */
  readonly inventory: string | null;
}): string {
  const { outline, target, current } = input;
  const keys = targetKeys(outline, target);
  const roleIds = new Set(
    target.kind === 'all'
      ? outline.roles.map((role) => role.id)
      : target.kind === 'role'
        ? [target.roleId]
        : outline.nodes.filter((node) => node.id === target.nodeId).flatMap((node) => (node.roleId === null ? [] : [node.roleId])),
  );
  const nodes = outline.nodes.filter((node) =>
    target.kind === 'all' ? true : target.kind === 'role' ? node.roleId === target.roleId : node.id === target.nodeId,
  );
  const section = (key: string): string => {
    const value = key === 'common' ? current.common : key.startsWith('role:') ? current.roles[key.slice(5)] : current.nodes[key.slice(5)];
    if (value === undefined || (value.text.trim() === '' && value.documents.length === 0)) return `- ${key}: nothing yet`;
    return `- ${key}: text ${JSON.stringify(value.text)}; documents ${JSON.stringify(value.documents.map((d) => d.path))}`;
  };
  return [
    RECOMMENDATION_MARKER,
    '',
    `You are helping fit a generic agent workflow, "${outline.name}", to the repository you are in. Read what you need; change no file, ` +
      'run nothing that writes, and do not commit. Your answer is a proposal a person reviews item by item.',
    '',
    input.inventory === null
      ? 'First inventory the repository\'s own instructions: instruction files such as AGENTS.md, CLAUDE.md, .cursor/rules or ' +
        '.github/copilot-instructions.md wherever they are, agent or role definitions, and documents they refer to, followed as far as they ' +
        'are relevant (they may be in docs/, at the root or elsewhere). Tell governing documents (rules and decisions that apply now) apart ' +
        'from history (old plans, reports, logs) and examples.'
      : `An inventory made earlier in this window is below. Use it; do not inventory the whole repository again. Open only what this ` +
        `target needs.\n\n${input.inventory}`,
    '',
    'The workflow\'s roles and steps, with what each is responsible for:',
    ...outline.roles.filter((role) => roleIds.has(role.id)).map((role) => `- role ${role.id} (${role.title}): ${role.summary}`),
    ...nodes.map((node) => `- step ${node.id} "${node.label}"${node.roleId === null ? '' : `, role ${node.roleId}`}: ${node.purpose}`),
    '',
    'What the project has written for them so far, which you must not repeat:',
    ...keys.map(section),
    '',
    `Recommend, for ${keys.length === 1 ? keys[0] : `each of ${keys.join(', ')}`}, only what that target's actual responsibility needs: ` +
      'a short addition to its instructions and the documents it should be pointed at, each with why and when to read it. Put what every ' +
      'step needs under "common" once, never again under a role or step; put what every step of a role needs under that role. Leave a target ' +
      'out when it needs nothing. Name missing information, conflicts between documents, and anything you are unsure of.',
    '',
    'Answer with exactly one fenced block whose info string is json, in this form, paths relative to the repository root:',
    '```json',
    JSON.stringify(
      {
        inventory: { governing: [{ path: 'AGENTS.md', why: '...' }], agentDefinitions: [], history: [], examples: [] },
        recommendations: [{ target: keys[0], text: '...', textWhy: '...', documents: [{ path: 'docs/ARCHITECTURE.md', purpose: '...', when: '...', why: '...' }] }],
        missing: ['...'],
        conflicts: ['...'],
        uncertain: ['...'],
      },
      null,
      2,
    ),
    '```',
  ].join('\n');
}

/** Read the agent's answer, keeping only targets that were asked for and well-formed entries. */
export function parseRecommendations(
  text: string,
  allowed: readonly string[],
): { readonly ok: true; readonly answer: RecommendationAnswer; readonly dropped: readonly string[] } | { readonly ok: false; readonly problem: string } {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const body = blocks[blocks.length - 1]?.[1];
  if (body === undefined) return { ok: false, problem: 'The agent\'s answer had no json block, so there is nothing to propose.' };
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    return { ok: false, problem: `The agent's json block does not parse: ${error instanceof Error ? error.message : String(error)}` };
  }
  const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []);
  const entries = (value: unknown): InventoryEntry[] =>
    (Array.isArray(value) ? value : []).flatMap((item) => {
      const entry = record(item);
      return typeof entry['path'] === 'string' ? [{ path: entry['path'], why: typeof entry['why'] === 'string' ? entry['why'] : '' }] : [];
    });
  const root = record(raw);
  const inventory = record(root['inventory']);
  const dropped: string[] = [];
  const recommendations: Recommendation[] = [];
  for (const item of Array.isArray(root['recommendations']) ? root['recommendations'] : []) {
    const entry = record(item);
    const target = typeof entry['target'] === 'string' ? entry['target'] : '';
    if (!allowed.includes(target)) {
      dropped.push(target === '' ? 'a recommendation without a target' : `${target}, which was not asked for`);
      continue;
    }
    const documents: RecommendedDocument[] = (Array.isArray(entry['documents']) ? entry['documents'] : []).flatMap((doc) => {
      const d = record(doc);
      const docPath = typeof d['path'] === 'string' ? d['path'].trim().replace(/^\.\//, '') : '';
      if (docPath === '' || docPath.startsWith('/') || /^[A-Za-z]:/.test(docPath) || docPath.split('/').includes('..')) {
        if (docPath !== '') dropped.push(`${target}: ${docPath}, which is not a path in the repository`);
        return [];
      }
      return [{ path: docPath, purpose: str(d['purpose']), when: str(d['when']), why: str(d['why']) }];
    });
    recommendations.push({ target, text: str(entry['text']), textWhy: str(entry['textWhy']), documents });
  }
  return {
    ok: true,
    answer: {
      inventory: {
        governing: entries(inventory['governing']),
        agentDefinitions: entries(inventory['agentDefinitions']),
        history: entries(inventory['history']),
        examples: entries(inventory['examples']),
      },
      recommendations,
      missing: strings(root['missing']),
      conflicts: strings(root['conflicts']),
      uncertain: strings(root['uncertain']),
    },
    dropped,
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
