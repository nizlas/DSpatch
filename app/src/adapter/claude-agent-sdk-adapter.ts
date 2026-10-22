import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

import type {
  HookCallback,
  HookJSONOutput,
  Options as ClaudeQueryOptions,
  SDKMessage,
  SDKUserMessage,
  SpawnedProcess,
  SpawnOptions as ClaudeSpawnOptions,
} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };

import type { AgentAdapter } from './agent-adapter';
import type {
  AdapterError,
  AgentEvent,
  AgentEventListener,
  ApprovalDecision,
  CapabilityReport,
  DspatchRunId,
  DspatchSessionId,
  ModelInfo,
  RunEnd,
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
 * Anthropic's Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) behind DSpatch's
 * adapter boundary. DSP-109.
 *
 * Named for the SDK, not for "Claude Code": Anthropic's branding rules do not
 * permit presenting a third-party integration as Claude Code.
 *
 * **Main process only.** The SDK spawns a bundled native executable and needs
 * Node built-ins. `tsconfig.renderer.json` excludes this file, as it excludes the
 * Cursor adapter, so a renderer import fails the typecheck. Nothing here assumes
 * the renderer runs on the same machine as the agent: everything the UI needs
 * arrives as {@link AgentEvent}s.
 *
 * The SDK is ESM-only and the main process compiles to CommonJS, so the SDK is
 * loaded with a dynamic `import()` the first time a real turn is sent, and only
 * its types are imported statically. A substituted query function
 * ({@link ClaudeAgentSdkAdapterOptions.queryFn}) never loads it at all, which is
 * how the deterministic tests run without the SDK, its executable, a network
 * or a credential.
 *
 * Credentials are never read, held or logged here. The adapter inspects only
 * the **names** of environment variables (see {@link assessAuthentication}), and
 * passes the subprocess an explicit environment so that what was inspected is
 * exactly what the SDK receives.
 */

/** Error thrown by adapter operations. Satisfies {@link AdapterError}. */
export class ClaudeAdapterError extends Error implements AdapterError {
  readonly providerCode?: string;

  constructor(message: string, providerCode?: string, cause?: unknown) {
    super(message);
    this.name = 'ClaudeAdapterError';
    if (providerCode !== undefined) {
      this.providerCode = providerCode;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// --- Permissions -------------------------------------------------------------

/**
 * What the agent may use and what is pre-approved. An adapter-instance choice,
 * like the Cursor adapter's `ToolPolicy`, not part of {@link SessionConfig}.
 *
 * - `tools` is **availability**: the only built-in tools the model sees.
 * - `allowedTools` is **pre-approval**. Single-slash rules are anchored at the
 *   session's `cwd` per the SDK's permissions documentation. There is
 *   deliberately no bare `Read`, `Glob` or `Grep`, so a read outside the working
 *   directory is not pre-approved.
 * - `permissionMode: 'dontAsk'` denies anything that would have prompted, and
 *   the SDK documents that `canUseTool` is then never called — so nothing waits
 *   on a prompt nobody can answer.
 * - `settingSources: []` loads no user, project or local settings file. It does
 *   not cover managed (policy) settings, `~/.claude.json` (always read; it holds
 *   MCP server configurations) or the claude.ai connectors fetched for a
 *   claude.ai login: the 22 Oct 2026 probe, run without `strictMcpConfig`,
 *   listed eight `mcp__claude_ai_Claude_Docs__*` tools beside the four
 *   configured ones.
 * - `strictMcpConfig: true` is the control for that: only MCP servers passed
 *   through `mcpServers` (none here) are used; project `.mcp.json`, user
 *   settings, plugins and claude.ai connectors are ignored (sdk.d.ts 0.3.306
 *   :2341-2348; the SDK's online TypeScript reference, read 22 Oct 2026, names
 *   the connectors explicitly). Documented, not yet observed: a live run's init
 *   `mcp_servers` and `tools` show whether it held.
 *
 * None of this is containment. `cwd` scopes permission rules; it does not
 * confine the process (types.ts, "Roots, not permissions").
 */
export interface ClaudePermissionPolicy {
  readonly tools: readonly string[];
  readonly allowedTools: readonly string[];
  /**
   * Only `dontAsk` for now. `bypassPermissions`, `acceptEdits` and `auto` are
   * never used; `default` and `plan` are refused too, because with no
   * `canUseTool` a prompt would wait for an answer nobody can give.
   */
  readonly permissionMode: 'dontAsk';
  readonly settingSources: readonly [];
  /** Always `true` (see above). A policy without it is refused. */
  readonly strictMcpConfig: true;
}

/** The DSP-109 fixture configuration. Recorded in every run record. */
export const FIXTURE_PERMISSIONS: ClaudePermissionPolicy = Object.freeze({
  tools: Object.freeze(['Read', 'Glob', 'Grep', 'Edit']),
  allowedTools: Object.freeze(['Read(/**)', 'Edit(/src/**)']),
  permissionMode: 'dontAsk',
  settingSources: Object.freeze([]) as readonly [],
  strictMcpConfig: true,
}) as ClaudePermissionPolicy;

// --- Authentication guard ------------------------------------------------------

/*
 * Which environment variables the guard acts on. Read from Claude Code's
 * environment-variable reference, https://code.claude.com/docs/en/env-vars, on
 * 21 Oct 2026 (provider documentation, not observed behaviour). Families are
 * matched by prefix so that a later variable of a known family is caught too.
 */

/**
 * Credentials and identity selectors that make Claude Code bill an API account,
 * a cloud provider or a federated workspace. Claude Code's documented precedence
 * puts them above a subscription login, so a stray one would silently turn a
 * run into a paid one. Only `ANTHROPIC_API_KEY` is ever passed, and only with a
 * recorded API-key approval; the others are refused and stripped in every case.
 */
export const API_CREDENTIAL_VARIABLES = [
  // API keys and bearer tokens.
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  // Profile and Workload Identity Federation selectors.
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_WORKSPACE_ID',
  // Extra request headers, which can carry an `Authorization` header.
  'ANTHROPIC_CUSTOM_HEADERS',
  // Client credentials for mTLS.
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'CLAUDE_CODE_CLIENT_CERT',
  // Base-URL overrides are matched by pattern instead: see BASE_URL_PATTERN.
  //
  // Deliberately not guarded: ANTHROPIC_AWS_WORKSPACE_ID, ANTHROPIC_VERTEX_PROJECT_ID,
  // ANTHROPIC_FOUNDRY_RESOURCE and CLAUDE_CODE_API_KEY_HELPER_TTL_MS. They only
  // qualify a provider or a credential, and every provider switch and every
  // credential other than the direct API key is refused, so on their own they are inert.
] as const;

/**
 * Endpoint overrides: every `ANTHROPIC_*_BASE_URL`, including `ANTHROPIC_BASE_URL`
 * (documented today: plain, BEDROCK, BEDROCK_MANTLE, AWS, FOUNDRY, VERTEX). They
 * redirect traffic to another endpoint, which may be billed. Treated like
 * {@link API_CREDENTIAL_VARIABLES}.
 */
export const BASE_URL_PATTERN = /^ANTHROPIC_(?:[A-Z0-9_]+_)?BASE_URL$/;

/**
 * Provider switches: every `CLAUDE_CODE_USE_*` (documented today: ANTHROPIC_AWS,
 * BEDROCK, FOUNDRY, MANTLE, VERTEX), except the one that only controls a tool.
 * Treated like {@link API_CREDENTIAL_VARIABLES}.
 */
export const PROVIDER_SWITCH_PREFIX = 'CLAUDE_CODE_USE_';
const NOT_A_PROVIDER_SWITCH: readonly string[] = ['CLAUDE_CODE_USE_POWERSHELL_TOOL'];

/**
 * Claude Code's own OAuth variables (documented today: TOKEN, REFRESH_TOKEN,
 * SCOPES). Always refused and always stripped: DSP-109 forbids reusing Claude
 * Code authentication tokens, and no approval changes that.
 */
export const CLAUDE_CODE_OAUTH_PREFIX = 'CLAUDE_CODE_OAUTH_';

type VariableClass = 'api' | 'claude-code-token';

/**
 * Whether variable names are compared without regard to case. True on Windows,
 * where a child process resolves `anthropic_api_key` as `ANTHROPIC_API_KEY`.
 * Injectable so the rule can be tested on any host.
 */
export interface EnvironmentMatching {
  readonly caseInsensitive?: boolean;
}

function caseInsensitiveFor(matching: EnvironmentMatching | undefined): boolean {
  return matching?.caseInsensitive ?? process.platform === 'win32';
}

function classify(name: string, caseInsensitive: boolean): VariableClass | null {
  const key = caseInsensitive ? name.toUpperCase() : name;
  if (key.startsWith(CLAUDE_CODE_OAUTH_PREFIX)) {
    return 'claude-code-token';
  }
  if (key.startsWith(PROVIDER_SWITCH_PREFIX) && !NOT_A_PROVIDER_SWITCH.includes(key)) {
    return 'api';
  }
  if (BASE_URL_PATTERN.test(key)) {
    return 'api';
  }
  return (API_CREDENTIAL_VARIABLES as readonly string[]).includes(key) ? 'api' : null;
}

/** Guarded variable names present in `env`, as they are spelled there. */
function guardedNames(
  env: Readonly<Record<string, string | undefined>>,
  caseInsensitive: boolean,
): { readonly api: string[]; readonly token: string[] } {
  const api: string[] = [];
  const token: string[] = [];
  for (const name of Object.keys(env)) {
    if (env[name] === undefined) {
      continue;
    }
    const found = classify(name, caseInsensitive);
    if (found === 'api') {
      api.push(name);
    } else if (found === 'claude-code-token') {
      token.push(name);
    }
  }
  return { api: api.sort(), token: token.sort() };
}

/**
 * The one variable an API-key approval lets through: the direct Anthropic API
 * key. Matched with the same case rule as everything else.
 */
export const DIRECT_API_KEY_VARIABLE = 'ANTHROPIC_API_KEY';

/**
 * An explicit, recorded authorization for a live run (DSP-109 AC #3). There is
 * no default: without one, the real SDK is never called.
 *
 * - `api-key`: Niclas's explicit approval of an API-key run. `approval` is the
 *   reference to where that approval is recorded. It means exactly the **direct
 *   Anthropic API-key path**: {@link DIRECT_API_KEY_VARIABLE} set and non-empty,
 *   and no other guarded variable (auth token, provider switch, cloud key,
 *   profile or federation selector, custom headers, client certificate, base-URL
 *   override) present. Anything else is refused, not passed on.
 * - `subscription`: a reference to Anthropic's permission or documentation
 *   establishing that subscription-backed SDK use is allowed for this
 *   integration. With it, every API credential variable is still refused, so
 *   a paid fallback cannot happen silently.
 */
export type LiveAuthorization =
  | { readonly kind: 'api-key'; readonly approval: string }
  | { readonly kind: 'subscription'; readonly authorization: string };

/**
 * What the environment check concluded, kept apart from what the provider later
 * reports. The check sees variable names (and whether the key is empty), so it
 * cannot prove which identity the SDK finally uses: compare
 * {@link expectedApiKeySource} with the init message's observed `apiKeySource`.
 */
export interface AuthenticationPreflight {
  /**
   * - `refused`: the run must not start (see `refusal`).
   * - `direct-anthropic-api-key`: an API-key approval, and the environment holds
   *   {@link DIRECT_API_KEY_VARIABLE} and no other guarded variable.
   * - `no-api-credential`: no guarded variable at all; Claude Code would use
   *   whatever login it has. Reached with a subscription authorization (not
   *   exercised in DSP-109) or, offline, with a substituted query function.
   */
  readonly decision: 'refused' | 'direct-anthropic-api-key' | 'no-api-credential';
  /**
   * The init message's `apiKeySource` this path is expected to produce, or
   * `null` where no single value is expected. From the installed SDK's type
   * documentation (`ApiKeySource` in sdk.d.ts 0.3.306: "'ANTHROPIC_API_KEY'
   * (environment variable)"), not from an observation.
   */
  readonly expectedApiKeySource: 'ANTHROPIC_API_KEY' | null;
  readonly expectedApiKeySourceBasis: string | null;
  /**
   * What could still change the identity and that this check cannot see. Until
   * a live run has observed the expected `apiKeySource`, the path is unconfirmed.
   */
  readonly notVisibleToThisCheck: readonly string[];
}

export interface AuthenticationAssessment {
  /** Names only, never values, spelled as they appear in the environment. */
  readonly credentialVariablesFound: readonly string[];
  readonly authorization: LiveAuthorization | null;
  /** Why a live run must not start, or `null` when it may. */
  readonly refusal: string | null;
  readonly preflight: AuthenticationPreflight;
}

const NOT_VISIBLE_TO_ENVIRONMENT_CHECK: readonly string[] = Object.freeze([
  'managed (policy) settings, which settingSources: [] does not exclude: an `env` block ' +
    'can set or override variables, `apiKeyHelper` can supply another key, and a managed ' +
    'provider selection can route the run to a cloud provider',
  "an API key stored by Claude Code's /login with an Anthropic Console account " +
    "('/login managed key')",
  "Claude Code's own precedence rules as implemented in the installed version, which are " +
    'documented, not observed here',
]);

function preflightFor(
  refusal: string | null,
  usable: LiveAuthorization | null,
  apiFound: readonly string[],
): AuthenticationPreflight {
  if (refusal !== null) {
    return {
      decision: 'refused',
      expectedApiKeySource: null,
      expectedApiKeySourceBasis: null,
      notVisibleToThisCheck: NOT_VISIBLE_TO_ENVIRONMENT_CHECK,
    };
  }
  if (usable?.kind === 'api-key' && apiFound.length === 1) {
    return {
      decision: 'direct-anthropic-api-key',
      expectedApiKeySource: 'ANTHROPIC_API_KEY',
      expectedApiKeySourceBasis:
        'expected from documentation: ApiKeySource in @anthropic-ai/claude-agent-sdk ' +
        "sdk.d.ts 0.3.306 names 'ANTHROPIC_API_KEY' (environment variable); not yet observed",
      notVisibleToThisCheck: NOT_VISIBLE_TO_ENVIRONMENT_CHECK,
    };
  }
  return {
    decision: 'no-api-credential',
    expectedApiKeySource: null,
    expectedApiKeySourceBasis: null,
    notVisibleToThisCheck: NOT_VISIBLE_TO_ENVIRONMENT_CHECK,
  };
}

function isDirectApiKey(name: string, caseInsensitive: boolean): boolean {
  return (caseInsensitive ? name.toUpperCase() : name) === DIRECT_API_KEY_VARIABLE;
}

function plural(names: readonly string[], one: string, many: string): string {
  return names.length === 1 ? one : many;
}

function usableAuthorization(
  authorization: LiveAuthorization | null | undefined,
): LiveAuthorization | null {
  if (authorization === null || authorization === undefined) {
    return null;
  }
  const reference =
    authorization.kind === 'api-key' ? authorization.approval : authorization.authorization;
  return typeof reference === 'string' && reference.trim() !== '' ? authorization : null;
}

/**
 * Decide whether a live run may start, from variable **names** in `env`.
 *
 * `requireAuthorization` is true wherever the real SDK would be called: without a
 * recorded authorization, an environment with no credential variable would fall
 * through to Claude Code's own `/login` subscription credential, which is
 * exactly the path DSP-109 says is not yet authorized.
 */
export function assessAuthentication(
  env: Readonly<Record<string, string | undefined>>,
  authorization: LiveAuthorization | null | undefined,
  requireAuthorization: boolean,
  matching?: EnvironmentMatching,
): AuthenticationAssessment {
  const usable = usableAuthorization(authorization);
  const caseInsensitive = caseInsensitiveFor(matching);
  const { api: apiFound, token: tokenFound } = guardedNames(env, caseInsensitive);
  const credentialVariablesFound = [...apiFound, ...tokenFound];
  const keyNames = apiFound.filter((name) => isDirectApiKey(name, caseInsensitive));
  const competing = apiFound.filter((name) => !isDirectApiKey(name, caseInsensitive));

  let refusal: string | null = null;
  if (tokenFound.length > 0) {
    refusal =
      `${tokenFound.join(', ')} ${tokenFound.length === 1 ? 'is' : 'are'} set. DSpatch ` +
      'does not reuse Claude Code authentication tokens; remove ' +
      `${tokenFound.length === 1 ? 'it' : 'them'} from this environment.`;
  } else if (usable?.kind === 'api-key') {
    // The approval covers the direct Anthropic API-key path and nothing else.
    // Only emptiness is checked; the value is never kept or recorded.
    const keyValue = keyNames.length === 1 ? env[keyNames[0] ?? ''] : undefined;
    if (competing.length > 0) {
      refusal =
        `${competing.join(', ')} ${plural(competing, 'is', 'are')} set. The recorded ` +
        `API-key approval covers only the direct Anthropic API-key path ` +
        `(${DIRECT_API_KEY_VARIABLE} alone), and ${plural(competing, 'this variable', 'these variables')} ` +
        'could select another credential, provider or endpoint. Remove ' +
        `${plural(competing, 'it', 'them')}; the run will not start.`;
    } else if (keyNames.length > 1) {
      refusal =
        `${keyNames.join(', ')} are all set and name the same variable on this system. ` +
        'Keep exactly one; the run will not start.';
    } else if (keyValue === undefined || keyValue.trim() === '') {
      refusal =
        `An API-key approval is recorded, but ${DIRECT_API_KEY_VARIABLE} is ` +
        `${keyNames.length === 0 ? 'not set' : 'empty'}. Without it Claude Code would ` +
        'fall back to another login, which the approval does not cover. The run will not start.';
    }
  } else if (apiFound.length > 0) {
    refusal =
      `${apiFound.join(', ')} ${apiFound.length === 1 ? 'is' : 'are'} set, which would ` +
      'make this run bill an API or cloud account. No API-key approval is recorded ' +
      'for this run, so it will not start. Remove the variable, or record an explicit ' +
      'API-key approval.';
  } else if (requireAuthorization && usable === null) {
    refusal =
      'No authorized authentication path is recorded for this run (DSP-109 AC #3). ' +
      "Without one, the SDK would fall back to Claude Code's own login, which is not " +
      'established as authorized for this integration. The run will not start.';
  }
  return {
    credentialVariablesFound,
    authorization: usable,
    refusal,
    preflight: preflightFor(refusal, usable, apiFound),
  };
}

/**
 * The environment the SDK subprocess receives: a copy of the one that was
 * assessed, so a variable set later cannot reach the subprocess unchecked.
 * Claude Code OAuth variables are always removed. Every other guarded variable
 * is removed too, except {@link DIRECT_API_KEY_VARIABLE} under an API-key
 * approval. Matching follows the same case rule as the assessment. No
 * credential is ever added.
 */
export function providerEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  authorization: LiveAuthorization | null,
  matching?: EnvironmentMatching,
): Record<string, string | undefined> {
  const caseInsensitive = caseInsensitiveFor(matching);
  const copy: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    const found = classify(name, caseInsensitive);
    if (found === 'claude-code-token') {
      continue;
    }
    if (
      found === 'api' &&
      !(authorization?.kind === 'api-key' && isDirectApiKey(name, caseInsensitive))
    ) {
      continue;
    }
    copy[name] = value;
  }
  return copy;
}

// --- The query function --------------------------------------------------------

/** What `query()` returns, as far as this adapter uses it. */
export interface ClaudeQueryHandle extends AsyncIterable<SDKMessage> {
  close?(): void;
  /**
   * The SDK's `Query.accountInfo()` (sdk.d.ts 0.3.306: "Get information about the
   * authenticated account", returning `AccountInfo`). Optional so a substitute
   * may leave it out; a missing method is a missing observation.
   */
  accountInfo?(): Promise<unknown>;
  /**
   * The SDK's `Query.interrupt()` (sdk.d.ts 0.3.306 :2899-2912: "Interrupt the
   * current query execution", a control request "only supported when streaming
   * input/output is used" — which is why the prompt is a one-message iterable).
   * Resolves to an interrupt receipt on newer CLIs, `undefined` on older ones.
   * Optional so a substitute may leave it out; then cancellation escalates at once.
   */
  interrupt?(): Promise<unknown>;
}

// --- Cancellation (DSP-115) --------------------------------------------------------

/*
 * The cancellation contract approved in DSP-114 and implemented in DSP-115:
 *
 * 1. `cancel()` sets the run's flag, emits `run.cancel_requested` and resolves.
 *    It never waits for the provider.
 * 2. From that moment the run's PreToolUse hook denies every tool call (with
 *    `continue: false`), and `Query.interrupt()` is called once.
 * 3. The terminal `run.finished` (status `cancelled`) waits for a **confirmed
 *    end**: the SDK stream has ended *and* the local Claude Code process has been
 *    seen to exit (see {@link ObservedProcess}). A `result` that arrives on the way
 *    is recorded with its usage but does not end the run.
 * 4. Bounded escalation: no confirmed end within {@link CANCEL_INTERRUPT_WAIT_MS}
 *    (or at once if `interrupt()` fails) → `abort()`; none within
 *    {@link CANCEL_ABORT_WAIT_MS} → kill the observed process; none within
 *    {@link CANCEL_KILL_WAIT_MS} → end `unconfirmed`, and the session refuses new
 *    turns until the end is confirmed after all.
 *
 * Why the process exit is the evidence: the SDK's documentation does not promise
 * that the process has exited when the message stream ends. `Transport.waitForExit`
 * (sdk.d.ts 0.3.306 :10116-10122) says `Query.performCleanup()` awaits the exit
 * "bounded", so the stream may end first; `Query.close()` (:3293-3300) ends the
 * stream at once; and the abort path waits a ~2 s grace before force-killing
 * (`SpawnOptions.signal`, :9821-9842). So the adapter observes the exit itself,
 * through the documented `Options.spawnClaudeCodeProcess` (:2473-2491).
 */

/** How long after `interrupt()` the adapter waits for a confirmed end before it aborts. */
export const CANCEL_INTERRUPT_WAIT_MS = 3_000;
/**
 * How long after `abort()` it waits before killing the process. Above the SDK's own
 * abort path on Windows (stdin EOF, ~2 s grace, then 5 s more before SIGKILL in the
 * installed code: 7032 ms observed in DSP-109's cancel-reply run).
 */
export const CANCEL_ABORT_WAIT_MS = 10_000;
/** How long after the kill it waits before reporting the end as `unconfirmed`. */
export const CANCEL_KILL_WAIT_MS = 2_000;

/**
 * DSpatch-added text that reaches the model's conversation when the PreToolUse
 * hook denies a tool after a cancellation request: the deny reason (sdk.d.ts
 * `PreToolUseHookSpecificOutput.permissionDecisionReason`) and the stop reason
 * (`SyncHookJSONOutput.stopReason`). Named constants so they are visible and
 * recorded with every Claude run (AGENT_BEHAVIOUR_AND_ORCHESTRATION.md: every
 * instruction DSpatch adds is visible and inspectable).
 */
export const CANCEL_DENY_REASON =
  'The user cancelled this run in DSpatch. This tool call was not run. Stop here.';
export const CANCEL_STOP_REASON = 'The user cancelled this run in DSpatch.';

/**
 * What the provider may still do after the run's end, as far as DSpatch can know:
 * always unknown. Recorded with every cancellation.
 */
export const PROVIDER_WORK_AFTER_END_NOTE =
  'unknown: model requests already sent (including one in flight at the cancel) may ' +
  'still be processed and billed by the provider; DSpatch sees only the messages the ' +
  'stream delivered and the exit of the local process';

/** The timer functions the cancellation waits use. Injectable so tests need no real waits. */
export interface CancelTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: CancelTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/** One call of a run's PreToolUse hook. */
export interface HookFiring {
  readonly dspatchRunId: DspatchRunId;
  readonly atUtc: Timestamp;
  readonly toolName: string;
  readonly toolUseId: string | null;
  /** `pass` leaves the decision to the normal permission rules; `deny` is the cancellation. */
  readonly decision: 'pass' | 'deny';
}

/** What happened to the one `interrupt()` call. */
export interface InterruptOutcome {
  /**
   * - `not-called`: the run had no query handle (cancelled before it started).
   * - `unavailable`: the handle offers no `interrupt()`; escalated at once.
   * - `pending`: called, not settled (yet).
   * - `resolved` / `rejected`: settled; a rejection escalates at once.
   */
  readonly status: 'not-called' | 'unavailable' | 'pending' | 'resolved' | 'rejected';
  readonly calledAtUtc: Timestamp | null;
  readonly settledAtUtc: Timestamp | null;
  /** The resolved value unchanged (the SDK's interrupt receipt, or `null`). */
  readonly receipt: unknown;
  /** Error name and message of a rejection. */
  readonly error: string | null;
}

/** The local Claude Code process of a run, as observed through `spawnClaudeCodeProcess`. */
export interface ProcessObservation {
  readonly pid: number | null;
  readonly spawnedAtUtc: Timestamp;
  readonly exitedAtUtc: Timestamp | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  /** Set when the process could not be started at all (Node's `error` event without a pid). */
  readonly spawnError: string | null;
  /** The last bytes the process wrote to stderr, or `null` if it wrote none. See {@link StderrTail}. */
  readonly stderrTail: StderrTail | null;
}

/** How much of the process's stderr is kept: the last bytes, at most this many. */
export const STDERR_TAIL_BYTES = 4_096;

/** The label every recorded stderr tail carries, so it is never mistaken for DSpatch's own text. */
export const STDERR_TAIL_LABEL =
  'raw Claude Code CLI stderr output, unedited: the last bytes the process wrote, ' +
  `at most ${String(STDERR_TAIL_BYTES)}`;

/**
 * The tail of the CLI's stderr. Only what the process wrote to stderr is kept;
 * DSpatch never adds environment values or anything else to it.
 */
export interface StderrTail {
  readonly label: string;
  /** How many bytes the text below was decoded from (at most {@link STDERR_TAIL_BYTES}). */
  readonly bytes: number;
  /** Whether earlier output was dropped to stay within the bound. */
  readonly truncated: boolean;
  readonly text: string;
}

/**
 * What counts as a confirmed end:
 * - `process-exit`: the stream ended and the observed process emitted `exit`.
 * - `spawn-failed`: the stream ended and the process never started (Node's
 *   `error` event without a pid, e.g. ENOENT for a missing executable): there is
 *   nothing left to stop. `process.pid` is `null`, `process.spawnError` says why.
 * - `not-started`: cancelled before `query()` was called.
 * - `none`: no confirmed end within the bounds (`unconfirmed`). This includes a
 *   run whose query handle exists but whose process was never observed: the SDK
 *   documents the spawn option as its only spawn path, not *when* it spawns, so a
 *   missing observation is never taken as proof that nothing is running.
 */
export interface EndEvidence {
  readonly kind: 'process-exit' | 'spawn-failed' | 'not-started' | 'none';
  readonly streamEnded: boolean;
  readonly process: ProcessObservation | null;
}

/** A tool_use or tool_result seen after the cancellation request. */
export interface ToolActivityAfterRequest {
  readonly atUtc: Timestamp;
  readonly toolUseId: string;
  readonly name: string;
}

export interface ToolResultAfterRequest extends ToolActivityAfterRequest {
  readonly status: 'ok' | 'error';
  /** True when this run's hook denied that tool call: it was not executed. */
  readonly deniedByHook: boolean;
}

/** Everything the adapter knows about one cancellation. For run records (S2/S3). */
export interface CancellationRecord {
  readonly dspatchRunId: DspatchRunId;
  readonly cancelRequestedAtUtc: Timestamp;
  readonly hook: {
    readonly matcher: null;
    readonly permissionDecisionReason: string;
    readonly stopReason: string;
  };
  /** This run's hook calls from its start, so passes before the request show too. */
  readonly hookFirings: readonly HookFiring[];
  readonly interrupt: InterruptOutcome;
  readonly abortRequestedAtUtc: Timestamp | null;
  readonly killRequestedAtUtc: Timestamp | null;
  /** What `kill('SIGKILL')` returned, or `null` if no kill was sent. */
  readonly killSignalSent: boolean | null;
  /** A `result` message that arrived after the request: recorded, not terminal (S1). */
  readonly resultAfterRequest: {
    readonly atUtc: Timestamp;
    readonly subtype: string | null;
    readonly isError: boolean | null;
  } | null;
  /**
   * The counting rule of the reconciled DSP-109 baseline (DSP-115 card): tool_use
   * blocks the stream delivered after the request, and of those, the ones
   * "executed" — followed by a tool result that was not a hook denial. Join these
   * two lists on `toolUseId` to apply it; the experiment record does
   * (`toolUseBlocksAfterRequestExecuted`).
   */
  readonly toolUseBlocksAfterRequest: readonly ToolActivityAfterRequest[];
  readonly toolResultsAfterRequest: readonly ToolResultAfterRequest[];
  /**
   * Tool results after the request that were not a hook denial, whatever their
   * status, including results of tools that started before the request.
   */
  readonly toolResultsNotDeniedAfterRequest: number;
  /** Of those, the ones with status `ok`. */
  readonly toolResultsOkAfterRequest: number;
  readonly streamEndedAtUtc: Timestamp | null;
  /** Error name and message if the stream ended by throwing. */
  readonly streamError: string | null;
  readonly end: RunEnd | null;
  readonly endAtUtc: Timestamp | null;
  readonly endEvidence: EndEvidence | null;
  readonly bounds: {
    readonly afterInterruptMs: number;
    readonly afterAbortMs: number;
    readonly afterKillMs: number;
  };
  readonly providerWorkAfterEnd: 'unknown';
  readonly providerWorkAfterEndNote: string;
}

/**
 * Node's `spawn`, as far as the process wrapper uses it. Injectable so the tests
 * check what is passed without starting a process.
 */
export type ClaudeProcessSpawner = (
  command: string,
  args: string[],
  options: {
    readonly cwd?: string;
    readonly env: Record<string, string | undefined>;
    readonly signal: AbortSignal;
    readonly stdio: ['pipe', 'pipe', 'pipe'];
    readonly windowsHide: true;
  },
) => ChildProcess;

const nodeSpawn: ClaudeProcessSpawner = (command, args, options) =>
  spawn(command, args, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: options.env,
    signal: options.signal,
    stdio: options.stdio,
    windowsHide: options.windowsHide,
  });

/** The one-message streaming-input prompt for a turn (S4). */
function oneMessagePrompt(text: string): AsyncIterable<SDKUserMessage> {
  return (async function* () {
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content: text },
      parent_tool_use_id: null,
    };
  })();
}

