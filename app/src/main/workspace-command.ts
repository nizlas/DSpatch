/**
 * DSpatch's one way of running a command it starts itself in a working folder (DSP-145):
 * a loop's gate step and the chat's Run button. The agent's own commands are not run
 * here: since DSP-146 the agent runs them with its runtime's own shell tool, and DSpatch
 * records what the runtime reports (INTERACTION_MODEL.md sections 1 and 8).
 *
 * Moved out of `loop-live.ts`, where the loop's gate node grew it: spawn through the
 * platform shell in a known folder, a time bound that DSpatch enforces, a stop that
 * reaches the child processes, an honest record when nothing could start, and no
 * exception escaping into the main process.
 *
 * What the move added, and only for callers that ask for it:
 *
 * - an `AbortSignal`: aborting stops the process tree, and the record says DSpatch
 *   stopped it (`killedByDspatch`, `stoppedBy: 'cancel'`);
 * - an output bound, keeping the **end** of each stream (where a test runner's summary
 *   is) and saying how much was left out;
 * - snapshots of every working folder just before the process starts and just after it
 *   ends, so a result is tied to the code it ran against - `null` where a folder could
 *   not be read, which means **not observed**, never "unchanged";
 * - who asked for it (`requestedBy`).
 *
 * The gate keeps its behaviour exactly: `runConfiguredProjectTest` in `loop-live.ts`
 * calls {@link runWorkspaceCommand} with no output bound and no snapshots and returns
 * the record shape it always returned.
 *
 * **Not a sandbox.** The command runs with the user's own rights and can reach anything
 * the user can; the working folder is where it starts, not a boundary. No new Windows
 * dependency: `taskkill` and the POSIX process group are what the gate already used.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import type {
  AgentCommandEnding,
  AgentCommandRequester,
} from '../adapter/types';
import type { TestVerdict } from '../shared/bridge';
import type { CommandNotStarted } from '../shared/loop-record';
import { explainUnstartableCommand } from './command-start';
import {
  stopPosixProcessGroup,
  treeSpawnOptions,
  type KillFunction,
  type StoppableChild,
} from './process-tree';
import { checkRunRequest, describeShell, evaluateTestVerdict } from './test-command';
import { snapshotWorkspace } from './workspace-baseline';

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
  /**
   * DSP-145: who asked for it. Absent in records written before DSP-145 and on a gate
   * record from a caller that does not say, and read as a gate's.
   */
  readonly requestedBy?: AgentCommandRequester;
  /** DSP-145: the step that ran it or asked for it, and its visit. */
  readonly nodeId?: string;
  readonly occurrence?: number;
  /**
   * DSP-145: the working folders' identity (every folder, one id) just before it started
   * and just after it ended, as DSpatch observed them. `null` or absent is not observed,
   * never "unchanged".
   */
  readonly testedSnapshotId?: string | null;
  readonly afterRunSnapshotId?: string | null;
  /** DSP-145: it changed the working folders while it ran. `null` where not established. */
  readonly changedWhileRunning?: boolean | null;
  /** DSP-145: how an agent's or the provider's command ended, where it was one. */
  readonly ending?: AgentCommandEnding;
  /** DSP-145: what the record can and cannot say about where it came from. */
  readonly originNote?: string;
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

/**
 * How the gate's command is spawned: through the shell, with this process's
 * environment, and on POSIX as the leader of its own process group so that the
 * timeout's stop reaches what the shell started (`process-tree.ts`). Process
 * group on POSIX; not measured on Linux. On Windows the options are exactly what
 * they were before.
 */
export function gateCommandSpawnOptions(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): { cwd: string; shell: true; windowsHide: true; env: NodeJS.ProcessEnv; detached?: true } {
  return { cwd, shell: true, windowsHide: true, env: process.env, ...treeSpawnOptions(platform) };
}

