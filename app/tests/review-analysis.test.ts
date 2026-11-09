/**
 * DSP-152: the analysis agent's access to the code under review.
 *
 * Over a real Git repository whose change depends on an unchanged definition in another
 * file, beyond any 25-line excerpt, and whose working copy says something else:
 *
 * - The host writes exactly the two commits to a folder of their own, from Git's object
 *   store, and neither reads nor changes the working copy, index, branch or `.git`.
 * - A job runs the real `ClaudeAgentSdkAdapter` under the analysis policy in that folder.
 *   The SDK is substituted (`claude-reading-substitute.ts`): its scripted model makes tool
 *   calls that go through the adapter's own PreToolUse hooks and, when allowed, read the
 *   real files. So what is shown is that the policy and hook the adapter hands Claude Code
 *   let a read of the revisions through and refuse one of the working copy, and that the
 *   files read are the commits'. Not shown: that Claude Code itself honours `tools`,
 *   `allowedTools` and the hook decision (documented by Anthropic; observed only live).
 * - Results are checked against Git, recorded with what was read, and the folder is gone
 *   when the job ends; the walk still opens.
 * - The presentation path (the scenarios' SIMULATED agent) reads the same folder from disk.
 *
 *     node scripts/run-tests.mjs review        (from app/)
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  ANALYSIS_DENY_REASON,
  ANALYSIS_PERMISSIONS,
  ClaudeAgentSdkAdapter,
  REVIEW_PERMISSIONS,
  analysisCallAllowed,
  describePermissionPolicy,
} from '../src/adapter/claude-agent-sdk-adapter';
import { ReviewAgentJobs } from '../src/host/review-agent-jobs';
import { ReviewPairs } from '../src/host/review-pairs';
import { RevisionSnapshots, unwritablePath } from '../src/host/revision-snapshots';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { CURSOR_ANALYSIS_REFUSAL, providerAdapters } from '../src/main/provider-adapters';
import { parseReviewDefinition } from '../src/shared/review-model';
import { isPairError, type AgentJob, type OpenPair, type PairRecord } from '../src/shared/review-pair';
import { DEFINITION_LINE, WORKING_COPY_ONLY, makeAnalysisFixture, workingCopyState, type AnalysisFixture } from './support/analysis-fixture';
import { readingSubstitute, type CallOutcome, type ReadingScript } from './support/claude-reading-substitute';

const CLEAN_ENV = Object.freeze({ PATH: process.env['PATH'] ?? '' });

let fixture: AnalysisFixture;
let records: string;
let pairs: ReviewPairs;
let open: OpenPair;
let before0: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function settled(key: string, jobId: string, timeoutMs = 15_000): Promise<AgentJob> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const job = (pairs.state(key) as PairRecord).jobs.find((entry) => entry.id === jobId);
    if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not settle`);
}

before(async () => {
  fixture = makeAnalysisFixture();
  records = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-analysis-records-'));
  pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs'), changed: () => undefined });
  await pairs.repositories([fixture.workspace]);
  const opened = await pairs.openPair({ repository: fixture.shop, base: fixture.base, target: fixture.target });
  if (isPairError(opened)) {
    throw new Error(opened.error);
  }
  open = opened;
  before0 = workingCopyState(fixture.shop);
});

after(() => {
  fs.rmSync(fixture.workspace, { recursive: true, force: true });
  fs.rmSync(records, { recursive: true, force: true });
  delete process.env['DSPATCH_REVIEW_SIM'];
});

describe('the revisions as files', () => {
  it('are exactly the two commits, with unchanged code beyond the diff, and the working copy is untouched', async () => {
    const snapshots = new RevisionSnapshots({ root: path.join(records, 'revisions-a'), log: () => undefined });
    const snapshot = await snapshots.acquire(open.key, open.pair, { base: new Set(), target: new Set(['src/checkout.ts']) }, 'job-a');
    for (const [side, commit] of [['base', fixture.base], ['target', fixture.target]] as const) {
      const listed = git(fixture.shop, 'ls-tree', '-r', '--name-only', commit).trim().split('\n');
      for (const file of listed) {
        const written = fs.readFileSync(path.join(snapshot.folder, side, ...file.split('/')));
        const committed = execFileSync('git', ['cat-file', 'blob', `${commit}:${file}`], { cwd: fixture.shop });
        assert.ok(written.equals(committed), `${side}/${file} is the commit's bytes`);
      }
      assert.equal(snapshot.manifest[side].files, listed.length);
      assert.equal(snapshot.manifest[side].tree, git(fixture.shop, 'rev-parse', `${commit}^{tree}`).trim());
      assert.equal(fs.existsSync(path.join(snapshot.folder, side, 'src', 'staged.ts')), false, 'nothing staged');
      assert.equal(fs.existsSync(path.join(snapshot.folder, side, 'notes.txt')), false, 'nothing untracked');
    }
    const pricing = fs.readFileSync(path.join(snapshot.folder, 'target', 'src', 'pricing.ts'), 'utf8').split('\n');
    assert.match(pricing[DEFINITION_LINE - 1] ?? '', /^export function findDiscount/, 'the unchanged definition, where the commit has it');
    assert.ok(!pricing.join('\n').includes(WORKING_COPY_ONLY));
    assert.equal(workingCopyState(fixture.shop), before0, 'working copy, index, HEAD and worktrees unchanged');
    assert.equal(fs.existsSync(path.join(fixture.shop, '.git', 'worktrees')), false);

    // Shared while held, removed after the last holder.
    const again = await snapshots.acquire(open.key, open.pair, { base: new Set(), target: new Set() }, 'job-b');
    assert.equal(again.folder, snapshot.folder);
    snapshots.release(open.key, 'job-a');
    await snapshots.settled();
    assert.ok(fs.existsSync(snapshot.folder), 'still held by job-b');
    snapshots.release(open.key, 'job-b');
    await snapshots.settled();
    assert.equal(fs.existsSync(snapshot.folder), false, 'removed after its last job');
  });

  it('leaves out what it cannot write as committed, and names it', async () => {
    // A symbolic link and a submodule in a commit of a scratch repository.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-analysis-links-'));
    try {
      git(scratch, 'init', '-q');
      git(scratch, 'config', 'user.email', 'test@example.invalid');
      git(scratch, 'config', 'user.name', 'Test Author');
      fs.writeFileSync(path.join(scratch, 'a.txt'), 'a\n');
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: scratch, input: '../../outside' }).toString().trim();
      git(scratch, 'add', 'a.txt');
      git(scratch, 'update-index', '--add', '--cacheinfo', `120000,${blob},link`);
      git(scratch, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},sub`);
      git(scratch, 'commit', '-q', '-m', 'links');
      const commit = git(scratch, 'rev-parse', 'HEAD').trim();
      const snapshots = new RevisionSnapshots({ root: path.join(records, 'revisions-b'), log: () => undefined });
      const snapshot = await snapshots.acquire('scratch', { repository: scratch, base: commit, target: commit }, { base: new Set(), target: new Set() }, 'job');
      assert.deepEqual(snapshot.manifest.target.skipped.map((entry) => entry.path).sort(), ['link', 'sub']);
      assert.equal(fs.existsSync(path.join(snapshot.folder, 'target', 'link')), false);
      assert.ok(fs.existsSync(path.join(snapshot.folder, 'target', 'a.txt')));
      snapshots.release('scratch', 'job');
      await snapshots.settled();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    assert.match(unwritablePath('src/con.ts', 'win32') ?? '', /Windows/);
    assert.match(unwritablePath('a:b.ts', 'win32') ?? '', /Windows/);
    assert.equal(unwritablePath('src/a:b.ts', 'linux'), null);
    assert.ok(unwritablePath('../x', 'linux') !== null);
  });

  it('removes folders an earlier run left, at start', () => {
    const root = path.join(records, 'revisions-c');
    fs.mkdirSync(path.join(root, 'stale', 'target'), { recursive: true });
    fs.writeFileSync(path.join(root, 'stale', 'target', 'x.ts'), 'x');
    fs.chmodSync(path.join(root, 'stale', 'target', 'x.ts'), 0o444);
    new RevisionSnapshots({ root, log: () => undefined }).sweep();
    assert.deepEqual(fs.readdirSync(root), []);
  });
});

describe('the analysis policy', () => {
  it('offers only reading tools, pre-approves reads in the folder, removes the rest', () => {
    assert.deepEqual([...ANALYSIS_PERMISSIONS.tools], ['Read', 'Glob', 'Grep']);
    assert.deepEqual([...ANALYSIS_PERMISSIONS.allowedTools], ['Read(/**)', 'Glob', 'Grep']);
    for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'Agent', 'WebFetch', 'WebSearch', 'Skill', 'mcp__*']) {
      assert.ok(ANALYSIS_PERMISSIONS.disallowedTools?.includes(tool), tool);
    }
    assert.equal(ANALYSIS_PERMISSIONS.denyEveryTool, undefined, 'not the discussion policy');
    assert.equal(REVIEW_PERMISSIONS.confineToFolders, undefined, 'the discussion keeps its own, tool-free policy');
    assert.match(describePermissionPolicy(ANALYSIS_PERMISSIONS), /tools Read, Glob, Grep; allowed Read\(\/\*\*\), Glob, Grep; disallowed Bash.*a hook denies any other tool and any path outside/);
    const folder = path.resolve(records, 'folder');
    const allow = (name: string, input: Record<string, unknown>): boolean => analysisCallAllowed(name, input, [folder], folder);
    assert.equal(allow('Read', { file_path: path.join(folder, 'target', 'src', 'a.ts') }), true);
    assert.equal(allow('Read', { file_path: 'target/src/a.ts' }), true, 'relative to the folder');
    assert.equal(allow('Read', { file_path: path.join(folder, '..', 'secret') }), false, 'climbing out');
    assert.equal(allow('Read', { file_path: path.join(fixture.shop, 'src', 'pricing.ts') }), false, 'the working copy');
    assert.equal(allow('Read', {}), false);
    assert.equal(allow('Grep', { pattern: 'x' }), true, 'the folder by default');
    assert.equal(allow('Grep', { pattern: 'x', path: fixture.shop }), false);
    assert.equal(allow('Grep', { pattern: 'x', glob: '../**' }), false);
    assert.equal(allow('Glob', { pattern: '**/*.ts', path: path.join(folder, 'base') }), true);
    assert.equal(allow('Glob', { pattern: '../../**' }), false);
    assert.equal(allow('Glob', { pattern: path.join(fixture.shop, '*') }), false, 'an absolute pattern');
    for (const name of ['Bash', 'Edit', 'Write', 'WebFetch', 'mcp__x__y']) {
      assert.equal(allow(name, { file_path: path.join(folder, 'a') }), false, name);
    }
  });

  it('is what the factory builds for analysis; Cursor is refused for it, with a reason, before anything is built', () => {
    const built: string[] = [];
    const factory = providerAdapters({
      presentation: false,
      claudeAuthorizationReference: 'test-only reference',
      claudeInstalled: true,
      construct: {
        cursor: () => {
          built.push('cursor');
          throw new Error('built');
        },
        claude: (permissions) => {
          built.push(permissions === ANALYSIS_PERMISSIONS ? 'claude:analysis' : 'claude:other');
          return new ClaudeAgentSdkAdapter({ queryFn: () => { throw new Error('unused'); }, permissions, env: CLEAN_ENV });
        },
      },
    });
    assert.equal(factory.preflight({ provider: 'cursor', purpose: 'analysis' }), CURSOR_ANALYSIS_REFUSAL);
    assert.throws(() => factory.createAdapter({ provider: 'cursor', purpose: 'analysis' }), /Cursor cannot be limited to reading/);
    factory.createAdapter({ provider: 'claude', purpose: 'analysis' });
    assert.deepEqual(built, ['claude:analysis']);
  });
});

