/**
 * From the definition a person chose to everything a run needs from it.
 *
 * DSP-70. Until this module, "which loop runs" was not answerable by pointing at
 * anything: `main.ts` read `path.join(ownRoot, CHAT_LOOP_GRAPH_REL)` — a graph inside
 * DSpatch's own repository, whatever project was open and whatever the person had
 * chosen — and `describeChatLoopBinding` then refused any graph whose id was not
 * literally `dspatch-chat-loop`. Both of those are gone. What replaces them is a
 * selection: **a definition file path, and the graph, version and resource root that
 * follow from it**, resolved once and carried.
 *
 * Three properties are the whole of this module.
 *
 * **The same key, resolved by the same procedure, pinned once at start.** The preview
 * shown when `Use loop` is ticked and the run started by Send each call
 * {@link openChosenLoop} with the same key; they are two resolutions of one key, not
 * one resolution used twice, and each reads the files as they are at that moment.
 * That is deliberate: a preview that showed pinned bytes while the file on disk had
 * moved on would be a second wrong thing, differing from what Send would walk with
 * nothing on screen to say so. The pin belongs at the start of a run, and that is
 * where it is. The preview keeps up instead — the window re-reads it when it comes
 * back to the front, so the drawing on screen is the drawing on disk.
 *
 * **The version is the bytes.** `graphVersionId` hashes the text that was actually
 * read, so preview, run record and announcement all carry one value for one drawing —
 * and an edit to the file after the read produces a different value rather than
 * silently changing what a run claims to be walking.
 *
 * **A chosen loop is a value, not a lookup.** Once {@link openChosenLoop} has returned,
 * nothing in it is re-read. A run holds its own `ChosenLoop` for its lifetime, so
 * selecting something else or editing the file mid-run cannot reach it. That is not
 * DSpatch being polite about it: the Cursor SDK takes `dirs` on `Agent.create` and
 * `Agent.resume` and **never on `send`**, so a session's roots are fixed when it is
 * created. A run that swapped its definition halfway would be describing something the
 * provider cannot do.
 */

import { CHAT_LOOP_GRAPH_ID, describeChosenLoopBinding } from '../shared/loop-chat';
import type { LoopDefinitionChoice, LoopDefinitionListing } from '../shared/bridge';
import type { RoleResolver } from '../shared/loop-graph';
import {
  createDefinitionRoleResolver,
  describeDefinitionRow,
  discoverLoopDefinitions,
  nodeDefinitionIo,
  openLoopDefinitionFile,
  type DefinitionIo,
  type LoopDefinitionRow,
} from './loop-definition-files';
import { graphVersionIdFor } from './run-record-store';

/** The definition a run is walking, resolved once and then never looked up again. */
export interface ChosenLoop {
  readonly definitionId: string;
  readonly definitionName: string;
  /** The declaration file, which is also the key the window selects by. */
  readonly definitionPath: string;
  /**
   * The read anchor this definition declared, resolved.
   *
   * Carried because the editor draws role bindings and has to say what they were
   * measured from (DSP-82). It is the same root `resolveRole` is anchored at; keeping
   * both on one value is what stops a second, differently anchored answer appearing.
   */
  readonly resourceRoot: string;
  readonly graphPath: string;
  /** The bytes that were read. What runs, and what `graphVersionId` is the hash of. */
  readonly graphText: string;
  readonly graphVersionId: string;
  /** Anchored at the definition's resource root, never at the folder being worked on. */
  readonly resolveRole: RoleResolver;
}
export type ChosenLoopOutcome =
  | { readonly ok: true; readonly chosen: ChosenLoop }
  | { readonly ok: false; readonly note: string };

/**
 * The loops a person can choose between: the folders DSpatch is looking at, and the
 * files they pointed at by hand.
 *
 * **One list, not two.** A definition that belongs to no open folder is the case the
 * standalone development loop will arrive as, and it joins the same list through the
 * same row shape, labelled by origin as `chosen by hand` — which is the label
 * `describeDefinitionRow` already writes for it.
 *
 * Deduplicated by file path, and discovery wins. The open project may *be* DSpatch's
 * own working copy, and a file someone picked by hand may also sit in a folder that is
 * open: in both cases a second row would look like a second loop. Where it is is the
 * more useful of the two origins, so the discovered row is the one kept.
 */
