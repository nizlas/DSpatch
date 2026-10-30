import { randomBytes } from 'node:crypto';
import net from 'node:net';

import type { HostMessage } from '../shared/host-protocol';
import {
  FrameReader,
  REMOTE_PING_MS,
  REMOTE_SILENCE_MS,
  buildMismatch,
  encodeFrame,
  type RemoteBuild,
  type RemoteControl,
  type RemoteHandshake,
  type RemoteHostFrame,
} from '../shared/remote-protocol';
import { proofOf } from '../shared/remote-proof';
import type { HostLinkEvent, HostProcess } from './host-connection';

/*
 * The client's end of the remote transport (DSP-111): a `HostProcess` that happens to be on
 * another machine, so the windows, the calls and their failure meanings stay what they are.
 *
 * It keeps reconnecting by itself and resumes where it was; what happens to the calls waiting
 * meanwhile is {@link HostConnection}'s, which sends nothing again. A host that was restarted
 * reads as a process that ended, and a host that refuses this client as a start that failed.
 *
 * No Electron here, so the same code runs against a real host process in tests.
 */

export interface RemoteEndpoint {
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

export interface RemoteLinkOptions {
  readonly endpoint: RemoteEndpoint;
  readonly build: RemoteBuild;
  readonly log: (message: string) => void;
  /** Between attempts to reconnect, longest. */
  readonly retryMaxMs?: number;
}

const ACK_MS = 1_000;

const HANDSHAKE_MS = 8_000;

export class RemoteLink implements HostProcess {
  private readonly options: RemoteLinkOptions;

  private readonly clientId = randomBytes(12).toString('hex');

  private socket: net.Socket | null = null;

  /** The handshake is done on {@link socket}. */
  private open = false;

  private messageListener: ((message: unknown) => void) | null = null;

  private exitListener: ((code: number | null) => void) | null = null;

  private linkListener: ((event: HostLinkEvent) => void) | null = null;

  private instance: string | null = null;

  private hostPid: number | undefined;

  private machine = '';

  private hostBuild: RemoteBuild | null = null;

  private lastSeq = 0;

  private ackedSeq = 0;

  private stopped = false;

  private attempts = 0;

  private retry: NodeJS.Timeout | null = null;

  private beat: NodeJS.Timeout | null = null;

  private lastHeard = 0;

  private lastFailure = '';

  /** A refusal that retrying will not change. */
  private refusal: string | null = null;

  constructor(options: RemoteLinkOptions) {
    this.options = options;
  }

  /** The machine the host says it is, once it has. */
  machineName(): string {
    return this.machine;
  }

  /** The host's build, once it has said. */
  build(): RemoteBuild | null {
    return this.hostBuild;
  }

  /** A way to try now rather than at the next attempt. */
  retryNow(): void {
    if (!this.open && !this.stopped) {
      if (this.retry !== null) {
        clearTimeout(this.retry);
        this.retry = null;
      }
      this.socket?.destroy();
      this.connect();
    }
  }

  private start(): void {
    this.connect();
  }

  post(message: HostMessage): void {
    // Ending the client leaves the host running: nothing of this goes to it.
    if (message.t === 'call' && message.method === 'host.shutdown') {
      this.messageListener?.({ t: 'result', id: message.id, ok: true, value: { completed: true, detail: 'left the host running', conversationFiles: null } });
      return;
    }
    if (!this.open || this.socket === null) {
      throw new Error('The connection to the host is lost.');
    }
    this.socket.write(encodeFrame(message));
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
    this.start();
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListener = listener;
  }

  onLink(listener: (event: HostLinkEvent) => void): void {
    this.linkListener = listener;
  }

  kill(): void {
    this.stopped = true;
    if (this.retry !== null) {
      clearTimeout(this.retry);
    }
    this.stopBeat();
    this.socket?.destroy();
  }

  pid(): number | undefined {
    return this.hostPid;
  }

  stderrTail(): string {
    return this.refusal ?? this.lastFailure;
  }

  private stopBeat(): void {
    if (this.beat !== null) {
      clearInterval(this.beat);
      this.beat = null;
    }
  }

