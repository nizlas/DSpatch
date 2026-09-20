import { createHash, randomUUID } from 'node:crypto';

import {
  Agent,
  Cursor,
  CursorSdkError,
  getDefaultSdkStateRoot,
  type AgentUsage,
  type ModelSelection,
  type Run,
  type SDKAgent,
  type SDKMessage,
} from '@cursor/sdk';

import type { AgentAdapter } from './agent-adapter';
import type {
  AdapterError,
  AgentEvent,
  AgentEventListener,
  ApprovalDecision,
  ApprovalRequest,
  CapabilityReport,
  DspatchRunId,
  DspatchSessionId,
  ModelInfo,
  RunReference,
  RunStatus,
  SessionConfig,
  SessionHandle,
  TerminalRunStatus,
  Timestamp,
  Unsubscribe,
  UsageQuery,
  UsageReading,
} from './types';

/**
 * Cursor's `@cursor/sdk` behind DSpatch's adapter boundary.
 *
 * **Main process only.** This file requires `@cursor/sdk`, which pulls in Node
 * built-ins and a native platform package. The renderer must never import it;
 * `tsconfig.renderer.json` excludes it so a mistake fails the typecheck rather
 * than the packaged build.
 *
 * Credentials are never read, held or logged here. The SDK resolves them itself
 * from its own store outside the repository (`~/.cursor/sdk/auth.json`). This
 * adapter passes no `apiKey`, so the stored login is the only source.
 */

/** Error thrown by adapter operations. Satisfies {@link AdapterError}. */
export class CursorAdapterError extends Error implements AdapterError {
  /** Cursor's own code, unchanged, when the SDK supplied one. */
  readonly providerCode?: string;

