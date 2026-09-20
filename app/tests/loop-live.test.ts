/**
 * The live executor seam, without spending a provider turn.
 *
 * Every test here injects a fake adapter. The guarantee we need is structural:
 * human / router / gate never call `send`, a hung `send` is cancelled at the
 * deadline, a spent bound is a bound, and cancel leaves the files. The real
 * Cursor path is the CLI demonstration, not these tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { AgentAdapter } from '../src/adapter/agent-adapter';
import type {
  AgentEvent,
  AgentEventListener,
  CapabilityReport,
  DspatchSessionId,
  ModelInfo,
  RunReference,
  SessionConfig,
  SessionHandle,
  Unsubscribe,
  UsageQuery,
  UsageReading,
} from '../src/adapter/types';
import { generateExperimentRepo } from '../src/main/experiment-repo';
import {
  createLiveExecutor,
  describeBound,
  describeStoppedCommand,
  emptyInspection,
  refuseLiveWorkspace,
  runConfiguredProjectTest,
  runNodeProjectTest,
  type LiveCommandRecord,
} from '../src/main/loop-live';
import { describeLoopEnding } from '../src/shared/loop-transcript';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import type { LoopGraph } from '../src/shared/loop-graph';
import {
  createDryRunExecutor,
  runLoopGraph,
  type JournalKind,
  type RunJournalEntry,
  type StepExecution,
} from '../src/shared/loop-run';
import { chatPromptFor, formatChatLiveLogLine, lookupFromGraph } from '../src/shared/loop-chat';
import { InstructionQueue } from '../src/main/instruction-queue';
import { instructionPreamble, INSTRUCTION_BLOCK_OPEN } from '../src/shared/loop-instruction';
import { activityLine } from '../src/shared/chat-workspace';
import { nodeRunStateFor, nodeRunStates, runViewFor } from '../src/shared/loop-run-view';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const liveGraphPath = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-live-duration.graph.json');
const chatGraphPath = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json');
const scratchRoots: string[] = [];

function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-live-test-${name}-`));
  scratchRoots.push(dir);
  return dir;
}

after(() => {
  for (const root of scratchRoots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

function loadLiveGraph(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(liveGraphPath, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, 'the live duration graph must validate');
  return loaded.graph;
}

function loadChatGraph(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(chatGraphPath, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, 'the chat loop graph must validate');
  return loaded.graph;
}

const CAPABILITIES: CapabilityReport = {
  start: 'supported',
  streaming: 'supported',
  cancel: 'supported',
  resume: 'unsupported',
  modelSelection: 'supported',
  approvals: 'unsupported',
  usageReporting: 'unknown',
};

interface FakeOptions {
  readonly hang?: boolean;
  readonly assistantText?: string;
  /**
   * What the agent says on the second and later turns, when that has to differ.
   *
   * The chat loop has two agent nodes: `work` and then `check`. One reply for
   * every turn would make a test choose between a realistic work reply and
   * reaching the checking step at all.
   */
  readonly laterAssistantText?: string;
  readonly status?: 'finished' | 'error' | 'cancelled';
  readonly writeRelPath?: string;
  readonly writeContent?: string;
  readonly throwOnSend?: string;
}

/** Named verdicts the increment-1 drawing asks for. */
const WORK_SUCCEEDED = 'The helper is in place.\n\nRESULT: succeeded';
const CHECK_MET = 'The project\'s own tests passed.\n\nRESULT: met';
const CHECK_NOT_MET = 'The project\'s own tests failed.\n\nRESULT: not-met';
const CHECK_COULD_NOT =
  'I could not find how this project is checked.\n\nRESULT: could-not-check';

class FakeAdapter implements AgentAdapter {
  readonly sends: string[] = [];
  readonly cancels: string[] = [];
  modelValue: string | null = 'composer-2';
  private readonly listeners = new Map<string, Set<AgentEventListener>>();
  private readonly options: FakeOptions;
  private workspace = '';

  constructor(options: FakeOptions = {}) {
    this.options = options;
  }

  async startSession(config: SessionConfig): Promise<SessionHandle> {
    this.workspace = config.workspacePath;
    return {
      dspatchSessionId: 'dsp-session-fake',
      provider: 'cursor',
      providerSessionId: 'agent-fake',
      createdAt: new Date().toISOString(),
    };
  }

  resume(): Promise<SessionHandle> {
    return Promise.reject(new Error('resume is not used in this increment'));
  }

  async send(sessionId: DspatchSessionId, prompt: string): Promise<RunReference> {
    this.sends.push(prompt);
    const dspatchRunId = `dsp-run-${String(this.sends.length)}`;
    this.emit(sessionId, {
      type: 'run.started',
      dspatchSessionId: sessionId,
      dspatchRunId,
      at: new Date().toISOString(),
      rawProviderEvent: null,
    });
    if (this.options.throwOnSend !== undefined) {
      throw new Error(this.options.throwOnSend);
    }
    if (this.options.hang === true) {
      return { dspatchRunId };
    }
    if (this.options.writeRelPath !== undefined && this.options.writeContent !== undefined) {
      const full = path.join(this.workspace, this.options.writeRelPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, this.options.writeContent, 'utf8');
    }
    const runId = dspatchRunId;
    queueMicrotask(() => {
      this.emit(sessionId, {
        type: 'assistant.message',
        dspatchSessionId: sessionId,
        dspatchRunId: runId,
        at: new Date().toISOString(),
        rawProviderEvent: null,
        text:
          this.sends.length > 1 && this.options.laterAssistantText !== undefined
            ? this.options.laterAssistantText
            : (this.options.assistantText ?? 'DONE'),
      });
      this.emit(sessionId, {
        type: 'run.finished',
        dspatchSessionId: sessionId,
        dspatchRunId: runId,
        at: new Date().toISOString(),
        rawProviderEvent: null,
        status: this.options.status ?? 'finished',
      });
    });
    return { dspatchRunId };
  }

  subscribe(sessionId: DspatchSessionId, onEvent: AgentEventListener): Unsubscribe {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(onEvent);
    this.listeners.set(sessionId, set);
    return () => {
      set.delete(onEvent);
    };
  }

  async cancel(sessionId: DspatchSessionId): Promise<void> {
    this.cancels.push(sessionId);
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve([{ id: 'composer-2', displayName: 'Composer 2', provider: 'cursor' }]);
  }

  readUsage(_scope: UsageQuery): Promise<readonly UsageReading[]> {
    return Promise.resolve([]);
  }

  respondToApproval(): Promise<void> {
    return Promise.reject(new Error('unsupported'));
  }

  capabilities(): CapabilityReport {
    return CAPABILITIES;
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
  }

  modelReported(): string | null {
    return this.modelValue;
  }

  private emit(sessionId: string, event: AgentEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) {
      listener(event);
    }
  }
}

function passingTest(): Promise<LiveCommandRecord> {
  return Promise.resolve({
    command: 'node --test test/duration.test.ts',
    cwd: '/tmp',
    exitCode: 0,
    signal: null,
    durationMs: 12,
    startedAtUtc: '2026-09-17T21:00:10.000Z',
    stdout: 'ok',
    stderr: '',
    notRun: null,
  });
}

