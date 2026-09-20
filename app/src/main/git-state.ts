import { execFileSync } from 'node:child_process';

/**
 * What git says about a working copy at the moment a session opens.
 *
 * This exists for one criterion. AC#6 requires that an existing manual change
 * survives a run **and stays distinguishable from the run's changes**, and that
 * is only possible if the pre-existing state is recorded before the agent is
 * allowed anywhere near the directory. A file that was already modified when the
 * session opened must never be presented later as something the agent did.
 *
 * git is asked rather than guessed at, and a directory that is not a git
 * repository is reported as such rather than treated as clean: the content
 * baseline still applies, but "nothing was dirty" would be a claim we cannot
 * make. Every failure here is recorded and shown; none of them is silently
 * turned into an empty list.
 */

/** How a path differs from `HEAD`, in DSpatch's own words. */
export type DirtyKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unmerged'
  | 'type-changed'
  | 'other';

export interface DirtyFile {
  readonly relPath: string;
  /** git's own two-character code, unchanged, so nothing is lost in translation. */
  readonly statusCode: string;
  readonly kind: DirtyKind;
  /** Only for a rename or copy. */
  readonly previousRelPath: string | null;
  readonly staged: boolean;
}

export interface GitWorkingCopyState {
  readonly checked: boolean;
  readonly isGitRepository: boolean;
  readonly topLevel: string | null;
  /** `null` for a repository without a commit yet, which is not an error. */
  readonly headRevision: string | null;
  readonly branch: string | null;
  readonly dirtyFiles: readonly DirtyFile[];
  /** Non-null means the reading is incomplete and says why. */
  readonly error: string | null;
  readonly gitVersion: string | null;
  readonly observedAtUtc: string;
}

function statusKind(code: string): DirtyKind {
  if (code === '??') return 'untracked';
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'unmerged';
  const letters = code.replace(/ /g, '');
  if (letters.includes('R')) return 'renamed';
  if (letters.includes('C')) return 'copied';
  if (letters.includes('D')) return 'deleted';
  if (letters.includes('A')) return 'added';
  if (letters.includes('T')) return 'type-changed';
  if (letters.includes('M')) return 'modified';
  return 'other';
}

/**
 * Parse `git status --porcelain=v1 -z --untracked-files=all`.
 *
 * `-z` rather than the line-based form on purpose: without it git quotes and
 * escapes paths containing spaces, quotes or non-ASCII characters, and a
 * mis-unquoted path would become a file attributed to the wrong place. With `-z`
 * the paths arrive as raw bytes between NUL separators.
 *
 * A rename or copy entry carries **two** NUL-terminated paths: the new path in
 * the entry itself and the original immediately after it.
 */
export function parsePorcelainZ(output: string): readonly DirtyFile[] {
  const parts = output.split('\0');
  const files: DirtyFile[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (entry === undefined || entry.length < 4) {
      continue;
    }
    const statusCode = entry.slice(0, 2);
    const relPath = entry.slice(3);
    const kind = statusKind(statusCode);
    let previousRelPath: string | null = null;
    if (kind === 'renamed' || kind === 'copied') {
      previousRelPath = parts[index + 1] ?? null;
      index += 1;
    }
    files.push({
      relPath,
      statusCode,
      kind,
      previousRelPath,
      // The first column is the index, the second the working tree. `??` is
      // untracked and is staged in neither.
      staged: statusCode !== '??' && statusCode[0] !== ' ' && statusCode[0] !== '?',
    });
  }
  return files;
}

interface GitCall {
  readonly ok: boolean;
  readonly stdout: string;
  readonly error: string | null;
}

function git(cwd: string, args: readonly string[], timeoutMs: number): GitCall {
  try {
    const stdout = execFileSync('git', [...args], {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      // `execFileSync` lets the child's stderr through to this process by
      // default, so opening a folder that is not a repository printed git's
      // `fatal: not a git repository` into DSpatch's own output while the same
      // text was already being captured and shown in the window. Piping it keeps
      // the message where it is used and out of where it is not.
      stdio: ['ignore', 'pipe', 'pipe'],
      // Buffer, then decode as UTF-8 ourselves: `-z` output is bytes, and
      // `core.quotepath` is turned off below so non-ASCII paths stay intact.
      encoding: 'buffer',
    });
    return { ok: true, stdout: stdout.toString('utf8'), error: null };
  } catch (error) {
    const err = error as { stderr?: Buffer | string; message?: string };
    const stderr =
      err.stderr === undefined
        ? ''
        : typeof err.stderr === 'string'
          ? err.stderr
          : err.stderr.toString('utf8');
    const detail = stderr.trim() === '' ? (err.message ?? 'unknown failure') : stderr.trim();
    return { ok: false, stdout: '', error: detail };
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Read the working copy's git state.
 *
 * Synchronous. This runs once per session start, before the agent exists, and a
 * partially recorded baseline would be worse than a brief pause.
 */
export function readGitWorkingCopyState(
  root: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): GitWorkingCopyState {
  const observedAtUtc = new Date().toISOString();
  const notChecked = (error: string | null, isGitRepository: boolean): GitWorkingCopyState => ({
    checked: true,
    isGitRepository,
    topLevel: null,
    headRevision: null,
    branch: null,
    dirtyFiles: [],
    error,
    gitVersion: null,
    observedAtUtc,
  });

  const version = git(root, ['--version'], timeoutMs);
  if (!version.ok) {
    return notChecked(
      `git could not be run in this directory, so no pre-existing changes were ` +
        `recorded: ${version.error ?? 'unknown failure'}`,
      false,
    );
  }

  const inside = git(root, ['rev-parse', '--is-inside-work-tree'], timeoutMs);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return {
      ...notChecked(null, false),
      gitVersion: version.stdout.trim(),
    };
  }

  const topLevel = git(root, ['rev-parse', '--show-toplevel'], timeoutMs);
  const head = git(root, ['rev-parse', 'HEAD'], timeoutMs);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], timeoutMs);
  const status = git(
    root,
    [
      '-c',
      'core.quotepath=false',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ],
    timeoutMs,
  );

  return {
    checked: true,
    isGitRepository: true,
    topLevel: topLevel.ok ? topLevel.stdout.trim() : null,
    // A repository without any commit fails `rev-parse HEAD`. That is a state,
    // not a fault, and it is reported as an unknown revision.
    headRevision: head.ok ? head.stdout.trim() : null,
    branch: branch.ok ? branch.stdout.trim() : null,
    dirtyFiles: status.ok ? parsePorcelainZ(status.stdout) : [],
    error: status.ok
      ? null
      : `git status failed, so the list of files that were already modified is ` +
        `unknown rather than empty: ${status.error ?? 'unknown failure'}`,
    gitVersion: version.stdout.trim(),
    observedAtUtc,
  };
}
