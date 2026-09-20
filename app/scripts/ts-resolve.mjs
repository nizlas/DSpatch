/**
 * Let `node --test` load the main process the way `tsc` does.
 *
 * The main process is compiled by `tsc` with `module: node18`, so its relative
 * imports have no file extension: `./git-state`, not `./git-state.ts`. Node's own
 * ESM resolution requires the extension, so before this hook existed, a test
 * could import a leaf module such as `test-command.ts` — whose only imports are
 * node built-ins — but could not import `chat-service.ts` at all. That is why
 * report 003 found the own-repository refusal outside `npm test`.
 *
 * The hook adds exactly one thing: for a relative specifier with no extension,
 * try `.ts` and then `.tsx`. It does not change how `tsc` resolves anything, so
 * the shipped build is still checked by `npm run typecheck` and `npm run build`
 * rather than by this file.
 *
 * Registered by `npm test` through `--import`.
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const EXTENSIONS = ['.ts', '.tsx'];

/**
 * A relative specifier that already names a file extension is left alone.
 *
 * @param {string} specifier
 * @returns {boolean}
 */
function needsExtension(specifier) {
  return (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[cm]?[jt]sx?$|\.json$|\.node$/.test(specifier)
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!needsExtension(specifier) || context.parentURL === undefined) {
      return nextResolve(specifier, context);
    }
    for (const extension of EXTENSIONS) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL);
      if (candidate.protocol === 'file:' && existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true, format: 'module-typescript' };
      }
    }
    return nextResolve(specifier, context);
  },
});
