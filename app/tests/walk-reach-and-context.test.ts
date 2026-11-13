/**
 * DSP-207: every changed line reachable through the walks, and the code a place lies in.
 *
 * A changed blank line belongs to a place by one rule (the nearest changed line with text in its
 * hunk, the one above on a tie), the same in the walk's marking, Accept and delegation, with the
 * file's text or with the hunks alone; what no place covers is listed, exactly, and decided about
 * nowhere but where the person decides. The structure a pane shows (function, signature,
 * documentation, control structure; section; or the lines around) is read from each revision's
 * own text and decides nothing.
 *
 *     node --test tests/walk-reach-and-context.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDiffRows,
  changedLineKey,
  changesOutsideWalks,
  currentLineDecisions,
  diffSkeletonRows,
  heldOf,
  markedChangedLines,
  markedChangedRows,
  parseDiff,
  placeDecisionView,
  walkChangedLines,
  type CodeLocation,
  type DiffFile,
  type DiffHunk,
  type HoldsAt,
  type Place,
  type ReviewDecision,
  type Walk,
} from '../src/shared/review-model.ts';
import { codeStructure, placeStructures, structureLines } from '../src/renderer/code-structure.ts';

const REVISIONS = { base: 'a'.repeat(40), target: 'b'.repeat(40) };
const PATH = 'src/mct_adapter.cpp';

/** A -U0 diff of `base` to `target` for one file, as git writes it, from explicit hunks. */
function unifiedZero(path: string, base: readonly string[], target: readonly string[], hunks: readonly Omit<DiffHunk, 'id' | 'path' | 'blank'>[]): string {
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    out.push(`@@ -${String(hunk.baseStart)},${String(hunk.baseCount)} +${String(hunk.targetStart)},${String(hunk.targetCount)} @@`);
    for (let index = 0; index < hunk.baseCount; index += 1) out.push(`-${base[hunk.baseStart - 1 + index] ?? ''}`);
    for (let index = 0; index < hunk.targetCount; index += 1) out.push(`+${target[hunk.targetStart - 1 + index] ?? ''}`);
  }
  return `${out.join('\n')}\n`;
}

function fileOf(path: string, base: readonly string[], target: readonly string[], hunks: readonly Omit<DiffHunk, 'id' | 'path' | 'blank'>[]): DiffFile {
  const [file] = parseDiff([{ path, status: 'modified' }], unifiedZero(path, base, target, hunks));
  assert.ok(file !== undefined);
  return file;
}

const place = (id: string, side: 'base' | 'target', start: number, end: number, path = PATH): Place => ({
  id,
  label: { sv: id, en: id },
  focus: { id: `${id}.focus`, path, side, start, end, role: 'walk' },
  context: [],
  unit: null,
  from: null,
} as unknown as Place);
const walkOf = (...places: Place[]): Walk => ({ id: 'W1', title: { sv: 'w', en: 'w' }, steps: places.map((entry, index) => ({ id: `W1.${String(index + 1)}`, places: [entry] })) } as unknown as Walk);

function holdsOf(decisions: readonly ReviewDecision[], files: readonly DiffFile[]): HoldsAt {
  const current = currentLineDecisions(decisions, files);
  return (path, side, line) => {
    const decision = current.get(changedLineKey(path, side, line));
    return decision === undefined ? null : heldOf(decision, files);
  };
}
function accepted(id: string, locations: readonly CodeLocation[]): ReviewDecision {
  return {
    id,
    scope: { kind: 'lines', path: locations[0]?.path ?? PATH, ranges: locations.map(({ side, start, end }) => ({ side, start, end })) },
    outcome: 'accepted',
    reason: '',
    by: { kind: 'human' },
    at: 't',
    revisions: REVISIONS,
    origin: { kind: 'walk', stepId: 'W1.1', placeId: 'p1' },
  };
}

// The user's example: an if-block added on new lines 128–130 and a blank line 131 after it.
const BASE = Array.from({ length: 200 }, (_, index) => `  step(${String(index + 1)});`);
const TARGET = [...BASE.slice(0, 127), '  if (ready) {', '    start();', '  }', '', ...BASE.slice(127)];
const IF_HUNK = { baseStart: 127, baseCount: 0, targetStart: 128, targetCount: 4 };

