/**
 * Reviewing a chosen revision pair (DSP-150): repositories, the log, the diff between two
 * commits, and the decisions about changed lines.
 *
 * The host half runs against a real Git workspace (`support/pair-fixture.ts`) whose
 * working tree disagrees with both commits, so reading the checkout instead of the
 * commits would fail here. The counting half is pure.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ReviewPairs, pairKeyOf } from '../src/host/review-pairs';
import {
  adoptPairRecord,
  changedLinesOf,
  delegationDecisionOf,
  emptyRecord,
  fileProgressOf,
  fileReviewFactsOf,
  changeMarksOf,
  intralineBlock,
  isPairError,
  lineStatusesOf,
  lineKey,
  rangesOf,
  splitRowsOf,
  expandGap,
  gapHiding,
  CONTEXT_LINES,
  MORE_LINES,
  NO_EXPANSION,
  type GapRow,
  type UnifiedRow,
  stripStatusOf,
  unifiedRowsOf,
  type AgentReview,
  type LineStatus,
  type OpenPair,
  type PairFile,
  type PairMark,
  type PairRecord,
} from '../src/shared/review-pair';
import { hunkDecisionsFromPair, hunkRanges } from '../src/shared/review-pair-walk';
import { reviewThreadsOf } from '../src/shared/review-threads';
import { makeHistoryFixture, type HistoryFixture } from './support/history-fixture';
import { PAIR_WORKING_TREE_ONLY, makePairFixture, type PairFixture } from './support/pair-fixture';

let fixture: PairFixture;
let records: string;
const changes: { key: string; record: PairRecord }[] = [];
let pairs: ReviewPairs;

before(() => {
  fixture = makePairFixture();
  records = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-pair-records-'));
  pairs = new ReviewPairs({ recordsDir: records, changed: (key, record) => changes.push({ key, record }) });
});

after(() => {
  fs.rmSync(fixture.workspace, { recursive: true, force: true });
  fs.rmSync(records, { recursive: true, force: true });
});

/** The one review of app these tests build on: started once, then opened again by its id (DSP-186). */
let appReview: string | null = null;

async function openApp(): Promise<OpenPair> {
  await pairs.repositories([fixture.workspace]);
  const opened = await pairs.openPair(appReview === null ? { repository: fixture.app, base: fixture.appBase, target: fixture.appTarget } : { review: appReview });
  if (isPairError(opened)) {
    throw new Error(opened.error);
  }
  appReview = opened.key;
  return opened;
}

function fileAt(open: OpenPair, shown: string): PairFile {
  const file = open.files.find((candidate) => (candidate.newPath ?? candidate.oldPath) === shown);
  assert.ok(file !== undefined, shown);
  return file;
}

describe('repositories of the workspace', () => {
  it('names each Git repository once by its folder, and leaves folders without Git out', async () => {
    const found = await pairs.repositories([fixture.workspace, fixture.app, path.join(fixture.app, 'src')]);
    assert.deepEqual(
      found.map((entry) => entry.name),
      ['app', 'lib'],
    );
  });

  it('refuses a log for a folder it did not offer', async () => {
    const answer = await pairs.log(fixture.notes, 0);
    assert.ok(isPairError(answer));
  });

  it('reads the log with message, hash, author and date, newest first', async () => {
    await pairs.repositories([fixture.workspace]);
    const answer = await pairs.log(fixture.app, 0);
    assert.ok(!isPairError(answer));
    assert.deepEqual(
      answer.commits.map((commit) => [commit.hash, commit.subject, commit.author]),
      [
        [fixture.appTarget, 'Rework the app', 'Test Author'],
        [fixture.appBase, 'Start the app', 'Test Author'],
      ],
    );
    assert.ok(!Number.isNaN(Date.parse(answer.commits[0]?.date ?? '')));
    assert.equal(answer.more, false);
    // What a traditional `git log` shows: the address, git's own date and the whole message.
    const newest = answer.commits[0];
    assert.equal(newest?.email, 'test@example.invalid');
    assert.match(newest?.dateText ?? '', /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4} [+-]\d{4}$/);
    assert.equal(
      newest?.message,
      'Rework the app\n\nEdit keep.ts, rename two files and drop the old docs.\nThe logo changes and run.sh becomes executable.',
    );
  });
});

describe('the diff between exactly two commits', () => {
  it('lists every kind of change, with renames, binaries and a mode change', async () => {
    const open = await openApp();
    const summary = open.files.map((file) => [file.status, file.oldPath, file.newPath, file.binary, file.added, file.deleted]);
    assert.deepEqual(
      summary.sort((a, b) => String(a[2] ?? a[1]).localeCompare(String(b[2] ?? b[1]))),
      [
        ['modified', 'assets/logo.bin', 'assets/logo.bin', true, 0, 0],
        ['deleted', 'docs/gone.md', null, false, 0, 3],
        ['added', null, 'src/added.ts', false, 2, 0],
        ['renamed', 'src/before.ts', 'src/after.ts', false, 2, 2],
        ['modified', 'src/keep.ts', 'src/keep.ts', false, 3, 2],
        ['renamed', 'src/old-name.ts', 'src/new-name.ts', false, 0, 0],
        ['modified', 'tools/run.sh', 'tools/run.sh', false, 0, 0],
      ],
    );
  });

  it('reads text at the commits, never the working copy', async () => {
    const open = await openApp();
    const target = await pairs.readFile(open.key, 'target', 'src/keep.ts');
    assert.ok(!isPairError(target));
    assert.ok(target.text?.includes('export const v3 = 30;'));
    assert.ok(!target.text?.includes(PAIR_WORKING_TREE_ONLY));
    const binary = await pairs.readFile(open.key, 'base', 'assets/logo.bin');
    assert.ok(!isPairError(binary) && binary.binary);
  });

  it('refuses a path that is not part of the change', async () => {
    const open = await openApp();
    assert.ok(isPairError(await pairs.readFile(open.key, 'target', 'package.json')));
    assert.ok(isPairError(await pairs.readFile(open.key, 'target', '../../outside')));
  });

  it('refuses one commit twice and anything but full hashes', async () => {
    await pairs.repositories([fixture.workspace]);
    assert.ok(isPairError(await pairs.openPair({ repository: fixture.app, base: fixture.appBase, target: fixture.appBase })));
    assert.ok(isPairError(await pairs.openPair({ repository: fixture.app, base: 'HEAD~1', target: 'HEAD' })));
  });
});

