// @ts-nocheck: a trial script.
/**
 * The release trial: what a person does with a published prerelease, in two clean containers with
 * no Node, no npm and no sources. The .deb is installed, Remote Session is given `hostuser@…`, and
 * the client fetches the host package for its own build, checks it and installs it over real ssh.
 * The provider on the host is SIMULATED: no model and no account is reached.
 *
 *     node scripts/trial-package/release.mjs --stage     the staged files, behind a local github.com
 *     node scripts/trial-package/release.mjs --published the real release of this version
 *
 * github.com cannot be reached from the client. Since v0.1.4 the Linux client carries the host
 * archive for its own build, so Connect installs it over ssh with nothing fetched (DSP-168); the
 * stand-in of `--stage` therefore sees no request, and only the staged files are checked.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const published = process.argv.includes('--published');
const { version } = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const stage = path.join(appDir, 'release', `stage-v${version}`);
const evidence = path.join(appDir, 'release', published ? 'trial-published' : 'trial-release');
const base = `https://github.com/nizlas/DSpatch/releases/download/v${version}`;
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const CLIENT = 'dspatch-release-client';
const HOST = 'dspatch-release-host';
const NET = 'dspatch-release-net';
const DEBUG = 9362;
const PASSWORD = 'trial-password';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1048576 });
const inC = (name, user, script) => {
  const result = docker('exec', '-u', user, name, 'bash', '-c', script);
  return (result.stdout + result.stderr).trim();
};
const results = [];
function check(what, ok, detail = '') {
  results.push({ what, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 240)}`}\n`);
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
    await sleep(150);
  }
  await shot(`timeout-${what.replace(/\W+/g, '-')}`);
  throw new Error(`timeout: ${what}; window says: ${String(await ev('document.body.innerText')).slice(0, 300)}`);
}
async function click(name) {
  await until(`the ${name} control`, `${q(name)}!==null && !${q(name)}.disabled`);
  const box = JSON.parse(await ev(`(${q(name)}.scrollIntoView({block:'center'}),JSON.stringify(${q(name)}.getBoundingClientRect()))`));
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cmd('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }
}
async function typeInto(selector, text) {
  await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await ev(`document.querySelector(${JSON.stringify(selector)}).select?.()`);
  await cmd('Input.insertText', { text });
}
const hostLine = () => ev(`${q('host-link')}?.textContent ?? ''`);

/** Press Connect and answer ssh; ends at a connection or at a status line that stays. */
async function connect() {
  await click('ssh-connect');
  const end = Date.now() + 240_000;
  while (Date.now() < end) {
    const state = JSON.parse((await ev(`JSON.stringify({ kind: ${q('ssh-question')}?.dataset.kind ?? null, busy: ${q('ssh-connect')}?.disabled ?? null, status: ${q('ssh-status')}?.textContent ?? '' })`).catch(() => null)) ?? '{}');
    if (state.kind === 'secret') {
      await typeInto('[data-ev="ssh-secret"]', PASSWORD);
      await click('ssh-yes');
    } else if (state.kind !== null && state.kind !== undefined) {
      await click('ssh-yes');
    }
    // "On this computer" is the local host's line (DSP-169; "…, through the host that stays running" before).
    const line = (await hostLine().catch(() => '')) ?? '';
    if (/^On /.test(line) && !/^On this computer/.test(line)) {
      return 'connected';
    }
    if (state.busy === false) {
      return state.status;
    }
    await sleep(200);
  }
  return 'timed out';
}