// --- Observations bound to runs ----------------------------------------------------

/** One `system`/`init` message and the DSpatch run whose `query()` produced it. */
export interface InitObservation {
  readonly dspatchRunId: DspatchRunId;
  readonly message: unknown;
}

/**
 * The `AccountInfo` fields DSpatch keeps. All four are documented in sdk.d.ts
 * 0.3.306 and hold no secret. `email` and `organization` are never copied.
 */
export const ACCOUNT_INFO_FIELDS = [
  'apiProvider',
  'subscriptionType',
  'tokenSource',
  'apiKeySource',
] as const;
export type AccountInfoField = (typeof ACCOUNT_INFO_FIELDS)[number];

/**
 * What one run's `accountInfo()` gave. `unavailable` is a missing observation,
 * never an error of the run itself. A field that is absent or not a string is
 * `null`.
 */
export type AccountObservation =
  | {
      readonly dspatchRunId: DspatchRunId;
      readonly status: 'observed';
      readonly fields: Readonly<Record<AccountInfoField, string | null>>;
    }
  | {
      readonly dspatchRunId: DspatchRunId;
      readonly status: 'unavailable';
      readonly reason: string;
    };

/** How long a run's `accountInfo()` may take before it counts as unavailable. */
const ACCOUNT_INFO_WAIT_MS = 10_000;

