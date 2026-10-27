/**
 * DSP-138: a loop run uses the chosen agent, and with Claude it goes through the real
 * `ClaudeAgentSdkAdapter` on a substituted SDK.
 *
 * The product's run path end to end - `prepareLoopRun`, then `runLiveGraph` with the
 * chat binding on the shipped `dspatch-chat-loop` drawing - with adapters from the
 * shared factory. Claude's adapter is the real one with `queryFn` and `spawnProcess`
 * substituted, so nothing loads `@anthropic-ai/claude-agent-sdk`, nothing is spawned and
 * nothing is sent anywhere; the offline guard would fail a load. Cursor's construction
 * is counted and throws, so a Claude run that reached it would fail here.
 *
 * What this shows is DSpatch's behaviour: which provider is used, bound and recorded,
 * where a result or a fault lands, and that a cancel stops the walk. It is not evidence
 * about Claude's behaviour, which only a live run can show.
 *
 *     node scripts/run-tests.mjs loop
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { CHAT_PERMISSIONS } from '../src/adapter/claude-agent-sdk-adapter.ts';
import { CLAUDE_NOT_INSTALLED_TEXT } from '../src/adapter/claude-support.ts';
import { createFileRoleResolver } from '../src/main/loop-graph-roles.ts';
import { runLiveGraph } from '../src/main/loop-live-run.ts';
import {
  loopRunAgentInfo,
  NOTHING_WAS_STARTED,
  prepareLoopRun,
  type LoopRunAgentRequest,
} from '../src/main/loop-run-agent.ts';
import { CLAUDE_CHAT_MODEL } from '../src/main/provider-availability.ts';
import { RunRecordStore } from '../src/main/run-record-store.ts';
import {
  CLAUDE_LOOP_STEP_TOOLS,
  describeRunToolPolicy,
  type LoopGraph,
} from '../src/shared/loop-graph.ts';
import { loadLoopGraph } from '../src/shared/loop-graph-load.ts';
import { adapters, claudeSdk, CLEAN_ENV } from './support/claude-loop-sdk.ts';
import { tempRoot } from './support/fixtures.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const CHAT_LOOP = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json');

function chatLoop(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(CHAT_LOOP, 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
  });
  assert.equal(loaded.ok, true, 'the shipped chat loop validates');
  if (!loaded.ok) {
    throw new Error('unreachable');
  }
  return loaded.graph;
}

function request(
  factory: LoopRunAgentRequest['adapters'],
  overrides: Partial<LoopRunAgentRequest> = {},
): LoopRunAgentRequest {
  const graph = chatLoop();
  const entryNode = graph.nodes.find((node) => node.id === graph.entry);
  return {
    sessionProvider: 'claude',
    chosenAgent: null,
    rootCount: 1,
    ...(entryNode === undefined ? {} : { entryNode }),
    cursorModel: 'composer-2',
    adapters: factory,
    ...overrides,
  };
}

function project(name: string): string {
  const dir = tempRoot(`loop-provider-${name}`);
  fs.writeFileSync(path.join(dir, 'README.md'), '# a project\n', 'utf8');
  return dir;
}

async function walk(
  name: string,
  prepared: Extract<ReturnType<typeof prepareLoopRun>, { ok: true }>,
  abort: AbortController = new AbortController(),
) {
  const workspace = project(name);
  const results = path.join(tempRoot(`loop-provider-${name}-results`), 'results');
  return runLiveGraph(chatLoop(), {
    runId: `run-${name}`,
    repoRoot,
    outDir: null,
    resultsDir: results,
    modelRequested: prepared.modelRequested,
    workspacePath: workspace,
    keepWorkspace: true,
    bindingKind: 'chat-loop',
    abortSignal: abort.signal,
    provider: prepared.provider,
    createAdapter: prepared.createAdapter,
  });
}

function prepared(req: LoopRunAgentRequest) {
  const outcome = prepareLoopRun(req);
  assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.reason);
  if (!outcome.ok) {
    throw new Error('unreachable');
  }
  return outcome;
}

// --- End to end ------------------------------------------------------------------

describe('a chat loop run with Claude, through the product run path', () => {
  it('walks work then check to "done", bound to Claude throughout, with the main chat permissions and no Cursor', async () => {
    const sdk = claudeSdk([
      { kind: 'answer', text: 'Read the README; nothing to change.\n\nRESULT: succeeded' },
      { kind: 'answer', text: 'The account matches the mandate.\n\nRESULT: met' },
    ]);
    const { factory, built } = adapters(sdk);
    const run = prepared(request(factory));
    assert.equal(run.provider, 'claude');
    assert.equal(run.modelRequested, CLAUDE_CHAT_MODEL);
    assert.equal(built.claudePermissions.length, 0, 'preparing constructs nothing');

    const delivery = await walk('happy', run);

    assert.equal(delivery.result.status, 'completed');
    assert.equal(delivery.result.terminalNodeId, 'done');
    assert.deepEqual(delivery.result.path, ['work', 'check', 'done']);
    assert.equal(delivery.inspection.provider, 'claude');
    assert.deepEqual(
      delivery.inspection.sessions.map((session) => [session.nodeId, session.provider]),
      [
        ['work', 'claude'],
        ['check', 'claude'],
      ],
    );
    assert.match(delivery.journalText, /agent {7}claude/);
    assert.equal(sdk.queries.length, 2);
    assert.equal(sdk.queries[0]?.options['model'], CLAUDE_CHAT_MODEL);
    assert.deepEqual(sdk.queries[0]?.options['tools'], [...CHAT_PERMISSIONS.tools]);
    assert.equal(built.claudePermissions.length, 1);
    assert.equal(built.claudePermissions[0], CHAT_PERMISSIONS, 'exactly the main chat policy object');
    assert.deepEqual(built.cursorPolicies, [], 'Cursor was never constructed');
    assert.equal(built.disposals, 1, 'the run disposed its adapter once');
    // The check step was handed the work step's account, not its conversation.
    assert.match(sdk.queries[1]?.prompt ?? '', /nothing to change/);
  });

  it('records the provider on the run record, and an older record without one reads as not recorded', () => {
    const store = new RunRecordStore(tempRoot('loop-provider-records'));
    const identity = {
      runId: 'run-record-claude',
      projectPath: 'C:/project',
      conversationId: null,
      mandate: 'Read the README.',
      graphId: 'dspatch-chat-loop',
      graphPath: CHAT_LOOP,
      graphVersionId: 'v1',
      modelRequested: CLAUDE_CHAT_MODEL,
      provider: 'claude' as const,
      appVersion: 'test',
      startedAtUtc: new Date().toISOString(),
    };
    store.open(identity);
    assert.equal(store.read('run-record-claude').record?.identity.provider, 'claude');
    const { provider: _dropped, ...older } = identity;
    store.open({ ...older, runId: 'run-record-older' });
    assert.equal(store.read('run-record-older').record?.identity.provider, undefined);
  });

  it('puts a step error on that step and on the run, and starts no later step', async () => {
    const sdk = claudeSdk([{ kind: 'fail', message: 'synthetic stream failure' }]);
    const { factory, built } = adapters(sdk);
    const delivery = await walk('step-error', prepared(request(factory)));

    assert.equal(delivery.result.status, 'runtime-fault');
    assert.equal(delivery.result.fault?.nodeId, 'work');
    assert.deepEqual(delivery.result.path, ['work']);
    assert.equal(sdk.queries.length, 1, 'check never sent');
    assert.deepEqual(built.cursorPolicies, []);
    assert.equal(built.disposals, 1);
  });

  it('stops on cancel during work: the turn is interrupted and check never sends', async () => {
    const abort = new AbortController();
    const sdk = claudeSdk([{ kind: 'until-interrupted' }], (index) => {
      if (index === 0) {
        setImmediate(() => abort.abort());
      }
    });
    const { factory, built } = adapters(sdk);
    const delivery = await walk('cancel', prepared(request(factory)), abort);

    assert.equal(delivery.inspection.cancelled, true);
    assert.equal(delivery.result.status, 'runtime-fault');
    assert.equal(delivery.result.fault?.nodeId, 'work');
    assert.match(delivery.result.fault?.detail ?? '', /operator cancelled "work"/);
    assert.equal(delivery.result.path.includes('check'), false);
    assert.equal(sdk.queries.length, 1, 'check never sent');
    assert.equal(sdk.queries[0]?.interrupts, 1);
    assert.equal(built.disposals, 1);
  });

  it('faults the step whose session an adapter opened for another provider, and sends nothing to it', async () => {
    const sdk = claudeSdk([{ kind: 'answer', text: 'RESULT: succeeded' }]);
    const { factory, built } = adapters(sdk, {}, { handleProvider: 'cursor' });
    const delivery = await walk('mismatch', prepared(request(factory)));

    assert.equal(delivery.result.status, 'runtime-fault');
    assert.equal(delivery.result.fault?.nodeId, 'work');
    assert.match(delivery.result.fault?.detail ?? '', /bound to claude/);
    assert.equal(sdk.queries.length, 0, 'nothing was sent');
    assert.equal(built.disposals, 1);
  });
});

// --- Refusals before the start ------------------------------------------------------

describe('a loop run that cannot start says why, and constructs nothing', () => {
  function refusal(outcome: ReturnType<typeof prepareLoopRun>): string {
    assert.equal(outcome.ok, false);
    if (outcome.ok) {
      throw new Error('unreachable');
    }
    assert.ok(outcome.reason.endsWith(NOTHING_WAS_STARTED), outcome.reason);
    return outcome.reason;
  }

  it('refuses when no agent is chosen, and never assumes Cursor', () => {
    const { factory, built } = adapters(null, {}, { cursorAllowed: true });
    const reason = refusal(prepareLoopRun(request(factory, { sessionProvider: null, chosenAgent: null })));
    assert.match(reason, /^No agent is chosen/);
    assert.deepEqual(built.cursorPolicies, []);
    assert.deepEqual(built.claudePermissions, []);
  });

  it('refuses uninstalled Claude support with its own sentence, offering no download', () => {
    const { factory, built } = adapters(null, { claudeInstalled: false });
    const reason = refusal(prepareLoopRun(request(factory)));
    assert.equal(reason, `${CLAUDE_NOT_INSTALLED_TEXT} ${NOTHING_WAS_STARTED}`);
    assert.deepEqual(built.claudePermissions, []);
    assert.deepEqual(built.cursorPolicies, []);
  });

  it('refuses an environment the Claude adapter would refuse, by variable name only', () => {
    const { factory, built } = adapters(null, {
      env: { ...CLEAN_ENV, CLAUDE_CODE_OAUTH_TOKEN: 'never-read' },
    });
    const reason = refusal(prepareLoopRun(request(factory)));
    assert.match(reason, /CLAUDE_CODE_OAUTH_TOKEN is set/);
    assert.doesNotMatch(reason, /never-read/);
    assert.deepEqual(built.claudePermissions, []);
  });

  it('refuses more than one working folder under Claude', () => {
    const { factory, built } = adapters(null);
    const reason = refusal(prepareLoopRun(request(factory, { rootCount: 2 })));
    assert.match(reason, /Claude works in one folder/);
    assert.deepEqual(built.claudePermissions, []);
  });

  it('refuses an entry step that fixes a model the Claude run does not use', () => {
    const { factory, built } = adapters(null);
    const reason = refusal(
      prepareLoopRun(
        request(factory, {
          entryNode: { id: 'work', label: 'Do what was asked', model: { policy: 'fixed', model: 'composer-2' } },
        }),
      ),
    );
    assert.match(reason, /fixes the model composer-2/);
    assert.deepEqual(built.claudePermissions, []);
  });

  it("refuses the editor's duration drawing under Claude for its fixed entry model, line and Run alike", () => {
    // Review B2: the editor's Run walks `dspatch-live-duration`, whose entry step fixes
    // composer-2. The editor request carries the entry step, as the handler and the read
    // channel both now pass it. Under Cursor the same request runs with its own model.
    const duration = loadLoopGraph(
      fs.readFileSync(path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-live-duration.graph.json'), 'utf8'),
      { resolveRole: createFileRoleResolver(repoRoot) },
    );
    assert.equal(duration.ok, true);
    if (!duration.ok) {
      return;
    }
    const entryNode = duration.graph.nodes.find((node) => node.id === duration.graph.entry);
    assert.equal(entryNode?.model?.policy, 'fixed');
    const { factory, built } = adapters(null, {}, { cursorAllowed: true });
    const editor = (sessionProvider: 'claude' | 'cursor') =>
      request(factory, {
        sessionProvider,
        ...(entryNode === undefined ? {} : { entryNode }),
        cursorModel: 'composer-2',
      });
    assert.match(refusal(prepareLoopRun(editor('claude'))), /fixes the model composer-2/);
    assert.match(loopRunAgentInfo(editor('claude'), duration.graph.target).line, /^No loop run can start: .*fixes the model/);
    assert.deepEqual(built.claudePermissions, []);
    assert.deepEqual(built.cursorPolicies, []);
    assert.equal(prepared(editor('cursor')).modelRequested, 'composer-2');
  });

  it('shows the refusal as the window line, without the closing sentence', () => {
    const { factory } = adapters(null);
    const info = loopRunAgentInfo(request(factory, { sessionProvider: null }), 'cursor');
    assert.equal(info.provider, null);
    assert.match(info.line, /^No loop run can start: No agent is chosen/);
  });
});

// --- What the window says, and Cursor unbroken -----------------------------------------

describe('the agent line, the policy text and Cursor', () => {
  it('names Claude, its model, that steps run commands through DSpatch, and the drawing label', () => {
    const { factory, built } = adapters(null);
    const info = loopRunAgentInfo(request(factory), 'cursor');
    assert.equal(info.provider, 'claude');
    assert.match(
      info.line,
      /^Runs with Claude \(claude-haiku-4-5\): its agent steps read and edit files and run builds and tests with Claude Code's own shell tools, which DSpatch records/,
    );
    assert.match(info.line, /A gate step's command is run by DSpatch itself\./);
    assert.doesNotMatch(info.line, /cannot run commands/);
    assert.match(info.line, /Drawn for cursor/);
    assert.deepEqual(built.claudePermissions, [], 'reading the line constructs nothing');
  });

  it('states the Claude step tools as exactly CHAT_PERMISSIONS', () => {
    assert.deepEqual([...CLAUDE_LOOP_STEP_TOOLS], [...CHAT_PERMISSIONS.tools]);
    const text = describeRunToolPolicy('claude');
    for (const tool of CHAT_PERMISSIONS.tools) {
      assert.match(text, new RegExp(`\\b${tool}\\b`));
    }
    // DSP-146: Claude Code's own shell tools, recorded through the hooks; no MCP server.
    assert.match(text, /Claude Code’s own shell tools/);
    assert.match(text, /no MCP servers/);
    assert.doesNotMatch(text, /mcp__dspatch/);
    assert.match(text, /does not start it; that is a record, not a sandbox/);
    assert.match(text, /no-file-writes/);
    assert.match(describeRunToolPolicy('cursor'), /provider-default/);
  });

  it('builds Cursor for a Cursor run with provider-default, and keeps its model', () => {
    const { factory, built } = adapters(null, {}, { cursorAllowed: true });
    const run = prepared(request(factory, { sessionProvider: 'cursor', cursorModel: 'composer-2' }));
    assert.equal(run.provider, 'cursor');
    assert.equal(run.modelRequested, 'composer-2');
    assert.deepEqual(built.cursorPolicies, []);
    run.createAdapter();
    assert.deepEqual(built.cursorPolicies, ['provider-default']);
    assert.deepEqual(built.claudePermissions, []);
    const info = loopRunAgentInfo(request(factory, { sessionProvider: 'cursor' }), 'cursor');
    assert.match(info.line, /^Runs with Cursor \(composer-2\)/);
    assert.doesNotMatch(info.line, /Drawn for/);
  });

  it('resolves the open session first, then the stored choice', () => {
    const { factory } = adapters(null, {}, { cursorAllowed: true });
    assert.equal(prepared(request(factory, { sessionProvider: null, chosenAgent: 'cursor' })).provider, 'cursor');
    assert.equal(prepared(request(factory, { sessionProvider: 'claude', chosenAgent: 'cursor' })).provider, 'claude');
  });
});

// --- The handlers -------------------------------------------------------------------

describe('both run handlers decide the agent before anything is recorded or claimed', () => {
  const main = fs
    .readFileSync(path.join(repoRoot, 'app', 'src', 'host', 'project-host.ts'), 'utf8')
    .replaceAll('\r\n', '\n');

  /** The run handlers are the project host's methods since DSP-111, by these names. */
  const METHOD: Readonly<Record<string, string>> = {
    START_EDITOR_LOOP_RUN: 'loop.startEditorRun',
    START_CHAT_LOOP_RUN: 'loop.startChatRun',
  };

  function handler(channel: string): string {
    const start = main.indexOf(`    '${METHOD[channel] ?? channel}',\n    async (`);
    assert.notEqual(start, -1, `the ${channel} handler exists`);
    const end = main.indexOf('\n  handle(', start + 1);
    return main.slice(start, end === -1 ? undefined : end);
  }

  for (const channel of ['START_EDITOR_LOOP_RUN', 'START_CHAT_LOOP_RUN']) {
    it(`${channel}: prepareLoopRun before the record and beginRun, and no Cursor-only check`, () => {
      const body = handler(channel);
      const prepare = body.indexOf('prepareLoopRun(');
      const claim = body.indexOf('loopControl.beginRun(');
      assert.notEqual(prepare, -1);
      assert.notEqual(claim, -1);
      assert.ok(prepare < claim, 'the agent is decided before the control is claimed');
      const record = body.indexOf('requireRunRecordStore().open(');
      if (record !== -1) {
        assert.ok(prepare < record, 'the agent is decided before the record is opened');
      }
      assert.equal(body.includes("connectedTargets: ['cursor']"), false);
      assert.match(body, /createAdapter: agent\.createAdapter/);
      assert.match(body, /provider: agent\.provider/);
    });
  }

  it("the editor's Run and its read channel both pass the drawing's entry step", () => {
    const body = handler('START_EDITOR_LOOP_RUN');
    assert.match(body, /prepareLoopRun\(\s*editorLoopRunRequest\(loaded\.graph\.nodes\.find\(/);
    assert.match(main, /loopRunAgentInfo\(editorLoopRunRequest\(entryFromQuery\(asked\.entry\)\), drawnFor\)/);
  });

  it('the product run module imports no provider adapter', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'app', 'src', 'main', 'loop-live-run.ts'), 'utf8');
    assert.doesNotMatch(source, /cursor-sdk-adapter|claude-agent-sdk-adapter/);
  });
});