describe('decisions about changed lines', () => {
  it('counts deletions and additions but no context, and a percentage of handled lines', async () => {
    const open = await openApp();
    const keep = fileAt(open, 'src/keep.ts');
    assert.equal(changedLinesOf(keep).length, 5);
    const marked = pairs.mark(open.key, {
      op: 'manual',
      scopes: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: 8, end: 9 }],
      reason: '',
    });
    assert.ok(!isPairError(marked));
    const progress = fileProgressOf(keep, marked);
    assert.deepEqual([progress.total, progress.handled, progress.percent, progress.done], [5, 2, 40, false]);
    assert.equal(changes.at(-1)?.key, open.key, 'every window over the pair is told');
  });

  it('is done when every changed line is handled, and keeps reviewed apart from exempted', async () => {
    const open = await openApp();
    const keep = fileAt(open, 'src/keep.ts');
    const deletions = changedLinesOf(keep).filter((line) => line.side === 'base');
    pairs.mark(open.key, { op: 'exempt', scopes: rangesOf(deletions), reason: 'old values' });
    const record = pairs.mark(open.key, {
      op: 'manual',
      scopes: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: 3, end: 3 }],
      reason: '',
    });
    assert.ok(!isPairError(record));
    const progress = fileProgressOf(keep, record);
    assert.deepEqual([progress.done, progress.percent, progress.manual, progress.exempted], [true, 100, 3, 2]);
  });

  it('withdraws a mark with clear, and the latest decision holds', async () => {
    const open = await openApp();
    const keep = fileAt(open, 'src/keep.ts');
    const record = pairs.mark(open.key, {
      op: 'clear',
      scopes: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: 9, end: 9 }],
      reason: '',
    });
    assert.ok(!isPairError(record));
    const status = lineStatusesOf(keep, record).get(lineKey({ side: 'target', path: 'src/keep.ts', line: 9 }));
    assert.equal(status?.decision, null);
    assert.equal(fileProgressOf(keep, record).done, false);
    assert.ok(record.marks.length >= 4, 'the history keeps every decision');
  });

  it('never finishes a file with nothing to count by itself, only by a decision about the file', async () => {
    const open = await openApp();
    const logo = fileAt(open, 'assets/logo.bin');
    const before = fileProgressOf(logo, pairs.state(open.key) as PairRecord);
    assert.deepEqual([before.total, before.done], [0, false]);
    const record = pairs.mark(open.key, { op: 'manual', scopes: [{ kind: 'file', fileKey: logo.key }], reason: '' });
    assert.ok(!isPairError(record));
    assert.equal(fileProgressOf(logo, record).done, true);
  });

  it('survives a restart of the host, and belongs to this pair only', async () => {
    const open = await openApp();
    const again = new ReviewPairs({ recordsDir: records, changed: () => undefined });
    await again.repositories([fixture.workspace]);
    const reopened = await again.openPair({ review: open.key });
    assert.ok(!isPairError(reopened));
    assert.equal(reopened.record.marks.length, (pairs.state(open.key) as PairRecord).marks.length);
    const swapped = await again.openPair({ repository: fixture.app, base: fixture.appTarget, target: fixture.appBase });
    assert.ok(!isPairError(swapped));
    assert.equal(swapped.record.marks.length, 0, 'other revisions start with nothing marked');
    assert.notEqual(swapped.key, open.key);
  });

  it('keeps the position and offers the last pair again', async () => {
    const open = await openApp();
    assert.ok(!isPairError(pairs.savePosition(open.key, { view: 'file', fileKey: 'x', layout: 'unified', line: null })));
    const again = new ReviewPairs({ recordsDir: records, changed: () => undefined });
    await again.repositories([fixture.workspace]);
    assert.deepEqual(again.lastPair(fixture.app), { base: fixture.appBase, target: fixture.appTarget });
    const reopened = await again.openPair({ review: open.key });
    assert.ok(!isPairError(reopened));
    assert.equal(reopened.record.position.layout, 'unified');
  });

  it('offers only the walks over exactly this pair', async () => {
    const open = await openApp();
    const walks = pairs.walksFor(open.key, [fixture.walkDefinition, path.join(fixture.workspace, 'missing.review.json')]);
    assert.ok(!isPairError(walks));
    assert.deepEqual(walks.map((walk) => walk.title), ['The app rework']);
    await pairs.repositories([fixture.workspace]);
    const lib = await pairs.openPair({ repository: fixture.lib, base: fixture.libBase, target: fixture.libTarget });
    assert.ok(!isPairError(lib));
    assert.deepEqual(pairs.walksFor(lib.key, [fixture.walkDefinition]), []);
  });
});

