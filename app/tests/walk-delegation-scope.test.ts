/**
 * Delegating a walk mandates exactly its places' changed lines (DSP-203).
 *
 * In 0.1.23 a walk's delegation took every hunk a step of the walk planned, so a walk over lines
 * 151–159 of a new 417-line file delegated 417 lines. These check the mandate the walk now sends,
 * the remaining-lines default, the host's reading of an agent's answer against the mandate, and
 * that the person's decisions stand beside an agent's assessment however the two are combined.
 *
 *     node --import ./scripts/ts-resolve.mjs --import ./scripts/test-offline-guard.mjs --test tests/walk-delegation-scope.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readReviewAnswer } from '../src/shared/review-agent.ts';
import { hunkLocations, lineCount, parseReviewDefinition, undecidedLines, walkChangedLines, type CodeLocation, type DiffFile, type Walk } from '../src/shared/review-model.ts';
import { adoptPairRecord, emptyRecord, fileProgressOf, jobFrom, lineStatusOf, type AgentJob, type AgentReview, type DelegationScope, type PairFile, type PairMark, type PairRecord } from '../src/shared/review-pair.ts';
import { pairAgentBeside, pairHolds, pairRanges } from '../src/shared/review-pair-walk.ts';

const REVISIONS = { base: 'a'.repeat(40), target: 'b'.repeat(40) };
const PAIR = { repository: '/repo', base: REVISIONS.base, target: REVISIONS.target };
const PATH = 'src/big.ts';
const NEW_FILE: DiffFile = { path: PATH, status: 'added', binary: false, hunks: [{ id: 'H1', path: PATH, baseStart: 0, baseCount: 0, targetStart: 1, targetCount: 417 }], added: 417, deleted: 0 };
const NEW_PAIR_FILE: PairFile = { key: PATH, status: 'added', oldPath: null, newPath: PATH, similarity: null, binary: false, hunks: [{ baseStart: 0, baseCount: 0, targetStart: 1, targetCount: 417 }], added: 417, deleted: 0 };

/** A walk whose steps each have one place at To. */
function walkOver(places: readonly { readonly path: string; readonly side?: 'base' | 'target'; readonly start: number; readonly end: number }[]): Walk {
  const { definition } = parseReviewDefinition({
    format: 'dspatch-review/1',
    title: 't',
    repository: '.',
    base: REVISIONS.base,
    target: REVISIONS.target,
    walks: [{ id: 'W1', title: 'w', question: 'q', steps: places.map((place, index) => ({ id: `W1.${String(index + 1)}`, title: 's', text: 't', refs: [{ path: place.path, side: place.side ?? 'target', start: place.start, end: place.end, role: 'walk' }] })) }],
  });
  assert.ok(definition !== null);
  return definition.walks[0] as Walk;
}

const walkScope = (locations: readonly CodeLocation[], basis: 'remaining' | 'all'): DelegationScope => ({ kind: 'walk', label: `walk W1 · w · ${basis} lines`, ranges: pairRanges(locations), basis });
const mark = (id: string, op: PairMark['op'], scope: PairMark['scope']): PairMark => ({ id, op, scope, reason: '', at: 't', ...(scope.kind === 'lines' ? { origin: { kind: 'diff' as const } } : {}) });
const lines = (start: number, end: number): PairMark['scope'] => ({ kind: 'lines', side: 'target', path: PATH, start, end });
const approval = (jobId: string, start: number, end: number): AgentReview => ({ id: `${jobId}-${String(start)}`, scope: { kind: 'lines', side: 'target', path: PATH, start, end }, reviewer: 'Agent · model', recordedAt: 't', summary: 'fine', jobId });

test('the 417-line case: a walk over 151–159 mandates 9 lines, where its hunks would be 417', () => {
  const walk = walkOver([{ path: PATH, start: 151, end: 159 }]);
  const mandate = walkChangedLines(walk, [NEW_FILE]);
  assert.deepEqual(mandate, [{ path: PATH, side: 'target', start: 151, end: 159 }]);
  assert.equal(lineCount(mandate), 9);
  assert.equal(lineCount(hunkLocations(NEW_FILE.hunks[0]!)), 417, 'what the walk delegated before');
});

