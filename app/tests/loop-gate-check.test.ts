/**
 * DSP-139: a loop run under Claude changes code, DSpatch runs the tests itself, and a
 * checking step judges the change against the real result.
 *
 * The product's editor run path end to end: `prepareLoopRun` with a request built the way
 * `editorLoopRunRequest` builds it, then `runLiveGraph` on the bundled
 * `dspatch-duration-check` drawing with no `promptFor`, no `runProjectTest` and no
 * workspace, exactly as the editor's handler calls it. So the prompts are the binding's,
 * the experiment repository is generated in a temporary folder, and the gate's
 * `node --test test/duration.test.ts` is really spawned there.
 *
 * Claude's adapter is the real one on a substituted SDK (`support/claude-loop-sdk.ts`):
 * nothing loads the Claude SDK, nothing reaches a network, and a turn's file edit is the
 * test writing the file - a stand-in for the Edit tool, not evidence of what Claude
 * does. Cursor's construction is counted and throws.
 *
 *     node scripts/run-tests.mjs live
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { CHAT_PERMISSIONS } from '../src/adapter/claude-agent-sdk-adapter.ts';
import { createFileRoleResolver } from '../src/main/loop-graph-roles.ts';
import type { LiveCommandRecord } from '../src/main/loop-live.ts';
import { defaultLiveModel, runLiveGraph } from '../src/main/loop-live-run.ts';
import { prepareLoopRun, type LoopRunAgentRequest } from '../src/main/loop-run-agent.ts';
import { CLAUDE_CHAT_MODEL } from '../src/main/provider-availability.ts';
import {
  DURATION_CHECK_GRAPH_ID,
  describeLiveBinding,
  EXAMPLE_GATE_COMMAND,
  LIVE_DURATION_GRAPH_ID,
} from '../src/shared/loop-editor-run.ts';
import type { LoopGraph } from '../src/shared/loop-graph.ts';
import { loadLoopGraph } from '../src/shared/loop-graph-load.ts';
import { formatRunJournal } from '../src/shared/loop-run.ts';
import { adapters, claudeSdk, type Query } from './support/claude-loop-sdk.ts';
import { killLeftovers, treePids, waitGone } from './support/command-tree.ts';
import { tempRoot } from './support/fixtures.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const EXAMPLE = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-duration-check.graph.json');
const DURATION = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-live-duration.graph.json');

/**
 * `node --test` run inside a `node --test` file sees `NODE_TEST_CONTEXT` and skips its
 * files, exiting 0 with no tests. That is a fault in this instrument, not in the product
 * (Electron has no such variable), and it would make a failing suite look passing, so it
 * is removed for the length of this file and every passing run asserts its test count.
 */
let savedContext: string | undefined;
before(() => {
  savedContext = process.env['NODE_TEST_CONTEXT'];
  delete process.env['NODE_TEST_CONTEXT'];
});

