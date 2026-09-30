/**
 * The disk, as the two questions a file tree is allowed to ask it.
 *
 * DSP-73. The filesystem is injected for the same reason `loop-definition-files.ts`
 * injects it: "one `readdir` per expansion, no `stat` per child, nothing recursive
 * ever" is the kind of claim that is either counted by a test or is not true. The
 * counting is why {@link TreeIo} exists at all.
 *
 * Nothing here selects, opens a session, or touches a run. A listing is a listing.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  DIRECTORY_PAGE_CAP,
  FILE_VIEW_BYTE_LIMIT,
  decideFileView,
  sortDirectoryEntries,
  type DirectoryEntry,
  type DirectoryPage,
  type FileView,
} from '../shared/workspace-folders';

/**
 * What a tree may do to the disk.
 *
 * Four operations, and the shape of each is the budget. `listDirectory` answers with
 * names **and kinds together**, which is `withFileTypes`: the version that returned
 * names alone would need a `stat` per child to draw a folder icon, and that is the
 * per-child cost this interface exists to make impossible to write by accident.
 */
export interface TreeIo {
  readonly listDirectory: (dir: string) => readonly { name: string; directory: boolean }[];
  /** Size in bytes, and whether it is a directory. One call, on the file being opened. */
  readonly statFile: (file: string) => { size: number; directory: boolean };
  /** At most `limit` bytes from the front of the file. */
  readonly readHead: (file: string, limit: number) => Uint8Array;
  readonly readText: (file: string) => string;
  readonly writeText: (file: string, text: string) => void;
}

export const nodeTreeIo: TreeIo = {
  listDirectory: (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      // A symlink is drawn as a file rather than followed. Following one is how a
      // tree with a bounded cost acquires an unbounded one, and it is not needed to
      // read a repository.
      directory: entry.isDirectory(),
    })),
  statFile: (file) => {
    const stats = fs.statSync(file);
    return { size: stats.size, directory: stats.isDirectory() };
  },
  readHead: (file, limit) => {
    const handle = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(limit);
      const read = fs.readSync(handle, buffer, 0, limit, 0);
      return new Uint8Array(buffer.subarray(0, read));
    } finally {
      fs.closeSync(handle);
    }
  },
  readText: (file) => fs.readFileSync(file, 'utf8'),
  writeText: (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  },
};

/**
 * The children of one directory.
 *
 * **Exactly one `listDirectory`, whatever is in there.** No recursion, no count of a
 * subtree, no "does this folder have children" — a directory is drawn as expandable
 * because it is a directory, and finding out whether the expansion would be empty
 * costs the read this function exists to defer.
 *
 * A directory that cannot be listed answers with its reason rather than throwing. A
 * permission-denied folder inside an open root is ordinary, and losing the whole tree
 * to one of them would be the blast radius `discoverLoopDefinitions` already refuses.
 */
export function readDirectoryPage(
  dirPath: string,
  io: TreeIo = nodeTreeIo,
  cap: number = DIRECTORY_PAGE_CAP,
): DirectoryPage {
  const resolved = path.resolve(dirPath);
  let names: readonly { name: string; directory: boolean }[];
  try {
    names = io.listDirectory(resolved);
  } catch (error) {
    return {
      path: resolved,
      entries: [],
      total: 0,
      problem: `This folder could not be listed: ${describe(error)}`,
    };
  }

  const all: DirectoryEntry[] = names.map((entry) => ({
    name: entry.name,
    path: path.join(resolved, entry.name),
    kind: entry.directory ? 'directory' : 'file',
  }));
  // Sorted before the cap, so what is shown is the front of the list a person expects
  // rather than the front of whatever order the filesystem happened to return.
  const sorted = sortDirectoryEntries(all);
  return {
    path: resolved,
    entries: sorted.slice(0, cap),
    total: all.length,
    problem: null,
  };
}

/**
 * One file, for reading.
 *
 * A `stat` and a bounded read, in that order, and the read never exceeds
 * {@link FILE_VIEW_BYTE_LIMIT} however large the file is. What to do with the bytes
 * is {@link decideFileView}'s decision — refuse a binary, truncate an oversized one,
 * say so either way — so the rule a person meets is the rule a test exercises without
 * arranging a file.
 */
export function readFileForViewing(filePath: string, io: TreeIo = nodeTreeIo): FileView {
  const resolved = path.resolve(filePath);
  let size: number;
  try {
    const stats = io.statFile(resolved);
    if (stats.directory) {
      return {
        kind: 'refused',
        path: resolved,
        reason: 'This is a folder, not a file. Expand it to see what is inside.',
      };
    }
    size = stats.size;
  } catch (error) {
    return { kind: 'refused', path: resolved, reason: `This file could not be read: ${describe(error)}` };
  }

  let bytes: Uint8Array;
  try {
    bytes = io.readHead(resolved, Math.min(size, FILE_VIEW_BYTE_LIMIT));
  } catch (error) {
    return { kind: 'refused', path: resolved, reason: `This file could not be read: ${describe(error)}` };
  }

  return decideFileView({
    path: resolved,
    bytes,
    byteLength: size,
    decode: (value) => Buffer.from(value).toString('utf8'),
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