  constructor(message: string, providerCode?: string, cause?: unknown) {
    super(message);
    this.name = 'CursorAdapterError';
    if (providerCode !== undefined) {
      this.providerCode = providerCode;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Which built-in tools the agent may use.
 *
 * Not part of {@link SessionConfig}: the agreed interface shape is fixed, and
 * this is a containment choice belonging to the adapter instance rather than to
 * a session. `text-only` passes `tools: []`, which the SDK documents as "no
 * built-in tools; the model can only respond with text" — the cheapest available
 * containment for a connection experiment that must not touch any file.
 * Substep 5, which asks the agent to change a file, needs `provider-default`.
 */
export type ToolPolicy = 'text-only' | 'provider-default';

export interface CursorSdkAdapterOptions {
  readonly toolPolicy?: ToolPolicy;
}

/**
 * What this adapter instance supports: Cursor **plus the SDK transport**, not
 * Cursor in general.
 *
 * `approvals` is `unsupported`, not `unknown`. Cursor documents that hooks are
 * file-based with no programmatic callbacks and that headless SDK runs have no
 * human-in-the-loop approval flow. What remains unknown is the response path for
 * a single `{type:"request"}` stream event, not the capability; the adapter makes
 * that event observable instead of guessing.
 *
 * `cancel` and `resume` are reported as supported because this adapter calls the
 * SDK's documented `run.cancel()` and `Agent.resume()`. Neither has been observed
 * working here — substeps 5 and 6 do that. A capability report states what the
 * instance offers; it is not a verification record.
 *
 * `usageReporting` is `unknown`, and that is the honest value rather than a
 * cautious one. Observed in substeps 4 and 5 on this account: per-turn **token**
 * counts arrive as `SDKUsageMessage` on the run stream, while the account-level
 * **cost** API `agent.getUsage()` is refused with HTTP 403 `UnknownAgentError
 * [feature_unavailable] This feature is not available for your account` — for
 * local agents specifically, before the agent is even looked up, so it is an
 * entitlement gate and not a billing lag.
 *
 * One value per capability cannot express "tokens yes, cost no", and the field is
 * deliberately **not** split: `UsageReading` already carries `unit`, `source` and
 * `value: null`, so the per-reading data is precise where it matters. What the
 * one-word summary must not do is make a UI render a cost field and leave it
 * blank, which is the "missing cost presented as nothing" that VISION 12 forbids.
 * `unknown` under-promises and forces the UI to say it does not know; `supported`
 * over-promises exactly where money should appear. If cost starts answering, this
 * becomes `supported` with no interface change.
 */
const CAPABILITIES: CapabilityReport = {
  start: 'supported',
  streaming: 'supported',
  cancel: 'supported',
  resume: 'supported',
  modelSelection: 'supported',
  approvals: 'unsupported',
  usageReporting: 'unknown',
};

interface ActiveRun {
  readonly dspatchRunId: DspatchRunId;
  run: Run | null;
  status: RunStatus;
  /** Set once the stream pump has stopped, so a stuck pump is visible. */
  streamPumpFinished: boolean;
  /**
   * Assistant text accumulated from the message stream.
   *
   * Observed in substep 4: Cursor's SDK transport emits one `assistant` message
   * per text fragment — 14 of them for a single 165-character answer, with the
   * last carrying only `"\nTen\nEleven\nTwelve"`. They are **increments, not
   * cumulative snapshots**, and they carry the same fragments as `onDelta`'s
   * `text-delta`. So they are concatenated here and emitted once, as one
   * `assistant.message`, when the run ends. Emitting per arrival would duplicate
   * the delta stream and make the event name untrue.
   */
  assistantText: string;
}

interface SessionState {
  readonly dspatchSessionId: DspatchSessionId;
  readonly config: SessionConfig;
  readonly agent: SDKAgent;
  readonly providerSessionId: string;
  readonly createdAt: Timestamp;
  readonly listeners: Set<AgentEventListener>;
  /** Per-turn readings observed on the stream, keyed by our run ID. */
  readonly runReadings: Map<DspatchRunId, UsageReading[]>;
  /** Pending approval requests seen on the stream, by Cursor's request ID. */
  readonly pendingApprovals: Map<string, ApprovalRequest>;
  /** `SDKMessage.type` counts, so an empty message stream is visible as empty. */
  readonly providerMessageTypes: Map<string, number>;
  activeRun: ActiveRun | null;
  /** Kept after the run ends: `activeRun` is cleared, but the facts still matter. */
  lastRun: ActiveRun | null;
  /** The model Cursor reported actually using. May differ from the request. */
  modelReportedValue: string | null;
}

function nowIso(): Timestamp {
  return new Date().toISOString();
}

/** Provider numbers are untrusted input: anything not finite becomes unknown. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readProviderCode(error: unknown): string | undefined {
  if (error instanceof CursorSdkError) {
    return error.code;
  }
  // Defensive: a dual ESM/CJS load would break `instanceof` while the field
  // remains present.
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function toAdapterError(operation: string, error: unknown): CursorAdapterError {
  const name =
    error instanceof Error && error.name !== '' ? error.name : 'UnknownError';
  const message = error instanceof Error ? error.message : String(error);
  return new CursorAdapterError(
    `Cursor adapter operation "${operation}" failed: ${name}: ${message}`,
    readProviderCode(error),
    error,
  );
}

/** DSpatch's own session ID. Filename-safe: a provider may use it in a path. */
function newSessionId(): DspatchSessionId {
  return `dsp-session-${randomUUID()}`;
}

function newRunId(): DspatchRunId {
  return `dsp-run-${randomUUID()}`;
}

/**
 * Cursor's agent ID for one of DSpatch's session IDs.
 *
 * **Cursor's format requirement is stricter than "not `bc-`".** Observed in
 * substep 4: `Agent.create({ agentId: "dsp-session-<uuid>" })` succeeds and two
 * full turns stream fine, but `agent.getUsage()` then fails with
 * `ConfigurationError [validation_error] Agent ID must be in the format
 * 'bc-<uuid>' (cloud) or 'agent-<uuid>' (local)`. Create and send are lenient;
 * the usage path validates. So the ID must be `agent-<uuid>`, and DSpatch's own
 * ID has to be mapped rather than passed through.
 *
 * The mapping is a SHA-256 digest of the DSpatch session ID, shaped as a
 * version-4 UUID. Deterministic on purpose: `resume` can then find the provider's
 * agent after a process restart without DSpatch persisting a mapping table,
 * which is DSP-4's concern rather than this adapter's.
 *
 * Exported so that a probe outside the app can address exactly the agent DSpatch
 * would address. A probe that recomputed the mapping would be measuring its own
 * copy of it.
 */
export function providerAgentIdFor(dspatchSessionId: DspatchSessionId): string {
  const hex = createHash('sha256').update(dspatchSessionId).digest('hex');
  const at = (index: number): string => hex[index] ?? '0';
  const variant = ((parseInt(at(16), 16) & 0x3) | 0x8).toString(16);
  return (
    `agent-${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}` +
    `-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

export class CursorSdkAdapter implements AgentAdapter {
  /** The adapter identity shown in the UI: provider plus transport. */
  readonly id = 'cursor-sdk';

  private readonly toolPolicy: ToolPolicy;

  private readonly sessions = new Map<DspatchSessionId, SessionState>();

  private disposed = false;

  constructor(options: CursorSdkAdapterOptions = {}) {
    this.toolPolicy = options.toolPolicy ?? 'provider-default';
  }

  async startSession(config: SessionConfig): Promise<SessionHandle> {
    this.assertUsable();
    this.assertCursorProvider(config);
    const dspatchSessionId = config.dspatchSessionId ?? newSessionId();
    if (this.sessions.has(dspatchSessionId)) {
      throw new CursorAdapterError(
        `Session "${dspatchSessionId}" is already open. Close it before reusing the ID.`,
      );
    }

    let agent: SDKAgent;
    try {
      agent = await Agent.create({
        agentId: providerAgentIdFor(dspatchSessionId),
        model: this.modelSelection(config),
        name: `DSpatch ${dspatchSessionId}`,
        ...(this.toolPolicy === 'text-only' ? { tools: [] } : {}),
        local: { cwd: config.workspacePath },
      });
    } catch (error) {
      throw toAdapterError('startSession', error);
    }

    return this.register(dspatchSessionId, config, agent);
  }

  /**
   * Resume an earlier session through Cursor's own local store, which survives a
   * process restart.
   *
   * **Implemented but not exercised here.** Substep 4 starts one fresh session;
   * DSP-4 depends on this path and substeps 5–7 are where it gets tested. Do not
   * read the code's existence as evidence that it works.
   */
  async resume(
    sessionId: DspatchSessionId,
    config: SessionConfig,
  ): Promise<SessionHandle> {
    this.assertUsable();
    this.assertCursorProvider(config);
    if (this.sessions.has(sessionId)) {
      throw new CursorAdapterError(
        `Session "${sessionId}" is already open in this adapter instance.`,
      );
    }

    let agent: SDKAgent;
    try {
      agent = await Agent.resume(providerAgentIdFor(sessionId), {
        model: this.modelSelection(config),
        ...(this.toolPolicy === 'text-only' ? { tools: [] } : {}),
        local: { cwd: config.workspacePath },
      });
    } catch (error) {
      throw toAdapterError('resume', error);
    }

    return this.register(sessionId, config, agent);
  }

  /**
   * Send a prompt.
   *
   * Callbacks go **into** the provider's `send` rather than being attached to the
   * returned handle: that is Cursor's race-free path, and attaching afterwards
   * loses early events. `subscribe` must therefore be established before the
   * first `send`, which is why the adapter is session-granular.
   */
  async send(
    sessionId: DspatchSessionId,
    prompt: string,
  ): Promise<RunReference> {
    this.assertUsable();
    const state = this.requireSession(sessionId);
    if (state.activeRun !== null) {
      throw new CursorAdapterError(
        `Session "${sessionId}" already has an active run ` +
          `(${state.activeRun.dspatchRunId}). At most one run per session.`,
      );
    }

    const dspatchRunId = newRunId();
    const activeRun: ActiveRun = {
      dspatchRunId,
      run: null,
      status: 'created',
      streamPumpFinished: false,
      assistantText: '',
    };
    state.activeRun = activeRun;
    state.lastRun = activeRun;

    this.emit(state, {
      type: 'run.started',
      dspatchSessionId: sessionId,
      dspatchRunId,
      at: nowIso(),
      rawProviderEvent: null,
    });
    activeRun.status = 'running';

    let run: Run;
    try {
      run = await state.agent.send(prompt, {
        model: this.modelSelection(state.config),
        onDelta: ({ update }) => {
          this.handleDelta(state, dspatchRunId, update);
        },
      });
    } catch (error) {
      const adapterError = toAdapterError('send', error);
      this.finishRun(state, activeRun, 'error', {
        message: adapterError.message,
        ...(adapterError.providerCode === undefined
          ? {}
          : { providerCode: adapterError.providerCode }),
      });
      throw adapterError;
    }

    activeRun.run = run;
    void this.consumeRun(state, activeRun, run);
    return { dspatchRunId };
  }

  /**
   * Whether this adapter is holding a run for the session.
   *
   * Beyond {@link AgentAdapter}, and the reason is report 008's first defect. Two
   * layers refuse a second run in one session, in nearly the same sentence: this
   * adapter's own guard above, and Cursor itself when a session that was resumed
   * still holds a run started before the restart. Only the first produces events
   * DSpatch will see, so only the first can honestly be described as something to
   * wait for — and the difference is a fact about this adapter, not a difference in
   * wording. `false` for an unknown session: an adapter that is not holding the
   * session is not holding its run either.
   */
  hasActiveRun(sessionId: DspatchSessionId): boolean {
    return this.sessions.get(sessionId)?.activeRun != null;
  }

  subscribe(
    sessionId: DspatchSessionId,
    onEvent: AgentEventListener,
  ): Unsubscribe {
    const state = this.requireSession(sessionId);
    state.listeners.add(onEvent);
    let removed = false;
    return () => {
      if (removed) {
        return;
      }
      removed = true;
      state.listeners.delete(onEvent);
    };
  }

  /**
   * Cancel the session's current turn.
   *
   * **Implemented but not exercised here.** Substep 6 measures what cancellation
   * actually does, including whether the in-flight remote model call stops.
   */
  async cancel(sessionId: DspatchSessionId): Promise<void> {
    this.assertUsable();
    const state = this.requireSession(sessionId);
    const activeRun = state.activeRun;
    if (activeRun === null || activeRun.run === null) {
      throw new CursorAdapterError(
        `Session "${sessionId}" has no cancellable run in progress.`,
      );
    }
    if (!activeRun.run.supports('cancel')) {
      throw new CursorAdapterError(
        `Cursor reports this run as not cancellable: ` +
          `${activeRun.run.unsupportedReason('cancel') ?? 'no reason given'}`,
      );
    }
    try {
      await activeRun.run.cancel();
    } catch (error) {
      throw toAdapterError('cancel', error);
    }
  }

  async listModels(): Promise<readonly ModelInfo[]> {
    this.assertUsable();
    try {
      const models = await Cursor.models.list();
      return models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        provider: 'cursor' as const,
      }));
    } catch (error) {
      throw toAdapterError('listModels', error);
    }
  }

  /**
   * Read usage.
   *
   * A missing number is `null`, never `0`: Cursor documents cost as
   * "server-derived and eventually consistent", so an absent cost can mean either
   * "not reported yet" or "not billed". `source` and `observedAt` carry that
   * distinction; the value itself must not claim zero.
   *
   * `UsageReading` holds one scalar, so the token breakdown becomes several
   * readings that share `observedAt` and differ in `source`. The provider's
   * unchanged response is available from {@link readUsageRaw}.
   */
  async readUsage(scope: UsageQuery): Promise<readonly UsageReading[]> {
    this.assertUsable();
    if (scope.of === 'run') {
      for (const state of this.sessions.values()) {
        const readings = state.runReadings.get(scope.dspatchRunId);
        if (readings !== undefined) {
          return [...readings];
        }
      }
      return [];
    }

    const state = this.requireSession(scope.dspatchSessionId);
    const usage = await this.fetchUsage(state);
    return this.toUsageReadings(usage);
  }

  /**
   * The provider's usage response, unchanged.
   *
   * Beyond {@link AgentAdapter}: AC#4 asks for an initial reading recorded
   * verbatim in structure, and normalising into `UsageReading` scalars loses the
   * shape. Adding a method to this class does not change the agreed interface,
   * and nothing outside the experiment depends on it.
   */
  async readUsageRaw(sessionId: DspatchSessionId): Promise<unknown> {
    this.assertUsable();
    return this.fetchUsage(this.requireSession(sessionId));
  }

  /**
   * Cursor's SDK path has no programmatic approval response, so this throws
   * rather than pretending. `capabilities().approvals` is `unsupported` to match.
   * The adapter still surfaces `{type:"request"}` as `approval.requested`, so a
   * pending approval is visible as waiting instead of looking like a hang.
   */
  respondToApproval(
    requestId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    return Promise.reject(
      new CursorAdapterError(
        `Cursor's SDK path cannot answer approval request "${requestId}". ` +
          'Cursor documents file-based hooks with no programmatic callbacks, and ' +
          'no human-in-the-loop approval flow in headless SDK runs. The request is ' +
          'reported so it is visible as waiting, but DSpatch cannot answer it on ' +
          'this transport.',
      ),
    );
  }

  capabilities(): CapabilityReport {
    return CAPABILITIES;
  }

  /**
   * Close every open session. Idempotent and never throws: it runs while the
   * application is already shutting down. The SDK owns a local agent runtime and
   * an on-disk store with open files, so skipping this leaves them behind.
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const states = [...this.sessions.values()];
    this.sessions.clear();
    for (const state of states) {
      state.listeners.clear();
      try {
        await state.agent[Symbol.asyncDispose]();
      } catch {
        // Shutdown path: a failed close must not prevent the app from exiting.
      }
    }
  }

  /** Where the SDK keeps local agent state for a workspace. Outside the repo. */
  static localStateRootFor(workspacePath: string): string {
    return getDefaultSdkStateRoot(workspacePath);
  }

  private register(
    dspatchSessionId: DspatchSessionId,
    config: SessionConfig,
    agent: SDKAgent,
  ): SessionHandle {
    const createdAt = nowIso();
    this.sessions.set(dspatchSessionId, {
      dspatchSessionId,
      config,
      agent,
      providerSessionId: agent.agentId,
      createdAt,
      listeners: new Set(),
      runReadings: new Map(),
      pendingApprovals: new Map(),
      providerMessageTypes: new Map(),
      activeRun: null,
      lastRun: null,
      modelReportedValue: null,
    });
    return {
      dspatchSessionId,
      provider: 'cursor',
      providerSessionId: agent.agentId,
      createdAt,
    };
  }

  private modelSelection(config: SessionConfig): ModelSelection {
    return { id: config.modelRequested };
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new CursorAdapterError(
        'This adapter instance has been disposed. Create a new one.',
      );
    }
  }

