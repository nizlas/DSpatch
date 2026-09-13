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

/** Providers named in VISION section 10. Neither is connected yet. */
export type ProviderId = 'cursor' | 'copilot';

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

export type AgentEvent =
  | (AgentEventBase & { readonly type: 'run.started' })
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
    });

/** Remove a subscription. Idempotent. */
export type Unsubscribe = () => void;

/** Receive normalised events. Must not throw. */
export type AgentEventListener = (event: AgentEvent) => void;
