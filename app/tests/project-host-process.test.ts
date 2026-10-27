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
import type { ProjectListing } from '../src/shared/bridge.ts';
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
  it('serves the product methods from its own process, with their own words, and keeps data where it is told', async () => {
    const config = freshConfig();
    const host = await startHost(config);
    try {
      assert.notEqual(host.child.pid(), process.pid, 'a separate process');
      const listing = await host.connection.call<ProjectListing>('projects.list', NO_SENDER);
      assert.equal(path.dirname(listing.storePath), config.userDataDir, 'the project store is under the data directory the client named');
      assert.deepEqual(listing.entries, []);

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

  it('sends a change of the workspace to every window, and keeps a saved workspace across a restart', async () => {
    const config = freshConfig();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-host-folder-'));
    const workspaceFile = path.join(config.userDataDir, 'saved.dspatch-workspace.json');
    const first = await startHost(config);
    try {
      const added = await first.connection.call<WorkspaceView>('workspace.addFolder', NO_SENDER, folder);
      assert.ok(added.folders.some((entry) => path.resolve(entry.path) === path.resolve(folder)));
      const announced = first.events.filter((event) => event.channel === 'dspatch:workspace-folders-changed');
      assert.equal(announced.length, 1);
      assert.deepEqual(announced[0]?.to, { kind: 'every-window' });
      const saved = await first.connection.call<WorkspaceView>('workspace.saveFile', NO_SENDER, workspaceFile);
      assert.equal(saved.filePath, path.resolve(workspaceFile));
    } finally {
      await closeHost(first);
    }

    // A new host over the same data reopens the saved workspace by itself (DSP-71).
    const second = await startHost(config);
    try {
      const view = await second.connection.call<WorkspaceView>('workspace.view', NO_SENDER);
      assert.equal(view.filePath, path.resolve(workspaceFile));
      assert.ok(view.folders.some((entry) => path.resolve(entry.path) === path.resolve(folder)));
    } finally {
      await closeHost(second);
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
