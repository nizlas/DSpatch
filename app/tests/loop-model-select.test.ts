/**
 * DSP-209 S19: per-step model selection (R6).
 *
 * One scripted drawing throughout, built in this file (decision 37: no shipped graph is
 * changed): "plan" answers small or large, and "build" chooses its model from a `select`
 * policy by the edge it arrived on. No provider is reached; the adapter is a fake that
 * records what each session was opened with.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

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
  UsageReading,
} from '../src/adapter/types';
import { createLiveExecutor, emptyInspection } from '../src/main/loop-live';
import { loopRunAgentInfo, prepareLoopRun, type LoopRunAgentRequest } from '../src/main/loop-run-agent';
import {
  LOOP_GRAPH_FORMAT,
  LOOP_GRAPH_FORMAT_VERSION,
  stepModelChoice,
  type LoopGraph,
  type LoopNode,
} from '../src/shared/loop-graph';
import { checkLoopGraph, hasErrors, parseLoopGraph } from '../src/shared/loop-graph-load';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import {
  MODEL_DEFAULT_REASON,
  latestModelSelection,
  modelSelectionFromData,
  runLoopGraph,
  type RunJournalEntry,
} from '../src/shared/loop-run';

const scratchRoots: string[] = [];
function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-model-select-${name}-`));
  scratchRoots.push(dir);
  return dir;
}
after(() => {
  for (const root of scratchRoots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

const SELECT: LoopNode['model'] = {
  policy: 'select',
  options: [
    { id: 'small', model: 'model-s', note: 'a one-file change' },
    { id: 'large', model: 'model-l' },
  ],
  default: 'large',
};

function graph(build: LoopNode['model'] | null = SELECT, plan?: LoopNode['model']): LoopGraph {
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'model-select',
    name: 'Model select loop',
    purpose: 'Choose the implementer model by the size of the work.',
    target: 'cursor',
    entry: 'plan',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [],
    nodes: [
      { id: 'plan', kind: 'agent', label: 'Plan', outcomes: ['small', 'large'], ...(plan === undefined ? {} : { model: plan }) },
      { id: 'build', kind: 'agent', label: 'Build', ...(build === null || build === undefined ? {} : { model: build }) },
      { id: 'done', kind: 'terminal', label: 'Done' },
    ],
    edges: [
      {
        id: 'e-small',
        from: 'plan',
        to: 'build',
        when: { on: 'outcome', outcome: 'small' },
        ...(build?.policy === 'select' ? { selectsModel: 'small' } : {}),
      },
      { id: 'e-large', from: 'plan', to: 'build', when: { on: 'outcome', outcome: 'large' } },
      { id: 'e-built', from: 'build', to: 'done', when: { on: 'success' } },
    ],
  };
}

function entered(journal: readonly RunJournalEntry[], nodeId: string): RunJournalEntry {
  const entry = journal.find((candidate) => candidate.kind === 'node-entered' && candidate.nodeId === nodeId);
  assert.ok(entry !== undefined, `"${nodeId}" was entered`);
  return entry;
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

/** Replies by session: "plan" answers `planReply`, "review" `reviewReplies` in turn, the rest "DONE". */
class FakeAdapter implements AgentAdapter {
  readonly configs: SessionConfig[] = [];
  readonly switched: { readonly sessionId: string; readonly model: string }[] = [];
  readonly sends: string[] = [];
  private readonly listeners = new Map<string, Set<AgentEventListener>>();
  private reviews = 0;
  private readonly planReply: string;
  private readonly provider: 'cursor' | 'claude';
  private readonly reviewReplies: readonly string[];
  constructor(planReply: string, provider: 'cursor' | 'claude' = 'cursor', reviewReplies: readonly string[] = []) {
    this.planReply = planReply;
    this.provider = provider;
    this.reviewReplies = reviewReplies;
  }
  private replyFor(sessionId: string): string {
    if (sessionId.endsWith('--plan')) {
      return this.planReply;
    }
    if (sessionId.includes('--review')) {
      this.reviews += 1;
      return this.reviewReplies[this.reviews - 1] ?? 'RESULT: accept';
    }
    return 'DONE';
  }
  async startSession(config: SessionConfig): Promise<SessionHandle> {
    this.configs.push(config);
    const dspatchSessionId = config.dspatchSessionId ?? 'dsp-session-fake';
    return { dspatchSessionId, provider: this.provider, providerSessionId: `p-${dspatchSessionId}`, createdAt: new Date().toISOString() };
  }
  setSessionModel(sessionId: DspatchSessionId, modelId: string): void {
    this.switched.push({ sessionId, model: modelId });
  }
  resume(): Promise<SessionHandle> {
    return Promise.reject(new Error('not used'));
  }
  async send(sessionId: DspatchSessionId, prompt: string): Promise<RunReference> {
    this.sends.push(prompt);
    const dspatchRunId = `run-${String(this.sends.length)}`;
    const base = { dspatchSessionId: sessionId, dspatchRunId, rawProviderEvent: null };
    this.emit(sessionId, { ...base, type: 'run.started', at: new Date().toISOString() });
    const text = this.replyFor(sessionId);
    queueMicrotask(() => {
      this.emit(sessionId, { ...base, type: 'assistant.message', at: new Date().toISOString(), text });
      this.emit(sessionId, { ...base, type: 'run.finished', at: new Date().toISOString(), status: 'finished' });
    });
    return { dspatchRunId };
  }
  subscribe(sessionId: DspatchSessionId, onEvent: AgentEventListener): Unsubscribe {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(onEvent);
    this.listeners.set(sessionId, set);
    return () => set.delete(onEvent);
  }
  async cancel(): Promise<void> {}
  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve([]);
  }
  readUsage(): Promise<readonly UsageReading[]> {
    return Promise.resolve([]);
  }
  respondToApproval(): Promise<void> {
    return Promise.reject(new Error('unsupported'));
  }
  capabilities(): CapabilityReport {
    return CAPABILITIES;
  }
  async dispose(): Promise<void> {}
  private emit(sessionId: string, event: AgentEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) {
      listener(event);
    }
  }
}

