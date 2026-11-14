/**
 * DSP-209 S10b: a fan-out node's one visit, run as branch instances.
 *
 * Scripted executors and temporary git repositories the tests make and remove; no provider.
 * What matters to a person: each branch has its own session and worktree, at most the
 * allowed number run at once, nothing of a branch's work is lost, and the person's own
 * working copy is never touched.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { stepSessionId } from '../src/main/loop-live';
import { createWorktreeDriver, listRunBranches, runGit } from '../src/main/run-worktrees';
import { LOOP_GRAPH_FORMAT, LOOP_GRAPH_FORMAT_VERSION, type FanOutIsolation, type LoopGraph } from '../src/shared/loop-graph';
import { createMemoryResultStore } from '../src/shared/loop-results';
import {
  FAN_OUT_ADAPTER_CAPS,
  instanceSessionId,
  runLoopGraph,
  type FanOutDriver,
  type StepExecutor,
} from '../src/shared/loop-run';
import { branchInstanceStates, describeBranchInstances, runViewFor, type RunView } from '../src/shared/loop-run-view';

const FENCE = '```';
const roots: string[] = [];

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function repository(name: string): { readonly repo: string; readonly worktreesRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-fanout-${name}-`));
  roots.push(root);
  const repo = path.join(root, 'project');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@localhost');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n', 'utf8');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '--quiet', '-m', 'first');
  return { repo, worktreesRoot: path.join(root, 'userdata', 'loop-runs', 'run', 'worktrees') };
}

/** The person's side of the repository, to compare before and after. */
function personState(repo: string): Record<string, string> {
  return {
    status: git(repo, 'status', '--porcelain'),
    branch: git(repo, 'branch', '--show-current'),
    head: git(repo, 'rev-parse', 'HEAD'),
    stash: git(repo, 'stash', 'list'),
  };
}

function slices(ids: readonly string[]): string {
  return `${FENCE}dspatch-slices\n${JSON.stringify({
    slices: ids.map((id) => ({ id, result: `${id} done`, ownedPaths: [`${id}.txt`], allowedActions: [], contractRefs: [], verification: 'none' })),
  })}\n${FENCE}`;
}

function graph(isolation: FanOutIsolation, maxConcurrent: number, workId = 'work'): LoopGraph {
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'fan',
    name: 'Fan-out',
    purpose: 'Slice, implement in parallel, integrate.',
    target: 'cursor',
    entry: 'slice',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [{ id: 'branch-failed', label: 'branch failed', meaning: 'A branch failed.' }],
    limits: { maxCalls: 10 },
    nodes: [
      { id: 'slice', kind: 'agent', label: 'Slice', produces: { required: true, form: 'stored-result' } },
      { id: workId, kind: 'agent', label: 'Implement', declaredFailures: ['branch-failed'], fanOut: { slicesFrom: 'slice', maxConcurrent, isolation } },
      { id: 'integrate', kind: 'agent', label: 'Integrate' },
      { id: 'done', kind: 'terminal', label: 'Done' },
      { id: 'failed', kind: 'terminal', label: 'Failed', ending: 'not-success' },
    ],
    edges: [
      { id: 'e1', from: 'slice', to: workId, when: { on: 'success' } },
      { id: 'e2', from: workId, to: 'integrate', when: { on: 'success' } },
      { id: 'e3', from: workId, to: 'failed', when: { on: 'declared-failure', failure: 'branch-failed' } },
      { id: 'e4', from: 'integrate', to: 'done', when: { on: 'success' } },
    ],
  };
}

/** A scripted executor: the slicer writes `block`; each branch writes its owned file, after `holdMs`. */
function scripted(block: string, options: { readonly holdMs?: number; readonly running?: { now: number; max: number; order: string[] }; readonly untilAborted?: AbortSignal } = {}): StepExecutor {
  return async (context) => {
    const instance = context.instance;
    if (instance === undefined) {
      return { product: { kind: 'success' }, summary: `scripted ${context.node.id}`, providerTurns: 1, resultBody: context.node.id === 'slice' ? block : 'integrated' };
    }
    const running = options.running;
    if (running !== undefined) {
      running.now += 1;
      running.max = Math.max(running.max, running.now);
      running.order.push(`start ${instance.sliceId}`);
    }
    if (instance.workspacePath !== null) {
      fs.writeFileSync(path.join(instance.workspacePath, `${instance.sliceId}.txt`), `${instance.sliceId}\n`, 'utf8');
    }
    if (options.untilAborted !== undefined) {
      const signal = options.untilAborted;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, options.holdMs ?? 5));
    }
    if (running !== undefined) {
      running.now -= 1;
      running.order.push(`end ${instance.sliceId}`);
    }
    return options.untilAborted?.aborted === true
      ? { product: { kind: 'runtime-fault', fault: 'no-outcome-delivered', detail: 'cancelled' }, summary: 'cancelled', providerTurns: 1 }
      : { product: { kind: 'success' }, summary: `branch ${instance.sliceId}`, providerTurns: 1, resultBody: `I did ${instance.sliceId}.` };
  };
}

