/**
 * DSP-175: walk places in another repository of the workspace, read as context.
 *
 * A neutral workspace of two repositories: `app`, the one reviewed, now formats a count with
 * `formatCount`, which only the sibling repository `count-lib` defines. These establish
 * DSpatch's own handling, with real Git and the presentation adapter's SIMULATED agent: a
 * walk place may name a context repository instead of a side; it is checked at the commit
 * the analysis recorded, stored apart from the reviewed places, never counted as coverage,
 * and opens from the review's context record with how its commit was chosen. Definitions
 * written before this keep loading as they did. Nothing here reaches a real provider.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ReviewContexts, contextReaderOf } from '../src/host/context-repositories';
import { ReviewAgentJobs } from '../src/host/review-agent-jobs';
import { ReviewPairs } from '../src/host/review-pairs';
import { RevisionSnapshots } from '../src/host/revision-snapshots';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { contextExcerpt, contextPaneLabel } from '../src/renderer/walk-context';
import {
  definitionFrom,
  readWalksAnswer,
  uncoveredBy,
  walkPlaceProblems,
  withContextCommits,
  withoutInvalidPlaces,
  type ContextReader,
  type ProposedWalks,
} from '../src/shared/review-agent';
import { computeCoverage, emptyReviewState, parseReviewDefinition, stepContentHash, type ContextPlace, type DiffFile } from '../src/shared/review-model';
import { isPairError, type AgentJob, type OpenPair, type PairRecord } from '../src/shared/review-pair';

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

const FORMAT_V1 = 'export function formatCount(count: number): string {\n  return count === 1 ? "1 item" : `${count} items`;\n}\n';
const FORMAT_HEAD = 'export function formatCount(count: number): string {\n  // after 1.0.0: thousands are grouped\n  return count === 1 ? "1 item" : `${count.toLocaleString("en")} items`;\n}\n';
const REPORT_BASE = 'export const report = (count: number): string => String(count);\n';
const REPORT_TARGET = "import { formatCount } from 'count-lib';\n\nexport const report = (count: number): string => formatCount(count);\n";

let workspace: string;
let records: string;
let app: string;
let lib: string;
let lib10: string;
let libHead: string;
let appBase: string;
/** app To commits: one declaring count-lib 1.0.0 (tagged), one declaring nothing. */
let appDeclared: string;
let appUndeclared: string;

before(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-context-'));
  records = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-context-records-'));
  app = path.join(workspace, 'app');
  lib = path.join(workspace, 'count-lib');

  repository(lib);
  write(lib, 'package.json', JSON.stringify({ name: 'count-lib', version: '1.0.0' }, null, 2));
  write(lib, 'src/format.ts', FORMAT_V1);
  lib10 = commit(lib, 'count-lib 1.0.0');
  git(lib, 'tag', 'v1.0.0');
  write(lib, 'src/format.ts', FORMAT_HEAD);
  libHead = commit(lib, 'count-lib: group thousands');
  // A working-copy change that must never be what a walk shows.
  write(lib, 'src/format.ts', `${FORMAT_HEAD}// UNCOMMITTED\n`);

  repository(app);
  write(app, 'src/report.ts', REPORT_BASE);
  appBase = commit(app, 'app: start');
  write(app, 'src/report.ts', REPORT_TARGET);
  appUndeclared = commit(app, 'app: format the count');
  write(app, 'package.json', JSON.stringify({ name: 'app', dependencies: { 'count-lib': '1.0.0' } }, null, 2));
  appDeclared = commit(app, 'app: declare count-lib 1.0.0');
});

