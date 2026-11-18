/**
 * DSP-226: controlled parallelism in the generic agent network.
 *
 * The Tech Lead's dispatch may split a subtask into branches that run at the same time, each
 * as its own capability with its own model class and review route, in its own session and
 * worktree; the integrator combines them and sends the whole to the review route the branches
 * needed. Simulated adapters and scripted executors only: no real provider is called here.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import type { AgentEvent, AgentEventListener, AppTool } from '../src/adapter/types';
import type { ChatAdapter } from '../src/main/chat-service';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { runLiveGraph } from '../src/main/loop-live-run';
import { branchRows } from '../src/shared/branch-presentation';
import { chatPromptFor, skippingRoutesOf } from '../src/shared/loop-chat';
import type { LoopGraph, RunProvider } from '../src/shared/loop-graph';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { createMemoryResultStore } from '../src/shared/loop-results';
import { nodeModelMark, runLoopGraph, type FanOutDriver, type RunJournalEntry, type StepContext, type StepExecution } from '../src/shared/loop-run';
import { branchViewsFromJournal } from '../src/shared/run-presentation';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FENCE = '```';
const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function load(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(path.join(root, 'docs/loop/graphs/generic-agent-network.graph.json'), 'utf8'), {
    resolveRole: createFileRoleResolver(root),
  });
  assert.ok(loaded.ok, JSON.stringify(loaded.findings));
  return loaded.graph;
}

interface SliceSpec {
  readonly id: string;
  readonly owns: readonly string[];
  readonly as?: string;
  readonly choices?: Record<string, string>;
  readonly dependsOn?: readonly string[];
}

function sliceBlock(slices: readonly SliceSpec[]): string {
  return `${FENCE}dspatch-slices\n${JSON.stringify({
    slices: slices.map((slice) => ({
      id: slice.id,
      result: `${slice.id} done`,
      ...(slice.as === undefined ? {} : { as: slice.as }),
      ...(slice.choices === undefined ? {} : { choices: slice.choices }),
      ownedPaths: slice.owns,
      allowedActions: ['edit'],
      contractRefs: ['docs/contract.md@v1'],
      acceptance: `${slice.id} meets its check`,
      verification: `check ${slice.id}`,
      ...(slice.dependsOn === undefined ? {} : { dependsOn: slice.dependsOn }),
    })),
  })}\n${FENCE}`;
}

/** The two-branch split most tests use: a small implementer and a large, thorough researcher. */
const SPLIT: readonly SliceSpec[] = [
  { id: 'a', owns: ['a.txt'], choices: { class: 'small', review: 'standard' } },
  { id: 'b', owns: ['notes/b.md'], as: 'researcher', choices: { class: 'large', review: 'thorough' } },
];

const defaults: Record<string, string> = {
  'executive-intake': 'select-slice',
  'tl-select': 'slice-selected',
  'reviewer-plan-gate': 'accept',
  'tl-dispatch': 'implementer',
  integrator: 'integrated',
  qa: 'pass',
  'qa-design': 'pass',
  reviewer: 'accept',
  skeptic: 'pass',
  'tl-accept': 'accept',
  'executive-continue': 'wrap-up',
};

