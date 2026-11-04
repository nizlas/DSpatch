/**
 * DSP-173: the resource governor in a real walk of the development loop (dry-run executor),
 * with the run's real control (`LoopRunController`), injected readings and a controlled clock.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LoopRunController } from '../src/main/loop-control-runtime';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { emptyInspection } from '../src/main/loop-live';
import { DEFAULT_GOVERNOR_CONFIG, ResourceGovernor, type GovernorClock, type GovernorConfig, type ResourceReading } from '../src/main/resource-governor';
import { GovernedRunControl } from '../src/main/resource-governor-control';
import { recordedCommandsAtEnd } from '../src/main/run-record-store';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import type { LoopGraph } from '../src/shared/loop-graph';
import { describeAgentCommands } from '../src/shared/loop-record';
import { createClock, createDryRunExecutor, runLoopGraph, type RunJournalEntry, type RunResult, type StepContext, type StepExecutor } from '../src/shared/loop-run';
import type { LiveCommandRecord } from '../src/main/workspace-command';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function developmentLoop(): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-development-loop.graph.json'), 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok);
  return loaded.graph;
}

const calm: Omit<ResourceReading, 'at'> = { psi: { memorySome: 0, memoryFull: 0, ioSome: 0, ioFull: 0, cpuSome: 5 }, memoryAvailablePercent: 60, swapPagesPerSecond: 0, missing: [] };
const red: Omit<ResourceReading, 'at'> = { psi: { memorySome: 60, memoryFull: 35, ioSome: 70, ioFull: 40, cpuSome: 10 }, memoryAvailablePercent: 2, swapPagesPerSecond: 5_000, missing: [] };

/** The governor's clock: time moves only when told; timers and sleeps fire as it passes them. */
class GovernorTestClock implements GovernorClock {
  time = 1_000_000;
  private due: { until: number; run: () => void }[] = [];
  now(): number {
    return this.time;
  }
  timer(ms: number, run: () => void): () => void {
    const entry = { until: this.time + ms, run };
    this.due.push(entry);
    return () => {
      this.due = this.due.filter((one) => one !== entry);
    };
  }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }
      const cancel = this.timer(ms, resolve);
      signal?.addEventListener('abort', () => {
        cancel();
        resolve();
      }, { once: true });
    });
  }
  async advance(ms: number, step = 5_000): Promise<void> {
    const end = this.time + ms;
    while (this.time < end) {
      this.time = Math.min(end, this.time + step);
      const now = this.due.filter((one) => one.until <= this.time);
      this.due = this.due.filter((one) => one.until > this.time);
      for (const one of now) one.run();
      await settle();
    }
  }
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
/** Let the walk run until `ready` holds, without moving the governor's clock. */
async function until(what: string, ready: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (ready()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`never: ${what}`);
}
const heldForResources = (journal: readonly RunJournalEntry[]) => journal.some((entry) => entry.kind === 'run-held' && entry.data?.['hold'] === 'resources');

function setup(mode: GovernorConfig['mode'], overrides: Partial<GovernorConfig> = {}) {
  const clock = new GovernorTestClock();
  const box = { current: calm };
  const governor = new ResourceGovernor({ ...DEFAULT_GOVERNOR_CONFIG, mode, ...overrides }, { read: async (now) => ({ at: now, ...box.current }) }, clock);
  const controller = new LoopRunController({ now: createClock().now });
  const abort = new AbortController();
  controller.beginRun('governed', abort.signal);
  const control = new GovernedRunControl(controller, governor, abort.signal);
  return { clock, box, governor, controller, abort, control };
}

/** The dry run, with pressure building while the first work step runs. */
function pressureDuringFirstStep(t: ReturnType<typeof setup>): StepExecutor {
  const inner = createDryRunExecutor();
  let first = true;
  return async (context: StepContext) => {
    if (first) {
      first = false;
      await t.clock.advance(0);
      t.box.current = red;
      await t.clock.advance(30_000);
    }
    return inner(context);
  };
}

