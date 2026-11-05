/**
 * DSP-158: how a delegated review's result reads. What was approved is read from the checked
 * ranges and never from the agent's words, repeats are gathered without losing anything the
 * agent said, and a result saved before these fields existed still reads.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { delegatedReviewView, gatherFindings } from '../src/shared/delegated-review-view';
import { chatToolActivity, jobFrom, toolActivity, type AgentFinding, type DelegationResult, type DelegationScope, type LineRange, type PairFile } from '../src/shared/review-pair';
import { readReviewAnswer } from '../src/shared/review-agent';

const range = (start: number, end: number, path = 'src/a.ts'): LineRange => ({ kind: 'lines', side: 'target', path, start, end });

const scope: DelegationScope = { kind: 'file', label: 'src/a.ts', ranges: [range(1, 100)] };

/** A file whose changed lines are 10 to 19 at the target side. */
const files = [{ key: 'a', status: 'modified', oldPath: 'src/a.ts', newPath: 'src/a.ts', similarity: null, binary: false, hunks: [{ baseStart: 10, baseCount: 0, targetStart: 10, targetCount: 10 }], added: 10, deleted: 0 }] as unknown as readonly PairFile[];

const result = (change: Partial<DelegationResult>): DelegationResult => ({ assessment: '', reviewed: [range(10, 19)], approved: [], findings: [], uncertainties: [], insufficient: false, adjustments: [], ...change });

const problem = (text: string, location: LineRange | null = null, more: Partial<AgentFinding> = {}): AgentFinding => ({ severity: 'problem', text, location, ...more });

describe('what was approved', () => {
  it('calls a part whole only when every changed line in it is approved', () => {
    const view = delegatedReviewView(result({ approved: [range(10, 19)] }), scope, files);
    assert.equal(view.standing, 'whole');
    assert.equal(view.approvedLine, '10/10 changed lines reviewed and approved by the agent.');
    assert.equal(view.attentionLine, 'Nothing else was reported as needing attention.');
  });

  it('keeps a partial approval apart, with what remains, whatever the agent says', () => {
    const view = delegatedReviewView(result({ approved: [range(10, 13)], summary: 'Everything is approved.', findings: [problem('Broken.', range(14, 14))], uncertainties: ['Unknown caller.'] }), scope, files);
    assert.equal(view.standing, 'partial');
    assert.equal(view.approvedLine, '4/10 changed lines reviewed and approved by the agent.');
    assert.equal(view.attentionLine, 'Needs attention: 6 changed lines not approved, 1 problem, 1 thing not established.');
    assert.deepEqual(view.notApproved?.map((entry) => [entry.start, entry.end]), [[14, 19]]);
    assert.equal(view.agentSummary, 'Everything is approved.', 'shown as its words, under the statement');
  });

  it('never says whole when the changed lines are not known', () => {
    const view = delegatedReviewView(result({ approved: [range(10, 19)] }), scope, null);
    assert.equal(view.standing, 'partial');
    assert.match(view.approvedLine, /not known here/);
    assert.equal(view.notApproved, null);
  });

  it('says nothing was approved for an insufficient review and for a review that approved nothing', () => {
    assert.equal(delegatedReviewView(result({ insufficient: true }), scope, files).standing, 'insufficient');
    const none = delegatedReviewView(result({}), scope, files);
    assert.equal(none.standing, 'none');
    assert.equal(none.approvedLine, 'Nothing approved in this part.');
  });
});

describe('the findings', () => {
  it('gathers a repeat into one finding with each place, problems first', () => {
    const groups = gatherFindings([
      { severity: 'note', text: 'A remark.', location: null },
      problem('Missing check.', range(10, 10), { title: 'Unchecked result' }),
      problem('Missing check here too, so it can fail.', range(12, 12), { title: 'unchecked  result', details: 'Longer reasoning.' }),
      problem('Missing check.', range(10, 10), { title: 'Unchecked result' }),
    ]);
    assert.deepEqual(groups.map((group) => group.severity), ['problem', 'note']);
    const first = groups[0];
    assert.equal(first?.title, 'Unchecked result');
    assert.equal(first?.reported, 3);
    assert.deepEqual(first?.places.map((place) => place.start), [10, 12]);
    assert.match(first?.details ?? '', /here too/, 'a differently worded repeat stays readable');
    assert.match(first?.details ?? '', /Longer reasoning/);
  });

  it('gathers repeats that differ only in a line number, at the more serious kind', () => {
    const groups = gatherFindings([{ severity: 'question', text: 'Null at line 12 is unchecked.', location: null }, problem('Null at line 40 is unchecked.')]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.severity, 'problem');
  });

  it('heads an older finding with its first sentence, and clips one that is too long', () => {
    const [short] = gatherFindings([problem('The cache is never cleared. It grows until the process ends.')]);
    assert.equal(short?.title, 'The cache is never cleared');
    assert.equal(short?.explanation, 'It grows until the process ends.');
    const [only] = gatherFindings([problem('The cache is never cleared.')]);
    assert.equal(only?.explanation, '');
    const long = `${'word '.repeat(40)}end`;
    const [clipped] = gatherFindings([problem(long)]);
    assert.ok((clipped?.title.length ?? 0) <= 90 && clipped?.title.endsWith('…'));
    assert.equal(clipped?.explanation, long, 'nothing is lost to the heading');
  });
});

