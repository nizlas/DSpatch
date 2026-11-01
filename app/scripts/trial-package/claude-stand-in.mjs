// @ts-nocheck: a trial script.
/**
 * A stand-in for the model behind the real Claude Code program, in a clean container only. The
 * trial points api.anthropic.com at this process in that container's /etc/hosts, so the packaged
 * product, the fetched SDK and program and DSpatch's tool server all run for real and no request
 * can reach Anthropic. Run by the packaged program's own runtime: the container has no Node.
 *
 *     stand-in <key.pem> <cert.pem> <log file>
 *
 * It also stands in for the sign-in servers (token exchange, device code), so the vendors' real
 * login commands finish here. A message holding FAIL-THIS-TURN is answered with a server error.
 *
 * The first turn of a conversation asks for DSpatch's `list_recent_workspaces` tool; the answer
 * to the tool's result quotes it, so the reply shows that the tool ran.
 */

import fs from 'node:fs';
import https from 'node:https';

const [key, cert, logFile] = process.argv.slice(2);

// A stand-in that dies reads as a network fault in the program. Say why, and stay up.
process.on('uncaughtException', (error) => {
  fs.appendFileSync(logFile, `STAND-IN ERROR ${String(error.stack)}\n`);
});

function events(response, message, blocks) {
  const send = (type, body) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  send('message_start', { message: { id: 'msg_standin', type: 'message', role: 'assistant', model: message.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
    } else {
      send('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    send('content_block_stop', { index });
  });
  send('message_delta', { delta: { stop_reason: blocks.at(-1).type === 'tool_use' ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } });
  send('message_stop', {});
  response.end();
}

https
  .createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (request, response) => {
    let text = '';
    request.on('data', (chunk) => {
      text += chunk;
    });
    request.on('end', () => {
      fs.appendFileSync(logFile, `${request.method} ${String(request.headers.host)} ${request.url}\n`);
      const json = (body, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (request.url.includes('/oauth/token')) {
        json({ access_token: 'sk-ant-oat01-synthetic', refresh_token: 'sk-ant-ort01-synthetic', expires_in: 31536000, scope: 'user:inference user:profile user:sessions:claude_code', account: { uuid: '00000000-0000-4000-8000-000000000001', email_address: 'synthetic@example.test' }, organization: { uuid: '00000000-0000-4000-8000-000000000002' } });
        return;
      }
      if (request.url.includes('/login/device/code')) {
        json({ device_code: 'synthetic', user_code: 'SYNT-HETC', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
        return;
      }
      if (request.url.includes('/login/oauth/access_token')) {
        json({ access_token: 'gho_synthetic', token_type: 'bearer', scope: 'read:user' });
        return;
      }
      if (request.url === '/user' || request.url.startsWith('/copilot_internal/user')) {
        json({ login: 'synthetic-user', id: 1 });
        return;
      }
      if (text.includes('FAIL-THIS-TURN')) {
        json({ type: 'error', error: { type: 'api_error', message: 'The stand-in refused this turn.' } }, 400);
        return;
      }
      if (!request.url.startsWith('/v1/messages') || request.url.includes('count_tokens')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(request.url.includes('count_tokens') ? '{"input_tokens":1}' : '{}');
        return;
      }
      const message = JSON.parse(text);
      const tools = (message.tools ?? []).map((tool) => tool.name);
      fs.appendFileSync(logFile, `tools ${JSON.stringify(tools)}\n`);
      // The program can put text of its own after the result, in the same turn or the next.
      const sinceAsked = message.messages.slice(message.messages.findLastIndex((entry) => entry.role === 'assistant') + 1);
      const result = sinceAsked.flatMap((entry) => (Array.isArray(entry.content) ? entry.content : [])).find((part) => part.type === 'tool_result');
      const wanted = 'mcp__dspatch__list_recent_workspaces';
      if (!message.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'msg_standin', type: 'message', role: 'assistant', model: message.model, content: [{ type: 'text', text: 'Stand-in' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
      } else if (result !== undefined) {
        fs.appendFileSync(logFile, `tool result ${JSON.stringify(result.content).slice(0, 300)}\n`);
        events(response, message, [{ type: 'text', text: `STAND-IN-REPLY: the tool answered ${result.is_error === true ? 'with an error' : 'and ran'}.` }]);
      } else if (tools.includes(wanted)) {
        events(response, message, [{ type: 'tool_use', id: `toolu_${String(Date.now())}`, name: wanted, input: {} }]);
      } else {
        events(response, message, [{ type: 'text', text: 'STAND-IN-REPLY: no DSpatch tool was offered.' }]);
      }
    });
  })
  .listen(443, '127.0.0.1', () => {
    fs.appendFileSync(logFile, 'listening\n');
  });
