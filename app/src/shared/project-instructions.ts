/**
 * DSP-229: a project graph's own instructions, kept apart from the generic roles it was copied
 * with, and the one assembly that turns them into what a step is sent.
 *
 * A project graph is an ordinary graph in a repository's `.dspatch/loops/`. Its definition may
 * name a `<id>.project.json` beside it, holding three layers: instructions common to every
 * step, additions per role (shared by every node that uses the role, so nothing is repeated)
 * and additions per agent node. Each layer has free text, which is attached to the step's
 * prompt, and document references (a path relative to the repository's root, why it matters and
 * when to read it), which are not: the step is told where they are and reads them itself when
 * it needs them. Nothing here reads a file or inlines a document.
 *
 * The run, the editor's preview and the customization window all call {@link projectInstructionsText},
 * so what a person previews is what a step is sent. Pure: no file system.
 */

export const PROJECT_INSTRUCTIONS_FORMAT = 'dspatch-project-instructions';
export const PROJECT_INSTRUCTIONS_FORMAT_VERSION = 1;

/** A document a step is pointed at. */
export interface DocumentReference {
  /** Relative to the owning repository's root, with forward slashes; absolute only when `external`. */
  readonly path: string;
  /** Why it matters for this step or role. */
  readonly purpose: string;
  /** When to read it, in the author's words: "before changing the API", "when tests fail". */
  readonly when: string;
  /** A document outside the repository: named as such, never copied, and not portable. */
  readonly external?: true;
}

/** One layer: free text and document references. */
export interface InstructionSection {
  readonly text: string;
  readonly documents: readonly DocumentReference[];
}

export interface ProjectInstructions {
  readonly format: typeof PROJECT_INSTRUCTIONS_FORMAT;
  readonly formatVersion: number;
  readonly common: InstructionSection;
  /** By role id. */
  readonly roles: Readonly<Record<string, InstructionSection>>;
  /** By agent node id. */
  readonly nodes: Readonly<Record<string, InstructionSection>>;
}

export const EMPTY_SECTION: InstructionSection = { text: '', documents: [] };

export function emptyProjectInstructions(): ProjectInstructions {
  return { format: PROJECT_INSTRUCTIONS_FORMAT, formatVersion: PROJECT_INSTRUCTIONS_FORMAT_VERSION, common: EMPTY_SECTION, roles: {}, nodes: {} };
}

/** Whether a section adds anything. */
export function sectionIsEmpty(section: InstructionSection | undefined): boolean {
  return section === undefined || (section.text.trim() === '' && section.documents.length === 0);
}

