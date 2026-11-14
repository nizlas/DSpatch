/**
 * DSP-209 S10c: the bundled parallel loop — slicer, fan-out implementer, integrator, review.
 *
 * Loaded from the shipped file with its real roles, made choosable like the other bundled
 * loops, and walked with a scripted executor on a temporary git repository: two branches, an
 * integrator that sends them back once (the fan-out's second visit), review, met. And a plan
 * of one slice runs one branch. No provider.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { judgeChosenLoop } from '../src/main/loop-choice-check';
import { listChoosableLoops, openChosenLoop } from '../src/main/loop-definition-choice';
import { openLoopDefinitionFile } from '../src/main/loop-definition-files';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { createWorktreeDriver, listRunBranches, runGit } from '../src/main/run-worktrees';
import type { LoopGraph } from '../src/shared/loop-graph';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { createMemoryResultStore } from '../src/shared/loop-results';
import { runLoopGraph, type StepExecutor } from '../src/shared/loop-run';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphFile = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-parallel-loop.graph.json');
const definitionFile = path.join(repoRoot, '.dspatch', 'loops', 'dspatch-parallel-loop.loop.json');
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-parallel-${name}-`));
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

function block(ids: readonly string[]): string {
  return `The work splits by file.\n\n${FENCE}dspatch-slices\n${JSON.stringify({
    slices: ids.map((id) => ({ id, result: `${id} done`, ownedPaths: [`${id}.txt`], allowedActions: ['edit-owned'], contractRefs: [], verification: 'none' })),
  })}\n${FENCE}`;
}

/** Scripted steps: the slicer plans, branches write their owned file, the integrator sends back once. */
function scripted(ids: readonly string[], seen: { received: Record<string, string[]>; branches: string[] }): StepExecutor {
  let integrations = 0;
  return async (context) => {
    const node = context.node.id;
    seen.received[`${node}#${String(context.occurrence)}`] = context.received.map((result) => result.nodeId);
    if (context.instance !== undefined) {
      seen.branches.push(`v${String(context.occurrence)}/${context.instance.sliceId}`);
      if (context.instance.workspacePath !== null) {
        fs.writeFileSync(path.join(context.instance.workspacePath, `${context.instance.sliceId}.txt`), `visit ${String(context.occurrence)}\n`, 'utf8');
      }
      return { product: { kind: 'success' }, summary: 'branch', providerTurns: 1, resultBody: `Did ${context.instance.sliceId}.` };
    }
    if (node === 'slice') {
      return { product: { kind: 'success' }, summary: 'sliced', providerTurns: 1, resultBody: block(ids) };
    }
    if (node === 'integrate') {
      integrations += 1;
      const outcome = integrations === 1 && ids.length > 1 ? 'rework' : 'integrated';
      return { product: { kind: 'outcome', outcome, source: 'step-declared' }, summary: outcome, providerTurns: 1, resultBody: `Integration ${String(integrations)}: ${outcome}.` };
    }
    return { product: { kind: 'outcome', outcome: 'met', source: 'step-declared' }, summary: 'met', providerTurns: 1, resultBody: 'Met.' };
  };
}

