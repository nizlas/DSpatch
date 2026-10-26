/**
 * A substituted Claude SDK for the main chat's tests (DSP-117): `queryFn`,
 * `spawnProcess` and `localLookup`, so a real `ClaudeAgentSdkAdapter` can run one
 * turn with nothing started, nothing read from a Claude profile and nothing sent
 * anywhere (review B1). The offline guard refuses the real SDK as well.
 *
 * The messages follow the shapes `claude-agent-sdk-adapter.test.ts` uses for SDK
 * 0.3.306; this is the smallest subset a turn needs: init, one assistant text,
 * result.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export interface SubstituteCall {
  readonly options: Record<string, any>;
  prompt: string;
}

export interface ClaudeSubstitute {
  readonly queryFn: any;
  readonly spawnProcess: any;
  readonly localLookup: any;
  /** Every query() call, with its options and the prompt text it read. */
  readonly calls: SubstituteCall[];
  /** Every lookup asked of the substituted `getSessionInfo`. */
  readonly lookups: Array<{ uuid: string; dir: string }>;
}

function fakeChild(): any {
  const child = new EventEmitter() as any;
  child.pid = 4343;
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

export function claudeSubstitute(answer = 'A substituted Claude answer.'): ClaudeSubstitute {
  const calls: SubstituteCall[] = [];
  const lookups: Array<{ uuid: string; dir: string }> = [];
  const spawnProcess = () => fakeChild();
  const queryFn = (params: { prompt: AsyncIterable<unknown>; options: Record<string, any> }) => {
    const call: SubstituteCall = { options: params.options, prompt: '' };
    calls.push(call);
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
    const generator = (async function* () {
      try {
        for await (const message of params.prompt) {
          const content = (message as { message?: { content?: unknown } }).message?.content;
          call.prompt = typeof content === 'string' ? content : '';
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
          uuid: 'u-init',
        };
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: session,
          uuid: 'u-assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 10,
          duration_api_ms: 8,
          num_turns: 1,
          result: answer,
          stop_reason: 'end_turn',
          total_cost_usd: 0,
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          modelUsage: {},
          permission_denials: [],
          uuid: 'u-result',
          session_id: session,
        };
      } finally {
        if (child !== null && child.exitCode === null && child.signalCode === null) {
          child.exit(0);
        }
      }
    })();
    return Object.assign(generator, {
      close: () => undefined,
      interrupt: () => Promise.resolve({ still_queued: [] }),
    });
  };
  const localLookup = async (uuid: string, dir: string) => {
    lookups.push({ uuid, dir });
    return undefined;
  };
  return { queryFn, spawnProcess, localLookup, calls, lookups };
}
