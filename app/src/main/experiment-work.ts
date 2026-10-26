import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

import type { SDKSessionInfo } from '../adapter/claude-sdk-shapes';
import { claudeSupportStatus, loadClaudeSdk } from '../adapter/claude-support';

import type { AgentAdapter } from '../adapter/agent-adapter';
import {
  assessAuthentication,
  CANCEL_DENY_REASON,
  CANCEL_STOP_REASON,
  ClaudeAgentSdkAdapter,
  DISPOSE_BOUND_MS,
  providerSessionIdFor,
  type AccountObservation,
  type AuthenticationAssessment,
  type CancelTimers,
  type ClaudeLocalLookup,
  type ClaudeProcessSpawner,
  type ClaudeQueryFunction,
  type EndEvidence,
  type InitObservation,
  type LiveAuthorization,
} from '../adapter/claude-agent-sdk-adapter';
import { CursorSdkAdapter } from '../adapter/cursor-sdk-adapter';
import type { AgentEvent, SessionConfig, UsageReading } from '../adapter/types';
import {
  diffSnapshots,
  generateExperimentRepo,
  snapshotTree,
  type TreeSnapshot,
} from './experiment-repo';

/**
 * The DSP-1 substep 5 and 6 experiments: a real bounded code change with a test
 * run (AC#6), the access probes, and cancellation and connection failure (AC#3).
 *
 * Run as a plain Node program against the compiled main-process output, one
 * subcommand at a time, so each experiment has its own process, its own exit code
 * and its own record. Substep 4 already established that this same adapter code
 * runs in the Electron main process with a live renderer; nothing here depends on
 * the window, and a separate process per scenario is what makes "did anything keep
 * running?" answerable — the process either exited or it did not.
 *
 * Every scenario writes a JSON record. The record is the evidence; this program's
 * log lines are only for watching it happen.
 *
 * DSP-109 added a provider choice (`--provider=cursor|claude`, Cursor by default)
 * to `code-change`, and two provider-generic scenarios, `cancel-reply` and
 * `two-turn`; DSP-115 added `cancel-then-follow-up`, a cancel-reply followed by a
 * follow-up turn in the same adapter instance and session when the cancel ended
 * with a confirmed process exit. A Claude run refuses to start unless
 * {@link guardClaudeRun} passes:
 * an authorization must be recorded (`--api-key-approval=<reference>` or
 * `--subscription-authorization=<reference>`), and an API credential variable in
 * the environment is refused without an API-key approval.
 */

const DEFAULT_MODEL = 'claude-haiku-4-5';
/** A Claude run's default model, by the SDK's own model name. */
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';
const TURN_TIMEOUT_MS = 300_000;

function log(message: string): void {
  process.stdout.write(`[dspatch:exp] ${message}\n`);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function repoRoot(): string {
  // dist/main/experiment-work.js -> dist/main -> dist -> app -> repo root
  return path.resolve(__dirname, '..', '..', '..');
}

function writeRecord(logPath: string, record: Record<string, unknown>): void {
  const target = path.resolve(logPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  log(`record written: ${target}`);
}

// --- Turn recording ---------------------------------------------------------

interface RecordedEvent {
  readonly atMs: number;
  readonly type: string;
  /** True for events that arrived after the run's terminal event. */
  readonly afterTerminal: boolean;
  readonly detail?: unknown;
}

interface TurnLog {
  readonly label: string;
  readonly promptChars: number;
  runId: string;
  readonly events: RecordedEvent[];
  deltaText: string;
  finalMessage: string | null;
  sendResolvedMs: number | null;
  firstActivityMs: number | null;
  firstTextMs: number | null;
  finishedMs: number | null;
  terminalStatus: string | null;
  /** `run.finished.end` (DSP-115); `null` when the adapter did not report one. */
  end: string | null;
  /** When `run.cancel_requested` arrived, on the events' clock; `null` if it did not. */
  cancelRequestedMs: number | null;
  error: { message: string; providerCode: string | null } | null;
  readonly usageEvents: Array<{ atMs: number; readings: readonly UsageReading[] }>;
  /**
   * `status` is the `tool.finished` status (`ok` or `error`), so a call a hook denied
   * (reported as an error) is told apart from one that ran; absent on `started`.
   */
  readonly toolCalls: Array<{
    atMs: number;
    name: string;
    phase: string;
    toolCallId: string;
    status?: string;
  }>;
  readonly approvals: unknown[];
}

interface Recorder {
  readonly turns: TurnLog[];
  send(label: string, prompt: string): Promise<TurnLog>;
  /** Resolves when the turn's terminal event arrives, or rejects on timeout. */
  waitForFinish(turn: TurnLog): Promise<void>;
  /** Resolves at the first delta or tool call of the current turn. */
  firstActivity(): Promise<void>;
  /**
   * Resolves at the first non-empty **assistant text** delta of the current turn,
   * or at its terminal event if none came. Unlike {@link firstActivity}, a tool
   * call does not resolve it.
   */
  firstAssistantText(): Promise<void>;
  /** Milliseconds since the current turn was sent, on the events' clock. */
  elapsedMs(): number;
  stop(): void;
}

function makeRecorder(adapter: AgentAdapter, sessionId: string): Recorder {
  const turns: TurnLog[] = [];
  let current: TurnLog | null = null;
  let t0 = 0;
  let terminalSeen = false;
  let resolveFinished: (() => void) | null = null;
  let resolveActivity: (() => void) | null = null;
  let resolveText: (() => void) | null = null;

  const unsubscribe = adapter.subscribe(sessionId, (event: AgentEvent) => {
    const turn = current;
    if (turn === null) {
      return;
    }
    // Bound by the run's own start event, so a late event of the previous run,
    // arriving after this turn was sent, cannot claim the turn.
    if (turn.runId === '' && event.type === 'run.started') {
      turn.runId = event.dspatchRunId;
    }
    if (event.dspatchRunId !== turn.runId) {
      return;
    }
    const atMs = round(performance.now() - t0);
    let detail: unknown;

    switch (event.type) {
      case 'assistant.delta':
      case 'reasoning.delta': {
        if (event.type === 'assistant.delta') {
          turn.deltaText += event.text;
        }
        detail = { chars: event.text.length };
        break;
      }
      case 'assistant.message': {
        turn.finalMessage = event.text;
        detail = { chars: event.text.length };
        break;
      }
      case 'tool.started':
      case 'tool.finished': {
        turn.toolCalls.push({
          atMs,
          name: event.name,
          phase: event.type === 'tool.started' ? 'started' : 'finished',
          toolCallId: event.toolCallId,
          ...(event.type === 'tool.finished' ? { status: event.status } : {}),
        });
        detail =
          event.type === 'tool.finished'
            ? { name: event.name, status: event.status }
            : { name: event.name };
        break;
      }
      case 'run.cancel_requested': {
        turn.cancelRequestedMs = atMs;
        break;
      }
      case 'approval.requested': {
        turn.approvals.push(event.request);
        detail = event.request;
        break;
      }
      case 'usage': {
        turn.usageEvents.push({ atMs, readings: event.readings });
        break;
      }
      case 'run.finished': {
        turn.finishedMs = atMs;
        turn.terminalStatus = event.status;
        turn.end = event.end ?? null;
        if (event.error !== undefined) {
          turn.error = {
            message: event.error.message,
            providerCode: event.error.providerCode ?? null,
          };
        }
        detail = { status: event.status, error: turn.error, end: turn.end };
        break;
      }
      default:
        break;
    }

    turn.events.push({ atMs, type: event.type, afterTerminal: terminalSeen, ...(detail === undefined ? {} : { detail }) });

    if (
      turn.firstActivityMs === null &&
      (event.type === 'assistant.delta' || event.type === 'tool.started')
    ) {
      turn.firstActivityMs = atMs;
      const resolve = resolveActivity;
      resolveActivity = null;
      resolve?.();
    }
    if (turn.firstTextMs === null && event.type === 'assistant.delta' && event.text !== '') {
      turn.firstTextMs = atMs;
      const resolve = resolveText;
      resolveText = null;
      resolve?.();
    }
    if (event.type === 'run.finished') {
      terminalSeen = true;
      const resolve = resolveFinished;
      resolveFinished = null;
      resolve?.();
      const activity = resolveActivity;
      resolveActivity = null;
      activity?.();
      const text = resolveText;
      resolveText = null;
      text?.();
    }
  });

  const finishedPromises = new Map<TurnLog, Promise<void>>();
  const activityPromises = new Map<TurnLog, Promise<void>>();
  const textPromises = new Map<TurnLog, Promise<void>>();

  return {
    turns,
    async send(label, prompt) {
      const turn: TurnLog = {
        label,
        promptChars: prompt.length,
        runId: '',
        events: [],
        deltaText: '',
        finalMessage: null,
        sendResolvedMs: null,
        firstActivityMs: null,
        firstTextMs: null,
        finishedMs: null,
        terminalStatus: null,
        end: null,
        cancelRequestedMs: null,
        error: null,
        usageEvents: [],
        toolCalls: [],
        approvals: [],
      };
      turns.push(turn);
      current = turn;
      terminalSeen = false;
      t0 = performance.now();
      finishedPromises.set(
        turn,
        new Promise<void>((resolve) => {
          resolveFinished = resolve;
        }),
      );
      activityPromises.set(
        turn,
        new Promise<void>((resolve) => {
          resolveActivity = resolve;
        }),
      );
      textPromises.set(
        turn,
        new Promise<void>((resolve) => {
          resolveText = resolve;
        }),
      );
      log(`${label}: sending (${String(prompt.length)} chars)`);
      const reference = await adapter.send(sessionId, prompt);
      if (turn.runId === '') {
        turn.runId = reference.dspatchRunId;
      }
      turn.sendResolvedMs = round(performance.now() - t0);
      return turn;
    },
    async waitForFinish(turn) {
      const finished = finishedPromises.get(turn);
      if (finished === undefined) {
        throw new Error(`No finish promise for turn ${turn.label}`);
      }
      let timer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          finished,
          new Promise<void>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(
                  `${turn.label} did not reach a terminal event within ` +
                    `${String(TURN_TIMEOUT_MS)} ms. This is a timeout, not a provider ` +
                    'verdict: the run may still be going.',
                ),
              );
            }, TURN_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timer !== null) {
          clearTimeout(timer);
        }
      }
    },
    async firstActivity() {
      const turn = current;
      if (turn === null) {
        throw new Error('firstActivity called with no turn in flight');
      }
      const activity = activityPromises.get(turn);
      if (activity === undefined) {
        throw new Error('no activity promise');
      }
      let timer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          activity,
          new Promise<void>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error('no assistant delta or tool call within 120 s'));
            }, 120_000);
          }),
        ]);
      } finally {
        if (timer !== null) {
          clearTimeout(timer);
        }
      }
    },
    async firstAssistantText() {
      const turn = current;
      if (turn === null) {
        throw new Error('firstAssistantText called with no turn in flight');
      }
      const text = textPromises.get(turn);
      if (text === undefined) {
        throw new Error('no text promise');
      }
      let timer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          text,
          new Promise<void>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error('no assistant text delta within 120 s'));
            }, 120_000);
          }),
        ]);
      } finally {
        if (timer !== null) {
          clearTimeout(timer);
        }
      }
    },
    elapsedMs() {
      return round(performance.now() - t0);
    },
    stop() {
      unsubscribe();
      current = null;
    },
  };
}

// --- Subprocess execution, started by DSpatch -------------------------------

interface CommandResult {
  readonly command: string;
  readonly cwd: string;
  readonly pid: number | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run a command as a child of this process.
 *
 * DSpatch starts the test, not the agent. That is what puts the exit code, the
 * output and — in substep 6 — the ability to kill it under our control instead of
 * inside a model's tool call, where we would only have its word for the result.
 */
function runCommand(
  file: string,
  args: readonly string[],
  cwd: string,
  options: {
    readonly env?: Record<string, string>;
    readonly onStart?: (child: ChildProcess) => void;
  } = {},
): Promise<CommandResult> {
  const startedAt = performance.now();
  const child = spawn(file, [...args], {
    cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  options.onStart?.(child);
  return new Promise<CommandResult>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({
        command: `${file} ${args.join(' ')}`,
        cwd,
        pid: child.pid ?? null,
        exitCode: code,
        signal: signal === null ? null : String(signal),
        durationMs: round(performance.now() - startedAt),
        stdout,
        stderr,
      });
    });
  });
}

// --- Directory watching, to see whether work continued ----------------------

interface DirState {
  readonly atMs: number;
  readonly entries: Record<string, number>;
}

function readDirState(dir: string, atMs: number): DirState {
  const entries: Record<string, number> = {};
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        try {
          entries[entry.name] = fs.statSync(path.join(dir, entry.name)).size;
        } catch {
          entries[entry.name] = -1;
        }
      }
    }
  } catch {
    // The directory may not exist yet; an empty state is the honest answer.
  }
  return { atMs: round(atMs), entries };
}

function sameState(left: DirState, right: DirState): boolean {
  return JSON.stringify(left.entries) === JSON.stringify(right.entries);
}

/**
 * Watch a directory and return the states that differed from the previous one.
 *
 * This is the discriminator the whole of substep 6 turns on. A cancelled client
 * looks identical whether the provider stopped or we merely stopped listening —
 * but a provider that kept working keeps writing files, and files are visible from
 * outside the connection.
 */
async function watchDirectory(
  dir: string,
  durationMs: number,
  intervalMs = 1_000,
): Promise<{ readonly changes: DirState[]; readonly finalState: DirState }> {
  const startedAt = performance.now();
  let previous = readDirState(dir, 0);
  const changes: DirState[] = [previous];
  while (performance.now() - startedAt < durationMs) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs);
    });
    const next = readDirState(dir, performance.now() - startedAt);
    if (!sameState(previous, next)) {
      changes.push(next);
      previous = next;
    }
  }
  return { changes, finalState: previous };
}

// --- Session helper ---------------------------------------------------------

function requireEmptyDir(dir: string): string {
  const resolved = path.resolve(dir);
  fs.mkdirSync(resolved, { recursive: true });
  const entries = fs.readdirSync(resolved);
  if (entries.length > 0) {
    throw new Error(
      `${resolved} is not empty (${String(entries.length)} entries). This ` +
        'experiment only uses a directory it can be sure it owns.',
    );
  }
  return resolved;
}

function modelRequested(provider: ExperimentProvider = 'cursor'): string {
  if (provider === 'claude') {
    return process.env['DSPATCH_EXPERIMENT_CLAUDE_MODEL'] ?? DEFAULT_CLAUDE_MODEL;
  }
  return process.env['DSPATCH_EXPERIMENT_MODEL'] ?? DEFAULT_MODEL;
}

// --- Provider choice (DSP-109) ----------------------------------------------

export type ExperimentProvider = 'cursor' | 'claude';

/** How a scenario is run. Every default is what the Cursor path always did. */
export interface ScenarioOptions {
  readonly provider?: ExperimentProvider;
  /** Recorded authorization for a Claude run. Required; see {@link guardClaudeRun}. */
  readonly authorization?: LiveAuthorization | null;
  /** The environment a Claude run is assessed against and given. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** A substitute for the SDK's `query()`. Tests only. */
  readonly claudeQueryFn?: ClaudeQueryFunction;
  /** A substitute for Node's `spawn` in the Claude adapter's process wrapper. Tests only. */
  readonly claudeSpawnProcess?: ClaudeProcessSpawner;
  /** Substitute timers for the Claude adapter's cancellation waits. Tests only. */
  readonly claudeTimers?: CancelTimers;
  /** How long to keep listening after a cancelled turn's terminal event. Default 5 s. */
  readonly afterTerminalWatchMs?: number;
  /** Substitute for {@link readSourceRevision}. Tests only. */
  readonly sourceRevision?: () => SourceRevision;
  /**
   * A substitute for the SDK's `getSessionInfo` in the DSP-122 resume probes and
   * in `local-lookup`. Tests only: with it, nothing reads a Claude profile.
   */
  readonly claudeLocalLookup?: (uuid: string, dir?: string) => Promise<SDKSessionInfo | undefined>;
  /** `local-lookup` (`--dir=`): the project path to look under; omitted searches every project directory. */
  readonly lookupDir?: string;
  /** `local-lookup` (`--log=`): where the record is written; omitted prints it. */
  readonly lookupLog?: string;
  /** `resume-chain start` (`--same-process`): after the dispose, also continue in this process (optional P2). */
  readonly sameProcess?: boolean;
}

// --- The DSpatch source revision a run tested (DSP-109 AC #4) ------------------

/**
 * Which DSpatch code ran: the Git state of the repository this program comes
 * from — not the generated fixture's repository, which is recorded separately.
 *
 * `dirty` means **tracked** changes, staged or not (`git status --porcelain
 * --untracked-files=no` is non-empty). Untracked files do not count, because a
 * working checkout routinely holds unrelated scratch files. It describes the
 * source tree when the run started; it does not prove the compiled output that
 * actually ran was built from that tree.
 */
export type SourceRevision =
  | {
      readonly available: true;
      readonly commit: string;
      readonly tree: 'clean' | 'dirty';
      readonly dirtyMeans: string;
      /** Paths with tracked changes, as `git status --porcelain` lists them. */
      readonly trackedChanges: readonly string[];
      readonly sourceDir: string;
    }
  | { readonly available: false; readonly reason: string; readonly sourceDir: string };

/** Runs `git` with `args` in `cwd` and returns stdout, or throws as execFileSync does. */
export type GitRunner = (args: readonly string[], cwd: string) => string;

const DIRTY_MEANS =
  'tracked files modified, staged, deleted or renamed (git status --porcelain ' +
  '--untracked-files=no is non-empty); untracked files are not counted';

