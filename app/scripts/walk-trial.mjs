// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The walk trial (DSP-185), on the profile trial's plumbing (copied from scripts/profile-trial.mjs,
 * which has it from the thread and dock trials). DSpatch's real windows over an isolated profile
 * and a disposable project holding the synthetic case of tests/support/synthetic-walks.ts (a caller
 * that calls two new functions added further down the same file, and a second file changed on its
 * own); the provider SIMULATED (the presentation adapter in its default scenario). Evidence is
 * screenshots of the X display and OS-level input (xdotool); what pages say is read beside.
 *
 * It checks that each code place has a pane of its own in the walk's horizontal view, also within
 * one file; that Next and Previous move between those panes and back to the same view; that Shift
 * with the left button dragged from over the code pans the map; that an explanation's step link
 * goes to a step of another walk and back; and that a reference into the diff opens the file with
 * the lines marked and returns to the walk where it was. What it proves is the structure and the
 * window's behaviour with simulated answers, never what a real model writes.
 *
 *     node scripts/walk-trial.mjs [<evidence folder>]
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-walks', `${String(process.pid)}-${String(Date.now())}`));
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
  check('xdotool and import are here', run('sh', ['-c', 'command -v xdotool && command -v import'], true) !== '');
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  if (display === '' || process.env.WALK_TRIAL_OWN_DISPLAY === '1') {
    const number = 90 + (process.pid % 50);
    display = `:${String(number)}`;
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' });
    await poll('Xvfb', () => fs.existsSync(`/tmp/.X11-unix/X${String(number)}`), 15_000);
    owned.wm = spawn('openbox', [], { env: { ...process.env, DISPLAY: display }, stdio: 'ignore' });
    await delay(800);
  }
  run('setxkbmap', ['-display', display, 'us'], true);
  note('the display', `${display}; WM ${owned.wm === null ? 'already there' : 'openbox'}`);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walks-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-walks-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  // The synthetic case of tests/support/synthetic-walks.ts (WORKER_CASE), in neutral invented code:
  // run() calls two new functions, added at lines 8–11 and 14–18 of the same file with only a few
  // unchanged lines between; format.js changes on its own, as another walk.
  const versions = [
    {
      'src/worker.js': ['export function run(items, n) {', '  return n;', '}', '', 'const state = {};', 'export const spare1 = 1;', 'export const spare2 = 2;', ''].join('\n'),
      'src/format.js': ['export function formatPair(a, b) {', "  return a + '/' + b;", '}', ''].join('\n'),
    },
    {
      'src/worker.js': [
        'export function run(items, n) {',
        '  startWorker();',
        '  subscribeToPairs(items, n);',
        '  return n;',
        '}',
        '',
        'const state = {};',
        'function startWorker() {',
        '  state.worker = { running: true, connected: false };',
        '  state.worker.queue = [];',
        '}',
        'export const spare1 = 1;',
        'export const spare2 = 2;',
        'function subscribeToPairs(items, n) {',
        '  const pairs = items.slice(0, n).map((item, index) => [index, item]);',
        '  state.worker.queue.push(...pairs);',
        '  return pairs.length;',
        '}',
        '',
      ].join('\n'),
      'src/format.js': ['export function formatPair(a, b) {', "  return a + ' / ' + b;", '}', ''].join('\n'),
    },
  ];
  for (const [index, files] of versions.entries()) {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(project, name), text);
    git('add', '.');
    git('commit', '-qm', `Commit ${String(index + 1)}`);
  }

  stage = 'the walks of the synthetic case';
  const main = await launch('walks');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  await main.until('the recent project', `${q('open-project-0')}!==null`);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  await main.click('open-review');
  await windowShowing(isDiffPage, 'the review window');
  const diff = new Page(client.cdp, 'review', isDiffPage);
  await diff.attach(60_000);
  await openPair(diff);
  for (const w of await client.main.windows()) await client.main.menu('dspatch-zoom-reset', w.id).catch(() => undefined);
  await diff.click('pair-discussion');
  await poll('the panel before any walk', panelView, 30_000);
  await diff.click('pair-prepare-walks');
  await diff.until('the agent picker', `${q('pair-walks-agent-start')}!==null`, 15_000);
  await diff.click('pair-walks-agent-start');
  let walkWindow = await poll('the walk window', async () => (await client.main.windows()).find((x) => !x.destroyed && isWalkPage(x.url)) ?? false, 90_000).catch(() => null);
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
  const wc = walkWindow.contentsId;

  // Which walk is which, from the walk list: the worker walk has the two functions' steps.
  const listed = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-head-"]')].map((h)=>h.dataset.ev.slice('walk-head-'.length)))`));
  for (const id of listed) {
    if ((await walk.ev(`document.querySelector('[data-ev^="walk-step-${id}."]')===null`)) === true) await osClickAt(wc, `[data-ev="walk-head-${id}"]`);
  }
  const steps = JSON.parse(await walk.ev(`JSON.stringify([...document.querySelectorAll('[data-ev^="walk-step-"]')].map((b)=>({id:b.dataset.ev.slice('walk-step-'.length),text:b.textContent})))`));
  const first = steps.find((s) => /What startWorker does/.test(s.text));
  const second = steps.find((s) => /What subscribeToPairs does/.test(s.text));
  const workerWalk = first?.id.split('.')[0];
  const caller = steps.find((s) => s.id.startsWith(`${workerWalk}.`) && s.id !== first?.id && s.id !== second?.id);
  const otherWalk = listed.find((id) => id !== workerWalk);
  check(
    'the worker walk is caller, then the first new function, then the second, as steps of their own; the other file is another walk',
    first !== undefined && second !== undefined && caller !== undefined && caller.id === `${workerWalk}.1` && first.id === `${workerWalk}.2` && second.id === `${workerWalk}.3` && steps.filter((s) => s.id.startsWith(`${workerWalk}.`)).length === 3 && otherWalk !== undefined,
    JSON.stringify(steps),
  );
  const goToStep = async (id) => {
    await activate(walkWindow.id);
    if ((await walk.ev(`document.querySelector('[data-ev="walk-step-${id}"]')===null`)) === true) await osClickAt(wc, `[data-ev="walk-head-${id.split('.')[0]}"]`);
    await osClickAt(wc, `[data-ev="walk-step-${id}"]`);
    await poll(`step ${id} in the panel`, async () => (await read(pc, `document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent`)) === id, 15_000);
  };
  const shown = () => read(pc, `JSON.stringify({step:document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent??'',profileShown:document.querySelector('[data-ev="profile-explanation"]')?.dataset.profile??'',alt:document.querySelector('[data-ev="profile-explanation"]')?.textContent??''})`).then((text) => JSON.parse(text));
  const map = () =>
    walk.ev(`JSON.stringify((()=>{const t=document.querySelector('.rv-timeline-track');const m=/translateX\\((-?[\\d.]+)px\\)/.exec(t?.style.transform??'');const a=document.querySelector('section.rv-pane-active');return {x:m?-Number(m[1]):null,slots:document.querySelectorAll('.rv-pane-slot').length,active:Number(a?.dataset.paneIndex??-1),identity:a?.querySelector('[data-ev="pane-focus-identity"]')?.textContent??'',tops:Object.fromEntries([...document.querySelectorAll('section.rv-pane')].map((p)=>[p.dataset.paneIndex,p.querySelector('.rv-pane-lines')?.scrollTop??null])),selected:String(getSelection()??'')}})())`).then((t) => JSON.parse(t));

  stage = 'a pane per code place, also within one file';
  await goToStep(caller.id);
  await delay(800);
  let at = await map();
  check('three places in one file are three panes of the walk\'s horizontal view, the caller\'s active', at.slots === 3 && at.active === 0 && at.identity.includes(caller.id), JSON.stringify(at));
  await w_shot(wc, '10-caller-pane');
  const startX = at.x;
  const topsAtStart = at.tops;
  await osClickAt(wc, '.rv-nav-next');
  await poll('the first function\'s pane active', async () => (await map()).identity.includes(first.id), 15_000);
  await delay(700);
  at = await map();
  check('Next activates the next pane, moving the map sideways; the caller\'s pane is still its own, not scrolled', at.active === 1 && at.identity.includes(first.id) && at.slots === 3 && at.x !== startX && (topsAtStart['0'] === undefined || at.tops['0'] === undefined || at.tops['0'] === topsAtStart['0']), JSON.stringify({ at, startX, topsAtStart }));
  await w_shot(wc, '11-next-pane');
  const firstX = at.x;
  await osClickAt(wc, '.rv-nav-next');
  await poll('the second function\'s pane active', async () => (await map()).identity.includes(second.id), 15_000);
  await delay(700);
  at = await map();
  check('Next again: the second function, in a third pane of the same file', at.active === 2 && at.identity.includes(second.id) && at.x !== firstX, JSON.stringify(at));
  await w_shot(wc, '12-second-pane');
  await osClickAt(wc, '.rv-nav-previous');
  await poll('back at the first function', async () => (await map()).identity.includes(first.id), 15_000);
  await delay(700);
  at = await map();
  const onScreen = JSON.parse(await walk.ev(`JSON.stringify((()=>{const v=document.querySelector('.rv-timeline-viewport').getBoundingClientRect();const p=document.querySelector('section.rv-pane-active').getBoundingClientRect();return {inside:p.left>=v.left-1&&p.right<=v.right+1}})())`));
  // The map places a pane where moving to it travels least, so its offset may differ by direction; the pane and its view are its own.
  check('Previous returns to the first function\'s own pane, on screen, its view as it was (not scrolled)', at.active === 1 && onScreen.inside && JSON.stringify(at.tops) === JSON.stringify(topsAtStart), JSON.stringify({ at, firstX, onScreen }));
  check('Step follows: the panel shows the first function\'s step', (await shown()).step === first.id);

  stage = 'Shift with the left button dragged from over the code pans the map';
  await goToStep(caller.id);
  await delay(800);
  const beforeDrag = await map();
  const code = await pointAt(wc, 'section.rv-pane-active .rv-pane-lines [data-focus-active="1"] code', null);
  check('the drag starts over the code text of the active pane', code.hit === true, JSON.stringify(code));
  await activate(walkWindow.id);
  xdotool('mousemove', '--sync', String(code.physical.x), String(code.physical.y));
  await delay(150);
  xdotool('keydown', 'shift');
  await delay(120);
  xdotool('mousedown', '1');
  for (let step = 1; step <= 8; step += 1) {
    xdotool('mousemove', '--sync', String(code.physical.x - step * 60), String(code.physical.y));
    await delay(60);
  }
  await delay(150);
  const during = await map();
  xdotool('mouseup', '1');
  xdotool('keyup', 'shift');
  await delay(900);
  const afterDrag = await map();
  check('the drag panned the map sideways and selected no text', during.x !== null && beforeDrag.x !== null && during.x > beforeDrag.x + 100 && afterDrag.selected === '' && during.selected === '', JSON.stringify({ beforeDrag, during, afterDrag }));
  await w_shot(wc, '20-shift-drag-from-code');
  // The same over code that already holds a text selection, where a press may start dragging the
  // selected text instead, and with the keyboard focus in the docked panel (Shift is then seen by
  // the panel's page first): the cases where a drag over code was swallowed.
  await goToStep(caller.id);
  await delay(800);
  const word = await pointAt(wc, 'section.rv-pane-active .rv-pane-lines [data-focus-active="1"] code', null);
  xdotool('mousemove', '--sync', String(word.physical.x), String(word.physical.y));
  await delay(120);
  xdotool('click', '--repeat', '2', '--delay', '80', '1');
  await delay(300);
  const selectedFirst = (await map()).selected;
  await osClickAt(pc, '[data-ev="discussion-composer"],[data-ev="right-tab-step"]');
  const beforeSecond = await map();
  xdotool('mousemove', '--sync', String(word.physical.x), String(word.physical.y));
  await delay(150);
  xdotool('keydown', 'shift');
  await delay(120);
  xdotool('mousedown', '1');
  for (let step = 1; step <= 8; step += 1) {
    xdotool('mousemove', '--sync', String(word.physical.x - step * 60), String(word.physical.y));
    await delay(60);
  }
  await delay(150);
  const duringSecond = await map();
  xdotool('mouseup', '1');
  xdotool('keyup', 'shift');
  await delay(900);
  check('also from over selected code, with the keyboard in the panel, the drag pans the map', selectedFirst !== '' && duringSecond.x !== null && beforeSecond.x !== null && duringSecond.x > beforeSecond.x + 100, JSON.stringify({ selectedFirst, beforeSecond, duringSecond }));
  await w_shot(wc, '21-shift-drag-over-selection');

  stage = 'an explanation\'s references: a step of another walk and back, and lines in the diff and back';
  await goToStep(first.id);
  await delay(800);
  await clickInPanel('right-tab-step');
  await chooseOption(pc, '[data-ev="presentation-profile"]', 'essens', 'Es');
  await poll('the Essentials explanation of the first function', async () => (await shown()).profileShown === 'essens', 60_000);
  if ((await read(pc, `document.querySelector('[data-ev="profile-explanation"] [data-ev="answer-refs"]')?.hidden ?? null`)) === true) {
    await osClickAt(pc, '[data-ev="profile-explanation"] [data-ev="answer-show-code"]');
  }
  const links = JSON.parse(await read(pc, `JSON.stringify({steps:[...document.querySelectorAll('[data-ev="profile-explanation"] [data-ev="answer-step-ref"]')].map((b)=>({step:b.dataset.step,text:b.textContent})),code:[...document.querySelectorAll('[data-ev="profile-explanation"] [data-ev="answer-ref"]')].map((b)=>({ref:b.dataset.ref,kind:b.dataset.kind}))})`));
  const across = links.steps.find((entry) => entry.step.startsWith(`${otherWalk}.`));
  const diffLink = links.code.find((entry) => entry.kind === 'diff');
  check('the explanation links a step of the other walk and lines of the diff outside the walk', across !== undefined && diffLink !== undefined, JSON.stringify(links));
  await w_shot(pc, '30-explanation-references');
  const beforeLink = await map();
  await osClickAt(pc, `[data-ev="profile-explanation"] [data-ev="answer-step-ref"][data-step="${across.step}"]`);
  await poll('the other walk\'s step', async () => (await shown()).step === across.step, 15_000);
  await delay(700);
  const there = await map();
  check('the link goes to the step in the other walk: Step shows it and the map marks its place', there.identity.includes(across.step), JSON.stringify(there));
  await w_shot(wc, '31-other-walk-step');
  check('the way back names the step it was followed from', (await read(pc, `document.querySelector('[data-ev="step-link-back"]')?.textContent ?? ''`)).includes(`Back to ${first.id}`));
  await osClickAt(pc, '[data-ev="step-link-back"]');
  await poll('back at the first function', async () => (await shown()).step === first.id, 15_000);
  await delay(700);
  const back = await map();
  check('Back returns to the walk and the place it was followed from', back.identity.includes(first.id) && back.active === beforeLink.active, JSON.stringify({ back, beforeLink }));
  if ((await read(pc, `document.querySelector('[data-ev="profile-explanation"] [data-ev="answer-refs"]')?.hidden ?? null`)) === true) {
    await osClickAt(pc, '[data-ev="profile-explanation"] [data-ev="answer-show-code"]');
  }
  const [, diffPath, diffLines] = /^(?:base|target):(.+):(\d+-\d+)$/.exec(diffLink.ref) ?? [];
  await osClickAt(pc, `[data-ev="profile-explanation"] [data-ev="answer-ref"][data-ref="${diffLink.ref}"]`);
  await walk.until('the referenced lines opened', `document.querySelector('[data-ev="away-back"]')!==null && document.querySelectorAll('.rv-code-pane .rv-ref-mark').length > 0`, 15_000);
  const opened = JSON.parse(await walk.ev(`JSON.stringify({path:document.querySelector('.rv-code-pane .rv-path')?.title??'',marked:[...document.querySelectorAll('.rv-code-pane .rv-ref-mark')].map((r)=>({line:Number(r.dataset.selLine),path:r.dataset.selPath})),bar:document.querySelector('[data-ev="away-back"]')?.closest('div')?.textContent??''})`));
  const [from, to] = (diffLines ?? '0-0').split('-').map(Number);
  check('the reference opens that file with exactly its lines marked, and says where it is and the way back', opened.path === diffPath && opened.marked.length === to - from + 1 && opened.marked.every((row) => row.line >= from && row.line <= to) && /Back to/.test(opened.bar), JSON.stringify({ ref: diffLink.ref, opened }));
  await w_shot(wc, '32-diff-reference-marked');
  await osClickAt(wc, '[data-ev="away-back"]');
  await walk.until('back in the walk', `document.querySelector('[data-ev="away-back"]')===null`, 15_000);
  await delay(700);
  const returned = await map();
  // Measured against where the walk was when the reference was followed (after the step link's Back).
  check('Back from the code restores the walk where it was: the same place, the map at the same offset', returned.identity.includes(first.id) && returned.active === back.active && Math.abs(returned.x - back.x) <= 2 && (await shown()).step === first.id, JSON.stringify({ returned, back }));
  await w_shot(wc, '33-back-in-the-walk');
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