async function liveRun(g: LoopGraph, adapter: FakeAdapter, provider: 'cursor' | 'claude' = 'cursor') {
  const workspace = scratch('live');
  fs.writeFileSync(path.join(workspace, 'README.md'), 'scratch\n');
  return runLoopGraph(g, {
    runId: 'model-run',
    dryRun: false,
    runModel: { provider, model: 'run-model' },
    executor: createLiveExecutor({
      workspacePath: workspace,
      adapter,
      provider,
      modelRequested: 'run-model',
      inspection: emptyInspection(workspace, 'run-model'),
    }),
  });
}

describe('the select policy in the drawing', () => {
  it('parses, validates and saves with a fixed key order; a graph without it saves as before', () => {
    const text = serialiseLoopGraph(graph());
    assert.ok(
      text.includes('"model": { "policy": "select", "options": [{ "id": "small", "model": "model-s", "note": "a one-file change" }, { "id": "large", "model": "model-l" }], "default": "large" }'),
      text,
    );
    assert.ok(text.includes('"skips"') === false && text.includes('"selectsModel": "small"'));
    const parsed = parseLoopGraph(text);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.ok);
    // The scripted agents name no role, which this test is not about.
    const errors = checkLoopGraph(parsed.graph).filter((finding) => finding.code !== 'agent-without-role');
    assert.equal(hasErrors(errors), false, JSON.stringify(errors));
    assert.equal(serialiseLoopGraph(parsed.graph), text, 'it round-trips byte-identically');

    const plain = graph({ policy: 'fixed', model: 'model-f' });
    const plainText = serialiseLoopGraph(plain);
    assert.equal(plainText.includes('selectsModel'), false);
    assert.ok(plainText.includes('"model": { "policy": "fixed", "model": "model-f" }'));
  });

  it('refuses an edge choosing an option the target does not offer, and a default that names none', () => {
    const wrong = graph();
    const edges = wrong.edges.map((edge) => (edge.id === 'e-small' ? { ...edge, selectsModel: 'tiny' } : edge));
    const codes = checkLoopGraph({ ...wrong, edges }).map((finding) => finding.code);
    assert.ok(codes.includes('selects-a-missing-model-option'), codes.join(', '));

    const text = serialiseLoopGraph(graph({ ...SELECT, default: 'medium' } as LoopNode['model']));
    const parsed = parseLoopGraph(text);
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && parsed.findings.some((finding) => finding.code === 'select-model-bad-default'));
  });

  it('chooses by the arriving edge, else the default, and leaves inherit to the run', () => {
    const node = { model: SELECT };
    assert.deepEqual(stepModelChoice(node, { selectsModel: 'small' }), { model: 'model-s', policy: 'select', option: 'small', by: 'edge', modelClass: null, classUnmapped: false, choice: null });
    assert.deepEqual(stepModelChoice(node, null), { model: 'model-l', policy: 'select', option: 'large', by: 'default', modelClass: null, classUnmapped: false, choice: null });
    assert.deepEqual(stepModelChoice({ model: { policy: 'inherit' } }, { selectsModel: 'small' }), {
      model: null,
      policy: 'inherit',
      option: null,
      by: null,
      modelClass: null,
      classUnmapped: false,
      choice: null,
    });
  });

  it('DSP-222: resolves a model class through the provider\'s mapping, and an unmapped class to the run\'s model', () => {
    const node = { model: { policy: 'select' as const, options: [{ id: 'small', modelClass: 'small' as const }, { id: 'large', modelClass: 'large' as const }], default: 'large' } };
    assert.deepEqual(stepModelChoice(node, { selectsModel: 'small' }, { small: 'mapped-small' }), { model: 'mapped-small', policy: 'select', option: 'small', by: 'edge', modelClass: 'small', classUnmapped: false, choice: null });
    assert.deepEqual(stepModelChoice(node, null, { small: 'mapped-small' }), { model: null, policy: 'select', option: 'large', by: 'default', modelClass: 'large', classUnmapped: true, choice: null });
  });
});

