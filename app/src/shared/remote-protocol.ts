import type { HostMessage } from './host-protocol';

/*
 * The transport between DSpatch's client and a project host on another machine (DSP-111).
 *
 * It carries the same `HostMessage`s as the local process channel, as JSON lines over one TCP
 * connection. The host listens on its own loopback address only and the person reaches it
 * through an SSH tunnel, so SSH gives the network path and its encryption, and nothing is
 * exposed on a network. On top of that, both sides prove they hold the host's token.
 *
 * **Resuming.** Everything the host sends after the handshake has a sequence number and is kept
 * until the client acknowledges it. A client that lost the connection says where it got to and
 * gets the rest, in order: events and the answers to its calls. So work that finished while it
 * was away is not lost.
 *
 * **Nothing is repeated.** The client never sends a call twice. After a reconnect the host says
 * the last call it received: a later one never arrived, was not done and is answered so; the
 * others are answered when the host answers them.
 *
 * Which fields exist here is the compatibility contract. Change them, and the contract's
 * methods, only together with {@link REMOTE_PROTOCOL_VERSION}.
 */

export const REMOTE_PROTOCOL_VERSION = 1;

/** What makes two builds able to work together, stated by each side in its hello. */
export interface RemoteBuild {
  readonly protocol: number;
  /** A digest of the contract's method names: the same methods on both sides. */
  readonly contract: string;
  readonly appVersion: string;
  /** The commit the build came from, or `unknown`. Shown; a difference alone is allowed. */
  readonly commit: string;
  /**
   * DSP-165: the digest of the sources the build was made from (`dist/build-identity.json`), so
   * two builds of one commit with different working-copy changes can be told apart. Read once
   * when the process starts: a host that is still running reports the build it started from,
   * never one made after it. Absent from older builds; a difference alone is allowed.
   */
  readonly digest?: string;
}

/**
 * What a person is told when the host they reached was started from another build than this
 * client: a short fact for the host line, or `''` when both are the same or nothing says.
 */
export function hostBuildNote(host: RemoteBuild | null, client: RemoteBuild): string {
  if (host === null) {
    return '';
  }
  const named = (build: RemoteBuild): string => (build.digest === undefined ? build.commit : `${build.commit}, build ${build.digest.slice(0, 8)}`);
  const differs =
    host.digest !== undefined && client.digest !== undefined ? host.digest !== client.digest : host.commit !== client.commit;
  return differs ? `The host runs ${named(host)}; this window is ${named(client)}. End the host to run this build.` : '';
}

export type RemoteHandshake =
  | { readonly t: 'hello'; readonly build: RemoteBuild; readonly nonce: string }
  | { readonly t: 'challenge'; readonly build: RemoteBuild; readonly nonce: string; readonly proof: string; readonly machine: string }
  | { readonly t: 'auth'; readonly proof: string; readonly clientId: string; readonly lastSeq: number }
  | {
      readonly t: 'welcome';
      /** Differs from before when the host process was restarted: nothing can be resumed. */
      readonly instance: string;
      readonly pid: number;
      readonly startedAtUtc: string;
      readonly closeWithinMs: number;
      /** The client's place was kept: what it missed follows, and `lastCall` is good. */
      readonly resumed: boolean;
      /** The last call the host received from this client. */
      readonly lastCall: number;
    }
  | { readonly t: 'refused'; readonly code: 'version' | 'auth'; readonly message: string };

/** After the handshake, besides `HostMessage`s. `seq` is on what the host sends. */
export type RemoteControl =
  | { readonly t: 'ack'; readonly seq: number }
  | { readonly t: 'ping' }
  | { readonly t: 'pong' }
  /** Another client took over this host. One client at a time. */
  | { readonly t: 'replaced' };

export type RemoteHostFrame = HostMessage & { readonly seq: number };

/** The most one frame may hold: a large diff, or a binary file brought for viewing. */
export const REMOTE_FRAME_LIMIT = 256 * 1024 * 1024;

/** How often the client asks, and how long a silent connection counts as alive. */
export const REMOTE_PING_MS = 4_000;
export const REMOTE_SILENCE_MS = 14_000;

/** The default port of a host. */
export const REMOTE_DEFAULT_PORT = 47917;

interface EncodeHolder {
  readonly [key: string]: unknown;
}

/**
 * One value as one line of JSON. `Uint8Array` (file bytes for viewing and export) and
 * `undefined` (a call's left-out argument) are what structured clone carries and JSON does not.
 */
export function encodeFrame(value: unknown): string {
  return `${JSON.stringify(value, function replace(this: EncodeHolder, key: string, current: unknown): unknown {
    // `Buffer` has a `toJSON`, already applied to `current`: the holder has the original.
    const original = this[key];
    if (original instanceof Uint8Array) {
      return { $dspatchBytes: bytesToBase64(original) };
    }
    return current === undefined ? { $dspatchUndefined: true } : current;
  })}\n`;
}

export function decodeFrame(line: string): unknown {
  return JSON.parse(line, (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      const fields = value as Record<string, unknown>;
      if (typeof fields['$dspatchBytes'] === 'string') {
        return base64ToBytes(fields['$dspatchBytes']);
      }
      if (fields['$dspatchUndefined'] === true) {
        return undefined;
      }
    }
    return value;
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function base64ToBytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/** Splits a byte stream into frames. Throws when one exceeds {@link REMOTE_FRAME_LIMIT}. */
export class FrameReader {
  private parts: Buffer[] = [];

  private size = 0;

  private readonly onFrame: (value: unknown) => void;

  constructor(onFrame: (value: unknown) => void) {
    this.onFrame = onFrame;
  }

  push(chunk: Buffer): void {
    let rest = chunk;
    for (;;) {
      const end = rest.indexOf(10);
      if (end < 0) {
        this.parts.push(rest);
        this.size += rest.length;
        if (this.size > REMOTE_FRAME_LIMIT) {
          throw new Error('A message on the connection is larger than DSpatch allows.');
        }
        return;
      }
      const line = Buffer.concat([...this.parts, rest.subarray(0, end)]);
      this.parts = [];
      this.size = 0;
      rest = rest.subarray(end + 1);
      if (line.length > 0) {
        this.onFrame(decodeFrame(line.toString('utf8')));
      }
    }
  }
}

/** Why two builds cannot work together, in a sentence for a person, or `null`. */
export function buildMismatch(host: RemoteBuild, client: RemoteBuild): string | null {
  const stated = `the host is ${host.appVersion} at ${host.commit}, this client ${client.appVersion} at ${client.commit}`;
  if (host.protocol !== client.protocol) {
    return `This client and the host speak different versions of DSpatch's protocol (${String(client.protocol)} and ${String(host.protocol)}): ${stated}. Install the same commit on both.`;
  }
  if (host.contract !== client.contract) {
    return `This client and the host were built from different sources: ${stated}. Install the same commit on both.`;
  }
  return null;
}
