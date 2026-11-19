/**
 * DSP-231: the role catalogs on this machine — DSpatch's installed one and a repository's own — and
 * the digest check that keeps the same identity and version meaning the same text.
 *
 * Nothing here edits a role version. A project's own role is changed by writing a new version file
 * beside the old one; an existing version file is never replaced, and a copy of a shared role is
 * written only when no file is there or the one there has the listed digest.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ResolvedRole, RoleReference } from '../shared/loop-graph';
import {
  catalogFileFor,
  catalogVersion,
  DSPATCH_ROLE_CATALOG_DIR,
  PROJECT_ROLE_CATALOG_DIR,
  emptyRoleCatalog,
  normaliseRoleText,
  parseRoleCatalog,
  ROLE_CATALOG_INDEX,
  serialiseRoleCatalog,
  type RoleCatalogIndex,
} from '../shared/role-catalog';

/** SHA-256 of a role source, line endings normalised. */
export function roleDigest(text: string): string {
  return createHash('sha256').update(normaliseRoleText(text)).digest('hex');
}

let installedDir: string | null | undefined;

/**
 * The catalog installed with DSpatch: set by the process from its own repository or bundled
 * resources, else found by walking up from this module (a checkout, and the tests).
 */
export function installedRoleCatalogDir(): string | null {
  if (installedDir !== undefined) return installedDir;
  // Compiled: dist/main. Under the test loader there is no __dirname; the tests run from app/.
  let dir = typeof __dirname === 'string' ? __dirname : process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, DSPATCH_ROLE_CATALOG_DIR);
    if (fs.existsSync(path.join(candidate, ROLE_CATALOG_INDEX))) {
      installedDir = candidate;
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  installedDir = null;
  return null;
}

/** Point at the installed catalog: DSpatch's resource root, whose `docs/loop/roles/catalog` it is. */
export function setInstalledRoleCatalogRoot(resourceRoot: string | null): void {
  const dir = resourceRoot === null ? null : path.join(resourceRoot, DSPATCH_ROLE_CATALOG_DIR);
  installedDir = dir !== null && fs.existsSync(path.join(dir, ROLE_CATALOG_INDEX)) ? dir : undefined;
}

const indexCache = new Map<string, { readonly mtimeMs: number; readonly index: RoleCatalogIndex | null }>();

/** A catalog folder's index, or `null` when it has none that reads. */
export function readRoleCatalogIndex(dir: string): RoleCatalogIndex | null {
  const file = path.join(dir, ROLE_CATALOG_INDEX);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const cached = indexCache.get(file);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.index;
  let index: RoleCatalogIndex | null = null;
  try {
    const parsed = parseRoleCatalog(fs.readFileSync(file, 'utf8'));
    index = parsed.ok ? parsed.index : null;
  } catch {
    index = null;
  }
  indexCache.set(file, { mtimeMs, index });
  return index;
}

/** The installed catalog's index. */
export function installedRoleCatalog(): RoleCatalogIndex | null {
  const dir = installedRoleCatalogDir();
  return dir === null ? null : readRoleCatalogIndex(dir);
}

/** The catalog folder a version file sits in: `<catalog>/<id>/v<n>.role.md`. */
function catalogDirOf(file: string): string {
  return path.dirname(path.dirname(file));
}

/** The installed text of `id@version`, when the installed catalog lists it and the file has the listed digest. */
export function installedRoleText(id: string, version: number): { readonly text: string; readonly file: string } | null {
  const dir = installedRoleCatalogDir();
  const index = installedRoleCatalog();
  if (dir === null || index === null) return null;
  const listed = catalogVersion(index, id, version);
  if (listed === null) return null;
  const file = path.join(dir, listed.entry.file);
  try {
    const text = fs.readFileSync(file, 'utf8');
    return roleDigest(text) === listed.entry.sha256 ? { text, file } : null;
  } catch {
    return null;
  }
}

