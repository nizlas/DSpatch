// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The code and review view trial (DSP-206), on the walk delegation trial's plumbing (copied from
 * scripts/walk-delegation-trial.mjs). DSpatch's real windows over an isolated profile and a
 * generic C++ project; the reviewing and discussing agent is SIMULATED (the presentation adapter).
 *
 * Syntax colours: the diff window (unified, Whole file, side by side) and the walk window
 * (Before → After, Before, After, the file level) colour comments, strings, keywords, types and
 * function names; a place whose visible rows start inside a block comment shows them as comment;
 * a line that is a comment in the base and code in the target is coloured from its own side; each
 * code cell's text is exactly its line; every token keeps a contrast of at least 4.5:1 on its
 * row's background, measured from the computed colours; while an arriving place flashes, its
 * tokens take the plain text colour, and the flash, the marked rows and Accept's scope are the
 * same exact lines.
 *
 * The agent report: two walk delegations, so two folded reports above the diff; in a narrow
 * window at 150% zoom each folded line is whole, clickable, and above the code; the same rule
 * the fix replaced is put back for a moment to show that it cut them; opened, the report keeps
 * the code below it, and stays open when the record is updated.
 *
 * The Discussion field: one line empty; taller with Shift+Enter, typed and pasted text and soft
 * wrapping; capped near 40% of the window with a scrollbar inside and the caret in view; a
 * narrower window and zoom resize it with the draft, focus and selection kept; moved to the diff
 * window, its own window and back with the draft kept; emptied and sent back to one line.
 *
 *     node scripts/view-trial.mjs [<evidence folder>]
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-views', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};
const BOX = 'src/box.cpp';
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

// --- DSP-206: what the trial reads in the page ----------------------------------------------

/**
 * Every syntax token under `root`: its kind, its text, its computed colour and the colour of
 * what it is drawn on (the nearest backgrounds composed down to an opaque one), and the WCAG
 * contrast of the two. Runs in the page.
 */
function tokenSurvey(root) {
  const parse = (value) => {
    const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
    if (rgb !== null) {
      const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { c: parts.slice(0, 3), a: parts[3] ?? 1 };
    }
    const srgb = /^color\(srgb ([^)]+)\)$/.exec(value);
    if (srgb !== null) {
      const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return { c: parts.slice(0, 3).map((part) => part * 255), a: parts[3] ?? 1 };
    }
    return null;
  };
  const background = (element) => {
    const layers = [];
    for (let at = element; at !== null; at = at.parentElement) {
      const layer = parse(getComputedStyle(at).backgroundColor);
      if (layer !== null && layer.a > 0) {
        layers.push(layer);
        if (layer.a >= 1) break;
      }
    }
    let colour = [16, 19, 23];
    for (const layer of layers.reverse()) colour = colour.map((value, index) => layer.c[index] * layer.a + value * (1 - layer.a));
    return colour;
  };
  const lum = (colour) => {
    const [r, g, b] = colour.map((value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const out = [];
  for (const token of document.querySelectorAll(`${root} [class*="rv-tk-"]`)) {
    if (token.getClientRects().length === 0) continue;
    const ink = parse(getComputedStyle(token).color);
    const ground = background(token);
    const row = token.closest('[data-code-line], [data-sel-line]');
    out.push({
      kind: [...token.classList].find((name) => name.startsWith('rv-tk-'))?.slice(6) ?? '',
      text: token.textContent.slice(0, 30),
      ratio: Math.round(ratio(ink.c, ground) * 100) / 100,
      ink: ink.c.map(Math.round).join(','),
      ground: ground.map(Math.round).join(','),
      where: row === null ? '' : `${row.dataset.codeSide ?? row.dataset.selSide}:${row.dataset.codeLine ?? row.dataset.selLine}:${row.className}`,
    });
  }
  return JSON.stringify(out);
}

/** A code cell's or a walk row's text pieces as [kind, text], plain where no token colours it. Runs in the page. */
function piecesOf(selector) {
  const element = document.querySelector(selector);
  if (element === null) return 'null';
  const code = element.matches('td') ? element : element.querySelector('.rv-text') ?? element;
  const out = [];
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const token = node.parentElement.closest('[class*="rv-tk-"]');
    const kind = token !== null && code.contains(token) ? [...token.classList].find((name) => name.startsWith('rv-tk-')).slice(6) : 'plain';
    out.push([kind, node.textContent]);
  }
  return JSON.stringify({ classes: element.className, text: code.textContent, pieces: out });
}

/** Every code cell of the diff and every row of the walk, as side, line and exact text. Runs in the page. */
function cellTexts() {
  const cells = [...document.querySelectorAll('td[data-code-side][data-code-line]')].map((cell) => [cell.dataset.codeSide, Number(cell.dataset.codeLine), cell.textContent]);
  const rows = [...document.querySelectorAll('[data-sel-side][data-sel-line]')]
    .filter((row) => row.dataset.selLine !== '')
    .map((row) => [row.dataset.selSide, Number(row.dataset.selLine), row.querySelector('.rv-text')?.textContent ?? '']);
  return JSON.stringify([...cells, ...rows]);
}

/** The Discussion field's size and state. Runs in the page. */
function composerState() {
  const field = document.querySelector('[data-ev="discussion-composer"]');
  const style = getComputedStyle(field);
  const frame = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  // One line, from the field's own minimum: one line of text plus its padding and border.
  const line = parseFloat(style.minHeight) - frame;
  const height = field.getBoundingClientRect().height;
  return JSON.stringify({
    lineHeight: style.lineHeight,
    height: Math.round(height * 10) / 10,
    lines: Math.round(((height - frame) / line) * 100) / 100,
    line,
    max: parseFloat(style.maxHeight),
    innerHeight: window.innerHeight,
    width: Math.round(field.getBoundingClientRect().width),
    scrollHeight: field.scrollHeight,
    clientHeight: field.clientHeight,
    scrollTop: Math.round(field.scrollTop),
    value: field.value,
    start: field.selectionStart,
    end: field.selectionEnd,
    focused: document.activeElement === field,
    bottomInView: field.getBoundingClientRect().bottom <= window.innerHeight + 1,
  });
}

/** The agent reports above the diff: each folded line's box, whether it is whole and hit, and where the code starts. Runs in the page. */
function reportsFit() {
  const box = document.querySelector('.rv-agent-reviews');
  const diff = document.querySelector('.rv-pair-diff');
  if (box === null || diff === null) return 'null';
  const outer = box.getBoundingClientRect();
  const summaries = [...box.querySelectorAll('[data-ev="agent-review"] > summary')].map((summary) => {
    const r = summary.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(40, r.width / 2), r.top + r.height / 2);
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
      whole: r.top >= outer.top - 0.5 && r.bottom <= outer.bottom + 0.5,
      hit: hit !== null && summary.contains(hit),
      open: summary.parentElement.open,
      text: summary.innerText.replace(/\s+/g, ' ').trim(),
    };
  });
  return JSON.stringify({
    top: Math.round(outer.top),
    bottom: Math.round(outer.bottom),
    clientHeight: box.clientHeight,
    scrollHeight: box.scrollHeight,
    codeTop: Math.round(diff.getBoundingClientRect().top),
    width: window.innerWidth,
    zoom: Math.round(window.devicePixelRatio * 100) / 100,
    summaries,
  });
}