describe('which chosen commit is From (decision after the trial, 29 October 2026)', () => {
  let history: HistoryFixture;
  let shallow: string;

  before(async () => {
    history = makeHistoryFixture();
    // A clone two commits deep: the merge and its two parents, without their common root.
    shallow = path.join(history.workspace, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '2', '--no-single-branch', `file://${history.history.replace(/\\/g, '/')}`, shallow]);
    await pairs.repositories([history.workspace]);
  });

  after(() => {
    fs.rmSync(history.workspace, { recursive: true, force: true });
  });

  it('makes the ancestor From in either click order, whatever the dates say', async () => {
    const ordered = { kind: 'ordered', base: history.root, target: history.ahead };
    // `ahead` is dated nineteen years before its parent: the date would give it backwards.
    assert.deepEqual(await pairs.direction(history.history, history.ahead, history.root), ordered);
    assert.deepEqual(await pairs.direction(history.history, history.root, history.ahead), ordered);
    assert.deepEqual(await pairs.direction(history.history, history.merge, history.side), { kind: 'ordered', base: history.side, target: history.merge });
  });

  it('leaves two commits on separate branches to the person, without a merge base', async () => {
    assert.deepEqual(await pairs.direction(history.history, history.ahead, history.side), { kind: 'unrelated' });
    assert.deepEqual(await pairs.direction(history.history, history.side, history.ahead), { kind: 'unrelated' });
  });

  it('says it cannot tell when the history is shallow or a commit is missing', async () => {
    const parents = execFileSync('git', ['-C', shallow, 'rev-list', '--parents', '-n', '1', 'HEAD'], { encoding: 'utf8' }).trim().split(' ');
    assert.deepEqual(parents.slice(1).sort(), [history.ahead, history.side].sort());
    const partial = await pairs.direction(shallow, history.ahead, history.side);
    assert.equal(isPairError(partial) ? 'error' : partial.kind, 'unknown');
    const missing = await pairs.direction(history.history, 'f'.repeat(40), history.merge);
    assert.equal(isPairError(missing) ? 'error' : missing.kind, 'unknown');
  });

  it('refuses one commit as both ends, and a folder it did not offer', async () => {
    assert.ok(isPairError(await pairs.direction(history.history, history.root, history.root)));
    assert.ok(isPairError(await pairs.direction(path.join(history.workspace, 'nowhere'), history.root, history.ahead)));
  });

  it('opens exactly the pair asked for, a reversed one as a review of its own', async () => {
    const forward = await pairs.openPair({ repository: history.history, base: history.root, target: history.ahead });
    const reversed = await pairs.openPair({ repository: history.history, base: history.ahead, target: history.root });
    assert.ok(!isPairError(forward) && !isPairError(reversed));
    assert.equal(forward.pair.base, history.root);
    assert.equal(reversed.pair.base, history.ahead);
    assert.notEqual(forward.key, reversed.key);
  });
});

describe('ongoing reviews (trial feedback of 29 October 2026)', () => {
  it('lists every review not ended, with its progress, and reading the list writes nothing', async () => {
    const open = await openApp();
    pairs.mark(open.key, { op: 'manual', scopes: [fileAt(open, 'src/keep.ts').key ? { kind: 'lines', side: 'target', path: 'src/keep.ts', start: 1, end: 1 } : { kind: 'lines', side: 'target', path: 'x', start: 1, end: 1 }], reason: '' });
    const before = fs.readdirSync(records).map((name) => `${name}:${String(fs.statSync(path.join(records, name)).mtimeMs)}`).sort();
    const fresh = new ReviewPairs({ recordsDir: records, changed: () => undefined });
    const ongoing = await fresh.ongoing();
    const app = ongoing.find((entry) => entry.key === open.key);
    assert.ok(app !== undefined, 'the review of app is listed by a host that has not opened it');
    assert.equal(app.repositoryName, 'app');
    assert.equal(app.files, open.files.length);
    assert.ok(app.total > 0 && app.handled >= 1);
    assert.equal(app.base.hash, fixture.appBase);
    const after = fs.readdirSync(records).map((name) => `${name}:${String(fs.statSync(path.join(records, name)).mtimeMs)}`).sort();
    assert.deepEqual(after, before, 'listing changed no record and no last pair');
  });

  // DSP-186 replaced "opening the same two commits resumes it": a closed review is listed as
  // closed and reopened by its id; choosing the commits again starts a new review.
  it('closes a review without approving or deleting anything, and reopening it by its id resumes it', async () => {
    const open = await openApp();
    const marksBefore = (pairs.state(open.key) as PairRecord).marks.length;
    assert.ok(!isPairError(pairs.end(open.key)));
    assert.equal((await pairs.ongoing()).find((entry) => entry.key === open.key)?.closed, true);
    const ended = pairs.state(open.key) as PairRecord;
    assert.equal(ended.marks.length, marksBefore);
    assert.notEqual(ended.endedAt, null);
    assert.ok(isPairError(pairs.end(`r-${'0'.repeat(24)}`)), 'an unknown review is refused');
    const reopened = await openApp();
    assert.equal(reopened.record.endedAt, null);
    assert.equal((await pairs.ongoing()).find((entry) => entry.key === open.key)?.closed, false);
  });

  it('opens the walk last opened from the review, else the first offered', async () => {
    const open = await openApp();
    const walks = [
      { definitionPath: path.join(records, 'newest.review.json'), title: 'Newest', note: '' },
      { definitionPath: fixture.walkDefinition, title: 'The app rework', note: '' },
    ];
    assert.equal(pairs.walkToOpen(open.key, walks), walks[0]?.definitionPath);
    pairs.walkOpened(open.key, fixture.walkDefinition);
    assert.equal(pairs.walkToOpen(open.key, walks), fixture.walkDefinition);
    assert.equal(pairs.walkToOpen(open.key, walks.slice(0, 1)), walks[0]?.definitionPath, 'a walk no longer offered is not opened');
    assert.equal(pairs.walkToOpen(open.key, []), null);
  });
});

