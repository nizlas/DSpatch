import {
  isHostCallFailure,
  type HostCallFailure,
  type HostEventTarget,
  type HostMessage,
} from '../shared/host-protocol';

/*
 * The client's side of the process channel to the project host (DSP-111).
 *
 * It starts the host, holds calls made before the host is ready, answers every call
 * exactly once, and says plainly when the host could not be started or stopped while
 * work was in progress. It never repeats a call: a call the host did not answer before
 * it stopped is answered here with `host-lost`, whose words say that the outcome is
 * unknown and that nothing was sent again.
 *
 * No Electron here, so the same code runs against a forked Node process in tests. The
 * application gives it a `utilityProcess` (`main.ts`).
 */

/** A started host process, as the connection needs it. */
export interface HostProcess {
  post(message: HostMessage): void;
  onMessage(listener: (message: unknown) => void): void;
  /** Called once when the process has exited, with its exit code if there is one. */
  onExit(listener: (code: number | null) => void): void;
  /** End the process now. Used after a bounded shutdown that did not answer. */
  kill(): void;
  /** The operating system's id for the process, once it is known. */
  pid(): number | undefined;
  /** The last part of what the process wrote to stderr, for a failure's details. */
  stderrTail(): string;
}

export type HostState = 'not-started' | 'starting' | 'ready' | 'failed' | 'lost' | 'stopping' | 'stopped';

export type HostStartOutcome =
  | { readonly ok: true; readonly pid: number }
  | { readonly ok: false; readonly failure: HostCallFailure };

/** What the connection tells its owner when the host stops on its own. */
export interface HostLoss {
  readonly exitCode: number | null;
  /** The calls that were waiting for an answer, by method. Each was answered with `host-lost`. */
  readonly unanswered: readonly string[];
  readonly stderrTail: string;
}

export interface HostConnectionOptions {
  readonly spawn: () => HostProcess;
  /** How long the host may take to say it is ready. */
  readonly startTimeoutMs: number;
  readonly onEvent: (to: HostEventTarget, channel: string, payload: unknown) => void;
  readonly onLost: (loss: HostLoss) => void;
  readonly log: (message: string) => void;
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
}

const HOST = "DSpatch's project host";

function unavailable(message: string, detail?: string): HostCallFailure {
  return { kind: 'host-error', code: 'host-unavailable', message, ...(detail === undefined ? {} : { detail }) };
}

/** An `Error` with the failure's own message, as Electron's IPC would carry it to a window. */
export class HostCallError extends Error {
  readonly failure: HostCallFailure;

  constructor(failure: HostCallFailure) {
    super(failure.message);
    this.name = 'HostCallError';
    this.failure = failure;
  }
}

export class HostConnection {
  private readonly options: HostConnectionOptions;

  private process: HostProcess | null = null;

  private stateNow: HostState = 'not-started';

  private nextId = 1;

  private readonly pending = new Map<number, Pending>();

  /** Settles when the current start has an outcome; calls made while starting wait for it. */
  private starting: Promise<HostStartOutcome> | null = null;

  private lastFailure: HostCallFailure | null = null;

  /** The host's own close bound, from its ready message; `null` until a host has said. */
  private closeWithinMs: number | null = null;

  constructor(options: HostConnectionOptions) {
    this.options = options;
  }

  state(): HostState {
    return this.stateNow;
  }

  pid(): number | undefined {
    return this.process?.pid();
  }

  /**
   * How long the running host said its own close may take (`ready.closeWithinMs`), or
   * `null` before any host has said. The client's wait for a shutdown is this plus a
   * margin, so the bound is the host's adapters' own rather than a number the client
   * would have to load provider code to know.
   */
  closeBoundMs(): number | null {
    return this.closeWithinMs;
  }

  /** Why the host is not serving, when it is not. */
  failure(): HostCallFailure | null {
    return this.lastFailure;
  }

