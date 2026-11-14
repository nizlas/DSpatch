/**
 * DSP-209 S10a: the worktrees a fan-out's writing branches work in.
 *
 * GRAPH_FORMAT.md's *Fan-out*: one base commit for all branches, recorded before the first
 * starts; one worktree per branch, outside the working copy, on its own temporary branch
 * `dspatch/run/<runId>/<node>/v<visit>/<sliceId>`, in a short folder (S24); DSpatch commits what a branch left there when it ends; the
 * worktree is removed when the run ends and the branch is kept for the person and the
 * integrator. Mission decisions 6, 7 and 24.
 *
 * **Nothing here touches the person's work.** No call changes the working copy, the index,
 * the current branch or the stash list: the base is `git stash create`, which writes a commit
 * object and nothing else, and every other call either reads or acts inside a worktree this
 * module created. Every git call is an argument list, never a shell string, and has a timeout.
 * The git runner is passed in, so the rules can be tested on a repository the test made.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { FanOutDriver } from '../shared/loop-run';

export interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git <args>` in `cwd`. Argument arrays only; never a shell. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>;

const GIT_TIMEOUT_MS = 30_000;

/**
 * DSP-209 S24: every git call that checks out, reads or removes a worktree's files carries
 * `core.longpaths=true` for that one command. Git for Windows otherwise stops at Windows'
 * 260-character path limit: a fan-out on DSpatch's own repository failed with "Filename too
 * long" on long `backlog/tasks/` names and "Could not reset index file", and no branch
 * started. Set per command, never in the repository's or the person's git configuration;
 * git ignores it on other platforms.
 */
const LONG_PATHS = ['-c', 'core.longpaths=true'] as const;

/** The default runner: the `git` on the path, with a timeout, no shell, no window. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        resolve({ ok: error === null, stdout: String(stdout), stderr: String(stderr) || (error?.message ?? '') });
      },
    );
  });

export interface BaseCommit {
  readonly commit: string;
  /** `head` for a clean working copy; `stash-create` when it had uncommitted changes to tracked files. */
  readonly kind: 'head' | 'stash-create';
  /**
   * Untracked files in the working copy, which `git stash create` does not include, so the
   * branches will not see them. Counted so the run can say so; never added on DSpatch's own.
   */
  readonly untrackedNotIncluded: number;
}

/** The prefix of every temporary branch a run's fan-out makes. */
export function runBranchPrefix(runId: string): string {
  return `dspatch/run/${runId}/`;
}

/**
 * A node id as one segment of a branch name and a folder: letters, digits, `.`, `_` and `-`,
 * never starting with `.` or ending in `.lock` or `.`, which git refuses in a ref.
 */
function placeSegment(nodeId: string): string {
  const safe = nodeId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '').replace(/(\.lock|\.)+$/i, '');
  return safe === '' ? 'node' : safe;
}

/**
 * The folder name of one slice's worktree: `w` and ten hex digits of a SHA-256 over the run,
 * the node, the visit and the slice (DSP-209 S24).
 *
 * Short on purpose. The worktree's files sit under this folder, and the path the person's
 * shell, editor and the branch agent's own tools see is the folder's path plus the file's;
 * the old `<runId>/worktrees/<node>/v<visit>/<slice>` layout alone was 110 characters, which
 * with a 183-character tracked path passed Windows' 260. The name is deterministic, so the
 * same slice of the same visit always has the same folder, and an owner file beside it
 * ({@link WORKTREE_OWNER_FORMAT}) and the branch name say whose it is.
 */
export function worktreeDirName(runId: string, nodeId: string, visit: number, sliceId: string): string {
  const digest = createHash('sha256').update([runId, nodeId, String(visit), sliceId].join('\u0000')).digest('hex');
  return `w${digest.slice(0, 10)}`;
}

/**
 * Where a run's worktrees go (DSP-209 S24). On Windows, `%LOCALAPPDATA%\DSpatch\wt`: local
 * to the machine (a worktree must not roam with a profile) and short, so a worktree's own
 * path stays far below the limit. Elsewhere, and where `LOCALAPPDATA` is not set, the old
 * place beside the run's results. Every run shares the root; the folder names keep them apart.
 */
export function fanOutWorktreesRoot(input: {
  readonly platform: NodeJS.Platform;
  readonly localAppData: string | undefined;
  readonly runDir: string;
}): string {
  if (input.platform === 'win32' && input.localAppData !== undefined && input.localAppData !== '') {
    return path.join(input.localAppData, 'DSpatch', 'wt');
  }
  return path.join(input.runDir, 'worktrees');
}