function failingTest(): Promise<LiveCommandRecord> {
  return Promise.resolve({
    command: 'node --test test/duration.test.ts',
    cwd: '/tmp',
    exitCode: 1,
    signal: null,
    durationMs: 8,
    startedAtUtc: '2026-09-17T21:00:11.000Z',
    stdout: 'not ok',
    stderr: '',
    notRun: null,
  });
}

describe('dspatch-live-duration graph', () => {
  it('validates and is not the external development loop', () => {
    const graph = loadLiveGraph();
    assert.equal(graph.id, 'dspatch-live-duration');
    assert.equal(graph.entry, 'implementer');
    assert.equal(graph.nodes.length, 4);
    assert.ok(graph.edges.some((edge) => edge.id === 'e-spec' && edge.when.on === 'declared-failure'));
  });

  it('changes path when one edge in the drawing is redirected', async () => {
    const graph = loadLiveGraph();
    const variant: LoopGraph = {
      ...graph,
      id: 'dspatch-live-duration-variant',
      edges: graph.edges.map((edge) => (edge.id === 'e-fail' ? { ...edge, to: 'done' } : edge)),
    };
    const decisions = [
      { node: 'implementer', produce: { kind: 'success' as const } },
      { node: 'verify', produce: { kind: 'outcome' as const, outcome: 'fail' } },
    ];
    const before = await runLoopGraph(graph, {
      runId: 'edge-before',
      dryRun: true,
      executor: createDryRunExecutor({ decisions }),
    });
    const after = await runLoopGraph(variant, {
      runId: 'edge-after',
      dryRun: true,
      executor: createDryRunExecutor({ decisions }),
    });
    assert.equal(before.terminalNodeId, 'failed');
    assert.equal(after.terminalNodeId, 'done');
    assert.ok(before.edgesTaken.includes('e-fail'));
    assert.ok(after.edgesTaken.includes('e-fail'));
    assert.notDeepEqual(before.path, after.path);
  });
});

describe('createLiveExecutor — only agent nodes reach the adapter', () => {
  it('walks the live graph, spends one provider turn, and journals snapshots', async () => {
    const workspace = path.join(scratch('happy'), 'duration-repo');
    generateExperimentRepo(workspace, repoRoot);
    const adapter = new FakeAdapter({
      writeRelPath: 'src/duration.ts',
      writeContent: 'export function formatDuration(n: number): string { return `${n}s`; }\n',
    });
    const inspection = emptyInspection(workspace, 'composer-2');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'live-happy',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        modelReported: () => adapter.modelReported(),
        inspection,
        runProjectTest: passingTest,
      }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.dryRun, false);
    assert.equal(result.terminalNodeId, 'done');
    assert.deepEqual(result.path, ['implementer', 'verify', 'done']);
    assert.deepEqual(result.edgesTaken, ['e-edit', 'e-pass']);
    assert.equal(result.usage.providerTurns, 1);
    assert.equal(adapter.sends.length, 1);
    assert.ok(inspection.snapshotBefore?.snapshotId.startsWith('snap-'));
    assert.ok(inspection.snapshotAfter?.snapshotId.startsWith('snap-'));
    assert.notEqual(inspection.snapshotBefore?.snapshotId, inspection.snapshotAfter?.snapshotId);
    assert.equal(inspection.changedFiles[0]?.relPath, 'src/duration.ts');
    assert.equal(inspection.commands.length, 1);
    assert.equal(inspection.modelReported, 'composer-2');
    assert.equal(inspection.cost, 'unknown');
  });

  it('does not call send for human, router or gate nodes', async () => {
    const workspace = scratch('no-send');
    const adapter = new FakeAdapter();
    const inspection = emptyInspection(workspace, 'composer-2');
    const graph: LoopGraph = {
      format: 'dspatch-loop-graph',
      formatVersion: 1,
      id: 'kinds-only',
      name: 'kinds',
      purpose: 'Prove non-agent kinds spend no turn.',
      target: 'cursor',
      entry: 'choose',
      onRuntimeFault: 'stop-and-reconcile',
      failureKinds: [],
      nodes: [
        { id: 'choose', kind: 'router', outcomes: ['ask', 'skip'] },
        { id: 'ask', kind: 'human', purpose: 'A person must decide.', outcomes: ['go', 'stop'] },
        { id: 'skip', kind: 'terminal' },
        { id: 'stop', kind: 'terminal' },
      ],
      edges: [
        { id: 'e-ask', from: 'choose', to: 'ask', when: { on: 'outcome', outcome: 'ask' } },
        { id: 'e-skip', from: 'choose', to: 'skip', when: { on: 'outcome', outcome: 'skip' } },
        { id: 'e-go', from: 'ask', to: 'skip', when: { on: 'outcome', outcome: 'go' } },
        { id: 'e-stop', from: 'ask', to: 'stop', when: { on: 'outcome', outcome: 'stop' } },
      ],
    };
    const result = await runLoopGraph(graph, {
      runId: 'no-send',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        inspection,
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'awaiting-human');
    assert.equal(result.awaiting?.nodeId, 'ask');
    assert.equal(adapter.sends.length, 0);
    assert.equal(result.usage.providerTurns, 0);
  });

  it('routes a declared failure and never treats a runtime fault as a dashed edge', async () => {
    const workspace = scratch('spec');
    const adapter = new FakeAdapter({ assistantText: 'SPEC_ERROR the tests are not the spec' });
    const inspection = emptyInspection(workspace, 'composer-2');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'live-spec',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        inspection,
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'failed');
    assert.deepEqual(result.edgesTaken, ['e-spec']);
    const taken = result.journal.find((entry) => entry.edgeId === 'e-spec');
    assert.equal(taken?.data?.declaredFailure, true);
    assert.equal(taken?.data?.runtimeFault, false);
  });

  it('records a live maxCalls bound as a bound, not as a declared failure', async () => {
    const workspace = scratch('bound');
    const adapter = new FakeAdapter({ assistantText: 'DONE' });
    const inspection = emptyInspection(workspace, 'composer-2');
    const tight: LoopGraph = { ...loadLiveGraph(), limits: { maxTasks: 1, maxCalls: 1 } };
    const result = await runLoopGraph(tight, {
      runId: 'live-bound',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        inspection,
        runProjectTest: failingTest,
      }),
    });
    assert.equal(result.status, 'limit-reached');
    assert.deepEqual(result.limitsReached, ['maxCalls']);
    assert.equal(result.fault, null);
    assert.equal(result.path.includes('verify'), false, 'the gate must not run after the bound is spent');
    assert.equal(adapter.sends.length, 1);
    const reached = result.journal.find((entry) => entry.kind === 'limit-reached');
    assert.equal(reached?.data?.declaredFailure, false);
    assert.equal(reached?.data?.runtimeFault, false);
  });
});

