/**
 * Telling "your tests failed" apart from "that command does not exist".
 *
 * Measured by the Verifier of run `20260917-182500-gate18`, not assumed: because
 * DSpatch spawns the gate command with `shell: true`, a missing executable comes
 * back through `close` as exit code **1** — not `9009` — with the shell's own
 * message on stderr. One is the most common failing exit code there is, so the
 * exit code cannot carry the distinction. Parsing the shell's message would work
 * on an English Windows and break on Niclas's, so it would be a defect generator
 * rather than a fix. That left resolving the executable, which is what this is.
 *
 * **It never gates the spawn.** The command is always started exactly as the user
 * typed it, and this module is consulted only *afterwards*, when a command has
 * already come back non-zero. A resolver that decided whether to run something
 * would turn every gap in its own knowledge — a `doskey` alias, an App Execution
 * Alias, a shell function, a `PATHEXT` this code does not model — into a working
 * command DSpatch refuses.
 *
 * **A wrong answer here is not cheap, and an earlier version of this comment said
 * it was.** It claimed "the worst a wrong answer can do is word a failure badly,
 * and the command still ran". The Verifier of run `20260917-204500-obs18` measured
 * that this is false as built: a non-null `notRun` makes the gate in `loop-live.ts`
 * return `runtime-fault` / `no-outcome-delivered`, which **stops the run** under
 * `onRuntimeFault` instead of taking the graph's declared `fail` edge. So a real
 * failing program this code cannot see does not merely get worded badly — the walk
 * changes, and the record tells the user the exit code came from the shell rather
 * than from their project, which is a false statement about their code. That is
 * why the rule below is "answer only when sure" rather than "answer usually", and
 * why every case this code cannot check is silence rather than a guess.
 *
 * **It answers only when it is sure.** A line with any shell syntax in it —
 * a pipe, a redirect, `&&`, a variable, a quote it cannot resolve — is reported as
 * undecidable and the run says nothing about it. Half a shell parser that is right
 * most of the time is the thing this module exists to avoid.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Characters that mean the line is more than one command, or is rewritten before
 * the first word is looked up.
 *
 * `%` is here because `%VAR%` in the first token means the token this code can see
 * is not the token `cmd.exe` will search for.
 */
const SHELL_METACHARACTERS = /[&|<>^();%\r\n]/;

/**
 * Characters `cmd.exe` treats as argument separators as well as space and tab.
 *
 * Measured, not read: the Verifier of run `20260917-204500-obs18` really spawned
 * `mytool,arg` and `mytool=arg` with `shell: true` and both **ran `mytool`** with
 * `arg` as its argument, while this module read the whole string as the program
 * name and reported a working program missing.
 *
 * They make the first token **undecidable** rather than being split off, and that
 * is deliberate. Splitting would mean modelling which separators each shell
 * honours — `,` and `=` separate arguments for `cmd.exe` and do not for `sh`,
 * where `FOO=bar cmd` is an assignment prefix — and half a shell parser is the
 * thing this module exists to avoid. Silence is the answer this code is allowed to
 * be wrong about.
 */
const ARGUMENT_SEPARATORS = /[,=]/;

/**
 * `cmd.exe`'s own commands, which are not files and are never found on a path.
 *
 * Deliberately only the ones that really are internal. Anything doubtful — `more`,
 * `where`, `tasklist` — is a file on disk and is resolved as one.
 */
const CMD_BUILTINS: readonly string[] = [
  'assoc', 'break', 'call', 'cd', 'chdir', 'cls', 'color', 'copy', 'date', 'del',
  'dir', 'echo', 'endlocal', 'erase', 'exit', 'for', 'ftype', 'goto', 'if', 'md',
  'mkdir', 'mklink', 'move', 'path', 'pause', 'popd', 'prompt', 'pushd', 'rd',
  'rem', 'ren', 'rename', 'rmdir', 'set', 'setlocal', 'shift', 'start', 'time',
  'title', 'type', 'ver', 'verify', 'vol',
];

