/**
 * A substituted Claude SDK and the shared adapter factory with both constructions
 * observed, for tests that walk a loop run with Claude (DSP-138, DSP-139).
 *
 * The Claude adapter built here is the real `ClaudeAgentSdkAdapter` with `queryFn` and
 * `spawnProcess` substituted, so nothing loads `@anthropic-ai/claude-agent-sdk`, nothing
 * is spawned and nothing is sent anywhere. Cursor's construction is counted and throws
 * unless a test allows it, so a Claude run that reached it would fail.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { AgentCommandRunner } from '../../src/adapter/agent-adapter.ts';
import { ClaudeAgentSdkAdapter, type ClaudePermissionPolicy } from '../../src/adapter/claude-agent-sdk-adapter.ts';
import type { ToolPolicy } from '../../src/adapter/cursor-sdk-adapter.ts';
import type { ChatAdapter } from '../../src/main/chat-service.ts';
import { providerAdapters, type ProviderAdaptersOptions } from '../../src/main/provider-adapters.ts';

/** No credential variables at all. */
export const CLEAN_ENV = Object.freeze({ PATH: process.env['PATH'] ?? '' });

// --- A substituted Claude SDK -------------------------------------------------------

/** What one query does: answer with text, fail mid-turn, or wait to be interrupted. */
export type Turn =
  | {
      readonly kind: 'answer';
      readonly text: string;
      /** Runs before the answer is streamed: a test's stand-in for a tool the agent used. */
      readonly act?: (query: Query) => void;
    }
  | { readonly kind: 'fail'; readonly message: string }
  | { readonly kind: 'until-interrupted' }
  /**
   * DSP-145: a scripted model that calls tools, in order, then answers with `text`. A
   * tool call goes through what the SDK would do with the options it was given: every
   * PreToolUse hook first, then the pre-approval in `allowedTools`, then the in-process
   * MCP server's handler (from {@link fakeMcpTools}). `act` steps stand in for the
   * agent's built-in Read and Edit. Not the SDK: its real behaviour is unobserved here.
   */
  | { readonly kind: 'script'; readonly steps: readonly ScriptStep[]; readonly text: string };

/** One step of a scripted model's turn. */
export type ScriptStep =
  | {
      readonly tool: string;
      readonly input: Record<string, unknown>;
      /** Send no tool_result message for this call (what a cancelled turn may do, B2). */
      readonly noToolResult?: boolean;
      /** Start the call without waiting for it, so a second call can overlap it. */
      readonly concurrentWithNext?: boolean;
    }
  | { readonly act: (query: Query) => void | Promise<void> }
  /** Wait for `interrupt()`, then end the turn as interrupted. */
  | { readonly untilInterrupted: true };

/** What a scripted tool call came back with. */
export interface ToolOutcome {
  readonly tool: string;
  readonly toolUseId: string;
  /** `denied` by a hook or by the permission rules; `missing` when no server had the tool. */
  readonly how: 'ran' | 'denied' | 'missing';
  readonly isError: boolean;
  readonly text: string;
}

export interface Query {
  readonly options: Record<string, any>;
  prompt: string;
  interrupts: number;
  /** DSP-145: every scripted tool call and what came back, in order. */
  readonly toolOutcomes: ToolOutcome[];
}

// --- A substituted in-process MCP (DSP-145) ------------------------------------------

/** One tool as the substituted `tool()` built it. */
export interface FakeTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly handler: (args: Record<string, unknown>, extra: unknown) => Promise<any>;
  readonly extras: unknown;
}

/** One server as the substituted `createSdkMcpServer()` built it. */
export interface FakeServer {
  readonly type: 'sdk';
  readonly name: string;
  readonly options: Record<string, any>;
  readonly instance: { readonly tools: readonly FakeTool[] };
}

/**
 * Substitutes for the SDK's `tool()` and `createSdkMcpServer()` and for Zod: the
 * adapter's `mcpTools` seam. Every server built is kept, so a test can read its tool's
 * description, options and handler.
 */
export function fakeMcpTools() {
  const servers: FakeServer[] = [];
  const tools = {
    tool: (
      name: string,
      description: string,
      inputSchema: Record<string, unknown>,
      handler: FakeTool['handler'],
      extras?: unknown,
    ): FakeTool => ({ name, description, inputSchema, handler, extras }),
    createSdkMcpServer: (options: Record<string, any>): FakeServer => {
      const server: FakeServer = {
        type: 'sdk',
        name: String(options['name']),
        options,
        instance: { tools: (options['tools'] ?? []) as FakeTool[] },
      };
      servers.push(server);
      return server;
    },
    commandInputSchema: () => ({ command: 'a substituted Zod string' }),
  };
  return { tools: tools as any, servers };
}

/** Text of an MCP tool result. */
function resultText(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
    .join('\n');
}

