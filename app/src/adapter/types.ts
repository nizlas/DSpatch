/**
 * Types for DSpatch's provider adapter.
 *
 * This file contains types only. It is imported by both the main process and
 * the renderer and must never gain a runtime dependency on Node or a provider SDK.
 *
 * The shape was decided in DSP-1 substep 2 (task Implementation Notes, "Pass 2").
 * The interface operates at session granularity: a run groups events rather than
 * being an object exposed by the adapter.
 */

/**
 * Providers. `cursor` and `copilot` are named in VISION section 10; `claude` is
 * Claude's own agent harness through the Claude Agent SDK (DSP-109).
 */
export type ProviderId = 'cursor' | 'copilot' | 'claude';

/**
 * DSpatch creates its own identifiers rather than adopting a provider's format.
 * The adapter owns translation to provider IDs.
 *
 * For Cursor, never generate an ID beginning with `bc-`: Cursor interprets that
 * prefix as a cloud run.
 */
export type DspatchSessionId = string;

/** Identifies a prompt submission. Carried as a field on every event. */
export type DspatchRunId = string;

/** ISO 8601 timestamp in UTC. */
export type Timestamp = string;

/** The seven capabilities in VISION section 9.1, the shared integration contract. */
export type Capability =
  | 'start'
  | 'streaming'
  | 'cancel'
  | 'resume'
  | 'modelSelection'
  | 'approvals'
  | 'usageReporting';

/**
 * Three values, not two. `unknown` is valid: VISION section 9.1 requires missing
 * support to be visible, and section 13 prohibits displaying missing information
 * as a positive result.
 */
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';

/**
 * The report applies **per adapter instance: provider plus transport**, not per
 * provider. For example, approvals are documented as absent in Cursor's SDK path
 * but supported in its ACP path. A provider-wide answer would become false as
 * soon as the fallback path was used.
 */
export type CapabilityReport = Readonly<Record<Capability, CapabilitySupport>>;

/**
 * Run states:
 *
 *   created -> running -> awaiting_approval <-> running
 *                      -> finished | cancelled | error
 *
 * `awaiting_approval` is included from the start even though no connected adapter
 * can populate it yet. Cursor's stream type already carries `{type:"request"}`,
 * described as "Awaiting user input or approval". VISION section 13 requires
 * waiting to be shown as waiting.
 */
export type RunStatus =
  | 'created'
  | 'running'
  | 'awaiting_approval'
  | 'finished'
  | 'cancelled'
  | 'error';

/** Terminal states. */
export type TerminalRunStatus = Extract<
  RunStatus,
  'finished' | 'cancelled' | 'error'
>;

/**
 * Adapter errors. No custom error-code taxonomy: DSP-3 owns error handling,
 * and a taxonomy based on no actual outcomes would be premature.
 */
export interface AdapterError {
  readonly message: string;
  /** The provider code, unchanged, when available. */
  readonly providerCode?: string;
}

/** Session configuration. DSpatch owns it; the adapter does not persist it. */
export interface SessionConfig {
  readonly provider: ProviderId;
  /**
   * DSpatch's own session ID. If omitted, the adapter creates one.
   * Must be filename-safe because a provider may use it as a directory name.
   */
  readonly dspatchSessionId?: DspatchSessionId;
  /** The requested model. The model actually used may differ. */
  readonly modelRequested: string;
  /** The working copy used by the agent. Session input, not an observation. */
  readonly workspacePath: string;
  /**
   * Every folder this session works with, the working directory first.
   *
   * DSP-72. `workspacePath` stays what it was — the primary, the shell's `cwd`, and
   * what a provider scopes its own per-workspace state by — so a caller that sets
   * neither this nor more than one entry gets exactly the session it got before.
   * Omitted or a single entry means one working root.
   *
   * **Roots, not permissions.** An adapter may pass these to its provider so each
   * folder's project configuration is loaded, and Cursor's does. Nothing on this
   * interface grants or withholds filesystem access, and no adapter may report that it
   * does: `CapabilityReport` has no containment capability because none of the
   * connected transports offers one.
   */
  readonly workspacePaths?: readonly string[];
}

/** What the adapter returns when a session is started or resumed. */
export interface SessionHandle {
  readonly dspatchSessionId: DspatchSessionId;
  readonly provider: ProviderId;
  /** The provider's own session ID, for correlation with its logs. */
  readonly providerSessionId: string;
  readonly createdAt: Timestamp;
}

/** What `send` returns: the grouping identity, not a provider run-level object. */
export interface RunReference {
  readonly dspatchRunId: DspatchRunId;
}

/**
 * A pending approval request. Deliberately limited to three fields: a `kind`
 * enumeration would normalise without actual outcomes and belongs in a later task.
 */
export interface ApprovalRequest {
  readonly requestId: string;
  readonly summary: string;
  readonly requestedAt: Timestamp;
}

