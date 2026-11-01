// @ts-nocheck: a trial script.
/**
 * The setup trial (DSP-155): the real .deb in a clean container with no Node, no npm and no
 * sources, a real window on Xvfb, the real packages fetched from the npm registry, the real
 * `claude` and `copilot` programs, and over real ssh the real host package.
 *
 * Every Anthropic, GitHub and Cursor name resolves to a stand-in inside the container, which logs
 * each request by host: no model, no account and no Cursor service can be reached, and a request
 * for Cursor would show in that log. The login is synthetic and the profile is the container's.
 *
 *     docker build -t dspatch-trial -f scripts/trial-package/Dockerfile scripts/trial-package
 *     node scripts/trial-package/setup.mjs [<evidence folder>]
 *
 * Needs `npm run package:host -- --platform linux` and `npm run package:client -- --linux deb
 * --x64` first. Touches nothing of the machine it runs on.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial-setup'));
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const CLIENT = 'dspatch-setup-client';
const HOST = 'dspatch-setup-host';
const NET = 'dspatch-setup-net';
const DEBUG = 9361;
const PASSWORD = 'trial-password';
const NAMES = 'api.anthropic.com claude.com claude.ai platform.claude.com console.anthropic.com statsig.anthropic.com github.com api.github.com copilot-proxy.githubusercontent.com api.githubcopilot.com api.individual.githubcopilot.com cursor.com www.cursor.com api.cursor.com api2.cursor.sh';
const CLAUDE_DATA = '~/.config/DSpatch/provider-support/claude';
const WINDOW_ENV = ['-e', 'NODE_EXTRA_CA_CERTS=/tmp/standin/cert.pem', '-e', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1048576 });
function inC(name, user, script) {
  const result = docker('exec', '-u', user, name, 'bash', '-c', script);
  return (result.stdout + result.stderr).trim();
}
const results = [];
function check(what, ok, detail = '') {
  results.push({ what, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 260)}`}\n`);
}

let ws;
let id = 0;
const pending = new Map();
async function attach() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(DEBUG)}/json/list`)).json();
      const page = list.find((target) => target.type === 'page' && !target.url.includes('window='));
      if (page !== undefined) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          pending.get(data.id)?.(data);
          pending.delete(data.id);
        };
        return;
      }
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  throw new Error('no window');
}
const cmd = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => (await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const q = (name) => `document.querySelector('[data-ev="${name}"]')`;
async function shot(name) {
  const data = await cmd('Page.captureScreenshot', { format: 'png' });
  if (data.result?.data !== undefined) {
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(data.result.data, 'base64'));
  }
}
const pageText = () => ev('document.body.innerText');
async function until(what, expression, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await ev(expression);
      if (value) {
        return value;
      }
    } catch {
      await sleep(300);
      await attach().catch(() => undefined);
    }
    await sleep(100);
  }
  await shot(`timeout-${what.replace(/\W+/g, '-')}`);
  throw new Error(`timeout: ${what}; window says: ${String(await pageText()).slice(0, 400)}`);
}
async function click(name) {
  await until(`the ${name} control`, `${q(name)}!==null && !${q(name)}.disabled`);
  const box = JSON.parse(await ev(`(${q(name)}.scrollIntoView({block:'center'}),JSON.stringify(${q(name)}.getBoundingClientRect()))`));
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cmd('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }
}
async function typeInto(selector, text) {
  await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await ev(`document.querySelector(${JSON.stringify(selector)}).select?.()`);
  await cmd('Input.insertText', { text });
}
const choose = (select, value) =>
  ev(`(()=>{const s=${q(select)};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'${value}');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const standInLog = (name = CLIENT) => inC(name, 'root', 'cat /tmp/standin/log');
/** What a person reads: the agent list's options are always there and are not a message. */
const readable = () => ev(`(()=>{const c=document.body.cloneNode(true);c.querySelectorAll('select').forEach((n)=>n.remove());return c.innerText})()`);
const clean = (text) => ['npm ', 'Cursor', 'no text in this turn', 'put back', 'zod', 'claude:install', 'node_modules', 'Technical detail', 're-read'].filter((word) => text.includes(word));