test('the cause: the blank line 131 was never in the place, which ends at 130; now it is, by the rule', () => {
  const file = fileOf(PATH, BASE, TARGET, [IF_HUNK]);
  assert.deepEqual(file.hunks[0]?.blank, { base: [], target: [131] }, 'the diff says which changed line is blank');
  const rows = buildDiffRows(BASE, TARGET, file.hunks);
  const focus = { path: PATH, side: 'target' as const, start: 128, end: 130 };
  assert.deepEqual(markedChangedLines(rows, focus).ranges, [{ side: 'target', start: 128, end: 131 }]);
  assert.equal(markedChangedLines(rows, focus).lines, 4);
  // The hunks alone (delegation, coverage) give the same lines as the file's text (marking, Accept).
  const skeleton = diffSkeletonRows(file.hunks, 0, 130);
  assert.deepEqual(markedChangedLines(skeleton, focus), markedChangedLines(rows, focus));
  assert.deepEqual(walkChangedLines(walkOf(place('p1', 'target', 128, 130)), [file]), [{ path: PATH, side: 'target', start: 128, end: 131 }]);
  // A hunk read without knowing its blank lines takes none: nothing is taken that is not known.
  const unknown = { ...file, hunks: file.hunks.map(({ blank: _blank, ...hunk }) => hunk) };
  assert.deepEqual(walkChangedLines(walkOf(place('p1', 'target', 128, 130)), [unknown]), [{ path: PATH, side: 'target', start: 128, end: 130 }]);
});

test('blank lines: before and after a place, removed and added, and never across unchanged code or with text', () => {
  // base:  a, [blank], b, c(old), d          target: a, [blank], b, c(new), [blank], [blank], d
  const base = ['a', '', 'b', 'c old', 'd'];
  const target = ['a', '', 'b', 'c new', '', '', 'd'];
  const hunks = [{ baseStart: 4, baseCount: 1, targetStart: 4, targetCount: 3 }];
  const file = fileOf('x.cpp', base, target, hunks);
  const rows = buildDiffRows(base, target, file.hunks);
  // The two added blank lines after the replaced line are its; the unchanged blank line 2 is not.
  const replaced = markedChangedLines(rows, { path: 'x.cpp', side: 'target', start: 4, end: 4 });
  assert.deepEqual(replaced.ranges, [{ side: 'base', start: 4, end: 4 }, { side: 'target', start: 4, end: 6 }]);

  // A removed blank line before a removed block is the block's.
  const base2 = ['keep', '', 'gone 1', 'gone 2', 'keep 2'];
  const target2 = ['keep', 'keep 2'];
  const file2 = fileOf('y.cpp', base2, target2, [{ baseStart: 2, baseCount: 3, targetStart: 1, targetCount: 0 }]);
  const rows2 = buildDiffRows(base2, target2, file2.hunks);
  assert.deepEqual(markedChangedLines(rows2, { path: 'y.cpp', side: 'base', start: 3, end: 4 }).ranges, [{ side: 'base', start: 2, end: 4 }]);

  // A hunk of blank lines alone belongs to no place: its nearest change with text is none.
  const base3 = ['one', 'two'];
  const target3 = ['one', '', 'two'];
  const file3 = fileOf('z.cpp', base3, target3, [{ baseStart: 1, baseCount: 0, targetStart: 2, targetCount: 1 }]);
  const rows3 = buildDiffRows(base3, target3, file3.hunks);
  assert.deepEqual(markedChangedLines(rows3, { path: 'z.cpp', side: 'target', start: 1, end: 1 }).ranges, [], 'an unchanged focus takes no blank line');
  assert.deepEqual(changesOutsideWalks([walkOf(place('p', 'target', 1, 1, 'z.cpp'))], [file3]), [{ path: 'z.cpp', side: 'target', start: 2, end: 2, hunkId: 'H1', blank: true }]);
});

test('a change of whitespace inside a line is a change with text, never a blank line', () => {
  const base = ['int f() {', 'return 1;', '}'];
  const target = ['int f() {', '  return 1;', '}'];
  const file = fileOf('w.cpp', base, target, [{ baseStart: 2, baseCount: 1, targetStart: 2, targetCount: 1 }]);
  assert.deepEqual(file.hunks[0]?.blank, { base: [], target: [] });
  assert.deepEqual(changesOutsideWalks([], [file]).map((entry) => [entry.side, entry.start, entry.blank]), [['base', 2, false], ['target', 2, false]]);
});

