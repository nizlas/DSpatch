/**
 * The build/test command and the staleness rule.
 *
 * AC#8 has one sentence that is easy to satisfy and one that is easy to get
 * wrong. Showing a command, its output and its exit code is straightforward.
 * Making sure an old green result stops applying once the code moves underneath
 * it is a rule, and a rule that has quietly stopped being able to fail looks
 * exactly like a rule that is working — so `evaluateFreshness` is tested against
 * a counter-example as well as against its happy path.
 *
 *     node --test tests/test-command.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  checkRunRequest,
  describeShell,
  evaluateFreshness,
  evaluateTestVerdict,
  presentTestStatus,
  suggestBuildCommand,
} from '../src/main/test-command.ts';
import { unrunnableScript } from '../src/main/command-start.ts';
import type { TestVerdict } from '../src/shared/bridge.ts';

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

function tempProject(name: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-cmd-${name}-`));
  roots.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return root;
}

// --- What the fields are filled in with -------------------------------------

test('a project with a test script gets npm test, and the note quotes the script', () => {
  const root = tempProject('npm', {
    'package.json': JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }),
  });
  const suggestion = suggestBuildCommand(root, null);
  assert.equal(suggestion.command, 'npm test');
  assert.equal(suggestion.cwd, root);
  // The note has to let the reader check the suggestion rather than trust it.
  assert.match(suggestion.note, /vitest run/);
});

test('a project with only a build script is offered its build, said plainly', () => {
  const root = tempProject('build', {
    'package.json': JSON.stringify({ name: 'x', scripts: { build: 'tsc -p .' } }),
  });
  const suggestion = suggestBuildCommand(root, null);
  assert.equal(suggestion.command, 'npm run build');
  assert.match(suggestion.note, /no test script/);
});

test('a project DSpatch does not recognise gets an empty field, not a guess', () => {
  const root = tempProject('unknown', { 'main.rs': 'fn main() {}\n' });
  const suggestion = suggestBuildCommand(root, null);
  assert.equal(suggestion.command, '');
  assert.equal(suggestion.cwd, root);
  assert.match(suggestion.note, /not guessing/);
});

/**
 * DSP-51 #3, and it is the first sentence a person with a C++ project reads.
 *
 * An empty Command field with a note saying *type one* is the window's most
 * discouraging first impression, and since DSP-45 it is also incomplete: a step of
 * the loop does not use this field. A checking agent discovers and runs the
 * project's own checks. The note is the only place that can say so before the
 * person types.
 */
test('the empty field says the loop does not use it', () => {
  const root = tempProject('cmake', {
    'CMakeLists.txt': 'project(spike)\n',
    'src/main.cpp': 'int main() { return 0; }\n',
  });
  const suggestion = suggestBuildCommand(root, null);
  assert.equal(suggestion.command, '', 'still empty: DSpatch has not worked one out');
  assert.match(suggestion.note, /not guessing/);
  assert.match(suggestion.note, /loop does not use this field/);
  assert.match(suggestion.note, /checking agent/);
  assert.doesNotMatch(suggestion.note, /approve|proposal|leave it empty/);
});

test('an unparsable package.json is treated as absent rather than crashing', () => {
  const root = tempProject('broken', { 'package.json': '{ not json' });
  assert.equal(suggestBuildCommand(root, null).command, '');
});

test('a node runner path with spaces is quoted for the shell', () => {
  const root = tempProject('sample', {
    'test/duration.test.ts': '// specification\n',
    'package.json': JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }),
  });
  const suggestion = suggestBuildCommand(root, 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(
    suggestion.command,
    '"C:\\Program Files\\nodejs\\node.exe" --test test/duration.test.ts',
  );
});

test('without a node runner the sample command falls back to PATH and says so', () => {
  const root = tempProject('sample-nopath', { 'test/duration.test.ts': '\n' });
  const suggestion = suggestBuildCommand(root, null);
  assert.equal(suggestion.command, 'node --test test/duration.test.ts');
  assert.match(suggestion.note, /on PATH/);
});

// --- Refusing a request that cannot run --------------------------------------

