// @ts-nocheck: a trial script over untyped DevTools answers.
/**
 * The upgrade trial (DSP-168): a person's data across a release. In one clean container the
 * previous release's .deb is installed and used — an agent chosen, a project opened, a turn
 * completed with a SIMULATED provider, a loop of the person's own in the project — then this
 * release's .deb is installed over it. The new client meets the previous release's host, which a
 * closed window leaves running, ends it, and shows the same conversation, the same agent and
 * project choices and the same loop; and again after a restart. A review preference the previous
 * release saved is kept, and About DSpatch, copied as the person copies it, names this release for
 * the app and for the running host after Restart host and after a restart (DSP-205).
 *
 *     node scripts/trial-package/upgrade.mjs --from v0.1.4 [--to <this release's .deb>]
 *
 * Needs the dspatch-trial image. The previous .deb is fetched from that tag's GitHub release;
 * without --to, this release's .deb is the one `release.mjs --published` fetched, or is fetched
 * from this version's release. No model and no account is reached.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(appDir, '..');
const release = path.join(appDir, 'release');
const evidence = path.join(release, 'trial-upgrade');
const argument = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1] ?? null;
};
const previousTag = argument('--from') ?? 'v0.1.4';
const { version } = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const downloads = (tag) => `https://github.com/nizlas/DSpatch/releases/download/${tag}`;
const suffix = `${String(process.pid)}-${String(Date.now())}`;
const NAME = `dspatch-upgrade-${suffix}`;
const DISPLAY = ':95';
const USER = 'tester';
const data = `/home/${USER}/.config/DSpatch`;
const project = `/home/${USER}/proj`;
const marker = 'UPGRADE-TRIAL-MARK';
const xdotoolRoot = process.env.UPGRADE_TRIAL_XDOTOOL_ROOT ?? '';
const xdo = (args) =>
  inside(USER, `${xdotoolRoot === '' ? '' : 'LD_LIBRARY_PATH=/opt/xtools/lib/x86_64-linux-gnu '}DISPLAY=${DISPLAY} ${xdotoolRoot === '' ? 'xdotool' : '/opt/xtools/bin/xdotool'} ${args}`, true);
const STOP_DIALOG = 'Another DSpatch host is running here';
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_PRESENTATION_LIST_MS: '50',
  DSPATCH_PRESENTATION_TOOL_MS: '400',
  DSPATCH_PRESENTATION_DELTA_MS: '120',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};
const results = [];
const windows = [];
let stage = 'preflight';
let owned = false;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function command(program, args, allowFailure = false) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1048576 });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${program} ${args.slice(0, 3).join(' ')}: ${result.error?.message ?? String(result.status)}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}
const docker = (...args) => command('docker', args);
const inside = (user, script, allowFailure = false) => command('docker', ['exec', '-u', user, NAME, 'bash', '-eu', '-o', 'pipefail', '-c', script], allowFailure);
function check(what, ok, detail = '') {
  results.push({ stage, what, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 500)}`}`);
  if (!ok) throw new Error(what);
}
function note(what, detail) {
  results.push({ stage, what, ok: true, detail, observed: true });
  console.log(`NOTE ${what} :: ${String(detail).slice(0, 500)}`);
}
async function poll(what, read, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`timeout (${stage}): ${what}`);
}
const q = (name) => `document.querySelector('[data-ev="${name}"]')`;

class Win {
  constructor(port, label) {
    this.port = port;
    this.label = label;
    this.pending = new Map();
    this.sequence = 0;
    windows.push(this);
  }
  close() {
    for (const waiting of this.pending.values()) waiting.reject(new Error('DevTools disconnected'));
    this.pending.clear();
    this.ws?.close();
    this.ws = undefined;
  }
  async attach(matches = (url) => !url.includes('window=')) {
    this.close();
    await poll(`${this.label} window`, async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${String(this.port)}/json/list`, { signal: AbortSignal.timeout(1500) });
        const target = (await response.json()).find((entry) => entry.type === 'page' && entry.url !== '' && matches(entry.url));
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
        return true;
      } catch {
        return false;
      }
    }, 60_000);
    await this.until('bridge ready', 'Boolean(window.dspatch) || Boolean(window.dspatchReviewPair)');
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
  async openProject() {
    await this.until('the recent project', `${q('open-project-0')}!==null`);
    await this.click('open-project-0');
    await this.until('the chat', `${q('prompt')}!==null`);
  }
  loops() {
    return this.ev('window.dspatch.listLoopDefinitions().then((listing) => JSON.stringify(listing.choices.map((row) => ({ id: row.definitionId, usable: row.usable, preselected: row.preselected, origin: row.display?.origin ?? null, error: row.display?.error ?? null }))))').then(JSON.parse);
  }
}

async function fetchTo(url, file) {
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(`${url}: HTTP ${String(answer.status)}`);
  fs.writeFileSync(file, Buffer.from(await answer.arrayBuffer()));
}
/** Starts the installed client; with `inspect`, its main process also answers on that inspector port. */
function launch(port, inspect = 0) {
  const env = { HOME: `/home/${USER}`, USER, LOGNAME: USER, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', DISPLAY, ...simulated };
  const inspector = inspect === 0 ? '' : ` --inspect=${String(inspect)}`;
  docker('exec', '-d', '-u', USER, NAME, 'env', '-i', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), 'bash', '-c', `exec dspatch${inspector} --remote-debugging-port=${String(port)} >>/tmp/client.log 2>&1`);
}

