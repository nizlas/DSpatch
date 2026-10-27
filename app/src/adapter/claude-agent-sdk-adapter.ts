import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  HookCallback,
  HookJSONOutput,
  Options as ClaudeQueryOptions,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SpawnedProcess,
  SpawnOptions as ClaudeSpawnOptions,
} from './claude-sdk-shapes';
import { ClaudeAdapterError, loadClaudeSdk, loadClaudeToolKit, type ClaudeToolKit } from './claude-support';

import type { AgentAdapter } from './agent-adapter';
import type {
  AdapterError,
  AgentCommandRecord,
  AppTool,
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
// Defined beside the SDK loader (DSP-133), which raises it too; re-exported here.
export { ClaudeAdapterError };

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
  /**
   * DSP-132: tools removed from the model's context even if they would otherwise be
   * allowed (sdk.d.ts 0.3.306 `Options.disallowedTools`); `mcp__*` removes every MCP
   * tool (documented for agent definitions; `strictMcpConfig` already passes none).
   * Omitted, never `undefined`, where unused, so a policy without it keeps its digest.
   */
  readonly disallowedTools?: readonly string[];
  /**
   * DSP-132: a second PreToolUse hook, with no matcher, that denies **every** tool
   * call on every turn with {@link REVIEW_DENY_REASON}, independent of cancellation.
   * It does not set `continue: false`: the turn goes on, so the model can still answer
   * in text. Hooks run before allow rules and the permission mode (hooks and
   * permissions documentation), so this holds whatever else is configured. Omitted
   * where unused.
   */
  readonly denyEveryTool?: true;
}

// --- Claude's own shell tools (DSP-146) ---------------------------------------------

/**
 * The SDK's built-in shell tools: `Bash`, and on Windows `PowerShell`, which Claude Code
 * uses when Git Bash is missing and offers beside Bash otherwise (tools reference, read
 * 27 Oct 2026; both names in `BUILTIN_TOOL_NAMES`, sdk.d.ts 0.3.306). The agent runs its
 * builds and tests with these, under the session's permission policy: the runtime owns
 * its model-tool loop and DSpatch does not start the process (INTERACTION_MODEL.md
 * sections 1, 5 and 8; RUNTIME_PLATFORM_ROADMAP.md section 1.2). DSpatch observes each
 * command through the SDK's hooks and records it as provider-reported.
 */
export const SHELL_TOOLS: readonly string[] = Object.freeze(['Bash', 'PowerShell']);

/**
 * Set in every Claude Code process this adapter starts (DSP-146). Claude Code's
 * documented switch (env-vars and tools reference, read 27 Oct 2026): it removes
 * `run_in_background` from the shell tools and stops a command that reaches its timeout
 * instead of moving it to the background. So every command the agent runs ends inside
 * its turn, where DSpatch's hooks record it and a cancellation reaches it. Claude Code's
 * own timeout applies to each command: two minutes unless the agent asks for more, at
 * most ten.
 */
export const FOREGROUND_ONLY_ENV: Readonly<Record<string, string>> = Object.freeze({
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
});

/** What Session details and the loop's tool text say about the shell tools. */
export const SHELL_TOOLS_NOTE =
  "shell commands through Claude Code's own Bash and PowerShell tools, in the " +
  'foreground only (CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1) under Claude Code\'s own ' +
  'per-command timeout; DSpatch records each one through the SDK\'s hooks and does not ' +
  'start or sandbox it';

/**
 * Why the review discussion's deny-all hook refused a tool (DSP-132). Sent to the
 * model as the deny reason; visible in the discussion's Context and in run records.
 */
export const REVIEW_DENY_REASON =
  "DSpatch's review discussion is text-only: no tool may be used here, and this " +
  'call was not run. Answer in text from the code and context in the message.';

/** The DSP-109 fixture configuration. Recorded in every run record. */
export const FIXTURE_PERMISSIONS: ClaudePermissionPolicy = Object.freeze({
  tools: Object.freeze(['Read', 'Glob', 'Grep', 'Edit']),
  allowedTools: Object.freeze(['Read(/**)', 'Edit(/src/**)']),
  permissionMode: 'dontAsk',
  settingSources: Object.freeze([]) as readonly [],
  strictMcpConfig: true,
}) as ClaudePermissionPolicy;

/**
 * The main chat's policy (DSP-117, DSP-146), also used by loop steps: read and edit the
 * working copy, and run builds and tests with Claude Code's own shell tools
 * ({@link SHELL_TOOLS}), pre-approved so a routine test needs no new confirmation
 * (INTERACTION_MODEL.md section 6). A bare `Bash` rule pre-approves every command: this
 * is the user's own approval rule for ordinary agent work, not a filter, and no command
 * filter is a security boundary. Commands run in the foreground only
 * ({@link FOREGROUND_ONLY_ENV}) and are recorded through the SDK's hooks. No web tools,
 * no MCP servers (`strictMcpConfig`), no settings from disk (`settingSources: []`), and
 * `dontAsk`, so anything outside `allowedTools` is refused rather than prompted for.
 *
 * Documented by Anthropic, not observed here: that an `Edit(...)` rule also
 * covers `Write`, and that a `Read(...)` rule also covers `Glob` and `Grep`. If a
 * live run shows otherwise, the agent is refused those tools, which fails closed.
 * `/**` is relative to the session's working directory (the project), not the
 * file system root. Not containment either (see above).
 */
export const CHAT_PERMISSIONS: ClaudePermissionPolicy = Object.freeze({
  tools: Object.freeze(['Read', 'Glob', 'Grep', 'Edit', 'Write', ...SHELL_TOOLS]),
  allowedTools: Object.freeze(['Read(/**)', 'Edit(/**)', ...SHELL_TOOLS]),
  permissionMode: 'dontAsk',
  settingSources: Object.freeze([]) as readonly [],
  strictMcpConfig: true,
}) as ClaudePermissionPolicy;

/**
 * The review discussion's policy (DSP-132): no tools at all, by four controls that do
 * not depend on the prompt. `tools: []` makes no built-in tool available;
 * `allowedTools: []` pre-approves nothing; `disallowedTools` removes the tools that
 * could change code, run commands, reach the web, start agents or use MCP even if
 * something made them available; and the deny-all hook refuses any tool call that
 * still happens, without ending the turn. `dontAsk`, no settings from disk and no MCP
 * servers, as for the chat. The session runs in an empty folder DSpatch owns.
 *
 * Names checked against `BUILTIN_TOOL_NAMES` in the SDK's sdk.d.ts 0.3.306 (read from
 * a scratch install): `Agent` is the sub-agent tool there (no tool is named `Task`),
 * and `PowerShell` is the Windows shell beside `Bash`. Configured and checked offline
 * with a substituted SDK; what a live session's init `tools` and `mcp_servers` show is
 * the home probe's to observe (DSP-132 AC#1).
 */
export const REVIEW_PERMISSIONS: ClaudePermissionPolicy = Object.freeze({
  tools: Object.freeze([]) as readonly string[],
  allowedTools: Object.freeze([]) as readonly string[],
  disallowedTools: Object.freeze([
    'Bash',
    'PowerShell',
    'Edit',
    'Write',
    'NotebookEdit',
    'Agent',
    'WebFetch',
    'WebSearch',
    'Skill',
    'mcp__*',
  ]),
  permissionMode: 'dontAsk',
  settingSources: Object.freeze([]) as readonly [],
  strictMcpConfig: true,
  denyEveryTool: true,
}) as ClaudePermissionPolicy;

