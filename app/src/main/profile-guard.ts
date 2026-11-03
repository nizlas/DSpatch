import path from 'node:path';

/*
 * A start that is meant to run on an isolated profile says which (DSP-165.1). On 3 November 2026 a
 * verification start passed its profile through `npm run dev --`; npm ran it through cmd, which
 * mangled the folder name, Electron fell back to the person's own profile, and a host started over
 * their real data. A start that names its profile here is checked against the profile Electron
 * actually chose before anything of DSpatch's starts, connects or writes, and stops if they differ.
 */

/** The isolated profile a start expects Electron to use. Unset for an ordinary start. */
export const EXPECT_USERDATA_ENV = 'DSPATCH_EXPECT_USERDATA';

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Why this start must not go on, or `null`. Nothing is checked when no profile is expected. A
 * start that expects one must also have named it to Electron: without `--user-data-dir` Electron
 * uses the person's own profile, whatever this process was told.
 */
export function profileRefusal(
  expected: string | undefined,
  actual: string,
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (expected === undefined || expected.trim() === '') {
    return null;
  }
  if (!argv.some((arg) => arg.startsWith('--user-data-dir='))) {
    return `this start expects the profile ${expected} but was not given --user-data-dir, so Electron would use the default profile`;
  }
  if (!samePath(actual, expected, platform)) {
    return `this start expects the profile ${expected} but Electron chose ${actual}`;
  }
  return null;
}
