/**
 * A local stand-in for the Claude Code process in the Claude adapter's dispose
 * tests (DSP-116). It is started with `process.execPath`; it is never Claude,
 * opens no connection and reads nothing but its own stdin.
 *
 * - `ignore-everything`: keeps running through stdin EOF and termination
 *   signals, so only a kill ends it.
 * - `exit-on-stdin-end`: exits with code 0 when stdin ends, as the SDK's abort
 *   path makes the real process do by closing its stdin.
 *
 * It writes one line, `ready`, once its handlers are installed. As a last resort
 * against a leak it ends itself after 60 s whatever the mode.
 *
 *     node tests/support/claude-substitute-process.mjs ignore-everything
 */

const mode = process.argv[2] ?? 'ignore-everything';

process.stdin.on('data', () => {
  // Read so the pipe never fills; the content is not used.
});
if (mode === 'exit-on-stdin-end') {
  process.stdin.on('end', () => {
    process.exit(0);
  });
} else {
  process.stdin.on('end', () => {
    // Ignored on purpose: this process outlives its stdin.
  });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      // Ignored on purpose. SIGKILL cannot be caught.
    });
  }
}

setInterval(() => {
  // Keeps the process alive until it is ended.
}, 1_000);
setTimeout(() => {
  process.exit(3);
}, 60_000);

process.stdout.write('ready\n');
