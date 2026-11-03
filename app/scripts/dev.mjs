/**
 * Start development mode: Vite's renderer server and Electron loading its URL.
 *
 * The main process and preload are not bundled. `tsc` compiles them to ordinary
 * CommonJS modules that resolve `node_modules` normally. The documented reason:
 * Cursor SDK lazily loads parts of itself that a single-file bundle cannot
 * follow. Run `npm run build:node` before this script.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const appDir = fileURLToPath(new URL('..', import.meta.url));

// In ordinary Node, `electron` returns the path to its executable.
// The package's type declaration instead describes Electron's API, hence the cast.
const electronExecutable = /** @type {string} */ (
  /** @type {unknown} */ (require('electron'))
);

/*
 * `--isolated-profile <folder>` (DSP-165.1): run on that profile and nothing else. The folder goes
 * to Electron as an argument, never through a shell, and the main process checks that Electron
 * chose it before any host starts. Start this script with `node`, not through `npm run`: npm runs
 * scripts through cmd on Windows, which reads `%`, `&`, `^` and `!` in a folder name as its own.
 */
const passed = process.argv.slice(2);
const isolatedAt = passed.findIndex((arg) => arg === '--isolated-profile' || arg.startsWith('--isolated-profile='));
const electronArgs = [...passed];
const electronEnv = {};
if (isolatedAt >= 0) {
  const flag = passed[isolatedAt] ?? '';
  const value = flag.includes('=') ? flag.slice(flag.indexOf('=') + 1) : (passed[isolatedAt + 1] ?? '');
  if (value.trim() === '' || value.startsWith('--')) {
    process.stderr.write('dev: --isolated-profile needs a folder. Nothing was started.\n');
    process.exit(2);
  }
  if (passed.some((arg) => arg.startsWith('--user-data-dir'))) {
    process.stderr.write('dev: give either --isolated-profile or --user-data-dir, not both. Nothing was started.\n');
    process.exit(2);
  }
  const profile = path.resolve(value);
  electronArgs.splice(isolatedAt, flag.includes('=') ? 1 : 2, `--user-data-dir=${profile}`);
  electronEnv.DSPATCH_EXPECT_USERDATA = profile;
}

const server = await createServer({
  configFile: path.join(appDir, 'vite.config.mts'),
});

await server.listen();
server.printUrls();

const rendererUrl = server.resolvedUrls?.local[0];

if (rendererUrl === undefined) {
  await server.close();
  throw new Error('Vite started without providing a local URL to load.');
}

// Other arguments after `npm run dev --` go to Electron unchanged.
const electron = spawn(electronExecutable, [appDir, ...electronArgs], {
  stdio: 'inherit',
  env: { ...process.env, ...electronEnv, DSPATCH_RENDERER_URL: rendererUrl },
});
// A stop of this script reaches the window, or it is left running on its own.
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => {
    electron.kill(signal);
  });
}

electron.on('exit', (code) => {
  void server.close().then(() => {
    process.exit(code ?? 1);
  });
});
