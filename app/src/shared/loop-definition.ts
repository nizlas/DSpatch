/**
 * A loop you can choose.
 *
 * Until now there was no such unit. The chat loop was a constant path inside DSpatch's
 * own repository, so "which loop runs" was not a question anyone could answer by
 * pointing at something. A declaration is that something: a small versioned file with a
 * stable id, a name a person can tell from another name, a short description, the graph
 * it stands for, and where that graph's resources are found.
 *
 * **One base for every relative path in it: the resource root.** That root is the
 * folder this file sits in, unless the file moves it with `resourceRoot`. `graph`
 * resolves under it, the graph's role paths resolve under it, and nothing resolved may
 * climb out of it. Where DSpatch *found* the file — a folder's standard `.dspatch/loops`
 * location, or a path somebody pointed at by hand — does not enter into it. Someone
 * holding this file can work out what every path in it reaches from the file's own
 * location and nothing else.
 *
 * `resourceRoot` is the one path measured from the file rather than from the root,
 * because it is what establishes the root; there is nothing else it could be relative
 * to. It is a *read* anchor: it is never a working root and nothing is written under it.
 *
 * An earlier build had a second base. A declaration filed in `.dspatch/loops` was read
 * as belonging to the folder that owns `.dspatch`, so the same relative path meant two
 * different things depending on where the file sat. That rule is withdrawn (DSP-69,
 * reopened): the standard location decides where the app *looks*, not what the paths
 * inside a file *mean*.
 *
 * Two other roots exist and are named here so they are not mistaken for this one. The
 * **working root** is the folder the agent works in; it comes from the run and appears
 * nowhere in this file. And results land under neither it nor the resource root:
 * `resultRoot` is a write path, either a run-scoped location DSpatch owns or an
 * explicitly declared absolute root. Anchoring it where read paths anchor would make a
 * definition that references DSpatch's roles write its reports into the DSpatch
 * repository — this stage's own collapse arriving through the back door.
 *
 * Parsing lives here and touches no filesystem, so the renderer can judge a declaration
 * it was handed. Reaching a path on this machine is {@link ../main/loop-definition-files}.
 */

import type { Finding } from './loop-graph-load';

export const LOOP_DEFINITION_FORMAT = 'dspatch-loop-definition';
export const LOOP_DEFINITION_FORMAT_VERSION = 1;

/** The standard location, relative to a folder: one directory, listed once. */
export const LOOP_DEFINITION_DIR_SEGMENTS = ['.dspatch', 'loops'] as const;

/** What a declaration file is called. Discovery reads nothing else. */
export const LOOP_DEFINITION_SUFFIX = '.loop.json';

export interface LoopDefinition {
  readonly format: typeof LOOP_DEFINITION_FORMAT;
  readonly formatVersion: number;
  /** Stable across renames. Two folders may hold definitions with the same name. */
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** The graph, relative to the resource root. May not climb out of it. */
  readonly graph: string;
  /**
   * The read anchor for this whole declaration, relative to the folder the file sits
   * in and left out when that folder *is* the anchor.
   *
   * It is allowed to climb out — a definition beside a project that reaches the
   * project, or one that borrows another project's roles, are the cases this field
   * exists for. When it does climb out, the dependency is recorded and shown rather
   * than being silently followed.
   */
  readonly resourceRoot?: string;
  /** Why the resources live elsewhere, in the author's own words. */
  readonly resourceRootNote?: string;
  /**
   * Where this loop's results are written, when the author insists on a place.
   *
   * Absolute, because every relative anchor available here is the wrong one: the
   * declaration folder and the resource root are read anchors, and a working root is
   * the folder being worked on rather than a place to file reports. Left out — the
   * ordinary case — results go to the run-scoped location DSpatch owns.
   */
  readonly resultRoot?: string;
  readonly notes?: string;
}

export type LoopDefinitionParse =
  | { readonly ok: true; readonly definition: LoopDefinition; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly definition: null; readonly findings: readonly Finding[] };

/**
 * Read a declaration from text.
 *
 * Findings-or-definition, never both, which is the model `loadLoopGraph` already uses
 * and the reason an error can belong to one row of a list rather than to the list.
 */
