/**
 * A real git repository for the review surface: two commits, and a working tree that
 * says something else, so a review that read the checkout instead of the commits
 * would show the wrong text.
 *
 * Shared by `review-service.test.ts` and by `scripts/seed-review-kit.mjs`, which
 * builds the kit the `review-window` scenario runs over. One fixture, so the window
 * scenario and the service tests are about the same repository.
 *
 * Only node built-ins and git: nothing here touches DSpatch's own data.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ReviewFixture {
  /** The folder holding everything: `repo/`, the definition and `records/`. */
  readonly root: string;
  readonly repo: string;
  /** A records folder for a `ReviewService` in a test. Not created here. */
  readonly records: string;
  /** `change.review.json` beside `repo/`, naming the repository as `repo`. */
  readonly definitionPath: string;
  readonly base: string;
  readonly target: string;
}

/** The text the working tree holds for `src/keep.ts`; never in either commit. */
export const WORKING_TREE_ONLY = 'WORKING TREE ONLY';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** For a second repository beside the first: another folder name and other commits. */
export interface ReviewFixtureOptions {
  /** The repository's folder name under `root`; `repo` by default. */
  readonly repoName?: string;
  /** Written into the base commit, so two fixtures do not share commit ids. */
  readonly variant?: string;
}

/**
 * Build the repository and its definition under `root`, or under a new temporary
 * folder when `root` is omitted. The caller removes it.
 */
export function makeReviewFixture(
  root: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-review-')),
  options: ReviewFixtureOptions = {},
): ReviewFixture {
  const repoName = options.repoName ?? 'repo';
  const repo = path.join(root, repoName);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'src', 'keep.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  fs.writeFileSync(path.join(repo, 'src', 'gone.ts'), 'old\n');
  fs.writeFileSync(path.join(repo, 'src', 'untouched.ts'), 'export const needle = 42;\n');
  if (options.variant !== undefined) {
    fs.writeFileSync(path.join(repo, 'variant.txt'), `${options.variant}\n`);
  }
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base commit');
  const base = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'src', 'keep.ts'), 'export const a = 1;\nexport const b = 20;\nexport const c = 3;\nexport const d = 4;\n');
  fs.rmSync(path.join(repo, 'src', 'gone.ts'));
  fs.writeFileSync(path.join(repo, 'src', 'new file.ts'), 'export const n = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'target commit');
  const target = git(repo, 'rev-parse', 'HEAD');
  // The working tree now disagrees with both commits; the review must not read it.
  fs.writeFileSync(path.join(repo, 'src', 'keep.ts'), `${WORKING_TREE_ONLY}\n`);

  const definitionPath = path.join(root, 'change.review.json');
  fs.writeFileSync(
    definitionPath,
    JSON.stringify({
      format: 'dspatch-review/1',
      title: 'fixture',
      repository: repoName,
      base: base.slice(0, 7),
      target: target.slice(0, 7),
      teachingMode: 'Concise',
      provenance: 'test',
      walks: [
        {
          id: 'W1',
          title: 'w',
          question: 'q',
          steps: [
            {
              id: 'W1.1',
              title: 'b changes',
              text: 't',
              refs: [
                { path: 'src/keep.ts', side: 'target', start: 2, end: 4, role: 'walk', anchor: 'b = 20' },
                { path: 'src/gone.ts', side: 'base', start: 1, end: 1, role: 'walk', anchor: 'old' },
                { path: 'src/keep.ts', side: 'target', start: 1, end: 1, role: 'walk', anchor: 'not there' },
                { path: 'src/missing.ts', side: 'target', start: 1, end: 1, role: 'context' },
              ],
            },
          ],
        },
      ],
    }),
  );
  return { root, repo, records: path.join(root, 'records'), definitionPath, base, target };
}

/**
 * A second definition over the same repository with three valid steps, for a window
 * that has to move between steps. Written beside the first; returns its path.
 */
export function writeWalkDefinition(fixture: ReviewFixture, fileName = 'walk.review.json'): string {
  const file = path.join(fixture.root, fileName);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        format: 'dspatch-review/1',
        title: 'Fixture walk',
        repository: path.basename(fixture.repo),
        base: fixture.base,
        target: fixture.target,
        teachingMode: 'Concise',
        provenance: 'Written by tests/support/review-fixture.ts for the review-window scenario.',
        walks: [
          {
            id: 'W1',
            title: 'What changed',
            question: 'What did the target commit change?',
            steps: [
              {
                id: 'W1.1',
                title: 'b becomes 20',
                text: 'The value of b changes.',
                refs: [{ path: 'src/keep.ts', side: 'target', start: 2, end: 2, role: 'walk', anchor: 'b = 20' }],
              },
              {
                id: 'W1.2',
                title: 'd is added',
                text: 'A new export.',
                refs: [{ path: 'src/keep.ts', side: 'target', start: 4, end: 4, role: 'walk', anchor: 'd = 4' }],
              },
              {
                id: 'W1.3',
                title: 'gone.ts is removed',
                text: 'The old file goes.',
                refs: [{ path: 'src/gone.ts', side: 'base', start: 1, end: 1, role: 'walk', anchor: 'old' }],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
  return file;
}
