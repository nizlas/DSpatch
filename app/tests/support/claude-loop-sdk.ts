/**
 * A substituted Claude SDK and the shared adapter factory with both constructions
 * observed, for tests that walk a loop run with Claude (DSP-138, DSP-139, DSP-146).
 *
 * The Claude adapter built here is the real `ClaudeAgentSdkAdapter` with `queryFn` and
 * `spawnProcess` substituted, so nothing loads `@anthropic-ai/claude-agent-sdk`, nothing
 * is spawned and nothing is sent anywhere. Cursor's construction is counted and throws
 * unless a test allows it, so a Claude run that reached it would fail.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { ClaudeAgentSdkAdapter, type ClaudePermissionPolicy } from '../../src/adapter/claude-agent-sdk-adapter.ts';
import type { ToolPolicy } from '../../src/adapter/cursor-sdk-adapter.ts';
import type { ChatAdapter } from '../../src/main/chat-service.ts';
import { providerAdapters, type ProviderAdaptersOptions } from '../../src/main/provider-adapters.ts';
import { gateCommandSpawnOptions, killCommandTree } from '../../src/main/workspace-command.ts';

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
   * DSP-145, DSP-146: a scripted model that calls tools, in order, then answers with
   * `text`. A tool call goes through what the SDK is documented to do with the options it
   * was given: every PreToolUse hook first, then the pre-approval in `allowedTools`, then
   * the tool. `Bash` and `PowerShell` are simulated after Claude Code's documented
   * contract ({@link simulatedShell}); `act` steps stand in for Read and Edit. Not the SDK:
   * its real behaviour is unobserved here.
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
  /** `denied` by a hook or by the permission rules; `missing` when the tool is not simulated. */
  readonly how: 'ran' | 'denied' | 'missing' | 'interrupted';
  readonly isError: boolean;
  readonly text: string;
}

export interface Query {
  readonly options: Record<string, any>;
  prompt: string;
  interrupts: number;
  /** DSP-145: every scripted tool call and what came back, in order. */
  readonly toolOutcomes: ToolOutcome[];
  /** DSP-146: every hook call the simulated tools made, in order: event and tool. */
  readonly hookCalls: Array<{ readonly event: string; readonly tool: string }>;
}

// --- A simulated shell tool (DSP-146) ------------------------------------------------

/**
 * Claude Code's Bash or PowerShell tool as its documentation describes it (hooks and
 * tools reference, read 27 Oct 2026), with a real command: the line runs through the
 * platform shell in the session's `cwd`; on exit 0 the PostToolUse hooks get
 * `tool_response { stdout, stderr, interrupted }`; on another exit code the
 * PostToolUseFailure hooks get `error` whose first line is `Exit code N`; an interrupt
 * stops the command and fires neither ("cancelling a running tool does not fire this
 * hook"). The simulation stops the whole process tree on interrupt so a test leaves
 * nothing running; what real Claude Code does to a command's children is not documented
 * and not claimed here. Not Claude Code.
 */
async function simulatedShell(
  options: Record<string, any>,
  tool: string,
  input: Record<string, unknown>,
  toolUseId: string,
  interrupt: AbortSignal,
  hookCalls: Query['hookCalls'],
): Promise<ToolOutcome> {
  const line = typeof input['command'] === 'string' ? input['command'] : '';
  const cwd = String(options['cwd'] ?? process.cwd());
  const started = Date.now();
  const ran = await new Promise<{ code: number | null; out: string; err: string; interrupted: boolean }>(
    (resolve) => {
      const child = spawn(line, gateCommandSpawnOptions(cwd));
      let out = '';
      let err = '';
      let interrupted = false;
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        err += chunk.toString('utf8');
      });
      const onInterrupt = (): void => {
        interrupted = true;
        killCommandTree(child);
      };
      if (interrupt.aborted) {
        onInterrupt();
      } else {
        interrupt.addEventListener('abort', onInterrupt, { once: true });
      }
      child.on('error', (error) => {
        interrupt.removeEventListener('abort', onInterrupt);
        resolve({ code: 127, out, err: `${err}${error.message}`, interrupted });
      });
      child.on('close', (code) => {
        interrupt.removeEventListener('abort', onInterrupt);
        resolve({ code, out, err, interrupted });
      });
    },
  );
  const base = {
    session_id: options['sessionId'] ?? options['resume'],
    transcript_path: 'C:/synthetic/transcript.jsonl',
    cwd,
    tool_name: tool,
    tool_input: input,
    tool_use_id: toolUseId,
    duration_ms: Date.now() - started,
  };
  if (ran.interrupted) {
    return { tool, toolUseId, how: 'interrupted', isError: true, text: 'Interrupted by user' };
  }
  const post = async (event: 'PostToolUse' | 'PostToolUseFailure', fields: Record<string, unknown>) => {
    for (const entry of (options['hooks']?.[event] ?? []) as any[]) {
      for (const hook of entry.hooks ?? []) {
        hookCalls.push({ event, tool });
        await hook({ ...base, hook_event_name: event, ...fields }, toolUseId, { signal: new AbortController().signal });
      }
    }
  };
  if (ran.code === 0) {
    await post('PostToolUse', { tool_response: { stdout: ran.out, stderr: ran.err, interrupted: false, isImage: false } });
    return { tool, toolUseId, how: 'ran', isError: false, text: `${ran.out}${ran.err}` };
  }
  const error = `Exit code ${String(ran.code ?? 1)}\n${ran.out}${ran.err}`;
  await post('PostToolUseFailure', { error });
  return { tool, toolUseId, how: 'ran', isError: true, text: error };
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
  interrupt: AbortSignal,
  hookCalls: Query['hookCalls'],
): Promise<ToolOutcome> {
  const entries: any[] = options['hooks']?.PreToolUse ?? [];
  for (const entry of entries) {
    for (const hook of entry.hooks ?? []) {
      hookCalls.push({ event: 'PreToolUse', tool });
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
  const tools: string[] = options['tools'] ?? [];
  if ((tool === 'Bash' || tool === 'PowerShell') && tools.includes(tool)) {
    return simulatedShell(options, tool, input, toolUseId, interrupt, hookCalls);
  }
  return { tool, toolUseId, how: 'missing', isError: true, text: `No such tool available: ${tool}` };
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
    const query: Query = { options: params.options, prompt: '', interrupts: 0, toolOutcomes: [], hookCalls: [] };
    queries.push(query);
    const index = queries.length - 1;
    const turn = turns[index] ?? { kind: 'fail', message: `no turn scripted for query ${String(index)}` };
    let interrupted: () => void = () => undefined;
    const wasInterrupted = new Promise<void>((resolve) => {
      interrupted = resolve;
    });
    const interruptSignal = new AbortController();
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
            const pending = callTool(
              params.options,
              step.tool,
              step.input,
              toolUseId,
              interruptSignal.signal,
              query.hookCalls,
            );
            if (step.concurrentWithNext === true) {
              overlapping.push(pending);
              continue;
            }
            const outcomes = [...(await Promise.all(overlapping)), await pending];
            overlapping.length = 0;
            const stopped = outcomes.some((outcome) => outcome.how === 'interrupted');
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
            if (stopped) {
              yield result('error_during_execution', '');
              return;
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
        interruptSignal.abort();
        return Promise.resolve({ still_queued: [] });
      },
    });
  };
  return {
    queryFn: queryFn as any,
    spawnProcess: (() => fakeChild()) as any,
    queries,
  };
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
