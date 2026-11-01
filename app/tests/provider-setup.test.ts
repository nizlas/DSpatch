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

import { ProviderSetup, SetupCancelled, matchesIntegrity, packagesFor, unpackTarball } from '../src/main/provider-setup.ts';
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

/** The packages' `package.json`, and the program the state check looks for on either platform. */
const WHOLE = {
  'package/package.json': '{"version":"1.0.0"}',
  'package/claude': '#!/bin/sh\n',
  'package/claude.exe': 'x',
};

const integrityOf = (bytes: Buffer): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

function kit(
  tarball: Buffer,
  integrity = integrityOf(tarball),
  options: Partial<ConstructorParameters<typeof ProviderSetup>[0]> = {},
): { readonly setup: ProviderSetup; readonly root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-setup-'));
  const pinned = path.join(root, 'pinned', 'claude-support');
  fs.mkdirSync(pinned, { recursive: true });
  fs.writeFileSync(path.join(pinned, 'package.json'), '{}');
  fs.writeFileSync(
    path.join(pinned, 'package-lock.json'),
    JSON.stringify({
      packages: {
        '': {},
        'node_modules/a': { version: '1.0.0', resolved: 'https://registry.example/a.tgz', integrity },
        'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64': { version: '1.0.0', resolved: 'https://registry.example/b.tgz', integrity, os: ['linux'], cpu: ['x64'] },
        'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64': { version: '1.0.0', resolved: 'https://registry.example/b.tgz', integrity, os: ['win32'], cpu: ['x64'] },
        'node_modules/zod': { version: '1.0.0', resolved: 'https://registry.example/z.tgz', integrity, peer: true },
      },
    }),
  );
  const setup = new ProviderSetup({
    supportDir: path.join(root, 'support'),
    pinnedDir: path.join(root, 'pinned'),
    dataDir: root,
    log: () => undefined,
    fetchBytes: () => Promise.resolve(tarball),
    prove: () => Promise.resolve(null),
    ...options,
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

  it('takes what the lockfile marks peer, as npm ci does: the SDK needs zod and the MCP SDK', () => {
    const real = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'claude-support', 'package-lock.json'), 'utf8')) as Parameters<typeof packagesFor>[0];
    for (const [platform, arch] of [['linux', 'x64'], ['win32', 'x64']] as const) {
      const folders = packagesFor(real, platform, arch).map((entry) => entry.folder);
      assert.ok(folders.includes('node_modules/zod'), platform);
      assert.ok(folders.includes('node_modules/@modelcontextprotocol/sdk'), platform);
      assert.ok(folders.includes(`node_modules/@anthropic-ai/claude-agent-sdk-${platform}-${arch}`), platform);
    }
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
    const { setup } = kit(tarOf({ ...WHOLE, 'package/bin/tool': '#!/bin/sh\n' }));
    await setup.install('claude', () => undefined);
    assert.equal(setup.programState('claude'), 'ready');
    const tool = path.join(setup.folderOf('claude'), 'node_modules', 'a', 'bin', 'tool');
    assert.ok((fs.statSync(tool).mode & 0o100) !== 0);
  });

  it('leaves what was there when a package does not match', async () => {
    const bad = tarOf({ ...WHOLE, 'package/a': 'bad' });
    let wrong = false;
    const good = tarOf(WHOLE);
    const { setup, root } = kit(good, integrityOf(good), { fetchBytes: () => Promise.resolve(wrong ? bad : good) });
    await setup.install('claude', () => undefined);
    wrong = true;
    await assert.rejects(setup.install('claude', () => undefined), /does not match/);
    assert.equal(setup.programState('claude'), 'ready');
    assert.deepEqual(fs.readdirSync(path.join(root, 'support')), ['claude']);
  });

  it('calls a folder that lacks a package of its lockfile incomplete, whatever its marker says', async () => {
    const { setup } = kit(tarOf(WHOLE));
    assert.equal(setup.programState('claude'), 'absent');
    await setup.install('claude', () => undefined);
    fs.rmSync(path.join(setup.folderOf('claude'), 'node_modules', 'zod'), { recursive: true });
    assert.equal(fs.existsSync(path.join(setup.folderOf('claude'), 'installed.json')), true);
    assert.equal(setup.programState('claude'), 'incomplete');
    assert.equal(await setup.claudeSignedIn(), false);
  });

  it('repairs in place, and touches nothing outside the support folder', async () => {
    const { setup, root } = kit(tarOf(WHOLE));
    await setup.install('claude', () => undefined);
    fs.rmSync(path.join(setup.folderOf('claude'), 'node_modules', 'zod'), { recursive: true });
    setup.recordClaudeConsent();
    fs.writeFileSync(path.join(root, 'conversation.json'), 'kept');
    await setup.install('claude', () => undefined);
    assert.equal(setup.programState('claude'), 'ready');
    assert.equal(setup.claudeConsent(), true);
    assert.equal(fs.readFileSync(path.join(root, 'conversation.json'), 'utf8'), 'kept');
  });

  it('does not put in place what does not load from where it stands', async () => {
    const proofs: string[] = [];
    const { setup, root } = kit(tarOf(WHOLE), undefined, {
      prove: (_tool, folder) => {
        proofs.push(path.basename(folder));
        return Promise.resolve('Cannot find package zod');
      },
    });
    await assert.rejects(setup.install('claude', () => undefined), /does not work on this machine/);
    assert.equal(setup.programState('claude'), 'absent');
    assert.match(proofs[0] ?? '', /^claude\.tmp-/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'support')), []);
  });

  it('says a folder that fails its proof is incomplete, and proves once per install', async () => {
    let proofs = 0;
    let works = true;
    const { setup } = kit(tarOf(WHOLE), undefined, {
      prove: () => {
        proofs += 1;
        return Promise.resolve(works ? null : 'broken');
      },
    });
    await setup.install('claude', () => undefined);
    assert.equal(await setup.provenState('claude'), 'ready');
    assert.equal(await setup.provenState('claude'), 'ready');
    assert.equal(proofs, 2);
    works = false;
    fs.utimesSync(path.join(setup.folderOf('claude'), 'installed.json'), new Date(), new Date(Date.now() + 5_000));
    assert.equal(await setup.provenState('claude'), 'incomplete');
  });

  it('turns a failed download into a sentence, and a cancelled one into no change', async () => {
    let release: (() => void) | undefined;
    const tarball = tarOf(WHOLE);
    const { setup, root } = kit(tarball, undefined, {
      fetchBytes: (_url, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
          release = () => {
            reject(new Error('getaddrinfo ENOTFOUND'));
          };
        }),
    });
    const failed = setup.install('claude', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release?.();
    await assert.rejects(failed, /could not be reached/);
    const cancelled = setup.install('claude', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    setup.cancelInstall('claude');
    await assert.rejects(cancelled, SetupCancelled);
    assert.deepEqual(fs.readdirSync(path.join(root, 'support')), []);
  });

  it('runs one install at a time for a provider', async () => {
    let fetches = 0;
    const tarball = tarOf(WHOLE);
    const { setup } = kit(tarball, undefined, {
      fetchBytes: () => {
        fetches += 1;
        return Promise.resolve(tarball);
      },
    });
    await Promise.all([setup.install('claude', () => undefined), setup.install('claude', () => undefined)]);
    assert.equal(fetches, 3);
  });

  it('finds the old folder again after a swap cut off between its renames', async () => {
    const { setup } = kit(tarOf(WHOLE));
    await setup.install('claude', () => undefined);
    fs.renameSync(setup.folderOf('claude'), `${setup.folderOf('claude')}.old-1`);
    assert.equal(setup.programState('claude'), 'ready');
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

  it('says so when the program could not keep the login, which only a keychain resolves', async () => {
    const { fake, steps } = started('copilot');
    fake.child.stdout.write('Login succeeded, but the token was not saved. Install a system keychain or rerun login and accept plaintext storage.\n');
    await new Promise((resolve) => setImmediate(resolve));
    fake.child.emit('close', 1);
    assert.match(JSON.stringify(steps.at(-1)), /no keychain to keep the login/);
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
