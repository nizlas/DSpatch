// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The walk loop trial (DSP-189), on the walk trial's plumbing (scripts/walk-trial.mjs, which has it
 * from the profile, thread and dock trials). DSpatch's real windows over an isolated profile and a
 * disposable project holding the synthetic connect case of tests/support/synthetic-walks.ts; the
 * provider SIMULATED (the presentation adapter, which answers the planner, the writer and the
 * reviewer). Evidence is screenshots and what the pages say.
 *
 * It checks the new user flow: the picker offers how to prepare with one call chosen, the loop can
 * be chosen and started, the job line names the loop and says what it is doing, the walks open
 * like any other, the run's trace is in the review window closed until asked and then shows the
 * reviewer's verdict, the journal and every prompt and answer whole, the discussion receives
 * nothing, and the run record is on disk under the review. What it proves is the product's
 * handling with simulated answers, never what a real model writes.
 *
 *     node scripts/walk-loop-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`. On Linux: xdotool, ImageMagick's import, and an X display (with no
 * DISPLAY, Xvfb and openbox are started here and stopped at the end).
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-walk-loop', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
// DSPATCH_TRIAL_CLIENT names an installed or unpacked client's executable to try instead of this
// checkout's build: the package itself, started with the same profile and debugging ports.
const packaged = process.env.DSPATCH_TRIAL_CLIENT ?? '';
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_PRESENTATION_LIST_MS: '50',
  DSPATCH_PRESENTATION_TOOL_MS: '400',
  DSPATCH_PRESENTATION_DELTA_MS: '60',
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
  if ((await page.ev(`${q('pair-repo-0')}!==null`)) === true) {
    // The workspace holds the reviewed project and, inside it, the library: the project is chosen by its folder name.
    const which = await page.ev(`[...document.querySelectorAll('[data-ev^="pair-repo-"]')].find((e) => e.textContent.includes(${JSON.stringify(path.basename(project))}) && !e.textContent.includes('count-lib'))?.dataset.ev ?? 'pair-repo-0'`);
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
  // Measured a moment after the scroll (a timer, not an animation frame: a window behind another gets
  // no frames), and with what the page finds at the point: a click through the operating system lands
  // on the element only when the page says the element is there (`hit`).
  const inner = `(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;${block === null ? '' : `e.scrollIntoView({block:${JSON.stringify(block)}});`}await new Promise((r)=>setTimeout(r,60));const b=e.getBoundingClientRect();const x=b.x+Math.min(b.width/2,40),y=b.y+b.height/2;const at=document.elementFromPoint(x,y);return {x,y,w:b.width,h:b.height,top:b.y,left:b.x,hit:at!==null&&(at===e||e.contains(at))}})()`;
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
      return JSON.stringify({ windowId: w.id, hit: box.hit === true, physical: { x: Math.round(origin.x + box.x * f), y: Math.round(origin.y + box.y * f) }, inWindow: { x: Math.round((origin.x - content.x) + box.left * f), y: Math.round((origin.y - content.y) + box.top * f), width: Math.round(box.w * f), height: Math.round(box.h * f) } });
    }
    return 'null';
  })()`));
  if (answer === null) throw new Error(`nothing at ${selector} in contents ${String(contentsId)}`);
  return answer;
}
async function osClickAt(contentsId, selector) {
  let at = await pointAt(contentsId, selector);
  // The layout may still be settling after a change: measured again until the element is at its point.
  for (let attempt = 0; attempt < 4 && !at.hit; attempt += 1) {
    await delay(300);
    at = await pointAt(contentsId, selector);
  }
  await osClick(at.physical);
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


// --- DSP-175 completion: helpers ----------------------------------------------------------------

const DISCUSSION_SCROLLER = `(()=>{let e=document.querySelector('[data-ev="discussion"]');while(e&&!(['auto','scroll'].includes(getComputedStyle(e).overflowY)))e=e.parentElement;return e?JSON.stringify({top:Math.round(e.scrollTop),height:e.scrollHeight,client:e.clientHeight,gap:Math.round(e.scrollHeight-e.scrollTop-e.clientHeight)}):'null'})()`;
const lastAnswerStatus = (contentsId) => read(contentsId, `[...document.querySelectorAll('.rv-discussion-answer')].at(-1)?.dataset.status ?? ''`);

/** Select a paragraph's text with a real triple click, as a reader does. */
async function selectText(contentsId, selector) {
  const at = await pointAt(contentsId, selector, 'center');
  if (onWindows) {
    for (let i = 0; i < 3; i += 1) powershell('os-input.ps1', '-mode', 'click', '-x', String(at.physical.x), '-y', String(at.physical.y));
  } else {
    xdotool('mousemove', '--sync', String(at.physical.x), String(at.physical.y));
    await delay(120);
    xdotool('click', '--repeat', '3', '--delay', '90', '1');
  }
  await delay(600);
  return read(contentsId, `getSelection().toString()`);
}

/** Empty the discussion's question field with the keyboard. */
async function clearComposer(contentsId) {
  await poll('no turn in progress', async () => (await read(contentsId, `document.querySelector('[data-ev="discussion-stop"]')===null`)) === true, 90_000);
  await osClick((await pointAt(contentsId, '[data-ev="discussion-composer"]', null)).physical);
  await osKey('ctrl+a');
  await osKey('BackSpace');
}

/**
 * A question sent, its long answer streaming, the reader at the bottom, scrolling up, an
 * ordinary re-render, and New response ↓: in the discussion of `pc`, wherever it is shown.
 * `pageState` reads what else could scroll in the window, which must not move.
 */
async function streamingScroll(pc, label, pageState) {
  const state = async () => JSON.parse(await read(pc, DISCUSSION_SCROLLER));
  await poll(`${label}: no turn in progress`, async () => (await read(pc, `document.querySelector('[data-ev="discussion-stop"]')===null`)) === true, 90_000);
  const pageBefore = await pageState();
  const turnsBefore = await turnCount(pc);
  await clearComposer(pc);
  await osType(`${label}: walk me through the whole change`);
  await osKey('Return');
  await poll(`${label}: the question shown`, async () => (await turnCount(pc)) > turnsBefore, 20_000);
  await delay(250);
  const sent = await state();
  check(`${label}: a sent question is scrolled into view at once`, sent.gap <= 64, JSON.stringify(sent));
  await poll(`${label}: the answer streaming`, async () => (await lastAnswerStatus(pc)) === 'streaming', 40_000);
  const samples = [];
  for (let i = 0; i < 4; i += 1) {
    await delay(450);
    samples.push(await state());
  }
  check(
    `${label}: at the bottom, the view follows the answer as it streams`,
    samples.at(-1).height > samples[0].height && samples.every((sample) => sample.gap <= 64) && (await lastAnswerStatus(pc)) === 'streaming',
    JSON.stringify(samples),
  );
  const area = await pointAt(pc, '.rv-discussion-composer-area', null);
  await osWheel({ x: area.physical.x + 80, y: area.physical.y - 160 }, 6, false);
  await delay(250);
  const upA = await state();
  await delay(1500);
  const upB = await state();
  const still = await lastAnswerStatus(pc);
  check(
    `${label}: scrolled up while it streams, the reading position stays as more arrives`,
    upA.gap > 64 && Math.abs(upB.top - upA.top) <= 2 && upB.height > upA.height && still === 'streaming',
    JSON.stringify({ upA, upB, still }),
  );
  const offered = await read(pc, `document.querySelector('[data-ev="discussion-new-response"]')!==null`);
  check(`${label}: New response ↓ is offered while the answer still arrives`, offered === true && still === 'streaming', JSON.stringify({ offered, still }));
  // An ordinary re-render: typing a draft redraws the discussion; the reader stays put.
  await osClick((await pointAt(pc, '[data-ev="discussion-composer"]', null)).physical);
  await osType('unsent draft');
  const typed = await state();
  check(`${label}: typing a draft re-renders without pulling the reader to the bottom`, Math.abs(typed.top - upB.top) <= 2 && typed.gap > 64, JSON.stringify({ upB, typed }));
  await w_shot(pc, `${label.replace(/\W+/g, '-')}-scrolled-up`);
  await osClick((await pointAt(pc, '[data-ev="discussion-new-response"]', null)).physical);
  await delay(200);
  const back = await state();
  await delay(900);
  const later = await state();
  const stillAfter = await lastAnswerStatus(pc);
  check(
    `${label}: New response ↓ goes back to the answer, and following resumes`,
    back.gap <= 64 && later.gap <= 64 && (stillAfter !== 'streaming' || later.height > back.height),
    JSON.stringify({ back, later, stillAfter }),
  );
  check(`${label}: the composer kept the unsent draft`, (await composerValue(pc))?.includes('unsent draft') === true);
  check(`${label}: only the discussion's own scroller moved`, (await pageState()) === pageBefore, JSON.stringify({ pageBefore, after: await pageState() }));
  await poll(`${label}: the answer done`, async () => (await lastAnswerStatus(pc)) === 'done', 90_000);
  await clearComposer(pc);
}

/** A screenshot of the window a contents is shown in. */
async function w_shot(contentsId, name) {
  const at = await pointAt(contentsId, 'body', null);
  const w = await activate(at.windowId);
  await delay(300);
  return shotWindow(w, name);
}

// --- DSP-176: the discussion record, read from disk -------------------------------------------

/** The review discussion's record files under the profile. */
function discussionFiles() {
  const found = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.discussion.json')) found.push(full);
    }
  };
  if (profile !== '' && fs.existsSync(profile)) walk(profile);
  return found;
}
/** The review discussion's questions and answers as saved: what was asked, in which profile, and what was sent. */
function discussionRecord() {
  return discussionFiles().flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).messages ?? []);
}
const questions = () => discussionRecord().filter((message) => message.role === 'question');
/** DSP-184: the step explanations' own store, read from disk. */
function explanationEntries() {
  const found = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.explanations.json')) found.push(full);
    }
  };
  if (profile !== '' && fs.existsSync(profile)) walk(profile);
  return found.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).entries ?? []);
}
/** A profile's explanation of a step, asked on arrival or by the person (Try again). */
const presents = () => explanationEntries().filter((entry) => entry.action === 'present');
/** Every model call the review made: the person's questions and the step explanations. */
const calls = () => questions().length + explanationEntries().length;
const doneFor = (stepId, profileId) => explanationEntries().some((entry) => entry.stepId === stepId && entry.profile === profileId && entry.status === 'done');
/** Presentations asked more than once for one step, profile and version of the step: a loop, or a retry. */
function repeatedPresents() {
  const counts = new Map();
  for (const message of presents()) {
    const key = `${message.stepId ?? '?'}:${message.profile ?? '?'}:${message.basis ?? '?'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([key, count]) => `${key} ×${String(count)}`);
}
/** The discussion records and the generated definitions, kept with the evidence: what was sent, and what was prepared. */
function saveRecords() {
  try {
    for (const file of discussionFiles()) {
      fs.copyFileSync(file, path.join(evidence, `record-${path.basename(file)}`));
      const explanations = file.replace(/\.discussion\.json$/, '.explanations.json');
      if (fs.existsSync(explanations)) fs.copyFileSync(explanations, path.join(evidence, `record-${path.basename(explanations)}`));
    }
    const generated = path.join(profile, 'reviews', 'generated');
    if (fs.existsSync(generated)) {
      for (const folder of fs.readdirSync(generated)) {
        for (const name of fs.readdirSync(path.join(generated, folder))) {
          if (name.endsWith('.review.json')) fs.copyFileSync(path.join(generated, folder, name), path.join(evidence, `definition-${name}`));
        }
      }
    }
  } catch {
    // Evidence only; the trial's result stands without it.
  }
}

/** The stable id behind a profile's name in either language (DSP-181). */
const PROFILE_IDS = { essentials: 'essens', essens: 'essens', standard: 'standard', teacher: 'pedagog', pedagog: 'pedagog' };

/** An option of a select chosen through the operating system: typed letters first, the arrow keys from the top if the list did not follow. */
async function chooseOption(contentsId, selector, value, typed) {
  const current = () => read(contentsId, `document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
  const select = await pointAt(contentsId, selector, 'nearest');
  await activate(select.windowId);
  await osClick(select.physical);
  await delay(300);
  await osKey('Escape');
  await osType(typed);
  await delay(250);
  const index = await read(contentsId, `[...document.querySelector(${JSON.stringify(selector)}).options].findIndex((o) => o.value === ${JSON.stringify(value)})`);
  for (let attempt = 0; attempt < 3 && (await current()) !== value; attempt += 1) {
    await osClick((await pointAt(contentsId, selector, null)).physical);
    await delay(400);
    await osKey('Home');
    for (let i = 0; i < index; i += 1) await osKey('Down');
    await osKey('Return');
    await delay(400);
  }
  await delay(500);
  return current();
}

/**
 * The computed typography of a paragraph under a selector, as the display renders it: a paragraph
 * followed by something when there is one, since the last paragraph of any text has no margin
 * below it by the same shared rule; its margin is reported as "(last)" and not compared.
 */
const paragraphStyle = (contentsId, selector) =>
  read(contentsId, `(()=>{const all=[...document.querySelectorAll(${JSON.stringify(selector)})];const p=all.find((e)=>e.nextElementSibling!==null)??all[0];if(!p)return null;const s=getComputedStyle(p);return JSON.stringify({lineHeight:s.lineHeight,fontSize:s.fontSize,fontFamily:s.fontFamily,marginBottom:p.nextElementSibling===null?'(last)':s.marginBottom})})()`);
/** Whether paragraphs read with one typography: the same line height, size and family, and the same margin wherever a margin applies. */
function sameTypography(...styles) {
  const parsed = styles.map((style) => (style === null ? null : JSON.parse(style)));
  if (parsed.some((style) => style === null)) return false;
  const [first] = parsed;
  const margins = parsed.map((style) => style.marginBottom).filter((margin) => margin !== '(last)');
  return parsed.every((style) => style.lineHeight === first.lineHeight && style.fontSize === first.fontSize && style.fontFamily === first.fontFamily) && margins.every((margin) => margin === margins[0]);
}


async function main() {
  stage = 'preflight';
  check('the input and capture tools are here', onWindows || run('sh', ['-c', 'command -v xdotool && command -v import'], true) !== '');
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  if (!onWindows && (display === '' || process.env.WALK_TRIAL_OWN_DISPLAY === '1')) {
    const number = 90 + (process.pid % 50);
    display = `:${String(number)}`;
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' });
    await poll('Xvfb', () => fs.existsSync(`/tmp/.X11-unix/X${String(number)}`), 15_000);
    owned.wm = spawn('openbox', [], { env: { ...process.env, DISPLAY: display }, stdio: 'ignore' });
    await delay(800);
  }
  if (!onWindows) run('setxkbmap', ['-display', display, 'us'], true);
  note('the display', `${display || 'the desktop'}; WM ${owned.wm === null ? 'already there' : 'openbox'}`);
  check('the walk loop drawing and its roles are in this checkout', fs.existsSync(path.join(appDir, '..', 'docs', 'loop', 'graphs', 'dspatch-walk-loop.graph.json')) && fs.existsSync(path.join(appDir, '..', 'docs', 'loop', 'roles', 'review', 'walk-reviewer.role.md')));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-loop-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-loop-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  // The synthetic connect case of tests/support/synthetic-walks.ts (CONNECT_CASE), in neutral
  // invented code: a connection with retries, two outcomes and a callback deferred through a timer.
  const versions = [
    {
      'src/link.ts': [
        'export interface Transport {',
        '  open(address: string): Promise<boolean>;',
        '}',
        '',
        'export class Link {',
        '  constructor(private readonly transport: Transport) {}',
        '',
        '  async connect(address: string): Promise<boolean> {',
        '    return this.transport.open(address);',
        '  }',
        '}',
        '',
      ].join('\n'),
      'src/session.ts': ["import { Link } from './link';", '', 'export async function startSession(link: Link, address: string): Promise<void> {', '  await link.connect(address);', '}', ''].join('\n'),
    },
    {
      'src/link.ts': [
        'export interface Transport {',
        '  open(address: string): Promise<boolean>;',
        '}',
        '',
        "export type Outcome = 'connected' | 'gave-up';",
        '',
        'export class Link {',
        '  private attempts = 0;',
        '  private onSettled: ((outcome: Outcome) => void) | null = null;',
        '',
        '  constructor(private readonly transport: Transport, private readonly maxAttempts = 3) {}',
        '',
        '  whenSettled(callback: (outcome: Outcome) => void): void {',
        '    this.onSettled = callback;',
        '  }',
        '',
        '  async connect(address: string): Promise<Outcome> {',
        '    this.attempts = 0;',
        '    while (this.attempts < this.maxAttempts) {',
        '      this.attempts += 1;',
        '      const open = await this.transport.open(address);',
        '      if (open) {',
        "        this.settle('connected');",
        "        return 'connected';",
        '      }',
        '      await pause(this.attempts * 100);',
        '    }',
        "    this.settle('gave-up');",
        "    return 'gave-up';",
        '  }',
        '',
        '  private settle(outcome: Outcome): void {',
        '    const callback = this.onSettled;',
        '    if (callback !== null) {',
        '      setTimeout(() => callback(outcome), 0);',
        '    }',
        '  }',
        '}',
        '',
        'function pause(ms: number): Promise<void> {',
        '  return new Promise((resolve) => setTimeout(resolve, ms));',
        '}',
        '',
      ].join('\n'),
      'src/session.ts': [
        "import { Link } from './link';",
        '',
        'export async function startSession(link: Link, address: string, report: (text: string) => void): Promise<void> {',
        "  link.whenSettled((outcome) => report(outcome === 'connected' ? 'session ready' : 'offline mode'));",
        '  const outcome = await link.connect(address);',
        "  if (outcome === 'gave-up') {",
        "    report('retrying later');",
        '  }',
        '}',
        '',
      ].join('\n'),
    },
  ];
  for (const [index, files] of versions.entries()) {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(project, name), text);
    git('add', '.');
    git('commit', '-qm', `Commit ${String(index + 1)}`);
  }

  stage = 'the loop is chosen in the picker and prepares the walks of the synthetic case';
  const main = await launch('walk-loop');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  await main.until('the recent project', `${q('open-project-0')}!==null`);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  await main.click('open-review');
  const diffWindow = await windowShowing(isDiffPage, 'the review window');
  const diff = new Page(client.cdp, 'review', isDiffPage);
  await diff.attach(60_000);
  await openPair(diff);
  for (const w of await client.main.windows()) await client.main.menu('dspatch-zoom-reset', w.id).catch(() => undefined);
  await diff.click('pair-discussion');
  await poll('the panel before any walk', panelView, 30_000);
  await diff.click('pair-prepare-walks');
  await diff.until('the agent picker', `${q('pair-walks-agent-start')}!==null`, 15_000);
  check('the picker offers how to prepare, with one call chosen', (await diff.ev(`${q('pair-walks-agent-method')}?.value ?? null`)) === 'single', 'pair-walks-agent-method');
  await diff.ev(`(()=>{const s=${q('pair-walks-agent-method')};s.value='loop';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
  await delay(300);
  check('the planner, writer and reviewer loop is chosen', (await diff.ev(`${q('pair-walks-agent-method')}.value`)) === 'loop');
  await shotWindow(await windowById(diffWindow.id), '01-picker-loop');
  await diff.click('pair-walks-agent-start');
  await diff.until('the job line names the loop', `(${q('agent-job-walks')}?.textContent ?? '').includes('planner, writer and reviewer')`, 20_000);
  const activities = new Set();
  const seen = await poll('what the loop is doing', async () => {
    const text = await diff.ev(`${q('agent-job-walks-activity')}?.textContent ?? ''`);
    if (text) activities.add(text);
    return /Writing step|Planning the walks|reviewer/.test(text) ? text : false;
  }, 60_000);
  check('the window says what the loop is doing, step by step', /Writing step|Planning the walks|reviewer/.test(seen), seen);
  await shotWindow(await windowById(diffWindow.id), '02-running');
  let walkWindow = await poll('the walk window', async () => (await client.main.windows()).find((x) => !x.destroyed && isWalkPage(x.url)) ?? false, 180_000).catch(() => null);
  const activityList = [...activities];
  note('activities seen while it ran', activityList.join(' | '));
  if (walkWindow === null) {
    await diff.click('pair-walks');
    walkWindow = await windowShowing(isWalkPage, 'the walk window');
  }

  stage = 'the trace of the run in the review window, on request';
  await diff.until('the loop trace', `${q('pair-walk-loop')}!==null`, 30_000);
  const trace = JSON.parse(await diff.ev(`JSON.stringify({status:${q('pair-walk-loop')}.dataset.status,text:${q('pair-walk-loop')}.querySelector('summary').textContent,open:${q('pair-walk-loop')}.open})`));
  check('the trace says the loop delivered with no correction round (SIMULATED accept) and how many turns it took', trace.status === 'delivered' && /no correction round/.test(trace.text) && /provider turn/.test(trace.text) && !trace.open, JSON.stringify(trace));
  check('the trace is closed until asked', trace.open === false, JSON.stringify(trace));
  // Clicks are delivered inside the page: on a desktop where other windows cover DSpatch's, input through the operating system would land elsewhere.
  await diff.ev("document.querySelector('[data-ev=\"pair-walk-loop\"] > summary').click(); true");
  await diff.until('the trace opened', `${q('pair-walk-loop')}.open === true`, 10_000);
  const verdict = await diff.ev(`${q('pair-walk-loop-first')}?.textContent ?? ''`);
  check('the reviewer\'s verdict and assessment are shown, and named as an agent\'s', /SIMULATED review/.test(verdict) && /approves nothing of the code/.test(await diff.ev(`${q('pair-walk-loop')}.textContent`)), verdict.slice(0, 200));
  await diff.ev("document.querySelector('[data-ev=\"pair-walk-loop-record\"] > summary').click(); true");
  await diff.until('the record read', `${q('pair-walk-loop-replies')}!==null && Number(${q('pair-walk-loop-replies')}.dataset.count) >= 4`, 30_000);
  const replies = JSON.parse(await diff.ev(`JSON.stringify([...document.querySelectorAll('.rv-walk-loop-reply > summary')].map((e)=>e.textContent))`));
  check(
    'every exchange is listed: the planner, each step the writer wrote, the reviewer',
    replies.some((r) => /Plan the walks/.test(r)) && replies.filter((r) => /Write the steps/.test(r)).length >= 2 && replies.some((r) => /Review the walks/.test(r)),
    JSON.stringify(replies),
  );
  const journal = JSON.parse(await diff.ev(`JSON.stringify([...document.querySelectorAll('.rv-walk-loop-journal li')].map((e)=>e.textContent))`));
  check('the engine\'s journal is shown with the edges it took', journal.some((line) => /edge-taken/.test(line)) && journal.some((line) => /accepted/.test(line)), JSON.stringify(journal).slice(0, 400));
  await diff.ev("document.querySelector('.rv-walk-loop-reply > summary').click(); true");
  await diff.until('the first exchange opened', `document.querySelector('.rv-walk-loop-reply').open === true`, 10_000);
  const firstPrompt = await diff.ev(`document.querySelector('.rv-walk-loop-reply .rv-walk-loop-text')?.textContent ?? ''`);
  check('the planner\'s prompt is readable whole: its task header and its role', firstPrompt.startsWith('DSPATCH-REVIEW-TASK: plan-walks') && /## Your role: walk-planner/.test(firstPrompt), firstPrompt.slice(0, 120));
  await shotWindow(await windowById(diffWindow.id), '03-trace');

  stage = 'the walk opens and reads like any other, and the discussion is untouched';
  const walk = new Page(client.cdp, 'walk', isWalkPage);
  await walk.attach(60_000);
  await walk.until('panes', `document.querySelectorAll('section.rv-pane').length > 0`, 60_000);
  await client.main.size(walkWindow.id, 1500, 940);
  await delay(800);
  walkWindow = await windowById(walkWindow.id);
  let panel = await poll('the panel', panelView, 30_000);
  if (!panel.docked || panel.frame.id !== walkWindow.id) {
    await clickInPanel('panel-dock-walk');
    panel = await dockedIn(walkWindow.id, 'the panel docked in the walk window');
  }
  const pc = panel.view.contentsId;
  const listed = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-head-"]')].map((h)=>h.dataset.ev.slice('walk-head-'.length)))`));
  for (const id of listed) {
    if ((await walk.ev(`document.querySelector('[data-ev^="walk-step-${id}."]')===null`)) === true) await walk.ev(`document.querySelector('[data-ev="walk-head-${id}"]').click(); true`);
  }
  const steps = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-step-"]')].map((b)=>({id:b.dataset.ev.slice('walk-step-'.length),text:b.textContent})))`));
  check('the loop\'s walks have steps the walk window lists', steps.length >= 2 && listed.length >= 1, JSON.stringify({ listed, steps: steps.length }));
  const first = steps[0];
  await walk.ev(`document.querySelector('[data-ev="walk-step-${first.id}"]').click(); true`);
  await poll(`step ${first.id} in the panel`, async () => (await read(pc, `document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent`)) === first.id, 15_000);
  await read(pc, "document.querySelector('[data-ev=\"right-tab-step\"]')?.click(); true");
  const explanation = await poll('the step\'s explanation', async () => {
    const text = await read(pc, `document.querySelector('.rv-step-panel')?.textContent ?? ''`);
    return /SIMULATED \w+ explanation of/.test(text) ? text : false;
  }, 30_000);
  check('the step shows the text the writer wrote for it, in the chosen profile, with the deepening behind Show more', /SIMULATED (Standard|Essentials|Teacher) explanation of W1\.1/.test(explanation), explanation.slice(0, 200));
  await shotWindow(await windowById(walkWindow.id), '04-walk-step');
  await read(pc, "document.querySelector('[data-ev=\"right-tab-discussion\"]')?.click(); true");
  await delay(500);
  const turns = await turnCount(pc);
  check('the discussion received nothing from the loop', turns === 0, String(turns));
  const panelText = await read(pc, `document.body.textContent`);
  check('no prompt, journal or reviewer finding is in the walk\'s reading flow', !/DSPATCH-REVIEW-TASK|edge-taken|SIMULATED review:/.test(panelText));
  await shotWindow(await windowById(walkWindow.id), '05-discussion-empty');

  stage = 'the record on disk';
  const generated = path.join(profile, 'reviews', 'generated');
  const found = fs.readdirSync(generated, { recursive: true }).map(String).filter((name) => name.endsWith('record.jsonl'));
  check('the run record is kept under the review\'s generated folder', found.length === 1, JSON.stringify(found));
  const lines = fs.readFileSync(path.join(generated, found[0]), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const kinds = lines.map((line) => line.line);
  check('the record has a header, the journal, every agent reply and an ending', kinds[0] === 'header' && kinds.filter((k) => k === 'agent-reply').length >= 4 && kinds.at(-1) === 'ending', JSON.stringify(kinds));
  check('the record names the graph, its version, the provider and the model', lines[0].identity.graphId === 'dspatch-walk-loop' && /^graph-[0-9a-f]{8,}$/.test(lines[0].identity.graphVersionId) && lines[0].identity.provider === 'copilot' && lines[0].identity.modelRequested !== '', JSON.stringify(lines[0].identity));
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
  saveRecords();
} catch (error) {
  results.push({ stage, what: 'the trial reached its end', ok: false, detail: error.stack ?? String(error) });
  console.error(`FAIL ${stage}: ${error.stack ?? error}`);
  saveRecords();
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
