/**
 * Scratch directories, child processes and environment variables that clean up
 * after themselves — including when the test they belong to fails.
 *
 * Three faults on 19 September 2026, all of them real:
 *
 * - A fixture that holds a directory with a live child released it on the last
 *   line of the test. A failed assertion before that line skipped the release, so
 *   the child outlived the test — and because Node keeps a handle on a spawned
 *   child, **the test process outlived the tests too**, in one case by more than
 *   five minutes. The removal in `after` then raced the kill and threw `EPERM`.
 * - Cleanup that ran only on the happy path left scratch directories behind, and
 *   Ctrl+C left them and the children both.
 * - A `DSPATCH_CHAT_WORKSPACE` left in a shell overrode an explicit constructor
 *   option and made a passing implementation look broken (DSP-65). A test that
 *   sets one must put back exactly what was there, including nothing.
 *
 * So: register the thing when you make it, and it is dealt with however the test
 * ends. `after` runs on a failed assertion, the signal handlers cover Ctrl+C, and
 * every child is **waited for** before the directory it was standing in is
 * removed. That ordering is the whole point — killing is asynchronous, and a
 * removal that does not wait for the exit is the `EPERM` above.
 *
 * Deliberately small. This is a handful of functions over `node:test`, not a test
 * framework.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

const directories: string[] = [];
const children = new Set<ChildProcess>();
const environment: { name: string; previous: string | undefined }[] = [];

/** A scratch directory that is removed however the test ends. */
export function tempRoot(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-${name}-`));
  directories.push(dir);
  return dir;
}

/** Wait for a child to be really gone, rather than for the kill to be requested. */
function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
}

/**
 * A live process whose working directory is inside `dir`, which is how the
 * leftover sample folder in DSP-61 is held: an open file handle is not enough,
 * because Node opens files with delete sharing and `fs.rmSync` deletes the tree
 * anyway.
 *
 * Resolves when the child has really started — the `spawn` event, not a sleep
 * long enough to probably be true. The returned release waits for the exit, and
 * the same release runs in cleanup if the test never reaches it.
 */
export async function holdDirectory(dir: string): Promise<() => Promise<void>> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: dir,
    stdio: 'ignore',
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => {
      resolve();
    });
    child.once('error', reject);
  });
  children.add(child);
  return async () => {
    children.delete(child);
    const ended = exited(child);
    child.kill();
    await ended;
  };
}

/** A child this test started, ended and waited for in cleanup if it is still alive. */
export function trackChild(child: ChildProcess): ChildProcess {
  children.add(child);
  return child;
}

/**
 * Set environment variables for this test and restore exactly what was there.
 *
 * Only the names given. Clearing the environment generally would break the very
 * tests that need `PATH`, and it is not this module's environment to clear.
 */
export function setEnvironment(values: Readonly<Record<string, string | undefined>>): void {
  for (const [name, value] of Object.entries(values)) {
    environment.push({ name, previous: process.env[name] });
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

/** Put back every variable `setEnvironment` changed, newest first. */
export function restoreEnvironment(): void {
  for (let at = environment.length - 1; at >= 0; at -= 1) {
    const entry = environment[at];
    if (entry === undefined) {
      continue;
    }
    if (entry.previous === undefined) {
      delete process.env[entry.name];
    } else {
      process.env[entry.name] = entry.previous;
    }
  }
  environment.length = 0;
}

/**
 * Children first and waited for, then the environment, then the directories.
 *
 * The order is the fix. A directory whose holder is still exiting cannot be
 * removed on Windows, and the retries below exist because the operating system
 * releases the working directory a moment after the process is gone.
 */
export async function cleanUpFixtures(): Promise<void> {
  const ending = [...children].map(async (child) => {
    const ended = exited(child);
    child.kill();
    await ended;
  });
  children.clear();
  await Promise.all(ending);

  restoreEnvironment();

  for (const dir of directories.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) {
      // Reported rather than thrown: a leftover temp directory is worth knowing
      // about and is not worth turning a passing suite red.
      console.error(`could not remove the scratch directory ${dir}: ${String(error)}`);
    }
  }
}

after(cleanUpFixtures);

/**
 * Ctrl+C is how a slow run actually ends, and it is when orphans are made.
 *
 * Synchronous, because there is no time left for a promise: kill the children and
 * remove what can be removed. `once` so a second Ctrl+C still ends the process.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    for (const child of children) {
      child.kill('SIGKILL');
    }
    restoreEnvironment();
    for (const dir of directories.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    process.exit(130);
  });
}