/** The scripted model: read the changed file, follow the call, try the working copy, answer. */
function walkScript(shop: string): ReadingScript {
  return {
    calls: (cwd) => [
      { name: 'Read', input: { file_path: path.join(cwd, 'target', 'src', 'checkout.ts') } },
      { name: 'Grep', input: { pattern: 'export function findDiscount', path: cwd } },
      { name: 'Read', input: { file_path: path.join(cwd, 'target', 'src', 'pricing.ts') } },
      { name: 'Read', input: { file_path: path.join(shop, 'src', 'pricing.ts') } },
      { name: 'Bash', input: { command: 'git checkout -- .' } },
    ],
    answer: (outcomes: readonly CallOutcome[]) => {
      const pricing = outcomes[2]?.result ?? '';
      const line = pricing.split('\n').findIndex((text) => text.startsWith('export function findDiscount')) + 1;
      return `\`\`\`json\n${JSON.stringify({
        overview: 'Checkout applies a discount code.',
        walks: [
          {
            title: 'What a discount code does to the total',
            question: 'Where does the discount come from?',
            purpose: 'You will see that total() takes the percentage from findDiscount() in pricing.ts.',
            steps: [
              {
                title: 'total() asks pricing for the discount',
                summary: 'The changed total() calls findDiscount().',
                body: 'total() now takes a code and multiplies by the remaining share.',
                places: [{ label: 'total()', path: 'src/checkout.ts', side: 'target', start: 1, end: 6 }],
              },
              // DSP-185: one place per step; the definition the call reaches is the next step.
              {
                title: 'findDiscount() gives the percentage',
                summary: 'The unchanged definition the previous step calls.',
                body: 'In the previous step total() calls findDiscount(); here it looks the code up.',
                places: [
                  {
                    label: 'findDiscount()',
                    path: 'src/pricing.ts',
                    side: 'target',
                    start: line,
                    end: line + 5,
                    anchor: 'findDiscount',
                    from: { label: 'The call in total()', path: 'src/checkout.ts', side: 'target', start: 1, end: 6 },
                  },
                ],
              },
              {
                title: 'The README says so',
                summary: 'Documentation.',
                body: 'The README mentions the code.',
                places: [{ label: 'README', path: 'README.md', side: 'target', start: 3, end: 3 }],
              },
              {
                title: 'Before',
                summary: 'The old total().',
                body: 'Before, no code.',
                places: [{ label: 'old total()', path: 'src/checkout.ts', side: 'base', start: 1, end: 4 }],
              },
              {
                title: 'The old README',
                summary: 'What the README said before.',
                body: 'Before, the README did not mention a code.',
                places: [{ label: 'old README', path: 'README.md', side: 'base', start: 3, end: 3 }],
              },
            ],
          },
        ],
      })}\n\`\`\``;
    },
  };
}