test('an answer naming the whole file records only the mandate', () => {
  const scope = walkScope([{ path: PATH, side: 'target', start: 151, end: 159 }], 'all');
  const read = readReviewAnswer({ assessment: 'Looks right.', reviewed: [{ path: PATH, side: 'target', start: 1, end: 417 }], approved: [{ path: PATH, side: 'target', start: 1, end: 417 }], findings: [{ severity: 'note', text: 'The caller at line 12 sets it up.', path: PATH, side: 'target', start: 12, end: 12 }] }, scope, [NEW_PAIR_FILE]);
  assert.ok(!('error' in read));
  assert.deepEqual(read.approved, [{ kind: 'lines', side: 'target', path: PATH, start: 151, end: 159 }]);
  assert.deepEqual(read.reviewed, [{ kind: 'lines', side: 'target', path: PATH, start: 151, end: 159 }]);
  assert.ok(read.adjustments.some((entry) => /outside the delegated scope/.test(entry)), JSON.stringify(read.adjustments));
  assert.equal(read.findings[0]?.location?.start, 12, 'a finding may point at context outside the mandate');
  // Recorded and accepted, it counts 9 lines of the file, the finding's line none.
  const record: PairRecord = { ...emptyRecord(PAIR), agentReviews: read.approved.map((range, index) => ({ ...approval('job-1', range.start, range.end), id: `a${String(index)}` })), marks: [mark('m1', 'accept-agent', { kind: 'job', jobId: 'job-1' })] };
  assert.deepEqual([fileProgressOf(NEW_PAIR_FILE, record).handled, fileProgressOf(NEW_PAIR_FILE, record).agent], [9, 9]);
  assert.equal(lineStatusOf({ side: 'target', path: PATH, line: 12 }, record).accepted.length, 0);
});

test('two places in one hunk, overlapping, mandate their union once', () => {
  const walk = walkOver([{ path: PATH, start: 151, end: 159 }, { path: PATH, start: 155, end: 165 }, { path: PATH, start: 300, end: 302 }]);
  assert.deepEqual(walkChangedLines(walk, [NEW_FILE]), [{ path: PATH, side: 'target', start: 151, end: 165 }, { path: PATH, side: 'target', start: 300, end: 302 }]);
  assert.equal(lineCount(walkChangedLines(walk, [NEW_FILE])), 18);
});

test('base and target sides, unchanged context and other removals of a hunk', () => {
  // Old lines 5–6 replaced by new lines 5–7; old line 10 removed elsewhere; the place at To also takes unchanged line 8.
  const file: DiffFile = {
    path: 'r.ts',
    status: 'modified',
    binary: false,
    hunks: [
      { id: 'H1', path: 'r.ts', baseStart: 5, baseCount: 2, targetStart: 5, targetCount: 3 },
      { id: 'H2', path: 'r.ts', baseStart: 10, baseCount: 1, targetStart: 10, targetCount: 0 },
    ],
    added: 3,
    deleted: 3,
  };
  const walk = walkOver([{ path: 'r.ts', start: 5, end: 8 }]);
  assert.deepEqual(walkChangedLines(walk, [file]), [
    { path: 'r.ts', side: 'base', start: 5, end: 6 },
    { path: 'r.ts', side: 'target', start: 5, end: 7 },
  ], 'the replaced old lines and the new ones; not unchanged line 8, not the removal at old line 10');
  // A place in a file the diff does not change covers nothing.
  assert.deepEqual(walkChangedLines(walkOver([{ path: 'other.ts', start: 1, end: 3 }]), [file]), []);
});

