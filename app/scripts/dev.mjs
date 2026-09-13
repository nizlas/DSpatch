/**
 * Startar utvecklingsläget: Vites utvecklingsserver för renderaren och Electron
 * mot den adressen.
 *
 * Huvudprocessen och preload buntas inte. De kompileras av `tsc` till vanliga
 * CommonJS-moduler som löser `node_modules` normalt. Skälet är dokumenterat:
 * Cursors SDK laddar delar av sig själv lazy, vilket en enfilsbunt inte kan
 * följa. Kör `npm run build:node` före detta skript.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const appDir = fileURLToPath(new URL('..', import.meta.url));

// Läst från vanlig Node ger `electron` sökvägen till den körbara filen.
// Paketets typdeklaration beskriver i stället Electrons API-yta, därav casten.
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
  throw new Error('Vite startade utan att ge någon lokal adress att ladda.');
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