const startClient = async () => {
  docker('exec', '-d', '-u', 'tester', '-e', 'DISPLAY=:99', ...WINDOW_ENV, CLIENT, 'bash', '-c', `exec dspatch --remote-debugging-port=${String(DEBUG)} >>/tmp/client.log 2>&1`);
  await attach();
  // The start page, or the last conversation, which a restart reopens.
  await until('the window', `${q('remote-session')}!==null || ${q('agent-select')}!==null`);
};
const stopClient = async () => {
  // The stand-in runs on the same program, so it is spared by its script's name.
  inC(CLIENT, 'root', `for signal in TERM KILL; do for p in $(pgrep -x dspatch); do grep -q stand-in /proc/$p/cmdline || kill -$signal $p; done; sleep 1; done; true`);
  await sleep(800);
};

function standIn(name, node) {
  docker('cp', path.join(evidence, 'standin'), `${name}:/tmp/standin`);
  docker('cp', path.join(appDir, 'scripts', 'trial-package', 'claude-stand-in.mjs'), `${name}:/tmp/standin/stand-in.mjs`);
  inC(name, 'root', `chmod -R a+rX /tmp/standin; for n in ${NAMES}; do echo "127.0.0.1 $n" >> /etc/hosts; done`);
  docker('exec', '-d', '-e', 'ELECTRON_RUN_AS_NODE=1', name, 'bash', '-c', `exec ${node} /tmp/standin/stand-in.mjs /tmp/standin/key.pem /tmp/standin/cert.pem /tmp/standin/log`);
}

/** Go through the sign-in the Claude program offers, by the same paste a person would do. */
async function claudeSignIn(where) {
  await until('the sign-in page button', `${q('provider-open')}!==null`, 240_000);
  await until('the code field', `${q('provider-input')}!==null`);
  await shot(`${where}-claude-sign-in`);
  const url = await ev(`window.__lastUrl ?? ''`);
  return url;
}

