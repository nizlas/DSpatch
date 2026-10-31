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
   * **Roots, not containment.** Each adapter passes these to its provider through the
   * provider's own multi-folder mechanism (Cursor `local.dirs`, Claude
   * `additionalDirectories`), and the Claude adapter extends its own read and edit
   * rules to them so the agent can work in every folder under the same rules as in the
   * first (DSP-149). That is the provider's permission layer, not a sandbox: no adapter
   * may report that a folder list confines anything.
   */
  readonly workspacePaths?: readonly string[];
  /**
   * DSP-149: what the session works on. `workspace` (the default) is a workspace's
   * folders with the adapter's ordinary tools. `conversation` is a conversation with
   * no workspace yet: the agent gets none of its built-in file or command tools, only
   * {@link appTools}, and works in an empty folder DSpatch owns.
   */
  readonly toolScope?: 'workspace' | 'conversation';
  /**
   * DSP-149: DSpatch's own functions offered to the agent as tools, through the
   * provider SDK's supported tool mechanism (Claude: an in-process MCP server; Cursor:
   * `local.customTools`). They run in the host, are the same functions the menus use,
   * and replace none of the agent's own tools. Absent or empty means none.
   */
  readonly appTools?: readonly AppTool[];
  /**
   * The tool policy the session was recorded under, as the adapter's own digest
   * (DSP-122). Read by `resume()` only: an adapter whose current policy digests
   * differently refuses to resume, naming the field, so a session is not
   * continued under rules other than the ones it was started with. Ignored by
   * adapters without a policy digest (Cursor). Nothing in the product sets it
   * before DSP-117; tests and probes do.
   */
  readonly expectedToolPolicy?: string;
}

/** One parameter of an {@link AppTool}: a string, or a list of strings. */
export interface AppToolParameter {
  readonly type: 'string' | 'string-list';
  readonly description: string;
  /** Required unless this is true. */
  readonly optional?: boolean;
}

/** What an {@link AppTool} returns to the model: text, marked as an error when it failed. */
export interface AppToolResult {
  readonly text: string;
  readonly isError: boolean;
}

/**
 * A DSpatch function offered to the agent as a tool (DSP-149).
 *
 * Provider-neutral on purpose: each adapter turns it into its SDK's own tool definition,
 * so the name, description and parameters the model sees are DSpatch's, written once,
 * and shown in the session details exactly as sent.
 */
export interface AppTool {
  /** snake_case; the model sees it under the SDK's naming for in-process tools. */
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, AppToolParameter>>;
  /** Reads and changes nothing. Passed to the SDK as a hint, never as an enforcement. */
  readonly readOnly: boolean;
  execute(args: Readonly<Record<string, unknown>>): Promise<AppToolResult>;
}

/**
 * What a `resume()` actually checked before it returned a handle (DSP-121).
 *
 * The wording a session's continuity is allowed to use comes from this and from
 * nothing else; in particular not from `CapabilityReport.resume`, which says what
 * an adapter claims in general and not what one call did.
 *
 * - `provider-answered` — the provider itself was asked for the session and
 *   answered (Cursor's `Agent.resume`, measured to refuse an unknown ID).
 * - `local-record` — a local record of the session was found and registered; the
 *   provider was not asked, and the first turn is where it answers.
 * - `none` — the adapter checked nothing it can describe.
 */
export type ResumeEvidence = 'provider-answered' | 'local-record' | 'none';