describe('a walk preparation with Claude (substituted SDK, real adapter)', () => {
  it('reads the revisions through the policy and hook, never the working copy, and the walk outlives the folder', async () => {
    const sdk = readingSubstitute(walkScript(fixture.shop));
    const snapshots = new RevisionSnapshots({ root: path.join(records, 'revisions'), log: () => undefined });
    const factory = providerAdapters({
      presentation: false,
      claudeAuthorizationReference: 'test-only reference',
      claudeInstalled: true,
      construct: {
        cursor: () => {
          throw new Error('Cursor was built');
        },
        claude: (permissions) =>
          new ClaudeAgentSdkAdapter({ queryFn: sdk.queryFn, spawnProcess: sdk.spawnProcess, localLookup: sdk.localLookup, env: CLEAN_ENV, permissions }),
      },
    });
    const service = new ReviewAgentJobs({
      recordsDir: records,
      createAdapter: (provider) => factory.createAdapter({ provider, purpose: 'analysis' }),
      snapshots,
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
    });
    const started = service.start(open.key, { kind: 'walks', provider: 'claude', model: 'opus' });
    assert.ok(!isPairError(started), JSON.stringify(started));
    const job = await settled(open.key, started.id);
    assert.equal(job.state, 'done', `${job.note} ${job.detail}`);

    const call = sdk.calls[0];
    assert.ok(call !== undefined);
    const cwd = String(call.options['cwd']);
    assert.equal(cwd, path.join(records, 'revisions', open.key), 'the session runs in the revision folder');
    assert.deepEqual(call.options['tools'], ['Read', 'Glob', 'Grep']);
    assert.deepEqual(call.options['allowedTools'], ['Read(/**)', 'Glob', 'Grep']);
    assert.ok((call.options['disallowedTools'] as string[]).includes('Bash'));
    assert.equal(call.options['permissionMode'], 'dontAsk');
    assert.deepEqual(call.options['settingSources'], []);
    assert.equal(call.options['strictMcpConfig'], true);
    assert.equal(call.options['model'], 'opus');
    assert.equal(call.options['mcpServers'], undefined, 'no app tools');

    // What the hooks decided, and what was read.
    assert.deepEqual(call.outcomes.map((outcome) => [outcome.call.name, outcome.allowed]), [
      ['Read', true],
      ['Grep', true],
      ['Read', true],
      ['Read', false],
      ['Bash', false],
    ]);
    assert.match(call.outcomes[1]?.result ?? '', /target[\\/]src[\\/]pricing\.ts:61:export function findDiscount/);
    assert.ok(!(call.outcomes[2]?.result ?? '').includes(WORKING_COPY_ONLY), 'the commit, not the working copy');
    assert.equal(call.outcomes[3]?.result, null, 'the working copy was not read');

    // The prompt orients; the definition the walk points at was not in it.
    assert.ok(call.prompt.includes('target/') && call.prompt.includes('Use your Read, Glob and Grep tools'));
    assert.ok(!call.prompt.includes('export function findDiscount'), 'pricing.ts is not in the prompt');
    assert.ok(!call.prompt.includes(WORKING_COPY_ONLY));

    // Recorded: what could be read and what was.
    assert.equal(job.material?.base, fixture.base);
    assert.equal(job.material?.target, fixture.target);
    assert.equal(job.material?.skippedCount, 0);
    assert.deepEqual(job.investigation?.reads, ['target/src/checkout.ts', 'target/src/pricing.ts']);
    assert.equal(job.investigation?.refused, 2, 'the working-copy read and the command were refused');
    assert.deepEqual(job.investigation?.refusedCalls, [`Read ${path.join(fixture.shop, 'src', 'pricing.ts').split(path.sep).join('/')}`, 'Bash']);

    // The walk points at the unchanged definition, checked against Git.
    assert.ok(job.definitionPath !== null);
    const definition = parseReviewDefinition(JSON.parse(fs.readFileSync(job.definitionPath, 'utf8')) as unknown);
    assert.deepEqual(definition.problems, []);
    const places = (definition.definition?.walks[0]?.steps.slice(0, 2) ?? []).map((step) => step.places);
    assert.deepEqual(places.map((stepPlaces) => stepPlaces.map((place) => [place.focus.path, place.focus.start])), [[['src/checkout.ts', 1]], [['src/pricing.ts', DEFINITION_LINE]]]);

    // Gone when the job ended; nothing in the person's repository changed.
    await snapshots.settled();
    assert.equal(fs.existsSync(cwd), false, 'the folder is removed after the job');
    assert.equal(workingCopyState(fixture.shop), before0);
  });
});

