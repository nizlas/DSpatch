// @ts-nocheck: a trial script over untyped DevTools and inspector answers.
/**
 * The walk Accept scope trial (DSP-201), on the preference trial's plumbing (copied from
 * scripts/prefs-trial.mjs). DSpatch's real windows over an isolated profile and a disposable
 * project with a generic new file of 417 lines; a walk over the pair marks lines 151–159 in its
 * first step and 200–204 in its second. The walk is a prepared definition written into the
 * review's walk folder, not a model's: the trial is about the decision's scope, not the text.
 *
 * It checks that the walk marks exactly 151–159; that the Review section's Accept names those lines
 * and nothing else, before and after the whole file is shown around them; that the saved mark is
 * exactly those lines with where it was made; that the diff window then draws exactly 9 of 417 lines
 * as reviewed; that a second place in the same hunk decides about its own 5 lines and withdrawing it
 * leaves the first; that the result is the same after closing the walk window and after restarting
 * the app and its host; and that an earlier whole-file mark with no origin, as 0.1.22 wrote one, is
 * said to be uncertain and can be withdrawn so the place decides about its 9 lines again.
 *
 *     node scripts/accept-scope-trial.mjs [<evidence folder>]
 *
 * Needs `npm run build`, and on Linux an X display (`xvfb-run`). Input is DevTools input into the
 * page, with no mouse or keyboard of the machine's own. Nothing of the machine's own profile is
 * touched; the standalone hosts this trial starts are ended.
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
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-accept-scope', `${String(process.pid)}-${String(Date.now())}`));
const electron = createRequire(import.meta.url)('electron');
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};
const BIG = 'src/big.js';
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

async function main() {
  stage = 'preflight';
  check('the app is built', fs.existsSync(path.join(appDir, 'dist', 'main', 'main.js')) && fs.existsSync(path.join(appDir, 'dist', 'renderer', 'index.html')));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-accept-profile-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-accept-project-'));
  const git = (...args) => run('git', ['-C', project, '-c', 'user.name=Trial', '-c', 'user.email=trial@example.invalid', '-c', 'core.autocrlf=false', ...args]);
  git('init', '-q');
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src', 'small.js'), 'export const small = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'Commit 1');
  const base = git('rev-parse', 'HEAD');
  // A generic new file of 417 lines.
  fs.writeFileSync(path.join(project, BIG), `${range(1, 417).map((line) => `export const value${String(line)} = ${String(line)};`).join('\n')}\n`);
  git('add', '.');
  git('commit', '-qm', 'Commit 2: a new file of 417 lines');
  const target = git('rev-parse', 'HEAD');
  // The review panel docked in the walk window, as a person who chose it there.
  fs.mkdirSync(path.join(profile, 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'reviews', 'preferences.json'), `${JSON.stringify({ language: 'en', discussionPlace: 'walk' }, null, 2)}\n`);

  stage = 'the review of the pair';
  const main = await launch('accept');
  check('simulated Copilot choice accepted', (await main.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await main.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await main.ev('location.reload()');
  await main.attach();
  let diff = await openReview(main);
  await openPair(diff);
  const key = await poll('the review record', () => reviewKey(), 20_000);
  note('the review', key);
  // The walk, as a prepared definition in the review's own walk folder: step 1 marks 151–159, step 2 marks 200–204.
  const walkFolder = path.join(profile, 'reviews', 'generated', key);
  fs.mkdirSync(walkFolder, { recursive: true });
  const step = (id, title, start, end) => ({ id, title, text: `What lines ${String(start)} to ${String(end)} add.`, refs: [{ path: BIG, side: 'target', start, end, role: 'walk', anchor: `value${String(start)} =` }] });
  fs.writeFileSync(
    path.join(walkFolder, 'accept-scope.review.json'),
    `${JSON.stringify({ format: 'dspatch-review/1', title: 'The new file', repository: project, base, target, walks: [{ id: 'W1', title: 'The new file', question: 'What does it add?', steps: [step('W1.1', 'Values 151 to 159', 151, 159), step('W1.2', 'Values 200 to 204', 200, 204)] }] }, null, 2)}\n`,
  );

  // The review window counts its walks when it opens: open it again so it counts this one.
  await diff.ev('location.reload()');
  await diff.attach(60_000);
  await diff.until('the ongoing review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await diff.ev(`${q('pair-discussion')}!==null`)) !== true) await diff.click('pair-ongoing-open-0');
  await diff.until('the walk offered', `${q('pair-walks')}?.getAttribute('aria-disabled') === 'false'`, 30_000);

  stage = 'the walk marks 151–159';
  let walk = await openWalk(diff);
  check('the walk marks exactly lines 151–159 for the first place', JSON.stringify(await markedRows(walk)) === JSON.stringify(range(151, 159)), JSON.stringify(await markedRows(walk)));
  let section = await reviewSectionPage();
  let said = await placesSaid(section);
  check('the Review section decides about exactly the marked lines', said.length === 1 && said[0].marked === 'target:151-159' && said[0].lines === 9 && said[0].accepted === 0, JSON.stringify(said));
  check('the Accept button names lines 151–159', said[0].text.includes('Accept new lines 151–159 in big.js'), said[0].text);
  await walk.shot('01-walk-marks-151-159');

  stage = 'the whole file shown around the marking';
  const rowsBefore = await walk.ev(`document.querySelectorAll('.rv-row[data-line]').length`);
  note('rows drawn at the place', String(rowsBefore));
  await walk.ev(`document.querySelector('.rv-navbar-controls .rv-seg').querySelectorAll('button')[2].click()`);
  await walk.until('the whole file chosen and more rows drawn', `document.querySelector('.rv-navbar-controls .rv-seg').querySelectorAll('button')[2].getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.rv-row[data-line]').length > ${String(rowsBefore)}`, 15_000);
  note('rows drawn with the whole file', String(await walk.ev(`document.querySelectorAll('.rv-row[data-line]').length`)));
  check('the marking is still exactly 151–159', JSON.stringify(await markedRows(walk)) === JSON.stringify(range(151, 159)));
  said = await placesSaid(section);
  check('Accept still names exactly 151–159', said.length === 1 && said[0].marked === 'target:151-159' && said[0].lines === 9, JSON.stringify(said));
  await walk.shot('02-whole-file-shown');

  stage = 'Accept at the first place';
  const first = await confirmAccept(section, 0, 'new lines 151–159 in big.js');
  await section.until('9 lines accepted', `document.querySelector('[data-ev="place-decision"]')?.dataset.accepted === '9'`, 15_000);
  const marks = recordNow(key).marks;
  const last = marks.at(-1);
  check('one mark was saved, over exactly target lines 151–159, said as made at the walk place', marks.length === 1 && last.op === 'manual' && JSON.stringify(last.scope) === JSON.stringify({ kind: 'lines', side: 'target', path: BIG, start: 151, end: 159 }) && last.origin?.kind === 'walk' && last.origin.stepId === 'W1.1', JSON.stringify(marks));
  note('the confirmation', first.scope);
  let strips = await diffStrips(diff);
  check('the diff window draws exactly lines 151–159 of 417 as reviewed', strips.length === 417 && JSON.stringify(manualLines(strips)) === JSON.stringify(range(151, 159)), `${String(strips.length)} strips; manual ${JSON.stringify(manualLines(strips))}`);
  check('its line status names the walk step', strips.find((strip) => strip.line === 151)?.label.includes('in walk step W1.1') === true, strips.find((strip) => strip.line === 151)?.label);
  await diff.shot('03-diff-after-accept');

  stage = 'a second place in the same hunk';
  await walk.ev(`document.querySelector('.rv-nav-next').click()`);
  await walk.until('the second place', `JSON.stringify([...document.querySelectorAll('[data-focus-active]')].map((row) => Number(row.dataset.line))) === ${JSON.stringify(JSON.stringify(range(200, 204)))}`, 15_000);
  said = await placesSaid(section);
  check('the second place decides about its own 5 lines, none of them decided yet', said.length === 1 && said[0].marked === 'target:200-204' && said[0].accepted === 0, JSON.stringify(said));
  await confirmAccept(section, 0, 'new lines 200–204 in big.js');
  await section.until('5 lines accepted', `document.querySelector('[data-ev="place-decision"]')?.dataset.accepted === '5'`, 15_000);
  strips = await diffStrips(diff);
  check('the diff window draws 14 lines: both places, nothing between them', JSON.stringify(manualLines(strips)) === JSON.stringify([...range(151, 159), ...range(200, 204)]), JSON.stringify(manualLines(strips)));
  await section.ev(`${q('place-withdraw')}.click()`);
  await section.until('the second place withdrawn', `document.querySelector('[data-ev="place-decision"]')?.dataset.accepted === '0'`, 15_000);
  strips = await diffStrips(diff);
  check('withdrawing the second place leaves the first place\'s 9 lines', JSON.stringify(manualLines(strips)) === JSON.stringify(range(151, 159)), JSON.stringify(manualLines(strips)));

  stage = 'the walk window closed and opened again';
  const walkWindow = (await client.main.windows()).find((w) => !w.destroyed && isWalkPage(w.url));
  await client.main.closeWindow(walkWindow.id);
  await poll('the walk window closed', async () => !(await client.main.windows()).some((w) => !w.destroyed && isWalkPage(w.url)), 15_000);
  walk = await openWalk(diff);
  await walk.ev(`document.querySelector('.rv-nav-button:not(.rv-nav-next)')?.click()`);
  await walk.until('the first place', `JSON.stringify([...document.querySelectorAll('[data-focus-active]')].map((row) => Number(row.dataset.line))) === ${JSON.stringify(JSON.stringify(range(151, 159)))}`, 15_000);
  section = await reviewSectionPage();
  said = await placesSaid(section);
  check('the reopened walk reads 9 of 9 marked lines accepted', said[0]?.accepted === 9 && said[0].lines === 9, JSON.stringify(said));

  stage = 'after a restart of the app and its host';
  diff = await restart('restarted');
  strips = await diffStrips(diff);
  check('after the restart the diff window draws exactly 151–159', JSON.stringify(manualLines(strips)) === JSON.stringify(range(151, 159)), JSON.stringify(manualLines(strips)));
  walk = await openWalk(diff);
  await walk.until('the first place', `JSON.stringify([...document.querySelectorAll('[data-focus-active]')].map((row) => Number(row.dataset.line))) === ${JSON.stringify(JSON.stringify(range(151, 159)))}`, 15_000).catch(async () => {
    await walk.ev(`document.querySelector('.rv-nav-button:not(.rv-nav-next)')?.click()`);
  });
  section = await reviewSectionPage();
  said = await placesSaid(section);
  check('after the restart the walk reads 9 of 9 marked lines accepted', said[0]?.accepted === 9 && said[0].marked === 'target:151-159', JSON.stringify(said));
  await walk.shot('04-after-restart');

  stage = 'an earlier whole-file acceptance as 0.1.22 wrote it';
  await quitClient();
  await endHost();
  const record = recordNow(key);
  // As a 0.1.22 walk's Accept wrote it: the whole hunk, with no word of where it was made.
  record.marks.push({ id: 'legacy-0', op: 'manual', scope: { kind: 'lines', side: 'target', path: BIG, start: 1, end: 417 }, reason: '', at: new Date().toISOString() });
  fs.writeFileSync(path.join(pairsDir(), `${key}.json`), `${JSON.stringify(record, null, 2)}\n`);
  diff = await restart('legacy');
  strips = await diffStrips(diff);
  check('the earlier mark is read as it was saved: all 417 lines', manualLines(strips).length === 417, String(manualLines(strips).length));
  walk = await openWalk(diff);
  section = await reviewSectionPage();
  await section.until('the first place', `document.querySelector('[data-ev="place-decision"]')?.dataset.marked === 'target:151-159'`, 15_000).catch(async () => {
    await walk.ev(`document.querySelector('.rv-nav-button:not(.rv-nav-next)')?.click()`);
  });
  said = await placesSaid(section);
  check('the walk says the earlier decision reaches beyond its marking and is uncertain', said[0]?.earlier === 1 && /408 lines beyond the marking/.test(said[0].text) && /not known/.test(said[0].text), JSON.stringify(said));
  await walk.shot('05-earlier-decision-uncertain');
  await section.shot('05-earlier-decision-in-review');
  await section.ev(`${q('place-earlier-withdraw')}.click()`);
  await section.until('the earlier decision withdrawn', `document.querySelector('[data-ev="place-decision"]')?.dataset.accepted === '0'`, 15_000);
  strips = await diffStrips(diff);
  check('withdrawing it returns every line it held on', manualLines(strips).length === 0, String(manualLines(strips).length));
  await confirmAccept(section, 0, 'new lines 151–159 in big.js');
  await section.until('9 lines accepted', `document.querySelector('[data-ev="place-decision"]')?.dataset.accepted === '9'`, 15_000);
  strips = await diffStrips(diff);
  check('the place then decides about its 9 lines again: 9 of 417', JSON.stringify(manualLines(strips)) === JSON.stringify(range(151, 159)), JSON.stringify(manualLines(strips)));
  check('the history keeps every mark, the earlier one included', recordNow(key).marks.some((mark) => mark.id === 'legacy-0'));
  await diff.click('pair-files');
  const shown = await diff.until('the file list', `[...document.querySelectorAll('[data-file-key]')].find((row) => row.textContent.includes('big.js'))?.querySelector('.rv-pair-progress')?.textContent ?? false`, 15_000);
  check('the file list gives the file 2% (9 of 417, rounded down)', shown === '2%', shown);
  await diff.shot('06-diff-9-of-417');
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
  if (profile !== '') {
    await endHost();
    const key = reviewKey();
    if (key) fs.copyFileSync(path.join(pairsDir(), `${key}.json`), path.join(evidence, 'pair-record.json'));
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, profile, project, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${results.some((result) => !result.ok) ? 'FAILED' : 'ALL PASSED'}: ${String(results.length)} checks; evidence ${evidence}`);
}
