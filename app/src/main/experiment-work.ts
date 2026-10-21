import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

import type { AgentAdapter } from '../adapter/agent-adapter';
import {
  assessAuthentication,
  ClaudeAgentSdkAdapter,
  type AuthenticationAssessment,
  type ClaudeQueryFunction,
  type LiveAuthorization,
} from '../adapter/claude-agent-sdk-adapter';
import { CursorSdkAdapter } from '../adapter/cursor-sdk-adapter';
import type { AgentEvent, UsageReading } from '../adapter/types';
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
 * `two-turn`. A Claude run refuses to start unless {@link guardClaudeRun} passes:
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
  error: { message: string; providerCode: string | null } | null;
  readonly usageEvents: Array<{ atMs: number; readings: readonly UsageReading[] }>;
  readonly toolCalls: Array<{ atMs: number; name: string; phase: string }>;
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
    if (turn.runId === '') {
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
        });
        detail = { name: event.name };
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
        if (event.error !== undefined) {
          turn.error = {
            message: event.error.message,
            providerCode: event.error.providerCode ?? null,
          };
        }
        detail = { status: event.status, error: turn.error };
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
      await adapter.send(sessionId, prompt);
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
  /** How long to keep listening after a cancelled turn's terminal event. Default 5 s. */
  readonly afterTerminalWatchMs?: number;
  /** Substitute for {@link readSourceRevision}. Tests only. */
  readonly sourceRevision?: () => SourceRevision;
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
    return new ClaudeAgentSdkAdapter({
      authorization: options.authorization ?? null,
      env: options.env ?? process.env,
      ...(options.claudeQueryFn === undefined ? {} : { queryFn: options.claudeQueryFn }),
    });
  }
  return new CursorSdkAdapter({ toolPolicy: 'provider-default' });
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

