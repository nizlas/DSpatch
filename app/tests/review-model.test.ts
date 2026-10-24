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
  REVIEW_CHANNELS,
  adoptPreferences,
  adoptStoredState,
  buildDiffRows,
  checkFileRequest,
  checkReference,
  checkStateForSave,
  computeCoverage,
  currentHunkDecisions,
  emptyReviewState,
  highlightLines,
  hunkPlanState,
  parseDiff,
  parseNameStatus,
  parseReviewDefinition,
  placeKey,
  referenceRows,
  carryStepMarks,
  staleOpenedMarks,
  stepContentHash,
  stepHashesOf,
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
  // A version 1 file: walk references become places, evidence references stay evidence.
  assert.equal(step?.places.length, 1);
  assert.equal(step?.evidenceRefs.length, 1);
  assert.deepEqual(step?.evidence.map((claim) => claim.label), ['analysis']);
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
  // Opening a step is not having seen all of it: only references put on screen count.
  const opened: ReviewState = { ...fresh, shownSteps: { 'W1.1': 't' } };
  assert.equal(computeCoverage(definition, files, opened).hunks[0]?.shown, 'none');
  const progressed: ReviewState = {
    ...fresh,
    shownSteps: { 'W1.1': 't', 'W1.2': 't' },
    shownRefs: { 'W1.1@r1': 't', 'W1.2@r1': 't' },
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

test('a stored record is adopted only for the same revision pair and in the expected shape', () => {
  const state = emptyReviewState(REVISIONS, 'def.json', 'hash');
  const stored: unknown = JSON.parse(JSON.stringify(state));
  assert.ok(adoptStoredState(stored, REVISIONS) !== null);
  assert.equal(adoptStoredState(stored, { ...REVISIONS, target: 'c'.repeat(40) }), null);
  assert.equal(adoptStoredState({ ...state, version: 2 }, REVISIONS), null);
  assert.equal(adoptStoredState('nonsense', REVISIONS), null);
  assert.equal(adoptStoredState({ ...state, decisions: undefined }, REVISIONS), null, 'missing decisions');
  assert.equal(adoptStoredState({ ...state, position: { stepId: 3 } }, REVISIONS), null, 'damaged position');
  // A record written before per-reference "shown" existed is read with none shown.
  const { shownRefs: _dropped, ...older } = state;
  assert.deepEqual(adoptStoredState(older, REVISIONS)?.shownRefs, {});
});

test('the main process accepts only human decisions and notes at the open revision pair', () => {
  const state = emptyReviewState(REVISIONS, 'def.json', 'hash');
  const decision: ReviewDecision = {
    id: 'd',
    scope: { kind: 'hunk', path: 'a.ts', hunkId: 'H1' },
    outcome: 'accepted',
    reason: '',
    by: { kind: 'human' },
    at: 't',
    revisions: REVISIONS,
  };
  assert.equal(checkStateForSave({ ...state, decisions: [decision] }, REVISIONS), null);
  assert.match(
    checkStateForSave(
      { ...state, decisions: [{ ...decision, by: { kind: 'agent-delegated', adapterId: 'x', mandate: 'y' } }] },
      REVISIONS,
    ) ?? '',
    /Only decisions made by a person/,
  );
  assert.match(
    checkStateForSave({ ...state, decisions: [{ ...decision, revisions: { ...REVISIONS, target: 'c'.repeat(40) } }] }, REVISIONS) ?? '',
    /different revision pair/,
  );
  assert.match(checkStateForSave({ ...state, revisions: { ...REVISIONS, base: 'c'.repeat(40) } }, REVISIONS) ?? '', /shape/);
});

test('file requests from the view name a side and a repository-relative path', () => {
  assert.equal(checkFileRequest('target', 'src/a.ts'), null);
  assert.ok(checkFileRequest('middle', 'src/a.ts') !== null);
  assert.ok(checkFileRequest('base', '') !== null);
  assert.ok(checkFileRequest('base', '/etc/passwd') !== null);
  assert.ok(checkFileRequest('base', 'src\\a.ts') !== null);
  assert.ok(checkFileRequest('base', 42) !== null);
});

test('a deleted line that starts with "-- " is a deletion, not a file header', () => {
  const [file] = parseDiff(
    parseNameStatus('M\0q.sql\0'),
    ['diff --git a/q.sql b/q.sql', '--- a/q.sql', '+++ b/q.sql', '@@ -2 +1,0 @@', '--- a comment', '@@ -4,0 +3 @@', '+++ x', ''].join('\n'),
  );
  assert.deepEqual(
    file?.hunks.map((hunk) => [hunk.baseStart, hunk.baseCount, hunk.targetStart, hunk.targetCount]),
    [
      [2, 1, 1, 0],
      [4, 0, 3, 1],
    ],
  );
});

test('a definition naming a short or symbolic revision is warned about', () => {
  const { problems } = parseReviewDefinition({
    format: 'dspatch-review/1',
    title: 't',
    repository: '.',
    base: 'main',
    target: 'b'.repeat(40),
    walks: [{ id: 'W', title: 't', question: 'q', steps: [{ id: 'S', title: 't', text: 't', refs: [{ path: 'a', side: 'target', start: 1, end: 1, role: 'walk' }] }] }],
  });
  assert.deepEqual(problems.map((problem) => problem.problem.slice(0, 33)), ['"base" is "main", not a full comm']);
});

test('the preload repeats every review channel name exactly', async () => {
  const fs = await import('node:fs');
  const preload = fs.readFileSync(new URL('../src/preload/preload.ts', import.meta.url), 'utf8');
  for (const channel of Object.values(REVIEW_CHANNELS)) {
    assert.ok(preload.includes(`'${channel}'`), channel);
  }
  const literal = preload.match(/'dspatch:review-[a-z-]+'/g) ?? [];
  assert.deepEqual([...new Set(literal)].sort(), Object.values(REVIEW_CHANNELS).map((channel) => `'${channel}'`).sort());
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

// --- Version 2: places, two languages, precise focus (second iteration) ---------

test('a version 2 definition needs both languages, gives each place a focus and context, and lists every reference', () => {
  const { definition, problems } = parseReviewDefinition({
    format: 'dspatch-review/2',
    title: { sv: 'Titel', en: 'Title' },
    repository: '.',
    base: 'a'.repeat(40),
    target: 'b'.repeat(40),
    walks: [
      {
        id: 'W1',
        title: { sv: 'Walk', en: 'Walk' },
        question: { sv: 'Fråga', en: '' },
        steps: [
          {
            id: 'W1.1',
            title: { sv: 'Steg', en: 'Step' },
            summary: { sv: 'Kort', en: 'Short' },
            body: 'only one language',
            places: [
              {
                id: 'p1',
                label: { sv: 'Här', en: 'Here' },
                focus: { path: 'a.ts', start: 4, end: 4, anchor: 'x' },
                context: [{ path: 'a.ts', start: 1, end: 9 }],
              },
            ],
            evidence: [{ label: 'test-simulated', text: { sv: 'Test', en: 'Test' } }],
            evidenceRefs: [{ path: 'a.test.ts', start: 1, end: 3 }],
          },
        ],
      },
    ],
  });
  assert.ok(definition !== null);
  assert.deepEqual(definition.languages, ['sv', 'en']);
  const step = definition.walks[0]?.steps[0];
  assert.equal(step?.places[0]?.focus.id, 'p1');
  assert.equal(step?.places[0]?.focus.side, 'target', 'side defaults to target');
  assert.equal(step?.places[0]?.context[0]?.id, 'p1.context1');
  // Context is shown on request and is not planned coverage unless declared "walk".
  assert.deepEqual(step?.refs.map((ref) => [ref.id, ref.role]), [
    ['p1', 'walk'],
    ['p1.context1', 'context'],
    ['e1', 'evidence'],
  ]);
  // A missing language is reported and filled from the other, never left blank.
  assert.equal(definition.walks[0]?.question.en, 'Fråga');
  const text = problems.map((problem) => problem.problem).join('\n');
  assert.match(text, /"question" has no "en" text/);
  assert.match(text, /"body" must give both "sv" and "en"/);
});

function rowsFor(base: string[], target: string[], unified: string) {
  const [file] = parseDiff(parseNameStatus('M\0x.ts\0'), `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n${unified}`);
  assert.ok(file !== undefined);
  return buildDiffRows(base, target, file.hunks);
}

test('a precise focus shows the replaced line with its old line, and nothing else of a large change', () => {
  // Line 2 replaced; lines 4–9 a new block replacing old line 4.
  const base = ['a', 'old b', 'c', 'old d', 'e'];
  const target = ['a', 'new b', 'c', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'e'];
  const rows = rowsFor(base, target, '@@ -2 +2 @@\n-old b\n+new b\n@@ -4 +4,6 @@\n');
  const describe = (indexes: readonly number[]) => indexes.map((index) => `${rows[index]?.kind[0] ?? ''}:${rows[index]?.text ?? ''}`);

  const replaced = referenceRows(rows, { side: 'target', start: 2, end: 2 });
  assert.deepEqual(describe(replaced.indexes), ['d:old b', 'a:new b']);
  assert.equal(replaced.changed, true);

  // Deep inside the new block: only those lines, not the old line it replaced.
  assert.deepEqual(describe(referenceRows(rows, { side: 'target', start: 7, end: 8 }).indexes), ['a:n4', 'a:n5']);
  // At the start of the block: the old line comes with it.
  assert.deepEqual(describe(referenceRows(rows, { side: 'target', start: 4, end: 4 }).indexes), ['d:old d', 'a:n1']);
  // Unchanged code: neutral, and no invented before/after.
  const unchanged = referenceRows(rows, { side: 'target', start: 3, end: 3 });
  assert.deepEqual(describe(unchanged.indexes), ['c:c']);
  assert.equal(unchanged.changed, false);
  // The old side: the mirror image.
  assert.deepEqual(describe(referenceRows(rows, { side: 'base', start: 2, end: 2 }).indexes), ['d:old b', 'a:new b']);
});

test('removed lines belong to a focus only when it spans the place they were removed from', () => {
  const base = ['a', 'gone 1', 'gone 2', 'b', 'c'];
  const target = ['a', 'b', 'c'];
  const rows = rowsFor(base, target, '@@ -2,2 +1,0 @@\n');
  const kinds = (start: number, end: number) =>
    referenceRows(rows, { side: 'target', start, end }).indexes.map((index) => rows[index]?.text);
  assert.deepEqual(kinds(1, 2), ['a', 'gone 1', 'gone 2', 'b']);
  assert.deepEqual(kinds(2, 3), ['b', 'c'], 'starting after the removal leaves it out');
  assert.deepEqual(referenceRows(rows, { side: 'base', start: 2, end: 3 }).indexes.map((index) => rows[index]?.text), ['gone 1', 'gone 2']);
});

test('the view arrangement is kept in the record and opened marks of an older definition are counted, not used', () => {
  const state = emptyReviewState(REVISIONS, 'def.json', 'hash');
  assert.deepEqual(state.ui, { openWalks: [], highlightWalk: false });
  const stored = { ...state, ui: { openWalks: ['W2'], highlightWalk: true } };
  assert.deepEqual(adoptStoredState(JSON.parse(JSON.stringify(stored)), REVISIONS)?.ui, { openWalks: ['W2'], highlightWalk: true });
  assert.equal(adoptStoredState({ ...state, ui: { openWalks: 'W2' } }, REVISIONS), null);
  const { ui: _ui, ...withoutUi } = state;
  assert.deepEqual(adoptStoredState(withoutUi, REVISIONS)?.ui, { openWalks: [], highlightWalk: false });

  const { definition } = fixture();
  const marked = { ...state, shownRefs: { 'W1.1#0': 't', 'W1.1@r1': 't' } };
  assert.equal(staleOpenedMarks(definition, marked), 1);
  assert.equal(placeKey('W1.1', 'r1'), 'W1.1@r1');
});

test('marks follow a step\'s content when the walks change: unchanged steps keep them, changed steps give them to history', () => {
  const { definition } = fixture();
  const step = definition.walks[0]?.steps[0];
  assert.ok(step !== undefined);
  const hashes = stepHashesOf(definition);
  assert.equal(hashes[step.id], stepContentHash(step));
  const base = emptyReviewState(REVISIONS, 'def.json', 'old');
  const marks = {
    shownSteps: { [step.id]: 't1', 'W9.9': 't2' },
    shownRefs: { [placeKey(step.id, step.places[0]?.id ?? 'p')]: 't1', 'W9.9@p1': 't2' },
    walkedSteps: { [step.id]: 't3' },
    decisions: base.decisions,
    notes: base.notes,
  };

  // A record from before step hashes existed: the same id carries nothing.
  const strict = carryStepMarks(definition, { ...base, ...marks }, 'new', 'moved');
  assert.deepEqual(strict.state.shownSteps, {});
  assert.deepEqual(strict.state.walkedSteps, {});
  assert.deepEqual(strict.state.shownRefs, {});
  assert.equal(strict.carried, 0);
  assert.equal(strict.moved, 2);
  assert.equal(strict.state.markHistory.length, 1);
  assert.deepEqual(strict.state.markHistory[0]?.shownSteps, marks.shownSteps);
  assert.equal(strict.state.markHistory[0]?.definitionHash, 'old');
  assert.deepEqual(strict.state.previousDefinitionHashes, ['old']);
  assert.equal(strict.state.definitionHash, 'new');
  assert.deepEqual(strict.state.stepHashes, hashes);

  // The same step under the same content keeps its marks; the vanished step does not.
  const same = carryStepMarks(definition, { ...base, ...marks, stepHashes: { ...hashes, 'W9.9': 'x' } }, 'new', 'moved');
  assert.deepEqual(same.state.shownSteps, { [step.id]: 't1' });
  assert.deepEqual(same.state.walkedSteps, { [step.id]: 't3' });
  assert.deepEqual(Object.keys(same.state.shownRefs), [placeKey(step.id, step.places[0]?.id ?? 'p')]);
  assert.equal(same.carried, 1);
  assert.equal(same.moved, 1);

  // A rewritten step moves its marks even though the id is the same.
  const rewritten = carryStepMarks(definition, { ...base, ...marks, stepHashes: { ...hashes, [step.id]: 'before-the-rewrite' } }, 'new', 'moved');
  assert.deepEqual(rewritten.state.shownSteps, {});
  assert.equal(rewritten.moved, 2);

  // Round trip through the stored shape.
  const adopted = adoptStoredState(JSON.parse(JSON.stringify(strict.state)), REVISIONS);
  assert.deepEqual(adopted?.markHistory, strict.state.markHistory);
  assert.equal(adoptStoredState({ ...base, markHistory: [{ definitionHash: 1 }] }, REVISIONS), null);
});

test('preferences accept only the two display languages', () => {
  assert.deepEqual(adoptPreferences({ language: 'en' }), { language: 'en' });
  assert.deepEqual(adoptPreferences({ language: 'de' }), { language: 'sv' });
  assert.deepEqual(adoptPreferences(null), { language: 'sv' });
});

test('opened coverage counts only the focus of opened places; declared context counts as planned', () => {
  const { definition } = parseReviewDefinition({
    format: 'dspatch-review/2',
    title: { sv: 't', en: 't' },
    repository: '.',
    base: REVISIONS.base,
    target: REVISIONS.target,
    walks: [
      {
        id: 'W1',
        title: { sv: 'w', en: 'w' },
        question: { sv: 'q', en: 'q' },
        steps: [
          {
            id: 'W1.1',
            title: { sv: 's', en: 's' },
            summary: { sv: 's', en: 's' },
            body: { sv: 'b', en: 'b' },
            places: [
              {
                id: 'p1',
                label: { sv: 'l', en: 'l' },
                focus: { path: 'src/x.ts', start: 2, end: 3 },
                context: [{ path: 'src/y.ts', start: 1, end: 9, role: 'walk' }],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.ok(definition !== null);
  const { files } = fixture();
  const opened = { ...emptyReviewState(REVISIONS, 'def.json', 'hash'), shownRefs: { 'W1.1@p1': 't' } };
  const coverage = computeCoverage(definition, files, opened);
  assert.equal(coverage.hunks[1]?.planned, 'full', 'declared context is planned');
  assert.equal(coverage.hunks[0]?.shown, 'full', 'the focus was on screen');
  assert.equal(coverage.hunks[1]?.shown, 'none', 'context was not on screen until asked for');
});

test('a place can name its enclosing unit and where the walk arrives from; both are validated, neither is coverage', () => {
  const { definition, problems } = parseReviewDefinition({
    format: 'dspatch-review/2',
    title: { sv: 't', en: 't' },
    overview: { sv: 'Översikt', en: 'Overview' },
    repository: '.',
    base: REVISIONS.base,
    target: REVISIONS.target,
    walks: [
      {
        id: 'W1',
        title: { sv: 'w', en: 'w' },
        purpose: { sv: 'Syfte', en: 'Purpose' },
        question: { sv: 'q', en: 'q' },
        steps: [
          {
            id: 'W1.1',
            title: { sv: 's', en: 's' },
            summary: { sv: 's', en: 's' },
            body: { sv: 'b', en: 'b' },
            places: [
              {
                id: 'p1',
                label: { sv: 'l', en: 'l' },
                focus: { path: 'src/x.ts', start: 2, end: 3 },
                unit: { path: 'src/x.ts', start: 1, end: 5, kind: 'method', name: 'run', anchor: 'run' },
                from: { path: 'src/y.ts', start: 8, end: 8, label: { sv: 'Anropas från y', en: 'Called from y' } },
              },
              {
                id: 'p2',
                label: { sv: 'l', en: 'l' },
                focus: { path: 'src/x.ts', start: 4, end: 4 },
                unit: { path: 'src/x.ts', start: 1, end: 5, kind: 'gadget' },
              },
            ],
          },
        ],
      },
    ],
  });
  assert.ok(definition !== null);
  assert.equal(definition.overview.en, 'Overview');
  assert.equal(definition.walks[0]?.purpose.sv, 'Syfte');
  const place = definition.walks[0]?.steps[0]?.places[0];
  assert.deepEqual([place?.unit?.kind, place?.unit?.name, place?.unit?.ref.id, place?.unit?.ref.role], ['method', 'run', 'p1.unit', 'context']);
  assert.deepEqual([place?.from?.ref.id, place?.from?.ref.path, place?.from?.label.en], ['p1.from', 'src/y.ts', 'Called from y']);
  assert.equal(definition.walks[0]?.steps[0]?.places[1]?.unit, null, 'an unknown kind is reported, not guessed');
  assert.match(problems.map((problem) => problem.problem).join('\n'), /"kind" must be one of/);
  // Unit and from are checked like every reference but are never planned coverage.
  const ids = definition.walks[0]?.steps[0]?.refs.map((ref) => `${ref.id}:${ref.role}`);
  assert.ok(ids?.includes('p1.unit:context') && ids.includes('p1.from:context'));
});

test('the chosen code level is kept with the view arrangement', () => {
  const state = emptyReviewState(REVISIONS, 'def.json', 'hash');
  const stored = { ...state, ui: { openWalks: [], highlightWalk: false, level: 'file' } };
  assert.equal(adoptStoredState(JSON.parse(JSON.stringify(stored)), REVISIONS)?.ui.level, 'file');
  assert.equal(adoptStoredState({ ...state, ui: { openWalks: [], highlightWalk: false, level: 'everything' } }, REVISIONS), null);
});