/**
 * One scripted tool call, as the SDK is documented to handle it: hooks first (a deny
 * there is final), then the pre-approval rules under `dontAsk`, then the tool itself.
 */
async function callTool(
  options: Record<string, any>,
  tool: string,
  input: Record<string, unknown>,
  toolUseId: string,
): Promise<ToolOutcome> {
  const entries: any[] = options['hooks']?.PreToolUse ?? [];
  for (const entry of entries) {
    for (const hook of entry.hooks ?? []) {
      const answer = await hook(
        { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: toolUseId },
        toolUseId,
        { signal: new AbortController().signal },
      );
      if (answer?.hookSpecificOutput?.permissionDecision === 'deny') {
        return {
          tool,
          toolUseId,
          how: 'denied',
          isError: true,
          text: String(answer.hookSpecificOutput.permissionDecisionReason ?? 'denied by a hook'),
        };
      }
    }
  }
  const allowed: string[] = options['allowedTools'] ?? [];
  const disallowed: string[] = options['disallowedTools'] ?? [];
  if (
    disallowed.some((rule) => rule === tool || (rule.endsWith('*') && tool.startsWith(rule.slice(0, -1)))) ||
    !allowed.includes(tool)
  ) {
    return { tool, toolUseId, how: 'denied', isError: true, text: `${tool} is not allowed (dontAsk).` };
  }
  const match = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool);
  const server: FakeServer | undefined = match === null ? undefined : options['mcpServers']?.[match[1] ?? ''];
  const found = server?.instance.tools.find((candidate) => candidate.name === match?.[2]);
  if (found === undefined) {
    return { tool, toolUseId, how: 'missing', isError: true, text: `No such tool available: ${tool}` };
  }
  const result = await found.handler(input, {});
  return { tool, toolUseId, how: 'ran', isError: result?.isError === true, text: resultText(result) };
}

function fakeChild(): any {
  const child = new EventEmitter() as any;
  child.pid = 4545;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.exit = (code: number | null, signal: string | null = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
  };
  child.kill = (signal: string) => {
    child.killed = true;
    setImmediate(() => child.exit(null, signal));
    return true;
  };
  return child;
}

/**
 * A substitute `query()` in the SDK 0.3.306 message shapes `claude-agent-sdk-adapter.test.ts`
 * uses: init, the turn, result. `turns[i]` scripts the i-th query; `onQuery` sees each.
 */
