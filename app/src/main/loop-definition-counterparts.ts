/**
 * The same loop in two places (DSP-160).
 *
 * A person who pointed at a declaration file before DSpatch shipped that loop, or who
 * opens a project holding a copy of it, used to get two rows with one name and nothing
 * saying how they relate. Counterparts are told by **identity and origin**: the same
 * definition `id`, one row shipped with this DSpatch and the other from anywhere else. A
 * shared display name is not evidence, and two non-shipped rows sharing an id stay two
 * rows, because a definition's id is only promised to be stable, not globally unique.
 *
 * **Provably the same collapses to one row; everything else stays and says so.** "The
 * same" means the declaration's meaningful fields, the graph and every role it reaches
 * compare equal. Line endings and a byte-order mark do not count, because a checkout on
 * Windows differs from the bundle in exactly those and in nothing a person would call a
 * difference. A file that cannot be read cannot be shown to be the same, so it stays.
 *
 * **Only the list changes.** No file is moved, rewritten or deleted and no saved choice
 * is touched. A collapsed row is still reachable through **Open loop…**, and a saved
 * choice naming the person's own file keeps that row: the shipped one gives way instead.
 */

import { referencedRoles, resolvedRolesWith } from './loop-graph-open';
import { createDefinitionRoleResolver, type DefinitionIo, type LoopDefinitionRow } from './loop-definition-files';

export interface SettledCounterparts {
  /** The rows to list, in their original order. */
  readonly rows: readonly LoopDefinitionRow[];
  /** What a row says about its counterpart, by file path. Absent when it has none. */
  readonly variants: ReadonlyMap<string, string>;
}

/** Mark the rows found in the folder that ships with this DSpatch. */
export function markShippedRows(
  rows: readonly LoopDefinitionRow[],
  shippedFolder: string | null,
): readonly LoopDefinitionRow[] {
  return rows.map((row) =>
    row.origin.kind === 'folder' && row.origin.folderPath === shippedFolder
      ? { ...row, origin: { kind: 'shipped', folderPath: row.origin.folderPath } }
      : row,
  );
}

/**
 * Reduce the list to rows that are really different, and word what remains.
 *
 * `rememberedKey` is the saved choice. Where it names a copy of a shipped loop, that copy
 * is the row kept, so a saved choice never loses its row to tidying.
 */
export function settleCounterparts(
  rows: readonly LoopDefinitionRow[],
  rememberedKey: string | null,
  io: DefinitionIo,
): SettledCounterparts {
  const hidden = new Set<string>();
  const variants = new Map<string, string>();

  for (const shipped of rows.filter((row) => row.origin.kind === 'shipped')) {
    const others = rows.filter(
      (row) =>
        row.origin.kind !== 'shipped' &&
        row.definition !== null &&
        row.definition.id === shipped.definition?.id,
    );
    if (others.length === 0) {
      continue;
    }
    const print = fingerprint(shipped, io);
    const same = others.filter((row) => print !== null && fingerprint(row, io) === print);
    const different = others.filter((row) => !same.includes(row));
    const kept = same.find((row) => row.filePath === rememberedKey) ?? null;

    for (const row of different) {
      variants.set(row.filePath, 'differs from the version that comes with DSpatch');
    }
    for (const row of same.filter((candidate) => candidate !== kept)) {
      hidden.add(row.filePath);
    }
    if (kept !== null) {
      hidden.add(shipped.filePath);
      variants.set(kept.filePath, 'same as the version that comes with DSpatch');
      continue;
    }
    const remarks = [
      // No path: the row it differs from is in the list, with its own.
      ...(different.length === 0 ? [] : ['differs from your file']),
      ...same.map((row) => `same as your file ${row.filePath}`),
    ];
    if (remarks.length > 0) {
      variants.set(shipped.filePath, remarks.join('; '));
    }
  }

  return { rows: rows.filter((row) => !hidden.has(row.filePath)), variants };
}

/** What makes two declarations the same loop, or `null` when it cannot be established. */
function fingerprint(row: LoopDefinitionRow, io: DefinitionIo): string | null {
  const { definition, graphPath } = row;
  const resolveRole = createDefinitionRoleResolver(row);
  if (definition === null || graphPath === null || resolveRole === null) {
    return null;
  }
  let graphText: string;
  try {
    graphText = io.readText(graphPath).replace(/^﻿/, '');
  } catch {
    return null;
  }
  const print = JSON.stringify({
    id: definition.id,
    name: definition.name,
    description: definition.description ?? null,
    resultRoot: definition.resultRoot ?? null,
    graph: graphText,
    roles: resolvedRolesWith(referencedRoles(graphText), resolveRole),
  });
  // On the serialised text, where a line ending in a graph or a role is the same escape.
  return print.replaceAll('\\r\\n', '\\n');
}
