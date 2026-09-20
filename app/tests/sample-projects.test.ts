/**
 * DSP-61: where a new sample project goes, and what may be removed.
 *
 * The defect was not the refusal. `%TEMP%/dspatch-chat/duration-repo` on Niclas's
 * machine holds a sample project generated on 14–16 September, before the
 * `.dspatch-experiment` marker existed, so the generator correctly declined to wipe
 * it — and because every session reused that one path, *Use a generated sample
 * project* failed permanently.
 *
 * What these check is therefore in two halves, and the second half is the one that
 * must not be weakened:
 *
 * 1. A new sample project gets a folder of its own, whatever is already there.
 * 2. Removal reaches only folders **directly inside** DSpatch's own sample
 *    location, and never a path anywhere else, marker or no marker.
 *
 *     node --test tests/sample-projects.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  cleanUpSampleProjects,
  createSampleProjectFolder,
  isSampleProjectFolder,
  listSampleProjects,
  sampleProjectsRoot,
} from '../src/main/sample-projects.ts';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-samples-'));
const locks: ChildProcess[] = [];

after(() => {
  // Every process this file started is ended here, before the scratch directory is
  // removed — a test that leaves a holder behind leaves an undeletable folder too.
  for (const child of locks) {
    child.kill();
  }
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

let counter = 0;

function makeRoot(name: string): string {
  counter += 1;
  const root = path.join(scratch, `${String(counter)}-${name}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** The leftover as it actually exists: a full sample project with no marker. */
function plantUnmarkedLeftover(root: string, name = 'duration-repo'): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "old" }\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'duration.ts'), 'export {};\n', 'utf8');
  assert.equal(
    fs.existsSync(path.join(dir, '.dspatch-experiment')),
    false,
    'the leftover must have no marker, or this measures the wrong thing',
  );
  return dir;
}

/**
 * Lock a directory the way the real leftover is locked.
 *
 * An open file handle does **not** do it: Node opens files with delete sharing, so
 * `fs.rmSync` removed the folder anyway when this was tried that way. What Windows
 * actually refuses is deleting a directory that is a live process's working
 * directory, which is the case `experiment-repo.ts` documents from 14 September and
 * the one a leftover test runner produces. So a child process is started with its
 * `cwd` inside the folder, and killed afterwards.
 */
async function lock(dir: string): Promise<() => Promise<void>> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: dir,
    stdio: 'ignore',
  });
  locks.push(child);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(child.exitCode, null, 'the holding process must be alive');
  // Released inside the test rather than in a hook: a holder that outlives the test
  // makes the scratch directory undeletable, and then the cleanup fails instead.
  return async () => {
    const ended = new Promise<void>((resolve) => {
      child.once('exit', () => {
        resolve();
      });
    });
    child.kill();
    await ended;
  };
}

// --- Where a new sample project goes ----------------------------------------

test('the sample location is DSpatch\'s own directory under temp', () => {
  assert.equal(sampleProjectsRoot('C:\\tmp'), path.join('C:\\tmp', 'dspatch-chat'));
});

test('a new sample project gets a fresh empty folder, with the leftover still there', async () => {
  const root = makeRoot('fresh-with-leftover');
  const leftover = plantUnmarkedLeftover(root);
  const release = await lock(leftover);

  const created = createSampleProjectFolder(root);

  assert.equal(fs.existsSync(created), true, 'the folder exists');
  assert.deepEqual(fs.readdirSync(created), [], 'and is empty, so the generator can write');
  assert.notEqual(created, leftover);
  assert.equal(isSampleProjectFolder(root, created), true);
  // The old one is not touched, moved or cleared on the way past. That is the
  // decision: cleaning up is a separate action.
  assert.equal(fs.existsSync(path.join(leftover, 'package.json')), true);
  assert.deepEqual(fs.readdirSync(leftover).sort(), ['package.json', 'src']);
  await release();
});

