/**
 * Gather what the installed client carries beside its code (DSP-153), into `build/bundled/`:
 * the loops and their graphs and roles, Claude support's pinned list, and the host manifest of
 * this build when `npm run package:host` has made one. Run by `npm run package:client`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..');
const bundled = path.join(appDir, 'build', 'bundled');

fs.rmSync(bundled, { recursive: true, force: true });
fs.mkdirSync(path.join(bundled, 'docs'), { recursive: true });
fs.cpSync(path.join(repoRoot, 'docs', 'loop'), path.join(bundled, 'docs', 'loop'), { recursive: true });
fs.cpSync(path.join(repoRoot, '.dspatch', 'loops'), path.join(bundled, '.dspatch', 'loops'), { recursive: true });
for (const support of ['claude-support', 'copilot-support']) {
  fs.mkdirSync(path.join(bundled, support));
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(appDir, support, file), path.join(bundled, support, file));
  }
}
const manifest = path.join(appDir, 'release', 'host', 'host-manifest.json');
if (fs.existsSync(manifest)) {
  fs.copyFileSync(manifest, path.join(bundled, 'host-manifest.json'));
} else {
  process.stderr.write('warning: no host manifest; this client cannot install a host. Run npm run package:host first.\n');
}
