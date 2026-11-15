/**
 * The Linux helper of DSP-214, `remote-setup/dspatch-prepare-linux-client.sh`, run for real in a
 * temporary HOME. What matters to a person: it never overwrites or prints a private key, it creates
 * a key only when there is none, and it prints the command to run on Windows. `ssh-keygen` is the
 * real one, wrapped so that a new key gets no passphrase; `ip` is a stub with documentation
 * addresses. The person's own ~/.ssh is never touched.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const HELPER = path.join(import.meta.dirname, '..', 'remote-setup', 'dspatch-prepare-linux-client.sh');
const skip = process.platform === 'win32' ? 'bash and ssh-keygen are Linux tools here' : false;

function workspace(context: test.TestContext): { home: string; ssh: string; run: (...args: string[]) => { stdout: string; stderr: string; status: number | null } } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-linux-helper-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  const keygen = execFileSync('sh', ['-c', 'command -v ssh-keygen'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    path.join(bin, 'ssh-keygen'),
    `#!/bin/sh\nfor a in "$@"; do if [ "$a" = "-t" ]; then exec ${keygen} -q -N '' "$@"; fi; done\nexec ${keygen} "$@"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, 'ip'),
    '#!/bin/sh\ncase "$*" in\n  "route get 192.0.2.10") echo "192.0.2.10 dev eth0 src 192.0.2.55 uid 1000";;\n  *brief*) echo "lo UNKNOWN 127.0.0.1/8"; echo "eth0 UP 192.0.2.55/24";;\nesac\n',
    { mode: 0o755 },
  );
  const env = { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: home, USER: 'tester', LANG: 'C' };
  return {
    home,
    ssh: path.join(home, '.ssh'),
    run: (...args) => {
      const result = spawnSync('bash', [HELPER, ...args], { env, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
      return { stdout: result.stdout, stderr: result.stderr, status: result.status };
    },
  };
}

/** The base64 lines of a private key file: none of them may ever be printed. */
function privateBody(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 20 && !line.startsWith('-----'));
}

function makeKey(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'existing', '-f', file]);
}

test('with no key it creates id_ed25519, prints only the public key and the Windows command', { skip }, (context) => {
  const { ssh, run } = workspace(context);
  const first = run('winuser@192.0.2.10');
  assert.equal(first.status, 0, first.stderr);
  const pub = fs.readFileSync(path.join(ssh, 'id_ed25519.pub'), 'utf8').trim();
  assert.match(pub, /^ssh-ed25519 [A-Za-z0-9+/]+=* tester@/);
  assert.ok(first.stdout.includes(`  ${pub}\n`), 'the public key line is printed');
  assert.ok(first.stdout.includes(`.\\dspatch-prepare-windows-host.ps1 -PublicKey '${pub}' -AllowFrom 192.0.2.55 -User 'winuser'`));
  assert.ok(first.stdout.includes('ssh winuser@192.0.2.10'));
  const output = first.stdout + first.stderr;
  for (const line of privateBody(path.join(ssh, 'id_ed25519'))) {
    assert.ok(!output.includes(line), 'no part of the private key is printed');
  }
  assert.doesNotMatch(output, /PRIVATE KEY/);

  // Again: the same key, nothing created or changed.
  const before = fs.readFileSync(path.join(ssh, 'id_ed25519'));
  const again = run('winuser@192.0.2.10');
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(fs.readFileSync(path.join(ssh, 'id_ed25519')), before);
  assert.ok(again.stdout.includes(`  ${pub}\n`));
  assert.deepEqual(fs.readdirSync(ssh).sort(), ['id_ed25519', 'id_ed25519.pub']);
});

test('an existing id_ed25519 is used as it is, never overwritten', { skip }, (context) => {
  const { ssh, run } = workspace(context);
  makeKey(path.join(ssh, 'id_ed25519'));
  const privateBytes = fs.readFileSync(path.join(ssh, 'id_ed25519'));
  const publicBytes = fs.readFileSync(path.join(ssh, 'id_ed25519.pub'));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(ssh, 'id_ed25519')), privateBytes);
  assert.deepEqual(fs.readFileSync(path.join(ssh, 'id_ed25519.pub')), publicBytes);
  assert.ok(result.stdout.includes(publicBytes.toString('utf8').trim()));
  for (const line of privateBody(path.join(ssh, 'id_ed25519'))) {
    assert.ok(!(result.stdout + result.stderr).includes(line));
  }
  // Without a host: the addresses are listed and the command keeps its placeholders.
  assert.match(result.stdout, /eth0 UP 192\.0\.2\.55\/24/);
  assert.ok(result.stdout.includes("-AllowFrom <this-computer-ip> -User '<windows-user>'"));
});

test('a private key without its .pub gets the .pub derived, the private key unchanged', { skip }, (context) => {
  const { ssh, run } = workspace(context);
  makeKey(path.join(ssh, 'id_ed25519'));
  fs.rmSync(path.join(ssh, 'id_ed25519.pub'));
  const privateBytes = fs.readFileSync(path.join(ssh, 'id_ed25519'));
  const result = run('192.0.2.10');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(ssh, 'id_ed25519')), privateBytes);
  const derived = fs.readFileSync(path.join(ssh, 'id_ed25519.pub'), 'utf8').trim();
  assert.equal(derived.split(' ').slice(0, 2).join(' '), execFileSync('ssh-keygen', ['-y', '-f', path.join(ssh, 'id_ed25519')], { encoding: 'utf8' }).trim().split(' ').slice(0, 2).join(' '));
  assert.ok(result.stdout.includes(derived));
  for (const line of privateBody(path.join(ssh, 'id_ed25519'))) {
    assert.ok(!(result.stdout + result.stderr).includes(line));
  }
});

test('an id_rsa.pub is used, and no new key is made beside it', { skip }, (context) => {
  const { ssh, run } = workspace(context);
  fs.mkdirSync(ssh, { mode: 0o700 });
  execFileSync('ssh-keygen', ['-q', '-t', 'rsa', '-b', '2048', '-N', '', '-C', 'rsa-key', '-f', path.join(ssh, 'id_rsa')]);
  const result = run('winuser@192.0.2.10');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(path.join(ssh, 'id_ed25519')));
  assert.ok(result.stdout.includes(fs.readFileSync(path.join(ssh, 'id_rsa.pub'), 'utf8').trim()));
});
