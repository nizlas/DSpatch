/**
 * What the machine really does, against what DSpatch says about it.
 *
 * Every other test of the gate injects a fake command. These do not: each one
 * **really spawns** the command line, exactly as `runConfiguredProjectTest` spawns
 * it, and proves from a marker the program itself wrote whether the program ran at
 * all. Only then is the module asked what it would tell the user. A disagreement
 * between those two things is the defect; a test that asked only the module could
 * not see it.
 *
 * That shape is the Verifier's, from run `20260917-204500-obs18`, and it is what
 * found three over-claims and one false green that unit tests had all passed over:
 *
 * - `winget` runs on this machine and the resolver said there was no such program.
 * - `mytool,arg` runs `mytool`, and the resolver looked up `mytool,arg`.
 * - a tool reachable only through a quoted `PATH` entry was reported missing.
 * - a bare `.ps1` returned exit 0 having executed nothing, which the product
 *   recorded as `work-verified` and the badge *your command passed*.
 *
 * **One thing is deliberately not spawned here.** The bare `.ps1` case itself is
 * not run, and the reason is not squeamishness: `cmd.exe` hands the file to
 * `ShellExecute`, which raises Windows' *"How do you want to open this file?"*
 * chooser. Behind `windowsHide: true` that window is invisible, `taskkill /T` does
 * not reach it because it is not a child of the shell, and the Verifier found seven
 * `OpenWith.exe` processes still resident after two probe runs. A suite that leaked
 * one of those on every `npm test` would be a worse thing than the defect. So the
 * bare form is proven refused *before* the spawn, and the form the refusal
 * recommends is proven to really run — which is the pair that matters.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { setEnvironment, tempRoot } from './support/fixtures.ts';
import { explainUnstartableCommand, resolveExecutableHere } from '../src/main/command-start';
import { runConfiguredProjectTest, type LiveCommandRecord } from '../src/main/loop-live';
import { recordedCommandFrom } from '../src/main/run-record-store';
import { checkRunRequest } from '../src/main/test-command';
import { describeRunOutcome, runOutcomeFrom } from '../src/shared/loop-record';

const onWindows = process.platform === 'win32';
const windowsOnly = { skip: onWindows ? false : 'cmd.exe behaviour, and Windows is target one' };

const originalPath = process.env['PATH'] ?? '';

/**
 * `PATH` is changed here on purpose — that is what the resolver is being asked
 * about — so it goes through the fixtures, which put back exactly what was there
 * however the test ends. A leaked `PATH` would be felt by every later test.
 */
function usePath(value: string): void {
  setEnvironment({ PATH: value });
}

