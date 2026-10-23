/**
 * Start DSpatch on the review surface: `npm run review -- <definition.review.json>`.
 *
 * The same development mode as `dev.mjs`, with `#review` on the URL the window loads
 * and the definition file passed as `DSPATCH_REVIEW_DEFINITION`. Without a file the
 * view offers to choose one. A separate script, like `editor.mjs`, so that the
 * ordinary `npm run dev` path is unchanged. Further arguments go to Electron, for
 * example `--user-data-dir=<folder>` to keep a trial's record apart.
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

const definition = process.argv[2];
const electronArgs = process.argv.slice(3);

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

/** @type {Record<string, string | undefined>} */
const env = { ...process.env, DSPATCH_RENDERER_URL: `${rendererUrl}#review` };
if (definition !== undefined) {
  env['DSPATCH_REVIEW_DEFINITION'] = path.resolve(definition);
}

const electron = spawn(electronExecutable, [appDir, ...electronArgs], { stdio: 'inherit', env });

electron.on('exit', (code) => {
  void server.close().then(() => {
    process.exit(code ?? 1);
  });
});
