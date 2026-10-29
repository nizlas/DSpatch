/**
 * A substituted Claude SDK whose "model" uses tools (DSP-152), for the analysis access.
 *
 * Like `claude-chat-substitute.ts`, it stands in for `query()` so a real
 * `ClaudeAgentSdkAdapter` runs with nothing started and nothing sent anywhere. Unlike it,
 * the scripted model makes tool calls, and each goes the way Claude Code takes one:
 *
 * 1. the call is announced (`assistant` message with a `tool_use` block);
 * 2. every PreToolUse hook the adapter passed in `options.hooks` is asked, in order, and a
 *    `deny` from any of them refuses the call;
 * 3. an allowed `Read` reads the real file from disk, an allowed `Grep` searches the real
 *    files under its folder, and the result comes back (`user` message, `tool_result`).
 *
 * What is substituted is the model's choices and Claude Code's own tool implementation;
 * the hooks deciding are the adapter's, and the files read are the ones the host wrote. A
 * refused call reads nothing. The script's last step builds the answer from what it read.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

/** A tool call the scripted model makes. */
export interface ScriptedCall {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** What one tool call came to. */
export interface CallOutcome {
  readonly call: ScriptedCall;
  readonly allowed: boolean;
  /** The file's text (Read) or matching `path:line` entries (Grep); `null` when refused or missing. */
  readonly result: string | null;
}

/**
 * The model's script for one turn: given the working folder and the prompt, the calls to
 * make, then (given what they came to) the answer text.
 */
export interface ReadingScript {
  calls(cwd: string, prompt: string): readonly ScriptedCall[];
  answer(outcomes: readonly CallOutcome[], cwd: string, prompt: string): string;
}

export interface ReadingSubstitute {
  readonly queryFn: any;
  readonly spawnProcess: any;
  readonly localLookup: any;
  readonly calls: { readonly options: Record<string, any>; prompt: string; outcomes: CallOutcome[] }[];
}

function fakeChild(): any {
  const child = new EventEmitter() as any;
  child.pid = 4344;
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

/** Claude Code's Grep, in miniature: `path:line:text` for each matching line under `folder`. */
function grep(folder: string, pattern: string): string {
  const expression = new RegExp(pattern);
  const out: string[] = [];
  const visit = (entry: string): void => {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entry).sort()) {
        visit(path.join(entry, name));
      }
      return;
    }
    fs.readFileSync(entry, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (expression.test(line)) {
          out.push(`${entry}:${String(index + 1)}:${line}`);
        }
      });
  };
  visit(folder);
  return out.join('\n');
}

export function readingSubstitute(script: ReadingScript): ReadingSubstitute {
  const calls: ReadingSubstitute['calls'] = [];
  const queryFn = (params: { prompt: AsyncIterable<unknown>; options: Record<string, any> }) => {
    const call = { options: params.options, prompt: '', outcomes: [] as CallOutcome[] };
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
    const cwd = String(params.options['cwd']);
    const preToolUse = (params.options['hooks']?.['PreToolUse'] ?? []) as { hooks: ((input: unknown, id: string | undefined, o: unknown) => Promise<Record<string, any>>)[] }[];
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
          cwd,
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
        let index = 0;
        for (const scripted of script.calls(cwd, call.prompt)) {
          index += 1;
          const id = `toolu_${String(index)}`;
          yield {
            type: 'assistant',
            parent_tool_use_id: null,
            session_id: session,
            uuid: `u-use-${String(index)}`,
            message: { role: 'assistant', content: [{ type: 'tool_use', id, name: scripted.name, input: scripted.input }] },
          };
          let allowed = (params.options['tools'] as string[] | undefined)?.includes(scripted.name) ?? false;
          let reason = allowed ? '' : `No such tool available: ${scripted.name}`;
          for (const matcher of preToolUse) {
            for (const hook of matcher.hooks) {
              if (!allowed) {
                break;
              }
              const output = await hook({ hook_event_name: 'PreToolUse', tool_name: scripted.name, tool_input: scripted.input, tool_use_id: id }, id, { signal: new AbortController().signal });
              if (output['hookSpecificOutput']?.permissionDecision === 'deny') {
                allowed = false;
                reason = String(output['hookSpecificOutput']?.permissionDecisionReason ?? 'denied');
              }
            }
          }
          let result: string | null = null;
          if (allowed) {
            try {
              if (scripted.name === 'Read') {
                result = fs.readFileSync(String(scripted.input['file_path']), 'utf8');
              } else if (scripted.name === 'Grep') {
                result = grep(path.resolve(cwd, String(scripted.input['path'] ?? '.')), String(scripted.input['pattern']));
              }
            } catch (error) {
              reason = error instanceof Error ? error.message : String(error);
            }
          }
          call.outcomes.push({ call: scripted, allowed, result });
          yield {
            type: 'user',
            parent_tool_use_id: null,
            session_id: session,
            uuid: `u-result-${String(index)}`,
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result ?? reason, is_error: result === null }] },
          };
        }
        const answer = script.answer(call.outcomes, cwd, call.prompt);
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          session_id: session,
          uuid: 'u-answer',
          message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 10,
          duration_api_ms: 8,
          num_turns: index + 1,
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
  const localLookup = async () => undefined;
  return { queryFn, spawnProcess: () => fakeChild(), localLookup, calls };
}