describe('requirements and agent review', () => {
  const file: PairFile = {
    key: 'a',
    status: 'modified',
    oldPath: 'a.ts',
    newPath: 'a.ts',
    similarity: null,
    binary: false,
    hunks: [{ baseStart: 2, baseCount: 1, targetStart: 2, targetCount: 2 }],
    added: 2,
    deleted: 1,
  };
  const pair = { repository: 'r', base: 'a'.repeat(40), target: 'b'.repeat(40) };
  const agent: AgentReview = {
    id: 'g',
    scope: { kind: 'lines', side: 'target', path: 'a.ts', start: 2, end: 3 },
    reviewer: 'Reviewer agent',
    recordedAt: '2026-10-28T10:00:00.000Z',
    summary: 'fine',
  };

  const accept = (jobId: string, op: 'accept-agent' | 'reject-agent' | 'clear' = 'accept-agent'): PairMark => ({ id: `d-${jobId}-${op}`, op, scope: { kind: 'job', jobId }, reason: '', at: '2026-11-10T12:00:00.000Z' });

  it("counts the person's review, or a delegated assessment the person accepted; an assessment alone counts nothing (DSP-193)", () => {
    // Niclas's decision of 10 November 2026, changing the one rule of 30 October for the agent's
    // part: the agent's assessment is material, and only an accepted one counts its lines.
    const withAgent: PairRecord = { ...emptyRecord(pair), agentReviews: [agent] };
    assert.equal(fileProgressOf(file, withAgent).handled, 0, 'an agent review without a mandate does not count');
    const delegated: PairRecord = { ...withAgent, agentReviews: [{ ...agent, jobId: 'job-1' }] };
    const undecided = fileProgressOf(file, delegated);
    assert.deepEqual([undecided.handled, undecided.agent, undecided.assessed], [0, 0, 2], 'a finished delegated review handles nothing by itself: its lines are assessed, awaiting the person');
    const accepted: PairRecord = { ...delegated, marks: [accept('job-1')] };
    assert.equal(fileProgressOf(file, accepted).handled, 2);
    assert.equal(fileProgressOf(file, accepted).assessed, 0);
    assert.equal(fileProgressOf(file, accepted).done, false, 'the removed line was not in the delegated scope');
    const rejected = fileProgressOf(file, { ...delegated, marks: [accept('job-1', 'reject-agent')] });
    assert.deepEqual([rejected.handled, rejected.assessed], [0, 0], 'a rejected assessment counts nothing and is not awaiting either');
    const withdrawn = fileProgressOf(file, { ...delegated, marks: [accept('job-1'), accept('job-1', 'clear')] });
    assert.deepEqual([withdrawn.handled, withdrawn.assessed], [0, 2], 'a withdrawn decision leaves the assessment awaiting again');
    assert.equal(delegationDecisionOf(accepted, 'job-1')?.op, 'accept-agent');
    assert.equal(delegationDecisionOf({ ...delegated, marks: [accept('job-1'), accept('job-1', 'clear')] }, 'job-1'), null);
    // A DSP-150 record that stored the older requirement keeps the value, its reviews and its
    // history, and is counted by the same rule as any other: the hidden value changes nothing.
    const older = adoptPairRecord({ ...withAgent, requirement: 'manual-or-agent' }, pair);
    assert.equal(older.requirement, 'manual-or-agent');
    assert.equal(older.agentReviews.length, 1);
    assert.equal(fileProgressOf(file, older).handled, 0);
    // An older delegated approval, never decided on, is the agent's assessment awaiting the person: never a decision of theirs.
    const olderDelegated = adoptPairRecord({ ...older, agentReviews: [{ ...agent, jobId: 'job-1' }] }, pair);
    assert.deepEqual([fileProgressOf(file, olderDelegated).handled, fileProgressOf(file, olderDelegated).assessed], [0, 2]);
    assert.equal(fileProgressOf(file, { ...olderDelegated, marks: [accept('job-1')] }).handled, 2);
    // A decision mark survives a save and a read, and one over lines never takes a job's op.
    const readBack = adoptPairRecord(JSON.parse(JSON.stringify({ ...accepted, marks: [...accepted.marks, { id: 'bad', op: 'accept-agent', scope: { kind: 'lines', side: 'target', path: 'a.ts', start: 2, end: 2 }, reason: '', at: '' }] })), pair);
    assert.deepEqual(readBack.marks.map((mark) => `${mark.op}:${mark.scope.kind}`), ['accept-agent:job']);
    // Mixed: the person reviewed the removed line, the agent assessed the added ones and the person accepted.
    const mixed: PairRecord = {
      ...accepted,
      marks: [...accepted.marks, { id: 'm', op: 'manual', scope: { kind: 'lines', side: 'base', path: 'a.ts', start: 2, end: 2 }, reason: '', at: '' }],
    };
    const progress = fileProgressOf(file, mixed);
    assert.deepEqual([progress.handled, progress.manual, progress.agent, progress.done], [3, 1, 2, true]);
    // Exempted is handled, and stays apart from reviewed.
    const exempted = fileProgressOf(file, { ...emptyRecord(pair), marks: [{ id: 'x', op: 'exempt', scope: { kind: 'lines', side: 'base', path: 'a.ts', start: 2, end: 2 }, reason: 'generated', at: '' }] });
    assert.deepEqual([exempted.handled, exempted.exempted, exempted.manual], [1, 1, 0]);
  });

  it('draws manual over agent in the strip, an accepted assessment as agent, an undecided one as assessed, and keeps all in the details', () => {
    const base: PairRecord = {
      ...emptyRecord(pair),
      agentReviews: [{ ...agent, jobId: 'job-1' }],
      marks: [{ id: 'm', op: 'manual', scope: { kind: 'lines', side: 'target', path: 'a.ts', start: 2, end: 2 }, reason: '', at: '' }],
    };
    const undecided = lineStatusesOf(file, base);
    const two = undecided.get(lineKey({ side: 'target', path: 'a.ts', line: 2 }));
    const three = undecided.get(lineKey({ side: 'target', path: 'a.ts', line: 3 }));
    assert.ok(two !== undefined && three !== undefined);
    assert.equal(stripStatusOf(two), 'manual');
    assert.equal(two.agent.length, 1);
    assert.equal(stripStatusOf(three), 'assessed');
    assert.deepEqual([three.accepted.length, three.awaiting.length], [0, 1]);
    const accepted = lineStatusesOf(file, { ...base, marks: [...base.marks, accept('job-1')] });
    assert.equal(stripStatusOf(accepted.get(lineKey({ side: 'target', path: 'a.ts', line: 3 })) as LineStatus), 'agent');
    const rejected = lineStatusesOf(file, { ...base, marks: [...base.marks, accept('job-1', 'reject-agent')] });
    assert.equal(stripStatusOf(rejected.get(lineKey({ side: 'target', path: 'a.ts', line: 3 })) as LineStatus), 'none');
  });

  it('says who handled a file and keeps open agent findings beside a finished file', () => {
    const job = {
      id: 'job-1',
      kind: 'review' as const,
      state: 'done' as const,
      provider: 'claude' as const,
      model: 'opus',
      startedAt: '',
      endedAt: '',
      note: '',
      detail: '',
      scope: null,
      definitionPath: null,
      uncovered: [],
      result: {
        assessment: '',
        reviewed: [],
        approved: [],
        findings: [
          { severity: 'problem' as const, text: 'p', location: { kind: 'lines' as const, side: 'target' as const, path: 'a.ts', start: 3, end: 3 } },
          { severity: 'note' as const, text: 'n', location: { kind: 'lines' as const, side: 'target' as const, path: 'a.ts', start: 2, end: 2 } },
          { severity: 'question' as const, text: 'q', location: { kind: 'lines' as const, side: 'target' as const, path: 'b.ts', start: 1, end: 1 } },
        ],
        uncertainties: [],
        insufficient: false,
        adjustments: [],
      },
    };
    const record: PairRecord = {
      ...emptyRecord(pair),
      agentReviews: [{ ...agent, reviewer: 'Claude · opus', jobId: 'job-1' }],
      marks: [
        { id: 'm', op: 'manual', scope: { kind: 'lines', side: 'target', path: 'a.ts', start: 2, end: 2 }, reason: '', at: '' },
        { id: 'e', op: 'exempt', scope: { kind: 'lines', side: 'base', path: 'a.ts', start: 2, end: 2 }, reason: '', at: '' },
      ],
      jobs: [job],
    };
    // DSP-193: until the person accepts, the agent's line is assessed and the file is not done.
    const undecided = fileProgressOf(file, record);
    assert.deepEqual([undecided.done, undecided.agent, undecided.assessed], [false, 0, 1]);
    assert.deepEqual(fileReviewFactsOf(file, record).agents, [], 'an assessment not accepted names no reviewer of the file');
    const accepted: PairRecord = { ...record, marks: [...record.marks, { id: 'd', op: 'accept-agent', scope: { kind: 'job', jobId: 'job-1' }, reason: '', at: '' }] };
    const progress = fileProgressOf(file, accepted);
    assert.equal(progress.done, true);
    assert.deepEqual([progress.manual, progress.agent, progress.exempted], [1, 1, 1]);
    const facts = fileReviewFactsOf(file, accepted);
    assert.deepEqual(facts.agents, ['Claude · opus']);
    assert.equal(facts.findings, 1, 'a problem at this file counts; a note and another file do not');
  });

  it('adopts a stored record only for its own pair, and drops malformed entries', () => {
    const stored = { ...emptyRecord(pair), marks: [{ id: 'x', op: 'manual', scope: { kind: 'lines', side: 'target', path: 'a.ts', start: 0, end: 1 } }] };
    assert.equal(adoptPairRecord(stored, pair).marks.length, 0);
    assert.equal(adoptPairRecord({ ...stored, pair: { ...pair, base: 'c'.repeat(40) } }, pair).marks.length, 0);
  });

  it('keeps an earlier failed job with its own agent, the raw text split off into the detail, and attributes none', () => {
    // As a job written before the fix of 29 October 2026 was stored (copied from a real record).
    const legacy = {
      id: 'job-56bdb702-83d8-4895-b226-f56675d58ad2',
      kind: 'walks',
      state: 'failed',
      provider: 'cursor',
      model: 'claude-haiku-4-5',
      startedAt: '2026-10-29T00:02:34.205Z',
      endedAt: '2026-10-29T00:02:35.884Z',
      note: 'The agent could not be asked: Cursor adapter operation "startSession" failed: UnknownAgentError: [plan_required] Cloud Agent is not available for free users. Please upgrade to Pro.. Nothing was approved.',
      detail: '',
      scope: null,
      result: null,
      definitionPath: null,
      uncovered: [],
    };
    const { provider: _dropped, ...withoutAgent } = legacy;
    const adopted = adoptPairRecord({ ...emptyRecord(pair), jobs: [legacy, { ...withoutAgent, id: 'job-x' }] }, pair);
    assert.deepEqual(
      adopted.jobs.map((job) => [job.id, job.provider, job.model, job.startedAt]),
      [['job-56bdb702-83d8-4895-b226-f56675d58ad2', 'cursor', 'claude-haiku-4-5', '2026-10-29T00:02:34.205Z']],
    );
    assert.equal(adopted.jobs[0]?.note, 'The agent could not be asked. Nothing was approved.');
    assert.equal(
      adopted.jobs[0]?.detail,
      'Cursor adapter operation "startSession" failed: UnknownAgentError: [plan_required] Cloud Agent is not available for free users. Please upgrade to Pro.',
    );
    assert.equal(adopted.agent, null);
  });

  it('counts a change several walks pass once: a walk decision is a decision over the same lines', () => {
    const hunk = { id: 'H1', path: 'a.ts', baseStart: 2, baseCount: 1, targetStart: 2, targetCount: 2 };
    const ranges = hunkRanges(hunk);
    const record: PairRecord = {
      ...emptyRecord(pair),
      marks: [
        ...ranges.map((scope, index) => ({ id: `a${String(index)}`, op: 'manual' as const, scope, reason: '', at: 't' })),
        ...ranges.map((scope, index) => ({ id: `b${String(index)}`, op: 'manual' as const, scope, reason: '', at: 't' })),
      ],
    };
    assert.equal(fileProgressOf(file, record).handled, 3);
    const decisions = hunkDecisionsFromPair(
      [{ path: 'a.ts', status: 'modified', binary: false, hunks: [hunk], added: 2, deleted: 1 }],
      record,
      { base: pair.base, target: pair.target },
    );
    assert.deepEqual(decisions.map((decision) => decision.outcome), ['accepted']);
  });

  it('shows a hunk assessed in a delegated review as reviewed in the walk only once the person accepted it, by the agent; an assessment alone or without a job does not count', () => {
    const hunk = { id: 'H1', path: 'a.ts', baseStart: 2, baseCount: 1, targetStart: 2, targetCount: 2 };
    const files = [{ path: 'a.ts', status: 'modified' as const, binary: false, hunks: [hunk], added: 2, deleted: 1 }];
    const approvals = hunkRanges(hunk).map((scope) => ({ ...agent, scope, reviewer: 'Claude · opus', jobId: 'job-1' }));
    // DSP-193: the assessment alone decides nothing in the walk either.
    assert.deepEqual(hunkDecisionsFromPair(files, { ...emptyRecord(pair), agentReviews: approvals }, { base: pair.base, target: pair.target }), []);
    const acceptedMark: PairMark = { id: 'd', op: 'accept-agent', scope: { kind: 'job', jobId: 'job-1' }, reason: '', at: '2026-11-10T12:00:00.000Z' };
    const delegated = hunkDecisionsFromPair(files, { ...emptyRecord(pair), agentReviews: approvals, marks: [acceptedMark] }, { base: pair.base, target: pair.target });
    assert.deepEqual(
      delegated.map((decision) => [decision.outcome, decision.by]),
      [['accepted', { kind: 'agent-delegated', adapterId: 'Claude · opus', mandate: 'job-1' }]],
    );
    // An older agent review with no delegated job behind it approves nothing, accepted or not.
    const undelegated = approvals.map(({ jobId: _job, ...rest }) => rest);
    assert.deepEqual(hunkDecisionsFromPair(files, { ...emptyRecord(pair), agentReviews: undelegated, marks: [acceptedMark] }, { base: pair.base, target: pair.target }), []);
    // A person's decision on one line and the accepted assessment on the rest: reviewed, and by the person.
    const mixed: PairRecord = {
      ...emptyRecord(pair),
      agentReviews: approvals,
      marks: [acceptedMark, { id: 'm', op: 'manual', scope: { kind: 'lines', side: 'target', path: 'a.ts', start: 2, end: 2 }, reason: '', at: 't' }],
    };
    assert.deepEqual(hunkDecisionsFromPair(files, mixed, { base: pair.base, target: pair.target }).map((decision) => decision.by.kind), ['human']);
  });
});