function memoryDriver(log: string[]): FanOutDriver {
  return {
    base: async () => ({ commit: 'base0', kind: 'head', untrackedNotIncluded: 0 }),
    open: async ({ sliceId, visit }) => {
      log.push(`open v${String(visit)} ${sliceId}`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dsp-par-${sliceId}-`));
      scratch.push(dir);
      return { workspacePath: dir, branch: `dspatch/run/r/branches/v${String(visit)}/${sliceId}` };
    },
    close: async ({ branch }) => {
      log.push(`close ${branch}`);
      return { commit: `commit-of-${branch}`, removed: true, problem: null };
    },
  };
}

/** The generic network through the engine, each step answered by a script; branches by `branch`. */
async function scripted(options: {
  outcomes?: Record<string, string>;
  bodies?: Record<string, string>;
  branch?: (context: StepContext) => Promise<StepExecution>;
  cap?: number;
  signal?: AbortSignal;
  driverLog?: string[];
}) {
  const seen: StepContext[] = [];
  const entries: RunJournalEntry[] = [];
  const result = await runLoopGraph(load(), {
    runId: 'r',
    dryRun: false,
    maxTransitions: 100,
    onJournalEntry: (entry) => entries.push(entry),
    resultStore: createMemoryResultStore((text) => createHash('sha256').update(text).digest('hex')),
    fanOutDriver: memoryDriver(options.driverLog ?? []),
    ...(options.cap === undefined ? {} : { fanOutAdapterCap: options.cap }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    runModel: { provider: 'claude', model: 'chat-model', classes: { small: 'model-small', medium: 'model-medium', large: 'model-large' } },
    executor: async (context): Promise<StepExecution> => {
      seen.push(context);
      if (context.instance !== undefined) {
        return (
          (await options.branch?.(context)) ?? {
            product: { kind: 'success' },
            summary: 'branch',
            providerTurns: 1,
            resultBody: `${context.instance.sliceId} v${String(context.occurrence)} done`,
          }
        );
      }
      const node = context.node.id;
      const key = `${node}#${String(context.occurrence)}`;
      const outcome = options.outcomes?.[key] ?? options.outcomes?.[node] ?? defaults[node];
      return {
        product: outcome === undefined ? { kind: 'success' } : { kind: 'outcome', outcome, source: 'step-declared' },
        summary: node,
        providerTurns: 1,
        resultBody: `${key} evidence\n${options.bodies?.[key] ?? options.bodies?.[node] ?? ''}`,
      };
    },
  });
  return { result, seen, entries };
}

const visited = (seen: readonly StepContext[], node: string): StepContext[] => seen.filter((item) => item.node.id === node && item.instance === undefined);
const branchCalls = (seen: readonly StepContext[]): StepContext[] => seen.filter((item) => item.instance !== undefined);

test('a simple task still takes the sequential dispatch and never fans out', async () => {
  const { result, seen } = await scripted({});
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.ok(seen.some((item) => item.node.id === 'implementer'));
  assert.equal(branchCalls(seen).length, 0);
  assert.ok(!seen.some((item) => item.node.id === 'branches' || item.node.id === 'integrator'));
});

test('overlapping write ownership and a dependency between slices stop the split before any branch starts', async () => {
  for (const [split, words] of [
    [[{ id: 'a', owns: ['src'] }, { id: 'b', owns: ['src/b.ts'] }], /would both write/],
    [[{ id: 'a', owns: ['a.txt'] }, { id: 'b', owns: ['b.txt'], dependsOn: ['a'] }], /depends on slice "a".*later round.*in sequence/],
  ] as const) {
    const log: string[] = [];
    const { result, seen, entries } = await scripted({
      outcomes: { 'tl-dispatch#1': 'parallel', 'integrator#1': 'return-to-lead' },
      bodies: { 'tl-dispatch#1': sliceBlock(split) },
      driverLog: log,
    });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(log, [], 'no worktree was opened');
    assert.equal(branchCalls(seen).length, 0, 'no branch started');
    const produced = entries.find((entry) => entry.kind === 'node-produced' && entry.nodeId === 'branches');
    assert.match(produced?.detail ?? '', words);
    // The refusal reaches the integrator, which returns it to the lead for a new split.
    assert.ok(visited(seen, 'integrator')[0]?.received.some((item) => item.nodeId === 'branches' && words.test(item.body)));
    assert.equal(visited(seen, 'tl-dispatch').length, 2);
  }
});

