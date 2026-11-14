/**
 * DSP-209 S10a: the worktrees a fan-out's writing branches work in, on a real git repository
 * this test makes in a temporary folder and removes afterwards.
 *
 * What matters to a person is the second test: recording the base never changes their working
 * copy, index, current branch or stash list.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  baseCommit,
  commitLeftovers,
  createWorktree,
  listRunBranches,
  removeWorktree,
  runGit,
  sliceBranch,
} from '../src/main/run-worktrees';

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

/** A repository with one commit, and a separate folder standing in for `<userData>/loop-runs/<runId>/worktrees`. */
function repository(name: string): { readonly repo: string; readonly worktreesRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-worktrees-${name}-`));
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
  return { repo, worktreesRoot: path.join(root, 'userdata', 'loop-runs', 'run-1', 'worktrees') };
}

describe('run worktrees (DSP-209 S10a)', () => {
  it('bases a clean working copy on HEAD', async () => {
    const { repo } = repository('clean');
    const base = await baseCommit(runGit, repo);
    assert.equal(base.kind, 'head');
    assert.equal(base.commit, git(repo, 'rev-parse', 'HEAD'));
    assert.equal(base.untrackedNotIncluded, 0);
  });

  it('bases uncommitted work on a stash-create commit, and leaves status, stash list and branch as they were', async () => {
    const { repo } = repository('dirty');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo, not committed\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'untracked\n', 'utf8');
    const before = { status: git(repo, 'status', '--porcelain'), stash: git(repo, 'stash', 'list'), branch: git(repo, 'branch', '--show-current'), head: git(repo, 'rev-parse', 'HEAD') };
    const base = await baseCommit(runGit, repo);
    assert.equal(base.kind, 'stash-create');
    assert.notEqual(base.commit, before.head);
    assert.equal(base.untrackedNotIncluded, 1, 'untracked files are counted, not included');
    assert.deepEqual(
      { status: git(repo, 'status', '--porcelain'), stash: git(repo, 'stash', 'list'), branch: git(repo, 'branch', '--show-current'), head: git(repo, 'rev-parse', 'HEAD') },
      before,
    );
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\ntwo, not committed\n');
    // The base holds the uncommitted change.
    assert.equal(git(repo, 'show', `${base.commit}:a.txt`), 'one\ntwo, not committed');
  });

  it('makes a worktree outside the repository on its own branch, commits leftovers, removes it and keeps the branch', async () => {
    const { repo, worktreesRoot } = repository('lifecycle');
    const base = await baseCommit(runGit, repo);
    const tree = await createWorktree(runGit, { repo, base: base.commit, runId: 'run-1', nodeId: 'work', visit: 1, sliceId: 'frontend', worktreesRoot });
    assert.equal(tree.branch, sliceBranch('run-1', 'work', 1, 'frontend'));
    assert.equal(tree.branch, 'dspatch/run/run-1/work/v1/frontend');
    assert.ok(path.relative(repo, tree.path).startsWith('..'), 'outside the working copy');
    assert.equal(git(tree.path, 'branch', '--show-current'), 'dspatch/run/run-1/work/v1/frontend');
    assert.equal(git(repo, 'branch', '--show-current'), 'main', 'the person\'s branch is unchanged');

    assert.equal(await commitLeftovers(runGit, tree.path, 'nothing yet'), null, 'nothing changed, no commit');
    fs.writeFileSync(path.join(tree.path, 'b.txt'), 'from the branch\n', 'utf8');
    const commit = await commitLeftovers(runGit, tree.path, 'DSpatch run run-1, slice frontend, visit 1');
    assert.ok(commit !== null);
    assert.equal(git(repo, 'rev-parse', 'dspatch/run/run-1/work/v1/frontend'), commit);
    assert.equal(fs.existsSync(path.join(repo, 'b.txt')), false, 'the working copy is not touched');

    const other = await createWorktree(runGit, { repo, base: base.commit, runId: 'run-1', nodeId: 'work', visit: 1, sliceId: 'tools', worktreesRoot });
    assert.deepEqual(await listRunBranches(runGit, repo, 'run-1'), ['dspatch/run/run-1/work/v1/frontend', 'dspatch/run/run-1/work/v1/tools']);
    assert.deepEqual(await listRunBranches(runGit, repo, 'run-2'), []);

    await removeWorktree(runGit, repo, tree.path);
    await removeWorktree(runGit, repo, other.path);
    assert.equal(fs.existsSync(tree.path), false);
    assert.equal(git(repo, 'worktree', 'list', '--porcelain').includes(tree.path.split(path.sep).join('/')), false);
    assert.deepEqual(await listRunBranches(runGit, repo, 'run-1'), ['dspatch/run/run-1/work/v1/frontend', 'dspatch/run/run-1/work/v1/tools'], 'branches are kept');
    assert.equal(git(repo, 'status', '--porcelain'), '');
  });

  // DSP-209 S10c (S10b review defect): a rework edge back to the fan-out node is its second visit.
  it('gives a second visit to the same node, with the same slice ids, new branches, and keeps the first visit\'s', async () => {
    const { repo, worktreesRoot } = repository('second-visit');
    const base = await baseCommit(runGit, repo);
    const first = await createWorktree(runGit, { repo, base: base.commit, runId: 'run-1', nodeId: 'work', visit: 1, sliceId: 'a', worktreesRoot });
    fs.writeFileSync(path.join(first.path, 'a.txt'), 'first visit\n', 'utf8');
    const firstCommit = await commitLeftovers(runGit, first.path, 'visit 1');
    await removeWorktree(runGit, repo, first.path);

    const second = await createWorktree(runGit, { repo, base: base.commit, runId: 'run-1', nodeId: 'work', visit: 2, sliceId: 'a', worktreesRoot });
    assert.equal(second.branch, 'dspatch/run/run-1/work/v2/a');
    assert.notEqual(second.path, first.path);
    // Another fan-out node in the same run, with the same slice id, stays apart too.
    const other = await createWorktree(runGit, { repo, base: base.commit, runId: 'run-1', nodeId: 'research', visit: 1, sliceId: 'a', worktreesRoot });
    assert.deepEqual(await listRunBranches(runGit, repo, 'run-1'), [
      'dspatch/run/run-1/research/v1/a',
      'dspatch/run/run-1/work/v1/a',
      'dspatch/run/run-1/work/v2/a',
    ]);
    assert.equal(git(repo, 'rev-parse', 'dspatch/run/run-1/work/v1/a'), firstCommit, 'the first visit\'s branch is kept as it was');
    await removeWorktree(runGit, repo, second.path);
    await removeWorktree(runGit, repo, other.path);
  });

  it('refuses a worktree inside the working copy, and a branch name git would not accept', async () => {
    const { repo } = repository('refusals');
    const base = await baseCommit(runGit, repo);
    await assert.rejects(
      createWorktree(runGit, { repo, base: base.commit, runId: 'run-1', nodeId: 'work', visit: 1, sliceId: 'x', worktreesRoot: path.join(repo, 'inside') }),
      /would be inside the working copy/,
    );
    await assert.rejects(
      createWorktree(runGit, { repo, base: base.commit, runId: 'run 1', nodeId: 'work', visit: 1, sliceId: 'x..y', worktreesRoot: path.join(path.dirname(repo), 'w') }),
      /not a usable branch name/,
    );
  });
});