/** A permission policy as one line a person can read, for Session details and review Context. */
export function describePermissionPolicy(policy: ClaudePermissionPolicy): string {
  const tools = policy.tools.length === 0 ? 'no tools' : `tools ${policy.tools.join(', ')}`;
  const allowed =
    policy.allowedTools.length === 0 ? 'nothing pre-approved' : `allowed ${policy.allowedTools.join(', ')}`;
  const disallowed =
    policy.disallowedTools === undefined || policy.disallowedTools.length === 0
      ? ''
      : `; disallowed ${policy.disallowedTools.join(', ')}`;
  const denyAll = policy.denyEveryTool === true ? '; every tool call denied by a hook (the turn continues)' : '';
  const servers = policy.strictMcpConfig ? 'no MCP servers' : 'MCP servers from configuration';
  const shells =
    policy.denyEveryTool !== true && policy.tools.some((tool) => SHELL_TOOLS.includes(tool))
      ? `; ${SHELL_TOOLS_NOTE}`
      : '';
  return (
    `${tools}; ${allowed}${disallowed}; ` +
    `permission mode ${policy.permissionMode}; no settings read from disk other than ` +
    `managed policy settings; ${servers}${shells}${denyAll}`
  );
}

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
  /**
   * DSP-149: the SDK's `Query.supportedModels()`, the models the account can use.
   * Optional so a substitute may leave it out.
   */
  supportedModels?(): Promise<readonly ClaudeModelInfo[]>;
}