describe('a saved result', () => {
  it('opens without the new fields, and its summary is the start of the assessment', () => {
    const job = jobFrom({
      id: 'job-1',
      kind: 'review',
      state: 'done',
      provider: 'claude',
      model: 'm',
      note: 'n',
      scope: { kind: 'file', label: 'src/a.ts', ranges: [range(1, 100)] },
      result: { assessment: 'It looks right. The rest is detail.', reviewed: [range(10, 19)], approved: [range(10, 11)], findings: [{ severity: 'problem', text: 'One thing.', location: null }, { severity: 'strange' }] },
    });
    assert.ok(job?.result != null);
    const view = delegatedReviewView(job.result, job.scope, files);
    assert.equal(view.standing, 'partial');
    assert.equal(view.agentSummary, 'It looks right.');
    assert.equal(view.reasoning, 'It looks right. The rest is detail.');
    assert.equal(view.findings[0]?.title, 'One thing');
  });

  it('keeps the agent heading, reasoning and summary through the record', () => {
    const job = jobFrom({
      id: 'job-1',
      kind: 'review',
      state: 'done',
      provider: 'copilot',
      model: 'm',
      instruction: 'What it was told.',
      activity: 'Reading a.ts',
      result: { assessment: 'a', summary: 's', findings: [{ severity: 'problem', title: 'T', text: 'x', details: 'd', location: null }] },
    });
    assert.equal(job?.result?.summary, 's');
    assert.equal(job?.result?.findings[0]?.title, 'T');
    assert.equal(job?.result?.findings[0]?.details, 'd');
    assert.equal(job?.instruction, 'What it was told.');
    assert.equal(job?.activity, undefined, 'an ended job says nothing about what it is doing');
  });
});

describe('the answer', () => {
  it('is read with its heading and reasoning, and without them, approving the same lines either way', () => {
    const answer = (finding: Record<string, unknown>): unknown => ({
      assessment: 'Fine.',
      reviewed: [{ path: 'src/a.ts', side: 'target', start: 10, end: 19 }],
      approved: [{ path: 'src/a.ts', side: 'target', start: 10, end: 19 }],
      findings: [{ severity: 'problem', path: 'src/a.ts', side: 'target', start: 12, end: 12, ...finding }],
    });
    const headed = readReviewAnswer(answer({ title: 'Heading', text: 'Why.', details: 'More.' }), scope, files);
    const plain = readReviewAnswer(answer({ text: 'Why.' }), scope, files);
    assert.ok(!('error' in headed) && !('error' in plain));
    assert.equal(headed.findings[0]?.title, 'Heading');
    assert.deepEqual(headed.approved, plain.approved);
    assert.equal(headed.approved.length, 2, 'the line with a problem stays out, heading or not');
    const titleOnly = readReviewAnswer(answer({ title: 'Heading' }), scope, files);
    assert.ok(!('error' in titleOnly));
    assert.equal(titleOnly.findings[0]?.text, 'Heading');
  });
});

describe('what a tool call says', () => {
  it('says reading or searching only for a reading or searching tool', () => {
    assert.equal(toolActivity('Read', 'target/src/a.ts'), 'Reading a.ts');
    assert.equal(toolActivity('Read', null), 'Reading a file');
    assert.equal(toolActivity('Grep', 'pattern'), 'Searching the code');
    assert.equal(toolActivity('Glob', null), 'Searching the code');
    assert.equal(toolActivity('report_intent', null), null);
    assert.equal(chatToolActivity('view', null), 'Reading a file…');
  });
});