function accountFields(info: unknown): Record<AccountInfoField, string | null> {
  const record = asRecord(info);
  const fields = {} as Record<AccountInfoField, string | null>;
  for (const field of ACCOUNT_INFO_FIELDS) {
    const value = record[field];
    fields[field] = typeof value === 'string' ? value : null;
  }
  return fields;
}

/**
 * The SDK's `query()`, or a substitute with the same shape. The prompt is always
 * a one-message async iterable (streaming input mode, documented as required for
 * `interrupt()`), never a string.
 */
export type ClaudeQueryFunction = (params: {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: ClaudeQueryOptions;
}) => ClaudeQueryHandle;

async function loadSdkQuery(): Promise<ClaudeQueryFunction> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return sdk.query as unknown as ClaudeQueryFunction;
}

export interface ClaudeAgentSdkAdapterOptions {
  /**
   * Substitute for the SDK's `query()`. When given, the SDK is never loaded.
   * Tests use this; nothing in the product should.
   */
  readonly queryFn?: ClaudeQueryFunction;
  /** Recorded authorization for a live run. See {@link LiveAuthorization}. */
  readonly authorization?: LiveAuthorization | null;
  /** The environment to assess and pass on. Defaults to a copy of `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Compare variable names without regard to case. Defaults to the host rule
   * (true on Windows). Tests set it to check either rule on any host.
   */
  readonly caseInsensitiveEnv?: boolean;
  readonly permissions?: ClaudePermissionPolicy;
  /** Substitute for Node's `spawn` in the process wrapper. Tests only. */
  readonly spawnProcess?: ClaudeProcessSpawner;
  /** Substitute timers for the cancellation waits. Tests only. */
  readonly timers?: CancelTimers;
}

