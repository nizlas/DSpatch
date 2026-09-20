import fs from 'node:fs';
import path from 'node:path';

import type { PresentedTestStatus, TestVerdict } from '../shared/bridge';
import { describeUnrunnableScript, unrunnableScript } from './command-start';

/**
 * The build/test command: what to suggest, what to refuse, and whether a result
 * still describes the code.
 *
 * Separated from `chat-service.ts` because the two rules that can quietly be
 * wrong are here. The suggestion has to come from the project rather than from a
 * constant, or DSpatch offers every project the same command and reports a
 * failure that says nothing about it. And the staleness rule decides whether an
 * old green result is allowed to sit beside new code, which is the whole of
 * AC#8's second sentence.
 */

/** The file DSP-1's generated sample project runs. */
export const SAMPLE_TEST_REL_PATH = 'test/duration.test.ts';

export interface CommandSuggestion {
  /** `''` when DSpatch could not work one out. Never a guess presented as fact. */
  readonly command: string;
  readonly cwd: string;
  /** Where the suggestion came from, in the user's words rather than a code path. */
  readonly note: string;
}

function readScripts(dir: string): Readonly<Record<string, string>> | null {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const scripts = (parsed as Record<string, unknown>)['scripts'];
    if (typeof scripts !== 'object' || scripts === null) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof value === 'string') {
        out[name] = value;
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Quote a path for a shell command line. Windows paths routinely have spaces. */
function quote(value: string): string {
  return value.includes(' ') ? `"${value}"` : value;
}

/**
 * What to put in the command field when a project opens.
 *
 * A starting point, not a decision: the field is editable and the note says
 * where the text came from, so the user can see whether to trust it. The sample
 * project is checked first and runs its `node` directly, which keeps DSP-1's
 * recorded procedure working from a packaged artifact that may not have `npm`
 * on its PATH.
 */
export function suggestBuildCommand(
  workspacePath: string,
  nodeRunnerPath: string | null,
): CommandSuggestion {
  const scripts = readScripts(workspacePath);

  if (fs.existsSync(path.join(workspacePath, SAMPLE_TEST_REL_PATH))) {
    if (nodeRunnerPath !== null) {
      return {
        command: `${quote(nodeRunnerPath)} --test ${SAMPLE_TEST_REL_PATH}`,
        cwd: workspacePath,
        note:
          `This project has ${SAMPLE_TEST_REL_PATH}, so DSpatch suggests running it ` +
          'with the node executable it found. Edit either field; nothing is ' +
          'configured anywhere else.',
      };
    }
    return {
      command: `node --test ${SAMPLE_TEST_REL_PATH}`,
      cwd: workspacePath,
      note:
        `This project has ${SAMPLE_TEST_REL_PATH}. DSpatch found no node executable ` +
        'of its own, so the command relies on `node` being on PATH for the shell. ' +
        'Edit either field if that is wrong.',
    };
  }

  if (scripts !== null && typeof scripts['test'] === 'string') {
    return {
      command: 'npm test',
      cwd: workspacePath,
      note:
        'Taken from this project\'s package.json, whose test script is ' +
        `\`${scripts['test']}\`. Edit either field; nothing is configured anywhere ` +
        'else.',
    };
  }

  if (scripts !== null && typeof scripts['build'] === 'string') {
    return {
      command: 'npm run build',
      cwd: workspacePath,
      note:
        'This project\'s package.json has no test script, so DSpatch suggests its ' +
        `build script \`${scripts['build']}\` instead. Edit either field.`,
    };
  }

  return {
    command: '',
    cwd: workspacePath,
    // The empty field is the first thing a person with a C++ or CMake project reads,
    // and until DSP-45 the only true thing to say about it was *type something*. It
    // is no longer the only one: a step of the loop reads the project and proposes a
    // command, which lands in this field for approval before anything runs. Saying so
    // here turns the window's most discouraging first impression into the description
    // of a feature. The clause is conditional in the only way that matters — it says
    // the loop will propose one, not that this project has a check DSpatch found.
    note:
      'DSpatch could not work out how this project is built or tested, so it is ' +
      'not guessing. Type the command you would run in a terminal and it runs in ' +
      'the working directory beside it. The loop does not use this field: a ' +
      'checking agent discovers and runs the project\'s own checks.',
  };
}

export interface RunRequestCheck {
  readonly ok: boolean;
  /** `null` when the request is usable. */
  readonly message: string | null;
}

/** Refuse a request that cannot run, and say what to do about it. */
export function checkRunRequest(command: string, cwd: string): RunRequestCheck {
  if (command.trim() === '') {
    return {
      ok: false,
      message:
        'There is no command to run. Type the build or test command you would use ' +
        'in a terminal.',
    };
  }
  if (cwd.trim() === '') {
    return { ok: false, message: 'There is no working directory to run it in.' };
  }
  const resolved = path.resolve(cwd.trim());
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return {
      ok: false,
      message: `There is no folder at ${resolved} to run the command in.`,
    };
  }
  if (!stat.isDirectory()) {
    return { ok: false, message: `${resolved} is a file, not a folder.` };
  }
  // The one command DSpatch refuses on its content rather than on its absence,
  // and it is refused here so the Run button and the loop's gate refuse it
  // identically. DSP-26 #4 names a PowerShell build script, and a bare `.ps1` is
  // the one form where starting it as typed is measurably worse than declining:
  // the shell accepts it and either returns 0 having executed nothing or never
  // returns. `unrunnableScript` is deliberately narrow — see its own comment for
  // the five conditions — and it says nothing at all about whether the command is
  // the *right* one, which remains the user's judgement.
  const script = unrunnableScript(command, resolved);
  if (script !== null) {
    return { ok: false, message: describeUnrunnableScript(script) };
  }
  return { ok: true, message: null };
}

