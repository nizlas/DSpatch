/**
 * DSP-152: preparing code walks and reviewing a delegated part, through the host's job
 * service, the real presentation adapter (SIMULATED answers) and a real Git fixture.
 *
 * What these establish is DSpatch's own handling: the material comes from the two commits,
 * references are checked, a repair round happens once, approvals are recorded only from a
 * checked result and only inside the delegated scope, and unfinished work is never
 * recorded as approval. They say nothing about what a real model writes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ReviewAgentJobs } from '../src/host/review-agent-jobs';
import { ReviewPairs } from '../src/host/review-pairs';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { parseReviewDefinition } from '../src/shared/review-model';
import { answerJson, readReviewAnswer, readWalksAnswer, walksPrompt } from '../src/shared/review-agent';
import { fileProgressOf, isPairError, lineStatusesOf, lineKey, type AgentJob, type OpenPair, type PairRecord } from '../src/shared/review-pair';
import { makePairFixture, PAIR_WORKING_TREE_ONLY, type PairFixture } from './support/pair-fixture';

let fixture: PairFixture;
let records: string;
let pairs: ReviewPairs;
let open: OpenPair;
let sent: string[];

function jobs(adapterOptions: { readonly deltaMs?: number } = {}): ReviewAgentJobs {
  return new ReviewAgentJobs({
    recordsDir: records,
    createAdapter: () => {
      const adapter = new PresentationAdapter({ deltaMs: adapterOptions.deltaMs ?? 1 });
      const send = adapter.send.bind(adapter);
      adapter.send = (sessionId: string, prompt: string) => {
        sent.push(prompt);
        return send(sessionId, prompt);
      };
      return adapter;
    },
    availability: () => ({ choosable: true, reason: null }),
    pairs,
    language: () => Promise.resolve('en'),
    log: () => undefined,
    cancelConfirmMs: 500,
  });
}

async function settled(key: string, jobId: string, timeoutMs = 15_000): Promise<AgentJob> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const record = pairs.state(key) as PairRecord;
    const job = record.jobs.find((entry) => entry.id === jobId);
    if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not settle`);
}

before(async () => {
  fixture = makePairFixture();
  records = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-agent-jobs-'));
  pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs'), changed: () => undefined });
  await pairs.repositories([fixture.workspace]);
  const opened = await pairs.openPair({ repository: fixture.app, base: fixture.appBase, target: fixture.appTarget });
  if (isPairError(opened)) {
    throw new Error(opened.error);
  }
  open = opened;
  sent = [];
});

after(() => {
  fs.rmSync(fixture.workspace, { recursive: true, force: true });
  fs.rmSync(records, { recursive: true, force: true });
  delete process.env['DSPATCH_REVIEW_SIM'];
});

describe('the material', () => {
  it('is read from the two commits, never the working copy', async () => {
    const material = await pairs.material(open.key);
    assert.ok(!isPairError(material));
    const prompt = walksPrompt(material, 'en');
    assert.ok(prompt.includes('export const v3 = 30;'));
    assert.ok(!prompt.includes(PAIR_WORKING_TREE_ONLY));
    assert.ok(prompt.includes('Keep apart what the code is meant to do'), 'the plan\'s writing rules are the instruction');
  });
});

describe('preparing code walks', () => {
  it('writes a walk definition the walk window reads, with coverage gaps and checked places', async () => {
    process.env['DSPATCH_REVIEW_SIM'] = 'bad-ref-first';
    sent = [];
    const started = jobs().start(open.key, { kind: 'walks', provider: 'cursor', model: 'sim-model' });
    assert.ok(!isPairError(started));
    const job = await settled(open.key, started.id);
    delete process.env['DSPATCH_REVIEW_SIM'];
    assert.equal(job.state, 'done', job.note);
    assert.equal(sent.length, 2, 'one preparation and exactly one repair round');
    assert.ok(sent[1]?.includes('does not exist') || sent[1]?.includes('lines at that commit'), 'the repair names the bad place');
    assert.ok(job.definitionPath !== null && fs.existsSync(job.definitionPath));
    const parsed = parseReviewDefinition(JSON.parse(fs.readFileSync(job.definitionPath, 'utf8')) as unknown);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.definition?.base, fixture.appBase);
    assert.ok(job.uncovered.length > 0, 'the simulated walks leave a file out, and the gap is recorded');
    assert.match(job.note, /changed line\(s\) are in no walk/);
  });

  it('refuses a second preparation while one runs', () => {
    const service = jobs({ deltaMs: 200 });
    const first = service.start(open.key, { kind: 'walks', provider: 'cursor', model: 'sim-model' });
    assert.ok(!isPairError(first));
    const second = service.start(open.key, { kind: 'walks', provider: 'cursor', model: 'sim-model' });
    assert.ok(isPairError(second));
    return service.cancel(open.key, first.id).then(() => settled(open.key, first.id));
  });
});

describe('a delegated review', () => {
  it('approves within the scope, keeps a problem line unapproved, and grounds approvals in the job', async () => {
    const scope = { kind: 'lines', label: 'src/keep.ts added lines', ranges: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: 8, end: 9 }] };
    const started = jobs().start(open.key, { kind: 'review', provider: 'cursor', model: 'sim-model', scope });
    assert.ok(!isPairError(started));
    const job = await settled(open.key, started.id);
    assert.equal(job.state, 'done', job.note);
    assert.deepEqual(job.result?.approved.map((range) => [range.start, range.end]), [[8, 8]]);
    assert.equal(job.result?.findings.filter((finding) => finding.severity === 'problem').length, 1);
    const record = pairs.state(open.key) as PairRecord;
    const keep = open.files.find((file) => file.newPath === 'src/keep.ts');
    assert.ok(keep !== undefined);
    const statuses = lineStatusesOf(keep, record);
    assert.equal(statuses.get(lineKey({ side: 'target', path: 'src/keep.ts', line: 8 }))?.agent[0]?.jobId, job.id);
    assert.equal(statuses.get(lineKey({ side: 'target', path: 'src/keep.ts', line: 9 }))?.agent.length, 0);
    // Manual is the default, and a delegated approval counts for exactly its lines.
    assert.equal(record.requirement, 'manual');
    assert.equal(fileProgressOf(keep, record).agent, 1);
  });

  it('approves nothing when the material is not enough', async () => {
    const scope = { kind: 'file', label: 'docs/gone.md', ranges: [{ kind: 'lines', side: 'base', path: 'docs/gone.md', start: 1, end: 3 }] };
    const started = jobs().start(open.key, { kind: 'review', provider: 'cursor', model: 'sim-model', scope });
    assert.ok(!isPairError(started));
    const job = await settled(open.key, started.id);
    assert.equal(job.state, 'done');
    assert.equal(job.result?.insufficient, true);
    assert.deepEqual(job.result?.approved, []);
    const record = pairs.state(open.key) as PairRecord;
    assert.equal(record.agentReviews.filter((review) => review.jobId === job.id).length, 0);
  });

  it('refuses a scope with no changed lines before anything is written', () => {
    const scope = { kind: 'lines', label: 'unchanged', ranges: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: 1, end: 2 }] };
    const before = (pairs.state(open.key) as PairRecord).jobs.length;
    assert.ok(isPairError(jobs().start(open.key, { kind: 'review', provider: 'cursor', model: 'm', scope })));
    assert.equal((pairs.state(open.key) as PairRecord).jobs.length, before);
  });

  it('records a stopped review as cancelled, with nothing approved', async () => {
    const service = jobs({ deltaMs: 300 });
    const scope = { kind: 'lines', label: 'src/added.ts', ranges: [{ kind: 'lines', side: 'target', path: 'src/added.ts', start: 1, end: 2 }] };
    const started = service.start(open.key, { kind: 'review', provider: 'cursor', model: 'sim-model', scope });
    assert.ok(!isPairError(started));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await service.cancel(open.key, started.id);
    const job = await settled(open.key, started.id);
    assert.ok(job.state === 'cancelled' || job.state === 'unknown', job.state);
    const record = pairs.state(open.key) as PairRecord;
    assert.equal(record.agentReviews.filter((review) => review.jobId === job.id).length, 0);
  });
});

describe('after a restart', () => {
  it('a job the record shows running becomes unknown and is not started again', () => {
    pairs.update(open.key, (record) => ({
      ...record,
      jobs: [
        ...record.jobs,
        { id: 'job-left', kind: 'walks', state: 'running', provider: 'cursor', model: 'm', startedAt: '', endedAt: null, note: '', scope: null, result: null, definitionPath: null, uncovered: [] },
      ],
    }));
    sent = [];
    jobs().reconcile(open.key);
    const job = (pairs.state(open.key) as PairRecord).jobs.find((entry) => entry.id === 'job-left');
    assert.equal(job?.state, 'unknown');
    assert.equal(sent.length, 0);
  });
});

describe('reading answers', () => {
  it('reads walks from a fenced answer and names structural problems', () => {
    const read = readWalksAnswer(answerJson('```json\n{"walks":[{"title":"t","steps":[{"title":"s","body":"b","places":[{"path":"a","side":"target","start":0}]}]}]}\n```'));
    assert.ok(read.problems.some((problem) => problem.includes('1-based')));
  });

  it('never approves outside the scope or without review', () => {
    const keep = open.files.find((file) => file.newPath === 'src/keep.ts');
    assert.ok(keep !== undefined);
    const scope = { kind: 'lines' as const, label: 'x', ranges: [{ kind: 'lines' as const, side: 'target' as const, path: 'src/keep.ts', start: 8, end: 8 }] };
    const result = readReviewAnswer(
      { assessment: 'fine', reviewed: [{ path: 'src/keep.ts', side: 'target', start: 8, end: 8 }], approved: [{ path: 'src/keep.ts', side: 'target', start: 3, end: 9 }] },
      scope,
      [keep],
    );
    assert.ok(!('error' in result));
    assert.deepEqual(result.approved.map((range) => [range.start, range.end]), [[8, 8]]);
    assert.ok(result.adjustments.length > 0);
  });
});
