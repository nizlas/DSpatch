import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { COPILOT_ANALYSIS_POLICY, CopilotSdkAdapter } from '../src/adapter/copilot-sdk-adapter.ts';
import { ReviewAgentJobs } from '../src/host/review-agent-jobs.ts';
import { ReviewPairs } from '../src/host/review-pairs.ts';
import { RevisionSnapshots } from '../src/host/revision-snapshots.ts';
import { isPairError, type AgentJob, type OpenPair, type PairRecord } from '../src/shared/review-pair.ts';
import { startStandInModel, type StandInModel } from './support/copilot-stand-in-model.ts';
import { makePairFixture, type PairFixture } from './support/pair-fixture.ts';

/*
 * The real job service, the real Copilot adapter and runtime, and a local stand-in model
 * (DSP-148): the two revisions written to a folder, the agent reading there with the runtime's
 * own view, the answer checked against Git, and a stop. No account and no model. What a real
 * Copilot model writes is not shown here.
 */

let fixture: PairFixture;
let model: StandInModel;
let dir: string;
let pairs: ReviewPairs;
let opened: OpenPair;
let home: string;

function service(): ReviewAgentJobs {
  return new ReviewAgentJobs({
    recordsDir: dir,
    createAdapter: () =>
      new CopilotSdkAdapter({
        policy: COPILOT_ANALYSIS_POLICY,
        env: { ...process.env, COPILOT_HOME: home },
        testProvider: { type: 'openai', baseUrl: model.baseUrl, apiKey: 'stand-in' },
      }),
    snapshots: new RevisionSnapshots({ root: path.join(dir, 'revisions'), log: () => undefined }),
    availability: () => ({ choosable: true, reason: null }),
    pairs,
    language: () => Promise.resolve('en'),
    log: () => undefined,
  });
}

async function settled(key: string, id: string): Promise<AgentJob> {
  const until = Date.now() + 40_000;
  while (Date.now() < until) {
    const job = (pairs.state(key) as PairRecord).jobs.find((entry) => entry.id === id);
    if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the job did not settle');
}

describe('review jobs through the Copilot runtime with a stand-in model', { timeout: 120_000 }, () => {
  before(async () => {
    fixture = await makePairFixture();
    model = await startStandInModel();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-jobs-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-jobs-home-'));
    pairs = new ReviewPairs({ recordsDir: path.join(dir, 'pairs'), changed: () => undefined });
    await pairs.repositories([fixture.workspace]);
    const answer = await pairs.openPair({ repository: fixture.app, base: fixture.appBase, target: fixture.appTarget });
    if (isPairError(answer)) {
      throw new Error(answer.error);
    }
    opened = answer;
  });

  after(async () => {
    await model.close();
    for (const folder of [dir, home]) {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  it('prepares walks: the agent reads the snapshot with its own tool, and the answer is checked', async () => {
    const jobs = service();
    const walks = { summary: 'A small change.', walks: [{ kind: 'walk', title: 'The change', steps: [{ title: 'Keep', body: 'It stays.', places: [{ path: 'src/keep.ts', side: 'target', start: 1, end: 1, note: 'here' }] }] }] };
    const started = jobs.start(opened.key, { kind: 'walks', provider: 'copilot', model: 'stand-in' });
    assert.ok(!isPairError(started));
    // The runtime reads what the job's prompt names; the folder is the session's working one.
    model.script({ tool: 'view', args: { path: path.join('target', 'src', 'keep.ts') } }, { text: `\`\`\`json\n${JSON.stringify(walks)}\n\`\`\`` });
    const job = await settled(opened.key, started.id);
    assert.equal(job.state, 'done', JSON.stringify(job));
    assert.ok((job.investigation?.reads ?? []).some((file) => file.replaceAll('\\', '/').includes('src/keep.ts')), JSON.stringify(job.investigation));
    assert.equal(job.investigation?.refused, 0);
    await jobs.dispose();
  });

  it("a stop during the job ends as cancelled, on the runtime's word", async () => {
    const jobs = service();
    model.script({ hang: true });
    const started = jobs.start(opened.key, { kind: 'walks', provider: 'copilot', model: 'stand-in' });
    assert.ok(!isPairError(started));
    const asked = model.requests.length;
    for (const until = Date.now() + 20_000; model.requests.length === asked && Date.now() < until; ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await jobs.cancel(opened.key, started.id);
    const stopped = await settled(opened.key, started.id);
    assert.equal(stopped.state, 'cancelled', JSON.stringify(stopped));
    await jobs.dispose();
  });
});
