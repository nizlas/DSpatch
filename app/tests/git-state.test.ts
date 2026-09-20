/**
 * The pre-existing dirty state of a working copy.
 *
 * AC#6 requires that an existing manual change survives a run and stays
 * distinguishable from the run's changes. Everything downstream of that depends
 * on this reading being right, and the part that can silently be wrong is the
 * parsing: `git status -z` packs a rename into two NUL-terminated paths in a row,
 * and a parser that misses that shifts every following entry by one — attributing
 * a change to the wrong file, which is exactly the failure the criterion is
 * about.
 *
 * The second half of the file runs real `git` against a temporary repository, so
 * the claim is about git's actual output rather than about a fixture somebody
 * wrote to match the parser.
 *
 *     node --test tests/git-state.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { parsePorcelainZ, readGitWorkingCopyState } from '../src/main/git-state.ts';

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

function tempDir(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-git-${name}-`));
  roots.push(root);
  return root;
}

// --- The parser -------------------------------------------------------------

test('a rename consumes the following path and does not shift later entries', () => {
  const output = ['R  new-name.ts', 'old-name.ts', ' M src/kept.ts', '?? notes.txt', ''].join(
    '\0',
  );
  const files = parsePorcelainZ(output);
  assert.deepEqual(
    files.map((file) => [file.relPath, file.kind, file.previousRelPath, file.staged]),
    [
      ['new-name.ts', 'renamed', 'old-name.ts', true],
      ['src/kept.ts', 'modified', null, false],
      ['notes.txt', 'untracked', null, false],
    ],
  );
});

test('a parser that ignored the second path would invent a file', () => {
  // The negative control. `old-name.ts` is the rename's *source*, not a changed
  // file in its own right. Treating every NUL-separated chunk as an entry strips
  // its first three characters as if they were a status code and produces a file
  // called `-name.ts`, which exists nowhere. A user shown that has been told
  // their working copy contains a change it does not contain.
  const output = ['R  new-name.ts', 'old-name.ts', ' M src/kept.ts', ''].join('\0');
  const naive = output
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3));
  assert.deepEqual(naive, ['new-name.ts', '-name.ts', 'src/kept.ts']);

  const parsed = parsePorcelainZ(output);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.previousRelPath, 'old-name.ts');
  assert.equal(
    parsed.some((file) => file.relPath === '-name.ts'),
    false,
  );
});

test('paths with spaces and non-ASCII characters survive intact', () => {
  const files = parsePorcelainZ(['?? doc/en not\u00e4mnd fil.md', ''].join('\0'));
  assert.equal(files[0]?.relPath, 'doc/en not\u00e4mnd fil.md');
});

test('the index column decides whether a change is staged', () => {
  const files = parsePorcelainZ(
    ['M  staged.ts', ' M unstaged.ts', 'MM both.ts', 'A  added.ts', ' D gone.ts', ''].join('\0'),
  );
  assert.deepEqual(
    files.map((file) => [file.relPath, file.kind, file.staged]),
    [
      ['staged.ts', 'modified', true],
      ['unstaged.ts', 'modified', false],
      ['both.ts', 'modified', true],
      ['added.ts', 'added', true],
      ['gone.ts', 'deleted', false],
    ],
  );
});

test('an unmerged entry is reported as unmerged, not as modified', () => {
  const files = parsePorcelainZ(['UU conflict.ts', '', 'AA both-added.ts', ''].join('\0'));
  assert.deepEqual(
    files.map((file) => file.kind),
    ['unmerged', 'unmerged'],
  );
});

test('empty output is no dirty files', () => {
  assert.deepEqual(parsePorcelainZ(''), []);
  assert.deepEqual(parsePorcelainZ('\0'), []);
});

// --- Against real git -------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function makeRepo(name: string): string {
  const root = tempDir(name);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'DSpatch test');
  git(root, 'config', 'user.email', 'test@dspatch.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, 'kept.txt'), 'original\n');
  fs.writeFileSync(path.join(root, 'renamed-later.txt'), 'content\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  return root;
}

test('a clean repository reports its revision, its branch and nothing dirty', () => {
  const root = makeRepo('clean');
  const state = readGitWorkingCopyState(root);
  assert.equal(state.isGitRepository, true);
  assert.equal(state.error, null);
  assert.equal(state.branch, 'main');
  assert.match(String(state.headRevision), /^[0-9a-f]{40}$/);
  assert.deepEqual(state.dirtyFiles, []);
});

test('real pre-existing changes are recorded before anything else happens', () => {
  const root = makeRepo('dirty');
  fs.appendFileSync(path.join(root, 'kept.txt'), 'edited by hand\n');
  fs.writeFileSync(path.join(root, 'untracked note.txt'), 'mine\n');
  git(root, 'mv', 'renamed-later.txt', 'renamed-now.txt');

  const state = readGitWorkingCopyState(root);
  const byPath = new Map(state.dirtyFiles.map((file) => [file.relPath, file]));
  assert.equal(byPath.get('kept.txt')?.kind, 'modified');
  assert.equal(byPath.get('kept.txt')?.staged, false);
  assert.equal(byPath.get('untracked note.txt')?.kind, 'untracked');
  assert.equal(byPath.get('renamed-now.txt')?.kind, 'renamed');
  assert.equal(byPath.get('renamed-now.txt')?.previousRelPath, 'renamed-later.txt');
  assert.equal(state.dirtyFiles.length, 3);
});

test('a repository with no commit yet is a state, not a failure', () => {
  const root = tempDir('no-commit');
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'new.txt'), 'x\n');
  const state = readGitWorkingCopyState(root);
  assert.equal(state.isGitRepository, true);
  assert.equal(state.headRevision, null);
  assert.equal(state.error, null);
  assert.equal(state.dirtyFiles[0]?.kind, 'untracked');
});

test('a plain folder is reported as not a repository, not as clean', () => {
  const root = tempDir('plain');
  fs.writeFileSync(path.join(root, 'file.txt'), 'x\n');
  const state = readGitWorkingCopyState(root);
  assert.equal(state.isGitRepository, false);
  assert.equal(state.headRevision, null);
  // No dirty files *and* not a repository: the caller must not read the empty
  // list as "nothing was modified". The flag is what carries that.
  assert.deepEqual(state.dirtyFiles, []);
});