const inPage = (fn, ...args) => `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(', ')})`;
const survey = async (page, root) => JSON.parse(await page.ev(inPage(tokenSurvey, root)));
const pieces = async (page, selector) => JSON.parse(await page.ev(inPage(piecesOf, selector)));
const kinds = (said) => new Set((said?.pieces ?? []).filter(([, text]) => text.trim() !== '').map(([kind]) => kind));
/** The pieces with neighbours of one kind joined: the diff cuts a token where a changed word starts. */
const runs = (said) => (said?.pieces ?? []).reduce((out, [kind, text]) => (out.length > 0 && out[out.length - 1][0] === kind ? [...out.slice(0, -1), [kind, out[out.length - 1][1] + text]] : [...out, [kind, text]]), []);
const hasPiece = (said, kind, text) => runs(said).some(([k, t]) => k === kind && t.includes(text));
const settled = (page) => page.until('no animation running', `document.getAnimations().every((animation) => animation.playState !== 'running')`, 10_000);

function contrastCheck(what, tokens) {
  const worst = [...tokens].sort((a, b) => a.ratio - b.ratio).slice(0, 3);
  const kindsSeen = [...new Set(tokens.map((token) => token.kind))].sort();
  check(`${what}: every one of ${String(tokens.length)} tokens has a contrast of at least 4.5:1 on its background`, tokens.length > 0 && tokens.every((token) => token.ratio >= 4.5), JSON.stringify({ kinds: kindsSeen, worst }));
  return kindsSeen;
}

/** Each code cell and walk row on the page shows exactly its line of its own side. */
async function exactText(page, what, files) {
  const cells = JSON.parse(await page.ev(inPage(cellTexts)));
  const wrong = cells.filter(([side, line, text]) => (side === 'base' ? files.base : files.target)[line - 1] !== text);
  check(`${what}: each of ${String(cells.length)} code lines shows exactly its own side's text`, cells.length > 0 && wrong.length === 0, JSON.stringify(wrong.slice(0, 3)));
}

const diffCell = (side, line) => `.rv-pair-diff td[data-code-side="${side}"][data-code-line="${String(line)}"]`;

