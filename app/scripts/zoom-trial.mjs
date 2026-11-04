// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The zoom trial (DSP-167): DSpatch's real windows on a Linux X display, the keys pressed through
 * the X server (xdotool, XTEST) as a keyboard's presses arrive, on the built app over an isolated
 * profile and a disposable project. It shows that each window zooms on its own by VS Code's step,
 * that the keys of the US and the Swedish layouts and the keypad zoom and type nothing, that a
 * window comes back at its level after a restart, and that the review's docked discussion follows
 * its window while the level of its own window is kept.
 *
 *     node scripts/zoom-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`, xdotool and setxkbmap, and an X display: with no DISPLAY, Xvfb and a
 * window manager (openbox) are started here and stopped at the end. The provider is SIMULATED
 * (the presentation adapter on the host); no model and no account is reached. The standalone host
 * this start begins is ended at the end. Nothing of the machine's own profile is touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-zoom', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
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
const owned = { xvfb: null, wm: null, client: null };
let display = process.env.DISPLAY ?? '';
let stage = 'preflight';
let profile = '';
let project = '';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(what, ok, detail = '') {
  results.push({ stage, what, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 400)}`}`);
  if (!ok) throw new Error(what);
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
  const result = spawnSync(program, args, { encoding: 'utf8', env: { ...process.env, DISPLAY: display }, timeout: 30_000 });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${program} ${args.join(' ')}: ${result.error?.message ?? String(result.status)}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}
const xdotool = (...args) => run('xdotool', args);
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
  async shot(name) {
    const answer = await this.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(answer.data, 'base64'));
  }
  async click(name) {
    await this.until(`the ${name} control`, `${q(name)}!==null && !${q(name)}.disabled`);
    const box = await this.ev(`(()=>{const element=${q(name)};element.scrollIntoView({block:'center'});const box=element.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.cmd('Input.dispatchMouseEvent', { type, ...box, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }
  /** What the page sees of its own size: zoom scales both. */
  reading() {
    return this.ev("JSON.stringify({dpr: window.devicePixelRatio, width: window.innerWidth, focused: document.hasFocus(), active: document.activeElement?.tagName ?? null, value: document.activeElement?.value ?? null})").then((text) => JSON.parse(text));
  }
}

/** The main process, over the inspector: every window, its level and the X window it is. */
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
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`inspector timeout: ${method}`)); }, 12_000);
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
  /** Every window: its page, its zoom level, the X window it is, and the views it holds. */
  async windows() {
    return JSON.parse(await this.ev(`(() => {
      const { BrowserWindow } = process.mainModule.require('electron');
      return JSON.stringify(BrowserWindow.getAllWindows().map((w) => ({
        id: w.id,
        title: w.getTitle(),
        url: w.webContents.getURL(),
        level: w.webContents.getZoomLevel(),
        focused: w.isFocused(),
        visible: w.isVisible(),
        xid: ((handle) => (handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0)))(w.getNativeWindowHandle()),
        views: (w.contentView?.children ?? []).filter((v) => v.webContents !== undefined).map((v) => ({ url: v.webContents.getURL(), level: v.webContents.getZoomLevel() })),
      })));
    })()`));
  }
  /** Click a View menu item for a window, as the menu does with that window focused. */
  async menu(itemId, windowId) {
    return this.ev(`(() => {
      const { BrowserWindow, Menu } = process.mainModule.require('electron');
      const w = BrowserWindow.fromId(${String(windowId)});
      const item = Menu.getApplicationMenu().getMenuItemById(${JSON.stringify(itemId)});
      item.click(undefined, w, w.webContents);
      return JSON.stringify({ label: item.label, accelerator: item.accelerator, level: w.webContents.getZoomLevel() });
    })()`).then((text) => JSON.parse(text));
  }
}

const isMainPage = (url) => url !== '' && !url.includes('window=');
const isEditorPage = (url) => url.includes('window=editor');
const isDiffPage = (url) => url.includes('view=diff');
const isPanelPage = (url) => url.includes('view=panel');

const client = { child: null, cdp: 0, inspect: 0, main: null, log: '' };
const savedLevels = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(profile, 'window-zoom.json'), 'utf8')).levels;
  } catch {
    return {};
  }
};
const clientLog = () => fs.readFileSync(client.log, 'utf8');