  private assertCursorProvider(config: SessionConfig): void {
    if (config.provider !== 'cursor') {
      throw new CursorAdapterError(
        `This adapter serves the "cursor" provider, not "${config.provider}".`,
      );
    }
  }

  private requireSession(sessionId: DspatchSessionId): SessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      throw new CursorAdapterError(
        `Unknown session "${sessionId}". Start or resume it first.`,
      );
    }
    return state;
  }

  private emit(state: SessionState, event: AgentEvent): void {
    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch {
        // A listener must not throw. Swallowing here keeps one bad subscriber
        // from breaking the provider stream for everyone else.
      }
    }
  }

  /**
   * The model Cursor reported using, which need not match the request.
   *
   * Three sources, in order of directness: the `system` init message, the
   * terminal `RunResult.model`, and the SDK's own `agent.model`, which it
   * documents as updated after each successful `send({ model })`. `null` means no
   * source answered — unknown, not "the requested model".
   */
  modelReported(sessionId: DspatchSessionId): string | null {
    const state = this.requireSession(sessionId);
    return state.modelReportedValue ?? state.agent.model?.id ?? null;
  }

  /** Approval requests seen but unanswerable on this transport. */
  pendingApprovals(sessionId: DspatchSessionId): readonly ApprovalRequest[] {
    return [...this.requireSession(sessionId).pendingApprovals.values()];
  }

  /**
   * `SDKMessage.type` counts observed on `run.stream()`.
   *
   * An empty map means the message stream delivered nothing, which is a real
   * finding rather than a missing feature: without it, `{type:"request"}` could
   * never be observed at all.
   */
  providerMessageTypes(sessionId: DspatchSessionId): Record<string, number> {
    return Object.fromEntries(this.requireSession(sessionId).providerMessageTypes);
  }

  /** Whether the stream pump for the most recent run stopped on its own. */
  streamPumpFinished(sessionId: DspatchSessionId): boolean | null {
    const lastRun = this.requireSession(sessionId).lastRun;
    return lastRun === null ? null : lastRun.streamPumpFinished;
  }

  /**
   * Map Cursor's delta stream. Only `text-delta` and `thinking-delta` are turned
   * into text events; the rest arrive through the message stream below, so no
   * event is produced twice.
   */
  private handleDelta(
    state: SessionState,
    dspatchRunId: DspatchRunId,
    update: { readonly type: string },
  ): void {
    const base = {
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId,
      at: nowIso(),
      rawProviderEvent: update,
    };
    if (update.type === 'text-delta') {
      const { text } = update as { text?: unknown };
      this.emit(state, {
        ...base,
        type: 'assistant.delta',
        text: typeof text === 'string' ? text : '',
      });
      return;
    }
    if (update.type === 'thinking-delta') {
      const { text } = update as { text?: unknown };
      this.emit(state, {
        ...base,
        type: 'reasoning.delta',
        text: typeof text === 'string' ? text : '',
      });
    }
  }

  /**
   * Follow the run to its end.
   *
   * Two provider streams carry different things. `onDelta` above gives incremental
   * text; `run.stream()` gives `SDKMessage`, which is the only place
   * `{type:"request"}` appears. Both are consumed, and the pump's own completion
   * is recorded so a stream that never ends is visible rather than silent.
   */
  private async consumeRun(
    state: SessionState,
    activeRun: ActiveRun,
    run: Run,
  ): Promise<void> {
    const pump = this.pumpMessages(state, activeRun, run);
    try {
      const result = await run.wait();
      await pump;
      if (state.modelReportedValue === null && result.model !== undefined) {
        state.modelReportedValue = result.model.id;
      }
      const status: TerminalRunStatus =
        result.status === 'finished'
          ? 'finished'
          : result.status === 'cancelled'
            ? 'cancelled'
            : 'error';
      const error = result.error;
      this.finishRun(
        state,
        activeRun,
        status,
        error === undefined
          ? undefined
          : {
              message: error.message,
              ...(error.code === undefined ? {} : { providerCode: error.code }),
            },
        result,
      );
    } catch (error) {
      const adapterError = toAdapterError('run.wait', error);
      this.finishRun(state, activeRun, 'error', {
        message: adapterError.message,
        ...(adapterError.providerCode === undefined
          ? {}
          : { providerCode: adapterError.providerCode }),
      });
    }
  }

  private async pumpMessages(
    state: SessionState,
    activeRun: ActiveRun,
    run: Run,
  ): Promise<void> {
    if (!run.supports('stream')) {
      activeRun.streamPumpFinished = true;
      return;
    }
    try {
      for await (const message of run.stream()) {
        this.handleMessage(state, activeRun, message);
      }
    } catch {
      // The run's terminal state comes from `wait()`. A broken tail must not
      // replace that with an error the run did not actually have.
    } finally {
      activeRun.streamPumpFinished = true;
    }
  }

  private handleMessage(
    state: SessionState,
    activeRun: ActiveRun,
    message: SDKMessage,
  ): void {
    const { dspatchRunId } = activeRun;
    const base = {
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId,
      at: nowIso(),
      rawProviderEvent: message,
    };
    state.providerMessageTypes.set(
      message.type,
      (state.providerMessageTypes.get(message.type) ?? 0) + 1,
    );

    switch (message.type) {
      case 'system': {
        if (message.model !== undefined) {
          state.modelReportedValue = message.model.id;
        }
        return;
      }
      case 'assistant': {
        // Accumulated, not emitted: see `ActiveRun.assistantText`.
        activeRun.assistantText += message.message.content
          .filter((block): block is { type: 'text'; text: string } => {
            return block.type === 'text';
          })
          .map((block) => block.text)
          .join('');
        return;
      }
      case 'tool_call': {
        if (message.status === 'running') {
          this.emit(state, {
            ...base,
            type: 'tool.started',
            toolCallId: message.call_id,
            name: message.name,
          });
          return;
        }
        this.emit(state, {
          ...base,
          type: 'tool.finished',
          toolCallId: message.call_id,
          name: message.name,
          status: message.status === 'completed' ? 'ok' : 'error',
        });
        return;
      }
      case 'request': {
        // The decision from substep 2: map this to the approval state and keep
        // the raw event, so the one thing still unknown about Cursor's approvals
        // becomes observable at no extra cost.
        const request: ApprovalRequest = {
          requestId: message.request_id,
          summary:
            'Cursor reported {type:"request"} — awaiting user input or approval. ' +
            'The SDK transport offers no way to answer it.',
          requestedAt: base.at,
        };
        state.pendingApprovals.set(request.requestId, request);
        activeRun.status = 'awaiting_approval';
        this.emit(state, { ...base, type: 'approval.requested', request });
        return;
      }
      case 'usage': {
        const readings = this.tokenReadings(message.usage, base.at);
        const existing = state.runReadings.get(dspatchRunId) ?? [];
        state.runReadings.set(dspatchRunId, [...existing, ...readings]);
        this.emit(state, { ...base, type: 'usage', readings });
        return;
      }
      case 'status': {
        if (activeRun.status === 'awaiting_approval' && message.status === 'RUNNING') {
          activeRun.status = 'running';
        }
        return;
      }
      case 'user':
      case 'thinking':
      case 'task':
        return;
      default:
        return;
    }
  }

  private finishRun(
    state: SessionState,
    activeRun: ActiveRun,
    status: TerminalRunStatus,
    error?: AdapterError,
    rawProviderEvent: unknown = null,
  ): void {
    if (state.activeRun === activeRun) {
      state.activeRun = null;
    }
    activeRun.status = status;
    if (activeRun.assistantText !== '') {
      this.emit(state, {
        type: 'assistant.message',
        dspatchSessionId: state.dspatchSessionId,
        dspatchRunId: activeRun.dspatchRunId,
        at: nowIso(),
        rawProviderEvent: null,
        text: activeRun.assistantText,
      });
    }
    this.emit(state, {
      type: 'run.finished',
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId: activeRun.dspatchRunId,
      at: nowIso(),
      rawProviderEvent,
      status,
      ...(error === undefined ? {} : { error }),
    });
  }

  private async fetchUsage(state: SessionState): Promise<AgentUsage> {
    try {
      return await state.agent.getUsage();
    } catch (error) {
      throw toAdapterError('readUsage', error);
    }
  }

  private tokenReadings(usage: unknown, observedAt: Timestamp): UsageReading[] {
    const fields = [
      'totalTokens',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'reasoningTokens',
    ] as const;
    const record = (usage ?? {}) as Record<string, unknown>;
    return fields.map((field) => ({
      provider: 'cursor' as const,
      unit: 'tokens' as const,
      scope: 'turn' as const,
      value: numberOrNull(record[field]),
      source: `SDKUsageMessage.usage.${field}`,
      observedAt,
    }));
  }

  private toUsageReadings(usage: AgentUsage): UsageReading[] {
    const observedAt = nowIso();
    const readings: UsageReading[] = [];
    const tokenFields = [
      'totalTokens',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'reasoningTokens',
    ] as const;
    const totals = (usage.usage ?? {}) as unknown as Record<string, unknown>;
    for (const field of tokenFields) {
      readings.push({
        provider: 'cursor',
        unit: 'tokens',
        scope: 'session',
        value: numberOrNull(totals[field]),
        source: `agent.getUsage().usage.${field}`,
        observedAt,
      });
    }
    for (const field of ['chargedCents', 'rawCostCents'] as const) {
      readings.push({
        provider: 'cursor',
        unit: 'cents',
        scope: 'session',
        // Absent cost is unknown, not free. Cursor documents cost as eventually
        // consistent, so it can simply not have landed yet.
        value: numberOrNull(usage.cost?.[field]),
        source: `agent.getUsage().cost.${field}`,
        observedAt,
      });
    }
    const runs = Array.isArray(usage.runs) ? usage.runs : [];
    for (const entry of runs) {
      // For a local agent these entries are per turn, keyed by usage UUID —
      // not by DSpatch's run ID, so they cannot be joined to one.
      readings.push({
        provider: 'cursor',
        unit: 'tokens',
        scope: 'turn',
        value: numberOrNull(entry.usage?.totalTokens),
        source: `agent.getUsage().runs[${entry.runId}].usage.totalTokens`,
        observedAt,
      });
      readings.push({
        provider: 'cursor',
        unit: 'cents',
        scope: 'turn',
        value: numberOrNull(entry.cost?.chargedCents),
        source: `agent.getUsage().runs[${entry.runId}].cost.chargedCents`,
        observedAt,
      });
    }
    return readings;
  }
}
