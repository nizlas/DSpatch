/**
 * Build the host package for one platform (DSP-153): what `Connect` puts on a machine that has
 * neither Node nor DSpatch. Run after `npm run build:host`:
 *
 *     node scripts/build-host-package.mjs --platform linux|win32 [--arch x64] [--out release/host]
 *
 * The package holds a fixed Node runtime, the built host, its production dependencies for that
 * platform and the bundled loops. It needs no Electron and no window system. Claude's SDK is not
 * in it: its licence reserves redistribution, so the machine fetches it when a person asks
 * (`src/main/provider-install.ts`).
 *
 * `host-manifest.json` beside the packages names each one with its SHA-256, for this commit. The
 * client carries that manifest, so a package is checked against the build that asks for it.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** The host's runtime. Change it deliberately: the tests and trials ran on this one. */
const HOST_NODE_VERSION = '24.22.2';
const SUPPORTED = new Set(['linux-x64', 'win32-x64']);

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..');

/** @param {string} name @param {string} fallback */
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const platform = option('platform', process.platform);
const arch = option('arch', 'x64');
if (!SUPPORTED.has(`${platform}-${arch}`)) {
  throw new Error(`No host package is built for ${platform}-${arch}. Built and tried: ${[...SUPPORTED].join(', ')}.`);
}
const out = path.resolve(appDir, option('out', 'release/host'));