/** The fields of the SDK's `ModelInfo` DSpatch reads (sdk.d.ts 0.3.306). */
export interface ClaudeModelInfo {
  readonly value: string;
  readonly displayName: string;
  readonly description?: string;
  readonly resolvedModel?: string;
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
  /** `pass` leaves the decision to the normal permission rules; `deny` refuses the call. */
  readonly decision: 'pass' | 'deny';
  /** Which hook: the cancellation hook (absent, as before) or DSP-132's deny-all hook. */
  readonly hook?: 'deny-every-tool';
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

/** The SDK's `query()`, from Claude support (DSP-133). Refuses plainly when it is not installed. */
async function loadSdkQuery(): Promise<ClaudeQueryFunction> {
  const sdk = await loadClaudeSdk();
  return sdk.query as ClaudeQueryFunction;
}

/**
 * A local lookup of a provider session record (DSP-122): the SDK's documented
 * `getSessionInfo(uuid, { dir })`, or a substitute with the same shape. It reads
 * the session's transcript file in this process, under this process's Claude
 * profile; it never asks the provider anything. `undefined` is the SDK's answer
 * for a file not found, a sidechain session, or a session with no extractable
 * summary (sdk.d.ts 0.3.306 :880-889), so `undefined` means "no readable
 * record", never "the provider does not have it".
 *
 * `dir` is the project path the SDK encodes into its per-project directory
 * (`listSessions({ dir })` semantics). That encoding, and whether a title-only
 * session gets a summary, are documentation until the offline check of plan 4.5.
 */
export type ClaudeLocalLookup = (
  uuid: string,
  dir: string,
) => Promise<SDKSessionInfo | undefined>;

async function loadSdkLocalLookup(): Promise<ClaudeLocalLookup> {
  const sdk = await loadClaudeSdk();
  return (uuid, dir) => sdk.getSessionInfo(uuid, { dir });
}

export interface ClaudeAgentSdkAdapterOptions {
  /**
   * Substitute for the SDK's `query()`. When given, the SDK is never loaded.
   * Tests use this; nothing in the product should.
   */
  readonly queryFn?: ClaudeQueryFunction;
  /**
   * Substitute for the SDK's `getSessionInfo` in `resume()`. Tests and the R-A0
   * probe use this; the product loads the SDK's own through the lazy loader.
   */
  readonly localLookup?: ClaudeLocalLookup;
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
  /**
   * DSP-149: substitute for loading the SDK's `createSdkMcpServer`, `tool` and zod from
   * Claude support. Tests only; the product loads the installed SDK's own.
   */
  readonly toolKit?: () => Promise<ClaudeToolKit>;
}

// --- Capabilities --------------------------------------------------------------

/**
 * What this instance offers: Claude **plus the Agent SDK transport**.
 *
 * - `resume` is `unknown`: implemented; no live evidence (DSP-122). `resume()`
 *   registers a session from a local record and the first send passes `resume`;
 *   whether the provider then continues the session has not been observed
 *   through this path, and only the prepared live probes can show it.
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
  resume: 'unknown', // implemented; no live evidence (DSP-122)
  modelSelection: 'supported',
  approvals: 'unsupported',
  usageReporting: 'unknown',
};

/** How long `send` waits for the previous turn's process to finish its stream. */
export const PREVIOUS_TURN_EXIT_MS = 15_000;

/**
 * The longest time from `cancel()` resolving to the run's end, guaranteed by this
 * adapter's own timers (DSP-116), declared as {@link ClaudeAgentSdkAdapter.cancelEndBoundMs}.
 * The maximum of the two paths a cancel can take, derived rather than restated:
 *
 * - A run that has a query handle: the stop sequence's three bounded waits
 *   ({@link CANCEL_INTERRUPT_WAIT_MS} + {@link CANCEL_ABORT_WAIT_MS} +
 *   {@link CANCEL_KILL_WAIT_MS}), then its one terminal `run.finished`.
 * - A turn still waiting in `send` for the previous one: that wait started before
 *   the cancel and is bounded by {@link PREVIOUS_TURN_EXIT_MS}; then the turn ends
 *   as not started (`run.finished`), or, if the previous turn is still open, `send`
 *   rejects and no event of the turn is emitted.
 *
 * Not covered by a timer: the one-time load of the SDK module on an instance's
 * first turn (a cancel arriving during it ends the turn as not started once the
 * module has loaded). Later turns and a substituted `query()` do not load it.
 */
export const CANCEL_END_BOUND_MS = Math.max(
  CANCEL_INTERRUPT_WAIT_MS + CANCEL_ABORT_WAIT_MS + CANCEL_KILL_WAIT_MS,
  PREVIOUS_TURN_EXIT_MS,
);

/**
 * How long `dispose` waits, after aborting and closing every open query, for the
 * stream pumps to end and every observed Claude Code process to exit before it
 * kills the processes still running. The same 5 s the pump wait always had.
 */
export const DISPOSE_EXIT_WAIT_MS = 5_000;

/**
 * The longest `dispose` takes: {@link DISPOSE_EXIT_WAIT_MS}, then, after the kill,
 * {@link CANCEL_KILL_WAIT_MS} for the exit (the stop sequence's own after-kill
 * bound, reused). 7 s, below the 8 s main.ts allows the chat service's dispose.
 */
export const DISPOSE_BOUND_MS = DISPOSE_EXIT_WAIT_MS + CANCEL_KILL_WAIT_MS;

/**
 * What `dispose` did about one run's local Claude Code process (DSP-116). Kept for
 * every run whose query handle existed and whose process had not been seen to exit
 * when `dispose` began; readable through {@link ClaudeAgentSdkAdapter.disposals}
 * once `dispose` has resolved. Nothing of it is emitted to listeners.
 */
export interface DisposalRecord {
  readonly dspatchSessionId: DspatchSessionId;
  readonly dspatchRunId: DspatchRunId;
  /** `false` when no process was ever observed for the run: nothing could be waited for or killed. */
  readonly processObserved: boolean;
  readonly pid: number | null;
  /**
   * Who sent `kill('SIGKILL')`: `dispose` itself, the run's stop sequence before
   * `dispose` began (then `dispose` sends no second one), or nobody.
   */
  readonly killedBy: 'dispose' | 'stop-sequence' | null;
  /** When `dispose` sent its kill, or `null` if it sent none. */
  readonly disposeKillRequestedAtUtc: Timestamp | null;
  /** What `dispose`'s `kill('SIGKILL')` returned, or `null` if it sent none. */
  readonly disposeKillSignalSent: boolean | null;
  readonly exitedAtUtc: Timestamp | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  /**
   * - `exited`: the process was seen to exit without being killed.
   * - `killed-and-exited`: it was seen to exit after a kill (see `killedBy`).
   * - `unconfirmed`: no exit was seen within the bounds, or no process was observed.
   */
  readonly outcome: 'exited' | 'killed-and-exited' | 'unconfirmed';
  readonly bounds: { readonly exitWaitMs: number; readonly afterKillMs: number };
  /** The local process having exited says nothing about requests already sent. */
  readonly providerWorkAfterEnd: 'unknown';
}

// --- Resume in a new adapter instance (DSP-122) ---------------------------------

/**
 * Where the local lookup looked, against where the provider process looks.
 *
 * The lookup runs in this process, so it reads the profile this process's
 * `CLAUDE_CONFIG_DIR` names (unset: the default profile). The provider process
 * gets the adapter's subprocess environment instead. When the two differ, a
 * missing record says nothing about the profile the provider would read.
 */
export interface LookupEnvironment {
  /** `process.env.CLAUDE_CONFIG_DIR`, or `null` when unset. */
  readonly hostConfigDir: string | null;
  /** The same variable as the subprocess environment carries it, or `null`. */
  readonly childConfigDir: string | null;
  /** Equal, both `null` included. */
  readonly aligned: boolean;
}

/** What the local lookup found for a resumed session. Local evidence only. */
export interface ResumeLocalLookup {
  readonly found: true;
  /** The record's own working directory, or `null` when the record carries none. */
  readonly cwd: string | null;
  readonly lastModified: number;
  readonly summary: string;
  /** The `dir` the lookup was asked for: the session's `workspacePath`. */
  readonly dir: string;
  /** Same as {@link LookupEnvironment.hostConfigDir}: the profile the lookup read. */
  readonly configDir: string | null;
  readonly aligned: boolean;
}

/**
 * How the first turn after a resume failed, as far as this adapter can tell.
 *
 * - `provider-missing`: the error matched a recognised "session not found" form
 *   ({@link PROVIDER_MISSING_FORMS}).
 * - `unknown`: an SDK or stream error without a recognised form; it does not say
 *   whether the session was missing or the resume failed for another reason.
 * - `error`: `query()` itself threw, so no stream was ever read.
 */
export type FirstTurnFailure = 'provider-missing' | 'unknown' | 'error';

/**
 * What the first turn after a resume reported. Recorded from the provider's
 * `init` and the run's terminal, and from nothing else.
 *
 * A matching ID is a consistency check; recall is the evidence. DSpatch chose
 * the UUID it passes as `resume`, so the provider reporting the same one in
 * `init` shows only that the two agree on the name of the session, not that
 * the earlier turns are in it. Until the R-A0 probe shows how the CLI answers a
 * UUID it does not hold, nothing here may present `idMatches` as confirmed.
 */
export interface ResumeFirstTurn {
  readonly dspatchRunId: DspatchRunId;
  /** The `session_id` of the first `init`, or `null` when none arrived. */
  readonly initSessionId: string | null;
  /** `initSessionId === providerSessionId`; `null` when no init arrived. */
  readonly idMatches: boolean | null;
  readonly terminalStatus: TerminalRunStatus | null;
  readonly failure: FirstTurnFailure | null;
}

/** The record `resume()` leaves and the first turn completes. */
export interface ResumptionRecord {
  readonly localLookup: ResumeLocalLookup;
  readonly lookupEnvironment: LookupEnvironment;
  readonly firstTurn: ResumeFirstTurn | null;
}

/**
 * Error-message forms that identify the provider's "session not found" answer
 * to a `resume` it cannot honour. **Empty on purpose:** filled from the R-A0
 * probe's observed refusal form, not guessed. Until then nothing matches and a
 * failed first turn is classified `unknown`.
 */
export const PROVIDER_MISSING_FORMS: readonly RegExp[] = [];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface ResumptionState {
  readonly localLookup: ResumeLocalLookup;
  readonly lookupEnvironment: LookupEnvironment;
  firstTurn: Mutable<ResumeFirstTurn> | null;
}

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
  /** True when `query()` itself threw: no stream was ever read for this run. */
  startFailed: boolean;
  /**
   * DSP-146: shell commands whose start this run's PreToolUse hook saw and whose end is
   * not yet recorded, by tool-use id (or a generated key when the SDK gave none).
   */
  readonly openCommands: Map<string, OpenShellCommand>;
  /** Every command record this run produced, in order. */
  readonly commands: AgentCommandRecord[];
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
  /** Replaced, never edited, when the workspace's folders change (DSP-149). */
  config: SessionConfig;
  /** DSP-149: the in-process server for the session's app tools, built on its first send. */
  toolServer: unknown;
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
  /** Set by `resume()` only; `null` for a session this instance started. */
  resumption: ResumptionState | null;
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
 * Every folder of the session, the primary (`cwd`) first, duplicates dropped by the
 * host's case rule. DSP-149 lifted DSP-109's one-folder limit: the other folders reach
 * Claude Code as `additionalDirectories` (passed on as `--add-dir`), which the
 * documentation says makes them working directories whose files are read without a
 * prompt and edited under the permission mode, and {@link rootRules} extends the
 * policy's own allow rules to them. The primary stays the working directory and the
 * resume key.
 */
export function sessionRoots(config: SessionConfig): readonly string[] {
  const roots: string[] = [];
  for (const folder of [config.workspacePath, ...(config.workspacePaths ?? [])]) {
    if (folder !== '' && !roots.some((kept) => foldFolder(kept) === foldFolder(folder))) {
      roots.push(folder);
    }
  }
  if (roots.length === 0 || config.workspacePath === '') {
    throw new ClaudeAdapterError('This session names no working folder.');
  }
  return roots;
}

/**
 * A folder as Claude Code's permission rules spell an absolute path: `//` and the
 * POSIX form, which on Windows is `/c/Users/...` for `C:\Users\...` (permissions
 * documentation, read 27 Oct 2026: "On Windows, paths are normalized to POSIX form
 * before matching").
 */
export function absoluteRulePath(folder: string): string {
  const drive = /^([A-Za-z]):[\\/]*(.*)$/.exec(folder);
  const posix =
    drive === null
      ? folder.replace(/\\/g, '/')
      : `/${(drive[1] ?? '').toLowerCase()}/${(drive[2] ?? '').replace(/\\/g, '/')}`;
  return `/${posix.replace(/\/+$/, '')}`;
}

/**
 * The policy's folder-anchored allow rules, repeated for each other folder (DSP-149).
 *
 * A single-slash rule such as `Edit(/**)` is anchored at the primary working directory,
 * so on its own it pre-approves nothing in an added folder, and under `dontAsk` an edit
 * there would be refused. Each such rule is restated with the folder's absolute path,
 * so every folder of the workspace is worked in under the same rules as the first —
 * nothing more is allowed there than in the primary. Rules that are not anchored at
 * the working directory (`Bash`, an absolute `//` rule) are not repeated.
 */
export function rootRules(policy: ClaudePermissionPolicy, otherRoots: readonly string[]): readonly string[] {
  const rules: string[] = [];
  for (const rule of policy.allowedTools) {
    const anchored = /^([A-Za-z]+)\(\/(?!\/)(.*)\)$/.exec(rule);
    if (anchored === null) {
      continue;
    }
    for (const root of otherRoots) {
      rules.push(`${anchored[1] ?? ''}(${absoluteRulePath(root)}/${anchored[2] ?? ''})`);
    }
  }
  return rules;
}

/** The server name DSpatch's app tools are offered under; tools read `mcp__dspatch__<name>`. */
export const APP_TOOL_SERVER = 'dspatch';

/** The name the model sees for one app tool under Claude's MCP naming. */
export function claudeAppToolName(tool: Pick<AppTool, 'name'>): string {
  return `mcp__${APP_TOOL_SERVER}__${tool.name}`;
}

/**
 * The SDK's in-process MCP server for a session's app tools (DSP-149): `tool()` per app
 * tool, its parameters as the SDK's zod shape, its result as MCP text content.
 */
export function buildAppToolServer(kit: ClaudeToolKit, tools: readonly AppTool[]): unknown {
  const definitions = tools.map((appTool) => {
    const shape: Record<string, unknown> = {};
    for (const [key, parameter] of Object.entries(appTool.parameters)) {
      let schema = parameter.type === 'string' ? kit.z.string() : kit.z.array(kit.z.string());
      schema = schema.describe(parameter.description);
      shape[key] = parameter.optional === true ? schema.optional() : schema;
    }
    return kit.tool(
      appTool.name,
      appTool.description,
      shape,
      async (args: unknown) => {
        const result = await appTool.execute(asRecord(args));
        return { content: [{ type: 'text', text: result.text }], isError: result.isError };
      },
      { annotations: { readOnlyHint: appTool.readOnly } },
    );
  });
  return kit.createSdkMcpServer({ name: APP_TOOL_SERVER, version: '1.0.0', tools: definitions });
}

/** Windows paths differ in case without differing; elsewhere they do not. */
function foldFolder(folder: string): string {
  return process.platform === 'win32' ? folder.toLowerCase() : folder;
}

/**
 * JSON with object keys sorted at every level, so two equal policies written in
 * a different key order digest the same. Array order is kept: a policy whose
 * tool list is reordered is a different policy.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export class ClaudeAgentSdkAdapter implements AgentAdapter {
  /** Provider plus transport. Not "Claude Code". */
  readonly id = 'claude-agent-sdk';

