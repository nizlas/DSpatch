/**
 * Stopping a shell command and what it started, per platform.
 *
 * **Simulated-platform tests, not Linux evidence.** Every POSIX case below
 * injects `platform: 'linux'` and a recording kill function on a Windows machine;
 * nothing here has run on Linux, and a pass says only that the code asks for the
 * right thing. Whether a process group actually takes a test runner's workers
 * with it on Linux is unmeasured.
 *
 * The Windows cases pin each caller's existing `taskkill` call separately,
 * because they differ on purpose (review B4 of run 20261026-200000-linux-claude):
 * the chat waits for it synchronously and logs a failure, the loop gate fires it
 * asynchronously and listens only for `error`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chatCommandSpawnOptions, stopChatCommandTree } from '../src/main/chat-service.ts';
import { gateCommandSpawnOptions, killCommandTree } from '../src/main/loop-live.ts';
import { stopPosixProcessGroup, treeSpawnOptions } from '../src/main/process-tree.ts';

interface Recorded {
  readonly kills: [number, NodeJS.Signals][];
  readonly childKills: NodeJS.Signals[];
}

function fakeChild(pid: number | undefined): Recorded & {
  child: { pid: number | undefined; kill(signal: NodeJS.Signals): boolean };
} {
  const childKills: NodeJS.Signals[] = [];
  return {
    kills: [],
    childKills,
    child: {
      pid,
      kill(signal) {
        childKills.push(signal);
        return true;
      },
    },
  };
}

function throwingKill(): never {
  const err = new Error('kill ESRCH') as NodeJS.ErrnoException;
  err.code = 'ESRCH';
  throw err;
}

describe('process tree (simulated platforms, not Linux evidence)', () => {
  it('adds nothing to the spawn options on Windows and a process group elsewhere', () => {
    assert.deepEqual(treeSpawnOptions('win32'), {});
    assert.deepEqual(treeSpawnOptions('linux'), { detached: true });
    assert.deepEqual(treeSpawnOptions('darwin'), { detached: true });
  });

  it('signals the whole group, not the shell, on POSIX', () => {
    const rec = fakeChild(4242);
    const result = stopPosixProcessGroup(rec.child, (pid, signal) => {
      rec.kills.push([pid, signal]);
    });
    assert.deepEqual(result, { kind: 'group', pid: 4242 });
    assert.deepEqual(rec.kills, [[-4242, 'SIGKILL']]);
    assert.deepEqual(rec.childKills, []);
  });

  it('falls back to the shell alone when the group cannot be signalled', () => {
    const rec = fakeChild(4242);
    const result = stopPosixProcessGroup(rec.child, throwingKill);
    assert.equal(result.kind, 'child-only');
    assert.deepEqual(rec.childKills, ['SIGKILL']);
  });

  it('does nothing without a pid', () => {
    const rec = fakeChild(undefined);
    assert.deepEqual(
      stopPosixProcessGroup(rec.child, () => assert.fail('no kill without a pid')),
      { kind: 'no-pid' },
    );
    assert.deepEqual(rec.childKills, []);
  });
});

describe('the chat command (simulated platforms, not Linux evidence)', () => {
  it('is spawned exactly as before on Windows, and detached on Linux', () => {
    assert.deepEqual(chatCommandSpawnOptions('C:/work', 'win32'), {
      cwd: 'C:/work',
      shell: true,
      windowsHide: true,
    });
    assert.deepEqual(chatCommandSpawnOptions('/home/someone/work', 'linux'), {
      cwd: '/home/someone/work',
      shell: true,
      windowsHide: true,
      detached: true,
    });
  });

  it('is stopped on Windows with the same synchronous taskkill, logging a failure', () => {
    const calls: unknown[] = [];
    const logs: string[] = [];
    const rec = fakeChild(77);
    stopChatCommandTree(
      { pid: 77, kill: rec.child.kill },
      {
        platform: 'win32',
        spawnSync: (command, args, options) => {
          calls.push([command, args, options]);
          return { status: 128, stderr: '  not found \n' };
        },
        kill: () => assert.fail('no POSIX kill on Windows'),
        log: (message) => logs.push(message),
      },
    );
    assert.deepEqual(calls, [
      ['taskkill', ['/PID', '77', '/T', '/F'], { windowsHide: true, encoding: 'utf8' }],
    ]);
    assert.deepEqual(logs, ['taskkill exit=128 not found']);
    assert.deepEqual(rec.childKills, []);
  });

  it('logs nothing on Windows when taskkill succeeds', () => {
    const logs: string[] = [];
    stopChatCommandTree(
      { pid: 77, kill: () => true },
      {
        platform: 'win32',
        spawnSync: () => ({ status: 0, stderr: '' }),
        log: (message) => logs.push(message),
      },
    );
    assert.deepEqual(logs, []);
  });

  it('is stopped on Linux by its process group, and by the shell alone as a fallback', () => {
    const group = fakeChild(88);
    stopChatCommandTree(
      { pid: 88, kill: group.child.kill },
      {
        platform: 'linux',
        spawnSync: () => assert.fail('no taskkill on Linux'),
        kill: (pid, signal) => {
          group.kills.push([pid, signal]);
        },
        log: () => assert.fail('nothing to log when the group was signalled'),
      },
    );
    assert.deepEqual(group.kills, [[-88, 'SIGKILL']]);
    assert.deepEqual(group.childKills, []);

    const alone = fakeChild(89);
    const logs: string[] = [];
    stopChatCommandTree(
      { pid: 89, kill: alone.child.kill },
      {
        platform: 'linux',
        spawnSync: () => assert.fail('no taskkill on Linux'),
        kill: throwingKill,
        log: (message) => logs.push(message),
      },
    );
    assert.deepEqual(alone.childKills, ['SIGKILL']);
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? '', /process group 89 could not be signalled/);
  });
});

describe('the loop gate command (simulated platforms, not Linux evidence)', () => {
  it('is spawned exactly as before on Windows, and detached on Linux', () => {
    assert.deepEqual(gateCommandSpawnOptions('C:/work', 'win32'), {
      cwd: 'C:/work',
      shell: true,
      windowsHide: true,
      env: process.env,
    });
    const linux = gateCommandSpawnOptions('/home/someone/work', 'linux');
    assert.equal(linux.detached, true);
    assert.equal(linux.env, process.env);
    assert.equal(linux.shell, true);
  });

  it('is stopped on Windows with the same fire-and-forget taskkill', () => {
    const calls: unknown[] = [];
    const listened: string[] = [];
    const rec = fakeChild(55);
    killCommandTree(rec.child, {
      platform: 'win32',
      spawn: (command, args, options) => {
        calls.push([command, args, options]);
        return {
          on(event: 'error') {
            listened.push(event);
            return undefined;
          },
        };
      },
      kill: () => assert.fail('no POSIX kill on Windows'),
    });
    assert.deepEqual(calls, [
      ['taskkill', ['/PID', '55', '/T', '/F'], { windowsHide: true, stdio: 'ignore' }],
    ]);
    assert.deepEqual(listened, ['error']);
    assert.deepEqual(rec.childKills, []);
  });

  it('is stopped on Linux by its process group, and by the shell alone as a fallback', () => {
    const group = fakeChild(66);
    killCommandTree(group.child, {
      platform: 'linux',
      spawn: () => assert.fail('no taskkill on Linux'),
      kill: (pid, signal) => {
        group.kills.push([pid, signal]);
      },
    });
    assert.deepEqual(group.kills, [[-66, 'SIGKILL']]);
    assert.deepEqual(group.childKills, []);

    const alone = fakeChild(67);
    killCommandTree(alone.child, {
      platform: 'linux',
      spawn: () => assert.fail('no taskkill on Linux'),
      kill: throwingKill,
    });
    assert.deepEqual(alone.childKills, ['SIGKILL']);
  });
});
