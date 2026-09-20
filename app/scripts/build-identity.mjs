/**
 * Stamp the artifact with the sources it was built from.
 *
 * A packaged application is opaque. `DSpatch.exe` at 246 MB looks the same
 * whichever revision is inside it, and this project has already been bitten by
 * that: the artifact on disk before this was written was built from sources that
 * predated DSP-4, and the only way to establish that was to list the archive and
 * notice a missing file. "Which code is in this installer" should not need an
 * archaeologist.
 *
 * So `npm run build` writes `dist/build-identity.json`: every source file that
 * goes into the build with its SHA-256, one digest over all of them, and the git
 * revision they sat beside. The file travels inside `app.asar`, the main process
 * reads it at startup and logs the digest, and the window shows it. Three places
 * to check, none of them a claim by an agent.
 *
 * What it is not: a signature. Nothing here proves the artifact was not modified
 * afterwards — it proves which sources the build *read*, which is the question
 * actually being asked. `asarUnpack`ed native binaries and node_modules are not
 * hashed either; the dependency versions in package.json are, and package.json is.
 *
 *   node scripts/build-identity.mjs            (from app/)
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const appDir = path.resolve(import.meta.dirname, '..');

/** Everything that decides what the build contains. */
const ROOTS = ['src'];
const FILES = [
  'package.json',
  'package-lock.json',
  'electron-builder.yml',
  'vite.config.mts',
  'tsconfig.base.json',
  'tsconfig.node.json',
  'tsconfig.renderer.json',
];

/**
 * Every file under a directory, recursively.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

const collected = [
  ...ROOTS.flatMap((root) => walk(path.join(appDir, root))),
  ...FILES.map((name) => path.join(appDir, name)).filter((file) =>
    fs.existsSync(file),
  ),
];

const files = collected
  .map((full) => ({
    // Forward slashes so the manifest is comparable across platforms even though
    // only Windows is packaged today.
    path: path.relative(appDir, full).split(path.sep).join('/'),
    bytes: fs.statSync(full).size,
    sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
  }))
  .sort((left, right) => (left.path < right.path ? -1 : 1));

/**
 * One digest over the whole list, computed from `path + sha256` pairs.
 *
 * Order is fixed by the sort above, so the digest is reproducible from the same
 * sources. Byte counts are deliberately left out of it: they are shown for a human
 * reading the manifest, and including them would add nothing a content hash has
 * not already settled.
 */
const digest = createHash('sha256')
  .update(files.map((file) => `${file.path} ${file.sha256}`).join('\n'))
  .digest('hex');

/**
 * A git reading, or `null` when git could not answer.
 *
 * @param {readonly string[]} args
 * @returns {string | null}
 */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: appDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // A build from an export with no git available is not an error; it is a build
    // whose revision is unknown, and `null` says so.
    return null;
  }
}

const identity = {
  formatVersion: 1,
  digest,
  fileCount: files.length,
  generatedAtUtc: new Date().toISOString(),
  productVersion: JSON.parse(
    fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'),
  ).version,
  git: {
    // `null` for unknown throughout: a build from uncommitted work is the normal
    // case in this project, and "clean" must never be implied.
    revision: git(['rev-parse', 'HEAD']),
    // Non-empty means the working copy differed from that revision when the
    // artifact was built, which is exactly the situation the digest above exists
    // for. The list is truncated because it can be long; the count is not.
    dirtyFileCount: (() => {
      const status = git(['status', '--porcelain']);
      return status === null
        ? null
        : status.split('\n').filter((line) => line.trim() !== '').length;
    })(),
  },
  note:
    'SHA-256 of every source file this build was made from, and one digest over ' +
    'the list. It records which sources the build read, not that the artifact was ' +
    'left alone afterwards — it is not a signature. Recompute it with ' +
    '`node scripts/build-identity.mjs` on a working copy and compare the digest.',
  files,
};

const outDir = path.join(appDir, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'build-identity.json');
fs.writeFileSync(outFile, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
process.stdout.write(
  `build identity ${digest.slice(0, 16)} over ${String(files.length)} files ` +
    `(git ${identity.git.revision?.slice(0, 7) ?? 'unknown'}, ` +
    `${String(identity.git.dirtyFileCount ?? -1)} changed) -> ${outFile}\n`,
);
