/**
 * DSP-185 extension: the synthetic caller-with-two-new-functions case, prepared end to end by
 * the host's job service with the presentation adapter (SIMULATED answers) over a real Git
 * repository, then opened as the walk window opens it.
 *
 * What this establishes is DSpatch's handling of the structure: the simulated walk is a caller
 * step, then each new function it calls as its own step reached from the call, with no step
 * that revisits the caller only as transport, nothing for the repair round, and each place a
 * pane of its own although all three are in one file. It says nothing about how a real model
 * judges which implementation is central; that needs a real generated walk.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { ReviewAgentJobs } from '../src/host/review-agent-jobs';
import { ReviewPairs } from '../src/host/review-pairs';
import { RevisionSnapshots } from '../src/host/revision-snapshots';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { ReviewService } from '../src/main/review-service';
import { panesOf } from '../src/renderer/walk-panes';
import { isPairError, type AgentJob, type PairRecord } from '../src/shared/review-pair';
import { WORKER_CASE, makeSyntheticRepo } from './support/synthetic-walks';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-synthetic-walks-'));

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('the synthetic caller with two new functions (DSP-185, SIMULATED)', () => {
  it('is walked caller, first function, second function: three steps, three panes in one file, no transport step', async () => {
    const workspace = path.join(root, 'workspace');
    const { repo, base, target } = makeSyntheticRepo(workspace, WORKER_CASE);
    const records = path.join(root, 'records');
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
        const adapter = new PresentationAdapter({ deltaMs: 1 });
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
    });
    const started = jobs.start(opened.key, { kind: 'walks', provider: 'cursor', model: 'sim-model' });
    assert.ok(!isPairError(started));
    let job: AgentJob | undefined;
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      job = (pairs.state(opened.key) as PairRecord).jobs.find((entry) => entry.id === started.id);
      if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job?.state, 'done', job?.note);
    assert.equal(sent.length, 1, 'nothing for the repair round');
    assert.ok(job?.definitionPath != null);

    const service = new ReviewService({ recordsDir: path.join(records, 'review'), log: () => undefined });
    const shown = await service.openDefinition(job.definitionPath);
    assert.equal(shown.kind, 'opened', shown.kind === 'failed' ? shown.error : '');
    if (shown.kind !== 'opened') {
      return;
    }
    const walk = shown.bundle.definition.walks.find((entry) => entry.steps.some((step) => step.places.some((place) => place.focus.path === 'src/worker.js')));
    assert.ok(walk !== undefined);
    const steps = walk.steps.map((step) => ({ title: step.title.en, places: step.places.map((place) => `${place.focus.path}:${String(place.focus.start)}-${String(place.focus.end)}`), from: step.places[0]?.from?.ref.start ?? null }));
    assert.deepEqual(
      steps.map((step) => step.title),
      ['Changed lines 2–3', 'What startWorker does', 'What subscribeToPairs does'],
      JSON.stringify(steps),
    );
    assert.ok(steps.every((step) => step.places.length === 1));
    assert.deepEqual([steps[1]?.from, steps[2]?.from], [2, 2], 'each function is reached from the call in the caller');
    assert.equal(new Set(steps.map((step) => step.places[0])).size, steps.length, 'no place is visited twice');
    // Each place its own pane, though all three are in one file and within the old shared change area.
    const files = new Map(shown.bundle.files.map((file) => [file.path, file]));
    const panes = panesOf(
      walk.steps.map((step) => step.places[0]?.focus ?? { path: '', side: 'target', start: 0, end: 0 }),
      (filePath) => files.get(filePath) ?? null,
    );
    assert.deepEqual(panes.map((pane) => [...pane.stations]), [[0], [1], [2]]);
    // The other file's change is a walk of its own, for a link between walks.
    assert.ok(shown.bundle.definition.walks.some((other) => other !== walk && other.steps.some((step) => step.places.some((place) => place.focus.path === 'src/format.js'))));
  });
});
