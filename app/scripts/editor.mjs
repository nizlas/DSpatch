/**
 * Start DSpatch with the loop editor open: `npm run editor`.
 *
 * The same development mode as `dev.mjs`, with `#editor` on the URL the window loads.
 * A separate script rather than a flag inside `dev.mjs` so that the ordinary
 * `npm run dev` path — the chat workflow — is byte for byte what it was.
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
  env: { ...process.env, DSPATCH_RENDERER_URL: `${rendererUrl}#editor` },
});

electron.on('exit', (code) => {
  void server.close().then(() => {
    process.exit(code ?? 1);
  });
});