after(() => {
  for (const folder of [workspace, records]) {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
});

/** A step over the changed call, with places as the agent wrote them. */
function proposal(places: readonly unknown[]): ProposedWalks {
  const read = readWalksAnswer({
    summary: 'It formats the count.',
    walks: [{ kind: 'walk', title: 'Formatting', question: 'How is the count shown?', purpose: 'p', steps: [{ title: 'The call', body: 'It calls formatCount.', places }] }],
  });
  assert.ok(read.walks !== null);
  assert.deepEqual(read.problems, []);
  return read.walks;
}

const CALL = { label: 'The call', path: 'src/report.ts', side: 'target', start: 3, end: 3, anchor: 'formatCount' };

describe('reading a walk place that names a repository', () => {
  it('keeps it apart from the reviewed places, and says what is wrong with a malformed one', () => {
    const walks = proposal([CALL, { label: 'formatCount', repository: 'count-lib', path: 'src/format.ts', start: 1, end: 3, anchor: 'formatCount' }]);
    const step = walks.walks[0]?.steps[0];
    assert.deepEqual(step?.places.map((place) => place.range.path), ['src/report.ts']);
    assert.deepEqual(step?.contextPlaces?.map((place) => [place.range.repository, place.range.path, place.range.start, place.range.end, place.range.commit]), [['count-lib', 'src/format.ts', 1, 3, '']]);

    const bad = readWalksAnswer({ walks: [{ title: 't', steps: [{ title: 's', body: 'b', places: [CALL, { repository: 'count-lib', path: 'src/format.ts' }] }] }] });
    assert.ok(bad.problems.some((problem) => /names a repository but not a path inside it and 1-based lines/.test(problem)), JSON.stringify(bad.problems));
    const alone = readWalksAnswer({ walks: [{ title: 't', steps: [{ title: 's', body: 'b', places: [{ repository: 'count-lib', path: 'src/format.ts', start: 1, end: 1 }] }] }] });
    assert.ok(alone.problems.some((problem) => /only places in context repositories/.test(problem)), JSON.stringify(alone.problems));
  });
});

describe('checking context walk places at the recorded commit', () => {
  let pairs: ReviewPairs;
  let open: OpenPair;
  let reader: ContextReader;

  before(async () => {
    pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs-a'), changed: () => undefined });
    await pairs.repositories([workspace]);
    const opened = await pairs.openPair({ repository: app, base: appBase, target: appDeclared });
    assert.ok(!isPairError(opened));
    open = opened;
    const snapshots = new RevisionSnapshots({ root: path.join(records, 'revisions-a'), log: () => undefined });
    const snapshot = await snapshots.acquire(open.key, open.pair, { base: new Set(), target: new Set() }, 'test', [{ name: 'count-lib', path: lib }]);
    snapshots.release(open.key, 'test');
    await snapshots.settled();
    assert.deepEqual(snapshot.manifest.context.map((entry) => [entry.name, entry.commit, entry.how, entry.established]), [['count-lib', lib10, 'dependency', true]]);
    reader = contextReaderOf(snapshot.manifest.context);
  });

  it('keeps a valid place with the recorded commit and leaves out an unknown repository, missing lines, a wrong commit and a wrong anchor', async () => {
    const walks = proposal([
      CALL,
      { label: 'ok', repository: 'count-lib', path: 'src/format.ts', start: 1, end: 3, anchor: 'formatCount' },
      { label: 'unknown repository', repository: 'elsewhere', path: 'src/format.ts', start: 1, end: 1 },
      // Line 4 exists only at HEAD; the analysis read v1.0.0.
      { label: 'beyond the file', repository: 'count-lib', path: 'src/format.ts', start: 4, end: 4 },
      { label: 'wrong commit', repository: 'count-lib', commit: libHead.slice(0, 12), path: 'src/format.ts', start: 1, end: 1 },
      { label: 'wrong anchor', repository: 'count-lib', path: 'src/format.ts', start: 1, end: 1, anchor: 'toLocaleString' },
      { label: 'named commit that is the recorded one', repository: 'count-lib', commit: lib10.slice(0, 10), path: 'src/format.ts', start: 2, end: 2 },
    ]);
    const read = (side: 'base' | 'target', filePath: string): Promise<readonly string[] | null> => pairs.linesAt(open.key, side, filePath);
    const invalid = await walkPlaceProblems(walks, read, reader);
    assert.deepEqual([...invalid.keys()].sort(), ['0.0.c1', '0.0.c2', '0.0.c3', '0.0.c4']);
    assert.match(invalid.get('0.0.c1') ?? '', /elsewhere is not a context repository of this review/);
    assert.match(invalid.get('0.0.c2') ?? '', /has 3 lines at/);
    assert.match(invalid.get('0.0.c3') ?? '', new RegExp(`names commit ${libHead.slice(0, 12)}, but this review read count-lib at ${lib10.slice(0, 12)}`));
    assert.match(invalid.get('0.0.c4') ?? '', /anchor "toLocaleString" does not occur/);
    const kept = await withContextCommits(withoutInvalidPlaces(walks, invalid), reader);
    assert.deepEqual(
      kept.walks[0]?.steps[0]?.contextPlaces?.map((place) => [place.label, place.range.commit]),
      [
        ['ok', lib10],
        ['named commit that is the recorded one', lib10],
      ],
    );
    // Without context given, every context place is left out, and the step still stands on its reviewed place.
    const none = await walkPlaceProblems(walks, read, null);
    assert.equal([...none.keys()].filter((key) => key.includes('.c')).length, 6);
    assert.equal(withoutInvalidPlaces(walks, none).walks[0]?.steps[0]?.contextPlaces, undefined);
  });

  it('stores a context place apart from the places, and it adds nothing to coverage, even at a changed path', async () => {
    // A context place at the very path and lines the change has: still never covered.
    const withContext = proposal([CALL, { label: 'same path, other repository', repository: 'count-lib', path: 'src/format.ts', start: 1, end: 3 }]);
    const checked = await withContextCommits(withContext, reader);
    const step = checked.walks[0]?.steps[0];
    assert.ok(step?.contextPlaces !== undefined);
    const sameAsChange = { ...checked, walks: [{ ...checked.walks[0]!, steps: [{ ...step, contextPlaces: [{ ...step.contextPlaces[0]!, range: { ...step.contextPlaces[0]!.range, path: 'src/report.ts', start: 1, end: 3 } }] }] }] };
    const without = proposal([CALL]);
    assert.deepEqual(uncoveredBy(sameAsChange, open.files), uncoveredBy(without, open.files));

    const definition = definitionFrom(sameAsChange, open.pair, 'Walks', 'Test');
    const stored = (definition['walks'] as { steps: Record<string, unknown>[] }[])[0]?.steps[0];
    assert.equal((stored?.['places'] as unknown[]).length, 1, 'the reviewed places only');
    assert.deepEqual((stored?.['contextPlaces'] as { focus: unknown }[])[0]?.focus, {
      kind: 'context',
      repository: 'count-lib',
      commit: lib10,
      path: 'src/report.ts',
      start: 1,
      end: 3,
      role: 'context',
    });
    const parsed = parseReviewDefinition(JSON.parse(JSON.stringify(definition)) as unknown);
    assert.deepEqual(parsed.problems, []);
    const parsedStep = parsed.definition?.walks[0]?.steps[0];
    assert.equal(parsedStep?.contextPlaces?.[0]?.focus.commit, lib10);
    assert.deepEqual(parsedStep?.refs.map((ref) => ref.path), ['src/report.ts'], 'a context place is not a reference that coverage reads');
    const plain = parseReviewDefinition(JSON.parse(JSON.stringify(definitionFrom(without, open.pair, 'Walks', 'Test'))) as unknown);
    assert.ok(parsed.definition !== null && plain.definition !== null);
    const diffFiles: DiffFile[] = [{ path: 'src/report.ts', status: 'modified', binary: false, added: 3, deleted: 1, hunks: [{ id: '1', path: 'src/report.ts', baseStart: 1, baseCount: 1, targetStart: 1, targetCount: 3 }] }];
    const state = emptyReviewState({ base: open.pair.base, target: open.pair.target }, 'x', 'y');
    assert.deepEqual(computeCoverage(parsed.definition, diffFiles, state), computeCoverage(plain.definition, diffFiles, state));
  });
});

describe('definitions written before context places', () => {
  it('load as they did: no context places, no problems, and the same step hash with or without an empty list', () => {
    const old = {
      format: 'dspatch-review/2',
      title: { sv: 'T', en: 'T' },
      repository: '/r',
      base: 'b'.repeat(40),
      target: 'c'.repeat(40),
      teachingMode: 'Generated',
      provenance: { sv: 'p', en: 'p' },
      overview: { sv: 'o', en: 'o' },
      walks: [
        {
          id: 'W1',
          title: { sv: 'W', en: 'W' },
          question: { sv: 'q', en: 'q' },
          steps: [{ id: 'W1.1', title: { sv: 's', en: 's' }, summary: { sv: 's', en: 's' }, body: { sv: 'b', en: 'b' }, places: [{ id: 'P1', label: { sv: 'l', en: 'l' }, focus: { path: 'a.ts', side: 'target', start: 1, end: 2, role: 'walk' } }] }],
        },
      ],
    };
    const parsed = parseReviewDefinition(old);
    assert.deepEqual(parsed.problems, []);
    const step = parsed.definition?.walks[0]?.steps[0];
    assert.ok(step !== undefined);
    assert.ok(!('contextPlaces' in step));
    const emptyList = parseReviewDefinition({ ...old, walks: [{ ...old.walks[0], steps: [{ ...old.walks[0]!.steps[0], contextPlaces: [] }] }] });
    const same = emptyList.definition?.walks[0]?.steps[0];
    assert.ok(same !== undefined);
    assert.equal(stepContentHash(same), stepContentHash(step));
    // A malformed context place is named and left out; the step still loads.
    const broken = parseReviewDefinition({ ...old, walks: [{ ...old.walks[0], steps: [{ ...old.walks[0]!.steps[0], contextPlaces: [{ id: 'K1', label: { sv: 'k', en: 'k' }, focus: { repository: 'lib', commit: 'HEAD', path: 'a.ts', start: 1, end: 1 } }] }] }] });
    assert.equal(broken.definition?.walks[0]?.steps[0]?.contextPlaces, undefined);
    assert.equal(broken.definition?.walks[0]?.steps[0]?.places.length, 1);
    assert.ok(broken.problems.some((problem) => /full commit/.test(problem.problem)));
  });
});

describe('what a context pane says', () => {
  const place: ContextPlace = { id: 'K1', label: { sv: 'f', en: 'f' }, focus: { kind: 'context', repository: 'count-lib', commit: 'a'.repeat(40), path: 'src/format.ts', start: 2, end: 3, anchor: 'return' } };
  const view = (how: 'submodule' | 'dependency' | 'path-dependency' | 'head', established: boolean): Parameters<typeof contextPaneLabel>[1] => ({
    repository: 'count-lib',
    commit: 'a'.repeat(40),
    path: 'src/format.ts',
    text: FORMAT_HEAD,
    binary: false,
    how,
    established,
    note: '',
  });

  it('names the repository, file, lines and commit, and never presents HEAD as the build dependency', () => {
    const established = contextPaneLabel(place, view('dependency', true));
    assert.deepEqual([established.repository, established.path, established.lines, established.shortCommit, established.commit, established.relation], ['count-lib', 'src/format.ts', 'lines 2–3', 'aaaaaaaaaa', 'a'.repeat(40), 'established']);
    assert.match(established.how, /tag of the version the reviewed To commit declares/);
    const head = contextPaneLabel(place, view('head', false));
    assert.equal(head.relation, 'not-established');
    assert.match(head.relationText, /^Relation to the reviewed build not established/);
    assert.match(head.how, /^HEAD when the analysis ran$/);
    assert.equal(contextPaneLabel(place, view('path-dependency', false)).relation, 'not-established');
    // Before the record answers, when it fails, or when it names another commit: unknown, said as such.
    assert.equal(contextPaneLabel(place, null).relation, 'unknown');
    assert.equal(contextPaneLabel(place, { error: 'x' }).relation, 'unknown');
    assert.equal(contextPaneLabel(place, { ...(view('dependency', true) as object), commit: 'b'.repeat(40) } as Parameters<typeof contextPaneLabel>[1]).relation, 'unknown');
  });

  it('shows the lines around the place, or why it cannot', () => {
    const shown = contextExcerpt(place, FORMAT_HEAD);
    assert.ok(!('problem' in shown));
    assert.equal(shown.from, 1);
    assert.equal(shown.lines.length, 4);
    assert.ok('problem' in contextExcerpt({ ...place, focus: { ...place.focus, start: 9, end: 9 } }, FORMAT_HEAD));
    assert.ok('problem' in contextExcerpt({ ...place, focus: { ...place.focus, anchor: 'nowhere' } }, FORMAT_HEAD));
  });
});

describe('a prepared walk through the real services with the simulated agent', () => {
  async function prepared(target: string, label: string): Promise<{ readonly job: AgentJob; readonly contexts: ReviewContexts; readonly open: OpenPair }> {
    const pairs = new ReviewPairs({ recordsDir: path.join(records, `pairs-${label}`), changed: () => undefined });
    await pairs.repositories([workspace]);
    const opened = await pairs.openPair({ repository: app, base: appBase, target });
    assert.ok(!isPairError(opened));
    const contexts = new ReviewContexts({
      recordsDir: path.join(records, `context-${label}`),
      workspace: async () => ({ folders: [workspace], repositories: await pairs.repositories([workspace]) }),
      log: () => undefined,
    });
    const jobs = new ReviewAgentJobs({
      recordsDir: path.join(records, `jobs-${label}`),
      createAdapter: () => new PresentationAdapter({ deltaMs: 1 }),
      snapshots: new RevisionSnapshots({ root: path.join(records, `revisions-${label}`), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
      contexts,
    });
    try {
      const started = jobs.start(opened.key, { kind: 'walks', provider: 'cursor', model: 'sim-model' });
      assert.ok(!isPairError(started));
      for (const until = Date.now() + 20_000; Date.now() < until; ) {
        const job = (pairs.state(opened.key) as PairRecord).jobs.find((entry) => entry.id === started.id);
        if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
          return { job, contexts, open: opened };
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('the walks job did not settle');
    } finally {
      await jobs.dispose();
    }
  }

  for (const [label, target, how, established, commitOf] of [
    ['declared', (): string => appDeclared, 'dependency', true, (): string => lib10],
    ['undeclared', (): string => appUndeclared, 'head', false, (): string => libHead],
  ] as const) {
    it(`shows formatCount from count-lib at the recorded commit (${label}: ${how}, established ${String(established)})`, async () => {
      const { job, contexts, open } = await prepared(target(), label);
      assert.equal(job.state, 'done', job.note);
      assert.match(job.note, /1 place\(s\) show code from other repositories of the workspace, read as context; they cover nothing\./);
      assert.deepEqual(job.uncovered, [], 'the reviewed change is covered by its own place alone');
      const parsed = parseReviewDefinition(JSON.parse(fs.readFileSync(job.definitionPath ?? '', 'utf8')) as unknown);
      assert.deepEqual(parsed.problems, []);
      const steps = parsed.definition?.walks.flatMap((walk) => walk.steps) ?? [];
      const contextPlaces = steps.flatMap((step) => step.contextPlaces ?? []);
      assert.deepEqual(contextPlaces.map((place) => place.focus), [
        { kind: 'context', repository: 'count-lib', commit: commitOf(), path: 'src/format.ts', start: 1, end: established ? 3 : 4, anchor: 'formatCount', note: contextPlaces[0]?.focus.note },
      ]);
      assert.ok(steps.every((step) => step.places.every((place) => place.focus.path !== 'src/format.ts')), 'never a reviewed place');
      // The pane's content and label come from the review's context record, at that commit.
      const file = await contexts.readFile(open.key, open.pair, 'count-lib', 'src/format.ts', commitOf());
      assert.ok(!isPairError(file));
      assert.equal(file.text, established ? FORMAT_V1 : FORMAT_HEAD, 'from Git at the commit, never the working copy');
      const shown = contextPaneLabel(contextPlaces[0]!, file);
      assert.deepEqual([shown.relation, file.how], [established ? 'established' : 'not-established', how]);
    });
  }
});
