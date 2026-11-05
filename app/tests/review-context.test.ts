/**
 * DSP-175 item 7: the workspace's other repositories as read context for review.
 *
 * A neutral workspace of two repositories: `app`, the one reviewed, calls `computeTotal`,
 * which only `lib` defines. These establish DSpatch's own handling, with real Git and the
 * presentation adapter's SIMULATED agent: which commit of `lib` is read and why, that only
 * its committed files are written, that the analysis policies keep reads inside the folder,
 * that context references are checked at the recorded commit and never become reviewed or
 * approved lines, and that a question answered only by `lib` comes back with a checked
 * context citation that opens from the review. Nothing here reaches a real provider.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { analysisCallAllowed } from '../src/adapter/claude-agent-sdk-adapter';
import { copilotReadAllowed } from '../src/adapter/copilot-sdk-adapter';
import { ReviewContexts, contextReaderOf, contextRepositoriesOf, resolveContextVersion } from '../src/host/context-repositories';
import { ReviewAgentJobs } from '../src/host/review-agent-jobs';
import { pairEnvelopeSource } from '../src/host/review-pair-discussion';
import { ReviewPairs } from '../src/host/review-pairs';
import { RevisionSnapshots } from '../src/host/revision-snapshots';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { ReviewDiscussions } from '../src/main/review-discussion-service';
import { readReviewAnswer, readStepAnswer, withCheckedContext, withCheckedFindings } from '../src/shared/review-agent';
import { isPairError, jobFrom, type OpenPair, type PairRecord } from '../src/shared/review-pair';
import { adoptDiscussionRecord } from '../src/shared/review-discussion';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repository(folder: string): void {
  fs.mkdirSync(folder, { recursive: true });
  git(folder, 'init', '-q');
  git(folder, 'config', 'user.email', 'test@example.invalid');
  git(folder, 'config', 'user.name', 'Test Author');
  git(folder, 'config', 'core.autocrlf', 'false');
}

function write(folder: string, file: string, text: string): void {
  const full = path.join(folder, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function commit(folder: string, message: string): string {
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', message);
  return git(folder, 'rev-parse', 'HEAD');
}

const TOTAL_V1 = 'export function computeTotal(items: number[]): number {\n  return items.reduce((sum, item) => sum + item, 0);\n}\n';
const TOTAL_V11 = 'export function computeTotal(items: number[]): number {\n  // 1.1: negative items are refunds and are left out\n  return items.filter((item) => item >= 0).reduce((sum, item) => sum + item, 0);\n}\n';
const UNCOMMITTED = 'UNCOMMITTED LIB CHANGE';
const UNTRACKED = 'UNTRACKED LIB FILE';
const IGNORED = 'IGNORED LIB FILE';

let workspace: string;
let outside: string;
let records: string;
let app: string;
let lib: string;
/** lib at its tags and HEAD. */
let lib10: string;
let lib11: string;
let libHead: string;
/** app: base, and To commits declaring lib in different ways. */
let appBase: string;
let appExact: string;
const declared: Record<string, string> = {};

