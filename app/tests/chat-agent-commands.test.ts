/**
 * The main chat with Claude running its own tests through DSpatch's command tool
 * (DSP-145): the chat service's real send path, the real `ClaudeAgentSdkAdapter` on a
 * substituted SDK, DSpatch's real command runner, and a small repository this file
 * generates with a real failing test.
 *
 * SIMULATED model: the turn is scripted - read, run the tests, edit, run them again,
 * report - and the scripted Read and Edit are this file acting on the folder. What is
 * real is everything DSpatch does: the commands run (`npm test`, which is `node --test`
 * here), their exit codes, the records, the snapshots, the freshness, the saved
 * conversation and the refusal of a second command. Whether Claude itself would choose
 * these steps is for a live trial.
 *
 *     node scripts/run-tests.mjs chat        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { CHAT_PERMISSIONS, ClaudeAgentSdkAdapter, COMMAND_TOOL_ID } from '../src/adapter/claude-agent-sdk-adapter.ts';
import { ChatService, storedCommandRecord } from '../src/main/chat-service.ts';
import { ConversationStore } from '../src/main/conversation-store.ts';
import { createAgentCommandRunner, WorkspaceCommandSlots } from '../src/main/workspace-command.ts';
import type { UiAgentEvent } from '../src/shared/bridge.ts';
import { claudeSdk, CLEAN_ENV, type ScriptStep } from './support/claude-loop-sdk.ts';
import { setEnvironment, tempRoot } from './support/fixtures.ts';

/** A tiny project with a real bug and a real test that catches it. Names live only here. */
function buggyProject(root: string): string {
  const project = path.join(root, 'sum-project');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(path.join(project, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ name: 'sum-project', version: '1.0.0', private: true, scripts: { test: 'node --test' } }, null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(project, 'src', 'sum.js'), 'exports.sum = (a, b) => a - b;\n', 'utf8');
  fs.writeFileSync(
    path.join(project, 'test', 'sum.test.js'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert');",
      "const { sum } = require('../src/sum.js');",
      "test('adds', () => { assert.strictEqual(sum(2, 3), 5); });",
      '',
    ].join('\n'),
    'utf8',
  );
  return project;
}

function harness(
  name: string,
  stepsFor: (workspace: string) => readonly ScriptStep[],
  text: string,
  log: (message: string) => void = () => undefined,
) {
  const root = tempRoot(`chat-agent-commands-${name}`);
  const workspace = buggyProject(root);
  const steps = stepsFor(workspace);
  const store = new ConversationStore(path.join(root, 'userdata', 'conversations'));
  const slots = new WorkspaceCommandSlots();
  const sdk = claudeSdk([{ kind: 'script', steps, text }]);
  const sent: UiAgentEvent[] = [];
  const service = new ChatService({
    repoRoot: path.join(root, 'repo-root'),
    sampleProjectsRoot: path.join(root, 'samples'),
    send: (event) => {
      sent.push(event);
    },
    log,
    conversations: () => store,
    readAuthStatus: () => Promise.resolve({ status: 'logged-in', backendUrl: 'https://example.invalid' }),
    claudeAuthorizationReference: 'test-only reference',
    agentChoiceStore: { read: () => 'claude', write: () => undefined },
    claudeSupport: { installed: true, reason: null },
    commandSlots: slots,
    createAdapter: (provider) => {
      assert.equal(provider, 'claude', 'no Cursor adapter in this test');
      return new ClaudeAgentSdkAdapter({
        queryFn: sdk.queryFn,
        spawnProcess: sdk.spawnProcess,
        env: CLEAN_ENV,
        permissions: CHAT_PERMISSIONS,
        commandRunner: createAgentCommandRunner({ slots, timeoutMs: 120_000 }),
        mcpTools: sdk.mcpTools,
      });
    },
    timings: { cancelConfirmMs: 40, cancelWatchMs: 60 },
  });
  return { service, workspace, store, sdk, sent, slots };
}

