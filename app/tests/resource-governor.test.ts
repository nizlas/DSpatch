/**
 * DSP-173: the resource governor with injected readings and a controlled clock. Nothing here
 * reads the machine or waits on real time.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_GOVERNOR_CONFIG,
  HealthTracker,
  ResourceGovernor,
  ResourceSampler,
  assess,
  governorConfig,
  parsePsi,
  type GovernorClock,
  type GovernorConfig,
  type HealthChange,
  type ResourceReading,
} from '../src/main/resource-governor';

const T = DEFAULT_GOVERNOR_CONFIG.thresholds;
const calm: Omit<ResourceReading, 'at'> = { psi: { memorySome: 0, memoryFull: 0, ioSome: 1, ioFull: 0, cpuSome: 5 }, memoryAvailablePercent: 60, swapPagesPerSecond: 0, missing: [] };
const red: Omit<ResourceReading, 'at'> = { psi: { memorySome: 60, memoryFull: 35, ioSome: 70, ioFull: 40, cpuSome: 10 }, memoryAvailablePercent: 2, swapPagesPerSecond: 5_000, missing: [] };
const yellow: Omit<ResourceReading, 'at'> = { psi: { memorySome: 15, memoryFull: 1, ioSome: 5, ioFull: 0, cpuSome: 5 }, memoryAvailablePercent: 30, swapPagesPerSecond: 0, missing: [] };

/** A clock that moves only when told; sleeps resolve when time reaches them or their signal aborts. */
export class TestClock implements GovernorClock {
  time = 1_000_000;
  private sleepers: { until: number; resolve: () => void }[] = [];
  timer(ms: number, run: () => void): () => void {
    const entry = { until: this.time + ms, resolve: run };
    this.sleepers.push(entry);
    return () => {
      this.sleepers = this.sleepers.filter((one) => one !== entry);
    };
  }
  now(): number {
    return this.time;
  }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }
      const entry = { until: this.time + ms, resolve };
      this.sleepers.push(entry);
      signal?.addEventListener('abort', () => {
        this.sleepers = this.sleepers.filter((one) => one !== entry);
        resolve();
      }, { once: true });
    });
  }
  /** Move time on and wake whoever is due; then let promises settle. */
  async advance(ms: number): Promise<void> {
    this.time += ms;
    const due = this.sleepers.filter((one) => one.until <= this.time);
    this.sleepers = this.sleepers.filter((one) => one.until > this.time);
    for (const one of due) one.resolve();
    await settle();
  }
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** A sampler that returns whatever the test puts in it. */
function fixedSampler(): { current: Omit<ResourceReading, 'at'>; read: (now: number) => Promise<ResourceReading> } {
  const box = { current: calm, read: async (now: number) => ({ at: now, ...box.current }) };
  return box;
}

function governor(mode: GovernorConfig['mode'], overrides: Partial<GovernorConfig> = {}) {
  const clock = new TestClock();
  const sampler = fixedSampler();
  const changes: HealthChange[] = [];
  const logs: string[] = [];
  const config: GovernorConfig = { ...DEFAULT_GOVERNOR_CONFIG, mode, ...overrides };
  const g = new ResourceGovernor(config, sampler, clock, { onChange: (change) => changes.push(change), log: (line) => logs.push(line) });
  /** Read once, then let `every` ms pass, `times` times. */
  const run = async (reading: Omit<ResourceReading, 'at'>, times: number, every = config.sampleEveryMs): Promise<void> => {
    sampler.current = reading;
    for (let i = 0; i < times; i += 1) {
      await g.sample();
      await clock.advance(every);
    }
  };
  return { g, clock, sampler, changes, logs, run, config };
}

