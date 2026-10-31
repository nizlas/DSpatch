/**
 * Fetching a vendor's program and signing in (DSP-153). The fetch is substituted: what is under
 * test is that nothing unchecked lands, a failure leaves what was there, and the vendor's sign-in
 * text becomes steps for a person who may be on another computer.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';

import { ProviderSetup, matchesIntegrity, packagesFor, unpackTarball } from '../src/main/provider-setup.ts';
import type { ProviderLoginStep } from '../src/shared/bridge.ts';

function tarOf(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000755\0', 100);
    header.write(`${Buffer.byteLength(text).toString(8).padStart(11, '0')}\0`, 124);
    header.write('0', 156);
    const body = Buffer.alloc(Math.ceil(Buffer.byteLength(text) / 512) * 512);
    body.write(text);
    blocks.push(header, body);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const integrityOf = (bytes: Buffer): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

function kit(tarball: Buffer, integrity = integrityOf(tarball)): { readonly setup: ProviderSetup; readonly root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-setup-'));
  const pinned = path.join(root, 'pinned', 'claude-support');
  fs.mkdirSync(pinned, { recursive: true });
  fs.writeFileSync(path.join(pinned, 'package.json'), '{}');
  fs.writeFileSync(
    path.join(pinned, 'package-lock.json'),
    JSON.stringify({ packages: { '': {}, 'node_modules/a': { resolved: 'https://registry.example/a.tgz', integrity } } }),
  );
  const setup = new ProviderSetup({
    supportDir: path.join(root, 'support'),
    pinnedDir: path.join(root, 'pinned'),
    dataDir: root,
    log: () => undefined,
    fetchBytes: () => Promise.resolve(tarball),
  });
  return { setup, root };
}

describe('fetching a pinned program', () => {
  it('takes only what this machine needs, from the lockfile', () => {
    const lock = {
      packages: {
        '': {},
        'node_modules/x': { resolved: 'u', integrity: 'i' },
        'node_modules/x-win': { resolved: 'u', integrity: 'i', os: ['win32'] },
        'node_modules/x-arm': { resolved: 'u', integrity: 'i', os: ['linux'], cpu: ['arm64'] },
        'node_modules/x-musl': { resolved: 'u', integrity: 'i', os: ['linux'], cpu: ['x64'], libc: ['musl'] },
        'node_modules/x-linux': { resolved: 'u', integrity: 'i', os: ['linux'], cpu: ['x64'] },
      },
    };
    assert.deepEqual(packagesFor(lock, 'linux', 'x64').map((entry) => entry.folder), ['node_modules/x', 'node_modules/x-linux']);
  });

  it('refuses a tarball with a path outside itself', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'unpack-'));
    assert.throws(() => {
      unpackTarball(tarOf({ 'package/../../evil': 'x' }), target);
    }, /outside itself/);
  });

  it('checks the integrity', () => {
    const bytes = Buffer.from('x');
    assert.equal(matchesIntegrity(bytes, integrityOf(bytes)), true);
    assert.equal(matchesIntegrity(Buffer.from('y'), integrityOf(bytes)), false);
  });

  it('puts a checked package in place, executable', async () => {
    const { setup } = kit(tarOf({ 'package/bin/tool': '#!/bin/sh\n' }));
    await setup.install('claude', () => undefined);
    assert.equal(setup.installed('claude'), true);
    const tool = path.join(setup.folderOf('claude'), 'node_modules', 'a', 'bin', 'tool');
    assert.ok((fs.statSync(tool).mode & 0o100) !== 0);
  });

  it('leaves what was there when a package does not match', async () => {
    const { setup } = kit(tarOf({ 'package/a': 'good' }));
    await setup.install('claude', () => undefined);
    const { setup: bad, root } = kit(tarOf({ 'package/a': 'bad' }), integrityOf(Buffer.from('other')));
    await assert.rejects(bad.install('claude', () => undefined), /does not match/);
    assert.equal(bad.installed('claude'), false);
    assert.deepEqual(fs.readdirSync(path.join(root, 'support')), []);
    assert.equal(setup.installed('claude'), true);
  });
});

describe('the Claude consent', () => {
  it('is nothing until accepted, and then a reference the adapter can hold', () => {
    const { setup } = kit(tarOf({}));
    assert.equal(setup.claudeReference(), null);
    setup.recordClaudeConsent();
    assert.equal(setup.claudeConsent(), true);
    assert.match(setup.claudeReference() ?? '', /accepted in DSpatch/);
  });
});

function fakeLogin(): { readonly child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void }; readonly args: string[][] } {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: () => undefined,
  });
  return { child, args: [] };
}

describe('signing in', () => {
  const started = (tool: 'claude' | 'copilot'): { fake: ReturnType<typeof fakeLogin>; steps: ProviderLoginStep[]; setup: ProviderSetup } => {
    const fake = fakeLogin();
    const steps: ProviderLoginStep[] = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'login-'));
    const setup = new ProviderSetup({
      supportDir: root,
      pinnedDir: root,
      dataDir: root,
      log: () => undefined,
      spawnLogin: (_command, args) => {
        fake.args.push([...args]);
        return fake.child as never;
      },
    });
    setup.startLogin(tool, (step) => steps.push(step));
    return { fake, steps, setup };
  };

  it('never asks Claude for the path that bills through an API key', () => {
    const { fake } = started('claude');
    assert.deepEqual(fake.args[0], ['auth', 'login', '--claudeai']);
  });

  it("turns Claude's text into a link and a place for the code, and sends the code back", async () => {
    const { fake, steps, setup } = started('claude');
    fake.child.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\nPaste code here if prompted > ");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(steps.map((step) => step.kind), ['open-url', 'input']);
    setup.answerLogin(' abc ');
    assert.equal(fake.child.stdin.read()?.toString(), 'abc\n');
  });

  it("gives Copilot's device code with its link, also when the code comes later", async () => {
    const { fake, steps } = started('copilot');
    fake.child.stdout.write('To authenticate, visit https://github.com/login/device ');
    await new Promise((resolve) => setImmediate(resolve));
    fake.child.stdout.write('and enter code ABCD-1234\n');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(steps.at(-1), { kind: 'open-url', url: 'https://github.com/login/device', code: 'ABCD-1234' });
  });

  it('says how it ended', () => {
    const { fake, steps } = started('copilot');
    fake.child.emit('close', 0);
    assert.deepEqual(steps.at(-1), { kind: 'done' });
  });
});
