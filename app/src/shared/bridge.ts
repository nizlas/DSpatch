/**
 * Contract between the renderer and the main process.
 *
 * This file contains **types only**. That is a requirement: sandboxed preload
 * may import only Electron modules as values. A type import disappears during
 * compilation and is therefore safe.
 *
 * The adapter itself stays in the main process. Everything the chat surface can
 * do is listed here, and it is reached only over IPC.
 */

import type {
  AgentEventType,
  CapabilityReport,
  TerminalRunStatus,
  UsageReading,
} from '../adapter/types';

/** Versions shown by the renderer. Obtained in the main process, never the renderer. */
export interface RuntimeVersions {
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
  readonly v8: string;
}

/** The source of renderer content. Displayed by the UI without inference. */
export type RendererSource = 'dev-server' | 'built-files';

/** What the main process knows about the app and adapter at startup. */
export interface EnvironmentInfo {
  readonly appName: string;
  readonly appVersion: string;
  readonly platform: string;
  readonly rendererSource: RendererSource;
  readonly versions: RuntimeVersions;
  readonly adapter: {
    readonly id: string;
    readonly capabilities: CapabilityReport;
  };
}

/** Renderer acknowledgement of mounting and painting. Evidence for the smoke test. */
export interface RendererReady {
  readonly headingText: string;
  readonly capabilityCount: number;
  readonly renderedAt: string;
}

/**
 * Connection status for the provider account.
 *
 * `account` is `string | null` and `null` means **unknown**, not "no account".
 * The same rule as cost: a missing value is never presented as an answer.
 */
export type ConnectionStatus =
  | { readonly kind: 'checking' }
  | {
      readonly kind: 'connected';
      readonly provider: 'cursor';
      /** The account the provider reports. `null` when the provider did not say. */
      readonly account: string | null;
      readonly backendUrl: string;
      /** Where the credential came from. Never the credential itself. */
      readonly credentialSource: string;
      readonly credentialStorePath: string;
      readonly credentialExpiresAtUtc: string | null;
      /** Models the account can request. `null` means the list was not read. */
      readonly modelsAvailable: number | null;
      readonly modelRequested: string;
      readonly checkedAtUtc: string;
    }
  | {
      readonly kind: 'not-connected';
      readonly reason: string;
      readonly credentialStorePath: string;
      readonly checkedAtUtc: string;
    }
  | { readonly kind: 'error'; readonly message: string; readonly checkedAtUtc: string };

/** One session over one working copy. */
export interface ChatSessionInfo {
  readonly dspatchSessionId: string;
  readonly providerSessionId: string;
  readonly modelRequested: string;
  readonly workspacePath: string;
  readonly createdAt: string;
  readonly toolPolicy: string;
  /** How the working copy came to exist, stated rather than implied. */
  readonly workspaceOrigin: string;
  readonly testCommand: string | null;
  /** Absent when no Node executable was found; the UI must then say so. */
  readonly testRunnerPath: string | null;
  readonly testRunnerSource: string | null;
}

/** A file difference established by hashing bytes, not by an agent's account. */
export interface WorkspaceChange {
  readonly relPath: string;
  /** `null` when the file did not exist before. */
  readonly beforeSha256: string | null;
  /** `null` when the file no longer exists. */
  readonly afterSha256: string | null;
  readonly beforeBytes: number | null;
  readonly afterBytes: number | null;
}

/** On-disk state of the working copy compared with the session's baseline. */
export interface WorkspaceReport {
  readonly workspacePath: string;
  readonly baselineTakenAtUtc: string;
  readonly observedAtUtc: string;
  readonly changed: readonly WorkspaceChange[];
  readonly added: readonly WorkspaceChange[];
  readonly removed: readonly WorkspaceChange[];
  readonly unchangedCount: number;
}