test('two places in one hunk: a blank line between them goes to one, the upper on a tie, and counts once', () => {
  const base = ['top', 'bottom'];
  const target = ['top', 'first();', '', 'second();', 'bottom'];
  const file = fileOf('t.cpp', base, target, [{ baseStart: 1, baseCount: 0, targetStart: 2, targetCount: 3 }]);
  const rows = buildDiffRows(base, target, file.hunks);
  const first = markedChangedLines(rows, { path: 't.cpp', side: 'target', start: 2, end: 2 });
  const second = markedChangedLines(rows, { path: 't.cpp', side: 'target', start: 4, end: 4 });
  assert.deepEqual(first.ranges, [{ side: 'target', start: 2, end: 3 }]);
  assert.deepEqual(second.ranges, [{ side: 'target', start: 4, end: 4 }]);
  // Overlapping places: their union, once.
  const union = walkChangedLines(walkOf(place('a', 'target', 2, 4, 't.cpp'), place('b', 'target', 4, 4, 't.cpp')), [file]);
  assert.deepEqual(union, [{ path: 't.cpp', side: 'target', start: 2, end: 4 }]);
  assert.equal(markedChangedRows(rows, { side: 'target', start: 2, end: 2 }).length, 2);
});

test('what no walk covers: a new large file with a small walk, and substantive changes beside it, exactly', () => {
  const big: DiffFile = fileOf('src/big.cpp', [], Array.from({ length: 300 }, (_, index) => (index === 99 ? '' : `int v${String(index)};`)), [{ baseStart: 0, baseCount: 0, targetStart: 1, targetCount: 300 }]);
  const other = fileOf(PATH, BASE, TARGET, [IF_HUNK]);
  const walk = walkOf(place('p1', 'target', 95, 99, 'src/big.cpp'));
  const outside = changesOutsideWalks([walk], [big, other]);
  // 95–99 are the place's; 100 is blank and as near 99 (the place's) as 101, so the upper wins and it is the place's too.
  assert.deepEqual(outside.map((entry) => [entry.path, entry.side, entry.start, entry.end, entry.blank]), [
    ['src/big.cpp', 'target', 1, 94, false],
    ['src/big.cpp', 'target', 101, 300, false],
    [PATH, 'target', 128, 131, false],
  ]);
  // Listing decides nothing; every line stays in the total.
  const lines = outside.reduce((sum, entry) => sum + entry.end - entry.start + 1, 0);
  assert.equal(lines + 6, 300 + 4);
});

test('an earlier decision keeps only its stored lines when the place grows; the new line stays undecided', () => {
  const file = fileOf(PATH, BASE, TARGET, [IF_HUNK]);
  const rows = buildDiffRows(BASE, TARGET, file.hunks);
  const marked = markedChangedLines(rows, { path: PATH, side: 'target', start: 128, end: 130 });
  const earlier = accepted('d1', [{ path: PATH, side: 'target', start: 128, end: 130 }]);
  const view = placeDecisionView(marked, holdsOf([earlier], [file]));
  assert.deepEqual([view.accepted, view.remaining, marked.lines], [3, 1, 4], '128–130 stay accepted, 131 waits for the person');
  assert.equal(view.held[0]?.decision.id, 'd1');
});

// --- The code a place lies in ---

const CPP = [
  '#include <vector>', // 1
  '', // 2
  '/**', // 3
  ' * Applies the adapter\'s settings.', // 4
  ' * @return true when applied.', // 5
  ' */', // 6
  'bool MctAdapter::apply(const Settings &settings,', // 7
  '                       Mode mode) {', // 8
  '  int count = 0; // { not a block', // 9
  ...Array.from({ length: 50 }, (_, index) => `  count += ${String(index)};`), // 10–59
  '  try {', // 60
  '    if (mode == Mode::Fast) {', // 61
  '      run("}");', // 62
  '    }', // 63
  '  } catch (const Error &error) {', // 64
  '    log(error);', // 65
  '  }', // 66
  '  return count > 0;', // 67
  '}', // 68
  '', // 69
  'static const int kLimit = 10;', // 70
  '', // 71
  'int twice(int x) { return 2 * x; }', // 72
];

