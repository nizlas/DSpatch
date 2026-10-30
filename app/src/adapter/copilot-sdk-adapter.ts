import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentAdapter } from './agent-adapter';
import type {
  AdapterError,
  AgentCommandRecord,
  AgentEvent,
  AgentEventListener,
  ApprovalDecision,
  AppTool,
  CapabilityReport,
  DspatchRunId,
  DspatchSessionId,
  ModelInfo,
  RunEnd,
  RunReference,
  SessionConfig,
  SessionHandle,
  TerminalRunStatus,
  Timestamp,
  Unsubscribe,
  UsageQuery,
  UsageReading,
} from './types';

/**
 * GitHub's Copilot SDK (`@github/copilot-sdk`) behind DSpatch's adapter boundary (DSP-148).
 *
 * The SDK talks JSON-RPC to Copilot's own runtime, a native program from the platform
 * package that the SDK starts as a child process. **The runtime owns its model-tool loop**:
 * DSpatch gives it a tool list, a permission callback and hooks, and observes its events.
 * DSpatch has no tool of its own here and does not approve ordinary commands one by one.
 *
 * Everything said about the SDK below was read from version 1.0.28's typings or measured
 * from runtime 1.0.105 without an account (`hooks.discover`, `tools.list`, auth status) and
 * with a local stand-in model behind the real runtime (`tests/copilot-runtime.test.ts`). It
 * has **not** been seen against a real Copilot account.
 *
 * Credentials are never read, held or logged here. The runtime finds its own login, on the
 * machine it runs on (`copilot login` there); DSpatch asks only whether there is one.
 */

// --- What the SDK gives DSpatch: the part used, stated here ---------------------------

/** The session events read here. Everything else is kept as `rawProviderEvent` only. */
export interface CopilotEvent {
  readonly type: string;
  readonly data?: unknown;
}

export interface CopilotPermissionRequest {
  readonly kind: string;
  readonly path?: string;
  readonly fileName?: string;
  readonly managedApprovalRequired?: boolean;
}

export type CopilotPermissionResult = { readonly kind: 'approve-once' } | { readonly kind: 'reject'; readonly feedback?: string };

export interface CopilotPreToolInput {
  readonly toolName: string;
  readonly toolArgs: unknown;
}

export interface CopilotSessionHooks {
  onPreToolUse(input: CopilotPreToolInput): { readonly permissionDecision: 'deny'; readonly permissionDecisionReason: string } | undefined;
}

/** The session configuration DSpatch passes, a subset of the SDK's `SessionConfig`. */
export interface CopilotSessionOptions {
  readonly clientName: string;
  readonly sessionId?: string;
  readonly model?: string;
  readonly streaming: true;
  readonly workingDirectory: string;
  readonly additionalDirectories?: readonly string[];
  readonly availableTools: readonly string[];
  readonly tools?: readonly unknown[];
  readonly onPermissionRequest: (request: CopilotPermissionRequest) => CopilotPermissionResult;
  readonly hooks: CopilotSessionHooks;
  readonly onEvent: (event: CopilotEvent) => void;
  readonly enableConfigDiscovery: false;
  readonly enableFileHooks: false;
  readonly enableSkills: false;
  readonly enableSessionStore: false;
  readonly enableHostGitOperations: boolean;
  readonly skipCustomInstructions: true;
  readonly skipEmbeddingRetrieval: true;
  readonly embeddingCacheStorage: 'in-memory';
  readonly memory: { readonly enabled: false };
  readonly trustWorkingDirectory?: 'session';
  /** A stand-in model for tests. Set only through {@link CopilotSdkAdapterOptions.testProvider}. */
  readonly provider?: Readonly<Record<string, unknown>>;
}

export interface CopilotSessionLike {
  readonly sessionId: string;
  send(options: { readonly prompt: string }): Promise<string>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface CopilotAuthStatus {
  readonly isAuthenticated: boolean;
  readonly authType?: string;
  readonly host?: string;
  readonly login?: string;
  readonly statusMessage?: string;
}

export interface CopilotModelEntry {
  readonly id: string;
  readonly name: string;
  readonly policy?: { readonly state?: string };
}

export interface CopilotHookReading {
  readonly hookType: string;
  readonly origin: string;
  readonly enabled: boolean;
}

export interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<readonly Error[]>;
  forceStop(): Promise<void>;
  getAuthStatus(): Promise<CopilotAuthStatus>;
  getStatus(): Promise<{ readonly version: string; readonly protocolVersion: number }>;
  listModels(): Promise<readonly CopilotModelEntry[]>;
  createSession(config: CopilotSessionOptions): Promise<CopilotSessionLike>;
  resumeSession(sessionId: string, config: CopilotSessionOptions): Promise<CopilotSessionLike>;
  /** The hook files the runtime found, for the session's record. Absent on a substitute. */
  discoverHooks?(): Promise<readonly CopilotHookReading[]>;
}

export type CopilotClientFactory = (env: Readonly<Record<string, string | undefined>>, workingDirectory: string) => Promise<CopilotClientLike>;

/** Turns an {@link AppTool} into the SDK's tool definition. */
export type CopilotToolFactory = (tool: AppTool) => Promise<unknown>;

/** A failure in the Copilot adapter. Satisfies {@link AdapterError}. */
export class CopilotAdapterError extends Error implements AdapterError {
  readonly providerCode?: string;

