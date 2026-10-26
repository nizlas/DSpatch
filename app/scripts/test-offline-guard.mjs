/**
 * Keep the test suite offline, and make it loud when it is not.
 *
 * On 26 October 2026 (run 20261026-200000-linux-claude, call 3) `npm run test:chat`
 * reached Cursor's API from a test that constructed `ChatService` without a
 * substituted adapter: the real `CursorSdkAdapter` asked `GET /v1/models` and the
 * test failed only because the account's plan refused it. With a different plan it
 * would have passed and spent a provider turn without anyone noticing. A test must
 * never do that.
 *
 * Registered by `scripts/run-tests.mjs` through `--import`, for the test process and
 * every test file's own process (the runner forwards `--import`). Two refusals:
 *
 * - **A TCP connection to anything but this machine.** `net.Socket.prototype.connect`
 *   is wrapped, which every TCP client in Node goes through (`net`, `tls`, `http`,
 *   `https`, `http2` and the built-in `fetch`). Loopback hosts and local pipes or
 *   sockets (`path`) are allowed. A refused connection fails like an unreachable
 *   host, is printed on stderr, and makes the process exit non-zero even if the
 *   caller swallowed the error, so the file fails.
 * - **Loading `@anthropic-ai/claude-agent-sdk`.** The real SDK would start the
 *   Claude Code binary, a separate process the connection guard cannot see, and its
 *   session lookup reads the user's Claude profile. Every test substitutes `queryFn`
 *   and `localLookup`; one that does not now fails at the import.
 *
 * Not covered: a test run outside `run-tests.mjs` (plain `node --test`), and network
 * use by a child process a test starts. Nothing here changes the product.
 */

import net from 'node:net';
import { registerHooks } from 'node:module';
import process from 'node:process';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']);

/** @type {string[]} */
const refused = [];

/**
 * Where a `connect` call is going, from any of its call shapes.
 *
 * @param {unknown[]} args
 * @returns {{ local: boolean, target: string }}
 */
function targetOf(args) {
  // `net` passes its normalized arguments as one array in some versions.
  const list = Array.isArray(args[0]) ? /** @type {unknown[]} */ (args[0]) : args;
  const first = list[0];
  // A string is a pipe or socket path only when it is not a number, which is Node's
  // own test (`isPipeName` in lib/net.js): `connect('443', 'example.com')` is a port.
  if (typeof first === 'string' && !(Number(first) >= 0)) {
    return { local: true, target: first };
  }
  if (first !== null && typeof first === 'object') {
    const options = /** @type {{ path?: unknown, host?: unknown, port?: unknown }} */ (first);
    if (typeof options.path === 'string') {
      return { local: true, target: options.path };
    }
    const host = typeof options.host === 'string' ? options.host : 'localhost';
    return { local: LOOPBACK.has(host) || host.startsWith('127.'), target: `${host}:${String(options.port)}` };
  }
  const host = typeof list[1] === 'string' ? list[1] : 'localhost';
  return { local: LOOPBACK.has(host) || host.startsWith('127.'), target: `${host}:${String(first)}` };
}

/** @type {(this: net.Socket, ...args: unknown[]) => net.Socket} */
const originalConnect = /** @type {any} */ (net.Socket.prototype.connect);
/** @type {any} */ (net.Socket.prototype).connect = function guardedConnect(/** @type {unknown[]} */ ...args) {
  const { local, target } = targetOf(args);
  if (local) {
    return originalConnect.apply(this, args);
  }
  const unexpected = !expected.delete(target);
  if (unexpected) {
    refused.push(target);
  }
  const error = Object.assign(
    new Error(`[offline-guard] a test tried to connect to ${target}; tests must not reach the network`),
    { code: 'EOFFLINEGUARD' },
  );
  if (unexpected) {
    process.stderr.write(`${error.message}\n${new Error('connect called from').stack ?? ''}\n`);
  }
  const socket = /** @type {net.Socket} */ (this);
  process.nextTick(() => {
    socket.destroy(error);
  });
  return socket;
};

/** @type {Set<string>} */
const expected = new Set();

/**
 * Mark the next refusal of this specifier, or of this connection target as
 * `host:port`, as one a test asks for on purpose, so it
 * is still refused but does not fail the file at exit. For the test that proves the
 * guard is active; nothing else should need it.
 *
 * @param {string} specifier
 */
export function expectRefusal(specifier) {
  expected.add(specifier);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@anthropic-ai/claude-agent-sdk' || specifier.startsWith('@anthropic-ai/claude-agent-sdk/')) {
      if (!expected.delete(specifier)) {
        refused.push(specifier);
      }
      throw new Error(
        `[offline-guard] a test loaded ${specifier}: the real Claude SDK starts Claude Code and reads its profile. ` +
          'Substitute queryFn and localLookup.',
      );
    }
    return nextResolve(specifier, context);
  },
});

process.on('exit', () => {
  if (refused.length > 0) {
    process.stderr.write(`[offline-guard] FAILED: refused ${refused.join(', ')}\n`);
    process.exitCode = 1;
  }
});
