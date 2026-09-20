/**
 * Run a loop graph without spending anything: `npm run loop:dry-run`.
 *
 * This is the demonstration half of DSP-18's first increment. It loads a graph the
 * same way the editor does — `loadLoopGraph` with the real role resolver — refuses
 * to run one that does not validate, then walks it with a dry-run executor that has
 * no provider to call, and writes the journal where a person can read it.
 *
 * Examples, from `app`:
 *
 *   npm run loop:dry-run
 *   npm run loop:dry-run -- --scenario spec-error
 *   npm run loop:dry-run -- --scenario timeout --out ../.dspatch-loop/runs/<run-id>/logs/003-implementer
 *   npm run loop:dry-run -- --graph ../some/other.graph.json --list
 *
 * `--live` is a different executor, not a flag the dry-run path inspects. It
 * generates an isolated experiment repository, refuses DSpatch itself as a
 * workspace, and drives agent nodes through the existing Cursor adapter.
 *
 *   npm run loop:dry-run
 *   npm run loop:live
 *   npm run loop:live -- --keep --out ../.dspatch-loop/runs/<run-id>/logs/001-implementer
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import {
  defaultLiveModel,
  LIVE_GRAPH_REL,
  runLiveLoop,
} from '../src/main/loop-live-run';
import { formatFindings, loadLoopGraph } from '../src/shared/loop-graph-load';
import {
  createClock,
  createDryRunExecutor,
  formatRunJournal,
  journalToJsonl,
  runLoopGraph,
} from '../src/shared/loop-run';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * The scenarios, each a set of scripted step results and why it is worth running.
 *
 * A scenario is how a dry run says *what if*: the graph decides where each answer
 * goes, and these decide what the answers are.
 *
 * @type {Record<string, { why: string, decisions: import('../src/shared/loop-run').DryRunDecision[], routeLimitAs?: string, limits?: import('../src/shared/loop-graph').StepLimits, unscripted?: 'first-branch' | 'awaiting-human-at-human-nodes' }>}
 */