/** The client's main process, over the inspector (as in scripts/icon-trial.mjs). */
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
        const target = (await (await fetch(`http://127.0.0.1:${String(this.port)}/json/list`, { signal: AbortSignal.timeout(1500) })).json())[0];
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
    }, 60_000);
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
}

/**
 * DSP-205: About DSpatch as the person reaches it, Help > About DSpatch over the start window, and
 * its text as Copy version information puts it on the clipboard (GTK's dialog text is not readable
 * from here; Copy puts the dialog's own text). The dialog is found on the container's X display by
 * its title and Copy pressed through the X server, as scripts/prefs-trial.mjs does on Linux.
 */
async function aboutCopied(main, name) {
  const placeholder = 'dsp-205 trial placeholder';
  const clipboard = () => main.ev(`process.mainModule.require('electron').clipboard.readText()`);
  const openAbout = () =>
    main.ev(`(() => { const { Menu, BrowserWindow } = process.mainModule.require('electron'); const item = Menu.getApplicationMenu().getMenuItemById('dspatch-about'); const w = BrowserWindow.getAllWindows().find((each) => !each.isDestroyed() && !each.webContents.getURL().includes('window=')); if (!item || !w) return false; item.click(undefined, w, w.webContents); return item.label; })()`);
  const dialogs = () => xdo(`search --name '^About DSpatch$'`).split('\n').filter((line) => /^\d+$/.test(line.trim()));
  for (const keys of [['shift+Tab', 'Return'], ['Left', 'Return'], ['Tab', 'Return']]) {
    await main.ev(`process.mainModule.require('electron').clipboard.writeText(${JSON.stringify(placeholder)})`);
    check(`Help > About DSpatch is in the menu (${name})`, (await openAbout()) === 'About DSpatch');
    const [dialog] = await poll('the About DSpatch dialog on the X display', () => {
      const found = dialogs();
      return found.length > 0 ? found : false;
    }, 15_000);
    xdo(`windowfocus --sync ${dialog.trim()}`);
    xdo(`key --clearmodifiers ${keys.join(' ')}`);
    const text = await poll('the clipboard or the dialog closed', async () => {
      const now = await clipboard();
      if (now !== placeholder) return now;
      return dialogs().length === 0 ? '' : false;
    }, 10_000).catch(() => '');
    if (dialogs().length > 0) xdo(`key --window ${dialog.trim()} Escape`);
    await poll('the dialog closed', () => dialogs().length === 0, 10_000).catch(() => undefined);
    if (text !== '') {
      note(`Copy reached with (${name})`, keys.join(' '));
      fs.writeFileSync(path.join(evidence, `about-${name.replace(/\W+/g, '-')}.txt`), `${text}\n`);
      return text;
    }
  }
  return '';
}
/** About's two lines name this release, for the app and for the host that runs now. */
function checkAbout(text, host, name) {
  const named = (build) => `${version} (${build})`;
  check(`About DSpatch names the app as ${version} (${name})`, text.split('\n')[0]?.startsWith(`DSpatch ${version} (`), text);
  check(`About DSpatch names the running host as ${version}, the host that runs now (${name})`, host.appVersion === version && text.includes(`Running host: ${named(host.commit)}`), JSON.stringify({ text, host: { appVersion: host.appVersion, commit: host.commit, pid: host.pid } }));
}

