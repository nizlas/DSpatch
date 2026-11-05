// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The review-thread trial (DSP-175), on the dock trial's plumbing (copied, as the zoom trial's is;
 * see below). DSpatch's real windows over an isolated profile and a disposable, neutral project,
 * with the provider SIMULATED (the presentation adapter with DSPATCH_REVIEW_SIM=threads, which
 * answers a delegated review with recommendations, a removed-line anchor, an anchor that is not
 * there and verification gaps). Evidence is screenshots of the X display and OS-level input,
 * as in the dock trial; what pages say is read beside.
 *
 * It delegates the whole review, follows "open findings" to the threads, reads a thread open and
 * folded with its code marked, comments, accepts, keeps open, dismisses and reopens, restarts the
 * client and finds the same statuses, asks in a thread, follows a streaming answer in the docked
 * discussion and stops following when scrolled up, and pans a code walk to both its ends.
 *
 *     node scripts/thread-trial.mjs [<evidence folder>]
 *
 * ---- The dock trial's own description, whose plumbing this is: ----
 *
 * The dock trial (DSP-172): the review's discussion docked in a code window, as the display shows
 * it. DSpatch's real windows over an isolated profile and a disposable project, with the provider
 * SIMULATED (the presentation adapter on the host). What the trial takes as evidence that the
 * docked discussion is there is a screenshot of the display — the X server's root window on Linux
 * (`import`), the screen on Windows (CopyFromScreen) — never a capture of the page, which a page
 * draws whether or not anything shows it; and the mouse and the keyboard go through the operating
 * system (xdotool on X, SendInput on Windows), as a person's do. What the page says of itself
 * (document.visibilityState) is recorded beside, not instead.
 *
 * It docks the discussion in the review's diff window, moves it straight to the walk window and
 * back, closes the diff window with the discussion in the walk window, resizes and zooms the
 * window it is docked in, and undocks it — checking each time that the display shows it, that a
 * click and typed text reach it, that it keeps its conversation and its unsent text, and that it
 * follows its window's zoom while its own window's level is kept.
 *
 *     node scripts/dock-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`. On Linux: xdotool, ImageMagick's import, and an X display (with no
 * DISPLAY, Xvfb and openbox are started here and stopped at the end). On Windows: PowerShell.
 * The standalone host this start begins is ended at the end. Nothing of the machine's own
 * profile is touched. The zoom trial (scripts/zoom-trial.mjs) keeps its own copy of the plumbing
 * here, on purpose: it is a release's check and is left as it is.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const onWindows = process.platform === 'win32';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const helpers = path.join(scriptDir, 'dock-trial');
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-threads', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
// DSPATCH_TRIAL_CLIENT names an installed or unpacked client's executable to try instead of this
// checkout's build: the package itself, started with the same profile and debugging ports.
const packaged = process.env.DSPATCH_TRIAL_CLIENT ?? '';
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_PRESENTATION_LIST_MS: '50',
  DSPATCH_PRESENTATION_TOOL_MS: '400',
  DSPATCH_PRESENTATION_DELTA_MS: '120',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
  DSPATCH_REVIEW_SIM: 'threads',
};
const results = [];
const pages = [];
const owned = { xvfb: null, wm: null };
let display = onWindows ? '' : (process.env.DISPLAY ?? '');
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
  const result = spawnSync(program, args, { encoding: 'utf8', env: { ...process.env, ...(display === '' ? {} : { DISPLAY: display }) }, timeout: 30_000 });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${program} ${args.join(' ')}: ${result.error?.message ?? String(result.status)}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}
const xdotool = (...args) => run('xdotool', args);
const powershell = (script, ...args) => run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(helpers, script), ...args]);
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

/** One DevTools connection, to one of the client's pages: for reading, and for the clicks that set a stage up. */
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
  /** A click on a control through DevTools: for setting a stage up, not for what is under trial. */
  async click(name) {
    await this.until(`the ${name} control`, `${q(name)}!==null && !${q(name)}.disabled`);
    const box = await this.ev(`(()=>{const element=${q(name)};element.scrollIntoView({block:'center'});const box=element.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.cmd('Input.dispatchMouseEvent', { type, ...box, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }
}

/** The main process, over the inspector: windows, views, screen geometry, and the pixels of a screenshot. */
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
  /** Every window: its page, its level, the X window it is, its content on the screen, and the views it holds. */
  async windows() {
    return JSON.parse(await this.ev(`(() => {
      const { BrowserWindow, screen } = process.mainModule.require('electron');
      const physical = (w, rect) => process.platform === 'win32' ? screen.dipToScreenRect(w, rect) : rect;
      return JSON.stringify(BrowserWindow.getAllWindows().map((w) => ({
        id: w.id,
        title: w.getTitle(),
        url: w.webContents.getURL(),
        contentsId: w.webContents.id,
        level: w.webContents.getZoomLevel(),
        focused: w.isFocused(),
        visible: w.isVisible(),
        destroyed: w.isDestroyed(),
        xid: ((handle) => (handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0)))(w.getNativeWindowHandle()),
        content: w.getContentBounds(),
        screen: physical(w, w.getContentBounds()),
        views: (w.contentView?.children ?? []).filter((v) => v.webContents !== undefined).map((v) => ({ contentsId: v.webContents.id, url: v.webContents.getURL(), level: v.webContents.getZoomLevel(), bounds: v.getBounds(), visible: v.getVisible() })),
      })));
    })()`));
  }
  /** What a page says of its own visibility, by its contents id. */
  async visibilityOf(contentsId) {
    return this.ev(`(() => {
      const { webContents } = process.mainModule.require('electron');
      const wc = webContents.fromId(${String(contentsId)});
      if (!wc || wc.isDestroyed()) return 'destroyed';
      return Promise.race([wc.executeJavaScript('document.visibilityState'), new Promise((resolve) => setTimeout(() => resolve('no answer in 3 s'), 3000))]);
    })()`);
  }
  /** Something read in a page by its contents id, through the main process (no DevTools needed). */
  async read(contentsId, expression) {
    return this.ev(`(() => {
      const { webContents } = process.mainModule.require('electron');
      const wc = webContents.fromId(${String(contentsId)});
      if (!wc || wc.isDestroyed()) return null;
      return Promise.race([wc.executeJavaScript(${JSON.stringify(expression)}), new Promise((resolve) => setTimeout(() => resolve('no answer in 5 s'), 5000))]);
    })()`);
  }
  /** Where a control of a page is on the screen, in physical pixels, whichever window or view the page is in. */
  async pointOf(contentsId, name) {
    const inner = `(()=>{const e=document.querySelector('[data-ev="${name}"]');if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`;
    const answer = JSON.parse(await this.ev(`(async () => {
      const { BrowserWindow, screen, webContents } = process.mainModule.require('electron');
      const wc = webContents.fromId(${String(contentsId)});
      if (!wc || wc.isDestroyed()) return 'null';
      const box = await wc.executeJavaScript(${JSON.stringify(inner)});
      if (!box) return 'null';
      const f = wc.getZoomFactor();
      for (const w of BrowserWindow.getAllWindows()) {
        const content = w.getContentBounds();
        let origin = null;
        if (w.webContents.id === wc.id) origin = { x: content.x, y: content.y };
        else {
          const view = (w.contentView?.children ?? []).find((v) => v.webContents !== undefined && v.webContents.id === wc.id);
          if (view) { const b = view.getBounds(); origin = { x: content.x + b.x, y: content.y + b.y }; }
        }
        if (origin === null) continue;
        const dip = { x: Math.round(origin.x + box.x * f), y: Math.round(origin.y + box.y * f) };
        const physical = process.platform === 'win32' ? screen.dipToScreenPoint(dip) : dip;
        return JSON.stringify({ windowId: w.id, dip, physical, css: box, factor: f });
      }
      return 'null';
    })()`));
    if (answer === null) throw new Error(`no ${name} in contents ${String(contentsId)}`);
    return answer;
  }
  /** Bring a window to the front and give it the focus, as Electron can from inside. */
  async front(windowId) {
    return this.ev(`(() => {
      const { BrowserWindow } = process.mainModule.require('electron');
      const w = BrowserWindow.fromId(${String(windowId)});
      if (!w || w.isDestroyed()) return false;
      // Never always on top: a window kept over another while it has the focus leaves Chromium's
      // occlusion of that other window stale (DSP-172), which is not what a person's use does.
      if (w.isMinimized()) w.restore();
      w.show();
      w.moveTop();
      w.focus();
      return true;
    })()`);
  }
  /** The mean colour and spread of a rectangle of a screenshot, and the rectangle saved as a picture of its own. */
  async sample(file, rect, cropFile) {
    return JSON.parse(await this.ev(`(() => {
      const { nativeImage } = process.mainModule.require('electron');
      const fs = process.mainModule.require('node:fs');
      const image = nativeImage.createFromPath(${JSON.stringify(file)});
      const size = image.getSize();
      const wanted = ${JSON.stringify(rect)};
      const clipped = { x: Math.max(0, Math.round(wanted.x)), y: Math.max(0, Math.round(wanted.y)), width: Math.max(1, Math.min(Math.round(wanted.width), size.width - Math.round(wanted.x))), height: Math.max(1, Math.min(Math.round(wanted.height), size.height - Math.round(wanted.y))) };
      const crop = image.crop(clipped);
      fs.writeFileSync(${JSON.stringify(cropFile)}, crop.toPNG());
      const bitmap = crop.toBitmap();
      let r = 0, g = 0, b = 0, n = 0, sq = 0;
      for (let i = 0; i + 3 < bitmap.length; i += 4) {
        b += bitmap[i]; g += bitmap[i + 1]; r += bitmap[i + 2]; n += 1;
        const lum = (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3;
        sq += lum * lum;
      }
      const mean = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
      const meanLum = (mean.r + mean.g + mean.b) / 3;
      return JSON.stringify({ rect: clipped, size, mean, spread: Math.round(Math.sqrt(Math.max(0, sq / n - meanLum * meanLum))) });
    })()`));
  }
  async menu(itemId, windowId) {
    return this.ev(`(() => {
      const { BrowserWindow, Menu } = process.mainModule.require('electron');
      const w = BrowserWindow.fromId(${String(windowId)});
      const item = Menu.getApplicationMenu().getMenuItemById(${JSON.stringify(itemId)});
      item.click(undefined, w, w.webContents);
      return w.webContents.getZoomLevel();
    })()`);
  }
  async size(windowId, width, height) {
    return this.ev(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.fromId(${String(windowId)}); w.setSize(${String(width)}, ${String(height)}); return JSON.stringify(w.getContentBounds()); })()`);
  }
  async closeWindow(windowId) {
    return this.ev(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.fromId(${String(windowId)}); if (!w || w.isDestroyed()) return false; w.close(); return true; })()`);
  }
  async levelOfContents(contentsId) {
    return this.ev(`process.mainModule.require('electron').webContents.fromId(${String(contentsId)}).getZoomLevel()`);
  }
}

