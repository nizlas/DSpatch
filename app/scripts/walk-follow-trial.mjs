// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The follow preparation trial (DSP-190), on the walk loop trial's plumbing (scripts/walk-loop-trial.mjs,
 * which has it from the walk, profile, thread and dock trials). DSpatch's real windows over an isolated profile and a
 * disposable project holding the synthetic connect case of tests/support/synthetic-walks.ts; the
 * provider SIMULATED (the presentation adapter, which answers the planner, the writer and the
 * reviewer). Evidence is screenshots and what the pages say.
 *
 * It checks the run view and the two faults Niclas met: the loop started in Standard and followed
 * while the planner works; the writer, the reviewer, a correction round and the final assessment with
 * real stream events (reply text, exposed reasoning, tool calls, usage); rows that expand; an earlier
 * visit read while the run goes on and back to live; the window closed and reopened during the run
 * without a stop, a double or an extra call; the finished run reopened from the diff view, which keeps
 * one line and no generation detail; the reading profile changed to Essentials and back with one step
 * explanation asked for and no staleness notice; a second review of the same pair followed on its own
 * and stopped from its run view; a provider failure; a review deleted while its loop runs. What it
 * proves is the product's handling with simulated answers, never what a real model writes.
 *
 *     node scripts/walk-follow-trial.mjs [<evidence folder>]
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-walk-follow', `${String(process.pid)}-${String(Date.now())}`));
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
      // A window closing while this reads (a deleted review's) is skipped rather than thrown on.
      return JSON.stringify(BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).flatMap((w) => { try { return [read(w)]; } catch { return []; } }));
      function read(w) { return ({
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
      }); }
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