/** The `format` of the owner file written beside each worktree folder, as `<folder>.json`. */
export const WORKTREE_OWNER_FORMAT = 'dspatch-worktree-owner';

/** The owner file of a worktree folder: `<folder>.json`, beside it, never inside it. */
export function worktreeOwnerFile(worktreePath: string): string {
  return `${worktreePath}.json`;
}

/**
 * A slice's temporary branch: `dspatch/run/<runId>/<node>/v<visit>/<slice>`.
 *
 * DSP-209 S10c (S10b review defect): the node and its visit are in the name, so a second visit
 * to a fan-out node — a rework edge back to it — makes new branches beside the first visit's,
 * which are kept, and two fan-out nodes in one run with the same slice ids stay apart. Every
 * branch of a run has the same depth, so no branch name is ever a prefix of another (which git
 * refuses).
 */
export function sliceBranch(runId: string, nodeId: string, visit: number, sliceId: string): string {
  return `${runBranchPrefix(runId)}${placeSegment(nodeId)}/v${String(visit)}/${sliceId}`;
}

/**
 * The base every branch of a fan-out starts from: HEAD when the working copy has no
 * uncommitted changes to tracked files, otherwise the commit `git stash create` writes,
 * which holds those changes without touching the working copy, the index or the stash list.
 */
export async function baseCommit(git: GitRunner, repo: string): Promise<BaseCommit> {
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all'], repo);
  if (!status.ok) {
    throw new Error(`git could not read the working copy's state, so no base was recorded: ${status.stderr.trim()}`);
  }
  const untrackedNotIncluded = status.stdout.split('\n').filter((line) => line.startsWith('??')).length;
  const stash = await git(['stash', 'create'], repo);
  if (!stash.ok) {
    throw new Error(`git stash create failed, so no base was recorded: ${stash.stderr.trim()}`);
  }
  const created = stash.stdout.trim();
  if (created !== '') {
    return { commit: created, kind: 'stash-create', untrackedNotIncluded };
  }
  const head = await git(['rev-parse', '--verify', 'HEAD^{commit}'], repo);
  if (!head.ok || head.stdout.trim() === '') {
    throw new Error(`The repository has no commit for HEAD, so there is no base to branch from: ${head.stderr.trim()}`);
  }
  return { commit: head.stdout.trim(), kind: 'head', untrackedNotIncluded };
}

export interface RunWorktree {
  readonly sliceId: string;
  readonly path: string;
  readonly branch: string;
  readonly base: string;
}

/**
 * A worktree for one slice, at `<worktreesRoot>/<worktreeDirName>` on a new branch from
 * `base`, named by {@link sliceBranch}, with an owner file beside it naming the run, node,
 * visit, slice and branch.
 *
 * `worktreesRoot` comes from {@link fanOutWorktreesRoot}; it must lie outside the
 * repository, and the call refuses otherwise rather than writing into the person's folder.
 * Refuses an existing branch of that name rather than reusing it, and an existing folder.
 */