async function main() {
  const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sums = new Map(fs.readFileSync(published ? path.join(evidence, 'SHA256SUMS') : path.join(stage, 'SHA256SUMS'), 'utf8').trim().split('\n').map((line) => line.split('  ').reverse()));
  const deb = `dspatch_${version}_amd64.deb`;
  const debFile = published ? path.join(evidence, deb) : path.join(stage, deb);
  check('the .deb matches SHA256SUMS', sha(debFile) === sums.get(deb));
  for (const name of [CLIENT, HOST]) {
    docker('rm', '-f', name);
  }
  docker('network', 'rm', NET);
  docker('network', 'create', NET);
  docker('run', '-d', '--init', '--name', HOST, '--hostname', 'trialhost', '--network', NET, 'dspatch-trial', 'sleep', 'infinity');
  docker('run', '-d', '--name', CLIENT, '--network', NET, '-p', `127.0.0.1:${String(DEBUG)}:${String(DEBUG + 1)}`, '--shm-size=512m', '--cap-add', 'SYS_ADMIN', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined', 'dspatch-trial', 'sleep', 'infinity');
  inC(HOST, 'root', `cat >> /etc/ssh/sshd_config <<'S'
PasswordAuthentication yes
KbdInteractiveAuthentication no
SetEnv DSPATCH_CHAT_RUN=review-flow DSPATCH_PRESENTATION_MODELS=copilot DSPATCH_PRESENTATION_LIST_MS=50 DSPATCH_PRESENTATION_DELTA_MS=60
S
/usr/sbin/sshd`);
  docker('cp', debFile, `${CLIENT}:/tmp/dspatch.deb`);
  check('the .deb installs', inC(CLIENT, 'root', 'dpkg -i /tmp/dspatch.deb 2>&1 | tail -1; dpkg -s dspatch | grep ^Status').includes('install ok installed'));
  check('no Node or npm, and no host package at hand', inC(CLIENT, 'tester', 'command -v node npm; ls ~/.config/DSpatch/host-packages 2>/dev/null | wc -l') === '0');
  // github.com leads nowhere for the first attempt.
  inC(CLIENT, 'root', 'cp /etc/hosts /tmp/hosts.good; echo "127.0.0.1 github.com" >> /etc/hosts');
  docker('exec', '-d', CLIENT, 'Xvfb', ':99', '-screen', '0', '1280x900x24');
  await sleep(1000);
  // DevTools listens on the container's loopback only; this relays it to the published port.
  docker('exec', '-d', '-e', 'ELECTRON_RUN_AS_NODE=1', CLIENT, '/opt/DSpatch/dspatch', '-e', `require('net').createServer((a)=>{const b=require('net').connect(${String(DEBUG)},'127.0.0.1');a.pipe(b).pipe(a);a.on('error',()=>{});b.on('error',()=>{})}).listen(${String(DEBUG + 1)},'0.0.0.0')`);
  const ip = docker('inspect', '-f', `{{(index .NetworkSettings.Networks "${NET}").IPAddress}}`, HOST).stdout.trim();
  inC(CLIENT, 'tester', `mkdir -p ~/.ssh && chmod 700 ~/.ssh && printf 'Host trial\\n  HostName ${ip}\\n  User hostuser\\n  StrictHostKeyChecking accept-new\\n' > ~/.ssh/config`);
  docker('exec', '-d', '-u', 'tester', '-e', 'DISPLAY=:99', '-e', 'NODE_EXTRA_CA_CERTS=/tmp/release-cert.pem', CLIENT, 'bash', '-c', `exec dspatch --remote-debugging-port=${String(DEBUG)} >>/tmp/client.log 2>&1`);
  await attach();
  await until('the start page', `${q('remote-session')}!==null`);
  await ev(`${q('remote-session')}.click()`);
  await until('the form', `${q('ssh-target')}!==null`);
  await typeInto('[data-ev="ssh-target"]', 'trial');
  const first = await connect();
  await shot('01-connected-without-github');
  check('Connect installs the host the client carries, with github.com unreachable', first === 'connected', first);
  check('nothing was asked of GitHub', !/could not be downloaded|Downloading host/i.test(await ev('document.body.innerText')));

  let answer = first;
  if (published) {
    inC(CLIENT, 'root', 'cat /tmp/hosts.good > /etc/hosts');
  } else {
    const certs = path.join(evidence, 'certs');
    fs.mkdirSync(certs);
    spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem'), '-days', '2', '-subj', '/CN=github.com', '-addext', 'subjectAltName=DNS:github.com']);
    docker('cp', certs, `${CLIENT}:/tmp/certs`);
    docker('cp', stage, `${CLIENT}:/tmp/stage`);
    docker('cp', path.join(appDir, 'scripts', 'trial-package', 'release-stand-in.mjs'), `${CLIENT}:/tmp/release-stand-in.mjs`);
    docker('exec', CLIENT, 'cp', '/tmp/certs/cert.pem', '/tmp/release-cert.pem');
    // The client read its certificate list at start: a new one needs a new window.
    inC(CLIENT, 'root', 'pkill -f remote-debugging-port; sleep 2; chmod -R a+r /tmp/certs /tmp/release-cert.pem');
    docker('exec', '-d', '-e', 'ELECTRON_RUN_AS_NODE=1', CLIENT, '/opt/DSpatch/dspatch', '/tmp/release-stand-in.mjs', '/tmp/certs/key.pem', '/tmp/certs/cert.pem', '/tmp/stage', '/tmp/release.log');
    await sleep(1000);
    docker('exec', '-d', '-u', 'tester', '-e', 'DISPLAY=:99', '-e', 'NODE_EXTRA_CA_CERTS=/tmp/release-cert.pem', CLIENT, 'bash', '-c', `exec dspatch --remote-debugging-port=${String(DEBUG)} >>/tmp/client.log 2>&1`);
    await sleep(2000);
    await attach();
    await until('the start page', `${q('remote-session')}!==null`);
    await ev(`${q('remote-form')}===null && ${q('remote-session')}.click()`);
    await until('the form', `${q('ssh-target')}!==null`);
    await typeInto('[data-ev="ssh-target"]', 'trial');
    answer = await connect();
  }
  await shot('02-connected');
  check('the host is reached', answer === 'connected', answer);
  const manifest = JSON.parse(fs.readFileSync(published ? path.join(evidence, 'host-manifest.json') : path.join(stage, 'host-manifest.json'), 'utf8'));
  const linux = manifest.packages.find((entry) => entry.platform === 'linux');
  check('the archive the client carries is the manifest\'s', inC(CLIENT, 'root', `sha256sum /opt/DSpatch/resources/bundled/host-packages/${linux.file} | cut -d' ' -f1`) === linux.sha256);
  check('no host package was put in the client\'s data', inC(CLIENT, 'tester', 'ls ~/.config/DSpatch/host-packages 2>/dev/null | wc -l') === '0');
  const versions = inC(HOST, 'hostuser', 'ls ~/.local/share/dspatch/host/versions');
  check('the host runs exactly this build', versions.includes(manifest.hostId), versions);
  check('Node exists only inside the host package', inC(HOST, 'hostuser', 'command -v node npm || echo none') === 'none');
  await until('the host\'s page', `${q('open-agent-select')}!==null`, 30_000);
  await ev(`(()=>{const s=${q('open-agent-select')};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'copilot');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await until('Copilot chosen', `${q('open-agent-select')}.value==='copilot'`, 30_000);
  await typeInto('textarea', 'hello from the release trial');
  await ev(`document.querySelector('textarea').focus()`);
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until('an answer', `${q('turn-0-prompt')}!==null && ${q('active-answer')}===null && ([...document.querySelectorAll('[data-ev$="-answer"]')].some((n)=>n.innerText.trim()!==''))`, 60_000);
  await shot('03-answer');
  check('a Copilot turn on the host (SIMULATED provider)', true);
}

if (published) {
  for (const file of ['SHA256SUMS', 'host-manifest.json', `dspatch_${version}_amd64.deb`]) {
    const answer = await fetch(`${base}/${file}`);
    fs.writeFileSync(path.join(evidence, file), Buffer.from(await answer.arrayBuffer()));
    check(`${file} downloads`, answer.ok, String(answer.status));
  }
}
try {
  await main();
} catch (error) {
  check('the trial reached its end', false, error.message);
  await shot('stopped').catch(() => undefined);
  fs.writeFileSync(path.join(evidence, 'client.log'), inC(CLIENT, 'tester', 'tail -60 /tmp/client.log'));
} finally {
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  ws?.close();
  for (const name of [CLIENT, HOST]) {
    docker('rm', '-f', name);
  }
  docker('network', 'rm', NET);
  fs.rmSync(path.join(evidence, 'certs'), { recursive: true, force: true });
  const bad = results.filter((row) => !row.ok);
  process.stdout.write(`\n${String(results.length - bad.length)} of ${String(results.length)} passed\n`);
  process.exit(bad.length === 0 ? 0 : 1);
}