describe('createLiveExecutor — deadline and cancel', () => {
  it('owns the deadline: a hung send is cancelled and returns step-timed-out', async () => {
    const workspace = path.join(scratch('hang'), 'duration-repo');
    generateExperimentRepo(workspace, repoRoot);
    const marker = path.join(workspace, 'src', 'duration.ts');
    const beforeText = fs.readFileSync(marker, 'utf8');
    const adapter = new FakeAdapter({ hang: true });
    const inspection = emptyInspection(workspace, 'composer-2');
    // Strip maxMinutes so the executor's fallback deadline (20 ms) is what fires.
    // The runner's own check only runs after the executor returns; this is gap 8.4.
    const unbounded: LoopGraph = {
      ...loadLiveGraph(),
      limits: { maxTasks: 1, maxCalls: 3 },
      nodes: loadLiveGraph().nodes.map((node) =>
        node.id === 'implementer' ? { ...node, limits: undefined } : node,
      ),
    };
    const result = await runLoopGraph(unbounded, {
      runId: 'live-hang',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        inspection,
        fallbackDeadlineMs: 30,
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'step-timed-out');
    assert.equal(result.journal.some((entry) => entry.kind === 'edge-taken'), false);
    assert.ok(adapter.cancels.length >= 1, 'the adapter must have been asked to cancel');
    assert.equal(fs.readFileSync(marker, 'utf8'), beforeText, 'cancel must not reset or rewrite the file');
    assert.equal(inspection.cancelled, true);
    assert.equal(result.usage.providerTurns, 1);
  });

  it('does not replay a completed step when asked again', async () => {
    const workspace = scratch('replay');
    const adapter = new FakeAdapter({ assistantText: 'DONE' });
    const inspection = emptyInspection(workspace, 'composer-2');
    const executor = createLiveExecutor({
      workspacePath: workspace,
      adapter,
      modelRequested: 'composer-2',
      inspection,
      runProjectTest: passingTest,
    });
    const graph = loadLiveGraph();
    const context = {
      runId: 'replay',
      graph,
      node: graph.nodes[0]!,
      occurrence: 1,
      callId: 1,
      limits: {},
      deadlineAt: Date.now() + 60_000,
      archive: null,
    };
    const first = await executor(context);
    const second = await executor(context);
    assert.equal(adapter.sends.length, 1);
    assert.equal(first.providerTurns, 1);
    assert.equal(second.providerTurns, 1);
    assert.deepEqual(second.product, first.product);
    assert.deepEqual(inspection.replayedSteps, ['implementer:1']);
  });

  it('operator abort before the step starts does not call send', async () => {
    const workspace = scratch('abort');
    const adapter = new FakeAdapter();
    const inspection = emptyInspection(workspace, 'composer-2');
    const abort = new AbortController();
    abort.abort();
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'live-abort',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        abortSignal: abort.signal,
        inspection,
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'no-outcome-delivered');
    assert.equal(adapter.sends.length, 0);
    assert.match(result.fault?.detail ?? '', /not reset|left as they are/i);
  });
});

/**
 * The checking agent's three named verdicts, and a leftover duration gate.
 *
 * The chat loop no longer starts a command of its own. A check that could not
 * decide is an agent RESULT, not an empty Command field. Duration still starts
 * a process, so the leftover gate rules live on that drawing.
 */
describe("the checking step's third verdict: the assignment was not established", () => {
  it('ends at not-established when the checking agent could not decide, never at a failed test', async () => {
    const workspace = scratch('check-could-not');
    const adapter = new FakeAdapter({
      assistantText: WORK_SUCCEEDED,
      writeRelPath: 'src/touched.ts',
      writeContent: 'export const touched = true;\n',
      laterAssistantText: CHECK_COULD_NOT,
    });
    const inspection = emptyInspection(workspace, 'composer-2');
    const result = await runLoopGraph(loadChatGraph(), {
      runId: 'check-could-not',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        inspection,
        runProjectTest: () => runConfiguredProjectTest('', workspace),
      }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.fault, null, 'nothing broke, so nothing may be reported as broken');
    assert.equal(result.terminalNodeId, 'not-established');
    assert.deepEqual(result.edgesTaken, ['e-succeeded', 'e-could-not-check']);
    assert.equal(inspection.commands.length, 0, 'the chat loop starts no command of its own');
    assert.equal(adapter.sends.length, 2, 'both agent turns happened');

    const shown = describeLoopEnding(
      { kind: 'finished', result, journalText: '', workspaceNote: '' },
      { cancelRequested: false, abandoned: false },
    );
    assert.match(
      shown.text,
      /stopped at "Could not establish"/,
      `the conversation must name the ending it reached. It said: ${shown.text}`,
    );
    assert.doesNotMatch(shown.text, /not-established/, 'and must not name it by its raw node id');
    assert.doesNotMatch(shown.text, /tests-failed/);
    const produced = result.journal.find(
      (line) => line.kind === 'node-produced' && line.nodeId === 'check',
    );
    assert.match(produced?.detail ?? '', /RESULT: could-not-check/);
    assert.match(
      produced?.detail ?? '',
      /reused the provider session/,
      'the record must say the check is not an independent judge',
    );
  });

  it('still stops the duration fixture for a command that could not be started', async () => {
    const workspace = scratch('gate-unstartable');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'gate-unstartable',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: 'DONE' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: () =>
          Promise.resolve({
            command: 'cmd.exe /d /s /c nosuchtool --run',
            cwd: workspace,
            exitCode: null,
            signal: null,
            durationMs: 4,
            startedAtUtc: '2026-09-18T15:00:00.000Z',
            stdout: '',
            stderr: "'nosuchtool' is not recognized as an internal or external command",
            notRun: {
              kind: 'could-not-start' as const,
              message: 'DSpatch could not start the command in the project directory.',
            },
          }),
      }),
    });
    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'no-outcome-delivered');
    assert.equal(result.terminalNodeId, null);
    assert.match(result.fault?.reconcile ?? '', /before resuming or re-running it/);
  });

  it('says when the duration gate itself changed the project while checking it', async () => {
    const workspace = scratch('gate-self-modifies');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'project(spike)\n', 'utf8');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'gate-self-modifies',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: 'DONE' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: () => {
          fs.mkdirSync(path.join(workspace, 'build'), { recursive: true });
          fs.writeFileSync(
            path.join(workspace, 'build', 'CMakeCache.txt'),
            'CMAKE_BUILD_TYPE:STRING=Debug\n',
            'utf8',
          );
          return passingTest();
        },
      }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'done');
    const produced = result.journal.find(
      (line) => line.kind === 'node-produced' && line.nodeId === 'verify',
    );
    assert.match(produced?.detail ?? '', /changed the working copy while it ran/);
    assert.match(produced?.detail ?? '', /observation and not a judgement/);
  });

  it('says nothing of the kind when the duration gate left the project alone', async () => {
    const workspace = scratch('gate-leaves-alone');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'gate-leaves-alone',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: 'DONE' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: passingTest,
      }),
    });

    const produced = result.journal.find(
      (line) => line.kind === 'node-produced' && line.nodeId === 'verify',
    );
    assert.doesNotMatch(produced?.detail ?? '', /changed the working copy while it ran/);
  });

  it('a named checking verdict still ends at its own terminal', async () => {
    const graph = loadChatGraph();
    for (const [later, terminal, edge] of [
      [CHECK_MET, 'done', 'e-met'],
      [CHECK_NOT_MET, 'not-met', 'e-not-met'],
    ] as const) {
      const workspace = scratch(`check-verdict-${terminal}`);
      const result = await runLoopGraph(graph, {
        runId: `check-verdict-${terminal}`,
        dryRun: false,
        executor: createLiveExecutor({
          workspacePath: workspace,
          adapter: new FakeAdapter({
            assistantText: WORK_SUCCEEDED,
            writeRelPath: 'src/touched.ts',
            writeContent: 'export const touched = true;\n',
            laterAssistantText: later,
          }),
          modelRequested: 'composer-2',
          inspection: emptyInspection(workspace, 'composer-2'),
          runProjectTest: passingTest,
        }),
      });
      assert.equal(result.status, 'completed');
      assert.equal(result.terminalNodeId, terminal);
      assert.deepEqual(result.edgesTaken, ['e-succeeded', edge]);
      assert.equal(result.fault, null);
    }
  });
});