async function settled(service: ChatService, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const attempts = service.getRunState().attempts;
    if (attempts.length > 0 && attempts.every((attempt) => attempt.state === 'completed')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('the turn did not complete');
}

test('SIMULATED model, real commands: read, a failing test, a fix, a passing test, a report - recorded, current, saved', async () => {
  // This file's own test process sets NODE_TEST_CONTEXT, which a `node --test` started
  // from it would inherit, and then skip its files. DSpatch itself never sets it.
  setEnvironment({ NODE_TEST_CONTEXT: undefined });
  const h = harness(
    'chain',
    (workspace) => [
      {
        // The scripted model's Read: it looks at the test before running it.
        act: () => {
          assert.match(fs.readFileSync(path.join(workspace, 'test', 'sum.test.js'), 'utf8'), /sum\(2, 3\), 5/);
        },
      },
      { tool: COMMAND_TOOL_ID, input: { command: 'npm test' } },
      {
        // The scripted model's Edit: the fix.
        act: () => {
          fs.writeFileSync(path.join(workspace, 'src', 'sum.js'), 'exports.sum = (a, b) => a + b;\n', 'utf8');
        },
      },
      { tool: COMMAND_TOOL_ID, input: { command: 'npm test' } },
    ],
    'Fixed `sum` to add; `npm test` now passes (it failed before the fix).',
  );
  const session = await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  assert.equal(session.provider, 'claude');
  assert.match(session.context.toolPolicySent, /mcp__dspatch__run_command/);

  await h.service.sendPrompt('The sum test fails. Fix it and check that the tests pass.');
  await settled(h.service);

  // What the model got back: a failure it can read, then a pass.
  const outcomes = h.sdk.queries[0]?.toolOutcomes ?? [];
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]?.isError, false, 'a failing test is an ordinary result');
  assert.match(outcomes[0]?.text ?? '', /Exit code 1/);
  assert.match(outcomes[0]?.text ?? '', /fail 1|not ok/);
  assert.match(outcomes[1]?.text ?? '', /Exit code 0/);

  // What DSpatch recorded, and whether each still describes the code on disk.
  const report = h.service.getAgentCommands();
  assert.equal(report.commands.length, 2);
  const [first, second] = report.commands;
  assert.equal(first?.record.exitCode, 1);
  assert.equal(second?.record.exitCode, 0);
  assert.equal(first?.record.cwd, h.workspace);
  assert.notEqual(first?.record.afterRunSnapshotId, second?.record.testedSnapshotId, 'the fix is between them');
  assert.equal(first?.standing, 'stale', 'the failure describes code that has since changed');
  assert.equal(second?.standing, 'current', 'the pass describes the code on disk now');

  // The transcript gets readable action lines, not the tool's internal name.
  const lines = h.sent.filter((event) => event.type === 'command.finished').map((event) => event.command);
  assert.deepEqual(
    lines.map((line) => [line?.line, line?.ending, line?.exitCode]),
    [
      ['npm test', 'exited', 1],
      ['npm test', 'exited', 0],
    ],
  );

  // And the records are saved with the message, for the next window.
  const conversationId = h.service.currentConversationId();
  assert.ok(conversationId !== null);
  const saved = h.store.read(conversationId).conversation;
  const message = saved?.messages.at(-1);
  assert.equal(message?.commands?.length, 2);
  assert.equal(message?.commands?.[1]?.exitCode, 0);
  assert.match(message?.answer ?? '', /now passes/);
  await h.service.dispose();
});

test('the Run button is refused with a plain sentence while the agent\'s command runs', async () => {
  let refusal: unknown = null;
  const h = harness(
    'busy',
    () => [{ tool: COMMAND_TOOL_ID, input: { command: `"${process.execPath}" -e "setTimeout(() => {}, 1500)"` } }],
    'Ran it.',
  );
  await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  await h.service.sendPrompt('Run a slow command.');
  const deadline = Date.now() + 20_000;
  while (h.slots.holderOf(h.workspace) === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(h.slots.holderOf(h.workspace)?.by, 'agent');
  try {
    await h.service.runWorkspaceTest({ command: 'npm test', cwd: '' });
  } catch (error) {
    refusal = error;
  }
  assert.match(String(refusal), /The agent is running a command in this working copy/);
  await settled(h.service);
  assert.equal(h.slots.holderOf(h.workspace), null, 'free again once the agent\'s command ended');
  await h.service.dispose();
});

test('R2: a Run that throws after taking the working copy gives it back, so the agent can still run', async () => {
  // A log that throws once the command has started: the step after the slot is taken.
  const h = harness(
    'run-throws',
    () => [{ tool: COMMAND_TOOL_ID, input: { command: `"${process.execPath}" -e "0"` } }],
    'Ran it.',
    (message) => {
      if (/: running `/.test(message)) {
        throw new Error('a stub that fails after the slot was taken');
      }
    },
  );
  await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  await assert.rejects(
    h.service.runWorkspaceTest({ command: `"${process.execPath}" -e "0"`, cwd: '' }),
    /a stub that fails after the slot was taken/,
  );
  assert.equal(h.slots.holderOf(h.workspace), null, 'the slot was given back');
  // The agent's runner, on the same slots, is not refused.
  const record = await createAgentCommandRunner({ slots: h.slots, timeoutMs: 60_000 }).run({
    line: `"${process.execPath}" -e "0"`,
    cwd: h.workspace,
    workspacePaths: [h.workspace],
    signal: new AbortController().signal,
    dspatchSessionId: 's',
    dspatchRunId: 'r',
    commandId: 'c',
  });
  assert.equal(record.ending, 'exited', record.endingMessage ?? '');
  assert.equal(record.exitCode, 0);
  await h.service.dispose();
});

test('I1: a conversation keeps the end of a long output, within the run record bound, and says what it left out', () => {
  const long = `${'x'.repeat(20_000)}THE-END`;
  const kept = storedCommandRecord({
    commandId: 'c',
    requestedBy: 'agent-tool',
    line: 'npm test',
    shell: 'sh -c',
    cwd: '/p',
    pid: 1,
    startedAtUtc: '2026-10-27T00:00:00Z',
    finishedAtUtc: '2026-10-27T00:00:01Z',
    durationMs: 1000,
    timeoutMs: 600_000,
    ending: 'exited',
    endingMessage: null,
    exitCode: 1,
    signal: null,
    killedByDspatch: false,
    stdout: long,
    stderr: 'short',
    outputTruncated: false,
    outputNote: null,
    testedSnapshotId: 'a',
    afterRunSnapshotId: 'b',
    snapshotRoots: ['/p'],
  });
  assert.equal(kept.stdout.length, 16_000);
  assert.ok(kept.stdout.endsWith('THE-END'));
  assert.equal(kept.stderr, 'short');
  assert.equal(kept.outputTruncated, true);
  assert.match(kept.outputNote ?? '', /4007 characters of standard output and 0 of standard error were left out/);
});
