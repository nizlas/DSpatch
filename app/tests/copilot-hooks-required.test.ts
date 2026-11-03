import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COPILOT_CHAT_POLICY, COPILOT_HOOKS_REQUIRED_FILE, CopilotSdkAdapter, copilotHooksRequired } from '../src/adapter/copilot-sdk-adapter.ts';
import { HostConnection } from '../src/main/host-connection.ts';
import { HOST_CONFIG_ENV, type HostStartConfig } from '../src/shared/host-protocol.ts';
import { makeHookFixture, type HookFixture } from './support/copilot-hook-fixture.ts';
import { forkHost } from './support/forked-host.ts';
import { startStandInModel, type StandInModel } from './support/copilot-stand-in-model.ts';

/*
 * `copilot-hooks-required` from a host's data folder, all the way (DSP-154). The real host
 * process reads the file and the real runtime reports the hooks, with an isolated home and no
 * login, so a session that passes the requirement stops at sign-in. That a passed session then
 * works is shown on the adapter with the stand-in model, since no launch setting reaches one.
 * The packaged host over SSH is `scripts/trial-package/hooks.mjs`.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NO_SENDER = { senderId: null };
const REFUSED = /requires managed Copilot hooks/;
const SIGN_IN = /not signed in/;

let scratch: string;
let model: StandInModel;
const fixtures: HookFixture[] = [];

function fixture(options: Parameters<typeof makeHookFixture>[0] = {}): HookFixture {
  const made = makeHookFixture(options);
  fixtures.push(made);
  return made;
}

function emptyHome(): string {
  const home = fs.mkdtempSync(path.join(scratch, 'copilot-home-'));
  fs.mkdirSync(path.join(home, 'hooks'));
  return home;
}

function dataFolder(): string {
  const dir = fs.mkdtempSync(path.join(scratch, 'data-'));
  fs.writeFileSync(path.join(dir, 'dspatch-agent-choice.json'), JSON.stringify({ formatVersion: 1, agent: 'copilot', chosenAtUtc: new Date().toISOString() }));
  return dir;
}

interface Host {
  /** Opens a project, which starts a Copilot session, and says how that went. */
  open(): Promise<string>;
  close(): Promise<void>;
}

/** No variable of the session reaches this host: its own home, and the requirement unset. */
async function startHost(userDataDir: string, copilotHome: string): Promise<Host> {
  const config: HostStartConfig = { userDataDir, appVersion: '0.0.0-test', appPath: appRoot, clientPid: process.pid };
  const home = fs.mkdtempSync(path.join(scratch, 'home-'));
  const env: Record<string, string> = { [HOST_CONFIG_ENV]: JSON.stringify(config), COPILOT_HOME: copilotHome, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), GH_CONFIG_DIR: path.join(home, 'gh'), USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), GH_TOKEN: '', GITHUB_TOKEN: '', COPILOT_GITHUB_TOKEN: '', DSPATCH_COPILOT_REQUIRE_HOOKS: '' };
  // And no login of this machine's: the GitHub CLI answers from the system's keyring, whatever the
  // variables say, so it is left off the path. Without it the runtime finds no login to use.
  const pathName = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  Object.assign(env, { [pathName]: (process.env[pathName] ?? '').split(path.delimiter).filter((entry) => !fs.existsSync(path.join(entry, process.platform === 'win32' ? 'gh.exe' : 'gh'))).join(path.delimiter) });
  let child: ReturnType<typeof forkHost> | null = null;
  const connection = new HostConnection({
    spawn: () => {
      child = forkHost(path.join(appRoot, 'src', 'host', 'host-process.ts'), env, true);
      return child;
    },
    startTimeoutMs: 60_000,
    onEvent: () => undefined,
    onLost: () => undefined,
    log: () => undefined,
  });
  const started = await connection.start();
  assert.equal(started.ok, true, String(child));
  return {
    open: async () => {
      const folder = fs.mkdtempSync(path.join(scratch, 'project-'));
      try {
        return JSON.stringify(await connection.call('workspaces.open', NO_SENDER, { folder }));
      } catch (error) {
        return String(error);
      }
    },
    close: async () => {
      await connection.shutdown('host.shutdown', [NO_SENDER, { observeConversationFiles: false }], 15_000);
      await child?.exited;
    },
  };
}

