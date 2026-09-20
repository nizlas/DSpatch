/**
 * Telling a mistyped command apart from a failing test suite, without reading the
 * shell's words.
 *
 * The measurement behind this, from the Verifier of run `20260917-182500-gate18`:
 * with `shell: true` a missing executable comes back as exit code **1**, not
 * `9009`, with the shell's own message on stderr. So the exit code cannot carry
 * the distinction, and stderr cannot either — that message is translated on a
 * Swedish Windows, and a product that parsed it would be a defect generator.
 *
 * The assertions here are on the sentence a person reads first, and the rule that
 * matters most is the one about saying nothing: a wrong "that command does not
 * exist" over a genuine test failure would be a new false statement about the
 * user's project, which is the class of defect this work exists to remove.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  commandLineShape,
  explainUnstartableCommand,
  resolveExecutable,
  resolveExecutableHere,
  type ExecutableResolution,
} from '../src/main/command-start';

const found = (): ExecutableResolution => ({ kind: 'found', at: 'C:/tools/npm.cmd' });
const missing = (): ExecutableResolution => ({ kind: 'not-found' });

describe('a command that was never started', () => {
  it('is reported as a command that does not exist, not as a failing test suite', () => {
    const said = explainUnstartableCommand({
      line: 'nmp test',
      cwd: 'C:/Users/nicla/projects/hers',
      exitCode: 1,
      stderr: "'nmp' is not recognized as an internal or external command,\noperable program or batch file.",
      resolve: missing,
    });
    assert.match(
      said ?? '(DSpatch said nothing, so this reads as a failing test suite)',
      /There is no program called "nmp"/,
      `a mistyped command must be named as one. It said: ${said ?? '(nothing)'}`,
    );
    assert.match(
      said ?? '',
      /came from the shell rather than from your project/,
      'and must say the exit code is not the project speaking',
    );
    // The shell's own words, passed through. On a Swedish Windows this sentence is
    // in Swedish and is still the most useful thing on screen.
    assert.match(said ?? '', /is not recognized as an internal or external command/);
  });

  it('says nothing at all about a command that exists and failed', () => {
    const said = explainUnstartableCommand({
      line: 'npm test',
      cwd: 'C:/Users/nicla/projects/hers',
      exitCode: 1,
      stderr: '3 tests failed',
      resolve: found,
    });
    assert.equal(
      said,
      null,
      'a real test failure must stay a real test failure, with no DSpatch commentary',
    );
  });

  it('says nothing about a line whose first program it cannot identify', () => {
    // Three shapes where a confident answer would be a guess: a second command
    // after `&&`, a variable that the shell expands before looking anything up,
    // and a redirect. Half a shell parser is worse than none.
    for (const line of ['nmp test && echo done', '%RUNNER% test', 'nmp test > out.txt']) {
      assert.equal(
        explainUnstartableCommand({
          line,
          cwd: 'C:/p',
          exitCode: 1,
          stderr: 'whatever',
          resolve: missing,
        }),
        null,
        `"${line}" is not a single simple command, so DSpatch must not claim anything about it`,
      );
    }
  });

  it('says nothing when the command exited 0, whatever it thinks of the name', () => {
    assert.equal(
      explainUnstartableCommand({
        line: 'nmp test',
        cwd: 'C:/p',
        exitCode: 0,
        stderr: '',
        resolve: missing,
      }),
      null,
      'a command that succeeded evidently started, whatever this module believes',
    );
  });
});

describe('reading the first word of a command line', () => {
  it('keeps a quoted path with spaces in one piece', () => {
    const shape = commandLineShape('"C:/Program Files/nodejs/node.exe" --test test/x.test.ts');
    assert.equal(shape.simple, true, 'a quoted program with arguments is still one plain command');
    assert.equal(
      shape.executable,
      'C:/Program Files/nodejs/node.exe',
      'the program is the whole quoted path, not the part before the first space',
    );
  });

  it('refuses a line with shell syntax in it, and says why', () => {
    const shape = commandLineShape('cmake --build build && ctest');
    assert.equal(
      shape.simple,
      false,
      'two commands joined by && are not one command whose first word can be looked up',
    );
    assert.equal(shape.executable, null, 'and no program may be named for such a line');
    assert.match(shape.why ?? '', /shell syntax/, 'and the reason must say so in words');
  });

  /**
   * `cmd.exe` separates arguments on `,` and `=` as well as on space and tab, which
   * `tests/gate-command-reality.test.ts` demonstrates against the real shell. This
   * read the whole string as the program name and reported a working program as
   * missing.
   */
  it('claims nothing about a first word containing a shell argument separator', () => {
    for (const line of ['mytool,arg', 'mytool=arg', 'ctest,-R,quick']) {
      const shape = commandLineShape(line);
      assert.equal(
        shape.simple,
        false,
        `"${line}" runs a program whose name ends before the separator, so DSpatch must ` +
          `not look up the whole string and then say it does not exist`,
      );
      assert.equal(shape.executable, null);
      assert.match(shape.why ?? '', /separator/, 'and the reason must say so in words');
    }
  });

  it('keeps a separator that is inside the quoted program path', () => {
    const shape = commandLineShape('"C:/Program Files/a=b/tool.exe" --run');
    assert.equal(
      shape.simple,
      true,
      'inside quotes a separator is part of the program\'s own path, not an argument break',
    );
    assert.equal(shape.executable, 'C:/Program Files/a=b/tool.exe');
  });
});

