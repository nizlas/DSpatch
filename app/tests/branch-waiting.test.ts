/**
 * DSP-228: a branch keeps working while a question is open, the reminder for unread messages is
 * bounded, and every branch's open decision reaches the integrating step whole.
 *
 * Through the live executor with a simulated adapter and real git worktrees; no provider is called.
 * The graph is the coordination pilot's (lead, two parts, joiner), built with the reusable sections.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import type { AgentEvent, AgentEventListener, AppTool } from '../src/adapter/types';
import type { ChatAdapter } from '../src/main/chat-service';
import { OPEN_DECISION_RULE, describeBranchAssignment } from '../src/main/loop-live';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { runLiveGraph } from '../src/main/loop-live-run';
import { chatPromptFor } from '../src/shared/loop-chat';
import type { LoopGraph } from '../src/shared/loop-graph';
import { loadLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';
import { applyParallelSection } from '../src/shared/loop-graph-sections';
import { openDecisionsIn, type RunJournalEntry } from '../src/shared/loop-run';

const pilotDir = path.resolve(fileURLToPath(new URL('../scripts/coordination-pilot', import.meta.url)));
const FENCE = '```';
const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const role = (name: string) => ({ id: `pilot-${name}`, source: { kind: 'role-source' as const, path: `roles/pilot-${name}.role.md` } });

function graph(): LoopGraph {
  const bare = parseLoopGraph(
    JSON.stringify({
      format: 'dspatch-loop-graph',
      formatVersion: 1,
      id: 'waiting',
      name: 'Waiting',
      purpose: 'Two parts in parallel, then a joiner.',
      target: 'claude-code',
      entry: 'lead',
      onRuntimeFault: 'stop-and-reconcile',
      failureKinds: [],
      nodes: [
        { id: 'lead', kind: 'agent', label: 'Lead', purpose: 'Split the work.', role: role('lead'), outcomes: ['solo', 'split'], produces: { required: true, form: 'stored-result' } },
        { id: 'solo', kind: 'agent', label: 'Solo', purpose: 'Do it alone.', role: role('worker') },
        { id: 'done', kind: 'terminal', label: 'Done', ending: 'success' },
        { id: 'halted', kind: 'terminal', label: 'Halted', ending: 'not-success' },
      ],
      edges: [
        { id: 'e1', from: 'lead', to: 'solo', when: { on: 'outcome', outcome: 'solo' } },
        { id: 'e2', from: 'solo', to: 'done', when: { on: 'success' } },
      ],
    }),
  );
  assert.ok(bare.ok);
  const applied = applyParallelSection(bare.graph, {
    proposer: 'lead',
    splitOutcome: 'split',
    branches: { id: 'parts', role: role('worker') },
    branchAs: [],
    sliceChoices: [],
    branchModelChoice: null,
    maxConcurrent: 2,
    isolation: 'worktree',
    integrator: { id: 'joiner', role: role('joiner') },
    outcomes: { integrated: 'integrated', rework: 'rework', unresolved: 'needs-decision' },
    afterIntegration: { to: 'done' },
    onUnresolved: 'halted',
    onLimit: null,
  });
  assert.deepEqual(applied.problems, []);
  const loaded = loadLoopGraph(JSON.stringify(applied.graph), { resolveRole: createFileRoleResolver(pilotDir) });
  assert.ok(loaded.ok, JSON.stringify(loaded.findings));
  return loaded.graph;
}

const LEAD = `Two parts.\n\n${FENCE}dspatch-slices\n${JSON.stringify({
  slices: ['a', 'b'].map((id) => ({ id, result: `part ${id}`, ownedPaths: [`${id}.txt`], allowedActions: ['edit'], contractRefs: [], verification: 'none' })),
})}\n${FENCE}\n\nRESULT: split`;

/** A long reply with its open decision at the end, past where the fan-out result clips. */
const LONG_B = `${'Worked through part b in detail. '.repeat(90)}\n\n## Open decision\n\nWhether till amounts are kronor: I need the ledger branch's answer, and nothing else in my slice is left without it.`;

/**
 * Branch a sends b a finding, then a second one. Branch b never checks in its first turn; on the
 * reminder it either ignores the mail again (`ignore`) or hangs until cancelled (`hang`).
 */