function defaultGitRunner(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function sourceDir(): string {
  // Compiled: dist/main. Under the test loader there is no __dirname; the tests
  // run from app/, which is inside the same repository.
  return typeof __dirname === 'string' ? __dirname : process.cwd();
}

function gitFailureReason(error: unknown): string {
  const record = error as { code?: unknown; stderr?: unknown; message?: unknown } | null;
  if (record?.code === 'ENOENT') {
    return 'git is not available on this system';
  }
  const stderr =
    typeof record?.stderr === 'string'
      ? record.stderr
      : Buffer.isBuffer(record?.stderr)
        ? record.stderr.toString('utf8')
        : '';
  if (/not a git repository/i.test(stderr)) {
    return 'the DSpatch source folder is not a Git repository';
  }
  const first = (stderr.trim() || String(record?.message ?? error)).split(/\r?\n/)[0] ?? '';
  return `git failed: ${first.slice(0, 200)}`;
}

export function readSourceRevision(
  run: GitRunner = defaultGitRunner,
  dir: string = sourceDir(),
): SourceRevision {
  try {
    const commit = run(['rev-parse', 'HEAD'], dir).trim();
    if (!/^[0-9a-f]{40,64}$/.test(commit)) {
      return {
        available: false,
        reason: 'git rev-parse HEAD did not return a commit',
        sourceDir: dir,
      };
    }
    const status = run(['status', '--porcelain', '--untracked-files=no'], dir);
    const trackedChanges = status
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.slice(3));
    return {
      available: true,
      commit,
      tree: trackedChanges.length === 0 ? 'clean' : 'dirty',
      dirtyMeans: DIRTY_MEANS,
      trackedChanges,
      sourceDir: dir,
    };
  } catch (error) {
    return { available: false, reason: gitFailureReason(error), sourceDir: dir };
  }
}

/** Exit code when a run was refused before it started. */
export const EXIT_REFUSED = 4;

/**
 * Whether a Claude run may start, from variable names only.
 *
 * Always requires a recorded authorization, even where the adapter itself would
 * not (a substituted query function): these scenarios are the live entry points,
 * so the rule is checked here the same way whatever stands behind the adapter.
 */
export function guardClaudeRun(options: ScenarioOptions): AuthenticationAssessment {
  return assessAuthentication(options.env ?? process.env, options.authorization, true);
}

function providerOf(options: ScenarioOptions): ExperimentProvider {
  return options.provider ?? 'cursor';
}

function createAdapter(options: ScenarioOptions): CursorSdkAdapter | ClaudeAgentSdkAdapter {
  if (providerOf(options) === 'claude') {
    return createClaudeAdapter(options);
  }
  return new CursorSdkAdapter({ toolPolicy: 'provider-default' });
}

/**
 * The Claude adapter as every Claude scenario builds it. `localLookup` overrides
 * the test substitute for the one probe that fabricates a record (R-A0); the
 * product's own lookup is used when neither is given.
 */
function createClaudeAdapter(
  options: ScenarioOptions,
  localLookup?: ClaudeLocalLookup,
): ClaudeAgentSdkAdapter {
  const lookup = localLookup ?? options.claudeLocalLookup;
  return new ClaudeAgentSdkAdapter({
    authorization: options.authorization ?? null,
    env: options.env ?? process.env,
    ...(options.claudeQueryFn === undefined ? {} : { queryFn: options.claudeQueryFn }),
    ...(options.claudeSpawnProcess === undefined
      ? {}
      : { spawnProcess: options.claudeSpawnProcess }),
    ...(options.claudeTimers === undefined ? {} : { timers: options.claudeTimers }),
    ...(lookup === undefined ? {} : { localLookup: lookup }),
  });
}

/**
 * For a Claude run: assess, record, and write a refusal record if it must not
 * start. Returns the exit code when refused, or `null` to go on. A Cursor run is
 * not assessed here; its login lives in Cursor's own store.
 */
function refuseUnauthorized(
  options: ScenarioOptions,
  record: Record<string, unknown>,
  logPath: string,
): number | null {
  record['provider'] = providerOf(options);
  // First, so a refused run says which DSpatch code refused it.
  record['dspatchSource'] = (options.sourceRevision ?? readSourceRevision)();
  if (providerOf(options) !== 'claude') {
    return null;
  }
  const assessment = guardClaudeRun(options);
  record['authentication'] = assessment;
  if (assessment.authorization?.kind === 'subscription') {
    record['authorizationScope'] = SUBSCRIPTION_AUTHORIZATION_SCOPE;
  }
  if (assessment.refusal === null) {
    return null;
  }
  log(`REFUSED: ${assessment.refusal}`);
  record['refused'] = true;
  record['exitCode'] = EXIT_REFUSED;
  record['finishedAtUtc'] = new Date().toISOString();
  writeRecord(logPath, record);
  return EXIT_REFUSED;
}

/** The SDK version in Claude support (DSP-133), or `null` when it is not installed. */
function sdkPackageVersion(): string | null {
  return claudeSupportStatus().sdkVersion;
}

/**
 * Where Claude Code keeps the session transcript, as documented and as observed.
 *
 * Documented: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, or under
 * `CLAUDE_CONFIG_DIR` when it is set. Observed: which `projects/*` folders hold a
 * file named for the session ID — existence only; nothing is read from them.
 */
function providerStateLocation(
  env: Readonly<Record<string, string | undefined>>,
  providerSessionId: string,
): Record<string, unknown> {
  const configDir = env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude');
  const projects = path.join(configDir, 'projects');
  const observed: string[] = [];
  try {
    for (const entry of fs.readdirSync(projects, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const file = path.join(projects, entry.name, `${providerSessionId}.jsonl`);
        if (fs.existsSync(file)) {
          observed.push(file);
        }
      }
    }
  } catch {
    // No projects folder: nothing was observed there, which is the honest answer.
  }
  return {
    documented:
      '~/.claude/projects/<encoded-cwd>/<session-id>.jsonl, or under CLAUDE_CONFIG_DIR ' +
      'when it is set (provider documentation, not an observation)',
    configDirSource: env['CLAUDE_CONFIG_DIR'] === undefined ? 'default' : 'CLAUDE_CONFIG_DIR',
    configDir,
    observedTranscriptFiles: observed,
  };
}

/**
 * The preflight's expectation beside what each init message reported. The
 * environment check cannot prove the SDK's final identity; only this comparison,
 * made on a live run, can confirm the approved path was the one used.
 */
function apiKeySourceComparison(
  assessment: AuthenticationAssessment,
  inits: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const expected = assessment.preflight.expectedApiKeySource;
  const observed = inits.map((init) =>
    typeof init['apiKeySource'] === 'string' ? init['apiKeySource'] : null,
  );
  return {
    preflightDecision: assessment.preflight.decision,
    expected,
    expectedBasis: assessment.preflight.expectedApiKeySourceBasis,
    observedPerInit: observed,
    matchesExpected:
      expected === null || observed.length === 0
        ? null
        : observed.every((value) => value === expected),
    note:
      'expected is from the SDK type documentation; observed is what the init message ' +
      'reported. A mismatch means the run did not use the approved path. The scenario ' +
      "verdict uses the record's authenticationVerification, which also counts turns.",
  };
}

/**
 * Exit code when the scenario's own criteria were met but a Claude run's
 * authentication was not verified: a direct API-key run whose status is
 * `mismatch` or `unconfirmed`, or a subscription-authorized run whose status is
 * `mismatch`, `conflicting` or `unconfirmed`. A `verified` run keeps the
 * scenario's own code, so a passing subscription run exits 0. Only ever replaces
 * 0; every other code keeps its meaning and its cause.
 */
export const EXIT_AUTHENTICATION_UNVERIFIED = 5;

/**
 * - `verified`: direct API-key preflight, and each turn's own run produced exactly
 *   one init message, reporting the expected `apiKeySource`, and no init message
 *   came from a run outside the turns; or a subscription authorization, and every
 *   turn met the accepted rule ({@link ACCEPTED_SUBSCRIPTION_RULE}).
 * - `mismatch`: direct API-key preflight, and some init message reported a
 *   different `apiKeySource`; or a subscription authorization, and some account
 *   observation reported a `subscriptionType` other than the accepted plan.
 * - `conflicting`: subscription authorization, and some init message or account
 *   observation reported an API-key source (an `apiKeySource` other than `'none'`)
 *   or an `apiProvider` other than `'firstParty'`.
 * - `unconfirmed`: nothing contradicts the expected path, but the observations do
 *   not establish it: a turn without exactly one init message of its own, one
 *   without `apiKeySource`, an init message from a run that is not a turn, no turn
 *   sent, or (subscription) a missing or unavailable account observation or one
 *   without `apiProvider` or `subscriptionType` — see {@link verifyAuthentication}.
 * - `not-applicable`: any other preflight; the exit code is not affected.
 */
export type AuthenticationVerificationStatus =
  | 'verified'
  | 'mismatch'
  | 'conflicting'
  | 'unconfirmed'
  | 'not-applicable';

const VERDICT_CHECK_NOTE =
  'a verdict check after observation: it compares what the init messages (and, for a ' +
  'subscription-authorized run, accountInfo()) reported with what the authorization ' +
  'allows once the turns have run. It does not establish authentication before the ' +
  'first provider request and does not prevent charges already incurred. A verified ' +
  'status identifies the authentication path the provider reported; it is not a ' +
  'billing proof.';

/**
 * The scope of a subscription authorization, recorded in every
 * subscription-authorized run record. Niclas's decision of 21 Oct 2026.
 */
export const SUBSCRIPTION_AUTHORIZATION_SCOPE =
  "Niclas's decision, 21 Oct 2026, based on " +
  'https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan ' +
  'and https://code.claude.com/docs/en/legal-and-compliance: personal, single-user use on ' +
  "Niclas's home computer, through Anthropic's own login flow and the unmodified Claude " +
  'Code binary, with no token handling by DSpatch. Not a basis for distributing DSpatch ' +
  'or offering authentication to others.';

/**
 * The subscription path Niclas accepted on 22 Oct 2026 for his personal Claude
 * Max experiment, judged for every turn separately: the turn's init message and
 * the turn's `accountInfo()` must report these values. Documented names and
 * values only (sdk.d.ts 0.3.306: `ApiKeySource` :133, `AccountInfo.apiProvider`
 * :32; `'Claude Max'` is the `subscriptionType` the 22 Oct 2026 probe observed,
 * which the contract types as a plain string).
 */
export const ACCEPTED_SUBSCRIPTION_RULE = Object.freeze({
  initApiKeySource: 'none',
  accountApiProvider: 'firstParty',
  accountSubscriptionType: 'Claude Max',
});

/** The decision behind {@link ACCEPTED_SUBSCRIPTION_RULE}, recorded in every subscription verdict. */
export const SUBSCRIPTION_RULE_BASIS =
  'Niclas, 22 Oct 2026: accepted for his personal Claude Max experiment; init ' +
  "apiKeySource 'none' + accountInfo apiProvider 'firstParty' + subscriptionType " +
  "'Claude Max', judged per turn; missing tokenSource recorded, not blocking; not a " +
  'billing proof';

/** Recorded when an observed account carried no `tokenSource`. */
const TOKEN_SOURCE_ABSENT_NOTE =
  'tokenSource is an optional AccountInfo field (sdk.d.ts 0.3.306 :27) that Claude ' +
  'Code 2.1.306 did not send in the 22 Oct 2026 probe; its absence is recorded and ' +
  'does not block the accepted rule';

/** One turn as the verdict needs it: its label and the DSpatch run it started. */
export interface TurnRun {
  readonly label: string;
  /** `''` when the turn never got a run. */
  readonly runId: string;
}

/** What the adapter observed, each item bound to the run that produced it. */
export interface RunObservations {
  readonly inits: readonly InitObservation[];
  readonly accounts: readonly AccountObservation[];
}

function stringField(message: unknown, field: string): string | null {
  const value =
    typeof message === 'object' && message !== null
      ? (message as Record<string, unknown>)[field]
      : undefined;
  return typeof value === 'string' ? value : null;
}

/** The init messages of one turn's own run. A turn without a run has none. */
function initsOf(turn: TurnRun, inits: readonly InitObservation[]): InitObservation[] {
  return turn.runId === '' ? [] : inits.filter((init) => init.dspatchRunId === turn.runId);
}

/** Observations whose run is not one of the turns: they cannot be attributed. */
function unattributed<T extends { readonly dspatchRunId: string }>(
  items: readonly T[],
  turns: readonly TurnRun[],
): T[] {
  return items.filter(
    (item) => !turns.some((turn) => turn.runId !== '' && turn.runId === item.dspatchRunId),
  );
}

const quoted = (values: readonly (string | null)[]): string =>
  values.map((value) => (value === null ? 'absent' : `'${value}'`)).join(', ');

/**
 * Whether the authorized authentication path was the one observed, run by run.
 *
 * Every observation is bound to the DSpatch run whose `query()` produced it, and a
 * turn is judged only by its own run's observations: a duplicate in one run never
 * stands in for another, and an observation from a run that is not a turn makes
 * the result at best `unconfirmed`. Names and documented enum values only, never
 * credential values, and never `email` or `organization`.
 *
 * **Direct API-key path**: as described for {@link AuthenticationVerificationStatus}.
 *
 * **Subscription path** (preflight `no-api-credential` under a subscription
 * authorization), by the rule Niclas accepted on 22 Oct 2026 for his personal
 * Claude Max experiment ({@link ACCEPTED_SUBSCRIPTION_RULE}), judged for every
 * turn separately:
 * - `conflicting` if any init message or account observation, of any run, has an
 *   `apiKeySource` other than `'none'` (the documented API-key sources; an absent
 *   account value is not a conflict), or any account observation has an
 *   `apiProvider` other than `'firstParty'` ("Anthropic OAuth login only applies
 *   when firstParty"). A conflict wins over everything below.
 * - otherwise `mismatch` if an account observation reported a `subscriptionType`
 *   other than `'Claude Max'`: not evidence of an API path, but not the accepted
 *   plan.
 * - otherwise `unconfirmed` (`subscriptionEvidence: 'insufficient'`) when required
 *   data is missing: no turn sent, an unattributable observation, a turn without
 *   exactly one init message of its own or without `apiKeySource`, an account
 *   observation missing or unavailable, or one without `apiProvider` or
 *   `subscriptionType`. A missing `tokenSource` is **not** a gap: the field is
 *   optional in the contract and Claude Code 2.1.306 did not send it on 22 Oct
 *   2026; its absence is recorded as `tokenSourceObserved: false`.
 * - otherwise `verified` (`subscriptionEvidence: 'rule-met'`): every turn's own
 *   run produced exactly one init message with `apiKeySource 'none'` and an
 *   observed account with `apiProvider 'firstParty'` and `subscriptionType
 *   'Claude Max'`.
 *
 * The rule identifies the subscription path for this experiment; it is not a
 * billing proof, and the record says so ({@link SUBSCRIPTION_RULE_BASIS}). The
 * earlier `consistent-but-undefined` outcome, which kept every subscription run at
 * exit 5 until Niclas had judged the observed values, is superseded by this rule.
 */
