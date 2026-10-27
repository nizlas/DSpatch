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

import type { ClaudeModelInfo, ClaudeQueryFunction, ClaudeQueryHandle } from '../src/adapter/claude-agent-sdk-adapter';
import type * as Ours from '../src/adapter/claude-sdk-shapes';
import type { ClaudeSdkModule, ClaudeToolKit } from '../src/adapter/claude-support';

function fits<T>(value: T): T {
  return value;
}

declare const sdkMessage: Sdk.SDKMessage;
declare const sdkModelInfo: Sdk.ModelInfo;
declare const sdkSessionInfo: Sdk.SDKSessionInfo;
declare const sdkSpawnOptions: Sdk.SpawnOptions;
declare const sdkQuery: Sdk.Query;
declare const sdkGetSessionInfo: typeof Sdk.getSessionInfo;
declare const oursUserMessage: Ours.SDKUserMessage;
declare const oursHookCallback: Ours.HookCallback;
declare const oursHookOutput: Ours.HookJSONOutput;
declare const oursSpawned: Ours.SpawnedProcess;
declare const oursOptions: Omit<Ours.Options, 'mcpServers'>;
declare const sdkServer: ReturnType<typeof Sdk.createSdkMcpServer>;
declare const oursQueryParams: Parameters<ClaudeQueryFunction>[0];

// SDK -> DSpatch.
fits<Ours.SDKMessage>(sdkMessage);
fits<Ours.SDKSessionInfo>(sdkSessionInfo);
fits<Ours.SpawnOptions>(sdkSpawnOptions);
fits<ClaudeQueryHandle>(sdkQuery);
fits<ClaudeSdkModule['getSessionInfo']>(sdkGetSessionInfo);
// DSP-149: the model list DSpatch reads from `Query.supportedModels()`.
fits<ClaudeModelInfo>(sdkModelInfo);

// DSpatch -> SDK.
fits<Sdk.SDKUserMessage>(oursUserMessage);
fits<Sdk.HookCallback>(oursHookCallback);
fits<Sdk.HookJSONOutput>(oursHookOutput);
fits<Sdk.SpawnedProcess>(oursSpawned);
fits<Sdk.Options>(oursOptions);
fits<Parameters<typeof Sdk.query>[0]>({ ...oursQueryParams, options: { ...oursQueryParams.options, mcpServers: undefined } });

// DSP-149: the in-process tool server. DSpatch passes what the SDK's own
// `createSdkMcpServer` returned, unchanged, as an `mcpServers` value; it calls the
// SDK's `createSdkMcpServer` and `tool` with the arguments its tool kit declares.
fits<NonNullable<Sdk.Options['mcpServers']>[string]>(sdkServer);
declare const kitServerOptions: Parameters<ClaudeToolKit['createSdkMcpServer']>[0];
declare const kitToolArgs: Parameters<ClaudeToolKit['tool']>;
fits<Parameters<typeof Sdk.createSdkMcpServer>[0]['name']>(kitServerOptions.name);
fits<Parameters<typeof Sdk.createSdkMcpServer>[0]['version']>(kitServerOptions.version);
fits<Parameters<typeof Sdk.tool>[0]>(kitToolArgs[0]);
fits<Parameters<typeof Sdk.tool>[1]>(kitToolArgs[1]);
fits<NonNullable<Parameters<typeof Sdk.tool>[4]>['annotations']>(kitToolArgs[4].annotations);
// What a handler returns is MCP text content with an error flag.
fits<Awaited<ReturnType<Parameters<typeof Sdk.tool>[3]>>>({ content: [{ type: 'text', text: '' }], isError: false });

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