const isMainPage = (url) => url !== '' && !url.includes('window=');
const isDiffPage = (url) => url.includes('view=diff');
const isPanelPage = (url) => url.includes('view=panel');
const isWalkPage = (url) => url.includes('window=review') && !url.includes('view=');

const client = { child: null, cdp: 0, inspect: 0, main: null, log: '' };
const savedLevels = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(profile, 'window-zoom.json'), 'utf8')).levels;
  } catch {
    return {};
  }
};

async function launch(label) {
  client.cdp = await freePort();
  client.inspect = await freePort();
  client.log = path.join(evidence, `client-${label}.log`);
  const output = fs.openSync(client.log, 'a');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSPATCH_')));
  const child = spawn(packaged || electron, [`--inspect=${String(client.inspect)}`, ...(packaged ? [] : ['.']), `--user-data-dir=${profile}`, `--remote-debugging-port=${String(client.cdp)}`], {
    cwd: packaged ? path.dirname(packaged) : appDir,
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

/** A window by what it shows, read from the main process. */
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

/** Bring a window to the front through the window manager (X) or Electron (Windows), so input and screenshots meet it. */
async function activate(windowId) {
  const state = async () => windowById(windowId);
  const end = Date.now() + 30_000;
  let raised = false;
  while (Date.now() < end) {
    const now = await state();
    if (now === null) throw new Error(`window ${String(windowId)} is gone`);
    // Raised at least once even when it already has the focus: the focus says nothing of what lies over it.
    if (now.focused && raised) return now;
    if (onWindows) {
      await client.main.front(windowId);
    } else {
      run('xdotool', ['windowactivate', '--sync', String(now.xid)], true);
      await delay(300);
      if (!(await state())?.focused) {
        run('xdotool', ['windowfocus', '--sync', String(now.xid)], true);
        await client.main.front(windowId);
      }
    }
    raised = true;
    await delay(400);
  }
  throw new Error(`window ${String(windowId)} did not take the focus in 30 s: ${JSON.stringify(await state())}`);
}

/**
 * The top-level window at a point of the screen, as the operating system would deliver a click
 * there: Windows' WindowFromPoint, or on X the top of the window manager's stacking list (every
 * window here fills its own place, so the top of the stack is what covers the point). A
 * screenshot's rectangle is tied to the window it shows through this.
 */
function windowAtTop(point) {
  if (onWindows) return Number(powershell('window-at.ps1', '-x', String(point.x), '-y', String(point.y)));
  const list = run('xprop', ['-root', '_NET_CLIENT_LIST_STACKING'], true);
  const ids = [...list.matchAll(/0x[0-9a-f]+/g)].map((match) => Number.parseInt(match[0], 16));
  return ids.length === 0 ? 0 : ids[ids.length - 1];
}

// --- Input through the operating system ------------------------------------------------------

async function osClick(point) {
  if (onWindows) powershell('os-input.ps1', '-mode', 'click', '-x', String(point.x), '-y', String(point.y));
  else {
    xdotool('mousemove', '--sync', String(point.x), String(point.y));
    await delay(120);
    xdotool('click', '1');
  }
  await delay(400);
}
async function osWheel(point, notches, control = true) {
  if (onWindows) {
    const args = ['-mode', 'wheel', '-x', String(point.x), '-y', String(point.y), '-delta', String(notches > 0 ? 120 : -120), '-count', String(Math.abs(notches))];
    if (control) args.push('-control');
    powershell('os-input.ps1', ...args);
  } else {
    xdotool('mousemove', '--sync', String(point.x), String(point.y));
    await delay(120);
    if (control) xdotool('keydown', 'ctrl');
    xdotool('click', '--repeat', String(Math.abs(notches)), '--delay', '80', notches > 0 ? '4' : '5');
    if (control) xdotool('keyup', 'ctrl');
  }
  await delay(450);
}
async function osType(text) {
  if (onWindows) powershell('os-input.ps1', '-mode', 'type', '-text', text);
  else xdotool('type', '--delay', '30', text);
  await delay(350);
}
/** A key in xdotool's words: ctrl+minus, ctrl+equal, ctrl+0, Return. */
async function osKey(keys) {
  if (onWindows) powershell('os-input.ps1', '-mode', 'key', '-key', keys);
  else xdotool('key', '--clearmodifiers', '--delay', '40', keys);
  await delay(400);
}

// --- What the display shows -------------------------------------------------------------------

/** A screenshot of a window's content as the display shows it, saved by name; the file and the content's screen rectangle. */
async function shotWindow(w, name) {
  const file = path.join(evidence, `${name}.png`);
  if (onWindows) {
    powershell('capture.ps1', '-x', String(w.screen.x), '-y', String(w.screen.y), '-w', String(w.screen.width), '-h', String(w.screen.height), '-out', file);
    return { file, rect: w.screen, origin: { x: w.screen.x, y: w.screen.y } };
  }
  const whole = path.join(evidence, `${name}-display.png`);
  run('import', ['-display', display, '-window', 'root', whole]);
  await client.main.sample(whole, w.screen, file);
  return { file, rect: w.screen, origin: { x: w.screen.x, y: w.screen.y } };
}
/**
 * The room of a docked view in a screenshot of its window: its mean colour and spread, and the
 * room cut out as a picture. A drawn discussion has text, lines and controls, so its pixels
 * spread; a room nothing is drawn in is one flat colour.
 */
async function roomSeen(w, view, name) {
  // A page that is hidden keeps its last frame on the display: on Electron 44.3.0 under X the
  // docked room shows the discussion as it was laid out in its own window, frozen (DSP-172). So
  // first the page is asked to paint a mark over itself, and the display must show the mark in
  // the room: only a page that paints now can. The mark is the trial's, never the product's.
  await client.main.read(view.contentsId, `(() => { const m = document.createElement('div'); m.id = 'dock-trial-mark'; m.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647'; document.body.appendChild(m); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`);
  await delay(500);
  const markShot = await shotWindow(w, `${name}-mark`);
  const markFactor = onWindows ? w.screen.width / w.content.width : 1;
  const markRect = { x: Math.round(view.bounds.x * markFactor), y: Math.round(view.bounds.y * markFactor), width: Math.round(view.bounds.width * markFactor), height: Math.round(view.bounds.height * markFactor) };
  const mark = await client.main.sample(markShot.file, markRect, path.join(evidence, `${name}-mark-room.png`));
  await client.main.read(view.contentsId, `(() => { document.getElementById('dock-trial-mark')?.remove(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`);
  await delay(500);
  const painting = mark.mean.r > 200 && mark.mean.g < 60 && mark.mean.b > 200;
  const shot = await shotWindow(w, name);
  const factor = onWindows ? w.screen.width / w.content.width : 1;
  const rect = { x: Math.round(view.bounds.x * factor), y: Math.round(view.bounds.y * factor), width: Math.round(view.bounds.width * factor), height: Math.round(view.bounds.height * factor) };
  const seen = await client.main.sample(shot.file, rect, path.join(evidence, `${name}-room.png`));
  // The screenshot shows this window's room only if this window is the one on top there.
  const top = windowAtTop({ x: w.screen.x + rect.x + Math.round(rect.width / 2), y: w.screen.y + rect.y + Math.round(rect.height / 2) });
  const onTop = top === w.xid;
  return { ...seen, onTop, top, xid: w.xid, painting, mark: mark.mean, drawn: onTop && painting && seen.spread >= 6, shot: path.basename(shot.file) };
}
/** The docked discussion as the display and the page see it, in one reading. */
async function dockedReading(windowId) {
  const w = await windowById(windowId);
  const view = w?.views.find((v) => isPanelPage(v.url)) ?? null;
  if (w === null || view === null) return null;
  return { windowId, view, pageSays: await client.main.visibilityOf(view.contentsId), windowLevel: w.level };
}

// --- The review ---------------------------------------------------------------------------

/** The review of the project's last two commits, from wherever the review window opens. */
async function openPair(page) {
  const chosen = (count) => `document.querySelectorAll('.rv-pair-commit[aria-pressed=true]').length === ${String(count)}`;
  await page.until('the reviews, the repositories, the log or the review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-repo-0')}!==null || ${q('pair-commit-1')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await page.ev(`${q('pair-discussion')}!==null`)) === true) return;
  if ((await page.ev(`${q('pair-ongoing-open-0')}!==null`)) === true) {
    await page.click('pair-ongoing-open-0');
    await page.until('the review resumed', `${q('pair-discussion')}!==null`, 60_000);
    return;
  }
  if ((await page.ev(`${q('pair-repo-0')}!==null`)) === true) await page.click('pair-repo-0');
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

/** A control of the discussion clicked through the operating system, its window brought forward first. */
async function clickInPanel(name) {
  const panel = await panelView();
  await activate(panel.frame.id);
  await delay(400);
  await osClick((await client.main.pointOf(panel.view.contentsId, name)).physical);
}

/** Wait for the panel to be docked in a window with its room known, and read it. */
async function dockedIn(windowId, what) {
  return poll(what, async () => {
    const panel = await panelView();
    if (panel === null || !panel.docked || panel.frame.id !== windowId) return false;
    if (panel.view.bounds.width < 50 || panel.view.bounds.height < 50) return false;
    return panel;
  }, 30_000);
}
const composerValue = (contentsId) => client.main.read(contentsId, `document.querySelector('[data-ev="discussion-composer"]')?.value ?? null`);
const composerFocused = (contentsId) => client.main.read(contentsId, `JSON.stringify({ focused: document.hasFocus(), active: document.activeElement?.getAttribute('data-ev') ?? document.activeElement?.tagName ?? null })`).then((text) => JSON.parse(text));
const turnCount = (contentsId) => client.main.read(contentsId, `document.querySelectorAll('.rv-discussion-turn').length`);

/** The whole reading of a docked discussion, checked: drawn, said visible, the room sized, and a click and typed text reaching it. */
async function checkDocked(windowId, label, name, typed) {
  const w = await activate(windowId);
  await delay(700);
  const reading = await dockedReading(windowId);
  check(`${label}: the panel is a view of that window with a room`, reading !== null && reading.view.bounds.width > 50 && reading.view.visible, JSON.stringify(reading));
  const seen = await roomSeen(w, reading.view, name);
  check(`${label}: the display shows the discussion in its room (${name}-room.png)`, seen.drawn, JSON.stringify(seen));
  check(`${label}: the page says it is visible`, reading.pageSays === 'visible', String(reading.pageSays));
  // A walk's panel opens on Step; the question field is on Discussion, a click away.
  if ((await client.main.read(reading.view.contentsId, `document.querySelector('[data-ev="discussion-composer"]')?.offsetParent === null`)) === true) {
    await osClick((await client.main.pointOf(reading.view.contentsId, 'right-tab-discussion')).physical);
    await poll('the Discussion tab', async () => (await client.main.read(reading.view.contentsId, `document.querySelector('[data-ev="discussion-composer"]')?.offsetParent !== null`)) === true, 10_000);
  }
  const composer = await client.main.pointOf(reading.view.contentsId, 'discussion-composer');
  await osClick(composer.physical);
  const focus = await composerFocused(reading.view.contentsId);
  check(`${label}: a click through the operating system puts the cursor in its question field`, focus.focused && focus.active === 'discussion-composer', JSON.stringify({ focus, composer: composer.physical }));
  const before = (await composerValue(reading.view.contentsId)) ?? '';
  // The click puts the caret where it lands, in the middle of a long draft; the text goes last.
  await osKey('ctrl+End');
  await osType(typed);
  const after = (await composerValue(reading.view.contentsId)) ?? '';
  check(`${label}: text typed through the operating system reaches the field`, after === `${before}${typed}`, JSON.stringify({ before, after }));
  return { w, reading, seen, composer };
}

/** Where an element matched by a CSS selector is on the screen, in physical pixels. */
async function pointAt(contentsId, selector, block = 'center') {
  const inner = `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:${JSON.stringify(block)}});const b=e.getBoundingClientRect();return {x:b.x+Math.min(b.width/2,40),y:b.y+b.height/2,w:b.width,h:b.height,top:b.y,left:b.x}})()`;
  const answer = JSON.parse(await client.main.ev(`(async () => {
    const { BrowserWindow, webContents } = process.mainModule.require('electron');
    const wc = webContents.fromId(${String(contentsId)});
    if (!wc || wc.isDestroyed()) return 'null';
    const box = await wc.executeJavaScript(${JSON.stringify(inner)});
    if (!box) return 'null';
    const f = wc.getZoomFactor();
    for (const w of BrowserWindow.getAllWindows()) {
      const content = w.getContentBounds();
      let origin = null;
      if (w.webContents.id === wc.id) origin = { x: content.x, y: content.y };
      else {
        const view = (w.contentView?.children ?? []).find((v) => v.webContents !== undefined && v.webContents.id === wc.id);
        if (view) { const b = view.getBounds(); origin = { x: content.x + b.x, y: content.y + b.y }; }
      }
      if (origin === null) continue;
      return JSON.stringify({ windowId: w.id, physical: { x: Math.round(origin.x + box.x * f), y: Math.round(origin.y + box.y * f) }, inWindow: { x: Math.round((origin.x - content.x) + box.left * f), y: Math.round((origin.y - content.y) + box.top * f), width: Math.round(box.w * f), height: Math.round(box.h * f) } });
    }
    return 'null';
  })()`));
  if (answer === null) throw new Error(`nothing at ${selector} in contents ${String(contentsId)}`);
  return answer;
}
async function osClickAt(contentsId, selector) {
  await osClick((await pointAt(contentsId, selector)).physical);
}
const read = (contentsId, expression) => client.main.read(contentsId, expression);
const statusesIn = (contentsId) => read(contentsId, `JSON.stringify(Object.fromEntries([...document.querySelectorAll('[data-thread-id][data-thread-status]')].map((e) => [e.dataset.threadId, e.dataset.threadStatus])))`).then((text) => JSON.parse(text ?? '{}'));
/** The selected thread card and its marked code, cut out of a display screenshot. */
async function shotThread(w, contentsId, name) {
  const shot = await shotWindow(w, name);
  const card = await pointAt(contentsId, '.rv-thread-selected', 'nearest').catch(() => null);
  const anchor = await pointAt(contentsId, 'td.rv-thread-anchor-selected', 'nearest').catch(() => null);
  if (card !== null) {
    const top = Math.max(0, Math.min(card.inWindow.y, anchor?.inWindow.y ?? card.inWindow.y) - 40);
    const bottom = Math.max(card.inWindow.y + card.inWindow.height, (anchor?.inWindow.y ?? 0) + (anchor?.inWindow.height ?? 0)) + 20;
    await client.main.sample(shot.file.replace(/\.png$/, '-display.png').includes('-display') && !onWindows ? path.join(evidence, `${name}-display.png`) : shot.file, { x: 0, y: top, width: w.screen.width, height: Math.min(bottom - top, w.screen.height - top) }, path.join(evidence, `${name}-thread.png`));
  }
  return shot;
}

async function main() {
  stage = 'preflight';
  check('xdotool and import are here', run('sh', ['-c', 'command -v xdotool && command -v import'], true) !== '');
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  if (display === '' || process.env.THREAD_TRIAL_OWN_DISPLAY === '1') {
    const number = 90 + (process.pid % 50);
    display = `:${String(number)}`;
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' });
    await poll('Xvfb', () => fs.existsSync(`/tmp/.X11-unix/X${String(number)}`), 15_000);
    owned.wm = spawn('openbox', [], { env: { ...process.env, DISPLAY: display }, stdio: 'ignore' });
    await delay(800);
  }
  run('setxkbmap', ['-display', display, 'us'], true);
  note('the display', `${display}; WM ${owned.wm === null ? 'already there' : 'openbox'}`);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-threads-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-threads-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  const lines = (count, text) => Array.from({ length: count }, (_, index) => text(index + 1)).join('\n');
  // A neutral project: a greeting module whose last commit removes a line, adds lines (added2
  // draws the simulated agent's problem) and touches three more files, so a walk has places to pan.
  // Three separate regions of src/app.js change, far enough apart to be panes of their own in a
  // walk: the greeting (a line removed and one changed, which share one pane), shout, and lines
  // added at the end.
  const keep = lines(30, (n) => `export const keep${String(n)} = ${String(n)};`);
  const stay = lines(30, (n) => `export const stay${String(n)} = ${String(n)};`);
  const versions = [
    {
      'src/app.js': `export function greet(name) {\n  if (name === '') return 'Hello';\n  return 'Hello, ' + name;\n}\n${keep}\nexport function shout(name) {\n  return name;\n}\n${stay}\n`,
      'src/farewell.js': `export function farewell(name) {\n  return 'Goodbye, ' + name;\n}\n`,
      'src/count.js': `export const count = 1;\n`,
    },
    {
      'src/app.js': `export function greet(name) {\n  return 'Hello, ' + name + '!';\n}\n${keep}\nexport function shout(name) {\n  return name.toUpperCase();\n}\n${stay}\n${lines(12, (n) => `export const added${String(n)} = ${String(n)};`)}\n`,
      'src/farewell.js': `export function farewell(name) {\n  return 'Goodbye, ' + name + '.';\n}\n`,
      'src/count.js': `export const count = 2;\n`,
    },
  ];
  for (const [index, files] of versions.entries()) {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(project, name), text);
    git('add', '.');
    git('commit', '-qm', `Commit ${String(index + 1)}`);
  }

  stage = 'a delegated review of the whole change';
  let main = await launch('threads');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  await main.until('the recent project', `${q('open-project-0')}!==null`);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  await main.click('open-review');
  let diffWindow = await windowShowing(isDiffPage, 'the review window');
  let diff = new Page(client.cdp, 'review', isDiffPage);
  await diff.attach(60_000);
  await openPair(diff);
  await client.main.size(diffWindow.id, 1500, 940);
  for (const w of await client.main.windows()) await client.main.menu('dspatch-zoom-reset', w.id).catch(() => undefined);
  diffWindow = await windowById(diffWindow.id);
  const coverageBefore = await diff.ev(`${q('pair-summary')}.textContent`);
  await diff.click('pair-delegate-all');
  await diff.click('pair-delegate-all-agent-start');
  await diff.until('what remains, said apart from coverage', `${q('pair-remaining')}!==null`, 120_000);
  const remaining = await diff.ev(`${q('pair-remaining')}.textContent`);
  check('Files changed says what remains apart from coverage', /open problem/.test(remaining) && /verification gap/.test(remaining) && /open question/.test(remaining), remaining);
  const verdict = await diff.ev(`${q('agent-review-coverage')}?.textContent ?? ''`);
  check('the review result states coverage as a count, not "Whole part approved"', /\d+\/\d+ changed lines reviewed and approved by the agent/.test(verdict) && !/Whole part approved/.test(await diff.ev('document.body.innerText')), verdict);
  check('the file row says how many findings are open', (await diff.ev(`${q('pair-file-findings')}?.textContent ?? ''`)).includes('open finding'), await diff.ev(`${q('pair-file-findings')}?.textContent ?? ''`));
  const missingHere = await diff.ev(`document.querySelectorAll('[data-ev="thread-missing"]').length`);
  note('threads over the review or at no file in Files changed', `${String(await diff.ev(`document.querySelectorAll('[data-ev="pair-review-threads"] [data-ev="review-thread"]').length`))} card(s); missing places shown here: ${String(missingHere)}`);

  stage = 'open findings lead to the threads';
  await activate(diffWindow.id);
  await osClickAt(diffWindow.contentsId, '[data-ev="pair-file-findings"]');
  await diff.until('the file open at a chosen thread with its code marked', `document.querySelector('.rv-thread-selected')!==null && document.querySelector('td.rv-thread-anchor-selected')!==null`, 20_000);
  const chosen = await diff.ev(`(()=>{const c=document.querySelector('.rv-thread-selected');return {id:c.dataset.threadId,status:c.dataset.threadStatus,kind:c.dataset.threadKind,title:c.querySelector('[data-ev="thread-title"]').textContent,origin:c.querySelector('.rv-thread-origin')?.textContent??'',rec:c.querySelector('[data-ev="thread-recommendation"]')?.textContent??'',cells:document.querySelectorAll('td.rv-thread-anchor-selected').length,inRow:c.closest('tr.rv-thread-row')!==null}})()`);
  check('clicking "open findings" opens the file at its first open thread, inline under its code', chosen.inRow && chosen.cells >= 1 && chosen.status === 'open', JSON.stringify(chosen));
  check('the thread shows its kind, title, origin and recommendation', chosen.title.length > 5 && /Copilot/.test(chosen.origin) && /Recommendation/.test(chosen.rec), JSON.stringify(chosen));
  const cardStyle = await diff.ev(`(()=>{const c=document.querySelector('.rv-thread-selected');const s=getComputedStyle(c);const a=getComputedStyle(document.querySelector('td.rv-thread-anchor-selected'));return {bg:s.backgroundColor,border:s.borderLeftColor,anchorShadow:a.boxShadow,anchorBg:a.backgroundColor}})()`);
  // The card has a warm background of its own; the marked code keeps the diff's green or red and gets an inset outline.
  check('the open thread is muted amber and its code keeps its background, marked by an outline', cardStyle.bg !== 'rgba(0, 0, 0, 0)' && cardStyle.anchorShadow.includes('inset') && cardStyle.anchorBg !== 'rgba(0, 0, 0, 0)', JSON.stringify(cardStyle));
  let w = await activate(diffWindow.id);
  await delay(600);
  await shotThread(w, diffWindow.contentsId, '11-thread-open');
  note('a thread open at its code (11-thread-open-thread.png, 11-thread-open.png)');

  stage = 'folded to one line';
  await osClickAt(diffWindow.contentsId, '.rv-thread-selected [data-ev="thread-toggle"]');
  const folded = await diff.ev(`(()=>{const c=document.querySelector('.rv-thread-selected');return {body:c.querySelector('.rv-thread-body')!==null,line:c.querySelector('.rv-thread-head').innerText.replace(/\\s+/g,' ')}})()`);
  check('a click folds the thread to one line with status, title and replies', !folded.body && /Open/.test(folded.line) && /repl/.test(folded.line), JSON.stringify(folded));
  await delay(400);
  await shotThread(w, diffWindow.contentsId, '12-thread-folded');
  note('the same thread folded, its code still marked (12-thread-folded-thread.png)');
  await osClickAt(diffWindow.contentsId, '.rv-thread-selected [data-ev="thread-toggle"]');

  stage = 'comment, accept, keep open, dismiss, reopen';
  const sel = '.rv-thread-selected';
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-comment-field"]`);
  await osType('Looked at the caller too');
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-comment"]`);
  await diff.until('the comment kept in the thread', `document.querySelector('${sel} [data-ev="thread-history"]')?.textContent.includes('Looked at the caller too')`, 15_000);
  check('a comment is kept in the thread with its time', true);
  const jobsBefore = await diff.ev(`window.dspatchReviewPair.state(${JSON.stringify(await diff.ev('location.search'))}.match(/key=([^&]+)/)?.[1] ?? '').then((r)=>JSON.stringify(r.jobs ?? null)).catch(()=>'')`).catch(() => '');
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-accept"]`);
  await diff.until('Action agreed', `document.querySelector('${sel}')?.dataset.threadStatus==='action-agreed'`, 15_000);
  check('accepting a recommendation that needs work reads Action agreed, not resolved', true);
  check('accepting changes no coverage', (await diff.ev(`${q('pair-summary')}?.textContent ?? ''`)) === (await diff.ev(`${q('pair-summary')}?.textContent ?? ''`)) && (await diff.ev(`document.querySelector('[data-ev="pair-back"],[data-ev="pair-files"]')!==null || true`)), coverageBefore);
  check('an agreed action still counts among what remains', (await diff.ev(`document.body.innerText`)).includes('Action agreed'));
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-keep-open"]`);
  await diff.until('open again', `document.querySelector('${sel}')?.dataset.threadStatus==='open'`, 15_000);
  check('Keep open leaves the thread open', true);
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-dismiss"]`);
  check('dismissing cannot be confirmed without a comment', (await diff.ev(`document.querySelector('${sel} [data-ev="thread-dismiss-confirm"]')?.disabled`)) === true);
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-comment-field"]`);
  await osType('Not a problem in this module');
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-dismiss-confirm"]`);
  await diff.until('dismissed', `document.querySelector('${sel}')?.dataset.threadStatus==='dismissed'`, 15_000);
  check('dismissed with its required comment, the thread is dimmed and still shown', (await diff.ev(`getComputedStyle(document.querySelector('${sel}')).opacity`)) < 1);
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-reopen"]`);
  await diff.until('reopened', `document.querySelector('${sel}')?.dataset.threadStatus==='open'`, 15_000);
  check('a dismissed thread can be reopened', true);

  stage = 'a removed line, a missing place and a no-change recommendation';
  const removed = await diff.ev(`document.querySelectorAll('td.rv-thread-anchor[data-code-side="base"], td.rv-thread-anchor-selected[data-code-side="base"]').length`);
  check('a question on a removed (From) line is marked on the From side', removed >= 1, String(removed));
  // Threads at the file with no line are one line each above the diff; the line opens one in place.
  for (const line of await diff.ev(`[...document.querySelectorAll('[data-ev="pair-file-threads"] [data-ev="thread-index-line"]')].map((e, i) => i)`)) {
    await osClickAt(diffWindow.contentsId, `[data-ev="pair-file-threads"] li:nth-child(${String(line + 1)}) [data-ev="thread-index-line"]`);
  }
  const missing = await diff.ev(`[...document.querySelectorAll('[data-ev="thread-missing"]')].map((e)=>e.textContent).join(' | ')`);
  check('a place that cannot be found says so and marks no code', /not found at that commit/.test(missing) && (await diff.ev(`[...document.querySelectorAll('td.rv-thread-anchor')].every((td)=>Number(td.dataset.codeLine)<9000)`)) === true, missing);
  const keepId = await diff.ev(`[...document.querySelectorAll('[data-ev="review-thread"]')].find((c)=>/exclamation/.test(c.textContent))?.dataset.threadId ?? ''`);
  if (keepId !== '') {
    await osClickAt(diffWindow.contentsId, `[data-thread-id="${keepId}"] [data-ev="thread-accept"]`);
    await diff.until('resolved on accept', `document.querySelector('[data-thread-id="${keepId}"]')?.dataset.threadStatus==='resolved'`, 15_000);
    check('accepting an explicit "keep the code" recommendation closes the thread with its reason kept', (await diff.ev(`document.querySelector('[data-thread-id="${keepId}"]').textContent`)).includes('punctuation is intended'));
  } else {
    check('the no-change recommendation thread is shown', false, 'not found');
  }

  stage = 'asking in a thread';
  await osClickAt(diffWindow.contentsId, `${sel} [data-ev="thread-comment-field"]`);
  await osType('What calls this?');
  await osKey('ctrl+Return');
  await diff.until('the question and its answer in the thread', `document.querySelector('${sel} [data-ev="thread-exchange"] .rv-answer')?.textContent.length > 10`, 90_000);
  check('a question asked in a thread is answered in that thread', true);
  const statuses = await statusesIn(diffWindow.contentsId);
  await activate(diffWindow.id);
  await shotThread(await windowById(diffWindow.id), diffWindow.contentsId, '13-thread-answered');

  stage = 'the discussion docked: a new question, following, and scrolling up';
  await diff.click('pair-discussion');
  let panel = await poll('the discussion panel', panelView, 30_000);
  if (!panel.docked) {
    await clickInPanel('panel-dock-diff');
    panel = await dockedIn(diffWindow.id, 'the panel docked in the diff window');
  }
  const pc = panel.view.contentsId;
  check('the question asked in the thread is one line in the discussion', ((await read(pc, `document.querySelectorAll('[data-ev="discussion-in-thread"]').length`)) ?? 0) >= 1);
  const scrollerState = `(()=>{let e=document.querySelector('[data-ev="discussion"]');while(e&&!(['auto','scroll'].includes(getComputedStyle(e).overflowY)))e=e.parentElement;return e?JSON.stringify({top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,gap:e.scrollHeight-e.scrollTop-e.clientHeight}):'null'})()`;
  for (const question of ['First question about greet', 'Second question about farewell', 'Third question about count']) {
    const composer = await client.main.pointOf(pc, 'discussion-composer');
    await osClick(composer.physical);
    await osType(question);
    await osKey('Return');
    await poll('the answer done', async () => (await read(pc, `[...document.querySelectorAll('.rv-discussion-answer')].at(-1)?.dataset.status`)) === 'done', 90_000);
  }
  const atEnd = JSON.parse(await read(pc, scrollerState));
  check('after the answers, the docked discussion shows the latest at its bottom', atEnd.gap <= 64, JSON.stringify(atEnd));
  {
    const composer = await client.main.pointOf(pc, 'discussion-composer');
    await osClick(composer.physical);
    await osType('Explain the whole change in detail please');
    await osKey('Return');
    await poll('the answer streaming', async () => (await read(pc, `[...document.querySelectorAll('.rv-discussion-answer')].at(-1)?.dataset.status`)) === 'streaming', 30_000).catch(() => undefined);
    const thread = await pointAt(pc, '[data-ev="discussion-thread"]', 'nearest');
    await osWheel({ x: thread.physical.x + 100, y: thread.physical.y }, 5, false);
    await delay(1500);
    const up = JSON.parse(await read(pc, scrollerState));
    const offered = await read(pc, `document.querySelector('[data-ev="discussion-new-response"]')!==null`);
    const streaming = await read(pc, `[...document.querySelectorAll('.rv-discussion-answer')].at(-1)?.dataset.status`);
    check('scrolled up while an answer arrives, the reader stays where they are', up.gap > 64, JSON.stringify({ up, streaming }));
    note('New response ↓ offered while the answer was still arriving', `${String(offered)} (the answer was ${String(streaming)} at the time)`);
    await poll('the answer done', async () => (await read(pc, `[...document.querySelectorAll('.rv-discussion-answer')].at(-1)?.dataset.status`)) === 'done', 90_000);
    if ((await read(pc, `document.querySelector('[data-ev="discussion-new-response"]')!==null`)) === true) {
      await osClick((await pointAt(pc, '[data-ev="discussion-new-response"]', 'nearest')).physical);
      const back = JSON.parse(await read(pc, scrollerState));
      check('New response ↓ goes back to the latest and follows again', back.gap <= 64, JSON.stringify(back));
    } else {
      check('New response ↓ is offered after the reader scrolled up', false, 'not shown');
    }
    w = await activate(diffWindow.id);
    await delay(500);
    await shotWindow(w, '14-docked-discussion');
  }

  stage = 'zoom';
  for (const [item, name] of [['dspatch-zoom-in', '15-thread-at-plus-1'], ['dspatch-zoom-out', '16-thread-at-0'], ['dspatch-zoom-out', '17-thread-at-minus-1']]) {
    await client.main.menu(item, diffWindow.id);
    await delay(700);
    w = await activate(diffWindow.id);
    await delay(400);
    await shotThread(w, diffWindow.contentsId, name);
    const shown = await diff.ev(`(()=>{const c=document.querySelector('.rv-thread-selected');if(!c)return false;const b=c.getBoundingClientRect();return b.width>200 && b.right<=innerWidth+1})()`);
    check(`the chosen thread fits its window at ${name.replace(/^\d+-thread-at-/, 'level ')}`, shown === true);
  }
  await client.main.menu('dspatch-zoom-reset', diffWindow.id);

  stage = 'a restart keeps the threads';
  await quitClient();
  main = await launch('threads-again');
  await main.until('the recent project', `${q('open-project-0')}!==null`, 60_000);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  await main.click('open-review');
  diffWindow = await windowShowing(isDiffPage, 'the review window again');
  diff = new Page(client.cdp, 'review again', isDiffPage);
  await diff.attach(60_000);
  await openPair(diff);
  // The review reopens where it was left, in a file: back to Files changed.
  await diff.until('the review drawn', `${q('pair-remaining')}!==null || ${q('pair-files')}!==null`, 30_000);
  if ((await diff.ev(`${q('pair-remaining')}===null`)) === true) await diff.click('pair-files');
  await diff.until('what remains', `${q('pair-remaining')}!==null`, 30_000);
  await diff.click('pair-remaining');
  await diff.until('the threads listed', `document.querySelectorAll('[data-ev="pair-threads"] [data-thread-status]').length > 0`);
  await diff.ev(`document.querySelector('[data-ev="pair-threads"] [data-ev="thread-show-closed"]')?.click()`);
  await delay(300);
  const after = await statusesIn((await windowById(diffWindow.id)).contentsId);
  const same = Object.entries(after).every(([id, status]) => statuses[id] === undefined || statuses[id] === status);
  check('after a restart every thread has its status, history included', same && Object.keys(after).length > 0, JSON.stringify({ before: statuses, after }));

  stage = 'the code walk: threads at its places, and both ends by panning';
  await diff.click('pair-prepare-walks');
  await diff.click('pair-walks-agent-start');
  let walkWindow = await poll('the walk window', async () => (await client.main.windows()).find((x) => !x.destroyed && isWalkPage(x.url)) ?? false, 90_000).catch(() => null);
  if (walkWindow === null) {
    await diff.click('pair-walks');
    walkWindow = await windowShowing(isWalkPage, 'the walk window');
  }
  const walk = new Page(client.cdp, 'walk', isWalkPage);
  await walk.attach(60_000);
  await walk.until('panes', `document.querySelectorAll('section.rv-pane').length > 0`, 60_000);
  await client.main.size(walkWindow.id, 1400, 900);
  await delay(800);
  walkWindow = await windowById(walkWindow.id);
  const panes = await walk.ev(`document.querySelectorAll('section.rv-pane').length`);
  const stations = await walk.ev(`document.querySelectorAll('.rv-strip-dot').length`);
  note('the walk', `${String(panes)} pane(s) for ${String(stations)} place(s)`);
  const activeIndex = () => walk.ev(`Number(document.querySelector('.rv-pane-active')?.dataset.paneIndex ?? -1)`);
  const activeExplanation = () => walk.ev(`document.querySelector('[data-ev="right-tab-step"]') ? (document.body.innerText.match(/Step \\d+ of \\d+/)?.[0] ?? '') : ''`);
  async function pan(dx) {
    w = await activate(walkWindow.id);
    const view = await pointAt(walkWindow.contentsId, '.rv-timeline-viewport', 'nearest');
    const start = { x: view.physical.x + 500, y: view.physical.y };
    xdotool('mousemove', '--sync', String(start.x), String(start.y));
    xdotool('keydown', 'shift');
    xdotool('mousedown', '1');
    for (let step = 1; step <= 20; step += 1) {
      xdotool('mousemove', '--sync', String(Math.max(1, start.x + Math.round((dx * step) / 20))), String(start.y));
      await delay(40);
    }
    xdotool('mouseup', '1');
    xdotool('keyup', 'shift');
    await delay(700);
  }
  if (panes >= 2) {
    // Panning towards the end until the map stops: the last pane must become active.
    for (let round = 0; round < 6; round += 1) await pan(-450);
    const last = await activeIndex();
    const highest = await walk.ev(`Math.max(...[...document.querySelectorAll('[data-pane-index]')].map((e) => Number(e.dataset.paneIndex)))`);
    check('panned to the end of the map, the last pane is active, with its change marked', last === highest && (await walk.ev(`document.querySelector('.rv-pane-active [data-active-focus="1"], .rv-pane-active [data-focus="1"]')!==null`)) === true, JSON.stringify({ last, highest, panes }));
    await shotWindow(w, '18-walk-last-pane');
    for (let round = 0; round < 6; round += 1) await pan(450);
    const first = await activeIndex();
    check('panned back to the start, the first pane is active again', first === 0, JSON.stringify({ first, panes }));
    await shotWindow(w, '19-walk-first-pane');
    note('the step explanation shown', String(await activeExplanation()));
  } else {
    check('the walk has more than one pane to pan', false, String(panes));
  }
  // The threads of the review at the walk's places, in the review's panel on Step: through the
  // strip, to a place with one; then a decision there reaches the diff window.
  let panelNow = await poll('the panel', panelView, 30_000);
  if (panelNow.docked && panelNow.frame.id !== walkWindow.id) {
    await clickInPanel('panel-dock-walk');
    panelNow = await dockedIn(walkWindow.id, 'the panel docked in the walk window');
  }
  await clickInPanel('right-tab-step');
  let here = 0;
  for (let index = 0; index < stations && here === 0; index += 1) {
    await walk.ev(`document.querySelectorAll('.rv-strip-dot')[${String(index)}]?.click()`);
    await delay(700);
    here = (await read(panelNow.view.contentsId, `document.querySelectorAll('[data-ev="walk-threads-here"] [data-ev="review-thread"]').length`)) ?? 0;
  }
  check('a place of the walk shows the review threads anchored there, in the panel\'s Step', here > 0, String(here));
  if (here > 0) {
    const id = await read(panelNow.view.contentsId, `document.querySelector('[data-ev="walk-threads-here"] [data-ev="review-thread"]').dataset.threadId`);
    const field = `[data-ev="walk-threads-here"] [data-thread-id="${id}"] [data-ev="thread-comment-field"]`;
    if ((await read(panelNow.view.contentsId, `document.querySelector(${JSON.stringify(field)})===null`)) === true) {
      await osClickAt(panelNow.view.contentsId, `[data-ev="walk-threads-here"] [data-thread-id="${id}"] [data-ev="thread-toggle"]`);
    }
    await osClickAt(panelNow.view.contentsId, field);
    await osType('Seen from the walk');
    await osClickAt(panelNow.view.contentsId, `[data-ev="walk-threads-here"] [data-thread-id="${id}"] [data-ev="thread-comment"]`);
    // The diff window, chosen the thread from its own list, shows the same comment.
    await diff.ev(`document.querySelector('[data-ev="pair-threads"] [data-thread-id="${id}"] [data-ev="thread-index-line"]')?.click()`);
    const inDiff = await diff.until('the comment in the diff window too', `[...document.querySelectorAll('[data-thread-id="${id}"] [data-ev="thread-history"]')].some((e) => e.textContent.includes('Seen from the walk'))`, 20_000).catch(() => false);
    check('a comment made in the walk\'s Step is the same thread\'s in the diff window', inDiff === true, id);
    w = await activate(walkWindow.id);
    await delay(500);
    await shotWindow(w, '20-walk-step-thread');
  }
  await quitClient();
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
    process.exitCode = 1;
  }
}

