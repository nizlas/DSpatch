/**
 * A live StepExecutor: agent nodes go through the existing provider adapter;
 * every other kind does not.
 *
 * This is the other half of `loop-run.ts`. The runner stays free of Node and
 * provider imports, and `createDryRunExecutor` still closes over nothing that
 * can call Cursor. A `--live` path constructs *this* executor. It is not a
 * flag the dry-run executor inspects.
 *
 * Three properties:
 *
 * **The deadline is owned here.** `StepContext.deadlineAt` is not advisory.
 * The executor races the provider turn against it, cancels, and returns
 * `step-timed-out`. A hung `send` cannot hold the runner — that was gap 8.4.
 *
 * **Cancel leaves the files.** Nothing here deletes, reverts or replays. A
 * completed step is remembered and returned again if the runner asked twice.
 *
 * **A chat-loop check is an agent.** The duration fixture still has a roleless
 * gate that this executor starts as a command; that drawing is not the chat
 * loop. An agent step reports a named verdict. Snapshots stay as corroboration.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { AgentAdapter } from '../adapter/agent-adapter';
import type {
  AgentEvent,
  DspatchSessionId,
  SessionHandle,
  UsageReading,
} from '../adapter/types';
import {
  describeContainingRefusal,
  describeRefusal,
  describeUndecidableContainment,
  findOwnRepository,
  ownRepositoryInside,
  ownRepositoryRoot,
} from './own-repository';
import {
  diffSnapshots,
  snapshotTree,
  type ChangedFile,
  type FileEntry,
  type TreeDiff,
  type TreeSnapshot,
} from './experiment-repo';
import { snapshotIdFor } from './workspace-baseline';
import type { LoopNode, StepLimits } from '../shared/loop-graph';
import {
  declaredFailureFrom,
  declaredOutcomeFrom,
  describeSnapshotChange,
  emptyReplyOutcome,
  notVerifiedOutcome,
  NOT_VERIFIED_OUTCOME,
  undeclaredReadableOutcome,
} from '../shared/loop-chat';
import type { CommandNotStarted } from '../shared/loop-record';
import type {
  StepContext,
  StepExecution,
  StepExecutor,
  StepNote,
  StepProduct,
} from '../shared/loop-run';
import { explainUnstartableCommand } from './command-start';
import { checkRunRequest, describeShell } from './test-command';

/** The prompt DSP-1 already measured against this generated repository. */
export const LIVE_DURATION_PROMPT =
  'In this repository, `src/duration.ts` exports `formatDuration`, which currently ' +
  'handles seconds only. Complete it so that the existing tests pass. The tests in ' +
  '`test/duration.test.ts` are the specification — read them. ' +
  'Edit `src/duration.ts` and nothing else: do not modify any test file, do not add ' +
  'dependencies, and do not run any commands. Reply with the single word DONE when ' +
  'the file is saved. If the premise is wrong, reply SPEC_ERROR and a sentence. ' +
  'If you cannot do the work, reply BLOCKED and a sentence.';

/** Cheapest model this account has already been seen to accept for a writing turn. */
export const DEFAULT_LIVE_MODEL = 'composer-2';

/** When a node has no `maxMinutes`, still refuse to wait forever. */
export const FALLBACK_DEADLINE_MS = 20 * 60_000;

export interface LiveCommandRecord {
  readonly command: string;
  /**
   * The command line as a person would type it, without the shell prefix `command` carries.
   *
   * DSP-45 #4 asks the record to show the command *exactly as it ran*, and `command` does
   * that — it is `cmd.exe /d /s /c cmake --build build`, which is literally what was
   * started. What it does not show is the line itself, which is the part a person reads,
   * compares with their field and retypes in a terminal. Both, rather than a choice
   * between them.
   *
   * Optional and `null` for a command spawned without a shell, where there is no prefix to
   * separate and the two would be the same string.
   */
  readonly line?: string | null;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  /**
   * When the command was **started**, not when anybody heard about it.
   *
   * Carried on the record rather than taken from the clock by whoever writes it
   * down. Both callers used to supply their own "now": `main.ts` at the moment the
   * command settled, and `closeChatLoopRecord` at the moment the record was closed,
   * which is later still — so `RecordedCommand.startedAtUtc` was a start time in
   * name only and `durationMs` could not recover the real one from either. DSP-27
   * is about to draw a timeline from this field.
   */
  readonly startedAtUtc: string;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Why no process ran, or `null` when one did.
   *
   * Its own field rather than an exit code, because an exit code is a statement
   * about the project's tests and this is a statement about DSpatch. The first
   * real chat-loop run reported "tests failed" for a C++ project it had never
   * tested, because "there was nothing to run" arrived here as `exitCode: 1`.
   *
   * A kind and a message rather than a bare sentence, because DSP-26 #2 needs
   * "there was nothing configured to run" and "there was a command and it could
   * not be started" told apart, and two booleans that have to agree eventually
   * disagree. `null` still means a process ran, so a fixture or a caller that
   * writes `notRun: null` keeps its old meaning exactly.
   */
  readonly notRun: CommandNotStarted | null;
}

export interface LiveSnapshotRef {
  readonly snapshotId: string;
  readonly takenAtUtc: string;
  readonly fileCount: number;
  readonly files: readonly FileEntry[];
}

export interface LiveInspection {
  workspacePath: string;
  modelRequested: string;
  modelReported: string | null;
  snapshotBefore: LiveSnapshotRef | null;
  snapshotAfter: LiveSnapshotRef | null;
  changedFiles: readonly ChangedFile[];
  addedFiles: readonly FileEntry[];
  removedFiles: readonly FileEntry[];
  commands: LiveCommandRecord[];
  usageReadings: UsageReading[];
  usageError: string | null;
  cost: 'unknown' | number;
  cancelled: boolean;
  replayedSteps: string[];
  sessionId: string | null;
  providerSessionId: string | null;
}

