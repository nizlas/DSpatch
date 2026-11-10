/**
 * DSP-189: the walk loop's drawing, prompts, readers and run, with a scripted session and no
 * provider. What these establish is DSpatch's own handling: the roles load from their files, the
 * engine routes on the reviewer's declared outcome, one correction round goes to the planner or
 * the writer and only the affected steps are written again, a second request for rework after
 * that round is read as the final assessment's objections, a planner that cannot plan ends the
 * run without walks, a turn that does not finish ends the run without a resend, and every
 * exchange reaches the record. They say nothing about what a real model writes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { runWalkLoop, type WalkLoopSessions, type WalkLoopTurnResult } from '../src/host/walk-loop-run';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { parseRunRecord } from '../src/shared/loop-record';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { DETAILS_MARKER } from '../src/shared/presentation-profiles';
import type { AnalysisMaterial } from '../src/shared/review-agent';
import type { AgentMaterial } from '../src/shared/review-pair';
import {
  WALK_LOOP_GRAPH_REL,
  planPrompt,
  readPlanAnswer,
  readReviewAnswer,
  reviewOutcomeOf,
  reviewPrompt,
  stepRefsOf,
  stepSignature,
  writeStepPrompt,
  type WalkPlan,
} from '../src/shared/walk-loop';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphText = fs.readFileSync(path.join(repoRoot, WALK_LOOP_GRAPH_REL), 'utf8');
const resolveRole = createFileRoleResolver(repoRoot);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-loop-'));

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

// --- A small change to plan over: two files, read from memory -------------------------------

const FILES: Record<string, string[]> = {
  'src/a.ts': ['export function start(): void {', '  connect();', '}', 'function connect(): boolean {', '  return open();', '}', 'function open(): boolean {', '  return true;', '}'],
};

const material: AnalysisMaterial = {
  pair: { repository: '/repo', base: 'a'.repeat(40), target: 'b'.repeat(40) },
  repositoryName: 'repo',
  baseSubject: 'before',
  targetSubject: 'after',
  files: [],
  diff: '',
  diffLeftOut: [],
};

const folder: AgentMaterial = { base: material.pair.base, target: material.pair.target, files: 2, skipped: [], skippedCount: 0 };

const read = (_side: 'base' | 'target', filePath: string): Promise<readonly string[] | null> => Promise.resolve(FILES[filePath] ?? null);

function place(start: number, end: number, from?: { start: number; end: number }): Record<string, unknown> {
  return { label: `lines ${String(start)}-${String(end)}`, path: 'src/a.ts', side: 'target', start, end, ...(from === undefined ? {} : { from: { label: 'the call', path: 'src/a.ts', side: 'target', ...from } }) };
}

function planJson(steps: readonly Record<string, unknown>[]): string {
  return `\`\`\`json\n${JSON.stringify({ summary: 'Connects on start.', background: '', walks: [{ kind: 'walk', title: 'Starting', question: 'What happens on start?', purpose: 'Follow the start.', steps }] })}\n\`\`\``;
}

const PLAN_TWO = planJson([
  { title: 'Start', summary: 'start() calls connect().', brief: 'Say what start asks of connect.', places: [place(1, 3)] },
  { title: 'Connect', summary: 'connect() opens.', brief: 'Reached from start; what open answers.', places: [place(4, 6, { start: 2, end: 2 })] },
]);

const PLAN_THREE = planJson([
  { title: 'Start', summary: 'start() calls connect().', brief: 'Say what start asks of connect.', places: [place(1, 3)] },
  { title: 'Connect', summary: 'connect() opens.', brief: 'Reached from start; what open answers.', places: [place(4, 6, { start: 2, end: 2 })] },
  { title: 'Open', summary: 'open() answers true.', brief: 'The implementation behind the name.', places: [place(7, 9, { start: 5, end: 5 })] },
]);

function reviewJson(verdict: string, findings: readonly Record<string, unknown>[]): string {
  return `\`\`\`json\n${JSON.stringify({ assessment: `SCRIPTED ${verdict}`, verdict, findings })}\n\`\`\``;
}

interface Scripted {
  readonly plan: readonly string[];
  readonly review: readonly string[];
  /** A writer answer per step prompt; `null` ends the turn with the given status. */
  readonly write?: (stepId: string, prompt: string) => string | WalkLoopTurnResult;
}

