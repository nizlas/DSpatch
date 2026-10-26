/**
 * Start DSpatch on the review surface: `npm run review -- <definition.review.json>`.
 *
 * The same development mode as `dev.mjs`, with `#review` on the development URL and
 * the definition file passed as `DSPATCH_REVIEW_DEFINITION`. The main process then opens
 * review alone, in a review window of its own and with no chat window (DSP-126): the
 * same `open({ repository: null, definitionPath })` call the chat's *Open review* makes.
 * Without a file the window offers to choose one. A separate script, like
 * `editor.mjs`, so that the ordinary `npm run dev` path is unchanged. Further
 * arguments go to Electron, for example `--user-data-dir=<folder>` to keep a trial's
 * record apart.
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

// The definition is the first argument that is not an option; options go to Electron.
const args = process.argv.slice(2);
const definition = args.find((arg) => !arg.startsWith('-'));
const electronArgs = args.filter((arg) => arg !== definition);

// `DSPATCH_REVIEW_PORT` lets a second checkout run beside an open review window
// without reloading it; the default is the config's fixed port.
const port = Number(process.env['DSPATCH_REVIEW_PORT'] ?? '');
const server = await createServer({
  configFile: path.join(appDir, 'vite.config.mts'),
  ...(Number.isInteger(port) && port > 0 ? { server: { port, strictPort: true } } : {}),
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