describe('rows for drawing', () => {
  const file: PairFile = {
    key: 'k',
    status: 'modified',
    oldPath: 'k',
    newPath: 'k',
    similarity: null,
    binary: false,
    // Line 3 edited; two added after 7; base line 10 removed (target line 11 follows).
    hunks: [
      { baseStart: 3, baseCount: 1, targetStart: 3, targetCount: 1 },
      { baseStart: 7, baseCount: 0, targetStart: 8, targetCount: 2 },
      { baseStart: 10, baseCount: 1, targetStart: 11, targetCount: 0 },
    ],
    added: 3,
    deleted: 2,
  };

  it('aligns the two sides and keeps every line exactly once', () => {
    const rows = unifiedRowsOf(file, 12, 13, new Set(['*']));
    const bases = rows.flatMap((row) => (row.kind === 'context' || row.kind === 'deleted' ? [row.base] : []));
    const targets = rows.flatMap((row) => (row.kind === 'context' || row.kind === 'added' ? [row.target] : []));
    assert.deepEqual(bases, Array.from({ length: 12 }, (_, index) => index + 1));
    assert.deepEqual(targets, Array.from({ length: 13 }, (_, index) => index + 1));
    const split = splitRowsOf(file, 12, 13, new Set(['*']));
    assert.deepEqual(
      split.filter((row) => row.kind === 'change').map((row) => [row.base, row.target]),
      [[3, 3], [null, 8], [null, 9], [10, null]],
    );
  });

  it('folds long unchanged runs into gaps, and unfolds them on request', () => {
    const long: PairFile = { ...file, hunks: [{ baseStart: 50, baseCount: 1, targetStart: 50, targetCount: 1 }] };
    const folded = unifiedRowsOf(long, 100, 100);
    const gaps = folded.filter((row) => row.kind === 'gap');
    assert.equal(gaps.length, 2);
    // Ten unchanged lines on each side of the change stay (30 October 2026).
    assert.equal(folded.filter((row) => row.kind === 'context').length, 2 * CONTEXT_LINES);
    assert.equal(unifiedRowsOf(long, 100, 100, new Set(['*'])).length, 101);
  });

  /** Every line of both sides drawn, in order, never twice: the numbers as the rows carry them. */
  const drawn = (rows: readonly UnifiedRow[]): { base: number[]; target: number[] } => ({
    base: rows.flatMap((row) => (row.kind === 'context' || row.kind === 'deleted' ? [row.base] : [])),
    target: rows.flatMap((row) => (row.kind === 'context' || row.kind === 'added' ? [row.target] : [])),
  });
  const increasing = (values: readonly number[]): boolean => values.every((value, index) => index === 0 || value > (values[index - 1] as number));

  it('opens a run between two changes from either change, and shows it whole where the two meet', () => {
    // Changes at base 20 and base 120: a run of 99 unchanged lines between them.
    const two: PairFile = {
      ...file,
      hunks: [
        { baseStart: 20, baseCount: 1, targetStart: 20, targetCount: 1 },
        { baseStart: 120, baseCount: 1, targetStart: 120, targetCount: 2 },
      ],
    };
    const compact = unifiedRowsOf(two, 200, 201);
    const between = compact.find((row): row is GapRow => row.kind === 'gap' && row.down && row.up);
    assert.ok(between !== undefined);
    assert.equal(between.count, 99 - 2 * CONTEXT_LINES);
    const down = expandGap(NO_EXPANSION, between, 'down');
    const afterDown = unifiedRowsOf(two, 200, 201, down);
    const stillBetween = afterDown.find((row): row is GapRow => row.kind === 'gap' && row.id === between.id);
    assert.equal(stillBetween?.count, between.count - MORE_LINES);
    // The lines below the change above now reach 20 further, with the right numbers on both sides.
    assert.ok(afterDown.some((row) => row.kind === 'context' && row.base === 21 + CONTEXT_LINES + MORE_LINES - 1 && row.target === row.base));
    const up = expandGap(down, between, 'up');
    const afterUp = unifiedRowsOf(two, 200, 201, up);
    assert.equal(afterUp.find((row): row is GapRow => row.kind === 'gap' && row.id === between.id)?.count, between.count - 2 * MORE_LINES);
    // Opened until the two meet: the run is shown whole, no fold of one line, no line twice.
    let meeting = up;
    for (let press = 0; press < 3; press += 1) {
      meeting = expandGap(meeting, between, 'down');
    }
    const met = unifiedRowsOf(two, 200, 201, meeting);
    assert.equal(met.filter((row) => row.kind === 'gap' && row.id === between.id).length, 0);
    for (const rows of [compact, afterDown, afterUp, met]) {
      const lines = drawn(rows);
      assert.ok(increasing(lines.base) && increasing(lines.target), 'a line drawn twice or out of order');
    }
    assert.deepEqual(drawn(unifiedRowsOf(two, 200, 201, { whole: true, gaps: {} })).base, Array.from({ length: 200 }, (_, index) => index + 1));
    assert.deepEqual(drawn(unifiedRowsOf(two, 200, 201, { whole: true, gaps: {} })).target, Array.from({ length: 201 }, (_, index) => index + 1));
  });

  it('opens the first run only upwards and the last only downwards, the same side by side', () => {
    const long: PairFile = { ...file, hunks: [{ baseStart: 50, baseCount: 1, targetStart: 50, targetCount: 1 }] };
    const gaps = unifiedRowsOf(long, 100, 100).filter((row): row is GapRow => row.kind === 'gap');
    assert.deepEqual(gaps.map((gap) => [gap.down, gap.up]), [[false, true], [true, false]]);
    const first = gaps[0] as GapRow;
    const opened = expandGap(NO_EXPANSION, first, 'up');
    const split = splitRowsOf(long, 100, 100, opened);
    const unified = unifiedRowsOf(long, 100, 100, opened);
    // Both layouts show the same unchanged lines, each with its number on both sides.
    assert.deepEqual(
      split.filter((row) => row.kind === 'context').map((row) => [row.base, row.target]),
      unified.flatMap((row) => (row.kind === 'context' ? [[row.base, row.target]] : [])),
    );
    assert.equal(split.find((row) => row.kind === 'gap' && row.gap?.id === first.id)?.gap?.count, first.count - MORE_LINES);
    // A line inside a run is found in it, to be opened when asked for.
    assert.equal(gapHiding(unifiedRowsOf(long, 100, 100), 'target', 5)?.id, first.id);
    assert.equal(gapHiding(unifiedRowsOf(long, 100, 100), 'target', 45), null);
  });
});

