// @ts-nocheck: a check script over raw /proc text and modules it imports at run time.
// The resource governor on a real Linux machine (DSP-173): reads the machine's own /proc files and
// checks that the governor reads and interprets them with the right units and intervals, that a
// signal it cannot read never makes the machine GREEN, that its reading starts and stops with a
// loop run without leaving timers or overlapping reads, and that a light loop run in observe goes
// exactly as without it while its journal carries timestamped health lines. No load is generated:
// the loop is the development loop walked dry, a few seconds long.
//
// Run from app/ on Linux:
//   node --import ./scripts/ts-resolve.mjs scripts/governor-linux-check.mjs [outDir]
// Writes report.txt and report.json to outDir (default release/governor-linux-check) and exits
// non-zero if any check fails.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const app = process.cwd();
const load = (file) => import(pathToFileURL(path.join(app, file)).href);
const outDir = path.resolve(process.argv[2] ?? 'release/governor-linux-check');
fs.mkdirSync(outDir, { recursive: true });

const lines = [];
const checks = [];
const say = (line = '') => {
  lines.push(line);
  console.log(line);
};
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`);
};
const finish = () => {
  const failed = checks.filter((one) => !one.ok);
  say('');
  say(`${String(checks.length - failed.length)} of ${String(checks.length)} checks passed`);
  fs.writeFileSync(path.join(outDir, 'report.txt'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify({ platform: process.platform, checks }, null, 2)}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
};

if (process.platform !== 'linux') {
  say(`This check reads Linux's /proc; on ${process.platform} the governor measures nothing and says so.`);
  check('runs on Linux', false, process.platform);
  finish();
}

const governor = await load('src/main/resource-governor.ts');
const { DEFAULT_GOVERNOR_CONFIG, ResourceGovernor, ResourceSampler, assess, availableCpus, realClock } = governor;
const { GovernedRunControl } = await load('src/main/resource-governor-control.ts');
const { LoopRunController } = await load('src/main/loop-control-runtime.ts');
const { createFileRoleResolver } = await load('src/main/loop-graph-roles.ts');
const { loadLoopGraph } = await load('src/shared/loop-graph-load.ts');
const { createDryRunExecutor, runLoopGraph, formatJournalEntry } = await load('src/shared/loop-run.ts');

const FILES = ['/proc/pressure/memory', '/proc/pressure/io', '/proc/pressure/cpu', '/proc/meminfo', '/proc/vmstat', '/proc/loadavg'];
const near = (a, b) => a !== undefined && b !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

// --- 1. Real /proc, read by the governor and by hand -----------------------------------------
say('== 1. The machine\'s own /proc, as the governor reads it and as read independently here');
say(`kernel: ${fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8').trim()}; CPUs this process may use: ${String(availableCpus())}`);

/** The sampler's reads, with the exact text it got, so the values can be recomputed from the same bytes. */
const seen = [];
const recordingRead = async (file) => {
  const text = await fs.promises.readFile(file, 'utf8');
  seen.push({ file, text });
  return text;
};
const sampler = new ResourceSampler({ platform: 'linux', readText: recordingRead, cpus: availableCpus });
const t0 = Date.now();
const first = await sampler.read(t0);
const firstTexts = new Map(seen.map((one) => [one.file, one.text]));
seen.length = 0;
await delay(2000);
const t1 = Date.now();
const second = await sampler.read(t1);
const texts = new Map(seen.map((one) => [one.file, one.text]));
for (const file of FILES) {
  say(`--- ${file}${texts.has(file) ? '' : ' (not readable)'}`);
  const text = texts.get(file);
  if (text !== undefined) {
    const shown = file === '/proc/meminfo' ? text.split('\n').filter((line) => /^(MemTotal|MemAvailable|SwapTotal|SwapFree):/.test(line)).join('\n')
      : file === '/proc/vmstat' ? text.split('\n').filter((line) => /^pswp(in|out) /.test(line)).join('\n')
      : text.trim();
    say(shown);
  }
}
say(`--- the governor's reading: ${JSON.stringify(second)}`);

