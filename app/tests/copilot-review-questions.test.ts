import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { REVIEW_PERMISSIONS } from '../src/adapter/claude-agent-sdk-adapter.ts';
import { COPILOT_ANALYSIS_POLICY, COPILOT_REVIEW_POLICY, CopilotSdkAdapter } from '../src/adapter/copilot-sdk-adapter.ts';
import { ReviewAgentJobs } from '../src/host/review-agent-jobs.ts';
import { pairEnvelopeSource } from '../src/host/review-pair-discussion.ts';
import { ReviewPairs, pairKeyOf } from '../src/host/review-pairs.ts';
import { RevisionSnapshots } from '../src/host/revision-snapshots.ts';
import { ReviewDiscussions, type ReviewDiscussionService } from '../src/main/review-discussion-service.ts';
import { ReviewService } from '../src/main/review-service.ts';
import { REFERENCES_FENCE, type DiscussionIdentity, type DiscussionMessage } from '../src/shared/review-discussion.ts';
import { isPairError, type AgentJob, type OpenPair, type PairRecord } from '../src/shared/review-pair.ts';
import { EXCLUDED_MARKER, makeHookFixture, type HookFixture } from './support/copilot-hook-fixture.ts';
import { startStandInModel, type ScriptedTurn, type StandInModel } from './support/copilot-stand-in-model.ts';
import { makeInsightFixture, type InsightFixture } from './support/insight-fixture.ts';

/*
 * Copilot answering review questions through the real services (DSP-154): the question from the
 * diff and from a walk, in the real discussion service with the host's code access, and the
 * explanation of a selection in the real job service. The real adapter, runtime and hooks, a
 * local stand-in model, and no account. What a real model chooses to read is not shown here.
 */

let insight: InsightFixture;
let model: StandInModel;
let hooks: HookFixture;
let dir: string;
let pairs: ReviewPairs;
let opened: OpenPair;
let key: string;
let identity: DiscussionIdentity;
let jobs: ReviewAgentJobs;
let snapshots: RevisionSnapshots;
let definitionPath: string;

function adapter(policy: typeof COPILOT_ANALYSIS_POLICY): CopilotSdkAdapter {
  return new CopilotSdkAdapter({
    policy,
    env: { ...process.env, COPILOT_HOME: hooks.home },
    testProvider: { type: 'openai', baseUrl: model.baseUrl, apiKey: 'stand-in' },
  });
}

/** The host's wiring of a discussion (`project-host.ts`), with a test's adapters. */
function discussions(): ReviewDiscussions {
  return new ReviewDiscussions({
    recordsDir: path.join(dir, 'reviews'),
    log: () => undefined,
    createAdapter: () => adapter(COPILOT_REVIEW_POLICY),
    modelFor: () => 'stand-in',
    codeAccess: {
      offered: (provider) => provider !== 'cursor',
      createAdapter: () => adapter(COPILOT_ANALYSIS_POLICY),
      policy: REVIEW_PERMISSIONS,
      policyLine: () => 'analysis',
      hold: (held, holder) => jobs.holdForDiscussion({ repository: held.repository, base: held.base, target: held.target }, holder),
    },
  });
}

function withReferences(text: string, references: readonly unknown[]): ScriptedTurn {
  return { text: `${text}\n\n\`\`\`${REFERENCES_FENCE}\n${JSON.stringify({ references, insufficient: false })}\n\`\`\`` };
}

function sentSince(asked: number): string {
  return JSON.stringify(model.requests.slice(asked).map((request) => request.messages));
}