describe('one reading (DSP-173)', () => {
  it('a calm machine is GREEN', () => {
    assert.equal(assess({ at: 0, ...calm }, T).level, 'GREEN');
  });

  it('stalled memory or disk, or memory nearly gone while swapping, is RED', () => {
    assert.equal(assess({ at: 0, ...red }, T).level, 'RED');
    assert.equal(assess({ at: 0, psi: { ioFull: 45 }, missing: [] }, T).level, 'RED');
    assert.equal(assess({ at: 0, memoryAvailablePercent: 3, swapPagesPerSecond: 2_000, missing: [] }, T).level, 'RED');
  });

  it('high CPU use alone is never RED, and swap that is merely in use counts for nothing', () => {
    // Every CPU busy and stalled: a busy machine, YELLOW at most.
    assert.equal(assess({ at: 0, psi: { cpuSome: 99, memorySome: 0, memoryFull: 0, ioSome: 0, ioFull: 0 }, missing: [] }, T).level, 'YELLOW');
    // Without PSI, a high load is YELLOW at most.
    assert.equal(assess({ at: 0, loadPerCpu: 9, memoryAvailablePercent: 50, swapPagesPerSecond: 0, missing: [] }, T).level, 'YELLOW');
    // Plenty of memory, no swap traffic (whatever swap holds), no stall: GREEN.
    assert.equal(assess({ at: 0, ...calm, memoryAvailablePercent: 40, swapPagesPerSecond: 0 }, T).level, 'GREEN');
    // Little memory but no swapping is not RED.
    assert.equal(assess({ at: 0, memoryAvailablePercent: 4, swapPagesPerSecond: 0, missing: [] }, T).level, 'YELLOW');
  });

  it('a calm reading that lacks a signal is UNKNOWN, naming it; pressure in what was read still counts', () => {
    // A kernel without PSI: memory and swap calm, but a disk stall cannot be seen.
    const noPsi = assess({ at: 0, memoryAvailablePercent: 60, swapPagesPerSecond: 0, loadPerCpu: 0.2, missing: ['/proc/pressure/io unreadable'] }, T);
    assert.equal(noPsi.level, 'UNKNOWN');
    assert.match(noPsi.reasons[0] ?? '', /not read: memory stall \(PSI\), disk stall \(PSI\)/);
    // The first read has no swap rate yet.
    const { swapPagesPerSecond: _rate, ...firstRead } = calm;
    assert.equal(assess({ at: 0, ...firstRead }, T).level, 'UNKNOWN');
    assert.match(assess({ at: 0, ...firstRead }, T).reasons[0] ?? '', /not read: swap traffic/);
    // Only the io file unreadable.
    assert.equal(assess({ at: 0, ...calm, psi: { memorySome: 0, memoryFull: 0, cpuSome: 1 } }, T).level, 'UNKNOWN');
    // Pressure in the part that was read is not hidden by what was not.
    assert.equal(assess({ at: 0, memoryAvailablePercent: 3, swapPagesPerSecond: 2_000, missing: [] }, T).level, 'RED');
    assert.equal(assess({ at: 0, psi: { memorySome: 20 }, missing: [] }, T).level, 'YELLOW');
  });

  it('nothing read is UNKNOWN with the reason, not GREEN', () => {
    const unknown = assess({ at: 0, missing: ['no measurement on win32 yet'] }, T);
    assert.equal(unknown.level, 'UNKNOWN');
    assert.deepEqual(unknown.reasons, ['no measurement on win32 yet']);
  });
});

