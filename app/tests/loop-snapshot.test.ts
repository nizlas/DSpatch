/**
 * DSP-163: the synchronous fingerprint taken at a provider's shell event, and the check that a
 * later asynchronous scan still shows the folders as they were at it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

import { changedSince, clearSnapshotCache, fingerprintRoots, LoopSnapshotter, scanRoot } from '../src/main/loop-snapshot.ts';

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
    assert.match(changedSince(moment, scans) ?? '', /was not read when DSpatch heard of the command/);
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

/**
 * DSP-164: what a scan cannot see is never reported as a complete look that found nothing, and
 * the synchronous fingerprint has a bound past which it attributes nothing.
 */
describe('a scan that could not see everything says so (DSP-164)', () => {
  let root: string;

  beforeEach(() => {
    clearSnapshotCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp164-scan-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one');
    fs.writeFileSync(path.join(root, 'b.txt'), 'two');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    clearSnapshotCache();
  });

  /** Make one `node:fs/promises` function fail for one file, for the scan's own imports too. */
  const failing = (
    context: { mock: { method: (object: object, name: string, implementation: (...args: never[]) => unknown) => unknown; restoreAll: () => void } },
    name: 'stat' | 'readFile',
    file: string,
    code: string,
  ): void => {
    const original = fsp[name] as (...args: unknown[]) => Promise<unknown>;
    context.mock.method(fsp, name, (...args: unknown[]) => {
      if (path.resolve(String(args[0])) === path.resolve(file)) {
        return Promise.reject(Object.assign(new Error(`${code}: simulated`), { code }));
      }
      return original(...args);
    });
    syncBuiltinESMExports();
  };

  afterEach(() => {
    syncBuiltinESMExports();
  });

  it('a folder that does not exist is not observed, not an empty folder', async () => {
    const scan = await scanRoot(path.join(root, 'missing'));
    assert.equal(scan.coverage.complete, false);
    assert.match(scan.coverage.incompleteBecause ?? '', /could not be read/);
    assert.equal(scan.coverage.fileCount, 0);
  });

  it('a file that cannot be examined makes the look incomplete, not the file absent', async (context) => {
    failing(context, 'stat', path.join(root, 'b.txt'), 'EACCES');
    const scan = await scanRoot(root);
    context.mock.restoreAll();
    assert.equal(scan.coverage.complete, false);
    assert.match(scan.coverage.incompleteBecause ?? '', /1 file in it could not be read/);
  });

  it('a file that cannot be read makes the look incomplete', async (context) => {
    failing(context, 'readFile', path.join(root, 'a.txt'), 'EBUSY');
    const scan = await scanRoot(root);
    context.mock.restoreAll();
    assert.equal(scan.coverage.complete, false);
    assert.match(scan.coverage.incompleteBecause ?? '', /could not be read/);
  });

  it('a file written while it is read makes the look incomplete, and its later state is the one compared', async (context) => {
    const file = path.join(root, 'a.txt');
    const original = fsp.readFile;
    context.mock.method(fsp, 'readFile', async (...args: Parameters<typeof fsp.readFile>) => {
      const bytes = await original(...args);
      if (path.resolve(String(args[0])) === path.resolve(file)) {
        fs.writeFileSync(file, 'one, and then more');
      }
      return bytes;
    });
    syncBuiltinESMExports();
    const scan = await scanRoot(root);
    context.mock.restoreAll();
    assert.equal(scan.coverage.complete, false);
    assert.match(scan.coverage.incompleteBecause ?? '', /changed while DSpatch read it/);
    const size = scan.signatures.get('a.txt')?.split(':')[0];
    assert.equal(size, String(fs.statSync(file).size));
  });

  it('a complete look is still complete', async () => {
    const scan = await scanRoot(root);
    assert.equal(scan.coverage.complete, true);
    assert.equal(scan.coverage.fileCount, 2);
  });

  it('the fingerprint reads no root past its bound, and nothing is attributed to that moment', async () => {
    const snapshotter = new LoopSnapshotter();
    await snapshotter.snapshotAll([root]);
    const bounded = fingerprintRoots([root], undefined, { maxFiles: 1, maxMs: 250 });
    assert.equal(bounded.roots.get(root), null);
    const scans = await snapshotter.snapshotAll([root]);
    assert.match(changedSince(bounded, scans) ?? '', /past the bound/);
    const within = fingerprintRoots([root], undefined, { maxFiles: 10, maxMs: 250 });
    assert.equal(changedSince(within, await snapshotter.snapshotAll([root])), null);
  });

  it('looks asked for while one runs share the next one, which starts after them', async () => {
    const scans: string[] = [];
    const snapshotter = new LoopSnapshotter({ log: (line) => scans.push(line) });
    const [first, second, third] = await Promise.all([snapshotter.snapshot(root), snapshotter.snapshot(root), snapshotter.snapshot(root)]);
    assert.equal(scans.length, 2, scans.join(' | '));
    assert.notEqual(first, second);
    assert.equal(second, third);
  });

  it('keeps the event loop turning while it reads many files', async () => {
    for (let index = 0; index < 3000; index += 1) {
      fs.writeFileSync(path.join(root, `f${String(index)}.txt`), `file ${String(index)} `.repeat(50));
    }
    let worst = 0;
    let last = performance.now();
    const tick = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
    }, 5);
    const scan = await scanRoot(root);
    clearInterval(tick);
    assert.equal(scan.coverage.fileCount, 3002);
    assert.ok(worst < 250, `the event loop stood still for ${worst.toFixed(0)} ms during the scan`);
  });

  it('a stop between files ends the look with an AbortError', async () => {
    const stop = new AbortController();
    stop.abort();
    await assert.rejects(scanRoot(root, undefined, stop.signal), (error: Error) => error.name === 'AbortError');
  });
});
