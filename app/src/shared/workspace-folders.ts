/**
 * A workspace of open folders, and the two questions a tree asks of the disk.
 *
 * DSP-71 and DSP-73. Everything here is a value or a decision about a value: no
 * `node:fs`, so the renderer can import the same rules the main process enforces and
 * a test can exercise them without a filesystem.
 *
 * Three properties are the whole of this module, and all three are about cost or
 * about not steering anything.
 *
 * **A listing is one directory.** {@link DIRECTORY_PAGE_CAP} bounds what one
 * expansion returns, and {@link describeDirectoryCap} says out loud that it did.
 * Nothing here asks a question whose answer is proportional to the repository —
 * not a count of a subtree, not "does this folder have children", not a `stat` per
 * child. Someone will open a folder with `node_modules` in it, and the reason that
 * is survivable is that no code path exists to walk it.
 *
 * **A file is opened for reading, and refused when reading it is not the right
 * answer.** {@link decideFileView} takes the bytes and decides; the reason a person
 * reads is the reason this function computed, not a shrug from the view.
 *
 * **A workspace is folders and a chosen loop definition, and nothing else.** No run
 * results, no conversation, no selection. DSP-71 #5 is a property of
 * {@link workspaceFileText}: it writes these two fields and there is no third to
 * forget to leave out.
 */

import type { WorkingRootsDescription } from './working-roots';

/** What a saved workspace file says it is. Checked on read, written on save. */
export const WORKSPACE_FILE_FORMAT = 'dspatch-workspace';
export const WORKSPACE_FILE_FORMAT_VERSION = 1;

/** The extension Save workspace… offers and Open workspace… filters on. */
export const WORKSPACE_FILE_EXTENSION = 'dspatch-workspace.json';

/**
 * The folders a person has open, and the loop they chose.
 *
 * `loopDefinitionKey` is the declaration file's path — the same key
 * `listLoopDefinitions` hands out and `prepareChatLoop` takes. Collecting it here is
 * what DSP-68 deferred: the manual picker deliberately remembered nothing across a
 * restart because a second store invented there is one this card would have had to
 * undo. `null` means the person has not chosen, which is different from having
 * chosen nothing.
 */
export interface SavedWorkspace {
  readonly folders: readonly string[];
  readonly loopDefinitionKey: string | null;
}

/** A root in the tree: the folder, and the name it is drawn under. */
export interface WorkspaceFolderView {
  readonly path: string;
  readonly name: string;
  /**
   * True for the one folder a run works in.
   *
   * There is exactly one for now, and it is the project the chat session opened.
   * DSP-72 is where several working roots in a run get their meaning; until then a
   * folder added to the workspace is a folder DSpatch can *show* and look for loop
   * definitions in, and the run's working copy is unchanged by adding or removing
   * one. The flag exists so the window can say which is which rather than implying
   * that all of them are worked in.
   */
  readonly working: boolean;
}

/** What the window draws as the tree's roots, and where the workspace came from. */
export interface WorkspaceView {
  readonly folders: readonly WorkspaceFolderView[];
  readonly loopDefinitionKey: string | null;
  /** The saved file this workspace was opened from or saved to. `null` when unsaved. */
  readonly filePath: string | null;
  /** Set when something about the workspace could not be done, and says what. */
  readonly problem: string | null;
  /**
   * What these folders are, and what they are not, in words for a person.
   *
   * DSP-72 #6. `describeWorkingRootsForPerson` writes it in the main process and the
   * sidebar draws the headline with the rest behind a disclosure. It lives on the view
   * rather than being composed in the renderer so that the folders a run is given and
   * the sentence a person reads about them come from one place: a window that described
   * a different list from the one the provider received would be worse than a window
   * that described nothing.
   *
   * `null` when no folder is open, which is when the sidebar draws nothing at all.
   */
  readonly rootsNote: WorkingRootsDescription | null;
}

export const EMPTY_WORKSPACE_VIEW: WorkspaceView = {
  folders: [],
  loopDefinitionKey: null,
  filePath: null,
  problem: null,
  rootsNote: null,
};

/* ------------------------------------------------------------------------- */
/* Folder lists                                                              */
/* ------------------------------------------------------------------------- */