function scripted(script: Scripted): WalkLoopSessions & { readonly prompts: { readonly node: string; readonly prompt: string }[]; readonly opened: string[] } {
  const prompts: { node: string; prompt: string }[] = [];
  const opened: string[] = [];
  let plans = 0;
  let reviews = 0;
  return {
    prompts,
    opened,
    open: (nodeId) => {
      opened.push(nodeId);
      return Promise.resolve();
    },
    turn: (nodeId, prompt) => {
      prompts.push({ node: nodeId, prompt });
      const finished = (text: string): WalkLoopTurnResult => ({ status: 'finished', text, error: null, sessionId: `session-${nodeId}` });
      if (nodeId === 'plan') {
        const answer = script.plan[Math.min(plans, script.plan.length - 1)] ?? '';
        plans += 1;
        return Promise.resolve(finished(answer));
      }
      if (nodeId === 'review') {
        const answer = script.review[Math.min(reviews, script.review.length - 1)] ?? '';
        reviews += 1;
        return Promise.resolve(finished(answer));
      }
      const stepId = /^## This step: (\S+)/m.exec(prompt)?.[1] ?? '?';
      const answer = script.write === undefined ? `Text for ${stepId}.\n\n${DETAILS_MARKER}\nMore on ${stepId}.` : script.write(stepId, prompt);
      return Promise.resolve(typeof answer === 'string' ? finished(answer) : answer);
    },
    usageSinceLast: () => [],
  };
}

async function run(script: Scripted, options: { readonly signal?: AbortSignal; readonly name: string }) {
  const sessions = scripted(script);
  const recordDir = path.join(scratch, options.name);
  const outcome = await runWalkLoop({
    graphText,
    graphPath: WALK_LOOP_GRAPH_REL,
    resolveRole,
    material,
    folder,
    language: 'en',
    profile: 'standard',
    files: [],
    read,
    context: null,
    sessions,
    recordDir,
    identity: { projectPath: '/revisions', mandate: 'Prepare code walks.', modelRequested: 'scripted', provider: 'claude', appVersion: 'test' },
    signal: options.signal ?? new AbortController().signal,
    activity: () => undefined,
    log: () => undefined,
  });
  const record = parseRunRecord(fs.readFileSync(path.join(recordDir, 'record.jsonl'), 'utf8'));
  return { outcome, sessions, record, recordDir };
}

describe('the walk loop drawing', () => {
  it('loads with its three roles and no error', () => {
    const loaded = loadLoopGraph(graphText, { resolveRole, connectedTargets: null });
    assert.ok(loaded.ok, loaded.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message).join('; '));
    for (const node of loaded.graph?.nodes.filter((entry) => entry.kind === 'agent') ?? []) {
      const role = node.role === undefined ? null : resolveRole(node.role);
      assert.ok(role !== null && (role.instructions ?? '').length > 200, `${node.id}'s role is read from its file`);
      assert.ok(role?.targetsDeclared, 'the role declares its targets');
    }
    assert.deepEqual(loaded.graph?.nodes.find((node) => node.id === 'review')?.limits?.maxReworkRounds, 1, 'one correction round');
  });
});

