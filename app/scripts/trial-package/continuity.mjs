// @ts-nocheck: a trial script over untyped DevTools answers.
/**
 * One work context, local and remote (DSP-161, DSP-159): the real .deb on a "work computer" and a
 * "laptop" container, the real host package, real sshd, real windows on Xvfb. The provider is
 * SIMULATED on both sides; no model and no account is reached. The two containers share the
 * loopback network, so ssh reaches the work computer through an alias with its own Port.
 *
 *     node scripts/trial-package/continuity.mjs [--older-host <tar.gz of an earlier host package>]
 *
 * Needs the same packages as run.mjs. Touches nothing of this machine's profile or ssh settings.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const evidence = path.join(appDir, 'release', 'trial-continuity');
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const olderAt = process.argv.indexOf('--older-host');
const olderPackage = olderAt < 0 ? null : process.argv[olderAt + 1];
const WORK = 'dspatch-cont-work';
const LAPTOP = 'dspatch-cont-laptop';
const WORK_DEBUG = 9371;
const LAPTOP_DEBUG = 9372;
const SSH_PORT = 2292;
const SIMULATED = { DSPATCH_PRESENTATION_MODELS: 'copilot', DSPATCH_PRESENTATION_LIST_MS: '50', DSPATCH_PRESENTATION_TOOL_MS: '400', DSPATCH_PRESENTATION_DELTA_MS: '120', DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1048576 });
const inC = (name, user, script) => {
  const result = docker('exec', '-u', user, name, 'bash', '-c', script);
  return (result.stdout + result.stderr).trim();
};
const results = [];
function check(what, ok, detail = '') {
  results.push({ what, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 300)}`}\n`);
}
const q = (name) => `document.querySelector('[data-ev="${name}"]')`;

class Win {
  constructor(port, label) {
    this.port = port;
    this.label = label;
    this.id = 0;
    this.pending = new Map();
  }

  async attach() {
    for (let i = 0; i < 80; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${String(this.port)}/json/list`)).json();
        const page = list.find((target) => target.type === 'page' && !target.url.includes('window='));
        if (page !== undefined) {
          this.ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
          });
          this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.pending.get(data.id)?.(data);
            this.pending.delete(data.id);
          };
          return;
        }
      } catch {
        // Not up yet.
      }
      await sleep(500);
    }
    throw new Error(`no window on ${this.label}`);
  }

  cmd(method, params = {}) {
    return new Promise((resolve) => {
      this.id += 1;
      this.pending.set(this.id, resolve);
      this.ws.send(JSON.stringify({ id: this.id, method, params }));
    });
  }

  async ev(expression) {
    return (await this.cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  }

  async shot(name) {
    const data = await this.cmd('Page.captureScreenshot', { format: 'png' });
    if (data.result?.data !== undefined) {
      fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(data.result.data, 'base64'));
    }
  }

  async until(what, expression, ms = 30_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const value = await this.ev(expression);
        if (value) {
          return value;
        }
      } catch {
        await sleep(300);
        await this.attach().catch(() => undefined);
      }
      await sleep(150);
    }
    await this.shot(`timeout-${this.label}-${what.replace(/\W+/g, '-')}`);
    throw new Error(`timeout on ${this.label}: ${what}; window says: ${String(await this.ev('document.body.innerText')).slice(0, 400)}`);
  }

  async click(name) {
    await this.until(`the ${name} control`, `${q(name)}!==null && !${q(name)}.disabled`);
    const box = JSON.parse(await this.ev(`(${q(name)}.scrollIntoView({block:'center'}),JSON.stringify(${q(name)}.getBoundingClientRect()))`));
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.cmd('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
    }
  }

  async type(name, text) {
    await this.click(name);
    await this.ev(`${q(name)}.select?.()`);
    await this.cmd('Input.insertText', { text });
  }

  async enter() {
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }

  line() {
    return this.ev(`${q('host-link')}?.textContent ?? ''`).catch(() => '');
  }

  text() {
    return this.ev('document.body.innerText').catch(() => '');
  }

  /** Connect to a target, answering every question yes unless `answers` says otherwise. */
  async connect(target, { answers = () => 'yes', ms = 180_000 } = {}) {
    await this.ev(`${q('remote-form')}===null && ${q('remote-session')}?.click()`);
    await this.until('the form', `${q('ssh-target')}!==null`);
    await this.type('ssh-target', target);
    await this.click('ssh-connect');
    const seen = [];
    const asked = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      let state;
      try {
        state = JSON.parse(
          await this.ev(`JSON.stringify({ status: ${q('ssh-status')}?.textContent ?? null, kind: ${q('ssh-question')}?.dataset.kind ?? null, text: document.querySelector('.ssh-question__text')?.textContent ?? '', on: ${q('host-link')}?.textContent ?? '', busy: ${q('ssh-connect')}?.disabled ?? null })`),
        );
      } catch {
        await sleep(300);
        await this.attach().catch(() => undefined);
        continue;
      }
      if (state.status !== null && seen.at(-1) !== state.status) {
        seen.push(state.status);
      }
      if (state.kind !== null) {
        asked.push(state.text);
        await this.click(answers(state.text) === 'yes' ? 'ssh-yes' : 'ssh-no');
        await sleep(300);
        continue;
      }
      if (/^On /.test(state.on)) {
        return { connected: true, seen, asked };
      }
      if (state.busy === false && seen.length > 1) {
        return { connected: false, seen, asked };
      }
      await sleep(120);
    }
    return { connected: false, seen, asked, timedOut: true };
  }

  async chooseAgent(agent) {
    await this.ev(`(()=>{const s=${q('open-agent-select')};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'${agent}');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await sleep(800);
  }

  async openProject() {
    await this.click('open-project-0');
    await this.until('the chat', `${q('prompt')}!==null`);
  }

  async send(text) {
    await this.type('prompt', text);
    await this.enter();
  }
}

const hostPids = () => inC(WORK, 'hostuser', "pgrep -f '[d]ist/host/remote-host.js' | tr '\\n' ' '").trim();
const data = '~/.config/DSpatch';
const claim = () => inC(WORK, 'hostuser', `cat ${data}/host-claim.json 2>/dev/null | tr -d '\\n '`);
const startDesktop = async (name, user, port, env = {}) => {
  const environment = Object.entries({ DISPLAY: name === WORK ? ':98' : ':97', DSPATCH_TRIAL_HOST_RUN: 'review-flow', ...SIMULATED, ...env }).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  docker('exec', '-d', '-u', user, ...environment, name, 'bash', '-c', `exec dspatch --remote-debugging-port=${String(port)} >>/tmp/client-${user}.log 2>&1`);
};
const stopDesktop = (name) => {
  inC(name, 'root', 'pkill -TERM -o -x dspatch; sleep 3; pgrep -x dspatch >/dev/null && pkill -KILL -x dspatch; true');
};

async function aliases(laptop) {
  const resolved = inC(LAPTOP, 'tester', 'ssh -G workalias | grep -E "^(user|hostname|port) "').replace(/\n/g, ' ');
  check('ssh itself resolves the alias to User, HostName and Port', resolved.includes('user hostuser') && resolved.includes('hostname 127.0.0.1') && resolved.includes(`port ${String(SSH_PORT)}`), resolved);
  const terminal = inC(LAPTOP, 'tester', 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ClearAllForwardings=yes workalias hostname');
  check('a terminal reaches the machine through the alias', terminal.endsWith(inC(WORK, 'root', 'hostname')), terminal);
  const wrong = await laptop.connect('wrongalias');
  const words = wrong.seen.at(-1) ?? '';
  check('an alias with the wrong user is refused, and the words show where it went', !wrong.connected && /refused the sign-in/.test(words) && /as nobodyhere on 127\.0\.0\.1, port 2292/.test(words), words);
  const fromTerminal = inC(LAPTOP, 'tester', 'ssh -o BatchMode=yes wrongalias true');
  check('a terminal is refused the same way', /Permission denied/.test(fromTerminal), fromTerminal);
  const asUser = await laptop.connect('hostuser@workalias', { answers: (text) => (/DSpatch is open/.test(text) ? 'no' : 'yes') });
  check('user@alias overrides a block written for a terminal: LocalForward on a taken port, ControlPersist', asUser.connected, asUser.seen.join(' > '));
  await laptop.click('host-link-leave');
  await laptop.until('this computer again', `${q('host-link')}===null`);
  const commanded = await laptop.connect('commandalias');
  check('an alias with a RemoteCommand connects too', commanded.connected, commanded.seen.join(' > '));
  await laptop.click('host-link-leave');
  await laptop.until('this computer again', `${q('host-link')}===null`);
  inC(WORK, 'hostuser', "pkill -TERM -f '[d]ist/host/remote-host.js'; sleep 2; true");
}

async function localFirst(work, laptop) {
  inC(WORK, 'hostuser', 'mkdir -p ~/proj && cd ~/proj && git init -q . && echo hello > README.md && git -c user.name=t -c user.email=t@t add . && git -c user.name=t -c user.email=t@t commit -qm one');
  await startDesktop(WORK, 'hostuser', WORK_DEBUG);
  await work.attach();
  await work.until('the start page', `${q('remote-session')}!==null`);
  check('a local install runs with no remote setup: its own host, in its own folder', /"kind":"desktop"/.test(claim()) && hostPids() === '', claim());
  await work.chooseAgent('copilot');
  await work.ev(`window.dspatch.startChatSession({ kind: 'folder', path: '/home/hostuser/proj' })`);
  await work.ev('location.reload()');
  await sleep(1500);
  await work.attach();
  await work.openProject();
  await work.send('LOCAL-FIRST-MARK saved before any remote use.');
  await work.until('the reply', `document.body.innerText.includes('LOCAL-FIRST-MARK') && ${q('turn-activity')}===null`, 60_000);
  check('local work is saved in the shared folder', Number(inC(WORK, 'hostuser', `grep -l LOCAL-FIRST-MARK ${data}/conversations/*.json | wc -l`)) === 1);

  // A running turn holds the machine for the window it runs in.
  await work.send('[[very-slow]] [[tools]] LOCAL-RUNNING-MARK');
  await work.until('work running', `${q('turn-activity')}!==null`);
  const busy = await laptop.connect('workalias');
  check('connecting while work runs in the open window changes nothing, and says so', !busy.connected && /busy/.test(busy.seen.at(-1) ?? '') && /agent turn/i.test(busy.seen.at(-1) ?? ''), busy.seen.at(-1));
  check('the question was asked first', busy.asked.some((text) => /DSpatch is open on workalias/.test(text)), busy.asked.join(' | '));
  check('no second host was started over the same data', hostPids() === '', hostPids());
  await work.until('the turn ended', `${q('turn-activity')}===null`, 120_000);
  check('that turn ended undisturbed', (await work.text()).includes('LOCAL-RUNNING-MARK'));
}

async function handOver(work, laptop) {
  const moved = await laptop.connect('workalias');
  check('with nothing running the open window hands over', moved.connected, moved.seen.join(' > '));
  await laptop.shot('10-laptop-connected');
  await work.until('the window says where the work went', `${q('host-link-use-here')}!==null`, 20_000);
  await work.shot('11-work-handed-over');
  check('the work computer says so, and how to come back', /In use from another computer/.test(await work.line()), await work.line());
  check('one host over the data, and it is the standalone one', hostPids().split(' ').length === 1 && /"kind":"standalone"/.test(claim()), `${hostPids()} ${claim()}`);
  await laptop.ev('location.reload()');
  await sleep(1500);
  await laptop.attach();
  await laptop.until('the recent project', `document.body.innerText.includes('proj')`);
  check('the project is in Recent on the laptop: no empty environment', true);
  await laptop.openProject();
  await laptop.until('the saved conversation', `document.body.innerText.includes('LOCAL-FIRST-MARK')`);
  check('the conversation from local work reads on the laptop', true);
  const before = Number(inC(WORK, 'hostuser', `grep -c LOCAL-FIRST-MARK ${data}/conversations/*.json | head -1 | cut -d: -f2`));
  await laptop.send('[[very-slow]] [[tools]] REMOTE-RUNNING-MARK');
  await laptop.until('work running', `${q('turn-activity')}!==null`);
  check('reopening sent nothing again', before === Number(inC(WORK, 'hostuser', `grep -c LOCAL-FIRST-MARK ${data}/conversations/*.json | head -1 | cut -d: -f2`)));
}

async function backHere(work, laptop) {
  await work.click('host-link-use-here');
  await work.until('this computer attached', `/On this computer/.test(${q('host-link')}?.textContent ?? '')`, 30_000);
  await work.shot('12-work-attached');
  await laptop.until('the laptop is told', `/Another client connected/.test(${q('host-link')}?.textContent ?? '')`, 20_000);
  await laptop.shot('13-laptop-replaced');
  check('the laptop is told another client took over', true);
  check('still one host, and running work carried on in it', hostPids().split(' ').length === 1, hostPids());
  await work.openProject();
  await work.until('the running turn, seen here', `document.body.innerText.includes('REMOTE-RUNNING-MARK')`);
  await work.until('the running turn followed here', `${q('turn-activity')}!==null`);
  await work.shot('14-work-follows-running-turn');
  const state = JSON.parse(await work.ev(`window.dspatch.getRunState().then(JSON.stringify)`));
  check('the job is known as running, not unknown and not started again', !state.unresolved.some((one) => one.state === 'outcome-unknown'), JSON.stringify(state.unresolved.map((one) => one.state)));
  await work.until('the job finished', `window.dspatch.getRunState().then((s) => s.unresolved.length === 0)`, 180_000);
  const conversation = JSON.parse(inC(WORK, 'hostuser', `cat ${data}/conversations/*.json`));
  const sent = conversation.messages.filter((one) => one.role === 'user' && JSON.stringify(one).includes('REMOTE-RUNNING-MARK'));
  check('the job was sent once, and ended once', sent.length === 1, `${String(sent.length)} message(s)`);
}

async function laptopReturns(work, laptop) {
  await laptop.click('host-link-leave');
  await laptop.until('this computer again', `${q('host-link')}===null`);
  const again = await laptop.connect('workalias');
  check('the laptop connects again to the host that stayed', again.connected && !again.seen.some((s) => /Installing/.test(s)), again.seen.join(' > '));
  await work.until('the work computer is told', `/Another client connected/.test(${q('host-link')}?.textContent ?? '')`, 20_000);
  await laptop.click('host-link-leave');
  await laptop.until('this computer again', `${q('host-link')}===null`);
  stopDesktop(WORK);
  check('closing the window leaves the host running', hostPids() !== '', hostPids());
  await startDesktop(WORK, 'hostuser', WORK_DEBUG);
  await work.attach();
  await work.until('attached at the start', `/On this computer/.test(${q('host-link')}?.textContent ?? '')`, 30_000);
  check('a new launch attaches to the host instead of starting one', hostPids().split(' ').length === 1);
  await work.click('host-link-leave');
  await work.until('its own host again', `${q('host-link')}===null`, 30_000);
  await sleep(1000);
  check('End host returns to the window’s own host, on the same data', /"kind":"desktop"/.test(claim()) && hostPids() === '', claim());
  await work.ev('location.reload()');
  await sleep(1500);
  await work.attach();
  await work.openProject();
  await work.until('all of it', `document.body.innerText.includes('LOCAL-FIRST-MARK')`);
  check('local → remote → local: the conversation is the same one', Number(inC(WORK, 'hostuser', `ls ${data}/conversations | wc -l`)) === 1, inC(WORK, 'hostuser', `ls ${data}/conversations`));
  stopDesktop(WORK);
}

/** Remote first with a real earlier host still running over its older folder, then local. */
async function olderFolder(laptop, olderTar) {
  const older = '~/.local/share/dspatch-host';
  docker('cp', olderTar, `${WORK}:/tmp/older-host.tar.gz`);
  inC(WORK, 'root', 'chmod 644 /tmp/older-host.tar.gz');
  inC(WORK, 'tester', `mkdir -p ~/old ~/.config/DSpatch/conversations ${older}/conversations ${older}/reviews/pairs && tar -xzf /tmp/older-host.tar.gz -C ~/old
echo '{"conversationId":"dsp-conv-older-1","formatVersion":2,"createdAtUtc":"2026-01-01T00:00:00.000Z","savedAtUtc":"2026-01-01T00:00:00.000Z","project":{"path":"/nowhere"},"session":{},"messages":[],"attempts":[],"testRuns":[]}' > ${older}/conversations/dsp-conv-older-1.json
echo '{"conversationId":"dsp-conv-both","marker":"older"}' > ${older}/conversations/dsp-conv-both.json
echo '{"conversationId":"dsp-conv-both","marker":"local"}' > ~/.config/DSpatch/conversations/dsp-conv-both.json
echo '{"decision":"approved"}' > ${older}/reviews/pairs/old-pair.json`);
  docker('exec', '-d', '-u', 'tester', WORK, 'bash', '-c', `exec ~/old/dspatch-host/dspatch-host --port 0 --data ${older} >/tmp/older.log 2>&1`);
  await sleep(3000);
  check('an earlier host really runs over the older folder', inC(WORK, 'tester', `test -f ${older}/host-running.json && echo yes`) === 'yes', inC(WORK, 'tester', 'tail -2 /tmp/older.log'));
  const moved = await laptop.connect('tester@workalias');
  check('the older host is found, and replacing it is asked', moved.asked.some((text) => /Replace it/.test(text)), moved.asked.join(' | '));
  check('the connection then goes through', moved.connected, moved.seen.join(' > '));
  const here = '~/.config/DSpatch';
  check('what was only in the older folder arrives', inC(WORK, 'tester', `test -f ${here}/conversations/dsp-conv-older-1.json && test -f ${here}/reviews/pairs/old-pair.json && echo yes`) === 'yes');
  check('a conflict overwrites nothing: both remain', /local/.test(inC(WORK, 'tester', `cat ${here}/conversations/dsp-conv-both.json`)) && /older/.test(inC(WORK, 'tester', `cat ${here}/conversations/dsp-conv-both-from-older-host.json`)));
  check('both sides were backed up first', inC(WORK, 'tester', `ls ${here}/backups/*/older-host/conversations/dsp-conv-both.json ${here}/backups/*/shared-folder/conversations/dsp-conv-both.json | wc -l`) === '2');
  check('the older folder is left in place', inC(WORK, 'tester', `test -f ${older}/conversations/dsp-conv-both.json && test -f ${older}/adopted-into.json && echo yes`) === 'yes');
  await laptop.click('host-link-leave');
  await laptop.until('this computer again', `${q('host-link')}===null`);
}

/** A saved manual tunnel whose host is gone. Its dialog is native, so keys answer it. */
async function oldTunnel(laptop) {
  stopDesktop(LAPTOP);
  inC(LAPTOP, 'tester', `printf '{"active":true,"address":"127.0.0.1:47999","token":"old"}' > ~/.config/DSpatch/remote-session.json`);
  await startDesktop(LAPTOP, 'tester', LAPTOP_DEBUG);
  await sleep(9000);
  inC(LAPTOP, 'tester', 'DISPLAY=:97 import -window root /tmp/old-tunnel.png 2>/dev/null; true');
  docker('cp', `${LAPTOP}:/tmp/old-tunnel.png`, path.join(evidence, '20-old-tunnel-dialog.png'));
  inC(LAPTOP, 'tester', 'DISPLAY=:97 xdotool key Return');
  await laptop.attach();
  await laptop.until('the SSH form opens by itself', `${q('ssh-target')}!==null`, 30_000);
  await laptop.shot('21-after-old-tunnel');
  check('a saved tunnel that is gone leads to the SSH form', true);
  check('the saved session is ended, and only that', inC(LAPTOP, 'tester', 'ls ~/.config/DSpatch/remote-session.json 2>&1 | grep -c "No such"') === '1');
}

async function main() {
  const release = path.join(appDir, 'release');
  const { version } = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const deb = `dspatch_${version}_amd64.deb`;
  const manifest = JSON.parse(fs.readFileSync(path.join(release, 'host', 'host-manifest.json'), 'utf8'));
  const linux = manifest.packages.find((entry) => entry.platform === 'linux');
  for (const name of [WORK, LAPTOP]) {
    docker('rm', '-f', name);
    docker('run', '-d', '--name', name, '--hostname', name === WORK ? 'workcomputer' : 'laptop', '--network', 'host', '--shm-size=512m', '--cap-add', 'SYS_ADMIN', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined', 'dspatch-trial', 'sleep', 'infinity');
    docker('cp', path.join(release, deb), `${name}:/tmp/dspatch.deb`);
    inC(name, 'root', 'dpkg -i /tmp/dspatch.deb 2>&1 | tail -1; apt-get install -y --no-install-recommends xdotool imagemagick python3-minimal >/dev/null 2>&1');
    docker('exec', '-d', name, 'Xvfb', name === WORK ? ':98' : ':97', '-screen', '0', '1280x900x24');
  }
  await sleep(1000);
  inC(
    WORK,
    'root',
    `cat >> /etc/ssh/sshd_config <<'S'
Port ${String(SSH_PORT)}
ListenAddress 127.0.0.1
PasswordAuthentication no
SetEnv DSPATCH_CHAT_RUN=review-flow ${Object.entries(SIMULATED).map(([key, value]) => `${key}=${value}`).join(' ')}
S
/usr/sbin/sshd`,
  );
  inC(LAPTOP, 'tester', `mkdir -p ~/.ssh ~/.config/DSpatch/host-packages && chmod 700 ~/.ssh && ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/id_ed25519
cat > ~/.ssh/config <<'S'
Host workalias
  HostName 127.0.0.1
  Port ${String(SSH_PORT)}
  User hostuser
  LocalForward 127.0.0.1:47917 127.0.0.1:47917
  ControlPersist 10m
Host commandalias
  HostName 127.0.0.1
  Port ${String(SSH_PORT)}
  User hostuser
  RemoteCommand tmux attach
Host wrongalias
  HostName 127.0.0.1
  Port ${String(SSH_PORT)}
  User nobodyhere
S`);
  const key = inC(LAPTOP, 'tester', 'cat ~/.ssh/id_ed25519.pub');
  for (const user of ['hostuser', 'tester']) {
    inC(WORK, user, `mkdir -p ~/.ssh ~/.config && chmod 700 ~/.ssh && echo '${key}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
  }
  docker('cp', path.join(release, 'host', linux.file), `${LAPTOP}:/home/tester/.config/DSpatch/host-packages/${linux.file}`);
  inC(LAPTOP, 'root', 'chown -R tester /home/tester/.config');
  // Port 47917 is taken on this machine, as an old tunnel would have it.
  inC(LAPTOP, 'tester', 'nohup python3 -m http.server 47917 --bind 127.0.0.1 >/dev/null 2>&1 &');
  await sleep(500);

  await startDesktop(LAPTOP, 'tester', LAPTOP_DEBUG);
  const laptop = new Win(LAPTOP_DEBUG, 'laptop');
  await laptop.attach();
  await laptop.until('the start page', `${q('remote-session')}!==null`);
  const work = new Win(WORK_DEBUG, 'work');
  const parts = [
    ['aliases', () => aliases(laptop)],
    ['local first', () => localFirst(work, laptop)],
    ['hand over', () => handOver(work, laptop)],
    ['back here', () => backHere(work, laptop)],
    ['laptop returns', () => laptopReturns(work, laptop)],
    ...(olderPackage === null ? [] : [['older folder', () => olderFolder(laptop, olderPackage)]]),
    ['old tunnel', () => oldTunnel(laptop)],
  ];
  for (const [name, part] of parts) {
    try {
      await part();
    } catch (error) {
      check(`the part "${name}" finished`, false, error.message);
      break;
    }
  }
  for (const [name, user] of [[WORK, 'hostuser'], [LAPTOP, 'tester']]) {
    fs.writeFileSync(path.join(evidence, `${name}.log`), inC(name, user, `cat /tmp/client-${user}.log ~/.config/DSpatch/host.log 2>/dev/null`));
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  for (const name of [WORK, LAPTOP]) {
    docker('rm', '-f', name);
  }
  const failed = results.filter((one) => !one.ok);
  process.stdout.write(`${failed.length === 0 ? 'ALL PASSED' : `${String(failed.length)} FAILED`} of ${String(results.length)}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
