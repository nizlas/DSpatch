// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The review-instances trial (DSP-186), on the walk trial's plumbing (copied from
 * scripts/walk-trial.mjs, which has it from the profile, thread and dock trials). DSpatch's real
 * windows over an isolated profile and a disposable neutral Git repository; the provider
 * SIMULATED (the presentation adapter in its default scenario). Controls are pressed through the
 * operating system (xdotool) at the place the page says they are; what pages and the profile's
 * files say is read beside.
 *
 * It checks that every review is an instance of its own: two reviews of the same commit pair
 * have their own walks, marks and discussion, are listed apart, are open at once in walk windows
 * of their own, close and reopen with exactly their own data, stay apart after the client is
 * restarted on the same profile, and that deleting one (after the window's confirmation) removes
 * only its files. A synthetic version 1 pair record, written into the profile before the first
 * start, opens as a review with its marks, and the pair records are backed up once before the
 * first write. What it proves is the structure and the windows' behaviour with simulated answers.
 *
 *     node scripts/review-instances-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build` (or DSPATCH_TRIAL_CLIENT naming a packaged client's executable). On
 * Linux: xdotool, ImageMagick's import, xprop, Xvfb and openbox. With no DISPLAY, Xvfb and
 * openbox are started here on a free display among :140–:149 (REVIEW_TRIAL_DISPLAY picks one)
 * and stopped at the end. The whole run is bounded by REVIEW_TRIAL_LIMIT_MS (25 minutes by
 * default): past it everything this trial started is ended and it fails.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import crypto from 'node:crypto';

const onWindows = process.platform === 'win32';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const helpers = path.join(scriptDir, 'dock-trial');
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-review-instances', `${String(process.pid)}-${String(Date.now())}`));
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
const LIMIT_MS = Number(process.env.REVIEW_TRIAL_LIMIT_MS ?? 25 * 60_000);
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
  results.push({ stage, what, ok: true, note: true, detail });
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

// --- Reading the profile's review files ---------------------------------------------------------

const reviewsDir = () => path.join(profile, 'reviews');
const pairsDir = () => path.join(reviewsDir(), 'pairs');
const exists = (file) => fs.existsSync(file);
/** The reviews started since review ids: `r-` and 24 hex. */
const reviewIds = () => (exists(pairsDir()) ? fs.readdirSync(pairsDir()) : []).filter((name) => /^r-[0-9a-f]{24}\.json$/.test(name)).map((name) => name.slice(0, -'.json'.length));
const recordOf = (id) => JSON.parse(fs.readFileSync(path.join(pairsDir(), `${id}.json`), 'utf8'));
const backups = () => (exists(reviewsDir()) ? fs.readdirSync(reviewsDir()) : []).filter((name) => /^backup-.*-pre-review-ids$/.test(name));
function walkDefinitions(id) {
  const folder = path.join(reviewsDir(), 'generated', id);
  return exists(folder) ? fs.readdirSync(folder).filter((name) => name.endsWith('.review.json')).map((name) => path.join(folder, name)).sort() : [];
}
function questionsOf(id) {
  const file = path.join(reviewsDir(), `${id}.discussion.json`);
  if (!exists(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf8')).messages ?? []).filter((message) => message.role === 'question');
}
/** Every file or folder in the profile's reviews folder whose name holds a review's id. */
function filesNaming(id) {
  const found = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.name.includes(id)) found.push(path.relative(reviewsDir(), full));
      if (entry.isDirectory()) walk(full);
    }
  };
  if (exists(reviewsDir())) walk(reviewsDir());
  return found;
}
function saveRecords() {
  try {
    const copy = path.join(evidence, 'reviews-folder');
    if (exists(reviewsDir())) fs.cpSync(reviewsDir(), copy, { recursive: true });
  } catch {
    // Evidence only; the trial's result stands without it.
  }
}

// --- The windows ---------------------------------------------------------------------------------

const ev = (name) => `[data-ev="${name}"]`;
const live = async () => (await client.main.windows()).filter((w) => !w.destroyed);
const diffWindows = async () => (await live()).filter((w) => isDiffPage(w.url));
const walkWindows = async () => (await live()).filter((w) => isWalkPage(w.url));
async function panelContents() {
  const found = [];
  for (const w of await live()) for (const view of w.views) if (isPanelPage(view.url)) found.push({ cid: view.contentsId, frameId: w.id, docked: w.url !== '' });
  return found;
}
const truthy = async (cid, expression) => (await read(cid, expression).catch(() => null)) === true;
const waitIn = (cid, what, expression, ms = 30_000) => poll(what, () => truthy(cid, expression), ms);
/** The definition a review window shows, as main gave it to the window. */
const definitionIn = (cid) => read(cid, `window.dspatchReview.initial().then((o) => o.kind === 'opened' ? o.bundle.definitionPath : 'none: ' + (o.note ?? ''))`);
const inFolderOf = (file, id) => typeof file === 'string' && path.resolve(file).startsWith(`${path.join(reviewsDir(), 'generated', id)}${path.sep}`);

/** A control pressed through the operating system where its page says it is, its window brought forward first. */
async function press(cid, selector, what = selector) {
  await waitIn(cid, `${what} present and enabled`, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e!==null && !e.disabled})()`, 30_000);
  let at = await pointAt(cid, selector);
  await activate(at.windowId);
  await delay(250);
  at = await pointAt(cid, selector);
  for (let attempt = 0; attempt < 5 && !at.hit; attempt += 1) {
    await delay(300);
    at = await pointAt(cid, selector);
  }
  if (!at.hit) throw new Error(`${what}: the page does not find it at its own point ${JSON.stringify(at)}`);
  await osClick(at.physical);
}
async function shot(windowId, name) {
  const w = await activate(windowId);
  await delay(400);
  await shotWindow(w, name).catch((error) => note(`screenshot ${name} failed`, String(error)));
}