describe('the prompts', () => {
  const plan: WalkPlan = readPlanAnswer(JSON.parse(/```json\n([\s\S]*)\n```/.exec(PLAN_TWO)?.[1] ?? '{}')).plan as WalkPlan;
  const role = (id: 'plan' | 'write' | 'review') => {
    const loaded = loadLoopGraph(graphText, { resolveRole, connectedTargets: null });
    const node = loaded.graph?.nodes.find((entry) => entry.id === id);
    const resolved = node?.role === undefined ? null : resolveRole(node.role);
    assert.ok(resolved);
    return resolved;
  };
  it('give each role its own text, the shared task, the reader and no quotas', () => {
    const planner = planPrompt({ role: role('plan'), material, folder, language: 'en', rework: null });
    assert.ok(planner.startsWith('DSPATCH-REVIEW-TASK: plan-walks'));
    assert.ok(planner.includes('## Your role: walk-planner'));
    assert.ok(planner.includes('"brief"'), 'the planner briefs the writer');
    assert.ok(planner.includes('Write no "body" and no "details"'), 'the planner writes no explanation');
    const writer = writeStepPrompt({ role: role('write'), plan, stepId: 'W1.2', profile: 'pedagog', language: 'en', material, folder, fresh: true, rework: null });
    assert.ok(writer.includes('## Your role: walk-writer'));
    assert.ok(writer.includes('## How to explain the step (Teacher)'));
    assert.ok(writer.includes('Explain this code to a person reviewing the change'), 'the shared explanation task');
    assert.ok(writer.includes('The reader can program but may not know this language'), 'the profile\'s reader');
    assert.ok(writer.includes('Make a transition comprehensible'), 'the walk reading rules');
    assert.ok(writer.includes('## This step: W1.2 Connect'));
    assert.ok(writer.includes('Brief: Reached from start'));
    assert.ok(writer.includes('The step before: W1.1 Start'));
    assert.ok(!/\b(two|four to six|ten) sentences\b/i.test(writer), 'no sentence quota');
    assert.ok(!/at most (one|two) identifiers/i.test(writer), 'no identifier limit');
    const later = writeStepPrompt({ role: role('write'), plan, stepId: 'W1.1', profile: 'pedagog', language: 'en', material, folder, fresh: false, rework: null });
    assert.ok(!later.includes('## Your role'), 'a later turn in the same session repeats no role');
    assert.ok(later.includes('## This step: W1.1 Start'));
    const texts = new Map([
      ['W1.1', { body: 'First.', details: '' }],
      ['W1.2', { body: 'Second.', details: 'Deeper.' }],
    ]);
    const reviewer = reviewPrompt({ role: role('review'), plan, texts, profile: 'essens', language: 'en', material, folder, final: false, earlier: null, fresh: true });
    assert.ok(reviewer.includes('## Your role: walk-reviewer'));
    assert.ok(reviewer.includes('#### W1.2 Connect'));
    assert.ok(reviewer.includes('Second.') && reviewer.includes('Show more:\nDeeper.'));
    assert.ok(reviewer.includes('never ask for a change on a matter of style'));
    assert.ok(!reviewer.includes('## The final assessment'));
    const final = reviewPrompt({ role: role('review'), plan, texts, profile: 'essens', language: 'en', material, folder, final: true, earlier: { assessment: '', verdict: 'rework', findings: [{ kind: 'explanation', steps: ['W1.2'], problem: 'Thin.', why: '', evidence: '', reference: '' }] }, fresh: false });
    assert.ok(final.includes('## The final assessment') && final.includes('no further correction follows'));
    assert.ok(final.includes('- W1.2: Thin.'), 'the final assessment recalls the first findings');
  });
  it('show a step\'s context places to the writer and the reviewer beside its reviewed place (DSP-175)', () => {
    const withContext = readPlanAnswer({
      summary: 's',
      walks: [{ kind: 'walk', title: 'Formatting', purpose: 'p', steps: [{ title: 'The call', summary: 'calls formatCount', brief: 'b', places: [{ label: 'The call', path: 'src/a.ts', side: 'target', start: 1, end: 1 }, { label: 'formatCount', repository: 'count-lib', path: 'src/format.ts', start: 6, end: 12 }] }] }],
    }).plan;
    assert.ok(withContext !== null);
    assert.equal(withContext.walks.walks[0]?.steps[0]?.contextPlaces?.length, 1);
    const writer = writeStepPrompt({ role: role('write'), plan: withContext, stepId: 'W1.1', profile: 'standard', language: 'en', material, folder, fresh: true, rework: null });
    assert.ok(writer.includes('formatCount: context repository count-lib, src/format.ts lines 6–12'), 'the writer sees the context place');
    const reviewer = reviewPrompt({ role: role('review'), plan: withContext, texts: new Map([['W1.1', { body: 'Text.', details: '' }]]), profile: 'standard', language: 'en', material, folder, final: false, earlier: null, fresh: true });
    assert.ok(reviewer.includes('context repository count-lib'), 'the reviewer sees the context place');
    const without = readPlanAnswer({ summary: 's', walks: [{ kind: 'walk', title: 'Formatting', purpose: 'p', steps: [{ title: 'The call', summary: 'calls formatCount', places: [{ label: 'The call', path: 'src/a.ts', side: 'target', start: 1, end: 1 }] }] }] }).plan;
    assert.ok(without !== null);
    assert.notEqual(stepSignature(withContext.walks.walks[0]!.steps[0]!), stepSignature(without.walks.walks[0]!.steps[0]!), 'a changed context place is a changed step');
  });

  it('read the reviewer\'s verdict into the drawing\'s outcomes', () => {
    const ids = new Set(stepRefsOf(plan.walks).map((ref) => ref.stepId));
    const accept = readReviewAnswer({ assessment: 'fine', verdict: 'accept', findings: [] }, ids, false);
    assert.equal(accept.review?.verdict, 'accept');
    assert.equal(reviewOutcomeOf(accept.review!), 'accepted');
    const text = readReviewAnswer({ verdict: 'rework', findings: [{ kind: 'explanation', steps: ['W1.2'], problem: 'Thin.' }] }, ids, false);
    assert.equal(reviewOutcomeOf(text.review!), 'rework-text');
    const structure = readReviewAnswer({ verdict: 'rework', findings: [{ kind: 'structure', steps: [], problem: 'A step is missing.' }, { kind: 'explanation', steps: ['W1.1'], problem: 'Thin.' }] }, ids, false);
    assert.equal(reviewOutcomeOf(structure.review!), 'rework-plan', 'any structural finding goes to the planner');
    const unknownStep = readReviewAnswer({ verdict: 'rework', findings: [{ kind: 'explanation', steps: ['W9.9'], problem: 'Thin.' }] }, ids, false);
    assert.equal(unknownStep.review?.verdict, 'accept', 'a finding about a step that does not exist is dropped, and nothing is left to act on');
    assert.ok(unknownStep.problems[0]?.includes('W9.9'));
    const finalRework = readReviewAnswer({ verdict: 'rework', findings: [{ kind: 'explanation', steps: ['W1.2'], problem: 'Still thin.' }] }, ids, true);
    assert.equal(finalRework.review?.verdict, 'objections', 'on the final assessment rework is read as objections');
    assert.equal(reviewOutcomeOf(finalRework.review!), 'objections');
  });
});

