import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';

import { serveHost, type HostMethods } from '../src/host/host-server.ts';
import { RemoteServer } from '../src/host/remote-server.ts';
import { HostConnection, type HostLinkEvent } from '../src/main/host-connection.ts';
import { RemoteLink } from '../src/main/remote-link.ts';
import { parseRemoteAddress } from '../src/main/remote-session.ts';
import { decodeFrame, encodeFrame, type RemoteBuild } from '../src/shared/remote-protocol.ts';
import { isHostCallFailure } from '../src/shared/host-protocol.ts';

/*
 * The transport over real TCP between two ends in one process (DSP-111), with a forwarder
 * standing where the SSH tunnel stands so a connection can really be cut. The two-process
 * trial with windows is `docs/REMOTE_TRIAL.md`; this pins the rules: nothing done twice, nothing
 * sent again, answers recovered, and an unknown never read as an outcome.
 */

const BUILD: RemoteBuild = { protocol: 1, contract: 'c', appVersion: '1', commit: 'a' };
const TOKEN = 'token';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(what: string, ready: () => boolean): Promise<void> {
  const end = Date.now() + 8_000;
  while (!ready()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await wait(10);
  }
}

/** Stands where the SSH tunnel stands: `cut()` drops every connection through it. */
class Tunnel {
  private readonly sockets = new Set<net.Socket>();
  private readonly server: net.Server;
  private up = true;
  target = 0;
  port = 0;

  constructor(target: number) {
    this.target = target;
    this.server = net.createServer((inbound) => {
      if (!this.up) {
        inbound.destroy();
        return;
      }
      const outbound = net.connect({ host: '127.0.0.1', port: this.target });
      this.sockets.add(inbound);
      this.sockets.add(outbound);
      inbound.pipe(outbound);
      outbound.pipe(inbound);
      for (const socket of [inbound, outbound]) {
        socket.on('error', () => undefined);
        socket.on('close', () => {
          inbound.destroy();
          outbound.destroy();
        });
      }
    });
  }

  async listen(): Promise<this> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  cut(): void {
    this.up = false;
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
  }

  mend(): void {
    this.up = true;
  }

  close(): void {
    this.cut();
    this.server.close();
  }
}

interface Rig {
  readonly connection: HostConnection;
  readonly events: unknown[];
  readonly links: HostLinkEvent[];
  readonly lost: number[];
  readonly done: string[];
  readonly server: RemoteServer;
  readonly tunnel: Tunnel;
  release: () => void;
  releaseSecond: () => void;
}

const open: (() => void)[] = [];

async function rig(token = TOKEN, build = BUILD, serverBuild = BUILD): Promise<Rig> {
  const done: string[] = [];
  const server = new RemoteServer({ token: TOKEN, build: serverBuild, closeWithinMs: 100, log: () => undefined });
  const state: Rig = { connection: null as unknown as HostConnection, events: [], links: [], lost: [], done, server, tunnel: null as unknown as Tunnel, release: () => undefined, releaseSecond: () => undefined };
  const methods = {
    work: (name: string) => {
      done.push(name);
      return `did ${name}`;
    },
    slow: async (name: string) => {
      done.push(name);
      await new Promise<void>((resolve) => {
        state.release = resolve;
      });
      server.port.post({ t: 'event', to: { kind: 'every-window' }, channel: 'progress', payload: `${name} finished` });
      return `did ${name}`;
    },
    slow2: async (name: string) => {
      await new Promise<void>((resolve) => {
        state.releaseSecond = resolve;
      });
      return `second did ${name}`;
    },
  };
  serveHost(server.port, methods as unknown as HostMethods, () => undefined);
  const port = await server.listen(0);
  const tunnel = await new Tunnel(port).listen();
  const connection = new HostConnection({
    spawn: () => new RemoteLink({ endpoint: { host: '127.0.0.1', port: tunnel.port, token }, build, log: () => undefined, retryMaxMs: 100 }),
    startTimeoutMs: 4_000,
    onEvent: (_to, _channel, payload) => {
      state.events.push(payload);
    },
    onLost: (loss) => {
      state.lost.push(loss.unanswered.length);
    },
    onLink: (event) => {
      state.links.push(event);
    },
    log: () => undefined,
  });
  open.push(() => {
    tunnel.close();
    server.close();
  });
  return { ...state, connection, tunnel, get release() { return state.release; }, set release(value) { state.release = value; }, get releaseSecond() { return state.releaseSecond; }, set releaseSecond(value) { state.releaseSecond = value; } };
}

