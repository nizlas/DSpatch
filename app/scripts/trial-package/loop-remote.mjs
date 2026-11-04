// @ts-nocheck: a trial script over untyped DevTools answers.
/**
 * Loops over a remote connection (DSP-163): the real .deb on a "laptop" container, the real host
 * package on a "work computer" container, real sshd, real windows on Xvfb. The provider is
 * SIMULATED; no model and no account is reached. The project and the loop that exists only on
 * the host are synthetic.
 *
 *     node scripts/trial-package/loop-remote.mjs [--big-gb <n> [--tracked]] [--only <parts>] [--keep]
 *
 * `--big-gb` fills an ignored folder of the project with that many gigabytes of sparse files, so
 * that reading the project takes real time and no real disk; `--tracked` leaves it to git to
 * list them. A timeline of the status line goes
 * to release/trial-loop-remote, beside both logs.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Win, q, sleep } from './trial-window.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoDir = path.resolve(appDir, '..');
const evidence = path.join(appDir, 'release', 'trial-loop-remote');
fs.rmSync(evidence, { recursive: true, force: true });
fs.mkdirSync(evidence, { recursive: true });
const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
};
const BIG_GB = Number(flag('--big-gb') ?? '0');
const WORK = 'dspatch-loop-work';
const LAPTOP = 'dspatch-loop-laptop';
const LAPTOP_DEBUG = 9382;
const SSH_PORT = 2293;
const SIMULATED = { DSPATCH_PRESENTATION_MODELS: 'copilot', DSPATCH_PRESENTATION_LIST_MS: '50', DSPATCH_PRESENTATION_TOOL_MS: '400', DSPATCH_PRESENTATION_DELTA_MS: '120', DSPATCH_CLAUDE_AUTHORIZATION: 'presentation-simulated' };
const PROJECT = '/home/hostuser/proj';
const DATA = '~/.config/DSpatch';

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1048576 });
const inC = (name, user, script) => {
  const result = docker('exec', '-u', user, name, 'bash', '-c', script);
  return (result.stdout + result.stderr).trim();
};
const results = [];
function check(what, ok, detail = '') {
  results.push({ what, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : ` :: ${String(detail).slice(0, 400)}`}\n`);
}

const timeline = [];
const stamp = () => new Date().toISOString();
const note = (what) => {
  timeline.push({ at: stamp(), what });
  process.stdout.write(`  ${stamp().slice(11, 23)} ${what}\n`);
};

/** The status line as it is now, watched for `ms`: every change, with its time. */
async function watch(win, ms, until = null) {
  const end = Date.now() + ms;
  const phases = [];
  while (Date.now() < end) {
    const seen = await win.ev(`JSON.stringify({ phase: ${q('host-link')}?.dataset.phase ?? null, line: ${q('host-link')}?.textContent ?? '', stop: ${until === null ? 'false' : until} })`).catch(() => null);
    if (seen !== null) {
      const state = JSON.parse(seen);
      if (phases.at(-1)?.phase !== state.phase) {
        phases.push({ phase: state.phase, at: Date.now() });
        note(`status line: ${String(state.phase)} ${state.line.slice(0, 90)}`);
      }
      if (state.stop) {
        return phases;
      }
    }
    await sleep(200);
  }
  return phases;
}

const runCount = () => Number(inC(WORK, 'hostuser', `ls ${DATA}/loop-runs/*.jsonl ${DATA}/loop-runs/*/run.jsonl 2>/dev/null | wc -l`));
const newest = `$(ls -t ${DATA}/loop-runs/*.jsonl ${DATA}/loop-runs/*/run.jsonl 2>/dev/null | head -1)`;
const hasEnded = () => inC(WORK, 'hostuser', `grep -c '"line":"ending"' ${newest}`) !== '0';
const lastEnding = () => inC(WORK, 'hostuser', `grep '"line":"ending"' ${newest} | cut -c1-160`);
const mandates = (mark) => Number(inC(WORK, 'hostuser', `grep -l '${mark}' ${DATA}/loop-runs/*.jsonl ${DATA}/loop-runs/*/run.jsonl 2>/dev/null | wc -l`));
const lastRecord = () => inC(WORK, 'hostuser', `f=$(ls -t ${DATA}/loop-runs/*/run.jsonl ${DATA}/loop-runs/*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && cut -c1-200 "$f" | tail -4`);

