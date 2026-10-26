/**
 * The review flow through the review host's contract (DSP-111), against a real git
 * repository: opening and validating a definition, reading the two identified
 * commits, saving and reading back the reviewer's record and preferences, and the
 * discussion's context, all through `localReviewHost` as the review windows use it.
 *
 * Every answer is checked to come back unchanged from a JSON round trip: the
 * contract is plain data, so a later transport can carry it as it is. This is a local
 * binding in one process, not remote operation.
 *
 * Heavy because it runs git.
 *
 *     node --test tests/review-host.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { localReviewHost } from '../src/host/local-review-host.ts';
import { ReviewHost } from '../src/host/review-host.ts';
import { locateExampleReview } from '../src/main/example-review.ts';
import { ownRepositoryRoot } from '../src/main/own-repository.ts';
import { ReviewService, reviewRecordKey } from '../src/main/review-service.ts';
import {
  isReviewHostError,
  type ReviewHostApi,
  type ReviewHostError,
  type ReviewHostOpened,
} from '../src/shared/review-host-contract.ts';
import { buildDiffRows, type ReviewBundle, type ReviewState } from '../src/shared/review-model.ts';
import { WORKING_TREE_ONLY, makeReviewFixture, writeWalkDefinition, type ReviewFixture } from './support/review-fixture.ts';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function hostFor(fixture: ReviewFixture, recordsDir = fixture.records): ReviewHostApi {
  return localReviewHost(new ReviewHost({ recordsDir, log: () => undefined }));
}

/** The answer as a transport would carry it: unchanged by a JSON round trip. */
function plain<T>(answer: T): T {
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), answer, 'the answer survives a JSON round trip unchanged');
  return answer;
}

/** A successful answer, or the test fails with the host's own words. */
function ok<T>(answer: T | ReviewHostError): T {
  plain(answer);
  if (isReviewHostError(answer)) {
    assert.fail(`host-error ${answer.code}: ${answer.message} ${answer.detail ?? ''}`);
  }
  return answer;
}

function failed(answer: unknown): ReviewHostError {
  plain(answer);
  assert.ok(isReviewHostError(answer), `expected a host-error, got ${JSON.stringify(answer)}`);
  return answer;
}

async function session(host: ReviewHostApi): Promise<string> {
  return ok(await host.createSession()).sessionId;
}

async function openIn(host: ReviewHostApi, sessionId: string, definitionPath: string, remember = false): Promise<{ bundle: ReviewBundle; opened: ReviewHostOpened }> {
  const opened = ok(await host.open({ sessionId, definitionPath, remember }));
  assert.equal(opened.outcome.kind, 'opened', opened.outcome.kind === 'failed' ? opened.outcome.error : opened.outcome.kind);
  if (opened.outcome.kind !== 'opened') {
    throw new Error('not opened');
  }
  return { bundle: opened.outcome.bundle, opened };
}

