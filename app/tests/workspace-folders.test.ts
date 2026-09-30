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

/* --- The store the workspace is remembered in ----------------------------- */

function storeIn(name: string): { store: ProjectStore; filePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-ws-${name}-`));
  roots.push(root);
  return {
    store: new ProjectStore(path.join(root, 'dspatch-projects.json')),
    filePath: path.join(root, 'dspatch-projects.json'),
  };
}

test('a workspace is remembered with its folders and its chosen definition', () => {
  const { store, filePath } = storeIn('remember');
  store.rememberWorkspace(
    {
      filePath: 'C:/w/my.dspatch-workspace.json',
      folders: ['C:/one', 'C:/two'],
      loopDefinitionKey: 'C:/one/.dspatch/loops/mine.loop.json',
    },
    '2026-09-20T10:00:00.000Z',
  );

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { formatVersion: number };
  assert.equal(onDisk.formatVersion, PROJECT_STORE_FORMAT_VERSION);
  const current = store.currentWorkspace();
  assert.equal(current?.loopDefinitionKey, 'C:/one/.dspatch/loops/mine.loop.json');
  assert.deepEqual(current?.folders, [path.resolve('C:/one'), path.resolve('C:/two')]);
});

test('saving the same workspace twice keeps one entry', () => {
  const { store } = storeIn('one-entry');
  const workspace = { filePath: 'C:/w/a.json', folders: ['C:/one'], loopDefinitionKey: null };
  store.rememberWorkspace(workspace);
  store.rememberWorkspace({ ...workspace, folders: ['C:/one', 'C:/two'] });
  assert.equal(store.read().workspaces.length, 1);
  assert.equal(store.currentWorkspace()?.folders.length, 2);
});

test('a version-1 file is read, has no workspaces, and is rewritten as version 2', () => {
  const { store, filePath } = storeIn('upgrade');
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      formatVersion: 1,
      recentProjects: [
        { path: 'C:/old', lastOpenedAtUtc: '2026-09-01T00:00:00.000Z', openCount: 4 },
      ],
    }),
    'utf8',
  );

  const before = store.read();
  assert.equal(before.readOnly, false);
  assert.equal(before.error, null);
  assert.equal(before.recentProjects.length, 1);
  assert.deepEqual(before.workspaces, []);

  store.rememberWorkspace({ filePath: null, folders: ['C:/one'], loopDefinitionKey: 'k' });
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    formatVersion: number;
    recentProjects: readonly { path: string; openCount: number }[];
  };
  assert.equal(onDisk.formatVersion, 2);
  // The projects that were there survive the upgrade untouched.
  assert.equal(onDisk.recentProjects[0]?.path, 'C:/old');
  assert.equal(onDisk.recentProjects[0]?.openCount, 4);
});

test('a file from a newer DSpatch is read for its workspaces and never rewritten', () => {
  const { store, filePath } = storeIn('newer');
  const future = {
    formatVersion: PROJECT_STORE_FORMAT_VERSION + 1,
    recentProjects: [{ path: 'C:/kept', lastOpenedAtUtc: '2026-10-01T00:00:00.000Z', openCount: 3 }],
    workspaces: [
      {
        filePath: 'C:/w/theirs.json',
        folders: ['C:/kept'],
        loopDefinitionKey: 'C:/kept/.dspatch/loops/theirs.loop.json',
        lastOpenedAtUtc: '2026-10-01T00:00:00.000Z',
      },
    ],
    somethingThisBuildHasNeverHeardOf: true,
  };
  fs.writeFileSync(filePath, JSON.stringify(future), 'utf8');

  const state = store.read();
  assert.equal(state.readOnly, true);
  assert.equal(state.workspaces.length, 1);
  assert.match(String(state.error), /newer/);

  store.rememberWorkspace({ filePath: null, folders: ['C:/mine'], loopDefinitionKey: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), future);
});

test('recording a project leaves the workspaces alone, and the other way round', () => {
  const { store } = storeIn('side-by-side');
  store.rememberWorkspace({
    filePath: null,
    folders: ['C:/one'],
    loopDefinitionKey: 'C:/one/.dspatch/loops/mine.loop.json',
  });
  store.recordOpened('C:/one', { conversationId: 'conv-1' });

  const state = store.read();
  assert.equal(state.workspaces.length, 1);
  assert.equal(
    state.workspaces[0]?.loopDefinitionKey,
    'C:/one/.dspatch/loops/mine.loop.json',
  );
  // The conversation pointer is on the project entry, and there is no second one on the
  // workspace to disagree with it. DSP-72 reopened this deliberately and kept it: a run
  // now has several working roots, but exactly one of them is the working directory,
  // which is the `cwd` the provider scopes its local agent store by — so which folder's
  // conversation this is still has one answer and still lives in one place.
  assert.equal(store.conversationFor('C:/one'), 'conv-1');
  assert.equal(
    Object.hasOwn(state.workspaces[0] ?? {}, 'lastConversationId'),
    false,
    'a workspace must not carry a second answer to which conversation this is',
  );
});
