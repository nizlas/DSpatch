/**
 * The chat loop with agents that run their own builds and tests (DSP-145), through the
 * product's run path: `prepareLoopRun` then `runLiveGraph` on the shipped
 * `dspatch-chat-loop` drawing, in a repository this file generates with a real bug and a
 * real `node --test` suite.
 *
 * Claude is the real `ClaudeAgentSdkAdapter` on a substituted SDK with DSpatch's real
 * command runner: every `npm test` here really runs. Cursor, in its one test, is a
 * scripted stand-in that reports shell events the way Cursor's SDK was measured to. The
 * models are SIMULATED - the scripts choose the steps - so this shows what DSpatch does
 * with the steps (records, evidence, the approval rule, correction rounds, cancel), not
 * that a real model would choose them.
 *
 *     node scripts/run-tests.mjs live        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { ChatAdapter } from '../src/main/chat-service.ts';
import type { AgentEvent, AgentEventListener } from '../src/adapter/types.ts';
import { COMMAND_TOOL_ID } from '../src/adapter/claude-agent-sdk-adapter.ts';
import { createFileRoleResolver } from '../src/main/loop-graph-roles.ts';
import { createLiveExecutor, emptyInspection } from '../src/main/loop-live.ts';
import { createFileResultStore } from '../src/main/loop-result-store.ts';
import { runLoopGraph } from '../src/shared/loop-run.ts';
import { workingRootsFrom } from '../src/shared/working-roots.ts';
import { runLiveGraph } from '../src/main/loop-live-run.ts';
import { prepareLoopRun, type LoopRunAgentRequest } from '../src/main/loop-run-agent.ts';
import { providerAdapters } from '../src/main/provider-adapters.ts';
import { recordedCommandsAtEnd } from '../src/main/run-record-store.ts';
import { createAgentCommandRunner, WorkspaceCommandSlots } from '../src/main/workspace-command.ts';
import type { LoopGraph } from '../src/shared/loop-graph.ts';
import { loadLoopGraph } from '../src/shared/loop-graph-load.ts';
import { describeRunOutcome, runOutcomeFrom } from '../src/shared/loop-record.ts';
import { formatRunJournal } from '../src/shared/loop-run.ts';
import { adapters, claudeSdk, CLEAN_ENV, type ScriptStep, type Turn } from './support/claude-loop-sdk.ts';
import { killLeftovers, sleepingTreeCommand, treePids, waitGone } from './support/command-tree.ts';
import { tempRoot } from './support/fixtures.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const CHAT_LOOP = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json');

/** A `node --test` started inside this test process would see NODE_TEST_CONTEXT and skip. */
let savedContext: string | undefined;
before(() => {
  savedContext = process.env['NODE_TEST_CONTEXT'];
  delete process.env['NODE_TEST_CONTEXT'];
});
after(() => {
  if (savedContext !== undefined) {
    process.env['NODE_TEST_CONTEXT'] = savedContext;
  }
});

function chatLoop(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(CHAT_LOOP, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
  });
  assert.equal(loaded.ok, true, loaded.ok ? '' : JSON.stringify(loaded.findings));
  if (!loaded.ok) {
    throw new Error('unreachable');
  }
  return loaded.graph;
}

