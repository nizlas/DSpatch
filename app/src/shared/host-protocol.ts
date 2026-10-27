import type { EnvironmentInfo } from './bridge';

/*
 * The messages between DSpatch's client and its project host (DSP-111).
 *
 * The client is the Electron main process: windows, menus, dialogs, the clipboard and
 * the review window registry. The project host is a separate process that holds the
 * project's work: repository access, git, agent connections, loop runs, and the
 * durable conversations, run records and review records that belong to them. The two
 * talk only through these messages.
 *
 * **Plain data only.** Every message is a value the structured-clone algorithm can
 * copy: no functions, class instances with behaviour, or shared references. That is
 * what Electron's IPC to the renderer already required of these values, and it is what
 * a later transport between two machines needs too. Today the messages travel over the
 * local process channel (`utilityProcess` in the application, a forked Node process in
 * tests); nothing is exposed on a network.
 *
 * **Calls are answered once.** A call is answered with its value or with a
 * `HostCallFailure`. A host that stops before answering leaves the call unanswered by
 * the host; the client then answers it itself with `host-lost`, which says that the
 * outcome is unknown. Nothing in the protocol repeats a call.
 */

/** Why a call did not produce its value. */
export type HostFailureCode =
  /** The method threw. `message` is the method's own sentence, as before the host existed. */
  | 'failed'
  /** No method by that name: the client and the host were built from different sources. */
  | 'unknown-method'
  /** The answer could not be sent back (it was not plain data): a fault in the host. */
  | 'internal'
  /** The host was not running, or could not be started, when the call was made. Nothing was done. */
  | 'host-unavailable'
  /** The host stopped after the call was sent and before it answered. The outcome is unknown. */
  | 'host-lost';

export interface HostCallFailure {
  readonly kind: 'host-error';
  readonly code: HostFailureCode;
  /** For a person. For `failed`, exactly the method's own error message. */
  readonly message: string;
  /** Technical text for a closed Details: a stack, an exit code, stderr. */
  readonly detail?: string;
}

export function isHostCallFailure(value: unknown): value is HostCallFailure {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'host-error';
}

/**
 * Who an event from the host is for. The host does not know about windows; it names an
 * audience and the client delivers to the windows it has in that audience.
 */
export type HostEventTarget =
  /** The chat window (agent events, which are about the conversation shown there). */
  | { readonly kind: 'main-window' }
  /** Every window: facts about the workspace rather than about one conversation. */
  | { readonly kind: 'every-window' }
  /** Every window that follows loop runs: the chat window and the graph editor. */
  | { readonly kind: 'run-audience' }
  /** One renderer, named by the id the client gave the host with the call that started the work. */
  | { readonly kind: 'contents'; readonly id: number };

export type HostMessage =
  | { readonly t: 'call'; readonly id: number; readonly method: string; readonly args: readonly unknown[] }
  | { readonly t: 'result'; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly t: 'result'; readonly id: number; readonly ok: false; readonly error: HostCallFailure }
  | { readonly t: 'event'; readonly to: HostEventTarget; readonly channel: string; readonly payload: unknown }
  /**
   * Sent once, when the host has built its services and serves calls. `closeWithinMs`
   * is how long the host's own close may take (its adapters' disposal bound): the
   * client waits that long, and a little for the answer to travel, before ending it.
   */
  | { readonly t: 'ready'; readonly pid: number; readonly startedAtUtc: string; readonly closeWithinMs: number };

/**
 * What the client hands the host at start, in `DSPATCH_HOST_CONFIG`.
 *
 * The values the Electron `app` object would otherwise give: the host has no `app`, and
 * these are what the services were reading from it. Paths are on the host's machine,
 * which today is the same machine.
 */
export interface HostStartConfig {
  /** Root of DSpatch's own durable data (Electron's `userData`). */
  readonly userDataDir: string;
  /** Stamped into conversation files and run records. */
  readonly appVersion: string;
  /** Where the application's sources are, for finding DSpatch's own working copy. */
  readonly appPath: string;
  /**
   * The client process. The host ends itself when this process is gone, so that work
   * does not go on without the application that started it (DSP-111: continuing work
   * without a client is not part of this step).
   */
  readonly clientPid: number;
}

export const HOST_CONFIG_ENV = 'DSPATCH_HOST_CONFIG';

/** Parse the start configuration, or say what is wrong with it. */
export function parseHostStartConfig(text: string | undefined): HostStartConfig | { readonly error: string } {
  if (text === undefined || text.trim() === '') {
    return { error: `${HOST_CONFIG_ENV} is not set, so the host does not know where DSpatch keeps its data.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `${HOST_CONFIG_ENV} is not JSON: ${String(error)}` };
  }
  const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const { userDataDir, appVersion, appPath, clientPid } = record;
  if (typeof userDataDir !== 'string' || userDataDir === '') {
    return { error: `${HOST_CONFIG_ENV} names no userDataDir.` };
  }
  if (typeof appVersion !== 'string' || typeof appPath !== 'string' || typeof clientPid !== 'number') {
    return { error: `${HOST_CONFIG_ENV} lacks appVersion, appPath or clientPid.` };
  }
  return { userDataDir, appVersion, appPath, clientPid };
}

/**
 * The host's part of the window's environment reading (`chat.environment`). The
 * application's own name, version, build and versions are the client's; the agent is
 * the host's.
 */
export type HostEnvironmentFacts = Pick<EnvironmentInfo, 'adapter' | 'agentChoice' | 'chosenAgent'>;

/** How the host's own close went (`host.shutdown`), for the client's record of the shutdown. */
export interface HostShutdownAnswer {
  readonly completed: boolean;
  readonly detail: string;
  /** The conversation files read after the close, when the client asked for them. */
  readonly conversationFiles: readonly unknown[] | null;
}