const turnCount = (cid) => read(cid, `document.querySelectorAll('.rv-discussion-turn').length`);
const lastAnswerStatus = (cid) => read(cid, `[...document.querySelectorAll('.rv-discussion-answer')].at(-1)?.dataset.status ?? ''`);
const discussionText = (cid) => read(cid, `document.querySelector('[data-ev="discussion"]')?.textContent ?? ''`);
const manualStrips = (dc) => read(dc, `document.querySelectorAll('td.rv-pair-strip[data-strip="manual"]').length`);
const walksState = (dc) =>
  read(dc, `JSON.stringify({disabled: document.querySelector('[data-ev="pair-walks"]')?.getAttribute('aria-disabled') ?? null, tip: document.querySelector('[data-ev="pair-walks"]')?.dataset.tip ?? null})`).then((text) => JSON.parse(text));

/** Back to Files changed, where the review's own tools are. */
async function toFiles(dc) {
  if (await truthy(dc, `${q('pair-files')}!==null`)) await press(dc, ev('pair-files'));
  await waitIn(dc, 'Files changed', `${q('pair-file-0')}!==null && ${q('pair-discussion')}!==null`);
}
async function openFile(dc, name) {
  await toFiles(dc);
  const which = await read(dc, `[...document.querySelectorAll('[data-ev^="pair-file-"][data-file-row]')].find((e) => e.textContent.includes(${JSON.stringify(name)}))?.dataset.ev ?? null`);
  if (which === null) throw new Error(`no ${name} among the files changed`);
  await press(dc, ev(which));
  await waitIn(dc, `${name} shown`, `document.querySelector('td.rv-pair-strip[data-side="target"]')!==null`);
  await delay(400);
}

/** From wherever a diff window is, a new review of the repository's last two commits. */
async function startNewReview(dc, label) {
  await waitIn(dc, 'the way into review', `${q('pair-new-review')}!==null || ${q('pair-repo-0')}!==null || ${q('pair-commit-1')}!==null`, 60_000);
  if (await truthy(dc, `${q('pair-new-review')}!==null`)) await press(dc, ev('pair-new-review'));
  await waitIn(dc, 'the repositories or the log', `${q('pair-repo-0')}!==null || ${q('pair-commit-1')}!==null`);
  if (await truthy(dc, `${q('pair-repo-0')}!==null`)) {
    const which = await read(dc, `[...document.querySelectorAll('[data-ev^="pair-repo-"]')].find((e) => e.textContent.includes(${JSON.stringify(path.basename(project))}))?.dataset.ev ?? 'pair-repo-0'`);
    await press(dc, ev(which));
  }
  await waitIn(dc, 'the log', `${q('pair-commit-1')}!==null`);
  const chosen = (count) => `document.querySelectorAll('.rv-pair-commit[aria-pressed=true]').length === ${String(count)}`;
  const before = new Set(reviewIds());
  await press(dc, ev('pair-commit-1'));
  await waitIn(dc, 'From chosen', chosen(1));
  await press(dc, ev('pair-commit-0'));
  await waitIn(dc, 'both chosen', chosen(2));
  await press(dc, ev('pair-open'));
  await waitIn(dc, `${label} opened`, `${q('pair-discussion')}!==null`, 60_000);
  return poll(`${label}: its record`, () => reviewIds().find((id) => !before.has(id)) ?? false, 20_000);
}

