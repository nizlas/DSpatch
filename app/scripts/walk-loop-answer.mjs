// @ts-nocheck: an evaluation harness with a stand-in adapter over the product's untyped job answers.
/**
 * DSP-189: the walk preparation through the real product path with a file-backed stand-in for
 * the provider, so a model outside DSpatch's providers can answer the exact prompts the product
 * sends, in the order it sends them, and the product's own readers, checks, engine and record do
 * the rest.
 *
 * The host's job service (`ReviewAgentJobs`), the revision snapshot, the walk loop's drawing and
 * roles, the engine and the run record are the product's. Only the adapter is substituted: each
 * provider turn is written as `<exchange>/turn-NNN.prompt.md` with `turn-NNN.meta.json` beside
 * it (the role node, the session and the revision folder), and the turn ends when
 * `turn-NNN.answer.md` appears. Whoever writes the answer plays the model; the trial's evidence
 * says so, and this is not evidence of what a real provider does on the product path.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/walk-loop-answer.mjs --case connect --method loop --profile standard --out <dir>
 *
 * Cases: work-queue, connect (tests/support/synthetic-walks.ts), setting, snapshot, context
 * (tests/support/synthetic-cases-more.ts). Method: single (today's one call) or loop. Profile:
 * essens, standard, pedagog. The run ends when the job settles; `result.json` and the walk
 * definition are copied to `<out>`. `--timeout-min` bounds the wait for each answer (default 90).
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ReviewContexts } from '../src/host/context-repositories.ts';
import { ReviewAgentJobs } from '../src/host/review-agent-jobs.ts';
import { ReviewPairs } from '../src/host/review-pairs.ts';
import { RevisionSnapshots } from '../src/host/revision-snapshots.ts';
import { isPairError } from '../src/shared/review-pair.ts';
import { CONTEXT_CASE, SETTING_CASE, SNAPSHOT_CASE, makeContextRepos } from '../tests/support/synthetic-cases-more.ts';
import { CONNECT_CASE, WORK_QUEUE_CASE, makeSyntheticRepo } from '../tests/support/synthetic-walks.ts';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key.startsWith('--')) {
    const next = process.argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args.set(key.slice(2), next);
      index += 1;
    } else {
      args.set(key.slice(2), 'true');
    }
  }
}
const which = args.get('case') ?? 'connect';
const method = args.get('method') ?? 'loop';
const profile = args.get('profile') ?? 'standard';
const language = args.get('language') ?? 'en';
const timeoutMin = Number(args.get('timeout-min') ?? '90');
const out = path.resolve(args.get('out') ?? path.join('release', 'walk-loop-answer', `${which}-${method}-${profile}`));
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..');

fs.mkdirSync(out, { recursive: true });
const exchange = path.join(out, 'exchange');
fs.mkdirSync(exchange, { recursive: true });
const workspace = path.join(out, 'workspace');
fs.rmSync(workspace, { recursive: true, force: true });
fs.mkdirSync(workspace, { recursive: true });

const CASES = { 'work-queue': WORK_QUEUE_CASE, connect: CONNECT_CASE, setting: SETTING_CASE, snapshot: SNAPSHOT_CASE };
let repo;
if (which === 'context') {
  repo = makeContextRepos(workspace);
} else {
  const synthetic = CASES[which];
  if (synthetic === undefined) {
    console.error(`unknown case ${which}`);
    process.exit(2);
  }
  repo = { workspace, ...makeSyntheticRepo(workspace, synthetic) };
}

const log = (message) => {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(path.join(out, 'harness.log'), `${line}\n`);
};

/** The stand-in adapter: a turn is a prompt file, and its answer file ends it. */
class FileAnswerAdapter {
  constructor() {
    this.id = 'file-answer';
    this.sessions = new Map();
    this.listeners = new Map();
    this.counter = 0;
    this.cancelled = new Set();
  }
  startSession(config) {
    const dspatchSessionId = `file-${String(this.sessions.size + 1)}`;
    this.sessions.set(dspatchSessionId, { config, runs: 0 });
    log(`session ${dspatchSessionId} opened (${config.provider}/${config.modelRequested || 'default'}) in ${config.workspacePath}`);
    return Promise.resolve({ dspatchSessionId, provider: config.provider, providerSessionId: dspatchSessionId, createdAt: new Date().toISOString() });
  }
  subscribe(sessionId, listener) {
    const list = this.listeners.get(sessionId) ?? [];
    list.push(listener);
    this.listeners.set(sessionId, list);
    return () => {
      const current = this.listeners.get(sessionId) ?? [];
      this.listeners.set(sessionId, current.filter((entry) => entry !== listener));
    };
  }
  emit(sessionId, event) {
    for (const listener of this.listeners.get(sessionId) ?? []) {
      listener(event);
    }
  }
  send(sessionId, prompt) {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return Promise.reject(new Error(`No session ${sessionId}.`));
    }
    state.runs += 1;
    this.counter += 1;
    const number = String(this.counter).padStart(3, '0');
    const dspatchRunId = `${sessionId}-run-${String(state.runs)}`;
    const base = { dspatchSessionId: sessionId, dspatchRunId, rawProviderEvent: null };
    const task = prompt.slice('DSPATCH-REVIEW-TASK:'.length).split('\n')[0]?.trim() ?? '';
    const promptFile = path.join(exchange, `turn-${number}.prompt.md`);
    const answerFile = path.join(exchange, `turn-${number}.answer.md`);
    fs.writeFileSync(path.join(exchange, `turn-${number}.meta.json`), `${JSON.stringify({ turn: this.counter, task, sessionId, run: state.runs, folder: state.config.workspacePath, promptFile, answerFile, at: new Date().toISOString() }, null, 2)}\n`);
    fs.writeFileSync(promptFile, prompt);
    log(`turn ${number} (${task}, ${sessionId}) written; waiting for ${path.basename(answerFile)}`);
    const startedAt = Date.now();
    setTimeout(() => {
      this.emit(sessionId, { ...base, type: 'run.started', at: new Date().toISOString() });
      const timer = setInterval(() => {
        if (this.cancelled.has(sessionId)) {
          clearInterval(timer);
          this.emit(sessionId, { ...base, type: 'run.finished', at: new Date().toISOString(), status: 'cancelled' });
          return;
        }
        if (Date.now() - startedAt > timeoutMin * 60_000) {
          clearInterval(timer);
          log(`turn ${number}: no answer in ${String(timeoutMin)} min`);
          this.emit(sessionId, { ...base, type: 'run.finished', at: new Date().toISOString(), status: 'error', error: { message: `No answer file arrived for turn ${number} in ${String(timeoutMin)} minutes.` } });
          return;
        }
        let text;
        try {
          text = fs.readFileSync(answerFile, 'utf8');
        } catch {
          return;
        }
        if (text.trim() === '' || fs.existsSync(`${answerFile}.writing`)) {
          return;
        }
        clearInterval(timer);
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        log(`turn ${number}: answered after ${String(seconds)} s (${String(text.length)} chars)`);
        fs.appendFileSync(path.join(out, 'turn-times.jsonl'), `${JSON.stringify({ turn: this.counter, task, sessionId, seconds, chars: text.length })}\n`);
        this.emit(sessionId, { ...base, type: 'assistant.message', at: new Date().toISOString(), text });
        this.emit(sessionId, { ...base, type: 'run.finished', at: new Date().toISOString(), status: 'finished' });
      }, 2_000);
    }, 10);
    return Promise.resolve({ dspatchRunId });
  }
  cancel(sessionId) {
    this.cancelled.add(sessionId);
    return Promise.resolve();
  }
  readUsage() {
    return Promise.resolve([]);
  }
  dispose() {
    this.listeners.clear();
    return Promise.resolve();
  }
}

