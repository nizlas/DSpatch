/**
 * Generate the provider files from the role sources: `npm run roles:generate`.
 *
 * The sources live in `docs/loop/roles/`; the target decides what comes out of them.
 * Cursor and Claude Code are implemented (Claude Code since DSP-107, for the external
 * development loop only). Without `--target`, each role is generated for every
 * implemented target it declares; asking for Copilot says why it is refused rather than
 * producing something.
 *
 * **It writes nothing unless told to.** The default is a comparison: generate in
 * memory, compare against what is on disk, print the difference and exit non-zero if
 * there is one. That default exists because of what this script replaces — the five
 * files in `.cursor/agents/` are the definitions of the agents that run this project's
 * development loop, and a call dispatched while they were mid-rewrite would get
 * whatever happened to be on disk. Staging first and letting a person read the diff is
 * not caution about tooling; it is the only safe order.
 *
 * Examples, from `app`:
 *
 *   npm run roles:generate
 *   npm run roles:generate -- --out ../.dspatch-loop/staged --write
 *   npm run roles:generate -- --role dspatch-researcher
 *   npm run roles:generate -- --target claude-code
 *   npm run roles:generate -- --target copilot
 *
 * `--out` is a *root*, not a directory of files: each target says where inside a project
 * its files belong, so `--out ../staged` produces `../staged/.cursor/agents/*.md` and the
 * staged tree can be compared with the real one path for path. `--flat` drops the
 * subdirectories and writes the files straight into `--out`, which is what you want when
 * staging *inside* this repository: a second `.cursor/agents/` under a run's log directory
 * is a directory Cursor might one day read, and two definitions of the same agent on one
 * machine is the confusion staging exists to prevent.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LOOP_TARGETS } from '../src/shared/loop-graph';
import {
  EMITTED_TARGETS,
  formatNotices,
  generateRoleFile,
  inspectGeneratedFile,
  writeDecision,
} from '../src/main/role-generate';
import { formatRoleSourceProblems, parseRoleSource } from '../src/main/role-source';
import { buildUnifiedDiff } from '../src/main/text-diff';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceDir = path.join(repoRoot, 'docs', 'loop', 'roles');

/**
 * @param {readonly string[]} argv
 * @returns {{ target: string | null, out: string, compare: string, write: boolean, force: boolean, flat: boolean, role: string | null, help: boolean }}
 */
function parseArgs(argv) {
  /** @type {string | null} */
  let target = null;
  let out = repoRoot;
  let compare = repoRoot;
  let write = false;
  let force = false;
  let flat = false;
  /** @type {string | null} */
  let role = null;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--target':
        target = next ?? '';
        index += 1;
        break;
      case '--out':
        out = path.resolve(process.cwd(), next ?? '.');
        index += 1;
        break;
      case '--compare':
        compare = path.resolve(process.cwd(), next ?? '.');
        index += 1;
        break;
      case '--role':
        role = next ?? '';
        index += 1;
        break;
      case '--write':
        write = true;
        break;
      case '--force':
        force = true;
        break;
      case '--flat':
        flat = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        process.stderr.write(`unknown argument: ${String(arg)}\n`);
        process.exit(2);
    }
  }
  return { target, out, compare, write, force, flat, role, help };
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(
    'generate-roles [--target <target>] [--out <root>] [--compare <root>] [--role <id>]\n' +
      '               [--write] [--force] [--flat]\n' +
      '\n' +
      `  Without --target, every implemented target (${EMITTED_TARGETS.join(', ')}) a role declares.\n` +
      '  Writes nothing without --write. --force is only for replacing a file that has no\n' +
      '  provenance header; a hand-edited generated file is never overwritten. --flat stages\n' +
      '  the files directly in --out instead of under the target\u2019s own subdirectories.\n',
  );
  process.exit(0);
}
if (options.target !== null && !(/** @type {readonly string[]} */ (LOOP_TARGETS)).includes(options.target)) {
  process.stderr.write(`unknown target ${options.target}; known: ${LOOP_TARGETS.join(', ')}\n`);
  process.exit(2);
}

if (options.flat && options.target === null) {
  process.stderr.write('--flat needs --target: the targets share file names, so one flat directory cannot hold them all\n');
  process.exit(2);
}