  private connect(): void {
    if (this.stopped || this.refusal !== null) {
      return;
    }
    const { host, port, token } = this.options.endpoint;
    const nonce = randomBytes(24).toString('hex');
    const socket = net.connect({ host, port });
    this.socket = socket;
    socket.setNoDelay(true);
    let hostNonce: string | null = null;
    // A connection that takes the handshake nowhere (a tunnel with nothing behind it).
    const handshake = setTimeout(() => {
      this.lastFailure = 'The connection opened, and nothing answered.';
      socket.destroy();
    }, HANDSHAKE_MS);
    handshake.unref();
    this.handshakeTimer = handshake;
    socket.on('close', () => {
      clearTimeout(handshake);
    });
    const reader = new FrameReader((frame) => {
      const message = frame as (RemoteHandshake | RemoteControl | RemoteHostFrame) & { readonly t: string };
      if (this.open) {
        this.received(message);
        return;
      }
      if (message.t === 'refused') {
        const refused = message as Extract<RemoteHandshake, { t: 'refused' }>;
        this.refuse(refused.message);
        return;
      }
      if (message.t === 'challenge') {
        const challenge = message as Extract<RemoteHandshake, { t: 'challenge' }>;
        const mismatch = buildMismatch(challenge.build, this.options.build);
        if (mismatch !== null) {
          this.refuse(mismatch);
          return;
        }
        if (challenge.proof !== proofOf(token, 'host', nonce, challenge.nonce)) {
          this.refuse("The host at that address does not hold this token, so nothing was sent to it.");
          return;
        }
        hostNonce = challenge.nonce;
        this.machine = challenge.machine;
        this.hostBuild = challenge.build;
        socket.write(
          encodeFrame({
            t: 'auth',
            proof: proofOf(token, 'client', nonce, hostNonce),
            clientId: this.clientId,
            lastSeq: this.lastSeq,
          } satisfies RemoteHandshake),
        );
        return;
      }
      if (message.t === 'welcome' && hostNonce !== null) {
        this.welcome(message as Extract<RemoteHandshake, { t: 'welcome' }>);
      }
    });
    socket.on('connect', () => {
      socket.write(encodeFrame({ t: 'hello', build: this.options.build, nonce } satisfies RemoteHandshake));
    });
    socket.on('data', (chunk: Buffer) => {
      // On every chunk: one large frame can take longer than the silence bound.
      this.lastHeard = Date.now();
      try {
        reader.push(chunk);
      } catch (error) {
        this.options.log(`the connection to the host sent something unreadable: ${String(error)}`);
        socket.destroy();
      }
    });
    socket.on('error', (error: Error) => {
      this.lastFailure = error.message;
    });
    socket.on('close', () => {
      if (socket === this.socket) {
        this.dropped();
      }
    });
  }

  private refuse(message: string): void {
    this.options.log(`the host refused this client: ${message}`);
    this.refusal = message;
    this.stopped = true;
    this.socket?.destroy();
    if (this.instance === null) {
      // The first connection: a start that failed.
      this.exitListener?.(null);
    } else {
      this.linkListener?.({ kind: 'refused', message });
    }
  }

  private welcome(welcome: Extract<RemoteHandshake, { t: 'welcome' }>): void {
    const first = this.instance === null;
    const restarted = !first && this.instance !== welcome.instance;
    if (restarted) {
      this.options.log('the host was restarted; its work in memory is gone and nothing can be resumed');
      this.stopped = true;
      this.socket?.destroy();
      this.exitListener?.(null);
      return;
    }
    clearTimeout(this.handshakeTimer ?? undefined);
    this.instance = welcome.instance;
    this.hostPid = welcome.pid;
    this.open = true;
    this.attempts = 0;
    this.lastHeard = Date.now();
    this.stopBeat();
    this.beat = setInterval(() => {
      this.heartbeat();
    }, Math.min(REMOTE_PING_MS, ACK_MS));
    this.beat.unref();
    if (first) {
      this.messageListener?.({ t: 'ready', pid: welcome.pid, startedAtUtc: welcome.startedAtUtc, closeWithinMs: welcome.closeWithinMs } satisfies HostMessage);
    } else if (!welcome.resumed) {
      this.lastSeq = 0;
    }
    this.linkListener?.({ kind: 'connected', first, resumed: welcome.resumed, lastCall: welcome.lastCall });
  }

  private lastPing = 0;

  private handshakeTimer: NodeJS.Timeout | null = null;

  private heartbeat(): void {
    const now = Date.now();
    if (now - this.lastHeard > REMOTE_SILENCE_MS) {
      this.options.log(`nothing heard from the host for ${String(REMOTE_SILENCE_MS)} ms; reconnecting`);
      this.socket?.destroy();
      return;
    }
    if (this.lastSeq !== this.ackedSeq) {
      this.ackedSeq = this.lastSeq;
      this.socket?.write(encodeFrame({ t: 'ack', seq: this.lastSeq } satisfies RemoteControl));
    }
    if (now - this.lastPing >= REMOTE_PING_MS) {
      this.lastPing = now;
      this.socket?.write(encodeFrame({ t: 'ping' } satisfies RemoteControl));
    }
  }

  private received(message: { readonly t: string; readonly seq?: number }): void {
    if (message.t === 'pong') {
      return;
    }
    if (message.t === 'replaced') {
      this.refuse('Another client connected to this host, so this one has stopped. Only one client at a time can use a host.');
      return;
    }
    if (typeof message.seq === 'number') {
      if (message.seq <= this.lastSeq) {
        return;
      }
      this.lastSeq = message.seq;
    }
    this.messageListener?.(message);
  }

  private dropped(): void {
    const wasOpen = this.open;
    this.open = false;
    this.stopBeat();
    if (this.stopped) {
      return;
    }
    if (wasOpen) {
      this.options.log('the connection to the host dropped; reconnecting');
      this.linkListener?.({ kind: 'disconnected' });
    }
    this.attempts += 1;
    const wait = Math.min(this.options.retryMaxMs ?? 5_000, 250 * 2 ** Math.min(this.attempts, 6));
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
    this.retry.unref();
  }
}