/**
 * Which branch the run takes is the named verdict, not the file tree.
 *
 * A successful work step always goes to check. Files sit beside that fact as
 * corroboration. A missing RESULT is cheap: unclear, then not-established.
 */
describe('which branch the run takes is declared, not measured from files', () => {
  it('still hands a successful work step to check when no file moved', async () => {
    const workspace = scratch('declared-unchanged');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'project(spike)\n', 'utf8');
    const inspection = emptyInspection(workspace, 'composer-2');
    let commandsStarted = 0;
    const result = await runLoopGraph(loadChatGraph(), {
      runId: 'declared-unchanged',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({
          assistantText: WORK_SUCCEEDED,
          laterAssistantText: CHECK_MET,
        }),
        modelRequested: 'composer-2',
        inspection,
        runProjectTest: () => {
          commandsStarted += 1;
          return passingTest();
        },
      }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'done');
    assert.deepEqual(result.path, ['work', 'check', 'done']);
    assert.deepEqual(result.edgesTaken, ['e-succeeded', 'e-met']);
    assert.equal(commandsStarted, 0, 'the chat loop starts no command of its own');
    assert.equal(inspection.commands.length, 0);

    const produced = result.journal.find(
      (line) => line.kind === 'node-produced' && line.nodeId === 'work',
    );
    assert.match(produced?.detail ?? '', /RESULT: succeeded/);
    assert.match(produced?.detail ?? '', /does not choose the branch/);
    const taken = result.journal.find((line) => line.kind === 'edge-taken');
    assert.equal(taken?.data?.['outcome'], 'succeeded');
  });

  it('still hands a work step that wrote a file to check, because the verdict said so', async () => {
    const workspace = scratch('declared-changed');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'project(spike)\n', 'utf8');
    let commandsStarted = 0;
    const result = await runLoopGraph(loadChatGraph(), {
      runId: 'declared-changed',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({
          assistantText: `${WORK_SUCCEEDED}\nI only read the project and changed nothing.`,
          writeRelPath: 'FINDINGS.md',
          writeContent: '# What I found\n\nThree defects.\n',
          laterAssistantText: CHECK_MET,
        }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: () => {
          commandsStarted += 1;
          return passingTest();
        },
      }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'done');
    assert.deepEqual(result.path, ['work', 'check', 'done']);
    assert.deepEqual(result.edgesTaken, ['e-succeeded', 'e-met']);
    assert.equal(commandsStarted, 0, 'a written file is not a reason to start a DSpatch command');
  });

  it('treats a missing RESULT as unclear, not as a fault and not as success', async () => {
    const workspace = scratch('undeclared-work');
    const result = await runLoopGraph(loadChatGraph(), {
      runId: 'undeclared-work',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({
          assistantText: 'I have updated CMakeLists.txt and rebuilt the target.',
        }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'not-established');
    assert.deepEqual(result.edgesTaken, ['e-unclear']);
  });

  /**
   * DSP-47, end to end on the real graph, as Niclas would meet it.
   *
   * This is his own case: a read-only mandate on a C++ project, answered in prose. The
   * Verifier measured this reply reaching `stopped` — *"the work was not done and
   * nothing was checked"* — on nothing but the word *blocked* appearing in the middle
   * of a sentence. On a C++ project that is not an edge case: *blocked* is a term of
   * art for threads, mutexes, sockets and queues, so it is the expected reply.
   *
   * The unit table in `loop-chat.test.ts` covers the predicate. This covers the thing
   * that actually goes wrong: which ending the run reaches, and whether a command was
   * spawned on the way.
   */
  it('does not end a successful read-only run at "stopped" for the word blocked', async () => {
    for (const reply of [
      'I read the project. The render thread is blocked on a mutex held by the loader — that is the first defect.',
      'Nothing is Blocked and nothing failed; the repository is visible and has three defects.',
      'The build is not blocked.',
    ]) {
      const workspace = scratch('blocked-in-prose');
      fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'project(spike)\n', 'utf8');
      let commandsStarted = 0;
      const result = await runLoopGraph(loadChatGraph(), {
        runId: 'blocked-in-prose',
        dryRun: false,
        executor: createLiveExecutor({
          workspacePath: workspace,
          adapter: new FakeAdapter({ assistantText: reply }),
          modelRequested: 'composer-2',
          inspection: emptyInspection(workspace, 'composer-2'),
          runProjectTest: () => {
            commandsStarted += 1;
            return passingTest();
          },
        }),
      });
      assert.notEqual(
        result.terminalNodeId,
        'stopped',
        `this agent did the work and reported what it found, so the run must not end at ` +
          `"stopped", whose purpose sentence says the work was not done. Reply: ${reply}`,
      );
      assert.equal(result.status, 'completed');
      assert.equal(result.terminalNodeId, 'not-established');
      assert.deepEqual(result.edgesTaken, ['e-unclear']);
      assert.equal(commandsStarted, 0, 'and a mandate that only read still meets no command');
    }
  });

  /**
   * The other direction, which is DSP-47 #2 and #3: a real declaration still routes.
   *
   * Both tokens, in the form `chatPromptFor` asks for, and with the decoration a
   * provider adds — because a fix that stopped the declaration working would trade
   * one wrong ending for another.
   */
  it('still ends at "stopped" when the agent opens its reply with the declaration', async () => {
    for (const [reply, edge] of [
      ['BLOCKED I have no write access to that directory.', 'e-blocked'],
      ['**BLOCKED** — the workspace is read-only.', 'e-blocked'],
      ['\n\nSPEC_ERROR the file the mandate names does not exist.', 'e-spec'],
    ] as const) {
      const workspace = scratch('declared-opening');
      const result = await runLoopGraph(loadChatGraph(), {
        runId: 'declared-opening',
        dryRun: false,
        executor: createLiveExecutor({
          workspacePath: workspace,
          adapter: new FakeAdapter({ assistantText: reply }),
          modelRequested: 'composer-2',
          inspection: emptyInspection(workspace, 'composer-2'),
          runProjectTest: passingTest,
        }),
      });
      assert.equal(result.terminalNodeId, 'stopped', `must still declare: ${reply}`);
      assert.equal(result.status, 'completed');
      assert.deepEqual(result.edgesTaken, [edge]);
    }
  });

  /**
   * DSP-48 #1 where the run records it: the branch's own reason names the files.
   *
   * The Verifier reached `work → check → done` with an agent that wrote nothing and a
   * separate OS process appending one line to `build/CMakeCache.txt`. The measurement
   * cannot tell those apart, so the record has to name the path and say that something
   * other than the agent may have written it.
   */
  it('names the changed file in the reason for the branch', async () => {
    const workspace = scratch('measured-names-paths');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'project(spike)\n', 'utf8');
    const result = await runLoopGraph(loadChatGraph(), {
      runId: 'measured-names-paths',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({
          assistantText: WORK_SUCCEEDED,
          writeRelPath: 'build/CMakeCache.txt',
          writeContent: 'CMAKE_BUILD_TYPE:STRING=Debug\n',
          laterAssistantText: CHECK_MET,
        }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.terminalNodeId, 'done');
    const produced = result.journal.find(
      (line) => line.kind === 'node-produced' && line.nodeId === 'work',
    );
    assert.match(
      produced?.detail ?? '',
      /build[\\/]CMakeCache\.txt/,
      `the reason for the branch must name the file the branch was decided from. ` +
        `It said: ${produced?.detail ?? '(nothing)'}`,
    );
    assert.match(
      produced?.detail ?? '',
      /anything else that wrote there while the loop was working/,
      'and say that the comparison cannot tell the agent from anything else that writes',
    );
  });

  /**
   * A declared failure still wins over the measurement.
   *
   * `SPEC_ERROR` and `BLOCKED` are statements about the *task*, which only the agent
   * is in a position to make, so they must keep routing as they always did — even
   * when the agent left a file behind on its way to declaring them.
   */
  it('lets a declared failure route even when files changed', async () => {
    const workspace = scratch('measured-spec-error');
    const result = await runLoopGraph(loadChatGraph(), {
      runId: 'measured-spec-error',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({
          assistantText: 'SPEC_ERROR the file the mandate names does not exist.',
          writeRelPath: 'notes.md',
          writeContent: 'half-done\n',
        }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'stopped');
    assert.deepEqual(result.edgesTaken, ['e-spec']);
  });

  /**
   * And the fixture is untouched, which is the containment on both executor changes.
   *
   * `dspatch-live-duration`'s agent node declares no outcomes, so it must still
   * finish on plain success and take its `e-edit` success edge. If the measured
   * outcome were produced unconditionally this run would fault every time with
   * `undeclared-product` — the runner and the drawing disagreeing about the file.
   */
  it('leaves a graph that draws no measured branch on its success edge', async () => {
    const workspace = scratch('duration-unchanged-shape');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'duration-unchanged-shape',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: 'DONE' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'done');
    assert.deepEqual(result.edgesTaken, ['e-edit', 'e-pass']);
  });

  /**
   * DSP-32, measured at the only place it can be: the prompt the adapter received.
   *
   * The mechanism is the real one — a real `InstructionQueue`, the real
   * `instructionPreamble`, the real `chatPromptFor`, the real executor and a real
   * walk of the real chat graph. What is assembled here is the `promptFor`
   * closure, because that lives in an Electron IPC handler with no test harness;
   * the source-shape test in `loop-instruction-wiring.test.ts` is what binds
   * `main.ts` to this shape, following the precedent `loop-stop-means-stop.ts`
   * sets for the same problem.
   *
   * Two assertions, and the first is the one that keeps the claim honest. The
   * step that was already running must **not** have been told — DSpatch cannot
   * change a provider call that has been sent, and a test that only checked the
   * message arrived somewhere would pass for a product that lied about when.
   */
  it('gives a message typed mid-run to the next step, and not to the one already working', async () => {
    const workspace = scratch('instruction-delivery');
    const graph = loadChatGraph();
    const queue = new InstructionQueue();
    const adapter = new FakeAdapter({
      assistantText: WORK_SUCCEEDED,
      laterAssistantText: CHECK_MET,
    });
    const delivered: { nodeId: string; ids: readonly string[] }[] = [];
    let sentDuringFirstStep = false;

    const result = await runLoopGraph(graph, {
      runId: 'instruction-delivery',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        promptFor: (node) => {
          const prompt = chatPromptFor(node, {
            entryId: graph.entry,
            mandate: 'Make the window remember what it did.',
          });
          const taken = queue.takeFor('instruction-delivery');
          // The person types *while the first step is working* — so after that
          // step's prompt has been built and sent, and before the next one is.
          // Queued here rather than above precisely because the order is what is
          // under test: a message that arrives before the prompt is built is not
          // the case DSP-32 is about.
          if (!sentDuringFirstStep) {
            sentDuringFirstStep = true;
            queue.add('instruction-delivery', 'also check the Linux build', 'a');
          }
          if (taken.length === 0) {
            return prompt;
          }
          delivered.push({ nodeId: node.id, ids: taken.map((each) => each.id) });
          return `${instructionPreamble(taken.map((each) => each.text))}${prompt}`;
        },
      }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(adapter.sends.length, 2, 'the chat graph walks work and then check');
    assert.equal(
      adapter.sends[0]?.includes('also check the Linux build'),
      false,
      'the step already working must not be told: DSpatch cannot change a provider call ' +
        'it has already sent, and claiming otherwise is the one thing §4.4 forbids outright',
    );
    assert.equal(
      adapter.sends[1]?.includes('also check the Linux build'),
      true,
      'and the next step to start must actually receive it, whole',
    );
    assert.match(adapter.sends[1] ?? '', new RegExp(INSTRUCTION_BLOCK_OPEN.replaceAll('=', '\\=')));
    // The message reached "check", which is a fact recorded after the event
    // rather than a rule that the next agent always gets it.
    assert.deepEqual(
      delivered.map((each) => each.nodeId),
      ['check'],
    );
    // And it is handed over once. A correction applied twice cannot be un-applied.
    assert.deepEqual(queue.peekFor('instruction-delivery'), []);
  });

  /**
   * The negative control for the test above.
   *
   * Without the queue, the two prompts must be indistinguishable in the respect
   * being measured — neither carries the message. If this ever fails, the
   * assertion above is passing on something other than the delivery.
   */
  it('negative control: without the queue neither step carries the message', async () => {
    const workspace = scratch('instruction-delivery-control');
    const graph = loadChatGraph();
    const adapter = new FakeAdapter({
      assistantText: WORK_SUCCEEDED,
      laterAssistantText: CHECK_MET,
    });
    await runLoopGraph(graph, {
      runId: 'instruction-delivery-control',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        promptFor: (node) =>
          chatPromptFor(node, {
            entryId: graph.entry,
            mandate: 'Make the window remember what it did.',
          }),
      }),
    });
    for (const sent of adapter.sends) {
      assert.equal(sent.includes('also check the Linux build'), false);
      assert.equal(sent.includes(INSTRUCTION_BLOCK_OPEN), false);
    }
  });

  /**
   * DSP-57 #1, at the point where the defect actually lived.
   *
   * `dspatch-live-duration`'s agent node declares no outcomes, which is exactly
   * the shape that used to turn silence into success: an empty reply fell through
   * every reading of the text and landed on plain `success`, took the `e-edit`
   * success edge and carried on to the gate as though the step had done the work.
   * The test directly above shows that same node completing on `DONE` — so these
   * two together are the measurement, not the assertion: same graph, same node,
   * same executor, and the only difference is whether the agent said anything.
   *
   * It is a fault rather than a quieter outcome because the drawing gives this
   * node no name for a result it could not establish. There is nothing honest to
   * route on, and inventing one would be the same class of error in the other
   * direction.
   */
  it('never reads an empty reply as success, even where the drawing offers no other name', async () => {
    const workspace = scratch('empty-reply-duration');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'empty-reply-duration',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: '' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'no-outcome-delivered');
    assert.match(result.fault?.detail ?? '', /wrote nothing at all/);
    assert.match(result.fault?.detail ?? '', /is not a result and is not a success/);
    // The run must not have walked on as though the step had worked.
    assert.equal(result.terminalNodeId, null);
    assert.equal(result.edgesTaken.includes('e-edit'), false);
  });

  /**
   * Whitespace is silence. A provider that ends a turn with a stray newline must
   * not be treated differently from one that ends it with nothing, or the rule
   * above is one space away from being bypassed.
   */
  it('treats a reply that is only whitespace the same as an empty one', async () => {
    const workspace = scratch('whitespace-reply-duration');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'whitespace-reply-duration',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: '  \n\t\n ' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: passingTest,
      }),
    });
    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'no-outcome-delivered');
  });

  /**
   * The same silence on the chat loop, whose nodes *do* draw a name for an
   * unestablished result. There it is not a fault: the drawing has somewhere
   * honest to send it, and the run ends at *Could not establish* rather than at
   * *Assignment met*. Both halves matter — the run must not break, and it must
   * not pass.
   */
  it('sends a silent chat-loop step to the ending that says nothing was established', async () => {
    const workspace = scratch('empty-reply-chat');
    const result = await runLoopGraph(loadChatGraph(), {
      runId: 'empty-reply-chat',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: '' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
      }),
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'not-established');
    assert.deepEqual(result.edgesTaken, ['e-unclear']);
  });

  /**
   * And a gate that draws no third verdict still stops, on the same fixture.
   *
   * The pair of this and the `not-checked` run above is what keeps DSP-44's "exactly
   * one state moves" honest for graphs written before today: the executor's new
   * branch is gated on the node's own declaration, not on the command record alone.
   */
  it('still faults a gate with nothing to run when the graph draws no verdict for it', async () => {
    const workspace = scratch('duration-nothing-to-run');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'duration-nothing-to-run',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: 'DONE' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: () => runConfiguredProjectTest('', workspace),
      }),
    });
    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'no-outcome-delivered');
    assert.match(
      result.fault?.detail ?? '',
      /no "not-verified" outcome to route that through/,
      'and the fault must say the drawing is why, rather than leaving it to be guessed',
    );
  });
});

