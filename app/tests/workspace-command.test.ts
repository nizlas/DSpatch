/**
 * DSpatch's one command runner (DSP-145): real commands, really spawned, in scratch
 * folders this file creates. What the gate already had is covered where it always was
 * (`loop-live.test.ts`, `gate-command-reality.test.ts`, `process-tree.test.ts`); this
 * covers what the move added - the stop on request, the output bound and the snapshots.
 * The agent's own commands are not run here since DSP-146 (Claude Code's shell tool runs
 * them; `claude-shell-commands.test.ts`).
 *
 *     node scripts/run-tests.mjs live        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { runWorkspaceCommand, snapshotOfFolders } from '../src/main/workspace-command.ts';
import { killLeftovers, sleepingTreeCommand, treePids, waitGone } from './support/command-tree.ts';
import { tempRoot } from './support/fixtures.ts';

const node = `"${process.execPath}"`;

function folder(name: string): string {
  const root = tempRoot(`wscmd-${name}`);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n', 'utf8');
  return root;
}

describe('runWorkspaceCommand', () => {
  it('records an exit code, the output and the code it ran against, without calling a failure an error', async () => {
    const root = folder('exit');
    const record = await runWorkspaceCommand({
      line: `${node} -e "console.log('out'); console.error('err'); process.exit(3)"`,
      cwd: root,
      requestedBy: 'gate',
      timeoutMs: 30_000,
      snapshotFolders: [root],
    });
    assert.equal(record.exitCode, 3);
    assert.equal(record.notRun, null, 'a command that ran and failed is not "could not start"');
    assert.equal(record.verdict, 'failed');
    assert.equal(record.requestedBy, 'gate');
    assert.match(record.stdout, /out/);
    assert.match(record.stderr, /err/);
    assert.equal(record.killedByDspatch, false);
    assert.ok(record.testedSnapshotId !== null, 'the folder was readable, so it was observed');
    assert.equal(record.afterRunSnapshotId, record.testedSnapshotId, 'nothing changed while it ran');
    assert.deepEqual(record.snapshotFolders, [root]);
  });

  it('a command that writes into its working copy leaves a different after-run snapshot', async () => {
    const root = folder('writes');
    const record = await runWorkspaceCommand({
      line: `${node} -e "require('fs').writeFileSync('b.txt', 'b')"`,
      cwd: root,
      requestedBy: 'gate',
      timeoutMs: 30_000,
      snapshotFolders: [root],
    });
    assert.equal(record.exitCode, 0);
    assert.notEqual(record.afterRunSnapshotId, record.testedSnapshotId);
  });

  it('keeps the end of a long output and says how much was left out', async () => {
    const root = folder('bound');
    const record = await runWorkspaceCommand({
      line: `${node} -e "process.stdout.write('x'.repeat(5000) + 'THE-END')"`,
      cwd: root,
      requestedBy: 'gate',
      timeoutMs: 30_000,
      maxOutputChars: 100,
    });
    assert.equal(record.stdout.length, 100);
    assert.ok(record.stdout.endsWith('THE-END'), 'the end, where a test summary is, is kept');
    assert.equal(record.outputTruncated, true);
    assert.match(record.outputNote ?? '', /the first 4907 characters of standard output were left out/);
  });

  it('never reads an unobservable folder as unchanged', async () => {
    const root = folder('unobserved');
    const record = await runWorkspaceCommand({
      line: `${node} -e "0"`,
      cwd: root,
      requestedBy: 'gate',
      timeoutMs: 30_000,
      snapshotFolders: [root],
      snapshotId: () => {
        throw new Error('unreadable');
      },
    });
    assert.equal(record.exitCode, 0);
    assert.equal(record.testedSnapshotId, null);
    assert.equal(record.afterRunSnapshotId, null);
    assert.equal(snapshotOfFolders([]), null, 'no folder named is not observed either');
    const two = snapshotOfFolders([root, folder('second')]);
    assert.match(two ?? '', /^folders-/, 'several folders give one identity over all of them');
  });

  it('stops the command and its child process when asked, and says DSpatch stopped it', async () => {
    const root = folder('abort');
    const controller = new AbortController();
    const running = runWorkspaceCommand({
      line: sleepingTreeCommand(root),
      cwd: root,
      requestedBy: 'gate',
      timeoutMs: 60_000,
      signal: controller.signal,
      snapshotFolders: [root],
    });
    const pids = await treePids(root);
    try {
      controller.abort('the test asked it to stop');
      const record = await running;
      assert.equal(record.killedByDspatch, true);
      assert.equal(record.stoppedBy, 'cancel');
      assert.equal(record.verdict, 'interrupted');
      assert.equal(record.exitCode, null, 'a stopped command has no exit code of its own');
      assert.equal(record.notRun?.kind, 'did-not-finish');
      assert.match(record.notRun?.message ?? '', /because the test asked it to stop/);
      assert.match(record.notRun?.message ?? '', /not a test failure and not a pass/);
      // The record settles when the stop is requested; the processes go a moment later.
      const living = await waitGone([pids.parent, pids.child]);
      assert.deepEqual(living, [], 'both the command and the child it started are gone');
    } finally {
      killLeftovers([pids.parent, pids.child]);
    }
  });
});
