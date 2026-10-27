/**
 * DSpatch's command tool for Claude (DSP-145), through the real `ClaudeAgentSdkAdapter`
 * on a substituted SDK: `queryFn`, `spawnProcess` and the SDK's in-process MCP functions
 * (`mcpTools`) are test doubles, so nothing loads `@anthropic-ai/claude-agent-sdk`,
 * nothing reaches a provider and no Claude profile is read. The commands the scripted
 * model asks for are real and harmless, in scratch folders this file creates, run by
 * DSpatch's real command runner.
 *
 * SIMULATED model: the scripted turns show what DSpatch does with a tool call - where it
 * runs, what is recorded, what comes back, what is refused and what a cancel stops. They
 * are not evidence that Claude chooses these calls, or that the real SDK delivers them
 * this way; that needs a live trial.
 *
 *     node scripts/run-tests.mjs provider        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { AgentCommandRequest, AgentCommandRunner } from '../src/adapter/agent-adapter.ts';
import {
  CHAT_PERMISSIONS,
  ClaudeAgentSdkAdapter,
  COMMAND_TOOL_DESCRIPTION,
  COMMAND_TOOL_ID,
  describePermissionPolicy,
  FIXTURE_PERMISSIONS,
  REVIEW_DENY_REASON,
  REVIEW_PERMISSIONS,
} from '../src/adapter/claude-agent-sdk-adapter.ts';
import type { AgentEvent } from '../src/adapter/types.ts';
import { createAgentCommandRunner, WorkspaceCommandSlots } from '../src/main/workspace-command.ts';
import { adapters, claudeSdk, CLEAN_ENV, type ScriptStep } from './support/claude-loop-sdk.ts';
import { killLeftovers, sleepingTreeCommand, treePids, waitGone } from './support/command-tree.ts';
import { tempRoot } from './support/fixtures.ts';

const node = `"${process.execPath}"`;

/** DSpatch's real runner, counted, with slots of its own so tests cannot collide. */
function countedRunner(timeoutMs = 60_000) {
  const real = createAgentCommandRunner({ slots: new WorkspaceCommandSlots(), timeoutMs });
  const requests: AgentCommandRequest[] = [];
  const runner: AgentCommandRunner = {
    timeoutMs: real.timeoutMs,
    shell: real.shell,
    run: (request) => {
      requests.push(request);
      return real.run(request);
    },
  };
  return { runner, requests };
}

function project(name: string): string {
  const dir = tempRoot(`cmdtool-${name}`);
  fs.writeFileSync(path.join(dir, 'README.md'), '# a project\n', 'utf8');
  return dir;
}

/** One scripted turn through a fresh chat adapter; resolves with every event of it. */
async function turn(
  workspace: string,
  steps: readonly ScriptStep[],
  options: { readonly runner?: AgentCommandRunner; readonly whileRunning?: (adapter: ClaudeAgentSdkAdapter, sessionId: string) => Promise<void> } = {},
) {
  const sdk = claudeSdk([{ kind: 'script', steps, text: 'Done: I ran the tests.' }]);
  const counted = countedRunner();
  const runner = options.runner ?? counted.runner;
  const adapter = new ClaudeAgentSdkAdapter({
    queryFn: sdk.queryFn,
    spawnProcess: sdk.spawnProcess,
    env: CLEAN_ENV,
    permissions: CHAT_PERMISSIONS,
    commandRunner: runner,
    mcpTools: sdk.mcpTools,
  });
  const handle = await adapter.startSession({ provider: 'claude', modelRequested: 'claude-test', workspacePath: workspace });
  const events: AgentEvent[] = [];
  const finished = new Promise<void>((resolve) => {
    adapter.subscribe(handle.dspatchSessionId, (event) => {
      events.push(event);
      if (event.type === 'run.finished') {
        resolve();
      }
    });
  });
  await adapter.send(handle.dspatchSessionId, 'Fix the failing test.');
  await options.whileRunning?.(adapter, handle.dspatchSessionId);
  await finished;
  return { adapter, sdk, events, sessionId: handle.dspatchSessionId, requests: counted.requests };
}

