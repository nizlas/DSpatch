import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import type { AgentAdapter } from './agent-adapter';
import { endProcessTree } from './copilot-process-tree';
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
  readonly toolCallId?: string;
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
  onPostToolUse(input: CopilotPreToolInput): { readonly modifiedResult: { readonly textResultForLlm: string; readonly resultType: 'failure' } } | undefined;
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
  /** Asked while a run is active: a runtime that died says nothing by itself. */
  ping(): Promise<unknown>;
  stop(): Promise<readonly Error[]>;
  forceStop(): Promise<void>;
  getAuthStatus(): Promise<CopilotAuthStatus>;
  getStatus(): Promise<{ readonly version: string; readonly protocolVersion: number }>;
  listModels(): Promise<readonly CopilotModelEntry[]>;
  createSession(config: CopilotSessionOptions): Promise<CopilotSessionLike>;
  resumeSession(sessionId: string, config: CopilotSessionOptions): Promise<CopilotSessionLike>;
  /** The hook files the runtime found, for the session's record. Absent on a substitute. */
  discoverHooks?(): Promise<readonly CopilotHookReading[]>;
  /** The runtime's process, whose tree is ended with it. Absent on a substitute. */
  processId?(): number | null;
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

/** To the model, for a call stopped because a hook could not answer. */
export const COPILOT_CONTROL_FAILED_REASON = 'A content control on this machine could not answer, so this call was not run and its result is not available.';

/**
 * To the model, for the one call whose `preToolUse` hook failed or timed out. Only that call is
 * refused; the turn goes on, so the model is told it may try a smaller call.
 */
export const COPILOT_CALL_CONTROL_FAILED_REASON =
  'A content control on this machine could not answer for this call (it failed or timed out), so this call was not run and its result is not available. Other calls are not affected; a shorter command or a smaller request may pass.';

/**
 * To the person, when a `preToolUse` hook failed or timed out and DSpatch could not tell which
 * call it was for: then nothing more of the turn runs.
 */
export const COPILOT_PRE_CONTROL_FAILED_TEXT =
  'A content control on this machine could not answer, so the tool call was not run and this turn was stopped. Check the hook script, then try again. The host log names it.';

/** To the person, when a `postToolUse` hook failed: the runtime has passed the result on by then. */
export const COPILOT_POST_CONTROL_FAILED_TEXT =
  'A content control failed after a tool had run, so this turn was stopped. That tool result may already have reached the model. Check the hook script before going on. The host log names it.';

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
  return !path.isAbsolute(pattern) && !/^[a-zA-Z]:/.test(pattern) && !pattern.includes('..');
}

const READING_FIELDS: Readonly<Record<string, readonly string[]>> = {
  view: ['path', 'view_range', 'forceReadLargeFiles'],
  glob: ['pattern', 'paths'],
  grep: ['pattern', 'paths', 'output_mode', 'glob', 'type', '-i', '-A', '-B', '-C', '-n', 'head_limit', 'multiline'],
};

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
  // A field this check does not know could name a place it does not look at.
  if (Object.keys(fields).some((name) => !READING_FIELDS[toolName]?.includes(name))) {
    return false;
  }
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

/** The file in a host's data folder that requires hooks, for a host started without a person's variables. */
export const COPILOT_HOOKS_REQUIRED_FILE = 'copilot-hooks-required';

/**
 * Whether this host requires hooks. Anything of that name counts, whatever it holds, and so
 * does a folder that cannot be looked in: only a certain absence lets work go on without them.
 */
