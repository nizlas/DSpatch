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

import { ReviewAgentJobs, writingNow } from '../src/host/review-agent-jobs';
import { ReviewPairs } from '../src/host/review-pairs';
import { RevisionSnapshots } from '../src/host/revision-snapshots';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { checksFileOf, parseReviewDefinition, stepsWalks } from '../src/shared/review-model';
import { answerJson, definitionFrom, readChecksAnswer, readReviewAnswer, readWalksAnswer, walksPrompt, withoutInvalidPlaces } from '../src/shared/review-agent';
import { fileProgressOf, isPairError, lineStatusesOf, lineKey, type AgentJob, type OpenPair, type PairRecord } from '../src/shared/review-pair';
import { makePairFixture, PAIR_WORKING_TREE_ONLY, type PairFixture } from './support/pair-fixture';

let fixture: PairFixture;
let records: string;
let pairs: ReviewPairs;
let open: OpenPair;
let sent: string[];
/** Every record the host told the windows about, as the host event path carries it. */
const told: PairRecord[] = [];

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
    snapshots: new RevisionSnapshots({ root: path.join(records, 'revisions'), log: () => undefined }),
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
  pairs = new ReviewPairs({
    recordsDir: path.join(records, 'pairs'),
    changed: (_key, record) => {
      told.push(record);
    },
  });
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
    const prompt = walksPrompt(material, { base: open.pair.base, target: open.pair.target, files: 0, skipped: [], skippedCount: 0 }, 'en');
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
    assert.match(job.note, /changed line\(s\) are in none of them/);
    // Niclas's trial feedback (29 October 2026): text gets readings, code gets walks, and
    // the summary is not repeated as the background (Show more must show more).
    const definition = parsed.definition;
    assert.ok(definition !== null);
    const kinds = definition.walks.map((walk) => `${walk.id}:${walk.kind}`);
    assert.ok(kinds.some((entry) => /^R\d+:reading$/.test(entry)) && kinds.some((entry) => /^W\d+:walk$/.test(entry)), kinds.join(', '));
    assert.notEqual(definition.overview.en, definition.overviewSummary.en);
    assert.ok(definition.overview.en.startsWith(definition.overviewSummary.en));
    // The walks come without points worth checking (30 October 2026): those are asked for on their own.
    assert.deepEqual(definition.checks, []);
    assert.equal(definition.attention.en, '');
    assert.doesNotMatch(sent[0] ?? '', /"checks"|## Worth checking/);
    assert.match(sent[0] ?? '', /A \*\*reading\*\*/);
    assert.match(sent[0] ?? '', /Never invent a direction or a call chain/);
  });

  it('finds what is worth checking on its own, over the walks as written, beside their definition', async () => {
    const walksJob = (pairs.state(open.key) as PairRecord).jobs.find((entry) => entry.kind === 'walks' && entry.state === 'done');
    assert.ok(walksJob?.definitionPath != null);
    const definitionPath = walksJob.definitionPath;
    const before = fs.readFileSync(definitionPath, 'utf8');
    sent = [];
    const started = jobs().start(open.key, { kind: 'checks', provider: 'cursor', model: 'sim-model', definitionPath });
    assert.ok(!isPairError(started));
    const job = await settled(open.key, started.id);
    assert.equal(job.state, 'done', job.note);
    assert.equal(job.definitionPath, path.resolve(definitionPath));
    assert.equal(job.activity, undefined, 'what it was doing is not kept once it ended');
    assert.match(job.note, /^2 point\(s\) worth checking: 1 question\(s\), 1 uncertainty, 0 finding\(s\)\./);
    // Asked with the walks as written, and their step ids to link to.
    assert.match(sent[0] ?? '', /## The walks the person has\n### [WR]1: /);
    assert.match(sent[0] ?? '', /\n- W1\.1 /);
    assert.match(sent[0] ?? '', /Never link a step only because it is in the same file/);
    // Kept beside the walks: the definition itself, and so the review's record of it, is unchanged.
    assert.equal(fs.readFileSync(definitionPath, 'utf8'), before);
    const kept = JSON.parse(fs.readFileSync(checksFileOf(definitionPath), 'utf8')) as { format: string; checks: unknown[] };
    assert.equal(kept.format, 'dspatch-checks/1');
    const parsed = parseReviewDefinition({ ...(JSON.parse(before) as Record<string, unknown>), checks: kept.checks });
    assert.deepEqual(parsed.problems, []);
    const definition = parsed.definition;
    assert.ok(definition !== null);
    // One at its step, one with its own tour; both point at code that exists, and the tour covers nothing.
    const linked = definition.checks.find((check) => check.stepId !== null);
    const toured = definition.checks.find((check) => check.tour !== null);
    assert.ok(linked !== undefined && definition.walks.some((walk) => walk.steps.some((step) => step.id === linked.stepId)), JSON.stringify(definition.checks));
    assert.ok(linked.places.length > 0 && linked.tour === null);
    assert.ok(toured !== undefined && toured.stepId === null && toured.tour?.steps[0]?.id === `${toured.id}.1`);
    assert.ok(toured.tour.steps.every((step) => step.refs.every((ref) => ref.role === 'context')));
    assert.ok(!definition.walks.some((walk) => walk.kind === 'check'), 'a tour is not one of the walks');
    // Walks of other commits, or none, are refused before anything is sent.
    assert.ok(isPairError(jobs().start(open.key, { kind: 'checks', provider: 'cursor', model: 'sim-model', definitionPath: path.join(records, 'nothing.review.json') })));
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

  it('says what it is doing in one line from what is reported, and nothing of it after the end', async () => {
    told.length = 0;
    sent = [];
    // Each simulated tool takes as long as the record's line is held, so each is seen.
    process.env['DSPATCH_PRESENTATION_TOOL_MS'] = '1000';
    const scope = { kind: 'lines', label: 'src/keep.ts added lines', ranges: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: 8, end: 9 }] };
    const started = jobs({ deltaMs: 40 }).start(open.key, { kind: 'review', provider: 'cursor', model: 'sim-model', scope });
    assert.ok(!isPairError(started));
    // A window opened after the job started reads the same line from the host.
    let readLate = '';
    while (readLate === '') {
      readLate = (pairs.state(open.key) as PairRecord).jobs.find((entry) => entry.id === started.id)?.activity ?? '';
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const job = await settled(open.key, started.id);
    delete process.env['DSPATCH_PRESENTATION_TOOL_MS'];
    assert.equal(job.state, 'done', job.note);
    assert.ok(job.instruction?.startsWith('DSPATCH-REVIEW-TASK:'), 'what the agent was told is on record');
    assert.ok(sent[0]?.startsWith(job.instruction ?? 'x'), 'and it is what was sent, ahead of the material');
    const lines = told.flatMap((record) => record.jobs.filter((entry) => entry.id === started.id).map((entry) => entry.activity ?? ''));
    const said = [...new Set(lines.filter((line) => line !== ''))];
    assert.ok(said.every((line) => /^(Waiting for the agent…|Reading \S+|Searching the code|Writing (its answer|its review|finding \d+))$/.test(line)), said.join(' | '));
    assert.equal(said[0], 'Waiting for the agent…');
    assert.ok(said.some((line) => line.startsWith('Reading ')), said.join(' | '));
    const last = told[told.length - 1]?.jobs.find((entry) => entry.id === started.id);
    assert.equal(last?.state, 'done');
    assert.ok(last !== undefined && !('activity' in last), 'the event that ends it carries no activity for a window to keep');
  });

  it('leaves no activity line once a stop is asked for, in the event or after it', async () => {
    told.length = 0;
    const scope = { kind: 'lines', label: 'src/keep.ts stop', ranges: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: 8, end: 9 }] };
    const running = jobs({ deltaMs: 40 });
    const started = running.start(open.key, { kind: 'review', provider: 'cursor', model: 'sim-model', scope });
    assert.ok(!isPairError(started));
    while ((pairs.state(open.key) as PairRecord).jobs.find((entry) => entry.id === started.id)?.activity === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await running.cancel(open.key, started.id);
    await settled(open.key, started.id);
    const after = told.flatMap((record) => record.jobs.filter((entry) => entry.id === started.id && entry.state !== 'running'));
    assert.ok(after.length > 0 && after.every((entry) => !('activity' in entry)), JSON.stringify(after.map((entry) => [entry.state, entry.activity])));
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

describe('points worth checking (30 October 2026)', () => {
  const place = { label: 'p', path: 'src/a.ts', side: 'target', start: 1, end: 1 };
  const answer = {
    summary: 's',
    walks: [
      { title: 'w1', steps: [{ title: 's1', body: 'b', places: [{ ...place, start: 9999 }] }] },
      { title: 'w2', steps: [{ title: 's1', body: 'b', places: [place] }, { title: 's2', body: 'b', places: [place] }] },
    ],
    checks: [
      { kind: 'finding', title: 'Linked', places: [place], step: { walk: 1, step: 1 } },
      { kind: 'question', title: 'Out of range', places: [place], step: { walk: 7, step: 0 } },
      { kind: 'nonsense', title: 'On a dropped step', places: [place], step: { walk: 0, step: 0 } },
      { title: '' },
    ],
  };

  it('reads them with their kind and step, and links nothing a step index does not name', () => {
    const read = readWalksAnswer(answer);
    assert.deepEqual(
      read.walks?.checks.map((check) => [check.title, check.kind, check.step]),
      [
        ['Linked', 'finding', { walk: 1, step: 1 }],
        ['Out of range', 'question', null],
        ['On a dropped step', 'question', { walk: 0, step: 0 }],
      ],
    );
    assert.ok(read.problems.some((problem) => problem.includes('check 4 has no title')));
  });

  it('follows a step when walks are dropped, and drops a link whose step went', () => {
    const read = readWalksAnswer(answer);
    assert.ok(read.walks !== null);
    // The first walk's only place does not exist: that walk goes, and the second becomes W1.
    const kept = withoutInvalidPlaces(read.walks, new Map([['0.0.0', 'gone']]));
    assert.deepEqual(kept.checks.map((check) => check.step), [{ walk: 0, step: 1 }, null, null]);
    const definition = parseReviewDefinition(definitionFrom(kept, { repository: 'r', base: 'a'.repeat(40), target: 'b'.repeat(40) }, 'h', 'p')).definition;
    assert.ok(definition !== null);
    assert.equal(definition.checks[0]?.stepId, 'W1.2');
    assert.equal(definition.checks[0]?.kind, 'finding');
    assert.equal(definition.checks[1]?.tour?.steps[0]?.places[0]?.focus.role, 'context');
    assert.deepEqual(stepsWalks(definition).map((walk) => walk.id), ['W1', 'C2', 'C3']);
  });

  it('keeps an older answer\'s attention as text, and makes no links for it', () => {
    const read = readWalksAnswer({ summary: 's', attention: ['Something to look at.'], walks: answer.walks.slice(1) });
    assert.ok(read.walks !== null);
    const definition = parseReviewDefinition(definitionFrom(read.walks, { repository: 'r', base: 'a'.repeat(40), target: 'b'.repeat(40) }, 'h', 'p')).definition;
    assert.equal(definition?.attention.en, '- Something to look at.');
    assert.deepEqual(definition?.checks, []);
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

describe('the agent and model (after the first live trial)', () => {
  // A pair record of its own, so the choice made by the tests above is not in it.
  async function freshPair(): Promise<{ readonly pairs: ReviewPairs; readonly key: string; readonly dir: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-agent-choice-'));
    const own = new ReviewPairs({ recordsDir: path.join(dir, 'pairs'), changed: () => undefined });
    await own.repositories([fixture.workspace]);
    const opened = await own.openPair({ repository: fixture.app, base: fixture.appBase, target: fixture.appTarget });
    if (isPairError(opened)) {
      throw new Error(opened.error);
    }
    return { pairs: own, key: opened.key, dir };
  }

  function service(
    own: ReviewPairs,
    dir: string,
    built: string[],
    options: { readonly failStart?: string; readonly claude?: boolean } = {},
  ): ReviewAgentJobs {
    return new ReviewAgentJobs({
      recordsDir: dir,
      createAdapter: (provider) => {
        built.push(provider);
        const adapter = new PresentationAdapter({ deltaMs: 1 });
        if (options.failStart !== undefined) {
          const message = options.failStart;
          adapter.startSession = () => Promise.reject(new Error(message));
        }
        return adapter;
      },
      snapshots: new RevisionSnapshots({ root: path.join(dir, 'revisions'), log: () => undefined }),
      availability: (provider) =>
        provider === 'claude' && options.claude === false
          ? { choosable: false, reason: 'Claude is not enabled for this launch.' }
          : { choosable: true, reason: null },
      pairs: own,
      language: () => Promise.resolve('en'),
      log: () => undefined,
      cancelConfirmMs: 500,
    });
  }

  it('an opener on the provider\'s default keeps its agent, with no model named', async () => {
    const { pairs: own, key, dir } = await freshPair();
    const jobsHere = service(own, dir, []);
    for (const provider of ['claude', 'copilot'] as const) {
      for (const model of ['', 'default']) {
        const opened = jobsHere.agents(key, { provider, model });
        assert.ok(!isPairError(opened));
        assert.deepEqual(opened.current, { provider, model: '', from: 'opener', choosable: true, reason: null });
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("starts from the opener's agent and model, and from the review's own choice once one is made", async () => {
    const { pairs: own, key, dir } = await freshPair();
    const built: string[] = [];
    const jobsHere = service(own, dir, built);
    assert.deepEqual(jobsHere.agents(key, { provider: null, model: '' }), {
      options: [
        { provider: 'claude', choosable: true, reason: null },
        { provider: 'copilot', choosable: true, reason: null },
        { provider: 'cursor', choosable: true, reason: null },
      ],
      current: null,
    });
    const opened = jobsHere.agents(key, { provider: 'claude', model: 'claude-opus-4-5' });
    assert.ok(!isPairError(opened));
    assert.deepEqual(opened.current, { provider: 'claude', model: 'claude-opus-4-5', from: 'opener', choosable: true, reason: null });
    assert.deepEqual(built, [], 'reading the choice builds no adapter');

    const started = jobsHere.start(key, { kind: 'walks', provider: 'claude', model: 'claude-sonnet-4-5' });
    assert.ok(!isPairError(started));
    assert.equal((own.state(key) as PairRecord).agent?.model, 'claude-sonnet-4-5');
    await jobsHere.cancel(key, started.id).catch(() => undefined);
    await (async () => {
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        const job = (own.state(key) as PairRecord).jobs.find((entry) => entry.id === started.id);
        if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    })();
    // Stopped at once, it may end while the revisions are being written, before any
    // adapter exists (DSP-152); if one was built, it was the chosen agent's.
    assert.ok(built.every((provider) => provider === 'claude'), `only the chosen agent was built: ${JSON.stringify(built)}`);
    // The choice made in the review wins over the opener's from now on.
    const later = jobsHere.agents(key, { provider: 'claude', model: 'claude-opus-4-5' });
    assert.ok(!isPairError(later));
    assert.deepEqual(later.current, { provider: 'claude', model: 'claude-sonnet-4-5', from: 'review', choosable: true, reason: null });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('shows an unusable choice with its reason rather than picking another agent', async () => {
    const { pairs: own, key, dir } = await freshPair();
    const answer = service(own, dir, [], { claude: false }).agents(key, { provider: 'claude', model: 'claude-opus-4-5' });
    assert.ok(!isPairError(answer));
    assert.equal(answer.current?.provider, 'claude');
    assert.equal(answer.current?.choosable, false);
    assert.equal(answer.current?.reason, 'Claude is not enabled for this launch.');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records a start failure briefly, keeps the raw text as detail, approves nothing and tries no other agent', async () => {
    const { pairs: own, key, dir } = await freshPair();
    const built: string[] = [];
    const raw = 'UnknownAgentError: [plan_required] Cloud Agent is not available for free users.';
    const jobsHere = service(own, dir, built, { failStart: raw });
    const scope = { kind: 'file', label: 'src/keep.ts', ranges: [{ kind: 'lines', side: 'target', path: 'src/keep.ts', start: 8, end: 9 }] };
    const started = jobsHere.start(key, { kind: 'review', provider: 'claude', model: 'claude-opus-4-5', scope });
    assert.ok(!isPairError(started));
    const until = Date.now() + 15_000;
    let job: AgentJob | undefined;
    while (Date.now() < until) {
      job = (own.state(key) as PairRecord).jobs.find((entry) => entry.id === started.id);
      if (job !== undefined && job.state !== 'running') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job?.state, 'failed');
    assert.equal(job?.note, 'Claude could not start a session with claude-opus-4-5. Nothing was sent, and nothing was approved.');
    assert.equal(job?.detail, raw);
    assert.deepEqual(built, ['claude']);
    assert.equal((own.state(key) as PairRecord).agentReviews.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('what the agent is doing, and points read on their own', () => {
  it('says which part of its answer it writes, from the answer so far, and nothing else', () => {
    assert.equal(writingNow('walks', 'I looked. ```json\n{"summary": "It saves'), 'Writing the summary of the change');
    assert.equal(writingNow('walks', '{"summary": "x", "walks": [{"kind": "walk", "steps": [{"places": []}, {"places": [] }]}, {"kind": "reading"'), 'Writing walk 2 · 2 step(s) so far');
    assert.equal(writingNow('checks', '{"checks": [{"reasoning": "a"}, {"title": "b", "reasoning": "'), 'Writing point 2 worth checking');
    assert.equal(writingNow('checks', 'Looking at it.'), 'Writing its answer');
    assert.equal(writingNow('explain', '{"answer": "'), 'Writing the explanation');
    assert.equal(writingNow('review', 'Looking at it.'), 'Writing its answer');
    assert.equal(writingNow('review', '{"summary": "'), 'Writing its review');
    assert.equal(writingNow('review', '{"findings": [{"severity": "note"}, {"severity": "problem"'), 'Writing finding 2');
  });

  it('keeps a step only when it is one of the walks, and never guesses one', () => {
    const read = readChecksAnswer(
      { checks: [{ kind: 'finding', title: 'A', places: [], step: 'W1.1' }, { kind: 'odd', title: 'B', places: [], step: 'W9.9' }, { title: '' }] },
      new Set(['W1.1']),
    );
    assert.deepEqual(read.checks?.map((check) => [check.kind, check.title, check.stepId]), [['finding', 'A', 'W1.1'], ['question', 'B', null]]);
    assert.deepEqual(read.problems, ['check 3 has no title.']);
    assert.equal(readChecksAnswer({ walks: [] }, new Set()).checks, null);
  });
});