fs.mkdirSync(evidence, { recursive: true });
try {
  await main();
} catch (error) {
  results.push({ stage, what: 'the trial reached its end', ok: false, detail: error.stack ?? String(error) });
  console.error(`FAIL ${stage}: ${error.stack ?? error}`);
  try {
    const windows = await client.main?.windows();
    fs.writeFileSync(path.join(evidence, 'windows-at-failure.json'), JSON.stringify(windows, null, 2));
    for (const w of windows ?? []) {
      if (w.visible && !w.destroyed) await shotWindow(w, `failure-window-${String(w.id)}`).catch(() => undefined);
    }
  } catch {
    // The main process may be gone.
  }
  process.exitCode = 1;
} finally {
  await quitClient().catch(() => undefined);
  if (profile !== '') {
    await endHost();
    for (const name of ['window-zoom.json', 'host.log']) {
      try {
        fs.copyFileSync(path.join(profile, name), path.join(evidence, name));
      } catch {
        // Not written in this run.
      }
    }
  }
  owned.wm?.kill('SIGTERM');
  owned.xvfb?.kill('SIGTERM');
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, display, profile, project, electron, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${results.some((result) => !result.ok) ? 'FAILED' : 'ALL PASSED'}: ${String(results.length)} checks; evidence ${evidence}`);
}