/**
 * How a catalog role's text stands against every catalog that lists its identity and version: the
 * one beside the file and the installed one. Listed with another digest anywhere is an edited copy.
 */
export function catalogStatusOf(
  reference: RoleReference,
  declared: { readonly id: string; readonly version: number | undefined },
  sha256: string,
  file: string,
): NonNullable<ResolvedRole['catalog']> & { readonly origin?: string; readonly title?: string } {
  const version = reference.version ?? 0;
  if (declared.id !== reference.id || declared.version !== version) {
    return {
      status: 'mismatch',
      detail: `the file declares ${declared.id}${declared.version === undefined ? ' with no version' : ` v${String(declared.version)}`}, but the graph asks for ${reference.id} v${String(version)}`,
    };
  }
  const indexes: { readonly where: string; readonly index: RoleCatalogIndex }[] = [];
  const beside = readRoleCatalogIndex(catalogDirOf(file));
  if (beside !== null) indexes.push({ where: path.join(catalogDirOf(file), ROLE_CATALOG_INDEX), index: beside });
  const installed = installedRoleCatalog();
  const installedDirNow = installedRoleCatalogDir();
  if (installed !== null && installedDirNow !== null && path.resolve(installedDirNow) !== path.resolve(catalogDirOf(file))) {
    indexes.push({ where: 'the catalog installed with DSpatch', index: installed });
  }
  let listedIn: { readonly where: string; readonly origin: string; readonly title: string } | null = null;
  for (const { where, index } of indexes) {
    const listed = catalogVersion(index, reference.id, version);
    if (listed === null) continue;
    if (listed.entry.sha256 !== sha256) {
      return {
        status: 'modified',
        detail: `${where} lists ${reference.id} v${String(version)} with another text, so this copy was edited. A changed role is a new version or a role of its own, never an edit of a published one`,
      };
    }
    listedIn ??= { where, origin: listed.role.origin ?? index.origin, title: listed.role.title };
  }
  if (listedIn === null) {
    return { status: 'unlisted', detail: 'no role catalog DSpatch can read lists this identity and version, so nothing shows it is the published text' };
  }
  return {
    status: 'listed',
    detail: `as listed in ${listedIn.where}`,
    origin: listedIn.origin,
    title: listedIn.title,
  };
}

/**
 * Where a graph at `resourceRoot` keeps its catalog roles, relative to that root: DSpatch's own
 * catalog when the root is a DSpatch folder, else the repository's `.dspatch/roles`.
 */
export function catalogDirFor(resourceRoot: string): string {
  return fs.existsSync(path.join(resourceRoot, DSPATCH_ROLE_CATALOG_DIR, ROLE_CATALOG_INDEX)) ? DSPATCH_ROLE_CATALOG_DIR : PROJECT_ROLE_CATALOG_DIR;
}

/** The result of writing catalog roles into a repository. */
export interface CopyResult {
  readonly written: readonly string[];
  readonly present: readonly string[];
  readonly problems: readonly string[];
}

/**
 * The files that copying `roles` from the installed catalog into `catalogDir` would write: each
 * version file (only where none is there; one there with the listed digest is fine, one with another
 * is a conflict) and the folder's index with those versions listed.
 */
