/**
 * DSP-74 and DSP-75: a step leaves a required result, and a later step receives it.
 *
 * The tests are written around the two failures that make this worth building, not
 * around the happy path. A required result that never arrives must stop the run rather
 * than be waved through, and a result must reach the *visit* that asked for it rather
 * than the node — a loop comes back around, and an old report arriving at a new step
 * looks exactly like a fresh one.
 *
 * One of these is worth more than the rest, and it is `a real run files what the dry
 * run said it would`. The dry-run executor has always printed the entry a real run
 * would file; until now nothing filed one, so nobody could check the claim. It is a
 * better test than any assertion written from the implementation, because it compares
 * two independent statements the product makes about itself.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createFileResultStore, resolveResultPath, sha256Of } from '../src/main/loop-result-store';
import { loadLoopGraph, type Finding } from '../src/shared/loop-graph-load';
import type { LoopGraph, ResolvedRole } from '../src/shared/loop-graph';
import {
  createMemoryResultStore,
  describeReceivedResults,
  outcomeProvenance,
  resultOfVisit,
  type OutcomeSource,
  type RecordedResult,
  type ResultStore,
} from '../src/shared/loop-results';
import {
  createDryRunExecutor,
  runLoopGraph,
  type RunResult,
  type StepContext,
  type StepExecution,
  type StepExecutor,
} from '../src/shared/loop-run';

/** A role that resolves without a file, so a fixture graph needs nothing on disk. */
const anyRole = (): ResolvedRole => ({
  id: 'fixture-role',
  sourcePath: 'docs/loop/roles/fixture.role.md',
  targets: ['cursor'],
  targetsDeclared: false,
  requirements: [],
});

interface FixtureOptions {
  /** Merged into the `worker` node. */
  readonly worker?: Record<string, unknown>;
  /** Merged into the `checker` node. */
  readonly checker?: Record<string, unknown>;
  /** `null` gives the graph no archive at all, which is a case worth being able to draw. */
  readonly archive?: Record<string, unknown> | null;
  readonly resolveRole?: () => ResolvedRole;
  /** Drop the rework edge, so the graph runs forwards only and cannot hand anything back. */
  readonly straightThrough?: boolean;
  /**
   * What each edge says it delivers, by edge id (DSP-100). Absent means the edge says
   * nothing, which is every graph drawn before the field existed.
   */
  readonly delivers?: Readonly<Record<string, readonly string[]>>;
  /**
   * Add the research detour: the worker can declare `research-needed`, which routes to
   * a third step and comes back. Merged into the `researcher` node.
   *
   * A third node rather than a second fixture, because the case DSP-95 is about is
   * precisely a node reached on one edge and left on another, and two nodes cannot
   * draw it.
   */
  readonly researcher?: Record<string, unknown>;
}

/**
 * The smallest graph that can say "one step works, a second step checks it".
 *
 * A fixture rather than our own development loop, because the thing under test is the
 * general mechanism: a graph that knows nothing about Markdown reports, candidate
 * snapshots or a backlog must be able to require a result and hand it over.
 */
function fixtureText(options: FixtureOptions = {}): string {
  const withDelivers = (edge: Record<string, unknown>): Record<string, unknown> => {
    const said = options.delivers?.[edge['id'] as string];
    return said === undefined ? edge : { ...edge, delivers: said };
  };
  const researching = options.researcher !== undefined;
  const graph = {
    format: 'dspatch-loop-graph',
    formatVersion: 1,
    id: 'fixture-handover',
    name: 'One step leaves a result and the next receives it',
    purpose: 'A two-step loop for testing results and handovers.',
    target: 'cursor',
    entry: 'worker',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: researching
      ? [
          {
            id: 'research-needed',
            label: 'the work stopped on a question',
            meaning: 'The step cannot go on until something outside it is established.',
          },
        ]
      : [],
    ...(options.archive === undefined
      ? { archive: { path: 'reports/<run-id>', entryPerNode: true, referenceReturned: true } }
      : options.archive === null
        ? {}
        : { archive: options.archive }),
    nodes: [
      {
        id: 'worker',
        kind: 'agent',
        label: 'Do the work',
        role: { id: 'fixture-role', source: { kind: 'cursor-agent-file', path: 'docs/loop/roles/fixture.role.md' } },
        ...(options.worker ?? {}),
      },
      {
        id: 'checker',
        kind: 'agent',
        label: 'Check the work',
        role: { id: 'fixture-role', source: { kind: 'cursor-agent-file', path: 'docs/loop/roles/fixture.role.md' } },
        outcomes: ['accept', 'rework'],
        ...(options.checker ?? {}),
      },
      ...(researching
        ? [
            {
              id: 'researcher',
              kind: 'agent',
              label: 'Answer the question',
              role: {
                id: 'fixture-role',
                source: { kind: 'cursor-agent-file', path: 'docs/loop/roles/fixture.role.md' },
              },
              ...options.researcher,
            },
          ]
        : []),
      { id: 'done', kind: 'terminal', label: 'Finished' },
    ],
    edges: [
      { id: 'e1', from: 'worker', to: 'checker', when: { on: 'success' } },
      { id: 'e2', from: 'checker', to: 'done', when: { on: 'outcome', outcome: 'accept' } },
      ...(options.straightThrough === true
        ? [{ id: 'e3', from: 'checker', to: 'done', when: { on: 'outcome', outcome: 'rework' } }]
        : [{ id: 'e3', from: 'checker', to: 'worker', when: { on: 'outcome', outcome: 'rework' } }]),
      ...(researching
        ? [
            {
              id: 'e4',
              from: 'worker',
              to: 'researcher',
              when: { on: 'declared-failure', failure: 'research-needed' },
            },
            { id: 'e5', from: 'researcher', to: 'worker', when: { on: 'success' } },
          ]
        : []),
    ].map(withDelivers),
  };
  return JSON.stringify(graph, null, 2);
}

function loadFixture(options: FixtureOptions = {}): LoopGraph {
  const loaded = loadLoopGraph(fixtureText(options), {
    resolveRole: options.resolveRole ?? anyRole,
  });
  assert.ok(loaded.ok, `the fixture must validate: ${JSON.stringify(loaded.findings ?? [])}`);
  return loaded.graph;
}

function fixtureFindings(options: FixtureOptions = {}): readonly Finding[] {
  const loaded = loadLoopGraph(fixtureText(options), {
    resolveRole: options.resolveRole ?? anyRole,
  });
  return loaded.findings;
}