// --- Capabilities --------------------------------------------------------------

/**
 * What this instance offers: Claude **plus the Agent SDK transport**.
 *
 * - `resume` is `unsupported`: a second turn in the same instance continues the
 *   provider session, but `AgentAdapter.resume` across processes is deferred.
 * - `approvals` is `unsupported`: `canUseTool` is not wired to anything that can
 *   answer, and `dontAsk` means it is never called.
 * - `usageReporting` is `unknown` until observed. Token counts arrive on the
 *   result message; `total_cost_usd` is the SDK's local estimate and is never
 *   reported as a charge.
 * - No containment is claimed; the report has no such capability.
 */
const CAPABILITIES: CapabilityReport = {
  start: 'supported',
  streaming: 'supported',
  cancel: 'supported',
  resume: 'unsupported',
  modelSelection: 'supported',
  approvals: 'unsupported',
  usageReporting: 'unknown',
};

/** How long `send` waits for the previous turn's process to finish its stream. */
const PREVIOUS_TURN_EXIT_MS = 15_000;

interface ClaudeRun {
  readonly dspatchRunId: DspatchRunId;
  readonly abortController: AbortController;
  handle: ClaudeQueryHandle | null;
  status: RunStatus;
  cancelRequested: boolean;
  terminalEmitted: boolean;
  streamPumpFinished: boolean;
  /** Text of the completed top-level text blocks, in order. */
  assistantText: string;
  /**
   * Top-level text deltas not yet covered by a completed text block: the block
   * being streamed now. Cleared when an assistant message with a text block
   * arrives. Used only when the run ends early; see `finishRun`.
   *
   * Documented (https://code.claude.com/docs/en/agent-sdk/streaming-output,
   * "Message flow", accessed 21 Oct 2026): with partial messages enabled, each
   * block's `AssistantMessage` arrives before that block's `content_block_stop`
   * and before the next block's start; if that holds, clearing here does not drop
   * the next block's deltas. The same page's "Handle a stream that's cut off" documents
   * `message_stop` and, for a cut text block, `content_block_stop`, for Claude
   * Code v2.1.290+ (bundled from SDK v0.3.290; installed here 0.3.306).
   * Not documented: whether a cut text block still gets its `AssistantMessage` —
   * which is why this text is kept for an early end. None of this ordering has
   * been observed in this repository.
   */
  pendingText: string;
  pump: Promise<void> | null;
  /** The local process, once the SDK has spawned it through the wrapper. */
  process: ObservedProcess | null;
  streamEndedAt: Timestamp | null;
  streamError: string | null;
  readonly hookFirings: HookFiring[];
  readonly deniedToolUseIds: Set<string>;
  /** Set by `cancel()`; `null` for a run nobody cancelled (or only `dispose` stopped). */
  cancellation: CancellationState | null;
  /** Conditions the cancellation is waiting on, re-checked on every change. */
  readonly waiters: Set<() => void>;
  /** True once `dispose` has taken over: the stop sequence emits nothing more. */
  stopAbandoned: boolean;
}

/** The mutable side of a {@link CancellationRecord}. */
interface CancellationState {
  readonly requestedAt: Timestamp;
  /** True when the stop sequence (interrupt, waits, escalation) is running for this run. */
  sequenceStarted: boolean;
  /** Whether `run.cancel_requested` has been emitted (only ever after `run.started`). */
  requestEmitted: boolean;
  interrupt: InterruptOutcome;
  abortRequestedAt: Timestamp | null;
  killRequestedAt: Timestamp | null;
  killSignalSent: boolean | null;
  resultAfterRequest: CancellationRecord['resultAfterRequest'];
  /** The `result` message that arrived after the request, for the terminal event. */
  resultMessage: unknown;
  readonly toolUseBlocks: ToolActivityAfterRequest[];
  readonly toolResults: ToolResultAfterRequest[];
  end: RunEnd | null;
  endAt: Timestamp | null;
  endEvidence: EndEvidence | null;
}

/** The process the SDK spawned for a run, and whether it has been seen to exit. */
interface ObservedProcess {
  readonly child: ChildProcess;
  readonly pid: number | null;
  readonly spawnedAt: Timestamp;
  exit: {
    readonly at: Timestamp;
    readonly code: number | null;
    readonly signal: string | null;
    readonly spawnError: string | null;
  } | null;
  /** The last stderr bytes, at most {@link STDERR_TAIL_BYTES}. */
  stderr: Buffer;
  stderrTruncated: boolean;
}

interface SessionState {
  readonly dspatchSessionId: DspatchSessionId;
  readonly config: SessionConfig;
  /** The UUID DSpatch chose for the provider session. */
  readonly providerSessionId: string;
  readonly createdAt: Timestamp;
  readonly listeners: Set<AgentEventListener>;
  readonly runReadings: Map<DspatchRunId, UsageReading[]>;
  readonly messageTypes: Map<string, number>;
  readonly toolNames: Map<string, string>;
  /** Every init message with the run that produced it, in arrival order. */
  readonly initObservations: InitObservation[];
  /** One bounded `accountInfo()` read per run that called `query()`, in run order. */
  readonly accountReads: Promise<AccountObservation>[];
  readonly resultMessages: unknown[];
  readonly observedSessionIds: string[];
  /**
   * Every run whose stream has not ended yet, including one waiting for the
   * previous turn. `dispose` stops all of them, not only `lastRun`.
   */
  readonly outstanding: Set<ClaudeRun>;
  /** Every run of the session, in order. For the cancellation and hook records. */
  readonly runs: ClaudeRun[];
  /**
   * A cancelled run whose end was `unconfirmed`. While its end stays unconfirmed,
   * `send` refuses: a new turn would resume the provider session while that
   * process may still be writing it.
   */
  unconfirmedRun: ClaudeRun | null;
  /** True once the provider has reported this session, so later turns resume it. */
  established: boolean;
  activeRun: ClaudeRun | null;
  lastRun: ClaudeRun | null;
  modelReportedValue: string | null;
}