describe('the presentation agent (scenarios) reads the folder too', () => {
  function presentationJobs(): ReviewAgentJobs {
    return new ReviewAgentJobs({
      recordsDir: records,
      createAdapter: () => new PresentationAdapter({ deltaMs: 1 }),
      snapshots: new RevisionSnapshots({ root: path.join(records, 'revisions-p'), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
    });
  }

  it('prepares a walk that follows the call to the unchanged definition', async () => {
    const service = presentationJobs();
    const started = service.start(open.key, { kind: 'walks', provider: 'claude', model: 'opus' });
    assert.ok(!isPairError(started));
    const job = await settled(open.key, started.id);
    assert.equal(job.state, 'done', job.note);
    const definition = parseReviewDefinition(JSON.parse(fs.readFileSync(job.definitionPath ?? '', 'utf8')) as unknown);
    const places = (definition.definition?.walks ?? []).flatMap((walk) => walk.steps.flatMap((step) => step.places));
    assert.ok(places.some((place) => place.focus.path === 'src/pricing.ts' && place.focus.start === DEFINITION_LINE), JSON.stringify(places.map((place) => place.focus)));
    assert.ok(job.investigation?.reads.includes('target/src/pricing.ts'));
  });

  it('reviews a delegated part: a problem shown by the unchanged definition, nothing wrongly approved', async () => {
    const scope = { kind: 'file', label: 'src/checkout.ts', ranges: [{ kind: 'lines', side: 'target', path: 'src/checkout.ts', start: 1, end: 6 }] };
    const started = presentationJobs().start(open.key, { kind: 'review', provider: 'claude', model: 'opus', scope });
    assert.ok(!isPairError(started));
    const job = await settled(open.key, started.id);
    assert.equal(job.state, 'done', job.note);
    const result = job.result;
    assert.ok(result !== null);
    assert.equal(result.insufficient, false);
    const problem = result.findings.find((finding) => finding.severity === 'problem');
    assert.equal(problem?.location?.start, 4, 'the line that uses the result unchecked');
    const note = result.findings.find((finding) => finding.location?.path === 'src/pricing.ts');
    assert.equal(note?.location?.start, DEFINITION_LINE, 'a finding placed in unchanged code, kept because it exists at the commit');
    const approvedLines = result.approved.flatMap((range) => Array.from({ length: range.end - range.start + 1 }, (_, index) => range.start + index));
    assert.ok(!approvedLines.includes(4), 'the problem line is not approved');
    assert.ok(approvedLines.length > 0);
  });

  it('answers a step question with references checked against the commits', async () => {
    process.env['DSPATCH_REVIEW_SIM'] = 'bad-ref-first';
    try {
      const walks = (pairs.state(open.key) as PairRecord).jobs.filter((job) => job.kind === 'walks' && job.state === 'done');
      const definitionPath = walks.at(-1)?.definitionPath ?? '';
      // The step over the changed lines of total() that call findDiscount().
      const definition = parseReviewDefinition(JSON.parse(fs.readFileSync(definitionPath, 'utf8')) as unknown).definition;
      const over = (entry: { readonly places: readonly { readonly focus: { readonly path: string; readonly side: string; readonly start: number; readonly end: number } }[] }): boolean =>
        entry.places.some((place) => place.focus.path === 'src/checkout.ts' && place.focus.side === 'target' && place.focus.start <= 4 && place.focus.end >= 4);
      const walk = definition?.walks.find((entry) => entry.steps.some(over));
      const step = walk?.steps.find(over);
      assert.ok(walk !== undefined && step !== undefined);
      const started = presentationJobs().start(open.key, {
        kind: 'explain',
        provider: 'claude',
        model: 'opus',
        question: { definitionPath, walkId: walk.id, stepId: step.id, question: 'Where does the percentage come from?' },
      });
      assert.ok(!isPairError(started), JSON.stringify(started));
      const job = await settled(open.key, started.id);
      assert.equal(job.state, 'done', job.note);
      assert.ok(job.answer?.answer.includes('findDiscount'), JSON.stringify({ answer: job.answer, investigation: job.investigation, step: step.id }));
      assert.ok(job.answer?.references.some((reference) => reference.range.path === 'src/pricing.ts' && reference.range.start === DEFINITION_LINE));
      assert.equal(job.answer?.references.some((reference) => reference.range.start === 9999), false, 'a reference that does not exist is left out');
      assert.equal(job.answer?.adjustments.length, 1);
      assert.deepEqual(pairs.stepAnswers(definitionPath, step.id).map((entry) => entry.question), ['Where does the percentage come from?']);
    } finally {
      delete process.env['DSPATCH_REVIEW_SIM'];
    }
  });

  it('refuses a question about a walk over other commits', () => {
    const other = path.join(records, 'other.review.json');
    fs.writeFileSync(other, JSON.stringify({ repository: fixture.shop, base: fixture.target, target: fixture.base, walks: [{ id: 'W1', steps: [{ id: 'W1.1' }] }] }));
    const refused = presentationJobs().start(open.key, {
      kind: 'explain',
      provider: 'claude',
      model: 'opus',
      question: { definitionPath: other, walkId: 'W1', stepId: 'W1.1', question: 'Why?' },
    });
    assert.ok(isPairError(refused) && /other commits/.test(refused.error));
  });
});

describe('DSP-152: explaining selected code', () => {
  const fileKey = 'src/checkout.ts→src/checkout.ts';
  const request = (selection: unknown): Record<string, unknown> => ({ kind: 'explain', provider: 'claude', model: 'opus', selection });
  function presentationJobs(): ReviewAgentJobs {
    return new ReviewAgentJobs({
      recordsDir: records,
      createAdapter: () => new PresentationAdapter({ deltaMs: 1 }),
      snapshots: new RevisionSnapshots({ root: path.join(records, 'revisions-s'), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
    });
  }

  it('records the selection as the commits hold it, splitting removed, added and unchanged lines, and marks nothing', async () => {
    const statusBefore = JSON.stringify((pairs.state(open.key) as PairRecord).marks);
    const started = await presentationJobs().request(open.key, request({
      fileKey,
      layout: 'unified',
      // From line 3 (removed) to the end of line 4, as one run; then To lines 5–7 (added, unchanged, unchanged).
      segments: [
        { side: 'base', path: 'src/checkout.ts', start: 3, end: 4, from: 7, to: 25 },
        { side: 'target', path: 'src/checkout.ts', start: 5, end: 8, from: 2, to: 15 },
      ],
      text: 'function total(amount: number): number {\n  return amount * RATE_1;\nreturn amount * RATE_1 * (1 - percent / 100);\n}\n\nexport function',
    }));
    assert.ok(!isPairError(started), JSON.stringify(started));
    assert.deepEqual(
      started.selection?.segments.map((segment) => [segment.side, segment.start, segment.end, segment.kind, segment.text]),
      [
        ['base', 3, 4, 'removed', 'function total(amount: number): number {\n  return amount * RATE_1;'],
        ['target', 5, 5, 'added', 'return amount * RATE_1 * (1 - percent / 100);'],
        ['target', 6, 8, 'unchanged', '}\n\nexport function'],
      ],
    );
    const job = await settled(open.key, started.id);
    assert.equal(job.state, 'done', job.note);
    assert.ok(job.answer?.answer.includes('removed: only in From') && job.answer.answer.includes('added: only in To') && job.answer.answer.includes('unchanged in both'), job.answer?.answer);
    assert.ok(job.investigation?.reads.includes('base/src/checkout.ts') && job.investigation.reads.includes('target/src/checkout.ts'), JSON.stringify(job.investigation));
    const record = pairs.state(open.key) as PairRecord;
    assert.equal(record.agentReviews.filter((review) => review.jobId === job.id).length, 0, 'an explanation approves nothing');
    assert.equal(JSON.stringify(record.marks), statusBefore, 'an explanation marks nothing');
    assert.equal(workingCopyState(fixture.shop), before0);
  });

  it('refuses a selection whose text is not what the commits hold, or that names another file or side', async () => {
    const wrongText = await presentationJobs().request(open.key, request({ fileKey, layout: 'split', segments: [{ side: 'target', path: 'src/checkout.ts', start: 4, end: 4, from: 18, to: 36 }], text: 'findDiscount(cod)' }));
    assert.ok(isPairError(wrongText) && /not what the commits hold/.test(wrongText.error), JSON.stringify(wrongText));
    // The working copy's pricing.ts is not this file; the commit's line 4 at From is another line.
    const wrongSide = await presentationJobs().request(open.key, request({ fileKey, layout: 'split', segments: [{ side: 'base', path: 'src/checkout.ts', start: 4, end: 4, from: 18, to: 36 }], text: 'findDiscount(code)' }));
    assert.ok(isPairError(wrongSide), 'a selection sent with the wrong side is refused');
    const wrongFile = await presentationJobs().request(open.key, request({ fileKey, layout: 'split', segments: [{ side: 'target', path: 'src/pricing.ts', start: 61, end: 61, from: 0, to: 6 }], text: 'export' }));
    assert.ok(isPairError(wrongFile) && /not this file/.test(wrongFile.error));
    const unchecked = presentationJobs().start(open.key, request({ fileKey, layout: 'split', segments: [], text: '' }));
    assert.ok(isPairError(unchecked) && /not checked/.test(unchecked.error), 'start without the check refuses a selection');
  });

  it('gives a follow-up the explanation it follows: its selection and the earlier answers', async () => {
    const root = await presentationJobs().request(open.key, request({ fileKey, layout: 'split', segments: [{ side: 'target', path: 'src/checkout.ts', start: 4, end: 4, from: 18, to: 36 }], text: 'findDiscount(code)' }));
    assert.ok(!isPairError(root), JSON.stringify(root));
    await settled(open.key, root.id);
    const more = await presentationJobs().request(open.key, { kind: 'explain', provider: 'claude', model: 'opus', followUp: { root: root.id, action: 'question', question: 'Why can it be null?' }, selection: { forged: true } });
    assert.ok(!isPairError(more), JSON.stringify(more));
    assert.deepEqual(more.selection, root.selection, 'the selection is the explanation\'s, not the window\'s');
    const job = await settled(open.key, more.id);
    assert.ok(job.answer?.answer.includes('Why can it be null?') && job.answer.answer.includes('building on 1 earlier answer'), job.answer?.answer);
    const empty = await presentationJobs().request(open.key, { kind: 'explain', provider: 'claude', model: 'opus', followUp: { root: root.id, action: 'question', question: ' ' } });
    assert.ok(isPairError(empty));
    const notRoot = await presentationJobs().request(open.key, { kind: 'explain', provider: 'claude', model: 'opus', followUp: { root: more.id, action: 'more' } });
    assert.ok(isPairError(notRoot), 'a follow-up follows the first explanation, not another follow-up');
  });

  it("asks the person's own question about a selection, also in a file outside the change, and marks nothing (30 October 2026)", async () => {
    const statusBefore = JSON.stringify((pairs.state(open.key) as PairRecord).marks);
    const own = await presentationJobs().request(open.key, {
      ...request({ fileKey: 'outside:src/pricing.ts', layout: 'unified', segments: [{ side: 'target', path: 'src/pricing.ts', start: 61, end: 61, from: 0, to: 6 }], text: 'export' }),
      ask: 'What does this module give the checkout?',
    });
    assert.ok(!isPairError(own), JSON.stringify(own));
    assert.equal(own.asked, 'What does this module give the checkout?');
    assert.deepEqual(own.selection?.segments.map((segment) => [segment.path, segment.side, segment.start, segment.kind, segment.text]), [['src/pricing.ts', 'target', 61, 'unchanged', 'export']]);
    const job = await settled(open.key, own.id);
    assert.equal(job.state, 'done', job.note);
    // The question is what is asked now, with the selection exactly; not "explain the selected code".
    assert.ok(job.answer?.answer.includes('What does this module give the checkout?') && job.answer.answer.includes('building on 0 earlier'), job.answer?.answer);
    // A file outside the change is refused under a key that does not name it, and an empty question is refused.
    const misnamed = await presentationJobs().request(open.key, request({ fileKey: 'outside:src/other.ts', layout: 'unified', segments: [{ side: 'target', path: 'src/pricing.ts', start: 61, end: 61, from: 0, to: 6 }], text: 'export' }));
    assert.ok(isPairError(misnamed), 'a selection must be in the file its key names');
    const blank = await presentationJobs().request(open.key, { ...request({ fileKey, layout: 'split', segments: [{ side: 'target', path: 'src/checkout.ts', start: 4, end: 4, from: 18, to: 36 }], text: 'findDiscount(code)' }), ask: '  ' });
    assert.ok(isPairError(blank));
    assert.equal(JSON.stringify((pairs.state(open.key) as PairRecord).marks), statusBefore, 'asking marks nothing');
  });

  it("explains one answer more simply with that answer's own question and the answers before it only", async () => {
    const root = await presentationJobs().request(open.key, request({ fileKey, layout: 'split', segments: [{ side: 'target', path: 'src/checkout.ts', start: 4, end: 4, from: 18, to: 36 }], text: 'findDiscount(code)' }));
    assert.ok(!isPairError(root));
    await settled(open.key, root.id);
    const first = await presentationJobs().request(open.key, { kind: 'explain', provider: 'claude', model: 'opus', followUp: { root: root.id, action: 'question', question: 'First question?' } });
    assert.ok(!isPairError(first));
    await settled(open.key, first.id);
    const second = await presentationJobs().request(open.key, { kind: 'explain', provider: 'claude', model: 'opus', followUp: { root: root.id, action: 'question', question: 'Second question?' } });
    assert.ok(!isPairError(second));
    await settled(open.key, second.id);
    const simpler = await presentationJobs().request(open.key, { kind: 'explain', provider: 'claude', model: 'opus', followUp: { root: root.id, action: 'simpler', of: first.id } });
    assert.ok(!isPairError(simpler), JSON.stringify(simpler));
    assert.equal(simpler.followUp?.of, first.id);
    const job = await settled(open.key, simpler.id);
    // The thread it is given ends with the first follow-up: the root's answer and that one.
    assert.ok(job.answer?.answer.includes('First question?') && job.answer.answer.includes('building on 2 earlier'), job.answer?.answer);
    assert.ok(!(job.answer?.answer ?? '').includes('Second question?'), job.answer?.answer);
    const foreign = await presentationJobs().request(open.key, { kind: 'explain', provider: 'claude', model: 'opus', followUp: { root: root.id, action: 'simpler', of: 'job-not-here' } });
    assert.ok(isPairError(foreign));
  });
});