class Agent {
  readonly prompts = new Map<string, string[]>();
  private readonly tools = new Map<string, readonly AppTool[]>();
  private readonly listeners = new Map<string, AgentEventListener>();
  private readonly cancelled = new Set<string>();
  private aSent = false;
  private readonly onReminder: 'ignore' | 'hang';
  constructor(onReminder: 'ignore' | 'hang') {
    this.onReminder = onReminder;
  }
  private key(sessionId: string): string {
    const slice = /\+\d+\+([A-Za-z0-9._-]+)$/.exec(sessionId)?.[1];
    return slice !== undefined ? `branch:${slice}` : /--(lead|joiner|solo)(--visit-\d+)?$/.exec(sessionId)?.[1] ?? sessionId;
  }
  startSession(config: { dspatchSessionId?: string; appTools?: readonly AppTool[] }) {
    const id = config.dspatchSessionId ?? 's';
    this.tools.set(id, config.appTools ?? []);
    return Promise.resolve({ dspatchSessionId: id, provider: 'claude', providerSessionId: `p-${id}`, createdAt: new Date().toISOString() });
  }
  subscribe(sessionId: string, listener: AgentEventListener) {
    this.listeners.set(sessionId, listener);
    return () => this.listeners.delete(sessionId);
  }
  private async tool(sessionId: string, name: string, args: Record<string, unknown> = {}): Promise<string> {
    const found = this.tools.get(sessionId)?.find((item) => item.name === name);
    assert.ok(found, `${name} offered`);
    return (await found.execute(args)).text;
  }
  send(sessionId: string, prompt: string) {
    const key = this.key(sessionId);
    this.prompts.set(key, [...(this.prompts.get(key) ?? []), prompt]);
    const turn = this.prompts.get(key)?.length ?? 0;
    const runId = `${sessionId}-${String(turn)}`;
    const emit = (event: Partial<AgentEvent>): void => {
      void this.listeners.get(sessionId)?.({ dspatchSessionId: sessionId, dspatchRunId: runId, at: new Date().toISOString(), rawProviderEvent: null, ...event } as AgentEvent);
    };
    const work = async (): Promise<string | null> => {
      if (key === 'lead') return LEAD;
      if (key === 'joiner') return 'Merged.\n\nRESULT: integrated';
      if (key === 'branch:a') {
        await this.tool(sessionId, 'send_message', { to: 'b', purpose: 'finding', body: 'Till amounts are kronor.' });
        this.aSent = true;
        await this.tool(sessionId, 'send_message', { to: 'b', purpose: 'question', body: 'Do you also convert?' });
        return 'Part a done.';
      }
      if (turn === 1) {
        for (let tries = 0; tries < 400 && !this.aSent; tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
        await new Promise((resolve) => setTimeout(resolve, 20));
        return LONG_B;
      }
      if (this.onReminder === 'hang') {
        for (let tries = 0; tries < 2000 && !this.cancelled.has(sessionId); tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
        return null;
      }
      return `${LONG_B}\n\nI did not read the messages.`;
    };
    setImmediate(() => {
      void work().then((text) => {
        emit({ type: 'run.started' } as Partial<AgentEvent>);
        if (text === null) {
          emit({ type: 'run.finished', status: 'cancelled' } as Partial<AgentEvent>);
          return;
        }
        emit({ type: 'assistant.message', text } as Partial<AgentEvent>);
        emit({ type: 'run.finished', status: 'finished' } as Partial<AgentEvent>);
      });
    });
    return Promise.resolve({ dspatchRunId: runId });
  }
  cancel(sessionId: string) {
    this.cancelled.add(sessionId);
    return Promise.resolve();
  }
  readUsage() {
    return Promise.resolve([]);
  }
  dispose() {
    return Promise.resolve();
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

async function run(onReminder: 'ignore' | 'hang', abort?: AbortController) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-waiting-'));
  scratch.push(dir);
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  git(project, 'init', '--quiet', '--initial-branch=main');
  git(project, 'config', 'user.name', 'Test');
  git(project, 'config', 'user.email', 'test@localhost');
  git(project, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(project, 'README.md'), 'project\n');
  git(project, 'add', '.');
  git(project, 'commit', '--quiet', '-m', 'first');
  const g = graph();
  const agent = new Agent(onReminder);
  const entries: RunJournalEntry[] = [];
  const walking = runLiveGraph(g, {
    runId: `waiting-${onReminder}`,
    repoRoot: pilotDir,
    outDir: null,
    resultsDir: path.join(dir, 'results'),
    modelRequested: 'm',
    workspacePath: project,
    keepWorkspace: true,
    bindingKind: 'chat-loop',
    provider: 'claude',
    createAdapter: () => agent as unknown as ChatAdapter,
    onJournalEntry: (entry) => entries.push(entry),
    ...(abort === undefined ? {} : { abortSignal: abort.signal }),
    promptFor: (node, step) => chatPromptFor(node, { entryId: g.entry, mandate: 'Two parts.', step }),
  });
  return { walking, agent, entries };
}

test('a branch that ends with mail waiting is reminded once, not again, and its open decision reaches the joiner whole', async () => {
  const { walking, agent, entries } = await run('ignore');
  const delivery = await walking;
  assert.equal(delivery.result.status, 'completed', delivery.journalText);
  const b = agent.prompts.get('branch:b') ?? [];
  assert.equal(b.length, 2, 'one first turn and exactly one reminder, though mail was still waiting after it');
  assert.match(b[1] ?? '', /^Before you finish: 2 messages from other branches are waiting[\s\S]*This is the only reminder/);
  assert.equal(agent.prompts.get('branch:a')?.length, 1, 'a branch with nothing waiting is not reminded');
  // Sent, then never delivered: b did not check, and the journal says so rather than calling it read.
  const kinds = entries.filter((entry) => String(entry.kind).startsWith('message-')).map((entry) => entry.kind);
  assert.deepEqual(kinds.filter((kind) => kind === 'message-sent').length, 2);
  assert.ok(!kinds.includes('message-delivered') && !kinds.includes('message-acknowledged'));
  assert.equal(kinds.filter((kind) => kind === 'message-undelivered').length, 2);
  const ended = entries.find((entry) => entry.kind === 'branch-ended' && entry.data?.['sliceId'] === 'b');
  assert.equal(ended?.data?.['providerTurns'], 2);
  // The joiner is given b's open decision whole, though b's reply itself was cut.
  const joiner = agent.prompts.get('joiner')?.[0] ?? '';
  assert.match(joiner, /DSpatch cut this reply at 2000/);
  assert.match(joiner, /## Open decisions and blockers from the branches[\s\S]*From b:[\s\S]*> ## Open decision[\s\S]*> Whether till amounts are kronor: I need the ledger branch's answer/);
  assert.match(joiner, /A branch that ended finished its slice, not the task/);
  assert.match(joiner, /never delivered to b/);
});

test('cancelling during the reminder turn ends the run as cancelled and does not hold the branch', async () => {
  const abort = new AbortController();
  const { walking, agent } = await run('hang', abort);
  for (let tries = 0; tries < 400 && (agent.prompts.get('branch:b')?.length ?? 0) < 2; tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(agent.prompts.get('branch:b')?.length, 2, 'the reminder was sent');
  abort.abort();
  const delivery = await walking;
  assert.equal(delivery.result.status, 'runtime-fault');
  assert.match(delivery.result.fault?.detail ?? '', /cancelled/);
  assert.equal(agent.prompts.get('joiner'), undefined, 'nothing after a cancel');
});

test('the branch instructions say to keep working, check at boundaries and hand open questions on, in both variants', () => {
  const slice = { id: 'a', result: 'a.', ownedPaths: ['a.txt'], allowedActions: ['edit'], contractRefs: [], verification: 'none' };
  const instance = { instanceId: 'p#1/a', sliceId: 'a', slice, isolation: 'worktree' as const, sessionId: 's', workspacePath: '/w', branch: 'b', base: 'c', mailbox: {} as never };
  const mail = describeBranchAssignment(instance);
  assert.match(mail, /Sending a question or a finding is no reason to stop working/);
  assert.match(mail, /go on with the work that does not depend on it, and use a reply if one arrives while you work/);
  assert.match(mail, /natural work boundaries/);
  assert.match(mail, /Do not call check_messages again and again, and do not sleep or poll/);
  for (const text of [mail, describeBranchAssignment(instance, { messaging: false })]) {
    assert.ok(text.includes(OPEN_DECISION_RULE));
  }
  assert.match(OPEN_DECISION_RULE, /Do not guess an answer you need, and do not treat a proposed change to a shared contract as agreed/);
  assert.match(OPEN_DECISION_RULE, /no meaningful work independent of it is left[\s\S]*"Open decision" \(or "Blocked"/);
  assert.match(OPEN_DECISION_RULE, /Ending your branch does not finish the task/);
  assert.doesNotMatch(describeBranchAssignment(instance, { messaging: false }), /check_messages|send_message/);
});

test('open decisions and blockers are found by their headings, to the next heading; one that says none is left out', () => {
  const reply = [
    'Did the work.',
    '',
    '**Open decision (shared contract):** where the conversion lives.',
    '- What is needed: a decision.',
    '',
    '**Left undone:** nothing.',
    '',
    '## Blocked',
    '',
    'The data file is missing.',
    '',
    '**Open decision:** none for my slice.',
  ].join('\n');
  assert.deepEqual(openDecisionsIn(reply), [
    '**Open decision (shared contract):** where the conversion lives.\n- What is needed: a decision.',
    '## Blocked\n\nThe data file is missing.',
  ]);
  assert.deepEqual(openDecisionsIn('No open decision here, said in a sentence.'), []);
});