test('each branch runs as its own capability with its own choices; the strongest review route goes on to QA and review', async () => {
  const { result, seen, entries } = await scripted({
    outcomes: { 'tl-dispatch#1': 'parallel' },
    bodies: { 'tl-dispatch#1': sliceBlock(SPLIT) },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  const [a, b] = ['a', 'b'].map((id) => branchCalls(seen).find((item) => item.instance?.sliceId === id)!);
  assert.equal(a?.node.role?.id, 'generic-implementer');
  assert.equal(b?.node.role?.id, 'generic-researcher');
  assert.equal(a?.node.id, 'branches', 'a branch stays the fan-out node\'s instance');
  assert.equal(a?.choices?.['class']?.value, 'small');
  assert.equal(b?.choices?.['class']?.value, 'large');
  assert.equal(b?.choices?.['review']?.value, 'thorough');
  assert.notEqual(a?.instance?.workspacePath, b?.instance?.workspacePath);
  const started = entries.filter((entry) => entry.kind === 'branch-started');
  assert.deepEqual(started.map((entry) => [entry.data?.['sliceId'], entry.data?.['runsAs'], entry.data?.['roleId'], entry.data?.['modelClass'], entry.data?.['model']]), [
    ['a', 'branches', 'generic-implementer', 'small', 'model-small'],
    ['b', 'researcher', 'generic-researcher', 'large', 'model-large'],
  ]);
  // Joined: thorough, so the integrated work takes design QA and the thorough review. The class
  // does not join (DSP-227): the integrator keeps the class its own policy takes, the lead's.
  const integrator = visited(seen, 'integrator')[0]!;
  assert.equal(integrator.choices?.['review']?.value, 'thorough');
  assert.equal(integrator.choices?.['class']?.value, 'medium');
  assert.ok(result.edgesTaken.includes('e146'));
  assert.ok(!seen.some((item) => item.node.id === 'qa'));
  assert.equal(visited(seen, 'reviewer')[0]?.choices?.['review']?.value, 'thorough');
  // The integrator gets every branch's result; the review gets the integrator's, not a branch's alone.
  const fanned = integrator.received.find((item) => item.nodeId === 'branches')?.body ?? '';
  assert.match(fanned, /## a[\s\S]*Runs as: branches; class small, review standard[\s\S]*Ended: finished/);
  assert.match(fanned, /## b[\s\S]*Runs as: researcher; class large, review thorough/);
  assert.ok(visited(seen, 'qa-design')[0]?.received.some((item) => item.nodeId === 'integrator'));
  // On the canvas: a summary of the branches' classes, not one class; each branch its own.
  const branchesNode = load().nodes.find((node) => node.id === 'branches')!;
  const mark = nodeModelMark(branchesNode, entries);
  assert.equal(mark?.line, 'latest: visit 1 · 2 branches: Small ×1 · Large ×1');
  assert.deepEqual(mark?.badge, { full: 'S·L', short: 'SL' });
  const rows = branchRows(branchViewsFromJournal('r', entries), 'branches');
  assert.deepEqual(rows.map((row) => [row.sliceId, row.role, row.modelClass]), [
    ['a', 'role generic-implementer', 'Small'],
    ['b', 'role generic-researcher, as researcher', 'Large'],
  ]);
});

test('two branches overlap in time under a cap of three, and run one after another, saying so, under a cap of one', async () => {
  for (const cap of [3, 1]) {
    const running = { now: 0, max: 0 };
    const { result, entries } = await scripted({
      cap,
      outcomes: { 'tl-dispatch#1': 'parallel' },
      bodies: { 'tl-dispatch#1': sliceBlock(SPLIT) },
      branch: async (context) => {
        running.now += 1;
        running.max = Math.max(running.max, running.now);
        await new Promise((resolve) => setTimeout(resolve, 40));
        running.now -= 1;
        return { product: { kind: 'success' }, summary: 'b', providerTurns: 1, resultBody: `${context.instance?.sliceId ?? ''} done` };
      },
    });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.equal(running.max, cap === 3 ? 2 : 1);
    const fanned = result.results.find((item) => item.nodeId === 'branches')?.body ?? '';
    const started = entries.filter((entry) => entry.kind === 'branch-started');
    if (cap === 1) {
      assert.match(fanned, /runs at most 1 branch at a time in DSpatch, so these 2 ran one after another/);
      assert.ok(started.every((entry) => entry.data?.['concurrencyLimitedByAgent'] === true));
    } else {
      assert.doesNotMatch(fanned, /one after another/);
      assert.ok(started.every((entry) => entry.data?.['concurrencyLimitedByAgent'] === undefined));
    }
  }
});

test('a failed branch reaches the integrator by name, its work kept, and is not integrated', async () => {
  const log: string[] = [];
  const { result, seen } = await scripted({
    driverLog: log,
    outcomes: { 'tl-dispatch#1': 'parallel', 'integrator#1': 'return-to-lead' },
    bodies: { 'tl-dispatch#1': sliceBlock(SPLIT) },
    branch: async (context) =>
      context.instance?.sliceId === 'b'
        ? { product: { kind: 'runtime-fault', fault: 'no-outcome-delivered', detail: 'the turn ended as failed' }, summary: 'b failed', providerTurns: 1 }
        : { product: { kind: 'success' }, summary: 'a', providerTurns: 1, resultBody: 'a done' },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.ok(result.edgesTaken.includes('e143'), 'the branch-failed route leads to the integrator');
  const fanned = visited(seen, 'integrator')[0]?.received.find((item) => item.nodeId === 'branches')?.body ?? '';
  assert.match(fanned, /- b: no-outcome-delivered, commit commit-of-dspatch\/run\/r\/branches\/v1\/b/);
  assert.match(fanned, /## b[\s\S]*Ended: no-outcome-delivered — not finished/);
  assert.deepEqual(log.filter((line) => line.startsWith('close')).sort(), ['close dspatch/run/r/branches/v1/a', 'close dspatch/run/r/branches/v1/b']);
  assert.ok(result.edgesTaken.includes('e148'), 'returned to the lead, not integrated');
});

test('a revisit of the fan-out makes a new round of branches, kept apart from the first', async () => {
  const log: string[] = [];
  const { result, seen, entries } = await scripted({
    driverLog: log,
    outcomes: { 'tl-dispatch#1': 'parallel', 'integrator#1': 'rework' },
    bodies: { 'tl-dispatch#1': sliceBlock(SPLIT), 'integrator#1': 'Branch a: rename the key.' },
  });
  assert.equal(result.status, 'completed', result.fault?.detail ?? '');
  assert.deepEqual(log.filter((line) => line.startsWith('open')), ['open v1 a', 'open v1 b', 'open v2 a', 'open v2 b']);
  const second = branchCalls(seen).filter((item) => item.occurrence === 2);
  assert.equal(second.length, 2);
  assert.ok(second.every((item) => item.received.some((received) => received.nodeId === 'integrator' && /rename the key/.test(received.body))));
  assert.ok(branchCalls(seen).filter((item) => item.occurrence === 1).every((item) => !item.received.some((received) => received.nodeId === 'integrator')));
  const ids = branchCalls(seen).map((item) => item.instance?.instanceId);
  assert.deepEqual(ids, ['branches#1/a', 'branches#1/b', 'branches#2/a', 'branches#2/b']);
  const results = result.results.filter((item) => item.nodeId === 'branches');
  assert.equal(results.length, 2);
  assert.match(results[1]?.body ?? '', /a v2 done/);
  assert.doesNotMatch(results[1]?.body ?? '', /a v1 done/);
  const rows = branchRows(branchViewsFromJournal('r', entries), 'branches');
  assert.deepEqual(rows.map((row) => [row.sliceId, row.visitLabel]), [['a', 'visit 2'], ['b', 'visit 2'], ['a', 'earlier visit (visit 1)'], ['b', 'earlier visit (visit 1)']]);
  assert.match(nodeModelMark(load().nodes.find((node) => node.id === 'branches')!, entries)?.line ?? '', /^latest: visit 2 · 2 branches/);
});

test('cancelling during the branches ends the run as cancelled and closes every branch, so no work is lost', async () => {
  const log: string[] = [];
  const abort = new AbortController();
  let running = 0;
  const walking = scripted({
    driverLog: log,
    signal: abort.signal,
    outcomes: { 'tl-dispatch#1': 'parallel' },
    bodies: { 'tl-dispatch#1': sliceBlock(SPLIT) },
    branch: async () => {
      running += 1;
      await new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
      return { product: { kind: 'runtime-fault', fault: 'no-outcome-delivered', detail: 'cancelled' }, summary: 'cancelled', providerTurns: 1 };
    },
  });
  for (let tries = 0; tries < 400 && running < 2; tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(running, 2);
  abort.abort();
  const { result } = await walking;
  assert.equal(result.status, 'runtime-fault');
  assert.match(result.fault?.detail ?? '', /cancelled during the fan-out of "branches"/);
  assert.deepEqual(log.filter((line) => line.startsWith('close')).sort(), ['close dspatch/run/r/branches/v1/a', 'close dspatch/run/r/branches/v1/b']);
});

/* Through the live executor, with a simulated adapter, git worktrees and the mailbox tools. */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

/** Answers each step by script; a branch writes its file, uses the mailbox and takes a moment. */
class ParallelAgent {
  readonly prompts = new Map<string, string[]>();
  readonly models = new Map<string, string>();
  readonly workspaces = new Map<string, string>();
  readonly running = { now: 0, max: 0 };
  readonly mail: string[] = [];
  private readonly tools = new Map<string, readonly AppTool[]>();
  private readonly listeners = new Map<string, AgentEventListener>();
  private sentToB = false;
  private readonly provider: RunProvider;
  private readonly nodeIds: readonly string[];
  private readonly replies: Readonly<Record<string, string>>;
  constructor(provider: RunProvider, nodeIds: readonly string[], replies: Readonly<Record<string, string>>) {
    this.provider = provider;
    this.nodeIds = nodeIds;
    this.replies = replies;
  }
  private nodeOf(sessionId: string): string {
    const bare = sessionId.replace(/--visit-\d+$/, '');
    return [...this.nodeIds].sort((a, b) => b.length - a.length).find((id) => bare.endsWith(`--${id}`)) ?? '';
  }
  startSession(config: { dspatchSessionId?: string; workspacePath?: string; modelRequested?: string; appTools?: readonly AppTool[] }) {
    const id = config.dspatchSessionId ?? 's';
    this.models.set(id, config.modelRequested ?? '');
    this.workspaces.set(id, config.workspacePath ?? '');
    this.tools.set(id, config.appTools ?? []);
    return Promise.resolve({ dspatchSessionId: id, provider: this.provider, providerSessionId: `${this.provider}-${id}`, createdAt: new Date().toISOString() });
  }
  setSessionModel(sessionId: string, model: string) {
    this.models.set(sessionId, model);
  }
  subscribe(sessionId: string, listener: AgentEventListener) {
    this.listeners.set(sessionId, listener);
    return () => this.listeners.delete(sessionId);
  }
  private async tool(sessionId: string, name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(sessionId)?.find((item) => item.name === name);
    assert.ok(tool, `${name} offered to ${sessionId}`);
    return (await tool.execute(args)).text;
  }
  send(sessionId: string, prompt: string) {
    const slice = /\+\d+\+([A-Za-z0-9._-]+)$/.exec(sessionId)?.[1] ?? null;
    const key = slice === null ? this.nodeOf(sessionId) : `branch:${slice}`;
    this.prompts.set(key, [...(this.prompts.get(key) ?? []), prompt]);
    const visit = this.prompts.get(key)?.length ?? 0;
    const emit = (event: Partial<AgentEvent>): void => {
      this.listeners.get(sessionId)?.({ dspatchSessionId: sessionId, dspatchRunId: `${sessionId}-${String(visit)}`, at: new Date().toISOString(), rawProviderEvent: null, ...event } as AgentEvent);
    };
    const work = async (): Promise<string> => {
      if (slice === null) {
        return this.replies[`${key}#${String(visit)}`] ?? `${key} visit ${String(visit)} done.\n\nRESULT: ${defaults[key] ?? 'succeeded'}`;
      }
      this.running.now += 1;
      this.running.max = Math.max(this.running.max, this.running.now);
      const workspace = this.workspaces.get(sessionId) ?? '';
      const file = slice === 'a' ? 'a.txt' : 'notes/b.md';
      fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
      fs.writeFileSync(path.join(workspace, file), `${slice}\n`, 'utf8');
      if (slice === 'a') {
        this.mail.push(await this.tool(sessionId, 'send_message', { to: 'b', purpose: 'finding', body: 'a.txt now ends with a newline.' }));
        this.sentToB = true;
      } else {
        for (let tries = 0; tries < 200 && !this.sentToB; tries += 1) await new Promise((resolve) => setTimeout(resolve, 5));
        const checked = await this.tool(sessionId, 'check_messages', {});
        this.mail.push(checked);
        const id = /^(\S+) — finding/m.exec(checked)?.[1] ?? '';
        this.mail.push(await this.tool(sessionId, 'acknowledge_message', { id }));
        this.mail.push(
          await this.tool(sessionId, 'send_message', { to: 'integrator', purpose: 'contract-change', body: 'Make the key a tuple.', contractRef: 'docs/contract.md@v1' }),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
      this.running.now -= 1;
      return `Branch ${slice} wrote ${file}.${slice === 'b' ? '\n\n## Open decision\n\ndocs/contract.md@v1: the key as a tuple.' : ''}`;
    };
    setImmediate(() => {
      void work().then((text) => {
        emit({ type: 'run.started' });
        emit({ type: 'assistant.message', text } as Partial<AgentEvent>);
        emit({ type: 'run.finished', status: 'finished' } as Partial<AgentEvent>);
      });
    });
    return Promise.resolve({ dspatchRunId: `${sessionId}-${String(visit)}` });
  }
  cancel() { return Promise.resolve(); }
  readUsage() { return Promise.resolve([]); }
  dispose() { return Promise.resolve(); }
}

for (const provider of ['claude', 'cursor'] as const) {
  test(`live on ${provider} (simulated adapter): branches in worktrees with their own role and model, a message delivered at a check, the integrator given every result`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-parallel-live-'));
    scratch.push(dir);
    const project = path.join(dir, 'project');
    fs.mkdirSync(project);
    git(project, 'init', '--quiet', '--initial-branch=main');
    git(project, 'config', 'user.name', 'Test');
    git(project, 'config', 'user.email', 'test@localhost');
    git(project, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(project, 'README.md'), 'project\n', 'utf8');
    git(project, 'add', '.');
    git(project, 'commit', '--quiet', '-m', 'first');
    const graph = load();
    const resolveRole = createFileRoleResolver(root);
    const entries: RunJournalEntry[] = [];
    const agent = new ParallelAgent(provider, graph.nodes.map((node) => node.id), {
      'tl-dispatch#1': `Two independent parts.\n\nCHOICE: class medium the default\nCHOICE: review standard bounded\n\n${sliceBlock(SPLIT)}\n\nRESULT: parallel`,
    });
    const runId = `par-${provider}`;
    const delivery = await runLiveGraph(graph, {
      runId,
      repoRoot: root,
      outDir: null,
      resultsDir: path.join(dir, 'run', 'results'),
      modelRequested: 'chat-model',
      personModel: 'chat-model',
      modelClasses: { small: 'model-small', medium: 'model-medium', large: 'model-large' },
      workspacePath: project,
      keepWorkspace: true,
      bindingKind: 'chat-loop',
      provider,
      createAdapter: () => agent as unknown as ChatAdapter,
      onJournalEntry: (entry) => entries.push(entry),
      promptFor: (node, step) =>
        chatPromptFor(node, {
          entryId: graph.entry,
          mandate: 'Two independent parts.',
          step,
          role: (() => {
            const resolved = node.role === undefined ? null : resolveRole(node.role);
            return resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null };
          })(),
          skipping: skippingRoutesOf(graph, node.id),
        }),
    });
    assert.equal(delivery.result.status, 'completed', delivery.journalText);
    // Overlap where the agent allows it; one at a time under Cursor's cap, said in the result.
    assert.equal(agent.running.max, provider === 'claude' ? 2 : 1);
    const fanned = delivery.result.results.find((item) => item.nodeId === 'branches')?.body ?? '';
    assert.equal(/one after another/.test(fanned), provider === 'cursor');
    // Each branch: its own session, model, role and worktree; its work committed to its own branch.
    const sessions = [...agent.models.keys()].filter((id) => /\+1\+[ab]$/.test(id));
    assert.equal(sessions.length, 2);
    const sessionOf = (slice: string): string => sessions.find((id) => id.endsWith(`+${slice}`))!;
    assert.equal(agent.models.get(sessionOf('a')), 'model-small');
    assert.equal(agent.models.get(sessionOf('b')), 'model-large');
    const [promptA, promptB] = [agent.prompts.get('branch:a')?.[0] ?? '', agent.prompts.get('branch:b')?.[0] ?? ''];
    assert.match(promptA, /Implement a bounded change/);
    assert.match(promptB, /role "generic-researcher"/);
    assert.doesNotMatch(promptA, /Model class: large/);
    assert.match(promptA, /Model class: small/);
    assert.match(promptB, /Model class: large/);
    assert.match(promptA, /delivered only when its recipient calls check_messages/);
    assert.match(promptA, /"Open decision"/);
    assert.notEqual(agent.workspaces.get(sessionOf('a')), agent.workspaces.get(sessionOf('b')));
    assert.equal(git(project, 'show', `dspatch/run/${runId}/branches/v1/a:a.txt`), 'a');
    assert.equal(git(project, 'show', `dspatch/run/${runId}/branches/v1/b:notes/b.md`), 'b');
    assert.equal(git(project, 'status', '--porcelain'), '', 'the working copy is untouched by the branches');
    // The mailbox: sent, delivered at b's check, acknowledged; kept apart in the journal.
    assert.match(agent.mail[0] ?? '', /delivered when the recipient next checks/);
    assert.match(agent.mail[1] ?? '', /finding from a/);
    assert.equal(agent.mail[2], 'Acknowledged.');
    assert.deepEqual(
      entries.filter((entry) => entry.kind.startsWith('message-')).map((entry) => entry.kind),
      ['message-sent', 'message-delivered', 'message-acknowledged', 'message-sent'],
    );
    // The integrator is given every branch's result, the open proposal and the delivery of each message.
    const integratorPrompt = agent.prompts.get('integrator')?.[0] ?? '';
    assert.match(integratorPrompt, /Combine the results of work done in parallel branches/);
    assert.match(integratorPrompt, /## Open proposals for the integrator[\s\S]*contract-change from b to integrator/);
    assert.match(integratorPrompt, /finding from a to b[^\n]*delivered to b; acknowledged by b/);
    assert.match(integratorPrompt, /## b[\s\S]*Open decision/);
    // The integrated work went on with the strongest route, and the review was given the integrator's result.
    assert.ok(agent.prompts.has('qa-design'));
    assert.ok(!agent.prompts.has('qa'));
    assert.match(agent.prompts.get('qa-design')?.[0] ?? '', /"integrator" left this result[\s\S]*integrator visit 1 done/);
    assert.match(agent.prompts.get('reviewer')?.[0] ?? '', /Review route: thorough/);
  });
}

test('a slice may run only as an allowed node and set only the graph\'s own options', async () => {
  const { readSlices } = await import('../src/shared/loop-slices');
  const graph = load();
  const read = (slice: SliceSpec) =>
    readSlices(sliceBlock([slice]), { isolation: 'worktree', branchAs: graph.nodes.find((node) => node.id === 'branches')?.fanOut?.branchAs ?? [], choices: graph.choices ?? [] });
  const asInfra = read({ id: 'a', owns: ['a.txt'], as: 'infra' });
  assert.ok(!asInfra.ok && asInfra.problems.some((problem) => problem.code === 'unknown-branch-as'));
  const huge = read({ id: 'a', owns: ['a.txt'], choices: { class: 'huge' } });
  assert.ok(!huge.ok && huge.problems.some((problem) => problem.code === 'bad-branch-choice' && /not one of "small", "medium", "large"/.test(problem.message)));
  const fine = read({ id: 'a', owns: ['a.txt'], as: 'explorer', choices: { class: 'small' } });
  assert.ok(fine.ok && fine.slices[0]?.as === 'explorer' && fine.slices[0]?.choices?.['class'] === 'small');
});