async function launch(label) {
  client.cdp = await freePort();
  client.inspect = await freePort();
  client.log = path.join(evidence, `client-${label}.log`);
  const output = fs.openSync(client.log, 'a');
  const child = spawn(electron, [`--inspect=${String(client.inspect)}`, '.', `--user-data-dir=${profile}`, `--remote-debugging-port=${String(client.cdp)}`], {
    cwd: appDir,
    env: { ...process.env, DISPLAY: display, DSPATCH_EXPECT_USERDATA: profile, ...simulated },
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
  check('the client exited on SIGTERM', child.exitCode !== null || child.signalCode !== null, `${label(child)}`);
}
const label = (child) => `exit ${String(child.exitCode)} signal ${String(child.signalCode)}`;

/** A window by what it shows, read from the main process. */
async function windowShowing(matches, what) {
  return poll(what, async () => (await client.main.windows()).find((w) => matches(w.url) || w.views.some((v) => matches(v.url))) ?? false, 20_000);
}
const levelOf = async (matches) => (await client.main.windows()).find((w) => matches(w.url))?.level;
const panelView = async () => {
  for (const w of await client.main.windows()) {
    const view = w.views.find((v) => isPanelPage(v.url));
    if (view) return { frame: w, view, docked: w.url !== '' };
  }
  return null;
};

/** Bring a window to the front through the window manager, so the X server's keys reach it. */
async function activate(w) {
  const state = async () => (await client.main.windows()).find((one) => one.id === w.id);
  // A new window is mapped once its page is ready, and the window manager gives it the focus a
  // moment later; until then an activation is asked for again, through the manager, X and
  // Electron in turn.
  const began = Date.now();
  const end = began + 90_000;
  let shownAfter = null;
  let framed = false;
  while (Date.now() < end) {
    const now = await state();
    if (now?.visible === true && shownAfter === null) shownAfter = Date.now() - began;
    // Under Xvfb a hidden window's renderer may draw no first frame, and Electron shows the
    // window on that frame (ready-to-show): a capture of its page asks for one.
    if (now?.visible !== true && !framed && Date.now() - began > 1_500) {
      framed = true;
      const page = pages.find((one) => one.ws !== undefined && (one.matches(now?.url ?? '') || (now?.views ?? []).some((view) => one.matches(view.url))));
      if (page !== undefined) {
        await page.shot(`frame-for-window-${String(w.id)}`).catch(() => undefined);
        results.push({ stage, what: `window ${String(w.id)} was asked for a first frame`, ok: true, detail: page.label });
      }
    }
    if (now?.focused === true) {
      results.push({ stage, what: `window ${String(w.id)} took the focus`, ok: true, detail: `shown after ${String(shownAfter ?? 0)} ms, focused after ${String(Date.now() - began)} ms` });
      return;
    }
    run('xdotool', ['windowactivate', '--sync', String(w.xid)], true);
    await delay(400);
    if ((await state())?.focused === true) continue;
    run('xdotool', ['windowfocus', '--sync', String(w.xid)], true);
    await client.main.ev(`process.mainModule.require('electron').BrowserWindow.fromId(${String(w.id)})?.focus()`);
    await delay(400);
  }
  throw new Error(`window ${String(w.id)} did not take the focus in 90 s: ${JSON.stringify(await state())}`);
}
/** Press keys as a keyboard would, on the focused window; `keys` in xdotool's words. */
async function press(keys) {
  xdotool('key', '--clearmodifiers', '--delay', '40', keys);
  await delay(350);
}

async function main() {
  stage = 'preflight';
  check('xdotool and setxkbmap are here', run('sh', ['-c', 'command -v xdotool && command -v setxkbmap'], true) !== '');
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  if (display === '') {
    const number = 90 + (process.pid % 50);
    display = `:${String(number)}`;
    owned.xvfb = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' });
    await poll('Xvfb', () => fs.existsSync(`/tmp/.X11-unix/X${String(number)}`), 15_000);
    owned.wm = spawn('openbox', [], { env: { ...process.env, DISPLAY: display }, stdio: 'ignore' });
    await delay(800);
  }
  run('setxkbmap', ['-display', display, 'us']);
  xdotool('key', 'Num_Lock');
  const numLock = run('xset', ['q'], true).split('\n').find((line) => /Num Lock/.test(line)) ?? '';
  results.push({ stage, what: 'the display', ok: true, detail: `${display}; WM ${owned.wm === null ? 'already there' : 'openbox'}; ${numLock.trim()}` });
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-zoom-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-zoom-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', ...args]);
  git('init', '-q');
  for (const [n, text] of [['one', 'a start\n'], ['two', 'a start\nand a change\n'], ['three', 'a start\nand a change\nand one more\n']]) {
    fs.writeFileSync(path.join(project, 'notes.md'), text);
    git('add', '.');
    git('commit', '-qm', `Commit ${n}`);
  }

  stage = 'first start';
  let main = await launch('first');
  check('every window starts at normal size', (await client.main.windows()).every((w) => w.level === 0), JSON.stringify(await client.main.windows()));
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  await main.until('the recent project', `${q('open-project-0')}!==null`);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  const mainWindow = await windowShowing(isMainPage, 'the main window');

  stage = 'US keys in the chat field';
  await activate(mainWindow);
  await main.ev(`${q('prompt')}.focus()`);
  const before = await main.reading();
  check('the chat field has the focus', before.focused && before.active === 'TEXTAREA', JSON.stringify(before));
  const steps = [['ctrl+equal', 1], ['ctrl+plus', 2], ['ctrl+minus', 1], ['ctrl+KP_Add', 2], ['ctrl+KP_Subtract', 1], ['ctrl+KP_0', 0], ['ctrl+equal', 1], ['ctrl+0', 0]];
  for (const [keys, expected] of steps) {
    await press(keys);
    const level = await levelOf(isMainPage);
    const reading = await main.reading();
    check(`${keys} → level ${String(expected)}, nothing typed`, level === expected && reading.value === '' && Math.abs(reading.dpr - 1.2 ** expected) < 0.001, `level ${String(level)}, dpr ${String(reading.dpr)}, field "${String(reading.value)}"`);
  }

  stage = 'Swedish layout';
  run('setxkbmap', ['-display', display, 'se']);
  const plusKey = run('sh', ['-c', `xmodmap -display ${display} -pke | grep -E '^keycode +(20|61|19) '`], true);
  results.push({ stage, what: 'the Swedish keys', ok: true, detail: plusKey.replaceAll('\n', ' | ') });
  for (const [keys, expected] of [['ctrl+plus', 1], ['ctrl+plus', 2], ['ctrl+minus', 1], ['ctrl+0', 0]]) {
    await press(keys);
    const level = await levelOf(isMainPage);
    const reading = await main.reading();
    check(`Swedish ${keys} → level ${String(expected)}, nothing typed`, level === expected && reading.value === '', `level ${String(level)}, field "${String(reading.value)}"`);
  }
  run('setxkbmap', ['-display', display, 'us']);

  stage = 'the View menu';
  const zoomedIn = await client.main.menu('dspatch-zoom-in', mainWindow.id);
  const zoomedOut = await client.main.menu('dspatch-zoom-out', mainWindow.id);
  check('Zoom In and Zoom Out in the menu move one step', zoomedIn.level === 1 && zoomedOut.level === 0 && zoomedIn.accelerator === 'CommandOrControl+=' && zoomedOut.accelerator === 'CommandOrControl+-', JSON.stringify([zoomedIn, zoomedOut]));
  await client.main.menu('dspatch-zoom-in', mainWindow.id);
  await client.main.menu('dspatch-zoom-in', mainWindow.id);
  await client.main.menu('dspatch-zoom-in', mainWindow.id);
  const reset = await client.main.menu('dspatch-zoom-reset', mainWindow.id);
  check('Reset Zoom in the menu goes to normal size', reset.level === 0 && reset.accelerator === 'CommandOrControl+0', JSON.stringify(reset));
  if (run('sh', ['-c', 'command -v import'], true) !== '') {
    await activate(mainWindow);
    xdotool('key', 'alt+v');
    await delay(700);
    run('import', ['-display', display, '-window', 'root', path.join(evidence, 'view-menu-open.png')], true);
    xdotool('key', 'Escape');
    await delay(200);
  }

  stage = 'windows apart';
  await activate(mainWindow);
  await main.ev(`${q('prompt')}.focus()`);
  await press('ctrl+equal');
  await press('ctrl+equal');
  check('the chat at 2', (await levelOf(isMainPage)) === 2);
  await main.click('edit-agent-loops');
  const editorWindow = await windowShowing(isEditorPage, 'the loop editor window');
  const editor = new Page(client.cdp, 'editor', isEditorPage);
  await editor.attach();
  await editor.until('the editor loaded', 'document.body.innerText.length > 0');
  // Under Xvfb a second window's renderer draws no first frame while the window is hidden, so
  // Electron's ready-to-show, which shows the window, waits; a capture asks for that frame.
  await editor.shot('02a-editor-opened');
  await activate(editorWindow);
  await press('ctrl+equal');
  check('the editor at 1, the chat still at 2', (await levelOf(isEditorPage)) === 1 && (await levelOf(isMainPage)) === 2, JSON.stringify(await client.main.windows()));
  await main.click('open-review');
  const diffWindow = await windowShowing(isDiffPage, 'the review window');
  const diff = new Page(client.cdp, 'review', isDiffPage);
  await diff.attach();
  await diff.click('pair-repo-0');
  await diff.until('the log', `${q('pair-commit-1')}!==null`);
  await diff.click('pair-commit-1');
  await diff.until('From chosen', "document.querySelectorAll('.rv-pair-commit[aria-pressed=\"true\"]').length === 1");
  await diff.click('pair-commit-0');
  await diff.until('both chosen', "document.querySelectorAll('.rv-pair-commit[aria-pressed=\"true\"]').length === 2");
  await diff.click('pair-open');
  await diff.until('the review of the pair', `${q('pair-discussion')}!==null`, 60_000);
  await diff.shot('03a-review-opened');
  await activate(diffWindow);
  await diff.ev('document.body.focus()');
  await press('ctrl+minus');
  await press('ctrl+minus');
  const apart = await client.main.windows();
  check('the review at -2, the editor at 1, the chat at 2', (await levelOf(isDiffPage)) === -2 && (await levelOf(isEditorPage)) === 1 && (await levelOf(isMainPage)) === 2, JSON.stringify(apart));
  check('the saved file holds the three windows', JSON.stringify(savedLevels()) === JSON.stringify({ main: 2, editor: 1, 'review-diff': -2 }), JSON.stringify(savedLevels()));
  await main.shot('01-chat-at-2');
  await editor.shot('02-editor-at-1');
  await diff.shot('03-review-at-minus-2');

  stage = 'the discussion panel';
  await diff.click('pair-discussion');
  await poll('the discussion panel', panelView, 30_000);
  let panel = await panelView();
  check('the discussion opens in its own window at normal size', !panel.docked && panel.view.level === 0, JSON.stringify(panel));
  const panelPage = new Page(client.cdp, 'panel', isPanelPage);
  await panelPage.attach();
  const composer = `(document.querySelector('[data-ev="discussion-composer"] textarea') ?? document.querySelector('[data-ev="discussion-composer"]') ?? document.body)`;
  await panelPage.shot('04a-panel-opened');
  await activate(panel.frame);
  await panelPage.ev(`${composer}.focus()`);
  await press('ctrl+equal');
  await press('ctrl+equal');
  await press('ctrl+equal');
  panel = await panelView();
  check('the panel in its own window at 3, the review still at -2', panel.view.level === 3 && (await levelOf(isDiffPage)) === -2 && savedLevels()['review-panel'] === 3, JSON.stringify({ panel, saved: savedLevels() }));
  await panelPage.shot('04-panel-own-window-at-3');
  await panelPage.click('panel-dock-diff');
  await poll('the panel docked in the review', async () => (await panelView())?.docked === true, 20_000);
  panel = await panelView();
  check('docked, the panel takes the review\'s level and its own stays saved', panel.view.level === -2 && panel.frame.id === diffWindow.id && savedLevels()['review-panel'] === 3, JSON.stringify({ panel, saved: savedLevels() }));
  await activate(panel.frame);
  await panelPage.ev(`${composer}.focus()`);
  const inPanel = await panelPage.reading();
  check('the docked discussion field has the focus', inPanel.focused, JSON.stringify(inPanel));
  await press('ctrl+equal');
  panel = await panelView();
  const typed = await panelPage.reading();
  check('a key in the docked discussion zooms the review and the panel together, and types nothing', panel.view.level === -1 && (await levelOf(isDiffPage)) === -1 && savedLevels()['review-diff'] === -1 && savedLevels()['review-panel'] === 3 && (typed.value ?? '') === '', JSON.stringify({ panel, saved: savedLevels(), typed }));
  await diff.shot('05-review-with-docked-panel-at-minus-1');
  await panelPage.click('panel-own-window');
  await poll('the panel in its own window again', async () => (await panelView())?.docked === false, 20_000);
  panel = await panelView();
  check('undocked, the panel is back at its own 3', panel.view.level === 3, JSON.stringify(panel));
  await panelPage.click('panel-dock-diff');
  await poll('docked again', async () => (await panelView())?.docked === true, 20_000);
  panel = await panelView();
  check('docked again, at the review\'s -1', panel.view.level === -1, JSON.stringify(panel));
  await panelPage.click('panel-own-window');
  await poll('undocked again', async () => (await panelView())?.docked === false, 20_000);
  panel = await panelView();
  check('undocked again, at its own 3', panel.view.level === 3 && savedLevels()['review-panel'] === 3 && savedLevels()['review-diff'] === -1, JSON.stringify({ panel, saved: savedLevels() }));
  await panelPage.click('panel-dock-diff');
  await poll('left docked for the restart', async () => (await panelView())?.docked === true, 20_000);

  stage = 'restart';
  const levelsBefore = savedLevels();
  await quitClient();
  check('the saved levels survive the quit', JSON.stringify(savedLevels()) === JSON.stringify(levelsBefore), JSON.stringify(savedLevels()));
  main = await launch('second');
  check('the chat opens at 2 before any project is open', (await levelOf(isMainPage)) === 2 && /window main opens at zoom level 2/.test(clientLog()), JSON.stringify(await client.main.windows()));
  const opened = await main.reading();
  check('the page is drawn at that size', Math.abs(opened.dpr - 1.44) < 0.001, JSON.stringify(opened));
  await main.until('the recent project', `${q('open-project-0')}!==null`);
  await main.click('open-project-0');
  await main.until('the chat', `${q('prompt')}!==null`);
  check('the chat is still at 2 with the project open', (await levelOf(isMainPage)) === 2);
  await main.click('edit-agent-loops');
  await windowShowing(isEditorPage, 'the loop editor window again');
  check('the editor opens at 1', (await levelOf(isEditorPage)) === 1 && /window editor opens at zoom level 1/.test(clientLog()));
  await main.click('open-review');
  const diffAgain = await windowShowing(isDiffPage, 'the review window again');
  const diff2 = new Page(client.cdp, 'review again', isDiffPage);
  await diff2.attach();
  await diff2.until('the review shown', `${q('pair-discussion')}!==null || ${q('pair-repo-0')}!==null`, 60_000);
  if ((await diff2.ev(`${q('pair-discussion')}===null`)) === true) {
    await diff2.click('pair-repo-0');
    await diff2.until('the log', `${q('pair-commit-1')}!==null`);
    await diff2.click('pair-commit-1');
    await diff2.until('From chosen', "document.querySelectorAll('.rv-pair-commit[aria-pressed=\"true\"]').length === 1");
    await diff2.click('pair-commit-0');
    await diff2.until('both chosen', "document.querySelectorAll('.rv-pair-commit[aria-pressed=\"true\"]').length === 2");
    await diff2.click('pair-open');
    await diff2.until('the review of the pair', `${q('pair-discussion')}!==null`, 60_000);
  }
  check('the review opens at -1', (await levelOf(isDiffPage)) === -1 && /window review-diff opens at zoom level -1/.test(clientLog()), JSON.stringify(diffAgain));
  if ((await panelView()) === null) {
    await diff2.click('pair-discussion');
  }
  await poll('the discussion panel again', panelView, 30_000);
  panel = await panelView();
  results.push({ stage, what: 'where the panel came back', ok: true, detail: panel.docked ? `docked in window ${String(panel.frame.id)} at ${String(panel.view.level)}` : `its own window at ${String(panel.view.level)}` });
  const panelPage2 = new Page(client.cdp, 'panel again', isPanelPage);
  await panelPage2.attach();
  if (panel.docked) {
    check('docked after the restart, the panel is at the review\'s -1', panel.view.level === -1, JSON.stringify(panel));
    await panelPage2.click('panel-own-window');
    await poll('the panel in its own window after the restart', async () => (await panelView())?.docked === false, 20_000);
    panel = await panelView();
  }
  check('in its own window after the restart, the panel is at its saved 3', panel.view.level === 3, JSON.stringify(panel));
  await panelPage2.shot('06-panel-after-restart');

  stage = 'reset';
  const mainAgain = await windowShowing(isMainPage, 'the main window again');
  await activate(mainAgain);
  await main.ev(`${q('prompt')}.focus()`);
  await press('ctrl+0');
  check('Ctrl+0 brings the chat to normal size and leaves it out of the file', (await levelOf(isMainPage)) === 0 && savedLevels().main === undefined && savedLevels().editor === 1, JSON.stringify(savedLevels()));
  check('no other window moved', (await levelOf(isEditorPage)) === 1 && (await levelOf(isDiffPage)) === -1);
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
  for (const page of pages) await page.shot(`failure-${page.label.replaceAll(' ', '-')}`).catch(() => undefined);
  try {
    fs.writeFileSync(path.join(evidence, 'windows-at-failure.json'), JSON.stringify(await client.main?.windows(), null, 2));
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
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ display, profile, project, electron, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${results.some((result) => !result.ok) ? 'FAILED' : 'ALL PASSED'}: ${String(results.length)} checks; evidence ${evidence}`);
}