describe('runConfiguredProjectTest — the window\'s field, not a suggestion', () => {
  it('runs the command it was given, in the directory it was given', async () => {
    const workspace = scratch('configured-command');
    // No package.json and no test/duration.test.ts: the shape of the project the
    // first real run met, where every suggestion DSpatch can make is empty.
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'project(spike)\n', 'utf8');
    // Named relatively, so running it at all also proves the working directory
    // travelled with the command rather than being worked out again.
    fs.writeFileSync(
      path.join(workspace, 'gate-marker.js'),
      "process.stdout.write('gate-marker-8f21');\n",
      'utf8',
    );

    const record = await runConfiguredProjectTest(`"${process.execPath}" gate-marker.js`, workspace);

    assert.match(
      record.command,
      /gate-marker\.js/,
      `DSpatch must report running the configured command. It reported: ${record.command || '(nothing)'}`,
    );
    assert.equal(record.stdout.trim(), 'gate-marker-8f21', 'and must actually have run it');
    assert.equal(record.cwd, path.resolve(workspace));
    assert.equal(record.exitCode, 0);
    assert.equal(record.notRun, null);
  });

  it('starts no process when the field cannot be used, and says why rather than failing', async () => {
    const workspace = scratch('configured-empty');
    const empty = await runConfiguredProjectTest('   ', workspace);
    assert.match(
      empty.notRun?.message ?? '(DSpatch claimed it ran something)',
      /no command to run/,
      'an empty Command field is "we did not test", not an exit code',
    );
    // The kind, not only the sentence: DSP-26 #2 needs "nothing was configured"
    // told apart from "there was a command and it would not start", and a reader of
    // the record reasons about this field rather than about the prose beside it.
    assert.equal(empty.notRun?.kind, 'no-command-configured');
    assert.equal(empty.exitCode, null, 'and carries no exit code that could be read as a failure');
    assert.equal(empty.durationMs, 0);

    const missing = await runConfiguredProjectTest(
      'echo hello',
      path.join(workspace, 'no-such-folder'),
    );
    assert.match(missing.notRun?.message ?? '(DSpatch claimed it ran something)', /no folder at/);
    assert.equal(missing.notRun?.kind, 'no-command-configured');
    assert.equal(missing.exitCode, null);
  });
});

