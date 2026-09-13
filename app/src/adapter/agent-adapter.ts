import type {
  AgentEventListener,
  ApprovalDecision,
  CapabilityReport,
  DspatchSessionId,
  ModelInfo,
  RunReference,
  SessionConfig,
  SessionHandle,
  Unsubscribe,
  UsageQuery,
  UsageReading,
} from './types';

/**
 * DSpatch's boundary to an agent provider.
 *
 * The interface operates at **session granularity**. This matters for both
 * providers: Copilot has no run-level object, and subscribing after `send` loses
 * events with either provider. Copilot documents `session.on(...)` before the
 * first prompt; Cursor's race-free path passes callbacks into `send`.
 *
 * **Invariant: at most one active run per session.** Neither provider guarantees
 * otherwise. Copilot documents "No session locking — concurrent access to same
 * session is undefined", and Cursor throws `AgentBusyError` for cloud runs.
 * VISION section 14 already requires just one writing run at a time in Phase 0.
 * If `send` is called while a run is active, reject the call rather than queue it.
 *
 * No provider implementation exists yet. `NotImplementedAdapter` is the sole
 * implementation in substep 2 and calls no provider.
 */
export interface AgentAdapter {
  /**
   * Start a new session. Subscribe with `subscribe` **before** the first `send`
   * to avoid losing events.
   */
  startSession(config: SessionConfig): Promise<SessionHandle>;

  /**
   * Resume an earlier session. Resend configuration: neither provider persists
   * all of it, so DSpatch owns it.
   */
  resume(
    sessionId: DspatchSessionId,
    config: SessionConfig,
  ): Promise<SessionHandle>;

  /**
   * Send a prompt and return the identity used to group its events.
   * Reject if the session already has an active run.
   */
  send(sessionId: DspatchSessionId, prompt: string): Promise<RunReference>;

  /**
   * Establish at session start, before the first `send`. The listener receives
   * all runs in the session; each event carries `dspatchRunId` to distinguish them.
   */
  subscribe(
    sessionId: DspatchSessionId,
    onEvent: AgentEventListener,
  ): Unsubscribe;

  /**
   * Cancel the session's current turn. The session remains available for a new prompt.
   *
   * Neither provider documents whether an in-flight remote model call is actually
   * stopped. Measure this rather than assuming it.
   */
  cancel(sessionId: DspatchSessionId): Promise<void>;

  /** Models this adapter instance can request. */
  listModels(): Promise<readonly ModelInfo[]>;

  /**
   * Read usage. Return a missing value as `null`, never `0`.
   * An empty list means the adapter had no readings to supply.
   */
  readUsage(scope: UsageQuery): Promise<readonly UsageReading[]>;

  /**
   * Answer a pending approval request. The adapter may report this as unsupported;
   * `capabilities().approvals` must then be `unsupported`.
   */
  respondToApproval(
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<void>;

  /** What this particular instance supports: provider plus transport. */
  capabilities(): CapabilityReport;

  /**
   * Dispose the adapter before the app exits: a provider path may own a child
   * process or local storage with open files. Idempotent and must not throw,
   * because it is called while the app is already shutting down.
   */
  dispose(): Promise<void>;
}
