import { randomBytes, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { hostname } from 'node:os';

import type { HostMessage } from '../shared/host-protocol';
import {
  FrameReader,
  REMOTE_FRAME_LIMIT,
  REMOTE_SILENCE_MS,
  buildMismatch,
  encodeFrame,
  type RemoteBuild,
  type RemoteControl,
  type RemoteHandshake,
} from '../shared/remote-protocol';
import { proofOf } from '../shared/remote-proof';
import type { HostPort } from './host-server';

/*
 * The host's end of the remote transport (DSP-111): one `HostPort` that outlives connections.
 *
 * The host does not depend on a client. What it sends while none is attached is kept, up to a
 * bound, and work goes on: a turn, a job or a loop step started by a client that went away ends
 * as it would have, and the client reads the outcome when it comes back. One client at a time:
 * a new one replaces the last, which is told so.
 */

/** What is kept for a client that is away. Past this, it reloads rather than resumes. */
const KEPT_BYTES = 512 * 1024 * 1024;

/** A connection that has not proved itself within this is dropped. */
const HANDSHAKE_MS = 10_000;

function sameProof(one: string, other: string): boolean {
  const left = Buffer.from(one, 'utf8');
  const right = Buffer.from(other, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface RemoteServerOptions {
  readonly token: string;
  readonly build: RemoteBuild;
  readonly closeWithinMs: number;
  readonly log: (message: string) => void;
}

interface Attached {
  readonly socket: net.Socket;
  readonly clientId: string;
}

export class RemoteServer {
  readonly port: HostPort;

  private readonly options: RemoteServerOptions;

  private readonly instance = randomBytes(8).toString('hex');

  private readonly startedAtUtc = new Date().toISOString();

  private readonly listeners: ((message: unknown) => void)[] = [];

  private server: net.Server | null = null;

  private attached: Attached | null = null;

  /** The client whose place is kept, attached or not. */
  private clientId: string | null = null;

  private seq = 0;

  private kept: { readonly seq: number; readonly line: string }[] = [];

  private keptBytes = 0;

  /** Something the client had not acknowledged was dropped. */
  private overflowed = false;

  private lastCall = 0;

  /**
   * Calls being worked on, by the id the host's methods know them by. A client's ids start
   * again when it does, so an answer goes only to the client that asked, under its own id, and
   * the answer to a call of a client that has gone is dropped.
   */
  private readonly running = new Map<number, { readonly clientId: string; readonly id: number }>();

  private nextRunning = 1;

  constructor(options: RemoteServerOptions) {
    this.options = options;
    this.port = {
      post: (message) => {
        this.send(message);
      },
      onMessage: (listener) => {
        this.listeners.push(listener);
      },
    };
  }

  /** Listen on the loopback address only. There is no way to ask for anything else. */
  listen(port: number): Promise<number> {
    const server = net.createServer((socket) => {
      this.accept(socket);
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        const address = server.address();
        resolve(typeof address === 'object' && address !== null ? address.port : port);
      });
    });
  }

  close(): void {
    this.attached?.socket.destroy();
    this.server?.close();
  }

  private send(original: HostMessage): void {
    let message = original;
    if (message.t === 'result') {
      const call = this.running.get(message.id);
      this.running.delete(message.id);
      if (call === undefined || call.clientId !== this.clientId) {
        this.options.log(`[remote] dropped an answer for a client that has gone (${String(message.id)})`);
        return;
      }
      message = { ...message, id: call.id };
    }
    this.seq += 1;
    const line = encodeFrame({ ...message, seq: this.seq });
    if (Buffer.byteLength(line) > REMOTE_FRAME_LIMIT) {
      // `serveHost` answers an answer that cannot be sent: put the call back for that.
      this.seq -= 1;
      if (original.t === 'result' && message.t === 'result') {
        this.running.set(original.id, { clientId: this.clientId ?? '', id: message.id });
      }
      throw new Error('The message is larger than DSpatch sends over a connection.');
    }
    this.kept.push({ seq: this.seq, line });
    this.keptBytes += line.length;
    while (this.keptBytes > KEPT_BYTES && this.kept.length > 1) {
      const dropped = this.kept.shift();
      this.keptBytes -= dropped?.line.length ?? 0;
      this.overflowed = true;
    }
    const socket = this.attached?.socket;
    socket?.write(line);
    if (socket !== undefined && socket.writableLength > KEPT_BYTES) {
      // A stalled connection: what it has not taken is kept above, for the reconnect.
      this.options.log('[remote] the client is not taking what is sent; dropping the connection');
      socket.destroy();
    }
  }

  private acknowledged(seq: number): void {
    let drop = 0;
    while (drop < this.kept.length && (this.kept[drop]?.seq ?? Infinity) <= seq) {
      this.keptBytes -= this.kept[drop]?.line.length ?? 0;
      drop += 1;
    }
    if (drop > 0) {
      this.kept.splice(0, drop);
    }
  }

  private accept(socket: net.Socket): void {
    socket.setNoDelay(true);
    const nonce = randomBytes(24).toString('hex');
    let clientNonce: string | null = null;
    let session: Attached | null = null;
    let heard = Date.now();
    const silence = setInterval(() => {
      if (session !== null && Date.now() - heard > REMOTE_SILENCE_MS * 2) {
        this.options.log('[remote] nothing heard from the client; dropping the connection');
        socket.destroy();
      }
    }, REMOTE_SILENCE_MS);
    silence.unref();
    const refuse = (code: 'version' | 'auth', message: string): void => {
      this.options.log(`[remote] refused a connection (${code}): ${message}`);
      socket.end(encodeFrame({ t: 'refused', code, message } satisfies RemoteHandshake));
    };
    const deadline = setTimeout(() => {
      socket.destroy();
    }, HANDSHAKE_MS);
    const reader = new FrameReader((frame) => {
      const message = frame as (RemoteHandshake | RemoteControl | HostMessage) & { readonly t: string };
      if (session !== null) {
        this.fromClient(session, message);
        return;
      }
      if (message.t === 'hello' && clientNonce === null) {
        const hello = message as Extract<RemoteHandshake, { t: 'hello' }>;
        const mismatch = buildMismatch(this.options.build, hello.build);
        if (mismatch !== null) {
          refuse('version', mismatch);
          return;
        }
        clientNonce = hello.nonce;
        socket.write(
          encodeFrame({
            t: 'challenge',
            build: this.options.build,
            nonce,
            proof: proofOf(this.options.token, 'host', hello.nonce, nonce),
            machine: hostname(),
          } satisfies RemoteHandshake),
        );
        return;
      }
      if (message.t === 'auth' && clientNonce !== null) {
        const auth = message as Extract<RemoteHandshake, { t: 'auth' }>;
        if (!sameProof(auth.proof, proofOf(this.options.token, 'client', clientNonce, nonce))) {
          refuse('auth', "The token does not match this host's.");
          return;
        }
        clearTimeout(deadline);
        session = this.attach(socket, auth);
        return;
      }
      refuse('auth', 'The connection did not follow the handshake.');
    });
    socket.on('data', (chunk: Buffer) => {
      heard = Date.now();
      try {
        reader.push(chunk);
      } catch (error) {
        this.options.log(`[remote] dropped a connection: ${String(error)}`);
        socket.destroy();
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(deadline);
      clearInterval(silence);
      if (session !== null && this.attached === session) {
        this.attached = null;
        this.options.log('[remote] the client is away; work goes on and its answers are kept');
      }
    });
  }

  private attach(socket: net.Socket, auth: Extract<RemoteHandshake, { t: 'auth' }>): Attached {
    const previous = this.attached;
    if (previous !== null) {
      previous.socket.end(encodeFrame({ t: 'replaced' } satisfies RemoteControl));
      this.attached = null;
    }
    const session: Attached = { socket, clientId: auth.clientId };
    const resumed = this.clientId === auth.clientId && !this.overflowed;
    if (!resumed) {
      // Another client, or a place that could not be kept: it starts from what the host has now.
      this.kept = [];
      this.keptBytes = 0;
      this.overflowed = false;
      this.lastCall = 0;
      this.clientId = auth.clientId;
    }
    this.attached = session;
    socket.write(
      encodeFrame({
        t: 'welcome',
        instance: this.instance,
        pid: process.pid,
        startedAtUtc: this.startedAtUtc,
        closeWithinMs: this.options.closeWithinMs,
        resumed,
        lastCall: this.lastCall,
      } satisfies RemoteHandshake),
    );
    if (resumed) {
      this.acknowledged(auth.lastSeq);
      for (const entry of this.kept) {
        socket.write(entry.line);
      }
    }
    this.options.log(`[remote] a client attached (${resumed ? `resumed, ${String(this.kept.length)} message(s) to catch up` : 'new'})`);
    return session;
  }

  private fromClient(session: Attached, message: { readonly t: string }): void {
    if (this.attached !== session) {
      return;
    }
    if (message.t === 'ack') {
      this.acknowledged((message as Extract<RemoteControl, { t: 'ack' }>).seq);
      return;
    }
    if (message.t === 'ping') {
      session.socket.write(encodeFrame({ t: 'pong' } satisfies RemoteControl));
      return;
    }
    if (message.t === 'call') {
      const call = message as Extract<HostMessage, { t: 'call' }>;
      // A call is done once: an id the host has seen is not done again, whatever sent it.
      if (call.id <= this.lastCall) {
        this.options.log(`[remote] ignored a repeated call ${String(call.id)} (${call.method})`);
        return;
      }
      this.lastCall = call.id;
      const running = this.nextRunning;
      this.nextRunning += 1;
      this.running.set(running, { clientId: session.clientId, id: call.id });
      for (const listener of this.listeners) {
        listener({ ...call, id: running });
      }
    }
  }
}
