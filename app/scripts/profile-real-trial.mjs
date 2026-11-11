// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The three explanation profiles through DSpatch's real provider flow (DSP-192 follow-up, 10
 * November 2026). DSpatch's real windows over a fresh profile and a disposable project holding the
 * synthetic connect case of tests/support/synthetic-walks.ts; the provider REAL: the agent and model
 * named on the command line (default: Claude, `opus`, Niclas's choice), through the product's own
 * job service, snapshot, drawing, roles, engine, adapter and record. Nothing is simulated and no
 * answer is written by this script.
 *
 * What it does, in order: a review of the pair prepared by the walk loop in Standard; on the walk
 * it made, the reading profile switched to Essentials and to Teacher on two steps (a simple one and
 * one where several mechanisms meet), which asks the product for a step explanation through the
 * step explanation channel (the profile alternative made after the walk); then a new review of the
 * same pair prepared by the loop in Essentials, and another in Teacher. The texts, the records and
 * the explanations are copied as evidence; a second script lays them side by side.
 *
 * DSP-195: `--case attach` uses the debug-attach case of tests/support/synthetic-attach.ts instead,
 * `--method single` prepares the walks in one call (the product's default) instead of by the loop,
 * and on each chosen step the Step panel is photographed and read as the person sees it: the
 * prepared text before Show more, then with Show more open, and each profile alternative.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/profile-real-trial.mjs [--provider claude] [--model opus]
 *         [--profiles standard,essens,pedagog] [--timeout-min 100] [--reference "<authorization reference>"]
 *         [--out <evidence folder>]
 *
 * Needs `npm run build`, the provider's program installed and signed in on this machine, and for
 * Claude the authorization reference DSpatch asks for (`DSPATCH_CLAUDE_AUTHORIZATION`, given here as
 * `--reference`). It reads nothing of the person's own DSpatch profile and writes only under the
 * fresh profile, the disposable project and the evidence folder.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CONNECT_CASE, makeSyntheticRepo } from '../tests/support/synthetic-walks';
import { ATTACH_CASE } from '../tests/support/synthetic-attach';
import { EXEC_DEBUG_CASE } from '../tests/support/synthetic-exec-debug';
import { ProjectStore } from '../src/main/project-store';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const electron = createRequire(import.meta.url)('electron');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const provider = arg('--provider', 'claude');
const model = arg('--model', 'opus');
const profiles = arg('--profiles', 'standard,essens,pedagog').split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
const timeoutMs = Number(arg('--timeout-min', '100')) * 60_000;
const reference = arg('--reference', 'DSP-192 follow-up: the three profiles through the real provider flow, on the go-ahead of 10 November 2026');
const evidence = path.resolve(arg('--out', path.join(appDir, 'release', 'trial-profile-real', `${String(process.pid)}-${String(Date.now())}`)));
// `--resume <profile folder>`: go on in a profile an earlier attempt left, whose first loop and
// profile switches are done, with only the remaining loops to run (the project is read from the
// profile's own project store).
const resumeProfile = arg('--resume', '');
// `--switch-only`: the first loop and the profile switches on its walk, without the other loops.
const switchOnly = process.argv.includes('--switch-only');
// DSP-195: the case and the preparation method.
const CASE = { connect: CONNECT_CASE, attach: ATTACH_CASE, 'exec-debug': EXEC_DEBUG_CASE }[arg('--case', 'connect')];
if (CASE === undefined) throw new Error('--case is connect, attach or exec-debug');
const method = arg('--method', 'loop');
if (method !== 'loop' && method !== 'single') throw new Error('--method is loop or single');

const results = [];
const pages = [];
let stage = 'preflight';
let profile = '';
let project = '';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();

function check(what, ok, detail = '') {
  results.push({ stage, what, ok: Boolean(ok), detail, at: stamp() });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 600)}`}`);
  if (!ok) throw new Error(what);
}
function note(what, detail = '') {
  results.push({ stage, what, ok: true, detail, at: stamp() });
  console.log(`NOTE ${stamp()} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 600)}`}`);
}
async function poll(what, read, ms = 40_000, every = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(every);
  }
  throw new Error(`timeout (${stage}): ${what}`);
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
const q = (name) => `document.querySelector('[data-ev="${name}"]')`;

/** One DevTools connection, to one of the client's pages. */
class Page {
  constructor(port, label, matches) {
    this.port = port;
    this.label = label;
    this.matches = matches;
    this.pending = new Map();
    this.sequence = 0;
    pages.push(this);
  }
  close() {
    for (const waiting of this.pending.values()) waiting.reject(new Error('DevTools disconnected'));
    this.pending.clear();
    this.ws?.close();
    this.ws = undefined;
  }
  async attach(ms = 40_000) {
    this.close();
    await poll(`${this.label} page`, async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${String(this.port)}/json/list`, { signal: AbortSignal.timeout(1500) });
        const target = (await response.json()).find((entry) => entry.type === 'page' && this.matches(entry.url));
        if (!target) return false;
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools open timeout')); }, 3000);
          socket.onopen = () => { clearTimeout(timer); resolve(); };
          socket.onerror = () => { clearTimeout(timer); reject(new Error('DevTools open failed')); };
        });
        socket.onmessage = (event) => {
          const answer = JSON.parse(event.data);
          const waiting = this.pending.get(answer.id);
          this.pending.delete(answer.id);
          if (answer.error) waiting?.reject(new Error(JSON.stringify(answer.error)));
          else waiting?.resolve(answer.result);
        };
        this.ws = socket;
        this.url = target.url;
        return true;
      } catch {
        return false;
      }
    }, ms);
  }
  cmd(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`DevTools timeout: ${method}`)); }, 12_000);
      this.pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  async ev(expression) {
    const answer = await this.cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails).slice(0, 600));
    return answer.result?.value;
  }
  until(what, expression, ms) {
    return poll(`${this.label}: ${what}`, () => this.ev(expression).catch(() => false), ms);
  }
  async click(name) {
    await this.until(`the ${name} control`, `${q(name)}!==null && !${q(name)}.disabled`);
    const box = await this.ev(`(()=>{const element=${q(name)};element.scrollIntoView({block:'center'});const box=element.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.cmd('Input.dispatchMouseEvent', { type, ...box, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }
}

/** The main process, over the inspector: windows and reads inside any page by its contents id. */
class Main {
  constructor(port) {
    this.port = port;
    this.pending = new Map();
    this.sequence = 0;
  }
  close() {
    this.ws?.close();
    this.ws = undefined;
  }
  async attach() {
    await poll('the main process inspector', async () => {
      try {
        const list = await (await fetch(`http://127.0.0.1:${String(this.port)}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
        const target = list[0];
        if (!target) return false;
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.onopen = resolve;
          socket.onerror = () => reject(new Error('inspector open failed'));
        });
        socket.onmessage = (event) => {
          const answer = JSON.parse(event.data);
          const waiting = this.pending.get(answer.id);
          this.pending.delete(answer.id);
          if (answer.error) waiting?.reject(new Error(JSON.stringify(answer.error)));
          else waiting?.resolve(answer.result);
        };
        this.ws = socket;
        return true;
      } catch {
        return false;
      }
    });
    await this.cmd('Runtime.enable');
  }
  cmd(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`inspector timeout: ${method}`)); }, 15_000);
      this.pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  async ev(expression) {
    const answer = await this.cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails).slice(0, 600));
    return answer.result?.value;
  }
  async windows() {
    return JSON.parse(await this.ev(`(() => {
      const { BrowserWindow } = process.mainModule.require('electron');
      return JSON.stringify(BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).flatMap((w) => { try { return [read(w)]; } catch { return []; } }));
      function read(w) { return ({
        id: w.id,
        title: w.getTitle(),
        url: w.webContents.getURL(),
        contentsId: w.webContents.id,
        destroyed: w.isDestroyed(),
        views: (w.contentView?.children ?? []).filter((v) => v.webContents !== undefined).map((v) => ({ contentsId: v.webContents.id, url: v.webContents.getURL(), bounds: v.getBounds(), visible: v.getVisible() })),
      }); }
    })()`));
  }
  async read(contentsId, expression) {
    return this.ev(`(() => {
      const { webContents } = process.mainModule.require('electron');
      const wc = webContents.fromId(${String(contentsId)});
      if (!wc || wc.isDestroyed()) return null;
      return Promise.race([wc.executeJavaScript(${JSON.stringify(expression)}), new Promise((resolve) => setTimeout(() => resolve('no answer in 5 s'), 5000))]);
    })()`);
  }
  /** A PNG of a web contents as it is drawn now (DSP-195). */
  async shot(contentsId, file) {
    // A picture is evidence, not a check: Chromium cannot draw one while the display is off
    // ("UnknownVizError"), and the panel's text is still read.
    let png = null;
    try {
      png = await this.ev(`(async () => { const { webContents } = process.mainModule.require('electron'); const wc = webContents.fromId(${String(contentsId)}); if (!wc || wc.isDestroyed()) return null; const image = await wc.capturePage(); return image.toPNG().toString('base64'); })()`);
    } catch (error) {
      note(`no picture of ${path.basename(file)}`, error instanceof Error ? error.message.slice(0, 160) : String(error));
    }
    if (typeof png === 'string') fs.writeFileSync(file, Buffer.from(png, 'base64'));
    return typeof png === 'string';
  }
  async size(windowId, width, height) {
    return this.ev(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.fromId(${String(windowId)}); w.setSize(${String(width)}, ${String(height)}); return JSON.stringify(w.getContentBounds()); })()`);
  }
}

const isMainPage = (url) => url !== '' && !url.includes('window=');
const isDiffPage = (url) => url.includes('view=diff');
const isPanelPage = (url) => url.includes('view=panel');
const isWalkPage = (url) => url.includes('window=review') && !url.includes('view=');
const client = { child: null, cdp: 0, inspect: 0, main: null, log: '' };
const read = (contentsId, expression) => client.main.read(contentsId, expression);

async function launch(label) {
  client.cdp = await freePort();
  client.inspect = await freePort();
  client.log = path.join(evidence, `client-${label}.log`);
  const output = fs.openSync(client.log, 'a');
  // Nothing of the simulated trials: every DSPATCH_ variable is dropped, and only the profile
  // guard and the Claude authorization reference are set. The provider's own program and
  // sign-in are the machine's. A shell inside Claude Code carries that session's CLAUDE_* and
  // ANTHROPIC_* variables, which the adapter refuses (it reuses no Claude Code token), so they
  // are dropped too: DSpatch then sees the plain machine environment a person's launch has.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSPATCH_') && !/^(CLAUDE|ANTHROPIC)/i.test(key)));
  const child = spawn(electron, [`--inspect=${String(client.inspect)}`, '.', `--user-data-dir=${profile}`, `--remote-debugging-port=${String(client.cdp)}`], {
    cwd: appDir,
    env: { ...env, DSPATCH_EXPECT_USERDATA: profile, DSPATCH_CLAUDE_AUTHORIZATION: reference },
    stdio: ['ignore', output, output],
  });
  fs.closeSync(output);
  client.child = child;
  client.main = new Main(client.inspect);
  await client.main.attach();
  const main = new Page(client.cdp, `${label} main`, isMainPage);
  await main.attach();
  await main.until('bridge ready', 'Boolean(window.dspatch)');
  return main;
}
async function quitClient() {
  const { child } = client;
  client.main?.close();
  for (const page of pages) page.close();
  pages.length = 0;
  if (child === null || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(15_000)]);
}
async function endHost() {
  try {
    const running = JSON.parse(fs.readFileSync(path.join(profile, 'host-running.json'), 'utf8'));
    process.kill(running.pid, 'SIGTERM');
    await poll('the host ends', () => {
      try {
        process.kill(running.pid, 0);
        return false;
      } catch {
        return true;
      }
    }, 15_000);
    results.push({ stage: 'cleanup', what: 'the standalone host of this trial ended', ok: true, detail: String(running.pid) });
  } catch (error) {
    results.push({ stage: 'cleanup', what: 'the standalone host of this trial ended', ok: false, detail: String(error) });
  }
}
async function windowShowing(matches, what) {
  return poll(what, async () => (await client.main.windows()).find((w) => !w.destroyed && (matches(w.url) || w.views.some((v) => matches(v.url)))) ?? false, 30_000);
}
const panelView = async () => {
  for (const w of await client.main.windows()) {
    const view = w.views.find((v) => isPanelPage(v.url));
    if (view) return { frame: w, view, docked: w.url !== '' };
  }
  return null;
};

// --- The profile's stores, read from disk ----------------------------------------------------

function filesUnder(folder, suffix) {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(suffix)) found.push(full);
    }
  };
  walk(folder);
  return found;
}
const explanationEntries = () => filesUnder(path.join(profile, 'reviews'), '.explanations.json').flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).entries ?? []);
const doneFor = (stepId, profileId) => explanationEntries().some((entry) => entry.stepId === stepId && entry.profile === profileId && entry.status === 'done');
const failedFor = (stepId, profileId) => explanationEntries().find((entry) => entry.stepId === stepId && entry.profile === profileId && ['failed', 'error', 'cancelled', 'refused'].includes(entry.status)) ?? null;

/** Every object with an id and places in a walk definition, whatever its nesting. */
function stepsOf(value, out = []) {
  if (Array.isArray(value)) {
    for (const entry of value) stepsOf(entry, out);
  } else if (value !== null && typeof value === 'object') {
    if (typeof value.id === 'string' && Array.isArray(value.places)) {
      out.push({
        id: value.id,
        title: typeof value.title === 'string' ? value.title : '',
        // A definition's place keeps its range under `focus`; a plan's place has it on the place itself.
        places: value.places.map((place) => {
          const at = place.focus ?? place;
          return { path: at.path ?? at.file ?? '', side: at.side ?? 'target', start: at.start ?? at.range?.start ?? 0, end: at.end ?? at.range?.end ?? 0 };
        }),
      });
    }
    for (const entry of Object.values(value)) stepsOf(entry, out);
  }
  return out;
}
function definitionOfJob(jobId) {
  return filesUnder(path.join(profile, 'reviews'), '.review.json').find((file) => path.basename(file).startsWith(jobId)) ?? null;
}
const covers = (step, file, line) => step.places.some((place) => place.side !== 'base' && place.path.replaceAll('\\', '/').endsWith(file) && place.start <= line && line <= place.end);

/** The simple step (the registration in startSession) and the complex one (settle), by their places. */
function chooseSteps(steps) {
  if (CASE === EXEC_DEBUG_CASE) {
    // DSP-199: the pre-launch task (a simple step) and the detached start under the debugger (a larger one).
    const simple = steps.find((step) => covers(step, '.vscode/tasks.json', 5)) ?? steps[0] ?? null;
    const complex = steps.find((step) => covers(step, 'scripts/start-debugger.sh', 24) && step.id !== simple?.id) ?? steps.find((step) => step.id !== simple?.id) ?? null;
    return { simple, complex };
  }
  if (CASE === ATTACH_CASE) {
    // DSP-195: the attach configuration (the observed step) and the step where VS Code connects to
    // the listener the container starts, where several mechanisms meet.
    const simple = steps.find((step) => covers(step, '.vscode/launch.json', 7)) ?? steps[0] ?? null;
    const complex = steps.find((step) => covers(step, '.vscode/launch.json', 9) && step.id !== simple?.id) ?? steps.find((step) => covers(step, 'compose.yaml', 4) && step.id !== simple?.id) ?? steps.find((step) => step.id !== simple?.id) ?? null;
    return { simple, complex };
  }
  const simple = steps.find((step) => covers(step, 'src/session.ts', 4)) ?? steps[0] ?? null;
  const complex = steps.find((step) => covers(step, 'src/link.ts', 34) && step.id !== simple?.id) ?? steps.find((step) => covers(step, 'src/link.ts', 21) && step.id !== simple?.id) ?? steps.find((step) => step.id !== simple?.id) ?? null;
  return { simple, complex };
}

// --- Driving the windows -----------------------------------------------------------------------

async function openPair(page) {
  const chosen = (count) => `document.querySelectorAll('.rv-pair-commit[aria-pressed=true]').length === ${String(count)}`;
  await page.until('the reviews, the repositories, the log or the review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-repo-0')}!==null || ${q('pair-commit-1')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await page.ev(`${q('pair-discussion')}!==null`)) === true) return;
  if ((await page.ev(`${q('pair-ongoing-open-0')}!==null`)) === true) {
    await page.click('pair-ongoing-open-0');
    await page.until('the review resumed', `${q('pair-discussion')}!==null`, 60_000);
    return;
  }
  if ((await page.ev(`${q('pair-repo-0')}!==null`)) === true) {
    const which = await page.ev(`[...document.querySelectorAll('[data-ev^="pair-repo-"]')].find((e) => e.textContent.includes(${JSON.stringify(path.basename(project))}))?.dataset.ev ?? 'pair-repo-0'`);
    await page.click(which);
  }
  await page.until('the log', `${q('pair-commit-1')}!==null`);
  await page.click('pair-commit-1');
  await page.until('From chosen', chosen(1));
  await page.click('pair-commit-0');
  await page.until('both chosen', chosen(2));
  await page.click('pair-open');
  const opened = await page.until('the review of the pair', `${q('pair-discussion')}!==null`, 15_000).catch(() => false);
  if (opened !== true) {
    await page.ev(`${q('pair-open')}?.click()`);
    await page.until('the review of the pair', `${q('pair-discussion')}!==null`, 60_000);
  }
}
async function openNewPair(page) {
  // From an open review, All reviews leads to the list that offers a new review.
  if ((await page.ev(`${q('pair-discussion')}!==null && ${q('pair-all-reviews')}!==null`)) === true) {
    await page.click('pair-all-reviews');
  }
  await page.until('the reviews list or the chooser', `${q('pair-ongoing-open-0')}!==null || ${q('pair-repo-0')}!==null || ${q('pair-new-review')}!==null || ${q('pair-commit-1')}!==null`, 60_000);
  if ((await page.ev(`${q('pair-new-review')}!==null`)) === true) {
    await page.click('pair-new-review');
    await page.until('the repositories or the log', `${q('pair-repo-0')}!==null || ${q('pair-commit-1')}!==null`, 60_000);
  }
  await openPair(page);
}

/** A React-controlled select or input set from the page, with the event React listens for. */
const setControl = (name, value) => `(()=>{const e=${q(name)};if(!e)return 'missing';if(e.tagName==='SELECT'){e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;}const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return e.value;})()`;

const jobsOf = async (page, key) => JSON.parse(await page.ev(`window.dspatchReviewPair.state(${JSON.stringify(key)}).then((r)=>JSON.stringify(r.jobs.filter((j)=>j.kind==='walks')))`));

/** Prepare the walks of the open review by the loop, in the profile, with the real agent; wait for the job to settle. */
async function prepare(page, key, profileId) {
  await page.click('pair-prepare-walks');
  await page.until('the agent picker', `${q('pair-walks-agent-provider')}!==null`, 60_000);
  const option = JSON.parse(await page.ev(`JSON.stringify((()=>{const o=[...${q('pair-walks-agent-provider')}.options].find((x)=>x.value===${JSON.stringify(provider)});return o?{disabled:o.disabled,title:o.title,text:o.textContent}:null})())`));
  check(`${provider} can be chosen as the agent`, option !== null && option.disabled === false, JSON.stringify(option));
  await page.ev(setControl('pair-walks-agent-provider', provider));
  await page.until('the model control', `${q('pair-walks-agent-model')}!==null`, 60_000);
  // The listing arrives after the provider is chosen; a select with the model wins, an input takes it as typed.
  const listed = await poll('the model listing', async () => {
    const kind = await page.ev(`(()=>{const e=${q('pair-walks-agent-model')};if(!e)return null;if(e.tagName!=='SELECT')return 'input';return [...e.options].some((o)=>o.value===${JSON.stringify(model)})?'listed':'select-without';})()`);
    return kind === 'listed' || kind === 'input' ? kind : false;
  }, 90_000, 500);
  note(`the model control is a ${listed === 'listed' ? 'select listing' : 'text input taking'} ${model}`);
  await page.ev(setControl('pair-walks-agent-model', model));
  await page.ev(setControl('pair-walks-agent-explanations', profileId));
  await page.ev(setControl('pair-walks-agent-method', method));
  await delay(300);
  const chosen = JSON.parse(await page.ev(`JSON.stringify({provider:${q('pair-walks-agent-provider')}.value,model:${q('pair-walks-agent-model')}.value,explanations:${q('pair-walks-agent-explanations')}.value,method:${q('pair-walks-agent-method')}.value,note:${q('pair-walks-agent-note')}?.textContent??''})`));
  check(`the picker holds ${provider}, ${model}, ${profileId}, ${method}`, chosen.provider === provider && chosen.model === model && chosen.explanations === profileId && chosen.method === method, JSON.stringify(chosen));
  const before = (await jobsOf(page, key)).length;
  await page.click('pair-walks-agent-start');
  await page.until('the job line', `${q('agent-job-walks')}!==null`, 60_000);
  const startedAt = Date.now();
  note(`the ${method === 'loop' ? 'loop' : 'one-call preparation'} started in ${profileId}`, await page.ev(`${q('agent-job-walks')}?.textContent ?? ''`));
  let lastLine = '';
  // A finished job leaves the job line (the view shows the walk loop's one line instead), so
  // the job's own state, read from the review, is what settles the wait.
  const settled = await poll(`the ${profileId} loop settles`, async () => {
    const state = await page.ev(`${q('agent-job-walks')}?.dataset.state ?? 'none'`);
    const line = await page.ev(`${q('agent-job-walks')}?.textContent ?? ''`);
    if (line !== lastLine) {
      lastLine = line;
      console.log(`      ${stamp()} [${state}] ${line.slice(0, 200)}`);
    }
    if (['done', 'failed', 'cancelled', 'unknown'].includes(state)) return state;
    if (state === 'none') {
      const latest = (await jobsOf(page, key)).slice(-1)[0] ?? null;
      if (latest !== null && latest.state !== 'running' && latest.state !== 'cancelling') return latest.state;
    }
    return false;
  }, timeoutMs, 5000);
  const jobs = await jobsOf(page, key);
  const job = jobs[jobs.length - 1] ?? null;
  check(`the ${profileId} loop ended as done (${Math.round((Date.now() - startedAt) / 60000)} min)`, settled === 'done' && job !== null && job.state === 'done' && jobs.length === before + 1, JSON.stringify({ settled, job: job === null ? null : { id: job.id, state: job.state, note: job.note, detail: job.detail, method: job.method, provider: job.provider, model: job.model, presentation: job.presentation } }));
  return job;
}

/**
 * What the Step panel shows of a step now, as the person sees it (DSP-195): a picture and the text
 * before Show more; then Show more opened, a second picture and the text behind it, and closed
 * again. For the prepared text it also records where "Why it matters" stands relative to the
 * Show more control. Pictures and texts go to the evidence folder.
 */
const seen = [];
async function seeStep(pc, step, label) {
  const name = `step-${step.id}-${label}`;
  const read1 = JSON.parse(await read(pc, `JSON.stringify((() => {
    const box = document.querySelector('[data-ev="profile-explanation"]') ?? document.querySelector('[data-ev="step-prepared-explanation"]');
    if (box === null) return null;
    const clone = box.cloneNode(true);
    clone.querySelectorAll('.rv-answer-details, .rv-answer-refs, .rv-answer-toggles').forEach((n) => n.remove());
    const more = box.querySelector('[data-ev="answer-show-more"]');
    const why = box.querySelector('[data-ev="step-why"]');
    return {
      kind: box.dataset.ev,
      // Read laid out, so paragraphs keep their breaks: a detached clone's innerText has none.
      before: (() => { const holder = document.createElement('div'); holder.style.cssText = 'position:absolute;left:-20000px;top:0;width:' + String(box.clientWidth) + 'px'; holder.appendChild(clone); document.body.appendChild(holder); const text = clone.innerText.trim(); holder.remove(); return text; })(),
      hasMore: more !== null,
      why: why === null ? null : why.innerText.trim(),
      whyBeforeMore: why !== null && more !== null ? Boolean(why.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
    };
  })())`) ?? 'null');
  const shown = { step: step.id, title: step.title, label, ...(read1 ?? { kind: null }) };
  await client.main.shot(pc, path.join(evidence, `${name}.png`));
  if (read1?.hasMore === true) {
    await read(pc, "(() => { const box = document.querySelector('[data-ev=\"profile-explanation\"]') ?? document.querySelector('[data-ev=\"step-prepared-explanation\"]'); box.querySelector('[data-ev=\"answer-show-more\"]').click(); return true; })()");
    await delay(600);
    shown.behind = await read(pc, "(() => { const box = document.querySelector('[data-ev=\"profile-explanation\"]') ?? document.querySelector('[data-ev=\"step-prepared-explanation\"]'); return box.querySelector('[data-ev=\"answer-details\"]')?.innerText.trim() ?? ''; })()");
    await client.main.shot(pc, path.join(evidence, `${name}-show-more.png`));
    await read(pc, "(() => { const box = document.querySelector('[data-ev=\"profile-explanation\"]') ?? document.querySelector('[data-ev=\"step-prepared-explanation\"]'); box.querySelector('[data-ev=\"answer-show-more\"]').click(); return true; })()");
    await delay(400);
    // DSP-199: Show more closes the deepening again.
    const closed = await read(pc, "(() => { const box = document.querySelector('[data-ev=\"profile-explanation\"]') ?? document.querySelector('[data-ev=\"step-prepared-explanation\"]'); return box.querySelector('[data-ev=\"answer-details\"]') === null; })()");
    check(`${step.id} (${label}): Show more opens the deepening and closes it again`, (shown.behind ?? '') !== '' && closed === true, JSON.stringify({ behind: (shown.behind ?? '').length, closed }));
  }
  fs.writeFileSync(path.join(evidence, `${name}.md`), `# ${step.id} ${step.title} (${label})\n\n## Before Show more\n\n${shown.before ?? '(not found)'}\n\n## Behind Show more\n\n${shown.behind ?? '(no Show more)'}\n`);
  // DSP-199: an Essentials walk from version 12 on shows its short part with no summary line above it and no "Why it matters".
  if (label === 'essens-prepared') {
    const extra = JSON.parse(await read(pc, "JSON.stringify((() => { const box = document.querySelector('[data-ev=\"step-prepared-explanation\"]'); return { summary: box?.querySelector('.rv-summary') !== null && box !== null, why: box?.querySelector('[data-ev=\"step-why\"]') !== null && box !== null }; })())") ?? '{}');
    check(`${step.id}: the Essentials short part has no summary line above it and no "Why it matters"`, extra.summary === false && extra.why === false, JSON.stringify(extra));
  }
  if (label.endsWith('-prepared') && shown.why !== null && shown.hasMore) check(`${step.id}: "Why it matters" stands before the Show more control`, shown.whyBeforeMore === true, JSON.stringify({ whyBeforeMore: shown.whyBeforeMore }));
  check(`${step.id} (${label}): the Step panel shows the explanation`, read1 !== null && (read1.before ?? '') !== '', JSON.stringify({ kind: read1?.kind, chars: read1?.before?.length }));
  seen.push({ ...shown, before: shown.before?.length ?? 0, behind: shown.behind?.length ?? 0 });
}

