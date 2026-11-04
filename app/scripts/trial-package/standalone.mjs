// @ts-nocheck: a trial script over untyped DevTools answers.
/** Installed DSP-161 trial. Run: node scripts/trial-package/standalone.mjs
 * Real Electron/Xvfb and SSH; SIMULATED providers only. Requires dspatch-trial and
 * the current release .deb plus matching release/host artifacts. No downloads.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const release = path.join(appDir, 'release');
const suffix = `${process.pid}-${Date.now()}`;
const evidence = path.join(release, 'trial-standalone', suffix);
const WORK = `dspatch-standalone-work-${suffix}`;
const CLIENT = `dspatch-standalone-client-${suffix}`;
const WORK_DEBUG = 9381;
const CLIENT_DEBUG = 9382;
const SSH_PORT = 2293;
const data = '/home/hostuser/.config/DSpatch';
const marker = 'STANDALONE-RUNNING-MARK';
const simulated = {
  DSPATCH_TRIAL_HOST_RUN: 'review-flow',
  DSPATCH_PRESENTATION_MODELS: 'copilot',
  DSPATCH_PRESENTATION_LIST_MS: '50',
  DSPATCH_PRESENTATION_TOOL_MS: '400',
  DSPATCH_PRESENTATION_DELTA_MS: '120',
  DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated',
};
const results = [];
const owned = [];
const windows = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
let stage = 'preflight';
let identity = {};
let interrupted = '';
const onSignal = (signal) => { interrupted = signal; };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
const deadline = setTimeout(() => { interrupted = 'eight-minute trial deadline'; }, 8 * 60_000);
deadline.unref();

function command(program, args, allowFailure = false) {
  if (interrupted && !allowFailure) throw new Error(`Trial interrupted: ${interrupted}`);
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 90_000, maxBuffer: 32 * 1048576 });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${program} ${args.slice(0, 3).join(' ')}: ${result.error?.message ?? result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}
const docker = (...args) => command('docker', args);
const inside = (name, user, script) => docker('exec', '-u', user, name, 'bash', '-eu', '-o', 'pipefail', '-c', script);
function check(what, ok, detail = '') {
  results.push({ stage, what, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? ` :: ${String(detail).slice(0, 500)}` : ''}`);
  if (!ok) throw new Error(what);
}
async function poll(what, read, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (interrupted) throw new Error(`Trial interrupted: ${interrupted}`);
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
    for (const waiting of this.pending.values()) waiting.reject(new Error('CDP disconnected'));
    this.pending.clear();
    this.ws?.close();
  }
  async attach() {
    this.close();
    await poll(`${this.label} window`, async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(1500) });
        const target = (await response.json()).find((entry) => entry.type === 'page' && !entry.url.includes('window='));
        if (!target) return false;
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        this.ws = socket;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { socket.close(); reject(new Error('CDP open timeout')); }, 3000);
          socket.onopen = () => { clearTimeout(timer); resolve(); };
          socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP open failed')); };
        });
        socket.onmessage = (event) => {
          const answer = JSON.parse(event.data);
          const waiting = this.pending.get(answer.id);
          this.pending.delete(answer.id);
          if (answer.error) waiting?.reject(new Error(JSON.stringify(answer.error)));
          else waiting?.resolve(answer.result);
        };
        return true;
      } catch { return false; }
    }, 40_000);
    await this.until('bridge ready', 'Boolean(window.dspatch)');
  }
  cmd(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 12_000);
      this.pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  async ev(expression) {
    const answer = await this.cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
    return answer.result?.value;
  }
  until(what, expression, ms) { return poll(`${this.label}: ${what}`, () => this.ev(expression), ms); }
  async shot(name) {
    const answer = await this.cmd('Page.captureScreenshot', { format: 'png' });
    if (!answer.data) throw new Error('Empty screenshot');
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(answer.data, 'base64'));
  }
  async click(name) {
    await this.until(name, `${q(name)}!==null && !${q(name)}.disabled`);
    const box = await this.ev(`(()=>{const element=${q(name)};element.scrollIntoView({block:'center'});const box=element.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2}})()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.cmd('Input.dispatchMouseEvent', { type, ...box, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }
  async reloadProject() {
    await this.ev('location.reload()');
    await this.until('recent project', `${q('open-project-0')}!==null`);
    await this.click('open-project-0');
    await this.until('chat', `${q('prompt')}!==null`);
  }
  async connect() {
    await this.click('remote-session');
    await this.until('SSH target', `${q('ssh-target')}!==null`);
    await this.click('ssh-target');
    await this.cmd('Input.insertText', { text: 'standalone-work' });
    await this.click('ssh-connect');
    const seen = [];
    const asked = [];
    await poll('Remote Session connects', async () => {
      const state = await this.ev(`({status:${q('ssh-status')}?.textContent??'',kind:${q('ssh-question')}?.dataset.kind??null,question:document.querySelector('.ssh-question__text')?.textContent??'',line:${q('host-link')}?.textContent??'',busy:${q('ssh-connect')}?.disabled})`);
      if (state.status && seen.at(-1) !== state.status) {
        seen.push(state.status);
        console.log(`SSH ${state.status}`);
        if (/Installing host|Downloading/i.test(state.status)) throw new Error(`Unexpected host installation: ${state.status}`);
      }
      if (state.kind) {
        asked.push(state.question);
        check('SSH asks no password, host download or desktop handover', state.kind !== 'secret' && !/DSpatch is open|hand.?over|download|install/i.test(state.question), state.question);
        await this.click('ssh-yes');
        await delay(250);
      }
      if (/^On /.test(state.line) && !/^On this computer/.test(state.line)) return true;
      if (state.busy === false && seen.length > 1) throw new Error(`SSH refused: ${seen.join(' > ')}`);
      return false;
    }, 90_000);
    return { seen, asked };
  }
}

function snapshot() {
  return JSON.parse(inside(WORK, 'hostuser', `cat ${data}/host-claim.json`));
}
function sameHost(pid) {
  const current = snapshot();
  const pids = inside(WORK, 'hostuser', "pgrep -f '[d]ist/host/remote-host.js'").split(/\s+/).map(Number);
  return { ok: current.kind === 'standalone' && current.pid === pid && pids.length === 1 && pids[0] === pid, claim: current, pids };
}
function conversations() {
  const files = inside(WORK, 'hostuser', `find ${data}/conversations -maxdepth 1 -name '*.json' -type f`).split('\n').filter(Boolean);
  return files.map((file) => JSON.parse(inside(WORK, 'hostuser', `cat ${quote(file)}`)));
}
function assertOneAttempt() {
  const saved = conversations();
  const attempts = saved.flatMap((conversation) => conversation.attempts).filter((attempt) => JSON.stringify(attempt).includes(marker));
  check('one conversation and one prompt attempt, never replayed', saved.length === 1 && attempts.length === 1 && ['running', 'completed'].includes(attempts[0].state), JSON.stringify(attempts.map((attempt) => ({ state: attempt.state, id: attempt.attemptId }))));
  return attempts[0];
}
function launch(name, user, port, display) {
  const env = { HOME: `/home/${user}`, USER: user, LOGNAME: user, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', DISPLAY: display, ...simulated };
  // Each line stamped with the time it arrived, so a slow step can be placed (DSP-168).
  docker('exec', '-d', '-u', user, name, 'env', '-i', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), 'bash', '-c', `dspatch --remote-debugging-port=${port} 2>&1 | while IFS= read -r line; do printf '%s %s\n' "$(date +%T.%3N)" "$line"; done >>/tmp/standalone-client.log`);
}
async function quit(name, user, window) {
  const pid = inside(name, user, 'pgrep -o -x dspatch');
  inside(name, user, `kill -TERM ${pid}`);
  await poll(`${name} Electron exits`, () => inside(name, user, 'if pgrep -x dspatch >/dev/null; then echo running; else echo gone; fi') === 'gone', 15_000);
  window.close();
  check('actual Electron client exited', true, `${name} PID ${pid}`);
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function newDebugPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  const { version } = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const deb = path.join(release, `dspatch_${version}_amd64.deb`);
  if (!fs.existsSync(deb)) throw new Error(`PENDING PACKAGE: ${deb} does not exist; stale packages are not used.`);
  check('deb metadata matches package.json', command('dpkg-deb', ['-f', deb, 'Version']) === version, version);
  const manifest = JSON.parse(fs.readFileSync(path.join(release, 'host/host-manifest.json'), 'utf8'));
  check('host manifest version matches package.json', manifest.appVersion === version, manifest.appVersion);
  const linux = manifest.packages.find((entry) => entry.platform === 'linux' && entry.arch === 'x64');
  check('matching Linux host archive is available', Boolean(linux) && linux.file === path.basename(linux.file));
  const archive = path.join(release, 'host', linux.file);
  check('release host archive matches manifest SHA', createHash('sha256').update(fs.readFileSync(archive)).digest('hex') === linux.sha256, linux.sha256);
  identity = { version, deb, debSha256: createHash('sha256').update(fs.readFileSync(deb)).digest('hex'), hostId: manifest.hostId, hostSha256: linux.sha256, simulation: simulated };
  docker('image', 'inspect', 'dspatch-trial');
  for (const port of [WORK_DEBUG, CLIENT_DEBUG, SSH_PORT]) await freePort(port);
  stage = 'install';
  for (const [name, user, display] of [[WORK, 'hostuser', ':98'], [CLIENT, 'tester', ':97']]) {
    docker('run', '-d', '--init', '--pull=never', '--name', name, '--hostname', name === WORK ? 'standalone-work' : 'standalone-client', '--network', 'host', '--shm-size=512m', '--cap-add', 'SYS_ADMIN', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined', 'dspatch-trial', 'sleep', 'infinity');
    owned.push(name);
    docker('cp', deb, `${name}:/tmp/dspatch.deb`);
    inside(name, 'root', 'dpkg -i /tmp/dspatch.deb');
    check('installed current .deb', inside(name, 'root', "dpkg-query -W -f='${Version} ${Status}' dspatch") === `${version} install ok installed`, name);
    check('no external Node or npm installed', inside(name, user, 'if command -v node || command -v npm; then echo found; else echo none; fi') === 'none', name);
    const bundledManifest = inside(name, 'root', "find /opt/DSpatch/resources -name host-manifest.json -type f");
    check('one bundled host manifest', bundledManifest !== '' && !bundledManifest.includes('\n'), bundledManifest);
    const bundled = JSON.parse(inside(name, 'root', `cat ${quote(bundledManifest)}`));
    check('installed host manifest matches release', JSON.stringify(bundled) === JSON.stringify(manifest), name);
    const bundledArchive = `${path.posix.dirname(bundledManifest)}/host-packages/${linux.file}`;
    check('deb contains Linux host archive with matching SHA', inside(name, 'root', `sha256sum ${quote(bundledArchive)}`).split(/\s+/)[0] === linux.sha256, name);
    check('no manually populated host cache', inside(name, user, 'if test -e ~/.config/DSpatch/host-packages; then echo present; else echo absent; fi') === 'absent', name);
    docker('exec', '-d', name, 'Xvfb', display, '-screen', '0', '1280x900x24');
    await poll(`${name} Xvfb`, () => inside(name, user, `if test -S /tmp/.X11-unix/X${display.slice(1)}; then echo ready; fi`));
  }
  stage = 'SSH fixture';
  inside(CLIENT, 'tester', "mkdir -m 700 ~/.ssh; ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/id_ed25519");
  const publicKey = inside(CLIENT, 'tester', 'cat ~/.ssh/id_ed25519.pub');
  inside(WORK, 'hostuser', `mkdir -m 700 ~/.ssh; printf '%s\\n' ${quote(publicKey)} > ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; mkdir ~/proj; cd ~/proj; git init -q; echo fixture > README.md; git add .; git -c user.name=Trial -c user.email=trial@example.invalid commit -qm fixture`);
  const sshConfig = `Host standalone-work\n  HostName 127.0.0.1\n  Port ${SSH_PORT}\n  User hostuser\n  IdentityFile /home/tester/.ssh/id_ed25519\n  IdentitiesOnly yes\n  ConnectTimeout 5\n`;
  inside(CLIENT, 'tester', `printf '%s' ${quote(sshConfig)} > ~/.ssh/config; chmod 600 ~/.ssh/config`);
  const serverConfig = `Port ${SSH_PORT}\nListenAddress 127.0.0.1\nHostKey /etc/ssh/ssh_host_ed25519_key\nPidFile /run/standalone-sshd.pid\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM yes\nAllowUsers hostuser\nSetEnv DSPATCH_CHAT_RUN=review-flow ${Object.entries(simulated).map(([key, value]) => `${key}=${value}`).join(' ')}\n`;
  inside(WORK, 'root', `ssh-keygen -A; printf '%s' ${quote(serverConfig)} > /etc/ssh/standalone-sshd.conf`);
  docker('exec', '-d', WORK, 'env', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', '/usr/sbin/sshd', '-D', '-e', '-f', '/etc/ssh/standalone-sshd.conf', '-E', '/tmp/standalone-sshd.log');
  await poll('real sshd ready', () => inside(WORK, 'root', 'if test -s /run/standalone-sshd.pid; then echo ready; fi'));
  check('system SSH reaches the first fixture', inside(CLIENT, 'tester', 'env -i HOME=/home/tester PATH=/usr/bin:/bin ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new standalone-work hostname').split('\n').includes('standalone-work'));

  stage = 'ordinary local launch';
  const work = new Win(WORK_DEBUG, 'work');
  launch(WORK, 'hostuser', WORK_DEBUG, ':98');
  await work.attach();
  await work.until('ordinary start page', `${q('remote-session')}!==null`);
  const claim = snapshot();
  const pid = claim.pid;
  check('ordinary local window uses one standalone host', sameHost(pid).ok, JSON.stringify(sameHost(pid)));
  check('simulated Copilot choice accepted', await work.ev("window.dspatch.chooseAgent('copilot')") === 'copilot');
  await work.ev("window.dspatch.startChatSession({kind:'folder',path:'/home/hostuser/proj'})");
  await work.reloadProject();
  await work.ev(`window.dspatch.sendPrompt(${JSON.stringify(`[[very-slow]] [[tools]] ${marker}`)})`);
  await work.until('turn running', `${q('turn-activity')}!==null`);
  await work.shot('01-local-running');
  await quit(WORK, 'hostuser', work);
  check('closing local window leaves same host PID', sameHost(pid).ok, JSON.stringify(sameHost(pid)));
  assertOneAttempt();

  stage = 'local reopen';
  work.port = await newDebugPort();
  launch(WORK, 'hostuser', work.port, ':98');
  await work.attach();
  await work.until('reopened start page', `${q('open-project-0')}!==null`);
  await work.click('open-project-0');
  await work.until('saved prompt visible', `document.body.innerText.includes(${JSON.stringify(marker)})`);
  check('reopening local window attaches to the same host', sameHost(pid).ok, JSON.stringify(sameHost(pid)));
  await work.until('work still running after local reopen', `${q('turn-activity')}!==null`);
  assertOneAttempt();
  await work.shot('02-local-reopened');

  stage = 'remote attach during work';
  const client = new Win(CLIENT_DEBUG, 'remote');
  launch(CLIENT, 'tester', CLIENT_DEBUG, ':97');
  await client.attach();
  await client.until('remote start page', `${q('remote-session')}!==null`);
  const connection = await client.connect();
  check('Remote Session attaches without handover refusal', !connection.seen.some((text) => /busy|hand.?over|Installing host|Downloading/i.test(text)), JSON.stringify(connection));
  check('SSH and local use share exactly the same host PID', sameHost(pid).ok, JSON.stringify(sameHost(pid)));
  await client.reloadProject();
  await client.until('same saved prompt remotely', `document.body.innerText.includes(${JSON.stringify(marker)})`);
  await client.until('running work follows remotely', `${q('turn-activity')}!==null`);
  assertOneAttempt();
  await client.shot('03-remote-running');
  await quit(WORK, 'hostuser', work);
  await quit(CLIENT, 'tester', client);
  check('closing remote client leaves same host running', sameHost(pid).ok, JSON.stringify(sameHost(pid)));

  stage = 'completion without client';
  await poll('started work completes without attached client', () => {
    const attempts = conversations().flatMap((conversation) => conversation.attempts);
    if (attempts.some((attempt) => ['failed', 'outcome-unknown', 'stopped-confirmed'].includes(attempt.state))) throw new Error(`Work did not complete: ${JSON.stringify(attempts)}`);
    return attempts.length === 1 && attempts[0].state === 'completed';
  }, 180_000);
  check('work completed successfully without attached client', assertOneAttempt().state === 'completed');
  check('host still owns the data after work finishes', sameHost(pid).ok, JSON.stringify(sameHost(pid)));
  work.port = await newDebugPort();
  launch(WORK, 'hostuser', work.port, ':98');
  await work.attach();
  await work.until('final recent project', `${q('open-project-0')}!==null`);
  await work.click('open-project-0');
  await work.until('finished history visible', `document.body.innerText.includes(${JSON.stringify(marker)}) && ${q('turn-activity')}===null`);
  await work.shot('04-local-finished-history');
  check('finished history survives remote close and local reopen', sameHost(pid).ok);
  assertOneAttempt();

  stage = 'credential and download evidence';
  const credentials = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (/token/i.test(key) && typeof nested === 'string' && nested.length >= 16) credentials.add(nested);
      else visit(nested);
    }
  };
  let output = await work.ev('document.body.innerText');
  for (const [name, user] of [[WORK, 'hostuser'], [CLIENT, 'tester']]) {
    const files = inside(name, user, "find ~/.config/DSpatch -maxdepth 2 -type f \\( -name '*.json' -o -iname '*token*' \\)").split('\n').filter(Boolean);
    for (const file of files) {
      const text = inside(name, user, `cat ${quote(file)}`);
      try { visit(JSON.parse(text)); } catch {
        if (/token/i.test(file) && text.length >= 16) credentials.add(text);
      }
    }
    output += inside(name, user, 'cat /tmp/standalone-client.log ~/.config/DSpatch/host.log 2>/dev/null; true');
  }
  output += inside(WORK, 'root', 'cat /tmp/standalone-sshd.log');
  check('both fixture host tokens available for leak comparison', credentials.size >= 2, `distinct credentials: ${credentials.size}`);
  check('neither host token printed in captured logs or final UI', [...credentials].every((token) => !output.includes(token)));
  check('no GitHub host download recorded', !/https?:\/\/[^\s]*github[^\s]*|Downloading host|Installing host/i.test(output));
}

fs.mkdirSync(evidence, { recursive: true });
try {
  await main();
} catch (error) {
  results.push({ stage, what: 'trial completed', ok: false, detail: error.stack ?? String(error) });
  console.error(`FAIL ${stage}: ${error.stack ?? error}`);
  for (const window of windows) await window.shot(`failure-${window.label}`).catch(() => undefined);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  for (const window of windows) window.close();
  for (const name of owned) {
    const user = name === WORK ? 'hostuser' : 'tester';
    const logs = command('docker', ['exec', '-u', user, name, 'bash', '-c', 'cat /tmp/standalone-client.log ~/.config/DSpatch/host.log 2>/dev/null; true'], true);
    fs.writeFileSync(path.join(evidence, `${name === WORK ? 'work' : 'client'}.log`), logs);
    if (name === WORK) fs.writeFileSync(path.join(evidence, 'sshd.log'), command('docker', ['exec', name, 'cat', '/tmp/standalone-sshd.log'], true));
    const removed = command('docker', ['rm', '-f', name], true);
    const ok = removed === name;
    results.push({ stage: 'cleanup', what: 'own container removed', ok, detail: name });
    if (!ok) process.exitCode = 1;
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ startedWith: identity, finishedAt: new Date().toISOString(), results }, null, 2));
  console.log(`${results.filter((result) => !result.ok).length ? 'FAILED' : 'ALL PASSED'}: ${results.length} checks; evidence ${evidence}`);
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
}