/** The C++ project: a long block comment just above the first change; a line that is a comment in the base and code in the target. */
function boxFiles() {
  const filler = (k) => (k === 21 ? 'static int value21(int x) { return x * 2; } // doubled' : `static int value${String(k)}(int x) { return x + ${String(k)}; } // filler ${String(k)}`);
  const head = ['#include <vector>', '#include "box.h"', '', '/* Box: a value kept in one place.'];
  for (let n = 5; n <= 30; n += 1) head.push(` * Line ${String(n)}: "quoted" words and int notCode = ${String(n)}; stay in the comment.`);
  head.push(' * The comment ends here. */');
  const tail = ['namespace demo { void run() { printf("%d\\n", add(1, 2)); } }'];
  const base = [
    ...head,
    'const char *label() { return "old box"; }',
    'int add(int a, int b) { return a + b; }',
    '  /* The old way:',
    '     int legacy = compute(); */',
    'int compute() { return 42; } // the answer',
    ...range(1, 42).map((k) => (k === 21 ? 'static int value21(int x) { return x + 21; } // filler 21' : filler(k))),
    ...tail,
  ];
  const target = [
    ...head,
    'const char *label() { return "new box"; }',
    'int add(int a, int b) { return a + b; }',
    '  int legacy = compute(); // now real code',
    'int compute() { return 42; } // the answer',
    ...range(1, 42).map(filler),
    ...tail,
  ];
  return { base, target };
}

const WALK_TITLE = 'The box: how its label, a legacy computation kept in a comment and one doubled value change together across the source file';