export function planCatalogCopies(
  catalogDir: string,
  roles: readonly { readonly id: string; readonly version: number; readonly sourceFile?: string }[],
): { readonly files: readonly { readonly path: string; readonly text: string; readonly what: string }[]; readonly present: readonly string[]; readonly problems: readonly string[] } {
  const installed = installedRoleCatalog();
  const files: { path: string; text: string; what: string }[] = [];
  const present: string[] = [];
  const problems: string[] = [];
  let index = readRoleCatalogIndex(catalogDir) ?? emptyRoleCatalog('project');
  let indexChanged = false;
  for (const { id, version, sourceFile } of roles) {
    // From the file a template names, held to the index beside it (or the installed one); else
    // from the installed catalog. Either way only a text with the listed digest is copied.
    let source: { readonly text: string } | null = null;
    let listed: ReturnType<typeof catalogVersion> = null;
    if (sourceFile !== undefined) {
      try {
        const text = fs.readFileSync(sourceFile, 'utf8');
        listed = catalogVersion(readRoleCatalogIndex(catalogDirOf(sourceFile)) ?? installed ?? emptyRoleCatalog('none'), id, version);
        source = listed !== null && roleDigest(text) === listed.entry.sha256 ? { text } : null;
      } catch {
        source = null;
      }
    } else {
      source = installedRoleText(id, version);
      listed = installed === null ? null : catalogVersion(installed, id, version);
    }
    if (source === null || listed === null) {
      problems.push(`${id} v${String(version)} is not available as the listed text of a role catalog, so it cannot be copied.`);
      continue;
    }
    const target = path.join(catalogDir, catalogFileFor(id, version));
    let existing: string | null = null;
    try {
      existing = fs.readFileSync(target, 'utf8');
    } catch {
      existing = null;
    }
    if (existing !== null && roleDigest(existing) !== listed.entry.sha256) {
      problems.push(`${path.relative(path.dirname(catalogDir), target)} exists with another text than ${id} v${String(version)}; it is not replaced.`);
      continue;
    }
    if (existing === null) files.push({ path: target, text: normaliseRoleText(source.text), what: `the shared role ${listed.role.title} (${id} v${String(version)}), copied from DSpatch's catalog` });
    else present.push(target);
    const here = catalogVersion(index, id, version);
    if (here === null) {
      const role = index.roles.find((entry) => entry.id === id);
      const entry = { version, file: catalogFileFor(id, version), sha256: listed.entry.sha256 };
      index = {
        ...index,
        roles: role === undefined
          ? [...index.roles, { id, title: listed.role.title, summary: listed.role.summary, origin: listed.role.origin ?? installed?.origin ?? 'dspatch', versions: [entry] }]
          : index.roles.map((candidate) => (candidate.id === id ? { ...candidate, versions: [...candidate.versions, entry] } : candidate)),
      };
      indexChanged = true;
    } else if (here.entry.sha256 !== listed.entry.sha256) {
      problems.push(`${path.join(catalogDir, ROLE_CATALOG_INDEX)} lists ${id} v${String(version)} with another digest than DSpatch's catalog.`);
    }
  }
  if (indexChanged) files.push({ path: path.join(catalogDir, ROLE_CATALOG_INDEX), text: serialiseRoleCatalog(index), what: 'the repository\'s role catalog index, listing the copies' });
  return { files, present, problems };
}

/**
 * DSP-231: save a project's own reusable role, never changing an existing definition. A new identity
 * becomes version 1; an identity the repository already publishes gets its next version, beside the
 * old one, which stays as it was for every graph that pins it. An identity of DSpatch's catalog is
 * refused: a different role needs an id of its own. The written file states its identity, version and
 * origin, and the repository's index lists it with its digest.
 */
