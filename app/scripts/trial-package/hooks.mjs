// @ts-nocheck: a trial script.
/**
 * The hook trial (DSP-154): over real ssh into a clean container, the host package's own Node runs
 * the packaged Copilot adapter and runtime, with synthetic hooks in that account's default
 * `~/.copilot/hooks` and the local stand-in model. No account, no model, no development repository.
 *
 *     docker build -t dspatch-trial -f scripts/trial-package/Dockerfile scripts/trial-package
 *     node scripts/trial-package/hooks.mjs
 *
 * Needs `npm run package:host -- --platform linux` first. It stays inside the containers. The
 * packaged host's own connection path is covered by run.mjs; this one shows where hooks run.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'release', 'host', 'host-manifest.json'), 'utf8'));
const hostId = manifest.hostId ?? manifest.id;
const tarball = path.join(appDir, 'release', 'host', `dspatch-host-${hostId}-linux-x64.tar.gz`);
const HOST = 'dspatch-hooks-host';
const CLIENT = 'dspatch-hooks-client';
const NET = 'dspatch-hooks-net';
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1048576 });
const inside = (name, user, script) => {
  const done = docker('exec', '-u', user, name, 'bash', '-c', script);
  if (done.status !== 0) {
    throw new Error(`${script}\n${done.stdout}\n${done.stderr}`);
  }
  return done.stdout;
};
let failures = 0;
function check(what, ok, detail = '') {
  process.stdout.write(`${ok ? 'pass' : 'FAIL'}  ${what}${detail === '' ? '' : `: ${detail}`}\n`);
  failures += ok ? 0 : 1;
}

function clean() {
  docker('rm', '-f', HOST, CLIENT);
  docker('network', 'rm', NET);
}

clean();
try {
  docker('network', 'create', NET);
  for (const name of [HOST, CLIENT]) {
    const up = docker('run', '-d', '--init', '--name', name, '--hostname', name, '--network', NET, 'dspatch-trial', 'sleep', 'infinity');
    if (up.status !== 0) {
      throw new Error(up.stderr);
    }
  }
  docker('exec', HOST, 'bash', '-c', 'ssh-keygen -A && /usr/sbin/sshd');
  docker('cp', tarball, `${HOST}:/tmp/host.tar.gz`);
  docker('cp', path.join(appDir, 'scripts', 'trial-package', 'hooks-driver.mjs'), `${HOST}:/tmp/hooks-driver.mjs`);
  docker('cp', path.join(appDir, 'tests', 'support', 'copilot-stand-in-model.ts'), `${HOST}:/tmp/stand-in.ts`);
  const home = `~/.local/share/dspatch/host/versions/${hostId}`;
  inside(HOST, 'hostuser', `mkdir -p ${home} && tar xzf /tmp/host.tar.gz --strip-components=1 -C ${home}`);
  inside(CLIENT, 'tester', "mkdir -p ~/.ssh && ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/id_ed25519");
  const key = inside(CLIENT, 'tester', 'cat ~/.ssh/id_ed25519.pub').trim();
  inside(HOST, 'hostuser', `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${key}' > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
  check('no Node and no sources on the machine', inside(HOST, 'hostuser', 'command -v node; ls -d /home/*/development 2>/dev/null; true').trim() === '');
  const run = docker('exec', '-u', 'tester', CLIENT, 'ssh', '-o', 'StrictHostKeyChecking=accept-new', `hostuser@${HOST}`, `${home}/node/bin/node /tmp/hooks-driver.mjs $(cd ${home}/app && pwd) /tmp/stand-in.ts`);
  process.stdout.write(run.stderr.split('\n').filter((line) => !/Warning|ExperimentalWarning|trace-warnings|Permanently added/.test(line)).join('\n'));
  const scenarios = Object.fromEntries(run.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => [JSON.parse(line).name, JSON.parse(line)]));
  fs.mkdirSync(path.join(appDir, 'release', 'trial-hooks'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'release', 'trial-hooks', 'scenarios.json'), `${JSON.stringify({ hostId, scenarios }, null, 2)}\n`);
  const s = (name) => scenarios[name] ?? {};
  check('an allowed read reaches the model, with both hooks run once', s('allowed').allowedAtModel === true && s('allowed').hooks?.join() === 'pre,post', JSON.stringify(s('allowed')));
  check('a denied read does not reach the model, and only the pre hook ran', s('denied read').markerAtModel === false && s('denied read').hooks?.join() === 'pre', JSON.stringify(s('denied read')));
  check('a denied command did not run', s('denied command').markerAtModel === false && s('denied command').ranMade === false, JSON.stringify(s('denied command')));
  check('a failed pre hook stops the turn', s('pre error').status === 'error' && s('pre error').allowedAtModel === false, JSON.stringify(s('pre error')));
  check('a pre hook timeout stops a command before it runs', s('pre timeout').status === 'error' && s('pre timeout').ranMade === false, JSON.stringify(s('pre timeout')));
  check('a failed post hook stops the turn and says so', s('post error').status === 'error', JSON.stringify(s('post error')));

  // --- copilot-hooks-required: the packaged host, started over SSH, in its default data folder -----
  const data = '~/.local/share/dspatch-host';
  const overSsh = (command) => docker('exec', '-u', 'tester', CLIENT, 'ssh', `hostuser@${HOST}`, command);
  const startHost = () => {
    overSsh(`nohup ${home}/node/bin/node ${home}/app/dist/host/remote-host.js > /tmp/host.log 2>&1 < /dev/null &`);
    inside(HOST, 'hostuser', `for i in $(seq 100); do test -f ${data}/host-running.json && exit 0; sleep 0.1; done; cat /tmp/host.log; exit 1`);
  };
  const stopHost = () => {
    inside(HOST, 'hostuser', `kill $(sed -n 's/.*"pid": \\([0-9]*\\).*/\\1/p' ${data}/host-running.json); for i in $(seq 100); do test -f ${data}/host-running.json || exit 0; sleep 0.1; done; exit 1`);
  };
  const opens = () => overSsh(`${home}/node/bin/node /tmp/hooks-required-driver.mjs ${home}/app $(cd ${data} && pwd)`).stdout;
  const hookFiles = (content) => inside(HOST, 'hostuser', `rm -rf ~/.copilot/hooks && mkdir -p ~/.copilot/hooks${content === null ? '' : ` && printf '%s' '${content}' > ~/.copilot/hooks/synthetic.json`}`);
  const VALID = JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: 'command', bash: 'true', timeoutSec: 2 }] } });
  docker('cp', path.join(appDir, 'scripts', 'trial-package', 'hooks-required-driver.mjs'), `${HOST}:/tmp/hooks-required-driver.mjs`);
  inside(HOST, 'root', `chmod 644 /tmp/hooks-required-driver.mjs; mkdir -p /home/hostuser/.local/share/dspatch-host && chown -R hostuser /home/hostuser/.local/share/dspatch-host`);
  inside(HOST, 'hostuser', `chmod 700 ${data} && printf '%s' '{"formatVersion":1,"agent":"copilot","chosenAtUtc":"2026-11-01T00:00:00.000Z"}' > ${data}/dspatch-agent-choice.json`);
  const REFUSED = /requires managed Copilot hooks/;
  const SIGN_IN = /not signed in/;
  inside(HOST, 'hostuser', `touch ${data}/copilot-hooks-required`);
  startHost();
  const hostPid = () => inside(HOST, 'hostuser', `sed -n 's/.*"pid": \\([0-9]*\\).*/\\1/p' ${data}/host-running.json`).trim();
  check('the host started over SSH has no DSpatch or Copilot variable', inside(HOST, 'hostuser', `tr '\\0' '\\n' < /proc/${hostPid()}/environ | grep -c -E '^(DSPATCH_|COPILOT_)' || true`).trim() === '0');
  hookFiles(VALID);
  let answer = opens();
  check('the file and a valid pre hook: the session passes, to the sign-in', SIGN_IN.test(answer), answer);
  hookFiles(null);
  answer = opens();
  check('the file and no hook: refused before anything is sent', REFUSED.test(answer), answer);
  hookFiles('{ this is not a hook file');
  answer = opens();
  check('the file and a broken hook file: refused', REFUSED.test(answer), answer);
  hookFiles(VALID);
  inside(HOST, 'hostuser', 'chmod 000 ~/.copilot/hooks/synthetic.json');
  answer = opens();
  check('the file and an unreadable hook file: refused', REFUSED.test(answer), answer);
  hookFiles(null);
  inside(HOST, 'hostuser', `rm ${data}/copilot-hooks-required && ln -s ${data}/nowhere ${data}/copilot-hooks-required`);
  answer = opens();
  check('a link that leads nowhere still requires hooks', REFUSED.test(answer), answer);
  const pid = hostPid();
  inside(HOST, 'hostuser', `rm ${data}/copilot-hooks-required`);
  answer = opens();
  check('removed on the running host: the ordinary behaviour at the next session', SIGN_IN.test(answer), answer);
  inside(HOST, 'hostuser', `touch ${data}/copilot-hooks-required`);
  answer = opens();
  check('added on the running host: refused at the next session', REFUSED.test(answer), answer);
  check('all of that without a host restart', hostPid() === pid, pid);
  stopHost();
  inside(HOST, 'hostuser', `rm ${data}/copilot-hooks-required`);
  startHost();
  answer = opens();
  check('without the file and without hooks, on a new host: the ordinary behaviour', SIGN_IN.test(answer), answer);
  stopHost();
} finally {
  clean();
}
process.stdout.write(failures === 0 ? 'hook trial: all passed\n' : `hook trial: ${String(failures)} failed\n`);
process.exit(failures === 0 ? 0 : 1);
