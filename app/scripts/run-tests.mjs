/**
 * Run a named part of the suite, and come back.
 *
 * `npm test` was one command over 41 files: a presentation change waited for the
 * chat service, and three faults on 19 September 2026 showed that waiting is not
 * even the worst of it.
 *
 * - A test that failed before its `await service.dispose()` left the service
 *   holding resources, and the **process outlived the tests**. One run finished
 *   its work in under three seconds and held the terminal for more than five
 *   minutes. `node --test` has a `--test-force-exit` for this and it is
 *   deliberately not used here: it makes a leak look like a pass. This script
 *   waits a short grace after the tests report, then **fails** and names the
 *   phase, which is the opposite of hiding it.
 * - Output was buffered until exit, so a hang looked exactly like slow work.
 *   Child output is echoed line by line as it arrives.
 * - A `DSPATCH_CHAT_WORKSPACE` left in a shell silently overrode an explicit
 *   constructor option (DSP-65) and made a passing implementation look broken.
 *   The child is given an environment with `DSPATCH_*` removed. That is this
 *   run's environment, not the user's: the parent shell is untouched, and
 *   `--keep-env` puts them back for the case where one is the point.
 *
 * Timeouts are per test (`--test-timeout`, so Node names the test), per command
 * (below, naming the group), and short for the exit grace. Every one of them
 * ends this run's own child tree and nothing else.
 *
 *     node scripts/run-tests.mjs --list
 *     node scripts/run-tests.mjs fast
 *     node scripts/run-tests.mjs presentation --tap
 */

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What each file mostly protects. A group is a question someone actually asks —
 * "did I break the presentation?" — not a directory.
 *
 * `heavy` marks a file that really spawns processes, runs git or waits on a
 * clock. Those are the whole difference between a three-second answer and a
 * twenty-second one; they are separated rather than trimmed, because what makes
 * them slow is the reality they check.
 */
const AREAS = {
  presentation: {
    what: 'Markdown, scrolling, diffs, plain errors and what the window reads like',
    files: [
      'markdown.test.ts',
      'plain-error.test.ts',
      'scroll-follow.test.ts',
      'turn-routing.test.ts',
      'text-diff.test.ts',
      'recovery.test.ts',
      'window-reads-well.test.ts',
      'workflow-gates.test.ts',
      'loop-run-view.test.ts',
      'loop-edge-geometry.test.ts',
    ],
  },
  loop: {
    what: 'the loop graph, its editor, the run record, control, instructions and the walk',
    files: [
      'loop-chat.test.ts',
      'loop-command.test.ts',
      'loop-control.test.ts',
      'loop-control-run.test.ts',
      'loop-editor-run.test.ts',
      'loop-graph.test.ts',
      'loop-graph-open.test.ts',
      'loop-graph-write.test.ts',
      'loop-instruction.test.ts',
      'loop-instruction-wiring.test.ts',
      'loop-record.test.ts',
      'loop-run.test.ts',
      'loop-run-audience.test.ts',
      'loop-stop-means-stop.test.ts',
      'loop-transcript.test.ts',
      'role-generate.test.ts',
    ],
  },
  chat: {
    what: 'the chat service, its workspace, saved conversations and remembered projects',
    files: [
      'attempt-ledger.test.ts',
      'chat-workspace.test.ts',
      'conversation-store.test.ts',
      'empty-reply-and-standing.test.ts',
      'project-store.test.ts',
      'run-record-store.test.ts',
      'command-start.test.ts',
      'test-command.test.ts',
      'own-repository.test.ts',
      { file: 'chat-service.test.ts', heavy: true },
    ],
  },
  project: {
    what: 'what DSpatch does to real folders: git state, sample projects, the test repository',
    files: [
      { file: 'git-state.test.ts', heavy: true },
      { file: 'sample-projects.test.ts', heavy: true },
      { file: 'experiment-repo.test.ts', heavy: true },
    ],
  },
  live: {
    what: 'a real command, really spawned, really stopped',
    files: [
      { file: 'loop-live.test.ts', heavy: true },
      { file: 'gate-command-reality.test.ts', heavy: true },
    ],
  },
};

/**
 * @typedef {{ file: string, heavy: boolean }} Entry
 * @typedef {{ what: string, entries: Entry[], testTimeoutMs: number, commandTimeoutMs: number }} Group
 */

/**
 * `{ file, heavy }` for every file in an area, whichever way it was written.
 *
 * @param {{ what: string, files: (string | Entry)[] }} area
 * @returns {Entry[]}
 */
function entriesOf(area) {
  return area.files.map((entry) =>
    typeof entry === 'string' ? { file: entry, heavy: false } : entry,
  );
}

/** @type {Entry[]} */
const ALL = Object.values(AREAS).flatMap(entriesOf);

