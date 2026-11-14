/**
 * DSP-209 S12: the run report, built only from what DSpatch recorded.
 *
 * A scripted fan-out with messages through the runner, a journal with a skip and a handover, a
 * record with fields missing, a record from before S3, and the carried findings: "Done, check
 * skipped" with changed files, a fan-out stopped by too few calls, and an instruction the mailbox
 * took being said as sent, not delivered. No provider.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loopInstructionBadgeText, loopInstructionStatusText } from '../src/shared/loop-instruction';
import { LOOP_GRAPH_FORMAT, LOOP_GRAPH_FORMAT_VERSION, type LoopGraph } from '../src/shared/loop-graph';
import type { RecordedRunEnding } from '../src/shared/loop-record';
import { createMemoryResultStore } from '../src/shared/loop-results';
import { runLoopGraph, type RunJournalEntry, type StepExecutor } from '../src/shared/loop-run';
import { buildRunReport, NOT_YOUR_APPROVAL, runReportText } from '../src/shared/loop-run-report';
import { loopTurnsFromRecordText } from '../src/shared/loop-transcript';

const FENCE = '```';

function ending(parts: Partial<RecordedRunEnding> = {}): RecordedRunEnding {
  return {
    endedAtUtc: '2026-11-14T06:00:00.000Z',
    kind: 'finished',
    status: 'completed',
    terminalNodeId: 'done',
    outcome: 'verification-not-performed',
    outcomeText: 'DSpatch started no command of its own.',
    modelRequested: 'auto',
    modelReported: null,
    commands: [],
    snapshots: { beforeId: 'b', beforeFileCount: 3, afterId: 'a', afterFileCount: 3, changed: [], added: [], removed: [], truncated: null },
    note: '',
    cancelled: false,
    cost: 'unknown',
    ...parts,
  };
}

let seq = 0;
function entry(kind: RunJournalEntry['kind'], nodeId: string | undefined, data: Record<string, string | number | boolean> = {}, edgeId?: string): RunJournalEntry {
  seq += 1;
  return { seq, atIso: '', sinceStartMs: 0, kind, detail: '', ...(nodeId === undefined ? {} : { nodeId }), ...(edgeId === undefined ? {} : { edgeId }), data };
}

function fanOutGraph(maxCalls?: number): LoopGraph {
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'par',
    name: 'Parallel',
    purpose: 'Two branches and an integrator.',
    target: 'cursor',
    entry: 'slice',
    onRuntimeFault: 'stop-and-reconcile',
    ...(maxCalls === undefined ? {} : { limits: { maxCalls } }),
    failureKinds: [{ id: 'branch-failed', label: 'branch failed', meaning: 'A branch failed.' }],
    nodes: [
      { id: 'slice', kind: 'agent', label: 'Slice', produces: { required: true, form: 'stored-result' } },
      { id: 'work', kind: 'agent', label: 'Work', declaredFailures: ['branch-failed'], produces: { required: false, form: 'stored-result' }, fanOut: { slicesFrom: 'slice', maxConcurrent: 2, isolation: 'shared-read-only' } },
      { id: 'integrate', kind: 'agent', label: 'Integrate' },
      { id: 'done', kind: 'terminal', label: 'Done' },
      { id: 'failed', kind: 'terminal', label: 'A branch failed', ending: 'not-success' },
    ],
    edges: [
      { id: 'e1', from: 'slice', to: 'work', when: { on: 'success' } },
      { id: 'e2', from: 'work', to: 'integrate', when: { on: 'success' } },
      { id: 'e3', from: 'work', to: 'failed', when: { on: 'declared-failure', failure: 'branch-failed' } },
      { id: 'e4', from: 'integrate', to: 'done', when: { on: 'success' } },
    ],
  };
}

const SLICES = `${FENCE}dspatch-slices\n${JSON.stringify({
  slices: [
    { id: 'a', result: 'a done', ownedPaths: ['src/a.ts'], allowedActions: [], contractRefs: [], verification: 'read' },
    { id: 'b', result: 'b done', ownedPaths: ['src/b.ts', 'docs/b.md'], allowedActions: [], contractRefs: [], verification: 'read' },
  ],
})}\n${FENCE}`;

describe('the run report (DSP-209 S12)', () => {
  it('lists a fan-out as the journal holds it: base, branches, messages with per-recipient delivery, integration, usage per branch', async () => {
    let asked = 0;
    const executor: StepExecutor = async (context) => {
      const instance = context.instance;
      if (instance === undefined) {
        return context.node.id === 'slice'
          ? { product: { kind: 'success' }, summary: 'sliced', providerTurns: 1, resultBody: SLICES }
          : { product: { kind: 'success' }, summary: 'integrated', providerTurns: 2 };
      }
      if (instance.sliceId === 'a') {
        instance.mailbox.send({ to: 'b', purpose: 'finding', body: 'The cache key now includes the locale.' });
        instance.mailbox.send({ to: 'integrator', purpose: 'contract-change', body: 'Make the key a tuple.', contractRef: 'docs/cache.md@v1' });
        return { product: { kind: 'success' }, summary: 'a', providerTurns: 3 };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      const got = instance.mailbox.check();
      const finding = got.find((message) => message.purpose === 'finding');
      if (finding !== undefined) instance.mailbox.acknowledge(finding.id);
      return { product: { kind: 'success' }, summary: 'b', providerTurns: 4 };
    };
    const result = await runLoopGraph(fanOutGraph(), {
      runId: 'run-report',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `d-${String(body.length)}`),
      takeInstructions: () => (asked++ === 0 ? [{ id: 'i1', text: 'Keep the API.' }] : []),
      executor,
    });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const report = buildRunReport({
      journal: result.journal,
      replies: [{ nodeId: 'integrate', nodeLabel: 'Integrate', occurrence: 1, text: 'Merged both.\nwork#1/m2: accepted, the key is a tuple now.' }],
      ending: ending({
        sessions: [
          { nodeId: 'slice', sessionId: 's1', turns: 1, costCents: 12 },
          { nodeId: 'work/a', sessionId: 's2', turns: 1, costCents: null },
          { nodeId: 'work/b', sessionId: 's3', turns: 1, costCents: 30 },
          { nodeId: 'integrate', sessionId: 's4', turns: 1, costCents: null },
        ],
        snapshots: { beforeId: 'b', beforeFileCount: 3, afterId: 'a', afterFileCount: 4, changed: [], added: [{ relPath: 'src/a.ts', sha256: 'x', bytes: 1 }], removed: [], truncated: null },
      }),
    });
    const all = runReportText(report);
    const section = (id: string): string => report.sections.find((entry) => entry.id === id)?.lines.join('\n') ?? '';

    assert.match(section('path'), /1\. “Slice” \(slice\): success\n2\. “Work” \(work\): success\n3\. “Integrate” \(integrate\): success\n4\. “Done” \(done\): the run ended here/);
    assert.match(section('fan-outs'), /Fan-out work#1: no base commit/);
    assert.match(section('fan-outs'), /- a: owns src\/a\.ts; finished\./);
    assert.match(section('fan-outs'), /- b: owns src\/b\.ts, docs\/b\.md; finished\./);
    // Messages: each with sender, recipient, purpose, body as the sender's words, and per-recipient delivery.
    assert.match(section('messages'), /finding from a to b: “The cache key now includes the locale\.” \(a's words\)\.\n {2}b: delivered, acknowledged\./);
    assert.match(section('messages'), /contract-change from a to integrator, about docs\/cache\.md@v1/);
    assert.match(section('messages'), /your instruction to the branches: “Keep the API\.” \(your words\)\./);
    // A had ended before B's check took the instruction, so it was addressed to B alone.
    assert.match(section('messages'), /\(your words\)\.\n {2}b: delivered, not acknowledged\.$/);
    // Integration: the step after the fan-out, its proposals, and its own words about each.
    assert.match(section('integration'), /the step after it was “Integrate” \(integrate\); it success\. It was given 1 open proposal: work#1\/m2\./);
    assert.match(section('integration'), /work#1\/m2: “work#1\/m2: accepted, the key is a tuple now\.” \(Integrate's words, not DSpatch's finding\)/);
    // Usage per step and per branch; a session that reported none reads "not reported".
    assert.match(section('usage'), /“Slice”: 1 visit, 1 provider turn, 0 s; 12 cents\./);
    assert.match(section('usage'), /branch a: 3 provider turns; cost not reported\.\n {2}branch b: 4 provider turns; 30 cents\./);
    assert.match(section('usage'), /“Integrate”: 1 visit, 2 provider turns, 0 s; cost not reported\./);
    assert.match(section('files'), /^src\/a\.ts$/);
    assert.equal(report.sections.some((entry) => entry.id === 'branches'), false, 'read-only branches make no temporary branch');
    assert.ok(all.endsWith(NOT_YOUR_APPROVAL));
    assert.match(report.summary, /^Run report: 3 steps · 2 branches · 3 messages · 1 changed file · cost not reported$/);
  });

  it('lists skips with their reasons, the handover and the turn, declared verdicts and the temporary branches kept', () => {
    const journal = [
      entry('node-entered', 'implement', { kind: 'agent', occurrence: 1, role: 'dspatch-implementer' }),
      entry('node-produced', 'implement', { product: 'outcome', outcome: 'done-unchecked', outcomeSource: 'step-declared', providerTurns: 2, stepMs: 4000 }),
      entry('edge-taken', 'implement', { from: 'implement', to: 'check-skipped', outcome: 'done-unchecked' }, 'skip-review'),
      entry('node-skipped', 'review', { decidedBy: 'implement', reason: 'a typo in a comment' }, 'skip-review'),
      entry('node-entered', 'review2', { kind: 'agent', occurrence: 1, role: 'dspatch-reviewer' }),
      entry('node-produced', 'review2', { product: 'outcome', outcome: 'accept', outcomeSource: 'step-declared', providerTurns: 1 }),
      entry('handoff-requested', 'review2', { reason: 'needs a design talk' }),
      entry('handoff-answered', 'review2', { choice: 'interactive' }),
      entry('branch-started', 'work', { instanceId: 'work#1/x', sliceId: 'x', branch: 'dspatch/run/r/work/v1/x', base: 'abc123', baseKind: 'HEAD', untrackedNotIncluded: 2, ownedPaths: 'src/x.ts' }),
      entry('message-sent', 'work', { messageId: 'work#1/m1', from: 'x', to: 'y', purpose: 'question', body: 'Who owns config?', recipients: 'y' }),
      entry('message-undelivered', 'work', { messageId: 'work#1/m1', from: 'x', to: 'y', reason: 'recipient-ended-unchecked' }),
      entry('message-undelivered', 'work', { from: 'x', to: 'y', purpose: 'finding', body: 'Too late.', reason: 'recipient-ended' }),
      entry('branch-ended', 'work', { instanceId: 'work#1/x', sliceId: 'x', branch: 'dspatch/run/r/work/v1/x', ending: 'finished', commit: 'def456', worktreeKept: true, problem: 'git commit was refused: hook failed' }),
      entry('run-ended', undefined, { status: 'handed-over', calls: 3, providerTurns: 3, reworkRounds: 0 }),
    ];
    const report = buildRunReport({
      journal,
      replies: [{ nodeId: 'implement', nodeLabel: 'Implement', text: 'Done.' }],
      ending: ending({ status: 'handed-over', terminalNodeId: null, handover: { turn: 'refused', note: 'the conversation was busy.' } }),
    });
    const section = (id: string): string => report.sections.find((item) => item.id === id)?.lines.join('\n') ?? '';
    assert.match(section('skipped'), /“review”: skipped by “Implement” on edge skip-review\. Reason: “a typo in a comment” \(its words\)\./);
    assert.match(section('handover'), /“review2” recommended continuing interactively: “needs a design talk” \(its words\)\./);
    assert.match(section('handover'), /You chose to continue interactively/);
    assert.match(section('handover'), /The handover turn was not sent: the conversation was busy\./);
    assert.match(section('reviewed'), /“review2”: declared “accept” — its own verdict, not checked by DSpatch\./);
    assert.match(section('reviewed'), /“review” was skipped, so it checked nothing\./);
    assert.match(section('fan-outs'), /Fan-out work#1: base abc123 \(HEAD\), 2 untracked files left out\.\n- x: owns src\/x\.ts; finished; commit def456 on dspatch\/run\/r\/work\/v1\/x; worktree kept: git commit was refused: hook failed\./);
    assert.match(section('branches'), /^dspatch\/run\/r\/work\/v1\/x\nDSpatch does not delete them/);
    assert.match(section('messages'), / {2}y: undelivered: it ended without checking its messages\./);
    assert.match(section('messages'), /Refused: finding from x to y, which had already ended: “Too late\.” \(x's words\)\. No branch was restarted for it\./);
    assert.match(section('path'), /“Implement” \(implement\): declared “done-unchecked”/);
  });

  it('reads "not recorded" or "not reported" wherever a field is missing, and never guesses', () => {
    const report = buildRunReport({
      journal: [
        entry('node-entered', 'work', {}),
        entry('branch-started', 'work', { instanceId: 'work#1/a', sliceId: 'a' }),
        entry('message-sent', 'work', { messageId: 'work#1/m1', from: 'a', to: 'b' }),
      ],
      replies: [],
      ending: null,
    });
    const all = runReportText(report);
    assert.match(all, /“work” \(work\): no ending recorded/);
    assert.match(all, /- a: owned paths not recorded; its ending is not recorded\./);
    assert.match(all, /message from a to b: body not recorded \(a's words\)\.\n {2}recipients not recorded\./);
    assert.match(all, /Run: calls not recorded, provider turns not recorded; cost not recorded\./);
    assert.match(all, /Changed files DSpatch observed:\nNot recorded: the run wrote no ending\./);
    assert.match(report.summary, /changed files not recorded · cost not recorded$/);
  });

  it('says "Done, check skipped" with changed files in the report and the ending, and a fan-out stopped by calls as a bound', async () => {
    const snapshots = { beforeId: 'b', beforeFileCount: 1, afterId: 'a', afterFileCount: 1, changed: [{ relPath: 'src/x.ts', beforeSha256: '1', afterSha256: '2', beforeBytes: 1, afterBytes: 2 }], added: [], removed: [], truncated: null };
    const recordText = [
      JSON.stringify({ line: 'header', formatVersion: 1, identity: { runId: 'r1', projectPath: 'C:/p', conversationId: 'c', mandate: 'fix it', graphId: 'dspatch-chat-loop', graphPath: 'g', graphVersionId: 'v', modelRequested: 'auto', appVersion: '1', startedAtUtc: '2026-11-14T05:00:00.000Z' } }),
      JSON.stringify({ line: 'journal', entry: entry('node-entered', 'work', { kind: 'agent', occurrence: 1 }) }),
      JSON.stringify({ line: 'journal', entry: entry('node-entered', 'check-skipped', { kind: 'terminal', occurrence: 1, label: 'Done, check skipped' }) }),
      JSON.stringify({ line: 'ending', ending: ending({ terminalNodeId: 'check-skipped', snapshots }) }),
      '',
    ].join('\n');
    const [turn] = loopTurnsFromRecordText(recordText);
    assert.match(turn?.ending?.shortText ?? '', /Nothing reviewed the work\. DSpatch observed 1 changed file, and the check was skipped, so nothing reviewed it\./);
    assert.match(runReportText(turn!.report!), /DSpatch observed 1 changed file[^\n]*Said beside the ending only; it did not change the route\./);

    const executor: StepExecutor = async () => ({ product: { kind: 'success' }, summary: 'sliced', providerTurns: 1, resultBody: SLICES });
    const bounded = await runLoopGraph(fanOutGraph(2), {
      runId: 'run-bound',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `d-${String(body.length)}`),
      executor,
    });
    assert.equal(bounded.terminalNodeId, 'failed', 'the route is unchanged: the terminal stays as drawn');
    const text = runReportText(buildRunReport({ journal: bounded.journal, replies: [], ending: ending({ terminalNodeId: 'failed' }) }));
    assert.match(text, /“Work” \(work\): no branch started: not enough calls left for every branch \(a bound, not a branch failing\)/);
    assert.match(text, /Fan-out work#1: no branch was started, because the run had not enough calls left for every branch\. A bound, not a branch failing\./);
  });

  it('reads a record from before S3 (no skips, sessions, owned paths or handover fields) without an error, as a short report', () => {
    const recordText = [
      JSON.stringify({ line: 'header', formatVersion: 1, identity: { runId: 'old', projectPath: 'C:/p', conversationId: 'c', mandate: 'm', graphId: 'dspatch-chat-loop', graphPath: 'g', graphVersionId: 'v', modelRequested: 'auto', appVersion: '1', startedAtUtc: '2026-09-01T05:00:00.000Z' } }),
      JSON.stringify({ line: 'journal', entry: { seq: 1, atIso: '', sinceStartMs: 0, kind: 'node-entered', nodeId: 'implementer', detail: '' } }),
      JSON.stringify({ line: 'journal', entry: { seq: 2, atIso: '', sinceStartMs: 0, kind: 'node-produced', nodeId: 'implementer', detail: '' } }),
      JSON.stringify({ line: 'agent-reply', reply: { atUtc: '', nodeId: 'implementer', nodeLabel: 'Implementer', occurrence: 1, text: 'done', terminalStatus: 'finished' } }),
      JSON.stringify({ line: 'ending', ending: { endedAtUtc: '', kind: 'finished', status: 'completed', terminalNodeId: 'done', outcome: 'verification-not-performed', outcomeText: 'x', modelRequested: 'auto', modelReported: null, commands: [], snapshots: { beforeId: null, beforeFileCount: 0, afterId: null, afterFileCount: 0, changed: [], added: [], removed: [], truncated: 'No snapshot.' }, note: '', cancelled: false, cost: 'unknown' } }),
      '',
    ].join('\n');
    const report = loopTurnsFromRecordText(recordText)[0]?.report;
    assert.ok(report !== undefined);
    assert.deepEqual(report.sections.map((section) => section.id), ['path', 'usage', 'reviewed', 'files']);
    assert.match(runReportText(report), /“Implementer” \(implementer\): produced/);
    assert.match(runReportText(report), /Not recorded: No snapshot\./);
    assert.match(runReportText(report), /- “Implementer”: 1 visit, provider turns not recorded; cost not recorded\./);
  });

  it('lists every declared verdict whatever the step is called, and reads damaged ending fields as not recorded', () => {
    const journal = [
      entry('node-entered', 'skeptic', { kind: 'agent', occurrence: 1, label: 'Skeptic', role: 'audit' }),
      entry('node-produced', 'skeptic', { product: 'outcome', outcome: 'reject', outcomeSource: 'step-declared', providerTurns: 1 }),
      entry('node-skipped', 'polish', { decidedBy: 'skeptic', reason: 'not needed' }, 'e9'),
      entry('node-entered', 'polish', { kind: 'agent', occurrence: 1, label: 'Polish' }),
    ];
    const damaged = { ...ending({ status: 'handed-over' }), sessions: 'not a list', handover: 42 } as unknown as RecordedRunEnding;
    const reviewed = buildRunReport({ journal, replies: [], ending: damaged }).sections.find((section) => section.id === 'reviewed')?.lines.join('\n') ?? '';
    assert.match(reviewed, /“Skeptic”: declared “reject” — its own verdict, not checked by DSpatch\./);
    assert.match(reviewed, /“Polish” was skipped, so it checked nothing\./, 'named by its label');
    assert.doesNotMatch(reviewed, /No step declared a verdict/);
    const all = runReportText(buildRunReport({ journal, replies: [], ending: damaged }));
    assert.match(all, /“Skeptic”: 1 visit, 1 provider turn; cost not recorded\./);
    assert.match(all, /Whether the handover turn was sent into the chat: not recorded\./);
    assert.match(runReportText(buildRunReport({ journal: [], replies: [], ending: ending() })), /No step declared a verdict, and DSpatch ran no check of its own\./);
  });

  it('says an instruction the mailbox took was sent to the branches, not delivered', () => {
    const instruction = {
      id: 'i1',
      runId: 'r',
      text: 'Keep the API.',
      receivedAtUtc: '',
      runEnded: false,
      delivered: { nodeId: 'work', nodeLabel: 'Work', occurrence: 1, atUtc: '', toBranches: ['a', 'b'] },
    };
    assert.equal(loopInstructionStatusText(instruction), 'Sent to 2 branches of “Work”; each gets it when it next checks its messages. The run report says which did.');
    assert.equal(loopInstructionBadgeText(instruction), 'sent to the branches');
    assert.doesNotMatch(loopInstructionStatusText(instruction), /[Dd]elivered/);
  });
});
