/**
 * A workspace of open folders, and the two questions a tree asks of the disk.
 *
 * DSP-71 and DSP-73. What is worth testing here is almost entirely about cost and
 * about not steering anything, rather than about a value coming back the way it went
 * in:
 *
 * - **One `readdir` per expansion, counted.** "Nothing recursive" is a claim that is
 *   either asserted or is not true. The fake filesystem below records every call, and
 *   the assertions are on that log — including a `node_modules` under the directory
 *   being expanded, which is the case the criterion exists for.
 * - **A cap counted out loud.** A folder with more entries than the cap must draw a
 *   bounded list *and say how much it is not showing*.
 * - **A refusal with a reason.** A binary file and an oversized one are each refused
 *   or truncated with something a person can read.
 * - **A workspace holds folders and a loop, and nothing else.** DSP-71 #5 is a
 *   property of the bytes, so it is asserted on the bytes.
 *
 *     node --test tests/workspace-folders.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  DIRECTORY_PAGE_CAP,
  FILE_VIEW_BYTE_LIMIT,
  addFolderTo,
  decideFileView,
  describeDirectoryCap,
  folderDisplayName,
  looksBinary,
  parseWorkspaceFile,
  removeFolderFrom,
  workspaceFileText,
  WORKSPACE_FILE_FORMAT_VERSION,
} from '../src/shared/workspace-folders.ts';
import { readDirectoryPage, readFileForViewing, type TreeIo } from '../src/main/workspace-tree.ts';
import { PROJECT_STORE_FORMAT_VERSION, ProjectStore } from '../src/main/project-store.ts';

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A filesystem that remembers what it was asked.
 *
 * The log is the evidence. A tree that walked a subtree would pass every assertion
 * about what is on screen and fail here, which is the only place the difference shows.
 */
function countingIo(tree: Readonly<Record<string, readonly string[]>>): {
  io: TreeIo;
  calls: string[];
} {
  const calls: string[] = [];
  const io: TreeIo = {
    listDirectory: (dir) => {
      calls.push(`list ${dir}`);
      const names = tree[dir];
      if (names === undefined) {
        const error = new Error(`ENOENT: no such directory, scandir '${dir}'`);
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      }
      return names.map((name) => ({
        name,
        // A name with no extension is a directory in this fake, which is enough to
        // exercise the kinds without a second table to keep in step.
        directory: !name.includes('.'),
      }));
    },
    statFile: (file) => {
      calls.push(`stat ${file}`);
      return { size: 0, directory: false };
    },
    readHead: (file) => {
      calls.push(`read ${file}`);
      return new Uint8Array();
    },
    readText: (file) => {
      calls.push(`text ${file}`);
      return '';
    },
    writeText: (file) => {
      calls.push(`write ${file}`);
    },
  };
  return { io, calls };
}

/* --- One directory, once -------------------------------------------------- */

test('expanding a directory reads that directory and nothing under it', () => {
  const root = path.resolve('/w/project');
  const { io, calls } = countingIo({
    [root]: ['src', 'node_modules', 'readme.md'],
    [path.join(root, 'src')]: ['deep', 'index.ts'],
    [path.join(root, 'node_modules')]: Array.from({ length: 4000 }, (_, i) => `pkg-${String(i)}`),
    [path.join(root, 'src', 'deep')]: ['leaf.ts'],
  });

  const page = readDirectoryPage(root, io);

  assert.deepEqual(calls, [`list ${root}`]);
  assert.equal(page.problem, null);
  assert.deepEqual(
    page.entries.map((entry) => entry.name),
    ['node_modules', 'src', 'readme.md'],
  );
  // Directories first, then files, and the kinds are what the one read returned —
  // no `stat` per child, which the call log is the proof of.
  assert.deepEqual(
    page.entries.map((entry) => entry.kind),
    ['directory', 'directory', 'file'],
  );
});

test('expanding a second directory costs exactly one more read', () => {
  const root = path.resolve('/w/project');
  const { io, calls } = countingIo({
    [root]: ['src'],
    [path.join(root, 'src')]: ['index.ts'],
  });
  readDirectoryPage(root, io);
  readDirectoryPage(path.join(root, 'src'), io);
  assert.equal(calls.length, 2);
});

test('a folder with more entries than the cap shows a counted cap rather than stalling', () => {
  const root = path.resolve('/w/many');
  const { io } = countingIo({
    [root]: Array.from({ length: DIRECTORY_PAGE_CAP + 700 }, (_, i) => `file-${String(i)}.txt`),
  });

  const page = readDirectoryPage(root, io);

  assert.equal(page.entries.length, DIRECTORY_PAGE_CAP);
  assert.equal(page.total, DIRECTORY_PAGE_CAP + 700);
  const note = describeDirectoryCap(page);
  assert.ok(note !== null, 'a capped listing must say so');
  assert.match(note, new RegExp(String(DIRECTORY_PAGE_CAP)));
  assert.match(note, new RegExp(String(DIRECTORY_PAGE_CAP + 700)));
});

test('a folder that is not capped says nothing about a cap', () => {
  const root = path.resolve('/w/small');
  const { io } = countingIo({ [root]: ['a.txt', 'b.txt'] });
  assert.equal(describeDirectoryCap(readDirectoryPage(root, io)), null);
});

test('a directory that cannot be listed reports its reason and loses nothing else', () => {
  const root = path.resolve('/w/project');
  const { io } = countingIo({ [root]: ['src'] });
  const page = readDirectoryPage(path.join(root, 'nowhere'), io);
  assert.deepEqual(page.entries, []);
  assert.match(String(page.problem), /could not be listed/);
  // The sibling still lists. One unreadable folder is one folder, not the tree.
  assert.equal(readDirectoryPage(root, io).entries.length, 1);
});

