/**
 * The workspaces file (DSP-149, building on DSP-2, DSP-4 and DSP-71).
 *
 * The behaviour worth testing is not that a path round-trips. It is what happens to a
 * file this code does not fully understand — a newer DSpatch's, or one a person has
 * hand-edited into invalid JSON — which must be read and never rewritten; what happens
 * to an older file, which must be migrated without losing a remembered project or its
 * conversation; and that removing an entry from Recent removes nothing else.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/project-store.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  PROJECT_STORE_FORMAT_VERSION,
  ProjectStore,
  defaultWorkspaceName,
} from '../src/main/project-store.ts';
import type { RecentWorkspaceEntry } from '../src/shared/bridge.ts';
import { matchesSearch, moreFoldersLabel, startPageSelection } from '../src/shared/recent-workspaces.ts';

const roots: string[] = [];

function storeIn(name: string): { store: ProjectStore; filePath: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-store-${name}-`));
  roots.push(root);
  const filePath = path.join(root, 'nested', 'dspatch-projects.json');
  return { store: new ProjectStore(filePath), filePath, root };
}

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no file yet is the normal first run, not an error', () => {
  const { store } = storeIn('first');
  const state = store.read();
  assert.equal(state.error, null);
  assert.equal(state.readOnly, false);
  assert.deepEqual(state.workspaces, []);
  assert.equal(state.looseConversationId, null);
});

test('Open Project creates a workspace named after its folder, and reopens it the next time', () => {
  const { store, filePath } = storeIn('open');
  const created = store.openFolder('C:/work/MiniDAWLab', '2026-10-27T10:00:00.000Z');
  assert.equal(created.problem, null);
  assert.equal(created.workspace?.name, 'MiniDAWLab');
  assert.deepEqual(created.workspace?.folders, [path.resolve('C:/work/MiniDAWLab')]);
  const again = store.openFolder('C:/work/MiniDAWLab', '2026-10-27T11:00:00.000Z');
  assert.equal(again.workspace?.id, created.workspace?.id, 'the same identity, not a second workspace');
  assert.equal(again.workspace?.openCount, 2);
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { formatVersion: number };
  assert.equal(onDisk.formatVersion, PROJECT_STORE_FORMAT_VERSION);
});

test('a workspace keeps its name, its folders in order and its chat across a new store over the same file', () => {
  const { store, filePath } = storeIn('persist');
  const created = store.createWorkspace({ name: 'Agentintegration', folders: ['C:/dev/one', 'C:/dev/two'] });
  const id = created.workspace?.id ?? '';
  store.updateWorkspace(id, { lastConversationId: 'conv-1', loopDefinitionKey: 'k' });
  store.updateWorkspace(id, { folders: ['C:/dev/one', 'C:/dev/two', 'C:/dev/three'] });
  const reread = new ProjectStore(filePath).workspace(id);
  assert.equal(reread?.name, 'Agentintegration');
  assert.deepEqual(reread?.folders, ['C:/dev/one', 'C:/dev/two', 'C:/dev/three'].map((folder) => path.resolve(folder)));
  assert.equal(reread?.lastConversationId, 'conv-1');
  assert.equal(reread?.loopDefinitionKey, 'k');
});

test('changing a workspace is not an opening: Recent does not reorder for it', () => {
  const { store } = storeIn('order');
  const older = store.openFolder('C:/a', '2026-10-01T00:00:00.000Z').workspace?.id ?? '';
  store.openFolder('C:/b', '2026-10-02T00:00:00.000Z');
  store.updateWorkspace(older, { lastConversationId: 'conv-x', folders: ['C:/a', 'C:/c'] });
  assert.deepEqual(
    store.read().workspaces.map((record) => record.name),
    ['b', 'a'],
  );
});

test('Remove from recent hides the entry and nothing else; opening its folder brings it back as it was', () => {
  const { store, root } = storeIn('remove');
  const folder = fs.mkdtempSync(path.join(root, 'project-'));
  fs.writeFileSync(path.join(folder, 'keep.txt'), 'kept', 'utf8');
  const created = store.createWorkspace({ name: 'Named', folders: [folder, path.join(root, 'other')] });
  const id = created.workspace?.id ?? '';
  store.updateWorkspace(id, { lastConversationId: 'conv-kept' });
  store.removeFromRecent([id]);
  const hidden = store.workspace(id);
  assert.equal(hidden?.hiddenFromRecent, true);
  assert.equal(hidden?.name, 'Named');
  assert.equal(hidden?.lastConversationId, 'conv-kept');
  assert.equal(fs.readFileSync(path.join(folder, 'keep.txt'), 'utf8'), 'kept');
  const back = store.openFolder(folder);
  assert.equal(back.workspace?.id, id);
  assert.equal(back.workspace?.hiddenFromRecent, false);
  assert.equal(back.workspace?.folders.length, 2);
});

test('a version-2 file is migrated: every remembered project becomes a workspace and keeps its conversation', () => {
  const { store, filePath } = storeIn('migrate');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      formatVersion: 2,
      recentProjects: [
        { path: 'C:/dev/MiniDAWLab', lastOpenedAtUtc: '2026-10-14T20:23:05.247Z', openCount: 31, lastConversationId: 'conv-m' },
        { path: 'C:/temp/run-1', lastOpenedAtUtc: '2026-09-20T09:00:00.000Z', openCount: 1 },
      ],
      workspaces: [
        { filePath: null, folders: ['C:/dev/MiniDAWLab', 'C:/dev/extra'], loopDefinitionKey: 'k', lastOpenedAtUtc: '2026-10-14T20:23:05.251Z' },
      ],
    }),
    'utf8',
  );
  const state = store.read();
  assert.equal(state.readOnly, false);
  assert.equal(state.workspaces.length, 2, 'nothing dropped, Temp paths included');
  const mini = state.workspaces[0];
  assert.equal(mini?.name, 'MiniDAWLab');
  assert.deepEqual(mini?.folders, ['C:/dev/MiniDAWLab', 'C:/dev/extra']);
  assert.equal(mini?.lastConversationId, 'conv-m');
  assert.equal(mini?.loopDefinitionKey, 'k');
  assert.equal(mini?.openCount, 31);
  // The identity is derived, so reading the same old file twice agrees.
  assert.equal(new ProjectStore(filePath).read().workspaces[0]?.id, mini?.id);
  // Written as version 3 on the next change, with the projects still readable by an older build.
  store.recordOpened(mini?.id ?? '');
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    formatVersion: number;
    recentProjects: readonly { path: string }[];
  };
  assert.equal(onDisk.formatVersion, 3);
  assert.deepEqual(onDisk.recentProjects.map((entry) => entry.path), ['C:/dev/MiniDAWLab', 'C:/temp/run-1']);
});

test('a file from a newer DSpatch is read but never rewritten', () => {
  const { store, filePath } = storeIn('newer');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const future = {
    formatVersion: PROJECT_STORE_FORMAT_VERSION + 1,
    workspaces: [{ id: 'ws-1', name: 'Theirs', folders: ['C:/kept'], lastOpenedAtUtc: '2026-10-01T00:00:00.000Z' }],
    somethingThisBuildHasNeverHeardOf: true,
  };
  fs.writeFileSync(filePath, JSON.stringify(future), 'utf8');
  const state = store.read();
  assert.equal(state.readOnly, true);
  assert.equal(state.workspaces[0]?.name, 'Theirs');
  assert.match(String(state.error), /newer/);
  const outcome = store.openFolder('C:/mine');
  assert.notEqual(outcome.problem, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), future);
});

test('an unparsable file is reported and left alone', () => {
  const { store, filePath } = storeIn('broken');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{ not json', 'utf8');
  const state = store.read();
  assert.equal(state.readOnly, true);
  assert.match(String(state.error), /not valid JSON/);
  store.openFolder('C:/x');
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{ not json');
});

test('the conversation begun without a workspace is remembered, and can be cleared', () => {
  const { store, filePath } = storeIn('loose');
  store.setLooseConversation('conv-loose');
  assert.equal(new ProjectStore(filePath).read().looseConversationId, 'conv-loose');
  store.setLooseConversation(null);
  assert.equal(new ProjectStore(filePath).read().looseConversationId, null);
});

test('a workspace needs a folder, and a name falls back to its first folder', () => {
  const { store } = storeIn('names');
  assert.notEqual(store.createWorkspace({ name: 'x', folders: [] }).problem, null);
  assert.equal(store.createWorkspace({ name: '  ', folders: ['C:/dev/DSpatch'] }).workspace?.name, 'DSpatch');
  assert.equal(defaultWorkspaceName('C:/dev/DSpatch/'), 'DSpatch');
});

/* --- What the start page lists (shared/recent-workspaces.ts) ----------------- */