/**
 * Every group, area and otherwise.
 *
 * `fast` is the one to run while working: every file that does not spawn a
 * process or wait on a clock. `all` is what `npm test` and the packaging gate
 * still run, because delivery should see everything.
 *
 * @type {Map<string, Group>}
 */
const GROUPS = new Map([
  [
    'fast',
    {
      what: 'everything that does not spawn a process or wait on a clock',
      entries: ALL.filter((entry) => !entry.heavy),
      testTimeoutMs: 15_000,
      commandTimeoutMs: 120_000,
    },
  ],
  [
    'heavy',
    {
      what: 'only the files that spawn processes, run git or wait on a clock',
      entries: ALL.filter((entry) => entry.heavy),
      testTimeoutMs: 90_000,
      commandTimeoutMs: 420_000,
    },
  ],
  [
    'all',
    {
      what: 'the whole suite',
      entries: ALL,
      testTimeoutMs: 90_000,
      commandTimeoutMs: 420_000,
    },
  ],
]);

for (const [name, area] of Object.entries(AREAS)) {
  const entries = entriesOf(area);
  const heavy = entries.some((entry) => entry.heavy);
  GROUPS.set(name, {
    what: area.what,
    entries,
    testTimeoutMs: heavy ? 90_000 : 15_000,
    commandTimeoutMs: heavy ? 420_000 : 120_000,
  });
}

/** How long the process may take to exit after the tests have reported. */
const EXIT_GRACE_MS = 15_000;

/**
 * A test file nobody put in a group would be silently skipped by every command
 * here, including `npm test`. Listing the groups by hand is what makes them
 * coherent; this is what stops that costing coverage.
 */
function unlistedTestFiles() {
  const listed = new Set(ALL.map((entry) => entry.file));
  return readdirSync(path.join(appRoot, 'tests'))
    .filter((name) => name.endsWith('.test.ts'))
    .filter((name) => !listed.has(name));
}

function usage() {
  const lines = ['Groups:'];
  for (const [name, group] of GROUPS) {
    lines.push(
      `  ${name.padEnd(14)} ${String(group.entries.length).padStart(2)} files  ${group.what}`,
    );
  }
  lines.push('');
  lines.push('Options: --tap  --keep-env  --timeout=<ms>  --test-timeout=<ms>  --exit-grace=<ms>');
  return lines.join('\n');
}

/**
 * @param {string[]} argv
 * @returns {{ group: string, tap: boolean, keepEnv: boolean, list?: boolean,
 *   commandTimeoutMs?: number, testTimeoutMs?: number, exitGraceMs?: number }}
 */
function parseArgs(argv) {
  /** @type {{ group: string, tap: boolean, keepEnv: boolean, list?: boolean,
   *   commandTimeoutMs?: number, testTimeoutMs?: number, exitGraceMs?: number }} */
  const options = { group: 'fast', tap: false, keepEnv: false };
  for (const arg of argv) {
    if (arg === '--list' || arg === '-h' || arg === '--help') {
      options.list = true;
    } else if (arg === '--tap') {
      options.tap = true;
    } else if (arg === '--keep-env') {
      options.keepEnv = true;
    } else if (arg.startsWith('--timeout=')) {
      options.commandTimeoutMs = Number(arg.slice('--timeout='.length));
    } else if (arg.startsWith('--test-timeout=')) {
      options.testTimeoutMs = Number(arg.slice('--test-timeout='.length));
    } else if (arg.startsWith('--exit-grace=')) {
      options.exitGraceMs = Number(arg.slice('--exit-grace='.length));
    } else if (!arg.startsWith('-')) {
      options.group = arg;
    } else {
      throw new Error(`Unknown option ${arg}. Try --list.`);
    }
  }
  return options;
}

/**
 * The environment the tests run in.
 *
 * `DSPATCH_*` is removed unless asked for. A variable that configures the
 * product must not decide the outcome of a test that never mentioned it, and
 * that is a property of the child's environment — nothing here writes to the
 * shell the user is sitting in.
 *
 * @param {boolean} keepEnv
 * @returns {NodeJS.ProcessEnv}
 */
function childEnvironment(keepEnv) {
  const env = { ...process.env };
  if (keepEnv) {
    return env;
  }
  /** @type {string[]} */
  const removed = [];
  for (const name of Object.keys(env)) {
    if (name.startsWith('DSPATCH_')) {
      delete env[name];
      removed.push(name);
    }
  }
  if (removed.length > 0) {
    console.log(
      `[run-tests] ignoring ${removed.join(', ')} for this run — pass --keep-env to keep ${
        removed.length === 1 ? 'it' : 'them'
      }`,
    );
  }
  return env;
}

