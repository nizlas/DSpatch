/**
 * Claude's own shell tools under DSpatch's permission policy and hooks (DSP-146),
 * through the real `ClaudeAgentSdkAdapter` on a substituted SDK: `queryFn` and
 * `spawnProcess` are test doubles, so nothing loads `@anthropic-ai/claude-agent-sdk`,
 * nothing reaches a provider and no Claude profile is read. The substituted SDK runs the
 * scripted `Bash` calls as real, harmless commands in scratch folders this file creates,
 * and calls the hooks the way Claude Code's documentation describes
 * (`support/claude-loop-sdk.ts`, `simulatedShell`).
 *
 * SIMULATED model and SIMULATED Claude Code: the scripted turns show what DSpatch does
 * with what the hooks report - what is passed, what is recorded, what the review gets and
 * what a cancel leaves. They are not evidence that Claude chooses these calls or that the
 * real Claude Code reports them exactly this way; that needs a live trial.
 *
 *     node scripts/run-tests.mjs provider        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  CHAT_PERMISSIONS,
  ClaudeAgentSdkAdapter,
  type ClaudePermissionPolicy,
  describePermissionPolicy,
  FOREGROUND_ONLY_ENV,
  REVIEW_DENY_REASON,
  REVIEW_PERMISSIONS,
  SHELL_COMMAND_CANCELLED_NOTE,
  SHELL_COMMAND_UNREPORTED_NOTE,
  SHELL_FAILURE_OUTPUT_NOTE,
  SHELL_SUCCESS_EXIT_NOTE,
  SHELL_TOOLS,
  shellCommandEnd,
} from '../src/adapter/claude-agent-sdk-adapter.ts';
import type { AgentEvent } from '../src/adapter/types.ts';
import { adapters, claudeSdk, CLEAN_ENV, type ScriptStep } from './support/claude-loop-sdk.ts';
import { killLeftovers, sleepingTreeCommand, treePids } from './support/command-tree.ts';
import { tempRoot } from './support/fixtures.ts';

const node = `"${process.execPath}"`;

function project(name: string): string {
  const dir = tempRoot(`shell-${name}`);
  fs.writeFileSync(path.join(dir, 'README.md'), '# a project\n', 'utf8');
  return dir;
}

/** One scripted turn through a fresh adapter; resolves with every event of it. */
async function turn(
  workspace: string,
  steps: readonly ScriptStep[],
  options: {
    readonly permissions?: ClaudePermissionPolicy;
    readonly whileRunning?: (adapter: ClaudeAgentSdkAdapter, sessionId: string) => Promise<void>;
  } = {},
) {
  const sdk = claudeSdk([{ kind: 'script', steps, text: 'Done: I ran the tests.' }]);
  const adapter = new ClaudeAgentSdkAdapter({
    queryFn: sdk.queryFn,
    spawnProcess: sdk.spawnProcess,
    env: CLEAN_ENV,
    permissions: options.permissions ?? CHAT_PERMISSIONS,
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
  return { adapter, sdk, events, sessionId: handle.dspatchSessionId };
}

function finishedCommands(events: readonly AgentEvent[]) {
  return events.flatMap((event) => (event.type === 'command.finished' ? [event] : []));
}

describe('the chat gets Claude Code\'s own shell tools; the review gets none', () => {
  it('a chat turn offers and pre-approves Bash and PowerShell, with no MCP server, background tasks off and the post-tool hooks', async () => {
    const { sdk, adapter } = await turn(project('options'), []);
    const options = sdk.queries[0]?.options ?? {};
    for (const shell of SHELL_TOOLS) {
      assert.ok((options['tools'] as string[]).includes(shell), `${shell} offered`);
      assert.ok((options['allowedTools'] as string[]).includes(shell), `${shell} pre-approved`);
    }
    assert.equal(options['mcpServers'], undefined, 'DSpatch passes no MCP server of its own');
    assert.equal(options['strictMcpConfig'], true);
    assert.equal(options['permissionMode'], 'dontAsk', 'no per-command confirmation');
    assert.equal(options['env']?.['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'], FOREGROUND_ONLY_ENV['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS']);
    assert.equal(options['env']?.['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'], '1');
    assert.equal(options['hooks']?.PostToolUse?.length, 1);
    assert.equal(options['hooks']?.PostToolUseFailure?.length, 1);
    const text = describePermissionPolicy(CHAT_PERMISSIONS);
    assert.match(text, /Claude Code's own Bash and PowerShell tools, in the foreground only/);
    assert.match(text, /does not start or sandbox it/);
    assert.doesNotMatch(text, /mcp__dspatch/);
    await adapter.dispose();
  });

  it('the factory gives the review the review policy; a review turn that calls Bash is denied, nothing runs and nothing is recorded', async () => {
    const workspace = project('review');
    const sdk = claudeSdk([
      {
        kind: 'script',
        steps: [{ tool: 'Bash', input: { command: `${node} -e "require('fs').writeFileSync('ran.txt','x')"` } }],
        text: 'I could not run anything.',
      },
    ]);
    const { factory, built } = adapters(sdk);
    const review = factory.createAdapter({ provider: 'claude', purpose: 'review' }) as unknown as ClaudeAgentSdkAdapter;
    assert.equal(built.claudePermissions[0], REVIEW_PERMISSIONS);
    const handle = await review.startSession({ provider: 'claude', modelRequested: '', workspacePath: workspace });
    const events: AgentEvent[] = [];
    const done = new Promise<void>((resolve) => {
      review.subscribe(handle.dspatchSessionId, (event) => {
        events.push(event);
        if (event.type === 'run.finished') resolve();
      });
    });
    await review.send(handle.dspatchSessionId, 'Run the tests.');
    await done;
    const options = sdk.queries[0]?.options ?? {};
    assert.deepEqual(options['tools'], []);
    assert.ok((options['disallowedTools'] as string[]).includes('Bash'));
    assert.ok((options['disallowedTools'] as string[]).includes('PowerShell'));
    assert.equal(options['hooks']?.PostToolUse, undefined, 'no command recording hooks for the review');
    const outcome = sdk.queries[0]?.toolOutcomes[0];
    assert.equal(outcome?.how, 'denied');
    assert.equal(outcome?.text, REVIEW_DENY_REASON, 'the deny-all hook still applies');
    assert.equal(fs.existsSync(path.join(workspace, 'ran.txt')), false);
    assert.equal(events.some((event) => event.type === 'command.started' || event.type === 'command.finished'), false);
    assert.match(describePermissionPolicy(REVIEW_PERMISSIONS), /^no tools; nothing pre-approved/);
    assert.doesNotMatch(describePermissionPolicy(REVIEW_PERMISSIONS), /Bash and PowerShell tools/);
    await review.dispose();
  });
});

describe('a conversation recorded under DSpatch\'s former command tool', () => {
  it('is refused on resume by the tool-policy check, saying the tools changed and to start a new session', async () => {
    const before = new ClaudeAgentSdkAdapter({
      queryFn: claudeSdk([]).queryFn,
      env: CLEAN_ENV,
      // The chat policy as DSP-145 left it: DSpatch's command tool, no Bash.
      permissions: Object.freeze({
        tools: Object.freeze(['Read', 'Glob', 'Grep', 'Edit', 'Write']),
        allowedTools: Object.freeze(['Read(/**)', 'Edit(/**)', 'mcp__dspatch__run_command']),
        permissionMode: 'dontAsk',
        settingSources: Object.freeze([]) as readonly [],
        strictMcpConfig: true,
        commandTool: true,
      }) as unknown as ClaudePermissionPolicy,
    });
    const now = new ClaudeAgentSdkAdapter({
      queryFn: claudeSdk([]).queryFn,
      localLookup: () => Promise.reject(new Error('not asked')),
      env: CLEAN_ENV,
      permissions: CHAT_PERMISSIONS,
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

describe('a command the agent runs with Bash', () => {
  it('a failing command goes back to the same agent as its tool result; it fixes and reruns in the same turn; both are recorded from the hooks', async () => {
    const workspace = project('failing');
    fs.writeFileSync(path.join(workspace, 'check.cjs'), "console.log('1 failing'); process.exit(1);\n", 'utf8');
    const { sdk, events, adapter, sessionId } = await turn(workspace, [
      { tool: 'Bash', input: { command: `${node} check.cjs`, timeout: 60_000 } },
      {
        act: () => {
          fs.writeFileSync(path.join(workspace, 'check.cjs'), "console.log('all passing');\n", 'utf8');
        },
      },
      { tool: 'Bash', input: { command: `${node} check.cjs` } },
    ]);
    const outcomes = sdk.queries[0]?.toolOutcomes ?? [];
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0]?.isError, true, 'Claude Code returns a failing command as a tool error to the agent');
    assert.match(outcomes[0]?.text ?? '', /^Exit code 1\n/);
    assert.equal(outcomes[1]?.isError, false);
    assert.deepEqual(
      sdk.queries[0]?.hookCalls.filter((call) => call.tool === 'Bash').map((call) => call.event),
      ['PreToolUse', 'PostToolUseFailure', 'PreToolUse', 'PostToolUse'],
    );

    const records = finishedCommands(events);
    assert.equal(records.length, 2);
    const [failed, passed] = records;
    assert.equal(failed?.command.requestedBy, 'provider-reported', 'DSpatch did not start it');
    assert.equal(failed?.command.ending, 'exited');
    assert.equal(failed?.command.exitCode, 1);
    assert.match(failed?.command.stdout ?? '', /1 failing/);
    assert.equal(failed?.command.outputNote, SHELL_FAILURE_OUTPUT_NOTE);
    assert.equal(failed?.command.cwd, workspace);
    assert.equal(failed?.command.timeoutMs, 60_000, 'the timeout the agent asked for');
    assert.equal(failed?.command.shell, 'Claude Code Bash tool');
    assert.equal(failed?.command.killedByDspatch, false);
    assert.equal(failed?.command.pid, null);
    assert.equal(failed?.toolCallId, 'toolu_0_1', 'matched to the tool call by the hook\'s tool_use_id');
    assert.equal(passed?.command.exitCode, 0);
    assert.equal(passed?.command.outputNote, SHELL_SUCCESS_EXIT_NOTE, 'exit 0 is said to be DSpatch\'s reading');
    assert.match(passed?.command.stdout ?? '', /all passing/);

    const types = events.map((event) => event.type);
    assert.ok(types.indexOf('command.started') < types.indexOf('command.finished'));
    assert.ok(types.lastIndexOf('command.finished') < types.indexOf('run.finished'));
    const end = events.at(-1);
    assert.ok(end?.type === 'run.finished' && end.status === 'finished', 'one turn: the failure did not end it');
    assert.equal(adapter.commandRecords(sessionId).length, 2);
    await adapter.dispose();
  });

  it('a command a permission rule refuses after the hook let it through is recorded at the turn\'s end as not reported', async () => {
    const workspace = project('refused');
    const { sdk, events, adapter } = await turn(
      workspace,
      [{ tool: 'Bash', input: { command: `${node} -e "require('fs').writeFileSync('ran.txt','x')"` } }],
      {
        permissions: Object.freeze({
          ...CHAT_PERMISSIONS,
          allowedTools: Object.freeze(['Read(/**)', 'Edit(/**)']),
        }) as ClaudePermissionPolicy,
      },
    );
    assert.equal(sdk.queries[0]?.toolOutcomes[0]?.how, 'denied');
    assert.equal(fs.existsSync(path.join(workspace, 'ran.txt')), false);
    const records = finishedCommands(events);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.command.ending, 'not-reported');
    assert.equal(records[0]?.command.endingMessage, SHELL_COMMAND_UNREPORTED_NOTE);
    assert.equal(records[0]?.command.exitCode, null);
    await adapter.dispose();
  });

  it('Cancel interrupts a running command; DSpatch records it as stopped and does not claim its processes ended', async () => {
    const workspace = project('cancel');
    let pids: { parent: number; child: number } | null = null;
    try {
      const { events, sdk, adapter } = await turn(
        workspace,
        [{ tool: 'Bash', input: { command: sleepingTreeCommand(workspace) } }],
        {
          whileRunning: async (running, sessionId) => {
            pids = await treePids(workspace);
            await running.cancel(sessionId);
          },
        },
      );
      assert.equal(sdk.queries[0]?.interrupts, 1);
      assert.equal(sdk.queries[0]?.toolOutcomes[0]?.how, 'interrupted');
      assert.equal(
        sdk.queries[0]?.hookCalls.some((call) => call.event !== 'PreToolUse'),
        false,
        'no post-tool hook fires for a cancelled tool (as documented)',
      );
      const records = finishedCommands(events);
      assert.equal(records.length, 1, 'recorded although Claude Code reported no end');
      const record = records[0]?.command;
      assert.equal(record?.ending, 'stopped');
      assert.equal(record?.killedByDspatch, false);
      assert.equal(record?.endingMessage, SHELL_COMMAND_CANCELLED_NOTE);
      assert.match(record?.endingMessage ?? '', /is not established by DSpatch/);
      const types = events.map((event) => event.type);
      assert.ok(types.indexOf('command.finished') < types.indexOf('run.finished'));
      const end = events.at(-1);
      assert.ok(end?.type === 'run.finished' && end.status === 'cancelled');
      await adapter.dispose();
    } finally {
      const p = pids as { parent: number; child: number } | null;
      if (p !== null) {
        killLeftovers([p.parent, p.child]);
      }
    }
  });
});

describe('how a shell command ended, from the hook input', () => {
  it('reads the documented shapes and calls anything else not reported', () => {
    assert.deepEqual(
      shellCommandEnd({ tool_response: { stdout: 'ok\n', stderr: '', interrupted: false }, duration_ms: 12 }, 'succeeded'),
      { ending: 'exited', endingMessage: null, exitCode: 0, stdout: 'ok\n', stderr: '', outputNote: SHELL_SUCCESS_EXIT_NOTE, durationMs: 12 },
    );
    const benign = shellCommandEnd(
      { tool_response: { stdout: '', stderr: '', interrupted: false, returnCodeInterpretation: 'No matches found' } },
      'succeeded',
    );
    assert.equal(benign.exitCode, null, 'a benign non-zero exit is not read as 0');
    assert.match(benign.outputNote ?? '', /No matches found/);
    assert.equal(shellCommandEnd({ tool_response: { stdout: '', stderr: '', interrupted: true } }, 'succeeded').ending, 'stopped');
    const exited = shellCommandEnd({ error: 'Exit code 2\nboom' }, 'failed');
    assert.equal(exited.ending, 'exited');
    assert.equal(exited.exitCode, 2);
    assert.equal(exited.stdout, 'boom');
    assert.equal(shellCommandEnd({ error: 'Interrupted', is_interrupt: true }, 'failed').ending, 'stopped');
    const unknown = shellCommandEnd({ error: 'Command timed out after 2m' }, 'failed');
    assert.equal(unknown.ending, 'not-reported');
    assert.equal(unknown.exitCode, null);
    assert.match(unknown.endingMessage ?? '', /without an exit code: Command timed out after 2m/);
  });
});