async function main() {
  const deb = fs.readdirSync(path.join(appDir, 'release')).find((file) => file.endsWith('.deb'));
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'release', 'host', 'host-manifest.json'), 'utf8'));
  const linux = manifest.packages.find((entry) => entry.platform === 'linux');
  const certs = path.join(evidence, 'standin');
  fs.mkdirSync(certs);
  spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem'), '-days', '2', '-subj', '/CN=stand-in', '-addext', `subjectAltName=${NAMES.split(' ').map((name) => `DNS:${name}`).join(',')}`]);
  for (const name of [CLIENT, HOST]) {
    docker('rm', '-f', name);
  }
  docker('network', 'rm', NET);
  docker('network', 'create', NET);
  docker('run', '-d', '--init', '--name', HOST, '--hostname', 'trialhost', '--network', NET, 'dspatch-trial', 'sleep', 'infinity');
  docker('run', '-d', '--name', CLIENT, '--network', 'host', '--shm-size=512m', '--cap-add', 'SYS_ADMIN', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined', 'dspatch-trial', 'sleep', 'infinity');
  docker('cp', path.join(appDir, 'release', deb), `${CLIENT}:/tmp/dspatch.deb`);
  const installed = inC(CLIENT, 'root', 'dpkg -i /tmp/dspatch.deb 2>&1 | tail -1; dpkg -s dspatch | grep ^Status');
  check('the .deb installs', installed.includes('install ok installed'), installed);
  check('no Node or npm on the client', inC(CLIENT, 'tester', 'command -v node npm || echo none') === 'none');
  standIn(CLIENT, '/opt/DSpatch/dspatch');
  docker('exec', '-d', CLIENT, 'Xvfb', ':99', '-screen', '0', '1280x900x24');
  await sleep(1000);
  inC(CLIENT, 'tester', 'mkdir -p ~/.config/DSpatch ~/.claude && rm -rf ~/.claude');
  await startClient();
  await ev(`(()=>{const o=window.dspatchSetup.openLink;window.__links=[];const on=window.dspatchSetup.onProviderStep;on(({step})=>{if(step.kind==='open-url'){window.__lastUrl=step.url}})})()`);

  // --- First use, with a draft in the box ------------------------------------------------------
  await shot('01-start-page');
  const start = await pageText();
  check('the start page has no setup text', !/subscription|API key|Install Claude|terms apply/i.test(start), start.slice(0, 200));
  await typeInto('textarea', 'my draft question');
  await choose('open-agent-select', 'claude');
  await until('the dialog', `${q('provider-continue')}!==null`, 30_000);
  await shot('02-claude-dialog');
  const intro = await ev(`${q('provider-setup')}.innerText`);
  check('the dialog says what happens, with the consent once', /Get started with Claude/.test(intro) && (intro.match(/terms apply/g) ?? []).length === 1, intro);
  await click('provider-cancel');
  await until('the dialog gone', `${q('provider-setup')}===null`);
  check('Cancel keeps the draft and the earlier choice', (await ev(`document.querySelector('textarea').value`)) === 'my draft question' && (await ev(`${q('open-agent-select')}.value`)) !== 'claude');

  // --- A failed download, then a cancelled one, then a whole one -------------------------------
  inC(CLIENT, 'root', 'cp /etc/hosts /tmp/hosts.good; echo "127.0.0.1 registry.npmjs.org" >> /etc/hosts');
  await choose('open-agent-select', 'claude');
  await click('provider-continue');
  await until('the failure', `${q('provider-problem')}!==null`, 60_000);
  await shot('03-download-failed');
  const failed = await ev(`${q('provider-problem')}.innerText`);
  check('a failed download reads as one sentence about the network', /could not be reached/.test(failed) && !/Error|ECONN|registry/.test(failed), failed);
  inC(CLIENT, 'root', 'cat /tmp/hosts.good > /etc/hosts');
  await click('provider-continue');
  await until('progress', `${q('provider-progress')}!==null`, 60_000);
  await shot('04-preparing');
  check('a short status while working', /Preparing Claude/.test(await ev(`${q('provider-status')}.innerText`)));
  await click('provider-cancel');
  await until('the dialog gone', `${q('provider-setup')}===null`);
  await sleep(1500);
  check('Cancel while fetching leaves no half install', inC(CLIENT, 'tester', `ls ~/.config/DSpatch/provider-support 2>/dev/null | wc -l`) === '0', inC(CLIENT, 'tester', 'ls ~/.config/DSpatch/provider-support 2>&1'));
  check('the draft survived that', (await ev(`document.querySelector('textarea').value`)) === 'my draft question');
  await choose('open-agent-select', 'claude');
  await click('provider-continue');
  await claudeSignIn('05');
  const url = await ev('window.__lastUrl ?? ""');
  const state = /[?&]state=([^&]+)/.exec(url)?.[1] ?? '';
  check('the installed files hold what the SDK needs', inC(CLIENT, 'tester', `ls -d ${CLAUDE_DATA}/node_modules/zod ${CLAUDE_DATA}/node_modules/@modelcontextprotocol/sdk | wc -l`) === '2');
  await typeInto('[data-ev="provider-input"]', `SYNTHETIC#${state}`);
  await enterOn();
  await until('the dialog gone after sign-in', `${q('provider-setup')}===null`, 40_000);
  await shot('06-claude-ready');
  check('Claude is chosen after sign-in, without a reload, with the draft', (await ev(`${q('open-agent-select')}.value`)) === 'claude' && (await ev(`document.querySelector('textarea').value`)) === 'my draft question');
  check('nothing was sent for the person', !standInLog().includes('/v1/messages'));
  check('the login is the vendor program\'s own', inC(CLIENT, 'tester', 'test -f ~/.claude/.credentials.json && echo yes') === 'yes');

  // --- An answer with a tool, on the packaged path ----------------------------------------------
  await until('send', `document.querySelector('.start__send, [data-ev="start-send"]')!==null`, 5_000).catch(() => undefined);
  await sendFromBox();
  const answer = await until('the answer', `[...document.querySelectorAll('[data-ev$="-answer"]')].map((n)=>n.innerText).find((t)=>t.includes('STAND-IN-REPLY'))`, 90_000);
  await shot('07-answer');
  check('an answer with DSpatch\'s tool, through the fetched SDK and program', /the tool answered and ran/.test(answer), answer);
  check('the tool server reached the program', /mcp__dspatch__list_recent_workspaces/.test(standInLog()));

  // --- The reported fault -----------------------------------------------------------------------
  await stopClient();
  inC(CLIENT, 'tester', `rm -rf ${CLAUDE_DATA}/node_modules/zod ${CLAUDE_DATA}/node_modules/zod-to-json-schema ${CLAUDE_DATA}/node_modules/@modelcontextprotocol`);
  const logBefore = inC(CLIENT, 'tester', 'ls ~/.config/DSpatch/conversations | wc -l');
  await startClient();
  await sleep(2500);
  await shot('08a-restart-with-the-fault');
  check('the reopened conversation names the repair', (await pageText()).includes('Claude support needs repair'));
  const faulty = await readable();
  check('the reopened conversation holds no internal text', clean(faulty).length === 0, faulty.slice(0, 500));
  await typeInto('textarea', 'after the fault');
  await choose('agent-select', 'claude');
  await until('the repair dialog', `${q('provider-continue')}!==null`, 30_000);
  await shot('08-repair-dialog');
  check('an affected install is offered Repair before anything fails', /needs repair/.test(await ev(`${q('provider-setup')}.innerText`)) && (await ev(`${q('provider-continue')}.innerText`)) === 'Repair');
  await click('provider-continue');
  await until('repaired', `${q('provider-setup')}===null`, 240_000);
  await shot('09-repaired');
  check('Repair kept the login: no sign-in was asked', inC(CLIENT, 'tester', 'test -f ~/.claude/.credentials.json && echo yes') === 'yes');
  check('Repair kept the conversations', inC(CLIENT, 'tester', 'ls ~/.config/DSpatch/conversations | wc -l') === logBefore);
  check('zod is back', inC(CLIENT, 'tester', `ls -d ${CLAUDE_DATA}/node_modules/zod | wc -l`) === '1');
  check('repair sent nothing, and the draft stayed', (await ev(`document.querySelector('textarea').value`)) === 'after the fault');
  const sentBefore = (standInLog().match(/POST \S+ \/v1\/messages/g) ?? []).length;
  await sleep(1500);
  check('still nothing sent after a wait', (standInLog().match(/POST \S+ \/v1\/messages/g) ?? []).length === sentBefore);
  await sendFromBox();
  await until('the second answer', `[...document.querySelectorAll('[data-ev$="-answer"]')].filter((n)=>n.innerText.includes('STAND-IN-REPLY')).length>=2 && ${q('active-answer')}===null`, 90_000);
  check('the repaired install answers', true);

  // --- A Claude failure, with the fault hitting inside an open conversation ---------------------
  await typeInto('textarea', 'please FAIL-THIS-TURN');
  await sendFromBox();
  await until('the failed turn', `[...document.querySelectorAll('[data-ev$="-error"]')].length>0`, 60_000);
  await sleep(3000);
  await shot('10-claude-failed');
  const failedView = await readable();
  check('a Claude failure shows once', (await ev(`[...document.querySelectorAll('.app__error')].length`)) === 1, failedView.slice(-300));
  check('no Cursor text, check or provider change', !failedView.includes('Cursor') && (await ev(`${q('agent-select')}.value`)) === 'claude' && (await ev(`${q('reconnect')}===null`)) === true);
  check('Cursor was not contacted', !/cursor/i.test(standInLog()), standInLog().split('\n').filter((line) => /cursor/i.test(line)).join(' | '));
  const words = clean(failedView);
  check('the plain view holds no internal text', words.length === 0, words.join(', '));

  // --- Existing, working install ----------------------------------------------------------------
  await stopClient();
  await startClient();
  await ev(`${q('session-new')}?.click()`);
  await choose(await ev(`${q('open-agent-select')}!==null`) ? 'open-agent-select' : 'agent-select', 'copilot');
  await until('Copilot dialog', `${q('provider-continue')}!==null`, 60_000);
  await shot('11-copilot-dialog');
  check('Copilot gets the same dialog', /Get started with Copilot/.test(await ev(`${q('provider-setup')}.innerText`)));
  await click('provider-cancel');
  const picker = (await ev(`${q('open-agent-select')}!==null`)) ? 'open-agent-select' : 'agent-select';
  check('Cancel left the provider as it was', (await ev(`${q(picker)}.value`)) === 'claude');
  await ev(`(()=>{const s=${q(picker)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await sleep(3000);
  check('with Claude ready no dialog opens', (await ev(`${q('provider-setup')}===null && ${q(picker)}.value==='claude'`)) === true);

  await copilotPart();
  await remotePart(linux);
}

async function enterOn() {
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}

async function sendFromBox() {
  await ev(`document.querySelector('textarea').focus()`);
  await enterOn();
}

async function copilotPart() {
  await ev(`window.__steps=[];window.dspatchSetup.onProviderStep((u)=>window.__steps.push(u.step))`);
  await choose((await ev(`${q('open-agent-select')}!==null`)) ? 'open-agent-select' : 'agent-select', 'copilot');
  await click('provider-continue');
  await until('the code', `${q('provider-code')}!==null || ${q('provider-problem')}!==null`, 60_000).catch(async (error) => {
    fs.writeFileSync(path.join(evidence, 'copilot-steps.json'), String(await ev('JSON.stringify(window.__steps)')));
    throw error;
  });
  await shot('12-copilot-code');
  const code = await ev(`${q('provider-code')}?.innerText ?? ''`);
  check('Copilot shows its one-time code in the dialog', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), code || await ev(`${q('provider-problem')}?.innerText`));
  const done = await until('Copilot sign-in detected', `${q('provider-setup')}===null || ${q('provider-problem')}!==null`, 60_000);
  const problem = await ev(`${q('provider-problem')}?.innerText ?? ''`);
  check('a finished Copilot sign-in is detected', Boolean(done) && problem === '', problem);
  await shot('13-copilot-after');
  if (problem !== '') {
    await click('provider-cancel');
  }
}

async function remotePart(linux) {
  inC(CLIENT, 'tester', `mkdir -p ~/.config/DSpatch/host-packages ~/.ssh && chmod 700 ~/.ssh && printf 'Host trial\\n  HostName %s\\n  User hostuser\\n  StrictHostKeyChecking accept-new\\n' "$(getent hosts ${HOST} | cut -d' ' -f1)" > ~/.ssh/config`);
  const ip = docker('inspect', '-f', `{{(index .NetworkSettings.Networks "${NET}").IPAddress}}`, HOST).stdout.trim();
  inC(CLIENT, 'tester', `printf 'Host trial\\n  HostName ${ip}\\n  User hostuser\\n  StrictHostKeyChecking accept-new\\n' > ~/.ssh/config`);
  docker('cp', path.join(appDir, 'release', 'host', linux.file), `${CLIENT}:/home/tester/.config/DSpatch/host-packages/${linux.file}`);
  inC(CLIENT, 'root', 'chown -R tester /home/tester/.config');
  docker('cp', path.join(evidence, 'standin'), `${HOST}:/tmp/standin`);
  inC(HOST, 'root', `cat >> /etc/ssh/sshd_config <<'S'
PasswordAuthentication yes
KbdInteractiveAuthentication no
SetEnv NODE_EXTRA_CA_CERTS=/tmp/standin/cert.pem CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
S
/usr/sbin/sshd
su hostuser -c 'mkdir -p ~/proj && cd ~/proj && git init -q .'`);
  await stopClient();
  await startClient();
  await ev(`${q('remote-session')}.click()`);
  await until('the form', `${q('ssh-target')}!==null`);
  await typeInto('[data-ev="ssh-target"]', 'trial');
  await click('ssh-connect');
  const end = Date.now() + 180_000;
  while (Date.now() < end) {
    const state = JSON.parse(await ev(`JSON.stringify({ kind: ${q('ssh-question')}?.dataset.kind ?? null, on: ${q('host-link')}?.textContent ?? '' })`).catch(() => '{}') ?? '{}');
    if (state.kind === 'secret') {
      await typeInto('[data-ev="ssh-secret"]', PASSWORD);
      await click('ssh-yes');
    } else if (state.kind !== null && state.kind !== undefined) {
      await click('ssh-yes');
    }
    if (/^On /.test(state.on ?? '')) {
      break;
    }
    await sleep(300);
  }
  await until('connected', `/^On /.test(${q('host-link')}?.textContent ?? '')`, 5_000);
  check('connected over ssh', true);
  const node = inC(HOST, 'hostuser', "ls -d ~/.local/share/dspatch/host/versions/*/runtime/bin/node ~/.local/share/dspatch/host/versions/*/node/bin/node 2>/dev/null | head -1");
  standIn(HOST, node || inC(HOST, 'hostuser', "find ~/.local/share/dspatch/host -type f -name node | head -1"));
  await sleep(800);
  await ev(`window.location.reload()`);
  await sleep(1500);
  await attach();
  await until('the page', `${q('open-agent-select')}!==null`, 30_000);
  await typeInto('textarea', 'remote draft');
  await choose('open-agent-select', 'copilot');
  await sleep(500);
  await choose('open-agent-select', 'claude');
  await until('the remote dialog', `${q('provider-continue')}!==null`, 60_000);
  await shot('14-remote-dialog');
  check('the dialog names the remote machine', /trialhost/.test(await ev(`${q('provider-setup')}.innerText`)), await ev(`${q('provider-setup')}.innerText`));
  const before = inC(CLIENT, 'tester', 'stat -c %Y ~/.config/DSpatch/provider-support/claude/installed.json');
  await ev(`window.__lastUrl=''; window.dspatchSetup.onProviderStep(({step})=>{if(step.kind==='open-url'){window.__lastUrl=step.url}})`);
  await click('provider-continue');
  await claudeSignIn('15-remote');
  check('support landed on the remote machine', inC(HOST, 'hostuser', 'ls -d ~/.local/share/dspatch-host/provider-support/claude/node_modules/zod | wc -l') === '1');
  check('nothing changed on this computer', inC(CLIENT, 'tester', 'stat -c %Y ~/.config/DSpatch/provider-support/claude/installed.json') === before);
  const url = await ev('window.__lastUrl ?? ""');
  await typeInto('[data-ev="provider-input"]', `SYNTHETIC#${/[?&]state=([^&]+)/.exec(url)?.[1] ?? ''}`);
  await enterOn();
  await until('remote ready', `${q('provider-setup')}===null`, 40_000);
  // The reported fault on the host, repaired from here.
  inC(HOST, 'hostuser', 'rm -rf ~/.local/share/dspatch-host/provider-support/claude/node_modules/zod');
  await sendFromBox();
  await until('the remote repair dialog', `${q('provider-continue')}!==null`, 30_000);
  await click('provider-continue');
  await until('remote repaired', `${q('provider-setup')}===null`, 240_000);
  check('zod is back on the host', inC(HOST, 'hostuser', 'ls -d ~/.local/share/dspatch-host/provider-support/claude/node_modules/zod | wc -l') === '1');
  check('the login on the host was kept', inC(HOST, 'hostuser', 'test -f ~/.claude/.credentials.json && echo yes') === 'yes');
  check('nothing sent, draft kept', (await ev(`document.querySelector('textarea').value`)) === 'remote draft' && !standInLog(HOST).includes('/v1/messages'));
  await sendFromBox();
  const answer = await until('the remote answer', `[...document.querySelectorAll('[data-ev$="-answer"]')].map((n)=>n.innerText).find((t)=>t.includes('STAND-IN-REPLY'))`, 90_000);
  await shot('16-remote-answer');
  check('a remote answer with the tool', /the tool answered and ran/.test(answer), answer);
  check('Cursor was not contacted on the host', !/cursor/i.test(standInLog(HOST)));
}

try {
  await main();
} catch (error) {
  check('the trial reached its end', false, error.message);
  await shot('stopped').catch(() => undefined);
  fs.writeFileSync(path.join(evidence, 'client.log'), inC(CLIENT, 'tester', 'tail -80 /tmp/client.log'));
  fs.writeFileSync(path.join(evidence, 'claude-transcript.txt'), inC(CLIENT, 'tester', 'ps -eo pid,etime,args | grep -v type= | cut -c1-200; for f in $(ls -t ~/.claude/projects/*/*.jsonl | head -2); do echo "== $f"; tail -6 "$f" | cut -c1-700; done'));
} finally {
  fs.writeFileSync(path.join(evidence, 'stand-in-client.log'), standInLog());
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  ws?.close();
  for (const name of [CLIENT, HOST]) {
    docker('rm', '-f', name);
  }
  docker('network', 'rm', NET);
  fs.rmSync(path.join(evidence, 'standin'), { recursive: true, force: true });
  const failed = results.filter((row) => row.ok === false);
  process.stdout.write(`\n${String(results.length - failed.length)} of ${String(results.length)} passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}