describe('the command tool is offered to the chat and never to the review', () => {
  it('a chat turn gets DSpatch\'s server and the pre-approved tool, described with shell, folder and bound', async () => {
    const workspace = project('options');
    const { sdk, adapter } = await turn(workspace, []);
    const options = sdk.queries[0]?.options ?? {};
    assert.ok((options['allowedTools'] as string[]).includes(COMMAND_TOOL_ID));
    assert.deepEqual(Object.keys(options['mcpServers'] ?? {}), ['dspatch']);
    assert.equal(options['strictMcpConfig'], true, 'still no MCP server DSpatch did not pass');
    assert.ok(!(options['tools'] as string[]).includes('Bash'), 'no agent shell');
    const server = sdk.mcpServers[0];
    assert.ok(server !== undefined);
    assert.equal(server.options['alwaysLoad'], true);
    assert.equal(server.options['timeout'], 60_000 + 60_000, 'the SDK waits longer than the runner\'s own bound');
    const tool = server.instance.tools[0];
    assert.equal(tool?.name, 'run_command');
    assert.ok(tool?.description.startsWith(COMMAND_TOOL_DESCRIPTION));
    assert.match(tool?.description ?? '', /Shell: .+\. Working folder: .+\. Time bound: 1 minute per command\./);
    assert.ok(tool?.description.includes(workspace));
    assert.match(tool?.description ?? '', /not a sandbox/);
    assert.match(describePermissionPolicy(CHAT_PERMISSIONS), /DSpatch's own command tool, mcp__dspatch__run_command/);
    assert.match(describePermissionPolicy(CHAT_PERMISSIONS), /no settings read from disk other than managed policy settings/);
    await adapter.dispose();
  });

  it('a review turn has no MCP server and no command tool', async () => {
    const sdk = claudeSdk([{ kind: 'answer', text: 'text only' }]);
    const adapter = new ClaudeAgentSdkAdapter({
      queryFn: sdk.queryFn,
      spawnProcess: sdk.spawnProcess,
      env: CLEAN_ENV,
      permissions: REVIEW_PERMISSIONS,
      mcpTools: sdk.mcpTools,
    });
    const handle = await adapter.startSession({ provider: 'claude', modelRequested: '', workspacePath: project('review-options') });
    const done = new Promise<void>((resolve) => {
      adapter.subscribe(handle.dspatchSessionId, (event) => {
        if (event.type === 'run.finished') resolve();
      });
    });
    await adapter.send(handle.dspatchSessionId, 'Explain this change.');
    await done;
    const options = sdk.queries[0]?.options ?? {};
    assert.equal(options['mcpServers'], undefined);
    assert.ok(!(options['allowedTools'] as string[]).includes(COMMAND_TOOL_ID));
    assert.equal(sdk.mcpServers.length, 0);
    await adapter.dispose();
  });

  it('a runner is refused with the review policy, or with any policy that does not offer the tool', () => {
    const { runner } = countedRunner();
    assert.throws(
      () => new ClaudeAgentSdkAdapter({ queryFn: claudeSdk([]).queryFn, env: CLEAN_ENV, permissions: REVIEW_PERMISSIONS, commandRunner: runner }),
      /does not offer the command tool \(commandTool\) or that denies every tool/,
    );
    assert.throws(
      () => new ClaudeAgentSdkAdapter({ queryFn: claudeSdk([]).queryFn, env: CLEAN_ENV, permissions: FIXTURE_PERMISSIONS, commandRunner: runner }),
      /does not offer the command tool/,
    );
  });

  it('the factory gives chat and loop a runner and the review none; a review turn that calls the tool is denied and nothing runs', async () => {
    const sdk = claudeSdk([
      {
        kind: 'script',
        steps: [{ tool: COMMAND_TOOL_ID, input: { command: `${node} -e "require('fs').writeFileSync('ran.txt','x')"` } }],
        text: 'I could not run anything.',
      },
    ]);
    const counted = countedRunner();
    const { factory, built } = adapters(sdk, { commandRunner: () => counted.runner });
    factory.createAdapter({ provider: 'claude', purpose: 'chat' });
    factory.createAdapter({ provider: 'claude', purpose: 'loop' });
    const review = factory.createAdapter({ provider: 'claude', purpose: 'review' }) as unknown as ClaudeAgentSdkAdapter;
    assert.equal(built.commandRunners[0], counted.runner, 'chat');
    assert.equal(built.commandRunners[1], counted.runner, 'loop');
    assert.equal(built.commandRunners[2], undefined, 'review');

    const workspace = project('review-call');
    const handle = await review.startSession({ provider: 'claude', modelRequested: '', workspacePath: workspace });
    const done = new Promise<void>((resolve) => {
      review.subscribe(handle.dspatchSessionId, (event) => {
        if (event.type === 'run.finished') resolve();
      });
    });
    await review.send(handle.dspatchSessionId, 'Run the tests.');
    await done;
    const outcome = sdk.queries[0]?.toolOutcomes[0];
    assert.equal(outcome?.how, 'denied');
    assert.equal(outcome?.text, REVIEW_DENY_REASON, 'the deny-all hook still applies');
    assert.equal(counted.requests.length, 0, 'the runner was never called');
    assert.equal(fs.existsSync(path.join(workspace, 'ran.txt')), false);
    await review.dispose();
  });
});

describe('a conversation recorded before the command tool', () => {
  it('is refused on resume by the tool-policy check, saying the tools changed and to start a new session', async () => {
    const before = new ClaudeAgentSdkAdapter({
      queryFn: claudeSdk([]).queryFn,
      env: CLEAN_ENV,
      // The chat policy as it was before DSP-145: no command tool.
      permissions: Object.freeze({
        tools: Object.freeze(['Read', 'Glob', 'Grep', 'Edit', 'Write']),
        allowedTools: Object.freeze(['Read(/**)', 'Edit(/**)']),
        permissionMode: 'dontAsk',
        settingSources: Object.freeze([]) as readonly [],
        strictMcpConfig: true,
      }) as typeof CHAT_PERMISSIONS,
    });
    const now = new ClaudeAgentSdkAdapter({
      queryFn: claudeSdk([]).queryFn,
      localLookup: () => Promise.reject(new Error('not asked')),
      env: CLEAN_ENV,
      permissions: CHAT_PERMISSIONS,
      commandRunner: countedRunner().runner,
    });
    assert.notEqual(before.policyDigest(), now.policyDigest());
    await assert.rejects(
      now.resume('dsp-session-old', {
        provider: 'claude',
        modelRequested: '',
        workspacePath: project('resume'),
        expectedToolPolicy: before.policyDigest(),
      }),
      (error: { message: string; providerCode?: string }) => {
        assert.equal(error.providerCode, 'config_mismatch');
        assert.match(error.message, /The tools DSpatch gives Claude have changed/);
        assert.match(error.message, /Start a new session to continue under the current tool policy/);
        return true;
      },
    );
    await before.dispose();
    await now.dispose();
  });
});

describe('a command the agent runs', () => {
  it('a failing command comes back as an ordinary result with its exit code and output, and is recorded', async () => {
    const workspace = project('failing');
    const { sdk, events, adapter, sessionId } = await turn(workspace, [
      { tool: COMMAND_TOOL_ID, input: { command: `${node} -e "console.log('1 failing'); process.exit(1)"` } },
    ]);
    const outcome = sdk.queries[0]?.toolOutcomes[0];
    assert.equal(outcome?.how, 'ran');
    assert.equal(outcome?.isError, false, 'a failing test is a result, not a tool error');
    assert.match(outcome?.text ?? '', /Exit code 1 after/);
    assert.match(outcome?.text ?? '', /1 failing/);
    const types = events.map((event) => event.type);
    assert.ok(types.indexOf('command.started') < types.indexOf('command.finished'));
    assert.ok(types.indexOf('command.finished') < types.indexOf('run.finished'));
    const finished = events.find((event) => event.type === 'command.finished');
    assert.ok(finished?.type === 'command.finished');
    assert.equal(finished.command.ending, 'exited');
    assert.equal(finished.command.exitCode, 1);
    assert.equal(finished.command.cwd, workspace);
    assert.equal(finished.command.requestedBy, 'agent-tool');
    assert.ok(finished.command.testedSnapshotId !== null);
    assert.equal(finished.toolCallId, 'toolu_0_1', 'matched to the tool call that asked for it');
    const end = events.at(-1);
    assert.ok(end?.type === 'run.finished' && end.status === 'finished', 'the turn went on to its end');
    assert.equal(adapter.commandRecords(sessionId).length, 1);
    await adapter.dispose();
  });

  it('a command that cannot start comes back as a tool error, and the turn still ends normally', async () => {
    const workspace = project('unstartable');
    const { sdk, events, adapter } = await turn(workspace, [
      { tool: COMMAND_TOOL_ID, input: { command: 'dspatch-no-such-program-145 --version' } },
    ]);
    const outcome = sdk.queries[0]?.toolOutcomes[0];
    assert.equal(outcome?.isError, true);
    assert.match(outcome?.text ?? '', /^Not run\./m);
    const end = events.at(-1);
    assert.ok(end?.type === 'run.finished' && end.status === 'finished');
    await adapter.dispose();
  });

  it('runs one command at a time: a second call while the first runs gets a tool error and starts nothing', async () => {
    const workspace = project('one-at-a-time');
    const { sdk, adapter, requests } = await turn(workspace, [
      { tool: COMMAND_TOOL_ID, input: { command: `${node} -e "setTimeout(() => {}, 600)"` }, concurrentWithNext: true },
      { tool: COMMAND_TOOL_ID, input: { command: `${node} -e "0"` } },
    ]);
    const outcomes = sdk.queries[0]?.toolOutcomes ?? [];
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0]?.isError, false);
    assert.equal(outcomes[1]?.isError, true);
    assert.match(outcomes[1]?.text ?? '', /one command at a time/);
    assert.equal(requests.length, 1, 'the runner was asked once');
    await adapter.dispose();
  });

  it('Cancel stops a running command and its child, and records it even though no tool result ever arrives', async () => {
    const workspace = project('cancel');
    let pids: { parent: number; child: number } | null = null;
    try {
      const { events, sdk, adapter } = await turn(
        workspace,
        [
          { tool: COMMAND_TOOL_ID, input: { command: sleepingTreeCommand(workspace) }, noToolResult: true },
          { untilInterrupted: true },
        ],
        {
          whileRunning: async (running, sessionId) => {
            pids = await treePids(workspace);
            await running.cancel(sessionId);
          },
        },
      );
      const finished = events.find((event) => event.type === 'command.finished');
      assert.ok(finished?.type === 'command.finished', 'recorded from DSpatch\'s own handler');
      assert.equal(finished.command.ending, 'stopped');
      assert.equal(finished.command.killedByDspatch, true);
      assert.equal(finished.command.exitCode, null);
      assert.match(finished.command.endingMessage ?? '', /because you cancelled the run in DSpatch/);
      assert.equal(
        events.filter((event) => event.type === 'tool.finished').length,
        0,
        'the substituted SDK streamed no tool result for it',
      );
      const types = events.map((event) => event.type);
      assert.ok(types.indexOf('command.finished') < types.indexOf('run.finished'));
      const end = events.at(-1);
      assert.ok(end?.type === 'run.finished' && end.status === 'cancelled');
      assert.equal(sdk.queries[0]?.interrupts, 1);
      const p = pids as { parent: number; child: number } | null;
      assert.ok(p !== null);
      assert.deepEqual(await waitGone([p.parent, p.child]), [], 'both processes are gone');
      await adapter.dispose();
    } finally {
      const p = pids as { parent: number; child: number } | null;
      if (p !== null) {
        killLeftovers([p.parent, p.child]);
      }
    }
  });
});