export function parseLoopDefinition(text: string): LoopDefinitionParse {
  const findings: Finding[] = [];
  const error = (code: string, pointer: string, message: string): void => {
    findings.push({ severity: 'error', code, pointer, message });
  };

  let parsed: unknown;
  try {
    // A leading byte-order mark is stripped rather than refused. Every Windows editor
    // and `Set-Content -Encoding utf8` writes one, `JSON.parse` rejects it, and the
    // message it gives — *unexpected token* over an invisible character — is unusable
    // to the person who wrote the file. `role-source.ts` and `loop-graph-roles.ts`
    // already do exactly this for the same reason.
    parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch (cause) {
    error(
      'not-json',
      '',
      `This file is not valid JSON, so it cannot be read as a loop definition and has ` +
        `not been changed: ${describe(cause)}`,
    );
    return { ok: false, definition: null, findings };
  }

  if (!isRecord(parsed)) {
    error(
      'not-an-object',
      '',
      'A loop definition is a JSON object. This file contains something else, so there ' +
        'is nothing to load.',
    );
    return { ok: false, definition: null, findings };
  }

  if (parsed['format'] !== LOOP_DEFINITION_FORMAT) {
    error(
      'wrong-format',
      '/format',
      `This does not look like a loop definition: its "format" is ` +
        `${JSON.stringify(parsed['format']) ?? 'absent'}, and a loop definition says ` +
        `"${LOOP_DEFINITION_FORMAT}". A loop graph is a different file and is pointed ` +
        `at by "graph" rather than named here.`,
    );
    return { ok: false, definition: null, findings };
  }

  const version = parsed['formatVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    error(
      'bad-format-version',
      '/formatVersion',
      `"formatVersion" must be a whole number from 1 upwards; this file has ` +
        `${JSON.stringify(version)}. Without it there is no way to know which rules ` +
        `this file was written against.`,
    );
    return { ok: false, definition: null, findings };
  }
  if (version > LOOP_DEFINITION_FORMAT_VERSION) {
    error(
      'newer-format-version',
      '/formatVersion',
      `This definition is format version ${String(version)} and this build understands ` +
        `${String(LOOP_DEFINITION_FORMAT_VERSION)}. It has not been loaded and must not ` +
        `be saved by this build: a newer DSpatch may have written fields this one would ` +
        `drop.`,
    );
    return { ok: false, definition: null, findings };
  }

  const id = nonEmptyString(parsed['id']);
  if (id === null) {
    error(
      'no-id',
      '/id',
      'A definition needs an "id" that stays the same when its name changes. Two ' +
        'folders may hold definitions called the same thing; the id is what tells them ' +
        'apart afterwards.',
    );
  }

  const name = nonEmptyString(parsed['name']);
  if (name === null) {
    error(
      'no-name',
      '/name',
      'A definition needs a "name" — it is what a person chooses from a list.',
    );
  }

  const description = optionalString(parsed['description'], 'description', findings);
  const resourceRootNote = optionalString(parsed['resourceRootNote'], 'resourceRootNote', findings);
  const notes = optionalString(parsed['notes'], 'notes', findings);

  const resourceRootRaw = parsed['resourceRoot'];
  let resourceRoot: string | undefined;
  if (resourceRootRaw !== undefined) {
    const value = nonEmptyString(resourceRootRaw);
    if (value === null) {
      error(
        'bad-resource-root',
        '/resourceRoot',
        '"resourceRoot" must be a path relative to this file\u2019s folder, or left out ' +
          'so that the folder itself is the anchor.',
      );
    } else if (looksAbsolute(value)) {
      findings.push({
        severity: 'warning',
        code: 'resource-root-absolute',
        pointer: '/resourceRoot',
        message:
          `"resourceRoot" is ${JSON.stringify(value)}, an absolute path. This ` +
          `definition will resolve nothing on a machine laid out differently. A ` +
          `relative root travels with the file.`,
      });
      resourceRoot = value;
    } else {
      resourceRoot = value;
      if (climbsOut(value)) {
        findings.push({
          severity: 'notice',
          code: 'resource-root-elsewhere',
          pointer: '/resourceRoot',
          message:
            `This definition reads its resources from ${JSON.stringify(value)}, outside ` +
            `its own folder. That is a dependency on another folder being present and ` +
            `is recorded here so it is visible before the loop is chosen. It is a read ` +
            `anchor only: nothing is written there and it is not a working root.`,
        });
        if (resourceRootNote === undefined) {
          findings.push({
            severity: 'warning',
            code: 'resource-root-note-missing',
            pointer: '/resourceRootNote',
            message:
              'A "resourceRoot" pointing outside this folder should say in ' +
              '"resourceRootNote" what it depends on, so whoever chooses this loop can ' +
              'see what has to be present for it to resolve.',
          });
        }
      }
    }
  }

  // The anchor, in the wording an error message can use. `resourceRoot` is declared
  // relative to this file's folder, so when it is absent the folder is the anchor.
  const anchor =
    resourceRoot === undefined
      ? 'this file\u2019s own folder'
      : `${JSON.stringify(resourceRoot)}, the resource root this file declares`;

  const graph = nonEmptyString(parsed['graph']);
  if (graph === null) {
    error(
      'no-graph',
      '/graph',
      'A definition points at the graph it stands for, with "graph" relative to its ' +
        'resource root — which is the folder this file sits in unless "resourceRoot" ' +
        'says otherwise.',
    );
  } else if (looksAbsolute(graph)) {
    error(
      'graph-absolute',
      '/graph',
      `"graph" is ${JSON.stringify(graph)}, which is a path on one machine. A ` +
        `definition is a file that may be shared, so its graph is named relative to its ` +
        `resource root.`,
    );
  } else if (climbsOut(graph)) {
    // Decidable from the text alone, which is why it lives here and not beside the
    // filesystem: `graph` is measured from the resource root, and whether a relative
    // path leaves the root it starts in does not depend on where that root is. It is
    // the same refusal a role path meets, because it is the same rule.
    error(
      'graph-climbs-out',
      '/graph',
      `"graph" is ${JSON.stringify(graph)}, which climbs out of ${anchor}. Everything ` +
        `this definition reads resolves under that one root and may not leave it. If ` +
        `the graph really is elsewhere, point "resourceRoot" at the folder it lives ` +
        `under and name the graph from there — then the dependency is written down and ` +
        `shown rather than followed silently.`,
    );
  }

  const resultRootRaw = parsed['resultRoot'];
  let resultRoot: string | undefined;
  if (resultRootRaw !== undefined) {
    const value = nonEmptyString(resultRootRaw);
    if (value === null || !looksAbsolute(value)) {
      error(
        'result-root-not-absolute',
        '/resultRoot',
        `"resultRoot" is where this loop\u2019s results are written, and it must be an ` +
          `absolute path. It is deliberately not relative: the definition\u2019s folder ` +
          `and its resource root are read anchors, and a working root is the folder ` +
          `being worked on rather than a place to file reports. Leave it out and ` +
          `results go to the run-scoped location DSpatch owns.`,
      );
    } else {
      resultRoot = value;
    }
  }

  if (findings.some((finding) => finding.severity === 'error')) {
    return { ok: false, definition: null, findings };
  }

  return {
    ok: true,
    definition: {
      format: LOOP_DEFINITION_FORMAT,
      formatVersion: version,
      id: id as string,
      name: name as string,
      graph: graph as string,
      ...(description === undefined ? {} : { description }),
      ...(resourceRoot === undefined ? {} : { resourceRoot }),
      ...(resourceRootNote === undefined ? {} : { resourceRootNote }),
      ...(resultRoot === undefined ? {} : { resultRoot }),
      ...(notes === undefined ? {} : { notes }),
    },
    findings,
  };
}

