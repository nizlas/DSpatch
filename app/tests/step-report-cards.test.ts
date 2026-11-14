/**
 * DSP-209 S21: step reports in the chat — the prompt sentence, the card model, and that a
 * card's view changes nothing stored or delivered. Scripted journals; no runner, no window.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SUBGOAL_ASK, chatPromptFor } from '../src/shared/loop-chat';
import type { JournalKind, RunJournalEntry } from '../src/shared/loop-run';
import { stepReportsForTurn, type LoopAgentReply } from '../src/shared/loop-transcript';
import {
  STEP_EXCERPT_CHARS,
  branchReplyGroups,
  reportForReply,
  reportForVisit,
  stepCardHeading,
  stepCardLabel,
  stepReportExcerpt,
} from '../src/shared/step-report-cards';

type Data = Record<string, string | number | boolean>;

function journal(lines: readonly [JournalKind, string | undefined, Data?][]): RunJournalEntry[] {
  return lines.map(([kind, nodeId, data], index) => ({
    seq: index + 1,
    atIso: '2026-11-14T11:00:00.000Z',
    sinceStartMs: index * 1000,
    kind,
    detail: kind,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(data === undefined ? {} : { data }),
  }));
}

const RUN = 'chat-loop-1';

/** plan → fan (a, b) → merge (integrator role, by the fan-out's success edge) → review. */
const PARALLEL = journal([
  ['run-started', undefined, {}],
  ['node-entered', 'plan', { kind: 'agent', occurrence: 1, label: 'Plan' }],
  ['node-produced', 'plan', { product: 'success' }],
  ['edge-taken', 'plan', { from: 'plan', to: 'fan', when: 'success', reworkRound: false }],
  ['node-entered', 'fan', { kind: 'agent', occurrence: 1, label: 'Branches', role: 'project-branch' }],
  ['branch-started', 'fan', { instanceId: 'fan#1/a', sliceId: 'a', sessionId: 's-a' }],
  ['branch-started', 'fan', { instanceId: 'fan#1/b', sliceId: 'b', sessionId: 's-b' }],
  ['branch-ended', 'fan', { instanceId: 'fan#1/a', sliceId: 'a', ending: 'finished' }],
  ['branch-ended', 'fan', { instanceId: 'fan#1/b', sliceId: 'b', ending: 'finished' }],
  ['node-produced', 'fan', { product: 'success' }],
  ['edge-taken', 'fan', { from: 'fan', to: 'merge', when: 'success', reworkRound: false }],
  ['node-entered', 'merge', { kind: 'agent', occurrence: 1, label: 'Integrate', role: 'project-integrate' }],
  ['node-produced', 'merge', { product: 'success' }],
  ['edge-taken', 'merge', { from: 'merge', to: 'review', when: 'success', reworkRound: false }],
  ['node-entered', 'review', { kind: 'agent', occurrence: 1, label: 'Review', role: 'project-integrate' }],
  ['node-produced', 'review', { product: 'outcome', outcome: 'rework', outcomeSource: 'step-declared' }],
  ['edge-taken', 'review', { from: 'review', to: 'plan', when: 'outcome', reworkRound: true }],
  ['node-entered', 'plan', { kind: 'agent', occurrence: 2, label: 'Plan' }],
]);

const REPLIES: LoopAgentReply[] = [
  { nodeId: 'plan', nodeLabel: 'Plan', occurrence: 1, text: 'Planned two slices.\n\nRESULT: done' },
  { nodeId: 'fan', nodeLabel: 'Branches · a', occurrence: 1, sliceId: 'a', text: 'Slice a done.' },
  { nodeId: 'fan', nodeLabel: 'Branches · b', occurrence: 1, sliceId: 'b', text: 'Slice b done.' },
  { nodeId: 'merge', nodeLabel: 'Integrate', occurrence: 1, text: 'Merged both.\nSUBGOAL: S21 — Step reports in chat\n\nRESULT: done' },
  { nodeId: 'review', nodeLabel: 'Review', occurrence: 1, text: 'Needs rework.\n\nRESULT: rework' },
];