/** The review preferences as the review windows' own bridge reads them, and their file. */
const preferencesOf = async (review) => JSON.parse(await review.ev('window.dspatchReview.getPreferences().then((answer) => JSON.stringify(answer))'));
const preferencesFile = () => inside(USER, `cat ${data}/reviews/preferences.json 2>/dev/null || true`, true);
async function quit(window) {
  const pid = inside(USER, 'pgrep -o -x dspatch');
  inside(USER, `kill -TERM ${pid}`);
  await poll('the client exits', () => inside(USER, 'if pgrep -x dspatch >/dev/null; then echo running; else echo gone; fi') === 'gone', 15_000);
  window.close();
}
const running = () => JSON.parse(inside(USER, `cat ${data}/host-running.json`));
const installed = () => inside('root', "dpkg-query -W -f='${Version} ${Status}' dspatch");
/** What of the person's is on disk: the conversations, the choices and the project's own loop. */
function belongings() {
  const files = inside(USER, `find ${data}/conversations -maxdepth 1 -name '*.json' -type f | sort`).split('\n').filter(Boolean);
  const conversations = files.map((file) => {
    const saved = JSON.parse(inside(USER, `cat ${quote(file)}`));
    const text = JSON.stringify(saved);
    return { file: path.posix.basename(file), id: saved.conversationId ?? null, messages: Array.isArray(saved.messages) ? saved.messages.length : null, attempts: Array.isArray(saved.attempts) ? saved.attempts.length : null, marked: text.includes(marker) };
  });
  const agent = JSON.parse(inside(USER, `cat ${data}/dspatch-agent-choice.json`)).agent ?? null;
  const projects = JSON.parse(inside(USER, `cat ${data}/dspatch-projects.json`));
  const folders = (projects.workspaces ?? []).map((workspace) => ({ id: workspace.id, folders: workspace.folders }));
  const ownLoop = inside(USER, `sha256sum ${project}/.dspatch/loops/trial-own-loop.loop.json | cut -d' ' -f1`);
  return { conversations, agent, folders, ownLoop };
}
const same = (before, after) => JSON.stringify(before) === JSON.stringify(after);