function sdkPackageVersion(): string | null {
  const starts = [typeof __dirname === 'string' ? __dirname : null, process.cwd()].filter(
    (start): start is string => start !== null,
  );
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      const candidate = path.join(
        dir,
        'node_modules',
        '@anthropic-ai',
        'claude-agent-sdk',
        'package.json',
      );
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: unknown };
        return typeof parsed.version === 'string' ? parsed.version : null;
      } catch {
        // Not here; go up.
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return null;
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
 * Exit code when the scenario's own criteria were met but a direct API-key run's
 * authentication was not verified (status `mismatch` or `unconfirmed`). Only ever
 * replaces 0; every other code keeps its meaning and its cause.
 */
export const EXIT_AUTHENTICATION_UNVERIFIED = 5;

/**
 * - `verified`: direct API-key preflight, and every turn's init message reported
 *   the expected `apiKeySource`.
 * - `mismatch`: direct API-key preflight, and at least one init message reported
 *   a different `apiKeySource`.
 * - `unconfirmed`: direct API-key preflight, no different value seen, but some
 *   turn has no observation (no init message, no `apiKeySource` in it, init
 *   messages and turns not one-to-one, or no turn sent).
 * - `not-applicable`: any other preflight; `apiKeySource` cannot verify it and the
 *   exit code is not affected.
 */
export type AuthenticationVerificationStatus =
  | 'verified'
  | 'mismatch'
  | 'unconfirmed'
  | 'not-applicable';

const VERDICT_CHECK_NOTE =
  'a verdict check after observation: it compares what the init messages reported ' +
  'with what the preflight expected once the turns have run. It does not establish ' +
  'authentication before the first provider request and does not prevent charges ' +
  'already incurred.';

/**
 * Whether the approved authentication path was the one observed, turn by turn.
 * One init message is expected per turn (one `query()` each); when the counts
 * differ the observations cannot be assigned to turns and the result is at best
 * `unconfirmed`. Names and documented enum values only, never credential values.
 */
export function verifyAuthentication(
  assessment: AuthenticationAssessment,
  inits: readonly Record<string, unknown>[],
  turnLabels: readonly string[],
): Record<string, unknown> & { readonly status: AuthenticationVerificationStatus } {
  const decision = assessment.preflight.decision;
  const expected = assessment.preflight.expectedApiKeySource;
  const observedPerInit = inits.map((init) =>
    typeof init['apiKeySource'] === 'string' ? init['apiKeySource'] : null,
  );
  const base = {
    preflightDecision: decision,
    expected,
    observedPerInit,
    turnsSent: turnLabels.length,
    initMessagesObserved: inits.length,
    note: VERDICT_CHECK_NOTE,
  };
  if (decision !== 'direct-anthropic-api-key' || expected === null) {
    return {
      ...base,
      status: 'not-applicable',
      reason:
        decision === 'no-api-credential'
          ? 'no direct API-key path was approved; the installed SDK types (sdk.d.ts 0.3.306) ' +
            "document apiKeySource 'none' alike for a claude.ai OAuth login, a bearer token " +
            'and a third-party cloud provider, so it cannot verify which path was used; the ' +
            'exit code is not changed'
          : `preflight decision '${decision}' expects no apiKeySource; the exit code is not changed`,
    };
  }
  const attributable = inits.length === turnLabels.length;
  const observedPerTurn = attributable
    ? turnLabels.map((turn, index) => ({ turn, apiKeySource: observedPerInit[index] ?? null }))
    : null;
  const different = observedPerInit.filter(
    (value): value is string => value !== null && value !== expected,
  );
  const missingTurns =
    observedPerTurn?.filter((entry) => entry.apiKeySource === null).map((entry) => entry.turn) ??
    [];
  let status: AuthenticationVerificationStatus;
  let reason: string;
  if (different.length > 0) {
    status = 'mismatch';
    reason = `an init message reported apiKeySource ${different
      .map((value) => `'${value}'`)
      .join(', ')} where '${expected}' was expected`;
  } else if (turnLabels.length === 0) {
    status = 'unconfirmed';
    reason = 'no turn was sent, so nothing was observed';
  } else if (!attributable) {
    status = 'unconfirmed';
    reason = `${String(inits.length)} init message(s) for ${String(
      turnLabels.length,
    )} turn(s): observations cannot be assigned to turns, so at least one turn is unverified`;
  } else if (missingTurns.length > 0) {
    status = 'unconfirmed';
    reason = `no apiKeySource was observed for turn(s) ${missingTurns.join(', ')}`;
  } else {
    status = 'verified';
    reason = `every turn's init message reported apiKeySource '${expected}'`;
  }
  return { ...base, observedPerTurn, status, reason };
}

/**
 * For a Claude run: record the authentication verification and return the exit
 * code it implies. A scenario failure keeps its code; only a would-be success of a
 * direct API-key run whose authentication was not verified becomes
 * {@link EXIT_AUTHENTICATION_UNVERIFIED}. Cursor runs are returned unchanged.
 */
function applyAuthenticationVerdict(
  adapter: AgentAdapter,
  record: Record<string, unknown>,
  turns: readonly TurnLog[],
  scenarioExitCode: number,
): number {
  if (!(adapter instanceof ClaudeAgentSdkAdapter)) {
    return scenarioExitCode;
  }
  const session = record['session'] as { dspatchSessionId?: unknown } | undefined;
  let inits: Record<string, unknown>[] = [];
  if (typeof session?.dspatchSessionId === 'string') {
    try {
      inits = adapter
        .initMessages(session.dspatchSessionId)
        .map((message) => message as Record<string, unknown>);
    } catch {
      // The session is gone: nothing observed, which leaves the result unconfirmed.
    }
  }
  const verification = verifyAuthentication(
    adapter.authentication(),
    inits,
    turns.map((turn) => turn.label),
  );
  const unverified = verification.status === 'mismatch' || verification.status === 'unconfirmed';
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

/** What a Claude run record carries beyond the provider-generic fields. */
function claudeObservations(
  adapter: ClaudeAgentSdkAdapter,
  sessionId: string,
  providerSessionId: string,
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
  const managedKeys =
    first === undefined ? [] : Object.keys(first).filter((key) => /managed|policy/i.test(key));
  return {
    sdkVersion: sdkPackageVersion(),
    node: process.versions.node,
    permissions: adapter.permissionPolicy(),
    authentication: adapter.authentication(),
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
          },
    initSessionIds: inits.map((init) => init['session_id'] ?? null),
    apiKeySource: apiKeySourceComparison(adapter.authentication(), inits),
    toolsMatchConfigured:
      reportedTools === null
        ? null
        : JSON.stringify(reportedTools.map(String).sort()) === JSON.stringify(configured),
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
    exitCode = applyAuthenticationVerdict(adapter, record, turns, exitCode);
    await adapter.dispose();
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
  }
  return exitCode;
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
  const session = record['session'] as { dspatchSessionId?: unknown } | undefined;
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
 */
export async function scenarioCancelReply(
  repoDir: string,
  logPath: string,
  options: ScenarioOptions = {},
): Promise<number> {
  const target = path.resolve(repoDir);
  const record: Record<string, unknown> = {
    scenario: 'DSP-109 cancel-reply — cancel after streamed assistant text began',
    startedAtUtc: new Date().toISOString(),
    node: process.versions.node,
    testRepo: target,
    prompt: CANCEL_REPLY_PROMPT,
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
      const turn = await recorder.send('cancelled-reply', CANCEL_REPLY_PROMPT);
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
      record['cancellation'] = {
        cancelledAfterTextBegan: textBegan,
        firstTextMsAfterSend: turn.firstTextMs,
        cancelStartedMsAfterSend: cancelStartedMs,
        cancelResolvedMsAfterSend: cancelResolvedMs,
        cancelError,
        terminalEventMsAfterCancelCall: terminalAfterCancelMs,
        waitError,
        terminalStatus: turn.terminalStatus,
        runError: turn.error,
        watchedAfterTerminalMs: watchMs,
        eventsAfterTerminal: turn.events.filter((event) => event.afterTerminal),
        toolCallsStartedAfterCancelResolved,
      };
      record['contentDiff'] = diff;
      record['noContentChange'] = noContentChange;
      record['verdict'] = {
        cancelledAfterTextBegan: textBegan,
        terminalStatusCancelled: turn.terminalStatus === 'cancelled',
        noContentChange,
        toolCallStartedAfterCancelResolved: toolCallsStartedAfterCancelResolved.length > 0,
      };
      record['turns'] = recorder.turns;
      record['capabilities'] = adapter.capabilities();
      exitCode =
        textBegan && turn.terminalStatus === 'cancelled' && noContentChange ? 0 : 2;
    } finally {
      recorder.stop();
    }
  } catch (error) {
    record['failure'] = describeError(error);
    log(`FAILURE: ${String((record['failure'] as { message: string }).message)}`);
    exitCode = 3;
  } finally {
    recordClaudeObservations(adapter, record, options);
    exitCode = applyAuthenticationVerdict(adapter, record, turns, exitCode);
    await adapter.dispose();
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
      const initSessionIds =
        adapter instanceof ClaudeAgentSdkAdapter
          ? adapter
              .initMessages(sessionId)
              .map((init) => (init as Record<string, unknown>)['session_id'] ?? null)
          : null;
      const sameProviderSession =
        initSessionIds === null
          ? null
          : initSessionIds.length === 2 &&
            initSessionIds[0] !== null &&
            initSessionIds[0] === initSessionIds[1];
      record['continuity'] = {
        turnStatuses: [first.terminalStatus, second.terminalStatus],
        secondAnswer: answer,
        secondAnswerContainsNonce: containsNonce,
        providerSessionIdPerTurn: initSessionIds,
        sameProviderSessionBothTurns: sameProviderSession,
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
    exitCode = applyAuthenticationVerdict(adapter, record, turns, exitCode);
    await adapter.dispose();
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(logPath, record);
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
    '  probes        <workspaceDir> <outsideDir> <logPath>',
    '  net-shell     <workspaceDir> <logPath>',
    '  cancel-stream <workspaceDir> <logPath>',
    '  cancel-test   <repoDir> <logPath>',
    '  sever         <workspaceDir> <logPath>',
    '',
    'provider flags (DSP-109):',
    '  --provider=cursor|claude                  default cursor',
    '  --api-key-approval=<reference>            records an explicit API-key approval',
    '  --subscription-authorization=<reference>  records the authorization for',
    '                                            subscription-backed use',
    'A claude run refuses to start without one of the last two, and refuses an API',
    'credential variable in its environment without an API-key approval.',
    'Exit 5: a Claude run with an API-key approval met its own criteria, but not',
    "every turn's init message reported apiKeySource 'ANTHROPIC_API_KEY'. This is",
    'checked after the turns ran; it does not prevent charges already incurred.',
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
  return { positional, options: { provider, authorization } };
}

async function main(): Promise<number> {
  const { positional, options } = parseScenarioArgs(process.argv.slice(2));
  const [subcommand, ...args] = positional;
  const arg = (index: number): string => {
    const value = args[index];
    if (value === undefined) {
      throw new Error(`Missing argument ${String(index + 1)}.\n${usage()}`);
    }
    return value;
  };

  const providerAware = ['code-change', 'cancel-reply', 'two-turn'];
  if (options.provider !== 'cursor' && !providerAware.includes(subcommand ?? '')) {
    throw new Error(
      `--provider=${String(options.provider)} applies only to ${providerAware.join(', ')}.`,
    );
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
    default:
      process.stderr.write(`${usage()}\n`);
      return 64;
  }
}

// Run only as a program. A test imports the scenarios without starting one; under
// the test loader this file is an ES module, where `require` does not exist.
if (typeof require !== 'undefined' && require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
      process.exitCode = 70;
    });
}
