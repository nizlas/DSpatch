/**
 * The remembered-projects file.
 *
 * The behaviour worth testing is not that a path round-trips. It is what happens
 * to a file this code does not fully understand: DSP-4 will extend this store
 * rather than add a second one, so a future DSpatch will write fields this build
 * has never heard of, and the failure mode to avoid is *this* build quietly
 * rewriting that file and dropping them. The same applies to a file a user has
 * hand-edited into invalid JSON — it is their data, and overwriting it is worse
 * than losing the list.
 *
 *     node --test tests/project-store.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  PROJECT_STORE_FORMAT_VERSION,
  ProjectStore,
} from '../src/main/project-store.ts';

const roots: string[] = [];

function storeIn(name: string): { store: ProjectStore; filePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-store-${name}-`));
  roots.push(root);
  const filePath = path.join(root, 'nested', 'dspatch-projects.json');
  return { store: new ProjectStore(filePath), filePath };
}

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no file yet is the normal first run, not an error', () => {
  const { store } = storeIn('missing');
  const state = store.read();
  assert.deepEqual(state.recentProjects, []);
  assert.equal(state.error, null);
  assert.equal(state.readOnly, false);
  assert.equal(state.formatVersion, PROJECT_STORE_FORMAT_VERSION);
});

test('opening a project writes a versioned file, creating the directory', () => {
  const { store, filePath } = storeIn('write');
  const state = store.recordOpened(path.join(os.tmpdir(), 'project-one'), {
    atUtc: '2026-09-14T21:00:00.000Z',
  });
  assert.equal(state.error, null);
  assert.equal(state.recentProjects.length, 1);

  const onDisk: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal((onDisk as { formatVersion: number }).formatVersion, 1);
  assert.equal(store.read().recentProjects[0]?.openCount, 1);
  assert.equal(store.read().recentProjects[0]?.lastOpenedAtUtc, '2026-09-14T21:00:00.000Z');
});

test('the newest project comes first and its open count grows', () => {
  const { store } = storeIn('order');
  const first = path.join(os.tmpdir(), 'project-one');
  const second = path.join(os.tmpdir(), 'project-two');
  store.recordOpened(first);
  store.recordOpened(second);
  assert.equal(store.read().recentProjects[0]?.path, path.resolve(second));

  store.recordOpened(first);
  const state = store.read();
  assert.equal(state.recentProjects[0]?.path, path.resolve(first));
  assert.equal(state.recentProjects[0]?.openCount, 2);
  assert.equal(state.recentProjects.length, 2);
});

test('a file from a newer DSpatch is read but never rewritten', () => {
  const { store, filePath } = storeIn('newer');
  const future = {
    formatVersion: PROJECT_STORE_FORMAT_VERSION + 1,
    recentProjects: [
      { path: 'C:/kept', lastOpenedAtUtc: '2026-10-01T00:00:00.000Z', openCount: 3 },
    ],
    conversationsAddedByALaterVersion: [{ id: 'x' }],
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(future, null, 2), 'utf8');

  const state = store.read();
  assert.equal(state.readOnly, true);
  assert.equal(state.recentProjects.length, 1);
  assert.match(String(state.error), /newer/);

  // The list the window shows is updated; the file is not touched.
  const afterOpen = store.recordOpened(path.join(os.tmpdir(), 'project-new'));
  assert.equal(afterOpen.recentProjects[0]?.path, path.resolve(path.join(os.tmpdir(), 'project-new')));
  const unchanged: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(unchanged, future);
});

test('an unparsable file is reported and left alone', () => {
  const { store, filePath } = storeIn('broken');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{ this is not json', 'utf8');

  const state = store.read();
  assert.equal(state.readOnly, true);
  assert.deepEqual(state.recentProjects, []);
  assert.match(String(state.error), /not valid JSON/);

  store.recordOpened(path.join(os.tmpdir(), 'project-x'));
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{ this is not json');
});

test('entries that are not usable are skipped rather than crashing the list', () => {
  const { store, filePath } = storeIn('junk');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      formatVersion: 1,
      recentProjects: [
        { path: '' },
        { path: 42 },
        'not an object',
        { path: 'C:/good' },
      ],
    }),
    'utf8',
  );
  const state = store.read();
  assert.deepEqual(
    state.recentProjects.map((project) => project.path),
    ['C:/good'],
  );
  assert.equal(state.error, null);
});

/**
 * The association DSP-4 AC#5 rests on, checked against the real file.
 *
 * This is the test whose absence let a live defect through: `recordOpened` took
 * `(path, atUtc, conversationId)` and the one caller passed the conversation id
 * second. Both are strings, so it typechecked, and the conversation was never
 * recorded — reopening a project would have started an empty conversation beside
 * its work. The named-options signature makes that particular slip impossible; this
 * test makes the behaviour observable rather than assumed.
 */