/** `/bin/sh`'s, for the platforms that are not Windows. */
const SH_BUILTINS: readonly string[] = [
  '.', ':', 'alias', 'bg', 'break', 'cd', 'command', 'continue', 'echo', 'eval',
  'exec', 'exit', 'export', 'false', 'fg', 'getopts', 'hash', 'jobs', 'kill',
  'pwd', 'read', 'readonly', 'return', 'set', 'shift', 'test', 'times', 'trap',
  'true', 'type', 'ulimit', 'umask', 'unalias', 'unset', 'wait',
];

export interface CommandLineShape {
  /** One command, no shell syntax, so its first word is the thing to be started. */
  readonly simple: boolean;
  /** The first word with its quotes removed, or `null` when the line is not simple. */
  readonly executable: string | null;
  /** Why the line is not simple, in one phrase. `null` when it is. */
  readonly why: string | null;
}

/**
 * The first word of a command line, when the line has only one command in it.
 *
 * Quotes are honoured because a Windows path with a space in it is ordinary and
 * `"C:/Program Files/x/y.exe"` is one word, not two.
 */
export function commandLineShape(line: string): CommandLineShape {
  const trimmed = line.trim();
  if (trimmed === '') {
    return { simple: false, executable: null, why: 'the line is empty' };
  }
  if (SHELL_METACHARACTERS.test(trimmed)) {
    return {
      simple: false,
      executable: null,
      why: 'the line uses shell syntax, so which program runs first is the shell\'s to decide',
    };
  }
  let token = '';
  let quoted = false;
  let separated = false;
  for (const character of trimmed) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (character === ' ' || character === '\t')) {
      break;
    }
    // Inside quotes a separator is part of the program's own path, which is why
    // this is checked here rather than against the whole line.
    if (!quoted && ARGUMENT_SEPARATORS.test(character)) {
      separated = true;
      break;
    }
    token += character;
  }
  if (quoted) {
    return { simple: false, executable: null, why: 'the line has an unclosed quote' };
  }
  if (separated) {
    return {
      simple: false,
      executable: null,
      why:
        'the first word contains a character the shell may treat as an argument ' +
        'separator, so where the program name ends is the shell\'s to decide',
    };
  }
  if (token === '') {
    return { simple: false, executable: null, why: 'the line begins with a quoted empty word' };
  }
  return { simple: true, executable: token, why: null };
}

export type ExecutableResolution =
  /** A file that exists and the shell will find. */
  | { readonly kind: 'found'; readonly at: string }
  /** The shell's own command. Not a file, and never missing. */
  | { readonly kind: 'builtin' }
  /** Nothing of that name on the path or in the working directory. */
  | { readonly kind: 'not-found' }
  /** This code cannot answer, so nothing is claimed. */
  | { readonly kind: 'undecidable'; readonly why: string };

export interface ResolveOptions {
  readonly cwd: string;
  /** `PATH` as the spawned shell will see it. */
  readonly pathValue: string;
  /** `PATHEXT` on Windows; ignored elsewhere. */
  readonly pathExt: string;
  readonly isWindows: boolean;
  /** Injected so the rules can be tested without a file system. */
  readonly exists: (candidate: string) => boolean;
}

/**
 * Where the shell would find this word, or that it would not find it at all.
 *
 * Mirrors `cmd.exe`'s search deliberately: the working directory first, then each
 * `PATH` entry, each tried with every `PATHEXT` suffix as well as bare. A word
 * containing a separator is a path and is only ever resolved against the working
 * directory, which is what both shells do.
 */
/**
 * `PATH` split the way the shell splits it, **including the quotes.**
 *
 * A quoted entry — `PATH=C:\tools;"C:\Program Files\Thing";…` — is ordinary on
 * Windows and the shell strips the quotes before searching. This code did not, so
 * it searched for a directory whose name literally began with `"`, never matched,
 * and reported a program that really runs as missing. Measured by differential
 * spawn, not reasoned about. (Niclas's own `PATH` has no quoted entry today, so
 * this one was an over-claim waiting rather than an over-claim happening.)
 */
