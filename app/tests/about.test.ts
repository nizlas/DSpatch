/**
 * About DSpatch (DSP-200): the installed app's version, and the running host's own only when the
 * host reported it; never the app's version in its place.
 *
 *     node --test tests/about.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { aboutText, mainWindowTitle } from '../src/main/about.ts';
import { remoteBuild } from '../src/shared/remote-build.ts';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = (JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')) as { version: string }).version;

const host = { protocol: 1, contract: 'abc', appVersion: '0.1.21', commit: 'c0ffee123456' };

test('About names the app version and the host that reported its own, apart', () => {
  assert.equal(aboutText('0.1.22', 'b41aeceb0b32', host), 'DSpatch 0.1.22 (b41aeceb0b32)\nRunning host: 0.1.21 (c0ffee123456)');
  assert.equal(aboutText('0.1.22', 'unknown', { ...host, commit: 'unknown' }), 'DSpatch 0.1.22\nRunning host: 0.1.21');
});

test('About does not guess the host version', () => {
  for (const unknown of [null, { ...host, appVersion: '0.0.0' }, { ...host, appVersion: '' }]) {
    const text = aboutText('0.1.22', 'b41aeceb0b32', unknown);
    assert.match(text, /Running host: not known/);
    assert.doesNotMatch(text.split('\n')[1] ?? '', /0\.1\.22/);
  }
});

test('the version comes from the package metadata, which the build identity reads too', () => {
  assert.equal(remoteBuild(appDir).appVersion, packageVersion);
  assert.equal(mainWindowTitle(packageVersion), `DSpatch — ${packageVersion}`);
});
