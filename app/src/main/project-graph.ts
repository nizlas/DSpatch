/**
 * DSP-229: applying a bundled graph to a repository, and keeping the project graph afterwards.
 *
 * A project graph is an ordinary loop definition in the repository's own `.dspatch/loops/`:
 *
 *   .dspatch/loops/<id>.loop.json        the definition, with `origin` and `projectInstructions`
 *   .dspatch/loops/<id>.graph.json       the template's graph, its role paths pointing at the copies
 *   .dspatch/loops/<id>.project.json     the project's instructions (common, per role, per node)
 *   .dspatch/roles/<role>/v<n>.role.md   DSP-231: the shared catalog roles the graph uses, copied with
 *                                        their identity, version and digest (one copy per repository)
 *   .dspatch/loops/roles/<id>/*.role.md  a template's local, unversioned role sources, copied as they were
 *
 * Everything is relative to the repository, so it travels with it and goes through Git like any
 * other file; nothing here commits. The definition is written last, and discovery reads only
 * definitions, so a save that fails part-way leaves nothing the chooser offers as runnable; the
 * files it had written are removed. No existing file is ever replaced by an apply, and a save of
 * the instructions is refused when the file changed on disk since it was read.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { LOOP_DEFINITION_FORMAT, LOOP_DEFINITION_FORMAT_VERSION, type ProjectGraphOrigin } from '../shared/loop-definition';
import type { LoopGraph, RoleReference } from '../shared/loop-graph';
import { referencedRoles } from '../shared/loop-graph-editing';
import { parseLoopGraph } from '../shared/loop-graph-load';
import { serialiseLoopGraph } from '../shared/loop-graph-write';
import {
  checkReferences,
  emptyProjectInstructions,
  parseProjectInstructions,
  serialiseProjectInstructions,
  type ProjectInstructions,
  type ReferenceProblem,
} from '../shared/project-instructions';
import { loopDefinitionDirFor, type LoopDefinitionRow } from './loop-definition-files';
import { planCatalogCopies, roleDigest } from './role-catalog-files';
import { catalogFileFor, PROJECT_ROLE_CATALOG_DIR } from '../shared/role-catalog';

/** Lower case, digits and hyphens: a file name on every platform. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A file an apply or a save will write, said before anything is written. */
export interface PlannedFile {
  readonly path: string;
  /** Relative to the repository, for the person. */
  readonly relative: string;
  readonly action: 'create' | 'change';
  readonly what: string;
  readonly text: string;
}

export interface ProjectGraphPlan {
  readonly repository: string;
  readonly id: string;
  readonly definitionPath: string;
  readonly files: readonly PlannedFile[];
  readonly graph: LoopGraph;
  readonly origin: ProjectGraphOrigin;
}

/** The repository-relative path, with forward slashes. */
function relativeTo(repository: string, file: string): string {
  return path.relative(repository, file).split(path.sep).join('/');
}

/** An id from a name: "Our workflow" → "our-workflow". */
export function projectGraphIdFor(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63) || 'project-graph'
  );
}

/**
 * What applying `template` to `repository` as `name` would write, or why it cannot: the template
 * must load and its roles must resolve; the repository must be one of the workspace's folders;
 * no file may exist yet.
 */