/** A test run that DSpatch started, so the exit code is DSpatch's observation. */
export interface TestOutcome {
  readonly command: string;
  readonly cwd: string;
  readonly pid: number | null;
  /** `null` with a signal means the process was killed rather than exiting. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly startedAtUtc: string;
  readonly finishedAtUtc: string;
}

/** What `cancelRun` could measure immediately. */
export interface CancelOutcome {
  readonly requestedAtUtc: string;
  /** Time for the provider call to resolve. Milliseconds, one decimal. */
  readonly elapsedMs: number;
  readonly error: string | null;
  /**
   * Whether the terminal state was decided locally or by the provider is not
   * knowable from this call. `watchSeconds` says how long DSpatch will keep
   * looking for continued provider-side work afterwards.
   */
  readonly watchSeconds: number;
}

/**
 * Evidence about whether the provider kept working after cancellation.
 *
 * This is the one open question from substep 6: `cancel()` reported `cancelled`
 * far too quickly to contain a round trip, so the terminal state is decided
 * locally. Continued tool events, later file changes or a later usage record
 * would settle it. `verdict` stays `unresolved` unless something is observed.
 */
export interface CancelObservations {
  readonly attempted: boolean;
  readonly watching: boolean;
  readonly cancelledAtUtc: string | null;
  readonly toolEventsBeforeCancel: number;
  readonly toolEventsAfterCancel: number;
  readonly eventsAfterTerminalEvent: number;
  readonly usageEventsAfterCancel: number;
  readonly workspaceFileCountAtCancel: number | null;
  readonly workspaceFileCountAfterWatch: number | null;
  readonly workspaceChangedAfterCancel: boolean | null;
  readonly watchedSeconds: number;
  readonly verdict:
    | 'unresolved'
    | 'provider-kept-working'
    | 'no-continued-work-observed';
  readonly note: string;
}

/**
 * An agent event as the renderer sees it.
 *
 * `rawProviderEvent` is deliberately dropped on the way across: the renderer
 * cannot use it, and it is not reliably structured-cloneable. The main process
 * keeps the unchanged event.
 */
export interface UiAgentEvent {
  readonly type: AgentEventType;
  readonly dspatchSessionId: string;
  readonly dspatchRunId: string;
  readonly at: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly toolStatus?: 'ok' | 'error';
  readonly approvalSummary?: string;
  readonly readings?: readonly UsageReading[];
  readonly status?: TerminalRunStatus;
  readonly errorMessage?: string;
}

/** Token totals seen for one turn. Every field may be `null` — unknown, not 0. */
export interface TurnUsage {
  readonly totalTokens: number | null;
  readonly source: string;
}

/**
 * Instruction to drive the window through the whole workflow without a human.
 *
 * The point is evidence: the packaged artifact runs its own real UI controls and
 * records what reached the DOM, so "the window can do this" is checkable rather
 * than narrated. `null` means normal interactive operation.
 */
export interface ScriptedRunPlan {
  readonly enabled: true;
  readonly turnTimeoutMs: number;
  readonly note: string;
}

/** Where the renderer's own observations end up. */
export interface ScriptedRunReport {
  readonly passed: boolean;
  readonly exitCode: number;
  readonly steps: readonly unknown[];
  readonly failures: readonly string[];
  readonly observations: Readonly<Record<string, unknown>>;
}

/** The only main-process interface accessible to the renderer, via `contextBridge`. */
export interface DspatchBridge {
  getEnvironment(): Promise<EnvironmentInfo>;
  reportReady(ready: RendererReady): void;

  /** Connection status for the provider account. Never returns a credential. */
  getConnection(): Promise<ConnectionStatus>;
  /** Open a session over the generated working copy. Replaces any open session. */
  startChatSession(): Promise<ChatSessionInfo>;
  sendPrompt(text: string): Promise<{ readonly dspatchRunId: string }>;
  cancelRun(): Promise<CancelOutcome>;
  getCancelObservations(): Promise<CancelObservations>;
  /** Run the working copy's test as a child of the main process. */
  runWorkspaceTest(): Promise<TestOutcome>;
  getWorkspaceChanges(): Promise<WorkspaceReport>;
  /** Token totals for a turn. Fields may be `null`: unknown, never 0. */
  getTurnUsage(dspatchRunId: string): Promise<TurnUsage>;
  onAgentEvent(listener: (event: UiAgentEvent) => void): () => void;

  getScriptedRun(): Promise<ScriptedRunPlan | null>;
  reportScriptedRun(report: ScriptedRunReport): void;
}

/**
 * Channel names. Preload must write these as literals: a shared constant would
 * be a value, which cannot be imported into sandboxed preload. The type catches
 * misspellings during type checking instead.
 */
export type BridgeChannel =
  | 'dspatch:get-environment'
  | 'dspatch:renderer-ready'
  | 'dspatch:get-connection'
  | 'dspatch:start-session'
  | 'dspatch:send-prompt'
  | 'dspatch:cancel-run'
  | 'dspatch:cancel-observations'
  | 'dspatch:run-test'
  | 'dspatch:workspace-changes'
  | 'dspatch:turn-usage'
  | 'dspatch:agent-event'
  | 'dspatch:get-scripted-run'
  | 'dspatch:scripted-run-report';