export function copilotHooksRequired(dataDir: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env['DSPATCH_COPILOT_REQUIRE_HOOKS'] === '1') {
    return true;
  }
  try {
    fs.lstatSync(path.join(dataDir, COPILOT_HOOKS_REQUIRED_FILE));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

// --- Plain errors ---------------------------------------------------------------------

export function copilotNotSignedInText(machine: string = hostname()): string {
  return `Copilot is not signed in on ${machine}, where this work runs. Nothing was sent.`;
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
    /** Private in the SDK, which offers no other way to the process (1.0.28). */
    readonly cliProcess?: { readonly pid?: number } | null;
  };
  client.discoverHooks = async () => (await client.rpc.hooks.discover({})).hooks;
  client.processId = () => client.cliProcess?.pid ?? null;
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

/**
 * How long a DSpatch tool waits for the end of a `preToolUse` hook that answers for its call, when
 * the runtime calls the tool before that end has reached DSpatch. Past it the call is refused.
 */
const PRE_HOOK_SETTLE_MS = 2_000;

/** How long the runtime gets to end once it is told to, on top of the grace. */
const FORCE_STOP_BOUND_MS = 4_000;

/** The model a session asks for when no one chose: the runtime's own default. */
export const COPILOT_RUNTIME_DEFAULT_MODEL = 'copilot-default';

const OUTPUT_LIMIT = 64 * 1024;

/** How often a runtime with work is asked, and how long it may take to answer. */
const RUNTIME_CHECK_MS = 10_000;

export interface CopilotSdkAdapterOptions {
  readonly policy: CopilotToolPolicy;
  /** Environment for the runtime, before {@link copilotEnvironment}. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Refuse work unless the runtime reports a pre-tool hook from a user or managed source. Asked
   * at each session start and resume, so a changed requirement needs no restart.
   */
  readonly requireManagedHooks?: boolean | (() => boolean);
  /** A substitute SDK client. Production passes nothing. */
  readonly clientFactory?: CopilotClientFactory;
  readonly toolFactory?: CopilotToolFactory;
  /** How often a runtime with work is asked. A test seam. */
  readonly runtimeCheckMs?: number;
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
  /** A `postToolUse` hook failed, or a `preToolUse` one for no known call: nothing more of this turn runs or is returned. */
  controlFailed: boolean;
  /** The tool calls each running `preToolUse` hook invocation answers for, by invocation id. */
  readonly preHookCalls: Map<string, readonly { readonly id: string; readonly key: string }[]>;
  /**
   * Calls whose `preToolUse` hook failed or timed out, by tool call id, with their name and
   * arguments as a key: the runtime would run them, so DSpatch refuses each at its permission
   * request and replaces its result. Only these calls; the turn goes on.
   */
  readonly refusedCalls: Map<string, string>;
  readonly calls: Map<string, { readonly name: string; readonly raw: string; readonly startedAt: Timestamp; readonly command: string | null; readonly commandId: string | null }>;
  graceTimer: NodeJS.Timeout | null;
}

interface CopilotSessionState {
  readonly dspatchSessionId: DspatchSessionId;
  config: SessionConfig;
  session: CopilotSessionLike | null;
  /** The session's own runtime: ending it touches no other session. */
  runtime: CopilotClientLike | null;
  pingFailures: number;
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

  /** The runtime that lists models; it holds no session. */
  private catalogue: Promise<CopilotClientLike> | null = null;

  /** Every runtime started and not yet ended. */
  private readonly runtimes = new Set<Promise<CopilotClientLike>>();

  private disposed = false;

  private watch: NodeJS.Timeout | null = null;

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

  /**
   * A new runtime process. Each session has its own, because a hook that does not end can be
   * stopped only by ending the runtime (`session.abort()` waits for it): a stop must not reach
   * another session's work. One costs about 25 MB of its own and 70 ms (runtime 1.0.105, Linux).
   */
  private startRuntime(): Promise<CopilotClientLike> {
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
    this.runtimes.add(started);
    started.catch(() => {
      this.runtimes.delete(started);
    });
    return started;
  }

  private forgetRuntime(client: CopilotClientLike): void {
    for (const started of this.runtimes) {
      void started.then(
        (running) => {
          if (running === client) {
            this.runtimes.delete(started);
          }
        },
        () => undefined,
      );
    }
  }

  /** Ends a runtime and what it started. Throws what `forceStop` threw. */
  private async endRuntime(client: CopilotClientLike): Promise<void> {
    this.forgetRuntime(client);
    const forceStop = (): Promise<void> => client.forceStop();
    const pid = client.processId?.() ?? null;
    if (pid === null) {
      await forceStop();
      return;
    }
    const ended = await endProcessTree(pid, forceStop);
    this.log(`ended the runtime${ended === null ? ' and its process tree' : ` and ${String(ended)} process(es) under it`}`);
  }

  private catalogueRuntime(): Promise<CopilotClientLike> {
    if (this.catalogue === null) {
      const started = this.startRuntime();
      this.catalogue = started;
      started.catch(() => {
        if (this.catalogue === started) {
          this.catalogue = null;
        }
      });
    }
    return this.catalogue;
  }

  /** The login, and the hooks in force, before anything is sent. Throws a plain sentence. */
  private async ready(client: CopilotClientLike): Promise<void> {
    const required = typeof this.options.requireManagedHooks === 'function' ? this.options.requireManagedHooks() : this.options.requireManagedHooks === true;
    const hooks = (await client.discoverHooks?.()) ?? null;
    if (hooks !== null) {
      const managed = hooks.filter((hook) => hook.enabled && MANAGED_HOOK_ORIGINS.includes(hook.origin));
      this.log(`the runtime reports ${String(managed.length)} user or managed hook(s): ${managed.map((hook) => `${hook.origin}/${hook.hookType}`).join(', ') || 'none'}`);
      if (required && !managed.some((hook) => hook.hookType === 'preToolUse')) {
        throw new CopilotAdapterError(
          'This host requires managed Copilot hooks, and the runtime reports no pre-tool hook from a user or managed source, so nothing was sent. Install them on this machine, or start the host without the requirement for synthetic material.',
          'managed-hooks-missing',
        );
      }
    } else if (required) {
      throw new CopilotAdapterError('This host requires managed Copilot hooks, and it could not be established that they are in force, so nothing was sent.', 'managed-hooks-unknown');
    }
    if (this.options.testProvider === undefined) {
      const status = await client.getAuthStatus();
      if (!status.isAuthenticated) {
        throw new CopilotAdapterError(copilotNotSignedInText(), 'not-signed-in');
      }
      this.accountLine = `${status.login ?? 'unknown account'}${status.host === undefined ? '' : ` at ${status.host}`} (${status.authType ?? 'unknown'} login)`;
      this.log(`signed in as ${this.accountLine}`);
    }
  }

  /** The model the runtime said it selected when none was named, once a session has told. */
  private defaultSelected: string | null = null;

  async listModels(): Promise<readonly ModelInfo[]> {
    const client = await this.catalogueRuntime();
    const status = this.options.testProvider === undefined ? await client.getAuthStatus() : { isAuthenticated: true };
    if (!status.isAuthenticated) {
      throw new CopilotAdapterError(copilotNotSignedInText(), 'not-signed-in');
    }
    const entries = await client.listModels();
    return [
      // The catalogue marks no default, so this says what it means only once a session has.
      {
        id: COPILOT_RUNTIME_DEFAULT_MODEL,
        displayName: 'Default',
        provider: 'copilot' as const,
        providerDefault: true as const,
        ...(this.defaultSelected === null ? {} : { resolvedId: this.defaultSelected }),
      },
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
    const tools = await Promise.all(appTools.map((tool) => factory(this.guarded(state, tool))));
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
      hooks: { onPreToolUse: (input) => this.preToolUse(state, input), onPostToolUse: (input) => this.postToolUse(state, input) },
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

  /**
   * The point where a failed `preToolUse` hook is stopped. The runtime lets a call through
   * after a hook timeout, but it asks this after `hook.end` and before the tool runs; its
   * order, with the real runtime, is in `tests/copilot-hooks.test.ts`.
   */
  private permission(state: CopilotSessionState, request: CopilotPermissionRequest): CopilotPermissionResult {
    if (state.run?.controlFailed === true) {
      return { kind: 'reject', feedback: COPILOT_CONTROL_FAILED_REASON };
    }
    const refused = state.run?.refusedCalls;
    // A request that names no call is refused while any refused call is open: it may be that one.
    if (refused !== undefined && (request.toolCallId === undefined ? refused.size > 0 : refused.has(request.toolCallId))) {
      return { kind: 'reject', feedback: COPILOT_CALL_CONTROL_FAILED_REASON };
    }
    if (state.run?.cancelRequested === true) {
      return { kind: 'reject', feedback: 'The person stopped this turn.' };
    }
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
    if (state.run?.controlFailed === true) {
      return { permissionDecision: 'deny', permissionDecisionReason: COPILOT_CONTROL_FAILED_REASON };
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

  /**
   * DSpatch's own tool, run only when nothing refused its call. These tools ask no permission, so
   * the runtime would run them after a failed hook; refusing here, before `execute`, is what keeps
   * a refused call from doing anything. Holding back its result afterwards would leave a workspace
   * created or a folder added.
   */
  private guarded(state: CopilotSessionState, tool: AppTool): AppTool {
    return {
      ...tool,
      execute: async (args) => {
        const refusal = await this.toolRefusal(state, callKey(tool.name, args));
        if (refusal !== null) {
          this.log(`a ${tool.name} call was refused before it ran`);
          return { text: refusal, isError: true };
        }
        return tool.execute(args);
      },
    };
  }

  private async toolRefusal(state: CopilotSessionState, key: string): Promise<string | null> {
    const pending = (): boolean => [...(state.run?.preHookCalls.values() ?? [])].some((calls) => calls.some((call) => call.key === key));
    // The runtime calls the tool after its hooks have ended; their end may still be on its way here.
    const settles = Date.now() + PRE_HOOK_SETTLE_MS;
    while (pending() && Date.now() < settles) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const run = state.run;
    if (run === null) {
      return null;
    }
    if (run.controlFailed) {
      return COPILOT_CONTROL_FAILED_REASON;
    }
    if (run.cancelRequested) {
      return 'The person stopped this turn.';
    }
    // A hook that has not answered for this call by now counts as one that failed.
    return [...run.refusedCalls.values()].includes(key) || pending() ? COPILOT_CALL_CONTROL_FAILED_REASON : null;
  }

  /** Holds back the result of a call that asks no permission, should one have run regardless. */
  private postToolUse(state: CopilotSessionState, input: CopilotPreToolInput): { modifiedResult: { textResultForLlm: string; resultType: 'failure' } } | undefined {
    if (state.run?.controlFailed === true) {
      return { modifiedResult: { textResultForLlm: COPILOT_CONTROL_FAILED_REASON, resultType: 'failure' } };
    }
    // DSpatch's own tools are refused before they run (`guarded`); this holds back the result of
    // any call that still ran, so nothing refused reaches the model either way.
    const key = callKey(input.toolName, input.toolArgs);
    return [...(state.run?.refusedCalls.values() ?? [])].includes(key)
      ? { modifiedResult: { textResultForLlm: COPILOT_CALL_CONTROL_FAILED_REASON, resultType: 'failure' } }
      : undefined;
  }

  /**
   * A `preToolUse` hook failed or timed out. The runtime would run the call anyway, so DSpatch
   * refuses just that call (DSP-163 follow-up); the turn goes on. When the hook's calls are not
   * known, the whole turn stops as before.
   */
  private preControlFailed(state: CopilotSessionState, run: ActiveRun, invocationId: string, error: Record<string, unknown>): void {
    const calls = run.preHookCalls.get(invocationId) ?? [];
    run.preHookCalls.delete(invocationId);
    if (calls.length === 0) {
      this.controlFailed(state, run, 'preToolUse', error);
      return;
    }
    const message = typeof error['message'] === 'string' ? error['message'] : '';
    const source = typeof error['source'] === 'string' ? ` from ${error['source']}` : '';
    for (const call of calls) {
      run.refusedCalls.set(call.id, call.key);
    }
    this.log(`a preToolUse hook${source} ${message.includes('timed out') ? 'timed out' : 'failed'}; ${String(calls.length)} call${calls.length === 1 ? ' is' : 's are'} refused and the turn goes on`);
  }

  /**
   * A tool hook that errored or timed out ends the turn. Which script, and why, goes to the
   * log; its message can hold the command line, so the person's sentence does not quote it.
   */
  private controlFailed(state: CopilotSessionState, run: ActiveRun, hookType: string, error: Record<string, unknown>): void {
    const message = typeof error['message'] === 'string' ? error['message'] : '';
    const source = typeof error['source'] === 'string' ? ` from ${error['source']}` : '';
    this.log(`a ${hookType} hook${source} ${message.includes('timed out') ? 'timed out' : 'failed'}; the turn is stopped`);
    if (run.controlFailed) {
      return;
    }
    run.controlFailed = true;
    run.error = { message: hookType === 'preToolUse' ? COPILOT_PRE_CONTROL_FAILED_TEXT : COPILOT_POST_CONTROL_FAILED_TEXT, providerCode: 'control-failed' };
    void state.session?.abort().catch((caught: unknown) => {
      this.log(`stopping the turn after a failed hook did not succeed: ${String(caught)}`);
    });
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
    // What the runtime selected for a session that named no model: its own word for the default.
    if (
      (event.type === 'session.start' || event.type === 'session.resume') &&
      typeof data['selectedModel'] === 'string' &&
      (state.config.modelRequested === COPILOT_RUNTIME_DEFAULT_MODEL || state.config.modelRequested === '')
    ) {
      this.defaultSelected = data['selectedModel'];
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
      case 'hook.start':
        if (data['hookType'] === 'preToolUse' && typeof data['hookInvocationId'] === 'string') {
          const listed = record(data['input'])['toolCalls'];
          const calls = (Array.isArray(listed) ? listed : []).map(record).filter((call) => typeof call['id'] === 'string' && typeof call['name'] === 'string');
          run.preHookCalls.set(
            data['hookInvocationId'],
            calls.map((call) => ({ id: call['id'] as string, key: callKey(call['name'] as string, call['args']) })),
          );
        }
        return;
      case 'hook.end':
        if (data['hookType'] === 'preToolUse' && typeof data['hookInvocationId'] === 'string' && data['success'] !== false) {
          run.preHookCalls.delete(data['hookInvocationId']);
        }
        if (data['success'] === false && data['hookType'] === 'preToolUse') {
          this.preControlFailed(state, run, typeof data['hookInvocationId'] === 'string' ? data['hookInvocationId'] : '', record(data['error']));
        } else if (data['success'] === false && data['hookType'] === 'postToolUse') {
          this.controlFailed(state, run, data['hookType'], record(data['error']));
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
        run.refusedCalls.delete(toolCallId);
        const name = call?.name ?? 'unknown';
        if (record(data['error'])['code'] === 'denied') {
          this.log(`a ${call?.raw ?? 'tool'} call was refused`);
        }
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
        if (run.cancelRequested && data['aborted'] === true) {
          this.finish(state, 'cancelled', event, 'stopped');
        } else if (data['aborted'] === true) {
          run.error ??= { message: 'Copilot ended this turn before it was finished.', providerCode: 'aborted' };
          this.finish(state, 'error', event);
        } else {
          // A stop that came too late for the turn: it ended on its own, and says so.
          this.finish(state, run.error === null ? 'finished' : 'error', event);
        }
        return;
      default:
        return;
    }
  }

  private newState(config: SessionConfig, dspatchSessionId: DspatchSessionId, runtime: CopilotClientLike): CopilotSessionState {
    const state: CopilotSessionState = {
      dspatchSessionId,
      config,
      session: null,
      runtime,
      pingFailures: 0,
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

  /** While a run is active, ask the runtime now and then: a dead one sends no event. */
  private watchRuntime(): void {
    if (this.watch !== null) {
      return;
    }
    this.watch = setInterval(() => {
      void this.checkRuntime();
    }, this.options.runtimeCheckMs ?? RUNTIME_CHECK_MS);
    this.watch.unref();
  }

  private async checkRuntime(): Promise<void> {
    const active = [...this.sessions.values()].filter((state) => state.run !== null);
    if (active.length === 0) {
      if (this.watch !== null) {
        clearInterval(this.watch);
        this.watch = null;
      }
      return;
    }
    await Promise.all(active.map((state) => this.checkSessionRuntime(state)));
  }

  private async checkSessionRuntime(state: CopilotSessionState): Promise<void> {
    try {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        state.runtime?.ping(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('no answer'));
          }, this.options.runtimeCheckMs ?? RUNTIME_CHECK_MS);
          timer.unref();
        }),
      ]).finally(() => {
        clearTimeout(timer);
      });
      state.pingFailures = 0;
    } catch (error) {
      state.pingFailures += 1;
      if (state.pingFailures >= 2) {
        this.log(`the runtime does not answer: ${String(error)}`);
        this.runtimeGone(state);
      }
    }
  }

  /** The runtime ended under this run. How far it got is not known. */
  private runtimeGone(state: CopilotSessionState): void {
    state.pingFailures = 0;
    const runtime = state.runtime;
    state.runtime = null;
    state.session = null;
    if (runtime !== null) {
      void this.endRuntime(runtime).catch((error: unknown) => {
        this.log(`ending a runtime that stopped answering failed: ${String(error)}`);
      });
    }
    const run = state.run;
    if (run !== null) {
      run.error = { message: "Copilot's runtime stopped during this turn. How far it got is unknown, and nothing was sent again.", providerCode: 'runtime-gone' };
      this.finish(state, 'error', null, 'unconfirmed');
    }
  }

  private refuseIfDisposed(): void {
    if (this.disposed) {
      throw new CopilotAdapterError('This Copilot connection has been closed.', 'disposed');
    }
  }

  async startSession(config: SessionConfig): Promise<SessionHandle> {
    this.refuseIfDisposed();
    const dspatchSessionId = config.dspatchSessionId ?? randomUUID();
    const client = await this.startRuntime();
    let state: CopilotSessionState | null = null;
    try {
      await this.ready(client);
      state = this.newState(config, dspatchSessionId, client);
      state.session = await client.createSession(await this.sessionOptions(state, true));
    } catch (error) {
      await this.endRuntime(client).catch(() => undefined);
      if (state === null) {
        throw error;
      }
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
    const client = await this.startRuntime();
    let state: CopilotSessionState | null = null;
    try {
      await this.ready(client);
      const previous = this.sessions.get(sessionId);
      await previous?.session?.disconnect().catch(() => undefined);
      if (previous?.runtime !== null && previous?.runtime !== undefined) {
        await this.endRuntime(previous.runtime).catch(() => undefined);
      }
      state = this.newState(config, sessionId, client);
      state.session = await client.resumeSession(sessionId, await this.sessionOptions(state, false));
    } catch (error) {
      await this.endRuntime(client).catch(() => undefined);
      if (state === null) {
        throw error;
      }
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
    state.run = { dspatchRunId, cancelRequested: false, error: null, controlFailed: false, preHookCalls: new Map(), refusedCalls: new Map(), calls: new Map(), graceTimer: null };
    this.emit(state, { type: 'run.started', dspatchSessionId: sessionId, dspatchRunId, at: this.now(), rawProviderEvent: null });
    this.watchRuntime();
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
   * that does not come within {@link ABORT_GRACE_MS}, as with a hook that goes on running, this
   * session's runtime is ended with its process tree, and a returned `forceStop` is the
   * evidence; without it the end stays unconfirmed. No other session uses that runtime.
   */
  async cancel(sessionId: DspatchSessionId): Promise<void> {
    const state = this.state(sessionId);
    const run = state.run;
    if (run === null || run.cancelRequested) {
      return;
    }
    run.cancelRequested = true;
    this.emit(state, { type: 'run.cancel_requested', dspatchSessionId: sessionId, dspatchRunId: run.dspatchRunId, at: this.now(), rawProviderEvent: null });
    // Before the abort is awaited: it answers only once a running hook has ended.
    run.graceTimer = setTimeout(() => {
      void this.escalate(state, run);
    }, ABORT_GRACE_MS);
    run.graceTimer.unref();
    try {
      await state.session?.abort();
    } catch (error) {
      this.log(`abort failed: ${String(error)}`);
    }
  }

  private async escalate(state: CopilotSessionState, run: ActiveRun): Promise<void> {
    if (state.run !== run) {
      return;
    }
    this.log('the runtime did not go idle after an abort; ending it');
    const runtime = state.runtime;
    let ended = false;
    try {
      await Promise.race([
        runtime === null
          ? null
          : this.endRuntime(runtime).then(() => {
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
    state.runtime = null;
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
    if (this.watch !== null) {
      clearInterval(this.watch);
      this.watch = null;
    }
    // A runtime with a turn going may be held by a hook, which `stop()` would leave running.
    const busy = new Set<CopilotClientLike>();
    for (const state of this.sessions.values()) {
      if (state.run !== null) {
        state.run.cancelRequested = true;
        this.finish(state, 'cancelled', null, 'unconfirmed');
        if (state.runtime !== null) {
          busy.add(state.runtime);
        }
      }
      await state.session?.disconnect().catch(() => undefined);
    }
    this.catalogue = null;
    const runtimes = [...this.runtimes];
    this.runtimes.clear();
    await Promise.all(
      runtimes.map(async (started) => {
        try {
          const running = await started;
          const stopped =
            !busy.has(running) &&
            (await Promise.race([
              running.stop().then(() => true),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FORCE_STOP_BOUND_MS).unref()),
            ]));
          if (!stopped) {
            await this.endRuntime(running).catch(() => undefined);
          }
        } catch {
          // The runtime never started, or is already gone.
        }
      }),
    );
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

/** A tool call's name and arguments as one comparable string, keys in a stable order. */
function callKey(toolName: string, args: unknown): string {
  let value = args;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      // Arguments that are not JSON compare as the text they are.
    }
  }
  const stable = (one: unknown): unknown =>
    Array.isArray(one)
      ? one.map(stable)
      : one !== null && typeof one === 'object'
        ? Object.fromEntries(Object.keys(one).sort().map((key) => [key, stable((one as Record<string, unknown>)[key])]))
        : one;
  return `${toolName}\u0000${JSON.stringify(stable(value ?? null))}`;
}
