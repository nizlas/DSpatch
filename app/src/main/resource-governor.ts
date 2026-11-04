/**
 * The resource governor (DSP-173): how hard the machine the host runs on is pressed, and what
 * DSpatch's own work does about it.
 *
 * **What it reads (Linux first).** Every few seconds, one read at a time (never overlapping), of
 * small kernel files: pressure stall information (`/proc/pressure/{memory,io,cpu}`, PSI) where the
 * kernel has it, available memory and swap (`/proc/meminfo`), swap traffic (`/proc/vmstat`, as a
 * rate between two reads) and the load average per CPU (`/proc/loadavg` over the CPUs this process
 * may use). Elsewhere nothing is read yet: the health is *unknown*, and nothing DSpatch does
 * changes.
 *
 * **Pressure, not use.** High CPU use and swap already in use are normal on a busy machine and
 * never trigger protection on their own. What counts is stalled time (PSI), memory nearly gone,
 * and swap actively moving pages. CPU stall and load can raise the health to YELLOW, never to RED.
 * A signal that cannot be read is *unknown*, never GREEN; with every signal unknown the health is
 * UNKNOWN.
 *
 * **Steadiness.** A level is entered only when the readings have held at it for a while
 * (`escalateAfterMs`), and left only after a calm period below it (`recoverAfterMs`), so a short
 * spike changes nothing and the run does not jerk between levels.
 *
 * **Modes.** `off`: nothing is read. `observe` (the default): read, record the health and every
 * change of it, and change nothing in how work runs. `enforce`: as observe, and in YELLOW a short
 * pause before a new loop step; in RED the start of a new loop step waits for the health to fall,
 * bounded by `maxWaitMs` and ended at once by Stop, and DSpatch's own heavy observation (the
 * workspace snapshot) is deferred. A wait that reaches its bound ends with a stated outcome; the
 * run does not go on by itself under pressure.
 *
 * **What it never does.** It never delays the transport, heartbeats, Stop, journalling or
 * recovery, never pauses, kills or reprioritises a process, and cannot touch a command a provider
 * already runs with its own shell tool: such a command can go on loading the machine whatever the
 * health is. A deferred snapshot is a missing observation, never an unchanged or verified one.
 */

import os from 'node:os';

export type GovernorMode = 'off' | 'observe' | 'enforce';
export type Health = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

/** One read of the machine. A field that could not be read is absent: unknown, not zero. */
export interface ResourceReading {
  readonly at: number;
  /** PSI averages over 10 s, in percent of time stalled. */
  readonly psi?: {
    readonly memorySome?: number;
    readonly memoryFull?: number;
    readonly ioSome?: number;
    readonly ioFull?: number;
    readonly cpuSome?: number;
  };
  /** Available memory as a percent of total. */
  readonly memoryAvailablePercent?: number;
  /** Pages swapped in and out per second since the previous read. */
  readonly swapPagesPerSecond?: number;
  /** The 1-minute load average over the CPUs this process may use. */
  readonly loadPerCpu?: number;
  /** Why something is unknown, for the journal: the platform, or a file that could not be read. */
  readonly missing: readonly string[];
}

export interface GovernorThresholds {
  readonly yellow: {
    readonly psiMemorySome: number;
    readonly psiIoSome: number;
    readonly psiCpuSome: number;
    readonly memoryAvailablePercent: number;
    readonly swapPagesPerSecond: number;
    /** Used only when the kernel has no PSI. */
    readonly loadPerCpu: number;
  };
  readonly red: {
    readonly psiMemoryFull: number;
    readonly psiIoFull: number;
    /** RED from memory needs both: little left and swap moving. */
    readonly memoryAvailablePercent: number;
    readonly swapPagesPerSecond: number;
  };
}