describe('the health over time (DSP-173)', () => {
  const config = { escalateAfterMs: 15_000, recoverAfterMs: 60_000 };
  const at = (level: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN') => ({ level, reasons: [level] });

  it('a short spike changes nothing', () => {
    const tracker = new HealthTracker(config);
    tracker.observe(at('GREEN'), 0);
    tracker.observe(at('RED'), 5_000);
    tracker.observe(at('RED'), 10_000);
    tracker.observe(at('GREEN'), 15_000);
    tracker.observe(at('RED'), 20_000);
    assert.equal(tracker.health, 'GREEN');
  });

  it('sustained pressure enters RED after the escalation time, and leaves only after a calm period', () => {
    const tracker = new HealthTracker(config);
    tracker.observe(at('GREEN'), 0);
    for (let t = 5_000; t < 20_000; t += 5_000) tracker.observe(at('RED'), t);
    assert.equal(tracker.health, 'GREEN', 'not yet: 10 s of RED');
    const change = tracker.observe(at('RED'), 20_000);
    assert.equal(tracker.health, 'RED');
    assert.equal(change?.from, 'GREEN');
    // Calm, but not long enough.
    for (let t = 25_000; t < 80_000; t += 5_000) tracker.observe(at('GREEN'), t);
    assert.equal(tracker.health, 'RED');
    // A YELLOW reading inside the calm period: the health falls to the highest seen, YELLOW.
    tracker.observe(at('YELLOW'), 80_000);
    tracker.observe(at('GREEN'), 85_000);
    assert.equal(tracker.health, 'YELLOW', 'after 60 s calm below RED, down to the highest level seen in it');
  });

  it('readings that become unreadable are UNKNOWN once that has held, and come back the same way', () => {
    const tracker = new HealthTracker(config);
    tracker.observe(at('GREEN'), 0);
    tracker.observe(at('UNKNOWN'), 5_000);
    assert.equal(tracker.health, 'GREEN');
    tracker.observe(at('UNKNOWN'), 20_000);
    assert.equal(tracker.health, 'UNKNOWN');
    tracker.observe(at('GREEN'), 25_000);
    tracker.observe(at('GREEN'), 40_000);
    assert.equal(tracker.health, 'GREEN');
  });
});

describe('the sampler (DSP-173)', () => {
  const files: Record<string, string> = {
    '/proc/pressure/memory': 'some avg10=12.50 avg60=3.00 avg300=1.00 total=1\nfull avg10=4.25 avg60=1.00 avg300=0.50 total=1\n',
    '/proc/pressure/io': 'some avg10=1.00 avg60=0 avg300=0 total=1\nfull avg10=0.50 avg60=0 avg300=0 total=1\n',
    '/proc/pressure/cpu': 'some avg10=3.00 avg60=0 avg300=0 total=1\n',
    '/proc/meminfo': 'MemTotal:       16000000 kB\nMemFree:  100 kB\nMemAvailable:    1600000 kB\nSwapTotal: 8000000 kB\nSwapFree: 1000 kB\n',
    '/proc/vmstat': 'nr_free_pages 1\npswpin 1000\npswpout 1000\n',
    '/proc/loadavg': '8.00 4.00 2.00 3/400 1234\n',
  };

  it('reads PSI, memory, the swap rate between two reads and the load per CPU', async () => {
    let vmstat = files['/proc/vmstat'] ?? '';
    const sampler = new ResourceSampler({ platform: 'linux', cpus: () => 4, readText: async (file) => (file === '/proc/vmstat' ? vmstat : (files[file] ?? '')) });
    const first = await sampler.read(0);
    assert.equal(first.psi?.memorySome, 12.5);
    assert.equal(first.psi?.memoryFull, 4.25);
    assert.equal(first.psi?.cpuSome, 3);
    assert.equal(first.memoryAvailablePercent, 10);
    assert.equal(first.loadPerCpu, 2);
    assert.equal(first.swapPagesPerSecond, undefined, 'a rate needs two reads');
    vmstat = 'pswpin 6000\npswpout 6000\n';
    const second = await sampler.read(5_000);
    assert.equal(second.swapPagesPerSecond, 2_000);
  });

  it('a file it cannot read leaves its signals unknown and says which', async () => {
    const sampler = new ResourceSampler({ platform: 'linux', cpus: () => 4, readText: async (file) => {
      if (file.startsWith('/proc/pressure/')) throw new Error('ENOENT');
      return files[file] ?? '';
    } });
    const reading = await sampler.read(0);
    assert.equal(reading.psi, undefined);
    assert.ok(reading.missing.includes('/proc/pressure/memory unreadable'));
    assert.equal(reading.memoryAvailablePercent, 10);
  });

  it('on a platform it cannot measure yet it reads nothing and says so', async () => {
    let reads = 0;
    const sampler = new ResourceSampler({ platform: 'win32', cpus: () => 4, readText: async () => { reads += 1; return ''; } });
    const reading = await sampler.read(0);
    assert.equal(reads, 0);
    assert.deepEqual(reading.missing, ['no measurement on win32 yet']);
    assert.equal(assess(reading, T).level, 'UNKNOWN');
  });

  it('parses PSI lines with only some', () => {
    assert.deepEqual(parsePsi('some avg10=7.10 avg60=0 avg300=0 total=0\n'), { some: 7.1 });
  });
});

describe('the governor (DSP-173)', () => {
  it('in observe it reports the health and changes and never holds a step or defers a snapshot', async () => {
    const t = governor('observe');
    await t.run(calm, 1);
    await t.run(red, 5);
    assert.equal(t.g.health, 'RED');
    assert.deepEqual(t.changes.map((one) => `${one.from}→${one.to}`), ['UNKNOWN→GREEN', 'GREEN→RED']);
    assert.match(t.logs.at(-1) ?? '', /resource governor \(observe\): GREEN → RED: memory stalled/);
    const gate = await t.g.beforeStep(new AbortController().signal);
    assert.deepEqual(gate, { kind: 'go', health: 'RED', waitedMs: 0 });
    assert.equal(t.g.heavyWork().run, true);
  });

  it('off reads nothing and reports UNKNOWN', async () => {
    const t = governor('off');
    await t.run(red, 5);
    assert.equal(t.g.health, 'UNKNOWN');
    assert.equal(t.changes.length, 0);
  });

  it('in enforce, YELLOW pauses a new step briefly', async () => {
    const t = governor('enforce');
    await t.run(calm, 1);
    await t.run(yellow, 5);
    assert.equal(t.g.health, 'YELLOW');
    const gate = t.g.beforeStep(new AbortController().signal);
    await t.clock.advance(t.config.yellowPauseMs);
    const answer = await gate;
    assert.equal(answer.kind, 'go');
    assert.equal(answer.waitedMs, t.config.yellowPauseMs);
  });

  it('in enforce, RED holds a new step until the health falls, then lets it go', async () => {
    const t = governor('enforce');
    await t.run(calm, 1);
    await t.run(red, 5);
    let done = false;
    const gate = t.g.beforeStep(new AbortController().signal).then((answer) => { done = true; return answer; });
    await t.clock.advance(30_000);
    assert.equal(done, false, 'still held');
    assert.equal(t.g.heavyWork().run, false, 'the snapshot is deferred in RED');
    await t.run(calm, 14);
    const answer = await gate;
    assert.equal(answer.kind, 'go');
    assert.equal(t.g.health, 'GREEN');
    assert.ok(answer.waitedMs >= 60_000);
  });

  it('in enforce, a wait under lasting RED ends at its bound with a stated outcome, not by going on', async () => {
    const t = governor('enforce', { maxWaitMs: 60_000 });
    await t.run(calm, 1);
    await t.run(red, 5);
    const gate = t.g.beforeStep(new AbortController().signal);
    await t.clock.advance(60_000);
    const answer = await gate;
    assert.equal(answer.kind, 'timed-out');
    assert.equal(answer.health, 'RED');
    assert.ok('reasons' in answer && answer.reasons.length > 0);
  });

  it('Stop ends a wait at once', async () => {
    const t = governor('enforce');
    await t.run(calm, 1);
    await t.run(red, 5);
    const stop = new AbortController();
    const gate = t.g.beforeStep(stop.signal);
    await t.clock.advance(1_000);
    stop.abort();
    const answer = await gate;
    assert.equal(answer.kind, 'stopped');
    assert.equal(answer.waitedMs, 1_000);
  });

  it('Stop ends a YELLOW pause at once', async () => {
    const t = governor('enforce');
    await t.run(calm, 1);
    await t.run(yellow, 5);
    const stop = new AbortController();
    const gate = t.g.beforeStep(stop.signal);
    stop.abort();
    assert.equal((await gate).kind, 'stopped');
  });

  it('UNKNOWN changes nothing even in enforce', async () => {
    const t = governor('enforce');
    await t.run({ missing: ['no measurement on win32 yet'] }, 3);
    assert.equal(t.g.health, 'UNKNOWN');
    assert.deepEqual(await t.g.beforeStep(new AbortController().signal), { kind: 'go', health: 'UNKNOWN', waitedMs: 0 });
    assert.equal(t.g.heavyWork().run, true);
  });

  it('a read never overlaps the one still going', async () => {
    let started = 0;
    let release: () => void = () => undefined;
    const sampler = { read: (now: number) => { started += 1; return new Promise<ResourceReading>((resolve) => { release = () => resolve({ at: now, ...calm }); }); } };
    const g = new ResourceGovernor({ ...DEFAULT_GOVERNOR_CONFIG, mode: 'observe' }, sampler, new TestClock());
    const first = g.sample();
    await g.sample();
    assert.equal(started, 1);
    release();
    await first;
  });
});

describe('the configuration (DSP-173)', () => {
  it('observe by default; the environment sets the mode over the file', () => {
    assert.equal(governorConfig({}, undefined).config.mode, 'observe');
    assert.equal(governorConfig({ DSPATCH_RESOURCE_GOVERNOR: 'enforce' }, { mode: 'off' }).config.mode, 'enforce');
    assert.equal(governorConfig({}, { mode: 'off' }).config.mode, 'off');
  });

  it('numbers from the file, and what is not understood is named, not silently used', () => {
    const { config, notes } = governorConfig({ DSPATCH_RESOURCE_GOVERNOR: 'loud' }, { maxWaitMs: 1000, thresholds: { red: { psiIoFull: 50, psiMemoryFull: 'x' } } });
    assert.equal(config.mode, 'observe');
    assert.equal(config.maxWaitMs, 1000);
    assert.equal(config.thresholds.red.psiIoFull, 50);
    assert.equal(config.thresholds.red.psiMemoryFull, DEFAULT_GOVERNOR_CONFIG.thresholds.red.psiMemoryFull);
    assert.equal(notes.length, 2);
  });
});
