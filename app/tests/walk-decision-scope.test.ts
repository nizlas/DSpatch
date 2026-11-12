/**
 * A walk's Accept decides about exactly the lines its marking covers (DSP-201).
 *
 * The regression Niclas found in 0.1.22: a new file of 417 added lines, a walk place marking
 * lines 151–159, and Accept recorded over lines 1–417. These read the scope from the same
 * rows the marking is drawn from, decide in the walk's own record and in the pair record the
 * diff window shares, and count the result the way coverage and the file list do.
 *
 *     node --import ./scripts/ts-resolve.mjs --import ./scripts/test-offline-guard.mjs --test tests/walk-decision-scope.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adoptStoredState,
  buildDiffRows,
  changedLineKey,
  checkStateForSave,
  computeCoverage,
  currentLineDecisions,
  emptyReviewState,
  heldOf,
  isDecisionScope,
  markedChangedLines,
  parseReviewDefinition,
  placeDecisionView,
  stillHeld,
  type CodeLocation,
  type DiffFile,
  type HoldsAt,
  type ReviewDecision,
  type ReviewDefinition,
  type ReviewState,
} from '../src/shared/review-model.ts';
import { adoptPairRecord, emptyRecord, fileProgressOf, type PairFile, type PairMark, type PairRecord } from '../src/shared/review-pair.ts';
import { lineDecisionsFromPair, pairHolds, pairRanges } from '../src/shared/review-pair-walk.ts';

const REVISIONS = { base: 'a'.repeat(40), target: 'b'.repeat(40) };
const PAIR = { repository: '/repo', base: REVISIONS.base, target: REVISIONS.target };
const PATH = 'src/big.ts';

// A new file of 417 added lines: one hunk, H1.
const NEW_FILE: DiffFile = {
  path: PATH,
  status: 'added',
  binary: false,
  hunks: [{ id: 'H1', path: PATH, baseStart: 0, baseCount: 0, targetStart: 1, targetCount: 417 }],
  added: 417,
  deleted: 0,
};
const NEW_PAIR_FILE: PairFile = {
  key: PATH,
  status: 'added',
  oldPath: null,
  newPath: PATH,
  similarity: null,
  binary: false,
  hunks: [{ baseStart: 0, baseCount: 0, targetStart: 1, targetCount: 417 }],
  added: 417,
  deleted: 0,
};
const TARGET = Array.from({ length: 417 }, (_, index) => `line ${String(index + 1)}`);
const ROWS = buildDiffRows([], TARGET, NEW_FILE.hunks);

function definitionWith(path: string): ReviewDefinition {
  const { definition } = parseReviewDefinition({
    format: 'dspatch-review/1',
    title: 't',
    repository: '.',
    base: REVISIONS.base,
    target: REVISIONS.target,
    walks: [{ id: 'W1', title: 'w', question: 'q', steps: [{ id: 'W1.1', title: 's', text: 't', refs: [{ path, side: 'target', start: 151, end: 159, role: 'walk' }] }] }],
  });
  assert.ok(definition !== null);
  return definition;
}

const at = (side: 'base' | 'target', start: number, end: number, path = PATH): CodeLocation => ({ path, side, start, end });

function walkDecision(id: string, outcome: ReviewDecision['outcome'], locations: readonly CodeLocation[], origin: ReviewDecision['origin'] = { kind: 'walk', stepId: 'W1.1', placeId: 'p1' }): ReviewDecision {
  return {
    id,
    scope: { kind: 'lines', path: locations[0]?.path ?? PATH, ranges: locations.map(({ side, start, end }) => ({ side, start, end })) },
    outcome,
    reason: '',
    by: { kind: 'human' },
    at: 't',
    revisions: REVISIONS,
    ...(origin === undefined ? {} : { origin }),
  };
}

function localHolds(decisions: readonly ReviewDecision[], files: readonly DiffFile[]): HoldsAt {
  const current = currentLineDecisions(decisions, files);
  return (path, side, line) => {
    const decision = current.get(changedLineKey(path, side, line));
    return decision === undefined ? null : heldOf(decision, files);
  };
}

function pairMarks(op: PairMark['op'], locations: readonly CodeLocation[], idPrefix: string, origin?: PairMark['origin']): PairMark[] {
  return pairRanges(locations).map((scope, index) => ({ id: `${idPrefix}${String(index)}`, op, scope, reason: '', at: 't', ...(origin === undefined ? {} : { origin }) }));
}

test('the 417-line regression: a place marking 151–159 accepts those 9 lines and no others, in the walk record', () => {
  const marked = markedChangedLines(ROWS, { path: PATH, side: 'target', start: 151, end: 159 }, true);
  assert.deepEqual(marked, { path: PATH, ranges: [{ side: 'target', start: 151, end: 159 }], lines: 9 });

  const decisions = [walkDecision('d1', 'accepted', marked.ranges.map((range) => ({ path: PATH, ...range })))];
  const state: ReviewState = { ...emptyReviewState(REVISIONS, 'def.json', 'hash'), decisions };
  const coverage = computeCoverage(definitionWith(PATH), [NEW_FILE], state);
  assert.deepEqual([coverage.totalLines, coverage.acceptedLines, coverage.remainingLines], [417, 9, 408]);
  assert.equal(coverage.hunks[0]?.decision, null, 'a hunk decided in part names no one decision');
  assert.equal(coverage.hunks[0]?.acceptedLines, 9);
  assert.equal(Math.round((coverage.acceptedLines / coverage.totalLines) * 1000) / 10, 2.2);

  const current = currentLineDecisions(decisions, [NEW_FILE]);
  for (let line = 1; line <= 417; line += 1) {
    assert.equal(current.has(changedLineKey(PATH, 'target', line)), line >= 151 && line <= 159, `line ${String(line)}`);
  }

  // Saved and read back, as a reopened window or a restarted app reads it.
  assert.equal(checkStateForSave(state, REVISIONS), null);
  const reread = adoptStoredState(JSON.parse(JSON.stringify(state)), REVISIONS);
  assert.ok(reread !== null);
  assert.equal(computeCoverage(definitionWith(PATH), [NEW_FILE], reread).acceptedLines, 9);

  // Withdrawing the place's lines returns exactly them.
  const withdrawn: ReviewState = { ...state, decisions: [...decisions, walkDecision('d2', 'withdrawn', [at('target', 151, 159)])] };
  assert.equal(computeCoverage(definitionWith(PATH), [NEW_FILE], withdrawn).acceptedLines, 0);
  assert.equal(withdrawn.decisions.length, 2, 'the history keeps the acceptance');
});

test('the 417-line regression in the pair record the diff window shares: 9 of 417, after a restart too, and withdrawing touches only them', () => {
  const marked = markedChangedLines(ROWS, { path: PATH, side: 'target', start: 151, end: 159 }, true);
  const locations = marked.ranges.map((range) => ({ path: PATH, ...range }));
  // Another decision made in the diff window over lines 300–310, which the walk must leave alone.
  const diffMarks = pairMarks('manual', [at('target', 300, 310)], 'diff', { kind: 'diff' });
  const record: PairRecord = { ...emptyRecord(PAIR), marks: [...diffMarks, ...pairMarks('manual', locations, 'walk', { kind: 'walk', stepId: 'W1.1', placeId: 'p1' })] };

  const progress = fileProgressOf(NEW_PAIR_FILE, record);
  assert.deepEqual([progress.total, progress.manual, progress.percent], [417, 20, 4]);
  const walkOnly: PairRecord = { ...record, marks: record.marks.filter((mark) => mark.origin?.kind === 'walk') };
  assert.deepEqual([fileProgressOf(NEW_PAIR_FILE, walkOnly).manual, fileProgressOf(NEW_PAIR_FILE, walkOnly).percent], [9, 2]);

  const decisions = lineDecisionsFromPair([NEW_FILE], walkOnly, REVISIONS);
  const coverage = computeCoverage(definitionWith(PATH), [NEW_FILE], { ...emptyReviewState(REVISIONS, 'def.json', 'hash'), decisions });
  assert.deepEqual([coverage.acceptedLines, coverage.remainingLines], [9, 408]);

  // A restart reads the stored record again: the same lines, and where they were decided.
  const reread = adoptPairRecord(JSON.parse(JSON.stringify(record)), PAIR);
  assert.deepEqual(reread.marks.map((mark) => mark.origin?.kind), ['diff', 'walk']);
  assert.equal(fileProgressOf(NEW_PAIR_FILE, reread).manual, 20);

  // Withdraw at the place: a clear over exactly its lines. The diff window's 300–310 stays.
  const after: PairRecord = { ...reread, marks: [...reread.marks, ...pairMarks('clear', locations, 'undo', { kind: 'walk', stepId: 'W1.1', placeId: 'p1' })] };
  assert.equal(fileProgressOf(NEW_PAIR_FILE, after).manual, 11);
  const view = placeDecisionView(marked, pairHolds(after));
  assert.deepEqual([view.accepted, view.remaining], [0, 9]);
});

test('expanded context, the whole file and other places never widen what a place decides about', () => {
  // The scope is read from the reference alone: the same call whatever the pane shows around it.
  const once = markedChangedLines(ROWS, { path: PATH, side: 'target', start: 151, end: 159 }, true);
  const again = markedChangedLines(ROWS, { path: PATH, side: 'target', start: 151, end: 159 }, true);
  assert.deepEqual(once, again);
  // A modified file: unchanged lines inside the marking are not decided about.
  const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const target = ['a', 'b', 'c', 'D', 'e', 'new', 'f', 'g', 'h'];
  const hunks = [
    { id: 'H1', path: 'm.ts', baseStart: 4, baseCount: 1, targetStart: 4, targetCount: 1 },
    { id: 'H2', path: 'm.ts', baseStart: 5, baseCount: 0, targetStart: 6, targetCount: 1 },
  ];
  const rows = buildDiffRows(base, target, hunks);
  const wide = markedChangedLines(rows, { path: 'm.ts', side: 'target', start: 2, end: 8 }, true);
  assert.deepEqual(wide.ranges, [{ side: 'target', start: 4, end: 4 }, { side: 'target', start: 6, end: 6 }]);
  assert.equal(wide.lines, 2, 'lines 2, 3, 5, 7 and 8 are context');
  const quiet = markedChangedLines(rows, { path: 'm.ts', side: 'target', start: 1, end: 3 }, true);
  assert.equal(quiet.lines, 0, 'a marking over unchanged code decides about nothing');
});

test('two places in one hunk decide separately, and overlapping places never count a line twice', () => {
  const first = [at('target', 151, 159)];
  const second = [at('target', 200, 204)];
  const separate = [walkDecision('d1', 'accepted', first), walkDecision('d2', 'accepted', second, { kind: 'walk', stepId: 'W1.2', placeId: 'p1' })];
  const definition = definitionWith(PATH);
  const base = emptyReviewState(REVISIONS, 'def.json', 'hash');
  assert.equal(computeCoverage(definition, [NEW_FILE], { ...base, decisions: separate }).acceptedLines, 14);
  // Withdrawing the first leaves the second.
  assert.equal(computeCoverage(definition, [NEW_FILE], { ...base, decisions: [...separate, walkDecision('d3', 'withdrawn', first)] }).acceptedLines, 5);

  const overlapping = [walkDecision('d1', 'accepted', first), walkDecision('d2', 'accepted', [at('target', 155, 165)])];
  assert.equal(computeCoverage(definition, [NEW_FILE], { ...base, decisions: overlapping }).acceptedLines, 15);
  // The same in the pair record.
  const record: PairRecord = { ...emptyRecord(PAIR), marks: [...pairMarks('manual', first, 'a', { kind: 'diff' }), ...pairMarks('manual', [at('target', 155, 165)], 'b', { kind: 'diff' })] };
  assert.equal(fileProgressOf(NEW_PAIR_FILE, record).manual, 15);
  // The second place reads its own 11 lines, the overlap included, all held by the later decision.
  const view = placeDecisionView(markedChangedLines(ROWS, { path: PATH, side: 'target', start: 155, end: 165 }, true), localHolds(overlapping, [NEW_FILE]));
  assert.deepEqual([view.marked.lines, view.accepted, view.held.length], [11, 11, 1], 'the later decision holds on the overlap');
});

test('removed lines: a place at To never decides about them, a place at From decides about exactly its own, an opened location about both it marks', () => {
  // Base lines 5–6 replaced by target lines 5–7; base line 10 removed with nothing in its place.
  const base = ['1', '2', '3', '4', 'old5', 'old6', '7', '8', '9', 'gone10', '11'];
  const target = ['1', '2', '3', '4', 'new5', 'new6', 'new7', '7', '8', '9', '11'];
  const hunks = [
    { id: 'H1', path: 'r.ts', baseStart: 5, baseCount: 2, targetStart: 5, targetCount: 3 },
    { id: 'H2', path: 'r.ts', baseStart: 10, baseCount: 1, targetStart: 10, targetCount: 0 },
  ];
  const file: DiffFile = { path: 'r.ts', status: 'modified', binary: false, hunks, added: 3, deleted: 3 };
  const rows = buildDiffRows(base, target, hunks);

  const toPlace = markedChangedLines(rows, { path: 'r.ts', side: 'target', start: 5, end: 6 }, true);
  assert.deepEqual(toPlace.ranges, [{ side: 'target', start: 5, end: 6 }], 'the replaced old lines are not the marking of a place at To');
  const fromPlace = markedChangedLines(rows, { path: 'r.ts', side: 'base', start: 6, end: 6 }, true);
  assert.deepEqual(fromPlace.ranges, [{ side: 'base', start: 6, end: 6 }], 'one old line, not the other old line of the hunk');
  // Opened outside the walk, the location marks a replaced line's before and after, as its pane draws them.
  const opened = markedChangedLines(rows, { path: 'r.ts', side: 'target', start: 5, end: 5 }, false);
  assert.deepEqual(opened.ranges, [{ side: 'base', start: 5, end: 6 }, { side: 'target', start: 5, end: 5 }]);
  // The pure deletion follows only a span strictly around it, and only where both sides are marked.
  assert.deepEqual(markedChangedLines(rows, { path: 'r.ts', side: 'target', start: 10, end: 11 }, false).ranges, [{ side: 'base', start: 10, end: 10 }]);
  assert.equal(markedChangedLines(rows, { path: 'r.ts', side: 'target', start: 10, end: 11 }, true).lines, 0);

  // Mixed: the place at To accepted, the old line exempted; the rest of the hunk remains.
  const decisions = [
    walkDecision('d1', 'accepted', toPlace.ranges.map((range) => ({ path: 'r.ts', ...range }))),
    walkDecision('d2', 'exempted', fromPlace.ranges.map((range) => ({ path: 'r.ts', ...range }))),
  ];
  const coverage = computeCoverage(definitionWith('r.ts'), [file], { ...emptyReviewState(REVISIONS, 'def.json', 'hash'), decisions });
  assert.deepEqual([coverage.totalLines, coverage.acceptedLines, coverage.exemptedLines, coverage.remainingLines], [6, 2, 1, 3]);
});

test('an earlier whole-hunk decision is kept as recorded, said to be uncertain, and kept or withdrawn only by the person', () => {
  const definition = definitionWith(PATH);
  const legacy: ReviewDecision = { id: 'old', scope: { kind: 'hunk', path: PATH, hunkId: 'H1' }, outcome: 'accepted', reason: '', by: { kind: 'human' }, at: 't', revisions: REVISIONS };
  const base: ReviewState = { ...emptyReviewState(REVISIONS, 'def.json', 'hash'), decisions: [legacy] };
  // Read as it was saved: every line of the hunk, no narrowing to a marking shown now.
  assert.equal(computeCoverage(definition, [NEW_FILE], base).acceptedLines, 417);
  assert.equal(checkStateForSave(base, REVISIONS), null, 'an older record still saves');

  const marked = markedChangedLines(ROWS, { path: PATH, side: 'target', start: 151, end: 159 }, true);
  const holds = localHolds(base.decisions, [NEW_FILE]);
  const view = placeDecisionView(marked, holds);
  assert.equal(view.held.length, 1);
  assert.deepEqual([view.held[0]?.decision.scopeUncertain, view.held[0]?.here, view.held[0]?.beyond], [true, 9, 408]);

  // Keep: the same outcome over the lines it still holds on, said as kept. No longer uncertain.
  const still = stillHeld(view.held[0]!.decision, holds);
  assert.deepEqual(still, [at('target', 1, 417)]);
  const kept = [...base.decisions, walkDecision('k', 'accepted', still, { kind: 'kept', of: 'old' })];
  assert.equal(computeCoverage(definition, [NEW_FILE], { ...base, decisions: kept }).acceptedLines, 417);
  assert.equal(placeDecisionView(marked, localHolds(kept, [NEW_FILE])).held[0]?.decision.scopeUncertain, false);

  // Withdraw: the lines it still holds on return to remaining; the place can then accept its own 9.
  const withdrawn = [...base.decisions, walkDecision('w', 'withdrawn', still), walkDecision('n', 'accepted', [at('target', 151, 159)])];
  assert.equal(computeCoverage(definition, [NEW_FILE], { ...base, decisions: withdrawn }).acceptedLines, 9);
  assert.deepEqual(base.decisions, [legacy], 'the original decision is never rewritten');

  // In the pair record: a mark with no origin over more than the marking is uncertain; one the diff window made is not.
  const unknown: PairRecord = { ...emptyRecord(PAIR), marks: pairMarks('manual', [at('target', 1, 417)], 'u') };
  assert.equal(placeDecisionView(marked, pairHolds(unknown)).held[0]?.decision.scopeUncertain, true);
  const explicit: PairRecord = { ...emptyRecord(PAIR), marks: pairMarks('manual', [at('target', 1, 417)], 'e', { kind: 'diff' }) };
  assert.equal(placeDecisionView(marked, pairHolds(explicit)).held[0]?.decision.scopeUncertain, false);
  // A later decision over part of the uncertain one leaves it holding only on the rest.
  const partly: PairRecord = { ...unknown, marks: [...unknown.marks, ...pairMarks('exempt', [at('target', 1, 100)], 'x', { kind: 'diff' })] };
  const partView = placeDecisionView(marked, pairHolds(partly));
  assert.deepEqual(stillHeld(partView.held[0]!.decision, pairHolds(partly)), [at('target', 101, 417)]);
  assert.equal(partView.held[0]?.beyond, 308);
});

test('a decision scope and origin are checked before a record is saved', () => {
  assert.equal(isDecisionScope({ kind: 'lines', path: PATH, ranges: [{ side: 'target', start: 151, end: 159 }] }), true);
  for (const bad of [
    { kind: 'lines', path: PATH, ranges: [] },
    { kind: 'lines', path: PATH, ranges: [{ side: 'target', start: 0, end: 3 }] },
    { kind: 'lines', path: PATH, ranges: [{ side: 'target', start: 9, end: 3 }] },
    { kind: 'lines', path: PATH, ranges: [{ side: 'middle', start: 1, end: 3 }] },
    { kind: 'lines', path: '', ranges: [{ side: 'target', start: 1, end: 3 }] },
    { kind: 'region', path: PATH },
  ]) {
    assert.equal(isDecisionScope(bad), false, JSON.stringify(bad));
  }
  const state = emptyReviewState(REVISIONS, 'def.json', 'hash');
  const good = walkDecision('d1', 'accepted', [at('target', 151, 159)]);
  assert.equal(checkStateForSave({ ...state, decisions: [good] }, REVISIONS), null);
  assert.notEqual(checkStateForSave({ ...state, decisions: [{ ...good, scope: { kind: 'lines', path: PATH, ranges: [] } }] }, REVISIONS), null);
  assert.notEqual(checkStateForSave({ ...state, decisions: [{ ...good, origin: { kind: 'walk', stepId: 'W1.1' } }] }, REVISIONS), null);
  // A stored pair mark whose origin this version cannot read keeps the mark and leaves the origin out.
  const stored = { ...emptyRecord(PAIR), marks: [{ ...pairMarks('manual', [at('target', 1, 2)], 'm')[0], origin: { kind: 'future' } }] };
  const adopted = adoptPairRecord(JSON.parse(JSON.stringify(stored)), PAIR);
  assert.equal(adopted.marks.length, 1);
  assert.equal(adopted.marks[0]?.origin, undefined);
});
