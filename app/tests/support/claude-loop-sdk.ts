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
  | { readonly kind: 'until-interrupted' };

export interface Query {
  readonly options: Record<string, any>;
  prompt: string;
  interrupts: number;
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
    const query: Query = { options: params.options, prompt: '', interrupts: 0 };
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
  return { queryFn: queryFn as any, spawnProcess: (() => fakeChild()) as any, queries };
}

// --- The factory, with both constructions observed --------------------------------

export interface Built {
  readonly claudePermissions: ClaudePermissionPolicy[];
  readonly cursorPolicies: ToolPolicy[];
  disposals: number;
}

export function adapters(
  sdk: ReturnType<typeof claudeSdk> | null,
  overrides: Partial<ProviderAdaptersOptions> = {},
  options: { readonly cursorAllowed?: boolean; readonly handleProvider?: 'cursor' } = {},
) {
  const built: Built = { claudePermissions: [], cursorPolicies: [], disposals: 0 };
  const factory = providerAdapters({
    presentation: false,
    claudeAuthorizationReference: 'test-ref',
    claudeInstalled: true,
    env: CLEAN_ENV,
    construct: {
      claude: (permissions) => {
        built.claudePermissions.push(permissions);
        if (sdk === null) {
          throw new Error('DSP-138: a Claude adapter was built where none should be');
        }
        const adapter = new ClaudeAgentSdkAdapter({
          queryFn: sdk.queryFn,
          spawnProcess: sdk.spawnProcess,
          env: CLEAN_ENV,
          permissions,
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
