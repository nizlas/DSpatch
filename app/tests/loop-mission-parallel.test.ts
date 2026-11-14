/**
 * The mission loop's two ways to implement a sub-goal (14 November 2026, Niclas's explicit
 * addition to DSP-209): the coordinator sends coherent work to the implementer and
 * independent work through slicer, fan-out branches and integrator, each to its own review
 * and back. Loaded from the shipped file with its real roles and walked with a scripted
 * executor on a temporary git repository. No provider.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { createWorktreeDriver, listRunBranches, runGit } from '../src/main/run-worktrees';
import type { LoopGraph } from '../src/shared/loop-graph';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { createMemoryResultStore } from '../src/shared/loop-results';
import { runLoopGraph, type StepExecution, type StepExecutor } from '../src/shared/loop-run';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphFile = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-mission-loop.graph.json');
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

function loaded(): LoopGraph {
  const result = loadLoopGraph(fs.readFileSync(graphFile, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.findings));
  return result.graph;
}

function repository(name: string): { readonly repo: string; readonly worktreesRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-mission-${name}-`));
  roots.push(root);
  const repo = path.join(root, 'project');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@localhost');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'readme.txt'), 'project\n', 'utf8');
  git(repo, 'add', 'readme.txt');
  git(repo, 'commit', '--quiet', '-m', 'first');
  return { repo, worktreesRoot: path.join(root, 'userdata', 'loop-runs', 'run', 'worktrees') };
}

const said = (outcome: string, body: string): StepExecution => ({
  product: { kind: 'outcome', outcome, source: 'step-declared' },
  summary: outcome,
  providerTurns: 1,
  resultBody: body,
});

const slices = `Two independent parts.\n\n${FENCE}dspatch-slices\n${JSON.stringify({
  slices: ['a', 'b'].map((id) => ({ id, result: `${id} done`, ownedPaths: [`${id}.txt`], allowedActions: ['edit-owned'], contractRefs: [], verification: 'none' })),
})}\n${FENCE}`;

interface Seen {
  readonly received: Record<string, string[]>;
  readonly branches: string[];
}

/** Coordinator choices in order; the rest of the steps answer as named. */
function scripted(choices: readonly string[], seen: Seen, failSlice: string | null): StepExecutor {
  let coordinatorVisits = 0;
  let integrations = 0;
  return async (context) => {
    const node = context.node.id;
    seen.received[`${node}#${String(context.occurrence)}`] = context.received.map((result) => result.nodeId);
    if (context.instance !== undefined) {
      seen.branches.push(`v${String(context.occurrence)}/${context.instance.sliceId}`);
      if (context.instance.sliceId === failSlice) {
        return { product: { kind: 'declared-failure', failure: 'blocked' }, summary: 'blocked', providerTurns: 1, resultBody: 'BLOCKED' };
      }
      if (context.instance.workspacePath !== null) {
        fs.writeFileSync(path.join(context.instance.workspacePath, `${context.instance.sliceId}.txt`), `visit ${String(context.occurrence)}\n`, 'utf8');
      }
      return { product: { kind: 'success' }, summary: 'branch', providerTurns: 1, resultBody: `Did ${context.instance.sliceId}.` };
    }
    switch (node) {
      case 'coordinator': {
        const choice = choices[coordinatorVisits] ?? 'needs-decision';
        coordinatorVisits += 1;
        return said(choice, `Coordinator chose ${choice}.`);
      }
      case 'slicer':
        return { product: { kind: 'success' }, summary: 'sliced', providerTurns: 1, resultBody: slices };
      case 'integrate':
        integrations += 1;
        return said(integrations === 1 ? 'rework' : 'integrated', `Integration ${String(integrations)}.`);
      case 'parallel-review':
      case 'review':
        return said('accept', 'Accepted.');
      case 'implementer':
        return said('done', 'Done.');
      default:
        throw new Error(`unexpected step ${node}`);
    }
  };
}

describe('the mission loop implements a sub-goal sequentially or in parallel', () => {
  it('loads with its real roles; the coordinator offers both ways, and only the parallel path fans out', () => {
    const graph = loaded();
    const coordinator = graph.nodes.find((node) => node.id === 'coordinator');
    assert.ok(coordinator?.kind === 'agent');
    assert.ok(coordinator.outcomes?.includes('implement') && coordinator.outcomes.includes('implement-parallel'));
    assert.deepEqual(graph.nodes.filter((node) => node.fanOut !== undefined).map((node) => node.id), ['branches']);
    assert.deepEqual(graph.nodes.find((node) => node.id === 'branches')?.fanOut, { slicesFrom: 'slicer', maxConcurrent: 3, isolation: 'worktree' });
  });

  it('walks a parallel sub-goal with one rework from the merged state, then a sequential one, each through its own review', async () => {
    const { repo, worktreesRoot } = repository('both');
    const seen: Seen = { received: {}, branches: [] };
    const result = await runLoopGraph(loaded(), {
      runId: 'run-m',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutDriver: createWorktreeDriver({ repo, worktreesRoot }),
      fanOutAdapterCap: 3,
      executor: scripted(['implement-parallel', 'implement', 'needs-decision'], seen, null),
    });
    assert.equal(result.terminalNodeId, 'needs-decision', result.fault?.detail ?? '');
    assert.deepEqual(result.path, [
      'coordinator', 'slicer', 'branches', 'integrate', 'branches', 'integrate', 'parallel-review',
      'coordinator', 'implementer', 'review',
      'coordinator', 'needs-decision',
    ]);
    assert.deepEqual(seen.received['branches#1'], ['coordinator', 'slicer'], 'branches are handed the brief and the plan');
    assert.deepEqual(seen.received['branches#2'], ['coordinator', 'slicer', 'integrate'], 'a rework visit is handed the integrator\'s findings');
    assert.deepEqual(seen.received['parallel-review#1'], ['coordinator', 'integrate']);
    assert.deepEqual(seen.received['coordinator#2'], ['integrate', 'parallel-review'], 'the coordinator gets the whole integration and its review');
    assert.deepEqual(seen.received['coordinator#3'], ['implementer', 'review']);
    assert.deepEqual(await listRunBranches(runGit, repo, 'run-m'), [
      'dspatch/run/run-m/branches/v1/a',
      'dspatch/run/run-m/branches/v1/b',
      'dspatch/run/run-m/branches/v2/a',
      'dspatch/run/run-m/branches/v2/b',
    ]);
  });

  it('sends a failed branch back to the coordinator as not done, past the integrator and review', async () => {
    const { repo, worktreesRoot } = repository('failed');
    const seen: Seen = { received: {}, branches: [] };
    const result = await runLoopGraph(loaded(), {
      runId: 'run-f',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutDriver: createWorktreeDriver({ repo, worktreesRoot }),
      fanOutAdapterCap: 3,
      executor: scripted(['implement-parallel', 'needs-decision'], seen, 'b'),
    });
    assert.deepEqual(result.path, ['coordinator', 'slicer', 'branches', 'coordinator', 'needs-decision'], result.fault?.detail ?? '');
    assert.deepEqual(seen.received['coordinator#2'], ['branches']);
  });
});