it('keys a pair by its repository and both commits', () => {
  const pair = { repository: 'C:\\x', base: 'a'.repeat(40), target: 'b'.repeat(40) };
  assert.equal(pairKeyOf(pair), pairKeyOf({ ...pair }));
  assert.notEqual(pairKeyOf(pair), pairKeyOf({ ...pair, target: 'c'.repeat(40) }));
});

describe('changes inside changed lines (Gerrit v3.14.4 behaviour)', () => {
  // The cases of Gerrit's IntraLineLoaderTest, as the ranges Gerrit draws on each line.
  const one = (a: string, b: string): unknown => intralineBlock([a], [b]);

  it('marks the changed characters of an edited line, not whole words', () => {
    assert.deepEqual(one('abc1', 'def1'), { base: [[[0, 3]]], target: [[[0, 3]]] });
    assert.deepEqual(one('abc1', 'abc2'), { base: [[[3, 4]]], target: [[[3, 4]]] });
    assert.deepEqual(one('export const v3 = 3;', 'export const v3 = 30;'), { base: [[]], target: [[[19, 20]]] });
  });

  it('marks a rewritten line throughout instead of dropping the marks', () => {
    assert.deepEqual(one('abc1', 'def2'), { base: [[[0, 4]]], target: [[[0, 4]]] });
  });

  it('joins edits a few characters apart into one span', () => {
    assert.deepEqual(one('ab1cdef2gh', 'ab2cdef3gh'), { base: [[[2, 8]]], target: [[[2, 8]]] });
  });

  it('puts an insertion after the common part, and counts whitespace', () => {
    assert.deepEqual(one('start middle end', 'start middlemiddle end'), { base: [[]], target: [[[12, 18]]] });
    assert.deepEqual(one('abc def', 'abc  def'), { base: [[]], target: [[[4, 5]]] });
    assert.deepEqual(one(' int *foobar', ' int * foobar'), { base: [[]], target: [[[6, 7]]] });
    assert.deepEqual(intralineBlock([' int *foobar', ' int *foobar'], [' int * foobar', ' int * foobar']), {
      base: [[], []],
      target: [[[6, 7]], [[6, 7]]],
    });
  });

  it('compares a block across its line breaks, as Gerrit does', () => {
    assert.deepEqual(intralineBlock(['multi', 'line'], ['multi', 'linemulti', 'line']), {
      base: [[], []],
      target: [[], [[0, 9]], []],
    });
  });

  it('compares three removed lines with the one line that replaced them as a whole', () => {
    const found = intralineBlock(
      ['    pending = load(path)', '    pending.sort()', '    return pending'],
      ['    return sorted(load(path))'],
    );
    // What survived ("load(path)") is light; the lines that did not survive are strong.
    assert.deepEqual(found, { base: [[[4, 14]], [[0, 17]], [[0, 18]]], target: [[[4, 18]]] });
  });

  it('gives each changed line of a file its marks from its hunk, the same for both layouts', () => {
    const file: PairFile = {
      key: 'f.ts→f.ts',
      status: 'modified',
      oldPath: 'f.ts',
      newPath: 'f.ts',
      similarity: null,
      binary: false,
      hunks: [
        { baseStart: 1, baseCount: 1, targetStart: 1, targetCount: 1 },
        { baseStart: 3, baseCount: 0, targetStart: 4, targetCount: 2 },
        { baseStart: 5, baseCount: 1, targetStart: 6, targetCount: 0 },
      ],
      added: 3,
      deleted: 2,
    };
    const marks = changeMarksOf(file, ['a = 1', 'b', 'c', 'd', 'gone'], ['a = 2', 'b', 'c', 'new 1', 'new 2', 'd']);
    assert.deepEqual(marks.get('base:1'), { kind: 'ranges', ranges: [[4, 5]] });
    assert.deepEqual(marks.get('target:1'), { kind: 'ranges', ranges: [[4, 5]] });
    assert.deepEqual(marks.get('target:4'), { kind: 'whole' });
    assert.deepEqual(marks.get('target:5'), { kind: 'whole' });
    assert.deepEqual(marks.get('base:5'), { kind: 'whole' });
    assert.equal(marks.get('base:2'), undefined);
  });

  it('marks a block too large to compare throughout', () => {
    const long = 'x'.repeat(15_000);
    assert.equal(intralineBlock([long], [`${long}y`]), null);
  });
});