/**
 * What an agent node said, on its way out of the executor.
 *
 * `waitForTurn` has always collected this text and used it only to classify the
 * step. The chat binding shows it to the person who typed the mandate, so it
 * leaves here whole and unclassified: the caller decides what to do with it, and
 * an executor that summarised it would be deciding for the window.
 */
export interface LiveAgentReply {
  readonly nodeId: string;
  /** 1-based visit count, so a re-entered node is a separate reply. */
  readonly occurrence: number;
  /** May be empty: a turn cancelled before the model finished carries no message. */
  readonly text: string;
  /** The run's own terminal status, or `null` if it never reported one. */
  readonly terminalStatus: string | null;
  /**
   * What the agent was actually sent, whole.
   *
   * DSP-46 #1's second half. The reply has always travelled out of here; what the agent
   * was *told* did not, so a record could show an answer with no way to know what it was
   * an answer to — and with the role text now in the prompt, that is the only place the
   * role's arrival can be checked after the fact rather than asserted. Never summarised,
   * for the same reason `text` is not.
   */
  readonly prompt: string;
  /**
   * The role the drawing named for this node, as a reference rather than its prose.
   *
   * The prose is in `prompt`. This is the identity, so a reader can see that the step
   * ran as `project-work` from `docs/loop/roles/project-work.role.md` without reading
   * the prompt to find out. `null` for a node that names no role.
   */
  readonly role: { readonly id: string; readonly sourcePath: string } | null;
}

export interface LiveExecutorOptions {
  readonly workspacePath: string;
  readonly adapter: AgentAdapter;
  readonly modelRequested: string;
  /** Cursor reports a used model separately from the request. Optional on the interface. */
  readonly modelReported?: (sessionId: DspatchSessionId) => string | null;
  readonly now?: () => number;
  /**
   * Run the project's check for a gate.
   *
   * `note` is the gate step's own line into the run journal (DSP-51). A caller that
   * has to ask a person before it may start anything uses it to say so while the
   * asking is happening; a caller that just runs a command ignores it.
   */
  readonly runProjectTest?: (
    workspacePath: string,
    note: StepNote,
  ) => Promise<LiveCommandRecord>;
  readonly abortSignal?: AbortSignal;
  readonly inspection: LiveInspection;
  readonly fallbackDeadlineMs?: number;
  readonly promptFor?: (node: LoopNode) => string;
  /**
   * Called once per agent step whose provider turn was awaited, before the step's
   * product is decided. Not called when the adapter threw during the send: there
   * was no turn to report, and the fault's own detail is what says so.
   */
  readonly onAgentReply?: (reply: LiveAgentReply) => void;
  /**
   * Called with each gate command the moment it settles, so a caller can write it
   * to the run record while the run is still walking rather than reading
   * `inspection.commands` after it has ended. DSP-25 #4: a run that is interrupted
   * must still have recorded the commands it had already run.
   */
  readonly onCommand?: (command: LiveCommandRecord) => void;
}

function snapshotRef(snapshot: TreeSnapshot): LiveSnapshotRef {
  return {
    snapshotId: snapshotIdFor(snapshot),
    takenAtUtc: snapshot.takenAtUtc,
    fileCount: snapshot.files.length,
    files: snapshot.files,
  };
}

/**
 * Record what a step changed, and what the **run** has changed so far.
 *
 * Two different questions, and until a chat loop had a second agent node they had the same
 * answer, so one field answered both. DSP-45 adds `choose-check` after `work`, and that
 * exposed the conflation as a real defect: this function used to write the *step's* diff
 * straight into the inspection, so a second agent step that correctly changed nothing
 * overwrote the first step's measurement with three empty lists. The run record's changed,
 * added and removed files, the paths DSP-48 names in the ending sentence, and
 * `recordedSnapshotsFrom` all read those lists — so a run that really did change files
 * would have reported changing none, with the reason visible nowhere.
 *
 * The returned diff is the **step's**, because that is what decides the step's branch and
 * what its own sentence describes: *the project before this step and after it*. The
 * inspection's lists are the **run's**, from its first snapshot to the newest, because that
 * is what a person reading the record afterwards is asking about.
 *
 * `snapshotBefore` is written once and never overwritten, which it relied on being true
 * before and now needs to be: it is the run's origin, and diffing from anything later
 * would lose the first step's work again by a different route.
 */
function applyDiff(inspection: LiveInspection, before: TreeSnapshot, after: TreeSnapshot): TreeDiff {
  const stepDiff = diffSnapshots(before, after);
  if (inspection.snapshotBefore === null) {
    inspection.snapshotBefore = snapshotRef(before);
  }
  inspection.snapshotAfter = snapshotRef(after);
  const origin = inspection.snapshotBefore;
  const runDiff = diffSnapshots(
    { root: after.root, takenAtUtc: origin.takenAtUtc, files: origin.files },
    after,
  );
  inspection.changedFiles = runDiff.changed;
  inspection.addedFiles = runDiff.added;
  inspection.removedFiles = runDiff.removed;
  return stepDiff;
}

export function emptyInspection(workspacePath: string, modelRequested: string): LiveInspection {
  return {
    workspacePath,
    modelRequested,
    modelReported: null,
    snapshotBefore: null,
    snapshotAfter: null,
    changedFiles: [],
    addedFiles: [],
    removedFiles: [],
    commands: [],
    usageReadings: [],
    usageError: null,
    cost: 'unknown',
    cancelled: false,
    replayedSteps: [],
    sessionId: null,
    providerSessionId: null,
  };
}

/**
 * Refuse a live workspace that is, contains, or sits inside DSpatch.
 *
 * The own-repository guard exists because DSP-1 measured that an agent is not
 * confined to the folder it is given. A live writing run against DSpatch itself
 * is the ordinary mistake this increment must not make.
 */
