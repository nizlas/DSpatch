/**
 * The review model: the real diff, prepared walks and the reviewer's record.
 *
 * Most of the weight is on the things that would make a review lie quietly: a diff
 * that drops or misplaces a line, a reference that points at the wrong code, and
 * any path by which being shown or walked through turns into a decision.
 *
 *     node --test tests/review-model.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  adoptStoredState,
  buildDiffRows,
  checkReference,
  computeCoverage,
  currentHunkDecisions,
  emptyReviewState,
  highlightLines,
  hunkPlanState,
  parseDiff,
  parseNameStatus,
  parseReviewDefinition,
  splitLines,
  type CodeReference,
  type DiffHunk,
  type ReviewDecision,
  type ReviewDefinition,
  type ReviewState,
} from '../src/shared/review-model.ts';

const REVISIONS = { base: 'a'.repeat(40), target: 'b'.repeat(40) };

function hunk(partial: Partial<DiffHunk> & Pick<DiffHunk, 'baseStart' | 'baseCount' | 'targetStart' | 'targetCount'>): DiffHunk {
  return { id: 'H1', path: 'src/x.ts', ...partial };
}

test('a git -U0 diff with an insertion, a replacement and a deletion rebuilds both versions exactly', () => {
  const base = ['one', 'two', 'three', 'four', 'five', 'six'];
  const target = ['one', 'inserted', 'two', 'THREE', 'four', 'six'];
  const nameStatus = parseNameStatus('M\0src/x.ts\0');
  const unified = [
    'diff --git a/src/x.ts b/src/x.ts',
    'index 1111111..2222222 100644',
    '--- a/src/x.ts',
    '+++ b/src/x.ts',
    '@@ -1,0 +2 @@ one',
    '+inserted',
    '@@ -3 +4 @@ two',
    '-three',
    '+THREE',
    '@@ -5 +5,0 @@ four',
    '-five',
    '',
  ].join('\n');
  const [file] = parseDiff(nameStatus, unified);
  assert.ok(file !== undefined);
  assert.equal(file.hunks.length, 3);
  assert.deepEqual(
    file.hunks.map((entry) => [entry.id, entry.baseStart, entry.baseCount, entry.targetStart, entry.targetCount]),
    [
      ['H1', 1, 0, 2, 1],
      ['H2', 3, 1, 4, 1],
      ['H3', 5, 1, 5, 0],
    ],
  );
  assert.equal(file.added, 2);
  assert.equal(file.deleted, 2);
  const rows = buildDiffRows(base, target, file.hunks);
  // Every line of both versions appears exactly once, in order.
  assert.deepEqual(rows.filter((row) => row.kind !== 'added').map((row) => row.text), base);
  assert.deepEqual(rows.filter((row) => row.kind !== 'deleted').map((row) => row.text), target);
  assert.deepEqual(
    rows.map((row) => `${row.kind[0] ?? ''}${String(row.baseLine ?? '-')}/${String(row.targetLine ?? '-')}`),
    ['c1/1', 'a-/2', 'c2/3', 'd3/-', 'a-/4', 'c4/5', 'd5/-', 'c6/6'],
  );
});

test('hunks that disagree with the file contents are refused, not drawn', () => {
  assert.throws(() => buildDiffRows(['a', 'b'], ['a', 'b', 'c'], []), /do not match/);
});

test('every listed file must have a diff section naming it; a missing or misnamed one throws', () => {
  const nameStatus = parseNameStatus('M\0a.ts\0A\0b.ts\0');
  assert.throws(() => parseDiff(nameStatus, 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n'), /2 changed files/);
  assert.throws(
    () =>
      parseDiff(
        nameStatus,
        'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\ndiff --git a/c.ts b/c.ts\n--- /dev/null\n+++ b/c.ts\n',
      ),
    /names c\.ts, expected b\.ts/,
  );
});

test('a path with spaces (git adds a tab after it), an added and a binary file are all kept', () => {
  const nameStatus = parseNameStatus('A\0docs/a b.md\0M\0img.png\0');
  const [text, binary] = parseDiff(
    nameStatus,
    [
      'diff --git a/docs/a b.md b/docs/a b.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/docs/a b.md\t',
      '@@ -0,0 +1,2 @@',
      '+x',
      '+y',
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n'),
  );
  assert.equal(text?.status, 'added');
  assert.equal(text?.added, 2);
  assert.equal(binary?.binary, true);
  assert.deepEqual(binary?.hunks, []);
  assert.throws(() => parseNameStatus('R100\0old\0new\0'), /renames/);
});

test('splitLines drops line terminators and only a final empty line', () => {
  assert.deepEqual(splitLines('a\r\nb\n\nc\n'), ['a', 'b', '', 'c']);
  assert.deepEqual(splitLines(''), []);
});

test('a definition reports every structural problem, and only well-formed references survive', () => {
  const { definition, problems } = parseReviewDefinition({
    format: 'dspatch-review/1',
    title: 't',
    repository: 'repo',
    base: 'x',
    target: 'y',
    walks: [
      {
        id: 'W1',
        title: 'w',
        question: 'q',
        steps: [
          {
            id: 'W1.1',
            title: 's',
            text: 'text',
            refs: [
              { path: 'a.ts', side: 'target', start: 3, end: 2, role: 'walk' },
              { path: 'a\\b.ts', side: 'target', start: 1, end: 1, role: 'walk' },
              { path: 'ok.ts', side: 'middle', start: 1, end: 1, role: 'walk' },
              { path: 'ok.ts', side: 'base', start: 1, end: 4, role: 'evidence', anchor: 'x' },
            ],
            claims: [{ label: 'proven', text: 'nope' }, { label: 'analysis', text: 'fine' }],
          },
          { id: 'W1.1', title: 'dup', text: 't', refs: [] },
        ],
      },
    ],
  });
  assert.ok(definition !== null);
  const step = definition.walks[0]?.steps[0];
  assert.equal(step?.refs.length, 2, 'the backslash path is reported but the shape survives; bad ranges and sides do not');
  assert.deepEqual(step?.claims.map((claim) => claim.label), ['analysis']);
  const text = problems.map((problem) => problem.problem).join('\n');
  assert.match(text, /start ≤ end/);
  assert.match(text, /forward slashes/);
  assert.match(text, /"side" must be/);
  assert.match(text, /"label" must be one of/);
  assert.match(text, /Duplicate id "W1.1"/);
  assert.match(text, /"refs" must be a non-empty array/);
  assert.equal(parseReviewDefinition([]).definition, null);
});

test('a reference is checked for existence, range and anchor at its revision', () => {
  const ref: CodeReference = { path: 'a.ts', side: 'target', start: 2, end: 3, role: 'walk', anchor: 'needle' };
  assert.equal(checkReference(ref, ['x', 'y', 'has needle', 'z']), null);
  assert.match(checkReference(ref, ['needle', 'y', 'z']) ?? '', /does not occur in a\.ts:2–3 at target/);
  assert.equal(checkReference({ ...ref, anchor: 'z' }, ['needle', 'y', 'z']), null);
  assert.match(checkReference(ref, ['x', 'y']) ?? '', /has 2 lines/);
  assert.match(checkReference(ref, null) ?? '', /does not exist at target/);
});

test('plan state: added lines decide; deletions follow their hunk; a pure deletion needs base lines or a span', () => {
  const mixed = hunk({ baseStart: 10, baseCount: 2, targetStart: 10, targetCount: 3 });
  const walk = (side: 'base' | 'target', start: number, end: number): CodeReference => ({
    path: 'src/x.ts',
    side,
    start,
    end,
    role: 'walk',
  });
  assert.equal(hunkPlanState(mixed, [walk('target', 10, 12)]), 'full');
  assert.equal(hunkPlanState(mixed, [walk('target', 11, 20)]), 'partial');
  assert.equal(hunkPlanState(mixed, [walk('base', 10, 11)]), 'partial');
  assert.equal(hunkPlanState(mixed, [{ ...walk('target', 10, 12), role: 'evidence' }]), 'none');
  assert.equal(hunkPlanState(mixed, [{ ...walk('target', 10, 12), path: 'other.ts' }]), 'none');

  const deletion = hunk({ baseStart: 5, baseCount: 3, targetStart: 4, targetCount: 0 });
  assert.equal(hunkPlanState(deletion, [walk('base', 5, 7)]), 'full');
  assert.equal(hunkPlanState(deletion, [walk('base', 6, 6)]), 'partial');
  assert.equal(hunkPlanState(deletion, [walk('target', 4, 5)]), 'full');
  assert.equal(hunkPlanState(deletion, [walk('target', 1, 4)]), 'none');
});

function fixture(): { definition: ReviewDefinition; files: ReturnType<typeof parseDiff> } {
  const files = parseDiff(
    parseNameStatus('M\0src/x.ts\0M\0src/y.ts\0'),
    [
      'diff --git a/src/x.ts b/src/x.ts',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -2 +2,2 @@',
      'diff --git a/src/y.ts b/src/y.ts',
      '--- a/src/y.ts',
      '+++ b/src/y.ts',
      '@@ -7,0 +8 @@',
      '',
    ].join('\n'),
  );
  const { definition } = parseReviewDefinition({
    format: 'dspatch-review/1',
    title: 't',
    repository: '.',
    base: REVISIONS.base,
    target: REVISIONS.target,
    walks: [
      {
        id: 'W1',
        title: 'w',
        question: 'q',
        steps: [
          { id: 'W1.1', title: 's', text: 't', refs: [{ path: 'src/x.ts', side: 'target', start: 1, end: 5, role: 'walk' }] },
          { id: 'W1.2', title: 's', text: 't', refs: [{ path: 'src/y.ts', side: 'target', start: 8, end: 8, role: 'evidence' }] },
        ],
      },
    ],
  });
  assert.ok(definition !== null);
  return { definition, files };
}

test('coverage keeps planned, shown, walked and decided apart — none implies another', () => {
  const { definition, files } = fixture();
  const fresh = emptyReviewState(REVISIONS, 'def.json', 'hash');
  let coverage = computeCoverage(definition, files, fresh);
  assert.equal(coverage.totalLines, 1 + 2 + 1);
  assert.deepEqual(
    coverage.hunks.map((entry) => [entry.hunk.id, entry.planned, entry.shown, entry.walked, entry.decision]),
    [
      ['H1', 'full', 'none', 'none', null],
      ['H2', 'none', 'none', 'none', null],
    ],
  );
  assert.equal(coverage.remainingLines, 4, 'nothing is decided until someone decides it');

  // Shown and walked through: progress, still no decision.
  const progressed: ReviewState = {
    ...fresh,
    shownSteps: { 'W1.1': 't', 'W1.2': 't' },
    walkedSteps: { 'W1.1': 't' },
  };
  coverage = computeCoverage(definition, files, progressed);
  assert.equal(coverage.hunks[0]?.shown, 'full');
  assert.equal(coverage.hunks[0]?.walked, 'full');
  assert.equal(coverage.hunks[1]?.shown, 'none', 'an evidence reference is not coverage');
  assert.equal(coverage.acceptedLines, 0);
  assert.equal(coverage.remainingLines, 4);

  // A decision, then its withdrawal.
  const decision = (outcome: ReviewDecision['outcome'], id: string): ReviewDecision => ({
    id,
    scope: { kind: 'hunk', path: 'src/x.ts', hunkId: 'H1' },
    outcome,
    reason: outcome === 'exempted' ? 'generated' : '',
    by: { kind: 'human' },
    at: 't',
    revisions: REVISIONS,
  });
  coverage = computeCoverage(definition, files, { ...progressed, decisions: [decision('accepted', 'd1')] });
  assert.equal(coverage.acceptedLines, 3);
  assert.equal(coverage.remainingLines, 1);
  assert.equal(coverage.hunks[0]?.decision?.by.kind, 'human');
  coverage = computeCoverage(definition, files, {
    ...progressed,
    decisions: [decision('accepted', 'd1'), decision('withdrawn', 'd2')],
  });
  assert.equal(coverage.acceptedLines, 0);
  assert.equal(coverage.hunks[0]?.decision, null);

  // A file decision covers the hunks it names; a later hunk decision overrides one of them.
  const current = currentHunkDecisions([
    { ...decision('accepted', 'd3'), scope: { kind: 'file', path: 'src/x.ts', hunkIds: ['H1', 'H9'] } },
    decision('exempted', 'd4'),
  ]);
  assert.equal(current.get('H1')?.outcome, 'exempted');
  assert.equal(current.get('H9')?.outcome, 'accepted');
});

test('open findings and questions are counted on the hunks their location touches', () => {
  const { definition, files } = fixture();
  const state: ReviewState = {
    ...emptyReviewState(REVISIONS, 'def.json', 'hash'),
    notes: [
      {
        id: 'n1',
        kind: 'finding',
        text: 'wrong',
        location: { path: 'src/x.ts', side: 'target', start: 3, end: 3 },
        stepId: null,
        status: 'open',
        resolution: '',
        createdAt: 't',
        updatedAt: 't',
        revisions: REVISIONS,
      },
      {
        id: 'n2',
        kind: 'question',
        text: 'why',
        location: { path: 'src/x.ts', side: 'target', start: 30, end: 31 },
        stepId: null,
        status: 'open',
        resolution: '',
        createdAt: 't',
        updatedAt: 't',
        revisions: REVISIONS,
      },
    ],
  };
  const coverage = computeCoverage(definition, files, state);
  assert.equal(coverage.hunks[0]?.openFindings, 1);
  assert.equal(coverage.hunks[0]?.openQuestions, 0, 'a question outside the hunk is not on it');
  assert.equal(coverage.openQuestions, 1, 'but it is still counted overall');
});

test('a stored record is adopted only for the same revision pair', () => {
  const state = emptyReviewState(REVISIONS, 'def.json', 'hash');
  const stored: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(adoptStoredState(stored, REVISIONS) !== null);
  assert.equal(adoptStoredState(stored, { ...REVISIONS, target: 'c'.repeat(40) }), null);
  assert.equal(adoptStoredState({ ...state, version: 2 }, REVISIONS), null);
  assert.equal(adoptStoredState('nonsense', REVISIONS), null);
});

test('highlighting keeps every character and carries block comments and template strings across lines', () => {
  const lines = ['const a = "x" + 1; // note', '/* start', 'still comment */ return `t', 'emplate` + b;'];
  const tokens = highlightLines(lines, 'src/x.ts');
  tokens.forEach((line, index) => {
    assert.equal(line.map((token) => token.text).join(''), lines[index]);
  });
  assert.deepEqual(
    tokens[0]?.filter((token) => token.kind !== 'plain').map((token) => [token.kind, token.text]),
    [
      ['keyword', 'const'],
      ['string', '"x"'],
      ['number', '1'],
      ['comment', '// note'],
    ],
  );
  assert.equal(tokens[1]?.[0]?.kind, 'comment');
  assert.equal(tokens[2]?.[0]?.kind, 'comment');
  assert.equal(tokens[3]?.[0]?.kind, 'string');
  assert.deepEqual(highlightLines(['# title'], 'README.md'), [[{ kind: 'plain', text: '# title' }]]);
});