/** The shell that will interpret the command, named rather than implied. */
export function describeShell(): string {
  return process.platform === 'win32'
    ? `${process.env['ComSpec'] ?? 'cmd.exe'} /d /s /c`
    : '/bin/sh -c';
}

export interface FreshnessInput {
  /** Whether a command has been run at all in this session. */
  readonly hasResult: boolean;
  /** The snapshot hashed immediately before the command started. */
  readonly testedSnapshotId: string | null;
  /** The snapshot hashed immediately after it finished. */
  readonly afterRunSnapshotId: string | null;
  /** The snapshot now. `null` when the working copy could not be hashed. */
  readonly currentSnapshotId: string | null;
}

export interface FreshnessVerdict {
  readonly kind: 'no-result' | 'unknown' | 'current' | 'stale';
  /**
   * The command wrote into the working copy while running, so what it tested is
   * not what it left behind. `null` when it could not be determined.
   */
  readonly commandChangedWorkspace: boolean | null;
  readonly headline: string;
}

/**
 * Whether a recorded result still describes the code on disk.
 *
 * The comparison is between snapshot identities, which are hashes of content, so
 * a file edited and edited back reads as unchanged and a file touched without a
 * content change does not raise a false alarm.
 *
 * `stale` is measured against the snapshot taken **after** the command finished,
 * not the one before it. Some commands write into their own working copy, and
 * treating that as a later code change would mark every such result stale the
 * instant it appeared, which trains the reader to ignore the warning.
 * `commandChangedWorkspace` carries that case separately, and it is not a
 * smaller problem — it means the command's own output is no longer the state it
 * ran against.
 */
export function evaluateFreshness(input: FreshnessInput): FreshnessVerdict {
  const { testedSnapshotId, afterRunSnapshotId, currentSnapshotId } = input;
  if (!input.hasResult) {
    return {
      kind: 'no-result',
      commandChangedWorkspace: null,
      headline: 'Nothing has been run in this session yet.',
    };
  }
  const commandChangedWorkspace =
    afterRunSnapshotId === null || testedSnapshotId === null
      ? null
      : afterRunSnapshotId !== testedSnapshotId;

  if (
    currentSnapshotId === null ||
    afterRunSnapshotId === null ||
    testedSnapshotId === null
  ) {
    return {
      kind: 'unknown',
      commandChangedWorkspace,
      headline:
        'DSpatch could not hash the working copy at one of the points it needed ' +
        'to, so whether this result still describes the code on disk is unknown. ' +
        'Unknown is not the same as unchanged.',
    };
  }
  if (currentSnapshotId !== afterRunSnapshotId) {
    return {
      kind: 'stale',
      commandChangedWorkspace,
      headline:
        'The working copy has changed since this ran. The result below describes ' +
        `${testedSnapshotId}, and the code on disk is now ${currentSnapshotId}. It ` +
        'does not say anything about the current code — run it again.',
    };
  }
  return {
    kind: 'current',
    commandChangedWorkspace,
    headline: `The working copy is still ${currentSnapshotId}, the state this ran against.`,
  };
}