describe('the run', () => {
  it('plans, writes every step, reviews and delivers when the reviewer accepts', async () => {
    const { outcome, sessions, record } = await run({ plan: [PLAN_TWO], review: [reviewJson('accept', [])] }, { name: 'accept' });
    assert.equal(outcome.kind, 'delivered');
    if (outcome.kind !== 'delivered') {
      return;
    }
    assert.deepEqual(outcome.summary.path, ['plan', 'write', 'review', 'delivered']);
    assert.equal(outcome.summary.status, 'delivered');
    assert.equal(outcome.summary.rounds, 0);
    assert.deepEqual(sessions.opened, ['plan', 'write', 'review'], 'one session per role, opened in turn');
    assert.deepEqual(sessions.prompts.map((entry) => entry.node), ['plan', 'write', 'write', 'review']);
    assert.equal(outcome.walks.walks[0]?.steps[1]?.body, 'Text for W1.2.');
    assert.equal(outcome.walks.walks[0]?.steps[1]?.details, 'More on W1.2.');
    assert.equal(outcome.summary.turns.length, 4);
    assert.equal(outcome.summary.usage, 'unknown', 'a provider that reported nothing is unknown, not zero');
    assert.equal(record.replies.length, 4, 'every exchange is in the record');
    assert.ok(record.replies.every((reply) => (reply.prompt ?? '').length > 0 && reply.sessionId !== undefined));
    assert.equal(record.replies[0]?.roleId, 'walk-planner');
    assert.equal(record.ending?.kind, 'finished');
    assert.ok(record.journal.some((entry) => entry.kind === 'edge-taken' && entry.edgeId === 'e-accepted'));
  });

  it('sends explanation findings to the writer, which writes only the named step again, then takes the final assessment', async () => {
    const { outcome, sessions } = await run(
      { plan: [PLAN_TWO], review: [reviewJson('rework', [{ kind: 'explanation', steps: ['W1.2'], problem: 'Thin.', why: 'The reader needs the condition.' }]), reviewJson('accept', [])] },
      { name: 'rework-text' },
    );
    assert.equal(outcome.kind, 'delivered');
    if (outcome.kind !== 'delivered') {
      return;
    }
    assert.deepEqual(outcome.summary.path, ['plan', 'write', 'review', 'write', 'review', 'delivered']);
    assert.equal(outcome.summary.rounds, 1);
    assert.equal(outcome.summary.replanned, false);
    assert.deepEqual(outcome.summary.rewritten, ['W1.2']);
    const writes = sessions.prompts.filter((entry) => entry.node === 'write');
    assert.equal(writes.length, 3, 'two steps first, one again');
    assert.ok(writes[2]?.prompt.includes("## The reviewer's findings about this step") && writes[2]?.prompt.includes('Thin.'));
    assert.ok(!writes[2]?.prompt.includes('## Your role'), 'the rewrite continues the writer\'s session');
    assert.equal(outcome.summary.final?.verdict, 'accept');
    assert.deepEqual(sessions.opened, ['plan', 'write', 'review'], 'no second session for a revisit');
  });

  it('sends structural findings to the planner; a changed plan has only its new step written', async () => {
    const { outcome, sessions } = await run(
      { plan: [PLAN_TWO, PLAN_THREE], review: [reviewJson('rework', [{ kind: 'structure', steps: ['W1.2'], problem: 'open() is central and needs a step.' }]), reviewJson('accept', [])] },
      { name: 'rework-plan' },
    );
    assert.equal(outcome.kind, 'delivered');
    if (outcome.kind !== 'delivered') {
      return;
    }
    assert.deepEqual(outcome.summary.path, ['plan', 'write', 'review', 'plan', 'write', 'review', 'delivered']);
    assert.equal(outcome.summary.replanned, true);
    assert.deepEqual(outcome.summary.rewritten, ['W1.3']);
    const plans = sessions.prompts.filter((entry) => entry.node === 'plan');
    assert.ok(plans[1]?.prompt.includes("## The reviewer's findings about the structure") && plans[1]?.prompt.includes('open() is central'));
    assert.ok(plans[1]?.prompt.includes('## Your earlier plan'));
    assert.equal(outcome.walks.walks[0]?.steps.length, 3);
    assert.equal(outcome.walks.walks[0]?.steps[0]?.body, 'Text for W1.1.', 'an unchanged step keeps its text');
    assert.equal(outcome.walks.walks[0]?.steps[2]?.body, 'Text for W1.3.');
  });

  it('reads a second request for rework as the final assessment\'s objections and delivers with them on record', async () => {
    const { outcome, record } = await run(
      {
        plan: [PLAN_TWO],
        review: [reviewJson('rework', [{ kind: 'explanation', steps: ['W1.1'], problem: 'Thin.' }]), reviewJson('rework', [{ kind: 'explanation', steps: ['W1.1'], problem: 'Still thin.' }])],
      },
      { name: 'objections' },
    );
    assert.equal(outcome.kind, 'delivered');
    if (outcome.kind !== 'delivered') {
      return;
    }
    assert.equal(outcome.objections, true);
    assert.equal(outcome.summary.status, 'delivered-with-objections');
    assert.equal(outcome.summary.final?.verdict, 'objections');
    assert.equal(outcome.summary.final?.findings[0]?.problem, 'Still thin.');
    assert.equal(outcome.summary.path.at(-1), 'delivered-with-objections');
    assert.equal(record.ending?.terminalNodeId, 'delivered-with-objections');
  });

  it('ends without walks when the planner gives nothing readable twice', async () => {
    const { outcome, sessions, record } = await run({ plan: ['I could not plan this.', 'Still nothing.'], review: [] }, { name: 'blocked' });
    assert.equal(outcome.kind, 'failed');
    if (outcome.kind !== 'failed') {
      return;
    }
    assert.ok(outcome.note.includes('did not answer with walks'));
    assert.equal(outcome.summary?.status, 'stopped');
    assert.deepEqual(sessions.prompts.map((entry) => entry.node), ['plan', 'plan'], 'one repair turn, never a loop, and no writer');
    assert.equal(record.ending?.terminalNodeId, 'stopped');
  });

  it('ends early, without a resend, when a turn is cancelled or fails', async () => {
    const cancelled = await run(
      { plan: [PLAN_TWO], review: [], write: (stepId) => (stepId === 'W1.2' ? { status: 'cancelled', text: '', error: null, sessionId: 's' } : 'Text.') },
      { name: 'cancelled' },
    );
    assert.equal(cancelled.outcome.kind, 'ended-early');
    if (cancelled.outcome.kind === 'ended-early') {
      assert.equal(cancelled.outcome.turn.status, 'cancelled');
      assert.equal(cancelled.outcome.summary.status, 'cancelled');
    }
    assert.deepEqual(cancelled.sessions.prompts.map((entry) => entry.node), ['plan', 'write', 'write'], 'nothing after the cancelled turn');
    assert.equal(cancelled.record.ending?.kind, 'cancelled');
    const failed = await run(
      { plan: [PLAN_TWO], review: [], write: () => ({ status: 'failed', text: '', error: 'SCRIPTED provider failure', sessionId: 's' }) },
      { name: 'failed' },
    );
    assert.equal(failed.outcome.kind, 'ended-early');
    if (failed.outcome.kind === 'ended-early') {
      assert.equal(failed.outcome.turn.error, 'SCRIPTED provider failure');
      assert.equal(failed.outcome.summary.status, 'failed');
    }
    assert.equal(failed.sessions.prompts.filter((entry) => entry.node === 'write').length, 1, 'the failed turn is not sent again');
  });

  it('starts no further step once the operator cancelled between steps', async () => {
    const controller = new AbortController();
    const { outcome, sessions } = await run(
      {
        plan: [PLAN_TWO],
        review: [reviewJson('accept', [])],
        write: (stepId) => {
          if (stepId === 'W1.2') {
            controller.abort();
          }
          return 'Text.';
        },
      },
      { name: 'aborted', signal: controller.signal },
    );
    assert.equal(outcome.kind, 'failed');
    assert.ok(!sessions.prompts.some((entry) => entry.node === 'review'), 'the reviewer was never started');
    if (outcome.kind === 'failed') {
      assert.ok(outcome.detail.includes('cancelled'), outcome.detail);
    }
  });
});
