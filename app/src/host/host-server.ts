import type { HostCallFailure, HostEventTarget, HostMessage } from '../shared/host-protocol';

/*
 * The host's side of the process channel (DSP-111): answer each call once, and send
 * events to an audience the client delivers.
 *
 * Transport-neutral on purpose. `HostPort` is whatever carries plain values to the
 * client: Electron's `parentPort` in a utility process, `process.send` in a forked
 * Node process. A later transport between two machines would be one more `HostPort`,
 * with the same methods behind it.
 */

export interface HostPort {
  post(message: HostMessage): void;
  onMessage(listener: (message: unknown) => void): void;
}

/** The methods the host serves, by name. Arguments and answers are plain data. */
export type HostMethods = Readonly<Record<string, (...args: never[]) => unknown>>;

/** What a method that threw answers: its own sentence, so the window says what it said before. */
export function failureOf(error: unknown): HostCallFailure {
  if (error instanceof Error) {
    return {
      kind: 'host-error',
      code: 'failed',
      message: error.message,
      ...(error.stack === undefined ? {} : { detail: error.stack }),
    };
  }
  return { kind: 'host-error', code: 'failed', message: String(error) };
}

function isCall(message: unknown): message is Extract<HostMessage, { t: 'call' }> {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const candidate = message as { t?: unknown; id?: unknown; method?: unknown; args?: unknown };
  return (
    candidate.t === 'call' &&
    typeof candidate.id === 'number' &&
    typeof candidate.method === 'string' &&
    Array.isArray(candidate.args)
  );
}

/**
 * Serve `methods` on `port`. Every call is answered exactly once, with its value or a
 * failure; a value that cannot be sent is answered as `internal` rather than leaving
 * the client waiting.
 */
export function serveHost(port: HostPort, methods: HostMethods, log: (message: string) => void): void {
  const answer = (message: HostMessage, method: string): void => {
    try {
      port.post(message);
    } catch (error) {
      if (message.t !== 'result') {
        log(`[host] an event could not be sent (${method}): ${String(error)}`);
        return;
      }
      log(`[host] the answer to ${method} could not be sent: ${String(error)}`);
      port.post({
        t: 'result',
        id: message.id,
        ok: false,
        error: {
          kind: 'host-error',
          code: 'internal',
          message: `DSpatch's project host could not send its answer (${method}).`,
          detail: String(error),
        },
      });
    }
  };

  port.onMessage((message) => {
    if (!isCall(message)) {
      log(`[host] ignored a message that is not a call: ${JSON.stringify(message)?.slice(0, 200) ?? String(message)}`);
      return;
    }
    const { id, method, args } = message;
    const fn = Object.prototype.hasOwnProperty.call(methods, method) ? methods[method] : undefined;
    if (fn === undefined) {
      answer(
        {
          t: 'result',
          id,
          ok: false,
          error: {
            kind: 'host-error',
            code: 'unknown-method',
            message: `DSpatch's project host has no method "${method}". The client and the host were built from different sources.`,
          },
        },
        method,
      );
      return;
    }
    void (async () => {
      let reply: HostMessage;
      try {
        const value = await (fn as (...callArgs: readonly unknown[]) => unknown)(...args);
        reply = { t: 'result', id, ok: true, value };
      } catch (error) {
        reply = { t: 'result', id, ok: false, error: failureOf(error) };
      }
      answer(reply, method);
    })();
  });
}

/** Send one event to an audience. Never throws: an event that cannot be sent is logged. */
export function emitTo(
  port: HostPort,
  log: (message: string) => void,
  to: HostEventTarget,
  channel: string,
  payload: unknown,
): void {
  try {
    port.post({ t: 'event', to, channel, payload });
  } catch (error) {
    log(`[host] the event on ${channel} could not be sent: ${String(error)}`);
  }
}