export interface GovernorConfig {
  readonly mode: GovernorMode;
  readonly sampleEveryMs: number;
  readonly escalateAfterMs: number;
  readonly recoverAfterMs: number;
  /** The pause before a new loop step in YELLOW (enforce). */
  readonly yellowPauseMs: number;
  /** The longest a new loop step waits in RED before the run is held for a person (enforce). */
  readonly maxWaitMs: number;
  readonly thresholds: GovernorThresholds;
}

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  mode: 'observe',
  sampleEveryMs: 5_000,
  escalateAfterMs: 15_000,
  recoverAfterMs: 60_000,
  yellowPauseMs: 5_000,
  maxWaitMs: 5 * 60_000,
  thresholds: {
    yellow: { psiMemorySome: 10, psiIoSome: 30, psiCpuSome: 80, memoryAvailablePercent: 10, swapPagesPerSecond: 200, loadPerCpu: 2 },
    red: { psiMemoryFull: 10, psiIoFull: 30, memoryAvailablePercent: 5, swapPagesPerSecond: 1_000 },
  },
};

const RANK: Record<Exclude<Health, 'UNKNOWN'>, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

/** The level one reading shows, with the reasons that put it there. */
export interface Assessment {
  readonly level: Health;
  readonly reasons: readonly string[];
}

/** Classify one reading. Only signals that were read count; with none read, UNKNOWN. */
export function assess(reading: ResourceReading, thresholds: GovernorThresholds): Assessment {
  const red: string[] = [];
  const yellow: string[] = [];
  const psi = reading.psi;
  let known = 0;
  const at = (value: number | undefined, limit: number, into: string[], label: string): void => {
    if (value !== undefined && value >= limit) {
      into.push(`${label} ${round(value)} ≥ ${String(limit)}`);
    }
  };
  if (psi !== undefined) {
    for (const value of [psi.memorySome, psi.memoryFull, psi.ioSome, psi.ioFull, psi.cpuSome]) {
      if (value !== undefined) {
        known += 1;
      }
    }
    at(psi.memoryFull, thresholds.red.psiMemoryFull, red, 'memory stalled (PSI full)');
    at(psi.ioFull, thresholds.red.psiIoFull, red, 'disk stalled (PSI io full)');
    at(psi.memorySome, thresholds.yellow.psiMemorySome, yellow, 'memory stall (PSI some)');
    at(psi.ioSome, thresholds.yellow.psiIoSome, yellow, 'disk stall (PSI io some)');
    // CPU stall alone is a busy machine: YELLOW at most.
    at(psi.cpuSome, thresholds.yellow.psiCpuSome, yellow, 'CPU stall (PSI some)');
  }
  const memory = reading.memoryAvailablePercent;
  const swap = reading.swapPagesPerSecond;
  if (memory !== undefined) {
    known += 1;
  }
  if (swap !== undefined) {
    known += 1;
  }
  if (memory !== undefined && swap !== undefined && memory <= thresholds.red.memoryAvailablePercent && swap >= thresholds.red.swapPagesPerSecond) {
    red.push(`memory available ${round(memory)}% ≤ ${String(thresholds.red.memoryAvailablePercent)}% while swapping ${round(swap)} pages/s`);
  }
  if (memory !== undefined && memory <= thresholds.yellow.memoryAvailablePercent) {
    yellow.push(`memory available ${round(memory)}% ≤ ${String(thresholds.yellow.memoryAvailablePercent)}%`);
  }
  at(swap, thresholds.yellow.swapPagesPerSecond, yellow, 'swapping pages/s');
  // Load says how many wait for a CPU, not that the machine stalls: a fallback without PSI, YELLOW at most.
  const hasPsi = psi !== undefined && Object.values(psi).some((value) => value !== undefined);
  if (!hasPsi && reading.loadPerCpu !== undefined) {
    known += 1;
    at(reading.loadPerCpu, thresholds.yellow.loadPerCpu, yellow, 'load per CPU');
  }
  if (known === 0) {
    return { level: 'UNKNOWN', reasons: reading.missing.length > 0 ? [...reading.missing] : ['nothing could be read'] };
  }
  if (red.length > 0) {
    return { level: 'RED', reasons: red };
  }
  if (yellow.length > 0) {
    return { level: 'YELLOW', reasons: yellow };
  }
  return { level: 'GREEN', reasons: ['no pressure in what could be read'] };
}

