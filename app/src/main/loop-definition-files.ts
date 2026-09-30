/**
 * Finding definitions on this machine, and reaching what they point at.
 *
 * Two properties are the whole of this module, and both are properties of cost and
 * blast radius rather than of features.
 *
 * **Discovery reads one directory per folder and nothing else.** Not recursively, not
 * for a count, not to decide whether a folder is worth listing. Opening a large
 * repository must not be the moment DSpatch walks it, and a claim about cost that is
 * only written down stays true until someone changes a loop and does not notice. So
 * {@link discoverLoopDefinitions} takes its filesystem as an argument and a test counts
 * the calls.
 *
 * **An error belongs to one definition.** One unreadable or malformed declaration shows
 * its finding on its own row and leaves the rest selectable, which rules out a single
 * `try`/`catch` around the directory: that shape loses four good definitions to one bad
 * one, and the person is told nothing about which.
 *
 * Nothing here starts anything. A row is a row.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  isLoopDefinitionFileName,
  LOOP_DEFINITION_DIR_SEGMENTS,
  parseLoopDefinition,
  readsFromElsewhere,
  type DefinitionRowDisplay,
  type LoopDefinition,
} from '../shared/loop-definition';
import type { Finding } from '../shared/loop-graph-load';
import type { RoleResolver } from '../shared/loop-graph';
import { createFileRoleResolver } from './loop-graph-roles';

/**
 * The filesystem, as the two questions this module asks of it.
 *
 * Injected so a test can both fake a tree and *count* what was read. The counting is
 * the point: no-recursive-scan is the kind of property that is asserted or it is not
 * true.
 */
export interface DefinitionIo {
  /** File names directly in `dir`. Throws if it cannot be listed. */
  readonly listFiles: (dir: string) => readonly string[];
  readonly readText: (file: string) => string;
}

export const nodeDefinitionIo: DefinitionIo = {
  listFiles: (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  readText: (file) => fs.readFileSync(file, 'utf8'),
};

/** Where a definition came from, which is what tells two identical names apart. */
export type DefinitionOrigin =
  | { readonly kind: 'folder'; readonly folderPath: string }
  | { readonly kind: 'picked' };

/**
 * One row in the list of loops a person can choose from.
 *
 * A row exists whether or not the file parses. That is deliberate: a malformed
 * declaration that vanished from the list would be indistinguishable from one nobody
 * wrote, and the author would have no way to see the finding.
 */
export interface LoopDefinitionRow {
  readonly filePath: string;
  readonly fileName: string;
  readonly origin: DefinitionOrigin;
  readonly definition: LoopDefinition | null;
  readonly findings: readonly Finding[];
  /** The read anchor, resolved. `null` when the declaration did not load. */
  readonly resourceRoot: string | null;
  /** The graph this row stands for, resolved. `null` when the declaration did not load. */
  readonly graphPath: string | null;
}

export interface DiscoveredFolder {
  readonly folderPath: string;
  /** The one directory that was listed. */
  readonly directory: string;
  /** Absent is the ordinary case: a folder with no loops of its own. */
  readonly present: boolean;
  /** Set when the directory is there and could not be listed. */
  readonly problem: string | null;
  readonly rows: readonly LoopDefinitionRow[];
}

export interface Discovery {
  readonly folders: readonly DiscoveredFolder[];
  readonly rows: readonly LoopDefinitionRow[];
}

/** The standard location for a folder's own loops. */
export function loopDefinitionDirFor(folderPath: string): string {
  return path.join(folderPath, ...LOOP_DEFINITION_DIR_SEGMENTS);
}

/**
 * List the definitions each folder declares, and nothing else.
 *
 * One `listFiles` per folder. Every file read and every parse is in its own
 * `try`/`catch`, so a definition that fails takes only its own row with it.
 */
export function discoverLoopDefinitions(
  folderPaths: readonly string[],
  io: DefinitionIo = nodeDefinitionIo,
): Discovery {
  const folders = folderPaths.map((folderPath) => discoverOne(folderPath, io));
  return { folders, rows: folders.flatMap((folder) => folder.rows) };
}

function discoverOne(folderPath: string, io: DefinitionIo): DiscoveredFolder {
  const directory = loopDefinitionDirFor(folderPath);
  const origin: DefinitionOrigin = { kind: 'folder', folderPath };

  let names: readonly string[];
  try {
    names = io.listFiles(directory);
  } catch (error) {
    // A folder with no `.dspatch/loops` is the ordinary case and is not a problem to
    // report. Anything else is: the directory exists and something stopped us reading
    // it, and silence there would read as "this folder declares no loops".
    const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
    return {
      folderPath,
      directory,
      present: false,
      problem: missing ? null : `${directory} could not be listed: ${describe(error)}`,
      rows: [],
    };
  }

  const rows = names
    .filter(isLoopDefinitionFileName)
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => readRow(path.join(directory, fileName), fileName, origin, io));

  return { folderPath, directory, present: true, problem: null, rows };
}

/**
 * A definition the person pointed at, from anywhere.
 *
 * The same row shape as a discovered one, labelled by where it came from, so a
 * definition that belongs to no open folder is chosen from the same list rather than
 * through a second mechanism with its own wording.
 */
