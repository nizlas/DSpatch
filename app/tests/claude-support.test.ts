/**
 * Optional Claude support (DSP-133): whether it is installed, read from fake
 * folders, and the loader's refusal when it is not.
 *
 * Every folder here is a fixture of `package.json` files (and, for the guard
 * test, an SDK entry that is never evaluated). No SDK, no Claude Code binary and
 * no provider is involved; the offline guard in `run-tests.mjs` refuses any path
 * inside a `claude-support` folder on top of that.
 *
 *     node scripts/run-tests.mjs provider        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  binaryPackageCandidates,
  claudeSupportStatus,
  claudeUnavailableReason,
  CLAUDE_NOT_INSTALLED_TEXT,
  loadClaudeSdk,
  type ClaudeSupportPlatform,
} from '../src/adapter/claude-support.ts';
import { tempRoot } from './support/fixtures.ts';

const WINDOWS: ClaudeSupportPlatform = { platform: 'win32', arch: 'x64', libc: null };
const GLIBC: ClaudeSupportPlatform = { platform: 'linux', arch: 'x64', libc: 'glibc' };
const MUSL: ClaudeSupportPlatform = { platform: 'linux', arch: 'x64', libc: 'musl' };

/** Write `node_modules/<name>/package.json` (and optional extra files) under `dir`. */
function fakePackage(dir: string, name: string, extra: Record<string, string> = {}): string {
  const root = path.join(dir, 'node_modules', ...name.split('/'));
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name, version: '0.3.306', exports: { '.': { default: './sdk.mjs' } } }),
    'utf8',
  );
  for (const [file, text] of Object.entries(extra)) {
    fs.writeFileSync(path.join(root, file), text, 'utf8');
  }
  return root;
}

/**
 * An SDK entry that would announce its evaluation. Nothing here may run it: the
 * loader refuses before importing, or the guard refuses the import itself.
 */
const LOUD_ENTRY =
  "globalThis.__dspatchFakeSdkEvaluated = true;\nexport const query = () => { throw new Error('fake'); };\n";

function evaluated(): boolean {
  return (globalThis as { __dspatchFakeSdkEvaluated?: boolean }).__dspatchFakeSdkEvaluated === true;
}

test('absent: no SDK in the folder is not installed, with the instruction and what is missing', () => {
  const dir = path.join(tempRoot('support-absent'), 'support');
  const status = claudeSupportStatus(dir, WINDOWS);
  assert.equal(status.installed, false);
  assert.equal(status.sdkVersion, null);
  assert.equal(status.binaryPackage, '@anthropic-ai/claude-agent-sdk-win32-x64');
  assert.ok(status.reason?.startsWith(CLAUDE_NOT_INSTALLED_TEXT));
  assert.match(status.reason ?? '', /No @anthropic-ai\/claude-agent-sdk under/);
});

test('the SDK without its binary package for this platform is not installed', () => {
  const dir = path.join(tempRoot('support-no-binary'), 'support');
  fakePackage(dir, '@anthropic-ai/claude-agent-sdk');
  // A binary for another platform does not count.
  fakePackage(dir, '@anthropic-ai/claude-agent-sdk-darwin-arm64');
  const status = claudeSupportStatus(dir, WINDOWS);
  assert.equal(status.installed, false);
  assert.equal(status.sdkVersion, '0.3.306');
  assert.match(status.reason ?? '', /not its Claude Code binary for this platform, @anthropic-ai\/claude-agent-sdk-win32-x64/);
});

test('the SDK and its binary package are installed', () => {
  const dir = path.join(tempRoot('support-both'), 'support');
  fakePackage(dir, '@anthropic-ai/claude-agent-sdk');
  fakePackage(dir, '@anthropic-ai/claude-agent-sdk-win32-x64');
  const status = claudeSupportStatus(dir, WINDOWS);
  assert.deepEqual(status, {
    installed: true,
    directory: dir,
    sdkVersion: '0.3.306',
    binaryPackage: '@anthropic-ai/claude-agent-sdk-win32-x64',
    reason: null,
  });
});

test('Linux: the matching libc is preferred and the other accepted, as the SDK does', () => {
  assert.deepEqual(binaryPackageCandidates(GLIBC), [
    '@anthropic-ai/claude-agent-sdk-linux-x64',
    '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
  ]);
  assert.deepEqual(binaryPackageCandidates(MUSL), [
    '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    '@anthropic-ai/claude-agent-sdk-linux-x64',
  ]);

  const dir = path.join(tempRoot('support-linux'), 'support');
  fakePackage(dir, '@anthropic-ai/claude-agent-sdk');
  assert.equal(claudeSupportStatus(dir, GLIBC).binaryPackage, '@anthropic-ai/claude-agent-sdk-linux-x64');
  assert.equal(claudeSupportStatus(dir, MUSL).binaryPackage, '@anthropic-ai/claude-agent-sdk-linux-x64-musl');
  assert.equal(claudeSupportStatus(dir, GLIBC).installed, false);

  fakePackage(dir, '@anthropic-ai/claude-agent-sdk-linux-x64-musl');
  const onGlibc = claudeSupportStatus(dir, GLIBC);
  assert.equal(onGlibc.installed, true);
  assert.equal(onGlibc.binaryPackage, '@anthropic-ai/claude-agent-sdk-linux-x64-musl');
  assert.equal(claudeSupportStatus(dir, MUSL).binaryPackage, '@anthropic-ai/claude-agent-sdk-linux-x64-musl');
});

test('the loader refuses plainly and imports nothing when support is not installed', async () => {
  // Named differently from `claude-support`, so this is the loader's own refusal,
  // not the guard's.
  const dir = path.join(tempRoot('support-loader'), 'support');
  fakePackage(dir, '@anthropic-ai/claude-agent-sdk', { 'sdk.mjs': LOUD_ENTRY });
  await assert.rejects(loadClaudeSdk(dir, WINDOWS), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'ClaudeAdapterError');
    assert.equal((error as { providerCode?: string }).providerCode, 'claude_support_missing');
    assert.ok(error.message.startsWith(CLAUDE_NOT_INSTALLED_TEXT));
    return true;
  });
  assert.equal(evaluated(), false, 'the SDK entry was never imported');
});

test('the offline guard refuses the loader path into a claude-support folder', async () => {
  const dir = path.join(tempRoot('support-guard'), 'claude-support');
  const root = fakePackage(dir, '@anthropic-ai/claude-agent-sdk', { 'sdk.mjs': LOUD_ENTRY });
  fakePackage(dir, '@anthropic-ai/claude-agent-sdk-win32-x64');
  const guard = (await import('../scripts/test-offline-guard.mjs')) as {
    expectRefusal(specifier: string): void;
  };
  guard.expectRefusal(pathToFileURL(path.join(root, 'sdk.mjs')).href);
  await assert.rejects(loadClaudeSdk(dir, WINDOWS), /offline-guard/);
  assert.equal(evaluated(), false, 'the SDK entry was never evaluated');
});

test('availability names each missing part', () => {
  assert.equal(claudeUnavailableReason({ authorized: true, installed: true }), null);
  assert.equal(claudeUnavailableReason({ authorized: true, installed: false }), CLAUDE_NOT_INSTALLED_TEXT);
  assert.match(
    claudeUnavailableReason({ authorized: false, installed: true }) ?? '',
    /^Claude is not enabled for this launch/,
  );
  assert.match(
    claudeUnavailableReason({ authorized: false, installed: false }) ?? '',
    /not installed, and Claude is not enabled for this launch/,
  );
});
