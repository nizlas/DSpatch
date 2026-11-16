/**
 * DSP-216: a code pane of a walk is as wide as the longest line it shows by default, at most
 * Max width characters, plus its gutter. What matters: short code gives a narrow pane, not a
 * 120-column one; a long line is capped and scrolls; no limit follows the line; folded rows and
 * the rows the view leaves out do not widen a pane; the field reads 120, empty and nonsense.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_MAX_CHARS, codeColumns, paneWidthFor, parseMaxChars, shownColumns, storedMaxChars, textColumns } from '../src/renderer/walk-pane-width';

const row = (text: string, kind = 'context') => ({ kind, text });
const line = (length: number, kind = 'context') => row('x'.repeat(length), kind);
// A monospace column of 8 px, a 16 px rem, a 10 px scrollbar: beside the code, 2 × 3 digit
// columns, 3.4 rem of gutter and padding, the scrollbar and the border.
const metrics = { ch: 8, rem: 16, scrollbar: 10 };
const chrome = 3.4 * 16 + 10 + 3;
const MIN = 260;
const width = (columns: number, maxChars: number | null) => paneWidthFor(codeColumns(columns, maxChars), 3, metrics, MIN);

test('short lines give a narrow pane, never narrower than the minimum', () => {
  const rows = [line(10), line(14), line(8)];
  const columns = shownColumns(rows, [[0, 2]], 'both');
  assert.equal(columns, 14);
  assert.equal(width(columns, DEFAULT_MAX_CHARS), MIN, 'short code keeps the minimum width');
  const medium = shownColumns([line(60)], [[0, 0]], 'both');
  assert.equal(width(medium, DEFAULT_MAX_CHARS), Math.ceil((60 + 6) * 8 + chrome));
  assert.ok(width(medium, DEFAULT_MAX_CHARS) < width(120, DEFAULT_MAX_CHARS), 'not every pane is 120 columns wide');
});

test('lines around 120 columns: just under, at and just over the limit', () => {
  assert.equal(codeColumns(119, 120), 119);
  assert.equal(codeColumns(120, 120), 120);
  assert.equal(codeColumns(121, 120), 120);
  assert.ok(width(119, 120) < width(120, 120));
  assert.equal(width(121, 120), width(120, 120), 'a line over the limit gets the limit and scrolls');
});

test('longer lines are capped by the limit, and followed when there is none', () => {
  assert.equal(width(300, 120), width(120, 120));
  assert.equal(width(300, null), Math.ceil((300 + 6) * 8 + chrome), 'no limit: as wide as the line, beyond any window');
  assert.equal(width(300, 80), width(80, 80), 'a smaller limit applies at once');
});

test('only rows shown by default count: folded rows and the view\'s left-out rows do not', () => {
  const rows = [line(20), line(200), line(30), line(150, 'added'), line(170, 'deleted'), line(40)];
  // Row 1 lies outside the shown ranges: folded.
  assert.equal(shownColumns(rows, [[0, 0], [2, 5]], 'both'), 170);
  assert.equal(shownColumns(rows, [[0, 0], [2, 5]], 'before'), 170, 'Before shows removed rows');
  assert.equal(shownColumns(rows, [[0, 0], [2, 5]], 'after'), 150, 'After leaves removed rows out');
  assert.equal(shownColumns(rows, [[0, 0], [2, 2], [5, 5]], 'both'), 40);
  assert.equal(shownColumns(rows, [[0, 5]], 'both'), 200, 'the file level shows everything');
  assert.equal(shownColumns(rows, [[4, 9]], 'both'), 170, 'a range past the end is clamped');
});

test('tabs count to the next stop of eight, as the pane draws them', () => {
  assert.equal(textColumns('\tx'), 9);
  assert.equal(textColumns('ab\tc'), 9);
  assert.equal(shownColumns([row('\t\treturn;')], [[0, 0]], 'both'), 23);
});

test('the field: 120 by default, empty is no limit, other text changes nothing', () => {
  assert.equal(parseMaxChars('120'), 120);
  assert.equal(parseMaxChars(' 80 '), 80);
  assert.equal(parseMaxChars(''), null);
  assert.equal(parseMaxChars('   '), null);
  for (const text of ['0', '-5', '1.5', 'abc', '12a', '100000']) {
    assert.equal(parseMaxChars(text), undefined, text);
  }
  assert.equal(storedMaxChars(null), DEFAULT_MAX_CHARS);
  assert.equal(storedMaxChars('none'), null);
  assert.equal(storedMaxChars('90'), 90);
  assert.equal(storedMaxChars('nonsense'), DEFAULT_MAX_CHARS);
  assert.equal(storedMaxChars(''), DEFAULT_MAX_CHARS, 'an empty stored value is not taken for no limit');
});
