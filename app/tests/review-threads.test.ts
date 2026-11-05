/**
 * DSP-175: review threads. One identity read from the recorded result, the person's events
 * kept under it, decisions apart from resolution, older results read honestly, and nothing
 * here approves a line or runs anything.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readReviewAnswer, withCheckedFindings } from '../src/shared/review-agent';
import { adoptPairRecord, emptyRecord, jobFrom, reviewTotalsOf, threadActionFrom, type AgentJob, type DelegationResult, type LineRange, type PairFile, type PairRecord, type ThreadEvent } from '../src/shared/review-pair';
import { isRemaining, remainingInFile, remainingLine, reviewThreadsOf, threadActionProblem, threadCountsOf, threadsAt } from '../src/shared/review-threads';

const pair = { repository: '/r', base: 'a'.repeat(40), target: 'b'.repeat(40) };
const range = (start: number, end: number, path = 'src/a.ts', side: LineRange['side'] = 'target'): LineRange => ({ kind: 'lines', side, path, start, end });
const files = [{ key: 'a', status: 'modified', oldPath: 'src/a.ts', newPath: 'src/a.ts', similarity: null, binary: false, hunks: [{ baseStart: 10, baseCount: 2, targetStart: 10, targetCount: 10 }], added: 10, deleted: 2 }] as unknown as readonly PairFile[];
const scope = { kind: 'file' as const, label: 'src/a.ts', ranges: [range(1, 100)] };

function job(result: DelegationResult, id = 'job-1'): AgentJob {
  return { id, kind: 'review', state: 'done', provider: 'claude', model: 'sonnet', startedAt: '2026-11-05T10:00:00Z', endedAt: '2026-11-05T10:02:00Z', note: '', detail: '', scope, result, definitionPath: null, uncovered: [] };
}

const base: DelegationResult = { assessment: 'Read it.', reviewed: [range(10, 19)], approved: [range(10, 12)], findings: [], uncertainties: [], insufficient: false, adjustments: [] };

const recommended = { kind: 'test' as const, action: 'Add a test for an empty list.', rationale: 'The branch is untested.', uncertainty: 'Callers may never pass one.', nextStep: 'Write the test in tests/a.test.ts.' };

function record(result: DelegationResult, events: Record<string, ThreadEvent[]> = {}): PairRecord {
  return { ...emptyRecord(pair), jobs: [job(result)], threads: Object.entries(events).map(([threadId, list]) => ({ threadId, events: list })) };
}

const event = (kind: ThreadEvent['kind'], text = ''): ThreadEvent => ({ id: `${kind}-${text}`, kind, at: '2026-11-05T11:00:00Z', text });

describe('thread identity', () => {
  it('gives a finding one stable id across reloads, with its places gathered', () => {
    const result = { ...base, findings: [{ severity: 'problem' as const, title: 'Empty list', text: 'Crashes.', location: range(13, 13) }, { severity: 'problem' as const, title: 'Empty list', text: 'Crashes.', location: range(30, 31, 'src/b.ts') }] };
    const first = reviewThreadsOf(record(result));
    const stored = JSON.parse(JSON.stringify(record(result))) as unknown;
    const again = reviewThreadsOf(adoptPairRecord(stored, pair));
    assert.equal(first.length, 1);
    assert.equal(first[0]!.id, again[0]!.id);
    assert.deepEqual(first[0]!.anchors, [range(13, 13), range(30, 31, 'src/b.ts')]);
    assert.equal(first[0]!.level, 'lines');
    assert.equal(first[0]!.origin.reviewer, 'Claude · sonnet');
  });

  it('keeps comments, decisions and history through a stored record', () => {
    const result = { ...base, findings: [{ severity: 'question' as const, title: 'Why here?', text: 'Q.', location: range(14, 14), recommendation: recommended }] };
    const id = reviewThreadsOf(record(result))[0]!.id;
    const stored = JSON.parse(JSON.stringify(record(result, { [id]: [event('comment', 'Looking.'), event('accept')] }))) as unknown;
    const thread = reviewThreadsOf(adoptPairRecord(stored, pair))[0]!;
    assert.deepEqual(thread.events.map((entry) => entry.kind), ['comment', 'accept']);
    assert.equal(thread.status, 'action-agreed');
  });
});

describe('decision is not resolution', () => {
  const result = { ...base, findings: [{ severity: 'problem' as const, title: 'Empty list', text: 'Crashes.', location: range(13, 13), recommendation: recommended }] };
  const id = reviewThreadsOf(record(result))[0]!.id;
  const at = (events: ThreadEvent[]) => reviewThreadsOf(record(result, { [id]: events }))[0]!;

  it('accepting a recommendation that needs work reads Action agreed and still remains', () => {
    const thread = at([event('accept')]);
    assert.equal(thread.status, 'action-agreed');
    assert.equal(isRemaining(thread), true);
    assert.equal(remainingLine(threadCountsOf([thread])), '1 action agreed');
  });

  it('accepting changes no approval, no review totals and no agent result', () => {
    const before = record(result);
    const after = record(result, { [id]: [event('accept'), event('resolve')] });
    assert.deepEqual(reviewTotalsOf(files, after), reviewTotalsOf(files, before));
    assert.deepEqual(after.jobs, before.jobs);
    assert.deepEqual(after.marks, []);
    assert.deepEqual(after.agentReviews, []);
  });

  it('an explicit no-change recommendation closes on accept with its reason kept', () => {
    const keep = { ...result, findings: [{ ...result.findings[0]!, recommendation: { ...recommended, kind: 'keep' as const, action: 'Keep it.', rationale: 'The guard is upstream.' } }] };
    const thread = reviewThreadsOf(record(keep, { [id]: [event('accept')] }))[0]!;
    assert.equal(thread.status, 'resolved');
    assert.equal(thread.recommendation?.rationale, 'The guard is upstream.');
  });

  it('keep open, resolve, dismiss and reopen move the status, in order', () => {
    assert.equal(at([event('keep-open', 'Not yet.')]).status, 'open');
    assert.equal(at([event('resolve')]).status, 'resolved');
    assert.equal(at([event('dismiss', 'Not a problem here.')]).status, 'dismissed');
    assert.equal(at([event('dismiss', 'No.'), event('reopen')]).status, 'open');
    assert.equal(at([event('accept'), event('keep-open')]).status, 'open');
  });

  it('refuses a dismissal without a comment, an empty comment, and an accept with no recommendation', () => {
    assert.deepEqual(threadActionFrom({ threadId: id, kind: 'dismiss', text: '  ' }), { error: 'Dismissing a thread needs a comment saying why.' });
    assert.ok('error' in threadActionFrom({ threadId: id, kind: 'comment', text: '' }));
    assert.ok('error' in threadActionFrom({ threadId: id, kind: 'run', text: 'x' }));
    const legacy = reviewThreadsOf(record({ ...base, findings: [{ severity: 'problem', text: 'Old.', location: null }] }))[0]!;
    assert.equal(threadActionProblem(legacy, 'accept'), 'There is no recommendation to accept.');
    assert.equal(threadActionProblem(at([event('resolve')]), 'reopen'), null);
    assert.equal(threadActionProblem(at([]), 'reopen'), 'The thread is already open.');
  });
});

describe('older results', () => {
  it('read without a recommendation, invent none, and keep every word', () => {
    const old = { ...base, findings: [{ severity: 'problem' as const, text: 'The loop never ends. It spins when the list is empty.', location: range(13, 13) }], uncertainties: ['Whether callers pass an empty list.'] };
    const threads = reviewThreadsOf(record(old));
    const finding = threads.find((thread) => thread.kind === 'problem')!;
    assert.equal(finding.recommendation, null);
    assert.equal(finding.title, 'The loop never ends');
    assert.match(finding.explanation, /spins/);
    const gap = threads.find((thread) => thread.kind === 'gap')!;
    assert.equal(gap.title, 'Whether callers pass an empty list');
    assert.equal(gap.recommendation, null);
    assert.equal(gap.level, 'file', 'a gap of a file review is shown at its file');
  });

  it('a stored job of the older form adopts unchanged', () => {
    const raw = JSON.parse(JSON.stringify(job({ ...base, findings: [{ severity: 'note', text: 'Fine.', location: null }], uncertainties: ['One.'] }))) as unknown;
    const adopted = jobFrom(raw);
    assert.equal(adopted?.result?.gaps, undefined);
    assert.equal(adopted?.result?.findings[0]?.recommendation, undefined);
  });
});

describe('verification gaps', () => {
  it('a gap tied to a finding is shown in its thread, once, and others are threads of their own', () => {
    const answer = readReviewAnswer(
      {
        assessment: 'Read.',
        reviewed: [{ path: 'src/a.ts', side: 'target', start: 10, end: 19 }],
        approved: [],
        findings: [{ severity: 'question', title: 'Retry count', text: 'Why three?', path: 'src/a.ts', side: 'target', start: 15, end: 15, evidence: 'src/a.ts:15', recommendation: { kind: 'ask-author', action: 'Ask why three.', rationale: 'No comment says.' } }],
        gaps: [
          { text: 'Whether three is measured.', finding: 'Retry count', recommendation: { kind: 'measure', action: 'Measure retries.', nextStep: 'Count retries in the log.' } },
          { text: 'Whether three is measured.', finding: 'Retry count' },
          { text: 'How the cache is warmed.' },
        ],
      },
      scope,
      files,
    );
    assert.ok(!('error' in answer));
    const threads = reviewThreadsOf(record(answer));
    const question = threads.find((thread) => thread.kind === 'question')!;
    assert.equal(question.gaps.length, 1);
    assert.equal(question.recommendation?.kind, 'ask-author');
    assert.equal(question.evidence, 'src/a.ts:15');
    assert.deepEqual(threads.filter((thread) => thread.kind === 'gap').map((thread) => thread.title), ['How the cache is warmed']);
    assert.equal(remainingLine(threadCountsOf(threads)), '1 open question · 2 verification gaps');
  });
});

describe('anchors', () => {
  it('a removed (From) line anchors at its side, and threadsAt finds it there only', async () => {
    const result = { ...base, findings: [{ severity: 'problem' as const, title: 'Removed guard', text: 'The guard went.', location: range(11, 11, 'src/a.ts', 'base') }] };
    const threads = reviewThreadsOf(record(result));
    assert.equal(threadsAt(threads, 'base', 'src/a.ts', 11).length, 1);
    assert.equal(threadsAt(threads, 'target', 'src/a.ts', 11).length, 0);
  });

  it('a place that cannot be found is kept as missing and marks no code; the thread moves to its file', async () => {
    const result = { ...base, findings: [{ severity: 'problem' as const, title: 'Gone', text: 'x', location: range(500, 501) }] };
    const checked = await withCheckedFindings(result, async () => ['one', 'two']);
    const thread = reviewThreadsOf(record(checked))[0]!;
    assert.deepEqual(thread.anchors, []);
    assert.equal(thread.missing[0]?.range.start, 500);
    assert.match(thread.missing[0]!.reason, /2 lines|has 2/);
    assert.equal(thread.level, 'file');
    assert.deepEqual(thread.file, { side: 'target', path: 'src/a.ts' });
    assert.equal(remainingInFile([thread], { oldPath: 'src/a.ts', newPath: 'src/a.ts' }).length, 1);
  });

  it('a finding with no place in a review of several files is shown over the review', () => {
    const wide = { ...job({ ...base, findings: [{ severity: 'question', text: 'Overall?', location: null }] }), scope: { kind: 'walk' as const, label: 'W1', ranges: [range(1, 2), range(1, 2, 'src/b.ts')] } };
    const thread = reviewThreadsOf({ jobs: [wide], threads: [] })[0]!;
    assert.equal(thread.level, 'review');
    assert.equal(thread.file, null);
  });
});
