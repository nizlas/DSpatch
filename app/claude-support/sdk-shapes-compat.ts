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
declare const oursOptions: Ours.Options;
declare const oursQueryParams: Parameters<ClaudeQueryFunction>[0];

// SDK -> DSpatch.
fits<Ours.SDKMessage>(sdkMessage);
fits<Ours.SDKSessionInfo>(sdkSessionInfo);
fits<Ours.SpawnOptions>(sdkSpawnOptions);
fits<ClaudeQueryHandle>(sdkQuery);
fits<ClaudeSdkModule['getSessionInfo']>(sdkGetSessionInfo);

// DSpatch -> SDK.
fits<Sdk.SDKUserMessage>(oursUserMessage);
fits<Sdk.HookCallback>(oursHookCallback);
fits<Sdk.HookJSONOutput>(oursHookOutput);
fits<Sdk.SpawnedProcess>(oursSpawned);
fits<Sdk.Options>(oursOptions);
fits<Parameters<typeof Sdk.query>[0]>(oursQueryParams);