/**
 * Whether this declaration reads from somewhere other than its own folder.
 *
 * The question a list asks before it shows the dependency beside the row.
 */
export function readsFromElsewhere(definition: LoopDefinition): boolean {
  const root = definition.resourceRoot;
  return root !== undefined && root !== '' && root !== '.' && (looksAbsolute(root) || climbsOut(root));
}

/**
 * What a list shows, decided once so two surfaces cannot word the same row differently.
 *
 * Declared here rather than beside `describeDefinitionRow`, which needs a filesystem's
 * idea of a base name: the renderer draws these fields and must be able to name their
 * type without reaching into the main process.
 */
export interface DefinitionRowDisplay {
  readonly name: string;
  readonly description: string | null;
  /** Where it came from, which is what distinguishes two definitions sharing a name. */
  readonly origin: string;
  /** Present when the definition did not load. The row stays; only this one is unusable. */
  readonly error: string | null;
  /** Present when the definition reads from outside its own folder. */
  readonly dependency: string | null;
}

/** A file name that discovery would consider. Not a claim that it parses. */
export function isLoopDefinitionFileName(fileName: string): boolean {
  return fileName.length > LOOP_DEFINITION_SUFFIX.length && fileName.endsWith(LOOP_DEFINITION_SUFFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function optionalString(value: unknown, field: string, findings: Finding[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    findings.push({
      severity: 'error',
      code: 'bad-text-field',
      pointer: `/${field}`,
      message: `"${field}" must be text when it is present; this file has ${JSON.stringify(value)}.`,
    });
    return undefined;
  }
  return value;
}

/** Judged as text, because this runs where `node:path` is not available. */
function looksAbsolute(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]?/.test(value);
}

/**
 * Whether a relative path leaves the folder it starts in.
 *
 * Counted rather than pattern-matched, so `a/../b` stays inside and `a/../../b` does
 * not — a check that only looked for a leading `..` would admit the second.
 */
function climbsOut(value: string): boolean {
  let depth = 0;
  for (const segment of value.split(/[\\/]+/)) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      depth -= 1;
      if (depth < 0) {
        return true;
      }
    } else {
      depth += 1;
    }
  }
  return false;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
