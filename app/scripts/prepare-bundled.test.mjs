import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareBundled } from './prepare-bundled.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-test-'));
  const app = path.join(root, 'app');
  const revision = '123456789abc123456789abc123456789abc1234';
  const hostId = `0.1.3-${revision.slice(0, 12)}`;
  const hostDir = path.join(app, 'release', 'host');
  const bundled = path.join(app, 'build', 'bundled');
  for (const folder of ['docs/loop', '.dspatch/loops', 'app/dist', 'app/release/host', 'app/claude-support', 'app/copilot-support']) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ version: '0.1.3' }));
  fs.writeFileSync(path.join(app, 'dist', 'build-identity.json'), JSON.stringify({ git: { revision } }));
  for (const support of ['claude-support', 'copilot-support']) {
    for (const file of ['package.json', 'package-lock.json']) {
      fs.writeFileSync(path.join(app, support, file), '{}');
    }
  }
  const bytes = Buffer.from('synthetic host archive');
  const packages = ['linux', 'win32'].map((platform) => ({
    platform, arch: 'x64', file: `dspatch-host-${hostId}-${platform}-x64.tar.gz`,
    sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
  }));
  for (const entry of packages) fs.writeFileSync(path.join(hostDir, entry.file), bytes);
  const manifest = { format: 1, hostId, appVersion: '0.1.3', commit: revision.slice(0, 12), packages };
  const save = () => fs.writeFileSync(path.join(hostDir, 'host-manifest.json'), JSON.stringify(manifest));
  save();
  const [linux, windows] = packages;
  assert.ok(linux && windows);
  return { root, app, hostDir, bundled, manifest, bytes, save, linux, windows };
}

for (const both of [false, true]) {
  test(`bundles every declared archive (${both ? 'Linux and Windows' : 'Linux only'})`, (context) => {
    const setup = fixture();
    context.after(() => fs.rmSync(setup.root, { recursive: true, force: true }));
    if (!both) setup.manifest.packages = setup.manifest.packages.slice(0, 1);
    setup.save();
    prepareBundled(setup.app);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(setup.bundled, 'host-manifest.json'), 'utf8')), setup.manifest);
    assert.deepEqual(fs.readdirSync(path.join(setup.bundled, 'host-packages')).sort(), setup.manifest.packages.map((entry) => entry.file).sort());
    for (const entry of setup.manifest.packages) {
      assert.deepEqual(fs.readFileSync(path.join(setup.bundled, 'host-packages', entry.file)), setup.bytes);
    }
  });
}

/** @type {Record<string, (setup: ReturnType<typeof fixture>) => void>} */
const failures = {
  'missing manifest': (setup) => fs.unlinkSync(path.join(setup.hostDir, 'host-manifest.json')),
  'malformed JSON': (setup) => fs.writeFileSync(path.join(setup.hostDir, 'host-manifest.json'), '{'),
  'null manifest': (setup) => fs.writeFileSync(path.join(setup.hostDir, 'host-manifest.json'), 'null'),
  'empty packages': (setup) => { setup.manifest.packages = []; setup.save(); },
  'missing archive': (setup) => fs.unlinkSync(path.join(setup.hostDir, setup.windows.file)),
  'same-size corrupt archive': (setup) => fs.writeFileSync(path.join(setup.hostDir, setup.linux.file), Buffer.alloc(setup.bytes.length)),
  'wrong size': (setup) => { setup.linux.size++; setup.save(); },
  'unsafe host ID': (setup) => { setup.manifest.hostId = '../outside'; setup.save(); },
  'unsafe filename': (setup) => { setup.linux.file = '../outside.tar.gz'; setup.save(); },
  'Windows path filename': (setup) => { setup.linux.file = 'C:\\outside.tar.gz'; setup.save(); },
  'invalid hash': (setup) => { setup.linux.sha256 = 'invalid'; setup.save(); },
  'duplicate package': (setup) => { setup.manifest.packages.push(setup.linux); setup.save(); },
  'wrong version': (setup) => { setup.manifest.appVersion = '0.1.2'; setup.save(); },
  'wrong commit': (setup) => { setup.manifest.commit = 'abcdefabcdef'; setup.save(); },
  'missing native package': (setup) => { setup.manifest.packages = setup.manifest.packages.filter((entry) => entry.platform !== process.platform); setup.save(); },
  'symlink archive': (setup) => {
    const file = path.join(setup.hostDir, setup.linux.file);
    fs.renameSync(file, `${file}.real`);
    fs.symlinkSync(`${file}.real`, file);
  },
};
for (const [name, corrupt] of Object.entries(failures)) {
  test(`refuses ${name} without leaving a stale bundle`, (context) => {
    const setup = fixture();
    context.after(() => fs.rmSync(setup.root, { recursive: true, force: true }));
    fs.mkdirSync(setup.bundled, { recursive: true });
    fs.writeFileSync(path.join(setup.bundled, 'host-manifest.json'), 'stale');
    corrupt(setup);
    assert.throws(() => prepareBundled(setup.app));
    assert.equal(fs.existsSync(setup.bundled), false);
  });
}