/** Copy the profile's review stores to the evidence folder under a name. */
function keepReviews(name) {
  const from = path.join(profile, 'reviews');
  const to = path.join(evidence, name);
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
}

async function main() {
  stage = 'preflight';
  check('the build is there', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) || fs.existsSync(path.join(appDir, 'dist')));
  let made;
  if (resumeProfile === '') {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-profile-real-'));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-profile-real-project-'));
    made = makeSyntheticRepo(scratch, CASE);
    project = made.repo;
    note(`the disposable project holds the ${CASE.name} case`, JSON.stringify({ base: made.base, target: made.target }));
    // The fresh profile knows only this project, the chosen agent and its model: the same choices
    // Niclas's own profile records, written here as configuration, with nothing copied from it.
    fs.writeFileSync(path.join(profile, 'dspatch-agent-choice.json'), `${JSON.stringify({ formatVersion: 1, agent: provider, chosenAtUtc: stamp() }, null, 2)}\n`);
    fs.writeFileSync(path.join(profile, 'dspatch-model-choice.json'), `${JSON.stringify({ formatVersion: 1, models: { [provider]: model } }, null, 2)}\n`);
    const store = new ProjectStore(path.join(profile, 'dspatch-projects.json'));
    const opened = store.openFolder(project);
    check('the profile lists the project', opened.problem === null, String(opened.problem));
  } else {
    profile = path.resolve(resumeProfile);
    const store = new ProjectStore(path.join(profile, 'dspatch-projects.json'));
    project = store.read().workspaces[0]?.folders[0] ?? '';
    check('the resumed profile lists its project', project !== '' && fs.existsSync(project), project);
    const pair = JSON.parse(fs.readFileSync(filesUnder(path.join(profile, 'reviews', 'pairs'), '.json').find((file) => path.basename(file).startsWith('r-')) ?? '', 'utf8'));
    made = { repo: project, base: pair.base?.hash ?? pair.base ?? '', target: pair.target?.hash ?? pair.target ?? '' };
    try { fs.unlinkSync(path.join(profile, 'host-running.json')); } catch {}
  }

  stage = 'the workspace and the review window';
  const mainPage = await launch('real');
  // The start page lists the project under Recent; opening it there is what a person does, and
  // the renderer's own state follows (a bridge call from outside would start the session on the
  // host and leave the page as it was).
  await mainPage.until('the project under Recent', `${q('open-project-0')}!==null`, 60_000);
  const agentShown = await mainPage.ev(`${q('open-agent-select')}?.value ?? null`);
  note('the start page shows the agent', String(agentShown));
  if (agentShown !== provider) await mainPage.ev(setControl('open-agent-select', provider));
  await mainPage.click('open-project-0');
  await mainPage.until('the review control', `${q('open-review')}!==null`, 90_000);
  note('the workspace opened on the project', await mainPage.ev(`${q('project-path')}?.textContent ?? ''`));
  await mainPage.click('open-review');
  await windowShowing(isDiffPage, 'the review window');
  const diff = new Page(client.cdp, 'diff', isDiffPage);
  await diff.attach(60_000);
  await openPair(diff);
  await diff.until('the pair check', 'Boolean(window.__dspatchPairCheck)', 30_000);
  const key1 = await diff.ev('window.__dspatchPairCheck.read().key');
  check('the review of the pair is open', typeof key1 === 'string' && key1 !== '', key1);

  const runs = [];
  const first = profiles[0];
  let job1;
  if (resumeProfile === '') {
    stage = `the loop in ${first}`;
    job1 = await prepare(diff, key1, first);
    keepReviews('reviews-after-1');
  } else {
    // The first loop ran in the earlier attempt: its job is the one whose definition the profile holds.
    stage = `resuming: the ${first} loop of the earlier attempt`;
    const definitionFile = filesUnder(path.join(profile, 'reviews', 'generated', key1), '.review.json')[0] ?? null;
    check('the resumed profile holds the first loop\'s definition', definitionFile !== null, String(definitionFile));
    const jobId = path.basename(definitionFile).replace(/\.review\.json$/, '');
    job1 = (await jobsOf(diff, key1)).find((job) => job.id === jobId) ?? { id: jobId, state: 'done', startedAt: null, endedAt: null };
    check('the first loop\'s job is done', job1.state === 'done', JSON.stringify({ id: job1.id, state: job1.state }));
  }
  runs.push({ profile: first, key: key1, job: job1 });
  const definition1 = definitionOfJob(job1.id);
  check('the loop wrote the walk definition', definition1 !== null, String(definition1));
  const steps1 = stepsOf(JSON.parse(fs.readFileSync(definition1, 'utf8')));
  const { simple, complex } = chooseSteps(steps1);
  check('a simple and a complex step were found by their places', simple !== null && complex !== null, JSON.stringify({ simple, complex, all: steps1.map((s) => `${s.id} ${s.title}`) }));

  const switched = [];
  let afterSwitch = [];
  if (resumeProfile !== '') {
    afterSwitch = explanationEntries();
    note('resuming: the explanations the earlier attempt made', JSON.stringify(afterSwitch.map((e) => `${e.stepId}:${e.profile}:${e.action}:${e.status}`)));
  } else {
  stage = 'the reading profile switched after the loop: Essentials and Teacher on the two steps';
  await diff.click('pair-walks');
  const walkWindow = await windowShowing(isWalkPage, 'the walk window');
  const walk = new Page(client.cdp, 'walk', isWalkPage);
  await walk.attach(60_000);
  await walk.until('panes', `document.querySelectorAll('section.rv-pane').length > 0`, 60_000);
  await client.main.size(walkWindow.id, 1500, 940);
  await delay(800);
  const listed = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-head-"]')].map((h)=>h.dataset.ev.slice('walk-head-'.length)))`));
  for (const id of listed) {
    if ((await walk.ev(`document.querySelector('[data-ev^="walk-step-${id}."]')===null`)) === true) await walk.ev(`document.querySelector('[data-ev="walk-head-${id}"]').click(); true`);
  }
  let panel = await poll('the panel', panelView, 30_000).catch(() => null);
  if (panel === null) {
    await diff.ev(`${q('pair-discussion')}?.click(); true`);
    panel = await poll('the panel shown', panelView, 30_000);
  }
  const pc = panel.view.contentsId;
  for (const step of [simple, complex]) {
    await walk.until(`step ${step.id}`, `document.querySelector('[data-ev="walk-step-${step.id}"]')!==null`, 30_000);
    await walk.ev(`document.querySelector('[data-ev="walk-step-${step.id}"]').click(); true`);
    await poll(`step ${step.id} in the panel`, async () => (await read(pc, `document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent`)) === step.id, 30_000);
    await read(pc, "document.querySelector('[data-ev=\"right-tab-step\"]')?.click(); true");
    await delay(1000);
    await seeStep(pc, step, `${first}-prepared`);
    for (const alternative of profiles.filter((entry) => entry !== first)) {
      const chosenProfile = await read(pc, `(()=>{const s=document.querySelector('[data-ev="presentation-profile"]');s.value=${JSON.stringify(alternative)};s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
      check(`${alternative} is chosen for reading ${step.id}`, chosenProfile === alternative, String(chosenProfile));
      const startedAt = Date.now();
      const ended = await poll(`the ${alternative} explanation of ${step.id}`, async () => doneFor(step.id, alternative) ? 'done' : failedFor(step.id, alternative) ? 'failed' : false, 20 * 60_000, 2000);
      const entry = explanationEntries().find((e) => e.stepId === step.id && e.profile === alternative) ?? null;
      check(`the ${alternative} explanation of ${step.id} arrived (${Math.round((Date.now() - startedAt) / 1000)} s)`, ended === 'done', JSON.stringify(entry === null ? null : { status: entry.status, action: entry.action, error: entry.error ?? entry.failure ?? null }));
      switched.push({ stepId: step.id, profile: alternative, seconds: Math.round((Date.now() - startedAt) / 1000) });
      await delay(1500);
      await seeStep(pc, step, `${alternative}-alternative`);
      await read(pc, `(()=>{const s=document.querySelector('[data-ev="presentation-profile"]');s.value='standard';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
      await delay(1500);
    }
  }
  afterSwitch = explanationEntries();
  check('exactly the asked explanations were made: two steps, two profiles each', afterSwitch.length === 2 * (profiles.length - 1), JSON.stringify(afterSwitch.map((e) => `${e.stepId}:${e.profile}:${e.action}:${e.status}`)));
  keepReviews('reviews-after-switch');
  }

  for (const [index, profileId] of (switchOnly ? [] : profiles.slice(1)).entries()) {
    stage = `a new review of the same pair, the loop in ${profileId}`;
    await openNewPair(diff);
    await diff.until('the pair check again', 'Boolean(window.__dspatchPairCheck)', 30_000);
    const key = await diff.ev('window.__dspatchPairCheck.read().key');
    const job = await prepare(diff, key, profileId);
    runs.push({ profile: profileId, key, job });
    keepReviews(`reviews-after-${String(index + 2)}`);
  }

  stage = 'summary';
  const summary = {
    provider,
    model,
    reference,
    project: { case: CASE.name, base: made.base, target: made.target },
    method,
    seen,
    profile,
    chosenSteps: { simple, complex },
    runs: runs.map((run) => ({ profile: run.profile, key: run.key, jobId: run.job.id, state: run.job.state, startedAt: run.job.startedAt, endedAt: run.job.endedAt, definition: definitionOfJob(run.job.id) })),
    switched,
    explanations: afterSwitch.map((e) => ({ stepId: e.stepId, profile: e.profile, action: e.action, status: e.status })),
  };
  fs.writeFileSync(path.join(evidence, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  note('summary written', path.join(evidence, 'summary.json'));
}

fs.mkdirSync(evidence, { recursive: true });
try {
  await main();
} catch (error) {
  results.push({ stage, what: `error: ${error instanceof Error ? error.message : String(error)}`, ok: false, detail: error instanceof Error ? (error.stack ?? '') : '' });
  console.log(`FAIL ${stage}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  try { keepReviews('reviews-final'); } catch {}
  await quitClient();
  await endHost();
  fs.writeFileSync(path.join(evidence, 'results.json'), `${JSON.stringify({ results, profile, project, evidence }, null, 2)}\n`);
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`${failed === 0 ? 'ALL PASSED' : 'FAILED'}: ${String(results.length)} entries; evidence ${evidence}; profile ${profile}`);
}