test('a project remembers the conversation it was worked in', () => {
  const { store, filePath } = storeIn('conversation');
  const project = path.join(os.tmpdir(), 'project-with-conversation');
  store.recordOpened(project, { conversationId: 'conv-20260915-aaaa', atUtc: '2026-09-15T06:00:00.000Z' });

  assert.equal(store.conversationFor(project), 'conv-20260915-aaaa');
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    recentProjects: readonly { lastOpenedAtUtc: string; lastConversationId: string | null }[];
  };
  assert.equal(onDisk.recentProjects[0]?.lastConversationId, 'conv-20260915-aaaa');
  // The timestamp field holds a timestamp, which is what went wrong before.
  assert.equal(onDisk.recentProjects[0]?.lastOpenedAtUtc, '2026-09-15T06:00:00.000Z');
});

test('opening a project without naming a conversation keeps the one it had', () => {
  const { store } = storeIn('conversation-kept');
  const project = path.join(os.tmpdir(), 'project-keeps');
  store.recordOpened(project, { conversationId: 'conv-first' });
  store.recordOpened(project);
  assert.equal(store.conversationFor(project), 'conv-first');

  store.recordOpened(project, { conversationId: 'conv-second' });
  assert.equal(store.conversationFor(project), 'conv-second');
});

/**
 * The pointer has to follow the conversation actually being worked in.
 *
 * `recordOpened` was its only writer, and it runs once, when a session opens — so the
 * pointer recorded whichever conversation was current *then* and nothing moved it
 * afterwards. Choosing an earlier conversation and working in it therefore left the
 * project still pointing at the one it had been opened with, and the next open came
 * back to that one.
 */
test('choosing another conversation moves the pointer without counting as an opening', () => {
  const { store, filePath } = storeIn('conversation-moved');
  const project = path.join(os.tmpdir(), 'project-moves-pointer');
  store.recordOpened(project, {
    conversationId: 'conv-opened-with',
    atUtc: '2026-09-15T06:00:00.000Z',
  });

  const state = store.rememberConversation(project, 'conv-chosen-later');
  assert.equal(state.error, null);
  assert.equal(store.conversationFor(project), 'conv-chosen-later');
  // Not an opening: the count and the timestamp describe openings, and bumping them
  // here would reorder the list of recent projects every time a conversation was read.
  const entry = store.read().recentProjects[0];
  assert.equal(entry?.openCount, 1);
  assert.equal(entry?.lastOpenedAtUtc, '2026-09-15T06:00:00.000Z');
  // And it is on disk, which is the whole point: the next DSpatch finds the later one.
  assert.equal(new ProjectStore(filePath).conversationFor(project), 'conv-chosen-later');
});

test('a conversation in a project nobody has opened does not invent an entry', () => {
  const { store } = storeIn('conversation-unknown-project');
  const project = path.join(os.tmpdir(), 'project-never-opened-pointer');
  store.rememberConversation(project, 'conv-orphan');
  assert.equal(store.conversationFor(project), null);
  assert.equal(store.read().recentProjects.length, 0);
});

test('a project nobody has opened has no conversation', () => {
  const { store } = storeIn('conversation-none');
  assert.equal(store.conversationFor(path.join(os.tmpdir(), 'never-opened')), null);
});

test('a missing formatVersion means the file was not written by this store', () => {
  const { store, filePath } = storeIn('unversioned');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ recentProjects: [{ path: 'C:/x' }] }), 'utf8');
  const state = store.read();
  assert.equal(state.readOnly, true);
  assert.match(String(state.error), /formatVersion/);
});

// --- Forgetting a remembered project (DSP-6 item 3) -------------------------
//
// DSP-5's trial found nine of ten remembered entries were throwaway `%TEMP%`
// repositories from overnight verification, several already gone from disk, and
// no way to remove any of them. The requirement that carries the risk is not the
// removal: it is that removal touches the list and nothing else.

