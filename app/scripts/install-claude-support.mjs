/**
 * Install optional Claude support (DSP-133): `npm run claude:install` in `app/`.
 *
 * Installs `app/claude-support/` from its own pinned `package.json` and lockfile
 * (`npm ci` there): the Claude Agent SDK and, through its platform package, the
 * Claude Code binary for this computer. Nothing else in DSpatch installs it - not
 * `npm ci` in `app/`, not starting DSpatch, not choosing an agent. Remove it by
 * deleting `app/claude-support/node_modules`.
 *
 * Installing logs in to nothing and runs no model. Restart DSpatch afterwards; it
 * reads whether support is installed once, at launch.
 *
 * The same on Windows and Linux: npm is run through the npm that runs this script
 * (`npm_execpath`), or `npm` on the PATH when the script is run directly.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supportDir = path.join(appDir, 'claude-support');

/** @type {{ dependencies?: Record<string, string> }} */
const manifest = JSON.parse(fs.readFileSync(path.join(supportDir, 'package.json'), 'utf8'));
const pinned = Object.entries(manifest.dependencies ?? {})
  .map(([name, version]) => `${name} ${version}`)
  .join(', ');

process.stdout.write(
  `Installing Claude support: ${pinned}, with the Claude Code binary for ` +
    `${process.platform}-${process.arch}.\n` +
    `Into: ${path.join(supportDir, 'node_modules')}\n` +
    'No login, no model run. Restart DSpatch afterwards.\n\n',
);

const npmArgs = ['ci', '--no-audit', '--no-fund'];
const execPath = process.env['npm_execpath'];
const result =
  execPath !== undefined && execPath.endsWith('.js')
    ? spawnSync(process.execPath, [execPath, ...npmArgs], { cwd: supportDir, stdio: 'inherit' })
    : spawnSync('npm', npmArgs, {
        cwd: supportDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });

if (result.error !== undefined) {
  process.stderr.write(`Claude support was not installed: ${result.error.message}\n`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(`Claude support was not installed: npm ci exited with ${String(result.status)}.\n`);
  process.exit(result.status ?? 1);
}

const sdkManifest = path.join(
  supportDir,
  'node_modules',
  '@anthropic-ai',
  'claude-agent-sdk',
  'package.json',
);
/** @type {{ version?: string }} */
const installed = JSON.parse(fs.readFileSync(sdkManifest, 'utf8'));
process.stdout.write(
  `\nClaude support installed: @anthropic-ai/claude-agent-sdk ${String(installed.version)} ` +
    `in ${supportDir}. Restart DSpatch to use it.\n`,
);