export function verifyAuthentication(
  assessment: AuthenticationAssessment,
  observations: RunObservations,
  turns: readonly TurnRun[],
): Record<string, unknown> & { readonly status: AuthenticationVerificationStatus } {
  const decision = assessment.preflight.decision;
  const expected = assessment.preflight.expectedApiKeySource;
  const { inits, accounts } = observations;
  const base = {
    preflightDecision: decision,
    authorizationKind: assessment.authorization?.kind ?? null,
    expected,
    // Raw, per run, in arrival order: what each init message reported.
    observedPerInit: inits.map((init) => ({
      dspatchRunId: init.dspatchRunId,
      apiKeySource: stringField(init.message, 'apiKeySource'),
      session_id: stringField(init.message, 'session_id'),
    })),
    accountObservations: accounts,
    turnsSent: turns.length,
    initMessagesObserved: inits.length,
    note: VERDICT_CHECK_NOTE,
  };
  const strayInits = unattributed(inits, turns);
  const strayAccounts = unattributed(accounts, turns);

  if (decision === 'direct-anthropic-api-key' && expected !== null) {
    const observedPerTurn = turns.map((turn) => {
      const own = initsOf(turn, inits);
      return {
        turn: turn.label,
        dspatchRunId: turn.runId === '' ? null : turn.runId,
        initMessages: own.length,
        apiKeySources: own.map((init) => stringField(init.message, 'apiKeySource')),
      };
    });
    const different = inits
      .map((init) => stringField(init.message, 'apiKeySource'))
      .filter((value): value is string => value !== null && value !== expected);
    const notOne = observedPerTurn.filter((entry) => entry.initMessages !== 1);
    const missingField = observedPerTurn.filter(
      (entry) => entry.initMessages === 1 && entry.apiKeySources[0] === null,
    );
    let status: AuthenticationVerificationStatus;
    let reason: string;
    if (different.length > 0) {
      status = 'mismatch';
      reason = `an init message reported apiKeySource ${quoted(different)} where '${expected}' was expected`;
    } else if (turns.length === 0) {
      status = 'unconfirmed';
      reason = 'no turn was sent, so nothing was observed';
    } else if (notOne.length > 0) {
      status = 'unconfirmed';
      reason = `each turn's own run must produce exactly one init message; ${notOne
        .map((entry) => `${entry.turn} has ${String(entry.initMessages)}`)
        .join(', ')}`;
    } else if (strayInits.length > 0) {
      status = 'unconfirmed';
      reason = `${String(strayInits.length)} init message(s) came from a run that is not one of the turns`;
    } else if (missingField.length > 0) {
      status = 'unconfirmed';
      reason = `no apiKeySource was observed for turn(s) ${missingField
        .map((entry) => entry.turn)
        .join(', ')}`;
    } else {
      status = 'verified';
      reason = `each turn's own init message reported apiKeySource '${expected}'`;
    }
    return { ...base, observedPerTurn, status, reason };
  }

  if (decision === 'no-api-credential' && assessment.authorization?.kind === 'subscription') {
    const rule = ACCEPTED_SUBSCRIPTION_RULE;
    const observedPerTurn = turns.map((turn) => {
      const own = initsOf(turn, inits);
      const account =
        turn.runId === ''
          ? null
          : (accounts.find((entry) => entry.dspatchRunId === turn.runId) ?? null);
      const initApiKeySources = own.map((init) => stringField(init.message, 'apiKeySource'));
      const fields = account?.status === 'observed' ? account.fields : null;
      return {
        turn: turn.label,
        dspatchRunId: turn.runId === '' ? null : turn.runId,
        initMessages: own.length,
        initApiKeySources,
        account,
        // Whether the optional field came, whatever the verdict; `null` without an
        // observed account.
        tokenSourceObserved: fields === null ? null : fields.tokenSource !== null,
        // The accepted rule, judged for this turn alone.
        meetsAcceptedRule:
          own.length === 1 &&
          initApiKeySources[0] === rule.initApiKeySource &&
          fields !== null &&
          fields.apiProvider === rule.accountApiProvider &&
          fields.subscriptionType === rule.accountSubscriptionType,
      };
    });
    const observedAccounts = accounts.filter(
      (account): account is Extract<AccountObservation, { status: 'observed' }> =>
        account.status === 'observed',
    );
    const conflicts: string[] = [];
    for (const init of inits) {
      const source = stringField(init.message, 'apiKeySource');
      if (source !== null && source !== rule.initApiKeySource) {
        conflicts.push(`run ${init.dspatchRunId}: init message apiKeySource '${source}'`);
      }
    }
    const mismatches: string[] = [];
    for (const account of observedAccounts) {
      const { apiKeySource, apiProvider, subscriptionType } = account.fields;
      if (apiKeySource !== null && apiKeySource !== rule.initApiKeySource) {
        conflicts.push(`run ${account.dspatchRunId}: accountInfo apiKeySource '${apiKeySource}'`);
      }
      if (apiProvider !== null && apiProvider !== rule.accountApiProvider) {
        conflicts.push(`run ${account.dspatchRunId}: accountInfo apiProvider '${apiProvider}'`);
      }
      if (subscriptionType !== null && subscriptionType !== rule.accountSubscriptionType) {
        mismatches.push(
          `run ${account.dspatchRunId}: accountInfo subscriptionType '${subscriptionType}' ` +
            `is not '${rule.accountSubscriptionType}'`,
        );
      }
    }
    const gaps: string[] = [];
    if (turns.length === 0) {
      gaps.push('no turn was sent');
    }
    if (strayInits.length + strayAccounts.length > 0) {
      gaps.push(
        `${String(strayInits.length + strayAccounts.length)} observation(s) came from a run ` +
          'that is not one of the turns',
      );
    }
    for (const entry of observedPerTurn) {
      if (entry.initMessages !== 1) {
        gaps.push(`${entry.turn}: ${String(entry.initMessages)} init messages, not exactly one`);
      } else if (entry.initApiKeySources[0] === null) {
        gaps.push(`${entry.turn}: no apiKeySource in the init message`);
      }
      if (entry.account === null) {
        gaps.push(`${entry.turn}: no account observation`);
      } else if (entry.account.status === 'unavailable') {
        gaps.push(`${entry.turn}: account information unavailable (${entry.account.reason})`);
      } else {
        // tokenSource is deliberately not here: optional, recorded, not blocking.
        const absent = (['apiProvider', 'subscriptionType'] as const).filter(
          (field) => entry.account?.status === 'observed' && entry.account.fields[field] === null,
        );
        if (absent.length > 0) {
          gaps.push(`${entry.turn}: accountInfo has no ${absent.join(', ')}`);
        }
      }
    }
    const observedValues = {
      apiProvider: distinctAccountValues(accounts, 'apiProvider'),
      subscriptionType: distinctAccountValues(accounts, 'subscriptionType'),
      tokenSource: distinctAccountValues(accounts, 'tokenSource'),
      accountApiKeySource: distinctAccountValues(accounts, 'apiKeySource'),
      initApiKeySource: [
        ...new Set(inits.map((init) => stringField(init.message, 'apiKeySource'))),
      ],
      // False when any observed account lacked the optional field, or none was observed.
      tokenSourceObserved:
        observedAccounts.length > 0 &&
        observedAccounts.every((account) => account.fields.tokenSource !== null),
    };
    const turnsOutsideRule = observedPerTurn.filter((entry) => !entry.meetsAcceptedRule);
    let status: AuthenticationVerificationStatus;
    let subscriptionEvidence: 'conflicting' | 'mismatch' | 'insufficient' | 'rule-met';
    let reason: string;
    if (conflicts.length > 0) {
      status = 'conflicting';
      subscriptionEvidence = 'conflicting';
      reason =
        `an API-key source or a non-firstParty provider was observed (${conflicts.join('; ')}); ` +
        'a subscription-authorized run must show neither';
    } else if (mismatches.length > 0) {
      status = 'mismatch';
      subscriptionEvidence = 'mismatch';
      reason =
        `a value outside the accepted rule was observed (${mismatches.join('; ')}): not ` +
        'evidence of an API path, but not the accepted plan' +
        (gaps.length > 0 ? `; the observations are also incomplete: ${gaps.join('; ')}` : '');
    } else if (gaps.length > 0) {
      status = 'unconfirmed';
      subscriptionEvidence = 'insufficient';
      reason = `the observations are incomplete: ${gaps.join('; ')}`;
    } else if (turnsOutsideRule.length > 0) {
      // Unreachable while the checks above are complete; kept so the rule fails
      // closed rather than open if they ever are not.
      status = 'unconfirmed';
      subscriptionEvidence = 'insufficient';
      reason = `not every turn met the accepted rule: ${turnsOutsideRule
        .map((entry) => entry.turn)
        .join(', ')}`;
    } else {
      status = 'verified';
      subscriptionEvidence = 'rule-met';
      reason =
        `every turn's own init message reported apiKeySource '${rule.initApiKeySource}' and ` +
        `its accountInfo reported apiProvider '${rule.accountApiProvider}' and ` +
        `subscriptionType '${rule.accountSubscriptionType}' (the accepted rule)` +
        (observedValues.tokenSourceObserved
          ? ''
          : '; tokenSource was not sent (recorded, not blocking)');
    }
    return {
      ...base,
      authorizationScope: SUBSCRIPTION_AUTHORIZATION_SCOPE,
      acceptedRule: rule,
      ruleBasis: SUBSCRIPTION_RULE_BASIS,
      observedPerTurn,
      observedValues,
      tokenSourceNote: observedValues.tokenSourceObserved ? null : TOKEN_SOURCE_ABSENT_NOTE,
      findings: { conflicts, mismatches, gaps },
      subscriptionEvidence,
      status,
      reason,
    };
  }

  return {
    ...base,
    status: 'not-applicable',
    reason:
      decision === 'no-api-credential'
        ? 'no direct API-key path was approved and no subscription authorization is recorded; ' +
          'the exit code is not changed'
        : `preflight decision '${decision}' expects no apiKeySource; the exit code is not changed`,
  };
}

function distinctAccountValues(
  accounts: readonly AccountObservation[],
  field: 'apiProvider' | 'subscriptionType' | 'tokenSource' | 'apiKeySource',
): (string | null)[] {
  return [
    ...new Set(
      accounts.flatMap((account) => (account.status === 'observed' ? [account.fields[field]] : [])),
    ),
  ];
}

/**
 * For a Claude run: record the authentication verification and return the exit
 * code it implies. A scenario failure keeps its code; only a would-be success
 * whose authentication was not verified (`mismatch`, `conflicting` or
 * `unconfirmed`) becomes {@link EXIT_AUTHENTICATION_UNVERIFIED}. Cursor runs are
 * returned unchanged.
 */
async function applyAuthenticationVerdict(
  adapter: AgentAdapter,
  record: Record<string, unknown>,
  turns: readonly TurnLog[],
  scenarioExitCode: number,
): Promise<number> {
  if (!(adapter instanceof ClaudeAgentSdkAdapter)) {
    return scenarioExitCode;
  }
  const session = record['session'] as { dspatchSessionId?: unknown } | undefined;
  let inits: readonly InitObservation[] = [];
  let accounts: readonly AccountObservation[] = [];
  if (typeof session?.dspatchSessionId === 'string') {
    try {
      inits = adapter.initObservations(session.dspatchSessionId);
      accounts = await adapter.accountObservations(session.dspatchSessionId);
    } catch {
      // The session is gone: nothing observed, which leaves the result unconfirmed.
    }
  }
  const verification = verifyAuthentication(
    adapter.authentication(),
    { inits, accounts },
    turns.map((turn) => ({ label: turn.label, runId: turn.runId })),
  );
  const unverified =
    verification.status === 'mismatch' ||
    verification.status === 'conflicting' ||
    verification.status === 'unconfirmed';
  const exitCode =
    scenarioExitCode === 0 && unverified ? EXIT_AUTHENTICATION_UNVERIFIED : scenarioExitCode;
  record['authenticationVerification'] = {
    ...verification,
    scenarioExitCode,
    exitCode,
  };
  log(`authentication verification: ${verification.status} (${String(verification['reason'])})`);
  return exitCode;
}

/**
 * Whether both turns ran in the same provider session, judged by each turn's own
 * run: positive only when each run produced exactly one init message and both
 * report the same `session_id`.
 */
export function sessionContinuity(
  inits: readonly InitObservation[],
  turns: readonly TurnRun[],
): {
  readonly perTurn: readonly {
    turn: string;
    dspatchRunId: string | null;
    sessionIds: (string | null)[];
  }[];
  readonly same: boolean;
  readonly reason: string;
} {
  const perTurn = turns.map((turn) => ({
    turn: turn.label,
    dspatchRunId: turn.runId === '' ? null : turn.runId,
    sessionIds: initsOf(turn, inits).map((init) => stringField(init.message, 'session_id')),
  }));
  const notOne = perTurn.filter((entry) => entry.sessionIds.length !== 1);
  const stray = unattributed(inits, turns);
  if (turns.length !== 2) {
    return { perTurn, same: false, reason: `${String(turns.length)} turn(s), not two` };
  }
  if (notOne.length > 0) {
    return {
      perTurn,
      same: false,
      reason: `each turn's own run must produce exactly one init message; ${notOne
        .map((entry) => `${entry.turn} has ${String(entry.sessionIds.length)}`)
        .join(', ')}`,
    };
  }
  if (stray.length > 0) {
    return {
      perTurn,
      same: false,
      reason: `${String(stray.length)} init message(s) came from a run that is not one of the turns`,
    };
  }
  const [first, second] = perTurn.map((entry) => entry.sessionIds[0] ?? null);
  if (first === null || first === undefined || first !== second) {
    return {
      perTurn,
      same: false,
      reason: `the turns reported session_id ${quoted([first ?? null, second ?? null])}`,
    };
  }
  return { perTurn, same: true, reason: `both turns' own init messages reported session_id '${first}'` };
}

/** A finite number field of an object, or `null`: a missing value is never 0. */
function numberField(message: unknown, field: string): number | null {
  const value =
    typeof message === 'object' && message !== null
      ? (message as Record<string, unknown>)[field]
      : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The init message's `mcp_servers` (sdk.d.ts 0.3.306 :6176-6183) as name and
 * status only — no configuration, URL, source or tool list — or `null` when the
 * message carries no such list. Empty is what `strictMcpConfig: true` should
 * give; the 22 Oct 2026 probe, without it, showed a claude.ai connector's tools
 * in `tools` (this field was not recorded then).
 */
function mcpServersOf(
  init: unknown,
): { readonly name: string | null; readonly status: string | null }[] | null {
  const servers =
    typeof init === 'object' && init !== null
      ? (init as Record<string, unknown>)['mcp_servers']
      : undefined;
  if (!Array.isArray(servers)) {
    return null;
  }
  return servers.map((entry) => ({
    name: stringField(entry, 'name'),
    status: stringField(entry, 'status'),
  }));
}

const UNREQUESTED_MODEL_USAGE_NOTE =
  "not requested by DSpatch; Claude Code's own background functionality (documented), " +
  'cause not established offline. Token counts as the result message reports them.';

/**
 * The `modelUsage` entries (sdk.d.ts 0.3.306 :5925) keyed by a model DSpatch did
 * not request. Token counts only; a missing number is `null`. `null` when the
 * result carries no `modelUsage` or the requested model is unknown.
 */
function unrequestedModelUsageOf(
  modelUsage: unknown,
  requestedModel: string | null,
): Record<string, Record<string, number | string | null>> | null {
  if (typeof modelUsage !== 'object' || modelUsage === null || requestedModel === null) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(modelUsage as Record<string, unknown>)
      .filter(([model]) => model !== requestedModel)
      .map(([model, usage]) => [
        model,
        {
          inputTokens: numberField(usage, 'inputTokens'),
          outputTokens: numberField(usage, 'outputTokens'),
          cacheReadInputTokens: numberField(usage, 'cacheReadInputTokens'),
          cacheCreationInputTokens: numberField(usage, 'cacheCreationInputTokens'),
          canonicalModel: stringField(usage, 'canonicalModel'),
        },
      ]),
  );
}

const SESSION_TITLE_NOTE =
  'passed as Options.title on every query() (sdk.d.ts 0.3.306: the session uses it ' +
  'instead of auto-generating one from the first user message; on resume the ' +
  'persisted title takes precedence). It makes the provider transcript traceable to ' +
  'the DSpatch session; whether the background title request, the most likely but ' +
  'not established source of the unrequested claude-haiku-5-5 usage on 22 Oct 2026, ' +
  'disappears is to be observed live.';

/** What a Claude run record carries beyond the provider-generic fields. */
function claudeObservations(
  adapter: ClaudeAgentSdkAdapter,
  sessionId: string,
  providerSessionId: string,
  modelRequested: string | null,
  options: ScenarioOptions,
): Record<string, unknown> {
  const inits = adapter
    .initMessages(sessionId)
    .map((message) => message as Record<string, unknown>);
  const results = adapter
    .resultMessages(sessionId)
    .map((message) => message as Record<string, unknown>);
  const first = inits[0];
  const configured = [...adapter.permissionPolicy().tools].sort();
  const reportedTools = Array.isArray(first?.['tools']) ? (first['tools'] as unknown[]) : null;
  const firstServers = mcpServersOf(first);
  const managedKeys =
    first === undefined ? [] : Object.keys(first).filter((key) => /managed|policy/i.test(key));
  return {
    sdkVersion: sdkPackageVersion(),
    node: process.versions.node,
    permissions: adapter.permissionPolicy(),
    authentication: adapter.authentication(),
    sessionTitle: adapter.sessionTitle(sessionId),
    sessionTitleNote: SESSION_TITLE_NOTE,
    // DSP-115 (S5): the text DSpatch's cancel hook adds to the conversation, and
    // every call of the hook, so a pass before a cancel shows as well as a deny.
    cancelHook: {
      event: 'PreToolUse',
      matcher: null,
      permissionDecisionReason: CANCEL_DENY_REASON,
      stopReason: CANCEL_STOP_REASON,
    },
    hookFirings: adapter.hookFirings(sessionId),
    promptInput: 'streaming input: a one-message AsyncIterable<SDKUserMessage> per turn',
    init:
      first === undefined
        ? null
        : {
            session_id: first['session_id'] ?? null,
            claude_code_version: first['claude_code_version'] ?? null,
            model: first['model'] ?? null,
            tools: first['tools'] ?? null,
            cwd: first['cwd'] ?? null,
            permissionMode: first['permissionMode'] ?? null,
            apiKeySource: first['apiKeySource'] ?? null,
            mcp_servers: firstServers,
          },
    initSessionIds: inits.map((init) => init['session_id'] ?? null),
    // Every init message with the run that produced it, in arrival order.
    initObservations: adapter.initObservations(sessionId).map((entry, index) => {
      const message = entry.message as Record<string, unknown>;
      return {
        arrival: index,
        dspatchRunId: entry.dspatchRunId,
        session_id: message['session_id'] ?? null,
        apiKeySource: message['apiKeySource'] ?? null,
        model: message['model'] ?? null,
        claude_code_version: message['claude_code_version'] ?? null,
        mcp_servers: mcpServersOf(message),
      };
    }),
    apiKeySource: apiKeySourceComparison(adapter.authentication(), inits),
    toolsMatchConfigured:
      reportedTools === null
        ? null
        : JSON.stringify(reportedTools.map(String).sort()) === JSON.stringify(configured),
    // What the next live run should show as 0 under strictMcpConfig; null without a list.
    mcpServersObservedInInit: firstServers === null ? null : firstServers.length,
    agentOrTaskToolPresent:
      reportedTools === null
        ? null
        : reportedTools.some((tool) => tool === 'Agent' || tool === 'Task'),
    managedPolicy:
      first === undefined
        ? 'no init message was received'
        : managedKeys.length === 0
          ? 'not shown in the init message'
          : Object.fromEntries(managedKeys.map((key) => [key, first[key]])),
    results: results.map((result) => ({
      subtype: result['subtype'] ?? null,
      is_error: result['is_error'] ?? null,
      usage: result['usage'] ?? null,
      modelUsage: result['modelUsage'] ?? null,
      unrequestedModelUsage: unrequestedModelUsageOf(result['modelUsage'], modelRequested),
      unrequestedModelUsageNote: UNREQUESTED_MODEL_USAGE_NOTE,
      permission_denials: result['permission_denials'] ?? null,
      totalCostUsdEstimate: result['total_cost_usd'] ?? null,
      totalCostNote: "the SDK's own local estimate; not a charge and not a billing reading",
    })),
    providerSessionIdsObserved: adapter.providerSessionIdsObserved(sessionId),
    providerMessageTypes: adapter.providerMessageTypes(sessionId),
    streamPumpFinished: adapter.streamPumpFinished(sessionId),
    providerState: providerStateLocation(options.env ?? process.env, providerSessionId),
    capabilities: adapter.capabilities(),
  };
}