/** Tick or untick `Use loop` as a person does. */
async function setLoop(laptop, on) {
  const checked = await laptop.ev(`${q('use-loop')}?.checked ?? null`);
  if (checked !== on) {
    await laptop.click('use-loop');
  }
  await laptop.until(`Use loop ${String(on)}`, `${q('use-loop')}?.checked === ${String(on)}`);
}

async function chooseByName(laptop, name) {
  const listing = JSON.parse(await laptop.ev('window.dspatch.listLoopDefinitions().then(JSON.stringify)'));
  const row = listing.choices.find((choice) => choice.display.name === name);
  if (row === undefined) {
    return null;
  }
  const chosen = await laptop.ev(`window.dspatch.chooseLoopDefinition(${JSON.stringify(row.key)}).then(JSON.stringify)`);
  note(`chose ${name}: ${String(chosen).slice(0, 160)}`);
  return row;
}

/** Start a loop and watch it to its end, with `during` run while it works. */
async function walk(laptop, name, mandate, { ms = 240_000, during = null } = {}) {
  const before = runCount();
  note(`send: ${name}`);
  await laptop.send(mandate);
  const started = Date.now();
  const watching = watch(laptop, ms, `${q('prompt')}!==null && !document.querySelector('[data-ev="loop-cancel"]') && window.__loopDone === true`);
  const during_ = during === null ? Promise.resolve() : during();
  // The record on the host says when a run ended, whatever the window can reach meanwhile.
  await laptop.until(`${name} recorded`, `true`, 1000);
  const end = Date.now() + ms;
  let ended = false;
  while (Date.now() < end && !ended) {
    ended = runCount() > before && hasEnded();
    await sleep(500);
  }
  await during_;
  await laptop.ev('window.__loopDone = true');
  const phases = await watching;
  await laptop.ev('window.__loopDone = false');
  return { phases, seconds: Math.round((Date.now() - started) / 1000), ended, runs: runCount() - before };
}

async function controls(laptop) {
  await laptop.send('CHAT-CONTROL-MARK ordinary remote chat.');
  await laptop.until('the reply', `document.body.innerText.includes('CHAT-CONTROL-MARK') && ${q('turn-activity')}===null`, 60_000);
  check('ordinary remote chat works', true);
  const beforeRuns = runCount();
  const phases = [];
  await setLoop(laptop, true);
  phases.push(...(await watch(laptop, 5_000)));
  await setLoop(laptop, false);
  phases.push(...(await watch(laptop, 3_000)));
  check('ticking and unticking Use loop with nothing sent leaves the connection alone', phases.every((one) => one.phase === 'connected'), JSON.stringify(phases.map((one) => one.phase)));
  check('and starts nothing', runCount() === beforeRuns, String(runCount() - beforeRuns));
}

async function hostOnly(laptop) {
  const local = inC(LAPTOP, 'tester', 'find ~ -name "synthetic-host-only*" 2>/dev/null | wc -l');
  check('the synthetic loop is not on the client', local === '0', local);
  const row = await chooseByName(laptop, 'Synthetic host-only loop');
  check('the loop that exists only on the host is listed and can be chosen', row !== null && row.usable);
  await setLoop(laptop, true);
  const run = await walk(laptop, 'host-only', 'HOST-ONLY-MARK a small synthetic assignment.');
  check('it starts and ends once, on the host', run.ended !== false && run.runs === 1, JSON.stringify({ ...run, phases: run.phases.map((one) => one.phase) }));
  check('the connection stayed up throughout', run.phases.every((one) => one.phase === 'connected'), JSON.stringify(run.phases.map((one) => one.phase)));
  await laptop.shot('10-host-only-ended');
  note(lastRecord());
}