const sourceFiles = fs
  .readdirSync(sourceDir)
  .filter((name) => name.endsWith('.role.md'))
  .filter((name) => options.role === null || name === `${options.role}.role.md`)
  .sort();

if (sourceFiles.length === 0) {
  process.stderr.write(`no role sources in ${sourceDir}\n`);
  process.exit(2);
}

let failed = 0;
let differing = 0;
let written = 0;
let refused = 0;

for (const name of sourceFiles) {
  const absolute = path.join(sourceDir, name);
  const relativeSource = path.relative(repoRoot, absolute).split(path.sep).join('/');

  const parsed = parseRoleSource(fs.readFileSync(absolute, 'utf8'));
  if (!parsed.ok) {
    process.stdout.write(`\n${relativeSource}\n  ERROR not a valid role source:\n${formatRoleSourceProblems(parsed.problems)}\n`);
    failed += 1;
    continue;
  }

  // An explicit --target is honoured even when the role does not declare it, so the
  // refusal and its reason are printed rather than the role silently skipped.
  const targets =
    options.target !== null
      ? [options.target]
      : EMITTED_TARGETS.filter((target) => parsed.source.targets.includes(target));
  for (const target of targets) {
    generateOne(parsed.source, target, relativeSource);
  }
}

/**
 * @param {import('../src/main/role-source').RoleSource} source
 * @param {string} target
 * @param {string} relativeSource
 */
function generateOne(source, target, relativeSource) {
  process.stdout.write(`\n${relativeSource} -> ${target}\n`);

  const result = generateRoleFile(source, /** @type {any} */ (target), {
    sourcePath: relativeSource,
  });
  if (result.notices.length > 0) {
    process.stdout.write(`${formatNotices(result.notices)}\n`);
  }
  if (!result.ok) {
    failed += 1;
    return;
  }

  const { file } = result;
  const generated = Buffer.from(file.text, 'utf8');

  // What is on disk where this target keeps the file, in the tree being compared.
  const comparePath = path.join(options.compare, file.path);
  const existingBytes = fs.existsSync(comparePath) ? fs.readFileSync(comparePath) : null;
  if (existingBytes !== null && existingBytes.equals(generated)) {
    process.stdout.write(`  identical bytes: ${file.path}\n`);
  } else {
    differing += 1;
    process.stdout.write(`  differs from ${path.relative(repoRoot, comparePath) || comparePath}\n`);
    const diff = buildUnifiedDiff({
      relPath: file.path,
      before:
        existingBytes === null ? { kind: 'absent' } : { kind: 'bytes', bytes: existingBytes },
      after: { kind: 'bytes', bytes: generated },
      beforeLabel: 'on disk',
      afterLabel: `generated from ${relativeSource}`,
    });
    if (diff.unifiedDiff !== null) {
      process.stdout.write(`${indent(diff.unifiedDiff)}\n`);
    }
    if (diff.limitation !== null) {
      process.stdout.write(`  (${diff.limitation})\n`);
    }
  }

  // Whether writing is allowed is a question about the *destination*, which is not
  // necessarily the tree just compared.
  const destination = options.flat
    ? path.join(options.out, path.basename(file.path))
    : path.join(options.out, file.path);
  const destinationText = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : null;
  const decision = writeDecision(inspectGeneratedFile(destinationText), { force: options.force });
  if (!options.write) {
    process.stdout.write(`  not written (no --write); writing would be ${decision.write ? 'allowed' : `refused: ${decision.reason}`}\n`);
    return;
  }
  if (!decision.write) {
    process.stdout.write(`  REFUSED to write ${path.relative(repoRoot, destination)}: ${decision.reason}\n`);
    refused += 1;
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, generated);
  written += 1;
  process.stdout.write(`  wrote ${path.relative(repoRoot, destination)} (${decision.reason})\n`);
}

process.stdout.write(
  `\n${String(sourceFiles.length)} source(s): ${String(written)} written, ${String(refused)} refused, ` +
    `${String(differing)} differing from the compared tree, ${String(failed)} could not be generated\n`,
);
process.exit(failed > 0 || refused > 0 || (!options.write && differing > 0) ? 1 : 0);

/**
 * @param {string} text
 * @returns {string}
 */
function indent(text) {
  return text
    .split('\n')
    .map((line) => (line === '' ? line : `    ${line}`))
    .join('\n');
}
