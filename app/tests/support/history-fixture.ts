/**
 * A repository whose history decides From and To (Niclas's decision after his trial,
 * 29 October 2026): which commit came first is Git's ancestry, never a date or the order
 * of the log.
 *
 * `history`:
 *
 *     root ── ahead ── merge   (main)
 *        └─── side ────┘       (side, merged into main)
 *
 * The dates mislead on purpose: `ahead` is dated years before its parent `root`, and
 * `side` after everything. `ahead` and `side` are on separate branches, so neither is an
 * ancestor of the other. The merge puts both in the current branch's log.
 *
 * The content is invented for the check. Only node built-ins and git.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface HistoryFixture {
  readonly workspace: string;
  readonly history: string;
  readonly root: string;
  readonly ahead: string;
  readonly side: string;
  readonly merge: string;
}

function git(cwd: string, date: string | null, ...args: string[]): string {
  const env = date === null ? process.env : { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

function commit(folder: string, file: string, text: string, message: string, date: string): string {
  fs.writeFileSync(path.join(folder, file), text);
  git(folder, null, 'add', '-A');
  git(folder, date, 'commit', '-q', '-m', message);
  return git(folder, null, 'rev-parse', 'HEAD');
}

export function makeHistoryFixture(workspace: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-history-'))): HistoryFixture {
  const history = path.join(workspace, 'history');
  fs.mkdirSync(history, { recursive: true });
  git(history, null, 'init', '-q', '-b', 'main');
  git(history, null, 'config', 'user.email', 'test@example.invalid');
  git(history, null, 'config', 'user.name', 'Test Author');
  git(history, null, 'config', 'core.autocrlf', 'false');
  const root = commit(history, 'notes.txt', 'one\n', 'Start the notes', '2020-06-01T12:00:00Z');
  const ahead = commit(history, 'notes.txt', 'one\ntwo\n', 'Add a second note (dated before its parent)', '2001-01-01T12:00:00Z');
  git(history, null, 'checkout', '-q', '-b', 'side', root);
  const side = commit(history, 'other.txt', 'side\n', 'Add a note on a branch (dated last)', '2030-01-01T12:00:00Z');
  git(history, null, 'checkout', '-q', 'main');
  git(history, '2002-01-01T12:00:00Z', 'merge', '-q', '--no-ff', '-m', 'Merge the branch', 'side');
  const merge = git(history, null, 'rev-parse', 'HEAD');
  return { workspace, history, root, ahead, side, merge };
}
