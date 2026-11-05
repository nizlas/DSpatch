import assert from 'node:assert/strict';
import test from 'node:test';

import { panesOf, paneOfStation, shownStation, type PaneDiffFile, type PaneFocus } from '../src/renderer/walk-panes';

// a.ts: lines 10–12 replaced by 10–14, and far below, line 200 removed.
const a: PaneDiffFile = {
  binary: false,
  hunks: [
    { baseStart: 10, baseCount: 3, targetStart: 10, targetCount: 5 },
    { baseStart: 200, baseCount: 1, targetStart: 201, targetCount: 0 },
  ],
};
const b: PaneDiffFile = { binary: false, hunks: [{ baseStart: 5, baseCount: 1, targetStart: 5, targetCount: 1 }] };
const files = new Map([
  ['a.ts', a],
  ['b.ts', b],
]);
const fileOf = (path: string): PaneDiffFile | null => files.get(path) ?? null;
const at = (path: string, side: 'base' | 'target', start: number, end = start): PaneFocus => ({ path, side, start, end });
const groups = (foci: readonly PaneFocus[]): number[][] => panesOf(foci, fileOf).map((pane) => [...pane.stations]);

test('the old and the new side of one change share a pane', () => {
  // The observed case: "Old" on the removed lines, "New branch" on the added ones.
  assert.deepEqual(groups([at('a.ts', 'base', 10, 12), at('a.ts', 'target', 11, 14)]), [[0, 1]]);
});

test('a focus starting on the unchanged line just above the change still belongs to it', () => {
  assert.deepEqual(groups([at('a.ts', 'base', 8, 11), at('a.ts', 'target', 12)]), [[0, 1]]);
});

test('two separate changes in one file keep panes of their own', () => {
  assert.deepEqual(groups([at('a.ts', 'target', 11), at('a.ts', 'base', 200)]), [[0], [1]]);
});

test('a focus in an unchanged part of a changed file is not joined by its path alone', () => {
  assert.deepEqual(groups([at('a.ts', 'target', 11), at('a.ts', 'target', 100)]), [[0], [1]]);
});

test('different files keep panes of their own', () => {
  assert.deepEqual(groups([at('a.ts', 'target', 11), at('b.ts', 'target', 5)]), [[0], [1]]);
});

test('places in a file the change does not touch keep panes of their own, even on the same lines', () => {
  assert.deepEqual(groups([at('c.ts', 'target', 3), at('c.ts', 'target', 3)]), [[0], [1]]);
});

test('a binary file is never shared', () => {
  const binary = (): PaneDiffFile => ({ binary: true, hunks: [] });
  assert.deepEqual(panesOf([at('x.png', 'target', 1), at('x.png', 'base', 1)], binary).map((pane) => [...pane.stations]), [[0], [1]]);
});

test('a focus spanning two changes joins both, and the places on either side with it', () => {
  // The second hunk of a.ts removes line 200; a target focus over 12–200 touches both.
  assert.deepEqual(groups([at('a.ts', 'target', 11), at('a.ts', 'target', 12, 200), at('a.ts', 'base', 200)]), [[0, 1, 2]]);
});

test('only neighbours in walk order share: a later return to the change gets a pane further right', () => {
  const panes = panesOf([at('a.ts', 'base', 10), at('b.ts', 'target', 5), at('a.ts', 'target', 10)], fileOf);
  assert.deepEqual(
    panes.map((pane) => ({ index: pane.index, path: pane.path, stations: [...pane.stations] })),
    [
      { index: 0, path: 'a.ts', stations: [0] },
      { index: 1, path: 'b.ts', stations: [1] },
      { index: 2, path: 'a.ts', stations: [2] },
    ],
  );
});

test('panes follow the first station order and the same input gives the same panes', () => {
  const foci = [at('b.ts', 'target', 5), at('a.ts', 'base', 10), at('a.ts', 'target', 13), at('a.ts', 'base', 200)];
  const first = panesOf(foci, fileOf);
  assert.deepEqual(first.map((pane) => [...pane.stations]), [[0], [1, 2], [3]]);
  assert.deepEqual(first.map((pane) => pane.index), [0, 1, 2]);
  assert.deepEqual(panesOf(foci, fileOf), first);
  assert.deepEqual(paneOfStation(first), [0, 1, 1, 2]);
});

test('a pane presents the active station, else the one nearest it in walk order', () => {
  const pane = { index: 1, path: 'a.ts', stations: [2, 3, 4] };
  assert.equal(shownStation(pane, 3), 3);
  // Entered travelling forward: its first station; travelling back: its last.
  assert.equal(shownStation(pane, 0), 2);
  assert.equal(shownStation(pane, 7), 4);
});
