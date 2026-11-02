/**
 * The real project host process (DSP-111): `src/host/host-process.ts`, started as a
 * separate Node process the way the application starts it with Electron's
 * `utilityProcess`, reached only over the process channel through the client's own
 * `HostConnection`.
 *
 * What is checked is what the process boundary itself can break: that the host starts
 * from nothing but its start configuration, keeps DSpatch's data where the client says,
 * answers the product's methods with their own words, sends its events to an audience,
 * keeps what it saved across a restart, closes when asked, and does not go on working
 * when the client is gone. No provider is reached: nothing here opens a session.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/project-host-process.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { HostConnection } from '../src/main/host-connection.ts';
import {
  HOST_CONFIG_ENV,
  type HostEventTarget,
  type HostShutdownAnswer,
  type HostStartConfig,
} from '../src/shared/host-protocol.ts';
import type { ChatSessionInfo, RecentWorkspaces, WorkspaceOpenOutcome } from '../src/shared/bridge.ts';
import type { WorkspaceView } from '../src/shared/workspace-folders.ts';
import { forkHost, type ForkedHost } from './support/forked-host.ts';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST_ENTRY = path.join(appRoot, 'src', 'host', 'host-process.ts');
const NO_SENDER = { senderId: null };

interface Started {
  readonly connection: HostConnection;
  readonly child: ForkedHost;
  readonly events: { to: HostEventTarget; channel: string; payload: unknown }[];
}

async function startHost(config: HostStartConfig): Promise<Started> {
  let child: ForkedHost | null = null;
  const events: Started['events'] = [];
  const connection = new HostConnection({
    spawn: () => {
      child = forkHost(HOST_ENTRY, { [HOST_CONFIG_ENV]: JSON.stringify(config) }, true);
      return child;
    },
    // Loading the services from TypeScript sources is slower than the built host.
    startTimeoutMs: 60_000,
    onEvent: (to, channel, payload) => {
      events.push({ to, channel, payload });
    },
    onLost: () => undefined,
    log: () => undefined,
  });
  const started = await connection.start();
  assert.ok(child !== null);
  assert.equal(started.ok, true, `the host started: ${started.ok ? '' : started.failure.message} ${String(child)}`);
  return { connection, child, events };
}

function freshConfig(): HostStartConfig {
  return {
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-host-userdata-')),
    appVersion: '0.0.0-test',
    appPath: appRoot,
    clientPid: process.pid,
  };
}

async function closeHost(started: Started, observeConversationFiles = false): Promise<HostShutdownAnswer | null> {
  const answer = (await started.connection.shutdown(
    'host.shutdown',
    [NO_SENDER, { observeConversationFiles }],
    15_000,
  )) as HostShutdownAnswer | null;
  await started.child.exited;
  return answer;
}

describe('the project host process', () => {
  it('allows host handover with a ready loop drawing and no running work', async () => {
    const scratch = path.resolve(appRoot, '..', 'tmp');
    fs.mkdirSync(scratch, { recursive: true });
    const userDataDir = fs.mkdtempSync(path.join(scratch, 'host-ready-handover-'));
    let host: Started | null = null;
    try {
      host = await startHost({
        userDataDir,
        appVersion: '0.0.0-test',
        appPath: appRoot,
        clientPid: process.pid,
      });
      assert.equal(await host.connection.call('host.busy', NO_SENDER), null);
      const prepared = await host.connection.call<{ kind: string; run?: { phase: string } }>(
        'loop.prepareChatLoop', NO_SENDER, true, null,
      );
      assert.equal(prepared.kind, 'shown', JSON.stringify(prepared));
      assert.equal(prepared.run?.phase, 'ready');
      assert.equal(await host.connection.call('host.busy', NO_SENDER), null);
      await host.connection.call('loop.prepareChatLoop', NO_SENDER, false, null);
      assert.equal(await host.connection.call('host.busy', NO_SENDER), null);
    } finally {
      if (host !== null) {
        await closeHost(host);
      }
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('serves the product methods from its own process, with their own words, and keeps data where it is told', async () => {
    const config = freshConfig();
    const host = await startHost(config);
    try {
      assert.notEqual(host.child.pid(), process.pid, 'a separate process');
      const listing = await host.connection.call<RecentWorkspaces>('workspaces.recent', NO_SENDER);
      assert.deepEqual(listing.entries, [], 'a fresh data directory has nothing in Recent');
      assert.equal(listing.looseConversationId, null);

      // A method's own refusal reaches the caller with its own sentence, as over Electron's IPC.
      await assert.rejects(host.connection.call('chat.chooseAgent', NO_SENDER, 'not-an-agent'), /^Error: Unknown agent\.$|Unknown agent\./);
      // A method the host does not have is said as such, not hung on.
      await assert.rejects(host.connection.call('no.such.method', NO_SENDER), /has no method "no\.such\.method"/);
    } finally {
      // The after-close reading a scripted run asks for: read by the host after its close.
      const closed = await closeHost(host, true);
      assert.equal(closed?.completed, true);
      assert.ok(Array.isArray(closed?.conversationFiles), 'the conversation files were read after the close');
      assert.equal(await host.child.exited, 0);
    }
  });

  it('opens a workspace, adds a folder to it, and has its name, folders and Recent entry after a restart (DSP-149)', async () => {
    const config = freshConfig();
    const first = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-host-first-'));
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-host-second-'));
    const workspaceFile = path.join(config.userDataDir, 'saved.dspatch-workspace.json');
    const one = await startHost(config);
    let workspaceId: string | null = null;
    try {
      // Open Project: the workspace of a first folder, created with its name. No agent is
      // chosen in a fresh data directory, so the conversation opens with no provider session.
      const opened = await one.connection.call<WorkspaceOpenOutcome>('workspaces.open', NO_SENDER, { folder: first });
      assert.equal(opened.kind, 'opened');
      if (opened.kind !== 'opened') {
        return;
      }
      workspaceId = opened.workspace.id;
      assert.equal(opened.workspace.name, path.basename(first));
      assert.equal(opened.session.provider, null, 'no provider is assumed');

      const added = await one.connection.call<WorkspaceView>('workspace.addFolder', NO_SENDER, second);
      assert.deepEqual(
        added.folders.map((entry) => path.resolve(entry.path)),
        [path.resolve(first), path.resolve(second)],
      );
      assert.equal(added.folders[0]?.working, true, 'the first folder stays where commands start');
      const announced = one.events.filter((event) => event.channel === 'dspatch:workspace-folders-changed');
      assert.ok(announced.length >= 1);
      assert.deepEqual(announced.at(-1)?.to, { kind: 'every-window' });
      const saved = await one.connection.call<WorkspaceView>('workspace.saveFile', NO_SENDER, workspaceFile);
      assert.equal(saved.filePath, path.resolve(workspaceFile));
    } finally {
      await closeHost(one);
    }

    // A new host over the same data: the workspace is in Recent with both folders, and
    // opening it gives the session every folder again.
    const two = await startHost(config);
    try {
      const recent = await two.connection.call<RecentWorkspaces>('workspaces.recent', NO_SENDER);
      const entry = recent.entries.find((candidate) => candidate.id === workspaceId);
      assert.ok(entry !== undefined, 'the workspace is in Recent after a restart');
      assert.equal(recent.entries.length, 1, 'one entry for a workspace of two folders');
      assert.deepEqual(entry.folders.map((folder) => path.resolve(folder)), [path.resolve(first), path.resolve(second)]);
      const reopened = await two.connection.call<WorkspaceOpenOutcome>('workspaces.open', NO_SENDER, { workspaceId });
      assert.equal(reopened.kind, 'opened');
      if (reopened.kind === 'opened') {
        assert.equal(reopened.workspace.folders.length, 2);
        assert.equal(reopened.workspace.filePath, path.resolve(workspaceFile));
      }

      // Remove from recent drops the entry and nothing else: the folders are there, and
      // opening the first folder again brings the same workspace back with its folders.
      const removed = await two.connection.call<RecentWorkspaces>('workspaces.removeFromRecent', NO_SENDER, [workspaceId]);
      assert.equal(removed.entries.length, 0);
      assert.ok(fs.existsSync(first) && fs.existsSync(second));
      // Nothing in the background brings it back (DSP-149): a conversation started, the
      // list read again.
      await two.connection.call<ChatSessionInfo>('chat.startSession', NO_SENDER, { kind: 'loose' });
      const stillRemoved = await two.connection.call<RecentWorkspaces>('workspaces.recent', NO_SENDER);
      assert.equal(stillRemoved.entries.length, 0, 'a removed entry did not come back on its own');
      const back = await two.connection.call<WorkspaceOpenOutcome>('workspaces.open', NO_SENDER, { folder: first });
      assert.equal(back.kind === 'opened' ? back.workspace.id : null, workspaceId);
      assert.equal(back.kind === 'opened' ? back.workspace.folders.length : 0, 2);

      // A conversation with no workspace never works in the process's own folder.
      const loose = await two.connection.call<ChatSessionInfo>('chat.startSession', NO_SENDER, { kind: 'loose' });
      assert.equal(loose.origin, 'no-workspace');
      assert.equal(path.dirname(loose.workspacePath), config.userDataDir);
      assert.notEqual(path.resolve(loose.workspacePath), path.resolve(process.cwd()));

      // A primary that has gone is refused when someone tries to open it, with the reason.
      const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-host-gone-'));
      fs.rmSync(gone, { recursive: true, force: true });
      const refused = await two.connection.call<WorkspaceOpenOutcome>('workspaces.open', NO_SENDER, { folder: gone });
      assert.equal(refused.kind, 'refused');
      assert.match(refused.kind === 'refused' ? refused.problem : '', /There is no folder at/);
    } finally {
      await closeHost(two);
    }
  });

  it('closes its adapters and ends by itself when the client process is gone', async () => {
    // A stand-in client: a process that lives until it is ended.
    const client = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    assert.ok(client.pid !== undefined);
    try {
      const config = { ...freshConfig(), clientPid: client.pid };
      const host = await startHost(config);
      const startedAt = Date.now();
      client.kill();
      const code = await host.child.exited;
      assert.equal(code, 0, `the host ended in an orderly way: ${String(host.child)}`);
      assert.ok(Date.now() - startedAt < 20_000, 'within the check interval and the close');
      assert.match(String(host.child), /the client process \d+ is gone; closing the adapters and ending/);
    } finally {
      client.kill();
    }
  });
});