  /**
   * Start the host and wait until it says it is ready. Allowed when nothing is running:
   * at first, after a failed start, and after the host was lost.
   */
  start(): Promise<HostStartOutcome> {
    if (this.stateNow === 'starting' && this.starting !== null) {
      return this.starting;
    }
    if (this.stateNow === 'ready' || this.stateNow === 'stopping') {
      return Promise.resolve({ ok: true, pid: this.process?.pid() ?? -1 });
    }
    this.stateNow = 'starting';
    this.lastFailure = null;
    const startedAt = Date.now();
    this.starting = new Promise<HostStartOutcome>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const settle = (outcome: HostStartOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };
      let child: HostProcess;
      try {
        child = this.options.spawn();
      } catch (error) {
        this.stateNow = 'failed';
        this.lastFailure = unavailable(`${HOST} could not be started, so no project can be opened.`, String(error));
        settle({ ok: false, failure: this.lastFailure });
        return;
      }
      this.process = child;
      timer = setTimeout(() => {
        this.stateNow = 'failed';
        this.lastFailure = unavailable(
          `${HOST} did not start within ${String(Math.round(this.options.startTimeoutMs / 1000))} seconds, so no project can be opened.`,
          child.stderrTail(),
        );
        this.options.log(`project host did not report ready within ${String(this.options.startTimeoutMs)} ms; ending it`);
        try {
          child.kill();
        } catch {
          // Already gone.
        }
        settle({ ok: false, failure: this.lastFailure });
      }, this.options.startTimeoutMs);

      child.onMessage((message) => {
        if (child !== this.process) {
          return;
        }
        this.receive(message, (pid) => {
          this.stateNow = 'ready';
          this.options.log(`project host ready pid=${String(pid)} after ${String(Date.now() - startedAt)} ms`);
          settle({ ok: true, pid });
        });
      });
      child.onExit((code) => {
        if (child !== this.process) {
          return;
        }
        if (!settled) {
          this.stateNow = 'failed';
          this.lastFailure = unavailable(
            `${HOST} stopped while starting (exit code ${String(code)}), so no project can be opened.`,
            child.stderrTail(),
          );
          settle({ ok: false, failure: this.lastFailure });
          return;
        }
        this.exited(code, child);
      });
    });
    return this.starting;
  }

  /**
   * Call a host method and get its value, or an `Error` with the method's own message.
   * This is the shape a window's `ipcRenderer.invoke` already sees.
   */
  async call<T = unknown>(method: string, ...args: readonly unknown[]): Promise<T> {
    const answer = await this.answer(method, ...args);
    if (isHostCallFailure(answer)) {
      throw new HostCallError(answer);
    }
    return answer as T;
  }

  /**
   * Call a host method and get its value or a failure, without throwing. For callers
   * whose contract already answers failures as values (`ReviewHostApi`).
   *
   * Note that a method may itself answer a value that is a host error (the review host
   * does); those pass through as values.
   */
  async answer(method: string, ...args: readonly unknown[]): Promise<unknown> {
    if (this.stateNow === 'starting' && this.starting !== null) {
      await this.starting;
    }
    const child = this.process;
    if (this.stateNow !== 'ready' || child === null) {
      // Never sent, so nothing was done: `host-unavailable`, whatever stopped the host.
      // (`host-lost` is only for calls that were sent and not answered.)
      const why = this.lastFailure;
      return why === null
        ? unavailable(`${HOST} is not running, so "${method}" was not done.`)
        : unavailable(`${why.message} "${method}" was not done.`, why.detail);
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve) => {
      this.pending.set(id, { method, resolve });
      try {
        child.post({ t: 'call', id, method, args });
      } catch (error) {
        this.pending.delete(id);
        resolve({
          kind: 'host-error',
          code: 'internal',
          message: `The request "${method}" could not be sent to ${HOST}.`,
          detail: String(error),
        } satisfies HostCallFailure);
      }
    });
  }

  /**
   * End the host after its own orderly shutdown, waiting at most `timeoutMs` for it.
   * Returns the shutdown's answer, or `null` when it did not come in time, in which case
   * the process is ended.
   */
  async shutdown(method: string, args: readonly unknown[], timeoutMs: number): Promise<unknown> {
    const child = this.process;
    if (this.stateNow === 'starting' && this.starting !== null) {
      await this.starting;
    }
    if (this.stateNow !== 'ready' || child === null) {
      this.stateNow = 'stopped';
      return null;
    }
    // The arguments exactly as for any call, the call context first: a host method
    // reads its request after the context, so a request sent in its place is lost.
    const answered = this.answer(method, ...args);
    this.stateNow = 'stopping';
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      answered,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (outcome === null || isHostCallFailure(outcome)) {
      this.options.log(
        outcome === null
          ? `project host did not finish its shutdown within ${String(timeoutMs)} ms; ending it`
          : `project host shutdown failed (${outcome.message}); ending it`,
      );
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
    this.stateNow = 'stopped';
    return outcome;
  }

  private receive(message: unknown, onReady: (pid: number) => void): void {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const typed = message as HostMessage;
    switch (typed.t) {
      case 'ready':
        this.closeWithinMs = typeof typed.closeWithinMs === 'number' ? typed.closeWithinMs : null;
        onReady(typed.pid);
        return;
      case 'result': {
        const pending = this.pending.get(typed.id);
        if (pending === undefined) {
          return;
        }
        this.pending.delete(typed.id);
        pending.resolve(typed.ok ? typed.value : typed.error);
        return;
      }
      case 'event':
        try {
          this.options.onEvent(typed.to, typed.channel, typed.payload);
        } catch (error) {
          this.options.log(`an event from the project host could not be delivered (${typed.channel}): ${String(error)}`);
        }
        return;
      default:
        return;
    }
  }

  private exited(code: number | null, child: HostProcess): void {
    const expected = this.stateNow === 'stopping' || this.stateNow === 'stopped';
    const unanswered: string[] = [];
    for (const [id, pending] of this.pending) {
      unanswered.push(pending.method);
      this.pending.delete(id);
      pending.resolve({
        kind: 'host-error',
        code: 'host-lost',
        message:
          `${HOST} stopped before it answered (${pending.method}). Whether that was done is unknown, ` +
          'and nothing was sent again.',
        detail: `exit code ${String(code)}`,
      } satisfies HostCallFailure);
    }
    if (expected) {
      this.stateNow = 'stopped';
      return;
    }
    if (this.stateNow === 'failed') {
      // A start that already failed (and was reported) ending its process: not a loss.
      return;
    }
    this.stateNow = 'lost';
    this.lastFailure = {
      kind: 'host-error',
      code: 'host-lost',
      message: `${HOST} has stopped (exit code ${String(code)}). Nothing more can be done until it is started again.`,
      detail: child.stderrTail(),
    };
    this.options.log(
      `project host stopped unexpectedly: exit code ${String(code)}, ` +
        `${String(unanswered.length)} unanswered call(s)${unanswered.length === 0 ? '' : ` (${unanswered.join(', ')})`}`,
    );
    this.options.onLost({ exitCode: code, unanswered, stderrTail: child.stderrTail() });
  }
}
