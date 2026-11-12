// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The app icon trial (DSP-204), on the Accept scope trial's plumbing (copied from
 * scripts/accept-scope-trial.mjs). DSpatch's real windows on an X display with a panel (tint2)
 * whose taskbar draws each window's own icon, an isolated profile and a disposable project; the
 * provider is SIMULATED and only opens the windows.
 *
 * Each of the main, review (diff), walk and loop editor windows is read on the X server: its
 * WM_CLASS, and its _NET_WM_ICON compared pixel for pixel with the app's own dspatch-256.png. The
 * start page's icon is measured, About DSpatch is drawn from the display, and so are the panel and
 * Openbox's Alt+Tab window switcher. With DSPATCH_TRIAL_CLIENT naming an installed client
 * (/opt/DSpatch/dspatch), the installed desktop entry and the hicolor icons are compared with this
 * checkout's, the WM_CLASS with the entry's StartupWMClass, and the launcher draws the entry's icon.
 *
 *     node scripts/icon-trial.mjs [<evidence folder>]
 *
 * Linux only. Needs `npm run build` (or an installed client), Xvfb, openbox, xdotool, xprop,
 * ImageMagick's import, and tint2 for the panel. With no DISPLAY, Xvfb, openbox and tint2 are
 * started here and stopped at the end. Nothing of the machine's own profile is touched; the
 * standalone host this trial starts is ended.
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-icons', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};
const BIG = 'src/big.js';
// DSPATCH_TRIAL_CLIENT names an installed client's executable to try instead of this checkout's build.
const packaged = process.env.DSPATCH_TRIAL_CLIENT ?? '';
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
  const child = spawn(packaged === '' ? electron : packaged, [`--inspect=${String(client.inspect)}`, ...(packaged === '' ? ['.'] : []), `--user-data-dir=${profile}`, `--remote-debugging-port=${String(client.cdp)}`], {
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

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const DESKTOP_FILE = '/usr/share/applications/dspatch.desktop';
const owned = { xvfb: null, wm: null, panel: null };

function shotRoot(name, crop = null) {
  run('import', ['-window', 'root', ...(crop === null ? [] : ['-crop', crop]), path.join(evidence, `${name}.png`)], true);
}

/** The DSpatch windows with their X window ids, from the client's own BrowserWindows. */
async function xWindows() {
  return JSON.parse(await client.main.ev(`(() => {
    const { BrowserWindow } = process.mainModule.require('electron');
    return JSON.stringify(BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => ({ id: w.id, title: w.getTitle(), url: w.webContents.getURL(), xid: w.getNativeWindowHandle().readUInt32LE(0) })));
  })()`));
}

/** WM_CLASS and the sizes in _NET_WM_ICON of one X window, with the first icon's pixels at a few points. */
function xIcon(xid) {
  const wmClass = run('xprop', ['-id', String(xid), 'WM_CLASS'], true);
  const classes = [...wmClass.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  const raw = spawnSync('xprop', ['-id', String(xid), '-notype', '32c', '_NET_WM_ICON'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
  const numbers = (raw.split('=')[1] ?? '').split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
  const sizes = [];
  let first = null;
  for (let at = 0; at + 2 <= numbers.length;) {
    const [w, h] = [numbers[at], numbers[at + 1]];
    if (!(w > 0 && h > 0) || at + 2 + w * h > numbers.length) break;
    sizes.push(`${String(w)}x${String(h)}`);
    if (first === null) first = { w, h, pixels: numbers.slice(at + 2, at + 2 + w * h) };
    at += 2 + w * h;
  }
  const argb = (x, y) => {
    if (first === null) return null;
    const v = first.pixels[y * first.w + x] >>> 0;
    return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  };
  return { classes, sizes, argb, size: first === null ? 0 : first.w };
}

const SAMPLES = [[128, 128], [60, 128], [128, 190], [200, 70], [8, 128], [2, 2]];

/** The app's own 256-pixel icon, as the running client reads it, at the sample points (ARGB). */
async function expectedSamples() {
  return JSON.parse(await client.main.ev(`(() => {
    const { app, nativeImage } = process.mainModule.require('electron');
    const path = process.mainModule.require('path');
    const image = nativeImage.createFromPath(path.join(app.getAppPath(), 'dist', 'renderer', 'icons', 'dspatch-256.png'));
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const at = (x, y) => { const i = (y * size.width + x) * 4; return [bitmap[i + 3], bitmap[i + 2], bitmap[i + 1], bitmap[i]]; };
    return JSON.stringify({ size, samples: ${JSON.stringify(SAMPLES)}.map(([x, y]) => at(x, y)) });
  })()`));
}

const close = (a, b) => a !== null && b !== null && a.every((value, index) => Math.abs(value - b[index]) <= 3);

async function checkWindow(what, xid, expected, wmClassWanted) {
  const icon = xIcon(xid);
  note(`${what}: WM_CLASS and icon sizes`, JSON.stringify({ classes: icon.classes, sizes: icon.sizes }));
  check(`${what}: WM_CLASS is DSpatch's`, icon.classes[1] === wmClassWanted, JSON.stringify(icon.classes));
  check(`${what}: the window carries a 256-pixel icon (_NET_WM_ICON)`, icon.size === 256, JSON.stringify(icon.sizes));
  const seen = SAMPLES.map(([x, y]) => icon.argb(x, y));
  check(`${what}: the window's icon is DSpatch's (the same pixels as dspatch-256.png)`, seen.every((value, index) => close(value, expected.samples[index])), JSON.stringify({ seen, expected: expected.samples }));
}

async function main() {
  stage = 'preflight';
  if (packaged === '') {
    check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'icons', 'dspatch-256.png')));
  } else {
    check('the installed client is here', fs.existsSync(packaged), packaged);
  }
  check('xdotool, xprop and import are here', run('sh', ['-c', 'command -v xdotool && command -v xprop && command -v import'], true) !== '');

  // The installed package: the desktop entry, its icon in hicolor, and the client's own copies.
  let wmClassWanted = 'DSpatch';
  if (packaged !== '') {
    stage = 'the installed package';
    const entry = fs.existsSync(DESKTOP_FILE) ? fs.readFileSync(DESKTOP_FILE, 'utf8') : '';
    fs.writeFileSync(path.join(evidence, 'dspatch.desktop'), entry);
    const field = (name) => entry.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] ?? '';
    check('the desktop entry is installed', entry !== '', DESKTOP_FILE);
    check('the desktop entry names the icon dspatch', field('Icon') === 'dspatch', field('Icon'));
    check('the desktop entry starts the installed client', field('Exec').startsWith(packaged), field('Exec'));
    wmClassWanted = field('StartupWMClass');
    note('the desktop entry\'s StartupWMClass', wmClassWanted);
    for (const size of ICON_SIZES) {
      const installed = `/usr/share/icons/hicolor/${String(size)}x${String(size)}/apps/dspatch.png`;
      const ours = path.join(appDir, 'build', 'icons', `${String(size)}x${String(size)}.png`);
      check(`hicolor ${String(size)}x${String(size)}: the installed icon is this build's`, fs.existsSync(installed) && fs.readFileSync(installed).equals(fs.readFileSync(ours)), installed);
    }
    const runtime = path.join(path.dirname(packaged), 'resources', 'app', 'dist', 'renderer', 'icons', 'dspatch-256.png');
    check('the installed client carries its window icon', fs.existsSync(runtime) && fs.readFileSync(runtime).equals(fs.readFileSync(path.join(appDir, 'src', 'renderer', 'public', 'icons', 'dspatch-256.png'))), runtime);
  }

  stage = 'an X display with a panel';
  let display = process.env.DISPLAY ?? '';
  if (display === '' || process.env.ICON_TRIAL_OWN_DISPLAY === '1') {
    const number = 90 + (process.pid % 50);
    display = `:${String(number)}`;
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' });
    await poll('Xvfb', () => fs.existsSync(`/tmp/.X11-unix/X${String(number)}`), 15_000);
    process.env.DISPLAY = display;
    owned.wm = spawn('openbox', [], { env: process.env, stdio: 'ignore' });
    await delay(800);
  }
  // A taskbar that draws each window's own icon, and a launcher with the desktop entry's.
  const tint2rc = path.join(evidence, 'tint2rc');
  fs.writeFileSync(tint2rc, [
    'rounded = 0', 'border_width = 0', 'background_color = #2b2f36 100', 'border_color = #000000 0',
    'rounded = 4', 'border_width = 0', 'background_color = #4a5160 100', 'border_color = #000000 0',
    `panel_items = ${packaged !== '' && fs.existsSync(DESKTOP_FILE) ? 'LT' : 'T'}`,
    'panel_size = 100% 44', 'panel_position = bottom center horizontal', 'panel_background_id = 1', 'panel_padding = 6 4 8',
    'taskbar_mode = single_desktop', 'taskbar_padding = 2 2 6',
    'task_icon = 1', 'task_text = 1', 'task_centered = 0', 'task_maximum_size = 240 36', 'task_padding = 6 3 6',
    'task_font_color = #ffffff 100', 'task_active_background_id = 2', 'task_background_id = 0',
    'launcher_padding = 6 4 6', 'launcher_icon_size = 32', 'launcher_icon_theme = hicolor', 'launcher_icon_theme_override = 1',
    ...(packaged !== '' && fs.existsSync(DESKTOP_FILE) ? [`launcher_item_app = ${DESKTOP_FILE}`] : []),
    '',
  ].join('\n'));
  if (run('sh', ['-c', 'command -v tint2'], true) !== '') {
    owned.panel = spawn('tint2', ['-c', tint2rc], { env: process.env, stdio: 'ignore' });
    await delay(1200);
    check('a panel (tint2) runs on the display', owned.panel.exitCode === null);
  } else {
    note('no panel: tint2 is not installed, so the taskbar is not drawn');
  }
  note('the display', `${display}; WM openbox; client ${packaged === '' ? 'this checkout\'s build' : packaged}`);

  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-icon-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-icon-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src', 'small.js'), 'export const small = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'Commit 1');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(project, BIG), `${range(1, 40).map((line) => `export const value${String(line)} = ${String(line)};`).join('\n')}\n`);
  git('add', '.');
  git('commit', '-qm', 'Commit 2: a new file');
  const target = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(profile, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'reviews', 'preferences.json'), `${JSON.stringify({ language: 'en' }, null, 2)}\n`);

  stage = 'the start window';
  const main = await launch('icons');
  const expected = await expectedSamples();
  check('the client reads its own 256-pixel icon', expected.size.width === 256 && expected.size.height === 256, JSON.stringify(expected.size));
  await main.until('the start page icon drawn', `(() => { const i = document.querySelector('[data-ev="start-icon"]'); return i !== null && i.complete && i.naturalWidth === 128; })()`, 30_000);
  const startIcon = await main.ev(`JSON.stringify((() => { const b = document.querySelector('[data-ev="start-icon"]').getBoundingClientRect(); const w = document.querySelector('.wordmark').getBoundingClientRect(); return { icon: [Math.round(b.width), Math.round(b.height)], centred: Math.abs((b.left + b.width / 2) - (w.left + w.width / 2)) < 2, above: b.bottom <= w.top + 4 }; })())`);
  check('the start page shows the icon small, centred above the wordmark', /"icon":\[56,56\]/.test(startIcon) && /"centred":true/.test(startIcon) && /"above":true/.test(startIcon), startIcon);
  let windows = await poll('the main window on the X display', async () => {
    const all = await xWindows();
    return all.some((w) => isMainPage(w.url)) ? all : false;
  });
  const mainWindow = windows.find((w) => isMainPage(w.url));
  run('xdotool', ['windowactivate', '--sync', String(mainWindow.xid)], true);
  await delay(800);
  await checkWindow('the main window', mainWindow.xid, expected, wmClassWanted);
  shotRoot('01-start-window-and-panel');

  stage = 'About DSpatch';
  const openAbout = () =>
    client.main.ev(`(() => { const { Menu, BrowserWindow } = process.mainModule.require('electron'); const item = Menu.getApplicationMenu().getMenuItemById('dspatch-about'); if (!item) return false; const w = BrowserWindow.fromId(${String(mainWindow.id)}); item.click(undefined, w, w.webContents); return item.label; })()`);
  const dialogs = () => run('xdotool', ['search', '--name', '^About DSpatch$'], true).split('\n').filter((line) => /^\d+$/.test(line));
  check('Help > About DSpatch is in the menu', (await openAbout()) === 'About DSpatch');
  const [dialog] = await poll('the About DSpatch dialog on the X display', () => {
    const found = dialogs();
    return found.length > 0 ? found : false;
  }, 15_000);
  await delay(700);
  shotRoot('02-about');
  const geometry = run('xdotool', ['getwindowgeometry', dialog], true);
  note('the About dialog', geometry.replace(/\s+/g, ' '));
  const position = geometry.match(/Position: (\d+),(\d+)/);
  const size = geometry.match(/Geometry: (\d+)x(\d+)/);
  if (position && size) shotRoot('02-about-dialog', `${size[1]}x${size[2]}+${position[1]}+${position[2]}`);
  run('xdotool', ['key', '--window', dialog, 'Escape'], true);
  await poll('the dialog closed', () => dialogs().length === 0, 10_000).catch(() => undefined);

  stage = 'the review, walk and loop editor windows';
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  const diff = await openReview(main);
  await openPair(diff);
  const key = await poll('the review record', () => reviewKey(), 20_000);
  const walkFolder = path.join(profile, 'reviews', 'generated', key);
  fs.mkdirSync(walkFolder, { recursive: true });
  const step = (id, title, start, end) => ({ id, title, text: `What lines ${String(start)} to ${String(end)} add.`, refs: [{ path: BIG, side: 'target', start, end, role: 'walk', anchor: `value${String(start)} =` }] });
  fs.writeFileSync(
    path.join(walkFolder, 'icons.review.json'),
    `${JSON.stringify({ format: 'dspatch-review/1', title: 'The new file', repository: project, base, target, walks: [{ id: 'W1', title: 'The new file', question: 'What does it add?', steps: [step('W1.1', 'Values 1 to 9', 1, 9), step('W1.2', 'Values 20 to 24', 20, 24)] }] }, null, 2)}\n`,
  );
  await diff.ev('location.reload()');
  await diff.attach(60_000);
  await diff.until('the ongoing review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await diff.ev(`${q('pair-discussion')}!==null`)) !== true) await diff.click('pair-ongoing-open-0');
  await diff.until('the walk offered', `${q('pair-walks')}?.getAttribute('aria-disabled') === 'false'`, 30_000);
  await openWalk(diff);
  const editor = await main.ev('window.dspatch.openLoopEditor().then((answer) => JSON.stringify(answer))').catch((error) => String(error));
  note('the loop editor', String(editor).slice(0, 200));
  windows = await poll('the review, walk and loop editor windows', async () => {
    const all = await xWindows();
    return all.some(isDiffWindow) && all.some((w) => isWalkPage(w.url)) && all.some((w) => /loop editor/.test(w.title)) ? all : false;
  }, 30_000).catch(async () => xWindows());
  fs.writeFileSync(path.join(evidence, 'windows.json'), `${JSON.stringify(windows, null, 2)}\n`);
  const named = [
    ['the review (diff) window', windows.find(isDiffWindow)],
    ['the walk window', windows.find((w) => isWalkPage(w.url))],
    ['the loop editor window', windows.find((w) => /loop editor/.test(w.title))],
  ];
  for (const [what, window] of named) {
    if (window === undefined) {
      check(`${what} is open`, false);
      continue;
    }
    await checkWindow(what, window.xid, expected, wmClassWanted);
  }
  const walkWindow = named[1][1];
  if (walkWindow !== undefined) run('xdotool', ['windowactivate', '--sync', String(walkWindow.xid)], true);
  await delay(900);
  shotRoot('03-review-walk-and-editor-windows');
  shotRoot('04-panel', '1600x44+0+956');

  stage = 'the window switcher';
  // Openbox's Alt+Tab list draws each window with its icon while Alt is held.
  run('xdotool', ['keydown', 'alt'], true);
  run('xdotool', ['key', 'Tab'], true);
  await delay(900);
  shotRoot('05-window-switcher');
  run('xdotool', ['keyup', 'alt'], true);
  note('the window switcher is judged from 05-window-switcher.png');
}

const isDiffWindow = (w) => isDiffPage(w.url);

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
  for (const child of [owned.panel, owned.wm, owned.xvfb]) child?.kill('SIGTERM');
  if (profile !== '') {
    await endHost();
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, profile, project, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${results.some((result) => !result.ok) ? 'FAILED' : 'ALL PASSED'}: ${String(results.length)} checks; evidence ${evidence}`);
}