describe('a scripted run records and runs the chosen model', () => {
  it('picks "small" by the edge, with the model and the deciding step\'s reason recorded and the session opened with it', async () => {
    const adapter = new FakeAdapter('Planned.\n\nRESULT: small one file changes');
    const result = await liveRun(graph(), adapter);
    assert.equal(result.status, 'completed', JSON.stringify(result.fault));

    const record = modelSelectionFromData(entered(result.journal, 'build').data);
    assert.deepEqual(record, {
      provider: 'cursor',
      model: 'model-s',
      policy: 'select',
      option: 'small',
      reason: 'one file changes',
      source: 'policy',
    });
    assert.deepEqual(latestModelSelection(result.journal, 'build'), record);
    const build = adapter.configs.find((config) => config.dspatchSessionId?.endsWith('--build'));
    assert.equal(build?.modelRequested, 'model-s', 'the session asked for the chosen model');
    const plan = modelSelectionFromData(entered(result.journal, 'plan').data);
    assert.equal(plan?.model, 'run-model');
    assert.equal(plan?.source, 'person');
  });

  it('takes the default, with the reason "default", when the edge chooses none', async () => {
    const adapter = new FakeAdapter('Planned.\n\nRESULT: large');
    const result = await liveRun(graph(), adapter);
    assert.equal(result.status, 'completed');
    const record = modelSelectionFromData(entered(result.journal, 'build').data);
    assert.equal(record?.model, 'model-l');
    assert.equal(record?.option, 'large');
    assert.equal(record?.reason, MODEL_DEFAULT_REASON);
  });

  it('still runs a fixed-model graph, and honours a non-entry step\'s fixed model', async () => {
    const adapter = new FakeAdapter('RESULT: large');
    const result = await liveRun(graph({ policy: 'fixed', model: 'model-f' }), adapter);
    assert.equal(result.status, 'completed');
    assert.equal(adapter.configs.find((config) => config.dspatchSessionId?.endsWith('--build'))?.modelRequested, 'model-f');
    assert.equal(adapter.configs.find((config) => config.dspatchSessionId?.endsWith('--plan'))?.modelRequested, 'run-model');
    const record = modelSelectionFromData(entered(result.journal, 'build').data);
    assert.deepEqual(record, { provider: 'cursor', model: 'model-f', policy: null, option: null, reason: 'fixed by the step', source: 'fixed' });
  });

  it('runs and records an inherit step after a fixed entry with the person\'s model, not the entry\'s', async () => {
    // As the host runs it: the preparation's `modelRequested` is the entry's fixed model, and
    // `personModel` - what `runLiveGraph` hands the walk as `runModel` - the person's choice.
    const adapter = new FakeAdapter('RESULT: large');
    const workspace = scratch('person');
    fs.writeFileSync(path.join(workspace, 'README.md'), 'scratch\n');
    const result = await runLoopGraph(graph({ policy: 'inherit' }, { policy: 'fixed', model: 'model-entry' }), {
      runId: 'model-run',
      dryRun: false,
      runModel: { provider: 'cursor', model: 'person-model' },
      executor: createLiveExecutor({
        workspacePath: workspace,
        adapter,
        provider: 'cursor',
        modelRequested: 'model-entry',
        personModel: 'person-model',
        inspection: emptyInspection(workspace, 'model-entry'),
      }),
    });
    assert.equal(result.status, 'completed', JSON.stringify(result.fault));
    assert.deepEqual(
      adapter.configs.map((config) => [config.dspatchSessionId, config.modelRequested]),
      [
        ['dsp-session-model-run--plan', 'model-entry'],
        ['dsp-session-model-run--build', 'person-model'],
      ],
      'the entry keeps its fixed model; the inherit step opens with the person\'s',
    );
    const build = modelSelectionFromData(entered(result.journal, 'build').data);
    assert.equal(build?.model, 'person-model', 'the record names the model the session ran');
    assert.equal(build?.source, 'person');
    const plan = modelSelectionFromData(entered(result.journal, 'plan').data);
    assert.equal(plan?.model, 'model-entry');
    assert.equal(plan?.source, 'fixed');
  });

  it('changes no session and no prompt of an inherit graph', async () => {
    const withPolicy = new FakeAdapter('RESULT: small');
    const without = new FakeAdapter('RESULT: small');
    const inherit = await liveRun(graph({ policy: 'inherit' }, { policy: 'inherit' }), withPolicy);
    const none = await liveRun(graph(null), without);
    assert.equal(inherit.status, 'completed');
    assert.equal(none.status, 'completed');
    for (const adapter of [withPolicy, without]) {
      assert.deepEqual(
        adapter.configs.map((config) => [config.dspatchSessionId, config.modelRequested]),
        [
          ['dsp-session-model-run--plan', 'run-model'],
          ['dsp-session-model-run--build', 'run-model'],
        ],
      );
    }
    const strip = (prompts: readonly string[]) => prompts.map((prompt) => prompt.replace(/scratch[^\s]*/g, ''));
    assert.deepEqual(strip(withPolicy.sends), strip(without.sends), 'the prompts are the same');
  });
});

