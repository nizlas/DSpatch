// @ts-nocheck: a trial script over untyped DevTools answers.
/**
 * The packaged trial (DSP-153): the real .deb and host package on two clean containers, real sshd,
 * a real window on Xvfb driven through the DevTools protocol, a SIMULATED provider on the host
 * (set in that sshd's environment, so no model and no provider is contacted).
 *
 *     docker build -t dspatch-trial -f scripts/trial-package/Dockerfile scripts/trial-package
 *     node scripts/trial-package/run.mjs [<evidence folder>]
 *
 * Needs `npm run package:host -- --platform linux` and `npm run package:client -- --linux deb
 * --x64` done first. Touches no profile, ssh setting or login of this machine: it stays inside the
 * two containers. The client container uses the host network so this script can reach DevTools.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const evidence = path.resolve(process.argv[2] ?? path.join(appDir, 'release', 'trial'));
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const CLIENT = 'dspatch-trial-client';
const HOST = 'dspatch-trial-host';
const NET = 'dspatch-trial-net';
const DEBUG = 9360;
const PASSWORD = 'trial-password';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1048576 });
/** Run in a container and answer stdout. */
function inC(name, user, script, env = {}) {
  const result = docker('exec', '-u', user, ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), name, 'bash', '-c', script);
  return (result.stdout + result.stderr).trim();
}
const results = [];
function check(what, ok, detail = '') {
  results.push({ what, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 240)}`}\n`);
}
const note = (what, detail) => {
  results.push({ what, note: detail });
  process.stdout.write(`note ${what} :: ${String(detail).slice(0, 300)}\n`);
};

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
  throw new Error(`timeout: ${what}; window says: ${String(await ev('document.body.innerText.slice(0,300)'))}`);
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
async function typeInto(name, text) {
  await click(name);
  await ev(`${q(name)}.select?.()`);
  await cmd('Input.insertText', { text });
}
async function enter() {
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
async function shot(name) {
  const data = await cmd('Page.captureScreenshot', { format: 'png' });
  if (data.result?.data !== undefined) {
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(data.result.data, 'base64'));
  }
}
const statusOf = () => ev(`${q('ssh-status')}?.textContent ?? ''`);