test('a long method: its documentation, two-line signature, the change in its nested blocks and its end, with folds between', () => {
  const found = codeStructure(CPP, PATH, 62, 62);
  assert.deepEqual([found.kind, found.name, found.start, found.headEnd, found.end, found.reliable], ['method', 'MctAdapter::apply', 3, 8, 68, true]);
  assert.deepEqual(found.control, { start: 61, end: 63 }, 'the innermost control structure, braces in strings and comments ignored');
  const shown = structureLines({ side: 'target', structure: found, focus: { start: 62, end: 62 } });
  assert.deepEqual(shown[0], [3, 8], 'documentation and signature first');
  assert.ok(shown.some(([start, end]) => start <= 58 && end >= 66), 'the change with its control structures');
  assert.ok(shown.some(([start, end]) => start <= 68 && end >= 68), 'the closing line');
  assert.ok(!shown.some(([start, end]) => start <= 30 && end >= 30), 'the middle of the long body is folded');
});

test('a short function is shown whole; code outside functions is its declaration; unknown languages say they found no boundary', () => {
  const short = codeStructure(CPP, PATH, 72, 72);
  assert.deepEqual([short.kind, short.name, short.start, short.end], ['function', 'twice', 72, 72]);
  const declaration = codeStructure(CPP, PATH, 70, 70);
  assert.deepEqual([declaration.kind, declaration.start, declaration.end, declaration.reliable], ['declaration', 70, 70, true]);
  const unknown = codeStructure(['alpha', 'beta', '', 'gamma'], 'notes.unknownext', 2, 2);
  assert.deepEqual([unknown.kind, unknown.start, unknown.end, unknown.reliable], ['nearby', 1, 2, false]);
});

test('Python, YAML and Markdown: a method with its decorator and docstring, a section, a heading', () => {
  const python = ['class Box:', '    @property', '    def size(self,', '             unit):', '        """The size."""', '        for part in self.parts:', '            total += part', '        return total', '', 'def other():', '    pass'];
  const method = codeStructure(python, 'box.py', 7, 7);
  assert.deepEqual([method.kind, method.name, method.start, method.headEnd, method.end], ['method', 'size', 2, 4, 8]);
  assert.deepEqual(method.control, { start: 6, end: 7 });
  const yaml = codeStructure(['build:', '  steps: 2', 'test:', '  steps: 3'], 'ci.yml', 4, 4);
  assert.deepEqual([yaml.kind, yaml.name, yaml.start, yaml.end], ['section', 'test', 3, 4]);
  const markdown = codeStructure(['# Title', 'text', '## Part', 'more', '## Next'], 'README.md', 4, 4);
  assert.deepEqual([markdown.kind, markdown.name, markdown.start, markdown.end], ['section', 'Part', 3, 4]);
});

test('base and target are each read from their own text: a signature that changed is found at both sides', () => {
  const base = ['/** Old doc. */', 'int sum(int a) {', '  return a;', '}'];
  const target = ['/**', ' * New doc.', ' */', 'int sum(int a,', '        int b) {', '  return a + b;', '}'];
  const file = fileOf('s.cpp', base, target, [{ baseStart: 1, baseCount: 3, targetStart: 1, targetCount: 6 }]);
  const rows = buildDiffRows(base, target, file.hunks);
  const both = placeStructures(rows, { path: 's.cpp', side: 'target', start: 6, end: 6 });
  const bySide = Object.fromEntries(both.map((entry) => [entry.side, [entry.structure.name, entry.structure.start, entry.structure.headEnd, entry.structure.end]]));
  assert.deepEqual(bySide, { base: ['sum', 1, 2, 4], target: ['sum', 1, 5, 7] });
});

test('more context never changes what a place decides about', () => {
  const file = fileOf(PATH, BASE, TARGET, [IF_HUNK]);
  const rows = buildDiffRows(BASE, TARGET, file.hunks);
  const focus = { path: PATH, side: 'target' as const, start: 128, end: 130 };
  const before = markedChangedLines(rows, focus);
  placeStructures(rows, focus);
  codeStructure(TARGET, PATH, 128, 130);
  assert.deepEqual(markedChangedLines(rows, focus), before);
});