  constructor(message: string, providerCode?: string, cause?: unknown) {
    super(message);
    this.name = 'CopilotAdapterError';
    if (providerCode !== undefined) {
      this.providerCode = providerCode;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// --- Policies -------------------------------------------------------------------------

/**
 * What a session may use (DSP-148). An adapter-instance choice, as for Claude. `tools` is the
 * `availableTools` allow-list, so a tool a later runtime adds is off until DSpatch names it.
 *
 * `onPermissionRequest` and `onPreToolUse` are the enforcement at the runtime's boundary. No
 * policy reaches `skill`, `task` (sub-agents, whose tools would need their own check) or
 * `web_fetch`; those are left out, not forgotten. Nothing here confines the process.
 */
export interface CopilotToolPolicy {
  readonly surface: 'chat' | 'review' | 'analysis';
  readonly tools: readonly string[];
  /** The agent may run commands with the runtime's own shell tools. */
  readonly shell: boolean;
  /** The agent may create and edit files inside the session's folders. */
  readonly writes: boolean;
  /** Reads and searches stay inside the session's folders, read links included. */
  readonly confineToFolders: true;
}

/** The runtime's shell tools, one family per platform (`tools.list`, runtime 1.0.105). */
export const COPILOT_SHELL_TOOLS: readonly string[] = Object.freeze(['bash', 'powershell']);

const SHELL_COMPANIONS: readonly string[] = Object.freeze(
  COPILOT_SHELL_TOOLS.flatMap((shell) => [shell, `read_${shell}`, `write_${shell}`, `stop_${shell}`, `list_${shell}`]),
);

export const COPILOT_READING_TOOLS: readonly string[] = Object.freeze(['view', 'glob', 'grep']);

export const COPILOT_CHAT_POLICY: CopilotToolPolicy = Object.freeze({
  surface: 'chat',
  tools: Object.freeze([...COPILOT_READING_TOOLS, 'create', 'edit', ...SHELL_COMPANIONS]),
  shell: true,
  writes: true,
  confineToFolders: true,
});

/** The review discussion without code access: nothing to call, and every call refused. */
export const COPILOT_REVIEW_POLICY: CopilotToolPolicy = Object.freeze({
  surface: 'review',
  tools: Object.freeze([]),
  shell: false,
  writes: false,
  confineToFolders: true,
});

/** Walks, delegated review, Worth checking and code questions: the revision folder, read-only. */
export const COPILOT_ANALYSIS_POLICY: CopilotToolPolicy = Object.freeze({
  surface: 'analysis',
  tools: COPILOT_READING_TOOLS,
  shell: false,
  writes: false,
  confineToFolders: true,
});

export const COPILOT_REVIEW_DENY_REASON = 'This is a text-only review discussion: no tool may be used, and this call was not run. Answer in text.';

export const COPILOT_ANALYSIS_DENY_REASON =
  'This is read-only analysis of two revisions: only view, glob and grep inside your working folder (base/ and target/) may be used, and this call was not run. Paths must stay inside that folder.';

export const COPILOT_POLICY_DENY_REASON = 'DSpatch does not allow this for this session, and it was not run.';

export const COPILOT_MANAGED_APPROVAL_REASON =
  'A managed policy asks for a person to approve this, and DSpatch has no such approval on this path, so it was not run.';

/** Beside what is sent for review (contract §3): the diff and prompt pass no tool hook. */
export const COPILOT_EXCLUSION_NOTE =
  'Content exclusion has not been verified on this path: the diff and the question are sent as the prompt, and DSpatch applies no exclusion rule of its own. Use synthetic material until the enablement gate is met.';

/** A policy as one line a person can read, for Session details and the review's Context. */
export function describeCopilotPolicy(policy: CopilotToolPolicy): string {
  const tools = policy.tools.length === 0 ? 'no tools' : `tools ${policy.tools.join(', ')}`;
  const writes = policy.writes ? 'writes inside the session folders' : 'no writes';
  const shell = policy.shell ? "the runtime's own shell" : 'no shell';
  return `${tools}; ${writes}; ${shell}; reads inside the session folders; no MCP, skills, sub-agents, web fetch or repository instructions`;
}

/** The policy as a digest for a session's record: a resume under other rules is refused. */
export function copilotPolicyDigest(policy: CopilotToolPolicy): string {
  return `copilot:${policy.surface}:${policy.tools.join(',')}:${String(policy.shell)}:${String(policy.writes)}`;
}

/**
 * Where a path really leads. A read through a link leaves a folder however its name looks,
 * so the last existing part is resolved and the rest kept.
 */
function realPathOf(candidate: string): string {
  let current = candidate;
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return candidate;
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function inside(candidate: string, folders: readonly string[], cwd: string, platform: NodeJS.Platform): boolean {
  const fold = (value: string): string => (platform === 'win32' ? value.toLowerCase() : value);
  const resolved = fold(realPathOf(path.resolve(cwd, candidate)));
  return folders.some((folder) => {
    const root = fold(realPathOf(path.resolve(folder)));
    return resolved === root || resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
}

/** A glob that stays in the folder it is applied in: relative, without `..`. */
function confinedPattern(pattern: unknown): boolean {
  if (pattern === undefined) {
    return true;
  }
  if (typeof pattern !== 'string') {
    return false;
  }
  return !path.isAbsolute(pattern) && !/^[a-zA-Z]:/.test(pattern) && !pattern.split(/[\\/]/).includes('..');
}

/**
 * Whether a call to one of the reading tools keeps to the folders. The parameters are the
 * runtime's own (`tools.list`, 1.0.105): `view` has `path`; `glob` and `grep` have `paths`, a
 * list, and a `pattern`/`glob`. A call with a field this cannot read is refused.
 */
export function copilotReadAllowed(toolName: string, args: unknown, folders: readonly string[], cwd: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!COPILOT_READING_TOOLS.includes(toolName)) {
    return false;
  }
  const fields = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
  if (toolName === 'view') {
    return typeof fields['path'] === 'string' && inside(fields['path'], folders, cwd, platform);
  }
  const where = fields['paths'];
  const wheres = where === undefined ? [] : Array.isArray(where) ? where : [where];
  if (!wheres.every((entry) => typeof entry === 'string' && inside(entry, folders, cwd, platform))) {
    return false;
  }
  return toolName === 'glob' ? confinedPattern(fields['pattern']) : confinedPattern(fields['glob']);
}

/** The permission answer for a request, decided from the policy alone. */
export function copilotPermission(
  request: CopilotPermissionRequest,
  policy: CopilotToolPolicy,
  folders: readonly string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): CopilotPermissionResult {
  if (request.managedApprovalRequired === true) {
    return { kind: 'reject', feedback: COPILOT_MANAGED_APPROVAL_REASON };
  }
  const denied = policy.surface === 'review' ? COPILOT_REVIEW_DENY_REASON : policy.surface === 'analysis' ? COPILOT_ANALYSIS_DENY_REASON : COPILOT_POLICY_DENY_REASON;
  if (request.kind === 'read' && policy.tools.length > 0 && typeof request.path === 'string' && inside(request.path, folders, cwd, platform)) {
    return { kind: 'approve-once' };
  }
  if (request.kind === 'write' && policy.writes && typeof request.fileName === 'string' && inside(request.fileName, folders, cwd, platform)) {
    return { kind: 'approve-once' };
  }
  if (request.kind === 'shell' && policy.shell) {
    return { kind: 'approve-once' };
  }
  return { kind: 'reject', feedback: denied };
}

// --- The environment the runtime gets ----------------------------------------------------

/**
 * Variables that would send the work somewhere other than Copilot under the person's own
 * login: a model provider's key or address (`COPILOT_PROVIDER_*`, the runtime's BYOK route)
 * or a separately issued API credential. They are left out, so nothing falls back to direct
 * or separately billed API use. The values are never read. GitHub's own token variables are
 * documented login routes and stay: the account shown says which one answered.
 */
export function copilotEnvironment(env: Readonly<Record<string, string | undefined>>): {
  readonly env: Record<string, string | undefined>;
  readonly removed: readonly string[];
} {
  const clean: Record<string, string | undefined> = {};
  const removed: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase();
    if (upper.startsWith('COPILOT_PROVIDER_') || upper === 'GITHUB_COPILOT_API_TOKEN' || upper === 'COPILOT_API_URL' || upper === 'OPENAI_API_KEY' || upper === 'ANTHROPIC_API_KEY') {
      removed.push(name);
    } else {
      clean[name] = value;
    }
  }
  return { env: clean, removed };
}

// --- Plain errors ---------------------------------------------------------------------

export function copilotNotSignedInText(machine: string = hostname()): string {
  return `Copilot is not signed in on ${machine}, where this work runs. Run \`npx @github/copilot@1.0.105 login\` there, then try again. Nothing was sent.`;
}

/** One plain sentence for a provider failure; the original stays in the error's cause. */
export function plainCopilotError(message: string, errorType?: string, statusCode?: number): string {
  const text = `${errorType ?? ''} ${message}`.toLowerCase();
  if (text.includes('not authenticated') || statusCode === 401 || text.includes('authentication')) {
    return copilotNotSignedInText();
  }
  if (statusCode === 402 || text.includes('quota') || text.includes('credits') || text.includes('rate limit') || statusCode === 429) {
    return 'Copilot refused the work because the account is out of credits or rate-limited. Details are in Session details.';
  }
  if (statusCode === 403 || text.includes('not entitled') || text.includes('no access') || text.includes('subscription')) {
    return 'This account has no Copilot access for this work. Check the account shown in Session details.';
  }
  return `Copilot reported an error: ${message}`;
}

// --- Loading the SDK ------------------------------------------------------------------

const COPILOT_SDK = '@github/copilot-sdk';

/** The hook files the runtime reads are found by these origins; a repository's are not used. */
const MANAGED_HOOK_ORIGINS: readonly string[] = Object.freeze(['user', 'policy', 'managed']);

async function realClient(env: Readonly<Record<string, string | undefined>>, workingDirectory: string): Promise<CopilotClientLike> {
  let sdk: Record<string, unknown>;
  try {
    sdk = (await import(COPILOT_SDK)) as Record<string, unknown>;
  } catch (error) {
    throw new CopilotAdapterError(`The Copilot SDK is not installed. Run \`npm ci\` in \`app/\` on this machine, then restart DSpatch.`, 'sdk-missing', error);
  }
  const Client = sdk['CopilotClient'] as new (options: unknown) => Record<string, (...args: never[]) => unknown>;
  const client = new Client({ env, workingDirectory, logLevel: 'error', useLoggedInUser: true }) as unknown as CopilotClientLike & {
    readonly rpc: { readonly hooks: { discover(params: unknown): Promise<{ readonly hooks: readonly CopilotHookReading[] }> } };
  };
  client.discoverHooks = async () => (await client.rpc.hooks.discover({})).hooks;
  return client;
}

async function realToolFactory(tool: AppTool): Promise<unknown> {
  const sdk = (await import(COPILOT_SDK)) as { readonly defineTool: (name: string, config: unknown) => unknown };
  const properties = Object.fromEntries(
    Object.entries(tool.parameters).map(([name, parameter]) => [
      name,
      parameter.type === 'string'
        ? { type: 'string', description: parameter.description }
        : { type: 'array', items: { type: 'string' }, description: parameter.description },
    ]),
  );
  const required = Object.entries(tool.parameters)
    .filter(([, parameter]) => parameter.optional !== true)
    .map(([name]) => name);
  return sdk.defineTool(tool.name, {
    description: tool.description,
    parameters: { type: 'object', properties, required },
    skipPermission: true,
    handler: async (args: Readonly<Record<string, unknown>>) => {
      const result = await tool.execute(args);
      return { textResultForLlm: result.text, resultType: result.isError ? 'failure' : 'success' };
    },
  });
}

// --- The adapter ----------------------------------------------------------------------

/** How long a run may take to end after an abort before the runtime is ended. */
const ABORT_GRACE_MS = 8_000;

/** How long the runtime gets to end once it is told to, on top of the grace. */
const FORCE_STOP_BOUND_MS = 4_000;

/** The model a session asks for when no one chose: the runtime's own default. */
export const COPILOT_RUNTIME_DEFAULT_MODEL = 'copilot-default';

const OUTPUT_LIMIT = 64 * 1024;

export interface CopilotSdkAdapterOptions {
  readonly policy: CopilotToolPolicy;
  /** Environment for the runtime, before {@link copilotEnvironment}. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Refuse work unless the runtime reports a pre-tool hook from a user or managed source. */
  readonly requireManagedHooks?: boolean;
  /** A substitute SDK client. Production passes nothing. */
  readonly clientFactory?: CopilotClientFactory;
  readonly toolFactory?: CopilotToolFactory;
  /** A stand-in model for tests of the real runtime. No launch setting reaches this. */
  readonly testProvider?: Readonly<Record<string, unknown>>;
  readonly log?: (message: string) => void;
  readonly clock?: () => Timestamp;
}

interface ActiveRun {
  readonly dspatchRunId: DspatchRunId;
  cancelRequested: boolean;
  /** Set when the runtime aborted; `session.idle` is then the end of the run. */
  error: AdapterError | null;
  readonly calls: Map<string, { readonly name: string; readonly raw: string; readonly startedAt: Timestamp; readonly command: string | null; readonly commandId: string | null }>;
  graceTimer: NodeJS.Timeout | null;
}

interface CopilotSessionState {
  readonly dspatchSessionId: DspatchSessionId;
  config: SessionConfig;
  session: CopilotSessionLike | null;
  readonly listeners: Set<AgentEventListener>;
  run: ActiveRun | null;
  modelReported: string | null;
  readonly usage: UsageReading[];
  readonly eventTypes: Record<string, number>;
  /** The runtime's own work may still be going: no new turn. */
  unconfirmedEnd: boolean;
}

/** The name DSpatch's readers know a tool by; `rawProviderEvent` keeps the runtime's own. */
function toolDisplayName(name: string): string {
  return name === 'view' ? 'Read' : name === 'glob' ? 'Glob' : name === 'grep' ? 'Grep' : name;
}

function readingSubject(name: string, args: unknown): string | undefined {
  if (!COPILOT_READING_TOOLS.includes(name) || typeof args !== 'object' || args === null) {
    return undefined;
  }
  const fields = args as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  if (name === 'view') {
    return text(fields['path']) || undefined;
  }
  const paths = Array.isArray(fields['paths']) ? fields['paths'].filter((entry) => typeof entry === 'string').join(', ') : '';
  const filter = name === 'grep' ? text(fields['glob']) : '';
  return [text(fields['pattern']), filter === '' ? '' : `files ${filter}`, paths === '' ? '' : `in ${paths}`].filter((part) => part !== '').join(' ').slice(0, 300) || undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export class CopilotSdkAdapter implements AgentAdapter {
  readonly id = 'copilot-sdk';

  /** The runtime is a local process DSpatch started. */
  readonly runsLocalProcess = true;

  readonly cancelEndBoundMs = ABORT_GRACE_MS + FORCE_STOP_BOUND_MS;

  private readonly options: CopilotSdkAdapterOptions;

  private readonly policy: CopilotToolPolicy;

  private readonly sessions = new Map<DspatchSessionId, CopilotSessionState>();

  private client: Promise<CopilotClientLike> | null = null;

  private disposed = false;

  private accountLine: string | null = null;

  constructor(options: CopilotSdkAdapterOptions) {
    this.options = options;
    this.policy = options.policy;
  }

  private log(message: string): void {
    this.options.log?.(`[copilot] ${message}`);
  }

  private now(): Timestamp {
    return this.options.clock?.() ?? new Date().toISOString();
  }

  copilotPolicy(): CopilotToolPolicy {
    return this.policy;
  }

  policyDigest(): string {
    return copilotPolicyDigest(this.policy);
  }

  /** The signed-in account and how, once a session has asked. Never a credential. */
  account(): string | null {
    return this.accountLine;
  }

  capabilities(): CapabilityReport {
    return {
      start: 'supported',
      streaming: 'supported',
      cancel: 'supported',
      resume: 'supported',
      modelSelection: 'supported',
      approvals: 'unsupported',
      usageReporting: 'supported',
    };
  }

  /** The running runtime, started on first use. One per adapter. */
  private connect(): Promise<CopilotClientLike> {
    if (this.client === null) {
      const { env, removed } = copilotEnvironment(this.options.env ?? process.env);
      if (removed.length > 0) {
        this.log(`left out of the runtime's environment: ${removed.join(', ')}`);
      }
      const started = (async () => {
        // The process stands outside the sessions' folders: on Windows a process's working
        // folder cannot be removed, and revision folders are written again and removed.
        const client = await (this.options.clientFactory ?? realClient)(env, tmpdir());
        await client.start();
        return client;
      })();
      this.client = started;
      started.catch(() => {
        if (this.client === started) {
          this.client = null;
        }
      });
    }
    return this.client;
  }

  /** The login, and the hooks in force, before anything is sent. Throws a plain sentence. */
  private async ready(client: CopilotClientLike): Promise<void> {
    if (this.options.testProvider !== undefined) {
      return;
    }
    const status = await client.getAuthStatus();
    if (!status.isAuthenticated) {
      throw new CopilotAdapterError(copilotNotSignedInText(), 'not-signed-in');
    }
    this.accountLine = `${status.login ?? 'unknown account'}${status.host === undefined ? '' : ` at ${status.host}`} (${status.authType ?? 'unknown'} login)`;
    this.log(`signed in as ${this.accountLine}`);
    const hooks = (await client.discoverHooks?.()) ?? null;
    if (hooks !== null) {
      const managed = hooks.filter((hook) => hook.enabled && MANAGED_HOOK_ORIGINS.includes(hook.origin));
      this.log(`the runtime reports ${String(managed.length)} user or managed hook(s): ${managed.map((hook) => `${hook.origin}/${hook.hookType}`).join(', ') || 'none'}`);
      if (this.options.requireManagedHooks === true && !managed.some((hook) => hook.hookType === 'preToolUse')) {
        throw new CopilotAdapterError(
          'This host requires managed Copilot hooks, and the runtime reports no pre-tool hook from a user or managed source, so nothing was sent. Install them on this machine, or start the host without the requirement for synthetic material.',
          'managed-hooks-missing',
        );
      }
    } else if (this.options.requireManagedHooks === true) {
      throw new CopilotAdapterError('This host requires managed Copilot hooks, and it could not be established that they are in force, so nothing was sent.', 'managed-hooks-unknown');
    }
  }

  async listModels(): Promise<readonly ModelInfo[]> {
    const client = await this.connect();
    const status = this.options.testProvider === undefined ? await client.getAuthStatus() : { isAuthenticated: true };
    if (!status.isAuthenticated) {
      throw new CopilotAdapterError(copilotNotSignedInText(), 'not-signed-in');
    }
    const entries = await client.listModels();
    return [
      { id: COPILOT_RUNTIME_DEFAULT_MODEL, displayName: "Copilot's default", provider: 'copilot' as const },
      ...entries
        .filter((entry) => entry.policy?.state !== 'disabled')
        .map((entry) => ({ id: entry.id, displayName: entry.name, provider: 'copilot' as const })),
    ];
  }

  private folders(config: SessionConfig): readonly string[] {
    return config.workspacePaths !== undefined && config.workspacePaths.length > 0 ? config.workspacePaths : [config.workspacePath];
  }

  private async sessionOptions(state: CopilotSessionState, starting: boolean): Promise<CopilotSessionOptions> {
    const config = state.config;
    const conversation = config.toolScope === 'conversation';
    const extra = this.folders(config).slice(1);
    const appTools = this.policy.surface === 'chat' ? (config.appTools ?? []) : [];
    const factory = this.options.toolFactory ?? realToolFactory;
    const tools = await Promise.all(appTools.map((tool) => factory(tool)));
    const builtIn = conversation ? [] : this.policy.tools;
    return {
      clientName: 'DSpatch',
      ...(starting ? { sessionId: state.dspatchSessionId } : {}),
      ...(config.modelRequested === COPILOT_RUNTIME_DEFAULT_MODEL || config.modelRequested === '' ? {} : { model: config.modelRequested }),
      streaming: true,
      workingDirectory: config.workspacePath,
      ...(extra.length > 0 ? { additionalDirectories: extra } : {}),
      availableTools: [...builtIn.map((tool) => `builtin:${tool}`), ...appTools.map((tool) => `custom:${tool.name}`)],
      ...(tools.length > 0 ? { tools } : {}),
      onPermissionRequest: (request) => this.permission(state, request),
      hooks: { onPreToolUse: (input) => this.preToolUse(state, input) },
      onEvent: (event) => {
        this.onProviderEvent(state, event);
      },
      enableConfigDiscovery: false,
      enableFileHooks: false,
      enableSkills: false,
      enableSessionStore: false,
      enableHostGitOperations: this.policy.surface === 'chat',
      skipCustomInstructions: true,
      skipEmbeddingRetrieval: true,
      embeddingCacheStorage: 'in-memory',
      memory: { enabled: false },
      ...(starting ? { trustWorkingDirectory: 'session' as const } : {}),
      ...(this.options.testProvider === undefined ? {} : { provider: this.options.testProvider }),
    };
  }

  private permission(state: CopilotSessionState, request: CopilotPermissionRequest): CopilotPermissionResult {
    const answer = copilotPermission(request, this.policy, this.folders(state.config), state.config.workspacePath);
    if (answer.kind === 'reject') {
      this.log(`refused a ${request.kind} request`);
    }
    return answer;
  }

  private preToolUse(state: CopilotSessionState, input: CopilotPreToolInput): { permissionDecision: 'deny'; permissionDecisionReason: string } | undefined {
    if (state.run?.cancelRequested === true) {
      return { permissionDecision: 'deny', permissionDecisionReason: 'The person stopped this turn.' };
    }
    if (this.policy.surface === 'review') {
      return { permissionDecision: 'deny', permissionDecisionReason: COPILOT_REVIEW_DENY_REASON };
    }
    if (this.policy.surface === 'analysis') {
      return copilotReadAllowed(input.toolName, input.toolArgs, this.folders(state.config), state.config.workspacePath)
        ? undefined
        : { permissionDecision: 'deny', permissionDecisionReason: COPILOT_ANALYSIS_DENY_REASON };
    }
    if (COPILOT_READING_TOOLS.includes(input.toolName) && !copilotReadAllowed(input.toolName, input.toolArgs, this.folders(state.config), state.config.workspacePath)) {
      return { permissionDecision: 'deny', permissionDecisionReason: COPILOT_POLICY_DENY_REASON };
    }
    return undefined;
  }

  private emit(state: CopilotSessionState, event: AgentEvent): void {
    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.log(`a listener threw: ${String(error)}`);
      }
    }
  }

  private finish(state: CopilotSessionState, status: TerminalRunStatus, raw: unknown, end?: RunEnd): void {
    const run = state.run;
    if (run === null) {
      return;
    }
    if (run.graceTimer !== null) {
      clearTimeout(run.graceTimer);
    }
    const at = this.now();
    for (const [toolCallId, call] of run.calls) {
      if (call.commandId !== null) {
        this.emit(state, {
          type: 'command.finished',
          dspatchSessionId: state.dspatchSessionId,
          dspatchRunId: run.dspatchRunId,
          at,
          rawProviderEvent: null,
          toolCallId,
          command: this.commandRecord(state, call, at, status === 'cancelled' ? 'stopped' : 'not-reported', null, ''),
        });
      }
    }
    run.calls.clear();
    state.run = null;
    this.emit(state, {
      type: 'run.finished',
      dspatchSessionId: state.dspatchSessionId,
      dspatchRunId: run.dspatchRunId,
      at,
      rawProviderEvent: raw,
      status,
      ...(run.error === null ? {} : { error: run.error }),
      ...(end === undefined ? {} : { end }),
    });
  }

  private commandRecord(
    state: CopilotSessionState,
    call: { readonly raw: string; readonly startedAt: Timestamp; readonly command: string | null; readonly commandId: string | null },
    finishedAt: Timestamp,
    ending: AgentCommandRecord['ending'],
    exitCode: number | null,
    output: string,
  ): AgentCommandRecord {
    const truncated = output.length > OUTPUT_LIMIT;
    return {
      commandId: call.commandId ?? randomUUID(),
      requestedBy: 'provider-reported',
      line: call.command ?? '',
      shell: call.raw,
      cwd: state.config.workspacePath,
      pid: null,
      startedAtUtc: call.startedAt,
      finishedAtUtc: finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(call.startedAt)),
      timeoutMs: null,
      ending,
      endingMessage: ending === 'exited' ? null : ending === 'stopped' ? 'The run was stopped; whether the command ended is not established.' : 'Copilot reported no end for this command.',
      exitCode,
      signal: null,
      killedByDspatch: false,
      stdout: truncated ? output.slice(0, OUTPUT_LIMIT) : output,
      stderr: '',
      outputTruncated: truncated,
      outputNote: truncated ? `Output cut to ${String(OUTPUT_LIMIT)} characters.` : null,
      testedSnapshotId: null,
      afterRunSnapshotId: null,
      snapshotRoots: [],
    };
  }

  /** The runtime's events, in DSpatch's vocabulary. Sub-agent events never arise: `task` is off. */
  private onProviderEvent(state: CopilotSessionState, event: CopilotEvent): void {
    state.eventTypes[event.type] = (state.eventTypes[event.type] ?? 0) + 1;
    const data = record(event.data);
    if (event.type === 'session.model_change' && typeof data['newModel'] === 'string') {
      state.modelReported = data['newModel'];
    }
    const run = state.run;
    if (run === null) {
      return;
    }
    const base = { dspatchSessionId: state.dspatchSessionId, dspatchRunId: run.dspatchRunId, at: this.now(), rawProviderEvent: event };
    switch (event.type) {
      case 'assistant.message_delta':
        if (typeof data['deltaContent'] === 'string') {
          this.emit(state, { ...base, type: 'assistant.delta', text: data['deltaContent'] });
        }
        return;
      case 'assistant.reasoning_delta':
        if (typeof data['deltaContent'] === 'string') {
          this.emit(state, { ...base, type: 'reasoning.delta', text: data['deltaContent'] });
        }
        return;
      case 'assistant.message':
        if (typeof data['content'] === 'string' && data['content'] !== '') {
          this.emit(state, { ...base, type: 'assistant.message', text: data['content'] });
        }
        return;
      case 'tool.execution_start': {
        const toolCallId = typeof data['toolCallId'] === 'string' ? data['toolCallId'] : randomUUID();
        const raw = typeof data['toolName'] === 'string' ? data['toolName'] : 'unknown';
        const args = data['arguments'];
        const isShell = COPILOT_SHELL_TOOLS.includes(raw);
        const line = isShell && typeof record(args)['command'] === 'string' ? (record(args)['command'] as string) : null;
        const commandId = line === null ? null : randomUUID();
        run.calls.set(toolCallId, { name: toolDisplayName(raw), raw, startedAt: base.at, command: line, commandId });
        const subject = readingSubject(raw, args);
        this.emit(state, { ...base, type: 'tool.started', toolCallId, name: toolDisplayName(raw), ...(subject === undefined ? {} : { subject }) });
        if (line !== null && commandId !== null) {
          this.emit(state, { ...base, type: 'command.started', toolCallId, commandId, line, cwd: state.config.workspacePath });
        }
        return;
      }
      case 'tool.execution_complete': {
        const toolCallId = typeof data['toolCallId'] === 'string' ? data['toolCallId'] : '';
        const call = run.calls.get(toolCallId);
        run.calls.delete(toolCallId);
        const name = call?.name ?? 'unknown';
        this.emit(state, { ...base, type: 'tool.finished', toolCallId, name, status: data['success'] === true ? 'ok' : 'error' });
        if (call?.commandId !== undefined && call.commandId !== null) {
          const shell = record(data['shellExecution']);
          const exitCode = typeof shell['exitCode'] === 'number' ? shell['exitCode'] : null;
          const content = record(data['result'])['content'];
          this.emit(state, {
            ...base,
            type: 'command.finished',
            toolCallId,
            command: this.commandRecord(state, call, base.at, exitCode === null ? 'not-reported' : 'exited', exitCode, typeof content === 'string' ? content : ''),
          });
        }
        return;
      }
      case 'assistant.usage': {
        if (typeof data['model'] === 'string') {
          state.modelReported = data['model'];
        }
        const reading = (value: unknown): UsageReading => ({
          provider: 'copilot',
          unit: 'tokens',
          scope: 'call',
          value: typeof value === 'number' ? value : null,
          source: 'assistant.usage',
          observedAt: base.at,
        });
        const readings = [reading(data['inputTokens']), reading(data['outputTokens'])];
        state.usage.push(...readings);
        this.emit(state, { ...base, type: 'usage', readings });
        return;
      }
      case 'session.error': {
        const message = typeof data['message'] === 'string' ? data['message'] : 'Copilot reported an error.';
        const statusCode = typeof data['statusCode'] === 'number' ? data['statusCode'] : undefined;
        const errorType = typeof data['errorType'] === 'string' ? data['errorType'] : undefined;
        run.error = { message: plainCopilotError(message, errorType, statusCode), providerCode: errorType ?? 'session.error' };
        // The runtime goes idle after an error, which ends the run; an abort ends it as cancelled.
        return;
      }
      case 'session.idle':
        if (run.cancelRequested) {
          this.finish(state, 'cancelled', event, 'stopped');
        } else {
          this.finish(state, run.error === null ? 'finished' : 'error', event);
        }
        return;
      default:
        return;
    }
  }

  private newState(config: SessionConfig, dspatchSessionId: DspatchSessionId): CopilotSessionState {
    const state: CopilotSessionState = {
      dspatchSessionId,
      config,
      session: null,
      listeners: new Set(),
      run: null,
      modelReported: null,
      usage: [],
      eventTypes: {},
      unconfirmedEnd: false,
    };
    this.sessions.set(dspatchSessionId, state);
    return state;
  }

  private refuseIfDisposed(): void {
    if (this.disposed) {
      throw new CopilotAdapterError('This Copilot connection has been closed.', 'disposed');
    }
  }

  async startSession(config: SessionConfig): Promise<SessionHandle> {
    this.refuseIfDisposed();
    const dspatchSessionId = config.dspatchSessionId ?? randomUUID();
    const client = await this.connect();
    await this.ready(client);
    const state = this.newState(config, dspatchSessionId);
    try {
      state.session = await client.createSession(await this.sessionOptions(state, true));
    } catch (error) {
      this.sessions.delete(dspatchSessionId);
      throw new CopilotAdapterError(plainCopilotError(error instanceof Error ? error.message : String(error)), 'session-start', error);
    }
    return { dspatchSessionId, provider: 'copilot', providerSessionId: state.session.sessionId, createdAt: this.now() };
  }

  /**
   * The runtime keeps a session's history under the person's `~/.copilot`, so a session
   * started on this host can be taken up again. Everything DSpatch configures is given again;
   * a session recorded under another policy is not continued, and a runtime that does not know
   * the session answers an error, on which DSpatch continues in a new session and says so.
   */
  async resume(sessionId: DspatchSessionId, config: SessionConfig): Promise<SessionHandle> {
    this.refuseIfDisposed();
    if (config.expectedToolPolicy !== undefined && config.expectedToolPolicy !== this.policyDigest()) {
      throw new CopilotAdapterError(
        `This session was recorded under the tool policy ${config.expectedToolPolicy}, and this connection's is ${this.policyDigest()}, so it is not continued under other rules. Start a new session.`,
        'policy-changed',
      );
    }
    const client = await this.connect();
    await this.ready(client);
    const state = this.newState(config, sessionId);
    try {
      state.session = await client.resumeSession(sessionId, await this.sessionOptions(state, false));
    } catch (error) {
      this.sessions.delete(sessionId);
      throw new CopilotAdapterError(`Copilot could not resume this session: ${error instanceof Error ? error.message : String(error)}`, 'resume', error);
    }
    return { dspatchSessionId: sessionId, provider: 'copilot', providerSessionId: state.session.sessionId, createdAt: this.now(), resumeEvidence: 'provider-answered' };
  }

  private state(sessionId: DspatchSessionId): CopilotSessionState {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      throw new CopilotAdapterError(`No Copilot session ${sessionId}.`, 'unknown-session');
    }
    return state;
  }

  subscribe(sessionId: DspatchSessionId, onEvent: AgentEventListener): Unsubscribe {
    const state = this.state(sessionId);
    state.listeners.add(onEvent);
    return () => {
      state.listeners.delete(onEvent);
    };
  }

  async send(sessionId: DspatchSessionId, prompt: string): Promise<RunReference> {
    const state = this.state(sessionId);
    if (state.run !== null) {
      throw new CopilotAdapterError('This session already has an active run.', 'busy');
    }
    if (state.unconfirmedEnd) {
      throw new CopilotAdapterError('The last stop of this session was not confirmed, so no new turn is started on it. Start a new session.', 'unconfirmed-end');
    }
    const session = state.session;
    if (session === null) {
      throw new CopilotAdapterError('The session has no connection to Copilot.', 'no-session');
    }
    const dspatchRunId = randomUUID();
    state.run = { dspatchRunId, cancelRequested: false, error: null, calls: new Map(), graceTimer: null };
    this.emit(state, { type: 'run.started', dspatchSessionId: sessionId, dspatchRunId, at: this.now(), rawProviderEvent: null });
    try {
      await session.send({ prompt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const run = state.run as ActiveRun | null;
      if (run !== null) {
        run.error = { message: plainCopilotError(message), providerCode: 'send' };
        this.finish(state, 'error', null);
      }
    }
    return { dspatchRunId };
  }

  /**
   * `session.abort()`, then the runtime's `session.idle` is the evidence the turn ended. If
   * that does not come within {@link ABORT_GRACE_MS} the runtime process is ended, and a
   * returned `forceStop` is the evidence; without it the end stays unconfirmed.
   */
  async cancel(sessionId: DspatchSessionId): Promise<void> {
    const state = this.state(sessionId);
    const run = state.run;
    if (run === null || run.cancelRequested) {
      return;
    }
    run.cancelRequested = true;
    this.emit(state, { type: 'run.cancel_requested', dspatchSessionId: sessionId, dspatchRunId: run.dspatchRunId, at: this.now(), rawProviderEvent: null });
    try {
      await state.session?.abort();
    } catch (error) {
      this.log(`abort failed: ${String(error)}`);
    }
    if (state.run !== run) {
      return;
    }
    run.graceTimer = setTimeout(() => {
      void this.escalate(state, run);
    }, ABORT_GRACE_MS);
    run.graceTimer.unref();
  }

  private async escalate(state: CopilotSessionState, run: ActiveRun): Promise<void> {
    if (state.run !== run) {
      return;
    }
    this.log('the runtime did not go idle after an abort; ending it');
    const client = this.client;
    let ended = false;
    try {
      const running = client === null ? null : await client;
      await Promise.race([
        running?.forceStop().then(() => {
          ended = true;
        }),
        new Promise((resolve) => setTimeout(resolve, FORCE_STOP_BOUND_MS).unref()),
      ]);
    } catch (error) {
      this.log(`ending the runtime failed: ${String(error)}`);
    }
    if (state.run !== run) {
      return;
    }
    this.client = null;
    state.session = null;
    if (!ended) {
      state.unconfirmedEnd = true;
    }
    this.finish(state, 'cancelled', null, ended ? 'forced' : 'unconfirmed');
  }

  setSessionModel(sessionId: DspatchSessionId, modelId: string): void {
    const state = this.sessions.get(sessionId);
    if (state !== undefined) {
      state.config = { ...state.config, modelRequested: modelId };
    }
  }

  hasActiveRun(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.run !== null && this.sessions.has(sessionId);
  }

  providerMessageTypes(sessionId: string): Record<string, number> {
    return { ...(this.sessions.get(sessionId)?.eventTypes ?? {}) };
  }

  streamPumpFinished(sessionId: string): boolean | null {
    const state = this.sessions.get(sessionId);
    return state === undefined ? null : state.run === null;
  }

  modelReported(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.modelReported ?? null;
  }

  readUsage(scope: UsageQuery): Promise<readonly UsageReading[]> {
    if (scope.of === 'session') {
      return Promise.resolve([...(this.sessions.get(scope.dspatchSessionId)?.usage ?? [])]);
    }
    return Promise.resolve([]);
  }

  respondToApproval(_requestId: string, _decision: ApprovalDecision): Promise<void> {
    return Promise.reject(new CopilotAdapterError('DSpatch answers Copilot permission requests from the session policy, not by asking.', 'unsupported'));
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const state of this.sessions.values()) {
      if (state.run !== null) {
        state.run.cancelRequested = true;
        this.finish(state, 'cancelled', null, 'unconfirmed');
      }
      await state.session?.disconnect().catch(() => undefined);
    }
    const client = this.client;
    this.client = null;
    if (client !== null) {
      try {
        const running = await client;
        const stopped = await Promise.race([
          running.stop().then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FORCE_STOP_BOUND_MS).unref()),
        ]);
        if (!stopped) {
          await running.forceStop().catch(() => undefined);
        }
      } catch {
        // The runtime never started, or is already gone.
      }
    }
  }
}

/** Whether this machine has the platform package holding Copilot's runtime. Asks nobody. */
export function copilotRuntimeInstalled(
  resolve: (id: string) => string = createRequire(typeof __filename === 'string' ? __filename : path.join(process.cwd(), 'package.json')).resolve,
): boolean {
  const libcSuffix = process.platform === 'linux' && (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header?.glibcVersionRuntime === undefined ? 'musl' : '';
  const name = `@github/copilot-sdk-${process.platform === 'linux' ? `linux${libcSuffix}` : process.platform}-${process.arch}/package.json`;
  try {
    resolve(name);
    return true;
  } catch {
    return false;
  }
}
