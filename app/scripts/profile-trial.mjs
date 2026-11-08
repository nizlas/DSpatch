// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The presentation-profile trial (DSP-176), on the thread trial's plumbing (copied from
 * scripts/thread-trial.mjs, which has it from the dock trial). DSpatch's real windows over an
 * isolated profile and a disposable, neutral project; the provider SIMULATED (the presentation
 * adapter: DSPATCH_REVIEW_SIM=threads, DSPATCH_REVIEW_SIM_PRESENT_MS and
 * DSPATCH_REVIEW_SIM_FAIL_PRESENT_STEP). Evidence is screenshots of the X display and OS-level
 * input; the discussion record on disk is read to count model calls and to see what each sent.
 *
 * It reads one walk step in Standard (the default, DSP-181), Essentials and Teacher at the same
 * zoom; checks that a profile asks only for the current step, shows the original (prepared)
 * explanation meanwhile, reuses what was generated without a call (also after a restart), asks
 * for a step's explanation when the reader arrives at it and settles (DSP-180), keeps late
 * answers and failures where they belong, gives Explain more simply the explanations already
 * shown, and asks follow-ups at the same level; that coverage and findings do not change; and
 * that the choice works docked and in the panel's own window, with zoom and an unsent draft.
 * Simulated answers show the UI and the data flow, never a real model's teaching.
 *
 * Updated for DSP-181 without a run (no Xvfb on the Windows machine it was updated on): its
 * expectations follow the code; the first run on Linux may still need adjusting.
 *
 *     node scripts/profile-trial.mjs [<evidence folder>]
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-profiles', `${String(process.pid)}-${String(Date.now())}`));
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
  // DSP-176: a step presented in a profile is written slowly enough to move on meanwhile, and
  // the first presentation of the step with the added lines fails once.
  DSPATCH_REVIEW_SIM_PRESENT_MS: '120',
  DSPATCH_REVIEW_SIM_FAIL_PRESENT_STEP: '67–78',
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
  const inner = `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;${block === null ? '' : `e.scrollIntoView({block:${JSON.stringify(block)}});`}const b=e.getBoundingClientRect();return {x:b.x+Math.min(b.width/2,40),y:b.y+b.height/2,w:b.width,h:b.height,top:b.y,left:b.x}})()`;
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

/** The review discussion's questions and answers as saved: what was asked, in which profile, and what was sent. */
function discussionRecord() {
  const found = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.discussion.json')) found.push(full);
    }
  };
  walk(profile);
  return found.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).messages ?? []);
}
const questions = () => discussionRecord().filter((message) => message.role === 'question');
const presents = () => questions().filter((message) => message.deepen?.action === 'present');