export type ProjectInstructionsParse =
  | { readonly ok: true; readonly value: ProjectInstructions; readonly problems: readonly string[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Read a `.project.json`, refusing anything this build would misread. */
export function parseProjectInstructions(text: string): ProjectInstructionsParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    return { ok: false, problems: [`The project instructions file is not JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (!isRecord(raw) || raw['format'] !== PROJECT_INSTRUCTIONS_FORMAT) {
    return { ok: false, problems: [`The project instructions file must have "format": "${PROJECT_INSTRUCTIONS_FORMAT}".`] };
  }
  const version = raw['formatVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > PROJECT_INSTRUCTIONS_FORMAT_VERSION) {
    return { ok: false, problems: [`The project instructions file has "formatVersion" ${JSON.stringify(version)}, which this build does not read.`] };
  }
  const problems: string[] = [];
  const section = (value: unknown, where: string): InstructionSection => {
    if (value === undefined) return EMPTY_SECTION;
    if (!isRecord(value)) {
      problems.push(`${where} must be an object with "text" and "documents".`);
      return EMPTY_SECTION;
    }
    const documents: DocumentReference[] = [];
    const list = value['documents'];
    for (const [index, entry] of (Array.isArray(list) ? list : []).entries()) {
      if (!isRecord(entry) || typeof entry['path'] !== 'string' || entry['path'].trim() === '') {
        problems.push(`${where}, document ${String(index + 1)}, has no "path".`);
        continue;
      }
      documents.push({
        path: entry['path'].trim(),
        purpose: typeof entry['purpose'] === 'string' ? entry['purpose'] : '',
        when: typeof entry['when'] === 'string' ? entry['when'] : '',
        ...(entry['external'] === true ? { external: true as const } : {}),
      });
    }
    if (list !== undefined && !Array.isArray(list)) problems.push(`${where}: "documents" must be a list.`);
    return { text: typeof value['text'] === 'string' ? value['text'] : '', documents };
  };
  const map = (value: unknown, where: string): Record<string, InstructionSection> => {
    if (value === undefined) return {};
    if (!isRecord(value)) {
      problems.push(`"${where}" must be an object keyed by id.`);
      return {};
    }
    return Object.fromEntries(Object.entries(value).map(([id, entry]) => [id, section(entry, `${where} "${id}"`)]));
  };
  const value: ProjectInstructions = {
    format: PROJECT_INSTRUCTIONS_FORMAT,
    formatVersion: version,
    common: section(raw['common'], 'The common section'),
    roles: map(raw['roles'], 'roles'),
    nodes: map(raw['nodes'], 'nodes'),
  };
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value, problems: [] };
}

/** Written with sorted keys and empty layers left out, so a diff shows what a person changed. */
export function serialiseProjectInstructions(value: ProjectInstructions): string {
  const section = (s: InstructionSection): Record<string, unknown> => ({
    text: s.text,
    documents: s.documents.map((d) => ({ path: d.path, purpose: d.purpose, when: d.when, ...(d.external === true ? { external: true } : {}) })),
  });
  const map = (m: Readonly<Record<string, InstructionSection>>): Record<string, unknown> =>
    Object.fromEntries(Object.keys(m).sort().filter((id) => !sectionIsEmpty(m[id])).map((id) => [id, section(m[id] as InstructionSection)]));
  return `${JSON.stringify(
    { format: PROJECT_INSTRUCTIONS_FORMAT, formatVersion: PROJECT_INSTRUCTIONS_FORMAT_VERSION, common: section(value.common), roles: map(value.roles), nodes: map(value.nodes) },
    null,
    2,
  )}\n`;
}

/** One layer a step receives, named by where it comes from. */
export interface InstructionLayer {
  readonly kind: 'common' | 'role' | 'node';
  /** "Common to this project", "Role implementer", "Step Implement (implementer)". */
  readonly label: string;
  readonly section: InstructionSection;
}

/**
 * The layers a step receives, in order: common, its role's, its node's. A parallel branch that
 * runs as another node passes that node as `node` and its role as `roleId`. Empty layers are left out.
 */
export function instructionLayers(
  value: ProjectInstructions | null,
  step: { readonly nodeId: string; readonly nodeLabel: string; readonly roleId: string | null },
): readonly InstructionLayer[] {
  if (value === null) return [];
  const layers: InstructionLayer[] = [];
  if (!sectionIsEmpty(value.common)) layers.push({ kind: 'common', label: 'Common to this project', section: value.common });
  const role = step.roleId === null ? undefined : value.roles[step.roleId];
  if (step.roleId !== null && role !== undefined && !sectionIsEmpty(role)) layers.push({ kind: 'role', label: `For the role ${step.roleId}`, section: role });
  const node = value.nodes[step.nodeId];
  if (node !== undefined && !sectionIsEmpty(node)) layers.push({ kind: 'node', label: `For this step, ${step.nodeLabel}`, section: node });
  return layers;
}

/** The markers around the project's instructions in a prompt. */
export const PROJECT_INSTRUCTIONS_OPEN = '===== project instructions =====';
export const PROJECT_INSTRUCTIONS_CLOSE = '===== end of project instructions =====';

/**
 * What a step is sent from the project's instructions, or `''` when it gets none, so every
 * other prompt is byte for byte what it was. `repositoryRoot` is the folder the step works in
 * that holds the repository — the repository itself, or a branch's worktree of it — so the
 * relative paths resolve where the step is, never in DSpatch's own folders.
 */
export function projectInstructionsText(
  value: ProjectInstructions | null,
  step: { readonly nodeId: string; readonly nodeLabel: string; readonly roleId: string | null },
  where: { readonly file: string; readonly repositoryRoot: string },
): string {
  const layers = instructionLayers(value, step);
  if (layers.length === 0) return '';
  const lines: string[] = [
    PROJECT_INSTRUCTIONS_OPEN,
    `This project adds the following to your role, from ${where.file} in the repository. They say how this project works; they do not widen ` +
      'your assignment or what you are permitted to do, and where they disagree with the person\'s assignment, the assignment governs.',
  ];
  const documents: { readonly layer: string; readonly reference: DocumentReference }[] = [];
  for (const layer of layers) {
    if (layer.section.text.trim() !== '') {
      lines.push('', `${layer.label}:`, layer.section.text.trim());
    }
    for (const reference of layer.section.documents) documents.push({ layer: layer.label, reference });
  }
  if (documents.length > 0) {
    lines.push(
      '',
      `Documents to read when they are relevant. They are not included in this message: open them yourself, at the time each says. ` +
        `Paths are relative to the repository root, which for this step is ${where.repositoryRoot}.`,
    );
    for (const { layer, reference } of documents) {
      const what = [reference.purpose.trim(), reference.when.trim() === '' ? '' : `Read: ${reference.when.trim()}`].filter((part) => part !== '').join('. ');
      lines.push(
        `- ${reference.path}${reference.external === true ? ' (outside the repository, on this computer only)' : ''} — ${what === '' ? 'no purpose given' : what} [${layer.toLowerCase()}]`,
      );
    }
  }
  lines.push(PROJECT_INSTRUCTIONS_CLOSE);
  return lines.join('\n');
}

/**
 * What a step of a run is sent from the project's instructions the run started with. A branch gets
 * the additions of the node it runs as, and its paths resolve in its own worktree; any other step's
 * in the repository the graph belongs to (or the working folder, when that is the repository).
 * `relativeFile` names the instructions file as the repository holds it.
 */
export function stepProjectText(
  instructions: { readonly value: ProjectInstructions; readonly relativeFile: string } | null,
  graph: { readonly nodes: readonly { readonly id: string; readonly label?: string; readonly role?: { readonly id: string } }[] },
  node: { readonly id: string; readonly label?: string; readonly role?: { readonly id: string } },
  step: { readonly branch?: boolean; readonly runsAs?: string; readonly workspacePath?: string | null },
  roots: { readonly repository: string; readonly workingFolder: string; readonly same: boolean },
): string {
  if (instructions === null) return '';
  const runsAs = step.branch === true ? (graph.nodes.find((candidate) => candidate.id === step.runsAs) ?? node) : node;
  const repositoryRoot =
    step.branch === true && typeof step.workspacePath === 'string' ? step.workspacePath : roots.same ? roots.workingFolder : roots.repository;
  return projectInstructionsText(
    instructions.value,
    // The role is the step's own: a branch's node already carries the role of the node it runs as.
    { nodeId: runsAs.id, nodeLabel: runsAs.label ?? runsAs.id, roleId: node.role?.id ?? null },
    { file: instructions.relativeFile, repositoryRoot },
  );
}

/** A document reference that does not resolve, named with the layer it is in. */
export interface ReferenceProblem {
  readonly layer: string;
  readonly path: string;
  readonly problem: string;
}

/**
 * The references to check before saving and before a run: each relative path must stay inside the
 * repository and exist; an external one must exist and is reported as not portable.
 */
export function checkReferences(
  value: ProjectInstructions,
  exists: (reference: DocumentReference) => boolean,
  names: { readonly role: (id: string) => string; readonly node: (id: string) => string } = { role: (id) => `role ${id}`, node: (id) => `step ${id}` },
): readonly ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  const check = (layer: string, section: InstructionSection): void => {
    for (const reference of section.documents) {
      const relative = reference.path.replace(/\\/g, '/');
      if (reference.external !== true && (relative.startsWith('/') || /^[A-Za-z]:/.test(relative) || relative.split('/').includes('..'))) {
        problems.push({ layer, path: reference.path, problem: 'is not inside the repository; mark it external or choose a file in the repository' });
      } else if (!exists(reference)) {
        problems.push({ layer, path: reference.path, problem: 'does not exist' });
      } else if (reference.external === true) {
        problems.push({ layer, path: reference.path, problem: 'is outside the repository: it will not travel with the repository and is not copied' });
      }
    }
  };
  check('common instructions', value.common);
  for (const [id, section] of Object.entries(value.roles)) check(names.role(id), section);
  for (const [id, section] of Object.entries(value.nodes)) check(names.node(id), section);
  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