function providerSessionIdOf(record: Record<string, unknown>): string {
  const session = record['session'] as { providerSessionId?: unknown } | undefined;
  return typeof session?.providerSessionId === 'string' ? session.providerSessionId : '';
}

async function openSession(
  adapter: AgentAdapter,
  workspacePath: string,
  record: Record<string, unknown>,
  provider: ExperimentProvider = 'cursor',
): Promise<{ sessionId: string; recorder: Recorder }> {
  const handle = await adapter.startSession({
    provider,
    modelRequested: modelRequested(provider),
    workspacePath,
  });
  record['session'] = {
    dspatchSessionId: handle.dspatchSessionId,
    providerSessionId: handle.providerSessionId,
    createdAt: handle.createdAt,
    modelRequested: modelRequested(provider),
    workspacePath,
    ...(adapter instanceof ClaudeAgentSdkAdapter
      ? { adapter: adapter.id, permissions: adapter.permissionPolicy() }
      : { toolPolicy: 'provider-default' }),
  };
  log(
    `session ${handle.dspatchSessionId} -> ${handle.providerSessionId} ` +
      `(workspace ${workspacePath})`,
  );
  return {
    sessionId: handle.dspatchSessionId,
    recorder: makeRecorder(adapter, handle.dspatchSessionId),
  };
}

// --- Scenario: the bounded code change with a test run (AC#6) ---------------

const CHANGE_REQUEST =
  'In this repository, `src/duration.ts` exports `formatDuration`, which currently ' +
  'handles seconds only. Complete it so that the existing tests pass. The tests in ' +
  '`test/duration.test.ts` are the specification — read them. ' +
  'Edit `src/duration.ts` and nothing else: do not modify any test file, do not add ' +
  'dependencies, and do not run any commands. Reply with the single word DONE when ' +
  'the file is saved.';