describe('copilot-hooks-required from the host data folder', { timeout: 240_000 }, () => {
  before(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-hooks-required-'));
    model = await startStandInModel();
  });

  after(async () => {
    await model.close();
    for (const made of fixtures) {
      made.remove();
    }
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it('anything of that name requires hooks, and only a certain absence does not', () => {
    const dir = dataFolder();
    assert.equal(copilotHooksRequired(dir, {}), false);
    assert.equal(copilotHooksRequired(dir, { DSPATCH_COPILOT_REQUIRE_HOOKS: '1' }), true);
    const file = path.join(dir, COPILOT_HOOKS_REQUIRED_FILE);
    fs.writeFileSync(file, '');
    assert.equal(copilotHooksRequired(dir, {}), true, 'empty');
    fs.rmSync(file);
    fs.mkdirSync(file);
    assert.equal(copilotHooksRequired(dir, {}), true, 'a folder');
    fs.rmdirSync(file);
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      fs.symlinkSync(path.join(dir, 'nowhere'), file);
      assert.equal(copilotHooksRequired(dir, {}), true, 'a link that leads nowhere');
      fs.rmSync(file);
      fs.chmodSync(dir, 0o000);
      try {
        assert.equal(copilotHooksRequired(dir, {}), true, 'a folder that cannot be looked in');
      } finally {
        fs.chmodSync(dir, 0o700);
      }
    }
  });

  it('on the real host: the file with a pre hook passes, without one or with a broken one refuses, and without the file nothing is required', async () => {
    const valid = fixture();
    const broken = fixture({ invalidConfiguration: true });
    const cases: readonly { readonly what: string; readonly home: string; readonly required: boolean; readonly expect: RegExp }[] = [
      { what: 'file and a valid pre hook', home: valid.home, required: true, expect: SIGN_IN },
      { what: 'file and no hook', home: emptyHome(), required: true, expect: REFUSED },
      { what: 'file and a broken hook file', home: broken.home, required: true, expect: REFUSED },
      { what: 'no file and no hook', home: emptyHome(), required: false, expect: SIGN_IN },
    ];
    for (const entry of cases) {
      const data = dataFolder();
      if (entry.required) {
        fs.writeFileSync(path.join(data, COPILOT_HOOKS_REQUIRED_FILE), '');
      }
      const host = await startHost(data, entry.home);
      try {
        assert.match(await host.open(), entry.expect, entry.what);
      } finally {
        await host.close();
      }
    }
  });

  it('takes effect at the next session on a running host, in both directions, without a restart', async () => {
    const data = dataFolder();
    const file = path.join(data, COPILOT_HOOKS_REQUIRED_FILE);
    const host = await startHost(data, emptyHome());
    try {
      assert.match(await host.open(), SIGN_IN);
      fs.writeFileSync(file, '');
      assert.match(await host.open(), REFUSED);
      fs.rmSync(file);
      assert.match(await host.open(), SIGN_IN);
    } finally {
      await host.close();
    }
  });

  it('with the file read for real: a job with a pre hook runs, and without one nothing reaches the model', async () => {
    const data = dataFolder();
    fs.writeFileSync(path.join(data, COPILOT_HOOKS_REQUIRED_FILE), '');
    const adapterOver = (home: string): CopilotSdkAdapter =>
      new CopilotSdkAdapter({
        policy: COPILOT_CHAT_POLICY,
        env: { ...process.env, COPILOT_HOME: home },
        requireManagedHooks: () => copilotHooksRequired(data, {}),
        testProvider: { type: 'openai', baseUrl: model.baseUrl, apiKey: 'stand-in' },
      });
    const config = { provider: 'copilot' as const, modelRequested: 'stand-in', workspacePath: scratch };

    const refused = adapterOver(emptyHome());
    await assert.rejects(refused.startSession(config), REFUSED);
    await refused.dispose();
    assert.equal(model.requests.length, 0);

    const working = adapterOver(fixture().home);
    const handle = await working.startSession(config);
    const ended = new Promise<string>((resolve) => {
      working.subscribe(handle.dspatchSessionId, (event) => {
        if (event.type === 'run.finished') {
          resolve(event.status);
        }
      });
    });
    model.script({ text: 'It ran.' });
    await working.send(handle.dspatchSessionId, 'Go');
    assert.equal(await ended, 'finished');
    assert.equal(model.requests.length, 1);
    await working.dispose();
  });
});