test('an empty command is refused with what to do about it', () => {
  const check = checkRunRequest('   ', os.tmpdir());
  assert.equal(check.ok, false);
  assert.match(String(check.message), /Type the build or test command/);
});

test('a working directory that is not there is refused by name', () => {
  const missing = path.join(os.tmpdir(), 'dspatch-does-not-exist-9f3a');
  const check = checkRunRequest('npm test', missing);
  assert.equal(check.ok, false);
  assert.match(String(check.message), /no folder at/);
  assert.ok(String(check.message).includes(missing));
});

test('a file where a folder belongs is refused as a file', () => {
  const root = tempProject('file-cwd', { 'a.txt': 'x' });
  const check = checkRunRequest('npm test', path.join(root, 'a.txt'));
  assert.equal(check.ok, false);
  assert.match(String(check.message), /is a file, not a folder/);
});

test('a usable request passes with no message', () => {
  const root = tempProject('ok', {});
  assert.deepEqual(checkRunRequest('npm test', root), { ok: true, message: null });
});

// --- The one command refused on its content ---------------------------------
//
// DSP-26 #4 names a PowerShell build script, and the project Niclas first ran this
// against is built by `.\scripts\build-windows.ps1`. The Verifier of run
// `20260917-204500-obs18` put exactly that through the gate and measured two
// outcomes: `cmd.exe` returned **exit 0 having executed nothing**, which the
// product then recorded as `work-verified` and the badge *your command passed*;
// and, on a second script, no return at all for 154 seconds. Refusing at the
// Command field is the only point at which DSpatch knows enough to help.
//
// The tests that matter most here are the ones that prove the refusal is *narrow*,
// because a refusal that fires on a command that would have worked is worse than
// the false green it closes.

const windowsOnly = { skip: process.platform === 'win32' ? false : 'cmd.exe behaviour' };

test('a bare PowerShell script is refused with the command that does work', windowsOnly, () => {
  const root = tempProject('ps1-bare', {
    'scripts/build-windows.ps1': "Write-Output 'BUILD_RAN'\nexit 0\n",
  });
  const check = checkRunRequest('.\\scripts\\build-windows.ps1', root);
  assert.equal(
    check.ok,
    false,
    'the shell will not run a .ps1 as a program: it returns 0 having executed nothing, ' +
      'which DSpatch would record as a pass for a build that never happened',
  );
  assert.match(
    String(check.message),
    /powershell -NoProfile -File \.\\scripts\\build-windows\.ps1/,
    'and the refusal must hand over the working form, arguments and all',
  );
  assert.match(
    String(check.message),
    /exit 0 without running a line of your script/,
    'and say what the silent failure is, so "it works in my terminal" has an answer',
  );
  assert.ok(String(check.message).includes(root), 'and name the file it actually found');
});

test('the refusal does not fire on the form that works', windowsOnly, () => {
  const root = tempProject('ps1-hosted', {
    'scripts/build-windows.ps1': "Write-Output 'BUILD_RAN'\nexit 0\n",
  });
  assert.deepEqual(
    checkRunRequest('powershell -NoProfile -File .\\scripts\\build-windows.ps1', root),
    { ok: true, message: null },
    'the command DSpatch recommends must be a command DSpatch accepts',
  );
});

test('a .ps1 that is not there is an ordinary missing program, not a lecture', windowsOnly, () => {
  const root = tempProject('ps1-absent', {});
  assert.deepEqual(
    checkRunRequest('.\\scripts\\build-windows.ps1', root),
    { ok: true, message: null },
    'a path that does not exist already has a message — the shell\'s own — and must not ' +
      'be answered with advice about PowerShell hosts',
  );
});

test('a script kind the shell does run is left alone', windowsOnly, () => {
  const root = tempProject('cmd-script', { 'build.cmd': '@echo off\r\nexit /b 0\r\n' });
  assert.deepEqual(
    checkRunRequest('.\\build.cmd', root),
    { ok: true, message: null },
    'a .cmd is in PATHEXT and cmd.exe starts it as a program, so DSpatch has nothing to add',
  );
});