const psiAvg10 = (text, kind) => {
  if (text === undefined) return undefined;
  const line = text.split('\n').find((one) => one.startsWith(`${kind} `));
  if (line === undefined) return undefined;
  const fields = Object.fromEntries(line.split(' ').slice(1).map((pair) => pair.split('=')));
  return { avg10: Number(fields.avg10), avg60: Number(fields.avg60), avg300: Number(fields.avg300), total: Number(fields.total) };
};
const psiFiles = ['/proc/pressure/memory', '/proc/pressure/io', '/proc/pressure/cpu'];
const hasPsi = psiFiles.every((file) => texts.has(file));
check('PSI files readable (the kernel has PSI enabled)', hasPsi, hasPsi ? '' : `missing: ${second.missing.join('; ')}`);
if (hasPsi) {
  const pairs = [
    ['memorySome', '/proc/pressure/memory', 'some'],
    ['memoryFull', '/proc/pressure/memory', 'full'],
    ['ioSome', '/proc/pressure/io', 'some'],
    ['ioFull', '/proc/pressure/io', 'full'],
    ['cpuSome', '/proc/pressure/cpu', 'some'],
  ];
  for (const [key, file, kind] of pairs) {
    const raw = psiAvg10(texts.get(file), kind);
    const got = second.psi?.[key];
    check(`PSI ${key} is that line's avg10, a percent of the last 10 s stalled`, raw !== undefined && near(got, raw.avg10) && got >= 0 && got <= 100,
      `read ${String(got)}; line avg10=${String(raw?.avg10)} avg60=${String(raw?.avg60)} avg300=${String(raw?.avg300)}`);
  }
}
{
  const fields = new Map((texts.get('/proc/meminfo') ?? '').split('\n').map((line) => /^(\w+):\s+(\d+) kB/.exec(line)).filter(Boolean).map((m) => [m[1], Number(m[2])]));
  const total = fields.get('MemTotal');
  const available = fields.get('MemAvailable');
  const expected = (available / total) * 100;
  check('available memory is MemAvailable over MemTotal, both in kB, as a percent', near(second.memoryAvailablePercent, expected),
    `read ${second.memoryAvailablePercent?.toFixed(3)} %; MemAvailable ${String(available)} kB of MemTotal ${String(total)} kB = ${expected.toFixed(3)} %`);
  const swapUsedKb = (fields.get('SwapTotal') ?? 0) - (fields.get('SwapFree') ?? 0);
  say(`  (swap in use: ${String(swapUsedKb)} kB; not a signal by itself)`);
}
{
  const pages = (text) => {
    const pick = (name) => Number(new RegExp(`^${name} (\\d+)$`, 'm').exec(text ?? '')?.[1]);
    return pick('pswpin') + pick('pswpout');
  };
  const before = pages(firstTexts.get('/proc/vmstat'));
  const after = pages(texts.get('/proc/vmstat'));
  const seconds = (t1 - t0) / 1000;
  const expected = Math.max(0, after - before) / seconds;
  check('the first read has no swap rate: a rate needs two reads', first.swapPagesPerSecond === undefined);
  check('swap traffic is the change in pswpin+pswpout over the seconds between the two reads', near(second.swapPagesPerSecond, expected),
    `read ${String(second.swapPagesPerSecond)} pages/s; counters ${String(before)} → ${String(after)} over ${seconds.toFixed(3)} s = ${String(expected)}`);
  check('the interval between the two reads is the real time between them', seconds >= 1.9 && seconds < 10, `${seconds.toFixed(3)} s`);
}
{
  const one = Number((texts.get('/proc/loadavg') ?? '').trim().split(/\s+/)[0]);
  const expected = one / Math.max(1, availableCpus());
  check('load per CPU is the 1-minute load over the usable CPUs', near(second.loadPerCpu, expected),
    `read ${String(second.loadPerCpu)}; load ${String(one)} / ${String(availableCpus())} CPUs`);
}
check('the second read leaves nothing unread', second.missing.length === 0, second.missing.join('; '));
const level = assess(second, DEFAULT_GOVERNOR_CONFIG.thresholds);
say(`  this machine now: ${level.level} — ${level.reasons.join('; ')}`);
check('an idle CI machine assessed from real values is GREEN, not pressed', level.level === 'GREEN', level.reasons.join('; '));

