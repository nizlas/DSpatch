// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The walk delegation trial (DSP-203), on the Accept scope trial's plumbing (copied from
 * scripts/accept-scope-trial.mjs). DSpatch's real windows over an isolated profile and a generic
 * project with a new file of 417 lines; a prepared walk marks lines 151–155 and 156–159 of its one
 * hunk; the reviewing agent is SIMULATED (the presentation adapter), so what it proves is the
 * product's mandate and bookkeeping, never a review's quality.
 *
 * The person accepts the first place (5 lines). Delegating the walk then offers the remaining 4 of
 * 9 lines, checked, and all 9; the remaining review's stored mandate is exactly 156–159 and every
 * line it assesses lies there; accepting it leaves 151–155 the person's. Delegating all lines after
 * that stores 151–159; the person's lines stay theirs, with a thin agent edge beside the band,
 * awaiting; nothing counts twice, and the walk says the person's decision stands.
 *
 *     node scripts/walk-delegation-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`, and on Linux an X display (`xvfb-run`). Input is DevTools input into
 * the page. Nothing of the machine's own profile is touched; the standalone host this trial
 * starts is ended.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-walk-delegation', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};
const BIG = 'src/big.js';
const results = [];
const pages = [];
let stage = 'preflight';
let profile = '';
let project = '';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(what, ok, detail = '') {
  results.push({ stage, what, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 400)}`}`);
  if (!ok) throw new Error(what);
}
function note(what, detail = '') {
  results.push({ stage, what, ok: true, detail });
  console.log(`NOTE ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 400)}`}`);
}
async function poll(what, read, ms = 40_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`timeout (${stage}): ${what}`);
}
function run(program, args, allowFailure = false) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 60_000 });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${program} ${args.join(' ')}: ${result.error?.message ?? String(result.status)}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
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
  /** A drag of a control by `dx` CSS pixels, through the page's input pipeline. */
  async drag(name, dx) {
    const box = await this.ev(`(()=>{const b=${q(name)}.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none' });
    await this.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 8; step += 1) {
      await this.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + (dx * step) / 8, y: box.y, button: 'left', buttons: 1 });
      await delay(30);
    }
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + dx, y: box.y, button: 'left', clickCount: 1 });
  }
  async shot(name) {
    const answer = await this.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(answer.data, 'base64'));
  }
}

/** The main process, over the inspector. */
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
      return JSON.stringify(BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), url: w.webContents.getURL(), destroyed: w.isDestroyed(), visible: w.isVisible() })));
    })()`));
  }
  async closeWindow(windowId) {
    return this.ev(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.fromId(${String(windowId)}); if (!w || w.isDestroyed()) return false; w.close(); return true; })()`);
  }
}

const isMainPage = (url) => url !== '' && !url.includes('window=');
const isDiffPage = (url) => url.includes('view=diff');
const isWalkPage = (url) => url.includes('window=review') && !url.includes('view=');

const client = { child: null, cdp: 0, inspect: 0, main: null, log: '' };

async function launch(label) {
  client.cdp = await freePort();
  client.inspect = await freePort();
  client.log = path.join(evidence, `client-${label}.log`);
  const output = fs.openSync(client.log, 'a');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSPATCH_')));
  const child = spawn(electron, [`--inspect=${String(client.inspect)}`, '.', `--user-data-dir=${profile}`, `--remote-debugging-port=${String(client.cdp)}`], {
    cwd: appDir,
    env: { ...env, DSPATCH_EXPECT_USERDATA: profile, ...simulated },
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
async function windowShowing(matches, what, ms = 30_000) {
  return poll(what, async () => (await client.main.windows()).find((w) => !w.destroyed && matches(w.url)) ?? false, ms);
}

async function openPair(page) {
  const chosen = (count) => `document.querySelectorAll('.rv-pair-commit[aria-pressed=true]').length === ${String(count)}`;
  await page.until('the reviews, the repositories, the log or the review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-repo-0')}!==null || ${q('pair-commit-1')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await page.ev(`${q('pair-discussion')}!==null`)) === true) return;
  if ((await page.ev(`${q('pair-repo-0')}!==null`)) === true) await page.click('pair-repo-0');
  await page.until('the log', `${q('pair-commit-1')}!==null`);
  await page.click('pair-commit-1');
  await page.until('From chosen', chosen(1));
  await page.click('pair-commit-0');
  await page.until('both chosen', chosen(2));
  await page.click('pair-open');
  // As in the walk trial: a click that does not take (seen under Xvfb) is given once more by the DOM.
  const opened = await page.until('the review of the pair', `${q('pair-discussion')}!==null`, 15_000).catch(() => false);
  if (opened !== true) {
    await page.ev(`${q('pair-open')}?.click()`);
    await page.until('the review of the pair', `${q('pair-discussion')}!==null`, 60_000);
  }
}


const pairsDir = () => path.join(profile, 'reviews', 'pairs');
function reviewKey() {
  const names = fs.existsSync(pairsDir()) ? fs.readdirSync(pairsDir()).filter((name) => name.endsWith('.json') && name !== 'recent.json') : [];
  return names.length === 1 ? names[0].slice(0, -'.json'.length) : false;
}
const recordNow = (key) => JSON.parse(fs.readFileSync(path.join(pairsDir(), `${key}.json`), 'utf8'));

/** The page that holds the walk's Review section: the walk window, or the review panel's own window. */
async function reviewSectionPage() {
  return poll('the Review section', async () => {
    let list = [];
    try {
      list = await (await fetch(`http://127.0.0.1:${String(client.cdp)}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    } catch {
      return false;
    }
    const candidates = list.filter((entry) => entry.type === 'page' && entry.url.includes('window=review') && !isDiffPage(entry.url));
    // The walk window first: the section is docked there; the panel's own window only when it is not.
    candidates.sort((a, b) => Number(a.url.includes('view=panel')) - Number(b.url.includes('view=panel')));
    for (const target of candidates) {
      const page = new Page(client.cdp, target.url.includes('view=panel') ? 'review panel' : 'walk (Review section)', (url) => url === target.url);
      const found = await page.attach(5000).then(() => page.ev(`${q('walk-review-section')}!==null`)).catch(() => false);
      if (found === true) {
        if ((await page.ev(`${q('walk-review-section')}.getAttribute('aria-expanded')`)) !== 'true') {
          await page.click('walk-review-section');
        }
        // A place's lines are read once its file's rows are loaded; a page whose section shows none is passed over.
        if ((await page.until('the place decisions', `${q('place-decision')}!==null`, 8000).catch(() => false)) === true) return page;
      }
      page.close();
    }
    return false;
  }, 60_000);
}