test('an account that has declared .ps1 runnable is not overruled', () => {
  const root = tempProject('ps1-pathext', {
    'scripts/build-windows.ps1': 'exit 0\n',
  });
  assert.equal(
    unrunnableScript('.\\scripts\\build-windows.ps1', root, {
      isWindows: true,
      pathExt: '.COM;.EXE;.BAT;.CMD;.PS1',
    }),
    null,
    'putting .PS1 in PATHEXT is a deliberate statement that this account runs them, and ' +
      'DSpatch defers to a configuration it cannot fully check rather than refusing',
  );
});

test('nothing is refused on a platform this rule is not about', () => {
  assert.equal(
    unrunnableScript('./scripts/build.ps1', '/home/nicla/p', {
      isWindows: false,
      resolve: () => ({ kind: 'found', at: '/home/nicla/p/scripts/build.ps1' }),
    }),
    null,
    'this is cmd.exe\'s ShellExecute fallback and nothing else',
  );
});

test('the shell that will interpret the command is named', () => {
  const shell = describeShell();
  assert.ok(shell.length > 0);
  assert.match(shell, process.platform === 'win32' ? /\/c$/ : /-c$/);
});

// --- Whether a result still applies ------------------------------------------

test('no run yet is no result, not a passing one', () => {
  const verdict = evaluateFreshness({
    hasResult: false,
    testedSnapshotId: null,
    afterRunSnapshotId: null,
    currentSnapshotId: null,
  });
  assert.equal(verdict.kind, 'no-result');
});

test('an unchanged working copy keeps the result current', () => {
  const verdict = evaluateFreshness({
    hasResult: true,
    testedSnapshotId: 'snap-aaaa',
    afterRunSnapshotId: 'snap-aaaa',
    currentSnapshotId: 'snap-aaaa',
  });
  assert.equal(verdict.kind, 'current');
  assert.equal(verdict.commandChangedWorkspace, false);
});

test('code changed after the run makes the result stale and names both snapshots', () => {
  const verdict = evaluateFreshness({
    hasResult: true,
    testedSnapshotId: 'snap-aaaa',
    afterRunSnapshotId: 'snap-aaaa',
    currentSnapshotId: 'snap-bbbb',
  });
  assert.equal(verdict.kind, 'stale');
  assert.match(verdict.headline, /snap-aaaa/);
  assert.match(verdict.headline, /snap-bbbb/);
  // The wording has to leave no room for reading the old result as a verdict.
  assert.match(verdict.headline, /run it again/i);
});

test('the staleness rule can fail, and this is what failing looks like', () => {
  // The negative control. A rule that only asked "is there a result?" — which is
  // what an implementation without the snapshot comparison amounts to — calls
  // this exact input current. That is AC#8's named defect: an old green result
  // sitting beside code it never ran on.
  const input = {
    hasResult: true,
    testedSnapshotId: 'snap-aaaa',
    afterRunSnapshotId: 'snap-aaaa',
    currentSnapshotId: 'snap-bbbb',
  };
  const withoutTheComparison = input.hasResult ? 'current' : 'no-result';
  assert.equal(withoutTheComparison, 'current');
  assert.equal(evaluateFreshness(input).kind, 'stale');
});

test('a command that wrote into its own working copy is flagged separately', () => {
  const verdict = evaluateFreshness({
    hasResult: true,
    testedSnapshotId: 'snap-aaaa',
    afterRunSnapshotId: 'snap-bbbb',
    currentSnapshotId: 'snap-bbbb',
  });
  // Not stale: nothing has changed since it finished. But what it tested is not
  // what it left behind, and that is its own warning rather than silence.
  assert.equal(verdict.kind, 'current');
  assert.equal(verdict.commandChangedWorkspace, true);
});

test('a working copy that could not be hashed is unknown, never current', () => {
  const verdict = evaluateFreshness({
    hasResult: true,
    testedSnapshotId: 'snap-aaaa',
    afterRunSnapshotId: 'snap-aaaa',
    currentSnapshotId: null,
  });
  assert.equal(verdict.kind, 'unknown');
  assert.match(verdict.headline, /Unknown is not the same as unchanged/);
});

test('a run whose own snapshot failed is unknown rather than silently current', () => {
  const verdict = evaluateFreshness({
    hasResult: true,
    testedSnapshotId: null,
    afterRunSnapshotId: null,
    currentSnapshotId: 'snap-cccc',
  });
  assert.equal(verdict.kind, 'unknown');
  assert.equal(verdict.commandChangedWorkspace, null);
});