function nowIso(): Timestamp {
  return new Date().toISOString();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function newSessionId(): DspatchSessionId {
  return `dsp-session-${randomUUID()}`;
}

function newRunId(): DspatchRunId {
  return `dsp-run-${randomUUID()}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function errorText(error: unknown): string {
  const name = error instanceof Error && error.name !== '' ? error.name : 'UnknownError';
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message}`;
}

function stderrTailOf(observed: ObservedProcess | null): StderrTail | null {
  if (observed === null || observed.stderr.length === 0) {
    return null;
  }
  return {
    label: STDERR_TAIL_LABEL,
    bytes: observed.stderr.length,
    truncated: observed.stderrTruncated,
    text: observed.stderr.toString('utf8'),
  };
}

function processObservation(observed: ObservedProcess | null): ProcessObservation | null {
  if (observed === null) {
    return null;
  }
  return {
    pid: observed.pid,
    spawnedAtUtc: observed.spawnedAt,
    exitedAtUtc: observed.exit?.at ?? null,
    exitCode: observed.exit?.code ?? null,
    signal: observed.exit?.signal ?? null,
    spawnError: observed.exit?.spawnError ?? null,
    stderrTail: stderrTailOf(observed),
  };
}

/**
 * The confirmed-end evidence for a run, or `null` while there is none: the stream
 * has ended and the observed process has exited (or never started). A run with no
 * observed process has no confirmed end (B1, review 003): see {@link EndEvidence}.
 */
function confirmedEnd(run: ClaudeRun): EndEvidence | null {
  if (run.streamEndedAt === null || run.process === null || run.process.exit === null) {
    return null;
  }
  return {
    kind: run.process.exit.spawnError === null ? 'process-exit' : 'spawn-failed',
    streamEnded: true,
    process: processObservation(run.process),
  };
}

function toAdapterError(operation: string, error: unknown): ClaudeAdapterError {
  const name = error instanceof Error && error.name !== '' ? error.name : 'UnknownError';
  const message = error instanceof Error ? error.message : String(error);
  return new ClaudeAdapterError(
    `Claude adapter operation "${operation}" failed: ${name}: ${message}`,
    name,
    error,
  );
}

/**
 * The provider session ID for one of DSpatch's session IDs: a SHA-256 digest
 * shaped as a version-4 UUID, because the SDK's `sessionId` must be a valid UUID.
 * The same pattern as the Cursor adapter's mapping, kept separate on purpose.
 */
export function providerSessionIdFor(dspatchSessionId: DspatchSessionId): string {
  const hex = createHash('sha256').update(`claude:${dspatchSessionId}`).digest('hex');
  const at = (index: number): string => hex[index] ?? '0';
  const variant = ((parseInt(at(16), 16) & 0x3) | 0x8).toString(16);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}` +
    `-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/**
 * The one root this adapter accepts. More than one distinct root is refused:
 * DSP-109 covers a single working directory only.
 */
export function singleRoot(config: SessionConfig): string {
  const fold = (folder: string): string =>
    process.platform === 'win32' ? folder.toLowerCase() : folder;
  const roots: string[] = [];
  for (const folder of [config.workspacePath, ...(config.workspacePaths ?? [])]) {
    if (folder !== '' && !roots.some((kept) => fold(kept) === fold(folder))) {
      roots.push(folder);
    }
  }
  if (roots.length > 1) {
    throw new ClaudeAdapterError(
      `This session names ${String(roots.length)} working folders, and the Claude ` +
        'adapter supports exactly one. Start it with a single folder.',
    );
  }
  if (roots.length === 0) {
    throw new ClaudeAdapterError('This session names no working folder.');
  }
  return config.workspacePath;
}

export class ClaudeAgentSdkAdapter implements AgentAdapter {
  /** Provider plus transport. Not "Claude Code". */
  readonly id = 'claude-agent-sdk';

  private readonly substitutedQuery: ClaudeQueryFunction | null;

  private loadedQuery: ClaudeQueryFunction | null = null;

  private readonly permissions: ClaudePermissionPolicy;

  private readonly assessment: AuthenticationAssessment;

  private readonly subprocessEnv: Record<string, string | undefined>;

  private readonly sessions = new Map<DspatchSessionId, SessionState>();

  private readonly spawnProcess: ClaudeProcessSpawner;

  private readonly timers: CancelTimers;

  private readonly caseInsensitive: boolean;

  private disposed = false;

  constructor(options: ClaudeAgentSdkAdapterOptions = {}) {
    this.substitutedQuery = options.queryFn ?? null;
    this.spawnProcess = options.spawnProcess ?? nodeSpawn;
    this.timers = options.timers ?? REAL_TIMERS;
    this.permissions = options.permissions ?? FIXTURE_PERMISSIONS;
    // Checked at run time too: a JavaScript caller or a cast can pass anything.
    if ((this.permissions.permissionMode as string) !== 'dontAsk') {
      throw new ClaudeAdapterError(
        `Permission mode "${String(this.permissions.permissionMode)}" is not used by ` +
          "DSpatch's Claude adapter. Only 'dontAsk' is: nothing here can answer a " +
          'permission prompt.',
      );
    }
    if ((this.permissions.strictMcpConfig as boolean) !== true) {
      throw new ClaudeAdapterError(
        "A permission policy without strictMcpConfig true is not used by DSpatch's " +
          'Claude adapter: the subprocess would attach MCP servers from project ' +
          '.mcp.json, user settings, plugins and claude.ai connectors, none of which ' +
          'DSpatch configured.',
      );
    }
    const env = { ...(options.env ?? process.env) };
    const matching =
      options.caseInsensitiveEnv === undefined
        ? undefined
        : { caseInsensitive: options.caseInsensitiveEnv };
    this.caseInsensitive = caseInsensitiveFor(matching);
    // Wherever the real SDK would run, a recorded authorization is required.
    this.assessment = assessAuthentication(
      env,
      options.authorization,
      this.substitutedQuery === null,
      matching,
    );
    this.subprocessEnv = providerEnvironment(env, this.assessment.authorization, matching);
  }

  /** The authentication decision, with variable names only. For run records. */
  authentication(): AuthenticationAssessment {
    return this.assessment;
  }

  /** The permission configuration passed to every turn. For run records. */
  permissionPolicy(): ClaudePermissionPolicy {
    return this.permissions;
  }

  async startSession(config: SessionConfig): Promise<SessionHandle> {
    this.assertUsable();
    if (config.provider !== 'claude') {
      throw new ClaudeAdapterError(
        `This adapter serves the "claude" provider, not "${config.provider}".`,
      );
    }
    if (this.assessment.refusal !== null) {
      throw new ClaudeAdapterError(this.assessment.refusal, 'authentication_refused');
    }
    singleRoot(config);
    const dspatchSessionId = config.dspatchSessionId ?? newSessionId();
    if (this.sessions.has(dspatchSessionId)) {
      throw new ClaudeAdapterError(
        `Session "${dspatchSessionId}" is already open. Close it before reusing the ID.`,
      );
    }
    const createdAt = nowIso();
    const providerSessionId = providerSessionIdFor(dspatchSessionId);
    this.sessions.set(dspatchSessionId, {
      dspatchSessionId,
      config,
      providerSessionId,
      createdAt,
      listeners: new Set(),
      runReadings: new Map(),
      messageTypes: new Map(),
      toolNames: new Map(),
      initObservations: [],
      accountReads: [],
      resultMessages: [],
      observedSessionIds: [],
      outstanding: new Set(),
      runs: [],
      unconfirmedRun: null,
      established: false,
      activeRun: null,
      lastRun: null,
      modelReportedValue: null,
    });
    return { dspatchSessionId, provider: 'claude', providerSessionId, createdAt };
  }

  /** Not implemented: resuming across processes is outside DSP-109. */
  resume(sessionId: DspatchSessionId, _config: SessionConfig): Promise<SessionHandle> {
    return Promise.reject(
      new ClaudeAdapterError(
        `Resuming session "${sessionId}" in a new adapter instance is not supported by ` +
          'the Claude adapter yet. Later turns in the same instance continue the session.',
      ),
    );
  }

  /**
   * One `query()` per turn: the first with `sessionId`, later ones with `resume`,
   * both the UUID DSpatch chose. Waits, bounded, for the previous turn's stream to
   * end first, so two provider processes never write the same session at once.
   */
  async send(sessionId: DspatchSessionId, prompt: string): Promise<RunReference> {
    this.assertUsable();
    const state = this.requireSession(sessionId);
    if (state.activeRun !== null) {
      throw new ClaudeAdapterError(
        `Session "${sessionId}" already has an active run ` +
          `(${state.activeRun.dspatchRunId}). At most one run per session.`,
      );
    }
    if (state.unconfirmedRun !== null) {
      if (confirmedEnd(state.unconfirmedRun) === null) {
        throw new ClaudeAdapterError(
          `The cancelled run ${state.unconfirmedRun.dspatchRunId} in session "${sessionId}" ` +
            'was not seen to stop: its Claude Code process had not exited when DSpatch ' +
            'stopped waiting. A new turn would continue the same provider session while ' +
            'that process may still be writing it, so it was not started. Start a new session.',
        );
      }
      state.unconfirmedRun = null;
    }
    const run: ClaudeRun = {
      dspatchRunId: newRunId(),
      abortController: new AbortController(),
      handle: null,
      status: 'created',
      cancelRequested: false,
      terminalEmitted: false,
      streamPumpFinished: false,
      assistantText: '',
      pendingText: '',
      pump: null,
      process: null,
      streamEndedAt: null,
      streamError: null,
      hookFirings: [],
      deniedToolUseIds: new Set(),
      cancellation: null,
      waiters: new Set(),
      stopAbandoned: false,
    };
    const previous = state.lastRun;
    state.activeRun = run;
    state.lastRun = run;
    state.outstanding.add(run);
    state.runs.push(run);

    if (previous?.pump != null && !previous.streamPumpFinished) {
      const ended = await this.settlesWithinBound(previous.pump, PREVIOUS_TURN_EXIT_MS);
      if (this.disposed) {
        // Disposed while waiting: `dispose` has stopped the previous turn, and
        // this one must not start a provider process after it.
        run.cancelRequested = true;
        this.finishRun(state, run, 'cancelled');
        this.markPumpFinished(state, run);
        throw new ClaudeAdapterError(
          'This adapter instance was disposed while the turn waited for the previous ' +
            'one to finish, so the turn was not started.',
        );
      }
      if (!ended) {
        // The turn never started: no `run.started`, and a cancel requested while it
        // waited was never emitted (see `cancel`), so no event of it is left behind.
        state.activeRun = null;
        state.lastRun = previous;
        state.outstanding.delete(run);
        state.runs.splice(state.runs.indexOf(run), 1);
        throw new ClaudeAdapterError(
          `The previous turn in session "${sessionId}" is still delivering messages ` +
            `after ${String(PREVIOUS_TURN_EXIT_MS)} ms, so a new turn was not started.`,
        );
      }
    }

    this.emit(state, {
      type: 'run.started',
      dspatchSessionId: sessionId,
      dspatchRunId: run.dspatchRunId,
      at: nowIso(),
      rawProviderEvent: null,
    });
    run.status = 'running';
    if (run.cancellation !== null && !run.cancellation.requestEmitted) {
      // Cancelled while waiting for the previous turn: reported after `run.started`.
      this.emitCancelRequested(state, run, run.cancellation);
    }

    try {
      const queryFn = await this.queryFunction();
      if (run.cancelRequested || this.disposed) {
        // Cancelled (or disposed) while waiting for the previous turn or for the
        // SDK to load: the provider is never started, rather than started aborted.
        this.finishNotStarted(state, run);
        this.markPumpFinished(state, run);
        return { dspatchRunId: run.dspatchRunId };
      }
      run.handle = queryFn({
        prompt: oneMessagePrompt(prompt),
        options: this.optionsFor(state, run),
      });
      state.accountReads.push(readAccount(run.dspatchRunId, run.handle));
    } catch (error) {
      const adapterError = toAdapterError('send', error);
      const failure = {
        message: adapterError.message,
        ...(adapterError.providerCode === undefined
          ? {}
          : { providerCode: adapterError.providerCode }),
      };
      run.streamEndedAt = nowIso();
      if (run.cancelRequested && run.process === null) {
        this.finishNotStarted(state, run, failure);
      } else {
        this.finishRun(state, run, run.cancelRequested ? 'cancelled' : 'error', failure);
      }
      this.markPumpFinished(state, run);
      throw adapterError;
    }
    run.pump = this.pump(state, run, run.handle);
    return { dspatchRunId: run.dspatchRunId };
  }

  subscribe(sessionId: DspatchSessionId, onEvent: AgentEventListener): Unsubscribe {
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
   * Request cancellation (DSP-115; see "Cancellation" above). Emits
   * `run.cancel_requested` and resolves at once; it never waits for the provider.
   * The run's hook denies every later tool call, `interrupt()` is called once, and
   * the terminal `run.finished` (status `cancelled`, with `end`) follows the
   * confirmed end or the last bound. A second call while the first is in progress
   * does nothing. Whether the remote model call stops is not claimed.
   */
  async cancel(sessionId: DspatchSessionId): Promise<void> {
    this.assertUsable();
    const state = this.requireSession(sessionId);
    const run = state.activeRun;
    if (run === null) {
      throw new ClaudeAdapterError(`Session "${sessionId}" has no run in progress to cancel.`);
    }
    if (run.cancelRequested) {
      return;
    }
    run.cancelRequested = true;
    const requestedAt = nowIso();
    run.cancellation = {
      requestedAt,
      sequenceStarted: false,
      requestEmitted: false,
      interrupt: {
        status: 'not-called',
        calledAtUtc: null,
        settledAtUtc: null,
        receipt: null,
        error: null,
      },
      abortRequestedAt: null,
      killRequestedAt: null,
      killSignalSent: null,
      resultAfterRequest: null,
      resultMessage: null,
      toolUseBlocks: [],
      toolResults: [],
      end: null,
      endAt: null,
      endEvidence: null,
    };
    // A run still waiting for the previous turn has not emitted `run.started`; its
    // request is reported once it starts (N3), and never if it does not.
    if (run.status !== 'created') {
      this.emitCancelRequested(state, run, run.cancellation);
    }
    // Without a handle the turn has not reached query(): `send` ends it as not started.
    if (run.handle !== null && !run.terminalEmitted) {
      run.cancellation.sequenceStarted = true;
      void this.stopSequence(state, run, run.handle).catch(() => {
        // Not expected; but a run must not be left without its terminal event.
        this.finishCancelled(state, run, 'unconfirmed', {
          kind: 'none',
          streamEnded: run.streamEndedAt !== null,
          process: processObservation(run.process),
        });
      });
    }
    await Promise.resolve();
  }

  /** The SDK lists models only on a live query, so this instance cannot. */
  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.reject(
      new ClaudeAdapterError(
        'The Claude Agent SDK lists models only from a running session. Request a ' +
          'model by name instead.',
      ),
    );
  }

  /**
   * Token readings from result messages. A missing number is `null`, never `0`.
   * A session query returns every turn reading held for the session.
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
    return [...state.runReadings.values()].flat();
  }

  respondToApproval(requestId: string, _decision: ApprovalDecision): Promise<void> {
    return Promise.reject(
      new ClaudeAdapterError(
        `The Claude adapter cannot answer approval request "${requestId}": it runs in ` +
          "'dontAsk' mode, where anything not pre-approved is denied rather than asked.",
      ),
    );
  }

  capabilities(): CapabilityReport {
    return CAPABILITIES;
  }

  /**
   * Abort and close every turn still running, then wait briefly for the streams.
   * A cancellation in progress is abandoned: its timers are cleared and it emits
   * nothing more (listeners are removed first anyway). Idempotent and never throws.
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const states = [...this.sessions.values()];
    this.sessions.clear();
    const pumps: Promise<void>[] = [];
    for (const state of states) {
      state.listeners.clear();
      for (const run of state.runs) {
        this.abandonStop(run);
      }
      // Every outstanding run, not only the latest: a turn waiting in `send`
      // replaces `lastRun` while the previous turn's query may still be open.
      for (const run of [...state.outstanding]) {
        if (run.streamPumpFinished) {
          continue;
        }
        run.cancelRequested = true;
        try {
          run.abortController.abort();
        } catch {
          // Shutdown path: a failed abort must not prevent the close or the exit.
        }
        try {
          run.handle?.close?.();
        } catch {
          // Shutdown path: a failed close must not prevent the app from exiting.
        }
        if (run.pump !== null) {
          pumps.push(run.pump);
        }
      }
    }
    if (pumps.length > 0) {
      await settlesWithin(Promise.allSettled(pumps).then(() => undefined), 5_000);
    }
  }

  // --- Observations for run records (beyond AgentAdapter) ----------------------

  /** The `system`/`init` messages seen, unchanged, in arrival order. */
  initMessages(sessionId: DspatchSessionId): readonly unknown[] {
    return this.requireSession(sessionId).initObservations.map((entry) => entry.message);
  }

  /**
   * The init messages with the DSpatch run whose `query()` produced each one, in
   * arrival order. Use this, not positions, to say which turn reported what.
   */
  initObservations(sessionId: DspatchSessionId): readonly InitObservation[] {
    return [...this.requireSession(sessionId).initObservations];
  }

  /**
   * What each run's `accountInfo()` gave, in run order: only
   * {@link ACCOUNT_INFO_FIELDS}, never `email` or `organization`. Waits for reads
   * still under way, each bounded by its own timeout, so this always settles.
   */
  async accountObservations(sessionId: DspatchSessionId): Promise<readonly AccountObservation[]> {
    return Promise.all(this.requireSession(sessionId).accountReads);
  }

  /** The `result` messages seen, unchanged. */
  resultMessages(sessionId: DspatchSessionId): readonly unknown[] {
    return [...this.requireSession(sessionId).resultMessages];
  }

  /** Every distinct `session_id` the provider reported, in order. */
  providerSessionIdsObserved(sessionId: DspatchSessionId): readonly string[] {
    return [...this.requireSession(sessionId).observedSessionIds];
  }

  /** Message counts by `type` or `type/subtype`. */
  providerMessageTypes(sessionId: DspatchSessionId): Record<string, number> {
    return Object.fromEntries(this.requireSession(sessionId).messageTypes);
  }

  /** Whether the most recent turn's stream has ended. */
  streamPumpFinished(sessionId: DspatchSessionId): boolean | null {
    const lastRun = this.requireSession(sessionId).lastRun;
    return lastRun === null ? null : lastRun.streamPumpFinished;
  }

  /** The model the init message reported, or `null` if none has. */
  modelReported(sessionId: DspatchSessionId): string | null {
    return this.requireSession(sessionId).modelReportedValue;
  }

  /** The title passed as `Options.title` on every `query()` of this session. For run records. */
  sessionTitle(sessionId: DspatchSessionId): string {
    return sessionTitleFor(this.requireSession(sessionId));
  }

  hasActiveRun(sessionId: DspatchSessionId): boolean {
    return this.sessions.get(sessionId)?.activeRun != null;
  }

  /** Every PreToolUse hook call in the session, in order, with the run it belonged to. */
  hookFirings(sessionId: DspatchSessionId): readonly HookFiring[] {
    return this.requireSession(sessionId).runs.flatMap((run) => run.hookFirings);
  }

  /** What the adapter knows about a run's cancellation, or `null` if it was not cancelled. */
  cancellation(sessionId: DspatchSessionId, dspatchRunId: DspatchRunId): CancellationRecord | null {
    const run = this.requireSession(sessionId).runs.find(
      (entry) => entry.dspatchRunId === dspatchRunId,
    );
    const state = run?.cancellation ?? null;
    if (run === undefined || state === null) {
      return null;
    }
    const toolResults = [...state.toolResults];
    return {
      dspatchRunId: run.dspatchRunId,
      cancelRequestedAtUtc: state.requestedAt,
      hook: {
        matcher: null,
        permissionDecisionReason: CANCEL_DENY_REASON,
        stopReason: CANCEL_STOP_REASON,
      },
      hookFirings: [...run.hookFirings],
      interrupt: { ...state.interrupt },
      abortRequestedAtUtc: state.abortRequestedAt,
      killRequestedAtUtc: state.killRequestedAt,
      killSignalSent: state.killSignalSent,
      resultAfterRequest: state.resultAfterRequest,
      toolUseBlocksAfterRequest: [...state.toolUseBlocks],
      toolResultsAfterRequest: toolResults,
      toolResultsNotDeniedAfterRequest: toolResults.filter((entry) => !entry.deniedByHook).length,
      toolResultsOkAfterRequest: toolResults.filter(
        (entry) => !entry.deniedByHook && entry.status === 'ok',
      ).length,
      streamEndedAtUtc: run.streamEndedAt,
      streamError: run.streamError,
      end: state.end,
      endAtUtc: state.endAt,
      endEvidence: state.endEvidence,
      bounds: {
        afterInterruptMs: CANCEL_INTERRUPT_WAIT_MS,
        afterAbortMs: CANCEL_ABORT_WAIT_MS,
        afterKillMs: CANCEL_KILL_WAIT_MS,
      },
      providerWorkAfterEnd: 'unknown',
      providerWorkAfterEndNote: PROVIDER_WORK_AFTER_END_NOTE,
    };
  }

  // --- Internals ------------------------------------------------------------------

  private async queryFunction(): Promise<ClaudeQueryFunction> {
    if (this.substitutedQuery !== null) {
      return this.substitutedQuery;
    }
    this.loadedQuery ??= await loadSdkQuery();
    return this.loadedQuery;
  }

  private optionsFor(state: SessionState, run: ClaudeRun): ClaudeQueryOptions {
    const { config } = state;
    return {
      cwd: config.workspacePath,
      ...(config.modelRequested === '' ? {} : { model: config.modelRequested }),
      tools: [...this.permissions.tools],
      allowedTools: [...this.permissions.allowedTools],
      permissionMode: this.permissions.permissionMode,
      settingSources: [],
      // Only the MCP servers passed here (none) — not project `.mcp.json`, user
      // settings, plugins or claude.ai connectors. See ClaudePermissionPolicy.
      strictMcpConfig: this.permissions.strictMcpConfig,
      // The title DSpatch chooses (sdk.d.ts 0.3.306 :2461-2469: the session uses
      // it instead of auto-generating one from the first user message; on
      // `resume` the persisted title — the same value — takes precedence). It makes
      // the provider transcript traceable to the DSpatch session and, per the
      // documentation, skips the background title request: the most likely, not
      // established, source of the unrequested claude-haiku-5-5 usage in the
      // 22 Oct 2026 probe. Whether that call disappears is to be observed live.
      title: sessionTitleFor(state),
      includePartialMessages: true,
      abortController: run.abortController,
      // This run's own PreToolUse hook, without a matcher so it sees every tool:
      // it passes until the run is cancelled and denies from then on. Hooks run
      // before allow rules and the permission mode, so the deny holds in `dontAsk`
      // for pre-approved tools too, where `canUseTool` is never asked (hooks and
      // permissions documentation, read 22 Oct 2026). It is also what keeps
      // `interrupt()` deliverable: in the installed SDK (sdk.mjs 0.3.306,
      // `hasBidirectionalNeeds` / `streamInput`; code, not contract) a registered
      // hook keeps the CLI's stdin open after the one-message prompt is consumed,
      // and without one stdin would close and no control request could reach it.
      hooks: { PreToolUse: [{ hooks: [this.cancelHook(run)] }] },
      // The SDK's own spawn, wrapped only to observe the process exit (see
      // `spawnObserved`); same command, arguments and environment.
      spawnClaudeCodeProcess: (spawnOptions) => this.spawnObserved(run, spawnOptions),
      env: { ...this.subprocessEnv },
      ...(state.established
        ? { resume: state.providerSessionId }
        : { sessionId: state.providerSessionId }),
    };
  }

  private async pump(
    state: SessionState,
    run: ClaudeRun,
    handle: ClaudeQueryHandle,
  ): Promise<void> {
    let failure: unknown = null;
    try {
      for await (const message of handle) {
        this.handleMessage(state, run, message);
      }
    } catch (error) {
      failure = error;
    } finally {
      run.streamEndedAt = nowIso();
      if (failure !== null) {
        run.streamError = errorText(failure);
      }
      if (run.cancellation?.sequenceStarted === true) {
        // The stop sequence owns the terminal: it waits for the process exit too.
        this.wake(run);
      } else if (!run.terminalEmitted) {
        if (run.cancelRequested) {
          // Only `dispose` cancels without the stop sequence; nobody is listening.
          this.finishRun(state, run, 'cancelled');
        } else if (failure !== null) {
          const adapterError = toAdapterError('query', failure);
          const tail = stderrTailOf(run.process);
          this.finishRun(state, run, 'error', {
            message:
              tail === null
                ? adapterError.message
                : `${adapterError.message}\n\nClaude Code stderr (${tail.label}):\n${tail.text}`,
            ...(adapterError.providerCode === undefined
              ? {}
              : { providerCode: adapterError.providerCode }),
          });
        } else {
          this.finishRun(state, run, 'error', {
            message: 'The Claude Agent SDK stream ended without a result message.',
          });
        }
      }
      this.markPumpFinished(state, run);
    }
  }

  private markPumpFinished(state: SessionState, run: ClaudeRun): void {
    run.streamPumpFinished = true;
    state.outstanding.delete(run);
  }

  private handleMessage(state: SessionState, run: ClaudeRun, message: SDKMessage): void {
    const raw = asRecord(message);
    const type = typeof raw['type'] === 'string' ? raw['type'] : 'unknown';
    const subtype = typeof raw['subtype'] === 'string' ? raw['subtype'] : null;
    const key = subtype === null ? type : `${type}/${subtype}`;
    state.messageTypes.set(key, (state.messageTypes.get(key) ?? 0) + 1);

    const reportedSession = raw['session_id'];
    if (typeof reportedSession === 'string' && reportedSession !== '') {
      if (!state.observedSessionIds.includes(reportedSession)) {
        state.observedSessionIds.push(reportedSession);
      }
      if (reportedSession === state.providerSessionId) {
        state.established = true;
      }
    }

    const base = {
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId: run.dspatchRunId,
      at: nowIso(),
      rawProviderEvent: message,
    };
    const topLevel = raw['parent_tool_use_id'] === null || raw['parent_tool_use_id'] === undefined;

    switch (type) {
      case 'system': {
        if (subtype === 'init') {
          state.initObservations.push({ dspatchRunId: run.dspatchRunId, message });
          if (typeof raw['model'] === 'string') {
            state.modelReportedValue = raw['model'];
          }
        }
        return;
      }
      case 'stream_event': {
        if (!topLevel) {
          return;
        }
        const event = asRecord(raw['event']);
        if (event['type'] !== 'content_block_delta') {
          return;
        }
        const delta = asRecord(event['delta']);
        if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
          run.pendingText += delta['text'];
          this.emitForRun(state, run, { ...base, type: 'assistant.delta', text: delta['text'] });
        } else if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
          this.emitForRun(state, run, { ...base, type: 'reasoning.delta', text: delta['thinking'] });
        }
        return;
      }
      case 'assistant': {
        const content = asRecord(raw['message'])['content'];
        if (!Array.isArray(content)) {
          return;
        }
        for (const entry of content) {
          const block = asRecord(entry);
          if (block['type'] === 'text' && topLevel && typeof block['text'] === 'string') {
            // Complete blocks, one per message; the deltas above carry the same text,
            // so the deltas received so far are now covered and are not kept twice.
            run.assistantText += block['text'];
            run.pendingText = '';
          } else if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
            const name = typeof block['name'] === 'string' ? block['name'] : 'unknown';
            state.toolNames.set(block['id'], name);
            run.cancellation?.toolUseBlocks.push({ atUtc: base.at, toolUseId: block['id'], name });
            this.emitForRun(state, run, { ...base, type: 'tool.started', toolCallId: block['id'], name });
          }
        }
        return;
      }
      case 'user': {
        const content = asRecord(raw['message'])['content'];
        if (!Array.isArray(content)) {
          return;
        }
        for (const entry of content) {
          const block = asRecord(entry);
          if (block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
            const toolUseId = block['tool_use_id'];
            const name = state.toolNames.get(toolUseId) ?? 'unknown';
            const status = block['is_error'] === true ? 'error' : 'ok';
            run.cancellation?.toolResults.push({
              atUtc: base.at,
              toolUseId,
              name,
              status,
              deniedByHook: run.deniedToolUseIds.has(toolUseId),
            });
            this.emitForRun(state, run, {
              ...base,
              type: 'tool.finished',
              toolCallId: toolUseId,
              name,
              status,
            });
          }
        }
        return;
      }
      case 'result': {
        state.resultMessages.push(message);
        const readings = this.tokenReadings(raw['usage'], base.at);
        const existing = state.runReadings.get(run.dspatchRunId) ?? [];
        state.runReadings.set(run.dspatchRunId, [...existing, ...readings]);
        this.emitForRun(state, run, { ...base, type: 'usage', readings });

        if (run.cancellation !== null) {
          // S1: recorded with its usage, but not the end. The terminal waits for
          // the confirmed end (or the last bound) in the stop sequence.
          if (run.cancellation.resultAfterRequest === null) {
            run.cancellation.resultAfterRequest = {
              atUtc: base.at,
              subtype,
              isError: typeof raw['is_error'] === 'boolean' ? raw['is_error'] : null,
            };
            run.cancellation.resultMessage = message;
          }
          return;
        }
        if (run.cancelRequested) {
          // Only `dispose` cancels without a cancellation record; nobody is listening.
          this.finishRun(state, run, 'cancelled', undefined, message);
          return;
        }
        if (subtype === 'success' && raw['is_error'] !== true) {
          this.finishRun(state, run, 'finished', undefined, message);
          return;
        }
        const errors = Array.isArray(raw['errors'])
          ? raw['errors'].filter((entry): entry is string => typeof entry === 'string')
          : [];
        const resultText = typeof raw['result'] === 'string' ? raw['result'] : '';
        const detail = errors.length > 0 ? errors.join('; ') : resultText;
        this.finishRun(
          state,
          run,
          'error',
          {
            message: `Claude reported ${subtype ?? 'an error'}${detail === '' ? '' : `: ${detail}`}`,
            ...(subtype === null ? {} : { providerCode: subtype }),
          },
          message,
        );
        return;
      }
      default:
        return;
    }
  }

  private tokenReadings(usage: unknown, observedAt: Timestamp): UsageReading[] {
    const record = asRecord(usage);
    const fields = [
      'input_tokens',
      'output_tokens',
      'cache_read_input_tokens',
      'cache_creation_input_tokens',
    ] as const;
    return fields.map((field) => ({
      provider: 'claude' as const,
      unit: 'tokens' as const,
      scope: 'turn' as const,
      value: numberOrNull(record[field]),
      source: `SDKResultMessage.usage.${field}`,
      observedAt,
    }));
  }

  private finishRun(
    state: SessionState,
    run: ClaudeRun,
    status: TerminalRunStatus,
    error?: AdapterError,
    rawProviderEvent: unknown = null,
    end?: RunEnd,
  ): void {
    if (run.terminalEmitted) {
      return;
    }
    run.terminalEmitted = true;
    if (state.activeRun === run) {
      state.activeRun = null;
    }
    run.status = status;
    // A finished run's message is the completed blocks, as the provider gave them.
    // A run that ended early (cancelled or error) also keeps the received deltas of
    // the block that was interrupted, so the text received is not lost; the
    // `run.finished` status that follows is what marks it as incomplete — the same
    // representation as the Cursor adapter, whose message on an early end is
    // likewise only what had arrived.
    const text = status === 'finished' ? run.assistantText : run.assistantText + run.pendingText;
    if (text !== '') {
      this.emit(state, {
        type: 'assistant.message',
        dspatchSessionId: state.dspatchSessionId,
        dspatchRunId: run.dspatchRunId,
        at: nowIso(),
        rawProviderEvent: null,
        text,
      });
    }
    this.emit(state, {
      type: 'run.finished',
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId: run.dspatchRunId,
      at: nowIso(),
      rawProviderEvent,
      status,
      ...(error === undefined ? {} : { error }),
      ...(end === undefined ? {} : { end }),
    });
  }

  // --- Cancellation internals (DSP-115) ------------------------------------------

  /**
   * The stop sequence after `cancel()`: interrupt once, then bounded waits and
   * escalation, ending in exactly one terminal event. Never throws on purpose;
   * returns quietly once `dispose` has abandoned it.
   */
  private async stopSequence(
    state: SessionState,
    run: ClaudeRun,
    handle: ClaudeQueryHandle,
  ): Promise<void> {
    const cancellation = run.cancellation;
    if (cancellation === null) {
      return;
    }
    this.requestInterrupt(run, cancellation, handle);
    const interruptFailed = (): boolean =>
      cancellation.interrupt.status === 'rejected' ||
      cancellation.interrupt.status === 'unavailable';

    // 1. The gentle path: the hook denies, interrupt() stops the turn.
    const first = await this.waitFor(
      run,
      () => confirmedEnd(run) !== null || interruptFailed(),
      CANCEL_INTERRUPT_WAIT_MS,
    );
    if (first === 'abandoned') {
      return;
    }
    const stopped = confirmedEnd(run);
    if (stopped !== null) {
      this.finishCancelled(state, run, 'stopped', stopped);
      return;
    }

    // 2. Escalate: the SDK's abort path (stdin EOF, grace, then the SDK's own kill).
    // Never before this point: an abort closes stdin, and the hook's answers and the
    // interrupt travel over it.
    cancellation.abortRequestedAt = nowIso();
    try {
      run.abortController.abort();
    } catch {
      // Recorded by the timeline; the kill below still follows if needed.
    }
    const afterAbort = await this.waitFor(
      run,
      () => confirmedEnd(run) !== null,
      CANCEL_ABORT_WAIT_MS,
    );
    if (afterAbort === 'abandoned') {
      return;
    }
    const aborted = confirmedEnd(run);
    if (aborted !== null) {
      this.finishCancelled(state, run, 'forced', aborted);
      return;
    }

    // 3. Kill the observed process if it has not exited, then a last bound.
    if (run.process !== null && run.process.exit === null) {
      cancellation.killRequestedAt = nowIso();
      try {
        cancellation.killSignalSent = run.process.child.kill('SIGKILL');
      } catch {
        cancellation.killSignalSent = false;
      }
    }
    const afterKill = await this.waitFor(
      run,
      () => confirmedEnd(run) !== null,
      CANCEL_KILL_WAIT_MS,
    );
    if (afterKill === 'abandoned') {
      return;
    }
    const killed = confirmedEnd(run);
    if (killed !== null) {
      this.finishCancelled(state, run, 'forced', killed);
      return;
    }
    this.finishCancelled(state, run, 'unconfirmed', {
      kind: 'none',
      streamEnded: run.streamEndedAt !== null,
      process: processObservation(run.process),
    });
  }

  /** Call `interrupt()` once without waiting for it; record how it settles. */
  private requestInterrupt(
    run: ClaudeRun,
    cancellation: CancellationState,
    handle: ClaudeQueryHandle,
  ): void {
    if (typeof handle.interrupt !== 'function') {
      cancellation.interrupt = { ...cancellation.interrupt, status: 'unavailable' };
      return;
    }
    const calledAtUtc = nowIso();
    cancellation.interrupt = { ...cancellation.interrupt, status: 'pending', calledAtUtc };
    let call: Promise<unknown>;
    try {
      call = Promise.resolve(handle.interrupt());
    } catch (error) {
      call = Promise.reject(error);
    }
    call.then(
      (receipt: unknown) => {
        cancellation.interrupt = {
          ...cancellation.interrupt,
          status: 'resolved',
          settledAtUtc: nowIso(),
          receipt: receipt ?? null,
        };
        this.wake(run);
      },
      (error: unknown) => {
        cancellation.interrupt = {
          ...cancellation.interrupt,
          status: 'rejected',
          settledAtUtc: nowIso(),
          error: errorText(error),
        };
        this.wake(run);
      },
    );
  }

  /**
   * Wait until `condition` holds, at most `ms`. Re-checked whenever the run's
   * stream ends, its process exits or its interrupt settles. The timer is always
   * cleared, including when `dispose` abandons the wait.
   */
  private waitFor(
    run: ClaudeRun,
    condition: () => boolean,
    ms: number,
  ): Promise<'met' | 'timeout' | 'abandoned'> {
    if (run.stopAbandoned) {
      return Promise.resolve('abandoned');
    }
    if (condition()) {
      return Promise.resolve('met');
    }
    return new Promise((resolve) => {
      let done = false;
      let timer: unknown = null;
      const finish = (outcome: 'met' | 'timeout' | 'abandoned'): void => {
        if (done) {
          return;
        }
        done = true;
        run.waiters.delete(check);
        if (timer !== null) {
          this.timers.clearTimeout(timer);
        }
        resolve(outcome);
      };
      const check = (): void => {
        if (run.stopAbandoned) {
          finish('abandoned');
        } else if (condition()) {
          finish('met');
        }
      };
      run.waiters.add(check);
      timer = this.timers.setTimeout(() => {
        finish('timeout');
      }, ms);
    });
  }

  private wake(run: ClaudeRun): void {
    for (const check of [...run.waiters]) {
      check();
    }
  }

  /** `dispose`: stop waiting, clear the timers, emit nothing more for this run. */
  private abandonStop(run: ClaudeRun): void {
    run.stopAbandoned = true;
    this.wake(run);
  }

  private finishCancelled(
    state: SessionState,
    run: ClaudeRun,
    end: RunEnd,
    evidence: EndEvidence,
  ): void {
    if (run.terminalEmitted || run.stopAbandoned) {
      return;
    }
    const cancellation = run.cancellation;
    if (cancellation !== null) {
      cancellation.end = end;
      cancellation.endAt = nowIso();
      cancellation.endEvidence = evidence;
    }
    if (end === 'unconfirmed') {
      state.unconfirmedRun = run;
    }
    this.finishRun(state, run, 'cancelled', undefined, cancellation?.resultMessage ?? null, end);
  }

  /** A run cancelled before `query()` started anything: there is nothing to stop. */
  private finishNotStarted(state: SessionState, run: ClaudeRun, error?: AdapterError): void {
    const evidence: EndEvidence = { kind: 'not-started', streamEnded: false, process: null };
    if (run.cancellation !== null) {
      run.cancellation.end = 'stopped';
      run.cancellation.endAt = nowIso();
      run.cancellation.endEvidence = evidence;
    }
    this.finishRun(state, run, 'cancelled', error, null, 'stopped');
  }

  /**
   * This run's PreToolUse callback. Records every call; passes (no decision, so
   * the normal permission rules apply) until `cancel()` has been called for the
   * run, then denies with `continue: false`. Texts: {@link CANCEL_DENY_REASON},
   * {@link CANCEL_STOP_REASON}.
   */
  private cancelHook(run: ClaudeRun): HookCallback {
    return (input, toolUseID) => {
      const fields = asRecord(input);
      const toolName = typeof fields['tool_name'] === 'string' ? fields['tool_name'] : 'unknown';
      const reported = fields['tool_use_id'];
      const toolUseId =
        typeof reported === 'string' && reported !== '' ? reported : (toolUseID ?? null);
      // A cancel request (`cancel()`), not `cancelRequested`: `dispose` sets that
      // flag too, but stops a run by abort and close rather than by the hook, and a
      // dispose is not a user's cancellation to report to the model.
      const deny = run.cancellation !== null;
      run.hookFirings.push({
        dspatchRunId: run.dspatchRunId,
        atUtc: nowIso(),
        toolName,
        toolUseId,
        decision: deny ? 'deny' : 'pass',
      });
      if (!deny) {
        return Promise.resolve({});
      }
      if (toolUseId !== null) {
        run.deniedToolUseIds.add(toolUseId);
      }
      const output: HookJSONOutput = {
        continue: false,
        stopReason: CANCEL_STOP_REASON,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: CANCEL_DENY_REASON,
        },
      };
      return Promise.resolve(output);
    };
  }

  /**
   * `Options.spawnClaudeCodeProcess`: start the process exactly as the SDK's own
   * local spawn does (the command, arguments, working directory, environment and
   * forwarded abort signal the SDK passes, piped stdio, hidden window: sdk.mjs
   * 0.3.306 `spawnLocalProcess`), and observe its `exit`. Nothing is added to the
   * environment, and it is checked once more against the authentication guard,
   * since a credential reaching it here would bypass that guard.
   *
   * Documented differences from the SDK's own spawn (sdk.d.ts 0.3.306):
   * - :9782-9785: the built-in spawn delivers `exit` only after stderr has closed,
   *   "so exit consumers see a complete stderr tail in exit errors"; a custom spawn
   *   emits plain process exit, and the SDK keeps no stderr tail for it. So this
   *   wrapper keeps its own: the last {@link STDERR_TAIL_BYTES} bytes, recorded
   *   with the process observation and appended, labelled as raw CLI output, to
   *   the adapter error when the stream throws.
   * - :2477: "The default behavior checks if the executable exists before
   *   spawning"; a custom spawn does not. A missing executable shows as Node's
   *   `error` event (ENOENT) without a pid, recorded as `spawnError` and ending a
   *   cancelled run with evidence `spawn-failed`.
   * Read in the SDK's code (not contract): with a custom spawn the SDK does not add
   * its automatic `--debug-file` argument, which it adds only when its own debug
   * logging is configured.
   */
  private spawnObserved(run: ClaudeRun, options: ClaudeSpawnOptions): SpawnedProcess {
    const leaked = guardedNames(options.env, this.caseInsensitive);
    const allowedKey =
      this.assessment.authorization?.kind === 'api-key'
        ? (name: string): boolean => isDirectApiKey(name, this.caseInsensitive)
        : (): boolean => false;
    const refused = [...leaked.api.filter((name) => !allowedKey(name)), ...leaked.token];
    if (refused.length > 0) {
      throw new ClaudeAdapterError(
        `The Claude Code process was not started: its environment held ${refused.join(', ')}, ` +
          "which DSpatch's authentication guard had removed.",
      );
    }
    const child = this.spawnProcess(options.command, options.args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: options.env,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const observed: ObservedProcess = {
      child,
      pid: typeof child.pid === 'number' ? child.pid : null,
      spawnedAt: nowIso(),
      exit: null,
      stderr: Buffer.alloc(0),
      stderrTruncated: false,
    };
    run.process = observed;
    // Read (so the pipe never fills) and keep only the last bytes: raw CLI output.
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      const joined = Buffer.concat([observed.stderr, bytes]);
      if (joined.length > STDERR_TAIL_BYTES) {
        observed.stderr = Buffer.from(joined.subarray(joined.length - STDERR_TAIL_BYTES));
        observed.stderrTruncated = true;
      } else {
        observed.stderr = joined;
      }
    });
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (observed.exit === null) {
        observed.exit = { at: nowIso(), code, signal, spawnError: null };
      }
      this.wake(run);
    });
    child.on('error', (error: Error) => {
      // A process that never started has nothing left to stop.
      if (child.pid === undefined && observed.exit === null) {
        observed.exit = { at: nowIso(), code: null, signal: null, spawnError: errorText(error) };
        this.wake(run);
      }
    });
    if (child.stdin === null || child.stdout === null) {
      child.kill('SIGKILL');
      throw new ClaudeAdapterError(
        'The Claude Code process was started without piped stdin and stdout, so it was stopped again.',
      );
    }
    return child as unknown as SpawnedProcess;
  }

  private emitCancelRequested(
    state: SessionState,
    run: ClaudeRun,
    cancellation: CancellationState,
  ): void {
    cancellation.requestEmitted = true;
    this.emit(state, {
      type: 'run.cancel_requested',
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId: run.dspatchRunId,
      at: nowIso(),
      rawProviderEvent: null,
    });
  }

  /** True if `promise` settles within `ms`, on this instance's timers. */
  private async settlesWithinBound(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: unknown = null;
    try {
      return await Promise.race([
        promise.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => {
          timer = this.timers.setTimeout(() => {
            resolve(false);
          }, ms);
        }),
      ]);
    } finally {
      if (timer !== null) {
        this.timers.clearTimeout(timer);
      }
    }
  }

  /** A run's provider-message event, unless its terminal event is already out. */
  private emitForRun(state: SessionState, run: ClaudeRun, event: AgentEvent): void {
    if (run.terminalEmitted) {
      return;
    }
    this.emit(state, event);
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new ClaudeAdapterError('This adapter instance has been disposed. Create a new one.');
    }
  }

  private requireSession(sessionId: DspatchSessionId): SessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      throw new ClaudeAdapterError(`Unknown session "${sessionId}". Start it first.`);
    }
    return state;
  }

  private emit(state: SessionState, event: AgentEvent): void {
    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch {
        // A listener must not throw; one bad subscriber must not break the stream.
      }
    }
  }
}

