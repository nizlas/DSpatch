// @ts-nocheck: a release script.
/**
 * Gather one release's files into `release/stage-v<version>` and write `SHA256SUMS`: the
 * installers and host packages of one commit and their manifest, and nothing else from `release/`.
 * Refuses when the working copy is not that commit, or a file is missing.
 *
 *     node scripts/stage-release.mjs
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(app, 'release');
const { version } = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'host', 'host-manifest.json'), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
const refuse = (why) => {
  process.stderr.write(`${why}\n`);
  process.exit(1);
};

if (manifest.appVersion !== version) {
  refuse(`The manifest is for ${String(manifest.appVersion)}, this is ${String(version)}.`);
}
if (!git('rev-parse', 'HEAD').startsWith(manifest.commit)) {
  refuse(`The manifest is for ${String(manifest.commit)}, this is ${git('rev-parse', '--short=12', 'HEAD')}.`);
}
if (git('status', '--porcelain') !== '') {
  refuse('The working copy has changes.');
}
const files = [
  [`dspatch_${version}_amd64.deb`, `dspatch_${version}_amd64.deb`],
  [`DSpatch Setup ${version}.exe`, `DSpatch-Setup-${version}.exe`],
  ...manifest.packages.map((entry) => [path.join('host', entry.file), entry.file]),
  [path.join('host', 'host-manifest.json'), 'host-manifest.json'],
];
const stage = path.join(release, `stage-v${version}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage);
const sums = [];
for (const [from, to] of files) {
  const source = path.join(release, from);
  if (!fs.existsSync(source)) {
    refuse(`${from} is missing.`);
  }
  fs.copyFileSync(source, path.join(stage, to));
  sums.push(`${createHash('sha256').update(fs.readFileSync(source)).digest('hex')}  ${to}`);
}
for (const entry of manifest.packages) {
  if (!sums.some((line) => line === `${entry.sha256}  ${entry.file}`)) {
    refuse(`${entry.file} does not match the manifest.`);
  }
}
fs.writeFileSync(path.join(stage, 'SHA256SUMS'), `${sums.join('\n')}\n`);
process.stdout.write(`${stage}\n${sums.join('\n')}\n`);
