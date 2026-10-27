/**
 * DSpatch's workspace functions as the chat's tools (DSP-149).
 *
 * What the tools do against real folders on disk with a stand-in host, how each SDK is
 * given them (Cursor's `local.customTools` from the SDK's own types; Claude's in-process
 * MCP server built by the *installed* SDK's own `createSdkMcpServer` and `tool`, when
 * Claude support is installed), and that a tool call runs the host function. No provider
 * is called and no model turn is spent anywhere here.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/workspace-tools.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { buildAppToolServer, claudeAppToolName } from '../src/adapter/claude-agent-sdk-adapter.ts';
import { claudeSupportStatus, loadClaudeToolKit } from '../src/adapter/claude-support.ts';
import { cursorCustomTools } from '../src/adapter/cursor-sdk-adapter.ts';
import type { AppTool } from '../src/adapter/types.ts';
import { findFolders, hostPath, WORKSPACE_TOOL_NAMES, workspaceTools, type WorkspaceToolHost } from '../src/host/workspace-tools.ts';

const roots: string[] = [];
after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function development(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-tools-'));
  roots.push(root);
  for (const folder of ['DSpatch', 'MiniDAWLab', 'mini-daw-lab-old', path.join('archive', 'DSpatch'), path.join('node_modules', 'MiniDAWLab')]) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
  return root;
}

function standIn(): { host: WorkspaceToolHost; created: { name: string; folders: readonly string[] }[]; opened: string[] } {
  const created: { name: string; folders: readonly string[] }[] = [];
  const opened: string[] = [];
  return {
    created,
    opened,
    host: {
      recent: () => created.map((entry, index) => ({ id: `ws-${String(index)}`, ...entry })),
      openWorkspace: () => null,
      checkFolder: (folder) => {
        if (!fs.existsSync(folder)) {
          throw new Error(`There is no folder at ${folder}.`);
        }
        return path.resolve(folder);
      },
      createWorkspace: (name, folders) => {
        created.push({ name, folders });
        return { id: `ws-${String(created.length - 1)}` };
      },
      addFolders: () => ({ problem: 'no workspace' }),
      openWhenTurnEnds: (id) => {
        opened.push(id);
      },
    },
  };
}

function tool(tools: readonly AppTool[], name: string): AppTool {
  const found = tools.find((entry) => entry.name === name);
  assert.ok(found !== undefined, name);
  return found;
}

test('the tools are the workspace functions, each described for the model', () => {
  const tools = workspaceTools(standIn().host);
  assert.deepEqual(tools.map((entry) => entry.name), [...WORKSPACE_TOOL_NAMES]);
  for (const entry of tools) {
    assert.ok(entry.description.length > 40, `${entry.name} says what it does`);
  }
  assert.match(tool(tools, 'find_folders').description, /never make up a path/);
});

test('find_folders finds exact and close names, never inside node_modules, and says when to ask', async () => {
  const root = development();
  const found = findFolders(root, ['DSpatch', 'MiniDAWLab', 'Nowhere']);
  assert.deepEqual(found.matches['MiniDAWLab']?.exact, [path.join(root, 'MiniDAWLab')]);
  assert.deepEqual(found.matches['DSpatch']?.exact.sort(), [path.join(root, 'DSpatch'), path.join(root, 'archive', 'DSpatch')].sort());
  const result = await tool(workspaceTools(standIn().host), 'find_folders').execute({ names: ['MiniDAWLab', 'DSpatch', 'Nowhere'], under: root });
  assert.equal(result.isError, false);
  assert.match(result.text, /MiniDAWLab: .*more than one candidate|MiniDAWLab: /);
  assert.match(result.text, /DSpatch: more than one candidate, ask the person which one/);
  assert.match(result.text, /Nowhere: not found .* Ask the person where it is\./);
  assert.doesNotMatch(result.text, /node_modules/);
});

test('create_workspace checks every folder, invents none, and opens the workspace when the turn ends', async () => {
  const root = development();
  const { host, created, opened } = standIn();
  const create = tool(workspaceTools(host), 'create_workspace');
  const refused = await create.execute({ name: 'Agentintegration', folders: [path.join(root, 'DSpatch'), path.join(root, 'Invented')] });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /Nothing was created/);
  assert.deepEqual(created, []);
  const made = await create.execute({ name: 'Agentintegration', folders: [path.join(root, 'DSpatch'), path.join(root, 'MiniDAWLab')] });
  assert.equal(made.isError, false);
  assert.deepEqual(created, [{ name: 'Agentintegration', folders: [path.join(root, 'DSpatch'), path.join(root, 'MiniDAWLab')] }]);
  assert.deepEqual(opened, ['ws-0']);
  assert.match(made.text, /opens it when this reply ends/);
  assert.match(made.text, /sends nothing and starts no work/);
});

test('a relative path is the home folder, never the process working directory', () => {
  assert.equal(hostPath('development'), path.join(os.homedir(), 'development'));
  assert.equal(hostPath('~/development'), path.join(os.homedir(), 'development'));
  assert.notEqual(path.dirname(hostPath('x')), process.cwd());
});

test("Cursor gets the tools as local.customTools, with a JSON Schema and the host's function behind each", async () => {
  const root = development();
  const custom = cursorCustomTools(workspaceTools(standIn().host));
  assert.deepEqual(Object.keys(custom), [...WORKSPACE_TOOL_NAMES]);
  const find = custom['find_folders'];
  assert.deepEqual(find?.inputSchema, {
    type: 'object',
    properties: {
      names: { type: 'array', items: { type: 'string' }, description: tool(workspaceTools(standIn().host), 'find_folders').parameters['names']?.description ?? '' },
      under: { type: 'string', description: tool(workspaceTools(standIn().host), 'find_folders').parameters['under']?.description ?? '' },
    },
    required: ['names', 'under'],
  });
  assert.deepEqual(find?.annotations, { readOnlyHint: true });
  const answer = (await find?.execute({ names: ['MiniDAWLab'], under: root }, {})) as { content: { text: string }[]; isError: boolean };
  assert.equal(answer.isError, false);
  assert.match(answer.content[0]?.text ?? '', /MiniDAWLab/);
});

test('Claude gets the tools as an in-process MCP server built by the installed SDK itself', async (context) => {
  // Opt-in, outside the suite: the suite's offline guard refuses to load the real SDK at
  // all, which is the right rule for it. Building the server starts no process and calls
  // nothing; run it with DSPATCH_REAL_SDK_CHECK=1 and plain `node --import ./scripts/ts-resolve.mjs --test`.
  if (process.env['DSPATCH_REAL_SDK_CHECK'] !== '1') {
    context.skip('opt-in (DSPATCH_REAL_SDK_CHECK=1); the shapes are checked by npm run typecheck:claude');
    return;
  }
  if (!claudeSupportStatus().installed) {
    context.skip('Claude support is not installed here; the shapes are checked by npm run typecheck:claude');
    return;
  }
  const kit = await loadClaudeToolKit();
  const tools = workspaceTools(standIn().host);
  const server = buildAppToolServer(kit, tools) as { type?: unknown; name?: unknown; instance?: unknown };
  assert.equal(server.type, 'sdk');
  assert.equal(server.name, 'dspatch');
  assert.ok(server.instance !== undefined && server.instance !== null, 'the SDK built an MCP server instance');
  assert.equal(claudeAppToolName({ name: 'create_workspace' }), 'mcp__dspatch__create_workspace');
});
