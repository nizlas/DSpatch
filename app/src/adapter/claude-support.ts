import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { SDKSessionInfo } from './claude-sdk-shapes';
import type { AdapterError } from './types';

/**
 * Optional Claude support (DSP-133).
 *
 * The Claude Agent SDK, and through its platform package the Claude Code binary,
 * is not a dependency of the app: a plain `npm ci` in `app/` never downloads it.
 * It is installed only when someone runs `npm run claude:install` in `app/`, which
 * installs `app/claude-support/` (its own pinned `package.json` and lockfile) into
 * `app/claude-support/node_modules`. Removing support is deleting that folder.
 *
 * This module finds that folder, says whether it holds a usable SDK, and loads the
 * SDK from there on demand. It reads only `package.json` files to decide, installs
 * nothing and never runs npm. Electron-free.
 */

/** The SDK's package name. The version is pinned in `claude-support/package.json`. */
export const CLAUDE_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

/** The visible line when Claude support is missing. */
export const CLAUDE_NOT_INSTALLED_TEXT =
  'Claude support is not installed. To install it, run `npm run claude:install` in ' +
  '`app/`, then restart DSpatch.';

/**
 * A failure inside the Claude adapter or while loading its SDK. Defined here so
 * that the loader and the adapter share it without importing each other; the
 * adapter re-exports it.
 */
export class ClaudeAdapterError extends Error implements AdapterError {
  readonly providerCode?: string;