/** The page that holds the Discussion field, shown: the walk window, the diff window or the panel's own window. */
async function composerPage(label) {
  return poll('the Discussion field', async () => {
    let list = [];
    try {
      list = await (await fetch(`http://127.0.0.1:${String(client.cdp)}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    } catch {
      return false;
    }
    for (const target of list.filter((entry) => entry.type === 'page' && entry.url.includes('window=review'))) {
      const page = new Page(client.cdp, label, (url) => url === target.url);
      const found = await page
        .attach(5000)
        .then(async () => {
          if ((await page.ev(`${q('right-tab-discussion')}!==null && ${q('discussion-composer')}?.offsetParent==null`)) === true) await page.click('right-tab-discussion');
          return page.until('the field shown', `${q('discussion-composer')}?.offsetParent!=null`, 4000);
        })
        .catch(() => false);
      if (found === true) return page;
      page.close();
    }
    return false;
  }, 60_000);
}

const composer = async (page) => JSON.parse(await page.ev(inPage(composerState)));
const key = (page, keyName, code, vk, modifiers = 0, text = undefined) =>
  page
    .cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vk, modifiers, ...(text === undefined ? {} : { text }) })
    .then(() => page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, modifiers }));
const shiftEnter = (page) => key(page, 'Enter', 'Enter', 13, 8, '\r');

/** The main process acts on the window, and the page, whose page has this URL. */
const windowOf = (url, body) =>
  client.main.ev(`(() => { const { BrowserWindow, webContents } = process.mainModule.require('electron'); const contents = webContents.getAllWebContents().find((each) => each.getURL() === ${JSON.stringify(url)}); const own = contents && BrowserWindow.fromWebContents(contents); const w = own ?? BrowserWindow.getAllWindows().find((each) => each.webContents.getURL().includes('window=review') && !each.webContents.getURL().includes('view=')); ${body} })()`);

async function main() {
  stage = 'preflight';
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-views-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-views-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  const files = boxFiles();
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, BOX), `${files.base.join('\n')}\n`);
  git('add', '.');
  git('commit', '-qm', 'Commit 1: the box');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(project, BOX), `${files.target.join('\n')}\n`);
  git('add', '.');
  git('commit', '-qm', 'Commit 2: a new label, the legacy computation as code, value21 doubled');
  const target = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(profile, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'reviews', 'preferences.json'), `${JSON.stringify({ language: 'en', discussionPlace: 'walk' }, null, 2)}\n`);

  stage = 'the review of the pair';
  const main = await launch('views');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  const diff = await openReview(main);
  await openPair(diff);
  const reviewId = await poll('the review record', () => reviewKey(), 20_000);
  const walkFolder = path.join(profile, 'reviews', 'generated', reviewId);
  fs.mkdirSync(walkFolder, { recursive: true });
  const step = (id, title, line) => ({ id, title, text: `What line ${String(line)} changes.`, refs: [{ path: BOX, side: 'target', start: line, end: line, role: 'walk', anchor: files.target[line - 1].trim().slice(0, 12) }] });
  fs.writeFileSync(
    path.join(walkFolder, 'views.review.json'),
    `${JSON.stringify({ format: 'dspatch-review/1', title: 'The box', repository: project, base, target, walks: [{ id: 'W1', title: WALK_TITLE, question: 'What changes in the box?', steps: [step('W1.1', 'The legacy computation becomes code', 34), step('W1.2', 'The label', 32), step('W1.3', 'Value 21 doubled', 56)] }] }, null, 2)}\n`,
  );
  await diff.ev('location.reload()');
  await diff.attach(60_000);
  await diff.until('the ongoing review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await diff.ev(`${q('pair-discussion')}!==null`)) !== true) await diff.click('pair-ongoing-open-0');
  await diff.until('the walk offered', `${q('pair-walks')}?.getAttribute('aria-disabled') === 'false'`, 30_000);

  stage = 'syntax colours in the diff window';
  await diff.ev(`[...document.querySelectorAll('[data-file-row]')].find((row) => row.textContent.includes('box.cpp'))?.click()`);
  await diff.until("box.cpp's diff", `document.querySelector(${JSON.stringify(diffCell('target', 34))}) !== null`, 20_000);
  if ((await diff.ev(`${q('pair-layout-unified')}?.getAttribute('aria-pressed')`)) !== 'true') await diff.click('pair-layout-unified');
  await diff.until('the unified layout', `document.querySelector(${JSON.stringify(diffCell('target', 34))}) !== null`, 20_000);
  const legacyBase = await pieces(diff, diffCell('base', 35));
  check('the base\'s "int legacy = compute(); */" is all comment: it is inside a comment there', [...kinds(legacyBase)].join() === 'comment', JSON.stringify(legacyBase));
  const legacyTarget = await pieces(diff, diffCell('target', 34));
  check('the target\'s "int legacy = compute(); // now real code" is code: a type, a function name and a comment', hasPiece(legacyTarget, 'type', 'int') && hasPiece(legacyTarget, 'function', 'compute') && hasPiece(legacyTarget, 'comment', '// now real code'), JSON.stringify(legacyTarget));
  const labelOld = await pieces(diff, diffCell('base', 32));
  const labelNew = await pieces(diff, diffCell('target', 32));
  check('the removed and the added label line colour their strings, types and keywords', hasPiece(labelOld, 'string', '"old box"') && hasPiece(labelNew, 'string', '"new box"') && hasPiece(labelNew, 'keyword', 'return') && hasPiece(labelNew, 'function', 'label'), JSON.stringify({ labelOld, labelNew }));
  const firstShown = await diff.ev(`Math.min(...[...document.querySelectorAll('.rv-pair-diff td[data-code-side="target"][data-code-line]')].map((cell) => Number(cell.dataset.codeLine)))`);
  const firstPieces = await pieces(diff, diffCell('target', firstShown));
  note('the first line the diff shows above the change', `${String(firstShown)}: ${firstPieces.text}`);
  check('the diff\'s first shown line starts inside the block comment and is coloured as comment', firstShown > 4 && firstShown < 32 && [...kinds(firstPieces)].join() === 'comment', JSON.stringify({ firstShown, firstPieces }));
  await exactText(diff, 'the unified diff', files);
  contrastCheck('the unified diff', await survey(diff, '.rv-pair-diff'));
  await diff.ev(`document.querySelector(${JSON.stringify(diffCell('target', 32))}).scrollIntoView({ block: 'center' }); true`);
  await diff.shot('01-diff-unified');

  await diff.click('pair-whole-file');
  await diff.until('the whole file', `document.querySelector(${JSON.stringify(diffCell('target', 1))}) !== null`, 20_000);
  const include = await pieces(diff, diffCell('target', 1));
  const commentLine = await pieces(diff, diffCell('target', 8));
  check('Whole file: "#include <vector>" is a preprocessor line with a keyword and a string, and line 8 is comment', kinds(include).has('keyword') && hasPiece(include, 'string', '<vector>') && [...kinds(commentLine)].join() === 'comment', JSON.stringify({ include, commentLine }));
  await exactText(diff, 'the whole file', files);
  contrastCheck('the whole file', await survey(diff, '.rv-pair-diff'));
  await diff.ev(`document.querySelector('.rv-pair-diff').scrollTop = 0; true`);
  await diff.shot('02-diff-whole-file');
  await diff.click('pair-whole-file');

  await diff.click('pair-layout-split');
  await diff.until('side by side', `document.querySelector('.rv-pair-table-split') !== null`, 20_000);
  const splitBase = await pieces(diff, diffCell('base', 35));
  const splitTarget = await pieces(diff, diffCell('target', 34));
  check('side by side: the base column keeps the comment and the target column the code', [...kinds(splitBase)].join() === 'comment' && hasPiece(splitTarget, 'type', 'int'), JSON.stringify({ splitBase, splitTarget }));
  await exactText(diff, 'the side-by-side diff', files);
  contrastCheck('the side-by-side diff', await survey(diff, '.rv-pair-diff'));
  await diff.ev(`document.querySelector(${JSON.stringify(diffCell('target', 32))}).scrollIntoView({ block: 'center' }); true`);
  await diff.shot('03-diff-side-by-side');
  await diff.click('pair-layout-unified');

  stage = 'syntax colours in the walk window';
  const walk = await openWalk(diff);
  await settled(walk);
  const own = await pieces(walk, '.rv-new[data-focus-active][data-sel-side="target"][data-sel-line="34"]');
  check("the place's own added row (strong green) is coloured: int, compute and the comment", own !== null && hasPiece(own, 'type', 'int') && hasPiece(own, 'function', 'compute') && hasPiece(own, 'comment', '// now real code'), JSON.stringify(own));
  const ownRemoved = await pieces(walk, '.rv-old[data-sel-side="base"][data-sel-line="35"]');
  check("the place's own removed row (strong red) is the base's comment", ownRemoved !== null && [...kinds(ownRemoved)].join() === 'comment', JSON.stringify(ownRemoved));
  const other = await pieces(walk, '.rv-new-faint[data-sel-side="target"][data-sel-line="32"]');
  check('another change in the same pane (weak green) is coloured: the string and the function name', other !== null && hasPiece(other, 'string', '"new box"') && hasPiece(other, 'function', 'label'), JSON.stringify(other));
  const context = await pieces(walk, '[data-sel-side="target"][data-sel-line="33"]:not(.rv-new):not(.rv-new-faint)');
  check('an unchanged context row is coloured on the plain background: types and the function name', context !== null && hasPiece(context, 'type', 'int') && hasPiece(context, 'function', 'add'), JSON.stringify(context));
  let inComment = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-sel-side][data-sel-line]')].map((row) => Number(row.dataset.selLine)).filter((line) => line > 4 && line < 32))`));
  if (inComment.length === 0) {
    await walk.ev(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('more lines above'))?.click(); true`);
    inComment = JSON.parse(await walk.until('rows inside the comment', `(() => { const lines = [...document.querySelectorAll('[data-sel-side][data-sel-line]')].map((row) => Number(row.dataset.selLine)).filter((line) => line > 4 && line < 32); return lines.length > 0 ? JSON.stringify(lines) : false; })()`, 10_000));
  }
  const commentRow = await pieces(walk, `[data-sel-line="${String(Math.min(...inComment))}"]`);
  check('a walk pane whose rows start inside the block comment shows them as comment', [...kinds(commentRow)].join() === 'comment', JSON.stringify({ lines: inComment.slice(0, 5), commentRow }));
  await exactText(walk, 'the walk (Before → After)', files);
  contrastCheck('the walk (Before → After)', await survey(walk, 'body'));
  await walk.shot('04-walk-before-after');

  await walk.click('code-view-before');
  await settled(walk);
  const beforeRow = await pieces(walk, '[data-sel-side="base"][data-sel-line="35"]');
  check('Before: the base\'s line 35 is comment', beforeRow !== null && [...kinds(beforeRow)].join() === 'comment', JSON.stringify(beforeRow));
  await exactText(walk, 'the walk (Before)', files);
  contrastCheck('the walk (Before)', await survey(walk, 'body'));
  await walk.shot('05-walk-before');
  await walk.click('code-view-after');
  await settled(walk);
  const afterRow = await pieces(walk, '[data-sel-side="target"][data-sel-line="34"]');
  check('After: the target\'s line 34 is code', afterRow !== null && hasPiece(afterRow, 'type', 'int'), JSON.stringify(afterRow));
  await exactText(walk, 'the walk (After)', files);
  contrastCheck('the walk (After)', await survey(walk, 'body'));
  await walk.shot('06-walk-after');
  await walk.click('code-view-both');

  const levels = '.rv-navbar-controls .rv-seg:first-child button';
  await walk.ev(`document.querySelectorAll(${JSON.stringify(levels)})[2].click(); true`);
  await walk.until('the file level', `document.querySelector('[data-sel-side="target"][data-sel-line="1"]') !== null`, 15_000);
  await settled(walk);
  const fileInclude = await pieces(walk, '[data-sel-side="target"][data-sel-line="1"]');
  check('the file level: "#include <vector>" is coloured from the top of the file', kinds(fileInclude).has('keyword') && hasPiece(fileInclude, 'string', '<vector>'), JSON.stringify(fileInclude));
  await exactText(walk, 'the walk (file level)', files);
  contrastCheck('the walk (file level)', await survey(walk, 'body'));
  await walk.shot('07-walk-file-level');
  await walk.ev(`document.querySelectorAll(${JSON.stringify(levels)})[0].click(); true`);
  await settled(walk);

  stage = 'the arriving place';
  const focusOf = () => walk.ev(`JSON.stringify([...document.querySelectorAll('[data-focus-active]')].map((row) => row.dataset.selSide + ':' + row.dataset.selLine).sort())`).then(JSON.parse);
  check('the first place marks target line 34 and the base rows it replaced', (await focusOf()).includes('target:34'), JSON.stringify(await focusOf()));
  await walk.ev(`document.querySelector('.rv-nav-next').click(); true`);
  const flash = JSON.parse(
    await walk.until(
      'the flash',
      `(() => { const rows = [...document.querySelectorAll('.rv-arrive')]; if (rows.length === 0) return false; const text = getComputedStyle(document.querySelector('.rv')).color; const held = rows.flatMap((row) => [...row.querySelectorAll('[class*="rv-tk-"]')].filter((token) => token.getAnimations().some((a) => a.currentTime !== null && a.currentTime < 300)).map((token) => getComputedStyle(token).color === text)); return JSON.stringify({ rows: rows.map((row) => row.dataset.selSide + ':' + row.dataset.selLine).sort(), held, text }); })()`,
      5000,
    ),
  );
  await walk.shot('08-walk-arrival-flash');
  await settled(walk);
  const marked = await focusOf();
  check('the flash is on exactly the arriving place\'s marked rows: target 32 and its base line, not the earlier place\'s 34', JSON.stringify(flash.rows) === JSON.stringify(marked) && marked.includes('target:32') && !marked.includes('target:34'), JSON.stringify({ flash: flash.rows, marked }));
  check('while the place flashes gold its tokens take the plain text colour', flash.held.length > 0 && flash.held.every(Boolean), JSON.stringify(flash));
  contrastCheck('the walk after the flash', await survey(walk, 'body'));
  await walk.ev(`document.querySelector('.rv-nav-button:not(.rv-nav-next)').click(); true`);
  await settled(walk);
  const firstMarked = await focusOf();
  const section = await reviewSectionPage();
  const accepted = await confirmAccept(section, 0, 'box.cpp');
  // Only the line numbers the scope names, not the revisions' hashes after them.
  const numbers = (accepted.scope.split(' in box.cpp')[0].match(/\d+/g) ?? []).map(Number);
  check("Accept's scope is the first place's own lines: 34, not 32 or 56", numbers.includes(34) && !numbers.includes(32) && !numbers.includes(56), accepted.scope);
  const acceptedMarks = await poll('the acceptance recorded', () => {
    const marks = recordNow(reviewId).marks.filter((mark) => mark.op === 'manual');
    return marks.length > 0 ? marks : false;
  }, 15_000);
  const acceptedRows = acceptedMarks.flatMap((mark) => range(mark.scope.start, mark.scope.end).map((line) => `${mark.scope.side}:${String(line)}`)).sort();
  const strips = await diffStrips(diff, 'box.cpp');
  const mine = strips.filter((strip) => strip.status === 'manual').map((strip) => `${strip.side}:${String(strip.line)}`).sort();
  check("Accept records exactly the rows the walk marks for the place, and the diff draws exactly those as the person's", JSON.stringify(acceptedRows) === JSON.stringify(firstMarked) && JSON.stringify(mine) === JSON.stringify(firstMarked), JSON.stringify({ acceptedRows, firstMarked, mine }));

  stage = 'the Discussion field';
  let talk = await composerPage('discussion (walk)');
  if ((await talk.ev(`${q('discussion-choose-agent')}!==null`)) === true) {
    await talk.ev(`(() => { const select = ${q('discussion-agent-select')}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'copilot'); select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await talk.until('the agent chosen', `${q('discussion-choose-agent')}===null`, 15_000);
  }
  await talk.click('discussion-composer');
  let now = await composer(talk);
  check('empty, the field is one line high and focused', Math.abs(now.lines - 1) < 0.15 && now.focused, JSON.stringify(now));
  await talk.shot('09-discussion-empty');
  await talk.cmd('Input.insertText', { text: 'What does line 34 compute?' });
  now = await composer(talk);
  check('one typed line keeps it one line', Math.abs(now.lines - 1) < 0.15, JSON.stringify(now));
  const heights = [now.height];
  for (let index = 2; index <= 4; index += 1) {
    await shiftEnter(talk);
    await talk.cmd('Input.insertText', { text: `Line ${String(index)} of the question.` });
    now = await composer(talk);
    heights.push(now.height);
  }
  check('Shift+Enter adds lines and the field grows with each, without sending', Math.abs(now.lines - 4) < 0.2 && heights.every((height, index) => index === 0 || height > heights[index - 1]) && now.value.split('\n').length === 4, JSON.stringify({ heights, now }));
  const wrapText = `${' and a long sentence that the panel wraps'.repeat(6)}.`;
  const beforeWrap = now.lines;
  await shiftEnter(talk);
  await talk.cmd('Input.insertText', { text: wrapText });
  now = await composer(talk);
  check('a long line wraps at the panel\'s width and the field grows by its wrapped lines', now.lines >= beforeWrap + 2, JSON.stringify({ beforeWrap, now }));
  await talk.shot('10-discussion-several-lines');
  const pasted = Array.from({ length: 30 }, (_, index) => `pasted line ${String(index + 1)}`).join('\n');
  await client.main.ev(`process.mainModule.require('electron').clipboard.writeText(${JSON.stringify(pasted)})`);
  await talk.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2, commands: ['paste'] });
  await talk.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
  now = await talk.until('the paste', `${q('discussion-composer')}.value.includes('pasted line 30') && ${inPage(composerState)}`, 10_000).then(JSON.parse);
  check('pasted text fills it to its cap of about 40% of the window, and then it scrolls inside', Math.abs(now.height - Math.max(now.max, now.line)) < 2 && Math.abs(now.max - now.innerHeight * 0.4) < 2 && now.scrollHeight > now.clientHeight + 10, JSON.stringify(now));
  // The caret's line is in view when the field is scrolled to within half a line of its end (its bottom padding may stay below).
  check('the caret, at the end, is in view: the field is scrolled to its last line and stays inside the window', now.start === now.value.length && now.scrollTop + now.clientHeight >= now.scrollHeight - now.line / 2 && now.bottomInView, JSON.stringify(now));
  await talk.shot('11-discussion-at-its-cap');
  // Back to a few lines for the resizing; the draft, focus and a selection must survive it.
  await talk.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
  await talk.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await talk.cmd('Input.insertText', { text: `A draft that is kept${wrapText}` });
  await talk.ev(`(() => { const field = ${q('discussion-composer')}; field.setSelectionRange(2, 7); return true; })()`);
  const kept = await composer(talk);
  const talkUrl = talk.url;
  const size = JSON.parse(await windowOf(talkUrl, 'return JSON.stringify(w.getSize());'));
  await windowOf(talkUrl, `w.setSize(${String(Math.max(700, Math.round(size[0] * 0.6)))}, ${String(size[1])}); return true;`);
  const narrower = await talk.until('the narrower field', `(() => { const s = JSON.parse(${inPage(composerState)}); return s.width < ${String(kept.width)} - 20 ? JSON.stringify(s) : false; })()`, 10_000).then(JSON.parse);
  check('a narrower window wraps the draft onto more lines and the field grows; draft, focus and selection kept', narrower.lines > kept.lines + 0.5 && narrower.value === kept.value && narrower.focused && narrower.start === 2 && narrower.end === 7, JSON.stringify({ kept, narrower }));
  await talk.shot('12-discussion-narrower');
  await windowOf(talkUrl, `w.setSize(${String(size[0])}, ${String(size[1])}); return true;`);
  await client.main.ev(`(() => { const { webContents } = process.mainModule.require('electron'); webContents.getAllWebContents().find((each) => each.getURL() === ${JSON.stringify(talkUrl)}).setZoomFactor(1.5); return true; })()`);
  const zoomed = await talk.until('the zoomed field', `window.devicePixelRatio > 1.3 && ${inPage(composerState)}`, 10_000).then(JSON.parse);
  check('at 150% zoom the field is sized again within its cap, with the draft, focus and selection kept', zoomed.height <= zoomed.max + 1 && zoomed.value === kept.value && zoomed.focused && zoomed.start === 2 && zoomed.end === 7 && zoomed.lines >= 1, JSON.stringify(zoomed));
  await talk.shot('13-discussion-zoomed');
  await client.main.ev(`(() => { const { webContents } = process.mainModule.require('electron'); webContents.getAllWebContents().find((each) => each.getURL() === ${JSON.stringify(talkUrl)}).setZoomFactor(1); return true; })()`);
  await delay(700);
  for (const [control, label, shot] of [
    ['panel-dock-diff', 'discussion (docked in the diff)', '14-discussion-docked-in-diff'],
    ['panel-own-window', 'discussion (its own window)', '15-discussion-own-window'],
    ['panel-dock-walk', 'discussion (back in the walk)', null],
  ]) {
    await talk.click(control);
    talk.close();
    await delay(800);
    talk = await composerPage(label);
    now = await talk.until('the draft', `${q('discussion-composer')}.value.length > 0 && ${inPage(composerState)}`, 15_000).then(JSON.parse);
    check(`${label}: the draft is kept and the field is sized for it there`, now.value === kept.value && now.lines > 1.5 && now.height <= now.max + 1, JSON.stringify(now));
    if (shot !== null) await talk.shot(shot);
  }
  await talk.click('discussion-composer');
  await talk.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
  await talk.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await key(talk, 'Backspace', 'Backspace', 8);
  now = await composer(talk);
  check('removing the text shrinks it to one line', now.value === '' && Math.abs(now.lines - 1) < 0.15, JSON.stringify(now));
  await talk.cmd('Input.insertText', { text: 'What does compute return?' });
  await shiftEnter(talk);
  await talk.cmd('Input.insertText', { text: 'And where is it called?' });
  await key(talk, 'Enter', 'Enter', 13, 0, '\r');
  now = await talk.until('the question sent', `${q('discussion-composer')}.value === '' && document.body.innerText.includes('What does compute return?') && ${inPage(composerState)}`, 30_000).then(JSON.parse);
  check('Enter sends; the cleared field is one line again', Math.abs(now.lines - 1) < 0.15, JSON.stringify(now));
  await talk.shot('16-discussion-after-sending');

  stage = 'two walk delegations';
  // The step's tab again: the Review section is on it, not on the Discussion's.
  if ((await talk.ev(`${q('right-tab-step')}!==null`)) === true) await talk.click('right-tab-step');
  talk.close();
  const sectionAgain = await reviewSectionPage();
  const first = await delegate(sectionAgain, reviewId, 'remaining', 1);
  check('the first walk review is done', first.job.state === 'done', JSON.stringify(first.job.scope));
  const second = await delegate(sectionAgain, reviewId, 'all', 2);
  check('the second walk review is done', second.job.state === 'done', JSON.stringify(second.job.scope));

  stage = 'the agent reports above the diff';
  await diff.click('pair-files').catch(() => undefined);
  await diffStrips(diff, 'box.cpp');
  await diff.until('two reports', `document.querySelectorAll('.rv-agent-reviews [data-ev="agent-review"]').length >= 2`, 30_000);
  const diffUrl = diff.url;
  // As narrow as the diff window can be made (its minimum width is 720), at 150%: about 480 CSS pixels.
  await windowOf(diffUrl, 'w.setSize(720, 720); w.webContents.setZoomFactor(1.5); return true;');
  await diff.until('narrow and zoomed', 'window.devicePixelRatio > 1.3 && window.innerWidth <= 500', 10_000);
  await delay(400);
  const fit = () => diff.ev(inPage(reportsFit)).then(JSON.parse);
  // The rule the fix replaced, for a moment: the block then shrinks with the diff and cuts its lines.
  // Set on the element itself: the page's content security policy refuses a <style> added here.
  await diff.ev(`document.querySelector('.rv-agent-reviews').style.setProperty('flex', '0 1 auto', 'important'); true`);
  await delay(300);
  const old = await fit();
  await diff.shot('17-reports-with-the-old-rule');
  const chain = () =>
    diff.ev(`JSON.stringify((() => { const out = []; for (let at = document.querySelector('.rv-agent-reviews'); at !== null && out.length < 8; at = at.parentElement) { const s = getComputedStyle(at); out.push({ cls: at.className.slice(0, 40), h: Math.round(at.getBoundingClientRect().height), sh: at.scrollHeight, display: s.display, dir: s.flexDirection, flex: s.flex, minH: s.minHeight, overflow: s.overflowY }); } const d = document.querySelector('.rv-pair-diff-row'); const ds = getComputedStyle(d); out.push({ cls: 'diff-row', h: Math.round(d.getBoundingClientRect().height), sh: d.scrollHeight, flex: ds.flex, minH: ds.minHeight }); return out; })())`);
  note('with the old rule, the reports and their parents', JSON.stringify({ old, chain: JSON.parse(await chain()) }));
  await diff.ev(`document.querySelector('.rv-agent-reviews').style.removeProperty('flex'); true`);
  await delay(300);
  note('with the new rule, the reports and their parents', JSON.stringify({ now: await fit(), chain: JSON.parse(await chain()) }));
  check('with the old rule the folded reports are cut: their block is shorter than its content', old.scrollHeight > old.clientHeight + 4 && old.summaries.some((summary) => !summary.whole), JSON.stringify(old));
  let shown = await fit();
  check('narrow at 150%: every folded report line is whole and wraps rather than being cut', shown.summaries.length >= 2 && shown.summaries.every((summary) => summary.whole && !summary.open) && shown.scrollHeight <= shown.clientHeight + 1 && shown.summaries.some((summary) => summary.height > 30), JSON.stringify(shown));
  check('each folded line can be clicked where it is drawn, and the code starts below the reports', shown.summaries.every((summary) => summary.hit) && shown.codeTop >= shown.bottom - 1, JSON.stringify(shown));
  check('the walk\'s title and the state are both in the folded line', shown.summaries.every((summary) => summary.text.includes('The box: how its label') && /awaiting your assessment|accepted by you|not accepted by you/.test(summary.text)), JSON.stringify(shown.summaries.map((summary) => summary.text)));
  await diff.shot('18-reports-folded-narrow-zoomed');
  const summaryBox = await diff.ev(`(() => { const r = document.querySelector('.rv-agent-reviews [data-ev="agent-review"] > summary').getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await diff.cmd('Input.dispatchMouseEvent', { type, ...summaryBox, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }
  await diff.until('the first report open', `document.querySelector('.rv-agent-reviews [data-ev="agent-review"]').open === true`, 5000);
  shown = await fit();
  check('opened by a click, the report starts whole, its block scrolls within its cap, and the code still starts below it', shown.summaries[0].open && shown.summaries[0].whole && shown.codeTop >= shown.bottom - 1 && !shown.summaries[1].open, JSON.stringify(shown));
  await diff.shot('19-report-open-narrow-zoomed');
  // An update of the record while it is open: the person accepts the assessment there.
  const decisionsBefore = recordNow(reviewId).marks.length;
  await diff.ev(`document.querySelector('.rv-agent-reviews [data-ev="agent-review"] [data-ev="agent-review-accept"]')?.click(); true`);
  await poll('the record updated', () => recordNow(reviewId).marks.length > decisionsBefore, 15_000);
  await delay(600);
  shown = await fit();
  check('after the update the opened report is still open and the other still folded', shown.summaries[0].open && !shown.summaries[1].open, JSON.stringify(shown.summaries));
  await windowOf(diffUrl, 'w.webContents.setZoomFactor(1); w.setSize(1280, 860); return true;');
  await delay(500);
  await diff.shot('20-reports-normal-size');
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