test('remaining lines leave out the person\'s decisions and accepted assessments, not ones still awaiting', () => {
  const mandate = walkChangedLines(walkOver([{ path: PATH, start: 151, end: 159 }]), [NEW_FILE]);
  // About half decided by the person: 151–155 accepted.
  let record: PairRecord = { ...emptyRecord(PAIR), marks: [mark('m1', 'manual', lines(151, 155))] };
  assert.deepEqual(undecidedLines(mandate, pairHolds(record)), [{ path: PATH, side: 'target', start: 156, end: 159 }]);
  // An assessment of 156–157 awaiting the person's decision counts nothing.
  record = { ...record, agentReviews: [approval('job-1', 156, 157)], jobs: [] };
  assert.equal(lineCount(undecidedLines(mandate, pairHolds(record))), 4);
  // Once the person accepted it, those lines are decided.
  record = { ...record, marks: [...record.marks, mark('m2', 'accept-agent', { kind: 'job', jobId: 'job-1' })] };
  assert.deepEqual(undecidedLines(mandate, pairHolds(record)), [{ path: PATH, side: 'target', start: 158, end: 159 }]);
  // An exempted line is decided too; with nothing left, the default has nothing to start.
  record = { ...record, marks: [...record.marks, mark('m3', 'exempt', lines(158, 159))] };
  assert.deepEqual(undecidedLines(mandate, pairHolds(record)), []);
});

test('reviewing all lines keeps every decision of the person\'s, through accepting and withdrawing the assessment, with no line counted twice', () => {
  const mandate = walkChangedLines(walkOver([{ path: PATH, start: 151, end: 159 }]), [NEW_FILE]);
  const scope = walkScope(mandate, 'all');
  assert.equal(lineCount(scope.ranges), 9);
  const manual = mark('m1', 'manual', lines(151, 155));
  const read = readReviewAnswer({ assessment: 'Fine.', reviewed: [{ path: PATH, side: 'target', start: 151, end: 159 }], approved: [{ path: PATH, side: 'target', start: 151, end: 159 }] }, scope, [NEW_PAIR_FILE]);
  assert.ok(!('error' in read));
  const reviews = read.approved.map((range) => approval('job-all', range.start, range.end));
  // Awaiting: the person's 5 lines stay theirs, the other 4 are not handled; the edge says awaiting.
  let record: PairRecord = { ...emptyRecord(PAIR), marks: [manual], agentReviews: reviews };
  let progress = fileProgressOf(NEW_PAIR_FILE, record);
  assert.deepEqual([progress.handled, progress.manual, progress.agent, progress.assessed], [5, 5, 0, 4]);
  assert.equal(pairAgentBeside(record)(PATH, 'target', 151), 'awaiting');
  assert.equal(lineStatusOf({ side: 'target', path: PATH, line: 151 }, record).decision?.id, 'm1');
  // Accepted: 9 handled, 5 by the person and 4 through the delegation; the person's decision is still the one on 151–155.
  record = { ...record, marks: [manual, mark('m2', 'accept-agent', { kind: 'job', jobId: 'job-all' })] };
  progress = fileProgressOf(NEW_PAIR_FILE, record);
  assert.deepEqual([progress.handled, progress.manual, progress.agent], [9, 5, 4]);
  assert.equal(pairAgentBeside(record)(PATH, 'target', 151), 'accepted');
  assert.equal(pairHolds(record)(PATH, 'target', 151)?.id, 'm1', 'the walk reads the person\'s decision first');
  // The acceptance withdrawn: the person's 5 lines stay, the agent's 4 return to remaining.
  record = { ...record, marks: [...record.marks, mark('m3', 'clear', { kind: 'job', jobId: 'job-all' })] };
  progress = fileProgressOf(NEW_PAIR_FILE, record);
  assert.deepEqual([progress.handled, progress.manual, progress.agent], [5, 5, 0]);
});