/** What the Review section says of each place it decides about. */
const placesSaid = (page) =>
  page
    .ev(`JSON.stringify([...document.querySelectorAll('[data-ev="place-decision"]')].map((e) => ({ marked: e.dataset.marked ?? '', lines: Number(e.dataset.lines), accepted: Number(e.dataset.accepted ?? 0), exempted: Number(e.dataset.exempted ?? 0), earlier: e.querySelectorAll('[data-ev="place-decision-earlier"]').length, text: e.innerText })))`)
    .then((text) => JSON.parse(text));
/** The rows the walk marks for the active place, by their line numbers. */
const markedRows = (walk) => walk.ev(`JSON.stringify([...document.querySelectorAll('[data-focus-active]')].map((row) => Number(row.dataset.line)))`).then((text) => JSON.parse(text));
const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index);

/** The diff window's strip for one file (the big one by default): which lines it draws as reviewed by the person. */
async function diffStrips(diff, file = 'big.js') {
  if ((await diff.ev(`document.querySelectorAll('.rv-pair-diff [data-strip]').length`)) === 0) {
    await diff.ev(`[...document.querySelectorAll('[data-file-row]')].find((row) => row.textContent.includes(${JSON.stringify(file)}))?.click()`);
    await diff.until('the big file\'s diff', `document.querySelectorAll('.rv-pair-diff [data-strip]').length > 0`, 20_000);
  }
  return JSON.parse(
    await diff.ev(`JSON.stringify([...document.querySelectorAll('.rv-pair-diff [data-strip]')].map((cell) => ({ side: cell.dataset.side, line: Number(cell.dataset.line), status: cell.dataset.strip, label: cell.getAttribute('aria-label') ?? '' })))`),
  );
}
const manualLines = (strips) => strips.filter((strip) => strip.status === 'manual').map((strip) => strip.line);