  /** See {@link AgentAdapter.cancelEndBoundMs} and {@link CANCEL_END_BOUND_MS}. */
  readonly cancelEndBoundMs = CANCEL_END_BOUND_MS;

  /**
   * Every turn runs in a local Claude Code process this adapter starts. Read by the
   * chat's attempt ledger (DSP-117), which says so while a turn runs.
   */
  readonly runsLocalProcess = true;

  private readonly substitutedQuery: ClaudeQueryFunction | null;

  private loadedQuery: ClaudeQueryFunction | null = null;

  private readonly toolKitLoader: () => Promise<ClaudeToolKit>;

  private readonly substitutedLookup: ClaudeLocalLookup | null;

  private loadedLookup: ClaudeLocalLookup | null = null;

  private readonly permissions: ClaudePermissionPolicy;

  private readonly assessment: AuthenticationAssessment;

  private readonly subprocessEnv: Record<string, string | undefined>;

  private readonly sessions = new Map<DspatchSessionId, SessionState>();

  private readonly spawnProcess: ClaudeProcessSpawner;

  private readonly timers: CancelTimers;

  private readonly caseInsensitive: boolean;

  private disposed = false;

  /** The one `dispose` in progress or done, so a repeated call waits for the same one. */
  private disposing: Promise<void> | null = null;

  /** Resolves when `dispose` begins: ends a turn's wait for the previous one at once. */
  private readonly disposeBegun: Promise<void>;

  private signalDisposeBegun: () => void = () => undefined;

  /** What `dispose` did about each run's process. See {@link DisposalRecord}. */
  private disposalRecords: DisposalRecord[] = [];

