// @ts-nocheck: a release script.
/**
 * Gather one release's files into `release/stage-v<version>` and write `SHA256SUMS`: the
 * installers and host packages of one commit and their manifest, the remote-setup scripts from
 * `remote-setup/` (DSP-214), and nothing else from `release/`. Refuses when the working copy is not
 * that commit, or a file is missing.
 *
 *     node scripts/stage-release.mjs
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** The scripts that prepare a Windows host and a Linux client (DSP-214), published as they are. */
export const REMOTE_SETUP_FILES = ['dspatch-prepare-windows-host.ps1', 'dspatch-prepare-linux-client.sh'];

/**
 * One release's files as `[from, to]`: `from` relative to `release/`, `to` the name in the stage.
 *
 * @param {string} version
 * @param {{ packages: { file: string }[] }} manifest
 * @param {boolean} linuxOnly
 * @returns {[string, string][]}
 */
export function releaseFiles(version, manifest, linuxOnly) {
  return [
    [`dspatch_${version}_amd64.deb`, `dspatch_${version}_amd64.deb`],
    ...(linuxOnly ? [] : [[`DSpatch Setup ${version}.exe`, `DSpatch-Setup-${version}.exe`]]),
    ...manifest.packages.map((entry) => [path.join('host', entry.file), entry.file]),
    [path.join('host', 'host-manifest.json'), 'host-manifest.json'],
    ...REMOTE_SETUP_FILES.map((name) => [path.join('..', 'remote-setup', name), name]),
  ];
}

function stage() {
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const release = path.join(app, 'release');
  const linuxOnly = process.argv.includes('--linux-only');
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
  const files = releaseFiles(version, manifest, linuxOnly);
  const folder = path.join(release, `stage-v${version}`);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder);
  const sums = [];
  for (const [from, to] of files) {
    const source = path.join(release, from);
    if (!fs.existsSync(source)) {
      refuse(`${from} is missing.`);
    }
    fs.copyFileSync(source, path.join(folder, to));
    sums.push(`${createHash('sha256').update(fs.readFileSync(source)).digest('hex')}  ${to}`);
  }
  for (const entry of manifest.packages) {
    if (!sums.some((line) => line === `${entry.sha256}  ${entry.file}`)) {
      refuse(`${entry.file} does not match the manifest.`);
    }
  }
  fs.writeFileSync(path.join(folder, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  process.stdout.write(`${folder}\n${sums.join('\n')}\n`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stage();
}