test('two sample projects asked for in the same moment do not share a folder', () => {
  // The whole defect in miniature: one fixed path reused. `mkdtemp` rather than a
  // name built from the clock is what makes this true within the same second.
  const root = makeRoot('two-at-once');
  const now = new Date('2026-09-19T18:30:00.000Z');
  const first = createSampleProjectFolder(root, now);
  const second = createSampleProjectFolder(root, now);
  assert.notEqual(first, second);
  assert.match(path.basename(first), /^sample-20260919-1830/);
  assert.match(path.basename(second), /^sample-20260919-1830/);
});

// --- What is DSpatch's to remove, and what is not ----------------------------

test('only a direct child of the sample location is one of DSpatch\'s sample projects', () => {
  const root = makeRoot('membership');
  assert.equal(isSampleProjectFolder(root, path.join(root, 'sample-1')), true);
  // A folder inside a sample project is not itself a sample project.
  assert.equal(isSampleProjectFolder(root, path.join(root, 'sample-1', 'src')), false);
  // Nor is the location itself, nor anything beside or above it.
  assert.equal(isSampleProjectFolder(root, root), false);
  assert.equal(isSampleProjectFolder(root, path.dirname(root)), false);
  assert.equal(
    isSampleProjectFolder(root, path.join(path.dirname(root), 'someones-work')),
    false,
  );
});

test('the leftover is listed as old app-created content, and says it has no marker', () => {
  const root = makeRoot('listing');
  plantUnmarkedLeftover(root);
  const marked = createSampleProjectFolder(root);
  fs.writeFileSync(path.join(marked, '.dspatch-experiment'), 'generated\n', 'utf8');

  const listing = listSampleProjects(root);
  assert.equal(listing.error, null);
  assert.equal(listing.folders.length, 2);
  const old = listing.folders.find((folder) => folder.name === 'duration-repo');
  assert.equal(old?.marked, false, 'it predates the marker, and the list says so');
  assert.equal(old?.fileCount, 2);
  assert.notEqual(old?.lastChangedUtc, null);
  assert.equal(
    listing.folders.find((folder) => folder.name === path.basename(marked))?.marked,
    true,
  );
});

test('the sample project an open session is using is not offered for removal', () => {
  const root = makeRoot('in-use');
  const inUse = createSampleProjectFolder(root);
  plantUnmarkedLeftover(root);

  const listing = listSampleProjects(root, inUse);
  assert.deepEqual(
    listing.folders.map((folder) => folder.name),
    ['duration-repo'],
  );
  assert.equal(listing.inUse, inUse);
});

test('a sample location that does not exist is empty rather than an error', () => {
  const listing = listSampleProjects(path.join(scratch, 'never-created'));
  assert.deepEqual(listing.folders, []);
  assert.equal(listing.error, null);
});

// --- Removal, on request ----------------------------------------------------

test('the unmarked leftover is removed when asked, marker or no marker', () => {
  const root = makeRoot('remove-leftover');
  const leftover = plantUnmarkedLeftover(root);

  const outcome = cleanUpSampleProjects(root, { paths: [leftover] });
  assert.deepEqual(outcome.removed, [leftover]);
  assert.deepEqual(outcome.held, []);
  assert.equal(fs.existsSync(leftover), false);
  assert.match(outcome.note, /Removed 1 sample project/);
  assert.match(outcome.note, /own project folders are never removed/);
  assert.deepEqual(outcome.remaining.folders, []);
});