export function listChoosableLoops(
  folderPaths: readonly string[],
  /**
   * Files the person pointed at.
   *
   * Since DSP-71 one of these can outlive the window: the workspace remembers the
   * definition that was chosen, and a remembered key from outside every open folder
   * is seeded back into this list on startup so the row it names exists to be chosen.
   * The rest are for as long as the window is open, which is what pointing at a file
   * has always meant.
   */
  pickedPaths: readonly string[] = [],
  io: DefinitionIo = nodeDefinitionIo,
  /**
   * The definition the open workspace remembers, if it is still loadable.
   *
   * DSP-71 collects the persistence question DSP-68 left open: a saved workspace
   * holds its chosen definition, and this is how that choice reaches the list it was
   * made in. A key that no longer resolves to a usable row falls through to the
   * ordinary default rather than preselecting something the list has just marked
   * unselectable.
   */
  preferredKey: string | null = null,
): LoopDefinitionListing {
  const folders = [...new Set(folderPaths.filter((folder) => folder !== ''))];
  const discovery = discoverLoopDefinitions(folders, io);

  const seen = new Set<string>();
  const keep = (filePath: string): boolean => {
    if (seen.has(filePath)) {
      return false;
    }
    seen.add(filePath);
    return true;
  };

  const rows = [
    ...discovery.rows.filter((row) => keep(row.filePath)),
    ...pickedPaths
      .filter((filePath) => filePath !== '')
      .map((filePath) => openLoopDefinitionFile(filePath, io))
      .filter((row) => keep(row.filePath)),
  ];

  // The binding is asked here rather than at Send, so a drawing that cannot run is
  // listed unselectable with its reason like any other row that cannot run. It costs
  // one graph read per loaded row — not per folder and never recursive, so discovery's
  // own cost property is untouched — and it is why this lives in the choice layer and
  // not in `discoverLoopDefinitions`.
  const judged = rows.map((row) => ({ row, refusal: bindingRefusalFor(row, io) }));
  // A refused row is not offered as the default either. Preselecting something the
  // list itself has just marked unselectable would be the same untruth one step on.
  const preselected = defaultChoiceFrom(
    judged.filter((entry) => entry.refusal === null).map((entry) => entry.row),
    preferredKey,
  );
  return {
    choices: judged.map((entry) =>
      describeChoice(entry.row, entry.refusal, entry.row.filePath === preselected),
    ),
    // A directory that exists and could not be listed is worth saying out loud: a
    // folder whose loops are unreadable otherwise looks like a folder with none.
    problems: discovery.folders
      .map((folder) => folder.problem)
      .filter((problem): problem is string => problem !== null),
  };
}

/**
 * Which row a list offers when the person has not chosen yet.
 *
 * DSpatch's own chat loop when it is there, so ticking `Use loop` in a fresh window
 * still offers the loop it offered before this card, and otherwise the only loop
 * there is. **This is a default selection, not a load path** — the difference that
 * matters is that the selection then travels explicitly and can be changed, whereas
 * the constant it replaces could not be.
 */
export function defaultChoiceFrom(
  rows: readonly LoopDefinitionRow[],
  /** What the open workspace remembers, which outranks the built-in preference. */
  preferredKey: string | null = null,
): string | null {
  const usable = rows.filter((row) => row.definition !== null);
  const remembered = usable.find((row) => row.filePath === preferredKey);
  const chatLoop = usable.find((row) => row.definition?.id === CHAT_LOOP_GRAPH_ID);
  return remembered?.filePath ?? chatLoop?.filePath ?? usable[0]?.filePath ?? null;
}

/**
 * The row a key names.
 *
 * A key that is in no folder's list is read as a definition the person pointed at by
 * hand, which is the same row shape through {@link openLoopDefinitionFile} rather than
 * a second mechanism with its own wording.
 */