// DSP-177: the person's review and zoom, made by the previous release and kept by this one.
/** The window's zoom as the page sees it: Electron's zoom factor shows as the device pixel ratio. */
const zoomOf = (win) => win.ev('window.devicePixelRatio');
/** The review of the project's last two commits, opened from the chat's Review in its own window. */
async function openReview(win, port, label) {
  await win.click('open-review');
  const review = new Win(port, label);
  await review.attach((url) => url.includes('view=diff'));
  await review.until('the reviews, the repositories, the log or the review', `${q('pair-ongoing-open-0')}!==null || ${q('pair-repo-0')}!==null || ${q('pair-commit-1')}!==null || ${q('pair-discussion')}!==null`, 60_000);
  if ((await review.ev(`${q('pair-ongoing-open-0')}!==null`)) === true) {
    await review.click('pair-ongoing-open-0');
  } else if ((await review.ev(`${q('pair-discussion')}===null`)) === true) {
    if ((await review.ev(`${q('pair-repo-0')}!==null`)) === true) await review.click('pair-repo-0');
    await review.until('the log', `${q('pair-commit-1')}!==null`);
    const chosen = (count) => `document.querySelectorAll('.rv-pair-commit[aria-pressed=true]').length === ${String(count)}`;
    await review.click('pair-commit-1');
    await review.until('From chosen', chosen(1));
    await review.click('pair-commit-0');
    await review.until('both chosen', chosen(2));
    await review.click('pair-open');
    if ((await review.until('the review of the pair', `${q('pair-discussion')}!==null`, 15_000).catch(() => false)) !== true) {
      await review.ev(`${q('pair-open')}?.click()`);
    }
  }
  const opened = await review.until('the review of the pair', `${q('pair-discussion')}!==null`, 60_000).catch(() => false);
  if (opened === false) {
    await review.shot(`${label.replace(/\W+/g, '-')}-not-opened`).catch(() => undefined);
    throw new Error(`the review did not open: ${String(await review.ev(`[...document.querySelectorAll('[data-ev]')].map((e)=>e.dataset.ev).slice(0,40).join(' ') + ' | ' + document.body.innerText.slice(0,400)`).catch(() => ''))}`);
  }
  if ((await review.ev(`${q('pair-summary')}===null && ${q('pair-files')}!==null`)) === true) await review.click('pair-files');
  return review;
}
const reviewLine = (review) => review.ev(`JSON.stringify({summary:${q('pair-summary')}?.textContent ?? '',decision:document.querySelector('[data-ev="agent-review"]')?.dataset.decision ?? '',result:document.querySelector('[data-ev="agent-review"]')?.innerText.replace(/\\s+/g,' ').match(/awaiting your assessment|not accepted by you|accepted by you|\\d+\\/\\d+ changed lines[^.]*|approved[^.]*/)?.[0] ?? ''})`);
/** The review records on disk: the pair records and their discussions. */
const reviewFiles = () => inside(USER, `find ${data}/reviews -maxdepth 2 \\( -path '*/pairs/*.json' -o -name '*.discussion.json' \\) -type f | sort`, true).split('\n').filter(Boolean);