/** An executor that answers from a script and records what each step was given. */
function scriptedExecutor(script: {
  readonly bodies?: Readonly<Record<string, string>>;
  readonly outcomes?: Readonly<Record<string, string>>;
  /** A declared failure, by the same `node` or `node#visit` key as the rest. */
  readonly failures?: Readonly<Record<string, string>>;
  /**
   * The keys whose outcome DSpatch chose rather than the step (DSP-103).
   *
   * The live executor marks this when a reply declares nothing and the node says where
   * such a reply goes; a scripted step says it here, so the fixture can produce both
   * kinds of outcome without a provider.
   */
  readonly engineChose?: readonly string[];
  /**
   * The keys whose product states no provenance at all (DSP-103 #8).
   *
   * What an executor older than the field returns, and the only way to reach the
   * `unknown` reading from a run: every producer this build ships states its own, so a
   * fixture has to be asked for the omission deliberately.
   */
  readonly saysNothingAboutWhoChose?: readonly string[];
  readonly seen?: StepContext[];
}): StepExecutor {
  const visits = new Map<string, number>();
  return (context: StepContext): Promise<StepExecution> => {
    script.seen?.push(context);
    const visit = (visits.get(context.node.id) ?? 0) + 1;
    visits.set(context.node.id, visit);
    const key = `${context.node.id}#${String(visit)}`;
    const body = script.bodies?.[key] ?? script.bodies?.[context.node.id];
    const outcome = script.outcomes?.[key] ?? script.outcomes?.[context.node.id];
    const failure = script.failures?.[key] ?? script.failures?.[context.node.id];
    const engineChose =
      script.engineChose?.includes(key) === true ||
      script.engineChose?.includes(context.node.id) === true;
    const silent =
      script.saysNothingAboutWhoChose?.includes(key) === true ||
      script.saysNothingAboutWhoChose?.includes(context.node.id) === true;
    // DSP-103 #9: a scripted step stands in for one that named its verdict, so it says
    // `step-declared` rather than relying on a default. It used to rely on one, and the
    // default it relied on was the mistake #8 corrects.
    const provenance = engineChose ? 'engine-fallback' : 'step-declared';
    const product: StepExecution['product'] =
      failure !== undefined
        ? { kind: 'declared-failure', failure }
        : outcome === undefined
          ? { kind: 'success' }
          : { kind: 'outcome', outcome, ...(silent ? {} : { source: provenance }) };
    return Promise.resolve({
      product,
      summary: `fixture step ${key}`,
      providerTurns: 0,
      ...(body === undefined ? {} : { resultBody: body }),
    });
  };
}

function memoryStore(): ResultStore & { readonly written: ReadonlyMap<string, string> } {
  return createMemoryResultStore(sha256Of);
}

function run(
  graph: LoopGraph,
  executor: StepExecutor,
  store?: ResultStore,
  runId = 'run-1',
): Promise<RunResult> {
  return runLoopGraph(graph, {
    runId,
    dryRun: false,
    executor,
    ...(store === undefined ? {} : { resultStore: store }),
  });
}