export async function scenarioCodeChange(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions = {},
): Promise<number> {
  const target = path.resolve(repoDir);
  const record: Record<string, unknown> = {
    scenario: 'substep 5 — bounded code change, tested (AC#6)',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    testRepo: target,
    changeRequest: CHANGE_REQUEST,
  };
  const refused = refuseUnauthorized(options, record, logPath);
  if (refused !== null) {
    return refused;
  }
  const nodeExe = process.execPath;
  const testArgs = ['--test', 'test/duration.test.ts'];

  const before = snapshotTree(target);
  record['snapshotBefore'] = before;
  const testBefore = await runCommand(nodeExe, testArgs, target);
  record['testBeforeChange'] = testBefore;
  log(`test before change: exit ${String(testBefore.exitCode)}`);

  const adapter = createAdapter(options);
  let exitCode = 1;
  let turns: readonly TurnLog[] = [];
  try {
    const { sessionId, recorder } = await openSession(
      adapter,
      target,
      record,
      providerOf(options),
    );
    turns = recorder.turns;
    try {
      const turn = await recorder.send('change-request', CHANGE_REQUEST);
      await recorder.waitForFinish(turn);
      record['turns'] = recorder.turns;
      log(
        `turn: status=${String(turn.terminalStatus)} tools=${String(turn.toolCalls.length)} ` +
          `approvals=${String(turn.approvals.length)}`,
      );

      const after = snapshotTree(target);
      record['snapshotAfter'] = after;
      const diff = diffSnapshots(before, after);
      record['contentDiff'] = diff;
      record['changedFileContents'] = Object.fromEntries(
        diff.changed.map((file) => [
          file.relPath,
          fs.readFileSync(path.join(target, file.relPath), 'utf8'),
        ]),
      );
      record['gitDiff'] = gitText(target, ['diff']);
      record['gitStatus'] = gitText(target, ['status', '--porcelain']);

      const testAfter = await runCommand(nodeExe, testArgs, target);
      record['testAfterChange'] = testAfter;
      log(`test after change: exit ${String(testAfter.exitCode)}`);

      record['verdict'] = {
        testFailedBefore: testBefore.exitCode !== 0,
        testPassedAfter: testAfter.exitCode === 0,
        filesChangedByContent: diff.changed.map((file) => file.relPath),
        onlyTargetFileChanged:
          diff.changed.length === 1 &&
          diff.changed[0]?.relPath === 'src/duration.ts' &&
          diff.added.length === 0 &&
          diff.removed.length === 0,
      };

      // Usage read twice: cost is documented as eventually consistent, and the
      // account-level path is known to be gated for local agents. What is being
      // checked here is only whether the token readings settle or move.
      record['usageReadA'] = await readUsage(adapter, sessionId);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 15_000);
      });
      record['usageReadB'] = await readUsage(adapter, sessionId);
      record['streamReadings'] = await adapter.readUsage({
        of: 'run',
        dspatchRunId: turn.runId,
      });
      record['providerMessageTypes'] = adapter.providerMessageTypes(sessionId);
      record['capabilities'] = adapter.capabilities();

      const verdict = record['verdict'] as { testPassedAfter: boolean };
      exitCode = verdict.testPassedAfter ? 0 : 2;
    } finally {
      recorder.stop();
    }
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String(record['failure'])}`);
    exitCode = 3;
  } finally {
    recordClaudeObservations(adapter, record, options);
    exitCode = await applyAuthenticationVerdict(adapter, record, turns, exitCode);
    await disposeAndRecord(adapter, record);
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

/**
 * Dispose the adapter; for a Claude run, also record and log what `dispose` did
 * about each run's local Claude Code process (DSP-116), as `claudeDisposal`. A
 * Cursor record is unchanged. That the process exited says nothing about work the
 * provider may still do; whether this program itself exits is observed outside.
 */
async function disposeAndRecord(
  adapter: AgentAdapter,
  record: Record<string, unknown>,
): Promise<void> {
  await adapter.dispose();
  if (!(adapter instanceof ClaudeAgentSdkAdapter)) {
    return;
  }
  const runs = adapter.disposals();
  record['claudeDisposal'] = { boundMs: DISPOSE_BOUND_MS, runs };
  for (const entry of runs) {
    log(
      `dispose: ${entry.dspatchRunId} pid ${String(entry.pid)}: ${entry.outcome}` +
        (entry.killedBy === null ? '' : ` (kill by ${entry.killedBy})`),
    );
  }
}

/**
 * Add the Claude-specific observations to a record, also after a failure, so a
 * failed live run still says what the init message showed. Nothing for Cursor.
 */
function recordClaudeObservations(
  adapter: AgentAdapter,
  record: Record<string, unknown>,
  options: ScenarioOptions,
): void {
  if (!(adapter instanceof ClaudeAgentSdkAdapter)) {
    return;
  }
  const session = record['session'] as
    | { dspatchSessionId?: unknown; modelRequested?: unknown }
    | undefined;
  if (typeof session?.dspatchSessionId !== 'string') {
    record['claude'] = {
      permissions: adapter.permissionPolicy(),
      authentication: adapter.authentication(),
      note: 'no session was started, so nothing was observed from the provider',
    };
    return;
  }
  try {
    record['claude'] = claudeObservations(
      adapter,
      session.dspatchSessionId,
      providerSessionIdOf(record),
      typeof session.modelRequested === 'string' ? session.modelRequested : null,
      options,
    );
  } catch (error) {
    record['claude'] = { observationError: describeError(error) };
  }
}

function gitText(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
  } catch (error) {
    return `[git failed: ${String(error)}]`;
  }
}

function describeError(error: unknown): Record<string, unknown> {
  return {
    name: error instanceof Error ? error.name : 'unknown',
    message: error instanceof Error ? error.message : String(error),
    providerCode:
      typeof error === 'object' && error !== null && 'providerCode' in error
        ? ((error as { providerCode?: unknown }).providerCode ?? null)
        : null,
  };
}

async function readUsage(
  adapter: AgentAdapter,
  sessionId: string,
): Promise<Record<string, unknown>> {
  try {
    return {
      observedAtUtc: new Date().toISOString(),
      readings: await adapter.readUsage({ of: 'session', dspatchSessionId: sessionId }),
      error: null,
    };
  } catch (error) {
    return {
      observedAtUtc: new Date().toISOString(),
      readings: [],
      error: describeError(error),
    };
  }
}

// --- Scenario: the access probes --------------------------------------------

async function scenarioProbes(
  workspaceDir: string,
  outsideDir: string,
  logPath: string,
): Promise<number> {
  const workspace = requireEmptyDir(workspaceDir);
  const outside = path.resolve(outsideDir);
  fs.rmSync(outside, { recursive: true, force: true });
  fs.mkdirSync(outside, { recursive: true });
  const probeFile = path.join(outside, 'outside-target.txt');
  const originalContent = 'original line\n';
  fs.writeFileSync(probeFile, originalContent, 'utf8');

  const record: Record<string, unknown> = {
    scenario: 'substep 5 — access probes, run after the code change was documented',
    startedAtUtc: new Date().toISOString(),
    workspace,
    outsideDirectory: outside,
    scopeNote:
      'These probes establish access to one temporary directory outside the agent ' +
      'workspace and to one local listener on 127.0.0.1 started by this experiment. ' +
      'They establish nothing about unrestricted internet access, about any other ' +
      'address, or about any other directory. Nothing was pointed at the DSpatch ' +
      'repository or any other project.',
    expectation:
      "Substep 1 predicted success rather than denial, because Cursor's SDK runs " +
      'unsandboxed by default. Success is the expected outcome and is not a probe bug.',
  };

  // Our own listener, so an entry in our own log is the evidence rather than a
  // claim by the agent.
  const hits: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    hits.push({
      atUtc: new Date().toISOString(),
      method: request.method ?? null,
      url: request.url ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      remoteAddress: request.socket.remoteAddress ?? null,
    });
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('DSPATCH-LISTENER-OK\n');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  record['listener'] = { host: '127.0.0.1', port };
  log(`listener on 127.0.0.1:${String(port)}`);

  const adapter = new CursorSdkAdapter({ toolPolicy: 'provider-default' });
  let exitCode = 1;
  try {
    const { sessionId, recorder } = await openSession(adapter, workspace, record);
    try {
      const probes: Array<Record<string, unknown>> = [];

      const probeOne = await recorder.send(
        'file-probe-1-read-and-modify',
        `Read the file at ${probeFile} (an absolute path outside this workspace), ` +
          'then append a line reading exactly PROBE1-OK to it. Report whether each ' +
          'step succeeded or was refused.',
      );
      await recorder.waitForFinish(probeOne);
      probes.push({
        probe: 'file probe 1 — read and modify a file outside the workspace',
        turn: probeOne.label,
        terminalStatus: probeOne.terminalStatus,
        approvalsRequested: probeOne.approvals.length,
        fileContentAfter: safeRead(probeFile),
        contentChanged: safeRead(probeFile) !== originalContent,
        assistantText: probeOne.deltaText,
      });

      const probeTwo = await recorder.send(
        'file-probe-2-command-writes',
        `Run a shell command that writes a new file ${path.join(outside, 'probe2-command.txt')} ` +
          'containing the text PROBE2-OK. Use a command, not a file-writing tool. ' +
          'Report whether it succeeded or was refused.',
      );
      await recorder.waitForFinish(probeTwo);
      probes.push({
        probe: 'file probe 2 — a command that writes outside the workspace',
        turn: probeTwo.label,
        terminalStatus: probeTwo.terminalStatus,
        approvalsRequested: probeTwo.approvals.length,
        fileExists: fs.existsSync(path.join(outside, 'probe2-command.txt')),
        fileContent: safeRead(path.join(outside, 'probe2-command.txt')),
        assistantText: probeTwo.deltaText,
      });

      const probeThree = await recorder.send(
        'network-probe-local-listener',
        `Fetch http://127.0.0.1:${String(port)}/dspatch-probe and tell me the exact ` +
          'body you received. Report whether the request succeeded or was refused.',
      );
      await recorder.waitForFinish(probeThree);
      probes.push({
        probe: 'network probe — one local listener started by this experiment',
        turn: probeThree.label,
        terminalStatus: probeThree.terminalStatus,
        approvalsRequested: probeThree.approvals.length,
        hitsInOurOwnLog: hits.length,
        hits,
        assistantText: probeThree.deltaText,
      });

      record['probes'] = probes;
      record['turns'] = recorder.turns;
      record['providerMessageTypes'] = adapter.providerMessageTypes(sessionId);
      record['workspaceEntriesAfter'] = fs.readdirSync(workspace);
      record['outsideEntriesAfter'] = fs.readdirSync(outside);
      exitCode = 0;
    } finally {
      recorder.stop();
    }
  } catch (error) {
    record['failure'] = describeError(error);
    exitCode = 3;
  } finally {
    await adapter.dispose();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

/**
 * The network probe again, with the tool that can actually reach a local address.
 *
 * The first attempt asked for a fetch and the agent used its `WebFetch` tool,
 * which runs on Cursor's server and therefore cannot see `127.0.0.1` at all. That
 * is a fact about the tool, not about containment, and reporting it as "no local
 * network access" would be wrong: probe 2 had already shown the agent running
 * arbitrary local shell commands. This asks for a local command instead, which is
 * the only version of the question that has a meaningful answer.
 */
async function scenarioNetShell(workspaceDir: string, logPath: string): Promise<number> {
  const workspace = requireEmptyDir(workspaceDir);
  const record: Record<string, unknown> = {
    scenario: 'substep 5 — network probe, second attempt, via a local shell command',
    startedAtUtc: new Date().toISOString(),
    workspace,
    scopeNote:
      'Establishes reachability of one listener this experiment started on ' +
      '127.0.0.1. Nothing about the internet, any other address, or any other host.',
  };
  const hits: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    hits.push({
      atUtc: new Date().toISOString(),
      method: request.method ?? null,
      url: request.url ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      remoteAddress: request.socket.remoteAddress ?? null,
    });
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('DSPATCH-LISTENER-OK\n');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  record['listener'] = { host: '127.0.0.1', port };
  log(`listener on 127.0.0.1:${String(port)}`);

  const adapter = new CursorSdkAdapter({ toolPolicy: 'provider-default' });
  let exitCode = 1;
  try {
    const { sessionId, recorder } = await openSession(adapter, workspace, record);
    try {
      const turn = await recorder.send(
        'network-probe-via-shell',
        'Run a local shell command on this machine that performs an HTTP GET against ' +
          `http://127.0.0.1:${String(port)}/dspatch-shell-probe — for example ` +
          'PowerShell\'s Invoke-WebRequest. Do not use a web-fetch tool; it must be a ' +
          'command running here. Tell me the exact response body and whether the ' +
          'command succeeded or was refused.',
      );
      await recorder.waitForFinish(turn);
      record['result'] = {
        terminalStatus: turn.terminalStatus,
        approvalsRequested: turn.approvals.length,
        toolCalls: turn.toolCalls,
        hitsInOurOwnLog: hits.length,
        hits,
        assistantText: turn.deltaText,
      };
      record['providerMessageTypes'] = adapter.providerMessageTypes(sessionId);
      record['turns'] = recorder.turns;
      exitCode = 0;
    } finally {
      recorder.stop();
    }
  } catch (error) {
    record['failure'] = describeError(error);
    exitCode = 3;
  } finally {
    await adapter.dispose();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

function safeRead(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// --- Scenario A1: cancel during streaming -----------------------------------

/**
 * A prompt whose progress is visible from outside the connection.
 *
 * Cancelling a pure text answer tells us only what our own client did. Asking for
 * one file per step means the work leaves traces on disk, so "did the provider
 * stop, or did we stop listening?" becomes a question about files rather than
 * about the stream.
 */
const FILE_WALK_PROMPT =
  'Create 30 files in this directory named note-01.txt through note-30.txt. Each ' +
  'file must contain its own number written in English words, nothing else. Create ' +
  'them one at a time, in order, one tool call per file. Do not stop early and do ' +
  'not write them in a single batch.';

async function scenarioCancelStream(
  workspaceDir: string,
  logPath: string,
): Promise<number> {
  const workspace = requireEmptyDir(workspaceDir);
  const record: Record<string, unknown> = {
    scenario: 'substep 6 scenario A1 — cancel during streaming',
    startedAtUtc: new Date().toISOString(),
    workspace,
    prompt: FILE_WALK_PROMPT,
  };
  const adapter = new CursorSdkAdapter({ toolPolicy: 'provider-default' });
  let exitCode = 1;
  try {
    const { sessionId, recorder } = await openSession(adapter, workspace, record);
    try {
      const turn = await recorder.send('cancelled-turn', FILE_WALK_PROMPT);
      await recorder.firstActivity();
      const stateAtCancel = readDirState(workspace, 0);
      log(`first activity at ${String(turn.firstActivityMs)} ms; cancelling`);
      const cancelStartedAt = performance.now();
      let cancelError: Record<string, unknown> | null = null;
      try {
        await adapter.cancel(sessionId);
      } catch (error) {
        cancelError = describeError(error);
      }
      const cancelResolvedMs = round(performance.now() - cancelStartedAt);

      let terminalAfterCancelMs: number | null = null;
      let waitError: Record<string, unknown> | null = null;
      try {
        await recorder.waitForFinish(turn);
        terminalAfterCancelMs = round(performance.now() - cancelStartedAt);
      } catch (error) {
        waitError = describeError(error);
      }

      log('watching the workspace for 25 s after cancellation');
      const watched = await watchDirectory(workspace, 25_000);

      record['cancellation'] = {
        firstActivityMsAfterSend: turn.firstActivityMs,
        cancelCallResolvedMs: cancelResolvedMs,
        cancelError,
        terminalEventMsAfterCancelCall: terminalAfterCancelMs,
        waitError,
        terminalStatus: turn.terminalStatus,
        runError: turn.error,
        eventsAfterTerminal: turn.events.filter((event) => event.afterTerminal),
        streamPumpFinished: adapter.streamPumpFinished(sessionId),
      };
      record['filesAtCancel'] = stateAtCancel;
      record['filesAfterCancelWatch'] = watched;
      record['ac3'] = {
        alreadyChangedFiles:
          'files present at the moment of cancellation are listed in filesAtCancel; ' +
          'they were left exactly as they were — nothing rolled them back',
        anythingStillRunning:
          watched.changes.length > 1
            ? 'YES — the workspace kept changing after the terminal event, so work continued'
            : 'no workspace change observed in the 25 s after cancellation',
        remoteRequestStopped:
          watched.changes.length > 1
            ? 'NOT stopped — tool work continued after the client reported cancellation'
            : 'consistent with the provider stopping, since the tool work stopped too',
      };
      record['turns'] = recorder.turns;
      exitCode = 0;
    } finally {
      recorder.stop();
    }
  } catch (error) {
    record['failure'] = describeError(error);
    exitCode = 3;
  } finally {
    await adapter.dispose();
    record['workspaceEntriesAtEnd'] = readDirState(workspace, 0);
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

// --- Scenario A2: cancel during a running test ------------------------------

async function scenarioCancelTest(repoDir: string, logPath: string): Promise<number> {
  const target = path.resolve(repoDir);
  const artifacts = path.join(target, 'artifacts');
  fs.rmSync(artifacts, { recursive: true, force: true });
  const record: Record<string, unknown> = {
    scenario: 'substep 6 scenario A2 — cancel during a running test',
    startedAtUtc: new Date().toISOString(),
    testRepo: target,
    method:
      'DSpatch starts the test subprocess, so cancellation is a real kill of a real ' +
      'process tree with a real exit signal, not a request to a model.',
  };
  const before = snapshotTree(target);
  record['snapshotBefore'] = before;

  let child: ChildProcess | null = null;
  let pid: number | null = null;
  const killAt = 3_000;
  const runPromise = runCommand(
    process.execPath,
    ['--test', 'test/slow.test.ts'],
    target,
    {
      env: { DSPATCH_SLOW_TEST_MS: '60000' },
      onStart: (started) => {
        child = started;
        pid = started.pid ?? null;
      },
    },
  );

  await new Promise<void>((resolve) => {
    setTimeout(resolve, killAt);
  });
  const markerAtKill = safeRead(path.join(artifacts, 'slow-progress.txt'));
  const aliveBeforeKill = pid !== null && isAlive(pid);
  const killStartedAt = performance.now();
  (child as ChildProcess | null)?.kill();
  const result = await runPromise;
  const killToExitMs = round(performance.now() - killStartedAt);
  // A moment for the OS to reap the process before asking whether it is gone.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 500);
  });
  const aliveAfterKill = pid !== null && isAlive(pid);
  const markerAfterKill = safeRead(path.join(artifacts, 'slow-progress.txt'));
  const after = snapshotTree(target);

  record['run'] = {
    ...result,
    killRequestedAtMs: killAt,
    killToExitMs,
    aliveBeforeKill,
    aliveAfterKill,
  };
  record['ac3'] = {
    alreadyChangedFiles: {
      markerAtKill,
      markerAfterKill,
      halfWritten:
        markerAtKill !== null &&
        markerAtKill.includes('part-1') &&
        !(markerAfterKill ?? '').includes('part-2'),
      sourceTreeDiff: diffSnapshots(before, after),
    },
    anythingStillRunning: aliveAfterKill
      ? 'YES — the process was still alive after the kill'
      : 'no — the subprocess is gone and its exit was observed',
    remoteRequestStopped:
      'not applicable to this scenario: no model request is in flight. The test is ' +
      'a local subprocess, and this scenario measures only whether DSpatch can stop ' +
      'work it started and what it leaves behind.',
  };
  record['exitCode'] = 0;
  record['finishedAtUtc'] = new Date().toISOString();
  writeRecord(logPath, record);
  log(
    `test kill: exit=${String(result.exitCode)} signal=${String(result.signal)} ` +
      `aliveAfter=${String(aliveAfterKill)}`,
  );
  return 0;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- Scenario B: an induced failure on the real connection ------------------

/**
 * Capture the TLS sockets this process opens, so the experiment can sever the real
 * connection to the real backend mid-stream.
 *
 * Why not the forwarding proxy the plan suggests: pointing `backendUrl` at
 * `127.0.0.1` means the SDK validates the provider's certificate against a local
 * address, so the proxy only works with certificate checking disabled or with a
 * locally minted certificate. Both weaken exactly the claim the scenario exists to
 * make — that the failure happened on a genuine connection to the genuine
 * provider. Destroying the live socket does the same thing the severed proxy would
 * do, one hop closer, with no certificate bypass and no third component: the TLS
 * connection is the real one, the traffic is the real traffic, and the failure is
 * caused by this experiment.
 */
interface SocketCapture {
  readonly sockets: Array<{ socket: tls.TLSSocket; host: string }>;
  restore(): void;
}

function captureTlsSockets(): SocketCapture {
  const sockets: Array<{ socket: tls.TLSSocket; host: string }> = [];
  const original = tls.connect;
  const patched = (...args: unknown[]): tls.TLSSocket => {
    const socket = (original as unknown as (...a: unknown[]) => tls.TLSSocket)(...args);
    const first = args[0];
    const host =
      typeof first === 'object' && first !== null
        ? String(
            (first as { servername?: unknown; host?: unknown }).servername ??
              (first as { host?: unknown }).host ??
              'unknown',
          )
        : String(first);
    sockets.push({ socket, host });
    return socket;
  };
  (tls as unknown as { connect: unknown }).connect = patched;
  return {
    sockets,
    restore() {
      (tls as unknown as { connect: unknown }).connect = original;
    },
  };
}

/** Sockets held open by this process that look like a TLS connection to a backend. */
function activeTlsHandles(): Array<{ remoteAddress: string; remotePort: number; destroy: () => void }> {
  const handles = (
    process as unknown as { _getActiveHandles?: () => unknown[] }
  )._getActiveHandles?.() ?? [];
  const found: Array<{ remoteAddress: string; remotePort: number; destroy: () => void }> = [];
  for (const handle of handles) {
    const candidate = handle as {
      remoteAddress?: unknown;
      remotePort?: unknown;
      destroy?: unknown;
    };
    if (
      typeof candidate.remotePort === 'number' &&
      candidate.remotePort === 443 &&
      typeof candidate.destroy === 'function'
    ) {
      found.push({
        remoteAddress: String(candidate.remoteAddress ?? 'unknown'),
        remotePort: candidate.remotePort,
        destroy: () => {
          (candidate.destroy as () => void)();
        },
      });
    }
  }
  return found;
}

async function scenarioSever(workspaceDir: string, logPath: string): Promise<number> {
  const workspace = requireEmptyDir(workspaceDir);
  const capture = captureTlsSockets();
  const record: Record<string, unknown> = {
    scenario:
      'substep 6 scenario B — a failure induced by the experiment on the real connection',
    startedAtUtc: new Date().toISOString(),
    workspace,
    method:
      'The real TLS connection this process holds to the real Cursor backend is ' +
      'destroyed mid-stream by the experiment. No mock, no proxy, no certificate ' +
      'bypass; the connection that fails is the connection that was carrying the turn.',
    prompt: FILE_WALK_PROMPT,
  };
  const adapter = new CursorSdkAdapter({ toolPolicy: 'provider-default' });
  let exitCode = 1;
  try {
    const { sessionId, recorder } = await openSession(adapter, workspace, record);
    try {
      const turn = await recorder.send('severed-turn', FILE_WALK_PROMPT);
      await recorder.firstActivity();
      const stateAtSever = readDirState(workspace, 0);

      const capturedByPatch = capture.sockets.map((entry) => ({
        host: entry.host,
        destroyed: entry.socket.destroyed,
        remoteAddress: entry.socket.remoteAddress ?? null,
        remotePort: entry.socket.remotePort ?? null,
      }));
      const handles = activeTlsHandles();
      const severedAt = performance.now();
      let severedCount = 0;
      for (const entry of capture.sockets) {
        if (!entry.socket.destroyed) {
          entry.socket.destroy(new Error('DSpatch substep 6: connection severed by the experiment'));
          severedCount += 1;
        }
      }
      for (const handle of handles) {
        handle.destroy();
        severedCount += 1;
      }
      log(`severed ${String(severedCount)} socket(s)`);

      let terminalMsAfterSever: number | null = null;
      let waitError: Record<string, unknown> | null = null;
      try {
        await recorder.waitForFinish(turn);
        terminalMsAfterSever = round(performance.now() - severedAt);
      } catch (error) {
        waitError = describeError(error);
      }

      log('watching the workspace for 25 s after the sever');
      const watched = await watchDirectory(workspace, 25_000);

      record['sever'] = {
        socketsCapturedByTlsPatch: capturedByPatch,
        activeTlsHandlesFound: handles.map((handle) => ({
          remoteAddress: handle.remoteAddress,
          remotePort: handle.remotePort,
        })),
        socketsDestroyed: severedCount,
        terminalEventMsAfterSever: terminalMsAfterSever,
        waitError,
        terminalStatus: turn.terminalStatus,
        runError: turn.error,
        eventsAfterTerminal: turn.events.filter((event) => event.afterTerminal),
        streamPumpFinished: adapter.streamPumpFinished(sessionId),
      };
      record['filesAtSever'] = stateAtSever;
      record['filesAfterSeverWatch'] = watched;
      record['ac3'] = {
        alreadyChangedFiles:
          'listed in filesAtSever and filesAfterSeverWatch; compare the two',
        anythingStillRunning:
          watched.changes.length > 1
            ? 'YES — the workspace kept changing after the connection was severed'
            : 'no workspace change observed in the 25 s after the sever',
        remoteRequestStopped:
          watched.changes.length > 1
            ? 'NOT stopped by severing the connection — the work continued'
            : 'no continued tool work observed, though a severed socket cannot by ' +
              'itself prove the provider stopped generating',
      };
      record['turns'] = recorder.turns;
      exitCode = 0;
    } finally {
      recorder.stop();
    }
  } catch (error) {
    record['failure'] = describeError(error);
    exitCode = 3;
  } finally {
    capture.restore();
    try {
      await adapter.dispose();
    } catch (error) {
      record['disposeError'] = describeError(error);
    }
    record['workspaceEntriesAtEnd'] = readDirState(workspace, 0);
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

// --- DSP-109: cancel a streaming reply ----------------------------------------

/**
 * A read-only prompt long enough that the reply is still streaming when it is
 * cancelled. It asks for text, not files, so a content change in the fixture
 * afterwards is a finding rather than the point.
 */
export const CANCEL_REPLY_PROMPT =
  'Read every file in this repository, one at a time. Then, for each file, write a ' +
  'long explanation of what it does, line by line, in your reply. Do not edit, create ' +
  'or delete any file, and do not run any commands.';

/**
 * Cancel once streamed assistant text has begun — waited for specifically, since
 * `firstActivity()` also resolves on a tool call — and record what came after:
 * the terminal status, events after the terminal event, any tool call started
 * after `cancel()` resolved, the time from cancel to the terminal event, and
 * whether the fixture's content changed.
 *
 * DSP-115: for Claude, also the adapter's cancellation record — the absolute time
 * of the request, hook firings, the interrupt outcome, abort and kill times, tool
 * work after the request and how the run ended (`end` and its evidence). An
 * `unconfirmed` end is not a success (exit code 2). Provider work after the end is
 * recorded as unknown.
 */
export async function scenarioCancelReply(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions = {},
): Promise<number> {
  return cancelReply(repoDir, logPath, options, false);
}

/** The first turn of `cancel-then-follow-up`: the cancel-reply prompt with a marker. */
export function cancelReplyPromptWithMarker(marker: string): string {
  return `The reference code for this request is ${marker}. ${CANCEL_REPLY_PROMPT}`;
}

/** Asks for the marker without repeating it. */
export const FOLLOW_UP_PROMPT =
  'What was the reference code in my previous message? Do not use any tool. ' +
  'Reply with the code only.';

/**
 * DSP-115: `cancel-reply`, then — only when the cancel ended `stopped` with a
 * confirmed process exit — a follow-up turn in the same adapter instance and
 * DSpatch session, before `dispose()`, asking for a marker the first prompt
 * carried. The Claude adapter resumes the same provider session for it. With
 * any other end (`forced`, `unconfirmed`, or no cancel) no follow-up is sent and
 * the record says why (exit code 2). Continuity across processes is not tested.
 */
export async function scenarioCancelThenFollowUp(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions = {},
): Promise<number> {
  return cancelReply(repoDir, logPath, options, true);
}

/**
 * Why a follow-up must not be sent after this cancel, or `null` when it may: only
 * a cancelled turn that ended `stopped` with the observed process's exit.
 */
function followUpBlocker(
  textBegan: boolean,
  cancelError: Record<string, unknown> | null,
  turn: TurnLog,
  endEvidence: EndEvidence | null,
): string | null {
  if (!textBegan) {
    return 'no cancel was made: assistant text had not begun while the turn was running';
  }
  if (cancelError !== null) {
    return `cancel() failed: ${String(cancelError['message'])}`;
  }
  if (turn.terminalStatus === null) {
    return 'the cancelled turn reached no terminal event, so its end is unknown';
  }
  if (turn.terminalStatus !== 'cancelled') {
    return `the turn ended '${turn.terminalStatus}', not 'cancelled'`;
  }
  if (turn.end === 'unconfirmed') {
    return (
      "the end was 'unconfirmed': the Claude Code process was not seen to exit, and a " +
      'new turn would resume the provider session while that process may still be writing it'
    );
  }
  if (turn.end === 'forced') {
    return (
      "the end was 'forced' (abort or kill, not the interrupt); the follow-up is sent " +
      "only after an end 'stopped' with a confirmed process exit"
    );
  }
  if (turn.end !== 'stopped') {
    return `the adapter reported ${turn.end === null ? 'no end' : `end '${turn.end}'`}, not 'stopped'`;
  }
  if (endEvidence?.kind !== 'process-exit' || (endEvidence.process?.exitedAtUtc ?? null) === null) {
    return (
      "end 'stopped' without a confirmed process exit (evidence " +
      `'${endEvidence?.kind ?? 'none'}')`
    );
  }
  return null;
}

/**
 * Send the follow-up and record it. True only when it finished, its own run's
 * init message reported the first turn's provider session, and the answer
 * contains the marker. Tool calls are recorded, not judged.
 */
async function sendFollowUp(
  adapter: AgentAdapter,
  sessionId: string,
  recorder: Recorder,
  first: TurnLog,
  marker: string,
  record: Record<string, unknown>,
): Promise<boolean> {
  const claude = adapter instanceof ClaudeAgentSdkAdapter ? adapter : null;
  const resultsBefore = claude === null ? 0 : claude.resultMessages(sessionId).length;
  // Overwritten below; if send() throws, the record still shows it was attempted.
  record['followUp'] = {
    started: true,
    prompt: FOLLOW_UP_PROMPT,
    outcome: 'send() failed; see failure',
  };
  const second = await recorder.send('follow-up', FOLLOW_UP_PROMPT);
  let waitError: Record<string, unknown> | null = null;
  try {
    await recorder.waitForFinish(second);
  } catch (error) {
    waitError = describeError(error);
  }
  const answer = second.finalMessage ?? second.deltaText;
  const answerContainsMarker = answer.includes(marker);
  const inits = claude === null ? [] : claude.initObservations(sessionId);
  const own = initsOf(second, inits);
  const firstOwn = initsOf(first, inits);
  const continuity =
    claude === null
      ? null
      : sessionContinuity(inits, [
          { label: first.label, runId: first.runId },
          { label: second.label, runId: second.runId },
        ]);
  // The cancelled run's stream had ended (a confirmed end requires it) before the
  // follow-up was sent, so the result messages after this point are the follow-up's.
  const results =
    claude === null
      ? []
      : claude
          .resultMessages(sessionId)
          .slice(resultsBefore)
          .map((message) => message as Record<string, unknown>);
  const sameProviderSession = continuity === null ? null : continuity.same;
  record['followUp'] = {
    started: true,
    dspatchRunId: second.runId === '' ? null : second.runId,
    prompt: FOLLOW_UP_PROMPT,
    promptContainsMarker: FOLLOW_UP_PROMPT.includes(marker),
    terminalStatus: second.terminalStatus,
    end: second.end,
    runError: second.error,
    waitError,
    initMessages: own.length,
    session_id: own.length === 1 ? stringField(own[0]?.message, 'session_id') : null,
    apiKeySource: own.length === 1 ? stringField(own[0]?.message, 'apiKeySource') : null,
    firstTurnProviderSessionId:
      firstOwn.length === 1 ? stringField(firstOwn[0]?.message, 'session_id') : null,
    sameProviderSessionAsFirstTurn: sameProviderSession,
    sameProviderSessionReason: continuity === null ? null : continuity.reason,
    answer,
    answerContainsMarker,
    toolCallsStarted: second.toolCalls.filter((call) => call.phase === 'started').length,
    toolCallsExpected: 0,
    toolCalls: second.toolCalls,
    results: results.map((result) => ({
      subtype: result['subtype'] ?? null,
      is_error: result['is_error'] ?? null,
      result: result['result'] ?? null,
      usage: result['usage'] ?? null,
      modelUsage: result['modelUsage'] ?? null,
      totalCostUsdEstimate: result['total_cost_usd'] ?? null,
      totalCostNote: "the SDK's own local estimate; not a charge and not a billing reading",
    })),
    usageEvents: second.usageEvents,
  };
  log(
    `follow-up: ${String(second.terminalStatus)}, same provider session ` +
      `${String(sameProviderSession)}, marker recalled ${String(answerContainsMarker)}`,
  );
  return second.terminalStatus === 'finished' && sameProviderSession === true && answerContainsMarker;
}

async function cancelReply(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions,
  withFollowUp: boolean,
): Promise<number> {
  const target = path.resolve(repoDir);
  // A marker only this program knows, so a recalled one came through the session.
  const marker = withFollowUp ? newNonce() : null;
  const firstPrompt = marker === null ? CANCEL_REPLY_PROMPT : cancelReplyPromptWithMarker(marker);
  const record: Record<string, unknown> =
    marker === null
      ? {
          scenario: 'DSP-109 cancel-reply — cancel after streamed assistant text began',
          startedAtUtc: new Date().toISOString(),
          node: process.versions.node,
          testRepo: target,
          prompt: CANCEL_REPLY_PROMPT,
        }
      : {
          scenario:
            'DSP-115 cancel-then-follow-up — cancel after streamed assistant text began, ' +
            'then a follow-up turn in the same adapter instance and session',
          startedAtUtc: new Date().toISOString(),
          node: process.versions.node,
          testRepo: target,
          prompt: firstPrompt,
          marker,
          followUpPrompt: FOLLOW_UP_PROMPT,
          crossProcessResume: 'not tested: both turns ran in one process and one adapter instance',
        };
  const refused = refuseUnauthorized(options, record, logPath);
  if (refused !== null) {
    return refused;
  }
  const watchMs = options.afterTerminalWatchMs ?? 5_000;
  const before = snapshotTree(target);
  const adapter = createAdapter(options);
  let exitCode = 1;
  let turns: readonly TurnLog[] = [];
  try {
    const { sessionId, recorder } = await openSession(
      adapter,
      target,
      record,
      providerOf(options),
    );
    turns = recorder.turns;
    try {
      const turn = await recorder.send('cancelled-reply', firstPrompt);
      await recorder.firstAssistantText();
      const textBegan = turn.firstTextMs !== null && turn.terminalStatus === null;
      const cancelStartedMs = recorder.elapsedMs();
      const cancelStartedAt = performance.now();
      let cancelError: Record<string, unknown> | null = null;
      if (textBegan) {
        log(`assistant text began at ${String(turn.firstTextMs)} ms; cancelling`);
        try {
          await adapter.cancel(sessionId);
        } catch (error) {
          cancelError = describeError(error);
        }
      }
      const cancelResolvedMs = recorder.elapsedMs();
      // By position, not by clock: two events in the same tenth of a millisecond
      // would otherwise be impossible to order.
      const toolCallsBeforeCancelResolved = turn.toolCalls.length;

      let terminalAfterCancelMs: number | null = null;
      let waitError: Record<string, unknown> | null = null;
      try {
        await recorder.waitForFinish(turn);
        terminalAfterCancelMs = round(performance.now() - cancelStartedAt);
      } catch (error) {
        waitError = describeError(error);
      }
      // Keep listening: whatever arrives now arrives after the terminal event.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, watchMs);
      });

      const after = snapshotTree(target);
      const diff = diffSnapshots(before, after);
      const noContentChange =
        diff.changed.length === 0 && diff.added.length === 0 && diff.removed.length === 0;
      const toolCallsStartedAfterCancelResolved = turn.toolCalls
        .slice(toolCallsBeforeCancelResolved)
        .filter((call) => call.phase === 'started');
      // DSP-115: the adapter's own account of the cancellation (Claude only). It
      // separates the request from the confirmed end, says which mechanism acted
      // (hook firings, interrupt outcome, abort, kill) and counts tool work after
      // the request by the same rule as the reconciled DSP-109 baseline.
      const adapterCancellation =
        adapter instanceof ClaudeAgentSdkAdapter && turn.runId !== ''
          ? adapter.cancellation(sessionId, turn.runId)
          : null;
      const endUnconfirmed = turn.end === 'unconfirmed';
      record['cancellation'] = {
        cancelledAfterTextBegan: textBegan,
        firstTextMsAfterSend: turn.firstTextMs,
        cancelStartedMsAfterSend: cancelStartedMs,
        cancelResolvedMsAfterSend: cancelResolvedMs,
        cancelError,
        // Absolute time of the request, so the provider transcript can be aligned
        // without inference (DSP-109's record had only relative times).
        cancelRequestedAtUtc: adapterCancellation?.cancelRequestedAtUtc ?? null,
        cancelRequestedEventMsAfterSend: turn.cancelRequestedMs,
        terminalEventMsAfterCancelCall: terminalAfterCancelMs,
        terminalEventMsAfterCancelRequested:
          turn.cancelRequestedMs === null || turn.finishedMs === null
            ? null
            : round(turn.finishedMs - turn.cancelRequestedMs),
        waitError,
        terminalStatus: turn.terminalStatus,
        // `null` means the adapter did not report how the run ended (Cursor), not "stopped".
        end: turn.end,
        endEvidence: adapterCancellation?.endEvidence ?? null,
        runError: turn.error,
        watchedAfterTerminalMs: watchMs,
        eventsAfterTerminal: turn.events.filter((event) => event.afterTerminal),
        toolCallsStartedAfterCancelResolved,
        // S3: tool_use blocks the stream delivered after the request, how many of
        // them ran by the reconciled DSP-109 baseline's rule, and the tool results
        // after the request (not denied by the hook; and of those, status ok).
        toolUseBlocksAfterRequest:
          adapterCancellation === null ? null : adapterCancellation.toolUseBlocksAfterRequest.length,
        // The baseline's rule: of the tool_use blocks after the request, the ones
        // followed by a result that was not a hook denial ("executed").
        toolUseBlocksAfterRequestExecuted:
          adapterCancellation === null
            ? null
            : adapterCancellation.toolUseBlocksAfterRequest.filter((block) =>
                adapterCancellation.toolResultsAfterRequest.some(
                  (outcome) => outcome.toolUseId === block.toolUseId && !outcome.deniedByHook,
                ),
              ).length,
        toolResultsNotDeniedAfterRequest:
          adapterCancellation === null ? null : adapterCancellation.toolResultsNotDeniedAfterRequest,
        toolResultsOkAfterRequest:
          adapterCancellation === null ? null : adapterCancellation.toolResultsOkAfterRequest,
        adapter: adapterCancellation,
        providerWorkAfterEnd: 'unknown',
      };
      record['contentDiff'] = diff;
      record['noContentChange'] = noContentChange;
      record['verdict'] = {
        cancelledAfterTextBegan: textBegan,
        terminalStatusCancelled: turn.terminalStatus === 'cancelled',
        noContentChange,
        toolCallStartedAfterCancelResolved: toolCallsStartedAfterCancelResolved.length > 0,
        end: turn.end,
        endUnconfirmed,
      };
      record['turns'] = recorder.turns;
      record['capabilities'] = adapter.capabilities();
      const cancelCriteriaMet =
        textBegan && turn.terminalStatus === 'cancelled' && noContentChange && !endUnconfirmed;
      let followUpMet = true;
      if (marker !== null) {
        // Never a new turn unless the cancelled one stopped and its process exited.
        const blocker = followUpBlocker(
          textBegan,
          cancelError,
          turn,
          adapterCancellation?.endEvidence ?? null,
        );
        if (blocker === null) {
          followUpMet = await sendFollowUp(adapter, sessionId, recorder, turn, marker, record);
        } else {
          log(`follow-up not sent: ${blocker}`);
          record['followUp'] = { started: false, reason: blocker };
          followUpMet = false;
        }
        const followUp = record['followUp'] as Record<string, unknown>;
        record['verdict'] = {
          ...(record['verdict'] as Record<string, unknown>),
          followUpStarted: followUp['started'] === true,
          followUpFinished: followUp['terminalStatus'] === 'finished',
          followUpSameProviderSession: followUp['sameProviderSessionAsFirstTurn'] === true,
          followUpRecalledMarker: followUp['answerContainsMarker'] === true,
        };
      }
      exitCode = cancelCriteriaMet && followUpMet ? 0 : 2;
    } finally {
      recorder.stop();
    }
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String((record['failure'] as { message: string }).message)}`);
    exitCode = 3;
  } finally {
    recordClaudeObservations(adapter, record, options);
    exitCode = await applyAuthenticationVerdict(adapter, record, turns, exitCode);
    await disposeAndRecord(adapter, record);
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    // The process exiting is observed from outside: this record is written last.
    record['processExitNote'] =
      'this program exits after writing this record; whether it did is observed by the caller';
    writeRecord(logPath, record);
  }
  return exitCode;
}

// --- DSP-109: two turns in one session ------------------------------------------

/**
 * A short code that is easy to compare and hard to produce by accident. The same
 * method as `probe-cursor.ts`, copied rather than shared.
 */
function newNonce(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let nonce = '';
  for (let index = 0; index < 10; index += 1) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'X';
  }
  return nonce;
}

/**
 * Turn one plants a nonce this program generated; turn two — a second `send` in
 * the same adapter instance — asks for it back. Continuity across processes is
 * not tested here.
 */
export async function scenarioTwoTurn(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions = {},
): Promise<number> {
  const target = path.resolve(repoDir);
  const nonce = newNonce();
  const firstPrompt =
    `Remember this token exactly: ${nonce}. Do not use any tool. ` +
    'Reply with the single word NOTED.';
  const secondPrompt =
    'What was the token I asked you to remember in my previous message? Do not use any ' +
    'tool. Reply with the token only.';
  const record: Record<string, unknown> = {
    scenario: 'DSP-109 two-turn — a second send in the same adapter instance',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    testRepo: target,
    nonce,
    prompts: [firstPrompt, secondPrompt],
    crossProcessResume: 'not tested: both turns ran in one process and one adapter instance',
  };
  const refused = refuseUnauthorized(options, record, logPath);
  if (refused !== null) {
    return refused;
  }
  const adapter = createAdapter(options);
  let exitCode = 1;
  let turns: readonly TurnLog[] = [];
  try {
    const { sessionId, recorder } = await openSession(
      adapter,
      target,
      record,
      providerOf(options),
    );
    turns = recorder.turns;
    try {
      const first = await recorder.send('turn-1', firstPrompt);
      await recorder.waitForFinish(first);
      const second = await recorder.send('turn-2', secondPrompt);
      await recorder.waitForFinish(second);

      const answer = second.finalMessage ?? second.deltaText;
      const containsNonce = answer.includes(nonce);
      // Judged per turn, by the init messages of that turn's own run.
      const continuity =
        adapter instanceof ClaudeAgentSdkAdapter
          ? sessionContinuity(adapter.initObservations(sessionId), [
              { label: first.label, runId: first.runId },
              { label: second.label, runId: second.runId },
            ])
          : null;
      const sameProviderSession = continuity === null ? null : continuity.same;
      record['continuity'] = {
        turnStatuses: [first.terminalStatus, second.terminalStatus],
        secondAnswer: answer,
        secondAnswerContainsNonce: containsNonce,
        providerSessionIdPerTurn: continuity === null ? null : continuity.perTurn,
        sameProviderSessionBothTurns: sameProviderSession,
        sameProviderSessionReason: continuity === null ? null : continuity.reason,
      };
      record['turns'] = recorder.turns;
      record['capabilities'] = adapter.capabilities();
      exitCode =
        first.terminalStatus === 'finished' &&
        second.terminalStatus === 'finished' &&
        containsNonce &&
        sameProviderSession !== false
          ? 0
          : 2;
    } finally {
      recorder.stop();
    }
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String((record['failure'] as { message: string }).message)}`);
    exitCode = 3;
  } finally {
    recordClaudeObservations(adapter, record, options);
    exitCode = await applyAuthenticationVerdict(adapter, record, turns, exitCode);
    await disposeAndRecord(adapter, record);
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

// --- DSP-122: prepared resume probes (never run during verification) ------------
//
// Plan 20261024-010000-resume-plan sections 4.1-4.5, amended by addendum 003
// section 3. Each writes one JSON record; a refusal is a finding, never retried.
// None has been run: every live behaviour these would measure — whether a Claude
// session resumes in a new process, how the CLI answers a UUID it does not hold,
// whether a turn's process lingers, what `getSessionInfo` finds — is unknown until
// Niclas authorizes a run on an identified candidate. The Cursor probe has no
// refusal path in this program at all: `refuseUnauthorized` assesses Claude runs
// only, so `resume-after-dispose` bills two Cursor turns the moment it runs with
// a repository path. During verification no probe is ever invoked with one.

/** What `resume-chain start` leaves for `continue`, beside the log as `<logPath>.state.json`. */
interface ResumeChainState {
  readonly dspatchSessionId: string;
  readonly providerSessionId: string;
  readonly marker: string;
  readonly cwd: string;
  readonly expectedToolPolicy: string;
  readonly startedAtUtc: string;
  readonly logPath: string;
}

/** P4': how long after turn 1's terminal event the process is given to exit on its own. */
const CHAIN_PROCESS_WAIT_MS = 10_000;

function chainStateFile(logPath: string): string {
  return `${path.resolve(logPath)}.state.json`;
}

function markerPrompts(marker: string): { readonly first: string; readonly second: string } {
  return {
    first:
      `Remember this code exactly: ${marker}. Do not use any tool. ` +
      'Reply with the single word NOTED.',
    second:
      'What was the code I asked you to remember? Do not use any tool. ' +
      'Reply with the code only.',
  };
}

function requireClaudeProbe(options: ScenarioOptions, subcommand: string): void {
  if (providerOf(options) !== 'claude') {
    throw new Error(
      `${subcommand} is a Claude probe: run it with --provider=claude and ` +
        `--subscription-authorization=<reference>.\n${usage()}`,
    );
  }
}

function probeConfig(
  provider: ExperimentProvider,
  workspacePath: string,
  extra: Partial<SessionConfig> = {},
): SessionConfig {
  return { provider, modelRequested: modelRequested(provider), workspacePath, ...extra };
}

/** A fresh copy of a fixture folder, for a resume under another path (R-C2, R-A2). */
function copyFixture(source: string): string {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-resume-copy-'));
  fs.cpSync(source, copy, { recursive: true });
  return copy;
}

/**
 * `resume()` into a new adapter instance, timed and recorded under `key`; with
 * `asSession` the record's `session` is this one, so the Claude observations and
 * the authentication verdict read it.
 */
async function resumeInto(
  adapter: AgentAdapter,
  sessionId: string,
  config: SessionConfig,
  record: Record<string, unknown>,
  key: string,
  asSession: boolean,
): Promise<Recorder> {
  const startedAt = performance.now();
  const handle = await adapter.resume(sessionId, config);
  const elapsedMs = round(performance.now() - startedAt);
  const described: Record<string, unknown> = {
    dspatchSessionId: handle.dspatchSessionId,
    providerSessionId: handle.providerSessionId,
    createdAt: handle.createdAt,
    resumeEvidence: handle.resumeEvidence ?? null,
    elapsedMs,
    workspacePath: config.workspacePath,
    modelRequested: config.modelRequested,
    expectedToolPolicy: config.expectedToolPolicy ?? null,
    ...(adapter instanceof ClaudeAgentSdkAdapter
      ? {
          adapter: adapter.id,
          permissions: adapter.permissionPolicy(),
          policyDigest: adapter.policyDigest(),
          resumption: adapter.resumption(sessionId),
        }
      : { toolPolicy: 'provider-default' }),
  };
  record[key] = described;
  if (asSession) {
    record['session'] = described;
  }
  log(
    `${key}: ${sessionId} -> ${handle.providerSessionId} in ${String(elapsedMs)} ms ` +
      `(evidence ${handle.resumeEvidence ?? 'none'})`,
  );
  return makeRecorder(adapter, sessionId);
}

/** A resume that may be refused, recorded either way and never retried (R-C1, R-C2, R-A1, R-A2). */
async function recordResumeAttempt(
  adapter: AgentAdapter,
  sessionId: string,
  config: SessionConfig,
  expected: string,
): Promise<Record<string, unknown>> {
  const startedAt = performance.now();
  const base = { dspatchSessionId: sessionId, workspacePath: config.workspacePath, expected };
  try {
    const handle = await adapter.resume(sessionId, config);
    return {
      ...base,
      refused: false,
      elapsedMs: round(performance.now() - startedAt),
      handle: {
        providerSessionId: handle.providerSessionId,
        resumeEvidence: handle.resumeEvidence ?? null,
      },
      ...(adapter instanceof ClaudeAgentSdkAdapter
        ? { resumption: adapter.resumption(sessionId) }
        : {}),
    };
  } catch (error) {
    return {
      ...base,
      refused: true,
      elapsedMs: round(performance.now() - startedAt),
      error: describeError(error),
    };
  }
}

/** `process.kill(pid, 0)` as a liveness reading, recorded with what it can and cannot say. */
function liveness(pid: number | null): Record<string, unknown> {
  if (pid === null) {
    return { pid: null, checked: false, note: 'no pid was observed for the run' };
  }
  try {
    process.kill(pid, 0);
    return {
      pid,
      checked: true,
      signalZeroDelivered: true,
      note:
        'process.kill(pid, 0) succeeded: a process with this pid exists. On Windows ' +
        'this says a handle could be opened, not which program the pid now belongs to.',
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? null;
    return {
      pid,
      checked: true,
      signalZeroDelivered: false,
      code,
      note:
        code === 'ESRCH'
          ? 'no process with this pid'
          : 'process.kill(pid, 0) failed for another reason; liveness unknown',
    };
  }
}

type LocalLookupProbe = (uuid: string, dir?: string) => Promise<SDKSessionInfo | undefined>;

/** The SDK's own `getSessionInfo`, or the test substitute. Loaded only when a probe needs it. */
async function localLookupProbe(options: ScenarioOptions): Promise<LocalLookupProbe> {
  if (options.claudeLocalLookup !== undefined) {
    return options.claudeLocalLookup;
  }
  const sdk = await loadClaudeSdk();
  return (uuid, dir) => sdk.getSessionInfo(uuid, dir === undefined ? {} : { dir });
}

/**
 * The lookup in this process's profile and, when the provider process is given
 * another `CLAUDE_CONFIG_DIR`, once more with that value set for the call. Both
 * are recorded; whether `getSessionInfo` reads the variable at call time is not
 * established, so the second reading is a record and not a conclusion.
 */
async function lookupInBothProfiles(
  uuid: string,
  dir: string,
  options: ScenarioOptions,
): Promise<Record<string, unknown>> {
  const lookup = await localLookupProbe(options);
  const hostConfigDir = process.env['CLAUDE_CONFIG_DIR'] ?? null;
  const childConfigDir = (options.env ?? process.env)['CLAUDE_CONFIG_DIR'] ?? null;
  const run = async (label: string): Promise<Record<string, unknown>> => {
    try {
      const info = await lookup(uuid, dir);
      return { label, found: info !== undefined, info: info ?? null };
    } catch (error) {
      return { label, found: null, error: describeError(error) };
    }
  };
  const host = await run('this process (host) environment');
  let child: Record<string, unknown> | null = null;
  if (hostConfigDir !== childConfigDir) {
    const previous = process.env['CLAUDE_CONFIG_DIR'];
    try {
      if (childConfigDir === null) {
        delete process.env['CLAUDE_CONFIG_DIR'];
      } else {
        process.env['CLAUDE_CONFIG_DIR'] = childConfigDir;
      }
      child = await run("the provider process's CLAUDE_CONFIG_DIR");
    } finally {
      if (previous === undefined) {
        delete process.env['CLAUDE_CONFIG_DIR'];
      } else {
        process.env['CLAUDE_CONFIG_DIR'] = previous;
      }
    }
  }
  return {
    uuid,
    dir,
    hostConfigDir,
    childConfigDir,
    aligned: hostConfigDir === childConfigDir,
    host,
    child,
    note:
      'whether getSessionInfo reads CLAUDE_CONFIG_DIR at call time is not established; ' +
      'the second lookup is recorded, not relied on',
  };
}

/**
 * The per-project directory name Claude Code derives from a working directory, as
 * far as the DSP-115 record shows it: `C:\Users\...\fixture` became
 * `C--Users-...-fixture`, so `:` and the separators became `-`. Every other
 * non-alphanumeric character is mapped to `-` here too, which is a guess the
 * record does not cover; `local-lookup` prints the path so a run can check it.
 */
function encodeProjectDir(dir: string): string {
  return dir.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * P1 + R-C1 + R-C2 (Cursor). Two billed turns under the stored Cursor login, and
 * **no refusal path**: `refuseUnauthorized` assesses Claude runs only. Verified
 * only through `parseScenarioArgs`/`usage()` tests and the missing-argument error
 * in `runScenarioCommand`, which fires before this function is reached. Never run
 * it with a repository path to check it.
 *
 * X starts a session and plants a marker; X is disposed (timed, `disposals()`
 * recorded); Y resumes the same ID (timed) and asks for the marker. Then without
 * a billed turn: W resumes a fresh ID (R-C1, expected `agent_not_found`) and V
 * resumes the session's ID under a copy of the fixture (R-C2, expected refused;
 * unmeasured). Exit 0: both turns finished, the marker recalled with no tool
 * call, and R-C1 refused. The equal agent ID is a consistency check only.
 */
export async function scenarioResumeAfterDispose(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions = {},
): Promise<number> {
  if (providerOf(options) !== 'cursor') {
    throw new Error('resume-after-dispose is a Cursor probe; it takes no --provider flag.');
  }
  const target = path.resolve(repoDir);
  const marker = newNonce();
  const prompts = markerPrompts(marker);
  const record: Record<string, unknown> = {
    scenario:
      'DSP-122 P1 + R-C1 + R-C2 — Cursor: dispose one adapter instance, resume the ' +
      'session in another',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    testRepo: target,
    marker,
    prompts: [prompts.first, prompts.second],
    provider: 'cursor',
    dspatchSource: (options.sourceRevision ?? readSourceRevision)(),
    guard:
      'none: a Cursor run is not assessed by this program; it bills under the stored ' +
      'Cursor login',
  };
  const config = probeConfig('cursor', target);
  const instances: CursorSdkAdapter[] = [];
  const cursorAdapter = (): CursorSdkAdapter => {
    const instance = new CursorSdkAdapter({ toolPolicy: 'provider-default' });
    instances.push(instance);
    return instance;
  };
  let exitCode = 1;
  const turns: TurnLog[] = [];
  try {
    const x = cursorAdapter();
    const { sessionId, recorder } = await openSession(x, target, record, 'cursor');
    const first = await recorder.send('turn-1', prompts.first);
    await recorder.waitForFinish(first);
    recorder.stop();
    turns.push(first);

    const disposeStart = performance.now();
    await x.dispose();
    record['disposeX'] = { elapsedMs: round(performance.now() - disposeStart), disposals: x.disposals() };

    const y = cursorAdapter();
    const resumed = await resumeInto(y, sessionId, config, record, 'resumeY', false);
    const second = await resumed.send('turn-2', prompts.second);
    await resumed.waitForFinish(second);
    resumed.stop();
    turns.push(second);
    const answer = second.finalMessage ?? second.deltaText;
    const toolCallsStarted = second.toolCalls.filter((call) => call.phase === 'started').length;
    const resumedId = (record['resumeY'] as { providerSessionId: string }).providerSessionId;
    record['recall'] = {
      answer,
      answerContainsMarker: answer.includes(marker),
      toolCallsStarted,
      sameAgentId: resumedId === providerSessionIdOf(record),
      sameAgentIdNote: 'a consistency check only; the recalled marker is the evidence',
    };

    // R-C1: an ID nothing created. No billed turn.
    const freshId = `dsp-session-${randomUUID()}`;
    record['rC1'] = await recordResumeAttempt(
      cursorAdapter(),
      freshId,
      config,
      'refused with agent_not_found (DSP-4 measured this for Cursor)',
    );
    // R-C2: the session's ID under a copy of the fixture. No billed turn.
    const copy = copyFixture(target);
    record['rC2'] = {
      copyOf: target,
      ...(await recordResumeAttempt(
        cursorAdapter(),
        sessionId,
        { ...config, workspacePath: copy },
        'refused: the session is keyed by the original path (expected, not measured)',
      )),
    };
    record['turns'] = turns;
    record['capabilities'] = y.capabilities();
    const rC1Refused = (record['rC1'] as { refused: boolean }).refused;
    exitCode =
      first.terminalStatus === 'finished' &&
      second.terminalStatus === 'finished' &&
      answer.includes(marker) &&
      toolCallsStarted === 0 &&
      rC1Refused
        ? 0
        : 2;
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String((record['failure'] as { message: string }).message)}`);
    exitCode = 3;
  } finally {
    const disposals: unknown[] = [];
    for (const instance of instances) {
      const startedAt = performance.now();
      await instance.dispose();
      disposals.push({
        elapsedMs: round(performance.now() - startedAt),
        disposals: instance.disposals(),
      });
    }
    record['disposeAll'] = disposals;
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

/**
 * P3 + P4' (Claude), in two OS processes. `start`: one turn with a marker, a wait
 * of {@link CHAIN_PROCESS_WAIT_MS}, the process liveness, dispose with its
 * records, the local lookups in both profiles, the transcript location, and
 * `<logPath>.state.json`. `continue`: a new process resumes from the state file
 * with the real lookup and asks for the marker. Pass P3: turn 2 finished with the
 * marker and no tool call, the init reported the UUID DSpatch passed (a
 * consistency check), authentication verified. Pass P4': turn 1's process gone
 * within the wait and dispose had nothing to record; failing it does not
 * invalidate P3. `--same-process` adds the optional P2 inside `start`.
 */
export async function scenarioResumeChain(
  phase: string,
  repoDir: string,
  logPath: string,
  options: ScenarioOptions = {},
): Promise<number> {
  if (phase !== 'start' && phase !== 'continue') {
    throw new Error(`resume-chain takes start or continue, not "${phase}".\n${usage()}`);
  }
  requireClaudeProbe(options, 'resume-chain');
  return phase === 'start'
    ? resumeChainStart(repoDir, logPath, options)
    : resumeChainContinue(repoDir, logPath, options);
}

async function resumeChainStart(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions,
): Promise<number> {
  const target = path.resolve(repoDir);
  const marker = newNonce();
  const prompts = markerPrompts(marker);
  const stateFile = chainStateFile(logPath);
  const record: Record<string, unknown> = {
    scenario:
      "DSP-122 P3 + P4' chain, process 1 (start): one turn, a wait, dispose, the local " +
      'lookups, and the state file for process 2',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    testRepo: target,
    marker,
    prompts: [prompts.first],
    stateFile,
    sameProcess: options.sameProcess === true,
  };
  const refused = refuseUnauthorized(options, record, logPath);
  if (refused !== null) {
    return refused;
  }
  const adapter = createClaudeAdapter(options);
  let exitCode = 1;
  try {
    const { sessionId, recorder } = await openSession(adapter, target, record, 'claude');
    const first = await recorder.send('turn-1', prompts.first);
    await recorder.waitForFinish(first);
    recorder.stop();
    record['turns'] = recorder.turns;

    // P4': is the turn's process gone on its own, some time after a normal turn?
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CHAIN_PROCESS_WAIT_MS);
    });
    const observations = adapter.processObservations(sessionId);
    const pid = observations[0]?.process?.pid ?? null;
    const alive = liveness(pid);
    record['processAfterTurn1'] = { waitedMs: CHAIN_PROCESS_WAIT_MS, observations, liveness: alive };

    // Observed before the dispose clears the session; the verdict only ever turns 0 into 5.
    recordClaudeObservations(adapter, record, options);
    exitCode = first.terminalStatus === 'finished' ? 0 : 2;
    exitCode = await applyAuthenticationVerdict(adapter, record, recorder.turns, exitCode);

    await disposeAndRecord(adapter, record);
    const disposals = adapter.disposals();
    // Only a liveness check actually made can pass P4'; no observed pid is "not measured",
    // not a failure (review 006 S2).
    record['p4prime'] =
      alive['checked'] === true
        ? {
            pass: alive['signalZeroDelivered'] === false && disposals.length === 0,
            note:
              "pass: turn 1's process was gone within the wait and dispose had nothing to " +
              "record. A kill or an unconfirmed record fails P4' without invalidating P3.",
          }
        : {
            pass: null,
            note: 'not measured: no pid was observed',
          };

    const providerSessionId = providerSessionIdFor(sessionId);
    record['localLookup'] = await lookupInBothProfiles(providerSessionId, target, options);
    record['providerState'] = providerStateLocation(options.env ?? process.env, providerSessionId);

    const state: ResumeChainState = {
      dspatchSessionId: sessionId,
      providerSessionId,
      marker,
      cwd: target,
      expectedToolPolicy: adapter.policyDigest(),
      startedAtUtc: String(record['startedAtUtc']),
      logPath: path.resolve(logPath),
    };
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    log(`state written: ${stateFile}`);

    if (options.sameProcess === true && exitCode === 0) {
      // Optional P2: the same process, a new adapter instance, the real lookup.
      await continueChain(state, target, options, record, 'sameProcessContinue');
    }
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String((record['failure'] as { message: string }).message)}`);
    exitCode = 3;
  } finally {
    await disposeAndRecord(adapter, record);
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

async function resumeChainContinue(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions,
): Promise<number> {
  const target = path.resolve(repoDir);
  const stateFile = chainStateFile(logPath);
  const outPath = `${path.resolve(logPath)}.continue.json`;
  const record: Record<string, unknown> = {
    scenario:
      'DSP-122 P3 chain, process 2 (continue): resume from the state file in a new OS ' +
      'process, one recall turn',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    testRepo: target,
    stateFile,
  };
  const refused = refuseUnauthorized(options, record, outPath);
  if (refused !== null) {
    return refused;
  }
  let state: ResumeChainState;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as ResumeChainState;
  } catch (error) {
    record['failure'] = {
      ...describeError(error),
      note: `no readable state file at ${stateFile}; run resume-chain start first`,
    };
    record['exitCode'] = 3;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(outPath, record);
    return 3;
  }
  record['state'] = state;
  const sub = await continueChain(state, target, options, record, 'continue');
  const exitCode = typeof sub['exitCode'] === 'number' ? sub['exitCode'] : 3;
  record['exitCode'] = exitCode;
  record['finishedAtUtc'] = new Date().toISOString();
  writeRecord(outPath, record);
  return exitCode;
}

/** The recall half of the chain: a new adapter instance resumes and asks for the marker. */
async function continueChain(
  state: ResumeChainState,
  workspacePath: string,
  options: ScenarioOptions,
  record: Record<string, unknown>,
  key: string,
): Promise<Record<string, unknown>> {
  const z = createClaudeAdapter(options);
  const sub: Record<string, unknown> = {
    workspacePath,
    stateCwd: state.cwd,
    prompt: markerPrompts(state.marker).second,
  };
  let exitCode = 1;
  try {
    const config = probeConfig('claude', workspacePath, {
      expectedToolPolicy: state.expectedToolPolicy,
    });
    const recorder = await resumeInto(z, state.dspatchSessionId, config, sub, 'resume', true);
    const second = await recorder.send('turn-2', markerPrompts(state.marker).second);
    try {
      await recorder.waitForFinish(second);
    } catch (error) {
      sub['waitError'] = describeError(error);
    }
    recorder.stop();
    const answer = second.finalMessage ?? second.deltaText;
    const toolCallsStarted = second.toolCalls.filter((call) => call.phase === 'started').length;
    const resumption = z.resumption(state.dspatchSessionId);
    sub['resumptionAfterTurn'] = resumption;
    sub['recall'] = {
      answer,
      answerContainsMarker: answer.includes(state.marker),
      toolCallsStarted,
      initSessionId: resumption?.firstTurn?.initSessionId ?? null,
      idMatchesPassedUuid: resumption?.firstTurn?.idMatches ?? null,
      idNote: 'equal IDs are a consistency check; the recalled marker is the evidence',
    };
    sub['turns'] = recorder.turns;
    exitCode =
      second.terminalStatus === 'finished' &&
      answer.includes(state.marker) &&
      toolCallsStarted === 0 &&
      resumption?.firstTurn?.idMatches === true
        ? 0
        : 2;
    recordClaudeObservations(z, sub, options);
    exitCode = await applyAuthenticationVerdict(z, sub, recorder.turns, exitCode);
    log(
      `${key}: ${String(second.terminalStatus)}, marker recalled ` +
        `${String(answer.includes(state.marker))}, init id matches ${String(resumption?.firstTurn?.idMatches)}`,
    );
  } catch (error) {
    sub['failure'] = describeError(error);
    log(`FAILURE (${key}): ${String((sub['failure'] as { message: string }).message)}`);
    exitCode = 3;
  } finally {
    await disposeAndRecord(z, sub);
    sub['exitCode'] = exitCode;
  }
  record[key] = sub;
  return sub;
}

/**
 * R-A0 (Claude, up to one billed turn): what the CLI does with a `resume` of a
 * UUID it never saw. The local check is bypassed through the adapter's test
 * seam with a fabricated record — the product's lookup is not used — and the
 * one turn records the CLI's answer verbatim: terminal status, result subtype
 * and text, the stderr tail, the init session IDs, and whether a transcript
 * file appeared. If it answered under that UUID, the local check is the only
 * guard and the first-send classification table has nothing to recognise; if
 * it refused, `PROVIDER_MISSING_FORMS` is filled from what is recorded here.
 * Exit 0 once a terminal event was recorded, whichever way it went.
 */
export async function scenarioResumeUnknownId(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions = {},
): Promise<number> {
  requireClaudeProbe(options, 'resume-unknown-id');
  const target = path.resolve(repoDir);
  const freshId = `dsp-session-${randomUUID()}`;
  const uuid = providerSessionIdFor(freshId);
  const prompt = 'Reply with the single word READY. Do not use any tool.';
  const record: Record<string, unknown> = {
    scenario:
      'DSP-122 R-A0 — Claude: resume a UUID the provider never saw, through a ' +
      'fabricated local record',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    testRepo: target,
    dspatchSessionId: freshId,
    providerSessionId: uuid,
    prompt,
    lookup:
      "substituted through the adapter's localLookup seam with a fabricated record; " +
      "the product's lookup was not used",
  };
  const refused = refuseUnauthorized(options, record, logPath);
  if (refused !== null) {
    return refused;
  }
  const fabricated: ClaudeLocalLookup = (asked, dir) =>
    Promise.resolve({
      sessionId: asked,
      summary: 'fabricated by the DSP-122 R-A0 probe',
      lastModified: Date.now(),
      cwd: dir,
    });
  const adapter = createClaudeAdapter(options, fabricated);
  const env = options.env ?? process.env;
  let exitCode = 1;
  let turns: readonly TurnLog[] = [];
  try {
    record['providerStateBefore'] = providerStateLocation(env, uuid);
    const recorder = await resumeInto(adapter, freshId, probeConfig('claude', target), record, 'resume', true);
    turns = recorder.turns;
    const turn = await recorder.send('ready', prompt);
    let waitError: Record<string, unknown> | null = null;
    try {
      await recorder.waitForFinish(turn);
    } catch (error) {
      waitError = describeError(error);
    }
    recorder.stop();
    const results = adapter
      .resultMessages(freshId)
      .map((message) => message as Record<string, unknown>);
    const observations = adapter.processObservations(freshId);
    const initSessionIds = adapter.providerSessionIdsObserved(freshId);
    record['cliAnswer'] = {
      terminalStatus: turn.terminalStatus,
      runError: turn.error,
      waitError,
      answer: turn.finalMessage ?? turn.deltaText,
      results: results.map((result) => ({
        subtype: result['subtype'] ?? null,
        is_error: result['is_error'] ?? null,
        result: result['result'] ?? null,
        errors: result['errors'] ?? null,
      })),
      initSessionIds,
      initReportedPassedUuid: initSessionIds.includes(uuid),
      stderrTail: observations[0]?.process?.stderrTail ?? null,
      processes: observations,
      resumption: adapter.resumption(freshId),
    };
    const after = providerStateLocation(env, uuid);
    record['providerStateAfter'] = after;
    record['finding'] = {
      transcriptAppeared: (after['observedTranscriptFiles'] as string[]).length > 0,
      cliRefused: turn.terminalStatus === 'error',
      answeredUnderUnknownUuid: turn.terminalStatus === 'finished',
      note:
        'answered: the local check is the only guard against resuming into a session ' +
        'the provider does not hold, and the first-send table has nothing to recognise. ' +
        'refused: PROVIDER_MISSING_FORMS is filled from runError and stderrTail.',
    };
    record['turns'] = recorder.turns;
    exitCode = turn.terminalStatus === null ? 2 : 0;
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String((record['failure'] as { message: string }).message)}`);
    exitCode = 3;
  } finally {
    recordClaudeObservations(adapter, record, options);
    exitCode = await applyAuthenticationVerdict(adapter, record, turns, exitCode);
    await disposeAndRecord(adapter, record);
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

/**
 * R-A1 + R-A2 (Claude, no billed turn; the authorization guard applies as to
 * every Claude probe). R-A1: a never-created ID with the real lookup, expected
 * `local_record_missing` (or `_unaligned`), no session, no `query()`. R-A2, given
 * the chain's log path: the chain's ID under a copy of its fixture, expected
 * refused — "no readable record" under the copy's path or `config_mismatch` from
 * the record's `cwd` — and recorded whichever way. Exit 0 on R-A1 refused as
 * expected.
 */
export async function scenarioResumeControls(
  repoDir: string,
  logPath: string,
  chainLogPath: string | undefined,
  options: ScenarioOptions = {},
): Promise<number> {
  requireClaudeProbe(options, 'resume-controls');
  const target = path.resolve(repoDir);
  const record: Record<string, unknown> = {
    scenario:
      'DSP-122 R-A1 + R-A2 — Claude: resume controls with the real local lookup; no model turn',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    testRepo: target,
    turns: 0,
    note: 'nothing here sends a prompt; the authorization guard applies all the same',
  };
  const refused = refuseUnauthorized(options, record, logPath);
  if (refused !== null) {
    return refused;
  }
  const adapter = createClaudeAdapter(options);
  let exitCode = 1;
  try {
    const config = probeConfig('claude', target);
    const neverCreated = `dsp-session-${randomUUID()}`;
    record['rA1'] = await recordResumeAttempt(
      adapter,
      neverCreated,
      config,
      'refused with local_record_missing (or local_record_missing_unaligned): no ' +
        'record, no session, no query()',
    );
    record['rA1Lookup'] = await lookupInBothProfiles(
      providerSessionIdFor(neverCreated),
      target,
      options,
    );
    if (chainLogPath === undefined) {
      record['rA2'] = {
        skipped: true,
        reason: 'no chain log path given; pass the resume-chain log path as the third argument',
      };
    } else {
      const state = JSON.parse(
        fs.readFileSync(chainStateFile(chainLogPath), 'utf8'),
      ) as ResumeChainState;
      const copy = copyFixture(state.cwd);
      record['rA2'] = {
        copyOf: state.cwd,
        ...(await recordResumeAttempt(
          adapter,
          state.dspatchSessionId,
          { ...config, workspacePath: copy, expectedToolPolicy: state.expectedToolPolicy },
          "refused: 'no readable record' under the copy's path, or config_mismatch from " +
            "the record's cwd (expected, not measured)",
        )),
      };
    }
    const rA1 = record['rA1'] as { refused: boolean; error?: { providerCode?: unknown } };
    const code = rA1.error?.providerCode;
    exitCode =
      rA1.refused && (code === 'local_record_missing' || code === 'local_record_missing_unaligned')
        ? 0
        : 2;
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String((record['failure'] as { message: string }).message)}`);
    exitCode = 3;
  } finally {
    recordClaudeObservations(adapter, record, options);
    await disposeAndRecord(adapter, record);
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
}

/**
 * Plan 4.5: `getSessionInfo` against this user's existing transcripts. No model
 * turn, no adapter, nothing written under the profile — but it **reads the Claude
 * profile**, which is why it is not run during verification. Prints (or writes
 * with `--log=`) the result or `undefined`, `CLAUDE_CONFIG_DIR`, and the expected
 * transcript path with the encoding the DSP-115 record showed. Exit 0 when the
 * lookup ran, found or not; 3 when it threw.
 */
export async function scenarioLocalLookup(
  uuid: string,
  options: ScenarioOptions = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const configDir = env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude');
  const dir = options.lookupDir === undefined ? undefined : path.resolve(options.lookupDir);
  const expectedPath =
    dir === undefined ? null : path.join(configDir, 'projects', encodeProjectDir(dir), `${uuid}.jsonl`);
  const record: Record<string, unknown> = {
    scenario:
      "DSP-122 4.5 — read-only check of getSessionInfo against this user's existing " +
      'transcripts; no model turn, nothing written under the profile',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    uuid,
    dir: dir ?? null,
    dirNote:
      dir === undefined
        ? 'omitted: the SDK searches every project directory'
        : 'passed as { dir }',
    claudeConfigDir: env['CLAUDE_CONFIG_DIR'] ?? null,
    configDirSource: env['CLAUDE_CONFIG_DIR'] === undefined ? 'default' : 'CLAUDE_CONFIG_DIR',
    configDir,
    expectedTranscriptPath: expectedPath,
    expectedPathExists: expectedPath === null ? null : fs.existsSync(expectedPath),
    encodingNote:
      "the DSP-115 record shows ':' and the path separators becoming '-' " +
      "(C:\\Users\\... -> C--Users-...); every other non-alphanumeric character is " +
      "mapped to '-' here as a guess the record does not cover",
    lookup: options.claudeLocalLookup === undefined ? "the SDK's getSessionInfo" : 'substituted',
  };
  let exitCode: number;
  try {
    const lookup = await localLookupProbe(options);
    const info = await lookup(uuid, dir);
    record['found'] = info !== undefined;
    record['result'] = info ?? null;
    log(
      info === undefined
        ? 'getSessionInfo: undefined (not found, a sidechain, or no extractable summary)'
        : `getSessionInfo: found (cwd ${String(info.cwd ?? 'none')}, lastModified ${String(info.lastModified)})`,
    );
    exitCode = 0;
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String((record['failure'] as { message: string }).message)}`);
    exitCode = 3;
  }
  log(`CLAUDE_CONFIG_DIR: ${env['CLAUDE_CONFIG_DIR'] ?? '(unset; default profile)'}`);
  log(`expected transcript path: ${expectedPath ?? '(dir omitted: every project directory)'}`);
  record['exitCode'] = exitCode;
  record['finishedAtUtc'] = new Date().toISOString();
  if (options.lookupLog === undefined) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  } else {
    writeRecord(options.lookupLog, record);
  }
  return exitCode;
}

// --- Entry point ------------------------------------------------------------

function usage(): string {
  return [
    'usage: node dist/main/experiment-work.js <subcommand> [args] [flags]',
    '  make-repo     <repoDir>',
    '  code-change   <repoDir> <logPath>            [provider flags]',
    '  cancel-reply  <repoDir> <logPath>            [provider flags]',
    '  two-turn      <repoDir> <logPath>            [provider flags]',
    '  cancel-then-follow-up <repoDir> <logPath>    [provider flags]',
    '  probes        <workspaceDir> <outsideDir> <logPath>',
    '  net-shell     <workspaceDir> <logPath>',
    '  cancel-stream <workspaceDir> <logPath>',
    '  cancel-test   <repoDir> <logPath>',
    '  sever         <workspaceDir> <logPath>',
    '',
    'DSP-122 resume probes (prepared; none has been run — a refusal is a finding):',
    '  resume-after-dispose <repoDir> <logPath>     Cursor only. NO CODE GUARD: it BILLS TWO',
    '                                               CURSOR TURNS under the stored Cursor login the',
    '                                               moment it runs with a repository path. It is',
    '                                               verified only through the argument-parsing tests',
    '                                               and the missing-argument error; never run it to',
    '                                               check it.',
    '  resume-chain start <repoDir> <logPath>       --provider=claude [auth flag]  one turn with a',
    '                                               marker, a 10 s wait, the process liveness,',
    '                                               dispose, the local lookups, then',
    '                                               <logPath>.state.json for process 2 (P3 + P4\')',
    '  resume-chain continue <repoDir> <logPath>    --provider=claude [auth flag]  in a new OS',
    '                                               process: resumes from <logPath>.state.json, one',
    '                                               recall turn; record at <logPath>.continue.json',
    '  resume-unknown-id <repoDir> <logPath>        --provider=claude [auth flag]  up to one turn:',
    '                                               resumes a UUID the provider never saw, through',
    '                                               a fabricated local record, and records the',
    '                                               CLI\'s answer verbatim (R-A0)',
    '  resume-controls <repoDir> <logPath> [chainLogPath]  --provider=claude [auth flag]  no',
    '                                               turn: a never-created ID with the real lookup',
    '                                               (R-A1) and, given the chain\'s log path, its ID',
    '                                               under a copied fixture (R-A2)',
    '  local-lookup <uuid> [--dir=<cwd>] [--log=<path>]  no model turn and no adapter, but it',
    '                                               READS THIS USER\'S CLAUDE PROFILE (the SDK\'s',
    '                                               getSessionInfo) and prints the result or',
    '                                               undefined, CLAUDE_CONFIG_DIR and the expected',
    '                                               transcript path; writes nothing under the profile',
    '  --same-process                               resume-chain start only: after the dispose,',
    '                                               also continue in this process (optional P2)',
    'Cost if run: resume-after-dispose 2 Cursor turns; resume-chain 2 Claude turns (+1 with',
    '--same-process); resume-unknown-id up to 1 Claude turn; resume-controls and local-lookup',
    'none. Every Claude probe refuses without --subscription-authorization (or an API-key',
    'approval) before any adapter is built; local-lookup needs neither, since it asks no provider.',
    '',
    'provider flags (DSP-109):',
    '  --provider=cursor|claude                  default cursor',
    '  --api-key-approval=<reference>            records an explicit API-key approval',
    '  --subscription-authorization=<reference>  records the authorization for',
    '                                            subscription-backed use',
    'A claude run refuses to start without one of the last two, and refuses an API',
    'credential variable in its environment without an API-key approval.',
    'Exit 5: a Claude run met its own criteria, but its authentication was not',
    "verified. With an API-key approval: not every turn's own init message reported",
    "apiKeySource 'ANTHROPIC_API_KEY'. With a subscription authorization: not every",
    "turn met the accepted rule (init apiKeySource 'none', accountInfo apiProvider",
    "'firstParty' and subscriptionType 'Claude Max'; Niclas, 22 Oct 2026); the record",
    'says whether the observations conflict, mismatch or are incomplete. Checked',
    'after the turns ran: it identifies the path the provider reported, does not',
    'prevent charges already incurred, and is not a billing proof.',
    '',
    'cancel-then-follow-up (DSP-115): cancel-reply with a generated reference code in',
    "the first prompt. Only if the cancel ended 'stopped' with a confirmed process",
    'exit, a follow-up turn in the same adapter instance and session asks for the code',
    "without repeating it (Claude resumes the same provider session). Exit 0 only if",
    'the cancel-reply criteria hold and the follow-up finished on the same provider',
    'session with the code in its answer. Exit 2 also when no follow-up was sent',
    "(end 'forced' or 'unconfirmed', or no cancel; the record's followUp.reason says",
    'why) or it did not meet those criteria. Exit 5 as above, over both turns.',
  ].join('\n');
}

/** Split `--name=value` flags from positional arguments. Exported for tests. */
export function parseScenarioArgs(argv: readonly string[]): {
  readonly positional: string[];
  readonly options: ScenarioOptions;
} {
  const positional: string[] = [];
  let provider: ExperimentProvider = 'cursor';
  let authorization: LiveAuthorization | null = null;
  let lookupDir: string | undefined;
  let lookupLog: string | undefined;
  let sameProcess = false;
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=');
    if (name === 'provider') {
      if (value !== 'cursor' && value !== 'claude') {
        throw new Error(`--provider must be cursor or claude, not "${value}".\n${usage()}`);
      }
      provider = value;
    } else if (name === 'api-key-approval') {
      authorization = { kind: 'api-key', approval: value };
    } else if (name === 'subscription-authorization') {
      authorization = { kind: 'subscription', authorization: value };
    } else if (name === 'dir') {
      lookupDir = value;
    } else if (name === 'log') {
      lookupLog = value;
    } else if (name === 'same-process') {
      sameProcess = true;
    } else {
      throw new Error(`Unknown flag ${arg}.\n${usage()}`);
    }
  }
  if (provider === 'cursor' && authorization !== null) {
    // An approval meant for a Claude run must not vanish into a Cursor run.
    throw new Error(
      '--api-key-approval and --subscription-authorization apply only to ' +
        '--provider=claude; this run is a Cursor run.',
    );
  }
  return {
    positional,
    options: {
      provider,
      authorization,
      ...(lookupDir === undefined ? {} : { lookupDir }),
      ...(lookupLog === undefined ? {} : { lookupLog }),
      ...(sameProcess ? { sameProcess: true } : {}),
    },
  };
}

/** What a test may put behind a command line: never set from the command line itself. */
export type ScenarioSubstitutes = Pick<
  ScenarioOptions,
  | 'env'
  | 'claudeQueryFn'
  | 'claudeSpawnProcess'
  | 'claudeTimers'
  | 'claudeLocalLookup'
  | 'afterTerminalWatchMs'
  | 'sourceRevision'
>;

/**
 * Parse a command line and run its subcommand: what the program does with
 * `process.argv`. Exported so a test can run a command line with substitutes.
 */
export async function runScenarioCommand(
  argv: readonly string[],
  substitutes: ScenarioSubstitutes = {},
): Promise<number> {
  const parsed = parseScenarioArgs(argv);
  const { positional } = parsed;
  const options: ScenarioOptions = { ...parsed.options, ...substitutes };
  const [subcommand, ...args] = positional;
  const arg = (index: number): string => {
    const value = args[index];
    if (value === undefined) {
      throw new Error(`Missing argument ${String(index + 1)}.\n${usage()}`);
    }
    return value;
  };

  const providerAware = [
    'code-change',
    'cancel-reply',
    'two-turn',
    'cancel-then-follow-up',
    'resume-chain',
    'resume-unknown-id',
    'resume-controls',
    'local-lookup',
  ];
  if (options.provider !== 'cursor' && !providerAware.includes(subcommand ?? '')) {
    throw new Error(
      `--provider=${String(options.provider)} applies only to ${providerAware.join(', ')}.`,
    );
  }
  if (
    (options.lookupDir !== undefined || options.lookupLog !== undefined) &&
    subcommand !== 'local-lookup'
  ) {
    throw new Error(`--dir and --log apply only to local-lookup.\n${usage()}`);
  }
  if (options.sameProcess === true && subcommand !== 'resume-chain') {
    throw new Error(`--same-process applies only to resume-chain start.\n${usage()}`);
  }

  switch (subcommand) {
    case 'make-repo': {
      const result = generateExperimentRepo(arg(0), repoRoot());
      log(`generated ${String(result.files.length)} files in ${result.targetDir}`);
      log(`git commit: ${result.gitCommit ?? `none (${result.gitError ?? 'unknown'})`}`);
      const snapshot: TreeSnapshot = snapshotTree(result.targetDir);
      for (const file of snapshot.files) {
        log(`  ${file.sha256}  ${file.relPath}`);
      }
      return 0;
    }
    case 'code-change':
      return scenarioCodeChange(arg(0), arg(1), options);
    case 'cancel-reply':
      return scenarioCancelReply(arg(0), arg(1), options);
    case 'two-turn':
      return scenarioTwoTurn(arg(0), arg(1), options);
    case 'cancel-then-follow-up':
      return scenarioCancelThenFollowUp(arg(0), arg(1), options);
    case 'probes':
      return scenarioProbes(arg(0), arg(1), arg(2));
    case 'net-shell':
      return scenarioNetShell(arg(0), arg(1));
    case 'cancel-stream':
      return scenarioCancelStream(arg(0), arg(1));
    case 'cancel-test':
      return scenarioCancelTest(arg(0), arg(1));
    case 'sever':
      return scenarioSever(arg(0), arg(1));
    case 'resume-after-dispose':
      return scenarioResumeAfterDispose(arg(0), arg(1), options);
    case 'resume-chain':
      return scenarioResumeChain(arg(0), arg(1), arg(2), options);
    case 'resume-unknown-id':
      return scenarioResumeUnknownId(arg(0), arg(1), options);
    case 'resume-controls':
      return scenarioResumeControls(arg(0), arg(1), args[2], options);
    case 'local-lookup':
      return scenarioLocalLookup(arg(0), options);
    default:
      process.stderr.write(`${usage()}\n`);
      return 64;
  }
}

// Run only as a program. A test imports the scenarios without starting one; under
// the test loader this file is an ES module, where `require` does not exist.
if (typeof require !== 'undefined' && require.main === module) {
  runScenarioCommand(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
      process.exitCode = 70;
    });
}