// --- 2. Missing signals ------------------------------------------------------------------------
say('');
say('== 2. A signal that cannot be read never makes the machine GREEN');
{
  const firstLevel = assess(first, DEFAULT_GOVERNOR_CONFIG.thresholds);
  check('the first real read, without a swap rate yet, is UNKNOWN', firstLevel.level === 'UNKNOWN', firstLevel.reasons.join('; '));
  const noPsi = new ResourceSampler({ platform: 'linux', readText: (file) => (file.startsWith('/proc/pressure/') ? Promise.reject(new Error('ENOENT')) : fs.promises.readFile(file, 'utf8')), cpus: availableCpus });
  await noPsi.read(Date.now());
  await delay(1000);
  const withoutPsi = await noPsi.read(Date.now());
  const noPsiLevel = assess(withoutPsi, DEFAULT_GOVERNOR_CONFIG.thresholds);
  check('real memory, swap and load but no PSI: UNKNOWN, naming the disk stall it cannot see', noPsiLevel.level === 'UNKNOWN' && /disk stall/.test(noPsiLevel.reasons.join(' ')),
    `${noPsiLevel.level}: ${noPsiLevel.reasons.join('; ')}; missing: ${withoutPsi.missing.join('; ')}`);
  const noIo = new ResourceSampler({ platform: 'linux', readText: (file) => (file === '/proc/pressure/io' ? Promise.reject(new Error('EACCES')) : fs.promises.readFile(file, 'utf8')), cpus: availableCpus });
  await noIo.read(Date.now());
  await delay(1000);
  const withoutIo = await noIo.read(Date.now());
  const noIoLevel = assess(withoutIo, DEFAULT_GOVERNOR_CONFIG.thresholds);
  check('only /proc/pressure/io unreadable: UNKNOWN, and the file is named', noIoLevel.level === 'UNKNOWN' && withoutIo.missing.some((one) => one.includes('/proc/pressure/io')),
    `${noIoLevel.level}: ${noIoLevel.reasons.join('; ')}`);
  const nothing = new ResourceSampler({ platform: 'linux', readText: () => Promise.reject(new Error('EACCES')), cpus: availableCpus });
  const nothingLevel = assess(await nothing.read(Date.now()), DEFAULT_GOVERNOR_CONFIG.thresholds);
  check('nothing readable: UNKNOWN', nothingLevel.level === 'UNKNOWN', nothingLevel.reasons.join('; '));
}

// --- 3 and 4. A light loop run in observe ----------------------------------------------------
say('');
say('== 3. Reading starts and stops with a loop run; 4. a light observe run goes as without it');
const repoRoot = path.resolve(app, '..');
const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, 'docs/loop/graphs/dspatch-development-loop.graph.json'), 'utf8'), { resolveRole: createFileRoleResolver(repoRoot), connectedTargets: ['cursor'] });
if (!loaded.ok) throw new Error('the development loop did not load');
/** Each step takes a little real time, so readings happen during the run. */
const slowDry = () => {
  const inner = createDryRunExecutor();
  return async (context) => {
    await delay(300);
    return inner(context);
  };
};
/** The real clock, counting the governor's timers that are still pending (neither fired nor cancelled). */
let pendingTimers = 0;
let timersMade = 0;
const countingClock = {
  now: () => realClock.now(),
  sleep: (ms, signal) => realClock.sleep(ms, signal),
  timer: (ms, run) => {
    timersMade += 1;
    pendingTimers += 1;
    let open = true;
    const close = () => {
      if (open) {
        open = false;
        pendingTimers -= 1;
      }
    };
    const cancel = realClock.timer(ms, () => {
      close();
      run();
    });
    return () => {
      close();
      cancel();
    };
  },
};

// Plain: the run's own control and no governor.
const plainControl = new LoopRunController({ now: () => Date.now() });
plainControl.beginRun('plain');
const plain = await runLoopGraph(loaded.graph, { runId: 'plain', dryRun: true, control: plainControl, executor: slowDry() });
plainControl.endRun?.('plain');