/** @param {string} url */
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${String(response.status)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** The official file, checked against the release's own SHASUMS256.txt, cached between builds. */
/** @param {string} relative */
async function nodeFile(relative) {
  const cache = path.join(os.homedir(), '.cache', 'dspatch-build', `node-v${HOST_NODE_VERSION}`);
  fs.mkdirSync(cache, { recursive: true });
  const local = path.join(cache, relative.replaceAll('/', '_'));
  const base = `https://nodejs.org/dist/v${HOST_NODE_VERSION}`;
  const sumsFile = path.join(cache, 'SHASUMS256.txt');
  if (!fs.existsSync(sumsFile)) {
    fs.writeFileSync(sumsFile, await download(`${base}/SHASUMS256.txt`));
  }
  const wanted = fs.readFileSync(sumsFile, 'utf8').split('\n').find((line) => line.endsWith(`  ${relative}`))?.split(' ')[0];
  if (wanted === undefined) {
    throw new Error(`${relative} is not in Node's SHASUMS256.txt`);
  }
  if (!fs.existsSync(local)) {
    fs.writeFileSync(local, await download(`${base}/${relative}`));
  }
  const actual = createHash('sha256').update(fs.readFileSync(local)).digest('hex');
  if (actual !== wanted) {
    fs.rmSync(local);
    throw new Error(`${relative} does not match SHASUMS256.txt`);
  }
  return local;
}

const identity = JSON.parse(fs.readFileSync(path.join(appDir, 'dist', 'build-identity.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const commit = String(identity.git?.revision ?? 'unknown').slice(0, 12);
if ((identity.git?.dirtyFileCount ?? 0) > 0) {
  process.stderr.write(`warning: built from a working copy with ${String(identity.git.dirtyFileCount)} changed files\n`);
}
const hostId = `${String(pkg.version)}-${commit}`;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-host-'));
const top = path.join(stage, 'dspatch-host');
const app = path.join(top, 'app');
fs.mkdirSync(app, { recursive: true });

for (const part of ['host', 'main', 'shared', 'adapter']) {
  fs.cpSync(path.join(appDir, 'dist', part), path.join(app, 'dist', part), { recursive: true });
}
fs.copyFileSync(path.join(appDir, 'dist', 'build-identity.json'), path.join(app, 'dist', 'build-identity.json'));
fs.copyFileSync(path.join(appDir, 'package.json'), path.join(app, 'package.json'));
fs.copyFileSync(path.join(appDir, 'package-lock.json'), path.join(app, 'package-lock.json'));
execFileSync(
  'npm',
  ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${platform}`, `--cpu=${arch}`, ...(platform === 'linux' ? ['--libc=glibc'] : [])],
  { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' },
);
// The renderer's libraries are the client's; the host has no window.
for (const unused of ['react', 'react-dom', 'scheduler']) {
  fs.rmSync(path.join(app, 'node_modules', unused), { recursive: true, force: true });
}

fs.mkdirSync(path.join(top, 'bundled', 'docs'), { recursive: true });
fs.cpSync(path.join(repoRoot, 'docs', 'loop'), path.join(top, 'bundled', 'docs', 'loop'), { recursive: true });
fs.cpSync(path.join(repoRoot, '.dspatch', 'loops'), path.join(top, 'bundled', '.dspatch', 'loops'), { recursive: true });

for (const support of ['claude-support', 'copilot-support']) {
  fs.mkdirSync(path.join(top, 'bundled', support));
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(appDir, support, file), path.join(top, 'bundled', support, file));
  }
}

if (platform === 'win32') {
  fs.mkdirSync(path.join(top, 'node'));
  fs.copyFileSync(await nodeFile('win-x64/node.exe'), path.join(top, 'node', 'node.exe'));
  fs.writeFileSync(path.join(top, 'dspatch-host.cmd'), '@echo off\r\n"%~dp0node\\node.exe" "%~dp0app\\dist\\host\\remote-host.js" %*\r\n');
} else {
  const archive = await nodeFile(`node-v${HOST_NODE_VERSION}-linux-${arch}.tar.xz`);
  const folder = `node-v${HOST_NODE_VERSION}-linux-${arch}`;
  execFileSync('tar', ['xJf', archive, '-C', top, `${folder}/bin/node`, `${folder}/LICENSE`]);
  fs.renameSync(path.join(top, folder), path.join(top, 'node'));
  fs.writeFileSync(
    path.join(top, 'dspatch-host'),
    '#!/bin/sh\nhere="$(dirname "$(readlink -f "$0")")"\nexec "$here/node/bin/node" "$here/app/dist/host/remote-host.js" "$@"\n',
    { mode: 0o755 },
  );
}

const contract = JSON.parse(
  execFileSync(
    process.execPath,
    ['-e', "const {remoteBuild}=require('./dist/shared/remote-build.js');process.stdout.write(JSON.stringify(remoteBuild('.')))"],
    { cwd: appDir, encoding: 'utf8' },
  ),
);
fs.writeFileSync(
  path.join(top, 'manifest.json'),
  `${JSON.stringify({ format: 1, hostId, platform, arch, nodeVersion: HOST_NODE_VERSION, ...contract }, null, 2)}\n`,
);

fs.mkdirSync(out, { recursive: true });
const file = `dspatch-host-${hostId}-${platform}-${arch}.tar.gz`;
const target = path.join(out, file);
// Reproducible archives on the Linux runner, where releases are built. On Windows (DSP-182) the tar
// found first may be Git for Windows' GNU tar, which reads a drive letter's colon as a remote host
// unless told otherwise, or Windows' own bsdtar, which knows none of the ordering options: a local
// build then gets a plain archive, checked by its own SHA-256 like any other.
const reproducible = ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '-czf', target, '-C', stage, 'dspatch-host'];
const gnuTar = process.platform !== 'win32' || execFileSync('tar', ['--version'], { encoding: 'utf8' }).includes('GNU tar');
execFileSync('tar', gnuTar ? (process.platform === 'win32' ? ['--force-local', ...reproducible] : reproducible) : ['-czf', target, '-C', stage, 'dspatch-host']);
fs.rmSync(stage, { recursive: true, force: true });

const sha256 = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
const manifestPath = path.join(out, 'host-manifest.json');
/** @type {{ packages?: { platform: string, arch: string }[], hostId?: string }} */
const earlier = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const others = earlier.hostId === hostId ? (earlier.packages ?? []).filter((entry) => entry.platform !== platform || entry.arch !== arch) : [];
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      format: 1,
      hostId,
      appVersion: contract.appVersion,
      commit: contract.commit,
      protocol: contract.protocol,
      contract: contract.contract,
      packages: [...others, { platform, arch, file, sha256, size: fs.statSync(target).size }],
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`${target}\n${sha256}\n${String(Math.round(fs.statSync(target).size / 1048576))} MB\n`);