/** Windows paths differ in case without differing. Same rule as `ProjectStore`. */
export function sameFolder(left: string, right: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * The last segment of a path, as a name for a root.
 *
 * Deliberately string work rather than `path.basename`: the renderer draws these and
 * must not import a Node module to do it. A drive root has no last segment, so it is
 * drawn as itself — `C:\` is a better name for `C:\` than an empty one.
 */
export function folderDisplayName(folderPath: string): string {
  const trimmed = folderPath.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (cut === -1) {
    // No segment to take, so the path is its own name. `C:\` is a better name for
    // `C:\` than `C:` is, which is why the original is returned rather than the
    // trimmed form.
    return folderPath;
  }
  const name = trimmed.slice(cut + 1);
  return name === '' ? folderPath : name;
}

/** Append a folder unless it is already open. Returns the list as it now stands. */
export function addFolderTo(
  folders: readonly string[],
  folderPath: string,
  caseInsensitive: boolean,
): readonly string[] {
  return folders.some((open) => sameFolder(open, folderPath, caseInsensitive))
    ? folders
    : [...folders, folderPath];
}

/**
 * Drop a folder from the list.
 *
 * **The link and nothing else.** DSP-71 #2: no file is deleted, no folder is touched
 * and no conversation is removed — this function has no way to do any of those,
 * which is the point of it being a list operation on strings.
 */
export function removeFolderFrom(
  folders: readonly string[],
  folderPath: string,
  caseInsensitive: boolean,
): readonly string[] {
  return folders.filter((open) => !sameFolder(open, folderPath, caseInsensitive));
}

/* ------------------------------------------------------------------------- */
/* The saved workspace file                                                  */
/* ------------------------------------------------------------------------- */

export type WorkspaceFileRead =
  | { readonly ok: true; readonly workspace: SavedWorkspace }
  | { readonly ok: false; readonly problem: string };

/**
 * What a workspace file says, or why it says nothing usable.
 *
 * A file that will not parse is reported rather than treated as empty. An empty
 * workspace and an unreadable one look identical on screen otherwise, and the second
 * is the one where the person's folders have gone missing.
 */
export function parseWorkspaceFile(text: string, filePath: string): WorkspaceFileRead {
  let parsed: unknown;
  try {
    // The same leading-BOM strip the loop definitions do. PowerShell's `Set-Content
    // -Encoding utf8` writes one on Windows PowerShell 5, and a file written that way
    // is not the person's mistake to debug.
    parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch (error) {
    return {
      ok: false,
      problem:
        `${filePath} is not valid JSON, so the folders it lists could not be opened: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: `${filePath} does not contain a JSON object.` };
  }
  const fields = parsed as Record<string, unknown>;
  if (fields['format'] !== WORKSPACE_FILE_FORMAT) {
    return {
      ok: false,
      problem:
        `${filePath} does not say it is a DSpatch workspace — a workspace file has ` +
        `"format": ${JSON.stringify(WORKSPACE_FILE_FORMAT)}. It was left as it is.`,
    };
  }
  const version = fields['formatVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, problem: `${filePath} has no usable "formatVersion".` };
  }
  if (version > WORKSPACE_FILE_FORMAT_VERSION) {
    return {
      ok: false,
      problem:
        `${filePath} is workspace format version ${String(version)}, newer than the ` +
        `${String(WORKSPACE_FILE_FORMAT_VERSION)} this build understands. It was not ` +
        `opened and it was not changed.`,
    };
  }

  const rawFolders = fields['folders'];
  const folders = Array.isArray(rawFolders)
    ? rawFolders
        .map((entry) =>
          typeof entry === 'string'
            ? entry
            : typeof entry === 'object' && entry !== null
              ? ((entry as Record<string, unknown>)['path'] as unknown)
              : null,
        )
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
  const key = fields['loopDefinition'];
  return {
    ok: true,
    workspace: {
      folders,
      loopDefinitionKey: typeof key === 'string' && key !== '' ? key : null,
    },
  };
}

/**
 * The bytes of a saved workspace.
 *
 * Two fields, and DSP-71 #5 is the absence of a third: there is no run result here,
 * no conversation id, no selection and no open file. A workspace says which folders
 * and which loop, and a person can read the file and see that it does.
 */
export function workspaceFileText(workspace: SavedWorkspace): string {
  return `${JSON.stringify(
    {
      format: WORKSPACE_FILE_FORMAT,
      formatVersion: WORKSPACE_FILE_FORMAT_VERSION,
      folders: workspace.folders.map((folder) => ({ path: folder })),
      loopDefinition: workspace.loopDefinitionKey,
    },
    null,
    2,
  )}\n`;
}

/* ------------------------------------------------------------------------- */
/* One directory, once                                                       */
/* ------------------------------------------------------------------------- */

/**
 * How many children one expansion returns.
 *
 * DSP-73 #2. A cap rather than a stall, and counted out loud rather than silently:
 * a folder of forty thousand generated files should draw something a person can read
 * and say how much it is not showing. The number is large enough that no hand-written
 * directory meets it and small enough that the renderer is not asked to lay out a
 * repository.
 */
export const DIRECTORY_PAGE_CAP = 500;

export interface DirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: 'directory' | 'file';
}

/**
 * What one expansion found.
 *
 * `total` is the number of names the one `readdir` returned; `entries` is at most
 * {@link DIRECTORY_PAGE_CAP} of them. There is no third number, because a third
 * number would have to come from somewhere and everywhere it could come from is a
 * second read.
 */
export interface DirectoryPage {
  readonly path: string;
  readonly entries: readonly DirectoryEntry[];
  readonly total: number;
  /** Set when the directory could not be listed, and says why. `entries` is empty. */
  readonly problem: string | null;
}

/** Directories first, then files, each by name. The order a person expects. */
export function sortDirectoryEntries(
  entries: readonly DirectoryEntry[],
): readonly DirectoryEntry[] {
  return [...entries].sort((left, right) =>
    left.kind === right.kind
      ? left.name.localeCompare(right.name)
      : left.kind === 'directory'
        ? -1
        : 1,
  );
}

/** The sentence a capped listing shows, or `null` when nothing was left out. */
export function describeDirectoryCap(page: DirectoryPage): string | null {
  const hidden = page.total - page.entries.length;
  return hidden <= 0
    ? null
    : `Showing ${String(page.entries.length)} of ${String(page.total)} entries. ` +
        `${String(hidden)} more ${hidden === 1 ? 'is' : 'are'} in this folder and not drawn.`;
}

/* ------------------------------------------------------------------------- */
/* One file, for reading                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The most a reading view will hold.
 *
 * DSP-73 #4. A megabyte is more source than anyone reads in a sidebar and small
 * enough that the renderer is never handed a string that costs a frame to lay out.
 */
export const FILE_VIEW_BYTE_LIMIT = 1_000_000;

/** How much of a file is examined to decide whether it is text. */
export const FILE_VIEW_SNIFF_BYTES = 8_192;

/**
 * Whether these bytes are something a text view would mangle.
 *
 * A NUL byte in the first {@link FILE_VIEW_SNIFF_BYTES} is the test, which is the
 * one git uses and is wrong in the same rare places. It is deliberately cheap: the
 * alternative is decoding the file to find out whether it should be decoded.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, FILE_VIEW_SNIFF_BYTES);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * A file the reading view is showing, or a file it is refusing and why.
 *
 * `note` on a shown file is not decoration: a truncated file that did not say so
 * would be a view that quietly lies about what the file contains, which is worse
 * than refusing it.
 */
export type FileView =
  | {
      readonly kind: 'text';
      readonly path: string;
      readonly text: string;
      readonly byteLength: number;
      readonly truncated: boolean;
      readonly note: string | null;
    }
  | { readonly kind: 'refused'; readonly path: string; readonly reason: string };

/**
 * What to show for these bytes.
 *
 * Pure, so the size and binary rules are decided in one place and a test can hand it
 * bytes rather than arrange a file. The caller reads at most
 * {@link FILE_VIEW_BYTE_LIMIT} bytes and says how long the file actually is, so a
 * 900 MB file costs a `stat` and a bounded read and never a 900 MB string.
 */
export function decideFileView(options: {
  readonly path: string;
  /** The first {@link FILE_VIEW_BYTE_LIMIT} bytes, or all of them if fewer. */
  readonly bytes: Uint8Array;
  /** The whole file's length, which may be larger than `bytes`. */
  readonly byteLength: number;
  readonly decode: (bytes: Uint8Array) => string;
}): FileView {
  if (looksBinary(options.bytes)) {
    return {
      kind: 'refused',
      path: options.path,
      reason:
        'This looks like a binary file — there is a zero byte in the first ' +
        `${String(FILE_VIEW_SNIFF_BYTES)} bytes — so it was not opened as text. ` +
        'DSpatch shows a reading view for text at this stage and nothing else.',
    };
  }
  const truncated = options.byteLength > options.bytes.length;
  return {
    kind: 'text',
    path: options.path,
    text: options.decode(options.bytes),
    byteLength: options.byteLength,
    truncated,
    note: truncated
      ? `Showing the first ${String(options.bytes.length)} bytes of ` +
        `${String(options.byteLength)}. The rest of the file is not here — this is a ` +
        'reading view, not an editor, and it will not load a file this size.'
      : null,
  };
}

/* ------------------------------------------------------------------------- */
/* Sidebar width                                                             */
/* ------------------------------------------------------------------------- */

/** The chat keeps the main space (DSP-73 #5), and these are the numbers that hold it. */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 560;
export const SIDEBAR_DEFAULT_WIDTH = 300;

/** Keep a dragged width inside the bounds. */
export function clampSidebarWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
    : SIDEBAR_DEFAULT_WIDTH;
}