const generated: string[] = [];
after(() => {
  if (savedContext !== undefined) {
    process.env['NODE_TEST_CONTEXT'] = savedContext;
  }
  for (const dir of generated) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

const COMPLETE_DURATION =
  'export function formatDuration(totalSeconds: number): string {\n' +
  '  const hours = Math.floor(totalSeconds / 3600);\n' +
  '  const minutes = Math.floor((totalSeconds % 3600) / 60);\n' +
  '  const seconds = totalSeconds % 60;\n' +
  '  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;\n' +
  '  if (minutes > 0) return `${minutes}m ${seconds}s`;\n' +
  '  return `${seconds}s`;\n' +
  '}\n';

/** The simulated Edit: what the agent would write, written into the session's folder. */
function writeDuration(content: string) {
  return (query: Query): void => {
    fs.writeFileSync(path.join(String(query.options['cwd']), 'src', 'duration.ts'), content, 'utf8');
  };
}

function load(text: string): LoopGraph {
  const loaded = loadLoopGraph(text, { resolveRole: createFileRoleResolver(repoRoot) });
  assert.equal(loaded.ok, true, loaded.ok ? '' : JSON.stringify(loaded.findings));
  if (!loaded.ok) {
    throw new Error('unreachable');
  }
  return loaded.graph;
}

function example(): LoopGraph {
  return load(fs.readFileSync(EXAMPLE, 'utf8'));
}

/** As `editorLoopRunRequest` in main.ts builds it: one root, the entry step, Cursor's live model. */
function editorRequest(factory: LoopRunAgentRequest['adapters'], graph: LoopGraph): LoopRunAgentRequest {
  const entryNode = graph.nodes.find((node) => node.id === graph.entry);
  return {
    sessionProvider: 'claude',
    chosenAgent: null,
    rootCount: 1,
    ...(entryNode === undefined ? {} : { entryNode }),
    cursorModel: defaultLiveModel(),
    adapters: factory,
  };
}

async function run(
  name: string,
  sdk: ReturnType<typeof claudeSdk>,
  options: {
    readonly graph?: LoopGraph;
    readonly abort?: AbortController;
    readonly runProjectTest?: (workspacePath: string) => Promise<LiveCommandRecord>;
  } = {},
) {
  const graph = options.graph ?? example();
  const { factory, built } = adapters(sdk);
  const prepared = prepareLoopRun(editorRequest(factory, graph));
  assert.equal(prepared.ok, true, prepared.ok ? '' : prepared.reason);
  if (!prepared.ok) {
    throw new Error('unreachable');
  }
  assert.equal(prepared.modelRequested, CLAUDE_CHAT_MODEL);
  const delivery = await runLiveGraph(graph, {
    runId: `gate-check-${name}`,
    repoRoot,
    outDir: null,
    resultsDir: path.join(tempRoot(`gate-check-${name}-results`), 'results'),
    modelRequested: prepared.modelRequested,
    keepWorkspace: true,
    ...(options.abort === undefined ? {} : { abortSignal: options.abort.signal }),
    ...(options.runProjectTest === undefined ? {} : { runProjectTest: options.runProjectTest }),
    provider: prepared.provider,
    createAdapter: prepared.createAdapter,
  });
  generated.push(path.dirname(delivery.workspacePath));
  // No Cursor, ever, and the main chat's permissions exactly.
  assert.deepEqual(built.cursorPolicies, [], 'Cursor was never constructed');
  assert.ok(built.claudePermissions.every((policy) => policy === CHAT_PERMISSIONS));
  for (const query of sdk.queries) {
    assert.deepEqual(query.options['tools'], [...CHAT_PERMISSIONS.tools], 'no command tool');
  }
  return { delivery, built };
}

describe('the duration-check example under Claude, through the editor run path', () => {
  it('passes: work edits, DSpatch runs the real tests, the check is handed the record and ends done', async () => {
    const sdk = claudeSdk([
      { kind: 'answer', text: 'Completed formatDuration.\n\nRESULT: succeeded', act: writeDuration(COMPLETE_DURATION) },
      { kind: 'answer', text: 'The change matches the tests and they passed.\n\nRESULT: met' },
    ]);
    const { delivery, built } = await run('pass', sdk);
    const { result, inspection } = delivery;

    assert.equal(result.terminalNodeId, 'done', result.fault?.detail ?? formatRunJournal(result));
    assert.deepEqual(result.path, ['work', 'test', 'check', 'done']);
    assert.equal(built.claudePermissions.length, 1);

    const command = inspection.commands[0];
    assert.equal(inspection.commands.length, 1);
    assert.equal(command?.line, EXAMPLE_GATE_COMMAND);
    assert.equal(command?.cwd, delivery.workspacePath);
    assert.equal(command?.exitCode, 0, command?.stdout + (command?.stderr ?? ''));
    assert.match(command?.stdout ?? '', /pass 3/, 'the three tests really ran');

    const check = sdk.queries[1]?.prompt ?? '';
    assert.match(check, /DSpatch’s record of a command it ran itself/);
    assert.match(check, new RegExp(`Run: ${result.runId}`));
    assert.match(check, /Gate: "test", visit 1/);
    assert.ok(check.includes(`Command as configured: ${EXAMPLE_GATE_COMMAND}`));
    assert.ok(check.includes(`Working folder: ${delivery.workspacePath}`));
    assert.match(check, /Exit code: 0/);
    assert.match(check, /Standard output \(/);
    const tested = /Tested snapshot: (\S+)/.exec(check)?.[1] ?? '';
    assert.match(tested, /\S/);
    assert.notEqual(tested, 'not');
    assert.match(check, /still that snapshot as this step starts/);
    // The work step's account arrives too, as an account.
    assert.match(check, /Completed formatDuration/);
    assert.match(check, /Nobody typed a mandate for this run/);
    assert.doesNotMatch(check, /person’s own words/);

    // The brief is the drawing's, and does not claim a chat loop or a person's words (I1).
    const work = sdk.queries[0]?.prompt ?? '';
    assert.match(work, /Nobody typed a mandate/);
    assert.match(work, /Complete formatDuration in src\/duration\.ts of the isolated experiment repository/);
    assert.doesNotMatch(work, /DSpatch chat loop/);
    assert.doesNotMatch(work, /person’s own words/);
    assert.match(work, /project-work/, 'the role file is in the brief');
  });

  it('fails: an untouched file fails the real tests, the run ends tests-failed and check is never sent', async () => {
    const sdk = claudeSdk([{ kind: 'answer', text: 'Nothing needed.\n\nRESULT: succeeded' }]);
    const { delivery } = await run('fail', sdk);
    assert.equal(delivery.result.terminalNodeId, 'tests-failed');
    assert.notEqual(delivery.inspection.commands[0]?.exitCode, 0);
    assert.equal(sdk.queries.length, 1, 'check never sent');
  });

  it('cancel during work starts no gate command and sends nothing to check', async () => {
    const abort = new AbortController();
    const sdk = claudeSdk([{ kind: 'until-interrupted' }], (index) => {
      if (index === 0) {
        setImmediate(() => abort.abort());
      }
    });
    const { delivery } = await run('cancel-work', sdk, { abort });
    assert.equal(delivery.inspection.commands.length, 0, 'no gate command was started');
    assert.equal(delivery.result.path.includes('test'), false);
    assert.equal(sdk.queries.length, 1, 'check never sent');
  });

  it('cancel while the gate command runs sends nothing to check (review I2)', async () => {
    const abort = new AbortController();
    const sdk = claudeSdk([
      { kind: 'answer', text: 'Done.\n\nRESULT: succeeded', act: writeDuration(COMPLETE_DURATION) },
      { kind: 'answer', text: 'RESULT: met' },
    ]);
    const { delivery } = await run('cancel-gate', sdk, {
      abort,
      runProjectTest: async (cwd) => {
        abort.abort();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          command: EXAMPLE_GATE_COMMAND,
          line: EXAMPLE_GATE_COMMAND,
          cwd,
          exitCode: 0,
          signal: null,
          durationMs: 50,
          startedAtUtc: new Date().toISOString(),
          stdout: '',
          stderr: '',
          notRun: null,
        };
      },
    });
    // The walk refuses to enter the next node after Cancel. This injected command ignores
    // the signal on purpose; that the product's own gate command is stopped by Cancel is
    // the next test (DSP-145).
    assert.equal(delivery.result.fault?.nodeId, 'check');
    assert.match(delivery.result.fault?.detail ?? '', /"check" was never started/);
    assert.notEqual(delivery.result.terminalNodeId, 'done');
    assert.equal(sdk.queries.length, 1, 'check never sent');
  });

  it('Cancel stops the gate\'s real command and the child it started, and records it as not finished (DSP-145)', async () => {
    const abort = new AbortController();
    let workspace = '';
    // The scripted work step writes a test file that starts a child process and never
    // ends, so the gate's own `node --test test/duration.test.ts` is a real process tree
    // that only a stop can end.
    const sdk = claudeSdk([
      {
        kind: 'answer',
        text: 'Done.\n\nRESULT: succeeded',
        act: (query) => {
          workspace = String(query.options['cwd']);
          fs.writeFileSync(
            path.join(workspace, 'test', 'duration.test.ts'),
            [
              "import { spawn } from 'node:child_process';",
              "import fs from 'node:fs';",
              "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
              "fs.writeFileSync('pids.json', JSON.stringify({ parent: process.pid, child: child.pid }));",
              'setInterval(() => {}, 1000);',
              '',
            ].join('\n'),
            'utf8',
          );
        },
      },
      { kind: 'answer', text: 'RESULT: met' },
    ]);
    let pids: { parent: number; child: number } | null = null;
    const running = run('cancel-gate-real', sdk, { abort });
    try {
      for (let waited = 0; workspace === '' && waited < 15_000; waited += 20) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      pids = await treePids(workspace, 30_000);
      abort.abort();
      const { delivery } = await running;
      const command = delivery.inspection.commands[0];
      assert.equal(command?.line, EXAMPLE_GATE_COMMAND);
      assert.equal(command?.requestedBy, 'gate');
      assert.equal(command?.notRun?.kind, 'did-not-finish');
      assert.match(command?.notRun?.message ?? '', /DSpatch stopped the command before it finished/);
      assert.equal(sdk.queries.length, 1, 'check never sent');
      assert.notEqual(delivery.result.terminalNodeId, 'done');
      assert.deepEqual(await waitGone([pids.parent, pids.child]), [], 'both processes are gone');
    } finally {
      if (pids !== null) {
        killLeftovers([pids.parent, pids.child]);
      }
      await running.catch(() => undefined);
    }
  });

  it('a check that edits after the test ends not-established, recorded as verification-stale', async () => {
    const sdk = claudeSdk([
      { kind: 'answer', text: 'Done.\n\nRESULT: succeeded', act: writeDuration(COMPLETE_DURATION) },
      {
        kind: 'answer',
        text: 'Tidied it; looks right.\n\nRESULT: met',
        act: writeDuration(`${COMPLETE_DURATION}// tidied\n`),
      },
    ]);
    const { delivery } = await run('stale-check', sdk);
    assert.equal(delivery.result.terminalNodeId, 'not-established');
    const journal = formatRunJournal(delivery.result);
    assert.match(journal, /did not describe the working folders/);
    assert.match(journal, /instead of "met"/);
    const produced = delivery.result.journal.find(
      (entry) => entry.kind === 'node-produced' && entry.nodeId === 'check',
    );
    assert.equal(produced?.data?.['outcomeSource'], 'verification-stale');
  });

  it('a change between the test and the check is told to the check, and its verdict does not stand', async () => {
    // The drawing as a person might edit it on the canvas: a second writing step between
    // the gate and the check. Same id, so the editor's binding applies.
    const base = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')) as {
      limits: Record<string, unknown>;
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    base.limits = { ...base.limits, maxCalls: 6 };
    const work = base.nodes.find((node) => node['id'] === 'work') ?? {};
    base.nodes.push({ ...work, id: 'tweak', label: 'Tweak', view: { x: 700, y: 300 } });
    base.edges = base.edges.map((edge) => (edge['id'] === 'e-pass' ? { ...edge, to: 'tweak' } : edge));
    base.edges.push(
      { id: 'e-tweaked', from: 'tweak', to: 'check', when: { on: 'outcome', outcome: 'succeeded' } },
      { id: 'e-tweak-unclear', from: 'tweak', to: 'not-established', when: { on: 'outcome', outcome: 'unclear' } },
      { id: 'e-tweak-spec', from: 'tweak', to: 'stopped', when: { on: 'declared-failure', failure: 'spec-error' } },
      { id: 'e-tweak-blocked', from: 'tweak', to: 'stopped', when: { on: 'declared-failure', failure: 'blocked' } },
    );
    const graph = load(JSON.stringify(base));
    const sdk = claudeSdk([
      { kind: 'answer', text: 'Done.\n\nRESULT: succeeded', act: writeDuration(COMPLETE_DURATION) },
      { kind: 'answer', text: 'Tweaked.\n\nRESULT: succeeded', act: writeDuration(`${COMPLETE_DURATION}// tweak\n`) },
      { kind: 'answer', text: 'RESULT: met' },
    ]);
    const { delivery } = await run('stale-before', sdk, { graph });
    const check = sdk.queries[2]?.prompt ?? '';
    assert.match(check, /The working folder is now snapshot/);
    assert.match(check, /It does not describe the code you are checking/);
    assert.equal(delivery.result.terminalNodeId, 'not-established');
  });
});

describe("the editor's binding", () => {
  it('admits the example and the duration fixture, and refuses any other id', () => {
    assert.equal(describeLiveBinding(example()).ready, true);
    assert.equal(describeLiveBinding({ id: LIVE_DURATION_GRAPH_ID, name: 'Duration' }).ready, true);
    const other = describeLiveBinding({ id: 'dspatch-chat-loop', name: 'Chat loop' });
    assert.equal(other.ready, false);
    assert.match(other.reason, /no live binding/);
  });

  it('names in the gate purpose exactly the command DSpatch runs', () => {
    const gate = example().nodes.find((node) => node.kind === 'gate');
    assert.equal(example().id, DURATION_CHECK_GRAPH_ID);
    assert.ok(gate?.purpose?.includes(EXAMPLE_GATE_COMMAND), gate?.purpose);
  });

  it('leaves the duration drawing byte-identical (line endings aside) and still refused under Claude', () => {
    const text = fs.readFileSync(DURATION, 'utf8').replaceAll('\r\n', '\n');
    assert.equal(
      createHash('sha256').update(text).digest('hex'),
      '03785a33ab1d15db2d9ee177252a38f91e14635f03eec127ac456eb7e177694a',
    );
    const duration = load(fs.readFileSync(DURATION, 'utf8'));
    const { factory } = adapters(null);
    const refused = prepareLoopRun(editorRequest(factory, duration));
    assert.equal(refused.ok, false);
  });

  it("the editor handler passes neither a prompt builder nor a test command of its own", () => {
    const main = fs
      .readFileSync(path.join(repoRoot, 'app', 'src', 'host', 'project-host.ts'), 'utf8')
      .replaceAll('\r\n', '\n');
    // The editor's Run is the project host's `loop.startEditorRun` since DSP-111.
    const start = main.indexOf("    'loop.startEditorRun',\n    async (");
    assert.notEqual(start, -1);
    const end = main.indexOf('\n  handle(', start + 1);
    const body = main.slice(start, end === -1 ? undefined : end);
    const call = body.slice(body.indexOf('runLiveGraph('), body.indexOf('const workspaceNote'));
    assert.doesNotMatch(call, /promptFor|runProjectTest|workspacePath/);
  });
});