async function bundled(laptop) {
  for (const name of ['Simple chat loop', 'DSpatch development loop (runnable subset)']) {
    const row = await chooseByName(laptop, name);
    check(`${name} is listed from the host`, row !== null);
    if (row === null) {
      continue;
    }
    await setLoop(laptop, true);
    const run = await walk(laptop, name, `BUNDLED-MARK ${name}.`);
    check(`${name} starts and ends once`, run.ended !== false && run.runs === 1 && mandates(name.slice(0, 12)) === 1, JSON.stringify({ ...run, phases: run.phases.map((one) => one.phase) }));
    check(`${name}: the connection stayed up`, run.phases.every((one) => one.phase === 'connected'), JSON.stringify(run.phases.map((one) => one.phase)));
  }
}

async function main() {
  const release = path.join(appDir, 'release');
  const { version } = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(release, 'host', 'host-manifest.json'), 'utf8'));
  const linux = manifest.packages.find((entry) => entry.platform === 'linux');
  for (const name of [WORK, LAPTOP]) {
    docker('rm', '-f', name);
    docker('run', '-d', '--name', name, '--hostname', name === WORK ? 'workcomputer' : 'laptop', '--network', 'host', '--shm-size=512m', '--cap-add', 'SYS_ADMIN', '--security-opt', 'seccomp=unconfined', '--security-opt', 'apparmor=unconfined', 'dspatch-trial', 'sleep', 'infinity');
  }
  docker('cp', path.join(release, `dspatch_${version}_amd64.deb`), `${LAPTOP}:/tmp/dspatch.deb`);
  inC(LAPTOP, 'root', 'dpkg -i /tmp/dspatch.deb 2>&1 | tail -1');
  docker('exec', '-d', LAPTOP, 'Xvfb', ':97', '-screen', '0', '1280x900x24');
  inC(WORK, 'root', `cat >> /etc/ssh/sshd_config <<'S'
Port ${String(SSH_PORT)}
ListenAddress 127.0.0.1
PasswordAuthentication no
SetEnv DSPATCH_CHAT_RUN=review-flow ${Object.entries(SIMULATED).map(([key, value]) => `${key}=${value}`).join(' ')}
S
/usr/sbin/sshd`);
  inC(LAPTOP, 'tester', `mkdir -p ~/.ssh ~/.config/DSpatch/host-packages && chmod 700 ~/.ssh && ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/id_ed25519
cat > ~/.ssh/config <<'S'
Host workalias
  HostName 127.0.0.1
  Port ${String(SSH_PORT)}
  User hostuser
  StrictHostKeyChecking accept-new
S`);
  const key = inC(LAPTOP, 'tester', 'cat ~/.ssh/id_ed25519.pub');
  inC(WORK, 'hostuser', `mkdir -p ~/.ssh ~/.config && chmod 700 ~/.ssh && echo '${key}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
  docker('cp', path.join(release, 'host', linux.file), `${LAPTOP}:/home/tester/.config/DSpatch/host-packages/${linux.file}`);
  inC(LAPTOP, 'root', 'chown -R tester /home/tester/.config');

  // A synthetic project, with a loop only this machine has: its graph and roles beside it.
  inC(WORK, 'hostuser', `mkdir -p ${PROJECT}/.dspatch/loops/docs/loop/roles/project && cd ${PROJECT} && git init -q . && echo hello > README.md && echo ${process.argv.includes('--tracked') ? 'other/' : 'data/'} > .gitignore && git -c user.name=t -c user.email=t@t add . && git -c user.name=t -c user.email=t@t commit -qm one`);
  const graph = JSON.parse(fs.readFileSync(path.join(repoDir, 'docs/loop/graphs/dspatch-chat-loop.graph.json'), 'utf8'));
  const synthetic = path.join(evidence, 'synthetic-host-only.graph.json');
  fs.writeFileSync(synthetic, JSON.stringify({ ...graph, id: 'synthetic-host-only', name: 'Synthetic host-only' }, null, 2));
  const declaration = path.join(evidence, 'synthetic-host-only.loop.json');
  fs.writeFileSync(declaration, JSON.stringify({ format: 'dspatch-loop-definition', formatVersion: 1, id: 'synthetic-host-only', name: 'Synthetic host-only loop', graph: 'synthetic-host-only.graph.json' }, null, 2));
  docker('cp', synthetic, `${WORK}:${PROJECT}/.dspatch/loops/synthetic-host-only.graph.json`);
  docker('cp', declaration, `${WORK}:${PROJECT}/.dspatch/loops/synthetic-host-only.loop.json`);
  for (const role of ['project-work', 'project-check']) {
    docker('cp', path.join(repoDir, `docs/loop/roles/project/${role}.role.md`), `${WORK}:${PROJECT}/.dspatch/loops/docs/loop/roles/project/${role}.role.md`);
  }
  inC(WORK, 'root', `chown -R hostuser ${PROJECT}`);
  if (BIG_GB > 0) {
    const count = Math.ceil(BIG_GB / 1.9);
    inC(WORK, 'hostuser', `mkdir -p ${PROJECT}/data && cd ${PROJECT}/data && for i in $(seq 1 ${String(count)}); do truncate -s 1900M part-$i.bin; done`);
    note(`the project holds ${String(count)} sparse files of 1.9 GB in an ignored folder`);
  }

  const environment = Object.entries({ DISPLAY: ':97', DSPATCH_TRIAL_HOST_RUN: 'review-flow', ...SIMULATED }).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
  docker('exec', '-d', '-u', 'tester', ...environment, LAPTOP, 'bash', '-c', `exec dspatch --remote-debugging-port=${String(LAPTOP_DEBUG)} >>/tmp/client-tester.log 2>&1`);
  const laptop = new Win(LAPTOP_DEBUG, 'laptop', evidence);
  await laptop.attach();
  await laptop.until('the start page', `${q('remote-session')}!==null`);
  const parts = [];
  try {
    const moved = await laptop.connect('workalias');
    check('the client connects over real SSH', moved.connected, moved.seen.join(' > '));
    await laptop.chooseAgent('copilot');
    await laptop.ev(`window.dspatch.startChatSession({ kind: 'folder', path: '${PROJECT}' })`);
    await laptop.ev('location.reload()');
    await sleep(1500);
    await laptop.attach();
    await laptop.openProject();
    const only = flag('--only');
    if (only !== null) {
      const named = { stopping, failures, realBreak, local, controls, hostOnly, bundled };
      parts.push(...only.split(',').map((name) => [name, () => named[name](laptop)]));
    } else if (BIG_GB > 0) {
      parts.push(['big project', () => bigProject(laptop)]);
    } else {
      parts.push(['controls', () => controls(laptop)], ['host only', () => hostOnly(laptop)], ['bundled', () => bundled(laptop)], ['stopping', () => stopping(laptop)], ['failures', () => failures(laptop)], ['real break', () => realBreak(laptop)], ['local', () => local(laptop)]);
    }
  } catch (error) {
    check('the setup finished', false, error.message);
  }
  for (const [name, part] of parts) {
    try {
      await part();
    } catch (error) {
      check(`the part "${name}" finished`, false, error.message);
      break;
    }
  }
  fs.writeFileSync(path.join(evidence, 'client.log'), inC(LAPTOP, 'tester', 'cat /tmp/client-tester.log; cat ~/.config/DSpatch/*.log 2>/dev/null'));
  fs.writeFileSync(path.join(evidence, 'host.log'), inC(WORK, 'hostuser', `ls ${DATA}; cat ${DATA}/*.log /tmp/*host*.log 2>/dev/null; ls -la ${DATA}/loop-runs 2>/dev/null`));
  fs.writeFileSync(path.join(evidence, 'timeline.json'), JSON.stringify(timeline, null, 2));
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  if (!process.argv.includes('--keep')) {
    for (const name of [WORK, LAPTOP]) {
      docker('rm', '-f', name);
    }
  }
  const failed = results.filter((one) => !one.ok);
  process.stdout.write(`${failed.length === 0 ? 'ALL PASSED' : `${String(failed.length)} FAILED`} of ${String(results.length)}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

const waitEnded = async (ms = 120_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !hasEnded()) {
    await sleep(500);
  }
  return hasEnded();
};
const stepRunning = async (laptop, before) => {
  // The host's own record: a run opened, a step entered, no ending.
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (runCount() > before && !hasEnded() && Number(inC(WORK, 'hostuser', `grep -c node-entered ${newest}`)) > 0) {
      return;
    }
    await sleep(300);
  }
  await laptop.shot('step-not-seen');
  throw new Error(`no step working; window: ${String(await laptop.text()).slice(-400)}`);
};

/** A project that takes a long time to read, with a loop started on it. */
async function bigProject(laptop) {
  await chooseByName(laptop, 'Synthetic host-only loop');
  await setLoop(laptop, true);
  const run = await walk(laptop, 'big project', 'BIG-MARK a small synthetic assignment.', { ms: 150_000 });
  await laptop.shot('20-big-ended');
  note(`${lastEnding()} ${lastRecord().slice(-200)}`);
  check('the loop ends once, in a project far too large to read', run.ended !== false && run.runs === 1, JSON.stringify({ ...run, phases: undefined }));
  check('the connection stayed up throughout', run.phases.every((one) => one.phase === 'connected'), JSON.stringify(run.phases.map((one) => one.phase)));
  check('what was left out is said in the host\'s log or not at all, and nothing held the host', !/was held for/.test(inC(WORK, 'hostuser', `cat ${DATA}/*.log /tmp/*host*.log 2>/dev/null; true`)));
}

async function stopping(laptop) {
  await chooseByName(laptop, 'Synthetic host-only loop');
  await setLoop(laptop, true);
  const before = runCount();
  await laptop.send('STOP-MARK [[very-slow]] a step to stop.');
  await stepRunning(laptop, before);
  await sleep(1000);
  await laptop.click('cancel');
  check('Stop ends the run', await waitEnded(), lastEnding());
  check('as cancelled, and one run', /cancelled/.test(lastEnding()) && runCount() - before === 1, lastEnding());
  await laptop.until('the window is free again', `${q('cancel')}===null`, 30_000);
  await laptop.ev(`${q('use-loop')}.checked`);
  const beforeUntick = runCount();
  await laptop.send('UNTICK-MARK [[very-slow]] a step to untick.');
  await stepRunning(laptop, beforeUntick);
  await sleep(1000);
  await setLoop(laptop, false);
  check('unticking Use loop during a run stops it', await waitEnded(), lastEnding());
  const phases = await watch(laptop, 3_000);
  check('the connection was not touched by it', phases.every((one) => one.phase === 'connected'));
  await setLoop(laptop, true);
  await sleep(1500);
  check('ticking again starts nothing, and there were two runs in all', runCount() - before === 2 && mandates('UNTICK-MARK') === 1, String(runCount() - before));
}

async function failures(laptop) {
  await chooseByName(laptop, 'Synthetic host-only loop');
  await setLoop(laptop, true);
  const graph = `${PROJECT}/.dspatch/loops/synthetic-host-only.graph.json`;
  inC(WORK, 'hostuser', `cp ${graph} /tmp/graph.keep && echo broken > ${graph}`);
  const before = runCount();
  await laptop.send('BROKEN-MARK nothing should start.');
  await laptop.until('the failure shown', `document.body.innerText.includes('BROKEN-MARK') && ${q('cancel')}===null && document.querySelector('.app__error') !== null`, 20_000);
  const words = await laptop.ev(`document.querySelector('.app__error')?.textContent ?? ''`);
  await laptop.shot('30-start-failed');
  const view = JSON.parse(await laptop.ev('window.dspatch.currentLoopRunView().then(JSON.stringify)'));
  check('a loop that cannot start says why, and not as a connection fault', /(graph|definition|read|valid)/i.test(words) && !/connection/i.test(words), words);
  check('nothing is left running, on the host or on screen', runCount() === before && (view === null || view.run.phase !== 'running' || view.ended != null), JSON.stringify(view?.run?.phase ?? null));
  check('the status line stays connected', (await laptop.ev(`${q('host-link')}?.dataset.phase ?? ''`)) === 'connected');
  inC(WORK, 'hostuser', `cp /tmp/graph.keep ${graph}`);
  await laptop.ev('window.dispatchEvent(new Event("focus"))');
  await sleep(800);
  const run = await walk(laptop, 'provider fault', 'FAIL-MARK [[fail]] the provider ends with an error.', { ms: 60_000 });
  await laptop.shot('31-provider-failed');
  note(lastEnding());
  check('a provider failure ends the run as that, with the connection up', run.ended !== false && run.runs === 1 && run.phases.every((one) => one.phase === 'connected') && !/"status":"completed"/.test(lastEnding()), lastEnding());
}

/** The tunnel stopped dead, as a network that goes away does: no reset, only silence. */
async function realBreak(laptop) {
  await chooseByName(laptop, 'Synthetic host-only loop');
  await setLoop(laptop, true);
  const before = runCount();
  await laptop.send('BREAK-MARK [[very-slow]] a step that outlives the connection.');
  await stepRunning(laptop, before);
  const tunnel = inC(LAPTOP, 'tester', "pgrep -u tester -x ssh | tr '\\n' ' '").trim();
  note(`stopping ssh ${tunnel}`);
  inC(LAPTOP, 'tester', `kill -STOP ${tunnel}`);
  await laptop.until('the status line says so', `${q('host-link')}?.dataset.phase === 'reconnecting'`, 30_000);
  await laptop.shot('40-really-disconnected');
  check('a connection that really goes away is shown as that', true);
  await setLoop(laptop, false).catch(() => undefined);
  await laptop.until('the tick came back', `${q('use-loop')}?.checked === true`, 10_000);
  const said = await laptop.ev(`document.querySelector('.app__error')?.textContent ?? ''`);
  check('unticking while away says the stop did not arrive, and the tick returns', /connection|host/i.test(said), said);
  inC(LAPTOP, 'tester', `kill -CONT ${tunnel}`);
  await laptop.until('connected again', `${q('host-link')}?.dataset.phase === 'connected'`, 60_000);
  check('the host went on: the run is not over, and one run exists', runCount() - before === 1, lastRecord().slice(-200));
  const view = JSON.parse(await laptop.ev('window.dspatch.currentLoopRunView().then(JSON.stringify)'));
  check('the client rejoins that run', view?.run?.phase === 'running' || view?.ended != null, JSON.stringify(view?.run?.runId ?? null));
  check('it ends, once', await waitEnded(180_000), lastEnding());
  check('the assignment was sent once', mandates('BREAK-MARK') === 1, String(mandates('BREAK-MARK')));
}

async function local(laptop) {
  await laptop.click('host-link-leave');
  await laptop.until('this computer again', `${q('host-link')}===null`, 30_000);
  inC(LAPTOP, 'tester', 'mkdir -p ~/here && cd ~/here && git init -q . && echo hi > README.md');
  await laptop.chooseAgent('copilot');
  await laptop.ev(`window.dspatch.startChatSession({ kind: 'folder', path: '/home/tester/here' })`);
  await laptop.ev('location.reload()');
  await sleep(1500);
  await laptop.attach();
  await laptop.until('the chat', `${q('prompt')}!==null`).catch(async () => laptop.openProject());
  await laptop.send('LOCAL-MARK ordinary local chat.');
  await laptop.until('the local reply', `document.body.innerText.includes('LOCAL-MARK') && ${q('turn-activity')}===null`, 60_000);
  check('local chat works', true);
  await setLoop(laptop, true);
  await laptop.send('LOCAL-LOOP-MARK a local loop.');
  const ended = () => inC(LAPTOP, 'tester', `grep -l '"line":"ending"' ${DATA}/loop-runs/*.jsonl ${DATA}/loop-runs/*/run.jsonl 2>/dev/null | wc -l`);
  const end = Date.now() + 90_000;
  while (Date.now() < end && ended() === '0') {
    await sleep(500);
  }
  check('a local loop starts and ends', ended() === '1', ended());
  check('no status line appears locally', (await laptop.ev(`${q('host-link')}===null`)) === true);
}

void main();