export function openLoopDefinitionFile(
  filePath: string,
  io: DefinitionIo = nodeDefinitionIo,
): LoopDefinitionRow {
  const resolved = path.resolve(filePath);
  return readRow(resolved, path.basename(resolved), { kind: 'picked' }, io);
}

function readRow(
  filePath: string,
  fileName: string,
  origin: DefinitionOrigin,
  io: DefinitionIo,
): LoopDefinitionRow {
  let text: string;
  try {
    text = io.readText(filePath);
  } catch (error) {
    return {
      filePath,
      fileName,
      origin,
      definition: null,
      findings: [
        {
          severity: 'error',
          code: 'unreadable',
          pointer: '',
          message: `This file could not be read: ${describe(error)}`,
        },
      ],
      resourceRoot: null,
      graphPath: null,
    };
  }

  let parsed: ReturnType<typeof parseLoopDefinition>;
  try {
    parsed = parseLoopDefinition(text);
  } catch (error) {
    // The parser is not supposed to throw. If it ever does, one row says so rather
    // than the whole directory disappearing.
    return {
      filePath,
      fileName,
      origin,
      definition: null,
      findings: [
        {
          severity: 'error',
          code: 'parser-fault',
          pointer: '',
          message: `This definition could not be read: ${describe(error)}`,
        },
      ],
      resourceRoot: null,
      graphPath: null,
    };
  }

  if (!parsed.ok) {
    return {
      filePath,
      fileName,
      origin,
      definition: null,
      findings: parsed.findings,
      resourceRoot: null,
      graphPath: null,
    };
  }

  // One base for everything this declaration names, and `graph` is resolved under it
  // like any role path. Whether it stays inside was already decided by the parser, from
  // the text alone; there is nothing left for the filesystem to rule on.
  const resourceRoot = resourceRootFor(filePath, parsed.definition);

  return {
    filePath,
    fileName,
    origin,
    definition: parsed.definition,
    findings: parsed.findings,
    resourceRoot,
    graphPath: path.resolve(resourceRoot, parsed.definition.graph),
  };
}

/**
 * The read anchor, as an absolute path.
 *
 * The folder the declaration file sits in, unless the declaration moves it — and
 * **only** that, whether the file was found in a folder's standard `.dspatch/loops`
 * location or pointed at by hand. Where DSpatch looked is not part of what the paths
 * inside the file mean, so the same declaration two levels under a project reaches the
 * same things wherever those two levels are.
 *
 * `resourceRoot` is measured from the file's folder because it is what sets the anchor;
 * everything else in the declaration is measured from the anchor.
 */
export function resourceRootFor(definitionFilePath: string, definition: LoopDefinition): string {
  const folder = path.resolve(path.dirname(definitionFilePath));
  const declared = definition.resourceRoot;
  return declared === undefined ? folder : path.resolve(folder, declared);
}

/**
 * How this definition's graph reaches its roles.
 *
 * The anchor is the definition's resource root, never the folder being worked on. That
 * is the defect this fixes: a graph carried from one project to another used to look
 * for its roles inside whatever project it was pointed at, and find nothing. Climbing
 * out of the resource root is still refused — a shared graph must not be a way to read
 * arbitrary parts of the machine that opens it — which is why the root is declared once
 * in the definition rather than implied per path. It is the same root and the same
 * refusal `graph` meets, because one declaration has one base.
 */
export function createDefinitionRoleResolver(row: LoopDefinitionRow): RoleResolver | null {
  return row.resourceRoot === null ? null : createFileRoleResolver(row.resourceRoot);
}

/**
 * Where this definition's results are written.
 *
 * **A write path, and deliberately anchored nowhere a read path is anchored.** The
 * default is the run-scoped location DSpatch owns. An author who insists gets the
 * absolute root they declared. Neither is the resource root, and neither is a working
 * root: a definition that borrows DSpatch's roles must not thereby write its reports
 * into the DSpatch repository, and a definition run against a project must not leave
 * its own bookkeeping in that project unless someone asked for it.
 */
export function resultRootFor(options: {
  readonly definition: LoopDefinition;
  /** The run-scoped location DSpatch owns, already including the run. */
  readonly runScopedRoot: string;
}): { readonly root: string; readonly declared: boolean } {
  const declared = options.definition.resultRoot;
  return declared === undefined
    ? { root: path.resolve(options.runScopedRoot), declared: false }
    : { root: path.resolve(declared), declared: true };
}

export function describeDefinitionRow(row: LoopDefinitionRow): DefinitionRowDisplay {
  const origin =
    row.origin.kind === 'folder'
      ? `${path.basename(row.origin.folderPath)} \u00b7 ${row.fileName}`
      : `${row.filePath} \u00b7 chosen by hand`;

  if (row.definition === null) {
    return {
      name: row.fileName,
      description: null,
      origin,
      error: row.findings
        .filter((finding) => finding.severity === 'error')
        .map((finding) => finding.message)
        .join('\n'),
      dependency: null,
    };
  }

  return {
    name: row.definition.name,
    description: row.definition.description ?? null,
    origin,
    error: null,
    dependency: readsFromElsewhere(row.definition)
      ? `Reads its resources from ${row.resourceRoot ?? row.definition.resourceRoot ?? ''}` +
        (row.definition.resourceRootNote === undefined
          ? ''
          : ` \u2014 ${row.definition.resourceRootNote}`)
      : null,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