describe('a revisit with a different model', () => {
  // plan -> build (small) -> review -> build again (large, by the default).
  function revisiting(): LoopGraph {
    const base = graph();
    return {
      ...base,
      nodes: [
        ...base.nodes.filter((node) => node.id !== 'done'),
        { id: 'review', kind: 'agent', label: 'Review', outcomes: ['accept', 'rework'] },
        { id: 'done', kind: 'terminal', label: 'Done' },
      ],
      edges: [
        ...base.edges.filter((edge) => edge.id !== 'e-built'),
        { id: 'e-built', from: 'build', to: 'review', when: { on: 'success' } },
        { id: 'e-rework', from: 'review', to: 'build', when: { on: 'outcome', outcome: 'rework' } },
        { id: 'e-accept', from: 'review', to: 'done', when: { on: 'outcome', outcome: 'accept' } },
      ],
    };
  }
  const producedFor = (journal: readonly RunJournalEntry[], nodeId: string): readonly string[] =>
    journal.filter((entry) => entry.kind === 'node-produced' && entry.nodeId === nodeId).map((entry) => entry.detail);

  it('opens a new session on a provider other than Claude, and the journal says so', async () => {
    const adapter = new FakeAdapter('RESULT: small', 'cursor', ['RESULT: rework', 'RESULT: accept']);
    const result = await liveRun(revisiting(), adapter);
    assert.equal(result.status, 'completed', JSON.stringify(result.fault));
    const builds = adapter.configs.filter((config) => config.dspatchSessionId?.includes('--build'));
    assert.deepEqual(
      builds.map((config) => [config.dspatchSessionId, config.modelRequested]),
      [
        ['dsp-session-model-run--build', 'model-s'],
        ['dsp-session-model-run--build--visit-2', 'model-l'],
      ],
    );
    assert.equal(adapter.switched.length, 0);
    const second = producedFor(result.journal, 'build')[1] ?? '';
    assert.ok(second.includes('opened a new session'), second);
  });

  it('switches the model in the same session on Claude, for the next turn', async () => {
    const adapter = new FakeAdapter('RESULT: small', 'claude', ['RESULT: rework', 'RESULT: accept']);
    const result = await liveRun(revisiting(), adapter, 'claude');
    assert.equal(result.status, 'completed', JSON.stringify(result.fault));
    const builds = adapter.configs.filter((config) => config.dspatchSessionId?.includes('--build'));
    assert.equal(builds.length, 1, 'one session for the node');
    assert.deepEqual(adapter.switched, [{ sessionId: 'dsp-session-model-run--build', model: 'model-l' }]);
    const second = producedFor(result.journal, 'build')[1] ?? '';
    assert.ok(second.includes('switched in the same session'), second);
  });
});