export function rowForKey(
  rows: readonly LoopDefinitionRow[],
  key: string,
  io: DefinitionIo = nodeDefinitionIo,
): LoopDefinitionRow {
  return rows.find((row) => row.filePath === key) ?? openLoopDefinitionFile(key, io);
}

/**
 * Read what the chosen definition points at, or say why it could not be read.
 *
 * The graph is read here and nowhere else in a run's life. Everything downstream —
 * validation, the prompt's roles, the record header, the announcement — takes the text
 * and the resolver from the value this returns.
 */
export function openChosenLoop(
  row: LoopDefinitionRow,
  io: DefinitionIo = nodeDefinitionIo,
): ChosenLoopOutcome {
  const display = describeDefinitionRow(row);
  if (row.definition === null || row.graphPath === null) {
    return {
      ok: false,
      note:
        `The loop definition ${row.filePath} could not be read, so there is nothing to ` +
        `run or show:\n\n${display.error ?? 'No reason was recorded.'}`,
    };
  }

  let graphText: string;
  try {
    graphText = io.readText(row.graphPath);
  } catch (error) {
    return {
      ok: false,
      note:
        `"${row.definition.name}" points at ${row.graphPath} as its graph, and that file ` +
        `could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const resolveRole = createDefinitionRoleResolver(row);
  const resourceRoot = row.resourceRoot;
  if (resolveRole === null || resourceRoot === null) {
    return {
      ok: false,
      note: `"${row.definition.name}" has no resource root, so its roles cannot be reached.`,
    };
  }

  return {
    ok: true,
    chosen: {
      definitionId: row.definition.id,
      definitionName: row.definition.name,
      definitionPath: row.filePath,
      resourceRoot,
      graphPath: row.graphPath,
      graphText,
      graphVersionId: graphVersionIdFor(graphText),
      resolveRole,
    },
  };
}

/**
 * Why this row's drawing may not be walked from chat, or `null`.
 *
 * The graph is read for its `id` alone — no validation, no roles — because that is
 * all {@link describeChosenLoopBinding} asks about, and the list should not be doing
 * a run's work to draw a row.
 *
 * A graph that cannot be read or parsed answers `null` rather than a refusal of its
 * own. Not because it can run, but because *why* it cannot is a question the preview
 * and Send both answer properly, with the file's own error; inventing a shorter
 * version of that here would be the second wording this row shape exists to avoid.
 */
function bindingRefusalFor(row: LoopDefinitionRow, io: DefinitionIo): string | null {
  if (row.definition === null || row.graphPath === null) {
    return null;
  }
  let graph: unknown;
  try {
    graph = JSON.parse(io.readText(row.graphPath).replace(/^\uFEFF/, '')) as unknown;
  } catch {
    return null;
  }
  if (typeof graph !== 'object' || graph === null) {
    return null;
  }
  const fields = graph as Record<string, unknown>;
  const id = typeof fields['id'] === 'string' ? fields['id'] : null;
  if (id === null) {
    return null;
  }
  const binding = describeChosenLoopBinding(
    { id, name: typeof fields['name'] === 'string' ? fields['name'] : id },
    row.definition.name,
  );
  return binding.ready ? null : binding.reason;
}

function describeChoice(
  row: LoopDefinitionRow,
  refusal: string | null,
  preselected: boolean,
): LoopDefinitionChoice {
  return {
    key: row.filePath,
    definitionId: row.definition?.id ?? null,
    usable: row.definition !== null && refusal === null,
    preselected,
    // `describeDefinitionRow` and not a second wording. The display fields and the
    // per-row error text are built and tested where the rows are; rewording them here
    // would make one row say two things depending on which surface read it. A binding
    // refusal goes in the same `error` field for the same reason — a row that cannot
    // run says so in one place, whether the declaration or the drawing is the reason.
    display: { ...describeDefinitionRow(row), ...(refusal === null ? {} : { error: refusal }) },
  };
}