function round(value: number): string {
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

/** A change of the health, as the journal and the log record it. */
export interface HealthChange {
  readonly at: number;
  readonly from: Health;
  readonly to: Health;
  readonly reasons: readonly string[];
  /** Signals that could not be read at the time, so the reader knows what the change rests on. */
  readonly missing: readonly string[];
}

/**
 * The health over time: a level is entered once readings have held at it or above for
 * `escalateAfterMs`, and left once they have stayed below it for `recoverAfterMs`, falling to the
 * highest level seen in that calm period. UNKNOWN is entered and left the same way as a level.
 */
export class HealthTracker {
  private current: Health = 'UNKNOWN';
  private latest: Assessment = { level: 'UNKNOWN', reasons: ['not read yet'] };
  /** Since when each candidate has held, by level: the readings at or above it (or UNKNOWN). */
  private readonly heldSince = new Map<Health, number>();
  private calmSince: number | null = null;
  private calmPeak: Health = 'GREEN';
  private started = false;
  private readonly config: Pick<GovernorConfig, 'escalateAfterMs' | 'recoverAfterMs'>;

  constructor(config: Pick<GovernorConfig, 'escalateAfterMs' | 'recoverAfterMs'>) {
    this.config = config;
  }

  get health(): Health {
    return this.current;
  }

  get last(): Assessment {
    return this.latest;
  }

  /** Take one assessment at time `now`; a change of the health is returned, else null. */
  observe(assessment: Assessment, now: number, missing: readonly string[] = []): HealthChange | null {
    this.latest = assessment;
    const level = assessment.level;
    // A first calm (or unreadable) reading sets the health at once; pressure in the first
    // reading has to hold like any other before it counts.
    if (!this.started) {
      this.started = true;
      if (level === 'GREEN' || level === 'UNKNOWN') {
        return this.change(level, assessment, now, missing);
      }
    }
    if (level === 'UNKNOWN' || this.current === 'UNKNOWN') {
      // Into or out of UNKNOWN: held for the escalation time, as any level.
      if (level === this.current) {
        this.heldSince.clear();
        return null;
      }
      const since = this.heldSince.get(level) ?? now;
      this.heldSince.clear();
      this.heldSince.set(level, since);
      if (now - since >= this.config.escalateAfterMs) {
        return this.change(level, assessment, now, missing);
      }
      return null;
    }
    const rank = RANK[level];
    const currentRank = RANK[this.current];
    // Higher levels held since when.
    for (const candidate of ['YELLOW', 'RED'] as const) {
      if (rank >= RANK[candidate]) {
        if (!this.heldSince.has(candidate)) {
          this.heldSince.set(candidate, now);
        }
      } else {
        this.heldSince.delete(candidate);
      }
    }
    this.heldSince.delete('UNKNOWN');
    if (rank > currentRank) {
      this.calmSince = null;
      for (const candidate of ['RED', 'YELLOW'] as const) {
        const since = this.heldSince.get(candidate);
        if (RANK[candidate] > currentRank && since !== undefined && now - since >= this.config.escalateAfterMs) {
          return this.change(candidate, assessment, now, missing);
        }
      }
      return null;
    }
    if (rank < currentRank) {
      if (this.calmSince === null) {
        this.calmSince = now;
        this.calmPeak = level;
      } else if (rank > RANK[this.calmPeak as Exclude<Health, 'UNKNOWN'>]) {
        this.calmPeak = level;
      }
      if (now - this.calmSince >= this.config.recoverAfterMs) {
        return this.change(this.calmPeak, assessment, now, missing);
      }
      return null;
    }
    this.calmSince = null;
    return null;
  }

  private change(to: Health, assessment: Assessment, now: number, missing: readonly string[]): HealthChange | null {
    const from = this.current;
    this.current = to;
    this.calmSince = null;
    this.calmPeak = 'GREEN';
    if (from === to) {
      return null;
    }
    return { at: now, from, to, reasons: assessment.reasons, missing };
  }
}

// --- Reading the machine ----------------------------------------------------------------------

/** What the sampler reads files with; the tests give it text. */
export type ReadText = (file: string) => Promise<string>;

/** `some avg10=1.23 ...` / `full avg10=...`: the 10-second averages, or undefined. */
export function parsePsi(text: string): { readonly some?: number; readonly full?: number } {
  const value = (kind: string): number | undefined => {
    const match = new RegExp(`^${kind}\\s+avg10=([0-9.]+)`, 'm').exec(text);
    return match === null ? undefined : Number(match[1]);
  };
  const some = value('some');
  const full = value('full');
  return { ...(some === undefined ? {} : { some }), ...(full === undefined ? {} : { full }) };
}

/** Fields of `/proc/meminfo` in kB. */
export function parseMeminfo(text: string): Map<string, number> {
  const fields = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match !== null) {
      fields.set(match[1] ?? '', Number(match[2]));
    }
  }
  return fields;
}

