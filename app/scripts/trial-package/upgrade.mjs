// @ts-nocheck: a trial script over untyped DevTools answers.
/**
 * The upgrade trial (DSP-168): a person's data across a release. In one clean container the
 * previous release's .deb is installed and used — an agent chosen, a project opened, a turn
 * completed with a SIMULATED provider, a loop of the person's own in the project — then this
 * release's .deb is installed over it. The new client meets the previous release's host, which a
 * closed window leaves running, ends it, and shows the same conversation, the same agent and
 * project choices and the same loop; and again after a restart.
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
  async attach() {
    this.close();
    await poll(`${this.label} window`, async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${String(this.port)}/json/list`, { signal: AbortSignal.timeout(1500) });
        const target = (await response.json()).find((entry) => entry.type === 'page' && entry.url !== '' && !entry.url.includes('window='));
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
    await this.until('bridge ready', 'Boolean(window.dspatch)');
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
function launch(port) {
  const env = { HOME: `/home/${USER}`, USER, LOGNAME: USER, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', DISPLAY, ...simulated };
  docker('exec', '-d', '-u', USER, NAME, 'env', '-i', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), 'bash', '-c', `exec dspatch --remote-debugging-port=${String(port)} >>/tmp/client.log 2>&1`);
}
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
  await poll('Xvfb', () => inside(USER, `if test -S /tmp/.X11-unix/X${DISPLAY.slice(1)}; then echo ready; fi`));

  stage = `the previous release, ${previousTag}`;
  docker('cp', previousDeb, `${NAME}:/tmp/previous.deb`);
  inside('root', 'dpkg -i /tmp/previous.deb');
  check('the previous release installs', installed() === `${previousTag.replace(/^v/, '')} install ok installed`, installed());
  inside(USER, `mkdir -p ${project}/.dspatch/loops; cd ${project}; git init -q; echo fixture > README.md; git add .; git -c user.name=Trial -c user.email=trial@example.invalid commit -qm fixture`);
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
  const previousHost = running();
  check('the previous release runs a standalone host', previousHost.appVersion === previousTag.replace(/^v/, '') && Number.isInteger(previousHost.pid), JSON.stringify(previousHost));
  await quit(first);
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
  launch(second.port);
  await second.attach();
  await second.until('the start page', `${q('remote-session')}!==null`);
  const line = await second.until('the host line', `${q('host-link')}?.textContent ?? false`, 30_000);
  note('what the host line says of the previous host', line.replace(/\s+/g, ' ').trim());
  await second.shot('02-new-client-previous-host');
  const attached = running();
  check('the new client attached to the previous host rather than starting another', attached.pid === previousHost.pid, JSON.stringify(attached));
  await second.openProject();
  await second.until('the earlier conversation through the previous host', `document.body.innerText.includes(${JSON.stringify(marker)})`);
  check('the earlier conversation is shown through the previous host', true);
  // End host: the explicit action that ends an idle host; the window then starts this build's.
  await second.click('host-link-leave');
  await poll('a host of this release', () => {
    try {
      const now = running();
      return now.pid !== previousHost.pid && now.appVersion === version ? now : false;
    } catch {
      return false;
    }
  }, 60_000);
  const replaced = running();
  check('End host ended the previous host and this release\'s host took its place', replaced.appVersion === version && inside(USER, `if kill -0 ${String(previousHost.pid)} 2>/dev/null; then echo alive; else echo gone; fi`) === 'gone', JSON.stringify(replaced));
  await second.until('the chat again', `${q('prompt')}!==null || ${q('open-project-0')}!==null`, 60_000);
  if ((await second.ev(`${q('prompt')}===null`)) === true) await second.openProject();
  await second.until('the earlier conversation through this release\'s host', `document.body.innerText.includes(${JSON.stringify(marker)})`, 60_000);
  await second.shot('03-upgraded-conversation');
  const loopsAfter = await second.loops();
  check("the person's own loop is offered by this release", loopsAfter.some((row) => row.id === 'trial-own-loop' && row.usable), JSON.stringify(loopsAfter));
  const after = belongings();
  check('the conversation, the agent choice, the project and the own loop are as they were', same(before.conversations, after.conversations) && after.agent === before.agent && same(before.folders, after.folders) && after.ownLoop === before.ownLoop, JSON.stringify({ before, after }));
  await quit(second);

  stage = 'this release restarted';
  const third = new Win(9393, 'restarted');
  launch(third.port);
  await third.attach();
  await third.openProject();
  await third.until('the earlier conversation after a restart', `document.body.innerText.includes(${JSON.stringify(marker)})`, 60_000);
  check('the same host serves the restarted client', running().pid === replaced.pid, JSON.stringify(running()));
  const again = belongings();
  check('everything of the person\'s is still there after the restart', same(before.conversations, again.conversations) && again.agent === before.agent && same(before.folders, again.folders) && again.ownLoop === before.ownLoop, JSON.stringify(again));
  check('no second conversation was made of the old one', again.conversations.length === 1);
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