const kinds = (result: RunResult, kind: string) => result.journal.filter((entry) => entry.kind === kind);

/** The same walk with the run's own control and no governor: what "goes as it would" means. */
async function baseline(): Promise<RunResult> {
  const controller = new LoopRunController({ now: createClock().now });
  controller.beginRun('plain');
  return runLoopGraph(developmentLoop(), { runId: 'plain', dryRun: true, control: controller, executor: createDryRunExecutor() });
}
const walked = (result: RunResult) => ({ status: result.status, path: result.path });

describe('the resource governor in a run (DSP-173)', () => {
  it('in observe, a run under RED goes as it would, and the journal says the mode, the health and each step\'s health', async () => {
    const t = setup('observe');
    const result = await runLoopGraph(developmentLoop(), { runId: 'governed', dryRun: true, control: t.control, executor: pressureDuringFirstStep(t) });
    t.control.dispose();
    assert.deepEqual(walked(result), walked(await baseline()));
    const governorLines = kinds(result, 'resource-governor');
    assert.match(governorLines[0]?.detail ?? '', /^Resource governor: observe\. It records the machine's health and changes nothing/);
    assert.ok(governorLines.some((entry) => entry.data?.['to'] === 'RED'), JSON.stringify(governorLines));
    assert.ok(governorLines.every((entry) => entry.data?.['acted'] === false), 'observe acts on nothing');
    assert.equal(kinds(result, 'run-held').length, 0);
    const entered = kinds(result, 'node-entered').filter((entry) => entry.data?.['resourceGovernor'] !== undefined);
    assert.ok(entered.length > 1);
    assert.ok(entered.slice(1).some((entry) => entry.data?.['resourceHealth'] === 'RED'), 'a later step started under RED, and says so');
  });

  it('in enforce, sustained RED holds the next step until it eases, then the run goes on; all of it journalled', async () => {
    const t = setup('enforce');
    const journal: RunJournalEntry[] = [];
    const running = runLoopGraph(developmentLoop(), { runId: 'governed', dryRun: true, control: t.control, onJournalEntry: (entry) => journal.push(entry), executor: pressureDuringFirstStep(t) });
    await until('the second step held', () => heldForResources(journal));
    assert.equal(t.governor.health, 'RED');
    // Held: time passes under RED, then the machine calms and stays calm.
    await t.clock.advance(60_000);
    t.box.current = calm;
    await t.clock.advance(120_000);
    const result = await running;
    t.control.dispose();
    assert.deepEqual(walked(result), walked(await baseline()));
    const held = kinds(result, 'run-held').filter((entry) => entry.data?.['hold'] === 'resources');
    assert.equal(held.length, 1, JSON.stringify(kinds(result, 'run-held')));
    assert.match(held[0]?.detail ?? '', /under heavy pressure \(memory stalled/);
    const released = kinds(result, 'run-released').find((entry) => entry.data?.['hold'] === 'resources');
    assert.equal(released?.data?.['started'], true);
    assert.ok(Number(released?.data?.['heldMs']) >= 60_000);
    const acted = kinds(result, 'resource-governor').filter((entry) => entry.data?.['acted'] === true).map((entry) => entry.data?.['action']);
    assert.deepEqual(acted, ['hold', 'released']);
    assert.ok(kinds(result, 'node-entered').some((entry) => Number(entry.data?.['resourceHeldMs']) >= 60_000));
  });

  it('Stop during the wait ends it at once; the held step never starts', async () => {
    const t = setup('enforce');
    const journal: RunJournalEntry[] = [];
    const running = runLoopGraph(developmentLoop(), { runId: 'governed', dryRun: true, control: t.control, signal: t.abort.signal, onJournalEntry: (entry) => journal.push(entry), executor: pressureDuringFirstStep(t) });
    await until('the second step held', () => heldForResources(journal));
    await t.clock.advance(10_000);
    t.abort.abort();
    const result = await running;
    t.control.dispose();
    assert.equal(result.fault?.kind !== undefined, true, 'the run ended on the cancel');
    const released = kinds(result, 'run-released').find((entry) => entry.data?.['hold'] === 'resources');
    assert.equal(released?.data?.['started'], false);
    assert.match(released?.detail ?? '', /cancelled while it waited for the machine's load to ease/);
    assert.equal(kinds(result, 'node-entered').length, 1, 'only the first step was entered');
  });

  it('a wait that reaches its bound under RED pauses the run for a person instead of going on; Continue starts the step', async () => {
    const t = setup('enforce', { maxWaitMs: 60_000 });
    const journal: RunJournalEntry[] = [];
    const running = runLoopGraph(developmentLoop(), { runId: 'governed', dryRun: true, control: t.control, onJournalEntry: (entry) => journal.push(entry), executor: pressureDuringFirstStep(t) });
    await until('the second step held', () => heldForResources(journal));
    await t.clock.advance(60_000);
    await until('held for a person', () => t.controller.report().state.held !== null);
    // Still RED, and no more steps start by themselves.
    await t.clock.advance(120_000);
    assert.equal(t.controller.report().state.held !== null, true, 'still held');
    // The machine calms while the run waits for the person; their Continue then starts the step,
    // and the steps after it go as they would.
    t.box.current = calm;
    await t.clock.advance(120_000);
    assert.equal(t.governor.health, 'GREEN');
    assert.equal(t.controller.report().state.held !== null, true, 'calm does not continue a run paused for a person');
    t.controller.continueRun();
    const result = await running;
    t.control.dispose();
    assert.deepEqual(walked(result), walked(await baseline()));
    const paused = kinds(result, 'resource-governor').find((entry) => entry.data?.['action'] === 'paused');
    assert.match(paused?.detail ?? '', /^Paused for you: the machine stayed under heavy pressure for 1 min/);
    assert.ok(kinds(result, 'node-entered').some((entry) => entry.data?.['resourcePausedForPerson'] === true));
  });

  it('off adds nothing to the journal and never holds', async () => {
    const t = setup('off');
    const result = await runLoopGraph(developmentLoop(), { runId: 'governed', dryRun: true, control: t.control, executor: pressureDuringFirstStep(t) });
    t.control.dispose();
    assert.deepEqual(walked(result), walked(await baseline()));
    assert.equal(kinds(result, 'resource-governor').length, 0);
    assert.ok(kinds(result, 'node-entered').every((entry) => entry.data?.['resourceGovernor'] === undefined));
  });
});

describe('a deferred observation is never a verified one (DSP-173)', () => {
  it('a command whose folders were not observed is unknown at the run\'s end, not current, and counts as no check', () => {
    const inspection = emptyInspection(repoRoot, 'model');
    inspection.finalSnapshotId = 'final-snapshot';
    const command: LiveCommandRecord = {
      command: 'npm test',
      line: 'npm test',
      cwd: repoRoot,
      exitCode: 0,
      signal: null,
      durationMs: 1000,
      startedAtUtc: '2026-11-04T12:00:00.000Z',
      stdout: '',
      stderr: '',
      notRun: null,
      requestedBy: 'provider-reported',
      nodeId: 'implementer',
      occurrence: 1,
      // What a deferred observation leaves: no snapshot at the command's start or end.
      testedSnapshotId: null,
      afterRunSnapshotId: null,
      changedWhileRunning: null,
    } as LiveCommandRecord;
    inspection.commands.push(command);
    const [recorded] = recordedCommandsAtEnd(inspection);
    assert.equal(recorded?.currentAtEnd, null);
    assert.equal(recorded?.changedWhileRunning, null);
    assert.match(describeAgentCommands(recordedCommandsAtEnd(inspection)), /None of them completed on the code exactly as the run left it/);
  });
});