export function planProjectRole(
  resourceRoot: string,
  text: string,
  parse: (text: string) => { readonly ok: true; readonly id: string } | { readonly ok: false; readonly problems: readonly string[] },
): { readonly ok: true; readonly id: string; readonly version: number; readonly files: readonly { readonly path: string; readonly text: string }[]; readonly reference: string } | { readonly ok: false; readonly problems: readonly string[] } {
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  const id = parsed.id;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) return { ok: false, problems: [`"${id}" is not a usable role id: lower-case letters, digits and hyphens.`] };
  if (installedRoleCatalog()?.roles.some((role) => role.id === id) === true) {
    return { ok: false, problems: [`"${id}" is a shared role of DSpatch's catalog. Give your role an id of its own; the shared one is never changed from a project.`] };
  }
  const catalogDir = path.join(resourceRoot, PROJECT_ROLE_CATALOG_DIR);
  const index = readRoleCatalogIndex(catalogDir) ?? emptyRoleCatalog('project');
  const existing = index.roles.find((role) => role.id === id);
  if (existing !== undefined && (existing.origin ?? index.origin) !== 'project') {
    return { ok: false, problems: [`"${id}" is a copy of a shared role in this repository. Give your role an id of its own.`] };
  }
  const version = (existing?.versions.reduce((max, entry) => Math.max(max, entry.version), 0) ?? 0) + 1;
  // The file says what it is: its identity, version and origin are set here, never left to the text.
  const body = normaliseRoleText(text).replace(/^---\n([\s\S]*?)\n---/, (_whole, fields: string) => {
    const kept = fields.split('\n').filter((line) => !/^(version|origin)\s*:/.test(line.trim()));
    const at = kept.findIndex((line) => /^role\s*:/.test(line.trim()));
    kept.splice(at + 1, 0, `version: ${String(version)}`, 'origin: project');
    return `---\n${kept.join('\n')}\n---`;
  });
  const file = path.join(catalogDir, catalogFileFor(id, version));
  if (fs.existsSync(file)) return { ok: false, problems: [`${path.relative(resourceRoot, file)} exists already, and a role version is never replaced.`] };
  const title = /^title\s*:\s*(.*)$/m.exec(body)?.[1]?.replace(/^"|"$/g, '') ?? id;
  const summary = /^summary\s*:\s*(.*)$/m.exec(body)?.[1]?.replace(/^"|"$/g, '') ?? '';
  const derivedFrom = /^derivedFrom\s*:\s*(.*)$/m.exec(body)?.[1]?.trim();
  const entry = { version, file: catalogFileFor(id, version), sha256: roleDigest(body), ...(derivedFrom === undefined ? {} : { derivedFrom }) };
  const next: RoleCatalogIndex = {
    ...index,
    roles:
      existing === undefined
        ? [...index.roles, { id, title, summary, origin: 'project', versions: [entry] }]
        : index.roles.map((role) => (role.id === id ? { ...role, title, summary, versions: [...role.versions, entry] } : role)),
  };
  return {
    ok: true,
    id,
    version,
    reference: `${PROJECT_ROLE_CATALOG_DIR}/${catalogFileFor(id, version)}`,
    files: [
      { path: file, text: body },
      { path: path.join(catalogDir, ROLE_CATALOG_INDEX), text: serialiseRoleCatalog(next) },
    ],
  };
}

/** The roles a graph at `resourceRoot` can use: DSpatch's catalog and the repository's own. */
export function availableCatalogRoles(resourceRoot: string | null): readonly {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly origin: string;
  readonly versions: readonly number[];
  readonly derivedFrom?: string;
}[] {
  const rows = new Map<string, { id: string; title: string; summary: string; origin: string; versions: number[]; derivedFrom?: string }>();
  const add = (index: RoleCatalogIndex | null): void => {
    for (const role of index?.roles ?? []) {
      const origin = role.origin ?? index?.origin ?? 'unknown';
      const row = rows.get(role.id) ?? { id: role.id, title: role.title, summary: role.summary, origin, versions: [] };
      for (const entry of role.versions) if (!row.versions.includes(entry.version)) row.versions.push(entry.version);
      const derived = role.versions.at(-1)?.derivedFrom;
      if (derived !== undefined) row.derivedFrom = derived;
      rows.set(role.id, row);
    }
  };
  add(installedRoleCatalog());
  if (resourceRoot !== null) add(readRoleCatalogIndex(path.join(resourceRoot, PROJECT_ROLE_CATALOG_DIR)));
  return [...rows.values()].map((row) => ({ ...row, versions: row.versions.sort((a, b) => a - b) })).sort((a, b) => a.title.localeCompare(b.title));
}