function pathEntries(pathValue: string): readonly string[] {
  return pathValue
    .split(path.delimiter)
    .map((value) => value.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter((value) => value !== '');
}

export function resolveExecutable(token: string, options: ResolveOptions): ExecutableResolution {
  const builtins = options.isWindows ? CMD_BUILTINS : SH_BUILTINS;
  if (builtins.includes(token.toLowerCase())) {
    return { kind: 'builtin' };
  }
  const suffixes = options.isWindows
    ? ['', ...options.pathExt.split(';').map((value) => value.trim()).filter((value) => value !== '')]
    : [''];

  const hasSeparator = token.includes('/') || token.includes('\\') || /^[A-Za-z]:/.test(token);
  const directories = hasSeparator
    ? [options.cwd]
    : [
        // `cmd.exe` looks in the current directory first; `sh` does not, and a bare
        // word there is a `PATH` lookup only. Modelling the difference matters,
        // because otherwise `./build.sh` written as `build.sh` reads as found.
        ...(options.isWindows ? [options.cwd] : []),
        ...pathEntries(options.pathValue),
      ];
  if (directories.length === 0) {
    return { kind: 'undecidable', why: 'there is no PATH to search and no directory to look in' };
  }

  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = path.resolve(directory, `${token}${suffix}`);
      let found = false;
      try {
        found = options.exists(candidate);
      } catch {
        return {
          kind: 'undecidable',
          why: `${candidate} could not be checked, so whether the command exists is unknown`,
        };
      }
      if (found) {
        return { kind: 'found', at: candidate };
      }
    }
  }
  return { kind: 'not-found' };
}

/**
 * Errors that really mean "there is nothing of that name there".
 *
 * Everything else means "this candidate could not be checked", which is a
 * different answer and has to reach `resolveExecutable`'s `undecidable` branch
 * rather than being flattened into a confident "not found".
 *
 * `ENOENT` is the plain missing file. `ENOTDIR` is a `PATH` entry that is a file,
 * so nothing can be inside it. `ENAMETOOLONG` and `EINVAL` are names this file
 * system cannot hold, so no such file can exist either.
 */
const MISSING_FILE_CODES: readonly string[] = ['ENOENT', 'ENOTDIR', 'ENAMETOOLONG', 'EINVAL'];

/**
 * `resolveExecutable` against the real file system and this process's environment.
 *
 * **The `catch` used to swallow everything, and that made the `undecidable` branch
 * above unreachable in production.** Measured on Niclas's machine: `winget
 * --version` prints its version and exits 0, `where winget` finds
 * `…\WindowsApps\winget.exe`, and this module said there was no such program.
 * Windows App Execution Aliases are reparse points that `fs.statSync` refuses with
 * `EACCES`, so every one of them arrived here as "does not exist". A program that
 * cannot be checked is unknown, and unknown must be silence.
 */
export function resolveExecutableHere(token: string, cwd: string): ExecutableResolution {
  return resolveExecutable(token, {
    cwd,
    pathValue: process.env['PATH'] ?? process.env['Path'] ?? '',
    pathExt: process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD',
    isWindows: process.platform === 'win32',
    exists: (candidate) => {
      try {
        return fs.statSync(candidate).isFile();
      } catch (error) {
        const code = (error as { readonly code?: unknown }).code;
        if (typeof code === 'string' && MISSING_FILE_CODES.includes(code)) {
          return false;
        }
        throw error;
      }
    },
  });
}

/**
 * Whether a command that came back non-zero came back that way because it never
 * started, and what to tell the person if so.
 *
 * `null` means DSpatch has nothing to add and the exit code stands as a real
 * result about the project — which is the answer for every command that exists,
 * every line with shell syntax in it, and every case this code cannot decide.
 *
 * The shell's own message is passed through rather than replaced. On a Swedish
 * Windows it is in Swedish, it names the word that was not found, and it is more
 * useful than any sentence DSpatch could substitute for it.
 */
export function explainUnstartableCommand(input: {
  readonly line: string;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly resolve?: (token: string, cwd: string) => ExecutableResolution;
}): string | null {
  if (input.exitCode === 0 || input.exitCode === null) {
    return null;
  }
  const shape = commandLineShape(input.line);
  if (!shape.simple || shape.executable === null) {
    return null;
  }
  const resolve = input.resolve ?? resolveExecutableHere;
  const resolution = resolve(shape.executable, input.cwd);
  if (resolution.kind !== 'not-found') {
    return null;
  }
  const said = input.stderr.trim();
  return (
    `There is no program called "${shape.executable}" in ${input.cwd} or on this ` +
    `account's PATH, so the command never started and the exit code ` +
    `${String(input.exitCode)} came from the shell rather than from your project. ` +
    `${said === '' ? 'The shell printed nothing.' : `The shell said: ${said}`} ` +
    `Check the spelling in the Command field, or give the full path to the program.`
  );
}

