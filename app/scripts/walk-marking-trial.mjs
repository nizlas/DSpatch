// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The walk marking trial (DSP-202), on the Accept scope trial's plumbing (copied from
 * scripts/accept-scope-trial.mjs). DSpatch's real windows over an isolated profile and a generic
 * project, with a prepared walk: W1.1 marks two old if lines replaced by one with the unchanged block
 * after them (case A, with a removal and an addition outside it, case D); W1.2 a new function inside
 * a larger added block (B); W1.3 one more line of the same hunk (C).
 *
 * It checks, from the rows as drawn and their computed colours: a place's changed rows are light red
 * and green in every pane, the next pane's before it is active; other changed rows a weaker red and
 * green; unchanged rows inside a reference plain, with no grey plate; the gold flash on the arriving
 * place's changed rows only, caught while it lasts, and none on a neighbour or a re-render; the
 * colours' lightness and the text's contrast; Whole file changing nothing; navigation deciding
 * nothing; and Accept at a place reviewing exactly its lines in the diff window.
 *
 *     node scripts/walk-marking-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`, and on Linux an X display (Linux CI runs it under `xvfb-run`). Input is
 * DevTools input into the page. Nothing of the machine's own profile is touched; the standalone
 * host this trial starts is ended.
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-walk-marking', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};
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

/** Every walk row of a file in the walk window: pane, side, line, kind, classes and drawn colours. */
const paneRows = (walk, file) =>
  walk
    .ev(`JSON.stringify([...document.querySelectorAll('section.rv-pane')].flatMap((pane) => [...pane.querySelectorAll('.rv-row[data-sel-path="${file}"]')].map((row) => {
      const style = getComputedStyle(row);
      const code = row.querySelector('code');
      return { pane: Number(pane.dataset.paneIndex ?? -1), active: pane.classList.contains('rv-pane-active'), side: row.dataset.selSide, line: Number(row.dataset.selLine), kind: row.classList.contains('rv-old') ? 'own-old' : row.classList.contains('rv-new') ? 'own-new' : row.classList.contains('rv-old-faint') ? 'old' : row.classList.contains('rv-new-faint') ? 'new' : 'plain', arrive: row.classList.contains('rv-arrive'), edge: row.classList.contains('rv-focus-active'), bg: style.backgroundColor, text: code ? getComputedStyle(code).color : style.color };
    })))`)
    .then((text) => JSON.parse(text));
const rowsAt = (rows, side, line) => rows.filter((row) => row.side === side && row.line === line);
const kindsAt = (rows, side, lines) => lines.map((line) => [...new Set(rowsAt(rows, side, line).map((row) => row.kind))].join('|'));
/** The rows of one pane only. */
const inPane = (rows, pane) => rows.filter((row) => row.pane === pane);
/** The pane in which these lines are a place's own (light red or green). */
const paneOwning = (rows, side, lines) =>
  [...new Set(rows.map((row) => row.pane))].find((pane) => kindsAt(inPane(rows, pane), side, lines).every((kind) => kind === 'own-new' || kind === 'own-old')) ?? null;
const arriving = (walk) => walk.ev(`JSON.stringify([...document.querySelectorAll('.rv-arrive')].map((row) => [row.closest('section.rv-pane')?.dataset.paneIndex, row.dataset.selPath, row.dataset.selSide, Number(row.dataset.selLine)]))`).then((text) => JSON.parse(text));
const activePane = (walk) => walk.ev(`Number(document.querySelector('section.rv-pane-active')?.dataset.paneIndex ?? -1)`);

/** Colour arithmetic for the judgement in the results: WCAG relative luminance and contrast. */
/** A computed colour as 0–255 channels: `rgb(…)`, or `color(srgb …)` with 0–1 channels as color-mix gives it. */
function rgb(text) {
  const numbers = (text.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number).slice(0, 3);
  return text.startsWith('color(') ? numbers.map((value) => value * 255) : numbers;
}
function luminance(text) {
  const [r, g, b] = rgb(text).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

async function main() {
  stage = 'preflight';
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-marking-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-marking-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  const write = (name, lines) => fs.writeFileSync(path.join(project, name), `${lines.join('\n')}\n`);
  // A and D: two old if lines replaced by one, the block after unchanged; a note removed and a constant added further down.
  write('src/check.js', ['export function check(value, limit) {', '  if (value !== null)', '    if (value > limit) {', "      log('over', value);", "      return 'over';", '    }', "  return 'ok';", '}', '// an old note']);
  // B and C: a new function inside a larger added block, with a second place in the same hunk.
  write('src/worker.js', ['export function run(items) {', '  return items.length;', '}']);
  git('add', '.');
  git('commit', '-qm', 'Commit 1');
  const base = git('rev-parse', 'HEAD');
  write('src/check.js', ['export function check(value, limit) {', '  if (value !== null && value > limit) {', "      log('over', value);", "      return 'over';", '    }', "  return 'ok';", '}', 'export const LIMIT = 10;']);
  write('src/worker.js', ['export function run(items) {', '  start();', '  return items.length;', '}', '', 'function start() {', '  return { running: true };', '}', '', 'export const VERSION = 2;']);
  git('add', '.');
  git('commit', '-qm', 'Commit 2');
  const target = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(profile, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'reviews', 'preferences.json'), `${JSON.stringify({ language: 'en', discussionPlace: 'walk' }, null, 2)}\n`);

  stage = 'the review of the pair';
  const main = await launch('marking');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  const diff = await openReview(main);
  await openPair(diff);
  const key = await poll('the review record', () => reviewKey(), 20_000);
  const walkFolder = path.join(profile, 'reviews', 'generated', key);
  fs.mkdirSync(walkFolder, { recursive: true });
  const step = (id, title, file, start, end, anchor) => ({ id, title, text: `${title}.`, refs: [{ path: file, side: 'target', start, end, role: 'walk', anchor }] });
  fs.writeFileSync(
    path.join(walkFolder, 'marking.review.json'),
    `${JSON.stringify({ format: 'dspatch-review/1', title: 'Marking trial', repository: project, base, target, walks: [{ id: 'W1', title: 'Marking trial', question: 'What changes?', steps: [step('W1.1', 'The check is one condition', 'src/check.js', 2, 5, 'value > limit'), step('W1.2', 'A worker is started', 'src/worker.js', 6, 8, 'function start'), step('W1.3', 'A version constant', 'src/worker.js', 10, 10, 'VERSION')] }] }, null, 2)}\n`,
  );
  await diff.ev('location.reload()');
  await diff.attach(60_000);
  await diff.until('the ongoing review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await diff.ev(`${q('pair-discussion')}!==null`)) !== true) await diff.click('pair-ongoing-open-0');
  await diff.until('the walk offered', `${q('pair-walks')}?.getAttribute('aria-disabled') === 'false'`, 30_000);
  await diff.shot('00-diff-window-before');

  stage = 'A and D: the first place, with the next pane beside it';
  const walk = await openWalk(diff);
  await walk.cmd('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }).catch(() => undefined);
  await walk.until('both files drawn', `document.querySelectorAll('.rv-row[data-sel-path="src/worker.js"]').length > 0 && document.querySelectorAll('.rv-row[data-sel-path="src/check.js"]').length > 0`, 20_000);
  await delay(2200);
  check('no row is still flashing once the first place has settled', (await arriving(walk)).length === 0, JSON.stringify(await arriving(walk)));
  await walk.shot('01-first-place-and-next-pane');
  let check1 = await paneRows(walk, 'src/check.js');
  check('A: both replaced if lines are light red', kindsAt(check1, 'base', [2, 3]).every((kind) => kind === 'own-old'), JSON.stringify(kindsAt(check1, 'base', [2, 3])));
  check('A: the new if line is light green', kindsAt(check1, 'target', [2]).every((kind) => kind === 'own-new'), JSON.stringify(kindsAt(check1, 'target', [2])));
  check('A: the unchanged block in the reference is plain, no grey plate', kindsAt(check1, 'target', [3, 4, 5]).every((kind) => kind === 'plain'), JSON.stringify(kindsAt(check1, 'target', [3, 4, 5])));
  const plainBg = rowsAt(check1, 'target', 1)[0]?.bg ?? '';
  check('A: the unchanged rows inside and outside the reference are drawn alike', [3, 4, 5].every((line) => rowsAt(check1, 'target', line).every((row) => row.bg === plainBg)), `${plainBg} vs ${JSON.stringify([3, 4, 5].map((line) => rowsAt(check1, 'target', line)[0]?.bg))}`);
  check('A: only the changed rows carry the amber edge', check1.filter((row) => row.edge).map((row) => `${row.side}:${String(row.line)}`).sort().join(',') === 'base:2,base:3,target:2', JSON.stringify(check1.filter((row) => row.edge).map((row) => `${row.side}:${String(row.line)}`)));
  check('D: the note removed outside the place is a weaker red, the constant added a weaker green', kindsAt(check1, 'base', [9])[0] === 'old' && kindsAt(check1, 'target', [8])[0] === 'new', `${JSON.stringify(kindsAt(check1, 'base', [9]))} ${JSON.stringify(kindsAt(check1, 'target', [8]))}`);
  let worker = await paneRows(walk, 'src/worker.js');
  const firstPane = await activePane(walk);
  check('B: the next pane is drawn while the first place is active', worker.length > 0 && worker.every((row) => !row.active), `${String(worker.length)} rows`);
  const paneB = paneOwning(worker, 'target', [6, 7, 8]);
  check('B: the next place\'s function is already light green in its pane', paneB !== null, JSON.stringify([...new Set(worker.map((row) => row.pane))].map((pane) => [pane, kindsAt(inPane(worker, pane), 'target', [6, 7, 8])])));
  check('B: the added lines around it are a weaker green there', kindsAt(inPane(worker, paneB), 'target', [2, 5, 9]).every((kind) => kind === 'new' || kind === ''), JSON.stringify(kindsAt(inPane(worker, paneB), 'target', [2, 5, 9])));

  // The colours as drawn, judged by their numbers as well as by eye in the screenshots.
  const ownNew = rowsAt(check1, 'target', 2)[0];
  const ownOld = rowsAt(check1, 'base', 2)[0];
  const weakNew = rowsAt(check1, 'target', 8)[0];
  const weakOld = rowsAt(check1, 'base', 9)[0];
  const colours = {
    plain: plainBg,
    ownNew: ownNew?.bg,
    ownOld: ownOld?.bg,
    weakNew: weakNew?.bg,
    weakOld: weakOld?.bg,
    luminance: Object.fromEntries(Object.entries({ plain: plainBg, ownNew: ownNew?.bg, ownOld: ownOld?.bg, weakNew: weakNew?.bg, weakOld: weakOld?.bg }).map(([name, value]) => [name, Math.round(luminance(value ?? '') * 1000) / 1000])),
    textContrast: { ownNew: Math.round(contrast(ownNew?.text ?? '', ownNew?.bg ?? '') * 10) / 10, ownOld: Math.round(contrast(ownOld?.text ?? '', ownOld?.bg ?? '') * 10) / 10, weakNew: Math.round(contrast(weakNew?.text ?? '', weakNew?.bg ?? '') * 10) / 10, weakOld: Math.round(contrast(weakOld?.text ?? '', weakOld?.bg ?? '') * 10) / 10 },
  };
  fs.writeFileSync(path.join(evidence, 'colours.json'), `${JSON.stringify(colours, null, 2)}\n`);
  note('the colours as drawn', JSON.stringify(colours));
  const lum = colours.luminance;
  check('light green and light red are of comparable lightness', Math.abs(lum.ownNew - lum.ownOld) / Math.max(lum.ownNew, lum.ownOld) < 0.2, JSON.stringify(lum));
  check('the weaker green and red stand clearly apart from unchanged code', lum.weakNew / lum.plain > 1.5 && lum.weakOld / lum.plain > 1.5, JSON.stringify(lum));
  check('the place\'s own rows are clearly lighter than the weaker ones', lum.ownNew / lum.weakNew > 1.4 && lum.ownOld / lum.weakOld > 1.4, JSON.stringify(lum));
  check('the code text keeps a contrast of at least 4.5:1 on every change colour', Object.values(colours.textContrast).every((value) => value >= 4.5), JSON.stringify(colours.textContrast));

  stage = 'B: arriving at the next place';
  await walk.ev(`document.querySelector('.rv-nav-next').click()`);
  await delay(150);
  await walk.shot('02-arrival-flash-in-progress');
  const flash = await arriving(walk);
  const flashBg = await walk.ev(`(() => { const row = document.querySelector('.rv-arrive'); return row ? getComputedStyle(row).backgroundColor : ''; })()`);
  note('the flash, 150 ms after arriving', `${JSON.stringify(flash)} ${flashBg}`);
  check('only the arriving place\'s changed rows flash: worker.js 6–8', JSON.stringify(flash.map((entry) => `${entry[1]}:${entry[2]}:${String(entry[3])}`).sort()) === JSON.stringify(['src/worker.js:target:6', 'src/worker.js:target:7', 'src/worker.js:target:8']), JSON.stringify(flash));
  // Mid-animation Chromium reports the interpolated colour in oklab: gold is light and on the yellow side (b > 0).
  const golden = flashBg.startsWith('oklab(')
    ? (() => {
        const [lightness, , yellow] = (flashBg.match(/-?[\d.]+/g) ?? []).map(Number);
        return lightness > 0.4 && yellow > 0.05;
      })()
    : rgb(flashBg)[0] > rgb(flashBg)[2] + 40 && rgb(flashBg)[1] > rgb(flashBg)[2] + 20;
  check('the flash is gold while it lasts', golden, flashBg);
  await delay(2200);
  worker = await paneRows(walk, 'src/worker.js');
  check('after the flash the function settles into light green', kindsAt(inPane(worker, paneB), 'target', [6, 7, 8]).every((kind) => kind === 'own-new') && (await arriving(walk)).length === 0);
  check1 = await paneRows(walk, 'src/check.js');
  check('the previous pane keeps its own place light red and green', kindsAt(check1, 'base', [2, 3]).every((kind) => kind === 'own-old') && kindsAt(check1, 'target', [2])[0] === 'own-new', JSON.stringify([kindsAt(check1, 'base', [2, 3]), kindsAt(check1, 'target', [2])]));
  await walk.shot('03-settled-at-the-next-place');

  stage = 'a re-render does not flash again';
  await walk.ev(`(() => { const box = [...document.querySelectorAll('.rv-navbar-controls input[type=checkbox]')][0]; box?.click(); })()`);
  await delay(120);
  const afterRender = await arriving(walk);
  await walk.ev(`(() => { const box = [...document.querySelectorAll('.rv-navbar-controls input[type=checkbox]')][0]; box?.click(); })()`);
  check('wrapping the lines and back starts no flash', afterRender.length === 0 && (await arriving(walk)).length === 0, JSON.stringify(afterRender));

  stage = 'C: the second place in the same hunk';
  const section = await reviewSectionPage();
  let said = await placesSaid(section);
  check('the active place decides about its 3 lines', said.length === 1 && said[0].marked === 'target:6-8' && said[0].lines === 3, JSON.stringify(said));
  await walk.ev(`document.querySelector('.rv-nav-next').click()`);
  await delay(150);
  const flash3 = await arriving(walk);
  check('arriving at the second place flashes its one line only', JSON.stringify(flash3.map((entry) => `${entry[1]}:${String(entry[3])}`)) === JSON.stringify(['src/worker.js:10']), JSON.stringify(flash3));
  await delay(2200);
  const thirdPane = await activePane(walk);
  note('the panes', `first ${String(firstPane)}, third ${String(thirdPane)}`);
  said = await placesSaid(section);
  check('the second place decides about its own line', said.length === 1 && said[0].marked === 'target:10-10' && said[0].lines === 1, JSON.stringify(said));
  worker = await paneRows(walk, 'src/worker.js');
  const paneC = await activePane(walk);
  const panesSaid = JSON.stringify([...new Set(worker.map((row) => row.pane))].map((pane) => [pane, kindsAt(inPane(worker, pane), 'target', [6, 7, 8, 10])]));
  note('worker.js per pane, lines 6, 7, 8 and 10', panesSaid);
  if (paneC === paneB) {
    check('C: one pane shows both places of the hunk, each its own light green', kindsAt(inPane(worker, paneC), 'target', [6, 7, 8, 10]).every((kind) => kind === 'own-new'), panesSaid);
  } else {
    check('C: the second place\'s pane marks line 10 only, the first place\'s lines weaker', kindsAt(inPane(worker, paneC), 'target', [10])[0] === 'own-new' && kindsAt(inPane(worker, paneC), 'target', [6, 7, 8]).every((kind) => kind === 'new' || kind === ''), panesSaid);
    check('C: the first place\'s pane still marks 6–8 only, line 10 weaker', kindsAt(inPane(worker, paneB), 'target', [6, 7, 8]).every((kind) => kind === 'own-new') && ['new', ''].includes(kindsAt(inPane(worker, paneB), 'target', [10])[0]), panesSaid);
  }
  check('navigating decided nothing and counted nothing', recordNow(key).marks.length === 0, String(recordNow(key).marks.length));
  check('the diff window has no line marked by navigation', manualLines(await diffStrips(diff, 'worker.js')).length === 0);

  stage = 'Whole file changes no scope';
  await walk.ev(`document.querySelector('.rv-navbar-controls .rv-seg').querySelectorAll('button')[2].click()`);
  await delay(1500);
  worker = await paneRows(walk, 'src/worker.js');
  said = await placesSaid(section);
  check('with the whole file, the second place still marks and decides about line 10 only', said[0]?.marked === 'target:10-10' && kindsAt(inPane(worker, paneC), 'target', [10])[0] === 'own-new' && kindsAt(inPane(worker, paneC), 'target', [9])[0] === 'new', JSON.stringify([said[0]?.marked, kindsAt(inPane(worker, paneC), 'target', [9, 10])]));
  check('and nothing flashed for it', (await arriving(walk)).length === 0);
  await walk.shot('04-whole-file');

  stage = 'Accept at a place';
  await confirmAccept(section, 0, 'new lines 10 in worker.js');
  await section.until('1 line accepted', `document.querySelector('[data-ev="place-decision"]')?.dataset.accepted === '1'`, 15_000);
  const strips = await diffStrips(diff, 'worker.js');
  check('Accept at the second place reviews exactly worker.js line 10 in the diff window', JSON.stringify(manualLines(strips)) === JSON.stringify([10]), JSON.stringify(manualLines(strips)));
  await diff.shot('05-diff-window-after-accept');
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