function entry(name: string, daysAgo: number | null, folders: readonly string[] = [`C:/p/${name}`]): RecentWorkspaceEntry {
  const now = Date.parse('2026-10-27T12:00:00.000Z');
  return {
    id: name,
    name,
    folders,
    lastOpenedAtUtc: daysAgo === null ? null : new Date(now - daysAgo * 86_400_000).toISOString(),
    primaryExists: true,
  };
}
const NOW = Date.parse('2026-10-27T12:00:00.000Z');

test('the start page shows the last three months, topped up to five, at most ten', () => {
  const twoRecent = [entry('a', 1), entry('b', 10), entry('c', 200), entry('d', 300), entry('e', 400), entry('f', 500)];
  assert.deepEqual(startPageSelection(twoRecent, NOW).map((e) => e.name), ['a', 'b', 'c', 'd', 'e']);
  const twelveRecent = Array.from({ length: 12 }, (_, index) => entry(`r${String(index)}`, index));
  assert.equal(startPageSelection(twelveRecent, NOW).length, 10);
  const sevenRecentAndOld = [...Array.from({ length: 7 }, (_, index) => entry(`r${String(index)}`, index)), entry('old', 365)];
  assert.deepEqual(startPageSelection(sevenRecentAndOld, NOW).map((e) => e.name).includes('old'), false);
  assert.deepEqual(startPageSelection([entry('only', 400)], NOW).map((e) => e.name), ['only']);
});

test('search matches a name or any folder, and a workspace of several folders says how many more', () => {
  const multi = entry('Agentintegration', 1, ['C:/dev/DSpatch', 'C:/dev/MiniDAWLab']);
  assert.equal(matchesSearch(multi, 'minidaw'), true);
  assert.equal(matchesSearch(multi, 'agent'), true);
  assert.equal(matchesSearch(multi, 'nothing'), false);
  assert.equal(moreFoldersLabel(multi.folders), '+1 folder');
  assert.equal(moreFoldersLabel(['C:/one']), '');
});