describe('step reports in the chat (DSP-209 S21)', () => {
  it('asks only a node that declares "subgoal" for the line, and leaves every other prompt byte for byte', () => {
    const node = { id: 'work', kind: 'agent' as const, purpose: 'Do what the mandate asks.' };
    const options = { entryId: 'work', mandate: 'Add a field.' };
    const plain = chatPromptFor(node, options);
    assert.equal(chatPromptFor({ ...node, declares: [] }, options), plain);
    assert.ok(!plain.includes('SUBGOAL:'));
    assert.equal(chatPromptFor({ ...node, declares: ['subgoal'] }, options), `${plain}\n\n${SUBGOAL_ASK}`);
    // A later (non-entry) step the same way.
    const later = { ...options, entryId: 'plan' };
    assert.equal(chatPromptFor({ ...node, declares: ['subgoal'] }, later), `${chatPromptFor(node, later)}\n\n${SUBGOAL_ASK}`);
  });

  it('groups a two-branch fan-out under its step, and heads only the integrator by rule "Combined report"', () => {
    const reports = stepReportsForTurn(RUN, PARALLEL, REPLIES);
    assert.deepEqual([...branchReplyGroups(REPLIES).entries()], [['fan#1', [1, 2]]]);
    assert.equal(reportForVisit(reports, 'fan', 1)?.role, 'step');
    assert.deepEqual(
      REPLIES.map((_, index) => stepCardLabel(reportForReply(reports, index))),
      ['Step report', 'Step report', 'Step report', 'Combined report', 'Step report'],
      'the review has the integrator role but is not reached by the fan-out’s success edge',
    );
  });

  it('puts the agent’s SUBGOAL: claim in the heading, marked as its claim, and reads a rework arrival as attempt 2', () => {
    const reports = stepReportsForTurn(RUN, PARALLEL, [...REPLIES, { nodeId: 'plan', nodeLabel: 'Plan', occurrence: 2, text: 'Replanned.' }]);
    assert.equal(
      stepCardHeading('Integrate', reportForReply(reports, 3), { occurrence: 1 }),
      'Integrate · sub-goal S21 — Step reports in chat (the agent’s claim) · visit 1',
    );
    assert.equal(stepCardHeading('Plan', reportForReply(reports, 5), { occurrence: 2 }), 'Plan · rework attempt 2');
    assert.equal(stepCardHeading('Plan', null, { occurrence: 3 }), 'Plan · visit 3', 'without a journal, the visit alone');
  });

  it('cuts the excerpt mechanically and keeps the RESULT: line, and changes nothing stored or delivered', () => {
    const long = `${'word '.repeat(300)}\n\nMore detail.\n\nRESULT: done`;
    const excerpt = stepReportExcerpt(long);
    assert.ok(excerpt.cut);
    assert.ok(excerpt.text.startsWith('word word'));
    assert.ok(excerpt.text.split('\n\n')[0]!.length <= STEP_EXCERPT_CHARS + 1);
    assert.ok(excerpt.text.endsWith('RESULT: done'));
    assert.deepEqual(stepReportExcerpt('Short.\n\nRESULT: done'), { text: 'Short.\n\nRESULT: done', cut: false });
    // The view reads the replies and the journal and writes nothing back: the record's
    // replies and what a later step is sent are the same before and after.
    const before = JSON.stringify({ REPLIES, PARALLEL });
    const prompt = chatPromptFor({ id: 'review', kind: 'agent', purpose: 'Review.' }, { entryId: 'plan', mandate: 'Do it.' });
    for (const [index, reply] of REPLIES.entries()) {
      stepReportExcerpt(reply.text);
      stepCardLabel(reportForReply(stepReportsForTurn(RUN, PARALLEL, REPLIES), index));
    }
    assert.equal(JSON.stringify({ REPLIES, PARALLEL }), before);
    assert.equal(chatPromptFor({ id: 'review', kind: 'agent', purpose: 'Review.' }, { entryId: 'plan', mandate: 'Do it.' }), prompt);
  });
});