/** Prepare code walks with the simulated agent; the walk window it opens. */
async function prepareWalks(dc, id, label) {
  await toFiles(dc);
  const known = new Set((await walkWindows()).map((w) => w.id));
  await press(dc, ev('pair-prepare-walks'));
  await press(dc, ev('pair-walks-agent-start'));
  let w = await poll(`${label}: a walk window`, async () => (await walkWindows()).find((x) => !known.has(x.id)) ?? false, 120_000).catch(() => null);
  if (w === null) {
    await waitIn(dc, `${label}: walks ready`, `${q('pair-walks')}?.getAttribute('aria-disabled')==='false'`, 60_000);
    await press(dc, ev('pair-walks'));
    w = await poll(`${label}: a walk window`, async () => (await walkWindows()).find((x) => !known.has(x.id)) ?? false, 30_000);
  }
  await waitIn(w.contentsId, `${label}: the walk drawn`, `document.querySelectorAll('section.rv-pane').length > 0`, 60_000);
  await poll(`${label}: walks written to its folder`, () => walkDefinitions(id).length > 0, 30_000);
  return w;
}

/** The walk window over one review's walks, if one is open. */
async function walkWindowOf(id) {
  for (const w of await walkWindows()) if (inFolderOf(await definitionIn(w.contentsId), id)) return w;
  return null;
}

const panelOf = {};
/** The review's discussion panel, shown from its diff window, on Discussion. */
async function panelFor(id, dc) {
  await toFiles(dc);
  await press(dc, ev('pair-discussion'));
  const cid = await poll(`${id}: its discussion panel`, async () => {
    const all = await panelContents();
    if (panelOf[id] !== undefined && all.some((p) => p.cid === panelOf[id])) return panelOf[id];
    const others = new Set(Object.entries(panelOf).filter(([key]) => key !== id).map(([, value]) => value));
    const fresh = all.filter((p) => !others.has(p.cid));
    return fresh.length === 1 ? fresh[0].cid : false;
  }, 30_000);
  panelOf[id] = cid;
  await waitIn(cid, 'the panel drawn', `${q('right-tab-discussion')}!==null || ${q('discussion-composer')}!==null`, 30_000);
  if (!(await truthy(cid, `${q('discussion-composer')}?.offsetParent!=null`))) await press(cid, ev('right-tab-discussion'));
  await waitIn(cid, 'the question field', `${q('discussion-composer')}?.offsetParent!=null`, 20_000);
  const shows = await definitionIn(cid).catch(() => null);
  if (typeof shows === 'string' && shows.includes(`${path.sep}reviews${path.sep}`)) {
    check(`${id}: the panel is that review's discussion`, shows.includes(id), shows);
  }
  return cid;
}
async function ask(pc, text) {
  const before = await turnCount(pc);
  await press(pc, ev('discussion-composer'));
  await osKey('ctrl+End');
  await osType(text);
  await osKey('Return');
  await poll('the question shown', async () => (await turnCount(pc)) > before, 20_000);
  await poll('the answer done', async () => (await lastAnswerStatus(pc)) === 'done', 120_000);
}

/** The reviews a diff window lists, from wherever it is. */
async function showList(dc) {
  if (await truthy(dc, `${q('pair-new-review')}!==null`)) return;
  if (!(await truthy(dc, `${q('pair-all-reviews')}!==null`))) await toFiles(dc);
  await press(dc, ev('pair-all-reviews'));
  await waitIn(dc, 'the list of reviews', `${q('pair-new-review')}!==null`);
}
const listed = (dc) =>
  read(dc, `JSON.stringify([...document.querySelectorAll('li[data-review]')].map((li) => ({ id: li.dataset.review, closed: li.closest('[data-ev="pair-closed-list"]') !== null, text: li.innerText.replace(/\\s+/g, ' ') })))`).then((text) => JSON.parse(text ?? '[]'));
const rowControl = (id, prefix) => `li[data-review="${id}"] [data-ev^="${prefix}"]`;
async function openFromList(dc, id, closed = false) {
  await press(dc, rowControl(id, closed ? 'pair-closed-open-' : 'pair-ongoing-open-'));
  await waitIn(dc, `${id} opened`, `${q('pair-discussion')}!==null`, 60_000);
}