const records = path.join(out, 'records');
fs.rmSync(records, { recursive: true, force: true });
const pairs = new ReviewPairs({ recordsDir: path.join(records, 'pairs'), changed: () => undefined });
await pairs.repositories([repo.workspace]);
const opened = await pairs.openPair({ repository: repo.repo, base: repo.base, target: repo.target });
if (isPairError(opened)) {
  throw new Error(opened.error);
}
const contexts =
  which === 'context'
    ? new ReviewContexts({
        recordsDir: path.join(records, 'context'),
        workspace: () => Promise.resolve({ folders: [repo.workspace], repositories: [{ name: path.basename(repo.repo), path: repo.repo }, { name: 'count-lib', path: repo.lib }] }),
        log: (message) => log(`context: ${message}`),
      })
    : undefined;
const jobs = new ReviewAgentJobs({
  recordsDir: records,
  createAdapter: () => new FileAnswerAdapter(),
  snapshots: new RevisionSnapshots({ root: path.join(records, 'revisions'), log: (message) => log(`snapshots: ${message}`) }),
  availability: () => ({ choosable: true, reason: null }),
  pairs,
  language: () => Promise.resolve(language),
  log: (message) => log(`jobs: ${message}`),
  loopResources: repoRoot,
  appVersion: 'walk-loop-answer',
  ...(contexts === undefined ? {} : { contexts }),
});
fs.writeFileSync(path.join(out, 'run.json'), `${JSON.stringify({ which, method, profile, language, repo, startedAt: new Date().toISOString() }, null, 2)}\n`);
const started = jobs.start(opened.key, { kind: 'walks', provider: 'claude', model: 'file-answer', method, presentation: { profile } });
if (isPairError(started)) {
  throw new Error(started.error);
}
log(`job ${started.id} started: ${which}, ${method}, ${profile}`);
let job;
let lastActivity = '';
for (;;) {
  const record = pairs.state(opened.key);
  job = record.jobs.find((entry) => entry.id === started.id);
  if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
    break;
  }
  if (job?.activity && job.activity !== lastActivity) {
    lastActivity = job.activity;
    log(`activity: ${lastActivity}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
log(`job ended ${job.state}: ${job.note}${job.detail ? ` (${job.detail})` : ''}`);
fs.writeFileSync(path.join(exchange, 'done'), `${job.state}\n`);
fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify({ job, endedAt: new Date().toISOString() }, null, 2)}\n`);
if (job.definitionPath) {
  fs.copyFileSync(job.definitionPath, path.join(out, 'definition.review.json'));
  log(`definition copied to ${path.join(out, 'definition.review.json')}`);
}
if (job.loop?.recordPath && fs.existsSync(job.loop.recordPath)) {
  fs.copyFileSync(job.loop.recordPath, path.join(out, 'record.jsonl'));
}
await jobs.dispose();
process.exit(job.state === 'done' ? 0 : 1);