/**
 * End the child and everything it started.
 *
 * `taskkill /T` on Windows, a process group elsewhere. A test runner that leaves
 * its own orphans behind while complaining about orphans would be the joke it
 * sounds like. Nothing outside this run's tree is touched.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    console.log(usage());
    return 0;
  }
  const group = GROUPS.get(options.group);
  if (group === undefined) {
    console.error(`No group called "${options.group}".\n\n${usage()}`);
    return 2;
  }

  const unlisted = unlistedTestFiles();
  if (unlisted.length > 0) {
    console.error(
      `[run-tests] FAILED: ${unlisted.join(', ')} ${
        unlisted.length === 1 ? 'is' : 'are'
      } not in any group in scripts/run-tests.mjs, so no command here would run ` +
        'it. Add it to the area it belongs to.',
    );
    return 2;
  }

  const testTimeoutMs = options.testTimeoutMs ?? group.testTimeoutMs;
  const commandTimeoutMs = options.commandTimeoutMs ?? group.commandTimeoutMs;
  const exitGraceMs = options.exitGraceMs ?? EXIT_GRACE_MS;
  // Heavy files first. `node --test` runs files in parallel but starts them in the
  // order given, and the slowest file decides the wall time, so the 16-second one
  // should not be started last. Measured as neither better nor worse on this
  // machine; it is here because it cannot be worse, not on the strength of a number.
  const files = [...group.entries]
    .sort((left, right) => Number(right.heavy) - Number(left.heavy))
    .map((entry) => path.join('tests', entry.file));

  const args = [
    '--import',
    './scripts/ts-resolve.mjs',
    '--test',
    `--test-timeout=${String(testTimeoutMs)}`,
    `--test-reporter=${options.tap ? 'tap' : 'spec'}`,
    ...files,
  ];

  console.log(
    `[run-tests] ${options.group}: ${String(files.length)} files — ${group.what}\n` +
      `[run-tests] per test ${String(testTimeoutMs)} ms, whole command ${String(
        commandTimeoutMs,
      )} ms, ${String(exitGraceMs)} ms to exit after the tests report`,
  );

  const startedAt = Date.now();
  const child = spawn(process.execPath, args, {
    cwd: appRoot,
    env: childEnvironment(options.keepEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });

  /**
   * What the run is doing, so a timeout can say which of the three it hit.
   * `reported` flips when the summary line arrives, which is the boundary
   * between "the tests are slow" and "the tests are done and the process is
   * still here" — two different faults with two different fixes.
   */
  let reported = false;
  /** @type {string | null} */
  let timedOut = null;
  /** @type {NodeJS.Timeout | null} */
  let exitGrace = null;

  const commandTimer = setTimeout(() => {
    timedOut =
      `the ${options.group} tests did not finish within ${String(commandTimeoutMs)} ms. ` +
      'Nothing here is a pass or a failure: the run was stopped.';
    killTree(child);
  }, commandTimeoutMs);

  /**
   * @param {import('node:stream').Readable} stream
   * @param {import('node:stream').Writable} sink
   */
  const watch = (stream, sink) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (/** @type {string} */ chunk) => {
      sink.write(chunk);
      rest += chunk;
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        // The reporters differ in everything but this: both print the totals
        // once, at the end, and only then.
        if (!reported && /^(# duration_ms |\u2139 duration_ms |duration_ms )/.test(line.trim())) {
          reported = true;
          clearTimeout(commandTimer);
          exitGrace = setTimeout(() => {
            timedOut =
              `the ${options.group} tests reported after ${String(
                Date.now() - startedAt,
              )} ms and then the process stayed alive for ${String(exitGraceMs)} ms. ` +
              'Something was left open — an undisposed service, a child process, a timer. ' +
              'The tests are not the problem; the leak is, and it is a real defect.';
            killTree(child);
          }, exitGraceMs);
        }
      }
    });
  };
  watch(child.stdout, process.stdout);
  watch(child.stderr, process.stderr);

  // Ctrl+C has to reach the tree, not just this script, or interrupting a run is
  // how the orphans are made.
  const onSignal = () => {
    timedOut = `the ${options.group} tests were interrupted.`;
    killTree(child);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const code = await new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(`[run-tests] could not start node: ${error.message}`);
      resolve(1);
    });
    child.on('close', (exitCode, signal) => {
      resolve(exitCode ?? (signal === null ? 1 : 1));
    });
  });

  clearTimeout(commandTimer);
  if (exitGrace !== null) {
    clearTimeout(exitGrace);
  }
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  const elapsed = Date.now() - startedAt;
  if (timedOut !== null) {
    console.error(`\n[run-tests] FAILED: ${timedOut}`);
    return 1;
  }
  console.log(
    `\n[run-tests] ${options.group} ${code === 0 ? 'passed' : 'failed'} in ${String(
      elapsed,
    )} ms (${String(files.length)} files)`,
  );
  return code;
}

process.exitCode = await main();