/** A tiny project with a real bug and a real test for it. These names live only in tests. */
function buggyProject(name: string): string {
  const project = path.join(tempRoot(`loop-agent-${name}`), 'sum-project');
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

const runTests: ScriptStep = { tool: COMMAND_TOOL_ID, input: { command: 'npm test' } };
const fix = (workspace: string): ScriptStep => ({
  act: () => {
    fs.writeFileSync(path.join(workspace, 'src', 'sum.js'), 'exports.sum = (a, b) => a + b;\n', 'utf8');
  },
});

function request(factory: LoopRunAgentRequest['adapters'], provider: 'claude' | 'cursor' = 'claude'): LoopRunAgentRequest {
  const graph = chatLoop();
  const entryNode = graph.nodes.find((node) => node.id === graph.entry);
  return {
    sessionProvider: provider,
    chosenAgent: null,
    rootCount: 1,
    ...(entryNode === undefined ? {} : { entryNode }),
    cursorModel: 'composer-2',
    adapters: factory,
  };
}

async function walk(
  name: string,
  workspace: string,
  factory: LoopRunAgentRequest['adapters'],
  options: { readonly provider?: 'claude' | 'cursor'; readonly abort?: AbortController } = {},
) {
  const prepared = prepareLoopRun(request(factory, options.provider));
  assert.equal(prepared.ok, true, prepared.ok ? '' : prepared.reason);
  if (!prepared.ok) {
    throw new Error('unreachable');
  }
  return runLiveGraph(chatLoop(), {
    runId: `loop-agent-${name}`,
    repoRoot,
    outDir: null,
    resultsDir: path.join(tempRoot(`loop-agent-${name}-results`), 'results'),
    modelRequested: prepared.modelRequested,
    workspacePath: workspace,
    keepWorkspace: true,
    bindingKind: 'chat-loop',
    ...(options.abort === undefined ? {} : { abortSignal: options.abort.signal }),
    promptFor: (node) => `Mandate: the sum test fails; fix it. This is step "${node.id}".`,
    provider: prepared.provider,
    createAdapter: prepared.createAdapter,
  });
}

/** Claude through the shared factory, with DSpatch's real runner on slots of its own. */
function claude(turns: readonly Turn[]) {
  const sdk = claudeSdk(turns);
  const { factory, built } = adapters(sdk, {
    // As the product builds a loop's runner: no snapshots of its own, because the
    // executor takes them around each command (review I2).
    commandRunner: () =>
      createAgentCommandRunner({ slots: new WorkspaceCommandSlots(), timeoutMs: 120_000, snapshots: false }),
  });
  return { sdk, factory, built };
}

function outcomeOf(delivery: Awaited<ReturnType<typeof walk>>) {
  const commands = recordedCommandsAtEnd(delivery.inspection);
  const outcome = runOutcomeFrom({
    commands,
    status: delivery.result.status,
    cancelled: delivery.inspection.cancelled,
    recordComplete: true,
  });
  return { commands, outcome, text: describeRunOutcome(outcome, { commands }) };
}

describe('the chat loop with Claude running its own tests through DSpatch', () => {
  it('(a) work fails, fixes and passes in one step; check runs the tests itself and the run ends done, not tests-failed', async () => {
    const workspace = buggyProject('a');
    const { sdk, factory, built } = claude([
      {
        kind: 'script',
        steps: [runTests, fix(workspace), runTests],
        text: 'Fixed sum to add. npm test failed before the fix and passes now.\n\nRESULT: succeeded',
      },
      { kind: 'script', steps: [runTests], text: 'I ran npm test: 1 passing.\n\nRESULT: met' },
    ]);
    const delivery = await walk('a', workspace, factory);
    assert.equal(delivery.result.terminalNodeId, 'done', formatRunJournal(delivery.result));
    assert.deepEqual(delivery.result.path, ['work', 'check', 'done']);
    assert.deepEqual(built.cursorPolicies, [], 'Cursor was never constructed');

    // Inside the work step a failure was a tool result, and the step went on.
    const work = sdk.queries[0]?.toolOutcomes ?? [];
    assert.deepEqual(work.map((outcome) => [outcome.isError, /Exit code (\d)/.exec(outcome.text)?.[1]]), [
      [false, '1'],
      [false, '0'],
    ]);

    // Every command is recorded, per step, as the agent's, with snapshots.
    const recorded = delivery.inspection.commands;
    assert.deepEqual(
      recorded.map((command) => [command.nodeId, command.requestedBy, command.exitCode]),
      [
        ['work', 'agent-tool', 1],
        ['work', 'agent-tool', 0],
        ['check', 'agent-tool', 0],
      ],
    );
    assert.ok(recorded.every((command) => typeof command.afterRunSnapshotId === 'string'));

    // The check was handed the run's commands with their standing.
    const check = sdk.queries[1]?.prompt ?? '';
    assert.match(check, /Commands DSpatch recorded in this run/);
    assert.match(check, /1\. npm test[\s\S]*Ended: exit code 1[\s\S]*\(stale - the working folders have changed/);
    assert.match(check, /2\. npm test[\s\S]*Ended: exit code 0[\s\S]*\(current - every working folder is still/);
    assert.match(check, /When DSpatch lets a success verdict stand/);

    // B1: the run's outcome is not "tests failed" for a failure the agent then fixed, and
    // nothing calls the agents' commands a verification.
    const { outcome, text, commands } = outcomeOf(delivery);
    assert.notEqual(outcome, 'tests-failed');
    assert.notEqual(outcome, 'work-verified');
    assert.equal(commands[2]?.currentAtEnd, true);
    assert.equal(commands[0]?.currentAtEnd, false);
    assert.match(text, /The agents’ own commands are not the outcome above: 3 DSpatch ran at an agent’s request/);
    assert.match(text, /The last that completed on the code exactly as the run left it, npm test, exited 0/);
    assert.match(text, /not a verification by DSpatch/);
  });

  it('an unstartable first command in work is not the run outcome either', () => {
    const outcome = runOutcomeFrom({
      commands: [
        {
          command: 'cmd /c nosuchtool',
          line: 'nosuchtool',
          cwd: 'C:/p',
          exitCode: null,
          signal: null,
          durationMs: 1,
          startedAtUtc: '2026-10-27T00:00:00Z',
          notRun: { kind: 'could-not-start', message: 'not found' },
          stdoutTail: '',
          stderrTail: '',
          truncatedOutput: null,
          snapshotAfterId: null,
          requestedBy: 'agent-tool',
        },
      ],
      status: 'completed',
      cancelled: false,
      recordComplete: true,
    });
    assert.notEqual(outcome, 'command-could-not-start');
  });

  it('(b) the check finds the failure and sends the work back with findings; one rework round, then done', async () => {
    const workspace = buggyProject('b');
    const { sdk, factory } = claude([
      { kind: 'answer', text: 'Looked at sum; it should be fine.\n\nRESULT: succeeded' },
      {
        kind: 'script',
        steps: [runTests],
        text: 'npm test fails: sum(2, 3) returned -1, expected 5. src/sum.js subtracts.\n\nRESULT: rework',
      },
      { kind: 'script', steps: [fix(workspace), runTests], text: 'Made sum add; npm test passes.\n\nRESULT: succeeded' },
      { kind: 'script', steps: [runTests], text: 'npm test: 1 passing.\n\nRESULT: met' },
    ]);
    const delivery = await walk('b', workspace, factory);
    assert.equal(delivery.result.terminalNodeId, 'done', formatRunJournal(delivery.result));
    assert.deepEqual(delivery.result.path, ['work', 'check', 'work', 'check', 'done']);
    assert.deepEqual(delivery.result.edgesTaken, ['e-succeeded', 'e-rework', 'e-succeeded', 'e-met']);
    // The work step's second visit was handed the check's concrete findings, in its own session.
    assert.match(sdk.queries[2]?.prompt ?? '', /sum\(2, 3\) returned -1/);
    assert.equal(
      delivery.inspection.sessions.find((session) => session.nodeId === 'work')?.turns,
      2,
      'work continued its own session',
    );
    assert.equal(delivery.result.edgesTaken.filter((edge) => edge === 'e-rework').length, 1, 'one rework round');
    // R5: the tests really ran, failed for the check, then passed for work and check.
    assert.deepEqual(
      delivery.inspection.commands.map((command) => [command.nodeId, command.exitCode]),
      [
        ['check', 1],
        ['work', 0],
        ['check', 0],
      ],
    );
  });

  it('(c) a "met" after the work edited past its last command, with no command by the check, is not done', async () => {
    const workspace = buggyProject('c');
    const { factory } = claude([
      {
        kind: 'script',
        steps: [
          fix(workspace),
          runTests,
          {
            act: () => {
              fs.appendFileSync(path.join(workspace, 'src', 'sum.js'), '// tidied after the test\n', 'utf8');
            },
          },
        ],
        text: 'Fixed and tidied.\n\nRESULT: succeeded',
      },
      { kind: 'answer', text: 'The change reads right.\n\nRESULT: met' },
    ]);
    const delivery = await walk('c', workspace, factory);
    assert.equal(delivery.result.terminalNodeId, 'not-established');
    const produced = delivery.result.journal.find(
      (entry) => entry.kind === 'node-produced' && entry.nodeId === 'check',
    );
    assert.equal(produced?.data?.['outcomeSource'], 'verification-stale');
    assert.match(formatRunJournal(delivery.result), /The last command that completed, npm test/);
  });

  it('(d) a spent correction bound ends at not-met through limit-reached', async () => {
    const workspace = buggyProject('d');
    const reworkAgain: Turn = { kind: 'answer', text: 'Still wrong: sum subtracts.\n\nRESULT: rework' };
    const lazy: Turn = { kind: 'answer', text: 'Done.\n\nRESULT: succeeded' };
    const { sdk, factory } = claude([lazy, reworkAgain, lazy, reworkAgain, lazy, reworkAgain]);
    const delivery = await walk('d', workspace, factory);
    assert.equal(delivery.result.terminalNodeId, 'not-met', formatRunJournal(delivery.result));
    assert.equal(sdk.queries.length, 6);
    assert.equal(delivery.result.edgesTaken.at(-1), 'e-check-limit');
    assert.match(formatRunJournal(delivery.result), /rework round 3 of a permitted 2/);
  });

  it('(e) cancel while work runs a real command stops it and its child, records it, and never starts check', async () => {
    const workspace = buggyProject('e');
    const abort = new AbortController();
    const { sdk, factory } = claude([
      {
        kind: 'script',
        steps: [
          { tool: COMMAND_TOOL_ID, input: { command: sleepingTreeCommand(workspace) }, noToolResult: true },
          { untilInterrupted: true },
        ],
        text: 'unreachable',
      },
      { kind: 'answer', text: 'RESULT: met' },
    ]);
    const running = walk('e', workspace, factory, { abort });
    let pids: { parent: number; child: number } | null = null;
    try {
      pids = await treePids(workspace);
      abort.abort();
      const delivery = await running;
      assert.equal(sdk.queries.length, 1, 'check never started');
      assert.notEqual(delivery.result.terminalNodeId, 'done');
      const command = delivery.inspection.commands[0];
      assert.equal(command?.requestedBy, 'agent-tool');
      assert.equal(command?.ending, 'stopped');
      assert.equal(command?.notRun?.kind, 'did-not-finish');
      assert.deepEqual(await waitGone([pids.parent, pids.child]), [], 'both processes are gone');
    } finally {
      if (pids !== null) {
        killLeftovers([pids.parent, pids.child]);
      }
      await running.catch(() => undefined);
    }
  });
});

// --- Cursor: the provider's own shell commands, recorded as reported (B5) -------------

/** A Cursor stand-in that reports shell tool calls in the shape Cursor's SDK was measured to send. */
class ScriptedCursor {
  private readonly listeners = new Map<string, AgentEventListener>();
  private turnIndex = 0;
  private readonly turns: readonly ((emit: (event: Partial<AgentEvent>) => void) => void)[];
  constructor(turns: readonly ((emit: (event: Partial<AgentEvent>) => void) => void)[]) {
    this.turns = turns;
  }
  startSession(config: { dspatchSessionId?: string }) {
    return Promise.resolve({
      dspatchSessionId: config.dspatchSessionId ?? 's',
      provider: 'cursor' as const,
      providerSessionId: `agent-${config.dspatchSessionId ?? 's'}`,
      createdAt: new Date().toISOString(),
    });
  }
  subscribe(sessionId: string, listener: AgentEventListener) {
    this.listeners.set(sessionId, listener);
    return () => this.listeners.delete(sessionId);
  }
  send(sessionId: string) {
    const index = this.turnIndex;
    this.turnIndex += 1;
    const runId = `run-${String(index)}`;
    const emit = (event: Partial<AgentEvent>): void => {
      this.listeners.get(sessionId)?.({
        dspatchSessionId: sessionId,
        dspatchRunId: runId,
        at: new Date().toISOString(),
        rawProviderEvent: null,
        ...event,
      } as AgentEvent);
    };
    setImmediate(() => {
      emit({ type: 'run.started' });
      this.turns[index]?.(emit);
      emit({ type: 'run.finished', status: 'finished' } as Partial<AgentEvent>);
    });
    return Promise.resolve({ dspatchRunId: runId });
  }
  cancel() {
    return Promise.resolve();
  }
  readUsage() {
    return Promise.resolve([]);
  }
  dispose() {
    return Promise.resolve();
  }
}

function shell(emit: (event: Partial<AgentEvent>) => void, id: string, command: string, exitCode: number): void {
  emit({ type: 'tool.started', toolCallId: id, name: 'shell', rawProviderEvent: { args: { command } } } as Partial<AgentEvent>);
  emit({
    type: 'tool.finished',
    toolCallId: id,
    name: 'shell',
    status: 'ok',
    rawProviderEvent: { args: { command }, result: { value: { exitCode, stdout: `exit ${String(exitCode)}`, stderr: '', executionTime: 300 } } },
  } as Partial<AgentEvent>);
}

describe('the chat loop with Cursor', () => {
  it('records its shell commands as reported by the provider, and a met with a current one reaches done', async () => {
    const workspace = buggyProject('cursor');
    const answer = (text: string) => (emit: (event: Partial<AgentEvent>) => void) => {
      emit({ type: 'assistant.message', text } as Partial<AgentEvent>);
    };
    const cursor = new ScriptedCursor([
      (emit) => {
        fs.writeFileSync(path.join(workspace, 'src', 'sum.js'), 'exports.sum = (a, b) => a + b;\n', 'utf8');
        shell(emit, 'c1', 'npm test', 0);
        answer('Fixed; npm test passes.\n\nRESULT: succeeded')(emit);
      },
      (emit) => {
        shell(emit, 'c2', 'npm test', 0);
        answer('npm test passes.\n\nRESULT: met')(emit);
      },
    ]);
    let claudeBuilt = 0;
    const factory = providerAdapters({
      presentation: false,
      claudeAuthorizationReference: null,
      claudeInstalled: false,
      env: CLEAN_ENV,
      construct: {
        cursor: () => cursor as unknown as ChatAdapter,
        claude: () => {
          claudeBuilt += 1;
          throw new Error('no Claude in a Cursor run');
        },
      },
    });
    const delivery = await walk('cursor', workspace, factory, { provider: 'cursor' });
    assert.equal(delivery.result.terminalNodeId, 'done', formatRunJournal(delivery.result));
    assert.equal(claudeBuilt, 0);
    const recorded = delivery.inspection.commands;
    assert.deepEqual(
      recorded.map((command) => [command.nodeId, command.requestedBy, command.line, command.exitCode]),
      [
        ['work', 'provider-reported', 'npm test', 0],
        ['check', 'provider-reported', 'npm test', 0],
      ],
    );
    assert.match(recorded[0]?.originNote ?? '', /not by DSpatch/);
    assert.match(delivery.journalText, /\[reported by provider\] npm test/);
    const { text } = outcomeOf(delivery);
    assert.match(text, /2 the provider reported running with its own tool/);
    assert.doesNotMatch(text, /A command DSpatch started/);
  });
});

describe('the approval rule, at its edges', () => {
  it('R1: a whenUndeclared that itself ends in success is no fallback - the run stops with a reason', async () => {
    const workspace = buggyProject('r1');
    const drawn = JSON.parse(fs.readFileSync(CHAT_LOOP, 'utf8')) as { nodes: Record<string, unknown>[] };
    for (const node of drawn.nodes) {
      if (node['id'] === 'check') {
        node['whenUndeclared'] = 'met';
      }
    }
    const loaded = loadLoopGraph(JSON.stringify(drawn), { resolveRole: createFileRoleResolver(repoRoot) });
    assert.equal(loaded.ok, true, loaded.ok ? '' : JSON.stringify(loaded.findings));
    if (!loaded.ok) {
      throw new Error('unreachable');
    }
    const adapter = new ScriptedCursor([
      (emit) => {
        fs.writeFileSync(path.join(workspace, 'src', 'sum.js'), 'exports.sum = (a, b) => a + b;\n', 'utf8');
        emit({ type: 'assistant.message', text: 'Done.\n\nRESULT: succeeded' } as Partial<AgentEvent>);
      },
      (emit) => {
        emit({ type: 'assistant.message', text: 'Looks right.\n\nRESULT: met' } as Partial<AgentEvent>);
      },
    ]);
    const result = await runLoopGraph(loaded.graph, {
      runId: 'loop-agent-r1',
      dryRun: false,
      resultStore: createFileResultStore(tempRoot('loop-agent-r1-store')),
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: adapter as never,
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        promptFor: (node) => `Step ${node.id}.`,
      }),
    });
    assert.equal(result.status, 'runtime-fault', formatRunJournal(result));
    assert.equal(result.fault?.nodeId, 'check');
    assert.match(result.fault?.detail ?? '', /itself ends the run in success, so it cannot stand in for that result/);
    assert.notEqual(result.terminalNodeId, 'done');
  });

  it('R3: a step cancelled after an edit leaves its earlier command not current, and the sentence says so', async () => {
    const workspace = buggyProject('r3');
    const abort = new AbortController();
    const { factory } = claude([
      {
        kind: 'script',
        steps: [
          runTests,
          {
            act: () => {
              fs.writeFileSync(path.join(workspace, 'src', 'sum.js'), 'exports.sum = (a, b) => a + b;\n', 'utf8');
              abort.abort();
            },
          },
          { untilInterrupted: true },
        ],
        text: 'unreachable',
      },
    ]);
    const delivery = await walk('r3', workspace, factory, { abort });
    assert.equal(delivery.inspection.cancelled, true);
    const { commands, text } = outcomeOf(delivery);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.currentAtEnd, false, 'the edit after it is part of the code as left');
    assert.match(text, /None of them completed on the code exactly as the run left it/);
    assert.doesNotMatch(text, /The last that completed on the code exactly as the run left it/);
  });
});

