/**
 * DSP-172: the Electron DSpatch runs on is not one that hides a moved view on Linux.
 *
 * The review's discussion is one page in a WebContentsView moved between the windows of its
 * review (docked in the diff window or the walk window, or in its own). Electron 44.0.0 through
 * 44.7.0 left such a view hidden on Linux once it had been moved: the page said it was hidden,
 * painted nothing new and took no input (electron/electron#54626, a Chromium 152 change; fixed
 * in 44.7.1 by electron/electron#54798). The dock trial (`scripts/dock-trial.mjs`) shows it on
 * the X display; this keeps a downgrade from reaching that trial unnoticed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const appDir = path.resolve(import.meta.dirname, '..');

function parts(version: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  assert.ok(match !== null, `not a version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True for the 44.x releases before the fix: 44.0.0 through 44.7.0. */
export function hidesMovedViewsOnLinux(version: string): boolean {
  const [major, minor, patch] = parts(version);
  return major === 44 && (minor < 7 || (minor === 7 && patch === 0));
}

describe('the Electron version (DSP-172)', () => {
  it('names the releases that hide a moved view on Linux', () => {
    assert.equal(hidesMovedViewsOnLinux('44.0.0'), true);
    assert.equal(hidesMovedViewsOnLinux('44.3.0'), true);
    assert.equal(hidesMovedViewsOnLinux('44.7.0'), true);
    assert.equal(hidesMovedViewsOnLinux('44.7.1'), false);
    assert.equal(hidesMovedViewsOnLinux('44.9.3'), false);
    assert.equal(hidesMovedViewsOnLinux('43.7.7'), false);
  });

  it('the pinned and the installed Electron are one version, and not one of those', () => {
    const pinned = (JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> });
    const wanted = pinned.devDependencies?.['electron'] ?? pinned.dependencies?.['electron'] ?? '';
    const installed = (JSON.parse(fs.readFileSync(path.join(appDir, 'node_modules', 'electron', 'package.json'), 'utf8')) as { version: string }).version;
    assert.match(wanted, /^\d+\.\d+\.\d+$/, 'Electron is pinned to an exact version');
    assert.equal(installed, wanted, 'the installed Electron is the pinned one');
    assert.equal(hidesMovedViewsOnLinux(wanted), false, `Electron ${wanted} hides a moved view on Linux (electron/electron#54626)`);
  });
});