async function answerTo(service: ReviewDiscussionService, questionId: string): Promise<DiscussionMessage> {
  for (const until = Date.now() + 40_000; Date.now() < until; ) {
    const loaded = await service.load(null, { envelopeFor: () => Promise.reject(new Error('not asked')) });
    const answer = loaded.kind === 'loaded' ? loaded.messages.find((message) => message.role === 'answer' && message.questionId === questionId) : undefined;
    const settled = answer !== undefined && answer.status !== 'streaming' && answer.status !== 'sending';
    // A finished answer is settled once its references have been checked.
    if (settled && (answer.status !== 'done' || answer.references !== undefined)) {
      return answer;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('the answer did not settle');
}

async function settled(id: string): Promise<AgentJob> {
  for (const until = Date.now() + 40_000; Date.now() < until; ) {
    const job = (pairs.state(key) as PairRecord).jobs.find((entry) => entry.id === id);
    if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('the job did not settle');
}

const AT_SAVE = { kind: 'away', location: { path: 'src/save.ts', side: 'target', start: 3, end: 3 } } as const;
const SELECTED = { path: 'src/save.ts', side: 'target', start: 3, end: 4 } as const;
const DEFINITION_AT_TO = 'lane: string';

describe('Copilot review questions through the real services and runtime', { timeout: 240_000 }, () => {
  before(async () => {
    insight = makeInsightFixture();
    model = await startStandInModel();
    hooks = makeHookFixture();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-questions-'));
    pairs = new ReviewPairs({ recordsDir: path.join(dir, 'pairs'), changed: () => undefined });
    await pairs.repositories([insight.workspace]);
    const answer = await pairs.openPair({ repository: insight.insight, base: insight.base, target: insight.target });
    if (isPairError(answer)) {
      throw new Error(answer.error);
    }
    opened = answer;
    key = opened.key;
    identity = { key: pairKeyOf(opened.pair), repository: insight.insight, base: insight.base, target: insight.target, definitionPath: '' };
    snapshots = new RevisionSnapshots({ root: path.join(dir, 'revisions'), log: () => undefined });
    jobs = new ReviewAgentJobs({
      recordsDir: dir,
      createAdapter: () => adapter(COPILOT_ANALYSIS_POLICY),
      snapshots,
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
    });
    definitionPath = path.join(insight.workspace, 'change.review.json');
    fs.writeFileSync(
      definitionPath,
      JSON.stringify({
        format: 'dspatch-review/1',
        title: 'Insight',
        repository: 'insight',
        base: insight.base,
        target: insight.target,
        teachingMode: 'Concise',
        provenance: 'Written by tests/copilot-review-questions.test.ts.',
        walks: [{ id: 'W1', title: 'Saving', question: 'What is saved?', steps: [{ id: 'W1.1', title: 'The workspace is saved', text: 'Saved with the project.', refs: [{ path: 'src/save.ts', side: 'target', start: 3, end: 3, role: 'walk', anchor: 'saveProject' }] }] }],
      }),
    );
  });

  beforeEach(() => {
    hooks.clear();
    hooks.behave({});
  });

  after(async () => {
    await jobs.dispose();
    await model.close();
    hooks.remove();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(insight.workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it('a question from the diff: the definition outside the excerpt is read at To, then at From, and references are checked at each commit', async () => {
    const all = discussions();
    const service = all.serviceFor(identity);
    assert.equal((await service.chooseAgent('copilot')).kind, 'chosen');
    const source = pairEnvelopeSource(pairs, key);
    const asked = model.requests.length;
    model.script(
      { tool: 'view', args: { path: path.join('target', 'src', 'workspace.ts') } },
      withReferences('It has three fields.', [
        { label: 'The type at To', path: 'src/workspace.ts', side: 'target', start: 2, end: 6 },
        // Line 6 exists at To only, and a file that exists nowhere: neither may become a link.
        { label: 'Not at From', path: 'src/workspace.ts', side: 'base', start: 2, end: 6 },
        { label: 'Made up', path: 'src/made-up.ts', side: 'target', start: 1, end: 1 },
      ]),
    );
    const sent = await service.send({ question: 'What is EditorWorkspace?', subject: AT_SAVE, selection: SELECTED, language: 'en' }, source);
    assert.equal(sent.kind, 'sent', JSON.stringify(sent));
    const answer = await answerTo(service, sent.kind === 'sent' ? sent.questionId : '');
    assert.equal(answer.status, 'done', JSON.stringify(answer));
    const first = model.requests[asked];
    assert.ok(first !== undefined);
    assert.deepEqual([...first.toolNames].sort(), ['glob', 'grep', 'view'], 'reading tools only: no shell and no writing');
    const prompt = JSON.stringify(first.messages);
    assert.ok(prompt.includes('saveProject'), 'the selection goes with the question');
    assert.ok(!prompt.includes('scroll: number;\\n  lane') , 'the definition is not in what was sent first');
    assert.ok(sentSince(asked).includes(DEFINITION_AT_TO), 'it reached the model through the read');
    assert.deepEqual(answer.reads, [`Read ${path.join('target', 'src', 'workspace.ts')}`]);
    assert.deepEqual(answer.references?.map((reference) => [reference.range.side, reference.range.path, reference.range.end]), [['target', 'src/workspace.ts', 6]]);
    assert.equal(answer.adjustments?.length, 2, JSON.stringify(answer.adjustments));

    // A follow-up in the same session, at From: the other commit's definition, one field.
    const before = model.requests.length;
    hooks.clear();
    model.script({ tool: 'view', args: { path: path.join('base', 'src', 'workspace.ts') } }, withReferences('At From it had one.', [{ label: 'The type at From', path: 'src/workspace.ts', side: 'base', start: 2, end: 4 }]));
    const next = await service.send({ question: 'And before the change?', subject: AT_SAVE, selection: SELECTED, language: 'en' }, source);
    assert.equal(next.kind, 'sent', JSON.stringify(next));
    const followed = await answerTo(service, next.kind === 'sent' ? next.questionId : '');
    assert.equal(followed.status, 'done', JSON.stringify(followed));
    assert.deepEqual(followed.reads, [`Read ${path.join('base', 'src', 'workspace.ts')}`]);
    assert.deepEqual(followed.references?.map((reference) => reference.range.side), ['base']);
    assert.equal(followed.adjustments?.length ?? 0, 0);
    const results = model.requests.at(-1)?.messages.filter((message) => message.role === 'tool') ?? [];
    assert.ok(JSON.stringify(results.at(-1)).includes('zoom: number') && !JSON.stringify(results.at(-1)).includes(DEFINITION_AT_TO), 'the From file, without the To field');
    assert.ok(JSON.stringify(model.requests[before]?.messages).includes('saveProject'), 'the selection is still there');

    // Each read passed the installed hook, once, in the revision folder.
    const [run] = hooks.invocations().filter((entry) => entry.kind === 'pre');
    assert.ok(run !== undefined);
    assert.ok(path.resolve(run.cwd).startsWith(fs.realpathSync(path.join(dir, 'revisions'))), run.cwd);
    assert.equal(hooks.invocations().filter((entry) => entry.kind === 'pre').length, 1);
    await all.dispose();
  });

  it('Explain more simply goes with the envelope of the answer it explains, in code-reading mode', async () => {
    const all = discussions();
    const service = all.serviceFor({ ...identity, key: `${identity.key}-simple` });
    await service.chooseAgent('copilot');
    const source = pairEnvelopeSource(pairs, key);
    model.script(withReferences('The first answer.', []));
    const sent = await service.send({ question: 'What does this do?', subject: AT_SAVE, selection: SELECTED, language: 'en' }, source);
    assert.equal(sent.kind, 'sent', JSON.stringify(sent));
    const answer = await answerTo(service, sent.kind === 'sent' ? sent.questionId : '');
    const asked = model.requests.length;
    model.script({ tool: 'view', args: { path: path.join('target', 'src', 'workspace.ts') } }, withReferences('Simply put.', []));
    const simpler = await service.send({ question: 'Explain more simply', subject: { kind: 'review' }, selection: null, language: 'en', simplify: { answerId: answer.id } }, source);
    assert.equal(simpler.kind, 'sent', JSON.stringify(simpler));
    const again = await answerTo(service, simpler.kind === 'sent' ? simpler.questionId : '');
    assert.equal(again.status, 'done', JSON.stringify(again));
    assert.deepEqual(again.reads, [`Read ${path.join('target', 'src', 'workspace.ts')}`]);
    const prompt = JSON.stringify(model.requests[asked]?.messages.at(-1));
    assert.ok(prompt.includes('saveProject'), 'the selected code of the earlier question');
    assert.ok(prompt.includes('The first answer.'));
    await all.dispose();
  });

  it('a question from a walk step, and Explain this on selected text, read the revisions the same way', async () => {
    const review = new ReviewService({ recordsDir: path.join(dir, 'walk-records'), log: () => undefined });
    assert.equal((await review.openDefinition(definitionPath)).kind, 'opened');
    const all = discussions();
    const service = all.serviceFor({ ...identity, key: `${identity.key}-walk`, definitionPath });
    await service.chooseAgent('copilot');
    const point = { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 0 } as const;
    model.script({ tool: 'view', args: { path: path.join('target', 'src', 'workspace.ts') } }, withReferences('Three fields.', [{ label: 'The type', path: 'src/workspace.ts', side: 'target', start: 2, end: 6 }]));
    const sent = await service.send({ question: 'Explain this', subject: point, selection: null, language: 'en', deepen: { action: 'explain', text: 'EditorWorkspace' } }, review);
    assert.equal(sent.kind, 'sent', JSON.stringify(sent));
    const answer = await answerTo(service, sent.kind === 'sent' ? sent.questionId : '');
    assert.equal(answer.status, 'done', JSON.stringify(answer));
    assert.deepEqual(answer.reads, [`Read ${path.join('target', 'src', 'workspace.ts')}`]);
    assert.equal(answer.references?.length, 1);
    await all.dispose();
  });

  it('Explain this and its follow-ups from the diff read the revisions, with the selection kept from the root', async () => {
    const file = opened.files.find((entry) => entry.newPath === 'src/save.ts');
    assert.ok(file !== undefined);
    const text = 'export function saveProject(name: string, workspace: EditorWorkspace | null): string {';
    const selection = { fileKey: file.key, text, segments: [{ side: 'target', path: 'src/save.ts', start: 3, end: 3, from: 0, to: text.length }] };
    const output = (text: string): ScriptedTurn => ({ text: `\`\`\`json\n${JSON.stringify({ answer: text, references: [{ label: 'The type', path: 'src/workspace.ts', side: 'target', start: 2, end: 6 }], insufficient: false })}\n\`\`\`` });
    const read: ScriptedTurn = { tool: 'view', args: { path: path.join('target', 'src', 'workspace.ts') } };
    model.script(read, output('It saves the workspace.'));
    const root = await jobs.request(key, { kind: 'explain', provider: 'copilot', model: 'stand-in', selection });
    assert.ok(!isPairError(root), JSON.stringify(root));
    const done = await settled(root.id);
    assert.equal(done.state, 'done', JSON.stringify(done));
    assert.ok(done.investigation?.reads.some((file) => file.replaceAll('\\', '/').includes('target/src/workspace.ts')), JSON.stringify(done.investigation));
    assert.equal(done.answer?.references.length, 1);
    for (const followUp of [{ action: 'simpler' }, { action: 'question', question: 'Which fields?' }]) {
      const asked = model.requests.length;
      model.script(read, output('Again.'));
      const next = await jobs.request(key, { kind: 'explain', provider: 'copilot', model: 'stand-in', followUp: { root: root.id, ...followUp } });
      assert.ok(!isPairError(next), JSON.stringify(next));
      assert.equal((await settled(next.id)).state, 'done');
      assert.ok(JSON.stringify(model.requests[asked]?.messages).includes('saveProject'), 'the root selection goes with the follow-up');
    }
  });

  it('a denying hook stops the read, and the content does not reach the model', async () => {
    const secret = path.join(insight.insight, 'src', 'secret.ts');
    fs.writeFileSync(secret, `export const hidden = '${EXCLUDED_MARKER}';\n`);
    // A pair of its own, whose To holds the excluded file.
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['add', '-A'], { cwd: insight.insight });
    execFileSync('git', ['commit', '-q', '-m', 'Add a file a rule excludes'], { cwd: insight.insight });
    const target = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: insight.insight, encoding: 'utf8' }).trim();
    const pair = await pairs.openPair({ repository: insight.insight, base: insight.base, target });
    assert.ok(!isPairError(pair));
    hooks.behave({ pre: { denyMatching: 'secret\\.ts' } });
    const all = discussions();
    const service = all.serviceFor({ ...identity, key: pair.key, target });
    await service.chooseAgent('copilot');
    const asked = model.requests.length;
    model.script({ tool: 'view', args: { path: path.join('target', 'src', 'secret.ts') } }, withReferences('I could not read it.', []));
    const sent = await service.send({ question: 'What is hidden?', subject: { kind: 'away', location: { path: 'src/load.ts', side: 'target', start: 1, end: 1 } }, selection: null, language: 'en' }, pairEnvelopeSource(pairs, pair.key));
    assert.equal(sent.kind, 'sent', JSON.stringify(sent));
    const answer = await answerTo(service, sent.kind === 'sent' ? sent.questionId : '');
    assert.equal(answer.status, 'done', JSON.stringify(answer));
    assert.deepEqual(answer.reads ?? [], [], 'a refused read is not recorded as read');
    assert.equal(hooks.invocations().filter((entry) => entry.kind === 'post').length, 0);
    assert.ok(!sentSince(asked).includes(EXCLUDED_MARKER));
    assert.ok(sentSince(asked).includes('The synthetic rule excludes this path.'));
    await all.dispose();
  });

  it('writing and commands are refused: not offered, and not run when asked for', async () => {
    const all = discussions();
    const service = all.serviceFor({ ...identity, key: `${identity.key}-write` });
    await service.chooseAgent('copilot');
    const made = path.join('target', 'made-by-question.txt');
    model.script({ tool: 'create', args: { path: made, file_text: 'x' } }, { tool: 'bash', args: { command: 'touch made-by-shell.txt', description: 'a command', mode: 'sync', initial_wait: 5 } }, { tool: 'edit', args: { path: path.join('target', 'src', 'load.ts'), old_str: 'text', new_str: 'changed' } }, withReferences('I can only read.', []));
    const sent = await service.send({ question: 'Change it', subject: AT_SAVE, selection: null, language: 'en' }, pairEnvelopeSource(pairs, key));
    assert.equal(sent.kind, 'sent', JSON.stringify(sent));
    const answer = await answerTo(service, sent.kind === 'sent' ? sent.questionId : '');
    assert.equal(answer.status, 'done', JSON.stringify(answer));
    const folder = path.join(dir, 'revisions');
    const everything = fs.readdirSync(folder, { recursive: true }).map(String);
    assert.equal(everything.some((file) => file.includes('made-by')), false, everything.join(' '));
    assert.equal(hooks.invocations().filter((entry) => entry.kind === 'post' && ['bash', 'create', 'edit'].includes(entry.input.toolName)).length, 0, 'none of them ran');
    assert.deepEqual(answer.reads ?? [], []);
    await all.dispose();
  });
});