// Observe, with the real sampler and real time. Shortened timings so a few seconds show changes
// (the defaults read every 5 s and need 15 s for a change); a read is slowed so overlap would show.
let reads = 0;
let inFlight = 0;
let maxInFlight = 0;
const realSampler = new ResourceSampler({ platform: 'linux', readText: (file) => fs.promises.readFile(file, 'utf8'), cpus: availableCpus });
const countingSampler = {
  read: async (now) => {
    reads += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await delay(150); // slower than the 100 ms period below: a second timer would overlap here
      return await realSampler.read(now);
    } finally {
      inFlight -= 1;
    }
  },
};
const config = { ...DEFAULT_GOVERNOR_CONFIG, mode: 'observe', sampleEveryMs: 100, escalateAfterMs: 1000, recoverAfterMs: 2000 };
const logs = [];
const g = new ResourceGovernor(config, countingSampler, countingClock, { log: (line) => logs.push(`${new Date().toISOString()} [dspatch] ${line}`) });
await delay(500);
check('no reading and no timer before a run uses the governor', reads === 0 && timersMade === 0, `${String(reads)} reads, ${String(timersMade)} timers`);
const controller = new LoopRunController({ now: () => Date.now() });
const abort = new AbortController();
controller.beginRun('observe', abort.signal);
const control = new GovernedRunControl(controller, g, abort.signal);
const journal = [];
const began = Date.now();
const observed = await runLoopGraph(loaded.graph, { runId: 'observe', dryRun: true, control, onJournalEntry: (entry) => journal.push(entry), executor: slowDry() });
const ranMs = Date.now() - began;
control.dispose();
controller.endRun?.('observe');
const readsAtEnd = reads;
await delay(1500);
check('the governor read during the run', readsAtEnd >= 3, `${String(readsAtEnd)} reads in ${String(ranMs)} ms`);
check('no reads overlapped, though each took longer than the period', maxInFlight === 1, `at most ${String(maxInFlight)} at once`);
check('reading stopped when the run ended', reads - readsAtEnd <= 1, `${String(reads - readsAtEnd)} read(s) after the end (one already started may finish)`);
check('no timer of the governor is left after the run', pendingTimers === 0, `${String(pendingTimers)} pending of ${String(timersMade)} made`);
const same = JSON.stringify({ status: observed.status, path: observed.path }) === JSON.stringify({ status: plain.status, path: plain.path });
check('observe changes nothing in how the run goes: the same status and path as without the governor', same, `${observed.status}, ${String(observed.path.length)} steps`);
const governorLines = journal.filter((entry) => entry.kind === 'resource-governor');
check('the journal says the mode when the run starts', /^Resource governor: observe\./.test(governorLines[0]?.detail ?? ''), governorLines[0]?.detail ?? 'none');
const changes = governorLines.filter((entry) => typeof entry.data?.['to'] === 'string');
check('each change of the health is journalled with a valid timestamp', changes.length > 0 && changes.every((entry) => !Number.isNaN(Date.parse(String(entry.data?.['at']))) && !Number.isNaN(Date.parse(entry.atIso))),
  changes.map((entry) => `${String(entry.data?.['from'])}→${String(entry.data?.['to'])} at ${String(entry.data?.['at'])}`).join(', '));
const entered = journal.filter((entry) => entry.kind === 'node-entered' && entry.data?.['resourceGovernor'] !== undefined);
check('each work step\'s start carries the mode and the health it started under', entered.length > 0 && entered.every((entry) => entry.data?.['resourceGovernor'] === 'observe' && typeof entry.data?.['resourceHealth'] === 'string'),
  entered.map((entry) => `${String(entry.nodeId)}:${String(entry.data?.['resourceHealth'])}`).join(', '));
check('observe neither held nor deferred anything', !journal.some((entry) => entry.data?.['acted'] === true || entry.data?.['hold'] === 'resources'));
say('--- the run journal\'s governor lines and step starts');
for (const entry of journal) {
  if (entry.kind === 'resource-governor' || (entry.kind === 'node-entered' && entry.data?.['resourceGovernor'] !== undefined)) {
    say(`${entry.atIso} ${formatJournalEntry(entry)}`);
  }
}
say('--- the host log\'s governor lines');
for (const line of logs) say(line);

finish();
