import assert from 'node:assert/strict';
import test from 'node:test';

import { activationLine } from '../src/renderer/walk-activation';

// A view 1000 px wide from x = 100, as two half-width panes fill it by default.
const left = 100;
const width = 1000;
const middle = left + width / 2;

test('at the start of the map the activation line is the left edge, so the first place can win', () => {
  assert.equal(activationLine(0, 3000, left, width), left);
});

test('at the end of the map it is the right edge, so the last place can win', () => {
  assert.equal(activationLine(3000, 3000, left, width), left + width);
});

test('away from the ends it is the centre, as before', () => {
  for (const x of [500, 1200, 2500]) {
    assert.equal(activationLine(x, 3000, left, width), middle);
  }
});

test('it slides continuously and in one direction as the map travels, in both directions', () => {
  let previous = -Infinity;
  for (let x = 0; x <= 3000; x += 10) {
    const line = activationLine(x, 3000, left, width);
    assert.ok(line >= previous, `not monotonic at ${String(x)}`);
    assert.ok(line - previous <= 10 + 1e-9 || previous === -Infinity, `jumps at ${String(x)}`);
    previous = line;
  }
});

test('a short map reaches both edges and stays continuous at its own middle', () => {
  assert.equal(activationLine(0, 200, left, width), left);
  assert.equal(activationLine(200, 200, left, width), left + width);
  assert.equal(activationLine(100, 200, left, width), middle);
});

test('a map that cannot travel (one pane, or content that fits) keeps the centre', () => {
  assert.equal(activationLine(0, 0, left, width), middle);
});

test('a position outside the travel is read as the nearest end', () => {
  assert.equal(activationLine(-40, 3000, left, width), left);
  assert.equal(activationLine(3040, 3000, left, width), left + width);
});