export function planProjectGraph(input: {
  readonly template: LoopDefinitionRow;
  readonly repository: string;
  readonly workspaceFolders: readonly string[];
  readonly name: string;
  readonly appVersion: string;
  readonly instructions?: ProjectInstructions;
  readonly now?: () => Date;
}): { readonly ok: true; readonly plan: ProjectGraphPlan } | { readonly ok: false; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const name = input.name.trim();
  const id = projectGraphIdFor(name);
  const repository = path.resolve(input.repository);
  if (name === '') problems.push('Give the project graph a name.');
  if (!SLUG.test(id)) problems.push(`"${name}" does not make a usable file name.`);
  if (!input.workspaceFolders.some((folder) => path.resolve(folder) === repository)) {
    problems.push(`${repository} is not a folder of this workspace. Add it to the workspace first.`);
  }
  const template = input.template.definition;
  if (template === null || input.template.graphPath === null || input.template.resourceRoot === null) {
    return { ok: false, problems: [...problems, 'The template does not load, so it cannot be applied.'] };
  }
  let templateText: string;
  try {
    templateText = fs.readFileSync(input.template.graphPath, 'utf8');
  } catch {
    return { ok: false, problems: [...problems, `The template's graph ${input.template.graphPath} cannot be read.`] };
  }
  const parsed = parseLoopGraph(templateText);
  if (!parsed.ok) {
    return { ok: false, problems: [...problems, 'The template\'s graph does not read as a graph.'] };
  }
  const loops = loopDefinitionDirFor(repository);
  const roleDir = path.join(loops, 'roles', id);
  const files: PlannedFile[] = [];
  const copies: { id: string; from: string; to: string; sha256: string; version?: number }[] = [];
  const rewritten = new Map<string, string>();
  const takenNames = new Set<string>();
  // DSP-231: catalog roles go to the repository's own catalog, by identity and version, and are
  // shared by every project graph in it; an identical copy already there is reused, another is a
  // conflict. Project additions stay in <id>.project.json, apart from the roles.
  const catalogRoles = referencedRoles(parsed.graph).filter((reference) => reference.source.kind === 'role-catalog' && reference.version !== undefined);
  const catalogDir = path.join(repository, PROJECT_ROLE_CATALOG_DIR);
  const copies_ = planCatalogCopies(
    catalogDir,
    catalogRoles.map((reference) => ({ id: reference.id, version: reference.version as number, sourceFile: path.resolve(input.template.resourceRoot as string, reference.source.path) })),
  );
  problems.push(...copies_.problems);
  for (const file of copies_.files) {
    files.push({ path: file.path, relative: relativeTo(repository, file.path), action: fs.existsSync(file.path) ? 'change' : 'create', what: file.what, text: file.text });
  }
  const catalogCopies = new Set(copies_.files.map((file) => file.path));
  for (const reference of catalogRoles) {
    const target = path.join(catalogDir, catalogFileFor(reference.id, reference.version as number));
    const to = relativeTo(repository, target);
    rewritten.set(reference.source.path, to);
    let text = '';
    try {
      text = fs.readFileSync(path.resolve(input.template.resourceRoot, reference.source.path), 'utf8');
    } catch {
      text = '';
    }
    copies.push({ id: reference.id, version: reference.version as number, from: reference.source.path, to, sha256: roleDigest(text) });
  }
  for (const reference of referencedRoles(parsed.graph)) {
    if (rewritten.has(reference.source.path)) continue;
    const source = path.resolve(input.template.resourceRoot, reference.source.path);
    let text: string;
    try {
      text = fs.readFileSync(source, 'utf8');
    } catch {
      problems.push(`The role "${reference.id}" (${reference.source.path}) of the template cannot be read.`);
      continue;
    }
    let base = path.basename(reference.source.path);
    for (let n = 2; takenNames.has(base); n += 1) base = `${String(n)}-${path.basename(reference.source.path)}`;
    takenNames.add(base);
    const target = path.join(roleDir, base);
    const to = relativeTo(repository, target);
    rewritten.set(reference.source.path, to);
    copies.push({ id: reference.id, from: reference.source.path, to, sha256: sha256(text) });
    files.push({ path: target, relative: to, action: 'create', what: `the generic role ${reference.id}, copied as it is in this version`, text });
  }
  const retarget = (role: RoleReference | undefined): RoleReference | undefined =>
    role === undefined ? undefined : { ...role, source: { ...role.source, path: rewritten.get(role.source.path) ?? role.source.path } };
  const graph: LoopGraph = {
    ...parsed.graph,
    id,
    name,
    nodes: parsed.graph.nodes.map((node) => (node.role === undefined ? node : { ...node, role: retarget(node.role) as RoleReference })),
  };
  const origin: ProjectGraphOrigin = {
    templateId: template.id,
    templateName: template.name,
    templateGraphId: parsed.graph.id,
    appVersion: input.appVersion,
    graphSha256: sha256(templateText),
    roles: copies,
    appliedAtUtc: (input.now?.() ?? new Date()).toISOString(),
  };
  const graphPath = path.join(loops, `${id}.graph.json`);
  const instructionsPath = path.join(loops, `${id}.project.json`);
  const definitionPath = path.join(loops, `${id}.loop.json`);
  files.push({ path: graphPath, relative: relativeTo(repository, graphPath), action: 'create', what: `the graph, from ${template.name}`, text: serialiseLoopGraph(graph) });
  files.push({
    path: instructionsPath,
    relative: relativeTo(repository, instructionsPath),
    action: 'create',
    what: 'the project\'s instructions: common, per role and per step',
    text: serialiseProjectInstructions(input.instructions ?? emptyProjectInstructions()),
  });
  const definition = {
    format: LOOP_DEFINITION_FORMAT,
    formatVersion: LOOP_DEFINITION_FORMAT_VERSION,
    id,
    name,
    description: `${name}: a project graph applied from ${template.name} (DSpatch ${input.appVersion}).`,
    resourceRoot: '../..',
    resourceRootNote: 'The repository this graph belongs to.',
    graph: relativeTo(repository, graphPath),
    projectInstructions: `${id}.project.json`,
    origin,
  };
  files.push({ path: definitionPath, relative: relativeTo(repository, definitionPath), action: 'create', what: 'the definition, written last', text: `${JSON.stringify(definition, null, 2)}\n` });
  for (const file of files) {
    // The repository's role catalog index is extended, not replaced: it lists every copy.
    if (file.action === 'change' && catalogCopies.has(file.path)) continue;
    if (fs.existsSync(file.path)) problems.push(`${file.relative} exists already, and an apply never replaces a file. Choose another name.`);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, plan: { repository, id, definitionPath, files, graph, origin } };
}

