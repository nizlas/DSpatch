/**
 * DSP-175: points worth checking as review threads. The same identity, store and status flow
 * as findings; a finding point is a problem, a question a question, an uncertainty a gap; a
 * point that says the same as a finding is that finding's thread; an older point without a
 * recommendation says so; and a record written before adopts unchanged.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkDefinition, readChecksAnswer } from '../src/shared/review-agent';
import { adoptPairRecord, emptyRecord, storedChecksFromDefinition, type AgentJob, type CheckSource, type DelegationResult, type LineRange, type PairRecord, type StoredCheck, type ThreadEvent } from '../src/shared/review-pair';
import { checkThreadId, remainingLine, reviewThreadsOf, threadActionProblem, threadCountsOf, threadOfPoint } from '../src/shared/review-threads';

const pair = { repository: '/r', base: 'a'.repeat(40), target: 'b'.repeat(40) };
const range = (start: number, end: number, path = 'src/a.ts', side: LineRange['side'] = 'target'): LineRange => ({ kind: 'lines', side, path, start, end });
const recommended = { kind: 'investigate' as const, action: 'Look at every caller.', rationale: 'Callers receive something new.', uncertainty: '', nextStep: 'Search for the callers.' };
const definitionPath = '/records/generated/k/job-w.review.json';

function point(checkId: string, kind: StoredCheck['kind'], title: string, places: LineRange[] = [range(5, 6)], extra: Partial<StoredCheck> = {}): StoredCheck {
  return { checkId, kind, title, detail: '', reasoning: `Why ${title}`, places, ...extra };
}

function source(checks: StoredCheck[], at = definitionPath): CheckSource {
  return { definitionPath: at, jobId: 'job-c', reviewer: 'Claude · sonnet', at: '2026-11-05T10:00:00Z', checks };
}

function reviewJob(findings: DelegationResult['findings']): AgentJob {
  const result: DelegationResult = { assessment: 'Read it.', reviewed: [range(1, 20)], approved: [], findings, uncertainties: [], insufficient: false, adjustments: [] };
  return {
    id: 'job-r',
    kind: 'review',
    state: 'done',
    provider: 'claude',
    model: 'sonnet',
    startedAt: '2026-11-05T09:00:00Z',
    endedAt: '2026-11-05T09:05:00Z',
    note: '',
    detail: '',
    scope: { kind: 'file', label: 'src/a.ts', ranges: [range(1, 20)] },
    result,
    definitionPath: null,
    uncovered: [],
  };
}

function record(sources: CheckSource[], jobs: AgentJob[] = [], events: Record<string, ThreadEvent[]> = {}): PairRecord {
  return { ...emptyRecord(pair), jobs, checkSources: sources, threads: Object.entries(events).map(([threadId, list]) => ({ threadId, events: list })) };
}

const event = (kind: ThreadEvent['kind'], text = ''): ThreadEvent => ({ id: `${kind}-${text}`, kind, at: '2026-11-05T11:00:00Z', text });

describe('points worth checking are review threads', () => {
  it('maps finding to problem, question to question and uncertainty to a verification gap', () => {
    const threads = reviewThreadsOf(record([source([point('C1', 'finding', 'A'), point('C2', 'question', 'B', [range(8, 8)]), point('C3', 'uncertainty', 'C', [range(12, 12)])])]));
    assert.deepEqual(
      threads.map((thread) => [thread.title, thread.kind]),
      [
        ['A', 'problem'],
        ['B', 'question'],
        ['C', 'gap'],
      ],
    );
    assert.ok(threads.every((thread) => thread.origin.source === 'worth-checking' && thread.origin.reviewer === 'Claude · sonnet' && thread.status === 'open'));
    assert.equal(remainingLine(threadCountsOf(threads)), '1 open problem · 1 open question · 1 verification gap');
  });

  it('keeps one identity across a stored record and a reload, with the events under it', () => {
    const checks = [point('C1', 'question', 'Does every caller handle null?', [range(5, 6)], { recommendation: recommended, evidence: 'Read a.ts.' })];
    const id = reviewThreadsOf(record([source(checks)]))[0]!.id;
    assert.equal(id, checkThreadId(checks[0]!));
    const stored = JSON.parse(JSON.stringify(record([source(checks)], [], { [id]: [event('comment', 'Looking.')] }))) as unknown;
    const thread = reviewThreadsOf(adoptPairRecord(stored, pair))[0]!;
    assert.equal(thread.id, id);
    assert.deepEqual(thread.events.map((entry) => entry.kind), ['comment']);
    assert.deepEqual(thread.recommendation, recommended);
    assert.equal(thread.evidence, 'Read a.ts.');
    // The same point read again from another preparation is the same thread, shown once.
    const twice = reviewThreadsOf(record([source(checks), source(checks.map((check) => ({ ...check, checkId: 'C4' })), '/other.review.json')]));
    assert.equal(twice.length, 1);
    assert.equal(twice[0]!.points.length, 2);
  });

  it('records acceptance as an agreed action, not as done, unless the recommendation is to keep the code', () => {
    const checks = [point('C1', 'finding', 'Not covered by a test', [range(5, 6)], { recommendation: { ...recommended, kind: 'change', action: 'Add a test.' } }), point('C2', 'question', 'Meant to be public?', [range(9, 9)], { recommendation: { ...recommended, kind: 'keep', action: 'Keep it.' } })];
    const [change, keep] = reviewThreadsOf(record([source(checks)]));
    assert.equal(threadActionProblem(change!, 'accept'), null);
    const after = reviewThreadsOf(record([source(checks)], [], { [change!.id]: [event('accept')], [keep!.id]: [event('accept')] }));
    assert.equal(after.find((thread) => thread.id === change!.id)!.status, 'action-agreed');
    assert.equal(after.find((thread) => thread.id === keep!.id)!.status, 'resolved');
    assert.equal(remainingLine(threadCountsOf(after)), '1 action agreed');
  });

  it('shows an older point without a recommendation honestly: none is made up and none can be accepted', () => {
    const thread = reviewThreadsOf(record([source([point('C1', 'question', 'Older point')])]))[0]!;
    assert.equal(thread.recommendation, null);
    assert.equal(thread.evidence, '');
    assert.equal(threadActionProblem(thread, 'accept'), 'There is no recommendation to accept.');
    assert.equal(threadActionProblem(thread, 'comment'), null);
  });

  it('makes a point with no place a thread over the review', () => {
    const thread = reviewThreadsOf(record([source([point('C1', 'uncertainty', 'Nowhere in particular', [])])]))[0]!;
    assert.equal(thread.level, 'review');
    assert.equal(thread.file, null);
    assert.deepEqual(thread.anchors, []);
  });

  it('finds the thread of a point in a walk by its definition and id', () => {
    const threads = reviewThreadsOf(record([source([point('C1', 'question', 'Q')])]));
    assert.equal(threadOfPoint(threads, definitionPath, 'C1')?.title, 'Q');
    assert.equal(threadOfPoint(threads, definitionPath, 'C2'), null);
    assert.equal(threadOfPoint(threads, '/elsewhere.review.json', 'C1'), null);
  });
});

describe('a point that is already a finding', () => {
  const finding = { severity: 'question' as const, title: 'Is the greeting meant to end with an exclamation mark?', text: 'The punctuation changed.', location: range(3, 3) };

  it('joins the finding by its title and is never a second thread', () => {
    const checks = [point('C1', 'finding', 'is the greeting meant to end with an exclamation mark', [range(7, 7)], { recommendation: recommended, evidence: 'Read line 7.' })];
    const threads = reviewThreadsOf(record([source(checks)], [reviewJob([finding])]));
    assert.equal(threads.length, 1);
    const thread = threads[0]!;
    assert.equal(thread.origin.source, 'review');
    assert.equal(thread.kind, 'question');
    assert.deepEqual(thread.anchors, [range(3, 3), range(7, 7)]);
    // The finding had none: the point's recommendation and evidence fill in, nothing replaces.
    assert.deepEqual(thread.recommendation, recommended);
    assert.equal(thread.evidence, 'Read line 7.');
    assert.equal(threadOfPoint(threads, definitionPath, 'C1')?.id, thread.id);
  });

  it('joins the finding by exactly the same places, and keeps the finding\'s own recommendation', () => {
    const own = { ...recommended, kind: 'ask-author' as const, action: 'Ask the author.' };
    const checks = [point('C1', 'question', 'A differently worded point', [range(3, 3)], { recommendation: recommended })];
    const threads = reviewThreadsOf(record([source(checks)], [reviewJob([{ ...finding, recommendation: own }])]));
    assert.equal(threads.length, 1);
    assert.deepEqual(threads[0]!.recommendation, own);
    assert.equal(threads[0]!.points[0]?.checkId, 'C1');
  });

  it('keeps two points with other titles at the same lines apart', () => {
    const threads = reviewThreadsOf(record([source([point('C1', 'question', 'One', [range(3, 3)]), point('C2', 'finding', 'Another', [range(3, 3)])])]));
    assert.equal(threads.length, 2);
  });

  it('stays a thread of its own when only near the finding', () => {
    const threads = reviewThreadsOf(record([source([point('C1', 'question', 'Something else', [range(3, 4)])])], [reviewJob([finding])]));
    assert.equal(threads.length, 2);
  });
});

describe('records and definitions', () => {
  it('adopts a record written before points were threads unchanged, with no points', () => {
    const before = JSON.parse(JSON.stringify(record([], [reviewJob([{ severity: 'problem', title: 'P', text: 'P.', location: range(2, 2) }])]))) as Record<string, unknown>;
    delete before['checkSources'];
    const adopted = adoptPairRecord(before, pair);
    assert.deepEqual(adopted.checkSources, []);
    assert.deepEqual(
      reviewThreadsOf(adopted).map((thread) => thread.title),
      ['P'],
    );
  });

  it('reads a definition\'s points, in English or as plain text, leaving out unsafe places', () => {
    const read = storedChecksFromDefinition(
      [
        { id: 'C1', kind: 'question', title: { sv: 'Fråga', en: 'Question' }, places: [{ path: 'src/a.ts', side: 'target', start: 2, end: 3, role: 'context' }, { path: '../etc/passwd', side: 'target', start: 1, end: 1 }] },
        { id: 'C2', kind: 'nonsense', title: 'Dropped' },
        { id: 'C3', kind: 'uncertainty', title: 'Plain', recommendation: { kind: 'measure', action: 'Measure it.' }, evidence: { sv: 'Läst.', en: 'Read.' } },
      ],
      (filePath) => !filePath.includes('..'),
    );
    assert.deepEqual(
      read.map((check) => [check.checkId, check.title, check.places.length]),
      [
        ['C1', 'Question', 1],
        ['C3', 'Plain', 0],
      ],
    );
    assert.equal(read[1]!.recommendation?.kind, 'measure');
    assert.equal(read[1]!.evidence, 'Read.');
    assert.equal(read[0]!.recommendation, undefined);
  });

  it('asks for and keeps a recommendation and evidence with each point, as findings have', () => {
    const answer = readChecksAnswer(
      {
        checks: [
          { kind: 'finding', title: 'Not covered', places: [{ label: 'x', path: 'src/a.ts', side: 'target', start: 2, end: 3 }], evidence: 'Searched the tests.', recommendation: { kind: 'test', action: 'Add a test.', rationale: 'Untested.', nextStep: 'Write it.' } },
          { kind: 'question', title: 'Older form', places: [] },
        ],
      },
      new Set(),
    );
    assert.ok(answer.checks !== null);
    const written = answer.checks.map((check, index) => checkDefinition(check, `C${String(index + 1)}`));
    const read = storedChecksFromDefinition(JSON.parse(JSON.stringify(written)) as unknown, () => true);
    assert.equal(read[0]!.recommendation?.action, 'Add a test.');
    assert.equal(read[0]!.evidence, 'Searched the tests.');
    assert.equal(read[1]!.recommendation, undefined);
  });
});
