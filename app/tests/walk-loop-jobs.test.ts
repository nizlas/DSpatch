/**
 * DSP-189: the walk loop through the host's job service, the real presentation adapter
 * (SIMULATED answers) and a real Git repository holding the synthetic connect case. What these
 * establish is DSpatch's own handling: the loop method is a job like the one call, its three
 * roles get their own sessions and prompts, the correction round and the final assessment are
 * recorded on the job and in the run record, the definition opens like any other, a stop ends
 * the job without a resend, and a deleted review gets nothing written back. They say nothing
 * about what a real model writes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { ReviewAgentJobs } from '../src/host/review-agent-jobs';
import { ReviewPairs } from '../src/host/review-pairs';
import { RevisionSnapshots } from '../src/host/revision-snapshots';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { ReviewService } from '../src/main/review-service';
import { isPairError, type AgentJob, type PairRecord } from '../src/shared/review-pair';
import { CONNECT_CASE, makeSyntheticRepo } from './support/synthetic-walks';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-loop-jobs-'));

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env['DSPATCH_REVIEW_SIM'];
});

async function setup(name: string, deltaMs = 1) {
  const workspace = path.join(root, name, 'workspace');
  const { repo, base, target } = makeSyntheticRepo(workspace, CONNECT_CASE);
  const records = path.join(root, name, 'records');
  const pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs'), changed: () => undefined });
  await pairs.repositories([workspace]);
  const opened = await pairs.openPair({ repository: repo, base, target });
  if (isPairError(opened)) {
    throw new Error(opened.error);
  }
  const sent: string[] = [];
  const jobs = new ReviewAgentJobs({
    recordsDir: records,
    createAdapter: () => {
      const adapter = new PresentationAdapter({ deltaMs });
      const send = adapter.send.bind(adapter);
      adapter.send = (sessionId: string, prompt: string) => {
        sent.push(prompt);
        return send(sessionId, prompt);
      };
      return adapter;
    },
    snapshots: new RevisionSnapshots({ root: path.join(records, 'revisions'), log: () => undefined }),
    availability: () => ({ choosable: true, reason: null }),
    pairs,
    language: () => Promise.resolve('en'),
    log: () => undefined,
    loopResources: repoRoot,
    appVersion: 'test',
    cancelConfirmMs: 500,
  });
  const settled = async (jobId: string, timeoutMs = 30_000): Promise<AgentJob> => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const job = (pairs.state(opened.key) as PairRecord).jobs.find((entry) => entry.id === jobId);
      if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`job ${jobId} did not settle`);
  };
  return { key: opened.key, pairs, jobs, sent, records, settled };
}

function taskOf(prompt: string): string {
  return prompt.slice('DSPATCH-REVIEW-TASK:'.length).split('\n')[0]?.trim() ?? '';
}

describe('the walk loop through the job service (SIMULATED)', () => {
  it('plans, writes each step in the writer\'s session, reviews, delivers a definition that opens, and keeps its record', async () => {
    delete process.env['DSPATCH_REVIEW_SIM'];
    const { key, pairs, jobs, sent, records, settled } = await setup('accept');
    const started = jobs.start(key, { kind: 'walks', provider: 'claude', model: 'sim-model', method: 'loop', presentation: { profile: 'pedagog' } });
    assert.ok(!isPairError(started), isPairError(started) ? started.error : '');
    assert.equal(started.method, 'loop');
    assert.ok(started.note.includes('planner, writer and reviewer'));
    assert.equal((pairs.state(key) as PairRecord).generation?.method, 'loop', 'the review records how its walks are being prepared');
    const job = await settled(started.id);
    assert.equal(job.state, 'done', `${job.note} ${job.detail}`);
    assert.ok(job.definitionPath !== null);
    assert.ok(job.loop !== undefined, 'the job keeps the loop\'s summary');
    assert.equal(job.loop.status, 'delivered');
    assert.equal(job.loop.rounds, 0);
    assert.equal(job.loop.first?.verdict, 'accept');
    assert.ok(job.note.includes('accepted the walks at once'), job.note);
    const tasks = sent.map(taskOf);
    assert.equal(tasks[0], 'plan-walks');
    assert.equal(tasks.at(-1), 'review-walks');
    const writes = sent.filter((prompt) => taskOf(prompt) === 'write-step');
    assert.ok(writes.length >= 2, `one writer turn per step: ${String(writes.length)}`);
    assert.ok(writes[0]?.includes('## How to explain the step (Teacher)'), 'the first writer turn carries the profile');
    assert.ok(!writes[1]?.includes('## How to explain the step'), 'a later turn names only its step');
    assert.equal(job.loop.turns.length, sent.length, 'every provider turn is timed');
    assert.ok(fs.existsSync(job.loop.recordPath), 'the run record is on disk under the review');
    assert.ok(job.loop.recordPath.startsWith(path.join(records, 'generated', key)));
    const view = jobs.walkLoopRecord(key, job.id);
    assert.ok(!isPairError(view), isPairError(view) ? view.error : '');
    assert.equal(view.replies.length, sent.length);
    assert.ok(view.replies.every((reply) => reply.prompt.length > 0));
    assert.equal(view.replies[0]?.roleId, 'walk-planner');
    assert.ok(view.complete);
    assert.ok(view.journal.some((entry) => entry.kind === 'edge-taken'));
    const service = new ReviewService({ recordsDir: path.join(records, 'review'), log: () => undefined });
    const shown = await service.openDefinition(job.definitionPath);
    assert.equal(shown.kind, 'opened', shown.kind === 'failed' ? shown.error : '');
    const definition = JSON.parse(fs.readFileSync(job.definitionPath, 'utf8')) as { provenance: { en: string }; presentation: { profile: string; version: number }; walks: { steps: { body: { en: string }; details?: { en: string } }[] }[] };
    assert.ok(definition.provenance.en.includes('planner, writer and reviewer loop'));
    assert.ok(definition.provenance.en.includes('approves nothing of the code'));
    assert.equal(definition.presentation.profile, 'pedagog');
    const firstStep = definition.walks[0]?.steps[0];
    assert.ok(firstStep?.body.en.startsWith('SIMULATED Teacher explanation of W1.1'), firstStep?.body.en);
    assert.ok(firstStep?.details?.en.startsWith('SIMULATED deepening (Teacher)'), 'what the writer put after the marker is the step\'s details');
  });

  it('runs one correction round to the writer and records the final assessment\'s objections', async () => {
    process.env['DSPATCH_REVIEW_SIM'] = 'loop-rework';
    try {
      const { key, jobs, sent, settled } = await setup('rework');
      const started = jobs.start(key, { kind: 'walks', provider: 'claude', model: 'sim-model', method: 'loop', presentation: { profile: 'standard' } });
      assert.ok(!isPairError(started));
      const job = await settled(started.id);
      assert.equal(job.state, 'done', `${job.note} ${job.detail}`);
      assert.equal(job.loop?.status, 'delivered-with-objections');
      assert.equal(job.loop?.rounds, 1);
      assert.equal(job.loop?.replanned, false);
      assert.deepEqual(job.loop?.rewritten, ['W1.1']);
      assert.equal(job.loop?.first?.verdict, 'rework');
      assert.equal(job.loop?.final?.verdict, 'objections');
      assert.equal(job.loop?.final?.findings.length, 1);
      assert.ok(job.note.includes('asked for one correction') && job.note.includes('1 objection(s) remain'), job.note);
      assert.equal(sent.filter((prompt) => taskOf(prompt) === 'review-walks').length, 2);
      const rewrite = sent.filter((prompt) => taskOf(prompt) === 'write-step').at(-1);
      assert.ok(rewrite?.includes("## The reviewer's findings about this step"));
      assert.ok(sent.at(-1)?.includes('## The final assessment'));
      const definition = JSON.parse(fs.readFileSync(job.definitionPath ?? '', 'utf8')) as { provenance: { en: string }; walks: { steps: { body: { en: string } }[] }[] };
      assert.ok(definition.provenance.en.includes('one correction round went to the writer'));
      assert.ok(definition.walks[0]?.steps[0]?.body.en.includes('written again'), 'the delivered text is the rewritten one');
    } finally {
      delete process.env['DSPATCH_REVIEW_SIM'];
    }
  });

  it('sends a structural finding to the planner and accepts the replanned walks', async () => {
    process.env['DSPATCH_REVIEW_SIM'] = 'loop-replan';
    try {
      const { key, jobs, sent, settled } = await setup('replan');
      const started = jobs.start(key, { kind: 'walks', provider: 'claude', model: 'sim-model', method: 'loop' });
      assert.ok(!isPairError(started));
      const job = await settled(started.id);
      assert.equal(job.state, 'done', `${job.note} ${job.detail}`);
      assert.equal(job.loop?.replanned, true);
      assert.equal(job.loop?.rounds, 1);
      assert.equal(job.loop?.final?.verdict, 'accept');
      assert.equal(sent.filter((prompt) => taskOf(prompt) === 'plan-walks').length, 2);
      assert.ok(sent.filter((prompt) => taskOf(prompt) === 'plan-walks')[1]?.includes("## The reviewer's findings about the structure"));
    } finally {
      delete process.env['DSPATCH_REVIEW_SIM'];
    }
  });

  it('is refused without the loop resources, and the one call still runs', async () => {
    const { key, pairs, jobs, settled } = await setup('refused');
    const without = new ReviewAgentJobs({
      recordsDir: path.join(root, 'refused', 'records'),
      createAdapter: () => new PresentationAdapter({ deltaMs: 1 }),
      snapshots: new RevisionSnapshots({ root: path.join(root, 'refused', 'records', 'revisions'), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
    });
    const refused = without.start(key, { kind: 'walks', provider: 'claude', model: 'sim-model', method: 'loop' });
    assert.ok(isPairError(refused) && refused.error.includes('not available in this installation'));
    const unknown = jobs.start(key, { kind: 'walks', provider: 'claude', model: 'sim-model', method: 'sideways' });
    assert.ok(isPairError(unknown) && unknown.error.includes('Unknown way'));
    const single = jobs.start(key, { kind: 'walks', provider: 'claude', model: 'sim-model' });
    assert.ok(!isPairError(single));
    assert.equal(single.method, 'single');
    const job = await settled(single.id);
    assert.equal(job.state, 'done', job.note);
    assert.equal(job.loop, undefined);
  });

  it('stops when asked, without a resend, and writes no definition', async () => {
    const { key, jobs, sent, settled } = await setup('cancel', 40);
    const started = jobs.start(key, { kind: 'walks', provider: 'claude', model: 'sim-model', method: 'loop' });
    assert.ok(!isPairError(started));
    const until = Date.now() + 10_000;
    while (Date.now() < until && sent.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const sentBefore = sent.length;
    const answer = await jobs.cancel(key, started.id);
    assert.ok(!isPairError(answer));
    const job = await settled(started.id);
    assert.equal(job.state, 'cancelled', `${job.note} ${job.detail}`);
    assert.equal(job.definitionPath, null);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(sent.length <= sentBefore + 1, 'at most the turn in flight; nothing is resent');
    assert.ok(!jobs.working());
  });

  it('writes nothing back once its review was deleted while it ran', async () => {
    const { key, pairs, jobs, sent, records } = await setup('deleted', 40);
    const started = jobs.start(key, { kind: 'walks', provider: 'claude', model: 'sim-model', method: 'loop' });
    assert.ok(!isPairError(started));
    const until = Date.now() + 10_000;
    while (Date.now() < until && sent.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const removed = pairs.remove(key);
    assert.ok(!isPairError(removed));
    await jobs.forgetReview(key);
    const generated = path.join(records, 'generated', key);
    fs.rmSync(generated, { recursive: true, force: true });
    const end = Date.now() + 10_000;
    while (Date.now() < end && jobs.working()) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(!jobs.working(), 'the job ended');
    assert.ok(!fs.existsSync(generated), 'nothing recreated the deleted review\'s folder');
    assert.ok(!pairs.holds(key));
  });
});
