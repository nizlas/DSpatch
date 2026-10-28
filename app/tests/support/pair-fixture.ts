/**
 * A workspace for reviewing a chosen revision pair (DSP-150): two Git repositories and a
 * folder without Git, side by side in one folder.
 *
 * `app` has two commits whose diff holds every kind of change the diff review must read
 * clearly: a modified file with an edit, an addition and a deletion; an added file; a
 * deleted file; a pure rename; a rename with a change; a binary file; a mode change. Its
 * working tree then says something else, so a review that read the checkout instead of
 * the commits would show the wrong text. `lib` has two commits and no walk. `notes` has
 * no Git at all.
 *
 * A walk definition over `app`'s pair is written beside it, for the walk window.
 *
 * Shared by `review-pairs.test.ts` and `scripts/seed-pair-kit.mjs`. Only node built-ins
 * and git: nothing here touches DSpatch's own data.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface PairFixture {
  /** The workspace folder: `app/`, `lib/`, `notes/` and `walks/`. */
  readonly workspace: string;
  readonly app: string;
  readonly lib: string;
  readonly notes: string;
  readonly appBase: string;
  readonly appTarget: string;
  readonly libBase: string;
  readonly libTarget: string;
  /** A walk definition over `app`'s base and target. */
  readonly walkDefinition: string;
}

/** The text the working tree of `app` holds for `src/keep.ts`; never in either commit. */
export const PAIR_WORKING_TREE_ONLY = 'WORKING TREE ONLY';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repository(folder: string): void {
  fs.mkdirSync(folder, { recursive: true });
  git(folder, 'init', '-q');
  git(folder, 'config', 'user.email', 'test@example.invalid');
  git(folder, 'config', 'user.name', 'Test Author');
  git(folder, 'config', 'core.autocrlf', 'false');
  git(folder, 'config', 'core.filemode', 'false');
}

function write(folder: string, file: string, text: string | Buffer): void {
  const full = path.join(folder, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function commit(folder: string, message: string): string {
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', message);
  return git(folder, 'rev-parse', 'HEAD');
}

const KEEP_BASE = Array.from({ length: 12 }, (_, index) => `export const v${String(index + 1)} = ${String(index + 1)};`).join('\n') + '\n';

const MOVED = 'export function moved(): number {\n  return 42;\n}\n';

const LONG_LINE =
  '// A long line of prose that wraps in the diff view: the review reads the change between two commits, ' +
  'never the working copy, and marks what a person decided about each changed line, one line at a time.';

const RENAMED_BASE =
  Array.from({ length: 10 }, (_, index) => `// line ${String(index + 1)}`).join('\n') + `\n${LONG_LINE}\n`;

export function makePairFixture(workspace: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-pair-'))): PairFixture {
  const app = path.join(workspace, 'app');
  const lib = path.join(workspace, 'lib');
  const notes = path.join(workspace, 'notes');

  repository(app);
  write(app, 'src/keep.ts', KEEP_BASE);
  write(app, 'src/old-name.ts', MOVED);
  write(app, 'src/before.ts', RENAMED_BASE);
  write(app, 'docs/gone.md', '# Gone\n\nThis file is removed.\n');
  write(app, 'assets/logo.bin', Buffer.from([0, 1, 2, 3, 0, 255, 254, 0]));
  write(app, 'tools/run.sh', 'echo run\n');
  const appBase = commit(app, 'Start the app');

  // Line 3 edited, two lines added after line 7, line 10 removed.
  const keep = KEEP_BASE.split('\n');
  keep[2] = 'export const v3 = 30;';
  keep.splice(7, 0, 'export const added1 = 1;', 'export const added2 = 2;');
  keep.splice(11, 1);
  write(app, 'src/keep.ts', keep.join('\n'));
  fs.renameSync(path.join(app, 'src/old-name.ts'), path.join(app, 'src/new-name.ts'));
  fs.rmSync(path.join(app, 'src/before.ts'));
  write(app, 'src/after.ts', RENAMED_BASE.replace('// line 5', '// line five').replace('one line at a time', 'one range at a time'));
  write(app, 'src/added.ts', 'export const fresh = true;\nexport const again = false;\n');
  fs.rmSync(path.join(app, 'docs/gone.md'));
  write(app, 'assets/logo.bin', Buffer.from([0, 9, 8, 7, 0, 1, 2, 0, 5]));
  git(app, 'add', '-A');
  git(app, 'update-index', '--chmod=+x', 'tools/run.sh');
  git(
    app,
    'commit',
    '-q',
    '-m',
    'Rework the app',
    '-m',
    'Edit keep.ts, rename two files and drop the old docs.\nThe logo changes and run.sh becomes executable.',
  );
  const appTarget = git(app, 'rev-parse', 'HEAD');
  write(app, 'src/keep.ts', `${PAIR_WORKING_TREE_ONLY}\n`);

  repository(lib);
  write(lib, 'index.ts', 'export const lib = 1;\n');
  const libBase = commit(lib, 'Begin the library');
  write(lib, 'index.ts', 'export const lib = 2;\n');
  const libTarget = commit(lib, 'Bump the library');

  fs.mkdirSync(notes, { recursive: true });
  write(notes, 'readme.txt', 'Not a repository.\n');

  const walkDefinition = path.join(workspace, 'walks', 'app.review.json');
  fs.mkdirSync(path.dirname(walkDefinition), { recursive: true });
  fs.writeFileSync(
    walkDefinition,
    `${JSON.stringify(
      {
        format: 'dspatch-review/1',
        title: 'The app rework',
        repository: '../app',
        base: appBase,
        target: appTarget,
        teachingMode: 'Concise',
        provenance: 'Written by tests/support/pair-fixture.ts for the diff review.',
        walks: [
          {
            id: 'W1',
            title: 'What changed in keep.ts',
            question: 'What did the rework change?',
            steps: [
              {
                id: 'W1.1',
                title: 'v3 becomes 30',
                text: 'The value of v3 changes.',
                refs: [{ path: 'src/keep.ts', side: 'target', start: 3, end: 3, role: 'walk', anchor: 'v3 = 30' }],
              },
              {
                id: 'W1.2',
                title: 'Two constants are added',
                text: 'Two new exports.',
                refs: [{ path: 'src/keep.ts', side: 'target', start: 8, end: 9, role: 'walk', anchor: 'added1' }],
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  return { workspace, app, lib, notes, appBase, appTarget, libBase, libTarget, walkDefinition };
}