async function main() {
  stage = 'preflight';
  fs.mkdirSync(path.join(evidence, 'previous'), { recursive: true });
  const previousDeb = path.join(evidence, 'previous', `dspatch_${previousTag.replace(/^v/, '')}_amd64.deb`);
  if (!fs.existsSync(previousDeb)) await fetchTo(`${downloads(previousTag)}/${path.basename(previousDeb)}`, previousDeb);
  check(`the previous release ${previousTag} is at hand`, fs.existsSync(previousDeb), sha256(previousDeb));
  const thisDeb = argument('--to') ?? path.join(release, 'trial-published', `dspatch_${version}_amd64.deb`);
  if (!fs.existsSync(thisDeb)) {
    fs.mkdirSync(path.dirname(thisDeb), { recursive: true });
    await fetchTo(`${downloads(`v${version}`)}/dspatch_${version}_amd64.deb`, thisDeb);
  }
  check(`this release ${version} is at hand`, command('dpkg-deb', ['-f', thisDeb, 'Version']) === version, sha256(thisDeb));
  docker('image', 'inspect', 'dspatch-trial');
  docker('run', '-d', '--init', '--pull=never', '--name', NAME, '--hostname', 'upgrade-trial', '--network', 'host', '--shm-size=512m', '--cap-add', 'SYS_ADMIN', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined', 'dspatch-trial', 'sleep', 'infinity');
  owned = true;
  docker('exec', '-d', NAME, 'Xvfb', DISPLAY, '-screen', '0', '1280x900x24');
  // xdotool, for answering a question the client asks before any window (DSP-177): the image's
  // own (the Dockerfile installs it), or one brought in from UPGRADE_TRIAL_XDOTOOL_ROOT (a /usr
  // tree of the same Ubuntu release) when the image predates that.
  if (xdotoolRoot !== '') docker('cp', xdotoolRoot, `${NAME}:/opt/xtools`);
  await poll('Xvfb', () => inside(USER, `if test -S /tmp/.X11-unix/X${DISPLAY.slice(1)}; then echo ready; fi`));

  stage = `the previous release, ${previousTag}`;
  docker('cp', previousDeb, `${NAME}:/tmp/previous.deb`);
  inside('root', 'dpkg -i /tmp/previous.deb');
  check('the previous release installs', installed() === `${previousTag.replace(/^v/, '')} install ok installed`, installed());
  inside(USER, `mkdir -p ${project}/.dspatch/loops ${project}/docs; cd ${project}; git init -q; echo fixture > README.md; mkdir -p src; printf 'export function greet(name) {\\n  return name;\\n}\\n' > src/app.js; git add .; git -c user.name=Trial -c user.email=trial@example.invalid commit -qm fixture; printf 'export function greet(name) {\\n  return \"Hello, \" + name;\\n}\\n' > src/app.js; git -c user.name=Trial -c user.email=trial@example.invalid commit -qam greeting`);
  // The person's own loop: the runnable development loop under another id, with its graph and
  // roles in the project, as a loop a person keeps in their project is.
  docker('cp', path.join(repoRoot, 'docs', 'loop'), `${NAME}:${project}/docs/loop`);
  const declaration = JSON.parse(fs.readFileSync(path.join(repoRoot, '.dspatch', 'loops', 'dspatch-development-loop.loop.json'), 'utf8'));
  const own = { ...declaration, id: 'trial-own-loop', name: "The person's own loop (upgrade trial)", description: 'A loop kept in the project by its owner. The upgrade must leave it as it is.', notes: 'Kept in the project. Not DSpatch\'s.' };
  fs.writeFileSync(path.join(evidence, 'trial-own-loop.loop.json'), `${JSON.stringify(own, null, 2)}\n`);
  docker('cp', path.join(evidence, 'trial-own-loop.loop.json'), `${NAME}:${project}/.dspatch/loops/trial-own-loop.loop.json`);
  inside('root', `chown -R ${USER}:${USER} ${project}`);
  const first = new Win(9391, 'previous');
  launch(first.port);
  await first.attach();
  await first.until('the start page', `${q('remote-session')}!==null`);
  check('simulated Copilot chosen on the previous release', (await first.ev("window.dspatch.chooseAgent('copilot')")) === 'copilot');
  await first.ev(`window.dspatch.startChatSession({kind:'folder',path:${JSON.stringify(project)}})`);
  await first.ev('location.reload()');
  await first.attach();
  await first.openProject();
  const loopsBefore = await first.loops();
  check("the person's own loop is offered by the previous release", loopsBefore.some((row) => row.id === 'trial-own-loop' && row.usable), JSON.stringify(loopsBefore));
  await first.ev(`window.dspatch.sendPrompt(${JSON.stringify(`${marker}: a turn before the upgrade`)})`);
  await first.until('the turn ran and ended', `document.body.innerText.includes(${JSON.stringify(marker)}) && ${q('turn-activity')}===null`, 120_000);
  await first.shot('01-previous-release-turn');
  // A review with the agent's delegated result, made by the previous release.
  const firstReview = await openReview(first, 9391, 'previous review');
  await firstReview.click('pair-delegate-all');
  await firstReview.click('pair-delegate-all-agent-start');
  // Up to 0.1.17 the report is open and says what was approved; from 0.1.18 (DSP-193) it is folded and its state is in data-state.
  await firstReview.until('the delegated review result', `(()=>{const r=document.querySelector('[data-ev="agent-review"]');return r!==null && (r.dataset.state==='done' || /approved/i.test(r.innerText))})()`, 120_000);
  const reviewBefore = JSON.parse(await reviewLine(firstReview));
  const reviewFilesBefore = reviewFiles();
  check('a review with a delegated result is on disk from the previous release', reviewBefore.result !== '' && reviewFilesBefore.length >= 1, JSON.stringify({ reviewBefore, reviewFilesBefore }));
  // DSP-205: the person's review preferences, the walk window's two column widths, saved through
  // the previous release's own review window as a drag of its dividers saves them.
  const preferencesSet = { ...(await preferencesOf(firstReview)), explanationWidth: 640, navigationWidth: 400 };
  const savedPreferences = JSON.parse(await firstReview.ev(`window.dspatchReview.setPreferences(${JSON.stringify(preferencesSet)}).then((answer) => JSON.stringify(answer))`));
  const preferencesBefore = preferencesFile();
  check('the previous release saves the review preferences', savedPreferences.saved === true && preferencesBefore.includes('640') && preferencesBefore.includes('400'), JSON.stringify({ savedPreferences, preferencesBefore }));
  await firstReview.shot('01b-previous-release-review');
  firstReview.close();
  const previousHost = running();
  check('the previous release runs a standalone host', previousHost.appVersion === previousTag.replace(/^v/, '') && Number.isInteger(previousHost.pid), JSON.stringify(previousHost));
  await quit(first);
  // The person's zoom, in the previous release's own file (its keys and wheel cannot be driven
  // from a page here): the chat two steps in, the diff one. The previous release, started again,
  // must show it before anything is upgraded.
  inside(USER, `printf '%s' '{"version":1,"levels":{"main":2,"review-diff":1}}' > ${data}/window-zoom.json`);
  const zoomed = new Win(9394, 'previous again');
  launch(zoomed.port);
  await zoomed.attach();
  await zoomed.until('the start page', `${q('remote-session')}!==null`);
  const zoomBefore = await zoomOf(zoomed);
  check('the previous release opens its window at the saved zoom', Math.abs(zoomBefore - 1.44) < 0.01, String(zoomBefore));
  await quit(zoomed);
  const zoomFile = inside(USER, `cat ${data}/window-zoom.json`);
  const before = belongings();
  check('a conversation with the turn, the agent choice, the project and the own loop are on disk', before.conversations.length === 1 && before.conversations[0].marked && before.agent === 'copilot' && before.folders.length === 1 && before.ownLoop !== '', JSON.stringify(before));
  check('the closed window left the previous host running', inside(USER, `if kill -0 ${String(previousHost.pid)}; then echo alive; fi`) === 'alive');

  stage = `this release, ${version}, installed over it`;
  docker('cp', thisDeb, `${NAME}:/tmp/this.deb`);
  inside('root', 'dpkg -i /tmp/this.deb');
  check('this release installs over the previous one', installed() === `${version} install ok installed`, installed());
  const bundledManifest = inside('root', 'find /opt/DSpatch/resources -name host-manifest.json -type f');
  const bundled = JSON.parse(inside('root', `cat ${quote(bundledManifest)}`));
  check('the installed host manifest is this version\'s', bundled.appVersion === version, JSON.stringify({ hostId: bundled.hostId, appVersion: bundled.appVersion }));
  check("the person's own loop file is untouched by the installation", belongings().ownLoop === before.ownLoop);
  check('the previous host is still running after the installation', inside(USER, `if kill -0 ${String(previousHost.pid)}; then echo alive; fi`) === 'alive');

  stage = 'the new client meets the previous host';
  const second = new Win(9392, 'upgraded');
  launch(second.port, 9492);
  // Two ways to meet the previous host. When the two builds can work together (the same host
  // contract), the window opens on the previous host and offers Restart host. When this release
  // changed the contract, as 0.1.8 did, this client cannot use that host: before any window it
  // asks whether to stop it ("Another DSpatch host is running here"), Stop it and continue
  // being the default. Either way the previous host must be found, and ended only by the person.
  const met = await poll('the window, or the question before it', async () => {
    if (xdo(`search --name '${STOP_DIALOG}'`).trim() !== '') return 'question';
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(second.port)}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      return list.some((entry) => entry.type === 'page' && entry.url !== '' && !entry.url.includes('window=')) ? 'window' : false;
    } catch {
      return false;
    }
  }, 60_000);
  note('how the new client met the previous host', met);
  if (met === 'question') {
    check('the new client finds the previous host still running and asks before stopping it', inside(USER, `if kill -0 ${String(previousHost.pid)}; then echo alive; fi`) === 'alive');
    // The person's answer: the default button, Stop it and continue.
    xdo(`search --name '${STOP_DIALOG}' windowfocus --sync key --clearmodifiers Return`);
    await second.attach();
    await second.until('the start page', `${q('remote-session')}!==null`);
  } else {
    await second.attach();
    await second.until('the start page', `${q('remote-session')}!==null`);
    const line = await second.until('the host line', `${q('host-link')}?.textContent ?? false`, 30_000);
    note('what the host line says of the previous host', line.replace(/\s+/g, ' ').trim());
    check('the new client says the previous host needs a restart, with Restart host', /Restart needed to finish updating/.test(line) && (await second.ev(`${q('host-link-leave')}?.textContent ?? ''`)).includes('Restart host'), line.replace(/\s+/g, ' ').trim());
    await second.shot('02-new-client-previous-host');
    const attached = running();
    check('the new client attached to the previous host rather than starting another', attached.pid === previousHost.pid, JSON.stringify(attached));
    await second.openProject();
    await second.until('the earlier conversation through the previous host', `document.body.innerText.includes(${JSON.stringify(marker)})`);
    check('the earlier conversation is shown through the previous host', true);
    // Restart host: the explicit action that ends the idle older host; the window then starts this build's.
    await second.click('host-link-leave');
  }
  await poll('a host of this release', () => {
    try {
      const now = running();
      return now.pid !== previousHost.pid && now.appVersion === version ? now : false;
    } catch {
      return false;
    }
  }, 60_000);
  const replaced = running();
  check('the previous host was ended and this release\'s host took its place', replaced.appVersion === version && inside(USER, `if kill -0 ${String(previousHost.pid)} 2>/dev/null; then echo alive; else echo gone; fi`) === 'gone', JSON.stringify(replaced));
  const lineNow = await second.until('the host line now', `${q('host-link')}?.textContent ?? false`, 30_000);
  check('the window then says it is on this computer, with no restart pending', /On this computer/.test(lineNow) && !/Restart needed/.test(lineNow), lineNow.replace(/\s+/g, ' ').trim());
  await second.shot('02-new-client-on-this-release');
  const secondMain = new Main(9492);
  await secondMain.attach();
  checkAbout(await aboutCopied(secondMain, 'after Restart host'), running(), 'after Restart host');
  secondMain.close();
  await second.until('the chat again', `${q('prompt')}!==null || ${q('open-project-0')}!==null`, 60_000);
  if ((await second.ev(`${q('prompt')}===null`)) === true) await second.openProject();
  await second.until('the earlier conversation through this release\'s host', `document.body.innerText.includes(${JSON.stringify(marker)})`, 60_000);
  await second.shot('03-upgraded-conversation');
  const loopsAfter = await second.loops();
  check("the person's own loop is offered by this release", loopsAfter.some((row) => row.id === 'trial-own-loop' && row.usable), JSON.stringify(loopsAfter));
  const after = belongings();
  check('the window\'s zoom is as the previous release left it', Math.abs((await zoomOf(second)) - zoomBefore) < 0.01, JSON.stringify({ zoomBefore, now: await zoomOf(second) }));
  const secondReview = await openReview(second, 9392, 'upgraded review');
  check('the review window opens at its saved zoom, and the zoom file is as it was', Math.abs((await zoomOf(secondReview)) - 1.2) < 0.01 && inside(USER, `cat ${data}/window-zoom.json`) === zoomFile, JSON.stringify({ review: await zoomOf(secondReview), file: inside(USER, `cat ${data}/window-zoom.json`) }));
  await secondReview.until('the delegated result', `document.querySelector('[data-ev="agent-review"]')!==null`, 60_000);
  const reviewAfter = JSON.parse(await reviewLine(secondReview));
  // DSP-193 (0.1.18): a delegated review is the agent's assessment until the person accepts it. A
  // result recorded by an earlier release and never decided on reads as awaiting the person and
  // counts nothing; the files and the result are kept as written, with the same totals.
  const totals = (line) => line.replace(/\b\d+ of (\d+)/g, 'N of $1');
  const reread =
    reviewAfter.decision !== '' && reviewBefore.decision === ''
      ? reviewAfter.decision === 'awaiting' && reviewAfter.result === 'awaiting your assessment' && totals(reviewAfter.summary) === totals(reviewBefore.summary)
      : reviewAfter.summary === reviewBefore.summary && reviewAfter.result !== '';
  check('the review and its delegated result are as the previous release left them (an earlier agent approval now awaits the person)', reread && reviewFilesBefore.every((file) => reviewFiles().includes(file)), JSON.stringify({ reviewBefore, reviewAfter }));
  const preferencesAfter = await preferencesOf(secondReview);
  check('the review preferences are as the previous release saved them, in the window and on disk', preferencesAfter.explanationWidth === 640 && preferencesAfter.navigationWidth === 400 && preferencesAfter.language === preferencesSet.language && preferencesFile() === preferencesBefore, JSON.stringify({ preferencesAfter, file: preferencesFile() }));
  await secondReview.shot('03b-upgraded-review');
  secondReview.close();
  check('the conversation, the agent choice, the project and the own loop are as they were', same(before.conversations, after.conversations) && after.agent === before.agent && same(before.folders, after.folders) && after.ownLoop === before.ownLoop, JSON.stringify({ before, after }));
  await quit(second);

  stage = 'this release restarted';
  const third = new Win(9393, 'restarted');
  launch(third.port, 9493);
  await third.attach();
  await third.openProject();
  await third.until('the earlier conversation after a restart', `document.body.innerText.includes(${JSON.stringify(marker)})`, 60_000);
  check('the same host serves the restarted client', running().pid === replaced.pid, JSON.stringify(running()));
  const again = belongings();
  check('everything of the person\'s is still there after the restart', same(before.conversations, again.conversations) && again.agent === before.agent && same(before.folders, again.folders) && again.ownLoop === before.ownLoop, JSON.stringify(again));
  check('no second conversation was made of the old one', again.conversations.length === 1);
  check('the review preferences file is as the previous release saved it', preferencesFile() === preferencesBefore, preferencesFile());
  const thirdMain = new Main(9493);
  await thirdMain.attach();
  checkAbout(await aboutCopied(thirdMain, 'after a restart'), running(), 'after a restart');
  thirdMain.close();
  await third.shot('04-restarted');
  await quit(third);
}

fs.mkdirSync(evidence, { recursive: true });
try {
  await main();
} catch (error) {
  results.push({ stage, what: 'the trial reached its end', ok: false, detail: error.stack ?? String(error) });
  console.error(`FAIL ${stage}: ${error.stack ?? error}`);
  for (const window of windows) await window.shot(`failure-${window.label}`).catch(() => undefined);
  process.exitCode = 1;
} finally {
  for (const window of windows) window.close();
  if (owned) {
    fs.writeFileSync(path.join(evidence, 'client.log'), command('docker', ['exec', '-u', USER, NAME, 'bash', '-c', `cat /tmp/client.log ${data}/host.log 2>/dev/null; true`], true));
    const removed = command('docker', ['rm', '-f', NAME], true);
    results.push({ stage: 'cleanup', what: 'own container removed', ok: removed === NAME, detail: NAME });
    if (removed !== NAME) process.exitCode = 1;
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ previousTag, version, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${results.some((result) => !result.ok) ? 'FAILED' : 'ALL PASSED'}: ${String(results.length)} checks; evidence ${evidence}`);
}