/** The approval vocabulary for Phase 0, with no further options. */
export type ApprovalDecision =
  | { readonly kind: 'allow-once' }
  | { readonly kind: 'deny'; readonly reason: string };

/** The unit of a usage reading. Always accompanied by `provider`. */
export type UsageUnit = 'tokens' | 'cents';

/** The scope of a usage reading. `session` is DSpatch's term for that level. */
export type UsageScope = 'call' | 'turn' | 'run' | 'session';

/**
 * A usage or cost reading.
 *
 * `value: null` means **unknown, never 0**. VISION section 12 says missing cost
 * must not be shown as zero. `null` does not distinguish a delayed reading from
 * one unavailable from this provider; `source` and `observedAt` carry that context.
 */
export interface UsageReading {
  readonly provider: ProviderId;
  readonly unit: UsageUnit;
  readonly scope: UsageScope;
  readonly value: number | null;
  /** The provider event or API from which this reading came. */
  readonly source: string;
  readonly observedAt: Timestamp;
}

/** The subject of a usage reading. */
export type UsageQuery =
  | { readonly of: 'session'; readonly dspatchSessionId: DspatchSessionId }
  | { readonly of: 'run'; readonly dspatchRunId: DspatchRunId };

/** A model this adapter instance can request. */
export interface ModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly provider: ProviderId;
}

/**
 * Normalised event types. Mapping in both provider directions is documented
 * in report 003, section 3.2.
 */
export type AgentEventType =
  | 'run.started'
  | 'run.cancel_requested'
  | 'assistant.delta'
  | 'assistant.message'
  | 'reasoning.delta'
  | 'tool.started'
  | 'tool.finished'
  | 'approval.requested'
  | 'usage'
  | 'run.finished';

/**
 * Fields shared by all events. `dspatchRunId` lets UI and storage group by run
 * without requiring the adapter to expose a provider run-level object.
 *
 * Preserve `rawProviderEvent` unchanged alongside the normalised form, under
 * VISION section 9.1. Never normalise tool arguments or results: only the envelope
 * (identity, name, status and timestamp) has a stable provider schema.
 *
 * No `seq` here. Sequence numbering is DSpatch's own observation and a storage
 * decision belonging to DSP-4.
 */
interface AgentEventBase {
  readonly dspatchSessionId: DspatchSessionId;
  readonly dspatchRunId: DspatchRunId;
  readonly at: Timestamp;
  readonly rawProviderEvent: unknown;
}

/**
 * How a cancelled run ended, as far as the adapter could establish it (DSP-115).
 *
 * - `stopped`: the run stopped on the adapter's first, gentle request, and the
 *   adapter has evidence that the provider's local work ended.
 * - `forced`: the adapter had to escalate (abort, and possibly kill a process)
 *   and then has that evidence.
 * - `unconfirmed`: the adapter gave up waiting without that evidence. The run is
 *   reported as ended so the window is not stuck, but the provider's local work
 *   may still be going; an adapter refuses new turns that would collide with it.
 *
 * What counts as evidence is the adapter's to document. A `run.finished` without
 * `end` means **not reported** — never `stopped`. In no case does `end` say
 * anything about work the provider had already started on its side: requests
 * already sent may still be processed and billed.
 */
export type RunEnd = 'stopped' | 'forced' | 'unconfirmed';

export type AgentEvent =
  | (AgentEventBase & { readonly type: 'run.started' })
  /**
   * The user asked to cancel the run. Not an end: events may still follow, and the
   * run ends only with its one terminal `run.finished`. Additive (DSP-115); an
   * adapter that does not emit it reports the cancel through `run.finished` only.
   */
  | (AgentEventBase & { readonly type: 'run.cancel_requested' })
  | (AgentEventBase & {
      readonly type: 'assistant.delta' | 'assistant.message' | 'reasoning.delta';
      readonly text: string;
    })
  | (AgentEventBase & {
      readonly type: 'tool.started';
      readonly toolCallId: string;
      readonly name: string;
    })
  | (AgentEventBase & {
      readonly type: 'tool.finished';
      readonly toolCallId: string;
      readonly name: string;
      readonly status: 'ok' | 'error';
    })
  | (AgentEventBase & {
      readonly type: 'approval.requested';
      readonly request: ApprovalRequest;
    })
  | (AgentEventBase & {
      readonly type: 'usage';
      readonly readings: readonly UsageReading[];
    })
  | (AgentEventBase & {
      readonly type: 'run.finished';
      readonly status: TerminalRunStatus;
      readonly error?: AdapterError;
      /** See {@link RunEnd}. Absent means not reported. */
      readonly end?: RunEnd;
    });

/** Remove a subscription. Idempotent. */
export type Unsubscribe = () => void;

/** Receive normalised events. Must not throw. */
export type AgentEventListener = (event: AgentEvent) => void;
