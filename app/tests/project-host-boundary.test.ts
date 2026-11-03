/**
 * Where the project host ends and the client begins (DSP-111), read from the source.
 *
 * The host process (`host/host-process.ts`) holds the project's work: repository
 * access, git, the agent connections, loop runs and the durable data. It must reach no
 * Electron and nothing of the renderer, however deep its imports go, because it is a
 * plain Node process today and will have to run where no window is.
 *
 * The client (`main/main.ts` and the review window files) holds the windows. What it
 * loads at run time must not include the services that do the work or the provider
 * SDKs: if it did, a project's work could quietly happen in the client again, beside
 * the host, and the separation would hold only for whichever path someone remembered.
 * `import type` is allowed; it loads nothing.
 *
 * That the separate process actually serves the work is `project-host-process.test.ts`
 * and the scripted window runs; this says what the files can reach.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/project-host-boundary.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { reach, src } from './support/import-graph.ts';

const electronLike = (name: string): boolean =>
  name === 'electron' || name.startsWith('electron/') || name.startsWith('@electron/');

test('the project host process reaches no Electron and nothing under renderer/', () => {
  const { files, packages } = reach([path.join(src, 'host', 'host-process.ts')]);
  // The walk reached the services it is meant to hold: a walk that stopped early would prove nothing.
  for (const service of ['chat-service.ts', 'conversation-store.ts', 'run-record-store.ts', 'loop-live-run.ts', 'review-discussion-service.ts']) {
    assert.ok(files.has(path.join(src, 'main', service)), `the host reaches ${service}`);
  }
  assert.ok(files.has(path.join(src, 'host', 'review-host.ts')), 'the host reaches the review host');
  const electron = [...packages.keys()].filter(electronLike);
  assert.deepEqual(
    electron.map((name) => `${name} (from ${packages.get(name) ?? '?'})`),
    [],
    'the project host must not import Electron',
  );
  const renderer = [...files].filter((file) => path.relative(src, file).split(path.sep)[0] === 'renderer');
  assert.deepEqual(renderer.map((file) => path.relative(src, file)), [], 'the project host must not import the renderer');
});

test("the client loads none of the project's services and no provider SDK", () => {
  const { files, packages } = reach([path.join(src, 'main', 'main.ts')], true);
  const relative = new Set([...files].map((file) => path.relative(src, file).split(path.sep).join('/')));
  // The client's own files: the windows, the connection to the host and the launch mode.
  assert.ok(relative.has('main/host-connection.ts'));
  assert.ok(relative.has('main/review-windows.ts'));
  const services = [
    'main/chat-service.ts',
    'main/conversation-store.ts',
    'main/project-store.ts',
    'main/run-record-store.ts',
    'main/loop-live.ts',
    'main/loop-live-run.ts',
    'main/loop-control-runtime.ts',
    'main/review-service.ts',
    'main/review-discussion-service.ts',
    'main/workspace-command.ts',
    'main/git-state.ts',
    'main/provider-adapters.ts',
    'main/presentation-adapter.ts',
    'main/probe-cursor.ts',
    'host/project-host.ts',
    'host/review-host.ts',
    'host/local-review-host.ts',
  ];
  assert.deepEqual(
    services.filter((service) => relative.has(service)),
    [],
    'the client must reach the project host only through the process channel',
  );
  // And what it may load at all, so a service added later is caught too: its own files,
  // and the plain data shapes in shared/.
  const clientFiles = new Set([
    'main/main.ts',
    'main/host-connection.ts',
    'main/host-data.ts',
    'main/local-host.ts',
    'main/remote-link.ts',
    'main/remote-session.ts',
    'main/host-packages.ts',
    'main/ssh-connection.ts',
    'main/launch-mode.ts',
    // The isolated-profile guard (DSP-165.1) and each window's zoom (DSP-167): the client's own.
    'main/profile-guard.ts',
    'main/window-zoom.ts',
    'main/own-repository.ts',
    'main/probe-exit.ts',
    'main/review-ipc.ts',
    'main/review-windows.ts',
  ]);
  assert.deepEqual(
    [...relative].filter((file) => !clientFiles.has(file) && !file.startsWith('shared/')),
    [],
    'the client loads only its own files and shared data shapes',
  );
  assert.deepEqual(
    [...relative].filter((file) => file.startsWith('adapter/')),
    [],
    'no provider adapter is loaded by the client',
  );
  const providerSdks = [...packages.keys()].filter(
    (name) => name.startsWith('@cursor/') || name.startsWith('@anthropic-ai/') || name.startsWith('@github/'),
  );
  assert.deepEqual(providerSdks, [], 'no provider SDK is loaded by the client');
});