async function launch(label, extra = {}) {
  client.cdp = await freePort();
  client.inspect = await freePort();
  client.log = path.join(evidence, `client-${label}.log`);
  const output = fs.openSync(client.log, 'a');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSPATCH_')));
  const child = spawn(packaged || electron, [`--inspect=${String(client.inspect)}`, ...(packaged ? [] : ['.']), `--user-data-dir=${profile}`, `--remote-debugging-port=${String(client.cdp)}`], {
    cwd: packaged ? path.dirname(packaged) : appDir,
    env: { ...env, ...(display === '' ? {} : { DISPLAY: display }), DSPATCH_EXPECT_USERDATA: profile, ...simulated, ...extra },
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
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-follow-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walk-follow-project-'));
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

  // --- DSP-190: the window that follows the preparation ---------------------------------------

  /** The reading profile chosen in the panel, through the page (a desktop where other windows cover DSpatch's would take an operating-system click elsewhere). */
  const chooseProfileInPage = (contentsId, id) => read(contentsId, `(()=>{const s=document.querySelector('[data-ev="presentation-profile"]');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
  const isFollowPage = (url) => url.includes('view=follow');
  const followCheck = (page) => page.ev('JSON.stringify(window.__dspatchFollowCheck ? window.__dspatchFollowCheck.read() : null)').then((text) => JSON.parse(text ?? 'null'));
  const followWindows = async () => (await client.main.windows()).filter((w) => !w.destroyed && isFollowPage(w.url));
  /**
   * A page driven through the main process by its contents id, with the same calls `Page` offers:
   * several review windows and several follow windows share one URL, so DevTools cannot tell
   * them apart, and the main process can. Clicks are delivered inside the page.
   */
  function pageOver(contentsId, label) {
    const page = {
      label,
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
      close: () => undefined,
    };
    return page;
  }
  /** A new review of the pair from a window showing the reviews list: Start a new review, then the pair as before. */
  async function openNewPair(page) {
    await page.until('the reviews list or the chooser', `${q('pair-ongoing-open-0')}!==null || ${q('pair-repo-0')}!==null || ${q('pair-new-review')}!==null || ${q('pair-commit-1')}!==null`, 60_000);
    if ((await page.ev(`${q('pair-new-review')}!==null`)) === true) {
      await page.click('pair-new-review');
      await page.until('the repositories or the log', `${q('pair-repo-0')}!==null || ${q('pair-commit-1')}!==null`, 60_000);
    }
    await openPair(page);
  }
  /** Open the follow window from a control of a review window and drive its page. */
  async function openFollow(fromPage, control, label) {
    const before = new Set((await followWindows()).map((w) => w.id));
    await fromPage.until(`the ${control} control`, `${q(control)}!==null`, 30_000);
    await fromPage.ev(`${q(control)}.click(); true`);
    const w = await poll(`the ${label} window`, async () => (await followWindows()).find((x) => !before.has(x.id)) ?? false, 30_000);
    const page = pageOver(w.contentsId, label);
    await page.until('the follow check', 'Boolean(window.__dspatchFollowCheck)', 40_000);
    return { w, page };
  }

  stage = 'the loop is chosen in the picker and starts, slowly enough to be followed';
  const main = await launch('walk-follow', { DSPATCH_PRESENTATION_USAGE: '1', DSPATCH_PRESENTATION_REASONING: '1', DSPATCH_REVIEW_SIM: 'loop-rework', DSPATCH_PRESENTATION_TOOL_MS: '450', DSPATCH_PRESENTATION_DELTA_MS: '60' });
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
  const reviewKey = await diff.ev('window.__dspatchPairCheck.read().key');
  await diff.click('pair-discussion');
  await poll('the panel before any walk', panelView, 30_000);
  await diff.click('pair-prepare-walks');
  await diff.until('the agent picker', `${q('pair-walks-agent-start')}!==null`, 15_000);
  check('the walks will be explained in the Standard profile', (await diff.ev(`${q('pair-walks-agent-explanations')}?.value ?? null`)) === 'standard');
  await diff.ev(`(()=>{const s=${q('pair-walks-agent-method')};s.value='loop';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
  await delay(300);
  await diff.click('pair-walks-agent-start');
  await diff.until('the job line names the loop', `(${q('agent-job-walks')}?.textContent ?? '').includes('planner, writer and reviewer')`, 20_000);
  check('the running job line offers Follow preparation beside Stop', (await diff.ev(`${q('agent-job-walks-follow')}!==null && ${q('agent-job-walks-stop')}!==null`)) === true);

  stage = 'the run view opened while the planner works: heading, liveness line, loop; no stream yet, no debug line';
  let { w: followWindow, page: follow } = await openFollow(diff, 'agent-job-walks-follow', 'follow');
  let reading = await poll('the run announced', async () => {
    const r = await followCheck(follow);
    return r !== null && r.announced && r.nodes.plan === 'active' ? r : false;
  }, 60_000);
  check('the drawing shows the planner running, and nothing else reached', reading.nodes.plan === 'active' && reading.working.includes('plan') && Object.keys(reading.nodes).length === 1, JSON.stringify(reading.nodes));
  const planNode = JSON.parse(await follow.ev(`(()=>{const n=document.querySelector('[data-node-id="plan"]');return JSON.stringify({state:n?.dataset.runState,working:n?.dataset.runWorking,animations:n?n.getAnimations({subtree:true}).length:0,drawn:document.querySelectorAll('.fw-graph svg .node').length})})()`));
  check('the planner node carries the working state and its motion runs (the editor\'s own animations)', planNode.state === 'active' && planNode.working === 'true' && planNode.animations > 0 && planNode.drawn === 6, JSON.stringify(planNode));
  const left = JSON.parse(await follow.ev(`JSON.stringify({heading:document.querySelector('.fw-left h1')?.textContent ?? '',liveness:${q('follow-liveness')}?.textContent ?? '',stream:${q('follow-stream')}!==null,provenance:${q('follow-provenance')}!==null,record:${q('follow-record')}!==null,order:[...document.querySelectorAll('.fw-left > *')].map((e)=>e.className.split(' ')[0])})`));
  check('left side, top to bottom: the heading, the liveness line, the loop; the stream closed; no metadata line', left.heading === 'Code walk generation' && left.order.join(',') === 'fw-header,fw-liveness,fw-graph' && left.stream === false && left.provenance === false && left.record === false, JSON.stringify(left));
  reading = await poll('the liveness line about the planner', async () => {
    const r = await followCheck(follow);
    return r !== null && /Plan/.test(r.liveness) ? r : false;
  }, 30_000);
  check('the liveness line says what the planner does, in the job\'s own words', /Planner|Plan the walks/.test(reading.liveness) && reading.panelOpen === false, reading.liveness);
  check('no editor controls are in the run view', reading.editorControls === false && (await follow.ev(`document.querySelector('.editor-palette, .editor-inspector')===null`)) === true);
  const noDebug = (text) => !/tokens|cache|instruction version|graph-[0-9a-f]{6}|DSPATCH-REVIEW-TASK|seq\b|runId|rawProviderEvent/.test(text);
  check('no token, cache, version, graph id or prompt text anywhere in the view', noDebug(await follow.ev('document.body.textContent')));
  await client.main.size(followWindow.id, 1500, 940);
  await delay(600);
  await shotWindow(await windowById(followWindow.id), '01-follow-planner');

  stage = 'the live stream opened from the liveness line: text grows without opening entries';
  await follow.ev(`${q('follow-liveness')}.click(); true`);
  await follow.until('the stream panel', `${q('follow-stream')}!==null`, 10_000);
  const textLength = async () => Number(await follow.ev(`[...document.querySelectorAll('.fw-text-body')].reduce((n,e)=>n+e.textContent.length,0)`));
  reading = await poll('text in the stream', async () => {
    const r = await followCheck(follow);
    return r !== null && r.panelOpen && r.textLength > 0 ? r : false;
  }, 120_000);
  const lengthA = await textLength();
  const lengthB = await poll('the text growing', async () => {
    const n = await textLength();
    return n > lengthA ? n : false;
  }, 120_000);
  check('the agent\'s text is open and grows as it arrives, with no entry to open', lengthB > lengthA && (await follow.ev(`document.querySelectorAll('[data-ev="follow-text"] details').length`)) === 0 && (await follow.ev(`document.querySelectorAll('[data-ev="follow-text"]').length`)) > 0, JSON.stringify({ lengthA, lengthB }));
  check('the stream has one vertical scroll and no scroll box inside a text block', (await follow.ev(`getComputedStyle(${q('follow-entries')}).overflowY`)) === 'auto' && (await follow.ev(`[...document.querySelectorAll('.fw-text-body')].every((e)=>['visible','clip'].includes(getComputedStyle(e).overflowY))`)) === true);
  check('text keeps its line breaks', (await follow.ev(`getComputedStyle(document.querySelector('.fw-text-body')).whiteSpace`)) === 'pre-wrap');
  check('the stream follows its foot from the start', (await follow.ev(`${q('follow-stream')}.dataset.following`)) === 'true' && (await follow.ev(`(()=>{const e=${q('follow-entries')};return e.scrollHeight-e.scrollTop-e.clientHeight})()`)) <= 64);

  stage = 'the writer followed: role dividers, exposed reasoning, reply text, tool lines';
  reading = await poll('the writer at work', async () => {
    const r = await followCheck(follow);
    return r !== null && r.dividers.some((d) => /^Writer · Writing step/.test(d)) && /Writer/.test(r.liveness) ? r : false;
  }, 180_000);
  check('the liveness line names the writer\'s step, from the turn DSpatch sent', /Writer: Writing step W\d+\.\d+ \(\d+ of \d+\)/.test(reading.liveness), reading.liveness);
  check('the writer is the active node and the planner is done', reading.nodes.write === 'active' && reading.nodes.plan === 'finished' && reading.edgesTaken.includes('e-planned'), JSON.stringify({ nodes: reading.nodes, edges: reading.edgesTaken }));
  await follow.until('reasoning and reply in the stream', `document.querySelector('[data-ev="follow-text"][data-text-kind="reasoning"]')!==null && document.querySelector('[data-ev="follow-text"][data-text-kind="reply"]')!==null`, 120_000);
  const stream = JSON.parse(await follow.ev(`JSON.stringify({dividers:[...document.querySelectorAll('[data-ev="follow-divider"]')].map((e)=>e.textContent),reasoningLabel:document.querySelector('.fw-text-reasoning .fw-text-label')?.textContent ?? '',reasoning:document.querySelector('[data-ev="follow-text"][data-text-kind="reasoning"] .fw-text-body')?.textContent ?? '',reply:document.querySelector('[data-ev="follow-text"][data-text-kind="reply"] .fw-text-body')?.textContent ?? '',tools:[...document.querySelectorAll('[data-ev="follow-tool"] .fw-tool-line')].map((e)=>e.textContent),usageRows:document.querySelectorAll('[data-ev="follow-usage"], .fw-usage').length})`));
  check('dividers name the role and the turn, discreetly', stream.dividers.some((d) => /^PlannerPlanning the walks/.test(d)) && stream.dividers.some((d) => /^WriterWriting step W1\.1/.test(d)), JSON.stringify(stream.dividers.slice(0, 3)));
  check('the reasoning text is shown open, labelled as exposed by the provider, never as thinking', stream.reasoningLabel === 'Reasoning, as the provider exposes it' && /SIMULATED reasoning: reading the places/.test(stream.reasoning) && !/thought|thinking/i.test(stream.reasoningLabel), stream.reasoningLabel);
  check('the reply text is shown open, whole, with its formatting', /SIMULATED/.test(stream.reply) && stream.reply.length > 100, stream.reply.slice(0, 80));
  check('tool activity is a short readable line', stream.tools.some((t) => /^Reading .+\.ts/.test(t)), JSON.stringify(stream.tools.slice(0, 3)));
  check('no usage or token rows in the stream', stream.usageRows === 0 && noDebug(await follow.ev('document.body.textContent')));
  await shotWindow(await windowById(followWindow.id), '02-follow-stream');

  stage = 'scrolled up while text arrives: the reading position stays; back at the foot, following resumes';
  await follow.ev(`(()=>{const e=${q('follow-entries')};e.scrollTop=0;e.dispatchEvent(new Event('scroll'));return e.scrollTop})()`);
  await follow.until('following stopped', `${q('follow-stream')}.dataset.following === 'false'`, 5_000);
  const upLength = await textLength();
  await poll('more text arriving', async () => (await textLength()) > upLength, 120_000);
  await delay(500);
  const upTop = await follow.ev(`${q('follow-entries')}.scrollTop`);
  check('scrolled up, new text does not pull the reader back', upTop === 0 && (await follow.ev(`${q('follow-stream')}.dataset.following`)) === 'false' && /new text waits below/.test(await follow.ev(`${q('follow-stream')}.textContent`)), JSON.stringify({ upTop }));
  await follow.ev(`(()=>{const e=${q('follow-entries')};e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'));return e.scrollTop})()`);
  await follow.until('following resumed', `${q('follow-stream')}.dataset.following === 'true'`, 5_000);
  const footLength = await textLength();
  await poll('more text after resuming', async () => (await textLength()) > footLength, 120_000);
  await delay(400);
  check('back at the foot, the stream follows again', (await follow.ev(`(()=>{const e=${q('follow-entries')};return e.scrollHeight-e.scrollTop-e.clientHeight})()`)) <= 64);

  stage = 'the stream closed and reopened, the window closed and reopened: nothing stops, doubles or repeats';
  await follow.ev(`${q('follow-stream-close')}.click(); true`);
  await follow.until('the stream closed', `${q('follow-stream')}===null`, 5_000);
  const livenessA = await follow.ev(`${q('follow-liveness')}.textContent`);
  await poll('the liveness line still updating with the stream closed', async () => (await follow.ev(`${q('follow-liveness')}.textContent`)) !== livenessA, 60_000);
  check('closing the stream stops nothing and the liveness line goes on', (await diff.ev(`${q('agent-job-walks')}?.dataset.state`)) === 'running');
  const beforeClose = await followCheck(follow);
  await follow.ev(`${q('follow-liveness')}.click(); true`);
  await follow.until('the stream reopened', `${q('follow-stream')}!==null`, 5_000);
  const reopenedDividers = Number(await follow.ev(`document.querySelectorAll('[data-ev="follow-divider"]').length`));
  check('reopening the stream shows the same flow once: one divider per turn, no doubled text', reopenedDividers === beforeClose.turnNumbers.length && Number(await follow.ev(`(document.body.textContent.match(/SIMULATED Standard explanation of W1\\.1 /g) ?? []).length`)) <= 2, JSON.stringify({ reopenedDividers, turns: beforeClose.turnNumbers.length }));
  follow.close();
  await client.main.closeWindow(followWindow.id);
  await poll('the follow window gone', async () => !(await followWindows()).some((x) => x.id === followWindow.id), 15_000);
  await delay(1500);
  check('closing the run view stops nothing: the job runs on', (await diff.ev(`${q('agent-job-walks')}?.dataset.state`)) === 'running');
  ({ w: followWindow, page: follow } = await openFollow(diff, 'agent-job-walks-follow', 'follow-2'));
  reading = await poll('the reopened view handed the run so far', async () => {
    const r = await followCheck(follow);
    return r !== null && r.announced && r.activity >= beforeClose.activity ? r : false;
  }, 30_000);
  const jobsNow = JSON.parse(await diff.ev(`window.dspatchReviewPair.state(${JSON.stringify(reviewKey)}).then((r)=>JSON.stringify(r.jobs.filter((j)=>j.kind==='walks').map((j)=>j.state)))`));
  check('reopening the window starts no second preparation and no extra call: one job, the turns numbered on without a gap or a double', jobsNow.length === 1 && reading.seqMonotonic === true && reading.turnNumbers.every((n, i) => n === i + 1) && reading.turns === undefined, JSON.stringify({ jobsNow, turns: reading.turnNumbers }));
  await client.main.size(followWindow.id, 1500, 940);
  await follow.ev(`${q('follow-liveness')}.click(); true`);
  await follow.until('the stream in the reopened window', `${q('follow-stream')}!==null && document.querySelectorAll('[data-ev="follow-divider"]').length >= 2`, 15_000);

  stage = 'the reviewer, the correction round and the final assessment, in the same flow';
  reading = await poll('the correction round', async () => {
    const r = await followCheck(follow);
    return r !== null && r.dividers.some((d) => /^Writer · Writing again step/.test(d)) ? r : false;
  }, 240_000);
  check('the reviewer asked for a correction and the writer was entered again: the actual path on the drawing, the dividers in the stream', reading.edgesTaken.includes('e-rework-text') && reading.dividers.some((d) => /^Reviewer/.test(d)) && reading.blocks.verdict >= 1, JSON.stringify({ edges: reading.edgesTaken, dividers: reading.dividers.filter((d) => !/^Writer · Writing step/.test(d)) }));
  const verdict = await follow.ev(`document.querySelector('[data-ev="follow-verdict"]')?.textContent ?? ''`);
  check('the reviewer\'s verdict and its finding are in the flow, as a finding of the walk, not of the code', /verdict: rework/.test(verdict) && /W1\.1/.test(verdict) && /approves nothing of the code/.test(verdict), verdict.slice(0, 160));
  await shotWindow(await windowById(followWindow.id), '03-follow-correction');

  stage = 'the run ended: the ending on the drawing, the liveness line with the outcome, the stream readable, zoom';
  reading = await poll('the run ended', async () => {
    const r = await followCheck(follow);
    return r !== null && r.ended === true && r.jobState !== 'running' ? r : false;
  }, 240_000);
  check('the run ended at delivered-with-objections, every visited node finished', reading.status === 'completed' && reading.terminal === 'delivered-with-objections' && reading.nodes.plan === 'finished' && reading.nodes.write === 'finished' && reading.nodes.review === 'finished' && reading.working.length === 0, JSON.stringify(reading.nodes));
  const endingNode = JSON.parse(await follow.ev(`(()=>{const n=document.querySelector('[data-node-id="delivered-with-objections"]');return JSON.stringify({ending:n?.dataset.runEnding,tick:n?.querySelector('.node-ending-tick')!==null,animations:[...document.querySelectorAll('.fw-graph svg .node')].reduce((s,x)=>s+x.getAnimations({subtree:true}).length,0)})})()`));
  check('the terminal the drawing declares a success carries the tick, and no motion remains', endingNode.ending === 'success' && endingNode.tick === true && endingNode.animations === 0, JSON.stringify(endingNode));
  reading = await poll('the liveness line with the outcome', async () => {
    const r = await followCheck(follow);
    return r !== null && /correction/.test(r.liveness) ? r : false;
  }, 20_000);
  check('the liveness line says how it ended, in the job\'s own sentence', /asked for one correction/.test(reading.liveness) && /objection/.test(reading.liveness), reading.liveness);
  check('the final assessment is in the flow with its objection', reading.blocks.verdict === 2 && reading.dividers.some((d) => /^Reviewer · The reviewer gives its final assessment/.test(d)));
  check('no token, usage, version, graph id, prompt or record control in the view, open or closed', noDebug(await follow.ev('document.body.textContent')) && (await follow.ev(`${q('follow-record')}===null && document.querySelectorAll('[data-ev="follow-usage"], .fw-usage, .fw-summary').length===0 && !/Every prompt and answer|usage/.test(document.body.textContent)`)) === true);
  check('no limitation is reported for a run followed from its start', reading.limitations.length === 0, JSON.stringify(reading.limitations));
  const widthBefore = await follow.ev(`document.querySelector('.fw-graph svg').getAttribute('width')`);
  await follow.ev(`${q('follow-zoom-in')}.click(); true`);
  await delay(200);
  const widthAfter = await follow.ev(`document.querySelector('.fw-graph svg').getAttribute('width')`);
  check('zoom changes the drawing\'s size for readability', Number(widthAfter) > Number(widthBefore), JSON.stringify({ widthBefore, widthAfter }));
  await follow.ev(`${q('follow-zoom-out')}.click(); true`);
  await delay(300);
  await shotWindow(await windowById(followWindow.id), '04-follow-ended');

  stage = 'the diff view stays free of generation details, and the finished run reopens from it';
  const walkWindowFound = await poll('the walk window', async () => (await client.main.windows()).find((x) => !x.destroyed && isWalkPage(x.url)) ?? false, 60_000).catch(() => null);
  await diff.until('the one line about the preparation', `${q('pair-walk-loop')}!==null`, 30_000);
  const line = await diff.ev(`${q('pair-walk-loop')}.textContent`);
  const diffText = await diff.ev(`document.body.textContent`);
  check('the preparation area holds one short line and the way into the run view', /Prepared through the planner, writer and reviewer loop/.test(line) && line.length < 160 && (await diff.ev(`${q('pair-walk-loop-follow')}!==null`)) === true, line);
  check('no token list, journal, prompt, verdict or usage is in the diff view', !/tokens|edge-taken|DSPATCH-REVIEW-TASK|SIMULATED review|provider turn|usage/.test(diffText), diffText.slice(0, 100));
  check('no staleness notice is shown for walks just prepared', (await diff.ev(`${q('pair-stale')}===null`)) === true);
  await activate(diffWindow.id).catch(() => undefined);
  await delay(500);
  await shotWindow(await windowById(diffWindow.id), '05-diff-clean');
  follow.close();
  await client.main.closeWindow(followWindow.id);
  await poll('the follow window gone', async () => !(await followWindows()).some((x) => x.id === followWindow.id), 15_000);
  ({ w: followWindow, page: follow } = await openFollow(diff, 'pair-walk-loop-follow', 'follow-3'));
  const history = await poll('the finished run read from its files', async () => {
    const r = await followCheck(follow);
    return r !== null && r.announced && r.ended ? r : false;
  }, 30_000);
  await follow.ev(`${q('follow-liveness')}.click(); true`);
  await follow.until('the stream of the finished run', `${q('follow-stream')}!==null && document.querySelectorAll('[data-ev="follow-text"]').length > 0`, 15_000);
  check('the finished run shows its whole flow from its files: every turn, the text, the reasoning, the verdicts', history.live === false && history.dividers.length === reading.dividers.length && history.blocks.verdict === 2 && history.textLength > 0 && history.kinds['reasoning-text'] >= 6 && history.terminal === 'delivered-with-objections', JSON.stringify({ dividers: history.dividers.length, blocks: history.blocks }));
  check('the finished run\'s view has no limitation and no debug text', history.limitations.length === 0 && noDebug(await follow.ev('document.body.textContent')), JSON.stringify(history.limitations));
  await client.main.size(followWindow.id, 1500, 940);
  await delay(500);
  await shotWindow(await windowById(followWindow.id), '06-follow-history');

  stage = 'the reading profile changed to Essentials and back: a step explanation at most, nothing stale, no new preparation';
  let walkWindow = walkWindowFound;
  if (walkWindow === null) {
    await diff.click('pair-walks');
    walkWindow = await windowShowing(isWalkPage, 'the walk window');
  }
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
  const steps = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-step-"]')].map((b)=>b.dataset.ev.slice('walk-step-'.length)))`));
  await walk.ev(`document.querySelector('[data-ev="walk-step-${steps[0]}"]').click(); true`);
  await poll(`step ${steps[0]} in the panel`, async () => (await read(pc, `document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent`)) === steps[0], 15_000);
  await read(pc, "document.querySelector('[data-ev=\"right-tab-step\"]')?.click(); true");
  const standardText = await poll('the step in Standard', async () => {
    const text = await read(pc, `document.querySelector('.rv-step-panel')?.textContent ?? ''`);
    return /SIMULATED Standard/.test(text) ? text : false;
  }, 30_000);
  await delay(1500);
  check('the walk\'s own Standard text is shown with no explanation call', /SIMULATED Standard explanation/.test(standardText) && explanationEntries().length === 0, String(explanationEntries().length));
  const chosen = await chooseProfileInPage(pc, 'essens');
  check('Essentials is chosen for reading', chosen === 'essens', String(chosen));
  await poll('the Essentials explanation of the current step', async () => doneFor(steps[0], 'essens'), 60_000);
  const essentialsText = await poll('the step in Essentials', async () => {
    const text = await read(pc, `document.querySelector('.rv-step-panel')?.textContent ?? ''`);
    return /SIMULATED Essentials/.test(text) ? text : false;
  }, 30_000);
  await delay(2500);
  const afterEssentials = explanationEntries();
  check('one explanation was asked for: the current step in Essentials, nothing else', afterEssentials.length === 1 && afterEssentials[0].stepId === steps[0] && afterEssentials[0].profile === 'essens', JSON.stringify(afterEssentials.map((e) => `${e.stepId}:${e.profile}:${e.action}`)));
  check('the diff view says nothing about earlier settings after the profile change', (await diff.ev(`${q('pair-stale')}===null`)) === true && !/earlier settings|earlier version/.test(await diff.ev(`document.body.textContent`)));
  check('the walk window and its panel say nothing about earlier settings either', (await read(pc, `document.querySelector('[data-ev="walk-stale"]')===null && !/earlier settings|earlier version/.test(document.body.textContent)`)) === true && !/earlier settings|earlier version/.test(await walk.ev('document.body.textContent')));
  check('the diff view still holds its one line and no generation detail', !/tokens|edge-taken|provider turn|usage/.test(await diff.ev(`document.body.textContent`)));
  const jobsAfterProfile = JSON.parse(await diff.ev(`window.dspatchReviewPair.state(${JSON.stringify(reviewKey)}).then((r)=>JSON.stringify(r.jobs.filter((j)=>j.kind==='walks').length))`));
  check('the profile change started no preparation and no loop', jobsAfterProfile === 1 && (await diff.ev(`${q('agent-job-walks')}?.dataset.state ?? 'none'`)) !== 'running', String(jobsAfterProfile));
  check('the walk\'s places, order and the Essentials text are as prepared', /SIMULATED Essentials/.test(essentialsText) && JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-step-"]')].map((b)=>b.dataset.ev.slice('walk-step-'.length)))`)).join(',') === steps.join(','));
  await shotWindow(await windowById(walkWindow.id), '07-walk-essentials');
  await chooseProfileInPage(pc, 'standard');
  await poll('the step in Standard again', async () => /SIMULATED Standard/.test(await read(pc, `document.querySelector('.rv-step-panel')?.textContent ?? ''`)), 30_000);
  await delay(2500);
  check('back to Standard shows the walk\'s own text and asks for nothing', explanationEntries().length === 1);
  await chooseProfileInPage(pc, 'essens');
  await poll('the saved Essentials explanation', async () => /SIMULATED Essentials/.test(await read(pc, `document.querySelector('.rv-step-panel')?.textContent ?? ''`)), 30_000);
  await delay(2500);
  check('Essentials again shows the saved explanation and asks for nothing', explanationEntries().length === 1 && repeatedPresents().length === 0, JSON.stringify(repeatedPresents()));
  await chooseProfileInPage(pc, 'standard');
  await delay(500);

  stage = 'a second review of the same pair, followed on its own, and stopped from its run view';
  await main.click('open-review');
  const diffWindow2 = await poll('a second review window', async () => (await client.main.windows()).find((x) => !x.destroyed && isDiffPage(x.url) && x.id !== diffWindow.id) ?? false, 30_000);
  const diff2 = pageOver(diffWindow2.contentsId, 'review-2');
  await diff2.until('the reviews list or the chooser', `${q('pair-ongoing-open-0')}!==null || ${q('pair-repo-0')}!==null || ${q('pair-new-review')}!==null`, 60_000);
  await openNewPair(diff2);
  const reviewKey2 = await diff2.ev('window.__dspatchPairCheck.read().key');
  check('the second review of the same pair is its own', reviewKey2 !== reviewKey && reviewKey2 !== '', String(reviewKey2));
  await diff2.click('pair-discussion').catch(() => undefined);
  await diff2.click('pair-prepare-walks');
  await diff2.until('the agent picker', `${q('pair-walks-agent-start')}!==null`, 15_000);
  await diff2.ev(`(()=>{const s=${q('pair-walks-agent-method')};s.value='loop';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
  await delay(300);
  await diff2.click('pair-walks-agent-start');
  await diff2.until('the second job line', `(${q('agent-job-walks')}?.textContent ?? '').includes('planner, writer and reviewer')`, 20_000);
  const { w: followWindow2, page: follow2 } = await openFollow(diff2, 'agent-job-walks-follow', 'follow-second');
  const second = await poll('the second run announced', async () => {
    const r = await followCheck(follow2);
    return r !== null && r.announced && r.activity > 0 ? r : false;
  }, 60_000);
  const firstAgain = await followCheck(follow);
  check('the two reviews are followed independently: different keys and jobs, and the finished run\'s view does not change while the second runs', second.key === reviewKey2 && second.jobId !== history.jobId && firstAgain.activity === history.activity && firstAgain.ended === true, JSON.stringify({ second: { key: second.key, job: second.jobId }, first: { activity: firstAgain.activity, history: history.activity } }));
  await delay(2000);
  check('still unchanged after more of the second run arrived', (await followCheck(follow)).activity === history.activity);
  await follow2.ev(`${q('follow-stop')}.click(); true`);
  await poll('the second job stopped', async () => ['cancelled', 'failed', 'unknown'].includes(await diff2.ev(`${q('agent-job-walks')}?.dataset.state ?? ''`)), 60_000);
  const stopped = await poll('the second run view ended', async () => {
    const r = await followCheck(follow2);
    return r !== null && r.ended === true ? r : false;
  }, 30_000);
  check('Stop in the run view stopped the actual job and the view says so', stopped.jobState === 'cancelled' && stopped.status !== 'completed' && /Stopped/.test(await follow2.ev(`${q('follow-liveness')}.textContent`)), JSON.stringify({ state: stopped.jobState, status: stopped.status }));
  await client.main.size(followWindow2.id, 1500, 940);
  await delay(400);
  await shotWindow(await windowById(followWindow2.id), '08-follow-stopped');
  const walkWindowsNow = (await client.main.windows()).filter((x) => !x.destroyed && isWalkPage(x.url)).length;
  note('walk windows open at the end of the first launch', String(walkWindowsNow));
  follow.close();
  follow2.close();
  await quitClient();

  stage = 'a provider failure ends the run without a resend, and a deleted review takes its run view with it';
  // The host of the first launch outlives its client and keeps its environment; the failure switch needs a new host.
  await endHost();
  try {
    fs.unlinkSync(path.join(profile, 'host-running.json'));
  } catch {
    // Already gone.
  }
  const main2 = await launch('walk-follow-fail', { DSPATCH_PRESENTATION_USAGE: '1', DSPATCH_PRESENTATION_FAIL_TASK: 'write-step', DSPATCH_PRESENTATION_TOOL_MS: '200', DSPATCH_PRESENTATION_DELTA_MS: '25' });
  await main2.until('the recent project', `${q('open-project-0')}!==null`);
  await main2.click('open-project-0');
  await main2.until('the chat', `${q('prompt')}!==null`);
  await main2.click('open-review');
  const diffWindow3 = await windowShowing(isDiffPage, 'the review window');
  const diff3 = pageOver(diffWindow3.contentsId, 'review-3');
  await diff3.until('the reviews list', `${q('pair-ongoing-open-0')}!==null || ${q('pair-new-review')}!==null || ${q('pair-repo-0')}!==null`, 60_000);
  await openNewPair(diff3);
  const reviewKey3 = await diff3.ev('window.__dspatchPairCheck.read().key');
  await diff3.click('pair-discussion').catch(() => undefined);
  await diff3.click('pair-prepare-walks');
  await diff3.until('the agent picker', `${q('pair-walks-agent-start')}!==null`, 15_000);
  await diff3.ev(`(()=>{const s=${q('pair-walks-agent-method')};s.value='loop';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
  await delay(300);
  await diff3.click('pair-walks-agent-start');
  await diff3.until('the job line', `(${q('agent-job-walks')}?.textContent ?? '').includes('planner, writer and reviewer')`, 20_000);
  const { w: followWindow3, page: follow3 } = await openFollow(diff3, 'agent-job-walks-follow', 'follow-fail');
  const failed = await poll('the failed run', async () => {
    const r = await followCheck(follow3);
    return r !== null && r.ended === true && r.jobState === 'failed' ? r : false;
  }, 120_000);
  const sentAfterFailure = fs.readFileSync(path.join(profile, 'reviews', 'generated', reviewKey3, fs.readdirSync(path.join(profile, 'reviews', 'generated', reviewKey3)).find((n) => n.endsWith('.walk-loop')), 'record.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const replies3 = sentAfterFailure.filter((l) => l.line === 'agent-reply');
  check('the provider failure ended the job as failed, with the writer marked failed on the drawing and no resend of the turn', failed.nodes.write === 'failed' && failed.status !== 'completed' && replies3.length === 2 && replies3.at(-1).reply.terminalStatus === 'failed' && /failed/.test(await follow3.ev(`${q('follow-liveness')}.textContent`)), JSON.stringify({ nodes: failed.nodes, replies: replies3.map((r) => r.reply.terminalStatus) }));
  await follow3.ev(`${q('follow-liveness')}.click(); true`);
  await follow3.until('the stream of the failed run', `${q('follow-stream')}!==null`, 10_000);
  const endedRow = await follow3.ev(`JSON.stringify([...document.querySelectorAll('[data-ev="follow-turn-ended"]')].map((e)=>e.textContent))`);
  check('the failed turn is said plainly in the stream, with the provider\'s own words, and the liveness line says what to do', /The provider stopped this turn\. SIMULATED: the provider stopped this turn/.test(endedRow) && /prepare the walks again/.test(await follow3.ev(`${q('follow-liveness')}.textContent`)), endedRow);
  await client.main.size(followWindow3.id, 1500, 940);
  await delay(400);
  await shotWindow(await windowById(followWindow3.id), '09-follow-failed');
  follow3.close();
  await client.main.closeWindow(followWindow3.id);
  // Another review, deleted while its loop runs.
  await main2.click('open-review');
  const diffWindow4 = await poll('another review window', async () => (await client.main.windows()).find((x) => !x.destroyed && isDiffPage(x.url) && x.id !== diffWindow3.id) ?? false, 30_000);
  const diff4 = pageOver(diffWindow4.contentsId, 'review-4');
  await diff4.until('the reviews list', `${q('pair-ongoing-open-0')}!==null || ${q('pair-new-review')}!==null || ${q('pair-repo-0')}!==null`, 60_000);
  await openNewPair(diff4);
  const reviewKey4 = await diff4.ev('window.__dspatchPairCheck.read().key');
  await diff4.click('pair-discussion').catch(() => undefined);
  await diff4.click('pair-prepare-walks');
  await diff4.until('the agent picker', `${q('pair-walks-agent-start')}!==null`, 15_000);
  await diff4.ev(`(()=>{const s=${q('pair-walks-agent-method')};s.value='loop';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`);
  await delay(300);
  await diff4.click('pair-walks-agent-start');
  await diff4.until('the job line', `(${q('agent-job-walks')}?.textContent ?? '').includes('planner, writer and reviewer')`, 20_000);
  const { w: followWindow4, page: follow4 } = await openFollow(diff4, 'agent-job-walks-follow', 'follow-deleted');
  await poll('the fourth run announced', async () => {
    const r = await followCheck(follow4);
    return r !== null && r.announced && r.activity > 2;
  }, 60_000);
  const generated4 = path.join(profile, 'reviews', 'generated', reviewKey4);
  check('the running review\'s run folder exists before it is deleted', fs.existsSync(generated4));
  await diff4.click('pair-all-reviews');
  await diff4.until('the reviews list', `${q('pair-ongoing-open-0')}!==null`, 30_000);
  const rowIndex = await diff4.ev(`[...document.querySelectorAll('.rv-pair-ongoing-row')].findIndex((r)=>r.dataset.review===${JSON.stringify(reviewKey4)})`);
  check('the review being deleted is in the list', rowIndex >= 0, String(rowIndex));
  await diff4.ev(`${q(`pair-ongoing-delete-${String(rowIndex)}`)}.click(); true`);
  await diff4.until('the confirmation', `${q(`pair-ongoing-delete-yes-${String(rowIndex)}`)}!==null`, 10_000);
  follow4.close();
  await diff4.ev(`${q(`pair-ongoing-delete-yes-${String(rowIndex)}`)}.click(); true`);
  await poll('the follow window of the deleted review closed', async () => !(await followWindows()).some((x) => x.id === followWindow4.id), 30_000);
  await poll('the deleted review\'s folder gone', () => !fs.existsSync(generated4), 30_000);
  await delay(3000);
  check('deleting the review closed its run view and nothing recreated its files afterwards', !(await followWindows()).some((x) => x.id === followWindow4.id) && !fs.existsSync(generated4));
  check('the deleted review is not among the reviews', (await diff4.ev(`[...document.querySelectorAll('.rv-pair-ongoing-row')].some((r)=>r.dataset.review===${JSON.stringify(reviewKey4)})`)) === false);
  await shotWindow(await windowById(diffWindow4.id), '10-review-deleted');
  note('windows at the end', JSON.stringify((await client.main.windows()).map((x) => x.url.slice(x.url.indexOf('?')))));
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