describe('the approval rule compares every working folder (review B3)', () => {
  async function twoFolders(name: string, writeSecondBeforeCommand: boolean) {
    const first = buggyProject(`${name}-a`);
    const second = tempRoot(`loop-agent-${name}-b`);
    fs.writeFileSync(path.join(second, 'notes.md'), 'before\n', 'utf8');
    const touchSecond = (): void => {
      fs.writeFileSync(path.join(second, 'notes.md'), 'after\n', 'utf8');
    };
    const adapter = new ScriptedCursor([
      (emit) => {
        fs.writeFileSync(path.join(first, 'src', 'sum.js'), 'exports.sum = (a, b) => a + b;\n', 'utf8');
        if (writeSecondBeforeCommand) {
          touchSecond();
        }
        shell(emit, 'c1', 'npm test', 0);
        if (!writeSecondBeforeCommand) {
          touchSecond();
        }
        emit({ type: 'assistant.message', text: 'Done.\n\nRESULT: succeeded' } as Partial<AgentEvent>);
      },
      (emit) => {
        emit({ type: 'assistant.message', text: 'Looks right.\n\nRESULT: met' } as Partial<AgentEvent>);
      },
    ]);
    const roots = workingRootsFrom([first, second], first, process.platform === 'win32');
    return runLoopGraph(chatLoop(), {
      runId: `loop-agent-${name}`,
      dryRun: false,
      resultStore: createFileResultStore(tempRoot(`loop-agent-${name}-store`)),
      executor: createLiveExecutor({
        workspacePath: first,
        workingRoots: roots,
        adapter: adapter as never,
        modelRequested: 'composer-2',
        inspection: emptyInspection(first, 'composer-2', roots),
        promptFor: (node) => `Step ${node.id}.`,
      }),
    });
  }

  it('a change in the second folder after the last command keeps "met" from standing', async () => {
    const result = await twoFolders('b3-after', false);
    assert.equal(result.terminalNodeId, 'not-established', formatRunJournal(result));
  });

  it('and the same change before the command lets it stand', async () => {
    const result = await twoFolders('b3-before', true);
    assert.equal(result.terminalNodeId, 'done', formatRunJournal(result));
  });
});

describe('production code does not know the verification example', () => {
  it('no file under app/src names its folder, files or test', () => {
    const offenders: string[] = [];
    const walkDir = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(full);
        } else if (/\.(ts|tsx|mts|js|mjs|json)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/sum-project|sum\.test\.js|src[\\/]sum\.js/.test(text)) {
            offenders.push(full);
          }
        }
      }
    };
    walkDir(path.join(repoRoot, 'app', 'src'));
    assert.deepEqual(offenders, []);
  });
});