describe('the bundled parallel loop (DSP-209 S10c)', () => {
  it('loads with its real roles, and its implementing step is the only fan-out', () => {
    const graph = loaded();
    assert.deepEqual(graph.nodes.filter((node) => node.fanOut !== undefined).map((node) => node.id), ['work']);
    assert.deepEqual(graph.nodes.find((node) => node.id === 'work')?.fanOut, { slicesFrom: 'slice', maxConcurrent: 3, isolation: 'worktree' });
    assert.match(graph.notes ?? '', /mission decisions 5 .*22 .*27/s);
    assert.match(graph.purpose ?? '', /have not been observed/);
  });

  // S10c review (blocking): nothing in the engine stops an integrator from moving the person's
  // uncommitted work aside to get a merge through; the guard is this role text, so it is pinned.
  it('tells the integrator never to touch the person\'s uncommitted work, and how to merge a rework visit', () => {
    const role = fs.readFileSync(path.join(repoRoot, 'docs', 'loop', 'roles', 'project', 'project-integrate.role.md'), 'utf8');
    assert.match(role, /Before you merge anything, run `git status`/);
    assert.match(role, /never stash, commit, reset, check out or discard them/);
    assert.match(role, /every branch already contains the uncommitted work it started from/);
    assert.match(role, /begin your reply with BLOCKED, name the files that are in the way/);
    assert.match(role, /merge \*\*only the new visit's branches\*\*/);
    assert.match(role, /Never revert a merge you already made unless you say so/);
    assert.match(role, /Never delete a temporary branch/);
  });

  it('is choosable like the other bundled loops, and runnable as chosen', () => {
    const listing = listChoosableLoops([repoRoot], [], undefined, null, repoRoot);
    const row = listing.choices.find((choice) => choice.definitionId === 'dspatch-parallel-loop');
    assert.ok(row !== undefined, listing.choices.map((choice) => choice.definitionId).join(', '));
    const judged = judgeChosenLoop(openChosenLoop(openLoopDefinitionFile(definitionFile)), 'it was not chosen');
    assert.equal(judged.runnable, true, judged.runnable ? '' : judged.note);
  });

  // The mission loop is no longer in this list: on 14 November 2026 Niclas had its parallel
  // path added, which reuses this loop's roles and the engine's fan-out (loop-mission-parallel.test.ts).
  it('leaves the chat and development loops exactly as they are in HEAD', () => {
    for (const file of [
      '.dspatch/loops/dspatch-chat-loop.loop.json',
      'docs/loop/graphs/dspatch-chat-loop.graph.json',
      '.dspatch/loops/dspatch-development-loop.loop.json',
      'docs/loop/graphs/dspatch-development-loop.graph.json',
    ]) {
      // Read-only: compares the working file with HEAD's.
      assert.equal(git(repoRoot, 'diff', '--name-only', 'HEAD', '--', file), '', `${file} is unchanged`);
    }
  });

  it('runs slicer, two branches, integrator, back to the branches once, integrator, review, met — keeping every branch', async () => {
    const { repo, worktreesRoot } = repository('two');
    const seen = { received: {} as Record<string, string[]>, branches: [] as string[] };
    const result = await runLoopGraph(loaded(), {
      runId: 'run-par',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutDriver: createWorktreeDriver({ repo, worktreesRoot }),
      fanOutAdapterCap: 3,
      executor: scripted(['a', 'b'], seen),
    });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.equal(result.terminalNodeId, 'done');
    assert.deepEqual(result.path, ['slice', 'work', 'integrate', 'work', 'integrate', 'review', 'done']);
    assert.deepEqual([...seen.branches].sort(), ['v1/a', 'v1/b', 'v2/a', 'v2/b']);
    assert.deepEqual(seen.received['integrate#1'], ['work'], 'the integrator is handed the branch list');
    assert.deepEqual(seen.received['work#2'], ['integrate'], 'the second visit is handed the integrator\'s findings');
    assert.deepEqual(await listRunBranches(runGit, repo, 'run-par'), [
      'dspatch/run/run-par/work/v1/a',
      'dspatch/run/run-par/work/v1/b',
      'dspatch/run/run-par/work/v2/a',
      'dspatch/run/run-par/work/v2/b',
    ]);
    assert.equal(git(repo, 'show', 'dspatch/run/run-par/work/v2/a:a.txt'), 'visit 2');
    assert.equal(git(repo, 'show', 'dspatch/run/run-par/work/v1/a:a.txt'), 'visit 1', 'the first visit\'s branch is kept as it was');
    assert.equal(result.usage.calls, 1 + 2 + 1 + 2 + 1 + 1);
    assert.equal(result.usage.reworkRounds, 1);
    assert.equal(git(repo, 'branch', '--show-current'), 'main');
    assert.equal(git(repo, 'status', '--porcelain'), '', 'nothing merged into the working copy by the engine');
  });

  it('runs a plan of one slice as one branch', async () => {
    const { repo, worktreesRoot } = repository('one');
    const seen = { received: {} as Record<string, string[]>, branches: [] as string[] };
    const result = await runLoopGraph(loaded(), {
      runId: 'run-one',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      fanOutDriver: createWorktreeDriver({ repo, worktreesRoot }),
      fanOutAdapterCap: 3,
      executor: scripted(['whole'], seen),
    });
    assert.equal(result.terminalNodeId, 'done', result.fault?.detail ?? '');
    assert.deepEqual(seen.branches, ['v1/whole']);
    assert.deepEqual(await listRunBranches(runGit, repo, 'run-one'), ['dspatch/run/run-one/work/v1/whole']);
  });
});
