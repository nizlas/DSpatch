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

const electron = spawn(electronExecutable, [appDir], {
  stdio: 'inherit',
  env: { ...process.env, DSPATCH_RENDERER_URL: rendererUrl },
});

electron.on('exit', (code) => {
  void server.close().then(() => {
    process.exit(code ?? 1);
  });
});
