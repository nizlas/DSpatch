/**
 * Gather what the installed client carries beside its code (DSP-153), into `build/bundled/`:
 * the loops and their graphs and roles, provider support's pinned lists, and the validated host
 * packages of this build. Run by `npm run package:client`, after `npm run package:host`.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {string} appDir */
export function prepareBundled(appDir) {
  const repoRoot = path.resolve(appDir, '..');
  const bundled = path.join(appDir, 'build', 'bundled');
  fs.rmSync(bundled, { recursive: true, force: true });
  const hostDir = path.join(appDir, 'release', 'host');
  const manifestBytes = fs.readFileSync(path.join(hostDir, 'host-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (
    manifest === null || manifest.format !== 1 ||
    typeof manifest.hostId !== 'string' || !safeName.test(manifest.hostId) ||
    typeof manifest.appVersion !== 'string' || !safeName.test(manifest.appVersion) ||
    typeof manifest.commit !== 'string' || !/^[a-f0-9]{12,64}$/.test(manifest.commit) ||
    !Array.isArray(manifest.packages) || manifest.packages.length === 0
  ) {
    throw new Error('Invalid host manifest. Run npm run package:host before packaging the client.');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const identity = JSON.parse(fs.readFileSync(path.join(appDir, 'dist', 'build-identity.json'), 'utf8'));
  if (manifest.appVersion !== pkg.version ||
      typeof identity.git?.revision !== 'string' || !identity.git.revision.startsWith(manifest.commit) ||
      manifest.hostId !== `${pkg.version}-${identity.git.revision.slice(0, 12)}`) {
    throw new Error('Host packages and client must have the same version and build revision.');
  }
  const files = new Set();
  const targets = new Set();
  for (const entry of manifest.packages) {
    if (
      entry === null || typeof entry !== 'object' ||
      !['linux', 'win32'].includes(entry.platform) || entry.arch !== 'x64' ||
      typeof entry.file !== 'string' || !safeName.test(entry.file) ||
      entry.file !== `dspatch-host-${manifest.hostId}-${entry.platform}-${entry.arch}.tar.gz` ||
      typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) || entry.size <= 0 ||
      files.has(entry.file) || targets.has(`${entry.platform}-${entry.arch}`)
    ) {
      throw new Error('Invalid host package entry in host-manifest.json.');
    }
    files.add(entry.file);
    targets.add(`${entry.platform}-${entry.arch}`);
    const source = path.join(hostDir, entry.file);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.size !== entry.size ||
        createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== entry.sha256) {
      throw new Error(`Host package ${entry.file} does not match its manifest.`);
    }
  }
  if (!targets.has(`${process.platform}-${process.arch}`)) {
    throw new Error(`Host manifest has no package for this client: ${process.platform}-${process.arch}.`);
  }
  fs.mkdirSync(path.join(bundled, 'docs'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'docs', 'loop'), path.join(bundled, 'docs', 'loop'), { recursive: true });
  fs.cpSync(path.join(repoRoot, '.dspatch', 'loops'), path.join(bundled, '.dspatch', 'loops'), { recursive: true });
  for (const support of ['claude-support', 'copilot-support']) {
    fs.mkdirSync(path.join(bundled, support));
    for (const file of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(appDir, support, file), path.join(bundled, support, file));
    }
  }
  fs.mkdirSync(path.join(bundled, 'host-packages'));
  for (const file of files) {
    fs.copyFileSync(path.join(hostDir, file), path.join(bundled, 'host-packages', file));
  }
  fs.writeFileSync(path.join(bundled, 'host-manifest.json'), manifestBytes);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareBundled(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
}
