import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for a chat-completions model, for tests of Copilot's **real runtime**.
 *
 * The runtime is given it as a bring-your-own-model provider, so its own tool loop,
 * permission checks and hooks run for real while no account, network or model is involved.
 * It answers from a script, one entry per model request, and keeps what it was sent. That is
 * evidence about the runtime and DSpatch's configuration, not about a Copilot account.
 */

export type ScriptedTurn =
  | { readonly text: string; readonly chunks?: number }
  | { readonly tool: string; readonly args: Readonly<Record<string, unknown>> }
  /** Never answers until the request is dropped: a model still thinking. */
  | { readonly hang: true };

export interface ModelRequest {
  readonly model: string;
  readonly toolNames: readonly string[];
  readonly messages: readonly { readonly role: string; readonly content: unknown }[];
}

export interface StandInModel {
  readonly baseUrl: string;
  readonly requests: ModelRequest[];
  /** The next request's answer. */
  script(...turns: readonly ScriptedTurn[]): void;
  close(): Promise<void>;
}

export async function startStandInModel(): Promise<StandInModel> {
  const queue: ScriptedTurn[] = [];
  const requests: ModelRequest[] = [];
  let callId = 0;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      if (!request.url?.includes('/chat/completions')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [] }));
        return;
      }
      const parsed = JSON.parse(body) as { model: string; messages: ModelRequest['messages']; tools?: readonly { readonly function: { readonly name: string } }[]; stream?: boolean };
      requests.push({ model: parsed.model, toolNames: (parsed.tools ?? []).map((tool) => tool.function.name), messages: parsed.messages });
      const turn = queue.shift() ?? { text: 'Done.' };
      if ('hang' in turn) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: parsed.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Thinking' }, finish_reason: null }] })}\n\n`);
        return;
      }
      const chunk = (delta: unknown, finish: string | null): string =>
        `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if ('tool' in turn) {
        callId += 1;
        response.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${String(callId)}`, type: 'function', function: { name: turn.tool, arguments: JSON.stringify(turn.args) } }] }, null));
        response.write(chunk({}, 'tool_calls'));
      } else {
        const size = Math.max(1, Math.ceil(turn.text.length / (turn.chunks ?? 3)));
        response.write(chunk({ role: 'assistant', content: '' }, null));
        for (let at = 0; at < turn.text.length; at += size) {
          response.write(chunk({ content: turn.text.slice(at, at + size) }, null));
        }
        response.write(chunk({}, 'stop'));
      }
      response.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: parsed.model, choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    script: (...turns) => {
      queue.push(...turns);
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
