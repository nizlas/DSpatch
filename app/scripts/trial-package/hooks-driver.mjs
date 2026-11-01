// @ts-nocheck: run by the host package's own Node, with no development repository present.
/**
 * Runs on the host machine in the hook trial (DSP-154): the packaged Copilot adapter and runtime,
 * the packaged Node, synthetic hooks in the account's default `~/.copilot/hooks`, and the local
 * stand-in model. `COPILOT_HOME` is not set, so discovery is the runtime's own.
 *
 *     node hooks-driver.mjs <package app folder> <stand-in model module>
 *
 * Prints one JSON line per scenario.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const [, , app, standIn] = process.argv;
const require = createRequire(path.join(app, 'package.json'));
const { COPILOT_ANALYSIS_POLICY, COPILOT_CHAT_POLICY, CopilotSdkAdapter } = require(path.join(app, 'dist/adapter/copilot-sdk-adapter.js'));
const { startStandInModel } = await import(standIn);

const MARKER = 'EXCLUDED-SYNTHETIC-MARKER-5e1c';
const copilot = path.join(os.homedir(), '.copilot');
const hookFolder = path.join(copilot, 'hooks');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-work-'));
const log = path.join(work, '..', `hook-log-${String(process.pid)}.jsonl`);
const behaviourFile = path.join(work, '..', `hook-behaviour-${String(process.pid)}.json`);
fs.writeFileSync(path.join(work, 'allowed.txt'), 'allowed content\n');
fs.mkdirSync(path.join(work, 'secret'));
fs.writeFileSync(path.join(work, 'secret', 'file.txt'), `${MARKER}\n`);
fs.mkdirSync(hookFolder, { recursive: true });
const script = (kind) => {
  const file = path.join(hookFolder, `${kind}.sh`);
  // Plain sh and grep on the machine: no Node of DSpatch's in the hook.
  fs.writeFileSync(
    file,
    `#!/bin/sh
input=$(cat)
printf '%s\\n' "${kind} $input" >> "${log}"
behaviour=$(cat "${behaviourFile}")
case "$behaviour" in
  ${kind}-sleep) sleep 30 ;;
  ${kind}-fail) exit 1 ;;
esac
case "${kind}:$input" in
  *pre:*secret/*) printf '%s' '{"permissionDecision":"deny","permissionDecisionReason":"The synthetic rule excludes this path."}' ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return file;
};
fs.writeFileSync(
  path.join(hookFolder, 'synthetic.json'),
  JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: 'command', bash: script('pre'), timeoutSec: 2 }], postToolUse: [{ type: 'command', bash: script('post'), timeoutSec: 2 }] } }),
);

const model = await startStandInModel();
async function scenario(name, behaviour, policy, calls) {
  fs.writeFileSync(behaviourFile, behaviour);
  fs.writeFileSync(log, '');
  const adapter = new CopilotSdkAdapter({ policy, requireManagedHooks: true, testProvider: { type: 'openai', baseUrl: model.baseUrl, apiKey: 'stand-in' } });
  const asked = model.requests.length;
  model.script(...calls, { text: 'done' });
  const handle = await adapter.startSession({ provider: 'copilot', modelRequested: 'stand-in', workspacePath: work });
  const finished = new Promise((resolve) => {
    adapter.subscribe(handle.dspatchSessionId, (event) => {
      if (event.type === 'run.finished') {
        resolve(event);
      }
    });
  });
  await adapter.send(handle.dspatchSessionId, 'Work on it');
  const end = await finished;
  await adapter.dispose();
  // A stopped turn leaves answers it never asked for.
  for (let left = calls.length + 1 - (model.requests.length - asked); left > 0; left -= 1) {
    model.forget();
  }
  const sent = JSON.stringify(model.requests.slice(asked).map((request) => request.messages));
  const hooks = fs.readFileSync(log, 'utf8').split('\n').filter((line) => line !== '').map((line) => line.split(' ')[0]);
  process.stdout.write(`${JSON.stringify({ name, status: end.status, error: end.error?.message ?? null, markerAtModel: sent.includes(MARKER), allowedAtModel: sent.includes('allowed content'), hooks, ranMade: fs.existsSync(path.join(work, 'made.txt')) })}\n`);
}
const view = (file) => ({ tool: 'view', args: { path: path.join(work, file) } });
const bash = (command) => ({ tool: 'bash', args: { command, description: 'a command', mode: 'sync', initial_wait: 10 } });
await scenario('allowed', 'none', COPILOT_ANALYSIS_POLICY, [view('allowed.txt')]);
await scenario('denied read', 'none', COPILOT_ANALYSIS_POLICY, [view('secret/file.txt')]);
await scenario('denied command', 'none', COPILOT_CHAT_POLICY, [bash('touch made.txt; cat secret/file.txt')]);
await scenario('pre error', 'pre-fail', COPILOT_ANALYSIS_POLICY, [view('allowed.txt')]);
await scenario('pre timeout', 'pre-sleep', COPILOT_CHAT_POLICY, [bash('touch made.txt; cat allowed.txt')]);
await scenario('post error', 'post-fail', COPILOT_ANALYSIS_POLICY, [view('allowed.txt')]);
await model.close();
fs.rmSync(hookFolder, { recursive: true, force: true });
process.exit(0);
