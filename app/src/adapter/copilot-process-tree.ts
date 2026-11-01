import { execFile } from 'node:child_process';
import fs from 'node:fs';

/**
 * Ending a Copilot runtime with what it started (DSP-154).
 *
 * `session.abort()` waits for a running hook and does not stop it, and `forceStop()` kills the
 * runtime alone, so a hook script would go on by itself. The SDK starts the runtime without a
 * process group of its own, so the tree is found from the runtime's process id. Each session has
 * its own runtime, so this reaches that session's hooks and commands and nothing else.
 *
 * Measured on Linux (`tests/copilot-hooks.test.ts`). The Windows branch has not run on Windows.
 * A process that left the tree on purpose (a double fork to the init process) is not found.
 */

export interface ProcessTreeDeps {
  readonly platform: NodeJS.Platform;
  /** The process ids directly under one process. */
  readonly childrenOf: (pid: number) => readonly number[];
  readonly kill: (pid: number) => void;
  /** `taskkill /T /F`, which ends the process and its tree. */
  readonly taskkill: (pid: number) => Promise<void>;
}

/** Linux's own record: each thread's `children` file. Empty for a process already gone. */
function linuxChildrenOf(pid: number): readonly number[] {
  try {
    return fs
      .readdirSync(`/proc/${String(pid)}/task`)
      .flatMap((thread) => fs.readFileSync(`/proc/${String(pid)}/task/${thread}/children`, 'utf8').split(' '))
      .filter((entry) => entry.trim() !== '')
      .map(Number);
  } catch {
    return [];
  }
}

const REAL_DEPS: ProcessTreeDeps = {
  platform: process.platform,
  childrenOf: linuxChildrenOf,
  kill: (pid) => {
    process.kill(pid, 'SIGKILL');
  },
  taskkill: (pid) =>
    new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
        resolve();
      });
    }),
};

/** Every process under `root`, children before their children. */
export function processesUnder(root: number, childrenOf: ProcessTreeDeps['childrenOf']): number[] {
  const found: number[] = [];
  const waiting = [root];
  for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
    const children = childrenOf(next).filter((child) => !found.includes(child));
    found.push(...children);
    waiting.push(...children);
  }
  return found;
}

/**
 * End `root` through `endRoot`, and what runs under it. On Linux the runtime goes first, so it
 * cannot see its hook die and carry on; the tree was read before that, since an orphan has
 * another parent. On Windows `taskkill` has to walk the tree while the root is alive.
 *
 * @returns How many processes under the root were signalled; `null` when that is not known.
 */
export async function endProcessTree(root: number, endRoot: () => Promise<void>, deps: ProcessTreeDeps = REAL_DEPS): Promise<number | null> {
  if (deps.platform === 'win32') {
    await deps.taskkill(root);
    await endRoot();
    return null;
  }
  if (deps.platform !== 'linux') {
    await endRoot();
    return null;
  }
  const under = processesUnder(root, deps.childrenOf);
  await endRoot();
  for (const pid of under) {
    try {
      deps.kill(pid);
    } catch {
      // It ended by itself.
    }
  }
  return under.length;
}