export async function createWorktree(
  git: GitRunner,
  input: {
    readonly repo: string;
    readonly base: string;
    readonly runId: string;
    readonly nodeId: string;
    readonly visit: number;
    readonly sliceId: string;
    readonly worktreesRoot: string;
  },
): Promise<RunWorktree> {
  const target = path.resolve(input.worktreesRoot, worktreeDirName(input.runId, input.nodeId, input.visit, input.sliceId));
  const relative = path.relative(path.resolve(input.repo), target);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error(`The worktree for slice "${input.sliceId}" would be inside the working copy (${target}); it was not made.`);
  }
  const branch = sliceBranch(input.runId, input.nodeId, input.visit, input.sliceId);
  const format = await git(['check-ref-format', '--branch', branch], input.repo);
  if (!format.ok) {
    throw new Error(`"${branch}" is not a usable branch name, so no worktree was made: ${format.stderr.trim()}`);
  }
  if (fs.existsSync(target)) {
    throw new Error(`The worktree folder for slice "${input.sliceId}" already exists (${target}); it was not reused.`);
  }
  const added = await git([...LONG_PATHS, 'worktree', 'add', '-b', branch, target, input.base], input.repo);
  if (!added.ok) {
    throw new Error(`git could not make the worktree for slice "${input.sliceId}" at ${target}: ${added.stderr.trim()}`);
  }
  // The owner file is a convenience for a person who finds the folder; the branch name and
  // the run journal say the same, so a failure to write it does not fail the slice.
  try {
    fs.writeFileSync(
      worktreeOwnerFile(target),
      `${JSON.stringify({ format: WORKTREE_OWNER_FORMAT, runId: input.runId, nodeId: input.nodeId, visit: input.visit, sliceId: input.sliceId, branch, base: input.base, repo: path.resolve(input.repo) }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // See above.
  }
  return { sliceId: input.sliceId, path: target, branch, base: input.base };
}

/**
 * Commit whatever the branch left uncommitted in its worktree, on its temporary branch.
 * Returns the new commit, or `null` when nothing had changed. Only inside the worktree.
 * The commit is DSpatch's, so it is made under DSpatch's name; hooks and signing are the
 * repository's own and are not bypassed.
 */
export async function commitLeftovers(git: GitRunner, worktree: string, message: string): Promise<string | null> {
  const added = await git([...LONG_PATHS, 'add', '--all'], worktree);
  if (!added.ok) {
    throw new Error(`git could not stage the branch's work in ${worktree}: ${added.stderr.trim()}`);
  }
  const staged = await git([...LONG_PATHS, 'diff', '--cached', '--name-only'], worktree);
  if (!staged.ok) {
    throw new Error(`git could not read what the branch changed in ${worktree}: ${staged.stderr.trim()}`);
  }
  if (staged.stdout.trim() === '') {
    return null;
  }
  const committed = await git(
    [...LONG_PATHS, '-c', 'user.name=DSpatch', '-c', 'user.email=dspatch@localhost', 'commit', '--quiet', '-m', message],
    worktree,
  );
  if (!committed.ok) {
    throw new Error(`git could not commit the branch's work in ${worktree}: ${committed.stderr.trim()}`);
  }
  const head = await git(['rev-parse', 'HEAD'], worktree);
  return head.ok ? head.stdout.trim() : null;
}

/**
 * Remove a run's worktree: its folder and git's registration of it. **The branch is kept**;
 * nothing here deletes a branch. Anything left uncommitted in the worktree goes with it, so
 * the caller commits leftovers first.
 */
export async function removeWorktree(git: GitRunner, repo: string, worktree: string): Promise<void> {
  const removed = await git([...LONG_PATHS, 'worktree', 'remove', '--force', worktree], repo);
  if (!removed.ok) {
    throw new Error(`git could not remove the worktree ${worktree}: ${removed.stderr.trim()}`);
  }
  fs.rmSync(worktreeOwnerFile(worktree), { force: true });
}

/**
 * DSP-209 S10b: the fan-out driver the runner is handed for a run over `repo`, with its
 * worktrees under `worktreesRoot` ({@link fanOutWorktreesRoot}).
 *
 * `close` commits leftovers **before** removing the worktree (S10a review finding iv). When
 * the commit is refused — a signing requirement, a hook, the repository's author policy — the
 * worktree is kept, not removed, and the refusal is returned in git's own words, so the work
 * stays where the person can find it (findings i and ii). The branch is never deleted.
 */
export function createWorktreeDriver(input: {
  readonly git?: GitRunner;
  readonly repo: string;
  readonly worktreesRoot: string;
}): FanOutDriver {
  const git = input.git ?? runGit;
  return {
    base: () => baseCommit(git, input.repo),
    open: async ({ runId, nodeId, visit, sliceId, base }) => {
      const tree = await createWorktree(git, { repo: input.repo, base, runId, nodeId, visit, sliceId, worktreesRoot: input.worktreesRoot });
      return { workspacePath: tree.path, branch: tree.branch };
    },
    close: async ({ workspacePath, message }) => {
      let commit: string | null;
      try {
        commit = await commitLeftovers(git, workspacePath, message);
      } catch (error) {
        return {
          commit: null,
          removed: false,
          problem:
            `The branch's work could not be committed, so its worktree was kept with the work in it: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        };
      }
      try {
        await removeWorktree(git, input.repo, workspacePath);
        return { commit, removed: true, problem: null };
      } catch (error) {
        return {
          commit,
          removed: false,
          problem: `The worktree could not be removed and is kept: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

/** The run's temporary branches, by name, sorted. */
export async function listRunBranches(git: GitRunner, repo: string, runId: string): Promise<readonly string[]> {
  const listed = await git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${runBranchPrefix(runId)}`], repo);
  if (!listed.ok) {
    throw new Error(`git could not list the run's branches: ${listed.stderr.trim()}`);
  }
  return listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .sort();
}
