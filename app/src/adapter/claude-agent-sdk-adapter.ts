import { createHash, randomUUID } from 'node:crypto';

import type {
  Options as ClaudeQueryOptions,
  SDKMessage,
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
 * - `settingSources: []` loads no user, project or local settings file. Managed
 *   (policy) settings are not controlled by this option.
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
}

/** The DSP-109 fixture configuration. Recorded in every run record. */
export const FIXTURE_PERMISSIONS: ClaudePermissionPolicy = Object.freeze({
  tools: Object.freeze(['Read', 'Glob', 'Grep', 'Edit']),
  allowedTools: Object.freeze(['Read(/**)', 'Edit(/src/**)']),
  permissionMode: 'dontAsk',
  settingSources: Object.freeze([]) as readonly [],
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
}

/** The SDK's `query()`, or a substitute with the same shape. */
export type ClaudeQueryFunction = (params: {
  readonly prompt: string;
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
  readonly initMessages: unknown[];
  readonly resultMessages: unknown[];
  readonly observedSessionIds: string[];
  /**
   * Every run whose stream has not ended yet, including one waiting for the
   * previous turn. `dispose` stops all of them, not only `lastRun`.
   */
  readonly outstanding: Set<ClaudeRun>;
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

  private disposed = false;

  constructor(options: ClaudeAgentSdkAdapterOptions = {}) {
    this.substitutedQuery = options.queryFn ?? null;
    this.permissions = options.permissions ?? FIXTURE_PERMISSIONS;
    // Checked at run time too: a JavaScript caller or a cast can pass anything.
    if ((this.permissions.permissionMode as string) !== 'dontAsk') {
      throw new ClaudeAdapterError(
        `Permission mode "${String(this.permissions.permissionMode)}" is not used by ` +
          "DSpatch's Claude adapter. Only 'dontAsk' is: nothing here can answer a " +
          'permission prompt.',
      );
    }
    const env = { ...(options.env ?? process.env) };
    const matching =
      options.caseInsensitiveEnv === undefined
        ? undefined
        : { caseInsensitive: options.caseInsensitiveEnv };
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
      initMessages: [],
      resultMessages: [],
      observedSessionIds: [],
      outstanding: new Set(),
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
    };
    const previous = state.lastRun;
    state.activeRun = run;
    state.lastRun = run;
    state.outstanding.add(run);

    if (previous?.pump != null && !previous.streamPumpFinished) {
      const ended = await settlesWithin(previous.pump, PREVIOUS_TURN_EXIT_MS);
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
        state.activeRun = null;
        state.lastRun = previous;
        state.outstanding.delete(run);
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

    try {
      const queryFn = await this.queryFunction();
      if (run.cancelRequested || this.disposed) {
        // Cancelled (or disposed) while waiting for the previous turn or for the
        // SDK to load: the provider is never started, rather than started aborted.
        this.finishRun(state, run, 'cancelled');
        this.markPumpFinished(state, run);
        return { dspatchRunId: run.dspatchRunId };
      }
      run.handle = queryFn({ prompt, options: this.optionsFor(state, run) });
    } catch (error) {
      const adapterError = toAdapterError('send', error);
      this.finishRun(state, run, run.cancelRequested ? 'cancelled' : 'error', {
        message: adapterError.message,
        ...(adapterError.providerCode === undefined
          ? {}
          : { providerCode: adapterError.providerCode }),
      });
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
   * Cancel through the turn's `AbortController`. Resolves once the abort is
   * requested; the terminal `run.finished` with status `cancelled` follows when
   * the stream ends. Whether the remote model call stops is not claimed.
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
    run.abortController.abort();
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
   * Idempotent and never throws.
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

  /** The `system`/`init` messages seen, unchanged. */
  initMessages(sessionId: DspatchSessionId): readonly unknown[] {
    return [...this.requireSession(sessionId).initMessages];
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

  hasActiveRun(sessionId: DspatchSessionId): boolean {
    return this.sessions.get(sessionId)?.activeRun != null;
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
      includePartialMessages: true,
      abortController: run.abortController,
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
      if (!run.terminalEmitted) {
        if (run.cancelRequested) {
          this.finishRun(state, run, 'cancelled');
        } else if (failure !== null) {
          const adapterError = toAdapterError('query', failure);
          this.finishRun(state, run, 'error', {
            message: adapterError.message,
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
          state.initMessages.push(message);
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
          this.emit(state, { ...base, type: 'assistant.delta', text: delta['text'] });
        } else if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
          this.emit(state, { ...base, type: 'reasoning.delta', text: delta['thinking'] });
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
            this.emit(state, { ...base, type: 'tool.started', toolCallId: block['id'], name });
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
            this.emit(state, {
              ...base,
              type: 'tool.finished',
              toolCallId: block['tool_use_id'],
              name: state.toolNames.get(block['tool_use_id']) ?? 'unknown',
              status: block['is_error'] === true ? 'error' : 'ok',
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
        this.emit(state, { ...base, type: 'usage', readings });

        if (run.cancelRequested) {
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
    });
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