/**
 * The fault the Verifier of run `20260917-182500-gate18` measured: `finishCommand`
 * listened for `close` and not for `error`, so a command that could not be started
 * at all produced an uncaught `ENOENT` in the Electron main process **and a promise
 * that never settled**. The gate never returned and the whole run hung — DSpatch
 * reported nothing, forever, which is worse than reporting the wrong thing.
 *
 * `runNodeProjectTest` is the reachable route to it: unlike the configured gate it
 * spawns without a shell and without `checkRunRequest`, so a working directory that
 * is not there arrives as `error` rather than as a refusal.
 *
 * The timeout is what makes this a proof rather than a hang. Without the fix the
 * race below resolves on the timer, and the first assertion prints what a person
 * would have been left looking at.
 */
describe('a command that cannot be started at all', () => {
  it('reports that it could not be started, rather than leaving the run hanging', async () => {
    const gone = path.join(scratch('no-cwd'), 'deleted-between-send-and-gate');
    const outcome = await Promise.race([
      runNodeProjectTest(gone),
      new Promise<'never settled'>((resolve) => {
        setTimeout(() => {
          resolve('never settled');
        }, 8_000).unref();
      }),
    ]);
    assert.notEqual(
      outcome,
      'never settled',
      'a command that cannot start must end the step; without an error listener the ' +
        'promise never settles and the whole loop run hangs with nothing on screen',
    );
    const record = outcome as LiveCommandRecord;
    assert.match(
      record.notRun?.message ?? '(DSpatch claimed it ran something)',
      /could not start the command/,
      `DSpatch must say it could not start the command. It said: ${
        record.notRun?.message ?? `exit ${String(record.exitCode)}`
      }`,
    );
    assert.equal(
      record.notRun?.kind,
      'could-not-start',
      'and must record it as unstartable rather than as nothing being configured',
    );
    // No fabricated exit code. There was no process, so there is no code, and the
    // one thing this must never become is a number a gate can read as a failure.
    assert.equal(record.exitCode, null);
  });
});

/**
 * The same user-visible failure as above, reached by the route W2's fix does not
 * cover, and measured by the Verifier of run `20260917-204500-obs18`.
 *
 * `StepContext.deadlineAt` is raced against the provider turn in the agent branch.
 * The gate branch was a bare `await runTest(…)` with nothing beside it, so the
 * bound the graph declares was simply not enforced for a gate: the runner never
 * regained control to check it. A command that did not come back — measured on a
 * bare `.ps1` sitting on an invisible Windows file chooser — held the whole run
 * open with no ending, no output and no window.
 *
 * `runProjectTest` here never settles and cannot be killed, which is the case only
 * the executor can answer: the bound inside `runConfiguredProjectTest` stops the
 * *process*, and this one stops the *run* from waiting. Both are needed, because
 * only the spawner can kill and only the executor can decline to wait.
 */