test('through the host: a definition opens at its identified commits, and code, diff, files and search come from those commits', async () => {
  const fixture = makeReviewFixture();
  try {
    const host = hostFor(fixture);
    const sessionId = await session(host);

    const identified = ok(await host.identify({ sessionId, definitionPath: fixture.definitionPath }));
    assert.ok('identity' in identified, 'identify names the review without opening it');

    const { bundle, opened } = await openIn(host, sessionId, fixture.definitionPath);
    assert.equal(bundle.base.sha, fixture.base);
    assert.equal(bundle.target.sha, fixture.target);
    assert.deepEqual(opened.identity, {
      key: reviewRecordKey(bundle.repository, fixture.base, fixture.target, bundle.definitionPath),
      definitionPath: bundle.definitionPath,
      repository: bundle.repository,
      base: fixture.base,
      target: fixture.target,
    });
    assert.deepEqual(opened.identity, 'identity' in identified ? identified.identity : null, 'identify and open name the same record');
    // Validation: the two broken references in the fixture are reported, the review still opens.
    assert.deepEqual(
      bundle.referenceProblems.map((problem) => [problem.stepId, problem.refId]),
      [
        ['W1.1', 'r3'],
        ['W1.1', 'r4'],
      ],
    );

    // Code at the target commit, never the working tree.
    const keep = ok(await host.readFile({ sessionId, side: 'target', path: 'src/keep.ts' }));
    assert.deepEqual(keep, { kind: 'text', lines: ['export const a = 1;', 'export const b = 20;', 'export const c = 3;', 'export const d = 4;'] });
    assert.deepEqual(ok(await host.readFile({ sessionId, side: 'target', path: 'src/gone.ts' })), { kind: 'missing' });

    // The diff in the bundle rebuilds both commits exactly from what the host reads.
    for (const file of bundle.files) {
      const before = ok(await host.readFile({ sessionId, side: 'base', path: file.path }));
      const after = ok(await host.readFile({ sessionId, side: 'target', path: file.path }));
      const baseLines = before.kind === 'text' ? before.lines : [];
      const targetLines = after.kind === 'text' ? after.lines : [];
      const rows = buildDiffRows(baseLines, targetLines, file.hunks);
      assert.deepEqual(rows.filter((row) => row.kind !== 'added').map((row) => row.text), baseLines, file.path);
      assert.deepEqual(rows.filter((row) => row.kind !== 'deleted').map((row) => row.text), targetLines, file.path);
    }

    assert.ok(ok(await host.listFiles({ sessionId, side: 'target' })).files.includes('src/untouched.ts'));
    assert.ok(ok(await host.listFiles({ sessionId, side: 'base' })).files.includes('src/gone.ts'));
    assert.deepEqual(ok(await host.search({ sessionId, side: 'target', query: 'needle' })).hits, [
      { path: 'src/untouched.ts', line: 1, text: 'export const needle = 42;' },
    ]);
    assert.deepEqual(ok(await host.search({ sessionId, side: 'target', query: WORKING_TREE_ONLY })), { hits: [], truncated: false });

    // Nothing is shared: changing what came back does not change what the host holds.
    if (keep.kind === 'text') {
      (keep.lines as string[]).length = 0;
    }
    assert.equal((ok(await host.readFile({ sessionId, side: 'target', path: 'src/keep.ts' })) as { lines: string[] }).lines.length, 4);

    // The discussion's context is built on the host from the commits.
    const envelope = ok(
      await host.envelopeFor({ sessionId, request: { subject: { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 0 }, selection: null, language: 'en' } }),
    );
    assert.equal(envelope.kind, 'built', envelope.kind === 'refused' ? envelope.error : '');
    assert.equal(envelope.kind === 'built' ? envelope.envelope.identity.target.sha : '', fixture.target);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('through the host: bad JSON and a bad reference are said in words, and a missing definition is definition-unreadable', async () => {
  const fixture = makeReviewFixture();
  try {
    const host = hostFor(fixture);
    const sessionId = await session(host);

    const badJson = path.join(fixture.root, 'bad.review.json');
    fs.writeFileSync(badJson, '{ "format": ');
    const bad = ok(await host.open({ sessionId, definitionPath: badJson, remember: true }));
    assert.equal(bad.outcome.kind, 'failed');
    assert.match(bad.outcome.kind === 'failed' ? bad.outcome.error : '', /is not valid JSON/);
    assert.equal(bad.identity, null);

    const text = JSON.parse(fs.readFileSync(fixture.definitionPath, 'utf8')) as Record<string, unknown>;
    const badRef = path.join(fixture.root, 'bad-ref.review.json');
    fs.writeFileSync(badRef, JSON.stringify({ ...text, target: 'no-such-revision' }));
    const noRevision = ok(await host.open({ sessionId, definitionPath: badRef, remember: true }));
    assert.equal(noRevision.outcome.kind, 'failed');
    assert.match(noRevision.outcome.kind === 'failed' ? noRevision.outcome.error : '', /no-such-revision/);

    const missing = failed(await host.open({ sessionId, definitionPath: path.join(fixture.root, 'nowhere.review.json'), remember: true }));
    assert.equal(missing.code, 'definition-unreadable');
    assert.match(missing.message, /could not be read: there is no such file\./);
    assert.match(missing.detail ?? '', /ENOENT/);
    assert.equal(failed(await host.identify({ sessionId, definitionPath: path.join(fixture.root, 'nowhere.review.json') })).code, 'definition-unreadable');

    // Nothing that failed was remembered as the last review.
    assert.deepEqual(ok(await host.lastReviewFor({ folder: fixture.repo })), { definitionPath: null });
    assert.equal(failed(await host.open({ sessionId, definitionPath: '', remember: true })).code, 'invalid-request');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('through the host: the record is saved and read back, an existing record is adopted unchanged, and the last review is remembered', async () => {
  const fixture = makeReviewFixture();
  try {
    // A record written by the service directly, as the app did before the host existed.
    const before = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
    const earlier = await before.openDefinition(fixture.definitionPath);
    assert.equal(earlier.kind, 'opened');
    const earlierState = earlier.kind === 'opened' ? earlier.bundle.state : (null as never);
    const withWork: ReviewState = {
      ...earlierState,
      shownSteps: { 'W1.1': '2026-10-23T10:00:00.000Z' },
      decisions: [
        {
          id: 'd1',
          scope: { kind: 'hunk', path: 'src/keep.ts', hunkId: 'H2' },
          outcome: 'accepted',
          reason: 'fine',
          at: 't',
          by: { kind: 'human' },
          revisions: earlierState.revisions,
        },
      ],
    };
    assert.equal(before.saveState(withWork).saved, true);
    const recordFile = path.join(fixture.records, `${reviewRecordKey(path.join(fixture.root, 'repo'), fixture.base, fixture.target, fixture.definitionPath)}.json`);
    const bytes = fs.readFileSync(recordFile, 'utf8');

    const host = hostFor(fixture);
    const sessionId = await session(host);
    const { bundle } = await openIn(host, sessionId, fixture.definitionPath, true);
    assert.deepEqual(bundle.state, JSON.parse(bytes), 'the existing record is the state, as it was');
    assert.equal(bundle.stateNotice, null);
    assert.equal(fs.readFileSync(recordFile, 'utf8'), bytes, 'opening wrote nothing to the record');

    // Save through the host and read it back in a new session.
    const moved = { ...bundle.state, position: { ...bundle.state.position, stepId: 'W1.1', refIndex: 1 } };
    const saved = ok(await host.saveState({ sessionId, state: moved }));
    assert.equal(saved.saved, true);
    const refused = ok(await host.saveState({ sessionId, state: { ...moved, revisions: { ...moved.revisions, target: moved.revisions.base } } }));
    assert.equal(refused.saved, false, 'a record for other code is refused, in words');
    assert.equal(typeof refused.error, 'string');

    const fresh = hostFor(fixture);
    const again = await openIn(fresh, await session(fresh), fixture.definitionPath);
    assert.deepEqual(again.bundle.state.position, moved.position);
    assert.deepEqual(again.bundle.state.decisions, withWork.decisions);

    // The recent index and the repository key are the host's.
    assert.deepEqual(ok(await host.lastReviewFor({ folder: path.join(fixture.repo, 'src') })), { definitionPath: bundle.definitionPath });
    const key = ok(await host.repositoryKey({ folder: path.join(fixture.repo, 'src') }));
    assert.equal(path.resolve(key.root), path.resolve(fixture.repo));
    const index = ok(await host.recentIndex()).index as { version: number; repositories: Record<string, { definitionPath: string }> };
    assert.equal(index.version, 1);
    assert.equal(index.repositories[key.key]?.definitionPath, bundle.definitionPath);

    // The scenario reading of the record names the same file and its saved position.
    const reading = ok(await host.recordReading({ key: path.basename(recordFile, '.json') }));
    assert.equal(reading.recordPath, recordFile);
    assert.deepEqual(reading.recordPosition, moved.position);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('through the host: a save that cannot be written is said plainly, and nothing is lost', async () => {
  const fixture = makeReviewFixture();
  try {
    const host = hostFor(fixture);
    const sessionId = await session(host);
    const { bundle, opened } = await openIn(host, sessionId, fixture.definitionPath);
    const first = { ...bundle.state, shownSteps: { 'W1.1': '2026-10-23T10:00:00.000Z' } };
    assert.equal(ok(await host.saveState({ sessionId, state: first })).saved, true);
    const recordFile = path.join(fixture.records, `${opened.identity?.key ?? ''}.json`);
    const kept = fs.readFileSync(recordFile, 'utf8');

    // A folder where the temporary record goes: the write fails.
    const obstacle = `${recordFile}.tmp`;
    fs.mkdirSync(obstacle);
    const later = { ...first, position: { ...first.position, stepId: 'W1.1', refIndex: 2 } };
    const error = failed(await host.saveState({ sessionId, state: later }));
    assert.equal(error.code, 'save-failed');
    assert.match(error.message, /could not be saved/);
    assert.match(error.message, /could not be saved: the record file could not be written/);
    // The window explains that the work is kept and retried; the host gives only the cause.
    assert.doesNotMatch(error.message, /next change/);
    assert.doesNotMatch(error.message, /EISDIR|EPERM|EACCES|ENOENT/, 'the message is plain; the system text is in detail');
    assert.ok((error.detail ?? '') !== '', 'the system text is kept for Details');
    assert.equal(fs.readFileSync(recordFile, 'utf8'), kept, 'the record last saved is untouched');

    // The window still holds `later`; once the obstacle is gone the same state saves.
    fs.rmSync(obstacle, { recursive: true, force: true });
    assert.equal(ok(await host.saveState({ sessionId, state: later })).saved, true);
    const reread = ok(await host.recordReading({ key: opened.identity?.key ?? '' }));
    assert.deepEqual(reread.recordPosition, later.position);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('through the host: the display language round-trips, and an unknown value is refused', async () => {
  const fixture = makeReviewFixture();
  try {
    const host = hostFor(fixture);
    assert.deepEqual(ok(await host.getPreferences()), { language: 'en' });
    assert.deepEqual(ok(await host.setPreferences({ preferences: { language: 'sv' } })), { saved: true });
    assert.equal(ok(await host.setPreferences({ preferences: { language: 'de' } })).saved, false);
    assert.deepEqual(ok(await hostFor(fixture).getPreferences()), { language: 'sv' }, 'read back by another host on the same records');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('through the host: a closed session answers unknown-session, and sessions are kept apart', async () => {
  const fixture = makeReviewFixture();
  try {
    const host = hostFor(fixture);
    const walkPath = writeWalkDefinition(fixture);
    const one = await session(host);
    const two = await session(host);
    assert.notEqual(one, two);
    await openIn(host, one, fixture.definitionPath);
    const other = await openIn(host, two, walkPath);
    assert.equal(other.bundle.definition.walks[0]?.steps.length, 3, 'each session has its own open review');

    assert.deepEqual(ok(await host.closeSession({ sessionId: one })), { closed: true });
    for (const answer of [
      await host.readFile({ sessionId: one, side: 'target', path: 'src/keep.ts' }),
      await host.listFiles({ sessionId: one, side: 'target' }),
      await host.search({ sessionId: one, side: 'target', query: 'needle' }),
      await host.saveState({ sessionId: one, state: other.bundle.state }),
      await host.envelopeFor({ sessionId: one, request: {} }),
      await host.open({ sessionId: one, definitionPath: fixture.definitionPath, remember: false }),
      await host.closeSession({ sessionId: one }),
      await host.readFile({ sessionId: 'never-made', side: 'target', path: 'src/keep.ts' }),
    ]) {
      const error = failed(answer);
      assert.equal(error.code, 'unknown-session');
      assert.match(error.message, /not open on the host/);
    }
    // The other session is untouched.
    assert.equal(ok(await host.readFile({ sessionId: two, side: 'target', path: 'src/keep.ts' })).kind, 'text');
    assert.equal(failed(await host.readFile({ side: 'target', path: 'src/keep.ts' } as never)).code, 'invalid-request');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('through the host: the bundled example review opens from this clone', async () => {
  const root = ownRepositoryRoot(appDir);
  assert.notEqual(root, null, 'these tests run from a DSpatch clone');
  const located = locateExampleReview(root);
  assert.equal(located.kind, 'found');
  const records = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-host-example-'));
  try {
    const host = localReviewHost(new ReviewHost({ recordsDir: records, log: () => undefined }));
    const sessionId = await session(host);
    const { bundle, opened } = await openIn(host, sessionId, located.kind === 'found' ? located.definitionPath : '');
    assert.equal(path.resolve(bundle.repository), path.resolve(root ?? ''));
    assert.ok(bundle.files.length > 0, 'the example has a diff');
    assert.ok(opened.identity !== null);
    // Opened with remember: false, as *Open example review* does: nothing remembered.
    assert.deepEqual(ok(await host.recentIndex()), { index: null });
  } finally {
    fs.rmSync(records, { recursive: true, force: true });
  }
});

test('the local binding turns a host that throws into an internal host-error, and shares no references', async () => {
  const held = { language: 'en' as const };
  const throwing = {
    createSession: () => Promise.reject(new Error('boom')),
    getPreferences: () => Promise.resolve(held),
  } as unknown as ReviewHostApi;
  const bound = localReviewHost(throwing);
  const error = failed(await bound.createSession());
  assert.equal(error.code, 'internal');
  assert.match(error.detail ?? '', /boom/);
  const preferences = ok(await bound.getPreferences());
  assert.deepEqual(preferences, held);
  assert.notEqual(preferences, held, 'the answer is a copy');
  const missing = failed(await bound.recentIndex());
  assert.equal(missing.code, 'internal', 'a method the host lacks is an answer too');
});