export function claudeSdk(turns: readonly Turn[], onQuery?: (index: number) => void) {
  const queries: Query[] = [];
  const queryFn = (params: { prompt: AsyncIterable<unknown>; options: Record<string, any> }) => {
    const query: Query = { options: params.options, prompt: '', interrupts: 0, toolOutcomes: [] };
    queries.push(query);
    const index = queries.length - 1;
    const turn = turns[index] ?? { kind: 'fail', message: `no turn scripted for query ${String(index)}` };
    let interrupted: () => void = () => undefined;
    const wasInterrupted = new Promise<void>((resolve) => {
      interrupted = resolve;
    });
    const child =
      typeof params.options['spawnClaudeCodeProcess'] === 'function'
        ? params.options['spawnClaudeCodeProcess']({
            command: 'C:/synthetic/claude-test.exe',
            args: [],
            cwd: params.options['cwd'],
            env: { ...params.options['env'] },
            signal: new AbortController().signal,
          })
        : null;
    const session = params.options['sessionId'] ?? params.options['resume'];
    const result = (subtype: string, text: string) => ({
      type: 'result',
      subtype,
      is_error: subtype !== 'success',
      duration_ms: 10,
      duration_api_ms: 8,
      num_turns: 1,
      result: text,
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: `u-result-${String(index)}`,
      session_id: session,
      ...(subtype === 'success' ? {} : { errors: ['interrupted'] }),
    });
    const generator = (async function* () {
      try {
        for await (const message of params.prompt) {
          const content = (message as { message?: { content?: unknown } }).message?.content;
          query.prompt = typeof content === 'string' ? content : '';
        }
        yield {
          type: 'system',
          subtype: 'init',
          session_id: session,
          apiKeySource: 'none',
          claude_code_version: '2.9.0-test',
          cwd: params.options['cwd'],
          tools: params.options['tools'] ?? [],
          model: params.options['model'],
          permissionMode: 'dontAsk',
          mcp_servers: [],
          slash_commands: [],
          output_style: 'default',
          skills: [],
          plugins: [],
          uuid: `u-init-${String(index)}`,
        };
        onQuery?.(index);
        if (turn.kind === 'fail') {
          throw new Error(turn.message);
        }
        if (turn.kind === 'until-interrupted') {
          await wasInterrupted;
          yield result('error_during_execution', '');
          return;
        }
        if (turn.kind === 'script') {
          let calls = 0;
          const overlapping: Promise<ToolOutcome>[] = [];
          for (const step of turn.steps) {
            if ('act' in step) {
              await step.act(query);
              continue;
            }
            if ('untilInterrupted' in step) {
              await wasInterrupted;
              yield result('error_during_execution', '');
              return;
            }
            calls += 1;
            const toolUseId = `toolu_${String(index)}_${String(calls)}`;
            yield {
              type: 'assistant',
              parent_tool_use_id: null,
              session_id: session,
              uuid: `u-tool-${String(index)}-${String(calls)}`,
              message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: toolUseId, name: step.tool, input: step.input }],
              },
            };
            const pending = callTool(params.options, step.tool, step.input, toolUseId);
            if (step.concurrentWithNext === true) {
              overlapping.push(pending);
              continue;
            }
            const outcomes = [...(await Promise.all(overlapping)), await pending];
            overlapping.length = 0;
            for (const outcome of outcomes) {
              query.toolOutcomes.push(outcome);
              if (step.noToolResult === true && outcome.toolUseId === toolUseId) {
                continue;
              }
              yield {
                type: 'user',
                parent_tool_use_id: null,
                session_id: session,
                uuid: `u-result-${outcome.toolUseId}`,
                message: {
                  role: 'user',
                  content: [
                    {
                      type: 'tool_result',
                      tool_use_id: outcome.toolUseId,
                      is_error: outcome.isError,
                      content: outcome.text,
                    },
                  ],
                },
              };
            }
          }
          yield {
            type: 'assistant',
            parent_tool_use_id: null,
            session_id: session,
            uuid: `u-assistant-${String(index)}`,
            message: { role: 'assistant', content: [{ type: 'text', text: turn.text }] },
          };
          yield result('success', turn.text);
          return;
        }
        turn.act?.(query);
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: session,
          uuid: `u-assistant-${String(index)}`,
          message: { role: 'assistant', content: [{ type: 'text', text: turn.text }] },
        };
        yield result('success', turn.text);
      } finally {
        if (child !== null && child.exitCode === null && child.signalCode === null) {
          child.exit(0);
        }
      }
    })();
    return Object.assign(generator, {
      close: () => undefined,
      interrupt: () => {
        query.interrupts += 1;
        interrupted();
        return Promise.resolve({ still_queued: [] });
      },
    });
  };
  const mcp = fakeMcpTools();
  return {
    queryFn: queryFn as any,
    spawnProcess: (() => fakeChild()) as any,
    queries,
    mcpTools: mcp.tools,
    mcpServers: mcp.servers,
  };
}

// --- The factory, with both constructions observed --------------------------------

export interface Built {
  readonly claudePermissions: ClaudePermissionPolicy[];
  /** DSP-145: the command runner each Claude construction was given (`undefined` for none). */
  readonly commandRunners: Array<AgentCommandRunner | undefined>;
  readonly cursorPolicies: ToolPolicy[];
  disposals: number;
}

export function adapters(
  sdk: ReturnType<typeof claudeSdk> | null,
  overrides: Partial<ProviderAdaptersOptions> = {},
  options: { readonly cursorAllowed?: boolean; readonly handleProvider?: 'cursor' } = {},
) {
  const built: Built = { claudePermissions: [], commandRunners: [], cursorPolicies: [], disposals: 0 };
  const factory = providerAdapters({
    presentation: false,
    claudeAuthorizationReference: 'test-ref',
    claudeInstalled: true,
    env: CLEAN_ENV,
    construct: {
      claude: (permissions, commandRunner) => {
        built.claudePermissions.push(permissions);
        built.commandRunners.push(commandRunner);
        if (sdk === null) {
          throw new Error('DSP-138: a Claude adapter was built where none should be');
        }
        const adapter = new ClaudeAgentSdkAdapter({
          queryFn: sdk.queryFn,
          spawnProcess: sdk.spawnProcess,
          env: CLEAN_ENV,
          permissions,
          mcpTools: sdk.mcpTools,
          ...(commandRunner === undefined ? {} : { commandRunner }),
        });
        const dispose = adapter.dispose.bind(adapter);
        adapter.dispose = async () => {
          built.disposals += 1;
          await dispose();
        };
        if (options.handleProvider !== undefined) {
          const start = adapter.startSession.bind(adapter);
          const answer = options.handleProvider;
          adapter.startSession = async (config) => ({ ...(await start(config)), provider: answer });
        }
        return adapter;
      },
      cursor: (toolPolicy) => {
        built.cursorPolicies.push(toolPolicy);
        if (options.cursorAllowed !== true) {
          throw new Error('DSP-138: a Cursor adapter was built in a Claude run');
        }
        return { id: 'counted-cursor' } as unknown as ChatAdapter;
      },
    },
    ...overrides,
  });
  return { factory, built };
}