describe('a gate whose command never comes back', () => {
  it('stops waiting at the step\'s own deadline and says what is unknown', async () => {
    const graph = loadLiveGraph();
    const gate = graph.nodes.find((node) => node.id === 'verify');
    assert.ok(gate, 'the duration fixture still has its shell gate');
    const workspace = scratch('gate-deadline');
    const inspection = emptyInspection(workspace, 'composer-2');
    const executor = createLiveExecutor({
      workspacePath: workspace,
      adapter: new FakeAdapter(),
      modelRequested: 'composer-2',
      inspection,
      runProjectTest: () => new Promise<LiveCommandRecord>(() => {
        // Never settles, and holds no child this executor could kill.
      }),
    });

    const stalled = await Promise.race([
      executor({
        runId: 'gate-deadline',
        graph,
        node: gate,
        occurrence: 1,
        callId: 1,
        limits: { maxMinutes: 1 },
        deadlineAt: Date.now() + 600,
        archive: null,
      }),
      new Promise<'never returned'>((resolve) => {
        setTimeout(() => {
          resolve('never returned');
        }, 20_000).unref();
      }),
    ]);
    assert.notEqual(
      stalled,
      'never returned',
      'a gate whose command does not come back must end the step at its deadline; ' +
        'otherwise the run has no ending, nothing on screen and no record of why',
    );

    const execution = stalled as StepExecution;
    assert.equal(
      inspection.commands[0]?.notRun?.kind,
      'did-not-finish',
      `and the command must be recorded as one that did not finish, so the run's outcome ` +
        `is unresolved rather than a pass or a failure. It recorded: ${JSON.stringify(
          inspection.commands[0]?.notRun ?? null,
        )}`,
    );
    assert.equal(execution.product.kind, 'runtime-fault');
    if (execution.product.kind === 'runtime-fault') {
      assert.equal(
        execution.product.fault,
        'step-timed-out',
        'a bound that was spent is a spent bound, not a missing answer',
      );
      assert.match(
        execution.product.detail ?? '',
        /did not finish/,
        'and the detail must say what happened in the words the record uses',
      );
    }
    assert.equal(execution.providerTurns, 0, 'and a gate still spends no provider turn');
  });
});

/**
 * The sentence DSpatch writes when it gives up on a command.
 *
 * Fast and pure on purpose. The end-to-end version of this is in
 * `gate-command-reality.test.ts`, which really spawns something that will not come
 * back; these assert the words, because the words are the defect. The Verifier of
 * run `20260917-204500-obs18` made a descendant survive and confirmed with
 * `Get-Process` that DSpatch had already written *"so DSpatch stopped it"* — the same
 * bytes it writes when the tree really dies.
 */
describe('describeStoppedCommand', () => {
  it('says what DSpatch asked for, not what it achieved', () => {
    const said = describeStoppedCommand({
      timeoutMs: 15 * 60_000,
      stdout: 'building…',
      stderr: '',
    });
    assert.doesNotMatch(
      said,
      /so DSpatch stopped it/,
      `DSpatch cannot know that it stopped the command — killCommandTree never reads ` +
        `taskkill's exit code — so it must not say it did. It said: ${said}`,
    );
    assert.match(
      said,
      /asked the operating system to stop it/,
      `it must say what it actually did. It said: ${said}`,
    );
    assert.match(
      said,
      /may still be running/,
      `and that the command may still be running, which is what makes the record ` +
        `checkable. It said: ${said}`,
    );
    assert.match(
      said,
      /check for it before starting another run/,
      `and what to do about it — the same wording the gate's outer backstop already ` +
        `uses forty lines away. It said: ${said}`,
    );
    assert.match(said, /not a test failure and not a pass/, 'and it claims neither');
  });

  it('names the reason a process can survive, so the caveat is not mysterious', () => {
    const said = describeStoppedCommand({ timeoutMs: 60_000, stdout: '', stderr: '' });
    assert.match(
      said,
      /intermediate that has already exited/,
      `a caveat with no reason reads as boilerplate. The measured case is a helper started ` +
        `through a launcher that exited before the kill, whose parent link is stale. ` +
        `It said: ${said}`,
    );
  });

  it('does not tell a person their command ran for zero minutes', () => {
    // Four seconds is the bound the Verifier of this run actually used, and every one of
    // its logs reads "still running after 0 minutes".
    const short = describeStoppedCommand({ timeoutMs: 4_000, stdout: '', stderr: '' });
    assert.doesNotMatch(
      short,
      /0 minutes/,
      `a command that ran for four seconds did not run for zero minutes. It said: ${short}`,
    );
    assert.match(short, /after 4 seconds/, `it must name the bound it was given. It said: ${short}`);

    const said = describeStoppedCommand({ timeoutMs: 45_000, stdout: '', stderr: '' });
    assert.doesNotMatch(
      said,
      /1 minutes/,
      `a 45-second budget is not a minute either, and the graph editor is about to let a ` +
        `person draw one. It said: ${said}`,
    );
    assert.match(said, /after 45 seconds/, `it must name the bound it was given. It said: ${said}`);
  });
});

describe('describeBound', () => {
  it('uses the largest unit that does not round the bound away', () => {
    assert.equal(describeBound(15 * 60_000), '15 minutes');
    assert.equal(describeBound(60_000), '1 minute');
    assert.equal(describeBound(45_000), '45 seconds');
    assert.equal(describeBound(1_000), '1 second');
    assert.equal(
      describeBound(400),
      'less than a second',
      'not "0 seconds" and not rounded up to one: below the smallest unit worth printing, ' +
        'say so rather than naming a duration',
    );
    assert.equal(describeBound(90 * 60_000), '1.5 hours');
  });
});

describe('refuseLiveWorkspace', () => {
  it('refuses DSpatch itself as a live workspace', () => {
    const message = refuseLiveWorkspace(repoRoot, path.join(repoRoot, 'app'));
    assert.ok(message, 'DSpatch must be refused');
    assert.match(message, /Refusing to open/);
  });

  it('allows an isolated experiment repository', () => {
    const workspace = path.join(scratch('allow'), 'duration-repo');
    generateExperimentRepo(workspace, repoRoot);
    assert.equal(refuseLiveWorkspace(workspace, path.join(repoRoot, 'app')), null);
  });
});

/**
 * DSP-51. What the conversation says while the run is standing still.
 *
 * Confirmation is gone from the chat loop. The duration fixture still has a
 * shell gate, and a journal `waiting-for-person` entry must still reach the
 * ticker while that gate is waiting — otherwise a person who did not look
 * right reads a hang. The pipeline is App.tsx's own: journal → live-log line →
 * activity ticker, asserted from inside `runProjectTest`.
 */