async function confirmAccept(section, index, expectWords) {
  await section.ev(`document.querySelectorAll('[data-ev="place-decision"]')[${String(index)}].querySelector('[data-ev="place-accept"]').click()`);
  await section.until('the confirmation', `${q('place-confirm-scope')}!==null`, 10_000);
  const button = await section.ev(`document.querySelectorAll('[data-ev="place-decision"]')[${String(index)}].innerText`);
  const scope = await section.ev(`${q('place-confirm-scope')}.innerText`);
  check(`the confirmation names exactly ${expectWords}`, scope.includes(expectWords) && !/lines 1–417|new lines 1–/.test(scope), scope);
  await section.shot(`accept-confirm-${String(index)}`);
  await section.ev(`${q('place-confirm-submit')}.click()`);
  return { button, scope };
}

async function openWalk(diff) {
  await diff.click('pair-walks');
  await windowShowing(isWalkPage, 'the walk window');
  const walk = new Page(client.cdp, 'walk', isWalkPage);
  await walk.attach(60_000);
  await walk.until('the walk', `document.querySelectorAll('[data-ev^="walk-head-"]').length > 0 && document.querySelectorAll('[data-focus-active]').length > 0`, 90_000);
  return walk;
}

async function openReview(main) {
  await main.until('the recent project', `${q('open-project-0')}!==null || ${q('prompt')}!==null`);
  if ((await main.ev(`${q('prompt')}!==null`)) !== true) await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  await main.click('open-review');
  await windowShowing(isDiffPage, 'the review window');
  const diff = new Page(client.cdp, 'review', isDiffPage);
  await diff.attach(60_000);
  return diff;
}