test('forgetting a project removes its entry and leaves the others', () => {
  const { store, filePath } = storeIn('forget');
  const keep = path.join(os.tmpdir(), 'project-keep');
  const drop = path.join(os.tmpdir(), 'project-drop');
  store.recordOpened(keep, { conversationId: 'conv-keep' });
  store.recordOpened(drop, { conversationId: 'conv-drop' });

  const outcome = store.forget([drop]);
  assert.deepEqual(outcome.removed, [path.resolve(drop)]);
  assert.deepEqual(outcome.notFound, []);
  assert.equal(outcome.state.error, null);
  assert.deepEqual(
    outcome.state.recentProjects.map((entry) => entry.path),
    [path.resolve(keep)],
  );

  // On disk, not just in the returned object: the point is the next read.
  const reread = store.read();
  assert.deepEqual(
    reread.recentProjects.map((entry) => entry.path),
    [path.resolve(keep)],
  );
  // The survivor keeps everything it had, including its conversation.
  assert.equal(reread.recentProjects[0]?.lastConversationId, 'conv-keep');
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    formatVersion: number;
  };
  assert.equal(onDisk.formatVersion, PROJECT_STORE_FORMAT_VERSION);
});

test('forgetting a project does not touch the folder or anything in it', () => {
  const { store } = storeIn('forget-keeps-disk');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-real-project-'));
  roots.push(root);
  const file = path.join(root, 'source.txt');
  fs.writeFileSync(file, 'the user\u2019s work', 'utf8');
  store.recordOpened(root);

  store.forget([root]);

  assert.deepEqual(store.read().recentProjects, []);
  assert.equal(fs.existsSync(root), true, 'the project folder is still there');
  assert.equal(fs.readFileSync(file, 'utf8'), 'the user\u2019s work');
});

test('a forgotten project can simply be opened again', () => {
  const { store } = storeIn('forget-then-open');
  const project = path.join(os.tmpdir(), 'project-again');
  store.recordOpened(project, { conversationId: 'conv-old' });
  store.forget([project]);

  // The conversation association went with the entry, and says so by being null
  // rather than by pointing at a conversation this list no longer records.
  assert.equal(store.conversationFor(project), null);
  const reopened = store.recordOpened(project);
  assert.equal(reopened.recentProjects[0]?.path, path.resolve(project));
  assert.equal(reopened.recentProjects[0]?.openCount, 1);
});

test('forgetting several at once is one write, and unknown paths are reported', () => {
  const { store } = storeIn('forget-many');
  const gone = ['gone-one', 'gone-two', 'gone-three'].map((name) =>
    path.join(os.tmpdir(), name),
  );
  const kept = path.join(os.tmpdir(), 'project-still-here');
  for (const project of [...gone, kept]) {
    store.recordOpened(project);
  }
  const neverListed = path.join(os.tmpdir(), 'never-listed');

  const outcome = store.forget([...gone, neverListed]);
  assert.equal(outcome.removed.length, 3);
  assert.deepEqual(outcome.notFound, [path.resolve(neverListed)]);
  assert.deepEqual(
    store.read().recentProjects.map((entry) => entry.path),
    [path.resolve(kept)],
  );
});

test('forgetting a path that is not in the list changes nothing and is not an error', () => {
  const { store } = storeIn('forget-absent');
  const project = path.join(os.tmpdir(), 'project-present');
  store.recordOpened(project);

  const outcome = store.forget([path.join(os.tmpdir(), 'project-absent')]);
  assert.deepEqual(outcome.removed, []);
  assert.equal(outcome.state.error, null);
  assert.equal(outcome.state.recentProjects.length, 1);
});

test('an empty request is a no-op rather than a rewrite', () => {
  const { store, filePath } = storeIn('forget-nothing');
  store.recordOpened(path.join(os.tmpdir(), 'project-untouched'));
  const before = fs.readFileSync(filePath, 'utf8');

  const outcome = store.forget([]);
  assert.deepEqual(outcome.removed, []);
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
});

test('a file this build must not rewrite is refused, and says nothing was removed', () => {
  const { store, filePath } = storeIn('forget-readonly');
  const future = {
    formatVersion: PROJECT_STORE_FORMAT_VERSION + 1,
    recentProjects: [
      { path: 'C:/kept', lastOpenedAtUtc: '2026-10-01T00:00:00.000Z', openCount: 3 },
    ],
    fieldsFromALaterVersion: ['keep me'],
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(future, null, 2), 'utf8');

  const outcome = store.forget(['C:/kept']);
  assert.deepEqual(outcome.removed, [], 'nothing was removed');
  assert.match(String(outcome.state.error), /nothing was removed/);
  // Still listed, because it is still in the file. Showing it as gone would be a
  // claim the next read contradicts.
  assert.equal(outcome.state.recentProjects.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), future);
});
