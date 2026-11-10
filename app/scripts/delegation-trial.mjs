// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The delegated-review trial (DSP-193): the agent's assessment as material, the person's
 * decision, and the findings read in Review without taking over Step. DSpatch's real windows over
 * an isolated profile and a disposable project holding the synthetic connect case; the provider
 * SIMULATED (the presentation adapter with DSPATCH_REVIEW_SIM=mixed: several findings with a long
 * heading and a long path, open questions beside assessed lines, verification gaps of both kinds).
 * What it proves is the product's handling with simulated answers, never the agent's review quality.
 *
 * It delegates the whole change and reads the diff view: the report folded, its state awaiting
 * the person, the assessed lines drawn as assessed and counted as nothing, the findings folded
 * and opening one by one, a comment that reopens nothing; it accepts the assessment, sees the
 * lines count and the findings stay, withdraws and accepts again. It prepares walks, delegates a
 * walk from the Step tab's Review section with the tab and the scroll position recorded, and reads
 * the result there: the step's explanation first, the report once and folded, the step's own
 * findings folded, the report's lines selecting rather than doubling, the next step without a
 * second report; the panel floating and docked, and narrow. It restarts, strips the decision marks
 * from the record as a 0.1.17 record would be, and reads the old assessment as awaiting, never as
 * a decision. Evidence is page captures and what the pages say.
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/delegation-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`. On Linux without DISPLAY, Xvfb is started here.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CONNECT_CASE, makeSyntheticRepo } from '../tests/support/synthetic-walks';

const onWindows = process.platform === 'win32';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-delegation', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_PRESENTATION_LIST_MS: '50',
  DSPATCH_PRESENTATION_TOOL_MS: '120',
  DSPATCH_PRESENTATION_DELTA_MS: '20',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
  DSPATCH_REVIEW_SIM: 'mixed',
};
const results = [];
const pages = [];
const owned = { xvfb: null };
let display = onWindows ? '' : (process.env.DISPLAY ?? '');
let stage = 'preflight';
let profile = '';
let project = '';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(what, ok, detail = '') {
  results.push({ stage, what, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 500)}`}`);
  if (!ok) throw new Error(what);
}
function note(what, detail = '') {
  results.push({ stage, what, ok: true, detail });
  console.log(`NOTE ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 500)}`}`);
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
        content: w.getContentBounds(),
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
  async size(windowId, width, height) {
    return this.ev(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.fromId(${String(windowId)}); w.setSize(${String(width)}, ${String(height)}); return JSON.stringify(w.getContentBounds()); })()`);
  }
  /** A capture of a page's own pixels, by its contents id: the evidence of what a view shows. */
  async capture(contentsId, name) {
    const file = path.join(evidence, `${name}.png`);
    await this.ev(`(async () => {
      const { webContents } = process.mainModule.require('electron');
      const fs = process.mainModule.require('node:fs');
      const wc = webContents.fromId(${String(contentsId)});
      const image = await wc.capturePage();
      fs.writeFileSync(${JSON.stringify(file)}, image.toPNG());
      return true;
    })()`);
    return file;
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
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSPATCH_')));
  const child = spawn(electron, [`--inspect=${String(client.inspect)}`, '.', `--user-data-dir=${profile}`, `--remote-debugging-port=${String(client.cdp)}`], {
    cwd: appDir,
    env: { ...env, ...(display === '' ? {} : { DISPLAY: display }), DSPATCH_EXPECT_USERDATA: profile, ...simulated },
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
    try { fs.unlinkSync(path.join(profile, 'host-running.json')); } catch {}
    results.push({ stage: 'cleanup', what: 'the standalone host of this trial ended', ok: true, detail: String(running.pid) });
  } catch (error) {
    results.push({ stage: 'cleanup', what: 'the standalone host of this trial ended', ok: false, detail: String(error) });
  }
}
async function windowShowing(matches, what) {
  return poll(what, async () => (await client.main.windows()).find((w) => !w.destroyed && (matches(w.url) || w.views.some((v) => matches(v.url)))) ?? false, 30_000);
}
const windowById = async (id) => (await client.main.windows()).find((w) => w.id === id) ?? null;
const panelView = async () => {
  for (const w of await client.main.windows()) {
    const view = w.views.find((v) => isPanelPage(v.url));
    if (view) return { frame: w, view, docked: w.url !== '' };
  }
  return null;
};
/** A page driven through the main process by its contents id (several windows share a URL). */
function pageOver(contentsId, label) {
  const page = {
    label,
    contentsId,
    ev: async (expression) => {
      const answer = await read(contentsId, expression);
      if (answer === 'no answer in 5 s') throw new Error(`${label}: no answer in 5 s`);
      return answer;
    },
    until: (what, expression, ms) => poll(`${label}: ${what}`, () => page.ev(expression).catch(() => false), ms),
    click: async (name) => {
      await page.until(`the ${name} control`, `${q(name)}!==null && !${q(name)}.disabled`);
      await page.ev(`(()=>{const e=${q(name)};e.scrollIntoView({block:'center'});e.click();return true})()`);
    },
    clickSel: async (selector) => {
      await page.until(`the ${selector} control`, `document.querySelector(${JSON.stringify(selector)})!==null`);
      await page.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.click();return true})()`);
    },
  };
  return page;
}

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