/** `pswpin` + `pswpout` from `/proc/vmstat`: pages swapped since boot. */
export function parseSwapPages(text: string): number | undefined {
  const pick = (name: string): number | undefined => {
    const match = new RegExp(`^${name}\\s+(\\d+)`, 'm').exec(text);
    return match === null ? undefined : Number(match[1]);
  };
  const into = pick('pswpin');
  const out = pick('pswpout');
  return into === undefined || out === undefined ? undefined : into + out;
}

/**
 * Reads the machine. On Linux, each file once per call; a file that cannot be read leaves its
 * signals unknown and says so. Elsewhere it reads nothing and says that measuring is not there yet.
 */
export class ResourceSampler {
  private previousSwap: { readonly at: number; readonly pages: number } | null = null;
  private readonly options: { readonly platform: NodeJS.Platform; readonly readText: ReadText; readonly cpus: () => number };

  constructor(options: { readonly platform: NodeJS.Platform; readonly readText: ReadText; readonly cpus: () => number }) {
    this.options = options;
  }

  async read(now: number): Promise<ResourceReading> {
    if (this.options.platform !== 'linux') {
      return { at: now, missing: [`no measurement on ${this.options.platform} yet`] };
    }
    const missing: string[] = [];
    const tryRead = async (file: string): Promise<string | null> => {
      try {
        return await this.options.readText(file);
      } catch {
        missing.push(`${file} unreadable`);
        return null;
      }
    };
    const [memoryPsi, ioPsi, cpuPsi, meminfo, vmstat, loadavg] = await Promise.all([
      tryRead('/proc/pressure/memory'),
      tryRead('/proc/pressure/io'),
      tryRead('/proc/pressure/cpu'),
      tryRead('/proc/meminfo'),
      tryRead('/proc/vmstat'),
      tryRead('/proc/loadavg'),
    ]);
    const memory = memoryPsi === null ? {} : parsePsi(memoryPsi);
    const io = ioPsi === null ? {} : parsePsi(ioPsi);
    const cpu = cpuPsi === null ? {} : parsePsi(cpuPsi);
    const psi = {
      ...(memory.some === undefined ? {} : { memorySome: memory.some }),
      ...(memory.full === undefined ? {} : { memoryFull: memory.full }),
      ...(io.some === undefined ? {} : { ioSome: io.some }),
      ...(io.full === undefined ? {} : { ioFull: io.full }),
      ...(cpu.some === undefined ? {} : { cpuSome: cpu.some }),
    };
    let memoryAvailablePercent: number | undefined;
    if (meminfo !== null) {
      const fields = parseMeminfo(meminfo);
      const total = fields.get('MemTotal');
      const available = fields.get('MemAvailable');
      if (total !== undefined && total > 0 && available !== undefined) {
        memoryAvailablePercent = (available / total) * 100;
      } else {
        missing.push('MemAvailable not in /proc/meminfo');
      }
    }
    let swapPagesPerSecond: number | undefined;
    if (vmstat !== null) {
      const pages = parseSwapPages(vmstat);
      if (pages !== undefined) {
        // A rate needs two reads: the first one leaves it unknown.
        if (this.previousSwap !== null && now > this.previousSwap.at) {
          swapPagesPerSecond = Math.max(0, pages - this.previousSwap.pages) / ((now - this.previousSwap.at) / 1000);
        }
        this.previousSwap = { at: now, pages };
      }
    }
    let loadPerCpu: number | undefined;
    if (loadavg !== null) {
      const one = Number(loadavg.trim().split(/\s+/)[0]);
      const cpus = Math.max(1, this.options.cpus());
      if (Number.isFinite(one)) {
        loadPerCpu = one / cpus;
      }
    }
    return {
      at: now,
      ...(Object.keys(psi).length === 0 ? {} : { psi }),
      ...(memoryAvailablePercent === undefined ? {} : { memoryAvailablePercent }),
      ...(swapPagesPerSecond === undefined ? {} : { swapPagesPerSecond }),
      ...(loadPerCpu === undefined ? {} : { loadPerCpu }),
      missing,
    };
  }
}

