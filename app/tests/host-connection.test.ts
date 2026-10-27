/**
 * The client's side of the process channel to the project host (DSP-111), against a
 * real separate process.
 *
 * The risks at a process boundary are not in any one method: a host that never starts,
 * one that stops while a call is waiting, and a client that sends the same work twice
 * because it did not hear back. Each test here runs a stand-in host
 * (`support/fake-host-process.mjs`) that records every call it received, so "nothing
 * was sent again" is read from what reached the other process, not from the client's
 * own bookkeeping. That the real host serves the product's methods is
 * `project-host-process.test.ts`.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/host-connection.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { HostCallError, HostConnection, type HostLoss } from '../src/main/host-connection.ts';
import { isHostCallFailure, type HostCallFailure, type HostEventTarget } from '../src/shared/host-protocol.ts';
import { forkHost, type ForkedHost } from './support/forked-host.ts';

const FAKE_HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'support', 'fake-host-process.mjs');

interface Harness {
  readonly connection: HostConnection;
  readonly spawned: ForkedHost[];
  readonly events: { to: HostEventTarget; channel: string; payload: unknown }[];
  readonly losses: HostLoss[];
  readonly callsFile: string;
  received(): readonly string[];
}

function harness(mode: string, startTimeoutMs = 10_000): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-host-connection-'));
  const callsFile = path.join(dir, 'calls.txt');
  const spawned: ForkedHost[] = [];
  const events: Harness['events'] = [];
  const losses: HostLoss[] = [];
  const connection = new HostConnection({
    spawn: () => {
      const child = forkHost(FAKE_HOST, { FAKE_HOST_MODE: mode, FAKE_HOST_CALLS: callsFile }, false);
      spawned.push(child);
      return child;
    },
    startTimeoutMs,
    onEvent: (to, channel, payload) => {
      events.push({ to, channel, payload });
    },
    onLost: (loss) => {
      losses.push(loss);
    },
    log: () => undefined,
  });
  return {
    connection,
    spawned,
    events,
    losses,
    callsFile,
    received: () => (fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').split('\n').filter((line) => line !== '') : []),
  };
}

async function endAll(h: Harness): Promise<void> {
  for (const child of h.spawned) {
    if (child.child.exitCode === null && child.child.signalCode === null) {
      child.kill();
    }
    await child.exited;
  }
}

describe('a host that starts', () => {
  it('waits for the host to say it is ready, then answers each call once with its value', async () => {
    const h = harness('serve');
    try {
      // Called before start has finished: held until the host is ready, not refused.
      const startedFirst = h.connection.start();
      const early = h.connection.call<{ method: string; args: unknown[] }>('echo', { senderId: 7 }, 'a');
      const started = await startedFirst;
      assert.equal(started.ok, true);
      assert.equal(h.connection.state(), 'ready');
      assert.deepEqual(await early, { method: 'echo', args: [{ senderId: 7 }, 'a'] });
      assert.deepEqual(h.received(), ['echo']);
    } finally {
      await endAll(h);
    }
  });

  it("gives a method's own error to the caller as an Error with the method's words", async () => {
    const h = harness('serve');
    try {
      await h.connection.start();
      await assert.rejects(h.connection.call('throw'), (error: unknown) => {
        assert.ok(error instanceof HostCallError);
        assert.equal(error.message, 'the method said no');
        assert.equal(error.failure.code, 'failed');
        return true;
      });
      // `answer` gives the same failure as a value, for contracts that answer errors.
      const answered = await h.connection.answer('throw');
      assert.ok(isHostCallFailure(answered));
    } finally {
      await endAll(h);
    }
  });

  it('delivers events to the audience the host names', async () => {
    const h = harness('serve');
    try {
      await h.connection.start();
      await h.connection.call('emit', 'payload');
      assert.deepEqual(h.events, [{ to: { kind: 'every-window' }, channel: 'test:event', payload: ['payload'] }]);
    } finally {
      await endAll(h);
    }
  });
});

describe('a host that stops while work is waiting', () => {
  it('answers the waiting call as unknown, says the host was lost, and sends nothing again', async () => {
    const h = harness('serve');
    try {
      await h.connection.start();
      const waiting = h.connection.answer('hang', 'the work');
      // Another call makes the host exit while `hang` is still unanswered.
      const dying = h.connection.answer('die');
      const [hung, died] = (await Promise.all([waiting, dying])) as [HostCallFailure, HostCallFailure];
      for (const failure of [hung, died]) {
        assert.equal(failure.code, 'host-lost');
        assert.match(failure.message, /Whether that was done is unknown, and nothing was sent again\./);
      }
      assert.equal(h.connection.state(), 'lost');
      assert.equal(h.losses.length, 1, 'the owner is told once');
      assert.deepEqual([...(h.losses[0]?.unanswered ?? [])].sort(), ['die', 'hang']);
      assert.equal(h.losses[0]?.exitCode, 3);

      // A call after the loss is refused here, never reaches any process, and says it was
      // not done rather than unknown.
      const after = (await h.connection.answer('echo')) as HostCallFailure;
      assert.equal(after.code, 'host-unavailable');
      assert.match(after.message, /has stopped \(exit code 3\)\..*"echo" was not done\./);
      assert.deepEqual(h.received(), ['hang', 'die'], 'each call reached the host once, and nothing was resent');
    } finally {
      await endAll(h);
    }
  });

  it('can be started again after a loss, and the new host gets only new calls', async () => {
    const h = harness('serve');
    try {
      await h.connection.start();
      await h.connection.answer('die');
      assert.equal(h.connection.state(), 'lost');
      const again = await h.connection.start();
      assert.equal(again.ok, true);
      assert.equal(h.spawned.length, 2);
      await h.connection.call('echo');
      assert.deepEqual(h.received(), ['die', 'echo'], 'the lost call was not replayed on the new host');
    } finally {
      await endAll(h);
    }
  });
});

describe('a host that does not start', () => {
  it('says the host stopped while starting, with what it wrote, and refuses calls without sending them', async () => {
    const h = harness('crash-at-start');
    try {
      const started = await h.connection.start();
      assert.equal(started.ok, false);
      if (started.ok) {
        return;
      }
      assert.equal(started.failure.code, 'host-unavailable');
      assert.match(started.failure.message, /stopped while starting \(exit code 4\), so no project can be opened/);
      assert.match(started.failure.detail ?? '', /cannot open its data/);
      const refused = (await h.connection.answer('echo')) as HostCallFailure;
      assert.equal(refused.code, 'host-unavailable');
      assert.equal(h.losses.length, 0, 'a failed start is not reported as a loss as well');
    } finally {
      await endAll(h);
    }
  });

  it('gives up on a host that never says it is ready, and ends it', async () => {
    const h = harness('never-ready', 1_500);
    try {
      const started = await h.connection.start();
      assert.equal(started.ok, false);
      if (started.ok) {
        return;
      }
      assert.match(started.failure.message, /did not start within 2 seconds/);
      const code = await h.spawned[0]?.exited;
      assert.notEqual(h.spawned[0]?.child.exitCode === null && h.spawned[0]?.child.signalCode === null, true, `the process ended (${String(code)})`);
      assert.equal(h.losses.length, 0);
    } finally {
      await endAll(h);
    }
  });
});

describe('closing', () => {
  it('ends a host that does not answer its shutdown within the bound', async () => {
    const h = harness('serve');
    try {
      await h.connection.start();
      // `hang` never answers, so the bound is what ends it.
      const answer = await h.connection.shutdown('hang', [], 500);
      assert.equal(answer, null);
      await h.spawned[0]?.exited;
      assert.equal(h.connection.state(), 'stopped');
      assert.equal(h.losses.length, 0, 'a host ended by the shutdown is not reported as lost');
    } finally {
      await endAll(h);
    }
  });
});
