import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  ADOPTION_REPORT,
  adoptOlderData,
  adoptWithoutFailing,
  adoptionWaiting,
  adoptionNotice,
  claimDataFolder,
  heldClaim,
  olderHostDataDir,
  sharedDataDir,
  takeHandoverRequest,
} from '../src/main/host-data';

/* One work context per user of a machine (DSP-161): the folder, the claim and the adoption. */

let root: string;
let target: string;
let older: string;

function write(folder: string, relative: string, text: string): void {
  const file = path.join(folder, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function read(folder: string, relative: string): string {
  return fs.readFileSync(path.join(folder, relative), 'utf8');
}

const quiet = (): void => undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-host-data-'));
  target = path.join(root, 'DSpatch');
  older = path.join(root, 'dspatch-host');
  fs.mkdirSync(target);
  fs.mkdirSync(older);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('the data folder', () => {
  it('is what Electron calls userData, on each platform', () => {
    assert.equal(sharedDataDir('linux', {}, '/home/a'), '/home/a/.config/DSpatch');
    assert.equal(sharedDataDir('linux', { XDG_CONFIG_HOME: '/x' }, '/home/a'), '/x/DSpatch');
    assert.equal(sharedDataDir('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Roaming\\DSpatch');
    assert.equal(olderHostDataDir('linux', {}, '/home/a'), '/home/a/.local/share/dspatch-host');
    assert.equal(olderHostDataDir('win32', { LOCALAPPDATA: 'C:\\L' }, 'C:\\Users\\a'), 'C:\\L\\dspatch-host');
  });
});

describe('the claim', () => {
  it('refuses a second host, says which kind holds it, and frees on release', () => {
    const first = claimDataFolder(target, 'desktop');
    assert.ok('release' in first);
    const second = claimDataFolder(target, 'standalone');
    assert.ok('held' in second);
    assert.equal(second.held.kind, 'desktop');
    assert.equal(second.held.pid, process.pid);
    first.release();
    assert.equal(heldClaim(target), null);
  });

  it('removes a claim whose process is gone', () => {
    const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
    write(target, 'host-claim.json', JSON.stringify({ pid: Number(gone), kind: 'desktop', startedAtUtc: '', identity: "dead" }));
    const claim = claimDataFolder(target, 'standalone');
    assert.ok('release' in claim);
    claim.release();
  });

  it('does not take a live process id from an earlier boot for a host', () => {
    write(target, 'host-claim.json', JSON.stringify({ pid: process.pid, kind: 'standalone', startedAtUtc: '', identity: "another-boot" }));
    assert.equal(heldClaim(target), null);
  });
});

describe('the claim, from the side of a live host', () => {
  it('holds whatever the clock does, and a half-written file is never read as free', () => {
    const claim = claimDataFolder(target, 'desktop');
    assert.ok('release' in claim);
    const held = JSON.parse(read(target, 'host-claim.json')) as { identity: string };
    assert.notEqual(held.identity, '');
    assert.equal(heldClaim(target)?.pid, process.pid);
    assert.equal(fs.readdirSync(target).filter((name) => name !== 'host-claim.json').length, 0);
    claim.release();
  });

  it('does not take a process that has ended and is not yet collected for a host', { skip: process.platform !== 'linux' }, async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    const pid = child.pid ?? 0;
    await once(child, 'spawn');
    const fields = fs.readFileSync(`/proc/${String(pid)}/stat`, 'utf8').split(') ')[1]?.split(' ') ?? [];
    const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    write(target, 'host-claim.json', JSON.stringify({ pid, kind: 'desktop', startedAtUtc: '', identity: `${boot}:${fields[19] ?? ''}` }));
    assert.equal(heldClaim(target)?.pid, pid);
    child.kill('SIGKILL');
    await once(child, 'exit');
    assert.equal(heldClaim(target), null);
  });

  it('gives a fresh claim back if it was taken aside by a slower starter', () => {
    write(target, 'host-claim.json', '{}');
    const claim = claimDataFolder(target, 'desktop');
    assert.ok('release' in claim);
    const again = claimDataFolder(target, 'standalone');
    assert.ok('held' in again);
    claim.release();
  });
});

describe('a handover request', () => {
  it('is answered once, and an old one is dropped', () => {
    write(target, 'handover-request.json', '{"nonce":"n1"}');
    assert.equal(takeHandoverRequest(target), 'n1');
    assert.equal(takeHandoverRequest(target), null);
    write(target, 'handover-request.json', '{"nonce":"n2"}');
    assert.equal(takeHandoverRequest(target, Date.now() + 120_000), null);
  });
});

describe('adopting an older host folder', () => {
  it('brings over what is missing, and backs up both sides first', () => {
    write(older, 'conversations/a.json', '{"conversationId":"a"}');
    write(older, 'loop-runs/r1/run.json', '{}');
    write(older, 'reviews/pairs/p.json', '{"decision":"approved"}');
    write(target, 'conversations/b.json', '{"conversationId":"b"}');
    const report = adoptOlderData(target, older, quiet);
    assert.ok(report !== null);
    assert.equal(report.copied, 3);
    assert.equal(read(target, 'conversations/a.json'), '{"conversationId":"a"}');
    assert.equal(read(target, 'conversations/b.json'), '{"conversationId":"b"}');
    assert.equal(read(target, 'reviews/pairs/p.json'), '{"decision":"approved"}');
    assert.equal(read(report.backup, 'older-host/conversations/a.json'), '{"conversationId":"a"}');
    assert.equal(read(report.backup, 'shared-folder/conversations/b.json'), '{"conversationId":"b"}');
    assert.equal(adoptionNotice(target), null);
  });

  it('never overwrites: both sides of a conflict stay, and the person is told once', () => {
    write(older, 'conversations/c.json', '{"conversationId":"c","from":"older"}');
    write(target, 'conversations/c.json', '{"conversationId":"c","from":"target"}');
    write(older, 'reviews/k.json', 'older');
    write(target, 'reviews/k.json', 'target');
    const report = adoptOlderData(target, older, quiet);
    assert.equal(report?.conflicts.length, 2);
    assert.match(read(target, 'conversations/c.json'), /target/);
    const beside = JSON.parse(read(target, 'conversations/c-from-older-host.json')) as { conversationId: string; from: string };
    assert.deepEqual(beside, { conversationId: 'c-from-older-host', from: 'older' });
    assert.equal(read(target, 'reviews/k.json'), 'target');
    const kept = report?.conflicts.find((one) => one.record.includes('k.json'))?.keptAt ?? '';
    assert.equal(fs.readFileSync(kept, 'utf8'), 'older');
    assert.match(adoptionNotice(target) ?? '', /2 record/);
    assert.equal(adoptionNotice(target), null);
  });

  it('joins the two lists of recent work', () => {
    const list = (paths: string[]): string => JSON.stringify({ formatVersion: 3, workspaces: paths.map((one) => ({ id: one, folders: [one] })), looseConversationId: null });
    write(older, 'dspatch-projects.json', list(['/w/one', '/w/two']));
    write(target, 'dspatch-projects.json', list(['/w/two', '/w/three']));
    adoptOlderData(target, older, quiet);
    const merged = JSON.parse(read(target, 'dspatch-projects.json')) as { workspaces: { id: string }[] };
    assert.deepEqual(merged.workspaces.map((one) => one.id), ['/w/two', '/w/three', '/w/one']);
  });

  it('happens once, leaves the older folder in place, and waits for a host still running there', () => {
    write(older, 'conversations/a.json', '{}');
    write(older, 'host-running.json', JSON.stringify({ pid: process.pid }));
    assert.equal(adoptOlderData(target, older, quiet), null);
    fs.rmSync(path.join(older, 'host-running.json'));
    assert.ok(adoptOlderData(target, older, quiet) !== null);
    assert.equal(adoptOlderData(target, older, quiet), null);
    assert.equal(read(older, 'conversations/a.json'), '{}');
    assert.ok(fs.existsSync(path.join(target, ADOPTION_REPORT)));
  });

  it('leaves fetched programs out, and copes with what is not a file', () => {
    write(older, 'provider-support/claude/program', 'x'.repeat(100));
    write(older, 'conversations/a.json', '{}');
    fs.symlinkSync('/no/such/thing', path.join(older, 'conversations', 'dangling'));
    const report = adoptOlderData(target, older, quiet);
    assert.equal(report?.copied, 1);
    assert.equal(fs.existsSync(path.join(target, 'provider-support')), false);
  });

  it('never stops a start: a failure leaves things alone, says so once it can, and tries again', () => {
    write(older, 'conversations/c.json', 'not json');
    write(target, 'conversations/c.json', '{}');
    adoptWithoutFailing(target, older, quiet);
    assert.match(adoptionNotice(target) ?? '', /could not be brought/);
    assert.equal(read(older, 'conversations/c.json'), 'not json');
    assert.equal(adoptionWaiting(target, older), true);
    fs.writeFileSync(path.join(older, 'conversations/c.json'), '{"conversationId":"c"}');
    adoptWithoutFailing(target, older, quiet);
    assert.equal(adoptionWaiting(target, older), false);
  });

  it('counts as done only for the folder it went into', () => {
    write(older, 'conversations/a.json', '{}');
    adoptOlderData(path.join(root, 'trial'), older, quiet);
    assert.equal(adoptionWaiting(target, older), true);
    assert.ok(adoptOlderData(target, older, quiet) !== null);
  });

  it('does nothing for a folder with no DSpatch data, or for the same folder', () => {
    write(older, 'host.log', 'x');
    assert.equal(adoptOlderData(target, older, quiet), null);
    assert.equal(adoptOlderData(target, target, quiet), null);
  });
});