// --- The governor -----------------------------------------------------------------------------

/** What a new loop step's start came to under the governor. */
export type StepGate =
  | { readonly kind: 'go'; readonly health: Health; readonly waitedMs: number; readonly note?: string }
  | { readonly kind: 'stopped'; readonly health: Health; readonly waitedMs: number }
  | { readonly kind: 'timed-out'; readonly health: Health; readonly waitedMs: number; readonly reasons: readonly string[] };

/** Whether DSpatch's own heavy observation may run now. */
export type HeavyWork = { readonly run: true; readonly health: Health } | { readonly run: false; readonly health: Health; readonly reason: string };

/** Time, for the governor: the real clock in the host, a controlled one in the tests. */
export interface GovernorClock {
  now(): number;
  /** Resolves after `ms`, or at once when `signal` is aborted. Never rejects. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Calls `run` once after `ms`; the returned function cancels it. Keeps no process alive. */
  timer(ms: number, run: () => void): () => void;
}

export const realClock: GovernorClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }
      const done = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      timer.unref?.();
      signal?.addEventListener('abort', done, { once: true });
    }),
  timer: (ms, run) => {
    const handle = setTimeout(run, ms);
    handle.unref?.();
    return () => clearTimeout(handle);
  },
};

export interface GovernorEvents {
  /** The health changed: journalled by each run that is going, and logged. */
  readonly onChange?: (change: HealthChange, mode: GovernorMode) => void;
  readonly log?: (line: string) => void;
}

/**
 * One per host. Reads on its own timer while it has anything to serve, one read at a time, and
 * answers the loop runner's two questions: may a new step start (and after how long), and may
 * DSpatch's own heavy observation run now.
 */
export class ResourceGovernor {
  private tracker: HealthTracker;
  private readonly listeners = new Set<(change: HealthChange, mode: GovernorMode) => void>();
  private readonly waiters = new Set<() => void>();
  private timer: (() => void) | null = null;
  private reading = false;
  private lastReading: ResourceReading | null = null;
  private users = 0;
  readonly config: GovernorConfig;
  private readonly sampler: Pick<ResourceSampler, 'read'>;
  private readonly clock: GovernorClock;
  private readonly events: GovernorEvents;

  constructor(config: GovernorConfig, sampler: Pick<ResourceSampler, 'read'>, clock: GovernorClock = realClock, events: GovernorEvents = {}) {
    this.config = config;
    this.sampler = sampler;
    this.clock = clock;
    this.events = events;
    this.tracker = new HealthTracker(config);
  }

  get mode(): GovernorMode {
    return this.config.mode;
  }

  get health(): Health {
    return this.config.mode === 'off' ? 'UNKNOWN' : this.tracker.health;
  }

  /** The reasons behind the latest reading's level, and what could not be read. */
  get latest(): { readonly reasons: readonly string[]; readonly missing: readonly string[] } {
    return { reasons: this.tracker.last.reasons, missing: this.lastReading?.missing ?? [] };
  }

  /** A run begins: reading starts if it was not going. Returns the way to let go. */
  use(onChange?: (change: HealthChange, mode: GovernorMode) => void): () => void {
    if (onChange !== undefined) {
      this.listeners.add(onChange);
    }
    this.users += 1;
    if (this.config.mode !== 'off' && this.users === 1) {
      // Nothing was read while no run used it: what it knew is stale, so it starts over.
      this.tracker = new HealthTracker(this.config);
      this.lastReading = null;
      this.schedule(0);
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      if (onChange !== undefined) {
        this.listeners.delete(onChange);
      }
      this.users -= 1;
      if (this.users === 0 && this.timer !== null) {
        this.timer();
        this.timer = null;
      }
    };
  }