async function main() {
  stage = 'preflight';
  check('xdotool and import are here', run('sh', ['-c', 'command -v xdotool && command -v import'], true) !== '');
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  if (display === '' || process.env.PROFILE_TRIAL_OWN_DISPLAY === '1') {
    const number = 90 + (process.pid % 50);
    display = `:${String(number)}`;
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' });
    await poll('Xvfb', () => fs.existsSync(`/tmp/.X11-unix/X${String(number)}`), 15_000);
    owned.wm = spawn('openbox', [], { env: { ...process.env, DISPLAY: display }, stdio: 'ignore' });
    await delay(800);
  }
  run('setxkbmap', ['-display', display, 'us'], true);
  note('the display', `${display}; WM ${owned.wm === null ? 'already there' : 'openbox'}`);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-profiles-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-profiles-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  const lines = (count, text) => Array.from({ length: count }, (_, index) => text(index + 1)).join('\n');
  // A neutral project: a greeting module with three separate changes, so a walk has several steps.
  const keep = lines(30, (n) => `export const keep${String(n)} = ${String(n)};`);
  const stay = lines(30, (n) => `export const stay${String(n)} = ${String(n)};`);
  const versions = [
    {
      'src/app.js': `export function greet(name) {\n  if (name === '') return 'Hello';\n  return 'Hello, ' + name;\n}\n${keep}\nexport function shout(name) {\n  return name;\n}\n${stay}\n`,
      'src/count.js': `export const count = 1;\n`,
      'src/farewell.js': `export function farewell(name) {\n  return 'Goodbye, ' + name;\n}\n`,
    },
    {
      'src/app.js': `export function greet(name) {\n  return 'Hello, ' + name + '!';\n}\n${keep}\nexport function shout(name) {\n  return name.toUpperCase();\n}\n${stay}\n${lines(12, (n) => `export const added${String(n)} = ${String(n)};`)}\n`,
      'src/count.js': `export const count = 2;\n`,
      'src/farewell.js': `export function farewell(name) {\n  return 'Goodbye, ' + name + '.';\n}\n`,
    },
  ];
  for (const [index, files] of versions.entries()) {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(project, name), text);
    git('add', '.');
    git('commit', '-qm', `Commit ${String(index + 1)}`);
  }

  stage = 'a review with findings, and its walks';
  let main = await launch('profiles');
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
  for (const w of await client.main.windows()) await client.main.menu('dspatch-zoom-reset', w.id).catch(() => undefined);
  await diff.click('pair-delegate-all');
  await diff.click('pair-delegate-all-agent-start');
  await diff.until('what remains', `${q('pair-remaining')}!==null`, 120_000);
  const reviewState = async () => {
    if ((await diff.ev(`${q('pair-remaining')}===null`)) === true) await diff.ev(`${q('pair-files')}?.click()`);
    await diff.until('what remains', `${q('pair-remaining')}!==null`, 20_000);
    return JSON.stringify({ summary: await diff.ev(`${q('pair-summary')}?.textContent ?? ''`), remaining: await diff.ev(`${q('pair-remaining')}.textContent`), coverage: await diff.ev(`${q('agent-review-coverage')}?.textContent ?? ''`) });
  };
  const reviewBefore = await reviewState();
  note('the review before any profile', reviewBefore);
  await diff.click('pair-prepare-walks');
  await diff.click('pair-walks-agent-start');
  let walkWindow = await poll('the walk window', async () => (await client.main.windows()).find((x) => !x.destroyed && isWalkPage(x.url)) ?? false, 90_000).catch(() => null);
  if (walkWindow === null) {
    await diff.click('pair-walks');
    walkWindow = await windowShowing(isWalkPage, 'the walk window');
  }
  let walk = new Page(client.cdp, 'walk', isWalkPage);
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
  let pc = panel.view.contentsId;
  let wc = walkWindow.contentsId;
  const goToStep = async (id) => {
    await activate(walkWindow.id);
    if ((await walk.ev(`document.querySelector('[data-ev="walk-step-${id}"]')===null`)) === true) await osClickAt(wc, `[data-ev="walk-head-${id.split('.')[0]}"]`);
    await osClickAt(wc, `[data-ev="walk-step-${id}"]`);
    await poll(`step ${id} in the panel`, async () => (await read(pc, `document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent`)) === id, 15_000);
  };
  const shown = () =>
    read(pc, `JSON.stringify({step:document.querySelector('.rv-step-panel h2 .rv-step-id')?.textContent??'',value:document.querySelector('[data-ev="presentation-profile"]')?.value??'',state:document.querySelector('[data-ev="profile-status"]')?.dataset.state??'',profileShown:document.querySelector('[data-ev="profile-explanation"]')?.dataset.profile??'',altStep:document.querySelector('[data-ev="profile-explanation"]')?.dataset.step??'',alt:document.querySelector('[data-ev="profile-explanation"]')?.textContent??'',prepared:document.querySelector('[data-ev="step-prepared-explanation"]')!==null})`).then((text) => JSON.parse(text));
  /** Choose a profile with the keyboard on the dropdown, as a person can. */
  const choose = async (name, onTab = 'step') => {
    if (onTab === 'step') await clickInPanel('right-tab-step');
    const select = await pointAt(pc, '[data-ev="presentation-profile"]', 'nearest');
    await activate(select.windowId);
    await osClick(select.physical);
    await delay(300);
    await osKey('Escape');
    await osType(name.slice(0, 2));
    await delay(250);
    const index = ['original', 'essens', 'pedagog'].indexOf(name.toLowerCase());
    for (let attempt = 0; attempt < 3 && (await read(pc, `document.querySelector('[data-ev="presentation-profile"]').value`)) !== name.toLowerCase(); attempt += 1) {
      // The list did not follow the typed letters: open it, and the arrow keys from the top, then Return.
      await osClick((await pointAt(pc, '[data-ev="presentation-profile"]', null)).physical);
      await delay(400);
      await osKey('Home');
      for (let i = 0; i < index; i += 1) await osKey('Down');
      await osKey('Return');
      await delay(400);
    }
    await delay(500);
    check(`${name} is chosen in the dropdown`, (await read(pc, `document.querySelector('[data-ev="presentation-profile"]').value`)) === name.toLowerCase());
  };
  const zoomOf = () => client.main.ev(`process.mainModule.require('electron').webContents.fromId(${String(pc)}).getZoomLevel()`);

  // S1 is the change of the greeting at To; S2 and S3 the shout change; S4 the added lines.
  const S1 = 'W1.2';
  const S2 = 'W1.3';
  const S3 = 'W1.4';
  const S4 = 'W1.5';

  stage = 'Standard by default, with the choices described';
  await clickInPanel('right-tab-step');
  await goToStep(S1);
  const options = JSON.parse(await read(pc, `JSON.stringify([...document.querySelectorAll('[data-ev="presentation-profile"] option')].map((o)=>({value:o.value,name:o.textContent,title:o.title})))`));
  check('the dropdown offers Essentials, Standard and Teacher, each described, and not Original', options.map((o) => o.name).join(',') === 'Essentials,Standard,Teacher' && options.map((o) => o.value).join(',') === 'essens,standard,pedagog' && options.every((o) => o.title.length > 30), JSON.stringify(options));
  let now = await shown();
  check('Standard is the default; the original explanation is shown until the Standard one is written', now.value === 'standard' && now.prepared && now.profileShown === '' && ['', 'none', 'pending'].includes(now.state), JSON.stringify(now));
  await osClickAt(pc, '[data-ev="presentation-profile-about-toggle"]');
  const about = await read(pc, `document.querySelector('[data-ev="presentation-profile-about"]')?.textContent ?? ''`);
  check('what a profile asks for can be read in the panel', /Every profile:/.test(about) && /Standard:/.test(about) && /About five sentences/.test(about), about.slice(0, 160));
  await osClickAt(pc, '[data-ev="presentation-profile-about-toggle"]');
  const zoom0 = await zoomOf();
  await w_shot(pc, '40-standard-default');
  // DSP-180: arriving at a step and settling asks for its explanation in the chosen profile.
  await poll('the Standard request for S1', async () => presents().some((m) => m.deepen.profile === 'standard' && m.envelope.subject.stepId === S1), 15_000);
  await poll('the Standard explanation', async () => (await shown()).profileShown === 'standard', 60_000);
  now = await shown();
  check('S1 shows its Standard explanation, from the same code', now.state === 'done' && !now.prepared && /SIMULATED Standard/.test(now.alt) && now.altStep === S1, JSON.stringify(now));
  const callsAtStart = questions().length;

  stage = 'Essentials: the current step only, the original explanation meanwhile';
  await choose('Essentials');
  await poll('the Essentials request', async () => presents().filter((m) => m.deepen.profile === 'essens').length === 1, 15_000);
  now = await shown();
  check('while Essentials is written, the original explanation stays with a quiet indicator', now.state === 'pending' && now.prepared && now.profileShown === '', JSON.stringify(now));
  await w_shot(pc, '41-essentials-pending');
  const first = presents().find((m) => m.deepen.profile === 'essens');
  check('one request, for the current step only, in Essentials, from its version, with the policy once', first.envelope.subject.stepId === S1 && typeof first.deepen.basis === 'string' && /## How to present \(Essentials\)/.test(first.sentPrompt) && first.sentPrompt.split('<!-- dspatch:details -->').length === 2 && /^Language: English\./m.test(first.sentPrompt), JSON.stringify(first.deepen));
  await poll('the Essentials explanation', async () => (await shown()).profileShown === 'essens', 60_000);
  now = await shown();
  check('the step then shows its Essentials explanation', now.state === 'done' && !now.prepared && /SIMULATED Essentials/.test(now.alt) && now.altStep === S1, JSON.stringify(now));
  check('no other step was asked for', presents().every((m) => m.envelope.subject.stepId === S1));
  await w_shot(pc, '42-essentials');
  await osClickAt(pc, '[data-ev="profile-explanation"] [data-ev="answer-show-more"]');
  const more = await read(pc, `document.querySelector('[data-ev="profile-explanation"] [data-ev="answer-details"]')?.textContent ?? ''`);
  check('Show more gives the Essentials depth, not the first part again', /SIMULATED deepening \(Essentials\)/.test(more) && !/SIMULATED Essentials for/.test(more), more.slice(0, 160));
  await w_shot(pc, '43-essentials-show-more');
  await osClickAt(pc, '[data-ev="profile-explanation"] [data-ev="answer-show-more"]');
  await osClickAt(pc, '[data-ev="profile-toggle-prepared"]');
  check('the original explanation is a click away, kept', (await shown()).prepared === true);
  await osClickAt(pc, '[data-ev="profile-toggle-prepared"]');

  stage = 'Teacher, then back without a call';
  await choose('Teacher');
  await poll('the Teacher explanation', async () => (await shown()).profileShown === 'pedagog', 60_000);
  check('Teacher asked once for the same step', presents().filter((m) => m.deepen.profile === 'pedagog').length === 1 && presents().find((m) => m.deepen.profile === 'pedagog').envelope.subject.stepId === S1);
  now = await shown();
  check('the step shows its Teacher explanation: the idea first, then the code', /SIMULATED Teacher/.test(now.alt) && /First the idea/.test(now.alt) && /Now the code/.test(now.alt), now.alt.slice(0, 120));
  check('the zoom is as it was', (await zoomOf()) === zoom0, String(await zoomOf()));
  await w_shot(pc, '44-teacher');
  const callsBeforeBack = questions().length;
  await choose('Essentials');
  now = await shown();
  check('back to Essentials: shown at once, no new call', now.profileShown === 'essens' && now.state === 'done' && questions().length === callsBeforeBack, JSON.stringify({ now: now.state, calls: questions().length - callsBeforeBack }));
  await choose('Standard');
  now = await shown();
  check('back to Standard: shown at once, no new call', now.profileShown === 'standard' && now.state === 'done' && questions().length === callsBeforeBack);
  await choose('Essentials');

  stage = 'Explain more simply, twice, and a follow-up at the same level';
  const simplerCount = () => questions().filter((m) => m.deepen?.action === 'simpler').length;
  await osClickAt(pc, '[data-ev="step-explain-simpler"]');
  await poll('the first simpler answer', async () => simplerCount() === 1 && discussionRecord().some((m) => m.role === 'answer' && m.questionId === questions().filter((x) => x.deepen?.action === 'simpler')[0]?.id && m.status === 'done'), 60_000);
  const simpler1 = questions().filter((m) => m.deepen?.action === 'simpler')[0];
  check('Explain more simply builds on the Essentials explanation, in Essentials', simpler1.presentation?.profile === 'essens' && simpler1.presentation?.shown?.length === 1 && /attempt 1, Essentials/.test(simpler1.sentPrompt) && /### Shown 1: The Essentials explanation of the step/.test(simpler1.sentPrompt) && /In Essentials: Plainer language/.test(simpler1.sentPrompt), JSON.stringify(simpler1.presentation));
  await poll('the step ready again', async () => (await read(pc, `document.querySelector('[data-ev="step-explain-simpler"]')?.disabled`)) === false, 30_000);
  await osClickAt(pc, '[data-ev="step-explain-simpler"]');
  await poll('the second simpler answer', async () => simplerCount() === 2 && discussionRecord().some((m) => m.role === 'answer' && m.questionId === questions().filter((x) => x.deepen?.action === 'simpler')[1]?.id && m.status === 'done'), 60_000);
  const simpler2 = questions().filter((m) => m.deepen?.action === 'simpler')[1];
  check('pressed again, it gets both explanations shown and is asked for another way in', simpler2.presentation?.shown?.length === 2 && /attempt 2/.test(simpler2.sentPrompt) && /did not make it clear enough/.test(simpler2.sentPrompt) && /### Shown 2: Explain more simply/.test(simpler2.sentPrompt));
  await delay(600);
  const deepenings = await read(pc, `[...document.querySelectorAll('[data-ev="step-deepening"]')].map((d)=>d.textContent).join(' | ')`);
  check('the step shows the simpler explanations under its Essentials explanation, each another way in', /attempt 1 \(the effect first\)/.test(deepenings) && /attempt 2 \(a concrete case instead\)/.test(deepenings), deepenings.slice(0, 300));
  await w_shot(pc, '45-essentials-simpler');
  await clickInPanel('right-tab-discussion');
  await clearComposer(pc);
  await osType('How does it choose between the two alternatives?');
  const before = questions().length;
  await osKey('Return');
  await poll('the follow-up answered', async () => questions().length > before && discussionRecord().some((m) => m.role === 'answer' && m.questionId === questions().at(-1).id && m.status === 'done'), 60_000);
  const follow = questions().at(-1);
  check('the follow-up carries Essentials and the explanation it follows, after two simpler ones', follow.presentation?.profile === 'essens' && /## The explanation this question follows \(Essentials\)/.test(follow.sentPrompt) && /more simply 2 time\(s\)/.test(follow.sentPrompt), JSON.stringify(follow.presentation));
  const followAnswer = discussionRecord().find((m) => m.role === 'answer' && m.questionId === follow.id)?.text ?? '';
  check('the answer is at the same level (SIMULATED)', /SIMULATED follow-up at the Essentials level/.test(followAnswer), followAnswer.slice(0, 120));
  await delay(500);
  const followGap = JSON.parse(await read(pc, DISCUSSION_SCROLLER));
  check('the follow-up and its answer are in view at the end of the discussion', followGap.gap <= 64, JSON.stringify(followGap));
  await w_shot(pc, '46-follow-up');

  stage = 'a step without an alternative, a late answer and a quick switch';
  await clickInPanel('right-tab-step');
  const callsBeforeMove = questions().length;
  await goToStep(S2);
  now = await shown();
  check('arriving at another step in Essentials shows the original explanation first', now.prepared && now.profileShown === '' && ['none', 'pending', ''].includes(now.state), JSON.stringify(now));
  // DSP-180: the request goes after the view has settled (~500 ms), once, for this step.
  await poll('S2 asked on arrival', async () => presents().some((m) => m.envelope.subject.stepId === S2 && m.deepen.profile === 'essens'), 10_000);
  check('one request for S2, none for the steps passed on the way', presents().filter((m) => m.envelope.subject.stepId === S2).length === 1 && questions().length === callsBeforeMove + 1, String(questions().length - callsBeforeMove));
  await goToStep(S3);
  await poll('the S2 answer arrived', async () => discussionRecord().some((m) => m.role === 'answer' && m.questionId === presents().find((x) => x.envelope.subject.stepId === S2)?.id && m.status === 'done'), 60_000);
  now = await shown();
  check('the late S2 answer is not shown at S3', now.step === S3 && now.profileShown === '' && !/S2|Changed lines 35/.test(now.alt) && now.state === 'none', JSON.stringify(now));
  // At S3: Essentials asked on arrival, and Teacher chosen while it is written.
  await poll('S3 Essentials asked', async () => presents().some((m) => m.envelope.subject.stepId === S3), 10_000);
  await choose('Teacher');
  now = await shown();
  check('a switch while another answer is written is refused and says so; nothing of Essentials is shown under Teacher', now.value === 'pedagog' && now.profileShown === '' && ['failed', 'none', 'pending'].includes(now.state), JSON.stringify(now));
  await poll('S3 Essentials done', async () => discussionRecord().some((m) => m.role === 'answer' && m.questionId === presents().find((x) => x.envelope.subject.stepId === S3 && x.deepen.profile === 'essens')?.id && m.status === 'done'), 60_000);
  now = await shown();
  check('when the Essentials answer arrives, Teacher still does not show it', now.profileShown === '' && now.value === 'pedagog', JSON.stringify(now));
  // Either the Teacher request was refused while Essentials was written (then it is offered again),
  // or Essentials had finished and Teacher was asked at once: each ends under its own profile.
  const settled = await poll('S3 in Teacher settled', async () => {
    const state = (await shown()).state;
    return state === 'pending' ? false : state;
  }, 60_000);
  note('the Teacher request at S3', settled === 'done' ? 'asked at once, after Essentials had finished' : `${settled}: refused while Essentials was written, offered again`);
  if (settled !== 'done') {
    const again = (await read(pc, `document.querySelector('[data-ev="profile-retry"]')!==null`)) === true ? 'profile-retry' : 'profile-present';
    await osClickAt(pc, `[data-ev="${again}"]`);
    await poll('S3 in Teacher', async () => (await shown()).profileShown === 'pedagog', 60_000);
  }
  now = await shown();
  check('S3 shows its own Teacher explanation, never the Essentials one', now.profileShown === 'pedagog' && now.altStep === S3 && /SIMULATED Teacher/.test(now.alt), JSON.stringify(now));
  await goToStep(S2);
  await choose('Essentials');
  now = await shown();
  check('back at S2 in Essentials, its answer is there at once', now.profileShown === 'essens' && now.altStep === S2);

  stage = 'a failed presentation keeps the original one and can be tried again';
  await goToStep(S4);
  // Asked on arrival (DSP-180); the simulated provider fails this step's first presentation.
  await poll('the failure', async () => (await shown()).state === 'failed', 60_000);
  now = await shown();
  check('a failure leaves the original explanation and offers Try again', now.prepared && now.profileShown === '' && (await read(pc, `document.querySelector('[data-ev="profile-retry"]')!==null`)) === true, JSON.stringify(now));
  await w_shot(pc, '47-failed-retry');
  await osClickAt(pc, '[data-ev="profile-retry"]');
  await poll('S4 in Essentials', async () => (await shown()).profileShown === 'essens', 60_000);
  check('Try again writes it', (await shown()).altStep === S4);

  stage = 'a thread question keeps its thread';
  let threadId = null;
  for (const id of [S1, S2, S3, S4]) {
    await goToStep(id);
    threadId = await read(pc, `document.querySelector('[data-ev="walk-threads-here"] [data-ev="review-thread"][data-thread-level="lines"]')?.dataset.threadId ?? null`);
    if (threadId !== null) break;
  }
  if (threadId !== null) {
    if ((await read(pc, `document.querySelector('[data-thread-id="${threadId}"] [data-ev="thread-comment-field"]')===null`)) === true) await osClickAt(pc, `[data-thread-id="${threadId}"] [data-ev="thread-toggle"]`);
    await osClickAt(pc, `[data-thread-id="${threadId}"] [data-ev="thread-comment-field"]`);
    await osType('Why does this matter?');
    const beforeThread = questions().length;
    await osKey('ctrl+Return');
    await poll('the thread question', async () => questions().length > beforeThread, 15_000);
    const asked = questions().at(-1);
    check('a question in a finding\'s thread stays in that thread, asked in the profile chosen', asked.envelope.subject.kind === 'thread' && asked.envelope.subject.threadId === threadId && asked.presentation?.profile === 'essens', JSON.stringify({ subject: asked.envelope.subject, presentation: asked.presentation }));
    await poll('its answer', async () => discussionRecord().some((m) => m.role === 'answer' && m.questionId === asked.id && m.status === 'done'), 60_000);
  } else {
    note('no thread at S1', '');
  }

  stage = 'coverage and findings unchanged';
  check('coverage, what remains and the findings are as before any profile', (await reviewState()) === reviewBefore, await reviewState());

  stage = 'after a restart, without a call';
  const callsBeforeRestart = questions().length;
  await quitClient();
  main = await launch('profiles-again');
  await main.until('the recent project', `${q('open-project-0')}!==null`, 60_000);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  await main.click('open-review');
  diffWindow = await windowShowing(isDiffPage, 'the review window again');
  diff = new Page(client.cdp, 'review again', isDiffPage);
  await diff.attach(60_000);
  await openPair(diff);
  await diff.until('the review drawn', `${q('pair-walks')}!==null || ${q('pair-files')}!==null`, 30_000);
  if ((await diff.ev(`${q('pair-walks')}===null`)) === true) await diff.click('pair-files');
  await diff.click('pair-walks');
  walkWindow = await windowShowing(isWalkPage, 'the walk window again');
  walk = new Page(client.cdp, 'walk again', isWalkPage);
  await walk.attach(60_000);
  await walk.until('panes', `document.querySelectorAll('section.rv-pane').length > 0`, 60_000);
  await client.main.size(walkWindow.id, 1500, 940);
  walkWindow = await windowById(walkWindow.id);
  wc = walkWindow.contentsId;
  panel = await poll('the panel again', panelView, 30_000);
  if (!panel.docked || panel.frame.id !== walkWindow.id) {
    await clickInPanel('panel-dock-walk');
    panel = await dockedIn(walkWindow.id, 'the panel docked in the walk window again');
  }
  pc = panel.view.contentsId;
  await clickInPanel('right-tab-step');
  await goToStep(S1);
  await delay(800);
  now = await shown();
  check('after a restart: Essentials still chosen, S1 shows its Essentials explanation, no call made', now.value === 'essens' && now.profileShown === 'essens' && questions().length === callsBeforeRestart, JSON.stringify({ now, calls: questions().length - callsBeforeRestart }));
  await choose('Teacher');
  check('and Teacher too, without a call', (await shown()).profileShown === 'pedagog' && questions().length === callsBeforeRestart);
  await choose('Standard');

  stage = 'the panel in its own window';
  await clickInPanel('panel-own-window');
  const own = await poll('the panel standalone', async () => {
    const found = await panelView();
    return found !== null && !found.docked ? found : false;
  }, 30_000);
  pc = own.view.contentsId;
  await client.main.size(own.frame.id, 760, 860).catch(() => undefined);
  await delay(800);
  await clickInPanel('right-tab-discussion');
  await clearComposer(pc);
  await osType('A draft I have not sent');
  const gapBefore = JSON.parse(await read(pc, DISCUSSION_SCROLLER));
  // The choice is above both tabs: switched while the discussion is read.
  for (const name of ['Essentials', 'Teacher', 'Standard']) {
    await choose(name, 'discussion');
  }
  check('standalone: the choice works and reuses what was written, without a call', questions().length === callsBeforeRestart);
  check('standalone: the unsent draft is kept through the switches', (await composerValue(pc))?.includes('A draft I have not sent') === true);
  const gapAfter = JSON.parse(await read(pc, DISCUSSION_SCROLLER));
  check('standalone: the discussion is where it was (the switches moved nothing)', Math.abs(gapAfter.gap - gapBefore.gap) <= 2, JSON.stringify({ gapBefore, gapAfter }));
  // To Step and back: a reader at the latest is there again (it used to come back at the top).
  await clickInPanel('right-tab-step');
  await clickInPanel('right-tab-discussion');
  await delay(300);
  const gapBack = JSON.parse(await read(pc, DISCUSSION_SCROLLER));
  check('standalone: back from Step, the discussion is at its latest again', gapBack.gap <= 64, JSON.stringify(gapBack));
  await clickInPanel('right-tab-step');
  for (const [item, label] of [['dspatch-zoom-in', 'plus 1'], ['dspatch-zoom-out', '0'], ['dspatch-zoom-out', 'minus 1']]) {
    await client.main.menu(item, own.frame.id);
    await delay(700);
    const fits = await read(pc, `(()=>{const s=document.querySelector('[data-ev="presentation-profile"]');if(!s)return false;const b=s.getBoundingClientRect();return b.width>60 && b.right<=innerWidth+1})()`);
    check(`standalone at zoom ${label}: the choice is shown and fits`, fits === true);
  }
  await client.main.menu('dspatch-zoom-reset', own.frame.id);
  await choose('Teacher');
  await w_shot(pc, '48-standalone-teacher');
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