function scratch(name: string): string {
  return tempRoot(`real-${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

interface RealRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The program wrote its marker, so it really executed. */
  readonly ran: boolean;
}

/**
 * Spawn a command line the way the gate spawns it, and report whether the program
 * itself left a trace.
 *
 * `shell: true`, `windowsHide: true` and the inherited environment are not
 * incidental: they are the conditions under which every one of these defects was
 * measured, and a spawn without the shell would answer a different question.
 */
function reallySpawn(line: string, cwd: string, marker: string | null): Promise<RealRun> {
  if (marker !== null) {
    fs.rmSync(marker, { force: true });
  }
  return new Promise((resolve) => {
    const child = spawn(line, { cwd, shell: true, windowsHide: true, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const done = (exitCode: number | null): void => {
      resolve({
        exitCode,
        stdout,
        stderr,
        ran: marker === null ? stdout.trim() !== '' : fs.existsSync(marker),
      });
    };
    child.on('error', () => {
      done(null);
    });
    child.on('close', (code) => {
      done(code);
    });
  });
}

/** A `.cmd` that says it ran and then fails, so a real failure is distinguishable. */
function writeTool(dir: string, name: string): string {
  const marker = path.join(dir, `${name}-ran.txt`);
  fs.writeFileSync(
    path.join(dir, `${name}.cmd`),
    `@echo off\r\n> "%~dp0${name}-ran.txt" echo ${name.toUpperCase()}_RAN\r\nexit /b 7\r\n`,
    'utf8',
  );
  return marker;
}

const settled = { status: 'completed' as const, cancelled: false, recordComplete: true };

function outcomeOf(record: LiveCommandRecord, status: 'completed' | 'runtime-fault') {
  const commands = [recordedCommandFrom(record, null)];
  const outcome = runOutcomeFrom({ ...settled, status, commands });
  return { outcome, sentence: describeRunOutcome(outcome, { commands }) };
}

/* ------------------------------------------------------------------------- */
/* D2 — what the shell can find, against what the resolver claims            */
/* ------------------------------------------------------------------------- */

describe('the resolver against the real shell', () => {
  it('does not deny a tool the shell reaches through a quoted PATH entry', windowsOnly, async () => {
    const quotedDir = scratch('quoted-path');
    const marker = writeTool(quotedDir, 'quotedtool');
    // Quoting a PATH entry is ordinary on Windows — `"C:\Program Files\…"` — and the
    // shell strips the quotes before searching. This code did not.
    usePath(`"${quotedDir}";${originalPath}`);
    // Run from somewhere else, so the quoted entry is the **only** route to the
    // tool. Running in its own directory finds it through the working directory
    // `cmd.exe` searches first, which proves nothing about `PATH` — the first
    // version of this test made exactly that mistake and passed with the fix
    // reverted.
    const runDir = scratch('quoted-path-run');

    const real = await reallySpawn('quotedtool', runDir, marker);
    assert.equal(
      real.ran,
      true,
      'the fixture must really run through the quoted entry, or this test proves nothing',
    );
    assert.equal(real.exitCode, 7, 'and come back with its own failing exit code');

    const said = explainUnstartableCommand({
      line: 'quotedtool',
      cwd: runDir,
      exitCode: 7,
      stderr: real.stderr,
    });
    assert.equal(
      said,
      null,
      `that program just ran and exited 7, so DSpatch must report a real failure and add ` +
        `nothing. It said: ${said ?? '(nothing)'}`,
    );
  });

  it('does not deny a tool whose arguments the shell split on a comma or an equals sign', windowsOnly, async () => {
    const toolsDir = scratch('separators');
    const marker = writeTool(toolsDir, 'mytool');
    usePath(`${toolsDir};${originalPath}`);

    for (const line of ['mytool,arg', 'mytool=arg']) {
      const real = await reallySpawn(line, toolsDir, marker);
      assert.equal(
        real.ran,
        true,
        `cmd.exe really runs mytool for "${line}", so this is a working command line`,
      );
      const said = explainUnstartableCommand({
        line,
        cwd: toolsDir,
        exitCode: real.exitCode,
        stderr: real.stderr,
      });
      assert.equal(
        said,
        null,
        `"${line}" ran a program and it failed, so DSpatch must not tell the user there is ` +
          `no such program. It said: ${said ?? '(nothing)'}`,
      );
    }
  });

  /**
   * The over-claim that was live on Niclas's machine.
   *
   * `winget --version` prints `v1.29.290` and the resolver said there was no such
   * program, because App Execution Aliases are reparse points `fs.statSync` refuses
   * with `EACCES` and the `exists` callback turned every error into "not there".
   *
   * The marker here is the program's own output on **stdout**: a command the shell
   * cannot find prints to stderr and writes nothing to stdout, so non-empty stdout
   * is a program that really ran. Which tools exist varies by machine, which is why
   * the test asserts a floor on how many answered rather than naming one.
   */
  it('never tells the user a program that just printed its version does not exist', windowsOnly, async () => {
    const cwd = scratch('real-tools');
    const candidates = ['winget', 'node', 'npm', 'git', 'where', 'python3'];
    const answered: string[] = [];

    for (const name of candidates) {
      const real = await reallySpawn(`${name} --version`, cwd, null);
      if (!real.ran) {
        continue;
      }
      answered.push(name);
      const said = explainUnstartableCommand({
        line: `${name} --version`,
        cwd,
        exitCode: 1,
        stderr: real.stderr,
      });
      assert.equal(
        said,
        null,
        `"${name}" ran and printed ${JSON.stringify(real.stdout.trim().slice(0, 60))}, so ` +
          `DSpatch must not claim it does not exist. It said: ${said ?? '(nothing)'}`,
      );
      assert.notEqual(
        resolveExecutableHere(name, cwd).kind,
        'not-found',
        `and must not resolve ${name} as not-found either — unknown is the honest answer ` +
          `for a file it is not allowed to read`,
      );
    }

    assert.ok(
      answered.length >= 3,
      `at least three of ${candidates.join(', ')} must have run for this to prove anything; ` +
        `these answered: ${answered.join(', ') || '(none)'}`,
    );
  });

  /**
   * The other direction, which the fix must not cost. Letting an unreadable
   * candidate reach `undecidable` would be a poor trade if it also silenced the
   * message for a command that genuinely is not there.
   */
  it('still names a program that really is not there', windowsOnly, async () => {
    const cwd = scratch('really-missing');
    const line = 'dspatch-no-such-tool-9f3a --version';
    const real = await reallySpawn(line, cwd, null);
    assert.equal(real.ran, false, 'nothing may have run, or this is testing the wrong thing');

    const said = explainUnstartableCommand({
      line,
      cwd,
      exitCode: real.exitCode,
      stderr: real.stderr,
    });
    assert.match(
      said ?? '(DSpatch said nothing, so this reads as a failing test suite)',
      /There is no program called "dspatch-no-such-tool-9f3a"/,
      `a mistyped command must still be named as one after the resolver was made ` +
        `cautious. It said: ${said ?? '(nothing)'}`,
    );
  });
});

/* ------------------------------------------------------------------------- */
/* D3 — the PowerShell build script DSP-26 #4 names                         */
/* ------------------------------------------------------------------------- */

describe('a PowerShell build script as the gate command', () => {
  it('refuses the bare form rather than recording a pass for a build that never ran', windowsOnly, async () => {
    const root = scratch('ps1-gate');
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    const marker = path.join(root, 'build-ran.txt');
    fs.writeFileSync(
      path.join(root, 'scripts', 'build-windows.ps1'),
      `Set-Content -LiteralPath ${JSON.stringify(marker)} -Value 'BUILD_RAN'\nexit 3\n`,
      'utf8',
    );

    // First, and before anything is spawned. With the refusal reverted this fails
    // here, which is deliberate: the assertion below it would otherwise spawn the
    // bare `.ps1` and leave an invisible Windows file chooser behind.
    const bare = checkRunRequest('.\\scripts\\build-windows.ps1', root);
    assert.equal(
      bare.ok,
      false,
      'the shell accepts a bare .ps1 and runs nothing, returning exit 0 — which this ' +
        'product records as work-verified and the badge "your command passed"',
    );

    const refused = await runConfiguredProjectTest('.\\scripts\\build-windows.ps1', root, 10_000);
    assert.equal(
      fs.existsSync(marker),
      false,
      'and no process may have been started for it',
    );
    const { outcome, sentence } = outcomeOf(refused, 'completed');
    assert.notEqual(
      outcome,
      'work-verified',
      `nothing ran, so the record must not say the work was verified. The sentence was: ` +
        `${sentence}`,
    );
    assert.doesNotMatch(sentence, /exited 0/, 'and must not report an exit code nobody produced');
    assert.match(sentence, /DSpatch did not start a command of its own/);
    assert.match(
      sentence,
      /powershell -NoProfile -File/,
      'and the reason must carry the command that does work all the way into the record',
    );
  });

  /**
   * The refusal above is only defensible if the form it recommends really works, so
   * that is measured rather than asserted: the script writes a marker and exits 3,
   * and the gate has to come back with a real `tests-failed` about the project.
   */
  it('runs the hosted form for real, and passes its exit code through', windowsOnly, async () => {
    const root = scratch('ps1-hosted');
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    const marker = path.join(root, 'build-ran.txt');
    fs.writeFileSync(
      path.join(root, 'scripts', 'build-windows.ps1'),
      `Set-Content -LiteralPath ${JSON.stringify(marker)} -Value 'BUILD_RAN'\nexit 3\n`,
      'utf8',
    );

    const record = await runConfiguredProjectTest(
      'powershell -NoProfile -File .\\scripts\\build-windows.ps1',
      root,
      120_000,
    );
    assert.equal(
      fs.existsSync(marker),
      true,
      'the script must really have executed, or the recommended form is no better than ' +
        'the one being refused',
    );
    assert.equal(record.notRun, null, 'a process really ran');
    assert.equal(record.exitCode, 3, 'and its own exit code must arrive unchanged');

    const { outcome, sentence } = outcomeOf(record, 'completed');
    assert.equal(
      outcome,
      'tests-failed',
      `a build script that ran and exited 3 is a real result about the project. The ` +
        `sentence was: ${sentence}`,
    );
    assert.match(sentence, /exited 3/);
  });
});

/* ------------------------------------------------------------------------- */
/* D3 — the gate command that never comes back                               */
/* ------------------------------------------------------------------------- */

describe('a gate command that does not finish', () => {
  /**
   * The structural half of D3, and the one that outlives the `.ps1` case.
   *
   * `StepContext.deadlineAt` was raced against the provider turn in the agent
   * branch and against nothing at all in the gate branch, so a command that did not
   * return held the whole run open — no ending, no output, no window, and the
   * process still running in the user's project.
   *
   * Proven three ways, in the order a person would care about them: the call comes
   * back at all, the process was really started, and the process is really dead
   * afterwards. The last is measured from the program's own heartbeat rather than
   * from `taskkill`'s exit code, because a kill that reports success and leaves the
   * process running is exactly the failure worth catching.
   */
  it('is stopped, reported, and left neither a pass nor a failure', async () => {
    const root = scratch('forever');
    const marker = path.join(root, 'forever-ran.txt');
    const heartbeat = path.join(root, 'heartbeat.txt');
    fs.writeFileSync(
      path.join(root, 'forever.mjs'),
      [
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(marker)}, 'FOREVER_RAN');`,
        'let ticks = 0;',
        'setInterval(() => {',
        '  ticks += 1;',
        `  fs.writeFileSync(${JSON.stringify(heartbeat)}, String(ticks));`,
        '}, 100);',
        '',
      ].join('\n'),
      'utf8',
    );

    const neverCameBack = 'never came back';
    const raced = await Promise.race([
      runConfiguredProjectTest('node forever.mjs', root, 3_000),
      sleep(25_000).then(() => neverCameBack),
    ]);
    assert.notEqual(
      raced,
      neverCameBack,
      'a gate command that does not return must be stopped and reported: leaving it ' +
        'running holds the whole run open with no ending and nothing on screen',
    );
    const record = raced as LiveCommandRecord;

    assert.equal(
      fs.existsSync(marker),
      true,
      'the command must really have started, or this is measuring a refusal instead',
    );
    assert.equal(
      record.notRun?.kind,
      'did-not-finish',
      `a command that started and was stopped is neither "could not start" nor an exit ` +
        `code. It reported: ${JSON.stringify(record.notRun)}`,
    );

    const { outcome, sentence } = outcomeOf(record, 'runtime-fault');
    assert.equal(
      outcome,
      'unresolved',
      `nothing was established about the project, and the record must say so rather than ` +
        `guessing. The sentence was: ${sentence}`,
    );
    assert.match(sentence, /not a pass and not a failure/);
    // What it asked for, not what it achieved. The Verifier of this run made a
    // descendant survive — a hanging child whose launcher had exited — and confirmed
    // with `Get-Process` that it was still alive after DSpatch had written *"so
    // DSpatch stopped it"*, byte-identical to the case where the tree really died.
    // `killCommandTree` never reads `taskkill`'s exit code, so the claim cannot be
    // justified from here at all.
    assert.doesNotMatch(
      sentence,
      /so DSpatch stopped it/,
      `DSpatch must not claim it stopped the command: it asks the operating system and ` +
        `never learns whether that worked. It said: ${sentence}`,
    );
    assert.match(
      sentence,
      /may still be running/,
      `it must say the command may still be running, the way the gate's own outer backstop ` +
        `already does, so a person can check. It said: ${sentence}`,
    );
    assert.match(
      sentence,
      /check for it before starting another run/,
      `and must say what to do about it. It said: ${sentence}`,
    );
    // Narrowed from `/exited/` to the exit code itself. The honest stop message names an
    // intermediate process that has *already exited* as the reason a helper can survive,
    // so the bare word now appears legitimately; what must never appear is a claim that
    // the command exited with a code, because there is no code for a command that was
    // stopped.
    assert.doesNotMatch(sentence, /exited \d/, 'there was no exit code to report');

    // And the process is gone. Its own heartbeat is the witness, sampled twice:
    // `taskkill` is asynchronous and measured here at about 400 ms behind the
    // report, so the first sample waits for it to land and the second proves the
    // ticking has really stopped rather than merely slowed.
    await sleep(2_000);
    const atStop = fs.readFileSync(heartbeat, 'utf8');
    await sleep(1_500);
    assert.equal(
      fs.readFileSync(heartbeat, 'utf8'),
      atStop,
      'a command DSpatch gave up on must be stopped, not abandoned still running in the ' +
        "user's project",
    );
  });
});

