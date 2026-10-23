/**
 * The review service against a real git repository: two commits, a working tree that
 * says something else, and a reviewer's record that must come back as it was left.
 *
 * Heavy because it runs git.
 *
 *     node --test tests/review-service.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ReviewService } from '../src/main/review-service.ts';
import { buildDiffRows, computeCoverage, type ReviewBundle } from '../src/shared/review-model.ts';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

interface Fixture {
  readonly root: string;
  readonly repo: string;
  readonly records: string;
  readonly definitionPath: string;
  readonly base: string;
  readonly target: string;
}

function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-review-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'src', 'keep.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  fs.writeFileSync(path.join(repo, 'src', 'gone.ts'), 'old\n');
  fs.writeFileSync(path.join(repo, 'src', 'untouched.ts'), 'export const needle = 42;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base commit');
  const base = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'src', 'keep.ts'), 'export const a = 1;\nexport const b = 20;\nexport const c = 3;\nexport const d = 4;\n');
  fs.rmSync(path.join(repo, 'src', 'gone.ts'));
  fs.writeFileSync(path.join(repo, 'src', 'new file.ts'), 'export const n = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'target commit');
  const target = git(repo, 'rev-parse', 'HEAD');
  // The working tree now disagrees with both commits; the review must not read it.
  fs.writeFileSync(path.join(repo, 'src', 'keep.ts'), 'WORKING TREE ONLY\n');

  const definitionPath = path.join(root, 'change.review.json');
  fs.writeFileSync(
    definitionPath,
    JSON.stringify({
      format: 'dspatch-review/1',
      title: 'fixture',
      repository: 'repo',
      base: base.slice(0, 7),
      target: target.slice(0, 7),
      teachingMode: 'Concise',
      provenance: 'test',
      walks: [
        {
          id: 'W1',
          title: 'w',
          question: 'q',
          steps: [
            {
              id: 'W1.1',
              title: 'b changes',
              text: 't',
              refs: [
                { path: 'src/keep.ts', side: 'target', start: 2, end: 4, role: 'walk', anchor: 'b = 20' },
                { path: 'src/gone.ts', side: 'base', start: 1, end: 1, role: 'walk', anchor: 'old' },
                { path: 'src/keep.ts', side: 'target', start: 1, end: 1, role: 'walk', anchor: 'not there' },
                { path: 'src/missing.ts', side: 'target', start: 1, end: 1, role: 'context' },
              ],
            },
          ],
        },
      ],
    }),
  );
  return { root, repo, records: path.join(root, 'records'), definitionPath, base, target };
}

async function open(fixture: Fixture): Promise<{ service: ReviewService; bundle: ReviewBundle }> {
  const service = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
  const outcome = await service.openDefinition(fixture.definitionPath);
  assert.equal(outcome.kind, 'opened', outcome.kind === 'failed' ? outcome.error : '');
  if (outcome.kind !== 'opened') {
    throw new Error('not opened');
  }
  return { service, bundle: outcome.bundle };
}

test('the review resolves both revisions, lists every changed file and reads content from the commits', async () => {
  const fixture = makeFixture();
  try {
    const { service, bundle } = await open(fixture);
    assert.equal(bundle.base.sha, fixture.base);
    assert.equal(bundle.target.sha, fixture.target);
    assert.equal(bundle.target.subject, 'target commit');
    assert.equal(bundle.singleCommit, true);
    assert.deepEqual(
      bundle.files.map((file) => [file.path, file.status]),
      [
        ['src/gone.ts', 'deleted'],
        ['src/keep.ts', 'modified'],
        ['src/new file.ts', 'added'],
      ],
    );

    const target = await service.readFile('target', 'src/keep.ts');
    assert.deepEqual(target, { kind: 'text', lines: ['export const a = 1;', 'export const b = 20;', 'export const c = 3;', 'export const d = 4;'] });
    const base = await service.readFile('base', 'src/keep.ts');
    assert.equal(base.kind, 'text');
    assert.deepEqual(await service.readFile('target', 'src/gone.ts'), { kind: 'missing' });

    // The diff rebuilt from the hunks reproduces both commits exactly.
    for (const file of bundle.files) {
      const before = await service.readFile('base', file.path);
      const after = await service.readFile('target', file.path);
      const baseLines = before.kind === 'text' ? before.lines : [];
      const targetLines = after.kind === 'text' ? after.lines : [];
      const rows = buildDiffRows(baseLines, targetLines, file.hunks);
      assert.deepEqual(rows.filter((row) => row.kind !== 'added').map((row) => row.text), baseLines, file.path);
      assert.deepEqual(rows.filter((row) => row.kind !== 'deleted').map((row) => row.text), targetLines, file.path);
    }

    // Files outside the diff can be listed and searched at either revision.
    assert.ok((await service.listFiles('target')).includes('src/untouched.ts'));
    assert.ok((await service.listFiles('base')).includes('src/gone.ts'));
    const hits = await service.search('target', 'needle');
    assert.deepEqual(hits.hits, [{ path: 'src/untouched.ts', line: 1, text: 'export const needle = 42;' }]);
    assert.deepEqual(await service.search('target', 'WORKING TREE ONLY'), { hits: [], truncated: false });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('every reference is validated: a wrong anchor and a missing file are reported, the rest pass', async () => {
  const fixture = makeFixture();
  try {
    const { bundle } = await open(fixture);
    assert.deepEqual(
      bundle.referenceProblems.map((problem) => [problem.stepId, problem.refIndex]),
      [
        ['W1.1', 2],
        ['W1.1', 3],
      ],
    );
    assert.match(bundle.referenceProblems[0]?.problem ?? '', /"not there" does not occur/);
    assert.match(bundle.referenceProblems[1]?.problem ?? '', /does not exist at target/);
    const coverage = computeCoverage(bundle.definition, bundle.files, bundle.state);
    assert.deepEqual(
      coverage.hunks.map((entry) => [entry.hunk.path, entry.planned]),
      [
        ['src/gone.ts', 'full'],
        ['src/keep.ts', 'full'],
        ['src/keep.ts', 'full'],
        ['src/new file.ts', 'none'],
      ],
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the record is saved, reopened as left, and refused for another revision pair', async () => {
  const fixture = makeFixture();
  try {
    const first = await open(fixture);
    const state = {
      ...first.bundle.state,
      position: { walkId: 'W1', stepId: 'W1.1', refIndex: 1, away: { path: 'src/untouched.ts', side: 'target' as const, start: 1, end: 1 }, codeMode: 'file' as const },
      shownSteps: { 'W1.1': '2026-10-23T10:00:00.000Z' },
      notes: [
        {
          id: 'n1',
          kind: 'question' as const,
          text: 'Why 20?',
          location: { path: 'src/keep.ts', side: 'target' as const, start: 2, end: 2 },
          stepId: 'W1.1',
          status: 'open' as const,
          resolution: '',
          createdAt: 't',
          updatedAt: 't',
          revisions: first.bundle.state.revisions,
        },
      ],
    };
    assert.equal(first.service.saveState(state).saved, true);
    assert.equal(
      first.service.saveState({ ...state, revisions: { ...state.revisions, target: state.revisions.base } }).saved,
      false,
      'a record for other code is not written over this review',
    );

    const second = await open(fixture);
    assert.deepEqual(second.bundle.state.position, state.position);
    assert.deepEqual(second.bundle.state.shownSteps, state.shownSteps);
    assert.deepEqual(second.bundle.state.walkedSteps, {});
    assert.deepEqual(second.bundle.state.decisions, []);
    assert.equal(second.bundle.state.notes[0]?.text, 'Why 20?');
    assert.equal(second.bundle.stateNote, '');

    // Editing the definition keeps the record and says so.
    const text = fs.readFileSync(fixture.definitionPath, 'utf8').replace('"title":"fixture"', '"title":"fixture 2"');
    fs.writeFileSync(fixture.definitionPath, text);
    const third = await open(fixture);
    assert.equal(third.bundle.state.notes.length, 1);
    assert.match(third.bundle.stateNote, /definition has changed/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a definition naming something that is not a commit fails with the reason', async () => {
  const fixture = makeFixture();
  try {
    const text = JSON.parse(fs.readFileSync(fixture.definitionPath, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(fixture.definitionPath, JSON.stringify({ ...text, target: 'no-such-revision' }));
    const outcome = await new ReviewService({ recordsDir: fixture.records, log: () => undefined }).openDefinition(
      fixture.definitionPath,
    );
    assert.equal(outcome.kind, 'failed');
    assert.match(outcome.kind === 'failed' ? outcome.error : '', /no-such-revision/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a damaged record is kept aside unchanged and the review still opens, saying so', async () => {
  const fixture = makeFixture();
  try {
    const first = await open(fixture);
    assert.equal(first.service.saveState(first.bundle.state).saved, true);
    const [recordName] = fs.readdirSync(fixture.records);
    assert.ok(recordName !== undefined);
    const recordPath = path.join(fixture.records, recordName);
    fs.writeFileSync(recordPath, '{ "version": 1, "revisions": ');
    const second = await open(fixture);
    assert.match(second.bundle.stateNote, /could not be used/);
    assert.deepEqual(second.bundle.state.decisions, []);
    const aside = fs.readdirSync(fixture.records).filter((name) => name.includes('.unusable-'));
    assert.equal(aside.length, 1);
    assert.equal(fs.readFileSync(path.join(fixture.records, aside[0] ?? ''), 'utf8'), '{ "version": 1, "revisions": ');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the service refuses agent provenance, other revisions and malformed file requests from the view', async () => {
  const fixture = makeFixture();
  try {
    const { service, bundle } = await open(fixture);
    const decision = {
      id: 'd1',
      scope: { kind: 'hunk' as const, path: 'src/keep.ts', hunkId: 'H2' },
      outcome: 'accepted' as const,
      reason: '',
      at: 't',
      revisions: bundle.state.revisions,
    };
    assert.equal(service.saveState({ ...bundle.state, decisions: [{ ...decision, by: { kind: 'human' } }] }).saved, true);
    const agent = service.saveState({
      ...bundle.state,
      decisions: [{ ...decision, by: { kind: 'agent-delegated', adapterId: 'x', mandate: 'y' } }],
    });
    assert.equal(agent.saved, false);
    assert.match(agent.error ?? '', /Only decisions made by a person/);
    assert.equal(service.saveState('nonsense').saved, false);

    assert.equal((await service.readFile('target', '')).kind, 'failed');
    assert.equal((await service.readFile('middle' as 'target', 'src/keep.ts')).kind, 'failed');
    assert.deepEqual(await service.listFiles('middle' as 'target'), []);
    assert.ok((await service.search('middle' as 'target', 'needle')).error !== undefined);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