export function refuseLiveWorkspace(workspacePath: string, appPath: string): string | null {
  const resolved = path.resolve(workspacePath);
  const found = findOwnRepository(resolved);
  if (found.kind !== 'unrelated') {
    return describeRefusal(resolved, found);
  }
  const ownRoot = ownRepositoryRoot(appPath);
  const contains = ownRepositoryInside(resolved, ownRoot);
  if (contains.kind === 'contains') {
    return describeContainingRefusal(resolved, contains);
  }
  if (contains.kind === 'undecidable') {
    return describeUndecidableContainment(resolved, contains);
  }
  return null;
}

/**
 * How long a gate command may run before DSpatch stops it and says so.
 *
 * A bound rather than a guess at how long a build takes: fifteen minutes is longer
 * than any build or suite this product has been pointed at, and the point of the
 * number is that there is one. Before there was, a command that never returned
 * held the run open with no ending and no record of why — the same user-visible
 * failure as the hung gate W2 closed, reached by a different route and not closed
 * by W2's fix.
 */
export const DEFAULT_GATE_COMMAND_TIMEOUT_MS = 15 * 60_000;

/**
 * A bound in the largest unit that does not round it away.
 *
 * `Math.round(ms / 60_000)` was the whole of this, and below thirty seconds it
 * produced *"still running after 0 minutes"* — a sentence saying the command ran for
 * no time at all. Harmless at today's fifteen-minute default and not reachable from
 * the UI, but the plan is for this bound to become a per-node budget owned by the
 * graph editor, and the first person to draw a 45-second gate budget would read it.
 */