test('a folder DSpatch did not create is refused even when it is named directly', () => {
  // The property that must not break. The renderer sends paths, so the check is
  // made again here rather than trusted — and a folder outside the sample location
  // is not DSpatch's, exactly as the generator's refusal says.
  const root = makeRoot('refuse-outside');
  const someonesWork = path.join(path.dirname(root), `${String(counter)}-someones-work`);
  fs.mkdirSync(someonesWork, { recursive: true });
  fs.writeFileSync(path.join(someonesWork, 'thesis.txt'), 'years of work\n', 'utf8');

  const outcome = cleanUpSampleProjects(root, { paths: [someonesWork] });
  assert.deepEqual(outcome.removed, []);
  assert.equal(outcome.held.length, 1);
  assert.match(String(outcome.held[0]?.reason), /not one of DSpatch's own sample projects/);
  assert.equal(
    fs.readFileSync(path.join(someonesWork, 'thesis.txt'), 'utf8'),
    'years of work\n',
    'and it is still there, byte for byte',
  );
});

test('a marker in a folder outside the sample location does not make it removable', () => {
  // The negative control for the rule that replaced the marker check. Location is
  // what decides removal; a marker somebody else's directory happens to contain
  // must not be enough.
  const root = makeRoot('refuse-outside-marked');
  const elsewhere = path.join(path.dirname(root), `${String(counter)}-marked-elsewhere`);
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.writeFileSync(path.join(elsewhere, '.dspatch-experiment'), 'copied\n', 'utf8');

  const outcome = cleanUpSampleProjects(root, { paths: [elsewhere] });
  assert.deepEqual(outcome.removed, []);
  assert.equal(fs.existsSync(elsewhere), true);
  assert.match(String(outcome.held[0]?.reason), /does not delete anything anywhere else/);
});

test('a folder inside a sample project is refused too, not walked into', () => {
  const root = makeRoot('refuse-grandchild');
  const sample = createSampleProjectFolder(root);
  const inner = path.join(sample, 'src');
  fs.mkdirSync(inner, { recursive: true });

  const outcome = cleanUpSampleProjects(root, { paths: [inner] });
  assert.deepEqual(outcome.removed, []);
  assert.equal(fs.existsSync(inner), true);
});

test('the folder the open session is working in is refused', () => {
  const root = makeRoot('refuse-in-use');
  const inUse = createSampleProjectFolder(root);
  fs.writeFileSync(path.join(inUse, 'package.json'), '{}\n', 'utf8');

  const outcome = cleanUpSampleProjects(root, { paths: [inUse], inUse });
  assert.deepEqual(outcome.removed, []);
  assert.match(String(outcome.held[0]?.reason), /the open session is working in/);
  assert.equal(fs.existsSync(inUse), true);
});

test('a locked folder is reported as held with the reason, not counted as removed', async (t) => {
  // DSP-62's lingering run produces exactly this, and so does a terminal left open
  // in the folder. Silently counting it as removed would make the panel lie.
  //
  // Windows only, and stated rather than quietly passing elsewhere: a working
  // directory does not stop `rm -r` on Linux, so there would be nothing to observe.
  if (process.platform !== 'win32') {
    t.skip('a live working directory only blocks deletion on Windows');
    return;
  }
  const root = makeRoot('locked');
  const locked = plantUnmarkedLeftover(root, 'held-open');
  const free = plantUnmarkedLeftover(root, 'duration-repo');
  const release = await lock(locked);

  const outcome = cleanUpSampleProjects(root, { paths: [locked, free] });
  assert.deepEqual(outcome.removed, [free], 'the one that could go, went');
  assert.equal(fs.existsSync(free), false);
  assert.equal(
    outcome.held.length,
    1,
    'the lock must actually hold, or this measures nothing — check the child process',
  );
  assert.equal(outcome.held[0]?.path, locked);
  assert.match(String(outcome.held[0]?.reason), /a live process is holding it/);
  assert.equal(fs.existsSync(locked), true);
  assert.match(outcome.note, /left in place/);
  await release();
});

test('asking to remove nothing removes nothing and says so', () => {
  const root = makeRoot('nothing');
  const outcome = cleanUpSampleProjects(root, { paths: [] });
  assert.deepEqual(outcome.removed, []);
  assert.deepEqual(outcome.held, []);
  assert.match(outcome.note, /nothing to remove/);
});