  constructor(options: ClaudeAgentSdkAdapterOptions = {}) {
    this.disposeBegun = new Promise<void>((resolve) => {
      this.signalDisposeBegun = resolve;
    });
    this.substitutedQuery = options.queryFn ?? null;
    this.toolKitLoader = options.toolKit ?? (() => loadClaudeToolKit());
    this.substitutedLookup = options.localLookup ?? null;
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

  /**
   * A digest of this instance's permission policy, for `SessionConfig.expectedToolPolicy`
   * on a later `resume()`: `claude-agent-sdk:` plus the SHA-256 of the policy's
   * canonical JSON. Equal for equal policies; different for a changed `allowedTools`.
   */
  policyDigest(): string {
    const digest = createHash('sha256').update(canonicalJson(this.permissions)).digest('hex');
    return `claude-agent-sdk:${digest}`;
  }

  /**
   * DSP-149: every query is started anew with `resume`, so a changed folder list is
   * passed on the next turn as `additionalDirectories`. The primary is not changed
   * here; it is the resume key, and a different primary is a different session.
   */
  setWorkspaceRoots(sessionId: DspatchSessionId, roots: readonly string[]): void {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    state.config = {
      ...state.config,
      workspacePaths: [state.config.workspacePath, ...roots.filter((root) => foldFolder(root) !== foldFolder(state.config.workspacePath))],
    };
  }

  async startSession(config: SessionConfig): Promise<SessionHandle> {
    const dspatchSessionId = this.checkedSessionId(config, config.dspatchSessionId ?? newSessionId());
    const createdAt = nowIso();
    const providerSessionId = providerSessionIdFor(dspatchSessionId);
    this.sessions.set(dspatchSessionId, {
      ...newSessionState(dspatchSessionId, config, providerSessionId, createdAt),
      established: false,
      resumption: null,
    });
    return { dspatchSessionId, provider: 'claude', providerSessionId, createdAt };
  }

  /**
   * Register a session this instance did not start, from a local record (DSP-122).
   *
   * The same preconditions as {@link startSession}, then, in this order: the
   * expected tool policy against {@link policyDigest} (before any lookup), the
   * local lookup of the derived provider UUID under `config.workspacePath`, and
   * the record's own `cwd` against `config.workspacePath`. Each refusal carries a
   * `providerCode` DSpatch's classifier reads: `config_mismatch`,
   * `local_lookup_failed`, `local_record_missing`, or
   * `local_record_missing_unaligned` when the lookup read a different profile
   * than the provider process would (see {@link LookupEnvironment}).
   *
   * Nothing here asks the provider: no process is started and no model turn
   * runs. The handle's `resumeEvidence` is therefore `'local-record'`, and the
   * session is registered as established so that its first `send` passes
   * `resume` with the same derived UUID and no `sessionId` (the SDK forbids both
   * together). What the provider makes of that is recorded by the first turn in
   * {@link resumption}, and that record never treats an equal ID as recall.
   */
  async resume(sessionId: DspatchSessionId, config: SessionConfig): Promise<SessionHandle> {
    this.checkedSessionId(config, sessionId);
    const providerSessionId = providerSessionIdFor(sessionId);
    const dir = config.workspacePath;

    if (config.expectedToolPolicy !== undefined && config.expectedToolPolicy !== this.policyDigest()) {
      throw new ClaudeAdapterError(
        `DSpatch's record of session "${sessionId}" expects tool policy ` +
          `${config.expectedToolPolicy}, and this adapter's policy is ${this.policyDigest()} ` +
          '(toolPolicy). The tools DSpatch gives Claude have changed since this session ' +
          'was recorded - for example, Claude now runs commands with its own shell tools - and a ' +
          'session is not continued under rules other than the ones it was started with. ' +
          'Start a new session to continue under the current tool policy; the earlier ' +
          'conversation stays readable. No local record was read and the provider was not asked.',
        'config_mismatch',
      );
    }

    const lookupEnvironment = this.lookupEnvironment();
    const profile = lookupEnvironment.hostConfigDir ?? 'the default Claude profile';
    let info: SDKSessionInfo | undefined;
    try {
      info = await (await this.lookupFunction())(providerSessionId, dir);
    } catch (error) {
      throw new ClaudeAdapterError(
        `DSpatch's local check of session record ${providerSessionId} under ${dir} ` +
          `(${profile}) failed: ${errorText(error)}. The provider was not asked.`,
        'local_lookup_failed',
        error,
      );
    }
    if (info === undefined) {
      const missing =
        `DSpatch's local check found no readable session record for ${providerSessionId} ` +
        `under ${dir} (${profile}). The provider was not asked.`;
      if (!lookupEnvironment.aligned) {
        throw new ClaudeAdapterError(
          `${missing} The check looked in a different profile than the one the provider ` +
            `process uses (this process: CLAUDE_CONFIG_DIR ${describeConfigDir(lookupEnvironment.hostConfigDir)}; ` +
            `the provider process: ${describeConfigDir(lookupEnvironment.childConfigDir)}), ` +
            'so it says nothing about whether a record exists there.',
          'local_record_missing_unaligned',
        );
      }
      throw new ClaudeAdapterError(missing, 'local_record_missing');
    }
    const recordCwd = typeof info.cwd === 'string' && info.cwd !== '' ? info.cwd : null;
    if (recordCwd !== null && foldFolder(recordCwd) !== foldFolder(dir)) {
      throw new ClaudeAdapterError(
        `DSpatch's local record of session ${providerSessionId} names working directory ` +
          `${recordCwd}, and this resume names ${dir} (workspacePath). A session is not ` +
          'resumed into a different folder. The provider was not asked.',
        'config_mismatch',
      );
    }

    const createdAt = nowIso();
    this.sessions.set(sessionId, {
      ...newSessionState(sessionId, config, providerSessionId, createdAt),
      established: true,
      resumption: {
        localLookup: {
          found: true,
          cwd: recordCwd,
          lastModified: info.lastModified,
          summary: info.summary,
          dir,
          configDir: lookupEnvironment.hostConfigDir,
          aligned: lookupEnvironment.aligned,
        },
        lookupEnvironment,
        firstTurn: null,
      },
    });
    return {
      dspatchSessionId: sessionId,
      provider: 'claude',
      providerSessionId,
      createdAt,
      resumeEvidence: 'local-record',
    };
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
      startFailed: false,
      openCommands: new Map(),
      commands: [],
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
      // DSP-149: the session's app tools as the SDK's in-process MCP server, built once.
      const appTools = state.config.appTools ?? [];
      if (state.toolServer === null && appTools.length > 0 && this.permissions.denyEveryTool !== true) {
        state.toolServer = buildAppToolServer(await this.toolKitLoader(), appTools);
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
      run.startFailed = true;
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

  /**
   * The models this account can use, from the SDK's own `Query.supportedModels()`
   * (DSP-149; sdk.d.ts 0.3.306: "Get the list of available models", answered from Claude
   * Code's initialize exchange). The SDK offers no list outside a query, so a query is
   * started whose prompt never yields a message: **no user message is sent and no model
   * turn runs**. It has no tools, no settings from disk and no MCP servers, runs in an
   * empty folder of its own, and is closed as soon as the list has come back. Starting
   * Claude Code does authenticate with the account, which is the point of the list.
   */
  async listModels(): Promise<readonly ModelInfo[]> {
    this.assertUsable();
    if (this.assessment.refusal !== null) {
      throw new ClaudeAdapterError(this.assessment.refusal, 'authentication_refused');
    }
    const queryFn = await this.queryFunction();
    // One fixed, empty folder DSpatch owns, created when missing and never deleted here.
    // It used to be a fresh folder removed in `finally`: on Windows that removal fails
    // with EPERM while Claude Code still has the folder as its working directory, and
    // the failure replaced the list Claude had just given (Niclas's trial, 27 Oct 2026:
    // "Models unavailable" over a working login).
    const folder = path.join(tmpdir(), 'dspatch-claude-models');
    mkdirSync(folder, { recursive: true });
    const abortController = new AbortController();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prompt = (async function* (): AsyncIterable<SDKUserMessage> {
      await held;
    })();
    const handle = queryFn({
      prompt,
      options: {
        cwd: folder,
        tools: [],
        allowedTools: [],
        permissionMode: 'dontAsk',
        settingSources: [],
        strictMcpConfig: true,
        abortController,
        env: { ...this.subprocessEnv },
      },
    });
    try {
      if (handle.supportedModels === undefined) {
        throw new ClaudeAdapterError('This Claude SDK does not list models.');
      }
      let timer: NodeJS.Timeout | undefined;
      const listed = await Promise.race([
        handle.supportedModels(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new ClaudeAdapterError('Claude did not list its models within 30 seconds.'));
          }, 30_000);
        }),
      ]).finally(() => {
        clearTimeout(timer);
      });
      return listed.map((model) => ({
        id: model.value,
        displayName: model.displayName === '' ? model.value : model.displayName,
        provider: 'claude' as const,
        ...(model.description === undefined || model.description === '' ? {} : { description: model.description }),
        ...(model.resolvedModel === undefined ? {} : { resolvedId: model.resolvedModel }),
      }));
    } catch (error) {
      throw toAdapterError('listModels', error);
    } finally {
      release();
      abortController.abort();
      handle.close?.();
    }
  }

  /** DSP-149: the model the next turn asks for. Never changes a turn already running. */
  setSessionModel(sessionId: DspatchSessionId, modelId: string): void {
    const state = this.sessions.get(sessionId);
    if (state !== undefined) {
      state.config = { ...state.config, modelRequested: modelId };
    }
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
   * Abort and close every turn still running, then take care of each local Claude
   * Code process that has not been seen to exit (DSP-116):
   *
   * 1. Wait up to {@link DISPOSE_EXIT_WAIT_MS} for the stream pumps to end and the
   *    observed processes to exit (the SDK's own abort path stops the process).
   * 2. Kill (`SIGKILL`) each observed process still running, unless the run's stop
   *    sequence already sent its kill, which is not repeated.
   * 3. Wait up to {@link CANCEL_KILL_WAIT_MS} for those exits.
   *
   * At most {@link DISPOSE_BOUND_MS} in all. What happened is recorded per run in
   * {@link disposals}, including a process whose exit could not be confirmed. A
   * cancellation in progress is abandoned: its timers are cleared and it emits
   * nothing more (listeners are removed first anyway). Idempotent: a repeated call
   * waits for the same dispose. Never throws.
   */
  dispose(): Promise<void> {
    this.disposing ??= this.disposeOnce();
    return this.disposing;
  }

  private async disposeOnce(): Promise<void> {
    this.disposed = true;
    this.signalDisposeBegun();
    try {
      const states = [...this.sessions.values()];
      this.sessions.clear();
      const pumps: ClaudeRun[] = [];
      const watched: Array<{ readonly state: SessionState; readonly run: ClaudeRun }> = [];
      for (const state of states) {
        state.listeners.clear();
        for (const run of state.runs) {
          this.abandonStop(run);
          // A missing observation is not proof that nothing runs (see EndEvidence),
          // so a run with a handle and no observed process is recorded too.
          if (run.handle !== null && (run.process === null || run.process.exit === null)) {
            watched.push({ state, run });
          }
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
            pumps.push(run);
          }
        }
      }
      const running = (): ClaudeRun[] =>
        watched
          .map((entry) => entry.run)
          .filter((run) => run.process !== null && run.process.exit === null);
      const involved = [...new Set([...pumps, ...watched.map((entry) => entry.run)])];

      await this.waitForAll(
        involved,
        () => pumps.every((run) => run.streamPumpFinished) && running().length === 0,
        DISPOSE_EXIT_WAIT_MS,
      );

      const killedByDispose = new Map<ClaudeRun, { at: Timestamp; sent: boolean }>();
      for (const run of running()) {
        // The stop sequence's kill is not repeated: one kill per process.
        if (run.process === null || run.cancellation?.killRequestedAt != null) {
          continue;
        }
        let sent = false;
        try {
          sent = run.process.child.kill('SIGKILL');
        } catch {
          sent = false;
        }
        killedByDispose.set(run, { at: nowIso(), sent });
      }
      const stillRunning = running();
      if (stillRunning.length > 0) {
        await this.waitForAll(stillRunning, () => running().length === 0, CANCEL_KILL_WAIT_MS);
      }

      this.disposalRecords = watched.map(({ state, run }): DisposalRecord => {
        const observed = run.process;
        const disposeKill = killedByDispose.get(run) ?? null;
        const killedBy =
          disposeKill !== null
            ? ('dispose' as const)
            : run.cancellation?.killRequestedAt != null
              ? ('stop-sequence' as const)
              : null;
        const exit = observed?.exit ?? null;
        return {
          dspatchSessionId: state.dspatchSessionId,
          dspatchRunId: run.dspatchRunId,
          processObserved: observed !== null,
          pid: observed?.pid ?? null,
          killedBy,
          disposeKillRequestedAtUtc: disposeKill?.at ?? null,
          disposeKillSignalSent: disposeKill?.sent ?? null,
          exitedAtUtc: exit?.at ?? null,
          exitCode: exit?.code ?? null,
          signal: exit?.signal ?? null,
          outcome:
            exit === null ? 'unconfirmed' : killedBy === null ? 'exited' : 'killed-and-exited',
          bounds: { exitWaitMs: DISPOSE_EXIT_WAIT_MS, afterKillMs: CANCEL_KILL_WAIT_MS },
          providerWorkAfterEnd: 'unknown',
        };
      });
    } catch {
      // Shutdown path: dispose must not throw.
    }
  }

  /**
   * What `dispose` did about each run's local process (see {@link DisposalRecord}),
   * in session and run order. Empty before `dispose` has resolved, and for an
   * instance whose processes had all been seen to exit before it was disposed.
   */
  disposals(): readonly DisposalRecord[] {
    return [...this.disposalRecords];
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

  /**
   * What `resume()` found locally and what the first turn after it reported, or
   * `null` for a session this instance started. A copy; see {@link ResumptionRecord}.
   */
  resumption(sessionId: DspatchSessionId): ResumptionRecord | null {
    const record = this.requireSession(sessionId).resumption;
    if (record === null) {
      return null;
    }
    return {
      localLookup: { ...record.localLookup },
      lookupEnvironment: { ...record.lookupEnvironment },
      firstTurn: record.firstTurn === null ? null : { ...record.firstTurn },
    };
  }

  /**
   * Each run's local process as observed through the spawn wrapper, in run order
   * (DSP-122 P4'): pid, exit and stderr tail, or `null` for a run whose `query()`
   * never spawned one. An observation is what was seen; a missing exit is not
   * proof the process is still there, nor the other way round (see {@link EndEvidence}).
   */
  processObservations(
    sessionId: DspatchSessionId,
  ): readonly { readonly dspatchRunId: DspatchRunId; readonly process: ProcessObservation | null }[] {
    return this.requireSession(sessionId).runs.map((run) => ({
      dspatchRunId: run.dspatchRunId,
      process: processObservation(run.process),
    }));
  }

  /** The title passed as `Options.title` on every `query()` of this session. For run records. */
  sessionTitle(sessionId: DspatchSessionId): string {
    return sessionTitleFor(this.requireSession(sessionId));
  }

  hasActiveRun(sessionId: DspatchSessionId): boolean {
    return this.sessions.get(sessionId)?.activeRun != null;
  }

  /** DSP-146: every shell command the agent ran in this session, as the hooks recorded it. */
  commandRecords(sessionId: DspatchSessionId): readonly AgentCommandRecord[] {
    return this.requireSession(sessionId).runs.flatMap((run) => run.commands);
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

  /**
   * DSP-146: whether this instance records the agent's shell commands: its policy offers
   * a shell tool and does not deny every tool.
   */
  private recordsShellCommands(): boolean {
    return (
      this.permissions.denyEveryTool !== true &&
      this.permissions.tools.some((tool) => SHELL_TOOLS.includes(tool))
    );
  }

  private async lookupFunction(): Promise<ClaudeLocalLookup> {
    if (this.substitutedLookup !== null) {
      return this.substitutedLookup;
    }
    this.loadedLookup ??= await loadSdkLocalLookup();
    return this.loadedLookup;
  }

  /**
   * The profile the local lookup reads (this process's environment) against the
   * one the provider process is given (`subprocessEnv`, as `optionsFor` passes
   * it). The child's variable is matched by the adapter's own case rule.
   */
  private lookupEnvironment(): LookupEnvironment {
    const hostConfigDir = process.env['CLAUDE_CONFIG_DIR'] ?? null;
    let childConfigDir: string | null = null;
    for (const [name, value] of Object.entries(this.subprocessEnv)) {
      const key = this.caseInsensitive ? name.toUpperCase() : name;
      if (key === 'CLAUDE_CONFIG_DIR' && value !== undefined) {
        childConfigDir = value;
        break;
      }
    }
    return { hostConfigDir, childConfigDir, aligned: hostConfigDir === childConfigDir };
  }

  /**
   * The preconditions `startSession` and `resume` share, in this order: usable
   * instance, the `claude` provider, the authentication rule (unchanged), one
   * working root, and an ID this instance does not already hold.
   */
  private checkedSessionId(config: SessionConfig, dspatchSessionId: DspatchSessionId): DspatchSessionId {
    this.assertUsable();
    if (config.provider !== 'claude') {
      throw new ClaudeAdapterError(
        `This adapter serves the "claude" provider, not "${config.provider}".`,
      );
    }
    if (this.assessment.refusal !== null) {
      throw new ClaudeAdapterError(this.assessment.refusal, 'authentication_refused');
    }
    sessionRoots(config);
    if (this.sessions.has(dspatchSessionId)) {
      throw new ClaudeAdapterError(
        `Session "${dspatchSessionId}" is already open. Close it before reusing the ID.`,
      );
    }
    return dspatchSessionId;
  }

  private optionsFor(state: SessionState, run: ClaudeRun): ClaudeQueryOptions {
    const { config } = state;
    const otherRoots = sessionRoots(config).slice(1);
    // DSP-149: a conversation with no workspace yet gets none of the built-in tools,
    // only DSpatch's app tools; a workspace session gets the policy's tools in every
    // folder, plus the app tools. The review policy (`denyEveryTool`) never gets either.
    const conversationOnly = config.toolScope === 'conversation';
    const appTools = this.permissions.denyEveryTool === true ? [] : (config.appTools ?? []);
    const appToolNames = appTools.map(claudeAppToolName);
    return {
      cwd: config.workspacePath,
      ...(config.modelRequested === '' ? {} : { model: config.modelRequested }),
      tools: conversationOnly ? [] : [...this.permissions.tools],
      allowedTools: conversationOnly
        ? appToolNames
        : [...this.permissions.allowedTools, ...rootRules(this.permissions, otherRoots), ...appToolNames],
      ...(conversationOnly || otherRoots.length === 0 ? {} : { additionalDirectories: [...otherRoots] }),
      ...(state.toolServer === null || appTools.length === 0
        ? {}
        : { mcpServers: { [APP_TOOL_SERVER]: state.toolServer } }),
      ...(this.permissions.disallowedTools === undefined
        ? {}
        : { disallowedTools: [...this.permissions.disallowedTools] }),
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
      // DSP-132: with `denyEveryTool`, a second unmatched hook refuses every call.
      // DSP-146: under a policy with a shell tool, the same PreToolUse callback records
      // the start of each shell command it lets through, and PostToolUse and
      // PostToolUseFailure record how it ended, so DSpatch observes the agent's own
      // commands at the SDK's boundary rather than running them itself.
      hooks: {
        PreToolUse: [
          {
            hooks:
              this.permissions.denyEveryTool === true
                ? [this.cancelHook(state, run), this.denyEveryToolHook(run)]
                : [this.cancelHook(state, run)],
          },
        ],
        ...(this.recordsShellCommands()
          ? {
              PostToolUse: [{ matcher: SHELL_TOOLS.join('|'), hooks: [this.commandEndHook(state, run, 'succeeded')] }],
              PostToolUseFailure: [
                { matcher: SHELL_TOOLS.join('|'), hooks: [this.commandEndHook(state, run, 'failed')] },
              ],
            }
          : {}),
      },
      // The SDK's own spawn, wrapped only to observe the process exit (see
      // `spawnObserved`); same command, arguments and environment.
      spawnClaudeCodeProcess: (spawnOptions) => this.spawnObserved(run, spawnOptions),
      // DSP-146: every command the agent runs stays in the foreground of its turn.
      env: { ...this.subprocessEnv, ...FOREGROUND_ONLY_ENV },
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
    // `dispose` may be waiting for this pump.
    this.wake(run);
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
          if (state.resumption !== null && state.resumption.firstTurn === null) {
            // The first init after a resume. Equal IDs are a consistency check only.
            const initSessionId =
              typeof reportedSession === 'string' && reportedSession !== '' ? reportedSession : null;
            state.resumption.firstTurn = {
              dspatchRunId: run.dspatchRunId,
              initSessionId,
              idMatches: initSessionId === null ? null : initSessionId === state.providerSessionId,
              terminalStatus: null,
              failure: null,
            };
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
    this.recordFirstTurnEnd(state, run, status, error);
    // DSP-146: a shell command whose end Claude Code never reported is recorded now, as
    // not reported or stopped, so every `command.finished` comes before `run.finished`.
    this.closeOpenCommands(state, run);
    this.emitRunEnd(state, run, status, error, rawProviderEvent, end);
  }

  /** The run's final text and its one terminal event. Only `finishRun` calls it. */
  private emitRunEnd(
    state: SessionState,
    run: ClaudeRun,
    status: TerminalRunStatus,
    error: AdapterError | undefined,
    rawProviderEvent: unknown,
    end: RunEnd | undefined,
  ): void {
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

  /**
   * The first turn after a resume ends: its terminal status and, on an error, the
   * classification. The session stays established and keeps its record whatever
   * the outcome: a failed first turn is reported, not acted on, here.
   */
  private recordFirstTurnEnd(
    state: SessionState,
    run: ClaudeRun,
    status: TerminalRunStatus,
    error: AdapterError | undefined,
  ): void {
    const resumption = state.resumption;
    if (resumption === null) {
      return;
    }
    const isFirst =
      resumption.firstTurn === null
        ? state.runs[0] === run
        : resumption.firstTurn.dspatchRunId === run.dspatchRunId;
    if (!isFirst) {
      return;
    }
    resumption.firstTurn = {
      dspatchRunId: run.dspatchRunId,
      initSessionId: resumption.firstTurn?.initSessionId ?? null,
      idMatches: resumption.firstTurn?.idMatches ?? null,
      terminalStatus: status,
      failure: status === 'error' ? classifyFirstTurnFailure(run, error) : null,
    };
  }

  // --- The agent's shell commands, as the hooks report them (DSP-146) ---------------

  /** Record the start of a shell command the PreToolUse hook let through. */
  private commandStarted(
    state: SessionState,
    run: ClaudeRun,
    fields: Record<string, unknown>,
    toolName: string,
    toolUseId: string | null,
  ): void {
    const open = openShellCommand(fields, toolName, toolUseId, state.config.workspacePath, Date.now());
    run.openCommands.set(toolUseId ?? open.commandId, open);
    this.emit(state, {
      type: 'command.started',
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId: run.dspatchRunId,
      at: open.startedAtUtc,
      rawProviderEvent: null,
      toolCallId: toolUseId,
      commandId: open.commandId,
      line: open.line,
      cwd: open.cwd,
    });
  }

  /**
   * The PostToolUse (`succeeded`) or PostToolUseFailure (`failed`) callback: records how
   * a shell command ended, from what Claude Code reported, and passes. Never changes the
   * tool result the model receives. A command whose start this run did not see is
   * recorded from the end alone.
   */
  private commandEndHook(state: SessionState, run: ClaudeRun, outcome: 'succeeded' | 'failed'): HookCallback {
    return (input, toolUseID) => {
      const fields = asRecord(input);
      const toolName = typeof fields['tool_name'] === 'string' ? fields['tool_name'] : '';
      // A late end after the run's end was recorded would be a second record of the
      // same command after `run.finished`; the first one stands.
      if (!SHELL_TOOLS.includes(toolName) || run.terminalEmitted) {
        return Promise.resolve({});
      }
      const reported = fields['tool_use_id'];
      const toolUseId =
        typeof reported === 'string' && reported !== '' ? reported : (toolUseID ?? null);
      const now = Date.now();
      const key = toolUseId !== null && run.openCommands.has(toolUseId) ? toolUseId : null;
      let open: OpenShellCommand;
      if (key !== null) {
        open = run.openCommands.get(key) as OpenShellCommand;
        run.openCommands.delete(key);
      } else {
        const took = typeof fields['duration_ms'] === 'number' ? fields['duration_ms'] : 0;
        open = openShellCommand(fields, toolName, toolUseId, state.config.workspacePath, now - took);
      }
      this.recordCommand(state, run, open, shellCommandEnd(fields, outcome), now);
      return Promise.resolve({});
    };
  }

  /** Record every shell command still open when the run ends. */
  private closeOpenCommands(state: SessionState, run: ClaudeRun): void {
    const now = Date.now();
    const end: ShellCommandEnd =
      run.cancellation !== null
        ? { ending: 'stopped', endingMessage: SHELL_COMMAND_CANCELLED_NOTE, exitCode: null, stdout: '', stderr: '', outputNote: null, durationMs: null }
        : { ending: 'not-reported', endingMessage: SHELL_COMMAND_UNREPORTED_NOTE, exitCode: null, stdout: '', stderr: '', outputNote: null, durationMs: null };
    for (const open of [...run.openCommands.values()]) {
      this.recordCommand(state, run, open, end, now);
    }
    run.openCommands.clear();
  }

  private recordCommand(
    state: SessionState,
    run: ClaudeRun,
    open: OpenShellCommand,
    end: ShellCommandEnd,
    finishedAt: number,
  ): void {
    const record = shellCommandRecord(open, end, finishedAt);
    run.commands.push(record);
    this.emit(state, {
      type: 'command.finished',
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId: run.dspatchRunId,
      at: record.finishedAtUtc,
      rawProviderEvent: null,
      toolCallId: open.toolCallId,
      command: record,
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

  /**
   * Wait until `condition` holds, at most `ms`, re-checked whenever one of `runs`
   * wakes. Unlike {@link waitFor} it ignores `stopAbandoned`: `dispose` uses it
   * after abandoning every stop sequence. The timer is always cleared. Resolves
   * to whether the condition held.
   */
  private waitForAll(
    runs: readonly ClaudeRun[],
    condition: () => boolean,
    ms: number,
  ): Promise<boolean> {
    if (condition()) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let done = false;
      let timer: unknown = null;
      const finish = (met: boolean): void => {
        if (done) {
          return;
        }
        done = true;
        for (const run of runs) {
          run.waiters.delete(check);
        }
        if (timer !== null) {
          this.timers.clearTimeout(timer);
        }
        resolve(met);
      };
      const check = (): void => {
        if (condition()) {
          finish(true);
        }
      };
      for (const run of runs) {
        run.waiters.add(check);
      }
      timer = this.timers.setTimeout(() => {
        finish(condition());
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
  private cancelHook(state: SessionState, run: ClaudeRun): HookCallback {
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
        if (SHELL_TOOLS.includes(toolName) && this.recordsShellCommands()) {
          this.commandStarted(state, run, fields, toolName, toolUseId);
        }
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
   * DSP-132: the deny-all PreToolUse callback. Records every call and denies it with
   * {@link REVIEW_DENY_REASON}. No `continue: false` and no `stopReason`: the turn is
   * not ended, so the model can answer in text. Independent of cancellation, which
   * the cancellation hook beside it still handles.
   */
  private denyEveryToolHook(run: ClaudeRun): HookCallback {
    return (input, toolUseID) => {
      const fields = asRecord(input);
      const toolName = typeof fields['tool_name'] === 'string' ? fields['tool_name'] : 'unknown';
      const reported = fields['tool_use_id'];
      const toolUseId =
        typeof reported === 'string' && reported !== '' ? reported : (toolUseID ?? null);
      run.hookFirings.push({
        dspatchRunId: run.dspatchRunId,
        atUtc: nowIso(),
        toolName,
        toolUseId,
        decision: 'deny',
        hook: 'deny-every-tool',
      });
      const output: HookJSONOutput = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: REVIEW_DENY_REASON,
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

  /**
   * True if `promise` settles within `ms`, on this instance's timers. Ends at once
   * when `dispose` begins (answering whether it had settled by then), so no timer
   * of it outlives the instance.
   */
  private async settlesWithinBound(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: unknown = null;
    let settled = false;
    const markSettled = (): boolean => {
      settled = true;
      return true;
    };
    try {
      return await Promise.race([
        promise.then(markSettled, markSettled),
        this.disposeBegun.then(() => settled),
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

// --- Shell command records (DSP-146) ---------------------------------------------------

/** A shell command whose start was seen and whose end is not yet recorded. */
export interface OpenShellCommand {
  readonly commandId: string;
  readonly toolCallId: string | null;
  readonly toolName: string;
  readonly line: string;
  readonly cwd: string;
  /** The timeout the agent asked for, or `null` for Claude Code's default. */
  readonly timeoutMs: number | null;
  readonly startedAt: number;
  readonly startedAtUtc: Timestamp;
}

/** How a shell command ended, as Claude Code reported it. */
export interface ShellCommandEnd {
  readonly ending: AgentCommandRecord['ending'];
  readonly endingMessage: string | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputNote: string | null;
  /** Claude Code's own measure of the run, when it gave one. */
  readonly durationMs: number | null;
}

/** Recorded for a shell command still open when a cancelled run ended. */
export const SHELL_COMMAND_CANCELLED_NOTE =
  'The run was cancelled while this command ran. DSpatch denied further tool calls and ' +
  'asked Claude Code to stop; Claude Code reported no end for the command. Whether the ' +
  'command, and any process it started, has ended is not established by DSpatch.';

/** Recorded for a shell command still open when a run ended without a cancellation. */
export const SHELL_COMMAND_UNREPORTED_NOTE =
  'Claude Code reported no end for this command before the turn ended - for example, a ' +
  'permission rule refused it, or the turn ended with an error - so how it ended is not known.';

/** Recorded with an exit code DSpatch reads from a successful result. */
export const SHELL_SUCCESS_EXIT_NOTE =
  'Claude Code reported a successful result; it states exit codes only for failures, so ' +
  'exit code 0 is DSpatch\'s reading of that report.';

/** Recorded with a failure, whose output Claude Code reports as one text. */
export const SHELL_FAILURE_OUTPUT_NOTE =
  'Claude Code reports a failing command\'s output as one text, so standard output and ' +
  'standard error are not separated here.';

/** The start of a shell command, from a hook's input. */
export function openShellCommand(
  fields: Record<string, unknown>,
  toolName: string,
  toolUseId: string | null,
  sessionCwd: string,
  startedAt: number,
): OpenShellCommand {
  const input = asRecord(fields['tool_input']);
  const reportedCwd = fields['cwd'];
  return {
    commandId: randomUUID(),
    toolCallId: toolUseId,
    toolName,
    line: typeof input['command'] === 'string' ? input['command'] : '',
    cwd: typeof reportedCwd === 'string' && reportedCwd !== '' ? reportedCwd : sessionCwd,
    timeoutMs: typeof input['timeout'] === 'number' ? input['timeout'] : null,
    startedAt,
    startedAtUtc: new Date(startedAt).toISOString(),
  };
}

/**
 * How a shell command ended, from a PostToolUse or PostToolUseFailure hook's input
 * (hooks reference, read 27 Oct 2026): a success carries Bash's `stdout`, `stderr` and
 * `interrupted`; a failure carries `error`, whose first line is `Exit code N` when the
 * command ran and exited, and `is_interrupt` when it was aborted. Anything else is kept
 * as reported and called not reported, never guessed.
 */
export function shellCommandEnd(fields: Record<string, unknown>, outcome: 'succeeded' | 'failed'): ShellCommandEnd {
  const durationMs = typeof fields['duration_ms'] === 'number' ? fields['duration_ms'] : null;
  if (outcome === 'succeeded') {
    const response = asRecord(fields['tool_response']);
    const stdout = typeof response['stdout'] === 'string' ? response['stdout'] : '';
    const stderr = typeof response['stderr'] === 'string' ? response['stderr'] : '';
    if (response['interrupted'] === true) {
      return { ending: 'stopped', endingMessage: 'Claude Code reported the command as interrupted.', exitCode: null, stdout, stderr, outputNote: null, durationMs };
    }
    const interpretation = response['returnCodeInterpretation'];
    const persisted = response['persistedOutputSize'] ?? response['persistedOutputPath'];
    // Past Claude Code's inline limit the result carries a preview and the path of a
    // file with the rest (sdk-tools.d.ts 0.3.306 `BashOutput.persistedOutput*`).
    const preview =
      persisted === undefined
        ? ''
        : ` The output here may be only Claude Code's preview: it saved the full output to a file` +
          `${typeof response['persistedOutputSize'] === 'number' ? ` (${String(response['persistedOutputSize'])} bytes)` : ''}.`;
    return typeof interpretation === 'string' && interpretation !== ''
      ? {
          ending: 'exited',
          endingMessage: null,
          exitCode: null,
          stdout,
          stderr,
          outputNote: `Claude Code counted this as a successful result (${interpretation}) and did not report the exit code.${preview}`,
          durationMs,
        }
      : { ending: 'exited', endingMessage: null, exitCode: 0, stdout, stderr, outputNote: `${SHELL_SUCCESS_EXIT_NOTE}${preview}`, durationMs };
  }
  const error = typeof fields['error'] === 'string' ? fields['error'] : '';
  if (fields['is_interrupt'] === true) {
    return { ending: 'stopped', endingMessage: 'Claude Code reported the command as aborted.', exitCode: null, stdout: error, stderr: '', outputNote: null, durationMs };
  }
  const newline = error.indexOf('\n');
  const first = newline === -1 ? error : error.slice(0, newline);
  const exited = /^Exit code (-?\d+)\s*$/.exec(first.trim());
  if (exited !== null) {
    return {
      ending: 'exited',
      endingMessage: null,
      exitCode: Number(exited[1]),
      stdout: newline === -1 ? '' : error.slice(newline + 1),
      stderr: '',
      outputNote: SHELL_FAILURE_OUTPUT_NOTE,
      durationMs,
    };
  }
  return {
    ending: 'not-reported',
    endingMessage:
      `Claude Code reported a failure without an exit code: ${first.trim() === '' ? '(no message)' : first.trim()}`,
    exitCode: null,
    stdout: error,
    stderr: '',
    outputNote: null,
    durationMs,
  };
}

/** A provider-reported command record: DSpatch saw the hooks, it did not start the process. */
export function shellCommandRecord(open: OpenShellCommand, end: ShellCommandEnd, finishedAt: number): AgentCommandRecord {
  return {
    commandId: open.commandId,
    requestedBy: 'provider-reported',
    line: open.line,
    shell: `Claude Code ${open.toolName} tool`,
    cwd: open.cwd,
    pid: null,
    startedAtUtc: open.startedAtUtc,
    finishedAtUtc: new Date(finishedAt).toISOString(),
    durationMs: end.durationMs ?? Math.max(0, finishedAt - open.startedAt),
    timeoutMs: open.timeoutMs,
    ending: end.ending,
    endingMessage: end.endingMessage,
    exitCode: end.exitCode,
    signal: null,
    killedByDspatch: false,
    stdout: end.stdout,
    stderr: end.stderr,
    outputTruncated: false,
    outputNote: end.outputNote,
    testedSnapshotId: null,
    afterRunSnapshotId: null,
    snapshotRoots: [],
  };
}

/** The session title passed to the provider: the DSpatch session id, so the transcript names it. */
function sessionTitleFor(state: SessionState): string {
  return state.dspatchSessionId;
}

/** The fields every session starts with, whichever way it was registered. */
function newSessionState(
  dspatchSessionId: DspatchSessionId,
  config: SessionConfig,
  providerSessionId: string,
  createdAt: Timestamp,
): Omit<SessionState, 'established' | 'resumption'> {
  return {
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
    toolServer: null,
    activeRun: null,
    lastRun: null,
    modelReportedValue: null,
  };
}

function describeConfigDir(configDir: string | null): string {
  return configDir === null ? 'unset' : `"${configDir}"`;
}

/** See {@link FirstTurnFailure}. A thrown `query()` is `error` whatever its text. */
function classifyFirstTurnFailure(run: ClaudeRun, error: AdapterError | undefined): FirstTurnFailure {
  if (run.startFailed) {
    return 'error';
  }
  const message = error?.message ?? '';
  return PROVIDER_MISSING_FORMS.some((form) => form.test(message)) ? 'provider-missing' : 'unknown';
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