/** What {@link killCommandTree} needs from the world, injected so it can be tested. */
export interface GateCommandKillDeps {
  readonly platform: NodeJS.Platform;
  /** The gate does not wait for `taskkill`: it fires it and listens only for `error`. */
  readonly spawn: (
    command: string,
    args: string[],
    options: { windowsHide: boolean; stdio: 'ignore' },
  ) => { on(event: 'error', listener: (err: Error) => void): unknown };
  /** Defaults to `process.kill`. */
  readonly kill?: KillFunction;
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
export function killCommandTree(
  child: StoppableChild,
  deps: GateCommandKillDeps = { platform: process.platform, spawn },
): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    if (deps.platform === 'win32') {
      deps.spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => {
        // Nothing to do: the record already says the command did not finish.
      });
    } else {
      // The process group the command leads (`gateCommandSpawnOptions`), so this
      // reaches what `sh` started, not `sh` alone; the shell by itself only if the
      // group cannot be signalled. Process group on POSIX; not measured on Linux.
      // A DSpatch crash or Ctrl+C in the dev terminal does not reach the detached
      // group, and a descendant that calls `setsid` escapes it.
      stopPosixProcessGroup(child, deps.kill);
    }
  } catch {
    // Same. A process that could not be killed is reported, not hidden.
  }
}

/** What a caller may add to {@link finishCommand} (DSP-145). Absent means the gate's behaviour. */
export interface FinishCommandExtras {
  /**
   * Aborting stops the process tree at once and settles the record as stopped by
   * DSpatch. `signal.reason`, when it is a string, is the reason the record gives.
   */
  readonly signal?: AbortSignal;
  /**
   * Keep at most this many characters of each stream - the **last** ones - or `null`
   * for no bound, which is the gate's behaviour.
   */
  readonly maxOutputChars?: number | null;
}

/** A settled command and what only the waiting side knows about how it ended. */
export interface ObservedCommand {
  readonly record: LiveCommandRecord;
  readonly pid: number | null;
  /** DSpatch asked the operating system to stop it. */
  readonly killedByDspatch: boolean;
  readonly stoppedBy: 'time-bound' | 'cancel' | null;
  readonly outputTruncated: boolean;
  readonly outputNote: string | null;
}

/** Why DSpatch stopped a command on request, from the signal when it says. */
function abortReasonOf(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  return typeof reason === 'string' && reason.trim() !== ''
    ? reason.trim()
    : 'the run it belonged to was cancelled or ended';
}

