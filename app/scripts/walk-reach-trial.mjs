// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The walk reach and context trial (DSP-207), on the walk delegation trial's plumbing (copied from
 * scripts/walk-delegation-trial.mjs). DSpatch's real windows over an isolated profile and a generic
 * C++ project; the reviewing agent is SIMULATED (the presentation adapter), so what it proves is
 * scope and bookkeeping, never a review's or a walk's quality.
 *
 * The walk is saved as an older preparation leaves it: places by their lines only, with no unit and
 * no context. The person first marks new lines 128–130 reviewed in the diff. In the walk, the
 * place over the added if-block (128–130) marks the blank line 131 after it, draws it strong, and
 * the Review section and Accept decide about exactly 128–131, at every level, the earlier decision
 * kept as it was; the function's documentation and two-line signature are in view on arrival, its
 * long body folded and named. A short function shows whole; a declaration outside functions with
 * the lines around; two places in one hunk share its blank lines by the rule; a language with no
 * known structure shows the lines around and claims no function; a signature that changed is drawn
 * from each revision; the user's W3.2, deep in a long function, opens with the function's head in
 * view. A delegation mandates the walk's marked lines and no others. What is left lists the
 * changes no walk covers (a whitespace change, a lone blank line, a substantive change, the rest of
 * a new file) and the walk places not decided; each is opened and decided about exactly its lines,
 * drawn strong exactly, until every changed line has the person's decision (100%); after a restart
 * the decisions and the coverage are as they were.
 *
 *     node scripts/walk-reach-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`, and on Linux an X display (`xvfb-run`). Input is DevTools input into the
 * page. Nothing of the machine's own profile is touched; the standalone host this trial starts is
 * ended.
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-walk-reach', `${String(process.pid)}-${String(Date.now())}`));
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

// --- DSP-207: the fixture -----------------------------------------------------------------------

const ADAPTER = 'src/mct_adapter.cpp';
const TABLE = 'src/table.cpp';
const NOTES = 'docs/notes.unknownext';

/** The adapter at both revisions: every case of the trial in one C++ file, with known line numbers. */
function adapterFiles() {
  const base = [];
  const target = [];
  const both = (...lines) => {
    base.push(...lines);
    target.push(...lines);
  };
  both('#include "mct_adapter.h"', '#include <string>', '');
  base.push('static const int kLimit = 8;');
  target.push('static const int kLimit = 10;'); // 4: code outside functions
  both('', '/**', ' * Configures the adapter from a configuration.', ' *', ' * @param config the settings to read', ' * @param mode how strictly to read them', ' * @return true when every setting was applied', ' */');
  both('bool MctAdapter::configure(const Config &config,', '                           Mode mode) {'); // 13–14
  for (let n = 15; n <= 127; n += 1) both(`  apply_setting(config, ${String(n)});`);
  target.push('  if (mode == Mode::Strict) {', '    validate(config);', '  }', ''); // 128–131: the user's if-block and its blank line
  both('  return true;', '}', ''); // 132–134 (base 128–130)
  both('/** Doubles a value. */', 'int twice(int x) {');
  base.push('  return x + x;');
  target.push('  return x * 2;'); // 137: a short function
  both('}', '', 'void MctAdapter::start() {', '  prepare();');
  // A removed line and a removed blank line (spaces only, so git pairs it with no added line), and
  // three added lines, two places in one hunk with a blank line between them.
  base.push('  legacy();', '    ');
  target.push('  first();', '', '  second();'); // 142–144
  both('}', '', 'int MctAdapter::size() const {');
  base.push('  return size_;');
  target.push('    return size_;'); // 148: a change of whitespace only, in no walk
  both('}', '');
  target.push(''); // 151: an added blank line alone, in no walk
  both('bool MctAdapter::ready() const {');
  base.push('  return state_ == State::Ready;');
  target.push('  return state_ == State::Ready && !paused_;'); // 153: a substantive change in no walk
  both('}', '', '/**', ' * Sums two values.', ' */');
  base.push('int MctAdapter::sum(int a) {', '  return a;');
  target.push('int MctAdapter::sum(int a,', '                    int b) {', '  return a + b;'); // 160–162: the signature changed
  both('}', '', '/**', ' * Processes one frame.', ' */', 'void MctAdapter::process(const Frame &frame) {');
  while (target.length < 625) both(`  stage(frame, ${String(target.length + 1)});`);
  both('  for (int pass = 0; pass < 2; ++pass) {', '    try {', '      if (frame.ready()) {');
  base.push('        emit(frame);');
  target.push('        emit(frame, pass);'); // 629: the user's W3.2, deep in a long function
  both('      }', '    } catch (const Error &error) {', '      log(error);', '    }', '  }', '  finish(frame);', '}');
  return { base, target };
}
const lineOf = (lines, text) => lines.indexOf(text) + 1;

// --- What the trial reads in the page ----------------------------------------------------------

/** The active place's marked rows, as side:line. */
const activeRows = (page) => page.ev(`JSON.stringify([...document.querySelectorAll('[data-focus-active]')].map((row) => row.dataset.selSide + ':' + row.dataset.selLine))`).then(JSON.parse);
/** The active pane's rows: which lines are drawn, which strong, its folds and its unit heads, and what is in its viewport. */
function paneState() {
  const active = document.querySelector('[data-focus-active]');
  const pane = active?.closest('.rv-pane-lines') ?? active?.closest('[class*="rv-pane"]');
  const scroller = (() => {
    for (let at = active; at !== null; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (/(auto|scroll)/.test(style.overflowY) && at.scrollHeight > at.clientHeight) return at;
    }
    return null;
  })();
  const view = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  const rows = [...(pane ?? document).querySelectorAll('[data-sel-side][data-sel-line]')].filter((row) => row.dataset.selLine !== '');
  const inView = (row) => {
    const box = row.getBoundingClientRect();
    return box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
  };
  return JSON.stringify({
    rows: rows.map((row) => ({ side: row.dataset.selSide, line: Number(row.dataset.selLine), text: row.querySelector('.rv-text')?.textContent ?? '', strong: /\brv-(old|new)\b/.test(row.className), weak: /rv-(old|new)-faint/.test(row.className), head: row.dataset.unitHead === '1', inView: inView(row) })),
    folds: [...(pane ?? document).querySelectorAll('.rv-gap button, .rv-gap')].map((fold) => fold.textContent.trim()).filter((text) => text !== ''),
  });
}
const pane = (page) => page.ev(`(${paneState.toString()})()`).then(JSON.parse);
const marked = (section) => section.ev(`JSON.stringify([...document.querySelectorAll('[data-ev="place-decision"]')].map((e) => ({ marked: e.dataset.marked ?? '', lines: Number(e.dataset.lines), accepted: Number(e.dataset.accepted ?? 0), exempted: Number(e.dataset.exempted ?? 0) })))`).then(JSON.parse);
const rangesOf = (key, origin) =>
  recordNow(key)
    .marks.filter((mark) => mark.op === 'manual' && (origin === undefined || mark.origin?.kind === origin))
    .flatMap((mark) => mark.scope.ranges ?? [mark.scope])
    .map((range) => `${range.side}:${String(range.start)}-${String(range.end)}`)
    .sort();
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** A click with modifiers through the page's input pipeline. */
async function clickAt(page, selector, modifiers = 0) {
  const box = await page.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.cmd('Input.dispatchMouseEvent', { type, ...box, modifiers, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }
}

/** The walk's steps in order, and moving to one with Previous and Next, as a reader does. */
const STEP_ORDER = ['W1.1', 'W1.2', 'W1.3', 'W2.1', 'W2.2', 'W2.3', 'W2.4', 'W3.1', 'W3.2'];
async function goStep(walk, stepId) {
  for (let tries = 0; tries < 20; tries += 1) {
    const now = await walk.ev(`(document.body.innerText.match(/(W\\d+\\.\\d+) · place/) ?? [])[1] ?? ''`);
    if (now === stepId) break;
    const forward = STEP_ORDER.indexOf(stepId) > STEP_ORDER.indexOf(now);
    await walk.ev(`document.querySelector(${JSON.stringify(forward ? '.rv-nav-next' : '.rv-nav-button:not(.rv-nav-next)')}).click(); true`);
    await delay(500);
  }
  await walk.until(`${stepId} active`, `document.body.innerText.includes(${JSON.stringify(`${stepId} · place`)})`, 15_000);
  await walk.until('no animation running', `document.getAnimations().every((animation) => animation.playState !== 'running')`, 10_000);
  await delay(400);
}

async function main() {
  stage = 'preflight';
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-reach-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-reach-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  const adapter = adapterFiles();
  const notesBase = ['Release notes', 'one line', '', 'another'];
  const notesTarget = ['Release notes', 'one changed line', '', 'another'];
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  fs.mkdirSync(path.join(project, 'docs'));
  fs.writeFileSync(path.join(project, ADAPTER), `${adapter.base.join('\n')}\n`);
  fs.writeFileSync(path.join(project, NOTES), `${notesBase.join('\n')}\n`);
  git('add', '.');
  git('commit', '-qm', 'Commit 1');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(project, ADAPTER), `${adapter.target.join('\n')}\n`);
  fs.writeFileSync(path.join(project, NOTES), `${notesTarget.join('\n')}\n`);
  fs.writeFileSync(path.join(project, TABLE), `${range(1, 300).map((line) => `int table${String(line)} = ${String(line)};`).join('\n')}\n`);
  git('add', '.');
  git('commit', '-qm', 'Commit 2');
  const target = git('rev-parse', 'HEAD');
  check('the fixture has the user\'s line numbers', lineOf(adapter.target, '  if (mode == Mode::Strict) {') === 128 && adapter.target[130] === '' && lineOf(adapter.target, '        emit(frame, pass);') === 629, JSON.stringify({ if: lineOf(adapter.target, '  if (mode == Mode::Strict) {'), emit: lineOf(adapter.target, '        emit(frame, pass);') }));
  fs.mkdirSync(path.join(profile, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'reviews', 'preferences.json'), `${JSON.stringify({ language: 'en', discussionPlace: 'walk' }, null, 2)}\n`);

  stage = 'the review of the pair';
  const main = await launch('reach');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  let diff = await openReview(main);
  await openPair(diff);
  const key = await poll('the review record', () => reviewKey(), 20_000);
  // A saved walk as an older preparation leaves it: places by their lines only, no unit, no context.
  const walkFolder = path.join(profile, 'reviews', 'generated', key);
  fs.mkdirSync(walkFolder, { recursive: true });
  const ref = (filePath, side, start, end) => ({ path: filePath, side, start, end, role: 'walk' });
  const step = (id, title, refs) => ({ id, title, text: `${title}.`, refs });
  const T = adapter.target;
  const walks = [
    { id: 'W1', title: 'Configuration', question: 'How is the adapter configured?', steps: [
      step('W1.1', 'Strict mode validates the configuration', [ref(ADAPTER, 'target', 128, 130)]),
      step('W1.2', 'twice multiplies', [ref(ADAPTER, 'target', 137, 137)]),
      step('W1.3', 'The limit', [ref(ADAPTER, 'target', 4, 4)]),
    ] },
    { id: 'W2', title: 'Starting', question: 'What does start do?', steps: [
      step('W2.1', 'first', [ref(ADAPTER, 'target', 142, 142)]),
      step('W2.2', 'second', [ref(ADAPTER, 'target', 144, 144)]),
      step('W2.3', 'The table', [ref(TABLE, 'target', 140, 144)]),
      step('W2.4', 'The notes', [ref(NOTES, 'target', 2, 2)]),
    ] },
    { id: 'W3', title: 'Frames', question: 'How are frames processed?', steps: [
      step('W3.1', 'sum takes two values', [ref(ADAPTER, 'target', lineOf(T, 'int MctAdapter::sum(int a,'), lineOf(T, '  return a + b;'))]),
      step('W3.2', 'emit gets the pass', [ref(ADAPTER, 'target', 629, 629)]),
    ] },
  ];
  fs.writeFileSync(path.join(walkFolder, 'reach.review.json'), `${JSON.stringify({ format: 'dspatch-review/1', title: 'The adapter', repository: project, base, target, walks }, null, 2)}\n`);
  await diff.ev('location.reload()');
  await diff.attach(60_000);
  await diff.until('the ongoing review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await diff.ev(`${q('pair-discussion')}!==null`)) !== true) await diff.click('pair-ongoing-open-0');
  await diff.until('the walk offered', `${q('pair-walks')}?.getAttribute('aria-disabled') === 'false'`, 30_000);

  stage = 'an earlier decision about part of the place: new lines 128–130 marked reviewed in the diff';
  await diffStrips(diff, 'mct_adapter.cpp');
  await clickAt(diff, '.rv-pair-diff [data-strip][data-side="target"][data-line="128"]');
  await clickAt(diff, '.rv-pair-diff [data-strip][data-side="target"][data-line="130"]', 8);
  await diff.until('three lines selected', `document.querySelector('[data-ev="pair-actions"]')?.innerText.includes('3 lines selected')`, 10_000);
  await diff.click('pair-mark-manual');
  await poll('the diff\'s mark recorded', () => rangesOf(key, 'diff').length > 0, 15_000);
  check('the earlier decision holds exactly new lines 128–130', sameSet(rangesOf(key, 'diff'), ['target:128-130']), JSON.stringify(rangesOf(key)));

  stage = 'the user\'s first example: the if-block and its blank line';
  const walk = await openWalk(diff);
  await walk.until('no animation running', `document.getAnimations().every((animation) => animation.playState !== 'running')`, 10_000);
  await delay(400);
  const first = await activeRows(walk);
  check('the place marks new lines 128–131: the if-block and the blank line after it', sameSet(first, ['target:128', 'target:129', 'target:130', 'target:131']), JSON.stringify(first));
  let shown = await pane(walk);
  const blankRow = shown.rows.find((row) => row.side === 'target' && row.line === 131);
  check('the blank line 131 is drawn strong, as the place\'s', blankRow?.strong === true && blankRow.text.trim() === '', JSON.stringify(blankRow));
  const signature = shown.rows.find((row) => row.text.startsWith('bool MctAdapter::configure('));
  const doc = shown.rows.find((row) => row.text.includes('Configures the adapter'));
  check('the function\'s documentation and two-line signature are drawn and in view on arrival, with no click', signature?.inView === true && doc?.inView === true && shown.rows.some((row) => row.text.trim() === 'Mode mode) {' && row.inView), JSON.stringify({ signature, doc }));
  check('the long body between them is one fold that names the function', shown.folds.some((fold) => /configure/.test(fold)), JSON.stringify(shown.folds));
  check('the function\'s closing line is drawn', shown.rows.some((row) => row.side === 'target' && row.line === 133 && row.text === '}'), '');
  await walk.shot('01-W1.1-if-block-blank-line-and-function-head');
  const section = await reviewSectionPage();
  let said = await marked(section);
  check('the Review section decides about the same lines, and sees the earlier decision on 3 of the 4', said[0]?.marked === 'target:128-131' && said[0]?.lines === 4 && said[0]?.accepted === 3, JSON.stringify(said));
  for (const level of [0, 2, 1]) {
    await walk.ev(`document.querySelectorAll('.rv-navbar-controls .rv-seg:first-child button')[${String(level)}].click(); true`);
    await delay(300);
    said = await marked(section);
    check(`at level ${['the change', 'the context', 'the whole file'][level]} the place still decides about exactly 128–131`, said[0]?.marked === 'target:128-131' && said[0]?.lines === 4, JSON.stringify(said));
  }
  const accepted = await confirmAccept(section, 0, 'new lines 128–131 in mct_adapter.cpp');
  await poll('the walk\'s acceptance recorded', () => rangesOf(key, 'walk').length > 0, 15_000);
  check('Accept records exactly new lines 128–131; the diff\'s earlier 128–130 stays as it was', sameSet(rangesOf(key, 'walk'), ['target:128-131']) && sameSet(rangesOf(key, 'diff'), ['target:128-130']), JSON.stringify({ scope: accepted.scope, marks: rangesOf(key) }));

  stage = 'the context of other places';
  await goStep(walk, 'W1.2');
  shown = await pane(walk);
  check('a short function is drawn whole, with its documentation, in view', ['/** Doubles a value. */', 'int twice(int x) {', '  return x * 2;', '}'].every((text) => shown.rows.some((row) => row.text === text && row.inView)), JSON.stringify(shown.rows.filter((row) => row.line >= 134 && row.line <= 139)));
  await walk.shot('02-W1.2-short-function');
  await goStep(walk, 'W1.3');
  shown = await pane(walk);
  check('code outside functions: the declaration and the lines around it', shown.rows.some((row) => row.text === 'static const int kLimit = 10;' && row.strong) && shown.rows.some((row) => row.text === '#include "mct_adapter.h"'), JSON.stringify(shown.rows.slice(0, 8)));
  await goStep(walk, 'W2.1');
  const startRows = await activeRows(walk);
  const legacy = lineOf(adapter.base, '  legacy();');
  check('two places in one hunk: the first takes the lines it replaced, the removed blank line among them, and the blank line between the two', sameSet(startRows, [`base:${String(legacy)}`, `base:${String(legacy + 1)}`, 'target:142', 'target:143']), JSON.stringify(startRows));
  await walk.shot('03-W2.1-two-places-in-one-hunk');
  await goStep(walk, 'W2.2');
  check('the second keeps its own line only', sameSet(await activeRows(walk), ['target:144']), JSON.stringify(await activeRows(walk)));
  await goStep(walk, 'W2.4');
  shown = await pane(walk);
  check('a language with no known structure: the lines around, and no fold claiming a function', shown.rows.some((row) => row.text === 'one changed line') && shown.rows.some((row) => row.text === 'Release notes') && !shown.folds.some((fold) => /Rest of/i.test(fold)), JSON.stringify(shown));
  await goStep(walk, 'W3.1');
  await walk.click('code-view-before');
  await delay(500);
  shown = await pane(walk);
  check('Before: the old one-line signature and its function are drawn from the old file', shown.rows.some((row) => row.side === 'base' && row.text === 'int MctAdapter::sum(int a) {' && row.inView) && shown.rows.some((row) => row.text.includes('Sums two values')), JSON.stringify(shown.rows.filter((row) => row.side === 'base').slice(0, 8)));
  await walk.shot('04-W3.1-before');
  await walk.click('code-view-after');
  await delay(500);
  shown = await pane(walk);
  check('After: the new two-line signature and its documentation', shown.rows.some((row) => row.text === 'int MctAdapter::sum(int a,' && row.inView) && shown.rows.some((row) => row.text.trim() === 'int b) {') && shown.rows.some((row) => row.text.includes('Sums two values')), JSON.stringify(shown.rows.slice(0, 10)));
  await walk.click('code-view-both');
  await delay(500);
  await walk.shot('05-W3.1-before-after');
  await goStep(walk, 'W3.2');
  shown = await pane(walk);
  check('the user\'s second example: deep in a long function, its documentation and signature are in view on arrival', shown.rows.some((row) => row.text === 'void MctAdapter::process(const Frame &frame) {' && row.inView) && shown.rows.some((row) => row.text.includes('Processes one frame') && row.inView), JSON.stringify(shown.rows.slice(0, 8)));
  check('the change with its loop, try and if, and the function\'s end, with the long body folded and named', ['  for (int pass = 0; pass < 2; ++pass) {', '    try {', '      if (frame.ready()) {', '        emit(frame, pass);', '}'].every((text) => shown.rows.some((row) => row.text === text)) && shown.folds.some((fold) => /process/.test(fold)), JSON.stringify({ folds: shown.folds, rows: shown.rows.map((row) => row.line) }));
  const placeRows = await activeRows(walk);
  check('the strong rows are exactly the place\'s marked rows: new line 629 and the old line it replaced', sameSet(shown.rows.filter((row) => row.strong).map((row) => `${row.side}:${String(row.line)}`), placeRows) && placeRows.includes('target:629') && placeRows.length === 2, JSON.stringify({ strong: shown.rows.filter((row) => row.strong), placeRows }));
  await walk.shot('06-W3.2-long-function');

  stage = 'a delegation of the first walk keeps to its places\' lines';
  await goStep(walk, 'W1.1');
  const sectionAgain = await reviewSectionPage();
  const job = await delegate(sectionAgain, key, 'all', 1);
  const mandate = job.job.scope.ranges.map((entry) => `${entry.side}:${String(entry.start)}-${String(entry.end)}`).sort();
  check('the mandate is the walk\'s marked lines, the blank line 131 with them, and no line outside the walk', mandate.includes('target:128-131') && mandate.includes('target:137-137') && mandate.includes('target:4-4') && !mandate.some((entry) => /^target:(148|150|151|153)-/.test(entry)), JSON.stringify(mandate));

  stage = 'what is left';
  await walk.ev(`[...document.querySelectorAll('.rv-tab')].find((button) => /Coverage/.test(button.textContent))?.click(); true`);
  await walk.until('What is left', `${q('coverage-remaining')}!==null`, 15_000);
  const outside = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev="coverage-outside"]')].map((e) => ({ path: e.dataset.path, side: e.dataset.side, start: Number(e.dataset.start), end: Number(e.dataset.end), text: e.parentElement.innerText })))`));
  note('in no walk', JSON.stringify(outside.map((entry) => `${entry.path}:${entry.side}:${String(entry.start)}-${String(entry.end)}`)));
  const has = (filePath, side, start, end) => outside.some((entry) => entry.path === filePath && entry.side === side && entry.start === start && entry.end === end);
  const sizeBase = lineOf(adapter.base, '  return size_;');
  check('in no walk: the whitespace change, the lone blank line, the substantive change, and the new file\'s rest', has(ADAPTER, 'target', 148, 148) && has(ADAPTER, 'base', sizeBase, sizeBase) && outside.some((entry) => entry.path === ADAPTER && entry.side === 'target' && entry.start === entry.end && entry.text.includes('blank lines only')) && has(ADAPTER, 'target', 153, 153) && has(TABLE, 'target', 1, 139) && has(TABLE, 'target', 145, 300), JSON.stringify(outside));
  check('the lone blank line is said to be blank lines only', outside.filter((entry) => entry.text.includes('blank lines only')).length === 1, JSON.stringify(outside.filter((entry) => entry.text.includes('blank lines only'))));
  check('no walk place line is listed as in no walk', !has(ADAPTER, 'target', 131, 131) && !outside.some((entry) => entry.path === ADAPTER && entry.side === 'target' && entry.start <= 131 && entry.end >= 128), '');
  await walk.shot('07-what-is-left');
  // Each change in no walk, opened from What is left and decided about exactly.
  for (const entry of outside) {
    await walk.ev(`[...document.querySelectorAll('[data-ev="coverage-outside"]')].find((e) => e.dataset.path === ${JSON.stringify(entry.path)} && e.dataset.side === ${JSON.stringify(entry.side)} && e.dataset.start === ${JSON.stringify(String(entry.start))})?.click(); true`);
    const decisionPage = await reviewSectionPage().catch(() => null);
    const sectionHere = decisionPage ?? walk;
    const expect = `${entry.side}:${String(entry.start)}-${String(entry.end)}`;
    const here = await sectionHere.until('the change\'s decision', `(() => { const e = document.querySelector('[data-ev="place-decision"]'); return e && e.dataset.marked === ${JSON.stringify(expect)} ? e.dataset.lines : false; })()`, 15_000);
    const strong = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('.rv-code .rv-row.rv-old, .rv-code .rv-row.rv-new')].filter((row) => row.offsetParent !== null).map((row) => row.dataset.selSide + ':' + row.dataset.selLine))`));
    const expectRows = range(entry.start, entry.end).map((line) => `${entry.side}:${String(line)}`);
    check(`${entry.path} ${expect}: decided about exactly its lines, and exactly those drawn strong`, Number(here) === entry.end - entry.start + 1 && sameSet(strong, expectRows), JSON.stringify({ here, strong: strong.slice(0, 6), count: strong.length }));
    if (entry.text.includes('blank lines only')) await walk.shot('08-a-blank-line-in-no-walk-opened');
    await sectionHere.ev(`document.querySelector('[data-ev="place-decision"] [data-ev="place-accept"]').click()`);
    await sectionHere.until('the confirmation', `${q('place-confirm-scope')}!==null`, 10_000);
    await sectionHere.ev(`${q('place-confirm-submit')}.click()`);
    await sectionHere.until('accepted', `document.querySelector('[data-ev="place-decision"]')?.dataset.accepted === document.querySelector('[data-ev="place-decision"]')?.dataset.lines`, 15_000);
    await walk.ev(`[...document.querySelectorAll('.rv-tab')].find((button) => /Coverage/.test(button.textContent))?.click(); true`);
    await walk.until('What is left', `${q('coverage-remaining')}!==null`, 15_000);
  }
  // The walk places not decided yet, each opened in its walk and accepted there.
  for (let round = 0; round < 12; round += 1) {
    const next = await walk.ev(`(() => { const e = document.querySelector('[data-ev="coverage-undecided"]'); return e ? e.dataset.step : null; })()`);
    if (next === null) break;
    await walk.ev(`document.querySelector('[data-ev="coverage-undecided"]').click(); true`);
    await walk.until(`${next} active`, `document.body.innerText.includes(${JSON.stringify(`${next} · place`)})`, 15_000);
    const decide = await reviewSectionPage();
    const open = JSON.parse(await decide.ev(`JSON.stringify([...document.querySelectorAll('[data-ev="place-decision"]')].findIndex((e) => Number(e.dataset.accepted) + Number(e.dataset.exempted) < Number(e.dataset.lines)))`));
    if (open >= 0) await confirmAccept(decide, open, '');
    await delay(800);
    await walk.ev(`[...document.querySelectorAll('.rv-tab')].find((button) => /Coverage/.test(button.textContent))?.click(); true`);
    await walk.until('What is left', `${q('coverage-remaining')}!==null`, 15_000);
  }
  const summary = await walk.ev(`JSON.stringify({ total: Number(${q('coverage-remaining')}.dataset.total), decided: Number(${q('coverage-remaining')}.dataset.decided), text: ${q('coverage-remaining-summary')}.textContent, outsideOpen: [...document.querySelectorAll('[data-ev="coverage-outside"]')].filter((e) => e.dataset.decided !== String(Number(e.dataset.end) - Number(e.dataset.start) + 1)).length, undecided: document.querySelectorAll('[data-ev="coverage-undecided"]').length })`).then(JSON.parse);
  check('every changed line has a decision, made by the person through the walk window: 100%', summary.total > 0 && summary.decided === summary.total && /\(100%\)/.test(summary.text) && summary.outsideOpen === 0 && summary.undecided === 0, JSON.stringify(summary));
  check('no decision was made by anything but the person: every mark is manual, from the walk, the diff or an opened change', recordNow(key).marks.every((mark) => mark.op === 'manual' && ['walk', 'diff', 'opened', undefined].includes(mark.origin?.kind)), JSON.stringify(recordNow(key).marks.map((mark) => [mark.op, mark.origin?.kind])));
  await walk.shot('09-what-is-left-all-decided');

  stage = 'after a restart';
  const before = { marks: rangesOf(key).length, summary };
  diff = await restart('again');
  const walkAgain = await openWalk(diff);
  await walkAgain.ev(`[...document.querySelectorAll('.rv-tab')].find((button) => /Coverage/.test(button.textContent))?.click(); true`);
  await walkAgain.until('What is left', `${q('coverage-remaining')}!==null`, 30_000);
  const again = await walkAgain.ev(`JSON.stringify({ total: Number(${q('coverage-remaining')}.dataset.total), decided: Number(${q('coverage-remaining')}.dataset.decided) })`).then(JSON.parse);
  check('after a restart the decisions and the coverage are as they were', again.total === before.summary.total && again.decided === before.summary.decided && rangesOf(key).length === before.marks, JSON.stringify({ again, before }));
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
