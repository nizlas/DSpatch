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
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { ReviewService, reviewRecordKey } from '../src/main/review-service.ts';
import { PROVIDER_ADDED_CONTEXT_LINE, buildEnvelopePrompt, subjectLine } from '../src/shared/review-discussion.ts';
import {
  buildDiffRows,
  computeCoverage,
  type CodeLocation,
  type ReviewBundle,
  type ReviewNote,
  type RevisionPair,
} from '../src/shared/review-model.ts';
import { WORKING_TREE_ONLY, makeReviewFixture, writeWalkDefinition, type ReviewFixture } from './support/review-fixture.ts';

const makeFixture = makeReviewFixture;
type Fixture = ReviewFixture;

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
      bundle.referenceProblems.map((problem) => [problem.stepId, problem.refId]),
      [
        ['W1.1', 'r3'],
        ['W1.1', 'r4'],
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
    assert.equal(second.bundle.stateNotice, null);

    // Editing the definition keeps the record and says so.
    const text = fs.readFileSync(fixture.definitionPath, 'utf8').replace('"title":"fixture"', '"title":"fixture 2"');
    fs.writeFileSync(fixture.definitionPath, text);
    const third = await open(fixture);
    assert.equal(third.bundle.state.notes.length, 1);
    assert.deepEqual(third.bundle.stateNotice, { kind: 'definition-changed', carriedStepMarks: 1, movedStepMarks: 0 });
    assert.deepEqual(third.bundle.state.shownSteps, state.shownSteps, 'an unchanged step keeps its mark');
    assert.deepEqual(third.bundle.state.markHistory, []);
    // The earlier definition is remembered, so the change stays visible after this notice.
    assert.equal(third.bundle.state.previousDefinitionHashes.length, 1);
    assert.equal(third.bundle.state.previousDefinitionHashes[0], second.bundle.definitionHash);
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

test('a save goes to the record of the review it names, also after the window has opened another', async () => {
  const fixture = makeFixture();
  try {
    const walkPath = writeWalkDefinition(fixture);
    const service = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
    const identified = await service.identify(walkPath);
    assert.ok('identity' in identified);
    const first = await service.openDefinition(fixture.definitionPath);
    const second = await service.openDefinition(walkPath);
    assert.equal(first.kind, 'opened');
    assert.equal(second.kind, 'opened');
    if (first.kind !== 'opened' || second.kind !== 'opened') {
      return;
    }
    // identify() names the same record openDefinition() uses, without opening anything.
    assert.equal(
      identified.identity.key,
      reviewRecordKey(second.bundle.repository, second.bundle.base.sha, second.bundle.target.sha, second.bundle.definitionPath),
    );
    // The first review's last state arrives after the second has opened: it is written
    // to the first review's record, not to the one now open.
    const late = { ...first.bundle.state, position: { ...first.bundle.state.position, stepId: 'W1.1' } };
    assert.equal(service.saveState(late).saved, true);
    const firstRecord = path.join(
      fixture.records,
      `${reviewRecordKey(first.bundle.repository, first.bundle.base.sha, first.bundle.target.sha, first.bundle.definitionPath)}.json`,
    );
    const secondRecord = path.join(fixture.records, `${identified.identity.key}.json`);
    assert.equal(JSON.parse(fs.readFileSync(firstRecord, 'utf8')).definitionPath, first.bundle.definitionPath);
    assert.equal(fs.existsSync(secondRecord), false);
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
    assert.equal(second.bundle.stateNotice?.kind, 'unusable');
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

test('the display language is saved beside the records and read back by a new service', async () => {
  const fixture = makeFixture();
  try {
    const first = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
    assert.deepEqual(first.getPreferences(), { language: 'en' }, 'English until chosen otherwise');
    assert.deepEqual(first.setPreferences({ language: 'sv' }), { saved: true });
    assert.equal(first.setPreferences({ language: 'de' }).saved, false);
    // A stored Swedish choice overrides the English default in the next service.
    const second = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
    assert.deepEqual(second.getPreferences(), { language: 'sv' });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function note(id: string, stepId: string | null, location: CodeLocation | null, revisions: RevisionPair): ReviewNote {
  return { id, kind: 'finding', text: `note ${id}`, location, stepId, status: 'open', resolution: '', createdAt: 't', updatedAt: 't', revisions };
}

test('a question\'s envelope carries the code at the reviewed commit, never the working tree, and the notes that concern it', async () => {
  const fixture = makeFixture();
  try {
    const { service, bundle } = await open(fixture);
    const revisions = bundle.state.revisions;
    // Notes come from the record as last saved, not from anything the window sends with the question.
    assert.equal(
      service.saveState({
        ...bundle.state,
        notes: [
          note('on-step', 'W1.1', null, revisions),
          note('on-focus', null, { path: 'src/keep.ts', side: 'target', start: 3, end: 3 }, revisions),
          note('on-selection', null, { path: 'src/gone.ts', side: 'base', start: 1, end: 1 }, revisions),
          note('elsewhere', null, { path: 'src/untouched.ts', side: 'target', start: 1, end: 1 }, revisions),
        ],
      }).saved,
      true,
    );

    const point = await service.envelopeFor({
      subject: { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 0 },
      selection: { path: 'src/gone.ts', side: 'base', start: 1, end: 1 },
      language: 'en',
    });
    assert.equal(point.kind, 'built', point.kind === 'refused' ? point.error : '');
    if (point.kind !== 'built') {
      return;
    }
    const envelope = point.envelope;
    assert.equal(envelope.identity.target.sha, fixture.target);
    assert.equal(envelope.identity.base.subject, 'base commit');
    const focus = envelope.ranges.find((range) => range.role === 'focus');
    assert.deepEqual(focus?.lines, ['export const b = 20;', 'export const c = 3;', 'export const d = 4;']);
    assert.equal(focus?.sha, fixture.target);
    const selected = envelope.ranges.find((range) => range.role === 'selection');
    assert.deepEqual([selected?.lines, selected?.sha], [['old'], fixture.base]);
    assert.deepEqual(envelope.notes.map((entry) => entry.text), ['note on-step', 'note on-focus', 'note on-selection']);
    assert.equal(envelope.explanation?.stepTitle, 'b changes');
    assert.equal(envelope.explanation?.walkNumber, 1);
    assert.equal(envelope.providerContext, PROVIDER_ADDED_CONTEXT_LINE);

    // The working tree says something else; it never reaches the text sent.
    const prompt = buildEnvelopePrompt(envelope, 'Why 20?', null);
    assert.ok(prompt.includes('2 | export const b = 20;'));
    assert.ok(!prompt.includes(WORKING_TREE_ONLY));
    assert.equal(fs.readFileSync(path.join(fixture.repo, 'src', 'keep.ts'), 'utf8'), `${WORKING_TREE_ONLY}\n`);

    // A code location away from the walk, and a place whose file is not in the commit.
    const away = await service.envelopeFor({ subject: { kind: 'away', location: { path: 'src/keep.ts', side: 'base', start: 2, end: 2, extra: 'dropped' } }, selection: null });
    assert.equal(away.kind, 'built');
    if (away.kind === 'built') {
      assert.deepEqual(away.envelope.ranges.map((range) => [range.role, range.lines, range.sha]), [['location', ['export const b = 2;'], fixture.base]]);
      assert.deepEqual(away.envelope.subject, { kind: 'away', location: { path: 'src/keep.ts', side: 'base', start: 2, end: 2 } });
      assert.deepEqual(away.envelope.notes, []);
    }
    const missing = await service.envelopeFor({ subject: { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 3 }, selection: null });
    assert.match(missing.kind === 'built' ? (missing.envelope.ranges[0]?.problem ?? '') : '', /src\/missing\.ts does not exist at target/);

    // The review as a whole: overview and changed files, every note, and no code unless something is selected.
    const whole = await service.envelopeFor({ subject: { kind: 'review' }, selection: null });
    assert.equal(whole.kind, 'built');
    if (whole.kind === 'built') {
      assert.deepEqual(whole.envelope.ranges, []);
      assert.deepEqual(whole.envelope.overview?.changedFiles.map((file) => file.path), ['src/gone.ts', 'src/keep.ts', 'src/new file.ts']);
      assert.deepEqual(whole.envelope.overview?.walkTitles, ['w']);
      assert.equal(whole.envelope.notes.length, 4);
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a question about something the review does not have is refused in plain words', async () => {
  const fixture = makeFixture();
  try {
    const { service } = await open(fixture);
    const refused = async (request: unknown): Promise<string> => {
      const outcome = await service.envelopeFor(request);
      assert.equal(outcome.kind, 'refused', JSON.stringify(request));
      return outcome.kind === 'refused' ? outcome.error : '';
    };
    assert.equal(await refused({ subject: { kind: 'point', walkId: 'W9', stepId: 'W1.1', placeIndex: 0 }, selection: null }), 'This review has no walk "W9".');
    assert.equal(await refused({ subject: { kind: 'point', walkId: 'W1', stepId: 'W9.9', placeIndex: 0 }, selection: null }), 'Walk "W1" has no step "W9.9".');
    assert.equal(await refused({ subject: { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 9 }, selection: null }), 'Step "W1.1" has no place 9.');
    assert.match(await refused({ subject: { kind: 'away', location: { path: 'src/keep.ts', side: 'target', start: 0, end: 1 } }, selection: null }), /not a valid location/);
    assert.match(await refused({ subject: { kind: 'review' }, selection: { path: 'src/keep.ts', side: 'working', start: 1, end: 1 } }), /selected lines/);
    assert.match(await refused({ subject: { kind: 'anything' }, selection: null }), /not about a point/);
    assert.equal(await refused(null), 'The question has no subject.');
    const closed = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
    assert.deepEqual(await closed.envelopeFor({ subject: { kind: 'review' }, selection: null }), { kind: 'refused', error: 'No review is open.' });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

/** A definition placed inside `repo` at `examples/review/`, naming the clone root as `../..`. */
function definitionInClone(fixture: Fixture, clone: string, revisions: { base: string; target: string }): string {
  const original = JSON.parse(fs.readFileSync(fixture.definitionPath, 'utf8')) as Record<string, unknown>;
  const folder = path.join(clone, 'examples', 'review');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'example.review.json');
  fs.writeFileSync(file, JSON.stringify({ ...original, repository: '../..', ...revisions }));
  return file;
}

test('a definition inside a clone names the clone root relatively and reviews its two commits there (DSP-129)', async () => {
  const fixture = makeFixture();
  try {
    const file = definitionInClone(fixture, fixture.repo, { base: fixture.base, target: fixture.target });
    const service = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
    const outcome = await service.openDefinition(file);
    assert.equal(outcome.kind, 'opened', outcome.kind === 'failed' ? outcome.error : '');
    if (outcome.kind !== 'opened') {
      return;
    }
    assert.equal(outcome.bundle.repository, path.resolve(fixture.repo));
    assert.equal(outcome.bundle.base.sha, fixture.base);
    assert.equal(outcome.bundle.target.sha, fixture.target);
    // The reviewer's state goes to the records folder; nothing is written beside the definition.
    assert.equal(service.saveState(outcome.bundle.state).saved, true);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['example.review.json']);
    assert.ok(fs.readdirSync(fixture.records).some((name) => name.endsWith('.json')));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('missing history is explained plainly, and nothing is opened in its place (DSP-129)', async () => {
  const fixture = makeFixture();
  try {
    const service = new ReviewService({ recordsDir: fixture.records, log: () => undefined });

    // A shallow clone holds only the target commit.
    const shallow = path.join(fixture.root, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(fixture.repo).href, shallow], { encoding: 'utf8' });
    const inShallow = definitionInClone(fixture, shallow, { base: fixture.base, target: fixture.target });
    const fromShallow = await service.openDefinition(inShallow);
    assert.equal(fromShallow.kind, 'failed');
    const shallowError = fromShallow.kind === 'failed' ? fromShallow.error : '';
    assert.match(shallowError, new RegExp(fixture.base));
    assert.match(shallowError, /shallow clone/);
    assert.match(shallowError, /full clone/);
    // Git's own words are the detail, not the message.
    assert.doesNotMatch(shallowError, /fatal|git log|`/);
    assert.match(fromShallow.kind === 'failed' ? (fromShallow.detail ?? '') : '', /git log/);

    // A copy of the files with no history at all.
    const copy = path.join(fixture.root, 'copy');
    fs.mkdirSync(copy);
    const inCopy = definitionInClone(fixture, copy, { base: fixture.base, target: fixture.target });
    const fromCopy = await service.openDefinition(inCopy);
    assert.equal(fromCopy.kind, 'failed');
    const copyError = fromCopy.kind === 'failed' ? fromCopy.error : '';
    assert.match(copyError, /not a git repository/);
    assert.match(copyError, /full clone/);
    assert.match(fromCopy.kind === 'failed' ? (fromCopy.detail ?? '') : '', /not a git repository/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('git that cannot run, and git that cannot read the repository, are each said as such (DSP-129)', async () => {
  const fixture = makeFixture();
  const savedPath = process.env['PATH'];
  try {
    const service = new ReviewService({ recordsDir: fixture.records, log: () => undefined });

    // No git on PATH: an empty folder is the whole PATH, on any platform.
    const empty = path.join(fixture.root, 'no-git-here');
    fs.mkdirSync(empty);
    process.env['PATH'] = empty;
    const noGit = await service.openDefinition(fixture.definitionPath);
    process.env['PATH'] = savedPath;
    assert.equal(noGit.kind, 'failed');
    const noGitError = noGit.kind === 'failed' ? noGit.error : '';
    assert.match(noGitError, /git was not found on PATH/);
    assert.doesNotMatch(noGitError, /not a git repository|ENOENT/);
    assert.match(noGit.kind === 'failed' ? (noGit.detail ?? '') : '', /ENOENT|not found|cannot find/i);

    // Git runs but cannot read this repository (here a broken config file).
    fs.writeFileSync(path.join(fixture.repo, '.git', 'config'), '[[[ not a config\n');
    const unreadable = await service.openDefinition(fixture.definitionPath);
    assert.equal(unreadable.kind, 'failed');
    const unreadableError = unreadable.kind === 'failed' ? unreadable.error : '';
    assert.match(unreadableError, /Git could not read the repository at/);
    assert.match(unreadableError, /under Details/);
    assert.doesNotMatch(unreadableError, /not a git repository|fatal/);
    assert.match(unreadable.kind === 'failed' ? (unreadable.detail ?? '') : '', /config/);
  } finally {
    process.env['PATH'] = savedPath;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// Niclas's trial (30 October 2026): a selected variable must reach the question exactly.
test('a selected quote is checked against its revision and sent first, exactly; text from an explanation gets no place', async () => {
  const fixture = makeFixture();
  try {
    const { service } = await open(fixture);
    const point = { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 0 } as const;
    // `20` on line 2 of keep.ts at To (`export const b = 20;`, characters 18–19), and `b = 2` on line 2 at From.
    const built = await service.envelopeFor({
      subject: point,
      selection: null,
      language: 'en',
      quote: { kind: 'code', text: '20', segments: [{ side: 'target', path: 'src/keep.ts', start: 2, end: 2, from: 17, to: 19 }] },
    });
    assert.equal(built.kind, 'built', built.kind === 'refused' ? built.error : '');
    if (built.kind !== 'built') {
      return;
    }
    assert.deepEqual(built.envelope.quote, { kind: 'code', segments: [{ side: 'target', path: 'src/keep.ts', start: 2, end: 2, from: 17, to: 19, sha: fixture.target, text: '20' }] });
    const prompt = buildEnvelopePrompt(built.envelope, 'What have I selected?', null);
    const selected = prompt.indexOf('## What the person selected');
    assert.ok(selected > 0 && selected < prompt.indexOf('## Code'), 'the selection comes before the background code');
    assert.ok(prompt.includes(`Selected code, src/keep.ts line 2, characters 18–19 · target (To) @ ${fixture.target}:`));
    assert.match(subjectLine(built.envelope), /selected “20”$/);

    // Several lines at From, and a quote whose text is not what the revision has there.
    const lines = await service.envelopeFor({
      subject: point,
      selection: null,
      quote: { kind: 'code', text: 'b = 2;\nexport const c', segments: [{ side: 'base', path: 'src/keep.ts', start: 2, end: 3, from: 13, to: 14 }] },
    });
    assert.equal(lines.kind === 'built' && lines.envelope.quote?.kind === 'code' ? lines.envelope.quote.segments[0]?.text : null, 'b = 2;\nexport const c');
    const wrong = await service.envelopeFor({
      subject: point,
      selection: null,
      quote: { kind: 'code', text: '20', segments: [{ side: 'base', path: 'src/keep.ts', start: 2, end: 2, from: 17, to: 19 }] },
    });
    assert.match(wrong.kind === 'refused' ? wrong.error : '', /not what the revision has/);
    const outside = await service.envelopeFor({
      subject: point,
      selection: null,
      quote: { kind: 'code', text: 'x', segments: [{ side: 'target', path: 'src/keep.ts', start: 9, end: 9, from: 0, to: 1 }] },
    });
    assert.match(outside.kind === 'refused' ? outside.error : '', /not at those lines in the To revision/);

    // Text from the explanation: quoted with its passage, never with a place in the code.
    const text = await service.envelopeFor({
      subject: point,
      selection: null,
      quote: { kind: 'text', text: 'b changes', source: 'explanation', context: 'b changes from 2 to 20.', segments: [{ side: 'target', path: 'src/keep.ts', start: 1, end: 1, from: 0, to: 1 }] },
    });
    assert.deepEqual(text.kind === 'built' ? text.envelope.quote : null, { kind: 'text', text: 'b changes', source: 'explanation', context: 'b changes from 2 to 20.' });
    const textPrompt = text.kind === 'built' ? buildEnvelopePrompt(text.envelope, 'What does this mean?', null) : '';
    assert.ok(textPrompt.includes('(not code; it has no place in the code)') && !textPrompt.includes('Selected code,'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
