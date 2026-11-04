// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-dock', `${String(process.pid)}-${String(Date.now())}`));
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

async function main() {
  stage = 'preflight';
  if (onWindows) check('PowerShell is here', run('powershell', ['-NoProfile', '-Command', 'echo ok'], true) === 'ok');
  else check('xdotool and import are here', run('sh', ['-c', 'command -v xdotool && command -v import'], true) !== '');
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  if (!onWindows && display === '') {
    const number = 90 + (process.pid % 50);
    display = `:${String(number)}`;
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' });
    await poll('Xvfb', () => fs.existsSync(`/tmp/.X11-unix/X${String(number)}`), 15_000);
    owned.wm = spawn('openbox', [], { env: { ...process.env, DISPLAY: display }, stdio: 'ignore' });
    await delay(800);
  }
  if (!onWindows) run('setxkbmap', ['-display', display, 'us'], true);
  note('the display', onWindows ? 'the Windows desktop' : `${display}; WM ${owned.wm === null ? 'already there' : 'openbox'}`);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-dock-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-dock-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  // A code file changes in the last commit, so the SIMULATED preparation proposes a code walk
  // (a Markdown file alone would give readings), and the diff is long enough to scroll.
  const lines = (count, text) => Array.from({ length: count }, (_, index) => text(index + 1)).join('\n');
  const versions = [
    { 'src/app.js': `export function greet(name) {\n  return 'Hello, ' + name;\n}\n`, 'notes.md': 'a start\n' },
    { 'src/app.js': `export function greet(name) {\n  return 'Hello, ' + name + '!';\n}\n\nexport function farewell(name) {\n  return 'Goodbye, ' + name;\n}\n`, 'notes.md': 'a start\nand a change\n' },
    { 'src/app.js': `export function greet(name) {\n  return 'Hello, ' + name + '!';\n}\n\nexport function farewell(name) {\n  return 'Goodbye, ' + name + '.';\n}\n\n${lines(120, (n) => `export const added${String(n)} = ${String(n)};`)}\n`, 'notes.md': 'a start\nand a change\nand one more\n' },
  ];
  for (const [index, files] of versions.entries()) {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(project, name), text);
    git('add', '.');
    git('commit', '-qm', `Commit ${String(index + 1)}`);
  }

  stage = 'the review and its discussion';
  const main = await launch('dock');
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
  await client.main.size(diffWindow.id, 1500, 900);
  await delay(300);
  // Every window at normal size to begin with, whatever an earlier run of this profile left.
  for (const w of await client.main.windows()) await client.main.menu('dspatch-zoom-reset', w.id).catch(() => undefined);
  await diff.click('pair-discussion');
  let panel = await poll('the discussion panel', panelView, 30_000);
  if (panel.docked) {
    // Left docked by an earlier run: to its own window, where this trial begins.
    await clickInPanel('panel-own-window');
    panel = await poll('the panel in its own window', async () => { const p = await panelView(); return p !== null && !p.docked ? p : false; }, 20_000);
  }
  await client.main.read(panel.view.contentsId, `document.fonts.ready.then(() => true)`);
  await client.main.menu('dspatch-zoom-in', panel.frame.id);
  await delay(500);
  panel = await panelView();
  check('the discussion opens in its own window, set to level 1 there', !panel.docked && panel.view.level === 1 && savedLevels()['review-panel'] === 1, JSON.stringify({ panel, saved: savedLevels() }));
  {
    const w = await activate(panel.frame.id);
    await delay(700);
    const seen = await roomSeen(w, panel.view, '01-own-window');
    check('the display shows the discussion in its own window (01-own-window.png)', seen.drawn, JSON.stringify(seen));
    check('the page says it is visible in its own window', (await client.main.visibilityOf(panel.view.contentsId)) === 'visible');
  }

  stage = 'docked in the diff window';
  await clickInPanel('panel-dock-diff');
  panel = await dockedIn(diffWindow.id, 'the panel docked in the diff window, with its room');
  check('docked, the panel takes the review\'s level 0 and keeps its own 1 saved', panel.view.level === 0 && savedLevels()['review-panel'] === 1, JSON.stringify({ panel, saved: savedLevels() }));
  const docked = await checkDocked(diffWindow.id, 'docked in the diff window', '02-docked-in-diff', 'typed while docked ');
  // The wheel and the keys, through the operating system, zoom the window and the discussion together.
  const composerPoint = (await client.main.pointOf(panel.view.contentsId, 'discussion-composer')).physical;
  await osWheel(composerPoint, -1);
  let now = await dockedReading(diffWindow.id);
  check('Control and a notch back over the docked discussion zoom the review and the discussion to -1 together', now.windowLevel === -1 && now.view.level === -1, JSON.stringify(now));
  await osWheel(composerPoint, 1);
  now = await dockedReading(diffWindow.id);
  check('a notch forward brings both back to 0', now.windowLevel === 0 && now.view.level === 0, JSON.stringify(now));
  await osKey('ctrl+minus');
  now = await dockedReading(diffWindow.id);
  check('Ctrl+- in the docked discussion zooms both to -1', now.windowLevel === -1 && now.view.level === -1 && (await composerValue(now.view.contentsId)) === 'typed while docked ', JSON.stringify(now));
  await osKey('ctrl+0');
  now = await dockedReading(diffWindow.id);
  check('Ctrl+0 brings both to normal size', now.windowLevel === 0 && now.view.level === 0, JSON.stringify(now));

  stage = 'the docked window resized and zoomed';
  const roomBefore = (await dockedReading(diffWindow.id)).view.bounds;
  await client.main.size(diffWindow.id, 1300, 760);
  panel = await poll('the room measured again after the resize', async () => { const p = await panelView(); return p !== null && p.docked && (p.view.bounds.height !== roomBefore.height || p.view.bounds.x !== roomBefore.x) ? p : false; }, 20_000);
  {
    const w = await activate(diffWindow.id);
    await delay(700);
    const seen = await roomSeen(w, panel.view, '03-docked-resized');
    check('after the window was resized, the room moved with it and the display shows the discussion there (03-docked-resized.png)', seen.drawn && panel.view.bounds.x + panel.view.bounds.width <= w.content.width + 1 && panel.view.bounds.y + panel.view.bounds.height <= w.content.height + 1, JSON.stringify({ before: roomBefore, after: panel.view.bounds, content: w.content, seen }));
  }
  await client.main.size(diffWindow.id, 1500, 900);
  await delay(600);
  for (const [levelWanted, name, steps] of [[2, '04-docked-at-2', ['dspatch-zoom-in', 'dspatch-zoom-in']], [-2, '05-docked-at-minus-2', ['dspatch-zoom-out', 'dspatch-zoom-out', 'dspatch-zoom-out', 'dspatch-zoom-out']]]) {
    for (const item of steps) await client.main.menu(item, diffWindow.id);
    await delay(900);
    const w = await activate(diffWindow.id);
    await delay(500);
    const reading = await dockedReading(diffWindow.id);
    const seen = await roomSeen(w, reading.view, name);
    check(`at level ${String(levelWanted)} the discussion follows, its room is inside the window, and the display shows it (${name}.png)`, reading.windowLevel === levelWanted && reading.view.level === levelWanted && seen.drawn && reading.view.bounds.x + reading.view.bounds.width <= w.content.width + 1 && reading.pageSays === 'visible', JSON.stringify({ reading, seen, content: w.content }));
  }
  await client.main.menu('dspatch-zoom-reset', diffWindow.id);
  await delay(500);

  stage = 'a question asked, and a draft left';
  panel = await panelView();
  {
    const composer = await client.main.pointOf(panel.view.contentsId, 'discussion-composer');
    await osClick(composer.physical);
    await client.main.read(panel.view.contentsId, `(() => { const f = document.querySelector('[data-ev="discussion-composer"]'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } return true; })()`);
    await osKey('End');
    await osType('What does greet return?');
    await osKey('Return');
    const turns = await poll('the question in the thread', async () => ((await turnCount(panel.view.contentsId)) ?? 0) >= 1, 30_000).then(() => turnCount(panel.view.contentsId));
    const answered = await poll('an answer', async () => client.main.read(panel.view.contentsId, `(document.querySelector('.rv-discussion-turn .rv-discussion-answer')?.textContent ?? '').length > 20`), 60_000).catch(() => false);
    note('the conversation before any move', `${String(turns)} turn(s); answer ${answered === true ? 'arrived' : 'not seen within 60 s'}`);
    await osClick(composer.physical);
    await osType('an unsent draft');
    check('a draft is left in the field', (await composerValue(panel.view.contentsId)) === 'an unsent draft', String(await composerValue(panel.view.contentsId)));
  }
  const turnsBefore = await turnCount(panel.view.contentsId);

  stage = 'the walk window';
  await activate(diffWindow.id);
  await diff.click('pair-prepare-walks');
  await diff.click('pair-walks-agent-start');
  let walkWindow = await poll('the walk window opened by the preparation', async () => (await client.main.windows()).find((w) => !w.destroyed && isWalkPage(w.url)) ?? false, 90_000).catch(() => null);
  if (walkWindow === null) {
    await diff.click('pair-walks');
    walkWindow = await windowShowing(isWalkPage, 'the walk window');
  }
  const walk = new Page(client.cdp, 'walk', isWalkPage);
  await walk.attach(60_000);
  await walk.until('the walk drawn', 'document.body.innerText.length > 0', 60_000);
  await client.main.size(walkWindow.id, 1500, 900);
  await client.main.menu('dspatch-zoom-in', walkWindow.id);
  await delay(600);
  walkWindow = await windowById(walkWindow.id);
  check('the walk window is open, set to level 1 so the move can be told from the diff window\'s 0', walkWindow.level === 1, JSON.stringify(walkWindow));

  stage = 'moved straight from the diff window to the walk window';
  await activate(diffWindow.id);
  await clickInPanel('panel-dock-walk');
  panel = await dockedIn(walkWindow.id, 'the panel docked in the walk window, with its room');
  check('the discussion is now a view of the walk window and of no other', (await client.main.windows()).filter((w) => w.views.some((v) => isPanelPage(v.url))).length === 1, JSON.stringify(await client.main.windows()));
  check('it follows the walk window\'s level 1', panel.view.level === 1, JSON.stringify(panel));
  check('the diff window keeps no room any more', (await diff.ev(`(()=>{const r=${q('panel-room')};return r===null||r.hidden})()`)) === true);
  const inWalk = await checkDocked(walkWindow.id, 'docked in the walk window after the direct move', '06-moved-to-walk', ' and more');
  check('the conversation and the unsent draft came along', (await turnCount(panel.view.contentsId)) === turnsBefore && (await composerValue(panel.view.contentsId)) === 'an unsent draft and more', JSON.stringify({ turns: await turnCount(panel.view.contentsId), turnsBefore, draft: await composerValue(panel.view.contentsId) }));
  {
    const w = await activate(diffWindow.id);
    await delay(700);
    const shot = await shotWindow(w, '06b-diff-after-move');
    note('the diff window after the move (06b-diff-after-move.png)', `the room it kept was ${JSON.stringify(docked.reading.view.bounds)}; now ${JSON.stringify(shot.rect)} of code`);
  }

  stage = 'moved back to the diff window';
  await clickInPanel('panel-dock-diff');
  panel = await dockedIn(diffWindow.id, 'the panel docked in the diff window again');
  check('back in the diff window it follows that window\'s 0', panel.view.level === 0, JSON.stringify(panel));
  await checkDocked(diffWindow.id, 'docked in the diff window again', '07-back-in-diff', ' again');
  check('the walk window keeps no room any more', (await walk.ev(`(()=>{const r=${q('panel-room')};return r===null||r.hidden})()`)) === true);

  stage = 'the diff window closed with the discussion in the walk window';
  await clickInPanel('panel-dock-walk');
  panel = await dockedIn(walkWindow.id, 'the panel docked in the walk window once more');
  await client.main.closeWindow(diffWindow.id);
  await poll('the diff window closed', async () => (await windowById(diffWindow.id)) === null, 30_000);
  diff.close();
  panel = await dockedIn(walkWindow.id, 'the panel still docked in the walk window');
  await checkDocked(walkWindow.id, 'in the walk window after the diff window closed', '08-walk-after-diff-closed', ' still here');
  check('the conversation is still there', (await turnCount(panel.view.contentsId)) === turnsBefore, String(await turnCount(panel.view.contentsId)));

  stage = 'undocked';
  await clickInPanel('panel-own-window');
  panel = await poll('the panel in its own window again', async () => { const p = await panelView(); return p !== null && !p.docked ? p : false; }, 20_000);
  check('undocked, the discussion is back at its own level 1, with the draft', panel.view.level === 1 && (await composerValue(panel.view.contentsId)) === 'an unsent draft and more again still here', JSON.stringify({ panel, draft: await composerValue(panel.view.contentsId) }));
  {
    const w = await activate(panel.frame.id);
    await delay(700);
    const seen = await roomSeen(w, panel.view, '09-own-window-again');
    check('the display shows it in its own window again (09-own-window-again.png)', seen.drawn, JSON.stringify(seen));
  }
  await clickInPanel('panel-dock-walk');
  panel = await dockedIn(walkWindow.id, 'docked in the walk window once more, for the end');
  await checkDocked(walkWindow.id, 'docked in the walk window from its own window', '10-docked-in-walk-again', '.');
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