export function describeBound(ms: number): string {
  if (ms < 1000) {
    // Not "0 seconds", and not rounded up to one either: the number is smaller than
    // the smallest unit worth printing, so say that instead of naming a duration.
    return 'less than a second';
  }
  if (ms < 60_000) {
    const seconds = Math.round(ms / 1000);
    return `${String(seconds)} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = ms / 3_600_000;
  const rounded = Math.round(hours * 10) / 10;
  return `${String(rounded)} hour${rounded === 1 ? '' : 's'}`;
}

/**
 * What DSpatch says about a command it stopped for outrunning its bound.
 *
 * **It says what it asked for, not what it achieved.** The previous wording was
 * *"so DSpatch stopped it"*, unconditionally, and the Verifier of this run measured
 * what that costs: it made a descendant survive — a hanging child that had spawned a
 * launcher which exited, the shape of every tool that starts a daemon or a compile
 * server and returns — and confirmed with `Get-Process` that the process was still
 * alive and still ticking a heartbeat file *after* DSpatch had written that sentence.
 * In the case where the tree really died, the message was byte-identical. A statement
 * that is the same whether or not it is true is not evidence, and this product's whole
 * argument is that its records are.
 *
 * `killCommandTree` cannot justify the old claim either: it spawns `taskkill` and
 * never reads its exit code, deliberately, because a kill that failed must not stop
 * the run from reporting the fact the person actually needs. So the honest sentence
 * is the one the gate's own outer backstop forty lines below already writes — the
 * command *may still be running: check for it before starting another run* — and this
 * is that sentence, with the reason it may still be running named.
 *
 * Containing the tree properly (a Windows Job Object) is DSP-34 and is not this.
 */
export function describeStoppedCommand(input: {
  readonly timeoutMs: number;
  readonly stdout: string;
  readonly stderr: string;
}): string {
  const silent = input.stdout.trim() === '' && input.stderr.trim() === '';
  return (
    `The command was still running after ${describeBound(input.timeoutMs)}, so DSpatch asked ` +
    `the operating system to stop it and the children it could find. Whether every process is ` +
    `gone is not something DSpatch can see: one started through an intermediate that has ` +
    `already exited is not reached, so the command may still be running — check for it before ` +
    `starting another run. Nothing is known about whether your project builds or its tests ` +
    `pass — this is not a test failure and not a pass. ` +
    (silent
      ? 'It printed nothing at all before it was stopped, which on Windows is what a command ' +
        'waiting on a hidden dialog looks like: check that the Command field holds something ' +
        'the shell runs rather than something Windows opens.'
      : 'What it printed before it was stopped is kept below.')
  );
}

export function runNodeProjectTest(workspacePath: string): Promise<LiveCommandRecord> {
  const args = ['--test', 'test/duration.test.ts'];
  const startedAt = Date.now();
  const child = spawn(process.execPath, args, {
    cwd: workspacePath,
    windowsHide: true,
    env: process.env,
  });
  return finishCommand(
    child,
    `${process.execPath} ${args.join(' ')}`,
    workspacePath,
    startedAt,
    null,
    DEFAULT_GATE_COMMAND_TIMEOUT_MS,
  );
}

/**
 * Gate command for a chat-loop run: exactly what the window's two fields held
 * when Send was pressed.
 *
 * **Not the suggestion.** `suggestBuildCommand` seeds the Command and Working
 * directory fields when a project opens, and the note beside them says nothing is
 * configured anywhere else. A gate that re-derived the suggestion instead runs
 * something the window never showed and the user cannot change — which is what
 * the first real chat-loop run did, on a C++/CMake project whose build is
 * `.\scripts\build-windows.ps1`. The working directory travels with the command
 * because a relative command means nothing without it, and because the window
 * presents them as one setting.
 *
 * `checkRunRequest` is the same rule the Run button applies to the same two
 * fields, so one field cannot be usable in one place and refused in the other. A
 * request that fails it starts no process and returns `notRun`. There is no
 * fallback to the suggestion: falling back would reintroduce the defect, and the
 * empty field is precisely the case where there is no suggestion to fall back to.
 */
/**
 * A command record for a command that never started, because DSpatch declined to start it.
 *
 * `no-command-configured` rather than `could-not-start`, and the distinction is the whole
 * point of the kind existing: nothing broke, nothing half-happened, and no process was
 * spawned. DSP-44 routes exactly this kind as a gate verdict the graph can carry, so a run
 * that declined to run something ends at a step saying nothing was checked instead of
 * asking a person to reconcile a machine that is working correctly.
 *
 * Exported because DSP-45 adds a second reason to arrive here — a proposed command the
 * user has not confirmed — and two functions building this shape separately would
 * eventually build it differently.
 */
export function commandNotRun(
  command: string,
  cwd: string,
  message: string,
): LiveCommandRecord {
  const line = command.trim();
  return {
    command: line,
    line: line === '' ? null : line,
    cwd: cwd.trim(),
    // No process, so no exit code. Inventing one here is precisely the defect that told
    // Niclas his C++ tests had failed.
    exitCode: null,
    signal: null,
    durationMs: 0,
    startedAtUtc: new Date().toISOString(),
    stdout: '',
    stderr: '',
    notRun: { kind: 'no-command-configured', message },
  };
}

export function runConfiguredProjectTest(
  command: string,
  cwd: string,
  timeoutMs: number | null = DEFAULT_GATE_COMMAND_TIMEOUT_MS,
): Promise<LiveCommandRecord> {
  const line = command.trim();
  const check = checkRunRequest(command, cwd);
  if (!check.ok) {
    return Promise.resolve(
      commandNotRun(
        command,
        cwd,
        check.message ?? 'DSpatch could not use the command field, and gave no reason.',
      ),
    );
  }
  const resolvedCwd = path.resolve(cwd.trim());
  const startedAt = Date.now();
  const child = spawn(line, {
    cwd: resolvedCwd,
    shell: true,
    windowsHide: true,
    env: process.env,
  });
  return finishCommand(child, `${describeShell()} ${line}`, resolvedCwd, startedAt, line, timeoutMs);
}

/**
 * Stop a command that outran its bound, and take its children with it.
 *
 * `taskkill /T /F` rather than `child.kill()` on Windows, because the gate spawns
 * through `cmd.exe`: killing the shell leaves whatever it started running, and the
 * whole reason this function exists is a case where the shell had handed the work
 * to something else. Best effort — a kill that fails must not stop the run from
 * reporting that the command did not finish, which is the fact the person needs.
 */
function killCommandTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => {
        // Nothing to do: the record already says the command did not finish.
      });
    } else {
      // Not a process group: the child was not spawned detached, so this reaches
      // `sh` and may leave what `sh` started. Named rather than implied, and
      // unmeasured — nothing here has been run on Linux.
      child.kill('SIGKILL');
    }
  } catch {
    // Same. A process that could not be killed is reported, not hidden.
  }
}

/**
 * Wait for a spawned command, and survive one that never starts.
 *
 * **The `error` listener is not decoration.** Until it was added this function
 * listened for `close` alone. The Verifier of run `20260917-182500-gate18`
 * measured what that costs: a working directory that does not exist at spawn time
 * makes Node emit `error` even with `shell: true`, because it cannot start
 * `cmd.exe` in a missing directory — and with nothing listening that became an
 * **uncaught exception in the Electron main process** while this promise never
 * settled, so the gate never returned and the whole run hung. A run that cannot
 * start its command has to report that it cannot start its command.
 *
 * Both listeners stay registered and a settled flag decides, rather than one
 * listener being removed by the other: `error` and `close` can both fire, and the
 * first honest answer is the one to keep.
 */
function finishCommand(
  child: ReturnType<typeof spawn>,
  command: string,
  cwd: string,
  startedAt: number,
  /**
   * The user's own line, without the shell prefix `command` carries for display.
   *
   * Separate because `command` reads `cmd.exe /d /s /c npm test`, whose first word
   * always exists — resolving *that* would answer a question nobody asked and
   * would quietly turn the check below into a no-op. `null` for a command spawned
   * without a shell, where a missing executable already arrives as `error`.
   */
  rawLine: string | null,
  /**
   * How long the command may run, or `null` for no bound.
   *
   * Owned here rather than raced by the caller, because the caller holds a promise
   * and this function holds the child: only this side can stop the process. A race
   * upstream would report the timeout honestly and leave the command running.
   */
  timeoutMs: number | null,
): Promise<LiveCommandRecord> {
  const startedAtUtc = new Date(startedAt).toISOString();
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (partial: LiveCommandRecord): void => {
      // The user's own line, added on every path out of this function rather than at each
      // of the four `settle` calls, so a record cannot be written without it by someone
      // adding a fifth.
      const record: LiveCommandRecord = { ...partial, line: rawLine };
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      resolve(record);
    };
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        killCommandTree(child);
        settle({
          command,
          cwd,
          // A stopped command has no exit code of its own. `signal` is left null
          // because on Windows there is none: `taskkill /T /F` ends the tree with
          // an ordinary exit code, so DSpatch's own record of having *asked* for the
          // stop is the only evidence there is — the same reason `evaluateTestVerdict`
          // checks `killedByDspatch` first, and the reason the message below claims
          // the request rather than the result.
          exitCode: null,
          signal: null,
          durationMs: Date.now() - startedAt,
          startedAtUtc,
          stdout,
          stderr,
          notRun: {
            kind: 'did-not-finish',
            message: describeStoppedCommand({ timeoutMs, stdout, stderr }),
          },
        });
      }, timeoutMs);
      timer.unref?.();
    }
    child.on('error', (error: Error) => {
      settle({
        command,
        cwd,
        // Not a fabricated code. There was no process, so there is no exit code,
        // and `null` is the only true value — inventing one here is precisely the
        // defect that told Niclas his C++ tests had failed.
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        startedAtUtc,
        stdout,
        stderr,
        notRun: {
          kind: 'could-not-start',
          message:
            `DSpatch could not start the command in ${cwd}: ${error.message} The most ` +
            `common cause is that the working directory no longer exists. Nothing ran, ` +
            `so nothing about your project was checked.`,
        },
      });
    });
    child.on('close', (code, signal) => {
      // Consulted only after a non-zero exit, and never allowed to stop a command
      // from running. See `command-start.ts` for why this is the only honest and
      // locale-safe way to tell a mistyped command from a failing test suite.
      const unstartable =
        rawLine === null
          ? null
          : explainUnstartableCommand({ line: rawLine, cwd, exitCode: code, stderr });
      settle({
        command,
        cwd,
        exitCode: code,
        signal: signal === null ? null : String(signal),
        durationMs: Date.now() - startedAt,
        startedAtUtc,
        stdout,
        stderr,
        notRun: unstartable === null ? null : { kind: 'could-not-start', message: unstartable },
      });
    });
  });
}

/**
 * The reply, read for a named verdict and nothing else.
 *
 * A first-line SPEC_ERROR / BLOCKED still wins. Otherwise a whole-line
 * `RESULT: <name>` that the node declared. Missing or contradictory names
 * take the node's cheap fallback (`unclear` / `could-not-check`) when it
 * draws one, and plain success when it draws none — which is what leaves
 * the duration fixture on its success edge.
 */
function productFromAssistantText(
  text: string,
  declared: readonly string[],
): { readonly product: StepProduct; readonly why: string | null } {
  // Before every other reading, because every other reading of an empty string
  // returns "nothing declared", and the last of them used to mean success. DSP-57
  // #1: silence is never a successful result. `emptyReplyOutcome` takes the
  // drawing's own name for an unestablished result where there is one, and returns
  // null where there is none — and a step that delivered no outcome is a runtime
  // fault rather than a step that quietly passed.
  if (text.trim() === '') {
    const empty = emptyReplyOutcome(declared);
    if (empty !== null) {
      return { product: { kind: 'outcome', outcome: empty.outcome }, why: empty.why };
    }
    return {
      product: {
        kind: 'runtime-fault',
        fault: 'no-outcome-delivered',
        detail:
          'The step finished its provider turn and wrote nothing at all. An empty reply ' +
          'is not a result and is not a success, and this step draws no outcome for a ' +
          'result it could not establish, so there is nothing to route on. Anything the ' +
          'agent changed is still in the working copy, unchecked. Nothing was repeated.',
      },
      why: null,
    };
  }
  const failure = declaredFailureFrom(text);
  if (failure !== null) {
    return { product: { kind: 'declared-failure', failure }, why: null };
  }
  const named = declaredOutcomeFrom(text, declared);
  if (named !== null) {
    return { product: { kind: 'outcome', outcome: named.outcome }, why: named.why };
  }
  const fallback = undeclaredReadableOutcome(declared);
  if (fallback !== null) {
    return { product: { kind: 'outcome', outcome: fallback.outcome }, why: fallback.why };
  }
  return { product: { kind: 'success' }, why: null };
}

function remainingMs(
  deadlineAt: number | null,
  now: () => number,
  fallbackMs: number,
): number {
  if (deadlineAt === null) {
    return fallbackMs;
  }
  return Math.max(0, deadlineAt - now());
}

interface TurnWait {
  readonly finished: Promise<void>;
  readonly assistantText: () => string;
  readonly terminalStatus: () => string | null;
  readonly terminalError: () => string | null;
  readonly runId: () => string;
  readonly readings: () => UsageReading[];
}

function waitForTurn(adapter: AgentAdapter, sessionId: DspatchSessionId): TurnWait {
  let assistantText = '';
  let terminalStatus: string | null = null;
  let terminalError: string | null = null;
  let runId = '';
  const readings: UsageReading[] = [];
  let resolveFinished: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const unsubscribe = adapter.subscribe(sessionId, (event: AgentEvent) => {
    if (runId === '') {
      runId = event.dspatchRunId;
    }
    if (event.dspatchRunId !== runId) {
      return;
    }
    if (event.type === 'assistant.message') {
      assistantText += event.text;
    }
    if (event.type === 'usage') {
      readings.push(...event.readings);
    }
    if (event.type === 'run.finished') {
      terminalStatus = event.status;
      terminalError = event.error?.message ?? null;
      unsubscribe();
      resolveFinished?.();
    }
  });

  return {
    finished,
    assistantText: () => assistantText,
    terminalStatus: () => terminalStatus,
    terminalError: () => terminalError,
    runId: () => runId,
    readings: () => readings,
  };
}

function describeLimits(limits: StepLimits): string {
  const parts: string[] = [];
  if (limits.maxMinutes !== undefined) {
    parts.push(`${String(limits.maxMinutes)} minutes`);
  }
  if (limits.maxCalls !== undefined) {
    parts.push(`${String(limits.maxCalls)} calls`);
  }
  return parts.length === 0 ? 'the executor fallback deadline' : parts.join(', ');
}

/**
 * A live executor. Agent nodes call the injected adapter; nothing else does.
 */
export function createLiveExecutor(options: LiveExecutorOptions): StepExecutor {
  const now = options.now ?? (() => Date.now());
  const fallbackMs = options.fallbackDeadlineMs ?? FALLBACK_DEADLINE_MS;
  const completed = new Map<string, StepExecution>();
  const inspection = options.inspection;
  let session: SessionHandle | null = null;
  let sessionStarted = false;

  const remember = (context: StepContext, execution: StepExecution): StepExecution => {
    completed.set(`${context.node.id}:${String(context.occurrence)}`, execution);
    return execution;
  };

  return async (context: StepContext): Promise<StepExecution> => {
    const key = `${context.node.id}:${String(context.occurrence)}`;
    const previous = completed.get(key);
    if (previous !== undefined) {
      inspection.replayedSteps.push(key);
      return previous;
    }

    const { node } = context;

    if (node.kind === 'human') {
      return remember(context, {
        product: {
          kind: 'awaiting-human',
          question: node.purpose ?? `"${node.id}" needs a person before the run can continue.`,
        },
        summary: 'No provider turn: this is a human step. Files and history were left as they are.',
        providerTurns: 0,
      });
    }

    if (node.kind === 'router') {
      const first = node.outcomes?.[0];
      return remember(context, {
        product: first === undefined ? { kind: 'success' } : { kind: 'outcome', outcome: first },
        summary:
          first === undefined
            ? 'No provider turn: a router with no declared outcome finished on success.'
            : `No provider turn: the router took its first declared outcome, "${first}".`,
        providerTurns: 0,
      });
    }

    if (node.kind === 'gate') {
      const runTest = options.runProjectTest ?? runNodeProjectTest;
      // Raced against the step's own deadline, the way the agent branch below
      // races the provider turn. This branch used to be a bare `await runTest(…)`
      // with nothing beside it, so `StepContext.deadlineAt` — which the graph
      // declares and the runner computes — was simply not enforced for a gate: the
      // runner never regained control to check it. A command that did not return
      // held the run open with no ending, no output and no window.
      //
      // The inner bound in `runConfiguredProjectTest` is the one that stops the
      // process; this is the backstop that stops the *run* from waiting on any
      // injected `runTest` that never settles, including one with no bound of its
      // own. Both are needed: only the spawner can kill, and only the executor can
      // decline to wait.
      const gateWaitMs = remainingMs(context.deadlineAt, now, fallbackMs);
      const abandoned = Symbol('gate-command-did-not-finish');
      let gateTimer: ReturnType<typeof setTimeout> | null = null;
      const raced = await Promise.race([
        runTest(options.workspacePath, context.note),
        new Promise<typeof abandoned>((resolve) => {
          gateTimer = setTimeout(() => resolve(abandoned), gateWaitMs);
          gateTimer.unref?.();
        }),
      ]);
      if (gateTimer !== null) {
        clearTimeout(gateTimer);
      }
      const command: LiveCommandRecord =
        raced === abandoned
          ? {
              command: `(the gate "${node.id}" command)`,
              cwd: options.workspacePath,
              exitCode: null,
              signal: null,
              durationMs: gateWaitMs,
              startedAtUtc: new Date(now() - gateWaitMs).toISOString(),
              stdout: '',
              stderr: '',
              notRun: {
                kind: 'did-not-finish',
                message:
                  `The gate's command had not come back against ${describeLimits(context.limits)}, ` +
                  `so DSpatch stopped waiting for it. Nothing is known about whether your ` +
                  `project builds or its tests pass. The command may still be running: check ` +
                  `for it before starting another run.`,
              },
            }
          : raced;
      inspection.commands.push(command);
      options.onCommand?.(command);
      // The state the command ran against, before it is overwritten below.
      //
      // DSP-45 #5. Not a second snapshot taken for this: the run's `snapshotAfter` at the
      // moment the gate is entered *is* the tree the command was handed, because the step
      // before the gate ended by recording it and nothing between them writes. Comparing
      // it with the tree afterwards is the only way to say *your check changed the thing
      // it was checking*, which for a CMake project is the difference between "the tests
      // pass" and "the build directory this was measured from no longer exists".
      const ranAgainst = inspection.snapshotAfter;
      const after = snapshotTree(options.workspacePath);
      if (inspection.snapshotBefore === null) {
        inspection.snapshotBefore = snapshotRef(after);
      }
      inspection.snapshotAfter = snapshotRef(after);
      // `null` where either identity is missing, and `null` means *not established*. A
      // gate that could not hash one side of the comparison must not report "unchanged",
      // which is the one reading that would let a self-modifying check pass unremarked.
      const changedWhileChecking: boolean | null =
        ranAgainst === null || command.notRun !== null
          ? null
          : ranAgainst.snapshotId !== snapshotIdFor(after);
      const selfModified =
        changedWhileChecking === true
          ? ` This command changed the working copy while it ran (${ranAgainst?.snapshotId ?? 'unknown'} ` +
            `→ ${snapshotIdFor(after)}), so what it measured is not what it left behind. ` +
            `That is an observation and not a judgement: many builds write into their own ` +
            `tree. It matters because the result below describes the state before those ` +
            `writes.`
          : '';
      // A gate that started no process has produced no verdict on the project, so
      // it may not return `pass` or `fail`. What it returns instead depends on
      // *why*, and DSP-44 moves exactly one of the three reasons.
      //
      // **"There was nothing to run" is a verdict, and the graph may route it.**
      // A project whose check nobody has worked out is an ordinary state, not a
      // broken machine, and `stop-and-reconcile` is what a person does when
      // something might have half-happened. Nothing half-happened: no process
      // started. Asking for reconciliation here teaches people that DSpatch's
      // reconciliation messages can be ignored, which is expensive for the ones
      // that matter.
      //
      // **The other two stay faults**, because in those something really did break
      // and the step's real outcome is genuinely unknown: a command that could not
      // be started may have started nothing or may have started something the
      // shell then lost, and one that did not finish may still be running.
      //
      // Gated on the node's own declaration rather than applied to every gate, so a
      // graph that draws no `not-verified` edge — `dspatch-live-duration`, and every
      // graph written before today — still stops rather than silently walking on
      // from a check that did not happen.
      const notVerified =
        command.notRun?.kind === 'no-command-configured'
          ? notVerifiedOutcome(node.outcomes ?? [])
          : null;
      if (command.notRun !== null && notVerified !== null) {
        return remember(context, {
          product: { kind: 'outcome', outcome: notVerified },
          summary:
            `No provider turn and no command: ${command.notRun.message} This is the gate's ` +
            `"${notVerified}" verdict, not a pass and not a failure — nothing is known about ` +
            `whether the project builds or its tests pass, and anything the agent changed is ` +
            `still in the working copy, unchecked. Snapshot ${snapshotIdFor(after)}. Files ` +
            `were left as they are.`,
          providerTurns: 0,
        });
      }
      if (command.notRun !== null) {
        // Two states, not one. "Nothing was configured to run" is a gap in what the
        // user told DSpatch; "there was a command and it would not start" is a fault
        // in the machinery or the environment. Both mean the project was not tested,
        // and merging them would put the reader to work finding out which.
        const opening =
          command.notRun.kind === 'could-not-start'
            ? `The gate "${node.id}" could not start the command it was given, so this run ` +
              `says nothing about whether the project builds or its tests pass — it is not ` +
              `a test failure.`
            : command.notRun.kind === 'did-not-finish'
              ? `The gate "${node.id}" started its command and it did not finish, so this run ` +
                `says nothing about whether the project builds or its tests pass — it is ` +
                `neither a pass nor a test failure.`
              : // Reachable only on a graph that declares no `not-verified` outcome for
                // this gate, since one that does took the branch above. Saying so is
                // the useful half: the reader's next question is why an ordinary state
                // stopped the run, and the answer is in the drawing rather than in the
                // project.
                `The gate "${node.id}" ran no command, so this run says nothing about whether ` +
                `the project builds or its tests pass — it is not a test failure. This ` +
                `drawing gives "${node.id}" no "${NOT_VERIFIED_OUTCOME}" outcome to route ` +
                `that through, so the run stops here instead of ending at a step that says ` +
                `nothing was checked.`;
        return remember(context, {
          product: {
            kind: 'runtime-fault',
            // A command stopped for outrunning its bound is a spent bound, not a
            // missing answer, and the runner words the two differently.
            fault: command.notRun.kind === 'did-not-finish' ? 'step-timed-out' : 'no-outcome-delivered',
            detail:
              `${opening} ${command.notRun.message} Anything the agent changed is still in ` +
              `the working copy, unchecked.`,
          },
          summary:
            `No provider turn and no command: ${command.notRun.message} Snapshot ` +
            `${snapshotIdFor(after)}. Files were left as they are.`,
          providerTurns: 0,
        });
      }
      const passed = command.exitCode === 0;
      return remember(context, {
        product: { kind: 'outcome', outcome: passed ? 'pass' : 'fail' },
        summary:
          `No provider turn. Ran ${command.command} in ${command.cwd}; exit ` +
          `${String(command.exitCode)}. Snapshot ${snapshotIdFor(after)}.${selfModified}`,
        providerTurns: 0,
      });
    }

    if (node.kind === 'terminal') {
      return remember(context, {
        product: { kind: 'success' },
        summary: 'No provider turn: a terminal is the runner stopping, not work.',
        providerTurns: 0,
      });
    }

    if (node.kind === 'external') {
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'no-outcome-delivered',
          detail: `This increment does not run external nodes. "${node.id}" was not called.`,
        },
        summary: 'No provider turn: an external node is out of this call.',
        providerTurns: 0,
      });
    }

    // Agent: the only kind that may reach the adapter.
    const reusedSession = session !== null;
    const waitMs = remainingMs(context.deadlineAt, now, fallbackMs);
    if (waitMs === 0 || options.abortSignal?.aborted === true) {
      inspection.cancelled = true;
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: options.abortSignal?.aborted === true ? 'no-outcome-delivered' : 'step-timed-out',
          detail:
            options.abortSignal?.aborted === true
              ? `The operator cancelled before "${node.id}" started. Files were left as they are.`
              : `"${node.id}" had no time left against ${describeLimits(context.limits)} before it started.`,
        },
        summary: 'The agent was not started. Nothing was replayed.',
        providerTurns: 0,
      });
    }

    if (!sessionStarted) {
      sessionStarted = true;
      session = await options.adapter.startSession({
        provider: 'cursor',
        modelRequested: options.modelRequested,
        workspacePath: options.workspacePath,
      });
      inspection.sessionId = session.dspatchSessionId;
      inspection.providerSessionId = session.providerSessionId;
    }
    if (session === null) {
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'executor-threw',
          detail: `No session was available for "${node.id}".`,
        },
        summary: 'The adapter session was missing.',
        providerTurns: 0,
      });
    }

    const before = snapshotTree(options.workspacePath);
    if (inspection.snapshotBefore === null) {
      inspection.snapshotBefore = snapshotRef(before);
    }

    const turn = waitForTurn(options.adapter, session.dspatchSessionId);
    const prompt = (options.promptFor ?? (() => LIVE_DURATION_PROMPT))(node);

    let timedOut = false;
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = (): void => {
      aborted = true;
      void options.adapter.cancel(session!.dspatchSessionId).catch(() => {
        // Cancel is best-effort. The files stay either way.
      });
    };
    options.abortSignal?.addEventListener('abort', onAbort, { once: true });

    try {
      await options.adapter.send(session.dspatchSessionId, prompt);
      await Promise.race([
        turn.finished,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            void options.adapter.cancel(session!.dspatchSessionId).catch(() => {
              // Same as operator cancel: leave the files, do not wait forever.
            });
            resolve();
          }, waitMs);
        }),
      ]);
    } catch (error) {
      const after = snapshotTree(options.workspacePath);
      applyDiff(inspection, before, after);
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'executor-threw',
          detail: `The adapter failed during "${node.id}": ${
            error instanceof Error ? error.message : String(error)
          }.`,
        },
        summary: `Provider contact failed. Snapshot after: ${snapshotIdFor(after)}. Files were not reset.`,
        providerTurns: 1,
      });
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      options.abortSignal?.removeEventListener('abort', onAbort);
    }

    const after = snapshotTree(options.workspacePath);
    const diff = applyDiff(inspection, before, after);
    // Before the branches below, so that a cancelled, timed-out or faulted turn
    // still hands over whatever the agent had said. Its own account of what it did
    // to the project is most useful precisely when the run did not end cleanly.
    options.onAgentReply?.({
      nodeId: node.id,
      occurrence: context.occurrence,
      text: turn.assistantText(),
      terminalStatus: turn.terminalStatus(),
      prompt,
      role:
        node.role === undefined
          ? null
          : { id: node.role.id, sourcePath: node.role.source.path },
    });
    inspection.modelReported = options.modelReported?.(session.dspatchSessionId) ?? inspection.modelReported;
    inspection.usageReadings.push(...turn.readings());
    if (inspection.cost === 'unknown') {
      const cents = inspection.usageReadings.find(
        (reading) => reading.unit === 'cents' && reading.value !== null,
      );
      if (cents?.value !== null && cents !== undefined) {
        inspection.cost = cents.value;
      }
    }

    if (timedOut || aborted) {
      inspection.cancelled = true;
      const changed = diff.changed.map((file) => file.relPath).join(', ') || 'none';
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: timedOut ? 'step-timed-out' : 'no-outcome-delivered',
          detail: timedOut
            ? `"${node.id}" outran ${describeLimits(context.limits)} and was cancelled. ` +
              `Changed files left as they are: ${changed}. The step was not replayed.`
            : `The operator cancelled "${node.id}". Changed files left as they are: ${changed}. ` +
              `The step was not replayed.`,
        },
        summary:
          `Cancelled. Snapshot before ${snapshotIdFor(before)}, after ${snapshotIdFor(after)}. ` +
          `Files were not reset.`,
        providerTurns: 1,
      });
    }

    const status = turn.terminalStatus();
    if (status === 'error' || status === null) {
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'no-outcome-delivered',
          detail:
            `"${node.id}" ended without a usable outcome` +
            (turn.terminalError() === null ? '.' : `: ${turn.terminalError()}`),
        },
        summary: `No routable product. Snapshot after ${snapshotIdFor(after)}. Files were not reset.`,
        providerTurns: 1,
      });
    }

    if (status === 'cancelled') {
      inspection.cancelled = true;
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'no-outcome-delivered',
          detail: `"${node.id}" was cancelled by the provider. Files were left as they are.`,
        },
        summary: `Cancelled. Snapshot after ${snapshotIdFor(after)}.`,
        providerTurns: 1,
      });
    }

    const declared = productFromAssistantText(turn.assistantText(), node.outcomes ?? []);
    const corroboration = describeSnapshotChange({
      changedFiles: diff.changed.length,
      addedFiles: diff.added.length,
      removedFiles: diff.removed.length,
      paths: [
        ...diff.changed.map((file) => file.relPath),
        ...diff.added.map((file) => file.relPath),
        ...diff.removed.map((file) => file.relPath),
      ],
    });
    const sessionNote = reusedSession
      ? ' This step reused the provider session already open for this run; it is not an independent judge of earlier steps.'
      : '';
    const changed = diff.changed.map((file) => `${file.relPath} ${file.beforeSha256.slice(0, 16)}→${file.afterSha256.slice(0, 16)}`);
    return remember(context, {
      product: declared.product,
      summary:
        `One provider turn. Requested ${options.modelRequested}, reported ` +
        `${inspection.modelReported ?? 'unknown'}. Snapshot ${snapshotIdFor(before)} → ` +
        `${snapshotIdFor(after)}. Changed: ${changed.length > 0 ? changed.join(', ') : 'none'}.` +
        (declared.why === null ? '' : ` ${declared.why}`) +
        ` ${corroboration}` +
        sessionNote,
      providerTurns: 1,
    });
  };
}

