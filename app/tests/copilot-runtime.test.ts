import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  COPILOT_ANALYSIS_POLICY,
  COPILOT_CHAT_POLICY,
  COPILOT_REVIEW_POLICY,
  CopilotSdkAdapter,
  copilotNotSignedInText,
  type CopilotToolPolicy,
} from '../src/adapter/copilot-sdk-adapter.ts';
import type { AgentEvent, TerminalRunStatus } from '../src/adapter/types.ts';
import { startStandInModel, type StandInModel } from './support/copilot-stand-in-model.ts';

/*
 * The real Copilot SDK and its real runtime, with a local stand-in model (DSP-148). No
 * account, no network, no model. It shows what the runtime does with DSpatch's configuration:
 * which tools reach the model, what a refused call does, what events a turn gives and how a
 * stop ends. It says nothing about a real account, real models or managed hooks at work.
 */

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-home-'));
const SECRET = 'SECRET-OUTSIDE-THE-FOLDER';

function runtimeEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, COPILOT_HOME: home, ...extra };
  for (const name of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    delete env[name];
  }
  return env;
}

let model: StandInModel;
let root: string;
let outside: string;

function adapterFor(policy: CopilotToolPolicy, env: Record<string, string | undefined> = runtimeEnv()): CopilotSdkAdapter {
  return new CopilotSdkAdapter({
    policy,
    env,
    testProvider: { type: 'openai', baseUrl: model.baseUrl, apiKey: 'stand-in' },
  });
}

interface Turn {
  readonly events: AgentEvent[];
  readonly status: TerminalRunStatus;
  readonly end: string | undefined;
}

async function turn(adapter: CopilotSdkAdapter, folder: string, prompt: string, whileRunning?: (sessionId: string, events: AgentEvent[]) => void): Promise<Turn> {
  const handle = await adapter.startSession({ provider: 'copilot', modelRequested: 'stand-in', workspacePath: folder });
  const events: AgentEvent[] = [];
  const finished = new Promise<Turn>((resolve) => {
    adapter.subscribe(handle.dspatchSessionId, (event) => {
      events.push(event);
      whileRunning?.(handle.dspatchSessionId, events);
      if (event.type === 'run.finished') {
        resolve({ events, status: event.status, end: event.end });
      }
    });
  });
  await adapter.send(handle.dspatchSessionId, prompt);
  return finished;
}

function toolResultsSent(): string {
  return model.requests.flatMap((request) => request.messages.filter((message) => message.role === 'tool').map((message) => JSON.stringify(message.content))).join('\n');
}