const SCENARIOS = {
  'happy-path': {
    why: 'A mandate, one implementation, verification, an accepted review and a result Niclas accepts.',
    decisions: [
      { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' }, minutes: 2 },
      { node: 'route-next-step', produce: { kind: 'outcome', outcome: 'implement' }, minutes: 1 },
      { node: 'implementer', produce: { kind: 'success' }, minutes: 40 },
      { node: 'verifier', produce: { kind: 'success' }, minutes: 12 },
      { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'accept' }, minutes: 9 },
      { node: 'niclas-assessment', produce: { kind: 'outcome', outcome: 'accept' }, minutes: 5 },
    ],
  },
  'spec-error': {
    why:
      'The declared failure that has to route: the Implementer finds the premise wrong, and the ' +
      'dashed spec-error edge sends the run back to planning rather than to another attempt.',
    decisions: [
      { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' }, minutes: 2 },
      {
        node: 'route-next-step',
        occurrence: 1,
        produce: { kind: 'outcome', outcome: 'implement' },
        minutes: 1,
      },
      {
        node: 'implementer',
        produce: { kind: 'declared-failure', failure: 'spec-error' },
        minutes: 18,
        summary: 'The task assumed a field the format does not have, so planning has to change first.',
      },
      { node: 'backlog-planner', produce: { kind: 'success' }, minutes: 14 },
      { node: 'plan-review', produce: { kind: 'outcome', outcome: 'accept' }, minutes: 8 },
      {
        node: 'route-next-step',
        occurrence: 2,
        produce: { kind: 'outcome', outcome: 'wrap-up' },
        minutes: 1,
      },
      { node: 'niclas-assessment', produce: { kind: 'outcome', outcome: 'accept' }, minutes: 4 },
    ],
  },
  timeout: {
    why:
      'A runtime fault, not a failure: the Implementer outruns the 90 minutes its node is bounded ' +
      'at. No edge is taken, and the run stops for reconciliation as onRuntimeFault says.',
    decisions: [
      { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' }, minutes: 2 },
      { node: 'route-next-step', produce: { kind: 'outcome', outcome: 'implement' }, minutes: 1 },
      {
        node: 'implementer',
        produce: { kind: 'success' },
        minutes: 350,
        summary: 'It did eventually answer, five hours and fifty minutes late. Nobody should act on that.',
      },
    ],
  },
  'limit-reached': {
    why:
      'A bound reached and recorded as reached, with nowhere drawn for it to go. maxCalls is cut ' +
      'to four, which runs out at the implementation review — a node that declares no ' +
      'limit-reached failure — so the run stops there with its result rather than starting again ' +
      'with the counter reset.',
    limits: { maxTasks: 1, maxCalls: 4, maxReworkRounds: 2 },
    routeLimitAs: 'limit-reached',
    decisions: [
      { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' }, minutes: 2 },
      { node: 'route-next-step', produce: { kind: 'outcome', outcome: 'implement' }, minutes: 1 },
      { node: 'implementer', produce: { kind: 'success' }, minutes: 40 },
      { node: 'verifier', produce: { kind: 'success' }, minutes: 12 },
      { node: 'implementation-review', produce: { kind: 'outcome', outcome: 'rework' }, minutes: 9 },
      { node: 'niclas-assessment', produce: { kind: 'outcome', outcome: 'accept' }, minutes: 4 },
    ],
  },
  'limit-routed': {
    why:
      'The same bound, spent where the graph does draw a route for it. maxCalls is cut to one, so ' +
      "the coordinator's own call is the last one, and the graph's dashed limit-reached edge (e05) " +
      'carries the run to its report instead of to the next step. The bound is recorded as reached ' +
      'and the run still delivers a result.',
    limits: { maxTasks: 1, maxCalls: 1, maxReworkRounds: 2 },
    routeLimitAs: 'limit-reached',
    decisions: [
      { node: 'niclas-mandate', produce: { kind: 'outcome', outcome: 'start' }, minutes: 2 },
      { node: 'coordinator', produce: { kind: 'success' }, minutes: 6 },
      { node: 'niclas-assessment', produce: { kind: 'outcome', outcome: 'accept' }, minutes: 4 },
    ],
  },
  'awaiting-human': {
    why:
      'Autonomy off at the first human step. The run stops with its history intact, repeats nothing ' +
      'and resets nothing.',
    unscripted: 'awaiting-human-at-human-nodes',
    decisions: [],
  },
};

/**
 * @param {readonly string[]} argv
 * @returns {{ graph: string, scenario: string, runId: string, out: string | null, label: string, list: boolean, live: boolean, keep: boolean, workspace: string | null, model: string }}
 */
function parseArguments(argv) {
  /** @param {string} name @param {string} fallback */
  const value = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
  };
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const live = argv.includes('--live');
  return {
    graph: value(
      'graph',
      path.join(
        repoRoot,
        live ? LIVE_GRAPH_REL : 'docs/loop/graphs/dspatch-development-loop.graph.json',
      ),
    ),
    scenario: value('scenario', 'happy-path'),
    runId: value('run-id', `${live ? 'live' : 'dry'}-${stamp}`),
    out: argv.includes('--out') ? value('out', '') : null,
    label: value('label', ''),
    list: argv.includes('--list'),
    live,
    keep: argv.includes('--keep'),
    workspace: argv.includes('--workspace') ? value('workspace', '') : null,
    model: value('model', defaultLiveModel()),
  };
}

const options = parseArguments(process.argv.slice(2));

if (options.list) {
  process.stdout.write('Scenarios:\n\n');
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    process.stdout.write(`  ${name.padEnd(16)} ${scenario.why}\n`);
  }
  process.exit(0);
}

if (options.live) {
  if (process.argv.includes('--scenario')) {
    process.stderr.write(
      '--scenario is a dry-run script. A live run walks the graph with a real executor;\n' +
        'it does not replay a scripted path. Drop --scenario.\n',
    );
    process.exit(2);
  }
  const abort = new AbortController();
  const onInterrupt = () => {
    abort.abort();
  };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);
  try {
    const delivery = await runLiveLoop({
      graphPath: path.resolve(process.cwd(), options.graph),
      runId: options.runId,
      repoRoot,
      outDir: options.out,
      modelRequested: options.model,
      ...(options.workspace ? { workspacePath: options.workspace } : {}),
      keepWorkspace: options.keep,
      abortSignal: abort.signal,
    });
    process.stdout.write(
      `graph      ${path.relative(repoRoot, path.resolve(process.cwd(), options.graph))}\n` +
        `workspace  ${delivery.workspacePath} (${delivery.workspaceKept ? 'left on disk' : 'deleted'})\n` +
        `model      requested ${options.model}, reported ${delivery.inspection.modelReported ?? 'unknown'}\n` +
        `generated  ${delivery.generated ? 'yes, isolated experiment repo' : 'no, caller workspace'}\n` +
        '\n',
    );
    process.stdout.write(`${delivery.journalText}\n`);
    if (options.out !== null && options.out !== '') {
      process.stdout.write(`journal written to ${path.relative(repoRoot, path.resolve(process.cwd(), options.out))}\\run-live.{txt,jsonl} and live-inspect.json\n`);
    }
    process.exit(delivery.result.status === 'completed' ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

const scenario = SCENARIOS[options.scenario];
if (!scenario) {
  process.stderr.write(
    `Unknown scenario "${options.scenario}". Known: ${Object.keys(SCENARIOS).join(', ')}.\n`,
  );
  process.exit(2);
}

const graphPath = path.resolve(process.cwd(), options.graph);
const loaded = loadLoopGraph(fs.readFileSync(graphPath, 'utf8'), {
  resolveRole: createFileRoleResolver(repoRoot),
  connectedTargets: ['cursor'],
});

if (!loaded.ok) {
  process.stderr.write(
    `${graphPath} does not validate, so it was not run: running a graph nobody drew is\n` +
      `worse than not running one.\n\n${formatFindings(loaded.findings)}\n`,
  );
  process.exit(1);
}

const graph = scenario.limits ? { ...loaded.graph, limits: scenario.limits } : loaded.graph;
const clock = createClock();

process.stdout.write(
  `graph      ${path.relative(repoRoot, graphPath)}\n` +
    `scenario   ${options.scenario} — ${scenario.why}\n` +
    `validation ${loaded.findings.length} findings, no errors; ${loaded.runnable.reason}\n` +
    (scenario.limits ? `limits     overridden for the demonstration: ${JSON.stringify(scenario.limits)}\n` : '') +
    '\n',
);

const result = await runLoopGraph(graph, {
  runId: options.runId,
  dryRun: true,
  now: clock.now,
  ...(scenario.routeLimitAs ? { routeLimitAs: scenario.routeLimitAs } : {}),
  executor: createDryRunExecutor({
    decisions: scenario.decisions,
    clock,
    ...(scenario.unscripted ? { unscripted: scenario.unscripted } : {}),
  }),
});

const journal = formatRunJournal(result);
process.stdout.write(`${journal}\n`);

if (options.out !== null && options.out !== '') {
  const outDir = path.resolve(process.cwd(), options.out);
  fs.mkdirSync(outDir, { recursive: true });
  const base = `run-${options.scenario}${options.label === '' ? '' : `-${options.label}`}`;
  fs.writeFileSync(path.join(outDir, `${base}.txt`), journal, 'utf8');
  fs.writeFileSync(path.join(outDir, `${base}.jsonl`), journalToJsonl(result), 'utf8');
  process.stdout.write(`journal written to ${path.relative(repoRoot, outDir)}\\${base}.{txt,jsonl}\n`);
}

// A run that reached a bound, a fault or a person is not a successful run, and the
// exit code says so rather than leaving it to whoever reads the output.
process.exit(result.status === 'completed' ? 0 : 1);