async function restart(label) {
  await quitClient();
  await endHost();
  const main = await launch(label);
  const diff = await openReview(main);
  await diff.until('the ongoing review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await diff.ev(`${q('pair-discussion')}!==null`)) !== true) await diff.click('pair-ongoing-open-0');
  await diff.until('the review of the pair', `${q('pair-discussion')}!==null`, 60_000);
  return diff;
}

/** The diff window's strip for the big file, by line: its status and the agent edge beside a decision. */
async function stripsBy(diff) {
  await diffStrips(diff);
  return JSON.parse(await diff.ev(`JSON.stringify([...document.querySelectorAll('.rv-pair-diff [data-strip]')].map((cell) => ({ line: Number(cell.dataset.line), status: cell.dataset.strip, also: cell.dataset.alsoAgent ?? null, label: cell.getAttribute('aria-label') ?? '' })))`));
}
const linesWith = (strips, test) => strips.filter(test).map((strip) => strip.line);
/** The two delegation choices as the Review section offers them. */
const basisSaid = (section) =>
  section
    .ev(`JSON.stringify((() => { const r = document.querySelector('[data-ev="walk-basis-remaining"]'); const a = document.querySelector('[data-ev="walk-basis-all"]'); return { remaining: r ? { lines: Number(r.dataset.lines), checked: r.checked, disabled: r.disabled, text: r.parentElement.textContent.trim() } : null, all: a ? { lines: Number(a.dataset.lines), checked: a.checked, text: a.parentElement.textContent.trim() } : null, note: document.querySelector('[data-ev="walk-basis-note"]')?.textContent ?? '', picker: document.querySelector('[data-ev="walk-delegate-agent-start"]') !== null }; })())`)
    .then((text) => JSON.parse(text));
const walkJobs = (key) => recordNow(key).jobs.filter((job) => job.kind === 'review' && job.scope?.kind === 'walk');

async function delegate(section, key, basis, count) {
  const before = walkJobs(key).length;
  await section.click('walk-delegate');
  await section.until('the two choices', `${q('walk-basis-all')}!==null`, 15_000);
  if (basis === 'all') {
    await section.ev(`${q('walk-basis-all')}.click()`);
  }
  await section.until('the agent picker', `${q('walk-delegate-agent-start')}!==null`, 15_000);
  const said = await basisSaid(section);
  await section.shot(`delegate-${basis}-${String(count)}`);
  await section.click('walk-delegate-agent-start');
  const job = await poll('the walk\'s review done', () => {
    const jobs = walkJobs(key);
    const last = jobs.at(-1);
    return jobs.length > before && last.state !== 'running' && last.state !== 'cancelling' ? last : false;
  }, 120_000);
  return { said, job };
}
const lineSum = (ranges) => ranges.reduce((total, range) => total + range.end - range.start + 1, 0);

async function main() {
  stage = 'preflight';
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-delegation-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-delegation-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src', 'small.js'), 'export const small = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'Commit 1');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(project, BIG), `${range(1, 417).map((line) => `export const value${String(line)} = ${String(line)};`).join('\n')}\n`);
  git('add', '.');
  git('commit', '-qm', 'Commit 2: a new file of 417 lines');
  const target = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(profile, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'reviews', 'preferences.json'), `${JSON.stringify({ language: 'en', discussionPlace: 'walk' }, null, 2)}\n`);

  stage = 'the review of the pair';
  const main = await launch('delegation');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  const diff = await openReview(main);
  await openPair(diff);
  const key = await poll('the review record', () => reviewKey(), 20_000);
  // A walk over 151–159 of the new file, in two places of its one hunk.
  const walkFolder = path.join(profile, 'reviews', 'generated', key);
  fs.mkdirSync(walkFolder, { recursive: true });
  const step = (id, title, start, end) => ({ id, title, text: `What lines ${String(start)} to ${String(end)} add.`, refs: [{ path: BIG, side: 'target', start, end, role: 'walk', anchor: `value${String(start)} =` }] });
  fs.writeFileSync(
    path.join(walkFolder, 'delegation.review.json'),
    `${JSON.stringify({ format: 'dspatch-review/1', title: 'The new file', repository: project, base, target, walks: [{ id: 'W1', title: 'The new file', question: 'What does it add?', steps: [step('W1.1', 'Values 151 to 155', 151, 155), step('W1.2', 'Values 156 to 159', 156, 159)] }] }, null, 2)}\n`,
  );
  await diff.ev('location.reload()');
  await diff.attach(60_000);
  await diff.until('the ongoing review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await diff.ev(`${q('pair-discussion')}!==null`)) !== true) await diff.click('pair-ongoing-open-0');
  await diff.until('the walk offered', `${q('pair-walks')}?.getAttribute('aria-disabled') === 'false'`, 30_000);

  stage = 'half the walk accepted by the person';
  await openWalk(diff);
  const section = await reviewSectionPage();
  await confirmAccept(section, 0, 'new lines 151–155 in big.js');
  await section.until('5 lines accepted', `document.querySelector('[data-ev="place-decision"]')?.dataset.accepted === '5'`, 15_000);

  stage = 'delegating the remaining lines (the default)';
  const first = await delegate(section, key, 'remaining', 4);
  check('the choices offer the remaining 4 of 9 lines, checked, and all 9', first.said.remaining?.lines === 4 && first.said.remaining.checked && !first.said.remaining.disabled && first.said.all?.lines === 9 && !first.said.all.checked, JSON.stringify(first.said));
  check('the counts read in the choices', /4 of 9 changed lines/.test(first.said.remaining?.text ?? '') && /9 changed lines/.test(first.said.all?.text ?? ''), JSON.stringify([first.said.remaining?.text, first.said.all?.text]));
  check('the mandate stored is exactly lines 156–159, as remaining', first.job.state === 'done' && first.job.scope.basis === 'remaining' && JSON.stringify(first.job.scope.ranges) === JSON.stringify([{ kind: 'lines', side: 'target', path: BIG, start: 156, end: 159 }]), JSON.stringify(first.job.scope));
  const assessed1 = recordNow(key).agentReviews.filter((review) => review.jobId === first.job.id);
  check('everything the agent assessed lies inside the mandate', assessed1.length > 0 && assessed1.every((review) => review.scope.start >= 156 && review.scope.end <= 159), JSON.stringify(assessed1.map((review) => review.scope)));
  note('the agent assessed', `${String(lineSum(assessed1.map((review) => review.scope)))} of 4 lines acceptable`);
  let strips = await stripsBy(diff);
  check('awaiting the person: 151–155 stay the person\'s, the assessed lines are drawn as assessed, nothing else', JSON.stringify(linesWith(strips, (strip) => strip.status === 'manual')) === JSON.stringify(range(151, 155)) && linesWith(strips, (strip) => strip.status === 'assessed').every((line) => line >= 156 && line <= 159) && linesWith(strips, (strip) => strip.status === 'agent').length === 0, JSON.stringify(strips.filter((strip) => strip.status !== 'none').map((strip) => [strip.line, strip.status])));

  stage = 'the person accepts the assessment';
  await section.ev(`document.querySelector('[data-ev="walk-delegation"] [data-ev="agent-review"]').open = true; true`);
  await section.click('agent-review-accept');
  await poll('the acceptance recorded', () => recordNow(key).marks.some((mark) => mark.op === 'accept-agent' && mark.scope.jobId === first.job.id), 15_000);
  strips = await stripsBy(diff);
  const agentLines = linesWith(strips, (strip) => strip.status === 'agent');
  check('151–155 stay the person\'s; the accepted lines count through the delegation; nothing outside 151–159', JSON.stringify(linesWith(strips, (strip) => strip.status === 'manual')) === JSON.stringify(range(151, 155)) && agentLines.length > 0 && agentLines.every((line) => line >= 156 && line <= 159), JSON.stringify(strips.filter((strip) => strip.status !== 'none').map((strip) => [strip.line, strip.status])));
  await diff.ev(`document.querySelector('.rv-pair-diff [data-strip][data-line="155"]')?.scrollIntoView({ block: 'center' }); true`);
  await diff.shot('01-diff-after-accepting-the-remaining-review');

  stage = 'delegating all lines after that';
  const remainingNow = 4 - agentLines.length;
  const second = await delegate(section, key, 'all', 9);
  check(`the choices then offer ${String(remainingNow)} remaining and all 9`, first.said.all?.lines === 9 && second.said.remaining?.lines === remainingNow && second.said.all?.lines === 9 && second.said.all.checked, JSON.stringify(second.said));
  check('the mandate stored is all of 151–159', second.job.scope.basis === 'all' && JSON.stringify(second.job.scope.ranges) === JSON.stringify([{ kind: 'lines', side: 'target', path: BIG, start: 151, end: 159 }]), JSON.stringify(second.job.scope));
  const assessed2 = recordNow(key).agentReviews.filter((review) => review.jobId === second.job.id);
  check('the second review\'s assessments lie inside 151–159', assessed2.length > 0 && assessed2.every((review) => review.scope.start >= 151 && review.scope.end <= 159), JSON.stringify(assessed2.map((review) => review.scope)));
  strips = await stripsBy(diff);
  const manualAfter = linesWith(strips, (strip) => strip.status === 'manual');
  check('the person\'s decisions stand: 151–155 are still theirs', JSON.stringify(manualAfter) === JSON.stringify(range(151, 155)), JSON.stringify(manualAfter));
  const edges = strips.filter((strip) => strip.also !== null).map((strip) => [strip.line, strip.also]);
  check('where the agent also assessed a line the person decided, a thin edge says awaiting, beside the person\'s band', edges.length > 0 && edges.every(([line, also]) => line >= 151 && line <= 155 && also === 'awaiting'), JSON.stringify(edges));
  check('its hover says both', strips.find((strip) => strip.also === 'awaiting')?.label.includes('Reviewed by you') && /also assessed acceptable by .*awaiting your decision/.test(strips.find((strip) => strip.also === 'awaiting')?.label ?? ''), strips.find((strip) => strip.also === 'awaiting')?.label);
  const handled = recordNow(key).marks.filter((mark) => mark.op === 'manual').length;
  note('marks of the person after both reviews', String(handled));
  await diff.click('pair-files');
  const percent = await diff.until('the file list', `[...document.querySelectorAll('[data-file-key]')].find((row) => row.textContent.includes('big.js'))?.querySelector('.rv-pair-progress')?.textContent ?? false`, 15_000);
  check('no line counts twice: the file stays at 2% (9 of 417 at most)', percent === '2%' || percent === '1%', percent);
  const summary = await diff.ev(`document.querySelector('.rv-pair-files')?.textContent.match(/\\d+ of 417 changed lines handled/)?.[0] ?? ''`);
  note('the review says', summary);
  check('the handled lines are within the walk\'s 9', /^(\d) of 417 changed lines handled$/.test(summary) && Number(summary.split(' ')[0]) <= 9, summary);
  await diff.click('pair-files').catch(() => undefined);
  await diffStrips(diff);
  await diff.ev(`document.querySelector('.rv-pair-diff [data-strip][data-line="155"]')?.scrollIntoView({ block: 'center' }); true`);
  await diff.shot('02-diff-person-and-agent-together');
  // The walk says it too, at the first place.
  await section.ev(`document.querySelector('.rv-nav-button:not(.rv-nav-next)')?.click()`).catch(() => undefined);
  const beside = await section.until('the agent beside the person at the first place', `(() => { const e = document.querySelector('[data-ev="place-decision-agent"]'); return e ? e.textContent : false; })()`, 15_000).catch(() => '');
  note('the walk at the first place', beside);
  check('the walk says the agent also assessed lines the person decided, and that the decision stands', /your decision stands/.test(beside), beside);
  await section.shot('03-walk-person-and-agent');
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
    fs.rmSync(path.join(profile, 'host-running.json'), { force: true });
    results.push({ stage: 'cleanup', what: 'a standalone host of this trial ended', ok: true, detail: String(running.pid) });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    results.push({ stage: 'cleanup', what: 'a standalone host of this trial ended', ok: false, detail: String(error) });
    process.exitCode = 1;
  }
}

fs.mkdirSync(evidence, { recursive: true });
try {
  await main();
} catch (error) {
  results.push({ stage, what: 'the trial reached its end', ok: false, detail: error.stack ?? String(error) });
  console.error(`FAIL ${stage}: ${error.stack ?? error}`);
  process.exitCode = 1;
} finally {
  await quitClient().catch(() => undefined);
  if (profile !== '') {
    await endHost();
    const key = reviewKey();
    if (key) fs.copyFileSync(path.join(pairsDir(), `${key}.json`), path.join(evidence, 'pair-record.json'));
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, profile, project, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${results.some((result) => !result.ok) ? 'FAILED' : 'ALL PASSED'}: ${String(results.length)} checks; evidence ${evidence}`);
}