/** Connect to a target, answering what ssh asks. Returns what the status line said, in order. */
async function connect(target, { password = PASSWORD, accept = 'yes', replace = 'yes', ms = 180_000 } = {}) {
  await ev(`${q('remote-form')}===null && ${q('remote-session')}?.click()`);
  await until('the form', `${q('ssh-target')}!==null`);
  await typeInto('ssh-target', target);
  await click('ssh-connect');
  const seen = [];
  const asked = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let state;
    try {
      state = JSON.parse(
        await ev(`JSON.stringify({
          status: ${q('ssh-status')}?.textContent ?? null,
          kind: ${q('ssh-question')}?.dataset.kind ?? null,
          text: document.querySelector('.ssh-question__text')?.textContent ?? '',
          on: ${q('host-link')}?.textContent ?? '',
          busy: ${q('ssh-connect')}?.disabled ?? null,
        })`),
      );
    } catch {
      await sleep(300);
      await attach().catch(() => undefined);
      continue;
    }
    if (state.status !== null && seen.at(-1) !== state.status) {
      seen.push(state.status);
    }
    if (state.kind !== null) {
      asked.push(state.text);
      if (state.kind === 'secret') {
        await typeInto('ssh-secret', password);
        await click('ssh-yes');
      } else {
        const yes = /Replace it/.test(state.text) ? replace === 'yes' : accept === 'yes';
        await click(yes ? 'ssh-yes' : 'ssh-no');
      }
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
  await shot('connect-timeout');
  return { connected: false, seen, asked, timedOut: true };
}

const chooseAgent = (agent) =>
  ev(`(()=>{const s=${q('open-agent-select')};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'${agent}');s.dispatchEvent(new Event('change',{bubbles:true}))})()`).then(() => sleep(800));
const loopSummary = (listing) => JSON.stringify(listing.choices.map((row) => [row.definitionId, row.usable, row.preselected, row.error ?? null]));
const loopsAreRight = (listing) =>
  listing.choices.some((row) => row.definitionId === 'dspatch-development-loop-runnable' && row.usable && !row.preselected) &&
  listing.choices.some((row) => row.key.endsWith('dspatch-chat-loop.loop.json') && row.usable);

const hostIp = () => docker('inspect', '-f', '{{(index .NetworkSettings.Networks "' + NET + '").IPAddress}}', HOST).stdout.trim();
const clientPids = () => inC(CLIENT, 'tester', 'pgrep -o -x dspatch');
const clientLog = () => inC(CLIENT, 'tester', 'cat /tmp/client.log');
const versionsOnHost = () => inC(HOST, 'hostuser', 'ls -a ~/.local/share/dspatch/host/versions 2>/dev/null | grep -v "^\\.\\.\\?$" | tr "\\n" " "');
const hostPid = () => inC(HOST, 'hostuser', "pgrep -f '[d]ist/host/remote-host.js' | tr '\\n' ' '").trim();
const conversationText = () => inC(HOST, 'hostuser', 'cat ~/.local/share/dspatch-host/conversations/*.json 2>/dev/null');
const startClient = async () => {
  docker('exec', '-d', '-u', 'tester', '-e', 'DISPLAY=:99', CLIENT, 'bash', '-c', `exec dspatch --remote-debugging-port=${String(DEBUG)} >>/tmp/client.log 2>&1`);
  await attach();
  await until('the start page', `${q('remote-session')}!==null`);
};

async function main() {
  const deb = fs.readdirSync(path.join(appDir, 'release')).find((file) => file.endsWith('.deb'));
  const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'release', 'host', 'host-manifest.json'), 'utf8'));
  const linux = manifest.packages.find((entry) => entry.platform === 'linux');
  for (const name of [CLIENT, HOST]) {
    docker('rm', '-f', name);
  }
  docker('network', 'rm', NET);
  docker('network', 'create', NET);
  docker('run', '-d', '--init', '--name', HOST, '--hostname', 'trialhost', '--network', NET, 'dspatch-trial', 'sleep', 'infinity');
  // Docker's default profile forbids what Chromium's sandbox needs to do; the sandbox stays on.
  docker('run', '-d', '--name', CLIENT, '--network', 'host', '--shm-size=512m', '--cap-add', 'SYS_ADMIN', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined', 'dspatch-trial', 'sleep', 'infinity');
  inC(
    HOST,
    'root',
    `cat >> /etc/ssh/sshd_config <<'S'
PasswordAuthentication yes
KbdInteractiveAuthentication no
SetEnv DSPATCH_CHAT_RUN=review-flow DSPATCH_PRESENTATION_MODELS=copilot DSPATCH_PRESENTATION_LIST_MS=50 DSPATCH_PRESENTATION_TOOL_MS=400 DSPATCH_PRESENTATION_DELTA_MS=120 DSPATCH_CLAUDE_AUTHORIZATION=presentation-simulated
S
/usr/sbin/sshd
su hostuser -c 'mkdir -p ~/proj && cd ~/proj && git init -q . && echo hello > README.md && git -c user.name=t -c user.email=t@t add . && git -c user.name=t -c user.email=t@t commit -qm one'`,
  );

  // --- The installed client ---------------------------------------------------------------------
  docker('cp', path.join(appDir, 'release', deb), `${CLIENT}:/tmp/dspatch.deb`);
  const installed = inC(CLIENT, 'root', 'dpkg -i /tmp/dspatch.deb 2>&1 | tail -3; dpkg -s dspatch | grep -E "^(Status|Version)"');
  check('the .deb installs', installed.includes('install ok installed'), installed);
  check('no global Node or npm on the client', inC(CLIENT, 'tester', 'command -v node npm || echo none') === 'none');
  note('chrome-sandbox after the postinst', inC(CLIENT, 'root', 'stat -c "%a %U" /opt/DSpatch/chrome-sandbox'));
  check('the menu entry and icon are installed', inC(CLIENT, 'root', 'test -f /usr/share/applications/dspatch.desktop && find /usr/share/icons -name "dspatch.png" | head -1 | grep -c png') === '1');
  docker('exec', '-d', CLIENT, 'Xvfb', ':99', '-screen', '0', '1280x900x24');
  await sleep(1000);
  inC(CLIENT, 'tester', `mkdir -p ~/.config/DSpatch/host-packages ~/.ssh && chmod 700 ~/.ssh && printf 'Host trial\\n  HostName ${hostIp()}\\n  User hostuser\\n' > ~/.ssh/config`);
  docker('cp', path.join(appDir, 'release', 'host', linux.file), `${CLIENT}:/home/tester/.config/DSpatch/host-packages/${linux.file}`);
  inC(CLIENT, 'root', 'chown -R tester /home/tester/.config');
  await startClient();
  await shot('01-start-page');
  check('the installed client opens without --no-sandbox', !inC(CLIENT, 'tester', 'ps -eo args').includes('--no-sandbox=') && !/dspatch .*--no-sandbox/.test(inC(CLIENT, 'tester', 'ps -eo args | grep -v type=')), inC(CLIENT, 'tester', "ps -eo args | grep -m3 -E 'type=(zygote|renderer)' | cut -c1-120"));
  const log0 = clientLog();
  note('client identity', /identity=\S+ files=\d+ git=\S+/.exec(log0)?.[0]);
  check('the sandbox is on', !/sandbox.*(not|fail|disabled)/i.test(log0), log0.split('\n').filter((line) => /sandbox/i.test(line)).join(' | '));
  // --- Installed locally: loops, and each provider's program and sign-in ----------------------------
  inC(CLIENT, 'tester', 'mkdir -p ~/p && cd ~/p && git init -q .');
  await chooseAgent('copilot');
  note('provider state on a fresh install', JSON.stringify(await ev(`window.dspatchSetup.providerCall('provider.status')`)));
  const localLoops = JSON.parse(await ev('window.dspatch.listLoopDefinitions().then(JSON.stringify)'));
  check('the bundled loops are offered from the installed client, the chat loop chosen', loopsAreRight(localLoops), loopSummary(localLoops));
  await click('copilot-login');
  await until('the sign-in link', `${q('provider-open')}!==null || ${q('provider-problem')}!==null`, 90_000);
  note('Copilot sign-in on the installed client', await ev(`${q('provider-setup')}.innerText`));
  await shot('01b-copilot-login');
  // With a display the CLI uses a browser on this machine; without one, as on a remote host, a code.
  check('Copilot: the CLI is fetched and gives a sign-in link', (await ev(`${q('provider-open')}!==null`)) === true);
  const device = inC(CLIENT, 'tester', '(sleep 4 | timeout 5 ~/.config/DSpatch/provider-support/copilot/node_modules/@github/copilot-linux-x64/copilot login 2>&1) | head -1');
  check('Copilot without a display gives a code for another computer', /login\/device.*[A-Z0-9]{4}-[A-Z0-9]{4}/.test(device), device.replace(/[A-Z0-9]{4}-[A-Z0-9]{4}/, 'XXXX-XXXX'));
  await ev(`window.dspatchSetup.providerCall('provider.loginCancel')`);
  await click('claude-consent');
  await click('claude-install');
  await until('Claude installed', `${q('claude-login')}!==null || ${q('provider-problem')}!==null`, 120_000);
  await click('claude-login');
  await until('the sign-in link', `${q('provider-open')}!==null || ${q('provider-problem')}!==null`, 30_000);
  note('Claude sign-in on the installed client', await ev(`${q('provider-setup')}.innerText`));
  await shot('01c-claude-login');
  check('Claude: consent, then the program, then a link and a place for the code', (await ev(`${q('provider-open')}!==null && ${q('provider-input')}!==null`)) === true);
  await ev(`window.dspatchSetup.providerCall('provider.loginCancel')`);
  check('no API key path was offered', !/api key\b(?! is used)/i.test((await ev(`${q('provider-setup')}.innerText`)).replace('no API key is used', '')));
  await ev('location.reload()');
  await sleep(1500);
  await attach();
  await until('the start page', `${q('remote-session')}!==null`);

  // --- Nothing answers, refused, wrong password ---------------------------------------------------
  const wrong = await connect('hostuser@no-such-machine.invalid');
  check('a name that does not exist reads as such', !wrong.connected && /could be found|could not be reached/.test(wrong.seen.at(-1) ?? ''), wrong.seen.at(-1));
  const denied = await connect('trial', { password: 'wrong' });
  check('a refused sign-in reads as such, after fingerprint and password', !denied.connected && /refused the sign-in/.test(denied.seen.at(-1) ?? ''), denied.seen.at(-1));
  check('an unknown host is asked about with its fingerprint', denied.asked.some((text) => /fingerprint/i.test(text) && /SHA256:/.test(text)), denied.asked[0]);

  // --- New install over password ------------------------------------------------------------------
  const pidBefore = clientPids();
  const first = await connect('trial');
  await shot('02-connected');
  check('Connect reaches the host with an alias and a password', first.connected, first.seen.join(' > '));
  check('the steps were shown', first.seen.some((s) => /Installing host/.test(s)) && first.seen.some((s) => /Starting host/.test(s)), first.seen.join(' > '));
  check('the same client process stayed', clientPids() === pidBefore);
  check('the host is in its version folder', versionsOnHost().trim() === manifest.hostId, versionsOnHost());
  check('no Node on the host machine', inC(HOST, 'hostuser', 'command -v node npm || echo none') === 'none');
  const argv = inC(CLIENT, 'tester', 'ps -eo args') + inC(HOST, 'root', 'ps -eo args');
  const token = inC(HOST, 'hostuser', 'cat ~/.local/share/dspatch-host/remote-token');
  check('neither password nor token is on a command line', !argv.includes(token) && !argv.includes(PASSWORD));
  check('neither is in the client log or its settings', !inC(CLIENT, 'tester', `grep -rlsF -e '${token}' -e '${PASSWORD}' /tmp/client.log ~/.config/DSpatch/*.json`).includes('/'));

  // --- Work, a dropped tunnel in the middle, nothing sent twice -----------------------------------
  await chooseAgent('copilot');
  await ev(`window.dspatch.startChatSession({ kind: 'folder', path: '/home/hostuser/proj' })`);
  await ev('location.reload()');
  await sleep(1500);
  await attach();
  await click('open-project-0');
  await until('the chat', `${q('prompt')}!==null`);
  const remoteLoops = JSON.parse(await ev('window.dspatch.listLoopDefinitions().then(JSON.stringify)'));
  check('the bundled loops are offered from the installed host, the chat loop chosen', loopsAreRight(remoteLoops), loopSummary(remoteLoops));
  await typeInto('prompt', '[[very-slow]] [[tools]] Keep going while the tunnel drops.');
  await enter();
  await until('activity', `${q('turn-activity')}!==null`);
  inC(CLIENT, 'tester', "pkill -f '^ssh .*ControlMaster=yes'");
  note('the tunnel was cut during a turn', 'ssh master killed');
  await until('the link says so', `/Disconnected|reconnect/i.test(${q('host-link')}?.textContent ?? '')`, 20_000).catch(() => undefined);
  await until('the link back', `/^On /.test(${q('host-link')}?.textContent ?? '')`, 60_000);
  await until('the answer', `${q('working-indicator')}===null`, 120_000);
  await sleep(1000);
  const asked = inC(HOST, 'hostuser', 'cat ~/.local/share/dspatch-host/conversations/*.json')
    .split(/(?=\{\s*"format)/)
    .flatMap((text) => {
      try {
        return JSON.parse(text).messages ?? [];
      } catch {
        return [];
      }
    })
    .filter((message) => JSON.stringify(message).includes('Keep going while the tunnel drops'));
  check('the record holds one message and one attempt for it', asked.length === 1 && (asked[0].attempts?.length ?? 1) === 1, JSON.stringify(asked.map((message) => ({ status: message.status, keys: Object.keys(message).length }))));
  check('the turn was not sent again', (await ev(`(document.body.innerText.match(/Keep going while/g)||[]).length`)) === 1 && hostPid().split(' ').length === 1, hostPid());

  // --- Leave: the host and the data stay ----------------------------------------------------------
  const hostBefore = hostPid();
  await click('host-link-leave');
  await sleep(1500);
  await attach();
  await until('local again', `${q('host-link')}===null && (${q('remote-session')}!==null || ${q('prompt')}!==null)`);
  check('Leave closes the tunnel', inC(CLIENT, 'tester', "pgrep -c -f '^ssh ' || true").trim() === '0');
  check('Leave leaves the host running', hostPid() === hostBefore, hostPid());

  // --- Reuse --------------------------------------------------------------------------------------
  const again = await connect('trial');
  check('Connect again reuses the running host', again.connected && !again.seen.some((s) => /Installing|Starting/.test(s)) && hostPid() === hostBefore, again.seen.join(' > '));
  check('the known host is not asked about again', !again.asked.some((text) => /fingerprint/i.test(text)));
  await click('host-link-leave');
  await sleep(1500);
  await attach();
  await until('local again', `${q('remote-session')}!==null`);

  // --- A stopped host starts again, a broken upload harms nothing ---------------------------------
  inC(HOST, 'hostuser', `kill ${hostBefore}; sleep 2`);
  const restarted = await connect('trial');
  check('a stopped host is started', restarted.connected && restarted.seen.some((s) => /Starting/.test(s)) && !restarted.seen.some((s) => /Installing/.test(s)), restarted.seen.join(' > '));
  await click('host-link-leave');
  await sleep(1500);
  await attach();
  await until('local again', `${q('remote-session')}!==null`);
  inC(HOST, 'hostuser', `kill $(pgrep -f '[d]ist/host/remote-host.js'); sleep 2; mv ~/.local/share/dspatch/host/versions/${manifest.hostId} ~/.local/share/dspatch/host/versions-kept`);
  const cutting = spawnSync('bash', ['-c', `(sleep 0.1; for i in $(seq 1 300); do docker exec ${HOST} pkill -f 'incoming' && break; sleep 0.1; done) >/dev/null 2>&1 &`], { stdio: 'ignore' });
  void cutting;
  const cut = await connect('trial');
  check('an install cut in the middle says so and changes nothing', !cut.connected && versionsOnHost().trim() === '', `${String(cut.seen.at(-1))} / versions: "${versionsOnHost()}" / incoming: ${inC(HOST, 'hostuser', 'ls -la ~/.local/share/dspatch/host/incoming | tail -2')}`);
  const retried = await connect('trial');
  check('the same install then succeeds', retried.connected && versionsOnHost().trim() === manifest.hostId, retried.seen.join(' > '));
  await click('host-link-leave');
  await sleep(1500);
  await attach();
  await until('local again', `${q('remote-session')}!==null`);

  // --- Update: another version runs there --------------------------------------------------------
  inC(
    HOST,
    'hostuser',
    `kill $(pgrep -f '[d]ist/host/remote-host.js'); sleep 2
v=~/.local/share/dspatch/host/versions
cp -a $v/${manifest.hostId} $v/0.0.9-oldoldoldold
sed -i 's/"version": "[^"]*"/"version": "0.0.9"/' $v/0.0.9-oldoldoldold/dspatch-host/app/package.json
sed -i 's/"revision": "[^"]*"/"revision": "oldoldoldold"/' $v/0.0.9-oldoldoldold/dspatch-host/app/dist/build-identity.json
rm -rf $v/${manifest.hostId}
env DSPATCH_CHAT_RUN=review-flow nohup setsid $v/0.0.9-oldoldoldold/dspatch-host/dspatch-host --port 0 --data ~/.local/share/dspatch-host >/dev/null 2>&1 </dev/null &
sleep 3`,
  );
  const kept = await connect('trial', { replace: 'no' });
  check('another version running is asked about, and No keeps it', kept.connected && kept.asked.some((text) => /Replace it/.test(text)) && !versionsOnHost().includes(manifest.hostId), `${kept.seen.join(' > ')} / ${versionsOnHost()}`);
  await click('host-link-leave');
  await sleep(1500);
  await attach();
  await until('local again', `${q('remote-session')}!==null`);
  const updated = await connect('trial', { replace: 'yes' });
  check('Yes replaces it, installing beside the old version', updated.connected && versionsOnHost().includes(manifest.hostId) && versionsOnHost().includes('0.0.9'), `${updated.seen.join(' > ')} / ${versionsOnHost()}`);
  check('the saved conversation is still there after the update', conversationText().includes('Keep going while the tunnel drops'));
  await click('host-link-leave');
  await sleep(1500);
  await attach();
  await until('local again', `${q('remote-session')}!==null`);

  // Up to here no host stopped under a connected client. The next step stops one on purpose.
  check('never reported as a crash', !clientLog().includes('stopped unexpectedly'));
  // --- A key instead of a password, and a host restarted under a connection ----------------------
  inC(CLIENT, 'tester', "ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/id_ed25519");
  const publicKey = inC(CLIENT, 'tester', 'cat ~/.ssh/id_ed25519.pub');
  inC(HOST, 'hostuser', `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
  const keyed = await connect('trial');
  check('a key signs in without a question', keyed.connected && keyed.asked.length === 0, keyed.seen.join(' > '));
  const beforeRestart = hostPid();
  inC(HOST, 'hostuser', `kill ${beforeRestart}`);
  await until('the host back under the same client', `/^On /.test(${q('host-link')}?.textContent ?? '') && !/Disconnected/.test(${q('host-link')}?.textContent ?? '')`, 60_000);
  await sleep(6000);
  check('a stopped host is started again and the client finds its new port', hostPid() !== '' && hostPid() !== beforeRestart && /^On /.test(await ev(`${q('host-link')}?.textContent ?? ''`)), `${hostPid()} ${String(await ev(`${q('host-link')}?.textContent`))}`);
  await click('host-link-leave');
  await sleep(1500);
  await attach();
  await until('local again', `${q('remote-session')}!==null`);

  // --- A host started by hand, and no SSH server --------------------------------------------------
  inC(HOST, 'hostuser', 'rm ~/.local/share/dspatch-host/host-running.json');
  const byHand = await connect('trial');
  check('a host started by hand is not run over', !byHand.connected && /started by hand/.test(byHand.seen.at(-1) ?? ''), byHand.seen.at(-1));
  inC(CLIENT, 'tester', `printf 'Host closed\n  HostName ${hostIp()}\n  Port 2222\n  User hostuser\n' >> ~/.ssh/config`);
  const closed = await connect('closed');
  check('no SSH server reads as such', !closed.connected && /no SSH server/.test(closed.seen.at(-1) ?? ''), closed.seen.at(-1));

  // --- A changed host key is refused --------------------------------------------------------------
  inC(HOST, 'root', "rm /etc/ssh/ssh_host_*; ssh-keygen -A >/dev/null; kill -HUP $(pgrep -o sshd)");
  await sleep(1000);
  const changed = await connect('trial');
  check('a changed host key is refused, with no question', !changed.connected && /changed/.test(changed.seen.at(-1) ?? '') && !changed.asked.some((text) => /yes\/no/.test(text)), changed.seen.at(-1));
  await shot('09-changed-key');
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  check('the trial ran to its end', false, error instanceof Error ? error.message : String(error));
  await shot('failure').catch(() => undefined);
}
fs.writeFileSync(path.join(evidence, 'client.log'), clientLog());
fs.writeFileSync(path.join(evidence, 'host.log'), inC(HOST, 'hostuser', 'cat ~/.local/share/dspatch-host/host.log 2>/dev/null'));
fs.writeFileSync(path.join(evidence, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
if (!process.env['DSPATCH_TRIAL_KEEP']) {
  for (const name of [CLIENT, HOST]) {
    docker('rm', '-f', name);
  }
  docker('network', 'rm', NET);
}
const failed = results.filter((entry) => entry.ok === false);
process.stdout.write(`\n${String(results.filter((entry) => entry.ok === true).length)} passed, ${String(failed.length)} failed\n`);
process.exit(failure === null && failed.length === 0 ? 0 : 1);