before(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-context-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-context-outside-'));
  records = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-context-records-'));
  app = path.join(workspace, 'app');
  lib = path.join(workspace, 'lib');

  repository(lib);
  write(lib, 'package.json', JSON.stringify({ name: 'neutral-lib', version: '1.0.0' }, null, 2));
  write(lib, '.gitignore', '*.log\n');
  write(lib, 'src/total.ts', TOTAL_V1);
  lib10 = commit(lib, 'lib 1.0.0');
  git(lib, 'tag', 'v1.0.0');
  write(lib, 'src/total.ts', TOTAL_V11);
  lib11 = commit(lib, 'lib 1.1.0');
  git(lib, 'tag', '1.1.0');
  write(lib, 'README.md', '# neutral-lib\n');
  libHead = commit(lib, 'lib: docs after 1.1.0');
  // The working copy says other things, none of which may reach the snapshot.
  write(lib, 'src/total.ts', `${TOTAL_V11}// ${UNCOMMITTED}\nexport const extra = 1;\nexport const more = 2;\n`);
  write(lib, 'scratch.txt', `${UNTRACKED}\n`);
  write(lib, 'debug.log', `${IGNORED}\n`);

  repository(app);
  write(app, 'src/main.ts', "import { computeTotal } from 'neutral-lib';\n\nexport const total = computeTotal([1, 2]);\n");
  appBase = commit(app, 'app: start');
  const declare = (name: string, files: Record<string, string>): string => {
    for (const [file, text] of Object.entries(files)) {
      write(app, file, text);
    }
    git(app, 'add', '-A');
    git(app, 'commit', '-q', '--allow-empty', '-m', `app: ${name}`);
    const hash = git(app, 'rev-parse', 'HEAD');
    declared[name] = hash;
    return hash;
  };
  // Each To commit only changes main.ts and how lib is declared; resolved one by one.
  declare('nothing', { 'src/main.ts': "import { computeTotal } from 'neutral-lib';\n\nexport const total = computeTotal([1, -2, 3]);\n" });
  declare('range', { 'package.json': JSON.stringify({ name: 'app', dependencies: { 'neutral-lib': '^1.0.0' } }) });
  declare('lock', { 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/neutral-lib': { version: '1.1.0' } } }) });
  fs.rmSync(path.join(app, 'package-lock.json'));
  declare('path', { 'package.json': JSON.stringify({ name: 'app', dependencies: { 'neutral-lib': 'file:../lib' } }) });
  declare('untagged', { 'package.json': JSON.stringify({ name: 'app', dependencies: { 'neutral-lib': '9.9.9' } }) });
  appExact = declare('exact', { 'package.json': JSON.stringify({ name: 'app', dependencies: { 'neutral-lib': '1.0.0' } }) });
  // A submodule pin at lib 1.1.0, on a branch of its own so `exact` stays the reviewed To.
  const branch = git(app, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(app, 'checkout', '-q', '-b', 'pinned');
  git(app, 'update-index', '--add', '--cacheinfo', `160000,${lib11},vendor/lib`);
  git(app, 'commit', '-q', '-m', 'app: pin lib as a submodule');
  declared['submodule'] = git(app, 'rev-parse', 'HEAD');
  git(app, 'checkout', '-q', branch);
  // A repository outside the workspace's folders, which is never context.
  repository(path.join(outside, 'elsewhere'));
  write(path.join(outside, 'elsewhere'), 'x.ts', 'export const x = 1;\n');
  commit(path.join(outside, 'elsewhere'), 'elsewhere');
});

after(() => {
  for (const folder of [workspace, outside, records]) {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe('which commit of a context repository is read', () => {
  it('follows a submodule pin, a declared version with a tag, a path dependency, or else says HEAD is not established', async () => {
    const at = async (name: string): Promise<{ commit: string; how: string; established: boolean; note: string }> => resolveContextVersion(app, declared[name] ?? '', lib);
    const pinned = await at('submodule');
    assert.deepEqual([pinned.commit, pinned.how, pinned.established], [lib11, 'submodule', true]);
    assert.match(pinned.note, /vendor\/lib/);
    const exact = await at('exact');
    assert.deepEqual([exact.commit, exact.how, exact.established], [lib10, 'dependency', true]);
    assert.match(exact.note, /neutral-lib 1\.0\.0 \(package\.json\); read at its tag v1\.0\.0/);
    const locked = await at('lock');
    assert.deepEqual([locked.commit, locked.how], [lib11, 'dependency'], 'the lock file names the version; its tag has no v');
    const linked = await at('path');
    assert.deepEqual([linked.commit, linked.how, linked.established], [libHead, 'path-dependency', false]);
    assert.match(linked.note, /path dependency.*file:\.\.\/lib.*commit read is HEAD/i);
    const ranged = await at('range');
    assert.deepEqual([ranged.commit, ranged.how, ranged.established], [libHead, 'head', false]);
    assert.match(ranged.note, /Not established.*\^1\.0\.0/);
    const untagged = await at('untagged');
    assert.deepEqual([untagged.commit, untagged.established], [libHead, false]);
    assert.match(untagged.note, /no tag v9\.9\.9 or 9\.9\.9/);
    const nothing = await at('nothing');
    assert.deepEqual([nothing.commit, nothing.how, nothing.established], [libHead, 'head', false]);
    assert.match(nothing.note, /^Not established/);
  });

  it('gives only other repositories under the workspace\'s own folders, with names of their own', () => {
    const repositories = [
      { name: 'app', path: app },
      { name: 'lib', path: lib },
      { name: 'elsewhere', path: path.join(outside, 'elsewhere') },
    ];
    assert.deepEqual(contextRepositoriesOf(app, [workspace], repositories), [{ name: 'lib', path: lib }]);
    // A folder inside a repository names it for review, but its repository is above the folder: not context.
    assert.deepEqual(contextRepositoriesOf(app, [path.join(lib, 'src')], repositories), []);
  });
});

describe('the snapshot and what may read it', () => {
  let pairs: ReviewPairs;
  let open: OpenPair;
  let snapshots: RevisionSnapshots;
  let folder: string;

  before(async () => {
    pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs-a'), changed: () => undefined });
    await pairs.repositories([workspace]);
    const opened = await pairs.openPair({ repository: app, base: appBase, target: appExact });
    assert.ok(!isPairError(opened));
    open = opened;
    snapshots = new RevisionSnapshots({ root: path.join(records, 'revisions-a'), log: () => undefined });
    const snapshot = await snapshots.acquire(open.key, open.pair, { base: new Set(), target: new Set() }, 'test', [{ name: 'lib', path: lib }]);
    folder = snapshot.folder;
    const [context] = snapshot.manifest.context;
    assert.ok(context !== undefined);
    assert.deepEqual([context.name, context.commit, context.how], ['lib', lib10, 'dependency']);
    assert.deepEqual(context.workingCopy, { head: libHead, changed: 1, untracked: 1 }, 'counted, the ignored file not among them');
  });

  after(async () => {
    snapshots.release(open.key, 'test');
    await snapshots.settled();
  });

  it('holds lib at the resolved commit, from its commits only', () => {
    const root = path.join(folder, 'context', 'lib');
    assert.equal(fs.readFileSync(path.join(root, 'src', 'total.ts'), 'utf8'), TOTAL_V1);
    assert.ok(!fs.existsSync(path.join(root, 'README.md')), 'a file of a later commit is not there');
    assert.ok(!fs.existsSync(path.join(root, 'scratch.txt')), 'untracked files are never there');
    assert.ok(!fs.existsSync(path.join(root, 'debug.log')), 'ignored files are never there');
    const holding = (fs.readdirSync(folder, { recursive: true }) as string[])
      .map((name) => path.join(folder, name))
      .filter((file) => fs.statSync(file).isFile())
      .filter((file) => [UNCOMMITTED, UNTRACKED, IGNORED].some((marker) => fs.readFileSync(file, 'utf8').includes(marker)));
    assert.deepEqual(holding, [], 'nothing of the working copy is anywhere in the snapshot');
  });

  it('is read inside the folder only, by the policies of both providers', () => {
    const inside = path.join(folder, 'context', 'lib', 'src', 'total.ts');
    const workingCopy = path.join(lib, 'src', 'total.ts');
    const escape = path.join(folder, 'context', '..', '..', '..', 'x');
    assert.equal(analysisCallAllowed('Read', { file_path: inside }, [folder], folder), true);
    assert.equal(analysisCallAllowed('Read', { file_path: 'context/lib/src/total.ts' }, [folder], folder), true);
    assert.equal(analysisCallAllowed('Read', { file_path: workingCopy }, [folder], folder), false, 'the library\'s working copy is outside');
    assert.equal(analysisCallAllowed('Read', { file_path: escape }, [folder], folder), false);
    assert.equal(analysisCallAllowed('Grep', { pattern: 'computeTotal', path: lib }, [folder], folder), false);
    assert.equal(analysisCallAllowed('Glob', { pattern: '../**/*.ts', path: path.join(folder, 'context') }, [folder], folder), false);
    assert.equal(copilotReadAllowed('view', { path: inside }, [folder], folder), true);
    assert.equal(copilotReadAllowed('view', { path: workingCopy }, [folder], folder), false);
    assert.equal(copilotReadAllowed('view', { path: escape }, [folder], folder), false);
    assert.equal(copilotReadAllowed('grep', { pattern: 'computeTotal', paths: [lib] }, [folder], folder), false);
    assert.equal(copilotReadAllowed('glob', { pattern: '../../**', paths: [path.join(folder, 'context')] }, [folder], folder), false);
  });

  it('checks context references at the recorded commit, never the working copy, and leaves the rest out', async () => {
    const snapshot = await snapshots.acquire(open.key, open.pair, { base: new Set(), target: new Set() }, 'test-2');
    snapshots.release(open.key, 'test-2');
    const reader = contextReaderOf(snapshot.manifest.context);
    const answer = await readStepAnswer(
      {
        answer: 'It sums the items.',
        references: [
          { label: 'computeTotal', repository: 'lib', path: 'src/total.ts', start: 1, end: 3 },
          // Line 6 exists only in the working copy.
          { label: 'Only on disk', repository: 'lib', path: 'src/total.ts', start: 6, end: 6 },
          { label: 'Not context', repository: 'elsewhere', path: 'x.ts', start: 1, end: 1 },
          { label: 'Gone', repository: 'lib', path: 'src/gone.ts', start: 1, end: 1 },
          { label: 'In the change', path: 'src/main.ts', side: 'target', start: 3, end: 3 },
        ],
      },
      (side, filePath) => pairs.linesAt(open.key, side, filePath),
      reader,
    );
    assert.ok(!('error' in answer));
    assert.deepEqual(answer.contextReferences, [{ label: 'computeTotal', range: { kind: 'context', repository: 'lib', commit: lib10, path: 'src/total.ts', start: 1, end: 3 } }]);
    assert.deepEqual(answer.references.map((reference) => reference.range.path), ['src/main.ts']);
    assert.equal(answer.adjustments.filter((entry) => entry.startsWith('A context reference was left out')).length, 3, JSON.stringify(answer.adjustments));
  });

  it('never counts context lines as reviewed or approved, even at a path the change has', async () => {
    const snapshot = await snapshots.acquire(open.key, open.pair, { base: new Set(), target: new Set() }, 'test-3');
    snapshots.release(open.key, 'test-3');
    const scope = { kind: 'file' as const, label: 'src/main.ts', ranges: [{ kind: 'lines' as const, side: 'target' as const, path: 'src/main.ts', start: 1, end: 3 }] };
    const raw = {
      assessment: 'The call passes a negative item, which lib 1.0.0 adds up.',
      reviewed: [{ path: 'src/main.ts', side: 'target', start: 3, end: 3 }, { repository: 'lib', path: 'src/main.ts', side: 'target', start: 1, end: 3 }],
      approved: [{ repository: 'lib', path: 'src/main.ts', side: 'target', start: 1, end: 3 }],
      findings: [
        { severity: 'question', title: 'Refunds', text: 'lib 1.0.0 sums negative items.', repository: 'lib', path: 'src/total.ts', start: 2, end: 2 },
        { severity: 'note', title: 'Out of range', text: 'A place that does not exist.', repository: 'lib', path: 'src/total.ts', start: 40, end: 41 },
      ],
      insufficient: false,
    };
    const read = readReviewAnswer(raw, scope, open.files);
    assert.ok(!('error' in read));
    const result = await withCheckedContext(await withCheckedFindings(read, (side, filePath) => pairs.linesAt(open.key, side, filePath)), raw, contextReaderOf(snapshot.manifest.context));
    assert.deepEqual(result.reviewed.map((range) => [range.path, range.start, range.end]), [['src/main.ts', 3, 3]]);
    assert.deepEqual(result.approved, [], 'nothing approved: only context lines were named');
    assert.deepEqual(result.findings[0]?.contextLocation, { kind: 'context', repository: 'lib', commit: lib10, path: 'src/total.ts', start: 2, end: 2 });
    assert.equal(result.findings[0]?.location, null);
    assert.equal(result.findings[1]?.contextLocation, undefined, 'a context place that does not exist is removed');
    assert.ok(result.adjustments.some((entry) => /context is never reviewed or approved/.test(entry)), JSON.stringify(result.adjustments));
    assert.ok(result.adjustments.some((entry) => /context place was removed/.test(entry)));
  });
});

describe('a question only lib answers, through the real services', () => {
  it('reads lib as context, cites it at its commit, and the citation opens from the review', async () => {
    const pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs-b'), changed: () => undefined });
    await pairs.repositories([workspace]);
    const opened = await pairs.openPair({ repository: app, base: appBase, target: appExact });
    assert.ok(!isPairError(opened));
    const contexts = new ReviewContexts({
      recordsDir: path.join(records, 'context'),
      workspace: async () => ({ folders: [workspace], repositories: await pairs.repositories([workspace]) }),
      log: () => undefined,
    });
    const sent: string[] = [];
    const simulated = (): PresentationAdapter => {
      const adapter = new PresentationAdapter({ deltaMs: 1 });
      const send = adapter.send.bind(adapter);
      adapter.send = (sessionId: string, prompt: string) => {
        sent.push(prompt);
        return send(sessionId, prompt);
      };
      return adapter;
    };
    const jobs = new ReviewAgentJobs({
      recordsDir: records,
      createAdapter: simulated,
      snapshots: new RevisionSnapshots({ root: path.join(records, 'revisions-b'), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
      contexts,
    });
    const discussions = new ReviewDiscussions({
      recordsDir: path.join(records, 'reviews'),
      log: () => undefined,
      createAdapter: () => {
        throw new Error('the tool-free adapter is not used when the agent can read the code');
      },
      codeAccess: {
        offered: () => true,
        createAdapter: simulated,
        policy: undefined,
        policyLine: () => 'analysis',
        hold: (held, holder) => jobs.holdForDiscussion({ repository: held.repository, base: held.base, target: held.target }, holder),
      },
    });
    try {
      const service = discussions.serviceFor({ key: opened.key, repository: app, base: appBase, target: appExact, definitionPath: '' });
      assert.equal((await service.chooseAgent('claude')).kind, 'chosen');
      const asked = await service.send({ question: 'What does `computeTotal` do with negative items?', subject: { kind: 'review' }, selection: null, language: 'en' }, pairEnvelopeSource(pairs, opened.key));
      assert.equal(asked.kind, 'sent', JSON.stringify(asked));
      const questionId = asked.kind === 'sent' ? asked.questionId : '';
      let answer = null;
      for (const until = Date.now() + 20_000; Date.now() < until && answer === null; ) {
        const loaded = await service.load(null, { envelopeFor: () => Promise.reject(new Error('not asked')) });
        const found = loaded.kind === 'loaded' ? loaded.messages.find((message) => message.role === 'answer' && message.questionId === questionId) : undefined;
        answer = found !== undefined && found.status === 'done' && found.references !== undefined ? found : null;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      assert.ok(answer !== null, 'the answer settled');
      const prompt = sent.at(-1) ?? '';
      assert.match(prompt, /## Other repositories of the workspace \(read-only context\)/);
      assert.match(prompt, new RegExp(`context/lib/\`: repository lib at commit ${lib10}`));
      assert.match(prompt, /working copy differs/);
      assert.ok(!prompt.includes('items.reduce'), 'nothing of lib is in the prompt');
      assert.deepEqual(answer.contextReferences?.map((reference) => reference.range), [{ kind: 'context', repository: 'lib', commit: lib10, path: 'src/total.ts', start: 1, end: 3 }]);
      assert.deepEqual(answer.references, [], 'no reviewed place was claimed');
      assert.match(answer.text, /defined in `lib`.*read as context at/s);
      assert.ok(answer.reads?.some((read) => read.includes(path.join('context', 'lib', 'src', 'total.ts'))), JSON.stringify(answer.reads));

      // The citation opens from the review at the commit read, not from the working copy.
      const file = await contexts.readFile(opened.key, opened.pair, 'lib', 'src/total.ts', lib10);
      assert.ok(!isPairError(file));
      assert.equal(file.text, TOTAL_V1);
      assert.deepEqual([file.how, file.established], ['dependency', true]);
      // Only what this review gave as context opens: another commit, path or repository does not.
      assert.ok(isPairError(await contexts.readFile(opened.key, opened.pair, 'lib', 'src/total.ts', lib11)));
      assert.ok(isPairError(await contexts.readFile(opened.key, opened.pair, 'lib', '../app/src/main.ts', lib10)));
      assert.ok(isPairError(await contexts.readFile(opened.key, opened.pair, 'elsewhere', 'x.ts', lib10)));

      // Context reading approved nothing and covered nothing.
      const record = pairs.state(opened.key) as PairRecord;
      assert.deepEqual(record.agentReviews, []);
    } finally {
      await discussions.dispose();
      await jobs.dispose();
    }
  });
});

describe('context citations kept with the review', () => {
  it('survive saving and reading a job and a discussion answer, and a malformed one is dropped', () => {
    const range = { kind: 'context', repository: 'lib', commit: 'a'.repeat(40), path: 'src/total.ts', start: 1, end: 3 };
    const job = jobFrom(
      JSON.parse(
        JSON.stringify({
          id: 'job-1',
          kind: 'review',
          state: 'done',
          provider: 'claude',
          model: 'm',
          answer: { answer: 'x', references: [], contextReferences: [{ label: 'ok', range }, { label: 'bad', range: { ...range, commit: 'HEAD' } }], insufficient: false, adjustments: [] },
          result: { assessment: 'a', reviewed: [], approved: [], findings: [{ severity: 'note', text: 't', location: null, contextLocation: range }], uncertainties: [], insufficient: false, adjustments: [] },
        }),
      ),
    );
    assert.deepEqual(job?.answer?.contextReferences, [{ label: 'ok', range }]);
    assert.deepEqual(job?.result?.findings[0]?.contextLocation, range);
    assert.deepEqual(job?.result?.approved, []);
    const identity = { key: 'k', repository: '/r', base: 'b'.repeat(40), target: 'c'.repeat(40), definitionPath: '' };
    const adopted = adoptDiscussionRecord(
      { version: 2, identity, messages: [{ id: 'a1', role: 'answer', text: 't', at: 'x', subject: 's', status: 'done', contextReferences: [{ label: 'ok', range }, { label: 'bad', range: { ...range, kind: 'lines' } }] }] },
      identity,
    );
    assert.equal(adopted.kind, 'adopted', JSON.stringify(adopted));
    assert.deepEqual(adopted.kind === 'adopted' ? adopted.record.messages[0]?.contextReferences : undefined, [{ label: 'ok', range }]);
  });
});