describe('the remote transport', () => {
  after(() => {
    for (const close of open) {
      close();
    }
  });

  it('carries file bytes and left-out arguments as structured clone does', () => {
    const bytes = new Uint8Array([0, 255, 10]);
    const round = decodeFrame(encodeFrame({ bytes, buffer: Buffer.from([1, 2]), list: [undefined, 1], kept: undefined }).trim()) as Record<string, unknown>;
    assert.deepEqual([...(round['bytes'] as Uint8Array)], [0, 255, 10]);
    assert.deepEqual([...(round['buffer'] as Uint8Array)], [1, 2]);
    assert.equal((round['list'] as unknown[])[0], undefined);
  });

  it('only a loopback address is accepted: a host is reached through a tunnel', () => {
    assert.deepEqual(parseRemoteAddress('127.0.0.1:7000'), { host: '127.0.0.1', port: 7000 });
    assert.deepEqual(parseRemoteAddress('7000'), { host: '127.0.0.1', port: 7000 });
    assert.ok('error' in parseRemoteAddress('10.0.0.5:7000'));
    assert.ok('error' in parseRemoteAddress('work-pc:7000'));
  });

  it('a call goes over the connection and is answered', async () => {
    const r = await rig();
    assert.equal((await r.connection.start()).ok, true);
    assert.equal(await r.connection.call('work', 'a'), 'did a');
    assert.deepEqual(r.done, ['a']);
  });

  it('the wrong token gets no service, and the client proves nothing to a host without it', async () => {
    const r = await rig('wrong');
    const started = await r.connection.start();
    assert.equal(started.ok, false);
    assert.match(started.ok ? '' : (started.failure.detail ?? ''), /does not hold this token/);
    assert.deepEqual(r.done, []);
  });

  it('builds that do not match are refused in a sentence, before anything else', async () => {
    const r = await rig(TOKEN, { ...BUILD, protocol: 2 });
    const started = await r.connection.start();
    assert.equal(started.ok, false);
    assert.match(started.ok ? '' : (started.failure.detail ?? ''), /different versions of DSpatch's protocol/);
    const other = await rig(TOKEN, { ...BUILD, contract: 'other' });
    const second = await other.connection.start();
    assert.match(second.ok ? '' : (second.failure.detail ?? ''), /built from different sources/);
  });

  it('work goes on through a drop: its answer and events arrive after reconnecting, once, and nothing is resent', async () => {
    const r = await rig();
    await r.connection.start();
    const answer = r.connection.call('slow', 'job');
    await until('the job to start', () => r.done.includes('job'));
    r.tunnel.cut();
    await until('the drop', () => r.links.some((event) => event.kind === 'disconnected'));

    // While down: nothing is sent, and the call says so at once.
    const refused = await r.connection.answer('work', 'during');
    assert.ok(isHostCallFailure(refused));
    assert.match(refused.message, /was not sent/);

    r.release();
    await wait(50);
    r.tunnel.mend();
    assert.equal(await answer, 'did job');
    assert.deepEqual(r.events, ['job finished']);
    assert.deepEqual(r.done, ['job'], 'done once, and the refused call not at all');
    assert.deepEqual(r.lost, [], 'a drop is not a lost host');
  });

  it('a call that never reached the host is said to be not done, and is not resent', async () => {
    const r = await rig();
    await r.connection.start();
    assert.equal(await r.connection.call('work', 'first'), 'did first');
    // Written into a connection that is already gone: the host never reads it.
    const link = r.tunnel;
    link.cut();
    const lost = r.connection.answer('work', 'lost');
    await until('the drop', () => r.links.some((event) => event.kind === 'disconnected'));
    link.mend();
    const outcome = await lost;
    assert.ok(isHostCallFailure(outcome));
    assert.deepEqual(r.done, ['first']);
  });

  it('a second client takes over, and the first is told and does not fight back', async () => {
    const r = await rig();
    await r.connection.start();
    const second = new HostConnection({
      spawn: () => new RemoteLink({ endpoint: { host: '127.0.0.1', port: r.tunnel.port, token: TOKEN }, build: BUILD, log: () => undefined }),
      startTimeoutMs: 4_000,
      onEvent: () => undefined,
      onLost: () => undefined,
      log: () => undefined,
    });
    assert.equal((await second.start()).ok, true);
    await until('the first to be told', () => r.links.some((event) => event.kind === 'refused'));
    assert.equal(await second.call('work', 'mine'), 'did mine');
    const old = await r.connection.answer('work', 'old');
    assert.ok(isHostCallFailure(old));
    assert.deepEqual(r.done, ['mine']);
    await second.shutdown('host.shutdown', [{}], 500);
  });

  it('a restarted host is a lost host: calls read as unknown, none is resent', async () => {
    const r = await rig();
    await r.connection.start();
    const answer = r.connection.answer('slow', 'job');
    await until('the job to start', () => r.done.includes('job'));
    // Another process on the same port: another instance.
    r.server.close();
    const restarted: string[] = [];
    const next = new RemoteServer({ token: TOKEN, build: BUILD, closeWithinMs: 100, log: () => undefined });
    serveHost(next.port, { work: (name: string) => restarted.push(name) } as unknown as HostMethods, () => undefined);
    const port = await next.listen(0);
    open.push(() => {
      next.close();
    });
    r.tunnel.target = port;
    r.tunnel.cut();
    r.tunnel.mend();
    const outcome = await answer;
    assert.ok(isHostCallFailure(outcome));
    assert.equal(outcome.code, 'host-lost');
    assert.match(outcome.message, /unknown/);
    assert.deepEqual(restarted, []);
    assert.deepEqual(r.lost, [1]);
  });

  it("the answer to a client that has gone never reaches the next one, whose ids start again", async () => {
    const r = await rig();
    await r.connection.start();
    void r.connection.answer('slow', 'old job');
    await until('the job to start', () => r.done.includes('old job'));
    const second = new HostConnection({
      spawn: () => new RemoteLink({ endpoint: { host: '127.0.0.1', port: r.tunnel.port, token: TOKEN }, build: BUILD, log: () => undefined }),
      startTimeoutMs: 4_000,
      onEvent: () => undefined,
      onLost: () => undefined,
      log: () => undefined,
    });
    await second.start();
    const waiting = second.call('slow2', 'new job');
    r.release();
    await wait(100);
    r.releaseSecond();
    assert.equal(await waiting, 'second did new job');
    await second.shutdown('host.shutdown', [{}], 500);
  });

  it('leaving asks nothing of the host: it keeps running', async () => {
    const r = await rig();
    await r.connection.start();
    const answer = await r.connection.shutdown('host.shutdown', [{}, {}], 500);
    assert.deepEqual(answer, { completed: true, detail: 'left the host running', conversationFiles: null });
  });
});