test('decisions the person makes while the job runs stand when its result arrives', () => {
  const mandate = walkChangedLines(walkOver([{ path: PATH, start: 151, end: 159 }]), [NEW_FILE]);
  // Started with the remaining lines 156–159 after 151–155 were accepted.
  const before: PairRecord = { ...emptyRecord(PAIR), marks: [mark('m1', 'manual', lines(151, 155))] };
  const scope = walkScope(undecidedLines(mandate, pairHolds(before)), 'remaining');
  assert.deepEqual(scope.ranges, [{ kind: 'lines', side: 'target', path: PATH, start: 156, end: 159 }]);
  // While it runs the person exempts 156 and accepts 157, from the walk.
  const during: PairRecord = { ...before, marks: [...before.marks, { ...mark('m2', 'exempt', lines(156, 156)), origin: { kind: 'walk', stepId: 'W1.1', placeId: 'r1' } }, { ...mark('m3', 'manual', lines(157, 157)), origin: { kind: 'walk', stepId: 'W1.1', placeId: 'r1' } }] };
  // The result arrives assessing all four, and the person accepts it.
  const read = readReviewAnswer({ assessment: 'Fine.', reviewed: [{ path: PATH, side: 'target', start: 151, end: 159 }], approved: [{ path: PATH, side: 'target', start: 151, end: 159 }] }, scope, [NEW_PAIR_FILE]);
  assert.ok(!('error' in read));
  assert.deepEqual(read.approved, scope.ranges, 'the mandate fixed at the start: 156–159, not 151–159');
  const after: PairRecord = { ...during, agentReviews: read.approved.map((range) => approval('job-r', range.start, range.end)), marks: [...during.marks, mark('m4', 'accept-agent', { kind: 'job', jobId: 'job-r' })] };
  const at = (line: number) => lineStatusOf({ side: 'target', path: PATH, line }, after);
  assert.equal(at(156).decision?.op, 'exempt');
  assert.deepEqual(at(156).decision?.origin, { kind: 'walk', stepId: 'W1.1', placeId: 'r1' });
  assert.equal(at(157).decision?.op, 'manual');
  const progress = fileProgressOf(NEW_PAIR_FILE, after);
  assert.deepEqual([progress.handled, progress.manual, progress.exempted, progress.agent], [9, 6, 1, 2]);
});

test('an older walk job keeps its stored whole-hunk scope; a new one keeps its basis, across saving and reading back', () => {
  const job = (scope: unknown): unknown => ({ id: 'job-x', kind: 'review', state: 'done', provider: 'claude', model: 'm', startedAt: 't', endedAt: 't', note: '', detail: '', scope, result: null, definitionPath: null, uncovered: [] });
  const older = jobFrom(job({ kind: 'walk', label: 'walk W1 · w', ranges: [{ kind: 'lines', side: 'target', path: PATH, start: 1, end: 417 }] })) as AgentJob;
  assert.equal(older.scope?.basis, undefined, 'no basis is made up for an older job');
  assert.equal(lineCount(older.scope?.ranges ?? []), 417, 'its stored mandate is kept as it was');
  const newer = jobFrom(job(walkScope([{ path: PATH, side: 'target', start: 151, end: 159 }], 'remaining'))) as AgentJob;
  assert.equal(newer.scope?.basis, 'remaining');
  assert.equal(jobFrom(job({ ...walkScope([{ path: PATH, side: 'target', start: 151, end: 159 }], 'all'), basis: 'everything' }))?.scope?.basis, undefined, 'an unknown basis is not kept');
  const stored: PairRecord = { ...emptyRecord(PAIR), jobs: [older, newer], marks: [mark('m1', 'manual', lines(151, 155))], agentReviews: [approval(newer.id, 156, 159)] };
  const reread = adoptPairRecord(JSON.parse(JSON.stringify(stored)), PAIR);
  assert.deepEqual(reread.jobs.map((entry) => [entry.scope?.basis ?? null, lineCount(entry.scope?.ranges ?? [])]), [[null, 417], ['remaining', 9]]);
  assert.deepEqual(reread.marks[0]?.origin, { kind: 'diff' });
  assert.equal(reread.agentReviews[0]?.jobId, newer.id);
});