/** What DSpatch observed about how a command ended. */
export interface TestVerdictInput {
  /** DSpatch killed it. Decisive on Windows, where a kill yields an exit code. */
  readonly killedByDspatch: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface TestVerdictResult {
  readonly verdict: TestVerdict;
  readonly headline: string;
}

/**
 * Whether a finished command says anything about the code.
 *
 * **The single place a pass can come from.** AC#6 requires that an interrupted or
 * incomplete run cannot appear passed, and the way to make that structural rather
 * than a habit is to leave exactly one function with a `'passed'` in it and have
 * nothing else — least of all the window — derive one from an exit code.
 *
 * The order of the checks is the whole content. `killedByDspatch` comes first
 * because on Windows it is the *only* reliable evidence: `taskkill /T /F` ends the
 * tree with an ordinary exit code and no signal, so a run DSpatch stopped is
 * indistinguishable from one that exited by itself unless DSpatch's own record of
 * having killed it wins. A test runner that had already printed its summary and
 * was killed a moment later can hand back 0, and 0 must not become a pass.
 */
export function evaluateTestVerdict(input: TestVerdictInput): TestVerdictResult {
  if (input.killedByDspatch) {
    return {
      verdict: 'interrupted',
      headline:
        'You stopped this command, so it has no result. Whatever it printed is ' +
        'what had arrived by then, and whatever it wrote to disk is still there.',
    };
  }
  if (input.signal !== null) {
    return {
      verdict: 'interrupted',
      headline:
        `The command was ended by signal ${input.signal} rather than exiting, so ` +
        'it produced no result.',
    };
  }
  if (input.exitCode === null) {
    return {
      verdict: 'unknown',
      headline:
        'The command reported no exit code, so whether it passed is unknown. ' +
        'Unknown is not a pass and not a failure.',
    };
  }
  if (input.exitCode === 0) {
    return {
      verdict: 'passed',
      headline: 'The command ran to the end and exited 0.',
    };
  }
  return {
    verdict: 'failed',
    headline: `The command ran to the end and exited ${String(input.exitCode)}.`,
  };
}

export interface PresentedTestResult {
  readonly status: PresentedTestStatus;
  readonly headline: string;
}

/**
 * The verdict as it applies to the code on disk now.
 *
 * Two independent questions, combined here so the window cannot get the
 * combination wrong: did the command produce a result at all, and is that result
 * still about the current code? A pass whose working copy has moved on becomes
 * `passed-for-older-code`, which is a different word rather than a green tick
 * with a footnote.
 */
export function presentTestStatus(
  verdict: TestVerdict | null,
  freshness: FreshnessVerdict['kind'],
): PresentedTestResult {
  if (verdict === null || freshness === 'no-result') {
    return {
      status: 'no-result',
      headline: 'Nothing has been run in this session yet.',
    };
  }
  if (verdict !== 'passed') {
    const headline =
      verdict === 'interrupted'
        ? 'Interrupted: there is no result to apply to any version of the code.'
        : verdict === 'unknown'
          ? 'Unknown outcome: this cannot be read as a pass or a failure.'
          : 'Failed against the code it ran on.';
    return { status: verdict, headline };
  }
  if (freshness === 'current') {
    return {
      status: 'passed',
      headline: 'Passed, against the code that is on disk now.',
    };
  }
  if (freshness === 'stale') {
    return {
      status: 'passed-for-older-code',
      headline:
        'Passed, but against code that has since changed. It says nothing about ' +
        'what is on disk now — run it again.',
    };
  }
  return {
    status: 'unknown',
    headline:
      'It passed, but DSpatch could not establish whether the code has changed ' +
      'since, so whether that pass still applies is unknown.',
  };
}