/**
 * Script kinds `cmd.exe` cannot start as a program, and the host that can.
 *
 * `cmd.exe` runs a file by handing it to `CreateProcess`; a file it cannot start
 * that way it hands to `ShellExecute`, which is the double-click behaviour and not
 * a program run at all. For `.ps1` on an account with no association — the default
 * — that means one of two measured outcomes, both silent: `cmd.exe` returns **0
 * having executed nothing**, or it never returns because `ShellExecute` raised the
 * invisible *"How do you want to open this file?"* chooser behind `windowsHide`.
 */
const SCRIPT_HOSTS: Readonly<Record<string, string>> = {
  '.ps1': 'powershell -NoProfile -File',
};

export interface UnrunnableScript {
  /** The resolved file, so the message can name what was actually found. */
  readonly at: string;
  readonly extension: string;
  /** The same command, written the way the shell will really run it. */
  readonly workingForm: string;
}

/**
 * A command line the shell will accept and not run — the one case where refusing
 * beats reporting afterwards.
 *
 * This is the single exception to "never gate the spawn", and it is narrow on
 * purpose, because a refusal that fires on a command that would have worked is
 * worse than the defect it closes. Every one of these has to hold:
 *
 * - Windows, because this is `cmd.exe`'s `ShellExecute` fallback and nothing else.
 * - The line is simple, so the program name is not the shell's to decide.
 * - The extension is one that needs a host, and there is exactly one in the table.
 * - **The extension is not in `PATHEXT`.** Putting `.PS1` there is a deliberate
 *   statement that this account has made such files runnable, and DSpatch defers
 *   to it rather than overruling a configuration it cannot fully check.
 * - **The file really exists.** A `.ps1` that is not there is an ordinary missing
 *   program and already has a message; inventing a second one for it would refuse
 *   a typo with advice about PowerShell.
 *
 * `null` means DSpatch has nothing to say and the command is started as typed.
 */
export function unrunnableScript(
  line: string,
  cwd: string,
  options?: {
    readonly isWindows?: boolean;
    readonly pathExt?: string;
    readonly resolve?: (token: string, cwd: string) => ExecutableResolution;
  },
): UnrunnableScript | null {
  if (!(options?.isWindows ?? process.platform === 'win32')) {
    return null;
  }
  const shape = commandLineShape(line);
  if (!shape.simple || shape.executable === null) {
    return null;
  }
  const extension = path.extname(shape.executable).toLowerCase();
  const host = SCRIPT_HOSTS[extension];
  if (host === undefined) {
    return null;
  }
  const pathExt = options?.pathExt ?? process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  const declaredRunnable = pathExt
    .split(';')
    .some((value) => value.trim().toLowerCase() === extension);
  if (declaredRunnable) {
    return null;
  }
  const resolution = (options?.resolve ?? resolveExecutableHere)(shape.executable, cwd);
  if (resolution.kind !== 'found') {
    return null;
  }
  return { at: resolution.at, extension, workingForm: `${host} ${line.trim()}` };
}

/**
 * What to tell the person, with the command they can paste in its place.
 *
 * It names the file it found, so the refusal cannot be mistaken for "DSpatch
 * cannot see your script", and it says what the two silent outcomes are, so
 * "it worked for me in a terminal" has an answer.
 */
export function describeUnrunnableScript(script: UnrunnableScript): string {
  return (
    `DSpatch will not run ${script.at} directly. The shell does not start a ` +
    `${script.extension} file as a program: it hands it to Windows to open, which either ` +
    `returns exit 0 without running a line of your script — a green result for a build ` +
    `that never happened — or never returns at all, because the "How do you want to open ` +
    `this file?" window is waiting behind a hidden window. Neither tells you anything ` +
    `about your project. Put this in the Command field instead, which does run it and ` +
    `does pass its exit code back: ${script.workingForm}`
  );
}