export async function readLiveUsage(
  adapter: AgentAdapter,
  sessionId: DspatchSessionId,
  inspection: LiveInspection,
): Promise<void> {
  try {
    const readings = await adapter.readUsage({ of: 'session', dspatchSessionId: sessionId });
    inspection.usageReadings.push(...readings);
    const cents = readings.find((reading) => reading.unit === 'cents' && reading.value !== null);
    if (cents?.value !== null && cents !== undefined) {
      inspection.cost = cents.value;
    }
  } catch (error) {
    inspection.usageError =
      error instanceof Error
        ? error.message
        : String(error);
    inspection.cost = 'unknown';
  }
}

export function formatLiveInspection(inspection: LiveInspection): string {
  const changed =
    inspection.changedFiles.length === 0
      ? '(none)'
      : inspection.changedFiles
          .map(
            (file) =>
              `${file.relPath} ${file.beforeSha256.slice(0, 16)}→${file.afterSha256.slice(0, 16)} ` +
              `(${String(file.beforeBytes)}→${String(file.afterBytes)} bytes)`,
          )
          .join('\n            ');
  const commands =
    inspection.commands.length === 0
      ? '(none)'
      : inspection.commands
          .map((command) =>
            command.notRun === null
              ? `${command.command}  exit=${String(command.exitCode)}  ${String(command.durationMs)}ms`
              : `(${command.notRun.kind}: ${command.notRun.message})`,
          )
          .join('\n            ');
  return [
    `workspace   ${inspection.workspacePath}`,
    `model req   ${inspection.modelRequested}`,
    `model used  ${inspection.modelReported ?? 'unknown (not reported)'}`,
    `session     ${inspection.sessionId ?? '(none)'}`,
    `provider    ${inspection.providerSessionId ?? '(none)'}`,
    `snap before ${inspection.snapshotBefore?.snapshotId ?? '(none)'}  files=${String(inspection.snapshotBefore?.fileCount ?? 0)}`,
    `snap after  ${inspection.snapshotAfter?.snapshotId ?? '(none)'}  files=${String(inspection.snapshotAfter?.fileCount ?? 0)}`,
    `changed     ${changed}`,
    `commands    ${commands}`,
    `cost        ${inspection.cost === 'unknown' ? 'unknown (not zero)' : `${String(inspection.cost)} cents`}`,
    `usage err   ${inspection.usageError ?? '(none)'}`,
    `cancelled   ${inspection.cancelled ? 'yes — files left as they were; no replay' : 'no'}`,
    '',
  ].join('\n');
}

export function writeInspectionJson(filePath: string, inspection: LiveInspection): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const serialisable = {
    ...inspection,
    snapshotBefore: inspection.snapshotBefore,
    snapshotAfter: inspection.snapshotAfter,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(serialisable, null, 2)}\n`, 'utf8');
}
