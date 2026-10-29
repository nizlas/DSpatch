/**
 * A repository for asking about code the walk does not show (Niclas's decision of 30
 * October 2026), as in his trial question about a type defined elsewhere.
 *
 * `insight` has two commits. `src/save.ts` starts saving an `EditorWorkspace`, a type
 * defined in `src/workspace.ts`, which the same change widens: the type has one field at
 * From and three at To, so the two revisions answer "what is it?" differently. `src/load.ts`
 * changes too, and is the file a simulated preparation leaves out of its walks. `save.ts`
 * ends with a line long enough to wrap, for selecting across a wrap. Nothing
 * defines `UndoJournal`: a question about it has no definition to find.
 *
 * The content is invented for the check. Only node built-ins and git.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface InsightFixture {
  readonly workspace: string;
  readonly insight: string;
  readonly base: string;
  readonly target: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(folder: string, file: string, lines: readonly string[]): void {
  const full = path.join(folder, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${lines.join('\n')}\n`);
}

export function makeInsightFixture(workspace: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-insight-'))): InsightFixture {
  const insight = path.join(workspace, 'insight');
  fs.mkdirSync(insight, { recursive: true });
  git(insight, 'init', '-q');
  git(insight, 'config', 'user.email', 'test@example.invalid');
  git(insight, 'config', 'user.name', 'Test Author');
  git(insight, 'config', 'core.autocrlf', 'false');
  write(insight, 'src/workspace.ts', [
    '/** What the editor remembers about a project. */',
    'export interface EditorWorkspace {',
    '  zoom: number;',
    '}',
  ]);
  write(insight, 'src/save.ts', [
    "import type { EditorWorkspace } from './workspace';",
    '',
    'export function saveProject(name: string): string {',
    '  return `project ${name}`;',
    '}',
  ]);
  write(insight, 'src/load.ts', ['export function loadProject(text: string): string {', '  return text.slice(8);', '}']);
  git(insight, 'add', '-A');
  git(insight, 'commit', '-q', '-m', 'Save and load projects');
  const base = git(insight, 'rev-parse', 'HEAD');
  write(insight, 'src/workspace.ts', [
    '/** What the editor remembers about a project. */',
    'export interface EditorWorkspace {',
    '  zoom: number;',
    '  scroll: number;',
    '  lane: string;',
    '}',
  ]);
  write(insight, 'src/save.ts', [
    "import type { EditorWorkspace } from './workspace';",
    '',
    'export function saveProject(name: string, workspace: EditorWorkspace | null): string {',
    '  const saved = workspace === null ? "" : ` ${JSON.stringify(workspace)}`;',
    '  return `project ${name}${saved}`;',
    '}',
    '',
    `export const SAVE_NOTE = '${'The workspace is saved with the project only when the editor is open, so that a closed editor never reopens by itself on load; '.repeat(2).trim()}';`,
  ]);
  write(insight, 'src/load.ts', [
    'export function loadProject(text: string): string {',
    "  const end = text.indexOf(' {');",
    '  return end < 0 ? text.slice(8) : text.slice(8, end);',
    '}',
  ]);
  git(insight, 'add', '-A');
  git(insight, 'commit', '-q', '-m', 'Remember the editor workspace with the project');
  const target = git(insight, 'rev-parse', 'HEAD');
  return { workspace, insight, base, target };
}