// --- An interrupted run is never a pass (AC#6) ------------------------------

test('a killed command is interrupted whatever exit code it hands back', () => {
  // Windows makes this the important case rather than a theoretical one:
  // `taskkill /T /F` ends the tree with an ordinary exit code and no signal, so
  // the only evidence that DSpatch stopped it is DSpatch's own record.
  for (const exitCode of [0, 1, 3221225786, null]) {
    const result = evaluateTestVerdict({
      killedByDspatch: true,
      exitCode,
      signal: null,
    });
    assert.equal(result.verdict, 'interrupted', `exit ${String(exitCode)}`);
    assert.match(result.headline, /You stopped this command/);
  }
});

test('no observed ending can produce a pass', () => {
  // Exhaustive over what the child process API can report. The claim being made
  // is a negative one, so it is checked over the whole grid rather than on the
  // one case that came to mind.
  const exitCodes: readonly (number | null)[] = [null, 0, 1, 2, 130];
  const signals: readonly (string | null)[] = [null, 'SIGKILL', 'SIGTERM'];
  let passes = 0;
  for (const killedByDspatch of [false, true]) {
    for (const exitCode of exitCodes) {
      for (const signal of signals) {
        const { verdict } = evaluateTestVerdict({ killedByDspatch, exitCode, signal });
        const couldBeAPass = !killedByDspatch && signal === null && exitCode === 0;
        if (verdict === 'passed') {
          passes += 1;
          assert.equal(
            couldBeAPass,
            true,
            `passed for killed=${String(killedByDspatch)} exit=${String(exitCode)} ` +
              `signal=${String(signal)}`,
          );
        }
      }
    }
  }
  assert.equal(passes, 1, 'exactly one of the 30 combinations is a pass');
});

test('an ordinary run still reads as passed or failed', () => {
  assert.equal(
    evaluateTestVerdict({ killedByDspatch: false, exitCode: 0, signal: null }).verdict,
    'passed',
  );
  const failed = evaluateTestVerdict({
    killedByDspatch: false,
    exitCode: 1,
    signal: null,
  });
  assert.equal(failed.verdict, 'failed');
  assert.match(failed.headline, /exited 1/);
});

test('the exit-code rule this replaces reports an interrupted run as passed', () => {
  // The negative control, and it is not a straw man: `child.exitCode ?? 0` is the
  // ordinary way to end up with a number to compare against zero, and a runner
  // killed just after printing its summary can hand back 0 by itself. Under that
  // rule, a command the user stopped appears green.
  const interrupted = { killedByDspatch: true, exitCode: 0, signal: null } as const;

  const naive: TestVerdict = (interrupted.exitCode ?? 0) === 0 ? 'passed' : 'failed';
  assert.equal(naive, 'passed', 'the rule being replaced calls this a pass');

  assert.equal(evaluateTestVerdict(interrupted).verdict, 'interrupted');
  assert.equal(
    presentTestStatus(evaluateTestVerdict(interrupted).verdict, 'current').status,
    'interrupted',
  );
});

test('a pass against code that has changed is not presented as a pass', () => {
  assert.equal(presentTestStatus('passed', 'current').status, 'passed');

  const stale = presentTestStatus('passed', 'stale');
  assert.equal(stale.status, 'passed-for-older-code');
  assert.match(stale.headline, /says nothing about\s+what is on disk now/);

  // Unknown freshness cannot promote a pass either.
  assert.equal(presentTestStatus('passed', 'unknown').status, 'unknown');
  assert.equal(presentTestStatus(null, 'no-result').status, 'no-result');
});

test('a non-pass verdict survives every freshness reading', () => {
  for (const freshness of ['current', 'stale', 'unknown', 'no-result'] as const) {
    for (const verdict of ['failed', 'interrupted', 'unknown'] as const) {
      const presented = presentTestStatus(verdict, freshness);
      assert.notEqual(presented.status, 'passed');
      assert.notEqual(presented.status, 'passed-for-older-code');
    }
  }
});
