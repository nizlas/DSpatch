/**
 * A command that starts a child and waits forever, and a check that both processes are
 * really gone (DSP-145). For tests that stop a real command tree: the parent writes its
 * own and its child's PID to `pids.json` in the folder it runs in, so the test can wait
 * for them to disappear rather than trust that a stop was requested.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Write the script into `folder` and return the command line that runs it. */
export function sleepingTreeCommand(folder: string): string {
  fs.writeFileSync(
    path.join(folder, 'sleeping-tree.cjs'),
    [
      "const { spawn } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      "fs.writeFileSync('pids.json', JSON.stringify({ parent: process.pid, child: child.pid }));",
      "console.log('tree started');",
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
    'utf8',
  );
  return `"${process.execPath}" sleeping-tree.cjs`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The two PIDs, once the tree has written them; fails after `ms`. */
export async function treePids(folder: string, ms = 15_000): Promise<{ parent: number; child: number }> {
  const file = path.join(folder, 'pids.json');
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { parent: number; child: number };
      if (typeof parsed.parent === 'number' && typeof parsed.child === 'number') {
        return parsed;
      }
    } catch {
      // Not written yet.
    }
    await sleep(50);
  }
  throw new Error(`the command tree never wrote ${file}`);
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Wait until none of `pids` is alive; returns the ones still alive after `ms`. */
export async function waitGone(pids: readonly number[], ms = 15_000): Promise<number[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const living = pids.filter(alive);
    if (living.length === 0 || Date.now() >= deadline) {
      return living;
    }
    await sleep(100);
  }
}

/** Last resort for a failed test: end whatever is left, so nothing outlives it. */
export function killLeftovers(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
}