describe('the Copilot runtime with a stand-in model', { timeout: 120_000 }, () => {
  before(async () => {
    model = await startStandInModel();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-root-'));
    fs.mkdirSync(path.join(root, 'target'));
    fs.writeFileSync(path.join(root, 'target', 'a.txt'), 'inside the folder\n');
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-out-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), `${SECRET}\n`);
  });

  after(async () => {
    await model.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('streams a text answer and reports the model and usage', async () => {
    const adapter = adapterFor(COPILOT_REVIEW_POLICY);
    model.script({ text: 'Hello from the stand-in.', chunks: 4 });
    const result = await turn(adapter, root, 'Say hello');
    await adapter.dispose();
    assert.equal(result.status, 'finished');
    assert.ok(result.events.filter((event) => event.type === 'assistant.delta').length >= 2, 'several deltas');
    const message = result.events.find((event) => event.type === 'assistant.message');
    assert.equal(message?.type === 'assistant.message' ? message.text : '', 'Hello from the stand-in.');
    assert.ok(result.events.some((event) => event.type === 'usage'));
  });

  it('review: the model is offered no file, shell or web tool, and a call it makes anyway reads nothing', async () => {
    const adapter = adapterFor(COPILOT_REVIEW_POLICY);
    const before = model.requests.length;
    model.script({ tool: 'view', args: { path: path.join(outside, 'secret.txt') } }, { text: 'I answered in text.' });
    const result = await turn(adapter, root, 'Read that file');
    await adapter.dispose();
    const offered = model.requests[before]?.toolNames ?? [];
    for (const forbidden of ['view', 'glob', 'grep', 'create', 'edit', 'bash', 'powershell', 'web_fetch', 'task', 'skill']) {
      assert.ok(!offered.includes(forbidden), `${forbidden} offered: ${offered.join(' ')}`);
    }
    assert.equal(result.status, 'finished');
    assert.ok(!toolResultsSent().includes(SECRET));
  });

  it('analysis: only the three reading tools are offered, inside reads work, outside reads do not', async () => {
    const adapter = adapterFor(COPILOT_ANALYSIS_POLICY);
    const before = model.requests.length;
    model.script(
      { tool: 'view', args: { path: path.join(root, 'target', 'a.txt') } },
      { tool: 'view', args: { path: path.join(outside, 'secret.txt') } },
      { tool: 'grep', args: { pattern: 'SECRET', paths: [outside] } },
      { tool: 'glob', args: { pattern: '../**/*.txt' } },
      { text: '{"done":true}' },
    );
    const result = await turn(adapter, root, 'Analyse');
    await adapter.dispose();
    const offered = model.requests[before]?.toolNames ?? [];
    assert.deepEqual(['glob', 'grep', 'view'].filter((name) => offered.includes(name)), ['glob', 'grep', 'view']);
    for (const forbidden of ['create', 'edit', 'bash', 'powershell', 'web_fetch', 'task', 'skill']) {
      assert.ok(!offered.includes(forbidden), `${forbidden} offered: ${offered.join(' ')}`);
    }
    const sent = toolResultsSent();
    assert.ok(sent.includes('inside the folder'), 'the inside read reached the model');
    assert.ok(!sent.includes(SECRET), 'nothing from outside reached the model');
    assert.equal(result.status, 'finished');
    const statuses = result.events.filter((event) => event.type === 'tool.finished').map((event) => (event.type === 'tool.finished' ? event.status : ''));
    assert.equal(statuses[0], 'ok');
    assert.ok(statuses.slice(1).every((status) => status === 'error'), statuses.join(' '));
  });

  it('analysis: a link inside the folder that leads outside is refused', async (context) => {
    const link = path.join(root, 'target', 'link.txt');
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), link);
    } catch {
      context.skip('this machine does not allow creating a link');
      return;
    }
    const adapter = adapterFor(COPILOT_ANALYSIS_POLICY);
    model.script({ tool: 'view', args: { path: link } }, { text: 'done' });
    await turn(adapter, root, 'Read the link');
    await adapter.dispose();
    fs.rmSync(link);
    assert.ok(!toolResultsSent().includes(SECRET));
  });

  it('analysis of a repository: no instruction file or repository hook from the folder is used', async () => {
    fs.mkdirSync(path.join(root, '.github', 'hooks'), { recursive: true });
    const marker = path.join(outside, 'repo-hook-ran.txt');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'INSTRUCTION-FROM-THE-REVIEWED-CODE\n');
    const write = `node -e "require('fs').writeFileSync(process.argv[1],'x')" "${marker.replace(/\\/g, '/')}"`;
    fs.writeFileSync(path.join(root, '.github', 'hooks', 'evil.json'), JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: 'command', bash: write, powershell: write, timeoutSec: 5 }] } }));
    const adapter = adapterFor(COPILOT_ANALYSIS_POLICY);
    const before = model.requests.length;
    model.script({ tool: 'view', args: { path: path.join(root, 'target', 'a.txt') } }, { text: 'done' });
    await turn(adapter, root, 'Analyse');
    await adapter.dispose();
    const sent = JSON.stringify(model.requests.slice(before).map((request) => request.messages));
    assert.ok(!sent.includes('INSTRUCTION-FROM-THE-REVIEWED-CODE'));
    assert.equal(fs.existsSync(marker), false, 'a hook from the reviewed code ran');
    fs.rmSync(path.join(root, 'AGENTS.md'));
    fs.rmSync(path.join(root, '.github'), { recursive: true });
  });

  it('chat: writes inside the folder work, writes outside are refused, a command is recorded with its exit code', async () => {
    const adapter = adapterFor(COPILOT_CHAT_POLICY);
    const shell = process.platform === 'win32' ? 'powershell' : 'bash';
    const inside = path.join(root, 'made.txt');
    const out = path.join(outside, 'made.txt');
    model.script(
      { tool: 'create', args: { path: inside, file_text: 'made\n' } },
      { tool: 'create', args: { path: out, file_text: 'made\n' } },
      { tool: shell, args: { command: 'node -e "console.log(process.cwd());process.exit(3)"', description: 'exit three', mode: 'sync', initial_wait: 30 } },
      { text: 'finished' },
    );
    const result = await turn(adapter, root, 'Do it');
    await adapter.dispose();
    assert.equal(fs.existsSync(inside), true);
    assert.equal(fs.existsSync(out), false);
    const command = result.events.find((event) => event.type === 'command.finished');
    assert.equal(command?.type === 'command.finished' ? command.command.line : '', 'node -e "console.log(process.cwd());process.exit(3)"');
    assert.equal(command?.type === 'command.finished' ? command.command.requestedBy : '', 'provider-reported');
    assert.equal(command?.type === 'command.finished' ? command.command.exitCode : null, 3);
    assert.ok((command?.type === 'command.finished' ? command.command.stdout : '').toLowerCase().includes(path.basename(root).toLowerCase()), 'the command ran in the session folder');
    fs.rmSync(inside);
  });

  it('a stop during a model call ends the turn, confirmed by the runtime going idle', async () => {
    const adapter = adapterFor(COPILOT_REVIEW_POLICY);
    model.script({ hang: true });
    let asked = false;
    const result = await turn(adapter, root, 'Think', (sessionId, events) => {
      if (!asked && events.some((event) => event.type === 'assistant.delta')) {
        asked = true;
        setTimeout(() => {
          void adapter.cancel(sessionId);
        }, 100);
      }
    });
    await adapter.dispose();
    assert.equal(result.status, 'cancelled');
    assert.equal(result.end, 'stopped');
    assert.ok(result.events.some((event) => event.type === 'run.cancel_requested'));
  });

  it('a user hook in the runtime home runs although DSpatch discovers no configuration', async () => {
    const hookHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-hookhome-'));
    fs.mkdirSync(path.join(hookHome, 'hooks'));
    const marker = path.join(hookHome, 'ran.txt').replace(/\\/g, '/');
    const write = `node -e "require('fs').writeFileSync(process.argv[1],'ran')" "${marker}"`;
    fs.writeFileSync(path.join(hookHome, 'hooks', 'probe.json'), JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: 'command', bash: write, powershell: write, timeoutSec: 20 }] } }));
    const adapter = adapterFor(COPILOT_ANALYSIS_POLICY, runtimeEnv({ COPILOT_HOME: hookHome }));
    model.script({ tool: 'view', args: { path: path.join(root, 'target', 'a.txt') } }, { text: 'done' });
    await turn(adapter, root, 'Analyse');
    await adapter.dispose();
    const ran = fs.existsSync(marker);
    fs.rmSync(hookHome, { recursive: true, force: true });
    assert.equal(ran, true, 'the user hook did not run: managed hooks in the home would be skipped');
  });

  it('with no login the session is refused with one sentence, and nothing is sent', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-nologin-'));
    const env = runtimeEnv({ COPILOT_HOME: empty, GH_CONFIG_DIR: path.join(empty, 'gh'), HOME: empty, USERPROFILE: empty, PATH: path.dirname(execPathOfGitless()), Path: path.dirname(execPathOfGitless()) });
    const adapter = new CopilotSdkAdapter({ policy: COPILOT_REVIEW_POLICY, env });
    await assert.rejects(adapter.startSession({ provider: 'copilot', modelRequested: 'x', workspacePath: root }), (error: Error) => error.message === copilotNotSignedInText());
    await adapter.dispose();
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

/** A folder for PATH with no `gh` in it, so the runtime's GitHub CLI fallback finds nothing. */
function execPathOfGitless(): string {
  return process.platform === 'win32' ? execFileSync('cmd.exe', ['/c', 'echo %SystemRoot%\\System32\\cmd.exe'], { encoding: 'utf8' }).trim() : '/usr/bin/env';
}
