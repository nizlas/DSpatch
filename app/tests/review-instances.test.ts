/**
 * DSP-186 (Niclas's decision of 9 November 2026): every review is an instance with an id of
 * its own. A new review of a pair reviewed before starts empty; closing keeps a review for
 * reopening; deleting removes only that review's own files; two reviews of one pair are
 * independent, also after a restart; a late agent answer never recreates a deleted review;
 * a record from before review ids opens as a review, with a backup taken once before the
 * first change; a record that cannot be read is moved aside, never overwritten.
 *
 * Synthetic data only: a Git fixture and temporary folders. The agent is the simulated
 * presentation adapter.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ReviewAgentJobs } from '../src/host/review-agent-jobs';
import { earlierDiscussion } from '../src/host/review-pair-discussion';
import { ReviewPairs, pairKeyOf, reviewArtefacts, reviewOfDefinition } from '../src/host/review-pairs';
import { RevisionSnapshots } from '../src/host/revision-snapshots';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { reviewRecordKey } from '../src/main/review-service';
import { emptyDiscussionRecord, type DiscussionIdentity } from '../src/shared/review-discussion';
import { isPairError, isReviewId, type OpenPair, type PairRecord } from '../src/shared/review-pair';
import { makePairFixture, type PairFixture } from './support/pair-fixture';

let fixture: PairFixture;
let root: string;

before(() => {
  fixture = makePairFixture();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-review-instances-'));
});

after(() => {
  fs.rmSync(fixture.workspace, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

/** A user-data `reviews` folder of its own for one test. */
function reviewsDir(name: string): string {
  const dir = path.join(root, name, 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function pairsIn(reviews: string): Promise<ReviewPairs> {
  const pairs = new ReviewPairs({ recordsDir: path.join(reviews, 'pairs'), reviewsDir: reviews, changed: () => undefined, instructionVersion: 3 });
  await pairs.repositories([fixture.workspace]);
  return pairs;
}

function appPair(): { repository: string; base: string; target: string } {
  return { repository: fixture.app, base: fixture.appBase, target: fixture.appTarget };
}

async function started(pairs: ReviewPairs): Promise<OpenPair> {
  const opened = await pairs.openPair(appPair());
  if (isPairError(opened)) {
    throw new Error(opened.error);
  }
  return opened;
}

function mark(pairs: ReviewPairs, key: string, line: number): PairRecord {
  const record = pairs.mark(key, { op: 'manual', scopes: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: line, end: line }], reason: '' });
  assert.ok(!isPairError(record), JSON.stringify(record));
  return record;
}