/* --- One file, for reading ------------------------------------------------ */

test('a binary file is refused with a stated reason', () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]);
  assert.equal(looksBinary(bytes), true);
  const view = decideFileView({
    path: 'C:/w/picture.png',
    bytes,
    byteLength: bytes.length,
    decode: () => 'never reached',
  });
  assert.equal(view.kind, 'refused');
  assert.match(view.kind === 'refused' ? view.reason : '', /binary/);
});

test('a large file is truncated and says how much of it is on screen', () => {
  const bytes = new Uint8Array(FILE_VIEW_BYTE_LIMIT);
  bytes.fill(0x61);
  const view = decideFileView({
    path: 'C:/w/huge.log',
    bytes,
    byteLength: FILE_VIEW_BYTE_LIMIT * 9,
    decode: () => 'a'.repeat(FILE_VIEW_BYTE_LIMIT),
  });
  assert.equal(view.kind, 'text');
  assert.equal(view.kind === 'text' ? view.truncated : false, true);
  const note = view.kind === 'text' ? String(view.note) : '';
  assert.match(note, new RegExp(String(FILE_VIEW_BYTE_LIMIT)));
  assert.match(note, new RegExp(String(FILE_VIEW_BYTE_LIMIT * 9)));
});

test('an ordinary text file is shown whole and says nothing extra', () => {
  const text = 'export const answer = 42;\n';
  const bytes = new TextEncoder().encode(text);
  const view = decideFileView({
    path: 'C:/w/thing.ts',
    bytes,
    byteLength: bytes.length,
    decode: () => text,
  });
  assert.equal(view.kind, 'text');
  assert.equal(view.kind === 'text' ? view.text : '', text);
  assert.equal(view.kind === 'text' ? view.note : 'set', null);
});

test('reading a file touches that file and nothing else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-tree-read-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'readme.txt'), 'MARKER-readable-text\n', 'utf8');
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'other.txt'), 'not this one\n', 'utf8');

  const view = readFileForViewing(path.join(root, 'readme.txt'));
  assert.equal(view.kind, 'text');
  assert.match(view.kind === 'text' ? view.text : '', /MARKER-readable-text/);

  // The reading view is a read. There is no session, no working copy and no run in
  // reach of this function, which is DSP-73 #3 as a property of the module rather
  // than of the caller: the only argument is a path and the only result is bytes.
  const asFolder = readFileForViewing(root);
  assert.equal(asFolder.kind, 'refused');
});

/* --- The saved workspace file --------------------------------------------- */

test('a saved workspace holds its folders and its loop definition, and nothing else', () => {
  const text = workspaceFileText({
    folders: ['C:/one', 'C:/two', 'C:/three'],
    loopDefinitionKey: 'C:/one/.dspatch/loops/mine.loop.json',
  });
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), [
    'folders',
    'format',
    'formatVersion',
    'loopDefinition',
  ]);
  assert.equal(parsed['formatVersion'], WORKSPACE_FILE_FORMAT_VERSION);

  const read = parseWorkspaceFile(text, 'C:/w/my.dspatch-workspace.json');
  assert.equal(read.ok, true);
  assert.deepEqual(read.ok ? read.workspace.folders : [], ['C:/one', 'C:/two', 'C:/three']);
  assert.equal(
    read.ok ? read.workspace.loopDefinitionKey : null,
    'C:/one/.dspatch/loops/mine.loop.json',
  );
});

test('a workspace file that will not parse says so rather than reading as empty', () => {
  const read = parseWorkspaceFile('{ not json', 'C:/w/broken.json');
  assert.equal(read.ok, false);
  assert.match(read.ok ? '' : read.problem, /C:\/w\/broken\.json/);
});

test('a workspace file from a newer DSpatch is refused rather than opened', () => {
  const text = JSON.stringify({
    format: 'dspatch-workspace',
    formatVersion: WORKSPACE_FILE_FORMAT_VERSION + 1,
    folders: [{ path: 'C:/one' }],
  });
  const read = parseWorkspaceFile(text, 'C:/w/future.json');
  assert.equal(read.ok, false);
  assert.match(read.ok ? '' : read.problem, /newer/);
});

test('a JSON file that is not a workspace is not opened as one', () => {
  const read = parseWorkspaceFile(JSON.stringify({ hello: 'world' }), 'C:/w/other.json');
  assert.equal(read.ok, false);
  assert.match(read.ok ? '' : read.problem, /dspatch-workspace/);
});

/* --- The list of folders -------------------------------------------------- */

test('removing a folder removes the link and nothing else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-workspace-remove-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'keep.txt'), 'still here\n', 'utf8');

  const folders = addFolderTo(['C:/other'], root, false);
  const after = removeFolderFrom(folders, root, false);

  assert.deepEqual(after, ['C:/other']);
  assert.equal(fs.existsSync(path.join(root, 'keep.txt')), true);
  assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'still here\n');
});

test('the same folder is not opened twice, and Windows paths differ in case without differing', () => {
  assert.deepEqual(addFolderTo(['C:/One'], 'C:/one', true), ['C:/One']);
  assert.deepEqual(addFolderTo(['C:/One'], 'C:/one', false), ['C:/One', 'C:/one']);
});

test('a root is named by its last segment, and a drive root by itself', () => {
  assert.equal(folderDisplayName('C:\\work\\dspatch'), 'dspatch');
  assert.equal(folderDisplayName('/home/nicla/dspatch/'), 'dspatch');
  assert.equal(folderDisplayName('C:\\'), 'C:\\');
});

/* The store the workspace is remembered in is tested in project-store.test.ts (DSP-149). */
