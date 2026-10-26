/**
 * The review discussion's shared part: the exact text a question is sent with, the
 * one-line subject, the recap for a reopened discussion and the stored record.
 *
 * What matters to a person here is that the model is told the truth: DSpatch's
 * instruction as written, the revision the code is from, and a stated cut wherever
 * something was left out. The envelope itself is built from git in main and is
 * tested against a real repository in `review-service.test.ts`.
 *
 *     node --test tests/review-discussion.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ENVELOPE_LIMITS,
  PROVIDER_ADDED_CONTEXT_LINE,
  REVIEW_DISCUSSION_CHANNELS,
  REVIEW_DISCUSSION_FORMAT_VERSION,
  REVIEW_DISCUSSION_INSTRUCTION,
  adoptDiscussionRecord,
  buildEnvelopePrompt,
  emptyDiscussionRecord,
  recapFor,
  subjectLine,
  withoutErrorClass,
  type ContextEnvelope,
  type DiscussionIdentity,
  type DiscussionMessage,
  type EnvelopeRange,
} from '../src/shared/review-discussion.ts';

const BASE = 'a'.repeat(40);
const TARGET = 'def5678'.padEnd(40, '0');

function range(overrides: Partial<EnvelopeRange> = {}): EnvelopeRange {
  return {
    role: 'focus',
    path: 'src/main/x.ts',
    side: 'target',
    sha: TARGET,
    start: 120,
    end: 122,
    lines: ['const a = 1;', 'adapter.cancel();', 'return a;'],
    omittedLines: 0,
    problem: null,
    ...overrides,
  };
}

function envelope(overrides: Partial<ContextEnvelope> = {}): ContextEnvelope {
  return {
    version: 1,
    identity: {
      title: 'Cancel handling',
      definitionPath: 'C:/defs/change.review.json',
      definitionHash: 'f'.repeat(64),
      repository: 'C:/work/project-repo',
      base: { sha: BASE, subject: 'base commit' },
      target: { sha: TARGET, subject: 'target commit' },
    },
    language: 'en',
    subject: { kind: 'point', walkId: 'W2', stepId: 'W2.1', placeIndex: 0 },
    selection: null,
    explanation: {
      walkNumber: 2,
      walkTitle: 'Stopping a run',
      stepTitle: 'Cancel path',
      summary: 'Stop asks the adapter.',
      body: 'The service calls cancel.',
      why: 'A stop must reach the provider.',
      placeLabel: 'adapter.cancel',
      evidence: [{ label: 'analysis', labelText: 'Read from the code', text: 'Read, not run.' }],
    },
    overview: null,
    ranges: [range({ end: 148, lines: Array.from({ length: 29 }, (_, index) => `line ${String(120 + index)}`) })],
    notes: [],
    providerContext: PROVIDER_ADDED_CONTEXT_LINE,
    builtAt: '2026-10-26T13:00:00.000Z',
    ...overrides,
  };
}

test('the prompt starts with DSpatch\'s instruction verbatim and names both revisions in full', () => {
  const prompt = buildEnvelopePrompt(envelope(), 'Why is cancel called here?', null);
  assert.ok(prompt.startsWith(`${REVIEW_DISCUSSION_INSTRUCTION}\n\n`));
  assert.ok(prompt.includes(`Base revision: ${BASE} (base commit)`));
  assert.ok(prompt.includes(`Target revision: ${TARGET} (target commit)`));
  // The folder name, not the person's local path.
  assert.ok(prompt.includes('Repository: project-repo'));
  assert.ok(!prompt.includes('C:/work'));
  assert.ok(prompt.includes(`### focus · src/main/x.ts lines 120–148 · target @ ${TARGET}`));
  assert.ok(prompt.includes('121 | line 121'));
  assert.ok(prompt.includes('What happens:\nThe service calls cancel.'));
  assert.ok(prompt.includes('- Read from the code: Read, not run.'));
  assert.ok(prompt.trimEnd().endsWith('## Question\nWhy is cancel called here?'));
  assert.ok(!prompt.includes('[truncated'));
});

test('the instruction says what the model cannot do and asks it to say when context is missing', () => {
  assert.match(REVIEW_DISCUSSION_INSTRUCTION, /revision named/);
  assert.match(REVIEW_DISCUSSION_INSTRUCTION, /cannot change code, run commands/);
  assert.match(REVIEW_DISCUSSION_INSTRUCTION, /not enough/);
  assert.equal(PROVIDER_ADDED_CONTEXT_LINE, 'provider-added context (user-level rules and hooks): unknown');
});

test('every cut is stated: long ranges, lines left out at build time, the code budget and a long question', () => {
  const long = 'x'.repeat(ENVELOPE_LIMITS.rangeChars + 500);
  const prompt = buildEnvelopePrompt(
    envelope({ ranges: [range({ lines: [long], start: 1, end: 1 }), range({ role: 'context', omittedLines: 7 })] }),
    'q'.repeat(ENVELOPE_LIMITS.questionChars + 10),
    null,
  );
  assert.ok(prompt.includes(`[truncated: ${String(ENVELOPE_LIMITS.rangeChars)} of ${String(long.length + 4)} characters shown]`));
  assert.ok(prompt.includes('[truncated: 3 of 10 lines shown]'));
  assert.ok(prompt.includes(`[truncated: ${String(ENVELOPE_LIMITS.questionChars)} of ${String(ENVELOPE_LIMITS.questionChars + 10)} characters shown]`));

  // More code than the whole budget: later ranges are named, not silently dropped.
  const big = 'y'.repeat(ENVELOPE_LIMITS.rangeChars);
  const many = Array.from({ length: 5 }, (_, index) => range({ role: 'context', path: `src/f${String(index)}.ts`, start: 1, end: 1, lines: [big] }));
  const bounded = buildEnvelopePrompt(envelope({ ranges: many }), 'q', null);
  assert.ok(bounded.length < ENVELOPE_LIMITS.codeChars + 20_000);
  assert.match(bounded, /\[truncated: 3 of 5 code ranges shown\] Left out:\n- context · src\/f3\.ts lines 1 · target\n- context · src\/f4\.ts/);
});

test('code that contains a fence cannot close the block it is shown in', () => {
  const prompt = buildEnvelopePrompt(envelope({ ranges: [range({ lines: ['```', 'after'] })] }), 'q', null);
  assert.ok(prompt.includes('````\n120 | ```\n121 | after\n````'));
});

test('a range that could not be read says why instead of showing nothing', () => {
  const prompt = buildEnvelopePrompt(envelope({ ranges: [range({ lines: [], problem: 'src/main/x.ts does not exist at target (def5678).' })] }), 'q', null);
  assert.ok(prompt.includes('(not supplied: src/main/x.ts does not exist at target (def5678).)'));
});

test('the subject line names the point, a code location, the whole review and a selection', () => {
  assert.equal(subjectLine(envelope()), 'Walk 2 › Cancel path › adapter.cancel · src/main/x.ts 120–148 @def5678');
  assert.equal(
    subjectLine(envelope({ selection: { path: 'src/main/x.ts', side: 'target', start: 130, end: 134 } })),
    'Walk 2 › Cancel path › adapter.cancel · src/main/x.ts 120–148 @def5678 (+ selection 130–134)',
  );
  assert.equal(
    subjectLine(envelope({ selection: { path: 'src/other.ts', side: 'base', start: 3, end: 3 } })),
    'Walk 2 › Cancel path › adapter.cancel · src/main/x.ts 120–148 @def5678 (+ selection src/other.ts 3 @aaaaaaa)',
  );
  const location = { path: 'src/y.ts', side: 'base' as const, start: 5, end: 9 };
  assert.equal(subjectLine(envelope({ subject: { kind: 'away', location }, explanation: null, ranges: [] })), 'src/y.ts 5–9 @aaaaaaa');
  assert.equal(subjectLine(envelope({ subject: { kind: 'review' }, explanation: null, ranges: [] })), 'the review as a whole');
  assert.equal(
    subjectLine(envelope({ subject: { kind: 'review' }, explanation: null, ranges: [], selection: location })),
    'the review as a whole (+ selection src/y.ts 5–9 @aaaaaaa)',
  );
});

test('a whole-review question carries the overview, walk titles and changed files, and says when there is no code', () => {
  const prompt = buildEnvelopePrompt(
    envelope({
      subject: { kind: 'review' },
      explanation: null,
      ranges: [],
      overview: { summary: 'Two walks.', walkTitles: ['First', 'Second'], changedFiles: [{ path: 'src/a.ts', status: 'modified' }] },
      notes: [{ kind: 'question', status: 'open', text: 'Is this safe?', resolution: '', location: null, stepId: 'W1.1' }],
    }),
    'What is left?',
    null,
  );
  assert.ok(prompt.includes('Walks:\n1. First\n2. Second'));
  assert.ok(prompt.includes('- modified src/a.ts'));
  assert.ok(prompt.includes('No code is supplied with this question.'));
  assert.ok(prompt.includes("## The reviewer's notes\n- [question, open] (step W1.1) Is this safe?"));
});

function message(overrides: Partial<DiscussionMessage> & Pick<DiscussionMessage, 'id' | 'role'>): DiscussionMessage {
  return { text: '', at: '2026-10-26T13:00:00.000Z', subject: 'Walk 1 › s', status: 'done', ...overrides };
}

test('the recap keeps the newest finished exchanges within its bounds, oldest first, and states what it left out', () => {
  const messages: DiscussionMessage[] = [];
  for (let index = 1; index <= 5; index += 1) {
    messages.push(message({ id: `q${String(index)}`, role: 'question', text: `question ${String(index)}` }));
    messages.push(message({ id: `a${String(index)}`, role: 'answer', questionId: `q${String(index)}`, text: `answer ${String(index)}` }));
  }
  // An answer that never finished is not recapped as if it had.
  messages.push(message({ id: 'q6', role: 'question', text: 'question 6' }));
  messages.push(message({ id: 'a6', role: 'answer', questionId: 'q6', text: 'half', status: 'cancelled' }));

  assert.equal(recapFor([]), '');
  const recap = recapFor(messages, { totalChars: 10_000, entryChars: 100, exchanges: 2 });
  assert.equal(recap, '[truncated: 2 of 5 earlier exchanges shown]\n\nQ (Walk 1 › s): question 4\nA: answer 4\n\nQ (Walk 1 › s): question 5\nA: answer 5');
  const all = recapFor(messages, { totalChars: 10_000, entryChars: 100, exchanges: 10 });
  assert.ok(!all.includes('truncated'));
  assert.ok(!all.includes('half'));

  const clipped = recapFor([message({ id: 'q', role: 'question', text: 'z'.repeat(50) }), message({ id: 'a', role: 'answer', questionId: 'q', text: 'ok' })], {
    totalChars: 10_000,
    entryChars: 10,
    exchanges: 5,
  });
  assert.ok(clipped.includes('[truncated: 10 of 50 characters shown]'));
  const tight = recapFor(messages, { totalChars: 60, entryChars: 100, exchanges: 10 });
  assert.ok(tight.length < 120);
  assert.ok(tight.startsWith('[truncated: 1 of 5 earlier exchanges shown]'));

  // The recap goes into the prompt under its own heading.
  assert.ok(buildEnvelopePrompt(envelope(), 'q', all).includes('## Earlier in this discussion\nQ (Walk 1 › s): question 1'));
});

const IDENTITY: DiscussionIdentity = { key: 'k'.repeat(24), repository: 'C:/r', base: BASE, target: TARGET, definitionPath: 'C:/d.review.json' };

test('a stored discussion reads back as written, and a turn that was going comes back as unknown', () => {
  const record = {
    ...emptyDiscussionRecord(IDENTITY),
    draft: 'half a question',
    savedAt: '2026-10-26T13:05:00.000Z',
    messages: [
      message({ id: 'q1', role: 'question', text: 'Why?', envelope: envelope(), sentPrompt: 'the prompt', dspatchRunId: 'run-1', status: 'sent' }),
      message({ id: 'a1', role: 'answer', questionId: 'q1', text: 'Because.', status: 'done' }),
      message({ id: 'q2', role: 'question', text: 'And?', status: 'sent' }),
      message({ id: 'a2', role: 'answer', questionId: 'q2', text: 'Part', status: 'streaming' }),
    ],
    attempts: [
      {
        attemptId: 'attempt-1',
        kind: 'agent-turn' as const,
        label: 'Review question',
        state: 'outcome-unknown' as const,
        stateReason: 'closed',
        requestedAtUtc: '2026-10-26T13:01:00.000Z',
        endedAtUtc: null,
        providerRunId: 'run-1',
        localPid: null,
        cancelRequestedAtUtc: null,
        acknowledgedAtUtc: null,
        history: [{ atUtc: '2026-10-26T13:01:00.000Z', state: 'waiting' as const, note: 'asked', applied: true }],
      },
    ],
  };
  const adopted = adoptDiscussionRecord(JSON.parse(JSON.stringify(record)), IDENTITY);
  assert.equal(adopted.kind, 'adopted');
  if (adopted.kind !== 'adopted') {
    return;
  }
  assert.deepEqual(adopted.record.messages.slice(0, 3), record.messages.slice(0, 3));
  assert.equal(adopted.record.messages[3]?.status, 'unknown');
  assert.deepEqual(adopted.record.attempts, record.attempts);
  assert.equal(adopted.record.draft, 'half a question');

  // Entries that cannot be read are left out; the rest stays.
  const damaged = adoptDiscussionRecord({ ...record, messages: [{ id: 'x' }, ...record.messages], attempts: [{ attemptId: 'y', kind: 'agent-turn', state: 'invented' }] }, IDENTITY);
  assert.equal(damaged.kind === 'adopted' ? damaged.record.messages.length : -1, 4);
  assert.equal(damaged.kind === 'adopted' ? damaged.record.attempts.length : -1, 0);
});

test('a newer format is refused rather than guessed at, and another review\'s file is not adopted', () => {
  const newer = adoptDiscussionRecord({ ...emptyDiscussionRecord(IDENTITY), version: REVIEW_DISCUSSION_FORMAT_VERSION + 1 }, IDENTITY);
  assert.equal(newer.kind, 'newer');
  assert.match(newer.kind === 'newer' ? newer.problem : '', /newer than this DSpatch understands.*not rewritten/);
  assert.equal(adoptDiscussionRecord({ ...emptyDiscussionRecord(IDENTITY), identity: { ...IDENTITY, target: BASE } }, IDENTITY).kind, 'unusable');
  assert.equal(adoptDiscussionRecord('not json', IDENTITY).kind, 'unusable');
  assert.equal(adoptDiscussionRecord({ messages: [] }, IDENTITY).kind, 'unusable');
});

test('the discussion channels are its own, and the review preload uses exactly them', () => {
  assert.deepEqual(Object.values(REVIEW_DISCUSSION_CHANNELS), [
    'dspatch:review-discussion-send',
    'dspatch:review-discussion-cancel',
    'dspatch:review-discussion-load',
    'dspatch:review-discussion-acknowledge',
    'dspatch:review-discussion-draft',
    'dspatch:review-discussion-event',
    // DSP-132 (S5): the agent choice and the recap after a switch.
    'dspatch:review-discussion-choose-agent',
    'dspatch:review-discussion-recap',
  ]);
  // The sandboxed preload cannot import the shared module, so it spells them out.
  const preload = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'preload', 'review-preload.ts'), 'utf8');
  const used = new Set(preload.match(/dspatch:review-discussion-[a-z]+(?:-[a-z]+)*/g) ?? []);
  assert.deepEqual([...used].sort(), Object.values(REVIEW_DISCUSSION_CHANNELS).sort());
});

test('the error line leaves the class name to the detail, and keeps an ordinary sentence whole', () => {
  assert.equal(
    withoutErrorClass('PresentationSendFailed: Presentation adapter: simulated send failure - refused.'),
    'Presentation adapter: simulated send failure - refused.',
  );
  assert.equal(withoutErrorClass('TypeError: fetch failed'), 'fetch failed');
  assert.equal(withoutErrorClass('Error: something broke'), 'something broke');
  assert.equal(withoutErrorClass('Refused: this window is not a review window.'), 'Refused: this window is not a review window.');
  assert.equal(withoutErrorClass('An answer is still on its way.'), 'An answer is still on its way.');
});
