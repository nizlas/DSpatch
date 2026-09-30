/**
 * Reaching the role a graph node points at, on this machine, today.
 *
 * A graph node references its role and never contains it, which leaves the question of
 * what a reference resolves to. Today the answer is a Cursor file: a project agent under
 * `.cursor/agents/`, or the coordinator skill under `.cursor/skills/`. Tomorrow — DSP-23
 * — the answer will be a provider-neutral role source that these files are *generated
 * from*, and this module is where that change lands. The graph format does not change
 * with it, which is the point of keeping resolution behind {@link RoleResolver}.
 *
 * **Two things here are inference and are labelled as such in what they return.**
 *
 * *Which frameworks the role supports.* No role file declares that yet, so a file under
 * `.cursor/` is taken to support Cursor and nothing else. That is a reading of what the
 * file *is*, not of what it says, so `targetsDeclared` is false and validation reports
 * the inference rather than presenting it as read.
 *
 * *What the role requires.* This reads Cursor's own fields — `readonly`, `is_background`,
 * `model` — and translates them back into portable requirements. That is the wrong
 * direction: DSP-23's rule is that a role states the requirement and the target supplies
 * the mechanism. Until the role sources exist there is nothing else to read, so
 * `requirementsDeclared` is false and says so.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { RequirementId, ResolvedRole, RoleReference, RoleResolver } from '../shared/loop-graph';
import { parseRoleSource, sectionBodies } from './role-source';

/**
 * Resolve role references against a **resource root**.
 *
 * The root is the one the definition names — its own folder unless it says otherwise —
 * and not the folder the agent is working in. Those were the same thing while DSpatch
 * had one folder, and taking the working folder as the anchor was the defect DSP-69
 * names: a graph carried from one project to another looked for its roles inside the
 * project it was pointed at and found nothing.
 *
 * A path that climbs out of the resource root is refused: a graph is a file that may be
 * shared, and a role reference is not a way to read arbitrary parts of the machine that
 * opens it. The root is a **read** anchor. Nothing is written under it.
 */
export function createFileRoleResolver(resourceRoot: string): RoleResolver {
  const root = path.resolve(resourceRoot);
  const cache = new Map<string, ResolvedRole | null>();

  return (reference: RoleReference): ResolvedRole | null => {
    const key = `${reference.source.kind}\u0000${reference.source.path}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = resolveOnce(root, reference);
    cache.set(key, resolved);
    return resolved;
  };
}

function resolveOnce(root: string, reference: RoleReference): ResolvedRole | null {
  const requested = path.resolve(root, reference.source.path);
  const relative = path.relative(root, requested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    // Outside the resource root. Treated as unresolvable rather than read.
    return null;
  }

  let text: string;
  try {
    text = fs.readFileSync(requested, 'utf8');
  } catch {
    return null;
  }

  if (reference.source.kind === 'role-source') {
    return resolveRoleSource(text, reference);
  }

  const front = frontMatter(text);
  const declaredName = front.get('name');
  const fallbackName =
    reference.source.kind === 'cursor-skill-file'
      ? path.basename(path.dirname(requested))
      : path.basename(requested, path.extname(requested));

  const instructions = bodyAfterFrontMatter(text);
  return {
    id: declaredName ?? fallbackName,
    sourcePath: reference.source.path,
    // Inferred from the file's location and shape, not read from the file.
    targets: ['cursor'],
    targetsDeclared: false,
    requirements: requirementsFromCursorFields(front),
    requirementsDeclared: false,
    ...(front.get('description') ? { summary: front.get('description') as string } : {}),
    ...(instructions === '' ? {} : { instructions }),
  };
}

/**
 * A `role-source` reference, read by DSP-23's own parser.
 *
 * The one resolution path where `targetsDeclared` and `requirementsDeclared` are
 * **true**, because this is the only format in which a role states them rather than
 * having them inferred from what kind of file it is. That is the whole reason the
 * format exists, and a resolver that read a role source through the Cursor front-matter
 * path above would have thrown both away and then reported the inference it did not
 * need to make.
 *
 * A source that does not parse resolves to `null`, which validation already words as a
 * reference that resolves to nothing. Reading half a role would be worse: the missing
 * half is the prose, and the prose is what the agent is told.
 */
function resolveRoleSource(text: string, reference: RoleReference): ResolvedRole | null {
  const parsed = parseRoleSource(text);
  if (!parsed.ok) {
    return null;
  }
  const { source } = parsed;
  const instructions = sectionBodies(source)
    .filter((body) => body.trim() !== '')
    .join('\n\n');
  return {
    id: source.id,
    sourcePath: reference.source.path,
    targets: source.targets,
    targetsDeclared: true,
    requirements: source.requirements.map((requirement) => requirement.id),
    requirementsDeclared: true,
    summary: source.summary,
    ...(instructions === '' ? {} : { instructions }),
  };
}

/**
 * Everything after the leading `---` block, which is the part addressed to the agent.
 *
 * The front matter is Cursor's own configuration — `name`, `description`, `readonly`,
 * `model` — and it is machinery rather than instruction, so it is not sent. What is left
 * is the file as its author wrote it for whoever performs the role.
 */
function bodyAfterFrontMatter(text: string): string {
  const normalised = text.replace(/^\uFEFF/, '');
  if (!normalised.startsWith('---')) {
    return normalised.trim();
  }
  const end = normalised.indexOf('\n---', 3);
  if (end < 0) {
    return '';
  }
  const afterMarker = normalised.indexOf('\n', end + 1);
  return afterMarker < 0 ? '' : normalised.slice(afterMarker + 1).trim();
}

/**
 * Cursor's mechanisms, read back as the requirements they implement.
 *
 * Only the fields whose absence would matter are translated. `model: inherit` is not a
 * fixed-model requirement — it is the absence of one — and reading it as a requirement
 * would make every specialist demand something no target can promise.
 */
function requirementsFromCursorFields(front: ReadonlyMap<string, string>): readonly RequirementId[] {
  const requirements: RequirementId[] = [];
  if (front.get('readonly') === 'true') {
    requirements.push('no-file-writes');
  }
  if (front.get('is_background') === 'true') {
    requirements.push('background-execution');
  }
  const model = front.get('model');
  if (model !== undefined && model !== '' && model !== 'inherit') {
    requirements.push('fixed-model-selection');
  }
  return requirements;
}

/**
 * The leading `---` block, as flat key/value pairs.
 *
 * Deliberately not a YAML parser. These files have a handful of scalar fields, a real
 * parser would be a dependency this project does not otherwise need, and anything more
 * structured belongs in DSP-23's role source rather than here.
 */
function frontMatter(text: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  const normalised = text.replace(/^\uFEFF/, '');
  if (!normalised.startsWith('---')) {
    return fields;
  }
  const end = normalised.indexOf('\n---', 3);
  if (end < 0) {
    return fields;
  }
  for (const line of normalised.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) {
      continue;
    }
    fields.set(key, unquote(rawValue.trim()));
  }
  return fields;
}

function unquote(value: string): string {
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
    const quote = value[0] as string;
    if (value.endsWith(quote)) {
      return value.slice(1, -1);
    }
  }
  return value;
}
