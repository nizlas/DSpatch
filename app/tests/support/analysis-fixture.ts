/**
 * A repository for DSP-152's analysis access: a change whose meaning lies outside the diff.
 *
 * `shop` has two commits. Between them `src/checkout.ts` changes `total()` to call
 * `findDiscount()`, imported from `src/pricing.ts`, which the change does not touch and
 * where the function is defined far from the top of the file (line {@link DEFINITION_LINE},
 * more than 25 lines from anything changed). `findDiscount` can return `null`, and the
 * changed line uses its result without a check: understanding or reviewing the change needs
 * the unchanged file. `README.md` also changes, as text with no code to follow.
 *
 * The working copy then says something else: `src/pricing.ts` is edited (uncommitted) so
 * that the function sits elsewhere and no longer returns null, an untracked file exists,
 * and the index holds a staged change. A reader that took the working copy for the
 * revisions would find the wrong code; one that changed the working copy would be caught by
 * {@link workingCopyState}.
 *
 * Only node built-ins and git; nothing here touches DSpatch's own data.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AnalysisFixture {
  /** The workspace folder: `shop/`. */
  readonly workspace: string;
  readonly shop: string;
  readonly base: string;
  readonly target: string;
}

/** Where `findDiscount` is defined in `src/pricing.ts` at both commits. */
export const DEFINITION_LINE = 61;

/** Text that is only in the working copy, never in a commit. */
export const WORKING_COPY_ONLY = 'WORKING COPY ONLY';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(folder: string, file: string, text: string): void {
  const full = path.join(folder, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

const PRICING =
  '/** Prices and discounts. */\n' +
  Array.from({ length: DEFINITION_LINE - 3 }, (_, index) => `export const RATE_${String(index + 1)} = ${String(index + 1)};`).join('\n') +
  '\n\n' +
  'export function findDiscount(code: string): { readonly percent: number } | null {\n' +
  "  if (code === 'WELCOME') {\n" +
  '    return { percent: 10 };\n' +
  '  }\n' +
  '  return null;\n' +
  '}\n';

const CHECKOUT_BASE =
  "import { RATE_1 } from './pricing';\n" +
  '\n' +
  'export function total(amount: number): number {\n' +
  '  return amount * RATE_1;\n' +
  '}\n';

const CHECKOUT_TARGET =
  "import { RATE_1, findDiscount } from './pricing';\n" +
  '\n' +
  'export function total(amount: number, code: string): number {\n' +
  '  const percent = findDiscount(code).percent;\n' +
  '  return amount * RATE_1 * (1 - percent / 100);\n' +
  '}\n';

export function makeAnalysisFixture(workspace: string = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-analysis-'))): AnalysisFixture {
  const shop = path.join(workspace, 'shop');
  fs.mkdirSync(shop, { recursive: true });
  git(shop, 'init', '-q');
  git(shop, 'config', 'user.email', 'test@example.invalid');
  git(shop, 'config', 'user.name', 'Test Author');
  git(shop, 'config', 'core.autocrlf', 'false');
  write(shop, 'src/pricing.ts', PRICING);
  write(shop, 'src/checkout.ts', CHECKOUT_BASE);
  write(shop, 'README.md', '# Shop\n\nTotals are computed in checkout.\n');
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'Checkout without discounts');
  const base = git(shop, 'rev-parse', 'HEAD');
  write(shop, 'src/checkout.ts', CHECKOUT_TARGET);
  write(shop, 'README.md', '# Shop\n\nTotals are computed in checkout, with a discount code.\n');
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'Apply discount codes at checkout');
  const target = git(shop, 'rev-parse', 'HEAD');
  // The working copy says something else, staged and unstaged.
  write(shop, 'src/pricing.ts', `// ${WORKING_COPY_ONLY}\nexport function findDiscount(): { readonly percent: number } {\n  return { percent: 0 };\n}\n`);
  write(shop, 'src/staged.ts', `export const staged = '${WORKING_COPY_ONLY}';\n`);
  git(shop, 'add', 'src/staged.ts');
  write(shop, 'notes.txt', `${WORKING_COPY_ONLY}: untracked\n`);
  return { workspace, shop, base, target };
}

/**
 * A fingerprint of everything a reader could change in the person's repository: HEAD and
 * branch, `git status`, the index, every working-copy file's bytes, and the list of
 * worktrees. Equal before and after means nothing there changed.
 */
export function workingCopyState(repository: string): string {
  const hash = createHash('sha256');
  hash.update(git(repository, 'rev-parse', 'HEAD'));
  hash.update(git(repository, 'symbolic-ref', '-q', 'HEAD'));
  hash.update(git(repository, 'status', '--porcelain=v2', '--untracked-files=all'));
  hash.update(git(repository, 'ls-files', '--stage'));
  hash.update(git(repository, 'worktree', 'list', '--porcelain'));
  const visit = (folder: string): void => {
    for (const name of fs.readdirSync(folder).sort()) {
      if (name === '.git') {
        continue;
      }
      const full = path.join(folder, name);
      if (fs.statSync(full).isDirectory()) {
        visit(full);
      } else {
        hash.update(path.relative(repository, full));
        hash.update(fs.readFileSync(full));
      }
    }
  };
  visit(repository);
  return hash.digest('hex');
}