/** The pair record on disk, for the restart stage. */
function pairRecordFiles() {
  const dir = path.join(profile, 'reviews', 'pairs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^r-[0-9a-f]+\.json$/.test(name)).map((name) => path.join(dir, name));
}

const THREAD_STATE = `(()=>{const cards=[...document.querySelectorAll('[data-ev="review-thread"]')];return JSON.stringify({cards:cards.length,open:cards.filter((c)=>c.querySelector('.rv-thread-body')!==null).map((c)=>c.dataset.threadId),ids:cards.map((c)=>c.dataset.threadId)})})()`;
const DIFF_STATE = `(()=>{const strips=[...document.querySelectorAll('.rv-pair-diff [data-strip]')];const count=(k)=>strips.filter((s)=>s.dataset.strip===k).length;const r=document.querySelector('[data-ev="agent-review"]');return JSON.stringify({assessed:count('assessed'),agent:count('agent'),manual:count('manual'),none:count('none'),reportOpen:r?.open??null,decision:r?.dataset.decision??null,state:document.querySelector('[data-ev="agent-review-state"]')?.textContent??'',coverage:document.querySelector('[data-ev="agent-review-coverage"]')?.textContent??'',remaining:document.querySelector('[data-ev="agent-review-remaining"]')?.textContent??'',body:document.body.innerText})})()`;

async function main() {
  stage = 'preflight';
  check('the build is there', fs.existsSync(path.join(appDir, 'dist')));
  if (!onWindows && display === '') {
    display = ':97';
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1920x1080x24'], { stdio: 'ignore' });
    await delay(1200);
  }
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-delegation-profile-'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-delegation-project-'));
  project = makeSyntheticRepo(scratch, CONNECT_CASE).repo;

  stage = 'a delegated review of the whole change, read in the diff view';
  let main = await launch('delegation');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  await main.until('the recent project', `${q('open-project-0')}!==null`);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  await main.click('open-review');
  let diffWindow = await windowShowing(isDiffPage, 'the review window');
  const diff = new Page(client.cdp, 'review', isDiffPage);
  await diff.attach(60_000);
  await openPair(diff);
  await client.main.size(diffWindow.id, 1500, 940);
  await diff.click('pair-delegate-all');
  await diff.click('pair-delegate-all-agent-start');
  await diff.until('the delegated review done', `${q('agent-review')}?.dataset.state === 'done'`, 120_000);
  let state = JSON.parse(await diff.ev(DIFF_STATE));
  check('the report is folded by default', state.reportOpen === false, JSON.stringify({ reportOpen: state.reportOpen }));
  check('the report leads with the state: complete, awaiting the person, nothing counted', /^Agent review complete — awaiting your assessment\./.test(state.state) && state.decision === 'awaiting', state.state);
  check('the report says what the agent examined and assessed, as counts, with no approval', /The agent examined \d+ of \d+ changed lines in this part and assessed \d+ as acceptable/.test(state.coverage) && !/approved/.test(state.coverage) && !/approved by the agent/.test(state.body), state.coverage);
  check('what remains is said from the threads: open problems, questions and gaps', /open problem/.test(state.remaining) && /open question/.test(state.remaining) && /verification gap/.test(state.remaining), state.remaining);
  const summaryBefore = await diff.ev(`${q('pair-summary')}?.textContent ?? ''`);
  note('Files changed totals after the delegation, before any decision', summaryBefore);
  await diff.click('pair-file-0');
  await diff.until('the file open with strips', `document.querySelectorAll('.rv-pair-diff [data-strip]').length > 0`, 30_000);
  state = JSON.parse(await diff.ev(DIFF_STATE));
  check('assessed lines are drawn as assessed, none as reviewed: the result changed no coverage', state.assessed > 0 && state.agent === 0, JSON.stringify({ assessed: state.assessed, agent: state.agent }));
  const percentBefore = await diff.ev(`document.querySelector('.rv-pair-progress')?.textContent ?? ''`);
  check('the file counts nothing as handled before a decision', percentBefore === '0%', percentBefore);
  await diff.until('the file\'s threads', `document.querySelectorAll('[data-ev="review-thread"]').length > 0`, 20_000);
  let threads = JSON.parse(await diff.ev(THREAD_STATE));
  check('the findings are folded by default in the diff view', threads.cards >= 3 && threads.open.length === 0, JSON.stringify(threads));
  const toggle = (id) => diff.ev(`(()=>{const c=document.querySelector('[data-ev="review-thread"][data-thread-id="${id}"]');c.querySelector('[data-ev="thread-toggle"]').click();return true})()`);
  const [first, second] = threads.ids;
  await toggle(first);
  threads = JSON.parse(await diff.ev(THREAD_STATE));
  check('opening one finding opens that one only', threads.open.length === 1 && threads.open[0] === first, JSON.stringify(threads.open));
  await toggle(second);
  threads = JSON.parse(await diff.ev(THREAD_STATE));
  check('opening a second leaves the first open', threads.open.length === 2 && threads.open.includes(first) && threads.open.includes(second), JSON.stringify(threads.open));
  await toggle(first);
  threads = JSON.parse(await diff.ev(THREAD_STATE));
  check('closing the first leaves the second open: one click, one finding', threads.open.length === 1 && threads.open[0] === second, JSON.stringify(threads.open));
  // A comment updates the record; the folded findings stay folded.
  await diff.ev(`(()=>{const c=document.querySelector('[data-ev="review-thread"][data-thread-id="${second}"]');const f=c.querySelector('[data-ev="thread-comment-field"]');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(f,'Noted from the diff.');f.dispatchEvent(new Event('input',{bubbles:true}));c.querySelector('[data-ev="thread-comment"]').click();return true})()`);
  await diff.until('the comment recorded', `[...document.querySelectorAll('[data-thread-id="${second}"] [data-ev="thread-history"]')].some((e)=>e.textContent.includes('Noted from the diff.'))`, 20_000);
  threads = JSON.parse(await diff.ev(THREAD_STATE));
  check('an update of the record reopens no folded finding', threads.open.length === 1 && threads.open[0] === second, JSON.stringify(threads.open));
  const head = JSON.parse(await diff.ev(`(()=>{const h=document.querySelector('[data-ev="review-thread"] .rv-thread-head');const t=h.querySelector('.rv-thread-title').getBoundingClientRect();const s=h.querySelector('.rv-thread-status').getBoundingClientRect();return JSON.stringify({headHeight:h.getBoundingClientRect().height,titleHeight:t.height,titleTop:t.top,statusTop:s.top,width:h.getBoundingClientRect().width})})()`));
  note('a folded finding\'s head in the wide diff view', JSON.stringify(head));
  await client.main.capture(diffWindow.contentsId, '01-diff-findings-folded');

  stage = 'the person decides: accept, withdraw, accept again';
  await diff.ev(`${q('agent-review')}.open = true; true`);
  await diff.click('agent-review-accept');
  await diff.until('accepted', `${q('agent-review')}?.dataset.decision === 'accepted'`, 20_000);
  state = JSON.parse(await diff.ev(DIFF_STATE));
  check('accepting makes the assessed lines count as reviewed through the delegation, and nothing else', state.agent > 0 && state.assessed === 0 && /^Accepted by you on \d{4}-\d{2}-\d{2}:/.test(state.state), JSON.stringify({ agent: state.agent, assessed: state.assessed, state: state.state }));
  const percentAfter = await diff.ev(`document.querySelector('.rv-pair-progress')?.textContent ?? ''`);
  check('the file now counts the accepted lines', percentAfter !== '0%' && percentAfter !== '', percentAfter);
  threads = JSON.parse(await diff.ev(THREAD_STATE));
  check('accepting closes no finding and answers no question: the threads are as they were', threads.cards >= 3 && threads.open.length === 1 && (await diff.ev(`document.querySelectorAll('[data-ev="review-thread"][data-thread-status="open"]').length`)) >= 3, JSON.stringify(threads));
  check('what remains still says the open questions and gaps', /open question/.test(state.remaining) && /verification gap/.test(state.remaining), state.remaining);
  await client.main.capture(diffWindow.contentsId, '02-diff-accepted');
  await diff.click('agent-review-withdraw');
  await diff.until('awaiting again', `${q('agent-review')}?.dataset.decision === 'awaiting'`, 20_000);
  state = JSON.parse(await diff.ev(DIFF_STATE));
  check('withdrawing the decision counts the lines as assessed again', state.assessed > 0 && state.agent === 0, JSON.stringify({ agent: state.agent, assessed: state.assessed }));
  await diff.click('agent-review-reject');
  await diff.until('rejected', `${q('agent-review')}?.dataset.decision === 'rejected'`, 20_000);
  state = JSON.parse(await diff.ev(DIFF_STATE));
  check('not accepting counts nothing and keeps the report', state.assessed === 0 && state.agent === 0 && /^Not accepted by you/.test(state.state) && state.coverage !== '', JSON.stringify({ agent: state.agent, assessed: state.assessed, state: state.state }));
  await diff.click('agent-review-withdraw');
  await diff.until('awaiting once more', `${q('agent-review')}?.dataset.decision === 'awaiting'`, 20_000);
  await diff.click('agent-review-accept');
  await diff.until('accepted again', `${q('agent-review')}?.dataset.decision === 'accepted'`, 20_000);
  await diff.ev(`${q('agent-review')}.open = false; true`);

  stage = 'the walk: the report in Review, folded, once; the step\'s own findings; nothing moves on arrival';
  await diff.click('pair-prepare-walks');
  await diff.until('the picker', `${q('pair-walks-agent-method')}!==null`, 30_000);
  await diff.ev(`(()=>{const s=${q('pair-walks-agent-method')};s.value='single';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
  await diff.click('pair-walks-agent-start');
  let walkWindow = await poll('the walk window', async () => (await client.main.windows()).find((x) => !x.destroyed && isWalkPage(x.url)) ?? false, 120_000).catch(() => null);
  if (walkWindow === null) {
    await diff.click('pair-walks');
    walkWindow = await windowShowing(isWalkPage, 'the walk window');
  }
  const walk = new Page(client.cdp, 'walk', isWalkPage);
  await walk.attach(60_000);
  await walk.until('panes', `document.querySelectorAll('section.rv-pane').length > 0`, 60_000);
  await client.main.size(walkWindow.id, 1400, 900);
  const panel = await poll('the panel', panelView, 30_000);
  const pc = pageOver(panel.view.contentsId, 'panel');
  note('the panel is', panel.docked ? `docked in window ${String(panel.frame.id)}` : 'floating in its own window');
  await pc.until('the Step tab', `${q('right-tab-step')}!==null`, 30_000);
  await pc.click('right-tab-step');
  await pc.until('the step panel', `document.querySelector('.rv-step-panel')!==null`, 30_000);
  const PANEL_STATE = `(()=>{const step=document.querySelector('.rv-step-panel');const review=document.querySelector('[data-ev="walk-review-section"]');const reports=[...document.querySelectorAll('[data-ev="agent-review"]')];const before=reports.filter((r)=>step!==null&&(r.compareDocumentPosition(step)&Node.DOCUMENT_POSITION_FOLLOWING)!==0).length;const scrollers=[...document.querySelectorAll('*')].filter((e)=>e.scrollHeight>e.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).sort((a,b)=>b.clientHeight-a.clientHeight).slice(0,1).map((e)=>e.scrollTop);return JSON.stringify({tab:document.querySelector('[data-ev="right-tab-step"]')?.getAttribute('aria-selected'),stepFirst:step!==null&&before===0,reviewOpen:review?.getAttribute('aria-expanded'),reports:reports.length,reportsOpen:reports.filter((r)=>r.open).length,reportsInReview:reports.filter((r)=>r.closest('[data-ev="walk-delegation"]')!==null).length,here:document.querySelectorAll('[data-ev="walk-threads-here"] [data-ev="review-thread"]').length,hereOpen:document.querySelectorAll('[data-ev="walk-threads-here"] .rv-thread-body').length,elsewhere:document.querySelector('[data-ev="walk-threads-elsewhere"]')?.textContent??'',stepId:document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent??'',scrollers,activeElement:document.activeElement?.getAttribute('data-ev')??document.activeElement?.tagName??''})})()`;
  let panelState = JSON.parse(await pc.ev(PANEL_STATE));
  check('Step shows the step\'s explanation first and its Review section folded, with no report above the explanation', panelState.stepFirst && panelState.reviewOpen === 'false' && panelState.reports === 0, JSON.stringify(panelState));
  await pc.click('walk-review-section');
  await pc.until('the delegate control in Review', `${q('walk-delegate')}!==null`, 20_000);
  check('the delegation of the walk is offered inside the Review section', (await pc.ev(`${q('walk-delegate')}.closest('[data-ev="walk-delegation"]')!==null && ${q('walk-delegate')}.closest('.rv-collapsible')!==null`)) === true);
  await pc.click('walk-delegate');
  await pc.until('the walk\'s agent picker', `${q('walk-delegate-agent-start')}!==null`, 20_000);
  // Reading while the result arrives: the tab, the scroll positions and the focus must not move.
  await pc.ev(`(()=>{const s=[...document.querySelectorAll('*')].find((e)=>e.scrollHeight>e.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(e).overflowY));if(s)s.scrollTop=40;return true})()`);
  const beforeArrival = JSON.parse(await pc.ev(PANEL_STATE));
  await pc.click('walk-delegate-agent-start');
  await pc.until('the walk\'s review done, inside Review', `document.querySelector('[data-ev="walk-delegation"] [data-ev="agent-review"]')?.dataset.state === 'done'`, 120_000);
  await delay(800);
  panelState = JSON.parse(await pc.ev(PANEL_STATE));
  check('the arriving result changed no tab, scroll position or focus, and opened nothing', panelState.tab === 'true' && JSON.stringify(panelState.scrollers) === JSON.stringify(beforeArrival.scrollers) && panelState.reportsOpen === 0 && panelState.activeElement === beforeArrival.activeElement, JSON.stringify({ before: beforeArrival.scrollers, after: panelState.scrollers, reportsOpen: panelState.reportsOpen, focus: [beforeArrival.activeElement, panelState.activeElement] }));
  check('the report is in the Review section, once, folded; the explanation stays first', panelState.reports === 1 && panelState.reportsInReview === 1 && panelState.stepFirst, JSON.stringify(panelState));
  const reportState = await pc.ev(`${q('agent-review-state')}?.textContent ?? ''`);
  check('the walk\'s report awaits the person\'s assessment', /awaiting your assessment/.test(reportState), reportState);
  // The step's own findings: folded, and the walk's others reachable through the report.
  // The walk window lists steps under their walk's head once the head is opened.
  const heads = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-head-"]')].map((h)=>h.dataset.ev.slice('walk-head-'.length)))`));
  for (const id of heads) {
    if ((await walk.ev(`document.querySelector('[data-ev^="walk-step-${id}."]')===null`)) === true) await walk.ev(`document.querySelector('[data-ev="walk-head-${id}"]').click(); true`);
  }
  const stepsAll = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-step-"]')].map((b)=>b.dataset.ev.slice('walk-step-'.length)))`));
  check('the walk window lists the steps', stepsAll.length > 1, JSON.stringify({ heads, steps: stepsAll }));
  let withThreads = null;
  for (const id of stepsAll) {
    await walk.ev(`document.querySelector('[data-ev="walk-step-${id}"]')?.click(); true`);
    await poll(`step ${id} in the panel`, async () => (await pc.ev(`document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent`)) === id, 15_000).catch(() => null);
    const here = JSON.parse(await pc.ev(PANEL_STATE));
    if (here.here > 0 && withThreads === null) withThreads = { id, here };
    // The report belongs to the delegated walk (W1): once and folded at each of its steps, and not at another walk's.
    const expected = id.startsWith('W1.') ? 1 : 0;
    check(`step ${id}: the report is ${expected === 1 ? 'once and folded' : 'not shown, since another walk was delegated'}, the explanation first`, here.reports === expected && here.reportsOpen === 0 && here.stepFirst, JSON.stringify(here));
  }
  check('some step shows the agent\'s findings at its places, folded', withThreads !== null && withThreads.here.hereOpen === 0, JSON.stringify(withThreads));
  if (withThreads !== null) {
    await walk.ev(`document.querySelector('[data-ev="walk-step-${withThreads.id}"]')?.click(); true`);
    await poll('that step again', async () => (await pc.ev(`document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent`)) === withThreads.id, 15_000);
    const elsewhere = await pc.ev(`${q('walk-threads-elsewhere')}?.textContent ?? ''`);
    note('the step says where the walk\'s other findings are', elsewhere);
    // The report's line selects the step's card: one card, opened, never a second copy.
    await pc.ev(`${q('agent-review')}.open = true; true`);
    // A thread the walk's report lists (the step may also show threads of the whole-change review).
    const indexed = JSON.parse(await pc.ev(`JSON.stringify([...document.querySelectorAll('[data-ev="agent-review"] [data-ev="thread-index-line"]')].map((b)=>b.closest('[data-thread-id]').dataset.threadId))`));
    const hereIds = JSON.parse(await pc.ev(`JSON.stringify([...document.querySelectorAll('[data-ev="walk-threads-here"] [data-ev="review-thread"]')].map((c)=>c.dataset.threadId))`));
    const firstHere = indexed.find((id) => hereIds.includes(id)) ?? indexed[0];
    check('the walk\'s report lists its findings one line each', indexed.length > 0 && firstHere !== undefined, JSON.stringify({ indexed: indexed.length, here: hereIds.length }));
    const clicked = await pc.ev(`(()=>{const l=document.querySelector('[data-ev="agent-review"] [data-thread-id="${firstHere}"] [data-ev="thread-index-line"]');if(l){l.click();return true}return false})()`);
    await delay(800);
    const once = JSON.parse(await pc.ev(`JSON.stringify({clicked:${String(clicked)},cards:document.querySelectorAll('[data-ev="review-thread"][data-thread-id="${firstHere}"]').length,open:document.querySelector('[data-ev="walk-threads-here"] [data-thread-id="${firstHere}"] .rv-thread-body')!==null,places:document.querySelectorAll('[data-ev="walk-threads-here"] [data-thread-id="${firstHere}"] [data-ev="thread-place"]').length,field:document.querySelector('[data-ev="walk-threads-here"] [data-thread-id="${firstHere}"] [data-ev="thread-comment-field"]')!==null,outside:document.querySelector('[data-ev="step-link-back"], .rv-step-panel .rv-walk-title')!==null})`));
    check('the report\'s line opens the one card of that finding beside its code, with its discussion reachable, never a second copy', once.clicked && once.cards === 1 && once.open && once.field, JSON.stringify(once));
    await pc.ev(`${q('agent-review')}.open = false; true`);
  }
  await client.main.capture(panel.view.contentsId, '03-step-review-section');

  stage = 'a narrow panel, floating and docked';
  const narrowCheck = async (label) => {
    const reading = JSON.parse(await pc.ev(`(()=>{const h=document.querySelector('[data-ev="walk-threads-here"] .rv-thread-head')??document.querySelector('.rv-thread-head');if(!h)return JSON.stringify(null);const t=h.querySelector('.rv-thread-title');const s=h.querySelector('.rv-thread-status');const r=h.querySelector('.rv-thread-replies');const tb=t.getBoundingClientRect();const sb=s.getBoundingClientRect();const rb=r.getBoundingClientRect();const line=parseFloat(getComputedStyle(t).lineHeight)||18;return JSON.stringify({width:Math.round(h.getBoundingClientRect().width),titleLines:Math.round(tb.height/line),titleWidth:Math.round(tb.width),metaBelowTitle:sb.top>tb.top+tb.height-1&&rb.top>tb.top+tb.height-1,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1})})()`));
    check(`${label}: a finding's title has its own line, readable, with the metadata below it and no sideways overflow`, reading !== null && reading.metaBelowTitle && reading.titleLines <= 3 && reading.titleWidth > reading.width * 0.8 && !reading.overflow, JSON.stringify(reading));
    return reading;
  };
  if (!panel.docked) {
    await client.main.size(panel.frame.id, 420, 900);
    await delay(600);
    await pc.click('walk-review-section').catch(() => undefined);
    if ((await pc.ev(`${q('walk-threads-here')}!==null`)) !== true) await pc.click('walk-review-section');
    await narrowCheck('floating panel at 420 px');
    await client.main.capture(panel.view.contentsId, '04-step-panel-narrow-floating');
    await client.main.size(panel.frame.id, 760, 900);
  }
  // Docked in the walk window, with the walk window narrow enough to make the panel narrow.
  await pc.click('panel-dock-walk').catch(() => undefined);
  const docked = await poll('the panel docked in the walk window', async () => {
    const now = await panelView();
    return now !== null && now.docked && now.frame.id === walkWindow.id ? now : false;
  }, 30_000).catch(() => null);
  if (docked !== null) {
    await client.main.size(walkWindow.id, 980, 900);
    await delay(800);
    const pd = pageOver(docked.view.contentsId, 'docked panel');
    await pd.click('right-tab-step');
    if ((await pd.ev(`${q('walk-threads-here')}!==null`)) !== true) await pd.click('walk-review-section');
    const reading = JSON.parse(await pd.ev(`(()=>{const h=document.querySelector('[data-ev="walk-threads-here"] .rv-thread-head')??document.querySelector('.rv-thread-head');if(!h)return JSON.stringify(null);const t=h.querySelector('.rv-thread-title');const s=h.querySelector('.rv-thread-status');const tb=t.getBoundingClientRect();const sb=s.getBoundingClientRect();const line=parseFloat(getComputedStyle(t).lineHeight)||18;return JSON.stringify({width:Math.round(h.getBoundingClientRect().width),titleLines:Math.round(tb.height/line),titleWidth:Math.round(tb.width),metaBelowTitle:sb.top>tb.top+tb.height-1||tb.width>h.getBoundingClientRect().width*0.6,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1})})()`));
    check('docked narrow panel: the title is readable and nothing overflows sideways', reading !== null && reading.titleLines <= 3 && reading.titleWidth > reading.width * 0.6 && !reading.overflow, JSON.stringify(reading));
    await client.main.capture(walkWindow.contentsId, '05-walk-docked-narrow');
    await client.main.capture(docked.view.contentsId, '06-step-panel-docked-narrow');
  } else {
    note('the panel could not be docked in the walk window from the page; the floating narrow reading stands');
  }

  stage = 'a restart, and an older record: an agent approval never decided on is awaiting, not a decision';
  await quitClient();
  await endHost();
  const files = pairRecordFiles();
  check('the pair record is on disk', files.length >= 1, String(files.length));
  for (const file of files) {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    const marksBefore = record.marks.length;
    const kept = record.marks.filter((mark) => mark.scope?.kind !== 'job');
    note('the record as 0.1.17 would have left it: the decision marks removed, the agent reviews and other marks kept', JSON.stringify({ marksBefore, jobMarksRemoved: marksBefore - kept.length, agentReviews: record.agentReviews.length }));
    fs.writeFileSync(file, `${JSON.stringify({ ...record, marks: kept }, null, 2)}\n`);
  }
  main = await launch('delegation-again');
  await main.until('the recent project', `${q('open-project-0')}!==null`);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  await main.click('open-review');
  diffWindow = await windowShowing(isDiffPage, 'the review window again');
  const diff2 = new Page(client.cdp, 'review again', isDiffPage);
  await diff2.attach(60_000);
  await openPair(diff2);
  await diff2.until('the earlier report', `${q('agent-review')}?.dataset.state === 'done'`, 60_000);
  // The review reopens where it was left: in the file, or in the files list.
  if ((await diff2.ev(`${q('pair-file-0')}!==null`)) === true) await diff2.click('pair-file-0');
  await diff2.until('strips', `document.querySelectorAll('.rv-pair-diff [data-strip]').length > 0`, 30_000);
  state = JSON.parse(await diff2.ev(DIFF_STATE));
  check('the older agent approval reads as the agent\'s assessment awaiting the person, never as a decision', state.assessed > 0 && state.agent === 0 && state.decision === 'awaiting' && /awaiting your assessment/.test(state.state), JSON.stringify({ assessed: state.assessed, agent: state.agent, state: state.state }));
  await diff2.ev(`(()=>{const c=document.querySelector('[data-ev="review-thread"]');if(c&&c.querySelector('.rv-thread-body')===null)c.querySelector('[data-ev="thread-toggle"]').click();return true})()`);
  await diff2.until('the first thread open', `document.querySelector('[data-ev="review-thread"] .rv-thread-origin')!==null`, 10_000);
  const kept = JSON.parse(await diff2.ev(`(()=>{const cards=[...document.querySelectorAll('[data-ev="review-thread"]')];const c=cards[0];return JSON.stringify({cards:cards.length,origin:c?.querySelector('.rv-thread-origin')?.textContent??'',status:c?.dataset.threadStatus??''})})()`));
  check('the earlier report and its findings are kept with their origin', kept.cards >= 3 && /delegated review of/.test(kept.origin) && /Copilot|Agent/.test(kept.origin), JSON.stringify(kept));
  const onDisk = pairRecordFiles().some((file) => fs.readFileSync(file, 'utf8').includes('Noted from the diff.'));
  await diff2.ev(`(()=>{const c=document.querySelector('[data-ev="review-thread"][data-thread-id="${second}"]');if(c&&c.querySelector('.rv-thread-body')===null)c.querySelector('[data-ev="thread-toggle"]').click();return true})()`);
  const inThread = await diff2.until('the comment in its thread', `[...document.querySelectorAll('[data-thread-id="${second}"] [data-ev="thread-history"]')].some((e)=>e.textContent.includes('Noted from the diff.'))`, 10_000).catch(() => false);
  check('the comment made earlier is still in its thread, on disk and in the window', onDisk && inThread === true, JSON.stringify({ onDisk, inThread }));
  await client.main.capture(diffWindow.contentsId, '07-diff-older-record');
}

fs.mkdirSync(evidence, { recursive: true });
try {
  await main();
} catch (error) {
  results.push({ stage, what: `error: ${error instanceof Error ? error.message : String(error)}`, ok: false, detail: error instanceof Error ? (error.stack ?? '') : '' });
  console.log(`FAIL ${stage}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await quitClient();
  await endHost();
  owned.xvfb?.kill('SIGTERM');
  fs.writeFileSync(path.join(evidence, 'results.json'), `${JSON.stringify({ results, evidence }, null, 2)}\n`);
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`${failed === 0 ? 'ALL PASSED' : 'FAILED'}: ${String(results.length)} entries; evidence ${evidence}`);
}