/** What DSpatch says about a command it stopped because it was asked to. */
export function describeCancelledCommand(reason: string): string {
  return (
    `DSpatch stopped the command before it finished, because ${reason}. It asked the ` +
    `operating system to stop it and the children it could find; one started through an ` +
    `intermediate that has already exited is not reached, so check for it before starting ` +
    `another command. Nothing is known about whether your project builds or its tests ` +
    `pass — this is not a test failure and not a pass. What it printed before it was ` +
    `stopped is kept.`
  );
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
 *
 * **A stop settles before the tree is gone.** On a time bound or an abort the record
 * is settled as soon as the stop is requested; `taskkill` runs on without being waited
 * for (see {@link killCommandTree}). A caller that needs the processes gone checks for
 * them itself.
 */
export function finishCommand(
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
  return finishObservedCommand(child, command, cwd, startedAt, rawLine, timeoutMs).then(
    (observed) => observed.record,
  );
}

/** {@link finishCommand}, with what only this side knows about how the command ended. */
export function finishObservedCommand(
  child: ReturnType<typeof spawn>,
  command: string,
  cwd: string,
  startedAt: number,
  rawLine: string | null,
  timeoutMs: number | null,
  extras: FinishCommandExtras = {},
): Promise<ObservedCommand> {
  const startedAtUtc = new Date(startedAt).toISOString();
  const bound = extras.maxOutputChars ?? null;
  const streams = { stdout: '', stderr: '' };
  const dropped = { stdout: 0, stderr: 0 };
  const append = (which: 'stdout' | 'stderr', chunk: Buffer): void => {
    const next = streams[which] + chunk.toString('utf8');
    if (bound !== null && next.length > bound) {
      dropped[which] += next.length - bound;
      streams[which] = next.slice(next.length - bound);
    } else {
      streams[which] = next;
    }
  };
  child.stdout?.on('data', (chunk: Buffer) => {
    append('stdout', chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    append('stderr', chunk);
  });
  const outputNote = (): string | null => {
    const parts: string[] = [];
    if (dropped.stdout > 0) {
      parts.push(`the first ${String(dropped.stdout)} characters of standard output`);
    }
    if (dropped.stderr > 0) {
      parts.push(`the first ${String(dropped.stderr)} characters of standard error`);
    }
    return parts.length === 0
      ? null
      : `DSpatch kept the last ${String(bound)} characters of each stream; ${parts.join(' and ')} ` +
          'were left out.';
  };
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let killedByDspatch = false;
    let stoppedBy: ObservedCommand['stoppedBy'] = null;
    const onAbort = (): void => {
      if (settled || extras.signal === undefined) {
        return;
      }
      killedByDspatch = true;
      stoppedBy = 'cancel';
      killCommandTree(child);
      settle({
        command,
        cwd,
        // As for the time bound below: a stopped command has no exit code of its own.
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        startedAtUtc,
        stdout: streams.stdout,
        stderr: streams.stderr,
        notRun: {
          kind: 'did-not-finish',
          message: describeCancelledCommand(abortReasonOf(extras.signal)),
        },
      });
    };
    const settle = (partial: LiveCommandRecord): void => {
      // The user's own line, added on every path out of this function rather than at each
      // of the `settle` calls, so a record cannot be written without it by someone
      // adding another.
      const record: LiveCommandRecord = { ...partial, line: rawLine };
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      extras.signal?.removeEventListener('abort', onAbort);
      const truncated = dropped.stdout > 0 || dropped.stderr > 0;
      resolve({
        record,
        pid: child.pid ?? null,
        killedByDspatch,
        stoppedBy,
        outputTruncated: truncated,
        outputNote: outputNote(),
      });
    };
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        killedByDspatch = true;
        stoppedBy = 'time-bound';
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
          stdout: streams.stdout,
          stderr: streams.stderr,
          notRun: {
            kind: 'did-not-finish',
            message: describeStoppedCommand({
              timeoutMs,
              stdout: streams.stdout,
              stderr: streams.stderr,
            }),
          },
        });
      }, timeoutMs);
      timer.unref?.();
    }
    if (extras.signal !== undefined) {
      if (extras.signal.aborted) {
        onAbort();
      } else {
        extras.signal.addEventListener('abort', onAbort, { once: true });
      }
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
        stdout: streams.stdout,
        stderr: streams.stderr,
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
          : explainUnstartableCommand({ line: rawLine, cwd, exitCode: code, stderr: streams.stderr });
      settle({
        command,
        cwd,
        exitCode: code,
        signal: signal === null ? null : String(signal),
        durationMs: Date.now() - startedAt,
        startedAtUtc,
        stdout: streams.stdout,
        stderr: streams.stderr,
        notRun: unstartable === null ? null : { kind: 'could-not-start', message: unstartable },
      });
    });
  });
}

// --- Snapshots of the working folders -------------------------------------------

/** How one working folder's content identity is read. Injectable for tests. */
export type FolderSnapshotId = (folder: string) => string;

const snapshotFolder: FolderSnapshotId = (folder) => snapshotWorkspace(folder).snapshotId;

/**
 * One identity for the content of every working folder, or `null` when any of them
 * could not be read or none was named.
 *
 * A single folder gets exactly its own `snapshotWorkspace` id, so a record from here
 * compares directly with the chat's own snapshot of its working copy. Several folders
 * get a hash over each folder's path and id, so a change in any one of them changes it.
 * `null` is **not observed**: never read it as unchanged.
 */
