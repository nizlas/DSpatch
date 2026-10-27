/**
 * Does DSpatch's view of the Claude Agent SDK still match the installed SDK?
 * (DSP-133.) Type-checked only, by `npm run typecheck:claude` after
 * `npm run claude:install`; never built, never run, and not part of the app.
 *
 * Each line checks one direction: what the SDK hands DSpatch must fit DSpatch's
 * shape, and what DSpatch hands the SDK must fit the SDK's type. A failure here
 * means `src/adapter/claude-sdk-shapes.ts` has drifted from the pinned SDK.
 */

import type * as Sdk from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };

import type { ClaudeQueryFunction, ClaudeQueryHandle } from '../src/adapter/claude-agent-sdk-adapter';
import type * as Ours from '../src/adapter/claude-sdk-shapes';
import type { ClaudeSdkModule } from '../src/adapter/claude-support';

function fits<T>(value: T): T {
  return value;
}

declare const sdkMessage: Sdk.SDKMessage;
declare const sdkSessionInfo: Sdk.SDKSessionInfo;
declare const sdkSpawnOptions: Sdk.SpawnOptions;
declare const sdkQuery: Sdk.Query;
declare const sdkGetSessionInfo: typeof Sdk.getSessionInfo;
declare const oursUserMessage: Ours.SDKUserMessage;
declare const oursHookCallback: Ours.HookCallback;
declare const oursHookOutput: Ours.HookJSONOutput;
declare const oursSpawned: Ours.SpawnedProcess;
// DSP-145: `mcpServers` is left out of the DSpatch -> SDK direction on purpose. Its only
// value is the object the SDK's own `createSdkMcpServer` returned, handed back unchanged,
// so the direction that matters is SDK -> DSpatch (`sdkServer` below).
declare const oursOptions: Omit<Ours.Options, 'mcpServers'>;
declare const oursQueryParams: Omit<Parameters<ClaudeQueryFunction>[0], 'options'> & {
  readonly options: Omit<Ours.Options, 'mcpServers'>;
};
declare const sdkServer: Sdk.McpSdkServerConfigWithInstance;

// SDK -> DSpatch.
fits<Ours.SDKMessage>(sdkMessage);
fits<Ours.SDKSessionInfo>(sdkSessionInfo);
fits<Ours.SpawnOptions>(sdkSpawnOptions);
fits<ClaudeQueryHandle>(sdkQuery);
fits<ClaudeSdkModule['getSessionInfo']>(sdkGetSessionInfo);
fits<Ours.McpSdkServerConfigWithInstance>(sdkServer);

// DSpatch -> SDK.
fits<Sdk.SDKUserMessage>(oursUserMessage);
fits<Sdk.HookCallback>(oursHookCallback);
fits<Sdk.HookJSONOutput>(oursHookOutput);
fits<Sdk.SpawnedProcess>(oursSpawned);
fits<Sdk.Options>(oursOptions);
fits<Parameters<typeof Sdk.query>[0]>(oursQueryParams);

// Key checks (R-0 A1). The `fits` lines above assign declared values, which TypeScript
// does not check for excess properties, so a key the SDK dropped or renamed would still
// pass them. These fail when DSpatch's view names a key the SDK's type does not have.
type MustBeNever<T extends never> = T;
export type OptionsKeysTheSdkLacks = MustBeNever<Exclude<keyof Ours.Options, keyof Sdk.Options>>;
export type HookOutputKeysTheSdkLacks = MustBeNever<Exclude<keyof Ours.HookJSONOutput, keyof Sdk.SyncHookJSONOutput>>;
export type PreToolUseKeysTheSdkLacks = MustBeNever<
  Exclude<keyof NonNullable<Ours.HookJSONOutput['hookSpecificOutput']>, keyof Sdk.PreToolUseHookSpecificOutput>
>;
export type SpawnOptionsKeysTheSdkLacks = MustBeNever<Exclude<keyof Ours.SpawnOptions, keyof Sdk.SpawnOptions>>;