// --- The trial -----------------------------------------------------------------------------------

function chooseDisplay() {
  const wanted = process.env.REVIEW_TRIAL_DISPLAY;
  const numbers = wanted ? [Number(wanted.replace(':', ''))] : [140, 141, 142, 143, 144, 145, 146, 147, 148, 149];
  const free = numbers.find((n) => !exists(`/tmp/.X11-unix/X${String(n)}`) && !exists(`/tmp/.X${String(n)}-lock`));
  if (free === undefined) throw new Error(`no free X display among ${numbers.join(', ')}`);
  return free;
}

async function openProjectAndReview(main) {
  await main.until('the recent project', `${q('open-project-0')}!==null`, 60_000);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
}

async function scenario() {
  stage = 'preflight';
  check('xdotool and import are here', run('sh', ['-c', 'command -v xdotool && command -v import'], true) !== '');
  check('the client is here', packaged ? exists(packaged) : exists(path.join(appDir, 'dist', 'main', 'main.js')) && exists(path.join(appDir, 'dist', 'renderer', 'index.html')));
  if (display === '' && !onWindows) {
    const number = chooseDisplay();
    display = `:${String(number)}`;
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    await poll('Xvfb', () => exists(`/tmp/.X11-unix/X${String(number)}`), 15_000);
    owned.wm = spawn('openbox', [], { env: { ...process.env, DISPLAY: display }, stdio: 'ignore' });
    await delay(800);
  }
  if (!onWindows) run('setxkbmap', ['-display', display, 'us'], true);
  note('the display', `${display}; WM ${owned.wm === null ? 'already there' : 'openbox'}; client ${packaged || 'this checkout'}`);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-instances-profile-'));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-instances-project-')));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  // Neutral invented code: a readme first, then the walk trial's synthetic case in two commits.
  const versions = [
    { 'README.md': '# Counter\n\nA small invented example.\n' },
    {
      'src/worker.js': ['export function run(items, n) {', '  return n;', '}', '', 'const state = {};', 'export const spare1 = 1;', 'export const spare2 = 2;', ''].join('\n'),
      'src/format.js': ['export function formatPair(a, b) {', "  return a + '/' + b;", '}', ''].join('\n'),
    },
    {
      'src/worker.js': [
        'export function run(items, n) {', '  startWorker();', '  subscribeToPairs(items, n);', '  return n;', '}', '', 'const state = {};',
        'function startWorker() {', '  state.worker = { running: true, connected: false };', '  state.worker.queue = [];', '}',
        'export const spare1 = 1;', 'export const spare2 = 2;',
        'function subscribeToPairs(items, n) {', '  const pairs = items.slice(0, n).map((item, index) => [index, item]);', '  state.worker.queue.push(...pairs);', '  return pairs.length;', '}', '',
      ].join('\n'),
      'src/format.js': ['export function formatPair(a, b) {', "  return a + ' / ' + b;", '}', ''].join('\n'),
    },
  ];
  const commits = [];
  for (const [index, files] of versions.entries()) {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(project, name), text);
    git('add', '.');
    git('commit', '-qm', `Commit ${String(index + 1)}`);
    commits.push(git('rev-parse', 'HEAD'));
  }

  stage = 'a review recorded before review ids, seeded in the profile';
  // Synthetic, as DSpatch 0.1.11 wrote it: a version 1 record named by its pair key, over
  // Commit 1 → Commit 2, closed, with lines 1–3 of src/worker.js marked reviewed.
  const legacyPair = { repository: project, base: commits[0], target: commits[1] };
  const legacy = crypto.createHash('sha256').update(`${project}\0${legacyPair.base}\0${legacyPair.target}`).digest('hex').slice(0, 24);
  const legacyText = `${JSON.stringify({
    version: 1,
    pair: legacyPair,
    requirement: 'manual',
    marks: [{ id: 'm1', op: 'manual', scope: { kind: 'lines', side: 'target', path: 'src/worker.js', start: 1, end: 3 }, reason: '', at: '2026-11-01T10:00:00.000Z' }],
    agentReviews: [],
    jobs: [],
    agent: null,
    position: { view: 'files', fileKey: null, layout: 'unified', line: null },
    walkDefinition: null,
    endedAt: '2026-11-02T10:00:00.000Z',
    threads: [],
    savedAt: '2026-11-02T10:00:00.000Z',
  }, null, 2)}\n`;
  fs.mkdirSync(pairsDir(), { recursive: true });
  fs.writeFileSync(path.join(pairsDir(), `${legacy}.json`), legacyText);
  fs.writeFileSync(path.join(pairsDir(), 'recent.json'), '{}\n');
  note('the seeded record', `${legacy}.json over ${legacyPair.base.slice(0, 7)} → ${legacyPair.target.slice(0, 7)}`);

  stage = 'review A of a commit pair';
  let main = await launch('first');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  await openProjectAndReview(main);
  await main.click('open-review');
  const d1 = await poll('the review window', async () => (await diffWindows())[0] ?? false, 30_000);
  const dc1 = d1.contentsId;
  await client.main.size(d1.id, 1400, 900);
  await waitIn(dc1, 'the list of reviews', `${q('pair-new-review')}!==null`, 60_000);
  let rows = await listed(dc1);
  check('the earlier review is listed as a closed review before anything is written', rows.some((row) => row.id === legacy && row.closed), JSON.stringify(rows));
  check('listing wrote nothing and took no backup', backups().length === 0 && fs.readFileSync(path.join(pairsDir(), `${legacy}.json`), 'utf8') === legacyText, JSON.stringify(backups()));
  await shot(d1.id, '01-list-with-earlier-review');
  const A = await startNewReview(dc1, 'review A');
  let record = recordOf(A);
  check('review A has an id of its own and names the pair Commit 2 → Commit 3', /^r-[0-9a-f]{24}$/.test(A) && record.version === 2 && record.id === A && record.pair.base === commits[1] && record.pair.target === commits[2] && record.marks.length === 0, JSON.stringify({ A, pair: record.pair }));
  const taken = backups();
  check('the first write took one backup of the pair records, holding the earlier record as it was', taken.length === 1 && fs.readFileSync(path.join(reviewsDir(), taken[0], `${legacy}.json`), 'utf8') === legacyText && exists(path.join(reviewsDir(), taken[0], 'recent.json')), JSON.stringify(taken));

  const wA = await prepareWalks(dc1, A, 'review A');
  const walksA = walkDefinitions(A);
  check('A: walks prepared into its own folder, and its walk window shows one of them', walksA.length > 0 && inFolderOf(await definitionIn(wA.contentsId), A), JSON.stringify({ walksA, shown: await definitionIn(wA.contentsId) }));
  await openFile(dc1, 'worker.js');
  await press(dc1, 'td.rv-pair-strip[data-side="target"]', 'a changed line of worker.js');
  await press(dc1, ev('pair-mark-manual'));
  await poll('A: the line marked', async () => (await manualStrips(dc1)) > 0, 15_000);
  check('A: a line marked reviewed in the window and in its record', (await manualStrips(dc1)) === 1 && recordOf(A).marks.length === 1, JSON.stringify(recordOf(A).marks));
  await shot(d1.id, '02-A-line-marked');
  const pcA = await panelFor(A, dc1);
  const questionA = 'Question for review A: what does startWorker set up?';
  await ask(pcA, questionA);
  const turnsA = await turnCount(pcA);
  check('A: the question and its answer in its discussion, and in its own discussion file', (await discussionText(pcA)).includes(questionA) && questionsOf(A).length === 1 && JSON.stringify(questionsOf(A)).includes('startWorker'), JSON.stringify({ turnsA, saved: questionsOf(A).length }));
  await shot((await pointAt(pcA, 'body', null)).windowId, '03-A-discussion');

  stage = 'review B of the same pair starts empty';
  await main.click('open-review');
  const d2 = await poll('a second review window', async () => (await diffWindows()).find((w) => w.id !== d1.id) ?? false, 30_000);
  const dc2 = d2.contentsId;
  await client.main.size(d2.id, 1400, 900);
  await waitIn(dc2, 'the list of reviews', `${q('pair-new-review')}!==null`, 60_000);
  rows = await listed(dc2);
  check('the second window lists A as open', rows.some((row) => row.id === A && !row.closed), JSON.stringify(rows));
  const B = await startNewReview(dc2, 'review B');
  record = recordOf(B);
  check('review B has another id over the same pair', B !== A && record.id === B && record.pair.base === commits[1] && record.pair.target === commits[2], JSON.stringify({ A, B }));
  const walksB0 = await walksState(dc2);
  check('B: no code walks yet ("No code walks yet"), none in its folder', walksB0.disabled === 'true' && walksB0.tip === 'No code walks yet' && walkDefinitions(B).length === 0, JSON.stringify(walksB0));
  await openFile(dc2, 'worker.js');
  check('B: no line marked, in the window or its record', (await manualStrips(dc2)) === 0 && recordOf(B).marks.length === 0, String(await manualStrips(dc2)));
  await shot(d2.id, '04-B-no-marks');
  const pcB = await panelFor(B, dc2);
  const textB = await discussionText(pcB);
  check('B: its own discussion panel, empty; nothing of A\'s question', pcB !== pcA && (await turnCount(pcB)) === 0 && !textB.includes(questionA) && questionsOf(B).length === 0, JSON.stringify({ pcA, pcB, turns: await turnCount(pcB) }));
  await shot((await pointAt(pcB, 'body', null)).windowId, '05-B-empty-discussion');
  const wB = await prepareWalks(dc2, B, 'review B');
  const walksB = walkDefinitions(B);
  check('B: walks prepared into its own folder, in a walk window of its own', walksB.length > 0 && wB.id !== wA.id && inFolderOf(await definitionIn(wB.contentsId), B) && walksB.every((file) => !walksA.includes(file)), JSON.stringify({ walksB, shown: await definitionIn(wB.contentsId) }));
  check('A\'s walks are as they were', JSON.stringify(walkDefinitions(A)) === JSON.stringify(walksA));

  stage = 'both reviews listed, and open at once';
  await showList(dc1);
  rows = await listed(dc1);
  check('A and B are listed as two open reviews; the earlier one as closed', rows.filter((row) => row.id === A && !row.closed).length === 1 && rows.filter((row) => row.id === B && !row.closed).length === 1 && rows.some((row) => row.id === legacy && row.closed), JSON.stringify(rows));
  await shot(d1.id, '06-list-A-and-B');
  await press(dc1, ev('pair-back-review'));
  await waitIn(dc1, 'back in A', `${q('pair-discussion')}!==null`);
  const walkNow = await walkWindows();
  const shownA = await definitionIn(wA.contentsId);
  const shownB = await definitionIn(wB.contentsId);
  const drawn = async (w) => read(w.contentsId, `document.querySelectorAll('section.rv-pane').length`);
  check(
    'two walk windows open at once, each over its own review\'s walks, both drawn',
    walkNow.some((w) => w.id === wA.id) && walkNow.some((w) => w.id === wB.id) && inFolderOf(shownA, A) && inFolderOf(shownB, B) && (await drawn(wA)) > 0 && (await drawn(wB)) > 0,
    JSON.stringify({ shownA, shownB }),
  );
  await openFile(dc1, 'worker.js');
  await openFile(dc2, 'worker.js');
  check('the two diff windows keep their own marks: A one, B none', (await manualStrips(dc1)) === 1 && (await manualStrips(dc2)) === 0);
  await shot(wA.id, '07-A-walk-window');
  await shot(wB.id, '08-B-walk-window');

  stage = 'close A, and reopen it';
  await showList(dc1);
  await press(dc1, rowControl(A, 'pair-ongoing-end-'), 'Close review on A');
  await poll('A listed as closed', async () => (await listed(dc1)).some((row) => row.id === A && row.closed), 15_000);
  rows = await listed(dc1);
  check('closed: A is listed under Closed, B still open, A\'s record kept with its end time', rows.some((row) => row.id === A && row.closed) && rows.some((row) => row.id === B && !row.closed) && recordOf(A).endedAt !== null && recordOf(A).marks.length === 1, JSON.stringify(rows));
  await shot(d1.id, '09-A-closed');
  await press(dc1, rowControl(A, 'pair-closed-reopen-'), 'Reopen on A');
  await waitIn(dc1, 'A reopened', `${q('pair-discussion')}!==null`, 60_000);
  check('reopened: A\'s record is open again', recordOf(A).endedAt === null);
  await openFile(dc1, 'worker.js');
  check('reopened: A\'s mark is back', (await manualStrips(dc1)) === 1);
  await toFiles(dc1);
  const walksReopened = await walksState(dc1);
  await press(dc1, ev('pair-walks'));
  const wA2 = await poll('A\'s walk window', () => walkWindowOf(A), 30_000);
  check('reopened: A\'s walks are offered and open over its own walks', walksReopened.disabled === 'false' && JSON.stringify(walkDefinitions(A)) === JSON.stringify(walksA) && inFolderOf(await definitionIn(wA2.contentsId), A), JSON.stringify(walksReopened));
  const pcA2 = await panelFor(A, dc1);
  check('reopened: A\'s discussion is back with its question', (await discussionText(pcA2)).includes(questionA) && (await turnCount(pcA2)) === turnsA, String(await turnCount(pcA2)));

  stage = 'after a restart on the same profile';
  await quitClient();
  for (const key of Object.keys(panelOf)) delete panelOf[key];
  main = await launch('second');
  await openProjectAndReview(main);
  await delay(2500);
  const restored = await diffWindows();
  note('review windows open by themselves after the restart', String(restored.length));
  await main.click('open-review');
  const d3 = await poll('the review window', async () => (await diffWindows())[0] ?? false, 30_000);
  let dc3 = d3.contentsId;
  if ((await diffWindows()).length > 1) note('more than one review window after the restart', JSON.stringify((await diffWindows()).map((w) => w.url)));
  await client.main.size(d3.id, 1400, 900);
  await waitIn(dc3, 'the list or a review', `${q('pair-new-review')}!==null || ${q('pair-all-reviews')}!==null`, 60_000);
  await showList(dc3);
  rows = await listed(dc3);
  check('after the restart: A and B are still two open reviews, the earlier one closed', rows.filter((row) => row.id === A && !row.closed).length === 1 && rows.filter((row) => row.id === B && !row.closed).length === 1 && rows.some((row) => row.id === legacy && row.closed), JSON.stringify(rows));
  await shot(d3.id, '10-list-after-restart');
  await openFromList(dc3, A);
  await openFile(dc3, 'worker.js');
  check('after the restart: A has its mark', (await manualStrips(dc3)) === 1);
  await toFiles(dc3);
  check('after the restart: A has its walks', (await walksState(dc3)).disabled === 'false' && JSON.stringify(walkDefinitions(A)) === JSON.stringify(walksA));
  const pcA3 = await panelFor(A, dc3);
  check('after the restart: A has its discussion', (await discussionText(pcA3)).includes(questionA), String(await turnCount(pcA3)));
  await main.click('open-review');
  const d4 = await poll('a second review window', async () => (await diffWindows()).find((w) => w.id !== d3.id) ?? false, 30_000);
  const dc4 = d4.contentsId;
  await client.main.size(d4.id, 1400, 900);
  await waitIn(dc4, 'the list of reviews', `${q('pair-new-review')}!==null`, 60_000);
  await openFromList(dc4, B);
  await openFile(dc4, 'worker.js');
  check('after the restart: B has no mark', (await manualStrips(dc4)) === 0);
  await toFiles(dc4);
  check('after the restart: B has its own walks', (await walksState(dc4)).disabled === 'false' && JSON.stringify(walkDefinitions(B)) === JSON.stringify(walksB));
  const pcB3 = await panelFor(B, dc4);
  check('after the restart: B\'s discussion is still empty', pcB3 !== pcA3 && (await turnCount(pcB3)) === 0 && !(await discussionText(pcB3)).includes(questionA));
  await shot(d4.id, '11-B-after-restart');

  stage = 'delete B';
  const bFiles = filesNaming(B);
  note('B\'s files before the deletion', JSON.stringify(bFiles));
  const aFiles = filesNaming(A);
  await showList(dc3);
  await press(dc3, `${rowControl(B, 'pair-ongoing-delete-')}:not([data-ev*="-yes-"]):not([data-ev*="-no-"])`, 'Delete… on B');
  await waitIn(dc3, 'the confirmation', `document.querySelector(${JSON.stringify(rowControl(B, 'pair-ongoing-confirm-'))})!==null`, 10_000);
  check('Delete… asks first, and nothing is deleted before the answer', exists(path.join(pairsDir(), `${B}.json`)) && walkDefinitions(B).length > 0, await read(dc3, `document.querySelector(${JSON.stringify(rowControl(B, 'pair-ongoing-confirm-'))}).textContent`));
  await shot(d3.id, '12-delete-confirmation');
  await press(dc3, rowControl(B, 'pair-ongoing-delete-yes-'), 'Delete (confirmed) on B');
  await poll('B gone from the list', async () => !(await listed(dc3)).some((row) => row.id === B) && (await truthy(dc3, `${q('pair-new-review')}!==null`)), 30_000);
  rows = await listed(dc3);
  const said = await read(dc3, `document.querySelector('[data-ev="pair-ongoing-note"]')?.textContent ?? ''`);
  check('B is gone from the list, A and the earlier review remain; the window says so', !rows.some((row) => row.id === B) && rows.some((row) => row.id === A && !row.closed) && rows.some((row) => row.id === legacy) && /deleted/i.test(said), JSON.stringify({ rows, said }));
  await poll('B\'s files removed', () => filesNaming(B).length === 0, 15_000).catch(() => undefined);
  check('B\'s files are gone from the profile\'s reviews folder (record, walks, discussion)', filesNaming(B).length === 0 && !exists(path.join(pairsDir(), `${B}.json`)) && !exists(path.join(reviewsDir(), 'generated', B)), JSON.stringify(filesNaming(B)));
  const windowsAfter = await live();
  check('B\'s review and walk windows were closed', !windowsAfter.some((w) => w.id === d4.id) && (await walkWindowOf(B)) === null, JSON.stringify(windowsAfter.map((w) => w.url)));
  check('A is intact: its files, walks and discussion as before', JSON.stringify(filesNaming(A).sort()) === JSON.stringify(aFiles.sort()) && JSON.stringify(walkDefinitions(A)) === JSON.stringify(walksA) && questionsOf(A).length === 1 && recordOf(A).marks.length === 1, JSON.stringify({ before: aFiles, after: filesNaming(A) }));
  check('the repository is untouched', run('git', ['-C', project, 'status', '--porcelain']) === '' && run('git', ['-C', project, 'rev-parse', 'HEAD']) === commits[2]);
  await shot(d3.id, '13-B-deleted');
  await openFromList(dc3, A);
  await openFile(dc3, 'worker.js');
  check('A still opens with its mark after B\'s deletion', (await manualStrips(dc3)) === 1);

  stage = 'the earlier review opens with its data';
  await showList(dc3);
  await press(dc3, rowControl(legacy, 'pair-closed-reopen-'), 'Reopen on the earlier review');
  await waitIn(dc3, 'the earlier review opened', `${q('pair-discussion')}!==null`, 60_000);
  await openFile(dc3, 'worker.js');
  const legacyMarked = await manualStrips(dc3);
  record = recordOf(legacy);
  check('the earlier review opens with its three marked lines, under its own key, now version 2', legacyMarked === 3 && record.version === 2 && record.id === legacy && record.marks.length === 1 && record.endedAt === null, JSON.stringify({ legacyMarked, version: record.version, id: record.id }));
  await shot(d3.id, '14-earlier-review-reopened');
  const finalBackups = backups();
  check('still exactly one backup folder, holding the earlier record as it was', finalBackups.length === 1 && finalBackups[0] === taken[0] && fs.readFileSync(path.join(reviewsDir(), finalBackups[0], `${legacy}.json`), 'utf8') === legacyText, JSON.stringify(finalBackups));
}

