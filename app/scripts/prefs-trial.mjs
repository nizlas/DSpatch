// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The view preference trial (DSP-200), on the walk trial's plumbing (copied from
 * scripts/walk-trial.mjs). DSpatch's real windows over an isolated profile and a disposable
 * project; the provider SIMULATED (the presentation adapter), so the walk is newly prepared by the
 * product's own job but its text is not a model's.
 *
 * The profile starts with review preferences as DSpatch before 0.1.10 left them: a language, the
 * review panel's place and its window, and no column widths. Over those, 0.1.22's walk window could
 * not save a width: it sent valid fields in another key order and the host refused them, and the
 * window said the review was not saved.
 *
 * It checks that the start window's title carries the installed version; that a newly prepared
 * walk opens with no preference message and writes no preferences by itself; that a width dragged
 * in the walk window is saved with the older fields kept and no message; that the walk window
 * closed and opened again has that width; and, on Windows, that Help > About DSpatch shows the
 * app's version from its package and the running host's own, and copies them.
 *
 *     node scripts/prefs-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`, and on Linux an X display (Linux CI runs it under `xvfb-run`, where the
 * About part is left out). The input is DevTools input into the page (the divider is dragged through
 * Chromium's input pipeline, not the operating system's); the About dialog is read and its button
 * pressed through UI Automation, with no mouse or keyboard. The clipboard's text is put back after.
 * Nothing of the machine's own profile is touched; the standalone host this start begins is ended.
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-prefs', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
const packageVersion = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_PRESENTATION_LIST_MS: '50',
  DSPATCH_PRESENTATION_TOOL_MS: '200',
  DSPATCH_PRESENTATION_DELTA_MS: '30',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};
// As DSpatch before 0.1.10 wrote them: the panel's place and window, no widths.
const OLDER_PREFERENCES = { language: 'en', discussionPlace: 'walk', explanationBounds: { x: 120, y: 80, width: 560, height: 696 } };
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
  await page.until('the review of the pair', `${q('pair-discussion')}!==null`, 60_000);
}

const preferencesFile = () => path.join(profile, 'reviews', 'preferences.json');
const preferencesNow = () => {
  try {
    return fs.readFileSync(preferencesFile(), 'utf8');
  } catch {
    return null;
  }
};
/** What the walk window says of saving: the view preference line, and any "not saved" text. */
const savingSaid = (walk) =>
  walk.ev(`JSON.stringify({problem:${q('view-preferences-problem')}?.textContent??null,notSaved:/not saved|could not be saved|inte sparat|kunde inte sparas/i.test(document.body.innerText)})`).then((text) => JSON.parse(text));
const navWidth = (walk) => walk.ev(`Number(${q('walk-nav-divider')}?.getAttribute('aria-valuenow') ?? NaN)`);
const hostLog = () => {
  try {
    return fs.readFileSync(path.join(profile, 'host.log'), 'utf8');
  } catch {
    return '';
  }
};

async function main() {
  stage = 'preflight';
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-prefs-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-prefs-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  const versions = [
    { 'src/worker.js': ['export function run(items, n) {', '  return n;', '}', ''].join('\n') },
    { 'src/worker.js': ['export function run(items, n) {', '  startWorker();', '  return n;', '}', '', 'function startWorker() {', '  return { running: true };', '}', ''].join('\n') },
  ];
  for (const [index, files] of versions.entries()) {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(project, name), text);
    git('add', '.');
    git('commit', '-qm', `Commit ${String(index + 1)}`);
  }
  fs.mkdirSync(path.dirname(preferencesFile()), { recursive: true });
  fs.writeFileSync(preferencesFile(), `${JSON.stringify(OLDER_PREFERENCES, null, 2)}\n`);
  const seeded = preferencesNow();
  note('review preferences as DSpatch before 0.1.10 left them', seeded.replace(/\s+/g, ' '));

  stage = 'the start window';
  const main = await launch('prefs');
  const mainWindow = await windowShowing(isMainPage, 'the start window');
  check('the start window\'s title carries the installed version from package.json', mainWindow.title === `DSpatch — ${packageVersion}`, mainWindow.title);
  check('the build reports the same version', (await client.main.ev(`process.mainModule.require('electron').app.getVersion()`)) === packageVersion, packageVersion);

  stage = 'a newly prepared walk opens';
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
  await diff.click('pair-prepare-walks');
  await diff.until('the agent picker', `${q('pair-walks-agent-start')}!==null`, 15_000);
  await diff.click('pair-walks-agent-start');
  let walkWindow = await windowShowing(isWalkPage, 'the walk window', 90_000).catch(() => null);
  if (walkWindow === null) {
    await diff.click('pair-walks');
    walkWindow = await windowShowing(isWalkPage, 'the walk window');
  }
  const walk = new Page(client.cdp, 'walk', isWalkPage);
  await walk.attach(60_000);
  await walk.until('the walk', `document.querySelectorAll('[data-ev^="walk-head-"]').length > 0 && ${q('walk-nav-divider')}!==null`, 90_000);
  // Nothing touched: the window is left as it opened for a while.
  await delay(4000);
  await walk.shot('01-walk-opened-untouched');
  const untouched = await savingSaid(walk);
  check('the walk opens with no preference message and no "not saved"', untouched.problem === null && untouched.notSaved === false, JSON.stringify(untouched));
  check('opening the walk wrote no preferences', preferencesNow() === seeded);
  const initialWidth = await navWidth(walk);
  note('the left column as it opened', String(initialWidth));

  stage = 'a width changed in the walk window';
  await walk.drag('walk-nav-divider', 80);
  const changedWidth = await walk.until('the new width', `(() => { const v = Number(${q('walk-nav-divider')}?.getAttribute('aria-valuenow')); return v !== ${String(initialWidth)} ? v : false; })()`, 10_000);
  const saved = await poll('the preferences written', () => {
    const text = preferencesNow();
    return text !== seeded && text !== null ? JSON.parse(text) : false;
  }, 10_000).catch(() => null);
  await delay(800);
  await walk.shot('02-width-changed');
  const afterChange = await savingSaid(walk);
  check('a changed width shows no preference message and no "not saved"', afterChange.problem === null && afterChange.notSaved === false, JSON.stringify(afterChange));
  check(
    'the width is saved and the older fields are kept',
    saved !== null &&
      saved.navigationWidth === changedWidth &&
      Number.isInteger(saved.explanationWidth) &&
      saved.language === OLDER_PREFERENCES.language &&
      saved.discussionPlace === OLDER_PREFERENCES.discussionPlace &&
      JSON.stringify(saved.explanationBounds) === JSON.stringify(OLDER_PREFERENCES.explanationBounds),
    JSON.stringify(saved),
  );
  check('the host logged no refused preferences', !/preferences not saved/.test(hostLog()));

  stage = 'the walk window closed and opened again';
  await client.main.closeWindow(walkWindow.id);
  await poll('the walk window closed', async () => !(await client.main.windows()).some((w) => !w.destroyed && isWalkPage(w.url)), 15_000);
  walk.close();
  await diff.click('pair-walks');
  walkWindow = await windowShowing(isWalkPage, 'the walk window again');
  const again = new Page(client.cdp, 'walk again', isWalkPage);
  await again.attach(60_000);
  await again.until('the walk', `document.querySelectorAll('[data-ev^="walk-head-"]').length > 0 && ${q('walk-nav-divider')}!==null`, 60_000);
  await delay(2500);
  await again.shot('03-walk-reopened');
  check('the reopened walk window has the saved width', (await navWidth(again)) === changedWidth, `${String(await navWidth(again))} vs ${String(changedWidth)}`);
  const reopened = await savingSaid(again);
  check('the reopened walk shows no preference message and no "not saved"', reopened.problem === null && reopened.notSaved === false, JSON.stringify(reopened));

  stage = 'About DSpatch';
  if (!onWindows) {
    note('About DSpatch is read through Windows UI Automation; not checked on this platform');
    return;
  }
  const hostBuild = JSON.parse(await client.main.ev(`JSON.stringify(JSON.parse(process.mainModule.require('node:fs').readFileSync(${JSON.stringify(path.join(profile, 'host-running.json'))}, 'utf8')))`));
  note('the running host, as its own host-running.json says', `${hostBuild.appVersion} ${hostBuild.commit}`);
  const keptClipboard = await client.main.ev(`process.mainModule.require('electron').clipboard.readText()`);
  try {
    await client.main.ev(`process.mainModule.require('electron').clipboard.writeText('dsp-200 trial placeholder')`);
    check('Help > About DSpatch is in the menu', (await client.main.ev(`(() => { const { Menu, BrowserWindow } = process.mainModule.require('electron'); const item = Menu.getApplicationMenu().getMenuItemById('dspatch-about'); if (!item) return false; const w = BrowserWindow.fromId(${String(mainWindow.id)}); item.click(undefined, w, w.webContents); return item.label; })()`)) === 'About DSpatch');
    const dialogScript = path.join(scriptDir, 'prefs-trial', 'about-dialog.ps1');
    const shown = JSON.parse(run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', dialogScript, '-processId', String(client.child.pid), '-press', 'Copy version information']) || '{}');
    fs.writeFileSync(path.join(evidence, 'about-dialog.json'), `${JSON.stringify(shown, null, 2)}\n`);
    const said = (shown.texts ?? []).join('\n');
    check('About DSpatch opens', shown.found === true && shown.title === 'About DSpatch', JSON.stringify(shown));
    check('it shows the app version from the package', said.includes(`DSpatch ${packageVersion}`), said);
    check('it shows the running host\'s own version', said.includes(`Running host: ${hostBuild.appVersion}`), said);
    check('it offers to copy the version information', (shown.buttons ?? []).includes('Copy version information') && shown.pressed === true, JSON.stringify(shown.buttons));
    const copied = await poll('the clipboard', async () => {
      const text = await client.main.ev(`process.mainModule.require('electron').clipboard.readText()`);
      return text !== 'dsp-200 trial placeholder' ? text : false;
    }, 10_000);
    check('Copy puts the versions on the clipboard', copied.startsWith(`DSpatch ${packageVersion}`) && copied.includes(`Running host: ${hostBuild.appVersion}`), copied);
  } finally {
    await client.main.ev(`process.mainModule.require('electron').clipboard.writeText(${JSON.stringify(keptClipboard ?? '')})`).catch(() => undefined);
  }
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
  process.exitCode = 1;
} finally {
  await quitClient().catch(() => undefined);
  if (profile !== '') {
    await endHost();
    for (const [name, from] of [['preferences.json', preferencesFile()], ['host.log', path.join(profile, 'host.log')]]) {
      try {
        fs.copyFileSync(from, path.join(evidence, name));
      } catch {
        // Not written in this run.
      }
    }
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, profile, project, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${results.some((result) => !result.ok) ? 'FAILED' : 'ALL PASSED'}: ${String(results.length)} checks; evidence ${evidence}`);
}