/* ------------------------------------------------------------------------- */
/* DSP-25 #3 — the field that claimed to be a start time                     */
/* ------------------------------------------------------------------------- */

describe('when the record says a command started', () => {
  /**
   * `RecordedCommand.startedAtUtc` was not a start time. `main.ts` stamped the
   * moment the command *settled*, and `closeChatLoopRecord` stamped the moment the
   * record was *closed* for the copies inside the ending line, so the same command
   * was written twice with two different times and neither was its start.
   * `durationMs` could not recover the real one from either, and DSP-27 is about to
   * draw a timeline from these two fields.
   */
  it('says when it started, not when DSpatch got round to writing it down', async () => {
    const root = scratch('started-at');
    fs.writeFileSync(
      path.join(root, 'slow.mjs'),
      'setTimeout(() => {}, 900);\n',
      'utf8',
    );

    const before = Date.now();
    const record = await runConfiguredProjectTest('node slow.mjs', root, 60_000);
    const after = Date.now();
    const recorded = recordedCommandFrom(record, null);
    const startedMs = Date.parse(recorded.startedAtUtc);

    assert.ok(
      record.durationMs >= 700,
      `the fixture must take measurable time for this to mean anything; it took ` +
        `${String(record.durationMs)}ms`,
    );
    assert.ok(
      startedMs <= before + 400,
      `the record must say when the command started (about ` +
        `${new Date(before).toISOString()}), not when it ended (about ` +
        `${new Date(after).toISOString()}). It said ${recorded.startedAtUtc}, which is ` +
        `${String(startedMs - before)}ms after the call was made.`,
    );
    assert.ok(
      startedMs >= before - 100,
      `and it must not predate the call. It said ${recorded.startedAtUtc}.`,
    );
    assert.ok(
      startedMs + record.durationMs <= after + 200,
      'start plus duration must land where the command really ended, so a timeline drawn ' +
        'from those two fields is the real one',
    );
  });
});