async function stopEverything() {
  try {
    client.child?.kill('SIGKILL');
  } catch {
    // Already gone.
  }
  try {
    const running = JSON.parse(fs.readFileSync(path.join(profile, 'host-running.json'), 'utf8'));
    process.kill(running.pid, 'SIGKILL');
  } catch {
    // No host of this trial.
  }
  owned.wm?.kill('SIGKILL');
  owned.xvfb?.kill('SIGKILL');
}
function finish() {
  const checks = results.filter((result) => !result.note);
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, display, profile, project, client: packaged || electron, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${checks.some((result) => !result.ok) ? 'FAILED' : 'ALL PASSED'}: ${String(checks.length)} checks; evidence ${evidence}`);
}

fs.mkdirSync(evidence, { recursive: true });
// Never hangs: past the limit everything this trial started is ended, and it fails.
const hardStop = setTimeout(() => {
  results.push({ stage, what: `the trial finished within ${String(LIMIT_MS)} ms`, ok: false, detail: 'hard limit reached' });
  console.error(`FAIL hard limit of ${String(LIMIT_MS)} ms reached in stage: ${stage}`);
  void stopEverything().finally(() => {
    saveRecords();
    finish();
    process.exit(2);
  });
}, LIMIT_MS);
try {
  await scenario();
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
    for (const name of ['host.log']) {
      try {
        fs.copyFileSync(path.join(profile, name), path.join(evidence, name));
      } catch {
        // Not written in this run.
      }
    }
  }
  owned.wm?.kill('SIGTERM');
  owned.xvfb?.kill('SIGTERM');
  clearTimeout(hardStop);
  finish();
}