/** What the adapter returns when a session is started or resumed. */
export interface SessionHandle {
  readonly dspatchSessionId: DspatchSessionId;
  readonly provider: ProviderId;
  /** The provider's own session ID, for correlation with its logs. */
  readonly providerSessionId: string;
  readonly createdAt: Timestamp;
  /**
   * Set by `resume()` only; absent from a handle `startSession()` returned. An
   * absent value on a resumed handle is read as `'none'`.
   */
  readonly resumeEvidence?: ResumeEvidence;
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
  /** What the provider says about the model, when it says anything. */
  readonly description?: string;
  /** The provider's wire id an alias such as "sonnet" resolves to, when it says. */
  readonly resolvedId?: string;
  /** This row stands for "no model named": what it means is in `resolvedId`, when the provider says. */
  readonly providerDefault?: true;
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
  | 'command.started'
  | 'command.finished'
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

// --- Steering (DSP-147) -------------------------------------------------------------

/**
 * Where a steering message has got to, as far as the runtime has said.
 *
 * - `accepted`: the runtime has taken it for the running turn (for Claude, written to
 *   the CLI's input; its queue folds it in between tool rounds). Not yet evidence that
 *   the model has it.
 * - `delivered`: the runtime's own evidence that the turn took it in (Claude: the turn's
 *   result lists its uuid in `user_message_uuids`; Cursor: `Run.steer` answered
 *   `complete_delivered`). Says nothing about whether the agent read or followed it.
 * - `not-delivered`: this route did not give it to the agent; `reason` says why.
 */
export type SteerState = 'accepted' | 'delivered' | 'not-delivered';

export type SteerNotDeliveredReason =
  /** The adapter has no way to steer this session's runtime. */
  | 'unsupported'
  /** The session has no running turn to add it to, or the turn ended before taking it. */
  | 'no-running-turn'
  /** The runtime declined it for the running turn (Cursor: `revert_to_followup`). */
  | 'declined'
  /** The turn was cancelled before it took the message in. */
  | 'cancelled'
  /** Writing it to the runtime failed. */
  | 'failed';

export interface SteerUpdate {
  readonly state: SteerState;
  /** For `not-delivered`. */
  readonly reason?: SteerNotDeliveredReason;
  /** Technical detail for Session details; never shown as the conversation's sentence. */
  readonly detail?: string;
  /** The run the message was added to, when there was one. */
  readonly dspatchRunId?: DspatchRunId;
  /** The runtime's identifier for the message, where it has one (Claude: the uuid). */
  readonly providerMessageId?: string;
}

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
      /**
       * DSP-152: what a reading tool was asked about, as the provider reported the call:
       * the file a `Read` names, the pattern (and folder) of a `Glob` or `Grep`. Absent for
       * other tools and where the adapter does not report it. Never the file's content.
       */
      readonly subject?: string;
    })
  | (AgentEventBase & {
      readonly type: 'tool.finished';
      readonly toolCallId: string;
      readonly name: string;
      readonly status: 'ok' | 'error';
    })
  /**
   * DSP-145, DSP-146: a command the agent runs started. Raised by the adapter where it
   * observes the start at the provider's own boundary (for Claude, the SDK's PreToolUse
   * hook letting a shell command through), not from DSpatch starting anything.
   */
  | (AgentEventBase & {
      readonly type: 'command.started';
      /** The provider's tool call this command answers, when it could be matched; else `null`. */
      readonly toolCallId: string | null;
      readonly commandId: string;
      readonly line: string;
      readonly cwd: string;
    })
  /**
   * DSP-145, DSP-146: the record of a command the agent ran, as the adapter observed it
   * (for Claude, the SDK's PostToolUse or PostToolUseFailure hook). A command whose end
   * the provider never reported is recorded when the run ends, as stopped (cancelled) or
   * not reported. Always before the run's terminal `run.finished`.
   */
  | (AgentEventBase & {
      readonly type: 'command.finished';
      readonly toolCallId: string | null;
      readonly command: AgentCommandRecord;
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

// --- Commands DSpatch records (DSP-145, DSP-146) -----------------------------------

/**
 * Who asked for a command.
 *
 * - `agent-tool`: the agent, through the command tool DSpatch offered between DSP-145 and
 *   DSP-146; DSpatch started it. No longer produced; kept so earlier records still read.
 * - `gate`: a gate node of a loop graph; DSpatch started it.
 * - `provider-reported`: the agent ran it with the provider's own tool (Claude's Bash or
 *   PowerShell, Cursor's shell); DSpatch did not start it and records only what the
 *   provider reported, through its hooks or its events.
 */
export type AgentCommandRequester = 'agent-tool' | 'gate' | 'provider-reported';

/**
 * How a command ended, as DSpatch observed it.
 *
 * - `exited`: the process ran and exited by itself; `exitCode` says how.
 * - `could-not-start`: there was a command and no process could run it.
 * - `timed-out`: still running at its time bound, so DSpatch stopped it.
 * - `stopped`: stopped because the run was cancelled or ended (`killedByDspatch` says
 *   whether DSpatch itself stopped the process), or reported by the provider as interrupted.
 * - `refused`: DSpatch declined to start it (an empty line, another command running).
 * - `not-reported`: the provider reported no end, or a failure that does not say how the
 *   command ended (DSP-146); `endingMessage` keeps what it said.
 */
export type AgentCommandEnding = 'exited' | 'could-not-start' | 'timed-out' | 'stopped' | 'refused' | 'not-reported';

/**
 * One command, as DSpatch observed it: DSpatch's own record of a command it started, or
 * (`requestedBy: 'provider-reported'`) DSpatch's record of what the provider reported
 * about a command the agent ran with the provider's own tool.
 *
 * The snapshot identities are content hashes of every working folder: `testedSnapshotId`
 * just before the process started, `afterRunSnapshotId` just after it ended. `null` means
 * **not observed** - never "unchanged".
 */
export interface AgentCommandRecord {
  readonly commandId: string;
  readonly requestedBy: AgentCommandRequester;
  /** The command line as given, without the shell prefix. */
  readonly line: string;
  /** The shell that interpreted it, e.g. `cmd.exe /d /s /c`. */
  readonly shell: string;
  readonly cwd: string;
  readonly pid: number | null;
  readonly startedAtUtc: Timestamp;
  readonly finishedAtUtc: Timestamp;
  readonly durationMs: number;
  /** The time bound it ran under, or `null` for none. */
  readonly timeoutMs: number | null;
  readonly ending: AgentCommandEnding;
  /** DSpatch's sentence about an ending other than `exited`; `null` for `exited`. */
  readonly endingMessage: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  /** DSpatch asked the operating system to stop it (time bound or cancel). */
  readonly killedByDspatch: boolean;
  readonly stdout: string;
  readonly stderr: string;
  /** Output was cut to the record's bound; `outputNote` says how. */
  readonly outputTruncated: boolean;
  readonly outputNote: string | null;
  readonly testedSnapshotId: string | null;
  readonly afterRunSnapshotId: string | null;
  /** The folders the two snapshots cover. Empty when none was observed. */
  readonly snapshotRoots: readonly string[];
}

/** Remove a subscription. Idempotent. */
export type Unsubscribe = () => void;

/** Receive normalised events. Must not throw. */
export type AgentEventListener = (event: AgentEvent) => void;