  constructor(message: string, providerCode?: string, cause?: unknown) {
    super(message);
    this.name = 'ClaudeAdapterError';
    if (providerCode !== undefined) {
      this.providerCode = providerCode;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * `app/claude-support`. The compiled module lives in `app/dist/adapter` and the
 * source in `app/src/adapter`, so the folder is two levels up from either. Under
 * the test loader there is no `__dirname` (the source runs as an ES module); the
 * tests run from `app/`, so the working directory stands in. In a packaged build
 * the module is inside the archive and the folder does not exist: no Claude.
 */
export function claudeSupportDir(): string {
  return typeof __dirname === 'string'
    ? path.resolve(__dirname, '..', '..', 'claude-support')
    : path.resolve(process.cwd(), 'claude-support');
}

/** The host facts the binary package depends on. Injectable for tests. */
export interface ClaudeSupportPlatform {
  readonly platform: string;
  readonly arch: string;
  /** Linux only: which C library this host runs. `null` elsewhere. */
  readonly libc: 'glibc' | 'musl' | null;
}

/** This process's platform, with libc detected as the SDK does (no glibc runtime: musl). */
export function hostPlatform(): ClaudeSupportPlatform {
  let libc: ClaudeSupportPlatform['libc'] = null;
  if (process.platform === 'linux') {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    libc = report?.header?.glibcVersionRuntime === undefined ? 'musl' : 'glibc';
  }
  return { platform: process.platform, arch: process.arch, libc };
}

/**
 * The binary packages the SDK would look for on this platform, in its order of
 * preference (SDK 0.3.306: on Linux the matching libc first, then the other).
 */
export function binaryPackageCandidates(host: ClaudeSupportPlatform): readonly string[] {
  const base = `${CLAUDE_SDK_PACKAGE}-${host.platform}-${host.arch}`;
  if (host.platform === 'linux') {
    return host.libc === 'musl' ? [`${base}-musl`, base] : [base, `${base}-musl`];
  }
  return [base];
}

export interface ClaudeSupportStatus {
  /** True when the SDK and a binary package for this platform are both present. */
  readonly installed: boolean;
  /** Where support is looked for. */
  readonly directory: string;
  /** The installed SDK's version, or `null` when the SDK is not there. */
  readonly sdkVersion: string | null;
  /** The binary package found, or the one expected first when none is. */
  readonly binaryPackage: string;
  /** Why it is not installed, in plain words; `null` when it is. */
  readonly reason: string | null;
}

/** A package's version from its `package.json`, `''` without one, `null` when absent. */
function packageVersion(directory: string, name: string): string | null {
  const file = path.join(directory, 'node_modules', ...name.split('/'), 'package.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '';
  } catch {
    return null;
  }
}

/**
 * Whether Claude support is installed in `directory` for `host`. Reads only
 * `package.json` files; loads nothing and starts nothing.
 */
export function claudeSupportStatus(
  directory: string = claudeSupportDir(),
  host: ClaudeSupportPlatform = hostPlatform(),
): ClaudeSupportStatus {
  const candidates = binaryPackageCandidates(host);
  const expected = candidates[0] ?? `${CLAUDE_SDK_PACKAGE}-${host.platform}-${host.arch}`;
  const sdkVersion = packageVersion(directory, CLAUDE_SDK_PACKAGE);
  if (sdkVersion === null) {
    return {
      installed: false,
      directory,
      sdkVersion: null,
      binaryPackage: expected,
      reason: `${CLAUDE_NOT_INSTALLED_TEXT} (No ${CLAUDE_SDK_PACKAGE} under ${directory}.)`,
    };
  }
  const found = candidates.find((name) => packageVersion(directory, name) !== null);
  if (found === undefined) {
    return {
      installed: false,
      directory,
      sdkVersion,
      binaryPackage: expected,
      reason:
        `${CLAUDE_NOT_INSTALLED_TEXT} (The SDK ${sdkVersion} is under ${directory}, but ` +
        `not its Claude Code binary for this platform, ${expected}.)`,
    };
  }
  return { installed: true, directory, sdkVersion, binaryPackage: found, reason: null };
}

/** The parts of the SDK module DSpatch calls. */
export interface ClaudeSdkModule {
  readonly query: unknown;
  readonly getSessionInfo: (
    sessionId: string,
    options?: { dir?: string },
  ) => Promise<SDKSessionInfo | undefined>;
}

/** The SDK's entry file, from its `package.json` (`exports["."]`, then `main`). */
function sdkEntry(directory: string): string {
  const root = path.join(directory, 'node_modules', ...CLAUDE_SDK_PACKAGE.split('/'));
  let entry = 'sdk.mjs';
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
      main?: unknown;
    };
    const dot = parsed.exports?.['.'];
    const conditions = (typeof dot === 'object' && dot !== null ? dot : {}) as {
      import?: unknown;
      default?: unknown;
    };
    const named = [dot, conditions.import, conditions.default, parsed.main].find(
      (candidate): candidate is string => typeof candidate === 'string',
    );
    if (named !== undefined) {
      entry = named;
    }
  } catch {
    // The status check has just read this file; keep the known entry.
  }
  return path.resolve(root, entry);
}

/**
 * Load the SDK from Claude support. Refuses, importing nothing, when support is
 * not installed (`claude_support_missing`). Called only when a Claude turn or a
 * local session lookup needs the SDK, never at startup.
 */
export async function loadClaudeSdk(
  directory: string = claudeSupportDir(),
  host: ClaudeSupportPlatform = hostPlatform(),
): Promise<ClaudeSdkModule> {
  const status = claudeSupportStatus(directory, host);
  if (!status.installed) {
    throw new ClaudeAdapterError(
      status.reason ?? CLAUDE_NOT_INSTALLED_TEXT,
      'claude_support_missing',
    );
  }
  return (await import(pathToFileURL(sdkEntry(directory)).href)) as ClaudeSdkModule;
}

/** What decides whether Claude can be chosen in a launch: both parts, each stated. */
export interface ClaudeAvailabilityInput {
  /** Whether the launch carries `DSPATCH_CLAUDE_AUTHORIZATION`. */
  readonly authorized: boolean;
  /** Whether Claude support is installed (read once at launch). */
  readonly installed: boolean;
}

/**
 * Why Claude cannot be chosen, naming each missing part, or `null` when it can.
 * Shared by the chat service and the main process's adapter factory, so the
 * refusal reads the same wherever it is raised.
 */
export function claudeUnavailableReason(input: ClaudeAvailabilityInput): string | null {
  if (input.installed && input.authorized) {
    return null;
  }
  if (!input.installed && !input.authorized) {
    return (
      'Claude support is not installed, and Claude is not enabled for this launch. To ' +
      'use Claude, run `npm run claude:install` in `app/`, then start DSpatch with ' +
      'DSPATCH_CLAUDE_AUTHORIZATION set.'
    );
  }
  if (!input.installed) {
    return CLAUDE_NOT_INSTALLED_TEXT;
  }
  return (
    'Claude is not enabled for this launch. Start DSpatch with ' +
    'DSPATCH_CLAUDE_AUTHORIZATION set to enable it.'
  );
}