describe('the check before a run starts', () => {
  const adapters = { preflight: () => null, createAdapter: () => { throw new Error('not built'); } };
  function request(g: LoopGraph | undefined, models: readonly string[]): LoopRunAgentRequest {
    return {
      sessionProvider: 'claude',
      chosenAgent: null,
      rootCount: 1,
      cursorModel: 'composer-2',
      claudeModel: 'model-l',
      claudeModels: models,
      adapters: adapters as unknown as LoopRunAgentRequest['adapters'],
      ...(g === undefined ? {} : { graph: g }),
    };
  }

  it('refuses a run whose option names a model Claude does not list, and starts nothing', () => {
    const prepared = prepareLoopRun(request(graph(), ['model-l']));
    assert.equal(prepared.ok, false);
    assert.ok(!prepared.ok && prepared.reason.includes('model-s') && prepared.reason.includes('option "small"'), !prepared.ok ? prepared.reason : '');
    assert.ok(!prepared.ok && prepared.reason.endsWith('Nothing was started.'));
  });

  it('accepts it when every model is listed, and keeps the entry-only check without the graph', () => {
    assert.equal(prepareLoopRun(request(graph(), ['model-s', 'model-l'])).ok, true);
    assert.equal(prepareLoopRun(request(undefined, ['model-l'])).ok, true);
  });

  it('keeps the entry\'s fixed model as modelRequested and gives the person\'s model separately', () => {
    const entryNode = { id: 'plan', label: 'Plan', model: { policy: 'fixed', model: 'model-s' } } as const;
    const prepared = prepareLoopRun({ ...request(undefined, ['model-s', 'model-l']), entryNode });
    assert.ok(prepared.ok);
    assert.equal(prepared.modelRequested, 'model-s');
    assert.equal(prepared.personModel, 'model-l');
    // The entry refusal is unchanged.
    const refusedEntry = prepareLoopRun({ ...request(undefined, ['model-l']), entryNode });
    assert.ok(!refusedEntry.ok && refusedEntry.reason.includes('first step'), !refusedEntry.ok ? refusedEntry.reason : '');
  });

  // DSP-209 S19b: Cursor and Copilot by the same rule, against their own lists.
  it('refuses a Cursor run whose option names a model Cursor does not list', () => {
    const prepared = prepareLoopRun({ ...request(graph(), []), sessionProvider: 'cursor', cursorModels: ['model-l'] });
    assert.ok(!prepared.ok && prepared.reason.includes('model-s') && prepared.reason.includes('which Cursor does not offer'), !prepared.ok ? prepared.reason : '');
    assert.ok(!prepared.ok && prepared.reason.endsWith('Nothing was started.'));
  });

  it('says plainly that a Copilot run’s models could not be checked when no list was read, and lets Copilot decide', () => {
    const unread = prepareLoopRun({ ...request(graph(), []), sessionProvider: 'copilot', copilotModel: 'gpt-x', copilotModels: null });
    assert.ok(unread.ok);
    assert.match(unread.modelCheck ?? '', /model-s, model-l\) could not be checked: Copilot's model list has not been read in this launch, so Copilot decides/);
    const info = loopRunAgentInfo({ ...request(graph(), []), sessionProvider: 'copilot', copilotModel: 'gpt-x', copilotModels: null });
    assert.ok(info.line.includes('could not be checked'), info.line);
    // Listed: checked, and nothing more is said.
    const listed = prepareLoopRun({ ...request(graph(), []), sessionProvider: 'copilot', copilotModels: ['model-s', 'model-l'] });
    assert.ok(listed.ok && listed.modelCheck === null);
  });

  it('leaves Claude’s check as it was: it says nothing extra when its list is read', () => {
    const prepared = prepareLoopRun(request(graph(), ['model-s', 'model-l']));
    assert.ok(prepared.ok && prepared.modelCheck === null);
  });

  it('names a select entry step’s default model on the "Runs with" line, and leaves a fixed entry’s line as it was', () => {
    const selectEntry = { id: 'build', label: 'Build', model: SELECT };
    const info = loopRunAgentInfo({ ...request(undefined, ['model-s', 'model-l']), entryNode: selectEntry });
    assert.ok(info.line.startsWith('Runs with Claude (model-l, option “large” by default; an edge may select another)'), info.line);
    const fixedEntry = { id: 'plan', label: 'Plan', model: { policy: 'fixed', model: 'model-s' } } as const;
    const fixedInfo = loopRunAgentInfo({ ...request(undefined, ['model-s', 'model-l']), entryNode: fixedEntry });
    assert.ok(fixedInfo.line.startsWith('Runs with Claude (model-s):'), fixedInfo.line);
  });
});