  /** Read once now (the timer calls this; so can a test). Never overlaps itself. */
  async sample(): Promise<HealthChange | null> {
    if (this.config.mode === 'off' || this.reading) {
      return null;
    }
    this.reading = true;
    try {
      const now = this.clock.now();
      const reading = await this.sampler.read(now);
      this.lastReading = reading;
      const change = this.tracker.observe(assess(reading, this.config.thresholds), now, reading.missing);
      if (change !== null) {
        this.events.log?.(`resource governor (${this.config.mode}): ${change.from} → ${change.to}: ${change.reasons.join('; ')}${change.missing.length > 0 ? ` (unknown: ${change.missing.join('; ')})` : ''}`);
        this.events.onChange?.(change, this.config.mode);
        for (const listener of this.listeners) {
          listener(change, this.config.mode);
        }
        for (const wake of [...this.waiters]) {
          wake();
        }
      }
      return change;
    } catch (error) {
      this.events.log?.(`resource governor: a read failed and was skipped (${String(error)})`);
      return null;
    } finally {
      this.reading = false;
    }
  }

  private schedule(delay: number): void {
    this.timer = this.clock.timer(delay, () => {
      this.timer = null;
      void this.sample().finally(() => {
        if (this.users > 0 && this.timer === null) {
          this.schedule(this.config.sampleEveryMs);
        }
      });
    });
  }

  /**
   * Before a new loop step starts. In observe and off it answers `go` at once with the health.
   * In enforce: YELLOW pauses `yellowPauseMs`; RED waits for the health to fall below RED, at most
   * `maxWaitMs`; Stop (the signal) ends either at once. UNKNOWN changes nothing.
   */
  async beforeStep(signal: AbortSignal): Promise<StepGate> {
    const began = this.clock.now();
    const waited = (): number => this.clock.now() - began;
    if (this.config.mode !== 'enforce') {
      return { kind: 'go', health: this.health, waitedMs: 0 };
    }
    if (signal.aborted) {
      return { kind: 'stopped', health: this.health, waitedMs: 0 };
    }
    if (this.health === 'YELLOW') {
      await this.clock.sleep(this.config.yellowPauseMs, signal);
      if (signal.aborted) {
        return { kind: 'stopped', health: this.health, waitedMs: waited() };
      }
      return { kind: 'go', health: 'YELLOW', waitedMs: waited(), note: `paused ${String(this.config.yellowPauseMs)} ms under YELLOW` };
    }
    if (this.health !== 'RED') {
      return { kind: 'go', health: this.health, waitedMs: 0 };
    }
    while (this.health === 'RED') {
      const left = this.config.maxWaitMs - waited();
      if (left <= 0) {
        return { kind: 'timed-out', health: 'RED', waitedMs: waited(), reasons: this.tracker.last.reasons };
      }
      // Woken by a change of the health, by Stop, or by the bound.
      const wake = new AbortController();
      const onAbort = (): void => wake.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      const waker = (): void => wake.abort();
      this.waiters.add(waker);
      try {
        await this.clock.sleep(left, wake.signal);
      } finally {
        this.waiters.delete(waker);
        signal.removeEventListener('abort', onAbort);
      }
      if (signal.aborted) {
        return { kind: 'stopped', health: this.health, waitedMs: waited() };
      }
    }
    return { kind: 'go', health: this.health, waitedMs: waited(), note: `waited ${String(Math.round(waited() / 1000))} s for RED to pass` };
  }

  /** May DSpatch's own heavy observation (a workspace snapshot) run now? Deferred only in enforce, in RED. */
  heavyWork(): HeavyWork {
    if (this.config.mode === 'enforce' && this.health === 'RED') {
      return { run: false, health: 'RED', reason: `deferred under RED: ${this.tracker.last.reasons.join('; ')}` };
    }
    return { run: true, health: this.health };
  }
}

// --- Configuration ----------------------------------------------------------------------------

/**
 * The configuration: `DSPATCH_RESOURCE_GOVERNOR` = off | observe | enforce sets the mode; a file
 * `resource-governor.json` in the host's data folder may set the mode and any of the numbers above
 * (its `mode` yields to the environment). Anything not understood falls back to the default and is
 * named in the returned notes, never silently.
 */
