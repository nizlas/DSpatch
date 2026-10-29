/**
 * A repository for how the diff marks what changed (the Gerrit-style follow-up of DSP-150).
 *
 * `marks` has two commits whose diff holds the kinds of change the marks must tell apart:
 *
 * - `src/checkout.ts`: one character added (`3` → `30`); three removed lines replaced by
 *   one; a rewritten line; a removed function with nothing in its place; and a change of
 *   indentation only.
 * - `src/datasets.py`: one import line replaced by several (part of it survives), an added
 *   function with nothing in its place, and an added parameter.
 * - `docs/notes.md`: a long line of prose, which wraps in the window, with a few words
 *   changed in the middle.
 *
 * The content is invented for the check. Only node built-ins and git; nothing here touches
 * DSpatch's own data.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface MarksFixture {
  /** The workspace folder: `marks/`. */
  readonly workspace: string;
  readonly marks: string;
  readonly base: string;
  readonly target: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(folder: string, file: string, text: string): void {
  const full = path.join(folder, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

const lines = (...all: string[]): string => `${all.join('\n')}\n`;

const CHECKOUT_BASE = lines(
  'export const RATE = 3;',
  '',
  'export function total(amount: number): number {',
  '  const pending = load(amount);',
  '  pending.sort();',
  '  return pending;',
  '}',
  '',
  'export function label(value: number): string {',
  "  return 'Total: ' + value;",
  '}',
  '',
  'export function tidy(items: string[]): string[] {',
  "    return items.filter((item) => item !== '');",
  '}',
  '',
  '// Kept for callers that have not moved yet.',
  "export const legacy = (): void => console.log('legacy');",
);

const CHECKOUT_TARGET = lines(
  'export const RATE = 30;',
  '',
  'export function total(amount: number): number {',
  '  return sorted(load(amount));',
  '}',
  '',
  'export function label(value: number): string {',
  '  return `${value.toFixed(2)} in total`;',
  '}',
  '',
  'export function tidy(items: string[]): string[] {',
  "  return items.filter((item) => item !== '');",
  '}',
);

const DATASETS_BASE = lines(
  'from typing import List, Optional, Tuple',
  '',
  'from dataset.loader import ConfigList, load_configs',
  'from dataset.logging import get_logger',
  '',
  'logger = get_logger()',
  '',
  'DEFAULT_CONFIGS: ConfigList = [',
  '    ("configs/target-1.yml", 2, None),',
  ']',
  '',
  '',
  'def initialize_datasets(',
  '    tags: dict,',
  '    micro: bool = False,',
  '    cache: bool = True,',
  ') -> Tuple[List[str], Optional[str]]:',
  '    """Set up the test datasets."""',
  '    return load_configs(DEFAULT_CONFIGS, tags, micro=micro, cache=cache)',
);

const DATASETS_TARGET = lines(
  'import os',
  'import tempfile',
  'from typing import Any, Dict, List, Optional, Tuple',
  '',
  'import yaml',
  '',
  'from dataset.loader import ConfigList, load_configs',
  'from dataset.logging import get_logger',
  '',
  'logger = get_logger()',
  '',
  'DEFAULT_CONFIGS: ConfigList = [',
  '    ("configs/target-1.yml", 2, None),',
  ']',
  '',
  '',
  'def override_config(config_path: str, annotation: str) -> str:',
  '    """Write a copy of a dataset config that reads another annotation file."""',
  '    with open(config_path, "r", encoding="utf-8") as f:',
  '        config: Dict[str, Any] = yaml.safe_load(f)',
  '    config["data_patterns"] = [annotation]',
  '    path = os.path.join(tempfile.mkdtemp(prefix="override_"), os.path.basename(config_path))',
  '    with open(path, "w", encoding="utf-8") as f:',
  '        yaml.safe_dump(config, f)',
  '    return path',
  '',
  '',
  'def initialize_datasets(',
  '    tags: dict,',
  '    micro: bool = False,',
  '    cache: bool = True,',
  '    annotation: Optional[str] = None,',
  ') -> Tuple[List[str], Optional[str]]:',
  '    """Set up the test datasets."""',
  '    return load_configs(DEFAULT_CONFIGS, tags, micro=micro, cache=cache)',
);

const PROSE =
  'The review reads the change between two commits, never the working copy, so what is shown is what was committed; ' +
  'a person can mark each changed line as reviewed, ask an agent to explain a part of it, or hand a part to an agent ' +
  'to review, and every decision stays with the pair of commits it was made about.';

const NOTES_BASE = lines('# Notes', '', PROSE, '', 'Nothing else changes here.');
const NOTES_TARGET = lines(
  '# Notes',
  '',
  PROSE.replace('between two commits', 'between the two chosen commits').replace('hand a part to', 'delegate a part to'),
  '',
  'Nothing else changes here.',
);

export function makeMarksFixture(workspace: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-marks-'))): MarksFixture {
  const marks = path.join(workspace, 'marks');
  fs.mkdirSync(marks, { recursive: true });
  git(marks, 'init', '-q');
  git(marks, 'config', 'user.email', 'test@example.invalid');
  git(marks, 'config', 'user.name', 'Test Author');
  git(marks, 'config', 'core.autocrlf', 'false');
  write(marks, 'src/checkout.ts', CHECKOUT_BASE);
  write(marks, 'src/datasets.py', DATASETS_BASE);
  write(marks, 'docs/notes.md', NOTES_BASE);
  git(marks, 'add', '-A');
  git(marks, 'commit', '-q', '-m', 'Before');
  const base = git(marks, 'rev-parse', 'HEAD');
  write(marks, 'src/checkout.ts', CHECKOUT_TARGET);
  write(marks, 'src/datasets.py', DATASETS_TARGET);
  write(marks, 'docs/notes.md', NOTES_TARGET);
  git(marks, 'add', '-A');
  git(marks, 'commit', '-q', '-m', 'After');
  const target = git(marks, 'rev-parse', 'HEAD');
  return { workspace, marks, base, target };
}
