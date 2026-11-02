/**
 * DSP-163: the synchronous fingerprint taken at a provider's shell event, and the check that a
 * later asynchronous scan still shows the folders as they were at it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { changedSince, clearSnapshotCache, fingerprintRoots, LoopSnapshotter } from '../src/main/loop-snapshot.ts';

describe('command fingerprint (DSP-163)', () => {
  let root: string;
  const snapshotter = new LoopSnapshotter();

  beforeEach(() => {
    clearSnapshotCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp163-fp-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'two');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    clearSnapshotCache();
  });

  it('marks a root never listed, so nothing is claimed for it', async () => {
    const moment = fingerprintRoots([root]);
    assert.equal(moment.roots.get(root), null);
    const scans = await snapshotter.snapshotAll([root]);
    assert.match(changedSince(moment, scans) ?? '', /had not been listed/);
  });

  it('trusts a later scan when nothing changed after the moment', async () => {
    await snapshotter.snapshotAll([root]);
    const moment = fingerprintRoots([root]);
    assert.equal(moment.fileCount, 2);
    const scans = await snapshotter.snapshotAll([root]);
    assert.equal(changedSince(moment, scans), null);
  });

  it('refuses a later scan when a listed file changed after the moment', async () => {
    await snapshotter.snapshotAll([root]);
    const moment = fingerprintRoots([root]);
    fs.writeFileSync(path.join(root, 'a.txt'), 'changed after the command');
    const scans = await snapshotter.snapshotAll([root]);
    assert.match(changedSince(moment, scans) ?? '', /1 file changed/);
  });

  it('refuses a later scan when a listed file was removed after the moment', async () => {
    await snapshotter.snapshotAll([root]);
    const moment = fingerprintRoots([root]);
    fs.rmSync(path.join(root, 'sub', 'b.txt'));
    const scans = await snapshotter.snapshotAll([root]);
    assert.notEqual(changedSince(moment, scans), null);
  });

  it('refuses a later scan when a new file appeared after the moment', async () => {
    await snapshotter.snapshotAll([root]);
    const moment = fingerprintRoots([root]);
    fs.writeFileSync(path.join(root, 'new.txt'), 'new');
    const scans = await snapshotter.snapshotAll([root]);
    assert.notEqual(changedSince(moment, scans), null);
  });

  it('does not trust a file the listing missed when it is too new to place before the moment', async () => {
    await snapshotter.snapshotAll([root]);
    fs.writeFileSync(path.join(root, 'between.txt'), 'made just before the moment');
    const moment = fingerprintRoots([root]);
    const scans = await snapshotter.snapshotAll([root]);
    assert.match(changedSince(moment, scans) ?? '', /1 file changed/);
  });
});