/** A driver with no git, for the rules that do not need one. */
function memoryDriver(log: string[]): FanOutDriver {
  return {
    base: async () => ({ commit: 'base0', kind: 'head', untrackedNotIncluded: 0 }),
    open: async ({ sliceId }) => {
      log.push(`open ${sliceId}`);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-fanout-mem-${sliceId}-`));
      roots.push(dir);
      return { workspacePath: dir, branch: `dspatch/run/r/${sliceId}` };
    },
    close: async ({ branch }) => {
      log.push(`close ${branch}`);
      return { commit: `commit-of-${branch}`, removed: true, problem: null };
    },
  };
}

function view(journal: RunView['entries']): RunView {
  return {
    ...runViewFor({ runId: 'r', graphVersionId: 'g', graphId: 'fan', graphName: 'Fan-out', binding: 'chat-loop', graphText: '{}', startedAtUtc: '2026-11-14T04:00:00.000Z' }),
    entries: journal,
    ended: true,
    status: 'completed',
  };
}

describe('fan-out in the engine (DSP-209 S10b)', () => {
  it('runs two slices in their own worktrees and sessions, counts one call each, commits and keeps both branches', async () => {
    const { repo, worktreesRoot } = repository('two');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nnot committed\n', 'utf8');
    const before = personState(repo);
    const result = await runLoopGraph(graph('worktree', 2), {
      runId: 'run-two',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutDriver: createWorktreeDriver({ repo, worktreesRoot }),
      executor: scripted(slices(['a', 'b'])),
    });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.equal(result.terminalNodeId, 'done');
    assert.deepEqual(result.path, ['slice', 'work', 'integrate', 'done'], 'the walk stays one node at a time');
    assert.equal(result.usage.calls, 4, 'slice, two branches, integrate: the fan-out node adds none');

    const started = result.journal.filter((entry) => entry.kind === 'branch-started');
    const ended = result.journal.filter((entry) => entry.kind === 'branch-ended');
    assert.deepEqual(started.map((entry) => entry.data?.['sliceId']).sort(), ['a', 'b']);
    assert.deepEqual(ended.map((entry) => entry.data?.['ending']), ['finished', 'finished']);
    const sessions = started.map((entry) => entry.data?.['sessionId']);
    assert.equal(new Set(sessions).size, 2);
    assert.ok(started.every((entry) => entry.data?.['baseKind'] === 'stash-create'), 'uncommitted work is in the base');

    assert.deepEqual(await listRunBranches(runGit, repo, 'run-two'), ['dspatch/run/run-two/work/v1/a', 'dspatch/run/run-two/work/v1/b']);
    assert.equal(git(repo, 'show', 'dspatch/run/run-two/work/v1/a:a.txt'), 'a');
    assert.equal(git(repo, 'show', 'dspatch/run/run-two/work/v1/b:a.txt'), 'one\nnot committed', 'each branch started from the base with the uncommitted change');
    assert.equal(fs.existsSync(path.join(worktreesRoot, 'work', 'v1', 'a')), false, 'worktrees are removed once committed');
    assert.deepEqual(personState(repo), before, 'the person\'s working copy, branch, HEAD and stash list are untouched');
    assert.equal(fs.existsSync(path.join(repo, 'a.txt')) && fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\nnot committed\n');

    const branches = branchInstanceStates(view(result.journal)).get('work') ?? [];
    assert.equal(describeBranchInstances(branches), 'branches: 2 finished');
  });

  it('keeps instance sessions apart from every step\'s, even a node called "work-a" beside slice "a" of "work"', () => {
    const instance = instanceSessionId('run', 'work', 1, 'a');
    assert.notEqual(instance, stepSessionId('run', 'work-a'));
    assert.notEqual(instance, stepSessionId('run', 'work'));
    assert.notEqual(instance, instanceSessionId('run', 'work', 2, 'a'));
    assert.notEqual(instance, instanceSessionId('run', 'work', 1, 'b'));
    assert.match(instance, /^[A-Za-z0-9._+-]+$/, 'still safe as a folder name');
  });

  it('runs at most the effective number at once: a third slice starts only after one of two ends', async () => {
    const running = { now: 0, max: 0, order: [] as string[] };
    const result = await runLoopGraph(graph('shared-read-only', 3), {
      runId: 'run-three',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutAdapterCap: 2,
      executor: scripted(slices(['a', 'b', 'c']), { holdMs: 15, running }),
    });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.equal(running.max, 2);
    assert.ok(running.order.indexOf('start c') > Math.min(running.order.indexOf('end a'), running.order.indexOf('end b')));
    assert.equal(result.usage.calls, 5);
  });

  it('gives a Cursor run one branch at a time', async () => {
    assert.equal(FAN_OUT_ADAPTER_CAPS.cursor, 1);
    const running = { now: 0, max: 0, order: [] as string[] };
    await runLoopGraph(graph('shared-read-only', 3), {
      runId: 'run-cursor',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutAdapterCap: FAN_OUT_ADAPTER_CAPS.cursor,
      executor: scripted(slices(['a', 'b']), { holdMs: 5, running }),
    });
    assert.equal(running.max, 1);
  });

  it('ends as branch-failed with the problems stated, and makes no worktree, when the slices are invalid', async () => {
    const log: string[] = [];
    const result = await runLoopGraph(graph('worktree', 2), {
      runId: 'run-bad',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutDriver: memoryDriver(log),
      executor: scripted(`${FENCE}dspatch-slices\n{"slices":[{"id":"a","result":"x","ownedPaths":["src"],"allowedActions":[],"contractRefs":[],"verification":"v"},{"id":"b","result":"y","ownedPaths":["src/b.ts"],"allowedActions":[],"contractRefs":[],"verification":"v"}]}\n${FENCE}`),
    });
    assert.equal(result.terminalNodeId, 'failed');
    assert.deepEqual(log, [], 'no worktree was opened');
    const produced = result.journal.find((entry) => entry.kind === 'node-produced' && entry.nodeId === 'work');
    assert.match(produced?.detail ?? '', /would both write/);
  });

  it('cancel ends every branch, commits what each left, and leaves no worktree with uncommitted work', async () => {
    const { repo, worktreesRoot } = repository('cancel');
    const before = personState(repo);
    const abort = new AbortController();
    const running = { now: 0, max: 0, order: [] as string[] };
    const executor = scripted(slices(['a', 'b']), { untilAborted: abort.signal, running });
    const walking = runLoopGraph(graph('worktree', 2), {
      runId: 'run-cancel',
      dryRun: true,
      signal: abort.signal,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutDriver: createWorktreeDriver({ repo, worktreesRoot }),
      executor,
    });
    for (let tries = 0; tries < 400 && running.now < 2; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(running.now, 2, 'both branches were running');
    abort.abort();
    const result = await walking;
    assert.equal(result.status, 'runtime-fault');
    assert.match(result.fault?.detail ?? '', /cancelled during the fan-out/);
    const ended = result.journal.filter((entry) => entry.kind === 'branch-ended');
    assert.equal(ended.length, 2);
    for (const sliceId of ['a', 'b']) {
      assert.equal(git(repo, 'show', `dspatch/run/run-cancel/work/v1/${sliceId}:${sliceId}.txt`), sliceId, 'the branch\'s work is committed');
      assert.equal(fs.existsSync(path.join(worktreesRoot, 'work', 'v1', sliceId)), false);
    }
    assert.deepEqual(personState(repo), before);
  });

  it('keeps the worktree, and says why, when the commit is refused', async () => {
    const { repo, worktreesRoot } = repository('refused');
    const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho "refused by the test hook" >&2\nexit 1\n', { encoding: 'utf8', mode: 0o755 });
    const result = await runLoopGraph(graph('worktree', 1), {
      runId: 'run-refused',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutDriver: createWorktreeDriver({ repo, worktreesRoot }),
      executor: scripted(slices(['a'])),
    });
    const ended = result.journal.find((entry) => entry.kind === 'branch-ended');
    assert.equal(ended?.data?.['worktreeKept'], true);
    assert.equal(ended?.data?.['commit'], '(none)');
    assert.match(String(ended?.data?.['problem'] ?? ''), /could not be committed, so its worktree was kept/);
    const kept = path.join(worktreesRoot, 'work', 'v1', 'a');
    assert.equal(fs.readFileSync(path.join(kept, 'a.txt'), 'utf8'), 'a\n', 'the work is still there');
    // The test removes its own worktree; DSpatch kept it for the person.
    git(repo, 'worktree', 'remove', '--force', kept);
  });
});
