import { HOST_CONFIG_ENV, parseHostStartConfig, type HostMessage, type HostShutdownAnswer } from '../shared/host-protocol';
import { DISPOSE_TIMEOUT_MS } from '../main/dispose-timeout';
import { emitTo, serveHost, type HostMethods, type HostPort } from './host-server';
import { shutdownProjectHost, startProjectHost } from './project-host';

/*
 * The project host's process (DSP-111): started by the client, never by a person.
 *
 * The application starts it with Electron's `utilityProcess.fork`, which gives this
 * process a `parentPort`; a test starts it with Node's `child_process.fork`, which gives
 * it `process.send`. Both carry plain values over the local process channel. Nothing is
 * opened on a network.
 *
 * **It does not outlive the client.** Work going on without the application that
 * started it is a separate capability nobody has decided on (DSP-111), so when the
 * client process is gone this process closes its adapters, as a quit would, and ends.
 */

const PARENT_CHECK_MS = 2_000;

/** How long a close may take when the client is already gone and nobody is waiting. */
const ORPHAN_CLOSE_BOUND_MS = 8_000;

function log(message: string): void {
  process.stdout.write(`[dspatch] [host] ${message}\n`);
}

interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

/** The channel to the client: Electron's `parentPort`, or Node's IPC channel. */
function connectToClient(): HostPort | null {
  const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  if (parentPort !== undefined) {
    return {
      post: (message) => {
        parentPort.postMessage(message);
      },
      onMessage: (listener) => {
        parentPort.on('message', (event) => {
          listener(event.data);
        });
      },
    };
  }
  const send = process.send?.bind(process);
  if (send !== undefined) {
    return {
      post: (message) => {
        send(message);
      },
      onMessage: (listener) => {
        process.on('message', (message) => {
          listener(message);
        });
      },
    };
  }
  return null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else, which is not our client
    // going away; only "no such process" is.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function main(): void {
  const port = connectToClient();
  if (port === null) {
    process.stderr.write(
      "DSpatch's project host was started without a channel to its client. It is started by DSpatch, not by hand.\n",
    );
    process.exit(2);
  }
  const config = parseHostStartConfig(process.env[HOST_CONFIG_ENV]);
  if ('error' in config) {
    process.stderr.write(`${config.error}\n`);
    process.exit(2);
  }

  const methods: Record<string, (...args: never[]) => unknown> = {
    ...startProjectHost({
      config,
      emit: (to, channel, payload) => {
        emitTo(port, log, to, channel, payload);
      },
    }),
  };

  let closing = false;
  const endAfter = (answer: Promise<HostShutdownAnswer>, why: string): Promise<HostShutdownAnswer> =>
    answer.then((outcome) => {
      log(`${why}: ${outcome.detail}; ending`);
      // Long enough for the answer to leave through the channel before the process goes.
      setTimeout(() => {
        process.exit(0);
      }, 100);
      return outcome;
    });

  methods['host.shutdown'] = (_context: unknown, request: unknown) => {
    closing = true;
    const observe =
      typeof request === 'object' && request !== null &&
      (request as { observeConversationFiles?: unknown }).observeConversationFiles === true;
    return endAfter(shutdownProjectHost(observe), 'shutdown asked by the client');
  };

  serveHost(port, methods as HostMethods, log);

  const parentCheck = setInterval(() => {
    if (closing || processAlive(config.clientPid)) {
      return;
    }
    closing = true;
    clearInterval(parentCheck);
    log(`the client process ${String(config.clientPid)} is gone; closing the adapters and ending`);
    setTimeout(() => {
      log(`the adapters did not close within ${String(ORPHAN_CLOSE_BOUND_MS)} ms; ending anyway`);
      process.exit(0);
    }, ORPHAN_CLOSE_BOUND_MS).unref();
    void endAfter(shutdownProjectHost(false), 'client gone');
  }, PARENT_CHECK_MS);

  const ready: HostMessage = {
    t: 'ready',
    pid: process.pid,
    startedAtUtc: new Date().toISOString(),
    closeWithinMs: DISPOSE_TIMEOUT_MS,
  };
  port.post(ready);
  log(`project host serving pid=${String(process.pid)} client=${String(config.clientPid)}`);
}

main();