export function governorConfig(env: NodeJS.ProcessEnv, file: unknown): { readonly config: GovernorConfig; readonly notes: readonly string[] } {
  const notes: string[] = [];
  const asMode = (value: unknown, from: string): GovernorMode | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (value === 'off' || value === 'observe' || value === 'enforce') {
      return value;
    }
    notes.push(`${from}: "${String(value)}" is not off, observe or enforce; ignored`);
    return undefined;
  };
  const record = typeof file === 'object' && file !== null && !Array.isArray(file) ? (file as Record<string, unknown>) : {};
  if (file !== undefined && file !== null && record !== file) {
    notes.push('resource-governor.json: not an object; ignored');
  }
  const number = (value: unknown, fallback: number, name: string): number => {
    if (value === undefined) {
      return fallback;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
    notes.push(`resource-governor.json: ${name} is not a number ≥ 0; ignored`);
    return fallback;
  };
  const d = DEFAULT_GOVERNOR_CONFIG;
  const thresholds = (typeof record['thresholds'] === 'object' && record['thresholds'] !== null ? record['thresholds'] : {}) as Record<string, Record<string, unknown> | undefined>;
  const yellow = thresholds['yellow'] ?? {};
  const red = thresholds['red'] ?? {};
  const mode = asMode(env['DSPATCH_RESOURCE_GOVERNOR'], 'DSPATCH_RESOURCE_GOVERNOR') ?? asMode(record['mode'], 'resource-governor.json mode') ?? d.mode;
  return {
    config: {
      mode,
      sampleEveryMs: Math.max(1_000, number(record['sampleEveryMs'], d.sampleEveryMs, 'sampleEveryMs')),
      escalateAfterMs: number(record['escalateAfterMs'], d.escalateAfterMs, 'escalateAfterMs'),
      recoverAfterMs: number(record['recoverAfterMs'], d.recoverAfterMs, 'recoverAfterMs'),
      yellowPauseMs: number(record['yellowPauseMs'], d.yellowPauseMs, 'yellowPauseMs'),
      maxWaitMs: number(record['maxWaitMs'], d.maxWaitMs, 'maxWaitMs'),
      thresholds: {
        yellow: {
          psiMemorySome: number(yellow['psiMemorySome'], d.thresholds.yellow.psiMemorySome, 'thresholds.yellow.psiMemorySome'),
          psiIoSome: number(yellow['psiIoSome'], d.thresholds.yellow.psiIoSome, 'thresholds.yellow.psiIoSome'),
          psiCpuSome: number(yellow['psiCpuSome'], d.thresholds.yellow.psiCpuSome, 'thresholds.yellow.psiCpuSome'),
          memoryAvailablePercent: number(yellow['memoryAvailablePercent'], d.thresholds.yellow.memoryAvailablePercent, 'thresholds.yellow.memoryAvailablePercent'),
          swapPagesPerSecond: number(yellow['swapPagesPerSecond'], d.thresholds.yellow.swapPagesPerSecond, 'thresholds.yellow.swapPagesPerSecond'),
          loadPerCpu: number(yellow['loadPerCpu'], d.thresholds.yellow.loadPerCpu, 'thresholds.yellow.loadPerCpu'),
        },
        red: {
          psiMemoryFull: number(red['psiMemoryFull'], d.thresholds.red.psiMemoryFull, 'thresholds.red.psiMemoryFull'),
          psiIoFull: number(red['psiIoFull'], d.thresholds.red.psiIoFull, 'thresholds.red.psiIoFull'),
          memoryAvailablePercent: number(red['memoryAvailablePercent'], d.thresholds.red.memoryAvailablePercent, 'thresholds.red.memoryAvailablePercent'),
          swapPagesPerSecond: number(red['swapPagesPerSecond'], d.thresholds.red.swapPagesPerSecond, 'thresholds.red.swapPagesPerSecond'),
        },
      },
    },
    notes,
  };
}

/** The CPUs this process may use. */
export function availableCpus(): number {
  return typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
}
