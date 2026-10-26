/**
 * DSpatch's view of the Claude Agent SDK's types, as of SDK 0.3.306 (DSP-133).
 *
 * The SDK is no longer a dependency of the app: it is optional Claude support,
 * installed only by `npm run claude:install` into `app/claude-support/`. So the
 * adapter cannot import the SDK's own type declarations, and a plain `npm ci`
 * followed by `npm run typecheck` must still pass on a computer without it.
 *
 * These are the smallest structural types the adapter needs, written here rather
 * than copied from the SDK's `sdk.d.ts` (whose licence is Anthropic's own). Each
 * names what DSpatch uses; where the SDK's type is a large union or carries more
 * fields, DSpatch's view is deliberately narrower and the adapter reads the rest
 * through `asRecord` as unknown data.
 *
 * Drift is checked, not assumed: `npm run typecheck:claude` (after
 * `npm run claude:install`) compiles `claude-support/sdk-shapes-compat.ts`, which checks
 * that these shapes and the installed SDK's types are assignable in the direction
 * each one flows. Nothing here is evidence of runtime behaviour.
 */

import type { Readable, Writable } from 'node:stream';

/** A message from the SDK's stream. DSpatch reads every field as unknown data. */
export interface SDKMessage {
  readonly type: string;
}

/** The one user message DSpatch sends per turn (streaming input). */
export interface SDKUserMessage {
  readonly type: 'user';
  readonly message: { readonly role: 'user'; readonly content: string };
  readonly parent_tool_use_id: string | null;
}

/** What the SDK's `getSessionInfo` returns, as far as DSpatch reads it. */
export interface SDKSessionInfo {
  readonly sessionId: string;
  readonly summary: string;
  readonly lastModified: number;
  readonly cwd?: string;
}

/** A PreToolUse hook's answer: pass (`{}`) or deny, optionally ending the turn. */
export interface HookJSONOutput {
  readonly continue?: boolean;
  readonly stopReason?: string;
  readonly hookSpecificOutput?: {
    readonly hookEventName: 'PreToolUse';
    readonly permissionDecision?: 'allow' | 'deny' | 'ask';
    readonly permissionDecisionReason?: string;
  };
}

/** A hook callback. The input is read as unknown data. */
export type HookCallback = (
  input: unknown,
  toolUseID: string | undefined,
  options: { readonly signal: AbortSignal },
) => Promise<HookJSONOutput>;

/** What the SDK passes to `Options.spawnClaudeCodeProcess`. */
export interface SpawnOptions {
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
  readonly env: { readonly [name: string]: string | undefined };
  readonly signal: AbortSignal;
}

/** What `Options.spawnClaudeCodeProcess` must return. */
export interface SpawnedProcess {
  stdin: Writable;
  stdout: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  once(event: 'error', listener: (error: Error) => void): void;
  off(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  off(event: 'error', listener: (error: Error) => void): void;
}

/** The `query()` options DSpatch sets. Every other option is left to the SDK's default. */
export interface Options {
  cwd?: string;
  model?: string;
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: 'dontAsk';
  settingSources?: ('user' | 'project' | 'local')[];
  strictMcpConfig?: boolean;
  title?: string;
  includePartialMessages?: boolean;
  abortController?: AbortController;
  hooks?: { PreToolUse?: { matcher?: string; hooks: HookCallback[] }[] };
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
  env?: { [name: string]: string | undefined };
  resume?: string;
  sessionId?: string;
}