/** Write one file whole: to a temporary name beside it, then renamed into place. */
function writeWhole(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, file);
}

/**
 * Write a plan. The definition is last; on any failure every file this call created is removed,
 * so nothing is left that the chooser would offer, and the reason is returned.
 */
export function writeProjectGraph(
  plan: ProjectGraphPlan,
  io: { readonly write?: (file: string, text: string) => void } = {},
): { readonly ok: true; readonly written: readonly string[] } | { readonly ok: false; readonly problem: string } {
  const write = io.write ?? writeWhole;
  const created: string[] = [];
  // DSP-231: the one file an apply may change is the repository's role catalog index; it is put back as it was on failure.
  const changed: { readonly path: string; readonly before: string }[] = [];
  const ordered = [...plan.files.filter((file) => file.path !== plan.definitionPath), ...plan.files.filter((file) => file.path === plan.definitionPath)];
  try {
    for (const file of ordered) {
      if (file.action === 'change') {
        changed.push({ path: file.path, before: fs.readFileSync(file.path, 'utf8') });
        write(file.path, file.text);
        continue;
      }
      if (fs.existsSync(file.path)) throw new Error(`${file.relative} appeared while saving; nothing is replaced.`);
      write(file.path, file.text);
      created.push(file.path);
    }
    return { ok: true, written: [...created, ...changed.map((file) => file.path)] };
  } catch (error) {
    for (const file of changed) {
      try {
        write(file.path, file.before);
      } catch {
        // Best effort, as below.
      }
    }
    for (const file of created.reverse()) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Best effort; the definition is the last file, so none of these is offered as runnable.
      }
    }
    return { ok: false, problem: `Nothing was kept: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** A project graph as the customization window reads it. */
export interface ProjectGraphReading {
  readonly repository: string;
  readonly definitionPath: string;
  readonly instructionsPath: string;
  readonly instructions: ProjectInstructions;
  /** Of the file as read, for the save's check; `null` when the file does not exist yet. */
  readonly instructionsSha256: string | null;
  readonly origin: ProjectGraphOrigin | null;
  readonly problems: readonly string[];
}

/** Read a project graph's instructions, or say why it has none. */
export function readProjectGraph(row: LoopDefinitionRow): ProjectGraphReading | { readonly problem: string } {
  const definition = row.definition;
  if (definition === null || row.resourceRoot === null) return { problem: 'This graph does not load.' };
  if (definition.projectInstructions === undefined) return { problem: 'This graph has no project instructions file. Apply a built-in graph to the repository to make one.' };
  const instructionsPath = path.resolve(path.dirname(row.filePath), definition.projectInstructions);
  let text: string | null = null;
  try {
    text = fs.readFileSync(instructionsPath, 'utf8');
  } catch {
    text = null;
  }
  const parsed = text === null ? null : parseProjectInstructions(text);
  return {
    repository: row.resourceRoot,
    definitionPath: row.filePath,
    instructionsPath,
    instructions: parsed?.ok === true ? parsed.value : emptyProjectInstructions(),
    instructionsSha256: text === null ? null : sha256(text),
    origin: definition.origin ?? null,
    problems: text === null ? ['The project instructions file is missing; saving creates it.'] : parsed?.ok === false ? parsed.problems : [],
  };
}

/** Whether a reference resolves, relative to the repository or, when external, as written. */
export function referenceExists(repository: string, reference: { readonly path: string; readonly external?: true }): boolean {
  try {
    return fs.statSync(reference.external === true ? reference.path : path.resolve(repository, reference.path)).isFile();
  } catch {
    return false;
  }
}

/** The references that do not resolve, named by step and role for the person. */
export function referenceProblems(repository: string, instructions: ProjectInstructions, graph: LoopGraph | null): readonly ReferenceProblem[] {
  const label = (id: string): string => graph?.nodes.find((node) => node.id === id)?.label ?? id;
  return checkReferences(instructions, (reference) => referenceExists(repository, reference), {
    role: (id) => `role ${id}`,
    node: (id) => `step ${label(id)} (${id})`,
  });
}

/**
 * Save the instructions of an existing project graph: refused when the file changed on disk since
 * `expectedSha256` was read, or when a node or role named in it is not in the graph.
 */
export function saveProjectInstructions(input: {
  readonly reading: Pick<ProjectGraphReading, 'instructionsPath' | 'instructionsSha256'>;
  readonly instructions: ProjectInstructions;
  readonly graph: LoopGraph | null;
}): { readonly ok: true; readonly sha256: string } | { readonly ok: false; readonly problem: string } {
  let now: string | null = null;
  try {
    now = fs.readFileSync(input.reading.instructionsPath, 'utf8');
  } catch {
    now = null;
  }
  if ((now === null ? null : sha256(now)) !== input.reading.instructionsSha256) {
    return { ok: false, problem: `${path.basename(input.reading.instructionsPath)} was changed outside this window since it was opened. Nothing was saved: reopen it to see the change.` };
  }
  if (input.graph !== null) {
    const nodes = new Set(input.graph.nodes.map((node) => node.id));
    const roles = new Set(input.graph.nodes.flatMap((node) => (node.role === undefined ? [] : [node.role.id])));
    const strays = [
      ...Object.keys(input.instructions.nodes).filter((id) => !nodes.has(id)).map((id) => `step ${id}`),
      ...Object.keys(input.instructions.roles).filter((id) => !roles.has(id)).map((id) => `role ${id}`),
    ];
    if (strays.length > 0) return { ok: false, problem: `These are not in the graph: ${strays.join(', ')}. Nothing was saved.` };
  }
  const text = serialiseProjectInstructions(input.instructions);
  writeWhole(input.reading.instructionsPath, text);
  return { ok: true, sha256: sha256(text) };
}

/** The project instructions a run starts with, read once, or `null` for a graph without any. */
export function projectInstructionsForRun(row: Pick<LoopDefinitionRow, 'filePath' | 'definition'>): { readonly value: ProjectInstructions; readonly file: string } | null {
  const relative = row.definition?.projectInstructions;
  if (relative === undefined) return null;
  const file = path.resolve(path.dirname(row.filePath), relative);
  try {
    const parsed = parseProjectInstructions(fs.readFileSync(file, 'utf8'));
    return parsed.ok ? { value: parsed.value, file } : null;
  } catch {
    return null;
  }
}