describe('a step leaves a required result, and the runner checks it', () => {
  it('stops the run when a required result never arrives, naming the path and who owed it', async () => {
    // A node that files its own Markdown report, and does not. The step itself reports
    // a perfectly routable success — which is exactly the case that used to walk on.
    const graph = loadFixture({
      worker: { produces: { required: true, form: 'markdown-file' } },
    });
    const store = memoryStore();
    const result = await run(graph, scriptedExecutor({}), store);

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'required-result-missing');
    assert.equal(result.fault?.nodeId, 'worker');
    assert.match(
      result.fault?.detail ?? '',
      /reports\/run-1\/001-worker\.md/,
      'the fault has to name the file that is not there, or a person cannot go and look',
    );
    assert.match(result.fault?.detail ?? '', /"worker"/);
    assert.match(
      result.fault?.reconcile ?? '',
      /did the work and failed to file it, or did not do it/,
      'the two possibilities need different answers, so the reconcile sentence must name both',
    );
    assert.deepEqual(result.edgesTaken, [], 'nothing routes onward from a missing result');
    assert.deepEqual(result.results, []);
  });

  it('is a runtime fault and never a routable failure, so no edge can carry it', async () => {
    // The format refuses a declared failure named `missing-report` or `no-result`, and
    // this is the other half of that refusal being right: an edge would route onward,
    // and a missing report is precisely when nothing should.
    const graph = loadFixture({
      worker: { produces: { required: true, form: 'stored-result' } },
    });
    const result = await run(graph, scriptedExecutor({}), memoryStore());

    assert.equal(result.status, 'runtime-fault');
    const faults = result.journal.filter((entry) => entry.kind === 'runtime-fault');
    assert.equal(faults.length, 1);
    assert.equal(faults[0]?.data?.['routed'], false);
    assert.equal(
      result.journal.some((entry) => entry.kind === 'edge-taken'),
      false,
    );
  });

  it('files a read-only step’s result itself, because that step cannot', async () => {
    // The 15 September 2026 mistake, closed: a role required not to write files, whose
    // report it was also asked to write, could write neither. The graph names another
    // node as the writer and the runner does the filing.
    const graph = loadFixture({
      worker: {
        requirements: ['no-file-writes'],
        report: { writtenBy: 'checker' },
        produces: { required: true, form: 'markdown-file' },
      },
    });
    const store = memoryStore();
    const result = await run(
      graph,
      scriptedExecutor({ bodies: { worker: '# Survey\n\nWhat I found.\n' }, outcomes: { checker: 'accept' } }),
      store,
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const filed = result.results[0];
    assert.ok(filed);
    assert.equal(filed.nodeId, 'worker');
    assert.equal(filed.filedByTheRunner, true);
    assert.equal(filed.filedBy, 'checker', 'the graph says who is responsible, and the record keeps it');
    assert.equal(store.written.get('reports/run-1/001-worker.md'), '# Survey\n\nWhat I found.\n');
  });

  it('accepts a result the step filed itself, and reads the body from the file', async () => {
    const graph = loadFixture({
      worker: { produces: { required: true, form: 'markdown-file' } },
    });
    const store = memoryStore();
    // The step writes it during its own turn, which is what a real agent does.
    const executor: StepExecutor = (context) => {
      if (context.node.id !== 'worker') {
        return Promise.resolve({
          product: { kind: 'outcome', outcome: 'accept' },
          summary: 'checked it',
          providerTurns: 0,
        });
      }
      store.put(context.archive?.path ?? '', '# Written by the step itself\n');
      return Promise.resolve({ product: { kind: 'success' }, summary: 'wrote its own', providerTurns: 0 });
    };
    const result = await run(graph, executor, store);

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const filed = result.results[0];
    assert.equal(filed?.filedByTheRunner, false);
    assert.equal(filed?.body, '# Written by the step itself\n');
    assert.equal(filed?.digest, sha256Of('# Written by the step itself\n'));
  });

  it('treats a body of nothing but whitespace as no result, whoever wrote it', async () => {
    // The same content used to mean two different things depending on who wrote it: a
    // runner-filed body of blank lines stopped the run, and a self-filed *file* of the
    // same blank lines was accepted. One rule now, and the same sentence for both.
    const blank = '   \n\n  \t\n';

    const selfFiled = loadFixture({ worker: { produces: { required: true, form: 'markdown-file' } } });
    const selfStore = memoryStore();
    const selfResult = await run(
      selfFiled,
      (context) => {
        if (context.node.id === 'worker') {
          selfStore.put(context.archive?.path ?? '', blank);
        }
        return Promise.resolve({ product: { kind: 'success' }, summary: 'wrote blanks', providerTurns: 0 });
      },
      selfStore,
    );

    const runnerFiled = loadFixture({
      worker: {
        requirements: ['no-file-writes'],
        report: { writtenBy: 'checker' },
        produces: { required: true, form: 'markdown-file' },
      },
    });
    const runnerResult = await run(
      runnerFiled,
      scriptedExecutor({ bodies: { worker: blank }, outcomes: { checker: 'accept' } }),
      memoryStore(),
    );

    for (const result of [selfResult, runnerResult]) {
      assert.equal(result.status, 'runtime-fault');
      assert.equal(result.fault?.kind, 'required-result-missing');
      assert.match(result.fault?.detail ?? '', /nothing but whitespace/);
      assert.deepEqual(result.results, []);
    }
  });

  it('refuses to start a run that requires results with nowhere to file them', async () => {
    const graph = loadFixture({ worker: { produces: { required: true, form: 'markdown-file' } } });
    const result = await run(graph, scriptedExecutor({}));

    assert.equal(result.status, 'refused');
    assert.match(result.refusal ?? '', /nowhere to file/);
    assert.equal(result.usage.nodesExecuted, 0, 'a refused run executes nothing');
  });

  it('behaves exactly as before for a graph that asks for none of this', async () => {
    // The whole point of the fields being optional. Two runs of the same graph, one with
    // a store and one without, and the only difference allowed is that neither files
    // anything — because the graph never asked.
    const graph = loadFixture();
    const withStore = await run(graph, scriptedExecutor({ outcomes: { checker: 'accept' } }), memoryStore());
    const without = await run(graph, scriptedExecutor({ outcomes: { checker: 'accept' } }));

    for (const result of [withStore, without]) {
      assert.equal(result.status, 'completed');
      assert.deepEqual(result.results, []);
      assert.equal(
        result.journal.some((entry) => entry.kind === 'result-filed'),
        false,
        'a graph that requires nothing must not grow a line about results',
      );
    }
    assert.deepEqual(
      without.journal.map((entry) => entry.kind),
      withStore.journal.map((entry) => entry.kind),
      'having somewhere to file results must not change a run that files none',
    );
  });

  /**
   * A run that files nothing must check nothing, on **both** sides.
   *
   * Found by DSP-79 putting `produces` and `consumes` on the two shipped graphs, which
   * is the first time either appeared outside a fixture. `settleResult` has always
   * returned early when there is no store; the receiving side did not, so a dry run of
   * any graph declaring `consumes` stopped at the first receiving node and blamed the
   * producing step for an absence the dry run itself had guaranteed. Twenty-eight tests
   * failed at once, all of them walking our own development loop.
   */
  it('walks a dry run of a graph that hands work over, rather than faulting on its own silence', async () => {
    const graph = loadFixture({
      worker: { produces: { required: true, form: 'stored-result' } },
      checker: { consumes: ['worker'], outcomes: ['accept', 'rework'] },
    });
    const seen: StepContext[] = [];
    const result = await runLoopGraph(graph, {
      runId: 'dry-handover',
      dryRun: true,
      executor: scriptedExecutor({ outcomes: { checker: 'accept' }, seen }),
    });

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(result.path, ['worker', 'checker', 'done']);
    assert.deepEqual(
      seen.find((context) => context.node.id === 'checker')?.received,
      [],
      'the dry run filed nothing, so it hands nothing over',
    );
    // And it says so, rather than leaving a reader to infer it from an empty list.
    const said = result.journal.find((entry) => entry.kind === 'result-filed');
    assert.match(said?.detail ?? '', /Nothing is handed over either/);
    assert.match(said?.detail ?? '', /rather than a step having left nothing/);
  });

  /**
   * The other half of the same rule: a *live* run of that graph may not start.
   *
   * Without this, a graph that only consumes — every `produces.required` false — would
   * walk with no store, find nothing at the receiving node, and fault. The graph is
   * fine; the run was never equipped, and that is a refusal before anything runs.
   */
  it('refuses a live run of a graph that hands work over with nowhere to keep it', async () => {
    const graph = loadFixture({
      worker: { produces: { required: false, form: 'stored-result' } },
      checker: { consumes: ['worker'], outcomes: ['accept', 'rework'] },
    });
    const result = await run(graph, scriptedExecutor({ outcomes: { checker: 'accept' } }));

    assert.equal(result.status, 'refused');
    assert.equal(result.usage.nodesExecuted, 0);
  });
});