export function snapshotOfFolders(
  folders: readonly string[],
  snapshotId: FolderSnapshotId = snapshotFolder,
): string | null {
  if (folders.length === 0) {
    return null;
  }
  const ids: string[] = [];
  for (const folder of folders) {
    try {
      ids.push(snapshotId(folder));
    } catch {
      return null;
    }
  }
  if (ids.length === 1) {
    return ids[0] ?? null;
  }
  const hash = createHash('sha256');
  folders.forEach((folder, index) => {
    hash.update(`${path.resolve(folder)}\u0000${ids[index] ?? ''}\u0000`);
  });
  return `folders-${hash.digest('hex').slice(0, 32)}`;
}

// --- One command, start to record -------------------------------------------------

export interface WorkspaceCommandOptions {
  /** The command line as given; interpreted by the platform shell. */
  readonly line: string;
  /** Where the process starts. */
  readonly cwd: string;
  readonly requestedBy: AgentCommandRequester;
  /** How long it may run before DSpatch stops it, or `null` for no bound. */
  readonly timeoutMs: number | null;
  /** Aborting stops the process tree; the record says DSpatch stopped it. */
  readonly signal?: AbortSignal;
  /**
   * Every working folder whose content the command may read or change. Snapshotted
   * just before the process starts and just after it ends. Omitted or empty: no
   * snapshot is taken and both identities are `null` (not observed).
   */
  readonly snapshotFolders?: readonly string[];
  /** Test seam for reading a folder's identity. */
  readonly snapshotId?: FolderSnapshotId;
  /** Keep at most this many characters of each stream (the end), or `null` for all. */
  readonly maxOutputChars?: number | null;
}

/** A command's record with everything DSpatch observed about it (DSP-145). */
export interface WorkspaceCommandRecord extends LiveCommandRecord {
  readonly requestedBy: AgentCommandRequester;
  /** The shell that interpreted the line, as {@link describeShell} names it. */
  readonly shell: string;
  readonly pid: number | null;
  readonly timeoutMs: number | null;
  readonly finishedAtUtc: string;
  readonly killedByDspatch: boolean;
  readonly stoppedBy: 'time-bound' | 'cancel' | null;
  /**
   * What the command established, from `evaluateTestVerdict` - the one place a pass
   * can come from. `unknown` whenever no process ran to an exit of its own.
   */
  readonly verdict: TestVerdict;
  readonly outputTruncated: boolean;
  readonly outputNote: string | null;
  readonly testedSnapshotId: string | null;
  readonly afterRunSnapshotId: string | null;
  readonly snapshotFolders: readonly string[];
}

/**
 * Run one command in a working folder and record it.
 *
 * Never rejects: a refused line, a missing folder, an executable the shell cannot
 * find, a time bound, an abort - each is a record with `notRun` saying which. The
 * request check is `checkRunRequest`, the same rule the chat's Run button applies.
 */