/** A prepared walk of a review, where the jobs write one, over the app pair. */
function walkOf(reviews: string, id: string, name = 'job-x'): string {
  const file = path.join(reviews, 'generated', id, `${name}.review.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = JSON.parse(fs.readFileSync(fixture.walkDefinition, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(file, JSON.stringify({ ...raw, repository: fixture.app, title: `Walk of ${id}` }));
  fs.writeFileSync(file.replace(/\.review\.json$/, '.checks.json'), JSON.stringify({ format: 'dspatch-checks/1', checks: [] }));
  return file;
}

/** Every file below a folder, relative, sorted. */
function filesBelow(dir: string): string[] {
  const out: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  return out.sort();
}

describe('reviews with ids of their own', () => {
  it('starts a new review of a pair reviewed before empty: no marks, no walks, no discussion of the earlier one', async () => {
    const reviews = reviewsDir('new-is-empty');
    const pairs = await pairsIn(reviews);
    const first = await started(pairs);
    assert.ok(isReviewId(first.key) && first.key.startsWith('r-'));
    assert.notEqual(first.key, pairKeyOf(first.pair), 'a new review never takes the pair key');
    mark(pairs, first.key, 3);
    const walk = walkOf(reviews, first.key);
    const firstDiscussion: DiscussionIdentity = { key: first.key, repository: fixture.app, base: fixture.appBase, target: fixture.appTarget, definitionPath: '' };
    fs.writeFileSync(
      path.join(reviews, `${first.key}.discussion.json`),
      JSON.stringify({ ...emptyDiscussionRecord(firstDiscussion), messages: [{ id: 'q-1', role: 'question', text: 'Old question', at: '2026-11-09T10:00:00.000Z', subject: 'W1.1', status: 'sent' }] }),
    );

    const second = await started(pairs);
    assert.notEqual(second.key, first.key);
    assert.equal(second.record.marks.length, 0);
    assert.equal(second.record.jobs.length, 0);
    assert.equal(second.record.walkDefinition, null);
    assert.deepEqual(pairs.walksFor(second.key, [walk]), [], "the first review's walk is not offered in the second");
    assert.equal((pairs.walksFor(first.key, [walk]) as readonly unknown[]).length, 1, 'it is offered in its own review');
    assert.equal(reviewOfDefinition(reviews, walk), first.key);
    assert.ok(isPairError(pairs.stepOf(second.key, walk, 'W1', 'S1')), "another review's walk is refused for a step question");
    const history = earlierDiscussion(reviews, { ...firstDiscussion, key: second.key }, () => true, pairs);
    assert.deepEqual(history, [], 'the second discussion starts with nothing of the first');
    assert.equal((pairs.state(first.key) as PairRecord).marks.length, 1, 'the first review is unchanged');
  });

  it('closes a review and reopens exactly it, from the list; the same commits chosen again make a new one', async () => {
    const pairs = await pairsIn(reviewsDir('close-reopen'));
    const review = await started(pairs);
    mark(pairs, review.key, 3);
    pairs.walkOpened(review.key, '/somewhere/walk.review.json');
    assert.ok(!isPairError(pairs.end(review.key)));
    const listed = (await pairs.ongoing()).find((entry) => entry.key === review.key);
    assert.equal(listed?.closed, true, 'a closed review is listed as closed, kept for reopening');
    const reopened = await pairs.openPair({ review: review.key });
    assert.ok(!isPairError(reopened));
    assert.equal(reopened.key, review.key);
    assert.equal(reopened.record.endedAt, null);
    assert.equal(reopened.record.marks.length, 1);
    assert.equal(reopened.record.walkDefinition, '/somewhere/walk.review.json');
    const fresh = await started(pairs);
    assert.notEqual(fresh.key, review.key);
    assert.equal((await pairs.ongoing()).filter((entry) => entry.pair.target === fixture.appTarget && !entry.closed).length, 2, 'two open reviews of one pair');
  });

  it('keeps two reviews of one pair apart, also after a restart', async () => {
    const reviews = reviewsDir('two-of-one-pair');
    const pairs = await pairsIn(reviews);
    const one = await started(pairs);
    const two = await started(pairs);
    mark(pairs, one.key, 3);
    mark(pairs, two.key, 8);
    mark(pairs, two.key, 9);
    pairs.savePosition(one.key, { view: 'file', fileKey: 'x', layout: 'unified', line: null });

    const restarted = await pairsIn(reviews);
    const listed = await restarted.ongoing();
    assert.deepEqual(listed.map((entry) => entry.key).sort(), [one.key, two.key].sort());
    const oneAgain = await restarted.openPair({ review: one.key });
    const twoAgain = await restarted.openPair({ review: two.key });
    assert.ok(!isPairError(oneAgain) && !isPairError(twoAgain));
    assert.deepEqual(oneAgain.record.marks.map((entry) => entry.scope.kind === 'lines' ? entry.scope.start : -1), [3]);
    assert.deepEqual(twoAgain.record.marks.map((entry) => entry.scope.kind === 'lines' ? entry.scope.start : -1), [8, 9]);
    assert.equal(oneAgain.record.position.layout, 'unified');
    assert.equal(twoAgain.record.position.layout, 'split');
    // A walk window of one review joins that review, not the other.
    const walk = walkOf(reviews, two.key);
    const joined = await restarted.openForWalk(appPair(), walk);
    assert.ok(!isPairError(joined));
    assert.equal(joined.key, two.key);
    const named = await restarted.openForWalk(appPair(), walk, one.key);
    assert.ok(!isPairError(named));
    assert.equal(named.key, one.key, 'the review the window was opened for decides');
  });

  it('deletes exactly the review asked for: its record and its own files, nothing of the other review or the code', async () => {
    const reviews = reviewsDir('delete');
    const pairs = await pairsIn(reviews);
    const gone = await started(pairs);
    const kept = await started(pairs);
    const status = execFileSync('git', ['-C', fixture.app, 'status', '--porcelain'], { encoding: 'utf8' });
    for (const review of [gone, kept]) {
      mark(pairs, review.key, 3);
      const walk = walkOf(reviews, review.key);
      fs.mkdirSync(path.join(reviews, 'discussion'), { recursive: true });
      fs.writeFileSync(path.join(reviews, 'discussion', `${review.key}.review.json`), JSON.stringify({ repository: fixture.app, base: fixture.appBase, target: fixture.appTarget, walks: [] }));
      fs.writeFileSync(path.join(reviews, `${review.key}.discussion.json`), '{}');
      fs.writeFileSync(path.join(reviews, `${review.key}.explanations.json`), '{}');
      fs.mkdirSync(path.join(reviews, 'discussion-cwd', review.key), { recursive: true });
      fs.writeFileSync(path.join(reviews, 'discussion-cwd', review.key, 'note'), '');
      fs.mkdirSync(path.join(reviews, 'context'), { recursive: true });
      fs.writeFileSync(path.join(reviews, 'context', `${review.key}.json`), '{}');
      fs.writeFileSync(path.join(reviews, `${reviewRecordKey(fixture.app, fixture.appBase, fixture.appTarget, walk)}.json`), '{}');
    }
    fs.writeFileSync(path.join(reviews, 'preferences.json'), '{}');
    const before = filesBelow(reviews);

    assert.ok(!isPairError(pairs.remove(gone.key)));
    const artefacts = reviewArtefacts(reviews, gone.key);
    for (const file of artefacts.files) {
      fs.rmSync(file, { force: true });
    }
    for (const folder of artefacts.folders) {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    const removed = before.filter((file) => !filesBelow(reviews).includes(file));
    assert.deepEqual(
      removed.sort(),
      [
        path.join('pairs', `${gone.key}.json`),
        path.join('generated', gone.key, 'job-x.review.json'),
        path.join('generated', gone.key, 'job-x.checks.json'),
        path.join('discussion', `${gone.key}.review.json`),
        `${gone.key}.discussion.json`,
        `${gone.key}.explanations.json`,
        path.join('discussion-cwd', gone.key, 'note'),
        path.join('context', `${gone.key}.json`),
        `${reviewRecordKey(fixture.app, fixture.appBase, fixture.appTarget, path.join(reviews, 'generated', gone.key, 'job-x.review.json'))}.json`,
      ].sort(),
    );
    assert.ok(filesBelow(reviews).length === before.length - removed.length);
    assert.equal(execFileSync('git', ['-C', fixture.app, 'status', '--porcelain'], { encoding: 'utf8' }), status, 'the repository is untouched');
    assert.ok(!(await pairs.ongoing()).some((entry) => entry.key === gone.key));
    assert.ok(isPairError(await pairs.openPair({ review: gone.key })), 'a deleted review does not open');
    assert.ok(isPairError(pairs.mark(gone.key, { op: 'manual', scopes: [{ kind: 'file', fileKey: 'x' }], reason: '' })));
    assert.ok(!fs.existsSync(path.join(reviews, 'pairs', `${gone.key}.json`)), 'nothing wrote it again');
    assert.equal((pairs.state(kept.key) as PairRecord).marks.length, 1, 'the other review is as it was');
  });
});

describe('a late agent answer (simulated provider)', () => {
  const jobsFor = (reviews: string, pairs: ReviewPairs): ReviewAgentJobs =>
    new ReviewAgentJobs({
      recordsDir: reviews,
      // Slow enough that the answer arrives after the review is deleted.
      createAdapter: () => new PresentationAdapter({ deltaMs: 15 }),
      snapshots: new RevisionSnapshots({ root: path.join(reviews, 'revisions'), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
      cancelConfirmMs: 300,
    });

  const settle = async (jobs: ReviewAgentJobs): Promise<void> => {
    for (const until = Date.now() + 20_000; Date.now() < until && jobs.working(); ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(jobs.working(), false, 'the job ended');
  };

  it('writes nothing for a review deleted while its walks were prepared, not even the walk file', async () => {
    const reviews = reviewsDir('late-answer');
    const pairs = await pairsIn(reviews);
    const review = await started(pairs);
    const other = await started(pairs);
    const jobs = jobsFor(reviews, pairs);
    const job = jobs.start(review.key, { kind: 'walks', provider: 'claude', model: 'sim-model' });
    assert.ok(!isPairError(job), JSON.stringify(job));
    // Deleted once the agent has its material and is answering.
    for (const until = Date.now() + 10_000; Date.now() < until; ) {
      const state = pairs.state(review.key);
      if (!isPairError(state) && state.jobs[0]?.material !== undefined) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(!isPairError(pairs.remove(review.key)));
    // Not stopped: the answer comes in after the deletion and must be dropped unwritten.
    await settle(jobs);
    assert.ok(!fs.existsSync(path.join(reviews, 'pairs', `${review.key}.json`)), 'the record was not recreated');
    assert.ok(!fs.existsSync(path.join(reviews, 'generated', review.key)), 'no walk was written');
    assert.equal((pairs.state(other.key) as PairRecord).jobs.length, 0, 'nothing landed in the other review');
    assert.ok(!fs.existsSync(path.join(reviews, 'generated', other.key)));
  });

  it('checks the record still exists before writing the walk file, and drops the answer when it does not', async () => {
    const reviews = reviewsDir('late-answer-record-gone');
    const pairs = await pairsIn(reviews);
    const review = await started(pairs);
    const said: string[] = [];
    const jobs = new ReviewAgentJobs({
      recordsDir: reviews,
      createAdapter: () => new PresentationAdapter({ deltaMs: 5 }),
      snapshots: new RevisionSnapshots({ root: path.join(reviews, 'revisions'), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: (message) => said.push(message),
    });
    const job = jobs.start(review.key, { kind: 'walks', provider: 'claude', model: 'sim-model' });
    assert.ok(!isPairError(job));
    for (const until = Date.now() + 10_000; Date.now() < until; ) {
      const state = pairs.state(review.key);
      if (!isPairError(state) && state.jobs[0]?.material !== undefined) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // The record goes from under the running job (the review is still open in this host).
    fs.rmSync(path.join(reviews, 'pairs', `${review.key}.json`));
    await settle(jobs);
    assert.ok(said.some((message) => /the walks were not written/.test(message)), said.join('\n'));
    assert.ok(!fs.existsSync(path.join(reviews, 'generated', review.key)), 'no walk file');
    assert.ok(!fs.existsSync(path.join(reviews, 'pairs', `${review.key}.json`)), 'no record');
  });

  it('stops the work of a review being deleted, and writes nothing of it', async () => {
    const reviews = reviewsDir('late-answer-stopped');
    const pairs = await pairsIn(reviews);
    const review = await started(pairs);
    const jobs = jobsFor(reviews, pairs);
    const job = jobs.start(review.key, { kind: 'walks', provider: 'claude', model: 'sim-model' });
    assert.ok(!isPairError(job));
    assert.ok(!isPairError(pairs.remove(review.key)));
    await jobs.forgetReview(review.key);
    await settle(jobs);
    assert.deepEqual(fs.readdirSync(path.join(reviews, 'pairs')), ['recent.json'], 'only the last commits chosen for the repository, no review');
    assert.ok(!fs.existsSync(path.join(reviews, 'generated', review.key)));
  });

  it('records what the walks were prepared with, and says when they were prepared with earlier settings', async () => {
    const reviews = reviewsDir('generation');
    const pairs = await pairsIn(reviews);
    const review = await started(pairs);
    assert.equal(review.record.startedWith.instructionVersion, 3);
    assert.equal(review.record.generation, null);
    const jobs = new ReviewAgentJobs({
      recordsDir: reviews,
      createAdapter: () => new PresentationAdapter({ deltaMs: 1 }),
      snapshots: new RevisionSnapshots({ root: path.join(reviews, 'revisions'), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
    });
    const job = jobs.start(review.key, { kind: 'walks', provider: 'claude', model: 'sim-model', presentation: { profile: 'standard' } });
    assert.ok(!isPairError(job));
    await settle(jobs);
    const record = pairs.state(review.key) as PairRecord;
    assert.equal(record.generation?.provider, 'claude');
    assert.equal(record.generation?.model, 'sim-model');
    assert.equal(record.generation?.profile, 'standard');
    assert.equal(typeof record.generation?.instructionVersion, 'number');
    assert.ok(fs.existsSync(path.join(reviews, 'generated', review.key)), 'its walks are in its own folder');
    const now = (await pairsIn(reviews)).ongoing();
    assert.equal((await now).find((entry) => entry.key === review.key)?.stale, record.generation?.instructionVersion !== 3);
    const later = new ReviewPairs({ recordsDir: path.join(reviews, 'pairs'), reviewsDir: reviews, changed: () => undefined, instructionVersion: 999 });
    assert.equal((await later.ongoing()).find((entry) => entry.key === review.key)?.stale, true, 'a newer instruction version is said, not acted on');
  });
});

describe('reviews recorded before ids', () => {
  /** A version 1 record as DSpatch 0.1.11 wrote it, under its pair key. */
  function legacyRecord(reviews: string): { key: string; text: string } {
    const key = pairKeyOf(appPair());
    const record = {
      version: 1,
      pair: appPair(),
      requirement: 'manual',
      marks: [{ id: 'm1', op: 'manual', scope: { kind: 'lines', side: 'target', path: 'src/keep.ts', start: 3, end: 3 }, reason: '', at: '2026-11-01T10:00:00.000Z' }],
      agentReviews: [],
      jobs: [],
      agent: null,
      position: { view: 'files', fileKey: null, layout: 'unified', line: null },
      walkDefinition: null,
      endedAt: '2026-11-02T10:00:00.000Z',
      threads: [],
      savedAt: '2026-11-02T10:00:00.000Z',
    };
    const text = `${JSON.stringify(record, null, 2)}\n`;
    fs.mkdirSync(path.join(reviews, 'pairs'), { recursive: true });
    fs.writeFileSync(path.join(reviews, 'pairs', `${key}.json`), text);
    fs.writeFileSync(path.join(reviews, 'pairs', 'recent.json'), '{}\n');
    return { key, text };
  }

  it('opens a record of the earlier form as a review with its id, marks and walks, and backs the records up once before the first change', async () => {
    const reviews = reviewsDir('legacy');
    const { key, text } = legacyRecord(reviews);
    const walk = walkOf(reviews, key);
    const pairs = await pairsIn(reviews);
    const listed = (await pairs.ongoing()).find((entry) => entry.key === key);
    assert.ok(listed !== undefined, 'the earlier review is listed');
    assert.equal(listed.closed, true);
    assert.equal(listed.createdAt, '2026-11-02T10:00:00.000Z');
    assert.deepEqual(fs.readdirSync(reviews).filter((name) => name.startsWith('backup-')), [], 'reading changes nothing and backs nothing up');

    const opened = await pairs.openPair({ review: key });
    assert.ok(!isPairError(opened));
    assert.equal(opened.key, key);
    assert.equal(opened.record.marks.length, 1);
    assert.equal(opened.record.position.layout, 'unified');
    assert.deepEqual((pairs.walksFor(key, [walk]) as readonly { definitionPath: string }[]).map((entry) => entry.definitionPath), [walk]);
    const backups = fs.readdirSync(reviews).filter((name) => /^backup-.*-pre-review-ids$/.test(name));
    assert.equal(backups.length, 1, 'reopening wrote the record, and a backup was taken first');
    assert.equal(fs.readFileSync(path.join(reviews, backups[0] as string, `${key}.json`), 'utf8'), text, 'the backup holds the record as it was');
    assert.ok(fs.existsSync(path.join(reviews, backups[0] as string, 'recent.json')));
    const now = JSON.parse(fs.readFileSync(path.join(reviews, 'pairs', `${key}.json`), 'utf8')) as Record<string, unknown>;
    assert.deepEqual([now['version'], now['id']], [2, key]);

    mark(pairs, key, 8);
    const again = await pairsIn(reviews);
    const reopened = await again.openPair({ review: key });
    assert.ok(!isPairError(reopened));
    assert.equal(reopened.record.marks.length, 2);
    mark(again, key, 9);
    assert.equal(fs.readdirSync(reviews).filter((name) => name.startsWith('backup-')).length, 1, 'never a second backup');
    // A walk window over a walk of the earlier review joins it by where the walk is.
    const joined = await again.openForWalk(appPair(), walk);
    assert.ok(!isPairError(joined));
    assert.equal(joined.key, key);
  });

  it('moves a record that cannot be read aside instead of writing over it', async () => {
    const reviews = reviewsDir('corrupt');
    const pairs = await pairsIn(reviews);
    const review = await started(pairs);
    mark(pairs, review.key, 3);
    const file = path.join(reviews, 'pairs', `${review.key}.json`);
    fs.writeFileSync(file, '{ "version": 2, "id": "half-writ');
    const state = pairs.state(review.key) as PairRecord;
    assert.equal(state.marks.length, 0);
    const aside = fs.readdirSync(path.join(reviews, 'pairs')).filter((name) => name.startsWith(`${review.key}.json.corrupt-`));
    assert.equal(aside.length, 1, 'the unreadable record was kept aside');
    assert.equal(fs.readFileSync(path.join(reviews, 'pairs', aside[0] as string), 'utf8'), '{ "version": 2, "id": "half-writ');
    assert.ok(isPairError(pairs.mark(review.key, { op: 'manual', scopes: [{ kind: 'file', fileKey: 'x' }], reason: '' })), 'nothing is written in its place');
    assert.ok(!fs.existsSync(file));
  });
});