describe('where the shell would look', () => {
  const base = {
    cwd: 'C:/project',
    pathValue: 'C:/tools;C:/other',
    pathExt: '.COM;.EXE;.BAT;.CMD',
    isWindows: true,
  };

  it('finds a bare name through PATHEXT on PATH', () => {
    const resolution = resolveExecutable('npm', {
      ...base,
      // Case-insensitively, because `PATHEXT` is conventionally upper case and the
      // file on disk is not. Windows does not care and neither may this.
      exists: (candidate) => candidate.replaceAll('\\', '/').toLowerCase() === 'c:/tools/npm.cmd',
    });
    assert.equal(
      resolution.kind,
      'found',
      'npm on PATH as npm.cmd is a program that exists, so a failing npm test is the project failing',
    );
  });

  it("finds a relative script against the run's own working directory", () => {
    const resolution = resolveExecutable('.\\scripts\\build-windows.ps1', {
      ...base,
      exists: (candidate) =>
        candidate.replaceAll('\\', '/') === 'C:/project/scripts/build-windows.ps1',
    });
    assert.equal(resolution.kind, 'found', 'the working directory travels with the command');
  });

  /**
   * A builtin is not a file and is never on a path. Treating one as missing would
   * turn a working `echo` into "that command does not exist", which is the failure
   * mode that decides this module must never gate a spawn.
   */
  it('never calls one of the shell\'s own commands missing', () => {
    for (const builtin of ['echo', 'cd', 'set', 'dir']) {
      assert.equal(
        resolveExecutable(builtin, { ...base, exists: () => false }).kind,
        'builtin',
        `${builtin} is cmd.exe's own and cannot be missing`,
      );
    }
  });

  it('reports a name that is nowhere as not found', () => {
    assert.equal(
      resolveExecutable('nmp', { ...base, exists: () => false }).kind,
      'not-found',
      'a name that is in no directory on PATH is the one case DSpatch may call missing',
    );
  });

  /**
   * The branch that was unreachable in production.
   *
   * `resolveExecutable` has always had `undecidable` for a candidate it could not
   * check, but `resolveExecutableHere`'s `exists` callback caught every error and
   * returned `false`, so every unreadable file became a confident "not found". On
   * Niclas's machine that made `winget` — which runs, and prints `v1.29.290` —
   * into a program DSpatch said did not exist, because Windows App Execution
   * Aliases are reparse points `fs.statSync` refuses with `EACCES`.
   *
   * The real-shell half of this is in `tests/gate-command-reality.test.ts`; this is
   * the rule, stated where it can be checked without a particular machine.
   */
  it('says it does not know, rather than not found, when a candidate cannot be checked', () => {
    const resolution = resolveExecutable('winget', {
      ...base,
      exists: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
    });
    assert.equal(
      resolution.kind,
      'undecidable',
      'a file DSpatch is not allowed to read is unknown, and unknown must not be ' +
        'reported to the user as a program that does not exist',
    );
  });

  /**
   * The other direction, against the **production** callback rather than an
   * injected one, because that is where the distinction lives. A token with a path
   * separator in it is resolved against the working directory alone, so this asks
   * about one empty temp folder and never consults the machine's real `PATH` —
   * which is what keeps it from depending on which tools happen to be installed.
   */
  it('still calls a name missing when the error really means there is nothing there', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-resolve-empty-'));
    try {
      assert.equal(
        resolveExecutableHere('.\\dspatch-no-such-tool-9f3a', empty).kind,
        'not-found',
        'a plain missing file means nothing of that name is there, so the ' +
          'mistyped-command message must survive the fix rather than be replaced by silence',
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('strips the quotes from a PATH entry the way the shell does', () => {
    const resolution = resolveExecutable('quotedtool', {
      ...base,
      pathValue: '"C:/Program Files/tools";C:/other',
      // Case-insensitively, as above: `PATHEXT` is upper case and the file is not.
      exists: (candidate) =>
        candidate.replaceAll('\\', '/').toLowerCase() === 'c:/program files/tools/quotedtool.exe',
    });
    assert.equal(
      resolution.kind,
      'found',
      'a quoted PATH entry is ordinary on Windows and the shell searches it, so a tool ' +
        'reachable only through one must not be reported as missing',
    );
  });
});