describe('one result, stored once', () => {
  it('writes the body once and never a second rendering of it', async () => {
    const graph = loadFixture({
      worker: {
        requirements: ['no-file-writes'],
        report: { writtenBy: 'checker' },
        produces: { required: true, form: 'markdown-file' },
      },
    });
    const inner = memoryStore();
    const writes: string[] = [];
    const counting: ResultStore = {
      put: (at, body) => {
        writes.push(at);
        return inner.put(at, body);
      },
      get: (at) => inner.get(at),
      locate: (at) => inner.locate(at),
      digest: (body) => inner.digest(body),
    };
    const body = '# One body\n\nAnd only one.\n';
    const result = await run(
      graph,
      scriptedExecutor({ bodies: { worker: body }, outcomes: { checker: 'accept' } }),
      counting,
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(writes, ['reports/run-1/001-worker.md'], 'one result, one write');
    const filed = result.results[0];
    assert.ok(filed);
    // The bytes on disk, the body in the record and the digest are the same body. Not
    // "equivalent" — the same string, which is what makes a stored copy and a shown copy
    // unable to disagree.
    assert.equal(inner.written.get(filed.ref), filed.body);
    assert.equal(filed.digest, sha256Of(filed.body));
    assert.equal(filed.bytes, Buffer.byteLength(body, 'utf8'));
  });

  it('leaves two files for two visits, rather than one visit overwriting the other', async () => {
    // `archivePlacement` numbers a file by the call id, which only ever increases
    // within a run — so a node the loop comes back to files a second entry instead of
    // replacing its first. Worth a test rather than a note, because the day that
    // numbering changes, the failure is a report quietly disappearing.
    const graph = loadFixture({
      worker: {
        requirements: ['no-file-writes'],
        report: { writtenBy: 'checker' },
        produces: { required: true, form: 'markdown-file' },
      },
    });
    const store = memoryStore();
    const result = await run(
      graph,
      scriptedExecutor({
        bodies: { 'worker#1': 'first attempt', 'worker#2': 'second attempt' },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'accept' },
      }),
      store,
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(
      result.results.map((filed) => filed.ref),
      ['reports/run-1/001-worker.md', 'reports/run-1/003-worker.md'],
    );
    assert.equal(store.written.get('reports/run-1/001-worker.md'), 'first attempt');
    assert.equal(store.written.get('reports/run-1/003-worker.md'), 'second attempt');
    assert.equal(store.written.size, 2, 'two visits, two files, neither overwritten');
  });

  it('makes a result retrievable by run, node and visit', async () => {
    const graph = loadFixture({
      worker: { produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'] },
    });
    const result = await run(
      graph,
      scriptedExecutor({
        bodies: { 'worker#1': 'first pass', 'worker#2': 'second pass' },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'accept' },
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.equal(resultOfVisit(result.results, 'worker', 1)?.body, 'first pass');
    assert.equal(resultOfVisit(result.results, 'worker', 2)?.body, 'second pass');
    assert.equal(resultOfVisit(result.results, 'worker', 3), null);
    for (const filed of result.results) {
      assert.equal(filed.runId, 'run-1', 'every result names the run it belongs to');
      assert.equal(filed.ref, `run:run-1/worker#${String(filed.occurrence)}`);
    }
  });
});

describe('a step receives an earlier step’s result', () => {
  it('gives the checker the worker’s result, and the record shows which one', async () => {
    const graph = loadFixture({
      worker: { produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'], consumes: ['worker'] },
    });
    const seen: StepContext[] = [];
    const result = await run(
      graph,
      scriptedExecutor({ bodies: { worker: 'what I did' }, outcomes: { checker: 'accept' }, seen }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const checker = seen.find((context) => context.node.id === 'checker');
    assert.equal(checker?.received.length, 1);
    assert.equal(checker?.received[0]?.nodeId, 'worker');
    assert.equal(checker?.received[0]?.body, 'what I did');
    assert.equal(
      checker?.received[0]?.ref,
      resultOfVisit(result.results, 'worker', 1)?.ref,
      'what the step was given must be the very entry the record holds',
    );
  });

  it('gives a second visit the second result, not the first', async () => {
    // The trap DSP-31 named for human answers, one layer down: an old result arriving
    // at a new step and looking exactly like a fresh one.
    const graph = loadFixture({
      worker: { produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'], consumes: ['worker'] },
    });
    const seen: StepContext[] = [];
    const result = await run(
      graph,
      scriptedExecutor({
        bodies: { 'worker#1': 'first attempt', 'worker#2': 'second attempt' },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'accept' },
        seen,
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const checks = seen.filter((context) => context.node.id === 'checker');
    assert.equal(checks.length, 2);
    assert.equal(checks[0]?.received[0]?.body, 'first attempt');
    assert.equal(checks[1]?.received[0]?.body, 'second attempt');
    assert.equal(checks[1]?.received[0]?.occurrence, 2);
  });

  it('stops rather than starting a step with an empty input', async () => {
    // The graph is drawn so the checker can be reached without the worker having left
    // anything: the worker's result is not required, and it returns none.
    const graph = loadFixture({
      worker: { produces: { required: false, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'], consumes: ['worker'] },
    });
    const seen: StepContext[] = [];
    const result = await run(graph, scriptedExecutor({ seen }), memoryStore());

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'required-result-missing');
    assert.equal(result.fault?.nodeId, 'checker');
    assert.match(result.fault?.detail ?? '', /was not started/);
    assert.equal(
      seen.some((context) => context.node.id === 'checker'),
      false,
      'the step must not run at all: work done about nothing still reports itself as done',
    );
  });

  it('refuses a graph whose handover could never happen', () => {
    const cannotComeFirst = fixtureFindings({
      worker: { consumes: ['checker'], produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'], produces: { required: true, form: 'stored-result' } },
    });
    // `checker` does run before `worker` on the rework edge, so this graph is legal —
    // the check is reachability, and a loop really can hand a result backwards.
    assert.equal(
      cannotComeFirst.some((finding) => finding.code === 'consumes-something-that-cannot-come-first'),
      false,
    );
    // Take the loop-back away and the same drawing becomes impossible, which is the
    // case worth refusing before a run discovers it.
    const forwardsOnly = fixtureFindings({
      straightThrough: true,
      worker: { consumes: ['checker'], produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'], produces: { required: true, form: 'stored-result' } },
    });
    assert.ok(
      forwardsOnly.some((finding) => finding.code === 'consumes-something-that-cannot-come-first'),
    );

    const leavesNothing = fixtureFindings({
      checker: { outcomes: ['accept', 'rework'], consumes: ['worker'] },
    });
    assert.ok(
      leavesNothing.some((finding) => finding.code === 'consumes-a-node-that-leaves-nothing'),
      'a handover from a node that declares no result is a promise nothing keeps',
    );

    const itself = fixtureFindings({
      worker: { consumes: ['worker'], produces: { required: true, form: 'stored-result' } },
    });
    assert.ok(itself.some((finding) => finding.code === 'consumes-itself'));

    const missing = fixtureFindings({
      checker: { outcomes: ['accept', 'rework'], consumes: ['nobody'] },
    });
    assert.ok(missing.some((finding) => finding.code === 'consumes-a-missing-node'));
  });

  it('refuses a required result that has no form, and a file with nowhere to land', () => {
    const noForm = fixtureFindings({ worker: { produces: { required: true, form: 'none' } } });
    assert.ok(noForm.some((finding) => finding.code === 'required-result-with-no-form'));

    const nowhere = fixtureFindings({
      archive: null,
      worker: { produces: { required: true, form: 'markdown-file' } },
    });
    assert.ok(nowhere.some((finding) => finding.code === 'required-file-with-nowhere-to-land'));
  });
});

/**
 * DSP-100, and DSP-95 folded into it: what a step receives depends on how it was reached.
 *
 * The defect these are written against is one line of behaviour. `received` was built
 * from the node's `consumes` whatever edge arrived, so the rework edge returned the
 * implementer to its own unanswered question with the brief again and nothing of the
 * review — and on 22 September 2026 the implementer read the re-prompt as the answer.
 * The same line sent the researcher the coordinator's brief instead of the question it
 * was being asked to answer.
 *
 * The one worth most here is `picks the review of the visit that sent it back`. An
 * arrival that delivers "the latest result of that node" is right until a node is
 * visited three times, and then it is a review of the wrong attempt, arriving with
 * nothing about it looking wrong.
 */
describe('what a step receives depends on the edge that brought the run to it', () => {
  /** Worker produces, checker produces, and the rework edge hands the review back. */
  const reworking = (delivers?: Readonly<Record<string, readonly string[]>>): LoopGraph =>
    loadFixture({
      worker: { produces: { required: true, form: 'stored-result' }, consumes: [] },
      checker: {
        outcomes: ['accept', 'rework'],
        consumes: ['worker'],
        produces: { required: true, form: 'stored-result' },
      },
      ...(delivers === undefined ? {} : { delivers }),
    });

  it('leaves a graph that says nothing about delivery behaving exactly as it did', async () => {
    // The fallback, and the reason every graph drawn before this field is untouched:
    // an edge that says nothing leaves the node's own `consumes` deciding.
    const seen: StepContext[] = [];
    const result = await run(
      reworking(),
      scriptedExecutor({
        bodies: { 'worker#1': 'first attempt', 'worker#2': 'second attempt', checker: 'the review' },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'accept' },
        seen,
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const workers = seen.filter((context) => context.node.id === 'worker');
    assert.equal(workers.length, 2);
    assert.deepEqual(workers[0]?.received, [], 'consumes is empty, so both visits receive nothing');
    assert.deepEqual(workers[1]?.received, []);
  });

  it('hands the rework round the review that sent it back', async () => {
    const seen: StepContext[] = [];
    const result = await run(
      reworking({ e3: ['checker'] }),
      scriptedExecutor({
        bodies: {
          'worker#1': 'first attempt',
          'worker#2': 'second attempt',
          'checker#1': 'REWORK: the timeout is not configurable',
          'checker#2': 'ACCEPT',
        },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'accept' },
        seen,
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const workers = seen.filter((context) => context.node.id === 'worker');
    assert.deepEqual(workers[0]?.received, [], 'the first visit arrives on no edge and is owed nothing');
    assert.equal(workers[1]?.received.length, 1);
    assert.equal(workers[1]?.received[0]?.nodeId, 'checker');
    assert.equal(workers[1]?.received[0]?.body, 'REWORK: the timeout is not configurable');
    // And the step is told which route it came on, so it can say what it was answered
    // about rather than assume the arrival was the answer.
    assert.equal(workers[1]?.arrivedBy?.edgeId, 'e3');
    assert.equal(workers[1]?.arrivedBy?.from, 'checker');
    assert.equal(workers[1]?.arrivedBy?.fromOccurrence, 1);
    assert.equal(workers[0]?.arrivedBy, null, 'the entry was routed to by nothing');
  });

  it('picks the review of the visit that sent it back, not the newest one', async () => {
    // Three rounds. If the handover resolved to "the latest result of the checker",
    // every one of these assertions would still pass on the last round and none on the
    // earlier ones — which is why they are asserted round by round and not at the end.
    const seen: StepContext[] = [];
    const result = await run(
      reworking({ e3: ['checker'] }),
      scriptedExecutor({
        bodies: {
          'worker#1': 'first attempt',
          'worker#2': 'second attempt',
          'worker#3': 'third attempt',
          'checker#1': 'REWORK: round one',
          'checker#2': 'REWORK: round two',
          'checker#3': 'ACCEPT',
        },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'rework', 'checker#3': 'accept' },
        seen,
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const workers = seen.filter((context) => context.node.id === 'worker');
    assert.equal(workers.length, 3);
    assert.deepEqual(workers[0]?.received, []);
    assert.equal(workers[1]?.received[0]?.body, 'REWORK: round one');
    assert.equal(workers[1]?.received[0]?.occurrence, 1);
    assert.equal(workers[2]?.received[0]?.body, 'REWORK: round two');
    assert.equal(workers[2]?.received[0]?.occurrence, 2);
    // The binding, in full: this run, this node, this visit.
    assert.equal(workers[2]?.received[0]?.runId, 'run-1');
    assert.equal(workers[2]?.received[0]?.nodeId, 'checker');
    // The checker's own consumes still resolves to the worker's newest attempt, which
    // is the behaviour a standing list should have and is not what the edge does.
    const checks = seen.filter((context) => context.node.id === 'checker');
    assert.equal(checks[2]?.received[0]?.body, 'third attempt');
  });

  it('carries the question out to the research step and the answer back', async () => {
    // DSP-95, both directions. The researcher's own `consumes` is the brief; the
    // question is in the worker's report, and the worker resumes needing the answer.
    const graph = loadFixture({
      worker: {
        produces: { required: true, form: 'stored-result' },
        declaredFailures: ['research-needed'],
      },
      checker: {
        outcomes: ['accept', 'rework'],
        consumes: ['worker'],
        produces: { required: true, form: 'stored-result' },
      },
      researcher: { produces: { required: true, form: 'stored-result' } },
      delivers: { e4: ['worker'], e5: ['researcher'] },
    });
    const seen: StepContext[] = [];
    const result = await run(
      graph,
      scriptedExecutor({
        bodies: {
          'worker#1': 'STOPPED: which clock does the timeout use?',
          'worker#2': 'done, using the monotonic clock',
          researcher: 'ANSWER: the monotonic clock, see src/time.ts',
          checker: 'ACCEPT',
        },
        failures: { 'worker#1': 'research-needed' },
        outcomes: { checker: 'accept' },
        seen,
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(result.path, ['worker', 'researcher', 'worker', 'checker', 'done']);

    const researcher = seen.find((context) => context.node.id === 'researcher');
    assert.equal(
      researcher?.received[0]?.body,
      'STOPPED: which clock does the timeout use?',
      'the researcher is asked the question that stopped the work, not the brief',
    );
    // A step that declared a failure still filed what it was to file, which is what
    // makes the question available to the edge at all.
    assert.equal(researcher?.received[0]?.nodeId, 'worker');

    const resumed = seen.filter((context) => context.node.id === 'worker')[1];
    assert.equal(resumed?.received[0]?.body, 'ANSWER: the monotonic clock, see src/time.ts');
    assert.equal(resumed?.arrivedBy?.edgeId, 'e5');
  });

  it('never makes a first visit require what only a later one could have', async () => {
    // The whole reason this is on the edge and not on the node. `consumes: ['checker']`
    // on the worker would be asked on the entry visit too, and stop the run before
    // anything had run at all.
    const asANode = await run(
      loadFixture({
        worker: { consumes: ['checker'], produces: { required: true, form: 'stored-result' } },
        checker: {
          outcomes: ['accept', 'rework'],
          produces: { required: true, form: 'stored-result' },
        },
      }),
      scriptedExecutor({ bodies: { worker: 'w', checker: 'c' }, outcomes: { checker: 'accept' } }),
      memoryStore(),
    );
    assert.equal(asANode.status, 'runtime-fault', 'the drawing is legal and the run cannot start');
    assert.equal(asANode.fault?.kind, 'required-result-missing');
    assert.equal(asANode.fault?.nodeId, 'worker');

    // The same intention on the edge, and the same graph runs.
    const asAnEdge = await run(
      reworking({ e3: ['checker'] }),
      scriptedExecutor({
        bodies: { worker: 'w', 'checker#1': 'REWORK', 'checker#2': 'ACCEPT' },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'accept' },
      }),
      memoryStore(),
    );
    assert.equal(asAnEdge.status, 'completed', asAnEdge.fault?.detail ?? '');
  });

  it('still stops when a path genuinely cannot supply what an edge promises, and names the edge', async () => {
    // The checker's result is not required and it leaves none, so the rework edge
    // promises something that is not there. This must stop the run exactly as a node's
    // own unmet `consumes` does — and send the reader to the edge, which is where the
    // promise was made.
    const seen: StepContext[] = [];
    const result = await run(
      loadFixture({
        worker: { produces: { required: true, form: 'stored-result' } },
        checker: {
          outcomes: ['accept', 'rework'],
          consumes: ['worker'],
          produces: { required: false, form: 'stored-result' },
        },
        delivers: { e3: ['checker'] },
      }),
      scriptedExecutor({ bodies: { worker: 'the work' }, outcomes: { checker: 'rework' }, seen }),
      memoryStore(),
    );

    assert.equal(result.status, 'runtime-fault');
    assert.equal(result.fault?.kind, 'required-result-missing');
    assert.equal(result.fault?.nodeId, 'worker', 'the step that was left empty is the one named');
    assert.equal(result.fault?.edgeId, 'e3');
    assert.match(result.fault?.detail ?? '', /arrived on edge "e3"/);
    assert.equal(
      seen.filter((context) => context.node.id === 'worker').length,
      1,
      'the second visit must not start: a step given nothing would do work about nothing',
    );
  });

  it('lets an edge say it hands over nothing, and means it', async () => {
    // An empty list is a statement and not an absence. This is how a graph says one
    // arrival at a node is a clean start while another carries material.
    const seen: StepContext[] = [];
    const result = await run(
      loadFixture({
        worker: { produces: { required: true, form: 'stored-result' } },
        checker: {
          outcomes: ['accept', 'rework'],
          consumes: ['worker'],
          produces: { required: true, form: 'stored-result' },
        },
        delivers: { e1: [] },
      }),
      scriptedExecutor({
        bodies: { worker: 'the work', checker: 'the review' },
        outcomes: { checker: 'accept' },
        seen,
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(
      seen.find((context) => context.node.id === 'checker')?.received,
      [],
      'the edge said nothing travels along it, which overrides the node’s consumes',
    );
  });

  it('writes what travelled along each arrival into the journal', async () => {
    // A run record that named only the edge could not explain why two visits to one
    // node were handed different material.
    const result = await run(
      reworking({ e3: ['checker'] }),
      scriptedExecutor({
        bodies: { worker: 'w', 'checker#1': 'REWORK', 'checker#2': 'ACCEPT' },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'accept' },
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const rework = result.journal.find(
      (entry) => entry.kind === 'edge-taken' && entry.edgeId === 'e3',
    );
    assert.equal(rework?.data?.['delivers'], 'checker');
    const forwards = result.journal.find(
      (entry) => entry.kind === 'edge-taken' && entry.edgeId === 'e1',
    );
    assert.equal(forwards?.data?.['delivers'], undefined, 'an edge that says nothing records nothing');
    const revisit = result.journal.filter(
      (entry) => entry.kind === 'node-entered' && entry.nodeId === 'worker',
    )[1];
    assert.equal(revisit?.data?.['arrivedBy'], 'e3');
    assert.equal(revisit?.data?.['arrivedFrom'], 'checker');
  });

  it('refuses a drawing whose delivery could never happen', () => {
    const missing = fixtureFindings({
      worker: { produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'], produces: { required: true, form: 'stored-result' } },
      delivers: { e3: ['nobody'] },
    });
    assert.ok(missing.some((finding) => finding.code === 'delivers-a-missing-node'));

    const leavesNothing = fixtureFindings({
      worker: { produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'] },
      delivers: { e3: ['checker'] },
    });
    assert.ok(leavesNothing.some((finding) => finding.code === 'delivers-a-node-that-leaves-nothing'));

    // Asked of where the edge *leaves from*, which is the difference between this check
    // and the node's. `e1` leaves the worker, and the checker cannot have run by then.
    const cannotComeFirst = fixtureFindings({
      straightThrough: true,
      worker: { produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'], produces: { required: true, form: 'stored-result' } },
      delivers: { e1: ['checker'] },
    });
    assert.ok(
      cannotComeFirst.some((finding) => finding.code === 'delivers-something-that-cannot-come-first'),
    );
    for (const finding of cannotComeFirst) {
      if (finding.code === 'delivers-something-that-cannot-come-first') {
        assert.equal(finding.edgeId, 'e1', 'the finding must send its reader to the edge');
      }
    }

    // And the legal case stays legal: the rework edge really can hand a result backwards.
    const roundTheLoop = fixtureFindings({
      worker: { produces: { required: true, form: 'stored-result' } },
      checker: { outcomes: ['accept', 'rework'], produces: { required: true, form: 'stored-result' } },
      delivers: { e3: ['checker'], e1: ['worker'] },
    });
    assert.equal(
      roundTheLoop.some((finding) => finding.severity === 'error'),
      false,
      JSON.stringify(roundTheLoop.filter((finding) => finding.severity === 'error')),
    );
  });
});

/**
 * DSP-103 #5. An outcome the step declared and one DSpatch selected for it are the same
 * shape in the record, and were indistinguishable in it.
 *
 * They are different claims. `rework` from a reviewer that wrote the word is that
 * reviewer's verdict; `rework` because a reply named nothing and the node says a missing
 * name goes there is Maestro reading an absence. A record that cannot tell them apart
 * lets the second be quoted as the first — and so does a step that is handed the result
 * and told only which node left it. Both halves are here, on one run.
 *
 * It changes no routing: the same edge is taken either way, which is why the outcome and
 * its provenance are two statements rather than two outcomes. And it says nothing about
 * quality — a step can do its work perfectly and simply not name it.
 *
 * **The first version of this defaulted an absent provenance to `step-declared`, and #8
 * reverses that.** The reasoning was that every result written before the field existed
 * was an outcome the step itself produced — and it does not hold: a run of that build
 * could equally have taken the node's fallback, and the field's absence records only that
 * nobody wrote it down. The tests below therefore say `step-declared` where a step really
 * declared something, rather than reaching it by saying nothing; the two that follow are
 * the cases the old default hid.
 */
describe('an outcome the step declared and one the run selected are told apart', () => {
  /** Checker names where an undeclared reply goes; the rework edge hands its result back. */
  const graph = (): LoopGraph =>
    loadFixture({
      checker: {
        outcomes: ['accept', 'rework'],
        whenUndeclared: 'rework',
        produces: { required: true, form: 'stored-result' },
      },
      delivers: { e3: ['checker'] },
    });

  it('marks the record, and tells the step that receives the result', async () => {
    const seen: StepContext[] = [];
    const result = await run(
      graph(),
      scriptedExecutor({
        bodies: { 'checker#1': 'I have a question about the brief.', 'checker#2': 'It holds up.' },
        outcomes: { 'checker#1': 'rework', 'checker#2': 'accept' },
        // The first visit named nothing and was routed on the node's own fallback; the
        // second named its verdict.
        engineChose: ['checker#1'],
        seen,
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(resultOfVisit(result.results, 'checker', 1)?.outcome, {
      name: 'rework',
      source: 'engine-fallback',
    });
    assert.deepEqual(resultOfVisit(result.results, 'checker', 2)?.outcome, {
      name: 'accept',
      source: 'step-declared',
    });

    // The journal, for a person reconstructing the run. `product` says "outcome" for both.
    const produced = result.journal.filter(
      (entry) => entry.kind === 'node-produced' && entry.nodeId === 'checker',
    );
    assert.equal(produced.length, 2);
    assert.equal(produced[0]?.data?.['outcomeSource'], 'engine-fallback');
    assert.equal(produced[0]?.data?.['outcome'], 'rework');
    assert.match(produced[0]?.detail ?? '', /the run selected because the reply declared none/);
    assert.equal(produced[1]?.data?.['outcomeSource'], 'step-declared');
    assert.doesNotMatch(produced[1]?.detail ?? '', /the run selected/);

    // And the step handed that result is told, in the message it actually receives.
    const reworked = seen.filter((context) => context.node.id === 'worker').at(-1);
    assert.equal(reworked?.received.length, 1);
    const told = describeReceivedResults(reworked?.received ?? []);
    assert.match(told, /That step named no result/);
    assert.match(told, /not that step\u2019s verdict on its own work/);
    // What it did say survives whole, which is the thing worth reading.
    assert.match(told, /I have a question about the brief\./);

    // The other half, so the sentence above means something: a declared outcome is
    // named as the step's own.
    const accepted = describeReceivedResults([resultOfVisit(result.results, 'checker', 2)!]);
    assert.match(accepted, /That step named its own result for this run: "accept"/);
    assert.doesNotMatch(accepted, /named no result/);
  });

  /**
   * The negative control. A step that produced no outcome at all — a node declaring none,
   * whose ordinary reply is its result — leaves a record with nothing to say about one,
   * and the handover reads exactly as it did before this existed.
   */
  it('says nothing about an outcome where the step produced none', async () => {
    const result = await run(
      loadFixture({
        worker: { produces: { required: true, form: 'stored-result' } },
        checker: { outcomes: ['accept', 'rework'], consumes: ['worker'] },
      }),
      scriptedExecutor({ bodies: { worker: 'what I did' }, outcomes: { checker: 'accept' } }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    const worker = resultOfVisit(result.results, 'worker', 1);
    assert.equal(worker?.outcome, undefined);
    const told = describeReceivedResults([worker!]);
    assert.doesNotMatch(told, /named no result/);
    assert.doesNotMatch(told, /named its own result/);
  });

  /**
   * DSP-103 #8. A record written before provenance was recorded, read back.
   *
   * Constructed rather than run, because that is the shape the case has: a
   * {@link RecordedResult} that came off disk from a build with no `source` to write. The
   * old rule read it as the step's own verdict, which is a claim about an agent's reply
   * that the record contains no evidence for. The three sentences it can reach have to say
   * unknown — and say it in words a reader cannot skim as "declared", which is why the
   * assertion is not merely that the declared sentence is absent.
   *
   * The record is left exactly as it was found. Nothing here fills the field in, and the
   * body is not consulted for a `RESULT:` line that might have been in it (#10).
   */
  it('reads a record written before provenance existed as unknown, not as the step’s own', () => {
    const legacy: RecordedResult = {
      runId: 'run-old',
      nodeId: 'checker',
      occurrence: 1,
      callId: 4,
      form: 'stored-result',
      ref: 'run:run-old/checker#1',
      path: null,
      digest: sha256Of('RESULT: accept\n\nIt holds up.'),
      bytes: 29,
      body: 'RESULT: accept\n\nIt holds up.',
      outcome: { name: 'accept' },
      filedBy: 'checker',
      filedByTheRunner: true,
    };

    assert.equal(outcomeProvenance(legacy.outcome!), 'unknown');
    assert.equal(legacy.outcome?.source, undefined, 'the record itself is left as it was found');

    const told = describeReceivedResults([legacy]);
    assert.match(told, /does not say who chose that name/);
    assert.match(told, /Do not read it as that step\u2019s verdict/);
    assert.doesNotMatch(
      told,
      /named its own result for this run/,
      'an absent field is not an agent declaring anything',
    );
    // And it is not read as the other definite claim either: the engine's sentence would
    // be just as unsupported, in the other direction.
    assert.doesNotMatch(told, /That step named no result/);
    // The reply is carried whole, and the `RESULT: accept` line in it is not evidence of
    // anything here: the sentence above still says nobody recorded who chose the name.
    assert.match(told, /It holds up\./);
  });

  /**
   * The other half of #8, and #9. A product that states nothing is recorded as unknown all
   * the way through — the store, the journal's sentence and its structured entry — so the
   * gap is visible rather than papered over. A run of this build cannot reach it: the
   * fixture has to omit the field on purpose, which is the point.
   */
  it('carries an unrecorded provenance through the record and the journal as unknown', async () => {
    const result = await run(
      graph(),
      scriptedExecutor({
        bodies: { checker: 'It holds up.' },
        outcomes: { checker: 'accept' },
        saysNothingAboutWhoChose: ['checker'],
      }),
      memoryStore(),
    );

    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.deepEqual(resultOfVisit(result.results, 'checker', 1)?.outcome, {
      name: 'accept',
      source: 'unknown',
    });
    const produced = result.journal.find(
      (entry) => entry.kind === 'node-produced' && entry.nodeId === 'checker',
    );
    assert.equal(produced?.data?.['outcomeSource'], 'unknown');
    assert.match(produced?.detail ?? '', /nothing recorded about who chose that name/);
  });
});

/**
 * DSP-103 #9. A gate and a router produce outcomes of their own, and neither is an agent.
 *
 * The provenance vocabulary is checked here on the thing a person reads — the sentence a
 * consuming step is handed — because that is where calling a gate's exit code a
 * declaration would do the damage: a step told *that step named its own result: "pass"*
 * would be reasoning about an agent's verdict where a command had run and no agent had
 * been asked. The producers themselves are the live executor's and are exercised in
 * `loop-live.test.ts`; what is asserted here is that each origin has words of its own.
 */
describe('a gate’s verdict and a router’s branch are not described as declarations', () => {
  const filedWith = (source: OutcomeSource): RecordedResult => ({
    runId: 'run-7',
    nodeId: 'check',
    occurrence: 1,
    callId: 2,
    form: 'stored-result',
    ref: 'run:run-7/check#1',
    path: null,
    digest: sha256Of('body'),
    bytes: 4,
    body: 'body',
    outcome: { name: 'pass', source },
    filedBy: 'check',
    filedByTheRunner: true,
  });

  it('gives each producer its own words', () => {
    const gate = describeReceivedResults([filedWith('gate-verdict')]);
    assert.match(gate, /That step is a gate/);
    assert.match(gate, /running its own check established/);

    const router = describeReceivedResults([filedWith('router-branch')]);
    assert.match(router, /That step is a router/);
    assert.match(router, /the branch its node is configured to take/);

    const dry = describeReceivedResults([filedWith('dry-run')]);
    assert.match(dry, /came from a dry run standing in for that step/);

    for (const source of ['gate-verdict', 'router-branch', 'dry-run'] as const) {
      const told = describeReceivedResults([filedWith(source)]);
      assert.doesNotMatch(
        told,
        /named its own result for this run/,
        `${source} is not an agent declaring a verdict`,
      );
      assert.doesNotMatch(told, /does not say who chose/, `${source} is recorded, so not unknown`);
    }
  });

  /**
   * And the dry-run executor states its own, rather than leaving the record to a default
   * that would have read it as an agent's verdict.
   */
  it('files a dry run’s own outcome as the dry run’s', async () => {
    const result = await runLoopGraph(loadFixture({ checker: { outcomes: ['accept', 'rework'] } }), {
      runId: 'run-dry',
      dryRun: true,
      executor: createDryRunExecutor(),
    });

    const produced = result.journal.find(
      (entry) => entry.kind === 'node-produced' && entry.nodeId === 'checker',
    );
    assert.equal(produced?.data?.['outcomeSource'], 'dry-run');
    // The journal's ordinary sentence is unchanged: a recorded provenance needs no clause,
    // and the structured entry beside it is where a reader looks for which.
    assert.match(produced?.detail ?? '', /produced outcome "accept"/);
  });
});

describe('a real run files what the dry run said it would', () => {
  it('agrees with the dry run about every entry, path for path', async () => {
    // The oracle. The dry-run executor has always reported the entry a real run would
    // file; nothing ever filed one, so the claim was untestable. These are two
    // independent statements the product makes about itself, and they have to match.
    const graph = loadFixture({
      worker: {
        requirements: ['no-file-writes'],
        report: { writtenBy: 'checker' },
        produces: { required: true, form: 'markdown-file' },
      },
    });

    const dry = await runLoopGraph(graph, {
      runId: 'run-1',
      dryRun: true,
      executor: createDryRunExecutor({
        decisions: [
          { node: 'worker', produce: { kind: 'success' } },
          { node: 'checker', produce: { kind: 'outcome', outcome: 'accept' } },
        ],
      }),
    });
    assert.equal(dry.status, 'completed');
    const predicted = dry.journal
      .filter((entry) => entry.kind === 'node-entered' && typeof entry.data?.['archive'] === 'string')
      .map((entry) => ({
        node: entry.nodeId,
        path: entry.data?.['archive'],
        writtenBy: entry.data?.['reportWrittenBy'],
      }));
    assert.ok(predicted.length > 0, 'the dry run must say what a real run would file');
    // And it says it in its own words too, which is the sentence a person reads.
    assert.ok(
      dry.journal.some((entry) => entry.detail.includes('A real run would file reports/run-1/001-worker.md')),
    );

    const store = memoryStore();
    const live = await run(
      graph,
      scriptedExecutor({ bodies: { worker: 'the work' }, outcomes: { checker: 'accept' } }),
      store,
      'run-1',
    );
    assert.equal(live.status, 'completed', live.fault?.detail ?? '');

    const actuallyFiled = live.results.map((filed) => filed.ref);
    const predictedForFilers = predicted
      .filter((entry) => entry.node === 'worker')
      .map((entry) => entry.path);
    assert.deepEqual(
      actuallyFiled,
      predictedForFilers,
      'a real run must file exactly the entries the dry run said it would',
    );
    assert.deepEqual(
      live.results.map((filed) => filed.filedBy),
      predicted.filter((entry) => entry.node === 'worker').map((entry) => entry.writtenBy),
      'and hold the same node responsible for each',
    );
  });
});

describe('where results are allowed to land', () => {
  it('keeps them under the folder DSpatch gave the run', () => {
    const base = path.join(os.tmpdir(), 'dspatch-result-store-test');
    assert.equal(resolveResultPath(base, '../elsewhere/report.md').ok, false);
    assert.equal(resolveResultPath(base, 'C:\\Windows\\report.md').ok, false);
    assert.equal(resolveResultPath(base, '/etc/report.md').ok, false);
    const inside = resolveResultPath(base, 'reports/run-1/001-worker.md');
    assert.equal(inside.ok, true);
  });

  it('writes the body and reads back the same bytes', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-results-'));
    try {
      const store = createFileResultStore(base);
      const body = '# A report\n\nWith a trailing newline.\n';
      const written = store.put('reports/run-1/001-worker.md', body);
      assert.equal(written.ok, true);
      const onDisk = fs.readFileSync(path.join(base, 'reports', 'run-1', '001-worker.md'), 'utf8');
      assert.equal(onDisk, body, 'the file is the body, with nothing added around it');
      assert.equal(store.get('reports/run-1/001-worker.md')?.body, body);
      assert.equal(store.get('reports/run-1/does-not-exist.md'), null);
      const refused = store.put('../outside.md', body);
      assert.equal(refused.ok, false);
      assert.equal(fs.existsSync(path.join(path.dirname(base), 'outside.md')), false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});