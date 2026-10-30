/**
 * One review discussion per repository and revision pair (Niclas's decision of 30 October
 * 2026): the context a question from the diff is sent with, read from the pair's commits, and
 * the history the pair's discussion starts from. The pair is a stand-in object here; what it
 * answers is what `ReviewPairs` answers for an open pair.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { earlierDiscussion, pairEnvelopeSource } from '../src/host/review-pair-discussion';
import type { ReviewPairs } from '../src/host/review-pairs';
import { emptyDiscussionRecord, splitDetails, type DiscussionIdentity, type DiscussionMessage } from '../src/shared/review-discussion';
import type { AgentJob, OpenPair, PairRecord } from '../src/shared/review-pair';

const BASE = 'a'.repeat(40);
const TARGET = 'b'.repeat(40);
const LINES: Record<string, readonly string[]> = {
  'target:src/route.ts': ['export function route(lane: string): string {', '  return lookupRoute(lane);', '}'],
  'base:src/route.ts': ['export function route(lane: string): string {', '  return lane;', '}'],
};

function pairsWith(jobs: readonly AgentJob[] = []): ReviewPairs {
  const open = {
    key: 'k',
    pair: { repository: 'C:\\repo', base: BASE, target: TARGET },
    repositoryName: 'repo',
    base: { hash: BASE, subject: 'From' },
    target: { hash: TARGET, subject: 'To' },
    files: [{ key: 'src/route.ts→src/route.ts', status: 'modified', oldPath: 'src/route.ts', newPath: 'src/route.ts', similarity: null, binary: false, hunks: [], added: 1, deleted: 1 }],
  } as unknown as OpenPair;
  return {
    opened: (key: string) => (key === 'k' ? open : null),
    linesAt: (_key: string, side: string, filePath: string) => Promise.resolve(LINES[`${side}:${filePath}`] ?? null),
    storedRecord: () => ({ jobs }) as unknown as PairRecord,
  } as unknown as ReviewPairs;
}

test('a question from the diff is sent with the place, the selection checked against the commit, and no walk', async () => {
  const source = pairEnvelopeSource(pairsWith(), 'k');
  const quote = { kind: 'code', text: 'lookupRoute(lane)', segments: [{ side: 'target', path: 'src/route.ts', start: 2, end: 2, from: 9, to: 26 }] };
  const built = await source.envelopeFor({ subject: { kind: 'away', location: { side: 'target', path: 'src/route.ts', start: 2, end: 2 } }, selection: null, quote, language: 'en' });
  assert.equal(built.kind, 'built', JSON.stringify(built));
  if (built.kind !== 'built') {
    return;
  }
  assert.equal(built.envelope.identity.definitionPath, '');
  assert.equal(built.envelope.identity.target.sha, TARGET);
  assert.deepEqual(built.envelope.quote, { kind: 'code', segments: [{ side: 'target', path: 'src/route.ts', start: 2, end: 2, from: 9, to: 26, sha: TARGET, text: 'lookupRoute(lane)' }] });
  assert.deepEqual(built.envelope.ranges.map((range) => [range.role, range.sha, range.lines.length]), [['location', TARGET, 1]]);
  // The text the window showed must be the commit's; the other side's line is not it.
  const wrong = await source.envelopeFor({ subject: { kind: 'review' }, selection: null, quote: { ...quote, segments: [{ ...quote.segments[0], side: 'base' }] } });
  assert.equal(wrong.kind, 'refused');
  const closed = await pairEnvelopeSource(pairsWith(), 'other').envelopeFor({ subject: { kind: 'review' } });
  assert.equal(closed.kind, 'refused');
});

test("the pair's discussion starts from earlier walk discussions and the diff's explanations, which stay as they are", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-pair-discussion-'));
  try {
    const walkIdentity: DiscussionIdentity = { key: 'walkkey', repository: 'C:\\repo', base: BASE, target: TARGET, definitionPath: 'C:\\walks\\a.review.json' };
    const question: DiscussionMessage = { id: 'q-0001-x', role: 'question', text: 'What is lane?', at: '2026-10-30T10:00:00.000Z', subject: 'W1.1', status: 'sent' };
    const answer: DiscussionMessage = { id: 'a-0002-x', role: 'answer', questionId: 'q-0001-x', text: 'A name.', at: '2026-10-30T10:00:05.000Z', subject: 'W1.1', status: 'done' };
    const walkFile = path.join(dir, 'walkkey.discussion.json');
    fs.writeFileSync(walkFile, JSON.stringify({ ...emptyDiscussionRecord(walkIdentity), messages: [question, answer] }));
    const otherPair = { ...emptyDiscussionRecord({ ...walkIdentity, key: 'otherkey', target: 'c'.repeat(40) }), messages: [{ ...question, id: 'q-other' }] };
    fs.writeFileSync(path.join(dir, 'otherkey.discussion.json'), JSON.stringify(otherPair));
    const before = fs.readFileSync(walkFile, 'utf8');
    const job = {
      id: 'job-1',
      kind: 'explain',
      state: 'done',
      provider: 'claude',
      model: 'opus',
      startedAt: '2026-10-30T09:00:00.000Z',
      endedAt: '2026-10-30T09:00:09.000Z',
      note: '',
      detail: '',
      scope: null,
      result: null,
      definitionPath: null,
      uncovered: [],
      selection: { fileKey: 'f', layout: 'split', segments: [{ side: 'target', path: 'src/route.ts', start: 2, end: 2, from: 9, to: 26, kind: 'added', text: 'lookupRoute(lane)' }] },
      asked: 'Why look it up?',
      answer: { answer: 'Short.', details: 'Long.', references: [{ label: 'It', range: { kind: 'lines', side: 'target', path: 'src/table.ts', start: 4, end: 9 } }], insufficient: false, adjustments: [] },
    } as unknown as AgentJob;
    const pairIdentity: DiscussionIdentity = { key: 'pairkey', repository: 'C:\\repo', base: BASE, target: TARGET, definitionPath: '' };
    const history = earlierDiscussion(dir, pairIdentity, (other) => other.repository === 'C:\\repo' && other.target === TARGET, pairsWith([job]));
    assert.deepEqual(history.map((message) => [message.role, message.text.split('\n')[0]]), [
      ['question', 'Why look it up?'],
      ['answer', 'Short.'],
      ['question', 'What is lane?'],
      ['answer', 'A name.'],
    ]);
    const explained = history[0];
    assert.equal(explained?.envelope?.quote?.kind, 'code');
    assert.deepEqual(explained?.envelope?.quote?.kind === 'code' ? explained.envelope.quote.segments.map((segment) => [segment.path, segment.side, segment.start, segment.from, segment.to, segment.sha, segment.text]) : [], [['src/route.ts', 'target', 2, 9, 26, TARGET, 'lookupRoute(lane)']]);
    assert.deepEqual(splitDetails(history[1]?.text ?? ''), { short: 'Short.', details: 'Long.' });
    assert.equal(history[1]?.references?.[0]?.range.path, 'src/table.ts');
    assert.equal(fs.readFileSync(walkFile, 'utf8'), before, 'the earlier record is not changed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