export async function runWorkspaceCommand(
  options: WorkspaceCommandOptions,
): Promise<WorkspaceCommandRecord> {
  const line = options.line.trim();
  const shell = describeShell();
  const folders = options.snapshotFolders ?? [];
  const extras = (
    observed: Omit<ObservedCommand, 'record'>,
    tested: string | null,
    after: string | null,
    record: LiveCommandRecord,
  ): WorkspaceCommandRecord => ({
    ...record,
    requestedBy: options.requestedBy,
    shell,
    pid: observed.pid,
    timeoutMs: options.timeoutMs,
    finishedAtUtc: new Date().toISOString(),
    killedByDspatch: observed.killedByDspatch,
    stoppedBy: observed.stoppedBy,
    verdict: observed.killedByDspatch
      ? 'interrupted'
      : record.notRun !== null
        ? 'unknown'
        : evaluateTestVerdict({
            killedByDspatch: observed.killedByDspatch,
            exitCode: record.exitCode,
            signal: record.signal,
          }).verdict,
    outputTruncated: observed.outputTruncated,
    outputNote: observed.outputNote,
    testedSnapshotId: tested,
    afterRunSnapshotId: after,
    snapshotFolders: [...folders],
  });
  const notStarted = {
    pid: null,
    killedByDspatch: false,
    stoppedBy: null,
    outputTruncated: false,
    outputNote: null,
  } as const;

  const check = checkRunRequest(options.line, options.cwd);
  if (!check.ok) {
    return extras(
      notStarted,
      null,
      null,
      commandNotRun(
        options.line,
        options.cwd,
        check.message ?? 'DSpatch could not use the command, and gave no reason.',
      ),
    );
  }
  const resolvedCwd = path.resolve(options.cwd.trim());
  if (options.signal?.aborted === true) {
    // Asked to stop before anything started: nothing is spawned.
    return extras(notStarted, null, null, {
      ...commandNotRun(options.line, resolvedCwd, ''),
      command: `${shell} ${line}`,
      notRun: {
        kind: 'could-not-start',
        message: `DSpatch did not start the command, because ${abortReasonOf(options.signal)}. Nothing ran.`,
      },
    });
  }
  const tested = snapshotOfFolders(folders, options.snapshotId);
  const startedAt = Date.now();
  const child = spawn(line, gateCommandSpawnOptions(resolvedCwd));
  const observed = await finishObservedCommand(
    child,
    `${shell} ${line}`,
    resolvedCwd,
    startedAt,
    line,
    options.timeoutMs,
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      maxOutputChars: options.maxOutputChars ?? null,
    },
  );
  const after = snapshotOfFolders(folders, options.snapshotId);
  return extras(observed, tested, after, observed.record);
}

/** The gate's record shape, exactly: the fields `LiveCommandRecord` has and nothing else. */
export function toLiveCommandRecord(record: LiveCommandRecord): LiveCommandRecord {
  return {
    command: record.command,
    line: record.line ?? null,
    cwd: record.cwd,
    exitCode: record.exitCode,
    signal: record.signal,
    durationMs: record.durationMs,
    startedAtUtc: record.startedAtUtc,
    stdout: record.stdout,
    stderr: record.stderr,
    notRun: record.notRun,
  };
}

// --- One command at a time per working copy ----------------------------------------

/** Who holds a working copy's command slot. */
export interface CommandSlotHolder {
  readonly by: 'agent' | 'person';
  readonly line: string;
}

/**
 * Which working copies have a command running, so the chat's Run button does not start
 * a second command while the person's earlier one, or a shell command the agent's
 * runtime reported starting (DSP-146), is still running in the same working copy (their
 * output and file writes would interleave). Keyed by folder, case-folded on Windows. A
 * process-wide instance is the default; tests make their own.
 */
export class WorkspaceCommandSlots {
  private readonly held = new Map<string, CommandSlotHolder>();

  private static key(folder: string): string {
    const resolved = path.resolve(folder);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  /** Take the slot, or say who holds it. `release` is idempotent. */
  claim(
    folder: string,
    holder: CommandSlotHolder,
  ): { readonly ok: true; release(): void } | { readonly ok: false; readonly holder: CommandSlotHolder } {
    const key = WorkspaceCommandSlots.key(folder);
    const current = this.held.get(key);
    if (current !== undefined) {
      return { ok: false, holder: current };
    }
    this.held.set(key, holder);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (!released && this.held.get(key) === holder) {
          this.held.delete(key);
        }
        released = true;
      },
    };
  }

  /** Who holds the slot for this folder, or `null`. */
  holderOf(folder: string): CommandSlotHolder | null {
    return this.held.get(WorkspaceCommandSlots.key(folder)) ?? null;
  }
}

/** The process-wide slots the chat uses by default. */
export const WORKSPACE_COMMAND_SLOTS = new WorkspaceCommandSlots();
