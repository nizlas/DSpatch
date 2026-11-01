// @ts-nocheck: run by the host package's own Node, with no development repository present.
/**
 * Runs on the host machine in the hook trial (DSP-154): connects to the packaged host, started
 * over SSH, the way a client does, and opens a project, which starts a Copilot session there.
 *
 *     node hooks-required-driver.mjs <package app folder> <data folder>
 *
 * Prints what opening answered. Nothing here gives the host a variable, a file or a model.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const [, , app, data] = process.argv;
const require = createRequire(path.join(app, 'package.json'));
const { HostConnection } = require(path.join(app, 'dist/main/host-connection.js'));
const { RemoteLink } = require(path.join(app, 'dist/main/remote-link.js'));

const running = JSON.parse(fs.readFileSync(path.join(data, 'host-running.json'), 'utf8'));
const token = fs.readFileSync(path.join(data, 'remote-token'), 'utf8').trim();
const connection = new HostConnection({
  spawn: () => new RemoteLink({ endpoint: { host: '127.0.0.1', port: running.port, token }, build: running, log: () => undefined }),
  startTimeoutMs: 30_000,
  onEvent: () => undefined,
  onLost: () => undefined,
  log: () => undefined,
});
const started = await connection.start();
if (!started.ok) {
  process.stdout.write(`could not connect: ${started.failure.message}\n`);
  process.exit(1);
}
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'required-project-'));
let answer;
try {
  answer = JSON.stringify(await connection.call('workspaces.open', { senderId: null }, { folder }));
} catch (error) {
  answer = String(error);
}
process.stdout.write(`pid ${String(running.pid)}: ${answer}\n`);
process.exit(0);
