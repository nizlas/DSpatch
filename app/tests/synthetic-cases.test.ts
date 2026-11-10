/**
 * DSP-189: the three further synthetic cases (a simple setting, a shared snapshot, external code
 * context) prepared by the walk loop through the host's job service with the presentation adapter
 * (SIMULATED answers) over real Git repositories. What this establishes is DSpatch's handling: the
 * loop runs over TypeScript, C++ and a two-repository workspace, each prepared walk opens, and for
 * the context case the library is written beside the revisions at the commit the app's
 * package.json names and described to every role. It says nothing about what a real model writes
 * for these cases; that is the evaluation outside this suite.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { ReviewContexts } from '../src/host/context-repositories';
import { ReviewAgentJobs } from '../src/host/review-agent-jobs';
import { ReviewPairs } from '../src/host/review-pairs';
import { RevisionSnapshots } from '../src/host/revision-snapshots';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { ReviewService } from '../src/main/review-service';
import { isPairError, type AgentJob, type PairRecord } from '../src/shared/review-pair';
import { CONTEXT_CASE, SETTING_CASE, SNAPSHOT_CASE, makeContextRepos } from './support/synthetic-cases-more';
import { makeSyntheticRepo, type SyntheticCase } from './support/synthetic-walks';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-synthetic-cases-'));

after(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

async function prepared(name: string, repo: { readonly workspace: string; readonly repo: string; readonly base: string; readonly target: string; readonly lib?: string }, method: 'single' | 'loop') {
  const records = path.join(root, name, `records-${method}`);
  const pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs'), changed: () => undefined });
  await pairs.repositories([repo.workspace]);
  const opened = await pairs.openPair({ repository: repo.repo, base: repo.base, target: repo.target });
  if (isPairError(opened)) {
    throw new Error(opened.error);
  }
  const sent: string[] = [];
  const contexts =
    repo.lib === undefined
      ? undefined
      : new ReviewContexts({
          recordsDir: path.join(records, 'context'),
          workspace: () =>
            Promise.resolve({
              folders: [repo.workspace],
              repositories: [
                { name: path.basename(repo.repo), path: repo.repo },
                { name: 'count-lib', path: repo.lib ?? '' },
              ],
            }),
          log: () => undefined,
        });
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
    loopResources: repoRoot,
    appVersion: 'test',
    ...(contexts === undefined ? {} : { contexts }),
  });
  const started = jobs.start(opened.key, { kind: 'walks', provider: 'claude', model: 'sim-model', method, presentation: { profile: 'standard' } });
  if (isPairError(started)) {
    throw new Error(started.error);
  }
  const until = Date.now() + 40_000;
  let job: AgentJob | undefined;
  while (Date.now() < until) {
    job = (pairs.state(opened.key) as PairRecord).jobs.find((entry) => entry.id === started.id);
    if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(job?.state, 'done', `${name}/${method}: ${job?.note ?? ''} ${job?.detail ?? ''}`);
  assert.ok(job?.definitionPath != null);
  const service = new ReviewService({ recordsDir: path.join(records, 'review'), log: () => undefined });
  const shown = await service.openDefinition(job.definitionPath);
  assert.equal(shown.kind, 'opened', shown.kind === 'failed' ? shown.error : '');
  return { job, sent, definition: JSON.parse(fs.readFileSync(job.definitionPath, 'utf8')) as { walks: { steps: { body: { en: string }; places: unknown[] }[] }[] } };
}

function simpleCase(which: SyntheticCase) {
  const workspace = path.join(root, which.name, 'workspace');
  return { workspace, ...makeSyntheticRepo(workspace, which) };
}

describe('the further synthetic cases through the walk loop (SIMULATED)', () => {
  it('a simple setting: declared, passed on and used, walked by the loop and by one call', async () => {
    const repo = simpleCase(SETTING_CASE);
    const loop = await prepared('setting', repo, 'loop');
    assert.equal(loop.job.loop?.status, 'delivered');
    const steps = loop.definition.walks.flatMap((walk) => walk.steps);
    assert.ok(steps.length >= 3, `three places for declaring, passing and using: ${String(steps.length)}`);
    assert.ok(steps.every((step) => step.body.en.startsWith('SIMULATED Standard explanation of')), 'every step has the writer\'s text');
    const single = await prepared('setting', repo, 'single');
    assert.equal(single.job.loop, undefined);
    assert.equal(single.definition.walks.flatMap((walk) => walk.steps).length, steps.length, 'the same places from the same simulated plan, whichever path wrote the texts');
  });

  it('a shared snapshot in C++: the slot, the writer and the reader thread, walked by the loop', async () => {
    const repo = simpleCase(SNAPSHOT_CASE);
    const loop = await prepared('snapshot', repo, 'loop');
    assert.equal(loop.job.loop?.status, 'delivered');
    const planner = loop.sent[0] ?? '';
    assert.ok(planner.includes('include/snapshot_slot.h') && planner.includes('src/consumer.cpp'), 'the planner is given the whole change across the three files');
    assert.ok(loop.definition.walks.flatMap((walk) => walk.steps).length >= 3);
  });

  it('external context: the library is written at the declared version beside the revisions and described to every role', async () => {
    const repo = makeContextRepos(path.join(root, 'context', 'workspace'));
    const loop = await prepared('context', repo, 'loop');
    assert.equal(loop.job.loop?.status, 'delivered');
    const planner = loop.sent[0] ?? '';
    assert.ok(planner.includes('count-lib'), 'the planner\'s prompt names the context repository');
    assert.ok(planner.includes(repo.libTagged.slice(0, 7)) || planner.includes('1.0.0'), 'the planner is told which commit of the library it reads');
    const writerFirst = loop.sent.find((prompt) => prompt.startsWith('DSPATCH-REVIEW-TASK: write-step')) ?? '';
    assert.ok(writerFirst.includes('count-lib'), 'the writer\'s first turn carries the same folder section');
    const reviewer = loop.sent.find((prompt) => prompt.startsWith('DSPATCH-REVIEW-TASK: review-walks')) ?? '';
    assert.ok(reviewer.includes('count-lib'), 'the reviewer reads the same context');
    const material = loop.job.material;
    assert.ok(material !== undefined);
    const contextFolder = fs.readdirSync(path.dirname(loop.job.definitionPath ?? ''));
    assert.ok(contextFolder.some((name) => name.endsWith('.walk-loop')), 'the run\'s record folder sits beside the definition');
  });
});