describe('points worth checking become review threads (DSP-175)', () => {
  const walkWith = (name: string, checks: unknown[], base = fixture.appBase): string => {
    const definition = path.join(path.dirname(fixture.walkDefinition), `${name}.review.json`);
    const raw = JSON.parse(fs.readFileSync(fixture.walkDefinition, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(definition, `${JSON.stringify({ ...raw, base, checks }, null, 2)}\n`);
    return definition;
  };
  const older = { id: 'C1', kind: 'uncertainty', title: { sv: 'Osäkert', en: 'Whether v3 is read elsewhere' }, places: [{ path: 'src/keep.ts', side: 'target', start: 3, end: 3, role: 'context' }] };
  const pairOf = () => ({ repository: fixture.app, base: fixture.appBase, target: fixture.appTarget });

  it('adopts an older walk\'s points when its window joins the pair, once, with no recommendation made up', async () => {
    const definition = walkWith('older', [older]);
    const opened = await pairs.openForWalk(pairOf(), definition);
    assert.ok(!isPairError(opened));
    const thread = reviewThreadsOf(opened.record).find((entry) => entry.points.some((point) => point.checkId === 'C1'));
    assert.ok(thread !== undefined);
    assert.equal(thread.kind, 'gap');
    assert.equal(thread.recommendation, null);
    assert.equal(thread.origin.source, 'worth-checking');
    const writes = changes.length;
    const again = await pairs.openForWalk(pairOf(), definition);
    assert.ok(!isPairError(again));
    assert.equal(changes.length, writes, 'opening the walk again wrote the record again');
    assert.equal(reviewThreadsOf(again.record).filter((entry) => entry.id === thread.id).length, 1);
  });

  it('lets the host accept a point\'s recommendation as an agreed action, and keeps the point the person engaged with when the points are asked again', async () => {
    const recommended = { id: 'C1', kind: 'finding', title: 'v3 is not covered by a test', places: [{ path: 'src/keep.ts', side: 'target', start: 3, end: 3 }], recommendation: { kind: 'change', action: 'Add a test.', rationale: 'Untested.' } };
    const definition = walkWith('fresh', []);
    fs.writeFileSync(definition.replace(/\.review\.json$/, '.checks.json'), JSON.stringify({ format: 'dspatch-checks/1', checks: [recommended] }));
    const opened = await pairs.openForWalk(pairOf(), definition);
    assert.ok(!isPairError(opened));
    const thread = reviewThreadsOf(opened.record).find((entry) => entry.title === 'v3 is not covered by a test');
    assert.ok(thread !== undefined);
    const accepted = pairs.thread(opened.key, { threadId: thread.id, kind: 'accept', text: '' });
    assert.ok(!isPairError(accepted));
    assert.equal(reviewThreadsOf(accepted).find((entry) => entry.id === thread.id)?.status, 'action-agreed');
    // Asked again: a new point replaces it in the walk, but the decided one stays a thread.
    fs.writeFileSync(definition.replace(/\.review\.json$/, '.checks.json'), JSON.stringify({ format: 'dspatch-checks/1', checks: [{ ...older, id: 'C1' }] }));
    pairs.adoptChecks(opened.key, definition);
    const after = reviewThreadsOf(pairs.storedRecord(opened.key, pairOf()));
    const kept = after.find((entry) => entry.id === thread.id);
    assert.equal(kept?.status, 'action-agreed');
    assert.deepEqual(kept?.points, []);
  });

  it('reads no points from a walk over other commits', async () => {
    const definition = walkWith('other', [{ ...older, title: 'Not this pair' }], fixture.libBase);
    const opened = await pairs.openForWalk(pairOf(), definition);
    assert.ok(!isPairError(opened));
    assert.ok(!reviewThreadsOf(opened.record).some((entry) => entry.title === 'Not this pair'));
  });
});