/** The session title passed to the provider: the DSpatch session id, so the transcript names it. */
function sessionTitleFor(state: SessionState): string {
  return state.dspatchSessionId;
}

/**
 * One run's account observation, read once through the SDK's documented
 * `Query.accountInfo()`. Chosen over `initializationResult()` because it returns
 * only `AccountInfo`, not commands, models and agents nothing here uses. Never
 * rejects: a missing method, a failure or no answer within
 * {@link ACCOUNT_INFO_WAIT_MS} is an `unavailable` observation. Only the
 * {@link ACCOUNT_INFO_FIELDS} are kept.
 */
function readAccount(
  dspatchRunId: DspatchRunId,
  handle: ClaudeQueryHandle,
): Promise<AccountObservation> {
  const unavailable = (reason: string): AccountObservation => ({
    dspatchRunId,
    status: 'unavailable',
    reason,
  });
  if (typeof handle.accountInfo !== 'function') {
    return Promise.resolve(unavailable('the query handle offers no accountInfo()'));
  }
  let call: Promise<unknown>;
  try {
    call = Promise.resolve(handle.accountInfo());
  } catch (error) {
    call = Promise.reject(error);
  }
  const read = call.then(
    (info): AccountObservation => ({ dspatchRunId, status: 'observed', fields: accountFields(info) }),
    (error: unknown) =>
      unavailable(
        `accountInfo() failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
      ),
  );
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<AccountObservation>((resolve) => {
    timer = setTimeout(() => {
      resolve(
        unavailable(`accountInfo() did not answer within ${String(ACCOUNT_INFO_WAIT_MS)} ms`),
      );
    }, ACCOUNT_INFO_WAIT_MS);
    timer.unref();
  });
  return Promise.race([read, timeout]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}

/** True if `promise` settles within `ms`. The timer never outlives the answer. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
