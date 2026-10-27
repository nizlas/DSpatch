/**
 * A stand-in for the project host process, for `host-connection.test.ts`.
 *
 * A real separate Node process on the real process channel, so the client's side of the
 * channel is tested against what it will meet: a process that may answer, never answer,
 * stop mid-call or fail to start. It writes one line per call it received to
 * `FAKE_HOST_CALLS`, which is how a test shows that nothing was sent twice.
 *
 *   FAKE_HOST_MODE=serve           answer every call, except `hang` (never) and `die` (exit 3)
 *   FAKE_HOST_MODE=crash-at-start  write to stderr and exit 4 before saying it is ready
 *   FAKE_HOST_MODE=never-ready     stay up and never say it is ready
 */

import fs from 'node:fs';
import process from 'node:process';

const mode = process.env['FAKE_HOST_MODE'] ?? 'serve';
const callsFile = process.env['FAKE_HOST_CALLS'] ?? '';

if (mode === 'crash-at-start') {
  process.stderr.write('fake host: cannot open its data\n');
  process.exit(4);
}

if (mode === 'never-ready') {
  setInterval(() => undefined, 1_000);
} else {
  process.on('message', (message) => {
    if (callsFile !== '') {
      fs.appendFileSync(callsFile, `${message.method}\n`);
    }
    if (message.method === 'hang') {
      return;
    }
    if (message.method === 'die') {
      process.exit(3);
    }
    if (message.method === 'throw') {
      process.send({
        t: 'result',
        id: message.id,
        ok: false,
        error: { kind: 'host-error', code: 'failed', message: 'the method said no' },
      });
      return;
    }
    if (message.method === 'emit') {
      process.send({ t: 'event', to: { kind: 'every-window' }, channel: 'test:event', payload: message.args });
    }
    process.send({ t: 'result', id: message.id, ok: true, value: { method: message.method, args: message.args } });
  });
  process.send({ t: 'ready', pid: process.pid, startedAtUtc: new Date().toISOString(), closeWithinMs: 8_000 });
}
