/**
 * The POSIX half of "stop the command and everything it started".
 *
 * The chat's command and the loop's gate command are both spawned through a
 * shell (`shell: true`), so the process DSpatch holds is `sh`, not the work. On
 * Windows each caller ends the tree with `taskkill /T /F`, and that call stays at
 * the call site, exactly as it was: the chat waits for it and logs its status,
 * the gate fires it and moves on. Only the POSIX branch is shared, because it is
 * the same in both places.
 *
 * On POSIX the command is started as the leader of its own **process group**
 * (`detached: true`) and stopped by signalling the group (`kill(-pid)`), so a
 * test runner's workers die with the shell that started them. Before this, the
 * POSIX branch killed `sh` alone: its descendants survived, and `close` might not
 * come while they held the pipes, so a stopped command could sit as
 * outcome-unknown while the work went on.
 *
 * **Process group on POSIX; not measured on Linux.** Nothing here has run on
 * Linux; the tests that cover it inject the platform and the kill function.
 *
 * Residual risks, named rather than implied:
 * - A detached group is no longer in the terminal's foreground group, so a
 *   DSpatch crash or Ctrl+C in the `npm run dev` terminal does not reach a
 *   command that is still running. It has to be stopped by DSpatch, or by hand.
 * - A descendant that calls `setsid` (or otherwise leaves the group) escapes the
 *   group kill.
 *
 * `unref()` is deliberately not called: DSpatch still waits for the command's
 * `close`, which is how a stop is confirmed.
 */

/** The spawn options that make a command the leader of its own process group. */
export interface TreeSpawnOptions {
  readonly detached?: true;
}

/**
 * Added to a shell command's spawn options.
 *
 * Nothing on Windows, where `detached` would give the child its own console and
 * `taskkill /T` already reaches the tree; `detached: true` everywhere else.
 */
export function treeSpawnOptions(platform: NodeJS.Platform): TreeSpawnOptions {
  return platform === 'win32' ? {} : { detached: true };
}

/** `process.kill`, narrowed to what the group stop uses. */
export type KillFunction = (pid: number, signal: NodeJS.Signals) => void;

/** The part of a child process the group stop touches. */
export interface StoppableChild {
  readonly pid?: number | undefined;
  kill(signal: NodeJS.Signals): boolean;
}

/** What was signalled, so a caller can log it. */
export type PosixStop =
  | { readonly kind: 'group'; readonly pid: number }
  | { readonly kind: 'child-only'; readonly pid: number; readonly groupError: string }
  | { readonly kind: 'no-pid' };

/**
 * Send SIGKILL to the child's process group, or to the child alone if the group
 * cannot be signalled.
 *
 * Deliberately no "has it already exited?" check: `sh` can have exited while
 * what it started is still running in the group, and that is exactly the case
 * this exists for. A group that is already gone throws (`ESRCH`), and the
 * fallback to the child's own `kill` is then harmless.
 *
 * Throws only if the fallback itself throws; callers already treat a failed
 * kill as best effort.
 */
export function stopPosixProcessGroup(
  child: StoppableChild,
  kill: KillFunction = (pid, signal) => {
    process.kill(pid, signal);
  },
): PosixStop {
  const pid = child.pid;
  if (pid === undefined) {
    return { kind: 'no-pid' };
  }
  try {
    kill(-pid, 'SIGKILL');
    return { kind: 'group', pid };
  } catch (err) {
    child.kill('SIGKILL');
    return { kind: 'child-only', pid, groupError: String(err) };
  }
}