describe('the conversation says that the run is waiting for a person', () => {
  interface TickerReading {
    readonly text: string;
    readonly source: string;
  }

  /** App.tsx's own three steps, in its own order. */
  function ticker(lines: readonly string[]): TickerReading | null {
    const line = activityLine({
      loopLines: lines,
      loopRunning: true,
      chatActivityText: null,
      chatRunning: false,
    });
    return line === null ? null : { text: line.text, source: line.source };
  }

  it('shows the wait in the ticker while the gate is still waiting for the answer', async () => {
    const workspace = scratch('gate-waiting-line');
    const lines: string[] = [];
    /** What the ticker read at the moment the gate had asked and had no answer. */
    let whileWaiting: TickerReading | null = null;
    /** And what it read immediately before, which is the sentence that used to stick. */
    let beforeAsking: TickerReading | null = null;

    const duration = loadLiveGraph();
    const result = await runLoopGraph(duration, {
      runId: 'gate-waiting-line',
      dryRun: false,
      onJournalEntry: (entry) => {
        const line = formatChatLiveLogLine(entry, lookupFromGraph(duration));
        if (line !== null) {
          lines.push(line);
        }
      },
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: 'DONE' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: async (cwd, note) => {
          beforeAsking = ticker(lines);
          note(
            'waiting-for-person',
            'DSpatch is waiting for you before it runs anything. It proposed ' +
              '`ctest --test-dir build` and put it in the Command field. The question is ' +
              'beside this conversation, under "The check this loop worked out".',
            { command: 'ctest --test-dir build', waitsForMs: 600_000 },
          );
          // The answer arrives from outside the gate, as a button press does, and the
          // reading is taken before it does.
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 5).unref?.();
          });
          whileWaiting = ticker(lines);
          note('person-answered', 'You chose to run the command, after 5 seconds.', {
            answer: 'run',
            waitedMs: 5_000,
          });
          return {
            command: 'cmd.exe /d /s /c ctest --test-dir build',
            line: 'ctest --test-dir build',
            cwd,
            exitCode: 0,
            signal: null,
            durationMs: 3,
            startedAtUtc: '2026-09-18T18:00:00.000Z',
            stdout: '100% tests passed',
            stderr: '',
            notRun: null,
          };
        },
      }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.terminalNodeId, 'done');

    const stuck = beforeAsking as TickerReading | null;
    assert.match(
      stuck?.text ?? '',
      /Entered gate/,
      'the sentence the ticker held before the gate asked, which is what it used to keep',
    );

    const waiting = whileWaiting as TickerReading | null;
    assert.ok(waiting, 'the ticker must say something while the run is waiting');
    assert.doesNotMatch(
      waiting.text,
      /Entered gate/,
      'and it must no longer be the line about entering the gate, which says nothing ' +
        'about a person being waited for',
    );
    assert.match(waiting.text, /waiting for you/);
    assert.match(waiting.text, /ctest --test-dir build/, 'it names the command being waited on');
    assert.match(
      waiting.text,
      /The check this loop worked out/,
      'and says which column the answer goes in, which is the whole reason the wait ' +
        'looked like a hang',
    );
    assert.equal(
      waiting.source,
      'loop-journal',
      'the sentence is a recorded entry rather than something the window invented',
    );

    // And the wait ends visibly rather than leaving the ticker on "waiting for you".
    assert.match(lines[lines.length - 1] ?? '', /Run ended/);
    assert.ok(
      lines.some((line) => /You chose to run the command/.test(line)),
      'the answer is written down too, so the log does not stop at the question',
    );
  });

  /**
   * The same two entries, in the run's own history rather than in the window.
   *
   * `main.ts` writes every journal entry to the run record with `record.journal`, so
   * an entry that reaches `onJournalEntry` is an entry that reaches the file. What
   * the record gains is a fact it had no way to hold: that this run spent time
   * waiting on a person, at which node, and how long.
   */
  it('records the wait against the gate, with how long it lasted', async () => {
    const workspace = scratch('gate-waiting-record');
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'gate-waiting-record',
      dryRun: false,
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter: new FakeAdapter({ assistantText: 'DONE' }),
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        runProjectTest: async (cwd, note) => {
          note('waiting-for-person', 'DSpatch is waiting for you before it runs anything.', {
            command: 'ctest --test-dir build',
          });
          note('person-answered', 'You chose not to run the command, after 12 seconds.', {
            answer: 'skip',
            waitedMs: 12_000,
          });
          return {
            command: 'ctest --test-dir build',
            cwd,
            exitCode: null,
            signal: null,
            durationMs: 0,
            startedAtUtc: '2026-09-18T18:00:00.000Z',
            stdout: '',
            stderr: '',
            notRun: {
              kind: 'no-command-configured' as const,
              message: 'You chose not to run the command this loop proposed.',
            },
          };
        },
      }),
    });

    const asked = result.journal.find((entry) => entry.kind === 'waiting-for-person');
    const answered = result.journal.find((entry) => entry.kind === 'person-answered');
    assert.equal(asked?.nodeId, 'verify', 'the wait belongs to the step that is waiting');
    assert.equal(answered?.nodeId, 'verify');
    assert.equal(answered?.data?.['answer'], 'skip');
    assert.equal(answered?.data?.['waitedMs'], 12_000);
    assert.ok(
      result.journal.findIndex((entry) => entry.kind === 'waiting-for-person') >
        result.journal.findIndex(
          (entry) => entry.kind === 'node-entered' && entry.nodeId === 'verify',
        ),
      'recorded after the gate was entered, because the step really is running — this ' +
        'is the opposite of run-held, which is recorded before a step that has not started',
    );
    assert.equal(
      result.journal.some((entry) => entry.kind === 'run-held'),
      false,
      'and it must not be reported as a pause: nobody paused this run',
    );
  });

  /**
   * The graph view, which is a second reader of the same entries.
   */
  it('marks the waiting gate as waiting and puts it back to work on the answer', () => {
    const view = runViewFor({
      runId: 'r',
      graphVersionId: 'v',
      graphId: 'dspatch-chat-loop',
      graphName: 'chat',
      binding: 'chat-loop',
      graphText: '{}',
      startedAtUtc: '2026-09-18T18:00:00.000Z',
    });
    const entryAt = (seq: number, kind: JournalKind): RunJournalEntry => ({
      seq,
      atIso: '2026-09-18T18:00:00.000Z',
      sinceStartMs: seq,
      kind,
      nodeId: 'check',
      detail: '',
    });
    const entries = [entryAt(1, 'node-entered'), entryAt(2, 'waiting-for-person')];
    assert.equal(nodeRunStateFor(nodeRunStates({ ...view, entries }), 'check'), 'waiting');
    assert.equal(
      nodeRunStateFor(
        nodeRunStates({ ...view, entries: [...entries, entryAt(3, 'person-answered')] }),
        'check',
      ),
      'active',
    );
  });
});

describe('createDryRunExecutor remains unable to reach a provider', () => {
  it('still reports 0 turns on the live graph and never needs an adapter', async () => {
    const result = await runLoopGraph(loadLiveGraph(), {
      runId: 'dry-on-live-graph',
      dryRun: true,
      executor: createDryRunExecutor({
        decisions: [{ node: 'implementer', produce: { kind: 'success' } }],
      }),
    });
    assert.equal(result.usage.providerTurns, 0);
    assert.equal(result.dryRun, true);
    assert.equal(result.status, 'completed');
  });
});
